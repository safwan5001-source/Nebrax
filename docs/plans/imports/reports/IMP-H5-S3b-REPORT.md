# IMP-H5-S3b — Purchase import service (invoice = unit, drafts only)

**Branch:** `claude/imp-h5-s3b-purchase-import-service` (stacked on S3a / PR #1705). **Service only:** no import-job domain, no route, no permission, no migration, no UI (those are H5-S4). Nothing in production calls it yet. No ledger/accounting/ZATCA change; the import never posts, receives stock, or pays.

## What it does

`PurchaseImportService` (+ `PurchaseImportFields`, the single source of truth for columns) — `inspect` · `template` · `preview` / `previewWithPlan` · `apply`. Same shape as `ExpenseImportService`, but the **execution unit is the whole supplier invoice**:

- Rows (= invoice lines) are grouped by **supplier ‖ normalised `supplier_invoice_ref`** into one `PurchaseService::create` draft with all its lines, in first-appearance order.
- **The reference is required.** A row without a supplier or without a usable reference (blank or symbols-only) is its own broken unit — never grouped under `(supplier, null)`, which would merge different invoices.
- **Totals are derived, never entered.** The importer derives the invoice total with the same `ComputesLineTax` the service uses; the optional `invoice_total` column is compared with it and any difference is a visible error (nothing is written or overwritten). A test proves imported subtotal/tax/total equal a manual `create()` of the same items, inclusive and exclusive.
- **Header fields** (date, due date, payment type, notes, file total): first non-blank value in the group wins; a later row that contradicts it is an explicit error on that row; blanks inherit. Date is required somewhere in the invoice; due date before invoice date is an error.
- **References by trusted identifiers:** supplier by code (active supplier) or a run-level default supplier; product by Nebrax ID / SKU / barcode (all given identifiers must resolve to the *same* active product; ambiguity is an error; **name is never an identifier**); variant-managed products are a row error (the import cannot choose a variant); warehouse from a run option (validated). No auto-creation of anything.
- **Policies per run** (CLAUDE.md rule 6): `default_supplier_id`, `default_payment_type`, `default_tax_rate`, `tax_inclusive`, `warehouse_id`; absence = the tenant's `purchases.*` preference inside the service. Out of v1 on purpose: invoice-level discount/shipping/adjustment and line discounts (editable on the draft).
- **Duplicates:** before writing, the window's units are compared with existing purchases of the same supplier by normalised number (covers manual purchases and reserved drafts); a match is an error (no "confirm repeat" in this domain — the identity is exact). At write time `PurchaseService` reserves the identity (S3a), so a concurrent duplicate fails as a named unit failure.
- **Windows count units (invoices), not rows**: `batch_offset`/`batch_size` slice the invoice list, so an invoice is never split across chunks (test: an invoice whose rows straddle the would-be row boundary). Plan = `{first sheet row of unit → 'c'|'e'}` for `plan_drift`.
- Non-contiguous rows of one invoice are grouped with a visible warning ("make sure this is one invoice, not a pasted duplicate").

## Disclosures

- Quantities are integers (`PurchaseLine.quantity` is int and the API validates `integer`); fractional quantities are a row error, same as the API.
- Date/money cell parsing is a copy of the expense importer's (private methods). Extracting a shared normaliser would touch the expense importer; logged as **IMP-CELL-NORMALIZER-01** instead of widening this slice.
- Domain registration, endpoints, durable chunk adapter, failure export and the wizard are H5-S4 (the unit ordinal in failures is the invoice ordinal; `total_units` is returned beside `total_rows` for the engine's progress count).
- Per-invoice errors are returned for the *whole* window before any write (`unit_invalid`), so a window with one bad invoice writes none of its invoices — same all-or-nothing chunk rule as the other row domains.

## Tests

- `PurchaseImportTest` (24, SQLite + PG): contract has no derived/system fields; template round-trips onto every field; grouping into one draft with all lines and derived totals; **total parity with manual creation (inclusive and exclusive)**; file-total match / mismatch (no write); missing and symbol-only references never grouped; header conflict + inheritance; date rules; non-contiguous warning; same ref for different suppliers = two invoices; supplier resolution (code only, customer, inactive); default supplier; product resolution (id/sku/barcode, conflict, unknown, name not an identifier, inactive, variant-managed); numeric validation; warehouse option; bad options; existing/reserved/manual duplicate refused, delete-then-reimport succeeds; unit windows; `plan_drift` before any write; drafts + reservations only (no journal entry, stock movement or payment); failed apply leaves nothing; **posting an imported draft yields the same journal-line shape as a manual one**.
- `PurchaseImportConcurrencyPostgresTest` (2, real PG + `pcntl_fork`, fails rather than skips without pcntl): 6 concurrent imports of the same two-line file ⇒ exactly one draft with both lines and one reservation, losers fail as `ImportUnitFailureException`; 4 imports racing 4 direct creations under `block` (two spellings of the number) ⇒ one purchase. 3/3 runs green.
- Local-only failures present without this change: Fuel tests (no `bcmath`), 2 `InventoryOpeningZeroValueDateGuardTest` cases.

## Journal entries

None — drafts only (asserted).
