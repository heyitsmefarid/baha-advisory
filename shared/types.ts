// ---------------------------------------------------------------------------
// Firestore data model (documents). See docs/DATA_MODEL.md for collection
// paths, ID strategies, access rules and indexes.
//
// Conventions
//  - Timestamps are Firestore Timestamps in storage (typed `unknown` here
//    because the client & Admin SDK use different classes; use
//    shared/time.ts toMillis() to read them).
//  - Points are stored as {lat,lng} objects (Firestore forbids nested arrays).
//  - `simulated: true` marks seeded demo data; every UI must label it.
//  - `orgId` is present on every tenant-private document.
// ---------------------------------------------------------------------------

import type { AppRole, ClaimRole, OrgType } from "./roles";
import type { PlanId, Entitlements } from "./plans";
import type { RoadPassability, VehiclePassability } from "./flood";
import type { GeographicReference } from "./geography";
export type { GovernmentLevel, JurisdictionGrant } from "./geography";

export type TS = unknown;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Additive during migration so older Firestore documents remain readable. */
export type GeographicRecordFields = Partial<GeographicReference> & {
  geographyMigrationVersion?: string;
};

// ---- Users & organizations ------------------------------------------------

export interface AlertPreferences {
  enabled: boolean;
  radiusM: number;
  /** Minimum severity that triggers a notification. */
  minSeverity: AlertSeverity;
  pushEnabled: boolean;
  types: { flood: boolean; roadClosure: boolean; evacuation: boolean; advisory: boolean };
  language: "en" | "fil";
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  enabled: true,
  radiusM: 3000,
  minSeverity: "moderate",
  pushEnabled: false,
  types: { flood: true, roadClosure: true, evacuation: true, advisory: true },
  language: "en",
};

/** users/{uid} — directory/profile. Role fields are written server-side only. */
export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: ClaimRole;
  orgId?: string | null;
  assignedArea?: string;
  active: boolean;
  alertPrefs?: AlertPreferences;
  fcmTokens?: string[];
  /** Coarse last-known location for push targeting — only stored when the
   *  user opts in to background alerts. */
  alertLocation?: LatLng | null;
  createdAt?: TS;
  isDemo?: boolean;
}

export type SavedLocationLabel = "home" | "school" | "work" | "other";

/** users/{uid}/saved_locations/{id} */
export interface SavedLocation {
  id: string;
  label: SavedLocationLabel;
  name: string;
  location: LatLng;
  alertRadiusM: number;
  createdAt?: TS;
}

/** users/{uid}/emergency_contacts/{id} */
export interface EmergencyContact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  relationship?: string;
}

/** users/{uid}/notifications/{id} — per-user alert/billing history. */
export interface UserNotification {
  id: string;
  kind: "alert" | "billing" | "report" | "system";
  title: string;
  body: string;
  severity?: AlertSeverity;
  refPath?: string;
  read: boolean;
  createdAt: TS;
}

export type OrgStatus = "active" | "suspended" | "pending_approval";

/** organizations/{orgId} */
export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  status: OrgStatus;
  /** LGU jurisdiction (municipality names). */
  jurisdictionAreas: string[];
  /** Enterprise parent for multi-branch setups. */
  parentOrgId?: string | null;
  planId: PlanId | null;
  subscriptionId?: string | null;
  subscriptionStatus: SubscriptionStatus | "none";
  /** Denormalized for Firestore rules — recomputed on every billing event. */
  entitlements: Entitlements;
  addOns?: string[];
  contactEmail?: string;
  contactPhone?: string;
  hotlines?: { label: string; number: string }[];
  createdAt: TS;
  createdBy: string;
  isDemo?: boolean;
}

/** organizations/{orgId}/members/{uid} */
export interface OrgMember {
  uid: string;
  name: string;
  email: string;
  role: AppRole;
  assignedArea?: string | null;
  active: boolean;
  addedAt: TS;
  addedBy: string;
}

/** org_applications/{id} — LGU onboarding requests (Super Admin approves). */
export interface OrgApplication {
  id: string;
  orgName: string;
  type: OrgType;
  jurisdictionAreas: string[];
  applicantUid: string;
  applicantEmail: string;
  applicantName: string;
  position?: string;
  message?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: TS;
  reviewedBy?: string;
  reviewedAt?: TS;
  orgId?: string;
}

// ---- Community reporting ----------------------------------------------------

export type ReportStatus = "pending" | "verified" | "rejected" | "duplicate" | "needs_info";

