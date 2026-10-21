# REM-18b-3b: Implementation report: credit-note F2 database fences

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no production migration, no tenant activation, no live ZATCA transmission, no credit-note issuance.** Branch `claude/rem-18b-3b-credit-note-fences`. PR number, Head SHA and CI are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction "REM-18b-3b: Credit Note F2 Database Fences", after REM-18b-3a (#1593) was verified merged. |
| Base | `origin/main` = `067d9faaef4d10f22d06d9508c8cabf6a603cb8a` (contains the rollout-controls foundation, #1593). |
| Scope | One triggers-only migration (PostgreSQL plpgsql and SQLite), tests on both engines, docs. |
| Not in this PR | Credit-note XML issuance or any writer of the ZATCA columns (REM-18b-3c) · any change to `CreditNoteService` or its journal entries · activating a tenant · submission or network calls. |

## 1. Architecture and decisions

The fences live in the database, like F1 for invoices, so they hold against any writer (old application version during a rolling deploy, a script, raw SQL). The migration adds **no column, index or row** and touches no existing data.

### 1.1 F2a: integrity of the decision and the issued document (`credit_notes`)

| Rule | What the database enforces |
|---|---|
| S1 shape | `zatca_status` is NULL, `generated`, `not_generated` or `disabled`, and the other ZATCA columns must agree. NULL: no artifacts and no skip reason. `generated`: complete document (standard or simplified, reason code, issue time, party snapshot, UUID, ICV > 0, PIH, hash, QR, XML), no skip reason, on a **posted sales** note. `not_generated`: explicit non-blank skip reason and no artifacts. `disabled`: no artifacts. |
| S1 purchase | A `purchase` credit note carries **no** ZATCA value at all (its behaviour is unchanged: it never had any). |
| S2 chain entry | `generated` requires a matching immutable row in `zatca_chain_entries`: same note, same tenant, document type `credit_note`, type code `381`, same ICV, UUID, PIH, hash and standard/simplified subtype. The issuer inserts the entry first and updates the note in the same transaction (the allocator already works this way for invoices), so an ICV without a matching entry is rejected. |
| S3 freeze | Once `zatca_status` is set, none of the twelve ZATCA columns can change: no silent conversion of an issued document to another state, no later issuance of a recorded `disabled`/`not_generated`, no edit of XML, hash, QR or snapshot. Unrelated note columns stay editable. |
| S4 no retroactive decision | A decision cannot be written (from NULL) on a note that is already `posted`. It is written before posting or in the update that posts. No backfill, no retroactive issuance of historical notes. |
| S5 delete | A note that is `generated`, has an ICV or has a chain entry cannot be deleted while its tenant row exists. Tenant hard delete still cascades exactly as before. |

Historical notes (all ZATCA columns NULL, no entry) are valid and unchanged in every respect.

### 1.2 F2b: posting fence (reads the REM-18b-3a controls)

When a **sales** note moves to `posted` (insert as posted, or update from another status), the database rejects it if the tenant is effectively activated and the note has no explicit decision (`zatca_status` NULL) or has the decision `disabled`. Effective activation is read from `zatca_rollout_controls` in two plain, lock-free `EXISTS` subqueries: the tenant row with `enabled = true` for feature `credit_note_issuance`, and no platform row with `enabled = false`.

* Missing tenant control = disabled, so the legacy posting path is unchanged for every tenant today (no control rows exist; nothing is activated).
* The platform emergency stop overrides tenant activation (posting reverts to legacy behaviour while the stop is in force).
* Purchase notes, drafts, cancellations and notes that are already posted are never affected (the check fires only at the transition to `posted`).
* No automatic issuance: the fence only refuses; nothing writes a decision.
* A `disabled` decision is rejected for an activated tenant (no silent downgrade). A decision recorded as `disabled` before the tenant was activated also blocks posting after activation, until the tenant is deactivated or a decision that matches is recorded: an intentional fail-closed edge, covered by a test.

### 1.3 Lock ordering and concurrency

The triggers take **no locks of their own**: they read `zatca_chain_entries`, `zatca_rollout_controls` and `tenants` with plain MVCC `SELECT`s and lock only the note row being updated, which the statement already holds.

Existing order, unchanged: note → source invoice → tenant anchor (`LedgerService`) → … → chain head → control read (last, once, lock-free). `CreditNoteService::post` writes `status = posted` after the ledger post, so the F2b read happens after the anchor is held. A control change queues behind the anchor (REM-18b-3a writers lock the anchor first), so a posting sees one consistent activation state. If the control flips between a future issuer's own read and its update, the fence refuses the posting (fail-closed) and the transaction rolls back.

Invoice and POS paths do not write `credit_notes` ZATCA columns and take no new lock; `CreditNotePosLockOrderPostgresTest` is part of the regression run.

### 1.4 Behaviour for an activated tenant (not reachable today)

Because 3b does not write decisions, `CreditNoteService::post` for a tenant that someone activated **fails closed** with a database error and rolls back completely (no journal entry, note stays draft). That is the point of the fence while the issuer does not exist yet; REM-18b-3c replaces the failure with a recorded decision. A test proves the service posts normally while disabled (same journal entry as before) and fails with no side effects when activated.

## 2. Files

| File | Kind |
|---|---|
| `database/migrations/2026_11_22_010000_add_zatca_credit_note_fences.php` | new (triggers/functions only; guarded `down()`) |
| `tests/Feature/ZatcaCreditNoteFenceTest.php` | new, 60 test cases, both engines |
| `tests/Feature/ZatcaCreditNoteFencePostgresTest.php` | new, 5 fork-based tests; **fails rather than skips** on PostgreSQL if `pcntl` is missing |
| `tests/Feature/ZatcaChainSchemaTest.php` | adapted: tests that insert lone ZATCA values or roll migrations back now take the F2 migration down first and re-apply it (real rollback order: F2, then F1/rollout, then note columns, then chain) |
| `CLAUDE.md`, task queue, this report | docs |

Untouched: `CreditNoteService`, `CreditNote` (no `$fillable` change), `InvoiceService`, `ZatcaService`, the allocator, submission classes, routes, resources and every existing migration. **No journal entry is created or changed.**

## 3. Tests and CI

| Run | Result |
|---|---|
| `ZatcaCreditNoteFenceTest`, SQLite | 60 passed (119 assertions) |
| `ZatcaCreditNoteFenceTest`, PostgreSQL 16 | 60 passed (122 assertions) |
| `ZatcaCreditNoteFencePostgresTest`, PostgreSQL 16 (`pcntl_fork`) | 5 passed (116 assertions); ran, not skipped |
| `ZatcaChainSchemaTest`, SQLite / PostgreSQL | 45 passed + 1 skipped (TRUNCATE) / 46 passed |
| Mutation check | Dropping each of the 9 SQLite triggers and each of the 3 PostgreSQL triggers makes the suite fail (2 to 41 failures each); dropping the PostgreSQL fences makes 3 of the 5 concurrency tests fail |
| Regression filter and full suites | see section 3.1 |

### 3.1 Regression and full suites

| Run | Result |
|---|---|
| Full suite, SQLite | 8135 passed, 31 failed, 162 skipped (71164 assertions) |
| Full suite, PostgreSQL 16 | 8290 passed, 34 failed, 4 skipped (72738 assertions) |
| PostgreSQL subset with `PGOPTIONS='-c lock_timeout=60s'` (as CI): lock-timeout guard, F2 fence + concurrency, chain schema, rollout controls, `CreditNotePosLockOrderPostgresTest`, `CreditNoteSourcePostgresTest` | 154 passed (912 assertions), none skipped |

The failures are environmental and none involves this change: 26 `Fuel*` (`bcmath` is not installed in this container; CI has it); `AiPaidProviderDisabledTest` (SQLite) and `StorefrontMediaApiTest` (PostgreSQL), both failing without this change; 4 `StorefrontPresentationGlobalGradientGateTest` cases, a stale test copy left in the local scratch application (the file does not exist in the repository since #1590); and, on PostgreSQL only, 3 `PostgresTestLockTimeoutTest` cases because the full PostgreSQL run omitted `PGOPTIONS` (they pass in the subset above). No ZATCA XML, signing or allocation code changed, so the SDK harness was not re-run locally.

Covered: generated without a chain entry rejected (update and direct insert); ICV, UUID, PIH, hash and subtype mismatch rejected; entries of a sibling note, another tenant or an invoice never satisfy a note; mutation of each of the twelve columns and every state conversion rejected; unchanged rewrite accepted; recorded `disabled`/`not_generated` frozen; retroactive decisions rejected; decisions accepted in the posting update; twelve inconsistent status/column shapes and 14 incomplete-document variants; purchase notes; delete protection and tenant cascade (SQLite cannot hard-delete a tenant that has any credit note, before and after this change; asserted as equal to the baseline); historical notes; activated versus disabled versus reverted tenants; emergency stop and release; per-tenant isolation; the real `CreditNoteService` (unchanged entries while disabled, fully rolled back when activated); migration rollback refusal and re-application; concurrency (mixed note and invoice issuance on one chain, concurrent postings for activated and plain tenants, activation queueing behind the anchor, killed process, failed update rolling back entry and head).

## 4. Security and tenant isolation

* Every cross-table check is keyed by `tenant_id`; an entry from another tenant never matches. Triggers read the controls but never write them; no route, command or UI was added.
* Error messages are fixed text without values.
* `CreditNoteService` and the model are asserted to contain no reference to the rollout controls, the chain or the ZATCA columns.

## 5. Migration and rollback

* Additive and inert: triggers and three plpgsql functions only. No table, column, index or row is created, read for change or written. Existing rows are never validated retroactively because every trigger fires on write only.
* `down()` refuses (any environment, no bypass flag) when any credit note has a decision or any credit-note chain entry exists; otherwise it drops the triggers and functions. Tested including re-application.
* Rollback order: this migration first (it reads chain and rollout tables and the note columns), then the rollout/F1 migrations, then note columns and chain tables.
* Rolling deployment: the fences only refuse writes that violate rules nothing violates today; older application versions never write these columns, so they are unaffected until a tenant is activated.

## 6. Remaining risks and open points

| Item | State |
|---|---|
| Stray chain entry without a note update | SQLite has no deferred triggers, so a note entry inserted without its note update is not caught by the database (same residual risk as F1). The issuer's single transaction is the guarantee; REM-18b-3c must keep entry insert and note update atomic. |
| `issued_at` not cross-checked with the entry | Timestamp formats differ between engines; deliberately not compared. |
| Fail-closed edge after activation | A `disabled` decision recorded before activation blocks posting after activation until the tenant is deactivated. Documented and tested; REM-18b-3c's issuer should never record `disabled` for an activated tenant. |
| Friendly error | The fence raises a database error (500), not a 422. 3c turns the activated path into a recorded decision, so users never reach it. |
| Terminal, write-once status | Extends "no silent conversion": a recorded `not_generated` can never later become `generated`. A future "retry after a skip" feature would need an explicit, audited new state; flag if that is wanted. |
| Hard tenant purge | Unchanged (cascade); retention remains the REM-36 decision. |

## 7. Branch, PR, SHAs

Branch `claude/rem-18b-3b-credit-note-fences`; Base `067d9faaef4d10f22d06d9508c8cabf6a603cb8a`; the Draft PR number, Head SHA and CI are on the PR.

## 8. Recommended next step

Review this slice, then **REM-18b-3c**: wire `CreditNoteService::post` to the issuer (allocate through the shared chain, build and sign the 381 document, write the decision and the matching entry in one transaction, read the activation state last, once, lock-free), still behind the controls and with no tenant activated.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO TENANT ACTIVATION. NO LIVE ZATCA TRANSMISSION.**
