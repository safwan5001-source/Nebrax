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
              "starts_at", "ends_at" } ],
  "meta": { "request_id" } }
```

Only **live** offers (active ∧ in window ∧ product active+published on this channel ∧ genuinely discounted), ordered by `position, created_at, id`, capped at 12. Nothing about *why* something is hidden is ever exposed publicly.

## 6. Authoritative discount determination

> **Real discount ⇔ `CommercePriceResolver::resolve(product, channel)` is resolved and its amount is strictly lower than `Product.sale_price`.**

- `referencePrice = (int) Product.sale_price` (public base price).
- `offerPrice = CommercePriceResolver->resolve($product->id, $channelId)->amount` — anonymous (no partner), base unit: byte-for-byte the price Cart V1 charges. A test proves `offer_price == resolver amount == cart line unit_price`.
- Equal, higher, unresolved, or a resolver exception (corrupt/deleted/foreign price-list reference) ⇒ **omitted (fail-closed)**.
- Computed fresh on every read; nothing stored. Tax is absent by design (as in the resolver). No new pricing semantics were invented: the discount is exactly "the channel's active price list overrides the base price downward", which is the only discount mechanism existing Commerce pricing has.
- **No percentage, no savings amount, no strikethrough flag.** The contract (§23.3 step 4) sketched `discountPercent`; per this task's rule ("do not fabricate… unless the pricing API explicitly supports and proves them") it is deferred. The two proven numbers are returned; H4-7 decides whether/how to derive badge math from them.
- Contract nuance (judgement call, flagged): `reference_price` is `Product.sale_price`, which the resolver does not expose itself. It is returned because it *is* the proof of the discount the filter relies on; H4-7 should treat it as "base price", not as a "was-price" claim.
- Not a promotions engine: no coupon / cart / checkout / invoice / POS / customer-specific logic; no change to any pricing path (`CommercePriceResolver`, `PriceListService`, cart, checkout, invoice math all untouched).

## 7. Host resolution, tenant isolation, sales-channel eligibility

- **Public:** authority exclusively from `StorefrontContext` (set by `ResolveStorefrontDomain`). Tests: Host A never sees B; second storefront of the same tenant doesn't leak; `?storefront_id=…&tenant_id=…&sales_channel_id=…` + `X-Storefront-Id`/`X-Tenant-Id` headers have no effect; wrong gateway secret cannot redirect the host while the right one resolves the forwarded host; unknown host / unverified domain / inactive domain / inactive storefront ⇒ 404; the route has zero parameters; a foreign-tenant product row planted by raw SQL cannot surface.
- **Workspace:** every verb on a foreign storefront ⇒ 404 with nothing written/changed; foreign vs unknown storefront indistinguishable; another tenant's offer id via my own storefront ⇒ 404; same-tenant sibling storefront's offer is invisible and untouchable; foreign product ⇒ uniform 422 without leaking; soft-deleted storefront ⇒ 404; unauthenticated 401; `staff`/`self_service` 403.
- **Channel eligibility:** published listing on the offer's *own storefront channel* only (published on another channel of the same tenant ⇒ omitted publicly and rejected on create).

## 8. Variant behavior

**Variant-managed products are omitted (fail-closed) from the public read and rejected at configuration time.** Reason: the parent has no price (`resolve()` itself refuses `variantId = null`), and a storefront "offer" card for a multi-variant product needs a *representative* price (cheapest? first? "from X"? per-variant badges?) — a display-pricing decision that has not been approved and that existing pricing semantics do not answer. Inventing it here would violate the "no new pricing semantics" rule, so it is documented rather than guessed. The workspace list still shows such a row as `reason: "variant_managed"` (never hidden silently). Path to enable later: owner decision on the representative-variant rule, then per-variant `resolve()` vs `ProductPricingService::resolveSellable()`.

## 9. N+1 / performance findings

- Batched: one query each for products, publication, thumbnails (shared-media layer, same ordering as `resolveGallery`), price-list items; currency read once.
- Two *necessary-condition* short-circuits skip resolver calls whose answer is already known: (1) channel has no default price list ⇒ every product resolves to base ⇒ no discount; (2) product has no explicit item in that list ⇒ same. These narrow work; they are **not** a price source — every surviving candidate is priced by `CommercePriceResolver`.
- Measured (sqlite, includes middleware/auth/host-resolution baseline): **1 live offer = 17 queries, 8 = 66, 12 = 94 (≈7/offer)**; **12 non-discountable candidates = constant (≤14)**. Bounded by the 12-offer cap and linear. The ≈7/offer comes from the existing per-product `CommercePriceResolver::resolve()` (Product, SalesChannel, Tenant, PriceList, PriceListItem lookups) + one `sale_price` read. There is **no existing batch-safe resolver entry point**; adding one would be a pricing refactor, which is out of scope and not needed at a ≤12 cap — so this is reported, not "fixed". Asserted in tests (≤8/offer, ≤120 total at 12).
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

**New tests: 92** (3 files) + 1 shared fixture trait — all green on **SQLite and PostgreSQL 16**.

| File | Tests | Covers |
|---|---|---|
| `StorefrontOfferModelTest` | 13 | exact column list (no price/discount column), `$fillable`, unique pair + read-path indexes, relations, foreign-tenant product/storefront rejected, tenant scope, strict window, SQL-vs-memory boundary parity, deterministic ordering, **OWNED_CHILD cleanup on true product delete**, `CompanyWide` |
| `CommerceWorkspaceStorefrontOfferApiTest` | 36 | create/list/update/delete, defaults + append position, UTC storage, validation, invalid windows, **10 forbidden fields** (price/discount/percent/…/tenant_id/storefront_id) rejected 422 with nothing persisted, duplicate 409, uniform ineligible-product 422 (foreign/missing/unpublished/inactive/other-channel indistinguishable), variant-managed rejected, 12-cap, evaluation reasons, workspace-vs-public parity, partial update + `null` clears, product change rules, delete, **tenant A vs B on every verb → 404 with no mutation**, foreign≡unknown storefront, cross-tenant offer id via own storefront, same-tenant sibling storefront, soft-deleted storefront, 401, 403 (`staff`, `self_service`), **no price/product/price-list/journal/invoice side effects** |
| `StorefrontOfferPublicApiTest` | 43 | genuine discount returned (25000→19000) with both real prices; payload allow-list (no percent/saving/cost/internal facts); **offer price == `CommercePriceResolver` == real cart line price**; no row ⇒ omitted; no price list / no item / equal / higher / inactive list ⇒ omitted; corrupt price-list reference ⇒ fail-closed (no 500); live tracking of price-list edits; **variant-managed omitted** (and a simple product beside it unaffected); unpublished/inactive/other-channel product omitted; **10 window cases** incl. exact boundaries; inactive offer; UTC ISO output; deterministic order; read bounded at the cap; **Host A≠B**, same-tenant second storefront, query/header injection ignored, wrong gateway secret, unknown/unverified/inactive domain & storefront ⇒ 404, route has no parameters, raw-SQL-planted foreign product can't surface; thumbnail; existing `store/v1/products` output unchanged; **query budgets** |

Other gates touched/verified:
- `BranchIsolationGuardTest`, `CommerceModuleBoundaryTest` (allow-list updated), `ProductReferenceClassificationGuardTest` (failed on the first full run → fixed, §11.1), `ProductLifecycleTest` — green.
- Web: `section-capabilities.test.ts` 22/22 — `offers.state === "gated"`, `merchantAddable === false` (no web file changed).

**Targeted** (offers + guards + lifecycle + boundary): 109 passed (762 assertions) on SQLite **and** on PostgreSQL 16.

**PostgreSQL 16 broad subset** (`Commerce|Storefront|ProductLifecycle|ProductReference|PriceList|BranchIsolation|TenantIsolation|ApplicationCatalog`): **1436 passed, 0 failed** (8225 assertions).

**Full suite, SQLite** (`php artisan test`, no filter): **5331 passed, 51 skipped, 57 failed**. The 57 failures are in 17 classes that are **environmental in this sandbox and fail identically on unmodified `origin/main`**, none touching Offers:
- `bcmul()` undefined — `bcmath` ext not installed locally (CI installs it): `Fuel*` (6 classes).
- `Aws\Exception\AwsException` not found — `league/flysystem-aws-s3-v3` not installed locally (CI installs it): `ProductMediaR2*`, `R2*` (7 classes).
- Mail transport/mailable not sent: `AuthRecoveryTest`, `UserInvitationTest`, `ResendMailTransportTest`; plus `ProductOptionValueVisualTest`, `FuelSupplyReceivingApiTest` (500s).
- Baseline proof: with this branch's changes stashed, the 6 classes with non-obvious causes failed with the same tests (24 failures in that run); on this head the same tests fail. The one test this branch *did* break on the first full run (`ProductReferenceClassificationGuardTest`) is fixed; the count dropped 58 → 57.

Perf measurement (sqlite, includes middleware baseline): 1 live offer = 17 queries, 8 = 66, 12 = 94 (≈7/offer); 12 non-discountable candidates = constant ≤14.

## 13. Build / CI

- CI (`ci.yml` php on sqlite + pgsql; `web-ci.yml`) runs on the PR — status recorded in the PR; see the final response / PR checks. No `web/` change, so Web CI is unaffected in substance.
- Local gates run: full SQLite suite, targeted + broad PostgreSQL 16 suites, vitest for the capability registry. Migration applies cleanly on both drivers.
- No accounting entries: Offers create no journal entries, invoices, payments or stock movements (asserted by test) — the CLAUDE.md "resulting journal entries" table is empty by design.

## 14. Risks / blockers

1. **Variant-managed products unsupported** (§8) — needs an owner decision before Offers can cover multi-variant catalogs (likely common for flowers/apparel verticals).
2. **12-offer cap** is a chosen constant (bounds pricing cost: ≈7 queries/offer). Raise only together with a batch-capable price path.
3. **Per-offer query cost** (§9) — acceptable at ≤12, not for hundreds; no batch resolver exists.
4. **`reference_price` provenance** — base price, not a merchant "was-price"; badge/strikethrough wording is an H4-7/product decision.
5. **A price-list item of 0** counts as a genuine discount (it is exactly what checkout would charge); H4-7 may want to special-case "free" display.
6. **Pre-existing list-vs-detail price drift** (§9) — outside this slice, flagged for follow-up.
7. **Availability (ATS) is not part of "live"** — contract §23.3 step 5 asks for the `AvailableToSellService` check, but no existing storefront read hides a product at ATS 0 (they expose an informational `in_stock`; reservation/checkout is the real gate), and hide-vs-show is a business policy (CLAUDE.md rule 6). Open owner decision: (a) add a batched `in_stock` to each offer, matching `store/v1/products` (cheap, recommended), or (b) hide out-of-stock offers behind a setting. Raised by the Codex review on #1202.
8. No financial review beyond the contract's reasoning (§23.6/§23.7): nothing here writes or reads accounting state, but the owner may still wish to confirm that reading is in scope.

## 15. H4-7 handoff

- Canvas: `GET /api/commerce/workspace/storefronts/{id}/offers` (per-row `evaluation`, `product`, config) — use `data[].id` as the `OffersContent.offerIds` reference (max 8 per contract); `is_live=false` rows should render as "not shown yet: {reason}" in the editor only.
- Published: `GET /store/v1/offers` — no params; already filtered; slice client-side to the section's `offerIds` (preserve the section's order) or show all up to 8.
- Create/edit: `POST/PATCH/DELETE` as above; surface 409 (duplicate), 422 (`product_id` ineligible / window / cap), and **never send price/discount fields**.
- Both TypeScript twins of `section-content.ts` get `OffersContent { offerIds: string[] }` only; `GATED_HOME_SECTION_KEYS` drops `offers`; flip `SECTION_CAPABILITIES.offers` to LIVE/`merchantAddable: true` **only in H4-7**, together with the editor and the published component.
- Decide badge math (percent/savings) from `reference_price`/`offer_price`; add a dedicated backend field only if H4-8 review demands it.
- Optional: `commerce.offers` in `DataResourceRegistry` must read `store/v1/offers` (no id).

## 16. Confirmations

- **Offers remains GATED** (`state: "gated"`, `merchantAddable: false`): no web file changed; `section-capabilities.test.ts` (22 tests, incl. the explicit Offers-gated assertions) still passes on this head.
- **No Merge. No Deploy. No Production release.**
