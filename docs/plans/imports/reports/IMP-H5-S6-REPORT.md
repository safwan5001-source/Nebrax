# IMP-H5-S6 — Document Center drafts join the financial gates and the shared duplicate protocol

**Branch:** `claude/imp-h5-s6-document-center`. **No migration, no new permission, no env change.** Drafts only: no journal entry, no stock movement, no payment, no ZATCA effect at draft time; a later `post()` goes through the existing services unchanged. So there is **no new accounting operation** to tabulate.

## What changed
1. **Gates first (rule 7).** `POST document-batches/{batch}/create-purchase-draft` now also requires `purchases.manage` + `purchases.cycle` (the gates of `POST purchases`), and `create-expense-draft` requires `expenses.manage` + `finance.operations` (the gates of `POST expenses`), on top of `documents.center.build_draft` + `document_center.core`. **Deliberate behaviour change:** a role holding only the Document Center permissions can no longer create a financial draft; a disabled target application blocks it. Document Center is Stage 0 and off by default.
2. **Shared duplicate protocol.** Both builders now call the document services with `source = document_center`:
   - `PurchaseDocumentDraftBuilder` → `PurchaseService::create($data, $items, ['source' => document_center])`: identity = supplier ‖ normalized supplier invoice number (already mandatory in the builder's header).
   - `ExpenseDocumentDraftBuilder` → `ExpenseService::create($data, ['source' => document_center, 'reference' => <reviewed document number>])`: identity = vendor ‖ date ‖ amount, the reviewed document number as the reference.
   - **The services write the single reservation**; the builders never touch `import_document_reservations`. A duplicate raises `DuplicateDocumentException` inside the builder's transaction: the workflow transition rolls back, the batch stays `ready_for_draft`, and the API answers 422 `{reason: "duplicate_document"}` (the exception's own renderer).
   - Result: two batches of the same invoice cannot both create drafts, and a spreadsheet/AI import and a Document Center draft of the same invoice collide **in both orders**.
3. **UI entry link.** The purchase and expense import wizards show «open the Document Center» (`DocumentCenterEntryLink`), visible under the sidebar's own rule: `document_center.core` effective in `GET /applications/nav-state` and `documents.center.view`; a failed capability fetch hides nothing.

## Not done as written in the plan (disclosed)
- The plan says the builders "call the same adapter `validateRow()`/`plan()`". The adapters expose no such methods (they are file-oriented); the shared behaviour that matters — the existing-document lookup and the reservation — lives in `PurchaseService`/`ExpenseService`, which both paths already use. The builders keep their own extraction and review validation.
- **Distinct-occurrence confirmation for Document Center expenses is not built.** The spreadsheet wizard lets the user confirm a genuine repeat (same vendor, day and amount) with an occurrence id; the Document Center has no such step, so an identical repeat is refused (fail-closed). This is a business-policy choice (CLAUDE.md rule 6) → follow-up **IMP-DOC-DISTINCT-01**, needs an owner decision before building.
- Purchases and expenses created manually keep the tenant's `allow | block` policy; unchanged.

## Tests
- `DocumentPurchaseDraftBuilderTest` +7 (40) and `DocumentExpenseDraftBuilderTest` +6 (19), SQLite and PostgreSQL: both gates (permission-only role refused, target app disabled refused, role with both accepted); the reservation carries source `document_center`, the counterparty and the predicate; a second batch of the same invoice (written differently) is refused with no partial state; a different number/amount is allowed; a standard-import document and the Document Center collide in both orders.
- `PurchaseDuplicateReservationConcurrencyPostgresTest` +1 (6): Document Center, standard and AI sources racing for one invoice (six real processes) → exactly one purchase, one reservation, losers get `DuplicateDocumentException`. (The protocol itself is the S3a service code; this proves the third source joins it.)
- `DocumentCenterEntryLink.test.tsx` 4.
- Mutation controls (each fails tests when applied): reservation argument removed (purchase 4, expense 4 failures) · route gates removed (purchase and expense gate tests) · expense reference dropped · link ignoring the capability / the permission / hiding on a failed fetch.
- The 45 pre-existing builder tests pass unchanged.

## Risks
- Roles that today create Document Center drafts without `purchases.manage`/`expenses.manage` will get 403 after deploy — intended (rule 7); the report is the notice.
- A genuine identical-repeat expense through the Document Center is refused until IMP-DOC-DISTINCT-01.
