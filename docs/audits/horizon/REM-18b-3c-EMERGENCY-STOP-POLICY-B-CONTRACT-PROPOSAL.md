# REM-18b-3c: Contract-change proposal: emergency-stop policy B

| | |
|---|---|
| Status | **PROPOSAL ONLY. Not implemented. Needs explicit owner approval before any code or migration.** |
| Why it exists | The owner's provisional policy B ("block new sales credit-note posting for an activated tenant while a platform emergency stop is active") conflicts with the **merged** F2b and rollout-control contract (#1593, #1594), which treats a stopped tenant as effectively disabled and lets the legacy posting through. |
| What 3c did instead | Implemented the independently safe scope against the **current** contract (policy A: stop = legacy posting, no issuance). Policy B was excluded. |

## 1. The conflict, precisely

| Layer | Today (merged) | Policy B |
|---|---|---|
| Rollout state (`ZatcaRolloutControlService::effectiveForTenant`) | `enabled = tenantEnabled AND NOT platformStopped`. A stop makes the tenant look disabled (`reason = platform_stop`). | Three states are needed: `disabled` (legacy), `enabled` (issue), **`enabled_stopped` (tenant enabled, platform stop: block)**. The value object already carries `tenantEnabled` and `platformStopped`, so no new data is needed, only a new reading of them. |
| F2b posting trigger (PostgreSQL `credit_notes_zatca_posting_fence`, SQLite `credit_notes_zatca_posting_insert/update`) | Rejects a sales note moving to `posted` without an explicit decision only when `tenantEnabled AND NOT platformStopped`. Under a stop, an undecided posting passes. | Under `tenantEnabled AND platformStopped`, reject **every** transition of a sales note to `posted` (with or without a decision). |
| `CreditNoteService` / issuer (3c) | Stop ⇒ `issue()` returns `null` ⇒ legacy posting. | Stop for an enabled tenant ⇒ the issuer throws a typed `ZatcaCreditNoteBlockedException('platform_emergency_stop')` before any lock beyond the anchor; the transaction rolls back (no journal entry, no ICV). |

The permanent-gap problem it solves: today a sales note posted during a stop stays undecided forever, because F2 (S4) forbids a retroactive decision. Under B no undecided note can be posted for an enabled tenant at all.

## 2. Required database fence changes

One new forward-only migration (triggers/functions only, no column, no row), replacing the F2b objects created by `2026_11_22_010000`:

* PostgreSQL: `CREATE OR REPLACE FUNCTION credit_notes_zatca_posting_fence()` with two branches on the same `BEFORE INSERT OR UPDATE OF status, type, zatca_status` trigger:
  1. tenant control enabled **and** platform row `enabled = false` **and** the note is a sales note transitioning to `posted` ⇒ `RAISE EXCEPTION 'credit_notes: sales credit-note posting is blocked while the platform emergency stop is in force for an activated tenant'`.
  2. tenant control enabled **and** no platform stop ⇒ the existing rule (decision required, `disabled` rejected).
* SQLite: the two `credit_notes_zatca_posting_*` triggers get a second `WHEN` branch (or a sibling pair of triggers) with the same two predicates; the existing S1–S5 triggers are untouched.
* `down()` restores the 3b bodies (safe at any time: it only relaxes the fence, it never touches data).

F2a (S1–S5) does not change. Explicit decisions stay valid in every state; the new branch refuses the *transition to posted*, not an existing document.

## 3. State semantics (activation versus stop)

| Tenant control | Platform stop | Sales note → `posted` |
|---|---|---|
| absent / disabled | any | legacy posting, no decision (unchanged) |
| enabled | no stop | explicit decision required; eligible cash notes are issued (3c) |
| enabled | **stop in force** | **blocked (new)** |

Lifting the stop restores the middle row. A tenant admin cannot bypass the stop; the only way to let one tenant post during a stop is for a platform administrator to disable that tenant's control, which is an explicit, audited act (events table) and accepts that notes posted meanwhile stay undecided.

## 4. Transaction and concurrency behaviour

* The service reads the state once, lock-free, after the tenant anchor is held (see the sequence in the 3c report). A stop committing **before** the posting statement ⇒ blocked (service throws; the trigger re-checks as a backstop). A stop committing **after** the posting statement ⇒ the posting is already a valid issued document; nothing is lost or contradictory.
* The platform stop is not tenant-scoped and is not serialised behind any tenant anchor, so a stop can commit between the service's read and the `UPDATE`. The trigger re-evaluates in the `UPDATE` statement itself and refuses (fail closed, full rollback). The worst case is a refused posting that the user retries after the stop; there is never a half-issued note.
* No new lock: the trigger keeps reading `zatca_rollout_controls` with plain MVCC `EXISTS` subqueries, so the lock order is unchanged and no deadlock edge is added.
* A tenant enable racing a posting stays serialised behind the anchor (3a), exactly as today.

## 5. Accounting and operational implications

* While a stop is active, enabled tenants cannot post **any** sales credit note (including refunds that are accounting-only); drafts remain editable. Customer cash refunds against credit notes are delayed until the stop is lifted or the tenant is individually disabled.
* No journal impact: a blocked posting writes nothing. Posted notes, ledger and VAT are untouched.
* Purchase notes and every other document type are unaffected.
* The stop must be operationally short and announced, because it now stops a revenue-adjacent accounting action. Support needs a runbook line: "stop in force: sales credit notes are queued as drafts".

## 6. Rollback and backward compatibility

* Forward-only for data (nothing is written). Rollback = restore the 3b trigger bodies; instant and safe.
* No historical document changes; no tenant is activated by deploying it.
* Rolling deployment: the database is stricter than an older application instance, so an older instance attempting a legacy posting during a stop gets a database error and a full rollback (fail closed).

## 7. Tests the slice must add (SQLite and PostgreSQL)

1. Enabled tenant + stop: posting with no decision, with `disabled`, with `not_generated` and with a valid `generated` document are all rejected; drafts still insert and update; no journal entry, no chain advance.
2. Enabled tenant, stop lifted: the 3c behaviour returns (eligible note issued, ineligible refused with a reason).
3. Disabled / unconfigured tenant during a stop: legacy posting unchanged.
4. Cross-tenant: tenant B (never enabled) posts normally during a stop that blocks tenant A.
5. Platform-stop race (PostgreSQL fork): a held-open uncommitted stop is invisible to a concurrent posting; after commit the posting is blocked; no deadlock.
6. Service-level: a typed blocked error before any ledger write; transaction fully rolled back.
7. Rollback of the migration restores 3b behaviour; mutation check: dropping the new branch makes the tests fail.
8. Existing F1/F2/chain suites and the 3c suite unchanged and green.

## 8. Alternatives considered

* **A (current):** keep legacy posting under a stop. Simple and non-blocking, but creates permanent unissued posted notes.
* **C (deferred issuance):** post under the stop with a non-final "deferred" decision and issue later. Needs a new non-terminal status and a controlled exception to S3/S4 (a second write to the ZATCA columns), a work queue, and a backfill path. Larger and riskier; revisit only if blocking refunds is operationally unacceptable.

## 9. Recommendation and decision needed

Adopt **B** as a separate slice (suggested id REM-18b-3d) after 3c is reviewed. Decisions required from the owner: (1) approve changing the F2b contract as in section 2; (2) confirm that blocking all sales credit-note postings of an enabled tenant during a stop is acceptable operationally; (3) confirm the unblock procedure (platform disables the single tenant, accepting undecided notes).
