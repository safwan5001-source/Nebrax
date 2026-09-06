# AWJ Implementation Report — PR-PRICE-1

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-price-1`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/669
**Base SHA:** `f7ae6ed` (main, after PR-SEC-INV-1 / #666 and PR-INV-1 / #668 merged)
**Head SHA:** `4a4b499`

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-PRICE-1.md` only — the third Phase 1 hardening gate of the Products & Inventory program. No other program task was started.

Confirmed problem (contract + audit §7): `InvoiceService::applyItemsAndTotals()` judged each line's minimum-sale-price floor against its net amount *before* the invoice-level (header) discount was known. The header discount is computed and applied only *after* the per-line loop, as a pure aggregate adjustment to `subtotal`/`tax_amount`/`total` — never allocated to individual lines, and never re-fed into the floor check. A line priced above the floor at line level could end up sold below `min_sale_price` once the header discount reduced its real economics, bypassing the authorized-override path entirely.

## 2. Scope implemented

`InvoiceService::applyItemsAndTotals()` restructured into two passes:

1. **Pass 1** — compute each line's own economics exactly as before (unit price, line-level discount, tax-inclusive/exclusive mode, relative/fractional-line precision handling) and accumulate the invoice `$subtotal`/`$taxTotal`. No database write yet, no minimum-price decision yet.
2. **Header discount computed and allocated** — `applyDiscount()` (unchanged) computes the header discount from the accumulated subtotal; a new `allocateHeaderDiscountToLines()` distributes it across lines using the **largest-remainder method**: each line's share differs from its exact proportional share by less than one halala, and the shares sum to the header discount exactly.
3. **Pass 2** — for each line, `effectiveLineNet = lineNet - headerShare`; `minimumPriceDecision()` (unchanged logic, unchanged `sales.minimum_price_override` permission check) now evaluates this final number before the `InvoiceLine` row is created with the exact same stored fields as before.

No stored value changes for any invoice that doesn't have both a header discount and a product with `min_sale_price` in play — line totals, tax, rounding, and the audit columns (`min_sale_price_snapshot`, `min_sale_price_override_reason`, `min_sale_price_overridden_by`) are computed identically to before in every other case.

POS and the invoice API share this one method (`PosService::checkout()` → `InvoiceService::create()`), so the fix is automatically effective for both.

## 3. Files changed

| File | Change | Why |
|---|---|---|
| `app/Services/Accounting/InvoiceService.php` | `applyItemsAndTotals()` split into two passes; new `allocateHeaderDiscountToLines()`; `minimumPriceDecision()` docblock clarified | Centralizes the fix in the one authoritative pricing path shared by invoice API and POS |
| `tests/Feature/MinimumSalePriceHeaderDiscountTest.php` (new) | 15 tests covering the full contract acceptance matrix | Regression coverage for every required scenario |

`tests/Feature/MinimumSalePriceGuardTest.php` (pre-existing) is untouched and green — covers the base policy toggle, owner override, accountant rejection, and POS/API parity without a header discount in play.

## 4. Schema / migrations / API contract

None. No migration, no new endpoint, no request/response shape change. Behavior change: a line + header discount combination that pushes a line's *effective* price below `min_sale_price` now requires the existing override (reason + `sales.minimum_price_override`-permitted actor) — previously it could silently pass whenever the raw line price alone cleared the floor.

## 5. Security / Tenant / Branch / Warehouse evidence

Not a distinct surface for this PR — the change is confined to the sales-pricing decision inside `InvoiceService`, which already runs under existing tenant-scoped writes (`Invoice`/`InvoiceLine` under `BaseModel`/`TenantScope`, unchanged). No new endpoint or permission surface beyond the pre-existing `sales.minimum_price_override`, which is re-verified below (unchanged, live-checked, not inferred from a broader "manage" permission).

## 6. Accounting / Inventory reconciliation

Not applicable to inventory/GL — this PR is a sales-pricing validation only. It does not touch `LedgerService`, COGS, moving-average costing, or journal entry generation. Per the contract's own acceptance-matrix row: "sales economics only; no inventory valuation change" — confirmed by:
- `InvoiceTest`, `ApiInvoiceTest`, `InvoiceCostCenterAllocationTest`, `ZatcaTest` all passing unmodified (§9).
- `header_discount_totals_remain_unchanged_by_the_new_two_pass_computation` explicitly asserts the invoice subtotal/discount/tax/total math is bit-for-bit identical to the pre-existing `InvoiceTest::an_invoice_discount_reduces_the_taxable_base_and_totals` baseline (subtotal 100000, discount 20000, tax_amount 12000, total 92000 in halalas).

## 7. UOM / historical semantics

No change to quantity conversion or UOM pricing. The relative/fractional-line path (`InvoiceLinePrecision`) and the invariant "price is never derived from the UOM quantity factor" are untouched — the header-discount share is a pure monetary subtraction applied identically regardless of precision mode. `InvoiceLinePrecisionTest` (unmodified) is green.

