# IMP-H1-S6 — Zero-value inventory opening respects closed periods and fiscal years

> **STATUS: ON HOLD — owner decision D-13.** The independent review disagrees with the "enforcement of an existing rule" classification (evidence below). Per the master plan §4 this **must not merge** until the owner decides. The code is correct and low-risk; the question is scope.

**Branch:** `claude/imp-h1-s6-zero-value-guard` · accounting-adjacent: **enforces an existing rule, adds no new accounting behavior**

## Problem (verified in code)

`InventoryOpeningService::post()` moves stock via `InventoryService::applyReceipt()` and then calls `buildEntry()`. For a document whose total value is 0 (every line at zero cost, allowed per document with `allow_zero_cost`), `buildEntry()` returns `null` **before** `LedgerService::post()` — the only place `AccountingDateGuard::assertOpen()` runs (ACC-6 period lock, FC-3 closed fiscal year). So the stock movements and warehouse balances of a zero-value opening could be dated inside a locked period or a closed fiscal year.

## Change

One call: in `buildEntry()`'s zero-value branch, `AccountingDateGuard::assertOpen($opening->opening_date, …)` (constructor-injected). Same guard, same rule, **no tenant setting and no bypass** (as ACC-6/FC-3 define). A refusal throws `AccountingPeriodLockedException` / `FiscalYearClosedException` (422) and rolls back the whole post transaction — movements, balances, status — leaving the draft re-postable with an open date.

**Lock order (corrected after review):** for a *valued* opening the guard is reached where it always was (product locks → inventory-state locks → tenant anchor via `LedgerService::post`). For a *zero-value* opening the tenant-anchor lock is **new** (it never took the anchor before), so such documents are now exposed to the same anchor↔inventory-state ordering that the valued path already has relative to invoice posting (invoice: anchor → inventory-state; opening: inventory-state → anchor). The risk is low (openings are rare, one-off) and a deadlock would roll back cleanly with a retryable error, but it is not "no new lock".

## Classification — reviewer verdict: NEW-POLICY (scope extension), not pure enforcement

Independent read-only review (evidence verified in code):
- `AccountingDateGuard` documents itself as the guard for ledger entries ("كل أثر محاسبي يمرّ حصراً بـ`post()`/`reverse()`"; it "لا يعرف شيئاً عن المخزون"); FC-3 is defined as *ترحيل/عكس* of ledger entries. Its only callers are `LedgerService::post/reverse` (+ `FiscalCloseService` via `activeLockFor`). The existing rule therefore covers **ledger entries**, not stock movements.
- Sibling stock-only flows that also skip the ledger are **unguarded and stay so after this change**: `StockPermitService::buildEntry` (null for `total <= 0` and same-branch transfers), `StocktakeService::buildEntry` (null when the net is 0 — offsetting variances still move quantities), `InventoryService::applyReceipt/issue` (only date the movement). After this PR a zero-cost *opening* in a closed year is refused while a zero-cost *stock-permit receipt* in the same year is accepted — inconsistent.
- Locked/closed periods protect financial figures; a zero-value opening changes quantities. Refusing it is defensible (it protects quantity/valuation as of the closed date) but a zero-cost legacy migration into a closed year is also plausible, and FC-3 allows **no override** — a business-policy call (CLAUDE.md rule 6).

## Owner decision D-13 (open)

| Option | Effect |
|---|---|
| **A. Approve this PR as a deliberate, narrow extension** | Zero-value *openings* respect locked periods/closed years; permits and stocktake unchanged (documented inconsistency) |
| **B. Extend uniformly (recommended)** | One shared rule for every stock-posting path that can skip the ledger (opening, stock permits, stocktake), in a separate accounting-reviewed slice with its own tests; this PR is superseded or becomes its first step |
| **C. Reject** | Leave the current behavior: stock-only documents are not under the accounting date guard; record it as a known, accepted gap |

Rule 6 note: FC-3 is mandatory/no-setting by design; if the owner wants this to be optional per business (e.g. allow zero-cost legacy migration), it must be a configurable policy instead.

## Accounting entries

No journal entry is created or changed by this slice. A zero-value document still produces **no** entry by design (existing test `a_zero_value_document_moves_quantity_without_a_journal_entry`). The valued opening entry is unchanged: Dr 1140 inventory / Cr 3130 opening balances, one entry per document with per-branch line pairs.

## Safety

No migration, env, AI or ZATCA change. Behavior change is limited to: a zero-value opening dated in a locked period / closed fiscal year is now refused (previously silently accepted). Open dates behave exactly as before (tested).

## Tests — `InventoryOpeningZeroValueDateGuardTest` (4)

Locked period → refused, nothing written, draft remains; closed fiscal year → refused, nothing written; open date posts a zero-value document with no journal entry (existing behavior); valued document in a locked period refused as before. **Negative control:** removing the guard call fails the first two. Related suites (InventoryOpening|AccountingPeriodLock|FiscalYear|FiscalClose|Stocktake|StockPermit|ImportJobInventory): 314 passed, 10 skipped (PG-only). Full local suite and CI on the PR.
