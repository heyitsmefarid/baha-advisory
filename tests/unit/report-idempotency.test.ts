import { beforeEach, describe, expect, it, vi } from "vitest";

type Stored = Record<string, unknown>;

const fakes = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getGeneralSettings: vi.fn(),
  firestoreRateLimit: vi.fn(),
  memoryRateLimit: vi.fn(),
}));

const stored = new Map<string, Stored>();
let sequence = 0;
let duplicateReads = 0;
let releaseDuplicateReads: (() => void) | null = null;
let committedCreateFailures = 0;

function snapshot(id: string, value: Stored | undefined) {
  return {
    id,
    exists: Boolean(value),
    data: () => value,
    get: (key: string) => value?.[key],
  };
}

function document(id: string) {
  return {
    id,
    get: vi.fn(async () => snapshot(id, stored.get(id))),
    create: vi.fn(async (value: Stored) => {
      if (stored.has(id)) throw Object.assign(new Error("already exists"), { code: 6 });
      stored.set(id, value);
      if (committedCreateFailures > 0) {
        committedCreateFailures--;
        throw Object.assign(new Error("write committed but acknowledgement was lost"), { code: 4 });
      }
    }),
    set: vi.fn(async (value: Stored) => {
      stored.set(id, value);
    }),
    delete: vi.fn(async () => {
      stored.delete(id);
    }),
  };
}

function query(filters: Array<[string, unknown]> = []) {
  return {
    where(field: string, _op: string, value: unknown) {
      return query([...filters, [field, value]]);
    },
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    async get() {
      const isDraftLookup = filters.some(([field]) => field === "clientDraftId");
      if (isDraftLookup && duplicateReads < 2) {
        duplicateReads++;
        if (duplicateReads === 2) releaseDuplicateReads?.();
        else await new Promise<void>((resolve) => {
          releaseDuplicateReads = resolve;
        });
        return { empty: true, docs: [] };
      }
      if (filters.some(([field]) => field === "createdAt")) {
        const docs = [...stored.entries()]
          .filter(([, value]) => value.createdAt !== undefined)
          .map(([id, value]) => snapshot(id, value));
        return { empty: docs.length === 0, docs };
      }
      const docs = [...stored.entries()]
        .filter(([, value]) => filters.every(([field, expected]) => value[field] === expected))
        .map(([id, value]) => snapshot(id, value));
      return { empty: docs.length === 0, docs };
    },
  };
}

vi.mock("../../server/lib/auth", () => ({ requireAuth: fakes.requireAuth }));
vi.mock("../../server/lib/settings", () => ({ getGeneralSettings: fakes.getGeneralSettings }));
vi.mock("../../server/lib/rateLimit", () => ({
  firestoreRateLimit: fakes.firestoreRateLimit,
  memoryRateLimit: fakes.memoryRateLimit,
}));
vi.mock("../../server/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: (name: string) => {
      if (name !== "community_reports") throw new Error(`Unexpected collection: ${name}`);
      return {
        doc: (id?: string) => document(id ?? `r${++sequence}`),
        where: (field: string, op: string, value: unknown) => query().where(field, op, value),
      };
    },
  }),
}));
vi.mock("../../server/storage", () => ({ storeReportImage: vi.fn() }));
vi.mock("../../server/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("../../server/lib/alerts", () => ({ notifyUser: vi.fn(), publishAlert: vi.fn() }));
vi.mock("../../server/lib/hazards", () => ({ invalidateHazardCache: vi.fn(), zoneFromDoc: vi.fn() }));
vi.mock("../../server/ai/imageAnalysis", () => ({
  analyzeFloodImage: vi.fn(),
  notAnalyzed: (_reason: string, depthLabel: string) => ({
    imageAnalyzed: false,
    floodVisible: null,
    waterLevelEstimate: depthLabel,
    severitySuggestion: "unknown",
    roadObstruction: { present: null, types: [] },
    hazards: [],
    consistencyWithDescription: "not_analyzed",
    consistencyNotes: "",
    confidence: 0,
    rationale: "No image",
    disclaimer: "Not analyzed",
    imageQuality: "unknown",
  }),
}));

import { submitReport } from "../../server/handlers/reports";

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  sequence = 0;
  duplicateReads = 0;
  releaseDuplicateReads = null;
  committedCreateFailures = 0;
  fakes.requireAuth.mockResolvedValue({
    uid: "u1",
    name: "Reporter",
    anonymous: false,
    role: "citizen",
    orgId: null,
    claims: { role: "citizen" },
  });
  fakes.getGeneralSettings.mockResolvedValue({ publicReportingEnabled: true });
});

