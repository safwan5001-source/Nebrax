# IMP-PS-A3d — Final claims, overlap acknowledgement and the actual `reviewed → closed`

**Scope (owner, 2026-11-02):** PS-A3d only. **Not built:** void / explicit replace / claim release (PS-A3e), bulk approval (PS-A4, D-PS-18), PS-A4 UI, Track B. **No journal entry, document, payment, balance, stock, tax or ZATCA effect; no posting; `LedgerService` and the ledger tables are untouched.** Not merged, not deployed, no Railway change.

Owner decisions applied: **D-PS-15** (no automatic R-REV) · **D-PS-16** (reason mandatory to accept a financial difference — unchanged) · **D-PS-17** (independent permission `partner_statements.close`; closer ≠ reviewer) · **D-PS-18** (bulk approval deferred to PS-A4).

## 0. The ledger-race question (owner caveat) — resolved **without** touching `LedgerService`

The owner asked: if stopping a new ledger posting during a close would need a change in `LedgerService` or the ledger database, **do not do it automatically** — document the gap and keep `closed` disabled. **That condition did not arise.**

- Every `LedgerService::post()` / `reverse()` already takes the **tenant anchor row lock** (`SELECT … FROM tenants WHERE id = ? FOR UPDATE`) through `AccountingDateGuard::assertOpen()` **before any write**; `FiscalCloseService` and the period-lock service use the same lock by design (documented in `AccountingDateGuard`).
- The close transaction takes **that same row lock before it reads the ledger**. So a posting/reversal either committed before the lock (the close sees it) or waits for the close to commit (the close never misses it, and a later posting simply isn't part of this final). Nothing in `LedgerService` or the ledger schema changed; the lock is acquired from `PartnerStatementClaimService::lockLedgerAnchor()` (a read-only `lockForUpdate` on the tenant row).
- **Proved on real PostgreSQL with `pcntl_fork`** (not argued): (1) a posting held in flight (~2 s inside its transaction) while a close starts → the close **waits**, then sees the new in-period entry, the review run is stale → refused `run_stale`, no claims, no event; (2) the lock method the close uses really **blocks `LedgerService` postings** until it commits (poster waits ≥ 0.9 s). **Mutation control:** removing the anchor lock fails (1).
- **Residual behaviour (explicit):** while a close runs, all ledger postings of that tenant wait for it (it is short: one candidates read + a bounded claims insert). Deadlock with posters (which hold a `FOR KEY SHARE` from FK checks before upgrading) is handled the same way the rest of the system does: the whole close transaction is retried up to 3 times on a database deadlock; business refusals are never retried. Postings **after** a close are not claimed by it (documented limit 1 of plan §5.5); a later final that covers the date claims them.

## 1. What was built

| Piece | File | Role |
|---|---|---|
| Migration | `2027_01_02_010000_add_partner_statement_final_claims.php` | claims table, `closed_at/closed_by/scope_key`, event `reviewer_id/claims_count`, partial unique indexes, DB guards (PostgreSQL + SQLite) |
| Claims | `PartnerStatementClaimService` + `PartnerStatementUnitClaim` (`CompanyWide`, immutable) | locks, claimed set, conflicts, overlaps, scope key, claims insert |
| Close | `PartnerStatementLifecycleService::close()` | the atomic transition, replay, status `close`/`final` blocks |
| Permission | `Rbac::PERMISSIONS` + `PartnerStatementMatchService::authorize` | `partner_statements.close` (+ `.view`), never in `MATRIX`, `owner`/`admin` via `*` only |
| API | `POST …/close` `{run_id, acknowledge_overlap[], note}` | route middleware now `partner_statements.close` (was `reconcile`); `GET …/status` gains `close` + `final`; `GET …/events` exposes `reviewer_id`, `claims_count` |

## 2. Contract

**Who may close (D-PS-17).** `partner_statements.close` **and** `.view`, plus `partners.view`, partner visibility, branch scope and the application gate (suspended/disabled ⇒ 403). `reconcile` is **not** required and does not suffice. **The closer must differ from the reviewer** who set `reviewed` (`403 closer_must_differ_from_reviewer`); both identities are stored in the close event (`created_by`, `reviewer_id`). The permission is not in `MATRIX`, not granted to any stored role by migration, and `owner`/`admin` hold it through `*` only (test).

**`POST …/close` — one atomic transaction** (any failure ⇒ full rollback: no claims, no event, no status change). Lock order: per-reconciliation advisory lock → **partner/role-wide** advisory lock (serialises closes of one partner) → reconciliation row `FOR UPDATE` → **tenant anchor row** → ledger read. Checks, in fixed order:

| # | Check | Refusal |
|---|---|---|
| 1 | status `reviewed` (a `closed` one with the same run replays) | `409 reconciliation_not_reviewed` / `reconciliation_already_closed` |
| 2 | closer ≠ reviewer | `403 closer_must_differ_from_reviewer` |
| 3 | `run_id` = the run the reviewer approved | `409 run_is_not_the_reviewed_run` |
| 4 | statement lines still match the import digest; run fresh (engine · policy · scope · **ledger fingerprint** · **statement digest**); every line has an effective explicit decision **on this run** | `409 statement_changed` / `run_stale` (+causes) / `unresolved_lines` / `decisions_on_other_runs` |
| 5 | closable scope: whole organisation (`org`) or one branch; several-branch restriction has no honest scope (D-PS-12) | `422 scope_not_closable` |
| 6 | no existing final of the **identical period** whose scope intersects (organisation ⇄ anything, same branch) — §5.3 | `409 final_already_exists` |
| 7 | **no real conflict:** none of the claimed entries has an active claim from another reconciliation of the same partner/role (any period, any branch) | `409 unit_conflict` + ids + bounded sample |
| 8 | overlapping finals (period overlap **and** intersecting scope) must be acknowledged: `acknowledge_overlap` = the server's list exactly | `409 overlap_ack_required` / `overlap_ack_stale` (+ the list) |

Then, in the same transaction: claims insert → close event (`from reviewed to closed`, run, ledger fingerprint, statement digest, summary incl. `scope_key`, claims counts, **the acknowledged overlap ids**, accepted-difference total, `reviewer_id`, `claims_count`) → reconciliation `status = closed`, `closed_at/by`, `scope_key`. Replay of the same request on a closed reconciliation → `200 replayed`, no new event or claims. `closed` is **terminal** in A3d (no decisions, review, reopen or second close; void/replace = A3e).

**The claimed set (D-PS-14 / plan §5.5) — not the search candidates.** Claimed = (a) every entry dated **inside** the statement period (any unit state: active/neutralised/incomplete), plus (b) every entry the **decisions actually used** (`confirm`/`override`: all entries of the unit; **`link_pair`: only the chosen member's entry** — the other member is claimed only if it falls inside the period; `dismiss`: nothing). Unused tolerance-window candidates are **not** claimed, so adjacent periods close without conflict; a window entry that a decision used **is** claimed and conflicts with an earlier final. A reversed pair can therefore be split across two finals, each member claimed once, never twice; **no R-REV entry is ever created** (D-PS-15). Date overlap alone is never a conflict (negative test): it needs an exact acknowledgement; only a shared entry is refused.

## 3. Database guarantees (PostgreSQL **and** SQLite — raw SQL cannot bypass them)

- `partner_statement_unit_claims`: **partial unique index** `(tenant, partner, role, journal_entry_id) WHERE released_at IS NULL` (no second active claim, across periods/branches, even by raw SQL); shape (`role`, `released_at` null in A3d, `period` ⇒ no line / `decision` ⇒ line); inserts only for a **`reviewed`** reconciliation of the **same partner and role**, for an entry **of this tenant that carries a line of that partner**, and a statement line of the same reconciliation; **no UPDATE/DELETE/TRUNCATE** (release arrives with A3e).
- `partner_statement_reconciliations`: `closed` only with `closed_at/by` + `scope_key` set and **`closed_by ≠ reviewed_by`** (CHECK/trigger); **never inserted as closed**; a `closed` row is immutable; review/close fields change only through a status transition; the transition to `closed` requires the **latest event to be a `close` event** whose actor = `closed_by`, `reviewer_id` = `reviewed_by`, run = `reviewed_run_id`, and **`claims_count` = the actual number of claims**; partial unique index `(tenant, partner, role, period_from, period_to, scope_key) WHERE status = 'closed'`; trigger: an `org` final and any other final of the **identical** period cannot coexist; a reconciliation with claims cannot be reopened.
- `partner_statement_reconciliation_events`: `close` shape (run + fingerprints + `reviewer_id` + `claims_count`, `created_by ≠ reviewer_id`); insert guard: the reviewer must be the reconciliation's recorded reviewer **and** the actor of the latest `mark_reviewed` event, and `claims_count` must equal the recorded claims; other actions must not carry those columns.
- Every nullable column in a CHECK/trigger is paired with an explicit `IS NOT NULL`. `down()` refuses if any claim, close event or `closed` row exists, then restores the A3c guard bodies; verified up → down → up on both engines.
- **What the database cannot verify** (and the service does, under the anchor lock): ledger-fingerprint freshness, the statement digest, that every line has a decision, and the overlap acknowledgement. A privileged raw-SQL actor could still hand-craft a *consistent* close (matching event + claims) — they cannot create a double claim, a self-close, a claim-less/count-mismatched close, or alter a closed row.

## 4. Tests

| Suite | Result |
|---|---|
| `PartnerStatementCloseApiTest` (new, 20) | SQLite ✔ · PostgreSQL ✔ |
| `PartnerStatementCloseConcurrencyPostgresTest` (new, 6, `pcntl_fork`) | PostgreSQL ✔ (skipped on SQLite by design; absence of pcntl on PG = failure) |
| `PartnerStatementLifecycleApiTest` (updated: close now needs review, SoD, `not_reviewed` state; wall allows the 3rd update) | SQLite ✔ · PostgreSQL ✔ |
| Related set on SQLite (Rbac · Permission · BranchIsolationGuard · ApplicationCatalog · all PartnerStatement* · PartnerLedger*) | 419 passed, 23 skipped (PostgreSQL-only), 4 failed — `Fuel*` tests, `bcmath` extension missing in this sandbox (`Call to undefined function bcmul()`), unrelated; they pass in CI |
| Same family on PostgreSQL (PartnerStatement* · PartnerLedger* · BranchIsolationGuard · ApplicationCatalog, incl. all earlier race suites) | **199 passed (3853 assertions)** |
| Full `php artisan test` | not run locally; CI runs it on SQLite and PostgreSQL (see PR #1941) |

Coverage highlights: atomic success with claims/event/status and **no financial effect** (row counts of journal/accounts/invoices/payments/stock unchanged) · replay safety · permissions matrix (view-only, reconcile-only, close-without-view, no `partners.view`, viewer, reviewer holding close) · stale ledger / wrong run / changed statement / draft · real conflict across different periods with ids + sample and **no trace** · overlap without shared movement (required / stale-narrow / stale-wide / exact / stale-when-none) · adjacent periods + tolerance window (no conflict) and the counter-case (used outside-period entry conflicts) · `link_pair` member split and same-member conflict (no automatic reversal entry created) · branch finals coexist, organisation/identical-tuple refusal, several-branch restriction · tenant isolation, gate, strict input · raw-SQL attempts (self-close, missing reviewer, wrong count, wrong reviewer/run, closing without/with defective event, claims on closed rows, immutability, identical-period cross-scope and same-scope) with positive controls · migration refusal/reversibility · static wall (no financial writer referenced; writes only events/claims).

**Real races on PostgreSQL:** 5 racing closes of one reconciliation by different closers → exactly one close event, the rest replay · two overlapping finals sharing a movement → exactly one wins, the loser gets a clean `unit_conflict` (no database error), no entry with two claims · disjoint finals close concurrently (no false blocking) · close vs reopen → one consistent final state · in-flight posting vs close (§0) · the anchor lock blocks `LedgerService`.

**Mutation controls (each must fail ≥ 1 test):**

| Mutant | Result |
|---|---|
| remove the tenant anchor lock | caught (PG in-flight-posting race) |
| remove only the partner/role advisory lock | **survives by design** — the tenant anchor already serialises every close; the partner lock is defence in depth. Removing **both** → caught (two-finals race + posting race) |
| skip the claims pre-check | caught (4 tests) |
| skip acknowledgement equality / the acknowledgement requirement | caught / caught |
| claim the whole candidate set instead of period + used | caught (3 tests) |
| `link_pair` claims the whole unit instead of the chosen member | caught |
| remove closer ≠ reviewer (service) | caught (2) |
| skip the identical-tuple refusal | caught (2) |
| drop the active-claim unique index | caught |
| drop the same-scope unique index | caught (after adding the raw same-branch test) |
| remove closer ≠ reviewer from the DB guard (SQLite trigger / PostgreSQL CHECK) | caught on both |
| remove the close-event match (actor/reviewer/run/claims count) from the PostgreSQL recon guard | caught |

## 5. Risks and open decisions

1. **Tenant-wide pause during close** (§0): correctness over latency; short and bounded. If measured contention matters, the partner/role lock + claim check could run before the anchor and only the final read-and-write hold the anchor — not needed now.
2. **Claim granularity is per entry, not per line** (plan limit 3). Two branch-scoped finals over different branches that share one multi-branch entry conflict (conservative: refuses rather than double-claims).
3. **Every in-period entry is claimed**, including ledger units the statement lacks (`missing_in_statement`) — closing says "this period's movements were reviewed". Stated and tested; relaxing it is a policy decision (CLAUDE.md #6), not assumed.
4. **No release path** until PS-A3e: a mistaken close cannot be undone (terminal). That is why A3e (void/replace + claim release, with the PG race matrix) should follow before any UI exposes `close` (PS-A4).
5. The overlap acknowledgement and run freshness are service-level guarantees under the anchor lock (§3 last bullet), not database-level.
6. **Not run locally:** the entire repository suite (see the table) — CI runs it on both engines.

## 6. Delivery

Branch `claude/imp-ps-a3d` · PR #1941 · Base `2c0a4148be7402d56fe67daba7e93fa3d6d5c3d8` (main after #1939) · first Head `da984b6ec86899d44e9d918d971da7543cc43a28` · CI and Codex: pending at the time of writing — see the PR. Status: **READY_TO_MERGE after green CI and Codex review** (no merge, deploy or Railway change made).
