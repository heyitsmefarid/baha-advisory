# Bahadvisory Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce fresh verification evidence for the current Bahadvisory working tree and resolve the two high-risk defects found during planning: malformed PayMongo signatures and unusable routing-provider candidates.

**Architecture:** Keep the existing frontend, backend, payment, routing, and offline boundaries intact. Add focused regression or characterization coverage at those boundaries, make minimal fixes inside the owning modules, then verify the production build and local web/API runtime. Record results separately from historical emulator evidence.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Vitest 2, Firebase client/Admin SDKs, Playwright Core, Node.js 24, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-14-stabilization-design.md`

## Global Constraints

- Preserve the current working tree. Existing changes are authoritative and must not be reverted or overwritten.
- Use the tools already installed on the machine.
- Do not install Java or claim Firebase emulator verification in this pass.
- Do not use real external-service credentials or exercise live payments, AI, push notifications, or deployment platforms.
- Avoid new features, broad refactors, and cosmetic cleanup unrelated to a demonstrated defect.
- Do not commit source or test files that were already untracked before this plan; committing them would silently absorb the pre-existing change set. Use explicit verification checkpoints and leave the stabilized product diff for the user to review and commit as one coherent change.

## Review Focus

- A same-length but non-hex PayMongo signature must be rejected as an invalid signature, never throw and become an HTTP 500 (Task 2).
- Empty, non-finite, or out-of-range routing candidates must never be recommended as safe; the planner must try the next provider or fail honestly (Task 3).
- Missing, unknown, legacy, cross-organization, and non-admin role claims must resolve to least privilege at backend authorization boundaries (Task 4).
- Offline retries must preserve the stable `clientDraftId`, stop without deleting drafts on connectivity failures, and quarantine permanent rejections while continuing later drafts (Task 5).
- Missing Java must cause emulator-dependent checks to be reported as blocked, while the public app and `/api/health` remain independently smoke-tested (Tasks 1 and 6).

## File Map

- `docs/superpowers/reviews/2026-10-14-stabilization-review.md`: fresh environment, test, risk-review, and blocker evidence.
- `server/payments/paymongo.ts`: constant-time signature comparison with strict hexadecimal validation.
- `tests/unit/billing.test.ts`: malformed-signature regression coverage.
- `shared/routing/planner.ts`: provider-agnostic route-candidate validation and fallback.
- `tests/unit/routing.test.ts`: empty and malformed provider-response regression coverage.
- `tests/unit/authorization.test.ts`: role normalization, jurisdiction, organization membership, and admin-boundary characterization.
- `tests/unit/report-queue.test.ts`: stable draft identity and retry/failure semantics with mocked storage and API boundaries.
- `docs/STATUS.md`: current verification results separated from checks blocked by the missing Java runtime.

---

### Task 1: Capture the Baseline and Verification Blockers

**Files:**
- Create: `docs/superpowers/reviews/2026-10-14-stabilization-review.md`
- Reference: `docs/STATUS.md`
- Reference: `package.json`

**Interfaces:**
- Consumes: package scripts `typecheck`, `test`, `build`, `test:emulator`, `test:e2e`, and `test:e2e:offline`.
- Produces: one evidence log used by every later task and by the final status update.

- [ ] **Step 1: Confirm the working-tree boundary before touching product files**

Run:

```powershell
git status --short --branch
git log -3 --oneline --decorate
```

Expected: branch `main` is ahead of `origin/main`; the large pre-existing source change set remains present; commits `b0554ba` and `a9744d2` are visible.

- [ ] **Step 2: Reconfirm local capabilities without printing secrets**

Run:

```powershell
node --version
npm --version
java -version
@(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
) | Where-Object { Test-Path $_ }
```

Expected: Node and npm print versions; `java` is not found; at least Chrome or Edge is present for local browser checks.

- [ ] **Step 3: Create the evidence log with the planning baseline**

Create the file with this content:

```markdown
# Bahadvisory Stabilization Review

**Date:** 2026-10-14
**Scope:** Current working tree; no Java installation and no live external credentials.

## Environment

| Capability | Result |
|---|---|
| Node.js / npm | Available |
| Chrome or Edge | Available |
| Java runtime | Blocked: command not found |
| Firebase emulator checks | Blocked by missing Java |
| Live payment, AI, push, and deployment checks | Out of scope: credentials/platform accounts unavailable |

