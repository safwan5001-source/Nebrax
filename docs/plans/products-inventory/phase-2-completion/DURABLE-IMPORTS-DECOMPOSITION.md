# Durable Imports — PR Decomposition

**Status:** DECOMPOSED against `main` @ `001fe92fc89bdec72b8c39f694d976cd97dd6c3e`
**Authorized by:** owner (Safwan), this session — decomposition authored by executor, per task instruction to
decompose before implementing when no executable PR-level split exists yet.
**Feature plan:** `DURABLE-IMPORTS.md` (program contract; invariants below are inherited verbatim)
**Gate satisfied:** `PHASE2-DEPENDENCIES-AND-GATES.md` — "not implementation-ready until it has its own scoped
PR decomposition, API/schema decisions, migration strategy, tests, failure semantics"
**Precedent followed:** `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` — same measured-baseline / PR-table / per-PR
contract structure.

---

## 1. Prerequisite verification (measured, not assumed)

`DURABLE-IMPORTS.md` §Prerequisites names `PR-INV-1, PR-UOM-1, PR-PROD-LIFE-1` and "finalized Multiple-UOM
workbook contracts". The `phase-1-hardening/PR-*.md` contract files exist, but **no commit on `main` carries
those literal PR identifiers in its message** — the actual implementation history uses different commit
titles. Verified by reading code directly instead of trusting commit-message grep:

| Prerequisite | Contract asks for | Found on `main` | Evidence |
|---|---|---|---|
| PR-INV-1 (central sensitive-cost authorization) | one centralized cost-visibility policy, no feature-local hidden-cost list | ✅ present | `app/Support/SensitiveCostPolicy.php`, consumed by `ProductImportService`, `ProductExportService`, `ProductWorkbookController`, `InventoryController`, `InventoryReportController`, `PosController` |
| PR-UOM-1 (barcode namespace + unit invariant + live-reference guard) | tenant-wide atomic barcode namespace, `Product.unit == UnitTemplate.base_unit`, fail-closed live refs | ✅ present | `app/Models/BarcodeRegistryEntry.php` (`CompanyWide`, atomic claim), `ProductBarcode::booted()` claims into it, semantic-mutation guard referenced directly in `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` §1 |
| PR-PROD-LIFE-1 (product reference registry + inventory-identity guard) | census of `product_id` references, lifecycle-safe delete/deactivate | ✅ present | `app/Support/ProductReferenceRegistry.php`, `app/Services/ProductLifecycleService.php` |
| Finalized Multiple-UOM workbook contracts | Products/Barcodes/Unit Prices workbook stable | ✅ present | PR-UOM2-4 merged at `db8dc47561279f005a302d3019d6e780ddeb3001` (the last merge named in this task) — `app/Services/ProductWorkbookService.php`, `app/Support/BarcodeImportFields.php`, `app/Support/UnitPriceImportFields.php` |

All four prerequisites are satisfied on current `main`. No Decision Gate from `DECISION_REGISTER.md` or
`PHASE2-DEPENDENCIES-AND-GATES.md` blocks Durable Imports (D-08 "Product Catalog import stock effects" is
already `DECIDED: NO`; none of the other `NEEDS DECISION` rows — barcode reuse, weighted barcode, variants,
reservations, expiry override, valuation, auto-purchasing — apply to this feature).

**Conclusion:** implementation is authorized to begin at PR-DUR-1 without an owner decision request.

---

## 2. Current-main baseline (measured, not assumed) — the gap

Three independent surfaces already implement the **whole-file synchronous** shape of the pipeline
(`inspect` → `preview` → `apply`), each taking a fresh `Illuminate\Http\UploadedFile` on **every** call:

| Surface | Service | `inspect`/`preview`/`apply` signature | Row/size ceiling |
|---|---|---|---|
| Product Catalog import | `ProductImportService` | `inspect(UploadedFile)`, `preview(UploadedFile, array, bool)`, `apply(UploadedFile, array, ?string, bool)` | `MAX_ROWS = 2000`, `MAX_COLUMNS = 200`, 5 MB (`ImportProductsRequest`) |
| Product Workbook (3-sheet) | `ProductWorkbookService` | same shape, plus `?PriceList $priceList` | same ceilings, XLSX only |
| Inventory Opening import | `InventoryOpeningImportService` | same shape | same ceilings |

`ProductImportService::apply()` already accepts `batch_offset`/`batch_size` (`APPLY_BATCH_SIZE = 100`) so a
caller *can* split `apply()` across several HTTP requests — but **the client must re-transmit the entire file
on every batch call**, because nothing server-side persists it between requests. There is no job/file record,
no fingerprint, no status a client can poll after a disconnect, and no artifact of a completed/failed run.
This is precisely the gap `DURABLE-IMPORTS.md` names: *"Replace synchronous scale ceilings with durable,
observable, idempotent import jobs."*

**First gap to close, in pipeline order:** *Upload → immutable file fingerprint → inspect → mapping/options
snapshot* — i.e. give the file and the run itself a durable, tenant-owned, queryable identity **before**
touching chunked apply, worker dispatch, or any domain-specific wiring. Everything downstream (deterministic
chunked apply, resumable retry, per-domain wiring) depends on this identity existing first, and none of it can
be safely built without it.

---

## 3. PR sequence

Ordering follows `PHASE2_PLANNING_HANDOFFS.md` §Durable Imports: *"Decompose job infrastructure separately
from Product Catalog domain apply and Inventory Opening domain apply. Worker infrastructure must not own
accounting posting."*

| PR | Title | Schema | Depends on | Status |
|---|---|---|---|---|
| **PR-DUR-1** | Durable import job/file infrastructure (foundation) | 1 new table | — | merged |
| **PR-DUR-2** | Chunked/resumable apply engine, wired to Product Catalog import only | job columns only (no new table) | PR-DUR-1 | merged |
| **PR-DUR-3** | Wire Product Workbook (3-sheet) apply through the same engine | none | PR-DUR-1, PR-DUR-2 | merged |
| **PR-DUR-4** | Wire Inventory Opening import through the same engine (Draft-only) | none | PR-DUR-1, PR-DUR-2 | merged |
| **PR-DUR-5** | Frontend: durable import UI (upload-once, poll, cancel, result download) | none | PR-DUR-2..4 | **this PR** |

Each is opened, reviewed and merged separately. No mega-PR. Every existing synchronous endpoint
(`/products/import/*`, `/products/workbook/*`, `/inventory-openings/import/*`) stays untouched through the
whole sequence — durable import is an **additive parallel path**, not a replacement, until a later, explicitly
approved deprecation decision (out of scope for this program).

---

## 4. PR-DUR-1 — contract (this PR)

### Goal

Give an uploaded import file and its run a **durable, tenant-owned, queryable identity**: persisted once,
fingerprinted, structurally validated (inspected), and cancellable — before any chunked/background processing
exists. This is the substrate PR-DUR-2..4 attach to. It changes zero behavior on any existing endpoint.

### Owner decisions recorded (this session)

