import React, { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Spinner } from "../ui";
import type { PlanResult } from "../../../shared/routing";

interface AiExplain {
  text: string;
  provider: "groq" | "gemini" | "simulated";
  model: string;
  cached?: boolean;
}

/**
 * Shows the deterministic explanation (always available) and lets the user
 * ask Baha AI to restate it in plain English or Filipino. The AI receives
 * only the plan's facts and is instructed not to add road conditions.
 */
export default function RouteExplanation({ plan }: { plan: PlanResult }) {
  const [ai, setAi] = useState<AiExplain | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "fil">("en");

  const ask = async (language: "en" | "fil") => {
    setLang(language);
    setBusy(true);
    setError(null);
    try {
      const r = plan.recommended;
      const res = await api<AiExplain>("/ai/explain-route", {
        body: {
          language,
          mode: plan.mode,
          status: plan.status,
          distanceM: r?.distanceM ?? null,
          durationS: r?.durationS ?? null,
          avoided: plan.avoided.map((h) => ({ name: h.name, reason: h.reason, simulated: h.simulated })),
          cautions: (r?.evaluation.cautions ?? []).map((h) => ({ name: h.name, reason: h.reason, simulated: h.simulated })),
          newestUpdateMs: r?.evaluation.freshness.newestMs ?? null,
          staleCount: r?.evaluation.freshness.staleCount ?? 0,
          deterministic: plan.explanation,
        },
      });
      setAi(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel panel--flat route-explain">
      <div className="panel__head">
        <h3 className="panel__title">Why this route</h3>
        <div className="btn-row">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => ask("en")}>
            {busy && lang === "en" ? <Spinner /> : "Explain simply"}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => ask("fil")}>
            {busy && lang === "fil" ? <Spinner /> : "Sa Filipino"}
          </button>
        </div>
      </div>
      <p className="route-explain__text">{plan.explanation}</p>
      {ai && (
        <div className="ai-block">
          <div className="ai-block__head">
            <Badge tone={ai.provider === "simulated" ? "neutral" : "tide"}>
              {ai.provider === "simulated" ? "AI unavailable — template text" : `Baha AI · ${ai.provider}`}
            </Badge>
            <span className="tiny">Rephrased from the facts above. It cannot see the roads.</span>
          </div>
          <p className="route-explain__text">{ai.text}</p>
        </div>
      )}
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}