## Baseline

| Check | Result |
|---|---|
| `npm run typecheck` | Passed during planning reconnaissance |
| `npm test` | Passed during planning reconnaissance: 71/71 |
| Local app `/` | HTTP 200 during planning reconnaissance |

## Findings

| ID | Severity | Area | Disposition |
|---|---|---|---|
| PAY-01 | High | PayMongo signature parsing | Open: non-hex text can reach `timingSafeEqual` with unequal decoded buffers |
| ROUTE-01 | High | Route-provider trust boundary | Open: empty or malformed candidates are not rejected before safety evaluation |
| AUTH-01 | Review | Role and tenant authorization | Characterization coverage pending |
| OFFLINE-01 | Review | Offline report retry semantics | Characterization coverage pending |

## Final Verification

Final results are added only after Tasks 2-6 complete.
```

- [ ] **Step 4: Re-run the cheap baseline gates**

Run:

```powershell
npm run typecheck
npm test
```

Expected: both commands exit 0; Vitest reports 6 files and 71 tests passing before new coverage is added.

- [ ] **Step 5: Commit only the new review artifact**

Run:

```powershell
git add -- docs/superpowers/reviews/2026-10-14-stabilization-review.md
git commit --only -m "Docs: Start stabilization review" -- docs/superpowers/reviews/2026-10-14-stabilization-review.md
git show --name-status --format= HEAD
```

Expected: the commit contains only the review file; the pre-existing staged and unstaged files remain unchanged.

---

### Task 2: Reject Malformed PayMongo Signatures Safely

**Files:**
- Modify: `tests/unit/billing.test.ts`
- Modify: `server/payments/paymongo.ts`
- Modify: `docs/superpowers/reviews/2026-10-14-stabilization-review.md`

**Interfaces:**
- Consumes: `PaymentProvider.verifyWebhook(rawBody: string, headers: Headers): WebhookVerification`.
- Produces: `safeEqualHex(a: string, b: string): boolean` that returns `false` for empty, non-hex, odd-length, or unequal decoded inputs without throwing.

- [ ] **Step 1: Add the malformed-signature regression test**

Append inside `describe("PayMongo webhook verification", ...)`:

```typescript
it("rejects same-length non-hex signatures without throwing", () => {
  const raw = body();
  const t = String(Math.floor(Date.now() / 1000));
  const malformed = new Headers({
    "paymongo-signature": `t=${t},te=${"z".repeat(64)},li=${"0".repeat(64)}`,
  });

  expect(() => provider.verifyWebhook(raw, malformed)).not.toThrow();
  expect(provider.verifyWebhook(raw, malformed)).toMatchObject({
    valid: false,
    reason: "signature mismatch",
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the defect**

Run:

```powershell
npx vitest run tests/unit/billing.test.ts -t "same-length non-hex"
```

Expected before the fix: FAIL because `timingSafeEqual` receives decoded buffers of different lengths.

- [ ] **Step 3: Make hexadecimal comparison total and non-throwing**

Replace `safeEqualHex` in `server/payments/paymongo.ts` with:

```typescript
function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length || a.length % 2 !== 0) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
```

- [ ] **Step 4: Verify the focused and complete billing tests**

Run:

```powershell
npx vitest run tests/unit/billing.test.ts -t "same-length non-hex"
npx vitest run tests/unit/billing.test.ts
```

Expected: the regression passes; all 21 billing tests pass.

- [ ] **Step 5: Record the resolved finding without committing the pre-existing untracked payment files**

Update `PAY-01` in the review log to `Resolved: strict hex validation added; 21/21 billing tests pass`. Run:

```powershell
git status --short -- server/payments/paymongo.ts tests/unit/billing.test.ts docs/superpowers/reviews/2026-10-14-stabilization-review.md
```

Expected: the payment source and test remain part of the pre-existing untracked change set; do not commit them separately.

---

### Task 3: Reject Unusable Route Candidates Before Safety Evaluation

**Files:**
- Modify: `tests/unit/routing.test.ts`
- Modify: `shared/routing/planner.ts`
- Modify: `docs/superpowers/reviews/2026-10-14-stabilization-review.md`

**Interfaces:**
- Consumes: `RoutingProvider.route(...): Promise<RouteCandidate[]>`.
- Produces: provider fallback when a provider returns no usable candidates; no invalid candidate reaches `evaluateRoute`.

- [ ] **Step 1: Add empty and malformed provider regression tests**

Append inside `describe("planSafeRoute", ...)`:

```typescript
it("falls back when a provider returns no candidates", async () => {
  const empty: RoutingProvider = { name: "empty", route: async () => [] };
  const plan = await planSafeRoute(
    { origin: ORIGIN, destination: DEST, mode: "car" },
    [],
    [empty, straightLineProvider()],
  );
  expect(plan.provider).toBe("fake");
  expect(plan.status).toBe("safe");
});

it("falls back instead of recommending malformed geometry", async () => {
  const malformed: RoutingProvider = {
    name: "malformed",
    route: async () => [{
      provider: "malformed",
      geometry: [[Number.NaN, 121.15]],
      distanceM: Number.NaN,
      durationS: -1,
      via: [],
      steps: [],
    }],
  };
  const plan = await planSafeRoute(
    { origin: ORIGIN, destination: DEST, mode: "car" },
    [],
    [malformed, straightLineProvider()],
  );
  expect(plan.provider).toBe("fake");
  expect(plan.recommended?.geometry.length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run both focused tests and confirm the trust-boundary failures**

Run:

```powershell
npx vitest run tests/unit/routing.test.ts -t "falls back when|malformed geometry"
```

Expected before the fix: at least one test fails because `tryProviders` accepts the first provider's unusable response.

- [ ] **Step 3: Add provider-agnostic candidate validation**

Add above `tryProviders` in `shared/routing/planner.ts`:

```typescript
function isFinitePoint(point: Pt): boolean {
  const [lat, lng] = point;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isUsableCandidate(candidate: RouteCandidate): boolean {
  return (
    Array.isArray(candidate.geometry) &&
    candidate.geometry.length >= 2 &&
    candidate.geometry.every(isFinitePoint) &&
    Number.isFinite(candidate.distanceM) &&
    candidate.distanceM >= 0 &&
    Number.isFinite(candidate.durationS) &&
    candidate.durationS >= 0 &&
    Array.isArray(candidate.steps) &&
    Array.isArray(candidate.via)
  );
}
```

After `p.route(...)` returns inside `tryProviders`, filter and reject the provider response before setting `counter.used`:

```typescript
const usable = res.filter(isUsableCandidate);
if (!usable.length) throw new Error(`${p.name}: no usable route candidates`);
counter.used = p.name;
return usable.map((candidate) => scale(candidate, factor));
```

- [ ] **Step 4: Verify focused and complete routing behavior**

Run:

```powershell
npx vitest run tests/unit/routing.test.ts -t "falls back when|malformed geometry"
npx vitest run tests/unit/routing.test.ts
```

Expected: both regressions pass; all 21 routing tests pass.

- [ ] **Step 5: Record the resolved finding without committing the pre-existing untracked routing files**

Update `ROUTE-01` in the review log to `Resolved: unusable candidates are filtered and provider fallback is verified; 21/21 routing tests pass`. Confirm scope:

```powershell
git status --short -- shared/routing/planner.ts tests/unit/routing.test.ts docs/superpowers/reviews/2026-10-14-stabilization-review.md
```

Expected: only the intended routing, test, and review paths are involved in this task.

---

### Task 4: Pin Least-Privilege Authorization Semantics

**Files:**
- Create: `tests/unit/authorization.test.ts`
- Reference: `shared/roles.ts`
- Reference: `server/lib/auth.ts`
- Modify: `docs/superpowers/reviews/2026-10-14-stabilization-review.md`

**Interfaces:**
- Consumes: `normalizeRole`, `canManageArea`, `canAssignRole`, `requireOrgMember`, and `requireOrgAdmin`.
- Produces: executable characterization of the no-emulator authorization boundary.

- [ ] **Step 1: Create the authorization characterization suite**

Create `tests/unit/authorization.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the new characterization suite**

Run:

```powershell
npx vitest run tests/unit/authorization.test.ts
```

Expected: 5/5 tests pass. Any failure is a product defect; stop and use `superpowers:systematic-debugging` before changing authorization code.

- [ ] **Step 3: Inspect enforcement alignment across the client, backend, and rules**

Run:

```powershell
rg -n "RequireAuth|RequireRole|RequireFeature|roles=" src/App.tsx src/components/RouteGuards.tsx
rg -n "requireOrgMember|requireOrgAdmin|requireSuperAdmin|canManageArea|audit\(" server/handlers
rg -n "function (hasRole|ownsArea|orgMember|orgAdmin)|allow (create|update|delete)" firestore.rules
```

Expected: client guards control navigation only; privileged handlers independently enforce roles, organization membership, or area ownership; Firestore writes use matching role/organization/area predicates. Record any mismatch as a finding and use `superpowers:systematic-debugging` before changing enforcement code.

- [ ] **Step 4: Record the reviewed boundary**

Update `AUTH-01` in the review log to `No defect found: 5/5 least-privilege characterization tests pass; emulator-backed rules remain blocked by missing Java`.

- [ ] **Step 5: Run type-check and the authorization suite together**

Run:

```powershell
npm run typecheck
npx vitest run tests/unit/authorization.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 6: Preserve the test as an uncommitted part of the stabilization set**

Run:

```powershell
git status --short -- tests/unit/authorization.test.ts docs/superpowers/reviews/2026-10-14-stabilization-review.md
```

Expected: the new test and updated review log are visible; do not create a product commit while their imported implementation remains in the pre-existing untracked set.

---

### Task 5: Pin Offline Draft Retry and Idempotency Semantics

**Files:**
- Create: `tests/unit/report-queue.test.ts`
- Reference: `src/services/reportQueue.ts`
- Reference: `src/lib/idb.ts`
- Reference: `src/lib/api.ts`
- Modify: `docs/superpowers/reviews/2026-10-14-stabilization-review.md`

**Interfaces:**
- Consumes: `submitReport(id, payload)` and `flushDrafts()`.
- Produces: mocked boundary coverage proving stable draft identity and non-destructive retry behavior.

- [ ] **Step 1: Create deterministic queue-boundary mocks and tests**

Create `tests/unit/report-queue.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  api: vi.fn(),
  idbDelete: vi.fn(),
  idbGetAll: vi.fn(),
  idbPut: vi.fn(),
}));

vi.mock("../../src/firebase", () => ({
  auth: { currentUser: { getIdToken: vi.fn(async () => "token") } },
}));
vi.mock("firebase/auth", () => ({ signInAnonymously: vi.fn() }));
vi.mock("../../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...actual, api: fakes.api };
});
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
});

