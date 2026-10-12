import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  boundsForScope,
  containsPoint,
  resolvePointWith,
  type BoundaryFeatureCollection,
} from "../../shared/geography";
import { assignGeography, validateGeographicReference } from "../../server/lib/geography";

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

  it("requires review for a point on an administrative boundary edge", () => {
    const result = resolvePointWith([13.3, 121.1], boundaries, {
      barangayGeometryAvailable: true,
      assignedAt: 123,
    });

    expect(result?.barangayPsgcCode).toBe("1705205001");
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

  it("constructs unavailable-boundary provenance on the server", () => {
    const result = assignGeography(
      { lat: 13.4, lng: 121.18 },
      {
        regionPsgcCode: "1700000000",
        provincePsgcCode: "1705200000",
        municipalityPsgcCode: "1705205000",
        barangayPsgcCode: "1705205001",
      },
      "citizen-1",
      123,
    );

    expect(result?.locationAssignment).toEqual({
      method: "manual",
      confidence: "review_required",
      sourceVersion: "Q2_2026",
      assignedAt: 123,
      assignedBy: "citizen-1",
    });
  });

  it("never copies unrelated report fields into an official geographic reference", () => {
    const reference = validateGeographicReference({
      regionPsgcCode: "1700000000",
      provincePsgcCode: "1705200000",
      municipalityPsgcCode: "1705205000",
      barangayPsgcCode: null,
      locationAssignment: { method: "manual", confidence: "review_required", sourceVersion: "Q2_2026", assignedAt: 1, assignedBy: "citizen" },
      status: "pending",
    } as never);
    expect(reference).not.toHaveProperty("status");
  });
});
