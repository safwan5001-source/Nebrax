# CUST-H4-6 — Real Offers Commerce Backend — Implementation Report

| | |
|---|---|
| **Base SHA** | `513ced7e3c51480053a508e23be81759b45a9f8e` (`origin/main`, the merge of H4-5 PR #1197 — verified directly, not assumed) |
| **Head SHA** | `133bcabc6d887f87d26b59b3825b8cc515574a2e` (implementation commit; later commits on the branch only touch this report) |
| **Branch** | `feat/cust-h4-6-offers-backend` |
| **PR** | #1202 — https://github.com/safwan5001-source/Nebrax/pull/1202 |
| **Scope** | H4-6 backend/data contract only. No Canvas/Published UI (H4-7). |
| **Offers capability** | **still `state: "gated"`, `merchantAddable: false`** — untouched |
| **Merge / Deploy / Production** | **None.** Not merged, not deployed, not released. |

Contract implemented: `docs/plans/store/CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §23 (Revision 2), §30, §35 (H4-6).

---

## 1. Evidence pass (verified on the Base SHA before editing)

| # | Question | Finding (file) |
|---|---|---|
| 1 | Product / CommerceListing / Storefront / SalesChannel | `Storefront` (`CompanyWide`, soft-deletes) → exactly one `SalesChannel` (`type=web`, tenant-checked in `saving()`). `CommerceListing(product_id, sales_channel_id, is_published)` is the *only* publication source; a product is public on a storefront iff `Product.is_active` ∧ a published listing on **that storefront's** channel. |
| 2 | Public storefront context | `routes/api_storefront.php` group: `ResolveStorefrontDomain` (Host → verified active `StorefrontDomain` → active `Storefront` → active web `SalesChannel`, sets `TenantContext` + `StorefrontContext`, uniform 404 on any failure) → `EnforcePublicApiRateLimit:unauth`. No id in any URL. `StorefrontContext` has no mutator reachable from a controller. |
| 3 | Authenticated workspace ownership | `commerce/workspace/storefronts/{id}/…` under `auth:sanctum, SetTenant, SetBranch, EnsureActiveSubscription`, `EnsurePermission:commerce.manage`; `ownedStorefront()` compares `Storefront.tenant_id` to `TenantContext` → `null` ⇒ **404, never 403**. Self-service role ⇒ 403. |
| 4 | `CommercePriceResolver` contract | Read-only coordinator ("اقتراح، لا محرك مالي"): `resolve(productId, salesChannelId, partnerId?, unit?, lock?, variantId?)` → `ResolvedCommercePrice{resolved, amount(minor int), currency(Tenant.currency), source, priceListId, unitName, minSalePrice}`. Throws `RuntimeException` on invalid product/channel/variant/unit/price-list reference. |
| 5 | Base vs effective price | **Base/original** = `Product.sale_price` (accessor over `ProductUnitPrice`, base unit). **Effective** (anonymous, base unit) = the sales channel's active `default_price_list_id` → explicit `PriceListItem` for that product ⇒ that price; otherwise falls through to the same `Product.sale_price`. So *effective < base can only come from an explicit item in the channel's default price list*. This is the same number Cart V1 charges (`CommerceCartService`). **Variants:** `resolve()` rejects `variantId = null` for a variant-managed product (fail-closed); price is per variant (`ProductPricingService::resolveSellable`). |
| 6 | Tenant-scoped model patterns | `BaseModel` (`HasUuids` + `BelongsToTenant`/`TenantScope`) + `CompanyWide` marker; stored product reference via `ResolvesBranchReferences::referenceBelongsTo`; structural tenant check in `saving()` (`CommerceCollectionProduct`, `Storefront`). |
| 7 | Migration conventions | `database/migrations/2026_10_NN_…`, `uuid('id')->primary()`, `foreignUuid('tenant_id')->constrained()->cascadeOnDelete()`, explicit named composite indexes, Arabic docblock. |
| 8 | Workspace CRUD conventions | Thin controller + service; `denySelfService`; `abort(404)` for foreign; 409 for conflicts (`CommerceCollectionController`/`CommerceTaxonomyConflictException`); `{data: …, meta: …}`; routes `->whereUuid()->middleware($perm('commerce.manage'))`. |
| 9 | Public resource conventions | `PublicApiController`, `{data, meta.request_id}`, prices as `{amount_minor, currency}`, snake_case, explicit allow-list resources (never a raw model), thumbnails via `StorefrontProductResource::mediaPayload`. |

**Contract-vs-main conflict check:** none material. One nuance recorded in §9 (pre-existing list/price drift).

---

## 2. Schema — `storefront_offers`

Migration `2026_10_30_010000_create_storefront_offers_table.php` (additive; one new table, nothing altered).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK → tenants, cascade | |
| `storefront_id` | uuid FK → storefronts, cascade | |
| `product_id` | uuid FK → products, cascade | |
| `starts_at`, `ends_at` | nullable timestamp | UTC |
| `is_active` | bool, default true | |
| `position` | unsigned smallint, default 0 | merchant ordering |
| `created_at`, `updated_at` | | |

Constraints / indexes: **unique `(storefront_id, product_id)`** (duplicate = explicit 409); `(storefront_id, is_active, position)` (public read path); `tenant_id`; `product_id`.

**No** price, discount, percent, original price, tax, margin, stock or savings column — enforced by a test that pins the exact column list and the model's `$fillable`. The table is structurally unable to express a discount.

## 3. Model / relations

`App\Models\StorefrontOffer extends BaseModel implements CompanyWide` (child of `Storefront`, itself `CompanyWide`).
`storefront()`, `product()` (stored reference — outside branch scope, inside tenant scope). `saving()` structurally rejects a foreign-tenant product/storefront and a non-strict window. `scopeWithinWindow` / `isWithinWindow` (closed at both ends, UTC) and `scopeOrdered` (`position`, `created_at`, `id`).

## 4. Workspace CRUD

`CommerceWorkspaceStorefrontOfferController` + `StorefrontOfferService` (the single `ownedStorefront()` for this feature).

| Verb | Route | Notes |
|---|---|---|
| GET | `/api/commerce/workspace/storefronts/{id}/offers` | All candidates (≤12) + `evaluation{is_live, reason, reference_price, offer_price}` from the **same** `StorefrontOfferResolver` as the public read (Canvas-preview read, §23.5) |
| POST | `…/offers` | 201 |
| PATCH | `…/offers/{offer}` | partial; `null` clears `starts_at`/`ends_at` |
| DELETE | `…/offers/{offer}` | `{data:{deleted:true}}` |

- Merchant fields: `product_id`, `starts_at`, `ends_at`, `is_active`, `position` (0–9999; default = append).
- **Strict allow-list**: any other key — `price`, `discount`, `percent`, `sale_price`, `price_list_id`, `tenant_id`, `storefront_id`, `sales_channel_id`, … — is **rejected 422**, not silently ignored (a field that is accepted-then-ignored would suggest a discount was written).
- Product must be active **and** published on the storefront's own channel; foreign / missing / unpublished / inactive / other-channel are **one indistinguishable 422 message**. Variant-managed products are rejected up-front (see §8). Eligibility is re-checked only when `product_id` changes, so a merchant can still deactivate/delete an offer whose product left publication.
- Duplicate product on the storefront ⇒ 409. Cap of **12** offers per storefront (`StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT`, serialized by a storefront row lock). `starts_at < ends_at` strictly (equal instants in different offsets are also rejected).
- **Reorder:** per-row `position` on create/update only. A bulk atomic reorder endpoint is **not** added — the Featured/presentation layer already orders by its own id list and `position` suffices for the public tie-break; adding it would widen the surface without a consumer. Candidate for H4-7 if the editor needs it.

## 5. Public API

`GET /store/v1/offers` (`storefront.v1.offers.index`) in the existing Host-resolved group. **No identifier segment; no input can select tenant/storefront/channel.**

```json
{ "data": [ { "id", "product_id", "name", "name_en", "thumbnail_url",
              "reference_price": {"amount_minor", "currency"},
              "offer_price":     {"amount_minor", "currency"},
              "discount_percent",            // derived, fresh on read, never stored
              "starts_at", "ends_at" } ],
  "meta": { "request_id" } }
```

Only **live** offers (active ∧ in window ∧ product active+published on this channel ∧ genuinely discounted ∧ currently sellable per `AvailableToSellService` — §6.1), ordered by `position, created_at, id`, capped at 12. Nothing about *why* something is hidden is ever exposed publicly.

## 6. Authoritative discount determination

> **Real discount ⇔ `CommercePriceResolver::resolve(product, channel)` is resolved and its amount is strictly lower than `Product.sale_price`.**

- `referencePrice = (int) Product.sale_price` (public base price).
- `offerPrice = CommercePriceResolver->resolve($product->id, $channelId)->amount` — anonymous (no partner), base unit: byte-for-byte the price Cart V1 charges. A test proves `offer_price == resolver amount == cart line unit_price`.
- Equal, higher, unresolved, or a resolver exception (corrupt/deleted/foreign price-list reference) ⇒ **omitted (fail-closed)**.
- Computed fresh on every read; nothing stored. Tax is absent by design (as in the resolver). No new pricing semantics were invented: the discount is exactly "the channel's active price list overrides the base price downward", which is the only discount mechanism existing Commerce pricing has.
- **`discount_percent` (added in the review-fix round, §23.3 step 4)** — *derived*, never an authority: `round((referencePrice − offerPrice) / referencePrice × 100)` computed fresh on every read from the two numbers above, **only** when `referencePrice > 0` and `0 ≤ offerPrice < referencePrice` (otherwise the row is already omitted, so no percentage exists for a non-genuine discount). Rounding is half-up in **pure integer arithmetic** (`intdiv(2·diff·100 + ref, 2·ref)`, identical to PHP `round()` for positive values, no float). Examples: 25000→19000 = 24; 3→2 = 33; 3→1 = 67; 8→7 = 13 (12.5↑); 200→199 = 1 (0.5↑); 25000→24999 = **0** (a genuine sub-half-percent discount; H4-7 may choose not to show a 0% badge); free item → 100. Never persisted; no workspace payload accepts it (`discount_percent`, `discount_percentage`, `discount_amount`, `savings`, `offer_price`, `reference_price`, `in_stock`, `percent`, `price`… are all rejected 422). Still **no savings amount and no strikethrough flag**.
- Contract nuance (judgement call, flagged): `reference_price` is `Product.sale_price`, which the resolver does not expose itself. It is returned because it *is* the proof of the discount the filter relies on; H4-7 should treat it as "base price", not as a "was-price" claim.
- Not a promotions engine: no coupon / cart / checkout / invoice / POS / customer-specific logic; no change to any pricing path (`CommercePriceResolver`, `PriceListService`, cart, checkout, invoice math all untouched).

### 6.1 Sellability (ATS) — added in the review-fix round (§23.3 step 5)

A candidate with a genuine discount is **live only if it is currently sellable on this storefront's channel**, reusing the existing authorities and **mirroring exactly what `CommerceCheckoutService`/`CommerceOrderReservationService` already enforce** — no new inventory logic:

| Product | Rule | Not-live reason (workspace only) |
|---|---|---|
| `track_inventory = false` (default; services, untracked) | no availability check — checkout/reservation skip it too | — (sellable) |
| tracked, channel has no usable fulfillment warehouse (`FulfillmentPolicyService::resolveWarehouseFor` throws: no policy / channel or warehouse inactive) | cannot be fulfilled | `fulfillment_not_configured` (checkout's own failure reason) |
| tracked, `AvailableToSellService::forWarehouse(product, channelWarehouse).availableToSell <= 0` (on-hand − active reservations, floored at 0; negative legacy on-hand ⇒ 0) | not sellable | `out_of_stock` |
| tracked, ATS lookup throws | fail-closed | `availability_unresolved` |

- ATS is evaluated **after** the price gate and only for genuinely-discounted candidates, so non-discounted rows cost no inventory queries.
- Warehouse = the channel's own fulfillment warehouse only: stock in any other warehouse of the tenant, or in another tenant, never counts (tested: other-warehouse stock, other-tenant stock, two channels of one tenant with different warehouses).
- **No inventory numbers** are exposed anywhere (asserted); the public payload is unchanged apart from the extra `discount_percent`. No merchant setting was introduced. General storefront product lists are untouched (they still list out-of-stock products with an informational `in_stock: false`; asserted).
- Honest note: this makes Offers *stricter* than the product list by design (§23.3 step 5, owner-confirmed in review).

## 7. Host resolution, tenant isolation, sales-channel eligibility

- **Public:** authority exclusively from `StorefrontContext` (set by `ResolveStorefrontDomain`). Tests: Host A never sees B; second storefront of the same tenant doesn't leak; `?storefront_id=…&tenant_id=…&sales_channel_id=…` + `X-Storefront-Id`/`X-Tenant-Id` headers have no effect; wrong gateway secret cannot redirect the host while the right one resolves the forwarded host; unknown host / unverified domain / inactive domain / inactive storefront ⇒ 404; the route has zero parameters; a foreign-tenant product row planted by raw SQL cannot surface.
- **Workspace:** every verb on a foreign storefront ⇒ 404 with nothing written/changed; foreign vs unknown storefront indistinguishable; another tenant's offer id via my own storefront ⇒ 404; same-tenant sibling storefront's offer is invisible and untouchable; foreign product ⇒ uniform 422 without leaking; soft-deleted storefront ⇒ 404; unauthenticated 401; `staff`/`self_service` 403.
- **Channel eligibility:** published listing on the offer's *own storefront channel* only (published on another channel of the same tenant ⇒ omitted publicly and rejected on create).

## 8. Variant behavior

**Variant-managed products are omitted (fail-closed) from the public read and rejected at configuration time.** Reason: the parent has no price (`resolve()` itself refuses `variantId = null`), and a storefront "offer" card for a multi-variant product needs a *representative* price (cheapest? first? "from X"? per-variant badges?) — a display-pricing decision that has not been approved and that existing pricing semantics do not answer. Inventing it here would violate the "no new pricing semantics" rule, so it is documented rather than guessed. The workspace list still shows such a row as `reason: "variant_managed"` (never hidden silently). Path to enable later: owner decision on the representative-variant rule, then per-variant `resolve()` vs `ProductPricingService::resolveSellable()`.

## 9. N+1 / performance findings

- Batched: one query each for products, publication, thumbnails (shared-media layer, same ordering as `resolveGallery`), price-list items; currency read once.
- Two *necessary-condition* short-circuits skip resolver calls whose answer is already known: (1) channel has no default price list ⇒ every product resolves to base ⇒ no discount; (2) product has no explicit item in that list ⇒ same. These narrow work; they are **not** a price source — every surviving candidate is priced by `CommercePriceResolver`.
- Measured (sqlite, includes middleware/auth/host-resolution baseline), **untracked products** (no ATS check): **1 live offer = 17 queries, 8 = 66, 12 = 94 (≈7/offer)**; **12 non-discountable candidates = constant (≤14)**. **Tracked products (ATS check, added in the review-fix round): 1 live offer = 24 queries, 12 = 145 (≈11/offer)** — ATS adds ≈4 queries per live tracked offer (`AvailableToSellService::forWarehouse`: product exists, warehouse exists, stock row, active reservations) plus one fulfillment-warehouse resolution per read. This remains a **known, documented H4-6 performance limitation**: bounded by the unchanged 12-offer cap, linear, and **not** fixed here — neither pricing nor ATS has a batch entry point and adding one is a broader refactor, explicitly out of scope. Bounded by the 12-offer cap and linear. The ≈7/offer comes from the existing per-product `CommercePriceResolver::resolve()` (Product, SalesChannel, Tenant, PriceList, PriceListItem lookups) + one `sale_price` read. There is **no existing batch-safe resolver entry point**; adding one would be a pricing refactor, which is out of scope and not needed at a ≤12 cap — so this is reported, not "fixed". Asserted in tests (untracked ≤8/offer and ≤120 total at 12; tracked ≤12/offer).
- **Pre-existing finding (not changed):** `StorefrontProductController::index()` prices the *list* with `Product.sale_price` directly (its comment assumes no price list applies anonymously), whereas `show()` and the cart use the resolver which *does* apply the channel default price list. For a channel with a default price list the product list can therefore show the base price while detail/cart show the lower one. Offers deliberately use the resolver path. Worth a separate ticket; not touched here (a regression test pins the list output as unchanged).

## 10. Time-window semantics

UTC storage and comparison (`now()` in app timezone = UTC; inputs parsed to UTC, ISO-8601 with offset accepted). Closed at both ends: `starts_at` null or `<= now`; `ends_at` null or `>= now`; `starts_at < ends_at` strictly when both set. Tested: no bounds, future start, started, expired, exactly-now at both ends, ±1 second, inside/passed/not-yet windows; SQL scope and in-memory predicate agree on every boundary.

## 11. Files changed

**New**
- `database/migrations/2026_10_30_010000_create_storefront_offers_table.php`
- `app/Models/StorefrontOffer.php`
- `app/Services/Commerce/StorefrontOfferResolver.php`
- `app/Services/Commerce/StorefrontOfferView.php`
- `app/Services/Commerce/StorefrontOfferService.php`
- `app/Services/Commerce/StorefrontOfferConflictException.php`
- `app/Http/Controllers/Api/StorefrontOfferController.php`
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontOfferController.php`
- `app/Http/Resources/StorefrontOfferResource.php`
- `tests/Feature/SeedsStorefrontOffers.php` (shared fixtures trait)
- `tests/Feature/StorefrontOfferModelTest.php`
- `tests/Feature/StorefrontOfferPublicApiTest.php`
- `tests/Feature/CommerceWorkspaceStorefrontOfferApiTest.php`
- `docs/reports/CUST-H4-6-OFFERS-BACKEND-IMPLEMENTATION-REPORT.md`

**Modified**
- `routes/api.php` — 4 workspace routes (+ import)
- `routes/api_storefront.php` — `GET offers` (+ import)
- `tests/Feature/CommerceModuleBoundaryTest.php` — allow-listed the two new workspace URIs
- `app/Support/ProductReferenceRegistry.php` — classifies `StorefrontOffer` (see §11.1)
- `app/Services/ProductLifecycleService.php` — explicit cleanup of offer rows on a true product delete (see §11.1)

No `web/`, no pricing/cart/checkout/invoice/POS/accounting file touched.

### 11.1 Decision to surface: product-reference classification

`ProductReferenceClassificationGuardTest` (an architectural CI guard) fails any model carrying `product_id` that is not classified in `ProductReferenceRegistry` — it failed on the first full run, which is how this was found. `StorefrontOffer` is classified **`OWNED_CHILD`**: same class and reasoning as `CommerceCollectionProduct` (curation membership; no financial/inventory/historical meaning). Consequences: an offer **never blocks a true product delete**, and `ProductLifecycleService::delete()` removes the product's offer rows explicitly (not by FK cascade alone — the file's own convention). The alternative, `COMMERCIAL_LIVE`, would make a product impossible to delete while merely *curated* for an Offers rail, with no corresponding business protection (publication via `CommerceListing` already blocks deletion). CLAUDE.md rule 6 says classification doubts go to the owner — flagging it here; it is a one-line change in the registry if the owner prefers `COMMERCIAL_LIVE`.

