/**
 * Flood-aware route planner.
 *
 * Deterministic: routes come only from the routing engine (OSRM/ORS) and
 * are judged only against DRRM-verified hazards. AI may later *explain*
 * the result, but never chooses or invents roads or conditions.
 *
 * Strategy per leg:
 *  1. Ask the engine for the fastest route + alternatives
 *     (ORS: with blocking hazards passed as avoid_polygons).
 *  2. Evaluate each against hazards for this travel mode.
 *  3. If every candidate passes through a blocking hazard, search for a
 *     detour by routing via points placed outside the hazard on either
 *     side of the road (bounded number of engine requests).
 *  4. Recommend the fastest *safe* route; a faster route through
 *     passable-but-flooded roads is offered only as an alternative.
 */
import { bearingDeg, destinationPoint, haversineM, nearestVertex, type Pt } from "../geo";
import { evaluateRoute, hazardExtent, routeHitsHazard } from "./evaluate";
import { hazardEffect, hazardSignature } from "./hazards";
import { profileIsNative } from "./providers";
import { buildExplanation } from "./explain";
import {
  MODE_DURATION_FACTOR,
  type EvaluatedRoute,
  type Hazard,
  type HazardHit,
  type PlanRequest,
  type PlanResult,
  type RouteCandidate,
  type RoutingProvider,
  type TravelMode,
} from "./types";

export interface PlanOptions {
  /** Engine requests allowed per leg for detour search. */
  maxDetourRequests?: number;
  now?: number;
}

const RANK: Record<EvaluatedRoute["evaluation"]["status"], number> = { safe: 0, caution: 1, unsafe: 2 };

function scale(c: RouteCandidate, factor: number): RouteCandidate {
  return factor === 1 ? c : { ...c, durationS: c.durationS * factor };
}

