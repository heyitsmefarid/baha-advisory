import { FieldValue, Timestamp, type Query } from "firebase-admin/firestore";
import { getDb } from "./firebaseAdmin";
import {
  childrenOf,
  getUnit,
  legacyAreaToMunicipality,
  MINDORO_REGION_PSGC,
  normalizeScope,
  type GeographicScope,
} from "../../shared/geography";
import { toMillis } from "../../shared/time";
import type { GeographicCounts, GeographicOverview, MunicipalityOverview } from "../../shared/geography/overview";

const EMPTY_COUNTS = (): GeographicCounts => ({ floodZones: 0, roadConditions: 0, verifiedReports: 0, evacuationCenters: 0, activeAlerts: 0 });

export function geographicSummaryKey(scope: GeographicScope): string {
  if (scope.barangayPsgcCode) return `barangay_${scope.barangayPsgcCode}`;
  if (scope.municipalityPsgcCode) return `municipality_${scope.municipalityPsgcCode}`;
  if (scope.provincePsgcCode) return `province_${scope.provincePsgcCode}`;
  return "island";
}

function scopedQuery(collectionName: string, scope: GeographicScope): Query {
  let query: Query = getDb().collection(collectionName);
  if (scope.barangayPsgcCode) query = query.where("barangayPsgcCode", "==", scope.barangayPsgcCode);
  else if (scope.municipalityPsgcCode) query = query.where("municipalityPsgcCode", "==", scope.municipalityPsgcCode);
  else if (scope.provincePsgcCode) query = query.where("provincePsgcCode", "==", scope.provincePsgcCode);
  return query.limit(2000);
}

function municipalityFor(data: Record<string, unknown>): string | null {
  if (typeof data.municipalityPsgcCode === "string") return data.municipalityPsgcCode;
  return legacyAreaToMunicipality(typeof data.area === "string" ? data.area : null)?.psgcCode ?? null;
}

export async function computeGeographicOverview(inputScope: GeographicScope): Promise<GeographicOverview> {
  const scope = normalizeScope(inputScope);
  const specs = [
    { key: "floodZones" as const, query: scopedQuery("floodZones", scope).where("status", "==", "active"), time: "updatedAt" },
    { key: "roadConditions" as const, query: scopedQuery("road_conditions", scope).where("active", "==", true), time: "updatedAt" },
    { key: "verifiedReports" as const, query: scopedQuery("community_reports", scope).where("status", "==", "verified"), time: "verifiedAt" },
    { key: "evacuationCenters" as const, query: scopedQuery("evacuation_centers", scope).where("verified", "==", true), time: "updatedAt" },
    { key: "activeAlerts" as const, query: scopedQuery("alerts", scope).where("active", "==", true), time: "createdAt" },
  ];
  const snapshots = await Promise.all(specs.map((spec) => spec.query.get()));
  const municipalityCodes = scope.municipalityPsgcCode
    ? [scope.municipalityPsgcCode]
    : scope.provincePsgcCode
      ? childrenOf(scope.provincePsgcCode).filter((unit) => unit.level === "city" || unit.level === "municipality").map((unit) => unit.psgcCode)
      : childrenOf(MINDORO_REGION_PSGC, "province").flatMap((province) => childrenOf(province.psgcCode).filter((unit) => unit.level === "city" || unit.level === "municipality").map((unit) => unit.psgcCode));
  const municipalityRows = new Map<string, MunicipalityOverview>();
  for (const code of municipalityCodes) {
    const unit = getUnit(code)!;
    municipalityRows.set(code, {
      psgcCode: code,
      name: unit.name,
      provincePsgcCode: unit.provincePsgcCode!,
      freshestAt: null,
      verifiedSources: 0,
      verifiedFloodZones: 0,
      simulatedFloodZones: 0,
      verifiedCounts: EMPTY_COUNTS(),
      simulatedCounts: EMPTY_COUNTS(),
      ...EMPTY_COUNTS(),
    });
  }

  const counts = EMPTY_COUNTS();
  let sourceMaxUpdatedAt: number | null = null;
  snapshots.forEach((snapshot, index) => {
    const spec = specs[index];
    counts[spec.key] = snapshot.size;
    for (const document of snapshot.docs) {
      const data = document.data();
      const code = municipalityFor(data);
      const row = code ? municipalityRows.get(code) : null;
      if (row) {
        row[spec.key] += 1;
        if (document.get("simulated") === true) {
          row.simulatedCounts![spec.key] += 1;
          if (spec.key === "floodZones") row.simulatedFloodZones = (row.simulatedFloodZones ?? 0) + 1;
        } else {
          row.verifiedCounts![spec.key] += 1;
          row.verifiedSources = (row.verifiedSources ?? 0) + 1;
          if (spec.key === "floodZones") row.verifiedFloodZones = (row.verifiedFloodZones ?? 0) + 1;
        }
      }
      const at = toMillis(data[spec.time]);
      if (at != null) {
        sourceMaxUpdatedAt = Math.max(sourceMaxUpdatedAt ?? 0, at);
        if (row) row.freshestAt = Math.max(row.freshestAt ?? 0, at);
      }
    }
  });
  return {
    scope,
    scopeKey: geographicSummaryKey(scope),
    generatedAt: Date.now(),
    sourceMaxUpdatedAt,
    counts,
    municipalities: [...municipalityRows.values()],
  };
}

export async function getGeographicOverview(scope: GeographicScope, force = false): Promise<GeographicOverview> {
  const ref = getDb().doc(`geographic_summaries/${geographicSummaryKey(scope)}`);
  if (!force) {
    const cached = await ref.get();
    const expiresAt = toMillis(cached.get("expiresAt"));
    if (cached.exists && expiresAt != null && expiresAt > Date.now()) return cached.get("payload") as GeographicOverview;
  }
  const payload = await computeGeographicOverview(scope);
  await ref.set({
    payload,
    generatedAt: FieldValue.serverTimestamp(),
    sourceMaxUpdatedAt: payload.sourceMaxUpdatedAt ? Timestamp.fromMillis(payload.sourceMaxUpdatedAt) : null,
    expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60_000),
  });
  return payload;
}

export async function invalidateGeographicSummary(reference: {
  provincePsgcCode: string;
  municipalityPsgcCode: string;
  barangayPsgcCode: string | null;
}): Promise<void> {
  const ids = [
    "island",
    `province_${reference.provincePsgcCode}`,
    `municipality_${reference.municipalityPsgcCode}`,
    ...(reference.barangayPsgcCode ? [`barangay_${reference.barangayPsgcCode}`] : []),
  ];
  const batch = getDb().batch();
  for (const id of ids) batch.delete(getDb().doc(`geographic_summaries/${id}`));
  await batch.commit();
}
