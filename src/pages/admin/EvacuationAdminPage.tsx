import React, { useState } from "react";
import { addDoc, collection, doc, query, serverTimestamp, setDoc, updateDoc, where, deleteDoc } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import LocationPicker, { type PickedLocation } from "../../components/map/LocationPicker";
import { Badge, Callout, ConfirmButton, DataTable, Field, Freshness, Modal, PageHeader, SimulatedBadge, SkeletonRows, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { db } from "../../firebase";
import { EVAC_STATUS } from "../../lib/labels";
import { canManageArea } from "../../../shared/roles";
import { AREA_NAMES } from "../../../shared/areas";
import { EVAC_FACILITIES, EVAC_FACILITY_LABELS, type EvacFacility, type EvacuationCenter, type EvacuationStatus } from "../../../shared/types";
import { geographicReferenceForArea } from "../../lib/geographicReference";

const STATUSES: EvacuationStatus[] = ["open", "standby", "full", "closed"];

interface FormState {
  id?: string;
  name: string;
  address: string;
  area: string;
  location: PickedLocation | null;
  capacity: string;
  occupancy: string;
  occupancyVerified: boolean;
  status: EvacuationStatus;
  facilities: EvacFacility[];
  contactName: string;
  contactPhone: string;
  verified: boolean;
  simulated?: boolean;
}

function toForm(c: EvacuationCenter | null, area: string): FormState {
  return {
    id: c?.id,
    name: c?.name ?? "",
    address: c?.address ?? "",
    area: c?.area ?? area,
    location: c ? { point: [c.location.lat, c.location.lng], source: "manual", accuracyM: null } : null,
    capacity: c?.capacity != null ? String(c.capacity) : "",
    occupancy: c?.occupancy != null ? String(c.occupancy) : "",
    occupancyVerified: c?.occupancyVerified ?? false,
    status: c?.status ?? "standby",
    facilities: c?.facilities ?? [],
    contactName: c?.contact?.name ?? "",
    contactPhone: c?.contact?.phone ?? "",
    verified: c?.verified ?? false,
    simulated: c?.simulated,
  };
}

export default function EvacuationAdminPage() {
  const { currentUser, orgId, role, assignedArea, areas, appRole } = useAuth();
  const claims = { role, assignedArea, areas };
  const seesAll = appRole === "super_admin" || role === "admin";
  const { data, loading, error } = useFirestoreCollection<EvacuationCenter>(
    () => (seesAll ? query(collection(db, "evacuation_centers")) : orgId ? query(collection(db, "evacuation_centers"), where("orgId", "==", orgId)) : null),
    (id, d) => ({ id, ...(d as Omit<EvacuationCenter, "id">) }),
    [orgId, seesAll]
  );
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const myAreas = [...new Set([assignedArea, ...areas].filter(Boolean))] as string[];

  const save = async () => {
    if (!form || !currentUser) return;
    setFormError(null);
    const capacity = form.capacity === "" ? null : Math.round(Number(form.capacity));
    const occupancy = form.occupancy === "" ? null : Math.round(Number(form.occupancy));
    if (!form.name.trim()) return setFormError("Name is required.");
    if (!form.location) return setFormError("Place the center on the map.");
    if (capacity != null && occupancy != null && occupancy > capacity) return setFormError("Occupancy can't exceed capacity.");
    if (!canManageArea(claims, form.area)) return setFormError(`You can't manage centers in ${form.area}.`);
    setSaving(true);
    const payload = {
      ...geographicReferenceForArea(form.area, currentUser.uid),
      name: form.name.trim(),
      address: form.address.trim(),
      area: form.area,
      location: { lat: form.location.point[0], lng: form.location.point[1] },
      capacity,
      occupancy,
      occupancyVerified: form.occupancyVerified && occupancy != null,
      occupancyUpdatedAt: serverTimestamp(),
      status: form.status,
      facilities: form.facilities,
      contact: { name: form.contactName.trim(), phone: form.contactPhone.trim() },
      orgId: orgId ?? "platform",
      verified: form.verified,
      updatedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    };
    try {
      if (form.id) {
        await updateDoc(doc(db, "evacuation_centers", form.id), payload);
        await addDoc(collection(db, "evacuation_centers", form.id, "status_updates"), {
          status: form.status, occupancy, note: "Edited", byUid: currentUser.uid, at: serverTimestamp(),
        });
      } else {
        await setDoc(doc(collection(db, "evacuation_centers")), payload);
      }
      toast("Evacuation center saved.", "safe");
      setForm(null);
    } catch (err) {
      setFormError("Couldn't save — check that the area is in your jurisdiction and all values are valid.");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (c: EvacuationCenter, status: EvacuationStatus) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, "evacuation_centers", c.id), { status, updatedBy: currentUser.uid, updatedAt: serverTimestamp() });
      await addDoc(collection(db, "evacuation_centers", c.id, "status_updates"), { status, occupancy: c.occupancy, note: "Quick status change", byUid: currentUser.uid, at: serverTimestamp() });
    } catch {
      toast("Couldn't update status.", "danger");
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Evacuation centers"
        subtitle="Centers appear to the public only when marked verified. Capacity and occupancy are shown publicly only when you mark them verified."
        actions={<button onClick={() => setForm(toForm(null, myAreas[0] ?? AREA_NAMES[0]))}>+ Add center</button>}
      />
      {error && <Callout tone="danger">{error}</Callout>}
      {loading ? (
        <SkeletonRows />
      ) : (
        <DataTable
          rows={data}
          rowKey={(c) => c.id}
          empty="No centers yet. Add your designated evacuation sites."
          columns={[
            { key: "name", header: "Center", render: (c) => (<div><strong>{c.name}</strong><div className="tiny">{c.area} · {c.address}</div></div>) },
            { key: "status", header: "Status", render: (c) => (
              <select value={c.status} disabled={!canManageArea(claims, c.area)} onChange={(e) => quickStatus(c, e.target.value as EvacuationStatus)} aria-label={`Status of ${c.name}`}>
                {STATUSES.map((s) => <option key={s} value={s}>{EVAC_STATUS[s].label}</option>)}
              </select>
            ) },
            { key: "occ", header: "Occupancy", render: (c) => (c.capacity != null ? <span className="mono">{c.occupancy ?? "?"}/{c.capacity} {c.occupancyVerified ? <Badge tone="safe">verified</Badge> : <Badge tone="neutral">unverified</Badge>}</span> : "—") },
            { key: "pub", header: "Public", render: (c) => (<span className="row">{c.verified ? <Badge tone="safe">Verified</Badge> : <Badge tone="caution">Hidden</Badge>}<SimulatedBadge show={!!c.simulated} /></span>) },
            { key: "upd", header: "Updated", render: (c) => <Freshness at={c.updatedAt} prefix="" /> },
            { key: "act", header: "", render: (c) => (
              <span className="row">
                <button className="btn-secondary btn-sm" disabled={!canManageArea(claims, c.area)} onClick={() => setForm(toForm(c, c.area))}>Edit</button>
                {(appRole === "lgu_admin" || appRole === "super_admin" || role === "admin") && (
                  <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Delete center" onConfirm={() => deleteDoc(doc(db, "evacuation_centers", c.id))}>Delete</ConfirmButton>
                )}
              </span>
            ) },
          ]}
        />
      )}

      <Modal
        open={form !== null}
        title={form?.id ? "Edit evacuation center" : "Add evacuation center"}
        onClose={() => setForm(null)}
        wide
        footer={
          <>
            <button className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save center"}</button>
          </>
        }
      >
        {form && (
          <div className="grid-2">
            <div>
              <Field label="Name"><input value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Address"><input value={form.address} maxLength={200} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
              <div className="field-row">
                <Field label="Area">
                  <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                    {(seesAll ? AREA_NAMES : myAreas).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EvacuationStatus })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{EVAC_STATUS[s].label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="field-row">
                <Field label="Capacity (persons)"><input type="number" min={0} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
                <Field label="Current occupancy"><input type="number" min={0} value={form.occupancy} onChange={(e) => setForm({ ...form, occupancy: e.target.value })} /></Field>
              </div>
              <label className="check-row"><input type="checkbox" checked={form.occupancyVerified} onChange={(e) => setForm({ ...form, occupancyVerified: e.target.checked })} /> Occupancy count is verified (shown publicly)</label>
              <label className="check-row"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Center is verified and may be shown to the public</label>
              <div className="field">
                <span className="field__label">Facilities</span>
                <div className="vehicle-toggle-grid">
                  {EVAC_FACILITIES.map((f) => (
                    <label key={f} className="vehicle-toggle">
                      <input type="checkbox" checked={form.facilities.includes(f)} onChange={(e) => setForm({ ...form, facilities: e.target.checked ? [...form.facilities, f] : form.facilities.filter((x) => x !== f) })} />
                      {EVAC_FACILITY_LABELS[f]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field-row">
                <Field label="Contact person"><input value={form.contactName} maxLength={80} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
                <Field label="Contact number"><input type="tel" value={form.contactPhone} maxLength={30} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
              </div>
            </div>
            <div>
              <span className="field__label">Location</span>
              <LocationPicker value={form.location} onChange={(l) => setForm({ ...form, location: l })} height={320} />
              {formError && <Callout tone="danger">{formError}</Callout>}
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
