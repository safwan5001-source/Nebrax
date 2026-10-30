# H6 Batch I — Phase 2: B2B pricing precedence matrix

**Status: specification for owner approval. No pricing rule was changed.** Every row marked *EXISTING* is pinned by `tests/Feature/CommercePricePrecedenceMatrixTest.php` (17 tests, SQLite and PostgreSQL). Rows marked *PROPOSED* are not implemented and have no enforcing code.

## 1. The pieces (as they exist)

| Piece | Where | Notes |
|---|---|---|
| Channel default list | `sales_channels.default_price_list_id` | Assignment requires an **active** list of the same tenant (`SalesChannel::saving` throws `DomainException`). It can become inactive later. |
| Partner default list | `partners.default_price_list_id` | Applied only through `PosCustomerPriceListResolver::forPartner()`, which is gated by the **POS** setting `apply_customer_price_list` (default **on**) and requires an **active** list. |
| Buyer ↔ partner link | `customer_partner_links` (≤1 active per identity, created by staff via `CustomerPartnerLinkService`) | Exists in the data model. **No storefront path passes a partner to the resolver**; the order's `partner_id` is `NULL`. |
| Resolver | `CommercePriceResolver::resolve($product, $channel, $partner?, $unit?, …)` | Picks **one list first**, then looks for the item in it. |
| Listing path | `CommercePriceResolver` batched listing method | Channel list → `sale_price`; no partner concept. |
| Provenance | `commerce_order_lines.price_source`, `price_list_id` (DB check constraint) | `price_list` ⇒ list id present; `product_default` ⇒ list id null. `ResolvedCommercePrice::provenanceListId()` returns the list only when it actually supplied the price. |
| Validity | `price_lists` | **No date columns.** "Expired" can only mean `is_active = false` (pinned by m5c). |

## 2. Precedence — what the code does today (EXISTING)

```
1. partner given AND POS toggle on AND partner.default_price_list active  → LIST := partner list
2. else channel.default_price_list (active)                                → LIST := channel list
   (configured but unresolvable in this tenant ⇒ throws; configured but inactive ⇒ no list)
3. if LIST exists: price := item(LIST, product, unit, variant)             → source price_list
4. if no LIST, or LIST has no item: base explicit price (variant/unit) or Product.sale_price → source product_default
5. nothing resolvable → unresolved
```
Note the **selection-before-lookup** property of step 1→3: once a partner list is chosen, a missing item does **not** fall through to the channel list (m1b).

## 3. Matrix (requested scenarios)

| # | Scenario | Result today (EXISTING) | Test | Owner decision |
|---|---|---|---|---|
| 1 | Approved buyer + valid active partner list **with the item** | Partner list price; `source=price_list`; list id = partner list. **But today the storefront never passes the partner**, so a *buyer* gets row 3/4 instead (pinned by the Batch H characterization). | m1; Batch H pin | D-B1 |
| 1b | …partner list active but **lacks the item** | Base product price (channel list ignored); provenance `product_default`, list id not persisted | m1b | **D-B1** (should it fall through to the channel list?) |
| 2 | Approved buyer, **no partner list** | Channel list | m2 | — |
| 3 | Channel list available, item present | Channel list price | m3 | — |
| 3b | Channel list available, item absent | Base product price | m3b | D-B5 (hide / base / unavailable for wholesale?) |
| 4 | No list anywhere | `Product.sale_price` (or explicit variant/unit base) | m4 | — |
| 5a | Partner list inactive | Ignored → channel list | m5a | — |
| 5b | Channel list became inactive | Base product price, **no error** (silent fallback to retail on a wholesale channel) | m5b, m5b2 | **D-B5** |
| 5c | "Expired" list | Not representable: no validity dates | m5c | D-B6 (add `valid_from/to`?) |
| 5d | POS toggle off | Partner lists ignored everywhere | m5d | **D-B2** (wholesale must not depend on a POS setting) |
| 6 | Suspended / unapproved buyer | The resolver has no buyer concept; `EnsureWholesalePriceAccess` refuses **before** pricing (404/401/403), so no price is computed or shown. Existing carts are retained, checkout is blocked. | m6; Batch G/H/I boundary tests | D-S1 |
| 7 | DTC guest | Base price on a channel without a list; unchanged by wholesale | m7; Batch F/G DTC regression | — |
| 8a | Another channel's list | Never applied | m8a | — |
| 8b | Partner from another tenant | Rejected | m8b | — |
| 8c | Channel list reference unresolvable in this tenant | **Fails closed** (exception), never base price | m8c | — |
| 8d | Partner's list belongs to another tenant | Not applied (tenant scope) → treated as no partner list | m8d | — |

## 4. Parity and provenance (EXISTING, from Batches F–H)
Listing, detail, cart and checkout completion resolve through the same resolver; completion re-resolves server-side and records `price_source`/`price_list_id` on each order line, immutable afterwards. Buyer-specific pricing would have to keep that parity across **four call sites**.

## 5. Proposed matrix (PROPOSED — needs owner approval before any code)

Recommended precedence for an **approved wholesale buyer**, evaluated per line, first hit wins:

| Rank | Source | Condition |
|---|---|---|
| P1 | Buyer's partner list **item** | Active `CustomerPartnerLink` → partner `active` customer → list `active` → item exists |
| P2 | Wholesale channel list **item** | Channel list active → item exists |
| P3 | **Unavailable** (not retail) | Recommended for wholesale channels: no item ⇒ the line cannot be added/ordered, rather than silently selling at retail |
| — | `Product.sale_price` | Only for **non-wholesale** channels (unchanged DTC behaviour) |

Rules that go with it: partner list must not depend on the POS toggle (new wholesale-scoped switch, default = today's behaviour = off); an inactive/unresolvable list on a wholesale channel is an operator-visible error, not a silent retail price; link revocation and list deactivation take effect on the next request; the resolved list id is recorded as provenance exactly as today.

## 6. Owner decisions

| ID | Question | Recommended |
|---|---|---|
| D-B1 | Partner list lacking an item: fall through to the channel list, or to base? | Fall through to the channel list (P1→P2) |
| D-B2 | Decouple partner pricing from the POS `apply_customer_price_list` toggle for wholesale? | Yes: a wholesale-scoped setting, default off |
| D-B3 | Who may link a buyer to a partner, and must the link be required before ordering? | Staff-only (as today); not required |
| D-B4 | Roll-out: listing, detail, cart and checkout flip together behind one per-channel setting | Yes, single switch, tested for parity |
| D-B5 | Wholesale channel with no list item / inactive list: base price, hidden, or unavailable? | Unavailable (P3) |
| D-B6 | Add validity dates to price lists? | Not now; manual activation is enough |

Until D-B1…D-B6 are answered, **no implementation**: the Batch G/H pin (`characterization_a_linked_partner_price_list_does_not_change_wholesale_prices_today`) and this batch's m-tests are the safety net and will fail the day behaviour changes without a reviewed decision.
