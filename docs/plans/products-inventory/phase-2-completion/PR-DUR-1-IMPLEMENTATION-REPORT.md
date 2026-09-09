# AWJ Implementation Report — PR-DUR-1 (Durable Imports — Job/File Infrastructure)

**Date:** 2026-09-09
**Status:** Implemented, tested, not merged
**Branch:** `claude/sharp-tesla-490skb`
**PR:** opened against `main` (see PR link in the pull request created from this branch)
**Base SHA:** `001fe92fc89bdec72b8c39f694d976cd97dd6c3e`
**Head SHA:** see the commit created alongside this report

## 1. Summary

Phase 2B (Durable Imports) had no PR-level decomposition yet — only the program-level
`DURABLE-IMPORTS.md` contract existed. Per the task instructions, this session:

1. Verified Durable Imports' stated prerequisites (`PR-INV-1`, `PR-UOM-1`, `PR-PROD-LIFE-1`,
   finalized Multiple-UOM workbook) are actually satisfied on current `main` — by reading code
   directly, since none of those literal identifiers appear in `main`'s commit history (the
   plan docs' PR names don't match the actual merged commit titles).
2. Measured the concrete gap between the `DURABLE-IMPORTS.md` plan and current `main`: all
   three import surfaces (`ProductImportService`, `ProductWorkbookService`,
   `InventoryOpeningImportService`) require the client to re-transmit the entire file on every
   `inspect`/`preview`/`apply` call — there is no durable, tenant-owned file/job identity.
3. Wrote `DURABLE-IMPORTS-DECOMPOSITION.md`, decomposing Durable Imports into five PRs
   (PR-DUR-1..5), mirroring the rigor of the existing `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md`.
