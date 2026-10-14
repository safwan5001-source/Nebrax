# REM-04 / SEC-02 — Implementation Report: PostgreSQL posting deadlock (invoice posting vs payment / draft creation)

STATUS: **DRAFT PR — NOT MERGED — NOT DEPLOYED** (CI on the final head is recorded in the PR comment)
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: AWJ-TAX-ZATCA-AUDIT-1 SEC-02 → TAX-HZ-00 backlog REM-04)
ZONE: C — financial posting path / PostgreSQL concurrency

> **SUPERSEDED IN PART (owner decision, post-merge review).** The `FOR NO KEY UPDATE` root-cause fix described here **stays**. Two additions were **removed** by the follow-up change documented in `REM-04-SEC-02-FOLLOWUP-REPORT.md`: (1) the 3-attempt `DB::transaction` retry in `InvoiceService::post()`; (2) the global 409 mapping in `ApiController::domain()`. The current contract is **HTTP 503 + `Retry-After: 1` + `error_code: concurrency_conflict`, on `POST /invoices/{id}/post` only**. Sections of this report that describe retries or the 409 mapping (§1, §4, §5, §6, §7) describe the as-merged #1450 state and are kept for the record.

## 1. Executive summary

| | |
|---|---|
| Verdict | **Confirmed defect, fixed with a one-line lock-mode change plus a bounded retry and a 409 mapping.** The cycle is reproduced **deterministically** (3/3 runs, SQLSTATE 40P01) on unmodified `main`, and gone (0 deadlocks, 3/3 runs) after the change. |
| Root cause | The credit-limit guard locked the customer row `FOR UPDATE`. PostgreSQL's foreign-key check for any `INSERT` that references that customer (`payments`, `invoices`, …) takes `FOR KEY SHARE` on the same row, and `FOR UPDATE` conflicts with it. A transaction that holds the tenant anchor and then inserts such a row therefore waits for the poster, while the poster waits for the tenant anchor. |
| Fix | (1) `InvoiceService::lockPartnerForCreditCheck()` uses **`FOR NO KEY UPDATE`** on PostgreSQL — still serialises credit postings per customer, no longer conflicts with FK checks. (2) The posting transaction is retried (3 attempts, Laravel's concurrency-error-only retry). (3) `ApiController::domain()` maps an exhausted transient concurrency failure (`40P01`/`40001`/Laravel `DeadlockException`) to **409 + `Retry-After: 1`** instead of 500. |
| Not changed | Lock *order* (invoice → customer → tenant anchor), totals, journal entries, VAT, ICV semantics, numbering, allocations, permissions, routes, schema, migrations, accounting policy, other services. |
| Owner STOP condition | **Not triggered**: no additional financial service and no API contract beyond the card's own "retry exhaustion → 409/503" was needed. |

## 2. Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `38e259c8a7b2776f0f00da8ff1d14b9453e9f139` (`origin/main`) |
| Branch | `fix/security/rem04-posting-lock-order` |
| PR | recorded in the PR (Draft) and the PR comment |
| Head SHA | recorded in the PR comment (a file cannot contain its own commit hash) |

## 3. Phase 1 — Evidence

### 3.1 Actual lock sequence (PostgreSQL, traced with `DB::listen` on a credit post; kept as a regression test)

`InvoiceService::post` for an unpaid credit invoice, **before and after** the change:

| # | Statement | Before | After | Where |
|---|---|---|---|---|
| 1 | `invoices … FOR UPDATE` | ✔ | ✔ | `post()` — double-post guard |
| 2 | `partners … FOR UPDATE` / **`FOR NO KEY UPDATE`** | `FOR UPDATE` | `FOR NO KEY UPDATE` | `assertWithinCreditLimit()` (runs **even when `credit_limit = 0`**; skipped for cash / `is_paid`) |
| 3 | `tenants … FOR UPDATE` | ✔ | ✔ | `LedgerService::post` → `AccountingDateGuard::lockAnchor` |
| 4 | `tenants … FOR UPDATE` | ✔ | ✔ | journal-entry numbering anchor |
| 5 | `tenants … FOR UPDATE` | ✔ | ✔ | `ZatcaService::buildFor` (ICV scope anchor; branch row instead when ICV scope is `branch`) |

(After-change trace recorded: `invoices FOR UPDATE -> partners FOR NO KEY UPDATE -> tenants FOR UPDATE -> tenants FOR UPDATE -> tenants FOR UPDATE`.)

The competing transactions (verified, PostgreSQL):

| Competitor | Sequence | Source |
|---|---|---|
| `PaymentService::create` (no branch context) | tenant anchor `FOR UPDATE` (document numbering, `GeneratesDocumentNumbers::lockNumberingAnchor(null)`) → `INSERT payments(partner_id …)` → **FK check `SELECT 1 FROM ONLY partners … FOR KEY SHARE`** | server error text below |
| `InvoiceService::create` (draft, no branch context) | tenant anchor `FOR UPDATE` → `INSERT invoices(partner_id …)` → same FK check | server error text below |

### 3.2 The lock cycle (confirmed)

```
        A: InvoiceService::post (credit)                B: PaymentService::create / InvoiceService::create
        ─────────────────────────────────                ───────────────────────────────────────────────
   1    lock invoice row            (FOR UPDATE)
   2    lock partner row            (FOR UPDATE) ◄──┐
   3                                                  │    lock tenant anchor      (FOR UPDATE)   (numbering)
   4                                                  │    INSERT … partner_id → FK check wants FOR KEY SHARE on the partner row
   5    lock tenant anchor ─── waits for B ──────────┼────────────────────────────────────────────────────┐
   6                                                  └──── B waits for A's FOR UPDATE on the partner row ◄─┘
                                          ⇒ deadlock → PostgreSQL aborts one of them (SQLSTATE 40P01)
```

Rows involved: one `partners` row (the shared customer) and one `tenants` row (the anchor). Transaction boundaries: A is `post()`'s top-level `DB::transaction` (with the ledger post nested inside it); B is `create()`'s own top-level transaction. SQLSTATE: **40P01** `deadlock_detected`.

Exact server message from the deterministic reproduction on unmodified `main` (payment creator was the victim in all runs):

```
SQLSTATE[40P01]: Deadlock detected: 7 ERROR:  deadlock detected
DETAIL:  Process 948 waits for ShareLock on transaction 472480; blocked by process 947.
         Process 947 waits for ShareLock on transaction 472482; blocked by process 948.
CONTEXT:  while locking tuple (0,1) in relation "partners"
SQL statement "SELECT 1 FROM ONLY "public"."partners" x WHERE "id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE OF x"
(… insert into "payments" (…, "partner_id", …))      — and the identical text for  insert into "invoices" (…)
```

### 3.3 Confirmed defect vs theoretical risk

| Item | Status | Basis |
|---|---|---|
| Poster (`FOR UPDATE` on partner → tenant anchor) vs payment creation | **CONFIRMED DEFECT** | deterministic test, 3/3 on `main` |
| Poster vs draft-invoice creation | **CONFIRMED DEFECT** | deterministic test, 3/3 on `main` |
| Natural contention: 6 posters + 3 payment + 3 draft creators | **CONFIRMED** (probabilistic) | `DeadlockException` / 40P01 on `main` in 2/2 runs; 0/3 after |
| Same cycle via other tenant-anchored writers that reference a customer (delivery-note draft builder, CLI/queue contexts without branch) | **Same root cause; covered by the same change** | the FK check is what conflicted — no longer conflicts with `FOR NO KEY UPDATE`; not individually reproduced |
| Payment posting (`payment → invoice → tenant`) vs invoice posting (`invoice → customer → tenant`) | Theoretical | a payment can only allocate to a *posted* invoice; the poster only touches a *draft* one — disjoint rows |
| `InventoryService` locks stock-state rows **before** ledger posting while `post()` locks them **after** the anchor (audit note) | **Theoretical, NOT changed here** | would need a different lock order in a second financial service → out of this task's scope; remains covered by the bounded retry + 409 mapping |
| Other controllers that call services without `ApiController::domain()` (e.g. POS checkout) | Theoretical | still return the framework's 500 on an exhausted deadlock; the posting transaction itself now retries |

## 4. Phase 2 — The correction

1. **`app/Services/Accounting/InvoiceService.php`**
   * `lockPartnerForCreditCheck(string $partnerId): ?Partner` (new, `protected`): on `pgsql` `->lock('for no key update')`, otherwise `->lockForUpdate()` (SQLite ignores row locks — behaviour as before). `assertWithinCreditLimit()` calls it; the credit-limit arithmetic is untouched.
   * `post()`: `DB::transaction(..., self::POST_TRANSACTION_ATTEMPTS)` with `POST_TRANSACTION_ATTEMPTS = 3`.
2. **`app/Http/Controllers/Api/ApiController.php`**: `domain()` — a `PDOException` whose chain carries SQLSTATE `40P01`/`40001`, or is Laravel's `DeadlockException`, becomes `abort(409, <generic Arabic message>, ['Retry-After' => '1'])`. Every other `PDOException` is rethrown unchanged (500), `RuntimeException` still → 422.

Why this and not "anchor first": the competitors take the *tenant* **or the branch** row as numbering anchor depending on context, and the poster takes both later (ledger → tenant, JE numbering / ICV → branch). Re-ordering the poster to "tenant first" would still leave a partner-vs-branch cycle; making the customer lock non-conflicting removes the customer row from every cycle regardless of which anchor the competitor uses, without touching the financial lock order.

Why `FOR NO KEY UPDATE` preserves correctness: the lock's only job is serialising concurrent credit postings for one customer. `FOR NO KEY UPDATE` conflicts with itself, `FOR UPDATE`, `FOR SHARE` and ordinary `UPDATE` of the row, so two credit postings (and a concurrent customer edit) still serialise — proven by the credit-limit concurrency test. It only stops conflicting with `FOR KEY SHARE`, which is exactly the lock an FK-referencing `INSERT` takes and which carried no credit-limit meaning (a draft or an unposted payment does not change the receivable balance).

Why the retry is safe: Laravel retries *only* concurrency errors (`40001`, "deadlock detected", lock timeouts), *only* on the outermost transaction (inside a larger transaction it wraps in `DeadlockException` and rethrows), after a **full rollback**. The closure re-reads the invoice with its lock, so a repeat cannot double-post; business errors (`RuntimeException`) are never retried; `afterCommit` callbacks of a rolled-back attempt are discarded.

## 5. Before / after reproduction evidence

All runs: PostgreSQL 16 (local cluster, forked processes, one connection each). Test class: `tests/Feature/Rem04PostingLockOrderPostgresTest.php` (11 tests).

| Test | `main` (before) | This branch (after) |
|---|---|---|
| Deterministic: post vs **payment creation**, same customer | ❌ 40P01 ×3 of 3 runs | ✅ ×3 of 3 |
| Deterministic: post vs **draft invoice creation**, same customer | ❌ 40P01 ×3 of 3 runs | ✅ ×3 of 3 |
| Control: legacy `FOR UPDATE` re-injected via the test hook | ✅ (deadlock observed, exactly one victim, victim fully rolled back) | ✅ (same) — proves the test detects the cycle |
| Lock-order trace (`invoices FU → partners FNKU → tenants FU`, no `partners FU`) | ❌ | ✅ |
| Stress: 6 posters + 3 payment creators (with allocations) + 3 draft creators | ❌ DeadlockException/40P01 (2/2 runs) | ✅ (3/3 runs, 40 assertions) |
| Same draft posted by 2 processes | ✅ | ✅ |
| Credit limit still enforced under concurrency (limit 200.00, two 115.00 invoices) | ✅ | ✅ (exactly one passes) |
| Two tenants posting concurrently (independent ICV chains/ledgers) | ✅ | ✅ |
| Transient deadlock victim rolled back and retried (injected after the entry, ICV and status were written) | ❌ (no retry) | ✅ one entry, ICV 1, no orphan entries, next ICV 2 |
| Retries exhausted → nothing persisted, post repeatable | ❌ | ✅ 3 attempts, draft untouched, no ICV consumed |
| HTTP: exhausted retries → **409 + `Retry-After: 1`**, no SQL text, recovers on repeat | ❌ (500) | ✅ |

How the reproduction is deterministic (no timing luck): a hook in the poster (`Rem04GatedInvoiceService`, test-only) pauses it **right after it holds the customer row** until `pg_stat_activity` shows the competitor *blocked on a lock* (or finished). Only then does the poster continue to the tenant anchor. On the old lock the competitor always blocks → cycle → 40P01; on the new lock it never blocks → both finish.

Unit tests (no DB, run on SQLite and PostgreSQL): `Rem04ConcurrencyFailureMappingTest` (5) — 40P01 → 409 + `Retry-After`; 40001 → 409; Laravel `DeadlockException` (with and without previous) → 409; 23505 and other SQLSTATEs rethrown unchanged; `RuntimeException` → 422; pass-through.

## 6. Financial invariants (asserted in the tests, on PostgreSQL)

| Invariant | Evidence |
|---|---|
| No duplicate posting | same draft posted by two processes ⇒ exactly one succeeds (the other: "غير مسوّدة"), one journal entry, one ICV |
| ICV unique and contiguous | stress run ⇒ posted ICVs exactly `1..7`; two tenants ⇒ each `1..3` independently; after a retried victim the next post gets the next ICV, no gap |
| Ledger balanced | every entry `Σ debit = Σ credit` after every scenario (SQL `HAVING SUM(debit) <> SUM(credit)` returns none) |
| Customers' receivable = posted totals | stress run ⇒ `Σ(debit−credit)` on the customer = `Σ invoice.total` of the 7 posted invoices, to the halala |
| No duplicate payment allocations | 3 payments × 1 allocation ⇒ exactly 3 allocation rows, 3 distinct payments |
| Rollback safety | victim of the legacy-lock deadlock: invoice stays `draft`, no entry, no ICV (or the payment is absent); retried victim leaves no orphan entry |
| Tenant isolation | two-tenant concurrent posting: no journal line references another tenant's account; ICV chains independent |
| Credit-limit semantics | two 115.00 invoices vs 200.00 limit ⇒ one posts, one is refused with the credit-limit message |

Unchanged posting entry for a credit sales invoice (no new financial operation is introduced):

| Account | Debit | Credit |
|---|---|---|
| 1130 العملاء (accounts_receivable) | total | |
| 4110 إيرادات المبيعات (sales_revenue) | | net sales |
| 2120 ضريبة مخرجات (tax_output) | | VAT |

## 7. Tests and CI

| Check | Result |
|---|---|
| `Rem04PostingLockOrderPostgresTest` (PostgreSQL 16, local) | **11/11 pass, 128 assertions**; 3/3 repeat runs of the two deterministic tests |
| Same file on `main` code | 7 fail / 4 pass (see §5) |
| `Rem04ConcurrencyFailureMappingTest` | 5/5 on SQLite (also runs on PostgreSQL) |
| PostgreSQL-only tests on SQLite | skipped by design (`markTestSkipped`: needs real row locks + `pcntl`) |
| Full suite, local SQLite (`:memory:`) | **6698 passed / 89 skipped / 38 failed** — the 38 are the known environmental set (no `bcmath`, mail/queue config …); the failing-test list is **identical** to the pre-change run (`diff` empty) |
| Full suite, local PostgreSQL 16 | **6783 passed / 3 skipped / 39 failed** — the known 38 environmental + 1 PostgreSQL-only media test; failing list **identical** to the pre-change PostgreSQL run (`diff` empty); all 11 REM-04 tests pass inside the full run |
| CI (`php artisan test` SQLite + PostgreSQL, `CI Gate`) on the final head | recorded in the PR comment |

## 8. Files changed

| File | Change |
|---|---|
| `app/Services/Accounting/InvoiceService.php` | `lockPartnerForCreditCheck()`; `POST_TRANSACTION_ATTEMPTS = 3` on `post()` |
| `app/Http/Controllers/Api/ApiController.php` | `domain()`: transient concurrency failure → 409 + `Retry-After`; `isTransientConcurrencyFailure()` |
| `tests/Feature/Rem04PostingLockOrderPostgresTest.php` | new — 11 PostgreSQL tests |
| `tests/Feature/Rem04GatedInvoiceService.php`, `Rem04FlakyInvoiceService.php` | new — test-only subclasses (gate hook / injected 40P01 victim) |
| `tests/Feature/Rem04ConcurrencyFailureMappingTest.php` | new — 5 mapping tests |
| `docs/audits/horizon/REM-04-SEC-02-IMPLEMENTATION-REPORT.md`, `TAX-HZ-00-REMEDIATION-BACKLOG.md` | this report; backlog status |

No migration, route, permission, schema, `LedgerService`, `PaymentService`, `GeneratesDocumentNumbers`, `ZatcaService`, VAT or CI/CI-Gate/setting change.

## 9. Behaviour changes to be aware of

1. A posting that loses a deadlock now retries (up to 3 attempts) instead of failing at once; on exhaustion the API answers **409 `Retry-After: 1`** (was 500). Applies to every endpoint that goes through `ApiController::domain()` for a `40P01`/`40001`; other database errors still produce 500.
2. On PostgreSQL the customer row lock is `FOR NO KEY UPDATE`: concurrent *foreign-key inserts* referencing the customer no longer wait for a credit posting (they never needed to).
3. SQLite: unchanged (row locks are ignored there); the retry applies only if SQLite itself reports a lock error.

## 10. Remaining risks / not done

1. **Inventory-state vs ledger lock order** (audit note, `InventoryService` locks stock-state rows before the ledger while `post()` locks them after the anchor) is *theoretical* and **not changed**: it needs a lock-order change in a second financial service, which this task's STOP rule reserves for an owner-approved design.
2. A residual deadlock inside a *larger* caller transaction (e.g. POS checkout wrapping `post()`) cannot be retried by `post()` itself; it surfaces as `DeadlockException`, mapped to 409 only where the controller uses `domain()`.
3. `domain()` now maps the two SQLSTATEs for *all* endpoints that use it (intended by the card; flagged because it is shared).
4. The PostgreSQL concurrency tests need `pcntl` and a real PostgreSQL; they skip elsewhere.
5. Local full-suite failures (no `bcmath`, no AWS SDK, mail/queue config) are environmental and identical on `main`; CI is authoritative.

## 11. Merge / deploy

**Draft. NOT MERGED. NOT DEPLOYED.** No production database operation, no GitHub setting change, no live ZATCA traffic, OTP or credential operation.

## 12. Next step

Owner review. Then, if wanted, a separately approved design for the inventory-state ordering (risk 1) and an audit of the remaining tenant-anchored writers (`DeliveryNoteSalesInvoiceDraftBuilder`, symmetric cases) against the new lock contract.
