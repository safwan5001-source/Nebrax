# AWJ × Spree Storefront — Technical Fit Audit

**Status:** Audit only — no production code changed, no migrations, no APIs, no merge.
**Date:** 2026-09-10
**Spree Storefront revision inspected:** `2ad6ad5bd1bcc055467064bd57cf20ab5f711c88` (shallow clone of `github.com/spree/storefront`, dated 2026-09-06)
**AWJ base SHA inspected:** `d6dcd17f82f8a63af0ea50b085024b3450ccf94d`
**Scope:** Answer one question — can AWJ fork Spree Storefront, keep its UI/UX and commerce flows, and swap the backend for AWJ's Laravel ERP, avoiding a from-scratch storefront build?

---

## Executive Summary

Spree Storefront is a well-built, MIT-licensed, Next.js 16 / React 19 headless commerce UI with a genuinely broad feature set (catalog, cart, one-page checkout with Stripe/PayPal/Adyen, account/order history, a lightweight B2B "wholesale" channel, multi-region/multi-locale routing, SEO, analytics). Its data-access layer is already organized into per-domain Server Action modules (`src/lib/data/{products,cart,checkout,orders,payment,customer,addresses}.ts`) sitting behind a thin `src/lib/spree/` client wrapper — a real head start for building an AWJ adapter at that exact seam.

But three things are load-bearing and Spree-specific, not incidental: **(1)** the auth/session model (JWT + refresh-token cookies, Spree's exact error/status contract), **(2)** the checkout state machine and its three real payment-gateway integrations (Stripe/PayPal/Adyen "payment sessions," Spree's `current_step` machine baked into JSX), and **(3)** the Spree webhook contract driving transactional email. These are D-class ("deeply coupled") by the SDK-coupling analysis below, and they are exactly the riskiest, highest-value parts of a storefront — checkout and payment.

Separately, and more decisive for the final recommendation: **AWJ is not starting from zero and is not free to bolt a Spree-shaped storefront onto its domain model.** AWJ already has an actively developed, partially implemented internal "Commerce" bounded context (`docs/plans/store/`, 31 planning documents plus merged code: `CommerceOrder`, `InventoryReservation`, `CustomerIdentity`, `ADR-01..05`) that deliberately rejects several assumptions Spree's storefront hard-codes: no product variants yet (explicitly deferred, ADR-approved), a `CommerceOrder != Invoice` boundary that is the opposite of the "cart→order→complete" implicit assumption in the Spree checkout state machine, no payment gateway today (manual/offline `PaymentMethod` only), no shipping/logistics model, and no anonymous public catalog API. Spree's checkout page assumes a backend where `Cart.current_step` drives everything; AWJ's own architecture ADRs (already approved) assume a slower, more deliberate Order→Reservation→Payment Intent→Fulfillment→Invoice pipeline with several steps AWJ has explicitly not built yet. Retrofitting Spree's checkout onto that pipeline is not an adapter problem, it is a rebuild of the checkout component tree against a materially different state model.

**Recommendation: GO WITH CONDITIONS** — reuse Spree Storefront for the catalog/browsing/account surface (genuinely high UI reuse, 60–75%), but do **not** attempt to reuse its checkout/payment/webhook subsystem; that portion should be built fresh against AWJ's already-approved Commerce ADRs. Full detail and reasoning below.

---

## 1. Spree Storefront — Architecture Findings

Stack (from `package.json`, `tsconfig.json`, `next.config.ts`):

| Layer | Version / choice |
|---|---|
| Next.js | `^16`, App Router only, Turbopack dev, `cacheComponents: true` |
| React | `^19`, React Compiler enabled (`babel-plugin-react-compiler`) |
| TypeScript | `^5`, `strict: true` |
| Tailwind | `^4` (CSS-first config, no `tailwind.config.*` file) |
| Data client | `@spree/sdk ^1.2.1` (typed REST client for Spree Store API v3) |
| Payments | `@stripe/react-stripe-js`, `@paypal/react-paypal-js`, `@adyen/adyen-web` |
| i18n | `next-intl ^4.9.2` |
| Testing | `vitest ^4`, `@testing-library/react ^16`, `@playwright/test ^1.60` |
| Lint/format | Biome (not ESLint), `lefthook` git hooks |
| Errors/analytics | Sentry, Vercel Analytics/Speed Insights, GTM (`@next/third-parties`) |

**Routing.** `src/app/[country]/[locale]/` is the root of every localized route, split into three route groups: `(storefront)` (catalog, cart, account, policies — full header/footer layout), `(checkout)` (checkout/confirm-payment/order-placed — minimal layout), `(wholesale)` (a gated B2B portal). Category routing uses a Spree-taxonomy catch-all: `c/[...permalink]/page.tsx`. Locale/country resolution happens in `src/lib/spree/middleware.ts` (cookie → geo header → `Accept-Language` → default), invoked from a thin `src/proxy.ts` edge entrypoint.

