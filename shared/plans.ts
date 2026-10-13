// ---------------------------------------------------------------------------
// Subscription plans, entitlements and AI quotas.
//
// DEFAULT_PLANS seeds `subscription_plans/*` (scripts/seed.ts). After that
// the Firestore documents are the source of truth and the Super Admin can
// edit price/limits — validatePlan() is what stops an edit from ever
// putting public-safety features behind a paywall or promising unlimited
// AI on free-tier providers.
// ---------------------------------------------------------------------------

import type { OrgType } from "./roles";

export type PlanId = "citizen_free" | "lgu_pro" | "business_pro" | "enterprise" | (string & {});

/** Features every person gets regardless of plan — never monetized. */
export const PUBLIC_SAFETY_FEATURES = [
  "floodMonitoring",
  "basicNavigation",
  "emergencyAlerts",
  "communityReporting",
  "evacuationFinder",
] as const;

export const PAID_FEATURES = [
  "advancedAnalytics",
  "fleetMonitoring",
  "incidentManagement",
  "staffManagement",
  "apiAccess",
  "customIntegrations",
  "multiBranch",
] as const;

export type PublicSafetyFeature = (typeof PUBLIC_SAFETY_FEATURES)[number];
export type PaidFeature = (typeof PAID_FEATURES)[number];
export type FeatureKey = PublicSafetyFeature | PaidFeature;

/** true = included, false = not available, "optional" = paid add-on. */
export type FeatureAvailability = boolean | "optional";

export interface AiLimits {
  /** null = this window is not limited (another window must be). */
  chatPerDay: number | null;
  chatPerMonth: number | null;
  imagePerDay: number | null;
  imagePerMonth: number | null;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Which organization type can buy it; null = individual citizens. */
  segment: OrgType | "citizen";
  /** Monthly price in PHP. null = custom quote (Enterprise). */
  priceMonthlyPhp: number | null;
  /** Annual price in PHP (usually discounted). null = custom quote. */
  priceAnnualPhp: number | null;
  features: Record<PaidFeature, FeatureAvailability>;
  historicalReports: "basic" | "advanced";
  aiChat: "limited" | "higher" | "custom";
  aiImage: "limited" | "higher" | "custom";
  aiLimits: AiLimits;
  /** One-time fees offered alongside the subscription (PHP). */
  oneTimeFees?: { id: string; label: string; amountPhp: number }[];
  active: boolean;
  sortOrder: number;
}

const NO_PAID_FEATURES: Record<PaidFeature, FeatureAvailability> = {
  advancedAnalytics: false,
  fleetMonitoring: false,
  incidentManagement: false,
  staffManagement: false,
  apiAccess: false,
  customIntegrations: false,
  multiBranch: false,
};

export const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: "citizen_free",
    name: "Citizen Free",
    tagline: "Every public-safety feature, free forever.",
    segment: "citizen",
    priceMonthlyPhp: 0,
    priceAnnualPhp: 0,
    features: { ...NO_PAID_FEATURES },
    historicalReports: "basic",
    aiChat: "limited",
    aiImage: "limited",
    aiLimits: { chatPerDay: 10, chatPerMonth: null, imagePerDay: 3, imagePerMonth: null },
    active: true,
    sortOrder: 0,
  },
  {
    id: "lgu_pro",
    name: "LGU Pro",
    tagline: "Command center for municipal & provincial DRRM offices.",
    segment: "lgu",
    priceMonthlyPhp: 5000,
    priceAnnualPhp: 54000,
    features: {
      advancedAnalytics: true,
      fleetMonitoring: "optional",
      incidentManagement: true,
      staffManagement: true,
      apiAccess: false,
      customIntegrations: false,
      multiBranch: false,
    },
    historicalReports: "advanced",
    aiChat: "higher",
    aiImage: "higher",
    aiLimits: { chatPerDay: null, chatPerMonth: 500, imagePerDay: null, imagePerMonth: 500 },
    oneTimeFees: [
      { id: "lgu_installation", label: "LGU installation & data onboarding", amountPhp: 25000 },
      { id: "staff_training", label: "Staff training package (1 day)", amountPhp: 15000 },
    ],
    active: true,
    sortOrder: 1,
  },
  {
    id: "business_pro",
    name: "Business Pro",
    tagline: "Flood-aware fleet routing and disruption alerts.",
    segment: "business",
    priceMonthlyPhp: 2000,
    priceAnnualPhp: 21600,
    features: {
      advancedAnalytics: true,
      fleetMonitoring: true,
      incidentManagement: false,
      staffManagement: true,
      apiAccess: "optional",
      customIntegrations: false,
      multiBranch: false,
    },
    historicalReports: "advanced",
    aiChat: "higher",
    aiImage: "higher",
    aiLimits: { chatPerDay: null, chatPerMonth: 300, imagePerDay: null, imagePerMonth: 100 },
    oneTimeFees: [{ id: "system_configuration", label: "Fleet system configuration", amountPhp: 8000 }],
    active: true,
    sortOrder: 2,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Multi-jurisdiction, API and custom integrations.",
    segment: "enterprise",
    priceMonthlyPhp: null,
    priceAnnualPhp: null,
    features: {
      advancedAnalytics: true,
      fleetMonitoring: true,
      incidentManagement: "optional",
      staffManagement: true,
      apiAccess: true,
      customIntegrations: true,
      multiBranch: true,
    },
    historicalReports: "advanced",
    aiChat: "custom",
    aiImage: "custom",
    // "Custom" still means a fair-use cap — free-tier AI providers cannot
    // honour unlimited usage. Negotiated per contract by the Super Admin.
    aiLimits: { chatPerDay: null, chatPerMonth: 2000, imagePerDay: null, imagePerMonth: 1000 },
    oneTimeFees: [{ id: "custom_integration", label: "Custom integration (per system)", amountPhp: 50000 }],
    active: true,
    sortOrder: 3,
  },
];

