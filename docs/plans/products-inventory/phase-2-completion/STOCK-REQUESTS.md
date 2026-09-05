# Stock Requests / Approval / Fulfillment

**Status:** PLANNED

## Goal
Add a non-financial internal request workflow that culminates in existing hardened Stock Permit movements.

## Prerequisites
PR-SEC-INV-1 and PR-INV-3. If Reservations are later used to earmark approved requests, that integration is a separate explicit design decision.

## Lifecycle
Draft → Submitted → Approved/Rejected → Partially Fulfilled → Fulfilled/Cancelled. Exact transitions require permission and audit actor/time.

## Invariants
Request, submission and approval have no stock movement and no GL entry. Only fulfillment through Stock Permit moves inventory/accounting. Requested/approved/fulfilled quantities are base-quantity-safe with commercial UOM snapshots where users enter alternative units.

## Scope
Source/requesting warehouse/branch context, requested Products/quantities, reason/notes, approval, partial fulfillment, linked Stock Permit(s), remaining quantity, status history.

## Fulfillment
Creates or explicitly links Stock Permit draft(s) using hardened source/target authorization and UOM semantics. Cross-branch transfer accounting remains owned by StockPermitService. A request cannot be marked fulfilled beyond approved quantity.

## Concurrency/idempotency
Two fulfillment attempts cannot both consume the same remaining approved quantity. Retry of a fulfillment command must not create duplicate permits.

## Permissions
Separate request/approve/fulfill capabilities may be introduced deliberately; do not overload generic Product manage if the project permission model supports domain permissions. Tenant and warehouse access apply at every direct action.

## Acceptance
No stock/GL before fulfillment; partial quantities reconcile; linked permits explain all fulfillment; denied warehouse users cannot access by UUID; duplicate fulfillment is prevented.