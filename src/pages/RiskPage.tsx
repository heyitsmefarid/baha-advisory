import React, { useEffect, useMemo, useState } from "react";
import { Circle, Tooltip } from "react-leaflet";
import AppShell from "../components/layout/AppShell";
import BaseMap from "../components/map/BaseMap";
import { ColumnChart, LineChart, Meter } from "../components/charts/Charts";
import { Badge, Callout, Freshness, PageHeader, Readout, Skeleton, Spinner } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { api, errorMessage } from "../lib/api";
import { idbGet, idbPut } from "../lib/idb";
import { RISK_COLORS, RISK_DISCLAIMER } from "../../shared/risk";
import { toPt } from "../../shared/geo";
import type { FloodRiskPrediction, RiskLevel } from "../../shared/types";

const LEVEL_LABEL: Record<RiskLevel, string> = { low: "Low", moderate: "Moderate", high: "High", critical: "Critical" };
const LEVEL_TONE = { low: "safe", moderate: "caution", high: "danger", critical: "closed" } as const;

interface RiskResponse {
  modelVersion: string;
  disclaimer: string;
  predictions: FloodRiskPrediction[];
}

const CACHE_KEY = "risk_outlook_v1";

export default function RiskPage() {
  const { appRole } = useAuth();
  const [data, setData] = useState<RiskResponse | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setError(null);
    try {
      const res = await api<RiskResponse>(`/risk${refresh ? "?refresh=1" : ""}`, { anonymous: !refresh, timeoutMs: 60_000 });
      setData(res);
      setCachedAt(null);
      idbPut("kv", { at: Date.now(), res }, CACHE_KEY).catch(() => undefined);
    } catch (err) {
      setError(errorMessage(err));
      const cached = await idbGet<{ at: number; res: RiskResponse }>("kv", CACHE_KEY).catch(() => undefined);
      if (cached) {
        setData(cached.res);
        setCachedAt(cached.at);
      }
    }
  };

  useEffect(() => {
    load();
  }, []);

  const preds = data?.predictions ?? [];
  const current = preds.find((p) => p.id === selected) ?? preds[0] ?? null;
  const counts = useMemo(() => {
    const c: Record<RiskLevel, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
    preds.forEach((p) => (c[p.level] += 1));
    return c;
  }, [preds]);

  const hourLabels = (current?.hourly ?? []).map((h) => (h.time ? h.time.slice(11, 16) : ""));

  return (
    <AppShell>
      <PageHeader
        title="Flood-risk outlook"
        subtitle="Experimental 24-hour risk indicator for each municipality, combining the weather forecast, recent rain, verified flooding, river gauges, history and elevation."
        actions={
          appRole === "lgu_staff" || appRole === "lgu_admin" || appRole === "super_admin" ? (
            <button
              className="btn-secondary"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await load(true);
                setRefreshing(false);
              }}
            >
              {refreshing ? <Spinner /> : "Recompute now"}
            </button>
          ) : undefined
        }
      />
      <Callout tone="caution" title="Experimental — not an official forecast">
        {data?.disclaimer ?? RISK_DISCLAIMER}
      </Callout>
      {error && !data && <Callout tone="danger">{error}</Callout>}
      {cachedAt && (
        <Callout tone="caution">
          Showing the outlook saved on this device — <Freshness at={cachedAt} prefix="saved" />. It may be outdated.
        </Callout>
      )}

      {!data ? (
        <div className="panel">
          <Skeleton height={260} />
        </div>
      ) : (
        <>
          <div className="readout-strip">
            <Readout value={counts.critical} label="Critical" tone="closed" />
            <Readout value={counts.high} label="High" tone="danger" />
            <Readout value={counts.moderate} label="Moderate" tone="caution" />
            <Readout value={counts.low} label="Low" tone="safe" />
            <Readout value={data.modelVersion} label="Model" hint={preds[0] ? <Freshness at={preds[0].computedAt} prefix="Computed" /> : undefined} />
          </div>

          <div className="grid-2 risk-layout">
            <div className="stack">
              <div className="verify-map verify-map--tall">
                <BaseMap className="leaflet-map" zoom={9}>
                  {preds.map((p) => (
                    <Circle
                      key={p.id}
                      center={toPt(p.center)}
                      radius={3500}
                      pathOptions={{ color: RISK_COLORS[p.level], fillColor: RISK_COLORS[p.level], fillOpacity: current?.id === p.id ? 0.55 : 0.3, weight: current?.id === p.id ? 3 : 1.5 }}
                      eventHandlers={{ click: () => setSelected(p.id) }}
                    >
                      <Tooltip>
                        <strong>{p.area}</strong>: {LEVEL_LABEL[p.level]} ({p.score}/100)
                      </Tooltip>
                    </Circle>
                  ))}
                </BaseMap>
              </div>
              <ul className="list-plain risk-list">
                {preds.map((p) => (
                  <li key={p.id}>
                    <button className={`master-item ${current?.id === p.id ? "master-item--on" : ""}`} onClick={() => setSelected(p.id)}>
                      <span className="spread">
                        <strong>{p.area}</strong>
                        <span className="row">
                          <Badge tone={LEVEL_TONE[p.level]}>{LEVEL_LABEL[p.level]}</Badge>
                          <span className="mono small">{p.score}</span>
                        </span>
                      </span>
                      <Meter value={p.score} max={100} color={RISK_COLORS[p.level]} label={`${p.area} risk score`} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {current && (
              <div className="stack">
                <div className="panel">
                  <div className="spread">
                    <h3 className="panel__title">{current.area}</h3>
                    <Badge tone={LEVEL_TONE[current.level]}>{LEVEL_LABEL[current.level]} risk</Badge>
                  </div>
                  <div className="readout-strip readout-strip--flat">
                    <Readout value={`${current.score}/100`} label="Risk score" tone={LEVEL_TONE[current.level]} />
                    <Readout value={`${Math.round(current.dataCompleteness * 100)}%`} label="Data completeness" />
                  </div>
                  {current.simulatedInputs && (
                    <Callout tone="neutral">Part of this score comes from SIMULATED demo data (zones, gauges or history) — not real conditions.</Callout>
                  )}
                  <h4 className="panel__title small">Why this score</h4>
                  <ul className="list-plain factor-list">
                    {current.factors.map((f) => (
                      <li key={f.key} className={f.available ? "" : "factor--na"}>
                        <span className="spread">
                          <strong className="small">{f.label}</strong>
                          <span className="mono small">
                            {f.points}/{f.maxPoints}
                          </span>
                        </span>
                        <Meter value={f.points} max={f.maxPoints} label={`${f.label} contribution`} />
                        <span className="tiny">{f.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {current.hourly.length > 0 ? (
                  <div className="panel">
                    <h3 className="panel__title">Next 24 hours</h3>
                    <p className="tiny">Forecast rain per hour (Open-Meteo), and the risk score it implies hour by hour.</p>
                    <ColumnChart
                      title={`Forecast rainfall per hour, ${current.area}`}
                      data={current.hourly.map((h, i) => ({ label: hourLabels[i], value: h.precipMm }))}
                      unit=" mm/h"
                      height={160}
                    />
                    <LineChart
                      title={`Hourly risk score, ${current.area}`}
                      labels={hourLabels}
                      series={[{ name: "Risk score", color: "var(--viz-line)", values: current.hourly.map((h) => h.score) }]}
                      yMax={100}
                      height={180}
                      bands={[
                        { from: 0, to: 25, color: RISK_COLORS.low, label: "low" },
                        { from: 25, to: 50, color: RISK_COLORS.moderate, label: "moderate" },
                        { from: 50, to: 70, color: RISK_COLORS.high, label: "high" },
                        { from: 70, to: 100, color: RISK_COLORS.critical, label: "critical" },
                      ]}
                    />
                    <p className="tiny">Shaded bands: low (&lt;25), moderate (25–49), high (50–69), critical (70+).</p>
                  </div>
                ) : (
                  <Callout tone="neutral">Hourly outlook unavailable — the weather forecast couldn't be fetched.</Callout>
                )}
                <p className="tiny">
                  Sources: {current.sources.join(" · ")}. Model {current.modelVersion}. <Freshness at={current.computedAt} prefix="Computed" />
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
