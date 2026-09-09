# PR-COM-3 — CommerceListing Foundation — Implementation Report

## 1. Executive Summary

Adds `App\Models\CommerceListing` + `App\Services\Commerce\CommerceListingService`,
separating ERP `Product` core truth (SKU, barcode, UOM, inventory/cost
identity — untouched) from channel-specific Commerce presentation:
`Product → CommerceListing ← SalesChannel`. One new, purely additive table.
No price, no inventory/ATS field, no warehouse field, no accounting/ZATCA
effect, no API/UI, no Product Variants, no store builder, no automatic
legacy listings. Two small, well-justified edits to
`CommerceModuleBoundaryTest` (§24/§36) — no other existing file touched.

## 2. Base SHA / Head SHA

- **Base SHA:** `b3815293ad2f065d457e2bd66da4a00ce795f4f4` (`origin/main` at
  task start — PR-COM-2B's merge commit, confirmed via `git fetch origin main`
  + `git log --oneline -5 origin/main` before branching; matches the SHA
  given in the task).
- **Head SHA (before this report):** `9047591a9b136507368cdb8096ccd0d6008a11b6`.

## 3. Binding references

Read (targeted): `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`'s PR-COM-3
section (`# PHASE 3 — Commerce catalog presentation`, reproduced and
analyzed field-by-field in §5/§10 below — this is the primary binding
contract, more specific than ADR-level text for this PR), plus
`PR-COM-2A`/`PR-COM-2B` implementation reports, `app/Support/CommerceBoundary.php`,
`app/Services/Commerce/AvailableToSellService.php`,
`app/Services/Commerce/InventoryReservationService.php`,
`app/Services/Commerce/FulfillmentPolicyService.php`, `app/Models/SalesChannel.php`.
No dedicated ADR exists for CommerceListing specifically (unlike ADR-02 for
Reservation or ADR-03 for Channel/Fulfillment) — the master plan's
PR-COM-3 entry is the most specific source, so it governs directly. No
re-audit of the Existing Architecture Audit or Evidence Passes beyond what
was already internalized from prior Commerce PRs — verified current-code
reality directly (§4), per the task's own instruction not to re-audit.

## 4. AWJ VERIFIED findings

- **`Product`** (`app/Models/Product.php`): `name`, `name_en`, `description`,
  `sku`, `barcode`, `unit`, `type`, `is_active` (boolean, default `true`,
  no `SoftDeletes`) all confirmed present by reading the model file
  directly. No `description` truncation/nullability surprise — plain
  nullable-by-DB-default text-ish column, used here as the fallback source
  for `CommerceListing::displayDescription()`.
- **`ProductMedia`** (`database/migrations/2025_01_01_000089_create_product_barcodes_and_media.php`):
  already has `sort_order` (`unsignedSmallInteger`, indexed
  `(tenant_id, product_id, sort_order)`) — a **product-wide**, not
  channel-specific, ordering already exists. This directly informs §13:
  the master plan's "media ordering/selection using existing media
  capabilities where possible" is satisfiable by a future Storefront API
  simply reading `Product::media()` (already ordered) — no new
  Listing-specific media table is needed for that phrase to be honored.
- **`PriceListItem`** classification precedent
  (`app/Support/ProductReferenceRegistry.php`, pre-existing): `COMMERCIAL_LIVE`,
  `restrictOnDelete()` on `product_id`
  (`database/migrations/...create_price_lists...php`, verified directly:
  `$table->foreignUuid('product_id')->constrained()->restrictOnDelete();`).
  This is the **exact** precedent this PR's `commerce_listings.product_id`
  FK and `ProductReferenceRegistry` classification both mirror (§14/§24).
- **`FulfillmentPolicy`** (PR-COM-2B) precedent for `sales_channel_id`
  FK behavior: `cascadeOnDelete()`, justified there as "current
  configuration, not an audit trail." Re-applied identically here for
  `commerce_listings.sales_channel_id` (§22).
