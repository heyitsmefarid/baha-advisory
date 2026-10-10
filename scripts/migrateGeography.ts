import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setupScriptEnv } from "./lib/scriptEnv";

const ctx = setupScriptEnv();
const { getDb } = await import("../server/lib/firebaseAdmin");
const { migrateRecord } = await import("../server/lib/geography");

const COLLECTIONS = [
  "floodZones",
  "road_conditions",
  "water_level_stations",
  "community_reports",
  "incidents",
  "advisories",
  "alerts",
  "evacuation_centers",
  "sos_requests",
  "flood_risk_predictions",
] as const;

const apply = ctx.flag("--apply");
const reportPath = path.resolve(ctx.option("--report") ?? ".cache/geography/migration-report.json");
const db = getDb();
const results: ReturnType<typeof migrateRecord>[] = [];
let writes = 0;

for (const collectionName of COLLECTIONS) {
  const snapshot = await db.collection(collectionName).get();
  const pending: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }> = [];
  for (const document of snapshot.docs) {
    const result = migrateRecord(collectionName, document.id, document.data());
    results.push(result);
    if (apply && result.action === "migrate") pending.push({ ref: document.ref, patch: result.patch });
  }
  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = db.batch();
    const chunk = pending.slice(offset, offset + 400);
    for (const item of chunk) batch.update(item.ref, item.patch);
    await batch.commit();
    writes += chunk.length;
  }
}

const counts = results.reduce<Record<string, number>>((totals, result) => {
  totals[result.action] = (totals[result.action] ?? 0) + 1;
  return totals;
}, {});
const report = {
  migration: "mindoro-psgc-q2-2026-v1",
  projectId: ctx.projectId,
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  writes,
  counts,
  results,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Geography migration ${report.mode}: ${writes} write(s); ${counts.migrate ?? 0} migratable; ${counts.review_required ?? 0} review required; ${counts.unchanged ?? 0} unchanged.`);
console.log(`Report: ${reportPath}`);
