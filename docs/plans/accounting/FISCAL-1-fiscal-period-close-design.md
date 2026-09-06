# FISCAL-1 — Fiscal Year Close Architecture Contract

**Status:** ARCHITECTURE READY FOR IMPLEMENTATION TASK PREPARATION — coding still requires explicit approval  
**Risk:** Critical financial statements + Saudi compliance integrity  
**Audited baseline:** `6a49a956f19e91911662467d9cdf197ce0a295af`

## Confirmed facts
Financial reports read posted/reversed JournalLines directly. Income Statement uses revenue/expense account types. Balance Sheet is cumulative to date and currently adds unclosed net income to equity. Account 3120 is equity Retained Earnings; 3130 is Opening Balances and must not be used for annual close. Ledger reversal preserves original concrete accounts/dimensions.

## Critical reporting invariant
A close journal that zeros P&L on year end would make a naive historical Income Statement show zero. Also, after profit is transferred to Retained Earnings, adding historical net income again in Balance Sheet would double-count equity. Therefore close journals need durable classification and special report treatment.

## V1 structure — DECIDED
Use one CompanyWide `FiscalYear` entity, not monthly FiscalPeriod rows. Explicit inclusive start/end dates allow calendar or non-calendar fiscal years. Years cannot overlap. No branch_id.

Lifecycle: `OPEN -> CLOSING -> CLOSED -> REOPENING -> OPEN`. Re-close after reopen is allowed.

## Closing method — DECIDED
Directly close every non-zero revenue/expense account into semantic role `retained_earnings`; no Income Summary account in V1. Profit credits Retained Earnings; loss debits it. Add `retained_earnings` to Account Routing with legacy default 3120 before implementation. Invalid explicit mapping fails closed.

## No annual carry-forward journal — DECIDED
Do not generate opening entries for assets/liabilities/equity. Permanent accounts remain cumulative. 3130 remains only for true opening/import/cutover balances.

## Close classification and reports
Fiscal-close JournalEntry must be durably identifiable through source/model relationship, never description text/account code. It remains visible in Trial Balance/general ledger/audit.

Historical Income Statement excludes Fiscal Close journals so original P&L remains visible. Balance Sheet includes real close equity but synthetic net_income only covers unclosed P&L after the latest closed fiscal boundary. At a closed year end synthetic net_income=0. Branch/cost-center P&L uses operational lines and does not invent branch Retained Earnings allocation.

## Dimensions / VAT
Close lines carry no Partner or Cost Center V1. Fiscal close closes only Account.type revenue/expense. VAT asset/liability accounts and statutory VAT-return periods remain separate.

# Saudi Compliance Guardrails
Saudi compliance is a first-class constraint, separate from generic fiscal-close accounting.

## ZATCA/Fatoora invariants
- Fiscal close must never edit, delete, renumber or regenerate an already issued electronic invoice, credit note or debit note as a side effect.
- Corrections to issued electronic invoices remain through the legally appropriate electronic credit/debit-note workflow; fiscal reopen is not an invoice-edit mechanism.
- Fatoora invoice/note payloads, identifiers, hashes/security metadata, submission/clearance/reporting status and stored originals remain immutable according to their own lifecycle.
- Fiscal close/reopen must not silently change the tax period attribution of issued documents.
- VAT filing period (monthly/quarterly as applicable) is independent of AWJ FiscalYear and must not be inferred from fiscal-year boundaries.
- VAT-return amendment/correction remains a separate tax workflow; reopening an accounting year does not itself amend a return already submitted to ZATCA.
- Accounting/tax records and generated fiscal-close evidence must remain retainable/exportable for statutory record-retention requirements. No close/reopen hard deletion.
- Cloud/storage architecture must preserve compliant access to required Saudi tax records; deployment/data-residency compliance is handled by infrastructure policy, not by FiscalYear logic.

## Fiscal Close Readiness — severity model
Readiness returns `BLOCKER`, `WARNING`, and `INFO`. Only BLOCKER prevents close. Warnings require visibility/acknowledgement but must not invent Saudi legal prohibitions that do not exist.

### BLOCKER
1. Trial Balance is not balanced for the fiscal year / ledger integrity check fails.
2. Retained Earnings semantic mapping is missing/invalid/inactive/group/wrong tenant.
3. Another close/reopen is in progress or an active close generation already exists.
4. Fiscal year overlaps another year or dates are invalid.
5. Accounting-control/period-lock state cannot safely serialize close against concurrent postings.
6. Any issued accounting document is in an internally inconsistent state where its posted journal is missing/broken.
7. Any Fatoora document that AWJ itself marks as requiring a mandatory completion step before accounting finalization is in a failed/inconsistent state **only where current ZATCA integration contract proves that state must block**. Do not broadly block close merely because a historical ZATCA transmission has a recoverable operational warning.

