import React, { useState } from "react";
import { Marker, Tooltip } from "react-leaflet";
import { collection, doc, limit, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import BaseMap, { FitBounds } from "../../components/map/BaseMap";
import HazardLayer from "../../components/map/HazardLayer";
import { sosIcon } from "../../components/map/markers";
import { Badge, Callout, EmptyState, PageHeader, SimulatedBadge, Tabs, formatDateTime, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useJurisdictionCollection } from "../../hooks/useJurisdictionCollection";
import { useOfficialHazards } from "../../hooks/useOfficialData";
import { db } from "../../firebase";
import { toPt } from "../../../shared/geo";
import { formatAge, toMillis } from "../../../shared/time";
import type { SosRequest } from "../../../shared/types";

type View = "active" | "resolved";

export default function SosQueuePage() {
  const { currentUser } = useAuth();
  const hazards = useOfficialHazards();
  const toast = useToast();
  const [view, setView] = useState<View>("active");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, error } = useJurisdictionCollection<SosRequest>(
    "sos_requests",
    () => [
      where("status", "in", view === "active" ? ["open", "acknowledged"] : ["resolved", "cancelled"]),
      orderBy("createdAt", "desc"),
    ],
    (id, d) => ({ id, ...(d as Omit<SosRequest, "id">) }),
    [view],
    100,
  );

  const respond = async (s: SosRequest, status: "acknowledged" | "resolved") => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, "sos_requests", s.id), {
        status,
        acknowledgedBy: currentUser.uid,
        acknowledgedByName: currentUser.displayName || currentUser.email || "DRRM responder",
        responderNote: notes[s.id]?.slice(0, 500) ?? s.responderNote ?? "",
        updatedAt: serverTimestamp(),
      });
      toast(status === "acknowledged" ? "Requester notified that help is confirmed." : "SOS marked resolved.", "safe");
    } catch {
      toast("Couldn't update this SOS.", "danger");
    }
  };

  return (
    <AdminLayout>
      <PageHeader title="SOS requests" subtitle="Live help requests with location. Acknowledging tells the person a responder has confirmed — only do so when help is actually assigned." />
      <Tabs<View> label="SOS views" value={view} onChange={setView} tabs={[{ id: "active", label: "Active", count: view === "active" ? data.length : undefined }, { id: "resolved", label: "Closed" }]} />
      {error && <Callout tone="danger">{error}</Callout>}
      {data.length === 0 ? (
        <EmptyState title={view === "active" ? "No active SOS requests" : "No closed requests"}>New requests appear here instantly.</EmptyState>
      ) : (
        <div className="grid-2">
          <ul className="list-plain stack">
            {data.map((s) => (
              <li key={s.id} className={`panel sos-row sos-row--${s.status}`}>
                <div className="spread">
                  <span className="row">
                    <Badge tone={s.status === "open" ? "danger" : s.status === "acknowledged" ? "caution" : "neutral"}>{s.status}</Badge>
                    <strong>{s.area}</strong>
                    <SimulatedBadge show={!!s.simulated} />
                  </span>
                  <span className="tiny" title={formatDateTime(s.createdAt)}>{formatAge(toMillis(s.createdAt))}</span>
                </div>
                <p className="small">{s.message}</p>
                <p className="tiny mono">
                  {s.location.lat.toFixed(5)}, {s.location.lng.toFixed(5)} (±{s.accuracyM ?? "?"} m) · {s.peopleCount ?? 1} person(s)
                  {s.phone ? <> · <a href={`tel:${s.phone}`}>{s.phone}</a></> : null}
                </p>
                {s.status === "acknowledged" && <p className="tiny">Acknowledged by {s.acknowledgedByName}{s.responderNote ? ` — "${s.responderNote}"` : ""}</p>}
                {(s.status === "open" || s.status === "acknowledged") && (
                  <>
                    <input placeholder="Message to the requester (e.g. Rescue boat en route, ETA 20 min)" maxLength={500} value={notes[s.id] ?? ""} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
                    <div className="btn-row" style={{ marginTop: "0.5em" }}>
                      {s.status === "open" && <button className="btn-safe" onClick={() => respond(s, "acknowledged")}>Acknowledge — help assigned</button>}
                      <button className="btn-secondary" onClick={() => respond(s, "resolved")}>Mark resolved</button>
                      <a className="chip-btn" href={`/navigate?to=${s.location.lat},${s.location.lng}&toName=SOS&mode=car`}>Route there</a>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="verify-map verify-map--tall">
            <BaseMap className="leaflet-map">
              <HazardLayer zones={hazards.zones} roads={hazards.roads} />
              {data.map((s) => (
                <Marker key={s.id} position={toPt(s.location)} icon={sosIcon()}>
                  <Tooltip>{s.message}</Tooltip>
                </Marker>
              ))}
              <FitBounds points={data.map((s) => toPt(s.location))} fitKey={data.map((s) => s.id).join(",")} />
            </BaseMap>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
