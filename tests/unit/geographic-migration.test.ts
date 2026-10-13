import { describe, expect, it } from "vitest";
import { CALAPAN_PSGC, MINDORO_REGION_PSGC, ORIENTAL_MINDORO_PSGC } from "../../shared/geography";
import { migrateRecord, validateGeographicReference } from "../../server/lib/geography";

describe("geographic migration", () => {
  it("maps Calapan and preserves the legacy area field", () => {
    const result = migrateRecord("community_reports", "r1", {
      area: "Calapan City",
      location: { lat: 13.41, lng: 121.18 },
    });

    expect(result.action).toBe("migrate");
    expect(result.patch).not.toHaveProperty("area");
    expect(result.patch.municipalityPsgcCode).toBe(CALAPAN_PSGC);
    expect(result.patch.provincePsgcCode).toBe(ORIENTAL_MINDORO_PSGC);
  });

  it("flags unknown names instead of guessing", () => {
    expect(migrateRecord("incidents", "i1", { area: "Unknown" })).toMatchObject({
      action: "review_required",
      patch: {},
    });
  });

  it("makes a second run a no-op", () => {
    const alreadyMigratedRecord = {
      area: "City of Calapan",
      regionPsgcCode: MINDORO_REGION_PSGC,
      provincePsgcCode: ORIENTAL_MINDORO_PSGC,
      municipalityPsgcCode: CALAPAN_PSGC,
      barangayPsgcCode: null,
      locationAssignment: {
        method: "migrated",
        confidence: "medium",
        sourceVersion: "Q2_2026",
        assignedAt: 1,
        assignedBy: "migration",
      },
      geographyMigrationVersion: "mindoro-psgc-q2-2026-v1",
    };

    expect(migrateRecord("alerts", "a1", alreadyMigratedRecord).action).toBe("unchanged");
  });

  it("rejects mismatched ancestry", () => {
    expect(() => validateGeographicReference({
      regionPsgcCode: MINDORO_REGION_PSGC,
      provincePsgcCode: "1705100000",
      municipalityPsgcCode: CALAPAN_PSGC,
      barangayPsgcCode: null,
      locationAssignment: {
        method: "manual",
        confidence: "medium",
        sourceVersion: "Q2_2026",
        assignedAt: 1,
        assignedBy: "test",
      },
    })).toThrow(/hierarchy/i);
  });
});
