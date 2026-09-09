# PR-COM-4A — Commerce Price Resolution — Implementation Report

## 1. Executive Summary

Adds `App\Services\Commerce\CommercePriceResolver` + `ResolvedCommercePrice`,
a read-only Commerce-facing price resolution boundary that composes AWJ's
existing, already-verified pricing infrastructure
(`PriceListService`/`PosCustomerPriceListResolver`/`UnitConversion`/
`Product.sale_price`) — no new price truth, no persistence, no tax
calculation, no promotion engine. The precedence implemented is not
invented: it is the exact precedence `PosCustomerPriceListResolver::posPriceFor()`
already implements and `PosService::checkout()` already enforces in
production. `InvoiceService` remains the sole financial-calculation
authority; this resolver never touches it.

## 2. Base SHA / Head SHA

- **Base SHA:** `8d67d2e4cc34440b1e4f2d54a89452efb4349a6e` (`origin/main` at
  task start — PR-COM-3's merge commit, confirmed via `git fetch origin main`
  + `git log --oneline -5 origin/main` before branching; matches the SHA
  given in the task).
- **Head SHA (before this report):** `64c1c32b5a840d68a6bfa9cc4305205e25f6eb40`.

## 3. Binding sources

Read (targeted): `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`'s PR-COM-4A
section (`# PHASE 4 — Pricing and commercial snapshot`, reproduced and
applied field-by-field below — this is the primary binding contract),
`PR-COM-3-IMPLEMENTATION-REPORT.md`, `app/Support/CommerceBoundary.php`.
No dedicated pricing ADR exists (unlike ADR-02/ADR-03 for reservation/
channel) — the master plan's own text plus direct code inspection (§4)
governs this PR. No re-audit of the Existing Architecture Audit or Evidence
Passes beyond what the master plan itself cites — the task explicitly
required verifying the *actual current code* rather than trusting prior
research summaries (§3/§4 of the task), so this report leans almost
entirely on direct code reads, cited by file and line where it matters.

## 4. AWJ VERIFIED pricing architecture

Verified directly from the code, not assumed from prior research summaries
(per the task's explicit instruction — §3/§4):

- **`PriceListService::resolve(PriceList $priceList, Product $product, ?string $unitName): ?int`**
  (`app/Services/PriceListService.php:24`) — throws if the price list is
  inactive; normalizes the unit via `UnitConversion::resolve()`; returns
  the matching `PriceListItem.price` (halalas) or `null` if no item
  exists for that exact `(product, unit)` pair. **`null` is a real,
  distinct outcome from `0`** — confirmed by the code returning
  `$item ? (int) $item->price : null`, never coalescing to zero itself.
- **`PriceList`/`PriceListItem`** (`app/Models/PriceList.php`,
  `PriceListItem.php`): `PriceList` is explicitly documented as
  "قائمة أسعار يختارها موظف المبيعات يدوياً في مسودة الفاتورة... القيمة
  النهائية تبقى لقطة في سطر الفاتورة" — a *manual, advisory* selection in
  the existing invoice-drafting UI, not an automatically-applied pricing
  engine for regular invoices. **No currency column exists anywhere** on
  `PriceList` or `PriceListItem` — confirmed by reading both models and
  their migrations directly.
- **`Partner.default_price_list_id`** (`app/Models/Partner.php`) — its own
  relation doc-comment: "العملاء قد يجعلونها اقتراحهم الافتراضي عند بدء
  فاتورة جديدة" (customers may make it their *suggested* default when
  starting a new invoice) — confirmed **advisory, not authoritative**,
  exactly as prior research claimed, but verified here directly rather
  than assumed.
