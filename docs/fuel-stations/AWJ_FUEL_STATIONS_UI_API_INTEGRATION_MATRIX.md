# AWJ Fuel Stations — Operator/Supervisor UI ↔ Existing API Integration Matrix
**Date:** 2026-11-04  
**Scope:** Read-only repository review. No production API calls, mutations, backend design changes or deploys.  
**References:** `routes/api.php` (fuel station routes ~1582–1723), `FuelStationMasterDataController`, `FuelShiftController`, `FuelSupplyReceivingController`, `FuelSaleController`, [product design](./AWJ_FUEL_STATIONS_DESIGN_SYSTEM_V2.md), [functional plan](./AWJ_FUEL_STATIONS_OPERATOR_SUPERVISOR_PLAN.md).

## Architecture boundary
The new **محطات أَوْج | AWJ Fuel Stations** screens must consume existing AWJ endpoints. No duplicate master product, station, tank, pump, nozzle, shift, delivery, accounting, inventory, identity or RBAC tables. The client can maintain short-lived view state, not an independent financial ledger. The backend remains authoritative for tenant, branch, station and warehouse authorization.

## Screen-to-API map (confirmed routes in repository)

| UI screen/action | Existing endpoint | Permission on route | Integration note |
|---|---|---|---|
| Authorized stations | `GET /fuel-stations/stations` | `fuel_stations.view` | Controller restricts stations to accessible scope |
| Fuel products | `GET /fuel-stations/products` | `fuel_stations.view` | Product registry; check station-specific nozzle/price mapping before showing as sellable |
| Tanks | `GET /fuel-stations/tanks` | `fuel_stations.view` | Resolve station and warehouse/tank scope |
| Pumps | `GET /fuel-stations/pumps` | `fuel_stations.view` | Filter by selected accessible station |
| Nozzles | `GET /fuel-stations/nozzles` | `fuel_stations.view` | Product and pump mapping determines actual per-product readings |
| Fuel station settings | `GET /fuel-stations/settings`, `GET /fuel-stations/stations/{id}/settings` | `fuel_stations.view` | Do not copy settings; write with `fuel_stations.manage` only |
| Station prices | `GET /fuel-stations/prices` | `fuel.sale.view` | Price history and effective times require validation |
| Shift list/detail | `GET /fuel-stations/shifts`, `GET /fuel-stations/shifts/{id}` | `fuel.shift.view` | Supports `station_id`, `status`, `mine` filters, paginates |
| Open shift | `POST /fuel-stations/shifts/open` | `fuel.shift.open` | Use idempotency; staffing assigned via separate endpoint |
| Assign staff | `POST /fuel-stations/shifts/{id}/staff` | `fuel.shift.open` | Existing client currently handles partial open/assign failure |
| Opening/closing nozzle meter | `POST /fuel-stations/shifts/{id}/meter-readings` | `fuel.shift.open` | Validate stage, asset, monotonic reading; don't interpret operational reading as booked sale |
| Tank readings for shift | `POST /fuel-stations/shifts/{id}/tank-readings` | `fuel.shift.open` | Physical/ATG are evidence, not book stock updates |
| Cash movement | `POST /fuel-stations/shifts/{id}/cash-movements` | `fuel.shift.cash_count` | Operational cash events, not standalone ledger transaction |
| Close shift | `POST /fuel-stations/shifts/{id}/close` | `fuel.shift.close` + `fuel.shift.cash_count` | Review actual closing request and variance logic |
| Approve shift | `POST /fuel-stations/shifts/{id}/approve` | `fuel.shift.approve` | Existing shift statuses are open/closed/approved; do not assume submitted/returned API states exist |
| Cash variance review | `POST /fuel-stations/shifts/{id}/cash-variance/review` | `fuel.shift.cash_variance_review` | Review is not automatically accounting settlement |
| Correction request | `POST /fuel-stations/shifts/{id}/corrections` | `fuel.shift.correct` | Check current correction lifecycle; never silently edit approved shift |
| Fuel sales list/create/finalize | `GET /fuel-stations/sales`, `POST /fuel-stations/sales`, `POST /fuel-stations/sales/{id}/finalize` | `fuel.sale.view/create/finalize` | Sales are distinct from meter evidence; avoid double-sale |
| Station payment methods | `GET /fuel-stations/stations/{stationId}/sale-payment-methods` | `fuel.sale.collect` | Cash/bank methods from AWJ; no static options |
| Collect sale payment | `POST /fuel-stations/sales/{id}/payments` | `fuel.sale.collect` | Existing payment service is financial source of truth |
| Fuel deliveries list/detail | `GET /fuel-stations/deliveries`, `GET /fuel-stations/deliveries/{id}` | `fuel_stations.view` | Station + warehouse scoped, paginated |
| Create fuel delivery | `POST /fuel-stations/deliveries` | `fuel_stations.manage` | Must validate request fields and pre/post tank evidence contract |
| Approve fuel delivery | `POST /fuel-stations/deliveries/{id}/approve` | `fuel_stations.manage` | Inventory mutation through existing receiving service |
| Supplier invoice/matching | `GET /fuel-stations/supplier-invoices`, `POST /fuel-stations/supplier-invoices/{id}/matches` | `fuel_stations.view/manage` | Keep operational receipt distinct from supplier invoice posting |
| Fuel dashboard/reports | `GET /fuel-stations/dashboard`, `GET /fuel-stations/reports/{family}` | `fuel.reports.view` | Currently under maintenance app entitlement in routing; assess before relying on it |

