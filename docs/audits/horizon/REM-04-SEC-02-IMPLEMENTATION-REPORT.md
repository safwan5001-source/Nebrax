# REM-04 / SEC-02 — Implementation Report: PostgreSQL deadlock in concurrent invoice posting

STATUS: **PASS locally (pending CI on the final head and owner review)** — **DRAFT PR — NOT MERGED — NOT DEPLOYED**
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: TAX-HZ-00 → REM-04)
ZONE: C — accounting / concurrency

## Executive summary

| | |
|---|---|
| Verdict | **PASS locally.** The deadlock was **reproduced deterministically on unmodified `main`** (real services, real PostgreSQL sessions, barrier verified through `pg_stat_activity`) and is **gone** with a one-statement lock-order fix. |
| Fix | `InvoiceService::assertWithinCreditLimit()` takes the **tenant anchor immediately before** the partner row lock → single order **invoice → tenant anchor → partner**. No retry, no API/error-envelope change, no schema change, no accounting/VAT/credit-limit rule change. |
| STOP conditions | None triggered (review below). |
| Honest limits | The local **full** suites could not be completed in this sandbox (see *Full-suite status*); the CI legs on the exact head are the authoritative full runs. |

## Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36` (`origin/main` at start; contains REM-03, REM-03b, REM-08, REM-37, TAX-N01) |
| Branch | `fix/accounting/rem04-invoice-post-lock-order` |
| PR | recorded in the PR and the hand-back message (**Draft**) |
| Code + test head | `43b6b4866638a72b53a4996457c91c4be757584b` (+ docs commit `361f0a2a935492d4717ee880a44f86b8abcaab83`) |
| Final Head SHA | recorded in the PR and the hand-back message (a file cannot contain its own commit hash); it adds only this report |
| Merge SHA | N/A |

## Original defect

`InvoiceService::post()` for an **unpaid credit invoice** locked, in this order: the invoice row → the **partner row `FOR UPDATE`** (credit-limit check) → the **tenant row `FOR UPDATE`** (`LedgerService` → `AccountingDateGuard::lockAnchor`).

Any transaction that holds the tenant row and then **inserts a row with a foreign key to the same partner** takes the opposite order: PostgreSQL implicitly runs `SELECT 1 FROM ONLY partners x WHERE id = $1 FOR KEY SHARE OF x` for the FK check, and `FOR KEY SHARE` conflicts with `FOR UPDATE`. Two real production paths do this:

1. `PaymentService::create` **without an active branch** — `Payment` is branch-numbered, so with no branch context its numbering anchor falls back to the **tenant row**; then `INSERT payments (partner_id …)`.
2. `settle()` inside the post of a **paid credit invoice** — the ledger takes the tenant row, then `settle()` creates a payment (FK to the partner). This deadlocks against an *unpaid* credit invoice of the same customer with **no separate payment document at all**.

PostgreSQL aborts one side with **SQLSTATE 40P01**; the API surfaces it as a 500 (`QueryException` is a `PDOException`).

## Lock-order map (verified, not inferred)

Lock statements captured from real HTTP flows on PostgreSQL (active branch set, as in production) plus the code paths above.

### Before the fix

| Flow | Lock 1 | Lock 2 | Lock 3 | Notes |
|---|---|---|---|---|
| `invoice.post` — credit, unpaid | `invoices` (FOR UPDATE) | **`partners` (FOR UPDATE)** | **`tenants` (FOR UPDATE)** | tenant row re-taken (re-entrant) by JE numbering (`JournalEntry` is `CompanyWide` → tenant) and ICV |
| `invoice.post` — credit, **paid** | `invoices` | `tenants` (ledger) | → `settle()` → `payments` INSERT ⇒ **`partners` FOR KEY SHARE** | no partner `FOR UPDATE`; FK share lock *after* the anchor |
| `invoice.post` — cash | `invoices` | `accounts` (cash) | `tenants` | unchanged |
| `payment.create` — active branch (HTTP) | `accounts` | `branches` (numbering anchor) | INSERT `payments` ⇒ `partners` FOR KEY SHARE | never requests `tenants` ⇒ not part of the cycle |
| `payment.create` — **no active branch** | (`accounts`) | **`tenants`** (numbering anchor) | INSERT `payments` ⇒ **`partners` FOR KEY SHARE** | the inverted order |
| `payment.post` (HTTP) | `payments` | `invoices` (targets) | `accounts` | then `tenants` |

Only `InvoiceService` ever locks a `partners` row `FOR UPDATE` (searched); the other hit is `corporate_fuel_credit_locks`, a different table.

### After the fix

