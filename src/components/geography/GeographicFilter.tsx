import React from "react";
import { childrenOf, MINDORO_REGION_PSGC } from "../../../shared/geography";
import { useGeographicScope } from "../../contexts/GeographicScopeContext";
import CoverageStatus from "./CoverageStatus";

export default function GeographicFilter({ className = "" }: { className?: string }) {
  const {
    scope,
    boundaryStatus,
    setProvince,
    setMunicipality,
    setBarangay,
  } = useGeographicScope();
  const provinces = childrenOf(MINDORO_REGION_PSGC, "province");
  const municipalities = scope.provincePsgcCode
    ? childrenOf(scope.provincePsgcCode).filter((unit) => unit.level === "city" || unit.level === "municipality")
    : [];
  const barangays = scope.municipalityPsgcCode
    ? childrenOf(scope.municipalityPsgcCode, "barangay")
    : [];

  return (
    <section className={`geographic-filter ${className}`.trim()} aria-label="Map location">
      <div className="geographic-filter__heading">
        <strong>Mindoro island navigator</strong>
        <CoverageStatus status={boundaryStatus} />
      </div>
      <div className="geographic-filter__fields">
        <label>
          Province
          <select
            aria-label="Province"
            value={scope.provincePsgcCode ?? ""}
            onChange={(event) => setProvince(event.target.value || null)}
          >
            <option value="">Entire Mindoro Island</option>
            {provinces.map((unit) => <option key={unit.psgcCode} value={unit.psgcCode}>{unit.name}</option>)}
          </select>
        </label>
        <label>
          Municipality or city
          <select
            aria-label="Municipality or city"
            value={scope.municipalityPsgcCode ?? ""}
            disabled={!scope.provincePsgcCode}
            onChange={(event) => setMunicipality(event.target.value || null)}
          >
            <option value="">All LGUs</option>
            {municipalities.map((unit) => <option key={unit.psgcCode} value={unit.psgcCode}>{unit.name}</option>)}
          </select>
        </label>
        <label>
          Barangay
          <select
            aria-label="Barangay"
            value={scope.barangayPsgcCode ?? ""}
            disabled={!scope.municipalityPsgcCode}
            onChange={(event) => setBarangay(event.target.value || null)}
          >
            <option value="">All barangays</option>
            {barangays.map((unit) => <option key={unit.psgcCode} value={unit.psgcCode}>{unit.name}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

