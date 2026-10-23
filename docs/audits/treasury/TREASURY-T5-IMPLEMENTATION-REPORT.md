# TREASURY-T5: cash refund of sales credit notes follows the collecting treasury (closed behind the T4 gate)

| | |
|---|---|
| Owner decisions applied | D-T5-1 derive strictly from the original sale entry · **D-T5-2 reject** direct cash refunds of standalone notes and notes against credit-type invoices, **whatever the tenant policy** · D-T5-3 inactive source treasury rejected, no fallback · D-T5-4 optional actor on `CreditNoteService::post` · D-T5-5 negative-balance policy not in T5 · D-T5-6 purchase debit notes are T5b · D-T5-7 no authorization added to the legacy path |
| Audit | `TREASURY-T5-CREDIT-NOTE-CASH-REFUND-AUDIT-AND-PLAN.md` (PR #1642, updated with the decisions) |
| Not done | merge, deploy, opening the T4 gate, any tenant activation, migration, API or ZATCA change, T6 (returns, POS exchange), purchase debit notes |
| Branch / PR / SHAs | see the PR description (filled at hand-over) |

## 1. What ships, and what does not change

| Item | Behavior |
|---|---|
| Production today (gate closed, `legacy`) | **Unchanged byte for byte:** a cash credit note credits 1110, with no treasury authorization, for linked, standalone and credit-sourced notes alike |
| Activation | The same T4 gate and setting: `treasury.cash_sale_routing_enabled` and `sales.cash_sale_treasury_policy` ≠ `legacy`. No new setting |
| Routed behavior (gate open, policy `main` or `explicit_required`) | The refund is credited to **the treasury that collected the sale** (derived from the sale's journal entry), after T3 resolution, a `withdraw` check on that entity, and a currency check |
| Rejected when routed | Standalone notes, notes against credit-type invoices (including paid-in-full and POS), sources whose entry has zero or several treasury debit lines, inactive or invalid source treasury, foreign currency, missing `withdraw` permission |
| Alternative for rejected cases | A `credit` note (Cr 1130), then a refund voucher from a chosen treasury (`CustomerRefundService`, already `withdraw`-checked) |
| Schema, routes, permissions, ZATCA | None changed. No migration, no new route. HTTP request/response shapes unchanged; the controller now passes the authenticated user to the service |

## 2. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/CreditNoteRefundTreasuryResolver.php` (new) | Read-only derivation + T3 resolution + `withdraw` + currency. Rules in its docblock. No `catch`, no `1110` |
| `app/Services/Accounting/TreasuryCurrencyGuard.php` (new) | One currency check shared by the T4 sale and the T5 refund |
| `app/Services/Accounting/CreditNoteService.php` | `post(CreditNote, ?User $actor = null)`; routed credit account resolved **before** the ledger entry; `salesLines()` takes the optional resolved account (fallback to 1110 exists only for the legacy branch); the T4 `CashSaleRefundGuard` call now runs on the legacy branch only |
| `app/Http/Controllers/Api/CreditNoteController.php` | `post(Request, id)` passes `$request->user()` |
| `app/Services/Accounting/InvoiceService.php` | Uses `TreasuryCurrencyGuard` (same behavior, shared code) |
| `app/Support/TreasurySelectionException.php` | Additive reasons `refund_source_required`, `source_treasury_unresolved` |
| Tests | `TreasuryCreditNoteRefundRoutingTest` (new, 21), `TreasuryCreditNoteRefundRoutingPostgresTest` (new, 2, forked processes), `TreasuryCashSaleRoutingTest` (two T4 cases updated, section 6) |
| `CLAUDE.md`, this report | Documentation |

## 3. Journal entries before and after (halalas; one unit of a sale of 1,000.00 + 15% VAT = 115000)

The Dr 4110 100000 and Dr 2120 15000 lines are identical in every row; only the credited account can differ. "Before" is the current `main` behavior (observed by the T5 audit probe on SQLite and PostgreSQL). "After" is asserted by the new tests.

| # | Scenario | Before | After, gate closed (production) | After, gate open + `main` or `explicit_required` |
|---|---|---|---|---|
| 1 | Cash sale collected in 1110 (old invoice), main later moved elsewhere | Cr 1110 | Cr 1110 | **Cr 1110** (entry identical to the legacy one; derived from the sale, not from the new main) |
| 2 | Cash sale routed to 1111 (T4 active) | Rejected by the T4 guard | n/a | **Cr 1111**, `withdraw` checked on 1111 |
| 3 | Same, after the main moved to 1112 | n/a | n/a | Cr 1111 (the main is irrelevant to a linked refund) |
| 4 | Sale entry with a negative adjustment (two debit lines: treasury and 5170) | Cr 1110 | Cr 1110 | Cr 1111 (only the treasury line is used) |
| 5 | Source treasury deactivated after the sale | n/a | n/a | **Rejected** `inactive`; note stays draft; no entry, ICV or chain change; no fallback |
| 6 | Source treasury or its ledger account inactive, group or non-asset | n/a | n/a | Rejected (`inactive` / `gl_account_inactive` / `gl_account_invalid`) |
| 7 | Source treasury in another currency | n/a | n/a | Rejected `currency_mismatch` |
| 8 | Source entry with several treasury debit lines, or none | n/a | n/a | Rejected `source_treasury_unresolved` |
| 9 | **Credit-type source** (incl. `is_paid` and POS), `refund_type = cash` | Cr 1110 | Cr 1110 | **Rejected** `refund_source_required`, under both policies |
| 10 | **Standalone** note, `refund_type = cash` | Cr 1110 | Cr 1110 | **Rejected** `refund_source_required`, under both policies |
| 11 | `withdraw` scope of the resolved treasury excludes the actor (`user` / `role`), or no actor with a restricted scope | Posts (no check) | Posts (unchanged by decision D-T5-7) | **Rejected** `not_permitted`; `deposit` permission alone is not enough |
| 12 | Another tenant's invoice or entry | n/a | n/a | Not visible (scoped reads): creation refused; a foreign entry planted on the source resolves no treasury (`source_treasury_unresolved`) |
| 13 | `refund_type = credit` | Cr 1130 | Cr 1130 | Cr 1130 (unchanged) |
| 14 | Re-post, or a failed post | 1 entry / rolled back | same | same: exactly one entry for the fixed note, nothing left by a rejection |

## 4. Tests

| Suite | Result |
|---|---|
| `TreasuryCreditNoteRefundRoutingTest` (21) | passed on SQLite and PostgreSQL 16 |
| `TreasuryCreditNoteRefundRoutingPostgresTest` (2, real forked processes) | passed on PostgreSQL: 8 routed notes racing 8 routed sales on one drawer (no deadlock, every note Cr 1111 only, none on 1110); deactivation racing 6 notes (each note fully posted to 1111 or untouched in draft, never partial, never 1110) |
| Mutation checks | each of these breaks the matching tests: removing the `withdraw` check (permission tests), a silent fallback to 1110 (ten tests: rejections, atomicity, isolation, permissions), using the current main instead of the sale entry (derivation and ZATCA tests), removing the currency check (currency test) |
| Related regression (credit notes, ZATCA credit-note suites, T3/T4 treasury, returns, POS returns, customer refunds, T1 bootstrap/deadlock, invoices) | SQLite and PostgreSQL green except the one T4 case this change intentionally supersedes (updated, section 6) |
| Full local suites | SQLite: 8611 passed, 208 skipped, 27 failed (26 `Fuel*` for the missing `bcmath` plus `AiPaidProviderDisabledTest`, the known set). PostgreSQL parallel: 8846 tests, 28 failing: the known set plus one extra, `ReturnSourceVatAccuracyTest::line_and_header_discounts_on_an_inclusive_multi_line_sale_return_to_the_penny` (a `/api/returns` credit return answered 422 in the parallel run). It does not touch credit notes or cash, **passes alone on SQLite and PostgreSQL (21/21)**, and is treated as a parallel-order flake pending CI |
| CI | see the PR |

ZATCA: the generated credit-note XML has the same structure and monetary totals whether refunded from 1110 or 1111 and never mentions the treasury; ICV is contiguous and PIH equals the previous hash; a treasury rejection changes neither `zatca_chain_entries` nor the chain head. `ZatcaCreditNoteIssuanceTest`, `ZatcaCreditNoteIssuancePostgresTest`, `ZatcaCreditNoteEmergencyStopApiTest`, `ZatcaCreditNoteRealServiceParityTest` and `ZatcaCreditNoteXmlTest` run unchanged and pass.

## 5. Accounting risks and what remains

| Item | Status |
|---|---|
| Returns and POS exchange still credit 1110 and rely on the T4 guard | **T6.** Gate cannot open before T6 |
| Purchase debit notes with a cash refund still debit 1110 (a deposit) | **T5b** |
| Legacy path still has no `withdraw` check (decision D-T5-7) | Arrives with the activation |
| Negative-balance policy not applied to refunds | D-T5-5, separate finance slice |
| Partial-refund accounting across several notes on one sale | Each note derives the same treasury; no new interaction |
| Operational consequence of D-T5-2 | Once active, a cash refund of a credit-type or standalone note is refused with a message pointing to credit-then-voucher; tenants relying on direct cash refunds of such notes must switch to that route before activation |

## 6. Intentional change to existing tests

`TreasuryCashSaleRoutingTest::a_cash_credit_note_for_an_invoice_collected_outside_1110_is_rejected_without_any_entry` asserted the T4 stopgap (rejection). T5 replaces that outcome on the routed branch with the correct refund (Cr 1111). It is rewritten, and a new case proves the T4 guard still protects the **legacy** branch (a sale routed earlier, then the policy switched back to `legacy`). The returns guard test is untouched.

## 7. Remaining activation conditions (separate approvals)

1. T6: returns and POS exchange routed or guarded equivalently.
2. Owner's read-only scans from the T4 audit.
3. Tenants that refund credit-type or standalone notes in cash move to credit-then-voucher.
4. A coordinated change record to set `TREASURY_CASH_SALE_ROUTING_ENABLED=true`, then per-tenant opt-in. Rollback: settings back to `legacy` or close the gate; posted entries are never rewritten.

## 8. Next step

T6 (returns and POS exchange) under the same gate, or T5b (purchase debit notes), whichever the owner prioritizes.
