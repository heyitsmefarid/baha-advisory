import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { forbidden, json } from "../lib/http";
import { getAuthCtx } from "../lib/auth";
import { memoryRateLimit } from "../lib/rateLimit";
import { loadOfficialData } from "../lib/hazards";
import { RISK_DISCLAIMER, RISK_MODEL_VERSION, scoreRisk, type RiskInputs } from "../../shared/risk";
import { toMillis } from "../../shared/time";
import type { FloodRiskPrediction, WaterLevelStation } from "../../shared/types";
import type { RouteCtx } from "../router";
import { legacyAreaToMunicipality, MINDORO_CATALOG, type GeographicUnit } from "../../shared/geography";
import { referenceForMunicipality } from "../lib/geography";

const STALE_MS = 30 * 60_000;
const H = 3600_000;
let inflight: Promise<FloodRiskPrediction[]> | null = null;

export const areaKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

interface WeatherRow {
  hourly?: { time: string[]; precipitation: (number | null)[]; precipitation_probability?: (number | null)[] };
  elevation?: number;
}

export interface RiskTarget {
  psgcCode: string;
  name: string;
  center: [number, number];
}

export function buildRiskTargets(catalog: GeographicUnit[] = MINDORO_CATALOG): RiskTarget[] {
  return catalog
    .filter((unit) => unit.level === "city" || unit.level === "municipality")
    .map((unit) => ({ psgcCode: unit.psgcCode, name: unit.name, center: unit.center }));
}

const RISK_TARGETS = buildRiskTargets();
const WEATHER_BATCH_SIZE = 10;

