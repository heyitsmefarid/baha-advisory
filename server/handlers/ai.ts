import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../lib/firebaseAdmin";
import { forbidden, json, notFound, readJson } from "../lib/http";
import { getAuthCtx, requireAuth, requireRole } from "../lib/auth";
import { memoryRateLimit } from "../lib/rateLimit";
import { audit } from "../lib/audit";
import { loadOfficialData } from "../lib/hazards";
import { getGeneralSettings } from "../lib/settings";
import { runTextTask } from "../ai/service";
import { parseJsonReply, type ChatMessage } from "../ai/providers";
import { buildGroundingContext } from "../ai/context";
import { ADVISORY_SYSTEM, CHAT_SYSTEM, INCIDENT_SUMMARY_SYSTEM, ROUTE_EXPLAIN_SYSTEM } from "../ai/prompts";
import { advisoryFallback, chatFallback, incidentSummaryFallback, type AdvisoryFacts } from "../ai/simulated";
import { quotaOverview, type AiCaller } from "../ai/quota";
import { asObject, oneOf, optLatLng, optNum, str, strArray, ValidationError } from "../../shared/validation";
import { canManageArea } from "../../shared/roles";
import { formatWaterLevel } from "../../shared/passability";
import { PASSABILITY_LABELS } from "../../shared/flood";
import { formatAge, toMillis } from "../../shared/time";
import { toPt } from "../../shared/geo";
import type { Incident } from "../../shared/types";
import type { RouteCtx } from "../router";

function callerOf(auth: { uid: string; orgId: string | null; role: AiCaller["role"]; anonymous: boolean } | null, ip: string): AiCaller {
  return auth
    ? { uid: auth.uid, orgId: auth.orgId, role: auth.role, anonymous: auth.anonymous, ip }
    : { uid: null, orgId: null, role: "citizen", anonymous: true, ip };
}

// ---------------------------------------------------------------------------
// POST /api/ai/chat — Baha AI, grounded on verified records
// ---------------------------------------------------------------------------

export async function chat(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req, { allowAnonymous: true });
  const body = asObject(await readJson(req));
  const message = str(body, "message", { min: 1, max: 1500 });
  const language = oneOf(body, "language", ["auto", "en", "fil"] as const, "auto");
  const loc = optLatLng(body, "location");
  const rawHistory = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const history: ChatMessage[] = rawHistory
    .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0, 1500) }));

  const grounding = await buildGroundingContext(loc ? toPt(loc) : null);
  const langNote = language === "fil" ? "Reply in Filipino." : language === "en" ? "Reply in English." : "Reply in the same language the user used.";
  const system = `${CHAT_SYSTEM}\n\n${langNote}\n\n=== VERIFIED DATA (Bahadvisory records) ===\n${grounding.text}\n=== END VERIFIED DATA ===`;

  const result = await runTextTask({
    task: "chat",
    system,
    messages: [...history, { role: "user", content: message }],
    temperature: 0.3,
    maxTokens: 600,
    quota: "chat",
    caller: callerOf(auth, ctx.ip),
  });
  const reply = result.text ?? chatFallback(message, grounding, language);

  if (!auth.anonymous) {
    const col = getDb().collection("ai_chat_history").doc(auth.uid).collection("messages");
    await col.add({ role: "user", content: message, createdAt: FieldValue.serverTimestamp() });
    await col.add({ role: "assistant", content: reply, provider: result.provider, model: result.model, groundedOn: grounding.refs.slice(0, 20), createdAt: FieldValue.serverTimestamp() });
  }

  return json({
    reply,
    provider: result.provider,
    model: result.model,
    fallbackReason: result.fallbackReason ?? null,
    groundedOn: grounding.refs.length,
    quota: result.quota ?? null,
  });
}

// ---------------------------------------------------------------------------
// POST /api/ai/advisory-draft — LGU staff; facts gathered server-side
// ---------------------------------------------------------------------------

