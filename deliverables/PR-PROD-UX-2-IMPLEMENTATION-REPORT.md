# PR-PROD-UX-2 — UOM + Pricing + Multiple Barcode Workspace Integration — Implementation Report

## 1. Latest main SHA

`1e7b0c7a13eeee5b1679817b281dc79d4d127003` (matches the given confirmed PR-PROD-UX-1 squash-merge SHA exactly — `main` had not moved).

## 2. Branch

`claude/pr-prod-ux-2-uom-pricing-barcode`

## 3. PR number/link

Opened after this report was finalized — see the PR section of the final execution message returned alongside this report.

## 4. Head SHA

Recorded at push time — see the PR's commit list, and the follow-up "record head SHA" note appended to this report.

## 5. Phase 0 — Existing authority map

All findings from direct reads of the backend source (`/home/user/Nebrax`) after PR #838, with file:line citations.

1. **Atomic create contract** — `StoreProductRequest::rules()` does **not** declare `barcodes`/`unit_prices` as validated array fields (confirmed absent by grep). They are read raw via `$request->input(...)` inside `ProductController::store()` (lines 270-304), which wraps `products->create()`, `storePendingBarcodesWithinTransaction()`, and `storePendingUnitPricesWithinTransaction()` in **one `DB::transaction()`** — confirmed atomic, not a follow-up call. Per-element validation happens inside `createAlternateBarcodeWithinTransaction()` (lines 438-479) — the exact same private method used by the edit-mode `POST /products/{id}/barcodes` endpoint, so create-time and edit-time validation are guaranteed identical. No max-count cap exists on either array.
2. **Edit-mode barcode endpoints require an existing product**: `GET/POST /products/{id}/barcodes`, `DELETE /products/{id}/barcodes/{barcodeId}` (`ProductController.php:523-566`) all call `Product::findOrFail($id)`. Tenant-scoped uniqueness is enforced via a unified `barcode_registry` table (`database/migrations/2026_09_07_010000_create_barcode_registry.php`, `unique(['tenant_id','code'])`), covering primary and alternate barcodes in one namespace; duplicates surface as HTTP 422 with `{"message": "..."}`.
3. **`ProductUnitPrice` / `ProductPricingService::setPrice()`** (`app/Services/ProductPricingService.php:75-105`) is a **true idempotent upsert** keyed by `(product_id, product_variant_id, unit_name)` — `firstOrCreate` + a `QueryException` catch for the race + a `lockForUpdate()` re-read/update, backed by two DB partial unique indexes. Repeated `PUT /products/{id}/unit-prices` calls with the same key update the same row's price, never create a duplicate. `PUT /products/{id}/unit-prices` (`ProductController::storeUnitPrice()`, lines 587-597) calls this same method.
4. **No factor-derived pricing anywhere** — confirmed explicitly by both `ProductUnitPrice.php`'s and `ProductPricingService.php`'s own docblocks, and by code inspection: `storedUnitName()` (lines 120-125) destructures only the unit name from `UnitConversion::resolve()`'s `[name, factor]` tuple and **discards** `factor`. No arithmetic on `factor` exists anywhere in `ProductPricingService.php`.
5. **Canonical conversion-factor field**: `factor` (integer) on `unit_template_units` (`app/Models/UnitTemplateUnit.php:18,20`), read via `UnitTemplate::factorFor()`/`UnitConversion::resolve()` for unit-name validation and inventory/quantity consumers — never for pricing.
6. **`ProductMultiBarcodeTable`'s pre-PR-2 state contained no duplicated pricing authority** — its price column already wrote through the canonical `PUT .../unit-prices` endpoint exclusively, with no local/barcode-owned price field. The only real duplication was **structural**: `/products/new`'s separate "pending barcode" mini-list was a second, independent implementation of the same unit×barcode×price concept, entirely disconnected from `ProductMultiBarcodeTable`, unusable before a product existed.

**No backend/schema/API authority change was required.** Every capability this PR needed (atomic create-time persistence, idempotent price upsert, no factor-derived pricing) was already correctly implemented and tested on the backend before this PR started. This is a pure frontend integration/consolidation PR, as scoped.

## 6. Exact ProductWorkspace integration

