import { getDb } from "./firebaseAdmin";
import { forbidden } from "./http";
import { geographicReferenceFrom } from "./geography";
import {
  scopeCoversReference,
  type GeographicReference,
  type JurisdictionGrant,
} from "../../shared/geography";
import { canManageArea, hasAllAreaAccess, isLguRole } from "../../shared/roles";
import type { AuthCtx } from "./auth";

export async function hasJurisdiction(
  auth: AuthCtx,
  reference: GeographicReference,
): Promise<boolean> {
  if (auth.role === "super_admin" || hasAllAreaAccess(auth.claims)) return true;
  if (!auth.orgId || !isLguRole(auth.role)) return false;

  const codes = [
    reference.barangayPsgcCode,
    reference.municipalityPsgcCode,
    reference.provincePsgcCode,
  ].filter((code): code is string => Boolean(code));
  const snapshots = await Promise.all(
    codes.map((code) => getDb().doc(`organizations/${auth.orgId}/jurisdiction_grants/${code}`).get()),
  );
  return snapshots.some((snapshot) => {
    if (!snapshot.exists) return false;
    const grant = snapshot.data() as JurisdictionGrant;
    return grant.orgId === auth.orgId && grant.active === true && scopeCoversReference(grant, reference);
  });
}

export async function requireJurisdiction(
  auth: AuthCtx,
  reference: GeographicReference,
): Promise<void> {
  if (!(await hasJurisdiction(auth, reference))) {
    throw forbidden("This record is outside your authorized PSGC jurisdiction.");
  }
}

/** Migrated documents use exact grants; legacy documents keep claim-array compatibility. */
export async function requireRecordJurisdiction(
  auth: AuthCtx,
  record: Record<string, unknown>,
): Promise<void> {
  const reference = geographicReferenceFrom(record);
  if (reference) return requireJurisdiction(auth, reference);
  if (canManageArea(auth.claims, typeof record.area === "string" ? record.area : null)) return;
  throw forbidden("This legacy record is outside your assigned area.");
}
