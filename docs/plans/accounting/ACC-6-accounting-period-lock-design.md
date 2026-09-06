# ACC-6 — Accounting Period Lock Architecture Contract

**Status:** ARCHITECTURE READY — implementation still requires explicit approval  
**Risk:** Critical accounting control  
**Audited baseline:** `6a49a956f19e91911662467d9cdf197ce0a295af`  
**Implementation / Merge / Deploy:** NOT authorized by this document alone.

## Objective
Provide a server-enforced Accounting Date Lock that prevents new accounting effects from being posted or reversed into locked dates. It creates no closing journals and is not a fiscal close.

## Confirmed repository findings
- Valid accounting writes converge on `LedgerService::post()`; correction converges on `LedgerService::reverse()`.
- Ledger accepts explicit `entry_date`, defaulting to today; reversal accepts an explicit reversal date, also defaulting to today.
- Posting callers use domain accounting dates such as acquisition, expense, payment, return, stocktake, note, payroll period end and manual-journal entry dates.
- Manual Journal drafts can be created/edited without ledger effect; posting creates the immutable JournalEntry.
- Reports use JournalEntry.entry_date.
- Branch is a JournalLine dimension; one balanced JournalEntry may contain multiple branches or intentional null/company-wide lines.

## Core architecture — DECIDED
Introduce a dedicated `AccountingDateGuard` / `AccountingPeriodPolicy` as policy owner and invoke it from LedgerService as the final defense-in-depth gate. Ledger remains unaware of invoice/purchase semantics; it asks only whether the proposed accounting date is open for the tenant.

Before `post()`, guard the final entry_date. Before `reverse()`, guard the proposed reversal date. No service may evade this through direct journal-table writes.

## Scope — DECIDED: company-wide V1
V1 locks are tenant/company-wide, not branch-specific. A single journal may contain mixed branch lines, so branch locking could make one balanced journal partially locked. No branch_id on V1 lock.

## Authoritative date — DECIDED
The authoritative date is `JournalEntry.entry_date`, because it controls ledger/report period. Domain services continue deriving it from their correct document date; Ledger guards the final value.

## Drafts — DECIDED
Draft creation/edit/duplicate/delete is allowed even if intended date is locked because no accounting effect exists. Posting that draft into the locked date is blocked. A draft may be moved to an open date subject to domain validation.

## Posted history — DECIDED
Posted journals remain immutable. Locking introduces no edit/delete path.

## Reversal — DECIDED
Reversal is a new accounting event and must use an open reversal date. The original locked date does not prohibit a correction posted into an open date. Never silently backdate reversal into a lock. LedgerService::reverse continues copying original concrete accounts and dimensions.

## Override — DECIDED: none per transaction in V1
No administrator bypass flag on an individual post/reversal. To intentionally post into a locked range, an authorized user must explicitly release/change the lock with reason/audit, perform the operation, then re-lock if appropriate. A future exception workflow needs separate design approval.

## Model concept
CompanyWide tenant data with UUID, tenant_id, start_date, end_date, status active/released (or equivalent), reason, created_by, released_by/released_at/release_reason and timestamps. Retain released locks; no normal hard delete.

## Range rules — DECIDED
- start and end required;
- inclusive boundaries;
- start <= end;
- active ranges cannot overlap within tenant;
- adjacent ranges allowed;
- no open-ended V1 range.

## Date/time — DECIDED
Locks compare accounting dates (`Y-m-d`), not timestamps. Never UTC-convert an explicit accounting date in a way that shifts its calendar day. Implementation must verify AWJ effective timezone before tests relying on implicit `today`.

## Concurrency requirement
A check-then-post race must not allow posting while the same date range is concurrently being locked. Implementation must serialize lock activation/release and final Ledger guard check on a stable tenant-level DB anchor. Exact anchor must be verified against current-main tenancy/settings rows and PostgreSQL/SQLite behavior; do not use process memory/cache.

## RBAC/API concept
Prefer dedicated `accounting_period_locks.view` and `accounting_period_locks.manage`, unless current-main RBAC has intentionally consolidated these controls by implementation time. API supports list/create/release; no hard-delete. Prefer release + replacement rather than editing an active range in place.

## UI contract
Accounting Settings -> Accounting Period Locks: dense table of active/released ranges, reason, actor/timestamps; create; release with mandatory reason; clear notice that drafts remain editable while posting/reversal is blocked. No fake override toggle.

## Posting-path coverage requirement
Ledger defense-in-depth protects compliant accounting, inventory, payroll, assets, cash/bank, returns, notes, POS exchange, fuel and future callers. Immediately before implementation search current main for direct `JournalEntry::create`, `JournalLine::create`, raw journal-table writes, all Ledger post/reverse calls and queue/import/background posting. Any unauthorized direct financial writer is a blocker.

## Fiscal-close interaction
Fiscal close remains separate. If future close creates a journal dated at period end, orchestration should validate/close while date is open, create the closing journal, then activate final lock under serialization. Do not add a hidden Ledger bypass flag.

## Mandatory tests
- before/start/inside/end/after boundaries;
- explicit locked post blocked;
- implicit today blocked when locked;
- reversal into locked date blocked;
- old locked original reversed into open date allowed;
- Manual Journal draft operations allowed but post blocked;
- representative Invoice/Purchase/Payment/Inventory/Payroll/Asset paths blocked;
- POS/fuel/import/background protected by Ledger gate;
- all branches/mixed-branch lines blocked by company-wide lock;
- tenant isolation;
- overlap rejected, adjacency allowed;
- release requires permission/reason and restores posting;
- no hard-delete route;
- concurrent lock creation vs post cannot leak a journal;
- reports/history unaffected;
- SQLite + PostgreSQL.

## Prohibited shortcuts
No frontend-only lock; no branch-specific V1 lock; no per-transaction bypass; no direct journal write; no changing posted entry_date; no silent date shifting; no treating lock as fiscal close; no implementation/merge/deploy without explicit Safwan approval.

## Readiness
V1 accounting-policy decisions are resolved. Before coding only narrow current-main checks remain: posting-writer inventory, effective timezone, and safe tenant-level concurrency anchor. These are implementation-baseline checks, not unresolved accounting policy.