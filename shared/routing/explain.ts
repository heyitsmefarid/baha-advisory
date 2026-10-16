import { formatAge } from "../time";
import { TRAVEL_MODE_LABELS, type HazardHit, type PlanResult } from "./types";

function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function mins(s: number): string {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function hazardLine(h: HazardHit, lang: "en" | "fil"): string {
  const sim = h.simulated ? (lang === "fil" ? " [SIMULATED]" : " [SIMULATED]") : "";
  return `${h.name}${sim} — ${h.reason}`;
}

/**
 * Plain-language explanation built only from the plan's facts. Always
 * available (no AI). The optional AI explanation is generated from the
 * same facts and must not add new ones.
 */
export function buildExplanation(plan: PlanResult, lang: "en" | "fil" = "en"): string {
  const mode = TRAVEL_MODE_LABELS[plan.mode].toLowerCase();
  const r = plan.recommended;
  const parts: string[] = [];

  if (!r) {
    const blocked = plan.alternatives[0]?.evaluation.blocked ?? [];
    if (lang === "fil") {
      parts.push(`Walang nahanap na ligtas na ruta para sa ${mode}. Lahat ng sinubukang daan ay dumadaan sa bahang hindi madaanan:`);
    } else {
      parts.push(`No verified safe route was found for a ${mode}. Every path tried passes through flooding that is not passable:`);
    }
    blocked.slice(0, 3).forEach((b) => parts.push(`• ${hazardLine(b, lang)}`));
    parts.push(
      lang === "fil"
        ? "Huwag pilitin ang biyahe. Maghintay ng update ng DRRM, pumili ng ibang destinasyon, o pumunta sa pinakamalapit na evacuation center."
        : "Do not attempt this trip. Wait for a DRRM update, choose another destination, or go to the nearest evacuation center."
    );
    return parts.join("\n");
  }

  if (lang === "fil") {
    parts.push(`Inirerekomenda: ${km(r.distanceM)}, mga ${mins(r.durationS)} gamit ang ${mode}.`);
  } else {
    parts.push(`Recommended: ${km(r.distanceM)}, about ${mins(r.durationS)} by ${mode}.`);
  }

  if (plan.avoided.length) {
    parts.push(
      lang === "fil"
        ? `Iniiwasan nito ang ${plan.avoided.length} bahang lugar na dinadaanan ng pinakamabilis na ruta:`
        : `It avoids ${plan.avoided.length} flooded area${plan.avoided.length > 1 ? "s" : ""} that the fastest road passes through:`
    );
    plan.avoided.slice(0, 3).forEach((a) => parts.push(`• ${hazardLine(a, lang)}`));
  } else if (r.evaluation.status === "safe") {
    parts.push(
      lang === "fil"
        ? "Walang beripikadong baha o saradong daan sa rutang ito."
        : "No verified flooding or road closures lie on this route."
    );
  }

  if (r.evaluation.cautions.length) {
    parts.push(
      lang === "fil"
        ? `May ${r.evaluation.cautions.length} bahang bahagi na madadaanan pa ng ${mode} — magdahan-dahan:`
        : `${r.evaluation.cautions.length} flooded stretch${r.evaluation.cautions.length > 1 ? "es remain" : " remains"} passable for a ${mode} — go slowly:`
    );
    r.evaluation.cautions.slice(0, 3).forEach((c) => parts.push(`• ${hazardLine(c, lang)}`));
  }

  const newest = r.evaluation.freshness.newestMs;
  if (newest) {
    parts.push(lang === "fil" ? `Huling update ng kondisyon ng daan: ${formatAge(newest)}.` : `Latest road update on this route: ${formatAge(newest)}.`);
  }
  parts.push(
    lang === "fil"
      ? "Beripikadong datos lang ng DRRM ang ginagamit; hindi binabago ng hindi pa beripikadong ulat ang ruta."
      : "Only DRRM-verified data is used; unverified reports never change routes."
  );
  return parts.join("\n");
}
