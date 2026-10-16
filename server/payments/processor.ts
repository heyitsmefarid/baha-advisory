import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { getPlan } from "../lib/settings";
import { audit, SYSTEM_ACTOR } from "../lib/audit";
import { notifyUser } from "../lib/alerts";
import { applyPayment, effectiveStatus, invoiceNumber, isEntitlingStatus } from "../../shared/billing";
import { computeEntitlements, PAID_FEATURES, type PaidFeature } from "../../shared/plans";
import type { PaymentTransaction, Subscription } from "../../shared/types";
import type { NormalizedPaymentEvent } from "./types";

export type ProcessOutcome =
  | "activated"
  | "renewed"
  | "fee_recorded"
  | "failed_recorded"
  | "expired_recorded"
  | "already_paid"
  | "duplicate_event"
  | "unknown_transaction"
  | "provider_mismatch"
  | "amount_mismatch"
  | "livemode_mismatch";

export interface ProcessResult {
  outcome: ProcessOutcome;
  txId: string | null;
  duplicate: boolean;
  subscriptionId?: string | null;
}

const ADMIN_ROLES = ["lgu_admin", "business_admin", "enterprise_admin"];

function eventDocId(ev: NormalizedPaymentEvent) {
  return `${ev.provider}_${ev.eventId}`.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 400);
}

/** Recomputes organizations/{orgId}.entitlements from its plan + live subscription state. */
export async function recomputeOrgEntitlements(orgId: string, now = Date.now()): Promise<void> {
  const db = getDb();
  const orgRef = db.doc(`organizations/${orgId}`);
  const org = await orgRef.get();
  if (!org.exists) return;
  const subId = org.get("subscriptionId") as string | null;
  const sub = subId ? await db.doc(`subscriptions/${subId}`).get() : null;
  const status = sub?.exists ? effectiveStatus(sub.data() as Subscription, now) : "none";
  const planId = (sub?.exists ? sub.get("planId") : org.get("planId")) as string | null;
  const plan = planId ? await getPlan(planId) : null;
  await orgRef.update({
    planId: planId ?? null,
    subscriptionStatus: status,
    entitlements: computeEntitlements(plan, { subscriptionActive: isEntitlingStatus(status), addOns: org.get("addOns") ?? [] }),
  });
  if (sub?.exists && sub.get("status") !== status) await sub.ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
}

/**
 * The single path from "a provider says money moved" to "the org gets paid
 * features". Idempotent: each provider event id is recorded in
 * webhook_events inside the same Firestore transaction that applies it, so
 * retries and duplicate deliveries are no-ops.
 */
