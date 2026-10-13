import type { GeographicCounts } from "../../shared/geography/overview";

export function deriveIslandSituation(input: {
  counts: GeographicCounts;
  verifiedCounts?: GeographicCounts;
  simulatedCounts?: GeographicCounts;
  sourceMaxUpdatedAt: number | null;
}) {
  const simulatedTotal = Object.values(input.simulatedCounts ?? {}).reduce((sum, value) => sum + value, 0);
  const verifiedTotal = Object.values(input.verifiedCounts ?? {}).reduce((sum, value) => sum + value, 0);
  return {
    hasActiveFlooding: input.counts.floodZones > 0,
    anySimulated: simulatedTotal > 0,
    anyVerified: verifiedTotal > 0,
    newest: input.sourceMaxUpdatedAt,
  };
}
