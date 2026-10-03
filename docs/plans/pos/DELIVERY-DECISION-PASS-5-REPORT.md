# DELIVERY-DECISION-PASS-5 — DG-8-IMPORT price authority

**Task:** DELIVERY-DECISION-PASS-5
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Nature:** evidence / architecture / documentation only. No production code, migration, API, Hub change, webhook, connector, price rule, permission string, invoice, payment, VAT, COGS, stock movement, POS session, commission, settlement, reconciliation, or refund.
**Base SHA (`origin/main` at start):** `f875467428014b86faa082ca467d41df8d8f340a`
**That SHA is the squash of PR #1204 (DLV-PLATFORM-LOGOS-1).** This file does not embed its own commit hash.

**DG-8-IMPORT is not accepted.** The recommendation below is Option B. It becomes a decision only if Safwan accepts **OD-DG-8-IMPORT**. This pass does not build the financial command.

Not reopened: OD-DG-8 (manual POS price), OD-DG-9-POS, OD-DG-9-HUB, OD-DG-6, OD-DG-6-TRIGGER, OD-HUB-STATES, OD-HUB-IDENTITY, DG-1, DG-2, DG-5.

Not decided here: DG-3 (agent/principal, tax point, who owes VAT, commission VAT), DG-4, DG-7, connectors, settlement, commission, reconciliation, refunds.

---

## 1. Evidence

Read on this base. Not a second delivery investigation.

| Authority | Fact used |
|---|---|
| OD-DG-8 (Pass 2) | Selecting a platform on a manual POS sale does not change the item price. Authority is `PosCustomerPriceListResolver` + `ProductPricingService`. `PosService::assertUnitPricesAllowedForPos` rejects a submitted unit price that is not that resolver's price unless `allowsUnitPriceOverride()` is on. `withAuthoritativeTaxRates` overwrites a client tax rate with the product rate. Commission is not a markup. |
| Pass 3 §15 | Imported/connector price authority was left as **DG-8-IMPORT**, open. Using the live AWJ catalog can disagree with what the platform collected. Using a provider unit price can bypass the POS price list, the minimum-price permission, and the catalog tax rate. The projection does not price anything. |
| OD-DG-6-TRIGGER (Pass 3 §8) | The only future financial transition is an explicit command: `InvoiceService::create` + `InvoiceService::post`, then `DeliveryInvoiceContext`, then platform clearing or merchant-collected with no invented tender. Building it stays blocked on this gate. `received` and `unrouted` cannot post. |
| OD-HUB-IDENTITY (Pass 4) | Identity is `tenant_id + delivery_platform_profile_id + provider_order_id`, permanent. Cancel does not release it and does not insert a successor. Same identity + different checksum conflicts. |
| `DeliveryHubOrder` / `StoreDeliveryHubOrderRequest` | The projection stores no money column. `intake_payload` is an opaque array of at most 50 keys. Its hash is part of the intake checksum so a changed blob conflicts. Pass 4 already says amounts inside that blob are not a price. |
| `InvoiceService` | Drafts can be rebuilt. `update()` throws `لا يمكن تعديل فاتورة مرحّلة` once `isDraft()` is false. `applyItemsAndTotals` trusts the `unit_price`, `discount`, `tax_rate`, and `tax_inclusive` it is given, then computes tax in integer halalas. `post()` writes the journal, stock, and COGS from those stored figures. `minimumPriceDecision` can still reject a line. |
| `DeliveryInvoiceContext` | Append-only side row on a **posted** invoice. Not a party, not a price, not a settlement amount. `collection_mode` is copied from the version/override. `external_order_reference` is display-only. Updating or deleting the row throws. |
| `CommerceOrderService::createLine` | Commerce resolves a live channel/partner price and stores `unit_price` / `line_total` on the line. DG-6 already says the Hub is not a `CommerceOrder`. This is a snapshot pattern, not the import authority. |
| `CreditNoteService` | A later correction is a new document. It is not an edit of a posted invoice. No delivery-specific credit-note path exists, and this pass does not add one. |
| Horizon invariant | Selling price, expected commission, and settlement deduction are different amounts. Net settlement is not a sale price. |

---

