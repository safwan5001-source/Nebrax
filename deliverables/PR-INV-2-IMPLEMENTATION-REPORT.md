# AWJ Implementation Report — PR-INV-2

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-inv-2`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/671
**Base SHA:** `3e4556c` (main, after PR-SEC-INV-1 / #666, PR-INV-1 / #668, and PR-PRICE-1 / #669 merged)
**Head SHA:** `6eb0f55`

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-INV-2-purchase-returns.md` only — the fourth Phase 1 hardening gate of the Products & Inventory program. No other program task was started, no audit re-run from scratch, no scope expansion.

Two confirmed problems (contract + `AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md` §15), shipped together because both affect the same financial stock exit:

1. **UOM / historical base quantity:** `ReturnLine` has no `unit_name`/`unit_factor` fields at all (unlike `InvoiceLine`/`PurchaseLine`), and `ReturnService::postPurchaseReturn()` issued `InventoryService::applyIssue()` with the raw `ReturnLine.quantity` — the quantity as entered on the return, never converted through the original `PurchaseLine.unit_factor`. Returning one carton (factor 24) removed exactly one base unit from stock, leaving 23 base units stuck.
2. **Inventory valuation / GL reconciliation:** the same method valued both the stock exit and the 1140 credit at the return's commercial `unit_price` (the supplier-credit price), not the product's current moving-average carrying cost (`avg_cost`). Whenever the two diverge, `Δ 1140 = Δ inventory subledger` breaks by exactly the difference.

## 2. Scope implemented

`app/Services/Accounting/ReturnService.php`:

- New private `purchaseReturnLineBaseQuantity(ReturnLine $line, ?PurchaseLine $source): int` — mirrors the existing, already-correct `returnLineBaseQuantity()` used by sales returns. Resolves the return line's base quantity from **the historical `unit_factor` stored on the original `PurchaseLine`** (via `source_line_id`), not from any live `UnitTemplate`/`Product` state. `PurchaseLine` has no numerator/denominator fractional fields (no fractional purchase lines exist today), so there is no fractional branch here, unlike the sales-return counterpart.
- `postPurchaseReturn()` rebuilt:
  - Bulk-resolves all referenced source `PurchaseLine`s once (no N+1).
  - For each tracked-inventory line: computes `baseQuantity` via the new method, and accumulates both the **commercial** total (`line_subtotal - line_discount`, unchanged meaning) and a separate **carrying** total (`baseQuantity × product.avg_cost`).
  - `InventoryService::applyIssue()` is now called with the base quantity and the product's **current `avg_cost`** — never the return line's `unit_price` — for every tracked line, with `enforce_stock => true` preserving the existing negative-stock policy.
  - The journal entry credits 1140 by the **carrying total only**. The **variance** (`commercial − carrying`) posts to account **5180** ("فروق الجرد والتلف") — the same account and sign convention already used identically by Stocktake, StockPermit, and sales-return-damage postings: **credit** when commercial > carrying (supplier credited more than carrying value — a gain), **debit** when commercial < carrying (a loss). No new GL account, no new costing method.
  - VAT (1150) and the payable/cash debit (2110/1110) remain at the full commercial total, unaffected by the carrying/commercial split — tax and supplier economics are represented correctly regardless of the valuation divergence, per the contract's explicit requirement.

No change to `postSalesReturn()`, `CreditNoteService` (confirmed by inspection to have zero inventory-movement code — a deliberately separate, purely-financial domain, out of scope), `assertWithinSource()`'s cap logic, or the costing architecture (still global moving-average, one `LedgerService::post()` call per return).

## 3. Files changed

| File | Change | Why |
|---|---|---|
| `app/Services/Accounting/ReturnService.php` | `purchaseReturnLineBaseQuantity()` added; `postPurchaseReturn()` rebuilt to issue base quantity at carrying value and post the commercial/carrying variance to 5180 | The one method that generates the purchase-return ledger entry and stock issue — both confirmed problems live here |
| `tests/Feature/PurchaseReturnUomValuationTest.php` (new) | 13 tests covering the full PR-INV-2 acceptance matrix | Regression coverage for every required invariant |

No migration, no new endpoint, no `ReturnLine`/`ReturnDocument` schema change — the fix reads the already-stored `PurchaseLine.unit_factor` via the existing `source_line_id` link; it does not need to store UOM fields on `ReturnLine` itself because the source purchase line is the single, immutable source of truth for that conversion.

## 4. Schema / migrations / API contract

None. No new migration, no new/changed request or response shape. Behavior change only: a purchase return linked to its source purchase (`original_id`/`original_type` on the header, `source_line_id` on each line) now issues stock at the historically-correct base quantity and values both the stock exit and 1140 at carrying cost instead of the return's commercial price.

## 5. Security / Tenant / Branch / Warehouse evidence

