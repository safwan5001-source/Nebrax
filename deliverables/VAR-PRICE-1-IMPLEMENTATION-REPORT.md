# VAR-PRICE-1 Implementation Report

## Status

**PASS.**

## Baseline

- Starting `main` SHA: `ec9ee5c594d4f078224b4c90bd5f1cb8be53c553`
- Confirmed via `git log --oneline -5 origin/main`: `ec9ee5c` is `VAR-INV-1: Variant inventory and valuation identity (#812)` — the exact merge commit given as the confirmed baseline. No re-exploration of VAR-CORE-1/VAR-INV-1 was performed; work started directly from this SHA on a fresh branch.

## 0. Evidence pass (read before implementation)

Read `AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md` §4 (UOM/barcode/pricing contract — the
authoritative precedence and "no factor-derived price" rule) and §4.1, plus
`VAR-INV-1-IMPLEMENTATION-REPORT.md` (to reuse its exact architecture pattern).
Then a focused `Explore` pass (not broad) over the 10 listed pricing surfaces
confirmed:

- `Product.sale_price` is the **only** existing canonical base price — a single
  scalar for the base UOM. No canonical price for any alternate UOM exists
  anywhere today (only `PriceListItem` — an *override*, not a base authority —
  can carry an alternate-unit price, and only when an active price list has one).
- `PriceListItem` already has the right *shape* conceptually
  (`price_list_id, product_id, unit_name, price`, unique per combination) but
  **no `product_variant_id` column** — extending it, not replacing it, per the
  task's explicit instruction to reuse canonical infrastructure where safe.
- `ProductVariant` has **no price column of any kind** (confirmed against the
  VAR-CORE-1 migration).
- `CommercePriceResolver`/`PosCustomerPriceListResolver` precedence, read from
  actual code (not paraphrased): partner price list → sales-channel default price
  list → explicit `PriceListItem` → `Product.sale_price` **for the base unit
  only** → unresolved. An alternate unit with no price-list item was always
  `null` — there was no "canonical base price" fallback tier for alternate units
  to fall back to, because that tier didn't exist. This is exactly the gap
  VAR-PRICE-1 closes.
- `min_sale_price` enforcement lives solely in
  `InvoiceService::minimumPriceDecision()`, reading `Product.min_sale_price` only
  — no document line carries `product_variant_id` yet (confirmed: neither
  `InvoiceLine` nor `QuoteLine` nor `purchase_lines` has that column), so there
  is nothing for this milestone to adapt here. Left completely untouched.
- Money: confirmed integer-halala convention everywhere touched, no float.

No contradiction requiring a business-policy decision was found — the task's
own precedence model (§7) matches the evidence exactly, and the recommended
"reuse `PriceListItem`'s shape, add a new canonical-base table" design (§3) had
no existing competing implementation to reconcile against.

## Architecture

```
Simple Product        -> one canonical base price per UOM (product_variant_id = NULL)
Variant-managed Product -> the Product parent KEEPS its own canonical price per UOM
                           (unlike VAR-INV-1's InventoryState — see below)
                           + each concrete Variant MAY have its own explicit price per UOM
ProductUnitPrice       -> the canonical base-price authority (this milestone, new)
PriceListItem          -> override authority (pre-existing, now Variant-aware)
```

**Why the parent keeps a price, unlike `InventoryState`'s "no parent identity"
rule:** VAR-INV-1 forbids a `variant_managed` parent from having its own
inventory identity because there is no legitimate reading of "the parent's
stock" once concrete Variants exist. Pricing is different: the task's own §6
makes the parent's base price an **explicitly approved fallback tier** for a
Variant with no price of its own for the same unit ("Variant explicit price →
otherwise canonical Product/base price for that SAME UOM → otherwise
unresolved"). Removing the parent's price would break that fallback the
contract requires. `ProductUnitPrice` is therefore classified differently from
`InventoryState` in `ProductReferenceRegistry` too (see Persistence, below).

**Fallback semantics (`ProductPricingService::resolveSellable()`):** Variant
explicit price for the unit → else Product's own explicit price for the
**same** unit → else unresolved (`null`). Never across units, never
factor-derived. `resolveExplicit()` (no fallback) is the primitive both
`resolveSellable()` and the Commerce/POS resolvers use to read a canonical row
directly.

**UOM identity:** `unit_name` is always stored as the concrete resolved unit
name (never `null`), matching `PriceListService`'s own existing convention
exactly (`UnitConversion::resolve()` returns `null` for "base"; the stored value
substitutes `Product.unit`). No new UOM-representation concept was introduced.

**`Product.sale_price` backward compatibility:** `products.sale_price` is
**frozen** — never written again, kept only to avoid a migration risk (see
Persistence). `Product` exposes `sale_price` as an `Attribute::make()`
read-through accessor to its own canonical `ProductUnitPrice` row (unit =
`Product.unit`), reusing VAR-INV-1's exact pattern (frozen column + accessor +
pending-value capture-on-save for legacy direct assignment such as
`Product::create(['sale_price'=>…])`, still used by dozens of existing test
fixtures and by `Product::update()` callers). One correction made during
testing (§ Backward compatibility) was needed beyond the VAR-INV-1 template: the
accessor's `get()` must see its own not-yet-saved pending value immediately
(matching how a normal Eloquent attribute behaves before `save()`), because
`PosController::products()` uses `$product->setAttribute('sale_price', …)` as a
**transient, never-persisted** display override when building the catalog
response — a usage pattern VAR-INV-1's `quantity_on_hand`/`avg_cost` never had
to handle.