## 12. Tests / results

**New tests: 124** (model 13, workspace 45, public 66) + 1 shared fixture trait — all green on **SQLite and PostgreSQL 16**. Initial slice: 92; review-fix round (ATS + `discount_percent`): +32.

| File | Tests | Covers |
|---|---|---|
| `StorefrontOfferModelTest` | 13 | exact column list (no price/discount column), `$fillable`, unique pair + read-path indexes, relations, foreign-tenant product/storefront rejected, tenant scope, strict window, SQL-vs-memory boundary parity, deterministic ordering, **OWNED_CHILD cleanup on true product delete**, `CompanyWide` |
| `CommerceWorkspaceStorefrontOfferApiTest` | 45 | CRUD, defaults/append position, UTC, validation, invalid windows, **16 forbidden fields** (price/discount/percent/discount_percent/discount_amount/savings/offer_price/reference_price/in_stock/tenant_id/storefront_id/…) rejected 422 with nothing persisted, duplicate 409, uniform ineligible-product 422, variant-managed rejected, 12-cap, evaluation reasons, **`discount_percent` in evaluation (24 live / null otherwise)**, **honest `out_of_stock` / `fulfillment_not_configured` reasons (on-hand, reserved, untracked live, no policy)**, **tenant-A-vs-B stock isolation in the workspace**, workspace-vs-public parity, partial update, tenant/storefront isolation on every verb, RBAC, no financial side effects |
| `StorefrontOfferPublicApiTest` | 66 | genuine discount live with both real prices + `discount_percent`; payload allow-list (no saving amount, stock numbers or internal facts); offer price == resolver == real cart line; omitted when not genuine (no row / no list / no item / equal / higher / inactive list / corrupt ref / zero base); **9 percentage cases incl. half-up rounding (12.5→13, 0.5→1, 0.4→0, tiny→0, free→100), fresh on every read, never stored**; **ATS: available ⇒ live; zero / reserved-out / negative on-hand / no fulfillment policy / inactive warehouse ⇒ omitted; untracked product needs no stock (checkout parity); other-warehouse and other-tenant stock never counts; two channels of one tenant use their own warehouse; product-list behavior unchanged**; variants fail-closed; unpublished/inactive/other-channel; 10 window cases; ordering; cap; Host A≠B, same-tenant sibling storefront, input/header injection ignored, gateway secret, 404s, route has no params, raw-SQL-planted foreign row; thumbnail; existing product endpoints unchanged; query budgets (untracked and tracked) |