- **`PosCustomerPriceListResolver`** (`app/Services/Accounting/PosCustomerPriceListResolver.php`)
  is the actual, tested, production-enforced precedence authority for POS:
  - `forPartner(?string $partnerId): ?PriceList` — returns the partner's
    `default_price_list_id` list **only if** `PosSettings::appliesCustomerPriceList()`
    is true (a POS-specific settings-group toggle), the partner exists,
    has a `default_price_list_id`, and that list `is_active` — otherwise
    `null`. This is the exact validation the task told me to reuse rather
    than trust `Partner.default_price_list_id` directly (§11 of the task).
  - `priceFor()` — `PriceListItem` price if resolvable, else
    `Product.sale_price` — but does **not** distinguish base vs. alternate
    unit, so it is a *looser*, catalog-display-oriented helper.
  - `posPriceFor()` — the **stricter, checkout-authoritative** variant:
    for the base unit, same as `priceFor()`; for an **alternate unit**, it
    returns the `PriceListItem` price *only* — never falls back to
    `Product.sale_price` — with the explicit code comment "لا نشتق سعر
    عبوة من معامل التحويل" (never derive a package price from the
    conversion factor).
  - **Confirmed by tracing the actual call site**:
    `PosService.php:494` calls `posPriceFor()` (not `priceFor()`) to
    compute the *expected* price and reject checkout if the client's
    submitted `unit_price` doesn't match exactly — this is the real,
    live, financially-consequential precedence, not `priceFor()`'s looser
    catalog-browsing variant.
- **`InvoiceService::applyItemsAndTotals()`** (`app/Services/Accounting/InvoiceService.php:482`)
  reads `unit_price` **directly from the caller-supplied `$items` array**
  (`$unitPrice = (int) ($item['unit_price'] ?? 0);`, line 498) — it does
  **not** itself resolve a price from any `PriceList` or `Product`. This
  confirms the task's premise exactly: `InvoiceService` is a pure
  financial-calculation authority operating on an *already-resolved*
  price; resolution happens entirely outside it (manually in the UI for
  regular invoices, or via `PosCustomerPriceListResolver` for POS).
- **`min_sale_price` enforcement** (`InvoiceService::minimumPriceDecision()`,
  line 709) is gated by `Settings::get('sales', 'enforce_min_sale_price')`
  **and** `Product.min_sale_price > 0` — a floor enforced only at actual
  invoice posting, with an authorized-override path (reason + actor). This
  is a **guard**, not a pricing source.
- **Currency**: `Tenant.currency` (`app/Models/Tenant.php`, default
  `'SAR'`) is the only real currency context anywhere in the pricing path
  — confirmed no `PriceList`/`PriceListItem`/`Product` pricing column
  carries its own currency. The system is single-currency per tenant.
- **UOM**: `UnitConversion::resolve(?Product, ?string $unitName): array{0: ?string, 1: int}`
  (`app/Services/Accounting/UnitConversion.php`) is the single existing
  authority — `null`/empty unit name → base unit, factor `1`; a genuine
  alternate unit name is validated against the product's `UnitTemplate`
  and **throws `RuntimeException`** for an unknown unit or a product with
  no template. `PriceListService::resolve()` already calls this
  internally; this PR's resolver also calls it directly and
  unconditionally (§14) so an invalid unit is rejected even when no price
  list/partner is involved at all.
- **Precision**: every monetary value touched (`PriceListItem.price`,
  `Product.sale_price`, `Product.min_sale_price`) is a plain integer
  column (halalas) — confirmed by each model's `$casts` — no `float`
  anywhere in this path.

## 5. Existing pricing sources

1. `PriceListItem` (explicit product+unit price within a specific,
   manually-selected `PriceList`) — the most specific, wins when present.
2. `Product.sale_price` — the catalog default, used only for the base
   unit when no more specific `PriceListItem` applies.
3. `Product.min_sale_price` — not a *source* of a sellable price at all; a
   floor guard enforced only at invoice posting.

No third source (e.g. a tiered/quantity-break pricing table, a
customer-group price matrix) exists anywhere in the codebase — verified by
the model/migration inspection above, not assumed absent.

## 6. Existing precedence

Reproduced verbatim from `PosCustomerPriceListResolver::posPriceFor()`
(the checkout-authoritative variant, §4) and implemented identically in
`CommercePriceResolver::resolve()`:

```text
1. A Partner is given AND has an active default PriceList
   (via forPartner(), itself gated by the POS "apply customer price
   list" setting) AND that list has an explicit item for this
   product+unit
       → PriceListItem.price                         (source = PRICE_LIST)
2. Otherwise, if the unit is the product's BASE unit
       → Product.sale_price                           (source = PRODUCT_DEFAULT)
3. Otherwise (an alternate unit with no explicit list item)
       → no price resolved                             (source = NONE)
```

