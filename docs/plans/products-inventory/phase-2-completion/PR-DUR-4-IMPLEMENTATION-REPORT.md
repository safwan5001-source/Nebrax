# PR-DUR-4 — Implementation Report

**Durable Imports: wire Inventory Opening into the same engine — Draft-only**

## 1. What changed

`ImportJobService` now dispatches its existing `applyNextChunk()` engine to an `inventory_opening` branch,
reusing `InventoryOpeningImportService::apply()` — **unchanged, zero lines added to that class** — as the sole
mutation boundary. `apply()` here calls only `InventoryOpeningService::createDraft()`; the separate posting
step (`InventoryOpeningService::post()` — stock movements, average cost, one journal entry) is not referenced
anywhere in this diff and remains reachable only through its existing, separate, human-triggered endpoint.

Same design fork PR-DUR-3 already resolved for Product Workbook: `InventoryOpeningImportService::apply()` has no
`batch_offset`/`batch_size` contract — it parses the whole file and creates exactly one `InventoryOpening`
document (one number, totals from all its lines) inside one transaction. Slicing this into row-level chunks
would mean either producing multiple documents from one file (breaking "one document per file") or rewriting
`createDraft()`'s contract — both out of scope. The file is therefore one non-divisible chunk, driven through
the identical PR-DUR-2/3 lock/transaction/state-machine scaffolding. No new chunking mechanism was invented.

## 2. Call flow: before vs. after

**Before (session-only, untouched):**
```
POST /inventory-openings/import/apply  (file + opening_date + options, re-uploaded every call)
  → InventoryOpeningController::apply()
  → InventoryOpeningImportService::apply()
  → InventoryOpeningService::createDraft()
```

**After (new, additive, parallel path):**
```
POST /import-jobs                          (file + domain=inventory_opening, uploaded once)
  → ImportJobService::create() → inspect() → inspectCounts() [generic single-sheet branch, unchanged]
  → status: ready, row_count = non-blank data rows

POST /import-jobs/{id}/apply               (opening_date + options, no file)
  → ImportJobController::apply()
  → ImportJobService::applyNextChunk()
      lockForUpdate() the ImportJob row for the whole call
      → runChunk() → runInventoryOpeningChunk()
          → InventoryOpeningImportService::apply()   (unchanged — createDraft() only, never post())
      → status: completed | failed
```

`/inventory-openings/import/*` and `/inventory-openings/{id}/post` are completely untouched.

## 3. Files changed

| File | Change |
|---|---|
| `app/Support/ImportJobDomain.php` | Added `INVENTORY_OPENING = 'inventory_opening'`. |
| `app/Services/ImportJobService.php` | New `runInventoryOpeningChunk()`; `runChunk()` and `assertApplicable()` extended to the new domain. `inspectCounts()` needed **no change** — the domain falls into the existing generic single-sheet branch. |
| `app/Http/Requests/ApplyImportJobRequest.php` | Added `opening_date`/`allow_zero_cost`/`notes` (structural only); widened `mapping.*`'s accepted vocabulary to the union of `ProductImportFields` and `InventoryOpeningFields` keys. |
| `tests/Feature/ImportJobInventoryOpeningApplyTest.php` | **New.** 12 tests — see §7. |
| `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` | §8 added: full PR-DUR-4 contract; PR sequence table updated (PR-DUR-3 now "merged"). |

No file outside this list was touched. `InventoryOpeningImportService`, `InventoryOpeningService` (including
`post()`), `InventoryOpeningController`, and every existing Inventory Opening route/request are byte-for-byte
unchanged. `InventoryOpeningImportTest` (33 tests) and `InventoryOpeningPostingTest` (17 tests) required zero
edits.

## 4. Is Inventory Opening atomic or chunked, and why

**Atomic — one non-divisible chunk**, for the same structural reason as PR-DUR-3's Product Workbook:
`InventoryOpeningImportService::apply()` has no batching parameters at all. It always parses every row of the
file and creates exactly one `InventoryOpening` document from all of them together in a single
`InventoryOpeningService::createDraft()` call — one document number, one set of totals reconciled against every
line. There is no smaller safe unit of work this PR could dispatch without either rewriting that contract (out
of scope) or producing multiple documents from a single uploaded file (a real behavior change, not authorized).
`ImportJobService::runInventoryOpeningChunk()` therefore reports `processed_in_chunk = row_count` unconditionally
— the first (only) `/apply` call always completes or fails the whole job, exactly mirroring
`runProductWorkbookChunk()`'s already-established pattern.

