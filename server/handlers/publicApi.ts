import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { forbidden, json, unauthorized } from "../lib/http";
import { memoryRateLimit } from "../lib/rateLimit";
import { loadOfficialData } from "../lib/hazards";
import { hashApiKey } from "./orgs";
import { toMillis } from "../../shared/time";
import type { RouteCtx } from "../router";

/**
 * Versioned data API for Business Pro (add-on) and Enterprise customers.
 * Authenticated with `x-api-key`; the key's organization must currently be
 * entitled to apiAccess (checked live on every call, so a lapsed
 * subscription stops API access immediately). The same public-safety data
 * stays free in the app — the API sells integration convenience, not access.
 */
async function apiOrg(req: Request): Promise<{ orgId: string; keyRef: FirebaseFirestore.DocumentReference }> {
  const key = req.headers.get("x-api-key") ?? "";
  if (!/^ba_(live|test)_[A-Za-z0-9_-]{20,}$/.test(key)) throw unauthorized("Missing or malformed API key (x-api-key header).");
  memoryRateLimit(`apikey:${key.slice(0, 16)}`, 120, 60_000);
  const snap = await getDb().collectionGroup("api_keys").where("hash", "==", hashApiKey(key)).limit(1).get();
  if (snap.empty || snap.docs[0].get("revoked")) throw unauthorized("Invalid or revoked API key.");
  const keyRef = snap.docs[0].ref;
  const orgId = snap.docs[0].get("orgId") as string;
  const org = await getDb().doc(`organizations/${orgId}`).get();
  if (!org.exists || org.get("status") !== "active" || !org.get("entitlements")?.apiAccess) {
    throw forbidden("This organization's plan doesn't currently include API access.");
  }
  keyRef.update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return { orgId, keyRef };
}

const meta = (extra: Record<string, unknown> = {}) => ({
  source: "Bahadvisory (DRRM-verified records)",
  generatedAt: new Date().toISOString(),
  notice: "Records flagged simulated=true are demonstration data, not real conditions.",
  ...extra,
});

/** GET /api/v1/flood-zones — active DRRM-verified zones + road conditions. */
export async function v1FloodZones(req: Request, _ctx: RouteCtx): Promise<Response> {
  await apiOrg(req);
  const { zones, roads } = await loadOfficialData();
  return json({
    meta: meta({ count: zones.length }),
    floodZones: zones.map((z) => ({
      id: z.id, name: z.name, area: z.area, waterLevelM: z.waterLevelM, trend: z.trend, roadPassability: z.roadPassability,
      passability: z.passability, geometry: z.geometry, updatedAt: toMillis(z.updatedAt), simulated: Boolean(z.simulated),
    })),
    roadConditions: roads.map((r) => ({ id: r.id, name: r.name, area: r.area, status: r.status, path: r.path, reason: r.reason, updatedAt: toMillis(r.updatedAt), simulated: Boolean(r.simulated) })),
  });
}

/** GET /api/v1/alerts — active public alerts. */
export async function v1Alerts(req: Request, _ctx: RouteCtx): Promise<Response> {
  await apiOrg(req);
  const snap = await getDb().collection("alerts").where("active", "==", true).orderBy("createdAt", "desc").limit(100).get();
  const now = Date.now();
  const alerts = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => (toMillis((a as { expiresAt?: unknown }).expiresAt) ?? 0) > now)
    .map((a) => {
      const x = a as Record<string, unknown>;
      return { id: x.id, type: x.type, severity: x.severity, title: x.title, body: x.body, center: x.center, radiusM: x.radiusM, area: x.area, createdAt: toMillis(x.createdAt), expiresAt: toMillis(x.expiresAt), simulated: Boolean(x.simulated) };
    });
  return json({ meta: meta({ count: alerts.length }), alerts });
}

/** GET /api/v1/risk — experimental area risk outlook (clearly labelled). */
export async function v1Risk(req: Request, _ctx: RouteCtx): Promise<Response> {
  await apiOrg(req);
  const snap = await getDb().collection("flood_risk_predictions").get();
  return json({
    meta: meta({ experimental: true, disclaimer: "Experimental indicator, not an official forecast." }),
    predictions: snap.docs.map((d) => {
      const p = d.data();
      return { area: p.area, score: p.score, level: p.level, computedAt: toMillis(p.computedAt), dataCompleteness: p.dataCompleteness, modelVersion: p.modelVersion, simulatedInputs: Boolean(p.simulatedInputs) };
    }),
  });
}

/** GET /api/v1/evacuation-centers — verified centers (verified occupancy only). */
export async function v1Centers(req: Request, _ctx: RouteCtx): Promise<Response> {
  await apiOrg(req);
  const snap = await getDb().collection("evacuation_centers").where("verified", "==", true).get();
  return json({
    meta: meta({ count: snap.size }),
    centers: snap.docs.map((d) => {
      const c = d.data();
      return {
        id: d.id, name: c.name, area: c.area, location: c.location, status: c.status, facilities: c.facilities,
        capacity: c.occupancyVerified ? c.capacity : null, occupancy: c.occupancyVerified ? c.occupancy : null,
        updatedAt: toMillis(c.updatedAt), simulated: Boolean(c.simulated),
      };
    }),
  });
}
