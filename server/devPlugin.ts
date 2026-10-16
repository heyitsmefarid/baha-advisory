import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Serves /api/* from server/router.ts inside `npm run dev`, so local
 * development needs a single process. Uses Vite's SSR module loader, which
 * means backend edits hot-reload just like the frontend.
 */
type Loader = () => Promise<{ handle: (req: Request, opts: { ip?: string }) => Promise<Response> }>;

function apiMiddleware(load: Loader, logError: (msg: string) => void) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(", "));
          }
          const url = `http://${req.headers.host ?? "localhost"}${req.url}`;
          const request = new Request(url, {
            method: req.method,
            headers,
            body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
          });
          const mod = await load();
          const response: Response = await mod.handle(request, { ip: req.socket.remoteAddress ?? "local" });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          logError(`[api] ${(err as Error).stack ?? err}`);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { code: "internal", message: "Dev API crashed — see terminal." } }));
        }
  };
}

export function bahadvisoryApi(): Plugin {
  return {
    name: "bahadvisory-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(apiMiddleware(() => server.ssrLoadModule("/server/router.ts") as never, (m) => server.config.logger.error(m)));
    },
    // `vite preview` (production build + service worker) also gets the API,
    // loaded once through tsx so it runs the same TypeScript sources.
    // import.meta.url is this file (server/devPlugin.ts).
    configurePreviewServer(server: PreviewServer) {
      let mod: ReturnType<Loader> | undefined;
      const load: Loader = () =>
        (mod ??= import("tsx/esm/api").then(({ tsImport }) => tsImport("./router.ts", import.meta.url)).catch((err) => {
          mod = undefined;
          throw err;
        }));
      server.middlewares.use(apiMiddleware(load, (m) => console.error(m)));
    },
  };
}
