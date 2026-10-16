import { describe, expect, it } from "vitest";
import { riskLevel, scoreRisk, type RiskInputs } from "../../shared/risk";

const calm: RiskInputs = {
  forecastHourlyMm: Array(24).fill(0),
  past72hMm: 0,
  activeZones: [],
  station: { levelM: 1.0, alertM: 2, alarmM: 3, criticalM: 4, rising: false },
  historicalEvents90d: 0,
  elevationM: 40,
};

describe("experimental risk scoring", () => {
  it("scores a dry, high, flood-free area as low", () => {
    const r = scoreRisk(calm);
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
    expect(r.dataCompleteness).toBe(1);
    expect(r.hourly).toHaveLength(24);
  });

  it("uses PAGASA rainfall colour thresholds for intensity", () => {
    const at = (mm: number) => scoreRisk({ ...calm, forecastHourlyMm: [mm, ...Array(23).fill(0)] }).factors.find((f) => f.key === "intensity")!.points;
    expect(at(5)).toBe(4);
    expect(at(10)).toBe(11); // yellow
    expect(at(20)).toBe(18); // orange
    expect(at(35)).toBe(25); // red
  });

  it("raises risk with verified flooding, rising gauges, saturated soil and low elevation", () => {
    const r = scoreRisk({
      forecastHourlyMm: [2, 5, 12, 22, 31, 18, 9, 4, ...Array(16).fill(1)],
      past72hMm: 160,
      activeZones: [{ waterLevelM: 0.6, rising: true }],
      station: { levelM: 3.2, alertM: 2, alarmM: 3, criticalM: 4, rising: true },
      historicalEvents90d: 7,
      elevationM: 4,
    });
    expect(r.level).toBe("critical");
    expect(r.score).toBeLessThanOrEqual(100);
    const byKey = Object.fromEntries(r.factors.map((f) => [f.key, f.points]));
    expect(byKey).toMatchObject({ intensity: 25, antecedent: 15, verified_flooding: 18, river_gauge: 14, history: 5, elevation: 5 });
    // Every factor explains itself in plain language.
    expect(r.factors.every((f) => f.detail.length > 10)).toBe(true);
  });

  it("reports lower data completeness instead of guessing when inputs are missing", () => {
    const r = scoreRisk({ forecastHourlyMm: null, past72hMm: null, activeZones: [], station: null, historicalEvents90d: null, elevationM: null });
    expect(r.score).toBe(0);
    expect(r.dataCompleteness).toBeLessThan(0.2);
    expect(r.factors.filter((f) => !f.available).length).toBe(6);
    expect(r.hourly).toEqual([]);
  });

  it("hourly outlook peaks around the heavy-rain hours", () => {
    const r = scoreRisk({ ...calm, forecastHourlyMm: [...Array(10).fill(0), 35, 35, ...Array(12).fill(0)] });
    const peak = r.hourly.reduce((a, b) => (b.score > a.score ? b : a));
    expect(peak.offsetH).toBeGreaterThanOrEqual(5);
    expect(peak.offsetH).toBeLessThanOrEqual(11);
    expect(r.hourly[23].score).toBeLessThan(peak.score);
  });

  it("maps scores to levels", () => {
    expect([10, 30, 55, 80].map(riskLevel)).toEqual(["low", "moderate", "high", "critical"]);
  });
});
