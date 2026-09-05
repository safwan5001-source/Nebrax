# Reservations & Availability

**Status:** PLANNED

## Goal
Represent durable stock commitments without falsifying physical on-hand inventory.

## Canonical quantities
- On Hand: physical/perpetual inventory subledger quantity.
- Reserved: active durable commitments not yet consumed/released.
- Available: On Hand − Reserved.

Reservation has no stock movement and no GL effect.

## Prerequisites
PR-INV-4 and stable warehouse identity. If Serial/Lot is enabled for a Product, reservation granularity/allocation policy must integrate with tracking identity rather than create a parallel truth.

## Reservation record
Tenant, source type/id, Product, warehouse, base quantity, status, expiry/release metadata, idempotency/source key and audit actors. Branch access follows warehouse/source authorization.

## Lifecycle
Create/adjust → active → consumed or released/expired/cancelled. Consumption links to the authoritative stock-moving transaction; it must not double-decrement inventory.

## Concurrency
Reservation creation/adjustment must atomically enforce the chosen availability policy. Concurrent requests cannot over-reserve when policy forbids it. Source retries are idempotent.

## Negative stock interaction
Do not assume `allow_negative_stock` automatically means unlimited reservation. Reservation policy must be explicit; default planning posture is that commitments should not silently exceed available stock unless an authorized business rule says so.

## Sales/POS integration
Reservation is optional workflow state, not a replacement for final checkout stock validation. Final stock-moving transaction revalidates authoritative inventory and consumes/releases reservation atomically where applicable.

## Reporting
Workspace can add Reserved and Available only after this canonical ledger/state exists. Historical released reservations must not inflate current reserved totals.

## Acceptance
On Hand never changes from reservation alone; Reserved totals equal active records; Available is deterministic; retries/concurrency cannot duplicate commitments; consume/release is exactly-once; tenant/warehouse access is enforced.