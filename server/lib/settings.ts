import { getDb } from "./firebaseAdmin";
import type { PlatformAiSettings, PlatformGeneralSettings } from "../../shared/types";
import { DEFAULT_PLAN_BY_ID, type SubscriptionPlan } from "../../shared/plans";

const TTL = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearSettingsCache() {
  cache.clear();
}

export const DEFAULT_GENERAL: PlatformGeneralSettings = {
  demoMode: false,
  aiEnabled: true,
  chatbotEnabled: true,
  imageAnalysisEnabled: true,
  publicReportingEnabled: true,
  emergencyHotlines: [{ label: "National emergency hotline", number: "911" }],
};

export const DEFAULT_AI: PlatformAiSettings = {
  pricing: { default: { inputPerM: 0.5, outputPerM: 1.5 } },
  perUserPerMinute: 8,
  cacheTtlMinutes: 360,
};

export function getGeneralSettings(): Promise<PlatformGeneralSettings> {
  return cached("general", async () => {
    const snap = await getDb().doc("platform_settings/general").get();
    return { ...DEFAULT_GENERAL, ...(snap.data() as Partial<PlatformGeneralSettings> | undefined) };
  });
}

export function getAiSettings(): Promise<PlatformAiSettings> {
  return cached("ai", async () => {
    const snap = await getDb().doc("platform_settings/ai").get();
    const data = snap.data() as Partial<PlatformAiSettings> | undefined;
    return { ...DEFAULT_AI, ...data, pricing: { ...DEFAULT_AI.pricing, ...(data?.pricing ?? {}) } };
  });
}

/** Plan document (Super Admin edits win) with the code default as fallback. */
export function getPlan(planId: string): Promise<SubscriptionPlan | null> {
  return cached(`plan:${planId}`, async () => {
    const snap = await getDb().doc(`subscription_plans/${planId}`).get();
    if (snap.exists) return { id: snap.id, ...(snap.data() as Omit<SubscriptionPlan, "id">) };
    return DEFAULT_PLAN_BY_ID[planId] ?? null;
  });
}
