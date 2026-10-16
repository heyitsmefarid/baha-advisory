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
// Centered on Oriental Mindoro province (near Calapan City, the capital)
// rather than Manila, since this app is scoped to Oriental Mindoro.
export const DEFAULT_CENTER: [number, number] = [
  Number(import.meta.env.VITE_DEFAULT_CENTER_LAT ?? 13.05),
  Number(import.meta.env.VITE_DEFAULT_CENTER_LNG ?? 121.35),
];
// Zoom 9 shows the whole province (Calapan down to Bulalacao/Mansalay)
// instead of a single-city close-up.
export const DEFAULT_ZOOM = Number(import.meta.env.VITE_DEFAULT_ZOOM ?? 9);

// Rough bounding box for Oriental Mindoro province, used to constrain
// panning so editors/public users can't wander off into other regions.
export const ORIENTAL_MINDORO_BOUNDS: [[number, number], [number, number]] = [
  [12.15, 120.85], // southwest
  [13.55, 121.75], // northeast
];

/** Base URL of the backend API (Netlify Functions / Vite dev middleware). */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "/api";
