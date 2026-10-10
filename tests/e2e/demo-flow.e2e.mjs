/**
 * End-to-end hackathon demo flow in a real browser (Chromium via
 * playwright-core). Exercises the 12-step workflow across five roles.
 *
 * Prerequisites (local):
 *   npm run dev:emulators                       # terminal 1
 *   npm run seed -- --emulator                  # once (DEMO_ACCOUNT_PASSWORD in .env)
 *   npm run dev                                 # terminal 2 (VITE_USE_EMULATORS=true)
 *   npm run test:e2e                            # this script
 *
 * Env: E2E_BASE_URL (default http://localhost:5173), DEMO_ACCOUNT_PASSWORD,
 *      CHROME_PATH (default: Chrome on Windows/macOS/Linux standard paths).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
// Same password `npm run seed` gave the demo accounts (from .env; never hard-coded).
try {
  process.loadEnvFile?.(path.join(here, "..", "..", ".env"));
} catch {}
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD;
if (!PASSWORD) {
  console.error("Set DEMO_ACCOUNT_PASSWORD (in .env or the environment) to the password used by `npm run seed`.");
  process.exit(1);
}
const D = "demo.bahadvisory.test";
const OUT = path.join(here, "output");
mkdirSync(OUT, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome/Edge found. Set CHROME_PATH.");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath, headless: process.env.HEADED ? false : true });
const results = [];
const unique = `E2E ${new Date().toISOString().slice(11, 19)}`;

async function ctxFor(email) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 860 },
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
  if (email) {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  }
  return { context, page };
}

async function step(n, title, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ n, title, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${n}. ${title} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ n, title, ok: false, error: err.message.split("\n")[0] });
    console.log(`  ✗ ${n}. ${title}\n      ${err.message.split("\n")[0]}`);
  }
}

console.log(`\nBahadvisory end-to-end demo flow → ${BASE}\n`);

// 1 — public map
const pub = await ctxFor(null);
await step(1, "Citizen opens the live flood map", async () => {
  await pub.page.goto(BASE);
  await pub.page.getByText("Active flood zones").first().waitFor();
  await pub.page.getByText("All Locations").waitFor();
  await pub.page.screenshot({ path: path.join(OUT, "01-map.png") });
});

// 2–3 — report with photo (+ AI analysis card)
const cit = await ctxFor(`citizen@${D}`);
await step(2, "Citizen submits a flood report with a photo", async () => {
  const p = cit.page;
  await p.goto(`${BASE}/report`);
  await p.setInputFiles('input[type="file"]', path.join(here, "fixtures", "flood-test.jpg"));
  await p.getByAltText("Selected flood photo").waitFor();
  await p.getByRole("button", { name: /Use my current location/ }).click();
  await p.getByText(/GPS ±/).waitFor();
  await p.getByRole("radio", { name: /Knee level/ }).click();
  await p.fill("textarea", `${unique}: knee-deep water near the Lalud market, tricycles turning back`);
  await p.getByRole("button", { name: /^Send report/ }).click();
  await p.getByText("Report received").waitFor({ timeout: 90_000 });
});
await step(3, "Gemini analysis (or labelled fallback) is shown with its disclaimer", async () => {
  const p = cit.page;
  await p.getByText(/Gemini photo analysis|Not analyzed by AI|AI analysis unavailable/).first().waitFor();
  // Analyzed → AI disclaimer; not analyzed → says so and uses the reporter's own estimate.
  await p.getByText(/cannot determine actual water depth|DRRM verification decides|Severity from reporter's estimate/).first().waitFor();
  await p.screenshot({ path: path.join(OUT, "03-report-ai.png"), fullPage: true });
});

// 4–5 — LGU verification updates the official map
const staff = await ctxFor(`lgu.staff@${D}`);
await step(4, "LGU officer verifies the report (creates a zone + nearby alert)", async () => {
  const p = staff.page;
  await p.goto(`${BASE}/admin/verification`);
  await p.locator(".master-item", { hasText: unique }).first().click();
  const panel = p.locator(".action-panel");
  await panel.getByRole("combobox").first().selectOption("create_zone");
  await panel.getByRole("button", { name: "Verify" }).click();
  await p.getByText(/Verified — map & navigation updated/).waitFor({ timeout: 30_000 });
});
await step(5, "The verified report appears on the public map", async () => {
  await pub.page.goto(BASE);
  await pub.page.locator(".locations-sidebar").getByText(/community report|Flooding near/).first().waitFor({ timeout: 20_000 });
});

// 6–7 — demo closure, reroute, AI explanation
await step(6, "Navigation reroutes around a (simulated) closure on real roads", async () => {
  const p = staff.page;
  await p.goto(`${BASE}/demo`);
  await p.getByRole("button", { name: "Place simulated flood on demo route" }).click();
  await p.getByText(/Simulated closure placed/).waitFor({ timeout: 60_000 });
  await p.goto(`${BASE}/navigate?from=13.4194,121.1978&fromName=Calapan%20Port&to=13.3742,121.1702&toName=Bucayao&mode=car`);
  await p.getByRole("button", { name: "Find a safe route" }).click();
  await p.getByText(/Avoids \d+ verified flood/).waitFor({ timeout: 90_000 });
  await p.screenshot({ path: path.join(OUT, "06-reroute.png") });
});
await step(7, "AI explains the route (Groq, or labelled template)", async () => {
  const p = staff.page;
  await p.getByRole("button", { name: "Explain simply" }).click();
  await p.locator(".ai-block").waitFor({ timeout: 60_000 });
});

// 7b–8 — AI advisory draft, publish, alert reaches the citizen
const admin = await ctxFor(`lgu.admin@${D}`);
await step(8, "LGU admin drafts (AI) and publishes an advisory → citizen gets the alert", async () => {
  const p = admin.page;
  await p.goto(`${BASE}/admin/advisories`);
  await p.getByRole("button", { name: "Draft with Baha AI" }).click();
  await p.locator(".advisory-draft").waitFor({ timeout: 60_000 });
  await p.locator(".advisory-draft input").first().fill(`${unique} flood advisory`);
  await p.getByRole("button", { name: "Save as draft" }).click();
  await p.getByText(/Draft saved/).waitFor();
  const row = p.locator("tr", { hasText: `${unique} flood advisory` });
  await row.getByRole("button", { name: "Publish" }).click();
  await row.getByRole("button", { name: "Publish now" }).click();
  await p.getByText(/Published\./).waitFor({ timeout: 30_000 });
  await cit.page.goto(`${BASE}/alerts`);
  await cit.page.getByText(`${unique} flood advisory`).first().waitFor({ timeout: 20_000 });
});

// 9 — evacuation
await step(9, "Evacuation finder ranks verified centers by safe road time", async () => {
  const p = cit.page;
  await p.goto(`${BASE}/evacuation`);
  await p.getByRole("button", { name: "Find the nearest safe center" }).click();
  await p.getByText(/Recommended|No safe route to nearby centers/).first().waitFor({ timeout: 90_000 });
  await p.screenshot({ path: path.join(OUT, "09-evacuation.png") });
});

// 10 — LGU analytics
await step(10, "LGU Pro analytics load", async () => {
  await admin.page.goto(`${BASE}/admin/analytics`);
  await admin.page.getByText("New flood zones per week").first().waitFor();
});

// 11 — Business fleet disruption monitoring + sandbox billing
const biz = await ctxFor(`business.admin@${D}`);
await step(11, "Business Pro re-checks saved routes for disruptions", async () => {
  const p = biz.page;
  await p.goto(`${BASE}/business`);
  await p.getByRole("button", { name: "Check all routes now" }).click();
  await p.getByText(/Checked \d+ route/).waitFor({ timeout: 120_000 });
  await p.screenshot({ path: path.join(OUT, "11-fleet.png") });
});
await step(11.5, "Sandbox checkout creates a receipt (no real money)", async () => {
  const p = biz.page;
  await p.goto(`${BASE}/business/billing`);
  await p.getByRole("button", { name: "Purchase" }).first().click();
  await p.waitForURL(/checkout\/demo\//);
  await p.getByRole("button", { name: /Simulate successful/ }).click();
  await p.getByText("Payment confirmed").waitFor({ timeout: 30_000 });
});

// 12 — Super Admin
const sup = await ctxFor(`super@${D}`);
await step(12, "Super Admin sees real vs sandbox revenue and AI usage", async () => {
  const p = sup.page;
  await p.goto(`${BASE}/super`);
  await p.getByText("Real revenue (live payments)").waitFor();
  await p.getByText("Sandbox / demo subscriptions").waitFor();
  await p.screenshot({ path: path.join(OUT, "12-super.png"), fullPage: true });
});

// Cleanup the demo-tool zone so the flow is repeatable. Uses the dev
// server's module graph to read the signed-in user's ID token; best effort.
try {
  const token = await admin.page.evaluate(async () => {
    const { auth } = await import("/src/firebase.ts");
    return (await auth.currentUser?.getIdToken()) ?? "";
  });
  const res = await admin.page.request.post(`${BASE}/api/demo/reset`, { headers: { authorization: `Bearer ${token}` } });
  console.log(`  · demo scenario reset: HTTP ${res.status()}`);
} catch (err) {
  console.log(`  · demo scenario reset skipped (${err.message.split("\n")[0]})`);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Screenshots: ${OUT}\n`);
process.exit(failed.length ? 1 : 0);
