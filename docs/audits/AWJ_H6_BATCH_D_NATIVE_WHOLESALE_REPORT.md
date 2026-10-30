# H6 Batch D — Native Wholesale Migration: gap analysis, target architecture, characterization tests

**Scope delivered: architecture-and-tests only.** Decision D-3 (owner): wholesale is retained as a **native AWJ Commerce capability** and the legacy Spree implementation is to be migrated away from. That decision is **not** approval to delete the legacy checkout, enable wholesale, or change pricing/payment/tax/order behaviour; none of those were touched. No production code changed (`git diff` is tests + this report), the Spree ratchet is unchanged, and the legacy wholesale/checkout code stays reachable behind its existing gate (`SPREE_WHOLESALE_CHANNEL`).

Why no implementation slice: every backend contract a native wholesale needs for *authorization* or *price* is either absent or blocked on an undecided owner question (buyer identity D-1/D-2) or touches shared pricing behaviour (see §4). Forcing a storefront-side conversion would map a wholesale cart onto a DTC cart without a verified price/authorization boundary — which the brief forbids. Evidence below was gathered from the code at `origin/main@431f2d875` (storefront and Laravel), not from docs alone.

## 1. Current vs target architecture
**Current (legacy, dormant everywhere):** an env-gated add-on (`SPREE_WHOLESALE_CHANNEL`) with its own surface (`"wholesale"`): Spree channel client, Spree cart (`_spree_wholesale_cart_token` cookies), Spree checkout/payment routes (`(checkout)/*`), approval = membership of customer group `"Wholesale"`, hidden-price posture from the Spree channel's `storefront_access`. No Spree backend exists in any AWJ environment, `ACCOUNT_AUTH_CAPABILITY` is `gated`, so `getCustomer()` is always `null` and the portal can only ever show the sign-in wall. Its PLP/PDP call the AWJ catalogue but the `surface` argument is ignored, so they show **DTC/channel prices** next to a Spree cart.

**Target (native):** a *separate wholesale storefront on its own web SalesChannel* (the backend already supports multiple stores with Host→Storefront→channel isolation, `CommerceActiveStoreIsolationTest`), priced by a **channel price list** (`sales_channels.default_price_list_id`) and a **buyer's linked Partner price list** (`CommercePriceResolver` precedence: partner → channel → item → product), with listings visible only on that channel (`CommerceListing`). Buyer identity via the planned `store/v1` customer context (B1–B7), approval = a staff action that links a Partner and assigns its price list, ordering rules (login required, minimum order, MOQ/order multiple) enforced server-side in `CommerceCartService`/`revalidateAndPrice`, cart and checkout = the AWJ cart/checkout on that channel (never a DTC cart reused), payment = per-channel payment-method availability. The storefront renders posture/prices from the API; it holds no group name, no hard-coded minimum.

