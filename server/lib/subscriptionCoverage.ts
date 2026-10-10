import type { DocumentSnapshot } from "firebase-admin/firestore";
import { getUnit, coverageIncludes, type CoverageScope } from "../../shared/geography";
import { HttpError, badRequest } from "./http";
import { getDb } from "./firebaseAdmin";

export interface CoverageTarget {
  psgcCode: string;
  provincePsgcCode: string;
  municipalityPsgcCode: string | null;
  barangayPsgcCode: string | null;
}

export function coverageTarget(psgcCode: string): CoverageTarget {
  const unit = getUnit(psgcCode);
  if (!unit || unit.level === "region") throw badRequest("Choose a supported province, municipality, city, or barangay.", "invalid_coverage_target");
  return {
    psgcCode,
    provincePsgcCode: unit.level === "province" ? unit.psgcCode : unit.provincePsgcCode!,
    municipalityPsgcCode: unit.level === "city" || unit.level === "municipality" ? unit.psgcCode : unit.municipalityPsgcCode,
    barangayPsgcCode: unit.level === "barangay" ? unit.psgcCode : null,
  };
}

export async function subscriptionCoverage(org: DocumentSnapshot): Promise<CoverageScope[]> {
  const subscriptionId = org.get("subscriptionId") as string | null;
  if (!subscriptionId) return [];
  const subscription = await getDb().doc(`subscriptions/${subscriptionId}`).get();
  return subscription.exists && Array.isArray(subscription.get("coverageScopes"))
    ? subscription.get("coverageScopes") as CoverageScope[]
    : [];
}

export async function requireSubscriptionCoverage(org: DocumentSnapshot, requestedCode?: string | null): Promise<CoverageTarget> {
  const scopes = await subscriptionCoverage(org);
  const psgcCode = requestedCode || (scopes.length === 1 ? scopes[0].psgcCode : null);
  if (!psgcCode) throw new HttpError(403, "Choose a service location covered by this subscription.", "coverage_denied");
  const target = coverageTarget(psgcCode);
  if (!coverageIncludes(scopes, target)) {
    throw new HttpError(403, "This paid operation is outside the subscription's configured service area.", "coverage_denied");
  }
  return target;
}

export function dataMatchesCoverage(data: Record<string, unknown>, target: CoverageTarget): boolean {
  if (target.barangayPsgcCode) return data.barangayPsgcCode === target.barangayPsgcCode;
  if (target.municipalityPsgcCode) return data.municipalityPsgcCode === target.municipalityPsgcCode;
  return data.provincePsgcCode === target.provincePsgcCode;
}
