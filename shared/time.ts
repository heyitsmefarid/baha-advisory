/**
 * Firestore timestamps arrive in different shapes depending on where the
 * code runs (client SDK Timestamp, Admin SDK Timestamp, plain JSON from
 * the API `{ seconds, nanoseconds }` / `{ _seconds }`, ISO strings, Date,
 * epoch millis). Everything in /shared works in epoch millis via this.
 */
export type TimeLike =
  | number
  | string
  | Date
  | { toMillis(): number }
  | { seconds: number; nanoseconds?: number }
  | { _seconds: number; _nanoseconds?: number }
  | null
  | undefined;

export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.toMillis === "function") return (v.toMillis as () => number)();
    if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor(((v.nanoseconds as number) ?? 0) / 1e6);
    if (typeof v._seconds === "number") return v._seconds * 1000 + Math.floor(((v._nanoseconds as number) ?? 0) / 1e6);
  }
  return null;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** "5 min ago", "3 h ago", "2 d ago" — compact relative age for freshness labels. */
export function formatAge(ms: number | null, now = Date.now()): string {
  if (ms == null) return "unknown time";
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  return `${Math.round(diff / DAY)} d ago`;
}

/** YYYY-MM-DD in Asia/Manila — quota and revenue periods are PH-local. */
export function manilaDateKey(ms: number): string {
  const d = new Date(ms + 8 * HOUR);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM in Asia/Manila. */
export function manilaMonthKey(ms: number): string {
  return manilaDateKey(ms).slice(0, 7);
}
