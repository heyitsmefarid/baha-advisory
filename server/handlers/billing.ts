import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { appBaseUrl, env } from "../lib/env";
import { badRequest, forbidden, HttpError, json, notFound, readJson, readText, unauthorized } from "../lib/http";
import { requireAuth, requireOrgAdmin, type AuthCtx } from "../lib/auth";
import { firestoreRateLimit, memoryRateLimit } from "../lib/rateLimit";
import { getPlan } from "../lib/settings";
import { audit } from "../lib/audit";
import { demoPaymentsEnabled, getProvider } from "../payments";
import { processPaymentEvent, recomputeOrgEntitlements } from "../payments/processor";
import { runDailyJobs } from "../payments/jobs";
import { asObject, bool, oneOf, optStr, str } from "../../shared/validation";
import { classifyPlanChange, effectiveStatus, isEntitlingStatus, planPricePhp, toMinor } from "../../shared/billing";
import type { BillingCycle, Organization, PaymentProviderName, PaymentTransaction, Subscription } from "../../shared/types";
import { validateCoverageScopes, type CoverageScope } from "../../shared/geography/coverage";
import type { RouteCtx } from "../router";

const SEGMENT_FOR_ORG: Record<Organization["type"], string> = { lgu: "lgu", business: "business", enterprise: "enterprise" };

async function loadOrg(orgId: string) {
  const snap = await getDb().doc(`organizations/${orgId}`).get();
  if (!snap.exists) throw notFound("Organization not found.");
  const org = { id: snap.id, ...(snap.data() as Omit<Organization, "id">) };
  if (org.status !== "active") throw forbidden("This organization is not active.");
  return org;
}

async function checkoutCoverage(org: Organization, requested: unknown): Promise<CoverageScope[]> {
  if (org.type === "lgu") {
    const grants = await getDb().collection(`organizations/${org.id}/jurisdiction_grants`).where("active", "==", true).get();
    const validation = validateCoverageScopes(grants.docs.map((grant) => ({ level: grant.get("level"), psgcCode: grant.get("psgcCode") })));
    if (!validation.ok) throw badRequest(`The approved LGU jurisdiction is not billable: ${validation.errors.join(" ")}`, "invalid_coverage");
    return validation.scopes;
  }
  const validation = validateCoverageScopes(requested);
  if (!validation.ok) throw badRequest(`Choose a valid service area. ${validation.errors.join(" ")}`, "invalid_coverage");
  return validation.scopes;
}

async function createTransaction(
  req: Request,
  auth: AuthCtx,
  org: Organization,
  item: { kind: "subscription" | "one_time_fee"; planId: string | null; billingCycle: BillingCycle | null; feeId: string | null; description: string; amountPhp: number; coverageScopes?: CoverageScope[] }
) {
  const provider = getProvider();
  const isDemo = provider.name === "demo";
  const db = getDb();
  const ref = db.collection("payment_transactions").doc();
  const tx: PaymentTransaction = {
    id: ref.id,
    orgId: org.id,
    kind: item.kind,
    planId: item.planId,
    billingCycle: item.billingCycle,
    feeId: item.feeId,
    description: `${item.description}${isDemo ? " (sandbox)" : ""}`,
    amountPhp: item.amountPhp,
    amountMinor: toMinor(item.amountPhp),
    currency: "PHP",
    provider: provider.name,
    providerRef: null,
    checkoutUrl: null,
    status: "pending",
    livemode: false,
    isDemo,
    createdBy: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    paidAt: null,
    invoiceId: null,
    failureReason: null,
    coverageScopes: item.coverageScopes ?? [],
  };
  const { id, ...data } = tx;
  await ref.set(data);
  const base = appBaseUrl(req);
  try {
    const checkout = await provider.createCheckout({
      tx: { ...tx, id },
      orgName: org.name,
      customerEmail: auth.email,
      successUrl: `${base}/billing/return?tx=${id}&status=success`,
      cancelUrl: `${base}/billing/return?tx=${id}&status=cancel`,
    });
    await ref.update({ providerRef: checkout.providerRef, checkoutUrl: checkout.checkoutUrl, livemode: checkout.livemode });
    await audit(auth, "billing.checkout_created", "payment_transaction", id, { provider: provider.name, amountPhp: item.amountPhp, isDemo }, org.id);
    return { txId: id, checkoutUrl: checkout.checkoutUrl, provider: provider.name, isDemo };
  } catch (err) {
    await ref.update({ status: "failed", failureReason: "Could not create checkout" });
    console.error("[billing] checkout failed", err);
    throw new HttpError(502, "The payment provider couldn't start checkout. Please try again.", "checkout_failed");
  }
}

