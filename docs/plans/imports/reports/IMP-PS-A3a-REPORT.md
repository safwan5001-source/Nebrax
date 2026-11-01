# IMP-PS-A3a — Review decisions on statement matches (confirm · override · clear)

**Scope (owner, 2026-11-02):** the **first slice of PS-A3 only**. **Not built:** reviewed/close/void/replace, unit claims, overlap acknowledgement, manual linking of reversed pairs, PS-A4 (UI), Track B. **No journal entry, document, payment, balance, stock or ZATCA effect; no new permission; no change to the accounting posting rules.** Base: `main@3e9df8c36` (PS-A2c merge).

## 0. Why this slice, and the PS-A3 split

PS-A3 as written in the plan (§5, §7) bundles five different guarantees. Each is a separate failure domain, so I propose five small PRs with a clear dependency chain. **Only A3a is delivered; the rest wait for the owner.**

| Slice | Content | Depends on | Why separate |
|---|---|---|---|
| **A3a (this PR)** | Review decisions confirm/override/clear, append-only log, stale-run guard, double-use guard, RBAC/branch/app gate | A2c | Needs no status machine and no close; a draft-only audit log |
| A3b | Manual review of **proven** reversed pairs (D-PS-15): link a statement's invoice + cancellation lines to one neutralised unit when the chain is complete and `reversal_of` is proven | A3a | Changes the "one unit ↔ one line" rule (a pair serves two lines) — must not be mixed with the base rules |
| A3c | `draft → reviewed → closed`, events table, single-scope close (plan §5.3–5.4: partial unique index + cross-scope trigger + partner/role advisory lock) | A3a | Introduces the "effective final" and the scope rules |
| A3d | Unit claims, overlap warning + acknowledgement, `unit_conflict` (D-PS-12 / D-PS-14, plan §5.5) | A3c | The movement-level conflict test and its races |
| A3e | Void and explicit replace (reason, release of claims, linear chains), PostgreSQL race matrix | A3c, A3d | Transitions out of `closed` |

Each slice is independently testable on SQLite and PostgreSQL and leaves the system consistent if it is the last one merged (A3a alone changes only `draft` reconciliations and has no effect outside the new table).

## 1. What was built

| Piece | File | Role |
|---|---|---|
| Migration | `2026_12_28_010000_create_partner_statement_review_decisions.php` | one additive table + DB guards (below) |
| Model | `PartnerStatementReviewDecision` | `CompanyWide`, `UPDATED_AT = null`, update/delete throw |
| Service | `PartnerStatementReviewService` | `decide()` and `list()` |
| Exception | `PartnerStatementReviewException` | stable `reason` code + explicit HTTP status (409 state/stale/conflict, 422 input) |
| API | `PartnerStatementReviewController` + 2 routes | `POST partner-statement-reconciliations/{id}/decisions`, `GET …/{id}/decisions` |
| Visibility change | `PartnerStatementMatchService` | `authorize`, `policy`, `source`, `readable` made `public` (no behaviour change) so one access check is shared |

## 2. Contract

**Actions** (`action`):
- **`confirm`** — accepts the engine's single proposal for a statement line (`matched | amount_difference | date_difference`) with its unit. A reason is **required unless the outcome is `matched`**. Cannot carry `unit_keys`.
- **`override`** — the reviewer assigns 1..50 ledger units. A **reason is mandatory** (≥ 3 characters after trimming). If the set's net differs from the line by more than the frozen amount tolerance (P-2), `accept_difference = true` is required (`difference_exceeds_tolerance` otherwise); the stored row records `expected_net_minor`, `set_net_minor`, `difference_minor` and `accepted_difference`.
- **`clear`** — withdraws the effective decision of the line (reason optional). A `clear` with no effective decision is a no-op replay.

**Effective decision** of a line = its highest `revision`; `clear` means "no decision". History is never rewritten.

**Units that can be reviewed:** `active` and matchable only. `neutralised`, `incomplete` and `zero_net` units are refused with `unit_not_reviewable` (D-PS-15: nothing is linked automatically or guessed; the manual linking of a *proven* pair is slice A3b).

**No double use:** a unit with an effective decision on one line cannot be given to another (`409 unit_already_decided`, with the unit and the holding line). Clearing frees it. A non-blocking warning `unit_proposed_for_another_line` tells the reviewer when the engine had proposed the unit for a different line.

