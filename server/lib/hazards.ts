import { getDb } from "./firebaseAdmin";
import { env } from "./env";
import { tuplesFromFirestore } from "../../shared/geoFirestore";
import type { FloodZone } from "../../shared/flood";
import type { RoadCondition } from "../../shared/types";
import { createOrsProvider, createOsrmProvider, hazardsFromData, type Hazard, type RoutingProvider } from "../../shared/routing";

// Hazards change on DRRM edits; a short cache keeps bursts of route
// requests from re-reading Firestore while staying near-real-time.
const CACHE_MS = 20_000;
let cache: { at: number; zones: FloodZone[]; roads: RoadCondition[]; hazards: Hazard[] } | null = null;

export function zoneFromDoc(id: string, data: Record<string, unknown>): FloodZone {
  const zone = { id, ...(data as Omit<FloodZone, "id">) };
  if (zone.geometry?.type === "polygon") {
    zone.geometry = { ...zone.geometry, coordinates: tuplesFromFirestore(zone.geometry.coordinates as never) };
  }
  return zone;
}

export async function loadOfficialData(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const db = getDb();
  const [zSnap, rSnap] = await Promise.all([
    db.collection("floodZones").where("status", "==", "active").get(),
    db.collection("road_conditions").where("active", "==", true).get(),
  ]);
  const zones = zSnap.docs.map((d) => zoneFromDoc(d.id, d.data()));
  const roads = rSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoadCondition, "id">) }));
  cache = { at: Date.now(), zones, roads, hazards: hazardsFromData(zones, roads) };
  return cache;
}

export function invalidateHazardCache() {
  cache = null;
}

/**
 * Provider chain: OpenRouteService (if keyed — native polygon avoidance and
 * a truck profile) → FOSSGIS OSRM → project-osrm demo server (car only).
 */
export function routingProviders(): RoutingProvider[] {
  const providers: RoutingProvider[] = [];
  const orsKey = env("ORS_API_KEY");
  if (orsKey) providers.push(createOrsProvider({ apiKey: orsKey }));
  providers.push(createOsrmProvider({ carUrl: env("OSRM_CAR_URL"), bikeUrl: env("OSRM_BIKE_URL"), footUrl: env("OSRM_FOOT_URL") }));
  const demo = createOsrmProvider({ carUrl: "https://router.project-osrm.org" });
  providers.push({
    name: "osrm-demo",
    route: (points, mode, opts) => {
      if (mode === "bicycle" || mode === "walk") return Promise.reject(new Error("demo server is car-only"));
      return demo.route(points, mode, opts);
    },
  });
  return providers;
}