All names above are literal route paths; prefix with current AWJ API base path per existing shared client. Route existence **does not imply deployment verification or end-to-end readiness**.

## Confirmed implementation gaps / decisions before V2 writes
1. **Shift state mismatch:** design proposes `open → submitted → returned/approved`, but current model/controller support `open → closed → approved`. A real return-for-correction workflow must be specified/implemented; never fake a status in production.
2. **Per-operator vs per-station shifts:** current shift service and open-shift unique index may enforce *one open shift per station*. Determine how multiple attendants are assigned and hand over within one station shift; do not assume each attendant can open their own station-wide shift.
3. **Manual collection vs legal sales:** meter totals alone are not posted sales. Define a verified controlled summary-sale process (if required) that does not duplicate FuelSale/POS/forecourt transactions; do not post based solely on a UI KPI.
4. **Station product eligibility:** product registry is tenant-level; filter by actual nozzle/pump/station mapping and effective price, rather than presenting all registry fuel products as sellable.
5. **Receipt evidence:** confirm actual `StoreFuelDeliveryRequest` and service constraints on before/after readings, attachments and ongoing dispensing. Avoid implementing an attachment/measurement UI before backend contract verification.
6. **Profile and login:** reuse AWJ `/me`, session and password flows. No independent profile store or role editor.
7. **Pagination and reporting:** list endpoints paginate (typically 50); implement pagination/load-more and verify report schema/exports. Never show first page as entire historical totals.
8. **Tenant isolation:** smoke test two distinct tenants, different station assets/products and users; verify 403/404 isolation, cache boundaries and correct permissions across shift/receiving.
9. **Financial policy blockers:** open remediation decisions for cash variance settlement, multi-tank reconciliation, return/credit notes and pricing/taxes should remain governed by their existing owner-approved process; do not override from new UX.

## Suggested implementation slices
- **UI-0:** Read-only typed data adapters and station/product/pump/tank/nozzle selection; make screen states robust for empty/error/permission/loading.
- **UI-1:** Operator current-shift and actual product/meter display (read-only) with dynamic values and drill-down.
- **UI-2:** Opening/closing meter and cash workflow on controlled test tenant; reconcile with explicit backend contracts, implement safe feedback and confirm boundaries.
- **UI-3:** Supervisor queue with existing closed/approved states, then separately design return/correction state changes after backend approval.
- **UI-4:** Fuel receiving staged interface, validated against delivery request/service and real tank readings.
- **UI-5:** Reports, Settings/Profile, iPhone RTL/LTR accessibility and live production verification after gated rollout.

## Exit checks for UI-0
- A user with `fuel_stations.view` only sees authorized stations/assets/products; denied APIs do not crash unrelated sections.
- Switching station fully changes scoped data; no old station content is left on screen or cached under the wrong key.
- A product without a mapped nozzle is not shown as actively dispensable.
- Distinguish unavailable price/measurement from zero.
- No hard-coded station, seller, product, pump, nozzle or price in production data adapters.
- Automated tests verify permissions, source mappings, empty/error states and cross-tenant isolation.
