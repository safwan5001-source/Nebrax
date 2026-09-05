# Phase 2 — Products & Inventory Completion Program

**Status:** PROGRAM PLANNED — detailed implementation PR decomposition occurs only after relevant hardening gates close.

## 1. Multiple UOM / Barcode Completion

Deliver complete Product management and transaction UX around the already-existing UOM foundation: alternate barcode UI, default sales/purchase UOM, explicit per-UOM prices, POS UOM switching, lossless Products/Barcodes/Unit Prices workbook. Never derive price from factor. Requires PR-UOM-1, PR-PROD-LIFE-1 and PR-INV-1 for cost-bearing workbook fields.

## 2. Durable Imports

Shared durable upload/job infrastructure with frozen mapping/options, whole-file validation, deterministic chunks, progress/error artifact, resumable/idempotent apply and live conflict revalidation. Product Catalog remains Master Data only. Inventory Opening remains separate staged accounting domain. Do not raise synchronous limits as substitute architecture.

## 3. Inventory Workspace

Warehouse-aware Product×Warehouse server-side workspace for 20k–50k operational scale. Search/filter/sort/page on server. Cost/value visibility uses PR-INV-1 central policy. Include low/out/negative stock states and movement source navigation foundations. Preserve global Product avg cost while showing warehouse quantities.

## 4. Serial / Lot / Expiry

Tracking identity augments Product×Warehouse quantity, not replaces it. Tracking quantities must sum to warehouse quantity. Serial quantity constraints, lot identity and expiry policy are explicit. FEFO affects selection, not valuation. Global moving average remains current valuation architecture.

## 5. Reservations / Availability

Durable reservation ledger/state with On Hand, Reserved, Available definitions. Reservation does not move stock/GL. Concurrency must prevent over-reservation according to negative-stock/availability policy. Release/consume/idempotency and source identity required.

## 6. Stock Requests / Approval / Fulfillment

Non-financial request workflow. Approval still no stock/GL. Fulfillment creates/links one or more Stock Permits and supports partial fulfillment. Inherits Stock Permit authorization/UOM/accounting guarantees. Cross-branch request policy explicit.

## 7. Low Stock / Replenishment

Per-warehouse reorder point/target, preferred supplier, lead time, actionable Low Stock Center and transfer-before-purchase suggestion. No automatic PO initially. Once Reservations exists, choose whether replenishment signals use On Hand or Available and document it.

## 8. Movement Source Drilldown

Every movement should resolve its source safely and provide operational drilldown without leaking inaccessible branch/warehouse/cost data. Source metadata contract must remain stable for new domains.

## Deferred/decision areas

- Weighted Barcode — NEEDS DECISION.
- Product Variants/Attributes — NEEDS DECISION.
- Bundles — later.
- Manufacturing/BOM — deferred.
- Intelligent automatic replenishment — later after trustworthy demand/availability data.

## Detailed-plan gate

Before any Phase-2 item starts, create its scoped PR decomposition and executable prompt from the then-current `main`, reusing these invariants. Do not pre-authorize implementation from this program-level file.