describe("offline report queue", () => {
  it("sends the stable clientDraftId used for server idempotency", async () => {
    fakes.api.mockResolvedValue({ report: { id: "r1" } });
    await submitReport("draft_stable", payload);
    expect(fakes.api).toHaveBeenCalledWith(
      "/reports",
      expect.objectContaining({ body: expect.objectContaining({ clientDraftId: "draft_stable" }) }),
    );
  });

  it("stops on a network error without deleting or quarantining drafts", async () => {
    fakes.idbGetAll.mockResolvedValue([draft("d1"), draft("d2")]);
    fakes.api.mockRejectedValue(new ApiError("offline", 0, "offline"));
    await expect(flushDrafts()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fakes.api).toHaveBeenCalledTimes(1);
    expect(fakes.idbDelete).not.toHaveBeenCalled();
    expect(fakes.idbPut).not.toHaveBeenCalled();
  });

  it("quarantines a permanent rejection and continues with later drafts", async () => {
    fakes.idbGetAll.mockResolvedValue([draft("d1"), draft("d2")]);
    fakes.api
      .mockRejectedValueOnce(new ApiError("invalid", 400, "validation_error"))
      .mockResolvedValueOnce({ report: { id: "r2" } });
    await expect(flushDrafts()).resolves.toEqual({ sent: 1, failed: 1 });
    expect(fakes.idbPut).toHaveBeenCalledWith(
      "report_drafts",
      expect.objectContaining({ id: "d1", state: "failed", attempts: 1 }),
    );
    expect(fakes.idbDelete).toHaveBeenCalledWith("report_drafts", "d2");
  });
});
```

- [ ] **Step 2: Run the queue characterization suite**

Run:

```powershell
npx vitest run tests/unit/report-queue.test.ts
```

Expected: 3/3 tests pass. Any failure is a product defect; stop and use `superpowers:systematic-debugging` before changing queue code.

- [ ] **Step 3: Record the reviewed offline boundary**

Update `OFFLINE-01` in the review log to `No defect found: stable draft IDs and retry/quarantine behavior pass 3/3 mocked boundary tests; browser reconnect flow remains emulator-blocked`.

- [ ] **Step 4: Run the full unit suite with all added coverage**

Run:

```powershell
npm test
```

Expected: 8 test files and 82 tests pass.

- [ ] **Step 5: Preserve the test as part of the uncommitted stabilization set**

Run:

```powershell
git status --short -- tests/unit/report-queue.test.ts docs/superpowers/reviews/2026-10-14-stabilization-review.md
```

Expected: the queue test and review update are visible; no unrelated path changes.

---

### Task 6: Run Production Gates, Smoke-Test the Runtime, and Publish Fresh Status

**Files:**
- Modify: `docs/superpowers/reviews/2026-10-14-stabilization-review.md`
- Modify: `docs/STATUS.md`
- Reference: `package.json`
- Reference: `server/handlers/system.ts`

**Interfaces:**
- Consumes: the complete no-Java test set and `GET /api/health`.
- Produces: current, reproducible verification status that does not conflate blocked checks with passing checks.

- [ ] **Step 1: Run the final static, unit, and production-build gates**

Run:

```powershell
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0; Vitest reports 8 files and 82 tests passing; Vite writes the production build and service-worker precache without errors.

