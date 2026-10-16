/**
 * Backend environment access. Secrets (GROQ_API_KEY, GEMINI_API_KEY,
 * PAYMONGO_SECRET_KEY, ...) are read ONLY here, on the server — they are
 * never prefixed with VITE_ and so never reach the browser bundle.
 */

export function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== "" ? n : fallback;
}

export function isEmulator(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/** Public base URL of the web app (for checkout success/cancel redirects). */
export function appBaseUrl(req?: Request): string {
  const configured = env("APP_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");
  if (req) {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  }
  return "http://localhost:5173";
}

/** Which optional integrations are configured — safe to expose (no values). */
export function integrationStatus() {
  return {
    firebaseAdmin: Boolean(
      env("FIREBASE_SERVICE_ACCOUNT") || env("FIREBASE_PRIVATE_KEY") || isEmulator() || env("GOOGLE_APPLICATION_CREDENTIALS")
    ),
    emulator: isEmulator(),
    groq: Boolean(env("GROQ_API_KEY")),
    gemini: Boolean(env("GEMINI_API_KEY")),
    openRouteService: Boolean(env("ORS_API_KEY")),
    cloudinary: Boolean(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET")),
    paymongo: Boolean(env("PAYMONGO_SECRET_KEY")),
    xendit: Boolean(env("XENDIT_SECRET_KEY")),
    demoPayments: envFlag("PAYMENTS_DEMO_ENABLED", true),
    fcm: Boolean(env("FIREBASE_SERVICE_ACCOUNT") || env("FIREBASE_PRIVATE_KEY")) && !isEmulator(),
    sensorIngest: Boolean(env("SENSOR_INGEST_TOKEN")),
    cron: Boolean(env("CRON_SECRET")),
  };
}
