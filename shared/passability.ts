import {
  RoadPassability,
  VehiclePassability,
  WATER_LEVEL_BANDS,
  WaterLevelBand,
} from "./flood";

/**
 * Auto-suggests per-vehicle passability and an overall road passability
 * tier from a water level reading, anchored to the MMDA Flood Gauge's own
 * levels and vehicle classes rather than arbitrary numbers — so a DRRM
 * editor and a driver reading the news are working off the same reference.
 * DRRM editors can override every field afterward — this is a starting
 * point, not a hard rule, since real passability also depends on current
 * flow speed and road condition.
 *
 * Clearance heuristics (meters of standing water), mapped to MMDA levels:
 *  - bike:        unsafe above Half-Knee level (~0.25m) — traction/debris risk
 *  - motor:       unsafe above Knee level (~0.48m) — engine intake risk
 *  - 4-wheel:     unsafe above Tire level (~0.66m) — floor pan / electronics
 *  - SUV/pickup:  unsafe above Waist level (~0.94m) — higher intake / clearance
 *  - truck:       unsafe above Chest level (~1.14m) — high clearance, heavy chassis
 */
export function suggestPassability(waterLevelM: number): VehiclePassability {
  return {
    bike: waterLevelM <= 0.25,
    motor: waterLevelM <= 0.48,
    fourWheel: waterLevelM <= 0.66,
    suvPickup: waterLevelM <= 0.94,
    truck: waterLevelM <= 1.14,
  };
}

/**
 * Road-level classification following the MMDA gauge's own three tiers —
 * PATV up to Half-Knee, NPLV from Half-Tire through Knee, NPATV from Tire
 * level up — with a "closed" tier added at Chest level for official
 * road-closure decisions, which is a DRRM/LGU call the gauge itself
 * doesn't make.
 */
export function suggestRoadPassability(waterLevelM: number): RoadPassability {
  if (waterLevelM < 0.25) return "passable"; // PATV — up to Half-Knee level
  if (waterLevelM < 0.66) return "caution"; // NPLV — Half-Tire to Knee level
  if (waterLevelM < 0.94) return "not_passable"; // NPATV — Tire level and up
  return "closed"; // Waist/Chest level — DRRM road-closure territory
}

export function getWaterLevelBand(waterLevelM: number): WaterLevelBand {
  return (
    WATER_LEVEL_BANDS.find((b) => waterLevelM >= b.min && waterLevelM < b.max) ??
    WATER_LEVEL_BANDS[WATER_LEVEL_BANDS.length - 1]
  );
}

/**
 * Meters alone aren't a unit most visitors can picture instantly, so every
 * public-facing display pairs the number with the matching MMDA Flood
 * Gauge level (e.g. "0.35m — Knee level") instead of showing the number
 * alone.
 */
export function formatWaterLevel(waterLevelM: number): string {
  return `${waterLevelM.toFixed(2)}m — ${getWaterLevelBand(waterLevelM).laymanLabel}`;
}

/**
 * Orange → red gradient by severity (0 = mild, 1 = severe), used for map
 * pin markers so the public can eyeball danger at a glance without reading
 * the legend. Interpolates hue 38° (orange) down to 0° (red).
 */
export function severityColor(severity: number): string {
  const t = Math.max(0, Math.min(1, severity));
  const hue = 38 - t * 38; // 38 (orange) -> 0 (red)
  const light = 52 - t * 10; // slightly darker as it gets more severe
  return `hsl(${hue}, 85%, ${light}%)`;
}

/**
 * Hero-card accent per water level band — a photo overlay tint + matching
 * text color, so the zone detail hero reads as green/blue/orange/red at a
 * glance (same severity story as the pin markers, tuned for a photo bg).
 */
export interface HeroAccent {
  tint: string; // gradient overlay painted over the background photo
  text: string; // color for the big number + layman label on top of it
}

export function getHeroAccent(band: WaterLevelBand): HeroAccent {
  switch (band.mmdaClass) {
    case "PATV":
      return {
        tint: "linear-gradient(180deg, rgba(15,110,86,0.15) 0%, rgba(15,110,86,0.75) 100%)",
        text: "#eafff5",
      };
    case "NPLV":
      return {
        tint: "linear-gradient(180deg, rgba(24,95,165,0.2) 0%, rgba(12,68,124,0.8) 100%)",
        text: "#eaf4ff",
      };
    case "NPATV":
    default:
      return band.min >= 0.94
        ? {
            tint: "linear-gradient(180deg, rgba(114,15,15,0.25) 0%, rgba(80,10,10,0.85) 100%)",
            text: "#ffecec",
          }
        : {
            tint: "linear-gradient(180deg, rgba(133,79,11,0.2) 0%, rgba(99,56,6,0.82) 100%)",
            text: "#fff6e6",
          };
  }
}