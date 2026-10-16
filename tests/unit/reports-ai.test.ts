import { describe, expect, it } from "vitest";
import { findDuplicateCandidates, severityFromDepth, suspiciousFlags } from "../../shared/reports";
import { decodeImageDataUrl, sniff } from "../../server/lib/images";
import { normalizeAnalysis, notAnalyzed } from "../../server/ai/imageAnalysis";
import { parseJsonReply } from "../../server/ai/providers";
import { cloudinarySignature } from "../../server/storage";
import { chatFallback, detectLanguage, advisoryFallback } from "../../server/ai/simulated";
import type { GroundingContext } from "../../server/ai/context";

const NOW = Date.UTC(2026, 9, 9, 6, 0, 0);
const here = { lat: 13.4031, lng: 121.1883 };

describe("duplicate detection", () => {
  const recent = [
    { id: "near-same", location: { lat: 13.4033, lng: 121.1884 }, createdAtMs: NOW - 10 * 60_000, depthLabel: "knee" as const, status: "pending" as const },
    { id: "near-old", location: { lat: 13.4032, lng: 121.1884 }, createdAtMs: NOW - 5 * 3600_000, depthLabel: "knee" as const, status: "pending" as const },
    { id: "far", location: { lat: 13.42, lng: 121.2 }, createdAtMs: NOW - 5 * 60_000, depthLabel: "knee" as const, status: "pending" as const },
    { id: "rejected", location: here, createdAtMs: NOW - 60_000, depthLabel: "knee" as const, status: "rejected" as const },
  ];

  it("finds recent nearby reports and ignores old, far or rejected ones", () => {
    const d = findDuplicateCandidates({ location: here, observedAtMs: NOW, depthLabel: "knee" }, recent);
    expect(d.map((x) => x.id)).toEqual(["near-same"]);
    expect(d[0].distanceM).toBeLessThan(50);
  });

  it("scores depth agreement", () => {
    const agree = findDuplicateCandidates({ location: here, observedAtMs: NOW, depthLabel: "knee" }, recent)[0].score;
    const disagree = findDuplicateCandidates({ location: here, observedAtMs: NOW, depthLabel: "ankle" }, recent)[0].score;
    expect(agree).toBeGreaterThan(disagree);
  });
});

describe("suspicious report flags", () => {
  const base = { description: "Knee-deep water outside the market", observedAtMs: NOW, nowMs: NOW, reportsLastHour: 0, isGuest: false, locationAccuracyM: 20, depthLabel: "knee" as const, ai: null };

  it("flags nothing for a normal report", () => {
    expect(suspiciousFlags(base)).toEqual([]);
  });

  it("flags short text, old observations, bursts, guests and poor GPS", () => {
    const f = suspiciousFlags({ ...base, description: "flood", observedAtMs: NOW - 13 * 3600_000, reportsLastHour: 6, isGuest: true, locationAccuracyM: 900 });
    expect(f).toEqual(expect.arrayContaining(["description_too_short", "observed_time_old", "high_submission_rate", "guest_reporter", "low_location_accuracy"]));
  });

  it("uses AI signals only when the photo was actually analyzed and confident", () => {
    const ai = { imageAnalyzed: true, floodVisible: false, depthEstimate: "none" as const, imageQuality: "good" as const, confidence: 0.8 };
    expect(suspiciousFlags({ ...base, ai })).toEqual(expect.arrayContaining(["ai_no_flood_visible", "ai_depth_mismatch"]));
    expect(suspiciousFlags({ ...base, ai: { ...ai, confidence: 0.3 } })).toEqual([]);
    expect(suspiciousFlags({ ...base, ai: { ...ai, imageAnalyzed: false } })).toEqual([]);
  });

  it("maps depth to severity on the MMDA scale", () => {
    expect(severityFromDepth("gutter")).toBe("low");
    expect(severityFromDepth("knee")).toBe("high");
    expect(severityFromDepth("chest_or_higher")).toBe("severe");
    expect(severityFromDepth("unknown")).toBe("unknown");
  });
});

