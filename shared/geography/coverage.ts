import { getUnit } from "./catalog";
import { PUBLIC_SAFETY_FEATURES, type FeatureKey } from "../plans";

export type CoverageScope =
  | { level: "province"; psgcCode: string }
  | { level: "municipality"; psgcCode: string }
  | { level: "barangay"; psgcCode: string };

export interface CoverageValidation {
  ok: boolean;
  scopes: CoverageScope[];
  errors: string[];
}

function normalizedLevel(psgcCode: string): CoverageScope["level"] | null {
  const unit = getUnit(psgcCode);
  if (!unit || unit.level === "region") return null;
  if (unit.level === "city" || unit.level === "municipality") return "municipality";
  return unit.level;
}

function coversScope(parent: CoverageScope, child: CoverageScope): boolean {
  const unit = getUnit(child.psgcCode);
  if (!unit) return false;
  if (parent.level === "province") return unit.provincePsgcCode === parent.psgcCode;
  if (parent.level === "municipality") return unit.municipalityPsgcCode === parent.psgcCode;
  return parent.psgcCode === child.psgcCode;
}

export function validateCoverageScopes(input: unknown): CoverageValidation {
  if (!Array.isArray(input)) return { ok: false, scopes: [], errors: ["Coverage must be an array."] };
  const scopes: CoverageScope[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 100)) {
    if (!raw || typeof raw !== "object") { errors.push("Each coverage scope must be an object."); continue; }
    const level = (raw as { level?: unknown }).level;
    const psgcCode = (raw as { psgcCode?: unknown }).psgcCode;
    if ((level !== "province" && level !== "municipality" && level !== "barangay") || typeof psgcCode !== "string") {
      errors.push("Each coverage scope needs a supported level and PSGC code.");
      continue;
    }
    const actual = normalizedLevel(psgcCode);
    if (!actual) { errors.push(`Unknown or unsupported PSGC code: ${psgcCode}.`); continue; }
    if (actual !== level) { errors.push(`${psgcCode} is a ${actual}, not a ${level}.`); continue; }
    const key = `${level}:${psgcCode}`;
    if (seen.has(key)) { errors.push(`Duplicate coverage scope: ${psgcCode}.`); continue; }
    seen.add(key);
    scopes.push({ level, psgcCode });
  }
  for (let index = 0; index < scopes.length; index += 1) {
    if (scopes.some((candidate, candidateIndex) => candidateIndex !== index && coversScope(candidate, scopes[index]))) {
      errors.push(`Redundant descendant coverage: ${scopes[index].psgcCode}.`);
    }
  }
  return { ok: errors.length === 0 && scopes.length > 0, scopes, errors };
}

export function coverageIncludes(
  scopes: CoverageScope[],
  reference: { provincePsgcCode: string; municipalityPsgcCode: string | null; barangayPsgcCode: string | null },
): boolean {
  return scopes.some((scope) => {
    if (scope.level === "province") return scope.psgcCode === reference.provincePsgcCode;
    if (scope.level === "municipality") return scope.psgcCode === reference.municipalityPsgcCode;
    return scope.psgcCode === reference.barangayPsgcCode;
  });
}

export function canUseFeatureWithoutCoverage(feature: FeatureKey): boolean {
  return (PUBLIC_SAFETY_FEATURES as readonly string[]).includes(feature);
}

export class CoverageDeniedError extends Error {
  readonly code = "coverage_denied";
  constructor() { super("This paid operation is outside the subscription's configured service area."); }
}

export function requireSubscriptionCoverage(
  scopes: CoverageScope[],
  reference: { provincePsgcCode: string; municipalityPsgcCode: string | null; barangayPsgcCode: string | null },
): void {
  if (!coverageIncludes(scopes, reference)) throw new CoverageDeniedError();
}