## 2. Feature parity matrix
| Capability | Legacy (Spree-shaped) | AWJ today | Reuse / contract needed | Status |
|---|---|---|---|---|
| Enable / visibility | env `SPREE_WHOLESALE_CHANNEL` | none | new capability flag per store/channel (staff-settable) | **Missing** |
| Separate channel + storefront | Spree channel | **Yes** — web channel + Storefront + domain resolution, isolation tests | reuse; needs a "wholesale role" setting (channel types are `web/mobile/pos/external`) | Partial |
| Tenant/channel isolation | channel-bound client | **Yes** — Host-only tenant resolution, `TenantScope`, cross-tenant list rejected | reuse | Done |
| Wholesale price source | Spree price list (+volume rules) | **Model + resolver only**: channel list resolves in cart/checkout/PDP; **no HTTP route sets `default_price_list_id`** | staff endpoint + audit | Partial |
| Per-buyer trade price | group → price list | Partner list exists (POS) but **cart/checkout always pass `partnerId=null`**; POS toggle `apply_customer_price_list` would gate it | thread `CustomerContext::linkedPartnerId()` server-side; own gate | **Missing** |
| List vs detail price consistency | n/a | **Latent defect**: `StorefrontProductController::index` reads `Product.sale_price` directly (stale comment claims resolver parity) while `show`/cart use the resolver → a channel with a price list shows retail in the list, list price on detail/cart | fix with a batched resolver + parity test, pricing-scope approval | **Blocker** |
| Buyer identity / login | Spree customer | `store/v1` is anonymous; `commerce/v1` has it | B1–B2 after **D-1/D-2** | **Blocked (owner)** |
| Customer groups / audience | customer group "Wholesale" | **None** (Partner classification unused by commerce; no audience/hide-price field) | channel `require_auth` / `hide_price_for_guests` or approved-buyer link | **Missing** |
| Application + approval | register + admin adds to group | none (`CustomerPartnerLinkService` unused by any controller) | application state + staff approve → link Partner + price list | **Missing** |
| Hidden prices for guests | `storefront_access = prices_hidden` | none | channel flag + API omits prices | **Missing** |
| Min order / MOQ / multiples | demo constant `WHOLESALE_MIN_QUANTITY=10` | none (qty only `min:1`) | per-channel/listing rules in cart + revalidate | **Missing** |
| Quick order by SKU | `products.list` search | catalogue search exists; SKU/variant lookup unproven; AWJ cart adds product + unit key, not variant id | storefront adapter after SKU contract | Partial |
| Wholesale cart | Spree cart, own cookies | AWJ cart on the channel Host (separate cookies are a storefront concern) | reuse AWJ cart; **no mapping from the legacy cart** | Partial |
| Checkout / payment | Spree checkout + Stripe/Adyen | AWJ checkout V1, per-channel payment methods; credit/net-terms not modelled | reuse; terms are a new contract | Partial |
| Shipping / tax | Spree | flat zones (per tenant); VAT fixed 15 %; **no B2B price-excl.-VAT display contract** | tax display mode — **needs approved tax scope** | Partial / out of scope |
| Order price provenance | Spree | `CommerceOrderLine` stores no `price_list_id`/source | add provenance field | **Missing** |
| Feature gate | env | `PAYMENT_CAPABILITY`, `ACCOUNT_AUTH_CAPABILITY` = gated | new `WHOLESALE_CAPABILITY` only once a contract exists | **Missing** |

## 3. Implemented in this PR (tests only, no behaviour change)
- `lib/__tests__/wholesale.test.ts` — `isWholesaleApproved`: guest, no/unrelated group, exact membership, look-alike names (`wholesale`, `Wholesale `, `Wholesale Applicants`), missing group list fails closed. (Previously untested.)
- `lib/data/__tests__/wholesale-boundary.test.ts`:
  - `getWholesaleChannel` returns `null` without building a Spree client while wholesale is off, and degrades to `null` (sign-in wall) on lookup failure — **no fallback to another channel/tenant**.
  - Characterizes the **price boundary**: wholesale PLP/PDP/filter fetchers pass no surface/channel/price-list input to the AWJ catalogue adapter (so they cannot show trade prices today).
  - Architecture guard (parses complete, multi-line import/export/dynamic-import declarations; the parser itself is tested): nothing under `lib/commerce/` imports `@/lib/spree`, `@spree/*` or `data/wholesale`, and the AWJ cart/checkout adapters mention no wholesale surface in executable code — pinning "a wholesale cart is never mapped onto a DTC cart" (complements the existing `CartContext` "wholesale stays Spree-backed" and `cart.test.ts` surface-poisoning tests).