**i18n.** `src/i18n/locales.ts` is the single locale registry (`MESSAGE_LOADERS`, lazy per-locale import). Ships **5 locales today: de, en, es, fr, pl — Arabic is not among them.** RTL-detection logic already exists (`RTL_LANGUAGES = new Set(["ar","fa","he","ur","yi"])`, `localeDirection()`) and is wired into `<html dir=...>`, but it is inert until an `ar` locale is registered. `scripts/check-locale-parity.ts` is a translation-completeness CI gate (diffs every locale's keys against `en.json`).

**Country/region/currency.** Built around **Spree Markets** — a market bundles country + currency + locale. `src/lib/data/markets.ts` fetches the Market list; `StoreContext` derives a flat country list with each country's market currency/locale attached. Currency is never independently stored; it's derived from the active Market for the URL's `[country]` segment. There is a second, unrelated multi-store-like concept — Spree **Channels** — used only to run a B2C ("dtc") and lightweight B2B ("wholesale") storefront against the *same* backend, distinguished by an `X-Spree-Channel` header and surface-scoped cart cookies.

**Authentication.** Custom JWT + refresh-token cookies, not NextAuth: `_spree_jwt` (httpOnly, 7-day), `_spree_refresh_token` (httpOnly, 30-day), plus surface-scoped guest-cart cookies (`_spree_cart_token[_id]`, 30-day). `isAuthenticated()` checks presence *and* non-expiry with a 30s clock-skew buffer. `withAuthRefresh` in `src/lib/spree/auth-helpers.ts` transparently retries on a 401 after silently refreshing — this whole mechanism is keyed to Spree's specific token/error contract.

**Data access architecture.** `src/lib/spree/` centralizes SDK client construction (`config.ts`, singleton per process, one more singleton for the wholesale channel), cookies, auth, and webhook verification. `src/lib/data/*.ts` (17 files, all `"use server"` Server Action modules — `products`, `categories`, `cart`, `checkout`, `orders`, `payment`, `customer`, `addresses`, `credit-cards`, `gift-cards`, `markets`, `policies`, `wholesale`, `sitemap`, `countries`, `express-checkout-flow`, `cookies`) is the entire mutation/read surface consumed by components — **there is no client-side fetch to the Spree API anywhere; every request goes browser → Server Action → `@spree/sdk` → Spree API**, with the API key never reaching the browser. 91 files under `src/` import `@spree/sdk`, but per the coupling analysis (§5) the *files* are cleanly separated even though the *types* (`Cart`, `Order`, `Variant`, `Fulfillment`, `Market`) are re-exported verbatim rather than mapped to app-owned types.

**API dependencies / env vars.** Single backend, single API surface: `SPREE_API_URL` + `SPREE_PUBLISHABLE_KEY` (server-only), REST (no GraphQL). Full var list includes wholesale channel keys, `NEXT_PUBLIC_DEFAULT_COUNTRY/LOCALE`, SEO/social defaults, `GTM_ID`, `SPREE_WEBHOOK_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM`, Stripe publishable key, Sentry config.

**Caching/revalidation.** Next 16 "Cache Components" (`"use cache: remote"` directives + `cacheLife`/`cacheTag`), with tag-based invalidation (`updateTag`) after every mutation. `sitemap.ts`/`robots.ts` are `force-dynamic`.

**SEO/metadata/images.** `generateMetadata` at nearly every route, JSON-LD (`Product`, breadcrumb, Organization) via a shared `JsonLd` component, chunked `generateSitemaps()` (10k URLs/file), a restrictive `robots.ts`, and `hreflang`/alternate-locale links (`src/lib/metadata/alternates.ts`). `next/image` used throughout with default loader; `remotePatterns` dynamically derived from `SPREE_IMAGES_URL`/`SPREE_API_URL` scoped to Rails Active Storage paths.

**Testing.** Vitest for unit/component tests (colocated, not centralized), Playwright for one real E2E golden path (`e2e/checkout.spec.ts`: browse → add to cart → guest checkout → Stripe test card → confirmation), run against **a real dockerized Spree 5.x backend** (`e2e-backend/docker-compose.yml`: Postgres + Redis + `ghcr.io/spree/spree` image), not a mock — confirming the storefront's backend dependency is a genuine Spree Rails app, not an abstraction.

**License.** MIT (copyright Vendo Connect Inc., Vendo Sp. z o.o. — the commercial entity behind Spree). Permissive: commercial/SaaS use, modification, and redistribution are all explicitly permitted; the only obligation is retaining the copyright/permission notice. No copyleft, no source-disclosure requirement, no patent clause. **No legal blocker identified** for forking and modifying for AWJ's commercial SaaS use; standard practice would still be to keep the LICENSE file and a NOTICE of origin in the fork.

---

## 2. Spree Storefront — Feature Inventory

Full detail with file-level evidence is in the research trace; summarized by domain and reuse classification (KEEP = pure UI, reusable as-is / ADAPT = UI reusable, data layer rewrite / REPLACE = Spree-specific concept needing new UI+data / REMOVE = not needed / NOT PRESENT = doesn't exist):

### Catalog
| Feature | Status | Classification |
|---|---|---|
| Categories/taxonomy, breadcrumbs | Implemented (Ransack-style facet params) | ADAPT |
| Product listing, filters, sort | Implemented — **infinite scroll**, not numbered pagination | ADAPT |
| Product detail page | Implemented | ADAPT |
| Variant/option picker | Implemented, real availability logic | KEEP (pure client state, but built on Spree's option-type/option-value model — see §5) |
| Product image gallery + lightbox/zoom | Implemented | KEEP |
| Search (typeahead, 300ms debounce) | Implemented | ADAPT |

### Pricing
| Feature | Status | Classification |
|---|---|---|
| Regular/sale price display | Implemented (pure display of API-computed fields) | KEEP |
| Currency formatting | Server pre-formats `display_amount` strings | ADAPT |
| Customer/region-specific pricing | Implemented via Spree Markets + wholesale "hidden pricing" gate | REPLACE |

### Cart
| Feature | Status | Classification |
|---|---|---|
| Add/remove/update qty | Implemented, real server actions | ADAPT |
| Cart persistence | Cookie-based, surface-scoped, cross-surface poisoning guards | REPLACE |
| Cart drawer + cart page | Both implemented | KEEP |
| Totals | 100% API-computed, no client math | ADAPT |
| Coupon/gift-card single-box resolution | Implemented (dual-purpose input) | REPLACE |

### Checkout
| Feature | Status | Classification |
|---|---|---|
| Guest + authenticated checkout | Both implemented | ADAPT |
| Address forms, saved-address selector | Implemented | ADAPT |
| Shipping/delivery-rate selection, multi-shipment | Implemented (real N-shipment support) | ADAPT/REPLACE (shipment-splitting model is Spree-specific) |
| Payment (Stripe + PayPal + Adyen, offline/direct methods) | Implemented, real gateway sessions | REPLACE |
| Discounts/coupons at checkout | Implemented, same code path as cart | REPLACE |
| Tax display | Pass-through display of API field only | ADAPT |
| Order confirmation page | Implemented | KEEP |
| Express checkout (Apple/Google Pay via Stripe) | Implemented | REPLACE |

### Customer
| Feature | Status | Classification |
|---|---|---|
| Registration/login/logout, password reset | Implemented, JWT+refresh | ADAPT |
| Profile | Implemented | ADAPT |
| Address book CRUD | Implemented | ADAPT |
| Order history + detail | Implemented, rich (per-shipment tracking, multi-payment) | KEEP (UI) / ADAPT (data) |

### Additional
| Feature | Status | Classification |
|---|---|---|
| Wishlist | **NOT PRESENT** (zero references anywhere) | NOT PRESENT |
| Gift cards | View/redeem only, no purchase flow | ADAPT |
| Store credit | Folded into gift cards, no dedicated feature | NOT PRESENT |
| Saved payment methods | List/delete only, tied to gateway tokenization | REPLACE |
| Multi-shipment | Implemented (genuine N-fulfillment) | ADAPT |
| B2B / wholesale | Lightweight channel + customer metadata + price-hiding; **not** true company hierarchy/quotes/net-terms | REPLACE |
| Analytics (GTM/GA4 ecommerce events) | Comprehensive, backend-agnostic | KEEP |

---

## 3. AWJ ERP — Capability Inventory

(Full evidence trail — model fields, migrations, ADRs — in the research trace; summarized here.)

| Domain | AWJ status | Evidence |
|---|---|---|
| Tenants | Full multi-tenant core | `Tenant`, `TenantContext`, `TenantScope`, `TenantReferenceNumberService` |
| Branches/warehouses | Full, with explicit `BranchScoped`/`BelongsToBranch`/`CompanyWide` classification enforced by CI | `Branch`, `Warehouse`, `ProductWarehouseStock` |
| Products | Partial — **no variants** (explicitly out of scope for V1, ADR-confirmed); UOM, images, categories, manual SKU all exist | `Product`, `UnitTemplate`, `ProductMedia`, `ProductCategory`, `ProductBarcode` |
| Pricing | Partial — one shared, staff-selected `PriceList`/`PriceListItem`, no automatic customer/region rules, **SAR-only, no multi-currency** | `PriceList`, `Tenant.currency` default `SAR`, no currency column on `Invoice`/`Product` |
| Inventory | Full avg-cost engine + `StockMovement`, **plus a new, Commerce-specific `InventoryReservation`** (Available-to-Sell concept, ADR-02) | `InventoryService`, `InventoryReservation` |
| Customers | Partial — **no address book** (single address field on `Partner`); a genuinely separate guest/registered identity system already built (`CustomerIdentity`, `CustomerPartnerLink`, Sanctum-based, tenant-scoped) | `Partner`, `CustomerIdentity`, ADR-05 |
| Sales documents | `Invoice`/`Quote` mature; **new `CommerceOrder` exists and is deliberately accounting-inert** (`CommerceOrder != Invoice`, ADR-01) — **no Order→Invoice conversion service exists yet** | `Invoice`, `Quote`, `CommerceOrder`, ADR-01 |
| Payments | Manual/offline only (`PaymentMethod`: bank/cash/cheque/card, tenant-seeded) — **no payment gateway integration exists**; `available_online` flag defined but unused; a `PaymentIntent`/capture/refund model is designed (ADR-04) but **not coded** | `PaymentMethod`, `Payment`, ADR-04 |
| Tax/VAT/ZATCA | Full Phase 1 (QR/TLV); Phase 2 partial (UUID/ICV/hash chain/UBL structure, **not signed/submitted**) | `ZatcaService`, `ZatcaIcvScope` |
| Shipping/delivery | **Does not exist** — no `Shipment`/carrier/tracking model; `DeliveryNote` is a warehouse goods-issue document, not a customer-shipment concept; fleet/fuel models are for the fuel vertical, unrelated | grep across `app/Models` |
| Permissions/RBAC | Full staff RBAC (`Rbac::MATRIX`, tenant-configurable roles); **a genuinely separate customer-principal track already exists**, distinct from staff roles | `EnsureCustomerPrincipal`, `EstablishCustomerContext` |
| Application entitlements | `commerce.storefront` key **already reserved** in `ApplicationCatalog`, maturity = `coming_soon` (not activatable by design) | `ApplicationCatalog::CATALOG['commerce.storefront']` |
| Public API surface | Two authenticated tracks only (M2M API-key `api/v1/*`, customer-identity `customer/v1/{tenant}/auth/*`) — **no anonymous public catalog-browsing route exists anywhere** | `routes/api_public.php`, `routes/api.php` |
| Existing e-commerce planning | **Extensive and active**: 31 documents in `docs/plans/store/` plus 5 approved ADRs and a merged, incremental PR trail (PR-COM-0 through PR-COM-6B) already implementing pieces of this | `AWJ_STORE_MASTER_PLAN.md`, `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`, ADR-01..05 |

**This is the single most important fact for the recommendation:** AWJ is not evaluating Spree against a blank ERP. It already has an approved, non-negotiable architecture (`AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md §3`) stating `CommerceOrder != Invoice`, `Reservation != StockMovement`, `PaymentIntent != provider attempt != AWJ Payment`, and "Product Variants are not a prerequisite for the first Commerce vertical slice." Spree's storefront checkout is built the opposite way: a single `Cart`/`Order` object whose `current_step` field (`address → delivery → payment → confirm → complete`) is the checkout's entire state machine, backed by a Spree Rails app that creates and captures payment sessions synchronously inside that one step sequence. Grafting that UI onto AWJ's deliberately staged, ADR-gated pipeline is a checkout rebuild, not a data-layer swap.

---

## 4. Compatibility Matrix

Compatibility values: **DIRECT** (concepts line up 1:1) / **ADAPTER** (maps cleanly through a translation layer) / **PARTIAL** (partial semantic overlap, real gaps) / **MISSING** (AWJ has nothing) / **SEMANTIC CONFLICT** (both exist but mean different things — dangerous to paper over).

| Domain | Spree expects | AWJ currently provides | Compatibility | Action |
|---|---|---|---|---|
| Product | Product + description + taxons + images | `Product` + `ProductCategory`/`ProductMedia` | ADAPTER | ADAPT |
| Product Variant | First-class option-type/option-value/variant graph, purchasability per combination | **No variant model** | MISSING | BUILD (blocked on AWJ's own variant-model decision, explicitly open per master plan §10.4) |
| Category | Taxon tree, catch-all permalink routing | `ProductCategory` | ADAPTER | ADAPT |
| Product Image | Multiple images per product/variant | `ProductMedia` | ADAPTER | ADAPT |
| Price | Single resolved price + compare-at, per Market/customer | `PriceList`/`PriceListItem`, staff-selected per invoice, no auto-resolution | PARTIAL | BUILD (a resolution rule engine AWJ doesn't have) |
| Price List | Market/channel-scoped, auto-applied | `PriceList` exists but manually chosen, not tied to any channel/customer rule | SEMANTIC CONFLICT | ADAPT with new resolution logic |
| Currency | Per-Market currency, multi-currency | SAR-only, no currency column on money models | MISSING (for multi-currency; fine if SAR-only is acceptable for V1) | BLOCKED if multi-currency required; KEEP scope to SAR for V1 |
| Inventory | Real-time availability, reservation on cart-add | Avg-cost `Product.quantity_on_hand` + **new** `InventoryReservation` (ATS, ADR-02) | ADAPTER (once ADR-02 wired to a real checkout) | ADAPT — the AWJ primitive exists but is not yet called from any commerce/checkout path |
| Warehouse | Order fulfilled from resolved warehouse | `Warehouse`, `ProductWarehouseStock`; fulfillment-warehouse resolution designed in ADR-03, **not implemented** | PARTIAL | BUILD |
| Customer | Single customer record w/ multiple addresses | `Partner` (single address) + separate `CustomerIdentity`/`CustomerPartnerLink` | SEMANTIC CONFLICT (two AWJ identities — staff `Partner` vs. new `CustomerIdentity` — must not be conflated with Spree's single `Customer`) | ADAPT — map Spree `Customer` to `CustomerIdentity`, not `Partner` |
| Customer Address | Address book, multiple, default flags | **None** — `Partner` has one address field; no address-book model | MISSING | BUILD |
| Cart | Server-side cart with line items, totals | **No cart model exists** | MISSING | BUILD |
| Cart Line | Line item + variant + qty + computed price | N/A | MISSING | BUILD |
| Coupon | Discount code applied to cart/order | No promotion/coupon engine found in audit | MISSING | BUILD or explicitly OUT OF SCOPE for V1 |
| Promotion | Rules-based automatic discounts | Not found | MISSING | OUT OF SCOPE for V1 (per master plan, explicitly deferred: "generic promotions rules engine" excluded from first slice) |
| Tax | Computed per line, VAT-aware | `InvoiceLine.tax_rate`/`line_tax`, ZATCA-grade rounding — but only on `Invoice`, not on any pre-invoice cart/order object | PARTIAL | ADAPT — tax must be computed before Invoice exists, which is new logic |
| Shipping Method | Rate table per fulfillment | **Does not exist** | MISSING | BUILD (or BLOCKED until AWJ decides V1 shipping scope, per master plan §10.8) |
| Shipment | Per-shipment tracking/status, N per order | `DeliveryNote` is a warehouse goods-issue doc, not a customer/carrier shipment | SEMANTIC CONFLICT | BUILD — do not repurpose `DeliveryNote` |
| Payment Method | Config linking to a gateway | `PaymentMethod` (`CompanyWide`), manual/offline only | PARTIAL | BUILD (gateway integration is entirely new; `available_online` flag is a placeholder, not an integration) |
| Payment | Captured payment against order | `Payment`/`PaymentAllocation`, posted via `LedgerService` — accounting-grade, tied to `Invoice`/`Purchase`, not designed for pre-invoice online capture | SEMANTIC CONFLICT | ADAPT via ADR-04's `PaymentIntent` layer, which is designed but not built |
| Order | Cart-derived order w/ payment/fulfillment status, drives invoice | `CommerceOrder`/`CommerceOrderLine` — **exists, is deliberately accounting/inventory-inert** (ADR-01) | ADAPTER (concept exists; conversion to Invoice does not) | ADAPT/BUILD — biggest remaining engineering gap |
| Order Line | Line item snapshot | `CommerceOrderLine` | ADAPTER | ADAPT |
| Invoice | Not a first-class Spree concept (order = the sales doc) | `Invoice`/`InvoiceLine`, ZATCA-integrated, immutable post-posting | SEMANTIC CONFLICT | BUILD the Order→Invoice conversion service; must respect AWJ's stricter accounting rules, not Spree's |
| Refund | Provider-side capture reversal | Not found; ADR/`PaymentIntent` capture/refund model designed, not coded | MISSING | BUILD |
| Wishlist | N/A in Spree either | N/A | N/A (Spree doesn't have it) | REMOVE / not in scope |
| Gift Card | Balance + redemption at checkout | Not found in AWJ | MISSING | OUT OF SCOPE for V1 |
| Store Credit | Folded into gift cards in Spree; N/A in AWJ | Not found in AWJ | MISSING | OUT OF SCOPE for V1 |

**Strict read:** of 23 matrix rows, **7 are DIRECT-or-ADAPTER-ready today** (Product, Category, Product Image, Order/Order Line as concepts, Payment Method as a config shell), **5 are outright MISSING with no AWJ equivalent** (Variant, Address book, Cart/Cart Line, Shipping Method/Shipment, Coupon/Promotion/Gift Card/Store Credit), and **4 are SEMANTIC CONFLICTS** where a superficially similar AWJ model (`Partner`, `DeliveryNote`, `PaymentAllocation`, `PriceList`) means something meaningfully different and must not be reused as-is. This is the evidence behind rejecting any framing of AWJ inventory/customer/payment as "basically compatible."

---

## 5. Spree SDK Dependency / Decoupling Analysis

91 files import `@spree/sdk`. The `src/lib/spree/` (client/auth/cookies/webhooks) + `src/lib/data/*` (per-domain Server Actions) split is a real, usable seam — a `src/lib/commerce/{products,customers,cart,checkout,orders,payments}.ts` adapter layer is achievable at that boundary. But the abstraction today is a **thin pass-through**, not a real adapter: it re-exports SDK types (`Cart`, `Order`, `Variant`, `Fulfillment`, `Market`) as the app's vocabulary rather than mapping them to independent domain types. A genuine AWJ adapter still needs to introduce its own types, not just relocate the SDK's.

**A — Easy to replace:** `lib/data/{products,categories,sitemap,policies}.ts`, SEO/metadata helpers, analytics event builders. Pure `client.x.list()/get()` wrappers behind cache tags.

**B — Requires adapter, no UI change once mapped:** `lib/data/{cart,orders,addresses,customer,credit-cards,gift-cards,markets,wholesale}.ts`, `CartContext`/`StoreContext`, most product/listing/filter components, address CRUD UI. Concepts map cleanly to AWJ's domain; only shapes need translation.

**C — Requires component modification, not just data mapping:** `VariantPicker.tsx` (Spree's option-type/option-value model is baked into render logic, not just types — see §4, AWJ has no variant model to map to at all), `LineItemCard.tsx` (consumes pre-formatted Spree fields like `display_price`/`options_text`), `FulfillmentBlock.tsx`/`DeliveryMethodSection.tsx` (Spree's N-shipment splitting model), `CouponCode.tsx` (dual discount/gift-card resolution UX), category catch-all routing (`c/[...permalink]`).

**D — Deeply coupled / expensive to replace:** `lib/spree/auth-helpers.ts` (JWT refresh-rotation state machine keyed to Spree's exact error/status contract), `lib/spree/config.ts` (SDK client factory), `lib/spree/webhooks.ts` + `lib/webhooks/handlers.ts` (HMAC contract on Spree's exact header/payload shapes), `lib/data/checkout.ts` (surface/channel verification, cross-surface cart-poisoning guards, error-code-specific discount/gift-card fallback), `lib/data/payment.ts` and the entire checkout page tree (`CheckoutPageContent.tsx`, `CheckoutSidebar.tsx`, `PaymentSection.tsx`) — built around Spree's `current_step` state machine and three real gateway integrations (Stripe/PayPal/Adyen payment-session lifecycle), plus `lib/utils/express-checkout.ts` (Stripe Express Checkout Element wired directly to Spree's cart/fulfillment shape).

**Bottom line:** catalog/account/address code is B/C-class and mechanical. Auth, checkout state, payment, and webhooks are D-class and represent the bulk of real migration cost and risk — and they are exactly the parts AWJ's own architecture (ADR-01, ADR-04) has deliberately not finalized yet (invoice-trigger point, payment intent model).

---

## 6. Checkout Risk Analysis

Spree's traced flow: `Product → Cart (server-side, cookie-tracked) → Address → Delivery/Shipping rate → Payment (session-based gateway) → Cart.complete() → Order → Confirmation`, entirely gated by `Cart.current_step`.

Mapped against AWJ's own approved lifecycle (`AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md §3`):
`Cart → Checkout → CommerceOrder → Inventory Reservation → Payment Intent/mode → Fulfillment → Invoice (when the approved trigger says so) → existing AWJ accounting/ZATCA path.`

| Concern | Spree storefront behavior | AWJ current state | Risk |
|---|---|---|---|
| Idempotency | Assumed by Spree's Cart/Order API; not the storefront's job | AWJ's master plan lists idempotency as a release gate, not yet implemented for checkout | Must be built new, cannot inherit Spree's guarantee since AWJ's backend differs |
| Concurrent stock changes | Spree backend handles atomically; storefront just calls the API | ADR-02 `InventoryReservation` designed for exactly this (`ATS = On Hand - Active Reserved`), but not yet wired to any cart/checkout code path | Real gap — reservation model exists in isolation, unconnected |
| Stock reservation | Reservation happens on cart-add server-side | `InventoryReservation` model exists (ADR-02) but no service calls it from a commerce flow yet | Same as above |
| Pricing authority | Spree API is sole price authority; storefront never computes | AWJ has no automatic price-resolution rule (PriceList is staff-selected, not rule-driven) — master plan §10.5 lists this as unresolved | Blocks reuse of Spree's "trust the API's price" assumption until AWJ builds resolution logic |
| Discount authority | Spree API applies/validates codes | No coupon/promotion engine in AWJ at all | Out of scope for V1 per master plan |
| VAT calculation | Computed by Spree backend per line | AWJ's ZATCA-grade tax logic exists only on `Invoice`, not on any pre-invoice object | New logic needed before checkout can show accurate tax pre-invoice |
| Payment state | Spree's payment-session lifecycle (create/update/complete, gateway-specific) | AWJ has no payment gateway integration; ADR-04 designs a `PaymentIntent != provider attempt != AWJ Payment` model but it is **not implemented** | Full rebuild, cannot reuse Spree's gateway code at all |
| Failed payment / retry | Handled via Spree's session status + storefront branching | Not designed yet in AWJ beyond the ADR | New logic |
| Order creation | Spree creates `Order` from `Cart` on completion | `CommerceOrder` already exists and is explicitly accounting/inventory-inert on creation (ADR-01) | Matches AWJ's intended model well — but Spree's storefront assumes order creation *is* the checkout's terminal, payment-bearing step, which conflicts with AWJ's "no accounting effect at create or confirm" rule |
| Invoice creation | N/A in Spree (order is the sales doc) | Must be built: **no Order→Invoice conversion service exists** | Single biggest missing piece; the invoice-trigger point itself is an explicit open question (master plan §10.1) |
| Cancellation | Spree order-state transition | `CommerceOrder.status: draft/confirmed` only; no cancellation flow found | BUILD |
| Refund | Provider-side capture reversal | Not implemented; ADR-04 designs it | BUILD |
| Partial fulfillment | Spree's N-fulfillment model | ADR-03 designs channel/warehouse/fulfillment-location separation; not implemented end-to-end | BUILD |

**Conclusion: checkout is confirmed as the highest-risk area**, exactly as anticipated. It is not just "swap the API calls" — Spree's checkout component tree assumes a synchronous, single-object (`Cart`/`Order`) state machine with immediate gateway payment capture, while AWJ's own approved architecture insists on a staged, reservation-then-payment-intent-then-fulfillment-then-invoice pipeline with several stages not yet built. Recommend building AWJ's checkout UI fresh, informed by Spree's UX patterns (one-page layout, address/delivery/payment section sequencing, order summary sidebar) but not its code.

---

## 7. Multi-Tenant Architecture

Spree Storefront has **no multi-tenant or multi-store mechanism today.** `src/proxy.ts`/`src/lib/spree/middleware.ts` resolve country+locale only, never a tenant/store from the host. `src/lib/spree/config.ts` builds one process-wide singleton API client from a single `SPREE_API_URL` env var (a second singleton exists only for the wholesale *channel*, still against the same backend/store). "Store name" (`src/lib/store.ts`) is a handful of env vars read once at boot, not a per-request/per-domain resolution. There is no theming-per-store layer.

For AWJ (SaaS, per-tenant), this means multi-tenancy must be designed and built from scratch on top of the fork, not adapted from an existing Spree pattern. Requirements to design (per the audit's own §7 checklist, none of which exist today in Spree or AWJ's storefront layer):

- **Domain→tenant resolution**: `store{tenant}.awj.*` subdomain or custom-domain lookup at the edge (would replace/extend `src/proxy.ts`), resolving to a tenant id *before* any API call — this must happen server-side/edge-side and never trust a client-supplied tenant header, to avoid the obvious cross-tenant data leak (a compromised or misconfigured storefront instance requesting another tenant's catalog/cart/order data by header manipulation).
- **Per-tenant client factory** replacing `config.ts`'s single process-wide singleton — base URL/credentials keyed by the resolved tenant, not a build-time env var.
- **Tenant isolation enforcement at every layer the storefront touches**: session cookies must be tenant-scoped (today Spree's cookies are not partitioned by anything but "surface"); cart/order/customer lookups must always pass through the resolved tenant, mirroring AWJ's existing `BaseModel`/`TenantScope` discipline on the backend side.
- **Per-tenant storefront configuration**: theme/branding, enabled currency/locale set, enabled payment methods, enabled shipping methods, default price list, inventory source (warehouse) — none of this exists as a "per-store config" concept in Spree; it would need a new settings surface, analogous to AWJ's existing `Settings`/`BranchSettings` pattern (per CLAUDE.md's "policy is configured, not enforced" principle) extended to a new `StorefrontSettings`.
- **Explicit security risk to flag**: any shared Next.js deployment serving multiple tenants' storefronts must never resolve tenant from anything the browser can influence directly (e.g., a query param or an unsigned cookie) without server-side validation against the resolved host — this is the same class of risk AWJ's backend already guards against via `TenantScope`, and the storefront layer must inherit that discipline, not reinvent a weaker version of it.

---

## 8. Arabic / RTL Audit

The scaffolding is unexpectedly close to ready, but not turned on:

- `src/i18n/locales.ts` already defines RTL-language detection (`ar` included) and `localeDirection()` is already wired into `<html dir=...>` in `DocumentShell.tsx`. **This works today for Arabic if an `ar` locale were registered** — it currently is not (`messages/` has only `de/en/es/fr/pl.json`; `MESSAGE_LOADERS`/`SUPPORTED_LOCALES` don't include `ar`).
- Hardcoded LTR assumptions exist but are **small and mechanically fixable**: ~20 occurrences across 11 files of physical Tailwind utilities (`ml-`/`mr-`/`left-`/`right-`) instead of logical properties (`ms-`/`me-`/`start-`/`end-`) — concentrated in `CartDrawer.tsx`, `PaymentSection.tsx`, `VariantPicker.tsx`, `AddressManagement.tsx`, `ProductCard.tsx`, and several generic `ui/` primitives (`button.tsx`, `dropdown-menu.tsx`, `badge.tsx`, etc.). Zero use of `ms-/me-/ps-/pe-` anywhere today, confirming the convention was never adopted, not that it was tried and abandoned.
- No RTL-aware libraries in dependencies (no `stylis-plugin-rtl`, `tailwindcss-rtl`); Tailwind v4's CSS-first config means many defaults are already logical-property-based, so the gap is specifically the ~20 explicit physical-class overrides, plus a full-repo pass for directional icons (none found in sampled files, but not exhaustively checked) before ship.
- Currency/price strings are pre-formatted by the backend (`display_price` etc.) — RTL-correct symbol placement depends entirely on what AWJ's backend emits, not on storefront logic.
- **Conclusion:** genuinely low-effort to make Arabic-first: add `ar.json` + register the locale (the harder localization work is translating ~5 locale files' worth of UI strings, not code), fix ~20 Tailwind classes, and verify icon mirroring. This is a strong point in Spree's favor and does not itself justify redesigning the UI.

---

## 9. Visual Independence

Commerce logic and visual presentation are reasonably separated for the catalog/browsing/account surfaces: components like `ProductCard`, `MediaGallery`, `VariantPicker`, `CartDrawer` consume typed props/context and render via Tailwind utility classes and shadcn-style primitives, with no business logic embedded in styling. A later visual redesign (header, nav, product cards/grids, cart drawer, account UI, mobile) is practical for these surfaces without touching the underlying data flow, **provided the adapter work in §5 has already normalized the data shape** — redesigning while still consuming raw `@spree/sdk` types would re-couple presentation to Spree's field names.

The checkout surface is the exception: `PaymentSection.tsx` (1000+ lines) mixes gateway SDK mounting (Stripe Elements, Adyen Drop-in, PayPal buttons), step-sequencing logic, and presentation together tightly enough that a visual redesign there is effectively a rewrite regardless — consistent with the recommendation in §6 to rebuild checkout rather than adapt it.

---

## 10. License Audit

Spree Storefront (`spree/storefront`, commit `2ad6ad5b`) is **MIT licensed**, copyright Vendo Connect Inc. / Vendo Sp. z o.o. Permissive: use, copy, modify, merge, publish, distribute, sublicense, and sell are all explicitly granted; commercial SaaS use is permitted without royalty. The only obligation is retaining the copyright and permission notice in copies/substantial portions of the software. No copyleft, no mandatory source disclosure, no patent grant/claim, standard "as is" disclaimer of warranty and liability.

**No legal blocker identified.** Recommended practice (not a legal requirement beyond the license text, but good hygiene): keep the original `LICENSE` file in the fork, add a `NOTICE`/README line crediting Spree/Vendo Connect as the origin of the storefront codebase, and confirm the same MIT terms apply to any dependency the fork continues to use (`@spree/sdk` itself would be dropped per this plan, removing that specific dependency's license from consideration once the adapter fully replaces it). Flag for legal/compliance sign-off before shipping only if AWJ's own SaaS terms or a customer contract has stricter open-source-attribution requirements than MIT itself demands — nothing found in this audit requires that scrutiny on Spree's side.

---

## 11. Testing Strategy

| Test type | Spree today | Recommendation |
|---|---|---|
| Unit tests (Vitest, colocated) | Solid coverage for pure logic — locale/routing helpers, metadata/alternates, SDK-agnostic utils | **KEEP** the ones testing pure logic untouched by the backend swap (i18n, SEO/metadata builders, formatting utils); **REPLACE** any test asserting against `@spree/sdk` response shapes once the adapter changes those shapes |
| Component tests (Testing Library via Vitest) | Present for key pages (`ProductDetails.test.tsx`, `layout.test.tsx`, `policies/[slug]/page.test.tsx`) | **ADAPT** — most assert on rendered UI text/structure, which survives a backend swap if props are mapped correctly; will need prop/mock updates wherever they construct SDK-typed fixtures |
| `src/lib/spree/__tests__/*` (auth-helpers, middleware) | Tests Spree's exact JWT/error contract | **REPLACE** entirely — this is D-class coupling (§5); the whole auth model is being rebuilt |
| Playwright E2E (`e2e/checkout.spec.ts`) | One golden-path guest checkout against a real dockerized Spree backend (`e2e-backend/`) | **REPLACE** — the flow itself (UI navigation, form-filling) is a reasonable behavioral spec to imitate, but the assertions and the backend-in-docker fixture are entirely Spree-specific; a new equivalent E2E test should be written against AWJ's checkout once built, reusing the *test structure* (page-object style navigation) but none of the fixture/backend setup |
| Locale-parity script (`check-locale-parity.ts`) | CI gate diffing all locales against `en.json` | **KEEP** as-is — genuinely backend-agnostic, valuable to run once `ar.json` is added |

**Recommended migration test strategy**: keep pure-logic and UI-structure tests where the backend swap doesn't touch them; treat every test that constructs or asserts on `@spree/sdk`-shaped fixtures as needing a rewrite in lockstep with the adapter/component it tests (not a batch "fix later" pile); write the new checkout E2E test early (even before the real payment gateway is wired) using a stubbed/mocked backend so it stays green through the checkout rebuild and catches regressions incrementally, mirroring the "each module runnable/testable before the next" principle already in AWJ's CLAUDE.md.

---

## 12. Migration Strategy (proposed, not authorized by this document)

Consistent with AWJ's existing "small, independently reviewable PRs, no autonomous mode on financial code" practice, and gated by AWJ's own unresolved Commerce questions (master plan §10) rather than by Spree's structure:

- **Phase 0 — Fork + baseline.** Fork Spree Storefront, strip payment-gateway/webhook/wholesale code paths not being kept, keep `LICENSE`/attribution, get it building and running standalone with no real backend (mocked data) as a baseline.
- **Phase 1 — AWJ commerce adapter skeleton.** Introduce `src/lib/commerce/{products,customers,cart,checkout,orders,payments}.ts` with AWJ-owned types (not re-exported SDK types); wire the A/B-class files from §5 through it first (catalog, categories, product detail) against whatever read-only product API AWJ builds.
- **Phase 2 — Catalog.** Full product listing/search/detail against real AWJ product/category data; this is the highest-confidence, lowest-risk phase and validates the adapter pattern.
- **Phase 3 — Customer authentication.** Replace Spree's JWT/cookie model with one built on AWJ's already-existing `CustomerIdentity`/Sanctum track (§3) — this is new work, not a Spree port, but has a real foundation on the AWJ side already.
- **Phase 4 — Cart.** Build AWJ's cart/cart-line model from scratch (§4: MISSING); reuse Spree's cart-drawer/cart-page UI shell only after the adapter maps to it.
- **Phase 5 — Checkout (build, not adapt).** Per §6, this should be built against AWJ's approved Order→Reservation→Payment Intent→Fulfillment→Invoice pipeline, using Spree's UX patterns as reference only. This phase should not start until AWJ has resolved master plan §10's open questions (invoice-trigger point, reservation timing, COD-vs-gateway, RBAC for storefront/order management).
- **Phase 6 — Orders/payments.** Build the Order→Invoice conversion service (missing today) and at least one real payment mode (COD as the pragmatic V1 starting point, consistent with the master plan's own suggestion), gated by ADR-04's `PaymentIntent` model.
- **Phase 7 — Arabic/RTL.** Low-effort per §8: add `ar.json`, register the locale, fix the ~20 physical-direction classes, verify icon mirroring.
- **Phase 8 — AWJ Store Design System.** Visual redesign of catalog/account surfaces (§9) once data layer is stable; checkout was already rebuilt in Phase 5, so no separate "redesign checkout" phase is needed.
- **Phase 9 — Multi-tenant/custom domains.** Per §7: edge tenant resolution, per-tenant client factory, per-tenant config/theming, security review of tenant-isolation at the storefront layer.

Each phase should land as its own reviewable PR, matching AWJ's standing engineering principle of no big-bang merges on financially adjacent code.

---

## 13. Reuse Estimates

| Layer | Estimate | Basis |
|---|---|---|
| Storefront UI (catalog/browsing/account) | **60–75%** | Product grid/detail/gallery/variant-picker, cart drawer/page shell, order-history/detail layout, account pages are all genuinely reusable with prop/type mapping; checkout UI is excluded from this range (see below) |
| Storefront UI (checkout) | **10–20%** | Only the visual layout/section-sequencing pattern is reusable as reference; the state machine, gateway integrations, and most of `PaymentSection.tsx` need rebuilding per §6/§9 |
| Commerce flow logic (data layer / server actions) | **30–40%** | The A/B-class files (§5) — catalog, categories, addresses, order display — port with moderate adapter work; C/D-class files (checkout, payment, auth, webhooks) are largely new code |
| Tests | **20–30%** | Locale/SEO/utility unit tests and UI-structure component tests survive; auth/checkout/E2E tests need full rewrites |

These are ranges, not point estimates, because the actual percentage depends heavily on decisions AWJ has not yet made (variant model, invoice-trigger point, payment mode for V1) — each of those decisions moves checkout/order reuse in a way that can't be pinned down until they're resolved.

---

## 14. Final Decision

### GO WITH CONDITIONS

**1. Should AWJ fork Spree Storefront?**
Yes, for the catalog/browsing/account surface. No, do not attempt to reuse its checkout/payment/webhook subsystem as-is — that should be built fresh against AWJ's own already-approved Commerce ADRs, using Spree's checkout only as UX reference.

**2. Is this materially faster than building AWJ Store from scratch?**
Yes, for the ~60–75% of the app that is catalog/account/UI shell — that is genuine, substantial time saved (product grid, PDP, gallery, variant-picker UI shape, order history, account pages, i18n/SEO/analytics scaffolding, and a head start on RTL). No, for checkout — building it correctly against AWJ's staged Order→Reservation→PaymentIntent→Invoice pipeline is comparable effort whether or not Spree's checkout exists, because so little of Spree's checkout code survives the semantic conflicts in §4/§6.

**3. Three biggest integration risks:**
- **Checkout state-machine mismatch**: Spree's single-object `current_step` machine assumes synchronous gateway payment capture; AWJ's approved architecture is a slower, staged pipeline with reservation and payment-intent as distinct steps not yet built. Retrofitting is a rebuild, not an adapter.
- **Missing AWJ primitives that are prerequisites, not nice-to-haves**: no cart model, no customer address book, no payment gateway, no shipping/shipment model, no Order→Invoice conversion service. Every one of these blocks a real checkout regardless of storefront choice.
- **Unresolved AWJ architecture decisions** (master plan §10: invoice-trigger point, reservation timing, COD vs. gateway, variant model, RBAC for order management) — starting checkout implementation before these are settled risks building against assumptions that get overturned.

**4. What AWJ capabilities are missing before checkout can be production-safe?**
Cart/cart-line model, customer address book, at least one real payment mode (gateway or COD) with capture/refund semantics, the Order→Invoice conversion service with an approved trigger point, inventory reservation actually wired into a checkout flow (the model exists, the wiring doesn't), and a decision on shipping scope for V1.

**5. What percentage/range of Spree can realistically be retained?**
Storefront UI 60–75% (excluding checkout); checkout UI 10–20%; data/commerce-flow layer 30–40%; tests 20–30%. See §13 for basis.

**6. Should Spree's backend be used at all, or should AWJ remain the sole backend?**
AWJ remains the sole backend — this was never in question per the brief, and nothing in this audit suggests otherwise. Spree Commerce (Rails) itself should not be introduced anywhere in the stack; only the Next.js storefront is being forked, and even `@spree/sdk` should be fully removed as the adapter layer matures (§5), not kept as a compatibility shim.

**7. What should the FIRST implementation PR contain?**
A read-only catalog slice only: fork the storefront, strip payment/webhook/wholesale code not being kept, introduce the `src/lib/commerce/products.ts` + `categories.ts` adapter (A-class per §5) against a new AWJ read-only public product/category API (itself a new, minimal PR on the AWJ backend side — an anonymous-safe catalog endpoint does not exist today per §3.13), and get the product listing + PDP rendering against real AWJ data with no cart, no checkout, no auth. This validates the adapter pattern and the riskiest unknown (does AWJ's product/category shape map cleanly to Spree's UI) before any money-touching code is written.

---

## Appendix — Sources

- Spree Storefront: shallow clone of `https://github.com/spree/storefront`, HEAD `2ad6ad5bd1bcc055467064bd57cf20ab5f711c88`.
- AWJ: `/home/user/Nebrax` at `d6dcd17f82f8a63af0ea50b085024b3450ccf94d`, cross-referenced against the existing internal planning corpus at `docs/plans/store/` (`AWJ_STORE_MASTER_PLAN.md`, `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`, `ADR-01` through `ADR-05`, `PR-COM-0` through `PR-COM-6B` implementation reports) and `docs/plans/customers/`.
