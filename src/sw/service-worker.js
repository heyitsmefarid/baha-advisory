/* eslint-disable no-restricted-globals */
/**
 * Bahadvisory service worker (offline safety mode + push).
 * Built by server/pwaPlugin.ts, which replaces the two placeholders below
 * with the production asset list and a build id.
 *
 * Strategies
 *  - App shell & hashed assets: precached at install → app opens offline.
 *  - Navigations: network first (4 s), falling back to the cached shell.
 *  - OpenStreetMap tiles: stale-while-revalidate for tiles the person has
 *    already viewed, capped (LRU-ish) — no bulk prefetching, per the OSM
 *    tile usage policy.
 *  - API (/api/*) and Firestore traffic: never cached here. Live safety
 *    data is cached by the Firestore SDK / IndexedDB with timestamps so the
 *    UI can always label it as cached rather than live.
 *  - Push: shows FCM web-push alerts; clicking opens the alert.
 */
const PRECACHE = self.__BAHADVISORY_PRECACHE__;
const BUILD = self.__BAHADVISORY_BUILD__;
const SHELL_CACHE = `ba-shell-${BUILD}`;
const ASSET_CACHE = "ba-assets-v1";
const TILE_CACHE = "ba-tiles-v1";
const FONT_CACHE = "ba-fonts-v1";
const MAX_TILES = 1500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("ba-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

async function networkFirstNavigation(request) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok || res.type === "opaque") {
        cache.put(request, res.clone()).then(() => max && trimCache(cacheName, max));
      }
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(networkFirstNavigation(req));
    return;
  }
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return; // live data — never cached by the SW
    if (/^\/(assets|logo|img|icons)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
      event.respondWith(cacheFirst(req, ASSET_CACHE));
    }
    return;
  }
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE, MAX_TILES));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "unpkg.com") {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE, 60));
  }
});

// ---- Push (FCM web push) -------------------------------------------------------------
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { notification: { title: "Bahadvisory alert", body: event.data ? event.data.text() : "" } };
  }
  const n = payload.notification || {};
  const data = payload.data || {};
  const title = n.title || data.title || "Bahadvisory flood alert";
  const options = {
    body: n.body || data.body || "Open Bahadvisory for details.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: data.alertId || undefined,
    renotify: Boolean(data.alertId),
    requireInteraction: data.severity === "critical",
    data: { url: data.alertId ? `/alerts?alert=${encodeURIComponent(data.alertId)}` : "/alerts" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/alerts";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
