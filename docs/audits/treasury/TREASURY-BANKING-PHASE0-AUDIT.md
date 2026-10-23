# AWJ ERP: Treasury & Banking Foundation, Phase 0 (read-only audit)

| | |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base | `origin/main` @ `6c9efaeffe3b39aa5639e4b1e48ad02bda4e5b40` (includes merged #1604) |
| Local branch | `audit/treasury-banking-phase0` (= `origin/main`, **no commits, working tree clean**) |
| Mode | READ ONLY. No production code, migration or test was changed. No PR, merge, deploy, data reset, tenant activation or ZATCA transmission. |
| Evidence tooling | A throw-away PostgreSQL probe (`ScratchTreasuryDeadlockProbeTest`) and candidate service variants were run **only in the local scratch Laravel overlay** (`/home/user/nibras-app`), then removed. Copies are kept in the scratchpad `probe/` folder for review. |

Legend: **[C]** = confirmed from code or execution · **[H]** = hypothesis or inference, not proven by execution.

---

## 1. Executive summary

1. **[C] The treasury/bank model already exists and is mostly sound.** It covers `CashBankAccount` (type cash|bank, one GL account each, `unique(tenant_id, account_id)`, one main per type), transfers with a balanced journal, deposit/withdraw scopes, and `PaymentMethod` → treasury links. Every voucher-type flow (receipts, supplier payments, customer/supplier refunds, custody, POS tenders, gateway settlement) already posts to the GL account of the selected or main treasury, and fails closed on an invalid choice.
2. **[C] Seven posting paths still bypass the treasury entity and hard-code GL 1110/1120:**
   - cash sales invoice (1110);
   - sales credit note and purchase debit note, cash refund (1110);
   - sales returns, including POS cash returns (1110);
   - POS exchange cash surplus (1110);
   - expenses (1110/1120);
   - fixed-asset purchase (1110/1120);
   - payroll pay (1110/1120).

   On top of these, paid purchases always use the main treasury or bank, because no selection is passed. Two read paths also see only 1110/1120: the cash-flow report and the dashboard cash KPI. Named treasuries (1111…, 1121…) are invisible to both.
3. **[C] The PostgreSQL deadlock is reproduced on current `main` and is wider than documented.**
   - Cash invoice vs cash credit note: 8 of 16 concurrent postings deadlocked.
   - **Cash invoice vs paid credit invoice: 10 of 16 deadlocked.** This second pair is a lock-order inversion between two callers of `CashBankAccountService::bootstrapDefaults()`.
4. **[C] `FOR NO KEY UPDATE` is safe but insufficient.** It removes the invoice↔credit-note cycle (0 deadlocks) but **not** the inversion (12–14 of 16 still deadlock).
5. **[C] Smallest correct fix:** a lock-free "already provisioned" fast path in `bootstrapDefaults()`. It produced 0 deadlocks in all four scenarios over repeated runs, and kept first-time provisioning idempotent under a 6-process race (2 entities, 2 mains, 4 payment methods).
6. **[C] Tenant creation has exactly one path**, `AuthController::register`, in a single transaction. It already provisions the legacy 1110/1120 treasury entities and 4 payment methods. The chart seeder is not idempotent, and `bootstrapDefaults()` also runs on hot paths: every `resolveForPayment`, POS checkout, and `GET /payment-methods`.

---

## 2. Confirmed current architecture

### 2.1 Data model [C]

| Table (migration) | Key facts |
|---|---|
| `cash_bank_accounts` (`2025_01_01_000070`) | `tenant_id` cascade; `account_id` → `accounts` restrict; `type` cash/bank; `is_main`; deposit/withdraw scope enum + subject. **`unique(tenant_id, account_id)`**, partial unique **`one_main_per_type (tenant_id, type) WHERE is_main`**. Backfill turned every leaf 111x/112x account into an entity. 1110 = "الخزينة الافتراضية" and 1120 = "الحساب البنكي الافتراضي", both main. Model is `CompanyWide`. |
| `cash_bank_transfers` (same) | Source/destination → `cash_bank_accounts`; `journal_entry_id`; numbering unique per branch plus a partial index for unbranched rows. |
| `payment_methods` (`000077`) | `cash_bank_account_id` → `cash_bank_accounts` **nullable**; `unique(tenant_id, name)`; `is_default` not unique (two defaults possible). |
| `*.cash_account_id` | Holds a **GL `accounts.id`**, not a `cash_bank_accounts.id`, on `payments` (no FK, by design), `invoices` (no FK), `pos_sessions` (no FK), `employee_custodies`, `customer_refunds`, `supplier_refunds` (FK → accounts). `payment_gateway_settlements.cash_bank_account_id` is the only column that references the entity. `credit_notes`, `expenses`, `returns`, `purchases`, `assets` and payroll have **no treasury column**. |

### 2.2 Chart of accounts [C] (`ChartOfAccountsSeeder.php:24-40`)

- `11` Current Assets contains:
  - `1110` الصندوق (postable, system);
  - `1120` البنك (postable, system);
  - `111` الخزائن (group);
  - `112` الحسابات البنكية (group);
  - then 1130…1180.
- **1110/1120 are direct children of 11, not of 111/112.**
- Named treasuries are created by `CashBankAccountService::create` → `nextAccountCode` (`:281-290`) as children of 111 or 112 with codes `111N` / `112N` (`1111`, `1112`, … `11110` after `1119`).
- Code uniqueness comes from `unique(tenant_id, code)` on `accounts`.

### 2.3 Services [C]

- `CashBankAccountService`:
  - `bootstrapDefaults()` (`:26-79`) links GL 1110/1120 to entities and seeds 4 payment methods (تحويل بنكي, نقدي, شيك, بطاقة ائتمان) when the tenant has none.
  - `resolveForPayment(?glAccountId, method)` (`:241-258`) calls `bootstrapDefaults()`, then returns the entity for the GL id or the **main of the type when the id is null**. It throws on unknown id, wrong type, or inactive entity/GL account. **It never substitutes a different treasury for an invalid choice.**
  - `assertAllowed()` (`:260-267`) enforces the deposit/withdraw scope.
- `CashBankTransferService::transfer` posts Dr destination GL / Cr source GL, with active, currency and negative-balance-policy checks.
- `VatRoleIntegrityService:551` and `ArApControlBalanceService:258` classify cash/bank as **entity-linked accounts ∪ {1110, 1120}**. That is the correct defensive pattern, and the remaining hard-coded paths should follow it.

### 2.4 API, permissions, UI [C]

- Routes (`routes/api.php:957-965, 996-1000`): `cash-bank-accounts` CRUD, deactivate, make-main and transfers; `payment-methods` CRUD and make-default.
  - Gated **only** by `payments.view` / `payments.manage`.
  - **No dedicated treasury permission and no `EnsureApplicationActive` gate.**
  - Default grants: owner/admin `*`; accountant view+manage; staff view.
- **`GET /payment-methods` writes:** it calls `bootstrapDefaults()`, and if a tenant has deleted all methods it re-seeds them, contrary to the comment at `:50-51`.
- No FormRequest uses tenant-scoped `Rule::exists`. Isolation relies on the global `TenantScope` (scoped `find`, `assertTenantOwned`), which holds for all paths seen. Refund controllers skip `assertTenantOwned` but resolve through scoped queries.
- UI:
  - Treasury screens: `/cash-and-bank` (list, new/edit, detail, transfer) and `/payment-methods`.
  - Treasury pickers exist in the general/document payment forms (`/cash-bank-accounts`), in custody, and in the invoice "paid" section. The invoice picker lists `/accounts` filtered by `/^11[12]/` (`invoice-form.tsx:249-250`), not `/cash-bank-accounts`, and does not filter by type.
  - **No picker** for cash invoices, credit notes, returns, expenses, assets, payroll or paid purchases.

---

## 3. Evidence-backed account flow matrix [C]

"Main" = the `is_main` entity of the type, chosen by `resolveForPayment(null, …)`.

| # | Flow | Entry point | Cash/bank GL source | User selects? | Invalid choice | Scope check | Journal (cash side ⇄ counter) |
|---|---|---|---|---|---|---|---|
| 1a | Cash sales invoice | `InvoiceService::post` `:888`, `:929-941` | **Hard-coded 1110**; entity on 1110 used only for the permission check | No | Throws if the 1110 entity is missing/inactive | deposit ✔ | Dr 1110 ⇄ Cr revenue, shipping, `tax_output`, ± adjustment |
| 1b | Invoice `is_paid` | `settle()` `:1129` → PaymentService | `invoice.cash_account_id`, else main of type | Yes | Throws | deposit ✔ (post) | Invoice Dr AR ⇄ Cr revenue; receipt Dr treasury ⇄ Cr AR |
| 2a | Sales credit note, cash refund | `CreditNoteService` `:486-493` | **Hard-coded 1110** (also hard-codes 4110 and 1130) | No | GL-active check only | ✘ | Dr 4110, Dr `tax_output` ⇄ Cr 1110 / 1130 |
| 2a' | Purchase debit note, cash | `:518` | **Hard-coded 1110** | No | GL-active only | ✘ | Dr 1110 / 2110 ⇄ Cr 5115, `tax_input` |
| 2b | Customer refund | `CustomerRefundService::post` `:356` | `cash_account_id` / method's treasury / main | Yes | Throws | withdraw ✔ | Dr AR ⇄ Cr treasury |
| 2c | Sales return, cash (including POS returns) | `ReturnService` `:605` | **Hard-coded 1110**, ignores the POS session treasury | No | GL-active only | ✘ | Dr 4110, `tax_output` ⇄ Cr 1110 / 1130 (+ COGS reversal) |
| 2d | POS exchange cash surplus | `PosExchangeService` `:345` | **Hard-coded 1110** (AR hard-coded 1130) | No | GL-active only | ✘ | Dr 1130 ⇄ Cr 1110 |
| 3a | Purchase invoice | `PurchaseService::post` | none (AP role) | n/a | n/a | n/a | Dr inventory/expense, `tax_input` ⇄ Cr AP |
| 3b | Paid purchase | `PurchaseService::settle` `:597-619` | **Always main** (no `cash_account_id` passed) | No | Throws only if main is invalid | withdraw ✔ (main) | Dr AP ⇄ Cr main treasury/bank |
| 3c | Supplier payment | `PaymentService::post` `:333` | `cash_account_id` / method's treasury / main | Yes | Throws | withdraw ✔ | Dr AP ⇄ Cr treasury |
| 3d | Supplier refund | `SupplierRefundService::post` `:293` | same | Yes | Throws | deposit ✔ | Dr treasury ⇄ Cr AP |
| 4 | Customer receipt | `PaymentService::post` `:333` | same; gateway/platform receipts post to clearing accounts but still resolve a treasury | Yes | Throws | deposit ✔ (skipped for clearing) | Dr treasury or clearing ⇄ Cr AR |
| 5a | POS checkout tenders | `PosService` `:209` (bootstrap), `:294-303` | Each tender's `PaymentMethod → treasury` | Indirect (method) | Unknown/inactive method throws; unlinked method → main | via PaymentService (actor may be null) | invoice Dr AR ⇄ Cr revenue; tender Dr treasury ⇄ Cr AR |
| 5b–d | POS open, cash in/out, close | `PosSessionService` | Session treasury frozen at open (oldest default cash method, else main) | No | Throws | — | **No journal** (operational records) |
| 5e | POS variance | `settleVariance` `:606-639` | Session treasury, **no fallback** | No | Throws | ✔ | Dr/Cr 5170 (hard-coded) ⇄ session treasury |
| 6a | Treasury transfer | `CashBankTransferService` | Entity ids for both sides | Yes | Throws | ✔ | Dr destination ⇄ Cr source |
| 6b | Partner opening balance | `PartnerService::recordOpeningBalance` | none (1130/2110 ⇄ 3130 hard-coded) | n/a | n/a | n/a | — |
| 6c | **Treasury/bank opening balance** | — | **Not implemented** (new treasuries start at 0) | — | — | — | — |
| 6d | Employee custody | `EmployeeCustodyService` `:139` | `cash_account_id` / main | Yes | Throws | withdraw ✔ | Dr custody (1160) ⇄ Cr treasury |
| 6e | Paid expense | `ExpenseService` `:189-196` | **Hard-coded** bank→1120, credit→2110, else 1110 | No | GL-active only; unknown method → 1110 | ✘ | Dr expense, `tax_input` ⇄ Cr 1110/1120/2110 |
| 6f | Gateway settlement | `PaymentGatewaySettlementService` `:77-84` | Entity id input | Yes | Throws; **accepts a cash-type treasury** | — | Dr bank (net), fee ⇄ Cr `gateway_clearing` |
| 6g | Fuel station collections | via PaymentService | method's treasury | Indirect | as 4 | as 4 | as 4; shift cash/variance post nothing |
| 6h | Asset purchase | `AssetService` `:181-186` | **Hard-coded** 1110/1120/2110 | No | GL-active only | ✘ | Dr asset, `tax_input` ⇄ Cr cash/bank/AP |
| 6i | Payroll pay | `PayrollService` `:209` | **Hard-coded** cash→1110, else 1120 | No | GL-active only | ✘ | Dr 2130 ⇄ Cr 1110/1120 |

Silent fallbacks that exist **[C]**. None replaces an *invalid* choice; each fills an *absent* choice.
- (a) A null `cash_account_id` resolves to the main treasury of the type.
- (b) A PaymentMethod with no linked treasury resolves to main (`PaymentService:551`, refund services).
- (c) Paid purchases always use main.
- (d) POS session open with no cash method uses main.
- Method coercions: an unknown invoice `payment_method` becomes cash (`InvoiceService:455`); for expenses and assets, anything that is not bank or credit becomes 1110; in `resolveForPayment`, anything that is not `bank` is treated as cash.

Observations **[H]**:
- (i) **POS drawer mismatch.** Variance settles against the session treasury, while POS cash returns and exchange surpluses always hit 1110. With a non-1110 session treasury, drawer cash and GL diverge.
- (ii) When a system entity's GL account stays active but the entity is deactivated (`update()` never deactivates a system GL account, `:168-175`), the hard-coded paths keep posting to 1110 while cash invoices throw.

---

## 4. Actual hard-coded 1110 / 1120 dependencies [C]

`grep -rnE "['\"](1110|1120)['\"]"` over `app/`, `routes/`, `config/`: **18 hits**. `database/` contains no seeders or factories. Tests: **174 hits in 44 files**.

| Category | Location | Nature | Action class |
|---|---|---|---|
| **Production posting** | `InvoiceService.php:50,930` | cash sale Dr 1110 | Route to selected/main cash treasury |
| | `CreditNoteService.php:51,493,518` | cash refund Cr/Dr 1110 | Route + withdraw/deposit scope |
| | `ReturnService.php:73,605` | cash return Cr 1110 (POS too) | Route (POS: session treasury) + scope |
| | `PosExchangeService.php:33,345` | surplus Cr 1110 | Route to session treasury + scope |
| | `ExpenseService.php:29-30,192-194` | Cr 1110/1120 | Treasury selection + scope |
| | `AssetService.php:31-32,183-185` | Cr 1110/1120 | Treasury selection + scope |
| | `PayrollService.php:38-39,209` | Cr 1110/1120 | Treasury selection + scope |
| **Production read** | `ReportService.php:520` | cash-flow report only 1110/1120 | Entity-linked set ∪ {1110, 1120} |
| | `web/src/app/(app)/dashboard/page.tsx:112` | cash KPI only 1110+1120 | Same, via API |
| **Integrity (correct pattern)** | `VatRoleIntegrityService.php:46,551`, `ArApControlBalanceService.php:68,258` | entity-linked ∪ codes | Keep |
| **Tenant initialization** | `CashBankAccountService.php:30-31` (`bootstrapDefaults`) | links 1110/1120 as default treasury/bank | Redesign as explicit provisioning (§6) |
| **Seeder** | `ChartOfAccountsSeeder.php:28-29` | creates 1110/1120 (system, postable) | Owner decision on numbering (§6.3) |
| **Migration backfill** | `000070` (names/flags) | historical | Do not edit |
| **UI labels/filters** | `invoice-form.tsx:249-250` (`/^11[12]/`, comment `:885` "1110 للنقد، 1120 للتحويل/البطاقة"), `mock-data.ts`, web tests | picker built on code range | Use `/cash-bank-accounts` filtered by type |
| **Tests** | 44 files (top: `InvoiceTest` 16, `FiscalCloseArApAsOfTest` 10, `PosDeliveryPlatformCheckoutTest` 9, `PaymentGatewaySettlementAccountingTest` 9, `VatSemanticRoutingTest` 8, refunds/payments 8 each) | assertions on 1110/1120 balances | Stay valid while main = 1110; new tests must cover non-1110 main |

Adjacent findings, outside treasury scope (record only): `CreditNoteService` hard-codes 4110/1130/2110/5115, `ReturnService` 4110/1130, `PosSessionService` 5170, `PartnerService` 1130/2110/3130.

---

## 5. PostgreSQL deadlock: root cause and correction

### 5.1 Lock graph [C]

| Path | Order of row locks |
|---|---|
| **A. Cash invoice** (`InvoiceService::post`) | `invoices` FOR UPDATE (`:897`) → `resolveForPayment` → `bootstrapDefaults` → **`accounts` 1110 FOR UPDATE, then 1120 FOR UPDATE** (`CashBankAccountService:33`) → `LedgerService::post` → `AccountingDateGuard` **`tenants` FOR UPDATE** (anchor, `:160`) → `journal_lines` INSERT |
| **B. Cash sales credit note** (`CreditNoteService::post`) | note FOR UPDATE → source invoice FOR UPDATE → **`tenants` FOR UPDATE** → `journal_lines` INSERT on 1110 → FK check `SELECT 1 FROM accounts … FOR KEY SHARE` on 1110 |
| **C. Paid credit invoice** (`is_paid`, `payment_type=credit`) | `invoices` FOR UPDATE → ledger → **`tenants` FOR UPDATE** → `settle()` → `PaymentService::create/post` → `resolveForPayment` → **`accounts` 1110/1120 FOR UPDATE** |

- **Cycle 1 (A ↔ B):** A holds 1110 `FOR UPDATE` and waits for the anchor. B holds the anchor and waits for `FOR KEY SHARE` on 1110, which conflicts with `FOR UPDATE`. Deadlock.
- **Cycle 2 (A ↔ C):** A takes 1110 then the anchor. C takes the anchor then 1110. That is a classic order inversion.
- **[H]** Any anchor-first path that later writes a 1110/1120 journal line (returns, expenses, assets, payroll, POS exchange, manual journals) can form cycle 1 with A or any other bootstrap-first path (receipts, refunds, custody).

Server evidence (verbatim excerpts):

```
ERROR: deadlock detected … CONTEXT: while locking tuple (0,3) in relation "accounts"
SQL statement "SELECT 1 FROM ONLY "public"."accounts" x WHERE "id" = $1 FOR KEY SHARE OF x"
(SQL: insert into "journal_lines" …)

ERROR: deadlock detected … while locking tuple (2,49) in relation "accounts"
(SQL: select * from "accounts" where "code" = 1110 and "accounts"."tenant_id" = … limit 1 for update)
```

### 5.2 Reproduction on current `main` [C]

PostgreSQL 16, real processes (`pcntl_fork`), committed data, `lock_timeout=60s`, default `deadlock_timeout`.

| Scenario | Baseline (`main`) | V1: `FOR NO KEY UPDATE` | V2: lock-free fast path |
|---|---|---|---|
| D1 cash invoice vs cash credit note, anchor pre-held (deterministic) | **deadlock** | 0 | 0 |
| D2 8 cash notes + 8 cash invoices (stochastic) | **8/16 deadlock** | 0 | 0 |
| D3 8 cash invoices + 8 paid credit invoices | **10/16 deadlock** | **12/16, 14/16** | 0 (two runs) |
| D4 anchor → `bootstrapDefaults()` vs cash invoice (deterministic) | **deadlock** | **deadlock** | 0 |
| D5 6 concurrent first-time bootstraps, unprovisioned tenant | 2 entities / 2 mains / 4 methods, no error | — | **same, no error** |

### 5.3 Is `FOR NO KEY UPDATE` safe? [C]

- **Safe:** NO KEY UPDATE still conflicts with itself, so concurrent first-time provisioners stay serialized. It does not conflict with FK `FOR KEY SHARE`. The bootstrap transaction never updates `accounts`, so no key update is hidden.
- **Unchanged:**
  - Uniqueness: `unique(tenant_id, account_id)` and `one_main_per_type` are untouched.
  - Idempotency: existence check under the lock.
  - Tenant isolation: the query is tenant-scoped.
  - Ledger integrity: no journal semantics change.
- **Insufficient:** it does not fix cycle 2 (D3/D4), because both sides take the same NO KEY UPDATE lock in opposite order relative to the anchor.

### 5.4 Smallest independently testable fix [C for behaviour, design is a recommendation]

Add a **read-only fast path** at the top of `bootstrapDefaults()`. It returns immediately when nothing needs to be done, which is exactly the slow path's own no-op condition:

- for each of 1110/1120, either the GL account is absent or an entity already links it; **and**
- either payment methods exist, or a main cash/bank entity is missing.

Only an unprovisioned tenant reaches the locking slow path. Optionally, the slow path can use `FOR NO KEY UPDATE` and **take the tenant anchor first**, giving the documented order "anchor → accounts" for the rare first-time case.

- **Why it is safe under READ COMMITTED:** the check reads committed rows only. The rows it relies on cannot vanish: system entities cannot be deleted (`delete()` rejects `is_system`), `restrict` FKs protect them, and payment methods only need to *exist*.
- **Effects:**
  - No journal or VAT change.
  - No uniqueness change.
  - Tenant-scoped reads.
  - Removes all row locks on `accounts` from steady-state posting.
- **Tests:**
  - PostgreSQL fork tests D1–D5 (fail on `main`, pass after).
  - A SQLite idempotency test.
  - Revert the 3c test workaround (credit invoices in `ZatcaCreditNoteIssuancePostgresTest`) so cash invoices are exercised again.
- **Side effect worth fixing in the same PR [C]:** the fast path keeps today's re-seed behaviour. If the owner wants "never re-seed after the user deleted all methods" as the code comment states, that becomes a recorded flag. **This is an owner decision.**

---

## 6. Tenant default accounts and numbering policy (recommendation)

### 6.1 What exists [C]

`register` (one transaction): Tenant → `ChartOfAccountsSeeder::seed` (not idempotent; fails on `unique(tenant_id, code)` if re-run) → `AccountRoleMappingSeeder` (idempotent) → `bootstrapDefaults()` (entities on 1110/1120 + 4 methods) → roles → main branch and warehouse → owner. The default bank entity has `bank_name`/`account_number` = NULL, so no fabricated bank details today.

### 6.2 Recommended design

1. **Explicit `TreasuryProvisioningService::provision(Tenant)`**, called by `register` inside its transaction and by an idempotent artisan backfill command. Hot paths stop provisioning: no `bootstrapDefaults()` in `resolveForPayment`, POS checkout or `GET /payment-methods`. They read and fail closed with a clear "treasury not provisioned" error.
2. **Defaults:**
   - Main Treasury: type cash, main, scope all.
   - Default Bank Account: type bank, main, scope all, **bank name/IBAN left empty and flagged "requires completion"**. No placeholder bank name or IBAN.
   - The 4 payment methods linked as today.
3. **Identity without codes:** add a nullable `system_key` (`main_treasury` | `default_bank`) with `unique(tenant_id, system_key)`. This identifies provisioned records without reading GL codes, and makes provisioning idempotent with `insertOrIgnore` (no account row lock). `is_main` keeps meaning "current default" and can move to a user treasury.
4. **Uniqueness and idempotency:**
   - Existing indexes (`tenant_id, account_id`, one main per type, `tenant_id, code`) plus `system_key`.
   - Provisioning is safe to call any number of times.
   - Optionally add a partial unique "one default payment method per tenant", since today two defaults are possible.
5. **Posting rule:** every cash/bank posting resolves a `CashBankAccount` (explicit choice, else a **declared** default policy) and posts to `entity.account_id`. **No posting path reads a GL code.**

### 6.3 Numbering policy options (owner decision)

| Option | Main Treasury GL | Default Bank GL | Notes |
|---|---|---|---|
| **N1 (recommended now)** | keep **1110** | keep **1120** | Zero data migration. Routing via entity is backward-compatible (identical GL while main = 1110). Tree stays: 1110/1120 under 11, named treasuries under 111/112. |
| N2 (clean tree) | **1111** under 111 | **1121** under 112 | 1110/1120 are not created for new tenants, or are created inactive. Needs all §4 production paths removed first, plus read paths on the entity-linked set. Existing tenants keep 1110/1120 as legacy treasuries. |
| N3 (after approved reset) | as N2 | as N2 | Only after the owner approves an experimental-data reset; then N2 for all tenants. |

Policy in all options: system defaults get fixed, documented codes; user treasuries get the next child code under 111/112 (existing `nextAccountCode`); codes never drive behaviour; `unique(tenant_id, code)` is the guard.

---

## 7. Migration and backward compatibility

- **Historical journals stay on 1110/1120.** No re-posting and no reassignment. Reports must aggregate the entity-linked set ∪ {1110, 1120}.
- **Routing change is behaviour-neutral by default.** For every existing tenant the main cash/bank entity *is* 1110/1120 (migration 000070 backfill + bootstrap), so "main treasury" posts to the same GL as today. Differences appear only after a user picks another treasury or moves `is_main`, which is the desired behaviour.
- **New nullable treasury columns** (credit notes, returns, expenses, assets, payroll runs, purchases) are additive. NULL = "apply the default policy at post time". No backfill of posted documents.
- **Column semantics hazard:** the existing `cash_account_id` columns hold **GL ids**; gateway settlement holds an **entity id**. New columns should pick one convention (recommend entity id, `cash_bank_account_id` with FK), and existing ones keep their meaning.
- **ZATCA unchanged [C]:** `ZatcaCreditNoteInputFactory` reads only `refund_type` (PaymentMeans 10), never a GL account. The invoice XML has no GL data. Chain/ICV/PIH code is untouched by any proposed change. Each PR should still run the ZATCA suites on both engines.
- Rollback for each PR = code revert (additive columns are harmless if unused).

---

## 8. Security and tenant-isolation risks

| # | Risk | Severity | Status |
|---|---|---|---|
| S1 | Deposit/withdraw scopes **not enforced** on the 7 hard-coded paths. A user barred from withdrawing from the main treasury can still credit 1110 through expenses, assets, payroll, credit notes, returns or POS exchange. | High (control bypass) | [C] |
| S2 | Treasury administration (create, scopes, make-main, transfers, payment methods) needs only `payments.manage` (accountants by default). No dedicated permission, no application gate. | Medium (owner decision) | [C] |
| S3 | `GET /payment-methods` has write side-effects (provisioning, re-seeding). | Low–Medium | [C] |
| S4 | No tenant-scoped `Rule::exists` in requests; isolation relies on `TenantScope` (holds for every path inspected). | Low | [C] |
| S5 | Gateway settlement accepts a **cash** treasury as the bank leg. | Low–Medium | [C] |
| S6 | Concurrent `makeMain` / payment-method make-default have no row lock: the first errors on the partial unique index, the second can yield two defaults. | Low | [C] code, [H] effect |
| S7 | POS checkout may pass a null actor to `assertAllowed`; only `all`-scope treasuries pass. | Low | [C] |
| S8 | Cash-flow report and dashboard omit named treasuries, so management numbers are wrong once a second treasury is used. | Medium (reporting correctness) | [C] |

---

## 9. Recommended PR sequence (smallest first, each independently testable on SQLite + PostgreSQL)

| PR | Scope | Tests | Accounting effect |
|---|---|---|---|
| **T1** | Deadlock fix: lock-free fast path in `bootstrapDefaults()` (+ anchor-first / NO KEY UPDATE slow path) | PG forks D1–D5; SQLite idempotency; restore cash invoices in the 3c PG test | None |
| T2 | Read side: cash-flow report + dashboard on entity-linked set ∪ {1110, 1120} | Named treasury included; internal transfers net to zero | Report-only |
| T3 | One posting resolver contract (`resolveForPosting(entity or GL id, type, action, actor)`) with a declared NULL policy; no provisioning inside it | Unit tests: invalid → throws, NULL → policy, inactive → throws, cross-tenant → not found | None |
| T4 | Cash sales invoice routes to the selected/main cash treasury (`invoices.cash_account_id` already exists); picker uses `/cash-bank-accounts` | Main ≠ 1110 posts to the chosen GL; deposit scope; ZATCA unchanged | Dr chosen treasury instead of fixed 1110 |
| T5 | Sales credit note + debit note cash side, sales returns (POS: session treasury), POS exchange surplus | Withdraw/deposit scope; ZATCA 381 suites unchanged; POS drawer = GL | Cr chosen treasury instead of 1110 |
| T6 | Paid purchases: pass treasury selection | Supplier side unchanged | Cr chosen treasury |
| T7 | Expenses + assets: treasury picker + withdraw scope | Expense/asset VAT unchanged | Cr chosen treasury |
| T8 | Payroll pay: treasury picker + scope | | Cr chosen treasury |
| T9 | `TreasuryProvisioningService` + `system_key` + backfill command; remove provisioning from hot paths | New-tenant provisioning, idempotent re-run, concurrent provisioning | None |
| T10 | Dedicated treasury permissions / application gate (if approved) | RBAC matrix | None |
| T11 | (Only with explicit owner approval) experimental-data reset and numbering N2/N3 | — | Data |

Gateway settlement type check (S5), the one-default-payment-method constraint (S6) and treasury opening balances (6c) are small follow-ups to schedule after T9.

---

## 10. Decisions requiring owner approval

1. **D-T1:** Approve T1 as specified (fast path; also anchor-first plus NO KEY UPDATE in the slow path?).
2. **D-T2:** Numbering policy: N1 now (keep 1110/1120 as the defaults' GL), N2 for new tenants, or N3 after a reset.
3. **D-T3 (configurable-policies rule):** behaviour when a document has no explicit treasury:
   - (a) main of type (today's voucher behaviour);
   - (b) require explicit choice;
   - (c) per-branch or per-user default treasury.

   Recommend (a) as the default, with (c) later.
4. **D-T4:** Re-seeding of payment methods after the user deleted them all: keep, or record "seeded once" and never re-seed.
5. **D-T5:** Dedicated treasury permissions (`treasury.view/manage/transfer`) or keep `payments.*`.
6. **D-T6:** Convention for new treasury columns: entity id (recommended) or GL id like the existing `cash_account_id`.
7. **D-T7:** Add `cash_bank_accounts.system_key`.
8. **D-T8:** Whether and when to reset experimental data (no reset is authorized by this audit).

---

## 11. Next implementation prompt (proposed, for T1 only)

> **AWJ ERP: Treasury T1, eliminate the cash-account bootstrap deadlock.** Start from current main. In `CashBankAccountService::bootstrapDefaults()`, add a read-only fast path that returns without any row lock when the tenant is already provisioned: for each of 1110/1120, the GL account is absent or already linked; and payment methods exist or a main cash/bank entity is missing. In the remaining slow path, lock the tenant anchor first, then the account rows with `FOR NO KEY UPDATE`. Do not change journal lines, VAT, uniqueness, numbering, ZATCA or any posting path. Add PostgreSQL `pcntl_fork` tests:
> - cash invoice vs cash sales credit note;
> - cash invoice vs paid credit invoice;
> - anchor-held bootstrap vs cash invoice;
> - six concurrent first-time bootstraps (exactly 2 entities, 2 mains, 4 methods).
>
> All must show 0 × 40P01 and must fail on current main. Add a SQLite idempotency test and restore cash invoices in `ZatcaCreditNoteIssuancePostgresTest`. Run the full suite on both engines, show that no accounting entry changes, open one Draft PR, and stop. No merge, deploy, data reset, tenant activation or ZATCA transmission.

---

## 12. Inspected files

- **Backend:**
  - `app/Services/Accounting/`: `CashBankAccountService`, `CashBankTransferService`, `InvoiceService` (post/settle/credit-limit), `CreditNoteService`, `ReturnService`, `PosExchangeService`, `PosService`, `PosSessionService`, `PaymentService`, `CustomerRefundService`, `SupplierRefundService`, `PurchaseService` (settle), `ExpenseService`, `AssetService`, `PayrollService`, `EmployeeCustodyService`, `PaymentGatewaySettlementService`, `LedgerService`, `AccountingDateGuard`, `ChartOfAccountsSeeder`, `AccountRoleMappingSeeder`, `VatRoleIntegrityService`, `ArApControlBalanceService`;
  - `app/Services/Reporting/ReportService.php`;
  - `app/Models/`: `CashBankAccount`, `CashBankTransfer`, `PaymentMethod`;
  - `app/Http/Controllers/Api/`: `AuthController`, `CashBankAccountController`, `PaymentMethodController`, `PaymentController`, `InvoiceController`, `EmployeeCustodyController`;
  - the related FormRequests, `app/Support/Rbac.php`, `routes/api.php`, `app/Support/ZatcaCreditNoteInputFactory.php`.
- **Migrations:** `2025_01_01_000002`, `000024`, `000054`, `000055`, `000070`, `000071`, `000075`, `000077`, `2026_08_27_040000`, `2026_09_08_010000`, `2026_09_12_010000`, `2026_09_21_030000`.
- **Frontend:**
  - `web/src/app/(app)/`: `cash-and-bank/**`, `payment-methods/page.tsx`, `dashboard/page.tsx`, `expenses/new/page.tsx`, `employee-custodies/new/page.tsx`;
  - `web/src/components/`: `invoices/invoice-form.tsx`, `payments/*-payment-form.tsx`, `treasury/access-rules.tsx`, `layout/sidebar.tsx`;
  - `web/src/modules/treasury/access.ts`, `web/src/messages/ar.json`, `web/src/lib/mock-data.ts`.
- **Tests:** `tests/Feature/ZatcaCreditNoteIssuancePostgresTest.php` (harness reused for the probe), plus the counts of 1110/1120 references across `tests/`.

## 13. Verification commands and results

| Command (local overlay, PostgreSQL 16 / SQLite) | Result |
|---|---|
| `git fetch origin main && git checkout -B audit/treasury-banking-phase0 origin/main` | HEAD `6c9efaef…` |
| `grep -rnE "['\"](1110\|1120)['\"]" app routes config` | 18 hits (table §4) |
| `grep -rcE … tests` | 174 hits / 44 files |
| `php artisan test --filter=ScratchTreasuryDeadlockProbeTest` (pgsql, baseline) | D1 deadlock; D2 8/16; D3 10/16; D4 deadlock; D5 idempotent |
| same with V1 (`FOR NO KEY UPDATE`), ×2 | D1/D2 0; **D3 12/16, 14/16; D4 deadlock** |
| same with V2 (fast path), ×2 | **0 deadlocks in D1–D4**; D5 2/2/4 |
| `php artisan test --filter='CashBank\|PaymentMethod'` (sqlite) | 15 passed |
| `php artisan test --filter='CashBank\|PaymentMethod\|ZatcaCreditNoteIssuancePostgresTest'` (pgsql) | 21 passed |
| `cmp` overlay `CashBankAccountService.php` vs repo after probes; probe test deleted | identical; repository `git status` clean |

The full suite was not run, because no repository code changed.

## 14. Risks and blockers

- **Blocker for production treasury routing:** S1 (scope bypass) and the hard-coded paths. Until T4–T8 land, choosing a non-1110 main treasury makes cash sales/refunds/expenses land in different GL accounts than vouchers. That is a reporting and control inconsistency, not a ledger imbalance.
- **The deadlock is live on `main`** for any tenant posting cash invoices concurrently with cash credit notes or paid invoices. The user sees a 500/40P01 and the transaction rolls back. No partial data was observed, because every failed transaction rolled back.
- The flow matrix comes from code reading. Only the deadlock and provisioning behaviours were executed.
- The local PostgreSQL cluster needed restarting after session resume. That is an environment fact, not a product issue.

## 15. Next recommended action

Owner reviews §10. If D-T1 is approved, run the §11 prompt (T1) as one small Draft PR, then T2 (read side), then T3–T8 in order.
