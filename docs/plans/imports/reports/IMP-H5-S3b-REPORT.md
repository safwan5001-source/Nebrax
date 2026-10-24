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

- `PurchaseImportTest` (32, SQLite + PG): contract has no derived/system fields; template round-trips onto every field; grouping into one draft with all lines and derived totals; **total parity with manual creation (inclusive and exclusive)**; file-total match / mismatch (no write); missing and symbol-only references never grouped; header conflict + inheritance; date rules; non-contiguous warning; same ref for different suppliers = two invoices; supplier resolution (code only, customer, inactive); default supplier; product resolution (id/sku/barcode, conflict, unknown, name not an identifier, inactive, variant-managed); numeric validation; warehouse option; bad options; existing/reserved/manual duplicate refused, delete-then-reimport succeeds; unit windows; `plan_drift` before any write; drafts + reservations only (no journal entry, stock movement or payment); failed apply leaves nothing; **posting an imported draft yields the same journal-line shape as a manual one**.
- `PurchaseImportConcurrencyPostgresTest` (2, real PG + `pcntl_fork`, fails rather than skips without pcntl): 6 concurrent imports of the same two-line file ⇒ exactly one draft with both lines and one reservation, losers fail as `ImportUnitFailureException`; 4 imports racing 4 direct creations under `block` (two spellings of the number) ⇒ one purchase. 3/3 runs green.
- Local-only failures present without this change: Fuel tests (no `bcmath`), 2 `InventoryOpeningZeroValueDateGuardTest` cases.

## Independent review (read-only subagent; not Codex) — findings and disposition

Verified by the reviewer as correct: grouping key = the same normalisation as the reservation predicate; derived total identical to the service (no discount/shipping, default rate and `0` handled); product resolution intersect logic; tenant isolation of every lookup; savepoint handling; window/plan numbering; duplicate rules aligned with S3a.

| # | Finding | Disposition |
|---|---|---|
| 1 | Warehouse option skips the actor's branch/warehouse permission (`assertWarehouseAllowed` in the controller) | **Hard H5-S4 requirement** (the service has no actor; the endpoint must call the same check before `apply`, with a negative test). Recorded in the Tracker; not exposed by this slice because nothing calls the service yet |
| 2 | A blank supplier cell on a continuation row took the run default and split the invoice (wrong supplier) | **Fixed**: a blank supplier inherits the single explicit supplier of the same normalised reference in the file; ambiguity (two explicit suppliers) never guesses — falls back to the default or a «supplier required» error. 2 tests |
| 3 | `TypeError` (int overflow in `PurchaseService::applyHeadAdjustments`) → 500 on a huge invoice the preview called valid | **Fixed in the importer**: derived invoice total above 50 M SAR is a row error `invoice_out_of_range` (test uses lines each inside the line cap). The service overflow itself is pre-existing and untouched (accounting code) — logged as **IMP-PURCHASE-OVERFLOW-01** |
| 4 | Bare `total` header auto-mapped to `invoice_total` (a per-line total column) | **Fixed**: bare `Total`/`الإجمالي` removed from the aliases; only «invoice total»/«grand total» map. Test |
| 5 | Plan code is only `c`/`e`; windowed runs return no plan; no whole-file precheck on window 1 | **Accepted, same as the sibling importer.** The S4 domain is preview-bound-only (unwindowed preview gates the run and its plan is compared per window), so a partial import caused by a later invalid invoice is excluded by construction; stated as an S4 invariant |
| 6 | `row_wider_than_header` fires on a single trailing delimiter | Accepted (same as expenses; fails closed with a clear message). Test pins it |
| 7 | Leniencies: `10%` accepted for quantity, zero price passes, date regex tolerates a trailing text | Accepted/noted (zero price mirrors `POST /purchases` `min:0`) |
| 8 | `RuntimeException` catch could put a `QueryException` (SQL + bindings) into a failure message | **Fixed**: `QueryException` is rethrown (chunk fails and rolls back; no SQL in user-visible messages) |
| — | Test gaps (cross-tenant, settings fallbacks, inactive warehouse, wide row, line cap, serial date, multi-line mismatch, concurrency loser code) | **Added** all except asserting the `duplicate_document` code for a concurrency loser: a late starter is stopped by the pre-check (`unit_invalid`) before the savepoint path, so the race outcome (one draft, one reservation, all losers named unit failures) is what is asserted |

## Journal entries

None — drafts only (asserted).