- [ ] **Step 2: Start a clean smoke-test server on a separate port**

Run in a persistent terminal session:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174
```

Expected: Vite reports `http://127.0.0.1:5174/` ready with no compiler error.

- [ ] **Step 3: Verify the web shell and API health independently of Firebase**

Run:

```powershell
$app = Invoke-WebRequest -Uri 'http://127.0.0.1:5174/' -UseBasicParsing -TimeoutSec 10
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/api/health' -TimeoutSec 10
[pscustomobject]@{
  AppStatus = $app.StatusCode
  HasRoot = $app.Content -match 'id="root"'
  ApiOk = $health.ok
  Service = $health.service
} | Format-List
```

Expected: `AppStatus` is `200`, `HasRoot` is `True`, `ApiOk` is `True`, and `Service` is `bahadvisory-api`.

- [ ] **Step 4: Record emulator-dependent flows as blocked rather than failed or passed**

Do not run `npm run test:emulator`, `npm run test:e2e`, or `npm run test:e2e:offline`: their documented prerequisites include the Firebase emulators and seeded emulator data. Add these exact rows to the final verification table in the review log:

```markdown
| `npm run test:emulator` | Blocked: Java runtime is not installed |
| `npm run test:e2e` | Blocked: requires seeded Firebase Auth/Firestore emulators |
| `npm run test:e2e:offline` | Blocked: requires seeded Firebase Auth/Firestore emulators |
```

