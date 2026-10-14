# TAX-N01 — Implementation Report: dispatcher failure-cause diagnostics (no state-machine change)

STATUS: **MERGED** (PR #1444, merge `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36`) · **CI verified** · **Production deployment NOT VERIFIED**

> **Status correction (2026-10-14, post-merge).** This report was authored while the change was a Draft PR ("NOT MERGED"). Current verified state: PR #1444 merged, merge SHA `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36`, post-merge `CI` run #9437 success; **production deployment NOT VERIFIED**. The body below is otherwise unchanged and still describes the state at authoring; where it says "Draft" or "not merged" this note supersedes it. Cross-horizon status: `TAX-ZATCA-RECONCILIATION-AUDIT.md`.
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: TAX-HZ-00 → TAX-N01)
ZONE: C — ZATCA / observability

## Executive summary

| | |
|---|---|
| Verdict | **PASS locally.** Every failure that reaches the dispatcher's `catch (Throwable)` now emits **one** structured `error` log with a stable cause code, **before** the failure is persisted. What is persisted, the transaction structure, transport, queue and notifications are unchanged. |
| Production change | One file: `ZatcaSubmissionDispatcher` (+~55 lines: stage tracking, a classifier, a safe log helper). No new service, no exception hierarchy, no config/schema/route change. |
| Key finding | The PostgreSQL transaction-abort hypothesis is **true on current code** (see below). It is characterised by a test and the root cause is now logged; making the failure *persistable* is a transaction-structure change and belongs to **REM-22**, not here. |
| STOP conditions | None triggered (review below). |

## Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `af82fcb049358893812abab7ec56d017919627f6` (`origin/main` at start; contains REM-03, REM-03b, REM-08, REM-37 and the REM-11 harness) |
| Branch | `fix/zatca/tax-n01-dispatcher-diagnostics` |
| PR | recorded in the PR and the hand-back message (**Draft**) |
| Code + tests head | `1afe80dfb667734759c76d78172a431a49e9ee26` (backlog entry: `26cfb2ab024d782c2a01ef9f367ebd89184e4033`) |
| Final Head SHA | recorded in the PR and the hand-back message (a file cannot contain its own commit hash); it adds only this report |
| Merge SHA | `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36` (was "N/A" at authoring) |

## Original defect

`ZatcaSubmissionDispatcher::dispatch()` ran inside `DB::transaction(..., 1)` and wrapped the whole preflight/transport/completion flow in one `catch (Throwable)` that persisted `failed / submission_preflight_failed / retryable=false` and discarded the exception. Consequences:

1. **No diagnosability.** A DB error, a tampered snapshot, an undecryptable credential, an expired certificate, and an unexpected transport-layer exception were indistinguishable, and nothing was logged.
2. **A misleading "failure" on PostgreSQL.** For SQL errors at the dispatcher's own transaction level the `catch` never got to persist anything (see PostgreSQL analysis); the escaping error was the secondary `25P02`, not the cause.
3. The same `catch` also covered the success-path `complete()` call, so a persistence failure there was reported as a "preflight" failure.

## Failure map

`cause_code` is a **diagnostic-only** value in the log. The persisted/public contract is untouched.

