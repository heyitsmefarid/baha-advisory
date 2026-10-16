/**
 * Municipalities of Oriental Mindoro (the app's pilot province — see
 * DEFAULT_CENTER / ORIENTAL_MINDORO_BOUNDS in src/firebase.ts).
 *
 * Coordinates are APPROXIMATE town-centre points, used only for:
 *  - suggesting an `area` for a community report from its location,
 *  - sampling weather for the experimental risk model,
 *  - centring the map on an area.
 * They are not official boundaries. `area` stays free text in Firestore
 * (existing zones may use other labels), so this list is a suggestion set.
 */
export interface AreaInfo {
  name: string;
  center: [number, number];
}

export const ORIENTAL_MINDORO_AREAS: AreaInfo[] = [
  { name: "Calapan City", center: [13.4117, 121.1803] },
  { name: "Baco", center: [13.3583, 121.0975] },
  { name: "San Teodoro", center: [13.4372, 121.0197] },
  { name: "Puerto Galera", center: [13.505, 120.9544] },
  { name: "Naujan", center: [13.3236, 121.3028] },
  { name: "Victoria", center: [13.1772, 121.2775] },
  { name: "Socorro", center: [13.0583, 121.4111] },
  { name: "Pola", center: [13.1436, 121.44] },
  { name: "Pinamalayan", center: [13.035, 121.4889] },
  { name: "Gloria", center: [12.9722, 121.4778] },
  { name: "Bansud", center: [12.8619, 121.4572] },
  { name: "Bongabong", center: [12.7447, 121.4889] },
  { name: "Roxas", center: [12.5869, 121.5203] },
  { name: "Mansalay", center: [12.5203, 121.4386] },
  { name: "Bulalacao", center: [12.3256, 121.3431] },
];

export const AREA_NAMES = ORIENTAL_MINDORO_AREAS.map((a) => a.name);

/** Service bounds (same box as ORIENTAL_MINDORO_BOUNDS, slightly padded). */
export const SERVICE_BOUNDS = {
  south: 12.1,
  west: 120.8,
  north: 13.6,
  east: 121.8,
};

export function isWithinServiceBounds(lat: number, lng: number): boolean {
  return (
    lat >= SERVICE_BOUNDS.south &&
    lat <= SERVICE_BOUNDS.north &&
    lng >= SERVICE_BOUNDS.west &&
    lng <= SERVICE_BOUNDS.east
  );
}

/** Nearest municipality centre — a suggestion, editable by DRRM staff. */
export function nearestArea(lat: number, lng: number): AreaInfo {
  let best = ORIENTAL_MINDORO_AREAS[0];
  let bestD = Infinity;
  for (const a of ORIENTAL_MINDORO_AREAS) {
    const d = (a.center[0] - lat) ** 2 + ((a.center[1] - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}