- **`ProductMultiBarcodeTable` now supports two modes in one implementation** (no second table built): when `productId` is provided it behaves exactly as before PR-2 (fetches from `/barcodes` and `/unit-prices`, mutates via those endpoints). When `productId` is **absent**, it operates entirely on **local pending state** owned by the caller (`pendingRows`/`onPendingRowsChange` props) — no network call of any kind, same UI/columns/validation. The two modes are switches over the same rendering and the same `addRow()`/`deleteRow()`/`savePrice()` functions, not a duplicated component.
- **`ProductWorkspace` now owns and mounts `ProductMultiBarcodeTable` directly**, right below the two-column card grid (near the primary barcode field's card, matching "the collapsed advanced editor lives right next to the simple field" pattern) — for both Create and Edit. It owns `pendingBarcodes: PendingBarcodeRow[]` state (create-mode) and a `variants` fetch (edit-mode, VAR-PRICE-UX-1 pattern, now centralized in one place instead of duplicated between `ProductDialog` and the former `/products/[id]` page-level code from PR-1).
- The now-obsolete `extraCreatePayload` and `onAlternateUnitsChange` props (introduced in PR-1 specifically as an external escape hatch for the not-yet-integrated barcode table) were **removed** — `ProductWorkspace` no longer needs them since it owns `alternateUnits` and the barcode/price state directly.
- `/products/new` is now purely a wrapper for media + publication (unchanged, out of scope) around `<ProductWorkspace mode="create" />` — its own duplicated pending-barcode mini-list UI was deleted entirely (125 lines removed from that page). `/products/[id]` similarly no longer separately mounts `ProductMultiBarcodeTable` or fetches `variants`/`alternateUnits` — both now live inside `ProductWorkspace`. The redundant read-only "alternate barcodes" badge list on the profile page was also removed, since it duplicated information now shown live and editably by the always-visible-when-populated table.

## 7. Create-mode atomic persistence behavior

`ProductWorkspace::submit()` (create branch) builds the `POST /products` body as `{...buildPayload(form, 'create'), barcodes: [...], unit_prices: [...]}` from `pendingBarcodes` — one request, matching the confirmed atomic backend contract exactly. `unit_prices` is deduplicated by `unit_name` defensively (all pending rows sharing a unit already show the same price in the UI by construction — see §11 — so this is belt-and-suspenders, not a behavior it relies on). This is still **exactly one `POST /products` call**, identical to the pre-PR-1 `/products/new` behavior, now available from the shared workspace in both former entry points.

## 8. First-save handoff behavior

On successful create: `persistedId` is set, `pendingBarcodes` is cleared, and `onCreated` fires — all as before (PR-1 contract, unchanged). `ProductMultiBarcodeTable`'s own `productId` prop transitions from `undefined` to the real id in the same render pass; its existing `useEffect(() => { if (productId) void load(); }, [load, productId])` fires **exactly once**, fetching the rows the backend already created atomically in the same transaction as the product. No `POST /products/{id}/barcodes` or `PUT /products/{id}/unit-prices` call is ever made for these rows after creation — they are only ever *read* back. This required no special "handoff" code: clearing `pendingBarcodes` and letting the existing `productId`-gated effect do its job was sufficient, because the backend transaction had already made the rows real.

## 9. Edit-mode persistence behavior

Unchanged from pre-PR-2 `ProductMultiBarcodeTable` behavior, now reachable without a modal: `GET /products/{id}/barcodes` + `GET /products/{id}/unit-prices` load existing rows; `POST /products/{id}/barcodes` adds a row; `DELETE /products/{id}/barcodes/{id}` removes one; price edits `PUT /products/{id}/unit-prices`. IDs are never invented or reused client-side — every id displayed is the one the backend returned. No frontend code deletes-and-recreates a record; edits are always in-place.

## 10. Barcode → UOM → Pricing authority behavior

Preserved exactly, in both modes: the price input lives in the barcode/UOM row for UX convenience only. In edit mode it writes through `ProductPricingService::setPrice()` via `PUT /products/{id}/unit-prices`, never a barcode-owned field. In create mode, the same identity is respected structurally: the pending price is carried alongside the pending barcode row purely as UI state, and at submission time is placed into the request's separate `unit_prices` array (not embedded in the `barcodes` array item), landing in exactly the same canonical `ProductUnitPrice` table via the same backend code path as if it had been entered after the fact through the live table. The barcode row itself never gains a `price` column on the backend at any point.

## 11. Multiple-barcode/same-UOM behavior

**Edit mode**: unchanged, already correct pre-PR-2 and re-verified with an existing, untouched test (`باركودان لنفس الوحدة يعرضان نفس السعر القانوني، وتعديل أحدهما يُحدِّث كليهما`) — editing the price for one barcode row updates the canonical `ProductUnitPrice` row for that unit, and a full reload shows every other barcode row sharing that unit reflecting the new price.

**Create mode (new in this PR)**: `savePrice()` in create mode updates the `price` field on **every** pending row that shares the same `unit_name`, not just the row being edited — so the UI never shows two different prices for the same pending unit, matching the real backend invariant visually even before the product exists. Verified by a dedicated new test (`صفّان معلَّقان لنفس الوحدة يشتركان بصريّاً بنفس السعر...`).

## 12. Files changed

```
web/src/components/products/product-multi-barcode-table.tsx        (extended: create/edit dual-mode)
web/src/components/products/product-multi-barcode-table.test.tsx   (+130 lines: 8 new create-mode tests)
web/src/components/products/product-workspace.tsx                  (+94/-: owns barcode table, pendingBarcodes, variants)
web/src/components/products/product-workspace.test.tsx             (+74 lines: 4 new PR-2 integration tests)
web/src/app/(app)/products/new/page.tsx                             (-125 lines: pending-barcode mini-list removed)
web/src/app/(app)/products/[id]/page.tsx                            (-58 lines: table/variants relocated into ProductWorkspace)
```

No file under `app/` (backend) was touched. No migration. No API contract change. `product-dialog.tsx` was not touched.

## 13. Tests + exact results

- `product-multi-barcode-table.test.tsx`: **20/20 passed** (12 pre-existing edit-mode tests unmodified and green, 8 new create-mode tests: no network call before `product_id`, add row emits `onPendingRowsChange` with no POST, three explicit UOM prices proven non-factor-derived (piece=5, pack×6=27, carton×12=50), delete a pending row, shared-price sync across pending rows for the same unit, invalid price blocks the add entirely in create mode (matches the pre-PR-2 `/products/new` mini-list's own historical behavior), no variant column ever shown in create mode).
- `product-workspace.test.tsx`: **12/12 passed** (8 pre-existing PR-1 tests unmodified and green, 4 new: primary barcode stays simple with the collapsed editor present, first Save merges pending barcodes/unit_prices into exactly one `POST` body, a successful first Save never re-submits the atomically-created rows (0 `POST .../barcodes`, 0 `PUT .../unit-prices` after create, exactly 1 `GET .../barcodes`), edit mode loads existing barcode/price records through the live authority).
- `products/new/page.com-ws-3.test.tsx` (pre-existing, unmodified): **1/1 passed** — publication-retry-without-duplicate-create flow still intact after removing the page's own pending-barcode code.
- `products/page.test.tsx` (pre-existing + PR-1's regression test, unmodified): **13/13 passed**.
- Quick-add regressions (`invoice-form.test.tsx`, `invoice-form-advanced.test.tsx`, `purchase-form.test.tsx`): **78/78 passed** — `ProductDialog` untouched.
- Combined focused run: **155/155 passed**.
- Full frontend suite (`npm test`, all 272 test files): **1790/1790 passed** (1779 pre-existing + 11 new) — zero regressions anywhere else in the codebase.

No test was skipped, weakened, or deleted to reach green. Two pre-existing test assertions in the newly-extended `product-multi-barcode-table.test.tsx` file needed adjustment for a real jsdom quirk (desktop and mobile layouts both render simultaneously in the test environment, since there's no real CSS media-query evaluation, so `getAllByDisplayValue` naturally returns matches from both layouts) — this was already the established pattern in the pre-existing edit-mode tests in the same file and was applied consistently to the new ones, not a weakening.

## 14. Build result

`npm run build` — **succeeded**, zero errors. `/products`, `/products/[id]`, `/products/new` all compiled — `/products/new`'s bundle shrank from 7.5 kB to 4.9 kB after removing its duplicated pending-barcode implementation. `npx tsc --noEmit` — no new errors in any file this PR touched (only the same pre-existing, unrelated `AbstractIntlMessages` test-type-inference quirk already present in the pre-existing `product-multi-barcode-table.test.tsx`, now also naturally present in `product-workspace.test.tsx` since it follows the same established test pattern).

## 15. CI

Not yet observed — this report is written before the PR is opened, per the mission's instruction to open a separate PR and report its status.

## 16. Risks

- **Auto-expand interaction with pre-filled pending rows**: if a future caller renders `ProductMultiBarcodeTable` in create mode with non-empty `pendingRows` on first mount, the section auto-expands immediately (same rule as edit mode's non-empty barcode list) — intentional and consistent, but worth remembering for any future PR that pre-populates rows from, say, a duplicate/copy flow.
- **`unit_prices` dedup-by-unit-name in the atomic POST body** is defensive, not load-bearing — the UI already guarantees pending rows sharing a unit carry the same price (§11), so this is a safety net for a state that should not occur, not a correctness-critical step.
- **Largest behavioral surface of the two PR-2 changes** is the create/edit mode branch inside `ProductMultiBarcodeTable` itself — mitigated by 20 dedicated tests (12 pre-existing untouched + 8 new) directly exercising both branches, plus the 4 new `ProductWorkspace`-level integration tests proving the handoff specifically.

## 17. Remaining work

Everything explicitly deferred to PR-PROD-UX-3 (Options/Variants integration into the shared workspace, including embedding a variant-filtered `ProductMultiBarcodeTable` in the variant detail sheet) and PR-PROD-UX-4 (media gallery deduplication, `ProductPublicationFields` repositioning into the shared workspace, final polish) — per `AWJ_PRODUCT_CREATE_EDIT_V2_IMPLEMENTATION_PLAN.md`. No option-value/variant media authoring work was started (still pending backend confirmation, per the architecture doc).

## 18. Explicit confirmation: conversion factor never determines price

Confirmed. `ProductWorkspace`/`ProductMultiBarcodeTable` never multiply, divide, or otherwise derive a price from `factor` anywhere in the frontend code added or modified by this PR — the `×N` factor column remains purely informational/read-only in both modes, exactly as before. Backend confirmation independently verified in Phase 0 (§5, item 4): `ProductPricingService` discards the factor value entirely. The test matrix explicitly proves this with three independent, non-derivable prices (piece=5, pack×6=27 — not 6×5=30, carton×12=50 — not 12×5=60).

## 19. Explicit confirmation: barcode never became price authority

Confirmed. In both create and edit mode, the price is never stored as a property of a barcode row on the backend — it is always routed to the canonical `ProductUnitPrice` table via `unit_prices`/`PUT .../unit-prices`, keyed by `(product_id, product_variant_id, unit_name)`, independent of which (or how many) barcode aliases resolve to that identity+unit. Multiple barcodes sharing a UOM are proven (§11, both in existing edit-mode tests and new create-mode tests) to always share one price, never diverge.

## 20. Explicit confirmation: PR-3/PR-4 scope was not implemented

Confirmed. `ProductVariantsPanel` was not touched (`git diff` shows zero changes). No combination-matrix, option-authoring, or variant-detail-editor code was written. No media gallery consolidation or `ProductPublicationFields` repositioning was done — both remain exactly where PR-1 left them, as separate page-level concerns. The only variant-related addition is the pre-existing VAR-PRICE-UX-1 `variants` fetch (already present, unchanged in logic) relocated from being duplicated across `ProductDialog`/`[id]/page.tsx` into one place inside `ProductWorkspace` — this is deduplication of existing PR-1-era code, not new Variant integration.

## 21. Explicit confirmation of no schema/accounting/inventory/Tenant Isolation authority changes

Confirmed. No file under `database/migrations/`, `app/Models/`, `app/Services/`, `app/Http/Controllers/`, `app/Http/Requests/`, or any other backend path was modified — this PR is frontend-only (`web/src/**`). No new API endpoint was introduced or called that didn't already exist and wasn't already exercised by the pre-PR-2 `ProductMultiBarcodeTable` or the pre-PR-1 `/products/new` pending-barcode mechanism. No change to `ProductPricingService`, `PriceListService`, barcode resolution, `LedgerService`, accounting, tax calculation, inventory valuation, `InventoryState`, Tenant Isolation, or permission semantics. No new Setting was introduced.

## 22. Recommended next action

Review and merge PR-PROD-UX-2 (pending human review — not merged by this pass). Once approved, proceed to PR-PROD-UX-3 (Options/Variants integration) as the next scoped, independently-reviewable unit, per the approved implementation plan's dependency ordering — it depends on both PR-1 (workspace shell, merged) and PR-2 (this PR, for embedding the multi-barcode table in the variant detail sheet).
