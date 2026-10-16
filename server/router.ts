/**
 * Platform-agnostic API router. Every handler takes a Web-standard
 * Request and returns a Response, so the same code runs on:
 *  - Netlify Functions v2   (netlify/functions/api.mts)
 *  - Vercel Functions       (api/index.ts)
 *  - the Vite dev server    (server/devPlugin.ts)
 *  - tests                  (call handle() directly)
 * No Firebase Blaze plan / Cloud Functions required.
 */
import { clientIp, errorResponse, json } from "./lib/http";
import { memoryRateLimit } from "./lib/rateLimit";
import { routes } from "./routes";

export interface RouteCtx {
  params: Record<string, string>;
  url: URL;
  ip: string;
}

export type Handler = (req: Request, ctx: RouteCtx) => Promise<Response>;
export type RouteDef = [method: string, pattern: string, handler: Handler];

interface CompiledRoute {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

let compiled: CompiledRoute[] | null = null;

function compile(defs: RouteDef[]): CompiledRoute[] {
  return defs.map(([method, pattern, handler]) => {
    const keys: string[] = [];
    const src = pattern
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          keys.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { method, regex: new RegExp(`^${src}/?$`), keys, handler };
  });
}

/** Strips the platform-specific prefix so routes are written as /api/... */
export function normalizePath(pathname: string): string {
  let p = pathname.replace(/^\/\.netlify\/functions\/api/, "/api");
  if (!p.startsWith("/api")) p = `/api${p.startsWith("/") ? "" : "/"}${p}`;
  return p;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, x-api-key",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    vary: "origin",
  };
}

export async function handle(req: Request, opts: { ip?: string } = {}): Promise<Response> {
  compiled ??= compile(routes);
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const ip = opts.ip ?? clientIp(req);
  let response: Response;
  try {
    // Coarse per-IP flood protection across the whole API.
    memoryRateLimit(`ip:${ip}`, 240, 60_000);
    const route = compiled.find((r) => r.method === req.method && r.regex.test(path));
    if (!route) {
      const pathExists = compiled.some((r) => r.regex.test(path));
      response = json(
        { error: { code: pathExists ? "method_not_allowed" : "not_found", message: pathExists ? "Method not allowed." : "Unknown API route." } },
        pathExists ? 405 : 404
      );
    } else {
      const m = path.match(route.regex)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      response = await route.handler(req, { params, url, ip });
    }
  } catch (err) {
    response = errorResponse(err);
  }
  for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
  return response;
}
