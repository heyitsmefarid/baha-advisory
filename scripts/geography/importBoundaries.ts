import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { getUnit } from "../../shared/geography/catalog";
import { MINDORO_CATALOG } from "../../shared/geography/catalog.generated";
import type {
  BoundaryFeature,
  BoundaryFeatureCollection,
  GeoJsonPosition,
  SupportedGeometry,
} from "../../shared/geography/geometry";

interface BoundaryManifest {
  version: "mindoro-boundaries-v1";
  catalogVersion: "Q2_2026";
  generatedAt: string;
  sourceAgency: string;
  sourceUrl: string;
  licenseNote: string;
  boundaryStatus: {
    province: "authoritative" | "approximate_official" | "unavailable";
    municipality: "authoritative" | "approximate_official" | "unavailable";
    barangay: "authoritative" | "approximate_official" | "unavailable";
  };
  assets: {
    province: string | null;
    municipalities: Record<string, string | null>;
    barangays: Record<string, string | null>;
  };
}

const MANIFEST_PATH = path.resolve("public/geography/manifest.json");
const CLIENT_MANIFEST_PATH = path.resolve("shared/geography/manifest.generated.ts");
const SERVER_PATH = path.resolve("shared/geography/boundaries.generated.json");
const SOURCES_PATH = path.resolve("data/geography/sources.json");

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function requireString(args: Record<string, string | boolean>, key: string, fallback?: string): string {
  const value = args[key] ?? fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required --${key}.`);
  return value.trim();
}

function normalizeCode(properties: Record<string, unknown>): string | null {
  for (const key of ["psgcCode", "PSGC_CODE", "PSGC", "psgc_code", "ADM_PCODE", "adm_pcode"]) {
    const candidate = String(properties[key] ?? "").replace(/\D/g, "");
    if (/^\d{10}$/.test(candidate)) return candidate;
    if (/^PH\d{9}$/.test(String(properties[key] ?? ""))) return null;
  }
  return null;
}

function normalizeGeometry(value: unknown): SupportedGeometry {
  const geometry = value as Partial<SupportedGeometry>;
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") {
    throw new Error(`Unsupported geometry type: ${String(geometry?.type)}`);
  }
  if (!Array.isArray(geometry.coordinates)) throw new Error("Boundary geometry has no coordinates.");
  return geometry as SupportedGeometry;
}

async function readCollection(file: string): Promise<BoundaryFeatureCollection> {
  const raw = JSON.parse(await readFile(file, "utf8")) as {
    type?: string;
    features?: Array<{ type?: string; properties?: Record<string, unknown>; geometry?: unknown }>;
  };
  if (raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    throw new Error(`${file} is not a GeoJSON FeatureCollection.`);
  }
  const seen = new Set<string>();
  const features = raw.features.map((feature): BoundaryFeature => {
    const psgcCode = normalizeCode(feature.properties ?? {});
    if (!psgcCode) throw new Error(`${file} contains a feature without a ten-digit PSGC code.`);
    if (seen.has(psgcCode)) throw new Error(`${file} contains duplicate PSGC code ${psgcCode}.`);
    seen.add(psgcCode);
    const unit = getUnit(psgcCode);
    if (!unit || unit.level === "region") throw new Error(`${file} contains unsupported PSGC code ${psgcCode}.`);
    return {
      type: "Feature",
      properties: { psgcCode, level: unit.level },
      geometry: normalizeGeometry(feature.geometry),
    };
  });
  return { type: "FeatureCollection", features };
}

function squareDistance(point: GeoJsonPosition, start: GeoJsonPosition, end: GeoJsonPosition): number {
  let x = start[0];
  let y = start[1];
  const dx = end[0] - x;
  const dy = end[1] - y;
  if (dx || dy) {
    const t = Math.max(0, Math.min(1, ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)));
    x += dx * t;
    y += dy * t;
  }
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

function simplifyRing(points: GeoJsonPosition[], tolerance = 0.00005): GeoJsonPosition[] {
  if (points.length <= 4) return points;
  const keep = new Set([0, points.length - 1]);
  const visit = (first: number, last: number) => {
    let maxDistance = tolerance ** 2;
    let farthest = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = squareDistance(points[index], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      visit(first, farthest);
      visit(farthest, last);
    }
  };
  visit(0, points.length - 1);
  return points.filter((_, index) => keep.has(index));
}

function simplified(feature: BoundaryFeature): BoundaryFeature {
  const geometry = feature.geometry.type === "Polygon"
    ? { type: "Polygon" as const, coordinates: feature.geometry.coordinates.map((ring) => simplifyRing(ring)) }
    : {
        type: "MultiPolygon" as const,
        coordinates: feature.geometry.coordinates.map((polygon) => polygon.map((ring) => simplifyRing(ring))),
      };
  return { ...feature, geometry };
}

function collection(features: BoundaryFeature[]): BoundaryFeatureCollection {
  return { type: "FeatureCollection", features };
}

async function renderInputs(args: Record<string, string | boolean>) {
  const provinceFile = path.resolve(requireString(args, "province"));
  const municipalityFile = path.resolve(requireString(args, "municipality"));
  const [provinces, municipalities] = await Promise.all([
    readCollection(provinceFile),
    readCollection(municipalityFile),
  ]);
  if (provinces.features.some((feature) => feature.properties.level !== "province")) {
    throw new Error("Province input contains a non-province PSGC feature.");
  }
  if (municipalities.features.some((feature) => !["city", "municipality"].includes(feature.properties.level))) {
    throw new Error("Municipality input contains a feature at the wrong PSGC level.");
  }

  const barangays: BoundaryFeature[] = [];
  const barangayDir = typeof args["barangay-dir"] === "string" ? path.resolve(args["barangay-dir"]) : null;
  if (barangayDir) {
    for (const entry of (await readdir(barangayDir)).filter((name) => name.endsWith(".geojson")).sort()) {
      const loaded = await readCollection(path.join(barangayDir, entry));
      for (const feature of loaded.features) {
        if (feature.properties.level !== "barangay") throw new Error(`${entry} contains a non-barangay feature.`);
        const municipalityCode = feature.properties.psgcCode.slice(0, 7) + "000";
        if (path.basename(entry, ".geojson") !== municipalityCode) {
          throw new Error(`${entry} contains cross-parent barangay ${feature.properties.psgcCode}.`);
        }
      }
      barangays.push(...loaded.features);
    }
  }

  return {
    inputs: [provinceFile, municipalityFile, ...(barangayDir ? (await readdir(barangayDir)).filter((name) => name.endsWith(".geojson")).map((name) => path.join(barangayDir, name)) : [])],
    server: collection([...provinces.features, ...municipalities.features, ...barangays]),
    provinces,
    municipalities,
    barangays,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const check = args.check === true;
  let currentManifest: BoundaryManifest | null = null;
  try {
    currentManifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as BoundaryManifest;
  } catch {
    currentManifest = null;
  }
  const unavailable = args.unavailable === true || (check && currentManifest?.boundaryStatus.province === "unavailable");
  const sourceAgency = requireString(args, "source-agency", currentManifest?.sourceAgency);
  const sourceUrl = requireString(args, "source-url", currentManifest?.sourceUrl);
  const retrievedAt = requireString(args, "retrieved-at", currentManifest?.generatedAt);
  const licenseNote = requireString(args, "license-note", currentManifest?.licenseNote);
  const requestedStatus = String(args["boundary-status"] ?? "approximate_official");
  if (!unavailable && requestedStatus !== "authoritative" && requestedStatus !== "approximate_official") {
    throw new Error("--boundary-status must be authoritative or approximate_official.");
  }

  const provinceCodes = MINDORO_CATALOG.filter((unit) => unit.level === "province").map((unit) => unit.psgcCode);
  const municipalityCodes = MINDORO_CATALOG.filter((unit) => ["city", "municipality"].includes(unit.level)).map((unit) => unit.psgcCode);
  const emptyAssets: BoundaryManifest["assets"] = {
    province: null,
    municipalities: Object.fromEntries(provinceCodes.map((code) => [code, null])),
    barangays: Object.fromEntries(municipalityCodes.map((code) => [code, null])),
  };
  let server = collection([]);
  let assets = emptyAssets;
  let inputs: string[] = [];
  const writes = new Map<string, string>();

  if (!unavailable) {
    const rendered = await renderInputs(args);
    server = rendered.server;
    inputs = rendered.inputs;
    const provinceAsset = "/geography/mindoro-provinces.geojson";
    const municipalitiesAssets = Object.fromEntries(
      provinceCodes.map((code) => [code, `/geography/municipalities-${code}.geojson`]),
    );
    const barangayAssets = Object.fromEntries(
      municipalityCodes.map((code) => [
        code,
        rendered.barangays.some((feature) => feature.properties.psgcCode.startsWith(code.slice(0, 7)))
          ? `/geography/barangays/${code}.geojson`
          : null,
      ]),
    );
    assets = { province: provinceAsset, municipalities: municipalitiesAssets, barangays: barangayAssets };
    writes.set(path.resolve(`public${provinceAsset}`), `${JSON.stringify(collection(rendered.provinces.features.map(simplified)))}\n`);
    for (const provinceCode of provinceCodes) {
      const features = rendered.municipalities.features.filter((feature) => feature.properties.psgcCode.startsWith(provinceCode.slice(0, 5)));
      writes.set(path.resolve(`public${municipalitiesAssets[provinceCode]}`), `${JSON.stringify(collection(features.map(simplified)))}\n`);
    }
    for (const municipalityCode of municipalityCodes) {
      const asset = barangayAssets[municipalityCode];
      if (!asset) continue;
      const features = rendered.barangays.filter((feature) => feature.properties.psgcCode.startsWith(municipalityCode.slice(0, 7)));
      writes.set(path.resolve(`public${asset}`), `${JSON.stringify(collection(features.map(simplified)))}\n`);
    }
  }

  const status = unavailable ? "unavailable" : requestedStatus as "authoritative" | "approximate_official";
  const manifest: BoundaryManifest = {
    version: "mindoro-boundaries-v1",
    catalogVersion: "Q2_2026",
    generatedAt: retrievedAt,
    sourceAgency,
    sourceUrl,
    licenseNote,
    boundaryStatus: {
      province: status,
      municipality: status,
      barangay: unavailable || Object.values(assets.barangays).every((asset) => asset === null) ? "unavailable" : status,
    },
    assets,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const clientManifestText = `// Generated by scripts/geography/importBoundaries.ts. Do not edit by hand.\nexport const MINDORO_BOUNDARY_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;\n`;
  const serverText = `${JSON.stringify(server, null, 2)}\n`;

  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8")) as { sources: Array<Record<string, unknown>> };
  const inputHashes = await Promise.all(inputs.map(async (file) => ({
    file: path.basename(file),
    sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
  })));
  const boundarySource = {
    id: "administrative-boundaries",
    agency: sourceAgency,
    sourceUrl,
    retrievedAt,
    availability: unavailable ? "unavailable_conditional_download" : status,
    licenseNote,
    files: inputHashes,
  };
  sources.sources = [...sources.sources.filter((source) => source.id !== "administrative-boundaries"), boundarySource];
  const sourcesText = `${JSON.stringify(sources, null, 2)}\n`;

  if (check) {
    const [existingManifest, existingClientManifest, existingServer, existingSources] = await Promise.all([
      readFile(MANIFEST_PATH, "utf8"),
      readFile(CLIENT_MANIFEST_PATH, "utf8"),
      readFile(SERVER_PATH, "utf8"),
      readFile(SOURCES_PATH, "utf8"),
    ]);
    if (existingManifest !== manifestText || existingClientManifest !== clientManifestText || existingServer !== serverText || existingSources !== sourcesText) {
      throw new Error("Generated boundary files are stale. Run npm run geography:boundaries.");
    }
  } else {
    await Promise.all([mkdir(path.dirname(MANIFEST_PATH), { recursive: true }), mkdir(path.dirname(CLIENT_MANIFEST_PATH), { recursive: true }), mkdir(path.dirname(SERVER_PATH), { recursive: true })]);
    writes.set(MANIFEST_PATH, manifestText);
    writes.set(CLIENT_MANIFEST_PATH, clientManifestText);
    writes.set(SERVER_PATH, serverText);
    writes.set(SOURCES_PATH, sourcesText);
    for (const [file, contents] of writes) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, "utf8");
    }
  }

  console.log(`Mindoro boundaries ${check ? "check" : "generation"}: ${status}; ${server.features.length} validated features.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
