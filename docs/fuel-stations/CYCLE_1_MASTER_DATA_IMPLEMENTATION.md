# Fuel Stations — Cycle 1 Master Data Implementation

> **Status:** Implemented on `fuel-stations-cycle-1-master-data`; pending full verification, review, and merge.
>
> **Scope:** Stations, fuel-product master data, tanks, calibration tables, pumps, and nozzles. This record is subordinate to the two official Fuel Stations documents.

## What this cycle creates

Cycle 1 turns the Cycle 0 foundation into controlled **master data**. It introduces the station’s branch mapping, location and operating profile; a non-hard-coded `FuelProduct` linked to the existing Nebrax `Product`; and a validated physical topology:

```text
FuelStation → FuelTank → FuelProduct → Product
FuelStation → FuelPump → FuelNozzle → FuelTank + FuelProduct
```

The service rejects every topology that is not internally consistent. A nozzle’s pump and tank must belong to the same station, and the nozzle’s fuel product must be the tank’s fuel product. Tank, pump, and nozzle codes are constrained at their real logical scope; controller/ATG identities are unique per tenant when supplied.

| Entity | Branch classification | Rationale |
|---|---|---|
| `FuelStation` | `CompanyWide` | Central management may view the network; the station holds an explicit branch mapping for later operations. |
| `FuelProduct` | `CompanyWide` | Fuel specification is shared master data; it references the existing product, which remains the source for unit, tax rate, inventory, and account mapping. |
| `FuelTank`, `FuelPump`, `FuelNozzle` | `CompanyWide` with `branch_id` | They are physical infrastructure configured centrally, not daily events. Future readings, movements, shifts, and sales will carry operational branch scopes. |
| `FuelTankCalibrationPoint` | `CompanyWide` with `branch_id` | It is a table owned by infrastructure; it is not a stock record or reading. |

## Measurement and accounting boundary

Tank capacities, dead stock, opening volume, calibration values, and opening meters are stored as **integer millilitres**. Density is an integer kg/m³. These are physical measurement facts, so decimal GPS coordinates are permitted only for location; no monetary calculation or financial amount is introduced.

> **No accounting event exists in Cycle 1.** No inventory movement, book quantity, physical reading, valuation, purchase receipt, sale, invoice, payment, settlement, ZATCA document, or ledger entry is created. Therefore there is no journal-entry table for this PR.

Station-level default account references are optional, validated as tenant-owned leaf accounts of the appropriate types, and deliberately unused. They are configuration prepared for later, explicitly reviewed financial flows—not an authorization to post.

## API and UI access

All CRUD endpoints under `/api/fuel-stations/*` are protected with both `fuel_stations.view`/`fuel_stations.manage` RBAC and the composite commercial access decision for `fuel_stations.core`. The route protection is the authority; workspace/sidebar visibility remains non-authoritative.

The new `/fuel-stations/master-data` UI provides tabbed create, edit, list, and delete workflows for all five entity types. It always lets the API enforce cross-reference validity and surfaces the server’s rejection reason. It includes loading, empty, error, and responsive table states; no UI decision creates access or financial effects.

## Explicitly deferred

| Deferred scope | Target cycle | Why it is not implemented here |
|---|---:|---|
| Tank readings, physical/book/ATG comparison, stock and valuation | 2 | Requires an immutable fuel inventory ledger and reconciliation policy. |
| Supplier deliveries, tanker compartments, variance, receipt approval | 3 | Requires inventory movement and receiving controls. |
| Shifts, meter closing, cash, forecourt events | 4 | Requires controlled readings and staff/terminal lifecycle. |
| Fuel sale, payment, invoice, ZATCA, settlement, ledger effects | 5 | Requires finalized source operation, reversal policy, and accounting design. |
| Physical device registry, credentials, adapters and field networking | 8 | Cycle 1 reserves only controller/ATG identity strings; it does not connect to devices. |

## Migration impact

Migration `000108` adds empty master-data tables and nullable station metadata/optional mapping references. It does not modify existing products, accounts, tenants, entitlements, application state, inventory, invoices, or journals. Its rollback removes only Cycle 1 tables/columns; a deployed rollback must follow the standard operational review once data exists.
