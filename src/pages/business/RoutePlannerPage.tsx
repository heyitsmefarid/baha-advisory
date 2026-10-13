import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Marker, Polyline } from "react-leaflet";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import DashboardLayout from "../../components/layout/DashboardLayout";
import UpgradeNotice from "../../components/billing/UpgradeNotice";
import BaseMap, { ClickToPick, FitBounds } from "../../components/map/BaseMap";
import HazardLayer from "../../components/map/HazardLayer";
import { pinIcon } from "../../components/map/markers";
import PlaceInput, { type Place } from "../../components/nav/PlaceInput";
import { Badge, Callout, Field, PageHeader, Spinner, formatDistance, formatDuration, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useMyOrg } from "../../hooks/useOrg";
import { useSavedRoutes } from "../../hooks/useFleet";
import { useOfficialHazards } from "../../hooks/useOfficialData";
import { requestRoute } from "../../services/routingService";
import { db } from "../../firebase";
import { errorMessage } from "../../lib/api";
import { TRAVEL_MODE_LABELS, type PlanResult } from "../../../shared/routing";
import type { VehicleType } from "../../../shared/types";
import type { Pt } from "../../../shared/geo";
import GeographicFilter from "../../components/geography/GeographicFilter";
import { useGeographicScope } from "../../contexts/GeographicScopeContext";

const VEHICLES: VehicleType[] = ["truck", "car", "suv", "motorcycle", "bicycle"];

