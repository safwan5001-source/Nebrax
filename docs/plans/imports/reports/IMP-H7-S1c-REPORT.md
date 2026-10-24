# IMP-H7-S1c — Stocktake count import wizard (UI)

Web wizard for the registered `stocktake_count` domain (H7-S1b). Route `/stocktaking/{id}/import` (the target stocktake comes from the route, not the file); entry «استيراد الأعداد من ملف» on a **draft** stocktake page. Steps: setup (file · existing-count policy · column mapping) → preview (no writes) → preview-bound **atomic** durable job → result.

## Specific to stocktake counts

- **Counts only.** The copy states it at the rules step, preview and result: no stock movement, no journal entry; posting stays on the stocktake page. The template is blind (no system quantities). A product missing from the file stays «not counted» and is never treated as zero (the preview shows the remaining uncounted count).
- **Existing-count policy** (`error` default · `overwrite` · `skip`) is a per-run choice frozen with the preview; `error` never replaces an existing count silently.
- **Mapping rules mirror the server:** a product identifier (SKU, barcode or Nebrax ID — never the name) and the counted-quantity column; one column per field.
- **Atomic:** the sheet is written whole or not at all; the status panel shows an honest processing indicator, no fake percentage; errors in the preview block apply.
- Same hardening as the expense wizard (H5-S2b review): a job-creation failure is shown and returns to the preview; any change of file/policy/mapping or a new preview drops the previous job so a stale frozen job is never re-applied (mutation-controlled test); a non-preview-bound resumed job cannot be applied.

## Files

`web/src/modules/stocktaking/import/{contract.ts,StocktakeCountImportWizard.tsx}` · `web/src/app/(app)/stocktaking/[id]/import/page.tsx` · `web/src/app/(app)/stocktaking/[id]/page.tsx` (entry button, draft only) · `web/src/messages/{ar,en}.json` (`stocktakeImport.*`, `stocktaking.import_counts`). Depends on #1702 (`import-jobs/client.ts` domain typing).

## Accounting impact

None — the UI drives the counts-only endpoints from #1692; no stock movement, no journal entry.

## Verification

- `StocktakeCountImportWizard.test.tsx` (5) + `contract.test.ts` (4); full web suite 700 files / 8395 tests passed. No screenshots (component tests only — disclosed limit).
- Backend behaviour of the domain is covered by `H7ImportEndpointsTest` (10) from #1692.

## Not in scope / next

H5-S3/S4 purchases; H3/H4 wizards; AI Action `stocktake_count_import.v1` (H7-S4, after OPS-02).
