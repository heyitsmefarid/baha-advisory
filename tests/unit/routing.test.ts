import { describe, expect, it, vi } from "vitest";
import { circleToPolygon, haversineM, type Pt } from "../../shared/geo";
import {
  createOrsProvider,
  createOsrmProvider,
  evaluateRoute,
  hazardEffect,
  hazardSignature,
  hazardsFromData,
  instructionText,
  planSafeRoute,
  routeHitsHazard,
  type Hazard,
  type RouteCandidate,
  type RoutingProvider,
} from "../../shared/routing";
import type { FloodZone } from "../../shared/flood";
import type { RoadCondition } from "../../shared/types";
import { suggestPassability, suggestRoadPassability } from "../../shared/passability";

// ---- fixtures ----------------------------------------------------------------

const ORIGIN: Pt = [13.4, 121.15];
const DEST: Pt = [13.4, 121.2];
const MID: Pt = [13.4, 121.175];

function densify(points: Pt[], stepM = 40): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const n = Math.max(1, Math.ceil(haversineM(a, b) / stepM));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** "Road network" where every road is a straight line between the given points. */
function straightLineProvider(opts: { failAfter?: number } = {}): RoutingProvider & { calls: Pt[][] } {
  const calls: Pt[][] = [];
  return {
    name: "fake",
    calls,
    async route(points): Promise<RouteCandidate[]> {
      calls.push(points);
      if (opts.failAfter !== undefined && calls.length > opts.failAfter) throw new Error("engine down");
      const geometry = densify(points);
      let d = 0;
      for (let i = 0; i < geometry.length - 1; i++) d += haversineM(geometry[i], geometry[i + 1]);
      return [
        {
          provider: "fake",
          geometry,
          distanceM: d,
          durationS: d / 10,
          via: [],
          steps: [
            { instruction: "Head east", name: "Test Road", distanceM: d, durationS: d / 10, type: "depart", location: points[0] },
            { instruction: "Arrive", name: "", distanceM: 0, durationS: 0, type: "arrive", location: points[points.length - 1] },
          ],
        },
      ];
    },
  };
}

function zone(overrides: Partial<FloodZone> & { center?: Pt; radiusM?: number } = {}): FloodZone {
  const { center = MID, radiusM = 200, ...rest } = overrides;
  const level = rest.waterLevelM ?? 0.55;
  return {
    id: "z1",
    name: "Test flood",
    geometry: { type: "polygon", coordinates: circleToPolygon(center, radiusM, 12) },
    waterLevelM: level,
    trend: "rising",
    trendDeltaM: 0.1,
    roadPassability: suggestRoadPassability(level),
    passability: suggestPassability(level),
    notes: "",
    status: "active",
    area: "Calapan City",
    updatedBy: "u",
    updatedAt: Date.now() - 20 * 60_000,
    ...rest,
  };
}

// ---- hazards ---------------------------------------------------------------------

describe("hazards", () => {
  it("only uses active zones and non-open, active road conditions", () => {
    const road: RoadCondition = {
      id: "r1", name: "Closed road", path: [{ lat: 13.41, lng: 121.17 }, { lat: 13.41, lng: 121.18 }], status: "closed",
      passability: { bike: true, motor: true, fourWheel: true, suvPickup: true, truck: true }, reason: "", area: "Calapan City",
      source: "drrm", active: true, updatedBy: "u", updatedAt: Date.now(),
    };
    const hazards = hazardsFromData(
      [zone(), zone({ id: "z2", status: "cleared" })],
      [road, { ...road, id: "r2", status: "open" }, { ...road, id: "r3", active: false }]
    );
    expect(hazards.map((h) => h.id).sort()).toEqual(["road:r1", "zone:z1"]);
    // A closed road blocks everyone regardless of the stored per-vehicle flags.
    expect(hazards.find((h) => h.id === "road:r1")!.passability.truck).toBe(false);
  });

  it("vehicle-specific effects follow the DRRM passability flags", () => {
    // 0.55 m = tire level: existing MMDA heuristic → cars still passable
    // (≤ 0.66 m), motorcycles not (≤ 0.48 m).
    const [h] = hazardsFromData([zone({ waterLevelM: 0.55 })], []);
    expect(hazardEffect(h, "car").effect).toBe("caution");
    expect(hazardEffect(h, "motorcycle").effect).toBe("blocked");
    expect(hazardEffect(h, "suv").effect).toBe("caution");
    expect(hazardEffect(h, "truck").effect).toBe("caution");
    expect(hazardEffect(h, "walk").effect).toBe("blocked");
    const [closed] = hazardsFromData([zone({ waterLevelM: 1.2 })], []);
    expect(hazardEffect(closed, "truck").effect).toBe("blocked");
  });

  it("signature changes when a zone's passability changes", () => {
    const a = hazardSignature(hazardsFromData([zone({ waterLevelM: 0.2 })], []));
    const b = hazardSignature(hazardsFromData([zone({ waterLevelM: 0.7 })], []));
    expect(a).not.toEqual(b);
    expect(hazardSignature(hazardsFromData([zone({ waterLevelM: 0.2 })], []))).toEqual(a);
  });
});