### WARNING — acknowledgement required
1. Draft/unposted financial documents dated inside the year remain. They are not in the ledger and therefore are excluded from the close calculation; show counts/amounts where reliable.
2. Unposted manual journals dated inside the year.
3. Open AR/AP balances — normal balance-sheet items, not blockers.
4. Inventory quantity/value anomalies or pending stocktake issues detected by existing controls.
5. Unreconciled cash/bank items if AWJ has reliable reconciliation state by implementation time.
6. VAT/tax periods overlapping the fiscal year that are not marked filed/final in AWJ, if such authoritative status exists. Never claim ZATCA filing status from absence of local metadata.
7. Credit/debit notes or return workflows still draft/pending for events in the year.
8. Depreciation/payroll or other periodic processes appear incomplete based on authoritative AWJ module state.
9. Fatoora operational submission/clearance/reporting warnings that do not legally invalidate the underlying accounting close.

### INFO
1. Fiscal-year revenue, expense and calculated profit/loss.
2. Retained Earnings destination account.
3. Closing date and resulting Accounting Period Lock range.
4. Counts of posted invoices/purchases/payments/returns/notes/journals.
5. Open AR/AP totals.
6. VAT output/input balances and known local tax-period status, clearly labeled as accounting/local status rather than ZATCA portal truth unless integration proves otherwise.
7. Existing previous close/reopen generations and actors.

## Saudi correction boundary
A fiscal reopen allows accounting corrections in an opened accounting period but does not grant permission to mutate a tax invoice already issued. If correction affects an issued invoice, the domain workflow must use the proper credit/debit note or other ZATCA-compliant correction mechanism and then post the resulting accounting effect.

## Close preconditions / ACC-6 interaction
FiscalYear OPEN; valid mapping; no active generation; ledger truth; balanced minor-unit lines. Close must serialize against ordinary posting without generic Ledger bypass. Controlled internal close/reopen operations may coordinate with AccountingDateGuard, but no user/admin bypass flag is exposed.

## Reopen / re-close
Reopen is permissioned and reasoned. Reverse the exact stored close journal, retain history, reopen accounting control, allow compliant corrections, then re-close as a new generation. Reopen never rewrites issued Saudi tax documents or submitted VAT returns.

## RBAC/audit
Prefer `fiscal_years.view`, `fiscal_years.manage`, `fiscal_years.close`, `fiscal_years.reopen`. Record actors/timestamps/reasons and close/reversal journal IDs/generation. No hard delete once history exists.

## UI
Accounting Settings -> Fiscal Years includes a pre-close Readiness panel grouped into BLOCKERS / WARNINGS / INFO. Close button disabled only by blockers. Warnings require explicit acknowledgement. Saudi tax/Fatoora items must be labeled accurately and never imply that AWJ has confirmed ZATCA portal state unless it actually has authoritative integration data.

## Mandatory tests
- zero activity; profit/loss; historical P&L preserved; Balance Sheet no double-count; next-year unclosed income only;
- 3130/VAT balances untouched; no balance-sheet carry-forward;
- invalid retained earnings blocked; tenant isolation; concurrency; reopen/re-close;
- drafts produce warning not blocker;
- open AR/AP warning/info not blocker;
- ledger imbalance/integrity failure blocker;
- close/reopen does not mutate issued invoice/note identifiers, payload/security metadata or numbering;
- VAT return state is not silently changed by fiscal close/reopen;
- correction after reopen still requires invoice-domain credit/debit-note rules;
- readiness does not claim remote ZATCA status without authoritative data;
- Accounting Period Lock interaction;
- SQLite + PostgreSQL financial/report suites.

## Bounded implementation choice
Zero-activity year: prefer marking CLOSED without a zero-line JournalEntry, while persisting close lifecycle/audit state. Freeze exact schema in implementation task.

## Prohibited shortcuts
No Income Summary V1; no 3130 annual-close use; no balance-sheet carry-forward journals; no text-based close detection; no historical P&L zeroing; no net-income double count; no branch close V1; no edit/delete close journals; no generic Ledger bypass; no mutation of issued Fatoora documents; no pretending accounting reopen equals VAT-return amendment; no implementation/merge/deploy without explicit Safwan approval.

## Readiness
Architecture and Saudi guardrails are resolved enough to prepare a dedicated implementation task. Before coding verify current-main ReportService, Account Routing `retained_earnings`, ACC-6 status, current ZATCA integration state, RBAC/audit conventions and exact zero-activity persistence. No whole-project re-audit is required.