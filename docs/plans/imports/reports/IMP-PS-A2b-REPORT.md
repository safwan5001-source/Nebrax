# IMP-PS-A2b — Statement source: reversal fix, additive keys (D-PS-10), golden snapshot, candidate source

**Scope (owner, 2026-11-01):** PS-A2b only, per `AWJ_IMP_PS_A2_EXECUTION_PLAN.md` §2/§3.5/§7. **Not built:** matching engine (A2c), close/void (A3), UI (A4), Track B. **No migration, no permission, no change to journal posting, balances, tax or ZATCA.** Base: `main@6ebbf093949cafcccf8ea082254153e438ea2cc2`.

## 1. Result of the reversal characterization (owner item 2/3)
`LedgerService::reverse()` creates the reversing entry with `reversal_of = original.id` and **no `source_type/source_id`**, and flips the original to `reversed`. `ReportService::partnerStatement` keeps rows when no role is requested, but with `partner_role` it kept a row only if the role of its **own** source was known — so the reversal row was dropped and the original stayed.

**Proven on unmodified code (SQLite and PostgreSQL), then fixed:**
| Case | Before the fix | After the fix |
|---|---|---|
| `both` partner, invoice 1,150.00 reversed + invoice 230.00, `partner_role=customer` | reversal row **missing** — customer statement overstated | rows identical to the unfiltered statement; closing 230.00 |
| supplier purchase reversed, `partner_role=supplier` | reversal row missing | reversal row present; closing 0 |
| the reversed purchase seen with `partner_role=customer` | (not shown) | still not shown (no leak) |
| a reversed **opening balance** (debit ⇒ customer nature; credit ⇒ supplier nature) | reversal line dropped from both | reversal follows the **original's** nature (never the flipped direction of the reversing line — Codex #1898 P2, fixed in the same PR with its own test); no phantom payable in the supplier statement |
| unfiltered statement | original + reversal, nets to 0 | unchanged |
| manual, source-less entry tagged to the partner, any `partner_role` | excluded | **still excluded** (pinned by a test; the fix does not widen it) |

**Fix (narrowest possible):** `ReportService::effectiveEntrySources()` resolves a source-less reversal entry to the source of the nearest ancestor reached through `reversal_of` (batched lookups, depth cap 8, chains such as reverse-of-reverse handled); the role filter and `partnerStatementSourceRoles()` use that effective source. Nothing is written, no entry or balance changes, the unfiltered report is untouched, and a reversed opening balance takes the role of its original (`openingRootRoles()`: net of the partner line on the root entry — debit ⇒ customer, credit ⇒ supplier), not the flipped direction of the reversing line.

**Isolation of the behavioural change:** the only report output that changes is a **role-filtered statement of a partner that has a reversed document**; it now nets that document to zero exactly as the unfiltered statement already did. Everything else is held by the golden snapshot (§3). This is a read-side correction of a report the owner asked to verify; it is reported here and in the Tracker so it is not mistaken for a silent change. Note: the pre-existing role-filtered statements of such partners that someone exported earlier were overstated by the reversed amounts.

## 2. D-PS-10 — additive keys
Each service row of `partnerStatement` gains `entry_id`, `entry_status` (`posted`/`reversed`), `reversal_of` (original entry id or `null`). **The HTTP endpoint is unchanged**: `ReportController::partnerStatement` builds its response from an explicit whitelist, so the three keys exist on the service rows only (a test pins the HTTP row keys: `date, number, description, debit, credit, balance, source`). No existing consumer (controller, `ArApControlBalanceService`, web) reads or changes.