// ---- evaluation -------------------------------------------------------------------

describe("evaluateRoute", () => {
  const line = densify([ORIGIN, DEST]);

  it("marks a route through a non-passable zone as unsafe", () => {
    const hazards = hazardsFromData([zone({ waterLevelM: 0.7 })], []);
    const e = evaluateRoute({ geometry: line }, hazards, "car");
    expect(e.status).toBe("unsafe");
    expect(e.blocked[0].name).toBe("Test flood");
  });

  it("marks passable flooding as caution, and far-away zones as not affecting the route", () => {
    const hazards = hazardsFromData([zone({ waterLevelM: 0.3 }), zone({ id: "far", center: [13.5, 121.3] })], []);
    const e = evaluateRoute({ geometry: line }, hazards, "suv");
    expect(e.status).toBe("caution");
    expect(e.blocked).toHaveLength(0);
    expect(e.nearby.find((n) => n.hazardId === "zone:far")).toBeUndefined();
  });

  it("lists zones close to (but not on) the route as nearby", () => {
    const near: Pt = [13.4018, 121.175]; // ~200 m north of the road, radius 100 m
    const hazards = hazardsFromData([zone({ center: near, radiusM: 100, waterLevelM: 0.9 })], []);
    const e = evaluateRoute({ geometry: line }, hazards, "car");
    expect(e.status).toBe("safe");
    expect(e.nearby).toHaveLength(1);
    expect(e.nearby[0].distanceM).toBeGreaterThan(0);
  });

  it("flags stale and simulated data", () => {
    const hazards = hazardsFromData([zone({ updatedAt: Date.now() - 9 * 3600_000, simulated: true, waterLevelM: 0.3 })], []);
    const e = evaluateRoute({ geometry: line }, hazards, "truck");
    expect(e.freshness.staleCount).toBe(1);
    expect(e.notes.join(" ")).toMatch(/6 hours/);
    expect(e.notes.join(" ")).toMatch(/SIMULATED/);
  });

  it("detects road-closure lines the route travels along or crosses", () => {
    const road: RoadCondition = {
      id: "r", name: "Crossing closure", path: [{ lat: 13.395, lng: 121.18 }, { lat: 13.405, lng: 121.18 }], status: "closed",
      passability: suggestPassability(0), reason: "", area: "x", source: "drrm", active: true, updatedBy: "u", updatedAt: Date.now(),
    };
    const [h] = hazardsFromData([], [road]);
    expect(routeHitsHazard(line, h)).toBe(true);
    expect(evaluateRoute({ geometry: line }, [h], "bicycle").status).toBe("unsafe");
  });
});

// ---- planner -------------------------------------------------------------------------

