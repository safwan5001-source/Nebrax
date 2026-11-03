# IMP-PS-A4a0 — Implementation Report (partner-statement read APIs N1–N4)

**Status:** implemented, PR open, **not merged, not deployed.** PS-A4a, A4b/A4b0, A4c–e, Track B and POLICY-0 were not started.
**Source of truth:** `docs/plans/imports/AWJ_IMP_PS_A4_UI_EXECUTION_PLAN.md` §§2, 7, 8, 9, 10 (PR #1964).

| | |
|---|---|
| Branch | `claude/ps-a4a0-read-api-N1-N4` |
| PR | #1970 — https://github.com/safwan5001-source/Nebrax/pull/1970 |
| Base SHA | `cd3efba65f4a983c2986a067dfe29b924c962c8e` (`main`, = PR #1964 squash) |
| Head SHA (code commit) | `bd1f0c91d7d6d05c83b9b6e44380b9d4df09ec46` |
| Head SHA (after this report) | stated in the PR/hand-off message (a file cannot contain its own commit SHA) |

## 1. What changed

Read-only, additive backend. No migration, permission, policy/Settings, write API, ledger, inventory or ZATCA change.

| ID | Endpoint | Result |
|---|---|---|
| N1 | `GET partner-statement-reconciliations` | New. Filters `status[]`, `partner_id`, `role`, `period_from/to` (overlap window), `branch_id`, `q`; `sort` whitelist (`created_at, period_from, period_to, status, line_count, original_filename, partner_name`, `-` = desc, id tiebreak); `per_page` 1–50 (default 25). |
| N2 | `GET partner-statement-reconciliations/{id}` | New. List row + frozen `policy`, `checks`, `source_import_job_id`, reviewer/closer/voider metadata. No file hashes / tenant id. |
| N3 | `GET …/{id}/matches` | Existing; statement rows gain **additive** `line` and effective `decision`; ledger rows get `line: null, decision: null`. All 14 legacy keys unchanged and asserted by name/order. |
| N4 | `GET …/{id}/lines` | New. Lines by `ordinal` then `id`, paginated ≤50, works before any match run. |

### Files
| File | Kind |
|---|---|
| `app/Services/PartnerStatementReconciliationQuery.php` | new (369 lines) |
| `app/Http/Controllers/Api/PartnerStatementReconciliationController.php` | new (79) |
| `app/Http/Controllers/Api/PartnerStatementMatchController.php` | +8/−2: injects the query service, decorates rows |
| `routes/api.php` | +3 GET routes (+1 import), same `$perm('partner_statements.view')` + `$app('accounting.partner_statements')` middleware as siblings |
| `tests/Feature/PartnerStatementReadApiTest.php` | new (18 tests, 390 assertions) |
| `tests/Feature/PartnerStatementMatchApiTest.php`, `…PairReviewApiTest.php` | refined, see §4 |

## 2. Access model (how leaks are prevented)

* The header rule is unchanged: `PartnerStatementMatchService::authorize` → `PartnerStatementImportService::assertAccess`.
* The list reproduces that rule **in SQL** (no per-row calls): (a) partner exists in tenant, not soft-deleted, type fits role (`customer ⇒ customer|both`, otherwise `supplier|both`); (b) `policy.branch_id` is null **or** is in the set of existing branches the actor may access (one small query over branches, bound as a list); (c) tenant isolation via `BaseModel`. Actor-level invariants (`view`, active user, `partners.view`, SAR tenant) are checked once with the same outcomes (403 / 422 `PARTNER_UNAVAILABLE` / SAR message).
* Counts, `last_page`, `q`, filters and sorting all run on the already-filtered query (search is `AND`-ed; partner-name sort uses a tenant-bound subselect). Search escapes LIKE wildcards.
* Drift guard: an **oracle test** compares the list against `GET {id}` for 32 row variants (4 partners incl. soft-deleted × 2 roles × null/inside/outside/non-existent branch) for the owner and two branch-restricted users.
* N3 decisions: effective = highest revision not `clear`, shown only when its run is readable by the actor (same rule as `GET …/decisions`). Test proves a branch-restricted user does not see decisions made on an organisation-scope run.

## 3. Tests and results

### Local (sandbox: PHP 8.3.6, PostgreSQL 16, **no `bcmath`**)
| Run | Result |
|---|---|
| `PartnerStatementReadApiTest` | SQLite 18/18, PostgreSQL 18/18 (390 assertions) |
| All `PartnerStatement*` suites (A1–A3e incl. `pcntl_fork` concurrency on PG) | SQLite green (after §4 refinements); PostgreSQL 230 passed + the 2 refined tests re-verified green (44/44 on the three affected classes) |
| Mutation controls (against the read test) | removing the branch filter → 2 fail; removing partner-existence → 2 fail; ignoring decision readability → 1 fail; OR-ing the search → 3 fail |
| Full backend suite, SQLite (4 shards, 11,206 Feature + 1 Unit) | 92 non-passing entries: **50 Fuel** (`bcmath` missing here; identical 50 failures on `main`) + **42 sharding interference** (shared storage between parallel processes) → all 239 re-run serially: pass |
| Full backend suite, PostgreSQL (4 shards, one DB each) | **0 `PartnerStatement*` failures.** 84 entries: 50 Fuel (same cause) + 30 interference (re-run serially: pass) + 4 environmental, **identical on `main`**: 3× `PostgresTestLockTimeoutTest` (needs CI's `PGOPTIONS=-c lock_timeout=60s`) and 1× `StorefrontMediaApiTest` (same `escape '\'` PDO issue, see §5) |

Query-count evidence: list = constant across 3 vs 30 rows (owner) and 1 vs 50 rows (restricted); `matches` context = constant 2 vs 4 decided rows.
No-write evidence: financial table counts and `partner_statement_*` counts/rows are unchanged around every read; static test forbids `LedgerService`, journal, inventory, ZATCA, `create/insert/update/save/delete/transaction/lockForUpdate` in the new files and in `MatchController`; the new routes are exactly three GETs.

### CI (PR #1970)
* `php artisan test (L11, pgsql)` — **success** (22:18Z), `PostgreSQL feed-lock performance` — success.
* `php artisan test (L11, sqlite)` / `CI Gate` — see PR (recorded below when finished).

## 4. ⚠ Decision for the owner — two existing tests refined
N3's fields are additive, but two existing tests assert whole-payload invariants of `/matches`:
1. `PartnerStatementPairReviewApiTest`: `assertEquals($beforeRows, $afterRows)` — rows now legitimately differ in `decision`. Now compares every existing field identically (only `decision` excluded) and asserts the new `decision` explicitly.
2. `PartnerStatementMatchApiTest` (branch isolation): substring check of a foreign-branch document number over the whole body. The new `line` block echoes the uploaded statement text (`our_reference`), which the user can already read via N4. The check now covers everything except `line`, plus `run`; strength for ledger data is unchanged.

The plan says "A1–A3e green without modification". These two edits are the minimal deviation and are flagged here for review. **Alternative:** make `line`/`decision` opt-in (`?include=`); then zero existing tests change, at the cost of one extra query parameter not in the plan. Say the word and I'll switch.

## 5. Findings and risks

| # | Item | Severity | Note |
|---|---|---|---|
| F1 | Existing siblings (`status`, `matches`, …) answer *"branch outside your scope"* with a **distinct** message (`هذا الفرع خارج نطاق صلاحياتك.`) vs `PARTNER_UNAVAILABLE` for unknown IDs → a restricted user can tell an out-of-scope reconciliation exists. | Low (existing) | N2/N4 unify it on the new endpoints. Siblings untouched (contract change would need your decision). |
| F2 | Non-UUID `{id}` ⇒ router 404 (`Route::pattern('id')`), like all sibling routes — not 422. Unknown/foreign UUID ⇒ uniform 422. | Info | Consistent with existing behaviour. |
| F3 | `LIKE … escape '\'` is mis-parsed by PDO-pgsql in this sandbox (HY093 "parameter not defined"). My first draft hit it (caught by PG run); N1 uses `escape '!'`. `main`'s `StorefrontMediaApiTest` fails locally on the same cause. | Medium (out of scope) | Worth checking whether CI-`main` differs by PHP/PDO version; not touched here. |
| F4 | Performance: visibility uses a correlated `EXISTS` on `partners` and JSON-path predicates on `policy`; no index helps the JSON predicate. Fine for per-tenant volumes (hundreds), would need a generated column/index only if a tenant reaches tens of thousands. | Low | Branch list is one tiny extra query. |
| F5 | `status` must be sent as `status[]=…` (array); scalar ⇒ 422, mirroring `outcome[]` in `matches`. | Info | |
| F6 | List/`matches` response shapes are new contracts; the web client (A4a) must treat `line`/`decision` as nullable. | Info | |
| F7 | Local env lacks `bcmath`, so Fuel tests cannot pass here (identical on `main`); parallel sharding caused spurious storage interference, resolved by serial re-runs. | Info | CI is authoritative. |

## 6. Financial entries
None. This slice creates no journal entries, documents, payments, balances, inventory movements or ZATCA artefacts.

## 7. Remaining / next
* Owner review of §4 (keep always-on vs opt-in) and merge approval — **not** self-merged.
* Next recommended slice: **PS-A4a** (list + import UI) on top of N1/N2/N4, then A4b after the mandatory visual research (D-A4-09). A4b0 still awaits D-A4-04d and the PostgreSQL lock-duration threshold.
