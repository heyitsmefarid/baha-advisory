import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { collection, query, where } from "firebase/firestore";
import AppShell from "../components/layout/AppShell";
import BaseMap, { FitBounds, InvalidateOnResize } from "../components/map/BaseMap";
import HazardLayer from "../components/map/HazardLayer";
import { shelterIcon, userIcon } from "../components/map/markers";
import SosPanel from "../components/evacuation/SosPanel";
import { Badge, Callout, EmptyState, Freshness, Segmented, SimulatedBadge, SkeletonRows, Spinner, formatDistance, formatDuration } from "../components/ui";
import { useFirestoreCollection } from "../hooks/useFirestoreCollection";
import { useOfficialHazards } from "../hooks/useOfficialData";
import { db } from "../firebase";
import { api, errorMessage } from "../lib/api";
import { EVAC_STATUS } from "../lib/labels";
import { EVAC_FACILITY_LABELS, type EvacFacility, type EvacuationCenter } from "../../shared/types";
import { haversineM, toPt, type Pt } from "../../shared/geo";

interface Ranked {
  centerId: string;
  routeStatus: "safe" | "caution" | "no_safe_route" | "unknown";
  distanceM: number | null;
  durationS: number | null;
  avoided: number;
  geometry: Pt[] | null;
  explanation: string;
}

const FILTERS: { id: EvacFacility | "open"; label: string }[] = [
  { id: "open", label: "Accepting evacuees" },
  { id: "pwd_access", label: "PWD accessible" },
  { id: "medical", label: "Medical" },
  { id: "pet_area", label: "Pets allowed" },
];

function OccupancyBar({ c }: { c: EvacuationCenter }) {
  if (!c.occupancyVerified || c.capacity == null || c.occupancy == null) {
    return <span className="tiny">Occupancy not verified{c.capacity ? ` · capacity ${c.capacity}` : ""}</span>;
  }
  const pct = Math.min(100, Math.round((c.occupancy / Math.max(1, c.capacity)) * 100));
  return (
    <div className="occupancy" title={`${c.occupancy} of ${c.capacity} (verified)`}>
      <div className="occupancy__bar">
        <span style={{ width: `${pct}%` }} className={pct >= 95 ? "occupancy__fill--full" : pct >= 75 ? "occupancy__fill--high" : ""} />
      </div>
      <span className="tiny mono">
        {c.occupancy}/{c.capacity} · verified <Freshness at={c.occupancyUpdatedAt} prefix="" />
      </span>
    </div>
  );
}