describe("planSafeRoute", () => {
  it("returns the direct route when nothing is in the way", async () => {
    const provider = straightLineProvider();
    const plan = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "car" }, [], [provider]);
    expect(plan.status).toBe("safe");
    expect(plan.recommended!.label).toBe("Fastest");
    expect(provider.calls).toHaveLength(1);
    expect(plan.explanation).toMatch(/No verified flooding/);
  });

  it("finds a detour around a blocking flood and explains what it avoided", async () => {
    const provider = straightLineProvider();
    const hazards = hazardsFromData([zone({ waterLevelM: 0.7 })], []);
    const plan = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "car" }, hazards, [provider]);
    expect(plan.status).toBe("safe");
    expect(plan.recommended!.via.length).toBeGreaterThan(0);
    expect(plan.recommended!.evaluation.blocked).toHaveLength(0);
    expect(plan.avoided.map((a) => a.hazardId)).toEqual(["zone:z1"]);
    expect(plan.explanation).toMatch(/avoids 1 flooded area/);
    // The blocked fastest route is still shown as an alternative, marked unsafe.
    expect(plan.alternatives.some((a) => a.evaluation.status === "unsafe")).toBe(true);
    expect(plan.requestsUsed).toBeLessThanOrEqual(7);
  });

  it("lets vehicles with enough clearance use the direct route (with a caution)", async () => {
    const hazards = hazardsFromData([zone({ waterLevelM: 0.55 })], []);
    const plan = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "truck" }, hazards, [straightLineProvider()]);
    // Truck can pass at tire level: the direct route is "caution", a detour
    // may be found that is fully safe — either way it is never blocked.
    expect(plan.status === "safe" || plan.status === "caution").toBe(true);
    expect(plan.recommended!.evaluation.blocked).toHaveLength(0);
  });

  it("prefers a fully safe route over a faster flooded-but-passable one", async () => {
    // Engine offers two routes: fast through passable water, slower dry one.
    const wet = densify([ORIGIN, DEST]);
    const dry = densify([ORIGIN, [13.42, 121.175], DEST]);
    const provider: RoutingProvider = {
      name: "two",
      async route() {
        return [
          { provider: "two", geometry: wet, distanceM: 5400, durationS: 540, via: [], steps: [] },
          { provider: "two", geometry: dry, distanceM: 6400, durationS: 640, via: [], steps: [] },
        ];
      },
    };
    const hazards = hazardsFromData([zone({ waterLevelM: 0.3 })], []);
    const plan = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "suv" }, hazards, [provider]);
    expect(plan.recommended!.durationS).toBe(640);
    expect(plan.status).toBe("safe");
    expect(plan.alternatives[0].evaluation.status).toBe("caution");
  });

  it("reports no safe route instead of inventing one when every path is blocked", async () => {
    // A closure so large no via point within the search can escape it.
    const hazards = hazardsFromData([zone({ radiusM: 20_000, waterLevelM: 1.5 })], []);
    const plan = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "car" }, hazards, [straightLineProvider()], {
      maxDetourRequests: 4,
    });
    expect(plan.status).toBe("no_safe_route");
    expect(plan.recommended).toBeNull();
    expect(plan.explanation).toMatch(/No verified safe route/);
  });

  it("falls back to the next provider when the first fails", async () => {
    const broken: RoutingProvider = { name: "broken", route: async () => { throw new Error("down"); } };
    const plan = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "car" }, [], [broken, straightLineProvider()]);
    expect(plan.provider).toBe("fake");
    expect(plan.status).toBe("safe");
  });

  it("falls back when a provider returns no candidates", async () => {
    const empty: RoutingProvider = { name: "empty", route: async () => [] };
    const plan = await planSafeRoute(
      { origin: ORIGIN, destination: DEST, mode: "car" },
      [],
      [empty, straightLineProvider()],
    );
    expect(plan.provider).toBe("fake");
    expect(plan.status).toBe("safe");
  });

  it("falls back instead of recommending malformed geometry", async () => {
    const malformed: RoutingProvider = {
      name: "malformed",
      route: async () => [{
        provider: "malformed",
        geometry: [[Number.NaN, 121.15]],
        distanceM: Number.NaN,
        durationS: -1,
        via: [],
        steps: [],
      }],
    };
    const plan = await planSafeRoute(
      { origin: ORIGIN, destination: DEST, mode: "car" },
      [],
      [malformed, straightLineProvider()],
    );
    expect(plan.provider).toBe("fake");
    expect(plan.recommended?.geometry.length).toBeGreaterThan(1);
  });

  it("plans multi-stop routes leg by leg", async () => {
    const provider = straightLineProvider();
    const hazards = hazardsFromData([zone({ center: [13.4, 121.19], waterLevelM: 0.7 })], []);
    const plan = await planSafeRoute(
      { origin: ORIGIN, waypoints: [MID], destination: DEST, mode: "car" },
      hazards,
      [provider]
    );
    expect(plan.status).toBe("safe");
    expect(plan.recommended!.label).toMatch(/via 1 stop/);
    expect(plan.recommended!.steps.filter((s) => s.type === "arrive")).toHaveLength(1);
  });

  it("applies the truck travel-time factor when the engine has no truck profile", async () => {
    const osrmLike = Object.assign(straightLineProvider(), { nativeProfiles: ["car", "bike", "foot"] });
    const car = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "car" }, [], [osrmLike]);
    const truck = await planSafeRoute({ origin: ORIGIN, destination: DEST, mode: "truck" }, [], [osrmLike]);
    expect(truck.recommended!.durationS).toBeCloseTo(car.recommended!.durationS * 1.25, 3);
  });
});

