# Inventory Movement Source Drilldown

**Status:** IN PROGRESS — PR-INV-MOV-1 resolver foundation implemented on `feat/pr-inv-mov-1-movement-source-resolver` (not merged).

## Goal
Make each inventory movement operationally explainable from the Inventory Workspace while preserving authorization and cost redaction.

## Contract
Movement `source_type`/`source_id` remains durable domain provenance. A centralized resolver maps supported source classes to safe labels/routes/resources. Unknown/legacy source remains displayable as a movement without unsafe generic model loading.

## What PR-INV-MOV-1 implemented

Read-only enrichment of `GET /api/inventory/{productId}/movements`.

Central resolver: `App\\Support\\Inventory\\MovementSourceResolver`.

Persisted `source_type` values are Eloquent FQCN strings written by existing posting services. The API never returns those class names.

### Supported persisted values

| persisted source_type | public type | authorization | route when authorized |
|---|---|---|---|
| `App\\Models\\Invoice` | `invoice` | `invoices.view` + branch assignment | `/invoices/{id}` |
| `App\\Models\\Purchase` | `purchase` | `purchases.view` + branch assignment | `/purchases/{id}` |
| `App\\Models\\ReturnDocument` (`type=sales`) | `sales_return` | `returns.view` + branch/warehouse assignment | `/returns/{id}` |
| `App\\Models\\ReturnDocument` (other) | `purchase_return` | `returns.view` + branch/warehouse assignment | `/purchase-returns/{id}` |
| `App\\Models\\InventoryOpening` | `inventory_opening` | `products.view` | `/inventory-openings/{id}` |
| `App\\Models\\StockPermit` | `stock_permit` | `products.view` + branch/warehouse assignment | `/stock-permits/{id}` |
| `App\\Models\\Stocktake` | `stocktake` | `products.view` + branch/warehouse assignment | `/stocktaking/{id}` |

### Unauthorized source
Movement remains visible. Response includes generic `type` + `label` only. `reference`, `date`, `status`, `route` are null and `can_open` is false.

### Unknown / missing / cross-tenant
`type=unknown`, `can_open=false`, no route, no foreign reference. TenantScope prevents loading another tenant's document.

### API metadata
Existing movement fields are unchanged. Added:

`source: { type, label, reference, date, status, can_open, route }`

No cost/value fields on `source`. Movement costs still follow `SensitiveCostPolicy`.

### Not supported in this PR
Fuel sale / fuel delivery / fuel reconciliation movements fall through the unknown fallback. Reservations are not movement sources.

## Tests
`tests/Feature/InventoryMovementSourceTest.php`

## Deferred
Forbidden `warehouse_id` workspace-filter semantics remain deferred and are not used by this endpoint.
