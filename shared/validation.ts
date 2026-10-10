/**
 * Minimal input validation (no schema library — keeps the bundle and the
 * serverless functions small). Every backend handler parses its body with
 * these before touching Firestore or an AI provider.
 */
import { isWithinServiceBounds } from "./areas";
import { isValidHierarchy, type GeographicReference } from "./geography";
import type { LatLng } from "./types";

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "ValidationError";
  }
}

type Obj = Record<string, unknown>;

export function asObject(value: unknown, what = "body"): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError([`${what} must be a JSON object.`]);
  }
  return value as Obj;
}

/** Strips control characters (except newlines/tabs) and trims. */
export function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export interface StrOpts {
  min?: number;
  max: number;
  optional?: boolean;
  pattern?: RegExp;
}

export function str(o: Obj, key: string, opts: StrOpts): string {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    throw new ValidationError([`${key} is required.`]);
  }
  if (typeof v !== "string") throw new ValidationError([`${key} must be text.`]);
  const s = cleanText(v);
  if (opts.min !== undefined && s.length < opts.min) throw new ValidationError([`${key} must be at least ${opts.min} characters.`]);
  if (s.length > opts.max) throw new ValidationError([`${key} must be at most ${opts.max} characters.`]);
  if (opts.pattern && !opts.pattern.test(s)) throw new ValidationError([`${key} has an invalid format.`]);
  return s;
}

export function optStr(o: Obj, key: string, max: number): string | null {
  const s = str(o, key, { max, optional: true });
  return s === "" ? null : s;
}

export interface NumOpts {
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
}

export function num(o: Obj, key: string, opts: NumOpts = {}): number {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return NaN;
    throw new ValidationError([`${key} is required.`]);
  }
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ValidationError([`${key} must be a number.`]);
  if (opts.integer && !Number.isInteger(n)) throw new ValidationError([`${key} must be a whole number.`]);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError([`${key} must be ≥ ${opts.min}.`]);
  if (opts.max !== undefined && n > opts.max) throw new ValidationError([`${key} must be ≤ ${opts.max}.`]);
  return n;
}

export function optNum(o: Obj, key: string, opts: Omit<NumOpts, "optional"> = {}): number | null {
  const n = num(o, key, { ...opts, optional: true });
  return Number.isNaN(n) ? null : n;
}

export function bool(o: Obj, key: string, fallback = false): boolean {
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") throw new ValidationError([`${key} must be true or false.`]);
  return v;
}

export function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], fallback?: T): T {
  const v = o[key];
  if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError([`${key} must be one of: ${allowed.join(", ")}.`]);
  }
  return v as T;
}

export function strArray(o: Obj, key: string, opts: { maxItems: number; maxLen: number; allowed?: readonly string[] }): string[] {
  const v = o[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError([`${key} must be a list.`]);
  if (v.length > opts.maxItems) throw new ValidationError([`${key} has too many items (max ${opts.maxItems}).`]);
  return v.map((item, i) => {
    if (typeof item !== "string") throw new ValidationError([`${key}[${i}] must be text.`]);
    const s = cleanText(item);
    if (s.length > opts.maxLen) throw new ValidationError([`${key}[${i}] is too long.`]);
    if (opts.allowed && !opts.allowed.includes(s)) throw new ValidationError([`${key}[${i}] is not allowed.`]);
    return s;
  });
}

export function latLng(o: Obj, key: string, opts: { requireServiceArea?: boolean } = {}): LatLng {
  const v = o[key];
  if (!v || typeof v !== "object") throw new ValidationError([`${key} must be a {lat, lng} location.`]);
  const p = v as Obj;
  const lat = num(p, "lat", { min: -90, max: 90 });
  const lng = num(p, "lng", { min: -180, max: 180 });
  if (opts.requireServiceArea && !isWithinServiceBounds(lat, lng)) {
    throw new ValidationError([`${key} is outside the Bahadvisory Mindoro Island service area.`]);
  }
  return { lat, lng };
}

export function optLatLng(o: Obj, key: string, opts: { requireServiceArea?: boolean } = {}): LatLng | null {
  if (o[key] === undefined || o[key] === null) return null;
  return latLng(o, key, opts);
}

export function geographicReference(o: Obj): GeographicReference {
  const value = {
    regionPsgcCode: str(o, "regionPsgcCode", { max: 10, pattern: /^\d{10}$/ }),
    provincePsgcCode: str(o, "provincePsgcCode", { max: 10, pattern: /^\d{10}$/ }),
    municipalityPsgcCode: str(o, "municipalityPsgcCode", { max: 10, pattern: /^\d{10}$/ }),
    barangayPsgcCode: optStr(o, "barangayPsgcCode", 10),
    locationAssignment: asObject(o.locationAssignment, "locationAssignment") as unknown as GeographicReference["locationAssignment"],
  };
  if (!isValidHierarchy(value)) throw new ValidationError(["Geographic PSGC hierarchy is invalid."]);
  return value;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PH_PHONE_RE = /^[0-9+()\-\s]{3,20}$/;
