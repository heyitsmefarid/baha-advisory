import { json, readJson, HttpError } from "../lib/http";
import { memoryRateLimit } from "../lib/rateLimit";
import { loadOfficialData, routingProviders } from "../lib/hazards";
import { getDb } from "../lib/firebaseAdmin";
import { asObject, latLng, oneOf, ValidationError } from "../../shared/validation";
import { hazardSignature, planSafeRoute, TRAVEL_MODES, type Hazard, type PlanResult, type RoutingProvider, type TravelMode } from "../../shared/routing";
import { haversineM, roundPt, toPt, type Pt } from "../../shared/geo";
import type { EvacuationCenter } from "../../shared/types";
import type { RouteCtx } from "../router";
import { resolvePoint } from "../../shared/geography";

const planCache = new Map<string, { at: number; plan: PlanResult }>();
const PLAN_CACHE_MS = 90_000;
const MAX_TRIP_M = 250_000;

export interface NoVerifiedRoadRoute {
  status: "no_verified_road_route";
  routes: [];
  provider: string;
}

function isNoRouteError(error: unknown): boolean {
  return error instanceof Error && /no route|noroute/i.test(error.message);
}

/** Probe one road provider without ever synthesizing a cross-water line. */
export async function planWithProvider(origin: Pt, destination: Pt, provider: RoutingProvider): Promise<NoVerifiedRoadRoute | { status: "route_found"; routes: Awaited<ReturnType<RoutingProvider["route"]>> }> {
  try {
    const routes = await provider.route([origin, destination], "car", { alternatives: true, language: "en" });
    if (!routes.length) return { status: "no_verified_road_route", routes: [], provider: provider.name };
    return { status: "route_found", routes };
  } catch (error) {
    if (isNoRouteError(error)) return { status: "no_verified_road_route", routes: [], provider: provider.name };
    throw error;
  }
}

function parseRequest(body: Record<string, unknown>) {
  const origin = toPt(latLng(body, "origin"));
  const destination = toPt(latLng(body, "destination"));
  const mode = oneOf(body, "mode", TRAVEL_MODES, "car") as TravelMode;
  const language = oneOf(body, "language", ["en", "fil"] as const, "en");
  const raw = Array.isArray(body.waypoints) ? body.waypoints : [];
  if (raw.length > 8) throw new ValidationError(["At most 8 intermediate stops are supported."]);
  const waypoints: Pt[] = raw.map((w) => toPt(latLng({ waypoint: w }, "waypoint")));
  const all = [origin, ...waypoints, destination];
  let total = 0;
  for (let i = 0; i < all.length - 1; i++) total += haversineM(all[i], all[i + 1]);
  if (total > MAX_TRIP_M) throw new ValidationError(["Trips longer than 250 km are not supported."]);
  return {
    origin,
    destination,
    waypoints,
    mode,
    language,
    originScope: resolvePoint(origin),
    destinationScope: resolvePoint(destination),
  };
}

/**
 * POST /api/route — flood-aware route planning. Public (navigation is a
 * free public-safety feature); rate-limited per IP.
 */
export async function planRoute(req: Request, ctx: RouteCtx): Promise<Response> {
  memoryRateLimit(`route:${ctx.ip}`, 20, 60_000);
  const body = asObject(await readJson(req));
  const r = parseRequest(body);
  const { hazards } = await loadOfficialData();
  let plan: PlanResult;
  try {
    plan = await cachedPlan(r, hazards);
  } catch (error) {
    if (error instanceof HttpError && error.code === "no_verified_road_route") {
      throw new HttpError(error.status, error.message, error.code, {
        status: "no_verified_road_route",
        routes: [],
        originScope: r.originScope,
        destinationScope: r.destinationScope,
      });
    }
    throw error;
  }
  return json({ plan, originScope: r.originScope, destinationScope: r.destinationScope });
}

async function cachedPlan(r: { origin: Pt; destination: Pt; waypoints: Pt[]; mode: TravelMode; language: "en" | "fil" }, hazards: Hazard[]): Promise<PlanResult> {
  const key = JSON.stringify([roundPt(r.origin), roundPt(r.destination), r.waypoints.map((w) => roundPt(w)), r.mode, r.language, hazardSignature(hazards)]);
  const hit = planCache.get(key);
  if (hit && Date.now() - hit.at < PLAN_CACHE_MS) return hit.plan;
  let plan: PlanResult;
  try {
    plan = await planSafeRoute(r, hazards, routingProviders());
  } catch (err) {
    if (isNoRouteError(err)) {
      throw new HttpError(422, "No verified road route exists between these locations. Ferry or sea travel is not inferred.", "no_verified_road_route");
    }
    console.error("[route] all providers failed", err);
    throw new HttpError(503, "Routing service is temporarily unavailable. Try again in a minute.", "routing_unavailable");
  }
  planCache.set(key, { at: Date.now(), plan });
  if (planCache.size > 500) planCache.clear();
  return plan;
}

/**
 * POST /api/evacuation/nearest — ranks verified, open evacuation centers
 * by safe road travel time (not straight-line distance).
 */
export async function nearestEvacuation(req: Request, ctx: RouteCtx): Promise<Response> {
  memoryRateLimit(`evac:${ctx.ip}`, 10, 60_000);
  const body = asObject(await readJson(req));
  const from = toPt(latLng(body, "location"));
  const mode = oneOf(body, "mode", TRAVEL_MODES, "walk") as TravelMode;
  const snap = await getDb().collection("evacuation_centers").where("verified", "==", true).get();
  const centers = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<EvacuationCenter, "id">) }))
    .filter((c) => c.status === "open" || c.status === "standby")
    .map((c) => ({ c, straightM: haversineM(from, toPt(c.location)) }))
    .sort((a, b) => a.straightM - b.straightM)
    .slice(0, 4);

  const { hazards } = await loadOfficialData();
  const ranked = [];
  for (const { c, straightM } of centers) {
    try {
      const plan = await cachedPlan({ origin: from, destination: toPt(c.location), waypoints: [], mode, language: "en" }, hazards);
      ranked.push({
        centerId: c.id,
        name: c.name,
        status: c.status,
        straightM: Math.round(straightM),
        routeStatus: plan.status,
        distanceM: plan.recommended?.distanceM ?? null,
        durationS: plan.recommended?.durationS ?? null,
        avoided: plan.avoided.length,
        geometry: plan.recommended?.geometry ?? null,
        explanation: plan.explanation,
        full: c.occupancyVerified && c.capacity != null && c.occupancy != null ? c.occupancy >= c.capacity : null,
      });
    } catch {
      ranked.push({ centerId: c.id, name: c.name, status: c.status, straightM: Math.round(straightM), routeStatus: "unknown", distanceM: null, durationS: null, avoided: 0, geometry: null, explanation: "Routing unavailable — straight-line distance shown.", full: null });
    }
  }
  const order = { safe: 0, caution: 1, unknown: 2, no_safe_route: 3 } as Record<string, number>;
  ranked.sort((a, b) => (order[a.routeStatus] ?? 9) - (order[b.routeStatus] ?? 9) || (a.durationS ?? Infinity) - (b.durationS ?? Infinity));
  return json({ mode, from, results: ranked, computedAt: Date.now() });
}