## 5. Draft-only invariant

Enforced structurally, not just by convention: `runInventoryOpeningChunk()` calls
`InventoryOpeningImportService::apply()` and nothing else; that method's own unmodified body calls only
`InventoryOpeningService::createDraft()`. No code added in this PR references `InventoryOpeningService::post()`
anywhere. Posting remains reachable exclusively through the existing, separate `POST
/inventory-openings/{id}/post` endpoint — a human decision after reviewing the draft, exactly as before.

## 6. Proof of zero stock/accounting effect

`ImportJobInventoryOpeningApplyTest::apply_creates_zero_stock_or_ledger_effect` asserts, after a completed
durable apply: `StockMovement::count() === 0`, `JournalEntry::count() === 0`, `JournalLine::count() === 0`,
`ProductWarehouseStock::count() === 0`, and the referenced product's `quantity_on_hand`/`avg_cost` remain `0`.
The companion `durable_upload_inspect_and_apply_creates_a_draft_only` test confirms the *positive* side: a
`InventoryOpening` with `status === 'draft'`, its line(s) created, and both `posted_at` and `journal_entry_id`
null — so the non-effect test demonstrates the forbidden effects are specifically absent, not that the whole
operation was a no-op.

## 7. Tenant / branch / UOM ownership evidence

- **Product ownership**: `Product::query()` (tenant-scoped via `BaseModel`/`TenantScope`, unchanged) — a
  cross-tenant SKU/barcode/`nebrax_id` doesn't resolve and surfaces as `product_not_found`, never revealing the
  other tenant's product. Proven fresh for the durable path by
  `a_row_referencing_a_product_from_another_tenant_is_rejected`.
- **Warehouse ownership**: same tenant-scoping via `Warehouse::query()`, proven by
  `a_row_referencing_a_warehouse_from_another_tenant_is_rejected`.
- **Job ownership**: inherited `TenantScope` on `ImportJob`, proven by `apply_cannot_be_called_from_another_tenant`.
- **UOM**: does not apply — confirmed by reading `InventoryOpeningFields` in full before writing any code. There
  is no unit-of-measure field in this contract; `opening_quantity` is a plain base-unit integer with no
  conversion. Nothing invented here.
- **Branch ownership**: does not apply either — `InventoryOpening` is `CompanyWide` by explicit, pre-existing
  design (one document can span warehouses across multiple branches, including the branchless central
  warehouse); branch attribution lives entirely on the separate *posting* step this PR never reaches.
- **Live re-check**: `resolveProduct()`/`resolveWarehouse()` run fresh inside `parse()` on every `apply()` call
  (not from a cached preview) — inherited unchanged from the reused service.

## 8. Schema / API

**Schema**: none. `apply_options`/`apply_result` (existing generic JSON columns) hold `opening_date`/
`allow_zero_cost`/`notes` and the normalized `{inventory_opening_id, number, status, total_quantity,
total_value, lines_count}` result — `InventoryOpeningImportService::apply()` is the only reused `apply()` across
all three domains that returns a model instead of an array, so this is the one place a small normalization step
was needed before storing the result as JSON.

**API**: no new endpoint. `POST /import-jobs` accepts `domain=inventory_opening` (same `csv|txt|xlsx` set as
`product_catalog` — no narrowing needed). `POST /import-jobs/{id}/apply` accepts `opening_date`/
`allow_zero_cost`/`notes` for this domain. No existing endpoint's request/response contract changed;
`/inventory-openings/*` untouched.

## 9. Tests and results

New file `tests/Feature/ImportJobInventoryOpeningApplyTest.php`, 12 tests:

