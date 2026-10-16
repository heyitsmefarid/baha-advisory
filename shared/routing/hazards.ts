import { toPt, type Pt } from "../geo";
import type { FloodZone, VehiclePassability } from "../flood";
import type { RoadCondition } from "../types";
import { ROAD_CONDITION_STATUS_TO_PASSABILITY } from "../types";
import { toMillis } from "../time";
import { MODE_PASSABILITY_KEY, type Hazard, type HazardEffect, type TravelMode } from "./types";

/** Corridor half-width used for road-closure polylines. */
export const ROAD_LINE_BUFFER_M = 25;

/**
 * Official, DRRM-verified hazards only: active flood zones and active
 * road conditions. Community reports affect routing only after an LGU
 * officer verifies them (verification creates/updates a zone).
 */
export function hazardsFromData(zones: FloodZone[], roads: RoadCondition[]): Hazard[] {
  const out: Hazard[] = [];
  for (const z of zones) {
    if (z.status !== "active") continue;
    const shape =
      z.geometry.type === "circle"
        ? ({ type: "circle", center: z.geometry.center, radiusM: z.geometry.radiusM } as const)
        : ({ type: "polygon", points: z.geometry.coordinates as Pt[] } as const);
    if (shape.type === "polygon" && shape.points.length < 3) continue;
    out.push({
      id: `zone:${z.id}`,
      kind: "flood_zone",
      name: z.name,
      area: z.area,
      shape,
      roadPassability: z.roadPassability,
      passability: z.passability,
      waterLevelM: z.waterLevelM,
      updatedAtMs: toMillis(z.updatedAt),
      simulated: Boolean(z.simulated),
      verified: true,
    });
  }
  for (const r of roads) {
    if (!r.active || r.status === "open" || !Array.isArray(r.path) || r.path.length < 2) continue;
    const exp = toMillis(r.expiresAt);
    if (exp != null && exp < Date.now()) continue;
    const allClosed: VehiclePassability = { bike: false, motor: false, fourWheel: false, suvPickup: false, truck: false };
    out.push({
      id: `road:${r.id}`,
      kind: "road_condition",
      name: r.name,
      area: r.area,
      shape: { type: "line", points: r.path.map(toPt), bufferM: ROAD_LINE_BUFFER_M },
      roadPassability: ROAD_CONDITION_STATUS_TO_PASSABILITY[r.status],
      passability: r.status === "closed" ? allClosed : r.passability,
      waterLevelM: null,
      updatedAtMs: toMillis(r.updatedAt),
      simulated: Boolean(r.simulated),
      verified: true,
    });
  }
  return out;
}

/** How a hazard affects a given travel mode, with a plain-language reason. */
export function hazardEffect(h: Hazard, mode: TravelMode): { effect: HazardEffect; reason: string } {
  const key = MODE_PASSABILITY_KEY[mode];
  const depth = h.waterLevelM != null ? ` (${h.waterLevelM.toFixed(2)} m)` : "";
  if (h.roadPassability === "closed") {
    return { effect: "blocked", reason: `Officially closed to all traffic${depth}.` };
  }
  if (!h.passability[key]) {
    return {
      effect: "blocked",
      reason:
        mode === "walk"
          ? `Water too deep to walk through safely${depth}.`
          : `DRRM marks it not passable for this vehicle${depth}.`,
    };
  }
  if (h.roadPassability === "not_passable" || h.roadPassability === "caution") {
    return { effect: "caution", reason: `Passable for this vehicle but flooded — drive slowly${depth}.` };
  }
  return { effect: "info", reason: `Reported passable${depth}.` };
}

/** Order-independent fingerprint of the hazard set (for recalculation triggers). */
export function hazardSignature(hazards: Hazard[]): string {
  const parts = hazards
    .map((h) => `${h.id}|${h.roadPassability}|${h.waterLevelM ?? ""}|${Object.values(h.passability).map(Number).join("")}`)
    .sort();
  let hash = 5381;
  const s = parts.join(";");
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  return `${hazards.length}:${(hash >>> 0).toString(36)}`;
}
