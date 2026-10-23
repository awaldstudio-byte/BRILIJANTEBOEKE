# Dashboard report exports

## Formats and branding

- Excel is the default editable report. PDF is for printing and school handover. CSV remains an explicitly unformatted data export.
- An explicit school or school-period selection uses the approved Briljante logo plus that school's stored logo, if uploaded. Combined registers use only Briljante's logo, even when the data currently contains a single school.
- School registers list paid learners, grades, workbooks, book quantities, references and payment dates. Optional classes appear only when recorded. Internal parent contact information is not included in the school handover report.
- The combined Excel workbook includes a separate Transactions sheet with one row per order. Its payment total must never be calculated from repeated learner rows.
- Batch reports contain a packing summary and learner allocations from the frozen batch-item records. They do not recalculate membership from today's paid orders.
- The existing QR/poster generator is unchanged.

## Access and data integrity

`/api/admin-export` checks existing staff authorization before accessing data or private logos. Downloads are non-cacheable; no public report URLs or external spreadsheet services are introduced. The same API serves all formats; no additional serverless route is needed.

Exports use stable keyset pagination, a payment capture timestamp, and item/order reconciliation. Invalid identifiers, mismatched school/period pairs, pagination failures, inconsistent financial records, excessive row counts and oversized attachments fail explicitly rather than producing a silently partial report. CSV neutralizes formula-like text; Excel writes user content as literal strings, not formulas. Monetary values and SAST dates retain usable native cell types.

The blank workbook template is authored with the bundled spreadsheet tool (`scripts/build-report-template.mjs`) and normalized to the equivalent default SpreadsheetML namespace for ExcelJS interoperability. Production fills that template without requiring the desktop's private artifact runtime. Every generated cell receives an independent style object; imported shared styles must not allow the navy column-heading fill to leak into the document header.

## Verification — 23 October 2026

- Preview deployment: `dpl_6D2moTLq8Wyc7KY3sZVatCvexhrM`, READY. Stable alias: `https://briljante-preview-awaldstudio.vercel.app`.
- Authenticated browser downloads: combined Excel; Test School 1 / 2027 / Parent orders Excel, PDF and CSV. Actual Excel files reopened; PDF rendered and visually inspected.
- Existing data: four books, two DEMO orders, R1,320 simulated paid value. Combined workbook has one logo and two transaction rows; school workbook has both logos and no parent-contact sheet. Actual learner names preserved. No mail sent and no orders or batches created during verification.
- Anonymous requests for Excel, PDF and CSV each returned 401 and private/no-store headers.
- Local rendered fixtures cover school, combined, batch packing and allocation, empty results and a five-page 55-row register including a long wrapped name. All PDF pages were visually reviewed. XLSX files were reopened and their formatting, images, types, formulas, filters and frozen panes checked; representative files were rendered using the bundled spreadsheet tool.
- Batch formatting was verified with local frozen-record fixtures, not a newly created live batch. Physical printers, other spreadsheet applications and real-device accessibility were not tested.
- Runtime dependency audit: zero reported vulnerabilities. The pinned ExcelJS dependency uses a targeted patched UUID override; do not remove the override without re-auditing.

Changes are on the application preview only. The public marketing domain, payment configuration, email settings and database schema were not changed.