| Failure source | Exception / signal | `cause_code` | Persisted **before** | Persisted **after** | Retryable before → after |
|---|---|---|---|---|---|
| Any SQL error (any stage) | `PDOException` / `QueryException` (and subclasses) | `database_error` | In the dispatcher's own statements: SQLite `failed / submission_preflight_failed`; **PostgreSQL: nothing persisted, attempt stays `pending`, `PDOException 25P02` escapes**. Inside `complete()`: exception escapes, `pending` (both DBs) | identical | false → false (where persisted) |
| Invoice lookup / snapshot check | `ModelNotFoundException` (load) or `RuntimeException` from `assertSnapshot` (incomplete snapshot, XML changed after the attempt, document type ≠ attempt type) | `snapshot_mismatch` | `failed / submission_preflight_failed` | identical | false → false |
| Encrypted credential cannot be decrypted | `DecryptException` (encrypted cast read) | `credential_unreadable` | `failed / submission_preflight_failed` | identical | false → false |
| Credential not usable | `RuntimeException` from `ZatcaTransportCredentialResolver::resolve()` (no tenant context, invalid env, not configured, wrong stage, expired, missing CSID/secret) | `credential_unusable` | `failed / submission_preflight_failed` | identical | false → false |
| Exception thrown from the transport call | non-`ConnectionException` throwable from the HTTP layer, `assertPayload` or endpoint resolution | `transport_error` | `failed / submission_preflight_failed` | identical | false → false |
| Anything else (e.g. non-DB error while completing) | any other `Throwable` | `preflight_error` (last-resort) | `failed / submission_preflight_failed` | identical | false → false |
| **Not an exception** — mapped inside the transport | `ConnectionException` → `failed / connection_failed / retryable=true` | *(no dispatcher log)* | as-is | identical | true → true |
| **Not an exception** — normal outcomes | HTTP 200/202 → `accepted`; 4xx → `rejected`; 408/429/5xx → `failed` retryable | *(no log)* | as-is | identical | unchanged |
| **Not an exception** — clearance 200 with unusable XML | `failed / invalid_clearance_response / retryable=true` (A2 N2) | *(no dispatcher log)* | as-is | identical | true → true |

Classification order: `PDOException` ⇒ `database_error`; `DecryptException` ⇒ `credential_unreadable`; otherwise by the stage in which the throw occurred (`load`/`snapshot` ⇒ `snapshot_mismatch`, `credentials` ⇒ `credential_unusable`, `transport` ⇒ `transport_error`, else `preflight_error`). The vocabulary is finite and never derived from message text, so message wording changes cannot alter it.

## Logging contract

Event `zatca_submission_dispatch_failed`, level **`error`** (same level as the sibling `zatca_submission_notification_failed`), snake_case event name and `tenant_id`/`attempt_id` keys as in existing ZATCA logs. Context is **exactly**:

| Field | Value |
|---|---|
| `attempt_id` | attempt UUID |
| `tenant_id` | attempt's tenant UUID |
| `exception_class` | `$e::class` |
| `cause_code` | one of the six codes above |

**Never logged:** exception message, stack trace, XML or request/response body, certificate, private key, CSR, OTP, CSID, secret, token, Authorization header, decrypted material, filesystem paths. The log call is wrapped so a logging failure cannot alter the flow. The log is emitted **before** the failure is persisted, so the cause is recorded even when persisting then fails.

## PostgreSQL transaction analysis

- **Boundary.** `dispatch()` opens `DB::transaction(fn, 1)`; the `try/catch` is **inside** that closure. `complete()` opens its own *nested* `DB::transaction` (a savepoint under the outer one) and is called both in the `try` (success path) and in the `catch` (failure path).
- **Forced error 1 — the dispatcher's own statement** (accepted clearance, then `UPDATE invoices SET zatca_cleared_xml…` made to fail with a missing column; this statement runs at the outer transaction level):
  - SQLite: `catch` → `complete(failed)` succeeds → **`failed / submission_preflight_failed / retryable=false`**.
  - **PostgreSQL: the SQL error aborts the outer transaction; the `catch`'s `complete()` tries `SAVEPOINT` and gets `25P02 current transaction is aborted`; the whole dispatch rolls back; the attempt stays `pending`; a `PDOException 25P02` escapes** — the root cause (`42703`) is lost. Hypothesis **confirmed**.
- **Forced error 2 — inside `complete()`** (missing `response_payload` column): the nested savepoint rolls back, the `catch` retries `complete()` and hits the same error; the exception escapes and the attempt stays `pending` on **both** databases.
- **Why no structural change was needed.** TAX-N01's acceptance is diagnosability: logging before `complete()` records the root `QueryException`/`database_error` in every case, including the PostgreSQL abort. Persisting `failed` after an abort would require moving the failure handling (and the HTTP call, per the backlog) outside the transaction and likely new `sending`/`unknown` states — **REM-22**'s scope ("HTTP callback at transaction level 0"). Not done here (STOP conditions 2/3/10 evaluated: not required for TAX-N01).

