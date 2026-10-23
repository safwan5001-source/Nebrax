# IMP-H5-S1a — Document duplicate-reservation foundation (`import_document_reservations`)

**Branch:** `claude/imp-h5-s1a-reservations` · **Additive only.** One new table, one model, one service, one exception. **No consumer yet** (no document service, adapter, route, permission, setting, env, ledger, accounting-rule or ZATCA change). Behaviour of every existing flow is unchanged.

## Why a reservation table (design recap, H5)

Expenses and purchases have no natural unique key the database can enforce, so a "check then insert" duplicate guard races (two imports, or an import vs. a manual entry, both pass the check). The unique index on `(tenant_id, domain, dedupe_key)` is the single arbiter; the key is a SHA-256 of a **domain-specific predicate**, so every source (standard import, AI action, Document Center, manual UI) converges on one guard.

## What it adds

- Migration `2026_12_02_010000_create_import_document_reservations_table` — `id`, `tenant_id` (FK cascade), `domain`(32), `dedupe_key` char(64), `counterparty_id` uuid null, `document_type`(64), `document_id` uuid, `source`(24), `predicate` json, timestamps; **unique `import_doc_reservation_unique (tenant_id, domain, dedupe_key)`** and **unique `(tenant_id, document_type, document_id)`** (one document = one reservation; a same-identity retry is idempotent, a different identity for a reserved document must go through `rekey()`). `down()` drops the table.
- `ImportDocumentReservation` — `BaseModel`, `CompanyWide` (a reservation spans branches: the duplicate question is per company, so branch-scoping it would let two branches double-book the same vendor invoice).
- `DocumentDuplicateReservationService` (single owner of the reservation lifecycle):
  - `reserve()` — `INSERT … ON CONFLICT DO NOTHING` (`insertOrIgnore`): a conflict does **not** abort the PostgreSQL transaction; the loser sees 0 rows inserted and gets `DuplicateDocumentException` carrying the holder (type + id).
  - `rekey()` — re-derivation when an identity field is edited: lock the document's row, then **UPDATE it in place** inside a savepoint (not delete+insert, so a concurrent edit blocked on the row lock follows the update chain instead of finding a deleted row and silently dropping its edit); a taken target ⇒ `DuplicateDocumentException` with the original untouched **even if the caller swallows the exception and continues**; same identity after normalisation = no-op; unreserved document = no-op (documents created manually under `allow` are not retro-reserved).
  - `release()` — draft deletion frees the identity. `find()` — read by predicate or key.
  - **Transaction-only** (`LogicException` otherwise) and **tenant-context-only**.
  - Pure helpers: `normalizeReference` (Latin/Arabic-Indic/Persian digits, case-folded, letters+digits only: `INV-001` = `inv 001` = `INV/٠٠١`), `normalizeName`, `vendorKey` (partner id, else normalised name, else `none`), `expensePredicate` (vendor ‖ normalised reference ‖ date ‖ amount in halalas ‖ explicit occurrence id), `purchasePredicate` (supplier ‖ normalised supplier-invoice number), `key` (key-sorted JSON ⇒ order-insensitive; domain mixed into the hash).
- `DuplicateDocumentException` — `RuntimeException` (⇒ 422 / named row failure at the consumer), constant `reason = duplicate_document`.

## Decisions (AWJ) and what is deliberately *not* here

- Reference-less expenses still reserve (fallback key = vendor ‖ date ‖ amount); a *true* repeat is expressed by an explicit **occurrence id** minted at preview time — decided in S1c, the column/predicate field exists now.
- `sales_invoice` is a declared domain name only; no predicate builder (invoices have their own numbering/ZATCA identity) until a slice needs it.
- `duplicate_reference_policy = allow|block` (CLAUDE.md rule 6), the document-service hooks (create → reserve, update → rekey, delete → release) and the expense adapter are **S1b/S1c**. Until then nothing writes this table.
- No backfill of historical documents (reservations start from the moment S1b ships; legacy duplicates are not reinterpreted).

## Independent review (read-only subagent; not a Codex review) — findings and disposition

| # | Finding | Disposition |
|---|---|---|
| M1 | `rekey` not atomic if the caller catches the exception; weak test | **Fixed** — in-place UPDATE in a savepoint; test now swallows the exception and asserts the original survives |
| M2 | delete+insert loses a concurrent edit of the same document | **Fixed** — in-place UPDATE; PG fork test `concurrent_rekeys_of_one_document_never_lose_an_edit` |
| M3 | `release`/`rekey`/`find` had no tenant-context requirement | **Fixed** — all public methods require context; tests cover cross-tenant `find`/`release`/`rekey` |
| L1 | purchase predicate with empty normalised reference merges a supplier's invoices | **Fixed** — `purchasePredicate` rejects it (the import already requires the reference) |
| L2 | stripping separators merges `1-23`/`12-3` | **Accepted, by design**: the guard prefers a false "duplicate" (visible, user can correct the reference) to a missed one; leading-zero variants (`INV-001` vs `INV-1`) stay distinct. Stated here |
| L3 | NFKC/Arabic variants/tatweel not folded | **Fixed** — NFKC (when `intl` present), alef/yeh/kaf folds, tatweel dropped. `ة`/`ه` deliberately *not* folded (distinct words) |
| L4 | date/occurrence not canonical | **Fixed** — `normalizeDate` (Y-m-d or `LogicException`), `''` ⇒ null |
| L5 | `key()` accepts floats/nested arrays | **Fixed** — scalars int/string/null only, else `LogicException` |
| L6 | `rekey` kept a stale `counterparty_id` | **Fixed** — parameter |
| L7 | no one-reservation-per-document constraint | **Fixed** — unique index + idempotent same-identity retry |
| L8 | `counterparty_id` unchecked across tenants | **Fixed** — tenant-scoped existence check |
| L9 | swap of two documents' identities can deadlock (40P01) | **Documented, accepted** (rare; surfaces as a DB error, not a silent duplicate) |
| — | SQLite `INSERT OR IGNORE` swallows non-unique violations | **Noted** — every column is typed/defaulted, so unreachable today |
| — | race test does not prove overlap | **Noted** — outcome is deterministic either way; negative control proves the constraint is the arbiter |

## Tests

- `DocumentDuplicateReservationTest` (23, SQLite + PostgreSQL): normalisation; vendor key; key stability / order-insensitivity / domain separation; equivalent references ⇒ same key; first wins + holder reported; **conflict does not abort the surrounding transaction**; domain separation; tenant isolation; predicate/source stored; rekey (success, taken target rolls back, no-op cases); release; purchase predicate; unknown domain/source; tenant-context requirement; raw `insertOrIgnore` shows the DB itself enforces uniqueness.
- `DocumentDuplicateReservationConcurrencyPostgresTest` (5, real PostgreSQL + `pcntl_fork`; fails rather than skips without pcntl): six racing reservations of one identity ⇒ exactly one row and one winner, losers get `DuplicateDocumentException` (not a DB error); five distinct identities all succeed; **negative control** — dropping the unique constraint lets several reservations through (so the race test is not vacuous); transaction requirement outside a transaction.
- `BranchIsolationGuardTest` green (model classified `CompanyWide`).
- Local run: SQLite 23/23; PostgreSQL 28/28 (both files). Full suite runs in CI.

## Disclosures

- No Codex review (quota exhausted); the independent read-only reviewer pass is the table above.
- The `predicate` JSON stores normalised values (vendor key, reference, date, amount) — no document content, no PII beyond what the document itself holds.
- Retention: reservations are cascade-deleted with the tenant, like the documents they guard.