## 8. Concurrency / idempotency

No new locking or transaction logic. The check still runs entirely inside the existing single `DB::transaction()` in `create()`/`update()`. A permission revoked between a client's draft calculation and the authoritative save is caught live — `User::hasPermission()` reads `Rbac::resolve()` fresh with no caching — verified by `a_permission_revoked_before_the_authoritative_save_is_rejected_live_not_from_a_stale_check` (grants `sales.minimum_price_override` to a custom role, uses it, revokes it, then confirms the very next `create()` call rejects).

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=MinimumSalePriceHeaderDiscountTest` | **15 passed** (46 assertions) | New PR-PRICE-1 acceptance matrix (§9a below) |
| `php artisan test --filter="MinimumSalePriceGuardTest\|MinimumSalePriceHeaderDiscountTest\|InvoiceTest\|ApiInvoiceTest\|InvoiceCostCenterAllocationTest\|InvoiceInventoryApiTest\|InvoiceLinePrecisionTest\|DeliveryNoteInvoiceDraftBuilderTest\|InvoiceTemplateOverrideTest\|PosSessionTest\|PosReturnTest\|PosReturnUomTest\|PosReturnExchangeIdempotencyTest\|PosHeldSaleTest\|PosCheckoutTest\|SalesReportTest\|SalesSettingsTest\|SalesConfigTest\|ZatcaTest"` | **247 passed** (2122 assertions) | Every existing invoice/POS/pricing/ZATCA suite — zero regressions |
| `php artisan test` (full suite, SQLite) | **2423 passed, 1 skipped, 25 failed** | All 25 failures pre-existing and unrelated — identical set/count to the `PR-SEC-INV-1`/`PR-INV-1` baseline: 24 `Fuel*` tests on missing `ext-bcmath` in this sandbox, 1 `DocumentCenterSecureIntakeTest` PDF-fixture issue. Passed count rose 2408→2423 with the 15 new tests. |

### 9a. Acceptance matrix coverage (from the contract)

| Contract requirement | Test |
|---|---|
| Raw line above floor + header discount pushes below → reject without override | `a_header_discount_that_pushes_an_otherwise_valid_line_below_the_floor_is_rejected` |
| Line discount alone below → reject | `a_line_discount_alone_below_the_floor_is_rejected` |
| Combined discounts below → reject | `combined_line_and_header_discounts_below_the_floor_are_rejected` |
| Effective price exactly floor → accept | `an_effective_price_exactly_at_the_floor_after_header_discount_is_accepted` |
| Above floor → accept | `an_effective_price_above_the_floor_after_header_discount_is_accepted` |
| Authorized override → accept through existing controlled path | `an_authorized_override_accepts_a_line_pushed_below_the_floor_by_header_discount` |
| Unauthorized override flag/input → reject | `an_unauthorized_actor_cannot_override_even_with_a_reason_when_header_discount_causes_the_violation` |
| Multi-line header allocation catches only violating line(s) deterministically | `multi_line_header_discount_allocation_flags_only_the_violating_line` (accepts, per-item reason on only the violating line) + `multi_line_header_discount_rejects_when_the_violating_line_lacks_its_own_override_reason` (same numbers, rejects without it) |
| POS/API produce same authoritative result | Structural: `PosService::checkout()` calls `InvoiceService::create()` directly (verified by reading the code — no separate pricing/floor logic in POS). Regression-checked via unmodified `MinimumSalePriceGuardTest::point_of_sale_uses_the_same_minimum_price_guard` and the full POS suite. POS's checkout request contract has no header-level discount field (only per-item `discount`), so there is no POS-specific header-discount scenario to construct independently of the shared code path — this is stated explicitly, not silently assumed. |
| Tax and rounding cases cannot create a hidden bypass | `header_discount_allocation_is_based_on_pretax_net_regardless_of_line_tax_rates` (equal net, 15% vs 0% tax ⇒ equal header share and equal outcome), `tax_inclusive_pricing_with_a_header_discount_still_evaluates_the_pretax_floor` + `tax_inclusive_pricing_with_a_header_discount_that_crosses_the_floor_is_rejected` |
| Free/100% discount edge case | `a_full_header_discount_that_zeroes_the_line_is_rejected_without_override` |
| Override revoked between draft/client calculation and authoritative save/post | `a_permission_revoked_before_the_authoritative_save_is_rejected_live_not_from_a_stale_check` |

## 10. Build / Lint / Typecheck

No `web/` changes. `vendor/bin/pint --test` on `InvoiceService.php` reports pre-existing style deviations, verified identical via `git stash` against the pre-edit version of the file (same pattern as the prior two PRs in this program). This repository's CI (`ci.yml`) does not gate on Pint.

## 11. CI

Not polled from this session before opening the PR. `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite only. The new allocation logic (`allocateHeaderDiscountToLines`) uses only integer arithmetic (`intdiv`, `%`, `arsort` for tie-breaking) with no DB-specific SQL, so no PostgreSQL-specific divergence is expected but was not directly observed.

