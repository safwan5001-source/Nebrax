# H6 Batch C — Runtime Dependency Audit & Safe Migration

Storefront only. One PR = (1) a complete inventory of remaining Spree runtime dependencies, (2) a reachability classification, (3) the reductions that met the safety bar. **No** change to checkout/payment processing, cart pricing, order lifecycle, webhook verification, ZATCA/accounting, tenant routing/auth semantics, capability gates, backend, schema or environment. No merge, no deploy.

Method: a TypeScript-compiler import graph over `storefront/src` (static + dynamic imports; entry points = Next `page/layout/route/proxy/instrumentation/sitemap/…`; `app/dev` and tests excluded, as the ratchet does), plus a per-reference scan of the six client helpers. Scripts are throwaway and not committed; the numbers below reproduce with `npm run check:spree-ratchet` and the ratchet's own scanner.

## 1. Counts — imports vs. distinct business operations
| Category | Before | After |
|---|---|---|
| spree_value_imports | 4 | 4 |
| spree_type_imports | 4 | 4 |
| spree_client_access | 68 | **52** (−16) |
| spree_wrapper_imports | 77 | **69** (−8) |
| spree_env_reads | 9 | 9 |

The 52 client references collapse to **≈ 36 distinct SDK operations**, all of them concentrated in three capabilities that are *not* the DTC storefront: (a) the opt-in wholesale add-on + its Spree checkout, (b) the gated buyer-account/auth, (c) SDK plumbing (`lib/spree/*`). Distinct operations: `carts.{get,create,update,list,complete,associate}`, `carts.items.{create,update,delete}`, `carts.fulfillments.update`, `carts.discountCodes.{apply,remove}`, `carts.giftCards.{apply,remove}`, `carts.payments.create`, `carts.paymentSessions.{create,update,complete}`, `orders.get`, `channel.get`, `products.list`, `markets.{resolve,countries.list}`, `countries.get`, `customer.{get,update}`, `customer.addresses.{list,update}`, `customer.creditCards.list`, `customers.create`, `auth.{login,logout,refresh}`, `passwordResets.{create,update}`.

## 2. Reachability model (evidence)
- **DTC storefront is AWJ-native and Spree-free**: catalogue, cart (`getAwjCart/addAwjItem/…`, `CartContext` `isAwj = surface === "dtc"`), checkout (`(store-checkout)`), online payment, `getMarkets` (static AWJ market). A fresh DTC visit never builds a Spree client (`getClient()` throws by design when `SPREE_API_URL` is unset).
- **Legacy Spree checkout routes** (`(checkout)/checkout/[id]`, `confirm-payment/[id]`, `order-placed/[id]`) are unreachable unless `SPREE_WHOLESALE_CHANNEL` is set: `(checkout)/layout.tsx` calls `notFound()` when `!isWholesaleEnabled()`, and `proxy.ts` → `createSpreeMiddleware` returns the real 404 first (`middleware.test.ts` covers both branches). `resolveSurfaceForCart[Verified]` short-circuits to `"dtc"` without any call when wholesale is off.
- **Wholesale portal** (`(wholesale)/wholesale/*`) is gated by the same switch in its layout.
- **Buyer account auth** is `ACCOUNT_AUTH_CAPABILITY = "gated"`: every `customer.ts` action returns `capability_unavailable` (or `null`/no-op) *before* touching a client (`accountAuthLive()` at lines 87/117/160/197/218/251/279/306).
- Dead (zero importers, verified by import graph + repo-wide grep incl. tests/dev pages): see §4.

## 3. Inventory by capability, with disposition
Dispositions: **A** remove unused · **B** switch to existing AWJ equivalent · **C** needs new AWJ adapter/API · **D** blocked by policy/architecture/parity evidence.

