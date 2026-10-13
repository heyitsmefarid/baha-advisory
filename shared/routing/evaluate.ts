import {
  boundingCircle,
  bboxIntersects,
  bboxOf,
  distancePointToPolylineM,
  padBBox,
  polylineDistanceM,
  polylineIntersectsCircle,
  polylineIntersectsPolygon,
  type Pt,
} from "../geo";
import { HOUR } from "../time";
import { hazardEffect } from "./hazards";
import type { Hazard, HazardHit, RouteCandidate, RouteEvaluation, TravelMode } from "./types";

/** A route "passes through" a flood polygon within this margin. */
export const ZONE_BUFFER_M = 12;
/** Hazards this close (but not on the route) are listed as nearby. */
export const NEARBY_M = 300;
/** Hazard data older than this is flagged as possibly outdated. */
export const STALE_AFTER_MS = 6 * HOUR;

/** Distance in meters from a route line to a hazard (0 = intersects). */
export function distanceToHazard(line: Pt[], h: Hazard): number {
  switch (h.shape.type) {
    case "circle": {
      const d = distancePointToPolylineM(h.shape.center, line) - h.shape.radiusM;
      return Math.max(0, d);
    }
    case "line": {
      const d = polylineDistanceM(line, h.shape.points) - h.shape.bufferM;
      return Math.max(0, d);
    }
    case "polygon": {
      if (polylineIntersectsPolygon(line, h.shape.points, ZONE_BUFFER_M)) return 0;
      const ring = [...h.shape.points, h.shape.points[0]];
      return polylineDistanceM(line, ring);
    }
  }
}

function hazardBBox(h: Hazard) {
  if (h.shape.type === "circle") return padBBox(bboxOf([h.shape.center]), h.shape.radiusM);
  if (h.shape.type === "line") return padBBox(bboxOf(h.shape.points), h.shape.bufferM);
  return bboxOf(h.shape.points);
}

/** Does the line touch the hazard (within its buffer)? */
export function routeHitsHazard(line: Pt[], h: Hazard): boolean {
  if (h.shape.type === "circle") return polylineIntersectsCircle(line, h.shape.center, h.shape.radiusM + ZONE_BUFFER_M);
  if (h.shape.type === "line") return polylineDistanceM(line, h.shape.points) <= h.shape.bufferM;
  return polylineIntersectsPolygon(line, h.shape.points, ZONE_BUFFER_M);
}

/**
 * Deterministic safety evaluation of one route against verified hazards.
 * - blocked: the route passes through a hazard that is closed or not
 *   passable for this travel mode → route is "unsafe".
 * - caution: passes through flooding that is passable for this mode.
 * - nearby: within NEARBY_M but not on the route (informational).
 */
export function evaluateRoute(route: Pick<RouteCandidate, "geometry">, hazards: Hazard[], mode: TravelMode, now = Date.now()): RouteEvaluation {
  const blocked: HazardHit[] = [];
  const cautions: HazardHit[] = [];
  const nearby: HazardHit[] = [];
  const line = route.geometry;
  const routeBox = padBBox(bboxOf(line), NEARBY_M + 50);

  for (const h of hazards) {
    if (!bboxIntersects(routeBox, hazardBBox(h))) continue;
    const { effect, reason } = hazardEffect(h, mode);
    const hits = routeHitsHazard(line, h);
    const distanceM = hits ? 0 : distanceToHazard(line, h);
    const hit: HazardHit = {
      hazardId: h.id,
      name: h.name,
      kind: h.kind,
      effect,
      reason,
      waterLevelM: h.waterLevelM,
      updatedAtMs: h.updatedAtMs,
      simulated: h.simulated,
      distanceM: Math.round(distanceM),
    };
    if (hits && effect === "blocked") blocked.push(hit);
    else if (hits && effect === "caution") cautions.push(hit);
    else if (distanceM <= NEARBY_M || hits) nearby.push(hit);
  }

  const considered = [...blocked, ...cautions, ...nearby];
  const times = considered.map((h) => h.updatedAtMs).filter((t): t is number => t != null);
  const staleCount = times.filter((t) => now - t > STALE_AFTER_MS).length;
  const notes: string[] = [];
  if (staleCount > 0) {
    notes.push(`${staleCount} road update${staleCount > 1 ? "s" : ""} on or near this route ${staleCount > 1 ? "are" : "is"} more than 6 hours old — conditions may have changed.`);
  }
  if (considered.some((h) => h.simulated)) {
    notes.push("Some hazards on this route are SIMULATED demo data, not real conditions.");
  }

  return {
    status: blocked.length ? "unsafe" : cautions.length ? "caution" : "safe",
    blocked,
    cautions,
    nearby,
    freshness: {
      newestMs: times.length ? Math.max(...times) : null,
      oldestMs: times.length ? Math.min(...times) : null,
      staleCount,
    },
    notes,
  };
}

/** Rough "how far around" a hazard is, for placing detour via-points. */
export function hazardExtent(h: Hazard): { center: Pt; radiusM: number } {
  if (h.shape.type === "circle") return { center: h.shape.center, radiusM: h.shape.radiusM };
  return boundingCircle(h.shape.points);
}
