# AWJ Implementation Report — PR-INV-2

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-inv-2`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/671
**Base SHA:** `3e4556c` (main, after PR-SEC-INV-1 / #666, PR-INV-1 / #668, and PR-PRICE-1 / #669 merged)
**Head SHA:** `5aa7c97`

This report supersedes the version delivered before independent review. §16 records the post-review accounting decision (dedicated variance account instead of reusing 5180) and everything above it reflects the final, updated code.

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
  - The journal entry credits 1140 by the **carrying total only**. The **variance** (`commercial − carrying`) posts to a **new, dedicated account, 5116** (see §16 for why this replaced the originally-proposed reuse of 5180): **credit** when commercial > carrying (supplier credited more than carrying value — a gain), **debit** when commercial < carrying (a loss).
  - VAT (1150) and the payable/cash debit (2110/1110) remain at the full commercial total, unaffected by the carrying/commercial split — tax and supplier economics are represented correctly regardless of the valuation divergence, per the contract's explicit requirement.

`app/Services/Accounting/ChartOfAccountsSeeder.php`: new node `5116` under the existing `51` (تكلفة المبيعات / Cost of Sales) group, seeded for every new tenant.

`database/migrations/2026_09_06_010000_add_purchase_return_valuation_variance_account.php` (new): provisions `5116` safely for tenants that existed before this PR.

No change to `postSalesReturn()`, `CreditNoteService` (confirmed by inspection to have zero inventory-movement code — a deliberately separate, purely-financial domain, out of scope), `assertWithinSource()`'s cap logic, the costing architecture (still global moving-average, one `LedgerService::post()` call per return), or account `5180`'s three other existing users (Stocktake, StockPermit, sales-return damage).

## 3. Files changed

| File | Change | Why |
|---|---|---|
| `app/Services/Accounting/ReturnService.php` | `purchaseReturnLineBaseQuantity()` added; `postPurchaseReturn()` rebuilt to issue base quantity at carrying value and post the commercial/carrying variance to the new `5116` account | The one method that generates the purchase-return ledger entry and stock issue — both confirmed problems live here |
| `app/Services/Accounting/ChartOfAccountsSeeder.php` | New `5116` node under group `51` | New tenants get the account from day one |
| `database/migrations/2026_09_06_010000_add_purchase_return_valuation_variance_account.php` (new) | Idempotent per-tenant provisioning of `5116` for existing tenants | Tenants created before this PR must not be left without the account |
| `tests/Feature/PurchaseReturnUomValuationTest.php` (new) | 15 tests covering the full PR-INV-2 acceptance matrix, including the new account's seeding and safe upgrade | Regression coverage for every required invariant |

`ReturnLine`/`ReturnDocument` themselves are unchanged — the UOM fix reads the already-stored `PurchaseLine.unit_factor` via the existing `source_line_id` link; it does not need UOM fields on `ReturnLine` because the source purchase line is the single, immutable source of truth for that conversion.

## 4. Schema / migrations / API contract

**New migration:** `2026_09_06_010000_add_purchase_return_valuation_variance_account.php`. No new table, no column change — a single new `accounts` row per tenant. Pattern (deliberately copied from `2025_01_01_000071_create_employee_custodies.php`, which provisioned account `1160` for existing tenants the same way):

```php
foreach (DB::table('tenants')->select('id')->get() as $tenant) {
    if (DB::table('accounts')->where('tenant_id', $tenant->id)->where('code', '5116')->exists()) {
        continue; // already provisioned — idempotent
    }
    $costOfSalesGroupId = DB::table('accounts')->where('tenant_id', $tenant->id)->where('code', '51')->value('id');
    if (! $costOfSalesGroupId) {
        continue; // tenant missing the expected parent group — skip rather than guess
    }
    DB::table('accounts')->insert([... 'code' => '5116', 'parent_id' => $costOfSalesGroupId, 'is_system' => true, ...]);
}
```

Guarantees:
- **Idempotent** — running the migration twice (or re-running `migrate` on a tenant that already has the account) inserts nothing extra; verified by a test that calls `$migration->up()` twice.
- **Tenant-isolated** — the loop and every lookup are scoped to one `tenant_id` at a time; no cross-tenant write.
- **No historical mutation** — only an `INSERT`. No `UPDATE`/`DELETE` touches `accounts`, `journal_entries`, `journal_lines`, or `account_balances`. Verified by a test that posts a purchase return **before** running the migration (simulating a return that predates `5116`'s existence on that tenant) and confirms its journal entry's line count is unchanged after the migration runs.
- **No reclassification** — a return posted before this PR (whether to `5180` under the originally-proposed design, or under the pre-PR code path with no variance separation at all) is never touched or re-posted. This migration only adds an account; it does not walk `journal_lines` looking for anything to move.
- **`down()` intentionally leaves the account in place** — same policy as `1160`'s migration — because it may already be referenced by journal lines by the time anyone rolls back.

No API contract change: no new/changed request or response shape on any endpoint.

## 5. Security / Tenant / Branch / Warehouse evidence

- No new endpoint or permission surface; `ReturnController`'s existing RBAC/tenant-scoped path is unchanged.
- `PurchaseLine::whereIn('id', $sourceLineIds)->get()` is a raw ID lookup, but every such line is reached only via a `source_line_id` that was itself validated against a tenant-resolved `Purchase` at `create()`/`post()` time (`resolveSource()`, `BranchScope::reference()`), so no cross-tenant leak is introduced.
- `ReturnService::accountId('5116')` resolves through `Account::where('code', $code)->first()`, which is automatically tenant-scoped by `Account`'s `BaseModel`/`TenantScope` — identical lookup mechanism already used for every other account constant in this file (`1140`, `1150`, `2110`, ...). No new lookup pattern introduced.
- The migration's own account lookups are tenant-scoped explicitly (`where('tenant_id', $tenant->id)`) since they run outside a model/scope context, matching `2025_01_01_000071`'s precedent exactly.
- Warehouse-level negative-stock enforcement is preserved unchanged: `applyIssue(..., 'enforce_stock' => true, 'warehouse_id' => $return->warehouse_id, ...)`, verified by `a_return_exceeding_the_specific_warehouse_stock_is_rejected_when_negative_stock_is_disabled`.
- Atomicity/double-post safety unchanged: `post()`'s existing `DB::transaction()` + `lockForUpdate()` + in-transaction re-run of `assertWithinSource()` still guards against two drafts consuming the same remaining quantity — verified by `two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity`, and rollback-on-rejection by `a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation`.

## 6. Accounting / Inventory reconciliation

**Journal entry — purchase return (final design):**

| Account | Debit | Credit | Note |
|---|---|---|---|
| 2110 الموردون (or 1110 الصندوق for cash) | Full commercial total (net + tax) | | Unchanged — full commercial value, as before |
| 1140 المخزون | | **Carrying value only** (Σ base quantity × current `avg_cost`) | Not the commercial `unit_price` |
| 5150 مصروفات (non-tracked lines) | | Commercial value of non-tracked items | Unchanged |
| 1150 ضريبة المدخلات | | Full tax | Unaffected by the valuation split |
| **5116 فروق تقييم مردودات المشتريات (new)** | If carrying > commercial (loss) | If commercial > carrying (gain) | **Never 5180** |

**Before → after this PR, on the same 3 example scenarios:**

| Scenario (2 units, tax=0) | 1140 before this PR | 1140 after | Variance account before | Variance account after |
|---|---|---|---|---|
| commercial 5000 = carrying 5000 | credit 10000 (commercial) | credit 10000 (carrying — same here, no divergence) | — | — |
| commercial 6000 > carrying 5000 | credit 12000 (commercial — **wrong**, overstates the stock exit) | credit 10000 (carrying) | — (bug: no variance ever separated) | **5116 credit 2000** |
| commercial 4000 < carrying 5000 | credit 8000 (commercial — **wrong**, understates the stock exit) | credit 10000 (carrying) | — | **5116 debit 2000** |

**Verified example** (`the_1140_delta_exactly_equals_the_subledger_delta_despite_a_commercial_divergence`): two purchase batches (10×4000, then 10×6000) blend `avg_cost` to 5000; a 3-unit return referencing the second batch's line at its original commercial price 6000 (deliberate divergence). Measured directly, in halalas:

- `Δ subledger = Δ(quantity_on_hand × avg_cost) = -15000` (3 × 5000)
- `Δ 1140 (GL) = -15000` — **exactly equal**, asserted via `assertSame($subledgerDelta, $glDelta, ...)`.

**Tax-isolation example** (`a_tax_bearing_return_keeps_tax_separate_from_the_carrying_value_variance`): 2 units, commercial 6000/unit vs. carrying 5000/unit, 15% tax → subtotal 12000, tax 1800, total 13800. Journal: 2110 debit 13800; 1150 credit 1800; 1140 credit 10000 (carrying only); **5116 credit 2000** (variance) — `Σdebit = Σcredit = 13800`; the test additionally asserts `$this->line($entry, '5180')` is `null` — **no line on 5180 at all** in this entry.

**5180 isolation:** every variance-direction test now asserts `bal('5180') === 0` (or, for the entry-level checks, `assertNull($this->line($entry, '5180'))`) alongside the `5116` assertion, so a future regression that accidentally routes this variance back to `5180` fails immediately. `StocktakeTest` and `StockPermitTest` (5180's other three producers) were re-run in the same session (§9) and remain green, confirming those flows are untouched.

## 7. UOM / historical semantics

- `returning_one_carton_removes_twenty_four_base_units_not_one`: a 1-carton (factor 24) purchase, returned as "1 carton," now removes exactly 24 base units and credits 1140 by 24 × the per-unit carrying cost — not 1 unit as before the fix.
- `changing_the_unit_template_after_the_purchase_does_not_alter_the_historical_return`: the `UnitTemplate`'s `carton` factor is changed from 24 to 12 **after** the original purchase but **before** the return is posted. The return still resolves 24 base units, because the conversion reads the immutable `unit_factor` snapshot on the original `PurchaseLine`, never the live `UnitTemplate`/`UnitTemplateUnit` state.

## 8. Concurrency / idempotency

Unchanged transaction/locking structure for the return-posting path, exercised by:

- `two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity`.
- `a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation`.

**Account provisioning idempotency** (new, per the review's requirement): `an_existing_tenant_predating_this_pr_receives_the_account_safely_without_duplicates_or_historical_changes` calls the migration's `up()` twice in the same test and asserts the `5116` row count for that tenant stays at exactly 1 both times, and that the tenant's total account count only grew by 1 overall.

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=PurchaseReturnUomValuationTest` | **15 passed** (82 assertions) | Full PR-INV-2 acceptance matrix, including the two new account-provisioning tests (§9a) |
| `php artisan test --filter="ReturnTest\|ReturnWithProductTest\|ReturnFromSourceTest\|ReturnRestockPolicyTest\|ReturnWindowPolicyTest\|ReturnTypeFilterTest\|PurchaseReturnUomValuationTest\|PurchaseTest\|PurchaseServiceTest\|InventoryServiceTest\|InvoiceTest\|StocktakeTest\|StockPermitTest"` | **198 passed** (963 assertions) | Added `StocktakeTest`/`StockPermitTest` (5180's other producers) to this run specifically to prove they're unaffected by the account split — zero regressions |
| `php artisan test` (full suite, SQLite) | **2438 passed, 1 skipped, 25 failed** | All 25 failures pre-existing and unrelated — identical set/count to the `PR-SEC-INV-1`/`PR-INV-1`/`PR-PRICE-1` baseline: 24 `Fuel*` tests on missing `ext-bcmath` in this sandbox, 1 `DocumentCenterSecureIntakeTest` PDF-fixture issue. Passed count rose 2436→2438 with the 2 new account-provisioning tests. |

### 9a. Acceptance matrix coverage (from the contract + review requirements)

| Requirement | Test |
|---|---|
| Base-unit return removes exact quantity | `a_base_unit_purchase_return_removes_the_exact_base_quantity` |
| Alt-UOM (carton, factor 24) return removes correct base quantity | `returning_one_carton_removes_twenty_four_base_units_not_one` |
| Historical `unit_factor` immune to a later `UnitTemplate` change | `changing_the_unit_template_after_the_purchase_does_not_alter_the_historical_return` |
| Cumulative-remaining-quantity cap | `partial_returns_are_capped_by_the_cumulative_remaining_quantity`, `the_exact_remaining_quantity_after_a_partial_return_is_accepted` |
| Guard re-checked inside the posting transaction | `two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity` |
| Warehouse negative-stock policy enforced | `a_return_exceeding_the_specific_warehouse_stock_is_rejected_when_negative_stock_is_disabled` |
| **1. commercial = carrying → no variance** | `commercial_value_equal_to_carrying_value_posts_no_variance` (asserts `5116` and `5180` both 0) |
| **2. commercial > carrying → correct direction on the new account** | `commercial_value_above_carrying_value_credits_the_variance_account` (`5116` credit 2000) |
| **3. commercial < carrying → opposite direction** | `commercial_value_below_carrying_value_debits_the_variance_account` (`5116` debit 2000) |
| **4. VAT never enters the valuation variance** | `a_tax_bearing_return_keeps_tax_separate_from_the_carrying_value_variance` |
| **5. Δ1140 = Δ inventory subledger exactly** | `the_1140_delta_exactly_equals_the_subledger_delta_despite_a_commercial_divergence` |
| **6. 5180 is never used for this variance** | Explicit `assertSame(0, $this->bal('5180'), ...)` / `assertNull($this->line($entry, '5180'), ...)` added to every variance-direction test and the base/equal-value test |
| **7. New tenant has the account** | `a_new_tenant_is_seeded_with_the_purchase_return_valuation_variance_account` |
| **8. Existing tenant upgrade is safe, idempotent, non-historical** | `an_existing_tenant_predating_this_pr_receives_the_account_safely_without_duplicates_or_historical_changes` |
| **9. SQLite + PostgreSQL CI** | See §11 — not run in this sandbox; migration uses only portable `DB::table`/`Str::uuid()` calls, no DB-specific SQL |
| Posting atomic; rejected post leaves no partial mutation | `a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation` |

## 10. Build / Lint / Typecheck

No `web/` changes. `vendor/bin/pint --test` compared pre-edit vs. post-edit via `git stash` for every touched file:

- `ReturnService.php`: identical fixer list before and after (`class_attributes_separation`, `concat_space`, `unary_operator_spaces`, `braces_position`, `not_operator_with_successor_space`, `single_line_empty_body`, `ordered_imports`, `binary_operator_spaces`, `phpdoc_align`) — zero new violations.
- `ChartOfAccountsSeeder.php`: identical single pre-existing fixer (`binary_operator_spaces`) before and after — zero new violations.
- `2026_09_06_010000_add_purchase_return_valuation_variance_account.php` (new file): Pint reports it clean.

This repository's CI (`ci.yml`) does not gate on Pint.

## 11. CI

Not polled from this session before opening the PR. `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite only (no PostgreSQL available in this sandbox). The new migration and the account lookup in `ReturnService::accountId()` use only portable `DB::table()`/query-builder calls and `Illuminate\Support\Str::uuid()` — no raw DB-specific SQL — so no PostgreSQL-specific divergence is expected but was not directly observed.

## 12. Deviations from approved plan

None from the contract. One from the **first delivery of this PR**, corrected per independent review before merge (see §16): the commercial/carrying variance was originally posted to the existing `5180` (فروق الجرد والتلف) account; review determined this is a pure valuation difference, not a physical inventory/damage discrepancy, and required a dedicated account instead. That correction is documented in full in §16 and is the only change since the first version of this PR.

Everything else matches the contract exactly: both confirmed problems shipped together; no new costing method; no per-warehouse average cost; no broader Purchase UX redesign; no Serial/Lot batch selection; no Account Mapping framework built (only a code comment noting the future semantic key, per the review's explicit instruction not to build that framework now).

## 13. Risks / remaining work

- PostgreSQL leg of CI not run locally in this session; only SQLite validated directly.
- `ReturnLine` still has no `unit_name`/`unit_factor` columns of its own — the fix resolves the conversion via the linked source `PurchaseLine` at post time. A purchase return created without a `source_line_id` falls back to treating `ReturnLine.quantity` as already being in base units — unchanged pre-existing behavior for that unlinked case, not a gap introduced or left open by this PR.
- Any purchase return already posted to `5180` under a build of this PR prior to the review's correction exists only in this session's local test runs — no such data was ever pushed to `main` or exists in any real tenant, since the PR has not merged. There is nothing on `main` to migrate away from.

## 14. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#671`) is open for review; no auto-merge is configured. Awaiting review per the program's transition gate.

