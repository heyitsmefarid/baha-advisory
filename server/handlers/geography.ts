import { getAuthCtx } from "../lib/auth";
import { getDb } from "../lib/firebaseAdmin";
import { getGeographicOverview } from "../lib/geographicSummary";
import { badRequest, forbidden, json } from "../lib/http";
import { jurisdictionCoversScope, normalizeScope, type GeographicScope, type JurisdictionGrant } from "../../shared/geography";
import type { RouteCtx } from "../router";

function scopeFromUrl(url: URL): GeographicScope {
  const raw: GeographicScope = {
    provincePsgcCode: url.searchParams.get("province"),
    municipalityPsgcCode: url.searchParams.get("municipality"),
    barangayPsgcCode: url.searchParams.get("barangay"),
  };
  const scope = normalizeScope(raw);
  if (
    raw.provincePsgcCode !== scope.provincePsgcCode ||
    raw.municipalityPsgcCode !== scope.municipalityPsgcCode ||
    raw.barangayPsgcCode !== scope.barangayPsgcCode
  ) throw badRequest("Invalid or mismatched PSGC scope.");
  return scope;
}

async function authorizeRefresh(req: Request, scope: GeographicScope) {
  const auth = await getAuthCtx(req);
  if (auth?.role === "super_admin") return;
  if (!auth?.orgId || !["lgu_staff", "lgu_admin"].includes(auth.role)) throw forbidden("Scoped DRRM authorization is required to refresh summaries.");
  const codes = [scope.barangayPsgcCode, scope.municipalityPsgcCode, scope.provincePsgcCode]
    .filter((code): code is string => Boolean(code));
  if (!codes.length) throw forbidden("Only Platform Administrators can refresh the island summary.");
  const snapshots = await Promise.all(codes.map((code) =>
    getDb().doc(`organizations/${auth.orgId}/jurisdiction_grants/${code}`).get(),
  ));
  const allowed = snapshots.some((snapshot) => {
    if (!snapshot.exists) return false;
    const grant = snapshot.data() as JurisdictionGrant;
    return grant.orgId === auth.orgId && grant.active === true && jurisdictionCoversScope(grant, scope);
  });
  if (!allowed) {
    throw forbidden("No active grant covers this summary scope.");
  }
}

export async function overview(req: Request, ctx: RouteCtx): Promise<Response> {
  const scope = scopeFromUrl(ctx.url);
  const refresh = ctx.url.searchParams.get("refresh") === "1";
  if (refresh) await authorizeRefresh(req, scope);
  return json(await getGeographicOverview(scope, refresh));
}
