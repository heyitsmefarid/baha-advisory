import { timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { env } from "../lib/env";
import { HttpError, json, notFound, readJson, unauthorized } from "../lib/http";
import { memoryRateLimit } from "../lib/rateLimit";
import { invalidateHazardCache } from "../lib/hazards";
import { asObject, num, optNum, str } from "../../shared/validation";
import type { RouteCtx } from "../router";
import { geographicReferenceFrom } from "../lib/geography";
import { invalidateGeographicSummary } from "../lib/geographicSummary";

function tokenOk(given: string | null): boolean {
  const expected = env("SENSOR_INGEST_TOKEN");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/ingest/water-level — machine-to-machine endpoint for river
 * gauges / IoT sensors. Authenticated by the shared SENSOR_INGEST_TOKEN
 * header (x-sensor-token). Readings update the station and feed the
 * experimental risk model; they never publish public alerts on their
 * own — DRRM staff decide that.
 */
export async function ingestWaterLevel(req: Request, ctx: RouteCtx): Promise<Response> {
  if (!env("SENSOR_INGEST_TOKEN")) throw new HttpError(503, "Sensor ingest is not configured.", "not_configured");
  if (!tokenOk(req.headers.get("x-sensor-token"))) throw unauthorized("Invalid sensor token.");
  memoryRateLimit(`ingest:${ctx.ip}`, 120, 60_000);
  const body = asObject(await readJson(req));
  const stationId = str(body, "stationId", { max: 120, pattern: /^[A-Za-z0-9_-]+$/ });
  const levelM = num(body, "levelM", { min: 0, max: 30 });
  const recordedAtMs = optNum(body, "recordedAtMs", { min: Date.now() - 7 * 24 * 3600_000, max: Date.now() + 5 * 60_000 }) ?? Date.now();
  const db = getDb();
  const ref = db.doc(`water_level_stations/${stationId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Unknown station.");
  await ref.collection("readings").add({ levelM, recordedAt: Timestamp.fromMillis(recordedAtMs), source: "sensor", createdAt: FieldValue.serverTimestamp() });
  const last = snap.get("lastReadingAt");
  if (!last || recordedAtMs >= last.toMillis()) {
    await ref.update({ lastLevelM: levelM, lastReadingAt: Timestamp.fromMillis(recordedAtMs), source: "sensor" });
  }
  const geography = geographicReferenceFrom(snap.data() as Record<string, unknown>);
  if (geography) await invalidateGeographicSummary(geography);
  invalidateHazardCache();
  const t = snap.get("thresholds") as { alertM: number; alarmM: number; criticalM: number };
  const stage = levelM >= t.criticalM ? "critical" : levelM >= t.alarmM ? "alarm" : levelM >= t.alertM ? "alert" : "normal";
  return json({ ok: true, stationId, levelM, stage }, 201);
}
