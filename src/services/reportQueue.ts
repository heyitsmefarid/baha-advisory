import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";
import { api, ApiError } from "../lib/api";
import { idbDelete, idbGetAll, idbPut } from "../lib/idb";
import type { DepthLabel, LatLng } from "../../shared/types";

/**
 * Offline report drafts. A report submitted without connectivity is kept
 * in IndexedDB with a stable `clientDraftId`; syncing retries until the
 * server accepts it. The server de-duplicates by (reporter, clientDraftId),
 * so a retry after a dropped response can never create a second report.
 */
export interface ReportPayload {
  location: LatLng;
  locationSource: "gps" | "manual";
  locationAccuracyM: number | null;
  description: string;
  depthLabel: DepthLabel;
  roadName: string;
  roadBlocked: boolean;
  observedAtMs: number;
  image: string | null;
}

export interface ReportDraft {
  id: string;
  createdAt: number;
  payload: ReportPayload;
  state: "queued" | "failed";
  lastError?: string;
  attempts: number;
}

const listeners = new Set<() => void>();
export function onDraftsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const emit = () => listeners.forEach((fn) => fn());

export function newDraftId(): string {
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listDrafts(): Promise<ReportDraft[]> {
  try {
    return (await idbGetAll<ReportDraft>("report_drafts")).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function saveDraft(id: string, payload: ReportPayload, error?: string): Promise<void> {
  await idbPut("report_drafts", { id, createdAt: Date.now(), payload, state: "queued", lastError: error, attempts: 0 } satisfies ReportDraft);
  emit();
}

export async function deleteDraft(id: string): Promise<void> {
  await idbDelete("report_drafts", id);
  emit();
}

export interface SubmitResult {
  report: { id: string; status: string; area: string; photoStorage: string | null };
  analysis: {
    imageAnalyzed: boolean;
    floodVisible: boolean | null;
    waterLevelEstimate: string;
    severitySuggestion: string;
    roadObstruction: { present: boolean | null; types: string[] };
    hazards: string[];
    consistencyWithDescription: string;
    consistencyNotes: string;
    confidence: number;
    rationale: string;
    disclaimer: string;
  };
  duplicates: { id: string; distanceM: number; minutesApart: number }[];
  aiProvider: string | null;
  idempotent?: boolean;
}

async function ensureSession() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch {
      throw new ApiError("Sign-in is unavailable while offline.", 0, "auth_unavailable");
    }
  }
}

export async function submitReport(id: string, payload: ReportPayload): Promise<SubmitResult> {
  await ensureSession();
  return api<SubmitResult>("/reports", { body: { ...payload, clientDraftId: id }, timeoutMs: 90_000 });
}

/** Sends every queued draft; stops at the first connectivity failure. */
export async function flushDrafts(): Promise<{ sent: number; failed: number }> {
  const drafts = await listDrafts();
  let sent = 0;
  let failed = 0;
  for (const d of drafts) {
    if (d.state === "failed") continue;
    try {
      await submitReport(d.id, d.payload);
      await idbDelete("report_drafts", d.id);
      sent++;
    } catch (err) {
      if (err instanceof ApiError && (err.isNetwork || err.status >= 500 || err.status === 429)) break;
      await idbPut("report_drafts", { ...d, state: "failed", lastError: err instanceof Error ? err.message : "Rejected", attempts: d.attempts + 1 });
      failed++;
    }
  }
  if (sent || failed) emit();
  return { sent, failed };
}