## 3. Golden snapshot and backward compatibility
`tests/Feature/PartnerStatementReportGolden.php` (a PHP data file that returns the array; **not** JSON under `tests/Fixtures`) was **generated from the unmodified service** (before any edit) on a state with an opening balance, an invoice, a received payment with allocation, a purchase, a paid payment with allocation and a manual entry, read six ways: unfiltered · period (opening balance) · `customer` · `supplier` · `customer`+period · other branch. `PartnerStatementReportGoldenTest` compares the current output to it **after dropping only the three new keys**; ids are normalised to `U1..Un`, dates are fixed. It passes unchanged on SQLite and PostgreSQL, and the existing `ReportStatementsTest` (partner statement, ledger, aging) passes. Mutation checks: altering `description` or the running balance inside `partnerStatement` fails the golden test. **Why a PHP file in `tests/Feature`:** CI (`ci.yml`), `setup.sh` and `deploy/assemble.sh` assemble the test application by copying `tests/Feature/*.php` and only `tests/Fixtures/presentation/*.json`; a JSON fixture elsewhere would be missing there (Codex #1898 P1, valid — my local mirror copied the whole `tests/` tree and hid it). The `*.php` glob already copies it, so no workflow/script was changed; it is not collected as a test (name does not end with `Test.php`). The conversion round-trips identically (asserted at conversion) and the test passes with only `tests/Feature/*.php` copied, on SQLite and PostgreSQL. (An earlier mutation attempt hit the account-ledger block instead — caught by the run, redone on the right block.)

## 4. Candidate source — `PartnerLedgerCandidates` (read-only)
`app/Services/Reporting/PartnerLedgerCandidates.php`: reads **only through `ReportService::partnerStatement`** (period widened by the date tolerance, role, optional branch), groups rows into document units, and marks reversals.
- **Units:** document-level (`kind#source_id`, or entry id for source-less entries); entries are unioned by same source and by `reversal_of`. Each unit carries kind, label, numbers, entry ids, dates, `in_period`, debit/credit/net, direction, payment allocations, `state`, `matchable`, `reasons`.
- **Reversal handling without double counting:** `neutralised` (complete chain, net zero) → not matchable, excluded from candidate totals; `incomplete` (a chain member is outside the window: `reversal_outside_window` / `reversal_original_outside_window`) → not matchable, reason shown; a re-instated chain (reversed twice) is **one** `active` unit counted once; `zero_net` for ordinary zero units. Invariant checked on every call: Σ unit net = Σ statement-row net (it throws `LogicException` otherwise). `fingerprint` (SHA-256 of keys, entry ids, dates, nets, states) is ready for A2c's `ledger_fingerprint`.
- **Scope label (D-PS-12):** `organization` only when the actor is unrestricted and no branch filter; a one-branch filter or single-branch restriction → `branch`; a multi-branch restriction without a filter → `restricted_set` (never called organisation-wide).
- **Fail closed:** the authenticated user must be the passed actor (`ReportService::branchIds` reads `auth()`; with none it would read every branch) → `LogicException` otherwise; `partner_statements.view` required; then `PartnerStatementImportService::assertAccess` (active actor, `partners.view`, SAR tenant, partner visibility as the report, role match, branch inside the actor's scope) with the one identical refusal message.
- **Tests (`PartnerLedgerCandidatesTest`, 14):** keys correct · HTTP unchanged · units + stable/changing fingerprint · tolerance window · role split of a `both` partner · neutralised pair · incomplete pairs (both directions) · re-instated chain · branch-restricted actor (own branch only, other branch refused, org filter, restricted-set label) · permissions (no view, `partners.view` alone, no `partners.view`, wrong role, unknown id → one message) · other tenant's partner and ledger unreachable · fail-closed (no auth / wrong actor) · writes nothing (9 table counts + balances) · static wall (no ledger/document/inventory/ZATCA writer referenced).

## 5. Tests and verification
| Run | Result |
|---|---|
| `PartnerLedgerCandidatesTest` + `PartnerStatementReversalCharacterizationTest` (5) + `PartnerStatementReportGoldenTest` + `ReportStatementsTest` | SQLite 26 passed · PostgreSQL 26 passed |
| Characterization **before** the fix | 2 of 4 failed (invoice and purchase role-filtered reversal) — then green after; the opening-balance case (added after Codex's review) failed before its fix and is green after |
| Mutation controls (each fails ≥ 1 test) | role filter ignoring the original's source (12 fail) · new keys removed (10) · golden: description / running balance altered inside `partnerStatement` · neutralisation removed · auth guard removed · view-permission check removed (needed a test that grants `partners.view` alone — added) · restricted-set mislabel · opening reversal classified by the reversed direction (the Codex bug) |
| Wider local filter (report / statement / fiscal-close / AR-AP / purchase / branch / ledger / partner / RBAC) | 1089 passed, 17 skipped (PostgreSQL-only), **5 failed — all `Fuel*` tests that call `bcmul`/`bcadd` (no `bcmath` in this sandbox; CI has it)**; no report/statement/ledger/branch/RBAC failure |
- Financial no-effect: nothing is written by the candidate source or by the report change; the source files are statically checked and row counts of 9 financial/staging tables and account balances are unchanged by a call.

## 6. Risks and disclosures
1. **Behavioural report change** (§1): role-filtered statements of partners with reversed documents now net correctly. Anyone who stored earlier exports will see different (correct) numbers; the unfiltered statement and all balances are unchanged.
2. **Source-less manual entries stay outside role-filtered statements** (existing, pinned): a manual journal tagged to a partner never appears in a customer or supplier view. Out of scope; flagged for the owner if the statement should show them.
3. **Partner-tagged lines carry the active branch at posting time.** In the tests an invoice posted with no active branch yields a null-branch partner line, which a branch-restricted reader does not see. Production requests set the active branch; A2c must keep reading through the same source (it will) and the UI must state the scope label.
4. **Window edge pairs** are `incomplete` rather than silently matched: a reversal posted after the window leaves its original non-matchable in this run. A2c/A3 show the reason.
5. The report still reads `auth()->user()` for branch scope; the candidate source guards it, but any new caller of `partnerStatement` outside a request must do the same.
6. Local note: the Fuel suites need `bcmath` (sandbox only).

## 7. Next step (on owner approval, not started)
PS-A2c — the matching engine (R1–R3, five outcomes with stored rule/explanation, reversed-pair netting using `state`, run/matches tables with `ledger_scope`, verify-set read), then PS-A3.
