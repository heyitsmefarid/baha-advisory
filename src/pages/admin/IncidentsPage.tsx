import React, { useState } from "react";
import { addDoc, collection, doc, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import UpgradeNotice from "../../components/billing/UpgradeNotice";
import { Badge, Callout, EmptyState, Field, Modal, PageHeader, SimulatedBadge, SkeletonRows, Spinner, Tabs, formatDateTime, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useZonesByArea } from "../../hooks/useFloodZones";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useMyOrg } from "../../hooks/useOrg";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { ALERT_SEVERITY, INCIDENT_STATUS } from "../../lib/labels";
import { AREA_NAMES } from "../../../shared/areas";
import type { AlertSeverity, Incident, IncidentStatus, IncidentType, IncidentUpdate } from "../../../shared/types";

type Tab = "incidents" | "zones";
const TYPES: IncidentType[] = ["flood", "road_closure", "rescue", "landslide", "evacuation", "other"];
const STATUSES: IncidentStatus[] = ["open", "responding", "monitoring", "resolved"];

/** Original zone list (kept as-is under its own tab). */
function ZonesTab() {
  const { role, assignedArea } = useAuth();
  const isAdmin = role === "admin";
  const { data: zones, loading } = useZonesByArea(assignedArea, isAdmin);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "cleared">("all");

  const filtered = zones.filter((z) => {
    const matchesSearch = z.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || z.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search zone name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "cleared")}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="cleared">Cleared</option>
        </select>
      </div>
      {loading && <p className="muted">Loading…</p>}
      <div className="zone-table">
        {filtered.map((z) => (
          <div key={z.id} className="zone-table__row">
            <div>
              <strong>{z.name}</strong>
              <div className="muted">{z.area}</div>
            </div>
            <div>{z.waterLevelM.toFixed(2)}m</div>
            <div>{z.status}</div>
            <div>{z.roadPassability.replace("_", " ")}</div>
          </div>
        ))}
        {!loading && filtered.length === 0 && <p className="muted">No matching zones.</p>}
      </div>
    </>
  );
}

