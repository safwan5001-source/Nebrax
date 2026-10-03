# DELIVERY-DECISION-PASS-2 — Decision Packets DG-6 / DG-8 / DG-9

**Task:** DELIVERY-DECISION-PASS-2
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Nature:** evidence / architecture / documentation only. No production code, migration, API, POS, Hub, pricing, permission, connector, commission, or settlement implementation.
**Base SHA (`origin/main` at start):** `a1bc3769751a919643a335fd4b84ea43c241a221`
**PR:** [#1193](https://github.com/safwan5001-source/Nebrax/pull/1193) (`docs/dlv-decision-pass-2`). Head SHA is the PR head, not restated here, because this commit cannot contain its own hash.
**Prior evidence reused, not re-investigated from zero:** `DLV-EVIDENCE-1-REPORT.md`, `DELIVERY-DECISION-PASS-1-REPORT.md`, `DLV-FOUNDATION-1-IMPLEMENTATION-REPORT.md`, and the DLV-ACCOUNTING-1 code now on this base.

This pass does **not** mark any Owner Decision resolved. Each packet ends with an exact question for Safwan. Recommendations below are **PROPOSED AWJ DECISION**, distinct from **PROVEN REPOSITORY FACT**.

DG-3 is not reopened. Commission VAT, fee VAT, platform tax-invoice treatment, agent/principal status, platform-specific tax point, settlement VAT recovery, and provider-specific ZATCA semantics stay unauthorized.

---

## What changed since Decision Pass 1 (durable facts)

| Fact | Evidence |
|---|---|
| DELIVERY-DECISION-PASS-1 is on `main` | commit `49ecc540a116acc9c503d87c34efeca7fa59cd2d`, PR #1177. The queue text that still said "PR #1177 in_review" was stale on this base. |
| DLV-ACCOUNTING-1 is done | PR #1184 merged; merge SHA `a1bc3769751a919643a335fd4b84ea43c241a221`. Owner task record: `PRE_MERGE_REVIEW: PASS`, `POST_MERGE_REVIEW: PASS`. No deploy. |
| What ACCOUNTING-1 actually shipped | `platform_receivable_clearing` role (legacy `1180`); immutable `delivery_invoice_contexts`; `DeliveryInvoiceContextService::record()`; `payments.delivery_platform_profile_id` clearing branch in `PaymentService::post()`. No POS selector, no Hub, no commission, no settlement, no new permission. |
| What it did not decide | DG-4, DG-6, DG-7, DG-8, DG-9 remain open until an owner decision says otherwise. DG-3 remains a per-platform external-evidence gate. |

`DeliveryInvoiceContext` (`app/Models/DeliveryInvoiceContext.php`) is an accounting pin on an already-posted invoice. Its own comment states `external_order_reference` is informational and is **not** an identity, lookup, or matching key. It is not an operational order inbox.

---

## DG-8 — Delivery channel pricing

### 1. Question

What is the canonical POS item-price precedence today, and must selecting HungerStation / Jahez / Keeta / Mrsool / Ninja / The Chefz change that price in V1?

### 2. Repository evidence

**PROVEN REPOSITORY FACT**

1. Ordinary POS checkout does not read `SalesChannel` at all. `app/Services/Accounting/PosService.php` has no `SalesChannel` use. Price enforcement is `PosService::assertUnitPricesAllowedForPos()` (called from `executeCheckoutWithinTransaction` before `InvoiceService::create`).
2. The POS price authority is `PosCustomerPriceListResolver` (`app/Services/Accounting/PosCustomerPriceListResolver.php`):
   - `forPartner()` returns the partner's `default_price_list_id` only when `PosSettings::appliesCustomerPriceList()` is true and the list is active. Otherwise it returns null.
   - `priceFor()` / `posPriceFor()`: an explicit price-list item wins; otherwise the base sellable price. Alternative UOMs are never derived by multiplying a conversion factor (`posPriceFor` comment and `ProductPricingService` class comment).
3. Base sellable price, independent of price lists, is `ProductPricingService` (`app/Services/ProductPricingService.php`, VAR-PRICE-1):
   - `resolveExplicit()` reads `product_unit_prices` for that product/variant/unit only.
   - `resolveSellable()` for a variant: variant explicit price, else the same unit on the parent product, else no price. No sibling fallback. No cross-unit derivation.
   - `PosCustomerPriceListResolver::priceFor()` falls back to `Product.sale_price` for a simple product base unit, and to `resolveSellable()` when a variant is present.
4. POS catalog display uses the same resolver: `PosCatalogPricePreparer` only bulk-reads explicit `ProductUnitPrice` rows; `PosController` catalog path (comment at the products action) does not invent a channel price. Test `PosCheckoutTest::customer_price_list_reprices_the_pos_catalog_and_is_enforced_before_checkout` proves partner-list price `8500` is shown and enforced, and that turning `apply_customer_price_list` off restores `Product.sale_price` (`100.00`). A mismatched submitted `unit_price` is rejected (HTTP 422) and creates no invoice.
5. Precedence that **does** exist, and where it applies:

   | Layer | POS checkout | Commerce resolver only |
   |---|---|---|
   | Partner default price list | Yes, if `apply_customer_price_list` | Yes, same `PosSettings` gate via `forPartner()` |
   | `SalesChannel.default_price_list_id` | **Not read** | Yes, only if no partner list (`CommercePriceResolver`) |
   | Explicit list item for product/variant/unit | Yes | Yes (`PriceListService::resolve`) |
   | Variant explicit unit price, else parent same unit | Yes (`ProductPricingService::resolveSellable`) | Yes |
   | `Product.sale_price` for simple base unit | Yes | Yes |
   | Alternative UOM without an explicit price | Rejected | Unresolved (`SOURCE_NONE`), never factor-derived |
   | Cashier unit-price override | Only if `PosSettings::allowsUnitPriceOverride()`; otherwise the submitted price must equal the resolver | Not a POS concern |
   | Line discount | Only if `PosSettings::allowsDiscount()` (`PosService::assertDiscountsAllowedForPos`) | Not this pass |
   | Document discount, shipping, adjustment, VAT | `InvoiceService::post()` / `applyDiscount()` / `calcTax()` from stored line rates | Commerce resolver documents tax as absent |
   | Minimum sale price | Enforcement floor in `InvoiceService::minimumPriceDecision()`, permission `sales.minimum_price_override`. Not a price source | Returned as descriptive data only |
   | Promotions | No engine. `ApplicationCatalog` key `sales.promotions` is `coming_soon`. No `PromotionService` under `app/` | Same |

6. Channel-list precedence is proven only inside Commerce. `CommercePriceResolver` class comment (COM-PRICE-1) and `tests/Feature/CommercePriceResolverTest.php`:
   - `a_partner_price_list_remains_higher_priority_than_the_channel_default` (partner 9000 beats channel 13000).
   - `an_anonymous_base_unit_uses_an_explicit_channel_price_list_item`.
   - Inactive or cross-tenant channel lists are rejected or ignored.
   The resolver comment states it is a read-only suggestion and must not become a second financial price store. Historical truth remains the invoice line after `InvoiceService::applyItemsAndTotals()`.
7. Delivery platform setup does not attach a price list. `DeliveryPlatformConfigService::resolveChannelForCreate()` creates `SalesChannel` with `slug`, `name`, `type=external`, `is_active` only. It never sets `default_price_list_id`.
8. Horizon invariant 10 and the out-of-scope line "deriving channel selling prices by adding commission percentage" already separate selling price, expected commission, and settlement deduction (`AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` §§2–3).

**Not proven:** any POS behavior in which a `type=external` channel changes `unit_price`. None exists.

### 3. Existing canonical authority

- Price suggestion before a new POS invoice: `PosCustomerPriceListResolver` + `PriceListService` + `ProductPricingService` + `PosSettings`.
- Financial price snapshot: invoice line written by `InvoiceService`.
- Channel default list: `CommercePriceResolver` only. It is not the POS authority.
- Tax: `InvoiceService` from the product tax rate (`PosService::withAuthoritativeTaxRates` overwrites any client `tax_rate`).

### 4. Options considered

| Option | Meaning | Verdict against evidence |
|---|---|---|
| A. Platform selection does not change price. DLV-POS-1 calls the existing POS resolver unchanged. | Preferred V1 direction | Supported. No contradiction found. |
| B. Point the delivery `SalesChannel.default_price_list_id` at a delivery price list and resolve through `CommercePriceResolver` inside POS. | Would make POS consult an authority it does not use today | Creates a second POS price path. Commerce partner-vs-channel precedence would start affecting cashier sales. Not safe inside DLV-POS-1. |
| C. Store delivery-specific prices on the platform profile or derive them from commission. | New price authority; commission becomes a selling-price input | Contradicts horizon invariant 10 and the "no second pricing authority" rule. |

### 5. Risks

- Treating commission as a markup silently changes the customer's gross sale, VAT base, and ZATCA taxable amount. That is an accounting change, not a UX change.
- Wiring POS to `CommercePriceResolver` would make a later Commerce channel-list edit change in-store delivery tickets without a POS decision.
- A cashier-typed "platform price" would bypass `assertUnitPricesAllowedForPos` unless a new override policy is invented. That expands pricing policy.

### 6. Tenant / branch implications

Price lists, products, and `SalesChannel` are tenant-scoped (`SalesChannel` price-list guard rejects a foreign list). POS checkout already locks the active branch (`PosService::executeCheckoutWithinTransaction`). A platform selection that does not enter the price function cannot cross tenants or branches through pricing. No new branch price dimension is proposed.

### 7. Backward compatibility

Option A preserves current POS cash/card/customer-list behavior exactly, including tenants that never configure a delivery platform. Delivery channels created by FOUNDATION-1 do not carry a default price list, so even the Commerce fallback would be the product price today — but POS must not start depending on that accidental emptiness.

### 8. Recommended AWJ decision

**PROPOSED.** Resolve DG-8 as Option A:

- Selecting a delivery platform does not change the item price in V1.
- DLV-POS-1 reuses `PosService` / `PosCustomerPriceListResolver` / `ProductPricingService` unchanged.
- Platform commission is not a reason to modify the customer's sale price.
- The cashier must not calculate commission or hand-edit the item price because of commission. Existing override and discount switches (`allow_unit_price_override`, `allowsDiscount`, `sales.minimum_price_override`) stay the only exceptions, and they are not delivery-specific.
- A future delivery price list, channel catalog price, or marketplace markup is a separate pricing feature with its own evidence and owner decision. It is out of DLV-POS-1.

### 9. Exact Owner Decision required

**OD-DG-8.** Does Safwan accept Option A above, verbatim, as the V1 pricing rule for DLV-POS-1? Yes or no. A no requires a different packet. This pass does not implement either answer.

### 10. Downstream tasks affected

- **DLV-POS-1** — this gate is one of the two remaining blockers (with the POS slice of DG-9).
- **DLV-COMMISSION-1** — stays a separate expectation policy. DG-8 does not authorize it.
- Later channel-pricing work — explicitly not unlocked.

---

## DG-9 — RBAC / capabilities / permissions

### 1. Question

Does selecting an already-configured delivery platform during a POS sale need a new permission, and does that same answer cover Delivery Hub operations?

### 2. Repository evidence

**PROVEN REPOSITORY FACT**

1. Creating/posting a POS sale is authorized by middleware, not by a role named "cashier":
   - `POST /api/pos/checkout` → `EnsurePermission:invoices.manage` and `EnsureApplicationActive:sales.pos` (`routes/api.php`, checkout route beside the other `pos/*` routes).
   - Same pair guards `GET /api/pos/products`, held sales, and the rest of the cashier sale surface.
   - `Rbac::allows()` is exact-string or `*`. `invoices.manage` does not imply `invoices.view`, and neither implies `company.manage`.
   - System matrix (`app/Support/Rbac.php`): `owner`/`admin` have `*`. `accountant` has `invoices.manage` and `invoices.view` but not `company.manage`. `staff` has `invoices.view` only, so staff cannot checkout. There is no built-in cashier role; a tenant custom role with `invoices.manage` can sell.
2. Delivery platform **configuration** is already split:
   - Read: `GET delivery-platforms*` → `invoices.view` + `sales.pos`.
   - Write: `POST`/`PUT delivery-platforms` → `company.manage` + `sales.pos`.
   - Test `DeliveryPlatformApiTest::only_company_managers_can_mutate_but_viewers_can_read`: staff and accountant can read and receive 403 on create/update; `self_service` cannot read.
   - `DeliveryPlatformConfigService::update()` can change only `collection_mode`, `external_reference_policy`, display names, `logo_asset_key`, `is_active`, and branch overrides. It has no commission, credential, API, settlement, or GL-account field.
3. Accounting role mapping is not on that API. `platform_receivable_clearing` is seeded and resolved through `AccountRoleResolver` / accounting settings. DLV-ACCOUNTING-1 added no HTTP route and no new permission (PR #1184 description: DG-9 left open on purpose).
4. `ApplicationCatalog` has `sales.pos` (`built`, depends on `sales.invoicing`) and no delivery capability key. FOUNDATION-1 recorded that reuse explicitly (`DLV-FOUNDATION-1-IMPLEMENTATION-REPORT.md` §7).
5. Separate POS powers already exist and are not inherited from selling: `pos.variance.approve`, `pos.session.handover.confirm`, `pos.cash_drawer.open`, `pos.audit.*`, `pos.override.approve`, `sales.minimum_price_override`, `products.view_cost`. The pattern in this repo is: add a permission when the action is more privileged than the sale, not when it is another input to an already-authorized sale.
6. No Delivery Hub route, controller, or permission exists. Inventing one in this pass would be an implementation, which is forbidden. Inventing one inside DLV-POS-1 would publish a capability before the Hub action set exists.

**Not proven:** that Hub accept/reject/prepare/cancel is "the same privilege" as picking a platform on an open POS ticket. Those actions do not exist yet, so their privilege cannot be measured.

### 3. Existing canonical authority

- Sale: `invoices.manage` + active `sales.pos`.
- Read configured platforms: `invoices.view` + active `sales.pos`.
- Change platform configuration: `company.manage` + active `sales.pos`.
- GL role administration: existing accounting-settings permissions (`accounting_settings.manage` and related keys in `Rbac::PERMISSIONS`). Not the POS checkout permission.

### 4. Options considered

| Option | Meaning | Verdict |
|---|---|---|
| A. No new permission to **select** an active configured platform on a sale the user can already post. Configuration stays on `company.manage`. Hub is decided later. | Preferred V1 direction for DLV-POS-1 | Supported. Selecting a platform is another sale context, like customer or tender, not a configuration write. |
| B. New `delivery.pos.select` (or catalog key) required merely to pick a platform. | Extra RBAC surface on every cashier sale | Not justified by a privilege difference. A user who cannot sell already fails `invoices.manage`. A user who must not edit mappings already fails `company.manage`. |
| C. One new permission that covers both POS selection and Hub operations. | Couples two different privileges | Rejected. Hub actions are not evidenced as equal to selection. |

### 5. Risks

- A new POS permission would lock out every current seller (`accountant` and custom cashier roles) until someone re-grants it, which is a behavior change unrelated to safety.
- Reusing `company.manage` for selection would force cashiers to be company administrators to pick Jahez. That widens privilege in the wrong direction.
- Leaving Hub implied-authorized by `invoices.manage` would later let a cashier perform operational actions that may include cancellation of another branch's orders or provider calls. That is why Hub is not decided here.

### 6. Tenant / branch implications

Checkout already refuses a missing branch and locks the branch row. Platform reads/writes are tenant-scoped; branch overrides can be written only for branches the actor holds (`DeliveryPlatformConfigService::update`). Selection in DLV-POS-1 must only offer profiles `resolve()` would accept for that tenant and the sale's branch (active version). It must not accept a raw platform id from another tenant. No new isolation boundary is required to express that; it is a filter over the existing resolver. This pass does not build the filter.

### 7. Backward compatibility

No permission string is added or removed. Existing POS roles keep the same sale rights. Delivery configuration remains exactly as FOUNDATION-1 shipped. `self_service` still cannot read platforms. Staff still cannot checkout.

### 8. Recommended AWJ decision

**PROPOSED.** Split DG-9:

- **DG-9-POS — recommend RESOLVE** for DLV-POS-1 only:
  - Do not create a permission merely to select a configured, active delivery platform.
  - A user already allowed to `POST /api/pos/checkout` may select one.
  - That user cannot, by this selection, edit collection mode, branch overrides, display/logo, the `platform_receivable_clearing` mapping, commission, credentials, API settings, settlement policy, or provider configuration.
  - Those edits remain on the existing admin authorities (`company.manage` for the platform profile; accounting-settings permissions for the GL role).
- **DG-9-HUB — remain OPEN.** Delivery Hub operational actions are not authorized by the POS decision. Their capability is a separate owner decision when the Hub action set is real.

### 9. Exact Owner Decision required

**OD-DG-9.** Does Safwan accept the split above: DG-9 resolved for DLV-POS-1 selection only, and explicitly still open for DLV-HUB-1? Yes or no.

### 10. Downstream tasks affected

- **DLV-POS-1** — unblocked on permissions if OD-DG-9 is yes (still needs OD-DG-8).
- **DLV-HUB-1** — still blocked on DG-9-HUB even if OD-DG-9 is yes.
- **DLV-CONNECTOR-CORE-1** — untouched; credentials remain a later security design (DG-7 still open).

---

## DG-6 — Delivery Hub / inventory event

### 1. Question

What currently owns inventory movement and COGS for an ordinary POS sale; can an external delivery order reuse `CommerceOrder`; and what is the smallest Hub representation that does not create a second inventory or accounting authority?

### 2. Repository evidence

**PROVEN REPOSITORY FACT — ordinary POS sale**

1. The sale event is `PosService::checkout` → `InvoiceService::create` then `InvoiceService::post` inside one transaction (`PosService::executeCheckoutWithinTransaction`). The invoice is created as `payment_type=credit`; tenders are separate `PaymentService::post` calls in that same transaction. POS does not pass a custom COGS resolver.
2. `InvoiceService::post` (`app/Services/Accounting/InvoiceService.php`) posts revenue/tax/AR or cash through `LedgerService`, then calls `InventoryService::recordSaleCogs($invoice)` unless the caller passed a resolver. Fuel is the documented special case. POS does not.
3. `InventoryService::recordSaleCogs` (`app/Services/Accounting/InventoryService.php`) is the ordinary sale inventory writer:
   - Skips lines whose product is missing, not `track_inventory`, or non-positive quantity.
   - `assertStockAvailable` then writes `StockMovement` `type=out`, `source_type=Invoice::class`, `source_id=invoice id`, and decrements on-hand / warehouse quantity.
   - Posts Dr `cogs` / Cr `inventory_asset` when total cost is positive, stored as `invoices.cogs_entry_id`.
   - Test path: `InventoryCogsAccountRoutingTest::unmapped_sale_cogs_uses_the_legacy_cogs_and_inventory_accounts` calls `InvoiceService::post` and expects Dr `5110` / Cr `1140`.
4. `InventoryService::applyIssue` moves stock **without** a journal and is for operations whose journal is elsewhere (the method comment cites purchase returns and stocktake corrections). It is not the POS sale path. `recordSaleCogs` writes the movement itself rather than calling `applyIssue`.
5. Printing/preview has no inventory authority:
   - `InvoiceService::post` freezes `thermal_template_revision_id` (and pdf/print revisions) as a snapshot of which template applied. That is not a stock write.
   - `app/Services/PrintTemplates/` contains no `StockMovement` / `applyIssue` / `recordSaleCogs` use.
   - `PosReturnService::quote` is documented as a preview with no write.
   - Horizon locked invariant 9: printing is not an inventory event. This matches the code.
6. `DeliveryNoteService` does not call `applyIssue` or `recordSaleCogs`. An ordinary POS sale does not consume stock through a delivery note.

**PROVEN REPOSITORY FACT — what must not be mistaken for the sale event**

7. `CommerceOrder` (`app/Models/CommerceOrder.php`) is the AWJ Commerce checkout commitment:
   - Status only `draft` or `confirmed`.
   - `CompanyWide`, not branch-owned. Comment: the order follows its channel, not an operational branch.
   - Optional `storefront_id`, unique `commerce_checkout_id`, `customer_identity_id`, snapshot, `CommercePaymentIntent`.
   - Class comment and ADR-01 §2: create/confirm does not recognize revenue, post a journal, or create an invoice.
   - No external-order-reference column.
8. Commerce contract that forbids overloading it (this is the "contract #8" cited by DLV-EVIDENCE-1 / Decision Pass 1):
   - `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` non-negotiable item 9: "Legacy ERP invoice/POS flows are not forced through CommerceOrder in the initial rollout."
   - `docs/plans/store/AWJ_COMMERCE_WEB_APP_EXPERIENCE_STRATEGY.md` §16: POS must not be forced through `CommerceOrder` for conceptual symmetry.
   - `CommerceBoundary::DISTINCT_IDENTITIES` includes `CommerceOrder != Invoice`.
   - `CommerceBoundary::FORBIDDEN_DIRECT_WRITES` forbids Commerce code from writing journals, stock/COGS, ZATCA artifacts, or settlement outside `PaymentService`.
9. Staff `CommerceOrderService::create` accepts a channel id. DLV-EVIDENCE-1 DG-5 made it binding that FOUNDATION-1 add **no** Commerce order path for delivery channels. That is still the case: delivery code creates a `SalesChannel`, not a `CommerceOrder`.
10. Inventory reservation is real and is **not** a stock movement:
    - `InventoryReservationService` class comment: no `StockMovement`, no on-hand change, no `avg_cost` change.
    - `CommerceOrderReservationService` is an explicit call. It is **not** invoked by `CommerceOrderService::confirm`. The class comment says the timing policy (`ON_ORDER_CONFIRMATION` vs `ON_PAYMENT_CONFIRMED`) is deliberately undecided (ADR-02 §5).
    - Test `InventoryReservationServiceTest::no_stock_movement_is_created_across_the_full_lifecycle` (acquire + consume ⇒ `StockMovement` count 0) and `no_valuation_or_avg_cost_mutation_occurs`.
11. ADR-01 §5 lists candidate invoice triggers (`ON_PAYMENT_CONFIRMED`, `ON_FULFILLMENT`, `ON_DELIVERY`) and **does not approve a default**. It says the final set needs accounting, VAT, and ZATCA validation. That is the same family of question as a platform tax point, which DG-3 forbids this pass from deciding.
12. Post-posting reversal authorities, and what each does **not** own:

    | Authority | Owns | Does not own |
    |---|---|---|
    | `ReturnService::post` → `postSalesReturn` | Reversal of sales and output VAT; COGS reversal; restock via `InventoryService::applyReceipt` or damage via `inventory_damage_loss` with **no** stock-in of unsellable goods. Credits AR (`1130`) or cash (`1110`) from the return's `payment_type`. Links to the source invoice and refuses over-return. | Deleting or rewriting the original invoice journal. Platform settlement. |
    | `PosReturnService` | POS session, cash-refund cap, idempotency, audit. Then calls `ReturnService`. Its comment: it has no independent journal or stock logic. | A second reversal engine. |
    | `CreditNoteService::post` | Customer financial credit note through `LedgerService`. Class comment: financial only, **no stock movement**. | Inventory and COGS. |
    | `CustomerRefundService::post` | Cash/bank actually leaving, allocated to a posted credit return or credit note. Comment: a commercial return is not itself a cash refund. | Inventory. `Invoice.paid_amount`. Platform clearing. |

    Test `InventoryCogsAccountRoutingTest` posts a sales return with `restock: false` and expects the damage account `5180`, proving the restock flag is part of the canonical return, not a Hub invention.
13. `DeliveryInvoiceContextService::record` comment: recording does not create an invoice, payment, or journal. The model requires a posted invoice, derives `collection_mode` from the version, and rejects using the external reference as identity. A webhook row cannot be stored by stretching this table.

### 3. Existing canonical authority

- Sale revenue, VAT, AR: `InvoiceService::post` → `LedgerService`.
- Sale issue + COGS: `InventoryService::recordSaleCogs`, called only from that post (or an explicit resolver, which POS does not use).
- Platform pin after a posted invoice: `DeliveryInvoiceContextService::record`.
- Platform-collected AR clearing: `PaymentService::post` when `delivery_platform_profile_id` matches that context (`platform_collected` only).
- Commercial reversal after posting: `ReturnService` (POS entry: `PosReturnService`).
- Cash leaving after a credit reversal: `CustomerRefundService`, only when money actually moves.
- Commerce order / reservation: Commerce checkout only. Not a POS or delivery-platform authority.

### 4. Options considered

**Option A — Reuse `CommerceOrder`.**

- Benefits: one order noun; reservation primitive already exists.
- Risks: the model is CompanyWide checkout state (`draft|confirmed` only), keyed to `commerce_checkout_id` / storefront / customer identity / payment intent. External marketplace orders are not that contract. Master plan item 9 and strategy §16 forbid forcing POS/ERP flows through it. A delivery status machine (received → preparing → handed off → cancelled) does not fit `draft|confirmed`. Putting inventory or COGS here would violate `CommerceBoundary` and ADR-01 §2.
- Tenant: tenant-scoped, but not branch-scoped. A Hub that must be branch-authorized would be sitting on a company-wide aggregate.
- Idempotency: uniqueness is `commerce_checkout_id`, not `(tenant, platform, external order id)`.
- Cancellation: confirmed orders cannot be deleted (historical commercial commitment) and confirming them does not post, so "cancel" is undefined for this lifecycle.
- Accounting: none by design. Reuse would either keep it useless for delivery operations or overload it until it becomes a second invoice.
- Backward compatibility: every Commerce checkout test assumes this shape. Overloading it is a breaking semantic change.
- **Rejected. Evidence contradicts reuse.**

**Option B — Dedicated operational projection / inbox. No accounting authority. No independent COGS authority.**

- Benefits: matches horizon DLV-HUB-1 ("no financial posting authority moves into Hub UI") and invariant 9. Gives API orders a place to be idempotent, routed, accepted, and cancelled before any financial document exists. Manual POS sales that already became invoices stay on `Invoice` + `DeliveryInvoiceContext`; they do not need a fake Commerce order.
- Risks: a second order-shaped table can drift into a shadow invoice if a later task writes stock from it. The decision has to forbid that in the task scope, not by hope.
- Tenant: `tenant_id` from context, never from payload. External ids are not authority (horizon invariant 12).
- Branch: `BelongsToBranch`, same pattern as `DeliveryInvoiceContext` (branch is an explicit routing result, not "whatever branch the webhook process had active").
- Idempotency: unique `(tenant_id, delivery_platform_profile_id, external_order_id)` — **not** `DeliveryInvoiceContext.external_order_reference`, which the model forbids using as identity.
- Cancellation: see the boundary section below.
- Accounting: none on insert/update of operational status. The only sale posting path remains `InvoiceService::post`. After that post, `DeliveryInvoiceContextService::record` pins profile/version/channel/collection mode. The inbox may store the resulting `invoice_id`; it does not become the journal source.
- Backward compatibility: additive table/service later. No change to `CommerceOrder`, POS checkout, or invoice posting in this decision.
- **Recommended architecture.**

**Option C — Do not persist an operational order. Create the invoice directly when the external payload arrives.**

- Benefits: fewer tables; inventory stays on the real invoice path.
- Risks: webhook receipt becomes the financial event. That posts revenue, VAT, COGS, and (if someone also posts the platform payment) clearing before the branch has accepted the order. A cancel-before-cook becomes a financial reversal of a document that should never have existed. Idempotency collapses into invoice creation with no operational state. Provider retries after a business rejection are easy to turn into duplicate invoices. Contradicts the preferred lifecycle "received → validated → routed → accepted → then invoice".
- Accounting: uses the canonical poster, but at the wrong moment, and that moment is a tax-point choice DG-3 does not allow this pass to bless.
- **Rejected as the V1 Hub shape.**

### 5. Risks

- Moving stock on webhook receipt, on print, or on an operational status change creates a second inventory authority beside `recordSaleCogs`.
- Reusing `CommerceOrder` couples Delivery Hub to storefront checkout, customer identity, and payment intents.
- Choosing "invoice on accept" vs "invoice on handoff" vs "invoice on completion" chooses when VAT/ZATCA recognition happens for an external order. ADR-01 left that undecided on purpose. DG-3 forbids deciding the tax point here. See the narrowed remainder below.
- `ReturnService` credits `1110` when `payment_type=cash`. A platform-collected POS invoice is `payment_type=credit` plus a clearing payment. A future reversal must not be "implemented" by deleting the clearing payment or by assuming cash. That work belongs to DLV-REFUND-1, after this architecture is accepted, and it must call the existing services rather than invent a Hub reversal.

### 6. Tenant / branch implications

The inbox, when it is eventually built, has to be tenant-scoped and branch-scoped. `CommerceOrder` fails the branch requirement (`CompanyWide`). `DeliveryInvoiceContext` is branch-scoped but only exists after a posted invoice, so it cannot represent "received, not yet invoiced". Foreign tenant external ids must fail closed the same way FOUNDATION-1 already fails closed on a foreign channel (non-revealing not-found). Branch routing is data, not a client-supplied `branch_id` trusted from the provider.

### 7. Backward compatibility

Option B does not change POS checkout, Commerce checkout, invoice posting, reservation, or the accounting pin shipped in #1184. Ordinary cash/card sales keep moving stock only at `InvoiceService::post`.

### 8. Recommended AWJ decision

**PROPOSED.** Resolve the **architecture** of DG-6 as Option B, and leave the **invoice-trigger clock** open.

Resolved part (recommend Safwan accept):

1. Delivery Hub is an operational projection / inbox. It is not `CommerceOrder` and not `DeliveryInvoiceContext`.
2. Receiving, validating, storing, routing, printing, or changing an operational status does **not** by itself post revenue, clear AR, post COGS, move stock, move cash/bank, create a platform settlement, or fabricate an accounting document.
3. Inventory movement and COGS for the eventual sale stay inside `InvoiceService::post` → `InventoryService::recordSaleCogs`. No Hub-local stock write. No second COGS.
4. The smallest safe representation, when a later task builds it, is a tenant-and-branch-scoped inbox row: platform profile, pinned config version, provider external order id, normalized operational status, preserved provider-native status, branch routing result, nullable `invoice_id` after the canonical invoice exists, idempotency unique on `(tenant, profile, external order id)`. No amounts that accounting will later trust as the gross sale. Gross sale remains the invoice.
5. Cancellation boundary:
   - **Before** a canonical invoice is posted: operational cancellation only. No financial reversal, because no financial posting exists.
   - **After** posting: do not delete or rewrite posted journals, stock movements, or the invoice. The commercial and inventory reversal authority is `ReturnService::post` (POS-originated returns go through `PosReturnService`). `CreditNoteService` is a financial-only alternative and does not move stock. `CustomerRefundService` moves cash only when a real cash refund exists; it is not the stock authority and is the wrong tool for a platform-collected clearing reversal. How platform-clearing payments reverse is **not** decided here (DLV-REFUND-1 / settlement), beyond "use existing services; do not rewrite history".

Not decided, and **must not be treated as decided**:

- **DG-6-TRIGGER.** Which operational moment, if any, may call `InvoiceService::post` for an API-ingested order (accept vs handoff vs completion vs never inside Hub V1). Repository evidence proves only that the post is the inventory/COGS/revenue event for a sale that already exists. It does not prove which kitchen/courier moment is that sale. ADR-01 refused a default. DG-3 forbids a tax-point guess. Webhook receipt and printing are proven non-candidates. The positive choice among the remaining business moments is an owner decision with VAT/ZATCA consequences, not an inference from filenames.

### 9. Exact Owner Decision required

**OD-DG-6.** Does Safwan accept Option B and the cancellation boundary above, while explicitly leaving DG-6-TRIGGER open? Yes or no.

Accepting this does **not** authorize DLV-HUB-1 to create invoices, and it does **not** choose a tax point.

### 10. Downstream tasks affected

- **DLV-HUB-1** — architecture stops being "CommerceOrder vs inbox vs invoice-on-receipt". It stays blocked (see matrix) on DG-9-HUB and on DG-6-TRIGGER if the task would post invoices. A projection-only Hub still needs the Hub permission decision.
- **DLV-REFUND-1** — must call `ReturnService` / existing refund services after posting; must not invent a delete. Still depends on Hub plus accounting, and on the trigger that was left open.
- **DLV-CONNECTOR-CORE-1** — webhooks may only upsert the future inbox idempotently. They must not post. DG-7 (connector security) stays open and is untouched.

---

## Cancellation / refund boundary (explicit)

| Case | Financial documents exist? | Allowed effect | Forbidden effect |
|---|---|---|---|
| A. External order cancelled before canonical invoice posting | No | Operational status only | Fake credit note, fake return, stock reversal, clearing reversal |
| B. External order cancelled after canonical invoice posting | Yes | `ReturnService` (via `PosReturnService` when the sale was POS) for sales/tax/COGS/stock. Cash out only through `CustomerRefundService` if cash actually left. | `DELETE`/rewrite of posted `journal_entries`, `stock_movements`, or the invoice. Hub-local COGS. Using `CreditNoteService` as if it restocked (it does not). |

DG-3: nothing here decides whether a platform-collected reversal also reverses commission, fee VAT, or a settlement component. Those documents do not exist yet.

---

## DG-3 boundary (preserved)

Unchanged from Decision Pass 1 and from the #1184 implementation:

- Legal/tax role of each platform stays UNKNOWN until that platform's contract is in evidence.
- No commission VAT, fee VAT, tax invoice treatment, agent/principal status, tax point, settlement VAT recovery, or provider ZATCA semantics are decided or recommended here.
- DG-6-TRIGGER is left open specifically so this pass does not smuggle a tax point in through "when the invoice posts".

---

## Dependency matrix

Statuses below are **after this evidence pass and before Safwan answers**. A recommendation is not readiness. ACCOUNTING-1 being merged does not promote its children by itself.

| Task | Current status | Blocking gates | If the owner accepts this pass's recommendations |
|---|---|---|---|
| DLV-POS-1 | **DECISION_REQUIRED** | OD-DG-8 and OD-DG-9 (POS slice). DG-2 is already resolved. FOUNDATION-1 and ACCOUNTING-1 are merged but POS-1 does not need the clearing posting in order to be specified; it must not invent price or permission behavior. | **Becomes the next implementation candidate (READY)** for a manual selector that reuses current POS price resolution, adds no permission, and does not post commission. Not started by this PR. |
| DLV-HUB-1 | **DECISION_REQUIRED** | OD-DG-6 (architecture) still unanswered. Even after a yes: **DG-9-HUB remains OPEN**, and **DG-6-TRIGGER remains OPEN**. | Architecture is fixed (Option B). Hub is **not** READY. A projection-only slice would still need a Hub capability decision. Any slice that creates invoices stays blocked on DG-6-TRIGGER (tax point / DG-3). |
| DLV-COMMISSION-1 | **BLOCKED** | ACCOUNTING-1 dependency is now met (PR #1184). Promotion is still refused: contractual calculation base, fee VAT, and commission VAT are **EXTERNAL_EVIDENCE_REQUIRED** under DG-3. Horizon text also keeps commission separate from channel price (DG-8 does not unlock it). | No change. Still not READY. |
| DLV-SETTLEMENT-1 | **BLOCKED** and **EXTERNAL_EVIDENCE_REQUIRED** | Needs COMMISSION-1's expectation policy plus per-platform DG-3 contract evidence (fee, fee-tax, settlement VAT). ACCOUNTING-1's clearing account is necessary and not sufficient. | No change. Still not READY. |
| DLV-REFUND-1 | **BLOCKED** | Needs a posted-invoice reversal design on top of `ReturnService` and a Hub (or POS) linkage. DG-6-TRIGGER open. DG-3 settlement reversal not evidenced. | Cancellation *boundary* is written down. Implementation still not READY. |
| DLV-CONNECTOR-CORE-1 | **BLOCKED** | DG-7 untouched. Hub inbox does not exist. | Webhook rule is written down (idempotent inbox only). Implementation still not READY. |
| DLV-CLOSE-1 | **BLOCKED** | DG-4 untouched (close/Z-report vs physical tender). Also needs POS-1. | No change. |

No task is promoted to READY by this pull request.

---

## Checks

Documentation-only change. Repository policy (`QUALITY-GATES.md` Gate 5, low risk) does not require the PostgreSQL application suite for a docs-only decision pass. The task forbids that suite and forbids implementation tests.

Static checks performed locally before the PR:

- Diff limited to `docs/plans/pos/DELIVERY-DECISION-PASS-2-REPORT.md`, `docs/autonomous-engineering/TASK-QUEUE.md`, `docs/autonomous-engineering/CURRENT-STATE.md`.
- No application code, migration, generated artifact, or secret.
- Cited paths exist on the base SHA (services, tests, ADRs, prior reports).

CI is recorded in the PR conversation after the push. This document does not claim GitHub CI is green until that observation exists.

---

## PRE_MERGE_REVIEW

**PRE_MERGE_REVIEW: NOT RECORDED.**

This PR is waiting for Safwan's owner decisions. It must not be merged as if the recommendations were already accepted, and a PASS stamp is invalid until the exact Head SHA, review, and required CI are observed. No deploy.

**Next READY task:** none, until OD-DG-8 and OD-DG-9 are accepted. If both are accepted, the next implementation task is **DLV-POS-1** only, in a separate PR. Do not start it from this pass.
