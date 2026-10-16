import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { json } from "../lib/http";
import { requireAuth } from "../lib/auth";
import { integrationStatus } from "../lib/env";
import { DEFAULT_ALERT_PREFERENCES } from "../../shared/types";
import type { RouteCtx } from "../router";

/** GET /api/health — liveness + which integrations are configured (no secrets). */
export async function health(_req: Request, _ctx: RouteCtx): Promise<Response> {
  return json({ ok: true, service: "bahadvisory-api", time: Date.now(), integrations: integrationStatus() });
}

/**
 * POST /api/auth/bootstrap — called by the client after sign-in/registration.
 * Ensures users/{uid} exists. The role written here is always copied from
 * the verified token's custom claim (or "citizen"), never from the request,
 * so a client cannot self-assign a privileged role.
 */
export async function bootstrapProfile(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req, { allowAnonymous: true });
  if (auth.anonymous) {
    return json({ uid: auth.uid, role: "citizen", anonymous: true, profile: null });
  }
  const db = getDb();
  const ref = db.collection("users").doc(auth.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      name: auth.name,
      email: auth.email ?? "",
      role: auth.rawRole ?? "citizen",
      orgId: auth.orgId,
      assignedArea: auth.assignedArea ?? "",
      active: true,
      alertPrefs: DEFAULT_ALERT_PREFERENCES,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else if ((snap.get("role") ?? "citizen") !== (auth.rawRole ?? "citizen") || (snap.get("orgId") ?? null) !== auth.orgId) {
    // Keep the directory mirror in sync with the authoritative claims.
    await ref.set({ role: auth.rawRole ?? "citizen", orgId: auth.orgId }, { merge: true });
  }
  const profile = (await ref.get()).data();
  return json({ uid: auth.uid, role: auth.role, rawRole: auth.rawRole, orgId: auth.orgId, anonymous: false, profile });
}
