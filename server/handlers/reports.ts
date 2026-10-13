import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { HttpError, json, notFound, forbidden, readJson } from "../lib/http";
import { requireAuth } from "../lib/auth";
import { firestoreRateLimit, memoryRateLimit } from "../lib/rateLimit";
import { getGeneralSettings } from "../lib/settings";
import { decodeImageDataUrl, type DecodedImage } from "../lib/images";
import { storeReportImage } from "../storage";
import { audit } from "../lib/audit";
import { notifyUser, publishAlert } from "../lib/alerts";
import { invalidateHazardCache, zoneFromDoc } from "../lib/hazards";
import { analyzeFloodImage, notAnalyzed, type FloodImageAnalysis } from "../ai/imageAnalysis";
import { asObject, bool, geographicSelection, latLng, oneOf, optNum, optStr, str, ValidationError } from "../../shared/validation";
import { findDuplicateCandidates, suspiciousFlags, depthMeters, type RecentReport } from "../../shared/reports";
import { assignGeography, displayArea, geographicReferenceFrom, migrateRecord } from "../lib/geography";
import { requireRecordJurisdiction } from "../lib/jurisdiction";
import { suggestPassability, suggestRoadPassability } from "../../shared/passability";
import { circleToPolygon, toPt } from "../../shared/geo";
import { tuplesToFirestore } from "../../shared/geoFirestore";
import { toMillis } from "../../shared/time";
import type { CommunityReport, DepthLabel, ReportAiSummary } from "../../shared/types";
import type { VehiclePassability, RoadPassability } from "../../shared/flood";
import type { RouteCtx } from "../router";
import { invalidateGeographicSummary } from "../lib/geographicSummary";

const DEPTHS = ["none", "ankle", "gutter", "half_knee", "knee", "waist", "chest_or_higher", "unknown"] as const;
const HOUR = 3600_000;

function reportOut(id: string, data: Record<string, unknown>) {
  return { id, ...data };
}

/**
 * POST /api/reports — submit a community flood report (guests allowed).
 * Never blocked by AI: if analysis is unavailable or over quota, the
 * report is still accepted and simply marked "not analyzed".
 */
