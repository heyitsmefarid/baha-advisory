import { beforeAll, describe, expect, it } from "vitest";
import { call, configureEnv, resetEmulators } from "./helpers";

configureEnv();

beforeAll(async () => {
  await resetEmulators();
  const { getDb } = await import("../../server/lib/firebaseAdmin");
  const db = getDb();
  const geography = {
    regionPsgcCode: "1700000000",
    provincePsgcCode: "1705200000",
    municipalityPsgcCode: "1705205000",
    barangayPsgcCode: null,
  };
  await db.doc("floodZones/overview-zone").set({
    ...geography,
    status: "active",
    area: "City of Calapan",
    updatedAt: new Date(),
  });
  await db.doc("community_reports/overview-report").set({
    ...geography,
    status: "verified",
    reporterUid: "private-user-id",
    area: "City of Calapan",
    verifiedAt: new Date(),
  });
});

describe("geographic overview", () => {
  it("returns public aggregates without private fields", async () => {
    const response = await call<{ municipalities: unknown[]; counts: { floodZones: number; verifiedReports: number } }>(
      "GET",
      "/api/geography/overview?province=1705200000",
    );
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("municipalities");
    expect(response.body.counts).toMatchObject({ floodZones: 1, verifiedReports: 1 });
    expect(JSON.stringify(response.body)).not.toContain("reporterUid");
    expect(JSON.stringify(response.body)).not.toContain("private-user-id");
  });

  it("rejects mismatched scope parameters", async () => {
    const response = await call("GET", "/api/geography/overview?province=1705100000&municipality=1705205000");
    expect(response.status).toBe(400);
  });
});
