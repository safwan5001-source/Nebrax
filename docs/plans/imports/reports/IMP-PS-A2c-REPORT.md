# IMP-PS-A2c — Deterministic statement matching engine (R1–R3), match runs, API

**Scope (owner, 2026-11-02):** PS-A2c only, per `AWJ_IMP_PS_A2_EXECUTION_PLAN.md` §3–§4. **Not built:** review/close/void (PS-A3), UI (PS-A4), Track B, manual-decision persistence. **No journal entry, document, payment, balance, stock or ZATCA effect; no new permission; the A1/A2a/A2b code is unchanged except one route block.** Base: `main@b5462eea5` (current `main` when cut; independent of the test-fragility PR #1907).

## 1. What was built
| Piece | File | Role |
|---|---|---|
| Migration | `2026_12_27_010000_create_partner_statement_match_tables.php` | `partner_statement_match_runs` + `partner_statement_matches` (additive; composite tenant FK to the reconciliation/run; unique `(tenant, reconciliation, run_key)`; `down()` refuses with data) |
| Models | `PartnerStatementMatchRun`, `PartnerStatementMatch` | `CompanyWide`, immutable after creation (an update throws) |
| Engine | `PartnerStatementMatchingEngine` | **pure** deterministic function (no DB, no clock) — rules, outcomes, double-use guard, suggestions |
| Service | `PartnerStatementMatchService` | authorization, candidates, document-number enrichment, idempotent run, reads, `verifySet` |
| API | `PartnerStatementMatchController` + 3 routes | `POST partner-statement-reconciliations/{id}/match`, `GET …/{id}/matches`, `GET …/{id}/verify-set` |

The only ledger access is `PartnerLedgerCandidates` (PS-A2b), which itself reads only through `ReportService::partnerStatement`.

## 2. Rules and outcomes (exactly the approved plan)
- **R1** `our_reference_key` = our document-number key · **R2** `reference_key` = our counterpart key (purchases: `supplier_invoice_no`; everything else: the document number) · **R3** no key hit: mirrored direction + amount within P-2 + date within P-1, **unique on both sides**. First hit wins. No new rule was invented.
- **Orientation (D-PS-11):** counterparty orientation only; their debit = our credit for both roles.
- **Statement-side outcomes:** `matched` · `amount_difference` (signed difference; a wrong direction on a key hit is `amount_difference` with `direction_mismatch: true`) · `date_difference` (signed days) · `ambiguous` · `missing_in_books`. **Ledger-side:** `matched` · `missing_in_statement` · `needs_review` · `neutralised` · `incomplete` (the last three are my additions to the plan's two, to show *why* a unit is not "missing"; documented).
- **Explanation:** a code + params (no prose), the rule that fired, the numbers compared, candidate snapshots. `rule` is an **ordinal evidence tier** (R1 > R2 > R3), not a probability — no confidence percentage is claimed anywhere.
- **P-1/P-2** come from the policy frozen with the reconciliation (no per-run override in the API); tolerances are inclusive (edges tested at ±tol and tol+1).
- **P-4/reversals:** only `active` units are ever auto-matched. A key hit on a `neutralised` pair → `amount_difference / reversed_in_books` (difference = the statement amount against a zero net); on an `incomplete` chain → `ambiguous / candidate_reversal_incomplete`. R3 never sees them. They are listed on the ledger side with their reasons.
- **No double use:** a unit wanted by two lines (by key or by R3), or a line with several candidate units, makes **every** involved line `ambiguous` and assigns nothing; the unit is shown `needs_review`. A unit matched by a key is removed from R3 for all other lines.
- **Many-to-one:** never applied. Unresolved lines carry `suggestions` (pool ≤ 20 free units, sets of 2–3, ≤ 5 per line, first 200 unresolved lines; `suggestions_truncated` flagged beyond) flagged `suggestion: true`; suggested units are **not** reserved. `verify-set` checks a reviewer-chosen set (≤ 50 units) against a line (±P-2) — read-only, `applied: false`, nothing stored.
- **Kind hint:** a `kind` that contradicts the side for the role only adds a `kind_side_mismatch` warning.

## 3. Run semantics and API
- Idempotent: `run_key = sha256(engine version + policy + scope + ledger fingerprint)`; the same key returns the existing run (`200`, `replayed: true`), a changed ledger/policy/scope creates a new run (`201`) and keeps the old one. PostgreSQL: advisory lock per reconciliation + the unique index (never catching a unique violation inside a transaction).
- `GET …/matches`: latest run by default or `run_id`; filters `side`, `outcome[]`; `per_page ≤ 50`; unknown query/body parameters → 422; response carries `run`, `meta` and **`ledger_changed`** (current fingerprint/scope vs the run's) so stale results are visible.
- Non-UUID ids never reach the code (global route pattern → 404); any unknown/foreign/invisible reconciliation → the one identical refusal (422, same message as PS-A1), no existence leak.

## 4. Authorization, isolation, gates
- Routes: `partner_statements.reconcile` (run) / `.view` (read, verify) + `EnsureApplicationActive:accounting.partner_statements` (disabled ⇒ 403 for all; **suspended ⇒ reads pass, the POST is refused**) + throttles (20/min run, 60/min verify).
- In the service: the run requires **both** `reconcile` and `view` (it reads the ledger and produces the results) — a role with only `reconcile` gets 403 (no implicit grant; documented decision); then `assertAccess` (active actor, `partners.view`, SAR tenant, partner visibility as the report, role, branch inside the actor's scope). A role without `partners.view` gets the single refusal.
- Branch scope: the candidates are what the actor's branches allow; a restricted actor's run is labelled `branch`, never organisation-wide; a reconciliation with a branch filter outside their scope is refused; other branches' documents never appear in any response (tested by searching the body). **Disclosed consequence:** invoice numbers are per branch, so the same number can exist in two branches; an unrestricted actor citing it gets `ambiguous_multiple_documents_for_reference` (tested), a restricted actor sees only their own.
- Document numbers are read from the document models by ids that already came from the authorized ledger, with an explicit tenant filter (branch global scopes deliberately dropped there, since the ids were already scope-checked).

## 4b. Codex review of this PR (both valid, fixed with tests)
- **P1 — stored results must be authorized against the reader's scope.** A run stores ledger snapshots under the scope of whoever created it; a branch-restricted reader could otherwise read an organisation-wide run (default selection or `run_id`). `GET matches` now returns only runs whose scope is a set of branches **entirely inside** the reader's allowed branches (unrestricted readers read all); the default is the latest run *readable by the reader*; an unreadable `run_id` gets the one identical refusal; an organisation-scope run is never readable by a restricted reader. Test `a_stored_run_is_only_readable_inside_the_readers_branch_scope` (also asserts the other branch's document number never appears and that the restricted user's own run becomes theirs).
- **P2 (second round) — an ambiguous key line still *wants* its units.** A line whose reference hits several documents now counts as a wanter of each in the Phase-A conflict detection, so a competing key match (e.g. another line matching one of those documents by supplier reference) becomes `ambiguous / unit_claimed_by_several_lines` instead of being assigned silently. Test `an_ambiguous_key_line_still_wants_its_units_so_a_competing_key_match_is_not_assigned`.
- **Root-cause guard after three findings in the same area:** `double_use_invariants_hold_over_deterministic_random_scenarios` runs 400 seeded random scenarios (units/lines/states/tolerances) and asserts general invariants — a unit is assigned to at most one line; only `active` units are assigned; a unit that is a candidate of an `ambiguous` row is never assigned; a ledger `matched` has exactly one `matched` line; output is independent of input order. It fails against each of the earlier regressions (verified), so this class of defect is guarded as a property, not case by case.
- **P2 — units in a key ambiguity must not reach R3.** A reference hitting several documents left those units available to R3, so a reference-free line could be auto-matched to a unit still wanted by the ambiguous line. They are now excluded from R3 and from suggestions. Test `units_in_a_key_ambiguity_are_not_offered_to_r3_for_other_lines`.

## 5. Tests (SQLite and PostgreSQL)
| Suite | Result |
|---|---|
| `PartnerStatementMatchingEngineTest` (19, pure; includes a deterministic property check over 400 random scenarios) | pass on both |
| `PartnerStatementMatchApiTest` (14, real ledger: invoices/payment/reversals/branches/roles/tenants/stored-run scope) | pass on both |
| `PartnerStatementMatchConcurrencyPostgresTest` (2, `pcntl_fork`: 6 racers on one reconciliation → 1 run and 5 replays; 4 different reconciliations → 4 runs) | pass; fails when the advisory lock is removed |
| Wider local filter (BranchIsolation / Application / Rbac / Import / PartnerStatement / PartnerLedger / Report / Migration / Schema / Tenant …) | 2650 passed, 95 skipped (PostgreSQL-only), **5 failed — 4 `Fuel*` (no `bcmath` in the sandbox) and `AppSchemaContractCheckerTest` (the local mirror lacks `contracts/`)**; all environmental |
- **Mutation controls (each fails ≥ 1 test):** ambiguous wanters not counted in conflict detection · stored-run scope not checked · ambiguous-key units offered to R3 · double-use resolution removed · R3 allowed to use incomplete/neutralised units · R2-before-R1 · exclusive date tolerance · un-mirrored direction · suggestions applied as claims · access check removed · idempotency lookup removed · advisory lock removed (PostgreSQL).
- **Coverage requested:** duplicates (key twice, same unit by two lines), ambiguity (several candidates / several documents per reference), reversals (neutralised, incomplete, never matched), tolerance edges (inclusive, ±1), time boundaries (out-of-period units are matchable inside the window but never "missing"; period-edge candidate), isolation (other tenant, branch), compatibility (A1/A2a/A2b suites unchanged and green; `BranchIsolationGuardTest` accepts the new models), determinism (input order), financial no-effect (nine tables' row counts unchanged by a run; static wall: no ledger/document/inventory/ZATCA writer referenced, writes only to the two result tables).
- **Placement lesson applied:** the CI assembly copies only `tests/Feature/*.php`, so every new test (including the pure engine test) lives there.

## 6. Risks and disclosures
1. **`R-REV` is not built** (netting a statement's invoice + cancellation lines against a neutralised pair, plan §3.5). It needs an agreed linkage between the cancellation line and the pair; guessing would risk a wrong match. Proposed as **D-PS-15**. Until then such a statement shows `amount_difference / reversed_in_books` for the invoice line and `missing_in_books` for the cancellation line — noisy but safe.
2. **Reads recompute the current ledger fingerprint** (`ledger_changed`) — one report read per `GET matches`; acceptable at current volumes (statements ≤ 2000 lines), revisit if it shows up in profiling.
3. **Suggestions are bounded heuristics** (2–3 units, 20-unit pool, first 200 lines) — they never match anything and are labelled; a legitimate larger combination may simply not be suggested.
4. **Cross-branch duplicate document numbers** make key rules ambiguous for unrestricted actors (disclosed above) — correct, but a reviewer will see it.
5. **Results are derived and immutable**; persistence of reviewer decisions, discard and the "one effective final" guarantee are PS-A3.
6. Sandbox-only failures (bcmath, `contracts/`) are environmental; CI is the authority.

## 7. Next step (on owner approval, not started)
PS-A3 — review actions (confirm/override/clear), close/replace/void with the scope-aware constraints and the claims table designed in the PS-A2 plan §5, events table, and the PostgreSQL race tests; plus the D-PS-15 decision for `R-REV`.
