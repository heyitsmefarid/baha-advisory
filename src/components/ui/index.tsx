import React, { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { formatAge, toMillis } from "../../../shared/time";

// =============================================================================
// Small, shared UI primitives. Styling lives in src/styles/app.css.
// =============================================================================

type Tone = "neutral" | "info" | "safe" | "caution" | "danger" | "closed" | "tide" | "sim";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Mandatory label for seeded/demo records — never present them as live. */
export function SimulatedBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="badge badge--sim" title="Seeded demonstration data — not a real, verified flood record.">
      Simulated
    </span>
  );
}

/** "Updated 5 min ago" with a stale warning past `staleAfterMs`. */
export function Freshness({
  at,
  staleAfterMs = 6 * 3600_000,
  prefix = "Updated",
  cached = false,
}: {
  at: unknown;
  staleAfterMs?: number;
  prefix?: string;
  cached?: boolean;
}) {
  const ms = toMillis(at);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const stale = ms != null && now - ms > staleAfterMs;
  return (
    <span
      className={`freshness ${stale ? "freshness--stale" : ""} ${cached ? "freshness--cached" : ""}`}
      title={ms ? new Date(ms).toLocaleString("en-PH") : undefined}
    >
      {cached ? "Cached · " : ""}
      {prefix} {formatAge(ms, now)}
      {stale ? " · may be outdated" : ""}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width="38%" />
          <Skeleton width="22%" />
          <Skeleton width="18%" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`callout callout--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      {title && <strong className="callout__title">{title}</strong>}
      <div className="callout__body">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2 className="page-head__title">{title}</h2>
        {subtitle && <p className="page-head__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

/** Gauge-style readout used in situation strips and dashboard headers. */
export function Readout({
  value,
  label,
  tone = "neutral",
  hint,
}: {
  value: ReactNode;
  label: string;
  tone?: Tone;
  hint?: ReactNode;
}) {
  return (
    <div className={`readout readout--${tone}`}>
      <span className="readout__value">{value}</span>
      <span className="readout__label">{label}</span>
      {hint && <span className="readout__hint">{hint}</span>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          className={`tabs__tab ${value === t.id ? "tabs__tab--active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`segmented__opt ${value === o.id ? "segmented__opt--on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal__head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className={`field ${error ? "field--error" : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

/** Two-step inline confirmation — avoids blocking browser dialogs. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm",
  className = "btn-secondary",
  disabled,
}: {
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <button
      type="button"
      className="btn-danger"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {busy ? "Working…" : confirmLabel}
    </button>
  ) : (
    <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
      {children}
    </button>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={onRowClick ? "data-table__row--click" : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className} data-label={typeof c.header === "string" ? c.header : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="data-table__empty">{empty}</div>}
    </div>
  );
}

// ---- Toasts --------------------------------------------------------------------

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function formatDateTime(value: unknown): string {
  const ms = toMillis(value);
  return ms ? new Date(ms).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function formatDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
