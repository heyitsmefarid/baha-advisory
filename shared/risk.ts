/**
 * EXPERIMENTAL flood-risk scoring — transparent, rule-based, explainable.
 *
 * This is NOT a validated flood forecast and makes no accuracy claim.
 * There is not enough labelled local flood history to train or validate
 * a statistical model, so every point in the score comes from a published
 * threshold or a plainly stated heuristic that a DRRM officer can audit:
 *
 *  factor                         max   basis
 *  forecast rain intensity         25   PAGASA rainfall advisory colours
 *                                        (yellow 7.5–15, orange 15–30, red > 30 mm/h)
 *  forecast 24 h accumulation      15   heuristic bands
 *  antecedent rain (past 72 h)     15   soil saturation heuristic
 *  verified flooding in the area   20   active DRRM zones (MMDA gauge levels)
 *  river gauge vs thresholds       15   station alert / alarm / critical levels
 *  local flood history (90 days)    5   count of past DRRM flood zones
 *  low elevation                    5   Open-Meteo elevation (90 m DEM)
 *
 * Missing inputs score 0 and lower the reported data completeness.
 */
import type { RiskFactor, RiskLevel } from "./types";

export const RISK_MODEL_VERSION = "rules-v1";

export interface RiskInputs {
  /** Hourly forecast for the next 24 h (mm/h); null when unavailable. */
  forecastHourlyMm: number[] | null;
  /** Observed precipitation over the past 72 h (mm), null when unavailable. */
  past72hMm: number | null;
  activeZones: { waterLevelM: number; rising: boolean }[];
  /** Highest station level relative to its thresholds, null = no station. */
  station: { levelM: number; alertM: number; alarmM: number; criticalM: number; rising: boolean } | null;
  historicalEvents90d: number | null;
  elevationM: number | null;
}

export function riskLevel(score: number): RiskLevel {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#1f9d55",
  moderate: "#e08a1e",
  high: "#d64545",
  critical: "#7a1f2b",
};

function intensityPoints(maxHourlyMm: number): number {
  if (maxHourlyMm > 30) return 25;
  if (maxHourlyMm >= 15) return 18;
  if (maxHourlyMm >= 7.5) return 11;
  if (maxHourlyMm >= 2.5) return 4;
  return 0;
}

function accumulationPoints(mm: number): number {
  if (mm >= 100) return 15;
  if (mm >= 50) return 10;
  if (mm >= 25) return 6;
  if (mm >= 10) return 3;
  return 0;
}

