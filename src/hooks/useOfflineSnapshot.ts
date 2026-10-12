import { useEffect, useRef, useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { idbDelete, idbGet, idbPut } from "../lib/idb";
import { useActiveAlerts } from "./useAlerts";
import { useEmergencyContacts } from "./useUserData";
import { useFirestoreCollection } from "./useFirestoreCollection";
import { usePlatform } from "../contexts/PlatformContext";
import { useGeographicScope } from "../contexts/GeographicScopeContext";
import { useAuth } from "../contexts/AuthContext";
import { privateOfflineSnapshotKey, PUBLIC_OFFLINE_SNAPSHOT_KEY } from "../lib/offlineSnapshotKeys";
import { useScopedPublicData } from "./useScopedPublicData";
import { toMillis } from "../../shared/time";
import { MINDORO_CATALOG, type GeographicScope } from "../../shared/geography";
import type { Advisory, EmergencyContact, EvacuationCenter, PublicAlert } from "../../shared/types";

export interface OfflineSnapshot {
  schemaVersion: 3;
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

export const GEOGRAPHIC_CATALOG_VERSION = MINDORO_CATALOG[0]?.sourceVersion ?? "unknown";
const VERIFIED_CENTER_CONSTRAINTS = [where("verified", "==", true)];

interface PrivateOfflineSnapshot {
  schemaVersion: 3;
  uid: string;
  contacts: EmergencyContact[];
}

export async function loadOfflineSnapshot(uid?: string | null): Promise<OfflineSnapshot | undefined> {
  const publicSnapshot = await idbGet<OfflineSnapshot>("kv", PUBLIC_OFFLINE_SNAPSHOT_KEY).catch(() => undefined);
  if (!publicSnapshot) return undefined;
  if (!uid) return { ...publicSnapshot, contacts: [] };
  const privateSnapshot = await idbGet<PrivateOfflineSnapshot>("kv", privateOfflineSnapshotKey(uid)).catch(() => undefined);
  return { ...publicSnapshot, contacts: privateSnapshot?.uid === uid ? privateSnapshot.contacts : [] };
}

/**
 * Keeps an "offline safety kit" in IndexedDB: hotlines, personal emergency
 * contacts, active alerts, recent official advisories and verified
 * evacuation centers — each saved with its own timestamp so the offline
 * page can say exactly how old it is. Only written from live (non-cache)
 * reads. Mounted once at the app root.
 */
export function useOfflineSnapshot() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid ?? null;
  const previousUid = useRef<string | null>(null);
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
    const previous = previousUid.current;
    if (previous && previous !== uid) idbDelete("kv", privateOfflineSnapshotKey(previous)).catch(() => undefined);
    previousUid.current = uid;
  }, [uid]);

  useEffect(() => {
    const live = !alerts.fromCache && !advisories.fromCache && !centers.fromCache;
    if (!live || alerts.loading || advisories.loading || centers.loading || !navigator.onLine) return;
    const snap: OfflineSnapshot = {
      schemaVersion: 3,
      catalogVersion: GEOGRAPHIC_CATALOG_VERSION,
      savedAt: Date.now(),
      scope: geographic.scope,
      savedNames: {
        province: geographic.province?.name ?? null,
        municipality: geographic.municipality?.name ?? null,
        barangay: geographic.barangay?.name ?? null,
      },
      hotlines: platform.emergencyHotlines,
      contacts: [],
      alerts: alerts.data.map(({ createdAt, expiresAt, ...a }) => ({ ...a, createdAtMs: toMillis(createdAt), expiresAtMs: toMillis(expiresAt) })),
      advisories: advisories.data.map((a) => ({ id: a.id, title: a.title, body: a.body, bodyFil: a.bodyFil, severity: a.severity, areas: a.areas, simulated: a.simulated, publishedAtMs: toMillis(a.publishedAt) })),
      centers: centers.data.map((c) => ({
        id: c.id, name: c.name, address: c.address, area: c.area, status: c.status, capacity: c.capacity, occupancy: c.occupancy,
        occupancyVerified: c.occupancyVerified, contact: c.contact, facilities: c.facilities, simulated: c.simulated,
        location: c.location, updatedAtMs: toMillis(c.updatedAt),
      })),
    };
    idbPut("kv", snap, PUBLIC_OFFLINE_SNAPSHOT_KEY).catch(() => undefined);
    if (uid) {
      const privateSnapshot: PrivateOfflineSnapshot = { schemaVersion: 3, uid, contacts: contacts.data };
      idbPut("kv", privateSnapshot, privateOfflineSnapshotKey(uid)).catch(() => undefined);
    }
  }, [alerts.data, advisories.data, centers.data, contacts.data, platform.emergencyHotlines, alerts.fromCache, advisories.fromCache, centers.fromCache, alerts.loading, advisories.loading, centers.loading, geographic.scope, geographic.province?.name, geographic.municipality?.name, geographic.barangay?.name, uid]);
}

export function useStoredSnapshot() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid ?? null;
  const [snap, setSnap] = useState<OfflineSnapshot | undefined>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadOfflineSnapshot(uid).then((s) => {
      setSnap(s);
      setLoaded(true);
    });
  }, [uid]);
  return {
    snap,
    loaded,
    ageMs: snap ? Math.max(0, Date.now() - snap.savedAt) : null,
    catalogVersionChanged: !!snap && snap.catalogVersion !== GEOGRAPHIC_CATALOG_VERSION,
  };
}