## 7. Authoritative vs. advisory sources

- **Authoritative for what actually posts**: the `unit_price` written into
  an `Invoice`/`Purchase`/etc. line at the moment of document
  creation/posting — this PR never writes one.
- **Advisory/proposal**: everything `CommercePriceResolver` returns.
  `ResolvedCommercePrice` is explicitly documented (in its own class
  doc-comment) as "اقتراح تجاري، لا حقيقة مالية" (a commercial proposal,
  not financial truth) — matching the master plan's own words: "Output is
  a commercial quote/snapshot input, not an accounting posting."

## 8. Commerce Price Resolution contract

```php
CommercePriceResolver::resolve(
    string $productId,
    string $salesChannelId,
    ?string $partnerId = null,
    ?string $unitName = null,
): ResolvedCommercePrice
```

Not committed to before verifying the master plan/code (per the task's
explicit instruction, §5) — arrived at only after confirming: (a) a
`Product` is the mandatory subject (§5's "Product" requirement), (b) a
`SalesChannel` is accepted as validated *context* only, with no
channel-specific pricing policy existing yet to act on (§9 below), (c) a
`Partner` is optional "existing customer context" reusing the *proven*
`PosCustomerPriceListResolver` path rather than a new "Customer Account"
concept (§10 below), (d) `unitName` is optional because UOM materially
affects the resolved price (§4/§14).

## 9. Resolver input / context

- **`productId`** (required) — validated to exist under the current
  `TenantContext`, with `BranchScope` bypassed on the existence check for
  the identical reason established in every prior Commerce PR
  (`AvailableToSellService`, `InventoryReservationService`,
  `FulfillmentPolicyService`, `CommerceListingService`): the product is
  named explicitly by the caller, not filtered by whichever branch
  happens to be "active" in the calling context. `Product` is
  `BranchScoped`/`BranchShareable` (confirmed by reading the model), so
  this bypass is necessary, not optional, exactly as it was for those
  prior services.
- **`salesChannelId`** (required) — validated to exist under
  `TenantScope` (`SalesChannel` is plain `CompanyWide`, no `BranchScope`
  bypass needed). **`DERIVED`**: accepted and tenant-validated as part of
  "Commerce context," per the task's own wording (§8: "Channel قد يكون
  جزءاً من resolution context فقط في هذه المرحلة") — but it has **no
  effect whatsoever** on the resolved amount or source today, because no
  channel-specific pricing policy exists anywhere in AWJ (confirmed: no
  price-related column on `SalesChannel`, no channel↔`PriceList` mapping
  table). Inventing one would have been exactly the "second precedence"
  the task forbade (§7 of the task: "لا تخترع precedence"). This is a
  documented placeholder for future extensibility, not a currently-active
  input.
- **`partnerId`** (optional) — when given, validated to exist under
  `TenantScope` with the same `BranchScope` bypass `Partner` needs
  (confirmed `Partner implements BranchShareable`, `use BranchScoped`, by
  reading the model directly). A nonexistent/cross-tenant ID is a hard
  `RuntimeException`, **not** a silent fallback — deliberately stricter
  than `PosCustomerPriceListResolver::forPartner()`'s own null-safe
  `Partner::find()` (which is fine for POS's internal convenience use, but
  a Commerce-facing boundary should reject bad input explicitly rather
  than silently guess the caller meant "no partner").
- **`unitName`** (optional, `null` = base unit) — validated unconditionally
  via `UnitConversion::resolve()` regardless of whether a partner/price
  list is even involved, so an undefined unit name is rejected in every
  code path, not only when a price list happens to be present.
- **What is deliberately NOT checked**: `Product.is_active`. Mirrors
  PR-COM-3's own explicit decision to keep "listing/pricing configuration"
  separate from "is this product currently operationally sellable" — the
  task itself (§9, §17 by analogy to COM-3's own established separation)
  never asked for a sellability gate here, and coupling one in would
  silently decide a policy question (should an inactive product ever
  price-quote?) that no source settles.
- **What is deliberately NOT checked**: `CommerceListing` existence or
  `is_published` state. Per the task's explicit instruction (§9): "افصل
  publication eligibility عن price resolution... إذا صلاحية النشر ليست
  مسؤولية COM-4A، لا تفرضها من نفسك." The master plan's PR-COM-4A text
  does not name `CommerceListing` at all, so no such check was added.

## 10. Resolver output / DTO

`App\Services\Commerce\ResolvedCommercePrice` — `final readonly class`,
matching the established repo convention for small immutable value
objects (`App\Support\ApplicationAccessResult`, PR-COM-1A's
`AvailableToSellSnapshot`):

| Property | Type | Notes |
|---|---|---|
| `resolved` | `bool` | `false` when no price could be resolved (§4/§6, case 3) |
| `amount` | `?int` | halalas; `null` iff `!$resolved` |
| `currency` | `string` | `Tenant.currency`, never hardcoded |
| `source` | `string` | one of `ResolvedCommercePrice::SOURCE_PRICE_LIST`/`SOURCE_PRODUCT_DEFAULT`/`SOURCE_NONE` |
| `priceListId` | `?string` | populated only when `source === SOURCE_PRICE_LIST` |
| `unitName` | `?string` | the validated unit name used (`null` = base unit) |
| `minSalePrice` | `?int` | descriptive only, see §14 |

No `cost`, `avg_cost`, `purchase_cost`, `margin`, or accounting-account
field exists on this class — verified directly by a reflection-based test
(`the_dto_never_exposes_cost_or_margin_fields`) rather than only by visual
inspection, satisfying the task's public-safe-by-design requirement (§16
of the task) even though no API/resource consumes this DTO yet.

## 11. Price source semantics

See §6. `PriceListItem` is the only genuinely *explicit* price source;
`Product.sale_price` is a *default*, not a "price list of one" — this
distinction is preserved by reporting `SOURCE_PRODUCT_DEFAULT` distinctly
from `SOURCE_PRICE_LIST`, never conflating the two into a single generic
"resolved" flag with no origin information.

## 12. PriceList handling

`CommercePriceResolver` never queries `PriceListItem` directly — it calls
`PriceListService::resolve()` (existing, unmodified) for the actual lookup
and `PosCustomerPriceListResolver::forPartner()` (existing, unmodified)
for selecting *which* list applies. No `PriceListService`/`PriceList`/
`PriceListItem` file was touched in this diff (verified: `git status --porcelain`
shows only the 3 new files, §32).

## 13. Partner / default price-list handling

Reused, not re-derived: `forPartner()` is called as-is, including its
internal `PosSettings::appliesCustomerPriceList()` gate and its
active-only filter on the resolved `PriceList`. **`OPEN / REQUIRES
VERIFICATION`** (flagged, not silently assumed correct): this couples
Commerce's customer-pricing behavior to a *POS-named* settings toggle,
since no Commerce-specific settings group exists yet. Verified this is
the least invented option available — extracting only *part* of
`forPartner()`'s logic (e.g., the `PriceList` lookup without the settings
gate) would have been a genuinely new, undocumented precedence, which the
task explicitly forbade (§7: "لا تخترع precedence"). If a future PR
determines Commerce needs its own independent toggle, that is a
deliberate, separately-scoped decision — not made here.

