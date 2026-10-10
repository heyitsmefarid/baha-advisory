// ---------------------------------------------------------------------------
// Pure subscription & revenue logic (no Firestore). Used by the payment
// webhook processor, the daily job, the seeder and unit tests.
//
// Philippine e-wallets (GCash, Maya) are pay-per-checkout rather than
// stored-card autopay, so renewal = the org admin pays a new checkout. A
// paid renewal extends the current period; an upgrade starts a new period
// immediately; a downgrade is scheduled for the end of the paid period.
// ---------------------------------------------------------------------------

import type { BillingCycle, Subscription, SubscriptionStatus } from "./types";
import type { SubscriptionPlan } from "./plans";
import { DAY, toMillis } from "./time";
import type { CoverageScope } from "./geography/coverage";

export const GRACE_DAYS = 3;

/** Same calendar day next month/year (clamped to month end). */
export function addPeriod(startMs: number, cycle: BillingCycle): number {
  const d = new Date(startMs);
  const day = d.getUTCDate();
  const target = new Date(d);
  target.setUTCDate(1);
  if (cycle === "monthly") target.setUTCMonth(target.getUTCMonth() + 1);
  else target.setUTCFullYear(target.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

export function planPricePhp(plan: Pick<SubscriptionPlan, "priceMonthlyPhp" | "priceAnnualPhp">, cycle: BillingCycle): number | null {
  return cycle === "monthly" ? plan.priceMonthlyPhp : plan.priceAnnualPhp;
}

/** Monthly-equivalent revenue for MRR. */
export function monthlyEquivalent(amountPhp: number, cycle: BillingCycle): number {
  return cycle === "annual" ? Math.round((amountPhp / 12) * 100) / 100 : amountPhp;
}

export function toMinor(amountPhp: number): number {
  return Math.round(amountPhp * 100);
}

/**
 * The status that applies right now, accounting for time passing since
 * the stored status was written (no cron needed for correctness).
 */
export function effectiveStatus(
  sub: Pick<Subscription, "status" | "currentPeriodEnd" | "cancelAtPeriodEnd">,
  now: number
): SubscriptionStatus {
  const end = toMillis(sub.currentPeriodEnd);
  if (sub.status === "active" || sub.status === "past_due") {
    if (end == null) return sub.status;
    if (now <= end) return "active";
    if (sub.cancelAtPeriodEnd) return "canceled";
    if (now <= end + GRACE_DAYS * DAY) return "past_due";
    return "expired";
  }
  return sub.status;
}

/** Paid features stay on during the short past-due grace window. */
export function isEntitlingStatus(status: SubscriptionStatus | "none" | null | undefined): boolean {
  return status === "active" || status === "past_due";
}

export interface PaymentApplication {
  planId: string;
  billingCycle: BillingCycle;
  amountPhp: number;
  coverageScopes?: CoverageScope[];
}

export interface SubscriptionPatch {
  planId: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: null;
  pendingBillingCycle: null;
  mrrPhp: number;
  canceledAt: null;
  coverageScopes: CoverageScope[];
}

/**
 * New subscription state after a confirmed payment.
 * - Same plan & cycle while still within the period/grace → extend from
 *   the current period end (early renewal never loses paid days).
 * - Anything else (new, upgrade, cycle change, lapsed) → new period now.
 */
export function applyPayment(
  current: Pick<Subscription, "planId" | "billingCycle" | "status" | "currentPeriodEnd" | "cancelAtPeriodEnd"> | null,
  payment: PaymentApplication,
  now: number
): SubscriptionPatch {
  const currentEnd = current ? toMillis(current.currentPeriodEnd) : null;
  const live = current ? effectiveStatus(current, now) : "expired";
  const isRenewal =
    current != null &&
    current.planId === payment.planId &&
    current.billingCycle === payment.billingCycle &&
    (live === "active" || live === "past_due") &&
    currentEnd != null;
  const start = isRenewal ? Math.max(currentEnd!, now) : now;
  return {
    planId: payment.planId,
    billingCycle: payment.billingCycle,
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: addPeriod(start, payment.billingCycle),
    cancelAtPeriodEnd: false,
    pendingPlanId: null,
    pendingBillingCycle: null,
    mrrPhp: monthlyEquivalent(payment.amountPhp, payment.billingCycle),
    canceledAt: null,
    coverageScopes: payment.coverageScopes ? payment.coverageScopes.map((scope) => ({ ...scope })) : [],
  };
}

export type PlanChangeKind = "upgrade" | "downgrade" | "same" | "cycle_change";

export function classifyPlanChange(
  from: Pick<SubscriptionPlan, "priceMonthlyPhp"> | null,
  to: Pick<SubscriptionPlan, "priceMonthlyPhp">,
  fromCycle: BillingCycle | null,
  toCycle: BillingCycle,
  samePlan: boolean
): PlanChangeKind {
  if (samePlan) return fromCycle === toCycle ? "same" : "cycle_change";
  const a = from?.priceMonthlyPhp ?? 0;
  const b = to.priceMonthlyPhp ?? Number.POSITIVE_INFINITY;
  return b >= a ? "upgrade" : "downgrade";
}

/** Days until the period ends (negative once past). */
export function daysUntilEnd(sub: Pick<Subscription, "currentPeriodEnd">, now: number): number | null {
  const end = toMillis(sub.currentPeriodEnd);
  return end == null ? null : Math.ceil((end - now) / DAY);
}

/** Reminder thresholds (days before period end) for renewal notices. */
export const REMINDER_DAYS = [7, 3, 1];

export function reminderDue(
  sub: Pick<Subscription, "currentPeriodEnd" | "lastReminderAt" | "cancelAtPeriodEnd" | "status">,
  now: number
): number | null {
  if (sub.cancelAtPeriodEnd || sub.status !== "active") return null;
  const days = daysUntilEnd(sub, now);
  if (days == null) return null;
  const last = toMillis(sub.lastReminderAt);
  // Tightest applicable threshold first, so the 3-day and 1-day reminders
  // still fire after the 7-day one was sent.
  for (const threshold of [...REMINDER_DAYS].sort((a, b) => a - b)) {
    if (days <= threshold && days >= 0) {
      const thresholdStart = (toMillis(sub.currentPeriodEnd) ?? now) - threshold * DAY;
      if (last == null || last < thresholdStart) return threshold;
      return null;
    }
  }
  return null;
}

// ---- Revenue metrics ------------------------------------------------------------

export interface RevenueSub {
  status: SubscriptionStatus;
  currentPeriodEnd: unknown;
  cancelAtPeriodEnd: boolean;
  mrrPhp: number;
  isDemo: boolean;
  livemode?: boolean;
  createdAt?: unknown;
  canceledAt?: unknown;
  planId: string;
}

export interface MrrBreakdown {
  mrrPhp: number;
  arrPhp: number;
  activeSubscriptions: number;
  byPlan: Record<string, { count: number; mrrPhp: number }>;
}

/** MRR from subscriptions that are entitling right now. */
export function computeMrr(subs: RevenueSub[], now: number): MrrBreakdown {
  const out: MrrBreakdown = { mrrPhp: 0, arrPhp: 0, activeSubscriptions: 0, byPlan: {} };
  for (const s of subs) {
    if (!isEntitlingStatus(effectiveStatus(s, now))) continue;
    out.mrrPhp += s.mrrPhp;
    out.activeSubscriptions += 1;
    const p = (out.byPlan[s.planId] ??= { count: 0, mrrPhp: 0 });
    p.count += 1;
    p.mrrPhp += s.mrrPhp;
  }
  out.mrrPhp = Math.round(out.mrrPhp * 100) / 100;
  out.arrPhp = Math.round(out.mrrPhp * 12 * 100) / 100;
  return out;
}

/** Splits subscriptions into real (live payments) vs demo/sandbox. */
export function splitRealDemo<T extends { isDemo: boolean; livemode?: boolean }>(rows: T[]): { real: T[]; demo: T[] } {
  const real: T[] = [];
  const demo: T[] = [];
  for (const r of rows) (r.isDemo || r.livemode === false ? demo : real).push(r);
  return { real, demo };
}

/**
 * Logo churn for a window: subscriptions that stopped entitling during
 * the window ÷ subscriptions entitling at its start.
 */
export function computeChurn(subs: RevenueSub[], windowStart: number, windowEnd: number): { rate: number; churned: number; base: number } {
  let base = 0;
  let churned = 0;
  for (const s of subs) {
    const created = toMillis(s.createdAt) ?? 0;
    if (created > windowStart) continue;
    if (!isEntitlingStatus(effectiveStatus(s, windowStart))) continue;
    base += 1;
    if (!isEntitlingStatus(effectiveStatus(s, windowEnd))) churned += 1;
  }
  return { rate: base === 0 ? 0 : churned / base, churned, base };
}

export function invoiceNumber(seq: number, issuedMs: number): string {
  const d = new Date(issuedMs + 8 * 3600_000);
  return `BA-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(seq).padStart(5, "0")}`;
}