/** POST /api/billing/checkout — start paying for a plan or a one-time fee. */
export async function checkout(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const body = asObject(await readJson(req));
  const orgId = str(body, "orgId", { max: 120 });
  requireOrgAdmin(auth, orgId);
  if (auth.role === "super_admin" && auth.orgId !== orgId) throw forbidden("Organization admins pay for their own subscriptions.");
  await firestoreRateLimit(`checkout:${auth.uid}`, 10, 3600_000);
  const org = await loadOrg(orgId);

  const feeId = optStr(body, "feeId", 80);
  if (feeId) {
    const plan = org.planId ? await getPlan(org.planId) : null;
    const fee = plan?.oneTimeFees?.find((f) => f.id === feeId);
    if (!fee) throw badRequest("That service isn't offered on your current plan.");
    return json(await createTransaction(req, auth, org, { kind: "one_time_fee", planId: null, billingCycle: null, feeId, description: fee.label, amountPhp: fee.amountPhp }), 201);
  }

  const planId = str(body, "planId", { max: 60 });
  const cycle = oneOf(body, "billingCycle", ["monthly", "annual"] as const, "monthly");
  const plan = await getPlan(planId);
  if (!plan || !plan.active) throw badRequest("That plan isn't available.");
  if (plan.segment !== SEGMENT_FOR_ORG[org.type]) throw badRequest(`${plan.name} is for ${plan.segment === "lgu" ? "LGUs" : plan.segment === "business" ? "businesses" : plan.segment}.`);
  const price = planPricePhp(plan, cycle);
  if (price == null) throw new HttpError(400, `${plan.name} uses custom pricing — contact Bahadvisory sales.`, "custom_pricing");
  if (price <= 0) throw badRequest("This plan is free.");
  const coverageScopes = await checkoutCoverage(org, body.coverageScopes);
  return json(await createTransaction(req, auth, org, { kind: "subscription", planId, billingCycle: cycle, feeId: null, description: `${plan.name} — ${cycle} subscription`, amountPhp: price, coverageScopes }), 201);
}

/** POST /api/billing/webhook/:provider — signature-verified, idempotent. */
export async function webhook(req: Request, ctx: RouteCtx): Promise<Response> {
  const name = ctx.params.provider as PaymentProviderName;
  if (name !== "paymongo" && name !== "xendit") throw notFound("Unknown payment provider.");
  memoryRateLimit(`webhook:${ctx.ip}`, 120, 60_000);
  const raw = await readText(req, 256 * 1024);
  const provider = getProvider(name);
  const v = provider.verifyWebhook(raw, req.headers);
  if (!v.valid) {
    console.warn(`[billing] rejected ${name} webhook: ${v.reason}`);
    throw unauthorized("Invalid webhook signature.");
  }
  if (!v.event) return json({ received: true, ignored: true });
  const result = await processPaymentEvent(v.event);
  return json({ received: true, outcome: result.outcome, duplicate: result.duplicate });
}

/**
 * POST /api/billing/demo/:txId/complete — sandbox only. Runs the exact same
 * processor as real webhooks. Idempotent per transaction.
 */
export async function demoComplete(req: Request, ctx: RouteCtx): Promise<Response> {
  if (!demoPaymentsEnabled()) throw notFound();
  const auth = await requireAuth(req);
  const body = asObject(await readJson(req));
  const outcome = oneOf(body, "outcome", ["paid", "failed"] as const);
  const snap = await getDb().doc(`payment_transactions/${ctx.params.txId}`).get();
  if (!snap.exists) throw notFound("Transaction not found.");
  const tx = snap.data() as PaymentTransaction;
  if (tx.provider !== "demo" || !tx.isDemo) throw forbidden("Only sandbox transactions can be completed here.");
  requireOrgAdmin(auth, tx.orgId);
  const result = await processPaymentEvent({
    provider: "demo",
    eventId: `demo_${snap.id}`,
    type: outcome === "paid" ? "payment.paid" : "payment.failed",
    reference: snap.id,
    providerRef: tx.providerRef ?? null,
    amountMinor: tx.amountMinor,
    livemode: false,
  });
  return json(result);
}

