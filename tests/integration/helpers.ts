/**
 * Integration-test harness: drives the real API router (server/router.ts)
 * against the Firebase Auth + Firestore emulators with real ID tokens.
 * Run via `npm run test:emulator` (wraps `firebase emulators:exec`).
 */
// Separate project id: tests never touch the dev/demo project's data.
export const PROJECT = process.env.GCLOUD_PROJECT || "demo-bahadvisory-test";

export function configureEnv() {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
  process.env.FIREBASE_PROJECT_ID = PROJECT;
  process.env.PAYMENT_PROVIDER = "demo";
  process.env.PAYMENTS_DEMO_ENABLED = "true";
  process.env.PAYMONGO_SECRET_KEY = "sk_test_integration";
  process.env.PAYMONGO_WEBHOOK_SECRET = "whsk_test_integration";
  process.env.CRON_SECRET = "cron_test_secret";
  process.env.SENSOR_INGEST_TOKEN = "sensor_test_token";
  // No AI keys: AI endpoints must fall back deterministically.
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
}

export async function resetEmulators() {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${au}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}

export const PASSWORD = "Integration-Test-1";

/**
 * Mints an emulator ID token for the user. When FIREBASE_AUTH_EMULATOR_HOST
 * is set, the Admin SDK accepts unsigned tokens (emulator only) but still
 * checks project, expiry, revocation and that the user exists — and the
 * custom claims come from the user's real, server-set claims.
 */
export async function signIn(email: string): Promise<string> {
  const { getAdminAuth } = await import("../../server/lib/firebaseAdmin");
  const user = await getAdminAuth().getUserByEmail(email);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    auth_time: now + 1,
    user_id: user.uid,
    sub: user.uid,
    iat: now,
    exp: now + 3600,
    email,
    email_verified: true,
    firebase: { sign_in_provider: "password", identities: { email: [email] } },
    ...(user.customClaims ?? {}),
  };
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
}

let ipSeq = 0;

export async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}
): Promise<{ status: number; body: T }> {
  const { handle } = await import("../../server/router");
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] ??= "application/json";
  const res = await handle(
    new Request(`http://bahadvisory.test${path}`, {
      method,
      headers,
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    }),
    { ip: `10.0.0.${++ipSeq % 250}` }
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}