## 2. Current AWJ invariants

These already hold and this recommendation does not weaken them.

- Manual POS price stays OD-DG-8. This gate is not a channel price list and does not enter `PosService`.
- The Delivery Hub projection is not an accounting authority. Intake, route, accept, prepare, ready, handoff, and cancel-before-post still post nothing.
- `InvoiceService::post` is the only posting authority for a future imported sale. The Hub must not write journals, VAT, COGS, stock, or clearing.
- A posted invoice is frozen. A correction, if ever built, is a credit note, not a silent rewrite.
- `DeliveryInvoiceContext` is immutable evidence of platform, version, collection mode, and display reference. It is not a price store.
- Money is integer halalas. Tax is `calcTax` (exclusive, half-up) or `extractTax` (inclusive). Header discount uses largest-remainder allocation. No float.
- Tenant scope fails closed. The future command's branch is the order's routed branch, not the caller's active branch (Pass 3 §8).
- One operational identity posts at most one invoice. A retry returns that result. A changed commercial payload conflicts.

---

## 3. Options

| Option | Meaning |
|---|---|
| **A. Reprice from the current AWJ catalog** | At the financial command, ignore the provider's commercial numbers and write `PosCustomerPriceListResolver` / `ProductPricingService` prices, as POS does today. |
| **B. Frozen provider commercial snapshot** | The commercial price of that order is the provider snapshot frozen at intake. AWJ checks that the snapshot is complete, mapped, and internally consistent, then `InvoiceService` posts those figures. A later catalog edit does not reprice it. |
| **C. Hybrid** | Use the catalog when it matches, and the provider price, or an invented discount, when it does not. |

---

## 4. Failure modes

**A**

- A platform price that is not the current AWJ price becomes a different sale from the one the customer placed (case 2).
- A catalog or price-list edit between intake and post silently changes a historical order (case 9 and case 13). That breaks the invariant.
- A merchant-funded discount and a platform-funded discount collapse into "AWJ price versus something".
- It looks safer for the minimum-price floor only because it refuses the commercial price. The document is then commercially wrong.

**B**

- The POS price list is not consulted. That is intentional: this path is not `PosService::checkout`. The minimum-price floor inside `InvoiceService` still applies and fails closed.
- A provider payload that contains only a net settlement, or that omits payer attribution, cannot post. The command rejects. It must not guess.
- A provider tax figure that AWJ's own formula cannot reproduce cannot post. No plug figure is invented. Whether that mismatch is a legal VAT question stays DG-3.
- Today's opaque `intake_payload` is not this snapshot. The command cannot be built until a typed snapshot exists. This pass does not add it.

**C**

- Two authorities. Which one wins can change when the catalog changes, so replay is not stable.
- The gap between catalog and provider price gets recorded as a discount that nobody funded. That is an invented discount.
- Equal prices hide the hybrid. The first unequal order changes the rule without a new decision.

---

## 5. Recommended architecture

**Recommend Option B. Not accepted.**

The commercial authority for an imported HungerStation, Jahez, Mrsool, Keeta, Ninja, or The Chefz order is a typed provider snapshot frozen at intake. `InvoiceService` later posts that snapshot. It does not ask the live catalog what the order should have cost.

The live catalog is used only to map a line onto a tenant product, variant, and UOM, and to know the product's current tax rate so a mismatch can fail closed. It is not a price source for this path.

The Hub still does not post. The snapshot is evidence on the operational order. Journals exist only after the explicit command calls `InvoiceService`.

OD-DG-8 stays the rule for a cashier sale. Option B does not create a delivery price list and does not change POS.

---

## 6. Authoritative snapshot fields

Not a schema and not a migration. These are the fields a future command is allowed to treat as commercial authority. Anything else in a provider payload is evidence or is ignored.

Order:

| Field | Role |
|---|---|
| `tenant_id` + `delivery_platform_profile_id` + `provider_order_id` | Identity. Already accepted. Not a price. |
| `currency` | Must be the tenant currency. Anything else rejects the command. |
| `tax_inclusive` | Explicit. Copied onto the invoice. Never inferred from which number is larger. |
| `provider_tax_minor` | Optional evidence of the tax the provider stated for the order. Not a second tax engine. |
| `net_settlement_minor` | If a payload contains it, it is **not** a selling price and is not copied to an invoice line, a discount, or a total. Settlement remains unbuilt. |

