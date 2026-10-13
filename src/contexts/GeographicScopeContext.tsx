import React, { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  boundsForScope,
  getUnit,
  normalizeScope,
  type BoundaryStatus,
  type GeographicScope,
  type GeographicUnit,
} from "../../shared/geography";
import { boundaryStatusForScope } from "../lib/geographyAssets";

const EMPTY_SCOPE: GeographicScope = {
  provincePsgcCode: null,
  municipalityPsgcCode: null,
  barangayPsgcCode: null,
};

export function parseGeographicScope(search: URLSearchParams): GeographicScope {
  return normalizeScope({
    provincePsgcCode: search.get("province"),
    municipalityPsgcCode: search.get("municipality"),
    barangayPsgcCode: search.get("barangay"),
  });
}

export function scopeToSearchParams(
  scope: GeographicScope,
  current = new URLSearchParams(),
): URLSearchParams {
  const normalized = normalizeScope(scope);
  const next = new URLSearchParams(current);
  for (const key of ["province", "municipality", "barangay"]) next.delete(key);
  if (normalized.provincePsgcCode) next.set("province", normalized.provincePsgcCode);
  if (normalized.municipalityPsgcCode) next.set("municipality", normalized.municipalityPsgcCode);
  if (normalized.barangayPsgcCode) next.set("barangay", normalized.barangayPsgcCode);
  return next;
}

interface GeographicScopeValue {
  scope: GeographicScope;
  province: GeographicUnit | null;
  municipality: GeographicUnit | null;
  barangay: GeographicUnit | null;
  fitBounds: [[number, number], [number, number]];
  boundaryStatus: BoundaryStatus;
  setProvince: (psgcCode: string | null) => void;
  setMunicipality: (psgcCode: string | null) => void;
  setBarangay: (psgcCode: string | null) => void;
  clearScope: () => void;
}

const GeographicScopeContext = createContext<GeographicScopeValue | null>(null);

export function GeographicScopeProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useSearchParams();
  const scope = useMemo(() => parseGeographicScope(search), [search]);
  const update = useCallback(
    (next: GeographicScope) => setSearch(scopeToSearchParams(next, search)),
    [search, setSearch],
  );

  const value = useMemo<GeographicScopeValue>(
    () => ({
      scope,
      province: getUnit(scope.provincePsgcCode) ?? null,
      municipality: getUnit(scope.municipalityPsgcCode) ?? null,
      barangay: getUnit(scope.barangayPsgcCode) ?? null,
      fitBounds: boundsForScope(scope),
      boundaryStatus: boundaryStatusForScope(scope),
      setProvince: (provincePsgcCode) =>
        update({ provincePsgcCode, municipalityPsgcCode: null, barangayPsgcCode: null }),
      setMunicipality: (municipalityPsgcCode) =>
        update({ ...scope, municipalityPsgcCode, barangayPsgcCode: null }),
      setBarangay: (barangayPsgcCode) => update({ ...scope, barangayPsgcCode }),
      clearScope: () => update(EMPTY_SCOPE),
    }),
    [scope, update],
  );

  return <GeographicScopeContext.Provider value={value}>{children}</GeographicScopeContext.Provider>;
}

export function useGeographicScope(): GeographicScopeValue {
  const value = useContext(GeographicScopeContext);
  if (!value) throw new Error("useGeographicScope must be used inside GeographicScopeProvider.");
  return value;
}