export async function submitReport(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req, { allowAnonymous: true });
  const settings = await getGeneralSettings();
  if (!settings.publicReportingEnabled) {
    throw new HttpError(503, "Community reporting is temporarily paused by the administrator. In an emergency call 911.", "reporting_paused");
  }
  memoryRateLimit(`report-ip:${ctx.ip}`, 20, HOUR);
  const body = asObject(await readJson(req, 6 * 1024 * 1024));

  const clientDraftId = optStr(body, "clientDraftId", 80);
  const db = getDb();
  if (clientDraftId) {
    // Offline drafts may be retried: same draft id ⇒ same report.
    const dup = await db
      .collection("community_reports")
      .where("reporterUid", "==", auth.uid)
      .where("clientDraftId", "==", clientDraftId)
      .limit(1)
      .get();
    if (!dup.empty) {
      const d = dup.docs[0];
      return json({ report: reportOut(d.id, d.data()), duplicates: [], idempotent: true });
    }
  }

  await firestoreRateLimit(`report:${auth.uid}`, auth.anonymous ? 3 : 10, HOUR);

  const location = latLng(body, "location", { requireServiceArea: true });
  const geography = assignGeography(location, geographicSelection(body), auth.uid);
  if (!geography) throw new ValidationError(["Location is outside the supported Mindoro service area."]);
  const locationSource = oneOf(body, "locationSource", ["gps", "manual"] as const, "manual");
  const locationAccuracyM = optNum(body, "locationAccuracyM", { min: 0, max: 100_000 });
  const description = str(body, "description", { min: 3, max: 1000 });
  const depthLabel = oneOf(body, "depthLabel", DEPTHS, "unknown") as DepthLabel;
  const roadName = optStr(body, "roadName", 120);
  const roadBlocked = bool(body, "roadBlocked", false);
  const now = Date.now();
  const observedRaw = optNum(body, "observedAtMs", { min: 0 });
  const observedAtMs = observedRaw ?? now;
  if (observedAtMs > now + 5 * 60_000) throw new ValidationError(["observedAtMs cannot be in the future."]);
  if (now - observedAtMs > 48 * HOUR) throw new ValidationError(["Reports must be about flooding observed in the last 48 hours."]);

  let image: DecodedImage | null = null;
  if (body.image) image = decodeImageDataUrl(body.image);

  const ref = db.collection("community_reports").doc();
  const caller = { uid: auth.uid, orgId: auth.orgId, role: auth.role, anonymous: auth.anonymous, ip: ctx.ip };

  // Photo storage + AI analysis run in parallel.
  const [stored, aiOutcome] = await Promise.all([
    image ? storeReportImage(ref.id, image, { reporterUid: auth.uid, ...geography }) : Promise.resolve(null),
    image
      ? analyzeFloodImage({ image: { mime: image.mime, base64: image.base64 }, description, depthLabel, caller }).catch((err) => {
          const reason = err instanceof HttpError && err.code === "ai_quota_exceeded" ? "AI photo-analysis quota reached" : err instanceof HttpError && err.code === "ai_disabled" ? "AI analysis is switched off" : "AI unavailable";
          return { analysis: notAnalyzed(reason, depthLabel), meta: null };
        })
      : Promise.resolve({ analysis: notAnalyzed("no photo attached", depthLabel), meta: null }),
  ]);
  const analysis: FloodImageAnalysis = aiOutcome.analysis;

  // Duplicate detection against the last 6 hours of nearby reports.
  const recentSnap = await db
    .collection("community_reports")
    .where("createdAt", ">=", Timestamp.fromMillis(now - 6 * HOUR))
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  const recent: (RecentReport & { reporterUid: string })[] = recentSnap.docs.map((d) => ({
    id: d.id,
    location: d.get("location"),
    createdAtMs: toMillis(d.get("createdAt")) ?? now,
    depthLabel: d.get("depthLabel"),
    status: d.get("status"),
    reporterUid: d.get("reporterUid"),
  }));
  const duplicates = findDuplicateCandidates({ location, observedAtMs, depthLabel }, recent);
  const reportsLastHour = recent.filter((r) => r.reporterUid === auth.uid && now - r.createdAtMs < HOUR).length;

  const flags = suspiciousFlags({
    description,
    observedAtMs,
    nowMs: now,
    reportsLastHour,
    isGuest: auth.anonymous,
    locationAccuracyM,
    depthLabel,
    ai: { imageAnalyzed: analysis.imageAnalyzed, floodVisible: analysis.floodVisible, depthEstimate: analysis.waterLevelEstimate, imageQuality: analysis.imageQuality, confidence: analysis.confidence },
  });

  let analysisId: string | null = null;
  if (aiOutcome.meta) {
    const aRef = db.collection("ai_analysis_results").doc();
    analysisId = aRef.id;
    await aRef.set({
      task: "image_analysis",
      reportId: ref.id,
      provider: aiOutcome.meta.provider,
      model: aiOutcome.meta.model,
      result: analysis,
      disclaimer: analysis.disclaimer,
      latencyMs: aiOutcome.meta.latencyMs,
      createdAt: FieldValue.serverTimestamp(),
      requestedBy: auth.uid,
      orgId: auth.orgId,
    });
  }

  const ai: ReportAiSummary = {
    analysisId: analysisId ?? "",
    provider: aiOutcome.meta?.provider ?? "simulated",
    model: aiOutcome.meta?.model ?? "none",
    imageAnalyzed: analysis.imageAnalyzed,
    floodVisible: analysis.floodVisible,
    depthEstimate: analysis.waterLevelEstimate,
    severitySuggestion: analysis.severitySuggestion,
    roadObstruction: analysis.roadObstruction.present,
    consistency: analysis.consistencyWithDescription,
    confidence: analysis.confidence,
  };

  const doc = {
    reporterUid: auth.uid,
    clientDraftId: clientDraftId ?? null,
    location,
    locationSource,
    locationAccuracyM,
    ...geography,
    area: displayArea(geography),
    description,
    depthLabel,
    estimatedDepthM: depthMeters(depthLabel),
    roadName: roadName ?? "",
    roadBlocked,
    photoUrl: stored?.url ?? null,
    photoStorage: stored?.storage ?? null,
    status: "pending",
    ai,
    duplicateOf: null,
    duplicateCandidates: duplicates.map((d) => d.id),
    suspiciousFlags: flags,
    linkedZoneId: null,
    linkedIncidentId: null,
    verifiedBy: null,
    verifiedByName: null,
    verifiedAt: null,
    moderationNote: "",
    observedAt: Timestamp.fromMillis(observedAtMs),
    createdAt: FieldValue.serverTimestamp(),
    simulated: false,
  };
  await ref.set(doc);

  return json(
    {
      report: reportOut(ref.id, { ...doc, createdAt: now, observedAt: observedAtMs }),
      analysis,
      duplicates,
      aiProvider: aiOutcome.meta?.provider ?? null,
    },
    201
  );
}

