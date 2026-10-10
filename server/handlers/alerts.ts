import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { forbidden, HttpError, json, notFound, readJson } from "../lib/http";
import { requireAuth, requireRole } from "../lib/auth";
import { audit } from "../lib/audit";
import { publishAlert } from "../lib/alerts";
import { asObject, bool, geographicReference, latLng, oneOf, optNum, str } from "../../shared/validation";
import { canManageArea } from "../../shared/roles";
import { ORIENTAL_MINDORO_AREAS } from "../../shared/areas";
import { displayArea, referenceForMunicipality } from "../lib/geography";
import { legacyAreaToMunicipality } from "../../shared/geography";
import type { Advisory } from "../../shared/types";
import type { RouteCtx } from "../router";

const LGU = ["lgu_staff", "lgu_admin", "super_admin"] as const;

/**
 * POST /api/advisories/:id/publish — publishing goes through the backend
 * so the matching public alert and push notifications always go out.
 */
export async function publishAdvisory(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireRole(auth, [...LGU]);
  const body = asObject(await readJson(req));
  const sendAlert = bool(body, "sendAlert", true);
  const radiusM = optNum(body, "alertRadiusM", { min: 500, max: 50_000 }) ?? 5000;
  const db = getDb();
  const ref = db.doc(`advisories/${ctx.params.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Advisory not found.");
  const adv = { id: snap.id, ...(snap.data() as Omit<Advisory, "id">) };
  if (auth.role !== "super_admin" && adv.orgId !== auth.orgId) throw forbidden("This advisory belongs to another organization.");
  for (const a of adv.areas) if (!canManageArea(auth.claims, a)) throw forbidden(`You can't publish advisories for ${a}.`);
  if (adv.status === "published") throw new HttpError(409, "Already published.", "already_published");

  await ref.update({ status: "published", publishedAt: FieldValue.serverTimestamp(), publishedBy: auth.uid });
  const alerts = [];
  if (sendAlert) {
    for (const areaName of adv.areas.slice(0, 5)) {
      const area = ORIENTAL_MINDORO_AREAS.find((a) => a.name === areaName);
      const municipality = legacyAreaToMunicipality(areaName);
      if (!area || !municipality) continue;
      const geography = referenceForMunicipality(municipality.psgcCode, auth.uid, "migrated");
      alerts.push(
        await publishAlert({
          type: "advisory",
          severity: adv.severity,
          title: adv.title,
          body: adv.body.slice(0, 600),
          center: { lat: area.center[0], lng: area.center[1] },
          radiusM,
          area: areaName,
          sourceRef: `advisories/${adv.id}`,
          issuedBy: auth.uid,
          issuedByName: auth.name,
          orgId: adv.orgId,
          expiresInHours: 24,
          simulated: Boolean(adv.simulated),
          geography,
        })
      );
    }
  }
  await audit(auth, "advisory.publish", "advisory", adv.id, { areas: adv.areas, alerts: alerts.map((a) => a.alertId) }, adv.orgId);
  return json({ ok: true, alerts });
}

/** POST /api/alerts — LGU-issued location alert (flood, road closure, evacuation). */
export async function createAlert(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireRole(auth, [...LGU]);
  const body = asObject(await readJson(req));
  const center = latLng(body, "center", { requireServiceArea: true });
  const geography = geographicReference(body);
  const area = displayArea(geography);
  if (!canManageArea(auth.claims, area)) throw forbidden(`You can't issue alerts for ${area}.`);
  const result = await publishAlert({
    type: oneOf(body, "type", ["flood", "road_closure", "evacuation", "advisory"] as const),
    severity: oneOf(body, "severity", ["info", "moderate", "high", "critical"] as const),
    title: str(body, "title", { min: 5, max: 140 }),
    body: str(body, "body", { min: 5, max: 1200 }),
    center,
    radiusM: optNum(body, "radiusM", { min: 200, max: 50_000 }) ?? 3000,
    area,
    sourceRef: null,
    issuedBy: auth.uid,
    issuedByName: auth.name,
    orgId: auth.orgId,
    expiresInHours: optNum(body, "expiresInHours", { min: 1, max: 168 }) ?? 12,
    geography,
  });
  await audit(auth, "alert.create", "alert", result.alertId, { area }, auth.orgId);
  return json(result, 201);
}

/** POST /api/alerts/:id/deactivate */
export async function deactivateAlert(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireRole(auth, [...LGU]);
  const ref = getDb().doc(`alerts/${ctx.params.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Alert not found.");
  if (!canManageArea(auth.claims, snap.get("area"))) throw forbidden();
  await ref.update({ active: false });
  await audit(auth, "alert.deactivate", "alert", snap.id, {}, auth.orgId);
  return json({ ok: true });
}