export const DEFAULT_PLAN_BY_ID: Record<string, SubscriptionPlan> = Object.fromEntries(
  DEFAULT_PLANS.map((p) => [p.id, p])
);

export const PAID_FEATURE_LABELS: Record<PaidFeature, string> = {
  advancedAnalytics: "Advanced analytics",
  fleetMonitoring: "Fleet monitoring",
  incidentManagement: "Incident management",
  staffManagement: "Staff management",
  apiAccess: "API access",
  customIntegrations: "Custom integrations",
  multiBranch: "Multi-branch / multi-jurisdiction",
};

export const PUBLIC_SAFETY_LABELS: Record<PublicSafetyFeature, string> = {
  floodMonitoring: "Flood monitoring",
  basicNavigation: "Flood-aware navigation",
  emergencyAlerts: "Emergency alerts",
  communityReporting: "Community reporting",
  evacuationFinder: "Evacuation finder",
};

export type Entitlements = Record<FeatureKey, boolean>;

/**
 * Resolves what an organization can use right now.
 * - Public-safety features are always true (even with no/expired plan).
 * - Paid features require an entitling subscription status.
 * - "optional" features require the add-on to be purchased.
 */
export function computeEntitlements(
  plan: SubscriptionPlan | null | undefined,
  opts: { subscriptionActive: boolean; addOns?: string[] }
): Entitlements {
  const out = {} as Entitlements;
  for (const f of PUBLIC_SAFETY_FEATURES) out[f] = true;
  for (const f of PAID_FEATURES) {
    const availability = plan?.features?.[f] ?? false;
    out[f] =
      opts.subscriptionActive &&
      (availability === true || (availability === "optional" && (opts.addOns ?? []).includes(f)));
  }
  return out;
}

export interface PlanValidationResult {
  ok: boolean;
  errors: string[];
}

/** Guards Super Admin edits to `subscription_plans/*`. */
export function validatePlan(plan: Partial<SubscriptionPlan>): PlanValidationResult {
  const errors: string[] = [];
  if (!plan.name || typeof plan.name !== "string") errors.push("Plan name is required.");
  for (const key of ["priceMonthlyPhp", "priceAnnualPhp"] as const) {
    const v = plan[key];
    if (v !== null && v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      errors.push(`${key} must be a non-negative number or null (custom quote).`);
    }
  }
  if (plan.segment === "citizen" && ((plan.priceMonthlyPhp ?? 0) !== 0 || (plan.priceAnnualPhp ?? 0) !== 0)) {
    errors.push("Citizen plans must stay free — essential safety services are never monetized.");
  }
  const features = (plan.features ?? {}) as Record<string, unknown>;
  for (const f of PUBLIC_SAFETY_FEATURES) {
    if (f in features) errors.push(`"${f}" is a public-safety feature and cannot be placed on a plan.`);
  }
  for (const [k, v] of Object.entries(features)) {
    if (!(PAID_FEATURES as readonly string[]).includes(k)) errors.push(`Unknown feature "${k}".`);
    else if (v !== true && v !== false && v !== "optional") errors.push(`Feature "${k}" must be true, false or "optional".`);
  }
  const l = plan.aiLimits;
  if (!l) {
    errors.push("AI limits are required.");
  } else {
    const check = (v: unknown, name: string) => {
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) {
        errors.push(`${name} must be a non-negative integer or null.`);
      }
    };
    check(l.chatPerDay, "chatPerDay");
    check(l.chatPerMonth, "chatPerMonth");
    check(l.imagePerDay, "imagePerDay");
    check(l.imagePerMonth, "imagePerMonth");
    if (l.chatPerDay == null && l.chatPerMonth == null) {
      errors.push("Chat usage needs at least one finite limit — unlimited AI cannot be promised on free-tier providers.");
    }
    if (l.imagePerDay == null && l.imagePerMonth == null) {
      errors.push("Image analysis needs at least one finite limit — unlimited AI cannot be promised on free-tier providers.");
    }
  }
  return { ok: errors.length === 0, errors };
}

export function formatPhp(amount: number | null | undefined): string {
  if (amount == null) return "Custom";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(amount);
}