## 15. Next step

Review of this updated report and the PR diff (#671). Per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`, the next Phase 1 task in sequence (`PR-INV-3`, if any) should not be started before this review, per program governance.

## 16. Post-review accounting decision — dedicated 5116 account instead of reusing 5180

**Finding from independent review:** the gap between a purchase return's supplier commercial value and the inventory's carrying value is a **valuation difference**, not a physical stocktake/damage discrepancy. Posting it to `5180` (فروق الجرد والتلف — reserved for `StocktakeService`, `StockPermitService`, and sales-return-damage postings, all of which represent an actual physical count/condition difference) would have mixed two economically distinct concepts under one account, degrading that account's meaning for anyone reading the ledger.

**Decision:** a new, dedicated system account:

| | |
|---|---|
| Code | **5116** |
| Arabic name | فروق تقييم مردودات المشتريات |
| English name | Purchase Return Valuation Variance |
| Type / normal balance | expense / debit |
| Parent | `51` تكلفة المبيعات (Cost of Sales) |

**Why code 5116, not another number:** inspected the full `ChartOfAccountsSeeder::$tree`. Group `51` (Cost of Sales) currently holds `5110` (COGS) and `5115` (Purchase Returns & Allowances — the account that already carries the *purely commercial* side of purchase-return/credit-note economics, per `CreditNoteService::ACC_ALLOWANCE`). `5116` is:
- **Unused** — confirmed by reading the seeder tree and grepping the whole codebase for the literal string `'5116'` before adding it (zero prior references).
- **Structurally consistent** — a direct sibling of `5115`, both children of `51`, and both concerned with purchase-return economics; `5116` is the immediately-next code in that neighborhood, keeping related accounts visually grouped in the chart.
- **Distinct in meaning from every neighbor** — not reused from `5180` (physical inventory variance, wrong domain), not `5115` (that account is the *commercial* supplier-allowance side, used by the separate `CreditNoteService` domain which explicitly does not touch inventory; `5116` is specifically the *inventory-valuation* side of a purchase return that does move stock — the two are complementary, not duplicates), and not any of `5150`/`5170`/`5160` (general expense, rounding, depreciation — unrelated purposes).

No existing account's code was reused and no existing account's meaning was changed — `5115` and `5180` behave exactly as they did before this PR.

**New tenants:** `ChartOfAccountsSeeder::$tree` gained the `5116` node (§2, §3).

**Existing tenants:** new migration `2026_09_06_010000_add_purchase_return_valuation_variance_account.php`, modeled directly on `2025_01_01_000071_create_employee_custodies.php` (the migration that provisioned account `1160` for existing tenants), preserving:
- **Tenant isolation** — every read/write scoped to one `tenant_id` at a time.
- **Backward compatibility** — a tenant somehow missing the `51` parent group is skipped, not force-created into an inconsistent shape.
- **No duplicates on re-run** — checked by existence before insert; verified by calling `up()` twice in a test.
- **No historical mutation, no reclassification** — pure `INSERT`, never touches `journal_entries`/`journal_lines`/`account_balances` or reassigns any existing posting; verified by a test that posts a return before running the migration and confirms its journal entry is byte-for-byte the same afterward.

**Preparing for the future Account Mapping feature, without building it now:** per the explicit instruction, no mapping framework was introduced in this PR. The only accommodation made is a comment directly above the account constant in `ReturnService.php`:

```php
// PURCHASE_RETURN_VALUATION_VARIANCE (المعنى المحاسبي المستقبلي لميزة Account
// Mapping القادمة): فرقٌ تقييمي بحت — اعتماد المورّد التجاري مقابل القيمة
// الدفترية الفعلية المُزالة من 1140 — لا فرق جردٍ أو تلفٍ فلا يُستخدم 5180 له.
private const ACC_PURCHASE_RETURN_VALUATION_VARIANCE = '5116';
```

This follows the exact pattern every other account constant in this file already uses (`ACC_INVENTORY = '1140'`, `ACC_DAMAGE = '5180'`, etc.) — the code always speaks through a named constant carrying the accounting *purpose*, never a bare literal `'5116'` in the posting logic itself. That separation is the file's existing architecture, not a new abstraction introduced for this PR, and it is exactly what will let a future Account Mapping feature swap in a per-tenant-configurable code behind the same purpose key without touching `postPurchaseReturn()`'s logic. No such framework — no mapping table, no resolver service, no settings UI — was built now.

**Verification that 5180 is untouched:** every existing 5180 consumer (`StocktakeTest`, `StockPermitTest`, and the sales-return-damage tests inside `ReturnRestockPolicyTest`) was re-run in this session (§9) and remains fully green, with no code change to any of `StocktakeService`, `StockPermitService`, or `ReturnService::postSalesReturn()`.
