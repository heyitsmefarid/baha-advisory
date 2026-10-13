import { cert, getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { env, isEmulator } from "./env";

/**
 * Lazily initializes the Admin SDK from (in order):
 *  1. FIREBASE_SERVICE_ACCOUNT — the service-account JSON, raw or base64
 *  2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *  3. Emulator mode (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST)
 *  4. Application Default Credentials
 * Never commit service-account files; set them as host environment variables.
 */
let app: App | null = null;
let db: Firestore | null = null;

function parseServiceAccount(raw: string): Record<string, string> {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(text);
}

export function getAdminApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }
  const projectId = env("FIREBASE_PROJECT_ID") || env("VITE_FIREBASE_PROJECT_ID") || env("GCLOUD_PROJECT");
  const saRaw = env("FIREBASE_SERVICE_ACCOUNT");
  if (saRaw) {
    const sa = parseServiceAccount(saRaw);
    app = initializeApp({ credential: cert(sa as never), projectId: projectId || sa.project_id });
  } else if (env("FIREBASE_PRIVATE_KEY") && env("FIREBASE_CLIENT_EMAIL")) {
    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail: env("FIREBASE_CLIENT_EMAIL"),
        privateKey: env("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
      projectId,
    });
  } else if (isEmulator()) {
    app = initializeApp({ projectId: projectId || "demo-bahadvisory" });
  } else {
    app = initializeApp({ credential: applicationDefault(), projectId: projectId || undefined });
  }
  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  db = getFirestore(getAdminApp());
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Already configured: the dev server hot-reloaded this module while the
    // underlying Admin app (and its Firestore instance) stayed alive.
  }
  return db;
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

/** FCM is unavailable on the emulator; callers must handle null. */
export function getMessagingOrNull() {
  if (isEmulator()) return null;
  try {
    return getMessaging(getAdminApp());
  } catch {
    return null;
  }
}
