import { useEffect, useRef } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useActiveAlerts } from "./useAlerts";
import { useSavedLocations } from "./useUserData";
import { useFirestoreDoc } from "./useFirestoreDoc";
import { useToast } from "../components/ui";
import { showLocalNotification } from "../lib/push";
import { readLocal, writeLocal } from "../lib/storage";
import { haversineM, toPt, type Pt } from "../../shared/geo";
import { ALERT_SEVERITY_ORDER, DEFAULT_ALERT_PREFERENCES, type AlertPreferences, type PublicAlert, type UserProfile } from "../../shared/types";

const SEEN_KEY = "bahadvisory_seen_alerts_v1";

/** Distance from an alert to the closest of the person's places, if within range. */
export function alertRelevance(a: PublicAlert, places: { name: string; pt: Pt; radiusM: number }[]): { place: string; distanceM: number } | null {
  let best: { place: string; distanceM: number } | null = null;
  for (const p of places) {
    const d = haversineM(p.pt, toPt(a.center));
    if (d <= a.radiusM + p.radiusM && (!best || d < best.distanceM)) best = { place: p.name, distanceM: d };
  }
  return best;
}

/**
 * Watches public alerts while the app is open and notifies the person when
 * a new one covers their saved places or current area (only if they have
 * already granted location access — never prompts on its own). Mounted
 * once at the app root. Works for guests; history is saved for accounts.
 */
export function useAlertWatcher() {
  const { currentUser } = useAuth();
  const alerts = useActiveAlerts();
  const saved = useSavedLocations();
  const profile = useFirestoreDoc<UserProfile>(() => (currentUser && !currentUser.isAnonymous ? doc(db, "users", currentUser.uid) : null), [currentUser?.uid]);
  const toast = useToast();
  const here = useRef<Pt | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((st) => {
      if (st.state !== "granted" || cancelled) return;
      navigator.geolocation.getCurrentPosition((p) => (here.current = [p.coords.latitude, p.coords.longitude]), () => undefined, { maximumAge: 300_000, timeout: 10_000 });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const prefs: AlertPreferences = { ...DEFAULT_ALERT_PREFERENCES, ...(profile.data?.alertPrefs ?? {}) };
    if (!prefs.enabled || alerts.loading) return;
    const seen = new Set(readLocal<string[]>(SEEN_KEY, []));
    const places = [
      ...saved.data.map((s) => ({ name: s.name, pt: toPt(s.location), radiusM: s.alertRadiusM })),
      ...(here.current ? [{ name: "your current area", pt: here.current, radiusM: prefs.radiusM }] : []),
    ];
    if (!places.length) return;
    let changed = false;
    for (const a of alerts.data) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      changed = true;
      if (ALERT_SEVERITY_ORDER.indexOf(a.severity) < ALERT_SEVERITY_ORDER.indexOf(prefs.minSeverity)) continue;
      const rel = alertRelevance(a, places);
      if (!rel) continue;
      const title = `${a.simulated ? "[Simulated] " : ""}${a.title}`;
      toast(`${title} — near ${rel.place}`, a.severity === "critical" || a.severity === "high" ? "danger" : "caution");
      showLocalNotification(title, a.body, a.id);
      if (currentUser) {
        const ref = doc(db, "users", currentUser.uid, "notifications", `alert_${a.id}`);
        getDoc(ref)
          .then((snap) => {
            if (!snap.exists()) {
              return setDoc(ref, { kind: "alert", title: title.slice(0, 200), body: a.body.slice(0, 1900), severity: a.severity, refPath: `alerts/${a.id}`, read: false, createdAt: serverTimestamp() });
            }
          })
          .catch(() => undefined);
      }
    }
    if (changed) writeLocal(SEEN_KEY, [...seen].slice(-300));
  }, [alerts.data, alerts.loading, saved.data, profile.data, currentUser, toast]);
}
