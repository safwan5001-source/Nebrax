# REM-18b-3d: Implementation report: emergency-stop policy B

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no production migration, no tenant activation, no live ZATCA transmission.** Branch `claude/rem-18b-3d-emergency-stop-policy-b`. PR number, Head SHA and CI are posted on the PR (this file cannot name its own SHA). `ZATCA_SUBMISSION_DISPATCH_ENABLED` stays `false`. |
| Authority | Owner decisions: D-B1 approved (narrow change to F2b), D-B2 (disabled and never-activated tenants keep legacy posting, no hidden bypass, risk documented), D-B3 (READ COMMITTED boundary, no drain lock, no seeded platform row), D-B4 (HTTP 422, stable reason `platform_emergency_stop`, Arabic message), D-B5 (accounting/tax implications unresolved for production). |
| Base | `origin/main` = `a60fe8ef3` (contains #1593, #1594, #1597 = `468acee03b98b60b0392574c878de491efde83e4`). |
| Scope | One triggers-only migration, one typed exception, one branch in the issuer, a two-line rethrow in `ApiController::domain()`, tests, docs. |

## 1. What changed

**Policy B:** for a tenant whose `credit_note_issuance` control is **enabled**, while the platform emergency stop is **active**, every new sales credit-note posting is refused atomically: with no decision, with `disabled`, with `not_generated`, and even with a complete `generated` document. The note stays a draft (editable) and is re-posted **manually** after the stop is lifted. There is no deferred status, no queue and no retroactive issuance.

### 1.1 State matrix (sales note moving to `posted`)

| Tenant control | Platform stop | Result |
|---|---|---|
| absent (never activated) | any | legacy posting, no decision (unchanged) |
| disabled explicitly | any | legacy posting, no decision (unchanged; D-B2) |
| enabled | no | issuance for eligible cash notes, refusal with a reason for the rest (unchanged; 3c / F2b 3b rule) |
| enabled | **yes** | **refused (new)**: no journal entry, no `posted`, no chain entry, no ICV |

Purchase notes, drafts, cancellations and already posted (historical) notes are never affected: the fence only evaluates the transition to `posted` of a sales note.

### 1.2 Two independent enforcement layers

1. **Application** (`ZatcaCreditNoteIssuer::issue`): the rollout state is read once, lock-free, inside the existing posting transaction, after the ledger post. If `tenantEnabled && platformStopped` it throws `ZatcaCreditNoteEmergencyStopException` **before the eligibility checks and before `ZatcaChainAllocator::reserve()`**. The exception renders `422 {"message": "الإصدار الإلكتروني للإشعارات الدائنة متوقف مؤقتاً. سيبقى الإشعار مسودة، ويمكن إعادة ترحيله بعد رفع الإيقاف.", "reason": "platform_emergency_stop"}`. `ApiController::domain()` rethrows it (the same pattern already used for the POS idempotency conflict) so `render()` runs instead of the generic abort. The whole transaction rolls back, including the journal entry.
2. **Database** (`2026_11_23_010000_add_zatca_credit_note_emergency_stop_block`, triggers and functions only): replaces the F2b objects **under the same names**.
   * PostgreSQL: `CREATE OR REPLACE FUNCTION credit_notes_zatca_posting_fence()`; first branch rejects `tenant control enabled AND platform stop AND sales note transitioning to posted`; second branch is the unchanged 3b rule. The trigger itself is untouched.
   * SQLite: `credit_notes_zatca_posting_insert` / `_update` are recreated with the same names. A single trigger per event cannot raise two different messages with a plain `WHEN`, so the body is `SELECT CASE WHEN stop THEN RAISE(ABORT, <stop message>) WHEN no-decision THEN RAISE(ABORT, <3b message>) END`, evaluated only when the tenant control is enabled; unconfigured and disabled tenants never reach the body.
   * No column, index, table or row. F2a (S1 to S5) is unchanged.

Because both layers exist, a script, raw SQL, an UPSERT, an insert-as-posted or an older application version cannot post an activated tenant's sales note during the stop (tested on both engines).

### 1.3 Why even a complete `generated` document is refused during the stop

The stop exists to stop issuance (a leaked key, a bad document run). Allowing the `generated` path would keep reserving ICVs and signing while the platform believes issuance is stopped.

## 2. Transaction and lock order (unchanged; no new lock)

`CreditNoteService::post`, one transaction: note `FOR UPDATE` → source invoice `FOR UPDATE` → tenant anchor (`LedgerService`) and the journal entry → **rollout read (one statement, no lock)** → [blocked: exception, rollback] → eligibility → chain head `FOR UPDATE` (`reserve`) → build and sign → chain entry insert → single note `UPDATE` (F2a/F2b triggers, plain MVCC reads) → commit.

The platform-stop writer locks the platform administrator row (`FOR SHARE`) and the platform control row, never a tenant anchor, so the stop never waits for a posting and a posting never waits for the stop. No edge was added to any lock cycle.

### 2.1 READ COMMITTED boundary (D-B3), tested with real processes

The effective state is the last **committed** state at the moment of the statement that reads it.

* A stop that commits **before** the service's read: blocked by the service (no chain slot, no ICV).
* A stop that commits **between the chain entry insert and the note `UPDATE`**: the F2b trigger re-evaluates in the `UPDATE` statement and refuses; the transaction rolls back completely (entry, head, journal). Tested: `a_stop_committed_between_the_chain_entry_and_the_note_update_refuses_and_rolls_everything_back`.
* A stop that commits **after the note `UPDATE` statement and before commit**: the issuance already running **completes**, as a complete issued document with its matching entry (no gap, no contradiction). This is the explicitly accepted behaviour of D-B3; every later posting is blocked. Tested: `a_stop_committed_after_the_note_update_but_before_commit_lets_the_running_issuance_finish`.
* An uncommitted stop is invisible and never blocks a posting (`the_emergency_stop_boundary_is_the_committed_state_at_the_posting_statement`).

## 3. Files changed

| File | Kind |
|---|---|
| `database/migrations/2026_11_23_010000_add_zatca_credit_note_emergency_stop_block.php` | new, triggers/functions only, exact `down()` |
| `app/Support/ZatcaCreditNoteEmergencyStopException.php` | new (typed, `reason`, `render()`) |
| `app/Services/Accounting/ZatcaCreditNoteIssuer.php` | one branch before eligibility and `reserve()` |
| `app/Http/Controllers/Api/ApiController.php` | rethrow of the new exception in `domain()` (3 lines) |
| `tests/Feature/ZatcaCreditNoteEmergencyStopFenceTest.php` | new, 4 tests, both engines |
| `tests/Feature/ZatcaCreditNoteEmergencyStopApiTest.php` | new, 2 HTTP tests |
| `tests/Feature/ZatcaCreditNoteIssuancePostgresTest.php` | +3 fork tests (stop races and boundary) |
| `tests/Feature/ZatcaCreditNoteFenceTest.php`, `ZatcaCreditNoteFencePostgresTest.php`, `ZatcaCreditNoteIssuanceTest.php` | the three tests that pinned policy A rewritten to policy B (see 4.1) |
| `tests/Feature/ZatcaChainSchemaTest.php` | rollback/re-apply helpers take the new migration down before F2 and re-apply it after |
| `CLAUDE.md`, task queue, the 3c proposal (status), this report | docs |

Untouched: `CreditNoteService`, `ZatcaRolloutControlService` and its tables, F2a, `ZatcaChainAllocator`, ledger, signing/XML builders, every other migration. **No journal entry is created or changed.**

## 4. Tests

### 4.1 The three tests that asserted policy A and why they changed

| Test | Old expectation (A) | New expectation (B) |
|---|---|---|
| `ZatcaCreditNoteFenceTest::the_platform_emergency_stop_…` | a stop restores legacy posting for an activated tenant | every posting of an activated tenant is refused with the stop message; lifting it restores the 3b rule |
| `ZatcaCreditNoteIssuanceTest::a_disabled_tenant_and_a_platform_stopped_tenant_…` | stopped tenant posts legacy | split: disabled tenant keeps legacy; activated tenant is refused by the typed exception with a full rollback, then resumes after the stop |
| `ZatcaCreditNoteFencePostgresTest::the_emergency_stop_boundary_…` | after the commit a posting without a decision passes | after the commit every posting (no decision, `not_generated`, complete `generated`) is refused by the stop rule; before it only the 3b decision rule applies |

Nothing unrelated was weakened.

RESULTS_PLACEHOLDER

## 5. Migration up/down evidence

`the_migration_rolls_back_to_the_exact_previous_definitions_and_reapplies_without_touching_data` (both engines): the 3b definitions are captured from the 3b migration itself (PostgreSQL `pg_get_functiondef` and `pg_get_triggerdef`; SQLite the stored trigger SQL); the new migration changes them while keeping every name; `down()` restores them **byte for byte**; after `down()` the old behaviour is back (policy A: an activated tenant posts legacy during a stop); applying twice is idempotent and restores blocking; the `credit_notes` columns, the table list and an existing historical row are identical before and after. The real rollback order (this migration, then the F2 migration) is exercised by `ZatcaChainSchemaTest`.

## 6. Accounting invariants

No journal entry is created or changed. A blocked posting writes nothing (tested: no journal entry, no chain entry, head unchanged, no ICV). When posting is allowed the entry is the existing one:

| Account | Debit | Credit |
|---|---|---|
| 4110 Sales | subtotal | |
| `tax_output` (default 2120) | tax | |
| 1110 Cash | | total |

## 7. Tenant isolation and security

* The stop is platform-wide by design, but the block applies only to tenants whose own control is enabled (keyed by `NEW.tenant_id` in the trigger and by the note's tenant in the issuer). Tests: an unconfigured tenant, a disabled tenant and an activated tenant coexist during one stop; only the activated one is blocked.
* The new exception carries a fixed message and a fixed reason, no values, keys or XML. The service and the fence only read the controls and never write them.
* No route, command or UI writes controls (unchanged); the dispatch kill switch is untouched.

## 8. Operational notes

* **What the user sees:** HTTP 422 `{message: "الإصدار الإلكتروني للإشعارات الدائنة متوقف مؤقتاً. سيبقى الإشعار مسودة، ويمكن إعادة ترحيله بعد رفع الإيقاف.", reason: "platform_emergency_stop"}`. The draft remains editable.
* **Resuming safely:** a platform administrator lifts the stop (audited event); users re-post the drafts manually. The first successful posting takes the next ICV; nothing is consumed during the stop.
* **Deployment order:** code first, then the migration. If the migration lands first and a stop is already active, an older application version (whose issuer returns `null` during a stop) is refused by the database with a database error (HTTP 500) instead of 422, rolled back completely (fail closed). Today no stop exists and no tenant is activated, so the window is empty.
* **Risk of disabling a previously activated tenant (D-B2):** disabling the tenant control returns that tenant to legacy posting. Sales credit notes posted afterwards carry no decision and can never be issued (F2a S4 forbids a retroactive decision). This is an explicit, audited platform act (control events), documented here and in `CLAUDE.md`; there is no hidden bypass. Using it to let one tenant post during a stop knowingly creates undecided posted notes.

## 9. Known risks and remaining blockers

| Item | State |
|---|---|
| **D-B5 (production blocker)** | Accounting/tax implications of delayed refunds during a stop and of document-issuance deadlines are unresolved and unapproved. Do not activate a production tenant until a tax adviser answers (does a delayed 381 breach an issuance deadline? are cash refunds booked late acceptable?). |
| Delayed ledger for refunds | While a tenant is blocked its credit notes cannot be posted; customer refunds already paid in cash lag the ledger until the stop is lifted. A posting after a period or fiscal-year close is refused by the existing date guards and needs a corrected date. |
| Running issuance across the boundary | By design (D-B3) one issuance already past its `UPDATE` can finish a few moments after the stop commits. |
| Pre-existing PostgreSQL deadlock | Cash invoice posting versus cash credit-note posting (cash account 1110 lock) still exists on `main` and is not changed here; the PostgreSQL race tests use credit invoices for the same reason. |
| D4 and KSA-10 | Unchanged: credit refunds are refused for activated tenants; the cash-refund reason is a fixed AWJ constant awaiting sign-off. |
| Platform stop is a single global row | A stop blocks every activated tenant at once (intended); there is no per-tenant stop. |

## 10. Branch, PR, SHAs

Branch `claude/rem-18b-3d-emergency-stop-policy-b`; Base `a60fe8ef3` (contains `468acee03b98b60b0392574c878de491efde83e4`); the Draft PR number, Head SHA and CI are on the PR.

## 11. Next recommended action

Owner review, then an activation-readiness review (signing credentials, phase-2 policy, a single pilot tenant, the cash-account lock fix, D4, KSA-10 and D-B5) before any tenant is enabled.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO TENANT ACTIVATION. NO LIVE ZATCA TRANSMISSION.**
