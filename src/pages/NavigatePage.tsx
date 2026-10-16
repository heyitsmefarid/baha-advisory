import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { useSearchParams } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import BaseMap, { ClickToPick, FitBounds, InvalidateOnResize } from "../components/map/BaseMap";
import HazardLayer from "../components/map/HazardLayer";
import { pinIcon, userIcon } from "../components/map/markers";
import PlaceInput, { type Place } from "../components/nav/PlaceInput";
import RouteExplanation from "../components/nav/RouteExplanation";
import { Badge, Callout, Freshness, Segmented, Spinner, formatDistance, formatDuration } from "../components/ui";
import { useOfficialHazards } from "../hooks/useOfficialData";
import { requestRoute } from "../services/routingService";
import { errorMessage } from "../lib/api";
import { readLocal, writeLocal } from "../lib/storage";
import {
  evaluateRoute,
  TRAVEL_MODE_LABELS,
  TRAVEL_MODES,
  type EvaluatedRoute,
  type PlanResult,
  type TravelMode,
} from "../../shared/routing";
import { haversineM, nearestVertex, distancePointToPolylineM, type Pt } from "../../shared/geo";

const MODE_KEY = "bahadvisory_nav_mode_v1";
const OFF_ROUTE_M = 70;

const STATUS_TONE = { safe: "safe", caution: "caution", unsafe: "danger" } as const;
const STATUS_TEXT = { safe: "Clear of verified flooding", caution: "Passes flooded but passable roads", unsafe: "Blocked by flooding" };