| Flow | Lock 1 | Lock 2 | Lock 3 |
|---|---|---|---|
| `invoice.post` — credit, unpaid | `invoices` | **`tenants`** | **`partners`** (tenant re-entrant afterwards) |
| every other flow | unchanged | unchanged | unchanged |

A `partners … FOR UPDATE` is now only ever requested while the tenant row is already held, so it cannot form a cycle with any holder-of-tenant-then-partner path: that holder would have to be the same transaction.

## Reproduction

Test: `tests/Feature/Rem04InvoicePostConcurrencyPostgresTest.php` (real services, `pcntl_fork`, one PostgreSQL session per participant).

**Deterministic barrier (no `sleep` dependence).** A raw third session (`blocker`) holds the contended row `FOR UPDATE`. The parent starts A, waits until `pg_stat_activity.wait_event_type = 'Lock'` for A, starts B, waits until B is also in a lock wait, and only then releases the blocker. What happens next is exactly the code's own lock order. The parent drops its Laravel connection before every fork (a live inherited connection shares the socket and corrupts the session) and children end with `SIGKILL` so no inherited-connection destructor can terminate another session.

Scenario 1 — **A** `InvoiceService::post(D1)` (unpaid credit) vs **B** `PaymentService::create(receipt)` (no active branch):

| Step | Session | Statement / resource |
|---|---|---|
| 0 | blocker C | `BEGIN; SELECT … FROM partners WHERE id = P FOR UPDATE` |
| 1 | A | `BEGIN`; `invoices … FOR UPDATE` ✓; `partners P FOR UPDATE` → **waits on C** |
| 2 | B | `BEGIN`; `tenants T FOR UPDATE` ✓ (numbering anchor); `INSERT payments (partner_id = P)` → FK check **`FOR KEY SHARE` on P → waits** |
| 3 | C | `COMMIT` → A (first in the partner queue) gets P |
| 4 | A | `tenants T FOR UPDATE` (ledger) → **waits on B** |
| 5 | B | still waiting for P (held by A) → **cycle** |
| 6 | PostgreSQL | after `deadlock_timeout` (1 s) aborts B: **`SQLSTATE[40P01] deadlock detected`** |

PostgreSQL's own report (identifiers shortened): `Process B waits for ShareLock on transaction X; blocked by process A. Process A waits for ShareLock on transaction Y; blocked by process B. CONTEXT: while locking tuple in relation "partners" — SQL statement "SELECT 1 FROM ONLY "public"."partners" x WHERE "id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE OF x"`; server log: `Process B: insert into "payments" (…)` ⟷ `Process A: select * from "tenants" where "tenants"."id" = $1 … limit 1 for update`. **Victim: the payment insert (its FK check).** No customer/payment data is recorded here.

Scenario 2 — **A** unpaid credit invoice post vs **B** *paid* credit invoice post (`is_paid`, `settle()`): the same cycle, victim = `settle()`'s `insert into "payments"` → `Illuminate\Database\DeadlockException` (SQLSTATE 40P01). No standalone payment involved.

Scenario 3 — repeated interleavings: deadlock on iteration 0 before the fix.

## Root cause

Inverted lock order between *partner row* and *tenant anchor*: the credit-limit check locks the partner **before** the ledger asks for the anchor, while any FK-to-partner insert made under the anchor locks the partner **after** it.

## Chosen fix

```php
// InvoiceService::assertWithinCreditLimit(), after the cash / already-paid early returns:
Tenant::whereKey($invoice->tenant_id)->lockForUpdate()->first(['id']);   // NEW
$partner = BranchScope::reference(Partner::class)->lockForUpdate()->find($invoice->partner_id);
```

Why this and not something else:

- **Same convention, no new one.** `SourceInvoiceLock` already documents the global order *invoice → branch → tenant* (REM-02); its docblock now extends it with the partner row (*… → tenant → partner*), comment only.
- **Smallest change.** One statement in the only method that locks a partner. The anchor was already taken later by `LedgerService` (re-entrant inside the transaction), so **what** is locked is unchanged — only **when**. Cash and already-paid invoices take the early returns and keep their exact lock sequence.
- **Why not a retry?** There is no canonical deadlock-retry convention in the repo; the order can be corrected; a retry would also hide persistent order defects. None added.
- **Why not drop the partner lock?** It serialises same-customer credit checks; removing it needs a proof that was not required (STOP 9). It is kept.
- **Tenant-wide serialisation window.** Credit-invoice posts already serialised tenant-wide on the anchor; the window now starts earlier (it additionally covers the two `SUM` queries of the credit check). See *Risks*.

## Accounting invariants

