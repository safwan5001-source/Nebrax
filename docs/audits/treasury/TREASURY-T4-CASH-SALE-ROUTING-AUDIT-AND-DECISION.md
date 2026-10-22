# TREASURY-T4: cash sales invoice routing. Audit and D-T3 decision record

| | |
|---|---|
| Type | **Audit and decision report only.** No posting, schema, permission or ZATCA change. The resolver is **not** wired into any path. |
| Base | `origin/main` @ `a9686bc40` (includes TREASURY-T3, #1627) |
| Scope read | `InvoiceService::post/create/update/settle`, `InvoiceController`, `StoreInvoiceRequest`, `PaymentService::post/resolvePaymentSetup`, `CashBankAccountService::resolveForPayment/assertAllowed`, `CashBankAccount::allows`, `TreasurySelectionResolver` and its tests, `PosService`, `FuelSaleService`, `QuoteService`, `RecurringInvoiceService`, `PublicInvoiceController`, the web invoice form, the ZATCA builders |
| Evidence method | A throw-away probe test (not committed) ran seven scenarios against the **current** code on **SQLite and PostgreSQL 16**. Both engines produced identical entries. |
| Not done | merge, deploy, data reset, migration, tenant activation, ZATCA transmission, any posting change |
| Status | **Blocked on owner decision D-T3 (section 6).** Implementation (section 8) starts only after explicit approval. |

## 1. Summary

1. **Only one path hard-codes 1110 for a sale:** a direct cash invoice (`payment_type=cash`, no `is_paid`) posted by `InvoiceService::post()` (`ACC_CASH = '1110'`, line 929). The treasury entity *behind* 1110 is resolved and authorized, but the **debited account is always 1110**.
2. **The "paid" path is already treasury-aware.** `is_paid=true` forces the invoice to `credit` (Dr 1130) and then posts a receipt voucher through `PaymentService`, which debits the selected or main treasury. POS checkout, fuel sales, quote conversion, recurring invoices and the public API either create credit invoices or leave drafts. In production code the **only** caller that posts a `payment_type=cash` invoice is `InvoiceController::post` (a human with an actor).
3. **`invoices.cash_account_id` already exists and is already validated for tenant ownership, but it is silently ignored for `payment_type=cash`.** It stores a ledger account id and is read only by the `is_paid` receipt. A user (or API client) who sets it on a cash-type invoice sees no effect and no error.
4. **Current inconsistency this task exists to remove:** a tenant whose main cash treasury is not 1110 posts cash invoices to 1110, but receipts, POS tenders and supplier payments to the main treasury.
5. **No ZATCA dependency:** none of the ZATCA builders (`ZatcaService`, `ZatcaMonetaryXml`, `ZatcaPartyXml`, signing, chain allocator) reads the debit account, a journal line or `cash_account_id`. Totals, VAT, hash, QR and XML are independent of which treasury is debited.
6. **Recommendation:** `MainOfType` when nothing is selected, explicit selection always honoured, no fallback to 1110, exposed as a tenant setting with default `main` (section 6). Land it **together with or immediately before** the credit-note and return refund routing, because otherwise a sale into 1111 would be refunded out of 1110 (risk R1).

## 2. Phase 1: current behavior (confirmed in code and by probe)

### 2.1 Paths involved

| # | Path | Where | Treasury behavior today |
|---|---|---|---|
| P1 | Create or update a cash invoice draft | `InvoiceService::create/update`, `StoreInvoiceRequest` | `payment_type=cash`; `cash_account_id` accepted (`uuid`), tenant-owned `Account` asserted in `InvoiceController::store/update`, stored on the invoice. **Never read again for cash type.** |
| P2 | **Post a cash invoice** | `InvoiceService::post()` lines 929 to 942 | `debitAccountId = accountId('1110')`, then `resolveForPayment(thatGlId, 'cash')` (also runs `bootstrapDefaults()`), then `assertAllowed($entity, 'deposit', $actor)`. Journal: Dr 1110. |
| P3 | Post an `is_paid` invoice | `InvoiceService::settle()` to `PaymentService::create/post` | Invoice forced to `credit` (`paymentType()`); invoice entry Dr 1130; receipt voucher Dr `cash_account_id` (a ledger id) or the main treasury of the method type, Cr 1130. Already routed. Out of scope for T4. |
| P4 | POS checkout | `PosService::checkout` | Creates `payment_type=credit`, posts, then one receipt per tender through the payment methods. Already routed. |
| P5 | Fuel sale | `FuelSaleService` | `payment_type=credit`. Already routed. |
| P6 | Quote convert / recurring invoice / public API | `QuoteService`, `RecurringInvoiceService`, `PublicInvoiceController` | Create **drafts** only (they may carry `payment_type=cash`); posting happens later through P2 by a human. Public API drops `cash_account_id` structurally. |
| P7 | Reversal and retry | below | below |

**Reversal.** There is no invoice void or cancel route. A posted cash sale is corrected by a credit note or a sales return. Those services (`CreditNoteService`, `ReturnService`, lines 51/73) credit **hard-coded 1110** for cash refunds; they are later slices (T5/T6), not T4. `LedgerService::reverse()` mirrors the original accounts (swaps Dr/Cr), so a reversal of an entry posted to 1111 would credit 1111. Re-routing never rewrites a posted entry.

**Retry and idempotency.** `post()` runs in one transaction: `Invoice::lockForUpdate` plus a draft re-check (concurrent double post is rejected), then the treasury check, ledger post (tenant anchor), COGS, ZATCA chain reserve and record, and the invoice update. Any exception rolls everything back (probe S4: status stays `draft`, 0 journal entries, no ICV consumed). Re-posting a posted invoice throws "not a draft" and leaves exactly one entry (probe S7). ZATCA ICV/PIH come from `ZatcaChainAllocator` under the anchor, unchanged by this topic.

### 2.2 Does an existing field or API already support the selection?

| Question | Answer |
|---|---|
| Invoice API field | Yes: `cash_account_id` (`uuid`, nullable) in `StoreInvoiceRequest`, echoed in `InvoiceResource`. |
| Database column | Yes: `invoices.cash_account_id`. **No migration needed.** |
| Semantics | A **ledger account id** (`accounts.id`), not a `cash_bank_accounts.id`. Maps to `TreasurySelection::ledgerAccount()`. |
| Validation | Controller asserts it is a tenant-owned `Account`; the type (cash vs bank) and activity are checked later by `PaymentService`, only on the `is_paid` path. |
| Service support for cash type | **None.** `post()` never reads it for `payment_type=cash`. |
| UI | The web form sends `cash_account_id` **only when "paid" is ticked** (`cash_account_id: isPaid ? cashAccountId : null`); there is no treasury control for a cash-type invoice. |
| Resolver | `TreasurySelectionResolver` (T3) is ready and covered by 21 tests; zero production callers (guarded by a static test). |

## 3. Phase 2: accounting impact (amounts in halalas; invoice 1,000.00 + 15% VAT = 1,150.00 SAR)

"Before" rows are **observed** from the probe on SQLite and PostgreSQL. "After" rows are the proposed behavior; the resolver outputs were also observed, but no posting was changed.

| # | Scenario | Before (current code) | After, `MainOfType` | After, `ExplicitRequired` |
|---|---|---|---|---|
| 1 | Default tenant, main cash treasury linked to 1110, nothing selected | Dr 1110 115000 / Cr 4110 100000 / Cr 2120 15000 | **Identical** | Rejected `explicit_required` unless the client sends 1110 (then identical) |
| 2 | Main cash treasury moved to custom account 1111, nothing selected | Dr **1110** 115000 / Cr 4110 100000 / Cr 2120 15000 (main ignored) | Dr **1111** 115000 / Cr 4110 100000 / Cr 2120 15000 | Rejected `explicit_required` |
| 3 | Explicit treasury 1111 (`cash_account_id` = 1111's ledger id) on a cash-type invoice | Dr **1110** (field stored and ignored) | Dr **1111** | Dr **1111** |
| 4a | 1110 entity inactive | `RuntimeException` "الخزينة ... معطّل", status `draft`, **0 entries** | Posts to the main (1111) if the main is active | As scenario 3 only |
| 4b | Main treasury inactive | Not consulted today (posts to 1110 if its entity is active) | Rejected `inactive`; **no** substitution, **no** fallback to 1110 | Not applicable |
| 4c | No main, or several candidates without a main | Not consulted today | Rejected `no_default` / `ambiguous_default` | Rejected `explicit_required` |
| 4d | Tenant not provisioned | `bootstrapDefaults()` provisions 1110/1120 entities first (T1 fast path), then posts to 1110 | Same provisioning first (kept), then main (= 1110 entity) | Same |
| 5a | Cash-type invoice that already carries `cash_account_id` | Ignored: Dr 1110 | Honoured: Dr that treasury; wrong type (a bank), inactive or group account is rejected, never swapped | Same |
| 5b | `is_paid` invoice with `cash_account_id` = 1111 (not changed by T4) | Invoice: Dr 1130 / Cr 4110 / Cr 2120. Receipt: Dr **1111** 115000 / Cr 1130 115000 | Unchanged | Unchanged |
| 5c | `is_paid`, no `cash_account_id`, main = 1111 (not changed by T4) | Receipt: Dr **1111** / Cr 1130 | Unchanged | Unchanged |
| 6 | Treasury id of **another tenant** | API: **422** at `assertTenantOwned`; service level: scoped lookup, no effect and no leak | Resolver `not_found` with the same message as an unknown id | Same |
| 7a | Retry of a **posted** invoice | `RuntimeException` "not a draft"; still exactly 1 entry | Unchanged | Unchanged |
| 7b | Failed post (any rejection above) | Whole transaction rolled back: `draft`, 0 entries, no ICV, no stock movement | Unchanged | Unchanged |
| 7c | Main changes **after** posting | Posted entry untouched | Posted entry untouched (account ids are stored on the lines) | Same |

Invariants in every row: Σ debit = Σ credit; revenue, VAT, shipping, adjustment and COGS lines are unchanged; only the **single debit account** can differ. The invoice total, `tax_amount`, `zatca_*` columns, XML, QR, hash chain and `issued_at` are computed before and independently of that account.

## 4. Existing tests that bind this area

| Test | Relevance |
|---|---|
| `InvoiceTest::cash_sale_entry_is_balanced_uses_correct_accounts_and_links_to_invoice` | Asserts Dr 1110 for the default tenant. Must stay green (scenario 1). |
| `ApiInvoiceTest` (PR-ACL-CASH-SALE x2) | Deposit-scope authorization on the cash entity, atomic rollback, "GL routing unchanged, still 1110" for the main = 1110 tenant. Must stay green; their comments need updating when routing changes. |
| `ApiInvoiceTest` / `InvoiceTest` (`is_paid`, `cash_account_id` cases) | The already-routed receipt path; must stay green unchanged. |
| `TreasurySelectionResolverTest` (21) | Contract and the static "no production caller" guard; the guard must be updated deliberately in the implementation PR (one allowed caller). |
| `TreasuryBootstrapDeadlockPostgresTest`, `CashBankBootstrapIdempotencyTest` | Lock order and provisioning (T1); the fast path must keep emitting no row locks. |
| `ZatcaPhase2Test`, `ZatcaSignedInvoicePostingTest`, `ZatcaCreditNoteRealServiceParityTest`, `ZatcaCreditNoteIssuancePostgresTest`, chain/integrity suites | Create cash invoices; must prove XML, QR, hash, ICV and PIH are byte-identical before and after. |
| `TreasuryAwareCashReportsTest` (17), `DashboardReceivablesPositionTest` | Reports already include entity-linked accounts, so a sale into 1111 appears in cash reports with no change. |
| `VatPosExchangeRoutingTest`, `ApiReportsTest`, `InvoiceCostCenterAllocationTest` | Reference 1110; confirm they use the main = 1110 tenant. |

Tests that **do not exist** and the implementation PR must add (SQLite and PostgreSQL): the scenario matrix of section 3 as posting tests, treasury-permission tests on the resolved entity, a cross-tenant posting test, a no-fallback test (inactive main, no main, ambiguous), a byte-identical ZATCA payload test for main = 1110 and main = 1111, a retry/double-post test, and a PostgreSQL concurrency test (cash invoice versus `makeMain`).

## 5. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Refund asymmetry.** After T4, a sale posts to 1111 but credit notes and sales returns still credit 1110 (hard-coded). 1111 is overstated and 1110 can go negative until those paths follow. | High | Ship T4 together with, or just before, the credit-note/return routing (T5/T6), or gate by the setting. State the pairing in the implementation PR. |
| R2 | **Authorization shift.** Today `deposit` scope is checked against the 1110 entity; afterwards against the resolved entity. A user allowed on 1110 but not on the main 1111 stops being able to post; the reverse becomes allowed. | Medium | Intended; document in the PR with a before/after permission test. No new permission rule is introduced. |
| R3 | **Stored-but-ignored `cash_account_id` on existing drafts.** An API client may have saved an id that was always ignored (for example a bank account). After wiring it would be honoured and fail with `wrong_type`. | Medium | Run the read-only scan (section 7) before approval; fail closed, never fall back to 1110, so no wrong money movement. |
| R4 | A blocked sale (1110 inactive) becomes a successful sale into the main. | Low | Intended outcome of `MainOfType`. |
| R5 | Main changes between resolve and post (READ COMMITTED). | Low | Resolver is read-only and runs before `ledger->post`; the invoice posts to the treasury it resolved. Document; no lock added. |
| R6 | Lock order regression. | Low | Keep `bootstrapDefaults()` (T1 lock-free fast path) before the resolver; the resolver takes no lock; the anchor stays first inside `LedgerService`. Verified by the existing PostgreSQL deadlock suite. |
| R7 | Double posting. | Low | Unchanged: row lock plus draft re-check plus single `ledger->post` per source. |
| R8 | ZATCA drift. | Low | No ZATCA code reads the debit account. Proven by a byte-identical payload test. |

## 6. Phase 3: D-T3 decision record

**Decision needed:** what happens on a cash-type sales invoice when no treasury is selected?

| | **Option A: `MainOfType`** | **Option B: `ExplicitRequired`** |
|---|---|---|
| Behavior | Omitted selection resolves to the tenant's main cash treasury; an explicit selection always wins. | Posting fails unless a treasury is chosen. |
| Backward compatibility | **Identical** for every tenant whose main cash treasury is the one linked to 1110 (all tenants that never changed the main). Changes only tenants whose main is not 1110. | **Breaks every existing cash-type draft**, every draft created through quote conversion, recurring invoices and the public API (none carry a treasury), and any integration that posts cash-type invoices. |
| Financial impact | Cash lands in the main drawer, consistent with receipts, POS tenders and supplier payments. For main = 1110 tenants: none. For others: the debit moves from 1110 to the main (see section 3, row 2), so past and future balances of 1110 and the main treasury differ by that flow. No retroactive rewrite. | None until a treasury is chosen; then as option A. |
| Operational consequence | No new field for users or clients; the UI needs no change. A behavior change only for tenants with a custom main. | Needs a **new UI control** (none exists for cash type), API contract change, client migration, and a decision for non-interactive paths. Adds a click to every cash sale. |
| Fits the configurable-policy rule (CLAUDE.md rule 6) | As the default. | As an opt-in. |
| Fails safe | Yes: `no_default`, `ambiguous_default`, `inactive` all reject; never 1110. | Yes. |

**Recommendation.** Adopt **Option A as the default** and expose **Option B as a per-tenant sales setting** (for example `sales.cash_sale_treasury_policy` = `main` (default) | `explicit_required`), because CLAUDE.md rule 6 says a business policy with more than one reasonable answer is a setting, not a hard-coded behavior, and this serves 60+ activity types. This is a settings key, not a schema change. Per-branch or per-user default treasury (option c of D-T3) stays out of scope: it needs a schema design.

**Decisions requested from the owner**

| ID | Decision | Recommended |
|---|---|---|
| D-T3 | Policy for T4: `MainOfType` default, explicit always wins, `ExplicitRequired` selectable per tenant | Approve as written |
| D-T4a | Honour `cash_account_id` on cash-type invoices (it is ignored today) | Yes, with fail-closed validation |
| D-T4b | Sequence T4 with the cash refund routing (credit note and return) to avoid risk R1 | Ship together, or T4 first behind the setting |
| D-T4c | Add the `sales.cash_sale_treasury_policy` setting now, or defer and use `MainOfType` only | Add now (small, avoids a later retrofit) |

## 7. Pre-approval read-only checks for the owner (production, no writes)

```sql
-- tenants whose main cash treasury is NOT the account coded 1110 (the only tenants whose postings would change)
SELECT t.id, t.slug, a.code AS main_cash_code
FROM tenants t
JOIN cash_bank_accounts c ON c.tenant_id = t.id AND c.type = 'cash' AND c.is_main
JOIN accounts a ON a.id = c.account_id
WHERE a.code <> '1110';

-- draft cash-type invoices carrying a (currently ignored) cash_account_id
SELECT i.tenant_id, count(*) AS drafts
FROM invoices i
WHERE i.status = 'draft' AND i.payment_type = 'cash' AND i.cash_account_id IS NOT NULL
GROUP BY i.tenant_id;
```

If both queries return nothing, the change is a pure no-op for existing data. I did not run them; this session has no production access.

## 8. Phase 4 plan (only after explicit approval)

1. `InvoiceService::post()` (lines 929 to 942 and the docblocks at 43 to 50, 868 to 872): for `payment_type=cash`, keep `bootstrapDefaults()`, then `TreasurySelectionResolver::resolve(selection, 'cash', policy, 'deposit', $actor)` where the selection is `ledgerAccount($invoice->cash_account_id)` when set, else `none()`. Debit `ResolvedTreasury::accountId`. Map `TreasurySelectionException` to the existing 422 path (optionally pass `reason` through, as the emergency-stop exception does). **No `catch` that falls back to 1110.**
2. Read the policy from `Settings` (only if D-T4c is approved), default `main`.
3. Update the single allowed caller in the T3 static guard test deliberately; add the tests listed in section 4; run SQLite and PostgreSQL, the invoice/accounting/ZATCA/treasury suites, and the full suite before the PR.
4. The PR must show the entries before and after for scenarios 1 to 4 in a table (the pre-PR protocol in CLAUDE.md), and must state the R1 pairing.
5. Affected files (expected): `app/Services/Accounting/InvoiceService.php`, `app/Support/Settings.php` (if D-T4c), `tests/Feature/TreasurySelectionResolverTest.php` (guard), a new `tests/Feature/TreasuryCashSaleRoutingTest.php`, comments in `tests/Feature/ApiInvoiceTest.php`, `CLAUDE.md`, a T4 implementation report. **No migration, no permission or role change, no ZATCA file.**

## 9. Next implementation step

Owner answers D-T3 and D-T4a to D-T4c. Then one Draft PR for the `InvoiceService::post()` cash-sale routing, with the pairing decision for the refund paths (T5/T6) stated up front.