| Test | Proves |
|---|---|
| `durable_upload_inspect_and_apply_creates_a_draft_only` | Full durable path completes with `status: draft`, lines present, `posted_at`/`journal_entry_id` both null. |
| `apply_creates_zero_stock_or_ledger_effect` | `StockMovement`/`JournalEntry`/`JournalLine`/`ProductWarehouseStock` all `0`; product's `quantity_on_hand`/`avg_cost` still `0`. |
| `apply_is_refused_without_an_opening_date` | Business-required field enforced by the service, not the FormRequest → 422, job `failed`, no draft. |
| `a_row_referencing_a_product_from_another_tenant_is_rejected` | Cross-tenant SKU fails closed (fixture uses distinct per-tenant SKUs to genuinely test cross-tenant lookup, not accidental self-match). |
| `a_row_referencing_a_warehouse_from_another_tenant_is_rejected` | Same, for warehouse code. |
| `apply_cannot_be_called_from_another_tenant` | Cross-tenant job access → 404. |
| `blank_rows_are_not_counted_or_applied` | Blank rows excluded from `row_count` and from the created draft's lines. |
| `an_invalid_quantity_row_fails_the_job_and_creates_no_draft` | Existing quantity validation surfaces correctly through the durable path. |
| `a_zero_cost_row_is_refused_unless_explicitly_allowed` | Existing zero-cost consent gate preserved; `allow_zero_cost: true` (frozen on first call) permits it. |
| `an_interrupted_apply_leaves_no_partial_draft_and_a_retry_completes_cleanly` | A crash simulated mid-transaction leaves the job `ready`/`processed_rows=0`/no draft; a retry then completes cleanly with no duplicate. |
| `retrying_a_completed_job_is_idempotent_and_creates_no_second_draft` | Second `/apply` on a `completed` job returns the cached state; no duplicate document. |
| `a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` | **PostgreSQL only**, genuine second connection, same `lock_timeout` proof technique as PR-DUR-2/3. |

### Results

**PostgreSQL 16:**
- `ImportJobInventoryOpeningApplyTest`: **12/12 passed**, 92 assertions.
- Combined focused regression (`InventoryOpeningImportTest`, `InventoryOpeningPostingTest`, `ImportJobTest`,
  `ImportJobApplyTest`, `ImportJobWorkbookApplyTest`, `ImportJobInventoryOpeningApplyTest`, `ProductImportTest`,
  `ProductImportV2Test`, `ProductWorkbookTest`): **174/174 passed**, 1072 assertions — the full pre-existing
  Inventory Opening suites (50 tests) included, unmodified.
- **Full suite**: 3200 passed, 26 failed, 20854 assertions, 630.12s. All 26 failures are the same pre-existing,
  unrelated `bcmath`-missing Fuel-domain failures disclosed in the PR-DUR-1/2/3 reports — zero relation to this
  PR's diff.

**SQLite:**
- Combined focused regression: **170 passed, 4 skipped** (the PostgreSQL-only lock tests across all three
  domain suites, correctly skipped with reason), 1055 assertions.
- **Full suite**: 3181 passed, 26 failed (identical set, confirmed via grep), 19 skipped, 20768 assertions,
  258.92s.

CI (`shivammathur/setup-php@v2` installs `bcmath`) is expected to show 0 Fuel-domain failures, matching PR-DUR-1,
2, and 3's precedent.

## 10. CI

Reported once available — see §12 for Base/Head SHA and PR link.

## 11. Risks / remaining work / deviations

- **Deviation (recorded, not silent):** identical in shape to PR-DUR-3's — Inventory Opening cannot be chunked
  below "the whole file," for the same structural reason (one document, one number, atomic totals). This is a
  property of the existing, approved `InventoryOpeningImportService::apply()`/`createDraft()` contract, not a
  limitation introduced here, and not something this PR is authorized to change.
  - No ambiguity was found in the meaning of `opening_quantity`/`unit_cost`/valuation — the existing contract
    was read in full and reused exactly as-is; nothing new was decided or invented about accounting semantics.
- **No frontend:** `/import-jobs/{id}/apply` for `inventory_opening` has no UI caller yet — PR-DUR-5's subject.
- **Posting still fully separate:** as required. `InventoryOpeningService::post()` is not wired to this engine
  and this PR does not propose that it should be.

## 12. Branch / PR / SHAs / next step

- **Branch:** `claude/pr-dur-4-inventory-opening-durable`
- **Base SHA:** `9e8ed1a` (`main`, includes merged PR-DUR-1/2/3)
- **Head SHA:** reported with the PR
- **PR:** opened as a dedicated PR, separate from #746/#753/#754/#755.
- **Next step:** monitor CI on this PR; report CI status. No merge, no deploy, no PR-DUR-5 — per the approved
  scope.

## Accounting entries produced by this PR

**None.** `ImportJobService::runInventoryOpeningChunk()` calls `InventoryOpeningImportService::apply()`
unchanged, which calls only `InventoryOpeningService::createDraft()` — never `post()`, never
`LedgerService::post()`. No new debit/credit pair exists anywhere in this diff.
