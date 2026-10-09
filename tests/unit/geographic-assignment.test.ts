import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  boundsForScope,
  containsPoint,
  resolvePointWith,
  type BoundaryFeatureCollection,
} from "../../shared/geography";

const boundaries = JSON.parse(
  readFileSync(new URL("../fixtures/geography/boundaries-small.geojson", import.meta.url), "utf8"),
) as BoundaryFeatureCollection;

describe("government-boundary point assignment", () => {
  it("includes a point on the outer boundary", () => {
    expect(containsPoint(boundaries.features[0].geometry, [13, 121])).toBe(true);
  });

  it("selects the smallest matching authoritative unit", () => {
    const result = resolvePointWith([13.4, 121.18], boundaries, {
      barangayGeometryAvailable: true,
      assignedAt: 123,
    });

    expect(result).toMatchObject({
      provincePsgcCode: "1705200000",
      municipalityPsgcCode: "1705205000",
      barangayPsgcCode: "1705205001",
      locationAssignment: { confidence: "high", assignedAt: 123 },
    });
  });

  it("does not guess a barangay without authoritative geometry", () => {
    const result = resolvePointWith([13.4, 121.18], boundaries, {
      barangayGeometryAvailable: false,
    });

    expect(result?.barangayPsgcCode).toBeNull();
    expect(result?.locationAssignment.confidence).toBe("review_required");
  });

  it("returns null outside the supported polygons", () => {
    expect(
      resolvePointWith([14.5995, 120.9842], boundaries, { barangayGeometryAvailable: true }),
    ).toBeNull();
  });

  it("falls back to catalog navigation bounds when geometry is unavailable", () => {
    expect(
      boundsForScope(
        { provincePsgcCode: "1705200000", municipalityPsgcCode: "1705205000", barangayPsgcCode: null },
        { type: "FeatureCollection", features: [] },
      ),
    ).toEqual([[13.234354, 121.067022], [13.474354, 121.307022]]);
  });
});
