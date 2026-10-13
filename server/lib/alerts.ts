import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb, getMessagingOrNull } from "./firebaseAdmin";
import { appBaseUrl } from "./env";
import { haversineM, toPt } from "../../shared/geo";
import { ALERT_SEVERITY_ORDER, type AlertSeverity, type AlertType, type LatLng, type UserProfile } from "../../shared/types";
import type { GeographicReference } from "../../shared/geography";
import { invalidateGeographicSummary } from "./geographicSummary";

export interface NewAlert {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  center: LatLng;
  radiusM: number;
  area: string;
  sourceRef?: string | null;
  issuedBy: string;
  issuedByName: string;
  orgId?: string | null;
  expiresInHours?: number;
  simulated?: boolean;
  geography: GeographicReference;
}

const PREF_TYPE: Record<AlertType, keyof NonNullable<UserProfile["alertPrefs"]>["types"]> = {
  flood: "flood",
  road_closure: "roadClosure",
  evacuation: "evacuation",
  advisory: "advisory",
};

/**
 * Publishes a public alert (always free) and notifies nearby users:
 *  - in-app history (users/{uid}/notifications) for everyone in range who
 *    opted in, matched against their saved places / last alert location;
 *  - FCM web push to their registered devices when FCM is configured.
 * Returns how many users were matched and how many pushes succeeded.
 */
export async function publishAlert(a: NewAlert): Promise<{ alertId: string; matchedUsers: number; pushSent: number; pushNote: string }> {
  const db = getDb();
  const ref = db.collection("alerts").doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + (a.expiresInHours ?? 12) * 3600_000);
  await ref.set({
    type: a.type,
    severity: a.severity,
    title: a.title.slice(0, 200),
    body: a.body.slice(0, 2000),
    center: a.center,
    radiusM: a.radiusM,
    area: a.area,
    sourceRef: a.sourceRef ?? null,
    issuedBy: a.issuedBy,
    issuedByName: a.issuedByName,
    orgId: a.orgId ?? null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    active: true,
    pushSent: 0,
    simulated: Boolean(a.simulated),
    ...a.geography,
  });

  const { matchedUsers, pushSent, pushNote } = await fanOut(ref.id, a).catch((err) => {
    console.error("[alerts] fan-out failed", err);
    return { matchedUsers: 0, pushSent: 0, pushNote: "Notification fan-out failed; the alert is still public." };
  });
  await ref.update({ pushSent, matchedUsers });
  await invalidateGeographicSummary(a.geography);
  return { alertId: ref.id, matchedUsers, pushSent, pushNote };
}

async function fanOut(alertId: string, a: NewAlert) {
  const db = getDb();
  const center = toPt(a.center);
  const users = await db.collection("users").where("alertPrefs.enabled", "==", true).limit(1000).get();
  const tokens: { uid: string; token: string }[] = [];
  let matched = 0;
  const batch = db.batch();
  let writes = 0;

  for (const doc of users.docs) {
    const u = doc.data() as UserProfile;
    const prefs = u.alertPrefs;
    if (!prefs || !prefs.types?.[PREF_TYPE[a.type]]) continue;
    if (ALERT_SEVERITY_ORDER.indexOf(a.severity) < ALERT_SEVERITY_ORDER.indexOf(prefs.minSeverity ?? "moderate")) continue;
    const places: { pt: [number, number]; radius: number }[] = [];
    if (u.alertLocation) places.push({ pt: toPt(u.alertLocation), radius: prefs.radiusM ?? 3000 });
    const saved = await doc.ref.collection("saved_locations").limit(10).get();
    saved.forEach((s) => {
      const loc = s.get("location") as LatLng | undefined;
      if (loc) places.push({ pt: toPt(loc), radius: (s.get("alertRadiusM") as number) ?? prefs.radiusM ?? 3000 });
    });
    const inRange = places.some((p) => haversineM(p.pt, center) <= a.radiusM + p.radius);
    if (!inRange) continue;
    matched++;
    batch.set(doc.ref.collection("notifications").doc(`alert_${alertId}`), {
      kind: "alert",
      title: a.title,
      body: a.body.slice(0, 500),
      severity: a.severity,
      refPath: `alerts/${alertId}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    writes++;
    if (prefs.pushEnabled) for (const t of u.fcmTokens ?? []) tokens.push({ uid: doc.id, token: t });
    if (writes >= 400) break;
  }
  if (writes) await batch.commit();

  const messaging = getMessagingOrNull();
  if (!messaging) {
    return { matchedUsers: matched, pushSent: 0, pushNote: "Push notifications need FCM credentials (not available on the emulator); in-app alerts were delivered." };
  }
  if (!tokens.length) return { matchedUsers: matched, pushSent: 0, pushNote: "No matching users have push enabled." };

  let sent = 0;
  const dead: { uid: string; token: string }[] = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      notification: { title: a.title, body: a.body.slice(0, 180) },
      data: { alertId, severity: a.severity, type: a.type, simulated: String(Boolean(a.simulated)) },
      webpush: {
        fcmOptions: { link: `${appBaseUrl()}/alerts?alert=${alertId}` },
        notification: { icon: "/icons/icon-192.png", badge: "/icons/badge-72.png", requireInteraction: a.severity === "critical" },
      },
    });
    sent += res.successCount;
    res.responses.forEach((r, j) => {
      const code = r.error?.code ?? "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) dead.push(chunk[j]);
    });
  }
  for (const d of dead) {
    await db.doc(`users/${d.uid}`).update({ fcmTokens: FieldValue.arrayRemove(d.token) }).catch(() => undefined);
  }
  return { matchedUsers: matched, pushSent: sent, pushNote: `Push sent to ${sent} device(s).` };
}

/** Per-user notification (billing, report status, …). */
export async function notifyUser(uid: string, n: { kind: "billing" | "report" | "system" | "alert"; title: string; body: string; refPath?: string; severity?: AlertSeverity }) {
  await getDb()
    .collection("users")
    .doc(uid)
    .collection("notifications")
    .add({ ...n, read: false, createdAt: FieldValue.serverTimestamp() })
    .catch((err) => console.error("[notify] failed", err));
}
