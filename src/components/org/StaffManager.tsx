import React, { useState } from "react";
import { collection, query } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, db } from "../../firebase";
import { Badge, Callout, ConfirmButton, DataTable, Field, Modal, Spinner, formatDateTime, useToast } from "../ui";
import { useAuth } from "../../contexts/AuthContext";
import { useMyOrg } from "../../hooks/useOrg";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { api, errorMessage } from "../../lib/api";
import UpgradeNotice from "../billing/UpgradeNotice";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type AppRole } from "../../../shared/roles";
import type { OrgMember } from "../../../shared/types";

const ORG_ROLES: Record<string, AppRole[]> = {
  lgu: ["lgu_staff", "lgu_admin"],
  business: ["business_staff", "business_admin"],
  enterprise: ["business_staff", "business_admin", "enterprise_admin"],
};

/** Staff management (paid: staffManagement). Roles are applied server-side as claims. */
export default function StaffManager({ billingPath }: { billingPath: string }) {
  const { orgId, appRole, currentUser } = useAuth();
  const { org, entitled } = useMyOrg();
  const toast = useToast();
  const { data: members } = useFirestoreCollection<OrgMember>(
    () => (orgId ? query(collection(db, "organizations", orgId, "members")) : null),
    (id, d) => ({ ...(d as Omit<OrgMember, "uid">), uid: id }),
    [orgId]
  );
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("lgu_staff");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  if (!orgId || !org) return <Callout tone="neutral">Your account isn't linked to an organization.</Callout>;
  const roles = (ORG_ROLES[org.type] ?? []).filter((r) => (ASSIGNABLE_ROLES[appRole] ?? []).includes(r));
  const isLgu = org.type === "lgu";
  const canManage = entitled("staffManagement") || appRole === "super_admin";

  const invite = async () => {
    setBusy(true);
    setLink(null);
    try {
      const res = await api<{ created: boolean; setPasswordLink: string | null }>(`/orgs/${orgId}/members`, {
        body: { email: email.trim(), name: name.trim(), role, assignedArea: isLgu ? area || org.jurisdictionAreas[0] : null },
      });
      if (res.created) {
        await sendPasswordResetEmail(auth, email.trim()).catch(() => undefined);
        setLink(res.setPasswordLink);
        toast("Account created — a set-password email was sent.", "safe");
      } else {
        toast("Existing account added to your organization.", "safe");
        setOpen(false);
      }
      setEmail("");
      setName("");
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };

  const update = (uid: string, body: Record<string, unknown>) =>
    api(`/orgs/${orgId}/members/${uid}`, { method: "PATCH", body }).then(() => toast("Member updated.", "safe")).catch((e) => toast(errorMessage(e), "danger"));

  return (
    <div className="stack">
      {!canManage && <UpgradeNotice feature="staffManagement" plan={isLgu ? "LGU Pro" : "Business Pro"} billingPath={billingPath} />}
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Team ({members.length})</h3>
          {canManage && <button onClick={() => { setRole(roles[0]); setOpen(true); }}>+ Invite member</button>}
        </div>
        <DataTable
          rows={members}
          rowKey={(m) => m.uid}
          empty="No members yet."
          columns={[
            { key: "n", header: "Member", render: (m) => (<div><strong>{m.name}</strong><div className="tiny">{m.email}</div></div>) },
            {
              key: "r",
              header: "Role",
              render: (m) =>
                canManage && m.uid !== currentUser?.uid && roles.includes(m.role) ? (
                  <select value={m.role} onChange={(e) => update(m.uid, { role: e.target.value })} aria-label={`Role for ${m.name}`}>
                    {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                ) : (
                  ROLE_LABELS[m.role] ?? m.role
                ),
            },
            ...(isLgu
              ? [{
                  key: "a",
                  header: "Area",
                  render: (m: OrgMember) =>
                    canManage && m.uid !== currentUser?.uid ? (
                      <select value={m.assignedArea ?? ""} onChange={(e) => update(m.uid, { assignedArea: e.target.value })} aria-label={`Area for ${m.name}`}>
                        {org.jurisdictionAreas.map((a) => <option key={a}>{a}</option>)}
                      </select>
                    ) : (m.assignedArea ?? "—"),
                }]
              : []),
            { key: "s", header: "Status", render: (m) => (m.active ? <Badge tone="safe">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>) },
            { key: "d", header: "Added", render: (m) => <span className="tiny">{formatDateTime(m.addedAt)}</span> },
            {
              key: "x",
              header: "",
              render: (m) =>
                canManage && m.uid !== currentUser?.uid ? (
                  <span className="row">
                    <button className="btn-ghost btn-sm" onClick={() => update(m.uid, { active: !m.active })}>{m.active ? "Deactivate" : "Reactivate"}</button>
                    <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Remove member" onConfirm={() => api(`/orgs/${orgId}/members/${m.uid}`, { method: "DELETE" }).then(() => toast("Removed.", "safe")).catch((e) => toast(errorMessage(e), "danger"))}>Remove</ConfirmButton>
                  </span>
                ) : null,
            },
          ]}
        />
        <p className="tiny">Deactivated or removed members keep a free citizen account; they lose access to your organization immediately.</p>
      </div>

      <Modal open={open} title="Invite a team member" onClose={() => setOpen(false)} footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Close</button><button onClick={invite} disabled={busy || !email || name.trim().length < 2}>{busy ? <Spinner /> : "Send invite"}</button></>}>
        <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div className="field-row">
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
          </Field>
          {isLgu && (
            <Field label="Assigned area">
              <select value={area || org.jurisdictionAreas[0]} onChange={(e) => setArea(e.target.value)}>{org.jurisdictionAreas.map((a) => <option key={a}>{a}</option>)}</select>
            </Field>
          )}
        </div>
        {link && (
          <Callout tone="info" title="Set-password link">
            If the email doesn't arrive, share this one-time link securely: <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </Callout>
        )}
      </Modal>
    </div>
  );
}
