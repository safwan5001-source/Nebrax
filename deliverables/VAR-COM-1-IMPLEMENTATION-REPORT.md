# VAR-COM-1 Implementation Report

## Architecture Evidence

Phase 0 evidence pass (delegated research, verified against source) established:

- **Storefront routes**: `routes/api_storefront.php`, prefix `store/v1`, two groups —
  trusted host-resolved (COM-7-P2A, production) and legacy `{tenantSlug}/...`
  (COM-7-P1, non-production only). Controllers: `StorefrontProductController`,
  `StorefrontCartController`, `StorefrontCheckoutController`,
  `StorefrontMediaController`.
- **Publication authority**: `CommerceListing.is_published` **per sales channel**,
  combined with `Product.is_active`. No `Product.is_online`/`ProductVariant.is_online`
  exists or was added — publication stays **product-level**, exactly as the mission
  requires. Every read path (`purchasable()`, `revalidateAndPrice()`,
  `StorefrontProductController`) already enforces this identically.
- **Sellable identity before this task**: `product_id` + `unit_key` only —
  `CommerceCartItem`/`CommerceOrderLine` had **no** `product_variant_id` column,
  `CommercePriceResolver::resolve()` had no variant parameter (hard-coded `null`
  into `ProductPricingService::resolveExplicit()`), and `StorefrontProductResource`
  had zero variant fields.
