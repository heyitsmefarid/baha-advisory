import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, geminiGenerate, groqChat } from "../../server/ai/providers";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown, capture?: (url: string, init: RequestInit) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      capture?.(url, init);
      return new Response(JSON.stringify(body), { status });
    })
  );
}

describe("Groq adapter", () => {
  it("sends an OpenAI-compatible request with the key only in the header", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    stubFetch(200, { choices: [{ message: { content: "Stay safe." } }], usage: { prompt_tokens: 120, completion_tokens: 8 } }, (url, init) => (seen = { url, init }));
    const r = await groqChat({ apiKey: "gsk_test", model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }], json: true });
    expect(seen!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body)).not.toContain("gsk_test");
    expect(r).toEqual({ text: "Stay safe.", inputTokens: 120, outputTokens: 8 });
  });

  it("classifies quota errors (so the service can fall back)", async () => {
    stubFetch(429, { error: { message: "rate limit" } });
    await expect(groqChat({ apiKey: "k", model: "m", messages: [] })).rejects.toMatchObject({ kind: "quota", provider: "groq" });
  });

  it("refuses to run without a key", async () => {
    await expect(groqChat({ apiKey: "", model: "m", messages: [] })).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("Gemini adapter", () => {
  it("sends inline image data with JSON output and parses text + usage", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    stubFetch(
      200,
      {
        candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: '{"floodVisible":true}' }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
      },
      (url, init) => (seen = { url, init })
    );
    const r = await geminiGenerate({
      apiKey: "AIza_test",
      model: "gemini-3.8-flash",
      system: "sys",
      parts: [{ text: "Analyze" }, { inline_data: { mime_type: "image/jpeg", data: "QUJD" } }],
      json: true,
    });
    expect(seen!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza_test");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe("image/jpeg");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(r.text).toBe('{"floodVisible":true}'); // thought parts excluded
    expect(r.inputTokens).toBe(900);
    expect(r.outputTokens).toBe(50);
  });

  it("surfaces safety blocks as non-retryable errors", async () => {
    stubFetch(200, { promptFeedback: { blockReason: "SAFETY" } });
    await expect(geminiGenerate({ apiKey: "k", model: "m", parts: [{ text: "x" }] })).rejects.toMatchObject({ kind: "safety" });
  });

  it("treats empty replies as failures", async () => {
    stubFetch(200, { candidates: [{ content: { parts: [] } }] });
    await expect(geminiGenerate({ apiKey: "k", model: "m", parts: [{ text: "x" }] })).rejects.toMatchObject({ kind: "empty" });
  });
});
