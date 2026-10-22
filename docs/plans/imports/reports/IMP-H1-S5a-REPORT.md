# IMP-H1-S5a — Whole-file pre-validation for the durable catalog job

**Branch:** `claude/imp-h1-s5-prevalidation` · **Depends on:** S8a/S8b (units + repair) · **S5b (remote image fetch outside the lock) is deferred — see below**

## Problem (verified in code)

`ProductImportService::parse()` validates only its window (`$seen`, the in-file duplicate map, is local to the window). A duplicate SKU/barcode/Nebrax-id **between** two windows (e.g. row 10 and row 160 of a 250-row file, window = 100 rows) passed the windowed preview and every earlier window was applied; the duplicate then failed at write time (`assertNoLiveSkuConflict`) in a later chunk, leaving a half-applied import.

## Change

- `ProductImportService::prevalidateWholeFile()` — one read of the whole file, **no database access and no write**, using the same `assertUniqueWithinFile` rule and mapping resolution as `parse()` (case-insensitive SKU/barcode/Nebrax-id, same message incl. "first seen in row N"). It throws `ImportUnitFailureException` naming every repeated occurrence (second appearance onward).
- `ProductCatalogImportAdapter::applyChunk` calls it at `offset === 0` (first chunk, including repair children), before the media preview and before any write.
- `ImportJobUnitRecorder` now records **named** failing units wherever they fall at/after the chunk offset (previously only inside the window), so the duplicate in window 3 is named even though the failure surfaced in window 1; the rest of the window is `window_rolled_back` and the tail `not_attempted` (message reworded to cover "file check").

Effect: a cross-window duplicate fails the job **before any row is written**, every unit is repairable, and the corrected file repairs through the S8b flow.

## Safety

No migration, env, accounting, ZATCA or AI change; reads only. A clean file behaves exactly as before (tested). Sync `/products/import/*` is untouched. Cost: one extra read/parse of the file at the first chunk (bounded by the 5 MB / 20 000-row limits).

## S5b — remote image fetch outside the job lock: deferred with a hard prerequisite

`ProductImportMediaService::apply()` fetches remote URLs (`ProductImageRemoteFetcher`) inside the chunk — i.e. while the job row lock and the chunk transaction are held. Moving that out needs a separate staging phase (plan URLs from the file, fetch to temp files before the lock, then attach in-lock) and its own tests. It is **not exercised in production today**: `PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED` defaults to false and enabling it is an owner/ops decision (OPS-01), which this Horizon does not make. **S5b must land before that flag is enabled for any tenant**; recorded in the Tracker as a prerequisite of the OPS-01 remote-image activation.

## Tests — `ImportJobPrevalidationTest` (4) + regression

Cross-window duplicate: nothing is written (0 products, `processed_rows` 0), all 250 units recorded, only the second occurrence named `row_duplicate_in_file` with "first seen in row 12"; case-insensitive and barcode duplicates; clean file unaffected (no units); corrected file repairs through a child job (250 products). **Negative control:** disabling the call fails the three duplicate tests. Wider suites (BranchIsolation|ImportJob|ImportDomain|ImportPlan|ImportPreview|ImportIntake|ImportRepair|ProductImport|AiAction): 361 passed, 7 skipped. CI on the PR.