Each commercial line:

| Field | Role |
|---|---|
| `provider_line_id` | Stable line identity inside the order. Part of the checksum. |
| `provider_sku` and provider item name | Evidence only. Not a mapping. |
| `product_id`, `product_variant_id`, `unit` | AWJ mapping. Required before post. |
| `quantity` | The ordered quantity, in the document quantity form `InvoiceService` already accepts. |
| `gross_unit_price_minor` | Provider's stated unit price before a merchant-funded discount. This is the invoice `unit_price`. |
| `merchant_funded_discount_minor` | Explicit merchant-funded amount for that line. This is the invoice line discount. Absent means zero. |
| `platform_funded_discount_minor` | Explicit platform-funded amount. Stored on the snapshot only. Not an invoice discount and not revenue. |
| `customer_payable_minor` | What the customer paid or owes for that line. A consistency check, not the merchant's revenue. |
| `catalog_unit_price_at_intake_minor` | Optional evidence of the AWJ price observed at intake. Never posted. Never used to reprice. |
| `product_tax_rate_at_intake` | The product's `tax_rate` observed at intake. Evidence for the fail-closed tax check. Not a legal tax-point claim. |

A modifier or variant that the provider prices separately is its own line. Its price is not rebuilt by adding AWJ modifier prices onto a parent.

---

## 7. Validation rules

All fail closed. No partial invoice.

1. Snapshot present, typed, and unchanged since intake. The financial command cannot submit a different price.
2. Currency is the tenant currency.
3. `tax_inclusive` is explicit.
4. Every line is mapped. One unmapped line rejects the whole command.
5. Quantity is positive and representable by the existing document quantity rules. A fractional provider quantity that those rules cannot store is a reject. It is not rounded into a nearby integer.
6. `gross_unit_price_minor` is zero or positive. A negative price is a reject, not a discount.
7. `merchant_funded_discount_minor` is zero or positive and does not exceed the line gross. It is not inferred.
8. `platform_funded_discount_minor` is zero or positive. It is not subtracted from the invoice.
9. If `customer_payable_minor` is present: `(quantity × gross_unit_price_minor) − merchant_funded_discount_minor − platform_funded_discount_minor` must equal it exactly, in halalas. Otherwise reject. Do not insert a plug. Fractional quantity lines use the existing precision gross, not a new formula.
10. If `provider_tax_minor` is present: it must equal the tax `InvoiceService` would compute from the commercial lines, the explicit `tax_inclusive` flag, and the frozen product rate. Otherwise reject. Do not post a different VAT to force the provider figure.
11. At post, the product's current `tax_rate` must still equal `product_tax_rate_at_intake`. If the catalog tax rate changed, reject. Do not choose the old or the new rate silently. A legal override of that reject is DG-3, not this gate.
12. `InvoiceService::minimumPriceDecision` still runs. A commercial unit price below the floor fails unless the existing `sales.minimum_price_override` permission is used. No delivery bypass.
13. `net_settlement_minor` is ignored for every check above.
14. Tenant and branch rules from Pass 3 §8 stay. A foreign id does not resolve. The order's branch is not replaced by the caller's branch.

---

## 8. Mapping rules

- One provider commercial line becomes one invoice line.
- Mapping is identity only: product, variant, UOM. The mapped product's current sell price is not copied.
- An unmapped SKU, an unknown variant, or a modifier that cannot be its own mapped line rejects the command. The operational order may remain unposted.
- A descriptive invoice line with no product is not allowed on this path. POS allows a product-less line. An imported order does not, because there is then no tax rate and no stock identity to check.
- Display names on the invoice stay the product snapshot `InvoiceService` already copies. The provider's item name is evidence on the delivery snapshot, not a second description authority.
- `catalog_unit_price_at_intake_minor` may differ from `gross_unit_price_minor`. The difference is not a discount, not revenue, and not VAT.

---

## 9. Rounding

AWJ arithmetic stays the integer rules already in `InvoiceService`:

