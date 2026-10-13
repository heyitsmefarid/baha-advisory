import { useMemo } from "react";
import { where } from "firebase/firestore";
import { useActiveFloodZones } from "./useFloodZones";
import { hazardsFromData, hazardSignature } from "../../shared/routing";
import { tuplesFromFirestore } from "../../shared/geoFirestore";
import type { RoadCondition } from "../../shared/types";
import { useScopedPublicData } from "./useScopedPublicData";

const ACTIVE_ROAD_CONSTRAINTS = [where("active", "==", true)];

export function useActiveRoadConditions() {
  return useScopedPublicData<RoadCondition>({
    collectionName: "road_conditions",
    constraints: ACTIVE_ROAD_CONSTRAINTS,
    hardLimit: 300,
    mapDoc: (id, data) => ({ id, ...(data as Omit<RoadCondition, "id">) }),
  });
}

/**
 * Live, DRRM-verified hazards (active flood zones + road conditions) with
 * a signature that changes whenever anything relevant to routing changes
 * — the navigator watches it to trigger automatic recalculation.
 */
export function useOfficialHazards() {
  const zones = useActiveFloodZones();
  const roads = useActiveRoadConditions();
  const hazards = useMemo(() => hazardsFromData(zones.data, roads.data), [zones.data, roads.data]);
  const signature = useMemo(() => hazardSignature(hazards), [hazards]);
  return {
    zones: zones.data,
    roads: roads.data,
    hazards,
    signature,
    loading: zones.loading || roads.loading,
    /** True while either list is served from the device cache, not the server. */
    fromCache: zones.fromCache || roads.fromCache,
    error: zones.error || roads.error,
    displayState: zones.displayState === "stale_previous_scope" || roads.displayState === "stale_previous_scope"
      ? "stale_previous_scope" as const
      : zones.displayState,
  };
}

/** Road-condition path as [lat,lng] tuples for Leaflet. */
export function roadPath(r: RoadCondition): [number, number][] {
  return tuplesFromFirestore(r.path);
}
