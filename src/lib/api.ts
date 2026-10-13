import { auth, API_BASE } from "../firebase";

/**
 * Thin client for the Bahadvisory backend (/api). Attaches the Firebase ID
 * token, normalizes errors, and distinguishes "offline / API unreachable"
 * from real server errors so features can fall back gracefully.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the auth header (public endpoints). */
  anonymous?: boolean;
  timeoutMs?: number;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (!opts.anonymous && auth.currentUser) {
    headers.authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  opts.signal?.addEventListener("abort", () => controller.abort());
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      navigator.onLine ? "The Bahadvisory service is unreachable right now." : "You're offline.",
      0,
      navigator.onLine ? "unreachable" : "offline"
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (e.g. static host returned index.html because no API is deployed)
    throw new ApiError("The Bahadvisory API is not available on this deployment.", 0, "no_api");
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string } })?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${res.status}).`, res.status, err.code ?? "error", err as Record<string, unknown>);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