- Exclusive tax: `calcTax` = half-up halalas (`intdiv(base * rate + 50, 100)`).
- Inclusive tax: `extractTax`.
- Header discount, if a future snapshot has one, uses the existing largest-remainder allocator. This recommendation puts merchant-funded discount on the line, so no header discount is required to explain a provider gap.

If the provider states a line total, a customer payable, or a tax total, it must equal that formula applied to the snapshot exactly. There is no one-halala tolerance and no rounding item. A stated figure AWJ cannot reproduce rejects the command. No rounding revenue line, no rounding expense line, and no invented discount.

Quantity is not a rounding input. See §7.5.

---

## 10. Discount payer attribution

Three amounts stay separate.

| Amount | Where it goes | Where it must not go |
|---|---|---|
| Gross unit price | Invoice `unit_price` | Not reduced by settlement |
| Merchant-funded discount | Invoice line `discount`. It reduces the merchant's taxable base through `applyDiscount` / the line path that already exists | Not mixed with platform funding |
| Platform-funded discount | Snapshot evidence only | Not an invoice discount, not revenue, not VAT, and not a settlement posting |

Absent payer means zero. It does not mean "the remainder between the catalog and the provider". A shared discount must arrive already split into the two payer fields. If the provider sends one unlabeled discount, the command rejects. Splitting it by guess would invent a payer.

Customer payable is the check figure for what the customer saw. Merchant revenue for the invoice is gross minus merchant-funded discount only. Those two totals are allowed to differ by exactly the platform-funded amount. That difference is not posted here.

---

## 11. Idempotency and replay

- The commercial snapshot is inside the intake checksum. Same identity + same snapshot is a replay and returns the same operational order.
- Same identity + a different snapshot conflicts. It does not update the frozen order and does not create a successor. OD-HUB-IDENTITY already forbids a successor after cancel.
- A catalog price change after intake does not change the checksum and does not change a later post. Replay still posts the snapshot.
- The financial command's idempotency key is the operational order, not a new provider id. First success creates one invoice, one context, and the clearing effect Pass 3 already specified. A retry with the same snapshot returns that result.
- A retry that presents a different snapshot conflicts even if the first attempt failed before post. The caller must replay the original snapshot. There is no "latest price wins".
- Cancel before post writes no invoice. The identity and the snapshot remain. The command is rejected after `cancelled_before_post`. No reversal journal exists because nothing was posted.
- The command runs in one database transaction, as OD-DG-6-TRIGGER already requires. A failure rolls back the invoice, the context, stock, and clearing together. There is no partial posted sale to repair.

---

## 12. Unmapped product

Reject the whole financial command. Do not post the mapped lines and leave the rest. Do not create a free-text line for the unknown SKU. Do not price the unknown line from a similarly named AWJ product.

The operational projection can still exist without a posted invoice. Fixing the mapping is a later intake or an explicit command retry after the snapshot's mapping fields are completed. Changing the mapping changes the checksum only if the stored snapshot changes. A silent remap at post time is not allowed.

---

## 13. Interaction with InvoiceService

The future command, still not built:

1. Load the operational order and its frozen snapshot in the order's tenant and branch.
2. Refuse unless the state window from OD-DG-6-TRIGGER allows it (`accepted`, `preparing`, `ready`, or handed off).
3. Build invoice items from the snapshot only: `unit_price = gross_unit_price_minor`, `discount = merchant_funded_discount_minor`, `quantity`, mapped product/variant/unit, `tax_inclusive` from the snapshot, `tax_rate = product_tax_rate_at_intake` after the equality check in §7.11.
4. Do not call `PosService`, `assertUnitPricesAllowedForPos`, or `CommercePriceResolver`.
5. Call `InvoiceService::create` then `InvoiceService::post` in the same transaction.
6. Record `DeliveryInvoiceContext` on that posted invoice. Still no price columns on the context.
7. Apply the already accepted collection-mode clearing. Merchant-collected still invents no tender. Platform-collected still does not use the POS drawer.
8. Do not write `platform_funded_discount_minor` or `net_settlement_minor` into the invoice, the journal, or the context.

After `post`, the invoice is frozen by the existing rule. A provider correction after post is outside this gate. It is not a second post of the same identity.

