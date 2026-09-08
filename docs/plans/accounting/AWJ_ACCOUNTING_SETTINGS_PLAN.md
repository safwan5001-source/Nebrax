# AWJ Accounting Settings — Living Plan

**Status:** TRACK COMPLETE THROUGH FISCAL-2 — all eight slices merged to `main`  
**Updated:** 2026-09-10  
**Safety:** No further implementation, merge or deploy is authorized by this document. Everything below
that is not marked MERGED is deferred scope requiring its own approval.

## Purpose
Authoritative execution map for Accounting Settings in AWJ ERP. Detailed contracts live in the dedicated task/design documents; this file intentionally stays compact to prevent duplicated/stale requirements.

## Track status — COMPLETE through FISCAL-2

**The Accounting Settings implementation track is complete through FISCAL-2.** All eight planned slices
are implemented, reviewed and merged to `main`. No slice in this plan remains open.

| # | Slice | Status | PR | Merge SHA |
|---|---|---|---|---|
| 1 | ACC-1 — Accounting Settings Foundation | **MERGED** | [#676](https://github.com/safwan5001-source/Nebrax/pull/676) | `4963a6b5c1427c753b492dc7d43672c9a64e208e` ¹ |
| 2 | ACC-2 — Semantic Account Routing Foundation | **MERGED** | [#679](https://github.com/safwan5001-source/Nebrax/pull/679) | `9957cf5fba68faa88cc418115800f457df2b1d09` |
| 3 | ACC-3 — Sales & Payment Account Routing | **MERGED** | [#682](https://github.com/safwan5001-source/Nebrax/pull/682) | `a1268d4df5e0061c9dd0fc51c0f6abe7c17b1c94` |
| 4 | ACC-RET-1 — Purchase Return Cutover + Supplier Refund | **MERGED** | [#684](https://github.com/safwan5001-source/Nebrax/pull/684) | `a19c42a02570173d25b5abaf48cf4263c71e48ef` |
| 5 | ACC-4 — Purchase Account Routing | **MERGED** | [#685](https://github.com/safwan5001-source/Nebrax/pull/685) | `70c80b7d37aab13c3c5c181757ae0db8f3494428` |
| 6 | ACC-5 — Inventory & COGS Account Routing | **MERGED** | [#687](https://github.com/safwan5001-source/Nebrax/pull/687) | `f649fa69350c3319d77a44d836a92af6578ae056` |
| 7 | ACC-6 — Accounting Period Locks | **MERGED** | [#689](https://github.com/safwan5001-source/Nebrax/pull/689) | `643b7d9d1e5638aea92f38c59fbf7555c8bd8948` |
| 8 | FISCAL-2 — Fiscal Year Close | **MERGED** | [#698](https://github.com/safwan5001-source/Nebrax/pull/698) | `5abd555519befe196e08c5ce870f5526259aa23f` |

Each merge SHA except ACC-1's is recorded in the *next* slice's implementation report as the verified
`origin/main` head at its branch point, which is how the chain is provable end to end.

¹ **Provenance note.** ACC-1's merge SHA is the one entry not carried in any report — the ACC-2 report's
base SHA (`6a4a53d7…`) is a different, unrelated PR (#677, Notifications) that landed after it. The value
above was read from repository history (`4963a6b5` is a two-parent merge commit titled
"feat(accounting): Accounting Settings foundation"), not inferred from the report chain, and is labelled
here so the difference in provenance is visible.

Per-slice detail — scope, journals, tests, tenant isolation, RBAC and risks — lives in
`reports/<SLICE>-implementation-report.md`. Those reports are the record; this file is the map.

## Non-negotiable principles
- Accounting correctness, tenant isolation, security and immutable posted history first.
- `LedgerService` remains the accounting posting/reversal core.
- Semantic roles resolve to concrete accounts before Ledger posting.
- Cash/Bank continues through its domain-specific resolver.
- Fiscal Close and Accounting Period Locks are separate controls.
- Saudi compliance is a first-class guardrail: ZATCA/VAT/e-invoicing records are never silently rewritten by accounting close/reopen.
- Current/test historical data is disposable if Safwan explicitly approves a reset; this is not automatic deletion permission.

## Confirmed Account Routing V1
Static semantic catalog + CompanyWide tenant mappings. Explicit invalid mapping fails closed. Existing product sales/COGS overrides keep precedence. Cash/bank/payment-method accounts are not generic Accounting Roles.

Core roles (13, ACC-2):
`accounts_receivable`, `accounts_payable`, `sales_revenue`, `sales_shipping_revenue`, `document_adjustment`, `inventory_asset`, `cogs`, `purchase_expense`, `tax_output`, `tax_input`, `inventory_count_variance`, `inventory_manual_adjustment`, `inventory_damage_loss`.

`retained_earnings` (legacy default 3120) was added by FISCAL-2, bringing the catalog to **14 roles**.
`opening_balances` 3130 is true opening/cutover equity, is not annual retained earnings, and was
deliberately **not** added to the configurable catalog.

## Purchase Return / Supplier Refund
Target principle: `Purchase != Supplier Payment` and `Purchase Return != Supplier Refund`.

New Purchase Return target is commercial reversal through AP; Supplier Refund is a dedicated branch-scoped financial document that debits selected CashBankAccount and credits AP, with dedicated allocations to posted purchase returns, row-lock/concurrency protection and Ledger reversal lifecycle.

Detailed resolved contract: `GATE-ACC-RET-1-purchase-return-supplier-refund.md`.
Prepared implementation task: `ACC-RET-1-purchase-return-cutover-supplier-refund.md`.

## Accounting Period Locks — RESOLVED
V1 is CompanyWide, inclusive bounded date ranges, server authoritative, with a dedicated AccountingDateGuard enforced finally by Ledger `post()` and `reverse()`. Drafts remain editable; posting/reversal into locked dates is blocked. No per-transaction admin bypass. Release/re-lock is explicit and audited. Tenant-level serialization must prevent lock/post races.

Detailed contract: `ACC-6-accounting-period-lock-design.md`.

## Fiscal Year Close — RESOLVED
V1 uses CompanyWide FiscalYear, not monthly FiscalPeriod rows. Directly close revenue/expense into semantic `retained_earnings`; no Income Summary V1 and no annual balance-sheet carry-forward journals. 3130 is not used.

Fiscal-close journals remain real ledger entries visible in Trial Balance/General Ledger. Historical Income Statement excludes fiscal-close journals so closed-year P&L remains visible. Balance Sheet synthetic net income covers **only unclosed P&L**, preventing double counting with Retained Earnings.

**As built (FISCAL-2), that last property is structural, not a date cutoff.** The Balance Sheet computes
net income from the full ledger *including* close journals rather than by cutting off at the latest closed
fiscal boundary. Because a close journal zeroes the P&L accounts of the year it closes, "revenue − expense
over the whole ledger" *is* exactly "unclosed net income" — zero at a closed year end, unclosed activity
after it, unchanged before any close. The date-cutoff formulation this plan originally described was
rejected during implementation because it would silently mis-state the sheet if a year were ever left
unclosed between two closed years. Rationale and tests: `reports/FISCAL-2-implementation-report.md` §7.

Reopen reverses the exact close generation under a privileged audited workflow; correction and re-close create a new generation. Fiscal Close integrates with ACC-6 serialization/locking without exposing a generic Ledger bypass.

Saudi compliance/readiness is part of the design: fiscal close does not imply VAT-period closure, VAT-return amendment or ZATCA document mutation. Readiness uses BLOCKER/WARNING/INFO and must not claim authoritative ZATCA status unless AWJ has authoritative integration data.

Detailed contract: `FISCAL-1-fiscal-period-close-design.md`.

## Execution sequence — all delivered

Kept as the historical record of what each slice was scoped to do. Every entry is now **MERGED**; see the
status table above for PR and merge SHA.

1. **ACC-1 — Accounting Settings Foundation** — **MERGED**
   RBAC `accounting_settings.view/manage`, `/accounting-settings` hub, Accounting sidebar leaf, i18n/tests. No accounting behavior.

2. **ACC-2 — Semantic Account Routing Foundation** — **MERGED**
   Static catalog, tenant mappings, resolver, validation, audit/API/UI. The migration-strategy choice this
   step required was resolved as **Clean Seeded Cutover** (explicit mappings for every tenant, no
   transitional legacy fallback, resolver fails closed). No posting consumer in ACC-2.

3. **ACC-3 — Sales + Payment Counterparty Routing** — **MERGED**
   Sales/shared semantic roles; product overrides preserved; CashBank remains authoritative.

4. **ACC-RET-1 — Purchase Return Cutover + Supplier Refund** — **MERGED**
   Direct cash purchase-return target removed for new behavior; dedicated Supplier Refund domain.

5. **ACC-4 — Purchase Routing** — **MERGED**
   Closed the receipt/return asymmetry ACC-RET-1 deliberately left open.

6. **ACC-5 — Inventory / COGS Routing** — **MERGED**
   Inventory roles adopted with stock/GL atomicity and product COGS override preserved.

7. **ACC-6 — Accounting Period Locks Implementation** — **MERGED**
   Company-wide guard/lock contract enforced in `LedgerService::post()`/`reverse()` via
   `AccountingDateGuard`, serialized on the tenant-row anchor. No per-transaction bypass.

8. **FISCAL-2 — Fiscal Year Close Implementation Task** — **MERGED**
   `FiscalYear` + close generations + reopen/re-close, `retained_earnings` routing, report integration,
   readiness (BLOCKER/WARNING/INFO) and Saudi-compliance guardrails. Zero-activity close persists a
   CLOSED state with **no** journal.

## Dependency graph — as executed
Retained as the record of why the slices landed in the order they did. Every edge below was honoured.

`ACC-1 -> ACC-2 -> ACC-3`

`ACC-2 -> ACC-RET-1 -> ACC-4`

`ACC-2 -> ACC-5`

`ACC-6` depends on the stable Ledger/current-main posting inventory, not on purchase-routing completion.

`ACC-2(retained_earnings) + ACC-6 -> FISCAL-2`.

## Documents

**Task / design contracts** (all executed):
- `ACC-1-accounting-settings-foundation.md`
- `ACC-2-semantic-account-routing-foundation.md`
- `ACC-3-sales-payment-account-routing.md`
- `GATE-ACC-RET-1-purchase-return-supplier-refund.md`
- `ACC-RET-1-purchase-return-cutover-supplier-refund.md`
- `ACC-4-purchase-account-routing.md`
- `ACC-5-inventory-cogs-account-routing.md`
- `ACC-6-accounting-period-lock-design.md`
- `FISCAL-1-fiscal-period-close-design.md`

**Implementation reports** — the authoritative record of what shipped, one per merged slice:
- `reports/ACC-1-implementation-report.md`
- `reports/ACC-2-implementation-report.md`
- `reports/ACC-3-implementation-report.md`
- `reports/ACC-RET-1-implementation-report.md`
- `reports/ACC-4-implementation-report.md`
- `reports/ACC-5-implementation-report.md`
- `reports/ACC-6-implementation-report.md`
- `reports/FISCAL-2-implementation-report.md`

## Implementation reporting contract
Every Claude Code/Cursor execution must return MD containing: scope completed, changed files, tests/results, build/CI, accounting/security/tenant-isolation risks, remaining work, Branch/PR/Base SHA/Head SHA when available, and recommended next step. No merge/deploy without Safwan's explicit approval.

This contract was satisfied for all eight slices; the reports listed above are those returns.

## Deferred / Future Scope

Collected from the merged implementation reports and the prepared task/design documents. **Nothing here is
authorized, scheduled or in progress** — each item needs its own scoping and Safwan's approval before it
becomes a task. Items are listed with the source that already documented them.

### Fiscal close and period locks

- **Branch / cost-center allocation of Retained Earnings.** Fiscal close is company-wide in V1; close lines
  carry no branch, partner or cost-center dimension, and no branch-level retained-earnings attribution
  exists. *(FISCAL-1 §V1 structure; FISCAL-2 report §21)*
- **Integrated release → reopen → re-lock orchestration.** Reopening a year whose end date sits inside an
  active ACC-6 period lock is deliberately a two-step operation: release the lock under its own permission
  and reason, then reopen. An integrated privileged workflow was not invented. *(FISCAL-2 report §21)*
- **Fiscal Close readiness must grow with new document types.** Readiness checks the eight document types
  that carry a `journal_entry_id` and a posted status, declared in one constant
  (`FiscalCloseService::DOCUMENTS`). A newly introduced posting document must be added there to be covered.
  *(FISCAL-2 report §21)*
- **Per-transaction exception workflow for period locks.** Posting into a locked range requires releasing
  the lock; ACC-6 explicitly defers any exception mechanism to separate design approval. *(ACC-6 design
  doc "Override — DECIDED: none per transaction in V1"; ACC-6 report §25)*
- **Period-lock `reason` is free text**, not a taxonomy. Categorising or reporting on lock reasons is a
  follow-up. *(ACC-6 report §25)*
- **Zero-activity closes create no journal**, so they are invisible in Trial Balance by design; the state
  lives on the close generation row and in the UI. *(FISCAL-1 "Bounded implementation choice"; FISCAL-2
  report §21)*

### Account routing — deliberately hardcoded accounts still outside the track

Each was reported rather than silently changed, and none is a defect:

- **Cash-sale debit in `InvoiceService`** resolves a cash account by code and does not pass through
  `CashBankAccountService`. No generic `cash`/`sales_cash` semantic role was introduced — ACC-2/ACC-3
  prohibit one. Worth a dedicated task scoped to that settlement path. *(ACC-3 report "Deliberate boundary"
  and §Risks)*
- **`5116` purchase-return valuation variance** is not an approved role in any slice. *(ACC-4 report; ACC-5
  report)*
- **`InventoryService::receiveStock()` counterparties** — `2110` (payables) and `3130` (opening balances).
  `2110` is reached only by the `ProductService::create()` initial-quantity shortcut; whether it should
  join the purchases role family is an open ACC-4-adjacent question. *(ACC-4 report; ACC-5 report §Risks)*
- **`3130` opening balances** is intentionally outside the configurable catalog: it is opening/cutover
  equity, never annual close. *(ACC-2 report; ACC-5 report; FISCAL-2 report §8)*
- **`PartnerService::ACC_OPENING`** — partner AR/AP opening balances, unrelated to inventory or fiscal
  close. *(ACC-5 report)*
- **Fuel vertical accounts.** `FuelReconciliationService` reads `StocktakeService::INVENTORY_ACCOUNT_CODE`
  / `VARIANCE_ACCOUNT_CODE` behind its own station-level override contract, so a tenant remapping
  `inventory_count_variance` does **not** change fuel reconciliation postings. A real, deliberate
  inconsistency belonging to a fuel-scoped follow-up. *(ACC-5 report §Risks)*
- **Three inventory variance roles share default account 5180.** Intentional: identities are distinct while
  defaults coincide, so an unmapped tenant sees today's behaviour exactly. Splitting the defaults is a
  chart-of-accounts decision, not a routing one. *(ACC-5 report §Risks)*

### Routing scope not taken in V1

- **No branch-specific account mappings.** Ruled out explicitly and repeatedly across the routing slices;
  mappings are `CompanyWide`. *(ACC-2, ACC-4, ACC-5 "out of scope")*
- **No generic cash/bank semantic roles.** Cash/bank accounts stay in the `CashBankAccount` domain.
  *(ACC-2, ACC-3, ACC-4)*
- **No product/category routing beyond the existing product-level sales/COGS override fields.** *(ACC-2)*

### Supplier refund / purchase return

- **On-account (unallocated) supplier cash receipts.** V1 requires a refund to be fully allocated to posted
  purchase returns; a free-standing supplier receipt needs its own explicit contract. *(GATE-ACC-RET-1)*
- **Refundable-balance snapshot/cache.** Computed from allocations in V1; any future snapshot is a cache,
  never the source of truth. *(GATE-ACC-RET-1)*
- **Request-idempotency framework.** V1 uses row-lock + lifecycle recheck; a retry-prone public API would
  need a dedicated idempotency contract using AWJ's existing public/POS patterns. *(GATE-ACC-RET-1)*
- **No backfill of historical cash purchase returns** into AP + refund pairs. Explicit gate decision; would
  be a separate approved data task. *(ACC-RET-1 report §Risks)*
- **`supplier_refunds.*` is not granted to `accountant` by default.** Least privilege; changing it is a
  one-line role-matrix decision, flagged rather than assumed. *(ACC-RET-1 report §Risks)*
- **`payment_type=credit` still accepted** on purchase returns as a deprecated compatibility path.
  *(ACC-RET-1 report)*
- **No `ApplicationCatalog` app-key guard** on supplier-refund routes; extending `purchases.cycle`
  enforcement to supplier-side documents remains out of scope. *(ACC-RET-1 report)*

### Environment and tooling (not accounting scope)

- **`bcmath` PHP extension missing** in the sandbox, causing 24 `Fuel*Test` failures locally; CI declares
  the extension. *(reported identically in ACC-1 → FISCAL-2)*
- **One PDF-parsing environment quirk** in `DocumentCenterSecureIntakeTest`, verified pre-existing.
  *(ACC-5 report; FISCAL-2 report §18)*
- **`2025_01_01_000085_allow_sku_reuse_after_soft_delete::down()`** builds a `GROUP BY` query PostgreSQL
  rejects, so `migrate:rollback` fails on PostgreSQL. Discovered during ACC-6, deliberately not fixed —
  outside that slice's scope. *(ACC-6 report §25)*
- **SQLite's residual check-then-post window** for period locks: SQLite has no row locks, so the
  serialization proof is PostgreSQL-only. Test-engine exposure only; production is PostgreSQL.
  *(ACC-6 report §25)*
- **No automated UI tests for `web/`** beyond the targeted page tests added by ACC-6 and FISCAL-2.
  *(ACC-6 report §25)*

## Next action

**None within this track.** ACC-1 → FISCAL-2 is closed. Any new work starts from the Deferred / Future
Scope list above, each item scoped as its own task with Safwan's explicit approval, and no further
architecture audit is required unless current `main` materially changes a contract in these documents.
