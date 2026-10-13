import { describe, expect, it } from "vitest";
import { deriveIslandSituation } from "../../src/lib/islandSituation";

describe("island situation truth labels", () => {
  it("derives status from aggregate counts instead of empty map rows", () => {
    const situation = deriveIslandSituation({
      counts: { floodZones: 3, roadConditions: 2, verifiedReports: 0, evacuationCenters: 1, activeAlerts: 1 },
      verifiedCounts: { floodZones: 1, roadConditions: 2, verifiedReports: 0, evacuationCenters: 1, activeAlerts: 0 },
      simulatedCounts: { floodZones: 2, roadConditions: 0, verifiedReports: 0, evacuationCenters: 0, activeAlerts: 1 },
      sourceMaxUpdatedAt: 123,
    });
    expect(situation.hasActiveFlooding).toBe(true);
    expect(situation.anySimulated).toBe(true);
    expect(situation.newest).toBe(123);
  });
});
