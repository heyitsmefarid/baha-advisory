import React, { useState } from "react";
import { collection, collectionGroup, orderBy, query, limit, where } from "firebase/firestore";
import { db } from "../firebase";
import { useFirestoreCollection } from "../hooks/useFirestoreCollection";
import { ZoneHistoryEntry } from "../types";
import AppShell from "../components/layout/AppShell";
import { Badge, Callout, Freshness, PageHeader, SimulatedBadge, formatDateTime } from "../components/ui";
import { ALERT_SEVERITY } from "../lib/labels";
import type { Advisory } from "../../shared/types";

const ACTION_LABELS: Record<ZoneHistoryEntry["action"], string> = {
  created: "New zone reported",
  updated: "Update",
  cleared: "Cleared",
  deleted: "Removed",
};

/** Official advisories published by LGU DRRM offices (public, always free). */
function OfficialAdvisories() {
  const { data, loading, fromCache } = useFirestoreCollection<Advisory>(
    () => query(collection(db, "advisories"), where("status", "==", "published"), orderBy("publishedAt", "desc"), limit(20)),
    (id, d) => ({ id, ...(d as Omit<Advisory, "id">) }),
    []
  );
  const [lang, setLang] = useState<"en" | "fil">("en");
  if (loading) return <p className="muted">Loading official advisories…</p>;
  if (!data.length) return null;
  return (
    <section className="stack">
      <div className="spread">
        <h3 className="section-heading" style={{ margin: 0 }}>Official advisories</h3>
        <button className="btn-ghost btn-sm" onClick={() => setLang((l) => (l === "en" ? "fil" : "en"))}>{lang === "en" ? "Basahin sa Filipino" : "Read in English"}</button>
      </div>
      {fromCache && <Callout tone="caution">Showing saved advisories — they may be outdated until you're back online.</Callout>}
      {data.map((a) => (
        <article key={a.id} className={`alert-card alert-card--${a.severity}`}>
          <span className="row">
            <Badge tone={ALERT_SEVERITY[a.severity].tone}>{ALERT_SEVERITY[a.severity].label}</Badge>
            <Badge tone="neutral">{a.areas.join(", ")}</Badge>
            <SimulatedBadge show={!!a.simulated} />
          </span>
          <strong>{a.title}</strong>
          <p className="small advisory-body">{lang === "fil" && a.bodyFil ? a.bodyFil : a.body}</p>
          <span className="tiny">
            {a.createdByName} · <Freshness at={a.publishedAt} prefix="published" />
          </span>
        </article>
      ))}
    </section>
  );
}

export default function AdvisoriesPage() {
  const { data: entries, loading, error } = useFirestoreCollection<ZoneHistoryEntry>(
    () => query(collectionGroup(db, "updates"), orderBy("timestamp", "desc"), limit(50)),
    (id, data) => ({ id, zoneId: "", ...(data as Omit<ZoneHistoryEntry, "id" | "zoneId">) }),
    []
  );

  return (
    <AppShell>
      <PageHeader title="Advisories" subtitle="Official advisories from your LGU's DRRM office, followed by the live log of flood-zone updates." />
      <div className="advisories-page">
        <OfficialAdvisories />
        <h3 className="section-heading">Recent Advisories</h3>
        {loading && <p className="muted">Loading advisories…</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="advisories-list">
          {entries.map((e) => (
            <div key={e.id} className="advisory-card">
              <div className="advisory-card__tag">{ACTION_LABELS[e.action]}</div>
              <h4>{e.zoneName}</h4>
              <p className="advisory-card__meta">
                by {e.editorName} · {e.timestamp ? formatDateTime(e.timestamp) : "just now"}
              </p>
            </div>
          ))}
          {!loading && entries.length === 0 && <p className="muted">No advisories yet.</p>}
        </div>
      </div>
    </AppShell>
  );
}