## 12. Deviations from approved plan

None. Scope matches the contract exactly:
- The fix lives entirely inside the one authoritative pricing path (`InvoiceService::applyItemsAndTotals()`), already shared by the invoice API and POS — no new pricing engine, no controller-level duplication.
- No tier pricing, no promotion engine, no change to quantity/UOM conversion, no change to inventory valuation/COGS.
- The existing `sales.minimum_price_override` permission model is reused unchanged — not reinferred from a broader `invoices.manage`/`products.manage` permission.
- Deterministic rounding chosen explicitly (largest-remainder method) over the codebase's other existing "last item absorbs the remainder" convention (used for cost-center allocation), because the latter can assign a disproportionate rounding remainder to a small-value line when discount is spread across many lines — a real correctness risk for a compliance gate, not a style preference. This is a considered design decision within the contract's explicit requirement for "deterministic allocation/rounding," not a deviation from it.

## 13. Risks / remaining work

- PostgreSQL leg of CI not run locally in this session; only SQLite validated directly (same caveat as the prior two PRs in this program).
- Quotes (`QuoteService`) have no minimum-price enforcement at all, before or after this PR. Confirmed out of scope: quotes are non-binding, and the contract's confirmed problem is specifically the invoice path with header discount. Not flagged as a gap requiring a decision — simply noting it was checked and found unrelated.

## 14. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#669`) is open for review; no auto-merge is configured. Awaiting review per the program's transition gate.

## 15. Next step

Review of this report and the PR diff (#669). Per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`, `PR-INV-2` (Purchase Return UOM/base quantity + valuation/GL reconciliation) is next in the Phase 1 sequence. Do not start it before this review, per program governance.

## 16. Post-review verification — `$money` keep-when-absent behavior (no code change)

**Question raised:** the restructured `applyItemsAndTotals()` relocates the `$money` closure (`array_key_exists($key, $data) ? $data[$key] : $current` — absent key keeps the invoice's current `discount`/`shipping`/`adjustment` value on `update()`, present key replaces it) to before the line loop. Was this "keep on absent" behavior already in place on `main` before this PR, or is it a new behavioral change introduced by PR-PRICE-1?

**Verification method:** `git diff f7ae6ed..HEAD -- app/Services/Accounting/InvoiceService.php`, isolating every line touching `$money`.

**Finding — pure relocation, zero behavioral change:**

- The closure definition line — `$money = fn (string $key, $current) => (int) (array_key_exists($key, $data) ? $data[$key] : $current);` — is **byte-for-byte identical** between the pre-PR position (after the line loop) and the post-PR position (before the line loop, but still after Pass 1 has accumulated `$subtotal`/`$taxTotal`). Confirmed via `git diff --word-diff` on the relevant hunks: the red (removed) and green (added) text of this line and its explanatory comment are character-identical, only their line position changed.
- The `discount` computation — `[$discount, $goodsVat] = $this->applyDiscount($subtotal, $taxTotal, $money('discount', $invoice->discount));` — is likewise byte-for-byte identical, moved for the same reason (the header discount and its per-line allocation must be known before Pass 2's minimum-price check, which is the entire point of this PR).
- The `shipping` and `adjustment` computations — `$shipping = max(0, $money('shipping', $invoice->shipping));` and `$adjustment = $money('adjustment', $invoice->adjustment);` — were **not moved at all**. They remain at their original position, after all `InvoiceLine` rows are created, exactly as on `main` at `f7ae6ed`. `$money` is a PHP closure capturing `$data` by value at definition time; moving its *definition* earlier in the same method body has no effect on what it captures or how it behaves when called later for `shipping`/`adjustment` — `$data` is the same array either way.
- `git show f7ae6ed:app/Services/Accounting/InvoiceService.php` confirms this exact closure and all three call sites (`discount`, `shipping`, `adjustment`) already existed verbatim on `main` before this PR, predating even `PR-PRICE-1`.

**Conclusion:** the "absent key keeps the invoice's current value on `update()`" behavior for `discount`, `shipping`, and `adjustment` is pre-existing production behavior on `main`, unrelated to and unchanged by PR-PRICE-1. Relocating the closure and the `discount` line earlier in the method was necessary for the fix itself (the header discount must be computed before Pass 2 can allocate it per line and evaluate the floor) and introduces no new behavior. Per the review instruction: since this is confirmed as relocation only, **no code change was made** — this section is the requested evidence. The PR's actual fix (splitting the method into two passes so the minimum-price check sees the line's economics after header-discount allocation) is unaffected and remains scoped exactly to the contract.

No source file changed in this update — only this report, to record the verification. Head SHA below reflects this documentation-only commit.