## 4. Deferred, with concrete blockers
1. **Buyer authentication on `store/v1` (B1–B2)** — blocked by owner decisions D-1 (session mechanism) / D-2 (verification channel + SMS/email provider).
2. **Application/approval + Partner linking + price-list assignment** — needs an entity/state and staff UI; depends on 1.
3. **Linked-partner price in cart/checkout** — changes the price every signed-in buyer pays; needs an approved pricing scope, its own gate (the POS setting must not silently control it) and price-parity tests across list/detail/cart/order.
4. **List/detail price fix** (`StorefrontProductController::index`) — shared by every DTC store; correct fix needs a batched resolver (the stale N+1 comment shows why it was avoided). A *behaviour* change, not a refactor: not done here. A test that pinned today's behaviour was deliberately **not** added so as not to enshrine the defect.
5. **Staff endpoint/UI for `default_price_list_id` + channel flags** (`require_auth`, `hide_price_for_guests`, `min_order_minor`) and **MOQ/multiples** — new backend contracts with audit trail.
6. **Order-line price provenance**, **B2B tax-display mode**, **net-terms/credit checkout** — accounting/tax-adjacent; require separately approved scope.
7. **Deleting the legacy portal/checkout and `isWholesaleEnabled` consumers** — only after native parity is proven (explicitly out of scope).

## 5. Files changed
`storefront/src/lib/__tests__/wholesale.test.ts` (extended), `storefront/src/lib/data/__tests__/wholesale-boundary.test.ts` (new), this report. No production, backend, schema, config or baseline file.

## 6. Spree dependency counts (before → after)
`spree_value_imports` 4 → 4 · `spree_type_imports` 4 → 4 · `spree_client_access` 52 → 52 · `spree_wrapper_imports` 69 → 69 · `spree_env_reads` 9 → 9. (Unchanged by design: no production code touched.)

## 7. Verification
| Check | Result |
|---|---|
| Focused: `wholesale.test.ts` + `wholesale-boundary.test.ts` | 17 tests pass |
| Existing wholesale-adjacent suites (`resolve-surface`, `cart`, `CartContext`, `middleware`, `checkout-routes`, `no-spree-env`, `MobileMenu`, `Footer.legacy`) | included in the full run |
| `tsc --noEmit` | clean |
| Full storefront vitest | 242 files passed / 16 skipped; 3475 tests passed (+11 new) |
| Biome | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | compiled successfully |
| Spree ratchet | OK, unchanged |
| Backend suites | not run — no backend code changed |
| CI / CI Gate | see PR |
**Coverage gaps (not claimed as verified):** no test exists for `WholesaleGate` posture branches, quick-order resolution, or `WholesaleCartView`; no authenticated-buyer test on `store/v1`; no audience/visibility or MOQ test (the features do not exist); cross-tenant and missing-authorization negatives for wholesale cannot be written until buyer identity exists (the underlying tenant/channel isolation is covered by existing backend suites listed in the backend map: `CommerceActiveStoreIsolationTest`, `CommercePriceResolverTest`, `StorefrontDomainResolutionApiTest`, `ApiTenantIsolationTest`).

## 8. Risks
- The legacy portal, if ever enabled today, would display DTC prices beside a Spree cart (pinned by the new characterization test) — another reason it must stay off; `.env.example` already forbids `SPREE_*` values.
- Enabling any per-buyer price before the list/detail inconsistency is fixed would show a buyer one price in listings and another in cart.
- Channel types have no "wholesale" role; avoid encoding wholesale as a group-name string match in the storefront when the native contract lands.

## 9. Recommended next batches
1. **Decisions (no code):** D-1/D-2 (buyer session + verification channel); approval policy; whether the wholesale store is a separate Host/Storefront (recommended — it reuses isolation) or an audience on the main store.
2. **Backend batch W-B1 (one PR, pricing-scoped):** fix list/detail price parity with a batched resolver + tests, staff endpoint for channel price list/flags with audit, order-line price provenance.
3. **Backend batch W-B2:** buyer auth on `store/v1` (B1–B2) + application/approval + linked-partner pricing behind its own gate, with cross-tenant/IDOR/negative tests.
4. **Storefront batch W-S1:** native wholesale surface on the AWJ cart/checkout (new `WHOLESALE_CAPABILITY`, posture from API), then retire the legacy cluster (Batch D of the Spree exit: ~40 of the remaining 52 client references).

Branch `claude/commerce-h6-batch-d` · Base `431f2d875` · Head: see PR. No merge, no deploy, no activation.