| # | Capability | Files · functions (Spree op) | Status | AWJ equivalent | Tenant/auth boundary | Financial | Tests | Disp. |
|---|---|---|---|---|---|---|---|---|
| 1 | Wholesale cart (Spree) | `data/cart.ts` getCart/getOrCreateCart/addToCart/updateCartItem/removeCartItem/cartBelongsToSurface (`carts.*`, `channel.get`) | Gated (wholesale env) | none (D-3 wholesale decision pending) | channel-bound client, surface cookies | cart lines only | `cart.test.ts`, `cart-cookies` | D |
| 2 | Spree checkout | `data/checkout.ts` updateOrderAddresses/updateCartMarket/selectDeliveryRate/applyCode/removeDiscountCode/removeGiftCard (`carts.update`, `fulfillments.update`, `discountCodes.*`, `giftCards.*`) | Gated | AWJ checkout is a separate stack | surface-resolved client | totals/discounts | `checkout.test.ts` | D |
| 3 | Spree payment/completion | `data/payment.ts` (`carts.payments.create`, `paymentSessions.*`, `carts.complete`), `express-checkout-flow.ts` | Gated | AWJ online payment (`awj-online-payment.ts`) is separate | surface-verified, fail-closed on `unverified` | **payment capture/complete** | `payment.test.ts`, express tests | D |
| 4 | Completed-order read | `data/orders.ts` getOrder (`orders.get`) | Gated (used by checkout/payment only) | none | cart-token / JWT | read-only | via checkout/payment tests | D (with 2/3) |
| 5 | Market/country reads | `data/markets.ts` cachedResolveMarket/cachedListMarketCountries, `data/countries.ts` getCountry (`markets.*`, `countries.get`) | Gated (callers are the Spree checkout pages) | `getMarkets` already AWJ-static; no AWJ country/state API | locale/country cookies | none | `markets.test.ts`, `resolve-surface.test.ts`, `no-spree-env.test.ts` | C (needs AWJ countries API) |
| 6 | Saved cards / addresses | `data/credit-cards.ts` getCreditCards, `data/addresses.ts` getAddresses/updateAddress (`customer.*`) | Gated (Spree checkout only) | none (account addresses/cards are `GATED` in AWJ) | JWT | none | account gating tests | D |
| 7 | Buyer auth/profile | `data/customer.ts` (10 refs: `auth.*`, `customers.create`, `passwordResets.*`, `customer.get/update`, `carts.associate`) | Gated (`ACCOUNT_AUTH_CAPABILITY`) | none — identity contract is blocked on **D-1/D-2** (B1–B7 in the exit plan) | session cookies | none | `customer.gated.test.ts`, `AuthContext.gated` | D |
| 8 | Wholesale catalogue/channel | `data/wholesale.ts` (`channel.get`, `products.list`) | Gated | none | wholesale channel + publishable key | none | wholesale tests | D |
| 9 | SDK plumbing | `lib/spree/{config,auth-helpers,cookies,webhooks}.ts` | Infrastructure | n/a | n/a | n/a | spree tests | D (last to go) |
| 10 | Webhook ingress | `api/webhooks/spree/route.ts` + `lib/webhooks/handlers.ts` (`SPREE_WEBHOOK_SECRET`) | Orphan (no Spree backend sends it) but a live public endpoint (503 unconfigured) | none (N1–N5 notification design) | HMAC verification | email only | handler tests | D — removing a public route / its signature check is outside this PR |
| 11 | Wholesale switch & env | `isWholesaleEnabled` imported by `(checkout)/layout`, `(wholesale)/layout`, `Header`, `Footer`, `WholesaleSection`, `data/checkout`; env reads in `next.config.ts`, `DocumentShell`, `config.ts`, webhook route | Active gate | n/a | n/a | n/a | `middleware.test.ts` | D (moving it only relocates the same `SPREE_*` read) |
| 12 | Account token cookies | `(authenticated)/layout.tsx` (`getAccessToken/getRefreshToken`), `data/cookies.ts` | Gated account | none | cookies | none | layout test | D |

No operation in rows 1–12 met condition **B** (an existing AWJ endpoint *with demonstrated equivalent behaviour*): AWJ has no wholesale channel, no Spree-shaped account/address/card/order contract and no country/state API; the AWJ cart/checkout/payment are separate stacks reachable only on the DTC surface. Forcing any of them would be a behaviour change dressed as a refactor, so none was attempted.