| # | Decision | Chosen |
|---|---|---|
| D-G | Which domains can a job target in this PR? | **`product_catalog` only.** `product_workbook` and `inventory_opening` are added as their own enum values in PR-DUR-3/PR-DUR-4, each alongside the PR that actually wires processing for it — an unwired domain value sitting in the database is dead vocabulary a later PR would have to re-justify. `App\Support\ImportJobDomain` is a plain string-backed catalog (not a DB enum type), so adding a domain is an application-layer change, not a migration. |
| D-H | Does this PR dispatch any queued job or process any chunk? | **No.** `QUEUE_CONNECTION=sync` in production today (no real background worker) per `CLAUDE.md`'s explicit note; inventing `ShouldQueue` machinery with nothing to consume it is scope creep this PR does not need. `inspect` (header/row-count/column-count validation reusing `SpreadsheetReader`) is cheap enough to run synchronously within request time, exactly as the existing three surfaces already do it. Chunked, queue-dispatched `apply` is PR-DUR-2's entire subject. |
| D-I | Storage backend | **Updated after owner review (see §4a).** A driver-neutral (local/S3-compatible) storage contract, config-driven via `config/imports.php`, fully independent of `DocumentStorageService`/`PlatformIntegrationResolver` (infrastructure *pattern* reused, not Document Center code or domain logic). Defaults to `local` today — inheriting the system-wide interim posture already documented in `deploy/DEPLOY.md` ("مخاطرة مؤقتة مقبولة خلال مرحلة التطوير"), not a new decision. **`local` is explicitly documented as non-durable across a Railway/Render redeploy or restart** — this PR makes no cross-deploy persistence claim while so configured. Switching to real S3/R2 is a config/env change only (`IMPORTS_STORAGE_DRIVER=s3` + credentials); no Durable Imports code changes. Provisioning real credentials/bucket/cost is explicitly **not** this PR's decision — owner-only, deferred. |
| D-J | Job-creation idempotency mechanism | **Client-supplied `idempotency_key`, unique per `(tenant_id, idempotency_key)`.** A network retry of the same `POST /import-jobs` returns the existing job instead of creating a duplicate row. This is upload-idempotency only; row-level/apply-level duplicate-write prevention against Products/barcodes/opening lines is PR-DUR-2's contract (reusing `ProductImportService`'s existing match-by-`nebrax_id`-then-`sku` semantics, unchanged). |
| D-K | Idempotency race safety (added after owner review, see §4a) | The DB unique index `(tenant_id, idempotency_key)` is the sole arbiter — the pre-check query is a fast path, never the guarantee. `ImportJobService::create()` wraps its insert in `DB::transaction()` and catches `Illuminate\Database\UniqueConstraintViolationException` (portable across SQLite/PostgreSQL — Laravel maps each driver's native unique-violation error to this one class); the losing request deletes its own just-stored file (no orphan) and returns the winner's row after the same payload-binding check as D-L. The explicit transaction matters on PostgreSQL specifically: without it, a failed insert poisons the ambient transaction (`25P02`) and even the recovery `SELECT` afterward fails — SQLite does not exhibit this, but the fix is engine-agnostic. |
| D-L | Idempotency payload binding (added after owner review, see §4a) | Reusing an `idempotency_key` **only** counts as a genuine retry when the new request's `domain` and content **SHA-256** both match the existing job's stored values, byte-for-byte. Any mismatch (different file or different domain under the same key) is rejected fail-closed (422, `RuntimeException`) — the existing job is never silently returned for a request it does not represent, and no new row/file is created for the rejected attempt. Mapping/options are not part of the comparison because PR-DUR-1 captures none (D-H) — a later PR that adds them must extend this same binding, not invent a second one. |

### 4a. Post-review fixes (same PR, before merge)

A first review of PR #746 raised three findings, resolved with Safwan's explicit sign-off before merge —
recorded here so this document (not just the PR thread) carries the approved decision:

1. **Storage durability blocker.** The original D-I ("local disk, promoting to S3/R2 later is a config
   change — not blocking") undersold the risk: AWJ's production container filesystem (Render today, Railway
   named explicitly in review) has **no persistent volume**, so a redeploy, restart, or container replacement
   loses local files immediately — not eventually. Asked whether to (a) build the configurable local/S3
   contract with local as the default (inheriting the system's already-documented interim posture, `deploy/DEPLOY.md`),
   (b) wire in real credentials the owner already has, or (c) something else (e.g. a Railway Volume), **Safwan
   approved (a)** with mandatory constraints carried into D-I above and into `config/imports.php`'s own
   documentation: never describe local storage as production-durable; the storage abstraction must let a later
   S3/R2 switch happen through configuration alone, with no Durable Imports domain/application code change;
   private visibility and tenant-separated paths are preserved; **this PR provisions no infrastructure** (no
   bucket, no credentials, no Railway Volume); and no later Durable Imports PR may claim cross-deploy/restart
   persistence as a guaranteed production invariant until real persistent storage is actually provisioned.
2. **Idempotency race / orphan cleanup.** The original `create()` treated its pre-check as sufficient; two
   concurrent requests with the same `(tenant_id, idempotency_key)` could both pass it, both store a file, and
   race on the insert — leaving the loser's file orphaned with no row pointing at it. Fixed per D-K.
3. **Idempotency payload binding.** The original contract never said what happens when a reused key carries a
   *different* file or domain — a real risk once request retries and this key are conflated. Fixed per D-L:
   fail closed, never silently return an unrelated job.

None of this changes PR-DUR-1's boundary with PR-DUR-2..5, D-08, or any accounting/UOM/pricing invariant.

### In scope

- Migration: `import_jobs` table — `CompanyWide` (an import run is a tenant-wide operation, not a branch
  concern, matching `ProductBarcode`/`BarcodeRegistryEntry`/`InventoryOpening`'s header precedent).
- `App\Models\ImportJob` (`BaseModel`, `implements CompanyWide`).
- `App\Support\ImportJobDomain` — the domain catalog (`product_catalog` only, extensible without migration).
- `App\Support\ImportJobStatus` — the full state vocabulary (`uploaded`, `ready`, `queued`, `processing`,
  `completed`, `failed`, `cancelled`) declared now so PR-DUR-2 needs no migration to reach it; **only
  `uploaded → ready|failed` and `{uploaded,ready} → cancelled` are reachable by any code path in this PR.**
  `queued`/`processing`/`completed` are forward-declared vocabulary, not live transitions — this PR asserts
  that explicitly in tests (no code path can reach them yet).
- `App\Services\ImportJobFileStorage` — driver-neutral private storage (local today; S3-compatible, R2
  included, via config alone — D-I), tenant-and-job-separated keys (`imports/{tenant_id}/{job_id}/…`),
  fail-closed on an incomplete `s3` configuration (missing key/secret/bucket/endpoint throws before any
  write, mirroring `DocumentStorageService`'s own guard — pattern reused, class/dependency not shared).
  `store()` takes a pre-computed sha-256 from the caller (one hash, one source); `readStream()` is
  driver-agnostic so `inspect()` never assumes a local filesystem path.
- `App\Services\ImportJobService` — `create()` (fingerprint, idempotency pre-check + payload-binding — D-L,
  race-safe insert-or-fetch — D-K, store, row), `inspect()` (materializes a local temp copy via
  `readStream()` so `SpreadsheetReader::read()` — which needs a real file path for XLSX's
  `ZipArchive`/`XMLReader` — works identically regardless of storage driver; reuses the existing
  `MAX_ROWS`/`MAX_COLUMNS` ceilings, **the exact same constants `ProductImportService` already enforces**,
  not a second copy), `cancel()`.
- `App\Http\Controllers\Api\ImportJobController` — `index`, `show`, `store`, `cancel`. Extends `ApiController`
  (its `domain()` helper maps `RuntimeException` → 422, matching every other import surface's error shape).
- `App\Http\Requests\StoreImportJobRequest` — file rules copied verbatim from `ImportProductsRequest`
  (`mimes:csv,txt,xlsx`, `max:5120`), plus `domain` (`Rule::in(ImportJobDomain::values())`) and optional
  `idempotency_key`.
- `App\Http\Resources\ImportJobResource`.
- Routes, additive, under the existing `products.manage`/`products.view` gate (identical permission surface to
  all three existing import surfaces — no new RBAC permission invented):
  - `POST /import-jobs` (`products.manage`)
  - `GET /import-jobs` (`products.view`)
  - `GET /import-jobs/{id}` (`products.view`)
  - `POST /import-jobs/{id}/cancel` (`products.manage`)
- `App\Console\Commands\PruneImportJobs` (`imports:prune`) — deletes the stored file and row for jobs in a
  terminal state (`cancelled`/`failed`; `completed` is unreachable in this PR) past `purge_after`
  (`config('imports.retention_days')`, default 14), mirroring `PruneWebhooks`'s existing `--dry-run` shape and
  registered on the same `routes/console.php` schedule pattern (`->daily()->withoutOverlapping()->onOneServer()`).
- `config/imports.php` — `retention_days`, `max_file_kilobytes` (mirrors `ProductImportService::MAX_ROWS`/
  `MAX_COLUMNS` as the single source for row/column ceilings; file-size ceiling stays owned by
  `StoreImportJobRequest`'s `max:5120` rule, identical to the three existing surfaces, not duplicated here).
- Tests on SQLite **and** PostgreSQL.

### Explicitly out of scope

- Any change to `ProductImportService`, `ProductWorkbookService`, `InventoryOpeningImportService`, or their
  controllers/routes/requests. **Zero behavior change to any existing import path** — this is the task's
  explicit backward-compatibility requirement, not just a convention.
- Chunked/resumable `apply()`, any queued job, any worker, any progress percentage beyond the binary
  `uploaded`/`ready`/`cancelled`/`failed` this PR actually reaches. PR-DUR-2.
- Any domain other than `product_catalog` in the `ImportJobDomain` catalog. PR-DUR-3/PR-DUR-4 each add their
  own value alongside their own wiring.
- Any accounting/GL, UOM, pricing, or inventory-quantity effect — this PR does not create, update, or delete a
  single `Product`, `ProductBarcode`, `PriceListItem`, or `InventoryOpening` row. It only stores a file and a
  job record about it.
- Actually provisioning S3/R2 (bucket, credentials, cost) — the storage *contract* is driver-neutral and
  config-switchable (D-I), but no infrastructure is created, requested, or defaulted-on by this PR.
- Frontend — backend-only, matching PR-UOM2-1's precedent (schema + API first, UI in its own later PR).

### Invariants inherited (must not regress)

- strict tenant isolation — `TenantScope` via `BelongsToTenant`; a job/file from another tenant never resolves,
  never leaks existence (404, not 403, on cross-tenant `{id}` access — matching the rest of the API's
  not-found-over-existence-leak convention);
- `Product Catalog Import = Master Data only` — this PR touches no Product-adjacent table at all, so the
  invariant holds trivially;
- no partial invisible success — a `failed` inspect leaves no stored file behind (cleanup on the same request);
- reuse, not reimplementation, of `SpreadsheetReader` and `ProductImportService::MAX_ROWS`/`MAX_COLUMNS` — no
  second row/column-limit definition anywhere in this PR.

### Failure semantics

| Case | Result |
|---|---|
| Unsupported file extension/MIME | 422 at request validation — identical message class to `ImportProductsRequest` |
| File exceeds 5 MB | 422 at request validation |
| Unknown `domain` value | 422 — fail closed, never silently coerced to `product_catalog` |
| File exceeds `MAX_ROWS`/`MAX_COLUMNS` during inspect | job created, then transitioned to `failed` with a row/column-count error — **not** a 422 on the upload request itself, because the file *was* durably stored; the failure is job state, queryable after the fact, per the plan's "no partial invisible success" |
| Duplicate `POST` with an already-used `idempotency_key`, same domain and same file content (SHA-256) | returns the existing job unchanged — no second file stored, no second row created (D-L) |
| Duplicate `POST` with an already-used `idempotency_key`, but a *different* file or domain | 422, `RuntimeException` — fail closed, the unrelated existing job is never returned (D-L) |
| Two requests race on the same `(tenant_id, idempotency_key)` and both pass the pre-check | the DB unique index resolves it; the loser catches `UniqueConstraintViolationException`, deletes its own just-stored file, and returns the winner's row (after the same D-L check) — never two rows, never an orphan file (D-K) |
| `idempotency_key` reused for a *different* tenant | no collision — uniqueness is `(tenant_id, idempotency_key)`, never global |
| `imports.storage.driver=s3` with a missing key/secret/bucket/endpoint | 422 before any write — fail closed, never a silent fallback to `local` |
| `cancel` on a job already `cancelled`/`failed` | 422 — cancellation is only valid from `uploaded`/`ready` |
| `cancel` on another tenant's job id | 404 |
| Cross-tenant `GET /import-jobs/{id}` | 404 |

### Acceptance criteria

1. Uploading a valid CSV/XLSX creates exactly one `import_jobs` row, stores the file once, computes a sha-256
   fingerprint, and reaches `ready` with header/row-count metadata populated — without calling
   `ProductImportService` at all.
2. A file that fails `MAX_ROWS`/`MAX_COLUMNS` reaches `failed` with a durable, queryable error — the file is
   deleted from storage, the job row is kept (auditable).
3. Re-submitting the same `idempotency_key` for the same tenant, with the same domain and byte-identical file,
   never creates a second job or a second stored file; a different tenant using the identical key is unaffected.
3a. The same `idempotency_key` reused with a different file or domain is rejected (422); the original job is
   untouched and no new row/file is created for the rejected attempt (D-L).
3b. Two requests racing on the same `(tenant_id, idempotency_key)` leave exactly one job row and zero orphan
   files, on both SQLite and PostgreSQL (D-K; genuine cross-connection concurrency is exercised on PostgreSQL,
   matching this codebase's existing convention for such tests — SQLite serializes writes at the file level).
3c. `imports.storage.driver=s3` with incomplete credentials fails closed (422) before any file is written;
   storage paths remain tenant-and-job-separated and private regardless of driver.
4. `GET /import-jobs`, `GET /import-jobs/{id}` never return another tenant's rows; a direct-UUID cross-tenant
   `show`/`cancel` returns 404.
5. `cancel` succeeds only from `uploaded`/`ready`, deletes the stored file, and is rejected (422, no state
   change) from any other status.
6. Zero rows change in `products`, `product_barcodes`, `price_list_items`, `barcode_registry`,
   `inventory_openings`, or `inventory_opening_lines` as a result of any call in this PR's scope.
7. The existing `/products/import/*`, `/products/workbook/*`, `/inventory-openings/import/*` test suites pass
   unmodified — proving zero regression on the three surfaces this PR does not touch.
8. `imports:prune --dry-run` counts eligible rows without deleting; without `--dry-run` it deletes both the
   stored file and the row for `cancelled`/`failed` jobs past `purge_after`, and leaves `uploaded`/`ready`
   jobs alone regardless of age.
9. Full regression (existing product import/workbook/inventory-opening-import suites) stays green on SQLite
   and PostgreSQL.

### Migration strategy

One new table, fully additive. No existing table altered. Down-migration drops `import_jobs`. Deterministic on
both engines (UUID primary key via `HasUuids`, matching every other `BaseModel`).

### Deviations requiring owner sign-off

None expected — this PR introduces no accounting/GL/UOM/pricing effect and touches no existing import surface.
If mid-implementation something outside this scope turns out to be required, stop and ask rather than
expanding it (per the task's own instruction).

---

## 5. PR-DUR-2..5 — forward contracts (not started, recorded for sequencing only)

Full contracts for these are written immediately before each one starts, against `main` as it stands at that
time (per `PHASE2_PLANNING_HANDOFFS.md`'s handoff rule — no contract is pre-authorized this far ahead). Recorded
here only to make the dependency chain and non-negotiable boundaries explicit:

- **PR-DUR-2** (superseded by §6 below — kept here only for history) wires chunked `apply` to **Product Catalog
  import only**, reusing `ProductImportService`'s existing row-validation/matching/payload-building logic (parse
  stays pure, per `CLAUDE.md`'s own note that `ProductImportService::parse` is already written to not need
  rewriting for this). New endpoints only (`/import-jobs/{id}/apply` or similar) — `/products/import/apply` is
  untouched.
- **PR-DUR-3** wires `ProductWorkbookService` the same way, reusing PR-DUR-2's engine — no second chunking
  implementation.
- **PR-DUR-4** wires `InventoryOpeningImportService` the same way, with the explicit constraint from
  `DURABLE-IMPORTS.md`: *"Large-file job may create/validate Draft data, but never auto-post."* Posting
  idempotency stays owned by `InventoryOpeningService`, never the import worker.
- **PR-DUR-5** is the only frontend PR in this sequence — upload-once UX, status polling, cancel button, result
  download — consuming PR-DUR-1..4's endpoints without inventing new backend contract.

No PR beyond PR-DUR-1 is authorized to start by this document. Each requires its own contract, written against
`main` at that time, before implementation begins.

## 6. PR-DUR-2 — contract (this PR)

### Goal

Chunked, resumable `apply` for `product_catalog` `ImportJob`s only, built strictly on top of merged/deployed
PR-DUR-1 (`main` at base SHA `26d58d8fb1ca6acee9d585f09dcd039565662a97`). No re-upload for apply; bounded
per-call chunk size; exactly-once logical effect per source row under retry and under concurrent apply attempts;
zero inventory/accounting effect (D-08 unchanged); no frontend, no Workbook/Inventory-Opening wiring, no S3/R2
work.

### Mutation boundary reused (inspected before writing any code)

`App\Services\ProductImportService::apply(UploadedFile $file, array $options, ?string $userId = null, bool
$costAuthorized = true): array` is the exact and only reuse point. It already:

- accepts `batch_offset`/`batch_size` in `$options`, resolved and capped at `self::APPLY_BATCH_SIZE` (100) by its
  private `options()` method;
- internally calls a pure `parse()` that filters rows to the `[batchOffset+1, batchOffset+batchSize]` window
  **before** validating/building payloads for them — so a chunk call only ever touches its own row window;
- wraps all writes for that window in one `DB::transaction()` (materializes pending category/brand references live,
  then per-row `Product::create()`/`ProductLifecycleService::update()`/skip with live SKU/barcode conflict
  re-checks);
- re-checks `SensitiveCostPolicy::authorized($costAuthorized)` live on every call — never cached from a prior
  preview or chunk.

PR-DUR-2 adds **zero** lines to `ProductImportService`. `ImportJobService::applyNextChunk()` is the only new
caller, and it drives `apply()` exactly the way `ProductController::importApply()` already does (same live
cost-authorization argument, same options shape) — just sourcing the file from durable storage instead of a
fresh HTTP upload, and sourcing `batch_offset` from `ImportJob.processed_rows` instead of a client-supplied value.

### Durable progress model (additive migration only)

One additive migration on `import_jobs` (`2026_09_18_010000_add_apply_progress_to_import_jobs.php`), no new
table:

| Column | Type | Purpose |
|---|---|---|
| `processed_rows` | `unsignedInteger`, default `0` | Durable cursor — next chunk's `batch_offset`. Advances only after a chunk's `DB::transaction()` (including the outer lock transaction) commits. |
| `apply_options` | `json`, nullable | Options frozen from the **first** `/apply` call, verbatim — **including `batch_size`**: it is a semantic option like `mode`/`blank_policy`/`master_data_policy`/`mapping`, not an operational per-request knob. Every later chunk reuses this frozen value in full — a later call's request body (batch_size included) is ignored for anything but which cursor to resume from, so a mid-run UI/client change can never reinterpret rows already committed under different semantics, nor change how big the remaining chunks are mid-run. Proven by `ImportJobApplyTest::batch_size_is_frozen_from_the_first_apply_call_and_later_requests_cannot_change_it`. |
| `apply_result` | `json`, nullable | Last chunk's raw `ProductImportService::apply()` return (`created`/`updated`/`skipped`/`results`) — exposed for polling; overwritten each chunk, not accumulated (row-level detail is already inside `apply_result.results` for that chunk only). |

Reused, not duplicated: `row_count` (whole-file total, from PR-DUR-1's `inspect()`) is the completion threshold;
`error_message` carries the terminal failure reason; `started_at`/`finished_at` mark apply start/completion.

### Review-round fix — `row_count`/`processed_rows`/completion must share one "data row" definition

**Finding (BLOCKER, pre-merge review of this PR):** `ImportJob.row_count` was set by PR-DUR-1's `inspect()` as
a **physical** row count (`count($rows) - 1`, including blank rows), while `ProductImportService::parse()`'s
`dataIndex` — the counter that actually drives batch windowing (`batch_offset`/`batch_size`) and that
`created`/`updated`/`skipped` are summed from — **skips blank rows without incrementing it**. A file with a blank
row anywhere (interleaved or trailing) therefore had `processed_rows` (blank-excluded) permanently short of
`row_count` (blank-included): the job could never reach `processed_rows >= row_count`, stayed `processing`
forever, and the next `/apply` call — now requesting a window past the true end of data — hit
`ProductImportService::apply()`'s `total_rows === 0` guard and was misclassified as `failed` instead of
`completed`.

**Fix — same source of truth everywhere, not a special-cased "empty chunk = done":**

- `ProductImportService::isBlankRow()` is now `public static` (was `private`) — the **single** blank-row
  definition shared by `ProductImportService::inspect()`/`parse()` (unchanged behavior there) and by
  `ImportJobService`, instead of a second copy of the predicate that could drift.
- `ImportJobService::inspect()` (PR-DUR-1's structural inspect) now computes `row_count` the same way
  `ProductImportService::inspect()` computes its own `total_rows`: header row dropped, then blank rows excluded.
  `row_count` is now **defined as the data-row count**, matching `dataIndex` exactly — the only number
  `processed_rows` is ever compared against.
- **Backward compatibility for jobs already `ready` under the pre-fix code:** `ImportJobService::applyNextChunk()`
  recomputes `row_count` from the durably-stored file **once, on the first `/apply` call** (same point where
  `apply_options` is already frozen), before the completion check runs — self-healing a stale physical-count
  `row_count` with zero migration/backfill. Any job that had *already* taken a chunk under the pre-fix bug would,
  by the state machine, already be in the terminal `failed` state (not resumable) — there is no "already stuck
  mid-flight" case left to handle. Proven by
  `ImportJobApplyTest::a_stale_pre_fix_physical_row_count_self_heals_on_first_apply`.
- `processed_rows` is now set to the exact cumulative applied count (`$offset + $processedInChunk`) with no
  `min()` cap against `row_count` — the cap is now provably a no-op (both sides share the same data-row
  definition, and `parse()`'s window can never exceed it), and removing it makes `processed_rows` visibly equal
  to "actual applicable data rows applied," per the review's explicit requirement.

Regression coverage in `ImportJobApplyTest`: a blank row between two valid rows, multiple interleaved and
trailing blank rows, `batch_size = 1` (one data row per call), final status `completed` (not `failed`),
`processed_rows` reflecting the true data-row count (not the physical one), each product created exactly once,
and idempotent retry after completion — see
`blank_rows_are_excluded_from_row_count_and_do_not_block_completion` and
`multiple_and_trailing_blank_rows_complete_in_a_single_default_size_call`.

### State machine

`ready` → (first `/apply`) → `processing` → (further `/apply` calls advance `processed_rows`) → `completed`
once `processed_rows >= row_count`. Any exception from `ProductImportService::apply()` inside a chunk →
`failed` (terminal, `error_message` set, HTTP 422). `failed`/`cancelled`/`uploaded` reject `/apply` with a
`RuntimeException` (422) — fail-closed on any status outside `{ready, processing, completed}`. A domain other
than `product_catalog` is rejected the same way — no engine exists for it yet (PR-DUR-3/4's job).
`completed` short-circuits: `/apply` returns the cached final state immediately, calling
`ProductImportService::apply()` a further time.

### Concurrency and idempotency mechanism

**One row lock held for the entire chunk, not released between reading the cursor and persisting the result.**
`ImportJobService::applyNextChunk()` opens a single `DB::transaction()` that: takes `lockForUpdate()` on the
`ImportJob` row, validates domain/status, freezes options on the first call, reads `processed_rows` as the
chunk's `batch_offset`, materializes the durably-stored file to a temp path, calls
`ProductImportService::apply()` for that window, and persists the new `processed_rows`/`status`/`apply_result` —
all before the transaction commits and the lock is released.

- **Concurrent apply attempts on the same job**: a second call's `lockForUpdate()` blocks until the first
  commits (a true row lock on PostgreSQL; SQLite's single-writer file lock serializes the same way). It then
  reads the already-advanced `processed_rows` and processes the *next* window — never the same one twice. Proven
  by `ImportJobApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock`, a genuine dual-connection
  PostgreSQL test (same convention as `DocumentNumberingTest`): a separate connection's `SELECT ... FOR UPDATE`
  on the same row, fired from an `ImportJob::saving` hook while our transaction still holds the lock, is proven
  to fail under a short `lock_timeout` — not inferred from SQLite.
- **Retry after a crash before commit**: nothing was persisted (the whole outer transaction, including the
  options-freeze save, rolls back together), so a retry re-reads the same unchanged `processed_rows` and
  reprocesses the identical window from scratch — no double effect, because nothing from the failed attempt
  ever committed. Proven by
  `ImportJobApplyTest::an_interrupted_first_chunk_leaves_no_partial_state_and_a_retry_completes_cleanly`.
- **Retry after a completed job**: short-circuits without calling `ProductImportService::apply()` again.
  Proven by `ImportJobApplyTest::retrying_a_completed_job_is_idempotent_and_creates_nothing_twice`.
- **A chunk that fails a business rule** (e.g. a live SKU conflict) is **not** resumable — it is a deterministic
  terminal `failed`, matching the requirement for "failed row tracking or deterministic failure state" with the
  smallest mechanism: no separate per-row failure ledger, `error_message` carries the reason.

### Deviation from §5's forward-contract wording (recorded, not silent)

§5 above (written before this PR's own contract) said "queue-dispatched apply." This PR does **not** dispatch a
queued job. Production runs `QUEUE_CONNECTION=sync` (per `CLAUDE.md`), under which a queued dispatch executes
synchronously in the same request with no actual deferral — so wrapping the chunk call in `dispatch()` would add
indirection without changing behavior, and a self-chaining dispatch (each chunk dispatching the next) would
under `sync` collapse into processing the *entire* file in one request, defeating the bounded-chunk purpose this
PR exists for. Instead, `POST /import-jobs/{id}/apply` processes exactly one bounded chunk per call and returns;
the caller (a future frontend polling loop in PR-DUR-5, or a script) repeats the call until `completed`/`failed`.
This preserves every literal requirement (chunked, resumable, retry-safe, idempotent, concurrency-safe) without
inventing queue machinery nothing in this environment consumes yet.

### New endpoint

`POST /import-jobs/{id}/apply`, gated `products.manage` (same as `store`/`cancel`). Body (all optional, only
read on the **first** call for this job — `ApplyImportJobRequest`): `mode`, `blank_policy`,
`master_data_policy`, `mapping`, `batch_size` (capped at `ProductImportService::APPLY_BATCH_SIZE`). No `file`,
no `batch_offset` — the cursor is server-owned. `ImportJobResource` now also exposes `processed_rows` and
`apply_result` for polling via the existing `GET /import-jobs/{id}`.

### In scope / out of scope (unchanged from the top-level requirements)

In scope: `product_catalog` only, additive schema, the concurrency/idempotency mechanism above, the required
test list (see PR-DUR-2 Implementation Report). Out of scope, explicitly not touched: Product Workbook wiring,
Inventory Opening wiring, any frontend, S3/R2 provisioning, any inventory effect (`quantity_on_hand`, `avg_cost`,
`StockMovement`) or accounting effect (`JournalEntry`/`JournalLine`) — D-08 remains **No**.

## 7. PR-DUR-3 — contract (this PR)

### Goal

Wire `product_workbook` (Products/Barcodes/Unit Prices, PR-UOM2-4) into the durable `ImportJob` lifecycle built
by PR-DUR-1/2, reusing `ProductWorkbookService::apply()` **unchanged** as the sole mutation boundary, without
inventing a parallel mutation path and without redesigning PR-UOM2-4's atomic contract, the PR-DUR-2 state
machine, or its concurrency mechanism.

### Prerequisite check (measured against current `main` before writing any code)

Confirmed PR-DUR-2 merged at `d6dcd17` (`main` HEAD at branch time). Read `ImportJobService.php` in full as
merged — it already carries a post-merge review fix (blank-row-aware `row_count`/`processed_rows`, not present
in this session's own PR-DUR-2 report) — this PR builds on that fix as-is, does not touch its `product_catalog`
behavior, and does not re-litigate it.

### The one real design fork: `ProductWorkbookService::apply()` has no chunking contract

`ProductImportService::apply()` (product_catalog's reuse point) accepts `batch_offset`/`batch_size` because its
private `parse()` filters rows to a window before validating/writing them. **`ProductWorkbookService::apply()`
has no such parameters at all** — it reads all three sheets, validates all three together
(`productsPreview()`/`parseBarcodesSheet()`/`parseUnitPricesSheet()`, matching Barcodes/Unit Prices rows against
the database **as it exists before this call**, not against rows the Products sheet is about to create), then
writes all three inside one `DB::transaction()` with Products applied first so a brand-new SKU from this same
file becomes visible to later sheets **within that transaction**. Slicing this into row-level chunks would mean
either (a) rewriting `ProductWorkbookService`'s validation/write ordering — a redesign of an approved PR-UOM2-4
contract, explicitly out of scope — or (b) inventing a second, parallel apply path that duplicates its
sheet-ordering logic — explicitly forbidden by this task's own instruction not to create a parallel mutation
path when the existing engine already covers what's needed.

**Resolution, recorded as a deliberate, disclosed scope boundary:** the workbook is treated as **one
non-divisible chunk**. `POST /import-jobs/{id}/apply` for a `product_workbook` job runs
`ProductWorkbookService::apply()` once, for the entire remaining file, inside the *same* PR-DUR-2 lock/
transaction/state-machine scaffolding (`ImportJobService::applyNextChunk()`'s `lockForUpdate()` held end-to-end,
options frozen on first call, `processed_rows`/`row_count` bookkeeping, `COMPLETED`/`FAILED` transitions) — every
concurrency, resume-after-crash, and retry-after-completion guarantee PR-DUR-2 established is fully preserved;
only the "multiple chunks across several HTTP calls" behavior is inapplicable, because the underlying service
genuinely has no smaller safe unit of work to offer. This is not a redesign of Durable Imports — the engine
(`applyNextChunk`, the lock, the state machine) is untouched in shape; only the domain-specific inner call
(`runChunk()`'s new `product_workbook` branch) differs in how large a bite it takes.

### What changed, concretely

- **`app/Support/ImportJobDomain.php`**: added `PRODUCT_WORKBOOK = 'product_workbook'`.
- **`app/Services/ImportJobService.php`**:
  - `inspectCounts()` (new, replacing inline row/column counting in `inspect()`): branches on domain —
    `product_catalog` unchanged (`SpreadsheetReader::read()`); `product_workbook` uses
    `SpreadsheetReader::readWorkbookXlsx()` (the same static reader `ProductWorkbookService::readWorkbook()`
    already wraps — no second implementation), asserts the mandatory `Products` sheet is present, and sums
    non-blank data rows across all three sheets present as `row_count` (same blank-row definition,
    `ProductImportService::isBlankRow()`, used identically for both domains).
  - `applyNextChunk()`: the PR-DUR-2 review fix's row_count-recompute-on-first-chunk block is now gated to
    `product_catalog` only (`product_workbook` is new code with no pre-existing `ready` jobs from before that
    fix, so it doesn't need the backward-compat recompute).
  - `runChunk()` (new): builds the shared `UploadedFile` from the materialized temp path, then dispatches by
    domain to `runProductCatalogChunk()` (extracted, behavior-identical to PR-DUR-2) or
    `runProductWorkbookChunk()` (new) — both return a normalized `{processed_in_chunk, result}` shape so
    `applyNextChunk()`'s lock/persist logic stays domain-agnostic.
  - `runProductWorkbookChunk()` (new): resolves the frozen `price_list_id` via
    `ProductWorkbookService::resolveActivePriceList()` (live, every call — not cached from freeze time), forwards
    only `mode`/`blank_policy`/`master_data_policy`/`mapping` to `ProductWorkbookService::apply()`, and reports
    `processed_in_chunk = row_count` (the whole job, per the one-chunk resolution above).
  - `assertApplicable()`: now accepts both `product_catalog` and `product_workbook` as domains with an engine.
- **`app/Services/ProductWorkbookService.php`**: added `resolveActivePriceList(?string): PriceList` — the exact
  lookup+active-check `ProductWorkbookController::resolvePriceList()` already performed, extracted so
  `ImportJobService` can reuse it without duplicating the rule. Throws `RuntimeException` (not `abort()`) so it
  composes with `ApiController::domain()`'s existing RuntimeException→422 convention from either caller.
- **`app/Http/Controllers/Api/ProductWorkbookController.php`**: `resolvePriceList()` now delegates to the new
  service method, catching its `RuntimeException` and calling `abort(422, ...)` exactly as before — **byte-
  identical external behavior**, confirmed by the full existing `ProductWorkbookTest` suite staying green
  unmodified.
- **`app/Http/Requests/ApplyImportJobRequest.php`**: added `price_list_id` as a structural `sometimes|nullable|uuid`
  rule and to `applyOptions()`. Business validation (exists, tenant-owned, active) stays in
  `ProductWorkbookService::resolveActivePriceList()`, not the FormRequest — consistent with how `mode`/
  `blank_policy` business rules already live in `ProductImportService::options()`, not the FormRequest.
- **`app/Http/Requests/StoreImportJobRequest.php`**: the file rule gained one closure narrowing the accepted
  extension to `xlsx` when `domain === product_workbook` (matching `ProductWorkbookImportRequest` exactly);
  `product_catalog`'s existing `csv|txt|xlsx` acceptance is untouched.
- **No migration.** `apply_options`/`apply_result` (PR-DUR-2's JSON columns) hold `price_list_id` and the
  workbook's `{products, barcodes, unit_prices}` result shape with no schema change.
- **No new endpoint.** `POST /import-jobs/{id}/apply` (PR-DUR-2) now also accepts `product_workbook` jobs; the
  request/response shape is identical, just with an optional `price_list_id`.

### PriceList / UOM / barcode contract preserved (not re-tested here, wiring only)

- **D-F unchanged**: no default/base PriceList, no per-row `price_list_id` — one `price_list_id` selected before
  apply, frozen on the first (only) chunk, re-validated live every call for tenant ownership and `is_active`.
- **UOM/barcode/pricing rules untouched**: `ProductWorkbookService::apply()`, `parseBarcodesSheet()`,
  `parseUnitPricesSheet()`, `resolveBarcodeUnit()` — zero lines changed. Unit prices remain explicit-only (never
  derived from a conversion factor); barcode unit validation against the product's unit template is identical.
  The full pre-existing `ProductWorkbookTest` suite (30 tests covering these rules in detail) passes unmodified,
  proving the durable wiring adds no regression.
- **Product Lifecycle / cost authorization untouched**: `SensitiveCostPolicy::authorized()` is still passed
  through live on every call, exactly as `ProductWorkbookController::apply()` already did.

### Concurrency / idempotency — inherited, not reimplemented

Same `lockForUpdate()`-for-the-whole-chunk mechanism as PR-DUR-2, proven again independently for this domain:
`ImportJobWorkbookApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` (genuine second PostgreSQL
connection, `lock_timeout`-based proof, same convention as `ImportJobApplyTest`'s and `DocumentNumberingTest`'s).
Retry-after-crash and retry-after-completion are proven the same way as PR-DUR-2 (interrupt via an
`ImportJob::saving` hook mid-transaction; assert no partial state; assert a clean resume).

### Accounting / inventory non-effect (D-08 unchanged)

`ImportJobWorkbookApplyTest::completed_workbook_apply_creates_zero_stock_or_ledger_effect` asserts
`StockMovement::count() === 0`, `JournalEntry::count() === 0`, `JournalLine::count() === 0`, and the created
product's `quantity_on_hand`/`avg_cost` still `0`, **while** asserting the workbook's genuine, expected outputs
(`ProductBarcode`, `PriceListItem`) are non-zero — the point is proving the *forbidden* effects are absent, not
that the whole operation is a no-op.

### In scope / out of scope

In scope: `product_workbook` wiring only, as above. Out of scope, explicitly not touched: Inventory Opening
wiring (PR-DUR-4), any frontend (PR-DUR-5), S3/R2 provisioning, any change to PR-UOM2-4's business rules, any
change to `product_catalog`'s PR-DUR-2 behavior, any inventory or accounting effect.

## 8. PR-DUR-4 — contract (this PR)

### Goal

Wire `inventory_opening` (Draft-only) into the durable `ImportJob` lifecycle, reusing
`InventoryOpeningImportService::apply()` **unchanged** as the sole mutation boundary. Zero stock or ledger
effect — `apply()` here calls `InventoryOpeningService::createDraft()` only; `InventoryOpeningService::post()`
(movements, average cost, one journal entry) is a completely separate, human-triggered path that this PR does
not touch and does not wire to the durable engine.

### Prerequisite check (measured against current `main` before writing any code)

Confirmed PR-DUR-3 merged at `9e8ed1a` (`main` HEAD at branch time). Read `InventoryOpeningImportService.php`
and `InventoryOpeningService.php` in full, plus `InventoryOpeningController`/`ImportInventoryOpeningRequest`
(the existing session-only surface) and `InventoryOpeningImportTest`/`InventoryOpeningPostingTest` (the existing
regression suites) before writing any code.

### Same design fork as PR-DUR-3, same resolution

`InventoryOpeningImportService::apply(UploadedFile $file, array $options, ?string $userId = null):
InventoryOpening` has **no `batch_offset`/`batch_size` contract at all** — it parses the *entire* file, then
calls `InventoryOpeningService::createDraft()` once for every valid line together, inside one transaction,
producing exactly one `InventoryOpening` document with one document number and totals computed across all its
lines. This is the same atomic shape PR-DUR-3 already found in `ProductWorkbookService::apply()`, for the same
underlying reason (one document, one number, totals that must reconcile against the lines that produced them —
slicing rows across several draft-creation calls would mean either multiple documents from one file, breaking
"one document per file," or rewriting `createDraft()`'s contract, out of scope). **Resolution, identical to
PR-DUR-3:** the file is one non-divisible chunk, driven through the exact same PR-DUR-2/3 lock/transaction/
state-machine scaffolding (`ImportJobService::applyNextChunk()`, `runChunk()`'s domain dispatch). No new
chunking mechanism was invented; the existing `runProductWorkbookChunk()` pattern was replicated for this
domain's own service call.

### What changed, concretely

- **`app/Support/ImportJobDomain.php`**: added `INVENTORY_OPENING = 'inventory_opening'`.
- **`app/Services/ImportJobService.php`**:
  - `inspectCounts()`: **no change needed.** `inventory_opening` is a single-sheet CSV/XLSX file with the same
    blank-row definition as `product_catalog` (`InventoryOpeningImportService::isBlankRow()` is a byte-identical
    predicate to `ProductImportService::isBlankRow()`, already reused generically) — it falls straight into the
    existing generic (non-workbook) branch with zero code change. Only `product_workbook`'s multi-sheet shape
    ever needed a special case.
  - `runChunk()`: added an `INVENTORY_OPENING` arm dispatching to the new `runInventoryOpeningChunk()`.
  - `runInventoryOpeningChunk()` (new): forwards only `opening_date`/`allow_zero_cost`/`notes`/`mapping` to
    `InventoryOpeningImportService::apply()` (no cost-authorization parameter exists on that service — it never
    had one, so none is invented here), reports `processed_in_chunk = row_count` (the one-chunk resolution
    above), and normalizes the returned `InventoryOpening` model into a small JSON-safe summary
    (`inventory_opening_id`, `number`, `status`, `total_quantity`, `total_value`, `lines_count`) for
    `apply_result` — the only domain whose `apply()` returns a model instead of an array, so this is the one
    place a normalization step was needed.
  - `assertApplicable()`: now accepts all three domains.
- **`app/Http/Requests/ApplyImportJobRequest.php`**: added `opening_date` (`sometimes|date_format:Y-m-d`),
  `allow_zero_cost` (`sometimes|boolean`), `notes` (`sometimes|nullable|string|max:500`) — structural only, same
  philosophy as `price_list_id` in PR-DUR-3 (the service's own `options()` enforces the real requirement and
  format). `mapping.*`'s `Rule::in` widened to the union of `ProductImportFields::keys()` and
  `InventoryOpeningFields::keys()` (plus `ignore`) — a value outside the *target* domain's actual vocabulary is
  still caught downstream by that domain's own service (`InventoryOpeningImportService::options()` throws for an
  unknown key exactly as before), so this widening only relaxes an accidental over-restriction, not a real gate.
- **`app/Http/Requests/StoreImportJobRequest.php`**: **no change.** `inventory_opening` accepts the same
  `csv|txt|xlsx` set `product_catalog` already does; only `product_workbook`'s XLSX-only narrowing was ever a
  domain-specific rule.
- **No migration.** `apply_options`/`apply_result` already generic JSON columns.
- **No new endpoint.** `POST /import-jobs/{id}/apply` now also accepts `inventory_opening` jobs.

### Draft-only invariant — how it's enforced, not just asserted

`runInventoryOpeningChunk()` calls `InventoryOpeningImportService::apply()`, and nothing else. That method's own
body (unchanged, byte-for-byte) calls only `InventoryOpeningService::createDraft()` — never `::post()`. There is
no code path in this PR, anywhere, that can reach `post()`; posting remains reachable only via
`InventoryOpeningController::post()`, the existing separate, human-triggered endpoint. This is structural, not
just tested: the new code has no reference to `InventoryOpeningService::post()` at all.

### Tenant / warehouse / product ownership evidence

- **Product ownership**: `Product::query()` (used by `InventoryOpeningImportService::resolveProduct()`,
  unchanged) is tenant-scoped via `BaseModel`/`TenantScope` automatically — a SKU/barcode/`nebrax_id` from
  another tenant simply doesn't resolve, surfacing as `product_not_found`, never revealing the other tenant's
  data. Proven fresh for the durable path by
  `ImportJobInventoryOpeningApplyTest::a_row_referencing_a_product_from_another_tenant_is_rejected`.
- **Warehouse ownership**: `Warehouse::query()` (used by `resolveWarehouse()`, unchanged) is tenant-scoped the
  same way. Proven by `a_row_referencing_a_warehouse_from_another_tenant_is_rejected`.
- **Job ownership**: inherited `TenantScope` on `ImportJob` itself, zero new code — proven by
  `apply_cannot_be_called_from_another_tenant`.
- **UOM**: does not apply to this domain. `InventoryOpeningFields` has no unit-of-measure field at all —
  `opening_quantity` is a plain base-unit integer with no per-line unit conversion, confirmed by reading
  `app/Support/InventoryOpeningFields.php` in full before writing any code. Nothing was added or assumed here.
- **Branch ownership**: does not apply either. `InventoryOpening` is `CompanyWide` by explicit, documented
  design (a single document can span warehouses from different branches, including the branchless central
  warehouse) — see the model's own docblock and `CLAUDE.md`'s architecture note. Branch attribution lives on the
  *posting* step's stock movements and journal lines (from each line's warehouse), which this PR never reaches.
- **Live re-check, not client-trusted IDs**: `resolveProduct()`/`resolveWarehouse()` run fresh inside
  `InventoryOpeningImportService::parse()`, called fresh on every `apply()` call (not from a cached preview) —
  unchanged behavior, inherited for free by reusing `apply()` as-is.

### Quantity / cost contracts preserved (not re-tested here, wiring only)

Zero lines of `InventoryOpeningImportService`'s parsing/validation logic changed: `parseQuantity()` (positive
integer, range-checked), `parseMoney()` (halalas, no float, two-decimal cap), the zero-cost consent gate, and
the duplicate-row-within-file check are all exactly as they shipped. This PR's own tests
(`an_invalid_quantity_row_fails_the_job_and_creates_no_draft`,
`a_zero_cost_row_is_refused_unless_explicitly_allowed`) prove the durable wiring surfaces these existing
rejections correctly rather than re-implementing or loosening them. The full pre-existing
`InventoryOpeningImportTest` suite (33 tests) and `InventoryOpeningPostingTest` suite (17 tests) pass unmodified.

### Concurrency / idempotency — inherited, not reimplemented

Same `lockForUpdate()`-for-the-whole-chunk mechanism, proven again for this domain:
`ImportJobInventoryOpeningApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` (genuine second
PostgreSQL connection, same `lock_timeout` proof as PR-DUR-2/3). Retry-after-crash and retry-after-completion
proven the same way (interrupt via an `ImportJob::saving` hook mid-transaction; assert no partial draft; assert
a clean resume with no duplicate document).

### Accounting / inventory non-effect (D-08-equivalent for this domain)

`ImportJobInventoryOpeningApplyTest::apply_creates_zero_stock_or_ledger_effect` asserts `StockMovement::count()
=== 0`, `JournalEntry::count() === 0`, `JournalLine::count() === 0`, `ProductWarehouseStock::count() === 0`, and
the product's `quantity_on_hand`/`avg_cost` remain `0` — while the durable-upload test separately confirms the
Draft (with its lines) *is* created, so the non-effect test demonstrates the forbidden effects are absent, not
that nothing happened.

### In scope / out of scope

In scope: `inventory_opening` Draft-only wiring, as above. Out of scope, explicitly not touched: `post()` /
posting workflow (remains a separate, human-triggered endpoint, never reachable from this engine), any frontend
(PR-DUR-5), S3/R2 provisioning, any change to `InventoryOpeningImportService`'s or `InventoryOpeningService`'s
business rules, any change to `product_catalog`/`product_workbook`'s PR-DUR-2/3 behavior.

## 9. PR-DUR-5 — contract (this PR, final)

### Goal

Replace the browser-session-dependent import execution flow with the durable `ImportJob` workflow (PR-DUR-1..4)
across all three wired domains, without a Design System V2 visual redesign and without changing any backend
contract.

### Shared engine, not three bespoke integrations

`web/src/modules/import-jobs/` is new: `client.ts` (typed `POST /import-jobs`, `GET /import-jobs/{id}`, `POST
/import-jobs/{id}/apply`, `POST /import-jobs/{id}/cancel` — mirrors `ImportJobResource`/`ImportJobController`
literally, no invented fields or states), `useImportJobEngine.ts` (the state machine: upload, resume, a chunk-
apply loop driven entirely by the server's `processed_rows`/`row_count`/`status`, cancel), and
`ImportJobStatusPanel.tsx` (one status/progress UI reused by all three pages). All three domain pages consume
this one engine — no per-domain reimplementation of the durable mechanics.

### Old 7-step wizard → final workflow (Product Catalog)

The legacy wizard was `file → mode → mapping → rules → preview → apply → result` (7 screens), with `apply`
owning its own client-computed `batch_offset` loop against the session-only endpoint (re-uploading the file on
every batch).

| Old step | Disposition | Why |
|---|---|---|
| file | **Consolidated** into step 1 ("Setup") | No mutation happens yet — a decision, not a distinct moment. |
| mode | **Consolidated** into step 1 | Same reason; still a pre-commit choice. |
| mapping | **Consolidated** into step 1 | Same reason — shown as a section within Setup, not a separate screen, with all the same columns/samples/target-field controls intact. |
| rules (blank/master-data policy) | **Consolidated** into step 1 | Same reason. |
| preview | **Retained**, as step 2 | A genuinely different moment (validated read, still using the local file and the existing session-only `/products/import/preview` — stateless, no durable job needed yet). |
| apply | **Replaced** with the durable engine, as step 3 | The file is uploaded to a durable `ImportJob` **only at this transition** (the one and only upload); every subsequent chunk call addresses the job id, never the file again. |
| result | **Retained**, as step 4 | Distinct terminal moment. |

Net: **4 steps**, not 7 — three decisions that don't need separate screens were merged into one ("Setup"); the
three genuinely distinct moments (nothing written yet → durable write in progress → done) stayed separate.
Every control the 7-step wizard had is still present; none were dropped to make the flow look shorter.

Inventory Opening's 5-step wizard (`file → mapping → preview → confirm → result`) was consolidated the same way
into 4 (`setup → preview → apply → result`), preserving every field (opening date, notes, allow-zero-cost
switch, mapping table).

Product Workbook has **no prior frontend** — `/products/workbook-import` is a new page, built directly on the
durable engine from day one (no legacy flow to map).

### ImportJob identity and recovery

The job id is written to the page URL (`?job=<id>`) the moment a job exists (upload or resume), via
`useImportJobUrlParam`. On mount, `useResumeFromUrl` reads that param and calls `GET /import-jobs/{id}` — the
**only** source of truth for what the page shows next; no browser-only job state exists anywhere. A page
refresh, tab close/reopen, or back/forward navigation that preserves the URL query string recovers the exact
backend state (`ready`/`processing`/`completed`/`failed`/`cancelled`) with no re-upload.

**One disclosed gap**: if a refresh happens *before* the very first successful `/apply` call (job still
`ready`), the browser has lost the original `File` object and any column-mapping selections (browsers don't
persist `File` handles across reloads, and the durable API's `inspect` step stores only row/column *counts*, not
per-column headers/samples — that richer detail lives only in the session-only `/inspect` endpoints, which need
the file). In that narrow window, the page shows a compact "continuing an existing import" form (domain-specific
required fields only — e.g. `opening_date` for Inventory Opening, `price_list_id` for Workbook) and lets column
mapping fall back to the API's own auto-match-by-header-name default (already the documented default when no
`mapping` is sent) rather than blocking the user. This is a real, disclosed frontend limitation — not a backend
gap — since the durable API never promised to carry column-level inspection detail; extending it to do so would
be a backend contract change, explicitly out of scope for this PR.

### Backend state → frontend state mapping

`ImportJobStatusPanel` renders exactly `ImportJobStatus`'s values (`uploaded`, `ready`, `queued`, `processing`,
`completed`, `failed`, `cancelled`) via one `importJobs` i18n namespace — no invented state names. Actions are
gated by the same sets the backend itself enforces: `APPLICABLE_STATUSES` (`ready`/`processing`/`completed`) for
the apply button, `CANCELLABLE_STATUSES` (`uploaded`/`ready`) for the cancel button — both mirrored client-side
from `App\Support\ImportJobStatus`'s own constants, not invented. A terminal status (`completed`/`failed`/
`cancelled`) always wins: `useImportJobEngine`'s only state update path is "whatever the server just returned,"
so a stale in-flight response can never overwrite a status the server has since moved past — the reducer simply
has no code path that keeps an older client belief once a newer server response has landed via `resume`.

### Progress / resume / duplicate-click protection

- **Product Catalog (chunked)**: `applyLoop` calls `POST /import-jobs/{id}/apply` in a `while(true)` loop,
  reading `processed_rows`/`row_count` from **each response** to decide whether to continue — the browser never
  computes or stores a batch offset. `ImportJobStatusPanel` renders a real progress bar only when
  `row_count > 0` and status is `processing`, sourced from that same server-reported pair.
- **Product Workbook / Inventory Opening (atomic)**: no `batch_offset`/`batch_size` exists in either domain's
  `apply()` contract (PR-DUR-3/4 both record this explicitly) — `ImportJobStatusPanel`'s `atomic` prop suppresses
  the progress bar entirely and shows an honest "processing the whole file as one step" message instead. No
  client-side chunking of an atomic domain was invented.
- **Duplicate-click protection**: `useImportJobEngine` holds an in-memory `inFlight` ref (not React state, so no
  render lag) — a second `upload`/`applyLoop`/`cancel` call while one is already running is a silent no-op until
  the first resolves. Proven in `useImportJobEngine.test.tsx`.
- **Safety cap**: `applyLoop`'s loop carries a hard 5000-iteration ceiling that surfaces an explicit error if a
  response ever fails to advance status/cursor recognizably — defense-in-depth against an unbounded tight loop
  freezing the tab on a malformed or unexpected server response; discovered and hardened while writing this
  PR's own tests (an incomplete test mock reproduced exactly this failure mode).

### Network interruption vs. failure

`applyLoop` distinguishes a thrown `ApiError` (an explicit HTTP rejection — treated as a real, actionable error,
message shown verbatim) from any other thrown error (a network-level failure — fetch never got a response). On
the latter, it sets `networkUncertain` (rendered as a banner, not an error), **re-fetches the job from the
server**, and only then decides: if the re-fetch shows a terminal status, that's shown as-is; otherwise the loop
retries the same job id — safe by construction, since a retry either re-sends an unapplied chunk (nothing
committed, so nothing duplicates) or lands on an already-advanced cursor (backend idempotency, unchanged from
PR-DUR-2). The user is never told "import failed" for a connectivity blip, and is never encouraged to re-upload
a file whose job already exists.

### Product Catalog / Product Workbook / Inventory Opening contracts — preserved, not reinterpreted

- **Product Catalog**: mode/mapping/blank-policy/master-data-policy are unchanged fields sent exactly as before;
  cost-authorization stays a backend decision (`SensitiveCostPolicy`, never evaluated or cached client-side —
  the frontend has no code path that could).
- **Product Workbook**: one `price_list_id` selected before the run (dropdown built from `GET /price-lists`,
  filtered to `is_active` client-side for UX — the backend's own live tenant-ownership + active-state check in
  `ProductWorkbookService::resolveActivePriceList()` remains authoritative and is what actually gates apply);
  no default/base price list concept anywhere in the new code; no per-row price list; explicit Product+UOM
  prices only (the frontend never computes or displays a price derived from a UOM conversion factor — it has no
  pricing logic at all, it only displays sheet-level counts from the backend's own preview/apply responses); the
  atomic behavior is presented honestly (see Progress section above).
- **Inventory Opening**: completion wording (`draft_created`, `draft_next_step`) states explicitly that a
  **draft** was created and that posting is a separate, later, explicit action — unchanged wording from the
  pre-existing page, now sourced from the durable `apply_result` (`{inventory_opening_id, number, ...}`,
  PR-DUR-4's normalized summary) instead of the session-only endpoint's response shape. **No code path in the
  new page calls `POST /inventory-openings/{id}/post`** — confirmed by grep and by
  `page.test.tsx`'s explicit assertion that no `/post`-containing path is ever called during the import flow.

### Mobile / RTL / LTR

All three pages reuse the existing responsive/logical-CSS conventions already established in the codebase
(`text-start`, `ms-auto`, `dir="ltr"` only on inherently-LTR content like filenames/ids, the existing mobile
card-vs-table pattern for the preview tables, the fixed bottom action bar on narrow viewports) — no new layout
system, no hardcoded `left`/`right`. `useTranslations`/`useLocale` from `next-intl` are used exactly as the
pre-existing pages used them; both `ar.json` and `en.json` got the same new keys. This PR did not introduce any
automated viewport or locale-rendering test harness beyond what the codebase already has (none of the pre-
existing import pages had one either) — RTL/LTR and mobile-width correctness were verified by re-using the same
CSS conventions the rest of the app already relies on, not by new automated visual assertions. This is disclosed
as a testing-scope limitation in the Implementation Report, not claimed as automated coverage that doesn't
exist.

### In scope / out of scope

In scope: the frontend wiring above for all three durable domains, the shared engine, updated tests, i18n keys.
Out of scope, explicitly not touched: any backend endpoint/schema (zero backend files changed in this PR), the
posting workflow, S3/R2 provisioning, Design System V2, a broad visual redesign, PR-DUR-1..4's own behavior.
