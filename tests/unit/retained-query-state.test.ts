import { describe, expect, it } from "vitest";
import { transitionRetainedQueryState } from "../../src/lib/retainedQueryState";

describe("retained geographic query state", () => {
  it("retains confirmed rows when a replacement query fails", () => {
    const loaded = {
      rows: [{ id: "z1" }],
      loading: false,
      error: null,
      confirmedScopeKey: "province:A",
      requestedScopeKey: "province:A",
      displayState: "confirmed" as const,
      fromCache: false,
    };
    const next = transitionRetainedQueryState(loaded, {
      type: "query_failed",
      scopeKey: "province:B",
      error: "offline",
    });
    expect(next.rows).toEqual([{ id: "z1" }]);
    expect(next.displayState).toBe("stale_previous_scope");
    expect(next.confirmedScopeKey).toBe("province:A");
  });

  it("replaces rows only after a successful snapshot", () => {
    const initial = transitionRetainedQueryState(undefined, { type: "query_started", scopeKey: "island" });
    const loaded = transitionRetainedQueryState(initial, {
      type: "query_succeeded",
      scopeKey: "province:1705200000",
      rows: [{ id: "z2" }],
      fromCache: false,
    });
    expect(loaded.rows).toEqual([{ id: "z2" }]);
    expect(loaded.displayState).toBe("confirmed");
    expect(loaded.confirmedScopeKey).toBe("province:1705200000");
  });
});
