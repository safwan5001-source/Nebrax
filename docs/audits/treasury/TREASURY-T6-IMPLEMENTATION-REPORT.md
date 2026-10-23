# TREASURY-T6: cash returns and POS exchange follow the treasury policy (closed behind the T4 gate) — final closure

| | |
|---|---|
| Owner decisions applied | **D-T6-1** POS cash refunds (return, exchange surplus) credit the **session's pinned treasury** · **D-T6-2** general (`/returns`) cash returns follow the T5 rule · **D-T6-3** effective only behind the existing T4 gate; `legacy` is byte-for-byte unchanged · **extra condition:** no cash is paid out of a session treasury different from the treasury where the original cash was collected, without an explicit accounting policy — this slice **rejects** that case (fail closed) and assumes no permission |
| Builds on | T3 resolver, T4 gate and setting (`sales.cash_sale_treasury_policy`), T5 credit-note resolver (`TREASURY-T5-IMPLEMENTATION-REPORT.md`) |
| Not done | merge, deploy, opening the T4 gate, any tenant activation, migration, new route, API-shape change, ZATCA change, purchase debit notes (T5b), any accounting rule outside refunds |
| Branch / PR / SHAs | see the PR description |

## 1. Audit: which paths could bypass the treasury policy

| # | Path | Credit account before T6 | Bypass? | T6 |
|---|---|---|---|---|
| 1 | `ReturnService::post` — cash return, source = direct cash invoice | 1110 hard-coded (T4 guard rejects when the sale was collected elsewhere) | Yes once routing is on | routed: treasury of the sale entry (T5 rule) |
| 2 | `ReturnService::post` — cash return, standalone or credit-type source | 1110 hard-coded | Yes | routed: **rejected** `refund_source_required` (D-T6-2); alternative: credit return, then refund voucher |
| 3 | **POS return** (`PosReturnService` → `ReturnService::post`), cash | 1110 hard-coded | **Yes, today, gate closed.** Proven by probe: POS cash sale collected in 1111 (payment method linked to 1111, session pinned to 1111), cash return credited 1110 | routed: session's pinned treasury |
| 4 | **POS exchange** cash surplus (`PosExchangeService::postCashSurplus`) | 1110 hard-coded | Yes, same cause | routed: session's pinned treasury |
| 5 | POS exchange return leg, credit returns, credit notes with `credit` | 1130 (receivable) | No treasury involved | unchanged |
| 6 | Credit note cash refund | resolved since T5 | No | unchanged |
| 7 | `CustomerRefundService` (refund vouchers) | already treasury-aware with `withdraw` | No | unchanged |
| 8 | Purchase returns / purchase debit notes (cash = money in) | 1110 hard-coded | Not a sales refund; direction is deposit | **T5b**, not a blocker (see §6) |

POS cash is collected through payment methods, each linked to a treasury, and the session pins the default cash method's treasury at open (`pos_sessions.cash_account_id`, used by the drawer report and variance settlement). That is why the POS refund treasury is the session's.

## 2. What ships

| Item | Behavior |
|---|---|
| Production today (gate closed or `legacy`) | **Unchanged byte for byte:** 1110, no authorization, the T4 `CashSaleRefundGuard` still protects the legacy branch. The existing POS asymmetry (session on a non-1110 treasury, refund on 1110) therefore remains until activation and is an activation condition, not changed by deploying this code |
| Routed (gate open, policy `main` or `explicit_required`), general return | `CreditNoteRefundTreasuryResolver` (T5): treasury derived from the original cash sale entry, exactly one; T3 resolution; `withdraw`; currency |
| Routed, POS return and exchange surplus | new `PosCashRefundTreasuryResolver`: session pinned treasury → T3 resolution → `withdraw` on the resolved entity → currency → **every posted cash receipt of the source invoice must be in that same treasury** (`refund_treasury_mismatch` otherwise). A source invoice with no cash receipt (card-only) keeps being governed by the explicit POS `cash_refund_policy` and drawer balance; the refund leaves the session treasury |
| Always rejected when routed | session without a pinned treasury (`session_treasury_required`), source not in the session, inactive/invalid treasury, foreign currency, missing `withdraw` (also when no actor is passed), cross-treasury payout |
| Resolution timing | before the ledger entry; any rejection rolls the whole transaction back (return, exchange, replacement invoice): no entry, ICV, chain entry |
| Concurrency | the resolvers take `FOR KEY SHARE` on the treasury GL account before reading entity state (same fix as T5): a deactivation either precedes the posting (rejected) or waits for its commit |
| Also fixed (found while testing) | `TreasurySelectionException` never passed its message to the parent, so **every treasury rejection came back from the API as 422 with an empty message** (T3 defect, affecting T4/T5/T6). One-line fix; the 422 status and body shape are unchanged, the message is now filled |
| Schema, routes, permissions, ZATCA | none changed. No migration. `ReturnService::post` and the controller gained an optional actor argument |

