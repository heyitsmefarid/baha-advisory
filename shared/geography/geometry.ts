import generatedBoundaries from "./boundaries.generated.json";
import { getUnit, isValidHierarchy, MINDORO_REGION_PSGC, normalizeScope } from "./catalog";
import type { GeographicReference, GeographicScope } from "./types";

export type GeoJsonPosition = [number, number];
export type GeoJsonPolygon = { type: "Polygon"; coordinates: GeoJsonPosition[][] };
export type GeoJsonMultiPolygon = { type: "MultiPolygon"; coordinates: GeoJsonPosition[][][] };
export type SupportedGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface BoundaryFeature {
  type: "Feature";
  properties: {
    psgcCode: string;
    level: "province" | "city" | "municipality" | "barangay";
    [key: string]: unknown;
  };
  geometry: SupportedGeometry;
}

export interface BoundaryFeatureCollection {
  type: "FeatureCollection";
  features: BoundaryFeature[];
}

export interface GeographicAssignment extends GeographicReference {
  locationAssignment: {
    method: "boundary";
    confidence: "high" | "medium" | "review_required";
    sourceVersion: string;
    assignedAt: number;
    assignedBy: "system";
  };
}

interface ResolveOptions {
  barangayGeometryAvailable: boolean;
  assignedAt?: number;
  sourceVersion?: string;
}

const EPSILON = 1e-10;

function pointOnSegment(point: GeoJsonPosition, start: GeoJsonPosition, end: GeoJsonPosition): boolean {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > EPSILON) return false;
  return (
    x >= Math.min(x1, x2) - EPSILON &&
    x <= Math.max(x1, x2) + EPSILON &&
    y >= Math.min(y1, y2) - EPSILON &&
    y <= Math.max(y1, y2) + EPSILON
  );
}

function ringContains(ring: GeoJsonPosition[], point: GeoJsonPosition): "inside" | "outside" | "edge" {
  if (ring.length < 3) return "outside";
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(point, start, end)) return "edge";
    const intersects =
      start[1] > point[1] !== end[1] > point[1] &&
      point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0];
    if (intersects) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

type Containment = "inside" | "outside" | "edge";

function polygonContainment(rings: GeoJsonPosition[][], point: GeoJsonPosition): Containment {
  const outer = ringContains(rings[0] ?? [], point);
  if (outer !== "inside") return outer;
  for (const hole of rings.slice(1)) {
    const holeResult = ringContains(hole, point);
    if (holeResult === "inside") return "outside";
    if (holeResult === "edge") return "edge";
  }
  return "inside";
}

function geometryContainment(geometry: SupportedGeometry, point: [number, number]): Containment {
  const geoJsonPoint: GeoJsonPosition = [point[1], point[0]];
  if (geometry.type === "Polygon") return polygonContainment(geometry.coordinates, geoJsonPoint);
  if (geometry.type === "MultiPolygon") {
    let edge = false;
    for (const polygon of geometry.coordinates) {
      const result = polygonContainment(polygon, geoJsonPoint);
      if (result === "inside") return "inside";
      if (result === "edge") edge = true;
    }
    return edge ? "edge" : "outside";
  }
  return "outside";
}

export function containsPoint(geometry: SupportedGeometry, point: [number, number]): boolean {
  return geometryContainment(geometry, point) !== "outside";
}

function geometryArea(geometry: SupportedGeometry): number {
  const ringArea = (ring: GeoJsonPosition[]) => {
    let sum = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const next = ring[(index + 1) % ring.length];
      sum += ring[index][0] * next[1] - next[0] * ring[index][1];
    }
    return Math.abs(sum / 2);
  };
  const polygonArea = (polygon: GeoJsonPosition[][]) =>
    Math.max(0, ringArea(polygon[0] ?? []) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0));
  return geometry.type === "Polygon"
    ? polygonArea(geometry.coordinates)
    : geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

function smallestMatch(
  point: [number, number],
  features: BoundaryFeature[],
  levels: BoundaryFeature["properties"]["level"][],
): { feature: BoundaryFeature; edge: boolean } | null {
  const matches = features
    .filter((feature) => levels.includes(feature.properties.level))
    .map((feature) => ({ feature, containment: geometryContainment(feature.geometry, point) }))
    .filter((match) => match.containment !== "outside")
    .sort((left, right) => geometryArea(left.feature.geometry) - geometryArea(right.feature.geometry));
  if (!matches.length) return null;
  return {
    feature: matches[0].feature,
    edge: matches[0].containment === "edge" || matches.length > 1,
  };
}

export function resolvePointWith(
  point: [number, number],
  boundaries: BoundaryFeatureCollection,
  options: ResolveOptions,
): GeographicAssignment | null {
  const municipalityMatch = smallestMatch(point, boundaries.features, ["city", "municipality"]);
  if (!municipalityMatch) return null;
  const municipality = getUnit(municipalityMatch.feature.properties.psgcCode);
  if (!municipality || !["city", "municipality"].includes(municipality.level) || !municipality.provincePsgcCode) {
    return null;
  }

  const barangayMatch = options.barangayGeometryAvailable
    ? smallestMatch(point, boundaries.features, ["barangay"])
    : null;
  const barangay = barangayMatch ? getUnit(barangayMatch.feature.properties.psgcCode) : undefined;
  const barangayPsgcCode =
    barangay?.level === "barangay" && barangay.municipalityPsgcCode === municipality.psgcCode
      ? barangay.psgcCode
      : null;
  const reference = {
    regionPsgcCode: MINDORO_REGION_PSGC,
    provincePsgcCode: municipality.provincePsgcCode,
    municipalityPsgcCode: municipality.psgcCode,
    barangayPsgcCode,
  };
  if (!isValidHierarchy(reference)) return null;

  return {
    ...reference,
    locationAssignment: {
      method: "boundary",
      confidence: municipalityMatch.edge || barangayMatch?.edge
        ? "review_required"
        : barangayPsgcCode
          ? "high"
          : options.barangayGeometryAvailable
            ? "medium"
            : "review_required",
      sourceVersion: options.sourceVersion ?? "mindoro-boundaries-v1",
      assignedAt: options.assignedAt ?? Date.now(),
      assignedBy: "system",
    },
  };
}

const bundledBoundaries = generatedBoundaries as BoundaryFeatureCollection;

export function resolvePoint(point: [number, number]): GeographicAssignment | null {
  const barangayGeometryAvailable = bundledBoundaries.features.some(
    (feature) => feature.properties.level === "barangay",
  );
  return resolvePointWith(point, bundledBoundaries, { barangayGeometryAvailable });
}

function geometryBounds(geometry: SupportedGeometry): [[number, number], [number, number]] {
  const positions =
    geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  const latitudes = positions.map((position) => position[1]);
  const longitudes = positions.map((position) => position[0]);
  return [
    [Math.min(...latitudes), Math.min(...longitudes)],
    [Math.max(...latitudes), Math.max(...longitudes)],
  ];
}

export function boundsForScope(
  scope: GeographicScope,
  boundaries: BoundaryFeatureCollection = bundledBoundaries,
): [[number, number], [number, number]] {
  const normalized = normalizeScope(scope);
  const code =
    normalized.barangayPsgcCode ??
    normalized.municipalityPsgcCode ??
    normalized.provincePsgcCode ??
    MINDORO_REGION_PSGC;
  const feature = boundaries.features.find((candidate) => candidate.properties.psgcCode === code);
  return feature ? geometryBounds(feature.geometry) : getUnit(code)!.boundingBox;
}
