import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useMyOrg } from "./useOrg";
import { useFirestoreCollection } from "./useFirestoreCollection";
import type { RouteDisruption, RouteHistoryEntry, SavedRoute } from "../../shared/types";

/** Fleet data is only subscribed when the org is entitled (rules would deny otherwise). */
function useFleetEnabled(): string | null {
  const { orgId } = useAuth();
  const { entitled } = useMyOrg();
  return orgId && entitled("fleetMonitoring") ? orgId : null;
}

export function useSavedRoutes() {
  const orgId = useFleetEnabled();
  return useFirestoreCollection<SavedRoute>(
    () => (orgId ? query(collection(db, "organizations", orgId, "saved_routes"), orderBy("createdAt", "desc")) : null),
    (id, d) => ({ id, ...(d as Omit<SavedRoute, "id">) }),
    [orgId]
  );
}

export function useDisruptions(active: boolean) {
  const orgId = useFleetEnabled();
  return useFirestoreCollection<RouteDisruption>(
    () => (orgId ? query(collection(db, "organizations", orgId, "route_disruptions"), where("active", "==", active), orderBy("detectedAt", "desc"), limit(100)) : null),
    (id, d) => ({ id, ...(d as Omit<RouteDisruption, "id">) }),
    [orgId, active]
  );
}

export function useRouteHistory(max = 300) {
  const orgId = useFleetEnabled();
  return useFirestoreCollection<RouteHistoryEntry>(
    () => (orgId ? query(collection(db, "organizations", orgId, "route_history"), orderBy("at", "desc"), limit(max)) : null),
    (id, d) => ({ id, ...(d as Omit<RouteHistoryEntry, "id">) }),
    [orgId, max]
  );
}
