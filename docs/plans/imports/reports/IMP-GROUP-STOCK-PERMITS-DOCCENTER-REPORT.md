# Work group — Document Center routing (H5-S6) + stock permit import (H7-S3a/S3b)

## Done
| Slice | PR | Merge SHA | Scope |
|---|---|---|---|
| IMP-H5-S6 | #1726 | `e1ee5c1` | Document Center purchase/expense drafts require the financial gates and join the shared duplicate-reservation protocol (`source=document_center`); entry link from the purchase/expense wizards |
| IMP-H7-S3a | #1727 | `efdc5db` | `stock_permit_import` backend: one file = one draft permit, atomic, preview-bound only, header frozen, per-run zero-cost policy |
| IMP-H7-S3b | #1791 | `41c067d` | Wizard `/stock-permits/import` + list action; 18 tests |

## Review outcomes
- #1727: two Codex P2 fixed before merge — percent notation in the quantity column is a row error; `permit_type`/`permit_date`/`target_warehouse_id`/`reason` now take part in the frozen-option comparison (`options_frozen`). One sqlite-only failure (2 workbook tests, `preview_mismatch`) did not reproduce locally (46/46) and passed on the single permitted re-run; pgsql passed throughout.
- #1791: one Codex P2 fixed — a late inspection response is mapped with the permit type current at response time, not at send time.

## Tests
S3a: `StockPermitImportTest` 21 + `StockPermitImportEndpointsTest` 12 (SQLite + PostgreSQL). S3b: 18 web tests; full web suite 741 files / 8,854 tests green locally; CI green (php sqlite + pgsql, web build ×2, CI Gate). Mutation controls recorded in each slice report; one unobservable guard disclosed in S3b.

## Journal entries
None at import in any slice (drafts only). Posting an imported receipt (existing flow), 5 × 12.50 SAR: Dr 1140 Inventory 6,250 / Cr 5180 Manual inventory adjustment 6,250 halalas.

## Risks / open
- IMP-DOC-DISTINCT-01 (owner decision): Document Center cannot confirm a genuine identical repeat expense; refused fail-closed.
- IMP-STOCK-PERMIT-DEDUP-01: a permit has no external reference, so re-importing the same file creates a second draft.
- IMP-DOC-UNIT-REPAIR-01 remains open for document-unit domains.
- Roles holding only Document Center permissions can no longer create financial drafts (intended, H5-S6).
- Nothing deployed; no Railway/env change.

## Next
H8 Import Hub (visual research first). AI slices wait on X-01/OPS-02; H1-S6 #1626 stays Draft (D-13); H6 blocked on D-03.
