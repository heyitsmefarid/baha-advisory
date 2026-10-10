import { getAuthCtx } from "../lib/auth";
import { getDb } from "../lib/firebaseAdmin";
import { getGeographicOverview } from "../lib/geographicSummary";
import { badRequest, forbidden, json } from "../lib/http";
import { normalizeScope, type GeographicScope, type JurisdictionGrant } from "../../shared/geography";
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
  const code = scope.barangayPsgcCode ?? scope.municipalityPsgcCode ?? scope.provincePsgcCode;
  if (!code) throw forbidden("Only Platform Administrators can refresh the island summary.");
  const snapshot = await getDb().doc(`organizations/${auth.orgId}/jurisdiction_grants/${code}`).get();
  if (!snapshot.exists) throw forbidden("No active grant covers this summary scope.");
  const grant = snapshot.data() as JurisdictionGrant;
  const expectedLevel = scope.barangayPsgcCode ? "barangay" : scope.municipalityPsgcCode ? "municipality" : "province";
  if (grant.active !== true || grant.orgId !== auth.orgId || grant.level !== expectedLevel) {
    throw forbidden("No active grant covers this summary scope.");
  }
}

export async function overview(req: Request, ctx: RouteCtx): Promise<Response> {
  const scope = scopeFromUrl(ctx.url);
  const refresh = ctx.url.searchParams.get("refresh") === "1";
  if (refresh) await authorizeRefresh(req, scope);
  return json(await getGeographicOverview(scope, refresh));
}
