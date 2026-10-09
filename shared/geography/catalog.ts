import { MINDORO_CATALOG } from "./catalog.generated";
import type { GeographicLevel, GeographicReference, GeographicScope, GeographicUnit } from "./types";

export const MINDORO_REGION_PSGC = "1700000000";
export const OCCIDENTAL_MINDORO_PSGC = "1705100000";
export const ORIENTAL_MINDORO_PSGC = "1705200000";
export const CALAPAN_PSGC = "1705205000";

const byCode = new Map(MINDORO_CATALOG.map((unit) => [unit.psgcCode, unit]));
const byParent = new Map<string, GeographicUnit[]>();

for (const unit of MINDORO_CATALOG) {
  if (!unit.parentPsgcCode) continue;
  const siblings = byParent.get(unit.parentPsgcCode) ?? [];
  siblings.push(unit);
  byParent.set(unit.parentPsgcCode, siblings);
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\bcity of\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/\bmunicipality of\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const municipalitiesByLegacyName = new Map<string, GeographicUnit>();
for (const unit of MINDORO_CATALOG) {
  if (unit.level !== "city" && unit.level !== "municipality") continue;
  municipalitiesByLegacyName.set(normalizedName(unit.name), unit);
  municipalitiesByLegacyName.set(normalizedName(`${unit.name} City`), unit);
}

export function getUnit(psgcCode: string | null | undefined): GeographicUnit | undefined {
  return psgcCode ? byCode.get(psgcCode) : undefined;
}

export function childrenOf(parentPsgcCode: string, level?: GeographicLevel): GeographicUnit[] {
  const children = byParent.get(parentPsgcCode) ?? [];
  return level ? children.filter((unit) => unit.level === level) : [...children];
}

export function normalizeScope(scope: GeographicScope): GeographicScope {
  const province = getUnit(scope.provincePsgcCode);
  if (province?.level !== "province") {
    return { provincePsgcCode: null, municipalityPsgcCode: null, barangayPsgcCode: null };
  }

  const municipality = getUnit(scope.municipalityPsgcCode);
  if (
    !municipality ||
    !["city", "municipality"].includes(municipality.level) ||
    municipality.provincePsgcCode !== province.psgcCode
  ) {
    return {
      provincePsgcCode: province.psgcCode,
      municipalityPsgcCode: null,
      barangayPsgcCode: null,
    };
  }

  const barangay = getUnit(scope.barangayPsgcCode);
  if (barangay?.level !== "barangay" || barangay.municipalityPsgcCode !== municipality.psgcCode) {
    return {
      provincePsgcCode: province.psgcCode,
      municipalityPsgcCode: municipality.psgcCode,
      barangayPsgcCode: null,
    };
  }

  return {
    provincePsgcCode: province.psgcCode,
    municipalityPsgcCode: municipality.psgcCode,
    barangayPsgcCode: barangay.psgcCode,
  };
}

export function isValidHierarchy(
  reference: Pick<
    GeographicReference,
    "regionPsgcCode" | "provincePsgcCode" | "municipalityPsgcCode" | "barangayPsgcCode"
  >,
): boolean {
  if (reference.regionPsgcCode !== MINDORO_REGION_PSGC) return false;

  const province = getUnit(reference.provincePsgcCode);
  const municipality = getUnit(reference.municipalityPsgcCode);
  if (
    province?.level !== "province" ||
    !municipality ||
    !["city", "municipality"].includes(municipality.level) ||
    municipality.regionPsgcCode !== reference.regionPsgcCode ||
    municipality.provincePsgcCode !== province.psgcCode
  ) {
    return false;
  }

  if (reference.barangayPsgcCode === null) return true;
  const barangay = getUnit(reference.barangayPsgcCode);
  return (
    barangay?.level === "barangay" &&
    barangay.regionPsgcCode === reference.regionPsgcCode &&
    barangay.provincePsgcCode === province.psgcCode &&
    barangay.municipalityPsgcCode === municipality.psgcCode
  );
}

export function legacyAreaToMunicipality(area: string | null | undefined): GeographicUnit | null {
  if (!area) return null;
  return municipalitiesByLegacyName.get(normalizedName(area)) ?? null;
}

