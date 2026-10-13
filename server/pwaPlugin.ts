import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Emits /sw.js for production builds with a precache list of every built
 * asset plus the public app-shell files — a dependency-free alternative to
 * workbox. In dev no service worker is served (avoids stale-cache confusion).
 */
export function bahadvisoryPwa(): Plugin {
  return {
    name: "bahadvisory-pwa",
    apply: "build",
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "sw.js");
      const publicDir = path.resolve("public");
      const shellPublic: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else {
            const rel = path.relative(publicDir, full).split(path.sep).join("/");
            // Large decorative images are cached on first use instead.
            if (/^(logo|icons)\//.test(rel) || rel === "manifest.webmanifest") shellPublic.push(rel);
          }
        }
      };
      walk(publicDir);
      const precache = ["/", "/index.html", ...built.map((f) => `/${f}`), ...shellPublic.map((f) => `/${f}`)];
      const build = createHash("sha256").update(precache.join("|")).digest("hex").slice(0, 12);
      const template = readFileSync(path.resolve("src/sw/service-worker.js"), "utf8");
      const source = template
        .replace("self.__BAHADVISORY_PRECACHE__", JSON.stringify([...new Set(precache)]))
        .replace("self.__BAHADVISORY_BUILD__", JSON.stringify(build));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