export async function processPaymentEvent(ev: NormalizedPaymentEvent, now = Date.now()): Promise<ProcessResult> {
  const db = getDb();
  const eventRef = db.collection("webhook_events").doc(eventDocId(ev));

  // Resolve the transaction (by our reference, else by provider ref) before the txn.
  let txRef = ev.reference ? db.doc(`payment_transactions/${ev.reference}`) : null;
  if (!txRef || !(await txRef.get()).exists) {
    txRef = null;
    if (ev.providerRef) {
      const q = await db.collection("payment_transactions").where("providerRef", "==", ev.providerRef).limit(1).get();
      if (!q.empty) txRef = q.docs[0].ref;
    }
  }
  const pre = txRef ? ((await txRef.get()).data() as PaymentTransaction | undefined) : undefined;
  const plan = pre?.planId ? await getPlan(pre.planId) : null;

  const result = await db.runTransaction(async (t: Transaction): Promise<ProcessResult> => {
    const seen = await t.get(eventRef);
    if (seen.exists) return { outcome: "duplicate_event", txId: (seen.get("txId") as string) ?? null, duplicate: true };
    const record = (outcome: ProcessOutcome, txId: string | null) =>
      t.set(eventRef, { provider: ev.provider, eventId: ev.eventId, type: ev.type, txId, outcome, receivedAt: FieldValue.serverTimestamp() });

    if (!txRef) {
      record("unknown_transaction", null);
      return { outcome: "unknown_transaction", txId: null, duplicate: false };
    }
    const txSnap = await t.get(txRef);
    const tx = { id: txSnap.id, ...(txSnap.data() as Omit<PaymentTransaction, "id">) };
    const orgRef = db.doc(`organizations/${tx.orgId}`);
    const orgSnap = await t.get(orgRef);
    const subRef = orgSnap.get("subscriptionId") ? db.doc(`subscriptions/${orgSnap.get("subscriptionId")}`) : null;
    const subSnap = subRef ? await t.get(subRef) : null;
    const counterRef = db.doc("counters/invoices");
    const counter = ev.type === "payment.paid" ? await t.get(counterRef) : null;

    if (tx.provider !== ev.provider) {
      record("provider_mismatch", tx.id);
      return { outcome: "provider_mismatch", txId: tx.id, duplicate: false };
    }
    if (tx.status === "paid") {
      record("already_paid", tx.id);
      return { outcome: "already_paid", txId: tx.id, duplicate: false };
    }

    if (ev.type !== "payment.paid") {
      const status = ev.type === "payment.expired" ? "expired" : "failed";
      t.update(txRef, { status, failureReason: ev.type === "payment.expired" ? "Checkout expired" : "Payment failed at provider", providerRef: ev.providerRef ?? tx.providerRef ?? null });
      const outcome = status === "expired" ? "expired_recorded" : "failed_recorded";
      record(outcome, tx.id);
      return { outcome, txId: tx.id, duplicate: false };
    }

    // Paid — guard against tampering / mode confusion before granting anything.
    if (ev.amountMinor != null && ev.amountMinor < tx.amountMinor) {
      t.update(txRef, { status: "failed", failureReason: `Amount mismatch: paid ${ev.amountMinor} < due ${tx.amountMinor} centavos — manual review` });
      record("amount_mismatch", tx.id);
      return { outcome: "amount_mismatch", txId: tx.id, duplicate: false };
    }
    if (ev.provider !== "demo" && ev.livemode !== tx.livemode) {
      record("livemode_mismatch", tx.id);
      return { outcome: "livemode_mismatch", txId: tx.id, duplicate: false };
    }

    const seq = ((counter?.get("seq") as number) ?? 0) + 1;
    const invoiceRef = db.collection("billing_invoices").doc();
    t.set(counterRef, { seq }, { merge: true });
    t.set(invoiceRef, {
      number: invoiceNumber(seq, now),
      orgId: tx.orgId,
      orgName: orgSnap.get("name") ?? tx.orgId,
      txId: tx.id,
      lines: [{ description: tx.description, amountPhp: tx.amountPhp }],
      totalPhp: tx.amountPhp,
      provider: tx.provider,
      isDemo: tx.isDemo,
      issuedAt: Timestamp.fromMillis(now),
      status: "paid",
    });
    t.update(txRef, { status: "paid", paidAt: Timestamp.fromMillis(now), invoiceId: invoiceRef.id, providerRef: ev.providerRef ?? tx.providerRef ?? null });

    if (tx.kind === "one_time_fee") {
      // Add-on purchase ("addon:<feature>") unlocks an optional plan feature.
      const addOn = tx.feeId?.startsWith("addon:") ? (tx.feeId.slice(6) as PaidFeature) : null;
      if (addOn && (PAID_FEATURES as readonly string[]).includes(addOn)) {
        const addOns = [...new Set([...((orgSnap.get("addOns") as string[]) ?? []), addOn])];
        const subActive = isEntitlingStatus(orgSnap.get("subscriptionStatus"));
        t.update(orgRef, { addOns, entitlements: computeEntitlements(plan ?? null, { subscriptionActive: subActive, addOns }) });
      }
      record("fee_recorded", tx.id);
      return { outcome: "fee_recorded", txId: tx.id, duplicate: false };
    }

    // Subscription payment.
    const current = subSnap?.exists ? (subSnap.data() as Subscription) : null;
    const liveStatus = current ? effectiveStatus(current, now) : "expired";
    const renewal = Boolean(
      current && current.planId === tx.planId && current.billingCycle === tx.billingCycle && isEntitlingStatus(liveStatus)
    );
    const patch = applyPayment(current, { planId: tx.planId!, billingCycle: tx.billingCycle!, amountPhp: tx.amountPhp }, now);
    // Reuse the org's subscription document, but never mix sandbox and real
    // billing in one record.
    const sameKind = current != null && Boolean(current.isDemo) === Boolean(tx.isDemo);
    const targetRef = subRef && sameKind ? subRef : db.collection("subscriptions").doc();
    t.set(
      targetRef,
      {
        orgId: tx.orgId,
        ...patch,
        currentPeriodStart: Timestamp.fromMillis(patch.currentPeriodStart),
        currentPeriodEnd: Timestamp.fromMillis(patch.currentPeriodEnd),
        provider: tx.provider,
        isDemo: tx.isDemo,
        livemode: tx.livemode,
        updatedAt: FieldValue.serverTimestamp(),
        lastReminderAt: null,
        ...(targetRef === subRef ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );
    t.update(orgRef, {
      planId: patch.planId,
      subscriptionId: targetRef.id,
      subscriptionStatus: "active",
      entitlements: computeEntitlements(plan, { subscriptionActive: true, addOns: orgSnap.get("addOns") ?? [] }),
    });
    const outcome: ProcessOutcome = renewal ? "renewed" : "activated";
    record(outcome, tx.id);
    return { outcome, txId: tx.id, duplicate: false, subscriptionId: targetRef.id };
  });

  // Side effects after commit (never inside the transaction).
  if (!result.duplicate && result.txId && pre) {
    await audit(SYSTEM_ACTOR, `billing.${result.outcome}`, "payment_transaction", result.txId, { provider: ev.provider, eventId: ev.eventId, isDemo: pre.isDemo }, pre.orgId);
    if (["activated", "renewed", "fee_recorded", "failed_recorded", "expired_recorded", "amount_mismatch"].includes(result.outcome)) {
      const members = await db.collection(`organizations/${pre.orgId}/members`).where("role", "in", ADMIN_ROLES).get();
      const ok = result.outcome === "activated" || result.outcome === "renewed" || result.outcome === "fee_recorded";
      for (const m of members.docs) {
        await notifyUser(m.id, {
          kind: "billing",
          title: ok ? "Payment received" : "Payment not completed",
          body: ok
            ? `${pre.description} — ₱${pre.amountPhp.toLocaleString("en-PH")}${pre.isDemo ? " (sandbox, no real charge)" : ""}.`
            : `${pre.description}: ${result.outcome.replace("_", " ")}. No features were changed.`,
        });
      }
    }
  }
  return result;
}
