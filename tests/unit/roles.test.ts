import { describe, expect, it } from "vitest";
import { canManageArea, hasAllAreaAccess } from "../../shared/roles";

describe("legacy role isolation", () => {
  it("does not treat a legacy admin as island-wide", () => {
    const claims = { role: "admin", assignedArea: "Calapan City", areas: [] };
    expect(hasAllAreaAccess(claims)).toBe(false);
    expect(canManageArea(claims, "Calapan City")).toBe(true);
    expect(canManageArea(claims, "Mamburao")).toBe(false);
  });

  it("retains island-wide access only for the platform super admin", () => {
    expect(hasAllAreaAccess({ role: "super_admin" })).toBe(true);
  });
});
