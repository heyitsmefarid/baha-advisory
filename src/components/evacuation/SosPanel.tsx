import React, { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useEmergencyContacts } from "../../hooks/useUserData";
import { readLocal, writeLocal } from "../../lib/storage";
import { Badge, Callout, Field, Spinner, formatDateTime } from "../ui";
import { nearestArea, isWithinServiceBounds } from "../../../shared/areas";
import type { SosRequest } from "../../../shared/types";
import { useGeographicScope } from "../../contexts/GeographicScopeContext";
import { legacyAreaToMunicipality, MINDORO_REGION_PSGC } from "../../../shared/geography";

const ACTIVE_SOS_KEY = "bahadvisory_active_sos_v1";
const QUICK = ["Trapped by rising water", "Need help evacuating", "Medical emergency", "Elderly / PWD needs assistance"];

function shareText(lat: number, lng: number, msg: string) {
  const link = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=18/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  return `SOS from Bahadvisory: ${msg}. My location: ${link}`;
}

/**
 * SOS location sharing. The request goes to LGU responders; "help is on
 * the way" is shown ONLY when a DRRM officer acknowledges it — the app
 * never implies a confirmation it doesn't have.
 */
export default function SosPanel({ onClose }: { onClose?: () => void }) {
  const geographic = useGeographicScope();
  const { currentUser } = useAuth();
  const contacts = useEmergencyContacts();
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [message, setMessage] = useState(QUICK[0]);
  const [people, setPeople] = useState(1);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => readLocal<string | null>(ACTIVE_SOS_KEY, null));
  const [active, setActive] = useState<SosRequest | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return setLocError("Location isn't available on this device.");
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => setLocError("Allow location access so responders can find you. You can still call 911."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (!activeId || !currentUser) return;
    return onSnapshot(
      doc(db, "sos_requests", activeId),
      (snap) => {
        if (!snap.exists()) return;
        const data = { id: snap.id, ...(snap.data() as Omit<SosRequest, "id">) };
        setActive(data);
        if (data.status === "resolved" || data.status === "cancelled") writeLocal(ACTIVE_SOS_KEY, null);
      },
      () => undefined
    );
  }, [activeId, currentUser]);

  const send = async () => {
    if (!pos) return setError("Waiting for your location…");
    if (!isWithinServiceBounds(pos.lat, pos.lng)) return setError("You appear to be outside Mindoro Island. Call 911 directly.");
    setSending(true);
    setError(null);
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      const uid = auth.currentUser!.uid;
      const fallbackMunicipality = legacyAreaToMunicipality(nearestArea(pos.lat, pos.lng).name);
      const municipality = geographic.municipality ?? fallbackMunicipality;
      if (!municipality?.provincePsgcCode) throw new Error("Unsupported Mindoro location");
      const ref = await addDoc(collection(db, "sos_requests"), {
        uid,
        name: auth.currentUser?.displayName ?? null,
        phone: phone.trim() || null,
        location: { lat: pos.lat, lng: pos.lng },
        accuracyM: pos.accuracy,
        area: nearestArea(pos.lat, pos.lng).name,
        message: message.slice(0, 1000),
        peopleCount: people,
        status: "open",
        acknowledgedBy: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        regionPsgcCode: MINDORO_REGION_PSGC,
        provincePsgcCode: municipality.provincePsgcCode,
        municipalityPsgcCode: municipality.psgcCode,
        barangayPsgcCode: geographic.barangay?.municipalityPsgcCode === municipality.psgcCode ? geographic.barangay.psgcCode : null,
        locationAssignment: {
          method: geographic.municipality ? "manual" : "migrated",
          confidence: geographic.barangay ? "high" : geographic.municipality ? "medium" : "review_required",
          sourceVersion: municipality.sourceVersion,
          assignedAt: Date.now(),
          assignedBy: uid,
        },
      });
      setActiveId(ref.id);
      writeLocal(ACTIVE_SOS_KEY, ref.id);
    } catch {
      setError("Couldn't send your SOS. Call 911 now, or share your location with your contacts below.");
    } finally {
      setSending(false);
    }
  };

  const cancel = async () => {
    if (!active) return;
    await updateDoc(doc(db, "sos_requests", active.id), { status: "cancelled", updatedAt: serverTimestamp() }).catch(() => undefined);
    writeLocal(ACTIVE_SOS_KEY, null);
    setActiveId(null);
    setActive(null);
  };

  const share = async () => {
    if (!pos) return;
    const text = shareText(pos.lat, pos.lng, message);
    if (navigator.share) {
      await navigator.share({ title: "SOS — Bahadvisory", text }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      setError("Location message copied — paste it into a text to your contacts.");
    }
  };

  return (
    <section className="sos-panel" aria-labelledby="sos-title">
      <div className="spread">
        <h2 id="sos-title" className="sos-panel__title">
          Request help
        </h2>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close SOS">
            ×
          </button>
        )}
      </div>
      <a className="sos-call" href="tel:911">
        Call 911
      </a>

      {active && active.status !== "cancelled" ? (
        <div className={`sos-status sos-status--${active.status}`} aria-live="polite">
          {active.status === "open" && (
            <>
              <strong>SOS sent — waiting for a DRRM responder to confirm.</strong>
              <p className="small">Sent {formatDateTime(active.createdAt)}. Keep this page open and your phone charged. If your situation gets worse, call 911.</p>
            </>
          )}
          {active.status === "acknowledged" && (
            <>
              <Badge tone="safe">Confirmed by DRRM</Badge>
              <strong> {active.acknowledgedByName ?? "A responder"} has acknowledged your request.</strong>
              {active.responderNote && <p className="small">Message from responders: {active.responderNote}</p>}
            </>
          )}
          {active.status === "resolved" && <strong>Your SOS was marked resolved by DRRM. Stay safe.</strong>}
          {active.status === "open" && (
            <button type="button" className="btn-ghost btn-sm" onClick={cancel}>
              I'm safe now — cancel SOS
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="sos-loc small">
            {pos ? (
              <>
                Your location is ready (±{pos.accuracy} m) · {nearestArea(pos.lat, pos.lng).name}
              </>
            ) : locError ? (
              <span className="field__error">{locError}</span>
            ) : (
              <>
                <Spinner /> Getting your location…
              </>
            )}
          </div>
          <div className="chip-row">
            {QUICK.map((q) => (
              <button key={q} type="button" className={`chip-btn ${message === q ? "chip-btn--solid" : ""}`} onClick={() => setMessage(q)}>
                {q}
              </button>
            ))}
          </div>
          <Field label="Details for responders">
            <textarea rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label="People with you">
              <input type="number" min={1} max={200} value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value)))} />
            </Field>
            <Field label="Phone (optional)">
              <input type="tel" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
          <button type="button" className="sos-send" disabled={!pos || sending} onClick={send}>
            {sending ? "Sending…" : "Send SOS with my location"}
          </button>
          <p className="tiny">Your location is shared only with DRRM responders for this request.</p>
        </>
      )}

      <div className="sos-share">
        <button type="button" className="btn-secondary" disabled={!pos} onClick={share}>
          Share my location with family
        </button>
        {contacts.data.map((c) => (
          <span key={c.id} className="row">
            {c.phone && pos && (
              <a className="chip-btn" href={`sms:${c.phone}?body=${encodeURIComponent(shareText(pos.lat, pos.lng, message))}`}>
                Text {c.name}
              </a>
            )}
            {c.phone && (
              <a className="chip-btn" href={`tel:${c.phone}`}>
                Call {c.name}
              </a>
            )}
          </span>
        ))}
        {currentUser && !currentUser.isAnonymous && contacts.data.length === 0 && (
          <p className="tiny">
            Add emergency contacts in <a href="/me">My account</a> to text them in one tap.
          </p>
        )}
      </div>
    </section>
  );
}
