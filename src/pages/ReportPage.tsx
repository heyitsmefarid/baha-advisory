import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, orderBy, query, where } from "firebase/firestore";
import AppShell from "../components/layout/AppShell";
import LocationPicker, { type PickedLocation } from "../components/map/LocationPicker";
import DepthPicker from "../components/reports/DepthPicker";
import AiAnalysisCard from "../components/reports/AiAnalysisCard";
import ReportPhoto from "../components/reports/ReportPhoto";
import { Badge, Callout, EmptyState, Field, PageHeader, Spinner, formatDateTime, useToast, ConfirmButton } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { usePlatform } from "../contexts/PlatformContext";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useFirestoreCollection } from "../hooks/useFirestoreCollection";
import { useDrafts } from "../hooks/useDraftSync";
import { db } from "../firebase";
import { compressImage, type CompressedImage } from "../lib/image";
import { ApiError, errorMessage } from "../lib/api";
import { REPORT_STATUS } from "../lib/labels";
import { deleteDraft, flushDrafts, newDraftId, saveDraft, submitReport, type ReportPayload, type SubmitResult } from "../services/reportQueue";
import { isWithinServiceBounds } from "../../shared/areas";
import { DEPTH_LABEL_TEXT, type CommunityReport, type DepthLabel } from "../../shared/types";