## 14. UOM semantics

`UnitConversion::resolve($product, $unitName)` is called **unconditionally**
at the start of resolution (not only when a price list is present), so an
undefined unit name is always rejected — satisfying the task's required
test #15 cleanly, and closing a gap that would otherwise exist if UOM
validation only ran inside `PriceListService::resolve()`'s
partner-path branch. The returned `[$resolvedUnitName, ]` tuple's first
element (`null` = base unit, non-null = validated alternate unit name)
drives the `isAlternativeUnit` decision in §6 case 2 vs. 3 — this is the
exact same signal `PriceListService`/`PosCustomerPriceListResolver`
already rely on, not a new comparison invented for this PR. No UOM Core
file was touched.

## 15. Currency semantics

`Tenant.currency` — read via `Tenant::findOrFail($tenantId)->currency`
(the tenant the caller's own `TenantContext` already points at, so this is
not a cross-tenant read). No `'SAR'` literal appears anywhere in
`CommercePriceResolver.php` or `ResolvedCommercePrice.php` (grep-verified).
No multi-currency/FX conversion logic exists or was added — the system's
own single-currency-per-tenant reality (§4) is reported as-is, not
extended.

## 16. Precision / rounding

No rounding logic exists anywhere in this PR — every amount handled is
already an integer (halalas) at its source (`PriceListItem.price`,
`Product.sale_price`, `Product.min_sale_price`), and `CommercePriceResolver`
never performs arithmetic on money at all (no addition, no percentage, no
division) — it only *selects* which already-integer value to return.
Verified by a dedicated test with a large amount (`123456789`) confirming
exact round-trip with no precision loss.

