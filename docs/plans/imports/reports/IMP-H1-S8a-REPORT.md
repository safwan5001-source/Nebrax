# IMP-H1-S8a — Failed-unit persistence and failures download

**Branch:** `claude/imp-h1-s8a-unit-outcomes` · **Next:** S8b (repair child job, per-unit atomic claim, UI) · **Depends on:** H1-S2 (adapters), H1-S3 (bound jobs)

## Finding that shaped the slice (verified in code)

The durable catalog path is **all-or-nothing per chunk**: `ProductImportService::apply()` throws if the window has any error row, the chunk's transaction rolls back, and the job becomes `failed` with one `error_message`. There were no per-row outcomes, so there was nothing a repair could address, and the 99 valid rows in the failing 100-row window plus the unprocessed tail were silently lost to the user. S8 as written assumed per-unit outcomes; S8a creates them without changing apply semantics.

Also: only `product_catalog` has a **row** unit. `product_workbook` and `inventory_opening` are atomic file units (they fail whole, with no partial state), so they correctly get no partial repair — the user fixes the file and re-uploads. Document-unit domains (H5–H7) add their own repair test when they arrive.

## What changed

- **`import_job_units`** (additive migration, no backfill): one row per **failed / unattempted** unit (successful units are not stored; the job's counters cover them). Columns: `source_unit_ref` (UUID), `unit_ordinal`, `status` (`failed`; `repaired` arrives in S8b), `error_code`, `error_message`, `repaired_by_job_id`. Unique on `(job, ref)` and `(job, ordinal)`. `ImportJobUnit` is `CompanyWide` like `ImportJob`.
- **`ImportUnitRef::for(jobId, ordinal)`** — UUIDv5 derived from the job id and the unit's ordinal among real data rows. Deterministic, so nothing is stored per successful row; independent of any business key, so a SKU can be corrected or filled in a repair. (Spec said "minted at creation and stored"; a derived ref has the same properties with no per-row storage — recorded as an AWJ decision.)
- **`ImportUnitFailureException`** (extends `RuntimeException`, same message as before) carries the offending units; `ProductImportService::apply()` throws it for error rows. No existing consumer changes (the sync endpoint still returns the same 422 text).
- **`ImportJobUnitRecorder`** is called from the existing failure branch in `ImportJobService::applyNextChunk` **inside the same transaction that marks the job `failed`**, so a failed job always has its units. Classification (all `failed`, all repairable): named offending rows (`row_invalid`), the rest of the rolled-back window (`window_rolled_back`), the tail never reached (`not_attempted`), or the whole window with the specific code (`plan_drift` / `chunk_failed`) when no unit is named. Only for `UNIT_ROW` adapters.
- **`GET /import-jobs/{id}/failures?format=csv|xlsx`** (`ImportJobFailuresExporter`): original headers + the failed rows with their original values + `_awj_unit_ref`, `_awj_error_code`, `_awj_error`, `_awj_redacted`. **Authorization:** domain *manage* permission (not view) + application gate + job branch scope; tenant-isolated (404 across tenants). **Redaction:** the adapter declares sensitive columns through the new `ImportFailureExportAdapter` (catalog: purchase price / margin by the frozen or auto mapping); a user without `products.view_cost` gets those cells blank and the columns named in `_awj_redacted`. An adapter that does not declare them gets no export (fail closed). CSV goes through `SpreadsheetWriter` (formula-injection guard shared with existing exports).
- Job show now includes `failed_units` (count).

## Safety

No accounting, ledger, ZATCA or inventory logic touched; no AI/provider setting; no env/Railway change; the migration is a new table only (nothing existing is altered). Apply behavior, chunking and statuses are unchanged — only recording and a read endpoint were added. Deploy impact: auto-deploy runs `migrate --force` for one additive table; no behavior change for existing jobs.

## Tests — `ImportJobFailedUnitsTest` (8)

250-row file with a bad row at ordinal 149: chunk 1 applies (100 products), chunk 2 fails and rolls back ⇒ 150 units = 1 `row_invalid` + 99 `window_rolled_back` + 50 `not_attempted`; refs deterministic/unique and tied to the job; a fully successful job records none; the download carries original values, the stable ref and the error; **cost columns blanked and named for a manager without `products.view_cost`** (negative control: disabling redaction fails this test); manage permission required (view-only → 403) and cross-tenant → 404; no units ⇒ 422; atomic file domains record nothing and offer no export.
Broader run (`BranchIsolation|ImportJob|ImportDomain|ImportPlan|ImportPreview|ImportIntake|ProductImport|…`): 499 passed, 42 skipped (PG-only). CI (SQLite + PostgreSQL + Gate) on the PR.

## Not in S8a (S8b)

`parent_job_id`, `POST /import-jobs/{id}/repairs` (membership by `_awj_unit_ref`, per-unit atomic claim `failed → repaired` inside the unit's write, PostgreSQL race test), adapter ignoring the protected columns on re-upload, and the "إصلاح الصفوف الفاشلة" UI step.
