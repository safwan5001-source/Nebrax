# PR-COM-5A — CommerceOrder Foundation — Implementation Report

## 1. Executive Summary

PR-COM-5A builds `CommerceOrder`/`CommerceOrderLine`: the first independent,
non-accounting commercial-commitment aggregate in AWJ Commerce (ADR-01).
An order is created atomically with its lines, each line priced exclusively
through `CommercePriceResolver` (PR-COM-4A) and snapshotted immutably at
creation time. A separate `confirm()` transition marks the order as a
commercial commitment with **zero accounting or inventory side effects** —
no `InventoryReservation`, no `StockMovement`, no `Invoice`, no `Payment`,
no `JournalEntry`, no ZATCA artifact. Reservation orchestration is
explicitly deferred to PR-COM-5B.

30 new tests in `CommerceOrderServiceTest`, all passing on first run on both
SQLite and PostgreSQL. Zero new full-suite failures on either engine
(reconciled against the exact failure-name list, not just counts). The
PostgreSQL concurrency proof for PR-COM-1B was re-run and remains green.

## 2. Base SHA / Head SHA

- **Base:** `origin/main` at `49f5dff698cfc116de8d232a506d840c1b9879d0`
  (PR-COM-4A, PR #732) — verified via `git fetch origin main` immediately
  before branching; this SHA matched `origin/main` HEAD exactly at branch
  time, so no re-verification against a stale prompt SHA was needed.
- **Branch:** `claude/pr-com-5a-commerce-order-foundation`, created from
  `origin/main` directly (not from any local/stale branch).

## 3. Binding sources read

- `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` — §1–4
  (non-negotiable architecture, canonical lifecycle), PHASE 5 (PR-COM-5A/5B
  full text), §15 (cross-cutting gates), §16–20 (classification/DoD/open
  decisions).
- `docs/plans/store/ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md` — full
  text (Order != Invoice, independent lifecycles, invoice-trigger as typed
  policy, accounting/inventory responsibility table, explicit non-decisions).
- `docs/plans/store/PR-COM-4A-IMPLEMENTATION-REPORT.md` — resolver contract,
  precedence, currency/tax boundary decisions.
- `docs/plans/store/PR-COM-3-IMPLEMENTATION-REPORT.md` — `CommerceListing`
  precedent for `CompanyWide` classification and `ProductReferenceRegistry`
  entry pattern.
- `App\Support\CommerceBoundary`, `tests/Feature/CommerceModuleBoundaryTest.php`
  — read in full before any edit.
- Direct code inspection (not prior reports) for every schema/service
  decision below: `SalesChannel`, `FulfillmentPolicy`, `CommerceListing`,
  `InventoryReservation` models and migrations; `Quote`/`QuoteLine`,
  `Invoice`/`InvoiceLine`, `PurchaseLine`, `ReturnLine`, `PriceListItem`
  models and migrations; `App\Support\GeneratesDocumentNumbers`,
  `App\Support\DocumentNumberingCatalog`, `tests/Feature/NumberingSettingsTest.php`;
  `App\Support\ProductReferenceRegistry`, `tests/Feature/ProductReferenceRegistryTest.php`;
  `tests/Feature/BranchIsolationGuardTest.php`; `App\Services\Accounting\UnitConversion`;
  `App\Services\Commerce\CommercePriceResolver`/`ResolvedCommercePrice`;
  `App\Services\Accounting\QuoteService` (creation/transaction pattern
  template); `App\Models\Partner`/`Product` (`BranchShareable` classification).

## 4. AWJ VERIFIED existing document architecture

- Every business document in AWJ carries a sequential `number` via
  `GeneratesDocumentNumbers` — Quote, Invoice, Purchase, ReturnDocument,
  CreditNote, DeliveryNote, PosSession, Stocktake, InventoryOpening,
  Expense, Asset, JournalEntry, ManualJournal, PayrollRun, Employee, and
  more. No document type in the codebase lacks one.
- Header→lines FK is always `cascadeOnDelete()` (owned-child pattern) —
  confirmed on `invoices.invoice_id`, `quotes.quote_id`.
- Business-historical line `product_id` FKs are uniformly
  `nullable()->nullOnDelete()` at the DB level (InvoiceLine, PurchaseLine,
  ReturnLine, QuoteLine) — the real delete-block lives in
  `ProductReferenceRegistry`/`ProductLifecycleService`, not the FK.
  `COMMERCIAL_LIVE`-class references (`PriceListItem`, `CommerceListing`)
  instead use `restrictOnDelete()` — a different, deliberate split.
  `InventoryReservation` (a genuine historical/audit record, ADR-02 §3)
  uses `restrictOnDelete()` on its `product_id`/`warehouse_id`.
- `SalesChannel`, `FulfillmentPolicy`, `CommerceListing`, `InventoryReservation`
  are **all** `CompanyWide` — none carries `branch_id`. `SalesChannel != Branch`
  (ADR-03 §1) is already the established pattern across every existing
  Commerce foundation model.
- No AWJ document (Invoice, Quote, Purchase) carries a `currency` column —
  `Tenant.currency` is the sole source of truth (single-currency-per-tenant
  system), confirmed again while reading `Invoice`/`Quote` migrations.
- `HasUnitConversion` (InvoiceLine/PurchaseLine trait) additionally supports
  rational quantity (`quantity_numerator`/`quantity_denominator`) and a
  `rounding_policy` — confirmed to be an InvoiceLine-only tax-rounding
  extension, **not** the common baseline. The common baseline shared by
  every line type (Invoice, Purchase, Quote, Return) is simply `quantity`
  (integer) + `unit_name`/`unit_factor` snapshot.
- `CommercePriceResolver::resolve()` (PR-COM-4A) is called by production
  code exactly once, with signature
  `(productId, salesChannelId, ?partnerId, ?unitName): ResolvedCommercePrice`,
  and internally calls `UnitConversion::resolve()` itself but only exposes
  the resolved unit **name**, not the factor.

## 5. CommerceOrder aggregate contract

```
CommerceOrder
  id, tenant_id, sales_channel_id, partner_id (nullable),
  number, status (draft|confirmed), total, confirmed_at, timestamps
```

- `implements CompanyWide` — matches every sibling Commerce foundation
  model (`SalesChannel`/`FulfillmentPolicy`/`CommerceListing`/
  `InventoryReservation`). No `branch_id`: the order belongs to its
  `SalesChannel`, not to an operational branch (ADR-03 §1).
- `sales_channel_id`: `restrictOnDelete()` — **not** the `cascadeOnDelete()`
  used by `CommerceListing`/`FulfillmentPolicy`. Those two are *live
  configuration*; `CommerceOrder` is a **historical record** (task's own
  definition: "سجلّ تجاري تشغيلي... يحفظ snapshot"), matching
  `InventoryReservation`'s `restrictOnDelete()` choice for the same reason
  (ADR-02 §3: a historical record must stay interpretable).
- `partner_id`: nullable + `restrictOnDelete()` — optional per Master Plan
  §12 (Customer Account doesn't exist yet, guest orders must be
  representable, no auto-created Partner), but when present, protected the
  same way `Invoice.partner_id` is.
- `number`: reuses `GeneratesDocumentNumbers` exactly as every other AWJ
  document does — prefix `CORD`, yearly reset (`Master Plan §24: "Commerce
  Order number != Invoice number"` — a fully independent tenant-wide
  sequence, never touches `INV` or `zatca_icv`).

## 6. CommerceOrderLine contract

```
CommerceOrderLine
  id, tenant_id, commerce_order_id, product_id (nullable FK, required by service),
  product_name_snapshot, quantity, unit_name (nullable), unit_factor,
  unit_price, line_total, timestamps
```

- `product_id`: DB-nullable + `nullOnDelete()` (matches the
  BUSINESS_HISTORICAL convention exactly — InvoiceLine/QuoteLine/
  PurchaseLine/ReturnLine all do this), but the **service** always requires
  it (no free-text/service-line concept exists or is authorized for
  Commerce today).
- `product_name_snapshot`: captured from `Product.name` at line-creation
  time, never re-read afterward — closest sibling is InvoiceLine's own
  `product_name_snapshot` column (name reused, not re-derived logic).
- `unit_name`/`unit_factor`: snapshot from `UnitConversion::resolve()`,
  called directly by `CommerceOrderService` (not reused from
  `CommercePriceResolver`, which only exposes the unit **name**). Same
  inputs, same single authority — no possible divergence.
- `unit_price`/`line_total`: `unit_price` is `ResolvedCommercePrice.amount`
  verbatim; `line_total = quantity × unit_price`. **No** `quantity_numerator`/
  `quantity_denominator`/rounding fields — that machinery is InvoiceLine's
  own tax-rounding extension (§4 above), out of scope here (no tax exists
  in Commerce pricing yet).

## 7. State/lifecycle decision

Two states only: `draft`, `confirmed`. ADR-01 §4 requires Order/Payment/
Fulfillment to stay independent dimensions — since Payment and Fulfillment
don't exist yet in Commerce, only the Order dimension is represented; there
is nothing to compress. No `cancelled`/`processing`/`shipped` states were
invented (Master Plan §15: "لا تخترع state machine من أسماء مألوفة... إلا
إذا Master Plan/ADR يحددها" — none of those transitions are required by
this PR).

## 8. Confirmation semantics

`confirm()` is a pure state transition: `draft → confirmed` +
`confirmed_at = now()`. It re-locks the row (`lockForUpdate`), rejects a
non-draft order, and does **not** re-resolve prices, re-validate stock, or
call any other service. Explicitly verified by
`confirmation_does_not_mutate_line_snapshots` and
`creating_and_confirming_an_order_has_zero_inventory_or_accounting_effect`.
Confirmation = commercial commitment only (Master Plan §16); it does not
imply reservation, payment, or invoicing.

## 9. Historical snapshot policy

At line-creation time only: `product_name_snapshot`, `unit_name`,
`unit_factor`, `unit_price` are captured and never re-read from `Product`/
`PriceList` afterward. Verified directly:
`a_later_product_sale_price_change_does_not_mutate_the_committed_line`,
`a_later_price_list_change_does_not_mutate_the_committed_line`,
`a_later_product_name_change_does_not_mutate_the_committed_snapshot`.

## 10. Product snapshot policy

Single field: `product_name_snapshot` (immutable, always populated from
`Product.name` at creation). No `sku_snapshot`/`barcode_snapshot` — those
are InvoiceLine-specific fields tied to ZATCA/print requirements that don't
apply to a pre-invoice commercial commitment; adding them now would be
unjustified by any test, ADR text, or Master Plan requirement for 5A.

## 11. Price snapshot policy

`unit_price` is `ResolvedCommercePrice.amount` verbatim. If
`resolved === false`, the whole line — and therefore the whole order
creation (atomic) — is rejected via `CommerceOrderPriceUnresolvedException`,
**never** silently coerced to `0`. A genuine `amount === 0` is accepted and
stored as-is (`a_genuine_zero_price_is_accepted_as_a_real_resolved_price`).

## 12. COM-4A integration

`CommerceOrderService` injects `CommercePriceResolver` and calls
`resolve($productId, $salesChannelId, $orderPartnerId, $unitName)` once per
line — no PriceList/partner-pricing/UOM-pricing logic is reimplemented or
read directly. `partnerId` is the order header's own (optional) partner,
never a per-line override (matching the resolver's own single-partner
signature).

## 13. Quantity/UOM semantics

`quantity`: unsigned integer, must be `> 0`. `UnitConversion::resolve()` is
called directly by the service (same authority, same `$product`/`$unitName`
inputs as `CommercePriceResolver` uses internally) to obtain
`[$resolvedUnitName, $unitFactor]` — an undefined unit is rejected with a
`RuntimeException` exactly as `UnitConversion` already guarantees. No new
conversion logic. `CommerceOrderLine::baseQuantity()` = `quantity × max(1,
unit_factor)` — a direct 2-line reimplementation of only the simple branch
of `HasUnitConversion`, since the rational (numerator/denominator) branch
of that trait is explicitly not adopted (§6 above).

## 14. Monetary precision

All amounts (`unit_price`, `line_total`, `CommerceOrder.total`) are `bigint`
halalas, cast `integer` in Eloquent — zero floats anywhere in the path.
`line_total = quantity(int) × unit_price(bigint)` is safe integer
multiplication; `total = Σ line_total`.

## 15. Totals semantics

`CommerceOrder.total` is **derived only** — computed by the service from
the sum of created lines' `line_total`, never accepted as caller input.
There is deliberately **no** `subtotal`/`tax_amount`/`discount`/`shipping`
breakdown: none of those capabilities exist yet in Commerce (no tax engine,
no promotion engine — COM-4B not built, no shipping — Phase 9B). Adding
those fields now, with nothing to populate them meaningfully, would be
exactly the "premature future-proofing" the task repeatedly warns against.
Flagged **OPEN** below.

## 16. Currency semantics

No `currency` column on `CommerceOrder`/`CommerceOrderLine` — no AWJ
document has ever had one (single-currency-per-tenant system,
`Tenant.currency` is the sole source of truth, re-confirmed by direct
inspection of the Invoice/Quote migrations during this PR). Adding a
column with no precedent and no multi-currency capability anywhere in the
system would be speculative.

## 17. Tax boundary

**No tax field exists on `CommerceOrderLine`/`CommerceOrder`.**
`CommercePriceResolver` (COM-4A) itself resolves no tax at all
("الضريبة غائبة عمداً بالكامل"). Master Plan §20 explicitly forbids
inventing a tax engine, and §39 explicitly lists "tax snapshot"/"VAT
calculation" as stop-condition topics. Treated as **OPEN / Requires
Verification** below rather than guessed.

## 18. ZATCA boundary

Zero ZATCA fields, zero ZATCA service calls. `Invoice::count() === 0` after
every order-creation/confirmation test in `CommerceOrderServiceTest`
trivially proves no ZATCA artifact exists (ZATCA fields live exclusively on
`Invoice`, and no `Invoice` is ever created by this PR).

## 19. SalesChannel relationship

`CommerceOrder.sales_channel_id` is required (`NOT NULL`,
`restrictOnDelete()`) — every order belongs to exactly one channel, the
"where did this commercial commitment originate" question ADR-03 assigns
to `SalesChannel`. No active-channel check is enforced at order-creation
time — this matches the precedent already set by `CommercePriceResolver`
itself (COM-4A), which also does not check `SalesChannel.is_active` before
resolving a price for a channel.

## 20. Customer/Partner boundary

`partner_id` is optional. No `Partner` is ever auto-created. Customer
Account (Phase 6) does not exist yet, so order "ownership" by an
authenticated customer identity is entirely out of scope — the order
merely carries an optional historical reference to an existing `Partner`,
exactly like `Invoice.partner_id` does, except nullable.

## 21. Address boundary

No address fields anywhere. Master Plan's own phase breakdown explicitly
assigns "immutable order address snapshot" to **PR-COM-6C** ("Customer
addresses & immutable order address snapshot"), not 5A. Building any
address/delivery snapshot now would preempt a specifically-scheduled later
PR. Flagged **OPEN** below (deferred, not undecided-and-guessed).

## 22. Branch boundary

None — `CommerceOrder implements CompanyWide`, no `branch_id`. See §5.

## 23. Warehouse boundary

None. Fulfillment-source resolution (via `FulfillmentPolicy`) is explicitly
PR-COM-5B's responsibility, connected only once reservation orchestration
exists.

## 24. Reservation boundary

**Absolute.** No `InventoryReservationService` call anywhere in
`CommerceOrderService`. Directly tested:
`creating_and_confirming_an_order_has_zero_inventory_or_accounting_effect`
asserts `InventoryReservation::count() === 0` and that
`AvailableToSellService::forWarehouse()` returns identical `onHand`/
`availableToSell` before and after order creation **and** confirmation.

## 25. Payment boundary

**Absolute.** No `PaymentService` call, no `payment_status` field, no
speculative payment state machine. `Payment::count() === 0` verified after
every create/confirm test.

## 26. Fulfillment boundary

**Absolute.** No fulfillment aggregate exists in the codebase yet to
accidentally touch; nothing to test against beyond the general boundary
assertions above.

## 27. Invoice/accounting boundary

**Absolute.** No `InvoiceService`/`LedgerService` call anywhere.
`Invoice::count() === 0` and `JournalEntry::count() === 0` verified after
every create/confirm test in `CommerceOrderServiceTest`.

## 28. Numbering

`CommerceOrder` uses `GeneratesDocumentNumbers` with prefix `CORD`
(registered in `DocumentNumberingCatalog::ENTITIES['commerce_order']`,
required by `NumberingSettingsTest`'s reflection-based drift guard —
verified green). Tenant-wide sequence (`CompanyWide` → not branch-numbered,
per the trait's own `isBranchNumbered()` logic), yearly reset, completely
independent from `INV`/`zatca_icv`.

## 29. Idempotency decision

**None added in this PR — deliberate, per Master Plan §25.** No
externally-retryable surface exists yet (no API/Checkout — Master Plan
explicitly assigns "idempotency key" validation to **PR-COM-7A**, Cart/
checkout commercial validation, not 5A). Building an idempotency mechanism
now, with no real caller to retry, would be exactly the premature
infrastructure the task warns against. `CommerceOrderService::create()`
is atomic (DB transaction) but not idempotent — correct for its current
sole caller (direct service invocation, no HTTP retry surface).

## 30. Transactionality

`create()` wraps header + all lines in one `DB::transaction()`. Any line
failure (missing product, non-positive quantity, undefined unit, unresolved
price) throws before commit, and the whole order — header included — is
rolled back. Verified: `an_invalid_line_rolls_back_the_whole_order_creation`
asserts both `CommerceOrder::count() === 0` and
`CommerceOrderLine::count() === 0` after a rejected multi-line creation.

## 31. Tenant isolation

- `SalesChannel::query()->whereKey($id)->exists()` — tenant-scoped via
  `BaseModel`, no bypass.
- `Partner::query()->withoutGlobalScope(BranchScope::class)->whereKey($id)->exists()`
  and `Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($id)->first()`
  — identical pattern to `CommercePriceResolver` (COM-4A): explicit
  existence checks, `BranchScope` bypassed (both `Product`/`Partner` are
  `BranchShareable`) but `TenantScope` **never** bypassed.
- Verified: cross-tenant `SalesChannel`/`Product`/`Partner` all rejected
  with `RuntimeException`; `orders_are_scoped_to_the_active_tenant` proves
  `CommerceOrder::query()` itself never leaks across tenants.

## 32. Deletion/reference integrity

- `CommerceOrderLine::product_id` is registered `BUSINESS_HISTORICAL` in
  `ProductReferenceRegistry` (same class as QuoteLine — non-accounting
  historical evidence, delete-blocking at the application layer, not the
  DB FK) — verified via `BranchIsolationGuardTest`/full guard suite green.
- `CommerceOrder` itself: a `draft` order can be hard-deleted; a
  `confirmed` order **cannot** (`LogicException` from a `booted()` guard,
  mirroring `InvoiceLine`'s own deletion guard against delivery-note-linked
  lines). Verified: `a_draft_order_can_be_deleted`,
  `a_confirmed_order_cannot_be_deleted`.

## 33. Backward compatibility

Zero existing files' behavior changed — `DocumentNumberingCatalog` and
`ProductReferenceRegistry` only gained new entries (additive), and
`CommerceModuleBoundaryTest` only had `CommerceOrder` removed from its
"not yet" list (same pattern as `SalesChannel`/`CommerceListing` in prior
PRs). No existing test's assertions were weakened.

## 34. Migration details

`database/migrations/2026_09_16_010000_create_commerce_orders_table.php`
creates two tables:

- `commerce_orders`: `id` (uuid pk), `tenant_id` (cascade), `sales_channel_id`
  (restrict), `partner_id` (nullable, restrict), `number`, `status`
  (enum draft/confirmed, default draft), `total` (bigint, default 0),
  `confirmed_at` (nullable timestamp), timestamps.
  `unique(tenant_id, number)`, indexes on `(tenant_id, sales_channel_id)`,
  `(tenant_id, partner_id)`, `(tenant_id, status)`.
- `commerce_order_lines`: `id` (uuid pk), `tenant_id` (cascade),
  `commerce_order_id` (cascade), `product_id` (nullable, `nullOnDelete`),
  `product_name_snapshot`, `quantity` (unsigned int), `unit_name`
  (nullable), `unit_factor` (unsigned int, default 1), `unit_price`
  (bigint), `line_total` (bigint), timestamps. Index on
  `(tenant_id, commerce_order_id)`.

Migration reviewed for tenant/backward compatibility: purely additive, no
existing table altered, applies cleanly on both SQLite and PostgreSQL
(verified by full `migrate:fresh` on both engines during this PR).

## 35. Changed files

**New:**
- `database/migrations/2026_09_16_010000_create_commerce_orders_table.php`
- `app/Models/CommerceOrder.php`
- `app/Models/CommerceOrderLine.php`
- `app/Services/Commerce/CommerceOrderService.php`
- `app/Services/Commerce/CommerceOrderPriceUnresolvedException.php`
- `tests/Feature/CommerceOrderServiceTest.php` (30 tests)
- `docs/plans/store/PR-COM-5A-IMPLEMENTATION-REPORT.md` (this file)

**Modified:**
- `app/Support/DocumentNumberingCatalog.php` — registered `commerce_order`
  entity (required by `NumberingSettingsTest`'s drift guard).
- `app/Support/ProductReferenceRegistry.php` — registered
  `CommerceOrderLine::class` as `BUSINESS_HISTORICAL` (required by the
  product-reference classification guard).
- `tests/Feature/CommerceModuleBoundaryTest.php` — removed
  `'App\\Models\\CommerceOrder'` from `NOT_YET_MODELS` (same pattern as
  `SalesChannel`/`CommerceListing` removals in prior PRs).

No changes to `setup.sh`/`.github/workflows/ci.yml`/`deploy/assemble.sh` —
`app/Models`, `app/Support`, `app/Services/Commerce` were already
registered in all three assembly configs since PR-COM-1A.

## 36. SQLite tests/results

- Targeted: `CommerceOrderServiceTest` — **30/30 passed** (52 assertions),
  first run, no fixes needed.
- Regression bundle (`CommerceOrderServiceTest|CommercePriceResolverTest|
  CommerceListingServiceTest|SalesChannelTest|FulfillmentPolicyServiceTest|
  AvailableToSellServiceTest|InventoryReservationServiceTest|
  CommerceModuleBoundaryTest`): **147/147 passed** (274 assertions).
- Guard suite (`BranchIsolationGuardTest|ProductReferenceRegistryTest|
  NumberingSettingsTest`): **47/47 passed** (348 assertions).
- Full suite: **3031 passed, 27 failed, 11 skipped** (19,893 assertions).

## 37. PostgreSQL tests/results

- Regression + guard bundle (11 test classes together): **194/194 passed**
  (622 assertions).
- `InventoryReservationPostgresConcurrencyTest` (PR-COM-1B proof):
  **3/3 passed** (11 assertions) — re-verified real, forked-process
  concurrency correctness on this exact codebase state.
- Full suite: **3042 passed, 27 failed** (19,930 assertions).

## 38. Commerce regressions

All prior Commerce PRs' test suites re-run and green on both engines:
`AvailableToSellServiceTest`, `InventoryReservationServiceTest`,
`InventoryReservationPostgresConcurrencyTest`, `SalesChannelTest`,
`FulfillmentPolicyServiceTest`, `CommerceListingServiceTest`,
`CommercePriceResolverTest`, `CommerceModuleBoundaryTest` — zero
regressions in any.

## 39. Pricing/invoice/POS regressions

`CommercePriceResolverTest` (COM-4A, 20 tests) re-run green on both
engines — the resolver's precedence, unit handling, and boundary
guarantees are untouched by this PR (`CommerceOrderService` only calls it,
never modifies it). No Invoice/POS test file was touched; full-suite
results (§36/§37) confirm no Invoice/POS-related test regressed.

## 40. Inventory regression

`AvailableToSellServiceTest` and `InventoryReservationServiceTest` both
green on both engines. `CommerceOrderServiceTest`'s own
`creating_and_confirming_an_order_has_zero_inventory_or_accounting_effect`
additionally proves `AvailableToSellService::forWarehouse()` output is
byte-identical before and after a full order create+confirm cycle.

## 41. COM-1B concurrency regression

`InventoryReservationPostgresConcurrencyTest` re-run on this PR's exact
PostgreSQL migration state: **3/3 passed** — `pcntl_fork()`-based
concurrent-reservation-oversell proof remains valid after the
`commerce_orders`/`commerce_order_lines` tables were added.

## 42. Full-suite reconciliation

| Engine | Passed | Failed | Skipped |
|---|---|---|---|
| SQLite | 3031 | 27 | 11 |
| PostgreSQL | 3042 | 27 | 0 |

Both engines' 27 failing test names are byte-for-byte identical to each
other and fall into exactly the two long-standing pre-existing categories
documented in every prior Commerce PR's report: `Fuel*Test` failures
(`bcmath` PHP extension absent in this sandbox) and
`DocumentCenterSecureIntakeTest` (PDF-fixture gap).

This is **2 more** than PR-COM-4A's own documented baseline of 25
(24 `Fuel*Test` + 1 `DocumentCenterSecureIntakeTest`). Verified via
`git show --stat 57a450a` (the commit immediately preceding this PR's base
on `main`, `fix(access-control): propagate actor to POS and fuel payment
posting`, merged as PR #731) that it added **136 new lines to
`tests/Feature/FuelSaleServiceTest.php`** — unrelated to Commerce, and
gated by the same pre-existing missing-`bcmath` root cause. The two new
failures are exactly new `FuelSaleServiceTest` cases from that unrelated
merge, not anything introduced by PR-COM-5A. Zero new failure categories;
zero failures outside the two known pre-existing ones.

## 43. CI status

Not yet run — CI triggers on PR push. Local full-suite results on both
SQLite and PostgreSQL (§36/§37/§42) mirror exactly what CI's `db: [sqlite,
pgsql]` matrix will run (`.github/workflows/ci.yml`).

## 44. Risks

- None identified that affect merge safety. The new tables/models are
  fully additive; no existing model, service, or route was modified in
  behavior.
- `CommerceOrderService::create()` performs one `SalesChannel`/`Partner`
  existence check before the transaction and per-line `Product` checks
  inside it — this is the same pattern already proven safe in
  `CommercePriceResolver`/`FulfillmentPolicyService`, not a new risk
  surface.

## 45. Open Questions

Per Master Plan §19/§39, these are consciously **not decided** here —
flagged, not guessed:

1. **Totals breakdown** (§15/§17): whether/when `subtotal`/`tax_amount`/
   `discount`/`shipping` columns are added to `CommerceOrder`/
   `CommerceOrderLine` depends entirely on when a real tax/promotion/
   shipping capability exists in Commerce (COM-4B, Phase 9B) — deferred.
2. **Customer/address snapshot** (§21): Master Plan explicitly assigns
   "immutable order address snapshot" to PR-COM-6C; exact fields remain
   undecided until Phase 6 (Customer Account/identity) lands.
3. **Price provenance persistence**: `price_source`/`price_list_id` from
   `ResolvedCommercePrice` are **not** persisted on `CommerceOrderLine` in
   this PR (only the resolved `amount` is snapshotted) — a deliberate
   minimalism choice, not a stop condition; revisit if a future PR needs
   to explain *why* a historical price was what it was, beyond the amount
   itself.
4. **Cancellation lifecycle** (Master Plan §17): not built — no
   reservation exists yet to release, so a full cancel/release workflow
   has nothing real to orchestrate. A `draft` order can simply be deleted;
   a `confirmed` order cannot be deleted or cancelled in this PR.

## 46. Remaining work

- **PR-COM-5B** — Order reservation orchestration: connect `confirm()` (or
  a new explicit transition) to `InventoryReservationService::acquire()`
  under an explicit `InvoiceTriggerPolicy`-style reservation-timing policy
  (`ON_ORDER_CONFIRMATION` / `ON_PAYMENT_CONFIRMED`, per ADR-02/Master Plan
  §PHASE 5). `InventoryReservation.source_type`/`source_id` already exist
  (added speculatively-but-intentionally in PR-COM-1B for exactly this
  future link) — no new migration needed on the reservation side.
- Everything else in the canonical lifecycle (Payment, Fulfillment,
  Invoice trigger) remains fully out of scope until its own designated PR.

## 47. Branch / PR / Base SHA / Head SHA

- **Branch:** `claude/pr-com-5a-commerce-order-foundation`
- **Base SHA:** `49f5dff698cfc116de8d232a506d840c1b9879d0`
- **PR:** opened against `main` — link recorded in a follow-up commit to
  this report
- **Head SHA:** recorded at PR-open time in the follow-up commit above

## 48. Recommended next step

**PR-COM-5A is clean.** Owner review, then — only once explicitly
approved and merged — PR-COM-5B (order reservation orchestration) can
begin. Per instructions, PR-COM-5B is **not** started in this session.