describe("image validation", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it("accepts real JPEG/PNG by magic bytes", () => {
    expect(sniff(jpeg)).toBe("image/jpeg");
    expect(sniff(png)).toBe("image/png");
    expect(decodeImageDataUrl(`data:image/jpeg;base64,${jpeg.toString("base64")}`).mime).toBe("image/jpeg");
  });

  it("rejects SVG/HTML, mislabelled files and oversized uploads", () => {
    expect(() => decodeImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toThrow(/JPEG, PNG or WebP/);
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(() => decodeImageDataUrl(`data:image/png;base64,${html.toString("base64")}`)).toThrow(/not a valid/);
    const big = Buffer.concat([jpeg, Buffer.alloc(2048)]);
    expect(() => decodeImageDataUrl(`data:image/jpeg;base64,${big.toString("base64")}`, 1024)).toThrow(/too large/);
  });
});

describe("AI reply handling", () => {
  it("extracts JSON from fenced or chatty replies", () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(parseJsonReply("no json here")).toBeNull();
  });

  it("clamps and whitelists model output into a safe shape", () => {
    const n = normalizeAnalysis({
      floodVisible: true,
      waterLevelEstimate: "knee",
      severitySuggestion: "catastrophic", // not allowed → unknown
      roadObstruction: { present: true, types: ["floodwater", 42] },
      hazards: ["debris", "a", "b", "c", "d", "e", "f"],
      confidence: 7, // clamped to 1
      imageQuality: "good",
      rationale: "x".repeat(1000),
    })!;
    expect(n.imageAnalyzed).toBe(true);
    expect(n.severitySuggestion).toBe("unknown");
    expect(n.roadObstruction.types).toEqual(["floodwater"]);
    expect(n.hazards).toHaveLength(5);
    expect(n.confidence).toBe(1);
    expect(n.rationale.length).toBe(300);
    expect(n.disclaimer).toMatch(/cannot determine actual water depth/);
  });

  it("never pretends to have analyzed a photo when AI is unavailable", () => {
    const n = notAnalyzed("No AI provider is configured.", "knee");
    expect(n.imageAnalyzed).toBe(false);
    expect(n.confidence).toBe(0);
    expect(n.severitySuggestion).toBe("high"); // from the reporter's own depth
    expect(n.rationale).toMatch(/No automated photo assessment/);
  });
});

describe("deterministic AI fallbacks", () => {
  const ctx: GroundingContext = {
    text: "",
    refs: [],
    zones: 1,
    centers: [{ name: "Central School Gym", status: "open", distanceM: 800, occupancy: "120/400 occupants (verified)", contact: "0917", simulated: true }],
    alerts: [{ title: "Flooding on Bucayao Road", severity: "high", simulated: true }],
    zoneLines: ["- [SIMULATED] Bucayao Road (Calapan City): 0.55m — Tire level, rising"],
    hotlines: [{ label: "National emergency hotline", number: "911" }],
  };

  it("detects Filipino vs English", () => {
    expect(detectLanguage("Saan ang pinakamalapit na evacuation center?")).toBe("fil");
    expect(detectLanguage("Where is the nearest evacuation center?")).toBe("en");
  });

  it("answers only from verified records and labels simulated data", () => {
    const en = chatFallback("Where can I evacuate?", ctx, "auto");
    expect(en).toMatch(/unavailable/);
    expect(en).toMatch(/Central School Gym \(simulated\)/);
    expect(en).toMatch(/911/);
    const fil = chatFallback("Saan ako pwedeng lumikas?", ctx, "auto");
    expect(fil).toMatch(/Hindi available ang AI/);
  });

  it("builds a factual advisory template that flags simulated data", () => {
    const a = advisoryFallback({ areas: ["Calapan City"], severity: "high", zones: ["Bucayao Road"], roads: [], centers: [], notes: "", hotline: "911", simulated: true });
    expect(a.title).toMatch(/Flood warning — Calapan City/);
    expect(a.body.startsWith("SIMULATED DEMO ADVISORY.")).toBe(true);
    expect(a.bodyFil).toMatch(/SIMULATED NA ABISO/);
  });
});

describe("Cloudinary signing", () => {
  it("signs sorted params with the secret (documented algorithm)", () => {
    // Example from Cloudinary docs: public_id=sample_image&timestamp=1315060510 + abcd
    expect(cloudinarySignature({ timestamp: 1315060510, public_id: "sample_image" }, "abcd")).toBe("b4ad47fb4e25c7bf5f92a20089f9db59bc302313");
  });
});
