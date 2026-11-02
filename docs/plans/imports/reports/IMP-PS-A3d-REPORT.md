# IMP-PS-A3d — Final claims, overlap acknowledgement and the actual `reviewed → closed`

**Scope (owner, 2026-11-02):** PS-A3d only. **Not built:** void / explicit replace / claim release (PS-A3e), bulk approval (PS-A4, D-PS-18), PS-A4 UI, Track B. **No journal entry, document, payment, balance, stock, tax or ZATCA effect; no posting; `LedgerService` and the ledger tables are untouched.** Not merged, not deployed, no Railway change.

Owner decisions applied: **D-PS-15** (no automatic R-REV) · **D-PS-16** (reason mandatory to accept a financial difference — unchanged) · **D-PS-17** (independent permission `partner_statements.close`; closer ≠ reviewer) · **D-PS-18** (bulk approval deferred to PS-A4).

## Revision 2 (owner review of #1941, 2026-11-02) — claims policy corrected

**Why.** The first version claimed **every entry dated inside the period** plus the entries decisions used. The owner's approved policy is narrower: a closed reconciliation must claim **only the entries its decisions actually used** — an entry that merely falls in the date range (and is absent from the statement) must not be locked, because it can legitimately be reconciled by another period's statement.

**Data-contract check first (A3a/A3b).** The decision log stores the reviewer's explicit `unit_keys` (confirm = the engine's proposed unit the reviewer accepted; override = the reviewer-chosen units; link_pair = one unit **plus the two pair entry ids and the chosen member**), each decision carries the ledger fingerprint it was made on, and the fingerprint covers every unit's entry ids. At close the run must equal the current ledger fingerprint, so unit → entries is bound by evidence, not inferred from amount/date. No gap was found, so this is **not BLOCKED**; no new linkage was invented.

**New policy (implemented in `PartnerStatementClaimService::claimSet`):**

| Decision | Claims |
|---|---|
| `confirm` | the entries of the confirmed unit |
| `override` | the entries of each reviewer-chosen unit |
| `link_pair` | **only** the explicitly chosen member's entry (`original` or `reversal`); never the other member |
| `dismiss` | nothing (no linked entry) |
| entry in the period absent from the statement (`missing_in_statement`) | **not claimed**; listed as `unclaimed_in_period` (count + sample) in the close-event summary and in `GET …/status` → `final`; usable by another period |

**Fail-closed identity checks at close** (`claim_identity_unproven`, 409): a decision whose unit is missing from the current ledger, not `active`/matchable, or has no entries; a `link_pair` whose unit is not a `neutralised` two-entry pair, whose stored original/reversal ids are not exactly the unit's entries, whose reversal does not point to the original through `reversal_of`, or whose member is invalid; a line decided twice on one entry (`claim_entry_used_twice`). Identity is never taken from amount, date or number similarity.

**Database follow-up (migration edited in place — unreleased).** Claims are `basis = 'decision'` with a mandatory `line_id`; the insert trigger now requires that line's **latest** decision to be `confirm`/`override`/`link_pair` (so `dismiss` and cleared lines can never be claimed, even by raw SQL) and, for `link_pair`, that the claimed entry **is the chosen member's entry**. (The database cannot map a unit key to its entries without reading the ledger, so unit→entries for confirm/override stays a service guarantee under the anchor lock — stated limit.)

**Unchanged (verified by the suites):** one active claim per entry across finals/periods/branches, tenant-anchor locking against ledger posting/reversal, D-PS-14 acknowledgement, D-PS-15 (no automatic reversal), D-PS-16, D-PS-17, fingerprint/digest/run freshness, scope rules, atomic close. No ledger/ZATCA/balance change.

**Files changed in this revision:** `app/Services/PartnerStatementClaimService.php` (claimSet rewrite, identity proofs, `unclaimedInPeriod`) · `app/Services/PartnerStatementLifecycleService.php` (call site, `unclaimed_in_period` in the event summary and `final`) · `app/Models/PartnerStatementUnitClaim.php` · `database/migrations/2027_01_02_010000_add_partner_statement_final_claims.php` · `tests/Feature/PartnerStatementCloseApiTest.php` · `tests/Feature/PartnerStatementCloseConcurrencyPostgresTest.php` · plan §5.5 amendment · tracker · this report.

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

