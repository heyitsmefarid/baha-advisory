import React, { useState } from "react";
import { addDoc, collection, doc, limit, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import LocationPicker, { type PickedLocation } from "../../components/map/LocationPicker";
import { Badge, Callout, ConfirmButton, DataTable, Field, Freshness, PageHeader, SimulatedBadge, Spinner, Tabs, formatDateTime, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useActiveAlerts } from "../../hooks/useAlerts";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { ALERT_SEVERITY } from "../../lib/labels";
import { AREA_NAMES, nearestArea } from "../../../shared/areas";
import { canManageArea } from "../../../shared/roles";
import type { Advisory, AlertSeverity, AlertType } from "../../../shared/types";
import { geographicReferenceForArea } from "../../lib/geographicReference";

type Tab = "advisories" | "alerts";
const SEVERITIES: AlertSeverity[] = ["info", "moderate", "high", "critical"];

interface Draft {
  title: string;
  body: string;
  bodyFil: string;
  severity: AlertSeverity;
}

function AdvisoryComposer() {
  const { currentUser, orgId, role, assignedArea, areas, appRole } = useAuth();
  const toast = useToast();
  const myAreas = appRole === "super_admin" || role === "admin" ? AREA_NAMES : ([...new Set([assignedArea, ...areas].filter(Boolean))] as string[]);
  const [selAreas, setSelAreas] = useState<string[]>(myAreas.slice(0, 1));
  const [severity, setSeverity] = useState<AlertSeverity>("moderate");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [meta, setMeta] = useState<{ provider: string; model: string; disclaimer: string; facts: { zones: number; roads: number; centers: number; simulated: boolean } } | null>(null);
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy("ai");
    setError(null);
    try {
      const res = await api<{ draft: Draft; provider: string; model: string; disclaimer: string; facts: { zones: number; roads: number; centers: number; simulated: boolean } }>(
        "/ai/advisory-draft",
        { body: { areas: selAreas, severity, notes } }
      );
      setDraft(res.draft);
      setMeta(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft || !currentUser) return;
    setBusy("save");
    setError(null);
    try {
      await addDoc(collection(db, "advisories"), {
        orgId: orgId ?? "platform",
        title: draft.title.trim(),
        body: draft.body.trim(),
        bodyFil: draft.bodyFil.trim(),
        severity: draft.severity,
        areas: selAreas,
        areaPsgcCodes: selAreas.map((area) => geographicReferenceForArea(area, currentUser.uid).municipalityPsgcCode),
        status: "draft",
        aiDrafted: meta?.provider !== "simulated",
        aiModel: meta?.model ?? null,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email || "DRRM staff",
        createdAt: serverTimestamp(),
        publishedAt: null,
        publishedBy: null,
      });
      toast("Draft saved. Review it, then publish from the list.", "safe");
      setDraft(null);
      setMeta(null);
      setNotes("");
    } catch {
      setError("Couldn't save — check the areas are within your jurisdiction.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel__title">Draft an advisory</h3>
      <p className="tiny">
        Baha AI writes a first draft (English + Filipino) from the verified flood zones, road conditions and evacuation centers for the selected areas. You
        review and edit everything before publishing.
      </p>
      <div className="field">
        <span className="field__label">Areas</span>
        <div className="chip-row">
          {myAreas.map((a) => (
            <button
              key={a}
              type="button"
              className={`chip-btn ${selAreas.includes(a) ? "chip-btn--solid" : ""}`}
              aria-pressed={selAreas.includes(a)}
              onClick={() => setSelAreas((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]))}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row">
        <Field label="Severity">
          <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {ALERT_SEVERITY[s].label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Officer's notes (optional)" hint="Facts you want included, e.g. class suspensions, specific instructions.">
        <textarea rows={2} maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <button type="button" onClick={generate} disabled={busy !== null || selAreas.length === 0}>
        {busy === "ai" ? <><Spinner /> Drafting…</> : "Draft with Baha AI"}
      </button>
      {error && <Callout tone="danger">{error}</Callout>}

      {draft && meta && (
        <div className="advisory-draft">
          <div className="row">
            <Badge tone={meta.provider === "simulated" ? "neutral" : "tide"}>
              {meta.provider === "simulated" ? "Template draft (AI unavailable)" : `Drafted by ${meta.provider}`}
            </Badge>
            <span className="tiny">
              Based on {meta.facts.zones} zone(s), {meta.facts.roads} road condition(s), {meta.facts.centers} center(s)
              {meta.facts.simulated ? " — includes SIMULATED data" : ""}
            </span>
          </div>
          <Callout tone="caution">{meta.disclaimer}</Callout>
          <Field label="Title">
            <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Advisory (English)">
            <textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <Field label="Abiso (Filipino)">
            <textarea rows={6} value={draft.bodyFil} onChange={(e) => setDraft({ ...draft, bodyFil: e.target.value })} />
          </Field>
          <Field label="Severity">
            <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as AlertSeverity })}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {ALERT_SEVERITY[s].label}
                </option>
              ))}
            </select>
          </Field>
          <div className="btn-row">
            <button type="button" onClick={save} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save as draft"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdvisoryList() {
  const { orgId, appRole, role, assignedArea, areas } = useAuth();
  const claims = { role, assignedArea, areas };
  const toast = useToast();
  const seesAll = appRole === "super_admin";
  const { data } = useFirestoreCollection<Advisory>(
    () =>
      seesAll
        ? query(collection(db, "advisories"), orderBy("createdAt", "desc"), limit(50))
        : orgId
        ? query(collection(db, "advisories"), where("orgId", "==", orgId), orderBy("createdAt", "desc"), limit(50))
        : query(collection(db, "advisories"), where("status", "==", "published"), orderBy("publishedAt", "desc"), limit(50)),
    (id, d) => ({ id, ...(d as Omit<Advisory, "id">) }),
    [orgId, seesAll]
  );
  const [sendAlert, setSendAlert] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const publish = async (a: Advisory) => {
    setBusy(a.id);
    try {
      const res = await api<{ alerts: { matchedUsers: number }[] }>(`/advisories/${a.id}/publish`, { body: { sendAlert, alertRadiusM: 8000 } });
      const reached = res.alerts.reduce((s, x) => s + x.matchedUsers, 0);
      toast(`Published.${sendAlert ? ` Alert delivered to ${reached} nearby user(s).` : ""}`, "safe");
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel__head">
        <h3 className="panel__title">Advisories</h3>
        <label className="check-row tiny">
          <input type="checkbox" checked={sendAlert} onChange={(e) => setSendAlert(e.target.checked)} /> Also alert residents when publishing
        </label>
      </div>
      <DataTable
        rows={data}
        rowKey={(a) => a.id}
        empty="No advisories yet."
        columns={[
          {
            key: "t",
            header: "Advisory",
            render: (a) => (
              <div>
                <strong>{a.title}</strong>
                <div className="tiny">{a.areas.join(", ")} · {a.createdByName}</div>
              </div>
            ),
          },
          {
            key: "s",
            header: "Status",
            render: (a) => (
              <span className="row">
                <Badge tone={a.status === "published" ? "safe" : a.status === "draft" ? "caution" : "neutral"}>{a.status}</Badge>
                <Badge tone={ALERT_SEVERITY[a.severity].tone}>{ALERT_SEVERITY[a.severity].label}</Badge>
                {a.aiDrafted && <Badge tone="tide">AI draft</Badge>}
                <SimulatedBadge show={!!a.simulated} />
              </span>
            ),
          },
          { key: "d", header: "Date", render: (a) => <span className="tiny">{formatDateTime(a.publishedAt ?? a.createdAt)}</span> },
          {
            key: "a",
            header: "",
            render: (a) =>
              a.status === "draft" && a.areas.every((x) => canManageArea(claims, x)) ? (
                <span className="row">
                  <ConfirmButton className="btn-safe btn-sm" confirmLabel="Publish now" onConfirm={() => publish(a)} disabled={busy === a.id}>
                    Publish
                  </ConfirmButton>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => updateDoc(doc(db, "advisories", a.id), { status: "archived" }).catch(() => toast("Couldn't archive.", "danger"))}
                  >
                    Archive
                  </button>
                </span>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

function AlertIssuer() {
  const { currentUser } = useAuth();
  const toast = useToast();
  const [type, setType] = useState<AlertType>("flood");
  const [severity, setSeverity] = useState<AlertSeverity>("high");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loc, setLoc] = useState<PickedLocation | null>(null);
  const [radius, setRadius] = useState(3000);
  const [hours, setHours] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setError(null);
    if (!loc || !currentUser) return setError("Place the alert center on the map.");
    setBusy(true);
    try {
      const res = await api<{ matchedUsers: number; pushNote: string }>("/alerts", {
        body: {
          type,
          severity,
          title,
          body,
          center: { lat: loc.point[0], lng: loc.point[1] },
          radiusM: radius,
          expiresInHours: hours,
          ...geographicReferenceForArea(nearestArea(loc.point[0], loc.point[1]).name, currentUser.uid),
        },
      });
      toast(`Alert issued — ${res.matchedUsers} user(s) notified in-app. ${res.pushNote}`, "safe");
      setTitle("");
      setBody("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel__title">Issue a location alert</h3>
      <p className="tiny">Alerts are public, free, and sent to people whose saved places or current area fall inside the radius.</p>
      <div className="field-row">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as AlertType)}>
            <option value="flood">Flooding</option>
            <option value="road_closure">Road closure</option>
            <option value="evacuation">Evacuation</option>
            <option value="advisory">General advisory</option>
          </select>
        </Field>
        <Field label="Severity">
          <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{ALERT_SEVERITY[s].label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Title"><input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pre-emptive evacuation: riverside barangays" /></Field>
      <Field label="Message"><textarea rows={3} maxLength={1200} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <LocationPicker value={loc} onChange={setLoc} height={220} />
      <div className="field-row">
        <Field label="Radius (m)"><input type="number" min={200} max={50000} step={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></Field>
        <Field label="Expires after (hours)"><input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <button onClick={issue} disabled={busy || title.length < 5 || body.length < 5}>{busy ? "Issuing…" : "Issue alert"}</button>
    </div>
  );
}

function ActiveAlerts() {
  const { data } = useActiveAlerts();
  const { role, assignedArea, areas } = useAuth();
  const claims = { role, assignedArea, areas };
  const toast = useToast();
  return (
    <div className="panel">
      <h3 className="panel__title">Active public alerts</h3>
      <DataTable
        rows={data}
        rowKey={(a) => a.id}
        empty="No active alerts."
        columns={[
          { key: "t", header: "Alert", render: (a) => (<div><strong>{a.title}</strong><div className="tiny">{a.area} · {a.radiusM} m · {a.issuedByName}</div></div>) },
          { key: "s", header: "Severity", render: (a) => (<span className="row"><Badge tone={ALERT_SEVERITY[a.severity].tone}>{ALERT_SEVERITY[a.severity].label}</Badge><SimulatedBadge show={!!a.simulated} /></span>) },
          { key: "r", header: "Reached", render: (a) => <span className="mono">{a.matchedUsers ?? 0} users · {a.pushSent ?? 0} push</span> },
          { key: "c", header: "Issued", render: (a) => <Freshness at={a.createdAt} prefix="" /> },
          { key: "x", header: "", render: (a) => canManageArea(claims, a.area) ? (
            <ConfirmButton className="btn-ghost btn-sm" confirmLabel="End alert" onConfirm={() => api(`/alerts/${a.id}/deactivate`, { method: "POST" }).then(() => toast("Alert ended.", "safe")).catch((e) => toast(errorMessage(e), "danger"))}>End</ConfirmButton>
          ) : null },
        ]}
      />
    </div>
  );
}

export default function AdvisoriesAdminPage() {
  const [tab, setTab] = useState<Tab>("advisories");
  return (
    <AdminLayout>
      <PageHeader title="Advisories & alerts" subtitle="Draft advisories with AI help, review, then publish. Publishing also sends location alerts to residents who opted in." />
      <Tabs<Tab> label="Advisories and alerts" value={tab} onChange={setTab} tabs={[{ id: "advisories", label: "Advisories" }, { id: "alerts", label: "Location alerts" }]} />
      {tab === "advisories" ? (
        <div className="grid-2">
          <AdvisoryComposer />
          <AdvisoryList />
        </div>
      ) : (
        <div className="grid-2">
          <AlertIssuer />
          <ActiveAlerts />
        </div>
      )}
    </AdminLayout>
  );
}
