# FISCAL-1 — Fiscal Year Close Architecture Contract

**Status:** ARCHITECTURE READY FOR IMPLEMENTATION TASK PREPARATION — coding still requires explicit approval  
**Risk:** Critical financial statements + historical integrity  
**Audited baseline:** `6a49a956f19e91911662467d9cdf197ce0a295af`

## Confirmed facts
Financial reports read posted/reversed JournalLines directly. Income Statement uses revenue/expense account types. Balance Sheet is cumulative to date and currently adds unclosed net income to equity. Account 3120 is equity Retained Earnings; 3130 is Opening Balances and must not be used for annual close. Ledger reversal preserves original concrete accounts/dimensions.

## Critical reporting invariant
A close journal that zeros P&L on year end would make a naive historical Income Statement show zero. Also, after profit is transferred to Retained Earnings, adding historical net income again in Balance Sheet would double-count equity. Therefore close journals need durable classification and special report treatment.

## V1 structure — DECIDED
Use one CompanyWide `FiscalYear` entity, not monthly FiscalPeriod rows. Explicit inclusive start/end dates allow calendar or non-calendar fiscal years. Years cannot overlap. No branch_id.

Lifecycle: `OPEN -> CLOSING -> CLOSED -> REOPENING -> OPEN`. Transitional states are controlled by transaction/concurrency logic. Re-close after reopen is allowed.

## Closing method — DECIDED
Directly close every non-zero revenue/expense account into semantic role `retained_earnings`; no Income Summary account in V1. Profit credits Retained Earnings; loss debits it. Add `retained_earnings` to Account Routing with legacy default 3120 before implementation. Invalid explicit mapping fails closed.

## No annual carry-forward journal — DECIDED
Do not generate opening entries for assets/liabilities/equity. Permanent accounts already remain cumulative in the ledger. 3130 remains only for true opening/import/cutover balances.

## Close classification
Fiscal-close JournalEntry must be durably identifiable through source/model relationship, not description text or account code. It remains a real JournalEntry visible in Trial Balance/general ledger/audit.

## Report semantics — DECIDED
### Income Statement
Historical P&L excludes only Fiscal Close journals from presentation/calculation, so a closed year's original revenue, expenses and profit remain visible. Ordinary corrections/reversals remain included.

### Balance Sheet
Cumulative assets/liabilities/equity include all real journals including close entries. Synthetic `net_income` includes only unclosed P&L after the latest CLOSED fiscal-year end up to the requested date, excluding close journals. With no previous close, current cumulative behavior remains. Exactly at a closed year end, synthetic net_income = 0 because result is already in Retained Earnings.

### Trial Balance / General Ledger
Include close journals normally.

### Branch/cost-center reports
Close is company-wide. Do not invent branch Retained Earnings allocation. Historical branch/cost-center P&L is based on operational P&L and excludes fiscal-close lines where applicable.

## Dimensions / VAT
Generated close lines carry no Partner or Cost Center in V1. Fiscal close closes only Account.type revenue/expense. VAT asset/liability accounts are not closed by fiscal close; statutory tax periods remain separate.

## Close preconditions
FiscalYear OPEN; no overlap; valid retained-earnings account; no active close generation; serialized against ordinary posting; calculate from ledger truth; balanced integer minor-unit lines.

## ACC-6 interaction
Close must prevent concurrent posts without exposing a generic Ledger bypass. Under tenant accounting-control serialization: establish controlled closing state, calculate P&L, create close journal dated year end through an internal close-operation contract, mark CLOSED and activate/ensure accounting lock. Exact implementation must avoid circular 'locked date cannot receive close journal' logic without weakening ordinary guard behavior.

## Reopen — DECIDED
Permissioned, reason required. Under serialization, temporarily permit the controlled reopen operation, reverse the exact stored close journal using LedgerService original accounts, date that reversal at original fiscal-year end, mark prior generation reversed and year OPEN, and retain all journals/audit. This privileged historical operation is not available through ordinary reversal endpoints.

## Re-close
After reopen, corrections may post while year is open. Re-close recalculates from ledger truth and creates one new close generation. Row locks + tenant accounting serialization prevent duplicates.

## RBAC/audit
Prefer `fiscal_years.view`, `fiscal_years.manage`, `fiscal_years.close`, `fiscal_years.reopen`. Close/reopen are stronger permissions. Record actors/timestamps/reasons and close/reversal journal IDs/generation. No hard delete once accounting history exists.

## UI
Accounting Settings -> Fiscal Years: dense year list, create year, pre-close summary (revenue/expense/profit-loss/retained-earnings destination/warnings), strong close confirmation, closed journal metadata, reopen with reason. No fake monthly-close controls V1.

## Mandatory tests
- zero activity;
- profit and loss closes;
- P&L accounts zero in Trial Balance after close;
- historical Income Statement remains unchanged after close;
- Balance Sheet at closed year end: net_income zero, result in Retained Earnings, balanced;
- next-year activity adds only post-close net income;
- no prior close preserves current behavior;
- no balance-sheet carry-forward; 3130 untouched; VAT balances untouched;
- invalid retained-earnings mapping blocks close;
- mapping changes do not alter close/reversal;
- reopen restores exact historical P&L balances;
- correction + re-close creates one new active generation;
- concurrent close and concurrent ordinary post are safe;
- tenant isolation;
- branch/cost-center historical P&L unaffected by close lines;
- authorization/audit;
- ACC-6 interaction;
- SQLite + PostgreSQL financial/report suites.

## One bounded implementation choice
For a zero-activity year, either mark CLOSED with no journal or persist a close-generation record with null journal. Never create a zero-line JournalEntry. Freeze this choice in the implementation task before coding.

## Prohibited shortcuts
No Income Summary V1; no 3130 annual-close use; no balance-sheet carry-forward journals; no text-based close detection; no hiding close journals from Trial Balance/general ledger; no zeroing historical P&L presentation; no double-counting retained earnings + historical net income; no branch close V1; no edit/delete close journals; no generic Ledger bypass; no implementation/merge/deploy without explicit Safwan approval.

## Readiness
Architecture is resolved enough to prepare a dedicated implementation task. Before coding verify current-main ReportService, Account Routing `retained_earnings`, ACC-6 status, RBAC/audit conventions and freeze zero-activity persistence. No whole-project re-audit is required.