Then, in the same transaction: claims insert → close event (`from reviewed to closed`, run, ledger fingerprint, statement digest, summary incl. `scope_key`, claims counts, `unclaimed_in_period`, **the acknowledged overlap ids**, accepted-difference total, `reviewer_id`, `claims_count`) → reconciliation `status = closed`, `closed_at/by`, `scope_key`. Replay of the same request on a closed reconciliation → `200 replayed`, no new event or claims. `closed` is **terminal** in A3d (no decisions, review, reopen or second close; void/replace = A3e).

**The claimed set (revised, see Revision 2).** Claimed = the entries **used by the effective decisions** (confirm/override: the units' entries; `link_pair`: the chosen member only; `dismiss`: none). Entries inside the period that the statement lacks are **not** claimed and are reported as `unclaimed_in_period`. A reversed pair can be split across two finals, each member claimed once, never twice; **no R-REV entry is ever created** (D-PS-15). Date overlap alone is never a conflict: it needs an exact acknowledgement; only a shared *used* entry is refused.

## 3. Database guarantees (PostgreSQL **and** SQLite — raw SQL cannot bypass them)

- `partner_statement_unit_claims`: **claims only for a line's effective confirm/override/link_pair decision (link_pair: the chosen member's entry only; dismiss/cleared lines claim nothing)**; **partial unique index** `(tenant, partner, role, journal_entry_id) WHERE released_at IS NULL` (no second active claim, across periods/branches, even by raw SQL); shape (`role`, `released_at` null in A3d, `basis = decision` with a line); inserts only for a **`reviewed`** reconciliation of the **same partner and role**, for an entry **of this tenant that carries a line of that partner**, and a statement line of the same reconciliation; **no UPDATE/DELETE/TRUNCATE** (release arrives with A3e).
- `partner_statement_reconciliations`: `closed` only with `closed_at/by` + `scope_key` set and **`closed_by ≠ reviewed_by`** (CHECK/trigger); **never inserted as closed**; a `closed` row is immutable; review/close fields change only through a status transition; the transition to `closed` requires the **latest event to be a `close` event** whose actor = `closed_by`, `reviewer_id` = `reviewed_by`, run = `reviewed_run_id`, and **`claims_count` = the actual number of claims**; partial unique index `(tenant, partner, role, period_from, period_to, scope_key) WHERE status = 'closed'`; trigger: an `org` final and any other final of the **identical** period cannot coexist; a reconciliation with claims cannot be reopened.
- `partner_statement_reconciliation_events`: `close` shape (run + fingerprints + `reviewer_id` + `claims_count`, `created_by ≠ reviewer_id`); insert guard: the reviewer must be the reconciliation's recorded reviewer **and** the actor of the latest `mark_reviewed` event, and `claims_count` must equal the recorded claims; other actions must not carry those columns.
- Every nullable column in a CHECK/trigger is paired with an explicit `IS NOT NULL`. `down()` refuses if any claim, close event or `closed` row exists, then restores the A3c guard bodies; verified up → down → up on both engines.
- **What the database cannot verify** (and the service does, under the anchor lock): ledger-fingerprint freshness, the statement digest, that every line has a decision, and the overlap acknowledgement. A privileged raw-SQL actor could still hand-craft a *consistent* close (matching event + claims) — they cannot create a double claim, a self-close, a claim-less/count-mismatched close, or alter a closed row.

## 4. Tests

