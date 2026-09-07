# ACC-5 — Inventory / COGS Account Routing — Implementation Report

**Status:** DONE (PR open, not merged)
**Task doc:** `docs/plans/accounting/ACC-5-inventory-cogs-account-routing.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Dependency:** ACC-2 (merged) · ACC-3 (merged) · ACC-RET-1 (merged) · ACC-4 (merged, `70c80b7`)

## Summary

Adopted `AccountRoleResolver` in every Inventory / COGS posting path named by the ACC-5 doc, replacing
hardcoded account codes with the five approved semantic roles. **Every edit in this PR is an
account-source substitution and nothing else** — no quantity, no moving-average/valuation math, no
rounding, no debit/credit direction, no inventory lifecycle, no warehouse logic, and no historical
journal was touched. `LedgerService` was not modified and stays role-agnostic.

The five roles keep **five distinct identities** even though three of them (`inventory_count_variance`,
`inventory_manual_adjustment`, `inventory_damage_loss`) share the same legacy default account `5180`.
They were not merged, no gain/loss split by sign was introduced, and no transfer-clearing role was added.
`3130` (`opening_balances`) was explicitly **not** repurposed as a variance account and remains hardcoded.

## Baseline check

`origin/main` head verified as `70c80b7d37aab13c3c5c181757ae0db8f3494428` — the ACC-4 merge commit —
before branching. No commits landed between that merge and this task's start.

## Roles adopted and their consumers

| Role | Legacy default | Consumers after ACC-5 |
|---|---|---|
| `inventory_asset` | 1140 | `InventoryService::receiveStock()` (Dr) · `InventoryService::recordSaleCogs()` (Cr, already ACC-3) · `StocktakeService::buildEntry()` · `StockPermitService::buildEntry()` (receipt Dr / issue Cr **and both sides of a cross-branch transfer**) · `ReturnService::postSalesReturn()` (Dr when restocked) · `InventoryOpeningService::post()` (Dr) · `ReturnService::postPurchaseReturn()` (Cr, already ACC-4) · `PurchaseService::post()` (Dr, already ACC-4) |
| `cogs` | 5110 | `InventoryService::recordSaleCogs()` (Dr, already ACC-3, product override preserved) · `ReturnService::postSalesReturn()` (Cr) |
| `inventory_count_variance` | 5180 | `StocktakeService::buildEntry()` only — **one role for both directions** |
| `inventory_manual_adjustment` | 5180 | `StockPermitService::buildEntry()` receipt/issue only |
| `inventory_damage_loss` | 5180 | `ReturnService::postSalesReturn()` (Dr when the goods are not returned to sale) |

## Consumers — before / after

| Path | Before | After |
|---|---|---|
| Inventory receipt (`receiveStock`) | Dr `accountId('1140')` | Dr `resolve('inventory_asset')`; the credit counterparty (2110 / 3130) unchanged |
| Sale COGS (`recordSaleCogs`) | already routed in ACC-3 | unchanged |
| Stocktake surplus | Dr `1140` / Cr `5180` | Dr `inventory_asset` / Cr `inventory_count_variance` |
| Stocktake shortage | Dr `5180` / Cr `1140` | Dr `inventory_count_variance` / Cr `inventory_asset` |
| Stock permit — receipt | Dr `1140` / Cr `5180` | Dr `inventory_asset` / Cr `inventory_manual_adjustment` |
| Stock permit — issue | Dr `5180` / Cr `1140` | Dr `inventory_manual_adjustment` / Cr `inventory_asset` |
| Stock permit — transfer, same branch | **no journal** | **no journal** (unchanged) |
| Stock permit — transfer, cross branch | Dr `1140`@to / Cr `1140`@from | Dr `inventory_asset`@to / Cr `inventory_asset`@from — same role both sides, branch dimensions untouched |
| Sales return, restocked | Dr `1140` / Cr `5110` | Dr `inventory_asset` / Cr `cogs` |
| Sales return, not saleable | Dr `5180` / Cr `5110` | Dr `inventory_damage_loss` / Cr `cogs` |
| Inventory opening (import) | Dr `1140` / Cr `3130` | Dr `inventory_asset` / Cr `3130` (unchanged, hardcoded) |

## Resulting journal entries

Amounts below use a 10-unit @ 5,000 halala basis (50,000 halalas) for illustration; the **amount source is
unchanged in every case** (moving average / entered cost, exactly as before).

| Operation | Debit | Credit | Amount |
|---|---|---|---|
| Inventory receipt | `inventory_asset` (1140) | offset — 2110 payable (or 3130 for the opening shortcut) | `movement.total_cost` |
| Sale COGS | `cogs` (5110) — or `product.cogs_account_id` | `inventory_asset` (1140) | qty × avg_cost |
| Stocktake surplus | `inventory_asset` (1140) | `inventory_count_variance` (5180) | \|net\| |
| Stocktake shortage | `inventory_count_variance` (5180) | `inventory_asset` (1140) | \|net\| |
| Stock permit receipt | `inventory_asset` (1140) | `inventory_manual_adjustment` (5180) | entered cost |
| Stock permit issue | `inventory_manual_adjustment` (5180) | `inventory_asset` (1140) | qty × avg_cost |
| Cross-branch transfer | `inventory_asset` (1140) @ destination branch | `inventory_asset` (1140) @ source branch | qty × avg_cost |
| Sales return, restocked | `inventory_asset` (1140) | `cogs` (5110) | qty × avg_cost |
| Sales return, damaged | `inventory_damage_loss` (5180) | `cogs` (5110) | qty × avg_cost |
| Inventory opening (import) | `inventory_asset` (1140) | `3130` opening balances (**not routed**) | Σ posted `total_cost` |

Every entry above stays balanced (Σ debit = Σ credit) and keeps its `source_type`/`source_id` link.

## Decisions taken and documented before coding

1. **Opening inventory — asset side routed, `3130` left hardcoded.**
   The doc required this decision be made and documented before implementation. The inventory-asset side
   *must* follow the role: it is the same subsidiary ledger that every later movement (purchase, sale,
   stocktake, permit, return) already posts to after ACC-3/ACC-4. Leaving it on hardcoded `1140` while
   those are mapped would split one stock subsidiary ledger across two GL asset accounts and break the
   invariant `inventory account = Σ(qty × avg_cost)`. The thing the doc reserves is the **equity
   counterparty** `opening_balances` (3130) — that stays a hardcoded code, is not configurable in ACC-5,
   and was not repurposed as a variance account. Result: no half-configurable contract.

2. **Stocktake uses one role for both signs.** Surplus and shortage are the same business cause (a real
   physical count variance); only the sign differs. No `..._gain` / `..._loss` pair was created.

3. **Transfers use `inventory_asset` on both sides.** A cross-branch transfer moves an asset between
   branch dimensions; it is neither an adjustment nor a clearing event. No transfer-clearing role added.

4. **The manual-adjustment role is never derived from free text.** `StockPermit.reason` is a free-form
   operational note (damage, internal consumption, samples). Reading an accounting classification out of
   it would make the posting account depend on typing. A permit always resolves
   `inventory_manual_adjustment`; the *sales return* is the only path that distinguishes damage, and it
   does so from the structured `restock` decision, not from prose.

## Deliberately out of scope (reported, not expanded)

- **`ReturnService::postSalesReturn()` commercial lines** (1110 / 1130 / 2120 / 4110) — sales-side
  commercial accounts, not inventory roles; not named by ACC-5.
- **`5116` purchase-return valuation variance** — not one of ACC-5's approved roles (carried over
  unchanged from ACC-4's report).
- **`InventoryService::ACC_PAYABLE` (2110) and `ACC_OPENING` (3130) counterparties of `receiveStock()`** —
  2110 belongs to the purchases role family already settled in ACC-4, and 3130 is reserved.
- **Fuel vertical** (`FuelSaleService`, `FuelSupplyReceivingService`, `FuelReconciliationService`) — it
  has its own station-level account-override contract and is never mentioned by ACC-5. Because
  `FuelReconciliationService` reads `StocktakeService::INVENTORY_ACCOUNT_CODE` /
  `VARIANCE_ACCOUNT_CODE` as its fallback behind that override, **both public constants were kept**
  (with a comment explaining why) even though `StocktakeService` no longer uses them itself. Breaking
  that contract would have been an out-of-scope change to another vertical.
- **`PartnerService::ACC_OPENING`** — partner AR/AP opening balances, unrelated to inventory.

`InventoryOpeningService::INVENTORY_ACCOUNT_CODE` had no remaining consumer after routing and was
removed rather than left declared as a constant that no longer describes the behaviour.

## Files changed

| File | Change |
|---|---|
| `app/Services/Accounting/InventoryService.php` | `receiveStock()` debit → `inventory_asset`; dead `ACC_INVENTORY` constant removed; docblock updated |
| `app/Services/Accounting/StocktakeService.php` | resolver injected; `buildEntry()` → `inventory_asset` + `inventory_count_variance`; local `accountId()` helper and `Account` import removed; the two public constants kept for the fuel vertical |
| `app/Services/Accounting/StockPermitService.php` | resolver injected; receipt/issue → `inventory_asset` + `inventory_manual_adjustment`; cross-branch transfer → `inventory_asset` both sides; `ACC_*` constants, `accountId()` and `Account` import removed |
| `app/Services/Accounting/ReturnService.php` | `postSalesReturn()` COGS-reversal entry → `inventory_asset` / `inventory_damage_loss` + `cogs`; `ACC_INVENTORY`/`ACC_COGS`/`ACC_DAMAGE` constants removed |
| `app/Services/Accounting/InventoryOpeningService.php` | resolver injected; debit → `inventory_asset`; `3130` kept hardcoded; dead `INVENTORY_ACCOUNT_CODE` removed |
| `tests/Feature/InventoryCogsAccountRoutingTest.php` | **new** — 22 tests, 74 assertions |

No migration, no schema change, no seeder change, no route change, no frontend change.

## Tests

New file `tests/Feature/InventoryCogsAccountRoutingTest.php` — 22 tests covering the doc's required
matrix plus the explicitly requested cross-role independence checks:

| # | Test | Covers |
|---|---|---|
| 1 | `unmapped_sale_cogs_uses_the_legacy_cogs_and_inventory_accounts` | normal sale COGS |
| 2 | `unmapped_stocktake_manual_permit_and_damage_all_use_legacy_5180` | the three roles' shared default |
| 3 | `unmapped_inventory_receipt_debits_the_legacy_inventory_account` | receipt default |
| 4 | `a_mapped_inventory_asset_is_used_by_receipt_sale_cogs_permit_and_stocktake` | mapped `inventory_asset` across all four paths |
| 5 | `a_mapped_cogs_is_used_and_the_product_override_still_wins` | product COGS override precedence |
| 6 | `count_shortage_and_surplus_share_one_role_and_only_the_sign_differs` | role does not switch by sign |
| 7 | `manual_receipt_and_issue_share_one_role_with_signs_preserved` | manual adjustment, both signs |
| 8 | `a_free_text_reason_cannot_switch_the_manual_adjustment_role` | reason text is not a classifier |
| 9 | `a_non_saleable_return_uses_the_damage_role_while_a_restocked_one_uses_inventory_asset` | damage/loss |
| 10 | `mapping_one_variance_role_never_moves_the_other_two` | **explicit cross-role independence** |
| 11 | `the_three_variance_roles_can_point_at_three_different_accounts_at_once` | three distinct custom accounts despite one shared default |
| 12 | `a_same_branch_transfer_still_creates_no_journal_after_routing` | transfer, no-journal case preserved |
| 13 | `a_cross_branch_transfer_uses_one_role_on_both_sides_with_branch_dimensions_preserved` | transfer, branch dimensions |
| 14 | `an_invalid_inventory_asset_mapping_rolls_back_a_stocktake_with_no_journal_or_stock_change` | fail closed, atomic |
| 15 | `an_invalid_manual_adjustment_mapping_rolls_back_a_stock_permit_entirely` | fail closed, atomic |
| 16 | `a_missing_cogs_mapping_fails_closed_without_a_silent_legacy_fallback` | no silent legacy fallback |
| 17 | `tenant_a_inventory_mapping_does_not_leak_into_tenant_b` | **Tenant Isolation** |
| 18 | `remapping_after_posting_never_rewrites_an_existing_inventory_journal` | historical journal immutability |
| 19 | `reversing_an_inventory_journal_uses_the_original_accounts_not_the_current_mapping` | reversal uses concrete original accounts |
| 20 | `opening_equity_stays_on_3130_even_when_inventory_asset_is_remapped` | 3130 not routed |
| 21 | `an_imported_inventory_opening_routes_the_asset_side_only` | opening import path |
| 22 | `routing_changes_no_quantity_no_average_cost_and_no_direction` | valuation/direction untouched |

### Results

| Run | Result |
|---|---|
| `InventoryCogsAccountRoutingTest` — SQLite | **22 passed** (74 assertions) |
| `InventoryCogsAccountRoutingTest` — PostgreSQL 16 | **22 passed** (74 assertions) |
| Targeted regression (`Stocktake\|StockPermit\|Inventory\|Return\|AccountRouting\|Ledger\|Invoice\|Purchase\|Fuel`) — SQLite | 915 passed, 24 failed — **all 24 are the pre-existing `bcmath` failures** |
| Full suite — SQLite | **2,646 passed, 25 failed, 1 skipped** (18,455 assertions) |
| Full suite — PostgreSQL 16 | **2,647 passed, 25 failed** (18,457 assertions) |

### Known pre-existing failures (not caused by this PR)

The 25 failures are identical on both engines (same classes, same counts) and are the environment baseline, unchanged in composition and count:

- **24 × `Fuel*Test`** — `Error: Call to undefined function App\Services\bcmul()`. The `bcmath` PHP
  extension is not installed in this container (`php -m` confirms; `apt-get install php8.4-bcmath` is
  unavailable here). CI installs it, so these pass there.
- **1 × `DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted_and_the_page_limit_fails_closed`** —
  `"ملف PDF تالف أو غير مدعوم."`, a PDF-parsing environment dependency. **Verified pre-existing:** the
  same test fails identically with this PR's changes stashed (base tree), and it touches no accounting
  code.

## Tenant Isolation

`AccountRoleResolver` resolves through `AccountRoleMapping`, a tenant-scoped `BaseModel`, and the account
it returns is fetched under `TenantScope`. Test 17 seeds two tenants, maps `inventory_asset` to a custom
account in tenant A only, posts a stocktake in each, and asserts tenant B still lands on its own legacy
`1140` with no leakage in either direction. No manual query bypasses the scope anywhere in this diff.

## Override precedence (unchanged, re-asserted)

`product.cogs_account_id` → tenant `cogs` mapping → **fail closed** (no legacy fallback). Test 5 asserts
both branches: a plain product uses the tenant mapping, a product carrying an override uses the override
even while the tenant mapping points somewhere else. The sales-account override contract from ACC-3 is
untouched.

## Risks and remaining work

- **Three roles still share one default account (5180).** This is intentional and matches the approved
  contract — a tenant who never maps them sees exactly today's behaviour. The risk is purely
  presentational: an unmapped tenant cannot tell the three apart in a trial balance. Splitting the
  defaults is a chart-of-accounts decision, not a routing one, and was not made here.
- **Fuel vertical is still on the two `StocktakeService` constants.** Its station-level override contract
  means a tenant mapping `inventory_count_variance` does **not** change fuel reconciliation postings.
  This is a real, deliberate inconsistency and belongs to a fuel-scoped follow-up, not to ACC-5.
- **`receiveStock()`'s 2110 counterparty is still a code.** It is only reached by the
  `ProductService::create()` initial-quantity shortcut; `PurchaseService` never uses it. Whether that
  shortcut should credit the purchases role family is an ACC-4-adjacent question left open.
- **No frontend change.** The five roles were already listed and editable in the ACC-2 account-routing
  screen; nothing new needed exposing.

## Branch / PR

- **Base SHA:** `70c80b7d37aab13c3c5c181757ae0db8f3494428`
- **Branch:** `claude/acc-5-inventory-cogs-routing`
- **Implementation commit:** `4f5f65c`
- **PR:** [#687](https://github.com/safwan5001-source/Nebrax/pull/687) — opened, **not merged**, not deployed. No data was reset or deleted.

## Next step

ACC-6 / Fiscal Close was **not** started, as instructed.