---

## 14. What DG-3 still blocks

This recommendation does not decide:

- agent versus principal;
- the legal tax point of a named platform;
- whether the merchant or the platform is responsible for the VAT on the customer sale;
- commission, fee, and commission VAT;
- whether a platform-funded amount is later a receivable, a contra-revenue, or something else;
- whether a ZATCA document may use a tax rate that no longer matches the product.

Enabling VAT recognition for a named platform stays **EXTERNAL EVIDENCE REQUIRED** under DG-3. Accepting Option B would remove the price-authority block on building the command. It would not by itself authorize enabling that command for VAT.

---

## 15. Cases

| # | Case | Result under Option B |
|---|---|---|
| 1 | Platform price equals the AWJ price | Post the snapshot. Equality is not required and is not a special path. |
| 2 | Platform price differs | Post the snapshot. Do not reprice. Do not invent a discount for the gap. The catalog observation field may record the gap and is not posted. |
| 3 | Merchant-funded discount | Invoice line discount. Reduces the merchant's taxable base through the existing invoice math. |
| 4 | Platform-funded discount | Snapshot only. Not an invoice discount and not revenue. |
| 5 | Shared discount | Post only when the provider already split it into the two payer fields. An unlabeled single discount rejects. |
| 6 | Gross, net, and discount sent separately | Gross unit price and merchant-funded discount feed the invoice. Customer payable is the check. Net settlement is ignored. |
| 7 | Rounding difference | The provider figure must equal AWJ's integer formula exactly. A difference rejects. No rounding line and no tolerance. |
| 8 | Tax-inclusive versus exclusive | Use the explicit snapshot flag. Do not infer it. Provider tax must match `extractTax` or `calcTax` for that flag and the frozen product rate, or the command rejects. |
| 9 | Mapped product whose AWJ price changed after the order | Snapshot wins. The live price is not read for posting. |
| 10 | Product cannot be mapped | Whole command rejects. No partial invoice. No free-text substitute. |
| 11 | Modifier or variant price | A separately priced modifier is its own mapped line. Its AWJ modifier price is not added back onto the parent. |
| 12 | Quantity mismatch | The provider quantity is the commercial quantity if AWJ can store it. Otherwise reject. Do not substitute a catalog quantity. |
| 13 | Replay after the catalog price changed | Same snapshot replays. The new catalog price is irrelevant. A different snapshot conflicts. |
| 14 | Cancel before post | No invoice, no journal, no reversal. Identity and snapshot stay. The command rejects. |
| 15 | Retry after a partial failure | One transaction, so a failed command leaves no posted invoice. Retry of the same snapshot is safe. A different snapshot conflicts. |

---

## 16. Owner decision requested

**OD-DG-8-IMPORT — not accepted in this PR.**

Please choose one:

| Choice | Effect |
|---|---|
| **Accept Option B** as OD-DG-8-IMPORT | Imported commercial price is the frozen provider snapshot in §6–§13. Manual POS stays OD-DG-8. The financial command is still not built by that acceptance, and VAT recognition stays blocked on DG-3. |
| **Accept Option A** | The future command would reprice from the live AWJ catalog. That contradicts the no-silent-reprice invariant. Not recommended. |
| **Accept Option C** | Two price authorities. Not recommended. A hybrid still needs a written rule that does not invent discounts. This pass does not offer one. |
| **Reject all three** | DG-8-IMPORT stays open. The financial command stays unbuilt. |

Accepting B does not accept DG-3, does not start DLV-HUB-1, and does not deploy.

---

## 17. Downstream

| Task | After this recommendation, before an acceptance |
|---|---|
| Projection Hub (already merged) | Unchanged. Still must not price or post. |
| Full DLV-HUB-1 financial command | **BLOCKED.** Still blocked on an accepted OD-DG-8-IMPORT, then on DG-3 before VAT is enabled. |
| DLV-COMMISSION-1, DLV-SETTLEMENT-1 | **BLOCKED** on DG-3. Platform-funded amounts are not their implementation permit. |
| DLV-POS-1 | Unchanged. OD-DG-8 stays accepted. |

No production deploy.