export type DepthLabel =
  | "none"
  | "ankle"
  | "gutter"
  | "half_knee"
  | "knee"
  | "waist"
  | "chest_or_higher"
  | "unknown";

/** Approximate depth (m) for each label — lower bound of the MMDA band. */
export const DEPTH_LABEL_METERS: Record<DepthLabel, number | null> = {
  none: 0,
  ankle: 0.1,
  gutter: 0.2,
  half_knee: 0.25,
  knee: 0.48,
  waist: 0.94,
  chest_or_higher: 1.14,
  unknown: null,
};

export const DEPTH_LABEL_TEXT: Record<DepthLabel, string> = {
  none: "No standing water",
  ankle: "Ankle deep",
  gutter: "Gutter level (~8 in)",
  half_knee: "Half-knee (~10 in)",
  knee: "Knee level (~19 in)",
  waist: "Waist level (~37 in)",
  chest_or_higher: "Chest level or higher",
  unknown: "Not sure",
};

export type SeveritySuggestion = "none" | "low" | "moderate" | "high" | "severe" | "unknown";

/** Compact AI summary denormalized onto the report for the moderation list. */
export interface ReportAiSummary {
  analysisId: string;
  provider: AiProviderName;
  model: string;
  imageAnalyzed: boolean;
  floodVisible: boolean | null;
  depthEstimate: DepthLabel;
  severitySuggestion: SeveritySuggestion;
  roadObstruction: boolean | null;
  consistency: "consistent" | "inconsistent" | "unclear" | "not_checked";
  confidence: number;
}

/** community_reports/{reportId} */
export interface CommunityReport extends GeographicRecordFields {
  id: string;
  reporterUid: string;
  /** Idempotency key from the offline draft queue. */
  clientDraftId?: string | null;
  location: LatLng;
  locationSource: "gps" | "manual";
  locationAccuracyM?: number | null;
  area: string;
  description: string;
  depthLabel: DepthLabel;
  estimatedDepthM: number | null;
  roadName?: string;
  roadBlocked?: boolean;
  photoUrl?: string | null;
  photoStorage?: "cloudinary" | "inline" | null;
  status: ReportStatus;
  ai?: ReportAiSummary | null;
  duplicateOf?: string | null;
  duplicateCandidates?: string[];
  suspiciousFlags?: string[];
  linkedZoneId?: string | null;
  linkedIncidentId?: string | null;
  verifiedBy?: string | null;
  verifiedByName?: string | null;
  verifiedAt?: TS;
  moderationNote?: string;
  /** Captured on device (offline drafts keep the original time). */
  observedAt: TS;
  createdAt: TS;
  simulated?: boolean;
}

/** community_reports/{id}/verifications/{autoId} — moderation trail. */
export interface ReportVerification {
  id: string;
  action: "verify" | "reject" | "mark_duplicate" | "request_info";
  byUid: string;
  byName: string;
  note: string;
  appliedToZoneId?: string | null;
  at: TS;
}

/** report_media/{reportId} — inline image fallback when Cloudinary is unset. */
export interface ReportMedia {
  dataUrl: string;
  bytes: number;
  reporterUid: string;
  status: ReportStatus;
  createdAt: TS;
}

// ---- Roads, stations, incidents, advisories --------------------------------

export type RoadConditionStatus = "open" | "caution" | "closed";

/** road_conditions/{id} — verified road segment status (closure lines). */
export interface RoadCondition extends GeographicRecordFields {
  id: string;
  name: string;
  /** Polyline of the affected segment. */
  path: LatLng[];
  status: RoadConditionStatus;
  /** Vehicles still allowed through (closed ⇒ all false). */
  passability: VehiclePassability;
  reason: string;
  area: string;
  source: "drrm" | "verified_report";
  sourceReportIds?: string[];
  active: boolean;
  updatedBy: string;
  updatedByName?: string;
  updatedAt: TS;
  expiresAt?: TS | null;
  simulated?: boolean;
}

/** water_level_stations/{id} */
export interface WaterLevelStation extends GeographicRecordFields {
  id: string;
  name: string;
  riverName?: string;
  location: LatLng;
  area: string;
  thresholds: { alertM: number; alarmM: number; criticalM: number };
  source: "manual" | "sensor" | "simulated";
  active: boolean;
  lastLevelM?: number | null;
  lastReadingAt?: TS;
  simulated?: boolean;
}