## 3. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/PosCashRefundTreasuryResolver.php` (new) | POS resolver (rules above) |
| `app/Services/Accounting/ReturnService.php` | `post(ReturnDocument, ?User $actor = null)`; legacy guard now only on the legacy branch; routed credit account resolved before the ledger; fallback `?? 1110` exists only for the legacy branch |
| `app/Services/Accounting/PosExchangeService.php` | cash surplus treasury resolved before any write when routed |
| `app/Services/Accounting/PosReturnService.php`, `app/Http/Controllers/Api/ReturnController.php` | pass the authenticated actor to `post` |
| `app/Support/TreasurySelectionException.php` | message passed to the parent (fix); additive reasons `session_treasury_required`, `refund_treasury_mismatch`; the `refund_source_required` text made document-neutral |
| Tests | `TreasuryReturnRefundRoutingTest` (new, 18), `TreasuryReturnRefundRoutingPostgresTest` (new, 4, forked processes), `TreasuryCashSaleRoutingTest` (T4 return-rejection test replaced: routed return now follows the treasury; new case keeps the T4 guard on the legacy branch), `TreasuryCreditNoteRefundRoutingTest` (static guard updated) |
| `CLAUDE.md`, this report | documentation |

## 4. Journal entries (halalas)

General return of the T5 sale (1,000.00 + 15% VAT; Dr 4110 100000 and Dr 2120 15000 in every row):

| Scenario | Before | Gate closed | Gate open (`main` / `explicit_required`) |
|---|---|---|---|
| Cash sale collected in 1110, main moved later | Cr 1110 | Cr 1110 | Cr 1110 (identical) |
| Cash sale routed to 1111 | rejected by the T4 guard | n/a | **Cr 1111**, `withdraw` checked |
| Standalone / credit-type source, cash | Cr 1110 | Cr 1110 | **rejected** `refund_source_required` |
| Credit return | Cr 1130 | Cr 1130 | Cr 1130 |

POS (sale 100.00 + 15% = 11500 collected in 1111, session pinned to 1111):

| Scenario | Before / gate closed | Gate open |
|---|---|---|
| POS cash return | Dr 4110 10000, Dr 2120 1500, **Cr 1110 11500** | same lines, **Cr 1111 11500** (1111 returns to zero, 1110 untouched) |
| Exchange cash surplus 57.50 | Dr 1130 5750, **Cr 1110 5750** | Dr 1130 5750, **Cr 1111 5750** |
| Session on 1110, cash collected in 1111 | Cr 1110 | **rejected** `refund_treasury_mismatch`, whole exchange rolled back |
| Session without pinned treasury | Cr 1110 | **rejected** `session_treasury_required` |

## 5. Tests

| Suite | Result |
|---|---|
| `TreasuryReturnRefundRoutingTest` (18) | passed on SQLite and PostgreSQL 16: legacy unchanged incl. POS on another treasury; general routing, standalone/credit rejected under both policies; withdraw, currency, inactive; POS return/exchange routed, card-sale policy, mismatch, no pinned treasury, withdraw, inactive/currency; tenant isolation (foreign treasury planted on the session, foreign session, foreign entry on a source); atomicity (return and exchange leave no entry, ICV, chain entry or replacement invoice); message-filled guard; static guards |
| `TreasuryReturnRefundRoutingPostgresTest` (4) | passed: 8 general returns racing 8 routed sales (no deadlock, all Cr 1111, none on 1110); deactivation between resolution and ledger write for a general return and for a POS return on the system treasury 1110; 6 concurrent POS returns in one session (no deadlock, all on the session treasury) |
| Mutation checks | removing the `FOR KEY SHARE` from the POS resolver fails the POS race test (a return committed after the deactivation, `entity_active_at_write = false`) |
| Related regression | SQLite and PostgreSQL: see PR (broad filter over treasury, credit notes, returns, POS, payments, invoices, ZATCA chain/credit notes) |
| CI | see PR |

ZATCA: returns and exchange surplus produce no ZATCA document and read no treasury account; the chain/ICV snapshot is asserted unchanged on every rejection.

## 6. Activation conditions and what is not a blocker

**Remaining conditions before the owner may open the T4 gate (all separate approvals):**

1. Owner's read-only production scans from the T4 audit (tenants whose main is not 1110 or missing; drafts carrying `cash_account_id`), plus two T6 scans: sessions with `cash_account_id IS NULL` among open sessions, and tenants whose cash payment method is linked to a treasury other than 1110 (their POS cash refunds move from 1110 to the session treasury at activation).
2. Tenants that refund credit-type or standalone documents in cash (credit notes **and** returns) must move to credit-then-voucher before activation.
3. A coordinated change record for `TREASURY_CASH_SALE_ROUTING_ENABLED=true`, then per-tenant opt-in. Rollback: set the policy back to `legacy` or close the gate; posted entries are never rewritten.

**Not blockers (documented, separate work):**

| Item | Why it is not a blocker |
|---|---|
| T5b purchase debit notes / purchase returns with cash (money in, `deposit`) | They never refund a routed sale; they still debit 1110, which exists and is valid |
| Other hard-coded 1110 outflows (assets, payroll, expenses) | Not refunds of sales collections; independent of the sale-routing policy |
| Global lock cycle: deactivating a treasury while any other posting touches its account (`CashBankAccountService::update` locks the account before the tenant anchor) | Fails safe (PostgreSQL aborts one side, full rollback); the T5/T6 refund paths no longer take part in it |
| POS quote does not preview the routed rejection (`cash_allowed` may be true while posting rejects) | No integrity impact; UX follow-up |
| Cross-treasury refunds (collected in X, paid from session Y) | Intentionally unsupported; needs an explicit accounting policy and a permission review (owner condition) |
| Negative-balance policy for refunds | Separate finance slice (D-T5-5) |
