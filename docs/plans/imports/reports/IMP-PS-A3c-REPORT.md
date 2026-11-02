# IMP-PS-A3c — Reconciliation lifecycle: `draft ⇄ reviewed` (closing deliberately blocked), statement-lines digest, `dismiss`

**Scope (owner, 2026-11-02):** PS-A3c only. **Not built:** unit claims, overlap acknowledgement and the actual `closed` state (PS-A3d), void/replace (PS-A3e), PS-A4 UI, Track B. **No journal entry, document, payment, balance, stock, tax or ZATCA effect; no posting-rule change; no new permission.** Base: `main@7a5b42f94` (PS-A3b merge).

## 0. The decision: `closed` stays blocked until PS-A3d (owner requirement 10)

The owner asked to implement `reviewed → closed` only if a safe close can be guaranteed before PS-A3d. **It cannot, so `closed` is blocked** — at three layers (database `CHECK`, service, API) — and `reviewed` is delivered.

Why close is unsafe without PS-A3d (plan §5.5, D-PS-12/14):
- A final reconciliation must not let the **same ledger movement** be reconciled by two effective finals. The movement test needs a **claims table** with an active-claim unique index; the claimed set is *in-period entries* plus *outside-period entries the run actually used* (§5.5, case 1b).
- Two **adjacent** periods (January and February) can share a 31 Jan entry through the date-tolerance window. No period-overlap check, and not even the identical-tuple rules of §5.3–5.4, would catch it; only claims do.
- A close that skipped claims would be a silent double-reconciliation risk on the books' side. A conservative "refuse any other final" rule would contradict the approved D-PS-14 principle (date overlap alone is not a conflict) and still not cover the adjacent-period case.

So: `POST …/close` exists as an explicit, documented refusal (`409 close_blocked_pending_claims`, no state change), and the database **rejects any status other than `draft`/`reviewed`** (PS-A3d widens it with its own migration). Nothing in this PR makes `closed` reachable, even by raw SQL.

## 1. What was built

| Piece | File | Role |
|---|---|---|
| Migration 1 | `2026_12_31_010000_add_partner_statement_review_lifecycle.php` | header columns (`lines_digest`, `reviewed_at/by/run_id`), run column (`statement_digest`), append-only `partner_statement_reconciliation_events`, DB guards |
| Migration 2 | `2026_12_31_020000_add_dismiss_to_partner_statement_review_decisions.php` | widens the decision shape guard with `dismiss` |
| Digest | `PartnerStatementDigest` | SHA-256 over every statement line (all content columns **and** line id), ordered |
| Lifecycle | `PartnerStatementLifecycleService` + `PartnerStatementLifecycleController` | status/readiness, `markReviewed`, `reopen`, blocked `close`, events |
| Event model | `PartnerStatementReconciliationEvent` | `CompanyWide`, immutable |
| Changes to A1/A2c/A3a | `PartnerStatementImportService` (writes `lines_digest` at import), `PartnerStatementMatchService` (run stores/verifies the digest; it is part of `run_key`), `PartnerStatementReviewService` (`assertFresh` + digest, `dismiss`, 2 small public helpers) | additive |
| API (5 routes) | `GET …/status`, `GET …/events`, `POST …/review`, `POST …/reopen`, `POST …/close` (blocked) | |

## 2. Contract

**Transitions and permissions** (all: `partner_statements.reconcile` **and** `.view`, plus `partners.view`, partner visibility, branch scope, application gate — the same checks as review decisions):

| Transition | Who | Conditions |
|---|---|---|
| `draft → reviewed` | reconcile + view | one explicit `run_id`, **fresh** (engine · frozen policy · ledger scope · ledger fingerprint · **statement digest**); the statement still matches its import digest; **every statement line has an effective explicit decision** (confirm / override / link_pair / dismiss) **on that run and with its ledger fingerprint**; reconciliation is a `draft`. Otherwise `409` with a stable reason, nothing written |
| `reviewed → draft` (`reopen`) | reconcile + view | reason ≥ 3 chars; the run it was reviewed on must be **readable by the actor** (a narrower-scope reviewer cannot undo a wider-scope review). Nothing is deleted; decisions become editable again |
| `reviewed → closed` | — | **blocked** (§0) |

There is **no approved automatic-resolution policy**, so no line is auto-accepted: even an exact R1 match needs an explicit `confirm`. Proposed as **D-PS-18** (open). Ledger units that are in our books but not on the statement (`missing_in_statement`) are **reported** in the event summary (count) but do not block review — they are differences to disclose, not statement lines to resolve.