4. Found no unresolved Decision Gate blocking PR-DUR-1 (D-08 "Product Catalog import stock
   effects" is already `DECIDED: NO`; no other Decision Register row applies).
5. Implemented **PR-DUR-1 only**: the durable import job/file infrastructure foundation —
   upload → tenant-owned storage → sha-256 fingerprint → structural inspect (row/column bounds
   reusing `ProductImportService`'s existing constants) → `ready`/`failed` → cancel → retention
   pruning. **Zero wiring into any existing import path** — `/products/import/*`,
   `/products/workbook/*`, `/inventory-openings/import/*` are untouched.

No merge, no deploy. No second PR started.

## 2. Scope implemented

New, fully additive surface: `POST/GET /import-jobs`, `GET /import-jobs/{id}`,
`POST /import-jobs/{id}/cancel`, plus `imports:prune` maintenance command. Domain catalog
limited to `product_catalog` only in this PR (see decomposition doc §4, decision D-G) —
`product_workbook` and `inventory_opening` are added in PR-DUR-3/PR-DUR-4 alongside their own
wiring, not pre-declared here as dead vocabulary.

Full contract, decisions (D-G through D-J), failure semantics and acceptance criteria are in
`docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` §4.

## 3. Files changed

| File | Change | Why |
|---|---|---|
| `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` | new | PR-DUR-1..5 decomposition — prerequisite verification, measured gap, per-PR contracts |
| `database/migrations/2026_09_17_010000_create_import_jobs_table.php` | new | `import_jobs` table — one new table, fully additive |
| `app/Models/ImportJob.php` | new | `CompanyWide` model (tenant-wide operation, not branch-scoped — matches `ProductBarcode`/`BarcodeRegistryEntry`/`InventoryOpening` precedent) |
| `app/Support/ImportJobDomain.php` | new | Domain catalog — `product_catalog` only in this PR |
| `app/Support/ImportJobStatus.php` | new | Full status vocabulary declared now; only `uploaded→ready\|failed` and `{uploaded,ready}→cancelled` are reachable in this PR (asserted by a dedicated test) |
| `app/Services/ImportJobFileStorage.php` | new | Local private-disk storage (D-I) — sha-256 fingerprint, store/delete |
| `app/Services/ImportJobService.php` | new | `create()` (idempotent-by-key), `inspect()` (reuses `SpreadsheetReader` + `ProductImportService::MAX_ROWS`/`MAX_COLUMNS`), `cancel()` |
| `app/Http/Requests/StoreImportJobRequest.php` | new | File/domain/idempotency_key validation — file rules copied verbatim from `ImportProductsRequest` |
| `app/Http/Resources/ImportJobResource.php` | new | API response shape |
| `app/Http/Controllers/Api/ImportJobController.php` | new | `index`/`show`/`store`/`cancel`, extends `ApiController` for the standard `RuntimeException`→422 mapping |
| `app/Console/Commands/PruneImportJobs.php` | new | `imports:prune` — retention cleanup for `cancelled`/`failed` jobs past `purge_after`, mirrors `PruneWebhooks` |
| `config/imports.php` | new | `retention_days` (default 14) |
| `routes/api.php` | +6 lines | 4 new routes under existing `products.manage`/`products.view` gates — no new RBAC permission |
| `routes/console.php` | +5 lines | `imports:prune` daily schedule entry, same deferred-activation note as the existing `webhooks:prune` entry |
| `tests/Feature/ImportJobTest.php` | new | 9 tests covering upload/inspect/fail/idempotency/tenant-isolation/cancel/status-vocabulary/prune |

## 4. Schema / migrations / API contract

**Schema:** one new table, `import_jobs` (see migration for full column list: domain, status,
idempotency_key, original_filename/extension/mime_type/byte_size, storage_disk/storage_path,
content_sha256, row_count/column_count, error_message, created_by/cancelled_by, timestamps,
purge_after). No existing table altered. Down-migration drops the table cleanly.

**API (all new, additive):**
- `POST /api/import-jobs` (`products.manage`) — multipart `file`, `domain` (`product_catalog`
  only), optional `idempotency_key`. Returns 201 with the job resource.
- `GET /api/import-jobs` (`products.view`) — paginated list, filterable by `domain`/`status`.
- `GET /api/import-jobs/{id}` (`products.view`) — show; 404 for another tenant's job.
- `POST /api/import-jobs/{id}/cancel` (`products.manage`) — 422 outside `uploaded`/`ready`.

None of the three existing import surfaces' routes, requests, services, or controllers were
modified.

## 5. Security / Tenant / Branch / Warehouse evidence

- **Tenant isolation:** `ImportJob` inherits `BaseModel`'s `BelongsToTenant`/`TenantScope`.
  Tested explicitly: `a_job_cannot_be_read_or_cancelled_from_another_tenant` (404 on cross-tenant
  `show`/`cancel`), `the_same_idempotency_key_in_another_tenant_does_not_collide` (uniqueness is
  `(tenant_id, idempotency_key)`, never global).
- **Branch classification:** `ImportJob implements CompanyWide` — verified by
  `BranchIsolationGuardTest` (all 4 assertions pass, including "declared company-wide is never
  also branch-scoped").
- **RBAC:** reuses the existing `products.manage`/`products.view` permissions — identical gate
  to the three existing import surfaces; no new permission invented.
- **No cost fields exposed:** this PR carries no monetary/cost field at all (file metadata only),
  so `SensitiveCostPolicy` has nothing to redact here.

## 6. Accounting / Inventory reconciliation

**Not applicable.** This PR creates, updates, or deletes zero rows in `products`,
`product_barcodes`, `price_list_items`, `barcode_registry`, `inventory_openings`,
`inventory_opening_lines`, `journal_entries`, or `journal_lines`. It stores a file and a job
record about it — nothing else. Verified explicitly by test assertion
`$this->assertSame(0, Product::count(), ...)` after every job-creating test.

**No journal entry is generated by this PR.** There is no accounting entry table to present.

## 7. UOM / historical semantics

Not applicable — no `Product`, `UnitTemplate`, or UOM-bearing row is touched.

## 8. Concurrency / idempotency

- **Job-creation idempotency:** a client-supplied `idempotency_key`, unique per
  `(tenant_id, idempotency_key)`. A repeated `POST` with the same key returns the existing job
  (200-shape via the same 201 resource) instead of creating a second row or storing the file
  twice — tested (`repeating_the_same_idempotency_key_returns_the_same_job_without_a_second_write`,
  asserts `ImportJob::count() === 1`).
- **Cancellation race:** `cancel()` checks `ImportJobStatus::CANCELLABLE_FROM` and throws
  (422, no state change) outside `uploaded`/`ready` — tested explicitly (double-cancel rejected).
- **Chunked/resumable apply, retry-safe row-level idempotency:** out of scope for this PR by
  design (PR-DUR-2) — this PR does no processing beyond a synchronous structural inspect.

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=ImportJobTest` (SQLite) | ✅ 9 passed (52 assertions) | new tests, isolated run |
| `php artisan test --filter=ImportJobTest` (PostgreSQL) | ✅ 9 passed (52 assertions) | identical |
| `php artisan test --filter="ProductImportTest\|ProductImportV2Test\|ProductWorkbook\|InventoryOpeningImport"` (SQLite) | ✅ 110 passed (635 assertions) | existing import surfaces, zero regression |
| `php artisan test --filter="ProductImportTest\|ProductImportV2Test\|ProductWorkbook\|InventoryOpeningImport\|BranchIsolationGuardTest"` (PostgreSQL) | ✅ 114 passed (749 assertions) | existing import surfaces + architecture guard, zero regression |
| `php artisan test --filter=BranchIsolationGuardTest` (SQLite) | ✅ 4 passed (114 assertions) | confirms `ImportJob`'s `CompanyWide` classification |
| **Full suite, SQLite** (clean, single run, no concurrent DB access) | 26 failed, 15 skipped, **3147 passed** (20499 assertions), 428.52s | see §13 — all 26 failures are one pre-existing, unrelated cause |
| **Full suite, PostgreSQL** (clean, single run) | 26 failed, **3162 passed** (20568 assertions), 936.73s | same 26 failures (the 15 SQLite-skipped concurrent-connection tests run for real here — 3147+15=3162, consistent) |
| Copy-list guard (`.github/workflows/ci.yml`'s directory-allowlist check, run manually) | ✅ passes | every new file's directory is already in the allowed list — no CI guard update needed |

**Two initial full-suite attempts were discarded as invalid** before the clean runs above: the
first full-suite run was contaminated by a concurrent `--filter` run I started against the same
SQLite file mid-suite (`SQLSTATE[HY000]: database is locked`, cascading into 78 false failures);
both clean runs above were single, uninterrupted, single-process runs against a freshly migrated
database.

## 10. Build / Lint / Typecheck

`php -l` on every new/changed PHP file: no syntax errors. No `web/` changes in this PR — Web CI
is not applicable.

## 11. CI

Not run on GitHub Actions from this session (no push yet at report-writing time). Locally
assembled the exact Laravel 11 project `ci.yml`/`setup.sh` describe (`composer create-project
laravel/laravel:^11.0`, `laravel/sanctum`, core files merged per the same copy list, service
providers registered, `install:api`) and ran `php artisan test` directly — the same command CI
runs — on both SQLite and a local PostgreSQL 16 instance configured with CI's exact
`DB_DATABASE=nibras`/`DB_USERNAME=nibras`/`DB_PASSWORD=secret` values. `league/flysystem-aws-s3-v3`
and `predis/predis` (S3/Redis support, unrelated to this PR and unreachable via this session's
network policy for a large `git clone` of `aws/aws-sdk-php`) were omitted from this **local
verification build only** — nothing in PR-DUR-1 or the existing suite depends on either package
being installed (S3 storage requires `document_center.storage.persistent_enabled=true`, which
defaults `false`; Redis is not exercised by any test in this run). The actual CI workflow file is
unmodified and still installs both.

## 12. Deviations from approved plan

None on scope. Two **local-verification-environment** gaps were found and are disclosed rather
than worked around in code:

1. `poppler-utils` was missing from this sandbox initially (one `DocumentCenterSecureIntakeTest`
   PDF-page-limit test failed); installed via `apt-get install poppler-utils` before the clean
   runs — CI already installs this (`ci.yml`: "تثبيت محركات PDF وXML" step).
2. The PHP `bcmath` extension is unavailable in this sandbox and could not be installed (the
   `ppa.launchpadcontent.net/ondrej/php` source needed for `php8.4-bcmath` is blocked by this
   session's outbound network policy, returning `403 Forbidden`). This causes exactly 26 test
   failures across exactly 6 classes — `FuelAviRfidServiceTest`, `FuelReconciliationTest`,
   `FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingApiTest`,
   `FuelSupplyReceivingTest` — all with the identical error `Call to undefined function
   App\Services\bcmul()` in `app/Services/FuelCostBasisService.php:380`, a file this PR does not
   touch and a domain (fuel station cost-basis accounting) entirely unrelated to Durable Imports.
   Both SQLite and PostgreSQL clean runs show the **exact same 26 failures, nothing more** —
   confirming this is one pre-existing, environment-specific gap, not a regression. GitHub
   Actions CI installs `bcmath` explicitly (`shivammathur/setup-php@v2`'s `extensions:` list
   includes `bcmath`) and will not exhibit this failure.

No scope expansion: no accounting/GL/UOM/pricing file was touched; no existing import
endpoint/service/request was modified; no new RBAC permission was invented.

## 13. Risks / remaining work

- **Risk:** none identified against the stated invariants (tenant isolation, no accounting
  effect, backward compatibility) — all covered by the tests in §9.
- **Remaining, by design (not this PR's scope):** chunked/resumable `apply()` wired to Product
  Catalog import (PR-DUR-2), then Product Workbook (PR-DUR-3) and Inventory Opening (PR-DUR-4)
  through the same engine, then a frontend (PR-DUR-5). None of these are started.
- **Verify in real CI:** the `bcmath`-dependent Fuel suite and the PDF-page-limit test, which
  this local sandbox could not fully validate due to network-policy-blocked package sources
  (§12) — expected to pass identically to how they did before this PR, since this PR touches
  neither the Fuel domain nor Document Center.

## 14. Merge / deploy status

**Not merged. Not deployed.** No autonomous merge/deploy was performed or requested.

## 15. Next step

Await review of this report and the opened PR. Per the task's own gate, do not start PR-DUR-2
(chunked apply engine wired to Product Catalog import) until this PR is reviewed/merged — each
PR in the decomposition is opened, reviewed, and merged separately.
