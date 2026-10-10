# AWJ-TAX-REM-01 — Fix Return VAT Accuracy · Implementation Report

| | |
|---|---|
| **Task** | REM-01 from the audit/remediation plan in PR #1290 (closes **VAT-01** P0, **VAT-13** P2) |
| **Branch** | `fix/awj-tax-rem-01-return-vat-accuracy` |
| **PR** | [#1291](https://github.com/safwan5001-source/Nebrax/pull/1291) — open, ready for review, mergeable (clean) |
| **Base SHA** | `b3ff6654911b1fdda2ad4c938266271538a87122` (`origin/main`) |
| **Head SHA (code)** | `9175e7418eb20059fa1036a7285743a872af599a` (3 code commits: `fa91714`, `638582f`, `9175e74`). CI results below are for this SHA. Docs-only commits (this report) change no code. |
| **Status** | Implemented incl. the owner-approved mixed POS/API fix (§10). CI green on SQLite + PostgreSQL + web. **Not merged, not deployed.** |

---

## 1. Summary

Sales and purchase returns linked to a posted source no longer recompute VAT from the client's gross `unit_price`. They **inherit the charged net base and VAT of the source line** — after line discount and the line's share of the header discount, in the source's tax-inclusive / exclusive mode — and allocate by quantity so that **any split of a line, in any order, sums to the charged amount to the halala**. Cumulative net and VAT are capped per source line. Concurrent posts are serialized on the source row (PostgreSQL).

| Defect (probe) | Before | After |
|---|---|---|
| R2: 1 × 115.00 inclusive, full return | subtotal 115.00, VAT **17.25**, total **132.25** | 100.00 / **15.00** / **115.00** |
| R3: 100.00 with 10.00 header discount (VAT 13.50), full return | 115.00, VAT **15.00** | 90.00 / **13.50** / **103.50** |
| R1: 7 × 0.10 (VAT 0.11), seven 1-unit returns | Σ VAT **0.14**, Σ total 0.84 | Σ VAT **0.11**, Σ total **0.81** |
| Two concurrent full-quantity posts (PostgreSQL) | both succeed → double return | exactly one succeeds |

## 2. Design

* **Allocation rule.** For a return starting after `c` units already returned and returning `q`: `share = F(c+q) − F(c)`, with `F(n) = floor(charged · n / sold)` and `F(sold) = charged`. It is order-independent, telescopes to the exact total, and — because it is a function of quantities, not previously refunded amounts — a reduced-price refund earlier does not leak its retained amount into the last return.
* **Charged amounts per source line** (`ReturnSourceAllocator::charged`): net = line net − largest-remainder share of the header discount; VAT = goods VAT after header discount (the same `Σtax × net ÷ subtotal` formula `post()` uses), apportioned over lines by their stored VAT. Σ over lines equals the VAT/base the source posted (shipping/adjustment excluded — they are not line items).
* **Reduced-price refunds** (existing, tested behaviour) are preserved: a `unit_price` below the sale price scales net and VAT proportionally; above it is still rejected; client `tax_rate` is ignored for source-linked lines.
* **Re-derivation at post** (non-POS), inside the transaction and under `lockForUpdate` on the source row, from what is actually posted. Draft totals are therefore estimates until posted.
* **Cap:** `min(share, charged − already returned)` for net and VAT separately, so even historical (pre-fix) over-reversals cannot be exceeded further.
* **Lock order** `return → source → tenant numbering anchor (ledger)`, the document-row-before-ledger pattern (I did not audit every posting flow's lock order). POS returns are excluded from the source lock on purpose (they lock the branch row first; adding the source lock would invert the order against API posts) and are not re-derived.
* **Safety:** integer arithmetic only; `mulDiv` never lets an overflowing product silently become a float (throws instead).

## 3. Changed files (12, +1,975 / −29)

| File | Change |
|---|---|
| `app/Services/Accounting/ReturnSourceAllocator.php` | **new** — charged/returned/allocate, apportionment, overflow-safe math |
| `app/Services/Accounting/ReturnService.php` | derive at create; re-derive at post under source lock; inherit `tax_inclusive`; free-return inclusive split via `splitLineTax` |
| `app/Http/Controllers/Api/ReturnableController.php` | additive fields only |
| `app/Http/Requests/StoreReturnRequest.php` | optional `tax_inclusive` (free returns) |
| `app/Services/Reporting/ReturnVatDiscrepancyReport.php` | **new** — read-only historical report |
| `app/Console/Commands/ReportReturnVatDiscrepancies.php` | **new** — `returns:vat-discrepancies --tenant=<uuid> [--json]` |
| `web/src/components/returns/create-return-dialog.tsx` | preview mirrors the server; source tax rate read-only |
| `web/src/components/returns/source-line-amounts.ts` | **new** — preview math (BigInt) |
| `tests/Feature/ReturnSourceVatAccuracyTest.php` | **new** — 21 tests |
| `tests/Feature/ReturnSourceVatPostgresConcurrencyTest.php` | **new** — 3 tests (PostgreSQL, real forked processes) |
| `tests/Feature/ReturnVatDiscrepancyReportTest.php` | **new** — 3 tests |
| `web/src/components/returns/source-line-amounts.test.ts` | **new** — 5 vitest tests |

No migrations. No change to `LedgerService`, `InventoryService`, `InvoiceService`, `PurchaseService`, `PosReturnService`, credit notes, or any posted document.

## 4. Journal entries (shape unchanged; amounts now correct)

| Operation | Account | Debit | Credit |
|---|---|---:|---:|
| Sales return, 1 × 115.00 inclusive | 4110 Sales | 100.00 | |
| | 2120 Output VAT | 15.00 | |
| | 1130 Receivables | | 115.00 |
| Sales return, 100.00 with 10.00 header discount | 4110 Sales | 90.00 | |
| | 2120 Output VAT | 13.50 | |
| | 1130 Receivables | | 103.50 |
| Purchase return, 2 × 57.50 inclusive (service lines) | 2110 Payables | 115.00 | |
| | 5150 Purchase expense | | 100.00 |
| | 1150 Input VAT | | 15.00 |
| COGS reversal, tracked goods (unchanged) | 1140 Inventory | cost × qty | |
| | 5110 COGS | | cost × qty |

After every line of an invoice is returned, `2120` and `4110` net to exactly 0 (asserted).

## 5. Tests

**New regression coverage (requirement → test)**

| Requirement | Where |
|---|---|
| Inclusive / exclusive | accuracy: full inclusive, full exclusive, partial inclusive, purchase inclusive |
| Header + line discounts | header-discounted sale; multi-line inclusive with line + header discount; discounted purchase |
| Partial & repeated, rounding | 3 × 100.01 inclusive (3 splits); 7 × 0.10 (seven splits); **40 seeded random scenarios** (mixed rates 15/5/0, inclusive/exclusive, line/header discounts, random partitions and post orders): Σ returns = invoice net, VAT and total exactly |
| Return limits | over-quantity rejected; two drafts can't both post; historical over-reversal never exceeded; client `unit_price`/`tax_rate` tampering ignored |
| Concurrency (PostgreSQL) | 2 concurrent full posts → 1 wins; 3 concurrent 1-unit posts → Σ exact; purchase variant |
| Ledger / VAT | each entry balanced; whole ledger balanced; 2120 and 4110 net to zero |
| Inventory / COGS | tracked goods restocked, COGS reversal = qty × avg cost, independent of VAT |
| Tenant / branch | other tenant's invoice cannot be returned or listed (422 / 404); returns in other branches inherit source amounts and share the cumulative cap |
| API compatibility | `returnable` existing fields unchanged; new fields additive; reduced-price partial refund preserved |

**Evidence the tests bite**
* Against the original `ReturnService`: 17 of the 21 accuracy tests fail (the other 4 assert behaviour that must not change).
* Source-row lock disabled: all 3 PostgreSQL concurrency tests fail on 3/3 runs.

**Runs**
| Run | Result |
|---|---|
| Focused return/financial set, SQLite (final code) | 267 passed, 3 skipped |
| Focused return set, PostgreSQL 16 (local) | 166 passed |
| Full suite, local SQLite (sandbox harness) | 5,793 passed / 61 skipped / **124 failed** — all in unrelated classes (R2/storefront media, Fuel [`bcmath`], mail/invitation); same 124-failure signature the audit recorded for this harness on `main`; none in returns/ledger/VAT |
| **CI on head `638582f`** | **`php artisan test (L11, sqlite)` ✅ · `php artisan test (L11, pgsql)` ✅ · `web build (Next.js)` ✅** (both the push and PR runs) |
| Web | `vitest` 5/5; no type errors in touched files |

## 6. Review

Codex review: 1 finding (P2, historical report replay), **valid and fixed** in `638582f` with a regression assertion; thread replied and resolved. Codex then hit its usage limit (no further automated review). No other review comments.

## 7. Risks

1. **Posted amounts of *future* returns change** (that is the fix). Historical rows are not migrated. Run `returns:vat-discrepancies --tenant=<uuid>` for Finance review of past returns; any correction is a Finance decision with its own entries.
2. **Draft totals are estimates**: a draft is re-derived at post and can differ by a few halalas if other returns posted in between.
3. **Historical over-reversal on a line** makes the next return on that line smaller (down to 0 VAT) — conservative by design, never an over-refund.
4. ~~Mixed POS + API partial returns could leave 1–7 halalas stranded~~ — **fixed in `9175e74`** (§10). Residual risk: a reduced-price return earlier on a line intentionally keeps its hold-back (not refunded with the final part).
5. **Lock ordering**: follows the lock-the-document-then-post-to-ledger pattern; POS excluded to avoid inversion. A deadlock, if it ever occurred, is detected by PostgreSQL and aborts one transaction (no corruption), but I could not exhaustively enumerate every flow that locks an invoice.
6. **Behavioural change visible to API clients**: a source-linked return's `tax_rate` and `tax_inclusive` now come from the source, and a larger `unit_price` than the sale price was already rejected.

## 8. Remaining issues / out of scope (not done on purpose)

* **REM-02** credit notes (same root cause, VAT-02/ACC-06), **REM-18** e-invoicing of returns, other remediation tasks — untouched. Credit notes and returns do not yet share a cumulative cap on the same invoice.
* **Shipping / document adjustment** are not line items, so their VAT/amounts are not returnable through a line return (conservative).
* **POS returns on POS invoices with a header discount** are unchanged; POS invoices currently carry line discounts only.
* **Concurrent POS return vs API return on the same invoice** are not mutually serialized (pre-existing; POS posts take no source lock to keep lock order consistent). The cap clamp at post prevents any over-refund, but under that race the last halala could still be left for a follow-up return.
* **Pre-existing SQLite-only quirk found**: the local `return_documents (tenant_id, number)` branch-less unique index lost its `WHERE branch_id IS NULL` predicate after a table rebuild, so two branches cannot issue the same return number on SQLite (PostgreSQL is fine). Same class of defect as migrations 85/91/93 repair for invoices; my branch test passes explicit numbers to stay independent of it. Worth a separate small fix.
* This report was added to the PR in a final docs-only commit (CI re-runs on it; no code differs from `638582f`).

## 9. Recommended next step

1. Owner review of PR #1291 (focus: `ReturnSourceAllocator`, `ReturnService::deriveFromSource/rederiveSourceAmounts`, lock placement in `post()`).
2. On approval: merge, then run `returns:vat-discrepancies` per production tenant (read-only) and hand the output to Finance.
3. Proceed to **REM-02** (credit notes inherit the source VAT basis and are capped), which depends on this change and can reuse `ReturnSourceAllocator`.

**Stopped before merge. Owner approval requested.**

---

## 10. Addendum — mixed POS / API returns (owner-approved fix, `9175e74`)

**Finding.** POS returns round every part down independently and give the remainder to the *last* part; API returns use the cumulative share `F(c+q) − F(c)`. After partial POS returns, a final API return left base and VAT that no later return could recover.

| | |
|---|---|
| Smallest reproduction (real HTTP stack) | POS invoice 3 × 0.10 (VAT 0.05): POS 0.01 + POS 0.01 + API 0.02 = **0.04 returned**; `2120` kept **0.01** credit; invoice `fully_returned=true`, further returns refused |
| Simulation (≈430 k random mixed cases, 5 runs) | residual only when the **final** return is API; **never** an over-refund; max **net 5 / VAT 6 / total 7 halalas** per line, growing ≈ (k−1) with k prior POS partials |
| Direction | under-refund → output VAT over-declared and customer short-credited (conservative) |
| Required for reconciliation? | yes → fixed inside REM-01 (same defect class: full return must zero `2120`/`4110`) |

**Fix (smallest scope).** `ReturnSourceAllocator::allocate()`: the part that exhausts the remaining quantity **at full price** takes `max(0, charged − already returned)` for net, VAT and discount — unless an earlier return on that line used a **reduced price** (the hold-back stays held), in which case the cumulative share is used as before. `returned()` exposes `MIN(unit_price)` to detect that; `deriveFromSource()` carries it for in-request items; the `returnable` endpoint adds `reduced_price_returned`; the web preview mirrors the rule. Amounts are never negative and never exceed the charged net / VAT (explicit clamps). **POS code path unchanged**; no migration; no accounting-rule change.

Also fixed while verifying: the historical report now counts POS returns as priors (not judged), so it no longer flags the API return that follows a POS partial.

**Reference numbers (3 × 0.10, POS → POS → API):** returns net 0.10/0.10/0.10, VAT 0.01/0.01/**0.03** → Σ net 0.30, VAT **0.05**, total **0.35** = invoice; `2120` = 0, `4110` = 0, books balanced.

**New permanent tests**
| Test | What it proves |
|---|---|
| `ReturnPosApiMixedReturnsTest` (9, real POS HTTP flow) | POS→POS→API (3×0.10); POS→API→POS; inclusive 4×1.00 with line discount (POS,POS,API,API); exclusive 5×1.01 with discount (POS,API,POS,API); reduced-price hold-back not refunded with the final part (net 25,000 / VAT 3,750 of 30,000 / 4,500, hold-back exactly 5,000 / 750); tracked-goods inventory + COGS return exactly to their starting balances; 60 seeded random sequences using the real `PosReturnService` derivation rules (Σ = invoice net/VAT/total, no prefix ever exceeds, `2120`/`4110` = 0, books balanced); 30 sequences containing a reduced-price return (never exceed, never negative); over-return refused; historical report reports no false positives |
| `ReturnSourceVatPostgresConcurrencyTest` (+1, now 4, PostgreSQL) | POS-style partials followed by two **concurrent** API posts: all succeed, Σ net 40 / VAT 6 / total 46 exactly |
| `source-line-amounts.test.ts` (7, +2) | web preview mirrors the final-part and reduced-price rules |

**Evidence the tests bite.** Against the pre-fix allocator: 6 of the 9 mixed tests fail (the other 3 are deliberate regression guards: POS-final path, no-exceed bounds, exhausted-return refusal); the new PostgreSQL concurrency test fails; with the fix: all pass. Simulation with the fix: **0 residual / 0 over-refund** on ≈180 k mixed cases (≤ 9 and ≤ 40 units).

**Runs on the final code**
| Run | Result |
|---|---|
| Related set, SQLite (returns, POS returns/exchange/checkout, credit/debit notes, customer/supplier refunds, conversions, ledger, invoice, purchase, report) | **396 passed, 4 skipped, 0 failed** |
| Same set, PostgreSQL 16 (local) | 395 passed; the 5 `ApiInvoiceTest` failures were a *migration DDL deadlock between harness sessions* — class re-run alone: **9/9 pass** |
| PostgreSQL concurrency classes | 4/4 pass |
| **CI on `9175e74`** | `sqlite` ✅ · `pgsql` ✅ · `web build` ✅ (push and PR runs; full suites) |
| Web | vitest 7/7; no type errors in touched files |

**Local-environment notes (not code defects).** Under broad `--filter` runs the sandbox's known-failing harness classes (Fuel/`bcmath`, R2, storefront media) leave a reference-number sequence transaction open, making a later `registerTenant()` wait; this does not occur in CI. Not caused by this PR.

**Not changed:** POS return path, credit notes (REM-02), ledger / inventory engines, any migration.

**Status:** the mixed-return finding is closed; I am not aware of any remaining item that prevents full financial reconciliation after full-quantity returns at the original value.

**Stopped before merge. Owner approval requested.**