Mutation check: disabling the ATS gate makes 8 of the new public tests fail (restored) — the tests exercise the gate, not just run beside it.

Other gates verified: `BranchIsolationGuardTest`, `CommerceModuleBoundaryTest`, `ProductReferenceClassificationGuardTest`, `ProductLifecycleTest`, `AvailableToSell*`, `InventoryReservation*`, `FulfillmentPolicy*` — green. Web: `section-capabilities.test.ts` 22/22 (`offers.state === "gated"`, `merchantAddable === false`; no web file changed).

**Focused** (offers + ATS/reservation/fulfillment + guards + lifecycle + boundary): SQLite **203 passed (3 skipped, PG-only)**; PostgreSQL 16 **206 passed**, 0 failed.

**Broader Commerce/Storefront/Product/PriceList/Inventory/Fulfillment/ATS/isolation/POS filter:**
- SQLite: **2802 passed, 23 failed** — all in environmental classes (`Fuel*`, `ProductMediaR2*`, `ProductOptionValueVisualTest`: missing `bcmath` / AWS SDK locally; CI installs them) that fail identically on unmodified `main`.
- PostgreSQL 16 (same filter minus the environmental `ProductMediaR2*`/`R2*`/`Fuel*` classes): **2395 passed, 0 failed**. (An unexcluded PG run stalled inside `ProductMediaR2DeleteTest` after its missing-AWS-SDK error left a transaction open — environmental, not Offers.)
- An earlier full unfiltered SQLite run (initial slice) was 5331 passed / 57 environmental failures, identical set on `main`; the CI run on the PR is the authoritative full-suite result on both drivers.

