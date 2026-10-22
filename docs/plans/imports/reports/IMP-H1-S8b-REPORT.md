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

## Independent review (read-only subagent) — findings and disposition

Verified correct by the reviewer: claim window ↔ engine window mapping (header, blank rows, `dataIndex`), claim/write atomicity under savepoints (no path where a ref is claimed without its row being written, or lost), tenant scoping of every unit query, cost redaction cannot be abused (`purchase_price` mapping is refused without the permission; price fields are not `clearable`, so `blank_policy=clear` cannot wipe cost).

| # | Finding | Disposition |
|---|---|---|
| 1 | A non-UUID ref made PostgreSQL raise `22P02` ⇒ **500** instead of `repair_ref_unknown` (SQLite hid it) | **Fixed:** strict canonical UUID check before any query; tested |
| 2 | A lost-response retry with the same `idempotency_key` after the child was applied got `repair_ref_not_failed` instead of the existing job | **Fixed:** membership is skipped when the key already maps to a child of this parent (`create` still verifies the request matches); tested |
| 3 | `nullOnDelete` + `imports:prune` could delete a failed parent under an unfinished child, un-linking it so it ran as an ordinary import without claims (comment promised fail-closed) | **Fixed:** prune keeps a parent that has an unfinished child (negative control fails without it); migration comment corrected |
| 4 | Omitted `options` default to create-mode, not the parent's | **Partly fixed:** child creation inherits the parent's frozen options when none are sent (affects binding identity). The apply request's own options still decide for an unbound job, as for every job — the S8c UI passes the wizard options explicitly |
| 5 | Performance: the repair file is parsed a few extra times (per chunk and at start); `whereIn` of 20k values; possible 40P01 if two children claim refs in different orders | **Accepted, low:** bounded by the 5MB/20k-row limits and PG's 65,535-parameter limit; a deadlocked child ends `failed` with its claim rolled back (safe) |
| 6 | Test gaps (blank rows, malformed ref, idempotent retry, prune) | **Added**; branch-mismatch with a null-branch parent remains untested (legacy parents are unrestricted by design) |

## Tests

`ImportJobRepairTest` (11, SQLite): corrected file repairs exactly the 150 failed units through a child (250 products, no duplicates, units `repaired` by that child, parent `failed_units` 0); a child that fails again claims nothing (units stay repairable, then a second child repairs them); two children over the same units repair each unit once (loser fails `repair_ref_already_used`, writes nothing); membership rejections create no job; only a failed job, only a manager, only the same tenant; CSV quote prefix refused; atomic file domains refused.
`ImportRepairClaimConcurrencyPostgresTest` (**real PostgreSQL, `pcntl_fork`**): four children racing over the same five units ⇒ exactly one wins, five products, three losers fail. **Negative control:** disabling the claim fails both the SQLite two-children test and the PG race test.
Run locally on both engines: S8a+S8b+S3c+S4 suites on PostgreSQL 16 (59 passed) and the wider import/AI/branch suites on SQLite (351 passed, 7 skipped). CI (SQLite + PostgreSQL + Gate) on the PR.

## Not in S8b

The "إصلاح الصفوف الفاشلة" UI step and web client/contract (S8c); `preview_required` activation and the optional throttle (S3d).
