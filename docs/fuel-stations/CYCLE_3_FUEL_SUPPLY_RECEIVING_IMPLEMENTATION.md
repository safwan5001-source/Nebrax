# Fuel Stations — Cycle 3 Fuel Supply Receiving, GRNI & Exact Cost Basis

> **Status:** Implemented on `fuel-stations-cycle-3-supply-receiving`; pending reviewer approval and merge. This record is subordinate to `FUEL_STATIONS_MASTER_PLAN.md`, `FUEL_STATIONS_MASTER_EXECUTION_PROMPT.md`, and the approved Cycle 3 decisions for GRNI, supplier-invoice value variance, fuel-cost precision, historical baseline, and inventory-gain valuation.
>
> **Scope:** Supplier fuel receipt evidence, explicit approval, GRNI clearing, partial supplier-invoice matching, and an exact fuel-only cost basis. This cycle does not implement retail sale, shifts, dispenser meters, stock transfers, vendor/device activation, or any production entitlement/configuration action.

## Operating and accounting boundary

Cycle 3 makes the documented supplier receipt the only new source of official fuel book stock. A `FuelDelivery` remains a draft until explicit approval. Approval validates the station’s explicit active warehouse, supplier, tank/product relationship, fuel `mL` mapping, configured GRNI liability account, and trusted cost state. It then creates exactly one `StockMovement`, one balanced journal entry through `LedgerService`, an immutable operational-ledger row, and an immutable cost-basis movement in the same transaction.

| Stage | Official record | Book-stock effect | Accounting effect |
|---|---|---:|---:|
| Delivery draft | `FuelDelivery` | None | None |
| Approved receipt | `StockMovement` via `InventoryService` | Increase by received mL | Dr inventory / Cr configured GRNI |
| Cost trace | `FuelInventoryCostMovement` | None independently | Audit snapshot of exact rate, pool, and carry |
| Supplier invoice | `FuelSupplierInvoice` and lines | None | None |
| Invoice match | `FuelSupplierInvoiceMatch` | None | Dr GRNI / Cr supplier payable for the safe cleared part only |

The posting paths are intentionally distinct:

```text
Supplier evidence → delivery draft → explicit approval
→ StockMovement + exact Fuel Cost Basis + LedgerService (Dr inventory / Cr GRNI)

Supplier invoice → partial line-to-delivery match
→ LedgerService (Dr GRNI / Cr supplier payable)
```

A matched invoice never calls `InventoryService`. The existing purchase service detects a purchase connected to fuel receiving and prevents a second inventory receipt. Thus supplier settlement clears the receipt accrual rather than duplicating quantity or cost.

## Explicit GRNI and supplier-invoice policy

`grni_account_id` is a tenant default with an optional station override. `FuelStationSettingsService` is the only settings decision point and audits every change. The selected account must be a tenant-owned, active, postable leaf **liability** account. There is no fallback to Accounts Payable, a default account, or a numeric code.

| Event | Debit | Credit | Constraint |
|---|---:|---:|---|
| Approved supplier receipt | Station inventory asset | Configured GRNI liability | Uses actual received mL and approved receipt value. |
| Exact/partial invoice match | Configured GRNI liability | Existing supplier-payable account | Clears only the receipt value safely matched. |
| Invoice amount above/below receipt value | — | — | Stored as `value_variance_pending`; no automatic inventory revaluation, 5180 posting, or invented purchase-price-variance account. |

The match model records matched quantity, receipt value, invoice value, cleared value, variance direction, currency, historical station/tank/product/warehouse/GRNI identifiers, and its journal reference. Header and line counters make matching partial and auditable; immutable match rows preserve the cleared fact.

## Exact fuel cost basis

Fuel continues to use integer `mL` for quantity. Cost is a fuel-domain implementation that does **not** turn the general Nebrax money engine into a decimal engine. `FuelInventoryCostState` holds a rational cost rate in minor units per `mL` (`cost_numerator_minor / cost_denominator`), a remaining integer book-cost pool, and a rational carry remainder. Arithmetic uses integer-string operations through the enabled `bcmath` runtime extension; it never uses float or PHP decimal coercion.

> The cost-state invariant is that its integer pool plus its carried rational remainder represents the exact value of remaining fuel at the stored rate. Each approved event posts whole minor units only, while the unreconciled fraction is carried deterministically into the next event.

| Cost event | Exact valuation | Pool and carry effect |
|---|---|---|
| Supplier receipt | Recalculates moving-average rational rate from prior exact rate plus actual receipt total | Adds received quantity and receipt minor value; preserves any existing carry. |
| Fuel shortage/loss | Current exact rate × shortage mL | Decreases quantity and pool; posts `floor(exact loss + carry)` and retains the fraction. |
| Fuel surplus/gain | Current exact rate × surplus mL before the gain | Increases quantity and pool; posts `ceil(exact gain − carry)` and retains the fraction. No GRNI or supplier payable is created. |
| Full depletion | Exact remaining value plus carry | The final loss consumes the full integer pool and resolves carry to zero. |