async function tryProviders(
  providers: RoutingProvider[],
  points: Pt[],
  mode: TravelMode,
  opts: { alternatives: boolean; avoid?: Hazard[]; language?: "en" | "fil" },
  counter: { n: number; used?: string }
): Promise<RouteCandidate[]> {
  let lastErr: unknown;
  for (const p of providers) {
    try {
      counter.n++;
      const native = profileIsNative(p, mode);
      const factor = native ? (mode === "motorcycle" ? MODE_DURATION_FACTOR.motorcycle : 1) : MODE_DURATION_FACTOR[mode];
      const supportsAvoid = (p as { supportsAvoid?: boolean }).supportsAvoid === true;
      const res = await p.route(points, mode, { ...opts, avoid: supportsAvoid ? opts.avoid : undefined });
      counter.used = p.name;
      return res.map((c) => scale(c, factor));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("No routing provider available.");
}

/** Via-point candidates around a hazard, on both sides of the route. */
export function detourViaPoints(route: Pt[], hazard: Hazard): Pt[] {
  const { center, radiusM } = hazardExtent(hazard);
  const clearance = Math.max(400, radiusM + 300);
  const { index } = nearestVertex(center, route);
  const a = route[Math.max(0, index - 6)];
  const b = route[Math.min(route.length - 1, index + 6)];
  const heading = haversineM(a, b) > 5 ? bearingDeg(a, b) : 0;
  return [
    destinationPoint(center, heading - 90, clearance),
    destinationPoint(center, heading + 90, clearance),
    destinationPoint(center, heading - 90, clearance * 2.2),
    destinationPoint(center, heading + 90, clearance * 2.2),
  ];
}

function firstBlockingHazard(route: Pt[], hits: HazardHit[], hazards: Hazard[]): Hazard | null {
  const byId = new Map(hazards.map((h) => [h.id, h]));
  let best: { h: Hazard; idx: number } | null = null;
  for (const hit of hits) {
    const h = byId.get(hit.hazardId);
    if (!h) continue;
    const idx = nearestVertex(hazardExtent(h).center, route).index;
    if (!best || idx < best.idx) best = { h, idx };
  }
  return best?.h ?? null;
}

interface LegResult {
  candidates: EvaluatedRoute[];
  fastest: EvaluatedRoute | null;
}

async function planLeg(
  origin: Pt,
  destination: Pt,
  mode: TravelMode,
  hazards: Hazard[],
  providers: RoutingProvider[],
  opts: PlanOptions & { language?: "en" | "fil" },
  counter: { n: number; used?: string }
): Promise<LegResult> {
  const now = opts.now ?? Date.now();
  const blockingForMode = hazards.filter((h) => hazardEffect(h, mode).effect === "blocked");
  const evaluated: EvaluatedRoute[] = [];
  let seq = 0;
  const add = (c: RouteCandidate, label: string) => {
    const e: EvaluatedRoute = { ...c, id: `r${seq++}`, label, evaluation: evaluateRoute(c, hazards, mode, now) };
    evaluated.push(e);
    return e;
  };

  // 1) Baseline (fastest, ignoring hazards) + engine alternatives.
  const base = await tryProviders(providers, [origin, destination], mode, { alternatives: true, language: opts.language }, counter);
  base.forEach((c, i) => add(c, i === 0 ? "Fastest" : `Alternative ${i}`));
  const fastest = evaluated[0] ?? null;

  // 1b) Engines with native avoidance get one avoid request.
  const avoidCapable = providers.some((p) => (p as { supportsAvoid?: boolean }).supportsAvoid);
  if (avoidCapable && blockingForMode.length && evaluated.every((e) => e.evaluation.status === "unsafe")) {
    try {
      const avoided = await tryProviders(
        providers,
        [origin, destination],
        mode,
        { alternatives: false, avoid: blockingForMode, language: opts.language },
        counter
      );
      avoided.forEach((c) => add(c, "Flood-avoiding route"));
    } catch {
      /* fall through to detour search */
    }
  }

  // 2) Detour search when every candidate is blocked.
  const budget = opts.maxDetourRequests ?? 6;
  let used = 0;
  const tried = new Set<string>();
  while (evaluated.every((e) => e.evaluation.status === "unsafe") && used < budget) {
    const bestBlocked = [...evaluated].sort((a, b) => a.evaluation.blocked.length - b.evaluation.blocked.length || a.durationS - b.durationS)[0];
    const hazard = firstBlockingHazard(bestBlocked.geometry, bestBlocked.evaluation.blocked, hazards);
    if (!hazard) break;
    const vias = detourViaPoints(bestBlocked.geometry, hazard).filter((v) => !blockingForMode.some((h) => routeHitsHazard([v, v], h)));
    let progressed = false;
    for (const via of vias) {
      if (used >= budget) break;
      // Keep earlier detour vias from the candidate we're improving on.
      const chain = [...bestBlocked.via, via];
      const key = chain.map((p) => p.map((n) => n.toFixed(4)).join(",")).join("|");
      if (tried.has(key)) continue;
      tried.add(key);
      used++;
      progressed = true;
      try {
        const res = await tryProviders(providers, [origin, ...chain, destination], mode, { alternatives: false, language: opts.language }, counter);
        const e = add({ ...res[0], via: chain }, "Detour around flooding");
        if (e.evaluation.status !== "unsafe") break;
      } catch {
        /* try the next via point */
      }
    }
    if (!progressed) break;
  }

  return { candidates: evaluated, fastest };
}

/**
 * Safety first: the fastest fully safe route wins even when a route
 * through passable-but-flooded roads is quicker (that one is offered as
 * an alternative). A caution route is recommended only if no safe one exists.
 */
export function chooseRecommended(candidates: EvaluatedRoute[]): EvaluatedRoute | null {
  const byTime = (a: EvaluatedRoute, b: EvaluatedRoute) => a.durationS - b.durationS;
  const safe = candidates.filter((c) => c.evaluation.status === "safe").sort(byTime);
  const caution = candidates.filter((c) => c.evaluation.status === "caution").sort(byTime);
  return safe[0] ?? caution[0] ?? null;
}

function dedupe(candidates: EvaluatedRoute[]): EvaluatedRoute[] {
  const seen: EvaluatedRoute[] = [];
  for (const c of candidates) {
    const dup = seen.find(
      (s) => Math.abs(s.distanceM - c.distanceM) < 30 && Math.abs(s.durationS - c.durationS) < 20 && s.evaluation.status === c.evaluation.status
    );
    if (!dup) seen.push(c);
  }
  return seen;
}

function joinLegs(legs: EvaluatedRoute[], hazards: Hazard[], mode: TravelMode, now: number): EvaluatedRoute {
  const geometry = legs.flatMap((l, i) => (i === 0 ? l.geometry : l.geometry.slice(1)));
  const joined: RouteCandidate = {
    provider: legs[0].provider,
    geometry,
    distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
    durationS: legs.reduce((s, l) => s + l.durationS, 0),
    steps: legs.flatMap((l, i) => (i < legs.length - 1 ? l.steps.filter((s) => s.type !== "arrive") : l.steps)),
    via: legs.flatMap((l) => l.via),
  };
  return { ...joined, id: "multi", label: legs.length > 1 ? `Route via ${legs.length - 1} stop${legs.length > 2 ? "s" : ""}` : legs[0].label, evaluation: evaluateRoute(joined, hazards, mode, now) };
}

export async function planSafeRoute(
  req: PlanRequest,
  hazards: Hazard[],
  providers: RoutingProvider[],
  opts: PlanOptions = {}
): Promise<PlanResult> {
  const now = opts.now ?? Date.now();
  const counter = { n: 0, used: undefined as string | undefined };
  const stops = [req.origin, ...(req.waypoints ?? []), req.destination];
  const legOpts = { ...opts, language: req.language };

  let recommended: EvaluatedRoute | null;
  let alternatives: EvaluatedRoute[];
  let fastest: EvaluatedRoute | null;

  if (stops.length === 2) {
    const leg = await planLeg(stops[0], stops[1], req.mode, hazards, providers, legOpts, counter);
    const all = dedupe(leg.candidates).sort((a, b) => RANK[a.evaluation.status] - RANK[b.evaluation.status] || a.durationS - b.durationS);
    recommended = chooseRecommended(all);
    alternatives = all.filter((c) => c !== recommended);
    fastest = leg.fastest;
  } else {
    // Multi-stop (fleet): plan each leg independently, then join.
    const best: EvaluatedRoute[] = [];
    const fast: EvaluatedRoute[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const leg = await planLeg(stops[i], stops[i + 1], req.mode, hazards, providers, { ...legOpts, maxDetourRequests: opts.maxDetourRequests ?? 4 }, counter);
      const pick =
        chooseRecommended(leg.candidates) ??
        [...leg.candidates].sort((a, b) => a.evaluation.blocked.length - b.evaluation.blocked.length || a.durationS - b.durationS)[0];
      best.push(pick);
      if (leg.fastest) fast.push(leg.fastest);
    }
    const joined = joinLegs(best, hazards, req.mode, now);
    recommended = joined.evaluation.status === "unsafe" ? null : joined;
    alternatives = joined.evaluation.status === "unsafe" ? [joined] : [];
    fastest = fast.length === best.length ? joinLegs(fast, hazards, req.mode, now) : null;
  }

  const avoided: HazardHit[] =
    recommended && fastest
      ? fastest.evaluation.blocked.filter((b) => !recommended!.evaluation.blocked.some((r) => r.hazardId === b.hazardId))
      : [];

  const status: PlanResult["status"] = !recommended
    ? "no_safe_route"
    : recommended.evaluation.status === "safe"
    ? "safe"
    : "caution";

  const notes = [
    "Only DRRM-verified flood zones and road conditions are used. Unverified community reports never change routes.",
    "Water levels change quickly. Never drive or walk into floodwater you cannot see the bottom of.",
  ];
  if (counter.used === "osrm" && hazards.some((h) => hazardEffect(h, req.mode).effect === "blocked")) {
    notes.push("Detours are found by testing alternative paths around blocked areas; very large closures may leave no safe route.");
  }

  const result: PlanResult = {
    status,
    recommended,
    alternatives: alternatives.slice(0, 4),
    avoided,
    hazardsConsidered: hazards.length,
    provider: counter.used ?? providers[0]?.name ?? "unknown",
    mode: req.mode,
    computedAt: now,
    requestsUsed: counter.n,
    explanation: "",
    notes,
    hazardSignature: hazardSignature(hazards),
  };
  result.explanation = buildExplanation(result, req.language ?? "en");
  return result;
}
