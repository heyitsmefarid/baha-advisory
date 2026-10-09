export type GeographicLevel = "region" | "province" | "city" | "municipality" | "barangay";

export type BoundaryStatus = "authoritative" | "approximate_official" | "unavailable";

export interface GeographicUnit {
  psgcCode: string;
  name: string;
  level: GeographicLevel;
  parentPsgcCode: string | null;
  regionPsgcCode: string;
  provincePsgcCode: string | null;
  municipalityPsgcCode: string | null;
  center: [number, number];
  boundingBox: [[number, number], [number, number]];
  boundaryStatus: BoundaryStatus;
  boundaryAsset: string | null;
  sourceVersion: "Q2_2026";
}

export interface GeographicScope {
  provincePsgcCode: string | null;
  municipalityPsgcCode: string | null;
  barangayPsgcCode: string | null;
}

export interface LocationAssignment {
  method: "boundary" | "manual" | "migrated";
  confidence: "high" | "medium" | "review_required";
  sourceVersion: string;
  assignedAt: number;
  assignedBy: string;
}

export interface GeographicReference {
  regionPsgcCode: string;
  provincePsgcCode: string;
  municipalityPsgcCode: string;
  barangayPsgcCode: string | null;
  locationAssignment: LocationAssignment;
}

