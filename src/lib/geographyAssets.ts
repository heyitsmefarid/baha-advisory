import { MINDORO_BOUNDARY_MANIFEST } from "../../shared/geography/manifest.generated";
import type { BoundaryFeatureCollection } from "../../shared/geography";
import type { BoundaryStatus, GeographicScope } from "../../shared/geography";

export interface BoundaryManifest {
  version: string;
  catalogVersion: string;
  generatedAt: string;
  sourceAgency: string;
  sourceUrl: string;
  licenseNote: string;
  boundaryStatus: Record<"province" | "municipality" | "barangay", BoundaryStatus>;
  assets: {
    province: string | null;
    municipalities: Record<string, string | null>;
    barangays: Record<string, string | null>;
  };
}

export const BOUNDARY_MANIFEST: BoundaryManifest = MINDORO_BOUNDARY_MANIFEST;

export class BoundaryUnavailableError extends Error {
  readonly level: "province" | "municipality" | "barangay";

  constructor(level: "province" | "municipality" | "barangay") {
    super(`Verified ${level} boundary geometry is unavailable.`);
    this.name = "BoundaryUnavailableError";
    this.level = level;
  }
}

const fulfilledAssets = new Map<string, BoundaryFeatureCollection>();

function assetForScope(scope: GeographicScope): {
  level: "province" | "municipality" | "barangay";
  asset: string | null;
} {
  if (scope.barangayPsgcCode && scope.municipalityPsgcCode) {
    return { level: "barangay", asset: BOUNDARY_MANIFEST.assets.barangays[scope.municipalityPsgcCode] ?? null };
  }
  if (scope.municipalityPsgcCode && scope.provincePsgcCode) {
    return { level: "municipality", asset: BOUNDARY_MANIFEST.assets.municipalities[scope.provincePsgcCode] ?? null };
  }
  return { level: "province", asset: BOUNDARY_MANIFEST.assets.province };
}

export function boundaryStatusForScope(scope: GeographicScope): BoundaryStatus {
  return BOUNDARY_MANIFEST.boundaryStatus[assetForScope(scope).level];
}

export async function loadBoundaryAsset(
  scope: GeographicScope,
  signal?: AbortSignal,
): Promise<BoundaryFeatureCollection> {
  const { level, asset } = assetForScope(scope);
  if (!asset) throw new BoundaryUnavailableError(level);
  const cacheKey = `${BOUNDARY_MANIFEST.version}:${asset}`;
  const cached = fulfilledAssets.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(asset, { signal });
  if (!response.ok) throw new Error(`Boundary asset request failed (${response.status}).`);
  const data = (await response.json()) as BoundaryFeatureCollection;
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("Boundary asset is not a GeoJSON FeatureCollection.");
  }
  fulfilledAssets.set(cacheKey, data);
  return data;
}