**Stale results are not reviewable (`409 run_stale`)** — the run must match the present on **engine version, frozen policy, ledger scope and ledger fingerprint**; `details.causes` lists which changed. Changing the ledger, policy or engine therefore requires a new run (`POST …/match`) before any decision is recorded or withdrawn on it. Statement lines are immutable by the model guard, so the statement data cannot drift under a run (see risk 3).

**Only `draft` reconciliations are reviewable** (`409 reconciliation_not_editable`); reads stay available. The status machine itself arrives in A3c.

**Idempotent re-request:** the same action, units, reason and ledger fingerprint as the effective decision returns it with `replayed: true` (HTTP 200) and writes nothing; a changed reason or units is a new revision.

## 3. Database guards (PostgreSQL and SQLite, same intent)

- **Shape** (PostgreSQL `CHECK`, SQLite insert trigger): action ∈ {confirm, override, clear}; confirm/override carry 1..50 units; clear carries none; override carries a reason ≥ 3 characters; revision ≥ 1.
- **Revision continuity** (trigger + unique index `(tenant, reconciliation, line, revision)`): the new revision must equal `1 + max` of the same line — no gaps, duplicates or reordering, even through raw SQL.
- **Immutability:** UPDATE rejected; DELETE rejected while the tenant exists (cascade on tenant deletion passes); TRUNCATE rejected (PostgreSQL). `down()` refuses when any row exists.
- Composite tenant foreign keys to the reconciliation and run; no foreign key into any journal table.

## 4. Authorization, isolation, gates

