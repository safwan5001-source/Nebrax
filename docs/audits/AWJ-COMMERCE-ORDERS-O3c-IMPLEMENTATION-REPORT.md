# AWJ Commerce Orders — O3c: Public Cancellation Contract & Storefront Parity

- **Branch:** `claude/commerce-orders-o3c`
- **Base SHA:** `f3d9f563503cadae17be16baec76c83fad3a7b8d` (main after O3b)
- **Head SHA:** `5b5f09515158ecc62ea4112e19479b46de3d9bb9` (before this report touch-up) · **PR:** #1781
- **Scope guard:** no merge, no deploy, no activation of cancellation, no accounting change.

## 1. What changed (ADR-28 D-9-P1, option B)

A cancelled order is now read by the buyer as `status: "cancelled"` with `cancellation: {cancelled_at}`. The stored `commerce_orders.status` stays `confirmed`; `cancelled_at` remains the single source of truth (derived via `CommerceOrder::lifecycleStatus()`).

### Endpoints affected (all public read surfaces that emitted order `status`)

| Surface | Producer | Change |
|---|---|---|
| `GET /commerce/v1/orders/{id}` (guest, signed reference) and `POST /commerce/v1/checkout/complete` | `CommerceOrderSerializer::serialize` | status + `cancellation` |
| `GET /commerce/v1/me/orders/{id}` | same serializer | same |
| `GET /commerce/v1/me/orders` (list rows) | `CommerceCustomerOrderController::index` | status + `cancellation` (list/detail parity) |
| `POST /store/v1/checkout/complete` (replay) | `StorefrontCheckoutController::serializeOrder` | status + `cancellation` |

Staff surfaces (`CommerceOrderStaffSerializer`, `commerce/orders*`) are untouched: reason, note and actor remain staff-only.

### Contract before / after

Non-cancelled order — **byte-identical** (no new key):

```json
{ "status": "confirmed", "...": "..." }
```

Cancelled order:

```json
{ "status": "cancelled",
  "cancellation": { "cancelled_at": "2026-05-03T10:00:00+00:00" }, "...": "..." }
```

`payment.status` keeps reflecting the intent (`cancelled`); `payment.requires_action` is never true for a cancelled order. Totals, items and snapshots are unchanged.

### Storefront

- `AccountOrderList` / `AccountOrderDetail`: «ملغى / Cancelled» label (6 locales: ar, en, de, es, fr, pl).
- `AccountOrderStatus`: a cancelled order replaces the (design-only) journey with a terminal notice — never lights placed/preparing/on the way; no refund or payment-reversal claim; optional localized cancellation date.
- Detail hides the "confirmed commercial commitment / no payment processed" note for a cancelled order (it would be misleading).
- `mapAwjOrderToViewModel`: `cancelledAt` is set only for `cancelled`; missing `cancellation` block tolerated (`null`).
- Existing `store-*` tokens only (RTL/LTR logical classes, light/dark inherited).

## 2. Compatibility — intentional enum extension

Adding `cancelled` to the buyer-facing `status` value set is an **intentional, not silently non-breaking, change**. Clients that validate `status ∈ {draft, confirmed}` strictly (generated enums, exhaustive switches) will see an unknown value for cancelled orders. Mitigations: the OpenAPI schema `OrderPublicStatus` documents the value and advises treating unknown values as terminal/non-active; `cancellation` is optional and absent for non-cancelled orders; the storefront keeps `status` as `string` and falls back to the raw value for unknown statuses. The frozen `contracts/flowers-journey/11-order.json` (a confirmed order) is unchanged. Impact is **zero until the feature gate is opened** because no order can be cancelled while `COMMERCE_ORDER_CANCELLATION_ENABLED=false` (legacy cancellations via `payment-intents/{id}/cancel` do not set `cancelled_at`).

## 3. Security / integrity

- No internal data in public payloads: reason, note, actor, `cancel_action` are asserted absent (plus a static test that the public serializer/controller never reference `cancellation_reason|note|cancelled_by`).
- Tenant isolation / IDOR: foreign signed reference, foreign tenant, and other-customer reads remain uniform 404 for cancelled orders.
- Read-only: no payment/reservation/invoice/stock/ledger mutation; no buyer cancel route (the only cancel route remains the staff one); eligibility/authorization untouched; gate default off.

