# PR-UOM-1 — In-use UOM Integrity + Barcode Namespace

**Priority:** P1  
**Status:** PLANNED

## Confirmed problems

- UnitTemplate base/factor/name mutation can reinterpret current stock/live references.
- linked `Product.unit` can diverge from `UnitTemplate.base_unit`.
- string-based ProductBarcode/PriceListItem/Held POS Cart UOM references can become stale.
- primary + alternate barcode validation is asymmetric and not an atomic tenant-wide concurrency boundary.

## Invariants

1. Linked Product: `Product.unit === UnitTemplate.base_unit`.
2. Once a Product has inventory-semantic footprint, UOM base/factor changes cannot reinterpret that footprint.
3. Live references either remain valid under explicit migration or fail closed; no silent factor substitution.
4. Unknown unit never becomes factor 1.
5. Quantity conversion never derives price.
6. `Primary Barcode ∪ Alternate Barcodes` is one tenant-wide namespace with atomic uniqueness.

## Mutation classification

Implementation must distinguish harmless metadata edits from semantic edits:
- semantic: base unit change, factor change, rename/delete where persisted refs use the name;
- potentially safe additions: new alternative unit with unique valid name/factor, subject to namespace/reference rules.

Use centralized inventory-footprint/lifecycle evidence rather than scattered controller guesses where possible. Coordinate with PR-PROD-LIFE-1 contract; do not create a second incompatible reference registry.

## Live references

At minimum inspect and protect ProductBarcode, PriceListItem and held POS carts. Posted historical document snapshots are history and must remain interpretable without current template mutation rewriting them.

## Barcode namespace

Application `exists()` checks across two tables are insufficient under concurrency. Implementation must establish an authoritative tenant namespace with DB-enforceable uniqueness or equivalently atomic serialization. Product create/update/import, alternate barcode writes and future workbook import must all use it.

### NEEDS DECISION

Production reuse of a barcode from a soft-deleted/deactivated Product. Do not decide this silently. Safer default in planning is no reuse while historical identity may exist.

## Pre-production migration policy

Current duplicate/demo data need not be preserved. Migration may fail with a clear diagnostic or clean/reset demo conflicts as explicitly documented; do not weaken final uniqueness to accommodate test rows.

## Tests

- linked Product/base invariant;
- semantic edits before any footprint vs after footprint;
- factor/base/name rename/delete;
- add safe alternative unit;
- stale barcode/price-list/held-cart behavior fails closed;
- historical posted snapshots remain readable;
- primary↔primary, primary↔alternate, alternate↔alternate conflicts within tenant;
- same barcode in different tenants allowed;
- concurrent conflicting writes yield one winner/no duplicate;
- Product import conflict uses same namespace;
- no money derivation from factor.

## Out of scope

Full Multiple UOM UX/workbook, default sales/purchase UOM, weighted barcode, variants, Serial/Lot/Expiry.