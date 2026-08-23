# Fuel Stations — Cycle 0 Foundation Implementation

> **Status:** Implemented on `fuel-stations-cycle-0-foundation`; pending full verification, peer review, and PR merge.
>
> **Scope:** This record implements the foundation prescribed by `FUEL_STATIONS_MASTER_PLAN.md` and `FUEL_STATIONS_MASTER_EXECUTION_PROMPT.md`. It does not replace either source of truth.

## 1. Boundary and invariants

Fuel Stations is a dedicated Nebrax workspace and a single commercial product, `fuel-stations`. It is **not** a parallel ERP: accounting, inventory valuation, invoicing, ZATCA, tenant application state, entitlement resolution, roles, audit conventions, and branch context remain owned by the existing platform services.

The first built capability is `fuel_stations.core`. It has no technical dependency because it establishes the station ownership and configuration boundary; future fuel-specific capabilities depend on it and remain `coming_soon`, hence cannot be granted or operationally enabled. Product version `fuel-stations` v1 is published with `fuel_stations.core` only. The migration creates no plan assignment, add-on, trial, entitlement, tenant application state, or production enablement.

| Concern | Cycle 0 decision |
|---|---|
| Commercial lifecycle | Reuse commercial products, product versions, assignments, lifecycle transitions, materialized entitlements, and the `FULL` / `READ_ONLY` / `DENIED` resolver. |
| Operational state | Reuse `TenantApplicationState`. New station evidence changes an application disable into `suspended` rather than erasing operational history. |
| Authorization | New Fuel Stations API routes require route RBAC **and** `ApplicationAccessDecision`; no navigation state or rollout cohort can authorize a request. |
| Tenant/branch ownership | `FuelStation` is `CompanyWide`: central administrators may manage all tenant stations, while `branch_id` is the verified accounting/operations mapping for later records. Integration evidence is `BelongsToBranch`. |
| Data integrity | UUID identities, tenant scopes, FK restrictions, source-event uniqueness, source-sequence uniqueness, append-only configuration/events, and database-backed idempotency are the persistence boundary. |
| Financial effects | None in Cycle 0. No ledger posting, inventory movement, invoice, ZATCA document, settlement, price, sale, or payment is generated. |

## 2. Foundation persistence

`fuel_stations` contains only organizational identity, code, branch mapping, lifecycle status, timezone, and operating-day start. It deliberately has no tank, nozzle, meter, fuel sale, stock, cash, or accounting attributes.

`fuel_station_setting_overrides` stores station and device/terminal overrides. Effective configuration is resolved in this fixed order:

```text
System default → tenant Settings[fuel_stations] → station override → device/terminal override
```

Every accepted tenant, station, or device override writes an immutable `fuel_station_configuration_events` record with tenant, station/device scope, before/after values, actor, reason, and timestamp. Repeating an identical override is idempotent and writes no duplicate audit record.

`fuel_station_integration_events` is an append-only normalized ingress journal. It accepts an adapter-normalized event only once per `(tenant_id, source_id, event_id)`, rejects reuse of a source sequence by a different event, records a canonical payload checksum, and rejects a replay whose event identity has a different payload. Cycle 0 only acknowledges an event; processing, retries, protocol drivers, device registration, credentials, health monitoring, queueing, and field-device networking are intentionally outside this cycle.

## 3. Integration contracts and event vocabulary

`FuelStationDeviceAdapter` is the only vendor/protocol seam in Cycle 0. It receives `FuelStationDeviceIdentity` and returns `FuelStationNormalizedEvent`; adapters do not create financial or inventory effects directly. The initial event vocabulary is a documented contract, not a promise that all producers already exist:

| Area | Contract event families |
|---|---|
| Station and configuration | `station.created`, `station.configuration.changed` |
| Tank and ATG | `atg.reading.recorded`, `tank.alarm.raised`, `tank.alarm.cleared` |
| Forecourt | `forecourt.transaction.recorded`, `pump.status.changed`, `nozzle.meter.recorded` |
| Shift | `shift.opened`, `shift.closed`, `shift.approved` |
| Fuel movement | `fuel.delivery.received`, `fuel.inventory.reconciled` |
| Devices | `device.health.changed`, `device.connection.changed` |

Events requiring their operational aggregates will be emitted and consumed only in the cycle that introduces that aggregate. This prevents a device webhook or UI action from manufacturing accounting or stock evidence prematurely.

## 4. Workspace and access chain

The `/fuel-stations` workspace is deliberately a foundation shell: it displays registered stations, tenant-level foundation settings, and the capabilities that remain deferred. Its backend endpoint is independently protected and fails closed unless all of the following are true:

1. The caller has `fuel_stations.view` through Nebrax RBAC.
2. `fuel_stations.core` is built and operationally enabled.
3. The tenant has effective commercial access to the capability.
4. The entitlement/lifecycle decision permits the requested operation.

The sidebar uses `fuel_stations.core` only for presentation visibility. It is not an authorization surface.

## 5. Explicitly deferred work

| Target cycle | Deferred work | Reason for deferral |
|---|---|---|
| Cycle 1 | Station CRUD, branch mapping UI, fuel products, tanks, pumps, nozzles, calibration, and physical device registry. | These are master-data aggregates, not a safe consequence of a foundation endpoint. |
| Cycle 2 | Fuel inventory ledger, physical/book/ATG reconciliation, loss/gain, stocktake, costing, and accounting mapping. | Requires fuel movement invariants and reuse of the existing inventory/ledger engines. |
| Cycle 3 | Suppliers, tanker compartments, delivery/receiving, variances, approval, and PO matching. | Requires fuel product and tank ownership first. |
| Cycle 4 | Shifts, opening/closing readings, cash, approvals, correction/locking, and forecourt operations. | Requires pump/nozzle/tank master data and controlled reading workflows. |
| Cycle 5 | Fuel sales, POS, payments, refund/void controls, invoice/ZATCA linkage, settlement, and journal posting. | Financial impact is prohibited until the operational source data and reversal strategy exist. |
| Cycle 6 | Corporate contracts, fleet, vehicle, driver, cards, credit, and pricing. | Requires sales/customer foundation and explicit credit/risk rules. |
| Cycle 7 | RFID/AVI authorization and fueling execution. | Requires registered devices, vehicle/card identities, and a safe authorization policy. |
| Cycle 8 | Device registry, credentials, adapters, health, polling/webhooks, store-and-forward delivery, replay tooling, and operational integration monitoring. | Cycle 0 defines only the stable adapter/normalized-event seam. |
| Cycle 9 | Maintenance, safety, financial/reporting controls, reconciliation dashboards, cutoff, production rollout, and operational runbooks. | Requires finalized domain records and live acceptance evidence. |

## 6. Cycle 0 non-negotiable checks

The implementation must retain test coverage for the commercial product composition, fail-closed route access, role denial, tenant/station/device inheritance, configuration audit evidence, canonical event replay, and sequence collision rejection. Full SQLite, PostgreSQL, frontend test, and frontend build validation remain required before PR creation.
