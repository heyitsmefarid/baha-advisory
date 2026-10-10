import { describe, expect, it } from "vitest";
import {
  scopeCoversReference,
  type JurisdictionScope,
} from "../../shared/geography/jurisdiction";
import {
  CALAPAN_PSGC,
  MINDORO_REGION_PSGC,
  OCCIDENTAL_MINDORO_PSGC,
  ORIENTAL_MINDORO_PSGC,
  type GeographicReference,
} from "../../shared/geography";

const reference = (
  provincePsgcCode: string,
  municipalityPsgcCode: string,
  barangayPsgcCode: string | null,
): GeographicReference => ({
  regionPsgcCode: MINDORO_REGION_PSGC,
  provincePsgcCode,
  municipalityPsgcCode,
  barangayPsgcCode,
  locationAssignment: {
    method: "manual",
    confidence: barangayPsgcCode ? "high" : "medium",
    sourceVersion: "Q2_2026",
    assignedAt: 1,
    assignedBy: "test",
  },
});

const calapanRef = reference(ORIENTAL_MINDORO_PSGC, CALAPAN_PSGC, "1705205001");
const mamburaoRef = reference(OCCIDENTAL_MINDORO_PSGC, "1705106000", null);

describe("jurisdiction scopes", () => {
  it("province scope covers only its province", () => {
    const oriental: JurisdictionScope = { level: "province", psgcCode: ORIENTAL_MINDORO_PSGC };
    expect(scopeCoversReference(oriental, calapanRef)).toBe(true);
    expect(scopeCoversReference(oriental, mamburaoRef)).toBe(false);
  });

  it("municipality scope covers its barangays but not a sibling municipality", () => {
    expect(scopeCoversReference({ level: "municipality", psgcCode: CALAPAN_PSGC }, calapanRef)).toBe(true);
    expect(scopeCoversReference({ level: "municipality", psgcCode: CALAPAN_PSGC }, mamburaoRef)).toBe(false);
  });

  it("barangay scope excludes a sibling", () => {
    expect(scopeCoversReference({ level: "barangay", psgcCode: "1705205001" }, calapanRef)).toBe(true);
    expect(scopeCoversReference({ level: "barangay", psgcCode: "1705205002" }, calapanRef)).toBe(false);
  });

  it("rejects inactive grants", () => {
    expect(scopeCoversReference({ level: "province", psgcCode: ORIENTAL_MINDORO_PSGC, active: false }, calapanRef)).toBe(false);
  });
});
