# PR-DUR-3 — Implementation Report

**Durable Imports: wire Product Workbook (Products/Barcodes/Unit Prices) into the same engine**

## 1. What changed

`ImportJobService` now dispatches its existing `applyNextChunk()` engine to a `product_workbook` branch in
addition to PR-DUR-2's `product_catalog` branch, reusing `ProductWorkbookService::apply()` — **unchanged, zero
lines added to that class's business logic** — as the sole mutation boundary. No new mutation path was invented.

The one real design decision this PR had to make (and is recording explicitly, not hiding): unlike
`ProductImportService::apply()`, **`ProductWorkbookService::apply()` has no `batch_offset`/`batch_size` contract
at all** — it validates and writes its three sheets (Products → Barcodes → Unit Prices, in that order, inside
one transaction) as one atomic unit, by design (a new SKU from the same file's Products sheet must be visible to
Barcodes/Unit Prices rows after it, within the same transaction). Slicing this into row-level chunks would
require either rewriting that ordering/validation (a redesign of the approved PR-UOM2-4 contract — out of scope)
or building a second, duplicate write path (explicitly forbidden). **Resolution:** the workbook is one
non-divisible chunk — a single `POST /import-jobs/{id}/apply` call processes the entire remaining file, inside
the exact same PR-DUR-2 lock/transaction/state-machine scaffolding. Every concurrency, resume-after-crash, and
retry-after-completion guarantee from PR-DUR-2 is fully preserved; only "spread across several HTTP calls" does
not apply, because the underlying service has no smaller safe unit to offer. Full reasoning in
`DURABLE-IMPORTS-DECOMPOSITION.md` §7.

## 2. Call flow: before vs. after

**Before (session-only, still fully intact and untouched):**
```
POST /products/workbook/apply  (file + price_list_id + options, every call re-uploads the file)
  → ProductWorkbookController::apply()
  → ProductWorkbookController::resolvePriceList()  (abort(422) inline)
  → ProductWorkbookService::apply()
```

**After (new, additive, parallel path):**
```
POST /import-jobs                         (file + domain=product_workbook, uploaded once)
  → ImportJobService::create() → inspect() → inspectCounts() [product_workbook branch]
  → status: ready, row_count = non-blank rows summed across the 3 sheets present

POST /import-jobs/{id}/apply              (price_list_id + options, no file — repeatable/pollable)
  → ImportJobController::apply()
  → ImportJobService::applyNextChunk()
      lockForUpdate() the ImportJob row for the whole call
      → runChunk() → runProductWorkbookChunk()
          → ProductWorkbookService::resolveActivePriceList()   (same rule as the controller, shared now)
          → ProductWorkbookService::apply()                    (unchanged)
      → status: completed | failed
```

`/products/workbook/*` is completely untouched and still works exactly as before — this is an additive parallel
path, not a replacement, per the decomposition doc's own invariant.

## 3. Files changed

| File | Change |
|---|---|
| `app/Support/ImportJobDomain.php` | Added `PRODUCT_WORKBOOK = 'product_workbook'`. |
| `app/Services/ImportJobService.php` | New `inspectCounts()` (domain-aware row/column counting), `runChunk()`/`runProductCatalogChunk()`/`runProductWorkbookChunk()` (extracted dispatch, `product_catalog` behavior byte-identical to PR-DUR-2), `assertApplicable()` now accepts both domains. |
| `app/Services/ProductWorkbookService.php` | New `resolveActivePriceList(?string): PriceList` — extracted from the controller, same two messages, same rule (tenant-scoped `PriceList::query()`, `is_active` check). |
| `app/Http/Controllers/Api/ProductWorkbookController.php` | `resolvePriceList()` now delegates to the service method (catches `RuntimeException`, calls `abort(422,...)`) — behavior byte-identical, confirmed by the full unmodified `ProductWorkbookTest` suite. |
| `app/Http/Requests/ApplyImportJobRequest.php` | Added `price_list_id` (`sometimes|nullable|uuid`) — structural only; business validation stays in the service. |
| `app/Http/Requests/StoreImportJobRequest.php` | File rule gained a closure narrowing to `xlsx` when `domain === product_workbook`; `product_catalog` unaffected. |
| `tests/Feature/ImportJobWorkbookApplyTest.php` | **New.** 12 tests — see §6. |
| `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` | §7 added: full PR-DUR-3 contract, PR sequence table statuses updated (PR-DUR-1/2 now "merged"). |

No file outside this list was touched. `ProductWorkbookService::apply()`/`preview()`/`inspect()`/
`parseBarcodesSheet()`/`parseUnitPricesSheet()`/`resolveBarcodeUnit()`, `ProductImportService`, and
`ProductLifecycleService` are byte-for-byte unchanged. `ProductWorkbookTest` (30 tests) required zero edits.