function MyReports({ uid }: { uid: string }) {
  const { data, loading } = useFirestoreCollection<CommunityReport>(
    () => query(collection(db, "community_reports"), where("reporterUid", "==", uid), orderBy("createdAt", "desc")),
    (id, d) => ({ id, ...(d as Omit<CommunityReport, "id">) }),
    [uid]
  );
  if (loading) return <p className="muted">Loading your reports…</p>;
  if (!data.length) return <p className="muted small">You haven't sent any reports yet.</p>;
  return (
    <ul className="list-plain my-reports">
      {data.map((r) => {
        const s = REPORT_STATUS[r.status];
        return (
          <li key={r.id} className="my-report">
            <ReportPhoto reportId={r.id} photoUrl={r.photoUrl} storage={r.photoStorage} alt="Your flood photo" className="my-report__photo" />
            <div className="my-report__body">
              <div className="row">
                <Badge tone={s.tone}>{s.label}</Badge>
                {r.simulated && <Badge tone="neutral">Simulated</Badge>}
              </div>
              <p className="my-report__desc">{r.description}</p>
              <p className="tiny">
                {r.area} · {DEPTH_LABEL_TEXT[r.depthLabel]} · {formatDateTime(r.createdAt)}
              </p>
              {r.moderationNote && <p className="tiny">DRRM note: {r.moderationNote}</p>}
              {r.status === "pending" && (
                <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Withdraw report" onConfirm={() => deleteDoc(doc(db, "community_reports", r.id))}>
                  Withdraw
                </ConfirmButton>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ReportPage() {
  const { currentUser, isAnonymous } = useAuth();
  const platform = usePlatform();
  const online = useOnlineStatus();
  const drafts = useDrafts();
  const toast = useToast();
  const [photo, setPhoto] = useState<CompressedImage | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [depth, setDepth] = useState<DepthLabel>("unknown");
  const [description, setDescription] = useState("");
  const [roadName, setRoadName] = useState("");
  const [roadBlocked, setRoadBlocked] = useState(false);
  const [observed, setObserved] = useState<"now" | "earlier">("now");
  const [observedAt, setObservedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [queuedNotice, setQueuedNotice] = useState(false);

  const signedIn = Boolean(currentUser && !isAnonymous);
  const outOfArea = location ? !isWithinServiceBounds(location.point[0], location.point[1]) : false;

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  };

  const payload = useMemo((): ReportPayload | null => {
    if (!location) return null;
    const observedAtMs = observed === "now" || !observedAt ? Date.now() : new Date(observedAt).getTime();
    return {
      location: { lat: location.point[0], lng: location.point[1] },
      locationSource: location.source,
      locationAccuracyM: location.accuracyM,
      description: description.trim(),
      depthLabel: depth,
      roadName: roadName.trim(),
      roadBlocked,
      observedAtMs,
      image: photo?.dataUrl ?? null,
    };
  }, [location, observed, observedAt, description, depth, roadName, roadBlocked, photo]);

  const reset = () => {
    setPhoto(null);
    setDescription("");
    setRoadName("");
    setRoadBlocked(false);
    setDepth("unknown");
    setObserved("now");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setQueuedNotice(false);
    if (!payload) return setError("Set the location of the flooding (GPS or tap the map).");
    if (outOfArea) return setError("That location is outside the Bahadvisory service area (Oriental Mindoro).");
    if (payload.description.length < 3) return setError("Describe what you see in a few words.");
    const id = newDraftId();
    if (!online) {
      await saveDraft(id, payload);
      setQueuedNotice(true);
      reset();
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitReport(id, payload);
      setResult(res);
      toast("Report sent to DRRM for verification.", "safe");
      reset();
    } catch (err) {
      if (err instanceof ApiError && (err.isNetwork || err.status >= 500)) {
        await saveDraft(id, payload, err.message);
        setQueuedNotice(true);
        reset();
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Report flooding"
        subtitle="Your report goes to the DRRM office for verification. Verified reports update the public map and flood-safe navigation."
      />
      {!platform.publicReportingEnabled && (
        <Callout tone="caution" title="Reporting is paused">
          The administrator has temporarily paused community reports. In an emergency call 911.
        </Callout>
      )}
      <Callout tone="danger">
        In immediate danger? Call <a href="tel:911">911</a> or use <Link to="/evacuation?sos=1">SOS</Link> — don't wait for a report to be reviewed.
      </Callout>

      <div className="grid-2 report-layout">
        <form className="panel" onSubmit={submit} noValidate>
          <h3 className="panel__title">What's happening?</h3>

          <Field label="Photo (optional, recommended)" hint="Taken now is best. Location data inside the photo is removed before upload.">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} />
          </Field>
          {photoBusy && (
            <p className="tiny">
              <Spinner /> Preparing photo…
            </p>
          )}
          {photo && (
            <div className="photo-preview">
              <img src={photo.dataUrl} alt="Selected flood photo" />
              <div className="row">
                <span className="tiny mono">{Math.round(photo.bytes / 1024)} KB</span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setPhoto(null)}>
                  Remove photo
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <span className="field__label">Where is the flooding?</span>
            <LocationPicker value={location} onChange={setLocation} />
            {outOfArea && <span className="field__error">Outside the service area (Oriental Mindoro).</span>}
          </div>

          <div className="field">
            <span className="field__label">How deep is the water?</span>
            <DepthPicker value={depth} onChange={setDepth} />
          </div>

          <Field label="Describe what you see">
            <textarea
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Water is knee-deep in front of the market, current is strong, tricycles turning back."
            />
          </Field>
          <div className="field-row">
            <Field label="Road or landmark (optional)">
              <input value={roadName} maxLength={120} onChange={(e) => setRoadName(e.target.value)} placeholder="e.g. Bucayao Road" />
            </Field>
            <Field label="When did you see this?">
              <select value={observed} onChange={(e) => setObserved(e.target.value as "now" | "earlier")}>
                <option value="now">Just now</option>
                <option value="earlier">Earlier</option>
              </select>
            </Field>
          </div>
          {observed === "earlier" && (
            <Field label="Time observed" hint="Within the last 48 hours.">
              <input type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />
            </Field>
          )}
          <label className="check-row">
            <input type="checkbox" checked={roadBlocked} onChange={(e) => setRoadBlocked(e.target.checked)} /> Vehicles can't get through
          </label>

          {!signedIn && (
            <p className="tiny">
              You can report without an account. <Link to="/login">Sign in</Link> to follow your report's status and get notified when it's verified.
            </p>
          )}
          {error && <Callout tone="danger">{error}</Callout>}
          <button type="submit" className="btn-block btn-lg" disabled={submitting || !platform.publicReportingEnabled}>
            {submitting ? (
              <>
                <Spinner /> Sending{photo ? " & analyzing photo" : ""}…
              </>
            ) : online ? (
              "Send report"
            ) : (
              "Save report — send when online"
            )}
          </button>
        </form>

        <div className="stack">
          {queuedNotice && (
            <Callout tone="caution" title="Saved on this device">
              You're offline or the service is unreachable. Your report is stored safely and will be sent automatically when you reconnect.
            </Callout>
          )}
          {result && (
            <div className="panel">
              <h3 className="panel__title">Report received</h3>
              <p className="small">
                <Badge tone="caution">Awaiting DRRM review</Badge> · {result.report.area}
                {result.idempotent ? " · already received earlier" : ""}
              </p>
              <AiAnalysisCard
                ai={{
                  provider: result.aiProvider ?? "simulated",
                  imageAnalyzed: result.analysis.imageAnalyzed,
                  floodVisible: result.analysis.floodVisible,
                  depthEstimate: result.analysis.waterLevelEstimate as DepthLabel,
                  severitySuggestion: result.analysis.severitySuggestion as never,
                  roadObstruction: result.analysis.roadObstruction.present,
                  consistency: result.analysis.consistencyWithDescription,
                  confidence: result.analysis.confidence,
                  hazards: result.analysis.hazards,
                  rationale: result.analysis.rationale,
                  consistencyNotes: result.analysis.consistencyNotes,
                }}
              />
              {result.duplicates.length > 0 && (
                <p className="small">
                  {result.duplicates.length} similar report{result.duplicates.length > 1 ? "s were" : " was"} sent nearby recently — this
                  helps DRRM confirm the flooding faster.
                </p>
              )}
            </div>
          )}

          {drafts.length > 0 && (
            <div className="panel">
              <div className="panel__head">
                <h3 className="panel__title">Saved on this device ({drafts.length})</h3>
                <button type="button" className="btn-secondary btn-sm" disabled={!online} onClick={() => flushDrafts()}>
                  Send now
                </button>
              </div>
              <ul className="list-plain">
                {drafts.map((d) => (
                  <li key={d.id} className="draft-row">
                    <div>
                      <strong className="small">{d.payload.description.slice(0, 60) || "Flood report"}</strong>
                      <div className="tiny">
                        Saved {formatDateTime(d.createdAt)} {d.payload.image ? "· with photo" : ""}
                      </div>
                      {d.state === "failed" && <div className="field__error">Not accepted: {d.lastError}</div>}
                    </div>
                    <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Delete draft" onConfirm={() => deleteDraft(d.id)}>
                      Delete
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel">
            <h3 className="panel__title">My reports</h3>
            {signedIn ? (
              <MyReports uid={currentUser!.uid} />
            ) : currentUser ? (
              <MyReports uid={currentUser.uid} />
            ) : (
              <EmptyState title="Track your reports">
                <Link to="/login">Sign in</Link> or <Link to="/register">create a free account</Link> to see the status of reports you send.
              </EmptyState>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
