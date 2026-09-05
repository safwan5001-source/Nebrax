# Multiple UOM & Barcode Completion

**Status:** PLANNED / not implementation-authorized

## Goal
Complete the existing UOM foundation without rebuilding it. Base quantity remains inventory truth; commercial UOM is input/presentation; money is explicit per UOM and is never derived from conversion factor.

## Prerequisite gates
PR-UOM-1, PR-PROD-LIFE-1, PR-INV-3; PR-INV-1 before any cost-bearing import/export surface.

## Scope
- Product management UX for base + alternate units and alternate barcodes.
- Default sales UOM and default purchase UOM with validated current-template membership.
- Explicit unit prices per UOM; no factor-derived pricing.
- POS unit switching with server-authoritative conversion and explicit price availability.
- One tenant-wide primary+alternate barcode namespace from PR-UOM-1.
- Lossless workbook contract split into Products / Barcodes / Unit Prices.
- Historical transaction snapshots remain independent of later template edits.
- Live references fail closed when semantics become invalid.

## Data invariants
- `base_quantity = entered_quantity × validated historical/current factor` at the domain boundary that creates stock state.
- integer base-quantity architecture remains unless a separately approved fractional-base redesign occurs.
- `Product.unit == UnitTemplate.base_unit`.
- alternative unit factor is direct-to-base and >= 1.
- barcode can resolve a Product and optional valid UOM/default quantity, but never bypass tenant namespace or product eligibility.
- price lookup is explicit for requested UOM; absence is not silently synthesized from base price.

## UX contract
Image/card/list choices do not alter UOM semantics. Product Quick View may display available units/barcodes/prices subject to permissions. POS must clearly show selected UOM and quantity while stock availability is evaluated in base quantity.

## Import/export
Workbook round-trip owns master data only. Products sheet carries scalar Product fields; Barcodes sheet carries code/unit/default quantity; Unit Prices sheet carries explicit commercial prices. Stock balance/opening quantities never enter this workbook.

## Concurrency
Barcode writes/import apply use the atomic namespace. Unit/template edits must obey PR-UOM-1 semantic mutation guard. Import apply revalidates all live conflicts.

## Decisions not auto-resolved
Weighted Barcode and Product Variants/Attributes remain NEEDS DECISION. Soft-delete barcode reuse follows the explicit decision recorded by PR-UOM-1; no executor may invent policy.

## Acceptance
Base/alt sales and purchase paths, POS barcode/UOM selection, imports and exports all agree on the same unit identity; no unknown-unit fallback; no price derivation; no cross-tenant barcode collision; historical documents remain interpretable.