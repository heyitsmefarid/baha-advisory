import { getUnit, isValidHierarchy, normalizeScope } from "./catalog";
import type { GeographicReference, GeographicScope } from "./types";
import type { TS } from "../types";

export type GovernmentLevel = "barangay" | "municipality" | "province" | "platform";

export interface JurisdictionScope {
  level: Exclude<GovernmentLevel, "platform">;
  psgcCode: string;
  active?: boolean;
}

export interface JurisdictionGrant extends JurisdictionScope {
  orgId: string;
  active: boolean;
  provincePsgcCode: string;
  municipalityPsgcCode: string | null;
  createdAt: TS;
  createdBy: string;
}

export function isValidJurisdictionScope(scope: JurisdictionScope): boolean {
  const unit = getUnit(scope.psgcCode);
  if (!unit) return false;
  return (
    (scope.level === "province" && unit.level === "province") ||
    (scope.level === "municipality" && (unit.level === "municipality" || unit.level === "city")) ||
    (scope.level === "barangay" && unit.level === "barangay")
  );
}

export function scopeCoversReference(
  scope: JurisdictionScope,
  reference: Pick<GeographicReference, "regionPsgcCode" | "provincePsgcCode" | "municipalityPsgcCode" | "barangayPsgcCode">,
): boolean {
  if (scope.active === false || !isValidJurisdictionScope(scope) || !isValidHierarchy(reference)) return false;
  if (scope.level === "province") return scope.psgcCode === reference.provincePsgcCode;
  if (scope.level === "municipality") return scope.psgcCode === reference.municipalityPsgcCode;
  return scope.psgcCode === reference.barangayPsgcCode;
}

/** Authorization for aggregate/dashboard scopes, including province-only targets. */
export function jurisdictionCoversScope(scope: JurisdictionScope, target: GeographicScope): boolean {
  if (scope.active === false || !isValidJurisdictionScope(scope)) return false;
  const normalized = normalizeScope(target);
  if (
    normalized.provincePsgcCode !== target.provincePsgcCode ||
    normalized.municipalityPsgcCode !== target.municipalityPsgcCode ||
    normalized.barangayPsgcCode !== target.barangayPsgcCode ||
    !normalized.provincePsgcCode
  ) return false;
  if (scope.level === "province") return scope.psgcCode === normalized.provincePsgcCode;
  if (scope.level === "municipality") return scope.psgcCode === normalized.municipalityPsgcCode;
  return scope.psgcCode === normalized.barangayPsgcCode;
}

export function grantForUnit(
  psgcCode: string,
  orgId: string,
  createdBy: string,
  createdAt: TS,
): JurisdictionGrant {
  const unit = getUnit(psgcCode);
  if (!unit || unit.level === "region") throw new Error(`Unsupported jurisdiction PSGC code: ${psgcCode}`);
  const level = unit.level === "province" ? "province" : unit.level === "barangay" ? "barangay" : "municipality";
  return {
    psgcCode,
    level,
    orgId,
    active: true,
    provincePsgcCode: unit.level === "province" ? unit.psgcCode : unit.provincePsgcCode!,
    municipalityPsgcCode: unit.level === "barangay" ? unit.municipalityPsgcCode : level === "municipality" ? unit.psgcCode : null,
    createdAt,
    createdBy,
  };
}
