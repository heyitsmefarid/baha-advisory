import { describe, expect, it } from "vitest";
import {
  addPeriod,
  applyPayment,
  classifyPlanChange,
  computeChurn,
  computeMrr,
  effectiveStatus,
  invoiceNumber,
  isEntitlingStatus,
  reminderDue,
  splitRealDemo,
  type RevenueSub,
} from "../../shared/billing";
import { computeEntitlements, DEFAULT_PLAN_BY_ID, validatePlan } from "../../shared/plans";
import { createPayMongoProvider, paymongoSignature } from "../../server/payments/paymongo";
import { createXenditProvider } from "../../server/payments/xendit";

const D = 24 * 3600_000;
const T0 = Date.UTC(2026, 0, 31, 4, 0, 0); // Jan 31

describe("billing periods & status", () => {
  it("adds calendar months, clamping to month end", () => {
    expect(new Date(addPeriod(T0, "monthly")).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addPeriod(Date.UTC(2026, 2, 15), "annual")).toISOString().slice(0, 10)).toBe("2027-03-15");
  });

  it("moves active → past_due (grace) → expired as time passes", () => {
    const sub = { status: "active" as const, currentPeriodEnd: T0, cancelAtPeriodEnd: false };
    expect(effectiveStatus(sub, T0 - D)).toBe("active");
    expect(effectiveStatus(sub, T0 + 2 * D)).toBe("past_due");
    expect(effectiveStatus(sub, T0 + 4 * D)).toBe("expired");
    expect(effectiveStatus({ ...sub, cancelAtPeriodEnd: true }, T0 + D)).toBe("canceled");
    expect(isEntitlingStatus("past_due")).toBe(true);
    expect(isEntitlingStatus("expired")).toBe(false);
  });
});

describe("applying payments", () => {
  const active = { planId: "business_pro", billingCycle: "monthly" as const, status: "active" as const, currentPeriodEnd: T0 + 10 * D, cancelAtPeriodEnd: true };

  it("starts a new period for a first payment", () => {
    const coverageScopes = [{ level: "municipality" as const, psgcCode: "1705205000" }];
    const p = applyPayment(null, { planId: "lgu_pro", billingCycle: "monthly", amountPhp: 5000, coverageScopes }, T0);
    expect(p.status).toBe("active");
    expect(p.currentPeriodStart).toBe(T0);
    expect(p.mrrPhp).toBe(5000);
    expect(p.coverageScopes).toEqual(coverageScopes);
    expect(p.coverageScopes).not.toBe(coverageScopes);
  });

  it("early renewal extends from the current period end (no paid days lost) and clears cancellation", () => {
    const p = applyPayment(active, { planId: "business_pro", billingCycle: "monthly", amountPhp: 2000 }, T0);
    expect(p.currentPeriodStart).toBe(T0 + 10 * D);
    expect(p.currentPeriodEnd).toBe(addPeriod(T0 + 10 * D, "monthly"));
    expect(p.cancelAtPeriodEnd).toBe(false);
  });

  it("upgrades and cycle changes start immediately; annual MRR is monthly-equivalent", () => {
    const p = applyPayment(active, { planId: "business_pro", billingCycle: "annual", amountPhp: 21600 }, T0);
    expect(p.currentPeriodStart).toBe(T0);
    expect(p.mrrPhp).toBe(1800);
  });

  it("a lapsed subscription renews from now, not from the old end", () => {
    const lapsed = { ...active, currentPeriodEnd: T0 - 20 * D, cancelAtPeriodEnd: false };
    expect(applyPayment(lapsed, { planId: "business_pro", billingCycle: "monthly", amountPhp: 2000 }, T0).currentPeriodStart).toBe(T0);
  });

  it("classifies plan changes", () => {
    const lgu = DEFAULT_PLAN_BY_ID.lgu_pro;
    const biz = DEFAULT_PLAN_BY_ID.business_pro;
    expect(classifyPlanChange(biz, lgu, "monthly", "monthly", false)).toBe("upgrade");
    expect(classifyPlanChange(lgu, biz, "monthly", "monthly", false)).toBe("downgrade");
    expect(classifyPlanChange(biz, biz, "monthly", "annual", true)).toBe("cycle_change");
    expect(classifyPlanChange(biz, DEFAULT_PLAN_BY_ID.enterprise, "monthly", "monthly", false)).toBe("upgrade");
  });

  it("sends each renewal reminder once per threshold", () => {
    const sub = { status: "active" as const, currentPeriodEnd: T0, cancelAtPeriodEnd: false, lastReminderAt: null };
    expect(reminderDue(sub, T0 - 10 * D)).toBeNull();
    expect(reminderDue(sub, T0 - 6 * D)).toBe(7);
    expect(reminderDue({ ...sub, lastReminderAt: T0 - 6 * D }, T0 - 5 * D)).toBeNull();
    expect(reminderDue({ ...sub, lastReminderAt: T0 - 6 * D }, T0 - 2.5 * D)).toBe(3);
    expect(reminderDue({ ...sub, cancelAtPeriodEnd: true }, T0 - D)).toBeNull();
  });

  it("formats invoice numbers", () => {
    expect(invoiceNumber(42, Date.UTC(2026, 9, 9))).toBe("BA-202610-00042");
  });
});

