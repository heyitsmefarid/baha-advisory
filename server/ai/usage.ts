import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { getAiSettings } from "../lib/settings";
import type { AiProviderName, AiTask, AiUsageLogEntry } from "../../shared/types";

/** USD estimate at list prices (free-tier calls cost $0 but are still tracked). */
export async function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): Promise<number> {
  const { pricing } = await getAiSettings();
  const p = pricing[model] ?? pricing.default ?? { inputPerM: 0, outputPerM: 0 };
  return Math.round(((inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1e6) * 1e6) / 1e6;
}

export async function logAiUsage(entry: Omit<AiUsageLogEntry, "at" | "estCostUsd">): Promise<void> {
  try {
    const estCostUsd = entry.provider === "simulated" ? 0 : await estimateCostUsd(entry.model, entry.inputTokens, entry.outputTokens);
    await getDb().collection("ai_usage_log").add({ ...entry, estCostUsd, at: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error("[ai-usage] log failed", err);
  }
}

// ---- Response cache for repeated, non-sensitive requests ------------------------------

const memory = new Map<string, { exp: number; value: CachedAi }>();

export interface CachedAi {
  text: string;
  provider: AiProviderName;
  model: string;
}

export function cacheKey(task: AiTask, parts: unknown): string {
  return createHash("sha256").update(`${task}:${JSON.stringify(parts)}`).digest("hex");
}

export async function getCached(key: string): Promise<CachedAi | null> {
  const m = memory.get(key);
  if (m && m.exp > Date.now()) return m.value;
  try {
    const snap = await getDb().doc(`ai_cache/${key}`).get();
    if (!snap.exists) return null;
    const exp = (snap.get("expireAt") as Timestamp | undefined)?.toMillis() ?? 0;
    if (exp < Date.now()) return null;
    const value = { text: snap.get("text"), provider: snap.get("provider"), model: snap.get("model") } as CachedAi;
    memory.set(key, { exp, value });
    return value;
  } catch {
    return null;
  }
}

export async function setCached(key: string, value: CachedAi, ttlMinutes: number): Promise<void> {
  const exp = Date.now() + ttlMinutes * 60_000;
  memory.set(key, { exp, value });
  if (memory.size > 500) memory.clear();
  await getDb()
    .doc(`ai_cache/${key}`)
    .set({ ...value, expireAt: Timestamp.fromMillis(exp), createdAt: FieldValue.serverTimestamp() })
    .catch(() => undefined);
}
