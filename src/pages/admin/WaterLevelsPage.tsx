import React, { useState } from "react";
import { addDoc, collection, doc, limit, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import LocationPicker, { type PickedLocation } from "../../components/map/LocationPicker";
import { LineChart } from "../../components/charts/Charts";
import { stationLevelColor, useStations } from "../../components/map/PublicLayers";
import { Badge, Callout, EmptyState, Field, Freshness, Modal, PageHeader, SimulatedBadge, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { db } from "../../firebase";
import { canManageArea } from "../../../shared/roles";
import { AREA_NAMES } from "../../../shared/areas";
import { toMillis } from "../../../shared/time";
import type { WaterLevelReading, WaterLevelStation } from "../../../shared/types";

function StationDetail({ s }: { s: WaterLevelStation }) {
  const { currentUser, role, assignedArea, areas } = useAuth();
  const toast = useToast();
  const canEdit = canManageArea({ role, assignedArea, areas }, s.area);
  const { data } = useFirestoreCollection<WaterLevelReading>(
    () => query(collection(db, "water_level_stations", s.id, "readings"), orderBy("recordedAt", "desc"), limit(48)),
    (id, d) => ({ id, ...(d as Omit<WaterLevelReading, "id">) }),
    [s.id]
  );
  const [level, setLevel] = useState("");
  const rows = [...data].reverse();
  const st = stationLevelColor(s);

  const addReading = async () => {
    const v = Number(level);
    if (!currentUser || !Number.isFinite(v) || v < 0 || v > 30) return toast("Enter a level between 0 and 30 m.", "caution");
    try {
      await addDoc(collection(db, "water_level_stations", s.id, "readings"), { levelM: v, recordedAt: serverTimestamp(), source: "manual", enteredBy: currentUser.uid });
      await updateDoc(doc(db, "water_level_stations", s.id), { lastLevelM: v, lastReadingAt: serverTimestamp() });
      setLevel("");
      toast("Reading recorded.", "safe");
    } catch {
      toast("Couldn't record the reading.", "danger");
    }
  };

  return (
    <div className="panel">
      <div className="spread">
        <div>
          <h3 className="panel__title">{s.name}</h3>
          <span className="tiny">{s.riverName} · {s.area}</span>
        </div>
        <span className="row">
          <Badge tone={st.label === "Normal" ? "safe" : st.label === "Alert" ? "caution" : st.label === "Alarm" ? "danger" : "closed"}>{st.label}</Badge>
          <SimulatedBadge show={!!s.simulated || s.source === "simulated"} />
        </span>
      </div>
      <p className="small">
        Latest: <strong className="mono">{s.lastLevelM?.toFixed(2) ?? "—"} m</strong> · <Freshness at={s.lastReadingAt} /> · thresholds alert {s.thresholds.alertM} m / alarm {s.thresholds.alarmM} m / critical {s.thresholds.criticalM} m
      </p>
      {rows.length > 1 ? (
        <LineChart
          title={`${s.name} water level, last ${rows.length} readings`}
          labels={rows.map((r) => new Date(toMillis(r.recordedAt) ?? 0).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }))}
          series={[{ name: "Water level", color: "var(--viz-mag)", values: rows.map((r) => r.levelM) }]}
          unit=" m"
          area
          yMax={Math.max(s.thresholds.criticalM * 1.1, ...rows.map((r) => r.levelM))}
          bands={[
            { from: s.thresholds.alertM, to: s.thresholds.alarmM, color: "#e08a1e", label: "alert" },
            { from: s.thresholds.alarmM, to: s.thresholds.criticalM, color: "#d64545", label: "alarm" },
            { from: s.thresholds.criticalM, to: s.thresholds.criticalM * 1.1, color: "#7a1f2b", label: "critical" },
          ]}
        />
      ) : (
        <p className="tiny">Not enough readings to chart yet.</p>
      )}
      <p className="tiny">Shaded bands: alert, alarm and critical stages. Sensor feeds post to /api/ingest/water-level.</p>
      {canEdit && (
        <div className="row">
          <input type="number" step={0.01} min={0} max={30} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Manual reading (m)" style={{ maxWidth: 200 }} />
          <button onClick={addReading} disabled={!level}>Record reading</button>
        </div>
      )}
    </div>
  );
}