- **Three reflection-based "every model" guards** (checked proactively
  before writing any model code, per the lesson from PR-COM-1B/2A/2B):
  `BranchIsolationGuardTest` (satisfied by `implements CompanyWide`),
  `NumberingSettingsTest` (N/A — `CommerceListing` does not use
  `GeneratesDocumentNumbers`), `ProductReferenceClassificationGuardTest`
  (**does** apply — `CommerceListing` has a `product_id` column, confirmed
  before writing the model per the task's own explicit warning in §28 that
  this PR "may differ from COM-2B" on this exact point — COM-2B's
  `FulfillmentPolicy` had no `product_id` at all and so never triggered
  this guard).
- **A fourth, previously-latent issue found on the first proactive guard
  run** (not from the full suite this time — checked before writing the
  service/tests, immediately after adding the migration+model+registry
  entry): `CommerceModuleBoundaryTest` (PR-COM-0) failed on two counts —
  `App\Models\CommerceListing` was still literally named in its
  `NOT_YET_MODELS` list (exactly the same situation PR-COM-2A already hit
  and fixed for `SalesChannel`), **and** its
  `no_commerce_migration_is_introduced_yet` assertion failed because this
  PR's migration filename (`..._create_commerce_listings_table.php`)
  literally contains the substring `"commerce"`. Investigated the test's
  own class-level docblock: "لا نموذج عمل ولا مسار API ولا ترحيل قاعدة
  بيانات خاص بـ Commerce تسرّب **قبل PR-COM-1A**" — its own stated
  protection window for *all three* checks (model/route/migration) was
  "before PR-COM-1A," a window that closed three PRs ago. The migration
  check had only kept passing since then by naming coincidence (COM-1B/2A/2B's
  table names — `inventory_reservations`, `sales_channels`,
  `fulfillment_policies` — never happened to contain the literal word
  "commerce"), not because it was still guarding anything real. See §24
  for the fix.

## 5. CommerceListing domain definition

`CommerceListing` answers exactly one question: *is this product offered
for sale through this channel, and what channel-specific commercial
presentation data does it carry?* It never answers stock, ATS, fulfillment
warehouse, final price, discount, tax, payment, or reservation questions —
all of those remain the responsibility of their existing, unmodified owners
(`ProductWarehouseStock`/`AvailableToSellService`, `FulfillmentPolicy`,
future `PR-COM-4A` pricing, `InventoryReservationService`,
`InvoiceService`/`LedgerService`).

## 6. Product Core vs Commerce Presentation boundary

