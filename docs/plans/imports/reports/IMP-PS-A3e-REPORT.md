# IMP-PS-A3e — Safe void and replacement of closed reconciliations, claim release

**Scope (owner, 2026-11-03):** PS-A3e only. **Not built:** PS-A4 (UI / bulk approval, D-PS-18), Track B (historical posting), any change to `LedgerService`, the ledger database, Railway or deployment. **No journal entry, document, payment, balance, stock, tax or ZATCA row is created or changed by anything in this slice** (proved by row-count tests on both the void and the replacement path).

Base: `origin/main` `607795dac5d1be9af0454e4d666c97854e8c6234` (PS-A3d merged, #1941). Owner decisions applied: **D-PS-14** (overlap warning + exact acknowledgement; real conflicts only through shared movements) · **D-PS-15** (no automatic R-REV) · **D-PS-16** · **D-PS-17** (closer ≠ reviewer, also for the replacement) · **D-PS-18** (bulk deferred). **Revision 2 (2026-11-03): the owner approved D-PS-19 and D-PS-20 — a per-tenant configurable separation of duties, `strict` by default — implemented and documented in §1.6 / §5.**

## 1. What was built

| Piece | Where | Role |
|---|---|---|
| Migration | `2027_01_03_010000_add_partner_statement_void_and_supersede.php` | columns `voided_at/voided_by/void_reason/superseded_by_id` (+ event `related_reconciliation_id`), the two new terminal statuses, DB guards on PostgreSQL and SQLite, claim release trigger, deferred replacement constraint (PostgreSQL) |
| Retirement | `PartnerStatementRetirementService::retire()` | the single writer of a retirement: one event (`void` or `supersede`) + the status change; claims are released **by the database** |
| Lifecycle | `PartnerStatementLifecycleService::void()` / `replace()` (+ `performClose` with a replace list) | the contract, locking, validation, replay |
| API | `POST partner-statement-reconciliations/{id}/void`, `POST …/{id}/replace` | `partner_statements.void` (void) · `partner_statements.close` on the route + `void` in the service (replace) |
| RBAC | `Rbac::PERMISSIONS` `partner_statements.void` | **not** in `MATRIX`, not granted to any stored role; `owner`/`admin` via `*` only |
| Status | `GET …/status` | `reconciliation.voided_at/by/void_reason/superseded_by_id`, `void` block (availability + reason), `final.active_claims_count` |
| Events | `GET …/events` | `related_reconciliation_id` added |

### 1.1 State machine (explicit, terminal)

`closed → voided` (plain void) and `closed → superseded` (void by replacement, `superseded_by_id` = the replacement). Both are terminal: no reopen, review, close, decision or second retirement (service **and** database). `reviewed_*`, `closed_*`, the decisions, the claims and the events of the original are all kept — the original reconciliation stays fully auditable after retirement. A retired row records **reason (3..500 chars, mandatory), actor and time**.

### 1.2 Claim release — done by the database, not by application code

An `AFTER UPDATE` trigger on the reconciliation sets `released_at = voided_at` on the row's active claims **in the same statement** as `closed → voided/superseded`. The claims update guard allows exactly that one change (`released_at NULL → voided_at` of a retired reconciliation, every other column identical); un-releasing, editing the time, deleting a claim, or inserting an already-released claim are all rejected. Consequences:
- raw SQL cannot retire a final and leave its claims active, nor release claims without retiring;
- **a released claim can be claimed again only because its owner is already retired** — the partial unique index `(tenant, partner, role, entry) WHERE released_at IS NULL` is unchanged, so double-claiming stays impossible before the release and after the re-claim;
- the claim history (including released rows) is never deleted.

### 1.3 Replacement contract (`replace`)

`POST …/{newId}/replace {run_id, replaces[1..20], reason, acknowledge_overlap?, note?}` — in **one transaction**:
1. same locks and checks as `close` (per-reconciliation advisory lock → partner/role advisory lock → row lock → **tenant anchor** → fresh run/fingerprint/digest → blockers);
2. each listed final (locked in id order) must be `closed`, same partner and role, with its close run readable by the actor → `supersede` event (linking the replacement via `related_reconciliation_id`) + status change + claim release;
3. **only then** the identical-final / `unit_conflict` / overlap-acknowledgement checks run (on what remains), then the normal close of `newId` (claims, `close` event listing `supersedes`).
Any failure at any step rolls back everything: no original is left retired while the replacement is not closed. On PostgreSQL a **deferred constraint trigger** additionally refuses the commit of a `superseded` row whose replacement is not `closed` (also against raw SQL). Replay (same request) → 200 `replayed`, no new event; a different replace set or a plain close of the closed replacement → 409.

Reviewer ≠ closer applies to the replacement unchanged (the closer is the actor of `replace`). D-PS-14 (acknowledgement of overlapping finals, exact list) and D-PS-15 (no automatic reversal pairing) are untouched: the replacement claims only what its own decisions used.

### 1.4 Locks and races

- **void:** advisory lock of the reconciliation → partner/role advisory lock → row lock. It does **not** read the ledger, so it takes no tenant anchor.
- **replace:** the close path, i.e. additionally the **tenant anchor** (the same `FOR UPDATE` row lock `LedgerService` takes), before the ledger read — so it cannot miss an in-flight posting (proved below).
- Deadlock retry (`DB::transaction($cb, 3)`) as in A3d. Note (measured): a `void` can queue behind a transaction that holds the anchor, because inserting its event takes `FOR KEY SHARE` on the tenant row through the `tenant_id` foreign key like any write in the system; it never reads stale ledger data and there is no lock-order cycle (verified, no deadlock).

### 1.5 Permissions and scope

- `partner_statements.void` (new, independent). **No automatic grant**: absent from `MATRIX` and from every system role (test iterates all roles); `owner`/`admin` get it only via `*` as for every permission. Requires `.view` and the application gate `accounting.partner_statements` (suspended = read-only ⇒ void/replace are POST ⇒ refused).
- `replace` requires `close` **and** `void` (route: `close`; service: `void`).
- Separation of duties for retirement is **per tenant** (D-PS-20, §1.6): `strict` by default.
- Partner scope (`partners.view`) and tenant isolation are the same uniform refusal (`PARTNER_UNAVAILABLE`, 422) as in A3d; the target's **close run must be readable** — a branch-restricted user cannot void or replace an organisation-wide final (uniform refusal, no leak; `void.blocked_reason = close_scope_not_readable`).

### 1.6 Revision 2 — configurable separation of duties (D-PS-20) and the replace contract (D-PS-19)

**Existing mechanism reused — no parallel settings system.** The policy is one key in the existing tenant-settings store: `Settings::DEFAULTS['partner_statements']['void_separation'] = 'strict'` (`tenants.settings` JSON, read with `Settings::group/get`), wrapped by `App\Support\PartnerStatementVoidSeparation` (`effective()`, `blocks()`), the same shape as `CashSaleTreasuryPolicy`/`CommercePartnerPolicy`. No table, no migration of data, no new route.

| Policy | Behaviour |
|---|---|
| `strict` (**default**, including every existing tenant that never set it; also the result of any missing / unknown / malformed stored value — `'FLEXIBLE'`, `''`, `1`, `true`, `[…]` are all strict) | the actor who **closed** a reconciliation cannot void it **nor supersede it** (direct void: the target; replacement: **every original** in `replaces`) → 403 `void_separation_required`, full rollback |
| `flexible` | the closer may, **only if** they hold `partner_statements.void` (no automatic grant; a closer without it stays refused) |

- **Recorded:** the effective policy at operation time is written to the event summary (`summary.void_separation` on `void` and on each `supersede`, and on the replacement's `close` event when it supersedes); `GET …/status` exposes `void.separation_policy` and `void.blocked_reason = separation_required`.
- **Enforced in the database (both engines), no conflict with the configurable policy:** the event-insert guard reads the **same** `tenants.settings` row of the event's tenant (strict unless exactly `flexible`), requires `summary.void_separation` to **equal** it (`partner_statement_policy_mismatch`) and, under strict, rejects an actor equal to the reconciliation's `closed_by` (`partner_statement_void_separation`). Raw SQL therefore can neither retire a final as its closer under strict nor record a policy other than the effective one; another tenant's setting never affects this tenant (the trigger reads the event's own tenant).
- **Race (documented, fail closed):** if the setting is changed between the service's read and the trigger's read, the database refuses the event (nothing written) and the service answers 409 `void_policy_changed` (retry). PostgreSQL race test: a policy change racing the closer's void never records a wrong policy (outcome is either 403/409 with the final intact, or success with `flexible` recorded).
- **No user-reachable write path (owner condition):** there is no controller, route or request that writes this key (static test over `app/Http` and `routes`, and over every `Settings::put('partner_statements', …)` call site). The settings UI and a safe, authorised change channel are **deferred to PS-A4**; until then `flexible` can only be set by privileged data access, i.e. it is not open to users.
- **Decision D-PS-19 as implemented:** explicit replacement without conflict allowed; default cap **20** (`MAX_REPLACES`, enforced in the request validation); reason mandatory; atomic (single transaction + PostgreSQL deferred constraint).
- **Scope check:** one settings key + one policy class + one DB guard extension; no change to the settings architecture and no conflict between a mutable policy and the database guard (the guard reads the policy source itself), so no design-options stop was needed.

## 2. Database guards (PostgreSQL and SQLite)

Reconciliation update guard: `closed` changes only to `voided`/`superseded`; the transition needs a **matching latest event** (action, `created_by = voided_by`, `reason = void_reason`, run = `reviewed_run_id`, `related_reconciliation_id = superseded_by_id`, `claims_count` = the active claims); review/close fields are frozen on retirement; retired rows are immutable; no insert of `closed/voided/superseded`. Event insert guard: `void` needs a `closed` reconciliation and its close run; `supersede` also needs a different `reviewed` replacement of the same partner/role; counts must match. The A3d guards are preserved verbatim (the migration's `down()` restores them by calling the A3d generator, and refuses once any retired row, void/supersede event or released claim exists).

## 3. Tests

**Results (local, this branch before the PR):**
- Related filter `Rbac|BranchIsolationGuard|ApplicationCatalog|PartnerStatement|PartnerLedger`: **SQLite 213+14 → all green; PostgreSQL 275 passed (4679 assertions), 0 failed** (the A3e API suite 14/14 on both engines; the PostgreSQL race suite 8/8 with real `pcntl_fork`).
- **Full `php artisan test` on SQLite:** 10722 passed, 371 skipped (PostgreSQL-only), **52 failed — none related to this slice:** 51 are `Fuel*` tests that call `bcmul/bcadd` (the local PHP lacks `ext-bcmath`; CI installs it), and 1 is `InventoryOpeningZeroValueDateGuardTest` (2 tests) which **fails identically with the A3e migration removed**, i.e. pre-existing in this environment (locked-period/date state), outside the partner-statement area. CI is the authority for these.

### 3.1 Suites added/changed
- `PartnerStatementVoidSupersedeApiTest` (new, 14 tests): void (reason/actor/time, claim release with history kept, no financial effect, replay/different reason/mandatory reason, terminal state), claim reuse only after the void (double-claim guard before it), replacement (linked audit, atomic rollback on actor = reviewer and on a post-supersede `unit_conflict`, contract validation, replay, D-PS-14 after supersede), permissions (matrix, no default grant, `close` alone / `void` alone insufficient, no `view`, no partner scope, other tenant, branch-restricted), raw-SQL guards (with a positive control), insert-as-voided/superseded, migration refusal/reversibility, static wall (retirement path never touches the ledger/ZATCA/claims by hand; void takes no anchor; supersede precedes the conflict/overlap checks).
- `PartnerStatementVoidSupersedeConcurrencyPostgresTest` (new, 8 tests, real `pcntl_fork`): racing voids (same / different reason), void × replace (3 timings), two competing replacements, void × close of a non-replacing candidate (3 timings), replace × in-flight ledger posting (`run_stale` + full rollback), void alongside an anchor-holding transaction (no deadlock), the deferred constraint at commit. Every race ends with the invariant check *no entry has two active claims; no retired final has an active claim; every active claim belongs to a `closed` final*.
- Updated (migration order only): `PartnerStatementCloseApiTest` ×2 and `PartnerStatementPairReviewApiTest` ×1 now roll the A3e migration back first / forward last.

### 3.2 Mutation controls (each reverted afterwards; the suite must fail)
Application-level (SQLite API suite): drop the `void` permission check in `replace` · skip the close-run readability check in `void` · move the supersede step after the conflict/overlap checks (6 tests fail) · skip the target-is-closed check · skip the same-partner/role check · accept a void replay with any reason · make the reason optional — **7/7 caught**. Database-level: release trigger off (SQLite **and** PostgreSQL: 7 failures each) · deferred replacement constraint off (PostgreSQL race suite) · claim update guard opened (SQLite and PostgreSQL) · retirement event actor/reason unchecked (PostgreSQL) — **6/6 caught**. The last one first **escaped** (the actor/reason match in the transition guard was only covered indirectly); a raw-SQL case with a mismatched actor and a mismatched reason was added and the mutation is now caught. The PostgreSQL race suite's mutation (void takes no locks) was not run as a separate control; the lock order is covered by the racing-void and void×replace tests and the static wall test.

## 4. Backward compatibility
Additive columns only; A3c/A3d behaviour and responses unchanged (the full A3d/A3c/A3b/A3a suites pass untouched except the three migration-order lines above); no data migration, no backfill; no existing permission, route or role changed; plain `close` is `performClose` with an empty replace list. `final.claims_count` still counts all claims (history) — `active_claims_count` is new.

## 5. Risks and open decisions
- **D-PS-19 / D-PS-20 approved (owner, 2026-11-03)** and implemented (§1.6). Residual: `flexible` has **no safe user-facing way to be set until PS-A4** (intended; privileged data access only). Under `flexible` a closer who also holds `void` can retire their own final — every retirement is audited with actor, reason, time and the effective policy.
- Policy-change race (setting flipped between the service read and the DB check) refuses the operation fail-closed with a retryable 409; it never records a wrong policy.
- No automatic grant of `partner_statements.void` to any stored role: tenants that want a non-owner voider must add it to a role explicitly.
- A retired (voided/superseded) final no longer blocks a new final of the same scope/period (the unique index is `WHERE status = 'closed'`); the history stays in the retired row and its events.
- Retirement does **not** reverse anything financial (nothing financial was ever created by a reconciliation); it only frees movements for re-reconciliation.
- Fuel flake (CI only, 21:00–24:00 UTC) is pre-existing and unrelated.

## 6. Branch / PR / SHAs
**Branch** `claude/imp-ps-a3e` · **PR** #1960 · **Base SHA** `607795dac5d1be9af0454e4d666c97854e8c6234` · **Head SHA** *(see PR; updated at each push)*