**Idempotency.** `review` on a reconciliation already reviewed **on the same run** replays (`200`, no new event); on another run it is `409 reconciliation_not_draft` (a review is never silently replaced).

**`GET …/status`** returns the readiness (`lines_total`, `resolved`, `unresolved`, `decisions_on_other_runs`, `decisions_by_action`), the ordered blockers (`statement_changed`, `no_run`, `run_stale` + causes, `unresolved_lines` + count + sample ordinals, `decisions_on_other_runs`), `can_mark_reviewed`, `reviewed_state` (`ledger_changed_since_review`, `statement_changed_since_review`) and `close: {available: false, blocked_reason}`.

**Events.** Every transition is a row in `partner_statement_reconciliation_events` (append-only, gapless `seq`): actor, time, reason/note, run, `ledger_fingerprint`, `statement_digest`, and a summary (lines, decisions by action, accepted-difference total, ledger units missing from the statement). Events tied to a run the reader cannot read are hidden from them.

### Statement-lines digest (requirement 4)
`lines_digest` is written **once at import**; every match run stores `statement_digest` and the digest is part of `run_key`. The digest is compared at match, at every decision and at `review`: a line **changed, deleted or inserted outside the application** (raw SQL) makes the run stale (`statement_digest`), refuses a new run (`statement_changed`) and blocks review. A run created before PS-A3c has no digest and is stale (`statement_digest_missing`) until re-run.

### `dismiss` (requirement 5)
"This statement line is not in our books." Allowed **only** when the engine's verdict for that line in the run is `missing_in_books`; **reason mandatory (≥ 3 chars)**; no units, no pair member; claims nothing. It records the full line amount as an accepted difference (D-PS-16) with the engine outcome/code. Append-only like every decision (clear withdraws it). **No financial effect.**

## 3. Database guards (PostgreSQL and SQLite)
- `status ∈ {draft, reviewed}` and review fields consistent with the status (`reviewed` ⇔ `reviewed_at/by/run_id` all set). **`closed` and anything else is rejected.**
- A status change is accepted only **after a matching audit event** (the latest event carries exactly that edge); an event is accepted only if its `from_status` equals the current status and its `seq` follows the previous one.
- The imported identity (partner, role, period, currency, file/identity hashes, counts, totals, frozen policy, checks, creator) is **frozen**; `lines_digest` is written once.
- Event shape: `mark_reviewed` ⇒ run + ledger fingerprint + statement digest; `reopen` ⇒ reason ≥ 3; no update/delete (except cascade from tenant deletion); no truncate (PostgreSQL).
- The A3a decision log is unchanged in nature (append-only, gapless revisions); only its shape guard gained `dismiss`.
- **Pitfall checked again:** every nullable column in a `CHECK`/trigger is paired with an explicit `IS NOT NULL` (a `CHECK` passes on NULL).
- `down()` of the lifecycle migration refuses if any event exists or any reconciliation is not a draft; the dismiss migration refuses if any `dismiss` row exists.

## 4. Concurrency (requirement 8) — what the lock does *not* protect
- The per-reconciliation advisory lock and `FOR UPDATE` on the reconciliation row are **the same ones decisions use**, so decisions, `review` and `reopen` serialise: a decision racing a review can never leave a `reviewed` reconciliation with an undecided line; racing reviews create one event; racing reopens succeed once; the event log stays gapless and the status always equals the last event's target.
- **The lock does not protect the ledger.** `LedgerService` does not take it, so an entry can be posted (or reversed) at any moment. Therefore (a) the ledger source, freshness check and decision checks are all read **after** the lock inside the transaction; (b) a posting that commits while a review waits is seen and the review is refused `run_stale` (PostgreSQL test, and the poster completes *during* the held lock — proving it is not blocked); (c) a posting that commits **after** the review is announced by `ledger_changed_since_review` and refuses further decisions until reopened and re-run. The residual window — a posting committing between our ledger read and our commit — exists by design under READ COMMITTED and is why close (PS-A3d) must re-validate and claim under its own guarantees. This is recorded rather than hidden.

## 5. Authorization, isolation, gates
Unknown/foreign reconciliation or run ⇒ the single identical refusal (no existence leak); runs usable only inside the reader's branch scope (`readable`); suspended ⇒ reads only (every transition 403); never-enabled ⇒ 403 for all; tenant isolation by the same refusal. Restricted reviewers: decisions made on an organisation-wide run do not count for their run (`decisions_on_other_runs`), so they re-decide on their own scope.

## 6. Tests (SQLite and PostgreSQL)