`Product` gained **zero** new columns in this PR — `products` was not
touched at all (verified: `git status --porcelain`, §35, shows no change
to `Product`'s migration or model). SKU, barcode, UOM, inventory identity
(`track_inventory`, `quantity_on_hand`, `avg_cost`), and accounting/cost
semantics (`sales_account_id`, `cogs_account_id`) all remain exclusively on
`Product`. `CommerceListing` carries only `title`/`description` (optional
channel-facing overrides) and `is_published` — nothing that duplicates or
shadows core product identity.

## 7. Product ↔ Channel cardinality

**At most one `CommerceListing` per `(product_id, sales_channel_id)` pair**
— this is the master plan's own explicit invariant for this PR
("`ADR APPROVED`"-equivalent, since it's the master plan's own PR-COM-3
text, not a DERIVED guess): "one Product + one SalesChannel → at most one
CommerceListing." Enforced at the DB level via
`unique(['product_id', 'sales_channel_id'])` — not an application-only
check. A product may have zero, one, or many listings across different
channels (published in Mobile, unpublished in Web, etc. — the exact
scenario the task's own §5 example describes), each independently
configurable. `CommerceListingService::configure()` upserts
(`updateOrCreate` keyed on the pair) rather than ever creating a second row
for the same pair — verified by
`a_product_and_channel_never_produce_more_than_one_listing`.

## 8. Schema

`database/migrations/2026_09_15_010000_create_commerce_listings_table.php`
— one new table, `commerce_listings`, purely additive:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `tenant_id` | uuid, FK `tenants`, cascade | auto-filled by `BelongsToTenant` |
| `product_id` | uuid, FK `products`, **restrict** | see §22 |
| `sales_channel_id` | uuid, FK `sales_channels`, **cascade** | see §22 |
| `title` | string, nullable | optional channel-facing override, §10 |
| `description` | text, nullable | optional channel-facing override, §10 |
| `is_published` | boolean, default `false` | §9 |
| `created_at`, `updated_at` | timestamp | |

Constraint: `unique(product_id, sales_channel_id)` (§7). No secondary
index was added — no query shape beyond the unique-indexed lookup exists
yet in this PR (matching PR-COM-2A/2B's own minimalism reasoning).

`app/Models/CommerceListing.php`: `extends BaseModel implements CompanyWide`,
`use ResolvesBranchReferences` (for `product()`, matching
`ProductWarehouseStock`/`InventoryReservation`'s exact reasoning — a
reference relation must not be silently hidden by an active branch
context), `$fillable = [tenant_id, product_id, sales_channel_id, title,
description, is_published]`, plus `displayTitle()`/`displayDescription()`
(§11).

## 9. Publication semantics

**Minimum foundation only**: a plain `is_published` boolean, default
`false`. No approval workflow, no scheduled publishing, no publishing
history, no versioning, no draft-review workflow — none of these were
requested by the master plan's PR-COM-3 text, and the task explicitly
forbade inventing them. Toggled via a plain `$listing->update(['is_published' => ...])`
call, matching `SalesChannel`/`Warehouse`/`PaymentMethod`'s established
enable/disable convention exactly (no dedicated `publish()`/`unpublish()`
service method — there is no invariant to protect beyond the boolean flip
itself; see §17 for why publish state is deliberately *not* coupled to
product sellability checks). This single flag also satisfies the master
plan's separate "channel visibility" bullet: because a listing is already
scoped to exactly one channel by construction (§7), "is this listing
visible on its channel" and "is this listing published" collapse into the
same question — no second visibility dimension was needed.

## 10. Presentation fields and rationale

The master plan's PR-COM-3 field list, applied field-by-field:

| Master plan bullet | Decision | Rationale |
|---|---|---|
| publish state | ✅ `is_published` | §9 |
| storefront title/description where needed | ✅ `title`/`description` | Directly named; nullable overrides, §11 |
| SEO metadata where needed | ❌ deferred, `OPEN/Future` | "Where needed" is conditional; nothing consumes SEO tags yet (no storefront/routing exists in this or any merged PR); a future PR adds dedicated `meta_title`/`meta_description` additively when a real Storefront needs to render `<title>`/`<meta>` tags that may legitimately differ from display copy |
| channel visibility | ✅ satisfied by `is_published` + the 1-row-per-channel model | §9 |
| storefront categorization/collection mapping "only to the level required by the first slice" | ❌ deferred, `OPEN/Future` | No category/collection model exists to map to yet; the task's own §11 explicitly permits declaring this `OPEN / Future PR` when undecided, and "ERP Category == Storefront Category" must not be assumed |
| media ordering/selection "using existing media capabilities where possible" | ❌ no new association | `ProductMedia.sort_order` already exists and is product-wide (§4); "where possible" is read here as "prefer not building a new association," and no requirement demands per-channel-different media sets in this PR |

No field was added merely because it appeared on the conceptual list —
each was checked against "is this needed now, and does Product/ProductMedia
already have it" (task §7's own required discipline) before being
included or explicitly deferred.

## 11. Fallback semantics

**`DERIVED`** (the master plan does not spell out the exact fallback
mechanics): `title`/`description` are stored as `null` unless a caller
explicitly overrides them — **never copied from `Product` at listing
creation**, per the task's explicit instruction not to create duplicated
truth for convenience. The fallback is resolved only at *read* time, via
two small model methods:

```php
public function displayTitle(): string       { return $this->title ?? $this->product->name; }
public function displayDescription(): ?string { return $this->description ?? $this->product->description; }
```

This means a later change to `Product::$name` is automatically reflected
by every listing that has no title override — there is exactly one place
product identity data lives. Verified by two tests:
`display_title_and_description_fall_back_to_the_product_when_no_override_is_set`
and `display_title_and_description_prefer_the_channel_override_when_set`.

## 12. Slug semantics

**Not implemented — `OPEN / Future PR`.** The master plan's PR-COM-3 field
list does not name "slug" explicitly (unlike "title/description" and "SEO
metadata," which are named). Per the task's own explicit instruction (§9):
"لا تعتمدها إلا بعد التحقق من routing semantics والخطة" — no URL routing
or Storefront exists in any merged Commerce PR to date, so committing to a
uniqueness scope (`tenant + channel + slug`? `tenant + slug` globally
across channels?) now would be exactly the kind of unverified assumption
the task told me not to guess at. `SalesChannel.slug` (PR-COM-2A) is a
different concept — a stable *machine identity* for the channel itself,
not a URL path segment for a listing — and is not reused here for that
reason.

## 13. ProductMedia decision

**No new association, no changes to `ProductMedia` or its storage/upload
pipeline.** See §4/§10 — `ProductMedia.sort_order` already exists and is
product-wide; the master plan's "using existing media capabilities where
possible" phrase is read as confirming this rather than requesting a new
per-channel media table. Flagged here for the record as the topic the task
asked me to register for the future (§10 of the task): if a future PR
needs genuinely different image sets per channel (not just reordering the
same set), it will need its own additive join table — not decided or
built here.

## 14. Category/Collection decision

**`OPEN / Future PR`**, per the task's own explicit permission (§11): "لا
تبنِ storefront category/collection taxonomy إلا إذا COM-3 يطلبها صراحةً...
إذا غير محسومة: OPEN / Future PR." No `Collection`/`StorefrontCategory`
model or mapping was created. `Product.category`/`Product.category_id`
(ERP catalog category) remain exactly what they are — an ERP catalog
concept, not automatically a Storefront collection, per the task's
explicit warning not to assume `ERP Category == Storefront Category`.

## 15. Pricing boundary

**Zero pricing fields or logic.** No `price`, `sale_price`, `discount`,
`promotion`, `coupon`, tax calculation, or price-list resolution exists
anywhere in `CommerceListing` or `CommerceListingService`. `PriceList`/
`PriceListItem` were not touched — verified by a dedicated test,
`configuring_a_listing_never_mutates_price_list_items`
(`PriceListItem::count() === 0` after any listing operation). `PR-COM-4A`
(Commerce Price Resolution) remains a fully separate, later PR — its scope
was not touched.

## 16. Inventory / ATS boundary

**Zero inventory fields or logic.** No `quantity_on_hand`, reserved
quantity, ATS value, or `warehouse_id` exists on `CommerceListing`.
Verified by dedicated tests:
`configuring_a_listing_creates_no_inventory_reservation_or_stock_movement`
(`InventoryReservation::count() === 0`, `StockMovement::count() === 0`),
`configuring_a_listing_never_mutates_product_warehouse_stock_quantity`
(raw `product_warehouse_stock.quantity` unchanged before/after), and
`configuring_a_listing_never_changes_available_to_sell`
(`AvailableToSellService::forWarehouse()`'s `onHand`/`availableToSell`
bit-for-bit identical before/after).

## 17. Fulfillment boundary

**No `warehouse_id` on `CommerceListing`.** Verified by
`configuring_a_listing_never_creates_a_fulfillment_policy`
(`FulfillmentPolicy::count() === 0`). Warehouse selection remains
exclusively `SalesChannel → FulfillmentPolicy → Warehouse`
(PR-COM-2B, unmodified in this PR).

## 18. Tenant isolation

`CommerceListing extends BaseModel`, so `TenantScope` filters every query
automatically and `tenant_id` is never accepted from a caller — **zero**
`withoutGlobalScope(TenantScope::class)`/`withoutGlobalScopes()` anywhere
in this diff (grep-verified, same standard as every prior Commerce PR).
Per the task's explicit warning (repeated identically for every Commerce
PR in this sequence): **FK constraints alone do not prove same-tenant
ownership.** `CommerceListingService::configure()` therefore explicitly
checks `Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->exists()`
and `SalesChannel::query()->whereKey($salesChannelId)->exists()` — both
automatically `TenantScope`-filtered — *before* any write, mirroring
`InventoryReservationService::acquire()` and
`FulfillmentPolicyService::setFixedWarehouse()` exactly. `Product` is
`BranchScoped`/`BranchShareable` (unlike `SalesChannel`/`Warehouse`, which
are plain `CompanyWide`), so the `Product` existence check needs the same
`BranchScope` bypass `AvailableToSellService`/`InventoryReservationService`
already use, for the identical reason: a listing is configured for an
explicitly named product, not filtered by whichever branch happens to be
"active" in the calling context.

Verified negative tests (§29): a foreign-tenant product ID rejected; a
foreign-tenant channel ID rejected; an existing listing invisible to a
different tenant (`CommerceListing::count() === 0` under Tenant B's
context); a `configure()` call reusing Tenant A's real product+channel IDs
under Tenant B's context rejected (cross-tenant mutation attempt).

## 19. Branch semantics

`CommerceListing` carries **no `branch_id`** column — verified directly
(migration and `$fillable`, no such column exists to even test its
absence against, unlike PR-COM-2B's explicit "does not require a branch"
test which asserted absence from an existing fillable list; here the
column was simply never added). `Channel != Branch`, `Listing != Branch`,
`Warehouse != Branch` — none of these relationships were touched, weakened,
or bridged in this PR.

## 20. Product lifecycle interaction

Investigated `Product`'s actual lifecycle: `is_active` (boolean, no
`SoftDeletes`). Per the task's explicit instruction (§17) to *not* invent
a new Product lifecycle or merge "listing is published" with "product is
operationally sellable" into one resolver: `CommerceListingService::configure()`
performs **no** check of `Product.is_active` at all. A listing can be
configured (and even published) for a product that is currently inactive —
verified by `an_inactive_product_can_still_carry_a_listing_configuration`.
This is deliberate: whether an inactive product should actually be
purchasable is a separate concern for a future sellability resolver (not
built here), not something this foundation PR should silently decide by
gatekeeping listing configuration.

## 21. SalesChannel lifecycle interaction

Investigated `SalesChannel::is_active` (PR-COM-2A). Per the task's
explicit instruction (§18): disabling a channel must **not** delete or
alter its listings — historical/configuration data must not vanish merely
because a channel is toggled off. Verified directly:
`disabling_a_channel_does_not_delete_or_alter_its_listings` disables a
channel after configuring and publishing a listing, then asserts the
listing row, its title, and its `is_published` value are all completely
unchanged. No code path in `CommerceListingService` reads or reacts to
`SalesChannel.is_active` at all in this PR — any future public listing
resolution (e.g., a Storefront API) deciding to require an active channel
is that future PR's decision, not retrofitted here.

## 22. FK / delete semantics

- **`product_id` → `restrictOnDelete()`**, and `CommerceListing` is
  classified `COMMERCIAL_LIVE` in `ProductReferenceRegistry` (§24) — an
  **exact** mirror of `PriceListItem`'s own precedent (§4). Rationale: a
  `CommerceListing` is a *live commercial reference* (channel publication
  configuration), not a historical document line and not an inventory
  footprint; silently deleting the product it points to would break a live
  channel configuration without warning, exactly the failure
  `COMMERCIAL_LIVE`/`restrictOnDelete()` exists to prevent for
  `PriceListItem` already.
- **`sales_channel_id` → `cascadeOnDelete()`**, matching
  `FulfillmentPolicy.sales_channel_id`'s precedent (PR-COM-2B): this table
  is current configuration, not an audit/historical record the way a
  reservation is — a listing pointing at a genuinely (hard-)deleted
  channel is meaningless, and `SalesChannel` normally goes through
  `SoftDeletes` anyway, so a true hard delete is rare and deliberate.
- **Future note (documented, not built)**: the task flags that
  `CommerceListing` may later be referenced by `CommerceOrder` snapshots.
  That does not exist yet, and no schema or FK decision here was made in
  anticipation of it — when `CommerceOrder` is built, that PR will decide
  whether it needs its own snapshot of listing data (likely yes, per the
  general Commerce Order/Invoice snapshot pattern already established by
  ADR-01) rather than a live FK dependency on a mutable `CommerceListing`
  row.

## 23. DB constraints / indexes

`unique(product_id, sales_channel_id)` is the only constraint beyond the
standard FKs — the cardinality invariant itself (§7). No secondary index
was added (§8) — no query shape beyond the unique-indexed lookup exists
yet.

## 24. Guard classification

**Two guard-related changes were required**, both found by proactively
checking the known guards before writing the service/tests (not
discovered via a surprise full-suite failure, though the second one below
was specific to this PR's exact migration filename and could only be
observed once that filename existed):

1. **`ProductReferenceClassificationGuardTest`** required
   `CommerceListing` (which carries `product_id`) to be classified.
   Classified `COMMERCIAL_LIVE` in `app/Support/ProductReferenceRegistry.php`,
   mirroring `PriceListItem` exactly (§22). This is the **new** guard
   registry the task flagged as the point where "COM-3 may differ from
   COM-2B" (§28) — confirmed true: `FulfillmentPolicy` had no `product_id`
   at all and never touched this registry.
   `ProductReferenceRegistryTest::the_registry_matches_the_contracts_classification`
   was checked and required **no update** — its exhaustive
   (`assertEqualsCanonicalizing`) check applies only to `INVENTORY_SEMANTIC`,
   not `COMMERCIAL_LIVE`; the `COMMERCIAL_LIVE`/blockers checks in that
   test use non-exhaustive `assertContains`, so adding a new
   `COMMERCIAL_LIVE` member does not require touching that test's literal
   lists (verified directly by re-reading that test method before
   assuming otherwise).
2. **`CommerceModuleBoundaryTest`** (PR-COM-0, already amended once in
   PR-COM-2A) required two changes: `App\Models\CommerceListing` removed
   from `NOT_YET_MODELS` (same reasoning as `SalesChannel`'s removal —
   the guard's own docblock scopes this to "not yet," not "never," and
   this PR is exactly when `CommerceListing`'s time arrived), and the
   `no_commerce_migration_is_introduced_yet` test method **removed
   entirely** rather than patched, because its own class docblock already
   scoped its whole promise (model **and** route **and** migration
   checks) to "before PR-COM-1A" — a window that closed three PRs ago; it
   had only kept passing by naming coincidence until this PR's migration
   filename literally contained "commerce." `no_commerce_api_route_is_registered_yet`
   was left untouched — this PR adds no route, so that specific promise is
   still genuinely true and still worth checking.

No guard was disabled, no broad exception was added, and both changes are
explained with an inline comment at the point of change, per the task's
explicit instruction (§28).

## 25. Public-safe boundary

No serialization, resource, or API surface was added in this PR at all
(§28 of the task, satisfied trivially — see §28 of this report). The
schema itself was checked against the Existing Architecture Audit's
public-safe concern regardless: `CommerceListing` carries no
`avg_cost`/`purchase_cost`/accounting-account reference, no internal
margin, no internal note field, and no tenant-internal identifier beyond
the standard `tenant_id`/`product_id`/`sales_channel_id` foreign keys that
every Commerce model in this sequence already carries. A future public
resource for this model would have nothing sensitive to accidentally leak
by naive serialization — the schema itself enforces the boundary, not a
resource class that doesn't exist yet.

## 26. Accounting impact

**NONE.** `CommerceListingService` never calls `LedgerService` and creates
no `Account`/`JournalEntry`/`JournalLine`/`Payment`. Verified:
`configuring_a_listing_creates_no_accounting_entries`
(`JournalEntry::count() === 0`, `Invoice::count() === 0`,
`Payment::count() === 0`).

## 27. ZATCA impact

**NONE.** No ZATCA class, route, or table referenced anywhere. Since ZATCA
artifacts live entirely on `Invoice` in this codebase (no separate ZATCA
table), the zero-`Invoice`-rows result above is the direct proof there is
no ZATCA surface to have been affected
(`configuring_a_listing_has_no_zatca_effect` documents this reasoning in
its own assertion, matching the pattern already used in PR-COM-2A/2B's own
reports).

## 28. API / UI impact

**NONE.** No route, controller, request, resource, or UI file was added or
touched anywhere in this diff.

## 29. Backward compatibility

No existing `Invoice`, POS, `Quote`, `Purchase`, `DeliveryNote`, or
`ReturnDocument`/`CreditNote` flow references `CommerceListing` — none of
those files were touched (verified: `git status --porcelain` shows exactly
the 6 files in §35). No listing was auto-created for any existing product
— `CommerceListing` starts empty for every tenant, exactly as
`SalesChannel` and `FulfillmentPolicy` did in their own PRs; a listing
only comes into existence when a caller explicitly configures one.

## 30. Tests — Tier 1: new `CommerceListingServiceTest`

`tests/Feature/CommerceListingServiceTest.php`, 20 tests. Full command:
`php artisan test --filter=CommerceListingServiceTest` →
**PASS 20/20 (33 assertions)** on SQLite; included in the combined
regression run on PostgreSQL below (also all passing).

## 31. Tests — Tier 2: guards + compatibility regression

Combined command (SQLite):
`--filter='PriceListTest|ProductBarcodeAndMediaTest|ProductClassificationTest|ProductLifecycleTest|ProductSkuValidationTest|SalesChannelTest|FulfillmentPolicyServiceTest|AvailableToSellServiceTest|InventoryReservationServiceTest'`
→ **PASS 111/111 (374 assertions)**.

Same combined tier plus guard tests, PostgreSQL:
`--filter='CommerceListingServiceTest|SalesChannelTest|FulfillmentPolicyServiceTest|CommerceModuleBoundaryTest|BranchIsolationGuardTest|ApiTenantIsolationTest|AvailableToSellServiceTest|InventoryReservationServiceTest|NumberingSettingsTest|ProductReferenceRegistryTest|ProductLifecycleTest'`
→ **PASS 154/154 (576 assertions)**.

Representative Invoice/Purchase/Return/StockPermit/Warehouse/POS/Ledger +
Product/media/pricing regression, PostgreSQL:
`--filter='InventoryTest|WarehouseTest|WarehouseAwareDocumentsTest|StockPermitTest|StockPermitUomValuationTest|PurchaseTest|ReturnTest|InvoiceInventoryApiTest|PosCheckoutTest|LedgerTest|PriceListTest|ProductBarcodeAndMediaTest|ProductClassificationTest|ProductSkuValidationTest'`
→ **PASS 159/159 (1119 assertions)**.

## 32. COM-1B PostgreSQL concurrency regression

`InventoryReservationPostgresConcurrencyTest` re-run **3 consecutive
times** against this PR's full schema (with `commerce_listings` present)
→ **PASS 3/3 (11 assertions) every time**, identical outcome to every
prior Commerce PR's report — confirms the new table has zero effect on
the atomic-acquisition locking behavior.

## 33. Full-suite results

| Engine | Result |
|---|---|
| PostgreSQL 16 (real, local) | **2990 passed**, 25 failed, 0 skipped (19802 assertions), 697.42s |
| SQLite | **2979 passed**, 25 failed, 11 skipped (19765 assertions), 309.34s |

### Reconciliation against PR-COM-2B's own baseline (pgsql: 2971 passed;
sqlite: 2960 passed/11 skipped)

- **pgsql**: 2990 − 2971 = **19** = +20 (`CommerceListingServiceTest`) − 1
  (`CommerceModuleBoundaryTest::no_commerce_migration_is_introduced_yet`,
  removed per §24). Not a mysterious count — accounted for exactly.
- **sqlite**: 2979 − 2960 = **19** = same reconciliation. Skips unchanged
  at 11 (this PR introduces no new driver-conditional test).

### Failure triage — identical pre-existing baseline on both engines

The 25 failures are byte-for-byte identical, on both engines, to every
prior Commerce PR's already-triaged baseline: 24 `Fuel*Test` failures
(`bcmath` PHP extension absent in this sandbox) and 1
`DocumentCenterSecureIntakeTest` PDF-fixture validation gap. None touch
Commerce, Inventory, Invoice, Ledger, Payment, ZATCA, POS, Product, or any
isolation/guard test.

## 34. CI status

Not pushed through GitHub Actions in this task (per instructions: do not
merge, do not deploy). All commands above were run locally against a real,
separately-installed PostgreSQL 16 instance configured with the exact same
credentials `ci.yml`'s `services.postgres` block uses, and against SQLite
via the same `setup.sh`-equivalent assembly this repo's own CI uses.

## 35. Changed files

```
A  app/Models/CommerceListing.php
A  app/Services/Commerce/CommerceListingService.php
A  database/migrations/2026_09_15_010000_create_commerce_listings_table.php
A  tests/Feature/CommerceListingServiceTest.php
M  app/Support/ProductReferenceRegistry.php          (CommerceListing classified COMMERCIAL_LIVE — §24)
M  tests/Feature/CommerceModuleBoundaryTest.php       (NOT_YET_MODELS + retired migration check — §24)
```

No `setup.sh`/`ci.yml`/`deploy/assemble.sh` change — `app/Models/`,
`app/Services/Commerce/`, and `tests/Feature/` are all already
flat-copied. No existing `Product`, `ProductMedia`, `SalesChannel`,
`Warehouse`, `FulfillmentPolicy`, `PriceListItem`, or
`InventoryReservationService` file was modified in this PR.

## 36. Risks / open questions

- **OPEN / Future PR** — SEO metadata (dedicated `meta_title`/
  `meta_description`), slug/URL identity, and storefront category/collection
  mapping (§10/§12/§14). All three were explicitly named in the master
  plan's field list as conditional ("where needed" / "only to the level
  required") and none has a concrete consumer yet — deferred rather than
  guessed at, per the task's own explicit permission for exactly this
  situation.
- **OPEN / Future PR** — channel-specific media (distinct image sets per
  channel, not just reordering the same set) — §13. Existing
  `ProductMedia.sort_order` is sufficient for the master plan's literal
  phrase today; a genuinely different requirement would need its own
  additive join table, not decided here.
- **OPEN / REQUIRES VERIFICATION** — how `CommerceListing` will interact
  with a future `CommerceOrder` (snapshot vs. live reference) — §22.
  Deliberately not decided now; `CommerceOrder` does not exist yet and the
  task explicitly forbade building toward it prematurely.
- No STOP condition was triggered: no `TenantScope` bypass was needed
  (§18), `Product` core semantics/barcode/UOM were not touched (§6/§21),
  inventory/`Reservation`/`FulfillmentPolicy` semantics were not modified
  (§16/§17/§22), no accounting/ZATCA mutation exists (§26/§27), no Product
  Variants or generic publishing workflow was built (§9/§20), no premature
  API contract was added (§28), and the one genuine ambiguity encountered
  (which master-plan fields to actually build now vs. defer) had a
  defensible, field-by-field documented answer (§10) rather than a
  blocking unknown.

## 37. Remaining work

Per the master plan, strictly next in the roadmap (not started, per
explicit instruction not to begin it in this task): `PR-COM-4A` — Commerce
Price Resolution boundary, and everything in the task's "Absolute Out of
Scope" list (`PR-COM-4B` promotions, `CommerceOrder`, reservation
orchestration, Customer Account/authentication, addresses, Cart, Checkout,
Mobile/Public API, `PaymentIntent`, payment provider, Fulfillment
aggregate, Shipping, ZATCA invoice-trigger work, Invoice bridge, Returns/
Refund/Exchange redesign, External Channel sync, B2B, Product Variants,
storefront theme/editor, collections beyond what §14 already deferred, UI).
The §36 open items are conscious, documented deferrals, not blockers.

## 38. Git

- **Branch:** `claude/pr-com-3-commerce-listing`
- **PR:** opened against `main` — link recorded in a follow-up commit to
  this report
- **Base SHA:** `b3815293ad2f065d457e2bd66da4a00ce795f4f4`
- **Head SHA:** `9047591a9b136507368cdb8096ccd0d6008a11b6` (before adding
  this report)

## 39. Recommended next step

**PR-COM-3 is clean**: `CommerceListing` is a genuine first-class concept
separating Product core truth from Commerce presentation; it is explicitly
linked to `Product` + `SalesChannel` with the cardinality invariant
enforced at the DB level; publication semantics are minimal and bounded
(a plain flag, no workflow); every presentation field was justified
field-by-field against the master plan's own text rather than assumed;
no duplicate catalog truth was created (fallback resolved at read time,
not copied at write time); no pricing, inventory/ATS, or warehouse field
exists; no Reservation mutation; no Product Variants; no store builder;
tenant isolation is proven with zero new `TenantScope` bypass; accounting/
ZATCA impact is verified zero; backward compatibility is preserved
(verified by regression, and by the fact that only two lines of one
pre-existing test needed touching, both explained); SQLite and PostgreSQL
are both green against the exact same pre-existing failure baseline, with
every count reconciled exactly; PR-COM-1B's PostgreSQL concurrency
guarantee was re-verified unaffected across 3 runs.

Recommended next step: **`PR-COM-4A` — Commerce Price Resolution
boundary**, once this PR is reviewed and merged by its owner (not by this
session — per instructions, this session does not merge or deploy).