function parsePoint(v: string | null): Pt | null {
  if (!v) return null;
  const [a, b] = v.split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

export default function NavigatePage() {
  const [params] = useSearchParams();
  const hazards = useOfficialHazards();
  const [origin, setOrigin] = useState<Place | null>(() => {
    const p = parsePoint(params.get("from"));
    return p ? { label: params.get("fromName") ?? "Start", point: p, source: "link" } : null;
  });
  const [destination, setDestination] = useState<Place | null>(() => {
    const p = parsePoint(params.get("to"));
    return p ? { label: params.get("toName") ?? "Destination", point: p, source: "link" } : null;
  });
  const [mode, setMode] = useState<TravelMode>(() => {
    const fromUrl = params.get("mode") as TravelMode | null;
    return fromUrl && TRAVEL_MODES.includes(fromUrl) ? fromUrl : readLocal<TravelMode>(MODE_KEY, "car");
  });
  const [picking, setPicking] = useState<"origin" | "destination" | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [source, setSource] = useState<"server" | "device" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [position, setPosition] = useState<{ pt: Pt; accuracy: number } | null>(null);
  const [speak, setSpeak] = useState(false);
  const lastRecalc = useRef(0);
  const lastSpoken = useRef(-1);

  useEffect(() => writeLocal(MODE_KEY, mode), [mode]);

  // Start from GPS automatically when arriving from an evacuation/alert link.
  useEffect(() => {
    if (origin || !destination || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ label: "My location", point: [pos.coords.latitude, pos.coords.longitude], source: "gps" }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected: EvaluatedRoute | null = useMemo(() => {
    if (!plan) return null;
    const all = [plan.recommended, ...plan.alternatives].filter(Boolean) as EvaluatedRoute[];
    return all.find((r) => r.id === selectedId) ?? plan.recommended ?? all[0] ?? null;
  }, [plan, selectedId]);

  const compute = useCallback(
    async (from: Place | null, to: Place | null, reason?: string) => {
      if (!from || !to) return;
      setLoading(true);
      setError(null);
      try {
        const res = await requestRoute({ origin: from.point, destination: to.point, mode }, hazards.hazards);
        setPlan(res.plan);
        setSource(res.source);
        setSelectedId(res.plan.recommended?.id ?? null);
        lastRecalc.current = Date.now();
        if (reason) setNotice(reason);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [mode, hazards.hazards]
  );

  // Automatic recalculation after verified road updates.
  useEffect(() => {
    if (!plan || !selected || hazards.loading || plan.hazardSignature === hazards.signature) return;
    const before = selected.evaluation.status;
    const now = evaluateRoute(selected, hazards.hazards, mode);
    const time = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    if (now.status === "unsafe" || (before !== "unsafe" && now.blocked.length > selected.evaluation.blocked.length)) {
      const from = navigating && position ? { label: "My location", point: position.pt, source: "gps" as const } : origin;
      compute(from, destination, `Route recalculated at ${time} — a verified road update now affects your previous route.`);
    } else {
      setPlan({ ...plan, hazardSignature: hazards.signature });
      setNotice(`Road data updated at ${time}. Your route is still ${now.status === "safe" ? "clear" : "passable with caution"}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazards.signature]);

  // Live guidance: follow GPS, detect off-route, auto-reroute.
  useEffect(() => {
    if (!navigating || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setPosition({ pt: [pos.coords.latitude, pos.coords.longitude], accuracy: pos.coords.accuracy }),
      () => setError("Lost GPS signal. Directions remain on screen."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [navigating]);

  const guidance = useMemo(() => {
    if (!navigating || !position || !selected) return null;
    const progress = nearestVertex(position.pt, selected.geometry).index;
    const offBy = distancePointToPolylineM(position.pt, selected.geometry);
    const stepIdx = selected.steps.map((s) => nearestVertex(s.location, selected.geometry).index);
    let current = 0;
    stepIdx.forEach((idx, i) => {
      if (idx <= progress) current = i;
    });
    const next = selected.steps[Math.min(current + 1, selected.steps.length - 1)];
    const distToNext = next ? haversineM(position.pt, next.location) : 0;
    const remaining = haversineM(position.pt, selected.geometry[selected.geometry.length - 1]);
    return { current, next, distToNext, offBy, remaining, arrived: remaining < 40 };
  }, [navigating, position, selected]);

  useEffect(() => {
    if (!guidance || !navigating) return;
    if (guidance.offBy > OFF_ROUTE_M + (position?.accuracy ?? 0) && Date.now() - lastRecalc.current > 30_000 && destination && position) {
      compute({ label: "My location", point: position.pt, source: "gps" }, destination, "You left the route — recalculated from your current position.");
    }
    if (speak && guidance.next && lastSpoken.current !== guidance.current && "speechSynthesis" in window) {
      lastSpoken.current = guidance.current;
      const u = new SpeechSynthesisUtterance(`In ${formatDistance(guidance.distToNext)}, ${guidance.next.instruction}`);
      window.speechSynthesis.speak(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidance?.current, guidance?.offBy]);

  const onPick = (p: Pt) => {
    const place: Place = { label: "Dropped pin", point: p, source: "map" };
    if (picking === "origin") setOrigin(place);
    if (picking === "destination") setDestination(place);
    setPicking(null);
  };

  const allRoutes = plan ? ([plan.recommended, ...plan.alternatives].filter(Boolean) as EvaluatedRoute[]) : [];
  const fitPoints: Pt[] = selected ? selected.geometry : ([origin?.point, destination?.point].filter(Boolean) as Pt[]);

  return (
    <AppShell fullBleed>
      <div className="split-view">
        <section className="split-view__panel" aria-label="Route planner">
          <h1 className="split-view__title">Flood-safe navigation</h1>
          <p className="tiny">
            Routes avoid roads that the DRRM has verified as flooded or closed for your vehicle. Free for everyone.
          </p>

          <PlaceInput
            label="From"
            value={origin}
            onChange={(p) => {
              setOrigin(p);
              setPlan(null);
            }}
            onPickOnMap={() => setPicking(picking === "origin" ? null : "origin")}
            picking={picking === "origin"}
          />
          <PlaceInput
            label="To"
            value={destination}
            onChange={(p) => {
              setDestination(p);
              setPlan(null);
            }}
            onPickOnMap={() => setPicking(picking === "destination" ? null : "destination")}
            picking={picking === "destination"}
            allowGps={false}
          />

          <div className="field">
            <span className="field__label">Travel mode</span>
            <Segmented
              label="Travel mode"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setPlan(null);
              }}
              options={TRAVEL_MODES.map((m) => ({ id: m, label: TRAVEL_MODE_LABELS[m] }))}
            />
          </div>

          <button
            type="button"
            className="btn-block btn-lg"
            disabled={!origin || !destination || loading}
            onClick={() => compute(origin, destination)}
          >
            {loading ? (
              <>
                <Spinner /> Checking roads…
              </>
            ) : plan ? (
              "Recalculate"
            ) : (
              "Find a safe route"
            )}
          </button>

          {error && <Callout tone="danger">{error}</Callout>}
          {notice && (
            <Callout tone="info">
              {notice}{" "}
              <button type="button" className="btn-ghost btn-sm" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </Callout>
          )}

          {plan && (
            <div className="route-results">
              {plan.status === "no_safe_route" ? (
                <Callout tone="danger" title="No safe route found">
                  Every path we tested passes through flooding that is not passable for a{" "}
                  {TRAVEL_MODE_LABELS[mode].toLowerCase()}. Don't attempt this trip — wait for an update, or find the
                  nearest <a href="/evacuation">evacuation center</a>.
                </Callout>
              ) : (
                <Callout tone={plan.status === "safe" ? "safe" : "caution"} title={plan.status === "safe" ? "Safe route found" : "Route with flooded stretches"}>
                  {plan.avoided.length > 0
                    ? `Avoids ${plan.avoided.length} verified flood or closure on the fastest road.`
                    : plan.status === "safe"
                    ? "No verified flooding or closures on this route."
                    : "Passable for your vehicle, but go slowly through standing water."}
                </Callout>
              )}

              <div className="route-list" role="radiogroup" aria-label="Route options">
                {allRoutes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={selected?.id === r.id}
                    className={`route-card route-card--${r.evaluation.status} ${selected?.id === r.id ? "route-card--on" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className="route-card__head">
                      <strong>{r.id === plan.recommended?.id ? "Recommended" : r.label}</strong>
                      <Badge tone={STATUS_TONE[r.evaluation.status]}>{STATUS_TEXT[r.evaluation.status]}</Badge>
                    </span>
                    <span className="route-card__stats mono">
                      {formatDistance(r.distanceM)} · {formatDuration(r.durationS)}
                    </span>
                    {r.evaluation.blocked.length > 0 && (
                      <span className="route-card__warn">Through: {r.evaluation.blocked.map((b) => b.name).join(", ")}</span>
                    )}
                  </button>
                ))}
              </div>

              {selected && (
                <>
                  <div className="route-meta">
                    {selected.evaluation.freshness.newestMs && (
                      <Freshness at={selected.evaluation.freshness.newestMs} prefix="Road data on route updated" />
                    )}
                    <span className="tiny">
                      {source === "device" ? "Computed on this device (service unreachable)" : `Engine: ${plan.provider}`} ·{" "}
                      {plan.hazardsConsidered} verified hazard{plan.hazardsConsidered === 1 ? "" : "s"} checked
                    </span>
                  </div>
                  {selected.evaluation.notes.map((n) => (
                    <p key={n} className="tiny route-note">
                      {n}
                    </p>
                  ))}

                  <RouteExplanation plan={plan} />

                  {(selected.evaluation.cautions.length > 0 || selected.evaluation.nearby.length > 0) && (
                    <div className="panel panel--flat">
                      <h3 className="panel__title">Road condition warnings</h3>
                      <ul className="list-plain hazard-list">
                        {[...selected.evaluation.cautions, ...selected.evaluation.nearby].map((h) => (
                          <li key={h.hazardId}>
                            <Badge tone={h.effect === "blocked" ? "danger" : h.effect === "caution" ? "caution" : "neutral"}>
                              {h.distanceM === 0 ? "On route" : `${formatDistance(h.distanceM)} away`}
                            </Badge>{" "}
                            <strong>{h.name}</strong> — {h.reason}{" "}
                            {h.updatedAtMs && <Freshness at={h.updatedAtMs} />}
                            {h.simulated && <Badge tone="neutral">Simulated</Badge>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected.evaluation.status !== "unsafe" && (
                    <div className="btn-row">
                      <button type="button" className={navigating ? "btn-danger" : "btn-safe"} onClick={() => setNavigating((n) => !n)}>
                        {navigating ? "Stop guidance" : "Start guidance"}
                      </button>
                      <label className="check-row">
                        <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Read directions aloud
                      </label>
                    </div>
                  )}

                  {guidance && (
                    <div className="guidance" aria-live="polite">
                      {guidance.arrived ? (
                        <strong>You have arrived.</strong>
                      ) : (
                        <>
                          <span className="guidance__dist mono">{formatDistance(guidance.distToNext)}</span>
                          <span className="guidance__text">{guidance.next?.instruction}</span>
                          <span className="tiny">{formatDistance(guidance.remaining)} to destination (straight line)</span>
                        </>
                      )}
                    </div>
                  )}

                  <details className="steps" open={!navigating}>
                    <summary>Turn-by-turn directions ({selected.steps.length})</summary>
                    <ol className="steps__list">
                      {selected.steps.map((s, i) => (
                        <li key={i} className={guidance?.current === i ? "steps__item--now" : undefined}>
                          <span>{s.instruction}</span>
                          <span className="tiny mono">{s.distanceM > 0 ? formatDistance(s.distanceM) : ""}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              )}
            </div>
          )}
        </section>

        <div className={`split-view__map ${picking ? "split-view__map--picking" : ""}`}>
          {picking && <div className="map-hint">Tap the map to set your {picking === "origin" ? "starting point" : "destination"}.</div>}
          <BaseMap className="leaflet-map">
            <InvalidateOnResize watch={plan?.computedAt} />
            <ClickToPick enabled={picking !== null} onPick={onPick} />
            <HazardLayer zones={hazards.zones} roads={hazards.roads} hazards={hazards.hazards} mode={mode} />
            {allRoutes
              .filter((r) => r.id !== selected?.id)
              .map((r) => (
                <Polyline
                  key={r.id}
                  positions={r.geometry}
                  pathOptions={{ color: r.evaluation.status === "unsafe" ? "#d64545" : "#7d90a6", weight: 5, opacity: 0.55, dashArray: "8 8" }}
                  eventHandlers={{ click: () => setSelectedId(r.id) }}
                >
                  <Tooltip sticky>{r.label} — {STATUS_TEXT[r.evaluation.status]}</Tooltip>
                </Polyline>
              ))}
            {selected && (
              <>
                <Polyline positions={selected.geometry} pathOptions={{ color: "#ffffff", weight: 10, opacity: 0.9 }} />
                <Polyline
                  positions={selected.geometry}
                  pathOptions={{ color: selected.evaluation.status === "unsafe" ? "#d64545" : selected.evaluation.status === "caution" ? "#e08a1e" : "#0e7490", weight: 6 }}
                />
              </>
            )}
            {origin && <Marker position={origin.point} icon={pinIcon("#1f9d55", "A")} />}
            {destination && <Marker position={destination.point} icon={pinIcon("#0b2f5c", "B")} />}
            {position && <Marker position={position.pt} icon={userIcon()} />}
            <FitBounds points={fitPoints} fitKey={`${selected?.id ?? ""}-${plan?.computedAt ?? ""}-${origin?.point}-${destination?.point}`} />
          </BaseMap>
        </div>
      </div>
    </AppShell>
  );
}