Tests pin both behaviours per database: `a_database_error_in_the_dispatcher_is_logged_and_persists_the_same_failed_state_on_sqlite` (SQLite) and `on_postgresql_a_database_error_aborts_the_transaction_and_the_root_cause_is_still_logged` (PostgreSQL: asserts `25P02`, attempt still `pending`, and the log shows `database_error` with `QueryException`).

## Notification bridge

Inspected `ZatcaNotificationBridge::queueEvaluation` (called by `complete()` for `rejected`/`failed`, deferred with `DB::afterCommit`). **Not changed.** Its own failures are logged separately as `zatca_submission_notification_failed` with `tenant_id`, `attempt_id` and the **raw `$e->getMessage()`**. That path handles notification rows, not XML/credentials, so it does not breach this task's acceptance, but a raw message from a `QueryException` can embed SQL with bound values. **Finding for the owner** (same pattern in `FinancialAlertNotificationBridge`): scrub to class + stable code in a separate, explicitly approved change.

## Side-effect invariants

For the forced failures the tests assert, as applicable: attempt count unchanged (no duplicate attempt), the credential row unchanged, `journal_entries`/`journal_lines`/`stock_movements`/`payments` counts unchanged, `max(zatca_icv)` unchanged, the invoice row unchanged (for failures that precede any invoice write), `Queue::assertNothingPushed()`, and `Http::preventStrayRequests()` with `Http::assertNothingSent()` where no transport call is expected. No live ZATCA call, OTP or CSID operation occurs anywhere (`Http` is faked).

## Tests — `tests/Feature/TaxN01ZatcaDispatcherDiagnosticsTest.php` (14 methods incl. 3 provider cases)

SQLite-only DB-error persistence · PostgreSQL-only transaction-abort · DB error inside `complete()` · changed XML snapshot (with a `SECRET_XML_MARKER` in the XML) · document-type mismatch · undecryptable credential (ciphertext containing `CREDENTIAL_MARKER`/`PRIVATE_KEY_MARKER`) · expired credential · exception thrown by the HTTP layer (message containing `TOKEN_MARKER`, an Authorization header, XML and a private-key header) · invalid stored hash rejected inside the transport · `ConnectionException` characterised (mapped, unchanged, no dispatcher log) · generic fallback (partial mock of `ZatcaSubmissionService`) · accepted / rejected / 503 (provider) never emit the failure log.

Every failure test asserts: the exact allowed key set; correct `attempt_id`/`tenant_id`; the exact `exception_class`; the expected `cause_code`; level `error`; exactly one dispatch-failure log; the unchanged persisted state; and a scan of **all** captured log events (via `Log::listen`, i.e. the real `MessageLogged` payloads) for the four markers, `<Invoice`, `<?xml`, key/certificate headers, `Authorization`, `Basic `, `csid` and `secret`. No production logging configuration was changed.

## SQLite

Local app assembled with the CI copy list (`nibras-app`).

| Command | Result |
|---|---|
| `--filter=TaxN01ZatcaDispatcherDiagnosticsTest` | 13 passed, 1 skipped (PostgreSQL-only test) — 283 assertions |
| focused set¹ | **299 passed, 1 skipped** (3113 assertions) |
| **full suite** `php artisan test` | **6549 passed**, 74 skipped, **142 failed** (823.8 s). The failing set is **identical** to the known baseline (diffed test by test: zero new, zero fixed). |

¹ `TaxN01|Zatca|Rem37|Rem03|Rem08|Notification` — includes `ZatcaSubmission{Dispatcher,Attempt,Recovery}Test`, REM-03b ZATCA tests, REM-37 permission/migration tests, the notification bridge tests.

## PostgreSQL

PostgreSQL 16 with CI settings (role `nibras`, db `nibras`, `max_locks_per_transaction=1024`), `migrate:fresh`, driver verified `pgsql`.

| Command | Result |
|---|---|
| `--filter=TaxN01ZatcaDispatcherDiagnosticsTest` | 13 passed, 1 skipped (SQLite-only test) — 278 assertions, **including the transaction-abort test** |
| focused set¹ | **299 passed, 1 skipped** (3108 assertions) |

