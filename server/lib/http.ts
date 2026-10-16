import { ValidationError } from "../../shared/validation";
import { toMillis } from "../../shared/time";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "error",
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg: string, code = "bad_request") => new HttpError(400, msg, code);
export const unauthorized = (msg = "Sign in required.") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "You don't have permission to do that.") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found.") => new HttpError(404, msg, "not_found");

const SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, jsonReplacer), {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  });
}

/** Converts Firestore Timestamps to epoch millis when serializing. */
function jsonReplacer(_key: string, value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.toMillis === "function" || ("_seconds" in v && "_nanoseconds" in v)) {
      return toMillis(v);
    }
  }
  return value;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ValidationError) {
    return json({ error: { code: "validation_error", message: err.message, issues: err.issues } }, 400);
  }
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } }, err.status);
  }
  // Never leak internals (stack traces, provider errors) to clients.
  console.error("[api] unhandled error", err);
  return json({ error: { code: "internal", message: "Something went wrong. Please try again." } }, 500);
}

/** Reads a JSON body with a hard size cap (default 64 KB). */
export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await readText(req, maxBytes);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest("Request body must be valid JSON.", "invalid_json");
  }
}

export async function readText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "Request body is too large.", "payload_too_large");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, "Request body is too large.", "payload_too_large");
  return new TextDecoder().decode(buf);
}

export function clientIp(req: Request, fallback = "unknown"): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    fallback
  );
}
