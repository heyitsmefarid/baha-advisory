// Manual connectivity check for the public OSRM servers (not part of CI).
import { createOsrmProvider, planSafeRoute, hazardsFromData } from "../../shared/routing";
import { circleToPolygon } from "../../shared/geo";
import { suggestPassability, suggestRoadPassability } from "../../shared/passability";

const osrm = createOsrmProvider();
const origin: [number, number] = [13.4194, 121.1978]; // Calapan port area
const dest: [number, number] = [13.3742, 121.1702]; // Bucayao
const direct = await planSafeRoute({ origin, destination: dest, mode: "car" }, [], [osrm]);
const r = direct.recommended!;
console.log("direct:", direct.status, Math.round(r.distanceM), "m", Math.round(r.durationS / 60), "min, steps", r.steps.length, "provider", direct.provider);
console.log("first steps:", r.steps.slice(0, 3).map((s) => s.instruction));
// Put a closure at the route midpoint and replan.
const mid = r.geometry[Math.floor(r.geometry.length / 2)];
const zone = {
  id: "live", name: "Live test closure", geometry: { type: "polygon" as const, coordinates: circleToPolygon(mid, 120, 12) },
  waterLevelM: 1.0, trend: "rising" as const, trendDeltaM: 0, roadPassability: suggestRoadPassability(1.0), passability: suggestPassability(1.0),
  notes: "", status: "active" as const, area: "Calapan City", updatedBy: "x", updatedAt: Date.now(),
};
const plan = await planSafeRoute({ origin, destination: dest, mode: "car" }, hazardsFromData([zone], []), [osrm]);
console.log("with closure:", plan.status, plan.recommended ? Math.round(plan.recommended.distanceM) + " m" : "-", "requests", plan.requestsUsed, "avoided", plan.avoided.length);
console.log(plan.explanation);
