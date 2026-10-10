import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { badRequest, json, notFound, readJson } from "../lib/http";
import { requireAuth, requireSuperAdmin } from "../lib/auth";
import { audit } from "../lib/audit";
import { clearSettingsCache, getPlan } from "../lib/settings";
import { processPaymentEvent, recomputeOrgEntitlements } from "../payments/processor";
import { rollupRevenue } from "../payments/jobs";
import { asObject, bool, num, oneOf, optStr, str } from "../../shared/validation";
import { computeChurn, computeMrr, monthlyEquivalent, splitRealDemo, toMinor, type RevenueSub } from "../../shared/billing";
import { validatePlan, type SubscriptionPlan } from "../../shared/plans";
import { APP_ROLES } from "../../shared/roles";
import { DAY, manilaDateKey, manilaMonthKey, toMillis } from "../../shared/time";
import type { AiUsageLogEntry, PaymentTransaction } from "../../shared/types";
import { validateCoverageScopes } from "../../shared/geography/coverage";
import type { RouteCtx } from "../router";

/**
 * GET /api/admin/metrics — platform KPIs for the Super Admin. Real revenue
 * (live, non-demo payments) and sandbox/demo figures are always reported
 * separately; projections live on the Business Model page, never here.
 */
export async function metrics(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireSuperAdmin(auth);
  const db = getDb();
  const now = Date.now();
  const days = Math.min(90, Math.max(7, Number(ctx.url.searchParams.get("days") ?? 30)));
  const since = now - days * DAY;

  const [usersTotal, roleCounts, orgSnap, appsPending, subSnap, txSnap, aiSnap] = await Promise.all([
    db.collection("users").count().get(),
    Promise.all([...APP_ROLES, "drrm_editor", "admin"].map(async (r) => [r, (await db.collection("users").where("role", "==", r).count().get()).data().count] as const)),
    db.collection("organizations").get(),
    db.collection("org_applications").where("status", "==", "pending").count().get(),
    db.collection("subscriptions").get(),
    db.collection("payment_transactions").where("createdAt", ">=", Timestamp.fromMillis(now - 365 * DAY)).get(),
    db.collection("ai_usage_log").where("at", ">=", Timestamp.fromMillis(since)).get(),
  ]);

  const subs = subSnap.docs.map((d) => ({ id: d.id, ...(d.data() as RevenueSub) }));
  const { real: realSubs, demo: demoSubs } = splitRealDemo(subs);
  const txs = txSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentTransaction, "id">) }));
  const paid = txs.filter((t) => t.status === "paid");
  const { real: realPaid, demo: demoPaid } = splitRealDemo(paid);

  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(manilaMonthKey(d.getTime()));
  }
  const sumBy = (rows: typeof paid, m: string) => rows.filter((t) => manilaMonthKey(toMillis(t.paidAt) ?? 0) === m).reduce((s, t) => s + t.amountPhp, 0);

  const ai = aiSnap.docs.map((d) => d.data() as AiUsageLogEntry);
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayKeys.push(manilaDateKey(now - i * DAY));
  const aiByDay = dayKeys.map((k) => {
    const rows = ai.filter((a) => manilaDateKey(toMillis(a.at) ?? 0) === k);
    return {
      day: k,
      groq: rows.filter((r) => r.provider === "groq" && r.status !== "error").length,
      gemini: rows.filter((r) => r.provider === "gemini" && r.status !== "error").length,
      errors: rows.filter((r) => r.status === "error").length,
      costUsd: Math.round(rows.reduce((s, r) => s + (r.estCostUsd ?? 0), 0) * 10000) / 10000,
    };
  });
  const byTask: Record<string, number> = {};
  const byProvider: Record<string, { calls: number; tokens: number; costUsd: number; errors: number; cached: number }> = {};
  for (const r of ai) {
    byTask[r.task] = (byTask[r.task] ?? 0) + 1;
    const p = (byProvider[r.provider] ??= { calls: 0, tokens: 0, costUsd: 0, errors: 0, cached: 0 });
    p.calls += 1;
    p.tokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
    p.costUsd += r.estCostUsd ?? 0;
    if (r.status === "error") p.errors += 1;
    if (r.status === "cached") p.cached += 1;
  }

  const orgs = orgSnap.docs.map((d) => d.data());
  return json({
    generatedAt: now,
    windowDays: days,
    users: { total: usersTotal.data().count, byRole: Object.fromEntries(roleCounts) },
    organizations: {
      total: orgs.length,
      byType: orgs.reduce((acc: Record<string, number>, o) => ((acc[o.type] = (acc[o.type] ?? 0) + 1), acc), {}),
      paying: orgs.filter((o) => o.subscriptionStatus === "active" || o.subscriptionStatus === "past_due").length,
      pendingApplications: appsPending.data().count,
    },
    revenue: {
      real: { ...computeMrr(realSubs, now), churn: computeChurn(realSubs, since, now), collected12m: realPaid.reduce((s, t) => s + t.amountPhp, 0) },
      demo: { ...computeMrr(demoSubs, now), churn: computeChurn(demoSubs, since, now), collected12m: demoPaid.reduce((s, t) => s + t.amountPhp, 0) },
      monthly: months.map((m) => ({ month: m, realPhp: sumBy(realPaid, m), demoPhp: sumBy(demoPaid, m) })),
    },
    payments: {
      paid: paid.length,
      failed: txs.filter((t) => t.status === "failed").length,
      pending: txs.filter((t) => t.status === "pending").length,
    },
    ai: {
      calls: ai.length,
      byProvider,
      byTask,
      byDay: aiByDay,
      estCostUsd: Math.round(ai.reduce((s, r) => s + (r.estCostUsd ?? 0), 0) * 10000) / 10000,
      note: "Estimated at list prices from platform_settings/ai; free-tier calls are billed $0 by providers.",
    },
  });
}

