import type { ReportStatus, SeveritySuggestion, AlertSeverity, EvacuationStatus, IncidentStatus, SubscriptionStatus } from "../../shared/types";

type Tone = "neutral" | "info" | "safe" | "caution" | "danger" | "closed" | "tide";

export const REPORT_STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting DRRM review", tone: "caution" },
  verified: { label: "Verified by DRRM", tone: "safe" },
  rejected: { label: "Not verified", tone: "neutral" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  needs_info: { label: "More info requested", tone: "info" },
};

export const SEVERITY_SUGGESTION: Record<SeveritySuggestion, { label: string; tone: Tone }> = {
  none: { label: "No flooding seen", tone: "safe" },
  low: { label: "Low", tone: "safe" },
  moderate: { label: "Moderate", tone: "caution" },
  high: { label: "High", tone: "danger" },
  severe: { label: "Severe", tone: "closed" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export const ALERT_SEVERITY: Record<AlertSeverity, { label: string; tone: Tone }> = {
  info: { label: "Info", tone: "info" },
  moderate: { label: "Moderate", tone: "caution" },
  high: { label: "High", tone: "danger" },
  critical: { label: "Critical", tone: "closed" },
};

export const EVAC_STATUS: Record<EvacuationStatus, { label: string; tone: Tone; color: string }> = {
  open: { label: "Open", tone: "safe", color: "#1f9d55" },
  standby: { label: "On standby", tone: "info", color: "#0e7490" },
  full: { label: "Full", tone: "danger", color: "#d64545" },
  closed: { label: "Closed", tone: "neutral", color: "#7d90a6" },
};

export const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "danger" },
  responding: { label: "Responding", tone: "caution" },
  monitoring: { label: "Monitoring", tone: "info" },
  resolved: { label: "Resolved", tone: "safe" },
};

export const SUB_STATUS: Record<SubscriptionStatus | "none", { label: string; tone: Tone }> = {
  pending: { label: "Pending payment", tone: "caution" },
  active: { label: "Active", tone: "safe" },
  past_due: { label: "Past due (grace period)", tone: "caution" },
  canceled: { label: "Canceled", tone: "neutral" },
  expired: { label: "Expired", tone: "danger" },
  none: { label: "No subscription", tone: "neutral" },
};