**Barcode:** untouched. `ProductBarcode` still carries no price column;
`unit_name` remains its only UOM reference; multiple barcodes resolving to the
same Product/Variant + UOM already resolved to the same canonical price before
this milestone (there was nothing else to read) and continue to, now backed by
`ProductUnitPrice` for the cases that previously had no canonical price at all.

## Persistence

- **New table `product_unit_prices`**: `id, tenant_id, product_id,
  product_variant_id (nullable, FK cascadeOnDelete), unit_name, price (bigint),
  timestamps`. Two `CREATE UNIQUE INDEX ... WHERE ...` partial indexes on this
  **brand-new table** (no `Schema::table` rebuild risk): `(product_id,
  unit_name) WHERE product_variant_id IS NULL` (at most one simple/parent price
  per unit) and `(product_variant_id, unit_name)` (NULL≠NULL in SQL, so this
  alone never constrains simple rows — only prevents duplicate Variant prices).
  Verified this pattern is identical to `2026_09_26_010000_create_inventory_states.php`
  and to the pre-existing `2025_01_01_000053_branch_scoped_document_numbering.php`.
- **`price_list_items`**: additive `ADD COLUMN product_variant_id` (nullable
  FK, cascadeOnDelete) — SQLite supports this natively, no rebuild. The old
  unique `(price_list_id, product_id, unit_name)` is dropped and replaced with
  the same two-partial-index pattern, scoped by `price_list_id` too. **No CHECK
  constraint exists on either table** (confirmed by reading every migration
  touching them) — the specific SQLite regression class the task named (a lost
  CHECK constraint via `Schema::table` rebuild) has nothing to lose here.
- **Backfill (deterministic, no invention):** for every existing product, one
  `product_unit_prices` row is inserted directly from `products.sale_price` at
  its current `products.unit` — a straight column-to-row copy, not a guess. No
  row is created for any alternate unit or any Variant (none existed to seed).
- **Verified on both engines, fresh install:** SQLite via `setup.sh`'s full
  `migrate:fresh` (target migration ran cleanly); PostgreSQL 16 (local
  `nibras`/`nibras`) via `php artisan migrate:fresh --force` (same). No upgrade
  (non-fresh) path exists to break — the new table is new, and the one added
  column is purely additive.
