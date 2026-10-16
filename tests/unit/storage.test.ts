import { beforeEach, describe, expect, it, vi } from "vitest";

type Stored = Record<string, unknown>;

const fakes = vi.hoisted(() => ({
  documents: new Map<string, Stored>(),
}));

vi.mock("../../server/lib/env", () => ({
  env: (_name: string, fallback = "") => fallback,
}));

vi.mock("../../server/lib/firebaseAdmin", () => ({
  getDb: () => ({
    doc: (path: string) => ({
      create: vi.fn(async (value: Stored) => {
        if (fakes.documents.has(path)) throw Object.assign(new Error("already exists"), { code: 6 });
        fakes.documents.set(path, value);
      }),
      set: vi.fn(async (value: Stored) => {
        fakes.documents.set(path, value);
      }),
    }),
  }),
}));

import { storeReportImage } from "../../server/storage";

beforeEach(() => {
  fakes.documents.clear();
});

describe("report image storage", () => {
  it("does not let a late duplicate upload reset verified media to pending", async () => {
    fakes.documents.set("report_media/r1", {
      dataUrl: "data:image/jpeg;base64,old",
      reporterUid: "u1",
      status: "verified",
    });

    await expect(
      storeReportImage(
        "r1",
        { mime: "image/jpeg", base64: "/9j/", bytes: Buffer.from([0xff, 0xd8, 0xff]) },
        { reporterUid: "u1" },
      ),
    ).resolves.toEqual({ url: "inline:report_media/r1", storage: "inline" });

    expect(fakes.documents.get("report_media/r1")).toMatchObject({
      dataUrl: "data:image/jpeg;base64,old",
      status: "verified",
    });
  });
});
