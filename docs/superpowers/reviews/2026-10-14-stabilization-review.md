# Bahadvisory Stabilization Review

**Date:** 2026-10-14
**Scope:** Current working tree; local emulators and browser flows, with no live external credentials.

## Environment

| Capability | Result |
|---|---|
| Node.js / npm | Available |
| Chrome or Edge | Available |
| Java runtime | Available through Android Studio's bundled JBR; not on the global `PATH` |
| Firebase emulator checks | Available through the already running local Auth and Firestore emulators |
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
| PAY-01 | High | PayMongo signature parsing | Resolved: strict hex validation added; 21/21 billing tests pass |
| ROUTE-01 | High | Route-provider trust boundary | Resolved: unusable candidates are filtered and provider fallback is verified; 21/21 routing tests pass |
| AUTH-01 | Review | Role and tenant authorization | No defect found: 6/6 least-privilege characterization tests and the 38-test emulator rules suite pass; client guards are UX-only, privileged handlers enforce server authorization and audit mutations, and Firestore rules apply matching organization/area predicates |
| OFFLINE-01 | Review | Offline report retry semantics | No defect found: stable draft IDs and retry/quarantine behavior pass 5/5 mocked boundary tests, and the production-build reconnect flow passes 7/7 browser checks |
| BUILD-01 | Medium | Test TypeScript environment | Resolved: the queue boundary test now declares its Vite ambient types locally, so the server TypeScript project can follow the test's client import without losing `ImportMeta.env` types |
| REPORT-01 | High | Concurrent report idempotency | Resolved: a deterministic report ID plus final atomic creation converges simultaneous retries without a lease that can strand drafts; acknowledgement loss, abandoned placeholders, legacy IDs, reporter isolation, and late duplicate media writes are covered by focused tests |

## Final Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed: 93/93 |
| `npm run build` | Passed; the existing Firebase chunk-size warning remains documented |
| Local app `/` | Passed: HTTP 200 with the root mount present |
| Local API `/api/health` | Passed: `ok: true`, service `bahadvisory-api` |
| `npm run test:emulator:attached` | Passed: 57/57 rules and integration tests |
| `npm run test:e2e` | Passed: 13/13 browser demo steps |
| `npm run test:e2e:offline` | Passed: 7/7 production-build offline checks |

The emulator suites reused the running local Auth and Firestore emulators;
Android Studio's bundled JBR supplied Java without changing the machine-wide
`PATH`.
