import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { forbidden, HttpError, json, readJson } from "../lib/http";
import { requireAuth, requireRole } from "../lib/auth";
import { memoryRateLimit } from "../lib/rateLimit";
import { getGeneralSettings } from "../lib/settings";
import { invalidateHazardCache, routingProviders } from "../lib/hazards";
import { audit } from "../lib/audit";
import { asObject, latLng, oneOf, optNum } from "../../shared/validation";
import { nearestArea } from "../../shared/areas";
import { legacyAreaToMunicipality } from "../../shared/geography";
import { referenceForMunicipality } from "../lib/geography";
import { canManageArea } from "../../shared/roles";
import { circleToPolygon, toPt } from "../../shared/geo";
import { tuplesToFirestore } from "../../shared/geoFirestore";
import { suggestPassability, suggestRoadPassability } from "../../shared/passability";
import { planSafeRoute, TRAVEL_MODES, type TravelMode } from "../../shared/routing";
import type { RouteCtx } from "../router";

async function requireDemoMode() {
  const s = await getGeneralSettings();
  if (!s.demoMode) throw new HttpError(403, "Demo tools are only available while the platform is in demo mode.", "demo_mode_off");
}

/**
 * POST /api/demo/flood-on-route — DEMO ONLY. Computes the current fastest
 * road route between two points and places a SIMULATED closed flood zone
 * on its midpoint, so the presenter can show flood-aware rerouting on real
 * roads. The zone is flagged simulated + demoScenario and labelled in the UI.
 */
export async function floodOnRoute(req: Request, ctx: RouteCtx): Promise<Response> {
  await requireDemoMode();
  const auth = await requireAuth(req);
  requireRole(auth, ["lgu_staff", "lgu_admin", "super_admin"]);
  memoryRateLimit(`demo:${auth.uid}`, 10, 60_000);
  const body = asObject(await readJson(req));
  const origin = toPt(latLng(body, "origin", { requireServiceArea: true }));
  const destination = toPt(latLng(body, "destination", { requireServiceArea: true }));
  const mode = oneOf(body, "mode", TRAVEL_MODES, "car") as TravelMode;
  const level = optNum(body, "waterLevelM", { min: 0.3, max: 3 }) ?? 1.0;

  const plan = await planSafeRoute({ origin, destination, mode }, [], routingProviders(), { maxDetourRequests: 0 });
  const route = plan.recommended;
  if (!route || route.geometry.length < 3) throw new HttpError(502, "Couldn't compute a route between those points.", "no_route");
  const mid = route.geometry[Math.floor(route.geometry.length / 2)];
  const area = nearestArea(mid[0], mid[1]).name;
  const municipality = legacyAreaToMunicipality(area);
  if (!municipality) throw new HttpError(400, "Choose a route inside a supported Mindoro LGU.", "unsupported_area");
  const geography = referenceForMunicipality(municipality.psgcCode, auth.uid, "migrated");
  if (!canManageArea(auth.claims, area)) throw forbidden(`The route midpoint is in ${area}, outside your jurisdiction. Pick points in your area.`);

  const db = getDb();
  const ref = db.collection("floodZones").doc();
  const name = "SIMULATED demo flood on the presenter's route";
  await ref.set({
    name,
    geometry: { type: "polygon", coordinates: tuplesToFirestore(circleToPolygon(mid, 140, 12)) },
    waterLevelM: level,
    trend: "rising",
    trendDeltaM: 0.15,
    roadPassability: suggestRoadPassability(level),
    passability: suggestPassability(level),
    notes: "SIMULATED for a live demonstration — not a real flood.",
    status: "active",
    area,
    source: "drrm",
    updatedBy: auth.uid,
    updatedByName: auth.name,
    updatedAt: FieldValue.serverTimestamp(),
    simulated: true,
    demoScenario: true,
    ...geography,
  });
  await db.collection("zoneHistory").doc(ref.id).collection("updates").add({
    zoneName: name, changedFields: { waterLevelM: level, simulated: true }, editorUid: auth.uid, editorName: auth.name,
    action: "created", timestamp: FieldValue.serverTimestamp(), simulated: true,
  });
  invalidateHazardCache();
  await audit(auth, "demo.flood_on_route", "flood_zone", ref.id, { area }, auth.orgId);
  return json({ ok: true, zoneId: ref.id, center: { lat: mid[0], lng: mid[1] }, area, routeDistanceM: route.distanceM }, 201);
}

/** POST /api/demo/reset — removes zones/alerts created by demo tools only. */
export async function resetScenario(req: Request, _ctx: RouteCtx): Promise<Response> {
  await requireDemoMode();
  const auth = await requireAuth(req);
  requireRole(auth, ["lgu_admin", "super_admin"]);
  const db = getDb();
  const zones = await db.collection("floodZones").where("demoScenario", "==", true).get();
  for (const d of zones.docs) {
    await db.recursiveDelete(db.doc(`zoneHistory/${d.id}`));
    await d.ref.delete();
  }
  invalidateHazardCache();
  await audit(auth, "demo.reset", "flood_zone", "demoScenario", { removed: zones.size }, auth.orgId);
  return json({ ok: true, removed: zones.size });
}
