/**
 * Raw provider adapters. Keys come from the server environment only.
 * Both return plain text + token usage; JSON parsing/validation happens in
 * the task layer so a malformed model reply can never crash a request.
 */
import { envInt } from "../lib/env";

export type ProviderErrorKind = "config" | "quota" | "timeout" | "http" | "safety" | "empty";

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: "groq" | "gemini",
    public readonly model: string,
    public readonly kind: ProviderErrorKind
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface ProviderReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, provider: "groq" | "gemini", model: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status === 429) throw new AiProviderError(`${provider} rate/quota limit`, provider, model, "quota");
    if (!res.ok) throw new AiProviderError(`${provider} HTTP ${res.status}: ${text.slice(0, 200)}`, provider, model, "http");
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if ((err as Error).name === "AbortError") throw new AiProviderError(`${provider} timed out`, provider, model, "timeout");
    throw new AiProviderError(`${provider} request failed: ${(err as Error).message}`, provider, model, "http");
  } finally {
    clearTimeout(timer);
  }
}

// ---- Groq (OpenAI-compatible chat completions) ---------------------------------

export async function groqChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
}): Promise<ProviderReply> {
  if (!opts.apiKey) throw new AiProviderError("GROQ_API_KEY not set", "groq", opts.model, "config");
  const data = await post(
    "https://api.groq.com/openai/v1/chat/completions",
    { authorization: `Bearer ${opts.apiKey}` },
    {
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 700,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    },
    opts.timeoutMs ?? envInt("AI_TIMEOUT_MS", 20_000),
    "groq",
    opts.model
  );
  const choice = (data.choices as { message?: { content?: string } }[] | undefined)?.[0];
  const text = choice?.message?.content?.trim() ?? "";
  if (!text) throw new AiProviderError("groq returned an empty reply", "groq", opts.model, "empty");
  const usage = (data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
  return { text, inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
}

// ---- Gemini (generateContent) ------------------------------------------------------

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function geminiGenerate(opts: {
  apiKey: string;
  model: string;
  system?: string;
  parts: GeminiPart[];
  history?: { role: "user" | "model"; text: string }[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ProviderReply> {
  if (!opts.apiKey) throw new AiProviderError("GEMINI_API_KEY not set", "gemini", opts.model, "config");
  const contents = [
    ...(opts.history ?? []).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: opts.parts },
  ];
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
    { "x-goog-api-key": opts.apiKey },
    {
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    },
    opts.timeoutMs ?? envInt("AI_TIMEOUT_MS", 25_000),
    "gemini",
    opts.model
  );
  const blocked = (data.promptFeedback as { blockReason?: string } | undefined)?.blockReason;
  if (blocked) throw new AiProviderError(`gemini blocked the prompt (${blocked})`, "gemini", opts.model, "safety");
  const cand = (data.candidates as { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] | undefined)?.[0];
  if (cand?.finishReason === "SAFETY") throw new AiProviderError("gemini safety stop", "gemini", opts.model, "safety");
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiProviderError("gemini returned an empty reply", "gemini", opts.model, "empty");
  const usage = (data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined) ?? {};
  return {
    text,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  };
}

/** Extracts the first JSON object from a model reply (tolerates code fences). */
export function parseJsonReply<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
