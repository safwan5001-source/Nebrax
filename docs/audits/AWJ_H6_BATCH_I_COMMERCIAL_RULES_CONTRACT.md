# H6 Batch I — Phase 3: wholesale commercial rules — existing behaviour vs proposed contracts

**Nothing here changes accounting, VAT, ZATCA, payment or stock semantics, and no new financial policy is implemented.** Section A is what the system does today (each line pinned by a test). Section B is proposed, needs the owner's decision, and is **not enforced**. Per the repo's rule 6 ("policy is configured, not forced") every proposed rule is a setting with a protective default, never one hard-coded behaviour.

Pinned by `tests/Feature/WholesaleCartCheckoutBoundaryTest.php` → `characterization_*` (7 tests incl. the Batch H price pin) and the existing `blocker_the_cart_and_checkout_contracts_carry_no_tax_minimum_or_terms_fields`.

## A. Existing behaviour (verified by reading the code and by test)

| Area | Today | Evidence |
|---|---|---|
| **MOQ** | No field, no check anywhere in Commerce (cart, checkout, order, product, listing). Quantity bounds are only `1…2,147,483,647` on the cart request. A 1-unit order completes. | Code search (no `min_order`/`moq`/`min_qty` anywhere in `app/`, `database/migrations`, `config`); test `characterization_there_is_no_moq…` |
| **Minimum order amount** | None. A 700-halala order completes. | same test |
| **VAT / tax display** | `CommerceOrder` carries only `total` (lines + delivery). No tax, subtotal or mode column; cart/checkout payloads contain no tax fields. The tenant settings `sales.commerce_price_tax_mode` (default **null/undecided**) and `sales.commerce_invoice_trigger` (default `none`) exist but only gate the **online-payment → invoice** path (PAY-H4-03, closed behind EXT-05); they do not run for COD/pickup orders. | test `characterization_the_order_total_is_the_sum_of_lines_with_no_tax_added`; `CommerceInvoiceOnPayment` |
| **Accounting side-effects of ordering** | None. A wholesale order creates no invoice, payment, journal entry, stock movement or ZATCA artifact (CLAUDE.md Commerce contract 1–2, 6). | test `characterization_a_wholesale_order_creates_no_invoice_payment_or_ledger_entry` |
| **Payment terms / credit eligibility** | `Partner.credit_limit` and `credit_period` exist and `InvoiceService` enforces the limit when a **credit invoice is posted** for a partner. A commerce order has `partner_id = NULL`, so none of it is consulted at order time. A linked partner with a 1-halala limit can place a 3,500-halala order. | test `characterization_partner_credit_terms_do_not_gate_or_shape_a_wholesale_order`; `InvoiceService` credit-limit check |
| **COD / online** | Commerce payment methods are `cod`, `pay_on_pickup` (+ `online` behind its own deployment gate). The wholesale channel offers exactly what any web channel offers; there is no wholesale-specific COD rule. | test `characterization_wholesale_and_dtc_hosts_offer_the_same_payment_methods`; `CommercePaymentIntent::METHODS` |
| **Suspension** | Every cart/checkout/me boundary re-reads membership (404/401/403) so a suspended buyer cannot read prices, edit the cart or complete checkout; order creation re-checks membership under a shared row lock. The cart row is **retained unchanged** (nothing is deleted or expired); reinstatement restores the same cart. In-flight checkout state is not auto-cancelled. | tests `characterization_a_suspended_buyers_cart_is_retained…`, Batch H `a_suspension_blocks_every_cart_boundary…` and PostgreSQL concurrency tests |
| **Attribution** | Orders are owned by the approved identity (immutable), no partner. | Batch H |

## B. Proposed contracts (PROPOSED — each a per-channel setting, default = today's behaviour)

### B1. MOQ
- **Options:** (a) per product per channel; (b) per product globally; (c) per order line vs per order aggregate; (d) also enforce order-quantity *multiples* (case packs).
- **Recommended:** per **product per wholesale channel**, enforced server-side at cart add/update **and** re-checked at checkout completion, with an optional step multiple; default **off** (no minimum). Reject with a stable error code the storefront maps to a localized message; never clamp silently.
- **Needs:** where the value lives (new nullable column on the channel listing), unit semantics for alternative units, behaviour for partial fulfilment.

### B2. Minimum order amount
- **Options:** (a) per channel; (b) per buyer/partner; (c) before vs after delivery fee; (d) tax-inclusive vs exclusive (depends on B3).
- **Recommended:** a single **per-channel** amount in minor units, compared against the **line total before delivery**, enforced at checkout completion (and surfaced early in the cart); default **none**. Tax-basis wording must follow the B3 decision.

### B3. VAT / tax treatment of B2B
- **Today:** undecided; EXT-05 (external tax opinion) gates any invoice on payment; ordering itself shows no tax.
- **Options:** (a) prices **tax-inclusive** like retail; (b) prices **tax-exclusive** with VAT added at invoicing (the usual B2B display, and what ZATCA B2B invoices are issued on); (c) per-buyer treatment (zero-rated/exempt, e.g. exports) — requires tax categories, which REM-12 has not resolved.
- **Recommended:** decide (b) vs (a) first, as a per-channel display setting; do **not** compute or persist tax at order time until the invoice-on-payment/EXT-05 position is settled. Anything other than 15 % standard-rated stays out of scope (REM-12). Do not touch ZATCA.

### B4. Payment terms and credit
- **Options:** (a) none: wholesale pays on COD/pickup/online exactly as retail (today); (b) credit orders allowed for buyers whose linked partner has `credit_limit`/`credit_period`, evaluated at order time against open receivables; (c) credit evaluated only when the order is later invoiced (today's accounting behaviour).
- **Recommended:** keep (a) until the buyer↔partner link is mandatory (D-B3). Then (b) with the existing `credit_limit` semantics, **reserving** against the limit at order creation and releasing on cancellation. Must reuse the accounting credit check (single authority), never duplicate it in Commerce.

### B5. Cash on delivery
- **Options:** allow COD to all wholesale buyers; allow only to buyers without credit terms; disallow for wholesale.
- **Recommended:** a per-channel allow-list of payment methods (the availability service already filters per channel), default = today's set.

### B6. Suspension effects
- **Today** (A above): carts retained, everything blocked.
- **Options:** (a) keep as is; (b) auto-expire carts after N days of suspension; (c) release inventory reservations/holds of suspended buyers' open checkouts.
- **Recommended:** keep (a); add (c) only if wholesale carts begin to hold stock reservations. Document that reinstatement restores the same cart.

## C. Why nothing is implemented in this batch
All of B1–B6 change what a buyer may order or pay, or how money is presented, i.e. a financial/commercial policy. The brief forbids implementing one silently; there is no approved contract; and checkout wiring for wholesale is still deferred (the storefront does not forward the buyer token to cart/checkout), so there is no live path to protect. The characterization tests above are the guard: each fails the day its behaviour changes, forcing an explicit, reviewed decision.

## D. Owner decisions (consolidated with Batch H's list)

| ID | Decision | Recommended |
|---|---|---|
| D-M1 | MOQ scope and multiples | Per product per channel; step multiple optional; off by default |
| D-M2 | Minimum order amount basis | Per channel, line total before delivery; none by default |
| D-X1 | B2B tax display | Decide inclusive vs exclusive per channel; no tax computed at order time yet |
| D-P1 | Credit / terms on orders | None until D-B3 (mandatory link); then reuse the accounting credit check |
| D-P2 | COD for wholesale | Per-channel method allow-list, default unchanged |
| D-S1 | Suspended buyer's open cart | Retain (today) |