- Routes: write = `partner_statements.reconcile`, read = `partner_statements.view`, both behind `EnsureApplicationActive:accounting.partner_statements` (disabled ⇒ 403 for all; **suspended ⇒ reads pass, writes refused**), write throttled 60/min.
- Service: the write needs **both** `reconcile` and `view` (same documented rule as the run — it reads the ledger and the results; no implicit grant), then `assertAccess` (active actor, `partners.view`, SAR tenant, partner visibility, role, branch inside the actor's scope).
- Unknown/foreign reconciliation or run ⇒ the same single refusal message as PS-A1/A2c (no existence leak); a line from another reconciliation ⇒ `line_not_found`.
- **Branch scope:** a run is usable only by an actor whose allowed branches contain its scope (same `readable` rule as A2c). `list` also hides decisions made on a run the reader cannot read, and the *latest* decision is computed before hiding (so a hidden newer decision never exposes an older, no-longer-effective one).

## 5. Concurrency

Writes are serialised per reconciliation by **two layers**: the PostgreSQL advisory lock (`partner-statement-review:{tenant}:{reconciliation}`) and a `SELECT … FOR UPDATE` on the reconciliation row that also re-reads its status. The effective-decision set, the double-use check and the next revision are all computed after those locks. The database nets (unique index + revision trigger) stand behind them. No unique violation is ever caught inside a transaction.

## 6. Tests (SQLite and PostgreSQL)

| Suite | Result |
|---|---|
| `PartnerStatementReviewApiTest` (14, real ledger) | pass on both (281 assertions) |
| `PartnerStatementReviewConcurrencyPostgresTest` (5, `pcntl_fork`) | pass on PostgreSQL; skipped on SQLite |
| Wider filter (PartnerStatement · BranchIsolation · ApplicationAccess/Catalog · Rbac · Migration · Schema · TenantApplication), run on the first push (before the Codex fixes below) | SQLite: 520 passed, 45 skipped (PostgreSQL-only) · PostgreSQL: 564 passed, 1 skipped — **0 failures** on both. The PartnerStatement suites were re-run after the fixes |

Covered: full lifecycle with linear revisions and a history read; reasons and acceptance rules and every malformed-input refusal (nothing written on any refusal); idempotent re-request and the changed-reason revision; double use by two lines and release on clear; stale run by ledger change and by engine/policy/scope; draft-only; `neutralised` and `incomplete` units refused for confirm **and** override; independent permissions (viewer, reconcile-only, no `partners.view`, none); disabled/suspended gate; other-tenant reconciliation/run/line; branch-restricted reviewer (org-wide run unusable, other branch's unit not in their ledger, hidden decisions); DB-level immutability, revision order and shape through raw SQL; migration `down()` refusal; static wall (no financial writer referenced; writes only the decision table); no financial effect (nine tables' row counts unchanged).

PostgreSQL races: six lines racing for one unit ⇒ exactly one winner and clean `unit_already_decided` refusals; six identical requests ⇒ one revision and five replays; four different decisions on one line ⇒ revisions `1,2,3,4` without gaps; three distinct lines/units ⇒ all succeed (no false blocking). Zero database errors surface.

**Mutation controls (each fails ≥ 1 test):** stale check removed · double-use check removed · non-`active` units allowed · override reason not required · difference acceptance not required · draft-only check removed · hidden-run filter removed from `list` · replay detection removed · (PostgreSQL) advisory lock **and** row lock removed ⇒ 3 of 4 race tests fail · replay not bound to the run · ledger read before the lock (the pre-fix code) ⇒ the lock-wait race test fails. *Finding recorded honestly:* removing the advisory lock alone does **not** fail the race tests, because the `FOR UPDATE` on the reconciliation row serialises the same writers — the two are redundant layers, kept deliberately (the row lock also gives the status re-read its guarantee).

### Codex review of this PR (both valid, fixed with tests that fail on the old behaviour)
- **P2 — a replay must not cross run scopes.** An organisation-wide run and a branch-restricted run share the same ledger fingerprint when every unit sits in one branch, so a restricted reviewer's `confirm` could be answered with the unrestricted reviewer's decision (its run id and audit data) — which `GET` deliberately hides. Replay is now bound to the **requested run** (`current.run_id === run.id`); a restricted reviewer gets their own revision on their own run and sees it in their list. Test `a_replay_is_bound_to_the_requested_run_…` (fails without the binding).
- **P2 — freshness is re-checked after the lock.** `LedgerService::reverse/post` do not take the review lock, so a reversal could commit while a decision waited for it and be confirmed from a pre-lock snapshot. The ledger source, the freshness check and the plan (unit state, net, warnings) are now computed **inside the transaction after the locks**. PostgreSQL test `a_reversal_committed_while_the_review_waits_for_the_lock_makes_the_decision_stale` (holder + reviewer + reverser forked; fails on the previous code, passes now). *Residual, declared:* under READ COMMITTED a posting that commits between that read and our commit is not prevented by a review-level lock; it surfaces as `run_stale` on the next decision/read. Closing that window needs the ledger anchor lock, which is out of scope here (the close slice A3c re-validates at close).

## 7. Risks and disclosures

1. **Confirm with a difference needs a reason; override always does.** These are conservative defaults chosen without owner input. Under the configurable-policy rule (CLAUDE.md #6) a tenant might want "confirm a difference without a reason". Proposed as **D-PS-16** (open, not assumed): keep the strict default unless the owner asks for a setting.
2. **No "dismiss / no counterpart" action.** A statement line with no ledger counterpart can only be left undecided; there is no way yet to record "reviewed — genuinely absent from our books". Needed before close can require every line to be resolved; proposed for A3c with the status machine.
3. **Statement data drift is guarded by immutability, not by a run digest.** `PartnerStatementLine` is immutable through its model guard and the reconciliation carries a frozen `identity_sha256`, but a raw-SQL edit of a line would not invalidate a run. A per-run statement digest would need a column on the A2c runs table; not added here to keep this slice additive-only. Recommended as part of A3c (close must verify it anyway).
4. **Each decision reads the ledger once** (`PartnerLedgerCandidates`, same cost as `GET matches`). Acceptable at current statement sizes (≤ 2000 lines); batch review would amortise it later.
5. Reading the ledger inside the transaction holds the per-reconciliation lock for one report read (same cost as `GET matches`); only writers of the same reconciliation wait.
6. `list` computes the effective set in memory over all decisions of one reconciliation (bounded by lines × revisions).
7. Sandbox: `bcmath` and `contracts/` are absent locally (unrelated `Fuel*` / `AppSchemaContractCheckerTest`); CI is the authority.

## 8. Next step (owner approval required; not started)

A3b — manual review of a *proven* reversed pair (D-PS-15), then A3c status machine and close. Decisions awaited: D-PS-16 (reason policy for confirming a difference) and whether "dismiss — absent from our books" belongs in A3c.
