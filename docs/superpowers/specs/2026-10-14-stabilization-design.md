# Bahadvisory Stabilization Design

**Date:** 2026-10-14  
**Status:** Approved for implementation planning

## Purpose

Stabilize the current broad Bahadvisory change set before adding product scope.
The pass will produce fresh evidence that the application builds, its available
automated checks pass, its main local flows run, and its highest-risk trust
boundaries do not contain unresolved critical or high-severity defects.

## Constraints

- Preserve the current working tree. Existing changes are authoritative and
  must not be reverted or overwritten.
- Use the tools already installed on the machine.
- Do not install Java or claim Firebase emulator verification in this pass.
- Do not use real external-service credentials or exercise live payments, AI,
  push notifications, or deployment platforms.
- Avoid new features, broad refactors, and cosmetic cleanup unrelated to a
  demonstrated defect.

## Approach

Use an evidence-first stabilization sequence:

1. Capture the working-tree state, change surface, configuration assumptions,
   and risk map.
2. Run the available checks from cheapest to most diagnostic.
3. Classify failures as environment, test, or product defects.
4. Reproduce product defects with a focused test when practical, make the
   narrowest safe fix, run the focused check, and then rerun the broader suite.
5. Review high-risk paths that automated checks may not cover.
6. Record only freshly verified results and explicit blockers.

This sequence is preferred over review-first or UI-first work because the
change set spans the frontend, backend, rules, offline support, payments, and
routing. Broad checks provide the fastest reliable signal about where deeper
inspection is warranted.

## Verification Sequence

Run checks in this order, stopping to diagnose unexpected failures:

1. Environment and configuration sanity checks that do not reveal secrets.
2. TypeScript checks for the client and server projects.
3. Unit tests.
4. Production build, including service-worker generation.
5. Development-server and API HTTP smoke checks.
6. End-to-end and offline-PWA flows that can run without the Firebase
   emulators.
7. Targeted reruns after fixes, followed by the full available suite.

Firebase Auth/Firestore emulator tests are excluded because Java is missing.
That exclusion is a documented verification blocker, not a passing result.

## Defect Handling

Each failure is assigned one category:

- **Environment:** the code cannot be meaningfully evaluated because a required
  local capability or external credential is unavailable. Record the exact
  blocker and continue with independent checks.
- **Test defect:** the test or fixture is stale, nondeterministic, or asserts the
  wrong contract. Correct it only after confirming the intended behavior from
  code and documentation.
- **Product defect:** the implementation violates an intended contract. Add or
  sharpen a failing regression test when practical, then apply a focused fix.

Fixes should retain existing module boundaries. Structural changes are allowed
only when necessary to correct a demonstrated defect and when a smaller change
would leave the failure mode intact.

## Risk Review

After automated checks, inspect the following trust boundaries:

- role, organization, and tenant enforcement across client guards, backend
  handlers, and Firestore rules;
- privileged API input validation, authentication, authorization, and audit
  behavior;
- billing signature verification, idempotency, amount checks, and live/sandbox
  separation;
- offline draft persistence and idempotent synchronization, with attention to
  duplication or data loss;
- routing safety fallbacks, hazard evaluation, and honest failure states;
- mismatches between documented behavior and enforced behavior.

Findings are ranked critical, high, medium, or low. Critical and high findings
must be fixed during this pass. Medium and low findings are documented unless
they are safe, tightly scoped prerequisites for a higher-severity fix.

## Completion Criteria

The stabilization pass is complete when:

- all checks available without Java or external credentials pass;
- the local web/API system responds without compiler or runtime errors;
- no reviewed critical or high-severity issue remains unresolved;
- every product fix has proportionate regression coverage;
- verification evidence reflects the current commit and working tree; and
- Firebase emulator verification is explicitly marked blocked by the missing
  Java runtime rather than inferred from older results.

## Deliverables

- Focused source and test fixes for reproduced defects.
- A concise risk-review record of findings and dispositions.
- Updated project status documentation containing fresh results and blockers.
- A final verification summary listing commands run and their outcomes.