// ---- providers ---------------------------------------------------------------------------

describe("providers", () => {
  it("OSRM: parses routes and builds instructions from maneuvers", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/route/v1/driving/121.150000,13.400000;121.200000,13.400000");
      expect(url).toContain("alternatives=3");
      return new Response(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 5400,
              duration: 600,
              geometry: { coordinates: [[121.15, 13.4], [121.2, 13.4]] },
              legs: [
                {
                  steps: [
                    { distance: 5400, duration: 600, name: "Nautical Hwy", maneuver: { type: "depart", location: [121.15, 13.4], bearing_after: 90 } },
                    { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", location: [121.2, 13.4] } },
                  ],
                },
              ],
            },
          ],
        })
      );
    });
    const p = createOsrmProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [r] = await p.route([ORIGIN, DEST], "car", { alternatives: true });
    expect(r.geometry[0]).toEqual([13.4, 121.15]);
    expect(r.steps[0].instruction).toBe("Head east on Nautical Hwy");
    expect(r.steps[1].instruction).toBe("Arrive at your destination");
  });

  it("ORS: sends blocking hazards as avoid_polygons and uses the HGV profile for trucks", async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({
          features: [
            {
              geometry: { coordinates: [[121.15, 13.4], [121.2, 13.4]] },
              properties: { summary: { distance: 5500, duration: 700 }, segments: [{ steps: [{ distance: 5500, duration: 700, instruction: "Head east", name: "-", type: 11, way_points: [0, 1] }] }] },
            },
          ],
        })
      );
    });
    const p = createOrsProvider({ apiKey: "test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const hazards: Hazard[] = hazardsFromData([zone({ waterLevelM: 1.2 })], []);
    await p.route([ORIGIN, DEST], "truck", { alternatives: false, avoid: hazards });
    expect(captured!.url).toContain("/v2/directions/driving-hgv/geojson");
    const avoid = (captured!.body.options as { avoid_polygons: { type: string; coordinates: number[][][][] } }).avoid_polygons;
    expect(avoid.type).toBe("MultiPolygon");
    const ring = avoid.coordinates[0][0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed ring, [lng, lat]
  });

  it("instruction text in English and Filipino", () => {
    expect(instructionText({ type: "turn", modifier: "left", name: "Roxas Dr" })).toBe("Turn left onto Roxas Dr");
    expect(instructionText({ type: "turn", modifier: "left", name: "Roxas Dr" }, "fil")).toBe("Kumaliwa papunta sa Roxas Dr");
    expect(instructionText({ type: "roundabout", exit: 2 })).toBe("At the roundabout, take the 2nd exit");
    expect(instructionText({ type: "arrive" }, "fil")).toBe("Nakarating ka na sa iyong destinasyon");
  });
});