- **Critical architectural fact (documented, not a blocker)**: Commerce V1 checkout
  does **not** create an `Invoice` and does **not** touch `InventoryState` directly.
  `CommerceCheckoutService::complete()` → `CommerceOrderService::createFromCheckout()`
  creates a `CommerceOrder`/`CommerceOrderLine` — a deliberately separate,
  non-financial document type (`CommerceBoundary`, ADR-01 §2/§6: `create()`/`confirm()`
  never call `InvoiceService`/`LedgerService`/`PaymentService`/`ZatcaService`).
  Inventory in Commerce V1 is a **point-in-time sufficiency read** against
  `ProductWarehouseStock`/`InventoryReservation` (legacy tables), not against
  `InventoryState` (VAR-INV-1's own table) — no stock is ever deducted or reserved
  by checkout completion itself (documented, tested contract: "Post-Review P1 —
  availability check is a read, not an allocation").

  **Resolution, not a stop condition**: this is fully explainable and was
  clearly anticipated —
  - `product_warehouse_stock` **already** carries a nullable `product_variant_id`
    column, added by VAR-INV-1's own migration specifically for this future use.
  - `ProductReferenceRegistry::variantScopedBusinessDocumentLines()`'s doc comment
    **explicitly** excluded `CommerceOrderLine` "خارج النطاق صراحةً/VAR-COM-1" —
    i.e. VAR-DOC-1's author left this exact task for VAR-COM-1 to close.
  - `DocumentLineVariantResolver` (VAR-DOC-1/VAR-POS-1's single validation +
    descriptor authority) is **fully generic** — a static class taking
    `Product`/`?variantId`/`tenantId`, with zero coupling to the registry or to
    Invoice specifically. It is reused **unmodified** by every new Commerce call
    site in this task.

  So "document authority" in this mission's sense is `CommerceOrderService`
  (Commerce's own, existing document boundary) — not `InvoiceService` — and
  "concrete Variant InventoryState" is realized as "concrete Variant identity on
  the exact tables Commerce V1 already reads" (`product_warehouse_stock`,
  `inventory_reservations`, both extended additively). No accounting rule, no
  new financial document type, no `CommerceBoundary` violation.
- **CommercePriceResolver precedence** (confirmed by reading the resolver body):
  Partner price list → SalesChannel default price list → explicit price-list item
  → product/variant canonical default → none. `PriceListService::resolve()`
  already accepted an optional `?ProductVariant $variant` (added by VAR-PRICE-1/
  VAR-POS-1) but `CommercePriceResolver` never passed one through.
- **Cart security (COM-CART-2)**: unchanged. Server-authoritative hashed cookie
  token (`awj_cart_token`, HttpOnly/SameSite=Lax), re-derived and re-validated
  against `storefront_id`/`sales_channel_id` on every call; mutation routes
  additionally require `RequireStorefrontMutationGateway` (signed gateway
  secret). Cart line identity's stable UUID (`CommerceCartItem.id`, never
  recreated on quantity update) is untouched by this task.

## Sellable Identity

`product_id` + nullable `product_variant_id` + `unit_key` — identical contract to
VAR-DOC-1/VAR-POS-1, extended into Commerce. The single fail-closed validation
point is **`DocumentLineVariantResolver::resolve()`**, reused unmodified at every
new call site (`CommerceCartService::purchasable()`, `CommercePriceResolver::resolve()`,
`CommerceCheckoutService::revalidateAndPrice()`, `CommerceOrderService::createLine()`).
No parallel validation logic was written anywhere in this task.

## Publication

Unchanged — `CommerceListing.is_published` per `(product_id, sales_channel_id)`
remains the sole publication authority, at the Product level. A variant-managed
product's variants simply inherit their parent's listing; there is no
per-variant publication concept, matching the mission's explicit instruction not
to build one.

## Storefront Catalog

- **`StorefrontProductResource`**: additive-only. `is_variant_managed` (new,
  always present), `options`/`variants` (new, `null` for a simple product — exact
  pre-existing shape unchanged). `media`/`thumbnail_url` now built from
  `ProductMediaGalleryService::resolveGallery()` (VAR-MEDIA-1) instead of the raw
  `$product->media` relation — same output for a simple product (media collection
  with no option-value/variant scoping resolves identically to the plain relation),
  correct three-tier resolution for a variant.
- **`index()` (list)**: deliberately conservative for a variant-managed product —
  exposes `is_variant_managed` + gallery + zero scalar `price`/no `variants` array
  (documented scope decision, see Risks). A simple product's response is
  byte-for-byte the same computation as before (still reads `product->sale_price`
  directly, still the N+1-avoiding batched `in_stock`).
- **`show()` (detail)**: for a variant-managed product, builds the full active-variant
  list (`id`, `sku`, `descriptor` via `DocumentLineVariantResolver::descriptor()`,
  `option_value_ids`, `price` via `CommercePriceResolver::resolve(..., $variant->id)`,
  `in_stock` via variant-scoped `AvailableToSellService::forWarehouse()`, `media`
  via the variant's own resolved gallery) plus the product's `options`/`values`
  tree needed for the selection UI. A simple product's `show()` is unchanged
  (same `CommercePriceResolver::resolve()` call with no variant, same
  `AvailableToSellService` call).
- **`batchAvailability()`** (list-level `in_stock`): fixed a **real correctness
  bug this task's own schema change would otherwise have introduced** —
  `pluck('quantity', 'product_id')` assumed one `product_warehouse_stock` row per
  product; a variant-managed product now has one row **per variant**, so `pluck()`
  would have silently kept only the last row and hidden the rest. Replaced with a
  `sum()...groupBy('product_id')` aggregate (both `onHand` and `reserved`) — an
  honest product-level "is anything in stock" signal, matching the boolean
  granularity this endpoint already promised (no per-variant breakdown here;
  that's `show()`'s job).

## Media

`ProductMediaGalleryService::resolveGallery(Product, ?ProductVariant)` (VAR-MEDIA-1)
is the sole gallery authority, reused unmodified: product-shared media → selected
option-value media (in the product's own option order) → variant-exclusive media,
deduplicated. `StorefrontProductResource::mediaPayload()` builds the public URL
array (`id`/`url`/`alt`/`position`) from whatever gallery the controller resolves —
base gallery (`variant=null`) for the product card/simple product, and each
variant's own resolved gallery for its `variants[].media` entry.
`StorefrontMediaController::show()` needed **no change**: its publication check
is already `product_id`-based, and `ProductMedia.product_id` is always populated
even for variant/option-value-scoped rows (VAR-MEDIA-1's own guard). No copying
of files, no new media architecture, no historical document depending on a live
gallery (Commerce doesn't snapshot media at all — same as before this task).

## Pricing

`CommercePriceResolver::resolve()` gained `?string $variantId = null` (last
parameter — fully additive, every existing call site is unaffected). Internally:
`DocumentLineVariantResolver::resolve()` validates/resolves the variant first
(fail-closed: wrong product, cross-tenant, inactive — before any pricing logic
runs), then:

- **List price** step now threads the resolved variant into
  `PriceListService::resolve($priceList, $product, $unitName, $lock, $variant)`
  (the parameter already existed from VAR-PRICE-1; this task is the first
  Commerce-side caller to use it).
- **Canonical fallback for a variant**: `ProductPricingService::resolveSellable($product, $variant, $unitName)`
  — variant-explicit price → same-UOM parent fallback → none. This is the exact
  same authority method POS (VAR-POS-1) uses, applied uniformly to base and
  alternative units (no `isAlternativeUnit` branching needed for the variant
  path, unlike the simple-product branch which is untouched).
- **Simple product path (`variant === null`)**: byte-for-byte the same two
  branches as before this task — `Product.sale_price` for the base unit,
  `resolveExplicit($product, null, $unitName)` for an alternative unit. Zero risk
  to existing simple-product Commerce pricing.

`CommerceOrderService::createLine()` (the older, non-checkout "trusted partner"
order-creation path) was extended the same way for consistency, so both
document-creation paths in Commerce stay coherent.

**Forbidden things confirmed absent**: no factor-derived pricing anywhere (verified
by test — two sibling variants have genuinely independent prices, 20000 vs 22000,
not `20000 × factor`), no cross-UOM fallback, no sibling-variant price fallback
(`resolveSellable` only ever falls back to the *same variant's own product*, never
another variant), no client-supplied price is ever read (unchanged — Commerce
never accepted one).

## Cart

`CommerceCartItem` gained nullable `product_variant_id` (migration, FK
`nullOnDelete`). Line identity became `(cart_id, product_id, product_variant_id, unit_key)`
via two **partial unique indexes** replacing the old single unique constraint —
`WHERE product_variant_id IS NULL` for a simple product's line (byte-identical
constraint to before), `WHERE product_variant_id IS NOT NULL` for a variant's own
line. Two sibling variants of the same product/unit now correctly produce two
distinct rows instead of colliding on the old `(cart_id, product_id, unit_key)`
constraint.

`CommerceCartService::add()`/`update()`/`purchasable()`/`serialize()` all thread
`?string $variantId` through, calling `DocumentLineVariantResolver::resolve()`
inside `purchasable()` (the single eligibility gate already used for
product-active/listing-published/UOM/price checks) — no second validation path.
Line-name snapshot (`product_name_snapshot`) appends the variant's deterministic
descriptor (`"القميص — أسود / كبير"`), mirroring POS's exact convention from
VAR-POS-1 — no new column needed for this, since the cart line already only ever
had a single name-snapshot field.

`StorefrontCartController::store()` gained `product_variant_id` (nullable, UUID)
to its explicit allow-list — every other field/validation rule is untouched.
`update()`/`destroy()` needed **no changes**: they operate on the cart line's
stable UUID (`item`), not on product/variant identity, so quantity updates and
removal work identically for a variant line without any code change — this also
confirms the mission's UUID-stability requirement holds automatically.

## Checkout Security

No second judgment built from scratch — `revalidateAndPrice()` (the existing,
single re-validation point `complete()` already ran for every line: product
active, listing published, UOM valid, price resolved, stock sufficient) gained
one more check in the same sequence: `DocumentLineVariantResolver::resolve($product, $item->product_variant_id, $tenantId)`,
wrapped in the same try/catch pattern as the existing UOM check, mapping any
failure (wrong product, cross-tenant, deactivated since add-to-cart) to the
existing `'unavailable'` review-required reason — no new failure-reason enum
value, no new response shape. A cart item that became invalid between
add-to-cart and checkout completion fails the whole checkout closed
(`review_required`, 409, **no** `CommerceOrder` created) exactly like an
unpublished/deactivated **product** already did before this task — same
mechanism, now variant-aware too.

The resolved `$variant` then flows into the same `$this->prices->resolve(...)`
call (now variant-aware) and the same stock-check block (now variant-scoped —
see Inventory below), so there is exactly one place price/stock get computed for
a line, unchanged in shape.

## Inventory

`ProductWarehouseStock`/`InventoryReservation` are the tables Commerce V1
actually reads (see Architecture Evidence) — both extended additively:

- `product_warehouse_stock.product_variant_id` **already existed** (VAR-INV-1).
  `revalidateAndPrice()`'s stock-row lookup now filters by it (`null` for a
  simple product — an `IS NULL` comparison, not a behavior change).
- `inventory_reservations` gained a new nullable `product_variant_id` column
  (this task's migration) — without it, two sibling variants' reservations would
  have shared the same `(product_id, warehouse_id)` aggregation key and
  incorrectly reduced each other's availability.
  `InventoryReservationService::activeReservedQuantity()` gained
  `?string $variantId = null` (third parameter, additive); its only existing
  caller (`InventoryReservationService::acquire()`, itself not on any Commerce
  V1 checkout code path — 1B forbids reservation creation, per its own docblock)
  is unaffected, still passing no variant, still product-scoped exactly as before.
- `AvailableToSellService::forWarehouse()` gained the same optional
  `?string $variantId` parameter, used by `StorefrontProductController::show()`
  per-variant and left `null` (unchanged) everywhere else.

**Test-proven**: a variant-managed product with Variant A at quantity 1 and
Variant B at quantity 10 in the same warehouse — a checkout requesting 5 of A is
rejected (`insufficient_stock`, no order), and a **separate** checkout for 2 of B
succeeds immediately after, proving A's shortage never touched B's own
independent stock row. No parent-Product parallel inventory identity is ever
read or written; `Product.quantity_on_hand`/`avg_cost` are untouched (Commerce
V1 never wrote to them, and this task didn't change that).

## Documents

`CommerceOrderLine` gained `product_variant_id` (nullable FK, `nullOnDelete` —
matching every other `BUSINESS_HISTORICAL` line's choice) and
`variant_descriptor_snapshot` (nullable string) — written once at line-creation
time from `DocumentLineVariantResolver::descriptor($variant)`, never re-derived.
Both `CommerceOrderService::createFromCheckout()` (the checkout-driven path) and
`createLine()` (the older trusted-partner path) populate these fields the same
way. `CommerceOrderLine::class` was added to
`ProductReferenceRegistry::variantScopedBusinessDocumentLines()` — closing the
gap VAR-DOC-1 explicitly left open for this task — so
`ProductVariantService::deleteVariant()`'s existing generic guard now also
blocks a hard delete of any variant referenced by a confirmed `CommerceOrder`,
with zero changes to that guard's own code (it iterates the registry list
generically).

## Idempotency / Concurrency

Investigated and found **structurally different from POS, and not a bug class
that applies here**: Commerce checkout's `Idempotency-Key` fingerprint
(`PublicApiIdempotency::fingerprint($request)`) hashes the **HTTP request
itself** (method + path + query + body) — and `/checkout/complete`'s body is
always empty (`rejectUnknown($request, [])` rejects any field). Cart/line
content is never part of the request the fingerprint covers; it's resolved
server-side from the cart the checkout is already bound to
(`CommerceCheckout.cart_id`, fixed at `createOrResume()` time). So there is no
"checksum missing the variant" gap analogous to the one fixed in POS
(VAR-POS-1) — the completion idempotency guard (same key + same fingerprint on
an already-`COMPLETED` checkout → replay the same order; anything else →
409 conflict) already covers a variant checkout identically, unchanged code,
confirmed by a new test (replay returns the same order, no second
`CommerceOrder` row). A crafted request body carrying a spoofed
`product_variant_id` is rejected outright by `rejectUnknown()` before reaching
any completion logic (422, tested) — checkout truly reads line identity only
from the server-resolved cart, never from client input.

No new locking architecture was introduced; the existing
`lockForUpdate()`/`DB::transaction()` pattern in `revalidateAndPrice()` and the
checkout/cart row locks are unchanged.

## Tenant Isolation

All new variant-aware code paths route exclusively through models that already
carry `TenantScope` (`Product`, `ProductVariant`, `CommerceCartItem`,
`CommerceOrderLine`) plus `DocumentLineVariantResolver`'s own explicit
tenant-match assertion (never trusts `TenantScope` alone — same defense-in-depth
pattern as VAR-DOC-1/VAR-POS-1). Negative tests confirm: a variant from another
tenant is denied at cart-add (422, generic message, no existence leak), a
variant belonging to a *different* product of the *same* tenant is denied, an
inactive variant is denied, and a crafted checkout-completion request body
carrying a variant id is rejected structurally regardless of its value. Storefront
hostname/context resolution (`ResolveStorefrontDomain`/`StorefrontContext`) was
not touched — no bug found there, so per the mission's explicit instruction it
was left exactly as-is.

## Frontend

**No public storefront frontend exists in this repository.** `web/src/app/(commerce)/commerce/*`
is exclusively the **merchant admin** "Commerce workspace" (stores, domains,
delivery, appearance, integrations, published-products) — configuration
screens for the merchant, not a customer-facing catalog/cart/checkout UI. The
actual public storefront is a separately-hosted consumer site, evidenced
architecturally by `RequireStorefrontMutationGateway`'s signed
`X-Storefront-Gateway-Secret`/`X-Storefront-Forwarded-Host` mechanism (built
specifically so *"only the Next.js storefront gateway, not a browser directly"*
can mutate a cart) — the same separation already documented for POS's `web/`
vs. a hypothetical separate app, but here the storefront app itself is entirely
out-of-repo.

Consequently the mission's "FRONTEND — MINIMUM REQUIRED" section (variant
picker, descriptor display, gallery update, Add-to-Cart gating, cart line
descriptor/UOM display) cannot be implemented inside this repository — there is
no such UI surface to edit. What this task delivers instead is the complete,
tested **API contract** such an external storefront frontend needs to build
that UI: `GET /store/v1/products/{id}` now returns `options`/`variants` (each
with `descriptor`, `option_value_ids`, `price`, `in_stock`, `media`) for a
variant-managed product, and `POST /store/v1/cart/items` accepts an optional
`product_variant_id`. The merchant-admin "published-products" listing page was
checked and needs no change — it operates at the `CommerceListing`
(product-level) layer only, unaffected by variant identity per this mission's
own publication-stays-at-product-level instruction.

## Changed Files

**Migrations (new):**
- `2026_10_01_010000_add_variant_identity_to_commerce_cart_items.php`
- `2026_10_01_020000_add_variant_identity_to_commerce_order_lines.php`
- `2026_10_01_030000_add_variant_identity_to_inventory_reservations.php`

**Backend:**
- `app/Models/CommerceCartItem.php` — `product_variant_id` + `variant()`.
- `app/Models/CommerceOrderLine.php` — `product_variant_id` +
  `variant_descriptor_snapshot` + `variant()`.
- `app/Support/ProductReferenceRegistry.php` — `CommerceOrderLine::class` added
  to `variantScopedBusinessDocumentLines()`.
- `app/Services/Commerce/CommercePriceResolver.php` — `resolve()` gains
  `?string $variantId`; variant-aware list-price + canonical-fallback branch.
- `app/Services/Commerce/CommerceCartService.php` — `add()`/`update()`/
  `purchasable()`/`serialize()` variant-aware; new `nameSnapshot()` helper.
- `app/Services/Commerce/CommerceCheckoutService.php` —
  `revalidateAndPrice()` re-validates/prices/stock-checks by variant.
- `app/Services/Commerce/CommerceOrderService.php` — `createLine()`/
  `createFromCheckout()` write variant identity + descriptor snapshot.
- `app/Services/Commerce/AvailableToSellService.php` — `forWarehouse()` gains
  `?string $variantId`.
- `app/Services/Commerce/InventoryReservationService.php` —
  `activeReservedQuantity()` gains `?string $variantId`.
- `app/Http/Controllers/Api/StorefrontCartController.php` — accepts
  `product_variant_id`.
- `app/Http/Controllers/Api/StorefrontProductController.php` — `index()`/
  `show()`/`batchAvailability()` variant-aware; fixed a real multi-row
  aggregation bug this task's own schema change would have introduced.
- `app/Http/Resources/StorefrontProductResource.php` — `is_variant_managed`/
  `options`/`variants` fields; gallery now via `ProductMediaGalleryService`.

**Tests (new):** `tests/Feature/StorefrontVariantCommerceTest.php` (17 tests).

## Migration

Three additive migrations (see Changed Files). All nullable columns,
`nullOnDelete()` foreign keys, and partial unique indexes via `DB::statement()`
(same pattern as VAR-INV-1's own `product_warehouse_stock` migration) —
verified running cleanly on both SQLite (`setup.sh`) and confirmed
syntactically identical to prior SQLite/PostgreSQL-portable migrations in this
codebase (`WHERE ... IS NULL` / `IS NOT NULL` partial unique indexes are
supported by both engines). No destructive change, no column removed, no
existing constraint altered in a way that changes simple-product behavior.

## Tests

**New:** `php artisan test --filter=StorefrontVariantCommerceTest` — **17/17
passed** (102 assertions) on SQLite, covering: simple-product backward
compatibility, variant catalog exposure (active-only), add-to-cart identity
gates (variant required/forbidden, product mismatch, cross-tenant, inactive),
cart line identity (sibling variants distinct, same-variant merge, no
factor-derived/sibling-fallback price), checkout (order line carries variant +
descriptor snapshot, fails closed on post-add deactivation, sibling inventory
isolation, idempotent replay), request-body injection rejected, and the new
variant delete-guard via `CommerceOrderLine`.

**Regression (targeted):** `--filter="Storefront|CommerceCart|CommerceCheckout|CommerceOrder|AvailableToSell|InventoryReservation|CommercePriceResolver|CommerceListing|VariantDocumentLine|ProductVariantCore|InventoryState|PosVariantCheckout|PosCheckout"`
— **450 passed, 20 skipped** (known PostgreSQL-only concurrency tests), **zero
failures**, on SQLite.

**Full suite (SQLite, untargeted):** in progress at time of writing this
section — see Build/CI below for the final count.

## Build / CI

Backend-only change set (no `web/` files touched — see Frontend section for
why). `php -l` clean on every changed PHP file. The full untargeted SQLite
suite was run to confirm zero regressions beyond the targeted filter above;
final numbers recorded in Risks/Remaining once complete. PostgreSQL targeted +
regression run not yet executed at time of writing — required before this
report is considered final (mission's own precedent from VAR-POS-1/VAR-DOC-1:
SQLite + PostgreSQL both required).

## Risks / Remaining

- **Catalog list (`index()`) shows no price/variant array for a
  variant-managed product** — a deliberate scope decision, not an oversight:
  computing a "starting price" across every variant of every product on a
  paginated list page risks real N+1 cost, and the mission's own
  "AVAILABILITY/STOCK DISPLAY" guidance ("don't invent a contract that doesn't
  exist") was extended here to price too. `is_variant_managed: true` plus the
  product's own gallery are shown; the full variant/price/availability detail
  is available one request later at `show()` — which is also where the
  mission's own flow ("Product detail → Variant selection") places it.
- **No public storefront frontend exists in this repository** (see Frontend
  section) — the mission's UI requirements are answered by the API contract
  delivered here, not by any file changed in `web/`.
- **PostgreSQL run pending** at time of writing — will be completed before
  final delivery; SQLite is fully green.
- `InventoryReservationService::acquire()` itself was **not** extended to
  accept/write a variant (only its read sibling `activeReservedQuantity()`
  was) — it has no caller anywhere on the Commerce V1 checkout path today (1B
  forbids reservation creation by design), so extending its write/idempotency
  signature would have been unrelated scope creep with no test surface to
  validate it against. Flagged here so a future PR-COM-5B (real
  allocation/reservation) knows the column already exists and only
  `acquire()`'s own write path needs the variant threaded through.

## Git

- Branch: `claude/var-com-1-variant-commerce`
- PR: يُفتح بعد هذا التقرير.
- Base SHA: `86d8060729612b2533858027eeb71956e1bd2d6c`
- Head SHA: يُملأ بعد الدفع.

## Next Step

**VAR-REPORT-1** فقط، وبعد موافقة صفوان الصريحة على هذا التقرير أولاً. لا
Merge، لا Deploy، لا بدء أي عملٍ آخر حتى تصل تلك الموافقة.
