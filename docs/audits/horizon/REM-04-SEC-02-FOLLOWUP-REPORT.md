# REM-04 / SEC-02 — Follow-up Report: single-attempt posting + scoped 503 contract

STATUS: **MERGED** (PR #1461, merge `51851c04ae11ac90c14e223bc44456765d0dc535`) · **CI verified** · **Production deployment NOT VERIFIED**

> **Status correction (2026-10-14, post-merge).** This report was authored while the change was a Draft PR ("NOT MERGED"). Current verified state: PR #1461 merged, merge SHA `51851c04ae11ac90c14e223bc44456765d0dc535`, post-merge `CI` run #9515 success; **production deployment NOT VERIFIED**. The body below is otherwise unchanged and still describes the state at authoring; where it says "Draft" or "not merged" this note supersedes it. Cross-horizon status: `TAX-ZATCA-RECONCILIATION-AUDIT.md`.
DATE: 2026-10-14
HORIZON: TAX-ZATCA — follow-up to REM-04 (#1450) after the owner's post-merge review
ZONE: C — financial posting path / API contract (no accounting change, no schema change)

## 1. Owner decision implemented

| # | Decision | Done |
|---|---|---|
| 1 | Keep the `FOR NO KEY UPDATE` root-cause fix and its PostgreSQL concurrency tests | ✅ untouched (`lockPartnerForCreditCheck()`) |
| 2 | Remove the 3-attempt retry from `InvoiceService::post()` | ✅ `DB::transaction(...)` with the default single attempt; `POST_TRANSACTION_ATTEMPTS` deleted |
| 3 | Remove the global concurrency mapping from `ApiController::domain()` | ✅ `domain()` is byte-for-byte what it was before #1450 (verified with `git diff 38e259c`) |
| 4 | Concurrency handling on `POST /invoices/{id}/post` only | ✅ `InvoiceController::post()` |
| 5 | Exhausted/unhandled `40P01` / `40001` → 503 + `Retry-After: 1` + `error_code: concurrency_conflict` + safe AR/EN message | ✅ (§3) |
| 6 | Other PDO errors unchanged; POS, Fuel, Payments, Purchases and all other endpoints out of scope | ✅ rethrown → framework 500, as before |

## 2. Exact files changed

| File | Change |
|---|---|
| `app/Services/Accounting/InvoiceService.php` | −13: retry constant + its docblock + the `, self::POST_TRANSACTION_ATTEMPTS` argument. **No other line** (the `FOR NO KEY UPDATE` helper is untouched). |
| `app/Http/Controllers/Api/ApiController.php` | −28: the `PDOException` 409 branch and `isTransientConcurrencyFailure()`. `domain()` is back to its pre-#1450 form. |
| `app/Http/Controllers/Api/InvoiceController.php` | `post()` only: `try { domain(...) } catch (PDOException) { ConcurrencyConflict::matches → 503 }`, else rethrow. |
| `app/Support/ConcurrencyConflict.php` | new, `final`: `matches(Throwable)`, `response()`, and the contract constants. Used **only** by `InvoiceController::post()`. |
| `tests/Feature/Rem04ConcurrencyFailureMappingTest.php` | rewritten for the new contract (9 tests; SQLite + PostgreSQL). |
| `tests/Feature/Rem04PostingLockOrderPostgresTest.php` | the 3 retry/409 tests replaced by 2 single-attempt tests (+ helper param); the 8 concurrency tests are untouched. |
| `tests/Feature/Rem04FlakyInvoiceService.php` | injectable SQLSTATE (`reset($failures, $sqlState)`). Test double only. |
| `docs/audits/horizon/*` | this report; superseded-in-part banner on the #1450 report; backlog status line. |

No migration, route, permission, schema, accounting, ZATCA, VAT or numbering change.

## 3. API contract (`POST /api/invoices/{id}/post` only)

Trigger: a `PDOException` whose `getPrevious()` chain contains Laravel's `DeadlockException`, or SQLSTATE `40P01` (deadlock_detected) or `40001` (serialization_failure).

```
HTTP/1.1 503 Service Unavailable
Retry-After: 1
Content-Type: application/json

{
  "message":    "تعذّر إتمام العملية بسبب تعارض مؤقت مع عملية متزامنة. لم يُحفظ أي تغيير، أعد المحاولة بعد لحظة.",
  "message_en": "The operation could not be completed because of a temporary conflict with a concurrent operation. Nothing was saved; please try again in a moment.",
  "error_code": "concurrency_conflict"
}
```

* `message` is the top-level key the web client already surfaces (`extractErrorMessage`), so the Arabic text appears with no client change; `error_code` is the stable machine-readable discriminator.
* No exception text, SQL, table name or SQLSTATE is ever returned (asserted).
* Status is 503, not 409: 409 already carries conflict/idempotency semantics across this API (45 producers).
* Everything else on this endpoint: business `RuntimeException` → 422 (unchanged); any other database error (unique/FK violation, `XX000`, `HY000`/SQLite "database is locked"…) → framework 500 (unchanged, asserted).
* The same request is safe to repeat: the transaction is rolled back completely (no journal entry, no ICV, no status change — asserted on PostgreSQL, which runs without an outer test transaction).

Callers outside this endpoint (`PosService` checkout, `FuelSaleService::finalize`, payments, purchases, …) are unchanged: a deadlock there surfaces exactly as it did before #1450.

## 4. Why the deadlock stays fixed without retry or mapping

The cycle was `invoice post (partner FOR UPDATE → tenant anchor)` vs `payment/draft create (tenant anchor → INSERT → FK FOR KEY SHARE on partner)`. `FOR NO KEY UPDATE` does not conflict with `FOR KEY SHARE`, so the partner row is no longer a blocking edge; it still conflicts with itself, so credit postings stay serialised per customer.

Evidence (PostgreSQL 16, forked processes, deterministic gating on `pg_stat_activity`; none of it can be satisfied by a retry because the post now runs a single attempt):

| Test | Result |
|---|---|
| post vs concurrent payment creation, same customer | no deadlock |
| post vs concurrent draft-invoice creation, same customer | no deadlock |
| **control**: legacy `FOR UPDATE` re-injected through the test hook | **still deadlocks** (one victim, rolled back cleanly) — proves the harness detects the cycle |
| lock-order trace: `invoices FU → partners FNKU → tenants FU`, never `partners FU` | holds |
| stress: 6 posters + 3 payment creators + 3 draft creators | no deadlock, invariants hold |
| same draft posted by two processes | one entry, one ICV |
| credit limit under concurrency (200.00 limit, two 115.00 invoices) | exactly one passes |
| two tenants posting concurrently | independent ICV chains and ledgers |
| `a_deadlock_victim_is_rolled_back_completely_in_a_single_attempt…` (injected after entry+ICV+status are written) | exactly **1** attempt (`calls == 1`), draft untouched, no orphan entry, repeat posts ICV 1, next ICV 2 |
| `the_post_endpoint_answers_503…` | 503 + `Retry-After: 1` + `error_code`, 1 attempt, rolled back, recovers |

An earlier scratch experiment on `main` (retry and mapping stripped, lock fix kept) passed all of the deadlock-absence scenarios; this branch makes that configuration the shipped one.

## 5. Tests added / changed

`Rem04ConcurrencyFailureMappingTest` (SQLite + PostgreSQL):

| Requirement | Test |
|---|---|
| only `40P01`/`40001`/`DeadlockException` match; `23505`, `23503`, `XX000`, `HY000`, business errors do not | `only_deadlock_and_serialization_failures_match` |
| 503, `Retry-After: 1`, `error_code`, AR/EN message, no SQL leak | `the_response_contract_is_503_…`, `invoice_post_answers_503_…` (×2: `40P01`, `40001`; asserts a single attempt) |
| other PDO errors remain 500 on the post endpoint | `invoice_post_keeps_500_for_any_other_database_error` |
| business errors remain 422 | `invoice_post_business_errors_still_map_to_422` |
| unrelated `domain()` endpoints no longer get the mapping | `an_unrelated_endpoint_of_the_same_controller_…` (`DELETE /invoices/{id}`), `an_endpoint_of_another_controller_…` (`POST /payments/{id}/post`), `domain_rethrows_every_database_error_unchanged_…` (500, no `Retry-After`, no `error_code`) |

`Rem04PostingLockOrderPostgresTest` (PostgreSQL only): the single-attempt rollback test and the HTTP 503 + rollback + recovery test above, beside the unchanged concurrency/invariant tests.

> Why the rollback assertions live only in the PostgreSQL class: `RefreshDatabase` wraps each test in a transaction, which makes the posting transaction *nested*; Laravel does not undo a nested transaction's writes when it raises a deadlock (it expects the outer transaction to). The PostgreSQL class runs without an outer transaction and therefore proves the production behaviour; the SQLite-capable class proves the response contract.

**Negative controls (scratch copy, not committed):** disabling the endpoint handler → both 503 tests fail; re-adding a global mapping in `domain()` → the three "no global mapping" tests fail.

## 6. Financial invariants

Unchanged by construction (no line of totals, journal generation, VAT, ICV, numbering, allocation or ZATCA code is touched; the diff to `InvoiceService` is the removal of the retry argument) and asserted in the PostgreSQL tests: one journal entry per posted invoice, Σ debit = Σ credit per entry, ICV contiguous and unique per tenant, credit limit enforced under concurrency, no cross-tenant lock or data crossing. **No new or changed financial operation ⇒ no new journal entry to present** (the posting entries are exactly those of `main`).

## 7. Verification

See the PR comment for exact numbers: focused tests on SQLite and PostgreSQL, the full SQLite suite versus the known sandbox baseline (142 failures caused by missing `bcmath`/AWS SDK in this sandbox; identical set expected), and CI on the exact final head.

## 8. Risks / follow-ups

* A client that treated the #1450 409 as "retry" must now treat 503 + `error_code: concurrency_conflict` as retry. No client in this repository depends on either (verified: no test and no web code asserts the 500, the 409 or `Retry-After` for this case).
* Posting through POS and Fuel keeps its pre-#1450 behaviour on a deadlock; the root-cause fix is what protects them.
* Theoretical residual: `InventoryService` stock rows are locked before the ledger there but after the anchor in `post()`; not changed (needs a separate owner-approved design).
