import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

describe("zone-history rule source", () => {
  it("requires an existing parent and the editor's jurisdiction", () => {
    expect(rules).toContain("historyParentExists(zoneId)");
    expect(rules).toContain("ownsArea(historyArea(zoneId))");
    expect(rules).toContain("validHistoryEntry(zoneId)");
  });
});