/** POST /api/admin/plans/:id — edit (or create) a plan with server validation. */
export async function upsertPlan(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireSuperAdmin(auth);
  const id = ctx.params.id;
  if (!/^[a-z0-9_]{3,40}$/.test(id)) throw badRequest("Plan id must be 3–40 lowercase letters, digits or underscores.");
  const body = asObject(await readJson(req));
  const existing = await getPlan(id);
  const merged = { ...(existing ?? {}), ...body, id } as SubscriptionPlan;
  const v = validatePlan(merged);
  if (!v.ok) throw badRequest(v.errors.join(" "));
  const { id: _omit, ...data } = merged;
  await getDb().doc(`subscription_plans/${id}`).set({ ...data, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid });
  clearSettingsCache();
  // Feature changes apply to every org on the plan.
  const orgs = await getDb().collection("organizations").where("planId", "==", id).get();
  for (const o of orgs.docs) await recomputeOrgEntitlements(o.id);
  await audit(auth, existing ? "plan.updated" : "plan.created", "subscription_plan", id, { fields: Object.keys(body) });
  return json({ ok: true, orgsRecomputed: orgs.size });
}

/** POST /api/admin/settings — platform flags, hotlines, AI tunables. */
export async function updateSettings(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireSuperAdmin(auth);
  const body = asObject(await readJson(req));
  const db = getDb();
  if (body.general) {
    const g = asObject(body.general, "general");
    const patch: Record<string, unknown> = {};
    for (const k of ["demoMode", "aiEnabled", "chatbotEnabled", "imageAnalysisEnabled", "publicReportingEnabled"]) {
      if (g[k] !== undefined) patch[k] = bool(g, k);
    }
    if (g.maintenanceMessage !== undefined) patch.maintenanceMessage = optStr(g, "maintenanceMessage", 300);
    if (Array.isArray(g.emergencyHotlines)) {
      const list = (g.emergencyHotlines as unknown[]).slice(0, 6).map((h, i) => {
        const o = asObject(h, `emergencyHotlines[${i}]`);
        return { label: str(o, "label", { max: 80 }), number: str(o, "number", { max: 30, pattern: /^[0-9+()\-\s]{3,30}$/ }) };
      });
      if (!list.some((h) => h.number.replace(/\D/g, "") === "911")) throw badRequest("Keep 911 (the national emergency hotline) in the list.");
      patch.emergencyHotlines = list;
    }
    await db.doc("platform_settings/general").set({ ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true });
  }
  if (body.ai) {
    const a = asObject(body.ai, "ai");
    const patch: Record<string, unknown> = {};
    if (a.perUserPerMinute !== undefined) patch.perUserPerMinute = num(a, "perUserPerMinute", { min: 1, max: 60, integer: true });
    if (a.cacheTtlMinutes !== undefined) patch.cacheTtlMinutes = num(a, "cacheTtlMinutes", { min: 0, max: 10_080, integer: true });
    if (a.pricing !== undefined) {
      const pricing = asObject(a.pricing, "pricing");
      const clean: Record<string, { inputPerM: number; outputPerM: number }> = {};
      for (const [model, v] of Object.entries(pricing).slice(0, 30)) {
        const o = asObject(v, model);
        clean[model.slice(0, 80)] = { inputPerM: num(o, "inputPerM", { min: 0, max: 1000 }), outputPerM: num(o, "outputPerM", { min: 0, max: 1000 }) };
      }
      patch.pricing = clean;
    }
    await db.doc("platform_settings/ai").set(patch, { merge: true });
  }
  if (body.features) {
    const f = asObject(body.features, "features");
    const patch: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(f).slice(0, 20)) if (typeof v === "boolean") patch[k] = v;
    await db.doc("platform_settings/features").set(patch, { merge: true });
  }
  clearSettingsCache();
  await audit(auth, "platform.settings_updated", "platform_settings", "general", { sections: Object.keys(body) });
  return json({ ok: true });
}

