# Products & Inventory — Implementation Roadmap

**Planning state:** authoritative implementation ordering; code work not authorized by this file.

## Gate 0 — Audit baseline

Closed audit remains immutable evidence baseline except for factual errata. New implementation discoveries go into the relevant PR report/decision log; do not silently rewrite the original finding.

## Phase 1 — Correctness and security hardening

| Order | Work package | Exit gate | Why before expansion |
|---|---|---|---|
| 1 | PR-SEC-INV-1 | restricted same-tenant users cannot UUID-read/mutate/post inaccessible Stocktake/StockPermit | closes narrow authorization boundary before more inventory workflows |
| 2 | PR-INV-1 | centralized cost policy covers read/write/import/export/history/filter/sort | prevents sensitive-cost leakage as workspace/import surfaces grow |
| 3 | PR-PRICE-1 | final effective sale economics respect minimum price/override | protects commercial invariant centrally before more UOM/pricing UX |
| 4 | PR-INV-2 | purchase return base qty and Inventory GL/subledger reconcile | fixes financial stock exit correctness |
| 5 | PR-INV-3 | Stock Permit lines carry immutable UOM/base semantics | hardens manual stock movements before multi-UOM completion |
| 6 | PR-INV-4 | stocktake cannot silently post stale snapshot differences | hardens physical-count truth before reservations/tracking |
| 7 | PR-UOM-1 | in-use UOM semantics cannot reinterpret stock/live refs; barcode namespace atomic | prerequisite for broad multi-UOM/barcode/tracking work |
| 8 | PR-PROD-LIFE-1 | centralized product-reference classification protects deletion/identity mutation | prevents future modules from reopening lifecycle holes |

### Ordering rule

This order is the default, not permission to merge automatically. PRs may be prepared independently only where dependencies are not violated. Any reordering that changes accounting/UOM/security assumptions requires explicit plan update before implementation.

## Phase 2A — Multiple UOM & Barcode Completion

Goals:
- complete Product UI for alternate barcodes;
- default sales/purchase UOM policy;
- explicit per-UOM commercial pricing (never derive money from quantity factor);
- lossless Products + Barcodes + Unit Prices workbook contract;
- POS commercial UOM switching;
- fail-closed live reference behavior.

Prerequisite: PR-UOM-1 + PR-PROD-LIFE-1; cost-sensitive workbook paths also require PR-INV-1.

## Phase 2B — Durable Imports

Build durable job/batch foundation instead of raising synchronous 2,000-row limits. Preserve Master Data vs Stock State separation. Catalog and Inventory Opening may share infrastructure but not domain effects.

Prerequisite: PR-INV-1, PR-UOM-1, PR-PROD-LIFE-1 and finalized workbook contracts.

## Phase 2C — Warehouse Inventory Workspace

Server-side Product×Warehouse DataTable, warehouse balances, low/out/negative status, movement source drilldown foundations. Cost/value columns and filters must consume centralized cost authorization.

Prerequisite: PR-SEC-INV-1 + PR-INV-1. Stock correctness PRs must be merged before workspace metrics are treated as authoritative.

## Phase 2D — Serial / Lot / Expiry

Target inventory identity extends to Product + Warehouse + Tracking Identity while quantity remains base-UOM truth. Tracking totals must reconcile to warehouse quantity. FEFO is selection policy, not valuation policy; global moving average remains unchanged unless separately approved.

Prerequisite: UOM hardening, lifecycle registry, stocktake correctness, warehouse workspace/data model review.

## Phase 2E — Reservations / Availability

Canonical model:
- On Hand = physical/subledger truth
- Reserved = active durable commitments
- Available = On Hand − Active Reservations

Reservations do not rewrite on-hand stock or valuation. Negative-stock policy and concurrency must be explicit.

Prerequisite: stocktake concurrency hardening and stable warehouse/tracking identity.

## Phase 2F — Stock Requests

Request → approval → fulfillment via one or more Stock Permits, including partial fulfillment. Request itself has no stock/GL effect. Fulfillment inherits Stock Permit UOM, authorization and accounting invariants.

Prerequisite: PR-SEC-INV-1 + PR-INV-3; reservations integration is a separate explicit decision.

## Phase 2G — Low Stock / Replenishment

Warehouse reorder point/target, preferred supplier, lead time, Low Stock Center, transfer-before-purchase suggestion. No automatic PO initially. Available vs On Hand semantics must be chosen once Reservations exists.

## Later

Movement source drilldown completion, media portability, quantity-tier pricing, intelligent replenishment, bundles. Manufacturing/BOM remains deferred.

## Program-level stop conditions

Stop and escalate rather than improvise if implementation requires:
- changing global vs per-warehouse costing;
- changing posted accounting history;
- weakening TenantScope;
- treating branch scope as tenant security;
- deriving UOM price from quantity factor;
- merging Product Catalog Import with opening inventory effects;
- destructive production-data migration assumptions;
- a new accounting account/mapping outside the approved domain design.