Asserted after each concurrent scenario (and under repetition): the invoice is `posted` exactly once; **exactly one** `journal_entries` row per posted invoice (`source_type`/`source_id`); the entry's debit equals the invoice total; VAT equals the service's integer rounding of the line subtotal; every journal entry of the tenant is balanced (Σ debit = Σ credit); every `account_balances` row equals the sum of its posted lines; ICVs are unique and contiguous; exactly one payment exists for the payment scenario; the paid scenario produces exactly one posted settlement payment and `payment_status = paid`. No formula, account selection, rounding, numbering or document-status code changed (diff is one statement + comments).

## Credit-limit behaviour

Rule and formula unchanged (`outstanding + total > limit` ⇒ reject; same inputs). The receivable balance is now read **under the tenant anchor**, so the decision equals a serial execution in the order the anchor is won.

| Case (limit 1000.00; outstanding 690.00; new invoice 690.00; payment 400.00 on the posted invoice) | Anchor winner | Decision |
|---|---|---|
| Payment post first | payment | payment commits → balance 290.00 → **invoice accepted** |
| Invoice post first | invoice | balance 690.00 + 690.00 > 1000.00 → **invoice rejected**, no journal, stays `draft` |

Both are covered by tests (6) and (7), and both are the serial outcomes. **Before the fix** the credit read happened before the anchor was contested, so the decision did not depend on who won it (a concurrent payment that committed first could be missed → a false rejection). The fix can only *remove* such false rejections; it cannot admit an over-limit invoice. This is a snapshot-timing consequence of the lock order, not a policy fork; flagged for transparency.

## Tenant and branch isolation

- The new lock is keyed by `$invoice->tenant_id` (explicit); `Tenant` is the root model (not tenant-scoped), as in `AccountingDateGuard` and `ZatcaService`. No `withoutGlobalScope(TenantScope)` introduced. The partner lookup is unchanged (`BranchScope::reference`).
- Isolation test (5): another tenant's anchor row held by a blocker does **not** make this tenant's post wait (it finishes without ever entering a lock wait) and posts exactly once.
- Branch rules are untouched; a credit invoice never requests a `branches` row after the partner (verified by the captured lock sequence), which is why branch-numbered payment creation is not part of the cycle.

## PostgreSQL results

PostgreSQL 16 with CI settings (role `nibras`, `max_locks_per_transaction=1024`, `deadlock_timeout=1s`).

| Command | Result |
|---|---|
| `--filter=Rem04InvoicePostConcurrencyPostgresTest` (fixed) | **7 passed** (165 assertions) |
| same, `REM04_ITERATIONS=25` (bounded repeat) | passed (255 assertions) |
| existing concurrency + REM classes¹ | **126 passed** (1544 assertions), no skips |
| full parallel suite, `--parallel --processes=4` (see below) | 6786 / 6811 tests completed; all 7 REM-04 tests green inside it |

¹ `AccountingPeriodLockConcurrency|CreditNotePosLockOrder|CreditNoteSourcePostgres|FiscalYearConcurrency|InventoryStatePostgres|ReturnSourceVatPostgres|StocktakeConcurrency|Rem04|Rem03|Rem37|Rem08` — REM-01/02 (`ReturnSourceVat…`, `CreditNote…`) included.

Tests: (1) invoice post × tenant-anchored payment create · (2) unpaid × paid credit invoice post · (3) repeated interleavings · (4) lock order from the query log (`invoices → tenants → partners`) · (5) tenant isolation · (6, 7) credit-limit decision by anchor winner (both orders).

## Negative control

Scratch copy only (`nibras-app`); the PR branch was never modified; the old `InvoiceService` was dropped in, tests run, file restored and re-verified.

| Test | Pre-fix result |
|---|---|
| unpaid credit post × tenant-anchored payment create | **FAIL — `40P01`** (victim: payment insert) |
| unpaid × paid credit invoice post | **FAIL — `DeadlockException` / `40P01`** (victim: settlement payment insert) |
| repeated interleavings | **FAIL — `40P01` on iteration 0** |
| declared lock order | **FAIL** (observed `invoices → partners → tenants`) |
| credit decision, payment first | **FAIL** (invoice rejected before the anchor race; B exited instead of queuing) |
| credit decision, invoice first | **FAIL** (same cause) |
| another tenant's anchor never blocks | pass (a guard against the fix over-locking) |

Pre-fix: **6 failed, 1 passed**. Post-fix: **7 passed**.

## SQLite

SQLite cannot validate PostgreSQL deadlock behaviour and is **not** claimed to. Regression only:

| Command | Result |
|---|---|
| focused accounting regression² | **772 passed, 21 skipped, 12 failed** (907 s) — all 12 failures are in the known sandbox baseline (fuel `bcmath`/attachment tests); none new |

