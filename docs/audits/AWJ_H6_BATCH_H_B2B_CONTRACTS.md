# H6 Batch H — B2B contract foundation: attribution (built), buyer pricing (specified), policy matrix (owner decisions)

Nothing in sections 2–3 is enforced or activated. Section 1 is implemented and tested.

## 1. Buyer attribution on orders — IMPLEMENTED
**Contract.** On a wholesale-flagged channel, an order's owner (`commerce_orders.customer_identity_id`) is the verified, approved buyer
whose request created it — taken from the server-side `CustomerContext`, never from input.

| Layer | Mechanism | Evidence |
|---|---|---|
| Identity | `EnsureWholesalePriceAccess` (flagged channels only) runs the three buyer checks (valid token → bound to this host's channel → `approved` membership read fresh) and, only then, establishes `CustomerContext(tenant, identity, partner=null)` for the request; context removed afterwards | `WholesaleCartCheckoutBoundaryTest` (16) |
| Cart | existing `CommerceCartService` machinery: the cart is owned by the identity (one active cart per tenant+channel+identity, DB-unique); a cart token is useless to any other bearer (another approved buyer gets their own cart; anonymous is gated) | `a_cart_token_is_useless_to_any_other_bearer…`, `the_order_and_cart_are_attributed…` |
| Order | `CommerceOrderService::createFromCheckout` stamps `customer_identity_id` from the context; **inside the order transaction** it re-reads the membership with a shared row lock and refuses anyone not `approved` (a concurrent suspension either commits first → refused, or waits for the order's commit); a wholesale-channel order without an owner is refused | `the_order_transaction_itself_refuses…` |
| Immutability | `CommerceOrder::updating` refuses any change of `customer_identity_id` (no rewrite, no later claim of a guest order) | `an_orders_owner_is_immutable…` |
| Forged input | `customer_identity_id`, `partner_id`, `tenant_id` in the request are rejected (422) and never used | `client_supplied_buyer_or_partner_ids…` |
| Scope | DTC / guest / mobile flows untouched: a buyer token on a DTC host attributes nothing; guest orders stay guest | `a_buyer_token_on_a_dtc_host…`; full order/checkout/cart suites green on SQLite and PostgreSQL |
| Not touched | accounting, VAT, ZATCA, payment capture, order lifecycle; no migration needed (the column already existed) | — |

`partner_id` stays NULL: no ERP partner is linked or inferred (see §2).

## 2. Buyer-specific pricing — SPECIFIED, NOT IMPLEMENTED
### 2.1 Existing pieces and exact mapping
```
CustomerIdentity ──(WholesaleMembership: tenant, sales_channel, status=approved)──► access to the channel's prices
CustomerIdentity ──(CustomerPartnerLink: tenant, status=active, ≤1 active per identity; created by staff via CustomerPartnerLinkService)──► Partner (type customer|both, active)
Partner.default_price_list_id ──► PriceList (active, same tenant; TenantScope)
SalesChannel.default_price_list_id ──► PriceList (the channel list, already live since Batch F)
```
### 2.2 Why it is not implemented
1. **Ambiguity today:** `CommercePriceResolver` takes a partner id and resolves the partner list through `PosCustomerPriceListResolver`, which is **gated by the POS setting `apply_customer_price_list`**. Passing a partner would let a POS toggle silently govern wholesale prices (explicitly flagged in Batch D). A wholesale-specific resolver, independent of POS settings, is required.
2. **No assignment surface:** `CustomerPartnerLinkService` exists but no staff endpoint/UI creates links; nothing could configure the feature.
3. Four call sites would need the same partner input for parity (listing `browsePrices`, detail, cart, checkout revalidation) plus `EffectivePriceOrdering` for sorting.
**A contract pin is in place:** `characterization_a_linked_partner_price_list_does_not_change_wholesale_prices_today` fails the day any path starts using the partner list.

### 2.3 Proposed precedence (for owner approval)
For a request on a **wholesale-flagged channel** by an **approved** buyer:
1. the buyer's partner list — only if there is an active `CustomerPartnerLink` to an active customer-type partner whose `default_price_list_id` is an active, same-tenant list **and** a channel setting enables it (default OFF);
2. else the channel list (current behaviour);
3. else the product's base unit price.
Lists are chosen **whole** (as `resolve()` does today: a missing item in the chosen list falls to the base price, not to the next list). Never: client-supplied buyer/partner ids; any other tenant/channel; any price before approval (the gate already ensures it). Provenance: unchanged (`price_source=price_list`, `price_list_id` = the list that supplied the price).
### 2.4 Owner decisions needed
D-B1 enable per-buyer lists at all? · D-B2 per-item fallback to the channel list when the partner list lacks the item (changes "whole list" rule) vs base price · D-B3 staff UI/endpoint + audit for linking buyers to partners · D-B4 which setting gates it (channel flag recommended, not the POS toggle).

## 3. Wholesale policy matrix (no business defaults invented; nothing enforced)
Evidence = what the code does today. "Where" = the single place enforcement would live.

| Topic | Today (evidence) | Options | Recommended default (when enabled) | Where |
|---|---|---|---|---|
| **VAT / tax treatment (B2B)** | Cart/checkout payloads carry no tax field; order total = Σ line totals + delivery; invoice-on-payment requires `sales.commerce_price_tax_mode = inclusive` and only the 15 % rate (EXT-05 tax opinion pending); Storefront `TAX_PRESENTATION_CAPABILITY = deferred` | (a) prices VAT-inclusive, show "incl. VAT" (b) prices VAT-exclusive + VAT line at checkout (c) per-buyer treatment (zero-rated/export/exempt) | (a) for launch: it is the only mode the existing invoice path supports; (b)/(c) need the approved tax scope | order creation + invoice-on-payment; display in cart/checkout serializers |
| **Minimum order quantity (MOQ) / pack multiples** | none in `CommerceCartService`/`revalidateAndPrice` (quantity only ≥ 1) | per product · per price-list item · per channel | per price-list item (`min_qty`, `multiple`) so wholesale terms live with wholesale prices | `revalidateAndPrice` + cart line validation; UI message |
| **Minimum order amount** | none | per channel · per buyer · per list | per channel (single number, minor units, excl. delivery) | checkout completion (`review_required`) |
| **Payment terms / credit eligibility** | no credit/terms model; payments are cash-settlement (COD/pickup) or online intent | pay-now only · net-N terms per buyer with credit limit (AR exposure, aging, ZATCA credit implications) | pay-now only until an accounting-approved credit model exists | accounting + checkout (not this batch) |
| **COD / online payment eligibility** | COD/pay-on-pickup derived from delivery method; online only when a gateway-linked method is enabled for the channel (`PaymentMethodChannelAvailabilityService`) | allow all channel methods · restrict wholesale to online/bank only | restrict COD for wholesale until terms exist (COD at wholesale values is a cash-handling risk) — owner decision | per-channel method availability (already per-channel) |
| **Buyer suspension effect on existing carts** | membership re-read on every request: suspended ⇒ cart/checkout/catalogue all 403; the cart row is held (not deleted) and returns on reinstatement; an in-flight completion is refused inside the order transaction | hold (current) · expire after N days · delete on suspension | hold (current): reversible, no data loss; add TTL cleanup later | already enforced; pinned by `a_suspension_blocks_every_cart_boundary…` and `the_order_transaction_itself_refuses…` |

### Owner decisions required (consolidated)
D-T1 tax mode for wholesale (a/b/c) · D-M1 MOQ/multiples location · D-M2 minimum amount scope · D-P1 payment terms/credit (model + accounting sign-off) · D-P2 COD allowed for wholesale · D-S1 suspended-cart retention · D-B1…D-B4 (§2.4) · D-I1 client-IP strategy (P0a record) · D-V1 verification-link lifetime (24 h default, configurable) and resend gap (60 s).