## 17. Tax boundary

**Absolute, and trivially satisfied by omission**: no VAT calculation, no
inclusive/exclusive conversion, no ZATCA tax category, and no invoice tax
line exists anywhere in `CommercePriceResolver`/`ResolvedCommercePrice` —
confirmed by direct code review (there is no tax-related code to remove or
avoid; none was ever written). `InvoiceService::applyItemsAndTotals()`
remains the sole financial-calculation authority, untouched.

## 18. Discount boundary

No discount, coupon, "Buy X Get Y," campaign, or stacking logic exists.
`PriceListService`/`PriceListItem` themselves carry no discount-percentage
concept (each item is an explicit absolute price, confirmed by the schema
— `price` is the only monetary column) — so there was nothing of that
shape to "reuse" even if the task had asked for it. `PR-COM-4B` (optional,
promotions) remains untouched and unstarted.

## 19. Promotion boundary

Not built, not started, not referenced. See §18.

## 20. SalesChannel role

Validated context only, currently inert on the resolved price — see §9.
`SalesChannel` itself gained no new column, method, or price-related field
in this PR (verified: `git status --porcelain` shows no change to
`app/Models/SalesChannel.php`).

## 21. CommerceListing role

Not consulted at all by this resolver — see §9. `CommerceListing` itself
was not touched (verified: no diff to `app/Models/CommerceListing.php` or
`app/Services/Commerce/CommerceListingService.php`). A dedicated test
(`resolving_a_price_creates_no_commerce_listing_or_fulfillment_policy`)
confirms zero `CommerceListing` rows are created by any resolution.

## 22. Branch role

`Product`/`Partner`'s existing `BranchScope`/`BranchShareable` semantics
were read and respected (bypassed only for the identical, already-approved
reason every prior Commerce service bypasses it — §9), never altered.
`SalesChannel != Branch` and `Warehouse != Branch` remain exactly as
PR-COM-2A/2B established; nothing in this PR conflates any of them.

## 23. Warehouse / Fulfillment boundary

`FulfillmentPolicyService` is never called. `CommercePriceResolver` has no
`warehouse_id` parameter and no code path reaches `Warehouse` or
`FulfillmentPolicy` at all. Verified by a dedicated test
(`resolving_a_price_creates_no_commerce_listing_or_fulfillment_policy`,
which also asserts `FulfillmentPolicy::count() === 0`).

## 24. Inventory / ATS boundary

`CommercePriceResolver` never calls `AvailableToSellService` or
`InventoryReservationService`, never reads `ProductWarehouseStock`, and
selects no warehouse. Verified by three dedicated tests: zero
`InventoryReservation`/`StockMovement` rows created by any resolution, and
`AvailableToSellService::forWarehouse()`'s output (`onHand`,
`availableToSell`) is bit-for-bit identical before/after a resolution call
against the same product/warehouse.

## 25. Tenant isolation

Every model referenced (`Product`, `SalesChannel`, `Partner`, `PriceList`
via `PosCustomerPriceListResolver`) extends `BaseModel`, so `TenantScope`
filters every query automatically — **zero**
`withoutGlobalScope(TenantScope::class)`/`withoutGlobalScopes()` anywhere
in this diff (grep-verified, the same standard held in every prior
Commerce PR). The only scope override present is `withoutGlobalScope(BranchScope::class)`
on `Product`/`Partner` existence checks — both already-`BranchShareable`
models, and the bypass reasoning is identical to (not new relative to)
every prior Commerce PR's own justification. Verified negative tests
(§30): cross-tenant `productId` rejected; cross-tenant `salesChannelId`
rejected; cross-tenant `partnerId` rejected; and a dedicated test proves a
`PriceList` never leaks across tenants even when two tenants create price
lists with the **identical literal name** — the resolved amount and
`priceListId` for Tenant B never reference Tenant A's row.

