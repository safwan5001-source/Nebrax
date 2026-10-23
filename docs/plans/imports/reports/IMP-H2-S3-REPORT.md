# IMP-H2-S3 — Workbook import UX parity (inspect · template · mapping · error tables)

**Branch:** `claude/imp-h2-s3-workbook-ux` · **Scope:** web only (`/products/workbook-import`). **No backend, migration, env, accounting, ZATCA or AI change.**

## Problem

The three-sheet workbook import (Products / Barcodes / Unit Prices) was the least-guided import screen: no file inspection, no template link,
no way to fix a header the automatic matcher missed, and only the first five errors per sheet — with no way to see or export the rest. The
backend already exposed `inspect`, `template`, `fields` and accepted `mapping` on preview and on the durable job; the screen used none of it.

## Changes

- **Inspect on file pick** (`POST /products/workbook/inspect`): shows which of the three sheets are present, their data-row counts, and — for
  Barcodes / Unit Prices, which accept no manual mapping — the columns the automatic matcher did not recognize (they are otherwise ignored silently).
- **Products-sheet column mapping** (reuses the standard import's `mappingGaps` / `suggestedMapping` / labels): editable target per header, reset to
  the suggestion, blocking messages for missing required fields / identifier / duplicate targets. The unmapped column is sent as `ignore` explicitly so
  the automatic matcher cannot re-bind it.
- **Template download** (`GET /products/workbook/template`) in the page header.
- **Error tables:** first 5 errors per sheet, expandable to 50, plus a CSV of every error the server returned across the three sheets.
- `effectiveMapping()` is the single rule for when a mapping is sent: only when the Products sheet is present, has data rows and columns. Preview, the
  bound job creation and the unbound apply all use the same value, so the single-use preview fingerprint (S3b) matches the job's frozen options.
- Inspection is **advisory**: if it fails or returns an unexpected shape the screen behaves exactly as before (no mapping sent, server auto-matches).

## Notes

- `inspect` shares the workbook FormRequest, which requires a `price_list_id` uuid. The inspect step does not read it, so a nil-uuid placeholder is sent
  until a price list is chosen. Relaxing that rule server-side was deliberately not done (web-only slice); can be tidied when the request is next touched.
- Error list is capped by what the server returns per sheet; the CSV contains exactly those rows (no client-side invention).

## Tests

- `workbook-import/page.test.tsx` (8 = 4 existing + 4 new): inspect renders sheets and unrecognized columns without blocking preview; edited mapping is
  sent with preview (`mapping[2]=ignore` for the unmapped column) and a required field left unmapped blocks preview; inspect failure sends no mapping;
  expandable errors + CSV button. **Negative control:** removing `mapping` from the preview call makes the mapping test fail; restored.
- `workbook/contract.test.ts` (4): `readInspection` shape guard, `effectiveMapping` rules, `unrecognizedColumns`, `workbookFormData` mapping encoding.
- Typecheck: no errors in touched files (55 pre-existing errors elsewhere in `web/` tests, unchanged).

## Disclosures

- No screenshots/visual check of the new UI were taken (consistent with S8c / H2-S0); verified by component tests and typecheck only.
- No Codex review (quota exhausted). An independent read-only subagent reviewed the diff (code read only, nothing executed): **no high/medium defects**; preview-fingerprint encoding (`mapping[i]` vs `options[mapping][i]`, `ignore`, ordering via server `canonicalMapping`) found consistent.

## Independent review — disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | No sequence guard on `runPreview`; a late response for old inputs could show a stale preview (apply would fail closed with `preview_mismatch`); double click issues two previews | **Fixed** (`previewSeq`, `!previewing` in `canPreview`; test with a deferred response) |
| 2 | `inspecting` spinner could stick after a cleared/oversize file or reset | **Fixed** (reset in `acceptFile`/`reset`) |
| 3 | `readInspection` truthy check only; a payload without `columns` would throw | **Fixed** (array checks; test) |
| 4 | Errors CSV does not neutralize `= + - @` | **Fixed** locally with the same `'` prefix as the failures export (shared `toCsv` left untouched) |
| 5 | `engine.error` is never rendered: a failed job creation (`preview_mismatch`/`consumed`/`expired`) leaves a blank step 2 (pre-existing at HEAD) | **Not fixed here — pre-existing, shared by all import screens; tracked for a dedicated slice** |
| 6 | An existing `engine.job` overrides a newer preview after stepping back (pre-existing) | **Not fixed here — pre-existing; tracked with #5** |
