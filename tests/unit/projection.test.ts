import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, project } from "../../shared/projection";

describe("hypothetical revenue projection", () => {
  it("accumulates customers, MRR and one-time fees month by month", () => {
    const r = project({ ...DEFAULT_ASSUMPTIONS, months: 3, monthlyChurnPct: 0, businessPerMonth: 0, enterprisePerQuarter: 0 });
    expect(r.rows.map((x) => x.lgus)).toEqual([1, 2, 3]);
    expect(r.rows[2].mrr).toBe(15000);
    expect(r.rows[0].oneTime).toBe(25000 + 15000 * 0.6);
    expect(r.arrAtEnd).toBe(180000);
  });

  it("applies churn and respects the LGU cap", () => {
    const capped = project({ ...DEFAULT_ASSUMPTIONS, months: 12, lguPerMonth: 5, lguMax: 10, monthlyChurnPct: 0, businessPerMonth: 0, enterprisePerQuarter: 0 });
    expect(capped.rows[11].lgus).toBe(10);
    const churned = project({ ...DEFAULT_ASSUMPTIONS, months: 12, monthlyChurnPct: 10 });
    const noChurn = project({ ...DEFAULT_ASSUMPTIONS, months: 12, monthlyChurnPct: 0 });
    expect(churned.rows[11].mrr).toBeLessThan(noChurn.rows[11].mrr);
  });

  it("lands fractional acquisition (0.34 enterprise per quarter)", () => {
    const r = project({ ...DEFAULT_ASSUMPTIONS, months: 9, lguPerMonth: 0, businessPerMonth: 0, monthlyChurnPct: 0 });
    expect(r.rows[8].enterprises).toBeGreaterThanOrEqual(1);
  });

  it("finds break-even and payback when revenue overtakes costs", () => {
    const r = project(DEFAULT_ASSUMPTIONS);
    expect(r.breakEvenMonth).not.toBeNull();
    expect(r.rows[r.breakEvenMonth! - 1].net).toBeGreaterThanOrEqual(0);
    if (r.paybackMonth) expect(r.rows[r.paybackMonth - 1].cumulative).toBeGreaterThanOrEqual(0);
  });

  it("reports no break-even when costs always exceed revenue", () => {
    const r = project({ ...DEFAULT_ASSUMPTIONS, months: 12, lguPerMonth: 0, businessPerMonth: 0, enterprisePerQuarter: 0, staffCost: 50000 });
    expect(r.breakEvenMonth).toBeNull();
    expect(r.rows[11].cumulative).toBeLessThan(0);
  });
});
