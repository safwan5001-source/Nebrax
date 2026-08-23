# Cycle 8 — Forecourt, ATG & Device Integration Platform Design

> **Status:** Approved implementation design for Cycle 8.
>
> **Scope:** A vendor-neutral, tenant-safe device registry and normalized-event platform. This cycle establishes device identity, lifecycle, health, replay protection, auditability, and simulated drivers. It does **not** connect to a physical vendor, open a pump, poll an ATG, or persist a raw device secret.

## 1. Architectural decision

The existing normalized event boundary is retained and strengthened:

```text
Managed device registry
  → vendor-neutral adapter / fake driver
  → FuelStationNormalizedEvent
  → idempotent integration-event ledger
  → normalized platform processing
  → future domain consumer
```

The fuel business domain receives only stable event types and normalized payloads. It must not infer a manufacturer, transport protocol, credential, or network endpoint. Device events remain operational evidence; ATG and forecourt events must not alter inventory, invoices, payments, or journals in this cycle.

## 2. Device registry

`FuelStationDevice` will be station-owned and branch-scoped, with the following fields:

| Area | Fields | Rule |
|---|---|---|
| Identity | `device_key`, name, type, external identifier | `device_key` is a stable non-secret source identity, unique per tenant. |
| Vendor metadata | adapter key, manufacturer, model, serial, firmware, protocol | Informational and validated against known adapter contracts; never drives business logic directly. |
| Network metadata | safe JSON endpoint metadata | No password, token, private key, or raw credential is permitted. |
| Credential indirection | credential reference | Opaque vault/reference name only; the application never returns it as a usable secret. |
| Lifecycle | active, disabled, retired | Historical devices are disabled/retired rather than deleted once events exist. |
| Operations | health, sync state, last seen, last event, last failure | Derived only from accepted/failed normalized processing; no hidden polling worker is introduced. |

Supported types in this cycle are `forecourt_controller`, `atg`, `rfid_reader`, `payment_terminal`, and `station_gateway`. These values describe the intended contract, not a proprietary vendor connection.

## 3. Event contract and offline safety

Every source event continues to require a globally unique `event_id`, source identity, occurrence time, normalized type, payload checksum, optional source sequence, and optional correlation ID. Cycle 8 binds `source_id` to an active registry device and adds a foreign reference for audited traceability.

The database remains the final replay/concurrency boundary. Duplicate `(tenant, source, event_id)` records return the original only when the canonical payload checksum matches. Reuse of an event ID with different data, reuse of a source sequence, a disabled/retired device, mismatched station, or adapter/type mismatch fails closed. A device event must never be silently reinterpreted as a new fuel sale, stock movement, or financial document.

Event receipt updates the device to `online` and records safe last-seen metadata. Processing success is explicit. Processing failure records an immutable failure reason and retry counter; manual retry is a controlled action that retains the original event identity. This cycle exposes failure visibility and retry contract but does not run a background retry daemon.

## 4. Adapter and fake-driver boundary

`FuelStationDeviceAdapter` remains the sole transformation boundary. Adapters must announce their adapter key and supported device types, then produce only `FuelStationNormalizedEvent` instances. Three deterministic test doubles will exercise the contract:

- `FakeForecourtDriver` for pump status, nozzle meter, and forecourt transaction evidence;
- `FakeAtgDriver` for ATG readings and tank alarms;
- `FakeRfidDriver` for vehicle identity evidence.

No adapter opens a pump, calls an external URL, starts a socket, or contains vendor credentials. The RFID fake driver emits `vehicle.identified`; the existing Cycle 7 authorization service remains the only owner of a later authorization decision.

## 5. Settings, access, and audit

Integration policy belongs to the existing hierarchy: system default → tenant → station → managed device. New policy keys cover future-skew tolerance, stale/offline threshold, maximum retained retry attempts, and whether operator-initiated simulated ingress is allowed. Pricing, credit, fleet, AVI authorization, and accounting settings remain prohibited from device-level overrides.

Permissions are separated into `fuel.device.view`, `fuel.device.manage`, `fuel.integration.view`, `fuel.integration.ingest`, and `fuel.integration.retry`. They are enforced by the backend together with the existing `fuel_stations.integrations` capability and commercial/tenant-state guards. Device lifecycle changes, event ingestion, retries, and health transitions produce safe audit records without raw payload credentials or tokens.

## 6. UI/API surface

The cycle adds a Devices & Integrations screen under Fuel Stations. It contains a dense device registry, health/sync summaries, paginated event ledger, error/failure visibility, and a controlled simulated-event dialog for authorized operators. The UI is RTL-first, bilingual, responsive, and never treats navigation visibility as authorization.

## 7. Explicit deferrals

| Deferred item | Reason | Target |
|---|---|---|
| Vendor SDK/driver, field protocol, webhook, polling, TCP/MQTT, or permanent gateway process | No selected vendor or documented physical-device contract. | Vendor integration phase after Cycle 8. |
| Raw device secret storage, mTLS material, or production device authentication | Requires an approved secret-vault and vendor identity design. | Vendor/security rollout. |
| Pump authorization command | Must be coupled to selected controller safety contract, not simulated from ERP. | Forecourt vendor phase. |
| ATG-driven inventory reconciliation or accounting | ATG is evidence only; reconciliation and approved adjustments remain distinct financial workflows. | Cycle 9 / approved reconciliation expansion. |
| Background retry/polling service | The persistence contract is established; a durable runner depends on the selected deployment/vendor model. | Vendor integration rollout. |

## 8. Acceptance criteria

The implementation is complete when a simulated forecourt, ATG, or RFID event can be normalized through a declared adapter, accepted once for its managed device, recorded with device/station/tenant provenance, processed without a vendor-specific branch in the fuel core, safely replayed only when identical, and surfaced in the ledger without any accounting or inventory side effect.
