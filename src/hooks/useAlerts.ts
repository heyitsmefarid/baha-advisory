import { useMemo } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useFirestoreCollection } from "./useFirestoreCollection";
import { toMillis } from "../../shared/time";
import type { PublicAlert } from "../../shared/types";

/** Active, unexpired public alerts (always free, no login). */
export function useActiveAlerts() {
  const res = useFirestoreCollection<PublicAlert>(
    () => query(collection(db, "alerts"), where("active", "==", true), orderBy("createdAt", "desc"), limit(30)),
    (id, d) => ({ id, ...(d as Omit<PublicAlert, "id">) }),
    []
  );
  const now = Date.now();
  const alerts = useMemo(() => res.data.filter((a) => (toMillis(a.expiresAt) ?? 0) > now), [res.data, now]);
  return { ...res, data: alerts };
}
