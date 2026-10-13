/**
 * Offline / PWA check against a PRODUCTION build (the service worker is
 * only registered in production builds).
 *
 *   npm run dev:emulators                       # terminal 1 (seeded)
 *   npm run build && npx vite preview --port 4173
 *   npm run test:e2e:offline
 *
 * Verifies: the service worker installs and precaches the shell; the app
 * opens with no network and says it is offline and not live; the offline
 * kit shows what was saved and how old it is; pages never visited open from
 * the precache; a report submitted offline is kept as a draft and sent once
 * the device reconnects.
 *
 * Env: E2E_BASE_URL (default http://localhost:4173), DEMO_ACCOUNT_PASSWORD,
 *      CHROME_PATH.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4173";
// Same password `npm run seed` gave the demo accounts (from .env; never hard-coded).
try {
  process.loadEnvFile?.(path.join(here, "..", "..", ".env"));
} catch {}
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD;
if (!PASSWORD) {
  console.error("Set DEMO_ACCOUNT_PASSWORD (in .env or the environment) to the password used by `npm run seed`.");
  process.exit(1);
}
const OUT = path.join(here, "output");
mkdirSync(OUT, { recursive: true });

const executablePath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome/Edge found. Set CHROME_PATH.");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath, headless: process.env.HEADED ? false : true });
const context = await browser.newContext({
  viewport: { width: 412, height: 860 },
  geolocation: { latitude: 13.4031, longitude: 121.1883 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("bahadvisory_tutorial_seen_v1", "1");
  } catch {}
});
page.setDefaultTimeout(30_000);

const results = [];
async function step(n, title, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ ok: true });
    console.log(`  ✓ ${n}. ${title} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ ok: false });
    console.log(`  ✗ ${n}. ${title}\n      ${err.message.split("\n")[0]}`);
  }
}

const unique = `Offline E2E ${new Date().toISOString().slice(11, 19)}`;
const kitSaved = () => page.locator(".readout", { hasText: "Kit last saved" }).locator(".readout__value");

console.log(`\nBahadvisory offline / PWA check → ${BASE}\n`);

await step(1, "Signed in online; service worker installs and precaches the app shell", async () => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', "citizen@demo.bahadvisory.test");
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  const precached = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.startsWith("ba-shell-"));
    return name ? (await (await caches.open(name)).keys()).length : 0;
  });
  if (precached < 10) throw new Error(`only ${precached} entries precached`);
  console.log(`      ${precached} files precached`);
});

await step(2, "Offline kit is saved while online", async () => {
  await page.goto(`${BASE}/offline`);
  await page.waitForFunction(
    () => {
      const r = [...document.querySelectorAll(".readout")].find((el) => el.textContent?.includes("Kit last saved"));
      const v = r?.querySelector(".readout__value")?.textContent?.trim();
      return Boolean(v && v !== "—");
    },
    null,
    { timeout: 30_000 },
  );
});

await context.setOffline(true);

await step(3, "App opens with no network and says it is offline, not live", async () => {
  await page.goto(BASE);
  const banner = page.locator(".status-banner--offline");
  await banner.waitFor();
  const text = await banner.innerText();
  if (!/not live/i.test(text)) throw new Error(`offline banner does not say "not live": ${text}`);
  // A cache with nothing saved must read as unknown, never as "0 flood zones".
  const zonesValue = (await page.locator(".readout", { hasText: "Active flood zones" }).first().locator(".readout__value").innerText()).trim();
  if (zonesValue === "0") throw new Error('offline map claims "0 active flood zones" from the cache');
  console.log(`      offline zone counter: ${zonesValue}`);
  await page.screenshot({ path: path.join(OUT, "offline-01-map.png") });
});

await step(4, "Offline kit shows saved data with its age", async () => {
  await page.goto(`${BASE}/offline`);
  await page.locator(".readout", { hasText: "Connection" }).getByText("Offline").waitFor();
  const age = (await kitSaved().innerText()).trim();
  if (!age || age === "—") throw new Error("kit has no saved timestamp");
  if (await page.getByText("Nothing saved yet").count()) throw new Error("kit is empty");
  console.log(`      kit saved: ${age}`);
  await page.screenshot({ path: path.join(OUT, "offline-02-kit.png"), fullPage: true });
});

await step(5, "A page never opened before loads from the precache", async () => {
  await page.goto(`${BASE}/pricing`);
  await page.getByText("Citizen Free").first().waitFor();
});

await step(6, "A report submitted offline is kept as a draft", async () => {
  await page.goto(`${BASE}/report`);
  await page.getByRole("button", { name: /Use my current location/ }).click();
  await page.getByText(/GPS ±/).waitFor();
  await page.getByRole("radio", { name: /Gutter level/ }).click();
  await page.fill("textarea", `${unique}: water at gutter level on the road beside the plaza`);
  await page.getByRole("button", { name: "Save report — send when online" }).click();
  await page.getByText("Saved on this device", { exact: false }).first().waitFor();
  await page.locator(".draft-row", { hasText: unique }).waitFor();
});

await context.setOffline(false);

await step(7, "The draft is sent automatically after reconnecting", async () => {
  await page.getByText(/saved flood report was sent/).waitFor({ timeout: 60_000 });
  await page.locator(".draft-row", { hasText: unique }).waitFor({ state: "detached", timeout: 10_000 });
});

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} offline checks passed. Screenshots: ${OUT}\n`);
process.exit(failed ? 1 : 0);
