# CI #10646 — SQLite failure in `ImportPlanDriftTest` (workbook apply)

- **Run:** CI run_number 10646, API run id `40318579630`, job `121557344080` (`php artisan test (L11, sqlite)`), commit `b8be8fbab91defc3d84ef1adf2a6e9cba9c8f812` (#1766). pgsql job `121557344381` passed. Result: 9,579 passed, 1 failed, 264 skipped.
- **Branch:** `claude/fix-sqlite-import-preview-flake` · **Base SHA:** `7cc31d3076c4f56871f938d1c49c1fa1e806fa62` · **PR / Head SHA:** see PR.

## Exact failure (correcting the screenshot reading)
`Tests\Feature\ImportPlanDriftTest::a_sync_workbook_apply_with_its_binding_runs_and_consumes_the_preview` failed at **line 287 — the FIRST apply**, not at line 290 (the replay assertion):

```
Expected response status code [200] but received 422.
App\Support\ImportPreviewException: الملف أو الخيارات تغيّرت عمّا عاينته. أعد فحص الملف قبل التنفيذ.
  ImportPreviewService.php:127  (assertConsumable → preview_mismatch)
  ← ImportPreviewService::bindForSyncApply ← ProductWorkbookController::apply (line 97)
```
So the code was `preview_mismatch`, not `preview_consumed`. Line 290 (replay → `preview_consumed`) was never reached; replay protection was not involved.

## Root cause
The test builds the workbook three times (`workbook('SKU-WBS')`: preview, apply, replay). `ZipArchive` stamps each entry with the generation time (DOS time, 2-second resolution; `addFile` uses the temp file mtime). If two generations straddle a 2-second boundary the **XLSX bytes differ** although the content is identical. The preview binds `file_sha256` on purpose (`ImportPreviewService::hash`), so the second upload hashes differently → `preview_mismatch`. The security check behaved correctly; the test uploaded a regenerated file instead of the previewed file.

## Evidence
- Mechanism probe (`SpreadsheetWriter::workbookXlsx`, same input): immediate re-generation → identical sha256; after `sleep(2)` → **different sha256**.
- Reproduction: original test with `sleep(2)` inserted in its helper fails locally with the identical message at `ImportPreviewService.php:127`, 422 vs 200. Unmodified, it passes when the generations land in the same window.
- **Intermittent, not deterministic:** passed in PostgreSQL job and on every other run; the 23-minute SQLite job is slower/more variable, so the straddle is likelier there. DB-independent (no SQL involved) — SQLite vs PostgreSQL is not the cause.
- Not tenant isolation, authz, transactions or preview-consumption state.

## Fix (test-only)
Build the workbook bytes once per test and upload fresh `UploadedFile`s from the same bytes:
- `tests/Feature/ImportPlanDriftTest.php` — `workbook()` memoises bytes per SKU (the failing test).
- `tests/Feature/ImportPreviewBindingTest.php::a_workbook_job_is_bound_including_its_price_list` — identical latent pattern (3 regenerations, bound job); same one-spot fix.

No application code, assertion, authorization, contract or migration changed. Replay/mismatch assertions untouched.

## Tests (local, SQLite)
- Repro (original + `sleep(2)`): FAILED as in CI. Fixed files: `ImportPlanDriftTest` + `ImportPreviewBindingTest` → 46 passed.
- `--filter=Import` (workbook/import/preview/replay/tenant-bound tests): 613 passed, 28 skipped.
- PostgreSQL: not re-run locally; CI pgsql job covers it (mechanism is DB-independent).

## Security / compatibility
No behavior change in production; the file-hash binding that caused the 422 is exactly the protection intended. Replay protection (`preview_consumed`) and tenant isolation tests unchanged and passing.

## Remaining risks / next action
- Other tests that regenerate an XLSX between preview and apply would share this risk; none found in a search of the preview-binding tests (CSV helpers are deterministic).
- Optional, needs approval (changes byte output): make `SpreadsheetWriter` deterministic (fixed entry mtime). Not done.
- Next: review PR; CI result on the PR head decides readiness. No Merge. No Deploy.
