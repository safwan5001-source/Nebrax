# AWJ Commerce — H6 Batch J: approved wholesale price precedence and fail-closed enforcement

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-j` |
| PR | #1823 |
| Base SHA (origin/main) | `4f93795d9` (contains the #1821 merge `1dd736d19ac800f9bca15ce590fbab37ba519d8f`) |
| Code head SHA (all CI green) | `f7ffc0f72c3d2ee493ceb29342287d1e2f4786eb` |
| Report commit | docs-only commit on top of the code head (changes this file only; its own CI run is on the PR) |

**Status.** Wholesale is not activated: `commerce.wholesale_buyer_enabled` stays off and no tenant, deployment or database was touched. Nothing merged, nothing deployed. No MOQ, credit terms or tax policy was added. The Spree wholesale checkout is untouched; the Spree exit is **not** complete.

## 1. The approved precedence, as built

For a channel flagged `wholesale_membership_enabled` (and only for such a channel), every price is resolved, per line, by the first hit of:

| Rank | Source | Valid when |
|---|---|---|
| 1 | The approved buyer's **partner price list** item | active `CustomerPartnerLink` → partner active, not deleted, customer type → `default_price_list` active and resolvable in this tenant → an item exists for the product / unit / variant |
| 2 | The **wholesale channel's** price list item | channel list active and resolvable in this tenant → an item exists |
| 3 | **Unavailable for wholesale** | neither tier has an eligible item (or the request is not an approved buyer of this channel) |

The product's base/retail price is **never** a substitute. A partner list that lacks a product falls through to the channel list (decision D-B1). An inactive list is skipped; "expired" means inactive because price lists carry no validity dates. A channel list reference that the tenant scope cannot resolve (deleted or cross-tenant) makes that tier unavailable and logs a warning instead of falling back. A price of `0` in a list remains a deliberate explicit price. Channels not flagged wholesale (DTC, mobile) never enter this code.

Buyer identity comes only from the authenticated server session (`CustomerContext`, established by `EnsureWholesalePriceAccess` after token, channel and membership checks). The resolver re-checks an **approved membership for this exact channel and tenant** (defence in depth) and ignores any caller-supplied partner id on a wholesale channel. The partner tier is **not** gated by the POS setting `apply_customer_price_list` (D-B2); POS and every other module keep their own behaviour untouched.

## 2. Implementation

| Piece | Change |
|---|---|
| `WholesalePriceAuthority` (new) | The single authority: membership, partner tier, channel tier, item lookup, row-lock + re-read of the list under `lockEligibility` (so a concurrent deactivation is seen) |
| `WholesalePriceContext` (new) | Immutable server-resolved standing of one request |
| `CommercePriceResolver` | One branch in `resolve()` delegating to the authority; `browseWholesalePrices()` (batched, one query per page per list), `wholesaleListIds()`, `isWholesaleChannel()` |
| `ResolvedCommercePrice` | New optional `unavailableReason` (`unavailable_for_wholesale`), deliberately identical for "no price" and "not an approved buyer" so it never reveals membership status |
| `EffectivePriceOrdering::applyWholesale()` | `sort=sale_price` follows the displayed precedence; unavailable items sort **last in both directions**; variant-managed products as in the listing |
| `StorefrontProductController` | Listing, detail, search, sort and variant detail use the authority; the two retail fallbacks (`?? $product->sale_price`, variant `?? 0`) are removed **for wholesale only** |
| `StorefrontProductResource` | `price` may be `null`; a `wholesale_availability: {state}` key that exists **only** on wholesale channels (DTC response shape is literally unchanged) |
| `StorefrontOfferResolver` | Offers never "discount" on a wholesale channel (the comparison is against the retail reference, which a wholesale buyer must not see presented as a promotion) |
| `CommerceWorkspaceStorefrontProductController` | The staff preview of a wholesale channel (no buyer) shows "unavailable", never the retail price |
| Storefront `types.ts`, `mappers.ts` | `price` may be `null`; null / `unavailable_for_wholesale` maps to the existing "no price" view and not purchasable (otherwise the page would crash dereferencing `null`) |

**Cart, checkout and order need no new code path** (no alternate checkout engine): cart add/update/serialize (`purchasable()`), checkout completion (`price_unresolved`) and the order path already treat an unresolved price as a failure, and the cart re-prices on every read and keeps no stored price. Because they all call the resolver, the new precedence reaches them automatically. `CommerceOrderService::createFromCheckout` receives the lines the checkout service just priced (under lock), so the checkout service is the pricing authority there, and the Batch H membership re-check under shared lock still guards the order itself. Order-line provenance (`price_source`, `price_list_id`) is unchanged and now records which tier supplied the price.

## 3. Protected endpoints

All `store/v1` price-bearing routes already carry `EnsureWholesalePriceAccess` (route-classification guard `WholesalePriceSurfaceBoundaryTest`, unchanged and green): `products.index|show`, `offers.index`, `cart.show`, `cart.items.store|update|destroy`, `checkout.show|store`, `checkout.contact|address|gift|schedule|delivery|payment.update`, `checkout.payment_methods.index`, `checkout.complete`. `/commerce/v1` never serves a wholesale channel (database check constraint plus tests). No route was added; no permission or ERP staff scope changed.

## 4. Evidence

### 4.1 Precedence and fallback, parity (`WholesalePricePrecedenceTest`, 26 tests)
Partner → channel → unavailable (listing, detail, search, cart agree per product); buyer without a link; no valid list at all; inactive partner list; inactive channel list (partner still prices, the channel-only item becomes unavailable, **never 1000**); revoked link, inactive partner, supplier-only partner; POS toggle independence; price sort asc/desc with unavailable last; sort and pagination exactness; variant-managed product available only when an **active** variant has a **base-unit** entry in an eligible list (entries for an inactive variant or an alternative unit advertise nothing, identically in listing, sort and detail).

### 4.2 Security and isolation
Foreign-tenant partner list ignored; foreign-tenant channel list reference ⇒ unavailable; approval on one channel prices nothing on another channel; foreign-tenant `CustomerContext` ⇒ ineligible; a caller-supplied partner id ignored; unauthenticated and staff-preview callers get no price; suspended buyer refused (403) and reinstatement restores pricing; revoked session loses prices, cart and checkout (401) with **no order and no payment intent**; browser-supplied `unit_price`, `price`, `amount_minor`, `partner_id`, `price_list_id` rejected (422) and no cart line created.

### 4.3 Cart and checkout fail-closed
Cart totals re-price on every read (2×500 → 2×700 → 0 with `has_unavailable_items`, never 2×1000) and a quantity update on a vanished price is refused; completion after the price disappears returns 409 with **no order, no line, no payment intent**; a price-list change between cart and checkout is revalidated server-side (order priced 450 after the repricing, not the 500 the buyer saw); order lines record the supplying tier (`price_list` + partner list id / channel list id) and never `product_default`.

### 4.4 PostgreSQL concurrency (`WholesalePricePrecedencePostgresConcurrencyTest`, real `pcntl_fork`)
(a) deactivating a list waits for an in-flight checkout price resolution; (b) a deactivation committed just before the locked resolution is seen and the line falls to the channel list (700), not the stale 500 and not retail 1000. *Candour:* mutation check — removing the locked re-read fails (b); (a) is additionally protected by the item-row lock inside `PriceListService::resolve`, so it does not fail on that single mutation.

### 4.5 DTC compatibility
DTC listing, detail, cart and search keep the retail price; a DTC channel list still prices DTC; the DTC response has no `wholesale_availability` key; existing DTC suites (price parity, price sort, resolver, offers, cart, checkout, order, flowers journey) pass unchanged on both engines.

### 4.6 Mutation checks
Disabling the wholesale branch (letting wholesale fall to the base logic) fails 8 tests of `WholesalePricePrecedenceTest`; removing the locked re-read fails the PostgreSQL race test.

### 4.7 Review fix (Codex P2 on PR #1823, verified real, my own defect)
The listing and the sort counted *any* variant entry in an eligible list, while the detail page prices only active variants in the product's base unit, so a card could advertise a product the buyer could not buy. The listing query and `EffectivePriceOrdering::applyWholesale()` now apply the detail page's predicate (active variant of this product, product's base unit). A regression test fails on the previous code and passes now; affected suites re-run green on SQLite (779 passed, 41 skipped) and PostgreSQL (820 passed).

### 4.8 Review fix 2 (Codex P2 on PR #1823, verified real, my own defect)
The staff preview API now returns `price: null` for a wholesale channel, but the ERP web workspace mapper turned null into `0` with a defaulted `SAR` currency and the preview canvas formatted it unconditionally, so a merchant would have seen a zero (and, for non-SAR tenants, wrongly denominated) price. `workspace-products.ts` now preserves `null` for the product and each variant (an ordinary price maps exactly as before) and `StorefrontPreviewCanvas.tsx` renders "غير متاح للجملة / Unavailable for wholesale" for it. Two new mapper tests; web workspace and store-builder suites pass (3,800 tests); the touched files add no type errors (the repo's 55 pre-existing `tsc` errors in unrelated test files are unchanged).

## 5. Financial regression
No accounting, VAT, ZATCA, payment-capture, order-lifecycle or cancellation code was changed, and no migration was added. A wholesale order still creates no invoice, payment, journal entry or stock movement (Batch I characterization test passes unchanged). Currency comes from the tenant exactly as before; amounts remain integer minor units; order-line price evidence is unchanged and recorded the same way.

## 6. Test results

| Gate | Result |
|---|---|
| New `WholesalePricePrecedenceTest` | 26 passed (SQLite and PostgreSQL) |
| New `WholesalePricePrecedencePostgresConcurrencyTest` | 2 passed on PostgreSQL (skipped on SQLite) |
| Affected suites on PostgreSQL (wholesale, resolver, parity, sort, products, offers, buyer verification, cart, checkout, order, workspace product, flowers journey, module boundary, partner link, price lists) | 846 passed |
| Full backend suite, SQLite (29 chunks) | 9,923 passed, 301 skipped (PostgreSQL-only), 26 failed — **all 26 are `Fuel*` tests** (`FuelAviRfid`, `FuelReconciliation`, `FuelSaleApi`, `FuelSaleService`, `FuelSupplyReceivingApi`, `FuelSupplyReceiving`) failing with `Call to undefined function bcmul()`: the `ext-bcmath` extension is absent in this environment only (CI installs it). No pricing, wholesale, commerce or storefront test failed. |
| Storefront `tsc --noEmit` | exit 0 |
| Biome | exit 0, 5 warnings / 3 infos (unchanged baseline) |
| Vitest | 247 files, 3,552 passed, 16 skipped (+4 new mapper tests) |
| `check:locales` | all locales in sync |
| Spree ratchet | OK, unchanged: 4 / 4 / 52 / 69 / 9 |
| `pnpm build` | exit 0 |
| CI / CI Gate (code head `f7ffc0f`) | **All 9 checks green:** `php artisan test` SQLite, `php artisan test` PostgreSQL, `web build (Next.js)` (both event runs), `storefront (lint + typecheck + test)`, `docker-context`, `published footer visual QA`, `merchant preview visual QA`, `CI Gate`. Codex: three review rounds on this PR produced two valid P2 findings (variant availability predicate; staff-preview null price), both my own defects, both fixed with regression tests and resolved; the final round has no findings. |

Environment note: `Fuel*` tests need `ext-bcmath`, absent locally only; CI installs it.

## 7. Existing tests changed (disclosure)
Exactly one assertion block, and by design. `WholesaleCartCheckoutBoundaryTest::characterization_a_linked_partner_price_list_does_not_change_wholesale_prices_today` (Batch H/I) pinned that a linked partner list did **not** change wholesale prices, written so that this very change could only arrive as a reviewed decision. The owner has now approved it, so it is replaced by `a_linked_partner_price_list_now_prices_the_wholesale_buyer_consistently_everywhere` (same scenario, asserting 500 on listing, detail and cart). No other test was modified, weakened or skipped. `CommercePricePrecedenceMatrixTest` (Batch I) is unchanged and still passes: it characterizes a **non-wholesale** channel, which is untouched.

## 8. Changed files
- Backend: `app/Services/Commerce/WholesalePriceAuthority.php` (new), `WholesalePriceContext.php` (new), `CommercePriceResolver.php`, `ResolvedCommercePrice.php`, `StorefrontOfferResolver.php`, `app/Support/Commerce/EffectivePriceOrdering.php`, `app/Http/Controllers/Api/StorefrontProductController.php`, `CommerceWorkspaceStorefrontProductController.php`, `app/Http/Resources/StorefrontProductResource.php`.
- Storefront: `src/lib/commerce/types.ts`, `mappers.ts`, `__tests__/mappers.test.ts`.
- ERP web (staff preview): `web/src/modules/commerce-workspace/workspace-products.ts` and its test, `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`.
- Tests: `WholesalePricePrecedenceTest` (new), `WholesalePricePrecedencePostgresConcurrencyTest` (new), `WholesaleCartCheckoutBoundaryTest` (one test replaced).
- Docs: this report.

## 9. Remaining blockers and risks
- **Not activated.** The trusted visitor identity (D-T1) is still unimplemented and awaits the operator's proxy evidence; one shared gateway login bucket remains. Production mail (`MAIL_MAILER=resend`, `RESEND_KEY`, sender domain) is still unverified.
- **Storefront buyer token forwarding to cart and checkout is still not wired** (Batch G guard test unchanged), so the native wholesale cart/checkout cannot be used from the storefront yet even though the backend now prices it correctly. The Spree checkout remains the live path.
- **Offers** never discount on wholesale channels (a conservative choice documented above, no dedicated test): needs owner confirmation if wholesale promotions are wanted.
- **Staff preview** of a wholesale channel now shows "unavailable" (no buyer, no retail); a staff "preview as buyer" capability is a separate feature.
- Unverified here: behaviour of a deployed edge in front of the API, real mail delivery, and the storefront UI rendering of the unavailable state beyond the mapper unit tests (no browser run).
- Still undecided (unchanged from Batch I): MOQ, minimum order amount, B2B tax display, payment terms/credit, COD, suspended-cart retention.

## 10. Recommended next batch
Batch K — **wire the storefront buyer session through cart and checkout** (forward the HttpOnly buyer token for wholesale hosts only, render the unavailable state and disable add-to-cart for it, keep Spree as the fallback until parity evidence exists), with an end-to-end storefront test of list → cart → checkout → order against this precedence. In parallel and independent: the operator's proxy-chain evidence for D-T1, and the owner's answers on MOQ, minimum order and tax.