## 4. Reductions delivered
### A — removed unused dependencies (no importers anywhere; the exit plan already lists these as dead)
| Removed | Evidence | Effect |
|---|---|---|
| `components/account/{CreditCardList,GiftCardList,OrderList,OrderDetail}.tsx`, `components/addresses/AddressManagement.tsx`, `components/order/{FulfillmentBlock,LineItemCard}.tsx` | zero static/dynamic importers; not referenced by tests, dev pages or routes (`AccountShell.architecture.test` only skips them by name; passes unchanged) | dead UI gone |
| `lib/data/gift-cards.ts`, `lib/data/index.ts` (barrel with zero importers) | no importer; barrel re-exported the dead set | −4 client, −2 wrapper |
| `deleteCreditCard`, `getAddress`, `createAddress`, `deleteAddress`, `getOrders`, `getCountries`, `associateCartWithUser` (+ its test block) | zero references outside their own file/dead callers; `getOrCreateCart` and `clearCart` **kept** (used by `addToCart`/tests) | −12 client |
| `StoreOrderListParams` | sole consumer `getOrders` removed | dead type gone |
Behaviour of every remaining export is byte-for-byte unchanged (only deletions of unreferenced code and now-unused imports).

### Wrapper-import reduction without behaviour change
`Surface`/`DEFAULT_SURFACE`/`SURFACES` (a pure type + constants) now live in `lib/commerce/surface.ts`; `lib/spree/surface.ts` re-exports them, so `@/lib/spree` still exposes identical values. `CartContext`, `data/cached`, `data/products`, `metadata/product` import the vocabulary from the AWJ-owned module (−4 wrapper imports; a further −2 from dropping `withAuthRefresh`, now unused, from `data/orders.ts`). New `surface.test.ts` pins the value set, the single-source-of-truth identity and the unchanged cookie/cache helpers.

## 5. Parity evidence
No runtime call was switched, so no request/response/tenant/locale/caching comparison is applicable; the claim is "no live path changed", evidenced by: deletions limited to zero-importer code (graph + `rg` over `src`, tests, dev pages, plan docs); `tsc` clean; the full suite (which covers cart, checkout, payment, gating, markets, middleware 404 and account-architecture tests) green; ratchet decreases only. Negative cases for tenant/authorization were not re-run because no tenant-aware path changed.

## 6. Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest | 241 files passed / 16 skipped; 3464 tests passed (3462 − 1 removed dead-code test + 3 new surface tests) |
| Biome (changed files) / repo lint | clean on changed files; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | compiled successfully |
| Spree ratchet | OK (decreases only; baseline tightened) |
| CI / CI Gate | see PR |

## 7. Deferred (concrete blockers)
Rows 1–12 above. Blockers, in order: **wholesale product decision (D-3)** — rows 1–4, 8, 11 can only go together; **buyer-identity contract (D-1/D-2, B1–B7)** — row 7/12; **AWJ countries/states API** — row 5 (and `useCountryStates`); **webhook/notification direction (N1–N5)** — row 10; **SDK removal last** — row 9 (`SpreeError` value imports remain in `checkout.ts`/`auth-helpers.ts`).

## 8. Risks
Low: only unreferenced code removed. Residual: a *dynamic* string-built import of a deleted module would not show in the graph (none found; `rg` clean) and a deleted server action could not be invoked by a stale client bundle during a rolling deploy (no client referenced them). `lib/utils/format.ts` and `lib/utils/order-status.ts` are now/already unreferenced by live code — left in place (not Spree-related; separate cleanup).

## 9. Proposed next large batch (not started)
**Batch D — retire the wholesale + Spree-checkout cluster as one unit** once D-3 is decided: delete `(wholesale)/*`, `(checkout)/*`, `data/{checkout,payment,orders,express-checkout-flow,credit-cards,addresses,countries,markets(Spree part),wholesale}.ts`, the Spree branches of `data/cart.ts`, `components/checkout/{PaymentSection,AddressSection,…}`, `useCountryStates`, `proxy`'s legacy-checkout branch and `isWholesaleEnabled` consumers — this removes ~40 of the remaining 52 client refs and most wrapper/env reads in one reviewable deletion, with the middleware 404 tests converted to "routes absent". Prerequisite: written owner decision D-3 (and a deploy-time check that `SPREE_WHOLESALE_CHANNEL` is unset everywhere).

Branch `claude/commerce-h6-batch-c` · Base `4ce4aac04` · Head: see PR.
