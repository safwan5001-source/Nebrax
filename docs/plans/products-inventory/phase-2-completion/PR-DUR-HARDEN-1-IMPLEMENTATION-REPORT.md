# PR-DUR-HARDEN-1 — Implementation Report

Large Import Limits + Mobile Functional Hardening (post-Durable-Imports)

## 1. PR number / URL / Branch / SHAs

- **Branch:** `claude/pr-dur-harden-1`
- **Base SHA:** `64402d2b0dc33dc6615d98583e900387a2683e0d` (`main`, PR-DUR-5 #758 merged)
- **Head SHA:** `25a39810ada6aa362c202ad9bbc18071ccf3e6f1` (code-relevant; a trailing docs-only commit may follow to record CI results).
- **PR:** opened as a dedicated PR after PR-DUR-5 #758 (Durable Imports sequence).

## 2. Exact cause of the old 2,000-row limit

`ProductImportService::MAX_ROWS = 2000`, with its own documented rationale (still present in code): production
runs with `QUEUE_CONNECTION=sync` (no real background worker), so a fully-synchronous `apply()` call (no
`batch_offset`/`batch_size`) must validate **and write** the entire file in one HTTP request/transaction. That
constraint is genuine and unrelated to file-reading cost — it is about the write step completing before the
request times out. `ImportJobService` (the durable, chunked engine introduced in PR-DUR-2) previously **aliased**
this same constant (`private const MAX_ROWS = ProductImportService::MAX_ROWS;`) for all three domains — meaning
the durable engine inherited a ceiling justified by a write-shape (one-shot, unchunked) it does not actually have
(durable apply always writes only `APPLY_BATCH_SIZE = 100` rows per request, regardless of total file size).
`ProductWorkbookService::MAX_ROWS` was similarly aliased. This was the real, confirmed bug — not stale frontend
copy (the frontend's `MAX_IMPORT_ROWS = 2000` constant was an accurate reflection of a real, current backend
constant, not leftover text).

## 3. Lifecycle analysis (upload → inspect → preview → apply → completion)

See `DURABLE-IMPORTS-DECOMPOSITION.md` §10 for the full stage-by-stage table (memory/parsed-in-full/one-request/
timeout-risk/memory-risk/row-cap/byte-cap per stage) and the exact measurement scripts' numbers. Summary:

| Stage | Real constraint found |
|---|---|
| Upload | File bytes only (5 MB, unchanged) — never a row-count issue. |
| `inspect()` (durable) | None found — cheap (headers + counts, zero DB queries). Safe at 20,000+ rows, measured. |
| `preview()` (session-only, pre-commit UI) | **Real N+1**: up to 2 live DB queries per row (`matchExisting`/`assertLiveConflicts`), unconditionally, for the whole file. This — not the file read — was the genuine reason a low cap was still needed here. |
| `apply()` legacy one-shot (no `ImportJob`) | Real: writes the whole file in one transaction/request. Cap stays. |
| `apply()` durable chunk | None found for the DB-touching work (bounded to 100 rows/request regardless of file size) — but the **file read itself is redone on every chunk** (see §Known limitations), so per-chunk cost still scales with total file size, just safely (measured up to 20,000 rows). |

## 4. Memory / request-time analysis (measured, not assumed)

Local benchmark scripts (PHP 8.4, `SpreadsheetReader::read()` and the real `ProductImportService::preview()`/
`apply()` against a real (rolled-back) tenant/DB — not synthetic estimates):

| Scenario | Rows | Time | Peak memory | Notes |
|---|---|---|---|---|
| Realistic 5 MB CSV, full read | ~18,800 | ~300 ms | ~24 MB | 15 columns, Arabic text — the byte cap already bounds this to well under the old row cap for typical files. |
| Worst-case thin-row 5 MB CSV, full read | ~281,800 | ~1.3 s | ~98 MB | 3 required columns only — the pathological case a row cap must still guard against independent of bytes. |
| `preview()`, create mode, full pipeline | 5,000 | ~200 ms | ~40 MB | |
| `preview()`, create mode, full pipeline | 20,000 | ~750 ms | ~84 MB | At the new `DURABLE_MAX_ROWS` ceiling. |
| `preview()`, **update** mode vs. 5,000 pre-existing products | 5,000 | ~464 ms | ~70 MB | Heaviest realistic case — **13 total DB queries** after the batching fix (was ~10,000 before, 2/row). |
| Durable chunked apply, cumulative re-read overhead across a full 20,000-row import | 20,000 | ~44 s cumulative (across ~200 requests, ~220 ms each) | n/a | Each individual request stays fast; the aggregate is wasteful but not unsafe — documented as a known limitation, not hidden. |

## 5. Old limit vs. final limit / architecture

- **Legacy synchronous path**: unchanged, `MAX_ROWS = 2000` — genuinely still necessary (one-shot write).
- **Durable path** (`inspect()`/`preview()` with `for_durable=true`, and the durable chunked `apply()` engine):
  new `ProductImportService::DURABLE_MAX_ROWS = 20000` — ten times higher, backed by the measurements above, not
  an arbitrary round number. Enabled by fixing the N+1 query pattern (§7); still bounded by the un-redesigned
  re-read-per-chunk file access pattern (§15).
- **Product Workbook / Inventory Opening**: unchanged, `2000` each — both atomic (one transaction, no chunking
  possible), so the original one-shot-write justification still applies unmodified. Both constants are now
  **explicitly literal** (`ProductWorkbookService::MAX_ROWS` was an alias to `ProductImportService::MAX_ROWS`
  before this PR; it is now its own `2000` with its own rationale, so it can never silently follow a future
  change to the catalog domain's constant).

## 6. The five distinct concepts (not conflated)

Total row safety limit, max file bytes, max columns, preview rows returned to client, apply chunk size — kept
as five separate, independently-justified constants throughout. Full detail in the decomposition doc §10.

## 7. The N+1 fix (query batching, not a mutation-semantics change)

`ProductImportService::prefetchProductMatches()` (new): collects every candidate SKU/`nebrax_id`/barcode in the
current analysis window before the row loop, resolves them via chunked (500-value) `whereIn()` queries — the
same "prefetch once" pattern the existing `referenceIndex()` already used for category/brand/unit matching.
`matchExisting()` and a new `hasBatchedSkuConflict()`/`hasBatchedBarcodeConflict()` pair consult these prefetched
maps. **The write-time live re-check inside `apply()`'s transaction is untouched** — `hasLiveSkuConflict`/
`hasLiveBarcodeConflict`/`assertNoLiveSkuConflict`/`assertNoLiveBarcodeConflict` still issue live, uncached,
per-row queries exactly as before, because their whole purpose is catching a conflict from a request that
committed between the batched prefetch and the actual write. Zero mutation-semantics change: verified by the
full pre-existing `ProductImportV2Test` (49 tests, extensively exercising SKU/barcode/`nebrax_id` matching and
conflicts) and `ProductImportTest` (7 tests) passing **unmodified**.

## 8. Legacy endpoint behavior

`/products/import/{inspect,preview,apply}` (`ProductController`) are unchanged for any caller that does not send
the new `for_durable` field — byte-for-byte identical request/response contract, same `MAX_ROWS = 2000` cap. No
existing frontend or API integration that omits `for_durable` observes any behavior change.

## 9. Durable Product Catalog behavior

- `POST /import-jobs` (`domain=product_catalog`) → `ImportJobService::inspect()` now uses
  `ProductImportService::DURABLE_MAX_ROWS` (20,000) via the new `maxRowsFor()` per-domain resolver — a file
  between 2,001 and 20,000 rows is accepted where it was previously rejected at this stage.
- `/products/import/inspect` and `/products/import/preview` accept the same higher ceiling **only** when the
  request explicitly sends `for_durable=true` — the PR-DUR-5 frontend always sends it (it never calls the legacy
  one-shot `/products/import/apply`). Omitting the field keeps the old 2,000-row behavior exactly.
- Durable chunked `apply()` (`ImportJobService::runProductCatalogChunk` → `ProductImportService::apply()`) passes
  `DURABLE_MAX_ROWS` explicitly; a file beyond it fails the job at `inspect()` time (job created with
  `status: failed`, not an HTTP 422 — same established pattern as the existing column-ceiling failure).
- All PR-DUR-2 guarantees re-verified unmodified: resumability, idempotency, server-owned `processed_rows`,
  Tenant Isolation, live cost authorization (`SensitiveCostPolicy`), mapping/blank/master-data policy,
  create/update/upsert semantics, zero stock/accounting mutation from import itself.

## 10. Product Workbook behavior

Unchanged. `ProductWorkbookService::MAX_ROWS` stays `2000` (now an explicit literal, not an alias) — atomic
apply (Products/Barcodes/Unit Prices in one transaction), no `batch_offset`/`batch_size` in its contract, no
change to PR-UOM2-4/PR-DUR-3 pricing semantics. `ImportJobDomainRowLimitsTest` proves a workbook upload beyond
2,000 rows still fails the job at inspect, exactly as before this PR.

## 11. Inventory Opening behavior

Unchanged. `InventoryOpeningImportService::MAX_ROWS` stays `2000` (was already its own literal, not aliased —
confirmed by reading the file). Draft-only; `InventoryOpeningImportService::apply()` still calls only
`InventoryOpeningService::createDraft()`, never `post()`. `ImportJobDomainRowLimitsTest` proves an openings
upload beyond 2,000 rows still fails the job at inspect. No StockMovement/inventory balance/average-cost/
JournalEntry/JournalLine effect — unaffected by this PR, not re-tested here beyond the existing suite (which
still passes unmodified).

## 12. Mobile fixes

1. **Step navigation reachability**: `Stepper` (shared by all three durable import pages) gained a
   `useEffect(() => activeRef.current?.scrollIntoView({inline:'center', block:'nearest'}), [current])`, guarded
   by a `typeof … === 'function'` check. This is the concrete, previously-untested gap PR-DUR-5 §9 explicitly
   disclosed ("no new automated viewport… test harness") — a narrow viewport that never got manually scrolled
   kept later steps genuinely out of view within their own scrollable container. Fixed with the smallest
   possible change: no new component, no layout change, desktop/tablet behavior unaffected (this only changes
   scroll position on step change).
2. **Bottom action / Safari safe-area**: all three pages' primary/secondary action rows now use the existing
   shared `FormActions` component (`@/components/nebrax`, already used by `expenses/new`,
   `receipt-vouchers/new`, `manual-journals/new`) instead of a plain inline `<div>` — `FormActions` provides
   `fixed inset-x-0 bottom-0 … pb-safe lg:static …` (safe-area-aware on mobile, reverts to normal in-flow layout
   from `lg:`) for free, reusing a proven, already-tested pattern rather than inventing new safe-area handling.
   All three pages' root `pb-24 lg:pb-0` was already present (matching this exact convention) but had never
   actually been paired with a `FormActions`-wrapped action row until this PR.
3. **RTL/LTR**: no directional logic changed. New tests render `Stepper` with both Arabic and English labels to
   confirm no hidden Arabic-only assumption.

## 13. Changed files

Backend:
- `app/Services/ProductImportService.php` — `DURABLE_MAX_ROWS` constant; optional `$maxRows` param threaded
  through `inspect()`/`preview()`/`apply()`/`parse()`/`readFile()`; `prefetchProductMatches()`/`fetchInChunks()`
  (new); `matchExisting()`/`assertLiveConflicts()` now consult batched matches;
  `hasBatchedSkuConflict()`/`hasBatchedBarcodeConflict()` (new, `assertLiveConflicts()`-only); the write-time
  live-check methods are untouched.
- `app/Services/ImportJobService.php` — `maxRowsFor(string $domain)` (new, replaces the removed `MAX_ROWS`
  alias); all `SpreadsheetReader::read()`/`readWorkbookXlsx()` call sites now resolve the cap per-domain.
- `app/Services/ProductWorkbookService.php` — `MAX_ROWS` decoupled from an alias to an explicit `2000` literal.
- `app/Http/Requests/ImportProductsRequest.php` — `for_durable` boolean field + `maxRows()` accessor.
- `app/Http/Controllers/Api/ProductController.php` — `importInspect`/`importPreview` pass `$request->maxRows()`.

Backend tests (new/modified):
- `tests/Feature/ProductImportV2Test.php` — `for_durable` behavior on inspect/preview, N+1 query-count
  assertion.
- `tests/Feature/ImportJobApplyTest.php` — durable upload beyond the old 2,000-row ceiling completes end-to-end
  with no loss/duplication around that boundary; rejection beyond the new `DURABLE_MAX_ROWS` ceiling.
- `tests/Feature/ImportJobDomainRowLimitsTest.php` (new) — the three domains' explicitly distinct row ceilings;
  Product Workbook and Inventory Opening both still fail at inspect beyond their own unchanged 2,000-row cap.

Frontend:
- `web/src/modules/products/import/contract.ts` — `MAX_IMPORT_ROWS` raised to 20,000 (matches
  `DURABLE_MAX_ROWS`, now genuinely achievable end-to-end since `preview()` is unlocked too); `importFormData()`
  gained a `forDurable` option.
- `web/src/modules/products/import/stepper.tsx` — auto-scroll-active-step-into-view fix.
- `web/src/app/(app)/products/import/page.tsx` — sends `forDurable: true` on inspect/preview; all action rows
  now use `FormActions`.
- `web/src/app/(app)/inventory-openings/import/page.tsx`, `web/src/app/(app)/products/workbook-import/page.tsx`
  — all action rows now use `FormActions` (their own `MAX_IMPORT_ROWS` stays `2000`, unchanged — both atomic
  domains).

Frontend tests (new/modified):
- `web/src/modules/products/import/stepper.test.tsx` (new) — auto-scroll behavior, defensive guard when
  `scrollIntoView` is absent, all steps stay reachable, RTL/LTR smoke.
- `web/src/app/(app)/products/import/page.test.tsx` — `for_durable=1` sent on both inspect/preview;
  `FormActions`/`pb-safe` presence on the apply button.
- `web/src/app/(app)/inventory-openings/import/page.test.tsx`,
  `web/src/app/(app)/products/workbook-import/page.test.tsx` — `FormActions`/`pb-safe` presence on their
  primary action buttons.

Docs:
- `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` — PR table updated,
  new §10 (this PR's full contract).
- This report.

No database migration, no schema change, no route added/removed, no accounting-rule change.

## 14. Tests and results

- **Backend, focused**: `ProductImportV2Test` (53 tests), `ProductImportTest` (7), `ImportJobApplyTest` (14),
  `ImportJobTest` (16), `ImportJobWorkbookApplyTest` (12), `ImportJobInventoryOpeningApplyTest` (12),
  `ImportJobDomainRowLimitsTest` (3, new) — all green on SQLite.
- **Backend, full suite**: `php artisan test` — **3,187 passed**, 19 skipped (PostgreSQL-only concurrency tests,
  expected on SQLite), **88 failed — all in `FuelSupplyReceivingTest`, all `Call to undefined function
  App\Services\bcmul()`**. This is the PHP `bcmath` extension not being installed in this local sandbox — not a
  regression from this PR (this PR never touches `FuelCostBasisService` or anything fuel-related). Confirmed:
  both `Dockerfile` and `.github/workflows/ci.yml` explicitly install/require `bcmath`, so GitHub Actions CI has
  it and these tests are expected to pass there.
- **Frontend, focused**: `stepper.test.tsx` (4, new), `products/import/page.test.tsx` (7, 2 new),
  `inventory-openings/import/page.test.tsx` (5, 1 new), `products/workbook-import/page.test.tsx` (4, 1 new),
  `contract.test.ts` (13, unmodified), `useImportJobEngine.test.tsx` (8, unmodified) — all green.
- **Frontend, full suite**: `npx vitest run` — **1,692 passed, 0 failed**, 257 test files.

## 15. TypeScript / Build

- `npx tsc --noEmit`: 7 pre-existing errors, all in files this PR does not touch (`pos/settings/configuration`,
  `platform/integrations/gemini-card`, `document-language-selector`, `global-application-controls-card`,
  `use-document-label-mode`, `useImportJobEngine.test.tsx` — the same set documented in PR-DUR-5's own report).
  Zero new errors from this PR's changes.
- `npm run build`: succeeded, exit code 0. All existing routes present, including the three durable import
  pages.
- Lint: not run — this repository still has no committed ESLint config and `web-ci.yml` still runs no lint
  step (documented, pre-existing gap; unchanged from PR-DUR-5's own report).

## 16. Accounting / stock / Tenant Isolation evidence

- **Accounting entries table**: **None.** This PR touches zero accounting-adjacent write paths — it only
  changes (a) row-count validation limits, (b) a read-only query-batching optimization, (c) frontend mobile
  layout. No new financial operation exists in this diff.
- `ImportJobApplyTest::completed_apply_creates_zero_inventory_or_ledger_effect` (pre-existing, unmodified) and
  the new large-catalog test both assert `StockMovement::count() === 0`, `JournalEntry::count() === 0`,
  `JournalLine::count() === 0` after a durable Product Catalog import.
  `ImportJobInventoryOpeningApplyTest::apply_creates_zero_stock_or_ledger_effect` (unmodified) confirms the same
  for Inventory Opening's draft-only behavior — untouched by this PR.
- Tenant Isolation: every product/barcode lookup in `prefetchProductMatches()` goes through `Product::query()`/
  `BarcodeRegistryEntry::query()`, which inherit `BaseModel`'s `TenantScope` exactly like every pre-existing
  query in this file — no manual scope bypass introduced. Existing tenant-isolation tests
  (`import_is_isolated_per_tenant`, `apply_cannot_be_called_from_another_tenant`, `a_nebrax_id_from_another_tenant_never_resolves`,
  etc.) all pass unmodified.

## 17. CI

Reported once available — see the PR for the exact Head SHA and run links.

## 18. Risks / known limitations

- **Durable chunked apply still re-reads the whole file from disk on every chunk** (`ImportJobService`'s
  `materializeLocalCopy()` + `SpreadsheetReader::read()`/`ProductImportService::apply()`'s own `readFile()`).
  This PR did not remove that — it measured it (safe up to `DURABLE_MAX_ROWS`, wasteful but not unsafe in
  aggregate: ~44 s cumulative re-read overhead across a full 20,000-row, ~200-chunk import) and chose not to fix
  it, because doing so safely requires either true streaming/partial-file reads inside `SpreadsheetReader` or a
  persisted parsed-rows cache keyed by `ImportJob` — both a real parser/backend redesign, correctly out of scope
  for a narrow hardening PR. **This is the honest ceiling of what this PR can claim**: `DURABLE_MAX_ROWS = 20000`
  is the largest limit this PR found technically defensible under the *current* architecture, not "arbitrary
  large file support."
- **Minimal follow-up architecture for true large-file support** (recommended next step, not done here): change
  `SpreadsheetReader::read()`/`readCsv()`/`parseSheet()` to accept an optional row-window and stop reading once
  it has satisfied `[0, offset+batchSize)` instead of always reading to EOF, so each durable chunk's read cost
  becomes proportional to its position in the file rather than the whole file. This is additive (new optional
  parameter, existing callers unaffected) and would remove the last quadratic-cost element without needing a
  queue/worker.
- **Local sandbox test-suite gap**: `bcmath` PHP extension not installed here (§14) — confirmed pre-existing and
  environment-only, not a code regression; CI has it.
- **No lint baseline** in this repository (§15) — pre-existing, unchanged from PR-DUR-5.

## 19. Deviations from the approved task

- The task asked to raise `preview()`'s ceiling only "if feasible" without conflating concepts. This PR *does*
  raise `preview()`'s ceiling (gated by the same explicit `for_durable` flag as `inspect()`) — a deliberate,
  disclosed decision made only after empirically confirming the N+1 fix removes the actual risk (§4, §7), not a
  blind removal of the old cap. This was judged in-scope because without it, raising only the durable engine's
  own ceiling would have been a partial, not-genuinely-usable fix (a fresh upload always goes through `preview()`
  before an `ImportJob`'s apply loop starts) — matching the task's explicit instruction to not "pretend Durable
  Imports supports arbitrary large files if inspect/preview still fundamentally cannot."
- No other deviation. No database/API contract change beyond the new optional `for_durable` request field and
  optional `$maxRows`/`maxRows()` method parameters (backward compatible everywhere; no existing caller's
  behavior changes without opting in).

## 20. Remaining work / next recommended step

- Recommended next (separate PR, not started here): the `SpreadsheetReader` windowed-read optimization described
  in §18, to remove the remaining quadratic re-read cost and let `DURABLE_MAX_ROWS` be reconsidered upward with
  fresh measurements.
- This is the final PR of the requested scope. No Inventory Workspace, no Design System V2, no further Phase-2
  feature started here.
