import type { RouteDef } from "./router";
import * as system from "./handlers/system";
import * as routing from "./handlers/routing";
import * as reports from "./handlers/reports";
import * as ai from "./handlers/ai";
import * as alerts from "./handlers/alerts";
import * as risk from "./handlers/risk";
import * as ingest from "./handlers/ingest";
import * as billing from "./handlers/billing";
import * as orgs from "./handlers/orgs";
import * as fleet from "./handlers/fleet";
import * as publicApi from "./handlers/publicApi";
import * as admin from "./handlers/admin";
import * as demo from "./handlers/demo";

/** Route table — see docs/API.md for request/response shapes. */
export const routes: RouteDef[] = [
  ["GET", "/api/health", system.health],
  ["POST", "/api/auth/bootstrap", system.bootstrapProfile],

  // Navigation & evacuation (public safety — no login required)
  ["POST", "/api/route", routing.planRoute],
  ["POST", "/api/evacuation/nearest", routing.nearestEvacuation],

  // Community reporting & DRRM verification
  ["POST", "/api/reports", reports.submitReport],
  ["POST", "/api/reports/:id/verify", reports.verifyReport],

  // AI (Groq text, Gemini vision) — quotas enforced server-side
  ["POST", "/api/ai/chat", ai.chat],
  ["POST", "/api/ai/advisory-draft", ai.advisoryDraft],
  ["POST", "/api/ai/incident-summary", ai.incidentSummary],
  ["POST", "/api/ai/explain-route", ai.explainRoute],
  ["GET", "/api/ai/usage", ai.usage],

  // Advisories & public alerts (always free; push fan-out server-side)
  ["POST", "/api/advisories/:id/publish", alerts.publishAdvisory],
  ["POST", "/api/alerts", alerts.createAlert],
  ["POST", "/api/alerts/:id/deactivate", alerts.deactivateAlert],

  // Experimental flood-risk outlook & sensor ingest
  ["GET", "/api/risk", risk.getRisk],
  ["POST", "/api/ingest/water-level", ingest.ingestWaterLevel],

  // Billing (PayMongo / Xendit / sandbox) — entitlements only change via verified payments
  ["POST", "/api/billing/checkout", billing.checkout],
  ["POST", "/api/billing/webhook/:provider", billing.webhook],
  ["POST", "/api/billing/demo/:txId/complete", billing.demoComplete],
  ["POST", "/api/billing/cancel", billing.cancel],
  ["POST", "/api/billing/change-plan", billing.changePlan],
  ["POST", "/api/cron/daily", billing.cronDaily],
  ["GET", "/api/cron/daily", billing.cronDaily],

  // Organizations, staff, branches, API keys
  ["POST", "/api/orgs", orgs.createOrg],
  ["PATCH", "/api/orgs/:orgId", orgs.updateOrg],
  ["POST", "/api/orgs/:orgId/members", orgs.inviteMember],
  ["PATCH", "/api/orgs/:orgId/members/:uid", orgs.updateMember],
  ["DELETE", "/api/orgs/:orgId/members/:uid", orgs.removeMember],
  ["GET", "/api/orgs/:orgId/branches", orgs.listBranches],
  ["POST", "/api/orgs/:orgId/branches", orgs.createBranch],
  ["POST", "/api/orgs/:orgId/api-keys", orgs.createApiKey],
  ["DELETE", "/api/orgs/:orgId/api-keys/:keyId", orgs.revokeApiKey],

  // Business fleet monitoring
  ["POST", "/api/fleet/check", fleet.checkFleet],

  // Data API v1 (x-api-key; paid: apiAccess)
  ["GET", "/api/v1/flood-zones", publicApi.v1FloodZones],
  ["GET", "/api/v1/alerts", publicApi.v1Alerts],
  ["GET", "/api/v1/risk", publicApi.v1Risk],
  ["GET", "/api/v1/evacuation-centers", publicApi.v1Centers],

  // Platform Super Admin
  ["GET", "/api/admin/metrics", admin.metrics],
  ["POST", "/api/admin/plans/:id", admin.upsertPlan],
  ["POST", "/api/admin/settings", admin.updateSettings],
  ["POST", "/api/admin/orgs/:orgId/manual-subscription", admin.manualSubscription],
  ["POST", "/api/admin/orgs/:orgId/settings", orgs.adminOrgSettings],
  ["POST", "/api/admin/orgs/:orgId/recompute", billing.recompute],
  ["POST", "/api/admin/applications/:id/decide", orgs.decideApplication],
  ["POST", "/api/admin/users/:uid/role", orgs.adminSetRole],
  ["POST", "/api/admin/revenue/recompute", admin.recomputeRevenue],

  // Hackathon demo tools (only while platform demoMode is on; data flagged simulated)
  ["POST", "/api/demo/flood-on-route", demo.floodOnRoute],
  ["POST", "/api/demo/reset", demo.resetScenario],
];
