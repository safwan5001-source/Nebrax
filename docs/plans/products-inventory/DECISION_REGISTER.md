# Products & Inventory — Decision Register

This register prevents executors from silently resolving owner-level product/accounting decisions.

| ID | Decision | Current state | Default planning posture | Blocking scope |
|---|---|---|---|---|
| D-01 | Barcode reuse after Product soft-delete/deactivation | NEEDS DECISION | do not reuse while historical identity may exist | PR-UOM-1 final schema/policy if unavoidable |
| D-02 | Weighted Barcode | NEEDS DECISION | not implemented | Multiple UOM/Barcode completion |
| D-03 | Product Variants/Attributes | NEEDS DECISION | not implemented | Product master expansion |
| D-04 | Reservation overcommit when negative stock is allowed | NEEDS DECISION | do not silently over-reserve | Reservations |
| D-05 | Reservations for approved Stock Requests | NEEDS DECISION | independent workflows initially | Stock Requests/Reservations integration |
| D-06 | Expired-stock issue/sale override policy | NEEDS DECISION | fail closed until designed | Serial/Lot/Expiry |
| D-07 | Per-warehouse costing | DECIDED: NO in current program | global Product moving average | any valuation work |
| D-08 | Product Catalog import stock effects | DECIDED: NO | master data only | Imports |
| D-09 | Inventory Opening branch model | DECIDED | CompanyWide header; warehouse/branch at lines/effects | Opening workflows |
| D-10 | Automatic replenishment/PO | DEFERRED | recommendations only | Low Stock Phase 3 |
| D-11 | Manufacturing/BOM | DEFERRED | no implementation | later roadmap |

## Rule
If an implementation cannot proceed without a NEEDS DECISION item, Claude Code must stop and report the exact decision surface and alternatives. It must not choose a product/accounting policy to keep coding.