/** water_level_stations/{id}/readings/{autoId} */
export interface WaterLevelReading {
  id: string;
  levelM: number;
  recordedAt: TS;
  source: "manual" | "sensor" | "simulated";
  enteredBy?: string;
  simulated?: boolean;
}

export type IncidentStatus = "open" | "responding" | "monitoring" | "resolved";
export type IncidentType = "flood" | "road_closure" | "rescue" | "landslide" | "evacuation" | "other";

/** incidents/{id} — LGU-private incident management (org-scoped). */
export interface Incident extends GeographicRecordFields {
  id: string;
  orgId: string;
  title: string;
  type: IncidentType;
  severity: AlertSeverity;
  status: IncidentStatus;
  area: string;
  location?: LatLng | null;
  description: string;
  linkedReportIds: string[];
  linkedZoneId?: string | null;
  assignedTo: string[];
  createdBy: string;
  createdByName: string;
  createdAt: TS;
  updatedAt: TS;
  resolvedAt?: TS | null;
  aiSummary?: string | null;
  simulated?: boolean;
}

/** incidents/{id}/updates/{autoId} — incident timeline. */
export interface IncidentUpdate {
  id: string;
  orgId: string;
  note: string;
  status?: IncidentStatus;
  byUid: string;
  byName: string;
  at: TS;
}

export type AdvisoryStatus = "draft" | "published" | "archived";

/** advisories/{id} — official advisories (public once published). */
export interface Advisory {
  id: string;
  orgId: string;
  title: string;
  body: string;
  bodyFil?: string;
  severity: AlertSeverity;
  areas: string[];
  /** PSGC municipality codes corresponding to `areas`; additive for legacy reads. */
  areaPsgcCodes?: string[];
  status: AdvisoryStatus;
  aiDrafted: boolean;
  aiModel?: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: TS;
  publishedAt?: TS | null;
  publishedBy?: string | null;
  simulated?: boolean;
}

// ---- Alerts -------------------------------------------------------------------

export type AlertSeverity = "info" | "moderate" | "high" | "critical";
export const ALERT_SEVERITY_ORDER: AlertSeverity[] = ["info", "moderate", "high", "critical"];

export type AlertType = "flood" | "road_closure" | "evacuation" | "advisory";

/** alerts/{id} — public, location-targeted alerts (always free). */
export interface PublicAlert extends GeographicRecordFields {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  center: LatLng;
  radiusM: number;
  area: string;
  sourceRef?: string | null;
  issuedBy: string;
  issuedByName: string;
  orgId?: string | null;
  createdAt: TS;
  expiresAt: TS;
  active: boolean;
  pushSent?: number;
  /** Users whose saved places / alert location fell inside the radius. */
  matchedUsers?: number;
  simulated?: boolean;
}

// ---- Evacuation -----------------------------------------------------------------

export type EvacuationStatus = "open" | "full" | "standby" | "closed";

export const EVAC_FACILITIES = [
  "water",
  "food",
  "medical",
  "toilets",
  "power",
  "pwd_access",
  "pet_area",
  "women_child_space",
  "charging",
] as const;
export type EvacFacility = (typeof EVAC_FACILITIES)[number];

export const EVAC_FACILITY_LABELS: Record<EvacFacility, string> = {
  water: "Drinking water",
  food: "Food packs",
  medical: "Medical station",
  toilets: "Toilets",
  power: "Generator power",
  pwd_access: "PWD accessible",
  pet_area: "Pet area",
  women_child_space: "Women & child-friendly space",
  charging: "Phone charging",
};

/** evacuation_centers/{id} */
export interface EvacuationCenter extends GeographicRecordFields {
  id: string;
  name: string;
  address: string;
  area: string;
  location: LatLng;
  capacity: number | null;
  occupancy: number | null;
  /** Capacity/occupancy are only shown publicly when this is true. */
  occupancyVerified: boolean;
  occupancyUpdatedAt?: TS;
  status: EvacuationStatus;
  facilities: EvacFacility[];
  contact: { name?: string; phone?: string };
  orgId: string;
  /** Unverified centers are only visible to LGU staff. */
  verified: boolean;
  updatedBy: string;
  updatedAt: TS;
  simulated?: boolean;
}

/** evacuation_centers/{id}/status_updates/{autoId} */
export interface EvacuationStatusUpdate {
  id: string;
  status: EvacuationStatus;
  occupancy: number | null;
  note?: string;
  byUid: string;
  at: TS;
}

