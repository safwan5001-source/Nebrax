# H6 Accelerated Migration — Batch B (cart / checkout / payment presentation types)

Storefront only, **type-only**. No request builders, mutations, payment handling, checkout orchestration, routes/redirects, feature gates, tenant logic, webhook runtime logic, Laravel accounting or ZATCA touched. No legacy Spree checkout route reactivated.

## Migrated type families (`storefront/src/lib/commerce/types.ts`)
Built by **extending** the Batch A / T1-8 order-display types rather than duplicating them:
| Type | Notes |
|---|---|
| `StoreDiscount`, `StoreDeliveryMethod`, `StoreDeliveryRate`, `StoreStockLocation`, `StorePaymentMethod` | SDK twins |
| `StoreCartLine` | extends `StoreOrderLine` |
| `StoreCartFulfillment` | extends `StoreOrderFulfillment` (narrows `delivery_method`/`stock_location` to the non-null SDK shape) |
| `StoreCartPayment` | extends `StoreOrderPayment` |
| `StoreCompletedOrder` | SDK `Order` twin (extends `StoreOrderDetail` + `StoreOrderTotals`) |
| `StoreCart` | `Omit<StoreCompletedOrder, email/completed_at/payment_status/fulfillment_status>` + cart-only fields (`token`, nullable `email`, `warnings`, `current_step`, `completed_steps`, `requirements`, `shipping_eq_billing_address`, `payment_methods`) |
| `StoreCreateCartParams`, `StoreChannel` | SDK twins |
Reused from Batch A: `StoreAddress`, `StoreAddressParams`, `StoreCountry`, `StoreState`, `StoreCreditCard`, `StoreGiftCard`, `StoreMarket`.

## Changed files (21 + report/baseline)
Components: `checkout/{AddressSection,CouponCode,DeliveryMethodSection,ExpressCheckoutButton,PaymentSection,Summary}`, `cart/CartDrawer`. Pages: `checkout/[id]/{page,CheckoutPageContent,CheckoutSidebar}`, `order-placed/[id]/page`, `wholesale/cart/WholesaleCartView`. Contexts/data/utils: `contexts/CartContext`, `lib/data/{cart,checkout,payment,express-checkout-flow,wholesale}`, `lib/utils/express-checkout`, `lib/webhooks/handlers` (type argument of `WebhookEvent<…>` only).

## Spree dependency counts (before → after)
| Category | Before | After |
|---|---|---|
| spree_type_imports | **41** | **4** (−37) |
| spree_value_imports | 4 | 4 |
| spree_client_access | 68 | 68 |
| spree_wrapper_imports | 77 | 77 |
| spree_env_reads | 9 | 9 |

## Evidence runtime behaviour is unchanged
- Every change is an `import type` line, a type annotation, a generic argument, or an `as` type in an existing assertion (erased). No new casts and no new `any`; `tsc --noEmit` is clean with the existing assertions only renamed.
- **Emit comparison:** each changed file was transpiled (`ts.transpileModule`) at `origin/main` and at HEAD and compared — 20/20 files byte-identical; the one remaining file (`checkout/[id]/page.tsx`) differs only by a removed blank line after the import block (identical once whitespace is normalised).
- A scripted rename initially altered two string literals in `webhooks/handlers.ts` (`"… Order Confirmation/Canceled …"` email subjects); the emit comparison flagged nothing only after I restored them — the final diff contains no string/template changes. Email subjects are therefore byte-identical.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest | 240 files passed / 16 skipped; 3462 tests passed |
| Biome (changed files) | clean |
| `next build` | compiled successfully |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |
Focused suites inside the full run: cart state (`CartContext`, `lib/commerce/{cart,cart-cookies,cart-types,cart-lines-gifting}`, `lib/data/cart`, `CartDrawer/CartLine/CartSummary/CouponField`), checkout address/delivery/pricing (`lib/data/checkout`, `lib/commerce/checkout`, `awj-checkout`, `AwjCheckoutFlow*`, `utils/express-checkout`), COD/online payment & return handling (`PaymentStage`, `PaymentReturn*`, `pending-online-payment`, `lib/data/payment`, `confirm-payment/page`), idempotency (`checkout-idempotency`), gating (`AccountAuthGate.architecture`, `AuthContext.gated`, `customer.gated`), routes/404 (`checkout-routes`, checkout layouts, `Confirmation.cancelled`).

### Coverage gaps (not claimed as verified)
No storefront test targets tenant isolation directly (it lives in the Laravel API/`SetTenant`, untouched here); no dedicated order-placed page test; payment authorization/capture is server-side (Laravel) and not exercised by storefront tests.

## Deferred (remaining 4)
`lib/spree/auth-helpers.ts` (`RequestOptions`), `lib/spree/config.ts` (inline `type Client`), `lib/spree/webhooks.ts`, `lib/webhooks/handlers.ts` (`WebhookEvent`): SDK infrastructure/webhook transport types — converting them means owning the client/webhook contract, i.e. not a presentation-type change.

## Financial / tenant risks
Low. No amount, rounding, currency, tax, discount or total expression changed; tenant and surface resolution untouched. Structural twins do not track SDK drift (intended); `StoreCart` deliberately omits SDK-only nested fields no consumer reads (`option_values`, `digital_links` on lines).

## Recommended Batch C
Out of the type-import scope: `spree_value_imports` (4: `SpreeError`, `createClient`, webhook verifiers), `spree_client_access` (68) and `spree_wrapper_imports` (77) — runtime-affecting; start with a read-only inventory of client calls grouped by capability and the remaining `@spree/sdk` runtime surface, then replace wrappers behind the existing AWJ commerce client one capability at a time with parity tests. Not started.