- **`ProductReferenceRegistry` classification — a real, load-bearing
  decision, not copy-pasted from `InventoryState`:** `ProductUnitPrice`'s base
  (parent) row is created **eagerly** at every product's creation (`sale_price`
  is a *required* field, unlike `InventoryState`'s lazy-only-on-first-movement
  design). Classifying it `COMMERCIAL_LIVE` — the naive first attempt — would
  have made **every product's own base price permanently block its own
  deletion**, since that row always exists from the first second: an actual
  regression, caught by re-running `ProductLifecycleTest` before finalizing
  (`an_unused_product_can_still_be_soft_deleted_and_releases_its_sku` failed).
  `ProductUnitPrice` is instead classified **`OWNED_CHILD`** — it never blocks
  Product-level deletion, and is explicitly cleaned up in
  `ProductLifecycleService::delete()` alongside barcodes/media, matching how
  `ProductOption`/`SkuRegistryEntry` are already treated. **Variant-level**
  protection (a Variant's own explicit price must not silently vanish on
  delete) is instead an explicit guard in `ProductVariantService::deleteVariant()`
  (mirroring VAR-INV-1's own `inventoryState()->exists()` guard exactly), which
  by construction only ever runs on a Variant that already has zero footprint in
  every other sense.

## Files changed

**New:**
- `database/migrations/2026_09_27_010000_create_product_unit_prices.php`
- `app/Models/ProductUnitPrice.php`
- `app/Services/ProductPricingService.php` — `resolveExplicit()`,
  `resolveSellable()`, `setPrice()` (race-safe upsert, own `DB::transaction()`),
  `clearPrice()`, `assertIdentityConsistent()` (variant↔product↔tenant)
- `tests/Feature/ProductUnitPriceTest.php` (19 tests)
- `tests/Feature/ProductUnitPricePostgresConcurrencyTest.php` (3 tests)

**Modified:**
- `app/Models/Product.php` — `sale_price` accessor (frozen column + read-through
  + pending-value capture, including the transient-read fix above),
  `unitPrices()` relation
- `app/Models/ProductVariant.php` — `unitPrices()` relation (no price column
  existed before; none added — pricing lives entirely in `ProductUnitPrice`)
- `app/Models/PriceListItem.php` — `product_variant_id` fillable + `variant()`
- `app/Services/PriceListService.php` — `resolve()`/`upsertItem()` gained a
  trailing optional `?ProductVariant $variant = null` with the same fail-closed
  identity check as `ProductPricingService`
- `app/Services/Commerce/CommercePriceResolver.php` — the alternate-unit branch
  (previously hardcoded `null`) now consults `ProductPricingService::resolveExplicit()`
  before giving up; base-unit branch (`Product.sale_price`) untouched, since the
  accessor already makes it correct with zero code change
- `app/Services/Accounting/PosCustomerPriceListResolver.php` — same alternate-unit
  fallback added to `posPriceFor()`; `catalogUnitsFor()` now also surfaces an
  alternate unit's canonical price when no price-list item exists for it, and
  gained an explicit `whereNull('product_variant_id')` filter (a real bug this
  milestone would otherwise have introduced: without it, a future Variant-specific
  `PriceListItem` row would leak into the Product-only POS catalog)
- `app/Services/ProductVariantService.php` — `deleteVariant()` guard for an
  explicit Variant price (`ProductUnitPrice` or `PriceListItem`)
- `app/Services/ProductLifecycleService.php` — cleans up the Product's own
  `ProductUnitPrice` row on real delete (`OWNED_CHILD`)
- `app/Services/ProductWorkbookService.php` — one `PriceListItem` export query
  gained the same `whereNull('product_variant_id')` guard (Product-only
  workbook; out of scope for Variant awareness per §18)
- `app/Support/ProductListFilters.php` — `sale_price` range filters/sort
  (previously raw SQL against the now-frozen column) now join the canonical
  simple-identity row, mirroring VAR-INV-1's identical `quantity_on_hand` fix
- `app/Support/ProductReferenceRegistry.php` — `ProductUnitPrice` classified
  `OWNED_CHILD` (see Persistence, above, for why not `COMMERCIAL_LIVE`)

## Backward compatibility

- **`Product.sale_price`**: read/write API unchanged (`(int) $product->sale_price`,
  `Product::create(['sale_price'=>…])`, `$product->update([...])` all work
  identically). One real bug found and fixed during testing: a **transient**
  `setAttribute('sale_price', …)` (never followed by `save()`, used by
  `PosController::products()` to inject a price-list-adjusted display value)
  was silently swallowed by the naive accessor design (it captured the value as
  "pending" but the very next read re-ran the canonical DB lookup, discarding
  the transient override). Fixed by having the accessor's `get()` prefer an
  unflushed pending value first — exactly how an ordinary Eloquent attribute
  behaves before `save()`. Caught by the existing `PosCheckoutTest::customer_price_list_reprices_the_pos_catalog_and_is_enforced_before_checkout`
  test, not a new one — a real pre-existing behavior this milestone had to
  preserve, not invent.
- **Existing simple Products**: fully unaffected — `ProductListFilters`'s
  `sale_price_gte/lte/eq` filters and `sort=sale_price` were raw SQL against the
  now-frozen column and needed the same join-based fix VAR-INV-1 already applied
  to `quantity_on_hand`; caught by `ProductDataExplorerTest`/`ProductExportTest`
  before finalizing, both now green.
- **Price Lists**: unchanged for every existing (non-Variant) call — `product_variant_id`
  defaults `null` everywhere it isn't explicitly passed; existing uniqueness,
  precedence, and API behavior are identical.
- **Commerce simple-Product behavior**: `CommercePriceResolver`'s public
  signature (`resolve(string $productId, …)`) is completely unchanged — no
  Variant parameter was added to it, per the explicit Commerce boundary (§19).
  Only its internal alternate-unit fallback gained a new tier; every existing
  `CommercePriceResolverTest` case (33 tests, including the ones proving "no
  factor-derived price" and "alt unit stays unresolved without an explicit
  item") passes unmodified because none of them create a canonical alt-unit
  price — the new tier only activates for identities this milestone actually
  seeds.
- **POS simple-Product behavior**: `PosCustomerPriceListResolver`'s public
  signatures are unchanged; `posPriceFor()` and `catalogUnitsFor()` gained the
  same additive alternate-unit fallback, verified via the full `Pos*Test` suite
  plus the specific `PosCheckoutTest` regression above.

## Tenant Isolation

- `ProductPricingService::assertIdentityConsistent()` / `PriceListService::assertIdentityConsistent()`
  — explicit checks (not relying on `TenantScope` alone) run **before** any
  query or write: Variant belongs to the given Product; Variant's tenant
  matches the Product's tenant.
- **Negative tests** (`ProductUnitPriceTest`): a product/variant created under a
  different tenant is invisible under the active tenant's scope
  (`a_cross_tenant_product_is_rejected`); a raw cross-tenant Variant instance
  obtained via `withoutGlobalScopes()` (simulating an ID that slipped past the
  normal scope) is rejected fail-closed before any row is touched, with the
  row count asserted unchanged (`a_cross_tenant_variant_is_rejected`); a
  Variant belonging to a *different Product* under the *same* tenant is
  likewise rejected fail-closed with no row created
  (`a_variant_from_a_different_product_is_rejected_fail_closed`); the same
  mismatch is verified for `PriceListService::upsertItem()`
  (`a_price_list_item_mismatched_variant_is_rejected_fail_closed`).
- Guessed UUIDs, cross-tenant update/delete/resolution all fail closed by the
  same `assertIdentityConsistent()` check plus the pre-existing `TenantScope`
  the codebase already relies on everywhere else — no new query bypasses it.

## Concurrency

`ProductPricingService::setPrice()` owns its own `DB::transaction()` (unlike
`InventoryService::applyReceipt()`, which requires the caller's transaction) —
a deliberate difference: setting a price is a self-contained operation with no
larger business transaction to join, so making it atomic internally is the
smaller/safer contract. Inside: `firstOrCreate()` attempt, `QueryException`
caught on a unique-constraint race, then a final `lockForUpdate()` re-select
and conditional update — the DB partial-unique-index is the real authority,
not `firstOrCreate()` alone (same documented convention as `InventoryState`/`SkuRegistryEntry`).

**Real PostgreSQL concurrency proof** (`ProductUnitPricePostgresConcurrencyTest`,
`pcntl_fork()` with independent connections per child, identical style to the
VAR-INV-1/VAR-CORE-1 concurrency tests):

1. Two concurrent writes to the *same* Product+unit price → exactly one row,
   value is one of the two competing writes (never corrupted, never duplicated).
2. Concurrent first-time price creation for two **sibling Variants** → each
   lands with its own correct price, zero cross-contamination.
3. A duplicate simple-Product base-price race (both writing the base unit
   explicitly) → exactly one row, partial unique index is the real guarantor.

All three pass consistently across 3 consecutive re-runs on real PostgreSQL 16.
Skipped automatically on SQLite or without `pcntl`, matching repo convention.

## Tests — exact results

**SQLite (targeted, progressive):**
- `ProductUnitPriceTest`: **19/19 passed**, 39 assertions
- Targeted regression (`CommercePriceResolverTest`, `PriceListTest`,
  `CustomerDefaultPriceListTest`, `ProductLifecycleTest`,
  `ProductReferenceClassificationGuardTest`, `ProductReferenceRegistryTest`,
  `ProductVariantCoreTest`, `UnitTemplateTest`, `UnitTemplateMutationGuardTest`):
  **132/132 passed**, 887 assertions
- Broad sweep (`Product|Commerce|Pos|PriceList|UnitTemplate|Workbook`, first
  pass): 4 real failures found and fixed (see Backward compatibility) — the
  `PosCheckoutTest` transient-`sale_price` bug and the `ProductListFilters`
  raw-SQL `sale_price` filter/sort bug (the latter caused both
  `ProductDataExplorerTest` and `ProductExportTest` failures)
- Broad sweep (same filter, **re-run after fixes**): **1188/1188 passed**
  (7520 assertions), 191 test classes, zero failures except the pre-existing,
  environment-only `bcmath`-extension gap in 6 Fuel tests (`php -m | grep
  bcmath` confirms it is not installed in this sandbox — unrelated to this
  change, the same gap already documented in the VAR-INV-1 report)

**PostgreSQL 16 (targeted + concurrency):**
- Fresh `migrate:fresh` succeeded end-to-end
- `ProductUnitPriceTest`, `ProductUnitPricePostgresConcurrencyTest`,
  `CommercePriceResolverTest`, `PriceListTest`, `CustomerDefaultPriceListTest`,
  `ProductLifecycleTest`, `ProductReferenceClassificationGuardTest`,
  `ProductReferenceRegistryTest`, `ProductVariantCoreTest`, `InventoryStateTest`,
  `InventoryTest`, `PosCheckoutTest`, `ProductDataExplorerTest`,
  `ProductExportTest`: **215/216 passed** on first run (one concurrency test's
  own fixture bug — a product missing its `carton` unit template — found and
  fixed), **all green (216/216, 1372 assertions)** after the fix, re-confirmed
- `ProductUnitPricePostgresConcurrencyTest`: 3/3, re-run 3× consecutively,
  consistent
- Broader sweep (`Product|Commerce|Pos|PriceList|UnitTemplate|Workbook|Inventory`
  filter) on PostgreSQL: started as the final broader-regression step, but its
  results are **invalid and discarded**, not reported as a real signal either
  way — the `.env` was reverted from PostgreSQL back to SQLite (routine
  end-of-session cleanup) while this background run was still executing, and
  it then failed almost every remaining test with
  `SQLiteDatabaseDoesNotExistException` — an artifact of the environment being
  swapped mid-run, not a code defect. This is disclosed explicitly rather than
  silently omitted or, worse, misreported as a real regression. The genuine
  evidence this report's PASS status rests on is: the full targeted PostgreSQL
  run immediately above (216/216, captured *before* the environment was
  touched again) and the full SQLite broad sweep (1188/1188) reported earlier
  in this section. Per the task's own instruction, a full/broad local suite is
  not mandatory when it becomes time-consuming or is compromised this way —
  GitHub CI is the independent broad verification after push.

**Not run:** frontend `tsc`/build (no `web/src` file references anything
renamed or removed by this milestone — no API contract or generated-type
change occurred, confirmed by the fact that every JSON field this PR touches
keeps its exact existing name/type/unit).

## Build / CI

- Local: all targeted and broad-filtered suites above are green on both
  engines, except the documented pre-existing Fuel/`bcmath` gap.
- GitHub CI: not yet run for this PR (push happens after this report).

## Risks / Remaining (explicitly deferred)

- **HTTP/API layer for unit-price and Variant-price CRUD was intentionally not
  added.** `StoreProductRequest`/`UpdateProductRequest` and
  `ProductVariantService::createSingleVariant()`/`updateVariant()` were left
  untouched; `PriceListController`/`StorePriceListItemRequest` were left
  untouched too (Variant identity is reachable only via `PriceListService`'s
  new optional parameter at the domain layer). The task explicitly discourages
  redesigning the Product screen or inventing new competing payload shapes
  when no existing structure exists to extend, and no test in the required
  list exercises an HTTP endpoint for this — the domain/service layer
  (`ProductPricingService`, `PriceListService`) is the capability a future
  screen (VAR-DOC-1/VAR-POS-1/VAR-COM-1, or a dedicated pricing UI PR) can wire
  up without any further backend redesign.
- **Cart/Checkout/Storefront/POS Variant wiring**: not touched, per §19/§20 —
  `CommercePriceResolver`/`PosCustomerPriceListResolver` gained no new public
  parameter for a Variant; only their existing Product-only alternate-unit gap
  was closed.
- **VAR-DOC-1**: no document line (`InvoiceLine`, `QuoteLine`, `purchase_lines`)
  carries `product_variant_id` yet, so `min_sale_price` enforcement and
  historical-price snapshotting continue to operate exactly as before — nothing
  for this milestone to touch there.
- **VAR-MEDIA-1, VAR-POS-1, VAR-COM-1, VAR-REPORT-1**: untouched, as instructed.

## Git

- Branch: `claude/var-price-1-variant-uom-pricing`
- Base SHA: `ec9ee5c594d4f078224b4c90bd5f1cb8be53c553`
- Head SHA: `68253161714574b43e9e51f3575103fdd842f43f` (plus one follow-up commit
  documenting the discarded broader-sweep environment artifact above)
- Working tree: clean after commit (verified before push)

## Recommendation

**READY FOR REVIEW.**