/** sos_requests/{id} */
export interface SosRequest extends GeographicRecordFields {
  id: string;
  uid: string;
  name?: string;
  phone?: string;
  location: LatLng;
  accuracyM?: number | null;
  area: string;
  message: string;
  peopleCount?: number;
  status: "open" | "acknowledged" | "resolved" | "cancelled";
  acknowledgedBy?: string | null;
  acknowledgedByName?: string | null;
  responderNote?: string;
  createdAt: TS;
  updatedAt: TS;
  simulated?: boolean;
}

// ---- Business fleet -----------------------------------------------------------------

export type VehicleType = "motorcycle" | "car" | "suv" | "truck" | "bicycle";

/** organizations/{orgId}/saved_routes/{id} */
export interface SavedRoute {
  id: string;
  orgId: string;
  name: string;
  vehicle: VehicleType;
  stops: { label: string; location: LatLng }[];
  createdBy: string;
  createdAt: TS;
  lastCheckedAt?: TS | null;
  lastStatus?: "safe" | "caution" | "unsafe" | "unknown";
  lastDistanceM?: number | null;
  lastDurationS?: number | null;
  activeDisruptions?: number;
}

/** organizations/{orgId}/route_disruptions/{id} */
export interface RouteDisruption {
  id: string;
  orgId: string;
  routeId: string;
  routeName: string;
  hazardId: string;
  hazardName: string;
  hazardKind: string;
  severity: "caution" | "blocked";
  detectedAt: TS;
  resolvedAt?: TS | null;
  active: boolean;
}

/** organizations/{orgId}/route_history/{id} — each fleet check / trip plan. */
export interface RouteHistoryEntry {
  id: string;
  orgId: string;
  routeId?: string | null;
  routeName: string;
  vehicle: VehicleType;
  status: "safe" | "caution" | "unsafe";
  distanceM: number;
  durationS: number;
  avoidedHazards: number;
  checkedBy: string;
  at: TS;
}

/** organizations/{orgId}/api_keys/{keyId} — key stored as SHA-256 hash only. */
export interface ApiKeyRecord {
  id: string;
  orgId: string;
  label: string;
  prefix: string;
  hash: string;
  createdBy: string;
  createdAt: TS;
  lastUsedAt?: TS | null;
  revoked: boolean;
}

// ---- Prediction & weather -------------------------------------------------------------

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
  available: boolean;
}

/** flood_risk_predictions/{areaKey} — latest experimental prediction per area. */
export interface FloodRiskPrediction extends GeographicRecordFields {
  id: string;
  area: string;
  center: LatLng;
  computedAt: TS;
  horizonHours: number;
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  hourly: { time: string; score: number; level: RiskLevel; precipMm: number }[];
  dataCompleteness: number;
  modelVersion: string;
  experimental: true;
  sources: string[];
  /** True when any input (zones, gauges, history) is simulated demo data. */
  simulatedInputs?: boolean;
}

/** weather_observations/{areaKey_YYYY-MM-DD-HH} — cached Open-Meteo pull. */
export interface WeatherObservation {
  id: string;
  area: string;
  center: LatLng;
  fetchedAt: TS;
  provider: "open-meteo";
  hourly: { time: string; precipMm: number; precipProb: number | null }[];
  elevationM: number | null;
}

// ---- AI -----------------------------------------------------------------------------------

export type AiProviderName = "groq" | "gemini" | "simulated";
export type AiTask =
  | "chat"
  | "image_analysis"
  | "advisory_draft"
  | "incident_summary"
  | "route_explanation";

/** ai_analysis_results/{id} */
export interface AiAnalysisResult {
  id: string;
  task: AiTask;
  reportId?: string | null;
  provider: AiProviderName;
  model: string;
  result: Record<string, unknown>;
  disclaimer: string;
  latencyMs: number;
  createdAt: TS;
  requestedBy: string;
  orgId?: string | null;
}

/** ai_chat_history/{uid}/messages/{autoId} */
export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: AiProviderName;
  model?: string;
  groundedOn?: string[];
  createdAt: TS;
}

/** ai_usage_records/{subjectType}_{subjectId}_{period} */
export interface AiUsageCounter {
  subjectType: "user" | "org";
  subjectId: string;
  period: string; // YYYY-MM-DD or YYYY-MM
  chat: number;
  image: number;
  updatedAt: TS;
}