The **full** PostgreSQL suite is covered by the CI `pgsql` leg on the final head (not run locally: sequential run cost).

## Negative control

Scratch copy only (`nibras-app`); the pre-TAX-N01 dispatcher from `origin/main` was dropped in, the tests run, then the file was restored and verified.

| Database | Result of the 14 methods |
|---|---|
| PostgreSQL | **9 failed** — PG transaction-abort, DB error inside `complete()`, changed XML, doc-type mismatch, undecryptable credential, expired credential, HTTP-layer exception, invalid stored hash, generic fallback; 4 pass; 1 skipped |
| SQLite | **9 failed** — SQLite DB-error persistence, DB error inside `complete()`, and the same seven others; 4 pass; 1 skipped |

All nine fail at one assertion — "actual size 0 matches expected size 1" on the dispatch-failure log — **after** the persisted-state assertions pass. So the persisted contract is the same before and after, and only the diagnostics were missing. The four tests that pass on the old code (connection-failure mapping, accepted/rejected/503) pin behaviour that must not change.

## Existing regression suites

ZATCA submission/dispatcher/attempt/recovery, REM-03/03b (Active-Branch-Only), REM-08, REM-37 (permission + migration) and notification suites: all pass on SQLite and PostgreSQL within the focused sets above.

## Files changed

| File | Change |
|---|---|
| `app/Services/Accounting/ZatcaSubmissionDispatcher.php` | stage tracking, `classifyFailure()`, `logFailure()`; log before persisting |
| `tests/Feature/TaxN01ZatcaDispatcherDiagnosticsTest.php` | new |
| `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` | TAX-N01 status entry |
| `docs/audits/horizon/TAX-N01-IMPLEMENTATION-REPORT.md` | this report |

Not touched: `ZatcaHttpTransport`, `ZatcaTransportCredentialResolver`, `ZatcaSubmissionService`, `ZatcaNotificationBridge`, the job/queue, controller, models, routes, schema, REM-03b/REM-37 code.

## Risks / remaining

**Deferred to REM-22 (transaction structure / in-doubt states):**
1. On PostgreSQL a SQL error at the dispatcher's own transaction level still leaves the attempt `pending` and surfaces a secondary `25P02`. TAX-N01 only makes the root cause visible.
2. A SQL error inside `complete()` still escapes with the attempt `pending` on both databases.
3. HTTP still runs inside the transaction while holding the row lock (up to ~35 s).

**Deferred to REM-21a (outcome classification):**
4. A clearance-200 with unusable XML is recorded `failed / invalid_clearance_response / retryable=true` (A2 N2) and is not an exception, so it is **not** in this log; likewise the transport-mapped `connection_failed`. Both are already coded and persisted, hence diagnosable from the attempt row; whether to also log mapped outcomes is an owner call.

**Owner decisions / notes:**
5. `ZatcaNotificationBridge` (and `FinancialAlertNotificationBridge`) log raw `$e->getMessage()` — see *Notification bridge*; not changed.
6. `credential_unusable` groups several resolver failures (not configured, wrong stage, expired, missing CSID/secret) because the resolver throws one exception type; separating them would need resolver changes (out of scope). Only the decrypt failure is separated (`credential_unreadable`).
7. `snapshot_mismatch` also covers a missing invoice row (`ModelNotFoundException`); that path is classified but was not forced by a test (practically unreachable: `zatca_submission_attempts.invoice_id` is `restrictOnDelete`, so an invoice that has attempts cannot be deleted). The "incomplete snapshot" `assertSnapshot` branch shares the same classification and is also not forced individually.
8. Log volume: at most one line per failed dispatch.

## CI

Recorded in the hand-back message against the exact final head (a file cannot contain its own head's CI result).

## Merge / Deploy

- **Draft**: yes
- **NOT MERGED**
- **NOT DEPLOYED**
- No Railway or GitHub settings changes; no live ZATCA calls; no OTP; no CSID operation.

## Next step

Owner review only.
