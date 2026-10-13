import {
  legacyAreaToMunicipality,
  MINDORO_REGION_PSGC,
  type GeographicReference,
} from "../../shared/geography";

export function geographicReferenceForArea(area: string, assignedBy: string): GeographicReference {
  const municipality = legacyAreaToMunicipality(area);
  if (!municipality?.provincePsgcCode) throw new Error(`Unsupported Mindoro LGU: ${area}`);
  return {
    regionPsgcCode: MINDORO_REGION_PSGC,
    provincePsgcCode: municipality.provincePsgcCode,
    municipalityPsgcCode: municipality.psgcCode,
    barangayPsgcCode: null,
    locationAssignment: {
      method: "manual",
      confidence: "medium",
      sourceVersion: municipality.sourceVersion,
      assignedAt: Date.now(),
      assignedBy,
    },
  };
}
