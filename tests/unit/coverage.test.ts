import { describe, expect, it } from "vitest";
import {
  canUseFeatureWithoutCoverage,
  coverageIncludes,
  validateCoverageScopes,
} from "../../shared/geography/coverage";

const ORIENTAL_PSGC = "1705200000";
const CALAPAN_PSGC = "1705205000";
const NAUJAN_PSGC = "1705208000";
const calapanRef = { regionPsgcCode: "1700000000", provincePsgcCode: ORIENTAL_PSGC, municipalityPsgcCode: CALAPAN_PSGC, barangayPsgcCode: null };
const naujanRef = { ...calapanRef, municipalityPsgcCode: NAUJAN_PSGC };

describe("subscription coverage", () => {
  it("province coverage includes descendants", () => {
    expect(coverageIncludes([{ level: "province", psgcCode: ORIENTAL_PSGC }], calapanRef)).toBe(true);
  });

  it("municipality coverage excludes another municipality", () => {
    expect(coverageIncludes([{ level: "municipality", psgcCode: CALAPAN_PSGC }], naujanRef)).toBe(false);
  });

  it("public safety ignores paid coverage", () => {
    expect(canUseFeatureWithoutCoverage("emergencyAlerts")).toBe(true);
    expect(canUseFeatureWithoutCoverage("floodMonitoring")).toBe(true);
    expect(canUseFeatureWithoutCoverage("fleetMonitoring")).toBe(false);
  });

  it("rejects duplicates, level mismatches, and redundant descendants", () => {
    expect(validateCoverageScopes([{ level: "province", psgcCode: ORIENTAL_PSGC }, { level: "province", psgcCode: ORIENTAL_PSGC }]).ok).toBe(false);
    expect(validateCoverageScopes([{ level: "barangay", psgcCode: CALAPAN_PSGC }]).ok).toBe(false);
    expect(validateCoverageScopes([{ level: "province", psgcCode: ORIENTAL_PSGC }, { level: "municipality", psgcCode: CALAPAN_PSGC }]).ok).toBe(false);
  });
});