function IncidentDetail({ incident, canEdit }: { incident: Incident; canEdit: boolean }) {
  const { currentUser, orgId } = useAuth();
  const toast = useToast();
  const { data: timeline } = useFirestoreCollection<IncidentUpdate>(
    () => query(collection(db, "incidents", incident.id, "timeline"), orderBy("at", "asc")),
    (id, d) => ({ id, ...(d as Omit<IncidentUpdate, "id">) }),
    [incident.id]
  );
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<{ summary: string; keyFacts: string[]; openActions: string[]; risks: string[]; provider: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const name = currentUser?.displayName || currentUser?.email || "DRRM staff";

  const addNote = async (status?: IncidentStatus) => {
    if (!currentUser || (!note.trim() && !status)) return;
    setBusy("note");
    try {
      await addDoc(collection(db, "incidents", incident.id, "timeline"), {
        orgId: orgId, note: note.trim() || `Status changed to ${status}`, status: status ?? null, byUid: currentUser.uid, byName: name, at: serverTimestamp(),
      });
      if (status) {
        await updateDoc(doc(db, "incidents", incident.id), {
          status, updatedAt: serverTimestamp(), resolvedAt: status === "resolved" ? serverTimestamp() : null,
          title: incident.title, type: incident.type, severity: incident.severity, area: incident.area, description: incident.description,
        });
      } else {
        await updateDoc(doc(db, "incidents", incident.id), {
          updatedAt: serverTimestamp(), title: incident.title, type: incident.type, severity: incident.severity, status: incident.status, area: incident.area, description: incident.description,
        });
      }
      setNote("");
    } catch {
      toast("Couldn't update the incident (subscription or permissions).", "danger");
    } finally {
      setBusy(null);
    }
  };

  const summarize = async () => {
    setBusy("ai");
    try {
      setSummary(await api("/ai/incident-summary", { body: { incidentId: incident.id } }));
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };

  const st = INCIDENT_STATUS[incident.status];
  return (
    <div className="stack">
      <div className="panel">
        <div className="spread">
          <span className="row">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone={ALERT_SEVERITY[incident.severity].tone}>{ALERT_SEVERITY[incident.severity].label}</Badge>
            <Badge tone="neutral">{incident.type.replace("_", " ")}</Badge>
            <SimulatedBadge show={!!incident.simulated} />
          </span>
          <span className="tiny">Opened {formatDateTime(incident.createdAt)} by {incident.createdByName}</span>
        </div>
        <h3 style={{ marginTop: "0.6em" }}>{incident.title}</h3>
        <p className="small">{incident.description || "No description."}</p>
        <p className="tiny">
          {incident.area} · {incident.linkedReportIds.length} linked report(s){incident.linkedZoneId ? ` · zone ${incident.linkedZoneId}` : ""}
        </p>
        {canEdit && (
          <div className="row">
            <span className="tiny">Set status:</span>
            {STATUSES.filter((s) => s !== incident.status).map((s) => (
              <button key={s} className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => addNote(s)}>
                {INCIDENT_STATUS[s].label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Situation summary</h3>
          <button className="btn-secondary btn-sm" onClick={summarize} disabled={busy !== null}>
            {busy === "ai" ? <Spinner /> : "Summarize with Baha AI"}
          </button>
        </div>
        {summary ? (
          <div className="ai-block">
            <Badge tone={summary.provider === "simulated" ? "neutral" : "tide"}>{summary.provider === "simulated" ? "Template summary (AI unavailable)" : `AI · ${summary.provider}`}</Badge>
            <p className="small">{summary.summary}</p>
            {summary.keyFacts.length > 0 && (<><strong className="small">Key facts</strong><ul className="small">{summary.keyFacts.map((k) => <li key={k}>{k}</li>)}</ul></>)}
            {summary.openActions.length > 0 && (<><strong className="small">Open actions</strong><ul className="small">{summary.openActions.map((k) => <li key={k}>{k}</li>)}</ul></>)}
            {summary.risks.length > 0 && (<><strong className="small">Risks</strong><ul className="small">{summary.risks.map((k) => <li key={k}>{k}</li>)}</ul></>)}
            <p className="tiny">Generated from this incident's record only. Verify before sharing.</p>
          </div>
        ) : incident.aiSummary ? (
          <p className="small">{incident.aiSummary}</p>
        ) : (
          <p className="tiny">No summary yet.</p>
        )}
      </div>

      <div className="panel">
        <h3 className="panel__title">Timeline</h3>
        <ol className="timeline">
          {timeline.map((t) => (
            <li key={t.id}>
              <span className="tiny mono">{formatDateTime(t.at)}</span>
              <span>{t.note}</span>
              <span className="tiny">{t.byName}</span>
            </li>
          ))}
          {timeline.length === 0 && <li className="tiny">No updates yet.</li>}
        </ol>
        {canEdit && (
          <div className="row" style={{ marginTop: "0.6em" }}>
            <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Add an update (e.g. Rescue team deployed)" />
            <button onClick={() => addNote()} disabled={!note.trim() || busy !== null}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewIncidentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, orgId, assignedArea, areas } = useAuth();
  const toast = useToast();
  const myAreas = [...new Set([assignedArea, ...areas].filter(Boolean))] as string[];
  const [title, setTitle] = useState("");
  const [type, setType] = useState<IncidentType>("flood");
  const [severity, setSeverity] = useState<AlertSeverity>("moderate");
  const [area, setArea] = useState(myAreas[0] ?? AREA_NAMES[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!currentUser || !orgId) return;
    setBusy(true);
    try {
      const ref = await addDoc(collection(db, "incidents"), {
        orgId, title: title.trim(), type, severity, status: "open", area, location: null, description: description.trim(),
        linkedReportIds: [], linkedZoneId: null, assignedTo: [], createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email || "DRRM staff", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), resolvedAt: null, aiSummary: null,
      });
      await addDoc(collection(db, "incidents", ref.id, "timeline"), { orgId, note: "Incident opened.", status: "open", byUid: currentUser.uid, byName: currentUser.displayName || currentUser.email, at: serverTimestamp() });
      toast("Incident opened.", "safe");
      setTitle("");
      setDescription("");
      onClose();
    } catch {
      toast("Couldn't create the incident — incident management needs an active LGU Pro subscription.", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Open an incident" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button onClick={create} disabled={busy || !title.trim()}>{busy ? "Opening…" : "Open incident"}</button></>}>
      <Field label="Title"><input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
      <div className="field-row">
        <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value as IncidentType)}>{TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></Field>
        <Field label="Severity"><select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>{(["info", "moderate", "high", "critical"] as AlertSeverity[]).map((s) => <option key={s} value={s}>{ALERT_SEVERITY[s].label}</option>)}</select></Field>
        <Field label="Area"><select value={area} onChange={(e) => setArea(e.target.value)}>{(myAreas.length ? myAreas : AREA_NAMES).map((a) => <option key={a}>{a}</option>)}</select></Field>
      </div>
      <Field label="Description"><textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Modal>
  );
}

function IncidentsTab() {
  const { orgId, appRole } = useAuth();
  const { entitled, loading: orgLoading } = useMyOrg();
  const { data, loading } = useFirestoreCollection<Incident>(
    () => (orgId ? query(collection(db, "incidents"), where("orgId", "==", orgId), orderBy("createdAt", "desc")) : null),
    (id, d) => ({ id, ...(d as Omit<Incident, "id">) }),
    [orgId]
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canEdit = entitled("incidentManagement");
  const current = data.find((i) => i.id === selected) ?? data[0] ?? null;

  if (!orgId) {
    return <Callout tone="neutral">Incident management is organization-based. Your account isn't linked to an LGU organization{appRole === "super_admin" ? " (Super Admin: open an LGU's data from Organizations)" : ""}.</Callout>;
  }
  if (orgLoading || loading) return <SkeletonRows />;
  return (
    <>
      {!canEdit && <UpgradeNotice feature="incidentManagement" plan="LGU Pro" billingPath="/admin/billing" />}
      <div className="page-head__actions" style={{ marginBottom: "0.8em" }}>
        {canEdit && <button onClick={() => setCreating(true)}>+ Open incident</button>}
      </div>
      {data.length === 0 ? (
        <EmptyState title="No incidents">Open an incident to coordinate a response, track its timeline and link verified reports.</EmptyState>
      ) : (
        <div className="master-detail">
          <ul className="list-plain master-list">
            {data.map((i) => (
              <li key={i.id}>
                <button className={`master-item ${current?.id === i.id ? "master-item--on" : ""}`} onClick={() => setSelected(i.id)}>
                  <span className="row">
                    <Badge tone={INCIDENT_STATUS[i.status].tone}>{INCIDENT_STATUS[i.status].label}</Badge>
                    <Badge tone={ALERT_SEVERITY[i.severity].tone}>{ALERT_SEVERITY[i.severity].label}</Badge>
                    {i.simulated && <Badge tone="sim">Simulated</Badge>}
                  </span>
                  <span className="master-item__title">{i.title}</span>
                  <span className="tiny">{i.area} · {formatDateTime(i.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div>{current && <IncidentDetail incident={current} canEdit={canEdit} />}</div>
        </div>
      )}
      <NewIncidentModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export default function IncidentsPage() {
  const [tab, setTab] = useState<Tab>("incidents");
  return (
    <AdminLayout>
      <div className="page-header">
        <h2>Incidents</h2>
      </div>
      <Tabs<Tab> label="Incident views" value={tab} onChange={setTab} tabs={[{ id: "incidents", label: "Incident management" }, { id: "zones", label: "Flood zones" }]} />
      {tab === "incidents" ? <IncidentsTab /> : <ZonesTab />}
    </AdminLayout>
  );
}