`Product.avg_cost` remains a compatibility field of the generic inventory engine and is **not** used as the valuation truth for fuel receipt, loss, or gain. `InventoryService` now accepts an optional exact total-cost argument for both receipts and issues so its `StockMovement.total_cost` agrees with the journal and fuel cost movement even where a whole-minor-per-mL unit cost cannot exist.

## Historical baseline guard and reconciliation integration

A zero-quantity fuel warehouse/product can initialise an empty cost state. A positive pre-existing book balance with no trusted state fails with `FUEL_COST_BASELINE_REQUIRED`; no automatic conversion from rounded `Product.avg_cost` is made. A physical gain against zero quantity fails with `FUEL_GAIN_COST_BASIS_REQUIRED`, because no defensible average exists. A separate audited baseline workflow is required before such historic quantity can move under the exact model.

Cycle 2 reconciliation is connected to this same state. Approved losses and gains no longer source value from generic `avg_cost`; they obtain a quote from `FuelCostBasisService`, create the official movement with the exact total, post through `LedgerService`, and capture before/after rational snapshots in the immutable cost movement. The existing station-specific loss/gain account hierarchy remains in force, and no GRNI or supplier payable is introduced by a reconciliation gain.

## API, permissions, and UI

All Cycle 3 endpoints remain behind the existing commercial application state and fuel-station RBAC chain. Read operations require `fuel_stations.view`; drafts, approval, invoices, matches, and settings changes require `fuel_stations.manage` plus writable access. New FormRequests separate HTTP validation from service logic, and Resources expose exact `mL` plus display `L` values without raw model serialization.

| Route group | Purpose |
|---|---|
| `GET/POST /api/fuel-stations/deliveries` | List or create immutable-on-approval supplier-receipt drafts. |
| `GET /api/fuel-stations/deliveries/{id}` | Read a delivery with historical warehouse and accounting links. |
| `POST /api/fuel-stations/deliveries/{id}/approve` | Explicitly post stock, GRNI, operational ledger, and Cost Basis. |
| `GET/POST /api/fuel-stations/supplier-invoices` | Read or capture supplier invoice headers and lines. |
| `GET /api/fuel-stations/supplier-invoices/{id}` | Read invoice lines and matching history. |
| `POST /api/fuel-stations/supplier-invoices/{id}/matches` | Partially match an approved delivery and clear GRNI safely. |
| `GET/PUT /api/fuel-stations/settings` | Read/update tenant defaults including explicit GRNI. |
| `GET/PUT /api/fuel-stations/stations/{id}/settings` | Read/update or clear station overrides including GRNI. |

The `/fuel-stations/receiving` screen provides a responsive receipt draft form, receipt list, and supplier-invoice status view. It filters displayed warehouses to the selected station branch, explains the no-fallback warehouse rule, and presents GRNI/value-variance status as operational information rather than hiding it. Its tables use horizontal containment on narrow viewports.

## Explicitly deferred

| Deferred capability | Cycle 3 behavior |
|---|---|
| Audited baseline creation for pre-existing positive fuel stock | The safe guard blocks new movement; no rounded automatic baseline is manufactured. |
| Value-variance resolution/reversal workflow | Variance is persisted as pending without an automatic journal, revaluation, or 5180 entry. |
| Reversal/correction of approved receipt, match, loss, or gain | Approved facts are immutable. A later correction workflow must create linked reversing stock, ledger, cost-pool, carry, and journal effects. |
| Tanker compartment/tamper workflow, temperature normalization, and density policy | Evidence fields are retained where relevant; no vendor-specific physical-calibration engine is activated. |
| Shift, dispenser meter, retail sale, payment, invoice, and ZATCA flow | No sale quantity is inferred from receipt or reconciliation. |
| Station/warehouse fuel transfer | No transfer source or historical warehouse-change workflow is introduced. |
| Device adapters, offline synchronization, hardware credentials, and vendor activation | No device is contacted, credentialed, or enabled. |

## Migration impact

Migration `000110_create_fuel_supply_receiving` adds delivery, supplier-invoice, supplier-invoice-line, and immutable-match records; fuel cost state; and immutable cost movements. It introduces UUID-compatible references and tenant/warehouse/product uniqueness for the cost state, unique receipt idempotency, and unique invoice/match keys. Existing products, book balances, `avg_cost`, station warehouse settings, accounts, entitlements, vendor credentials, and production environment state are not mutated. Positive historic fuel stock is intentionally not backfilled into an exact state.

## Verification completed before review

| Check | Result |
|---|---|
| Focused Cycle 2/3 SQLite tests | 22 tests, 156 assertions across reconciliation, receipt/GRNI, and API suites on PostgreSQL; focused SQLite suites also passed. |
| Full backend SQLite suite | 1295 passed, 1 skipped, 7539 assertions. |
| Full backend PostgreSQL suite | 1296 passed, 7541 assertions. |
| Web test suite | 38 files, 169 tests passed. |
| Next.js production build | Compiled successfully. |
| `git diff --check` | Passed before staging. |

The different SQLite and PostgreSQL totals reflect the repository’s existing engine-specific test activation, not an ignored failure.
