import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireOrgAdmin: vi.fn(),
  firestoreRateLimit: vi.fn(),
  audit: vi.fn(),
  notifyUser: vi.fn(),
  getUserByEmail: vi.fn(),
  setCustomUserClaims: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  generatePasswordResetLink: vi.fn(),
  orgGet: vi.fn(),
  memberGet: vi.fn(),
  memberSet: vi.fn(),
  userSet: vi.fn(),
}));

vi.mock("../../server/lib/auth", () => ({
  requireAuth: fakes.requireAuth,
  requireOrgAdmin: fakes.requireOrgAdmin,
  requireOrgMember: vi.fn(),
}));
vi.mock("../../server/lib/rateLimit", () => ({ firestoreRateLimit: fakes.firestoreRateLimit }));
vi.mock("../../server/lib/audit", () => ({ audit: fakes.audit }));
vi.mock("../../server/lib/alerts", () => ({ notifyUser: fakes.notifyUser }));
vi.mock("../../server/payments/processor", () => ({ recomputeOrgEntitlements: vi.fn() }));
vi.mock("../../server/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    getUserByEmail: fakes.getUserByEmail,
    setCustomUserClaims: fakes.setCustomUserClaims,
    revokeRefreshTokens: fakes.revokeRefreshTokens,
    generatePasswordResetLink: fakes.generatePasswordResetLink,
  }),
  getDb: () => ({
    doc: (path: string) => {
      if (path === "organizations/org_enterprise") return { get: fakes.orgGet };
      if (path === "organizations/org_enterprise/members/target") return { get: fakes.memberGet, set: fakes.memberSet };
      if (path === "users/target") return { set: fakes.userSet };
      throw new Error(`Unexpected document path: ${path}`);
    },
  }),
}));

import { inviteMember } from "../../server/handlers/orgs";

beforeEach(() => {
  vi.clearAllMocks();
  fakes.requireAuth.mockResolvedValue({
    uid: "business-admin",
    email: "admin@example.test",
    name: "Business Admin",
    anonymous: false,
    rawRole: "business_admin",
    role: "business_admin",
    orgId: "org_enterprise",
    assignedArea: null,
    areas: [],
    claims: { role: "business_admin", orgId: "org_enterprise" },
  });
  fakes.orgGet.mockResolvedValue({
    exists: true,
    id: "org_enterprise",
    data: () => ({
      name: "Enterprise Org",
      type: "enterprise",
      jurisdictionAreas: [],
      entitlements: { staffManagement: true },
    }),
  });
  fakes.memberGet.mockResolvedValue({ exists: true, get: (key: string) => (key === "role" ? "enterprise_admin" : null) });
  fakes.getUserByEmail.mockResolvedValue({
    uid: "target",
    customClaims: { role: "enterprise_admin", orgId: "org_enterprise" },
  });
});

describe("organization invitations", () => {
  it("cannot re-invite an existing administrator into a lower role", async () => {
    const req = new Request("https://api.example.test/api/orgs/org_enterprise/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "target@example.test", name: "Target Admin", role: "business_staff" }),
    });

    await expect(inviteMember(req, { params: { orgId: "org_enterprise" } } as never)).rejects.toMatchObject({
      status: 409,
      code: "already_member",
    });
    expect(fakes.memberSet).not.toHaveBeenCalled();
    expect(fakes.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
