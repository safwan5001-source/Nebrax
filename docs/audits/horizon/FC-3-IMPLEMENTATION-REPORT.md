# FC-3 — Implementation report: Closed Fiscal Year Posting Protection

STATUS: **IN REVIEW (Draft PR). NOT MERGED. NOT DEPLOYED.** Closes only after approved merge and verification. Production deployment and production data: NOT VERIFIED.
DATE: 2026-10-15 · ZONE: C — accounting integrity · Horizon: TAX-ZATCA
Contract: owner decisions FC3-1 (Option C1), FC3-2, FC3-3, FC3-4, taken after the FC-3 read-only policy review. Predecessors: FISCAL-2 (fiscal close / reopen), ACC-6 (period locks), ACC-02-FC (`90b854f`).

## 1. Summary

Before FC-3 a fiscal year in status `closed` did **not** itself block posting: only an active `AccountingPeriodLock` did. A journal dated inside a closed year could therefore be posted after the close and silently fall outside the active close generation (the year's P&L moved while its close journal and Retained Earnings did not).

FC-3 makes a closed year **closed for posting**, centrally, in the one place every journal passes through.

| Decision | Implementation |
|---|---|
| FC3-1 Option C1 | `AccountingDateGuard::assertOpen()` — already called by `LedgerService::post()` and `reverse()` after the tenant-anchor lock — now also rejects an accounting date inside a `closed` fiscal year (inclusive `start_date..end_date`). |
| FC3-2 | Mandatory. No tenant setting, no bypass argument, no privileged path, no automatic date change. |
| FC3-3 | `AccountingPeriodLock` behaviour unchanged and still evaluated first (independent authority). Superseding notes added to FISCAL-1 design, FISCAL-2 report §9 and ACC-6 design. |
| FC3-4 | Fiscal Close readiness `close_date` (info) and `drafts` (warning) messages state that after the close, posting/reversal dated within the year is rejected unless the year is formally reopened; `close_date.details` gains `posting_blocked_after_close: true` and `year_not_ended`. No severity change. |

## 2. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/FiscalYearClosedException.php` (new) | `class FiscalYearClosedException extends AccountingPeriodLockedException` |
| `app/Services/Accounting/AccountingDateGuard.php` | `assertOpen()` checks the period lock, then `closedFiscalYearFor()`; docblock records the FC-3 rule |
| `app/Services/Accounting/FiscalCloseService.php` | readiness wording only (`close_date`, `drafts`); `close()` / `reopen()` / P&L / blockers untouched |
| `tests/Feature/FiscalYearClosedPostingTest.php` (new, 13 tests) | functional matrix (SQLite + PostgreSQL) |
| `tests/Feature/FiscalYearClosedPostingPostgresTest.php` (new, 2 tests) | forked-process PostgreSQL races (skipped on SQLite) |
| `tests/Feature/VatAdjustmentRoutingTest.php` | CI robustness only: `journal()` and its expected literals are compared in canonical account-code order (`lines` has no ORDER BY, so PostgreSQL returned the same three lines in a different order on the first CI run). Values and debit/credit direction remain compared strictly; no assertion removed |
| `docs/plans/accounting/FISCAL-1-fiscal-period-close-design.md`, `docs/plans/accounting/reports/FISCAL-2-implementation-report.md`, `docs/plans/accounting/ACC-6-accounting-period-lock-design.md` | explicit superseding notes (FC3-3) |
| `CLAUDE.md`, `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md`, this report | documentation / status (ACC-02-FC recorded as merged #1501) |

Not changed: amounts, journal lines, account routing, VAT calculations, ZATCA XML/QR/hash/ICV generation, permissions/RBAC, routes, schema/migrations, `web/`.

## 3. Exact enforcement behaviour

`AccountingDateGuard::assertOpen($date, $context)`:

1. Normalise the accounting date to `Y-m-d` (unchanged).
2. `activeLockFor()` — locks the tenant row (`SELECT … FOR UPDATE`) and looks for an active period lock covering the date. If found → `AccountingPeriodLockedException` (unchanged message). **Period lock wins** when both apply.
3. `closedFiscalYearFor()` — plain read, explicit `tenant_id` filter: `status = 'closed' AND start_date <= date AND end_date >= date`. If found → `FiscalYearClosedException`:
   > `<context> بتاريخ <date> مرفوض: السنة المالية «<name>» (<start> إلى <end>) مقفلة. لتصحيحها افتح السنة المالية رسمياً بصلاحية الفتح وسببٍ مسجَّل، أو أرّخ العملية في فترة مفتوحة.`

| Case | Result |
|---|---|
| Date = start_date, any date inside, = end_date of a `closed` year | rejected |
| Day before start / day after end | allowed (subject to other years / locks) |
| Year `open` (never closed, or reopened) | allowed (subject to period locks) |
| Year `closing` / `reopening` | allowed — these statuses exist only inside the close/reopen transaction, which posts the close journal or its reversal; they are never committed |
| Branch-tagged or untagged entry | same rule — company-wide (fiscal years are tenant-level) |
| Another tenant's closed year | no effect (explicit tenant filter) |
| `reverse()` | the guard applies to the **reversal's** date (as ACC-6): reversing a 2026 entry dated today (open) is allowed; dated inside the closed year is rejected |
| No tenant context | no fiscal-year check (same as the existing period-lock path) |

**Error contract.** `FiscalYearClosedException` extends `AccountingPeriodLockedException` (`RuntimeException`), so every existing handler that catches the period-lock exception or `RuntimeException` treats it identically; `ApiController::domain()` returns **HTTP 422 `{message}`** (tested via the manual-journal and credit-note APIs).

**Correction path.** Formal reopen (`fiscal_years.reopen` permission + recorded reason → close generation reversed, year `open`) then post, then re-close (new generation); or post the correction in an open period. There is no other path.

**Lock order / transactions.** No new lock and no change in order: the fiscal-year read happens after the tenant anchor already taken by `activeLockFor()`, in the caller's transaction, before any write. Close and reopen take the same anchor first, so under PostgreSQL READ COMMITTED a waiting post re-reads the committed status after the anchor is released; a post that wins the anchor is included in the close's in-transaction P&L recomputation.

## 4. Financial impact and journal integrity

- **No amount, journal, account or VAT computation changes.** Every journal that is accepted is byte-identical to before; the only behavioural change is that some postings now fail closed.
- Rejection happens inside the posting transaction before any write → full rollback: document stays `draft`, no journal entry/line, no `AccountBalance` change, no journal number consumed, and for invoices no ZATCA ICV / UUID / hash / QR / XML assigned (test asserts the next ICV is contiguous after a rejected attempt).
- Close journal (dated `end_date`) and reopen reversal (dated the close journal's date) are unaffected; close → reopen → re-close generations tested.
- Reports for the closed year (Income Statement, Balance Sheet, VAT report REM-05, Fiscal Close readiness `vat_balances`) are unchanged by rejected backdated attempts (tested).

## 5. POS and delayed commerce sync gate

Inspected only the paths that can produce ledger postings asynchronously or with a non-user-chosen date.

| Path | Date used | Rejection propagated? | Recoverable? | Retry duplicates? | Silent change / swallow? | Risk |
|---|---|---|---|---|---|---|
| POS checkout (`PosService` → `InvoiceService::post`) | invoice date = today | yes, 422 to the cashier; transaction rolled back | yes (only possible if the year containing today was closed early) | no automatic retry; web POS blocks offline checkout | none | low |
| POS session variance (`PosSessionService::settleVariance`) | session `closed_at` | yes, 422 | reopen the year (same as an ACC-6 lock today) | no | none | low (residual, documented) |
| POS exchange (`PosExchangeService`) | via `ReturnService` / `InvoiceService` | yes | yes | no | none | low |
| Fuel sale / reconciliation / supply receiving | their own document dates | yes, inside one transaction | reopen or open-period date | no | none | low |
| Payment gateway settlement (`PaymentGatewaySettlementService`) | explicit user-entered date | yes | choose an open date | no | none | low |
| Commerce orders / payment intents / delivery connector ingestion | — | — | — | — | **no ledger call exists** (CommerceOrder ≠ Invoice, PaymentIntent ≠ Payment) | none |
| Scheduled jobs (`routes/console.php`) | — | — | — | — | no posting jobs | none |

**Gate result: no high-risk path; no architectural blocker.** No path silently re-dates, swallows the exception, or retries into duplicates. Residual: an operation whose date is fixed by the source (POS variance at session close time, fuel documents) cannot be posted into a closed year until it is reopened — intended FC-3 behaviour and identical to how an ACC-6 lock already behaves.

## 6. Tests

### `FiscalYearClosedPostingTest` (13 tests; "today" fixed at 2027-03-15, years 2026 and 2027)

1. Inclusive boundaries: 2026-01-01 / 06-15 / 12-31 rejected; 2025-12-31 and 2027-01-01 allowed.
2. Message names the year, its range and the correction path; exception is an `AccountingPeriodLockedException`.
3. Invoice post rejected → stays draft; no ICV / QR / XML / journal; next ICV contiguous.
4. Purchases, payments, expenses, manual journals rejected → drafts, ledger unchanged.
5. Sales returns and credit notes (API 422) dated inside the closed year rejected.
6. Open-period corrections: return / credit note dated today accepted; reversal dated today accepted; reversal dated 2026-12-20 rejected (ledger and `ManualJournalService`); 2026 P&L and balance sheet unchanged.
7. Close → reopen → backdated post → re-close: generation 2 includes the correction (`total_revenue` 125000); close entry and reversal dated 2026-12-31.
8. Period-lock independence: lock Jan–Jun of the closed year → `AccountingPeriodLockedException` (lock wins); September → `FiscalYearClosedException`; releasing the lock does not open the year; a lock in open 2027 still works.
9. Tenant isolation (tenant B's open 2026 unaffected) and branch coverage (branch X and untagged both blocked).
10. VAT report, Income Statement and readiness `vat_balances` unchanged after rejected backdating.
11. Manual-journal API → 422 with the closed-year message.
12. Readiness wording (`posting_blocked_after_close`, `year_not_ended`).
13. No bypass: `LedgerService` public surface still exactly `post` / `reverse`; guard public surface `assertOpen` / `activeLockFor` with unchanged parameters; no `Settings::` / `bypass` / `force` / `config(` in the comment-stripped guard; no `JournalEntry` / `JournalLine` `create` / `insert` outside `LedgerService` in `app/`.

### `FiscalYearClosedPostingPostgresTest` (2 tests, real `pcntl_fork` processes, PostgreSQL only)

| Race | Invariants per round (6 rounds) | Observed interleavings (3 local runs) |
|---|---|---|
| close ↔ post dated 2026-12-31 | no 40P01 / 55P03; close succeeds; post either accepted **and included in the active generation** (`generation.total_revenue` = ordinary 2026 revenue) or rejected with `FiscalYearClosedException`; books balanced per entry; a later post is rejected; reopen between rounds | accepted/rejected = 1/5, 1/5, 3/3 |
| reopen ↔ post dated 2026-01-01 | no 40P01 / 55P03; reopen succeeds; post either rejected (revenue unchanged) or accepted after reopen (revenue + amount); year `open`, no active generation; books balanced | accepted/rejected = 4/2, 6/0, 5/1 |

Mutation check: with the closed-year check removed from the guard, the close race fails (`Failed asserting that true is false` — the post after close was accepted), so the race test detects the defect it guards against.

### Results (local)

| Run | Result |
|---|---|
| SQLite `FiscalYearClosedPostingTest` | 13 passed (1703 assertions) |
| SQLite existing FiscalYear / PeriodLock / Ledger suites | 121 passed, 7 skipped (PG-only) |
| PostgreSQL `FiscalYearClosedPostingPostgresTest` | 2 passed (267–275 assertions) |
| PostgreSQL focused (`FiscalYear|FiscalClose|PeriodLock|AccountingDate|LedgerTest|VatRole|VatAdjustment|CreditNote|ReturnSource|Rem04|ManualJournal`) | 353 passed, 1 skipped (4562 assertions) |
| SQLite full suite | 6959 passed, 101 skipped, 26 failed — all 26 are the known Fuel tests needing `bcmath` (`bcmul`), absent locally and installed in CI |
| CI (sqlite + pgsql) and CI Gate on the final head | see PR |

## 7. Remaining risks

- **Closing a year before it ends** blocks postings dated today until the year ends or is reopened. Allowed by FISCAL-2 and now stated explicitly in readiness (`year_not_ended`); not changed here.
- **Source-dated operations** (POS variance at session close time, fuel documents) cannot be posted into a closed year without a reopen — intended.
- **No stored close snapshot.** Readiness is still recomputed live; it is now stable for a closed year because no new entry can be dated inside it, but a reopen + post + re-close changes it (a new generation, audited).
- FC-4 (AR/AP basis) and REM-28 (VAT return liability / filing readiness) remain open.
- Production data: NOT VERIFIED. Existing tenants with entries posted into a closed year before FC-3 keep them (no rewrite); the next reopen/re-close recomputes the generation from ledger truth.

## 8. Branch / PR / SHAs

- Branch: `feat/fc3-closed-fiscal-year-posting-guard`
- Base SHA: `90b854f53e4cdd35b8d9118873474387847cefe2` (`main`, ACC-02-FC merge)
- PR / Head SHA / CI: recorded in the PR.

## 9. Recommended next step

Owner review of the Draft PR. After an approved merge: FC-4 (AR/AP readiness basis) policy review, or REM-28 scoping.
