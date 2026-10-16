import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { ZoneHistoryEntry } from "../types";

/**
 * Writes to `zoneHistory/{zoneId}/updates`. The plan's target architecture
 * routes this through a Cloud Function trigger on `floodZones` writes so
 * logging can never be skipped by a buggy/malicious client. This direct
 * client write is the pragmatic MVP path — see firestore.rules for how to
 * lock it down, and README.md "Phase 2 hardening" for the trigger version.
 */
export async function logZoneChange(entry: {
  zoneId: string;
  zoneName: string;
  changedFields: Record<string, unknown>;
  editorUid: string;
  editorName: string;
  action: ZoneHistoryEntry["action"];
  entityType?: "flood_zone" | "road_condition";
}) {
  await addDoc(collection(db, "zoneHistory", entry.zoneId, "updates"), {
    zoneName: entry.zoneName,
    changedFields: entry.changedFields,
    editorUid: entry.editorUid,
    editorName: entry.editorName,
    action: entry.action,
    timestamp: serverTimestamp(),
    ...(entry.entityType ? { entityType: entry.entityType } : {}),
  });
}
