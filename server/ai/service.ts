/**
 * Hybrid AI service layer.
 *
 *  task                → primary                 → fallbacks
 *  chat, advisory,     → Groq (GROQ_MODEL)        → Groq (GROQ_FALLBACK_MODEL) → Gemini text
 *  incident summary,
 *  route explanation
 *  image analysis      → Gemini (GEMINI_MODEL)    → Gemini (GEMINI_FALLBACK_MODEL)
 *
 * When every provider fails (no keys, quota, outage) the caller gets
 * `provider: "simulated"` and must use its deterministic fallback — core
 * disaster features never depend on AI being up.
 */
import { env } from "../lib/env";
import { HttpError } from "../lib/http";
import { memoryRateLimit } from "../lib/rateLimit";
import { getAiSettings, getGeneralSettings } from "../lib/settings";
import { AiProviderError, geminiGenerate, groqChat, type ChatMessage, type GeminiPart } from "./providers";
import { consumeQuota, refundQuota, type AiCaller, type QuotaKind, type QuotaStatus } from "./quota";
import { cacheKey, getCached, logAiUsage, setCached } from "./usage";
import type { AiProviderName, AiTask } from "../../shared/types";

export interface AiTextResult {
  text: string | null;
  provider: AiProviderName;
  model: string;
  latencyMs: number;
  cached: boolean;
  fallbackReason?: string;
  quota?: QuotaStatus;
}