Perf (sqlite, incl. middleware baseline): untracked: 1→17, 8→66, 12→94 (≈7/offer); **tracked with ATS: 1→24, 12→145 (≈11/offer)**; 12 non-discountable candidates = constant ≤14. Cap unchanged at 12; no batch refactor (see §9).

## 13. Build / CI

- CI (`ci.yml` php on sqlite + pgsql; `web-ci.yml`) runs on the PR — status recorded in the PR; see the final response / PR checks. No `web/` change, so Web CI is unaffected in substance.
- Local gates run: full SQLite suite, targeted + broad PostgreSQL 16 suites, vitest for the capability registry. Migration applies cleanly on both drivers.
- No accounting entries: Offers create no journal entries, invoices, payments or stock movements (asserted by test) — the CLAUDE.md "resulting journal entries" table is empty by design.

## 14. Risks / blockers

1. **Variant-managed products unsupported** (§8) — needs an owner decision before Offers can cover multi-variant catalogs (likely common for flowers/apparel verticals).
2. **12-offer cap** is a chosen constant (bounds pricing cost: ≈7 queries/offer). Raise only together with a batch-capable price path.
3. **Per-offer query cost** (§9) — acceptable at ≤12, not for hundreds; no batch resolver exists.
4. **Per-offer query cost grew with ATS** — ≈7 → ≈11 queries per live *tracked* offer (§9); still bounded by the unchanged 12-offer cap; no batch pricing/ATS path exists.
5. **`reference_price` provenance** — base price, not a merchant "was-price"; badge/strikethrough wording is an H4-7/product decision.
6. **A price-list item of 0** counts as a genuine discount (it is exactly what checkout would charge); H4-7 may want to special-case "free" display.
7. **Pre-existing list-vs-detail price drift** (§9) — outside this slice, flagged for follow-up.
7. ~~Availability (ATS) is not part of "live"~~ — **resolved in the review-fix round** (§6.1, owner-confirmed): ATS is now enforced. Original note follows for the record: **Availability (ATS) is not part of "live"** — contract §23.3 step 5 asks for the `AvailableToSellService` check, but no existing storefront read hides a product at ATS 0 (they expose an informational `in_stock`; reservation/checkout is the real gate), and hide-vs-show is a business policy (CLAUDE.md rule 6). Open owner decision: (a) add a batched `in_stock` to each offer, matching `store/v1/products` (cheap, recommended), or (b) hide out-of-stock offers behind a setting. Raised by the Codex review on #1202.
9. No financial review beyond the contract's reasoning (§23.6/§23.7): nothing here writes or reads accounting state, but the owner may still wish to confirm that reading is in scope.

