import { describe, expect, it } from "vitest";
import { buildOverviewRows } from "../../shared/geography/overview";

const CALAPAN_PSGC = "1705205000";

describe("geographic overview rows", () => {
  it("distinguishes no feed from zero events", () => {
    const [row] = buildOverviewRows({
      municipalities: [{ psgcCode: CALAPAN_PSGC, verifiedSources: 0, activeFloodZones: 0 }],
    });

    expect(row.coverageStatus).toBe("no_verified_feed");
    expect(row.activeFloodZonesDisplay).toBe("—");
  });

  it("keeps simulated and verified counts separate", () => {
    const [row] = buildOverviewRows({
      municipalities: [{ psgcCode: CALAPAN_PSGC, verifiedFloodZones: 0, simulatedFloodZones: 1 }],
    });

    expect(row.verifiedActiveFloodZones).toBe(0);
    expect(row.simulatedActiveFloodZones).toBe(1);
    expect(row.coverageStatus).toBe("simulated");
  });

  it("uses source-unavailable before stale, simulated, and verified states", () => {
    const [row] = buildOverviewRows({
      generatedAt: Date.now(),
      municipalities: [{
        psgcCode: CALAPAN_PSGC,
        sourceUnavailable: true,
        freshestAt: Date.now() - 48 * 60 * 60_000,
        verifiedSources: 1,
        verifiedFloodZones: 2,
        simulatedFloodZones: 3,
      }],
    });

    expect(row.coverageStatus).toBe("source_unavailable");
    expect(row.activeFloodZonesDisplay).toBe("—");
  });
});