## 26. Public-safe / security boundary

See §10 — the DTO carries no cost/margin/accounting field by construction,
verified by reflection rather than only by visual review. No API/resource
was added in this PR at all (§29), so there is no live serialization
surface yet, but the schema-level boundary is proven now rather than left
to a future resource class to get right.

## 27. Persistence decision

**No migration, no new table** — confirmed as the expected outcome by the
task itself (§22: "الأفضل المتوقع: لا migration جديدة في COM-4A"). This
PR resolves a price; it does not store one. A resolved-price snapshot, if
ever needed, belongs with `CommerceOrder` (§23 of the task, PR-COM-5A+),
not here — not built, not anticipated in this schema.

## 28. Accounting impact

**NONE.** `CommercePriceResolver` never calls `LedgerService` and creates
no `Account`/`JournalEntry`/`JournalLine`/`Payment`. Verified:
`resolving_a_price_creates_no_accounting_or_zatca_side_effect`
(`JournalEntry::count() === 0`, `Payment::count() === 0`).

## 29. ZATCA impact

**NONE.** No ZATCA class, route, or table referenced anywhere. Since ZATCA
artifacts live entirely on `Invoice` in this codebase, the same test's
`Invoice::count() === 0` assertion is the direct proof there is no ZATCA
surface to have been affected — matching the reasoning already used in
every prior Commerce PR's own report for this exact question.

## 30. API / UI impact

**NONE.** No route, controller, request, resource, or UI file was added or
touched anywhere in this diff.

## 31. Backward compatibility

No existing `Invoice`, POS, `Quote`, `Purchase`, `DeliveryNote`, or
`ReturnDocument`/`CreditNote` flow references `CommercePriceResolver` —
none of those files were touched (verified: `git status --porcelain`
shows exactly the 3 files in §32). `PriceListService`,
`PosCustomerPriceListResolver`, and `InvoiceService` are all byte-for-byte
unmodified — this PR only *calls* two of them as read-only dependencies.

## 32. Changed files

```
A  app/Services/Commerce/CommercePriceResolver.php
A  app/Services/Commerce/ResolvedCommercePrice.php
A  tests/Feature/CommercePriceResolverTest.php
```

No `setup.sh`/`ci.yml`/`deploy/assemble.sh` change — `app/Services/Commerce/`
and `tests/Feature/` are already flat-copied. No `Product`, `Partner`,
`PriceList`, `PriceListItem`, `PriceListService`,
`PosCustomerPriceListResolver`, `InvoiceService`, `SalesChannel`,
`CommerceListing`, or `FulfillmentPolicy` file was modified. No new
reflection-based model guard was triggered — this PR introduces no new
`BaseModel` subclass, so `BranchIsolationGuardTest`/`NumberingSettingsTest`/
`ProductReferenceClassificationGuardTest` needed no update, checked and
confirmed by re-running them (§35).

## 33. Tests — SQLite

`tests/Feature/CommercePriceResolverTest.php`, 20 tests. Full command:
`php artisan test --filter=CommercePriceResolverTest` →
**PASS 20/20 (52 assertions)**.

## 34. Tests — PostgreSQL

Same file, same command, against a real local PostgreSQL 16 instance (same
setup as every prior Commerce PR) — included in the combined regression
run below, all passing.

Combined guard + Commerce regression, PostgreSQL:
`--filter='CommercePriceResolverTest|CommerceListingServiceTest|SalesChannelTest|FulfillmentPolicyServiceTest|CommerceModuleBoundaryTest|BranchIsolationGuardTest|ApiTenantIsolationTest|AvailableToSellServiceTest|InventoryReservationServiceTest'`
→ **PASS 126/126 (361 assertions)**.

