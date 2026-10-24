# IMP group report — purchases import, stocktake/expense/taxonomy wizards

**Window:** 2026-10-23 → 2026-10-24 · **Scope:** H5-S2b, H7-S1c, H5-S3a/b, H5-S4a/b, H4-S6a. All merged to `main` by squash after green CI (SQLite, PostgreSQL, web build, CI Gate) and a clean Codex pass on the final head. No deploy, no operational migration, no Railway change.

## Done

| Slice | What | PR | Merge SHA |
|---|---|---|---|
| H5-S2b | Expense import wizard (UI) | #1702 | `757bc6c` |
| H7-S1c | Stocktake count-sheet wizard (UI) | #1704 | `7713c7b` |
| H5-S3a | `PurchaseService` owns the supplier-invoice reservation lifecycle + `purchases.duplicate_reference_policy` (allow \| block) | #1705 | `566b9d7` |
| H5-S3b | Purchase import service: invoice = execution unit, derived totals, trusted references, duplicate protection | #1708 | `f55b4eb` |
| H5-S4a | `purchase_import` durable domain: frozen-option recount, preview endpoints, per-chunk actor warehouse check | #1710 | `7b2f838` |
| H5-S4b | Purchase import wizard (UI) | #1712 | `dd63546` |
| H4-S6a | Categories & brands import wizard (UI) | #1713 | `a3aa266` |

Accounting effect of every slice: **none** — imports create drafts only; no journal entry, stock movement or payment is created at import (so no ledger table applies).

## Changed files (main areas)
- Backend: `PurchaseService`, `PurchaseImportService`, `PurchaseImportAdapter`, `PurchaseImportFields`, `ImportJobDomain`/registry, `ImportDomainAdapter::recountOnFirstApply`, `Settings`, purchase-import controller/requests/routes.
- Web: `modules/purchases/import/*`, `modules/product-taxonomy/import/*`, expense and stocktake wizards, `import-jobs/client.ts`, ar/en messages, page entries and import buttons.
- Docs: per-slice reports, Tracker.

## Tests
- Backend: `PurchaseDuplicateReservationTest` 22, `PurchaseDuplicateReservationConcurrencyPostgresTest` 5, `PurchaseImportTest` 33, `PurchaseImportConcurrencyPostgresTest` 2, `PurchaseImportEndpointsTest` 21. Guards (recount, per-chunk warehouse check, unit-count guard, preference freeze) are mutation-verified.
- Web: purchase wizard 14 + contract, taxonomy wizard 15 + contract; the repair-child resume test fails when the `frozenJob` predicate is reverted.

## Review findings fixed along the way
Foreign-domain job continue (both new wizards), repair-child resume without preview binding (both), stepper jump to a missing preview, stuck-`ready` job after recount failure, unfrozen tax preferences, mid-run unit-count change, `invoice_total` template mismatch, nullable default-tax-rate round-trip, SQLite-only uppercase-UUID test removed, redundant advisory lock removed (unique key arbitrates).

## Risks / limits
- Older wizards (Partner, expense, stocktake, product) still lack the hardening: **IMP-WIZARD-STATE-01**.
- Purchases have no per-invoice failure ledger or repair file; a later failing chunk leaves earlier drafts (next preview refuses them as duplicates): **IMP-DOC-UNIT-REPAIR-01**.
- Pre-existing int overflow in `PurchaseService::applyHeadAdjustments` is guarded only in the importer (50 M SAR cap): **IMP-PURCHASE-OVERFLOW-01**. Date/money parsing is copied from the expense importer: **IMP-CELL-NORMALIZER-01**.
- Component tests only on the UI; no screenshots. AI Actions execution remains an independent operational blocker (**OPS-02**); nothing here bypasses platform controls.
- Held: H1-S6 #1626 (D-13); H6 (D-03); AI slices behind X-01/OPS-02.

## Next
H4-S6b price-list-items wizard → H4-S6c unit-templates wizard → IMP-WIZARD-STATE-01 hardening (engine-level `resume` domain check) → H5-S6 / H7-S3 / H8.
