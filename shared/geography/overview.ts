import { getUnit } from "./catalog";
import type { GeographicScope } from "./types";

export interface GeographicCounts {
  floodZones: number;
  roadConditions: number;
  verifiedReports: number;
  evacuationCenters: number;
  activeAlerts: number;
}

export interface MunicipalityOverview extends GeographicCounts {
  psgcCode: string;
  name: string;
  provincePsgcCode: string;
  freshestAt: number | null;
  verifiedSources?: number;
  sourceUnavailable?: boolean;
  verifiedFloodZones?: number;
  simulatedFloodZones?: number;
  verifiedCounts?: GeographicCounts;
  simulatedCounts?: GeographicCounts;
}

export interface GeographicOverview {
  scope: GeographicScope;
  scopeKey: string;
  generatedAt: number;
  sourceMaxUpdatedAt: number | null;
  counts: GeographicCounts;
  verifiedCounts: GeographicCounts;
  simulatedCounts: GeographicCounts;
  municipalities: MunicipalityOverview[];
}

export type CoverageStatus = "source_unavailable" | "stale" | "simulated" | "verified" | "no_verified_feed";

export interface OverviewMunicipalityInput extends Partial<MunicipalityOverview> {
  psgcCode: string;
  activeFloodZones?: number;
}

export interface OverviewRow {
  psgcCode: string;
  name: string;
  provincePsgcCode: string | null;
  provinceName: string;
  coverageStatus: CoverageStatus;
  verifiedActiveFloodZones: number;
  simulatedActiveFloodZones: number;
  activeFloodZonesDisplay: string;
  roadConditions: number | null;
  verifiedReports: number | null;
  evacuationCenters: number | null;
  activeAlerts: number | null;
  freshestAt: number | null;
}

const STALE_AFTER_MS = 24 * 60 * 60_000;

export function buildOverviewRows(input: {
  municipalities: OverviewMunicipalityInput[];
  generatedAt?: number;
}): OverviewRow[] {
  const now = input.generatedAt ?? Date.now();
  return input.municipalities.map((item) => {
    const unit = getUnit(item.psgcCode);
    const provinceCode = item.provincePsgcCode ?? unit?.provincePsgcCode ?? null;
    const province = getUnit(provinceCode);
    const verifiedFloodZones = item.verifiedFloodZones ?? item.activeFloodZones ?? item.floodZones ?? 0;
    const simulatedFloodZones = item.simulatedFloodZones ?? 0;
    const verifiedSources = item.verifiedSources ?? (item.verifiedCounts
      ? Object.values(item.verifiedCounts).reduce((sum, value) => sum + value, 0)
      : verifiedFloodZones > 0 ? 1 : 0);
    const simulatedSources = item.simulatedCounts
      ? Object.values(item.simulatedCounts).reduce((sum, value) => sum + value, 0)
      : simulatedFloodZones;
    const stale = item.freshestAt != null && now - item.freshestAt > STALE_AFTER_MS;
    const coverageStatus: CoverageStatus = item.sourceUnavailable
      ? "source_unavailable"
      : stale
        ? "stale"
        : simulatedSources > 0
          ? "simulated"
          : verifiedSources > 0
            ? "verified"
            : "no_verified_feed";
    const unavailable = coverageStatus === "source_unavailable" || coverageStatus === "no_verified_feed";
    const activeFloodZonesDisplay = unavailable
      ? "—"
      : simulatedFloodZones > 0
        ? `${verifiedFloodZones} verified + ${simulatedFloodZones} simulated`
        : String(verifiedFloodZones);
    const metric = (key: keyof GeographicCounts): number | null => {
      if (!item.verifiedCounts && !item.simulatedCounts) return unavailable ? null : item[key] ?? 0;
      const hasSource = (item.verifiedCounts?.[key] ?? 0) > 0 || (item.simulatedCounts?.[key] ?? 0) > 0;
      return hasSource ? item[key] ?? 0 : null;
    };
    return {
      psgcCode: item.psgcCode,
      name: item.name ?? unit?.name ?? item.psgcCode,
      provincePsgcCode: provinceCode,
      provinceName: province?.name ?? "Unknown province",
      coverageStatus,
      verifiedActiveFloodZones: verifiedFloodZones,
      simulatedActiveFloodZones: simulatedFloodZones,
      activeFloodZonesDisplay,
      roadConditions: metric("roadConditions"),
      verifiedReports: metric("verifiedReports"),
      evacuationCenters: metric("evacuationCenters"),
      activeAlerts: metric("activeAlerts"),
      freshestAt: item.freshestAt ?? null,
    };
  });
}
