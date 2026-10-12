/**
 * End-to-end backend tests on the emulators: subscription enforcement,
 * payment processing (sandbox + signed PayMongo webhooks), idempotency,
 * entitlement lifecycle, AI quotas & fallbacks, privilege escalation,
 * onboarding approval, API keys and report verification.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, call, configureEnv, resetEmulators, signIn } from "./helpers";

configureEnv();

type Admin = typeof import("../../server/lib/firebaseAdmin");
let admin: Admin;

const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function mkUser(key: string, email: string, claims?: Record<string, unknown>) {
  const auth = admin.getAdminAuth();
  const u = await auth.createUser({ email, password: PASSWORD, displayName: key });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  ids[key] = u.uid;
  tokens[key] = await signIn(email);
  return u.uid;
}

async function refreshToken(key: string, email: string) {
  tokens[key] = await signIn(email);
}

beforeAll(async () => {
  await resetEmulators();
  admin = await import("../../server/lib/firebaseAdmin");
  const db = admin.getDb();
  const { DEFAULT_PLANS, computeEntitlements, DEFAULT_PLAN_BY_ID } = await import("../../shared/plans");
  for (const p of DEFAULT_PLANS) await db.doc(`subscription_plans/${p.id}`).set(p);
  await db.doc("platform_settings/general").set({ demoMode: true, aiEnabled: true, chatbotEnabled: true, imageAnalysisEnabled: true, publicReportingEnabled: true, emergencyHotlines: [{ label: "National emergency hotline", number: "911" }] });
  await db.doc("platform_settings/ai").set({ pricing: { default: { inputPerM: 0.5, outputPerM: 1.5 } }, perUserPerMinute: 60, cacheTtlMinutes: 60 });

  // An LGU org (subscribed) and a second business org.
  await db.doc("organizations/org_lgu").set({
    name: "Calapan DRRMO (test)", type: "lgu", status: "active", jurisdictionAreas: ["Calapan City", "Baco"], planId: "lgu_pro",
    subscriptionStatus: "active", entitlements: computeEntitlements(DEFAULT_PLAN_BY_ID.lgu_pro, { subscriptionActive: true }), addOns: [], createdAt: new Date(), createdBy: "test",
  });
  await db.doc("organizations/org_lgu_naujan").set({
    name: "Naujan (test)", type: "lgu", status: "active", jurisdictionAreas: ["Naujan"], planId: null, subscriptionStatus: "none",
    entitlements: computeEntitlements(null, { subscriptionActive: false }), addOns: [], createdAt: new Date(), createdBy: "test",
  });
  await db.doc("organizations/org_other").set({
    name: "Other Logistics (test)", type: "business", status: "active", jurisdictionAreas: [], planId: null, subscriptionStatus: "none",
    entitlements: computeEntitlements(null, { subscriptionActive: false }), addOns: [], createdAt: new Date(), createdBy: "test",
  });
  const grant = (orgId: string, psgcCode: string, provincePsgcCode: string) => ({
    orgId, psgcCode, level: "municipality", active: true, provincePsgcCode,
    municipalityPsgcCode: psgcCode, createdAt: new Date(), createdBy: "test",
  });
  await db.doc("organizations/org_lgu/jurisdiction_grants/1705205000").set(grant("org_lgu", "1705205000", "1705200000"));
  await db.doc("organizations/org_lgu/jurisdiction_grants/1705201000").set(grant("org_lgu", "1705201000", "1705200000"));
  await db.doc("organizations/org_lgu_naujan/jurisdiction_grants/1705208000").set(grant("org_lgu_naujan", "1705208000", "1705200000"));

  await mkUser("citizen", "citizen@it.test");
  await mkUser("owner", "owner@it.test");
  await mkUser("applicant", "applicant@it.test");
  await mkUser("otherAdmin", "other.admin@it.test", { role: "business_admin", orgId: "org_other" });
  await mkUser("lguStaff", "lgu.staff@it.test", { role: "lgu_staff", orgId: "org_lgu", assignedArea: "Calapan City" });
  await mkUser("naujan", "naujan@it.test", { role: "lgu_staff", orgId: "org_lgu_naujan", assignedArea: "Naujan" });
  await mkUser("super", "super@it.test", { role: "super_admin" });
  for (const k of ["otherAdmin", "lguStaff"]) {
    await db.doc(`organizations/${k === "otherAdmin" ? "org_other" : "org_lgu"}/members/${ids[k]}`).set({ name: k, email: `${k}@it.test`, role: k === "otherAdmin" ? "business_admin" : "lgu_staff", active: true });
  }
}, 60_000);

// =============================================================================
describe("business onboarding & subscription enforcement", () => {
  it("creates a business org and grants business_admin through server-set claims", async () => {
    const res = await call<{ orgId: string }>("POST", "/api/orgs", { token: tokens.owner, body: { type: "business", name: "Mindoro Movers (test)" } });
    expect(res.status).toBe(201);
    ids.ownerOrg = res.body.orgId;
    await refreshToken("owner", "owner@it.test");
    const boot = await call<{ role: string; orgId: string }>("POST", "/api/auth/bootstrap", { token: tokens.owner });
    expect(boot.body).toMatchObject({ role: "business_admin", orgId: ids.ownerOrg });
  });

  it("blocks paid features before any payment", async () => {
    expect((await call("POST", "/api/fleet/check", { token: tokens.owner, body: { orgId: ids.ownerOrg } })).status).toBe(402);
    expect((await call("POST", `/api/orgs/${ids.ownerOrg}/members`, { token: tokens.owner, body: { email: "x@it.test", name: "X", role: "business_staff" } })).status).toBe(402);
    expect((await call("POST", `/api/orgs/${ids.ownerOrg}/api-keys`, { token: tokens.owner, body: { label: "k" } })).status).toBe(402);
  });

  it("only org admins can check out, and only for their segment's plans", async () => {
    expect((await call("POST", "/api/billing/checkout", { token: tokens.citizen, body: { orgId: ids.ownerOrg, planId: "business_pro" } })).status).toBe(403);
    expect((await call("POST", "/api/billing/checkout", { token: tokens.otherAdmin, body: { orgId: ids.ownerOrg, planId: "business_pro" } })).status).toBe(403);
    expect((await call("POST", "/api/billing/checkout", { token: tokens.owner, body: { orgId: ids.ownerOrg, planId: "lgu_pro" } })).status).toBe(400);
    const enterprise = await call("POST", "/api/billing/checkout", { token: tokens.owner, body: { orgId: ids.ownerOrg, planId: "enterprise" } });
    expect(enterprise.status).toBe(400);
    const ok = await call<{ txId: string; checkoutUrl: string; isDemo: boolean }>("POST", "/api/billing/checkout", { token: tokens.owner, body: { orgId: ids.ownerOrg, planId: "business_pro", billingCycle: "monthly", coverageScopes: [{ level: "municipality", psgcCode: "1705205000" }] } });
    expect(ok.status).toBe(201);
    expect(ok.body.checkoutUrl).toBe(`/checkout/demo/${ok.body.txId}`);
    expect(ok.body.isDemo).toBe(true);
    ids.ownerTx = ok.body.txId;
  });

  it("sandbox completion is admin-only, idempotent, and activates entitlements", async () => {
    expect((await call("POST", `/api/billing/demo/${ids.ownerTx}/complete`, { token: tokens.otherAdmin, body: { outcome: "paid" } })).status).toBe(403);
    const first = await call<{ outcome: string }>("POST", `/api/billing/demo/${ids.ownerTx}/complete`, { token: tokens.owner, body: { outcome: "paid" } });
    expect(first.body.outcome).toBe("activated");
    const again = await call<{ outcome: string; duplicate: boolean }>("POST", `/api/billing/demo/${ids.ownerTx}/complete`, { token: tokens.owner, body: { outcome: "paid" } });
    expect(again.body).toMatchObject({ outcome: "duplicate_event", duplicate: true });

    const db = admin.getDb();
    const org = (await db.doc(`organizations/${ids.ownerOrg}`).get()).data()!;
    expect(org.subscriptionStatus).toBe("active");
    expect(org.entitlements.fleetMonitoring).toBe(true);
    expect(org.entitlements.apiAccess).toBe(false); // optional add-on, not bought
    const invoices = await db.collection("billing_invoices").where("orgId", "==", ids.ownerOrg).get();
    expect(invoices.size).toBe(1);
    const sub = (await db.doc(`subscriptions/${org.subscriptionId}`).get()).data()!;
    expect(sub).toMatchObject({ planId: "business_pro", isDemo: true, mrrPhp: 2000, status: "active", coverageScopes: [{ level: "municipality", psgcCode: "1705205000" }] });
  });

  it("paid features work once subscribed", async () => {
    const res = await call<{ checked: number }>("POST", "/api/fleet/check", { token: tokens.owner, body: { orgId: ids.ownerOrg, coveragePsgcCode: "1705205000" } });
    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(0);
    await admin.getDb().doc(`organizations/${ids.ownerOrg}/saved_routes/outside`).set({
      orgId: ids.ownerOrg, name: "Naujan route", vehicle: "car", coveragePsgcCode: "1705208000",
      stops: [{ label: "A", location: { lat: 13.2, lng: 121.3 } }, { label: "B", location: { lat: 13.25, lng: 121.35 } }],
      createdBy: ids.owner, createdAt: new Date(),
    });
    const outside = await call("POST", "/api/fleet/check", { token: tokens.owner, body: { orgId: ids.ownerOrg, routeId: "outside" } });
    expect(outside.status).toBe(403);
    expect((outside.body as { error: { code: string } }).error.code).toBe("coverage_denied");
    expect((await call("GET", "/api/geography/overview?municipality=1705208000")).status).toBe(200);
  });
});

// =============================================================================
describe("PayMongo webhooks", () => {
  async function pendingTx(id: string, amountPhp = 2000) {
    await admin.getDb().doc(`payment_transactions/${id}`).set({
      orgId: "org_other", kind: "subscription", planId: "business_pro", billingCycle: "monthly", feeId: null, description: "Business Pro — monthly",
      amountPhp, amountMinor: amountPhp * 100, currency: "PHP", provider: "paymongo", providerRef: `cs_${id}`, checkoutUrl: null, status: "pending",
      livemode: false, isDemo: false, createdBy: ids.otherAdmin, createdAt: new Date(), paidAt: null, invoiceId: null, failureReason: null,
      coverageScopes: [{ level: "municipality", psgcCode: "1705205000" }],
    });
  }
  async function send(eventId: string, txId: string, amountMinor: number, opts: { live?: boolean; sign?: boolean } = {}) {
    const { paymongoSignature } = await import("../../server/payments/paymongo");
    const raw = JSON.stringify({
      data: { id: eventId, attributes: { type: "checkout_session.payment.paid", livemode: Boolean(opts.live), data: { id: `cs_${txId}`, attributes: { reference_number: txId, payments: [{ attributes: { amount: amountMinor } }] } } } },
    });
    const t = String(Math.floor(Date.now() / 1000));
    const sig = paymongoSignature("whsk_test_integration", t, raw);
    const headers: Record<string, string> = opts.sign === false ? {} : { "paymongo-signature": `t=${t},te=${opts.live ? "0".repeat(64) : sig},li=${opts.live ? sig : "0".repeat(64)}` };
    return call<{ outcome: string; duplicate: boolean }>("POST", "/api/billing/webhook/paymongo", { raw, headers });
  }

  it("rejects unsigned webhooks", async () => {
    await pendingTx("tx_pm_unsigned");
    expect((await send("evt_unsigned", "tx_pm_unsigned", 200000, { sign: false })).status).toBe(401);
  });

  it("refuses to activate on an underpayment", async () => {
    await pendingTx("tx_pm_short");
    const res = await send("evt_short", "tx_pm_short", 100);
    expect(res.body.outcome).toBe("amount_mismatch");
    const org = (await admin.getDb().doc("organizations/org_other").get()).data()!;
    expect(org.entitlements.fleetMonitoring).toBe(false);
  });

  it("refuses live-mode events for test-mode transactions", async () => {
    await pendingTx("tx_pm_mode");
    expect((await send("evt_mode", "tx_pm_mode", 200000, { live: true })).body.outcome).toBe("livemode_mismatch");
  });

  it("activates on a valid signed payment and ignores redelivery", async () => {
    await pendingTx("tx_pm_good");
    const first = await send("evt_good", "tx_pm_good", 200000);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("activated");
    const dup = await send("evt_good", "tx_pm_good", 200000);
    expect(dup.body).toMatchObject({ outcome: "duplicate_event", duplicate: true });
    const org = (await admin.getDb().doc("organizations/org_other").get()).data()!;
    expect(org.entitlements.fleetMonitoring).toBe(true);
    const sub = (await admin.getDb().doc(`subscriptions/${org.subscriptionId}`).get()).data()!;
    // Test-mode (livemode=false) payments are never counted as real revenue.
    const { splitRealDemo } = await import("../../shared/billing");
    expect(splitRealDemo([sub as { isDemo: boolean; livemode: boolean }]).real).toHaveLength(0);
  });
});

// =============================================================================
describe("API keys & data API", () => {
  it("requires the apiAccess entitlement, shows the key once, and stops on revoke", async () => {
    expect((await call("POST", "/api/orgs/org_other/api-keys", { token: tokens.otherAdmin, body: { label: "ERP" } })).status).toBe(402);
    expect((await call("POST", "/api/admin/orgs/org_other/settings", { token: tokens.otherAdmin, body: { addOns: ["apiAccess"] } })).status).toBe(403);
    expect((await call("POST", "/api/admin/orgs/org_other/settings", { token: tokens.super, body: { addOns: ["apiAccess"] } })).status).toBe(200);
    const created = await call<{ id: string; key: string }>("POST", "/api/orgs/org_other/api-keys", { token: tokens.otherAdmin, body: { label: "ERP" } });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^ba_live_/);
    const stored = (await admin.getDb().doc(`organizations/org_other/api_keys/${created.body.id}`).get()).data()!;
    expect(JSON.stringify(stored)).not.toContain(created.body.key);
    expect((await call("GET", "/api/v1/flood-zones?psgcCode=1705205000", { headers: { "x-api-key": created.body.key } })).status).toBe(200);
    const outside = await call("GET", "/api/v1/flood-zones?psgcCode=1705208000", { headers: { "x-api-key": created.body.key } });
    expect(outside.status).toBe(403);
    expect((await call("GET", "/api/v1/flood-zones?psgcCode=1705205000", { headers: { "x-api-key": "ba_live_" + "x".repeat(30) } })).status).toBe(401);
    await call("DELETE", `/api/orgs/org_other/api-keys/${created.body.id}`, { token: tokens.otherAdmin });
    expect((await call("GET", "/api/v1/flood-zones?psgcCode=1705205000", { headers: { "x-api-key": created.body.key } })).status).toBe(401);
  });
});

// =============================================================================
describe("cancellation & expiry", () => {
  it("turns paid features off at period end but never public-safety features", async () => {
    expect((await call("POST", "/api/billing/cancel", { token: tokens.owner, body: { orgId: ids.ownerOrg, cancel: true } })).status).toBe(200);
    const db = admin.getDb();
    const org0 = (await db.doc(`organizations/${ids.ownerOrg}`).get()).data()!;
    const sub0 = (await db.doc(`subscriptions/${org0.subscriptionId}`).get()).data()!;
    const { runDailyJobs } = await import("../../server/payments/jobs");
    await runDailyJobs(sub0.currentPeriodEnd.toMillis() + 24 * 3600_000);
    const org = (await db.doc(`organizations/${ids.ownerOrg}`).get()).data()!;
    expect(org.subscriptionStatus).toBe("canceled");
    expect(org.entitlements.fleetMonitoring).toBe(false);
    expect(org.entitlements.floodMonitoring && org.entitlements.emergencyAlerts && org.entitlements.evacuationFinder).toBe(true);
  });

  it("cron and sensor endpoints require their secrets", async () => {
    expect((await call("POST", "/api/cron/daily", {})).status).toBe(401);
    expect((await call("POST", "/api/cron/daily", { headers: { "x-cron-secret": "cron_test_secret" } })).status).toBe(200);
    expect((await call("POST", "/api/ingest/water-level", { headers: { "x-sensor-token": "nope" }, body: { stationId: "s", levelM: 1 } })).status).toBe(401);
  });
});

// =============================================================================
describe("AI quotas & graceful degradation", () => {
  it("enforces the Citizen Free daily chat limit (10/day)", async () => {
    const { consumeQuota } = await import("../../server/ai/quota");
    const caller = { uid: ids.citizen, orgId: null, role: "citizen" as const, anonymous: false, ip: "1.1.1.1" };
    for (let i = 0; i < 10; i++) await consumeQuota(caller, "chat");
    await expect(consumeQuota(caller, "chat")).rejects.toMatchObject({ status: 429, code: "ai_quota_exceeded" });
    // Image analyses have their own 3/day limit.
    for (let i = 0; i < 3; i++) await consumeQuota(caller, "image");
    await expect(consumeQuota(caller, "image")).rejects.toMatchObject({ status: 429 });
  });

  it("bills members of a subscribed org against the org's plan quota", async () => {
    const { resolveQuotaSubject } = await import("../../server/ai/quota");
    const s = await resolveQuotaSubject({ uid: ids.otherAdmin, orgId: "org_other", role: "business_admin", anonymous: false, ip: "x" });
    expect(s).toMatchObject({ subjectType: "org", subjectId: "org_other", planId: "business_pro" });
    expect(s.limits.chatPerMonth).toBe(300);
  });

  it("answers from verified records (not AI) when no provider is configured, without using quota", async () => {
    const res = await call<{ provider: string; reply: string }>("POST", "/api/ai/chat", { token: tokens.lguStaff, body: { message: "Where can I evacuate?" } });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("simulated");
    expect(res.body.reply).toMatch(/911/);
    const usage = await call<{ chat: { usedDay: number; usedMonth: number } }>("GET", "/api/ai/usage", { token: tokens.lguStaff });
    expect(usage.body.chat.usedMonth).toBe(0);
  });
});

// =============================================================================
describe("privilege escalation & onboarding approval", () => {
  it("refuses role changes from anyone but the Super Admin", async () => {
    expect((await call("POST", `/api/admin/users/${ids.citizen}/role`, { token: tokens.citizen, body: { role: "super_admin" } })).status).toBe(403);
    expect((await call("POST", `/api/admin/users/${ids.citizen}/role`, { token: tokens.otherAdmin, body: { role: "lgu_admin" } })).status).toBe(403);
    expect((await call("POST", "/api/orgs/org_other/members", { token: tokens.otherAdmin, body: { email: "n@it.test", name: "Nina", role: "lgu_admin", assignedArea: "Calapan City" } })).status).toBe(403);
    expect((await call("PATCH", `/api/orgs/org_other/members/${ids.otherAdmin}`, { token: tokens.otherAdmin, body: { role: "business_staff" } })).status).toBe(400);
    expect((await call("POST", "/api/orgs/org_other/members", { token: tokens.citizen, body: { email: "n@it.test", name: "Nina", role: "business_staff" } })).status).toBe(403);
  });

  it("LGU onboarding is an application the Super Admin must approve", async () => {
    const app = await call<{ applicationId: string; status: string }>("POST", "/api/orgs", { token: tokens.applicant, body: { type: "lgu", name: "Victoria MDRRMO (test)", jurisdictionAreas: ["Victoria"] } });
    expect(app.body.status).toBe("pending_approval");
    expect((await call("POST", `/api/admin/applications/${app.body.applicationId}/decide`, { token: tokens.applicant, body: { decision: "approve" } })).status).toBe(403);
    const ok = await call<{ orgId: string }>("POST", `/api/admin/applications/${app.body.applicationId}/decide`, { token: tokens.super, body: { decision: "approve" } });
    expect(ok.status).toBe(200);
    const user = await admin.getAdminAuth().getUser(ids.applicant);
    expect(user.customClaims).toMatchObject({ role: "lgu_admin", orgId: ok.body.orgId });
    expect(user.customClaims?.areas).toBeUndefined();
    expect((await admin.getDb().doc(`organizations/${ok.body.orgId}/jurisdiction_grants/1705215000`).get()).exists).toBe(true);
  });
});

// =============================================================================
describe("community reports change the map only through scoped verification", () => {
  it("verifies within jurisdiction and creates an official zone", async () => {
    const report = await call<{ report: { id: string; status: string; area: string } }>("POST", "/api/reports", {
      token: tokens.citizen,
      body: {
        location: { lat: 13.4031, lng: 121.1883 }, locationSource: "gps",
        description: "Knee-deep water outside the public market", depthLabel: "knee",
        regionPsgcCode: "1700000000", provincePsgcCode: "1705200000", municipalityPsgcCode: "1705205000", barangayPsgcCode: null,
        locationAssignment: { method: "manual", confidence: "medium", sourceVersion: "Q2_2026", assignedAt: Date.now(), assignedBy: ids.citizen },
      },
    });
    expect(report.status).toBe(201);
    expect(report.body.report).toMatchObject({ status: "pending", area: "City of Calapan" });
    const id = report.body.report.id;
    const zonesBefore = await admin.getDb().collection("floodZones").where("status", "==", "active").get();

    expect((await call("POST", `/api/reports/${id}/verify`, { token: tokens.naujan, body: { action: "verify" } })).status).toBe(403);
    expect((await call("POST", `/api/reports/${id}/verify`, { token: tokens.citizen, body: { action: "verify" } })).status).toBe(403);
    const ok = await call<{ linkedZoneId: string }>("POST", `/api/reports/${id}/verify`, {
      token: tokens.lguStaff,
      body: { action: "verify", apply: { mode: "create_zone", waterLevelM: 0.5, radiusM: 120 }, publishAlert: false },
    });
    expect(ok.status).toBe(200);
    const zone = (await admin.getDb().doc(`floodZones/${ok.body.linkedZoneId}`).get()).data()!;
    expect(zone).toMatchObject({ status: "active", source: "community_report", area: "City of Calapan", roadPassability: "caution" });
    const zonesAfter = await admin.getDb().collection("floodZones").where("status", "==", "active").get();
    expect(zonesAfter.size).toBe(zonesBefore.size + 1);
    expect((await call("POST", `/api/reports/${id}/verify`, { token: tokens.lguStaff, body: { action: "reject" } })).status).toBe(409);
  });

  it("rejects reports outside the service area and non-image uploads", async () => {
    expect((await call("POST", "/api/reports", { token: tokens.citizen, body: { location: { lat: 14.6, lng: 121.0 }, description: "Flooding in Manila" } })).status).toBe(400);
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    expect((await call("POST", "/api/reports", { token: tokens.citizen, body: { location: { lat: 13.40, lng: 121.18 }, description: "Flooding here now", image: svg } })).status).toBe(400);
  });
});
