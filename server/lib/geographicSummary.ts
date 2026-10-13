import { FieldValue, Timestamp, type Query } from "firebase-admin/firestore";
import { getDb } from "./firebaseAdmin";
import {
  childrenOf,
  getUnit,
  MINDORO_REGION_PSGC,
  normalizeScope,
  type GeographicScope,
} from "../../shared/geography";
import { toMillis } from "../../shared/time";
import type { GeographicCounts, GeographicOverview, MunicipalityOverview } from "../../shared/geography/overview";

const EMPTY_COUNTS = (): GeographicCounts => ({ floodZones: 0, roadConditions: 0, verifiedReports: 0, evacuationCenters: 0, activeAlerts: 0 });
const METRICS = [
  { key: "floodZones" as const, collection: "floodZones", field: "status", value: "active", time: "updatedAt" },
  { key: "roadConditions" as const, collection: "road_conditions", field: "active", value: true, time: "updatedAt" },
  { key: "verifiedReports" as const, collection: "community_reports", field: "status", value: "verified", time: "verifiedAt" },
  { key: "evacuationCenters" as const, collection: "evacuation_centers", field: "verified", value: true, time: "updatedAt" },
  { key: "activeAlerts" as const, collection: "alerts", field: "active", value: true, time: "createdAt" },
] as const;

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
  return query;
}

async function measureScope(scope: GeographicScope): Promise<{
  counts: GeographicCounts;
  verifiedCounts: GeographicCounts;
  simulatedCounts: GeographicCounts;
  freshestAt: number | null;
}> {
  const counts = EMPTY_COUNTS();
  const verifiedCounts = EMPTY_COUNTS();
  const simulatedCounts = EMPTY_COUNTS();
  let freshestAt: number | null = null;
  await Promise.all(METRICS.map(async (metric) => {
    const base = scopedQuery(metric.collection, scope).where(metric.field, "==", metric.value);
    const [totalSnapshot, simulatedSnapshot, latestSnapshot] = await Promise.all([
      base.count().get(),
      base.where("simulated", "==", true).count().get(),
      base.orderBy(metric.time, "desc").limit(1).get(),
    ]);
    const total = totalSnapshot.data().count;
    const simulated = simulatedSnapshot.data().count;
    counts[metric.key] = total;
    simulatedCounts[metric.key] = simulated;
    verifiedCounts[metric.key] = Math.max(0, total - simulated);
    const at = latestSnapshot.empty ? null : toMillis(latestSnapshot.docs[0].get(metric.time));
    if (at != null) freshestAt = Math.max(freshestAt ?? 0, at);
  }));
  return { counts, verifiedCounts, simulatedCounts, freshestAt };
}

function municipalityCodes(scope: GeographicScope): string[] {
  if (scope.municipalityPsgcCode) return [scope.municipalityPsgcCode];
  const provinces = scope.provincePsgcCode
    ? [getUnit(scope.provincePsgcCode)].filter(Boolean)
    : childrenOf(MINDORO_REGION_PSGC, "province");
  return provinces.flatMap((province) => childrenOf(province!.psgcCode)
    .filter((unit) => unit.level === "city" || unit.level === "municipality")
    .map((unit) => unit.psgcCode));
}

function sumRows(rows: MunicipalityOverview[], key: "counts" | "verifiedCounts" | "simulatedCounts"): GeographicCounts {
  const total = EMPTY_COUNTS();
  for (const row of rows) {
    const values = key === "counts" ? row : row[key] ?? EMPTY_COUNTS();
    for (const metric of Object.keys(total) as (keyof GeographicCounts)[]) total[metric] += values[metric] ?? 0;
  }
  return total;
}

async function directRow(scope: GeographicScope): Promise<MunicipalityOverview> {
  const code = scope.municipalityPsgcCode!;
  const unit = getUnit(code)!;
  const measured = await measureScope(scope);
  return {
    psgcCode: code,
    name: unit.name,
    provincePsgcCode: unit.provincePsgcCode!,
    freshestAt: measured.freshestAt,
    verifiedSources: Object.values(measured.verifiedCounts).reduce((sum, value) => sum + value, 0),
    verifiedFloodZones: measured.verifiedCounts.floodZones,
    simulatedFloodZones: measured.simulatedCounts.floodZones,
    verifiedCounts: measured.verifiedCounts,
    simulatedCounts: measured.simulatedCounts,
    ...measured.counts,
  };
}

export async function computeGeographicOverview(inputScope: GeographicScope): Promise<GeographicOverview> {
  const scope = normalizeScope(inputScope);
  let rows: MunicipalityOverview[];
  if (scope.municipalityPsgcCode) {
    rows = [await directRow(scope)];
  } else {
    const childScopes = municipalityCodes(scope).map((municipalityPsgcCode) => {
      const unit = getUnit(municipalityPsgcCode)!;
      return { provincePsgcCode: unit.provincePsgcCode, municipalityPsgcCode, barangayPsgcCode: null };
    });
    const overviews = await Promise.all(childScopes.map((child) => getGeographicOverview(child)));
    rows = overviews.flatMap((overview) => overview.municipalities);
  }
  const counts = sumRows(rows, "counts");
  const verifiedCounts = sumRows(rows, "verifiedCounts");
  const simulatedCounts = sumRows(rows, "simulatedCounts");
  const freshest = rows.map((row) => row.freshestAt).filter((value): value is number => value != null);
  return {
    scope,
    scopeKey: geographicSummaryKey(scope),
    generatedAt: Date.now(),
    sourceMaxUpdatedAt: freshest.length ? Math.max(...freshest) : null,
    counts,
    verifiedCounts,
    simulatedCounts,
    municipalities: rows,
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