## 15. H4-7 handoff

- Canvas: `GET /api/commerce/workspace/storefronts/{id}/offers` (per-row `evaluation`, `product`, config) — use `data[].id` as the `OffersContent.offerIds` reference (max 8 per contract); `is_live=false` rows should render as "not shown yet: {reason}" in the editor only.
- Published: `GET /store/v1/offers` — no params; already filtered; slice client-side to the section's `offerIds` (preserve the section's order) or show all up to 8.
- Create/edit: `POST/PATCH/DELETE` as above; surface 409 (duplicate), 422 (`product_id` ineligible / window / cap), and **never send price/discount fields**.
- Both TypeScript twins of `section-content.ts` get `OffersContent { offerIds: string[] }` only; `GATED_HOME_SECTION_KEYS` drops `offers`; flip `SECTION_CAPABILITIES.offers` to LIVE/`merchantAddable: true` **only in H4-7**, together with the editor and the published component.
- Use the backend `discount_percent` for the badge (do not recompute client-side); it may be `0` for sub-half-percent genuine discounts — decide whether to hide a 0% badge. No savings amount is provided.
- Offers that are out of stock / unfulfillable are already excluded from the public read; in the Canvas, `evaluation.reason` (`out_of_stock`, `fulfillment_not_configured`, …) explains why a configured offer is not shown.
- **Variant-managed products remain unsupported (fail-closed)** — needs an explicit later product decision on the representative price (cheapest? "from X"? per-variant?). Nothing is invented here.
- Optional: `commerce.offers` in `DataResourceRegistry` must read `store/v1/offers` (no id).

## 16. Confirmations

- **Offers remains GATED** (`state: "gated"`, `merchantAddable: false`): no web file changed; `section-capabilities.test.ts` (22 tests, incl. the explicit Offers-gated assertions) still passes on this head.
- **No Merge. No Deploy. No Production release.**