// ---------------------------------------------------------------------------
// Verification (LGU staff, scoped to the report's area)
// ---------------------------------------------------------------------------

const ACTIONS = ["verify", "reject", "mark_duplicate", "request_info"] as const;

/**
 * POST /api/reports/:id/verify — the only path by which a community
 * report can affect official flood zones (and therefore navigation).
 */
export async function verifyReport(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const body = asObject(await readJson(req));
  const action = oneOf(body, "action", ACTIONS);
  const note = str(body, "note", { max: 1000, optional: true });
  const db = getDb();
  const ref = db.doc(`community_reports/${ctx.params.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Report not found.");
  const report = { id: snap.id, ...(snap.data() as Omit<CommunityReport, "id">) };
  await requireRecordJurisdiction(auth, report as unknown as Record<string, unknown>);
  if (report.status === "verified" || report.status === "rejected" || report.status === "duplicate") {
    throw new HttpError(409, `This report was already ${report.status}.`, "already_moderated");
  }

  let linkedZoneId: string | null = null;
  let alertResult: Awaited<ReturnType<typeof publishAlert>> | null = null;
  const editorName = auth.name;
  const reportData = report as unknown as Record<string, unknown>;
  const reportGeography = geographicReferenceFrom(reportData) ?? geographicReferenceFrom({
    ...reportData,
    ...migrateRecord("community_reports", report.id, reportData).patch,
  });

  if (action === "verify") {
    const apply = (body.apply && typeof body.apply === "object" ? body.apply : { mode: "none" }) as Record<string, unknown>;
    const mode = oneOf(apply, "mode", ["create_zone", "update_zone", "none"] as const, "none");
    if (mode !== "none") {
      const waterLevelM = optNum(apply, "waterLevelM", { min: 0, max: 15 }) ?? report.estimatedDepthM ?? 0.3;
      const roadPassability = (oneOf(apply, "roadPassability", ["passable", "caution", "not_passable", "closed"] as const, suggestRoadPassability(waterLevelM)) as RoadPassability);
      const passability: VehiclePassability = (apply.passability as VehiclePassability) ?? suggestPassability(waterLevelM);
      for (const k of ["bike", "motor", "fourWheel", "suvPickup", "truck"] as const) {
        if (typeof passability[k] !== "boolean") throw new ValidationError([`apply.passability.${k} must be true/false.`]);
      }
      if (mode === "create_zone") {
        if (!reportGeography) throw new ValidationError(["Report geography needs staff review before creating an official zone."]);
        const radiusM = optNum(apply, "radiusM", { min: 30, max: 2000 }) ?? 150;
        const name = optStr(apply, "name", 160) ?? (report.roadName ? `${report.roadName} (community report)` : `Flooding near ${report.area} (community report)`);
        const zRef = db.collection("floodZones").doc();
        const zone = {
          name,
          geometry: { type: "polygon", coordinates: tuplesToFirestore(circleToPolygon(toPt(report.location), radiusM, 12)) },
          waterLevelM,
          trend: oneOf(apply, "trend", ["rising", "falling", "steady"] as const, "steady"),
          trendDeltaM: 0,
          roadPassability,
          passability,
          notes: str(apply, "notes", { max: 1000, optional: true }) || `Verified community report: ${report.description}`.slice(0, 1000),
          status: "active",
          area: report.area,
          source: "community_report",
          sourceReportIds: [report.id],
          updatedBy: auth.uid,
          updatedByName: editorName,
          updatedAt: FieldValue.serverTimestamp(),
          simulated: Boolean(report.simulated),
          ...reportGeography,
        };
        await zRef.set(zone);
        await db.collection("zoneHistory").doc(zRef.id).collection("updates").add({
          zoneName: name, changedFields: { waterLevelM, roadPassability, source: "community_report" }, editorUid: auth.uid, editorName,
          action: "created", timestamp: FieldValue.serverTimestamp(), simulated: Boolean(report.simulated),
        });
        linkedZoneId = zRef.id;
      } else {
        const zoneId = str(apply, "zoneId", { max: 120 });
        const zRef = db.doc(`floodZones/${zoneId}`);
        const zSnap = await zRef.get();
        if (!zSnap.exists) throw notFound("Zone to update not found.");
        const zone = zoneFromDoc(zSnap.id, zSnap.data()!);
        await requireRecordJurisdiction(auth, zone as unknown as Record<string, unknown>);
        const patch = {
          waterLevelM,
          roadPassability,
          passability,
          trend: waterLevelM > zone.waterLevelM ? "rising" : waterLevelM < zone.waterLevelM ? "falling" : zone.trend,
          trendDeltaM: Math.round((waterLevelM - zone.waterLevelM) * 100) / 100,
          status: "active",
          sourceReportIds: FieldValue.arrayUnion(report.id),
          updatedBy: auth.uid,
          updatedByName: editorName,
          updatedAt: FieldValue.serverTimestamp(),
        };
        await zRef.update(patch);
        await db.collection("zoneHistory").doc(zoneId).collection("updates").add({
          zoneName: zone.name, changedFields: { waterLevelM, roadPassability, fromReport: report.id }, editorUid: auth.uid, editorName,
          action: "updated", timestamp: FieldValue.serverTimestamp(), simulated: Boolean(zone.simulated),
        });
        linkedZoneId = zoneId;
      }
      invalidateHazardCache();
    }

    if (body.publishAlert === true) {
      if (!reportGeography) throw new ValidationError(["Report geography needs staff review before publishing an alert."]);
      const level = report.estimatedDepthM ?? 0;
      alertResult = await publishAlert({
        type: "flood",
        severity: level >= 0.94 ? "critical" : level >= 0.48 ? "high" : "moderate",
        title: `${report.simulated ? "[Simulated] " : ""}Flooding reported near ${report.roadName || report.area}`,
        body: `${report.simulated ? "SIMULATED: " : ""}DRRM verified a community report: ${report.description}`.slice(0, 600),
        center: report.location,
        radiusM: optNum(body, "alertRadiusM", { min: 200, max: 20_000 }) ?? 2000,
        area: report.area,
        sourceRef: linkedZoneId ? `floodZones/${linkedZoneId}` : `community_reports/${report.id}`,
        issuedBy: auth.uid,
        issuedByName: editorName,
        orgId: auth.orgId,
        simulated: Boolean(report.simulated),
        geography: reportGeography,
      });
    }
  }

  const statusMap = { verify: "verified", reject: "rejected", mark_duplicate: "duplicate", request_info: "needs_info" } as const;
  const duplicateOf = action === "mark_duplicate" ? str(body, "duplicateOf", { max: 120 }) : null;
  const status = statusMap[action];
  await ref.update({
    status,
    moderationNote: note,
    duplicateOf,
    linkedZoneId: linkedZoneId ?? report.linkedZoneId ?? null,
    verifiedBy: auth.uid,
    verifiedByName: editorName,
    verifiedAt: FieldValue.serverTimestamp(),
  });
  await ref.collection("verifications").add({
    action, byUid: auth.uid, byName: editorName, note, appliedToZoneId: linkedZoneId, at: FieldValue.serverTimestamp(),
  });
  // Verified photos become publicly viewable with the report.
  await db.doc(`report_media/${report.id}`).set({ status }, { merge: true }).catch(() => undefined);

  const messages: Record<typeof action, string> = {
    verify: "A DRRM officer verified your flood report. Thank you for helping your community.",
    reject: `Your flood report was not verified.${note ? ` Note: ${note}` : ""}`,
    mark_duplicate: "Your flood report matched another report of the same flooding — thank you, it helped confirm it.",
    request_info: `A DRRM officer asked for more information about your report.${note ? ` ${note}` : ""}`,
  };
  await notifyUser(report.reporterUid, { kind: "report", title: `Report ${status.replace("_", " ")}`, body: messages[action], refPath: `community_reports/${report.id}` });
  await audit(auth, `report.${action}`, "community_report", report.id, { linkedZoneId, area: report.area, alert: alertResult?.alertId ?? null }, auth.orgId);
  if (reportGeography) await invalidateGeographicSummary(reportGeography);

  return json({ ok: true, status, linkedZoneId, alert: alertResult });
}