- No new endpoint or permission surface; `ReturnController`'s existing RBAC/tenant-scoped path is unchanged.
- `PurchaseLine::whereIn('id', $sourceLineIds)->get()` is a raw ID lookup, but every such line is reached only via a `source_line_id` that was itself validated against a tenant-resolved `Purchase` at `create()`/`post()` time (`resolveSource()`, `BranchScope::reference()`), so no cross-tenant leak is introduced.
- Warehouse-level negative-stock enforcement is preserved unchanged: `applyIssue(..., 'enforce_stock' => true, 'warehouse_id' => $return->warehouse_id, ...)`, verified by `a_return_exceeding_the_specific_warehouse_stock_is_rejected_when_negative_stock_is_disabled` — a return whose total purchased-quantity cap is satisfied but whose *specific warehouse* stock is insufficient (goods physically moved elsewhere after receipt) is still rejected.
- Atomicity/double-post safety unchanged: `post()`'s existing `DB::transaction()` + `lockForUpdate()` + in-transaction re-run of `assertWithinSource()` still guards against two drafts consuming the same remaining quantity — verified by `two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity`, and rollback-on-rejection by `a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation` (draft status, no journal entry, no stock movement, no warehouse-stock mutation survive a rejected post).

## 6. Accounting / Inventory reconciliation

**Journal entry — purchase return (after this fix):**

| Account | Debit | Credit | Note |
|---|---|---|---|
| 2110 الموردون (or 1110 الصندوق for cash) | Full commercial total (net + tax) | | Unchanged — full commercial value, as before |
| 1140 المخزون | | **Carrying value only** (Σ base quantity × current `avg_cost`) | Not the commercial `unit_price` |
| 5150 مصروفات (non-tracked lines) | | Commercial value of non-tracked items | Unchanged |
| 1150 ضريبة المدخلات | | Full tax | Unaffected by the valuation split |
| 5180 فروق الجرد والتلف | If carrying > commercial (loss) | If commercial > carrying (gain) | Existing account/convention reused, not new |

**Verified example** (`the_1140_delta_exactly_equals_the_subledger_delta_despite_a_commercial_divergence`): two purchase batches (10×4000, then 10×6000) blend `avg_cost` to 5000; a 3-unit return referencing the second batch's line at its original commercial price 6000 (deliberate divergence). Measured directly, in halalas:

- `Δ subledger = Δ(quantity_on_hand × avg_cost) = -15000` (3 × 5000)
- `Δ 1140 (GL) = -15000` — **exactly equal**, asserted via `assertSame($subledgerDelta, $glDelta, ...)`.

**Tax-isolation example** (`a_tax_bearing_return_keeps_tax_separate_from_the_carrying_value_variance`): 2 units, commercial 6000/unit vs. carrying 5000/unit, 15% tax → subtotal 12000, tax 1800, total 13800. Journal: 2110 debit 13800; 1150 credit 1800; 1140 credit 10000 (carrying only); 5180 credit 2000 (variance) — `Σdebit = Σcredit = 13800`, confirmed the tax line and the variance line never mix.

## 7. UOM / historical semantics

- `returning_one_carton_removes_twenty_four_base_units_not_one`: a 1-carton (factor 24) purchase, returned as "1 carton," now removes exactly 24 base units and credits 1140 by 24 × the per-unit carrying cost — not 1 unit as before the fix.
- `changing_the_unit_template_after_the_purchase_does_not_alter_the_historical_return`: the `UnitTemplate`'s `carton` factor is changed from 24 to 12 **after** the original purchase but **before** the return is posted. The return still resolves 24 base units, because the conversion reads the immutable `unit_factor` snapshot on the original `PurchaseLine`, never the live `UnitTemplate`/`UnitTemplateUnit` state — the same immutability principle already established for sales returns (`returnLineBaseQuantity()`).

## 8. Concurrency / idempotency

Unchanged transaction/locking structure, exercised directly by two new tests:

