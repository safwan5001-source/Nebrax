# IMP-H5-S1a — Document duplicate-reservation foundation (`import_document_reservations`)

**Branch:** `claude/imp-h5-s1a-reservations` · **Additive only.** One new table, one model, one service, one exception. **No consumer yet** (no document service, adapter, route, permission, setting, env, ledger, accounting-rule or ZATCA change). Behaviour of every existing flow is unchanged.

## Why a reservation table (design recap, H5)

Expenses and purchases have no natural unique key the database can enforce, so a "check then insert" duplicate guard races (two imports, or an import vs. a manual entry, both pass the check). The unique index on `(tenant_id, domain, dedupe_key)` is the single arbiter; the key is a SHA-256 of a **domain-specific predicate**, so every source (standard import, AI action, Document Center, manual UI) converges on one guard.

## What it adds

- Migration `2026_12_02_010000_create_import_document_reservations_table` — `id`, `tenant_id` (FK cascade), `domain`(32), `dedupe_key` char(64), `counterparty_id` uuid null, `document_type`(64), `document_id` uuid, `source`(24), `predicate` json, timestamps; **unique `import_doc_reservation_unique (tenant_id, domain, dedupe_key)`**; index `(tenant_id, document_type, document_id)`. `down()` drops the table.
- `ImportDocumentReservation` — `BaseModel`, `CompanyWide` (a reservation spans branches: the duplicate question is per company, so branch-scoping it would let two branches double-book the same vendor invoice).
- `DocumentDuplicateReservationService` (single owner of the reservation lifecycle):
  - `reserve()` — `INSERT … ON CONFLICT DO NOTHING` (`insertOrIgnore`): a conflict does **not** abort the PostgreSQL transaction; the loser sees 0 rows inserted and gets `DuplicateDocumentException` carrying the holder (type + id).
  - `rekey()` — atomic re-derivation when an identity field of the document is edited (lock current → delete → reserve new); same identity after normalisation = no-op; unreserved document = no-op (documents created manually under `allow` are not retro-reserved); taken target ⇒ exception and the caller's transaction rolls back, leaving the original.
  - `release()` — draft deletion frees the identity. `find()` — read by predicate or key.
  - **Transaction-only** (`LogicException` otherwise) and **tenant-context-only**.
  - Pure helpers: `normalizeReference` (Latin/Arabic-Indic/Persian digits, case-folded, letters+digits only: `INV-001` = `inv 001` = `INV/٠٠١`), `normalizeName`, `vendorKey` (partner id, else normalised name, else `none`), `expensePredicate` (vendor ‖ normalised reference ‖ date ‖ amount in halalas ‖ explicit occurrence id), `purchasePredicate` (supplier ‖ normalised supplier-invoice number), `key` (key-sorted JSON ⇒ order-insensitive; domain mixed into the hash).
- `DuplicateDocumentException` — `RuntimeException` (⇒ 422 / named row failure at the consumer), constant `reason = duplicate_document`.

## Decisions (AWJ) and what is deliberately *not* here

- Reference-less expenses still reserve (fallback key = vendor ‖ date ‖ amount); a *true* repeat is expressed by an explicit **occurrence id** minted at preview time — decided in S1c, the column/predicate field exists now.
- `sales_invoice` is a declared domain name only; no predicate builder (invoices have their own numbering/ZATCA identity) until a slice needs it.
- `duplicate_reference_policy = allow|block` (CLAUDE.md rule 6), the document-service hooks (create → reserve, update → rekey, delete → release) and the expense adapter are **S1b/S1c**. Until then nothing writes this table.
- No backfill of historical documents (reservations start from the moment S1b ships; legacy duplicates are not reinterpreted).

## Tests

- `DocumentDuplicateReservationTest` (17, SQLite + PostgreSQL): normalisation; vendor key; key stability / order-insensitivity / domain separation; equivalent references ⇒ same key; first wins + holder reported; **conflict does not abort the surrounding transaction**; domain separation; tenant isolation; predicate/source stored; rekey (success, taken target rolls back, no-op cases); release; purchase predicate; unknown domain/source; tenant-context requirement; raw `insertOrIgnore` shows the DB itself enforces uniqueness.
- `DocumentDuplicateReservationConcurrencyPostgresTest` (4, real PostgreSQL + `pcntl_fork`; fails rather than skips without pcntl): six racing reservations of one identity ⇒ exactly one row and one winner, losers get `DuplicateDocumentException` (not a DB error); five distinct identities all succeed; **negative control** — dropping the unique constraint lets several reservations through (so the race test is not vacuous); transaction requirement outside a transaction.
- `BranchIsolationGuardTest` green (model classified `CompanyWide`).
- Local run: SQLite 17/17; PostgreSQL 21/21 (both files). Full suite runs in CI.

## Disclosures

- No Codex review (quota exhausted); an independent read-only reviewer pass is recorded in the PR.
- The `predicate` JSON stores normalised values (vendor key, reference, date, amount) — no document content, no PII beyond what the document itself holds.
- Retention: reservations are cascade-deleted with the tenant, like the documents they guard.