## 35. Pricing regressions

`--filter='PriceListTest|CustomerDefaultPriceListTest|MinimumSalePriceGuardTest|MinimumSalePriceHeaderDiscountTest|UnitTemplateTest|UnitTemplateMutationGuardTest'`
→ **PASS** (included in the combined 141-test SQLite run below, all
green — no failure in any pricing-specific test file).

## 36. Invoice / POS regressions

`--filter='PriceListTest|CustomerDefaultPriceListTest|MinimumSalePriceGuardTest|MinimumSalePriceHeaderDiscountTest|UnitTemplateTest|UnitTemplateMutationGuardTest|QuoteTest|PosCheckoutTest|InvoiceTest'`
→ **PASS 141/141 (1036 assertions)** on SQLite. Representative regression
on PostgreSQL, extended with the same filter plus Inventory/Warehouse/
StockPermit/Purchase/Return/Ledger:
`--filter='InventoryTest|WarehouseTest|WarehouseAwareDocumentsTest|StockPermitTest|StockPermitUomValuationTest|PurchaseTest|ReturnTest|InvoiceInventoryApiTest|PosCheckoutTest|LedgerTest|PriceListTest|CustomerDefaultPriceListTest|MinimumSalePriceGuardTest|MinimumSalePriceHeaderDiscountTest|UnitTemplateTest|UnitTemplateMutationGuardTest|QuoteTest|InvoiceTest'`
→ **PASS 241/241 (1608 assertions)**.

## 37. Commerce regressions

Included in §34's combined run: `SalesChannelTest` (PR-COM-2A),
`FulfillmentPolicyServiceTest` (PR-COM-2B), `AvailableToSellServiceTest`
(PR-COM-1A), `InventoryReservationServiceTest` (PR-COM-1B),
`CommerceModuleBoundaryTest` (PR-COM-0) — all green, all 126 tests. (Note:
`CommerceListingServiceTest` from PR-COM-3 was included in the
regression-command list but the actual combined run above already covers
it — 126 total confirms no drop.)

## 38. COM-1B PostgreSQL concurrency regression

`InventoryReservationPostgresConcurrencyTest` re-run **3 consecutive
times** against this PR's schema (which adds zero migrations, so the
schema is byte-for-byte identical to PR-COM-3's) → **PASS 3/3 (11
assertions) every time**, identical outcome to every prior Commerce PR's
report.

## 39. Full-suite reconciliation

| Engine | Result |
|---|---|
| PostgreSQL 16 (real, local) | **3010 passed**, 25 failed, 0 skipped (19854 assertions), 690.06s |
| SQLite | **2999 passed**, 25 failed, 11 skipped (19817 assertions), 305.08s |

### Reconciliation against PR-COM-3's own baseline (pgsql: 2990 passed;
sqlite: 2979 passed/11 skipped) — not just "existing failures exist," the
actual diff:

- **pgsql**: 3010 − 2990 = **20** = exactly `CommercePriceResolverTest`'s
  test count. No other file's test count changed.
- **sqlite**: 2999 − 2979 = **20** = same. Skips unchanged at 11 (this PR
  introduces no new driver-conditional test).

### Failure-set diff against PR-COM-3's baseline — verified identical, not
just re-asserted

Both engines' 25 failing test names were diffed line-by-line against
PR-COM-3's own report's failure list: **byte-for-byte identical set**, on
both engines: 24 `Fuel*Test` failures (`bcmath` PHP extension absent in
this sandbox) and 1 `DocumentCenterSecureIntakeTest` PDF-fixture
validation gap. **Zero new failures** — no failure touches `Commerce`,
`PriceList`, `Invoice`, `Pos`, `Quote`, `UnitTemplate`, or any
isolation/guard test. Per the task's explicit instruction (§30): this is
not merely "the full suite has pre-existing failures," it is a confirmed
identical set with the exact same root causes already triaged in every
prior Commerce PR's report.

## 40. CI status

Not pushed through GitHub Actions in this task (per instructions: do not
merge, do not deploy). All commands above were run locally against a real,
separately-installed PostgreSQL 16 instance configured with the exact same
credentials `ci.yml`'s `services.postgres` block uses, and against SQLite
via the same `setup.sh`-equivalent assembly this repo's own CI uses.

