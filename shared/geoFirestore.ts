/**
 * Firestore does not support nested arrays (an array containing another
 * array) — see https://firebase.google.com/docs/firestore/manage-data/data-types.
 * Our app/Leaflet code works with [lat, lng] tuples everywhere, which IS a
 * nested array once you have a list of points, so we can never write
 * `[number, number][]` straight to a document. These two helpers are the
 * only place that boundary is crossed: convert to {lat, lng} objects right
 * before writing, and back to tuples right after reading.
 */
export type LatLngTuple = [number, number];
export type LatLngObject = { lat: number; lng: number };

export function tuplesToFirestore(points: LatLngTuple[]): LatLngObject[] {
  return points.map(([lat, lng]) => ({ lat, lng }));
}

export function tuplesFromFirestore(points: LatLngObject[]): LatLngTuple[] {
  return (points ?? []).map((p) => [p.lat, p.lng]);
}