import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { HttpError, json, readJson } from "../lib/http";
import { requireAuth, requireOrgMember } from "../lib/auth";
import { firestoreRateLimit } from "../lib/rateLimit";
import { loadOfficialData, routingProviders } from "../lib/hazards";
import { notifyUser } from "../lib/alerts";
import { asObject, optStr, str } from "../../shared/validation";
import { planSafeRoute, type HazardHit } from "../../shared/routing";
import { toPt } from "../../shared/geo";
import type { RouteDisruption, SavedRoute } from "../../shared/types";
import type { RouteCtx } from "../router";

/**
 * POST /api/fleet/check — re-plans an organization's saved delivery routes
 * against current verified hazards (paid: fleetMonitoring). Opens a
 * disruption for every newly blocking/caution hazard on a route, resolves
 * disruptions that cleared, logs route history, and notifies members.
 */
export async function checkFleet(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const body = asObject(await readJson(req));
  const orgId = str(body, "orgId", { max: 120 });
  requireOrgMember(auth, orgId);
  const db = getDb();
  const org = await db.doc(`organizations/${orgId}`).get();
  if (!org.get("entitlements")?.fleetMonitoring) throw new HttpError(402, "Fleet monitoring requires Business Pro or Enterprise.", "upgrade_required");
  await firestoreRateLimit(`fleet:${orgId}`, 20, 3600_000);

  const onlyRoute = optStr(body, "routeId", 120);
  const routesSnap = onlyRoute
    ? await db.collection(`organizations/${orgId}/saved_routes`).where("__name__", "==", onlyRoute).get()
    : await db.collection(`organizations/${orgId}/saved_routes`).limit(25).get();
  const { hazards } = await loadOfficialData();
  const providers = routingProviders();
  const activeSnap = await db.collection(`organizations/${orgId}/route_disruptions`).where("active", "==", true).get();
  const active = activeSnap.docs.map((d) => ({ ref: d.ref, ...(d.data() as Omit<RouteDisruption, "id">) }));

  const results = [];
  const newDisruptions: string[] = [];
  for (const doc of routesSnap.docs) {
    const route = { id: doc.id, ...(doc.data() as Omit<SavedRoute, "id">) };
    const stops = route.stops.map((s) => toPt(s.location));
    try {
      const plan = await planSafeRoute(
        { origin: stops[0], destination: stops[stops.length - 1], waypoints: stops.slice(1, -1), mode: route.vehicle },
        hazards,
        providers,
        { maxDetourRequests: 3 }
      );
      const chosen = plan.recommended ?? plan.alternatives[0] ?? null;
      const status = plan.status === "no_safe_route" ? "unsafe" : plan.status;
      // Disruptions = what the fastest/planned path runs into right now.
      const hits: HazardHit[] = [...plan.avoided, ...(chosen?.evaluation.blocked ?? []), ...(chosen?.evaluation.cautions ?? [])];
      const seen = new Set<string>();
      for (const h of hits) {
        if (seen.has(h.hazardId)) continue;
        seen.add(h.hazardId);
        const exists = active.find((a) => a.routeId === route.id && a.hazardId === h.hazardId);
        if (!exists) {
          await db.collection(`organizations/${orgId}/route_disruptions`).add({
            orgId, routeId: route.id, routeName: route.name, hazardId: h.hazardId, hazardName: h.name, hazardKind: h.kind,
            severity: h.effect === "blocked" ? "blocked" : "caution", detectedAt: FieldValue.serverTimestamp(), resolvedAt: null, active: true,
          });
          newDisruptions.push(`${route.name}: ${h.name}`);
        }
      }
      for (const a of active.filter((x) => x.routeId === route.id && !seen.has(x.hazardId))) {
        await a.ref.update({ active: false, resolvedAt: FieldValue.serverTimestamp() });
      }
      await doc.ref.update({
        lastCheckedAt: FieldValue.serverTimestamp(),
        lastStatus: status,
        lastDistanceM: chosen?.distanceM ?? null,
        lastDurationS: chosen?.durationS ?? null,
        activeDisruptions: seen.size,
      });
      await db.collection(`organizations/${orgId}/route_history`).add({
        orgId, routeId: route.id, routeName: route.name, vehicle: route.vehicle, status, distanceM: chosen?.distanceM ?? 0,
        durationS: chosen?.durationS ?? 0, avoidedHazards: plan.avoided.length, checkedBy: auth.uid, at: Timestamp.now(),
      });
      results.push({ routeId: route.id, name: route.name, status, disruptions: seen.size, distanceM: chosen?.distanceM ?? null, durationS: chosen?.durationS ?? null, explanation: plan.explanation });
    } catch (err) {
      console.error("[fleet] route check failed", route.id, err);
      results.push({ routeId: route.id, name: route.name, status: "unknown", disruptions: 0, distanceM: null, durationS: null, explanation: "Routing service unavailable — try again shortly." });
    }
  }

  if (newDisruptions.length) {
    const members = await db.collection(`organizations/${orgId}/members`).where("active", "==", true).get();
    for (const m of members.docs) {
      await notifyUser(m.id, { kind: "alert", title: `${newDisruptions.length} new route disruption(s)`, body: newDisruptions.slice(0, 5).join("; ") });
    }
  }
  return json({ checked: results.length, newDisruptions: newDisruptions.length, results });
}
