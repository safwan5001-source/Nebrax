# Fuel Stations — Cycle 2 Fuel Inventory & Reconciliation Implementation

> **Status:** Implemented on `fuel-stations-cycle-2-inventory`; pending reviewer approval and merge. This record is subordinate to `FUEL_STATIONS_MASTER_PLAN.md`, `FUEL_STATIONS_MASTER_EXECUTION_PROMPT.md`, and the approved Cycle 2 decisions.
>
> **Scope:** Immutable operational fuel evidence and reconciliation only. The cycle establishes the boundary between **Book Stock**, **Physical Stock**, and **ATG Stock**; it does not implement supplier delivery, dispenser sale, shift, or device integration workflows.

## Operating boundary

Cycle 2 keeps a single official inventory truth. `Product.quantity_on_hand`, `ProductWarehouseStock`, and `StockMovement` remain Nebrax’s book inventory. `FuelOperationalLedger` is the station-level, append-only operational detail; it does not duplicate inventory valuation or quantity ownership. Physical and ATG readings are immutable evidence only and do not alter book stock by themselves.

| Concern | Record | Effect on Book Stock | Effect on Accounting |
|---|---|---:|---:|
| Physical reading | `FuelTankReading` with `reading_type=physical` | None | None |
| ATG reading | `FuelTankReading` with `reading_type=atg` | None | None |
| Draft reconciliation | `FuelReconciliation` | None | None |
| Approved variance | `StockMovement` through `InventoryService` | Yes | Yes, through `LedgerService` |
| Operational trace | `FuelOperationalLedger` | Records the approved fact | None independently |

The only posting path is:

```text
Physical/ATG evidence
→ draft reconciliation snapshot
→ explicit approval
→ InventoryService StockMovement
→ LedgerService journal entry
→ immutable reconciliation and fuel operational ledger
```

A draft snapshots the station, tank, fuel product, configured warehouse, opening book balance, expected closing, Physical and ATG evidence, variance, tolerance, and reason. Approval rejects a draft without Physical evidence. ATG remains a separately stored comparison source and never overwrites book quantity.

## Quantity, warehouse, and concurrency invariants

Fuel products use integer **mL** in Nebrax inventory and stock movements, while API resources expose an exact L string for display. `FuelQuantity` converts centrally with no floating-point arithmetic and rejects precision beyond three decimal places. The linked Nebrax `Product` must be active, inventory-tracked, and have `unit = mL` before an official reconciliation may be created or approved.

`FuelStation.warehouse_id` is nullable only to preserve existing station records during migration. It is a visible station configuration, not an implicit foreign key: official reconciliation fails when no active, tenant-owned, branch-compatible warehouse is configured. No default, first, main, or branch warehouse fallback is used. Both `FuelReconciliation` and `FuelOperationalLedger` capture the warehouse used historically. A model and service guard reject a warehouse change after the station has operational-ledger history; a later transfer workflow is required.

`fuel_tank_readings` enforces a tenant-scoped unique evidence key. Reconciliation reading references have database unique constraints, and service-level checks provide a clear API failure while the constraints settle concurrent attempts. Approval locks the reconciliation and the relevant product/warehouse-stock rows before cost, inventory, and ledger work. The operational ledger also has a tenant-scoped idempotency key per reconciliation.

## Tolerance and account mappings

`FuelStationSettingsService` is the sole settings decision point. Tenant settings flow into a station, then a station override may replace them; clearing an override restores the tenant value. Every change writes an immutable `FuelStationConfigurationEvent`.

| Setting | Default | Validation and use |
|---|---:|---|
| `reconciliation_tolerance_absolute_milliliters` | `0` | Non-negative integer; captured on each draft for audit, never erases a variance. |
| `reconciliation_tolerance_basis_points` | `0` | Non-negative integer, capped at 1,000,000 basis points; captured on each draft. |
| `inventory_variance_account_id` | verified stocktake fallback | Optional active leaf **expense** account for shortage/loss. |
| `inventory_gain_account_id` | verified stocktake fallback | Optional active leaf **expense** or **revenue** account for surplus/gain. |

