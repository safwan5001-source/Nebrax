# Serial / Lot / Expiry Tracking

**Status:** PLANNED

## Goal
Add detailed inventory identity while preserving the existing perpetual inventory and global moving-average valuation architecture.

## Prerequisites
PR-UOM-1, PR-PROD-LIFE-1, PR-INV-4 and stable warehouse workspace/data contracts.

## Identity model
Inventory state extends from Product×Warehouse to Product×Warehouse×Tracking Identity. Tracking identity is serial or lot/batch with optional manufacture/expiry metadata. Tracking quantities must reconcile exactly to warehouse base quantity for tracked Products.

## Product policy
Tracking mode is explicit per Product (none / serial / lot, exact enum to be finalized). Changing tracking mode after inventory-semantic footprint is a guarded identity mutation, not a casual edit.

## Serial invariants
A serial represents one base unit and cannot be simultaneously on hand in multiple warehouses/statuses. Duplicate serial identity rules are tenant-scoped and product association policy must be explicit.

## Lot invariants
Lot quantity is base quantity. Lot identity and expiry are historical operational facts. Same lot code merge/split rules must be deterministic.

## Transaction integration
Purchase receipt/opening/Stock Permit/transfer/sale/return/stocktake must either provide required tracking allocation or fail closed. Source and destination allocations for transfer reconcile exactly. No tracked movement may exist without the parent Inventory movement/effect.

## Expiry/FEFO
FEFO is an allocation/selection policy. It does not change valuation method. Expired/near-expiry policy and overrides are permissions/business rules, not hidden valuation behavior.

## Accounting
Tracking dimensions never create a separate valuation method. Sum of tracked base quantities = warehouse quantity; Inventory GL remains tied to subledger carrying value.

## Concurrency
Serial allocation and lot quantity consumption require atomic availability checks. Two sales cannot consume the same serial or lot availability.

## Stocktake
Tracked Products require count/reconciliation by tracking identity once this module is enabled; PR-INV-4 stale-snapshot safety remains foundational.

## Acceptance
No orphan tracking quantity, no duplicate active serial allocation, exact warehouse reconciliation, safe transfers/returns/counts, and no change to global moving-average accounting.