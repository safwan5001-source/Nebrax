# FISCAL-2 — Fiscal Year Close — Implementation Report

**Status:** DONE (PR open, not merged)
**Task doc:** `docs/plans/accounting/FISCAL-1-fiscal-period-close-design.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Dependency:** ACC-1 · ACC-2 · ACC-3 · ACC-RET-1 · ACC-4 · ACC-5 · ACC-6 (all merged)

## 1. Executive summary

A fiscal year is now a first-class `CompanyWide` entity that can be **closed** — zeroing every non-zero
revenue and expense account into the semantic role `retained_earnings` (default 3120) with a single
balanced journal dated at the year end — and later **reopened** by reversing that exact journal, and
**re-closed** as a new, independently computed generation.

Three things carry the accounting weight:

1. **The close changes nothing but P&L accounts and Retained Earnings.** Assets, liabilities, equity and
   VAT accounts are untouched by construction (only `Account.type` in `revenue`/`expense` is closed), no
   balance-sheet carry-forward journal is generated, and 3130 Opening Balances is never used.
2. **Reporting stays truthful on both sides.** The historical Income Statement *excludes* close journals
   so a closed year keeps showing its real revenue and expense; the Balance Sheet *includes* them so
   Retained Earnings shows the transfer — and its synthetic net income is computed from the full ledger,
   which makes it self-zero at a closed year end and cover only unclosed activity afterwards. No double
   count, by construction rather than by heuristic.
3. **No accounting-lock bypass was introduced anywhere.** `LedgerService` is byte-for-byte unchanged.
   The close journal goes through `post()` like any other journal and is guarded by `AccountingDateGuard`
   like any other journal. An active ACC-6 period lock covering the year end is a readiness **BLOCKER**
   with an explicit message, not a special case.

## 2. Base SHA

`643b7d9d1e5638aea92f38c59fbf7555c8bd8948` — the ACC-6 merge commit, verified as `origin/main`'s head
before branching. This is the exact SHA the task named.

## 3. Mandatory Gate findings

Run on `643b7d9` before writing any code. **No blocker found.**

| # | Check | Finding |
|---|---|---|
| 1 | `LedgerService::post()` is the only posting path | ✅ Zero `JournalEntry::create` / `JournalLine::create` / `new JournalEntry` outside `LedgerService`. The only other hit is `ManualJournalLine::create`, which writes the **draft** table. ACC-6's structural test (`no_code_outside_the_ledger_writes_journal_rows_directly`) already enforces this permanently. |
| 2 | `LedgerService::reverse()` is the approved reversal path | ✅ Only two callers, both thin wrappers (`SupplierRefundService`, `ManualJournalService`). |
| 3 | ACC-6 present and enforcing | ✅ `AccountingDateGuard::assertOpen()` is called inside `post()` (line 59) and `reverse()` (line 120). |
| 4 | Account Routing extensible with `retained_earnings` | ✅ `AccountingRoles::ROLES` is a static catalog and `AccountRoleMappingSeeder` iterates `AccountingRoles::keys()`, so a new role is picked up automatically. The file's own docblock reserved `retained_earnings` **for FISCAL-2 by name**. |
| 5 | Legacy default 3120 | ✅ `ChartOfAccountsSeeder`: `['3120', 'الأرباح المرحّلة', 'Retained Earnings', 'equity', false]` — equity, non-group. |
| 6 | 3130 is Opening Balances, not Retained Earnings | ✅ `['3130', 'الأرصدة الافتتاحية', 'Opening Balances', 'equity', false]`, a separate account. Never used by the close. |
| 7 | No conflicting fiscal-close implementation | ✅ Zero matches for `FiscalYear` / `fiscal_year` / `FiscalClose` anywhere in `app/`, `database/migrations/`, `routes/`, `tests/`. |
| 8 | How reports compute | ✅ All read posted+reversed `journal_lines` directly. `trialBalance`/`balanceSheet` via `movementsByAccount()`; `incomeStatement` likewise; `accountLedger` via `postedLines()`; `costCenterProfitability` via a `whereNotNull('cost_center_id')` aggregate. **`balanceSheet()` derived its net income by calling `incomeStatement()`** — the one coupling that had to be broken (see §7). |

Two implementation-baseline facts FISCAL-1 asked to verify before coding:

- **Effective timezone:** `APP_TIMEZONE=UTC`; `config('app.timezone') === 'UTC'`. `Settings::operating_timezone`
  (`Asia/Riyadh`) is a display setting the ledger has never consulted, and FISCAL-2 does not start
  consulting it. No new timezone semantics.
- **Concurrency anchor:** the tenant row, already established by ACC-6 and already locked by
  `GeneratesDocumentNumbers` on every journal insert (see §12).

## 4. Accounting semantics implemented

For a fiscal year with start/end `S`/`E`:

1. Aggregate every `journal_lines` row on entries with status `posted`/`reversed` and `entry_date`
   between `S` and `E` inclusive — **from ledger truth, never from document totals** — excluding fiscal
   close journals and their reversals (§6).
2. Keep only accounts of type `revenue`/`expense` whose net movement is non-zero. **Zero-balance accounts
   get no line.**
3. Zero each one: an account with net (debit − credit) `N` gets `credit = N` if `N > 0`, else `debit = −N`.
4. The net result goes to `retained_earnings`: profit → credit, loss → debit. **When net income is exactly
   zero the Retained Earnings line is omitted entirely** — a zero line is noise, not a journal entry.
5. The whole thing is posted through `LedgerService::post()` dated `E`, with `branch_id => null`
   explicitly, no partner and no cost center.

Worked example (revenue 1,000.00, expense 400.00):

| Account | Debit | Credit |
|---|---:|---:|
| 4110 Sales Revenue | 100,000 | |
| 5120 Salaries | | 40,000 |
| 3120 Retained Earnings | | 60,000 |
| **Σ** | **100,000** | **100,000** |

A loss simply flips the 3120 line to the debit column. **No Income Summary account exists in V1.**

**Never closed:** assets, liabilities, equity. **No annual carry-forward journal** for permanent accounts —
they stay cumulative. **VAT is untouched**: 1150/2120 are asset/liability accounts, so they fall outside
the close by type, not by a special-case exclusion.

## 5. Schema / models / services

One migration, `2026_09_10_010000_create_fiscal_year_tables.php`, plus one idempotent backfill. No
existing table, column or index was altered.

| Table | Purpose |
|---|---|
| `fiscal_years` | `CompanyWide`. `name`, inclusive `start_date`/`end_date`, `status` (`open`/`closing`/`closed`/`reopening`), `created_by`. Indexed on `(tenant_id, status)` and `(tenant_id, start_date, end_date)`. **No `branch_id`** — the close is company-wide in V1. **No monthly period rows.** |
| `fiscal_year_closes` | One row per **close generation**. `generation`, `status` (`active`/`reversed`), `journal_entry_id` (nullable — zero-activity), `reversal_entry_id`, snapshots of `total_revenue`/`total_expense`/`net_income` and the concrete `retained_earnings_account_id`, plus `closed_by`/`closed_at`/`reopened_by`/`reopened_at`/`reopen_reason`. Unique on `(fiscal_year_id, generation)`. |
| `fiscal_year_events` | Immutable audit (`year_created`/`year_updated`/`year_closed`/`year_reopened`) with actor, generation, journal id, reason and a JSON details snapshot. Throws `LogicException` on update/delete. |

| Class | Role |
|---|---|
| `App\Models\FiscalYear` / `FiscalYearClose` / `FiscalYearEvent` | `CompanyWide` domain models |
| `App\Support\FiscalCloseJournals` | The **structural** close-journal predicate shared by the close computation and the reports (§6) |
| `App\Services\Accounting\FiscalYearService` | Create / update / list / audit. Overlap prevention and lifecycle guards |
| `App\Services\Accounting\FiscalCloseService` | Readiness, close, reopen. The only place that posts a close journal |
| `App\Http\Controllers\Api\FiscalYearController` + 3 form requests | REST surface |

`FiscalYear` lifecycle is `OPEN → CLOSING → CLOSED → REOPENING → OPEN`. `CLOSING`/`REOPENING` are set and
cleared inside the same transaction; a row stuck in either (a crashed process) **blocks** a second
close/reopen rather than passing silently.

**A closed year's boundaries cannot be moved.** Once a year has any close generation — even a reversed
one — its `start_date`/`end_date` are frozen, because a posted journal was computed against exactly those
boundaries. Only the name stays editable.

## 6. Fiscal close journal identity — structural, never textual

The close journal carries `source_type = FiscalYearClose::class` and `source_id = <generation id>`, so it
is identified by a **model relationship**, exactly as FISCAL-1 requires and never by description text,
journal number or account code.

`App\Support\FiscalCloseJournals::exclude()` / `::only()` express the predicate once, and it deliberately
covers **the reversal too**: `LedgerService::reverse()` links the reversal to the original through
`reversal_of` without giving it its own `source_type`. Had only the original been excluded from the
Income Statement, a reopened year would have shown the reversal's P&L lines and flipped its own sign.
The reversal is matched with a tenant-scoped `whereNotExists` self-join on `reversal_of`.

From a generation row you can read which fiscal year produced the journal, which generation it belongs
to, and whether it is still `active` or was `reversed` by a reopen.

## 7. Reporting changes

| Report | Treatment | Why |
|---|---|---|
| **Income Statement** | **Excludes** close journals and their reversals | A closed year must keep showing its real revenue and expense. Including them would render every closed year as 0/0. |
| **Balance Sheet** | **Includes** close journals | The transfer to Retained Earnings is real equity movement and must be visible. |
| **Trial Balance** | Includes | The close is a genuine posted journal. |
| **General Ledger** | Includes | Same. |
| **Cost-center P&L** | Excludes (explicitly) | It is an Income Statement by another cut. Close lines carry no cost center in V1 so none would reach it anyway; the explicit exclusion keeps that true if the dimension policy ever changes. |
| **Branch P&L** | Unaffected | Close lines carry no branch, and the Income Statement excludes them — including its `unallocated` block. |

**The one structural change worth calling out.** `balanceSheet()` previously derived its net income by
calling `incomeStatement()`. Once the Income Statement excludes close journals, that coupling would have
produced a genuine double count: the profit would appear once inside Retained Earnings (from the close
journal) and again as synthetic net income. So `balanceSheet()` now computes net income from **the same
movements it already fetched** — that is, from the full ledger *including* close journals.

This is not a heuristic; it is the ledger identity. Because the close journal zeroes the P&L accounts of
the year it closes, "revenue − expense over the whole ledger" **is** exactly "unclosed net income":

- at a closed year end → the close journal cancels that year's P&L, so synthetic net income is `0`;
- after it → only the activity that has not been closed remains;
- before any close → unchanged from today's behaviour.

The alternative — cutting off at the latest closed year end — would silently mis-state the balance sheet
if a year were ever left unclosed between two closed years. The ledger-truth formulation cannot.

## 8. `retained_earnings` routing

Added to `App\Support\AccountingRoles` with `legacy_code = '3120'` and a new `equity` domain, following
the ACC-2 contract exactly:

- **New tenants** get it automatically — `ChartOfAccountsSeeder::seed()` calls `AccountRoleMappingSeeder`,
  which iterates `AccountingRoles::keys()`.
- **Existing tenants** are covered by `2026_09_10_020000_backfill_retained_earnings_role_mapping.php`,
  which reuses the same seeder. It is **additive only** — it fills missing roles and never overwrites an
  explicit owner decision — so it is idempotent and safe to re-run. `down()` is intentionally a no-op.
- **Resolution is fail-closed** via the unmodified `AccountRoleResolver`: missing, deleted, inactive,
  group, or cross-tenant mapping all raise, and the close refuses. There is **no** hardcoded `3120`
  anywhere in the close logic — the concrete account comes from the resolver and is snapshotted on the
  generation row.
- `opening_balances` (3130) was deliberately **not** added to the catalog, and the docblock now says why.

## 9. Period Lock integration (ACC-6) — no bypass

`LedgerService` is unchanged. No `force`, no `skipLock`, no `disableGuard`, no privileged close path.

The close journal is posted through `post()` and therefore guarded by `AccountingDateGuard` like any
other journal. So an **active period lock covering the fiscal year end is a BLOCKER** with an explicit
message telling the user to release the lock first. Reopen is the same: the reversal is dated at the
close journal's own date, so it too is subject to the guard.

That is the safest reading of FISCAL-1's "controlled internal operations may coordinate with
`AccountingDateGuard`, but no user/admin bypass flag is exposed", and it matches ACC-6's own note that
close orchestration should "validate/close while date is open, create the closing journal, then activate
the final lock". Two independent, separately permissioned, separately audited authorities — not one back
door.

A test asserts the ledger's public surface is still exactly `['post', 'reverse']` with no bypass-shaped
parameter, and greps the **comment-stripped** source of both `LedgerService` and `FiscalCloseService` for
bypass identifiers.

**Reversal date = the original journal's date, not today.** Reopening a year must return its books to
their pre-close state; a reversal dated in a later year would leave the closed year still showing zeroed
P&L in its own trial balance and would correct Retained Earnings in a year that never earned the profit.

## 10. Close / Reopen / Re-close lifecycle

- **Close** — revalidates every critical condition inside the transaction, resolves `retained_earnings`,
  computes P&L from ledger truth, creates generation *n*, posts the journal (or none, for a zero-activity
  year), sets the year `CLOSED`, writes a `year_closed` audit event.
- **Reopen** — permissioned and **reason-mandatory**. Reverses the exact stored close journal via
  `LedgerService::reverse()` at its own date, using the **concrete accounts recorded in the original** —
  no account role is re-resolved, so a remapping made after the close cannot rewrite history. The original
  journal is never edited or deleted. The generation becomes `reversed` and keeps its reversal id, actor,
  timestamp and reason. The year returns to `OPEN`.
- **Re-close** — creates generation *n+1*, recomputed from current ledger truth with close journals and
  their reversals excluded, so neither the previous close nor its reversal can distort the new figure.
  The old generation is retained untouched. **No hard delete of financial history anywhere.**

**Zero-activity year:** closes with a durable `CLOSED` state and a generation row whose
`journal_entry_id` is `null`. **No empty journal and no zero-line journal is created.** The API exposes
`closed_without_journal` so a year "closed with no closing journal required" is distinguishable from one
that was never closed.

## 11. Close readiness

Three severities; **only BLOCKER prevents the close**. The snapshot is explicitly **advisory** — the same
`criticalIssues()` code runs again inside the close transaction, so a stale snapshot can never authorise
a close.

**BLOCKER** — year not open / mid-transition · invalid year range · overlapping year · an active close
generation already exists · `retained_earnings` mapping missing/invalid/inactive/group/foreign · ledger
not balanced inside the year · a revenue/expense account holding a balance that is inactive or a group
account (it would be rejected by the engine, so it is surfaced here with a readable message) · an active
period lock covering the close date · a **posted** document inside the year with a missing or dangling
journal link (checked across invoices, purchases, payments, returns, manual journals, expenses, credit
notes and supplier refunds).

**WARNING** — draft documents dated inside the year, per document type with counts. They are not in the
ledger and therefore excluded from the close calculation, but hiding them would let someone close a year
whose posting is incomplete. The UI requires an explicit acknowledgement before the close button enables.

**INFO** — revenue/expense/result · the Retained Earnings destination account · the close date · posted
document counts · **open AR/AP totals** · VAT output/input balances · previous generations with actors.

Two judgement calls worth stating plainly:

- **Open AR/AP is INFO, not WARNING.** FISCAL-1 lists it under both ("balances" under WARNING, "totals"
  under INFO) while stating it is not a blocker; the task brief says the same. They are ordinary
  balance-sheet items that carry into the next year and require no action, and a warning would imply one.
- **VAT is reported as local accounting state only.** The message says in as many words that these are
  AWJ ledger balances and **not** a filing/submission status at ZATCA, that VAT accounts are asset and
  liability accounts and so are not closed, and that the tax-return cycle is independent of the fiscal
  year. No remote status is claimed without authoritative integration data.

## 12. Concurrency / atomicity

Close and reopen each run in a single `DB::transaction` that first takes `Tenant::whereKey($id)->lockForUpdate()` —
**the same tenant-row anchor ACC-6 established**, and the same row `GeneratesDocumentNumbers` already
locks on every `JournalEntry` insert. Consequences:

1. A close cannot interleave with an ordinary posting: any `LedgerService::post()` begins by taking that
   same row, so a journal cannot land between the P&L calculation and the close journal.
2. Two concurrent closes, or a close and a reopen, serialise.
3. Critical revalidation, P&L calculation, journal posting and generation/state update are all inside
   that one transaction — a failure leaves **no** partial state (asserted by a test).
4. No application-memory mutex anywhere.

Proven on PostgreSQL with **two real independent PDO connections**, in both directions
(`FiscalYearConcurrencyTest`) — see §16.

## 13. Tenant isolation

All three models extend `BaseModel` (`TenantScope` + `BelongsToTenant`) and are `CompanyWide`. The
controller resolves years through `FiscalYear::query()->whereKey($id)`, so a foreign id simply does not
exist. Tested: tenant B cannot list, read readiness for, read events of, close, or reopen tenant A's year;
a close in one tenant leaves the other's ledger, status and reports untouched; and a `retained_earnings`
mapping pointing at another tenant's account fails closed.

## 14. RBAC

Four independent permissions, none inherited from another:

`fiscal_years.view` · `fiscal_years.manage` · `fiscal_years.close` · `fiscal_years.reopen`

Defining a year is not the same authority as closing one, and closing is not the same as reopening.
`owner`/`admin` hold them through `*`; they are **not** granted to `accountant` or `staff` — matching how
every recent permission in this codebase is introduced (ACC-1, ACC-6). Enforced by `EnsurePermission` on
each route and tested at the **API** layer, including a custom role granted only `fiscal_years.view`.

| Method | Path | Permission |
|---|---|---|
| GET | `accounting-settings/fiscal-years` | `fiscal_years.view` |
| GET | `…/{id}/readiness` | `fiscal_years.view` |
| GET | `…/{id}/events` | `fiscal_years.view` |
| POST | `accounting-settings/fiscal-years` | `fiscal_years.manage` |
| PUT | `…/{id}` | `fiscal_years.manage` |
| POST | `…/{id}/close` | `fiscal_years.close` |
| POST | `…/{id}/reopen` | `fiscal_years.reopen` |

No `DELETE` route.

## 15. Audit

`fiscal_year_events` records `year_created`, `year_updated`, `year_closed` and `year_reopened` with actor,
timestamp, generation, the relevant journal id, the reason (mandatory on reopen) and a JSON snapshot of
the figures. The model rejects `update()` and `delete()` with `LogicException`. No hard delete of
financial history exists anywhere in this feature.

**`close_started` / `close_failed` are deliberately not persisted.** A close is fully atomic: a failure
rolls the transaction back entirely, so a "started" row would exist only for closes that also succeeded,
and a "failed" row could never commit. Recording them would suggest a partial-state reconciliation problem
that does not exist. FISCAL-1 conditions this level of audit on the project supporting it safely; it does
not, so the honest answer is to record completed operations and say why.

## 16. Tests and exact results

Three new backend files, **61 tests**, plus one frontend file.

`tests/Feature/FiscalYearCloseTest.php` — 29 tests: calendar and **non-calendar** years; overlap rejected
in five shapes and adjacency allowed; inverted/missing dates rejected; closed-year boundaries frozen;
`retained_earnings` registered with 3120 and never 3130; custom mapping used; missing/disabled mapping
fails closed; profit; loss; multiple revenue and expense accounts; zero-balance account skipped;
break-even year with no Retained Earnings line; **zero-activity year with no journal at all**;
assets/liabilities/equity/VAT never closed; 3130 never used; no branch/partner/cost-center dimension;
structural identity; inactive P&L account blocks; activity outside the year not closed; historical Income
Statement unchanged by the close; Balance Sheet at a closed year end with no double count; Balance Sheet
after a closed year showing only unclosed activity; Balance Sheet dated before the close; Trial Balance
and General Ledger include the close; cost-center and branch P&L undistorted.

`tests/Feature/FiscalYearReopenTest.php` — 28 tests: exact reversal at the original date with mirrored
lines; ledger restored to pre-close state; original journal never edited or deleted; **reversal uses the
original accounts even after the role was remapped**; reason and closed-state required; zero-activity
reopen with no reversal journal; history preserved with actor/reason/generation; events immutable;
**close → reopen → adjustment → re-close** producing the corrected result with generation 1 retained;
second-generation journal computed from ledger truth only; Income Statement correct across the whole
cycle; double close rejected; period lock blocks close with no bypass; releasing the lock lets it proceed;
period lock still blocks ordinary posting, ordinary reversal **and reopen** after a fiscal close; ledger
exposes no bypass parameter or identifier; four permissions enforced independently; view-only custom role;
no delete route; cross-tenant invisibility and unusability; foreign mapping rejected; drafts are warnings;
open AR/AP informational; VAT reported as local state only; unbalanced ledger blocks; readiness advisory
with transactional revalidation; failed close leaves no partial state.

`tests/Feature/FiscalYearConcurrencyTest.php` — 4 tests, PostgreSQL-only, two real PDO connections:
close waits for a rival-held anchor (and leaves nothing partial, then succeeds once released); reopen
waits on the same anchor; an in-flight close blocks any concurrent operation on the tenant (with a
control probe proving the anchor is free beforehand); repeated closes never produce two active
generations.

Two harness facts worth recording, both discovered here:

- The rival probes use `SELECT … FOR UPDATE NOWAIT` rather than `lock_timeout`. `NOWAIT` fails instantly
  with SQLSTATE 55P03, so the test is deterministic and cannot hang.
- **The entire fixture is created by the rival connection, not by Laravel.** Beyond `RefreshDatabase`
  invisibility, any Laravel insert into a table with a FK to `tenants` takes `FOR KEY SHARE` on the tenant
  row and holds it until the test's transaction ends — which conflicts with `FOR UPDATE` and would make
  the rival unable to take the anchor at all. In production every request is its own short transaction,
  so this is a test-harness property only.

### SQLite results

| Run | Result |
|---|---|
| `FiscalYear*` (all three files) | **57 passed, 4 skipped** (273 assertions) — the 4 skips are the PostgreSQL-only concurrency tests |
| Targeted accounting regression¹ | **1,356 passed, 11 failed, 3 skipped** (8,908 assertions) — all 11 are the pre-existing `bcmath` Fuel failures |
| Full suite | see §17 |

¹ filter: `Report|Ledger|Invoice|Purchase|Return|Inventory|Stocktake|StockPermit|AccountRouting|Routing|ManualJournal|Payroll|Asset|Rbac|Expense|Payment|SupplierRefund|AccountingPeriodLock|CostCenter|Branch|Tax|Zatca`

### PostgreSQL results

| Run | Result |
|---|---|
| `FiscalYear*` (all three files) | **61 passed** (287 assertions) — including all 4 concurrency tests |
| Full suite | see §17 |

### Frontend

`npm run build` compiles successfully with `/accounting-settings/fiscal-years` registered (6.95 kB).
`tsc --noEmit`: **0 errors in FISCAL-2 files** (4 pre-existing errors remain in untouched test files).
Targeted vitest — i18n-key guard, accounting-settings nav, hub page, period-locks page and the new
fiscal-years page: **27 passed**.

## 17. Full suite results

| Engine | Result |
|---|---|
| SQLite | **2,806 passed · 25 failed · 8 skipped** (19,246 assertions) |
| PostgreSQL 16 | **2,814 passed · 25 failed** (19,272 assertions) |

The 25 failures are identical in class and count on both engines, and identical to the baseline
established in ACC-4/ACC-5/ACC-6 — **unchanged by this PR**. The 8 SQLite skips are the pre-existing ones
plus FISCAL-2's 4 and ACC-6's 3 PostgreSQL-only concurrency tests.

## 18. Known baseline failures

| Count | Class | Cause |
|---|---|---|
| 3 | `FuelAviRfidServiceTest` | `Error: Call to undefined function App\Services\bcmul()` — the `bcmath` PHP extension is not installed in this container and cannot be installed here. CI declares it, so these pass there. |
| 8 | `FuelReconciliationTest` | same |
| 1 | `FuelSaleApiTest` | same |
| 5 | `FuelSaleServiceTest` | same |
| 2 | `FuelSupplyReceivingApiTest` | same |
| 5 | `FuelSupplyReceivingTest` | same |
| 1 | `DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted_and_the_page_limit_fails_closed` | PDF-parsing environment dependency; verified pre-existing during ACC-5 by re-running against the base tree. |

**No new failure was introduced by FISCAL-2.** The known PostgreSQL `migrate:rollback` incompatibility in
`2025_01_01_000085_allow_sku_reuse_after_soft_delete::down()` was not encountered here (the concurrency
suite uses `RefreshDatabase`, not `DatabaseMigrations`) and was deliberately not touched.

## 19. UI

`/accounting-settings/fiscal-years`, reached both from the Accounting Settings hub (the "Fiscal Periods"
card is now a real link) and from its **own sidebar leaf** — applying the corrected ACC-6 lesson directly:
the entry is gated on `fiscal_years.view` and never inherits `accounting_settings.view`, so a viewer with
only fiscal-year permissions still has a navigation path, and a viewer with only accounting-settings
permission does not see a card that would lead to a Forbidden page.

A dense table in the AWJ design system — year, inclusive range, status badge, close generation with actor
and timestamp, result, and permission-aware actions. No oversized cards, no decorative dashboard.

The pre-close dialog renders the readiness panel grouped into **BLOCKERS / WARNINGS / INFO**. The close
button is disabled while any blocker stands, and when warnings exist it stays disabled until they are
explicitly acknowledged. Reopen is a separate confirmation requiring a typed reason, and its text states
plainly that reopening does not amend any issued tax invoice or submitted VAT return. Close and Reopen
controls are not rendered at all without `fiscal_years.close` / `fiscal_years.reopen`.

Arabic and English strings added to both catalogs; the repo's i18n-key guard passes.

## 20. Changed files

| File | Change |
|---|---|
| `app/Support/AccountingRoles.php` | `retained_earnings` role (default 3120) + `equity` domain; docblock updated |
| `app/Support/FiscalCloseJournals.php` | **new** — structural close-journal predicate |
| `app/Models/FiscalYear.php` · `FiscalYearClose.php` · `FiscalYearEvent.php` | **new** |
| `app/Services/Accounting/FiscalYearService.php` | **new** — year CRUD, overlap, lifecycle, audit |
| `app/Services/Accounting/FiscalCloseService.php` | **new** — readiness, close, reopen |
| `app/Services/Reporting/ReportService.php` | Income Statement and cost-center P&L exclude close journals; Balance Sheet net income decoupled from `incomeStatement()` |
| `app/Http/Controllers/Api/FiscalYearController.php` + 3 form requests | **new** |
| `app/Support/Rbac.php` | four new permissions |
| `routes/api.php` | seven new routes |
| `database/migrations/2026_09_10_010000_create_fiscal_year_tables.php` | **new** — three tables |
| `database/migrations/2026_09_10_020000_backfill_retained_earnings_role_mapping.php` | **new** — idempotent backfill |
| `web/src/app/(app)/accounting-settings/fiscal-years/page.tsx` (+ test) | **new** — workspace |
| `web/src/app/(app)/accounting-settings/page.tsx` | fiscal periods card becomes a real, permission-gated link |
| `web/src/components/layout/sidebar.tsx` | independent Fiscal Years nav leaf |
| `web/src/messages/ar.json` · `en.json` | new strings |
| `tests/Feature/FiscalYearCloseTest.php` · `FiscalYearReopenTest.php` · `FiscalYearConcurrencyTest.php` | **new** |

**`LedgerService` was not modified.** No VAT, ZATCA, invoice, purchase, supplier-refund or inventory
routing code was touched.

## 21. Risks / remaining work

- **Reopening a locked period requires releasing the ACC-6 lock first.** This is deliberate (§9) and the
  message says so, but it is a real two-step workflow for the user. An integrated "release, reopen,
  re-lock" orchestration would need its own design approval; guessing at one would have meant inventing
  a privileged path.
- **No branch or cost-center allocation of Retained Earnings**, per FISCAL-1 V1. Historical branch and
  cost-center P&L are unaffected, but the equity effect is company-wide only.
- **Readiness document checks cover eight document types** — those with a `journal_entry_id` column and a
  posted status. A future document type must be added to `FiscalCloseService::DOCUMENTS` to be covered;
  the list is a single declarative constant to make that obvious.
- **Zero-activity closes create no journal**, so a Trial Balance shows nothing for them. That is the
  intended contract; the state is carried by the generation row and surfaced in the UI.
- **`FiscalYearClose` snapshots figures for readability**, but the ledger remains the source of truth —
  the snapshot is never read back into a calculation.

## 22. Confirmations

- ✅ **`LedgerService` unchanged** and still the only code that writes `journal_entries`/`journal_lines`.
- ✅ **No generic accounting-lock bypass** — no `force`, `skipLock`, `disableGuard`, or privileged flag,
  asserted structurally by test.
- ✅ **No Income Summary account**, **no annual carry-forward journal**, **3130 never used for the close**.
- ✅ **No VAT lifecycle, ZATCA workflow or historical tax document was modified**, and no ZATCA filing
  status is claimed from local data.
- ✅ **No merge, no deploy, no production release**, and no data was reset or deleted.

## 23. Branch / PR / SHAs

- **Base SHA:** `643b7d9d1e5638aea92f38c59fbf7555c8bd8948`
- **Branch:** `claude/fiscal-2-fiscal-year-close`
- **Head SHA:** _(filled in on push)_
- **PR:** _(filled in on open)_

## 24. Next recommended step

Review and merge. The natural follow-ups, each needing its own approval, are: an integrated
release/reopen/re-lock orchestration for locked periods; branch or cost-center attribution of retained
earnings if the business ever wants it; and extending readiness to any new document type as it is built.