export default function EvacuationPage() {
  const [params, setParams] = useSearchParams();
  const sosOpen = params.get("sos") === "1";
  const hazards = useOfficialHazards();
  const { data: centers, loading, error, fromCache } = useFirestoreCollection<EvacuationCenter>(
    () => query(collection(db, "evacuation_centers"), where("verified", "==", true)),
    (id, d) => ({ id, ...(d as Omit<EvacuationCenter, "id">) }),
    []
  );
  const [me, setMe] = useState<Pt | null>(null);
  const [mode, setMode] = useState<"walk" | "car">("walk");
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [ranking, setRanking] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<string>>(new Set(["open"]));
  const [selected, setSelected] = useState<string | null>(null);

  const findNearest = () => {
    if (!("geolocation" in navigator)) return setRankError("Location isn't available on this device.");
    setRanking(true);
    setRankError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p: Pt = [pos.coords.latitude, pos.coords.longitude];
        setMe(p);
        try {
          const res = await api<{ results: Ranked[] }>("/evacuation/nearest", { anonymous: true, body: { location: { lat: p[0], lng: p[1] }, mode } });
          setRanked(res.results);
          setSelected(res.results[0]?.centerId ?? null);
        } catch (err) {
          setRankError(`${errorMessage(err)} Showing straight-line distances instead.`);
        } finally {
          setRanking(false);
        }
      },
      () => {
        setRanking(false);
        setRankError("Location permission denied. Browse the list below or tap a center on the map.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  };

  const list = useMemo(() => {
    const rank = new Map((ranked ?? []).map((r, i) => [r.centerId, { r, i }]));
    return centers
      .filter((c) => (!filters.has("open") || c.status === "open" || c.status === "standby"))
      .filter((c) => [...filters].filter((f) => f !== "open").every((f) => c.facilities.includes(f as EvacFacility)))
      .map((c) => ({ c, d: me ? haversineM(me, toPt(c.location)) : null, rank: rank.get(c.id) }))
      .sort((a, b) => (a.rank?.i ?? 99) - (b.rank?.i ?? 99) || (a.d ?? 0) - (b.d ?? 0) || a.c.name.localeCompare(b.c.name));
  }, [centers, filters, me, ranked]);

  const best = ranked?.find((r) => r.routeStatus === "safe" || r.routeStatus === "caution");
  const selectedRoute = ranked?.find((r) => r.centerId === selected)?.geometry ?? null;
  const fitPts: Pt[] = selectedRoute ?? (me ? [me, ...list.slice(0, 3).map((x) => toPt(x.c.location))] : list.map((x) => toPt(x.c.location)));

  const toggle = (id: string) =>
    setFilters((f) => {
      const n = new Set(f);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <AppShell fullBleed>
      <div className="split-view">
        <section className="split-view__panel" aria-label="Evacuation centers">
          {sosOpen ? (
            <SosPanel onClose={() => setParams({})} />
          ) : (
            <button type="button" className="sos-open" onClick={() => setParams({ sos: "1" })}>
              Need rescue? Send SOS with your location
            </button>
          )}

          <h1 className="split-view__title">Evacuation centers</h1>
          <p className="tiny">Only centers verified by the LGU are listed. Capacity is shown only when the LGU has verified it.</p>
          {fromCache && <Callout tone="caution">Showing saved center information — may be outdated until you're back online.</Callout>}

          <div className="row">
            <Segmented label="Travel mode" value={mode} onChange={(m) => setMode(m)} options={[{ id: "walk", label: "Walking" }, { id: "car", label: "Vehicle" }]} />
            <button type="button" onClick={findNearest} disabled={ranking}>
              {ranking ? <><Spinner /> Checking safe routes…</> : "Find the nearest safe center"}
            </button>
          </div>
          {rankError && <Callout tone="caution">{rankError}</Callout>}
          {best && (
            <Callout tone={best.routeStatus === "safe" ? "safe" : "caution"} title="Recommended">
              {centers.find((c) => c.id === best.centerId)?.name} — {formatDistance(best.distanceM)}, about {formatDuration(best.durationS)}{" "}
              {mode === "walk" ? "on foot" : "by vehicle"}
              {best.avoided ? `, avoiding ${best.avoided} flooded area${best.avoided > 1 ? "s" : ""}` : ""}.{" "}
              <Link to={`/navigate?to=${centers.find((c) => c.id === best.centerId)?.location.lat},${centers.find((c) => c.id === best.centerId)?.location.lng}&toName=${encodeURIComponent(centers.find((c) => c.id === best.centerId)?.name ?? "")}&mode=${mode}`}>
                Get directions
              </Link>
            </Callout>
          )}
          {ranked && !best && (
            <Callout tone="danger" title="No safe route to nearby centers">
              Every route we checked passes through flooding. Move to higher ground nearby and call 911 or send an SOS.
            </Callout>
          )}

          <div className="chip-row" role="group" aria-label="Filters">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`chip-btn ${filters.has(f.id) ? "chip-btn--solid" : ""}`} aria-pressed={filters.has(f.id)} onClick={() => toggle(f.id)}>
                {f.label}
              </button>
            ))}
          </div>

          {error && <Callout tone="danger">{error}</Callout>}
          {loading ? (
            <SkeletonRows rows={4} />
          ) : list.length === 0 ? (
            <EmptyState title="No centers match">Try removing a filter. In an emergency call 911.</EmptyState>
          ) : (
            <ul className="list-plain center-list">
              {list.map(({ c, d, rank }) => {
                const st = EVAC_STATUS[c.status];
                return (
                  <li key={c.id} className={`center-card ${selected === c.id ? "center-card--on" : ""}`}>
                    <button type="button" className="center-card__main" onClick={() => setSelected(c.id)}>
                      <span className="spread">
                        <strong>{c.name}</strong>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </span>
                      <span className="tiny">{c.address}</span>
                      <OccupancyBar c={c} />
                      <span className="tiny">
                        {rank?.r.distanceM != null
                          ? `${formatDistance(rank.r.distanceM)} by road · ${formatDuration(rank.r.durationS)}${rank.r.routeStatus === "no_safe_route" ? " · no safe route" : ""}`
                          : d != null
                          ? `${formatDistance(d)} straight-line`
                          : ""}
                      </span>
                    </button>
                    {c.facilities.length > 0 && (
                      <div className="chip-row chip-row--tight">
                        {c.facilities.map((f) => (
                          <span key={f} className="legend-chip">
                            {EVAC_FACILITY_LABELS[f]}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="btn-row">
                      <Link className="chip-btn chip-btn--solid" to={`/navigate?to=${c.location.lat},${c.location.lng}&toName=${encodeURIComponent(c.name)}&mode=${mode}`}>
                        Directions
                      </Link>
                      {c.contact?.phone && (
                        <a className="chip-btn" href={`tel:${c.contact.phone}`}>
                          Call {c.contact.phone}
                        </a>
                      )}
                      <SimulatedBadge show={!!c.simulated} />
                      <Freshness at={c.updatedAt} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="split-view__map">
          <BaseMap className="leaflet-map">
            <InvalidateOnResize watch={sosOpen} />
            <HazardLayer zones={hazards.zones} roads={hazards.roads} />
            {selectedRoute && (
              <>
                <Polyline positions={selectedRoute} pathOptions={{ color: "#fff", weight: 9 }} />
                <Polyline positions={selectedRoute} pathOptions={{ color: "#0e7490", weight: 5 }} />
              </>
            )}
            {list.map(({ c }) => (
              <Marker key={c.id} position={toPt(c.location)} icon={shelterIcon(EVAC_STATUS[c.status].color, selected === c.id)} eventHandlers={{ click: () => setSelected(c.id) }}>
                <Tooltip direction="top" offset={[0, -10]}>
                  <strong>{c.name}</strong>
                  <br />
                  {EVAC_STATUS[c.status].label}
                  {c.simulated ? " · simulated" : ""}
                </Tooltip>
              </Marker>
            ))}
            {me && <Marker position={me} icon={userIcon()} />}
            <FitBounds points={fitPts} fitKey={`${selected}-${me}-${list.length}-${!!selectedRoute}`} />
          </BaseMap>
        </div>
      </div>
    </AppShell>
  );
}
