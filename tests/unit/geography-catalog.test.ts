import { describe, expect, it } from "vitest";
import {
  MINDORO_CATALOG,
  childrenOf,
  getUnit,
  isValidHierarchy,
  legacyAreaToMunicipality,
  normalizeScope,
} from "../../shared/geography";

describe("Mindoro PSGC catalog", () => {
  it("contains both provinces, all 26 LGUs, and all 590 barangays", () => {
    expect(MINDORO_CATALOG.filter((unit) => unit.level === "province")).toHaveLength(2);
    expect(
      MINDORO_CATALOG.filter((unit) => ["city", "municipality"].includes(unit.level)),
    ).toHaveLength(26);
    expect(MINDORO_CATALOG.filter((unit) => unit.level === "barangay")).toHaveLength(590);
  });

  it("stores ten-digit codes as strings with valid parents", () => {
    for (const unit of MINDORO_CATALOG) {
      expect(unit.psgcCode).toMatch(/^\d{10}$/);
      if (unit.parentPsgcCode) expect(getUnit(unit.parentPsgcCode)).toBeDefined();
    }
  });

  it("clears a municipality selected under the wrong province", () => {
    expect(
      normalizeScope({
        provincePsgcCode: "1705200000",
        municipalityPsgcCode: "1705106000",
        barangayPsgcCode: null,
      }),
    ).toEqual({
      provincePsgcCode: "1705200000",
      municipalityPsgcCode: null,
      barangayPsgcCode: null,
    });
  });

  it("validates barangay ancestry and indexes children", () => {
    const calapanBarangay = getUnit("1705205001")!;

    expect(
      isValidHierarchy({
        regionPsgcCode: "1700000000",
        provincePsgcCode: "1705200000",
        municipalityPsgcCode: "1705205000",
        barangayPsgcCode: "1705205001",
      }),
    ).toBe(true);
    expect(childrenOf("1705205000", "barangay")).toContainEqual(calapanBarangay);
    expect(
      isValidHierarchy({
        regionPsgcCode: "1700000000",
        provincePsgcCode: "1705100000",
        municipalityPsgcCode: "1705205000",
        barangayPsgcCode: "1705205001",
      }),
    ).toBe(false);
  });

  it("normalizes legacy municipality names without guessing unknown areas", () => {
    expect(legacyAreaToMunicipality("Calapan City")?.psgcCode).toBe("1705205000");
    expect(legacyAreaToMunicipality("  abra de ilog ")?.psgcCode).toBe("1705101000");
    expect(legacyAreaToMunicipality("Unknown")).toBeNull();
  });
});
