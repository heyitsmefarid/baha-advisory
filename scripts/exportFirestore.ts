/**
 * READ-ONLY Firestore backup to JSON (all collections + subcollections).
 * Use it on the ORIGINAL Bahadvisory project if its owner still has access,
 * then restore into a new project with importFirestore.ts. Works on the
 * Spark plan (managed exports need billing).
 *
 *   npm run export-firestore -- --production --out backup.json
 *   npm run export-firestore -- --production --out zones.json --collections floodZones,zoneHistory,users
 *
 * Timestamps, GeoPoints and document references are encoded so the import
 * restores them exactly. Nothing is written to the source project.
 */
import { writeFileSync } from "node:fs";
import { setupScriptEnv } from "./lib/scriptEnv";

const ctx = setupScriptEnv();
const { getDb } = await import("../server/lib/firebaseAdmin");
const { DocumentReference, GeoPoint, Timestamp } = await import("firebase-admin/firestore");
type Snap = FirebaseFirestore.DocumentSnapshot;

const out = ctx.option("--out") ?? `firestore-backup-${new Date().toISOString().slice(0, 10)}.json`;
const only = (ctx.option("--collections") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const db = getDb();

export function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { __type: "timestamp", ms: v.toMillis() };
  if (v instanceof GeoPoint) return { __type: "geopoint", lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __type: "ref", path: v.path };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

interface DumpDoc {
  path: string;
  data: unknown;
}
const docs: DumpDoc[] = [];

async function walk(snapDocs: Snap[]) {
  for (const d of snapDocs) {
    docs.push({ path: d.ref.path, data: encode(d.data()) });
    for (const sub of await d.ref.listCollections()) {
      await walk((await sub.get()).docs);
    }
  }
}

const roots = await db.listCollections();
for (const col of roots) {
  if (only.length && !only.includes(col.id)) continue;
  // Documents that exist only as parents of subcollections (no fields) are
  // still discovered through listDocuments().
  const refs = await col.listDocuments();
  const snaps = await Promise.all(refs.map((r) => r.get()));
  for (const s of snaps) {
    if (s.exists) await walk([s]);
    else for (const sub of await s.ref.listCollections()) await walk((await sub.get()).docs);
  }
  console.log(`  ${col.id}: done (${docs.length} docs so far)`);
}

writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), projectId: ctx.projectId, count: docs.length, docs }, null, 1));
console.log(`\nExported ${docs.length} documents to ${out} (source untouched).\n`);
process.exit(0);
