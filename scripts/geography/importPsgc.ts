import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import type { GeographicLevel, GeographicUnit } from "../../shared/geography/types";

export interface PsgcSourceRow {
  psgcCode: string;
  name: string;
  level: GeographicLevel;
}

interface SourceManifest {
  catalogVersion: "Q2_2026";
  sources: Array<Record<string, unknown>>;
}

const REGION_CODE = "1700000000";
const PROVINCE_CODES = new Set(["1705100000", "1705200000"]);
const OUTPUT_FILE = path.resolve("shared/geography/catalog.generated.ts");
const MANIFEST_FILE = path.resolve("data/geography/sources.json");
const DEFAULT_INPUT = ".cache/geography/PSGC-2Q-2026.xlsx";
const DEFAULT_SOURCE_URL =
  "https://psa.gov.ph/system/files/scd/PSGC-2Q-2026-Publication-Datafile.xlsx";

const centers = new Map<string, [number, number]>([
  [REGION_CODE, [13.02, 120.93]],
  ["1705100000", [12.971404, 120.892966]],
  ["1705200000", [12.923174, 121.299296]],
  ["1705101000", [13.397429, 120.723683]],
  ["1705102000", [12.627149, 120.997555]],
  ["1705103000", [13.744979, 120.274361]],
  ["1705104000", [13.811398, 120.13846]],
  ["1705105000", [12.336759, 121.188161]],
  ["1705106000", [13.24113, 120.681114]],
  ["1705107000", [13.415318, 120.474886]],
  ["1705108000", [12.556765, 121.064524]],
  ["1705109000", [12.889153, 121.032475]],
  ["1705110000", [12.454782, 121.133504]],
  ["1705111000", [13.115809, 120.842202]],
  ["1705201000", [13.349331, 121.072132]],
  ["1705202000", [12.828525, 121.425937]],
  ["1705203000", [12.706087, 121.432165]],
  ["1705204000", [12.37262, 121.314674]],
  ["1705205000", [13.354354, 121.187022]],
  ["1705206000", [12.930768, 121.417433]],
  ["1705207000", [12.541855, 121.354382]],
  ["1705208000", [13.243837, 121.22341]],
  ["1705209000", [13.024887, 121.44492]],
  ["1705210000", [13.141026, 121.427417]],
  ["1705211000", [13.475597, 120.94731]],
  ["1705212000", [12.61987, 121.451419]],
  ["1705213000", [13.383694, 120.943853]],
  ["1705214000", [13.058056, 121.350282]],
  ["1705215000", [13.158886, 121.249671]],
]);

function provinceCodeFor(code: string): string {
  return `${code.slice(0, 5)}00000`;
}

function municipalityCodeFor(code: string): string {
  return `${code.slice(0, 7)}000`;
}

function boundingBoxFor(code: string, level: GeographicLevel): [[number, number], [number, number]] {
  if (level === "region") return [[12.1, 120.02], [13.95, 121.7]];
  if (level === "province") {
    return code === "1705100000" ? [[12.1, 120.02], [13.95, 121.3]] : [[12.15, 120.84], [13.65, 121.7]];
  }
  const owner = level === "barangay" ? municipalityCodeFor(code) : code;
  const [lat, lng] = centers.get(owner) ?? [13.02, 120.93];
  const rounded = (value: number) => Number(value.toFixed(6));
  return [[rounded(lat - 0.12), rounded(lng - 0.12)], [rounded(lat + 0.12), rounded(lng + 0.12)]];
}

function parentFor(row: PsgcSourceRow): string | null {
  if (row.level === "region") return null;
  if (row.level === "province") return REGION_CODE;
  if (row.level === "barangay") return municipalityCodeFor(row.psgcCode);
  return provinceCodeFor(row.psgcCode);
}

export function buildMindoroCatalog(
  rows: PsgcSourceRow[],
  version: "Q2_2026",
): GeographicUnit[] {
  const selected = rows.filter(
    (row) =>
      row.psgcCode === REGION_CODE ||
      row.psgcCode.startsWith("17051") ||
      row.psgcCode.startsWith("17052"),
  );
  const codes = new Set<string>();
  const units = selected.map((row): GeographicUnit => {
    if (!/^\d{10}$/.test(row.psgcCode)) throw new Error(`Invalid PSGC code: ${row.psgcCode}`);
    if (codes.has(row.psgcCode)) throw new Error(`Duplicate PSGC code: ${row.psgcCode}`);
    codes.add(row.psgcCode);

    const provincePsgcCode =
      row.level === "region" ? null : row.level === "province" ? row.psgcCode : provinceCodeFor(row.psgcCode);
    const municipalityPsgcCode =
      row.level === "barangay"
        ? municipalityCodeFor(row.psgcCode)
        : row.level === "city" || row.level === "municipality"
          ? row.psgcCode
          : null;
    const centerOwner = row.level === "barangay" ? municipalityPsgcCode : row.psgcCode;

    return {
      psgcCode: row.psgcCode,
      name: row.name.trim(),
      level: row.level,
      parentPsgcCode: parentFor(row),
      regionPsgcCode: REGION_CODE,
      provincePsgcCode,
      municipalityPsgcCode,
      center: centers.get(centerOwner ?? REGION_CODE) ?? centers.get(REGION_CODE)!,
      boundingBox: boundingBoxFor(row.psgcCode, row.level),
      boundaryStatus: "unavailable",
      boundaryAsset: null,
      sourceVersion: version,
    };
  });

  const rank: Record<GeographicLevel, number> = {
    region: 0,
    province: 1,
    city: 2,
    municipality: 2,
    barangay: 3,
  };
  units.sort((left, right) => rank[left.level] - rank[right.level] || left.psgcCode.localeCompare(right.psgcCode));

  const provinces = units.filter((unit) => unit.level === "province");
  const localGovernments = units.filter((unit) => unit.level === "city" || unit.level === "municipality");
  const barangays = units.filter((unit) => unit.level === "barangay");
  if (provinces.map((unit) => unit.name).join("|") !== "Occidental Mindoro|Oriental Mindoro") {
    throw new Error("Expected the two Mindoro provinces in the official PSGC source.");
  }
  if (localGovernments.length !== 26) throw new Error(`Expected 26 Mindoro LGUs, found ${localGovernments.length}.`);
  if (barangays.length !== 590) throw new Error(`Expected 590 Mindoro barangays, found ${barangays.length}.`);
  for (const unit of units) {
    if (unit.parentPsgcCode && !codes.has(unit.parentPsgcCode)) {
      throw new Error(`Missing parent ${unit.parentPsgcCode} for ${unit.psgcCode}.`);
    }
  }
  return units;
}