## 4. Schema / migrations / API

**Schema:** none. PR-DUR-2's `apply_options`/`apply_result` JSON columns already hold whatever a domain's chunk
needs — `price_list_id` for `product_workbook`, and its `{products, barcodes, unit_prices}` result shape.

**API:** no new endpoint. `POST /import-jobs/{id}/apply` (PR-DUR-2) now also accepts `product_workbook` jobs,
with an additional optional `price_list_id` field in the request body (required in effect for that domain — a
missing/invalid one fails closed via `resolveActivePriceList()`, same as the existing controller). Response
shape unchanged (`ImportJobResource`).

## 5. PriceList / UOM / barcode contract — how it was preserved

- **D-F unchanged:** no default/base PriceList exists anywhere in the new code; no per-row `price_list_id`. One
  `price_list_id` is supplied on the (only) `/apply` call, frozen into `apply_options`, and re-validated live —
  tenant ownership (via `PriceList::query()`'s automatic `TenantScope`) and `is_active` — on every call via the
  same `resolveActivePriceList()` the pre-existing controller uses.
- **UOM/barcode/pricing rules:** zero lines of `ProductWorkbookService`'s business logic changed.
  `parseBarcodesSheet()`, `parseUnitPricesSheet()`, `resolveBarcodeUnit()`, and the atomic three-sheet
  `apply()` transaction are exactly as PR-UOM2-4 shipped them. Unit prices remain explicit-only — this PR does
  not introduce, and could not introduce, any derivation from a UOM conversion factor, because it never touches
  price computation at all.
- **Product Lifecycle / cost authorization:** `SensitiveCostPolicy::authorized($request->user())` is still
  passed through live into `ProductWorkbookService::apply()` on every call — not cached, not weakened.
- **Evidence, not assertion:** the entire pre-existing `ProductWorkbookTest` suite (30 tests covering barcode
  round-trips, unit-price validation, cross-tenant/inactive PriceList rejection, workbook structural rules)
  passes unmodified on both engines — see §6.

## 6. Tests and results

New file `tests/Feature/ImportJobWorkbookApplyTest.php`, 12 tests. Barcode/Unit-Price rows target a
**pre-existing** product (created via the API before the workbook is built) — matching the exact convention
every barcode/unit-price test in `ProductWorkbookTest` already uses, because `ProductWorkbookService::apply()`
validates Barcodes/Unit Prices against the database *before* the Products sheet in the same file would create a
brand-new SKU (a real, pre-existing characteristic of that service, not something this PR changed or needed to
change).

| Test | Proves |
|---|---|
| `durable_upload_inspect_and_apply_creates_the_barcode_and_unit_price` | Full durable path: upload once → `ready` with correct `row_count` → one `/apply` call → `completed` → barcode + price list item created. |
| `apply_is_refused_without_a_selected_price_list` | D-F: no price list supplied → 422, job `failed`, nothing written. |
| `apply_rejects_a_price_list_from_another_tenant` | Cross-tenant PriceList id → not found (tenant-scoped query) → 422, nothing written. |
| `apply_rejects_an_inactive_price_list` | Inactive PriceList → 422, nothing written. |
| `apply_cannot_be_called_from_another_tenant` | Cross-tenant job access → 404 (inherited `TenantScope`, no new code). |
| `a_csv_upload_is_rejected_for_the_workbook_domain` | `StoreImportJobRequest`'s new domain-conditional extension check fails closed on CSV for `product_workbook`. |
| `blank_rows_across_the_sheets_are_not_counted_or_applied` | Blank rows in Products/Barcodes/Unit Prices sheets excluded from `row_count`, and don't produce spurious writes. |
| `a_single_apply_call_completes_the_whole_workbook_with_no_partial_progress` | Documents the atomic-chunk resolution: `batch_size` is accepted but has no effect — one call always completes or fails the whole job. |
| `an_interrupted_apply_leaves_no_partial_state_and_a_retry_completes_cleanly` | A crash simulated mid-transaction (via an `ImportJob::saving` hook) leaves the job `ready`/`processed_rows=0`/no writes; a retry then completes cleanly with no duplicate. |
| `retrying_a_completed_workbook_job_is_idempotent` | Second `/apply` on a `completed` job returns the cached state; no duplicate barcode/price. |
| `a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` | **PostgreSQL only**, genuine second connection, same `lock_timeout` proof technique as PR-DUR-2 — not inferred from SQLite. |
| `completed_workbook_apply_creates_zero_stock_or_ledger_effect` | `StockMovement`/`JournalEntry`/`JournalLine` all `0`, product's `quantity_on_hand`/`avg_cost` still `0` — **while** confirming the barcode and price list item (genuine expected outputs) *are* present, so the test proves the forbidden effects are absent, not that nothing happened. |

### Results

**PostgreSQL 16:**
- `ImportJobWorkbookApplyTest`: **12/12 passed**, 104 assertions.
- Combined focused regression (`ProductWorkbookTest`, `ImportJobTest`, `ImportJobApplyTest`,
  `ImportJobWorkbookApplyTest`, `ProductImportTest`, `ProductImportV2Test`, `InventoryOpeningImport*`):
  **145/145 passed**, 881 assertions — `ProductWorkbookTest`'s all 30 pre-existing tests included, unmodified.
- **Full suite**: 3188 passed, 26 failed, 20762 assertions, 616.47s. All 26 failures are the same pre-existing,
  unrelated `bcmath`-missing Fuel-domain failures disclosed in the PR-DUR-1 and PR-DUR-2 reports (confirmed
  identical test names) — zero relation to this PR's diff.

**SQLite:**
- Combined focused regression: **142 passed, 3 skipped** (the PostgreSQL-only lock tests, correctly skipped with
  reason), 868 assertions.
- **Full suite**: 3170 passed, 26 failed (identical set — confirmed by grepping for any non-Fuel failure and
  finding none), 18 skipped, 20680 assertions, 253.42s.

CI (`shivammathur/setup-php@v2` installs `bcmath`) is expected to show 0 Fuel-domain failures, matching PR-DUR-1
and PR-DUR-2's precedent.

## 7. CI

Reported once available — see §10 for Base/Head SHA and PR link.

## 8. Tenant / security evidence

- **Tenant isolation:** `apply_cannot_be_called_from_another_tenant` (job access, inherited `TenantScope`,
  zero new code) and `apply_rejects_a_price_list_from_another_tenant` (PriceList lookup, same inherited scoping
  via `PriceList::query()`).
- **Authorization:** unchanged — `products.manage` gates `/import-jobs/{id}/apply` regardless of domain (PR-DUR-2
  wiring, not touched). `SensitiveCostPolicy::authorized()` re-checked live on every call.
- **Fail-closed:** missing/foreign/inactive PriceList, wrong file type for the domain, wrong tenant — all
  rejected before any write, each with a dedicated test.
- **Concurrency:** proven on PostgreSQL with a genuine second connection, not inferred from SQLite.

## 9. Accounting / inventory non-effect evidence (D-08 unchanged)

`completed_workbook_apply_creates_zero_stock_or_ledger_effect` explicitly asserts `StockMovement::count() === 0`,
`JournalEntry::count() === 0`, `JournalLine::count() === 0`, and the product's `quantity_on_hand`/`avg_cost`
remain `0` — while also asserting the workbook's genuine expected outputs (`ProductBarcode`, `PriceListItem`)
are non-zero, so the test demonstrates the *forbidden* effects are absent, not that the whole operation was a
no-op.

## 10. Risks / remaining work / deviations

- **Deviation (recorded, not silent):** the workbook cannot be chunked below "the whole file" — see §1 and
  `DURABLE-IMPORTS-DECOMPOSITION.md` §7 for the full reasoning. This is a property of the existing, approved
  `ProductWorkbookService::apply()` contract, not a limitation introduced by this PR, and not something this PR
  is authorized to fix (that would mean redesigning PR-UOM2-4's atomic three-sheet write, explicitly out of
  scope).
- **Inherited, pre-existing, out of scope:** `ProductWorkbookService::apply()`'s Barcodes/Unit-Prices validation
  runs against the database *before* the Products sheet in the same file would create a new SKU — so a workbook
  cannot introduce a brand-new product and reference it from Barcodes/Unit Prices in the same file (this already
  existed before PR-DUR-3 and every existing `ProductWorkbookTest` test already works around it by using a
  pre-existing product; this PR's own tests do the same, and did not attempt to fix or work around this
  pre-existing characteristic).
- **No frontend:** `/import-jobs/{id}/apply` for `product_workbook` has no UI caller yet — PR-DUR-5's subject.
- **Inventory Opening (PR-DUR-4)** still not wired — untouched by this PR.

## 11. Branch / PR / SHAs / next step

- **Branch:** `claude/pr-dur-3-workbook-durable`
- **Base SHA:** `d6dcd17` (`main`, includes merged PR-DUR-1 and PR-DUR-2)
- **Head SHA:** reported with the PR
- **PR:** opened as a dedicated PR, separate from #746/#753/#754.
- **Next step:** monitor CI on this PR; report CI status. No merge, no deploy, no PR-DUR-4 — per the approved
  scope.

## Accounting entries produced by this PR

**None.** `ImportJobService::runProductWorkbookChunk()` calls `ProductWorkbookService::apply()` unchanged, which
itself never calls `LedgerService::post()`. No new debit/credit pair exists anywhere in this diff.
