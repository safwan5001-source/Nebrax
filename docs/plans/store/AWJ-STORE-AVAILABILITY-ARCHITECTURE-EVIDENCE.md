# AWJ Store Product Availability — Read-only Architecture Evidence
**Status:** Initial code-evidence review; docs-only; not implementation authorization
**Date:** 2026-10-16
**Repo:** safwan5001-source/Nebrax, main read for source evidence

## Verified facts
1. `app/Models/Product.php`: `track_inventory` is boolean, model default `false`; `type` model default `good`; `isService()` checks `type === 'service'`. **Do not assume product type and inventory-tracking policy are equivalent.**
2. `app/Services/Commerce/CommerceOrderReservationService.php` around lines 124–144: `reserve()` skips `InventoryReservationService::acquire()` if `! $product->track_inventory`. This is a live non-tracked-item distinction in order reservation handling.
3. `app/Services/Commerce/CommerceCheckoutService.php` around lines 770–808: `revalidateAndPrice()` checks configured warehouse, `ProductWarehouseStock`, active reserved quantity, normalized demand and insufficient stock **only inside** `if ($product->track_inventory)`.
4. `app/Services/Commerce/InventoryReservationService.php` around lines 96–120 acquires against positive Available-to-Sell from actual warehouse balance/reservations; reservation state transition itself does not issue stock.
5. `app/Http/Controllers/Api/StorefrontProductController.php` around lines 267–317 and 353 onward computes public `in_stock` for variants and products from warehouse ATS with no `track_inventory` branch apparent in these paths. **Candidate catalog/PDP mismatch:** an otherwise eligible non-tracked product can be shown out-of-stock if its warehouse stock is zero, despite non-tracked checkout/reservation behavior. Must confirm through targeted integration tests before asserting observed production behavior.
6. `app/Services/Commerce/AvailableToSellService.php` uses physical `product_warehouse_stock` minus active reservations. This must remain authoritative for tracked goods.
7. `app/Http/Controllers/Api/CommerceFulfillmentController.php` currently manages one fixed active warehouse per storefront channel; it is distinct from the proposed availability policy.

## Implications for PRD and ADR
- **Always-available/non-stock:** current backend infrastructure appears to recognize `track_inventory=false` at checkout and reservation. The minimum viable feature may principally need public catalog/PDP consistency, merchant policy/eligibility resolution, and cart/checkout contract coverage, rather than a new inventory reservation primitive.
- **Risk:** `track_inventory=false` is a product-wide attribute; store-level Always mode **must not silently mutate the product or turn off inventory tracking in other stores, POS, or ERP**. With tracked goods, Always must reject/guide to MTO rather than fake stock.
- **Model default caveat:** `track_inventory=false` is only a model default; actual product creation workflow, migrations, and inventory identity protection must be examined before designing policy eligibility. Existing tracked stock data may differ.
- **Made to order:** no verified complete MTO order → preparation → physical issue → invoice/COGS/cancellation lifecycle in this focused review. No declaration of support and no activation permitted without separate lifecycle architecture and accounting tests.
- **Presentation:** existing null `in_stock` semantics and `storefront/src/lib/commerce/mappers.ts` must be reconciled explicitly; never treat an absent warehouse as positive tracked stock.

## Recommended narrow next slice (analysis only)
1. Trace product creation/update validation for `type` and `track_inventory`, including lifecycle guards and existing live-product conversion constraints.
2. Trace cart add/update/read UI and checkout completion/commerce order creation for non-tracked items and variant-specific semantics; inspect how published offerings and fulfillment/delivery validation interact.
3. Confirm storefront catalog/PDP availability mismatch via focused tests using a published `track_inventory=false` product and zero warehouse quantity.
4. Define per-store policy persistence and safe default Auto without changing the global product track flag.
5. Write a separate ADR for MTO physical fulfillment and accounting before implementing MTO acceptance.

## No claims made
No tests/CI/build were executed for this read-only source inspection. No production database/query access or live transaction observed. No code, migration, source contract, deployment, or merge changed. Status remains Proposed.
