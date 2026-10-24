# IMP-H5-S4a — Purchase import: durable job domain, adapter and preview endpoints (backend)

**Branch:** `claude/imp-h5-s4a-purchase-import-domain` (stacked on S3b / PR #1708). **No migration, no new permission, no ledger/accounting/ZATCA change.** Drafts only: no journal entry, stock movement or payment. The wizard UI is H5-S4b.

## What changes

- **Domain `purchase_import`** (`ImportJobDomain`): preview-bound only; gates = the direct `POST /purchases` gates (`purchases.view` / `purchases.manage` + `EnsureApplicationActive:purchases.cycle`). Registered in `ImportDomainRegistry` with `PurchaseImportAdapter`.
- **`PurchaseImportAdapter`** — `UNIT_DOCUMENT`: the engine's cursor (`processed_rows`), chunk window (`batch_offset`/`batch_size`) and completion all count **invoices**, so an invoice is never split across chunks and a chunk holds N whole invoices. Each chunk re-checks the frozen preview plan (`plan_drift`).
- **`row_count` is recounted in invoices at first apply.** At job creation the engine only knows the file (no column mapping, no default supplier), so `row_count` is the data-row count — an upper bound. `ImportDomainAdapter::recountOnFirstApply` gained an optional third argument `array $frozenOptions = []` (the three existing implementations take it and ignore it; the engine passes the frozen options), and the purchase adapter returns `PurchaseImportService::unitCount()` computed with the **frozen** mapping/defaults. Without it `processed_rows` (invoices) could never reach `row_count` (rows) — a mutation run proves two tests fail without the recount.
- **Endpoints** `GET purchases/import/{template,fields}`, `POST purchases/import/{inspect,preview}` (registered before `purchases/{id}`; `EnsureImportFilesScanned` on uploads). Preview issues the single-use binding with the invoice plan. **No synchronous apply** (404 asserted).
- **Warehouse permission on the actor (S3b review finding #1, hard requirement):** `PurchaseImportService::assertWarehouseAccess()` applies the same rule as `ApiController::assertWarehouseAllowed` (warehouse + its branch must be inside the actor's grants) at preview **and at every chunk**; a user whose warehouse scope is withdrawn between preview and apply fails the chunk with nothing written.
- **Option plumbing:** `default_supplier_id`, `default_payment_type`, `default_tax_rate`, `tax_inclusive`, `warehouse_id` in `StoreImportJobRequest` / `ApplyImportJobRequest` / `PurchaseImportRequest`; canonicalised in the adapter (equivalent forms — `"5"`/`5.0`, `"0"`/`false`, upper/lower-case UUIDs — are not a change; invalid values pass through for the service to refuse). `tax_inclusive` is read as a boolean in apply (a string `false` becomes `''` and would look "absent").
- **Failure visibility:** per-invoice failures are not recorded in `import_job_units` for a document-unit domain (that table is row-oriented) and there is no repair file yet, so the failed job's `error_message` now carries the first three bad invoices with sheet row and supplier invoice number («الصف 4 (فاتورة «BAD-1»): …»).

## Disclosures / limits

- **No repair/failure-export for purchases yet** (document-unit failures aren't row units). Fix-and-reupload through a new preview works because failed jobs write nothing (chunk = one transaction). A document-level failure ledger is a future slice.
- `row_count` shown right after job creation (before first apply) is the row-count estimate; the UI should label progress as invoices once processing starts (H5-S4b).
- The recount re-parses the file with the frozen options (≤ 20 000 rows) once at first apply.
- No AI action for purchases (H5-S5).

## Tests

- `PurchaseImportEndpointsTest` (14, SQLite + PG): domain registration/bound-only/document unit and no AI action; no sync apply; fields/template/inspect/preview write nothing and issue a plan-carrying binding; **a job counts invoices not rows (5 rows → 3 invoices, `batch_size=1`, an invoice straddling the row boundary), drafts + reservations only, no journal entry/stock movement**; recount uses the frozen mapping and default supplier; preview required and option mismatch refused; frozen policies can't change on apply while equivalent forms are accepted; a duplicate created after the preview is `plan_drift` with nothing written; an invalid invoice fails the job with a message naming it; viewer/manager gates; disabled `purchases.cycle` refuses endpoints/creation/apply; **warehouse scope enforced at preview and per chunk (withdrawal between them fails)**; cross-tenant supplier code; adapter canonicalisation.
- Mutation controls: recount → `null` fails 2 tests; removing the per-chunk warehouse check fails the warehouse test.
- Regression (`Import*`, `Purchase*`, registry, H5/H7 endpoints; 921 tests SQLite, 69 on PG) green.

## Journal entries

None — drafts only (asserted).