/** Open-Meteo (free, no key): 3 days back + 2 days ahead, hourly rain. */
async function fetchWeatherBatch(targets: RiskTarget[]): Promise<WeatherRow[] | null> {
  const lats = targets.map((a) => a.center[0]).join(",");
  const lngs = targets.map((a) => a.center[1]).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=precipitation,precipitation_probability&past_days=3&forecast_days=2&timezone=Asia%2FManila`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = (await res.json()) as WeatherRow | WeatherRow[];
    return Array.isArray(data) ? data : [data];
  } catch (err) {
    console.error("[risk] weather fetch failed", err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchWeather(targets: RiskTarget[] = RISK_TARGETS): Promise<(WeatherRow | null)[]> {
  const batches: RiskTarget[][] = [];
  for (let i = 0; i < targets.length; i += WEATHER_BATCH_SIZE) batches.push(targets.slice(i, i + WEATHER_BATCH_SIZE));
  const rows = await Promise.all(batches.map((batch) => fetchWeatherBatch(batch)));
  return rows.flatMap((result, index) => result ?? batches[index].map(() => null));
}

/** "YYYY-MM-DDTHH:00" for the current hour in Asia/Manila (Open-Meteo local time). */
function manilaHourKey(now: number): string {
  return new Date(now + 8 * H).toISOString().slice(0, 13) + ":00";
}

const simulatedAreas = new Set<string>();

function municipalityCode(value: { municipalityPsgcCode?: string | null; area?: string | null }): string | null {
  return value.municipalityPsgcCode ?? legacyAreaToMunicipality(value.area)?.psgcCode ?? null;
}

async function stationInputs(): Promise<Map<string, RiskInputs["station"]>> {
  const db = getDb();
  const snap = await db.collection("water_level_stations").where("active", "==", true).get();
  const byArea = new Map<string, RiskInputs["station"]>();
  for (const d of snap.docs) {
    const s = { id: d.id, ...(d.data() as Omit<WaterLevelStation, "id">) };
    if (s.lastLevelM == null) continue;
    const code = municipalityCode(s);
    if (!code) continue;
    if (s.simulated || s.source === "simulated") simulatedAreas.add(code);
    const readings = await d.ref.collection("readings").orderBy("recordedAt", "desc").limit(4).get();
    const levels = readings.docs.map((r) => r.get("levelM") as number);
    const rising = levels.length >= 2 && levels[0] - levels[levels.length - 1] > 0.05;
    const candidate = { levelM: s.lastLevelM, alertM: s.thresholds.alertM, alarmM: s.thresholds.alarmM, criticalM: s.thresholds.criticalM, rising };
    const prev = byArea.get(code);
    if (!prev || candidate.levelM / candidate.alarmM > prev.levelM / prev.alarmM) byArea.set(code, candidate);
  }
  return byArea;
}

export async function computeAllRisk(): Promise<FloodRiskPrediction[]> {
  const db = getDb();
  const now = Date.now();
  simulatedAreas.clear();
  const [weather, { zones }, stations, historySnap] = await Promise.all([
    fetchWeather(),
    loadOfficialData(true),
    stationInputs(),
    db.collection("floodZones").where("updatedAt", ">=", Timestamp.fromMillis(now - 90 * 24 * H)).get(),
  ]);
  const history = new Map<string, number>();
  historySnap.docs.forEach((d) => {
    const code = municipalityCode(d.data() as { municipalityPsgcCode?: string | null; area?: string | null });
    if (!code) return;
    history.set(code, (history.get(code) ?? 0) + 1);
    if (d.get("simulated")) simulatedAreas.add(code);
  });
  zones.forEach((z) => {
    const code = municipalityCode(z);
    if (z.simulated && code) simulatedAreas.add(code);
  });
  const hourKey = manilaHourKey(now);

  const out: FloodRiskPrediction[] = [];
  const batch = db.batch();
  RISK_TARGETS.forEach((area, i) => {
    const geography = referenceForMunicipality(area.psgcCode, "risk-model", "migrated");
    const w = weather?.[i];
    let forecast: number[] | null = null;
    let past72: number | null = null;
    let hourly: FloodRiskPrediction["hourly"] = [];
    const times = w?.hourly?.time ?? [];
    const idx = times.indexOf(hourKey);
    if (w?.hourly && idx >= 0) {
      const p = w.hourly.precipitation.map((x) => (typeof x === "number" ? x : 0));
      forecast = p.slice(idx, idx + 24);
      past72 = p.slice(Math.max(0, idx - 72), idx).reduce((a, b) => a + b, 0);
    }
    const inputs: RiskInputs = {
      forecastHourlyMm: forecast,
      past72hMm: past72,
      activeZones: zones.filter((z) => municipalityCode(z) === area.psgcCode).map((z) => ({ waterLevelM: z.waterLevelM, rising: z.trend === "rising" })),
      station: stations.get(area.psgcCode) ?? null,
      historicalEvents90d: history.get(area.psgcCode) ?? 0,
      elevationM: typeof w?.elevation === "number" ? w.elevation : null,
    };
    const r = scoreRisk(inputs);
    hourly = r.hourly.map((h) => ({ time: times[idx + h.offsetH] ?? "", score: h.score, level: h.level, precipMm: h.precipMm }));
    const key = area.psgcCode;
    const pred: FloodRiskPrediction = {
      id: key,
      area: area.name,
      center: { lat: area.center[0], lng: area.center[1] },
      computedAt: now,
      horizonHours: 24,
      score: r.score,
      level: r.level,
      factors: r.factors,
      hourly,
      dataCompleteness: r.dataCompleteness,
      modelVersion: RISK_MODEL_VERSION,
      experimental: true,
      simulatedInputs: simulatedAreas.has(area.psgcCode),
      sources: [
        w ? "Open-Meteo forecast & elevation" : "Weather unavailable",
        "DRRM-verified flood zones",
        inputs.station ? "Bahadvisory water-level stations" : "No river gauge",
      ],
      ...geography,
    };
    out.push(pred);
    batch.set(db.doc(`flood_risk_predictions/${key}`), { ...pred, computedAt: FieldValue.serverTimestamp() });
    if (w?.hourly && idx >= 0) {
      batch.set(db.doc(`weather_observations/${key}_${hourKey.replace(/[:T]/g, "-")}`), {
        area: area.name,
        center: pred.center,
        fetchedAt: FieldValue.serverTimestamp(),
        provider: "open-meteo",
        hourly: times.slice(Math.max(0, idx - 72), idx + 24).map((t, k) => ({
          time: t,
          precipMm: w.hourly!.precipitation[Math.max(0, idx - 72) + k] ?? 0,
          precipProb: w.hourly!.precipitation_probability?.[Math.max(0, idx - 72) + k] ?? null,
        })),
        elevationM: inputs.elevationM,
        ...geography,
      });
    }
  });
  await batch.commit();
  return out;
}

async function cachedPredictions(force: boolean): Promise<FloodRiskPrediction[]> {
  if (!force) {
    const snap = await getDb().collection("flood_risk_predictions").get();
    const targetCodes = new Set(RISK_TARGETS.map((target) => target.psgcCode));
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<FloodRiskPrediction, "id">) }))
      .filter((row) => targetCodes.has(row.id));
    const fresh = rows.length === RISK_TARGETS.length && rows.every((r) => Date.now() - (toMillis(r.computedAt) ?? 0) < STALE_MS);
    if (fresh) return rows;
  }
  inflight ??= computeAllRisk().finally(() => (inflight = null));
  return inflight;
}

/**
 * GET /api/risk — experimental area risk outlook (public). Recomputed at
 * most every 30 minutes; LGU staff may force a refresh with ?refresh=1.
 */
export async function getRisk(req: Request, ctx: RouteCtx): Promise<Response> {
  memoryRateLimit(`risk:${ctx.ip}`, 30, 60_000);
  let force = ctx.url.searchParams.get("refresh") === "1";
  if (force) {
    const auth = await getAuthCtx(req).catch(() => null);
    if (!auth || !["lgu_staff", "lgu_admin", "super_admin"].includes(auth.role)) throw forbidden("Only DRRM staff can force a refresh.");
    memoryRateLimit(`risk-refresh:${auth.uid}`, 4, 60_000);
  }
  const predictions = (await cachedPredictions(force)).sort((a, b) => b.score - a.score);
  return json({ modelVersion: RISK_MODEL_VERSION, disclaimer: RISK_DISCLAIMER, experimental: true, predictions });
}
