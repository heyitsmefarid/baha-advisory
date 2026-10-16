import { describe, expect, it } from "vitest";
import { canAssignRole, canManageArea, normalizeRole } from "../../shared/roles";
import { requireOrgAdmin, requireOrgMember, type AuthCtx } from "../../server/lib/auth";

function auth(overrides: Partial<AuthCtx> = {}): AuthCtx {
  return {
    uid: "u1",
    email: "u1@example.test",
    name: "Test User",
    anonymous: false,
    rawRole: null,
    role: "citizen",
    orgId: null,
    assignedArea: null,
    areas: [],
    claims: {},
    ...overrides,
  };
}

function expectForbidden(run: () => void): void {
  try {
    run();
    throw new Error("Expected authorization to be rejected");
  } catch (error) {
    expect(error).toMatchObject({ status: 403 });
  }
}

describe("least-privilege role normalization", () => {
  it("maps missing and unknown claims to citizen", () => {
    expect(normalizeRole(undefined)).toBe("citizen");
    expect(normalizeRole("root")).toBe("citizen");
  });

  it("preserves legacy roles without widening staff jurisdiction", () => {
    expect(normalizeRole("drrm_editor")).toBe("lgu_staff");
    expect(normalizeRole("admin")).toBe("lgu_admin");
    expect(canManageArea({ role: "drrm_editor", assignedArea: "Baco" }, "Baco")).toBe(true);
    expect(canManageArea({ role: "drrm_editor", assignedArea: "Baco" }, "Naujan")).toBe(false);
    expect(canManageArea({ role: "admin" }, "Naujan")).toBe(true);
  });
});

describe("organization authorization", () => {
  it("rejects a member of another organization but allows a super admin", () => {
    expectForbidden(() => requireOrgMember(auth({ role: "business_staff", orgId: "org_a" }), "org_b"));
    expect(() => requireOrgMember(auth({ role: "super_admin" }), "org_b")).not.toThrow();
  });

  it("rejects missing, unknown, and citizen roles even when the organization claim matches", () => {
    for (const rawRole of [null, "root", "citizen"] as const) {
      expectForbidden(() =>
        requireOrgMember(
          auth({ rawRole, role: normalizeRole(rawRole), orgId: "org_a", claims: { role: rawRole, orgId: "org_a" } }),
          "org_a",
        ),
      );
    }
  });

  it("requires both matching membership and an administrator role", () => {
    expect(() => requireOrgAdmin(auth({ role: "business_admin", orgId: "org_a" }), "org_a")).not.toThrow();
    expectForbidden(() => requireOrgAdmin(auth({ role: "business_staff", orgId: "org_a" }), "org_a"));
    expectForbidden(() => requireOrgAdmin(auth({ role: "business_admin", orgId: "org_b" }), "org_a"));
  });

  it("does not let organization admins assign roles from another segment", () => {
    expect(canAssignRole("business_admin", "business_staff")).toBe(true);
    expect(canAssignRole("business_admin", "lgu_staff")).toBe(false);
    expect(canAssignRole("lgu_admin", "business_admin")).toBe(false);
  });
});
