# REM-18b-1: Implementation report: shared ICV/PIH chain, schema foundation

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no production migration.** Branch `claude/rem-18b-1-chain-schema`. PR number, Head SHA, CI and CI Gate are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction "REM-18b-1 Shared Chain Schema Foundation", built on `REM-18b-SHARED-CHAIN-DESIGN.md` (revision 2, committed with this PR). |
| Base | `origin/main` = `0b2f127733eb06b6c85ebf3bd9dda2b3df4884da` (contains REM-18a `45e95b2`). |
| Scope | Additive schema only: two tables, nullable columns on `credit_notes`, two `CompanyWide` models, DB-level guards on SQLite and PostgreSQL, tests. |
| Not in this PR | Allocator (REM-18b-2) · F1/F2 fences (REM-18b-2/3) · any change to invoice or credit-note posting, `ZatcaService`, API, accounting, inventory or tenant deletion · backfill · ZATCA calls. |

## 1. What changed

| File | Kind | Purpose |
|---|---|---|
| `database/migrations/2026_11_18_010000_create_zatca_chain_tables.php` | new | `zatca_chains`, `zatca_chain_entries`, constraints, triggers T1–T8, guarded `down()` |
| `database/migrations/2026_11_18_020000_add_zatca_columns_to_credit_notes.php` | new | 12 nullable columns, `zatca_status` check, guarded `down()` |
| `app/Models/ZatcaChain.php`, `ZatcaChainEntry.php` | new | `CompanyWide` models; early `LogicException` on update/delete of entries and on delete of heads |
| `tests/Feature/ZatcaChainSchemaTest.php` | new | 46 tests (45 on SQLite + 1 PostgreSQL-only TRUNCATE) |
| `docs/audits/horizon/REM-18b-SHARED-CHAIN-DESIGN.md` | new (docs) | The approved design, now versioned in the repository |
| `CLAUDE.md`, `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md`, `TAX-HZ-00-REMEDIATION-BACKLOG.md` | docs | Status and the unresolved retention risk |

Untouched: `Invoice`, `CreditNote` (no `$fillable` change), `InvoiceService`, `CreditNoteService`, `ZatcaService`, routes, resources, any existing migration or row. A test scans `app/` and fails if any other file mentions the new tables or models, and checks that none of the new `credit_notes` columns entered `$fillable`.

## 2. Schema