describe("revenue metrics keep real and demo money apart", () => {
  const subs: RevenueSub[] = [
    { status: "active", currentPeriodEnd: T0 + 20 * D, cancelAtPeriodEnd: false, mrrPhp: 5000, isDemo: false, livemode: true, planId: "lgu_pro", createdAt: T0 - 60 * D },
    { status: "active", currentPeriodEnd: T0 + 200 * D, cancelAtPeriodEnd: false, mrrPhp: 1800, isDemo: false, livemode: true, planId: "business_pro", createdAt: T0 - 60 * D },
    { status: "active", currentPeriodEnd: T0 + 20 * D, cancelAtPeriodEnd: false, mrrPhp: 15000, isDemo: true, livemode: false, planId: "enterprise", createdAt: T0 - 60 * D },
    { status: "active", currentPeriodEnd: T0 - 10 * D, cancelAtPeriodEnd: false, mrrPhp: 5000, isDemo: false, livemode: true, planId: "lgu_pro", createdAt: T0 - 60 * D },
  ];

  it("computes MRR/ARR from entitling subscriptions only", () => {
    const { real, demo } = splitRealDemo(subs);
    const r = computeMrr(real, T0);
    expect(r.mrrPhp).toBe(6800);
    expect(r.arrPhp).toBe(81600);
    expect(r.activeSubscriptions).toBe(2);
    expect(computeMrr(demo, T0).mrrPhp).toBe(15000);
  });

  it("computes logo churn over a window", () => {
    const { real } = splitRealDemo(subs);
    const c = computeChurn(real, T0 - 30 * D, T0);
    expect(c.base).toBe(3);
    expect(c.churned).toBe(1);
  });
});

describe("plans & entitlements", () => {
  it("public-safety features are always on, even with no or lapsed plans", () => {
    for (const e of [computeEntitlements(null, { subscriptionActive: false }), computeEntitlements(DEFAULT_PLAN_BY_ID.lgu_pro, { subscriptionActive: false })]) {
      expect(e.floodMonitoring && e.basicNavigation && e.emergencyAlerts && e.communityReporting && e.evacuationFinder).toBe(true);
      expect(e.incidentManagement || e.fleetMonitoring || e.advancedAnalytics).toBe(false);
    }
  });

  it("optional features need the add-on; included ones need an active subscription", () => {
    const biz = DEFAULT_PLAN_BY_ID.business_pro;
    expect(computeEntitlements(biz, { subscriptionActive: true }).fleetMonitoring).toBe(true);
    expect(computeEntitlements(biz, { subscriptionActive: true }).apiAccess).toBe(false);
    expect(computeEntitlements(biz, { subscriptionActive: true, addOns: ["apiAccess"] }).apiAccess).toBe(true);
    expect(computeEntitlements(biz, { subscriptionActive: false, addOns: ["apiAccess"] }).apiAccess).toBe(false);
  });

  it("validatePlan blocks monetizing safety, unlimited AI, and paid citizen plans", () => {
    expect(validatePlan(DEFAULT_PLAN_BY_ID.lgu_pro).ok).toBe(true);
    expect(validatePlan({ ...DEFAULT_PLAN_BY_ID.lgu_pro, features: { ...DEFAULT_PLAN_BY_ID.lgu_pro.features, emergencyAlerts: false } as never }).errors.join(" ")).toMatch(/public-safety/);
    expect(validatePlan({ ...DEFAULT_PLAN_BY_ID.lgu_pro, aiLimits: { chatPerDay: null, chatPerMonth: null, imagePerDay: 5, imagePerMonth: null } }).errors.join(" ")).toMatch(/unlimited/);
    expect(validatePlan({ ...DEFAULT_PLAN_BY_ID.citizen_free, priceMonthlyPhp: 99 }).errors.join(" ")).toMatch(/must stay free/);
    expect(validatePlan({ ...DEFAULT_PLAN_BY_ID.lgu_pro, priceMonthlyPhp: -1 }).ok).toBe(false);
  });
});

