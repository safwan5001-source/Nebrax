# H6 Accelerated Migration — Batch A (account / address / market / analytics types)

Storefront only, **type-only**, zero intended runtime change. No request construction, data-fetch expression, payment/order/cart/checkout behaviour, accounting/ZATCA, backend, migration, auth/session or feature-gate code touched. No gated legacy Spree functionality activated.

## Migrated type families (`storefront/src/lib/commerce/types.ts`)
| Family | New AWJ types | Consumers migrated |
|---|---|---|
| Saved cards | `StoreCreditCard` | `account/CreditCardList`, `lib/data/credit-cards` |
| Gift cards | `StoreGiftCard` | `account/GiftCardList`, `lib/data/gift-cards` |
| Customer | `StoreCustomerGroup`, `StoreCustomer` | `lib/data/customer`, `lib/wholesale` |
| Orders request | `StoreOrderListParams` (extends `StoreListParams`) | `lib/data/orders` |
| Address | `StoreAddress`, `StoreAddressParams`, `StoreState`, `StoreCountry` | `addresses/AddressManagement`, `lib/data/addresses`, `lib/utils/address`, `hooks/useCountryStates`, `checkout/AddressEditModal`, `AddressFormFields`, `AddressSelector`, `AddressSection` (Address/Params/Country/State only) |
| Market | `StoreMarket` (recursive with `StoreCountry`) | `contexts/StoreContext`, `i18n/markets`, `lib/data/markets`, `lib/metadata/alternates` |
| Analytics | `StoreAnalyticsOrder`, `StoreAnalyticsLineItem` | `lib/analytics/gtm` (replaces `Cart | Order`, `LineItem`) |

All are field-for-field structural twins/subsets with nullability preserved; Spree values stay assignable, **no casts added** (the pre-existing `{ data: [] } as { data: StoreAddress[] }` in `lib/data/addresses.ts` only had its type name swapped). Only `import type` lines, annotations and local type names changed; two comments that a rename briefly touched were restored.

## Spree dependency counts (before → after)
| Category | Before | After |
|---|---|---|
| spree_type_imports | **74** | **41** (−33) |
| spree_value_imports | 4 | 4 |
| spree_client_access | 68 | 68 |
| spree_wrapper_imports | 77 | 77 |
| spree_env_reads | 9 | 9 |
Baseline diff is decreases only (24 file entries removed or reduced).

## Deferred (remaining 41) and why
- **Cart/checkout/payment flow types** (`Cart`, `Payment`, `Fulfillment`, `PaymentSession`, …): `CheckoutPageContent`, `CheckoutSidebar`, `checkout/[id]/page`, `CartDrawer`, `CartContext`, `data/cart`, `data/checkout`, `data/payment`, `data/express-checkout-flow`, `utils/express-checkout`, `checkout/{CouponCode,Summary,DeliveryMethodSection,ExpressCheckoutButton,PaymentSection}`, `AddressSection` (`Cart`), `order-placed/[id]/page`, `WholesaleCartView`. These sit on live cart/checkout/payment flows and warrant their own parity gate (Batch B).
- `data/wholesale.ts` (`Channel`), `lib/webhooks/handlers.ts` (webhook payload types), `lib/spree/{auth-helpers,config,webhooks}.ts` (SDK-infrastructure imports; value imports untouched).
- `app/dev/*` and tests are not counted.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest (account, address, order-display, GTM, markets, gating included) | 240 files passed / 16 skipped; 3462 tests passed |
| Biome | clean on changed files; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | compiled successfully (prerender logs about unset `AWJ_COMMERCE_API_URL` are the usual local-env fallbacks) |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |

## Risks
Low. Structural twins won't track future SDK changes (intended). `StoreCustomer` omits `newsletter_subscriber` (unused by the storefront); a future reader of that field would need it added. `StoreAnalyticsOrder.discounts[].code` is optional-nullable, wider than the SDK's.

## Proposed Batch B boundary
Cart / checkout / payment flow types as one batch with a parity gate: `Cart`, `LineItem`, `Fulfillment`, `Payment*`, `DeliveryMethod`, `CartWarning` across `CartContext`, `data/{cart,checkout,payment,express-checkout-flow}`, `utils/express-checkout`, cart drawer and checkout components/pages (~30 imports), plus `Channel` and webhook payload types. Value imports/client access/wrappers/env reads remain a separate runtime-affecting phase. Not started pending review.
