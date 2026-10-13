/**
 * Small, dependency-free geometry toolkit. Coordinates are [lat, lng]
 * tuples (the shape Leaflet and the existing app already use).
 *
 * Distances use a local equirectangular projection around the points
 * involved — accurate to well under 1% at the ~10 km scales flood zones
 * and road segments have, which is all routing safety checks need.
 */
import type { LatLng } from "./types";

export type Pt = [number, number];

const EARTH_R = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function toPt(p: LatLng): Pt {
  return [p.lat, p.lng];
}

export function fromPt(p: Pt): LatLng {
  return { lat: p[0], lng: p[1] };
}

export function haversineM(a: Pt, b: Pt): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Projects to meters on a plane tangent at `origin`. */
function project(p: Pt, origin: Pt): [number, number] {
  const x = toRad(p[1] - origin[1]) * EARTH_R * Math.cos(toRad(origin[0]));
  const y = toRad(p[0] - origin[0]) * EARTH_R;
  return [x, y];
}

function distPointSegXY(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

export function distancePointToSegmentM(p: Pt, a: Pt, b: Pt): number {
  return distPointSegXY(project(p, p), project(a, p), project(b, p));
}

export function distancePointToPolylineM(p: Pt, line: Pt[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineM(p, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, distancePointToSegmentM(p, line[i], line[i + 1]));
  }
  return best;
}

/** Ray-casting point-in-polygon (polygon ring may be open or closed). */
export function pointInPolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false;
  const [y, x] = p;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersectXY(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number]
): boolean {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Minimum distance between two segments in meters (0 when they cross). */
export function segmentDistanceM(a1: Pt, a2: Pt, b1: Pt, b2: Pt): number {
  const o = a1;
  const A1 = project(a1, o);
  const A2 = project(a2, o);
  const B1 = project(b1, o);
  const B2 = project(b2, o);
  if (segmentsIntersectXY(A1, A2, B1, B2)) return 0;
  return Math.min(
    distPointSegXY(A1, B1, B2),
    distPointSegXY(A2, B1, B2),
    distPointSegXY(B1, A1, A2),
    distPointSegXY(B2, A1, A2)
  );
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bboxOf(points: Pt[]): BBox {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of points) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return { south, west, north, east };
}

/** Expands a bbox by `meters` on every side. */
export function padBBox(b: BBox, meters: number): BBox {
  const dLat = toDeg(meters / EARTH_R);
  const midLat = (b.south + b.north) / 2;
  const dLng = toDeg(meters / (EARTH_R * Math.cos(toRad(midLat))));
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLng, east: b.east + dLng };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/**
 * True when the polyline passes through (or within `bufferM` of) the
 * polygon: a vertex inside it, an edge crossing, or near-miss under buffer.
 */
export function polylineIntersectsPolygon(line: Pt[], polygon: Pt[], bufferM = 0): boolean {
  if (line.length === 0 || polygon.length < 3) return false;
  if (!bboxIntersects(padBBox(bboxOf(line), bufferM + 1), bboxOf(polygon))) return false;
  for (const p of line) if (pointInPolygon(p, polygon)) return true;
  // A polygon entirely inside a long segment's corridor has no vertex of
  // the line inside it — the edge checks below catch that case.
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < polygon.length; j++) {
      const k = (j + 1) % polygon.length;
      if (segmentDistanceM(line[i], line[i + 1], polygon[j], polygon[k]) <= bufferM) return true;
    }
  }
  return false;
}

export function polylineIntersectsCircle(line: Pt[], center: Pt, radiusM: number): boolean {
  return distancePointToPolylineM(center, line) <= radiusM;
}

/** Minimum distance between two polylines in meters. */
export function polylineDistanceM(a: Pt[], b: Pt[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  if (a.length === 1) return distancePointToPolylineM(a[0], b);
  if (b.length === 1) return distancePointToPolylineM(b[0], a);
  if (!bboxIntersects(padBBox(bboxOf(a), 2000), bboxOf(b))) {
    return haversineM(a[0], b[0]); // far apart — exact value irrelevant
  }
  let best = Infinity;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      best = Math.min(best, segmentDistanceM(a[i], a[i + 1], b[j], b[j + 1]));
      if (best === 0) return 0;
    }
  }
  return best;
}

export function polylineLengthM(line: Pt[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += haversineM(line[i], line[i + 1]);
  return total;
}

export function centroid(points: Pt[]): Pt {
  const [latSum, lngSum] = points.reduce(([a, b], [lat, lng]) => [a + lat, b + lng], [0, 0]);
  return [latSum / points.length, lngSum / points.length];
}

/** Smallest circle (approx.) around a polygon: centroid + max vertex distance. */
export function boundingCircle(points: Pt[]): { center: Pt; radiusM: number } {
  const c = centroid(points);
  const r = Math.max(...points.map((p) => haversineM(c, p)));
  return { center: c, radiusM: r };
}

export function bearingDeg(a: Pt, b: Pt): number {
  const φ1 = toRad(a[0]);
  const φ2 = toRad(b[0]);
  const Δλ = toRad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(origin: Pt, bearing: number, distanceM: number): Pt {
  const δ = distanceM / EARTH_R;
  const θ = toRad(bearing);
  const φ1 = toRad(origin[0]);
  const λ1 = toRad(origin[1]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
}

/** Regular polygon approximating a circle (for providers that take polygons). */
export function circleToPolygon(center: Pt, radiusM: number, sides = 16): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < sides; i++) pts.push(destinationPoint(center, (360 / sides) * i, radiusM));
  return pts;
}

/** Index of the vertex on `line` nearest to `p`, plus its distance. */
export function nearestVertex(p: Pt, line: Pt[]): { index: number; distanceM: number } {
  let index = 0;
  let distanceM = Infinity;
  line.forEach((q, i) => {
    const d = haversineM(p, q);
    if (d < distanceM) {
      distanceM = d;
      index = i;
    }
  });
  return { index, distanceM };
}

/** Round coordinates for cache keys (≈11 m at 4 decimals). */
export function roundPt(p: Pt, decimals = 4): Pt {
  const f = 10 ** decimals;
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}
