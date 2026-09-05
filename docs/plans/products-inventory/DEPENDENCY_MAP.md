# Products & Inventory — Dependency Map

## Hardening dependency graph

```text
PR-SEC-INV-1 ───────────────┬─> Inventory Workspace
                            └─> Stock Requests

PR-INV-1 ───────┬─> Durable Imports
                 ├─> Inventory Workspace
                 └─> Multiple UOM workbook cost surfaces

PR-PRICE-1 ────────────────> POS / pricing completion

PR-INV-2 ─────────────────> trustworthy purchase-return stock/accounting

PR-INV-3 ───────┬─────────> Multiple UOM completion
                 └─────────> Stock Requests fulfillment

PR-INV-4 ───────┬─────────> Reservations
                 └─────────> Serial/Lot/Expiry physical-count correctness

PR-UOM-1 ───────┬─────────> Multiple UOM/Barcode
                 ├─────────> Durable Imports
                 └─────────> Serial/Lot/Expiry

PR-PROD-LIFE-1 ─┬─────────> Multiple UOM/Barcode
                 ├─────────> Durable Imports
                 └─────────> Serial/Lot/Expiry/new Product-bearing models
```

## Cross-cutting invariants

### Authorization
Tenant isolation is always global and mandatory. Branch/warehouse restrictions inside a tenant are record authorization/operational isolation and must be enforced on direct UUID actions as well as list/create paths. Do not replace explicit accounting-document behavior with a blind BranchScoped conversion.

### Cost
All future Product/Inventory surfaces consume one centralized sensitive-cost policy. No feature may create its own independent list of hidden cost fields unless the central policy explicitly exposes that classification.

### UOM
Stock state is base quantity. Commercial UOM input converts once through validated semantics and persisted historical snapshot/base quantity where the transaction requires history. Quantity conversion never derives money.

### Accounting
Every financial stock transaction must prove the delta to Inventory GL 1140 equals the inventory subledger delta. Commercial supplier/customer values may differ from carrying value; the accounting design must represent the difference rather than forcing subledger valuation to equal commercial price.

### Concurrency
Document-level `lockForUpdate` only protects document state. Where correctness depends on stock balance/version/snapshot, the relevant inventory state must also be protected/revalidated.

### Lifecycle
Any new generic `product_id` reference must declare whether it is: business/historical blocker, inventory-semantic blocker, commercial live reference, owned child, or audit/history child. This declaration is part of feature DoD.

## Decisions deliberately not smuggled into dependencies

- barcode reuse after soft delete/deactivation: NEEDS DECISION;
- weighted barcode: NEEDS DECISION;
- Product Variants/Attributes: NEEDS DECISION;
- reservations integration with Stock Requests: decide when that phase is designed;
- per-warehouse costing: not planned; current global moving average remains authoritative.