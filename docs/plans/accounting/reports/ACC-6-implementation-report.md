# ACC-6 — Accounting Period Locks — Implementation Report

**Status:** DONE (PR open, not merged)
**Task doc:** `docs/plans/accounting/ACC-6-accounting-period-lock-design.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Dependency:** ACC-1 · ACC-2 · ACC-3 · ACC-RET-1 · ACC-4 · ACC-5 (all merged)

## 1. Summary

A server-enforced, company-wide **Accounting Date Lock**. A locked date range blocks the creation of any
new accounting effect whose accounting date falls inside it — posting and reversal alike — while leaving
drafts, posted history, reports and every amount/account/direction completely untouched.

Enforcement lives in exactly one place: `AccountingDateGuard`, invoked as the first statement inside
`LedgerService::post()` and `LedgerService::reverse()`. There is **no per-transaction override, no
`force` flag, no service-level bypass, and no way to disable the guard from a consumer.** To post into a
locked range an authorised user must explicitly release the lock with a recorded reason, and releasing is
itself audited.

This is not a fiscal close: it creates no closing journals, computes nothing, and owns no document
lifecycle. It answers one question — *is this accounting date open for this tenant?* — and nothing else.

## 2. Base SHA

`f649fa69350c3319d77a44d836a92af6578ae056` — the ACC-5 merge commit, verified as `origin/main`'s head
before branching. This is the exact SHA the task named.

## 3. Branch

`claude/acc-6-accounting-period-locks`

## 4. PR

_(filled in on open)_ — opened, **not merged**, not deployed, no production release. No data was reset or
deleted.

## 5. Head SHA

_(filled in on push)_

## 6. Enforcement architecture

```
domain service (invoice, purchase, payment, inventory, payroll, asset, return, POS, fuel, manual journal…)
        │  derives its own accounting date from its document
        ▼
LedgerService::post() / ::reverse()      ← the only posting primitive, unchanged in every other respect
        │  DB::transaction {
        │      AccountingDateGuard::assertOpen(final entry_date)   ← ACC-6, first statement, before any write
        │      JournalEntry::create(...) ...
        │  }
        ▼
