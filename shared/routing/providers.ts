import { circleToPolygon, destinationPoint, bearingDeg, type Pt } from "../geo";
import { instructionText } from "./instructions";
import type { EngineProfile, Hazard, RouteCandidate, RouteStep, RoutingProvider, TravelMode } from "./types";
import { MODE_PROFILE } from "./types";

type FetchLike = typeof fetch;

async function fetchJson(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`routing HTTP ${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OSRM (public FOSSGIS / project-osrm servers, or self-hosted). No API key.
// No native polygon avoidance — the planner adds detour via-points instead.
// ---------------------------------------------------------------------------

export interface OsrmConfig {
  carUrl?: string;
  bikeUrl?: string;
  footUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export const DEFAULT_OSRM = {
  carUrl: "https://routing.openstreetmap.de/routed-car",
  bikeUrl: "https://routing.openstreetmap.de/routed-bike",
  footUrl: "https://routing.openstreetmap.de/routed-foot",
};

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; bearing_after?: number; exit?: number };
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { steps: OsrmStep[] }[];
}

export function createOsrmProvider(cfg: OsrmConfig = {}): RoutingProvider & { nativeProfiles: EngineProfile[] } {
  const urls: Record<EngineProfile, string> = {
    car: cfg.carUrl || DEFAULT_OSRM.carUrl,
    hgv: cfg.carUrl || DEFAULT_OSRM.carUrl,
    bike: cfg.bikeUrl || DEFAULT_OSRM.bikeUrl,
    foot: cfg.footUrl || DEFAULT_OSRM.footUrl,
  };
  const fetchImpl = cfg.fetchImpl ?? fetch.bind(globalThis);
  return {
    name: "osrm",
    nativeProfiles: ["car", "bike", "foot"],
    async route(points, mode, opts) {
      const profile = MODE_PROFILE[mode];
      const coords = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
      const alternatives = opts.alternatives && points.length === 2 ? "3" : "false";
      const url = `${urls[profile].replace(/\/$/, "")}/route/v1/driving/${coords}?alternatives=${alternatives}&steps=true&geometries=geojson&overview=full`;
      const data = (await fetchJson(fetchImpl, url, { headers: { accept: "application/json" } }, cfg.timeoutMs ?? 12_000)) as {
        code: string;
        routes?: OsrmRoute[];
        message?: string;
      };
      if (data.code !== "Ok" || !data.routes?.length) throw new Error(`OSRM: ${data.code} ${data.message ?? ""}`.trim());
      return data.routes.map((r) => ({
        provider: "osrm",
        geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as Pt),
        distanceM: r.distance,
        durationS: r.duration,
        via: [],
        steps: r.legs.flatMap((leg) =>
          leg.steps.map(
            (s): RouteStep => ({
              instruction: instructionText(
                { type: s.maneuver.type, modifier: s.maneuver.modifier, name: s.name, bearingAfter: s.maneuver.bearing_after, exit: s.maneuver.exit },
                opts.language ?? "en"
              ),
              name: s.name,
              distanceM: s.distance,
              durationS: s.duration,
              type: s.maneuver.type,
              modifier: s.maneuver.modifier,
              location: [s.maneuver.location[1], s.maneuver.location[0]],
            })
          )
        ),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// OpenRouteService (free API key). Native `avoid_polygons` + truck (HGV)
// profile, so blocked hazards are excluded by the engine itself.
// ---------------------------------------------------------------------------

export interface OrsConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

const ORS_PROFILE: Record<EngineProfile, string> = {
  car: "driving-car",
  hgv: "driving-hgv",
  bike: "cycling-regular",
  foot: "foot-walking",
};

/** Corridor polygon around a polyline (one quad per segment). */
export function lineToPolygons(points: Pt[], halfWidthM: number): Pt[][] {
  const polys: Pt[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const brg = bearingDeg(a, b);
    polys.push([
      destinationPoint(a, brg - 90, halfWidthM),
      destinationPoint(b, brg - 90, halfWidthM),
      destinationPoint(b, brg + 90, halfWidthM),
      destinationPoint(a, brg + 90, halfWidthM),
    ]);
  }
  return polys;
}

export function hazardToPolygons(h: Hazard): Pt[][] {
  if (h.shape.type === "polygon") return [h.shape.points];
  if (h.shape.type === "circle") return [circleToPolygon(h.shape.center, h.shape.radiusM + 15, 16)];
  return lineToPolygons(h.shape.points, h.shape.bufferM);
}

function toGeoJsonRing(points: Pt[]): [number, number][] {
  const ring = points.map(([lat, lng]) => [lng, lat] as [number, number]);
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
  return ring;
}

interface OrsFeature {
  geometry: { coordinates: [number, number][] };
  properties: {
    summary?: { distance?: number; duration?: number };
    segments?: { steps?: { distance: number; duration: number; instruction: string; name: string; type: number; way_points: [number, number] }[] }[];
  };
}

const ORS_STEP_TYPES = [
  "turn", "turn", "turn", "turn", "turn", "turn", "continue", "roundabout", "roundabout", "uturn", "arrive", "depart", "turn", "turn",
];

export function createOrsProvider(cfg: OrsConfig): RoutingProvider & { nativeProfiles: EngineProfile[]; supportsAvoid: true } {
  const fetchImpl = cfg.fetchImpl ?? fetch.bind(globalThis);
  const base = (cfg.baseUrl ?? "https://api.openrouteservice.org").replace(/\/$/, "");
  return {
    name: "openrouteservice",
    nativeProfiles: ["car", "hgv", "bike", "foot"],
    supportsAvoid: true,
    async route(points, mode, opts) {
      const profile = ORS_PROFILE[MODE_PROFILE[mode]];
      const body: Record<string, unknown> = {
        coordinates: points.map(([lat, lng]) => [lng, lat]),
        instructions: true,
        language: "en",
        units: "m",
      };
      if (opts.alternatives && points.length === 2) {
        body.alternative_routes = { target_count: 2, weight_factor: 1.6, share_factor: 0.6 };
      }
      if (opts.avoid?.length) {
        body.options = {
          avoid_polygons: { type: "MultiPolygon", coordinates: opts.avoid.flatMap(hazardToPolygons).map((p) => [toGeoJsonRing(p)]) },
        };
      }
      const data = (await fetchJson(
        fetchImpl,
        `${base}/v2/directions/${profile}/geojson`,
        { method: "POST", headers: { authorization: cfg.apiKey, "content-type": "application/json", accept: "application/geo+json" }, body: JSON.stringify(body) },
        cfg.timeoutMs ?? 15_000
      )) as { features?: OrsFeature[] };
      if (!data.features?.length) throw new Error("ORS: no route");
      return data.features.map((f): RouteCandidate => {
        const geometry = f.geometry.coordinates.map(([lng, lat]) => [lat, lng] as Pt);
        return {
          provider: "openrouteservice",
          geometry,
          distanceM: f.properties.summary?.distance ?? 0,
          durationS: f.properties.summary?.duration ?? 0,
          via: [],
          steps: (f.properties.segments ?? []).flatMap((seg) =>
            (seg.steps ?? []).map((s) => ({
              instruction: s.instruction,
              name: s.name === "-" ? "" : s.name,
              distanceM: s.distance,
              durationS: s.duration,
              type: ORS_STEP_TYPES[s.type] ?? "turn",
              location: geometry[s.way_points[0]] ?? geometry[0],
            }))
          ),
        };
      });
    },
  };
}

export function profileIsNative(provider: RoutingProvider, mode: TravelMode): boolean {
  const native = (provider as { nativeProfiles?: EngineProfile[] }).nativeProfiles ?? [];
  return native.includes(MODE_PROFILE[mode]);
}