function levelFromWorkbook(value: string): GeographicLevel | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "reg") return "region";
  if (normalized === "prov") return "province";
  if (normalized === "city") return "city";
  if (normalized === "mun") return "municipality";
  if (normalized === "bgy") return "barangay";
  return null;
}

async function readWorkbook(input: string): Promise<PsgcSourceRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input);
  const worksheet = workbook.getWorksheet("PSGC");
  if (!worksheet) throw new Error("Workbook is missing the PSGC worksheet.");

  const rows: PsgcSourceRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const psgcCode = String(row.getCell(1).text).trim().padStart(10, "0");
    const name = String(row.getCell(2).text).trim();
    const level = levelFromWorkbook(String(row.getCell(4).text));
    if (level && name && /^\d{10}$/.test(psgcCode)) rows.push({ psgcCode, name, level });
  }
  return rows;
}

function renderCatalog(catalog: GeographicUnit[]): string {
  return `/* This file is generated by scripts/geography/importPsgc.ts. Do not edit manually. */\n` +
    `import type { GeographicUnit } from "./types";\n\n` +
    `export const MINDORO_CATALOG: GeographicUnit[] = ${JSON.stringify(catalog, null, 2)};\n`;
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const check = args.check === true;
  let existingManifest: SourceManifest | null = null;
  try {
    existingManifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as SourceManifest;
  } catch {
    existingManifest = null;
  }

  const existingPsgc = existingManifest?.sources.find((source) => source.id === "psgc");
  const input = path.resolve(String(args.input ?? existingPsgc?.localCachePath ?? DEFAULT_INPUT));
  const sourceUrl = String(args["source-url"] ?? existingPsgc?.sourceUrl ?? DEFAULT_SOURCE_URL);
  const version = String(args.version ?? existingManifest?.catalogVersion ?? "Q2_2026");
  if (version !== "Q2_2026") throw new Error(`Unsupported catalog version: ${version}`);

  const inputBytes = await readFile(input);
  const rows = await readWorkbook(input);
  const catalog = buildMindoroCatalog(rows, version);
  const rendered = renderCatalog(catalog);
  const retrievedAt = String(
    args["retrieved-at"] ?? existingPsgc?.retrievedAt ?? new Date().toISOString(),
  );
  const psgcSource = {
    id: "psgc",
    agency: "Philippine Statistics Authority",
    publicationDate: "2026-06-30",
    sourceUrl,
    publicationPage: "https://psa.gov.ph/classification/psgc",
    retrievedAt,
    sha256: createHash("sha256").update(inputBytes).digest("hex"),
    localCachePath: path.relative(process.cwd(), input).replaceAll("\\", "/"),
    licenseNote: "PSA attribution required; identity data only. Boundary geometry is sourced separately.",
  };
  const manifest: SourceManifest = {
    catalogVersion: version,
    sources: [psgcSource, ...(existingManifest?.sources.filter((source) => source.id !== "psgc") ?? [])],
  };
  const renderedManifest = `${JSON.stringify(manifest, null, 2)}\n`;

  if (check) {
    const [currentCatalog, currentManifest] = await Promise.all([
      readFile(OUTPUT_FILE, "utf8"),
      readFile(MANIFEST_FILE, "utf8"),
    ]);
    if (currentCatalog !== rendered || currentManifest !== renderedManifest) {
      throw new Error("Generated PSGC files are stale. Run npm run geography:psgc.");
    }
  } else {
    await Promise.all([
      writeFile(OUTPUT_FILE, rendered, "utf8"),
      writeFile(MANIFEST_FILE, renderedManifest, "utf8"),
    ]);
  }

  console.log(
    `Mindoro PSGC ${check ? "check" : "generation"}: 2 provinces, 26 LGUs, ${catalog.filter((unit) => unit.level === "barangay").length} barangays.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
