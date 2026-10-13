import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import app, { db, USE_EMULATORS } from "../firebase";

/**
 * Web push via Firebase Cloud Messaging. Needs:
 *  - VITE_FIREBASE_VAPID_KEY (Console → Cloud Messaging → Web push certificates)
 *  - the Bahadvisory service worker (/sw.js, production builds)
 *  - backend FCM credentials (service account) to send.
 * Every failure returns a plain reason; in-app alerts keep working regardless.
 */
export async function enablePush(uid: string): Promise<{ ok: boolean; reason?: string }> {
  if (USE_EMULATORS) return { ok: false, reason: "Push notifications aren't available on the local emulator. In-app alerts still work." };
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapidKey) return { ok: false, reason: "Push notifications aren't configured on this deployment yet. In-app alerts still work." };
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return { ok: false, reason: "This browser doesn't support push notifications." };
  const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return { ok: false, reason: "This browser doesn't support Firebase push notifications." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Notifications are blocked. Allow them in your browser settings to get alerts when the app is closed." };
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return { ok: false, reason: "Install or reload the app so its service worker can receive alerts." };
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return { ok: false, reason: "Couldn't register this device for push." };
  await updateDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token), "alertPrefs.pushEnabled": true });
  try {
    localStorage.setItem("bahadvisory_fcm_token", token);
  } catch {
    /* ignore */
  }
  return { ok: true };
}

export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("bahadvisory_fcm_token");
  } catch {
    /* ignore */
  }
  await updateDoc(doc(db, "users", uid), {
    "alertPrefs.pushEnabled": false,
    ...(token ? { fcmTokens: arrayRemove(token) } : {}),
  });
}

/** Shows a system notification for an in-app alert when permission exists. */
export async function showLocalNotification(title: string, body: string, tag: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg) await reg.showNotification(title, { body, tag, icon: "/icons/icon-192.png", badge: "/icons/badge-72.png" });
    else new Notification(title, { body, tag });
  } catch {
    /* notification APIs are best-effort */
  }
}
