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
| **PR-DUR-1** | Durable import job/file infrastructure (foundation) | 1 new table | — | **this PR** |
| **PR-DUR-2** | Chunked/resumable apply engine, wired to Product Catalog import only | job columns only (no new table) | PR-DUR-1 | not started |
| **PR-DUR-3** | Wire Product Workbook (3-sheet) apply through the same engine | none | PR-DUR-1, PR-DUR-2 | not started |
| **PR-DUR-4** | Wire Inventory Opening import through the same engine (Draft-only) | none | PR-DUR-1, PR-DUR-2 | not started |
| **PR-DUR-5** | Frontend: durable import UI (upload-once, poll, cancel, result download) | none | PR-DUR-2..4 | not started |

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
| D-I | Storage backend | **Local private disk**, mirroring `DocumentStorageService`'s existing `persistent_enabled=false → local` default posture (`document_center.php`) rather than coupling to that service directly — Durable Imports is a distinct domain per `DURABLE-IMPORTS.md`'s explicit domain-separation rule, so it gets its own small, independent storage helper instead of borrowing Document Center's S3/R2-capable one. Promoting to S3/R2 later is a config change, matching `CLAUDE.md`'s "Storage: S3/R2" stack note for the platform generally — not blocking, not decided against, simply not this PR's contract. |
| D-J | Job-creation idempotency mechanism | **Client-supplied `idempotency_key`, unique per `(tenant_id, idempotency_key)`.** A network retry of the same `POST /import-jobs` returns the existing job (200) instead of creating a duplicate row. This is upload-idempotency only; row-level/apply-level duplicate-write prevention against Products/barcodes/opening lines is PR-DUR-2's contract (reusing `ProductImportService`'s existing match-by-`nebrax_id`-then-`sku` semantics, unchanged). |

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
- `App\Services\ImportJobFileStorage` — private local-disk storage keyed by `imports/{tenant_id}/{job_id}/…`,
  sha-256 fingerprint computed on upload, delete-on-cancel.
- `App\Services\ImportJobService` — `create()` (store file, fingerprint, idempotency check, row), `inspect()`
  (reuses `SpreadsheetReader::read()` and the existing `MAX_ROWS`/`MAX_COLUMNS` ceilings — **the exact same
  constants `ProductImportService` already enforces**, not a second copy), `cancel()`.
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
- S3/R2 storage — local disk only, per D-I.
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
| Duplicate `POST` with an already-used `idempotency_key` for the same tenant | 200, returns the existing job unchanged — no second file stored, no second row created |
| `idempotency_key` reused for a *different* tenant | no collision — uniqueness is `(tenant_id, idempotency_key)`, never global |
| `cancel` on a job already `cancelled`/`failed` | 422 — cancellation is only valid from `uploaded`/`ready` |
| `cancel` on another tenant's job id | 404 |
| Cross-tenant `GET /import-jobs/{id}` | 404 |

### Acceptance criteria

1. Uploading a valid CSV/XLSX creates exactly one `import_jobs` row, stores the file once, computes a sha-256
   fingerprint, and reaches `ready` with header/row-count metadata populated — without calling
   `ProductImportService` at all.
2. A file that fails `MAX_ROWS`/`MAX_COLUMNS` reaches `failed` with a durable, queryable error — the file is
   deleted from storage, the job row is kept (auditable).
3. Re-submitting the same `idempotency_key` for the same tenant never creates a second job or a second stored
   file; a different tenant using the identical key is unaffected.
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

- **PR-DUR-2** wires chunked, queue-dispatched `apply` to **Product Catalog import only**, reusing
  `ProductImportService`'s existing row-validation/matching/payload-building logic (parse stays pure, per
  `CLAUDE.md`'s own note that `ProductImportService::parse` is already written to not need rewriting for this).
  New endpoints only (`/import-jobs/{id}/apply` or similar) — `/products/import/apply` is untouched.
- **PR-DUR-3** wires `ProductWorkbookService` the same way, reusing PR-DUR-2's engine — no second chunking
  implementation.
- **PR-DUR-4** wires `InventoryOpeningImportService` the same way, with the explicit constraint from
  `DURABLE-IMPORTS.md`: *"Large-file job may create/validate Draft data, but never auto-post."* Posting
  idempotency stays owned by `InventoryOpeningService`, never the import worker.
- **PR-DUR-5** is the only frontend PR in this sequence — upload-once UX, status polling, cancel button, result
  download — consuming PR-DUR-1..4's endpoints without inventing new backend contract.

No PR beyond PR-DUR-1 is authorized to start by this document. Each requires its own contract, written against
`main` at that time, before implementation begins.