/**
 * POST /api/admin/orgs/:orgId/manual-subscription — record a contract paid
 * outside the online checkout (e.g. an LGU paying by bank transfer after a
 * purchase order). Flows through the same processor; marked provider
 * "manual". Use isDemo for demonstration contracts.
 */
export async function manualSubscription(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireSuperAdmin(auth);
  const orgId = ctx.params.orgId;
  const org = await getDb().doc(`organizations/${orgId}`).get();
  if (!org.exists) throw notFound("Organization not found.");
  const body = asObject(await readJson(req));
  const planId = str(body, "planId", { max: 60 });
  const plan = await getPlan(planId);
  if (!plan) throw badRequest("Unknown plan.");
  const cycle = oneOf(body, "billingCycle", ["monthly", "annual"] as const, "monthly");
  const amountPhp = num(body, "amountPhp", { min: 1, max: 100_000_000 });
  const isDemo = bool(body, "isDemo", false);
  const reference = optStr(body, "reference", 120) ?? "";
  const rawCoverage = org.get("type") === "lgu"
    ? (await getDb().collection(`organizations/${orgId}/jurisdiction_grants`).where("active", "==", true).get()).docs.map((grant) => ({ level: grant.get("level"), psgcCode: grant.get("psgcCode") }))
    : body.coverageScopes;
  const coverage = validateCoverageScopes(rawCoverage);
  if (!coverage.ok) throw badRequest(`Choose valid contract coverage. ${coverage.errors.join(" ")}`, "invalid_coverage");
  const ref = getDb().collection("payment_transactions").doc();
  await ref.set({
    orgId, kind: "subscription", planId, billingCycle: cycle, feeId: null,
    description: `${plan.name} — ${cycle} (contract${reference ? ` ${reference}` : ""})${isDemo ? " (demo)" : ""}`,
    amountPhp, amountMinor: toMinor(amountPhp), currency: "PHP", provider: "manual", providerRef: reference || null, checkoutUrl: null,
    status: "pending", livemode: !isDemo, isDemo, createdBy: auth.uid, createdAt: FieldValue.serverTimestamp(), paidAt: null, invoiceId: null, failureReason: null,
    coverageScopes: coverage.scopes,
  });
  const result = await processPaymentEvent({ provider: "manual", eventId: `manual_${ref.id}`, type: "payment.paid", reference: ref.id, providerRef: reference || null, amountMinor: toMinor(amountPhp), livemode: !isDemo });
  await audit(auth, "billing.manual_contract", "payment_transaction", ref.id, { planId, amountPhp, isDemo, monthlyEquivalent: monthlyEquivalent(amountPhp, cycle) }, orgId);
  return json({ ok: true, ...result, txId: ref.id });
}

/** POST /api/admin/revenue/recompute */
export async function recomputeRevenue(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireSuperAdmin(auth);
  return json({ months: await rollupRevenue() });
}

