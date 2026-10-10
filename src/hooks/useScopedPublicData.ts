import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "../firebase";
import { useGeographicScope } from "../contexts/GeographicScopeContext";
import {
  transitionRetainedQueryState,
  type RetainedQueryState,
} from "../lib/retainedQueryState";
import { firestoreErrorMessage } from "../utils/errors";
import type { GeographicScope } from "../../shared/geography";
import { api } from "../lib/api";
import type { GeographicOverview } from "../../server/lib/geographicSummary";

export function geographicScopeKey(scope: GeographicScope): string {
  if (scope.barangayPsgcCode) return `barangay:${scope.barangayPsgcCode}`;
  if (scope.municipalityPsgcCode) return `municipality:${scope.municipalityPsgcCode}`;
  if (scope.provincePsgcCode) return `province:${scope.provincePsgcCode}`;
  return "island";
}

function scopeConstraint(scope: GeographicScope): QueryConstraint | null {
  if (scope.barangayPsgcCode) return where("barangayPsgcCode", "==", scope.barangayPsgcCode);
  if (scope.municipalityPsgcCode) return where("municipalityPsgcCode", "==", scope.municipalityPsgcCode);
  if (scope.provincePsgcCode) return where("provincePsgcCode", "==", scope.provincePsgcCode);
  return null;
}

export interface ScopedPublicDataResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  fromCache: boolean;
  displayState: RetainedQueryState<T>["displayState"];
  requestedScope: GeographicScope;
  displayScope: GeographicScope;
}

export function useScopedPublicData<T>(options: {
  collectionName: string;
  constraints: QueryConstraint[];
  hardLimit: number;
  mapDoc: (id: string, data: unknown) => T;
  islandEnabled?: boolean;
}): ScopedPublicDataResult<T> {
  const { scope } = useGeographicScope();
  const scopeKey = geographicScopeKey(scope);
  const confirmedScope = useRef<GeographicScope>(scope);
  const [state, dispatch] = useReducer(
    transitionRetainedQueryState<T>,
    undefined,
    () => transitionRetainedQueryState<T>(undefined, { type: "query_started", scopeKey }),
  );
  const constraints = useMemo(() => options.constraints, [options.constraints]);

  useEffect(() => {
    dispatch({ type: "query_started", scopeKey });
    if (!scope.provincePsgcCode && options.islandEnabled !== true) {
      confirmedScope.current = scope;
      dispatch({ type: "query_succeeded", scopeKey, rows: [], fromCache: false });
      return;
    }
    const geographic = scopeConstraint(scope);
    const q = query(
      collection(db, options.collectionName),
      ...constraints,
      ...(geographic ? [geographic] : []),
      limit(options.hardLimit),
    );
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        confirmedScope.current = scope;
        dispatch({
          type: "query_succeeded",
          scopeKey,
          rows: snapshot.docs.map((document) => options.mapDoc(document.id, document.data())),
          fromCache: snapshot.metadata.fromCache,
        });
      },
      (error) => dispatch({ type: "query_failed", scopeKey, error: firestoreErrorMessage(error) }),
    );
  // Callers memoize constraints and mappers; the scope key captures all location changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.collectionName, options.hardLimit, constraints, scopeKey]);

  return {
    data: state.rows,
    loading: state.loading,
    error: state.error,
    fromCache: state.fromCache,
    displayState: state.displayState,
    requestedScope: scope,
    displayScope: confirmedScope.current,
  };
}

export function useGeographicOverview() {
  const { scope } = useGeographicScope();
  const key = geographicScopeKey(scope);
  const [data, setData] = useState<GeographicOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (scope.provincePsgcCode) params.set("province", scope.provincePsgcCode);
    if (scope.municipalityPsgcCode) params.set("municipality", scope.municipalityPsgcCode);
    if (scope.barangayPsgcCode) params.set("barangay", scope.barangayPsgcCode);
    setLoading(true);
    api<GeographicOverview>(`/geography/overview?${params}`).then(
      (result) => { if (active) { setData(result); setError(null); setLoading(false); } },
      (reason) => { if (active) { setError(reason instanceof Error ? reason.message : "Unable to load overview."); setLoading(false); } },
    );
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading, error };
}
