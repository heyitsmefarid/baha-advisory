// ---------------------------------------------------------------------------
// Core domain types for Bahadvisory
// ---------------------------------------------------------------------------

import type { GeographicReference } from "./geography";

/** Role comes from a Firebase Auth custom claim, set server-side only.
 *  `drrm_editor` / `admin` are the original Bahadvisory roles and remain
 *  valid claim values; see shared/roles.ts for how they map onto the
 *  multi-tenant role set. */
export type { ClaimRole as Role } from "./roles";

export type Trend = "rising" | "falling" | "steady";

export type RoadPassability = "passable" | "caution" | "not_passable" | "closed";

export interface VehiclePassability {
  bike: boolean;
  motor: boolean;
  fourWheel: boolean;
  suvPickup: boolean;
  truck: boolean;
}

export type VehicleKey = keyof VehiclePassability;

export const VEHICLE_LABELS: Record<VehicleKey, string> = {
  bike: "Bike",
  motor: "Motor",
  fourWheel: "4 Wheels",
  suvPickup: "SUV / Pickup",
  truck: "Truck",
};

/** GeoJSON-ish geometry — polygon (list of [lat,lng] points) or a point+radius circle. */
export type ZoneGeometry =
  | { type: "polygon"; coordinates: [number, number][] }
  | { type: "circle"; center: [number, number]; radiusM: number };

export interface ForecastPoint {
  time: string; // ISO string, DRRM-entered
  projectedLevelM: number;
}

export type ZoneStatus = "active" | "cleared";

export interface FloodZone extends Partial<GeographicReference> {
  id: string;
  name: string;
  geometry: ZoneGeometry;
  waterLevelM: number;
  trend: Trend;
  trendDeltaM: number;
  roadPassability: RoadPassability;
  passability: VehiclePassability;
  forecast?: ForecastPoint[];
  notes: string;
  status: ZoneStatus;
  area: string;
  updatedBy: string;
  updatedByName?: string;
  updatedAt: unknown; // Firestore Timestamp
  /** Where the zone came from. Absent on zones created before community
   *  reporting existed — treat missing as "drrm". */
  source?: "drrm" | "community_report";
  /** Community reports whose DRRM verification created/updated this zone. */
  sourceReportIds?: string[];
  /** Seeded demo/simulated data. Must be visibly labelled in every UI. */
  simulated?: boolean;
  geographyMigrationVersion?: string;
}

/** Payload shape used when creating/updating a zone (no server-managed fields). */
export type FloodZoneInput = Omit<
  FloodZone,
  "id" | "updatedBy" | "updatedAt" | "updatedByName"
>;

export interface ZoneHistoryEntry {
  id: string;
  zoneId: string;
  zoneName: string;
  changedFields: Record<string, unknown>;
  editorUid: string;
  editorName: string;
  timestamp: unknown; // Firestore Timestamp
  action: "created" | "updated" | "cleared" | "deleted";
}

export interface DrrmUser {
  uid: string;
  name: string;
  email: string;
  role: import("./roles").ClaimRole;
  assignedArea: string;
  active: boolean;
  orgId?: string | null;
}

// ---------------------------------------------------------------------------
// Reference scales (Section 6 of the plan)
// ---------------------------------------------------------------------------

export interface WaterLevelBand {
  min: number;
  max: number;
  label: string;
  /** Plain-language depth reference shown alongside the meter reading —
   *  meters alone aren't a unit most people can picture at a glance.
   *  These are the actual level names from the MMDA Flood Gauge, the
   *  reference the public already recognizes from news/DPWH signage,
   *  rather than invented terms. */
  laymanLabel: string;
  /** Inches on the MMDA gauge this band corresponds to, shown for anyone
   *  used to reading flood depth that way (e.g. "19 in"). */
  inches: number;
  /** MMDA's own vehicle-passability classification for this depth:
   *  PATV = Passable to All Types of Vehicles
   *  NPLV = Not Passable to Light Vehicles
   *  NPATV = Not Passable to All Types of Vehicles */
  mmdaClass: "PATV" | "NPLV" | "NPATV";
  color: string;
}

/**
 * Based on the MMDA Flood Gauge (metro-wide public reference for flood
 * depth vs. vehicle passability): Gutter (8in) → Half-Knee (10in) →
 * Half-Tire (13in) → Knee (19in) → Tire (26in) → Waist (37in) → Chest
 * (45in). Inches converted to meters (1in = 0.0254m) for storage, since
 * the rest of the app works in meters.
 */
export const WATER_LEVEL_BANDS: WaterLevelBand[] = [
  { min: 0, max: 0.2, label: "Normal", laymanLabel: "Gutter level", inches: 8, mmdaClass: "PATV", color: "#3aa373" },
  { min: 0.2, max: 0.25, label: "Low", laymanLabel: "Half-knee level", inches: 10, mmdaClass: "PATV", color: "#1f8a5c" },
  { min: 0.25, max: 0.33, label: "Caution", laymanLabel: "Half-tire level", inches: 13, mmdaClass: "NPLV", color: "#5eb0ee" },
  { min: 0.33, max: 0.48, label: "Moderate", laymanLabel: "Knee level", inches: 19, mmdaClass: "NPLV", color: "#2778c2" },
  { min: 0.48, max: 0.66, label: "High", laymanLabel: "Tire level", inches: 26, mmdaClass: "NPATV", color: "#e08a1e" },
  { min: 0.66, max: 0.94, label: "Very High", laymanLabel: "Waist level", inches: 37, mmdaClass: "NPATV", color: "#d64545" },
  { min: 0.94, max: Infinity, label: "Severe", laymanLabel: "Chest level & above", inches: 45, mmdaClass: "NPATV", color: "#7a1f2b" },
];

export const MMDA_CLASS_LABELS: Record<WaterLevelBand["mmdaClass"], string> = {
  PATV: "Passable to all vehicles",
  NPLV: "Not passable to light vehicles",
  NPATV: "Not passable to all vehicles",
};

export const PASSABILITY_COLORS: Record<RoadPassability, string> = {
  passable: "#1f9d55",
  caution: "#e08a1e",
  not_passable: "#d64545",
  closed: "#7a1f2b",
};

export const PASSABILITY_LABELS: Record<RoadPassability, string> = {
  passable: "Passable",
  caution: "Caution",
  not_passable: "Not Passable",
  closed: "Closed",
};