- `two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity`: two draft returns for 6 of a 10-unit purchase are created before either posts (creation-time check alone would let both pass, since neither counts against `alreadyReturned` until posted). Posting the first succeeds; posting the second re-runs `assertWithinSource()` inside the posting transaction and correctly rejects it ("تتجاوز المتبقي"), because the guard re-queries posted-only returns from inside the same transaction that will mark the first as posted.
- `a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation`: a return that fails the warehouse-stock check mid-transaction leaves the document in `draft`, `journal_entry_id` null, no new `StockMovement`, no new `JournalEntry`, and the total product quantity and the specific warehouse's `ProductWarehouseStock.quantity` both exactly as before the attempt — full atomic rollback.

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=PurchaseReturnUomValuationTest` | **13 passed** (58 assertions) | New PR-INV-2 acceptance matrix (§9a below) |
| `php artisan test --filter="ReturnTest\|ReturnWithProductTest\|ReturnFromSourceTest\|ReturnRestockPolicyTest\|ReturnWindowPolicyTest\|ReturnTypeFilterTest\|PurchaseReturnUomValuationTest\|PurchaseTest\|PurchaseServiceTest\|InventoryServiceTest\|InvoiceTest"` | **168 passed** (847 assertions) | Every existing return/purchase/inventory/invoice suite touching this code path — zero regressions |
| `php artisan test` (full suite, SQLite) | **2436 passed, 1 skipped, 25 failed** | All 25 failures pre-existing and unrelated — identical set/count to the `PR-SEC-INV-1`/`PR-INV-1`/`PR-PRICE-1` baseline: 24 `Fuel*` tests on missing `ext-bcmath` in this sandbox, 1 `DocumentCenterSecureIntakeTest` PDF-fixture issue. Passed count rose 2423→2436 with the 13 new tests. |

### 9a. Acceptance matrix coverage (from the contract)

| Contract requirement | Test |
|---|---|
| Base-unit return removes exact quantity | `a_base_unit_purchase_return_removes_the_exact_base_quantity` |
| Alt-UOM (carton, factor 24) return removes correct base quantity, not raw line quantity | `returning_one_carton_removes_twenty_four_base_units_not_one` |
| Historical `unit_factor` immune to a later `UnitTemplate` change | `changing_the_unit_template_after_the_purchase_does_not_alter_the_historical_return` |
| Cannot return more than eligible remaining (sold/received minus already-returned-and-posted) | `partial_returns_are_capped_by_the_cumulative_remaining_quantity`, `the_exact_remaining_quantity_after_a_partial_return_is_accepted` |
| Guard re-checked inside the posting transaction, not just at draft creation | `two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity` |
| Warehouse negative-stock policy still enforced | `a_return_exceeding_the_specific_warehouse_stock_is_rejected_when_negative_stock_is_disabled` |
| Stock issue/1140 valued at carrying cost, not commercial price, when equal | `commercial_value_equal_to_carrying_value_posts_no_variance` |
| Commercial > carrying → gain credited to 5180, payable stays at full commercial value | `commercial_value_above_carrying_value_credits_the_variance_account` |
| Commercial < carrying → loss debited to 5180, payable stays at full commercial value | `commercial_value_below_carrying_value_debits_the_variance_account` |
| Tax stays isolated from the carrying/commercial variance | `a_tax_bearing_return_keeps_tax_separate_from_the_carrying_value_variance` |
| Δ 1140 = Δ inventory subledger exactly, in minor units, despite divergence | `the_1140_delta_exactly_equals_the_subledger_delta_despite_a_commercial_divergence` |
| Posting atomic; a rejected post leaves no partial mutation | `a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation` |

## 10. Build / Lint / Typecheck

No `web/` changes. `vendor/bin/pint --test` on `ReturnService.php` reports pre-existing style deviations, verified identical via `git stash` comparison of the pre-edit and post-edit versions of the file (same fixer list in both: `class_attributes_separation`, `concat_space`, `unary_operator_spaces`, `braces_position`, `not_operator_with_successor_space`, `single_line_empty_body`, `ordered_imports`, `binary_operator_spaces`, `phpdoc_align`) — zero new violations introduced, same pattern as the prior three PRs in this program. This repository's CI (`ci.yml`) does not gate on Pint.

## 11. CI

Not polled from this session before opening the PR. `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite only. The new code uses only integer arithmetic (`bigint` minor units, `max(1, (int) ...)` for the factor floor) with no DB-specific SQL, so no PostgreSQL-specific divergence is expected but was not directly observed.

## 12. Deviations from approved plan

None. Scope matches the contract exactly:
- Both confirmed problems (UOM/base-quantity and valuation/GL reconciliation) shipped together, as the contract required, because they share the same financial stock exit.
- No new costing method, no per-warehouse average cost, no broader Purchase UX redesign, no Serial/Lot batch selection — all explicitly out of scope per the contract and untouched.
- The variance account (5180) and its sign convention are reused verbatim from the already-established Stocktake/StockPermit/sales-return-damage pattern — no new GL account invented.
- No BLOCKED/NEEDS DECISION situation arose; the fix fit cleanly within the stated invariants using only existing, established architectural patterns (mirroring the sales-return `returnLineBaseQuantity()` fix for the UOM side, and the existing 5180 variance pattern for the valuation side).

## 13. Risks / remaining work

- PostgreSQL leg of CI not run locally in this session; only SQLite validated directly (same caveat as the prior three PRs in this program).
- `ReturnLine` still has no `unit_name`/`unit_factor` columns of its own — the fix resolves the conversion via the linked source `PurchaseLine` at post time. A purchase return created **without** a `source_line_id` (the "free/unlinked return" path, gated by the existing `require_return_source` setting) falls back to treating `ReturnLine.quantity` as already being in base units (`purchaseReturnLineBaseQuantity()` returns `(int) $line->quantity` when `$source` is null) — this is the same fallback behavior that existed before this PR for that specific unlinked case, and is unchanged by this fix. Not flagged as a gap requiring a decision: the contract's confirmed problem is specifically the historical-purchase-linked path, and an unlinked purchase return has no historical UOM to recover in the first place.

## 14. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#671`) is open for review; no auto-merge is configured. Awaiting review per the program's transition gate.

## 15. Next step

Review of this report and the PR diff (#671). Per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`, the next Phase 1 task in sequence should not be started before this review, per program governance.
