import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { setupScriptEnv } from "./lib/scriptEnv";

const ctx = setupScriptEnv();
const { getDb } = await import("../server/lib/firebaseAdmin");
const { migrateRecord } = await import("../server/lib/geography");

const COLLECTIONS = [
  "floodZones", "road_conditions", "water_level_stations", "community_reports", "incidents",
  "advisories", "alerts", "evacuation_centers", "sos_requests", "flood_risk_predictions",
] as const;
const PAGE_SIZE = 200; // update + audit record stays below Firestore's 500-write batch limit

const apply = ctx.flag("--apply");
const reportPath = path.resolve(ctx.option("--report") ?? ".cache/geography/migration-report.json");
const db = getDb();
const runId = `mindoro-psgc-q2-2026-v1-${Date.now()}`;
const runRef = db.doc(`migration_runs/${runId}`);
const results: ReturnType<typeof migrateRecord>[] = [];
const changes: Array<{ path: string; before: Record<string, unknown>; patch: Record<string, unknown> }> = [];
let writes = 0;

if (apply) {
  await runRef.set({ migration: "mindoro-psgc-q2-2026-v1", projectId: ctx.projectId, status: "running", startedAt: FieldValue.serverTimestamp(), writes: 0 });
}

for (const collectionName of COLLECTIONS) {
  let lastId: string | null = null;
  do {
    let query = db.collection(collectionName).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    const pending: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown>; before: Record<string, unknown> }> = [];
    for (const document of snapshot.docs) {
      const data = document.data();
      const result = migrateRecord(collectionName, document.id, data);
      results.push(result);
      if (result.action === "migrate") {
        const before = Object.fromEntries(Object.keys(result.patch).map((key) => [key, data[key] ?? null]));
        changes.push({ path: document.ref.path, before, patch: result.patch });
        if (apply) pending.push({ ref: document.ref, patch: result.patch, before });
      }
    }
    if (apply && pending.length) {
      const batch = db.batch();
      for (const item of pending) {
        batch.update(item.ref, item.patch);
        const auditRef = db.collection("audit_logs").doc();
        batch.set(auditRef, {
          actorUid: "system", actorName: "Geography migration", actorRole: "system",
          action: "geography.migrated", targetType: item.ref.parent.id, targetId: item.ref.id,
          orgId: null, details: { runId, before: item.before, patch: item.patch }, at: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      writes += pending.length;
      await runRef.set({ collection: collectionName, lastDocumentId: snapshot.docs.at(-1)!.id, writes, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    lastId = snapshot.docs.at(-1)!.id;
  } while (lastId);
}

const counts = results.reduce<Record<string, number>>((totals, result) => {
  totals[result.action] = (totals[result.action] ?? 0) + 1;
  return totals;
}, {});
const report = {
  migration: "mindoro-psgc-q2-2026-v1", runId, projectId: ctx.projectId,
  mode: apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), writes, counts, results, changes,
  rollback: "For each changes[] entry, restore the recorded before fields using an audited Admin SDK batch.",
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (apply) await runRef.set({ status: "complete", completedAt: FieldValue.serverTimestamp(), writes, reportPath }, { merge: true });
console.log(`Geography migration ${report.mode}: ${writes} write(s); ${counts.migrate ?? 0} migratable; ${counts.review_required ?? 0} review required; ${counts.unchanged ?? 0} unchanged.`);
console.log(`Report: ${reportPath}`);
