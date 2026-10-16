import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { FloodZoneInput } from "../types";
import { logZoneChange } from "./historyService";
import { tuplesToFirestore } from "../utils/geo";

const ZONES_COLLECTION = "floodZones";

/**
 * Firestore rejects nested arrays, and a polygon's `coordinates` field is
 * exactly that ([lat,lng][]) — so every write here must convert it to
 * {lat,lng} objects first. See src/utils/geo.ts.
 */
function toFirestoreInput(input: Partial<FloodZoneInput>) {
  if (input.geometry?.type !== "polygon") return input;
  return {
    ...input,
    geometry: {
      ...input.geometry,
      coordinates: tuplesToFirestore(input.geometry.coordinates),
    },
  };
}

export async function createZone(
  input: FloodZoneInput,
  editorUid: string,
  editorName: string
) {
  const ref = await addDoc(collection(db, ZONES_COLLECTION), {
    ...toFirestoreInput(input),
    updatedBy: editorUid,
    updatedByName: editorName,
    updatedAt: serverTimestamp(),
  });

  await logZoneChange({
    zoneId: ref.id,
    zoneName: input.name,
    changedFields: toFirestoreInput(input),
    editorUid,
    editorName,
    action: "created",
  });

  return ref.id;
}

export async function updateZone(
  zoneId: string,
  zoneName: string,
  changedFields: Partial<FloodZoneInput>,
  editorUid: string,
  editorName: string
) {
  await updateDoc(doc(db, ZONES_COLLECTION, zoneId), {
    ...toFirestoreInput(changedFields),
    updatedBy: editorUid,
    updatedByName: editorName,
    updatedAt: serverTimestamp(),
  });

  await logZoneChange({
    zoneId,
    zoneName,
    changedFields: toFirestoreInput(changedFields),
    editorUid,
    editorName,
    action: changedFields.status === "cleared" ? "cleared" : "updated",
  });
}

export async function clearZone(
  zoneId: string,
  zoneName: string,
  editorUid: string,
  editorName: string
) {
  await updateZone(
    zoneId,
    zoneName,
    { status: "cleared" },
    editorUid,
    editorName
  );
}

export async function deleteZone(
  zoneId: string,
  zoneName: string,
  editorUid: string,
  editorName: string
) {
  await logZoneChange({
    zoneId,
    zoneName,
    changedFields: {},
    editorUid,
    editorName,
    action: "deleted",
  });
  await deleteDoc(doc(db, ZONES_COLLECTION, zoneId));
}