| Suite | Result |
|---|---|
| `PartnerStatementCloseApiTest` (new, 25) | SQLite ✔ · PostgreSQL ✔ |
| `PartnerStatementCloseConcurrencyPostgresTest` (new, 7, `pcntl_fork`) | PostgreSQL ✔ (skipped on SQLite by design; absence of pcntl on PG = failure) |
| `PartnerStatementLifecycleApiTest` (updated: close now needs review, SoD, `not_reviewed` state; wall allows the 3rd update) | SQLite ✔ · PostgreSQL ✔ |
| Related set on SQLite after Revision 2 (Rbac · BranchIsolationGuard · ApplicationCatalog · all PartnerStatement* · PartnerLedger*) | 225 passed, 23 skipped (PostgreSQL-only), 1 failed → **fixed** (see below) and re-run green (`PartnerStatementPairReviewApiTest` 12 ✔) |
| Same family on PostgreSQL after Revision 2 (incl. all earlier race suites) | **249 passed (4232 assertions)**; the pair-review suite re-run after the test fix: 12 ✔ |
| Full `php artisan test` | not run locally; CI runs it on SQLite and PostgreSQL (see PR #1941) |

**Regression found and fixed in Revision 2:** the new claims trigger (SQLite) reads the decisions' pair columns, so the **A3b** migration test (`…rolls_back_and_forward_cleanly_when_no_pair_link_exists`) could no longer drop those columns in isolation. Real rollbacks run in reverse order (A3d first), so the test now rolls A3d back before A3b and re-applies it after — no production behaviour changed.

Revision 2 additions: an entry in September's period but absent from its statement is **not claimed**, appears as `unclaimed_in_period` (event + status) and is then **claimed by October** without conflict · `dismiss` creates no claim and similarity of amount/date claims nothing · identity-proof matrix (missing/inactive/empty unit, malformed or unproven `link_pair`, double use) refuses with `claim_identity_unproven` · raw SQL cannot claim for a dismissed/cleared line or the unchosen pair member · a failure after the claims are written (temporary DB trigger on the close event) rolls **everything** back with no residue · PG race: a final that leaves an entry unclaimed never blocks a concurrent final that uses it.

Coverage highlights: atomic success with claims/event/status and **no financial effect** (row counts of journal/accounts/invoices/payments/stock unchanged) · replay safety · permissions matrix (view-only, reconcile-only, close-without-view, no `partners.view`, viewer, reviewer holding close) · stale ledger / wrong run / changed statement / draft · real conflict across different periods with ids + sample and **no trace** · overlap without shared movement (required / stale-narrow / stale-wide / exact / stale-when-none) · adjacent periods + tolerance window (no conflict) and the counter-case (used outside-period entry conflicts) · `link_pair` member split and same-member conflict (no automatic reversal entry created) · branch finals coexist, organisation/identical-tuple refusal, several-branch restriction · tenant isolation, gate, strict input · raw-SQL attempts (self-close, missing reviewer, wrong count, wrong reviewer/run, closing without/with defective event, claims on closed rows, immutability, identical-period cross-scope and same-scope) with positive controls · migration refusal/reversibility · static wall (no financial writer referenced; writes only events/claims).

**Real races on PostgreSQL:** 5 racing closes of one reconciliation by different closers → exactly one close event, the rest replay · two overlapping finals sharing a movement → exactly one wins, the loser gets a clean `unit_conflict` (no database error), no entry with two claims · disjoint finals close concurrently (no false blocking) · close vs reopen → one consistent final state · in-flight posting vs close (§0) · the anchor lock blocks `LedgerService`.

**Mutation controls (each must fail ≥ 1 test):**

| Mutant | Result |
|---|---|
| remove the tenant anchor lock | caught (PG in-flight-posting race) |
| remove only the partner/role advisory lock | **survives by design** — the tenant anchor already serialises every close; the partner lock is defence in depth. Removing **both** → caught (two-finals race + posting race) |
| skip the claims pre-check | caught (4 tests) |
| skip acknowledgement equality / the acknowledgement requirement | caught / caught |
| **(Revision 2)** claim every in-period entry again (old policy) | caught (5 tests) |
| **(Revision 2)** `dismiss` claims entries | caught (3) |
| **(Revision 2)** drop the unit identity/state checks | caught (identity-proof test) |
| **(Revision 2)** drop the database decision guard on claims (SQLite trigger) | caught (2) |
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
3. ~~Every in-period entry is claimed~~ — **resolved by Revision 2**: only decision-used entries are claimed; unclaimed in-period entries are surfaced as exceptions. Residual: an entry missing from a closed statement is not protected from being claimed by a later final (by design).
4. **No release path** until PS-A3e: a mistaken close cannot be undone (terminal). That is why A3e (void/replace + claim release, with the PG race matrix) should follow before any UI exposes `close` (PS-A4).
5. The overlap acknowledgement and run freshness are service-level guarantees under the anchor lock (§3 last bullet), not database-level.
6. **Not run locally:** the entire repository suite (see the table) — CI runs it on both engines.

## 6. Delivery

Branch `claude/imp-ps-a3d` · PR #1941 · Base `2c0a4148be7402d56fe67daba7e93fa3d6d5c3d8` (main after #1939) · first Head `da984b6ec86899d44e9d918d971da7543cc43a28` · CI and Codex: pending at the time of writing — see the PR. Status: **READY_TO_MERGE after green CI and Codex review** (no merge, deploy or Railway change made).