function antecedentPoints(mm: number): number {
  if (mm >= 150) return 15;
  if (mm >= 80) return 10;
  if (mm >= 40) return 6;
  if (mm >= 15) return 3;
  return 0;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

/** Static (non-hourly) factors shared by the overall and per-hour scores. */
function staticFactors(i: RiskInputs): RiskFactor[] {
  const out: RiskFactor[] = [];

  out.push(
    i.past72hMm == null
      ? { key: "antecedent", label: "Rain in the past 3 days", points: 0, maxPoints: 15, detail: "Recent rainfall data unavailable.", available: false }
      : {
          key: "antecedent",
          label: "Rain in the past 3 days",
          points: antecedentPoints(i.past72hMm),
          maxPoints: 15,
          detail: `${i.past72hMm.toFixed(0)} mm fell in the last 72 h${i.past72hMm >= 80 ? " — ground is likely saturated" : ""}.`,
          available: true,
        }
  );

  const maxLevel = Math.max(0, ...i.activeZones.map((z) => z.waterLevelM));
  const rising = i.activeZones.some((z) => z.rising);
  let zonePts = 0;
  if (i.activeZones.length) {
    zonePts = maxLevel >= 0.94 ? 20 : maxLevel >= 0.48 ? 15 : maxLevel >= 0.25 ? 10 : 6;
    if (rising) zonePts = Math.min(20, zonePts + 3);
  }
  out.push({
    key: "verified_flooding",
    label: "Verified flooding now",
    points: zonePts,
    maxPoints: 20,
    detail: i.activeZones.length
      ? `${i.activeZones.length} active DRRM flood zone(s), deepest ${maxLevel.toFixed(2)} m${rising ? ", water rising" : ""}.`
      : "No active DRRM flood zones in this area.",
    available: true,
  });

  if (i.station) {
    const s = i.station;
    let pts = s.levelM >= s.criticalM ? 15 : s.levelM >= s.alarmM ? 11 : s.levelM >= s.alertM ? 7 : 0;
    if (s.rising && pts < 15) pts = Math.min(15, pts + 3);
    const stage = s.levelM >= s.criticalM ? "critical" : s.levelM >= s.alarmM ? "alarm" : s.levelM >= s.alertM ? "alert" : "normal";
    out.push({
      key: "river_gauge",
      label: "River gauge",
      points: pts,
      maxPoints: 15,
      detail: `Gauge at ${s.levelM.toFixed(2)} m (${stage} stage; alert ${s.alertM} m / alarm ${s.alarmM} m)${s.rising ? ", rising" : ""}.`,
      available: true,
    });
  } else {
    out.push({ key: "river_gauge", label: "River gauge", points: 0, maxPoints: 15, detail: "No water-level station in this area.", available: false });
  }

  if (i.historicalEvents90d == null) {
    out.push({ key: "history", label: "Recent flood history", points: 0, maxPoints: 5, detail: "History unavailable.", available: false });
  } else {
    const n = i.historicalEvents90d;
    out.push({
      key: "history",
      label: "Recent flood history",
      points: n >= 6 ? 5 : n >= 3 ? 3 : n >= 1 ? 1 : 0,
      maxPoints: 5,
      detail: `${n} DRRM flood zone(s) recorded here in the last 90 days.`,
      available: true,
    });
  }

  if (i.elevationM == null) {
    out.push({ key: "elevation", label: "Elevation", points: 0, maxPoints: 5, detail: "Elevation unavailable.", available: false });
  } else {
    const e = i.elevationM;
    out.push({
      key: "elevation",
      label: "Elevation",
      points: e < 5 ? 5 : e < 15 ? 3 : e < 30 ? 1 : 0,
      maxPoints: 5,
      detail: `Town centre about ${e.toFixed(0)} m above sea level${e < 15 ? " (low-lying)" : ""}.`,
      available: true,
    });
  }
  return out;
}

function forecastFactors(hourly: number[] | null): RiskFactor[] {
  if (!hourly || hourly.length === 0) {
    return [
      { key: "intensity", label: "Forecast rain intensity", points: 0, maxPoints: 25, detail: "Weather forecast unavailable.", available: false },
      { key: "accumulation", label: "Forecast rain (24 h)", points: 0, maxPoints: 15, detail: "Weather forecast unavailable.", available: false },
    ];
  }
  const maxH = Math.max(0, ...hourly.map((x) => (Number.isFinite(x) ? x : 0)));
  const total = sum(hourly);
  const band = maxH > 30 ? "red-level (>30 mm/h)" : maxH >= 15 ? "orange-level (15–30 mm/h)" : maxH >= 7.5 ? "yellow-level (7.5–15 mm/h)" : "light";
  return [
    {
      key: "intensity",
      label: "Forecast rain intensity",
      points: intensityPoints(maxH),
      maxPoints: 25,
      detail: `Heaviest forecast hour: ${maxH.toFixed(1)} mm/h — ${band} rain.`,
      available: true,
    },
    {
      key: "accumulation",
      label: "Forecast rain (24 h)",
      points: accumulationPoints(total),
      maxPoints: 15,
      detail: `${total.toFixed(0)} mm expected over the next 24 h.`,
      available: true,
    },
  ];
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  dataCompleteness: number;
  hourly: { offsetH: number; score: number; level: RiskLevel; precipMm: number }[];
}

export function scoreRisk(i: RiskInputs): RiskResult {
  const statics = staticFactors(i);
  const factors = [...forecastFactors(i.forecastHourlyMm), ...statics];
  const score = Math.min(100, sum(factors.map((f) => f.points)));
  const staticPts = sum(statics.map((f) => f.points));
  const hourlyMm = i.forecastHourlyMm ?? [];
  // Per-hour outlook: rain intensity and the accumulation still to come
  // within a rolling 6 h window, plus the static factors.
  const hourly = hourlyMm.map((mm, h) => {
    const window = hourlyMm.slice(h, h + 6);
    const pts = staticPts + intensityPoints(Math.max(0, ...window)) + accumulationPoints(sum(hourlyMm.slice(Math.max(0, h - 18), h + 6)));
    const s = Math.min(100, pts);
    return { offsetH: h, score: s, level: riskLevel(s), precipMm: Math.round(mm * 10) / 10 };
  });
  return {
    score,
    level: riskLevel(score),
    factors,
    dataCompleteness: Math.round((factors.filter((f) => f.available).length / factors.length) * 100) / 100,
    hourly,
  };
}

export const RISK_DISCLAIMER =
  "Experimental risk indicator, not an official forecast. It combines weather forecasts, recent rain, DRRM-verified flooding, river gauges, local history and elevation using transparent rules. It has not been validated against observed floods — always follow PAGASA and your LGU's official advisories.";
