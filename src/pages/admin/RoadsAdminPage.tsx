import React, { useState } from "react";
import { Polyline } from "react-leaflet";
import { addDoc, collection, doc, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import BaseMap from "../../components/map/BaseMap";
import HazardLayer from "../../components/map/HazardLayer";
import LineDrawer from "../../components/admin/LineDrawer";
import { Badge, Callout, DataTable, Field, Freshness, PageHeader, SimulatedBadge, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useOfficialHazards, roadPath } from "../../hooks/useOfficialData";
import { db } from "../../firebase";
import { logZoneChange } from "../../services/historyService";
import { canManageArea } from "../../../shared/roles";
import { AREA_NAMES } from "../../../shared/areas";
import { tuplesToFirestore } from "../../../shared/geoFirestore";
import { suggestPassability } from "../../utils/passability";
import { VEHICLE_LABELS, type VehicleKey, type VehiclePassability } from "../../types";
import type { RoadCondition, RoadConditionStatus } from "../../../shared/types";
import { geographicReferenceForArea } from "../../lib/geographicReference";

const ALL_BLOCKED: VehiclePassability = { bike: false, motor: false, fourWheel: false, suvPickup: false, truck: false };

/**
 * Official road closures / caution segments. These feed flood-aware
 * navigation directly: a closed segment is avoided by every vehicle,
 * a caution segment only by vehicles marked not passable.
 */
export default function RoadsAdminPage() {
  const { currentUser, role, assignedArea, areas, appRole } = useAuth();
  const claims = { role, assignedArea, areas };
  const toast = useToast();
  const hazards = useOfficialHazards();
  const { data } = useFirestoreCollection<RoadCondition>(
    () => query(collection(db, "road_conditions"), orderBy("updatedAt", "desc")),
    (id, d) => ({ id, ...(d as Omit<RoadCondition, "id">) }),
    []
  );
  const myAreas = appRole === "super_admin" || role === "admin" ? AREA_NAMES : ([...new Set([assignedArea, ...areas].filter(Boolean))] as string[]);
  const [path, setPath] = useState<[number, number][]>([]);
  const [name, setName] = useState("");
  const [area, setArea] = useState(myAreas[0] ?? "");
  const [status, setStatus] = useState<RoadConditionStatus>("closed");
  const [reason, setReason] = useState("");
  const [passability, setPassability] = useState<VehiclePassability>(suggestPassability(0.55));
  const [hours, setHours] = useState(12);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorName = currentUser?.displayName || currentUser?.email || "DRRM staff";

  const publish = async () => {
    if (!currentUser) return;
    setError(null);
    if (path.length < 2) return setError("Trace the affected road segment on the map with the line tool.");
    if (!name.trim()) return setError("Name the road segment.");
    if (!canManageArea(claims, area)) return setError(`You can't publish road conditions for ${area}.`);
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "road_conditions"), {
        ...geographicReferenceForArea(area, currentUser.uid),
        name: name.trim(),
        path: tuplesToFirestore(path),
        status,
        passability: status === "closed" ? ALL_BLOCKED : passability,
        reason: reason.trim() || (status === "closed" ? "Closed due to flooding" : "Flooded — caution"),
        area,
        source: "drrm",
        active: true,
        updatedBy: currentUser.uid,
        updatedByName: editorName,
        updatedAt: serverTimestamp(),
        expiresAt: hours > 0 ? new Date(Date.now() + hours * 3600_000) : null,
      });
      await logZoneChange({ zoneId: `road_${ref.id}`, zoneName: name.trim(), changedFields: { status, area }, editorUid: currentUser.uid, editorName, action: "created" });
      toast("Road condition published — navigation will route around it.", "safe");
      setPath([]);
      setName("");
      setReason("");
    } catch (err) {
      console.error(err);
      setError("Couldn't publish. Check that the area is within your jurisdiction.");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (r: RoadCondition, active: boolean) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, "road_conditions", r.id), { active, updatedBy: currentUser.uid, updatedByName: editorName, updatedAt: serverTimestamp() });
      await logZoneChange({ zoneId: `road_${r.id}`, zoneName: r.name, changedFields: { active }, editorUid: currentUser.uid, editorName, action: active ? "updated" : "cleared" });
    } catch {
      toast("Couldn't update this road.", "danger");
    }
  };

  return (
    <AdminLayout>
      <PageHeader title="Road closures" subtitle="Publish verified closures and caution segments. Changes reach flood-aware navigation within seconds and trigger automatic re-routing." />
      <div className="zone-form">
        <div>
          <div className="verify-map verify-map--tall">
            <BaseMap className="leaflet-map">
              <HazardLayer zones={hazards.zones} roads={hazards.roads} />
              <LineDrawer onDrawn={setPath} />
              {path.length >= 2 && <Polyline positions={path} pathOptions={{ color: "#7a1f2b", weight: 7, dashArray: "2 10" }} />}
            </BaseMap>
          </div>
          <p className="zone-form__hint">Use the line tool (top-left) to trace the affected stretch of road. Double-tap/click to finish.</p>
        </div>
        <div className="zone-form__fields">
          <Field label="Road segment name"><input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bucayao Road from the bridge to the chapel" /></Field>
          <div className="field-row">
            <Field label="Area">
              <select value={area} onChange={(e) => setArea(e.target.value)}>{myAreas.map((a) => <option key={a}>{a}</option>)}</select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as RoadConditionStatus)}>
                <option value="closed">Closed to all vehicles</option>
                <option value="caution">Caution — some vehicles</option>
              </select>
            </Field>
          </div>
          {status === "caution" && (
            <div className="field">
              <span className="field__label">Vehicles that can still pass</span>
              <div className="vehicle-toggle-grid">
                {(Object.keys(VEHICLE_LABELS) as VehicleKey[]).map((k) => (
                  <label key={k} className="vehicle-toggle"><input type="checkbox" checked={passability[k]} onChange={() => setPassability((p) => ({ ...p, [k]: !p[k] }))} />{VEHICLE_LABELS[k]}</label>
                ))}
              </div>
            </div>
          )}
          <Field label="Reason (shown to the public)"><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waist-deep water, strong current" /></Field>
          <Field label="Auto-expire after (hours, 0 = never)" hint="Expired closures stop affecting routes automatically."><input type="number" min={0} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
          {error && <Callout tone="danger">{error}</Callout>}
          <button onClick={publish} disabled={saving}>{saving ? "Publishing…" : "Publish road condition"}</button>
        </div>
      </div>

      <h3 className="section-heading">Published road conditions</h3>
      <DataTable
        rows={data}
        rowKey={(r) => r.id}
        empty="No road conditions published."
        columns={[
          { key: "n", header: "Road", render: (r) => (<div><strong>{r.name}</strong><div className="tiny">{r.area} · {r.reason}</div></div>) },
          { key: "s", header: "Status", render: (r) => (<span className="row"><Badge tone={r.status === "closed" ? "closed" : "caution"}>{r.status}</Badge>{!r.active && <Badge tone="neutral">inactive</Badge>}<SimulatedBadge show={!!r.simulated} /></span>) },
          { key: "len", header: "Points", render: (r) => <span className="mono">{roadPath(r).length}</span> },
          { key: "u", header: "Updated", render: (r) => <Freshness at={r.updatedAt} prefix="" /> },
          { key: "a", header: "", render: (r) => canManageArea(claims, r.area) ? (
            <button className="btn-secondary btn-sm" onClick={() => setActive(r, !r.active)}>{r.active ? "Reopen road" : "Re-activate"}</button>
          ) : null },
        ]}
      />
    </AdminLayout>
  );
}
