import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "./firebaseAdmin";
import { HttpError } from "./http";

/**
 * Two layers:
 *  - memoryRateLimit: per-instance sliding window, zero cost, stops bursts.
 *  - firestoreRateLimit: fixed window shared by every serverless instance,
 *    used for abuse-sensitive writes (report submission, checkout, SOS).
 */
const hits = new Map<string, number[]>();

export function memoryRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
    throw new HttpError(429, "Too many requests — please slow down.", "rate_limited", { retryAfterSeconds: retryAfter });
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10_000) hits.clear();
}

export async function firestoreRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const db = getDb();
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 300);
  const ref = db.collection("rate_limits").doc(`${safeKey}_${windowStart}`);
  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.exists ? (snap.get("count") as number) : 0) ?? 0;
    if (current >= limit) return current + 1;
    tx.set(
      ref,
      {
        count: FieldValue.increment(1),
        // Configure a Firestore TTL policy on `expireAt` to auto-delete.
        expireAt: Timestamp.fromMillis(windowStart + windowMs * 2),
      },
      { merge: true }
    );
    return current + 1;
  });
  if (count > limit) {
    throw new HttpError(429, "Rate limit reached — please try again later.", "rate_limited", {
      retryAfterSeconds: Math.ceil((windowStart + windowMs - Date.now()) / 1000),
    });
  }
}