AccountingPeriodLock (CompanyWide, tenant-scoped)
```

Three properties make this a single enforcement point rather than a policy sprinkled across services:

1. **The guard sees the *final* date, not the caller's intent.** `post()` guards
   `$meta['entry_date'] ?? today`, which is byte-for-byte the value it then writes to
   `journal_entries.entry_date`. `reverse()` guards the *proposed reversal date*, likewise the value it
   writes. A service cannot pass one date to the guard and another to the ledger, because it passes only
   one.
2. **The guard runs inside the ledger's own transaction, before the first write.** A rejection therefore
   rolls the whole workflow back — no journal, no line, no partial operational side effect.
3. **The ledger has exactly two public methods, and both are guarded.** Verified structurally by a test
   (`ledger_post_and_reverse_cannot_be_called_past_the_guard`) that reflects over `LedgerService` and
   asserts its public surface is precisely `['post', 'reverse']` with no `force` parameter.

The guard knows nothing about invoices, inventory valuation, account routing or fiscal close, and changes
no account, amount or direction. It allows or blocks, by accounting date.

## 7. Current-main posting-writer inventory (mandatory gate)

Performed on `f649fa6` before writing any code.

**Direct journal writers outside `LedgerService`: none.**

- `JournalEntry::create|insert|forceCreate|updateOrCreate|firstOrCreate` and `new JournalEntry` —
  **zero** occurrences outside `LedgerService`.
- `JournalLine::create` / `new JournalLine` — **zero** outside `LedgerService`. Every other `journal_lines`
  occurrence in `app/` is either a read query (`ReportService`, `InvoiceService::outstanding`,
  `AccountWorkspaceService`, `FinancialControlService`, `JournalEntryController`) or a comment stating
  "no direct writes to journal_lines".
- `ManualJournalLine::create` in `ManualJournalService` writes the **draft** table, not the ledger.
- No queue job, console command or import path posts: `app/Jobs/Accounting` contains only
  `SendZatcaSubmission` (ZATCA transmission, no ledger call); no `app/Console/Commands/*` calls the ledger.

**All 22 posting call sites converge on `$this->ledger->post()`:**

| File | Calls |
|---|---|
| `Accounting/ReturnService.php` | 3 |
| `Accounting/StockPermitService.php` · `PayrollService.php` · `InventoryService.php` · `EmployeeCustodyService.php` · `AssetService.php` | 2 each |
| `FuelSupplyReceivingService.php` | 2 |
| `Accounting/SupplierRefundService.php` · `StocktakeService.php` · `PurchaseService.php` · `PosSessionService.php` · `PosExchangeService.php` · `PaymentService.php` · `PartnerService.php` · `ManualJournalService.php` · `InvoiceService.php` · `InventoryOpeningService.php` · `ExpenseService.php` · `CreditNoteService.php` · `CashBankTransferService.php` | 1 each |
| `FuelSaleService.php` · `FuelReconciliationService.php` | 1 each |

**All reversal call sites converge on `$this->ledger->reverse()`:** `SupplierRefundService::reverse()`
and `ManualJournalService::reverse()` — the only two, both thin wrappers.

**No blocker found**, so implementation proceeded. To keep this true for code written after ACC-6, the
inventory is now enforced by a test rather than a one-time audit:
`no_code_outside_the_ledger_writes_journal_rows_directly` scans every PHP file under `app/`, strips
comments via `token_get_all`, and fails if anything but `LedgerService` writes `JournalEntry`/`JournalLine`
rows or raw `journal_entries`/`journal_lines` tables.

## 8. Schema / migrations

One new migration, `database/migrations/2026_09_09_010000_create_accounting_period_lock_tables.php`. No
existing table, column, index or seeder was modified.

**`accounting_period_locks`** — `CompanyWide`, tenant-scoped:

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `tenant_id` | FK → tenants, cascade on delete |
| `start_date`, `end_date` | `date`, both **inclusive**; no open-ended range in V1 |
| `status` | `active` \| `released` — no hard delete |
| `reason` | text, required on create |
| `created_by` | FK → users, null on delete |
| `released_by`, `released_at`, `release_reason` | populated on release, null while active |
| index | `(tenant_id, status, start_date, end_date)` — the guard's hot path |

**`accounting_period_lock_events`** — immutable audit, mirroring ACC-2's `account_role_mapping_events`:
`id`, `tenant_id`, `accounting_period_lock_id` (snapshot uuid, deliberately no FK so history stays
readable), `action` (`lock_created` \| `lock_released`), `actor_user_id`, `start_date`/`end_date`
snapshots, `reason` for *this* action, timestamps. The model throws `LogicException` on `updating` and
`deleting`.

**No `branch_id` on either table**, per the contract: one balanced journal may carry lines from several
branches (or deliberately null, company-wide lines), so a branch-scoped lock would make a balanced entry
"partially locked".

## 9. Lock / unlock semantics

- **Create** — `start_date`, `end_date` and a non-empty `reason` are all required. Rejected if
  `start > end`, or if the range overlaps any **active** range for the tenant.
- **Release** — requires a non-empty reason. Sets `status = released` and stamps
  `released_by`/`released_at`/`release_reason`. **The row is never deleted**; the released range remains
  as historical evidence that the period was locked, by whom, and why it was reopened.
- **No edit-in-place and no hard delete**, exactly as the contract prefers. Correcting a range means
  releasing it with a reason and creating a replacement — both actions land in the immutable audit trail.
  There is no `DELETE` route (asserted by `there_is_no_hard_delete_route_for_a_lock`).
- **Drafts are never affected.** Creating, editing, duplicating and deleting a draft inside a locked
  period all remain allowed, because no accounting effect exists. Only *posting* that draft into a locked
  date is blocked, and moving it to an open date lets it post normally. The lock is a period lock, never a
  document lock.
- **Posted history stays immutable.** Locking introduces no edit or delete path, does not touch
  `entry_date` on anything already posted, and does not hide entries from reports.

## 10. Inclusive date-boundary semantics

Comparison is on the accounting date as a calendar day (`Y-m-d`), never on a timestamp:
`start_date <= date <= end_date`. Both endpoints are inside the lock — tested explicitly on the first day,
the last day, the day before and the day after.

`AccountingDateGuard::normalize()` reads an explicit date verbatim (`'2026-01-15'` stays `2026-01-15`;
a `DateTimeInterface` is formatted with `Y-m-d`) and never UTC-converts in a way that could shift the
calendar day. A missing date resolves to "today" through `Carbon::now()->toDateString()` — the *same*
source `LedgerService` already uses for its default `entry_date`, so the guarded value and the stored
value can never disagree.

**Effective timezone verified before writing the tests:** the application runs at `APP_TIMEZONE=UTC`
(`config('app.timezone') === 'UTC'`, `date_default_timezone_get() === 'UTC'`). `Settings::operating_timezone`
(`Asia/Riyadh`) is a business display setting that the ledger has never consulted, and ACC-6 does not start
consulting it. **No new timezone semantics were introduced.** The one test that relies on implicit "today"
pins the clock with `Carbon::setTestNow()` rather than depending on the wall clock.

## 11. Concurrency / tenant serialization strategy

The race the contract names: a guard check reads "open", a concurrent request commits a lock covering that
date, and the first request then inserts its journal — leaking an entry into a now-locked period.

**The anchor is the tenant row (`tenants`), and it was already there.** `JournalEntry` implements
`CompanyWide`, so its numbering goes through `GeneratesDocumentNumbers::lockNumberingAnchor()`, which
already executes `Tenant::whereKey($id)->lockForUpdate()` inside every `post()` and `reverse()`. ACC-6
reuses that exact row:

- `AccountingDateGuard::activeLockFor()` takes `SELECT … FROM tenants WHERE id = ? FOR UPDATE` **before**
  reading the locks table, inside the ledger's transaction.
- `AccountingPeriodLockService::create()` / `release()` take the same `FOR UPDATE` on the same row before
  their overlap check and their insert.

Consequences:

1. Overlap prevention is **not** a bare check-then-insert: the check and the insert are one transaction
   holding the anchor, so two concurrent creations serialise and the second sees the first.
2. Posting and lock activation are mutually exclusive on the same row, closing the check-then-post window.
3. **Cost is zero.** The lock was already taken a few statements later in the same transaction by document
   numbering; the guard merely acquires it slightly earlier. No new serialisation, and no lock-order
   inversion (services lock their document rows first, then the tenant row, exactly as before).
4. No process-memory mutex, no cache, no application-level lock anywhere.

## 12. SQLite strategy

SQLite has no row-level locking, so `lockForUpdate()` compiles to a no-op there; serialisation instead
comes from its single-writer engine — only one write transaction exists at a time. All functional
behaviour (boundaries, overlap rejection, adjacency, fail-closed, isolation, audit immutability) is
identical and fully tested on SQLite: **35 of the 36 lock tests run there**, and the 3 two-connection
concurrency tests skip themselves with an explicit message.

This is a documented engine difference, not an unsafe contract: **SQLite is the test engine only**
(`CLAUDE.md`: PostgreSQL in production, SQLite in tests), and the residual check-then-post window under
true SQLite concurrency cannot arise in production. Nothing about the design depends on which engine is
underneath — the same anchor is taken on both.

## 13. PostgreSQL strategy

`FOR UPDATE` on the tenant row gives genuine mutual exclusion, and this is **proved with two real,
independent PDO connections**, not simulated in one process
(`AccountingPeriodLockConcurrencyTest`, PostgreSQL-only):

| Test | What it proves |
|---|---|
| `creating_a_lock_waits_for_the_tenant_anchor_held_by_another_connection` | A rival connection holding the anchor makes lock creation **block** (surfaced as a `lock_timeout` error rather than a hang); nothing partial is written; after the rival rolls back, creation succeeds |
| `the_ledger_guard_waits_on_the_same_anchor_so_a_posting_cannot_slip_past_a_landing_lock` | The guard contends on the **same** row — so a check cannot slip through while a lock is being committed |
| `a_concurrent_overlapping_lock_is_rejected_after_the_rival_commits_never_admitted_twice` | With a rival mid-transaction holding an overlapping active lock, our creation waits; after the rival commits, it is rejected **for overlap**, and exactly one active range remains |

A short `SET lock_timeout` turns "waits forever" into an assertable error. The rival connection owns the
committed tenant fixture, because `RefreshDatabase` wraps the test in a transaction whose rows a second
connection cannot see. (`DatabaseMigrations` was rejected for this: its rollback path trips a pre-existing
PostgreSQL incompatibility in `2025_01_01_000085_allow_sku_reuse_after_soft_delete::down()` — unrelated to
ACC-6 and deliberately left alone. See §25.)

## 14. Audit trail

Every lock lifecycle action writes an immutable `AccountingPeriodLockEvent` recording the actor, the range
snapshot, and the reason given for that specific action:

| Action | Event | Reason source |
|---|---|---|
| Create lock | `lock_created` | the create reason (required) |
| Release lock | `lock_released` | the release reason (required) |
| Modify a range | *two* events — `lock_released` then `lock_created` on the replacement | both reasons |
| Delete | **not possible** — no route, no service method |

Events reject `update()` and `delete()` with `LogicException`. Releasing a lock **never erases
administrative history**: the lock row survives with `status = released` plus who released it, when, and
why, and both events remain. `GET /accounting-settings/period-locks/{id}/events` exposes the trail, and
the UI renders it in a per-lock history dialog.

## 15. RBAC

Two dedicated permissions added to `Rbac::PERMISSIONS`:

- `accounting_period_locks.view`
- `accounting_period_locks.manage`

They are **not** granted to `accountant` or `staff` — locking a period stops posting for an entire
company, which is an administrative control, not daily accounting work. `owner`/`admin` hold them through
`*`, matching how every recent permission in this codebase is introduced. They are deliberately separate
from `accounting_settings.*`: routing an account is not the same authority as halting posting.

Authorization is enforced at the **API** layer via the existing `EnsurePermission` middleware on each
route, and tested there (not only in the UI): view/manage separation, `staff` and `accountant` refusals,
unauthenticated `401`, and a cross-tenant release attempt that cannot reach another tenant's lock.

Routes:

| Method | Path | Permission |
|---|---|---|
| GET | `accounting-settings/period-locks` | `accounting_period_locks.view` |
| GET | `accounting-settings/period-locks/{id}/events` | `accounting_period_locks.view` |
| POST | `accounting-settings/period-locks` | `accounting_period_locks.manage` |
| POST | `accounting-settings/period-locks/{id}/release` | `accounting_period_locks.manage` |

No `PUT` (no edit-in-place) and no `DELETE` (no hard delete).

## 16. UI

`/accounting-settings/period-locks`, reached from the Accounting Settings hub (its card is now a real
link instead of a "soon" placeholder). Built inside the existing AWJ design system — dense table, single
accent colour, no oversized cards, no generic SaaS dashboard, no decorative redesign.

Shows, per the task's minimum: the **date range**, the **status** badge (locked / released), the
**reason**, **who created it and when**, **who released it and when**, and the actions the viewer's
permission actually allows. A view-only user sees the table and the audit trail but no create/release
controls, and the page itself re-checks permission (`hasPermission`) rather than relying on nav hiding.

Sensitive actions use explicit confirmations, not one-click surprises: creating a lock is a dialog stating
that both boundaries are inclusive and ranges may not overlap; releasing is a separate dialog naming the
exact range being reopened and requiring a typed reason before the button enables. A standing notice
states plainly that drafts stay editable while posting and reversal inside the range are blocked, and that
**there is no per-transaction override** — the contract's "no fake override toggle" rule.

Arabic and English strings added to both message catalogs; the repo's i18n-key guard test passes.

## 17. Tenant Isolation

`AccountingPeriodLock` extends `BaseModel` (so `TenantScope` + `BelongsToTenant` apply) and is
`CompanyWide`. The guard additionally filters by `tenant_id` **explicitly** rather than relying on the
scope, because `TenantScope` does not filter when no tenant context is set; with no active tenant the
guard returns early and reads nothing at all. Cross-tenant behaviour is tested in both directions: tenant
A's lock never blocks tenant B's posting, tenant B cannot see or release tenant A's lock through the API,
and returning to tenant A the block is still in force.

## 18. Atomicity / fail-closed evidence

A blocked date raises `AccountingPeriodLockedException` (extending `RuntimeException`, so
`ApiController::domain()` maps it to a 422 with its Arabic message) **before the first write**, inside the
ledger's transaction. Evidence:

- `a_rejected_posting_leaves_no_journal_entry_or_line_behind` — entry count unchanged, no entry on the
  blocked date.
- `a_rejected_invoice_posting_leaves_no_partial_operational_side_effects` — a full invoice post is
  rejected and the product quantity, the `product_warehouse_stock` row, the journal count and the
  invoice's own `draft` status are all exactly as before. The existing transaction boundary is preserved;
  ACC-6 added no new one.
- `the_original_entry_is_never_mutated_by_a_lock_or_a_blocked_reversal` — after a rejected reversal the
  original keeps its number, date, `posted` status and every line untouched (in particular it is **not**
  marked `reversed`).
- There is no silent fallback anywhere: the guard either returns or throws.

## 19. Tests + assertions

Two new files, **39 tests**.

`tests/Feature/AccountingPeriodLockTest.php` — 36 tests:

| # | Required coverage | Test |
|---|---|---|
| 1 | Posting on an open date succeeds | `posting_on_an_open_date_succeeds` |
| 2 | First day of lock fails | `posting_on_the_first_day_of_a_lock_fails` |
| 3 | Last day of lock fails | `posting_on_the_last_day_of_a_lock_fails` |
| 4 | Before/after the range succeeds | `posting_just_before_and_just_after_the_range_succeeds`, `a_date_inside_the_range_fails_and_the_implicit_today_is_guarded_too` |
| — | Implicit `today` is guarded too | `an_omitted_date_is_guarded_as_today_not_waved_through` |
| 5 | Draft create/edit/delete stay allowed | `draft_create_edit_and_delete_stay_allowed_inside_a_locked_period`, `a_draft_moved_to_an_open_date_posts_normally` |
| 6 | Locked original reversed into an open date | `an_original_inside_a_locked_period_is_reversed_into_an_open_date` |
| 7 | Reversal dated inside a lock fails | `a_reversal_dated_inside_a_lock_fails` |
| 8 | Original never changes | `the_original_entry_is_never_mutated_by_a_lock_or_a_blocked_reversal` |
| — | Reversal uses the original concrete accounts, no role re-resolution | `reversal_copies_the_original_concrete_accounts_without_re_resolving_roles` |
| 9 | Overlapping active ranges rejected (5 overlap shapes) | `overlapping_active_ranges_are_rejected` |
| 10 | Adjacent ranges allowed | `adjacent_ranges_are_allowed` |
| 11 | `start > end` rejected | `a_start_date_after_the_end_date_is_rejected` |
| — | Release restores posting; row survives; replacement allowed | `a_released_range_stops_blocking_and_the_row_survives`, `releasing_frees_the_range_for_a_replacement_lock` |
| 12 | Tenant isolation | `a_lock_in_tenant_a_never_blocks_tenant_b` |
| 13 | `…locks.view` RBAC | `the_api_requires_the_view_permission_to_list_locks` |
| 14 | `…locks.manage` RBAC | `the_api_requires_the_manage_permission_to_create_or_release_a_lock` |
| 15 | Unauthorized direct API attempts rejected | `unauthenticated_and_cross_tenant_api_attempts_are_rejected`, `there_is_no_hard_delete_route_for_a_lock` |
| 16 | Concurrent overlap invariant | `two_overlapping_lock_creations_never_leave_two_active_ranges`, `the_guard_and_the_lock_writer_share_one_tenant_anchor` (+ the real two-connection tests below) |
| 17 | Rejection leaves no partial journal | `a_rejected_posting_leaves_no_journal_entry_or_line_behind` |
| 18 | Rejection leaves no partial operational effects | `a_rejected_invoice_posting_leaves_no_partial_operational_side_effects` |
| 19 | All posting consumers covered | `representative_document_paths_are_all_blocked_by_the_central_guard`, `no_code_outside_the_ledger_writes_journal_rows_directly` |
| 20-21 | `post()`/`reverse()` cannot bypass the guard | `ledger_post_and_reverse_cannot_be_called_past_the_guard` |
| — | Company-wide lock covers every branch incl. null-branch lines | `a_company_wide_lock_blocks_every_branch_including_null_branch_lines` |
| — | Σ debit = Σ credit and nothing else changes | `an_open_period_changes_nothing_about_amounts_accounts_or_direction` |
| — | Reports/history unaffected | `reports_and_history_still_see_entries_inside_a_locked_period` |
| — | Audit trail | `creating_and_releasing_a_lock_write_immutable_audit_events`, `the_audit_trail_records_the_actor_behind_each_action`, `a_lock_requires_a_reason_on_both_create_and_release`, `a_released_lock_cannot_be_released_twice` |

`tests/Feature/AccountingPeriodLockConcurrencyTest.php` — 3 tests, PostgreSQL-only (see §13).

Requirements 22-25 (ACC-2→ACC-5 routing, Supplier Refund, Purchase Return, Inventory/COGS regressions)
are covered by the existing suites, run in full — see §22.

## 20. SQLite results

| Run | Result |
|---|---|
| `AccountingPeriodLockTest` | **36 passed** (112 assertions) |
| `AccountingPeriodLockConcurrencyTest` | 3 skipped (PostgreSQL-only, by design) |
| Full suite | **2,713 passed · 25 failed · 4 skipped** (18,784 assertions) |

## 21. PostgreSQL results

| Run | Result |
|---|---|
| `AccountingPeriodLock*` (both classes) | **39 passed** (122 assertions) — including all 3 real two-connection concurrency tests |
| Full suite | **2,717 passed · 25 failed** (18,796 assertions) |

## 22. Broader regression results

Targeted regression across every accounting surface ACC-6 could plausibly disturb — filter
`Ledger|Invoice|Purchase|Return|SupplierRefund|Inventory|Stocktake|StockPermit|AccountRouting|Routing|ManualJournal|Payroll|Asset|Rbac|Expense|Payment|Custody|CashBank`
on SQLite: **1,045 passed, 11 failed**, where all 11 are the pre-existing `bcmath` Fuel failures (§24).

This covers requirements 22-25 directly:

| Requirement | Covered by | Result |
|---|---|---|
| 22 — Account Routing ACC-2 → ACC-5 intact | `AccountRoutingTest`, `SalesPaymentAccountRoutingTest`, `PurchaseAccountRoutingTest`, `InventoryCogsAccountRoutingTest` | green |
| 23 — Supplier Refund regression | `SupplierRefund*Test` | green |
| 24 — Purchase Return regression | `PurchaseReturn*Test`, `ReturnTest`, `ReturnWithProductTest` | green |
| 25 — Inventory / COGS regression | `InventoryTest`, `InventoryOpening*Test`, `StocktakeTest`, `StockPermitTest`, `InventoryCogsAccountRoutingTest` | green |

The full suites (§20, §21) then re-ran everything, including POS, ZATCA, HR, platform and the branch
isolation guard (which requires every new model to declare its branch classification — both new models
declare `CompanyWide`).

Frontend: `npm run build` compiles successfully with the new route registered
(`/accounting-settings/period-locks`, 6.32 kB); `tsc --noEmit` reports **0 errors in ACC-6 files** (4
errors remain in pre-existing, untouched test files); the repo's i18n-key guard and the accounting-settings
nav test both pass.

## 23. Changed files

| File | Change |
|---|---|
| `database/migrations/2026_09_09_010000_create_accounting_period_lock_tables.php` | **new** — two tables |
| `app/Models/AccountingPeriodLock.php` | **new** — `CompanyWide` lock range |
| `app/Models/AccountingPeriodLockEvent.php` | **new** — immutable audit event |
| `app/Services/Accounting/AccountingDateGuard.php` | **new** — the single enforcement point |
| `app/Services/Accounting/AccountingPeriodLockedException.php` | **new** — typed fail-closed error |
| `app/Services/Accounting/AccountingPeriodLockService.php` | **new** — list / create / release, anchored |
| `app/Services/Accounting/LedgerService.php` | guard injected; `assertOpen()` first inside `post()` and `reverse()` — **no other change** |
| `app/Http/Controllers/Api/AccountingPeriodLockController.php` | **new** |
| `app/Http/Requests/StoreAccountingPeriodLockRequest.php` · `ReleaseAccountingPeriodLockRequest.php` | **new** |
| `app/Support/Rbac.php` | two new permissions |
| `routes/api.php` | four new routes |
| `web/src/app/(app)/accounting-settings/period-locks/page.tsx` | **new** — workspace |
| `web/src/app/(app)/accounting-settings/page.tsx` | hub card becomes a real link |
| `web/src/messages/ar.json` · `en.json` | new strings |
| `tests/Feature/AccountingPeriodLockTest.php` · `AccountingPeriodLockConcurrencyTest.php` | **new** |

No existing model, service, migration, seeder or financial API outside `LedgerService` was modified.

## 24. Known pre-existing failures

**25 failures on each engine, identical in class and count on SQLite and PostgreSQL**, all pre-existing
and unrelated to ACC-6:

| Count | Class | Cause |
|---|---|---|
| 3 | `FuelAviRfidServiceTest` | `Error: Call to undefined function App\Services\bcmul()` — the `bcmath` PHP extension is not installed in this container and cannot be installed here. CI declares it, so these pass there. |
| 8 | `FuelReconciliationTest` | same |
| 1 | `FuelSaleApiTest` | same |
| 5 | `FuelSaleServiceTest` | same |
| 2 | `FuelSupplyReceivingApiTest` | same |
| 5 | `FuelSupplyReceivingTest` | same |
| 1 | `DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted_and_the_page_limit_fails_closed` | `"ملف PDF تالف أو غير مدعوم."` — a PDF-parsing environment dependency. Verified pre-existing in the ACC-5 cycle by re-running it against the base tree with all changes stashed. |

This is exactly the baseline established and re-verified in ACC-4 and ACC-5 — **composition and count are
unchanged by this PR**. The SQLite `skipped` count is 4: one pre-existing skip plus the 3
PostgreSQL-only concurrency tests.

## 25. Risks / remaining work

- **SQLite's residual check-then-post window** (§12) is not closed by row locks, because SQLite has none.
  It is a test-engine-only exposure and does not exist in production PostgreSQL. Closing it would require
  driver-specific write-forcing in the guard, which would buy nothing in production and add a branch to
  the hottest accounting path.
- **A pre-existing PostgreSQL bug in an unrelated migration** —
  `2025_01_01_000085_allow_sku_reuse_after_soft_delete::down()` builds a `GROUP BY` query PostgreSQL
  rejects (`column "products.id" must appear in the GROUP BY clause`), so `migrate:rollback` fails on
  PostgreSQL. Discovered while choosing a testing strategy; **deliberately not fixed** (outside ACC-6's
  scope). It is worked around in the concurrency test by using `RefreshDatabase`, and reported here rather
  than silently patched.
- **`reason` is free text.** The contract asks for a recorded reason, not a taxonomy. If lock reasons
  later need reporting or categorisation, that is a follow-up.
- **No exception workflow.** Posting into a locked range requires releasing the lock. The contract
  explicitly defers a per-transaction exception workflow to separate design approval, and none was built.
- **Fiscal close interaction is untouched and compatible.** ACC-6 adds no hidden ledger bypass, so the
  orchestration the contract describes (validate and close while the date is open → create the closing
  journal → activate the final lock under serialisation) remains available to FISCAL-2 without changing
  anything here.
- **No UI automated tests**, consistent with the repo's current state (`web/` has no page tests for
  comparable screens); `npm run build`, `tsc`, and the i18n-key guard all pass.

## 26. Confirmation: LedgerService remains the central posting primitive

Confirmed. `LedgerService` is still the only code in the repository that writes `journal_entries` or
`journal_lines`, its balancing, numbering, branch-dimension, account-postability and balance-snapshot
logic are byte-for-byte unchanged, and its public surface is still exactly `post()` and `reverse()`. ACC-6
added a constructor dependency and one guard call at the top of each method — nothing else. The claim is
enforced by `no_code_outside_the_ledger_writes_journal_rows_directly`, not merely asserted.

## 27. Confirmation: no generic bypass was introduced

Confirmed. There is **no** per-transaction admin bypass, **no** `force` parameter (asserted by
reflection), **no** hidden flag in `$meta`, **no** service-level opt-out, and **no** way for a consumer to
disable `AccountingDateGuard`. The only way to post into a locked range is to release the lock through the
permissioned API with a recorded reason, which is itself audited. The UI shows no override toggle, real
or fake.

## 28. Confirmation: FISCAL-2 was not started

Confirmed. No fiscal-close code, schema, route or UI was written. `FISCAL-1-fiscal-period-close-design.md`
was not implemented against, and no closing journal is created anywhere. Semantic Account Routing
(ACC-2→ACC-5), valuation, COGS, VAT, debit/credit semantics, Supplier Refund architecture and Purchase
Return architecture are all untouched.

## 29. Next step

Await review. If approved and merged, the natural follow-ups are FISCAL-2 (fiscal period close, which
orchestrates *around* this lock rather than through it) and — separately — the deferred per-transaction
exception workflow, which needs its own design approval per the ACC-6 contract.
