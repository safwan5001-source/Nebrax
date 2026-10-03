# ADR-18 — Commerce Product-backed Add-ons (FLOWERS-ADDONS-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H6
**Date:** 2026-10-03
**Scope:** shared Commerce merchandising/cart — not Flowers-only

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- Every sellable thing is a real `Product`/`ProductVariant` with server-resolved price (`CommercePriceResolver`), publication (`CommerceListing`), ATS and reservation (`AvailableToSellService`, `CommerceOrderReservationService`). A "fake free-text price layer" is explicitly rejected (`AWJ_FLOWERS_GIFTS_VERTICAL_V1.md` §6).
- Cart identity is the partial-unique pair (cart, product, [variant], unit, `personalization_signature`) — ADR-16. Checkout revalidates every line; orders snapshot lines and reserve stock per line.
- Related-product UI exists but is *not* a transactional contract (audit §23).

**EXTERNAL EVIDENCE** — FNP shows add-ons (chocolate, balloon, vase, card) as separately priced items chosen on the product page; Shopify models "add a gift" as ordinary line items.

## 2. Decision (AWJ DECISION)

- An add-on is **an ordinary product (or one specific variant) the merchant explicitly links to a parent product**: `commerce_product_addons(product_id → parent, addon_product_id, addon_variant_id?, max_quantity, sort_order, is_active)`, `unique(product_id, addon_product_id)`. Eligibility is **explicit per parent** in V1; category/occasion-wide eligibility is deferred (INFERENCE: an explicit list is sufficient and auditable).
- Admin API `GET/PUT products/{id}/addons` (atomic whole-set replace; `products.view` / `products.manage`). Linked products must belong to the tenant, be active, differ from the parent, and a variant-managed add-on must name its variant. Linking never changes the add-on product itself.
- **Cart representation = separate lines** (no embedded price): each add-on is its own `commerce_cart_items` row tied to its parent line through `parent_item_id` (FK, cascade) with `per_parent_quantity` (1…`max_quantity`). The add-on line's quantity is **always** `parent.quantity × per_parent_quantity`, recomputed whenever the parent quantity changes; removing the parent removes its add-ons. Add-on lines are keyed `personalization_signature = 'a:<parent line id>'` so two parent lines never share an add-on line; the parent's own signature folds in the add-on selection so "bouquet + chocolate" and "bouquet" are different lines.
- Price is whatever `CommercePriceResolver` resolves for the add-on — the client sends **product ids and per-parent quantities only**. Availability and publication use the same eligibility path as any line.
- **Checkout revalidation**: add-on lines are revalidated like any line (price, stock, listing) **plus** the relationship is re-checked (still defined, still active, within `max_quantity`) and the parent line must still exist. Failure → review-required (`addon_unavailable`), no order.
- **Order**: add-ons are separate `commerce_order_lines` linked by `parent_line_id` (additive nullable FK) so fulfilment can group them; totals are the plain sum of lines (no new accounting authority). Public order lines expose `line_id` on a parent and `line_id` + `addon_of` on its add-ons; ordinary lines are unchanged.

## 3. Rejected / Not adopted

- Free-text or client-priced add-ons; a JSON add-on list on the cart item or order line.
- Embedding add-on price into the parent line (breaks per-line stock, tax and invoice mapping).
- Category/occasion-wide eligibility rules in V1; add-on-only checkout flow; bundles (G1, evidence-gated).

## 4. Consequences

- Add-ons reuse every existing stock/price/tax path; invoicing continues to follow the existing Commerce Order → Invoice boundary (ADR-01) per line.
- Generic products without add-ons: no relationship rows, no `parent_item_id`, byte-identical cart/order payloads.
- Cart core change is additive (two nullable columns + rebuilt behaviour for lines with a parent); guarded by cart/merge/checkout suites on SQLite and PostgreSQL.

## 5. Unknown / deferred

Bundle/kit accounting allocation (G1), automatic upsell rules, add-on-specific personalization, per-add-on delivery restrictions.