- [ ] **Step 5: Update current status without erasing historical evidence**

In `docs/STATUS.md`:

1. Change `Last updated` to `2026-10-14`.
2. Rename the verification table heading to `Current verification results (2026-10-14)`.
3. Record `typecheck`, `npm test` (82/82), `npm run build`, and the local `/` plus `/api/health` smoke test as passing.
4. Mark emulator, demo E2E, and offline E2E rows as `Not rerun: blocked by missing Java`.
5. Add one sentence below the table: `The 2026-10-10 emulator and E2E results remain historical evidence; they are not represented as current verification.`

- [ ] **Step 6: Complete the review log and run a documentation consistency check**

Add final results, mark `PAY-01` and `ROUTE-01` resolved, preserve the explicit Java blocker, and run:

```powershell
rg -n "82 / 82|82/82|missing Java|blocked|PAY-01|ROUTE-01" docs/STATUS.md docs/superpowers/reviews/2026-10-14-stabilization-review.md
$banned = @('T' + 'BD', 'implement ' + 'later', 'fill in ' + 'details')
Select-String -Path docs/STATUS.md,docs/superpowers/reviews/2026-10-14-stabilization-review.md -Pattern $banned
```

Expected: the first command finds the fresh results and both resolved findings; the second command prints no matches.

- [ ] **Step 7: Inspect the final scope and hand the coherent product diff to the user**

Run:

```powershell
git status --short --branch
git diff --check
git diff -- docs/STATUS.md docs/superpowers/reviews/2026-10-14-stabilization-review.md
```

Expected: no whitespace errors; no unrelated file was modified by the stabilization pass. Do not make a broad commit automatically because the implementation and tests live inside the user's pre-existing uncommitted expansion. Report the exact changed paths and verification outputs for user review.