function request() {
  return new Request("https://api.example.test/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientDraftId: "stable_draft",
      location: { lat: 13.4, lng: 121.18 },
      locationSource: "gps",
      locationAccuracyM: 10,
      description: "Water at gutter level",
      depthLabel: "gutter",
      roadName: "Test Road",
      roadBlocked: false,
      observedAtMs: Date.now(),
      image: null,
    }),
  });
}

describe("report submission idempotency", () => {
  it("atomically converges concurrent submissions and later retries on one report", async () => {
    const outcomes = await Promise.allSettled([
      submitReport(request(), { ip: "127.0.0.1", params: {} } as never),
      submitReport(request(), { ip: "127.0.0.1", params: {} } as never),
    ]);
    const successes = await Promise.all(
      outcomes
        .filter((outcome): outcome is PromiseFulfilledResult<Response> => outcome.status === "fulfilled")
        .map((outcome) => outcome.value.json() as Promise<{ report: { id: string } }>),
    );
    const retryableFailures = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected" && outcome.reason?.status === 503,
    );

    expect(successes.length + retryableFailures.length).toBe(2);
    expect(new Set(successes.map((result) => result.report.id)).size).toBe(1);
    expect([...stored.values()].filter((value) => value.status === "pending")).toHaveLength(1);

    const retry = await submitReport(request(), { ip: "127.0.0.1", params: {} } as never);
    const retryBody = (await retry.json()) as { report: { id: string }; idempotent: boolean };
    expect(retryBody.report.id).toBe(successes[0].report.id);
    expect(retryBody.idempotent).toBe(true);
  });

  it("recovers an abandoned processing placeholder instead of stranding the draft", async () => {
    duplicateReads = 2;
    const reportId = "draft_bddb27e60f232a5c68460b23f4d3e0588c3b5189";
    stored.set(reportId, {
      reporterUid: "u1",
      clientDraftId: "stable_draft",
      idempotencyState: "processing",
    });

    const response = await submitReport(request(), { ip: "127.0.0.1", params: {} } as never);
    const body = (await response.json()) as { report: { id: string; status: string } };

    expect(response.status).toBe(201);
    expect(body.report).toMatchObject({ id: reportId, status: "pending" });
    expect(stored.get(reportId)?.idempotencyState).toBeUndefined();
  });

  it("returns the committed report when a retry follows a lost create acknowledgement", async () => {
    duplicateReads = 2;
    committedCreateFailures = 1;

    await expect(submitReport(request(), { ip: "127.0.0.1", params: {} } as never)).rejects.toMatchObject({ code: 4 });

    const retry = await submitReport(request(), { ip: "127.0.0.1", params: {} } as never);
    const body = (await retry.json()) as { report: { id: string; status: string }; idempotent: boolean };
    expect(retry.status).toBe(200);
    expect(body).toMatchObject({
      report: { id: "draft_bddb27e60f232a5c68460b23f4d3e0588c3b5189", status: "pending" },
      idempotent: true,
    });
  });

  it("reuses a completed legacy auto-id report", async () => {
    duplicateReads = 2;
    stored.set("legacy_report", {
      reporterUid: "u1",
      clientDraftId: "stable_draft",
      status: "pending",
    });

    const retry = await submitReport(request(), { ip: "127.0.0.1", params: {} } as never);
    const body = (await retry.json()) as { report: { id: string }; idempotent: boolean };
    expect(body).toMatchObject({ report: { id: "legacy_report" }, idempotent: true });
    expect(stored.size).toBe(1);
  });

  it("isolates the same client draft id between different reporters", async () => {
    fakes.requireAuth
      .mockResolvedValueOnce({ uid: "u1", name: "Reporter One", anonymous: false, role: "citizen", orgId: null, claims: { role: "citizen" } })
      .mockResolvedValueOnce({ uid: "u2", name: "Reporter Two", anonymous: false, role: "citizen", orgId: null, claims: { role: "citizen" } });

    const responses = await Promise.all([
      submitReport(request(), { ip: "127.0.0.1", params: {} } as never),
      submitReport(request(), { ip: "127.0.0.2", params: {} } as never),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ report: { id: string } }>));

    expect(new Set(bodies.map((body) => body.report.id)).size).toBe(2);
    expect([...stored.values()].filter((value) => value.status === "pending")).toHaveLength(2);
  });
});
