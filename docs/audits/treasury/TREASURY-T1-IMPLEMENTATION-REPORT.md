# TREASURY-T1: eliminate the `bootstrapDefaults()` PostgreSQL deadlocks

| | |
|---|---|
| Owner decision | D-T1 approved (one Draft PR, this scope only) |
| Base | `origin/main` @ `6c9efaeffe3b39aa5639e4b1e48ad02bda4e5b40` (includes #1604) |
| Branch | `claude/treasury-t1-bootstrap-deadlock` |
| Source audit | `docs/audits/treasury/TREASURY-BANKING-PHASE0-AUDIT.md`, sections 5, 9, 11 |
| Not done | merge, deploy, data reset, production migration, tenant activation, ZATCA transmission. No schema change. |

## 1. Root cause

`CashBankAccountService::bootstrapDefaults()` is called on hot paths (`resolveForPayment`, POS checkout, `GET /payment-methods`). It took `FOR UPDATE` on the system accounts 1110 and 1120 before the tenant anchor (`tenants` row, locked by `LedgerService`/`AccountingDateGuard`). Two distinct cycles resulted:

| Cycle | Transactions | Lock order |
|---|---|---|
| 1 | cash invoice ↔ cash sales credit note | invoice: account 1110 `FOR UPDATE` → anchor. Note: anchor → `journal_lines` insert on 1110, whose foreign key takes `FOR KEY SHARE` on 1110, which conflicts with `FOR UPDATE`. |
| 2 | cash invoice ↔ paid credit invoice | invoice: 1110 → anchor. Paid credit invoice: anchor → `settle()` → `PaymentService` → `resolveForPayment` → `bootstrapDefaults()` → 1110 (the inverse order). |

`FOR NO KEY UPDATE` alone removes cycle 1 but not cycle 2: both sides take the same lock in opposite order relative to the anchor.

## 2. Fix (`app/Services/Accounting/CashBankAccountService.php` only)

1. **Lock-free fast path.** `defaultsProvisioned()` runs plain reads and `bootstrapDefaults()` returns immediately when the slow path would write nothing. A provisioned tenant takes no row lock on `accounts`. The condition is exactly the slow path's own no-op condition:
   - for each of 1110/1120, the account is absent or an entity already links it; and
   - payment methods exist, or a main cash or main bank entity is missing (in which case methods are not seeded).
2. **Slow path lock order.** The tenant anchor is locked first (skipped when there is no tenant context, as before). Then the two system accounts are read with `FOR NO KEY UPDATE`. This matches the ledger order (anchor → accounts) and does not conflict with `FOR KEY SHARE`. The transaction never updates a key column of `accounts`.
3. **Unchanged:** entity creation rules, main-entity selection, the payment-method seeding policy (including re-seeding when a tenant has deleted all of them; that remains owner decision D-T4), journals, VAT, numbering, ZATCA, schema, tenant scoping.

Why the fast path is safe under READ COMMITTED: it reads committed rows only, and the rows it relies on cannot disappear. System entities cannot be deleted (`delete()` rejects `is_system` accounts and the foreign keys are `restrict`). Payment methods only need to exist, so a concurrent delete of the last method simply causes re-seeding on the next call, exactly as before.

## 3. Evidence

### 3.1 Before and after on PostgreSQL 16 (real processes, `lock_timeout=60s`)

| Scenario | `main` | After the fix |
|---|---|---|
| Cash invoice vs cash credit note, anchor pre-held | deadlock | no deadlock |
| 8 cash notes + 8 cash invoices | 8/16 deadlocked | 0 |
| 8 cash invoices + 8 paid credit invoices | 10/16 deadlocked | 0 |
| Anchor-first bootstrap vs cash invoice | deadlock | no deadlock |
| Slow path of an unprovisioned tenant vs note holding the anchor | deadlock | no deadlock |
| 6 concurrent first-time provisionings | 2 entities, 2 mains, 4 methods | same |

### 3.2 Which layer fixes what (mutation runs against the new PostgreSQL test class)

| Variant of the service | Result |
|---|---|
| `main` (original) | 5 of 8 tests fail (all four deadlock scenarios and the lock-statement test) |
| `main` + only `FOR NO KEY UPDATE` | still fails paid-credit-invoice, anchor-first and lock-statement tests |
| fast path only, old slow path (`FOR UPDATE`, no anchor) | slow-path-under-contention test fails, lock-order test fails |
| anchor-first + `FOR NO KEY UPDATE`, no fast path | all deadlock scenarios pass; only the "fast path takes no locks" test fails |
| **full fix** | all pass |

So the two slow-path changes are what remove the cycles, and the fast path keeps steady-state postings away from any `accounts` row lock. Both are kept, as specified.

### 3.3 Behavioural equivalence

The end state (entities, mains, methods and their links) after `bootstrapDefaults()` was recorded for seven starting states (full, bank entity missing, cash entity missing, no methods with both mains, no methods without a cash main, entities missing with one unlinked method, system accounts absent). The dumps from `main` and from the fix are **byte-identical**.

### 3.4 Tests added or changed

| File | Engine | What it proves |
|---|---|---|
| `TreasuryBootstrapDeadlockPostgresTest` (new, 9 tests) | PostgreSQL, `pcntl_fork`; fails (not skips) without `pcntl` | the five deadlock scenarios; concurrent first-time provisioning is idempotent per tenant with no cross-tenant effect; partially provisioned tenant completes once; tenant without the legacy system accounts is a no-op; fast path emits **zero** row-lock statements; slow path locks `tenants` before `accounts` and uses `FOR NO KEY UPDATE` |
| `CashBankBootstrapIdempotencyTest` (new, 13 tests) | SQLite and PostgreSQL | repeated calls change nothing (ids and `updated_at` stable); empty tenant gets exactly 2 mains and 4 methods; fast-path answer equals "slow path writes nothing" across seven states; seeding policy unchanged; fast path issues no insert/update/delete; one tenant never touches another; `resolveForPayment` still provisions on demand and still fails closed |
| `ZatcaCreditNoteIssuancePostgresTest` (changed) | PostgreSQL | cash invoices restored in the concurrent note/invoice chain test (they were replaced by credit invoices in 3c to avoid this deadlock) |
| `UsesWorkerDatabaseWithoutTransaction` (existing from #1604) | PostgreSQL | the new class uses it so ParaTest workers do not share a database |

## 4. Verification results

| Run | Result |
|---|---|
| New PostgreSQL class, full fix | 9 passed |
| New cross-engine class | 13 passed on SQLite, 13 passed on PostgreSQL |
| Related suites (CashBank, PaymentMethod, Payment, Invoice, CreditNote, Purchase, Pos, Refund, Return, Expense, Asset, Payroll, Custody, Zatca, Ledger, Report, Gateway, Vat) | the only failures shown were the `Fuel*` tests (missing `bcmath` locally, see below) |
| Full SQLite suite (local) | 8238 passed, 179 skipped, 30 failed |
| Full PostgreSQL suite, `--parallel --processes=4` as CI (local) | 8447 tests, 27 failing |
| CI (`php artisan test` sqlite and pgsql, CI Gate) | see the PR |

Local failures, none touching treasury code:

| Failure | Cause | Evidence |
|---|---|---|
| 26 `Fuel*` tests on both engines | `bcmath` extension missing in this sandbox (`Call to undefined function App\Services\bcmul()`); the audit noted this and CI installs it | environment |
| `AiPaidProviderDisabledTest` (SQLite) | pre-existing | identical failure with the original service |
| `StorefrontMediaApiTest::the_library_lists_newest_first…` (PostgreSQL) | pre-existing (`SQLSTATE[HY093]` bind error) | identical failure with the original service |
| `ImportJobApplyTest` (1 test), `AiDocumentExternalQaTest` (2 data-set cases) (SQLite, full run only) | order or resource dependent | all pass when run in isolation with the fix |

## 5. Accounting invariants

No journal amount or account changes, no VAT change, no new entity or payment method beyond what the slow path created before, no cross-tenant access (all reads and the anchor lock are tenant-scoped; verified by the isolation tests), no ZATCA XML, signing, ICV or PIH change (the ZATCA credit-note suites run unchanged on both engines), no migration. No new accounting entry exists to tabulate.

## 6. Remaining risks

- The slow path now takes the tenant anchor, so first-time provisioning is serialized with other writers of that tenant. It runs once per tenant (registration already holds it), so contention is negligible.
- Other places that lock `accounts` rows `FOR UPDATE` before the anchor were not audited here (for example `CashBankAccountService::nextAccountCode` locks the group account). Scope is limited to `bootstrapDefaults()` as approved.
- Hot paths still call `bootstrapDefaults()` (now cheap). Removing provisioning from them is the later `TreasuryProvisioningService` PR (T9).
- The seeding-after-deletion behaviour (D-T4) is deliberately unchanged.

## 7. Next recommended action

Owner review of the PR and CI. Then T2 from the audit (cash-flow report and dashboard on the entity-linked cash set).
