import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import AppShell from "../components/layout/AppShell";
import { Badge, Callout, Field, PageHeader, Segmented, formatDateTime, useToast } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { useFirestoreCollection } from "../hooks/useFirestoreCollection";
import { db } from "../firebase";
import { api, errorMessage } from "../lib/api";
import { AREA_NAMES } from "../../shared/areas";
import { dashboardPathFor } from "../../shared/roles";
import type { OrgApplication } from "../../shared/types";

type OrgKind = "business" | "lgu" | "enterprise";

/** Organization onboarding: business (instant) or LGU/enterprise (verified application). */
export default function GetStartedPage() {
  const [params] = useSearchParams();
  const { currentUser, isAnonymous, orgId, appRole, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [kind, setKind] = useState<OrgKind>((params.get("type") as OrgKind) || "business");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(currentUser?.email ?? "");
  const [areas, setAreas] = useState<string[]>([]);
  const [position, setPosition] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apps = useFirestoreCollection<OrgApplication>(
    () => (currentUser && !isAnonymous ? query(collection(db, "org_applications"), where("applicantUid", "==", currentUser.uid)) : null),
    (id, d) => ({ id, ...(d as Omit<OrgApplication, "id">) }),
    [currentUser?.uid]
  );

  if (!currentUser || isAnonymous) {
    return (
      <AppShell>
        <Callout tone="info" title="Create an account first">
          <Link to="/register">Create a free account</Link> (or <Link to="/login">sign in</Link>), then come back to set up your organization.
        </Callout>
      </AppShell>
    );
  }

  if (orgId) {
    return (
      <AppShell>
        <Callout tone="safe" title="You're already part of an organization">
          <Link to={dashboardPathFor(appRole)}>Open your dashboard</Link>.
        </Callout>
      </AppShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ orgId?: string; status: string }>("/orgs", {
        body: { type: kind, name, contactEmail: email, jurisdictionAreas: areas, position, message },
      });
      if (res.status === "active") {
        await refresh();
        toast("Organization created. Choose a plan to unlock fleet tools.", "safe");
        navigate("/business/billing");
      } else {
        toast("Application sent. The Bahadvisory team will verify it.", "safe");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Set up your organization" subtitle="Businesses can start right away. LGU and enterprise accounts are verified first, because they can publish official flood information or receive custom terms." />
      {apps.data.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">Your applications</h3>
          {apps.data.map((a) => (
            <p key={a.id} className="small">
              <Badge tone={a.status === "approved" ? "safe" : a.status === "rejected" ? "neutral" : "caution"}>{a.status}</Badge> {a.orgName} ({a.type}) · {formatDateTime(a.createdAt)}
              {a.status === "approved" && " — sign out and back in to open your dashboard."}
            </p>
          ))}
        </div>
      )}
      <form className="panel narrow-form" onSubmit={submit}>
        <Field label="Organization type">
          <Segmented
            label="Organization type"
            value={kind}
            onChange={setKind}
            options={[
              { id: "business", label: "Business" },
              { id: "lgu", label: "LGU / DRRM office" },
              { id: "enterprise", label: "Enterprise" },
            ]}
          />
        </Field>
        <Field label={kind === "lgu" ? "Office name" : "Organization name"}>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={160} placeholder={kind === "lgu" ? "e.g. Naujan MDRRMO" : "e.g. Mindoro Express Logistics"} />
        </Field>
        <Field label="Contact email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {kind === "lgu" && (
          <div className="field">
            <span className="field__label">Jurisdiction (municipalities)</span>
            <div className="chip-row">
              {AREA_NAMES.map((a) => (
                <button key={a} type="button" className={`chip-btn ${areas.includes(a) ? "chip-btn--solid" : ""}`} aria-pressed={areas.includes(a)} onClick={() => setAreas((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]))}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind !== "business" && (
          <>
            <Field label="Your position"><input value={position} onChange={(e) => setPosition(e.target.value)} maxLength={120} /></Field>
            <Field label={kind === "enterprise" ? "What do you need? (branches, integrations, volumes)" : "Message to the Bahadvisory team"}>
              <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500} />
            </Field>
          </>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        <button type="submit" disabled={busy}>{busy ? "Submitting…" : kind === "business" ? "Create business account" : "Send application"}</button>
      </form>
    </AppShell>
  );
}
