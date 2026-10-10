import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

// Local development can run entirely against the Firebase Emulator Suite
// (`npm run dev:emulators`) with VITE_USE_EMULATORS=true — no real project,
// credentials or billing needed.
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === "true";

// Firebase web config is not a secret — real protection comes from
// Firestore rules + custom claims, not hiding these values.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (USE_EMULATORS ? "demo-api-key" : undefined),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (USE_EMULATORS ? "demo-bahadvisory" : undefined),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** False when no Firebase project is configured — the UI shows setup help. */
export const FIREBASE_CONFIGURED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

function createFirestore(): Firestore {
  // Persistent (IndexedDB) cache = last-known flood zones, centers and
  // advisories stay readable offline. Falls back to memory where
  // IndexedDB is unavailable (private windows, some in-app browsers).
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}

export const db = createFirestore();

if (USE_EMULATORS) {
  const host = import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

export default app;

// Default map center + zoom, used when geolocation is denied/unavailable.
// Centered between Occidental and Oriental Mindoro for an island-wide view.
export const DEFAULT_CENTER: [number, number] = [
  Number(import.meta.env.VITE_DEFAULT_CENTER_LAT ?? 13.02),
  Number(import.meta.env.VITE_DEFAULT_CENTER_LNG ?? 120.93),
];
export const DEFAULT_ZOOM = Number(import.meta.env.VITE_DEFAULT_ZOOM ?? 8);

// Navigation extent for Mindoro Island. This is a viewport constraint, not an
// administrative boundary; authoritative boundary availability is tracked separately.
export const MINDORO_SERVICE_BOUNDS: [[number, number], [number, number]] = [
  [12.1, 120.02], // southwest
  [13.95, 121.7], // northeast
];

/** @deprecated Use MINDORO_SERVICE_BOUNDS for island-wide coverage. */
export const ORIENTAL_MINDORO_BOUNDS = MINDORO_SERVICE_BOUNDS;

/** Base URL of the backend API (Netlify Functions / Vite dev middleware). */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "/api";