### `zatca_chains` (one head per tenant and chain key)
`id` uuid PK · `tenant_id` → `tenants` **CASCADE** · `chain_key` (`tenant` only, enforced) · `last_icv` · `seed_icv` · `seed_legacy_count`, `seed_excluded_null_icv`, `seeded_at` (documentation only) · timestamps. Unique `(tenant_id, chain_key)`; unique `(tenant_id, id)` (target of the composite FK, so an entry can never point at another tenant's chain).

### `zatca_chain_entries` (one immutable row per issued e-document)
`id` · `tenant_id` → `tenants` **CASCADE** · `(tenant_id, chain_id)` → `zatca_chains` **RESTRICT** · `icv` · `document_type` (`invoice` | `credit_note`) · `invoice_id` → `invoices` **RESTRICT** · `credit_note_id` → `credit_notes` **RESTRICT** · `type_code` (`388` | `381`) · `subtype` (`standard` | `simplified`) · `zatca_uuid` · `previous_hash`, `hash` (`varchar(255)`) · `signed` · `issued_at` · `created_at` (no `updated_at`).
Unique: `(chain_id, icv)` · `invoice_id` · `credit_note_id` · `(tenant_id, zatca_uuid)`.

### `credit_notes` additions (all nullable, no default, no index)
`zatca_status` (`generated` | `not_generated` | `disabled`) · `zatca_skip_reason` · `zatca_document_type` · `zatca_reason_code` · `issued_at` · `party_snapshot` (json) · `zatca_uuid` · `zatca_icv` · `zatca_previous_hash` · `zatca_hash` · `zatca_qr` · `zatca_xml`. Existing rows stay `NULL` (meaning "legacy, nothing issued"). No unique index on `zatca_icv` by design (the entries table is the cross-document barrier).

### Database guards (PostgreSQL plpgsql / SQLite triggers, same cases tested on both)

| ID | Guard |
|---|---|
| T1 | `UPDATE` of an entry is always rejected |
| T2 | `DELETE` of an entry is rejected while its tenant row exists (soft-deleted tenants included) |
| T3 | `TRUNCATE` of either table is rejected (PostgreSQL; SQLite has no TRUNCATE), including `TRUNCATE tenants CASCADE` |
| T4 | Inserting an entry advances the head atomically: `icv` must equal `last_icv + 1`, otherwise the insert fails (no skip, no duplicate, no foreign-tenant chain) |
| T5 | The head can only move by exactly +1 with a matching entry; identity columns are frozen (a "touch" update is rejected as well) |
| T6 | A head may be created only with `chain_key = 'tenant'` and `seed_icv = last_icv = max(invoices.zatca_icv)` of the same tenant (0 when none; NULL ICVs ignored) |
| T7 | `DELETE` of a head, same rule as T2 |
| T8 | An entry whose invoice or credit note belongs to another tenant is rejected |
| Shape | PostgreSQL `CHECK` / SQLite insert trigger (SQLite cannot add a CHECK after creation, same pattern as the communications tables): `icv > 0`, non-empty hashes, valid subtype, exactly one document matching `document_type` and `type_code` (388 for invoices, 381 for notes) |

### Deletion and retention (owner decision O-R1)
* Existing tenant foreign-key behaviour is preserved: `tenant_id` is `CASCADE` like the other 271 tenant FKs. A hard tenant delete removes its invoices, notes, chain heads and entries together, exactly as it removes the invoices today. The tests prove this on both engines, and on PostgreSQL also with a note that references its invoice.
* A document that has an entry cannot be deleted on its own (`RESTRICT`, tested), and no entry or head can be deleted, updated or truncated except by the tenant cascade.
* **Unresolved retention risk (REM-36):** hard tenant deletion still destroys tax documents and their chain metadata at once, which is at odds with the six-year retention rule (IR Art. 66(1)). This PR neither introduces nor changes that behaviour, and does not attempt to fix it; the migration header, `CLAUDE.md`, the task queue and backlog row 5.10 record it.

### Rollback safety
* `create_zatca_chain_tables::down()` throws `Rollback refused` if either table has any row (every environment, no bypass flag); otherwise drops the tables and the PostgreSQL functions.
* `add_zatca_columns_to_credit_notes::down()` throws `Rollback refused` if **any** credit note has a value in **any** of the twelve columns; otherwise drops the check and the columns only.
* Once an entry exists it cannot be removed (T2/T3), so after the first issued document the migration is forward-only by construction.
* Verified: up → down → up round trips on empty tables; refusals leave tables and columns intact; existing invoice and credit-note rows are byte-identical before and after (new columns `NULL`), and no chain rows appear.

### Deviation from the design draft
`previous_hash` / `hash` are `varchar(255)` instead of `varchar(64)`: the PIH is the Base64 of the 64-character hex digest (88 characters; the BR-KSA-26 genesis is exactly that). Noted at the top of the committed design document.

## 3. Tests and results (local; CI is the authority)

| Run | Result |
|---|---|
| `ZatcaChainSchemaTest` on SQLite | 45 passed, 1 skipped (TRUNCATE), 196 assertions |
| `ZatcaChainSchemaTest` on PostgreSQL 16 | 46 passed, 200 assertions |
| `ZatcaChainSchemaTest` + `BranchIsolationGuardTest` (final head) | SQLite 49 passed + 1 skipped; PostgreSQL 50 passed |
| Migrations by hand on a throwaway PostgreSQL database | `migrate:fresh`, `migrate:rollback --step=2`, `migrate` all succeed; nine triggers present |
| Full suite on SQLite | 7927 passed, 27 failed, 146 skipped. The 27: 26 `Fuel*` tests (`bcmath` is not installed in this container; present in CI) and 1 `AiPaidProviderDisabledTest`, which also fails on the previous main in this container. |
| Full suite on PostgreSQL | 8066 passed, 30 failed, 4 skipped. The 30: the same 26 `Fuel*`; 3 `PostgresTestLockTimeoutTest` (need `PGOPTIONS='-c lock_timeout=60s'`, which CI sets; they pass with it); 1 `StorefrontMediaApiTest` (`PDOException HY093`), which **also fails without these migrations** (checked). |

Both full runs were executed with an interim NO ACTION foreign-key variant before the final RESTRICT (the approved design) was restored; the schema tests were re-run on the final head (row above) and show identical results for the deletion cases. CI runs the full suites on the final head.

Cases covered: empty installation; unique `(tenant, chain_key)`; unique ICV per chain; skip/duplicate/zero ICV rejected and head unchanged after a rejected entry; unique document references (invoice, note, UUID per tenant); invalid document type/code/subtype/hash shapes; seed rules (legacy max, other tenants ignored, NULL ICV ignored, first entry continues from the seed); tenant isolation in the database and in the models' tenant scope; UPDATE/DELETE/TRUNCATE guards (raw SQL, bulk delete, soft-deleted tenant); head movement rules; RESTRICT on documents; hard tenant delete compatibility; rollback refusals for every environment and for each of the twelve note columns; row-level non-change.

## 4. Pre-existing facts found (not changed here)
* On SQLite, hard-deleting any tenant that has a credit note fails today (`credit_notes.partner_id` RESTRICT is checked before the customers cascade). It is independent of this PR, so the compatibility tests compare "with the new tables" against "without" instead of assuming the SQLite outcome.
* The draft's `varchar(64)` hash length would have rejected a genuine PIH (corrected above).

## 5. Risks and remaining decisions

| Item | State |
|---|---|
| Hard tenant delete vs six-year retention | **Unresolved, REM-36** (unchanged behaviour) |
| Rollout fences F1/F2, allocator, activation row | Not built; REM-18b-2/3; decisions O-R2…O-R7 still open in the design report |
| `T5` rejects any non-advancing update of a head (even `updated_at`) | By design; the allocator must advance only through entry inserts |
| Trigger dialect drift (plpgsql vs SQLite) | One shared test file runs every case on both engines |
| Credit-settled notes (D4), snapshot policy (D5), `Invoice` vs `CreditNote` root, non-15 % categories | Unchanged and unresolved (REM-18a report) |
| Migration runs at container boot (`deploy/entrypoint.sh`) | Safe: nothing reads or writes the new objects until REM-18b-2; the migration takes brief locks on `credit_notes` only for the column additions |

## 6. Recommended next step
Review this PR. Then answer O-R2…O-R7 (design report §11) and start **REM-18b-2** (shared allocator for invoices + fence F1, with PostgreSQL concurrency tests) as a separate Draft PR.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO LIVE ZATCA TRANSMISSION.**
