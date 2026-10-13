import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDocs, limit, query, updateDoc, writeBatch } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import AppShell from "../components/layout/AppShell";
import { Badge, Callout, ConfirmButton, EmptyState, Field, PageHeader, useToast } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { useEmergencyContacts, useNotifications, useSavedLocations } from "../hooks/useUserData";
import { useInstallPrompt } from "../lib/pwa";
import { auth, db } from "../firebase";
import { ROLE_LABELS, dashboardPathFor } from "../../shared/roles";

function Contacts({ uid }: { uid: string }) {
  const { data } = useEmergencyContacts();
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const add = async () => {
    try {
      await addDoc(collection(db, "users", uid, "emergency_contacts"), { name: name.trim(), phone: phone.trim(), relationship: relationship.trim() });
      setName("");
      setPhone("");
      setRelationship("");
    } catch {
      toast("Couldn't save the contact.", "danger");
    }
  };
  return (
    <div className="panel">
      <h3 className="panel__title">Emergency contacts</h3>
      <p className="tiny">Used by SOS to text your location in one tap. Stored privately; saved to this device for offline use.</p>
      <ul className="list-plain">
        {data.map((c) => (
          <li key={c.id} className="draft-row">
            <span className="small"><strong>{c.name}</strong> {c.relationship ? `· ${c.relationship}` : ""} · {c.phone}</span>
            <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Remove" onConfirm={() => deleteDoc(doc(db, "users", uid, "emergency_contacts", c.id))}>Remove</ConfirmButton>
          </li>
        ))}
      </ul>
      <div className="field-row">
        <Field label="Name"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile number"><input type="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxxx" /></Field>
        <Field label="Relationship"><input value={relationship} maxLength={40} onChange={(e) => setRelationship(e.target.value)} /></Field>
      </div>
      <button className="btn-secondary btn-sm" onClick={add} disabled={!name.trim() || !phone.trim()}>Add contact</button>
    </div>
  );
}

export default function AccountPage() {
  const [params] = useSearchParams();
  const { currentUser, isAnonymous, appRole, orgId, assignedArea } = useAuth();
  const saved = useSavedLocations();
  const notifications = useNotifications();
  const toast = useToast();
  const { canInstall, install, installed } = useInstallPrompt();
  const [name, setName] = useState(currentUser?.displayName ?? "");

  if (!currentUser || isAnonymous) {
    return (
      <AppShell>
        <EmptyState title="Sign in to manage your account" action={<Link className="chip-btn chip-btn--solid" to="/login">Sign in</Link>}>
          Public flood information, alerts, navigation and evacuation centers work without an account.
        </EmptyState>
      </AppShell>
    );
  }

  const saveName = async () => {
    try {
      await updateProfile(auth.currentUser!, { displayName: name.trim() });
      await updateDoc(doc(db, "users", currentUser.uid), { name: name.trim() });
      toast("Name updated.", "safe");
    } catch {
      toast("Couldn't update your name.", "danger");
    }
  };

  const clearChat = async () => {
    const snap = await getDocs(query(collection(db, "ai_chat_history", currentUser.uid, "messages"), limit(400)));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    toast(`Deleted ${snap.size} saved chat message(s).`, "safe");
  };

  const unread = notifications.data.filter((n) => !n.read).length;
  return (
    <AppShell>
      {params.get("welcome") && (
        <Callout tone="safe" title="Welcome to Bahadvisory">
          Add your home, school or workplace in <Link to="/alerts">Alerts</Link> to get flood warnings for those places, and add emergency contacts below for SOS.
        </Callout>
      )}
      <PageHeader title="My account" subtitle={currentUser.email ?? undefined} />
      <div className="grid-2">
        <div className="stack">
          <div className="panel">
            <h3 className="panel__title">Profile</h3>
            <Field label="Display name">
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <button className="btn-secondary btn-sm" onClick={saveName} disabled={!name.trim()}>Save</button>
            <p className="small" style={{ marginTop: "1em" }}>
              Role: <Badge tone="tide">{ROLE_LABELS[appRole]}</Badge> {assignedArea ? `· ${assignedArea}` : ""}
            </p>
            {orgId ? (
              <Link className="chip-btn chip-btn--solid" to={dashboardPathFor(appRole)}>Open my organization's dashboard</Link>
            ) : (
              <p className="tiny">Work for an LGU or a business? <Link to="/get-started">Set up your organization</Link>.</p>
            )}
          </div>
          <Contacts uid={currentUser.uid} />
        </div>
        <div className="stack">
          <div className="panel">
            <h3 className="panel__title">Alerts & places</h3>
            <p className="small">{saved.data.length} saved place(s) · {unread} unread notification(s)</p>
            <Link className="chip-btn" to="/alerts">Manage alerts and saved places</Link>
          </div>
          <div className="panel">
            <h3 className="panel__title">My flood reports</h3>
            <Link className="chip-btn" to="/report">View and send reports</Link>
          </div>
          <div className="panel">
            <h3 className="panel__title">Offline & app</h3>
            <p className="small">The offline safety kit keeps hotlines, your contacts, alerts and evacuation centers on this device.</p>
            <div className="btn-row">
              <Link className="chip-btn" to="/offline">Open offline safety kit</Link>
              {!installed && canInstall && <button className="btn-secondary btn-sm" onClick={install}>Install app</button>}
            </div>
          </div>
          <div className="panel">
            <h3 className="panel__title">Privacy</h3>
            <p className="small">Your exact location is only stored when you send a report or SOS. Photos are stripped of embedded GPS data before upload.</p>
            <ConfirmButton className="btn-secondary btn-sm" confirmLabel="Delete chat history" onConfirm={clearChat}>Delete my Baha AI chat history</ConfirmButton>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
