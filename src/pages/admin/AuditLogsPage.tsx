import React, { useState } from "react";
import { collection, collectionGroup, orderBy, query, limit, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import { Tabs, formatDateTime } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../firebase";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { ZoneHistoryEntry } from "../../types";
import type { AuditLogEntry } from "../../../shared/types";

/** Original zone-change log (zoneHistory), unchanged. */
function ZoneChanges() {
  const [editorFilter, setEditorFilter] = useState("");
  const { data: entries, loading } = useFirestoreCollection<ZoneHistoryEntry>(
    () => query(collectionGroup(db, "updates"), orderBy("timestamp", "desc"), limit(200)),
    (id, data) => ({ id, zoneId: "", ...(data as Omit<ZoneHistoryEntry, "id" | "zoneId">) }),
    []
  );

  const filtered = entries.filter((e) =>
    editorFilter ? e.editorName.toLowerCase().includes(editorFilter.toLowerCase()) : true
  );

  return (
    <>
      <div className="filter-bar">
        <input
          placeholder="Filter by editor…"
          value={editorFilter}
          onChange={(e) => setEditorFilter(e.target.value)}
        />
      </div>
      {loading && <p className="muted">Loading…</p>}
      <table className="audit-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Zone</th>
            <th>Action</th>
            <th>Editor</th>
            <th>Changed fields</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr key={e.id}>
              <td>{formatDateTime(e.timestamp)}</td>
              <td>{e.zoneName}</td>
              <td>{e.action}</td>
              <td>{e.editorName}</td>
              <td className="audit-table__fields">
                {Object.keys(e.changedFields ?? {}).join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && filtered.length === 0 && <p className="muted">No log entries.</p>}
    </>
  );
}

/** Server-written audit trail for this organization (staff, billing, verification, alerts). */
function OrgActivity({ orgId }: { orgId: string }) {
  const { data, loading } = useFirestoreCollection<AuditLogEntry>(
    () => query(collection(db, "audit_logs"), where("orgId", "==", orgId), orderBy("at", "desc"), limit(200)),
    (id, d) => ({ id, ...(d as Omit<AuditLogEntry, "id">) }),
    [orgId]
  );
  return (
    <>
      {loading && <p className="muted">Loading…</p>}
      <table className="audit-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>By</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {data.map((l) => (
            <tr key={l.id}>
              <td>{formatDateTime(l.at)}</td>
              <td className="audit-table__fields">{l.action}</td>
              <td>{l.actorName ?? l.actorUid}</td>
              <td className="audit-table__fields">{l.targetType}/{l.targetId}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && data.length === 0 && <p className="muted">No organization activity yet.</p>}
    </>
  );
}

export default function AuditLogsPage() {
  const { orgId } = useAuth();
  const [tab, setTab] = useState<"zones" | "org">("zones");
  return (
    <AdminLayout>
      <h2>Audit Logs</h2>
      {orgId && (
        <Tabs
          label="Audit log views"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "zones", label: "Zone changes" },
            { id: "org", label: "Organization activity" },
          ]}
        />
      )}
      {tab === "org" && orgId ? <OrgActivity orgId={orgId} /> : <ZoneChanges />}
    </AdminLayout>
  );
}