async function currentSubscription(org: Organization) {
  if (!org.subscriptionId) throw badRequest("No subscription to change.");
  const ref = getDb().doc(`subscriptions/${org.subscriptionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw badRequest("No subscription to change.");
  return { ref, sub: snap.data() as Subscription };
}

/** POST /api/billing/cancel — cancel (or undo cancelling) at period end. */
export async function cancel(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const body = asObject(await readJson(req));
  const orgId = str(body, "orgId", { max: 120 });
  requireOrgAdmin(auth, orgId);
  const cancelIt = bool(body, "cancel", true);
  const org = await loadOrg(orgId);
  const { ref, sub } = await currentSubscription(org);
  if (!isEntitlingStatus(effectiveStatus(sub, Date.now()))) throw badRequest("This subscription is not active.");
  await ref.update({ cancelAtPeriodEnd: cancelIt, canceledAt: cancelIt ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp() });
  await audit(auth, cancelIt ? "billing.cancel_scheduled" : "billing.cancel_undone", "subscription", ref.id, {}, orgId);
  return json({ ok: true, cancelAtPeriodEnd: cancelIt });
}

/**
 * POST /api/billing/change-plan — upgrades (and cycle changes) start a
 * checkout immediately; downgrades are scheduled for the end of the paid
 * period so no paid time is lost.
 */
export async function changePlan(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const body = asObject(await readJson(req));
  const orgId = str(body, "orgId", { max: 120 });
  requireOrgAdmin(auth, orgId);
  const org = await loadOrg(orgId);
  const planId = str(body, "planId", { max: 60 });
  const cycle = oneOf(body, "billingCycle", ["monthly", "annual"] as const, "monthly");
  const target = await getPlan(planId);
  if (!target || !target.active) throw badRequest("That plan isn't available.");
  const coverageScopes = await checkoutCoverage(org, body.coverageScopes);
  const sub = org.subscriptionId ? ((await getDb().doc(`subscriptions/${org.subscriptionId}`).get()).data() as Subscription | undefined) : undefined;
  const live = sub ? effectiveStatus(sub, Date.now()) : "expired";
  if (!sub || !isEntitlingStatus(live)) {
    return checkout(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ orgId, planId, billingCycle: cycle, coverageScopes }) }), ctx);
  }
  const from = await getPlan(sub.planId);
  const kind = classifyPlanChange(from, target, sub.billingCycle, cycle, sub.planId === planId);
  const ref = getDb().doc(`subscriptions/${org.subscriptionId}`);
  if (kind === "same") {
    await ref.update({ pendingPlanId: null, pendingBillingCycle: null, updatedAt: FieldValue.serverTimestamp() });
    return json({ ok: true, change: "none" });
  }
  if (kind === "downgrade") {
    await ref.update({ pendingPlanId: planId, pendingBillingCycle: cycle, updatedAt: FieldValue.serverTimestamp() });
    await audit(auth, "billing.downgrade_scheduled", "subscription", ref.id, { to: planId, cycle }, orgId);
    return json({ ok: true, change: "downgrade_scheduled", effectiveAt: sub.currentPeriodEnd });
  }
  return checkout(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ orgId, planId, billingCycle: cycle, coverageScopes }) }), ctx);
}

function cronAuthorized(req: Request): boolean {
  const expected = env("CRON_SECRET");
  // Netlify/manual: x-cron-secret. Vercel Cron: Authorization: Bearer <CRON_SECRET>.
  const given = req.headers.get("x-cron-secret") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** POST /api/cron/daily — expiry, scheduled downgrades, reminders, revenue rollup. */
export async function cronDaily(req: Request, _ctx: RouteCtx): Promise<Response> {
  if (!cronAuthorized(req)) throw unauthorized("Invalid cron secret.");
  return json(await runDailyJobs());
}

/** POST /api/admin/orgs/:orgId/recompute — Super Admin repair tool. */
export async function recompute(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth.role !== "super_admin") throw forbidden();
  await recomputeOrgEntitlements(ctx.params.orgId);
  return json({ ok: true });
}

