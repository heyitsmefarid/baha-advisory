import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { getPlan } from "../lib/settings";
import { notifyUser } from "../lib/alerts";
import { audit, SYSTEM_ACTOR } from "../lib/audit";
import { recomputeOrgEntitlements } from "./processor";
import { computeMrr, effectiveStatus, monthlyEquivalent, planPricePhp, reminderDue, splitRealDemo, type RevenueSub } from "../../shared/billing";
import { manilaMonthKey, toMillis } from "../../shared/time";
import type { PaymentTransaction, Subscription } from "../../shared/types";

const ADMIN_ROLES = ["lgu_admin", "business_admin", "enterprise_admin"];

async function notifyOrgAdmins(orgId: string, title: string, body: string) {
  const members = await getDb().collection(`organizations/${orgId}/members`).where("role", "in", ADMIN_ROLES).get();
  await Promise.all(members.docs.map((m) => notifyUser(m.id, { kind: "billing", title, body })));
}

/**
 * Daily maintenance (Netlify scheduled function / POST /api/cron/daily):
 *  1. apply scheduled downgrades and cancellations at period end,
 *  2. move lapsed subscriptions to past_due → expired and recompute
 *     organization entitlements (paid features switch off; public-safety
 *     features never do),
 *  3. send renewal reminders 7 / 3 / 1 days before the period ends,
 *  4. roll up monthly revenue (real and demo kept separate).
 * Correctness does not depend on this running: entitlement checks compute
 * the live status from currentPeriodEnd themselves.
 */
export async function runDailyJobs(now = Date.now()) {
  const db = getDb();
  const summary = { checked: 0, statusChanged: 0, downgradesApplied: 0, reminders: 0, revenueMonths: [] as string[] };
  const subs = await db.collection("subscriptions").where("status", "in", ["active", "past_due"]).get();

  for (const doc of subs.docs) {
    summary.checked++;
    const sub = doc.data() as Subscription;
    const end = toMillis(sub.currentPeriodEnd) ?? now;

    if (now > end && sub.pendingPlanId && !sub.cancelAtPeriodEnd) {
      const plan = await getPlan(sub.pendingPlanId);
      const cycle = sub.pendingBillingCycle ?? sub.billingCycle;
      const price = plan ? planPricePhp(plan, cycle) : null;
      await doc.ref.update({
        planId: sub.pendingPlanId,
        billingCycle: cycle,
        pendingPlanId: null,
        pendingBillingCycle: null,
        status: "past_due",
        mrrPhp: price != null ? monthlyEquivalent(price, cycle) : 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await notifyOrgAdmins(sub.orgId, "Plan change took effect", `Your organization moved to ${plan?.name ?? sub.pendingPlanId}. Pay the new plan within 3 days to keep its features.`);
      await audit(SYSTEM_ACTOR, "billing.downgrade_applied", "subscription", doc.id, { to: sub.pendingPlanId }, sub.orgId);
      summary.downgradesApplied++;
      await recomputeOrgEntitlements(sub.orgId, now);
      continue;
    }

    const live = effectiveStatus(sub, now);
    if (live !== sub.status) {
      await doc.ref.update({ status: live, updatedAt: FieldValue.serverTimestamp() });
      await recomputeOrgEntitlements(sub.orgId, now);
      summary.statusChanged++;
      if (live === "expired" || live === "canceled") {
        await notifyOrgAdmins(sub.orgId, "Subscription ended", "Paid features are now off. Public-safety features keep working. Renew from your billing page any time.");
      } else if (live === "past_due") {
        await notifyOrgAdmins(sub.orgId, "Payment due", "Your billing period ended. Renew within 3 days to keep paid features.");
      }
      continue;
    }

    const due = reminderDue(sub, now);
    if (due != null) {
      await notifyOrgAdmins(sub.orgId, `Subscription renews in ${due} day${due > 1 ? "s" : ""}`, `Your ${sub.planId.replace("_", " ")} period ends on ${new Date(end).toLocaleDateString("en-PH")}. Renew from the billing page to avoid interruption${sub.isDemo ? " (sandbox subscription)" : ""}.`);
      await doc.ref.update({ lastReminderAt: Timestamp.fromMillis(now) });
      summary.reminders++;
    }
  }

  summary.revenueMonths = await rollupRevenue(now);
  return summary;
}

/** Recomputes revenue_records for this month and last month. */
export async function rollupRevenue(now = Date.now()): Promise<string[]> {
  const db = getDb();
  const d = new Date(now + 8 * 3600_000); // Manila calendar
  const prevMonthMid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15);
  const months = [manilaMonthKey(now), manilaMonthKey(prevMonthMid)];
  const [txSnap, subSnap] = await Promise.all([
    db.collection("payment_transactions").where("status", "==", "paid").get(),
    db.collection("subscriptions").get(),
  ]);
  const txs = txSnap.docs.map((d) => d.data() as PaymentTransaction);
  const subs = subSnap.docs.map((d) => d.data() as RevenueSub);
  const { real: realSubs, demo: demoSubs } = splitRealDemo(subs);
  for (const month of months) {
    const inMonth = txs.filter((t) => manilaMonthKey(toMillis(t.paidAt) ?? 0) === month);
    const { real, demo } = splitRealDemo(inMonth);
    const ref = db.doc(`revenue_records/${month}`);
    await ref.set({
      month,
      real: { collectedPhp: real.reduce((s, t) => s + t.amountPhp, 0), transactions: real.length, mrrPhp: computeMrr(realSubs, now).mrrPhp, activeSubscriptions: computeMrr(realSubs, now).activeSubscriptions },
      demo: { collectedPhp: demo.reduce((s, t) => s + t.amountPhp, 0), transactions: demo.length, mrrPhp: computeMrr(demoSubs, now).mrrPhp, activeSubscriptions: computeMrr(demoSubs, now).activeSubscriptions },
      computedAt: FieldValue.serverTimestamp(),
    });
  }
  return months;
}
