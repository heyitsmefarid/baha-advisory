import React, { useEffect, useMemo, useState } from "react";
import { Circle, Marker, Tooltip } from "react-leaflet";
import { collection, doc, getDoc, limit, orderBy, query, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import BaseMap, { FitBounds } from "../../components/map/BaseMap";
import HazardLayer from "../../components/map/HazardLayer";
import { pinIcon, reportIcon } from "../../components/map/markers";
import ReportPhoto from "../../components/reports/ReportPhoto";
import AiAnalysisCard, { type AiView } from "../../components/reports/AiAnalysisCard";
import { Badge, Callout, EmptyState, Field, PageHeader, SimulatedBadge, SkeletonRows, Spinner, Tabs, formatDateTime, formatDistance, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useJurisdictionCollection } from "../../hooks/useJurisdictionCollection";
import { useOfficialHazards } from "../../hooks/useOfficialData";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { REPORT_STATUS } from "../../lib/labels";
import { canManageArea } from "../../../shared/roles";
import { SUSPICIOUS_FLAG_LABELS } from "../../../shared/reports";
import { suggestPassability, suggestRoadPassability, formatWaterLevel } from "../../utils/passability";
import { PASSABILITY_LABELS, type RoadPassability } from "../../types";
import { DEPTH_LABEL_METERS, DEPTH_LABEL_TEXT, type CommunityReport, type ReportStatus } from "../../../shared/types";
import { centroid, haversineM, toPt } from "../../../shared/geo";

type Queue = "pending" | "verified" | "closed";

const QUEUE_STATUSES: Record<Queue, ReportStatus[]> = {
  pending: ["pending", "needs_info"],
  verified: ["verified"],
  closed: ["rejected", "duplicate"],
};

function useReports(queue: Queue) {
  return useJurisdictionCollection<CommunityReport>(
    "community_reports",
    () => [where("status", "in", QUEUE_STATUSES[queue]), orderBy("createdAt", "desc")],
    (id, d) => ({ id, ...(d as Omit<CommunityReport, "id">) }),
    [queue],
    100,
  );
}

function ActionPanel({ report, onDone }: { report: CommunityReport; onDone: () => void }) {
  const { role, assignedArea, areas, appRole } = useAuth();
  const claims = { role, assignedArea, areas };
  const hazards = useOfficialHazards();
  const toast = useToast();
  const allowed = canManageArea(claims, report.area);
  const nearby = useMemo(
    () =>
      hazards.zones
        .map((z) => ({ z, d: haversineM(toPt(report.location), z.geometry.type === "polygon" ? centroid(z.geometry.coordinates) : z.geometry.center) }))
        .filter((x) => x.d < 1500 && canManageArea(claims, x.z.area))
        .sort((a, b) => a.d - b.d),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hazards.zones, report.id]
  );
  const defaultLevel = report.estimatedDepthM ?? DEPTH_LABEL_METERS[report.ai?.depthEstimate ?? "unknown"] ?? 0.3;
  const [mode, setMode] = useState<"create_zone" | "update_zone" | "none">(nearby[0] && nearby[0].d < 300 ? "update_zone" : "create_zone");
  const [zoneId, setZoneId] = useState(nearby[0]?.z.id ?? "");
  const [level, setLevel] = useState<number>(defaultLevel);
  const [road, setRoad] = useState<RoadPassability>(suggestRoadPassability(defaultLevel));
  const [radius, setRadius] = useState(150);
  const [publishAlert, setPublishAlert] = useState(true);
  const [alertRadius, setAlertRadius] = useState(2000);
  const [note, setNote] = useState("");
  const [dupOf, setDupOf] = useState(report.duplicateCandidates?.[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setRoad(suggestRoadPassability(level)), [level]);

  const act = async (action: "verify" | "reject" | "mark_duplicate" | "request_info") => {
    setBusy(action);
    try {
      const res = await api<{ status: string; linkedZoneId: string | null; alert: { matchedUsers: number; pushNote: string } | null }>(
        `/reports/${report.id}/verify`,
        {
          body: {
            action,
            note,
            duplicateOf: action === "mark_duplicate" ? dupOf : undefined,
            apply: action === "verify" ? { mode, zoneId, waterLevelM: level, roadPassability: road, passability: suggestPassability(level), radiusM: radius } : undefined,
            publishAlert: action === "verify" && publishAlert,
            alertRadiusM: alertRadius,
          },
        }
      );
      toast(
        action === "verify"
          ? `Verified${res.linkedZoneId ? " — map & navigation updated" : ""}${res.alert ? ` — alert sent to ${res.alert.matchedUsers} nearby user(s)` : ""}.`
          : `Report marked ${res.status.replace("_", " ")}.`,
        "safe"
      );
      onDone();
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <Callout tone="neutral" title="Outside your jurisdiction">
        This report is in {report.area}. Only DRRM staff responsible for {report.area} can moderate it{appRole === "lgu_staff" ? "" : " (ask your administrator to add the area)"}.
      </Callout>
    );
  }
  if (report.status !== "pending" && report.status !== "needs_info") {
    return <Callout tone="neutral">This report has already been moderated.</Callout>;
  }

  return (
    <div className="panel action-panel">
      <h3 className="panel__title">Verify this report</h3>
      <div className="field">
        <span className="field__label">Effect on the official map</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="create_zone">Create a new flood zone here</option>
          <option value="update_zone" disabled={!nearby.length}>
            Update a nearby flood zone{nearby.length ? "" : " (none within 1.5 km)"}
          </option>
          <option value="none">Verify only — don't change the map</option>
        </select>
      </div>
      {mode === "update_zone" && (
        <Field label="Zone to update">
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            {nearby.map(({ z, d }) => (
              <option key={z.id} value={z.id}>
                {z.name} — {formatDistance(d)} away, now {z.waterLevelM.toFixed(2)} m
              </option>
            ))}
          </select>
        </Field>
      )}
      {mode !== "none" && (
        <>
          <div className="field-row">
            <Field label="Verified water level (m)" hint={formatWaterLevel(level)}>
              <input type="number" min={0} max={15} step={0.05} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
            </Field>
            {mode === "create_zone" && (
              <Field label="Zone radius (m)">
                <input type="number" min={30} max={2000} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
              </Field>
            )}
          </div>
          <Field label="Road passability" hint="Auto-suggested from the MMDA gauge; adjust from field information.">
            <select value={road} onChange={(e) => setRoad(e.target.value as RoadPassability)}>
              {(Object.keys(PASSABILITY_LABELS) as RoadPassability[]).map((k) => (
                <option key={k} value={k}>
                  {PASSABILITY_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <label className="check-row">
        <input type="checkbox" checked={publishAlert} onChange={(e) => setPublishAlert(e.target.checked)} /> Alert nearby residents
      </label>
      {publishAlert && (
        <Field label="Alert radius (m)">
          <input type="number" min={200} max={20000} step={100} value={alertRadius} onChange={(e) => setAlertRadius(Number(e.target.value))} />
        </Field>
      )}
      <Field label="Note to reporter / log (optional)">
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed by barangay tanod" />
      </Field>
      <div className="btn-row">
        <button type="button" className="btn-safe" disabled={!!busy || (mode === "update_zone" && !zoneId)} onClick={() => act("verify")}>
          {busy === "verify" ? <Spinner /> : "Verify"}
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => act("request_info")}>
          Request info
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => act("reject")}>
          Reject
        </button>
      </div>
      {(report.duplicateCandidates?.length ?? 0) > 0 && (
        <div className="row" style={{ marginTop: "0.6em" }}>
          <select value={dupOf} onChange={(e) => setDupOf(e.target.value)} style={{ width: "auto" }}>
            {report.duplicateCandidates!.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary btn-sm" disabled={!!busy || !dupOf} onClick={() => act("mark_duplicate")}>
            Mark as duplicate
          </button>
        </div>
      )}
    </div>
  );
}

function ReportDetail({ report, others, onDone }: { report: CommunityReport; others: CommunityReport[]; onDone: () => void }) {
  const hazards = useOfficialHazards();
  const [full, setFull] = useState<AiView | null>(null);
  useEffect(() => {
    setFull(null);
    if (!report.ai?.analysisId) return;
    getDoc(doc(db, "ai_analysis_results", report.ai.analysisId)).then((snap) => {
      const r = snap.get("result") as Record<string, unknown> | undefined;
      if (r) setFull({ ...(report.ai as AiView), hazards: r.hazards as string[], rationale: r.rationale as string, consistencyNotes: r.consistencyNotes as string });
    }).catch(() => undefined);
  }, [report.id, report.ai]);
  const s = REPORT_STATUS[report.status];
  const p = toPt(report.location);
  const dups = others.filter((o) => report.duplicateCandidates?.includes(o.id));

  return (
    <div className="stack">
      <div className="panel">
        <div className="spread">
          <div className="row">
            <Badge tone={s.tone}>{s.label}</Badge>
            <SimulatedBadge show={!!report.simulated} />
            <Badge tone="neutral">{report.area}</Badge>
          </div>
          <span className="tiny">{formatDateTime(report.observedAt)}</span>
        </div>
        <ReportPhoto reportId={report.id} photoUrl={report.photoUrl} storage={report.photoStorage} alt="Reported flood photo" className="report-photo report-photo--large" />
        <p className="report-desc">{report.description}</p>
        <dl className="kv">
          <div><dt>Reported depth</dt><dd>{DEPTH_LABEL_TEXT[report.depthLabel]}</dd></div>
          <div><dt>Road</dt><dd>{report.roadName || "—"}{report.roadBlocked ? " · vehicles can't pass" : ""}</dd></div>
          <div><dt>Location</dt><dd className="mono">{report.locationSource === "gps" ? `GPS ±${report.locationAccuracyM ?? "?"} m` : "Placed on map"}</dd></div>
          <div><dt>Reporter</dt><dd className="mono">{report.reporterUid.slice(0, 8)}…</dd></div>
        </dl>
        {(report.suspiciousFlags?.length ?? 0) > 0 && (
          <Callout tone="caution" title="Check before verifying">
            <ul className="list-plain">
              {report.suspiciousFlags!.map((f) => (
                <li key={f}>• {SUSPICIOUS_FLAG_LABELS[f] ?? f}</li>
              ))}
            </ul>
          </Callout>
        )}
        {report.ai && <AiAnalysisCard ai={full ?? (report.ai as AiView)} />}
      </div>

      <div className="verify-map">
        <BaseMap className="leaflet-map">
          <HazardLayer zones={hazards.zones} roads={hazards.roads} />
          {others.filter((o) => o.id !== report.id).map((o) => (
            <Marker key={o.id} position={toPt(o.location)} icon={reportIcon(dups.includes(o) ? "#e08a1e" : "#7d90a6")}>
              <Tooltip>{dups.includes(o) ? "Possible duplicate: " : ""}{o.description.slice(0, 80)}</Tooltip>
            </Marker>
          ))}
          <Marker position={p} icon={pinIcon("#d64545", "!")} />
          {report.locationAccuracyM && report.locationAccuracyM < 1500 && <Circle center={p} radius={report.locationAccuracyM} pathOptions={{ weight: 1 }} />}
          <FitBounds points={[p, ...dups.map((d) => toPt(d.location))]} fitKey={report.id} maxZoom={16} />
        </BaseMap>
      </div>
      {dups.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">Possible duplicates</h3>
          {dups.map((d) => (
            <p key={d.id} className="small">
              <Badge tone={REPORT_STATUS[d.status].tone}>{REPORT_STATUS[d.status].label}</Badge> {formatDistance(haversineM(p, toPt(d.location)))} away ·{" "}
              {formatDateTime(d.createdAt)} — {d.description}
            </p>
          ))}
        </div>
      )}
      <ActionPanel key={report.id} report={report} onDone={onDone} />
    </div>
  );
}

export default function VerificationPage() {
  const [queue, setQueue] = useState<Queue>("pending");
  const { data, loading, error } = useReports(queue);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && data.length) setSelectedId(data[0].id);
  }, [data, selectedId]);

  return (
    <AdminLayout>
      <PageHeader
        title="Report verification"
        subtitle="Community reports never change the official map until a DRRM officer verifies them here. AI analysis is a suggestion, not a decision."
      />
      <Tabs<Queue>
        label="Report queues"
        value={queue}
        onChange={(q) => {
          setQueue(q);
          setSelectedId(null);
        }}
        tabs={[
          { id: "pending", label: "Needs review", count: queue === "pending" ? data.length : undefined },
          { id: "verified", label: "Verified" },
          { id: "closed", label: "Rejected & duplicates" },
        ]}
      />
      {error && <Callout tone="danger">{error}</Callout>}
      {loading ? (
        <SkeletonRows rows={5} />
      ) : data.length === 0 ? (
        <EmptyState title={queue === "pending" ? "No reports waiting" : "Nothing here yet"}>
          {queue === "pending" ? "New community reports appear here in real time." : "Moderated reports will show up here."}
        </EmptyState>
      ) : (
        <div className="master-detail">
          <ul className="list-plain master-list" aria-label="Reports">
            {data.map((r) => (
              <li key={r.id}>
                <button type="button" className={`master-item ${selectedId === r.id ? "master-item--on" : ""}`} onClick={() => setSelectedId(r.id)}>
                  <span className="row">
                    <Badge tone={REPORT_STATUS[r.status].tone}>{REPORT_STATUS[r.status].label}</Badge>
                    {r.photoUrl && <Badge tone="neutral">Photo</Badge>}
                    {(r.suspiciousFlags?.length ?? 0) > 0 && <Badge tone="caution">{r.suspiciousFlags!.length} flag(s)</Badge>}
                    {(r.duplicateCandidates?.length ?? 0) > 0 && <Badge tone="info">Possible duplicate</Badge>}
                    {r.simulated && <Badge tone="sim">Simulated</Badge>}
                  </span>
                  <span className="master-item__title">{r.description}</span>
                  <span className="tiny">
                    {r.area} · {DEPTH_LABEL_TEXT[r.depthLabel]} · {formatDateTime(r.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="master-detail__pane">{selected ? <ReportDetail report={selected} others={data} onDone={() => setSelectedId(null)} /> : <EmptyState title="Select a report" />}</div>
        </div>
      )}
    </AdminLayout>
  );
}
