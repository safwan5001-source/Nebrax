# AWJ Commerce — H6 Batch G: Wholesale Security Closure, Price Sorting & Native Storefront Integration

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-g` |
| PR | _(filled on open)_ |
| Base | `origin/main` @ `caba634d93eec9f674c3fe68a04be7b2df3f2419` (PR #1809, Batch F) |
| Head | _(filled on final push)_ |
| Status | Ready for review. **Not merged. Not deployed. Wholesale not enabled anywhere.** |

## 0. Summary

| Priority | Outcome |
|---|---|
| P1 — close `/commerce/v1` (API-key) price surfaces | **Done.** Audit of every price-bearing route; one real hole closed (a wholesale-flagged channel could be served to a machine credential if it ever became a mobile channel); DB CHECK makes that state unrepresentable on PostgreSQL; a route-classification test stops a new price-bearing route from shipping ungated. |
| P2 — price sort from the effective price authority | **Done** on all three product-listing surfaces. Root cause: ordering by the `products.sale_price` column, frozen since VAR-PRICE-1. |
| P3 — native wholesale storefront | **Delivered the safe, reusable surface**: buyer sign-in, membership status/application, access gate on protected catalogue pages, ar/en (+4 locales), mobile-first. Zero new Spree dependency. |
| P4 — cart & checkout under the wholesale channel | **Deferred, with evidence.** Backend security/price invariants hold (tested); five contract gaps block enabling checkout (§6). The storefront deliberately does not forward the buyer token to cart/checkout (guard-tested). |

Exclusions respected: wholesale not enabled; email verification untouched; no SMS/OTP; no accounting/ZATCA/payment/cancellation/lifecycle change; legacy Spree wholesale code untouched; no production setting or credential; not merged, not deployed. Batch H not started.

## 1. P1 — Security leaks found and fixed

### 1.1 Surface inventory (every route that can reveal a price)

| Surface | Auth | Channel resolution | Price-bearing? | Verdict |
|---|---|---|---|---|
| `store/v1` products/offers/cart/checkout (+ legacy `{tenantSlug}` routes in non-prod) | none / buyer session | **Host** (`ResolveStorefrontDomain`) | yes | gated by `EnsureWholesalePriceAccess` (Batch F); this batch adds the classification guard |
| `store/v1` categories, collections, media, policies, storefront config, delivery schedule | none | Host | **no** (verified: no price/amount in the controllers) | reviewed, listed |
| `store/v1` `orders/{order}/payment-status`, `checkout/payment-intent` | signed order reference | Host | own order only | deliberately ungated (Batch F §4), listed |
| **`commerce/v1`** products/cart/checkout/orders | **API key** (machine identity) | server-side: tenant's canonical **mobile** channel only (`MobileSalesChannelResolver`), never client-supplied | yes | **finding below** |
| `api/v1` products/partners/invoices | API key + scope | none (tenant-wide ERP data) | master `sale_price_minor` and ERP documents only; **no channel price list, no price-list assignment** (verified: no `price_list` in any `Public*` resource) | out of wholesale scope; sort fixed (P2) |
| `preview/v1`, App Builder `commerce/v1/experience` | preview/API key | mobile channel | no prices | n/a |
| Staff APIs (price lists, partners, channel settings, workspace storefront products) | Sanctum + RBAC | tenant | yes | authorised staff by design |

### 1.2 Finding and fix

**Finding (defence in depth, latent):** `/commerce/v1` authenticates a *machine* API key and resolves the tenant's mobile channel. A wholesale-flagged channel is a web channel (model guard), but that rule lived only in the Eloquent `saving` hook; raw SQL, a seeder or a later type edit could produce a flagged mobile channel, which any valid API key would then read prices from — i.e. an API key would be treated as wholesale-buyer approval.

**Fix:**
1. `MobileSalesChannelResolver::resolve()` — the single choke point for `/commerce/v1` — refuses a flagged channel (uniform 404) and **never falls back** to another mobile channel of the tenant.
2. Migration `2026_12_18_010000` (PostgreSQL): `CHECK (NOT wholesale_membership_enabled OR type = 'web')` — the state cannot exist at all. Additive; all existing rows are `false`. (SQLite, the test engine, cannot add a CHECK in place; the resolver refusal covers it.)
3. `WholesalePriceSurfaceBoundaryTest`:
   * unflagged mobile channel unchanged for its API key (DTC/internal use preserved);
   * flagged mobile channel: every path (`storefront`, `products`, detail, `cart`, `checkout`, `payment-methods`, `categories`, `collections`, `experience`, cart mutation) → 404 with no price in the body, and `sort=sale_price`, `-sale_price`, `search` cannot be used as a side channel; on PostgreSQL the raw update is *rejected by the CHECK* (asserted);
   * no fallback to a sibling mobile channel;
   * client-supplied `sales_channel_id`/`channel_id`/`tenant_id` params and `X-Sales-Channel`/`X-Tenant-Id` headers never select another channel or tenant, and tenant B's product is a 404 for tenant A's key;
   * an API key presented as `Authorization: Bearer` or `X-Customer-Token` on the wholesale **store host** is just an anonymous visitor (401) — a generic key is never buyer approval;
   * **route-classification guard:** every `store/v1` route must be either listed price-bearing **and** carry `EnsureWholesalePriceAccess`, or listed as reviewed-no-channel-price; a new unclassified route fails the test. Legacy slug routes carrying prices must also be gated; every `commerce/v1` route must pass through `ResolveCommerceChannel`.
4. Mutation-checked: removing the resolver refusal fails the flagged-channel and no-fallback tests.

### 1.3 Leak vectors checked
* **List/detail/search/sort/filter:** all gated or 404 on a flagged channel; sort cannot reveal order (P2 + tests).
* **Error responses:** 401/403/404 bodies carry no price (asserted).
* **Cache keys:** server: no price-bearing JSON response is cached (no `Cache::remember`/response cache on price endpoints; media is price-free). Storefront (Next 16, `cacheComponents`): the only `"use cache: remote"` functions are the category banner and market/currency lookups — none touches prices; an architecture test now **fails if any cached function imports the priced catalogue/offer/cart/checkout modules**, and a buyer-token request is forced `cache: "no-store"` (tested), so a buyer-scoped response can never enter a cache keyed only by URL/host. DTC vs wholesale are separate hosts, hence separate Host-keyed requests.

## 2. P2 — Price sorting

**Root cause.** `sort=sale_price` was mapped to `ORDER BY products.sale_price`. Since VAR-PRICE-1 that column is frozen: the price authority is `product_unit_prices` (read through the `Product::sale_price` accessor), plus the channel's active price list on top. New products carry the column default `0`, so the order collapsed to the `id` tie-break and bore no relation to the displayed amounts (found while addressing a Batch F review finding; reported there as deferred). The staff product list had already been migrated; the public ones had not.

**Resolution.** `App\Support\Commerce\EffectivePriceOrdering` orders by exactly what the listing displays, tier for tier: variant-managed → `0` (its list row shows 0) → channel's **active** list item for the product's unit → base unit price (`product_unit_prices`, variant NULL) → `0`; tie-break `products.id desc` (the existing tie-break). Correlated subqueries (no join): no row multiplication, so pagination/`total` stay exact, no ambiguity with `TenantScope`, one SQL statement, **no in-memory sorting**. Applied to `store/v1`, `commerce/v1` (mobile) and `api/v1` (ERP, base tier only). `PublicApiController::applySort` got an optional hook so each surface plugs in without duplicating validation.

Also removed an N+1: the `commerce/v1` list used one full resolver round-trip per row; it now uses the batched `browsePrices()` (identical result).

**Contract.** Parameter name and enum values are unchanged (`sale_price`, `-sale_price`); the OpenAPI text now states the semantics (description only). The storefront maps its `price` sort to `sale_price` and needs no change. Observable change: price-sorted results are now actually price-ordered (previously effectively arbitrary) — the documented intent.

**Evidence (`PriceSortAuthorityTest`, SQLite + PostgreSQL):**

| Property | Test |
|---|---|
| Ascending / descending, minor units | DTC base prices 300/100/200/250 → `[100,200,250,300]` / reversed |
| Tie-break + pagination | 3×500 + 4×900 walked in pages of 3 = identical to the full list; no row repeated/skipped; stable across calls |
| Pagination meta + filters | `total` excludes unpublished; `last_page` correct; search narrows first, then the sort orders only that set |
| Channel price list + fallback | base 100/200/120 with list 300/50/(none) → `[50,120,300]`; page 1 of ascending = the cheapest *displayed* product |
| Inactive list / other channel / other tenant | ignored exactly as in the displayed price |
| Variant-managed | sorts as the `0` its row displays |
| DTC compatibility | default / `name` / `-name` unchanged; unsupported sort still 422 |
| N+1 / in-memory | pricing+ordering query count identical for 1 vs 16 rows; ordering SQL contains `product_unit_prices` and `limit` |
| Mobile and ERP surfaces | channel-resolved order + pagination; ERP sorts by the `sale_price_minor` it reports |

Two Batch F assertions that pinned the *legacy* DTC sort statement were updated (disclosed in §9).

## 3. P3 — Native wholesale storefront (what was delivered)

**Principle:** reuse the backend buyer foundation (Batch E) and the AWJ design system; add no second identity system, no Spree code, no legacy-portal coupling.

| Capability | Implementation |
|---|---|
| Host/channel context | unchanged: the storefront server forwards the real Host (+ gateway secret); the backend resolves tenant/channel. A wholesale host is simply a host whose channel is flagged. |
| Buyer sign-in | `/{country}/{locale}/buyer/sign-in` → server action → existing `POST store/v1/auth/login`. Token stored **only** in an HttpOnly, SameSite=Lax, host-only cookie (`awj_buyer_session`); never returned to client code, never in a URL/localStorage. Failures collapse to one message (unknown / wrong password / unverified email). |
| Membership application + status | `/buyer/membership` — states from `GET me` + `GET wholesale/membership`: signed out, no application (Apply), pending, approved, rejected, suspended, unavailable. Apply is the only buyer action; approval is a staff decision. Unknown status fails closed to "unavailable", never "approved". |
| Protected catalogue/pricing | `ProductListing` (all product/category/search lists) and the product page render `CatalogAccessGate` on API 401 (sign in) / 403 (approval required) instead of an error or empty grid. Other errors keep their existing handling. Buyer token is forwarded on price-bearing catalogue reads only (products, product detail, featured/shelf products, offers) and forces no-store. DTC visitors have no cookie → requests byte-identical. |
| Sign-in / approval-required states | `CatalogAccessGate` + `BuyerMembershipPanel`; no product, name or price rendered in a gated state (tested). |
| Arabic/English + mobile | `wholesaleBuyer` message namespace in **all six locales** (ar, en, de, es, fr, pl; parity script passes); `AccountAuthCard` (single column, `max-w-lg`, `sm:` paddings), store tokens, RTL via the existing `dir` handling; password field with show/hide. |
| Design reuse | `AccountAuthCard`, `AccountPasswordField`, `Field/Input/Button/Badge/Alert`, `StoreContainer` — no new tokens or primitives. |

Registration UI is intentionally not added (registration stays staff/onboarding-provisioned; see blockers).

## 4. P4 — Cart and checkout decision: **deferred**

Evidence (`WholesaleCartCheckoutBoundaryTest`, 9 tests, SQLite + PG). **Holds today:**

| Required invariant | Result |
|---|---|
| Host-bound tenant & channel | cart row bound to the host's channel; each channel's cart is its own |
| Approved membership on every protected request | suspension mid-flow → `GET cart`, `GET checkout`, `POST checkout/complete` all 403; no order created |
| No DTC cart fallback | anonymous visitor on the wholesale host: 401, **no cart row created at all** |
| No cross-channel cart reuse | wholesale token on the DTC host and DTC token on the wholesale host both yield an empty cart; prices never cross |
| Server-authoritative prices | list price 700 applied server-side; a `unit_price` in the request is ignored/rejected |
| Revalidation at completion | list re-priced 700→650 between add and complete → order at 650 |
| Price-source recording | order line `price_source = price_list` + the list id (Batch F provenance) |
| Idempotency | same key replays, one order |

**Blocks enabling checkout for wholesale (tests pin the current behaviour so changing it is a deliberate decision):**
1. **No buyer attribution** — `store/v1` checkout is anonymous by design (ADR-24): `commerce_orders.customer_identity_id` and `partner_id` stay NULL even for an approved buyer.
2. **No per-buyer (partner) price list** — cart/checkout pass `partnerId = null`; only the channel list applies.
3. **No tax/VAT presentation or B2B price-excl.-VAT contract** — cart/checkout payloads carry no tax field (`TAX_PRESENTATION_CAPABILITY = deferred`); correct tax needs an approved tax scope.
4. **No minimum-order / MOQ / pack-multiple rules** — none exist in `CommerceCartService`/`revalidateAndPrice`.
5. **No net-terms/credit payment** — only per-channel cash-settlement/online methods.

Consequently the storefront **does not** forward the buyer token to cart/checkout/payment/orders (architecture-tested), the approved-buyer page states "online ordering for wholesale buyers is not available yet", and no adapter or cast was invented. The legacy Spree wholesale checkout was not touched.

## 5. Operational blockers

| Blocker | Impact |
|---|---|
| **Verification-email delivery is missing** (Batch E: registration returns `verification_required` but nothing sends it) | A new buyer can never verify, so cannot sign in (verified-email enforcement preserved — not disabled). Buyers must currently be provisioned/verified by staff or an operator until delivery exists. This is why no registration UI was built. |
| Wholesale deployment gate `COMMERCE_WHOLESALE_BUYER_ENABLED` is off everywhere | Wholesale hosts return 404 for everything; the gate/sign-in pages render "unavailable". By design. |
| Wholesale host sitemap | A flagged host's sitemap fetch gets 401 and returns the existing 5xx (no data leaked). Wholesale hosts should serve noindex/disallow — Batch H. |
| CI-only verification | See §8. |

## 6. Spree dependency counts (before → after)

`spree_value_imports` 4 → 4 · `spree_type_imports` 4 → 4 · `spree_client_access` 52 → 52 · `spree_wrapper_imports` 69 → 69 · `spree_env_reads` 9 → 9 (ratchet OK). Guard test asserts the new files import no `@spree/*`, `lib/spree` or `SPREE_*`, and do not reuse the legacy group-based wholesale portal.

## 7. DTC compatibility results

* Channels without a price list: listing/detail/cart prices unchanged (Batch F suite still green); name/created sorts and default order unchanged.
* The buyer token is absent for DTC visitors → storefront requests byte-identical (`buyer-token-forwarding.test.ts` asserts no extra header and no forced cache mode).
* `EnsureWholesalePriceAccess` remains a pass-through for unflagged channels; DTC cart/checkout flows (`CommerceCheckoutApiTest`, `StorefrontCheckoutCompletionApiTest`, order/payment suites) green.
* Only intended DTC-visible change: `sort=sale_price` now orders by the displayed price (see §2).

## 8. Tests and CI results

_(filled from the final runs — see below)_

## 9. Existing assertions changed (disclosed)

`StorefrontPriceParityTest::a_price_sort_on_a_channel_without_a_list_…` (Batch F) asserted the legacy `order by "sale_price"` statement; replaced with an assertion of the new base-unit-price ordering. No other existing assertion was altered.

## 10. Deferred / risks

* Checkout for wholesale (§4) and registration UI/verification delivery (§5).
* `commerce/v1` remains a mobile-only machine surface; if a wholesale **mobile app** is ever wanted it needs its own authenticated-buyer design, not an API-key exception.
* Wholesale host SEO posture (robots/sitemap/noindex).
* Per-buyer price lists (partner link) — deliberately not started.
* e2e (Playwright) flows were not run (no browser stack in this environment).

## 11. Recommended Batch H

1. **Buyer attribution on orders** — thread the approved buyer identity (and an approval-linked Partner) through `store/v1` checkout so wholesale orders are attributable; prerequisite for anything else in checkout.
2. **Per-buyer pricing** — partner/tier price list behind its own setting, with parity tests across list/detail/cart/order.
3. **Ordering rules** — minimum order and MOQ/pack multiples enforced in `revalidateAndPrice` with a clear storefront message.
4. **Tax display contract** for B2B (price excl. VAT) — needs an approved tax scope; then enable the storefront cart/checkout token forwarding behind a `WHOLESALE_CAPABILITY` constant.
5. **Verification-email delivery** (Messaging Foundation) and then a buyer registration page.
6. Wholesale-host robots/noindex + sitemap policy.