The verified fallback uses the accounting constants already used by `StocktakeService`: inventory is account `1140` and the inventory-adjustment fallback is `5180`. Fuel reconciliation does not introduce its own hard-coded mapping. A station’s selected inventory account must be an active leaf asset account. A mapping from another tenant, a group account, an inactive account, or an account with an incompatible type is rejected before posting.

## Journal-entry table

All values below are minor units; the amount is `abs(variance_milliliters × moving_average_unit_cost_minor)`. Cost is read from the current `InventoryService` moving-average product cost at approval and then stored on the approved reconciliation and ledger row.

| Approved event | Account | Debit | Credit |
|---|---|---:|---:|
| Shortage / loss | Configured loss/variance account, or verified stocktake fallback | Variance value | — |
|  | Station inventory asset account, or `1140` | — | Variance value |
| Surplus / gain | Station inventory asset account, or `1140` | Variance value | — |
|  | Configured gain account, or verified stocktake fallback | — | Variance value |
| Exact match | — | — | — |

An exact match creates an immutable `reconciliation_matched` operational-ledger record but no `StockMovement` and no journal entry, because it does not move book stock.

## API and UI

Cycle 2 adds typed FormRequests and Resources for readings and reconciliations. Read operations remain protected by `fuel_stations.view` plus commercial access; creation and approval require `fuel_stations.manage` plus writable commercial access. Reconciliation listing and approval use explicit active-branch filtering for the `BelongsToBranch` record type.

The following settings surface is protected identically and writes only through `FuelStationSettingsService`:

| Route | Purpose |
|---|---|
| `GET/PUT /api/fuel-stations/settings` | Read/update tenant tolerance and mapping defaults. |
| `GET/PUT /api/fuel-stations/stations/{id}/settings` | Read/update or clear station overrides. |

The existing master-data screen now loads active compatible warehouses, exposes **Station warehouse** as a station configuration, and explains before submission that official fuel inventory cannot proceed without it. Stations left blank after migration remain visible with an explicit warning rather than being silently assigned a warehouse.

## Explicitly deferred

| Deferred source operation | Target cycle | Cycle 2 behavior |
|---|---:|---|
| Opening balances | 3 | No opening API is accepted; book balance is read from the configured warehouse. |
| Supplier delivery / tanker compartments | 3 | Arbitrary delivery totals are rejected; a future source must create a documented receipt and operational-ledger row. |
| Shift and dispenser-meter operations | 4 | No shift, meter close, or forecourt transaction API is introduced. |
| Retail fuel sale, payment, invoice, ZATCA, and settlement | 5 | Arbitrary sale totals are rejected; no sale is inferred from a reconciliation. |
| Inter-station and inter-warehouse transfer | 6 | Arbitrary transfer totals are rejected; a future source must preserve both warehouse movements. |
| Device adapters, offline synchronization, and hardware credentials | 8–9 | Evidence keys and immutable records prepare idempotency, but no device is activated or contacted. |
| Correction/reversal workflow for approved reconciliation | Subsequent accounting cycle | Approved records are immutable. No direct edit or delete endpoint exists. |

## Migration impact

Migration `000109` adds nullable `fuel_stations.warehouse_id`, fuel product unit metadata, readings, reconciliation snapshots, and the operational ledger. No existing station is assigned a warehouse automatically, and no existing Product unit, stock quantity, cost, accounting account, entitlement, vendor credential, or production configuration is changed. The migration uses UUID-compatible nullable morph columns for operational-ledger sources and constraints that prevent duplicate reading references.

## Verification completed before review

| Check | Result |
|---|---|
| Expanded Cycle 2 SQLite tests | 14 tests, 81 assertions across reconciliation and API suites |
| Full backend SQLite suite | 1283 passed, 1 skipped, 7436 assertions |
| Full backend PostgreSQL suite | 1284 passed, 7438 assertions |
| Web test suite | 38 files, 169 tests passed |
| Next.js production build | Compiled successfully |
| `git diff --check` | Passed |

The different SQLite and PostgreSQL totals reflect the repository’s pre-existing engine-specific test activation, not an ignored failure.