/** ai_usage_log/{autoId} — one row per provider call (incl. fallbacks). */
export interface AiUsageLogEntry {
  task: AiTask;
  provider: AiProviderName;
  model: string;
  uid: string;
  orgId?: string | null;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  latencyMs: number;
  status: "ok" | "error" | "fallback" | "cached" | "quota_blocked";
  error?: string;
  at: TS;
}

// ---- Billing ---------------------------------------------------------------------------------

export type SubscriptionStatus = "pending" | "active" | "past_due" | "canceled" | "expired";
export type BillingCycle = "monthly" | "annual";
/** "manual" = contract paid offline (e.g. LGU bank transfer), recorded by the Super Admin. */
export type PaymentProviderName = "paymongo" | "xendit" | "demo" | "manual";

/** subscriptions/{subId} */
export interface Subscription {
  id: string;
  orgId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: TS | null;
  currentPeriodEnd: TS | null;
  cancelAtPeriodEnd: boolean;
  /** Downgrade scheduled for the end of the current period. */
  pendingPlanId?: PlanId | null;
  pendingBillingCycle?: BillingCycle | null;
  provider: PaymentProviderName;
  /** Demo/sandbox subscriptions never count as real revenue. */
  isDemo: boolean;
  livemode: boolean;
  /** Monthly-equivalent PHP price locked at purchase (for MRR). */
  mrrPhp: number;
  createdAt: TS;
  updatedAt: TS;
  canceledAt?: TS | null;
  lastReminderAt?: TS | null;
}

export type TransactionKind = "subscription" | "one_time_fee";
export type TransactionStatus = "pending" | "paid" | "failed" | "expired" | "canceled";

/** payment_transactions/{txId} */
export interface PaymentTransaction {
  id: string;
  orgId: string;
  kind: TransactionKind;
  planId?: PlanId | null;
  billingCycle?: BillingCycle | null;
  feeId?: string | null;
  description: string;
  amountPhp: number;
  /** Centavos — what providers charge and what webhooks are checked against. */
  amountMinor: number;
  currency: "PHP";
  provider: PaymentProviderName;
  providerRef?: string | null;
  checkoutUrl?: string | null;
  status: TransactionStatus;
  livemode: boolean;
  isDemo: boolean;
  createdBy: string;
  createdAt: TS;
  paidAt?: TS | null;
  invoiceId?: string | null;
  failureReason?: string | null;
}

/** billing_invoices/{invoiceId} */
export interface BillingInvoice {
  id: string;
  number: string;
  orgId: string;
  orgName: string;
  txId: string;
  lines: { description: string; amountPhp: number }[];
  totalPhp: number;
  provider: PaymentProviderName;
  isDemo: boolean;
  issuedAt: TS;
  status: "paid";
}

/** webhook_events/{provider}_{eventId} — idempotency ledger (server only). */
export interface WebhookEventRecord {
  provider: PaymentProviderName;
  eventId: string;
  type: string;
  txId: string | null;
  outcome: string;
  receivedAt: TS;
}

/** revenue_records/{YYYY-MM} — monthly aggregates (server computed). */
export interface RevenueRecord {
  id: string;
  month: string;
  real: { collectedPhp: number; transactions: number; mrrPhp: number; activeSubscriptions: number };
  demo: { collectedPhp: number; transactions: number; mrrPhp: number; activeSubscriptions: number };
  computedAt: TS;
}

// ---- Platform ------------------------------------------------------------------------------

/** platform_settings/general — public-readable flags. */
export interface PlatformGeneralSettings {
  demoMode: boolean;
  maintenanceMessage?: string | null;
  aiEnabled: boolean;
  chatbotEnabled: boolean;
  imageAnalysisEnabled: boolean;
  publicReportingEnabled: boolean;
  /** Nationwide hotline(s) shown everywhere — 911 is the PH emergency number. */
  emergencyHotlines: { label: string; number: string }[];
  updatedAt?: TS;
  updatedBy?: string;
}

/** platform_settings/ai — Super Admin tunables (server read only). */
export interface PlatformAiSettings {
  /** USD per 1M tokens (list-price estimates used for cost reporting). */
  pricing: Record<string, { inputPerM: number; outputPerM: number }>;
  perUserPerMinute: number;
  cacheTtlMinutes: number;
}

/** audit_logs/{autoId} */
export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorName?: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  orgId?: string | null;
  details?: Record<string, unknown>;
  at: TS;
}

export const ROAD_CONDITION_STATUS_TO_PASSABILITY: Record<RoadConditionStatus, RoadPassability> = {
  open: "passable",
  caution: "caution",
  closed: "closed",
};
