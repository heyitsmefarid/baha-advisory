/**
 * Restore a JSON backup (from exportFirestore.ts) into a project.
 *
 *   npm run import-firestore -- --emulator --in backup.json --dry-run
 *   npm run import-firestore -- --production --in backup.json
 *   npm run import-firestore -- --production --in backup.json --overwrite
 *
 * Safety: by default existing documents are SKIPPED, never overwritten;
 * --overwrite must be passed explicitly. --dry-run reports what would happen.
 * Note: Firebase Auth users and their custom claims are not in Firestore —
 * recreate staff accounts with `npm run create-account`.
 */
import { readFileSync } from "node:fs";
import { setupScriptEnv } from "./lib/scriptEnv";

const ctx = setupScriptEnv();
const { getDb } = await import("../server/lib/firebaseAdmin");
const { GeoPoint, Timestamp } = await import("firebase-admin/firestore");

const file = ctx.option("--in");
if (!file) {
  console.error("--in <backup.json> is required");
  process.exit(1);
}
const dryRun = ctx.flag("--dry-run");
const overwrite = ctx.flag("--overwrite");
const db = getDb();

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.__type === "timestamp") return Timestamp.fromMillis(o.ms as number);
    if (o.__type === "geopoint") return new GeoPoint(o.lat as number, o.lng as number);
    if (o.__type === "ref") return db.doc(o.path as string);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

const dump = JSON.parse(readFileSync(file, "utf8")) as { docs: { path: string; data: unknown }[]; projectId?: string; exportedAt?: string };
console.log(`\nImporting ${dump.docs.length} docs exported ${dump.exportedAt ?? "?"} from ${dump.projectId ?? "?"} → ${ctx.projectId}${dryRun ? " (dry run)" : ""}`);
let written = 0;
let skipped = 0;
for (const d of dump.docs) {
  const ref = db.doc(d.path);
  const exists = (await ref.get()).exists;
  if (exists && !overwrite) {
    skipped++;
    continue;
  }
  if (!dryRun) await ref.set(decode(d.data) as Record<string, unknown>);
  written++;
}
console.log(`${dryRun ? "Would write" : "Wrote"} ${written}, skipped ${skipped} existing document(s).\n`);
process.exit(0);