export default function WaterLevelsPage() {
  const { role, assignedArea, areas, appRole } = useAuth();
  const toast = useToast();
  const { data: stations } = useStations();
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; river: string; area: string; loc: PickedLocation | null; alert: number; alarm: number; critical: number } | null>(null);
  const current = stations.find((s) => s.id === selected) ?? stations[0];
  const myAreas = appRole === "super_admin" || role === "admin" ? AREA_NAMES : ([...new Set([assignedArea, ...areas].filter(Boolean))] as string[]);

  const createStation = async () => {
    if (!form?.loc || !form.name.trim()) return toast("Name the station and place it on the map.", "caution");
    if (!(form.alert < form.alarm && form.alarm < form.critical)) return toast("Thresholds must increase: alert < alarm < critical.", "caution");
    try {
      await setDoc(doc(collection(db, "water_level_stations")), {
        name: form.name.trim(), riverName: form.river.trim(), area: form.area, location: { lat: form.loc.point[0], lng: form.loc.point[1] },
        thresholds: { alertM: form.alert, alarmM: form.alarm, criticalM: form.critical }, source: "manual", active: true, lastLevelM: null, lastReadingAt: null,
      });
      toast("Station added.", "safe");
      setForm(null);
    } catch {
      toast("Couldn't add the station (check the area is in your jurisdiction).", "danger");
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Water levels"
        subtitle="River gauges feed the public map and the experimental risk outlook. Record manual readings or connect sensors via the ingest API."
        actions={<button onClick={() => setForm({ name: "", river: "", area: myAreas[0] ?? AREA_NAMES[0], loc: null, alert: 2, alarm: 3, critical: 4 })}>+ Add station</button>}
      />
      {stations.length === 0 ? (
        <EmptyState title="No stations yet">Add your river gauges to track levels against alert thresholds.</EmptyState>
      ) : (
        <div className="master-detail">
          <ul className="list-plain master-list">
            {stations.map((s) => {
              const st = stationLevelColor(s);
              return (
                <li key={s.id}>
                  <button className={`master-item ${current?.id === s.id ? "master-item--on" : ""}`} onClick={() => setSelected(s.id)}>
                    <span className="spread">
                      <strong className="small">{s.name}</strong>
                      <span className="mono small">{s.lastLevelM?.toFixed(2) ?? "—"} m</span>
                    </span>
                    <span className="row tiny">
                      <span className="legend-swatch" style={{ background: st.color }} /> {st.label} · {s.area}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div>{current && <StationDetail s={current} />}</div>
        </div>
      )}
      <Modal open={form !== null} title="Add water-level station" onClose={() => setForm(null)} wide footer={<><button className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button onClick={createStation}>Add station</button></>}>
        {form && (
          <div className="grid-2">
            <div>
              <Field label="Station name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="River / water body"><input value={form.river} onChange={(e) => setForm({ ...form, river: e.target.value })} /></Field>
              <Field label="Area"><select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>{myAreas.map((a) => <option key={a}>{a}</option>)}</select></Field>
              <div className="field-row">
                <Field label="Alert (m)"><input type="number" step={0.1} value={form.alert} onChange={(e) => setForm({ ...form, alert: Number(e.target.value) })} /></Field>
                <Field label="Alarm (m)"><input type="number" step={0.1} value={form.alarm} onChange={(e) => setForm({ ...form, alarm: Number(e.target.value) })} /></Field>
                <Field label="Critical (m)"><input type="number" step={0.1} value={form.critical} onChange={(e) => setForm({ ...form, critical: Number(e.target.value) })} /></Field>
              </div>
              <Callout tone="neutral">Use thresholds from your LGU's or DPWH's river monitoring guidelines.</Callout>
            </div>
            <LocationPicker value={form.loc} onChange={(l) => setForm({ ...form, loc: l })} height={300} />
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
