import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebaseAdmin";
import type { AuthCtx } from "./auth";

/**
 * Append-only audit trail (audit_logs). Written server-side only; Firestore
 * rules deny client writes. Failures are logged, never thrown — an audit
 * hiccup must not block an emergency action.
 */
export async function audit(
  actor: Pick<AuthCtx, "uid" | "name" | "role"> | { uid: string; name: string; role: string },
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown> = {},
  orgId: string | null = null
): Promise<void> {
  try {
    await getDb().collection("audit_logs").add({
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      action,
      targetType,
      targetId,
      orgId,
      details,
      at: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[audit] failed to write", action, targetId, err);
  }
}

export const SYSTEM_ACTOR = { uid: "system", name: "Bahadvisory system", role: "system" };
