import React, { useEffect, useId, useRef, useState } from "react";

/**
 * Small SVG chart kit (no dependency), following one spec everywhere:
 * - one y-axis per chart (never dual-axis), clean rounded ticks, hairline grid
 * - columns/bars ≤ 24px thick, 4px rounded data-end, square at the baseline,
 *   2px surface gap between adjacent bars
 * - lines 2px with round joins; a crosshair + tooltip listing every series
 * - hover AND keyboard focus show the same tooltip; every chart offers a
 *   table view, so no value is reachable only by hovering
 * - text uses text tokens; color marks carry identity (legend for ≥ 2 series)
 * Series colors come from CSS custom properties (--series-1..3, --viz-mag)
 * validated for both light and dark surfaces.
 */

export interface Datum {
  label: string;
  value: number;
  /** Optional status color (risk levels) — always paired with a text label. */
  color?: string;
  note?: string;
}

export interface Series {
  name: string;
  color: string;
  values: number[];
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clean axis ticks: 0, 5, 10… / 0, 1,000, 2,000… */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Clean ticks for a range that may go below zero (e.g. cumulative cash). */
export function niceRange(lo: number, hi: number, count = 4): number[] {
  if (lo >= 0) return niceTicks(hi, count);
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const fmtDefault = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-PH", { maximumFractionDigits: 0 }) : String(Math.round(v * 10) / 10));

/** Rect with only the top corners rounded (data end), square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return "";
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

function TableView({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-table">
      <summary>View as table</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? "num" : undefined}>{typeof c === "number" ? fmtDefault(c) : c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Column chart (categories or time buckets on x)
// ---------------------------------------------------------------------------

export function ColumnChart({
  data,
  title,
  height = 220,
  format = fmtDefault,
  unit = "",
  color = "var(--viz-mag)",
  labelEvery,
}: {
  data: Datum[];
  title: string;
  height?: number;
  format?: (v: number) => string;
  unit?: string;
  color?: string;
  labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 8, t: 12, b: 28 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const top = ticks[ticks.length - 1] || 1;
  const band = data.length ? iw / data.length : iw;
  const barW = Math.max(2, Math.min(24, band - 2));
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 56))));
  const y = (v: number) => pad.t + ih - (v / top) * ih;

  return (
    <figure className="viz" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="viz__grid" />
            <text x={pad.l - 6} y={y(t)} className="viz__tick" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * band + (band - barW) / 2;
          const h = (d.value / top) * ih;
          return (
            <g
              key={d.label + i}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${format(d.value)}${unit}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="viz__hit"
            >
              <rect x={pad.l + i * band} y={pad.t} width={band} height={ih} fill="transparent" />
              <path d={columnPath(x, y(d.value), barW, h)} fill={d.color ?? color} opacity={hover === null || hover === i ? 1 : 0.55} />
              {i % every === 0 && (
                <text x={x + barW / 2} y={height - 8} className="viz__tick" textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="viz__tooltip" style={{ left: Math.min(width - 150, Math.max(0, pad.l + hover * band + band / 2 - 70)), top: 0 }}>
          <strong>{format(data[hover].value)}{unit}</strong>
          <span>{data[hover].label}{data[hover].note ? ` · ${data[hover].note}` : ""}</span>
        </div>
      )}
      <TableView caption={title} headers={["Label", `Value${unit ? ` (${unit.trim()})` : ""}`]} rows={data.map((d) => [d.label, d.value])} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart (ranked categories; value at the tip)
// ---------------------------------------------------------------------------

export function BarList({
  data,
  title,
  max,
  format = fmtDefault,
  unit = "",
  color = "var(--viz-mag)",
}: {
  data: Datum[];
  title: string;
  max?: number;
  format?: (v: number) => string;
  unit?: string;
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = Math.min(170, Math.round(width * 0.36));
  const valueW = 64;
  const row = 30;
  const barH = 14;
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  const iw = Math.max(40, width - labelW - valueW - 12);
  const height = data.length * row + 4;
  return (
    <figure className="viz" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={title}>
        {data.map((d, i) => {
          const w = Math.max(0, (d.value / top) * iw);
          const yy = i * row + (row - barH) / 2;
          return (
            <g key={d.label + i} tabIndex={0} role="img" aria-label={`${d.label}: ${format(d.value)}${unit}`}>
              <text x={0} y={i * row + row / 2} className="viz__label" dominantBaseline="middle">
                {d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label}
              </text>
              <rect x={labelW} y={yy} width={iw} height={barH} rx={4} className="viz__track" />
              <path d={barPath(labelW, yy, w, barH)} fill={d.color ?? color} />
              <text x={labelW + iw + 8} y={i * row + row / 2} className="viz__value" dominantBaseline="middle">
                {format(d.value)}
                {unit}
              </text>
            </g>
          );
        })}
      </svg>
      <TableView caption={title} headers={["Label", "Value"]} rows={data.map((d) => [d.label, d.value])} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Line chart (time series; one y-axis; crosshair tooltip lists every series)
// ---------------------------------------------------------------------------

export function LineChart({
  labels,
  series,
  title,
  height = 220,
  format = fmtDefault,
  unit = "",
  area = false,
  bands,
  yMax,
}: {
  labels: string[];
  series: Series[];
  title: string;
  height?: number;
  format?: (v: number) => string;
  unit?: string;
  area?: boolean;
  /** Optional horizontal reference bands (e.g. risk levels), drawn recessively. */
  bands?: { from: number; to: number; color: string; label: string }[];
  yMax?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = yMax ?? Math.max(...series.flatMap((s) => s.values), 0);
  const min = Math.min(...series.flatMap((s) => s.values), 0);
  const ticks = niceRange(min, max);
  const top = yMax ?? ticks[ticks.length - 1] ?? 1;
  const bottom = Math.min(0, ticks[0] ?? 0);
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((Math.min(v, top) - bottom) / (top - bottom || 1)) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 64))));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const rel = e.clientX - rect.left;
    setHover(Math.max(0, Math.min(n - 1, Math.round((rel / rect.width) * (n - 1)))));
  };

  return (
    <figure className="viz" ref={ref}>
      {series.length >= 2 && (
        <div className="viz__legend">
          {series.map((s) => (
            <span key={s.name} className="viz__legend-item">
              <span className="viz__key" style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={title}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
        }}
        onBlur={() => setHover(null)}
      >
        {bands?.map((b) => (
          <rect key={b.label} x={pad.l} width={iw} y={y(b.to)} height={Math.max(0, y(b.from) - y(b.to))} fill={b.color} opacity={0.07} />
        ))}
        {ticks.filter((t) => t <= top).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 && bottom < 0 ? "viz__zero" : "viz__grid"} />
            <text x={pad.l - 6} y={y(t)} className="viz__tick" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={l + i} x={x(i)} y={height - 8} className="viz__tick" textAnchor="middle">
              {l}
            </text>
          ) : null
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          return (
            <g key={s.name}>
              {area && <polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} fill={s.color} opacity={0.1} />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="viz__crosshair" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} className="viz__dot" />
            ))}
          </g>
        )}
        <rect
          x={pad.l}
          y={pad.t}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          aria-describedby={id}
        />
      </svg>
      {hover !== null && (
        <div className="viz__tooltip" id={id} style={{ left: Math.min(width - 170, Math.max(0, x(hover) - 80)), top: 0 }}>
          <span className="viz__tooltip-x">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="viz__tooltip-row">
              <span className="viz__linekey" style={{ background: s.color }} />
              <strong>{format(s.values[hover] ?? 0)}{unit}</strong> <span>{s.name}</span>
            </span>
          ))}
        </div>
      )}
      <TableView caption={title} headers={["", ...series.map((s) => s.name)]} rows={labels.map((l, i) => [l, ...series.map((s) => s.values[i] ?? 0)])} />
    </figure>
  );
}

/** Points-of-max meter (e.g. risk factor contributions). */
export function Meter({ value, max, color = "var(--viz-mag)", label }: { value: number; max: number; color?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="meter__fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}