describe("PayMongo webhook verification", () => {
  const secret = "whsk_test_secret";
  const provider = createPayMongoProvider({ secretKey: "sk_test_x", webhookSecret: secret, paymentMethods: ["gcash"] });
  const body = (livemode = false, type = "checkout_session.payment.paid", amount = 500000) =>
    JSON.stringify({
      data: {
        id: "evt_123",
        attributes: {
          type,
          livemode,
          data: { id: "cs_abc", attributes: { reference_number: "tx_1", line_items: [{ amount, quantity: 1 }], payments: [{ attributes: { amount } }] } },
        },
      },
    });
  const headers = (raw: string, opts: { live?: boolean; t?: number; tamper?: boolean } = {}) => {
    const t = String(opts.t ?? Math.floor(Date.now() / 1000));
    const sig = paymongoSignature(secret, t, raw);
    const te = opts.live ? "0".repeat(64) : opts.tamper ? sig.replace(/^./, sig[0] === "a" ? "b" : "a") : sig;
    const li = opts.live ? sig : "0".repeat(64);
    return new Headers({ "paymongo-signature": `t=${t},te=${te},li=${li}` });
  };

  it("accepts a correctly signed test event and normalizes it", () => {
    const raw = body();
    const v = provider.verifyWebhook(raw, headers(raw));
    expect(v.valid).toBe(true);
    expect(v.event).toMatchObject({ provider: "paymongo", eventId: "evt_123", type: "payment.paid", reference: "tx_1", providerRef: "cs_abc", amountMinor: 500000, livemode: false });
  });

  it("checks the live signature (li) for live events", () => {
    const raw = body(true);
    expect(provider.verifyWebhook(raw, headers(raw, { live: true })).valid).toBe(true);
    expect(provider.verifyWebhook(raw, headers(raw)).valid).toBe(false);
  });

  it("rejects tampered bodies, bad signatures, stale timestamps and missing headers", () => {
    const raw = body();
    expect(provider.verifyWebhook(raw.replace("500000", "1"), headers(raw)).valid).toBe(false);
    expect(provider.verifyWebhook(raw, headers(raw, { tamper: true })).valid).toBe(false);
    expect(provider.verifyWebhook(raw, headers(raw, { t: Math.floor(Date.now() / 1000) - 3600 })).reason).toMatch(/stale/);
    expect(provider.verifyWebhook(raw, new Headers()).valid).toBe(false);
  });

  it("acknowledges signed but irrelevant events without acting on them", () => {
    const raw = body(false, "source.chargeable");
    const v = provider.verifyWebhook(raw, headers(raw));
    expect(v.valid).toBe(true);
    expect(v.event).toBeNull();
  });
});

describe("Xendit callback verification", () => {
  const provider = createXenditProvider({ secretKey: "xnd_development_x", callbackToken: "cb_token_123" });
  const raw = JSON.stringify({ id: "inv_9", external_id: "tx_9", status: "PAID", paid_amount: 2000 });

  it("requires the exact callback token", () => {
    expect(provider.verifyWebhook(raw, new Headers({ "x-callback-token": "nope" })).valid).toBe(false);
    expect(provider.verifyWebhook(raw, new Headers()).valid).toBe(false);
  });

  it("normalizes PAID invoices into peso-centavo amounts", () => {
    const v = provider.verifyWebhook(raw, new Headers({ "x-callback-token": "cb_token_123" }));
    expect(v.event).toMatchObject({ type: "payment.paid", reference: "tx_9", providerRef: "inv_9", amountMinor: 200000, livemode: false, eventId: "inv_9:PAID" });
  });
});
