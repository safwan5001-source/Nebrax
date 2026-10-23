# TREASURY-T4: cash sales invoice treasury routing (safe implementation, closed by default)

| | |
|---|---|
| Owner decisions applied | D-T3 `MainOfType` default policy, explicit selection first; D-T4a honour and validate the cash invoice's `cash_account_id`; D-T4b no activation before refunds and credit notes are safe; D-T4c setting `sales.cash_sale_treasury_policy` that changes nothing in production by itself |
| Audit | `TREASURY-T4-CASH-SALE-ROUTING-AUDIT-AND-DECISION.md` (PR #1633; its three review threads were fixed and resolved) |
| Not done | merge, deploy, production activation, database migration, data reset, tenant activation, ZATCA transmission |
| Base / Head | see the PR description (filled at hand-over) |

## 1. What ships, and what does not change

| Item | Behavior |
|---|---|
| Production posting today | **Unchanged.** Setting default is `legacy` for every tenant; a direct cash invoice still debits 1110 and `cash_account_id` is still ignored for it. |
| Activation | Behind a deployment gate: `config('treasury.cash_sale_routing_enabled')` (env `TREASURY_CASH_SALE_ROUTING_ENABLED`, default `false`). While closed: the effective policy is `legacy` whatever is stored, and `PUT /sales-settings` rejects any other value with 422. |
| Routed behavior (gate open and policy `main` / `explicit_required`) | Posting goes through `TreasurySelectionResolver` (T3). Explicit `cash_account_id` (ledger account) wins and is validated; no selection resolves to the main cash treasury (`main`) or is rejected (`explicit_required`). Deposit authorization is checked on the **resolved** entity. **No fallback to 1110 on any failure.** |
| Refund protection | `CashSaleRefundGuard` rejects a cash credit note or cash return whose source cash invoice was collected outside 1110. Zero effect while every cash sale is on 1110. |
| Schema, permissions, ZATCA | None changed. No migration. |

## 2. Changed files

| File | Change |
|---|---|
| `config/treasury.php` (new) | Deployment gate, default `false`. |
| `app/Support/CashSaleTreasuryPolicy.php` (new) | Policy values, `effective()` (gate-aware), mapping to the T3 policy enum. |
| `app/Support/Settings.php` | New `sales` default `cash_sale_treasury_policy = 'legacy'` (existing settings infrastructure; no migration). |
| `app/Http/Requests/UpdateSalesSettingsRequest.php` | Validation of the key; non-`legacy` rejected while the gate is closed. |
| `app/Http/Controllers/Api/SalesSettingsController.php` | Adds read-only `cash_sale_treasury_routing_available` and `cash_sale_treasury_policy_effective` to the response. |
| `app/Support/TreasurySelectionException.php` | Additive reason `currency_mismatch` (thrown by the cash-sale branch, never by the resolver). |
| `app/Services/Accounting/InvoiceService.php` | `post()` debit account via `cashSaleDebitAccountId()` (legacy branch is the previous code verbatim); draft-time validation of an explicit selection in `create()`/`update()` when the policy is routed. |
| `app/Services/Accounting/CashSaleRefundGuard.php` (new) | Read-only fail-closed guard. |
| `app/Services/Accounting/CreditNoteService.php`, `ReturnService.php` | One guarded call each, only for cash refunds with a source invoice. |
| `web/src/lib/cash-sale-treasury.ts` (new), `web/src/components/invoices/invoice-form.tsx` | Cashbox selector on the invoice form; shown only when the effective policy is not `legacy`, the invoice is cash-type and not "paid". Payload unchanged otherwise. |
| `web/src/app/(app)/sales-settings/invoices/page.tsx`, `web/src/messages/{ar,en}.json` | Policy select; the two routed options are disabled while the gate is closed. |
| Tests | `tests/Feature/TreasuryCashSaleRoutingTest.php` (new, 27), `TreasurySelectionResolverTest` (static guard now allows `InvoiceService` only), web: `cash-sale-treasury.test.ts` (new), `invoice-form.test.tsx` (+6), `sales-settings/invoices/page.test.tsx` (new, 3). |
| `CLAUDE.md`, this report | Documentation. |

## 3. Before and after journal entries (halalas; invoice 1,000.00 + 15% VAT = 115000)

Every row is asserted by `TreasuryCashSaleRoutingTest` on SQLite and PostgreSQL. Revenue and VAT lines (Cr 4110 100000, Cr 2120 15000) are identical in every row; only the debit account can differ.

| # | Scenario | Before (current `main`) | After, gate closed (production today) | After, gate open + `main` | After, gate open + `explicit_required` |
|---|---|---|---|---|---|
| 1 | Default tenant, main = 1110, no selection | Dr 1110 | **Dr 1110** (identical) | **Dr 1110** (entry identical to the legacy one) | 422 `explicit_required`, draft kept |
| 2 | Main moved to 1111, no selection | Dr 1110 | **Dr 1110** | **Dr 1111** | 422 `explicit_required` |
| 3 | Explicit `cash_account_id` = 1111 (cash invoice) | Dr 1110 (field ignored) | **Dr 1110** | **Dr 1111** | **Dr 1111** |
| 3b | Explicit 1110 while main = 1111 | Dr 1110 | Dr 1110 | Dr 1110 | Dr 1110 |
| 4a | Selection is a bank account / unlinked 111x / non-treasury GL / `'1110'` text | Stored, ignored, Dr 1110 | Stored, ignored, Dr 1110 | 422 `wrong_type` / `not_found`, at save and at post | same |
| 4b | Inactive treasury, or ledger account inactive / group / non-asset | Dr 1110 (ignored) or 422 if the 1110 entity is inactive | same as before | 422 `inactive` / `gl_account_inactive` / `gl_account_invalid`; no entry | same |
| 4c-bis | Resolved treasury in a currency other than the tenant's (e.g. a USD cashbox, selected or main) | Dr 1110 | Dr 1110 | **422 `currency_mismatch`** (at save for an explicit selection, and at post); no conversion, no entry, never 1110 | same |
| 4c | Main inactive / no main (several candidates) / no main (one candidate) | Dr 1110 | Dr 1110 | 422 `inactive` / `ambiguous_default` / `no_default`; **never 1110** | same |
| 5 | Treasury of another tenant | API 422; ignored by the service | same | API 422; service `not_found` (same message as unknown id); a draft seeded with it by raw SQL is rejected at post | same |
| 6 | Deposit scope restricted to another user on the resolved treasury | Checked on the 1110 entity | same | 422 `not_permitted`, draft kept, no entry, no ICV | same |
| 7 | Re-post a posted invoice | "not a draft", 1 entry | same | same | same |
| 8 | Failed post (any rejection above) | whole transaction rolled back | same | rolled back: `draft`, no `journal_entry_id`, no ICV, no chain entry | same |
| 9 | Main or policy changes after posting | n/a | n/a | earlier entries byte-identical (account ids, amounts), `zatca_hash` unchanged | same |
| 10 | `is_paid` invoice (not touched by T4) | Dr 1130, then receipt Dr treasury / Cr 1130 | same | same | same |

### Refund consistency (D-T4b)

| Scenario | Entry |
|---|---|
| Cash credit note on an invoice posted **before** activation (Dr 1110), after the main moved and the policy is `main` | Posts as today: Dr 4110 100000, Dr 2120 15000, Cr 1110 115000. |
| Cash return on the same kind of invoice | Posts as today: Cr 1110. |
| Cash credit note / cash return on an invoice collected in **1111** | **Rejected** (422, message names 1110 and the credit alternative); draft kept; no entry. |
| Credit-type credit note / return on that invoice | Posts normally (customer credit, then a payment voucher from the right treasury). |
| Legacy tenant, gate closed | Unchanged. |

## 4. Tests

| Run | Result |
|---|---|
| `TreasuryCashSaleRoutingTest` + `TreasurySelectionResolverTest` | 48 passed on SQLite and 48 on PostgreSQL 16 |
| Mutations | removing the credit-note guard, ignoring the gate, or adding a silent fallback to 1110 each make the matching tests fail (the silent-fallback mutation fails eight or more tests) |
| Web: `cash-sale-treasury.test.ts`, `invoice-form.test.tsx`, `sales-settings/invoices/page.test.tsx` | passed; full `vitest`: 677 files, 8036 tests passed; `tsc --noEmit` shows no error in touched files |
| Full SQLite suite (local) | 8547 passed, 200 skipped, 27 failed (known set below) |
| Full PostgreSQL suite, `--parallel --processes=4` (local) | 8774 tests, 27 failing (the same known set) |
| CI | see PR |

Known local failures, none touching treasury, invoices or refunds: 26 `Fuel*` tests (`bcmath` missing in this sandbox; CI has it) and `AiPaidProviderDisabledTest` (SQLite) / `StorefrontMediaApiTest` (PostgreSQL), which also fail on `main`.

VAT and ZATCA: totals, `tax_amount`, `discount`, `shipping`, `adjustment` are equal between a legacy and a routed invoice; the ZATCA XML contains no treasury id or code; ICV is sequential and the PIH equals the previous hash. The existing invoice, credit note, chain, signing and integrity suites run unchanged inside the full runs.

## 5. Accounting risks

| Risk | Status |
|---|---|
| Refund asymmetry (sale into 1111, refund from 1110) | **Contained by the guard (fail closed), not solved.** Solved only by routing refunds (T5/T6). |
| Standalone credit notes and free returns have no source invoice | Not covered by the guard (no collection reference). Same exposure as any cash refund today. |
| Credit-type invoices paid in cash and later refunded in cash | Pre-existing, independent of T4 (receipt goes to the chosen treasury, refund to 1110). Belongs to T5/T6. |
| Draft carrying an ignored `cash_account_id` | Becomes effective only after activation; invalid values then fail closed. The audit's read-only scan lists them before activation. |
| Authorization moves from the 1110 entity to the resolved entity | Intended, only after activation. |
| Tenants with no usable main would be rejected after activation | Intended (`no_default` / `ambiguous_default` / `inactive`), listed by the audit's query. |
| Currency | The routed branch rejects a treasury whose currency differs from the tenant currency (`currency_mismatch`); the generic T3 resolver is unchanged. Receipts, payment vouchers and refunds have no such check today (pre-existing, T5/T6 should adopt it). |
| Concurrency | Resolver is read-only; the legacy lock order is untouched; `bootstrapDefaults()` fast path keeps the T1 guarantees. Main changing between resolve and post is benign under READ COMMITTED (the invoice posts to the treasury it resolved). |

## 6. Remaining activation conditions (all required, separate approval)

1. **T5/T6:** cash credit note and cash return post to the treasury that collected the sale (or an explicitly chosen one), with the same resolver; then the refund guard becomes a consistency check.
2. Owner runs the two read-only scans from the audit (tenants whose main is not 1110 or missing; drafts with `cash_account_id`) and decides per tenant.
3. A change record to set `TREASURY_CASH_SALE_ROUTING_ENABLED=true` (code is already deployed and inert), followed by per-tenant opt-in from sales settings.
4. Rollback is a settings change back to `legacy` (or closing the gate): posted entries are never rewritten.

## 7. Recommended next step

TREASURY-T5: route cash credit notes (and T6 returns) through the same resolver, with before/after entries and the same closed-by-default gate.