| Suite | Result |
|---|---|
| `PartnerStatementLifecycleApiTest` (17) | pass on both |
| `PartnerStatementLifecycleConcurrencyPostgresTest` (5, `pcntl_fork`) | pass on PostgreSQL |
| A1/A2c/A3a/A3b suites after the additive changes | pass on both (one A3a test now reaches `reviewed` legitimately through the lifecycle instead of a raw status update, which the new guard rightly rejects) |
| Wider filter | see the PR description |

Covered: the full cycle with audit rows and counts; early review refused with zero side effects; the blocked close at service, API and DB (raw `closed`/`voided`/`superseded` updates and inserts rejected); stale run (ledger) and decisions on another run; statement tampering by raw SQL (edit, delete, insert) detected and reversible; run without digest; `dismiss` contract and DB shape; DB guards for status/event/identity freeze; append-only events and migration refusals/round-trip; independent permissions, other-tenant, suspended/never-enabled gate; branch-restricted reviewer; static wall (writes only the event table and two `$fresh->update` calls); import writes the digest once. PostgreSQL races: six concurrent reviews → one event; four reopens → one; decision vs review invariant; review vs reopen gapless log; ledger posting during the lock.

**Mutation controls (each must fail ≥ 1 test):** 
- unresolved-lines blocker ignored → fails 2 tests
- statement-digest comparison removed from the freshness check → fails 1
- `dismiss` allowed for any engine outcome → fails 1
- `reopen` without the readable-run requirement → fails 1
- a reviewed reconciliation "replays" for any run (not only the reviewed one) → fails 1
- decisions on other runs / other fingerprints counted as valid → fails 2
- digest gate removed from the match run → fails 1; removed from `review` → fails 1
- freshness check skipped in `markReviewed` alone → **survives, as an equivalent mutant**: `evaluate()` re-applies the same check and refuses with the same `run_stale` reason and causes (two independent layers). Removing **both** layers fails 2 tests.
- (PostgreSQL) advisory lock **and** row lock removed from `review`/`reopen` → fails 3 of the 5 race tests; the other two (invariants on the event log and final status) still pass because the database guards (gapless `seq` trigger, `from_status` check, edge-matching status guard) hold even without the locks — the guards are a genuine second net, not decoration.

### Codex review of this PR
- **P2 — a dismissal inside the tolerance must still record the full accepted difference.** `dismiss` accepts the whole line amount explicitly, but the `accepted_difference` flag followed the ordinary tolerance rule (a 50-minor line with a 100 tolerance recorded `accepted_difference = false`), so the audit summary excluded it. The flag is now forced for `dismiss`, and the event summary's `accepted_difference_minor` is the **absolute total of every non-zero accepted difference** (inside the tolerance with a reason, or outside it with an explicit acceptance) — the same root cause would otherwise have under-reported within-tolerance confirmations (D-PS-16). Reproduced first (the new test fails on the previous code). Test `dismissing_a_line_inside_the_tolerance_still_records_the_full_accepted_difference_in_the_decision_and_the_audit_summary`.

## 7. Risks and disclosures
1. **No `closed` yet — by decision (§0).** Reviewed reconciliations are not "final": nothing prevents two reviewed reconciliations of overlapping periods from both existing (they are drafts-with-a-reviewed-flag, not effective finals). That is exactly what PS-A3d adds.
2. **Every line needs an explicit decision** — large statements mean many actions until a bulk policy (D-PS-18) is decided or a bulk UI exists (PS-A4).
3. **A ledger change forces re-deciding.** When a new run is needed (ledger/policy/statement changed), decisions made on the earlier run show as `decisions_on_other_runs` and must be repeated. Safe, but laborious; "carry forward unaffected decisions" is a feature for later.
4. **Reopen requires reading the reviewed run:** a branch-restricted user cannot reopen an organisation-scope review (intended).
5. **Residual ledger window** under READ COMMITTED (§4) — disclosed.
6. The run key now includes the statement digest: existing runs (without it) are never replayed; the next match creates a new run (derived data, nothing lost).
7. `lines_digest` is trusted from import onward; reconciliations imported **before** this PR have it `NULL` (their later runs still record `statement_digest`, so tampering after a run is detected; tampering between import and the first run is not).
8. Sandbox: `bcmath` and `contracts/` absent locally (unrelated `Fuel*` / `AppSchemaContractCheckerTest`); CI is the authority.

## 8. Next step (owner approval required; not started)
PS-A3d — claims table + active-claim unique index, overlap warning/acknowledgement, `unit_conflict`, same-scope/cross-scope close guards and the real `reviewed → closed` (with D-PS-17: permission and separation of duties). Decisions awaited: D-PS-17, D-PS-18.