/** Multi-stop, flood-aware trip planning for fleets (paid: fleetMonitoring). */
export default function RoutePlannerPage() {
  const [params] = useSearchParams();
  const { scope } = useGeographicScope();
  const { orgId, currentUser } = useAuth();
  const { entitled } = useMyOrg();
  const saved = useSavedRoutes();
  const hazards = useOfficialHazards();
  const toast = useToast();
  const [stops, setStops] = useState<(Place | null)[]>([null, null]);
  const [vehicle, setVehicle] = useState<VehicleType>("truck");
  const [picking, setPicking] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const id = params.get("route");
    const r = saved.data.find((x) => x.id === id);
    if (!r) return;
    setStops(r.stops.map((s) => ({ label: s.label, point: [s.location.lat, s.location.lng] as Pt, source: "saved" as const })));
    setVehicle(r.vehicle);
    setName(r.name);
  }, [params, saved.data]);

  if (!entitled("fleetMonitoring")) {
    return (
      <DashboardLayout kind="business">
        <PageHeader title="Route planner" />
        <UpgradeNotice feature="fleetMonitoring" plan="Business Pro" billingPath="/business/billing" />
        <Callout tone="neutral">Single-destination flood-safe navigation stays free for everyone on the public <a href="/navigate">Navigate</a> page.</Callout>
      </DashboardLayout>
    );
  }

  const ready = stops.length >= 2 && stops.every(Boolean);
  const pts = stops.filter(Boolean).map((s) => s!.point);

  const compute = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const p = stops as Place[];
      const res = await requestRoute({ origin: p[0].point, waypoints: p.slice(1, -1).map((s) => s.point), destination: p[p.length - 1].point, mode: vehicle }, hazards.hazards);
      setPlan(res.plan);
      const chosen = res.plan.recommended ?? res.plan.alternatives[0];
      if (orgId && currentUser && chosen) {
        await addDoc(collection(db, "organizations", orgId, "route_history"), {
          orgId, routeId: params.get("route"), routeName: name || "Ad-hoc trip", vehicle, status: res.plan.status === "no_safe_route" ? "unsafe" : res.plan.status,
          distanceM: chosen.distanceM, durationS: chosen.durationS, avoidedHazards: res.plan.avoided.length, checkedBy: currentUser.uid, at: serverTimestamp(),
        }).catch(() => undefined);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!orgId || !currentUser || !ready || !name.trim()) return toast("Name the route and set every stop.", "caution");
    const coveragePsgcCode = scope.barangayPsgcCode ?? scope.municipalityPsgcCode;
    if (!coveragePsgcCode) return toast("Select the route's municipality or barangay before saving it for paid monitoring.", "caution");
    try {
      await addDoc(collection(db, "organizations", orgId, "saved_routes"), {
        orgId, name: name.trim(), vehicle, createdBy: currentUser.uid, createdAt: serverTimestamp(),
        coveragePsgcCode,
        stops: (stops as Place[]).map((s, i) => ({ label: s.label || `Stop ${i + 1}`, location: { lat: s.point[0], lng: s.point[1] } })),
        lastCheckedAt: null, lastStatus: "unknown", lastDistanceM: null, lastDurationS: null, activeDisruptions: 0,
      });
      toast("Route saved — it will be monitored for flood disruptions.", "safe");
    } catch {
      toast("Couldn't save the route.", "danger");
    }
  };

  const route = plan?.recommended ?? plan?.alternatives[0] ?? null;
  return (
    <DashboardLayout kind="business">
      <PageHeader title="Route planner" subtitle="Plan multi-stop deliveries that avoid DRRM-verified flooding for the vehicle you're sending." />
      <GeographicFilter />
      <div className="zone-form">
        <div className="verify-map verify-map--tall">
          <BaseMap className="leaflet-map">
            <ClickToPick enabled={picking !== null} onPick={(p) => { setStops((s) => s.map((x, i) => (i === picking ? { label: `Stop ${i + 1}`, point: p, source: "map" } : x))); setPicking(null); }} />
            <HazardLayer zones={hazards.zones} roads={hazards.roads} hazards={hazards.hazards} mode={vehicle} />
            {route && (
              <>
                <Polyline positions={route.geometry} pathOptions={{ color: "#fff", weight: 9 }} />
                <Polyline positions={route.geometry} pathOptions={{ color: route.evaluation.status === "unsafe" ? "#d64545" : "#0e7490", weight: 5 }} />
              </>
            )}
            {pts.map((p, i) => <Marker key={i} position={p} icon={pinIcon(i === 0 ? "#1f9d55" : i === pts.length - 1 ? "#0b2f5c" : "#0e7490", String(i + 1))} />)}
            <FitBounds points={route?.geometry ?? pts} fitKey={`${plan?.computedAt}-${pts.length}`} />
          </BaseMap>
        </div>
        <div className="zone-form__fields">
          <Field label="Route name"><input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Calapan Port → Naujan deliveries" /></Field>
          <Field label="Vehicle">
            <select value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleType)}>{VEHICLES.map((v) => <option key={v} value={v}>{TRAVEL_MODE_LABELS[v]}</option>)}</select>
          </Field>
          {stops.map((s, i) => (
            <div key={i} className="stop-row">
              <PlaceInput
                label={i === 0 ? "Start" : i === stops.length - 1 ? "Final stop" : `Stop ${i + 1}`}
                value={s}
                onChange={(p) => setStops((arr) => arr.map((x, j) => (j === i ? p : x)))}
                onPickOnMap={() => setPicking(picking === i ? null : i)}
                picking={picking === i}
                allowGps={i === 0}
              />
              {stops.length > 2 && <button type="button" className="btn-ghost btn-sm" onClick={() => setStops((arr) => arr.filter((_, j) => j !== i))}>Remove stop</button>}
            </div>
          ))}
          <div className="btn-row">
            {stops.length < 10 && <button type="button" className="btn-secondary btn-sm" onClick={() => setStops((s) => [...s.slice(0, -1), null, s[s.length - 1]])}>+ Add stop</button>}
            <button type="button" onClick={compute} disabled={!ready || busy}>{busy ? <><Spinner /> Planning…</> : "Plan route"}</button>
            <button type="button" className="btn-secondary" onClick={save} disabled={!ready}>Save route</button>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
          {plan && (
            <div className="stack" style={{ marginTop: "1em" }}>
              <Callout tone={plan.status === "safe" ? "safe" : plan.status === "caution" ? "caution" : "danger"} title={plan.status === "no_safe_route" ? "A leg has no safe route" : plan.status === "safe" ? "All legs clear" : "Passable with caution"}>
                {route && <span className="mono">{formatDistance(route.distanceM)} · {formatDuration(route.durationS)}</span>}{" "}
                {plan.avoided.length > 0 && <Badge tone="tide">Avoids {plan.avoided.length} flood hazard(s)</Badge>}
              </Callout>
              <p className="small route-explain__text">{plan.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