export async function advisoryDraft(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireRole(auth, ["lgu_staff", "lgu_admin", "super_admin"]);
  const body = asObject(await readJson(req));
  const areas = strArray(body, "areas", { maxItems: 10, maxLen: 80 });
  if (!areas.length) throw new ValidationError(["Choose at least one area."]);
  for (const a of areas) if (!canManageArea(auth.claims, a)) throw forbidden(`You can't issue advisories for ${a}.`);
  const severity = oneOf(body, "severity", ["info", "moderate", "high", "critical"] as const, "moderate");
  const notes = str(body, "notes", { max: 1500, optional: true });

  const { zones, roads } = await loadOfficialData();
  const db = getDb();
  const centers = await db.collection("evacuation_centers").where("verified", "==", true).get();
  const settings = await getGeneralSettings();
  const inArea = <T extends { area: string }>(x: T) => areas.includes(x.area);
  const zoneFacts = zones.filter(inArea).map((z) => `${z.simulated ? "[SIMULATED] " : ""}${z.name}: ${formatWaterLevel(z.waterLevelM)}, ${z.trend}, road ${PASSABILITY_LABELS[z.roadPassability]} (updated ${formatAge(toMillis(z.updatedAt))})`);
  const roadFacts = roads.filter(inArea).filter((r) => r.status !== "open").map((r) => `${r.simulated ? "[SIMULATED] " : ""}${r.name}: ${r.status} — ${r.reason}`);
  const centerFacts = centers.docs
    .map((d) => d.data())
    .filter((c) => areas.includes(c.area) && (c.status === "open" || c.status === "standby"))
    .map((c) => `${c.simulated ? "[SIMULATED] " : ""}${c.name} (${c.status})`);
  let hotline = settings.emergencyHotlines.map((h) => `${h.label} ${h.number}`).join("; ");
  if (auth.orgId) {
    const org = await db.doc(`organizations/${auth.orgId}`).get();
    const extra = (org.get("hotlines") as { label: string; number: string }[] | undefined) ?? [];
    if (extra.length) hotline += `; ${extra.map((h) => `${h.label} ${h.number}`).join("; ")}`;
  }
  const simulated = [...zones.filter(inArea), ...roads.filter(inArea)].some((x) => x.simulated);
  const facts: AdvisoryFacts = { areas, severity, zones: zoneFacts, roads: roadFacts, centers: centerFacts, notes, hotline, simulated };

  const factText = [
    `Areas: ${areas.join(", ")}`,
    `Requested severity: ${severity}`,
    `Active flood zones:\n${zoneFacts.map((z) => `- ${z}`).join("\n") || "- none published"}`,
    `Road conditions:\n${roadFacts.map((r) => `- ${r}`).join("\n") || "- none"}`,
    `Open/standby evacuation centers:\n${centerFacts.map((c) => `- ${c}`).join("\n") || "- none listed"}`,
    `Hotlines: ${hotline}`,
    notes ? `Officer's notes (trusted): ${notes}` : "",
  ].filter(Boolean).join("\n\n");

  const result = await runTextTask({
    task: "advisory_draft",
    system: ADVISORY_SYSTEM,
    messages: [{ role: "user", content: factText }],
    json: true,
    temperature: 0.2,
    maxTokens: 900,
    quota: "chat",
    caller: callerOf(auth, ctx.ip),
  });
  const parsed = result.text ? parseJsonReply<{ title?: string; body?: string; bodyFil?: string; severity?: string }>(result.text) : null;
  const fallback = advisoryFallback(facts);
  const draft =
    parsed && typeof parsed.title === "string" && typeof parsed.body === "string"
      ? {
          title: parsed.title.slice(0, 200),
          body: parsed.body.slice(0, 4000),
          bodyFil: typeof parsed.bodyFil === "string" ? parsed.bodyFil.slice(0, 4000) : "",
          severity: (["info", "moderate", "high", "critical"].includes(parsed.severity ?? "") ? parsed.severity : severity) as typeof severity,
        }
      : fallback;
  await audit(auth, "ai.advisory_draft", "advisory_draft", areas.join(","), { provider: result.provider }, auth.orgId);
  return json({
    draft,
    provider: parsed ? result.provider : "simulated",
    model: parsed ? result.model : "template",
    facts: { zones: zoneFacts.length, roads: roadFacts.length, centers: centerFacts.length, simulated },
    disclaimer: "AI-generated DRAFT. Review every statement against official information before publishing.",
  });
}

// ---------------------------------------------------------------------------
// POST /api/ai/incident-summary — LGU staff of the incident's org
// ---------------------------------------------------------------------------

