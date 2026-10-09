# Mindoro geography sources

The generated catalog pins names, hierarchy, and ten-digit identifiers to the Philippine Statistics Authority (PSA) PSGC publication dated 30 June 2026 (2Q 2026). The source workbook is intentionally cached outside Git in `.cache/geography/`; its SHA-256, retrieval date, and canonical PSA URL are recorded in `sources.json`.

Run `npm run geography:psgc -- --input .cache/geography/PSGC-2Q-2026.xlsx --source-url https://psa.gov.ph/system/files/scd/PSGC-2Q-2026-Publication-Datafile.xlsx --version Q2_2026` to regenerate the catalog, then `npx tsx scripts/geography/importPsgc.ts --check` to verify it.

PSGC is an identity and hierarchy source, not a boundary source. Until a separately validated Philippine government geometry is imported, each unit is marked `boundaryStatus: "unavailable"`; navigation extents are explicitly approximate and are not used as legal boundaries.

