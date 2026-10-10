import {
  getUnit,
  isValidHierarchy,
  legacyAreaToMunicipality,
  MINDORO_REGION_PSGC,
  resolvePoint,
  type GeographicReference,
} from "../../shared/geography";
import type { LatLng } from "../../shared/types";
import { ValidationError } from "../../shared/validation";

export const GEOGRAPHY_MIGRATION_VERSION = "mindoro-psgc-q2-2026-v1";

export type GeographicReferenceInput = Pick<
  GeographicReference,
  "regionPsgcCode" | "provincePsgcCode" | "municipalityPsgcCode" | "barangayPsgcCode" | "locationAssignment"
>;

export function validateGeographicReference(reference: GeographicReferenceInput): GeographicReference {
  if (!reference || !isValidHierarchy(reference)) {
    throw new ValidationError(["Geographic PSGC hierarchy is invalid or outside supported Mindoro LGUs."]);
  }
  const assignment = reference.locationAssignment;
  if (
    !assignment ||
    !["boundary", "manual", "migrated"].includes(assignment.method) ||
    !["high", "medium", "review_required"].includes(assignment.confidence) ||
    typeof assignment.sourceVersion !== "string" ||
    typeof assignment.assignedAt !== "number" ||
    typeof assignment.assignedBy !== "string"
  ) {
    throw new ValidationError(["locationAssignment is invalid."]);
  }
  return { ...reference };
}

export function geographicReferenceFrom(value: Record<string, unknown>): GeographicReference | null {
  const keys = ["regionPsgcCode", "provincePsgcCode", "municipalityPsgcCode"] as const;
  if (keys.some((key) => typeof value[key] !== "string")) return null;
  if (value.barangayPsgcCode !== null && typeof value.barangayPsgcCode !== "string") return null;
  if (!value.locationAssignment || typeof value.locationAssignment !== "object") return null;
  return validateGeographicReference(value as unknown as GeographicReferenceInput);
}

/** Resolve from verified boundaries, or validate an explicit staff/citizen selection. */
export function assignGeography(
  location: LatLng,
  supplied?: GeographicReferenceInput | null,
): GeographicReference | null {
  if (supplied) return validateGeographicReference(supplied);
  return resolvePoint([location.lat, location.lng]);
}

export type MigrationAction = "migrate" | "unchanged" | "review_required";

export interface MigrationResult {
  collection: string;
  id: string;
  action: MigrationAction;
  patch: Record<string, unknown>;
  reason?: string;
}

/**
 * Deterministic, additive migration. Legacy display fields are deliberately
 * retained; unresolved names are reported for human review and never guessed.
 */
export function migrateRecord(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  assignedAt = Date.now(),
): MigrationResult {
  try {
    const existing = geographicReferenceFrom(data);
    if (existing && data.geographyMigrationVersion === GEOGRAPHY_MIGRATION_VERSION) {
      return { collection, id, action: "unchanged", patch: {} };
    }
    if (existing) {
      return {
        collection,
        id,
        action: "migrate",
        patch: { geographyMigrationVersion: GEOGRAPHY_MIGRATION_VERSION },
      };
    }
  } catch {
    return { collection, id, action: "review_required", patch: {}, reason: "Existing PSGC fields have invalid ancestry." };
  }

  const location = data.location as LatLng | undefined;
  const resolved = location && typeof location.lat === "number" && typeof location.lng === "number"
    ? resolvePoint([location.lat, location.lng])
    : null;
  if (resolved) {
    return {
      collection,
      id,
      action: "migrate",
      patch: { ...resolved, geographyMigrationVersion: GEOGRAPHY_MIGRATION_VERSION },
    };
  }

  const legacyArea = typeof data.area === "string"
    ? data.area
    : Array.isArray(data.areas) && data.areas.length === 1 && typeof data.areas[0] === "string"
      ? data.areas[0]
      : null;
  const municipality = legacyAreaToMunicipality(legacyArea);
  if (!municipality?.provincePsgcCode) {
    return {
      collection,
      id,
      action: "review_required",
      patch: {},
      reason: legacyArea ? `Unknown or ambiguous legacy area: ${legacyArea}` : "No resolvable location or legacy area.",
    };
  }

  const reference: GeographicReference = {
    regionPsgcCode: MINDORO_REGION_PSGC,
    provincePsgcCode: municipality.provincePsgcCode,
    municipalityPsgcCode: municipality.psgcCode,
    barangayPsgcCode: null,
    locationAssignment: {
      method: "migrated",
      confidence: "medium",
      sourceVersion: municipality.sourceVersion,
      assignedAt,
      assignedBy: "migration",
    },
  };
  validateGeographicReference(reference);
  return {
    collection,
    id,
    action: "migrate",
    patch: { ...reference, geographyMigrationVersion: GEOGRAPHY_MIGRATION_VERSION },
  };
}

export function displayArea(reference: GeographicReference): string {
  return getUnit(reference.municipalityPsgcCode)?.name ?? reference.municipalityPsgcCode;
}

export function referenceForMunicipality(
  municipalityPsgcCode: string,
  assignedBy: string,
  method: "manual" | "migrated" = "manual",
): GeographicReference {
  const municipality = getUnit(municipalityPsgcCode);
  if (!municipality?.provincePsgcCode || !["city", "municipality"].includes(municipality.level)) {
    throw new ValidationError(["A supported Mindoro municipality or city is required."]);
  }
  return validateGeographicReference({
    regionPsgcCode: MINDORO_REGION_PSGC,
    provincePsgcCode: municipality.provincePsgcCode,
    municipalityPsgcCode,
    barangayPsgcCode: null,
    locationAssignment: {
      method,
      confidence: "medium",
      sourceVersion: municipality.sourceVersion,
      assignedAt: Date.now(),
      assignedBy,
    },
  });
}
