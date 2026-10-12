import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import AppShell from "../components/layout/AppShell";
import LocationPicker, { type PickedLocation } from "../components/map/LocationPicker";
import { Badge, Callout, ConfirmButton, EmptyState, Field, Freshness, PageHeader, SimulatedBadge, Spinner, formatDateTime, formatDistance, useToast } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { useActiveAlerts } from "../hooks/useAlerts";
import { useNotifications, useSavedLocations } from "../hooks/useUserData";
import { useFirestoreDoc } from "../hooks/useFirestoreDoc";
import { alertRelevance } from "../hooks/useAlertWatcher";
import { db } from "../firebase";
import { disablePush, enablePush } from "../lib/push";
import { ALERT_SEVERITY } from "../lib/labels";
import { toPt, type Pt } from "../../shared/geo";
import { DEFAULT_ALERT_PREFERENCES, type AlertPreferences, type AlertSeverity, type SavedLocationLabel, type UserProfile } from "../../shared/types";

const LABEL_TEXT: Record<SavedLocationLabel, string> = { home: "Home", school: "School", work: "Work", other: "Other" };

function SavedPlaces({ uid }: { uid: string }) {
  const { data } = useSavedLocations();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState<SavedLocationLabel>("home");
  const [name, setName] = useState("");
  const [loc, setLoc] = useState<PickedLocation | null>(null);
  const [radius, setRadius] = useState(2000);

  const save = async () => {
    if (!loc) return toast("Set the place on the map.", "caution");
    try {
      await addDoc(collection(db, "users", uid, "saved_locations"), {
        label,
        name: name.trim() || LABEL_TEXT[label],
        location: { lat: loc.point[0], lng: loc.point[1] },
        alertRadiusM: radius,
        createdAt: serverTimestamp(),
      });
      toast("Place saved — you'll be alerted about flooding near it.", "safe");
      setAdding(false);
      setName("");
      setLoc(null);
    } catch {
      toast("Couldn't save this place.", "danger");
    }
  };

  return (
    <div className="panel">
      <div className="panel__head">
        <h3 className="panel__title">Saved places</h3>
        {!adding && <button className="btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add place</button>}
      </div>
      {data.length === 0 && !adding && <p className="small muted">Save your home, school or workplace to get alerts for those areas even when you're elsewhere.</p>}
      <ul className="list-plain">
        {data.map((s) => (
          <li key={s.id} className="draft-row">
            <div>
              <strong className="small">{LABEL_TEXT[s.label]} · {s.name}</strong>
              <div className="tiny">Alerts within {formatDistance(s.alertRadiusM)}</div>
            </div>
            <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Remove" onConfirm={() => deleteDoc(doc(db, "users", uid, "saved_locations", s.id))}>Remove</ConfirmButton>
          </li>
        ))}
      </ul>
      {adding && (
        <div className="stack">
          <div className="field-row">
            <Field label="Type">
              <select value={label} onChange={(e) => setLabel(e.target.value as SavedLocationLabel)}>
                {(Object.keys(LABEL_TEXT) as SavedLocationLabel[]).map((l) => <option key={l} value={l}>{LABEL_TEXT[l]}</option>)}
              </select>
            </Field>
            <Field label="Name"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lola's house" /></Field>
            <Field label="Alert radius (m)"><input type="number" min={100} max={50000} step={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></Field>
          </div>
          <LocationPicker value={loc} onChange={setLoc} height={220} />
          <div className="btn-row">
            <button onClick={save}>Save place</button>
            <button className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Preferences({ uid, profile }: { uid: string; profile: UserProfile | null }) {
  const toast = useToast();
  const prefs: AlertPreferences = { ...DEFAULT_ALERT_PREFERENCES, ...(profile?.alertPrefs ?? {}) };
  const [busy, setBusy] = useState(false);
  const save = (patch: Partial<AlertPreferences>) =>
    updateDoc(doc(db, "users", uid), { alertPrefs: { ...prefs, ...patch } }).catch(() => toast("Couldn't save preferences.", "danger"));

  const togglePush = async () => {
    setBusy(true);
    try {
      if (prefs.pushEnabled) {
        await disablePush(uid);
        toast("Push notifications turned off for this device.", "info");
      } else {
        const res = await enablePush(uid);
        toast(res.ok ? "Push notifications are on for this device." : res.reason ?? "Couldn't enable push.", res.ok ? "safe" : "caution");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel__title">Alert preferences</h3>
      <label className="check-row"><input type="checkbox" checked={prefs.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Notify me about flooding near my places</label>
      <div className="field-row">
        <Field label="Default radius (m)" hint="Used for your current location.">
          <input type="number" min={500} max={50000} step={500} value={prefs.radiusM} onChange={(e) => save({ radiusM: Number(e.target.value) })} />
        </Field>
        <Field label="Minimum severity">
          <select value={prefs.minSeverity} onChange={(e) => save({ minSeverity: e.target.value as AlertSeverity })}>
            {(["info", "moderate", "high", "critical"] as AlertSeverity[]).map((s) => <option key={s} value={s}>{ALERT_SEVERITY[s].label} and above</option>)}
          </select>
        </Field>
      </div>
      <div className="field">
        <span className="field__label">Alert types</span>
        {(Object.keys(prefs.types) as (keyof AlertPreferences["types"])[]).map((k) => (
          <label key={k} className="check-row">
            <input type="checkbox" checked={prefs.types[k]} onChange={(e) => save({ types: { ...prefs.types, [k]: e.target.checked } })} />
            {{ flood: "Flooding", roadClosure: "Road closures", evacuation: "Evacuation", advisory: "Official advisories" }[k]}
          </label>
        ))}
      </div>
      <div className="spread">
        <span className="small">Push notifications {prefs.pushEnabled ? <Badge tone="safe">On</Badge> : <Badge tone="neutral">Off</Badge>}</span>
        <button className="btn-secondary btn-sm" onClick={togglePush} disabled={busy}>{busy ? <Spinner /> : prefs.pushEnabled ? "Turn off" : "Turn on for this device"}</button>
      </div>
      <p className="tiny">Critical public-safety alerts are always free. Push works when the app is installed or open in a supported browser.</p>
    </div>
  );
}

function History() {
  const { data } = useNotifications();
  const { currentUser } = useAuth();
  if (!currentUser) return null;
  return (
    <div className="panel">
      <h3 className="panel__title">Alert history</h3>
      {data.length === 0 ? (
        <p className="small muted">No notifications yet.</p>
      ) : (
        <ul className="list-plain">
          {data.slice(0, 30).map((n) => (
            <li key={n.id} className={`draft-row ${n.read ? "" : "notif--unread"}`}>
              <div>
                <span className="row">
                  {n.severity && <Badge tone={ALERT_SEVERITY[n.severity].tone}>{ALERT_SEVERITY[n.severity].label}</Badge>}
                  <Badge tone="neutral">{n.kind}</Badge>
                </span>
                <strong className="small">{n.title}</strong>
                <div className="tiny">{n.body}</div>
                <div className="tiny">{formatDateTime(n.createdAt)}</div>
              </div>
              {!n.read && <button className="btn-ghost btn-sm" onClick={() => updateDoc(doc(db, "users", currentUser.uid, "notifications", n.id), { read: true })}>Mark read</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const [params] = useSearchParams();
  const focusId = params.get("alert");
  const { currentUser, isAnonymous } = useAuth();
  const alerts = useActiveAlerts();
  const saved = useSavedLocations();
  const profile = useFirestoreDoc<UserProfile>(() => (currentUser && !isAnonymous ? doc(db, "users", currentUser.uid) : null), [currentUser?.uid]);
  const [here, setHere] = useState<Pt | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((st) => {
      if (st.state === "granted") navigator.geolocation.getCurrentPosition((p) => setHere([p.coords.latitude, p.coords.longitude]), () => undefined, { maximumAge: 120_000 });
    }).catch(() => undefined);
  }, []);

  const radius = profile.data?.alertPrefs?.radiusM ?? DEFAULT_ALERT_PREFERENCES.radiusM;
  const places = useMemo(
    () => [...saved.data.map((s) => ({ name: s.name, pt: toPt(s.location), radiusM: s.alertRadiusM })), ...(here ? [{ name: "your location", pt: here, radiusM: radius }] : [])],
    [saved.data, here, radius]
  );
  const rows = useMemo(
    () =>
      alerts.data
        .map((a) => ({ a, rel: alertRelevance(a, places) }))
        .sort((x, y) => Number(!!y.rel) - Number(!!x.rel) || Number(y.a.id === focusId) - Number(x.a.id === focusId)),
    [alerts.data, places, focusId]
  );
  const nearCount = rows.filter((r) => r.rel).length;

  return (
    <AppShell>
      <PageHeader title="Flood alerts" subtitle="Official alerts from your LGU's DRRM office. Always free — no account needed to view them." />
      {alerts.fromCache && <Callout tone="caution">Showing alerts saved on this device. They may be outdated until you're back online.</Callout>}
      <div className="grid-2">
        <div className="stack">
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">{places.length ? `${nearCount} alert${nearCount === 1 ? "" : "s"} near you` : "Active alerts"}</h3>
              {!here && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={locating}
                  onClick={() => {
                    setLocating(true);
                    navigator.geolocation.getCurrentPosition(
                      (p) => {
                        setHere([p.coords.latitude, p.coords.longitude]);
                        setLocating(false);
                      },
                      () => setLocating(false),
                      { enableHighAccuracy: false, timeout: 10_000 }
                    );
                  }}
                >
                  {locating ? <Spinner /> : "Use my location"}
                </button>
              )}
            </div>
            {alerts.loading ? (
              <p className="muted">Loading…</p>
            ) : rows.length === 0 ? (
              <EmptyState title="No active alerts">There are no active flood alerts right now. Check the map for current conditions.</EmptyState>
            ) : (
              <ul className="list-plain alert-list">
                {rows.map(({ a, rel }) => (
                  <li key={a.id} className={`alert-card alert-card--${a.severity} ${a.id === focusId ? "alert-card--focus" : ""}`}>
                    <div className="row">
                      <Badge tone={ALERT_SEVERITY[a.severity].tone}>{ALERT_SEVERITY[a.severity].label}</Badge>
                      <Badge tone="neutral">{a.type.replace("_", " ")}</Badge>
                      {rel && <Badge tone="info">Near {rel.place} · {formatDistance(rel.distanceM)}</Badge>}
                      <SimulatedBadge show={!!a.simulated} />
                    </div>
                    <strong>{a.title}</strong>
                    <p className="small">{a.body}</p>
                    <span className="tiny">
                      {a.area} · {a.issuedByName} · <Freshness at={a.createdAt} prefix="issued" />
                    </span>
                    <div className="btn-row">
                      <Link className="chip-btn" to={`/navigate?to=${a.center.lat},${a.center.lng}&toName=${encodeURIComponent(a.area)}`}>Check a safe route</Link>
                      <Link className="chip-btn" to="/evacuation">Evacuation centers</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="stack">
          {currentUser && !isAnonymous ? (
            <>
              <SavedPlaces uid={currentUser.uid} />
              <Preferences uid={currentUser.uid} profile={profile.data} />
              <History />
            </>
          ) : (
            <EmptyState title="Get alerts for the places you care about" action={<Link className="chip-btn chip-btn--solid" to="/register">Create a free account</Link>}>
              Save your home, school or workplace and turn on notifications. Viewing alerts never needs an account.
            </EmptyState>
          )}
        </div>
      </div>
    </AppShell>
  );
}
