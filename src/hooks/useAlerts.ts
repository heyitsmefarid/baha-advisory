import { useMemo } from "react";
import { orderBy, where } from "firebase/firestore";
import { useScopedPublicData } from "./useScopedPublicData";
import { useGeographicScope } from "../contexts/GeographicScopeContext";
import { toMillis } from "../../shared/time";
import type { PublicAlert } from "../../shared/types";

const SCOPED_ALERT_CONSTRAINTS = [where("active", "==", true), orderBy("createdAt", "desc")];
const ISLAND_ALERT_CONSTRAINTS = [where("active", "==", true), where("severity", "in", ["high", "critical"]), orderBy("createdAt", "desc")];

/** Active, unexpired public alerts (always free, no login). */
export function useActiveAlerts() {
  const { scope } = useGeographicScope();
  const constraints = scope.provincePsgcCode
    ? SCOPED_ALERT_CONSTRAINTS
    : ISLAND_ALERT_CONSTRAINTS;
  const res = useScopedPublicData<PublicAlert>({
    collectionName: "alerts",
    constraints,
    hardLimit: 30,
    islandEnabled: true,
    mapDoc: (id, d) => ({ id, ...(d as Omit<PublicAlert, "id">) }),
  });
  const now = Date.now();
  const alerts = useMemo(() => res.data.filter((a) => (toMillis(a.expiresAt) ?? 0) > now), [res.data, now]);
  return { ...res, data: alerts };
}
