import { useEffect, useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { idbGet, idbPut } from "../lib/idb";
import { useActiveAlerts } from "./useAlerts";
import { useEmergencyContacts } from "./useUserData";
import { useFirestoreCollection } from "./useFirestoreCollection";
import { usePlatform } from "../contexts/PlatformContext";
import { useGeographicScope } from "../contexts/GeographicScopeContext";
import { useScopedPublicData } from "./useScopedPublicData";
import { toMillis } from "../../shared/time";
import { MINDORO_CATALOG, type GeographicScope } from "../../shared/geography";
import type { Advisory, EmergencyContact, EvacuationCenter, PublicAlert } from "../../shared/types";

export interface OfflineSnapshot {
  schemaVersion: 2;
  catalogVersion: string;
  savedAt: number;
  scope: GeographicScope;
  savedNames: { province: string | null; municipality: string | null; barangay: string | null };
  hotlines: { label: string; number: string }[];
  contacts: EmergencyContact[];
  alerts: (Omit<PublicAlert, "createdAt" | "expiresAt"> & { createdAtMs: number | null; expiresAtMs: number | null })[];
  advisories: (Pick<Advisory, "id" | "title" | "body" | "bodyFil" | "severity" | "areas" | "simulated"> & { publishedAtMs: number | null })[];
  centers: (Pick<EvacuationCenter, "id" | "name" | "address" | "area" | "status" | "capacity" | "occupancy" | "occupancyVerified" | "contact" | "facilities" | "simulated"> & {
    location: { lat: number; lng: number };
    updatedAtMs: number | null;
  })[];
}

const KEY = "offline_snapshot_v2";
export const GEOGRAPHIC_CATALOG_VERSION = MINDORO_CATALOG[0]?.sourceVersion ?? "unknown";
const VERIFIED_CENTER_CONSTRAINTS = [where("verified", "==", true)];

export function loadOfflineSnapshot(): Promise<OfflineSnapshot | undefined> {
  return idbGet<OfflineSnapshot>("kv", KEY).catch(() => undefined);
}

/**
 * Keeps an "offline safety kit" in IndexedDB: hotlines, personal emergency
 * contacts, active alerts, recent official advisories and verified
 * evacuation centers — each saved with its own timestamp so the offline
 * page can say exactly how old it is. Only written from live (non-cache)
 * reads. Mounted once at the app root.
 */
export function useOfflineSnapshot() {
  const platform = usePlatform();
  const geographic = useGeographicScope();
  const contacts = useEmergencyContacts();
  const alerts = useActiveAlerts();
  const advisories = useFirestoreCollection<Advisory>(
    () => query(collection(db, "advisories"), where("status", "==", "published"), orderBy("publishedAt", "desc"), limit(10)),
    (id, d) => ({ id, ...(d as Omit<Advisory, "id">) }),
    []
  );
  const centers = useScopedPublicData<EvacuationCenter>({
    collectionName: "evacuation_centers",
    constraints: VERIFIED_CENTER_CONSTRAINTS,
    hardLimit: 100,
    islandEnabled: true,
    mapDoc: (id, d) => ({ id, ...(d as Omit<EvacuationCenter, "id">) }),
  });

  useEffect(() => {
    const live = !alerts.fromCache && !advisories.fromCache && !centers.fromCache;
    if (!live || alerts.loading || advisories.loading || centers.loading || !navigator.onLine) return;
    const snap: OfflineSnapshot = {
      schemaVersion: 2,
      catalogVersion: GEOGRAPHIC_CATALOG_VERSION,
      savedAt: Date.now(),
      scope: geographic.scope,
      savedNames: {
        province: geographic.province?.name ?? null,
        municipality: geographic.municipality?.name ?? null,
        barangay: geographic.barangay?.name ?? null,
      },
      hotlines: platform.emergencyHotlines,
      contacts: contacts.data,
      alerts: alerts.data.map(({ createdAt, expiresAt, ...a }) => ({ ...a, createdAtMs: toMillis(createdAt), expiresAtMs: toMillis(expiresAt) })),
      advisories: advisories.data.map((a) => ({ id: a.id, title: a.title, body: a.body, bodyFil: a.bodyFil, severity: a.severity, areas: a.areas, simulated: a.simulated, publishedAtMs: toMillis(a.publishedAt) })),
      centers: centers.data.map((c) => ({
        id: c.id, name: c.name, address: c.address, area: c.area, status: c.status, capacity: c.capacity, occupancy: c.occupancy,
        occupancyVerified: c.occupancyVerified, contact: c.contact, facilities: c.facilities, simulated: c.simulated,
        location: c.location, updatedAtMs: toMillis(c.updatedAt),
      })),
    };
    idbPut("kv", snap, KEY).catch(() => undefined);
  }, [alerts.data, advisories.data, centers.data, contacts.data, platform.emergencyHotlines, alerts.fromCache, advisories.fromCache, centers.fromCache, alerts.loading, advisories.loading, centers.loading, geographic.scope, geographic.province?.name, geographic.municipality?.name, geographic.barangay?.name]);
}

export function useStoredSnapshot() {
  const [snap, setSnap] = useState<OfflineSnapshot | undefined>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadOfflineSnapshot().then((s) => {
      setSnap(s);
      setLoaded(true);
    });
  }, []);
  return {
    snap,
    loaded,
    ageMs: snap ? Math.max(0, Date.now() - snap.savedAt) : null,
    catalogVersionChanged: !!snap && snap.catalogVersion !== GEOGRAPHIC_CATALOG_VERSION,
  };
}
