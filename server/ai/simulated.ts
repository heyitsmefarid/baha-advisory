/**
 * Deterministic fallbacks used when no AI provider is available. They are
 * always labelled as non-AI in the UI and only restate verified records
 * or fixed, conservative safety guidance.
 */
import type { GroundingContext } from "./context";

type Lang = "en" | "fil";

export function detectLanguage(text: string): Lang {
  const fil = /\b(ang|ng|mga|saan|paano|ano|ba|po|baha|lumikas|daan|tulong|ligtas|bahay|kami|kayo|ako|hindi|meron|wala)\b/i;
  return fil.test(text) ? "fil" : "en";
}

const PREP_EN = [
  "Prepare a go-bag: water, ready-to-eat food, medicines, flashlight, power bank, IDs and documents in a waterproof bag, whistle, face masks.",
  "Turn off the main power switch if water may enter your home, and never touch electrical devices while wet.",
  "Avoid walking or driving through floodwater — 15 cm of moving water can knock you down; open drains may be hidden.",
  "If you waded through floodwater, wash well and see a health center about leptospirosis prevention.",
];
const PREP_FIL = [
  "Maghanda ng go-bag: tubig, pagkaing hindi na lulutuin, gamot, flashlight, power bank, ID at dokumento sa waterproof na lalagyan, pito, face mask.",
  "Patayin ang main switch ng kuryente kung papasukin ng tubig ang bahay, at huwag humawak ng appliance kapag basa.",
  "Iwasang lumusong o magmaneho sa baha — kayang tumumba ng 15 cm na rumaragasang tubig; maaaring may nakatagong bukas na kanal.",
  "Kung lumusong sa baha, maghugas nang mabuti at kumonsulta sa health center tungkol sa leptospirosis.",
];

export function chatFallback(question: string, ctx: GroundingContext, langPref: "auto" | Lang): string {
  const lang = langPref === "auto" ? detectLanguage(question) : langPref;
  const q = question.toLowerCase();
  const out: string[] = [];
  const header =
    lang === "fil"
      ? "Hindi available ang AI ngayon, kaya narito ang beripikadong impormasyon mula sa Bahadvisory:"
      : "The AI assistant is unavailable right now, so here is verified information from Bahadvisory:";
  out.push(header);

  const wantsEvac = /evac|lumikas|shelter|center|silungan|lilikas/.test(q);
  const wantsRoad = /road|daan|route|ruta|pass|madaanan|drive|sasakyan|traffic/.test(q);
  const wantsPrep = /prepar|handa|go-?bag|kit|ready|gawin|what should/.test(q);
  const wantsFlood = !wantsPrep || /flood|baha|water|tubig|level|status/.test(q);

  if (wantsEvac) {
    if (ctx.centers.length) {
      out.push(lang === "fil" ? "Mga beripikadong evacuation center:" : "Verified evacuation centers:");
      ctx.centers.slice(0, 4).forEach((c) =>
        out.push(`• ${c.name}${c.simulated ? " (simulated)" : ""} — ${c.status}, ${c.occupancy}${c.contact ? `, ${c.contact}` : ""}`)
      );
    } else {
      out.push(lang === "fil" ? "Walang beripikadong evacuation center sa ngayon." : "No verified evacuation centers are listed right now.");
    }
  }
  if (wantsRoad || (wantsFlood && !wantsEvac)) {
    if (ctx.zoneLines.length) {
      out.push(lang === "fil" ? "Mga aktibong bahang lugar (DRRM):" : "Active flood zones (DRRM-verified):");
      ctx.zoneLines.slice(0, 5).forEach((l) => out.push(l.replace(/^- /, "• ")));
      out.push(lang === "fil" ? "Gamitin ang Navigate para sa rutang umiiwas sa baha." : "Use Navigate for a route that avoids these.");
    } else {
      out.push(lang === "fil" ? "Walang aktibong bahang lugar na naka-publish." : "No active flood zones are currently published.");
    }
  }
  if (ctx.alerts.length) {
    out.push(lang === "fil" ? "Aktibong alerto:" : "Active alerts:");
    ctx.alerts.slice(0, 3).forEach((a) => out.push(`• [${a.severity}] ${a.title}${a.simulated ? " (simulated)" : ""}`));
  }
  if (wantsPrep) {
    out.push(lang === "fil" ? "Mga paalala sa paghahanda:" : "Preparedness reminders:");
    (lang === "fil" ? PREP_FIL : PREP_EN).forEach((t) => out.push(`• ${t}`));
  }
  out.push(
    lang === "fil"
      ? `Sa emergency, tumawag sa ${ctx.hotlines.map((h) => h.number).join(" / ")} o gamitin ang SOS button.`
      : `In an emergency call ${ctx.hotlines.map((h) => h.number).join(" / ")} or use the SOS button.`
  );
  return out.join("\n");
}

export interface AdvisoryFacts {
  areas: string[];
  severity: "info" | "moderate" | "high" | "critical";
  zones: string[];
  roads: string[];
  centers: string[];
  notes: string;
  hotline: string;
  simulated: boolean;
}

export function advisoryFallback(f: AdvisoryFacts) {
  const sim = f.simulated ? "SIMULATED DEMO ADVISORY. " : "";
  const where = f.areas.join(", ") || "the area";
  const title = `${f.severity === "critical" || f.severity === "high" ? "Flood warning" : "Flood advisory"} — ${where}`;
  const body = [
    `${sim}Flooding is reported in ${where}.`,
    f.zones.length ? `Affected: ${f.zones.slice(0, 4).join("; ")}.` : "",
    f.roads.length ? `Road conditions: ${f.roads.slice(0, 3).join("; ")}.` : "",
    f.notes ? f.notes : "",
    "Avoid floodwater, keep children away from drains and rivers, and prepare go-bags.",
    f.centers.length ? `Open evacuation centers: ${f.centers.slice(0, 3).join("; ")}.` : "",
    `Emergency: ${f.hotline}.`,
  ].filter(Boolean).join(" ");
  const bodyFil = [
    `${f.simulated ? "SIMULATED NA ABISO PARA SA DEMO. " : ""}May iniulat na pagbaha sa ${where}.`,
    f.zones.length ? `Apektado: ${f.zones.slice(0, 4).join("; ")}.` : "",
    f.roads.length ? `Kondisyon ng daan: ${f.roads.slice(0, 3).join("; ")}.` : "",
    "Iwasan ang baha, ilayo ang mga bata sa kanal at ilog, at ihanda ang go-bag.",
    f.centers.length ? `Bukas na evacuation center: ${f.centers.slice(0, 3).join("; ")}.` : "",
    `Emergency: ${f.hotline}.`,
  ].filter(Boolean).join(" ");
  return { title: title.slice(0, 90), body, bodyFil, severity: f.severity };
}

export function incidentSummaryFallback(incident: { title: string; status: string; severity: string; area: string; description: string; simulated?: boolean }, timeline: { note: string; at: string }[]) {
  const sim = incident.simulated ? "SIMULATED: " : "";
  return {
    summary: `${sim}${incident.title} in ${incident.area} — status ${incident.status}, severity ${incident.severity}. ${incident.description}`.slice(0, 600),
    keyFacts: timeline.slice(-5).map((t) => `${t.at}: ${t.note}`.slice(0, 140)),
    openActions: incident.status === "resolved" ? [] : ["Review the latest timeline entry and confirm next responder action."],
    risks: [],
  };
}
