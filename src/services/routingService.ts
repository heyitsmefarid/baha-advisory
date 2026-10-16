import { api, ApiError } from "../lib/api";
import { createOsrmProvider, planSafeRoute, type Hazard, type PlanRequest, type PlanResult } from "../../shared/routing";
import { fromPt } from "../../shared/geo";

export interface RouteResponse {
  plan: PlanResult;
  /** "server" = backend (cached, ORS when keyed); "device" = computed in the browser. */
  source: "server" | "device";
}

/**
 * Plans a flood-aware route. Prefers the backend; if it is unreachable
 * (static hosting, outage) the same deterministic planner runs on the
 * device against public OSRM and the hazards already synced to this
 * browser — navigation stays a free, available public-safety feature.
 */
export async function requestRoute(req: PlanRequest, localHazards: Hazard[]): Promise<RouteResponse> {
  try {
    const res = await api<{ plan: PlanResult }>("/route", {
      anonymous: true,
      body: {
        origin: fromPt(req.origin),
        destination: fromPt(req.destination),
        waypoints: (req.waypoints ?? []).map(fromPt),
        mode: req.mode,
        language: req.language ?? "en",
      },
      timeoutMs: 60_000,
    });
    return { plan: res.plan, source: "server" };
  } catch (err) {
    const fallbackable =
      err instanceof ApiError && (err.isNetwork || err.status === 503 || err.status === 404 || err.status >= 500);
    if (!fallbackable) throw err;
    const plan = await planSafeRoute(req, localHazards, [createOsrmProvider()]);
    return { plan, source: "device" };
  }
}
