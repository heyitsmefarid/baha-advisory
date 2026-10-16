import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { getPlan } from "../lib/settings";
import { HttpError } from "../lib/http";
import { isEntitlingStatus } from "../../shared/billing";
import { DEFAULT_PLAN_BY_ID, type AiLimits } from "../../shared/plans";
import { manilaDateKey, manilaMonthKey } from "../../shared/time";
import type { AppRole } from "../../shared/roles";

export type QuotaKind = "chat" | "image";

export interface AiCaller {
  uid: string | null;
  orgId: string | null;
  role: AppRole;
  anonymous: boolean;
  ip: string;
}

export interface QuotaSubject {
  subjectType: "user" | "org" | "ip";
  subjectId: string;
  planId: string;
  limits: AiLimits;
}

export interface QuotaStatus {
  allowed: boolean;
  kind: QuotaKind;
  planId: string;
  usedDay: number;
  usedMonth: number;
  limitDay: number | null;
  limitMonth: number | null;
}

/**
 * Who pays for an AI call:
 *  - members of an organization with an entitling subscription → the org's
 *    plan quota (shared by all members),
 *  - everyone else (citizens, guests, staff of unpaid orgs) → the Citizen
 *    Free per-person quota,
 *  - the platform Super Admin → Enterprise fair-use limits (never unlimited).
 */
export async function resolveQuotaSubject(caller: AiCaller): Promise<QuotaSubject> {
  if (caller.role === "super_admin" && caller.uid) {
    const plan = (await getPlan("enterprise")) ?? DEFAULT_PLAN_BY_ID.enterprise;
    return { subjectType: "user", subjectId: caller.uid, planId: "enterprise", limits: plan.aiLimits };
  }
  if (caller.orgId) {
    const org = await getDb().doc(`organizations/${caller.orgId}`).get();
    const planId = org.get("planId") as string | null;
    if (org.exists && planId && isEntitlingStatus(org.get("subscriptionStatus"))) {
      const plan = await getPlan(planId);
      if (plan) return { subjectType: "org", subjectId: caller.orgId, planId, limits: plan.aiLimits };
    }
  }
  const free = (await getPlan("citizen_free")) ?? DEFAULT_PLAN_BY_ID.citizen_free;
  if (caller.uid) return { subjectType: "user", subjectId: caller.uid, planId: "citizen_free", limits: free.aiLimits };
  const ipHash = createHash("sha256").update(caller.ip).digest("hex").slice(0, 16);
  return { subjectType: "ip", subjectId: ipHash, planId: "citizen_free", limits: free.aiLimits };
}

function limitsFor(kind: QuotaKind, l: AiLimits) {
  return kind === "chat" ? { day: l.chatPerDay, month: l.chatPerMonth } : { day: l.imagePerDay, month: l.imagePerMonth };
}

function counterRefs(s: QuotaSubject, now: number) {
  const db = getDb();
  const base = `${s.subjectType}_${s.subjectId}`;
  return {
    day: db.doc(`ai_usage_records/${base}_${manilaDateKey(now)}`),
    month: db.doc(`ai_usage_records/${base}_${manilaMonthKey(now)}`),
    dayKey: manilaDateKey(now),
    monthKey: manilaMonthKey(now),
  };
}

/**
 * Atomically checks and reserves one unit of quota. Throws 429
 * `ai_quota_exceeded` when the plan limit is reached.
 */
export async function consumeQuota(caller: AiCaller, kind: QuotaKind, now = Date.now()): Promise<{ subject: QuotaSubject; status: QuotaStatus }> {
  const subject = await resolveQuotaSubject(caller);
  const lim = limitsFor(kind, subject.limits);
  const refs = counterRefs(subject, now);
  const db = getDb();
  const status = await db.runTransaction(async (tx) => {
    const [d, m] = await Promise.all([tx.get(refs.day), tx.get(refs.month)]);
    const usedDay = (d.get(kind) as number) ?? 0;
    const usedMonth = (m.get(kind) as number) ?? 0;
    const st: QuotaStatus = { allowed: true, kind, planId: subject.planId, usedDay, usedMonth, limitDay: lim.day, limitMonth: lim.month };
    if ((lim.day != null && usedDay >= lim.day) || (lim.month != null && usedMonth >= lim.month)) {
      return { ...st, allowed: false };
    }
    const common = { subjectType: subject.subjectType === "ip" ? "user" : subject.subjectType, subjectId: subject.subjectId, updatedAt: FieldValue.serverTimestamp() };
    tx.set(refs.day, { ...common, period: refs.dayKey, [kind]: FieldValue.increment(1) }, { merge: true });
    tx.set(refs.month, { ...common, period: refs.monthKey, [kind]: FieldValue.increment(1) }, { merge: true });
    return { ...st, usedDay: usedDay + 1, usedMonth: usedMonth + 1 };
  });
  if (!status.allowed) {
    const window = lim.day != null && status.usedDay >= lim.day ? "today" : "this month";
    throw new HttpError(
      429,
      `AI ${kind === "chat" ? "assistant" : "photo analysis"} limit reached for ${window} on your plan. Core flood information and reporting still work without AI.`,
      "ai_quota_exceeded",
      { quota: status }
    );
  }
  return { subject, status };
}

/** Gives back a reserved unit when the provider failed (fallbacks are free). */
export async function refundQuota(subject: QuotaSubject, kind: QuotaKind, now = Date.now()): Promise<void> {
  const refs = counterRefs(subject, now);
  await Promise.all([
    refs.day.set({ [kind]: FieldValue.increment(-1) }, { merge: true }),
    refs.month.set({ [kind]: FieldValue.increment(-1) }, { merge: true }),
  ]).catch((err) => console.error("[quota] refund failed", err));
}

export async function quotaOverview(caller: AiCaller, now = Date.now()) {
  const subject = await resolveQuotaSubject(caller);
  const refs = counterRefs(subject, now);
  const [d, m] = await Promise.all([refs.day.get(), refs.month.get()]);
  const view = (kind: QuotaKind) => {
    const lim = limitsFor(kind, subject.limits);
    return { usedDay: (d.get(kind) as number) ?? 0, usedMonth: (m.get(kind) as number) ?? 0, limitDay: lim.day, limitMonth: lim.month };
  };
  return { planId: subject.planId, subjectType: subject.subjectType, chat: view("chat"), image: view("image") };
}
