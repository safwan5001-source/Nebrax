# IMP-H1-S8b — Repair child jobs (backend)

**Branch:** `claude/imp-h1-s8b-repair-jobs` · **Depends on:** S8a (units, refs, failures file) · **Next:** S8c (UI step + web contract)

## What it does

`POST /import-jobs/{id}/repairs` takes the corrected failures file (each row still carrying its `_awj_unit_ref`) and creates a **child** import job (`parent_job_id`). The child goes through the normal engine — frozen options, optional preview binding, branch capture, chunked apply — so no second engine exists. The parent's units move `failed → repaired` one window at a time, atomically with that window's write.

## Changes

- **Migration** `add_parent_job_id_to_import_jobs`: one nullable self-FK (`nullOnDelete`) + index; no backfill. (Units cascade with the parent, so a pruned parent makes the child fail closed with `repair_ref_already_used`, never a silent success.)
- **`ImportRepairService::start`** (read-only until it delegates to `ImportJobService::create(..., parentJobId)`): parent must be `failed`; domain must be a row-unit domain that declares failure-export support; the request's branch must be the parent's branch; the file must carry `_awj_unit_ref`; every row must reference a parent unit that is **still `failed`** — unknown / duplicate / missing / already-repaired refs are rejected with stable codes (`repair_ref_unknown|duplicate|missing|not_failed`, `repair_not_available`, `repair_domain_unsupported`, `repair_branch_mismatch`) **before any job or file is created**. `create()` identity now includes `parent_job_id`.
- **`ImportRepairClaims::claimWindow`** (called from `ProductCatalogImportAdapter::applyChunk` for child jobs, **before** the write and inside the chunk transaction added in S8a): one conditional `UPDATE … SET status='repaired', repaired_by_job_id=:child WHERE source_unit_ref IN (window) AND status='failed'`. If fewer rows are claimed than the window holds, the unclaimed units are named (`repair_ref_already_used`) and the whole window rolls back — claims included — so a failed or abandoned child holds nothing and needs no lease/expiry.
- **Authorization:** `StoreImportRepairRequest` (manage-any floor) + domain **manage** permission + app gate + parent branch scope (same gates as apply/failures); tenant-isolated (404 across tenants). The route carries `EnsureImportFilesScanned` (the S4 invariant test enforces it).
- **CSV quote prefix:** the CSV writer prefixes `'` to values starting `= + - @` (formula-injection guard); a re-uploaded CSV would import those values corrupted. The failures download now defaults to **XLSX** (inline strings, no prefix), and a CSV repair upload containing such a prefix is rejected (`repair_csv_quote_prefix`) with a pointer to XLSX instead of importing a corrupted value.
- Job resource exposes `parent_job_id`.

## Safety

No accounting/ledger/ZATCA/inventory logic, no AI/provider setting, no env/Railway change; the migration adds one nullable column. Existing jobs are unaffected (`parent_job_id` null ⇒ no claim code path). The repair path writes products only through the unchanged `ProductImportService::apply`.
Note: users without `products.view_cost` download the failures file with cost columns blank; a repair built from it carries blank cost cells (under the default `blank_policy=ignore` the existing cost is kept).

## Tests

`ImportJobRepairTest` (7, SQLite): corrected file repairs exactly the 150 failed units through a child (250 products, no duplicates, units `repaired` by that child, parent `failed_units` 0); a child that fails again claims nothing (units stay repairable, then a second child repairs them); two children over the same units repair each unit once (loser fails `repair_ref_already_used`, writes nothing); membership rejections create no job; only a failed job, only a manager, only the same tenant; CSV quote prefix refused; atomic file domains refused.
`ImportRepairClaimConcurrencyPostgresTest` (**real PostgreSQL, `pcntl_fork`**): four children racing over the same five units ⇒ exactly one wins, five products, three losers fail. **Negative control:** disabling the claim fails both the SQLite two-children test and the PG race test.
Run locally on both engines: S8a+S8b+S3c+S4 suites on PostgreSQL 16 (59 passed) and the wider import/AI/branch suites on SQLite (351 passed, 7 skipped). CI (SQLite + PostgreSQL + Gate) on the PR.

## Not in S8b

The "إصلاح الصفوف الفاشلة" UI step and web client/contract (S8c); `preview_required` activation and the optional throttle (S3d).
