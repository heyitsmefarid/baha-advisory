/**
 * Place search via OpenStreetMap Nominatim, biased to Oriental Mindoro.
 * Usage policy: searches run only on explicit submit (never per keystroke),
 * at most one request per second, results cached in memory.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
  type?: string;
}

const cache = new Map<string, PlaceResult[]>();
let lastCall = 0;

async function throttle() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function searchPlaces(q: string): Promise<PlaceResult[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  await throttle();
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "6",
    countrycodes: "ph",
    viewbox: "120.8,13.6,121.8,12.1",
    bounded: "0",
    "accept-language": "en",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Place search is unavailable right now.");
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string; type?: string }[];
  const out = rows.map((r) => ({
    label: r.display_name.split(",").slice(0, 3).join(","),
    lat: Number(r.lat),
    lng: Number(r.lon),
    type: r.type,
  }));
  cache.set(key, out);
  return out;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key)![0]?.label ?? null;
  try {
    await throttle();
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "17", "accept-language": "en" });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (!res.ok) return null;
    const r = (await res.json()) as { display_name?: string };
    const label = r.display_name?.split(",").slice(0, 2).join(",") ?? null;
    cache.set(key, label ? [{ label, lat, lng }] : []);
    return label;
  } catch {
    return null;
  }
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
