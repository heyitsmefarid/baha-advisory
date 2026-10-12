import { useEffect, useState, type DependencyList } from "react";
import { collection, getDocs, limit, onSnapshot, query, where, type QueryConstraint } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import type { JurisdictionGrant } from "../../shared/geography";
import { firestoreErrorMessage } from "../utils/errors";

/** Live private records queried once per active jurisdiction grant and de-duplicated. */
export function useJurisdictionCollection<T>(
  collectionName: string,
  constraints: () => QueryConstraint[],
  mapDoc: (id: string, data: unknown) => T,
  deps: DependencyList,
  hardLimit = 200,
) {
  const { currentUser, appRole, role, orgId, assignedArea } = useAuth();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) { setData([]); setLoading(false); return; }
    let active = true;
    const unsubscribes: Array<() => void> = [];
    const rowsByQuery = new Map<string, Map<string, T>>();
    const publish = () => {
      const merged = new Map<string, T>();
      for (const rows of rowsByQuery.values()) for (const [id, row] of rows) merged.set(id, row);
      if (active) setData([...merged.values()]);
    };
    const subscribe = (key: string, geographic: QueryConstraint[]) => {
      const q = query(collection(db, collectionName), ...constraints(), ...geographic, limit(hardLimit));
      unsubscribes.push(onSnapshot(q, (snapshot) => {
        rowsByQuery.set(key, new Map(snapshot.docs.map((document) => [document.id, mapDoc(document.id, document.data())])));
        publish();
        if (active) { setLoading(false); setError(null); }
      }, (reason) => {
        if (active) { setLoading(false); setError(firestoreErrorMessage(reason)); }
      }));
    };
    (async () => {
      try {
        if (appRole === "super_admin") { subscribe("island", []); return; }
        if (orgId) {
          const grantSnapshot = await getDocs(query(collection(db, `organizations/${orgId}/jurisdiction_grants`), where("active", "==", true)));
          const grants = grantSnapshot.docs.map((document) => document.data() as JurisdictionGrant);
          if (!grants.length) throw new Error("No active jurisdiction grant is assigned to this organization.");
          for (const grant of grants) {
            const field = grant.level === "province" ? "provincePsgcCode" : grant.level === "municipality" ? "municipalityPsgcCode" : "barangayPsgcCode";
            subscribe(`${grant.level}:${grant.psgcCode}`, [where(field, "==", grant.psgcCode)]);
          }
          return;
        }
        if ((role === "admin" || role === "drrm_editor") && assignedArea) {
          subscribe(`legacy:${assignedArea}`, [where("area", "==", assignedArea)]);
          return;
        }
        throw new Error("No authorized jurisdiction is available.");
      } catch (reason) {
        if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : "Unable to load jurisdiction data."); }
      }
    })();
    return () => { active = false; unsubscribes.forEach((unsubscribe) => unsubscribe()); };
  // Callers provide explicit dependencies for their constraints and mapper.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, currentUser?.uid, appRole, role, orgId, assignedArea, hardLimit, ...deps]);

  return { data, loading, error };
}