export async function incidentSummary(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireRole(auth, ["lgu_staff", "lgu_admin", "super_admin"]);
  const body = asObject(await readJson(req));
  const incidentId = str(body, "incidentId", { max: 120 });
  const db = getDb();
  const snap = await db.doc(`incidents/${incidentId}`).get();
  if (!snap.exists) throw notFound("Incident not found.");
  const inc = { id: snap.id, ...(snap.data() as Omit<Incident, "id">) };
  if (auth.role !== "super_admin" && inc.orgId !== auth.orgId) throw forbidden("This incident belongs to another organization.");
  const tl = await snap.ref.collection("timeline").orderBy("at", "asc").limit(40).get();
  const timeline = tl.docs.map((d) => ({ note: String(d.get("note")), at: new Date(toMillis(d.get("at")) ?? 0).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) }));
  const record = [
    `${inc.simulated ? "[SIMULATED RECORD] " : ""}Title: ${inc.title}`,
    `Type: ${inc.type}; Severity: ${inc.severity}; Status: ${inc.status}; Area: ${inc.area}`,
    `Description: ${inc.description}`,
    `Linked reports: ${inc.linkedReportIds.length}; Linked zone: ${inc.linkedZoneId ?? "none"}`,
    `Timeline:\n${timeline.map((t) => `- ${t.at}: ${t.note}`).join("\n") || "- (no entries)"}`,
  ].join("\n");
  const result = await runTextTask({
    task: "incident_summary",
    system: INCIDENT_SUMMARY_SYSTEM,
    messages: [{ role: "user", content: record }],
    json: true,
    temperature: 0.2,
    maxTokens: 700,
    quota: "chat",
    caller: callerOf(auth, ctx.ip),
  });
  const parsed = result.text ? parseJsonReply<{ summary?: string; keyFacts?: string[]; openActions?: string[]; risks?: string[] }>(result.text) : null;
  const clean = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5).map((x) => String(x).slice(0, 200)) : []);
  const summary =
    parsed && typeof parsed.summary === "string"
      ? { summary: parsed.summary.slice(0, 800), keyFacts: clean(parsed.keyFacts), openActions: clean(parsed.openActions), risks: clean(parsed.risks) }
      : incidentSummaryFallback(inc, timeline);
  const provider = parsed ? result.provider : "simulated";
  await snap.ref.update({ aiSummary: summary.summary, aiSummaryAt: FieldValue.serverTimestamp(), aiSummaryProvider: provider });
  return json({ ...summary, provider, model: parsed ? result.model : "template" });
}

// ---------------------------------------------------------------------------
// POST /api/ai/explain-route — public, restates deterministic facts
// ---------------------------------------------------------------------------

export async function explainRoute(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await getAuthCtx(req).catch(() => null);
  memoryRateLimit(`explain:${auth?.uid ?? ctx.ip}`, 10, 3600_000);
  const body = asObject(await readJson(req));
  const language = oneOf(body, "language", ["en", "fil"] as const, "en");
  const mode = str(body, "mode", { max: 20 });
  const status = oneOf(body, "status", ["safe", "caution", "no_safe_route"] as const);
  const distanceM = optNum(body, "distanceM", { min: 0, max: 1e7 });
  const durationS = optNum(body, "durationS", { min: 0, max: 1e7 });
  const list = (key: string) =>
    (Array.isArray(body[key]) ? (body[key] as unknown[]).slice(0, 6) : [])
      .filter((h): h is { name: string; reason: string; simulated?: boolean } => !!h && typeof h === "object" && typeof (h as { name?: unknown }).name === "string")
      .map((h) => `${String(h.name).slice(0, 120)}${h.simulated ? " [SIMULATED]" : ""} — ${String(h.reason ?? "").slice(0, 160)}`);
  const deterministic = str(body, "deterministic", { max: 3000 });
  const facts = [
    `Travel mode: ${mode}`,
    `Plan status: ${status}`,
    distanceM != null ? `Distance: ${(distanceM / 1000).toFixed(1)} km` : "",
    durationS != null ? `Estimated time: ${Math.round(durationS / 60)} minutes` : "",
    `Flooded areas avoided: ${list("avoided").join("; ") || "none"}`,
    `Passable flooded stretches on route: ${list("cautions").join("; ") || "none"}`,
    `Outdated updates on route: ${optNum(body, "staleCount", { min: 0, max: 100 }) ?? 0}`,
  ].filter(Boolean).join("\n");

  const result = await runTextTask({
    task: "route_explanation",
    system: `${ROUTE_EXPLAIN_SYSTEM}\nLanguage: ${language === "fil" ? "Filipino" : "English"}.`,
    messages: [{ role: "user", content: facts }],
    temperature: 0.2,
    maxTokens: 250,
    quota: null,
    cacheable: true,
    caller: callerOf(auth, ctx.ip),
  });
  return json({ text: result.text ?? deterministic, provider: result.provider, model: result.model, cached: result.cached });
}

/** GET /api/ai/usage — the caller's current AI quota. */
export async function usage(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req, { allowAnonymous: true });
  return json(await quotaOverview(callerOf(auth, ctx.ip)));
}
