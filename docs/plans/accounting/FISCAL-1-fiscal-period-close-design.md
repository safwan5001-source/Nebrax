# FISCAL-1 — Fiscal Period / Year Close Design Gate

**Status:** ACCOUNTING DESIGN REQUIRED — NOT READY FOR IMPLEMENTATION  
**Risk:** Critical financial statements + historical integrity.  
**Implementation / Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Define AWJ's fiscal year/period lifecycle and closing accounting before any schema or code is written.

## Not the same as date lock
Closing may create accounting entries and lifecycle state. Date locks only prohibit transactions. A closed fiscal period may imply a lock, but one must not be implemented as an alias for the other.

## Accounting decisions required
1. Fiscal Year entity vs generic Fiscal Period entity hierarchy.
2. Allowed fiscal-year start/month and period granularity.
3. P&L closing method:
   - direct close revenue/expense to retained earnings, or
   - Income Summary intermediate account.
4. Retained earnings role/account contract (current chart contains 3120 but that alone is not design approval).
5. Opening balance carry-forward model for balance-sheet accounts.
6. Treatment of new accounts created during year.
7. whether sub-period close creates entries or only year close does.
8. branch/company-wide close semantics.
9. cost-center/Partner dimensions on generated closing entries.
10. tax/VAT accounts and statutory periods interaction.
11. close idempotency and concurrency.
12. reopen: reverse generated close entries vs mark state and regenerate.
13. re-close after reopened transactions.
14. lock interaction.
15. reporting across open/closed years.
16. document numbering and generated journal references.
17. audit/permissions/approval workflow.

## Historical integrity principles
- Generated close journals are explicit, traceable accounting documents.
- Reopen must never edit posted historical journal lines in place.
- Re-close must be deterministic and protected from duplicate closing entries.
- Mapping changes after close must not mutate prior close entries.
- Never infer fiscal close merely from retained-earnings account existence.

## Required repository audit before design approval
Inspect exact current behavior for:
- account type/normal balance and report classification;
- JournalEntry reversal/reference/idempotency conventions;
- retained earnings 3120 seed/name/use;
- opening balances 3130 and other opening flows;
- branches and CompanyWide semantics;
- trial balance/P&L/balance sheet report date filtering;
- tax reports/date periods;
- manual journal restrictions;
- audit/event conventions.

## Candidate lifecycle (NOT APPROVED)
`OPEN -> CLOSING -> CLOSED -> REOPENED -> CLOSED`

This is only a discussion scaffold. Exact states and transitions require accounting review.

## Mandatory implementation tests once approved
- zero-activity year.
- revenue-only/expense-only/profit/loss cases.
- assets/liabilities/equity carry forward.
- multi-branch if applicable.
- cost centers/Partners.
- new accounts mid-year.
- concurrent close attempts.
- idempotent retry.
- reopen/re-close.
- mapping change after close.
- locked period interaction.
- report equivalence before/after close where appropriate.
- SQLite/PostgreSQL.

## Stop condition
No fiscal schema, close service or generated close journal may be implemented until all accounting decisions above are explicitly documented and approved.