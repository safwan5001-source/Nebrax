# H6 / T1-8 — Read-Only Order Presentation Types

Storefront only, type-only, zero intended runtime change. No order creation/cancellation/lifecycle, cart/checkout, payments/refunds, accounting/ZATCA, backend/API/serializers, schema, auth/session, feature gates, data fetching, layout or styling touched. Nothing is connected to a new AWJ API, and no legacy Spree page is made to look functional.

## Reachability finding
- `components/account/OrderList.tsx` and `OrderDetail.tsx` (Spree-shaped) have **no importers**: the live account orders route renders `AccountOrderList`/`AccountOrderDetail` (already AWJ-owned, still gated). They are dead legacy components; migration is purely a type change.
- `components/order/{AddressBlock,OrderTotals,PaymentInfo}` are used by the checkout `order-placed` page (which passes a Spree `Cart`); `LineItemCard`/`FulfillmentBlock` only by the dead `OrderDetail`.

## New types (`storefront/src/lib/commerce/types.ts`)
`StoreOrderAddress`, `StoreOrderTotals`, `StoreOrderLine`, `StoreOrderFulfillment`, `StoreOrderCard`, `StoreOrderStoreCredit`, `StoreOrderPayment`, `StoreOrderSummary`, `StoreOrderDetail` (extends Summary + Totals). Field-for-field subsets of the SDK shapes with nullability preserved; `gift_card` is `unknown` (only truthiness is read). Spree `Order`/`Cart` values remain assignable structurally.

## Components migrated (7)
`AddressBlock`, `OrderTotals` (was `Cart | Order`), `PaymentInfo`, `LineItemCard`, `FulfillmentBlock`, `account/OrderList`, `account/OrderDetail`. Only `import type` lines and annotations changed; no JSX, formatting, status-label, currency/tax, locale or RTL logic touched.

## Spree dependency counts
`spree_type_imports` **86 → 74 (−12)**: OrderDetail 1→0, OrderList 1→0, AddressBlock 1→0, FulfillmentBlock 3→0, LineItemCard 1→0, OrderTotals 2→0, PaymentInfo 3→0. Other categories unchanged; baseline diff is decreases only.

## Boundary notes
- `PaymentInfo` keeps its two pre-existing narrowing casts (`source as …`), now to AWJ types; the SDK payment `source` isn't a discriminated union, so these are not new assertions and none were added to force compatibility.
- `lib/data/orders.ts` (`OrderListParams`), `CreditCardList`, `GiftCardList` and the order-placed/checkout pages (`Cart`) are deferred: they touch data fetching or checkout.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest (incl. account gating, AccountOrder*, formatting/locale) | 240 files passed / 16 skipped; 3462 tests passed |
| Biome | clean on changed files; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | succeeded |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |

## Risks
Low. A future SDK field change will not flow into these types (intended). `StoreOrderTotals` requires all listed fields, as the SDK `Order`/`Cart` provide them; a hand-built partial object would need updating.

## Recommended next cluster
`lib/data/orders.ts` (`OrderListParams`) plus the account saved-payment pair (`CreditCardList`, `GiftCardList`), then `gtm.ts` analytics types; checkout/cart types last, each behind its own parity gate.
