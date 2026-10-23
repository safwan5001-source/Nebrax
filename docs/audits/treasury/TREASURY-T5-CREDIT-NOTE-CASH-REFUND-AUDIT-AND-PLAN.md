# TREASURY-T5: cash refund of sales credit notes. Audit and implementation plan

| | |
|---|---|
| Type | **Audit and plan only.** No production code, schema, API or ZATCA change. The T4 gate stays closed. Nothing is merged or deployed by this report. |
| Branch | `claude/treasury-t5-audit` |
| Base SHA | `120defa05023c8d326ead6ed00eb2d138d0dc846` (`origin/main`, includes T3 #1627, T4 #1633 and #1635) |
| Head SHA | filled in the PR description when the docs PR is opened |
| Scope | Sales **credit notes** (`CreditNoteService`, `type = sales`, `refund_type = cash`). Out of scope: sales returns and POS exchange (T6), purchase debit notes (named in section 8 so they are not forgotten), reports, receipts |
| Data note | All current data is test data (owner statement). The plan therefore avoids compatibility machinery for historical rows; it still never rewrites a posted entry and keeps tenant isolation, ZATCA and API compatibility |
| Evidence | Code reading plus a throw-away probe (not committed) run on **SQLite and PostgreSQL 16**, with identical results on both |

## 1. Summary

1. A cash refund credit note credits the hard-coded account **1110** (`CreditNoteService::salesLines`, `ACC_CASH`). It never resolves a treasury entity, never checks the actor, never checks the currency.
2. Once the T4 gate opens, a sale collected in another cashbox (for example 1111) cannot be refunded in cash: the T4 `CashSaleRefundGuard` rejects it (fail closed). This is the activation blocker T5 removes.
3. **The correct treasury is fully determined by data we already store** for a cash-type source invoice: the account debited by the sale's journal entry. No new column is needed for the smallest safe slice.
4. A second, independent finding: **today any user with `invoices.manage` can refund cash out of a drawer whose `withdraw` scope excludes them**, because the refund path has no authorization at all (probe f). `CreditNoteController::post` does not even pass the actor to the service.
5. Direction matters: a sales credit note **withdraws** from the treasury (money out); the T4 sale was a **deposit**. A purchase debit note (cash) would be a **deposit**. The permission must follow the direction, never be shared.
6. ZATCA does not read the treasury account anywhere (issuer, input factory, XML, QR, hash, chain). Routing can change which account is credited without changing any ZATCA payload.
7. **Recommended smallest safe T5:** route sales credit-note cash refunds through the T3 resolver, deriving the treasury from the original sale entry; `withdraw` authorization on the resolved entity; currency check; same closed gate as T4; no migration, no API shape change. Details in section 6.

## 2. Phase 1: paths and files

| Path | File | Today |
|---|---|---|
| Create draft | `CreditNoteService::create`, `StoreCreditNoteRequest` | `refund_type` ∈ {credit, cash}. **No treasury field**, no `cash_account_id` column on `credit_notes`. Linked notes derive lines from the source invoice (`original_invoice_id`); standalone notes need `sales.allow_standalone_credit_notes`. |
| Post | `CreditNoteService::post` ← `CreditNoteController::post` | Locks note then source invoice, T4 guard for cash notes, re-derives lines, builds the entry in `salesLines()`, `LedgerService::post`, then the ZATCA issuer inside the same transaction. **The controller calls `post($note)` without the actor.** |
| Entry | `CreditNoteService::salesLines` | Dr 4110, Dr `tax_output`, Cr **1130** (credit) or Cr **1110** (cash), hard-coded by code. |
| ZATCA | `ZatcaCreditNoteIssuer`, `ZatcaCreditNoteInputFactory` | Eligible only when `refund_type = cash`; reads the note and the source invoice snapshot. No journal or account access (grep and code reading). |
| Escape hatch already treasury-aware | `CustomerRefundService` | A `credit` note followed by a refund voucher: `resolveForPayment` plus `assertAllowed(..., 'withdraw', $actor)`. This is the correct direction and permission, and it already exists. |
| Same guard family | `ReturnService::post` | T6, out of scope. It keeps using `CashSaleRefundGuard`. |
| No other mutation paths | routes | Credit notes have only `store` and `post`. There is **no update, delete, cancel, void or duplicate** route or service method, so there is no reversal or duplication path to route (confirmed in `routes/api.php` and `CreditNoteService`). |

Tests that bind this area: `CreditNoteTest`, `ZatcaCreditNoteIssuanceTest`, `ZatcaCreditNoteIssuancePostgresTest`, `ZatcaCreditNoteEmergencyStopApiTest`, `ZatcaCreditNoteRealServiceParityTest`, `ZatcaCreditNoteXmlTest`, `TreasuryBootstrapDeadlockPostgresTest` (cash notes against cash invoices), and `TreasuryCashSaleRoutingTest` (the T4 guard).

## 3. Confirmed findings

| ID | Finding | Severity | Status today |
|---|---|---|---|
| F1 | Cash refund credits 1110 regardless of where the sale was collected | **High once the T4 gate opens** (it is the reason the gate cannot open); none today | Contained by the T4 guard (rejection), not solved |
| F2 | **No treasury authorization on a cash refund.** The probe posts a cash credit note while the 1110 `withdraw` scope is restricted to another user: it posts. The service has no actor parameter, and the controller does not pass one | **Medium, exists today** | Open |
| F3 | No currency check on the credited treasury | Medium once routed (the credited account would be chosen by data, not code) | Open (T4 added it for the sale only) |
| F4 | Standalone notes (no invoice) and notes against credit-type invoices have no determinable collection treasury, and `credit_notes` has no field to carry a choice | Medium for the design (decision D-T5-2) | Open |
| F5 | The sale entry can contain **more than one debit line** (a negative adjustment debits `document_adjustment`, probe d: `1110 Dr 229500` and `5170 Dr 500`). Deriving the collection account must therefore pick the debit line whose account is a treasury entity, never "the first debit" | Low (design rule) | Open, handled in the plan |
| F6 | The negative-balance policy (`allow_negative_transfer_balance`) is enforced only by transfers. Refunds, vouchers and payments do not check it | Low, pre-existing, outside T5 | Open (decision D-T5-5) |
| F7 | Purchase **debit notes** with `refund_type = cash` debit 1110 the same way (a deposit, opposite direction) | Low (same class) | Open, not in this slice (section 8) |
| F8 | ZATCA independence confirmed: no ZATCA class reads a journal line or an account | Informational (good) | Confirmed |

## 4. Phase 1: accounting scenario matrix (halalas)

Credit note of 1 unit of a 2-unit sale at 1,000.00 + 15% VAT = 115000. Revenue/VAT lines (Dr 4110 100000, Dr 2120 15000) are identical in every row; only the credited account can differ. "Before" rows are **observed** by the probe on both engines. "After" is the proposed T5 behavior when the T4 gate is open and the tenant policy is not `legacy`; with the gate closed every row keeps its "Before" result.

| # | Scenario | Before | After (gate open) |
|---|---|---|---|
| 1 | Old cash invoice collected in 1110 | Cr 1110 | **Cr 1110** (derived account = 1110; identical entry) |
| 2 | Cash invoice routed to 1111 (T4 active) | Rejected by the T4 guard | **Cr 1111**, `withdraw` checked on the 1111 entity |
| 3 | Source treasury deactivated after the sale | n/a (1110 only) | Rejected `inactive`, no entry, no fallback. Use the existing escape hatch: a `credit` note, then a refund voucher from a chosen treasury |
| 4 | Source treasury currency differs from the tenant's | n/a | Rejected `currency_mismatch` |
| 5 | Source treasury moved from main to another entity after the sale | Cr 1110 | Cr the **original** account (the main is irrelevant to a linked refund) |
| 6 | Source invoice is credit-type (including `is_paid` = credit + receipt, and POS) | Cr 1110 (probe e) | No single collection account is derivable (several receipts are possible). Falls back to the tenant policy: `main` resolves the main cash treasury; `explicit_required` is rejected (see D-T5-2). POS refunds are T6 |
| 7 | Standalone note, `refund_type = cash` | Cr 1110 (probe g) | Same fallback as row 6 |
| 8 | Withdraw scope on the resolved entity excludes the actor | Posts (probe f, **no check**) | Rejected `not_permitted`, no entry, no ICV |
| 9 | Cross-tenant | n/a | Derivation reads only this tenant's entry and entities (scoped models); a foreign id never enters, because the id is derived, not accepted |
| 10 | Re-post a posted note | "not a draft", 1 entry | unchanged |
| 11 | Failed post (any rejection above) | whole transaction rolled back | unchanged: draft, no entry, no ICV, no chain entry |
| 12 | Credit-type refund (`refund_type = credit`) | Cr 1130 | unchanged |
| 13 | Gate closed or tenant on `legacy` | Cr 1110, no authorization | unchanged, byte for byte |

## 5. Direction and permission

| Operation | Money | Permission on the resolved entity | Path |
|---|---|---|---|
| Direct cash sale | in | `deposit` | T4 (merged) |
| **Sales credit note, cash refund** | **out** | **`withdraw`** | **T5** |
| Refund voucher / supplier payment | out | `withdraw` | already in place |
| Receipt voucher | in | `deposit` | already in place |
| Purchase debit note, cash refund | in | `deposit` | later (F7) |
| Internal transfer | both | `withdraw` on the source, `deposit` on the destination | already in place |

The two sides are never symmetric: a credit note must not reuse the sale's `deposit` check. `CashBankAccount::allows()` already takes the action as a parameter.

## 6. Phase 2: smallest safe T5 plan

**Design (simplest correct accounting):** for a posted, cash-type, linked source invoice the credit note refunds **from the treasury that collected the sale**. No new input, no new column.

1. `CreditNoteService::post(CreditNote $note, ?User $actor = null)`: add the optional actor (internal signature only; HTTP shape unchanged). `CreditNoteController::post` passes `$request->user()`.
2. Add a small read-only resolver step before `ledger->post` (so a rejection rolls back before any lock on the anchor, ICV or chain entry), active only when `CashSaleTreasuryPolicy::effective()` is not `legacy`:
   - **Derive**: take the source invoice's `journal_entry_id`; among its debit lines select the one whose account belongs to a `CashBankAccount` entity (rule from F5); `TreasurySelection::ledgerAccount($thatAccountId)`.
   - **Resolve** with the T3 resolver, `type = cash`, then `authorize = 'withdraw'` with the actor.
   - **Currency**: reuse the T4 check (extract it into one shared helper so sale and refund cannot drift).
   - Credit `ResolvedTreasury::accountId`. Any failure is a 422 with the T3 reason and a full rollback. **No fallback to 1110.**
3. For credit-type sources and standalone notes, apply the tenant policy through the same resolver (`none()`), per D-T5-2.
4. `CashSaleRefundGuard` stays for `ReturnService` (T6) and is no longer called from `CreditNoteService`, because the credit note now follows the sale instead of being rejected.
5. Same gate and setting as T4: `treasury.cash_sale_routing_enabled` and `sales.cash_sale_treasury_policy`; `legacy` and gate-closed behavior stay byte-identical (including the missing authorization, deliberately, until activation). No new setting is needed.
6. UI: none for linked notes. The credit-note form keeps its cash/credit choice; a rejection shows the existing error banner. Standalone cash under `explicit_required` shows the message that points to the credit-then-voucher route.
7. Files expected: `CreditNoteService.php`, `CreditNoteController.php`, a small shared helper next to `CashSaleRefundGuard` (or the guard itself), the T4 currency check moved into it, `InvoiceService.php` (call the shared helper), tests, `CLAUDE.md`, a T5 implementation report. **No migration, no new route, no permission or role change, no ZATCA file.**

**Why this is the smallest safe slice.** Everything it needs is stored today; it removes the activation blocker; it adds the missing `withdraw` authorization on the routed path only; and the credit-note/ZATCA code outside `salesLines` is untouched.

## 7. ZATCA and historical documents

- The issuer is atomic with the posting transaction and runs **after** the entry. Treasury resolution happens **before** the entry, so a rejection leaves no ICV, no chain entry and no `posted` row (same order as T4).
- XML, QR, hash, PIH and the chain do not contain the credited account (confirmed). Routing changes the journal only. A test must prove the generated document is byte-identical between a note refunded from 1110 and the same note refunded from 1111 (apart from the fields that differ per document: number, UUID, timestamps, ICV/PIH).
- The emergency-stop and rollout-control paths are untouched: the issuer still runs its checks after the entry, exactly as today. The treasury step runs **before** the entry, so a refusal on treasury grounds happens first and never reaches the issuer, the chain or the ICV.
- Posted notes and their entries are never rewritten. Notes posted before activation keep Cr 1110; the derivation applies only to notes posted from now on.
- Cash notes against sales that were **collected in 1110** are unaffected, which includes every sale made before the T4 gate opens.

## 8. Out of scope and why

| Item | Reason |
|---|---|
| Sales returns, POS returns and exchange | T6 (explicitly excluded) |
| Purchase debit notes (`Dr 1110`, a **deposit**) | Same class (F7) but opposite direction and different source (a purchase payment, not a sale entry). Recommended as **T5b** after T5, so each slice proves one direction |
| Receipts, vouchers, expenses, assets, payroll | Other T4+ slices |
| Opening the gate | Needs T5 and T6 plus the owner's activation decision |
| Negative-balance enforcement on refunds | A financial policy decision (D-T5-5), not a routing change |

## 9. Tests required (SQLite and PostgreSQL)

**Routing and entries**
- Old cash invoice on 1110 → Cr 1110, entry identical to today (scenario 1).
- Invoice routed to 1111 → Cr 1111 (scenario 2); a note against the same invoice after the main moved still credits 1111 (scenario 5).
- Sale with a negative adjustment (two debit lines) → derivation picks the treasury line (F5).
- Treasury deactivated / currency changed after the sale → rejected, no entry, no ICV (scenarios 3, 4).
- Credit-type and standalone sources under `main` and `explicit_required` (scenarios 6, 7); `refund_type = credit` unchanged (scenario 12).
- Gate closed and `legacy`: Cr 1110 byte for byte, including the absence of authorization (scenario 13).

**Permissions and isolation**
- `withdraw` scope variants (`all`, `role`, `user`, `branch`) on the **resolved** entity; a user allowed to deposit but not withdraw is rejected; null actor fails closed for restricted scopes.
- Cross-tenant: another tenant's treasury or invoice never resolves; derivation uses only scoped models.
- Controller passes the actor (HTTP test with a restricted user).

**Atomicity and concurrency**
- Re-post and failed post leave no trace (note stays draft, no entry, no ICV, no chain entry).
- PostgreSQL: concurrent cash note and cash invoice on the same drawer does not deadlock (lock order note → invoice → anchor is unchanged; the resolver takes no lock; `bootstrapDefaults` stays lock-free for provisioned tenants), and a cash note racing a deactivation/`makeMain`.

**ZATCA regression**
- `ZatcaCreditNoteIssuanceTest`, `ZatcaCreditNoteIssuancePostgresTest`, `ZatcaCreditNoteEmergencyStopApiTest`, `ZatcaCreditNoteRealServiceParityTest`, `ZatcaCreditNoteXmlTest` unchanged and green; plus the byte-identity test of section 7; a rejected treasury must leave the chain head and ICV unchanged.
- Existing T4 suites (`TreasuryCashSaleRoutingTest`, `TreasurySelectionResolverTest`) green; the static "only these callers use the resolver" guard updated deliberately for `CreditNoteService`.

Full local SQLite and PostgreSQL suites before the PR, as in T4.

## 10. Decisions needed before implementation

| ID | Decision | Recommendation |
|---|---|---|
| D-T5-1 | Refund treasury for a linked cash-type sale: derive strictly from the original sale, or allow an explicit override on the note (needs a new `credit_notes.cash_account_id` column and a UI selector) | **Derive strictly.** Fewer moving parts, matches the audit trail; an override can come later as its own slice |
| D-T5-2 | Credit-type source or standalone note with `refund_type = cash`: (a) use the tenant policy (`main` → main cashbox, `explicit_required` → rejected) or (b) always reject cash refund and require credit-then-voucher | **(a)**, because `explicit_required` then remains usable through the voucher route, and `main` behaves like every other cash path |
| D-T5-3 | Source treasury inactive: reject (recommended) or fall back to the main | **Reject**, no silent substitution; the credit-then-voucher route is the supported alternative |
| D-T5-4 | Controller/service signature: add an optional actor to `CreditNoteService::post` (internal) | Approve (needed for `withdraw`) |
| D-T5-5 | Apply the negative-balance policy to refunds | Not in T5; open a separate finance-policy slice |
| D-T5-6 | Purchase debit notes as **T5b** after T5 | Approve the split |
| D-T5-7 | Also add the missing authorization to the **legacy** path (gate closed) | **No.** It would change production behavior now; it arrives with the activation |

## 11. Next step

Owner reviews this report and answers D-T5-1 to D-T5-7. Then one Draft PR for T5 (credit-note cash refund routing) under the same closed gate, with before/after entries and the tests above.
