/// <reference types="vite/client" />

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  auth: { currentUser: { getIdToken: vi.fn() } } as { currentUser: { getIdToken: ReturnType<typeof vi.fn> } | null },
  fetch: vi.fn(),
  idbDelete: vi.fn(),
  idbGetAll: vi.fn(),
  idbPut: vi.fn(),
}));

vi.mock("../../src/firebase", () => ({
  auth: fakes.auth,
  API_BASE: "https://api.example.test/api",
}));
vi.mock("firebase/auth", () => ({ signInAnonymously: vi.fn() }));
vi.mock("../../src/lib/idb", () => ({
  idbDelete: fakes.idbDelete,
  idbGetAll: fakes.idbGetAll,
  idbPut: fakes.idbPut,
}));

import { ApiError } from "../../src/lib/api";
import { flushDrafts, submitReport, type ReportDraft, type ReportPayload } from "../../src/services/reportQueue";

const payload: ReportPayload = {
  location: { lat: 13.4, lng: 121.18 },
  locationSource: "gps",
  locationAccuracyM: 8,
  description: "Water at gutter level",
  depthLabel: "gutter",
  roadName: "Test Road",
  roadBlocked: false,
  observedAtMs: 1_700_000_000_000,
  image: null,
};

const draft = (id: string): ReportDraft => ({
  id,
  createdAt: 1_700_000_000_000,
  payload,
  state: "queued",
  attempts: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.currentUser = { getIdToken: vi.fn(async () => "token") };
  vi.stubGlobal("fetch", fakes.fetch);
});

describe("offline report queue", () => {
  it("sends the stable clientDraftId used for server idempotency", async () => {
    fakes.fetch.mockResolvedValue(new Response(JSON.stringify({ report: { id: "r1" } }), { status: 201 }));
    await submitReport("draft_stable", payload);
    const request = fakes.fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ clientDraftId: "draft_stable" });
  });

  it("stops on a network error without deleting or quarantining drafts", async () => {
    fakes.idbGetAll.mockResolvedValue([draft("d1"), draft("d2")]);
    fakes.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(flushDrafts()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fakes.fetch).toHaveBeenCalledTimes(1);
    expect(fakes.idbDelete).not.toHaveBeenCalled();
    expect(fakes.idbPut).not.toHaveBeenCalled();
  });

  it("keeps all drafts queued when Firebase token retrieval loses the network", async () => {
    fakes.idbGetAll.mockResolvedValue([draft("d1"), draft("d2")]);
    fakes.auth.currentUser = {
      getIdToken: vi.fn().mockRejectedValue(Object.assign(new Error("offline"), { code: "auth/network-request-failed" })),
    };
    await expect(flushDrafts()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fakes.auth.currentUser.getIdToken).toHaveBeenCalledTimes(1);
    expect(fakes.idbDelete).not.toHaveBeenCalled();
    expect(fakes.idbPut).not.toHaveBeenCalled();
  });

  it("keeps all drafts queued when reading the response body loses the network", async () => {
    fakes.idbGetAll.mockResolvedValue([draft("d1"), draft("d2")]);
    fakes.fetch.mockResolvedValue({ text: vi.fn().mockRejectedValue(new TypeError("socket closed")) });
    await expect(flushDrafts()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fakes.fetch).toHaveBeenCalledTimes(1);
    expect(fakes.idbDelete).not.toHaveBeenCalled();
    expect(fakes.idbPut).not.toHaveBeenCalled();
  });

  it("quarantines a permanent rejection and continues with later drafts", async () => {
    fakes.idbGetAll.mockResolvedValue([draft("d1"), draft("d2")]);
    fakes.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "invalid", code: "validation_error" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ report: { id: "r2" } }), { status: 201 }));
    await expect(flushDrafts()).resolves.toEqual({ sent: 1, failed: 1 });
    expect(fakes.idbPut).toHaveBeenCalledWith(
      "report_drafts",
      expect.objectContaining({ id: "d1", state: "failed", attempts: 1 }),
    );
    expect(fakes.idbDelete).toHaveBeenCalledWith("report_drafts", "d2");
  });
});
