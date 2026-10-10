/**
 * Mindoro geographic-navigation smoke test.
 *
 * Prerequisites: seeded Firebase emulators and a running Vite server.
 * Env: E2E_BASE_URL (default http://localhost:5173), CHROME_PATH.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile?.(path.join(here, "..", "..", ".env")); } catch {}
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD;
if (!PASSWORD) throw new Error("Set DEMO_ACCOUNT_PASSWORD to the value used by the demo seed.");
const executablePath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("No Chrome/Edge found. Set CHROME_PATH.");

const browser = await chromium.launch({ executablePath, headless: process.env.HEADED ? false : true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem("bahadvisory_tutorial_seen_v1", "1"));
page.setDefaultTimeout(30_000);

async function login(email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function idToken() {
  return page.evaluate(async () => {
    const { auth } = await import("/src/firebase.ts");
    return (await auth.currentUser?.getIdToken()) ?? "";
  });
}

try {
  await page.goto(BASE);
  const province = page.getByLabel("Province");
  const municipality = page.getByLabel("Municipality or city");
  const barangay = page.getByLabel("Barangay");

  await province.selectOption("1705100000");
  await page.waitForFunction(() => document.querySelector('[aria-label="Municipality or city"]')?.options.length === 12);
  if (await municipality.locator("option").count() !== 12) throw new Error("Occidental Mindoro must expose 11 LGUs plus the all-LGU option.");
  await municipality.selectOption({ label: "Lubang" });
  if (await barangay.locator("option").count() < 2) throw new Error("Lubang barangays were not loaded.");
  if (!new URL(page.url()).searchParams.get("municipality")) throw new Error("Municipality selection was not persisted in the URL.");

  await province.selectOption("1705200000");
  await page.waitForFunction(() => document.querySelector('[aria-label="Municipality or city"]')?.options.length === 16);
  if (await municipality.locator("option").count() !== 16) throw new Error("Oriental Mindoro must expose 15 LGUs plus the all-LGU option.");
  await municipality.selectOption("1705205000");
  await barangay.selectOption({ index: 1 });
  const selectedUrl = new URL(page.url());
  if (selectedUrl.searchParams.get("province") !== "1705200000" || selectedUrl.searchParams.get("municipality") !== "1705205000" || !selectedUrl.searchParams.get("barangay")) {
    throw new Error("Province, municipality, and barangay filters are not reflected in the URL.");
  }

  await page.goto(`${BASE}/overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Municipalities and city" }).waitFor();
  const rows = await page.locator(".geo-overview__table tbody tr").count();
  if (rows !== 26) throw new Error(`Expected 26 LGU comparison rows, found ${rows}.`);
  await page.getByText("Occidental Mindoro", { exact: true }).first().waitFor();
  await page.getByText("Oriental Mindoro", { exact: true }).first().waitFor();
  await page.locator(".geo-overview__table tbody tr", { hasText: "San Jose" }).getByText("No verified feed", { exact: true }).waitFor();

  await login("oriental.province@demo.bahadvisory.test");
  const provincialToken = await idToken();
  const sameProvince = await page.request.get(`${BASE}/api/geography/overview?province=1705200000&refresh=1`, {
    headers: { authorization: `Bearer ${provincialToken}` },
  });
  if (sameProvince.status() !== 200) throw new Error(`Provincial refresh inside Oriental Mindoro returned HTTP ${sameProvince.status()}.`);
  const crossProvince = await page.request.get(`${BASE}/api/geography/overview?province=1705100000&refresh=1`, {
    headers: { authorization: `Bearer ${provincialToken}` },
  });
  if (crossProvince.status() !== 403) throw new Error(`Cross-province refresh should be denied, got HTTP ${crossProvince.status()}.`);
  await page.goto(`${BASE}/admin/geography`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Geographic operations" }).waitFor();
  if (await page.locator(".geo-overview__table tbody tr").count() !== 15) throw new Error("Oriental provincial dashboard did not show its 15 LGUs.");

  const disconnected = await page.request.post(`${BASE}/api/route`, {
    data: {
      origin: { lat: 13.1024, lng: 121.1888 },
      destination: { lat: 13.858, lng: 120.124 },
      mode: "car",
      language: "en",
    },
    timeout: 90_000,
  });
  if (disconnected.status() !== 422) throw new Error(`Disconnected mainland-to-Lubang request returned HTTP ${disconnected.status()}.`);
  const disconnectedBody = await disconnected.json();
  if (disconnectedBody.error?.code !== "no_verified_road_route" || disconnectedBody.error?.routes?.length !== 0 || "geometry" in disconnectedBody.error) {
    throw new Error("Disconnected route response did not preserve the no-geometry contract.");
  }

  await login("super@demo.bahadvisory.test");
  await page.goto(`${BASE}/overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Municipalities and city" }).waitFor();
  if (await page.locator(".geo-overview__table tbody tr").count() !== 26) throw new Error("Super Admin could not monitor all 26 LGUs.");

  await login("lgu.staff@demo.bahadvisory.test");
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
  await page.getByText("Place simulated flood on demo route", { exact: false }).waitFor();

  console.log("Geographic expansion E2E passed: navigation, scoped access, 26-LGU monitoring, disconnected routing, and Calapan demo.");
} finally {
  await browser.close();
}
