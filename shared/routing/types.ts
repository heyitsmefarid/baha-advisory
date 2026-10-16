import type { Pt } from "../geo";
import type { RoadPassability, VehicleKey, VehiclePassability } from "../flood";
import type { VehicleType } from "../types";

/** Travel modes the navigator supports (fleet vehicles + walking). */
export type TravelMode = VehicleType | "walk";

export const TRAVEL_MODES: TravelMode[] = ["car", "motorcycle", "suv", "truck", "bicycle", "walk"];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  car: "Car",
  motorcycle: "Motorcycle",
  suv: "SUV / Pickup",
  truck: "Truck",
  bicycle: "Bicycle",
  walk: "Walking",
};

/**
 * Which DRRM per-vehicle passability flag governs each mode. Walking uses
 * the strictest flag (bike, ≤ ~0.25 m): wading is dangerous because of
 * currents, open manholes and debris.
 */
export const MODE_PASSABILITY_KEY: Record<TravelMode, VehicleKey> = {
  car: "fourWheel",
  motorcycle: "motor",
  suv: "suvPickup",
  truck: "truck",
  bicycle: "bike",
  walk: "bike",
};

/** Routing-engine profile per mode. */
export type EngineProfile = "car" | "bike" | "foot" | "hgv";
export const MODE_PROFILE: Record<TravelMode, EngineProfile> = {
  car: "car",
  motorcycle: "car",
  suv: "car",
  truck: "hgv",
  bicycle: "bike",
  walk: "foot",
};

/**
 * Travel-time multipliers applied when an engine has no dedicated profile
 * (e.g. OSRM car profile used for trucks). Estimates, labelled as such.
 */
export const MODE_DURATION_FACTOR: Record<TravelMode, number> = {
  car: 1,
  suv: 1,
  motorcycle: 0.92,
  truck: 1.25,
  bicycle: 1,
  walk: 1,
};

export interface RouteStep {
  instruction: string;
  name: string;
  distanceM: number;
  durationS: number;
  type: string;
  modifier?: string;
  location: Pt;
}

export interface RouteCandidate {
  provider: string;
  geometry: Pt[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
  /** Detour via-points the planner injected (empty for direct routes). */
  via: Pt[];
}

export type HazardShape =
  | { type: "polygon"; points: Pt[] }
  | { type: "circle"; center: Pt; radiusM: number }
  | { type: "line"; points: Pt[]; bufferM: number };

export interface Hazard {
  id: string;
  kind: "flood_zone" | "road_condition";
  name: string;
  area: string;
  shape: HazardShape;
  roadPassability: RoadPassability;
  passability: VehiclePassability;
  waterLevelM: number | null;
  updatedAtMs: number | null;
  simulated: boolean;
  /** Always true — unverified community reports never become hazards. */
  verified: true;
}

export type HazardEffect = "blocked" | "caution" | "info";

export interface HazardHit {
  hazardId: string;
  name: string;
  kind: Hazard["kind"];
  effect: HazardEffect;
  reason: string;
  waterLevelM: number | null;
  updatedAtMs: number | null;
  simulated: boolean;
  /** Distance from the route (0 = the route passes through it). */
  distanceM: number;
}

export type SafetyStatus = "safe" | "caution" | "unsafe";

export interface RouteEvaluation {
  status: SafetyStatus;
  blocked: HazardHit[];
  cautions: HazardHit[];
  nearby: HazardHit[];
  freshness: { newestMs: number | null; oldestMs: number | null; staleCount: number };
  notes: string[];
}

export interface EvaluatedRoute extends RouteCandidate {
  id: string;
  label: string;
  evaluation: RouteEvaluation;
}

export interface PlanRequest {
  origin: Pt;
  destination: Pt;
  waypoints?: Pt[];
  mode: TravelMode;
  language?: "en" | "fil";
}

export interface PlanResult {
  status: "safe" | "caution" | "no_safe_route";
  recommended: EvaluatedRoute | null;
  alternatives: EvaluatedRoute[];
  /** Hazards the recommended route avoids that the fastest route would hit. */
  avoided: HazardHit[];
  hazardsConsidered: number;
  provider: string;
  mode: TravelMode;
  computedAt: number;
  requestsUsed: number;
  /** Deterministic, fact-based explanation (no AI). */
  explanation: string;
  notes: string[];
  hazardSignature: string;
}

export interface RoutingProvider {
  name: string;
  /** Returns 1+ candidates through `points` (origin, …via, destination). */
  route(points: Pt[], mode: TravelMode, opts: { alternatives: boolean; avoid?: Hazard[]; language?: "en" | "fil" }): Promise<RouteCandidate[]>;
}
