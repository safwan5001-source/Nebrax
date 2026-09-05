# PR-PROD-LIFE-1 — Product Reference Registry + Inventory Identity Guard

**Priority:** P1  
**Status:** PLANNED

## Confirmed problem

Product lifecycle protection is manually enumerated and already missed `InventoryOpeningLine` and `DeliveryNoteLine`. Inventory-identity mutation guard misses `InventoryOpeningLine`, allowing `type`/`track_inventory` semantics to change while a Draft Inventory Opening already references the Product.

## Required architecture

Create one centralized Product reference classification contract that distinguishes:

- business/historical blockers;
- inventory-semantic blockers;
- commercial live references;
- owned children;
- audit/history children.

Known classification from closed audit:

Business/historical: InvoiceLine, PurchaseLine, ReturnLine, CreditNoteLine, QuoteLine, RecurringInvoiceLine, ProcurementLine, DeliveryNoteLine, InventoryOpeningLine.

Inventory-semantic: StockMovement, StockPermitLine, StocktakeLine, ProductWarehouseStock, InventoryOpeningLine.

Commercial live: PriceListItem (destructive deletion blocker under current policy, not inventory identity by itself).

Owned children: ProductBarcode, ProductMedia.

Audit/history: ProductActivity; must not naively block every deletion because creation activity exists even for otherwise unused Product.

## Behavior

- destructive deletion unavailable when classified blockers exist; deactivation preserves history;
- `type` / `track_inventory` changes denied once inventory-semantic footprint exists;
- owned children may follow true-delete lifecycle only when deletion is otherwise allowed;
- audit/history retention behavior remains explicit;
- branch sharing/global scopes must not hide references from lifecycle checks; tenant boundary must remain strict.

## Architecture guard

Add regression/architecture mechanism requiring future generic Product-bearing models to declare lifecycle classification. The exact mechanism may be registry metadata/test convention, but it must fail loudly when a new generic `product_id` model is introduced without classification.

Avoid expensive full-schema introspection in normal requests if a compile/test-time guard can enforce completeness.

## Concurrency

Lifecycle mutation/delete decision and destructive operation must not have an obvious TOCTOU window where a new blocking reference can be created between check and delete/mutation. Use transaction/locking/DB FK constraints appropriately; do not claim application census alone is a concurrency guarantee.

## Tests

- each known blocker class;
- InventoryOpeningLine and DeliveryNoteLine regression;
- Draft Inventory Opening blocks inventory-identity mutation;
- ProductActivity alone does not incorrectly make unused Product undeletable;
- owned children cleanup only on allowed true delete;
- PriceListItem current deletion policy;
- cross-branch/shared Product references are counted;
- other tenant references never affect this tenant;
- architecture test catches unclassified new generic Product reference fixture/pattern;
- concurrent reference/delete behavior is safe under selected implementation.

## Out of scope

No redesign of document domains, no hard-delete of referenced history, no fuel-product registry merger, no UOM mutation implementation beyond consuming/sharing the lifecycle classification contract.