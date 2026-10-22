# IMP-H1-S6 — Zero-value inventory opening respects closed periods and fiscal years

**Branch:** `claude/imp-h1-s6-zero-value-guard` · accounting-adjacent: **enforces an existing rule, adds no new accounting behavior**

## Problem (verified in code)

`InventoryOpeningService::post()` moves stock via `InventoryService::applyReceipt()` and then calls `buildEntry()`. For a document whose total value is 0 (every line at zero cost, allowed per document with `allow_zero_cost`), `buildEntry()` returns `null` **before** `LedgerService::post()` — the only place `AccountingDateGuard::assertOpen()` runs (ACC-6 period lock, FC-3 closed fiscal year). So the stock movements and warehouse balances of a zero-value opening could be dated inside a locked period or a closed fiscal year.

## Change

One call: in `buildEntry()`'s zero-value branch, `AccountingDateGuard::assertOpen($opening->opening_date, …)` (constructor-injected). Same guard, same rule, **no tenant setting and no bypass** (as ACC-6/FC-3 define). A refusal throws `AccountingPeriodLockedException` / `FiscalYearClosedException` (422) and rolls back the whole post transaction — movements, balances, status — leaving the draft re-postable with an open date.

**Lock order unchanged:** the call comes after the product row locks, exactly where the valued path reaches the guard (products → tenant anchor via `LedgerService::post`); no new inversion.

**Classification check (master §4):** this enforces the existing FC-3/ACC-6 rule and does not change it. The valued path already rejects such dates (tested for parity); the zero-value path is made consistent. If a reviewer disagrees that stock movements without a ledger entry belong under the accounting date guard, this must go to the owner and **must not merge** (see PR).

## Accounting entries

No journal entry is created or changed by this slice. A zero-value document still produces **no** entry by design (existing test `a_zero_value_document_moves_quantity_without_a_journal_entry`). The valued opening entry is unchanged: Dr 1140 inventory / Cr 3130 opening balances, one entry per document with per-branch line pairs.

## Safety

No migration, env, AI or ZATCA change. Behavior change is limited to: a zero-value opening dated in a locked period / closed fiscal year is now refused (previously silently accepted). Open dates behave exactly as before (tested).

## Tests — `InventoryOpeningZeroValueDateGuardTest` (4)

Locked period → refused, nothing written, draft remains; closed fiscal year → refused, nothing written; open date posts a zero-value document with no journal entry (existing behavior); valued document in a locked period refused as before. **Negative control:** removing the guard call fails the first two. Related suites (InventoryOpening|AccountingPeriodLock|FiscalYear|FiscalClose|Stocktake|StockPermit|ImportJobInventory): 314 passed, 10 skipped (PG-only). Full local suite and CI on the PR.