² `Invoice|Payment|Ledger|Credit|Rem0|Rem37|ZatcaSubmission|Settle|PartnerStatement|CashSale|ApiRbac|TenantIsolation` — includes REM-03/03b invoice authorisation, credit-limit and payment suites. The 7 REM-04 tests skip on SQLite by design.

## Full-suite status (honest)

- **Full parallel PostgreSQL (local):** 6786 of 6811 tests completed; two workers then hung inside a tenant-registration path (`tenant_reference_number_sequences … FOR UPDATE` held by an idle-in-transaction session of the *same* worker) that this change does not touch, so the run could not finish and was killed. Among what completed: 124 real failures/errors in 21 classes — 20 are classes of the known sandbox baseline with **no class exceeding its baseline count**; the 21st is `CreditNoteSourcePostgresTest::the_restrict_rule_rolls_back_to_set_null_and_forward_again` (PostgreSQL-only, not in the SQLite baseline), which **passes** when run alone (sequential and `--parallel`), **with and without** this change — cross-test interference in the shared parallel database, not caused by REM-04. Root cause of the hang not established.
- **Full SQLite (local):** not completed: a first run was invalidated when I ran a second test process against the same SQLite file, and the sandbox showed a separate unexplained 10–30× per-test slowdown. The focused SQLite regression above is the local evidence.
- **Authoritative:** the CI `sqlite` and `pgsql` legs on the exact final head run both full suites (see *CI*).

## Side effects

Verified in the concurrent tests: one journal entry per posted invoice and none for a rejected one; no duplicate payment; balanced entries; `account_balances` = Σ lines; contiguous unique ICVs (no ZATCA field, ICV or PIH logic touched); no stock movement (service product); a deadlocked or rejected transaction leaves no partial state (the rejected invoice stays `draft`, no entry). Pre-fix victims also rolled back cleanly (the audit's observation); the difference is that no one is aborted now.

## STOP-condition review

| # | Condition | Result |
|---|---|---|
| 1 | cannot reproduce | reproduced 3/3 scenarios, deterministically |
| 2 | needs formula/ledger change | no |
| 3 | needs credit-limit *policy* change | no (timing of the read only; see above) |
| 4 | schema/migration | no |
| 5 | new document state | no |
| 6 | broad retry / API envelope change | no |
| 7 | two intentional incompatible lock orders | no — the documented order (`SourceInvoiceLock`) is extended, not contradicted |
| 8 | payment semantics make one order unsafe | no — payment code untouched |
| 9 | must remove a legitimate lock | no — the partner lock is kept |
| 10 | already solved by a newer task | no |
| 11 | needs a broader transaction redesign | no |
| 12 | test cannot be deterministic | deterministic (lock-state barrier) |

## Files changed

| File | Change |
|---|---|
| `app/Services/Accounting/InvoiceService.php` | tenant-anchor lock before the partner lock (+ `use Tenant`) |
| `app/Services/Accounting/SourceInvoiceLock.php` | comment only: extend the documented order with the partner row |
| `tests/Feature/Rem04InvoicePostConcurrencyPostgresTest.php` | new (PostgreSQL-only; skips on SQLite) |
| `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` | REM-04 status entry |
| `docs/audits/horizon/REM-04-SEC-02-IMPLEMENTATION-REPORT.md` | this report |

Not touched: `LedgerService`, `PaymentService`, ZATCA code (XML/QR/ICV/PIH/attempts), accounting formulas, numbering, models, routes, API error mapping, schema.

## Risks / remaining

1. **Longer tenant-wide critical section for unpaid credit invoice posts.** They already serialised on the tenant row from the ledger step to commit; the window now also covers the credit-limit query (two `SUM`s over the customer's receivable lines) and total computation. Heavy customer histories lengthen it. Merging those two sums into one query would shorten it (out of scope).
2. **Irreducible deadlocks elsewhere still surface as 500** (no retry or `40P01` mapping exists, and changing the error envelope is an API decision — not done). Other "anchor-after-row" patterns were not audited here.
3. **Pre-existing:** the `settle()` inside a paid credit invoice still inserts a payment under the anchor; the cycle was broken on the other side (the partner `FOR UPDATE`), not by moving that insert.
4. The credit decision under concurrency now follows the anchor order (see *Credit-limit behaviour*); no policy change, but behaviourally observable only in a race.
5. Local full-suite limits listed above; CI is authoritative.

## CI

Recorded in the hand-back message against the exact final head (a file cannot contain its own head's CI result).

## Merge / Deploy

- **Draft**: yes
- **NOT MERGED**
- **NOT DEPLOYED**
- No Railway or GitHub settings changes; no production migration; no live ZATCA.

## Next step

Owner review only.
