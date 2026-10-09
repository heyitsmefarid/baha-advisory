# Mindoro geography sources

The generated catalog pins names, hierarchy, and ten-digit identifiers to the Philippine Statistics Authority (PSA) PSGC publication dated 30 June 2026 (2Q 2026). The source workbook is intentionally cached outside Git in `.cache/geography/`; its SHA-256, retrieval date, and canonical PSA URL are recorded in `sources.json`.

Run `npm run geography:psgc -- --input .cache/geography/PSGC-2Q-2026.xlsx --source-url https://psa.gov.ph/system/files/scd/PSGC-2Q-2026-Publication-Datafile.xlsx --version Q2_2026` to regenerate the catalog, then `npx tsx scripts/geography/importPsgc.ts --check` to verify it.

PSGC is an identity and hierarchy source, not a boundary source. Until a separately validated Philippine government geometry is imported, each unit is marked `boundaryStatus: "unavailable"`; navigation extents are explicitly approximate and are not used as legal boundaries.

As retrieved on 10 October 2026, the Geoportal Philippines inventory labels its provincial and municipal boundary layers **APPROXIMATE** and **conditional downloading**. No approved geometry files are bundled in this repository. The generated boundary manifest therefore reports every level as unavailable and the application must show that status instead of drawing a substitute polygon. An operator with approved government GeoJSON can run `npm run geography:boundaries` with the documented provenance arguments to validate PSGC ancestry, hash the inputs, and generate browser/server assets.