## 4. Tests and results (actual)

| Suite | Result |
|---|---|
| New `CommerceOrderPublicCancelledContractTest` (9) + store/v1 replay test + OpenAPI cancelled-order schema case | pass on SQLite and PostgreSQL |
| Related backend set (`CommerceOrder*`, `CommerceCustomerOrder*`, `FlowersEndToEnd*`, `StorefrontCheckout*` incl. PG concurrency, `CommerceApiOpenApiContract`, `CommerceStaffOrder*`) | SQLite: 287 passed / 17 skipped · PostgreSQL: 126 passed (selected subset) |
| `CommerceOrderCancellationFactsTest` | updated one O3a-1 guard that asserted "public serializer untouched until O3c" to the O3c contract |
| Storefront vitest (full) | 3452 passed / 16 skipped |
| `tsc --noEmit`, `biome lint` (touched dirs), `pnpm build` | clean |

Mutation check: reverting `publicStatus()` to the stored status fails 3 of the new tests. Browser E2E smoke was **not** run (no gate-open environment; the feature must stay disabled) — component-level rendering tests cover list/detail/status.

## 5. Beta activation review prerequisites

Met for a *separate* activation review: staff API (O3a-2b), staff UI (O3b), public contract and storefront parity (this slice), tenant isolation/privacy tests. Still outside this slice and to be decided in that review: the coordinated activation decision itself (ADR-28 §5.2/O3c), refund/return handling for paid orders (separate RT track), mobile/App Builder client verification against the new enum value, and a browser E2E smoke in a gate-open staging tenant.

## 6. Follow-up — P2 "Handle cancelled completion replays in the confirmation UI" (PR #1781)

**Finding (valid):** `completeAwjCheckoutAction` replays return the *current* order, so after "completion → lost response → staff cancels → retry with the same Idempotency-Key" the flow rendered `AwjOrderConfirmation` as a success («Order placed» + `success.notPaidNote` commitment copy) and could still start the online-payment redirect on a stale `requires_action`.

**Fix (storefront only, no backend/contract change):**
- `AwjOrderConfirmation`: for `status === "cancelled"` shows the terminal state (ban icon, `orders.cancelled.title`, dated/dateless body, `orders.cancelled.detail`); the success heading and `success.notPaidNote` are not rendered. Order number, lines and the server total are kept; no refund/payment-reversal claim. Reuses the existing 6-locale `orders.cancelled.*` keys (no new messages).
- `AwjCheckoutFlow`: the online-payment hand-off now requires `order.status !== "cancelled"`; a cancelled replay never saves pending-payment state, redirects, or calls `startOnlinePaymentAction`.
- Other surfaces reviewed: `AccountOrderList/Detail/Status` (handled earlier in this PR), `PaymentReturn` (driven by `payment-status`, which already has a `cancelled` state), and the only other consumer of `completeAwjCheckoutAction` is the flow itself. No further surface renders order completion.

**Tests:** `AwjCheckoutFlow` regression for the exact sequence (first attempt lost → cancelled replay with stale `requires_action`: cancelled UI, no success/commitment copy, no redirect/payment start, no pending storage, same Idempotency-Key reused); `Confirmation.cancelled.test.tsx` renders with the **real** message catalogs in ar, en, de, es, fr, pl (terminal copy present, success/commitment copy absent, total kept), en no-refund-claim, dateless fallback, confirmed unchanged. Mutation check: removing the flow guard fails the regression. Backend replay contract is already covered by `a_replayed_completion_of_a_cancelled_order_reports_cancelled…`.

**Results:** storefront vitest 3462 passed / 16 skipped; `tsc`, biome, `pnpm build` clean. Gate unchanged (off); no merge/deploy.

## 7. Follow-up — Storefront CI Biome failure on `8818772`

`Storefront CI` failed on `assist/source/organizeImports` in `storefront/src/components/checkout/__tests__/Confirmation.cancelled.test.tsx` (my earlier local run used `biome lint`/`format`, which do not run the import-organizing assist; CI runs `biome check`). Fix: `biome check --write` on that single file (import order only, no logic or test change). Local `biome check .` now reports 0 errors (5 pre-existing warnings, 3 infos); the file's 9 tests still pass. Final head SHA and CI results are in the PR.