interface Attempt {
  provider: "groq" | "gemini";
  model: string;
  run: () => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export function groqModels() {
  return [env("GROQ_MODEL", "llama-3.3-70b-versatile"), env("GROQ_FALLBACK_MODEL", "llama-3.1-8b-instant")].filter(
    (m, i, a) => m && a.indexOf(m) === i
  );
}

export function geminiModels() {
  return [env("GEMINI_MODEL", "gemini-3.8-flash"), env("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")].filter(
    (m, i, a) => m && a.indexOf(m) === i
  );
}

async function guard(caller: AiCaller, feature: "chat" | "image" | "text"): Promise<void> {
  const settings = await getGeneralSettings();
  if (!settings.aiEnabled) throw new HttpError(503, "AI features are switched off by the platform administrator.", "ai_disabled");
  if (feature === "chat" && !settings.chatbotEnabled) throw new HttpError(503, "The AI assistant is temporarily switched off.", "ai_disabled");
  if (feature === "image" && !settings.imageAnalysisEnabled) throw new HttpError(503, "AI photo analysis is temporarily switched off.", "ai_disabled");
  const { perUserPerMinute } = await getAiSettings();
  memoryRateLimit(`ai:${caller.uid ?? caller.ip}`, perUserPerMinute, 60_000);
}

async function runAttempts(task: AiTask, attempts: Attempt[], caller: AiCaller): Promise<AiTextResult> {
  const started = Date.now();
  const errors: string[] = [];
  for (const a of attempts) {
    const t0 = Date.now();
    try {
      const r = await a.run();
      await logAiUsage({
        task, provider: a.provider, model: a.model, uid: caller.uid ?? "anonymous", orgId: caller.orgId,
        inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: Date.now() - t0,
        status: errors.length ? "fallback" : "ok",
      });
      return { text: r.text, provider: a.provider, model: a.model, latencyMs: Date.now() - started, cached: false };
    } catch (err) {
      const e = err as AiProviderError;
      errors.push(`${a.provider}/${a.model}: ${e.kind ?? "error"}`);
      if (e.kind !== "config") {
        await logAiUsage({
          task, provider: a.provider, model: a.model, uid: caller.uid ?? "anonymous", orgId: caller.orgId,
          inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, status: "error", error: String(e.message).slice(0, 300),
        });
      }
    }
  }
  return {
    text: null,
    provider: "simulated",
    model: "deterministic-fallback",
    latencyMs: Date.now() - started,
    cached: false,
    fallbackReason: attempts.length === 0 ? "No AI provider is configured." : `AI providers unavailable (${errors.join("; ")}).`,
  };
}

export interface TextTaskInput {
  task: Exclude<AiTask, "image_analysis">;
  system: string;
  messages: ChatMessage[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Count against the caller's chat quota (null = no quota, e.g. cached public helpers). */
  quota: QuotaKind | null;
  /** Non-sensitive requests may be cached and shared across users. */
  cacheable?: boolean;
  caller: AiCaller;
}

export async function runTextTask(input: TextTaskInput): Promise<AiTextResult> {
  await guard(input.caller, input.task === "chat" ? "chat" : "text");
  const key = input.cacheable ? cacheKey(input.task, [input.system, input.messages, input.json]) : null;
  if (key) {
    const hit = await getCached(key);
    if (hit) {
      await logAiUsage({ task: input.task, provider: hit.provider, model: hit.model, uid: input.caller.uid ?? "anonymous", orgId: input.caller.orgId, inputTokens: 0, outputTokens: 0, latencyMs: 0, status: "cached" });
      return { ...hit, latencyMs: 0, cached: true };
    }
  }

  const reservation = input.quota ? await consumeQuota(input.caller, input.quota) : null;

  const groqKey = env("GROQ_API_KEY");
  const geminiKey = env("GEMINI_API_KEY");
  const msgs: ChatMessage[] = [{ role: "system", content: input.system }, ...input.messages];
  const attempts: Attempt[] = [];
  if (groqKey) {
    for (const model of groqModels()) {
      attempts.push({
        provider: "groq",
        model,
        run: () => groqChat({ apiKey: groqKey, model, messages: msgs, json: input.json, temperature: input.temperature, maxTokens: input.maxTokens }),
      });
    }
  }
  if (geminiKey) {
    const model = geminiModels()[geminiModels().length - 1];
    const lastUser = input.messages[input.messages.length - 1]?.content ?? "";
    const history = input.messages.slice(0, -1).map((m) => ({ role: (m.role === "assistant" ? "model" : "user") as "user" | "model", text: m.content }));
    attempts.push({
      provider: "gemini",
      model,
      run: () => geminiGenerate({ apiKey: geminiKey, model, system: input.system, history, parts: [{ text: lastUser }], json: input.json, temperature: input.temperature, maxTokens: input.maxTokens ? input.maxTokens * 3 : undefined }),
    });
  }

  const result = await runAttempts(input.task, attempts, input.caller);
  if (result.provider === "simulated" && reservation) {
    await refundQuota(reservation.subject, input.quota!);
  }
  if (result.provider !== "simulated" && key && result.text) {
    const { cacheTtlMinutes } = await getAiSettings();
    await setCached(key, { text: result.text, provider: result.provider, model: result.model }, cacheTtlMinutes);
  }
  return { ...result, quota: reservation?.status };
}

export interface ImageTaskInput {
  system: string;
  prompt: string;
  image: { mime: string; base64: string };
  caller: AiCaller;
  /** Skip quota (e.g. LGU re-analysis already billed elsewhere). */
  skipQuota?: boolean;
}

export async function runImageTask(input: ImageTaskInput): Promise<AiTextResult> {
  await guard(input.caller, "image");
  const reservation = input.skipQuota ? null : await consumeQuota(input.caller, "image");
  const geminiKey = env("GEMINI_API_KEY");
  const parts: GeminiPart[] = [{ text: input.prompt }, { inline_data: { mime_type: input.image.mime, data: input.image.base64 } }];
  const attempts: Attempt[] = geminiKey
    ? geminiModels().map((model) => ({
        provider: "gemini" as const,
        model,
        run: () => geminiGenerate({ apiKey: geminiKey, model, system: input.system, parts, json: true, temperature: 0.1 }),
      }))
    : [];
  const result = await runAttempts("image_analysis", attempts, input.caller);
  if (result.provider === "simulated" && reservation) await refundQuota(reservation.subject, "image");
  return { ...result, quota: reservation?.status };
}