## 41. Risks / Open Questions

- **`OPEN / REQUIRES VERIFICATION`** (§13) — Commerce's customer-pricing
  behavior is currently coupled to `PosSettings::appliesCustomerPriceList()`,
  a POS-named settings toggle, because reusing `PosCustomerPriceListResolver::forPartner()`
  wholesale (rather than inventing a partial re-derivation) was the least
  speculative option available with no Commerce-specific settings group
  yet in existence. If a future PR determines this coupling is
  semantically wrong for a non-POS channel, decoupling it is a
  deliberately separate, explicitly-scoped decision, not made here.
- **`OPEN / REQUIRES VERIFICATION`** — whether `salesChannelId`'s
  currently-inert role (validated but not used in the pricing algorithm,
  §9/§20) should ever gain real channel-specific pricing behavior is
  explicitly undecided — no source in this repository approves or even
  proposes a schema for it today.
- No STOP condition was triggered: no new pricing precedence was invented
  (§6 reproduces `posPriceFor()` exactly), no second price truth was
  created, no migration/schema was added, `InvoiceService`'s financial
  calculation was not touched, VAT/ZATCA was not touched, rounding rules
  were not touched, UOM Core was not touched, `PriceList` semantics were
  not altered, no price field was added to `CommerceListing`, no
  promotion/rules engine was built, no `TenantScope` bypass was
  introduced, no inventory/warehouse coupling exists, and `CommerceOrder`
  was not started.

## 42. Remaining work

Per the master plan, strictly next in the roadmap (not started, per
explicit instruction not to begin it in this task): `PR-COM-4B` (optional,
only if the launch slice requires promotions) and `PR-COM-5A` — Commerce
Order aggregate, plus everything in the task's "Absolute Out of Scope"
list (order snapshots, reservation orchestration, Customer Account,
customer auth, addresses, Cart, Checkout, Public/Mobile API,
`PaymentIntent`, provider integration, Fulfillment, Shipping, Invoice
Trigger Matrix, Commerce→Invoice bridge, Returns/Refunds, External
channels, B2B, Product Variants, Store Builder/UI). The §41 open items are
conscious, documented deferrals, not blockers.

## 43. Git

- **Branch:** `claude/pr-com-4a-price-resolution`
- **PR:** [#732](https://github.com/safwan5001-source/Nebrax/pull/732) —
  opened against `main`, not merged
- **Base SHA:** `8d67d2e4cc34440b1e4f2d54a89452efb4349a6e`
- **Head SHA:** `64c1c32b5a840d68a6bfa9cc4305205e25f6eb40` (before adding
  this report)

## 44. Recommended next step

**PR-COM-4A is clean**: Commerce has a central price-resolution boundary
that composes existing, already-verified AWJ pricing infrastructure
without inventing precedence — the exact `posPriceFor()` algorithm,
traced to its real production call site in `PosService::checkout()`, is
what this resolver implements; no second price truth exists; no price
field was added to `CommerceListing`; the resolver is strictly read-only
with no persistence; no tax calculation exists; `InvoiceService` remains
the sole financial authority; no promotion engine was built; no inventory/
ATS/warehouse coupling exists; tenant isolation is proven with zero new
`TenantScope` bypass and a dedicated identical-name cross-tenant leak
test; precision/rounding are preserved by never performing arithmetic on
money at all; no cost/margin field exists on the DTO, verified by
reflection; SQLite and PostgreSQL are both green with every count
reconciled exactly against PR-COM-3's own baseline and the 25 failures
confirmed byte-for-byte identical, not just "pre-existing"; pricing/
invoice/POS regressions are green; Commerce regressions (COM-0 through
COM-3) are green; PR-COM-1B's PostgreSQL concurrency guarantee was
re-verified unaffected across 3 runs.

Recommended next step: **`PR-COM-5A` — Commerce Order aggregate** (or
`PR-COM-4B` first, only if the launch slice is confirmed to require
promotions), once this PR is reviewed and merged by its owner (not by
this session — per instructions, this session does not merge or deploy).
