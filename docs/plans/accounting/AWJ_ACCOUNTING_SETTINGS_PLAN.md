# AWJ Accounting Settings — Living Plan

**Status:** ACTIVE / LIVING PLAN  
**Created:** 2026-09-06  
**Base SHA:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`  
**Scope:** Architecture and phased implementation plan only.  
**Safety:** No merge, deploy, schema change, or accounting behavior change is authorized by this document.

## 1. Purpose
This is the authoritative living plan for **إعدادات الحسابات / Accounting Settings** in AWJ ERP. Priorities: accounting correctness, historical integrity, tenant isolation, explicit branch semantics, backward compatibility, server-side controls, and small reviewable PRs. `LedgerService::post()` remains the exclusive posting primitive.

## 2. Evidence Base
The read-only AWJ audit established centralized posting/reversal, hardcoded `ACC_*` resolution, absence of semantic routing/fiscal periods/period locks, real but asymmetric cost-center support, scalar tenant Settings infrastructure, and concrete historical `journal_lines.account_id` snapshots. Daftra is a functional benchmark only; AWJ does not copy behavior that conflicts with its perpetual-inventory or ledger design.

## 3. Target Workspace — V1
1. General Accounting Settings
2. Account Routing
3. Fiscal Periods
4. Accounting Period Locks
5. Cost Centers

Deferred: journal/asset custom fields, physical asset locations/stores, multi-currency/exchange rates, generic cross-domain audit framework. Warehouses remain under Products & Inventory. General Settings exposes only policies genuinely enforced by backend behavior.

## 4. Account Routing Architecture Contract
- Semantic role is the accounting identity; chart codes are legacy defaults.
- Static role catalog in code; no tenant `accounting_roles` table.
- Tenant selections are relational mappings: `Tenant + Role Key -> Account ID`.
- No mapping -> legacy resolution for backward compatibility.
- Valid explicit mapping -> mapped account for new postings.
- Explicit invalid/cross-tenant/missing/disabled mapping -> **BLOCK POSTING**, no silent fallback.
- Historical posted journals never re-resolve; stored `journal_lines.account_id` remains authoritative.
- Legacy fallback is a migration bridge, not permanent target architecture.
- No global "disable accounting" switch.
- `LedgerService` receives resolved account IDs and remains unaware of business-role semantics.
- A generic Accounting Role resolver must not replace a domain-specific financial resolver that also enforces permissions or operational policy.

## 5. Sales Routing Contract
| Role | Meaning | Legacy | Status |
|---|---|---:|---|
| `accounts_receivable` | الذمم المدينة | `1130` | CONFIRMED |
| `sales_revenue` | إيرادات المبيعات | `4110` | CONFIRMED |
| `sales_shipping_revenue` | إيرادات الشحن | `4130` | CONFIRMED |
| `document_adjustment` | فروق/تسويات رأس المستند | `5170` | CONFIRMED shared role |
| `tax_output` | ضريبة المخرجات | `2120` | CONFIRMED |
| `cogs` | تكلفة البضاعة المباعة | `5110` | CONFIRMED / Inventory |
| `inventory_asset` | المخزون | `1140` | CONFIRMED / Inventory |

Preserve existing precedence:
- `Product sales_account_id -> tenant sales_revenue mapping -> legacy 4110`
- `Product cogs_account_id -> tenant cogs mapping -> legacy 5110`

Cash/bank is not a Sales semantic role. `tax_output` is a shared Tax role.

## 6. Purchase Routing Contract
Current purchase posting: tracked goods debit `1140`; non-inventory lines debit `5150`; input VAT debits `1150`; payable credits `2110` even for cash purchases; payment is separate via `PaymentService`. Purchase discount/inbound shipping modify inventory/expense cost rather than posting independently. Header adjustment uses shared `document_adjustment` with legacy fallback `5170`.

| Role | Meaning | Legacy | Status |
|---|---|---:|---|
| `accounts_payable` | الذمم الدائنة | `2110` | CONFIRMED |
| `inventory_asset` | المخزون | `1140` | CONFIRMED |
| `purchase_expense` | مصروف البنود غير المخزنية | `5150` | CONFIRMED |
| `tax_input` | ضريبة المدخلات | `1150` | CONFIRMED |
| `document_adjustment` | فروق/تسويات رأس المستند | `5170` | CONFIRMED shared role |

Do not invent independent purchase shipping/discount roles without a proven accounting need.

## 7. Purchase Returns and Supplier Refund
Current purchase return reverses original categories: debit payable (`2110`) for credit return or cash (`1110`) for cash return; credit inventory (`1140`), expense (`5150`), input VAT (`1150`) as applicable.

**`5180` is NOT Purchase Returns.** Current evidence identifies it with inventory variance/damage/adjustment semantics.

No dedicated `purchase_returns` role is approved merely by imitation of another ERP. AWJ's perpetual-inventory return reverses inventory/expense/input VAT directly.

### 7.1 Confirmed architectural inconsistency
Purchase posting always establishes supplier liability and delegates settlement to `PaymentService`, while the current Purchase Return UI/API requires `payment_type = cash|credit`. For `cash`, `ReturnService` directly debits legacy cash account `1110` without selecting a `CashBankAccount`, `PaymentMethod`, or applying Cash/Bank deposit permissions.

This is both a routing inconsistency and a business-contract ambiguity. It must not be hidden by introducing a generic `cash` Accounting Role.

### 7.2 Target accounting contract
For new behavior after an explicit future cutover:

**Purchase Return** records the commercial reversal only:
- Dr `accounts_payable`
- Cr `inventory_asset` and/or `purchase_expense`
- Cr `tax_input` as applicable.

If the supplier actually refunds money, that is a distinct **Supplier Refund / Settlement** operation:
- Dr the selected `CashBankAccount.account_id`
- Cr `accounts_payable`
- preserve partner dimension and an auditable link to the supplier and, where applicable, the return/credit being settled.

Therefore the target principle is: `Purchase != Payment` and `Purchase Return != Supplier Refund`.

Historical posted returns remain frozen and are never reinterpreted.

### 7.3 Do not overload current Payment direction
Current `Payment.direction` is not a generic cash-flow direction:
- `received` -> customer receipt, allocations to sales `Invoice`, Cr Accounts Receivable;
- `paid` -> supplier payment, allocations to `Purchase`, Dr Accounts Payable.

Posting also updates allocated invoice/purchase `paid_amount` and `payment_status`. Supplier Refund must not be implemented merely as `Payment(direction=received)` or by reversing `paid`.

### 7.4 Supplier Refund implementation gate
A dedicated Supplier Refund feature/domain is the preferred target rather than a flag that mutates existing Payment meaning. Exact model/service/API/UI design is outside Account Routing and requires focused design before ACC-4 consumes Purchase Return routing.

## 8. Inventory Routing Contract — CONFIRMED 2026-09-06
### 8.1 Inventory asset
`1140` is the inventory control account across purchases, purchase returns, sale COGS, sales returns, stocktakes, stock permits, transfers, and openings: `inventory_asset`.

### 8.2 COGS
`cogs` is shared Inventory Accounting. Preserve `Product cogs_account_id -> tenant cogs mapping -> legacy 5110`.

### 8.3 Opening balances are not variance
Inventory opening posts `Dr inventory_asset (1140) / Cr opening_balances (3130)` and refuses products with prior stock movements. `opening_balances` is confirmed semantically but final settings-domain placement remains UNDER_REVIEW.

### 8.4 `5180` is overloaded
Current `5180` conflates:
1. `inventory_count_variance` — physical stocktake differences.
2. `inventory_manual_adjustment` — generic manual stock receipt/issue counterpart.
3. `inventory_damage_loss` — explicitly damaged/non-saleable goods.

These roles may initially share legacy fallback `5180` while becoming independently mappable.

### 8.5 Do not split gain/loss merely by sign
Stocktake surplus and shortage are opposite signs of one business cause. Separate gain/loss mappings are deferred until proven necessary.

### 8.6 Stock Permit free text cannot select accounting semantics
Do not infer damage/internal consumption/samples accounts from free text. Structured accounting classification is required before such routing.

### 8.7 Non-saleable sales returns
Returned goods that do not re-enter saleable inventory consume `inventory_damage_loss`, not `inventory_count_variance`.

### 8.8 Transfers
Same-branch warehouse transfer creates no GL entry. Cross-branch transfer posts the same `inventory_asset` role on both sides with different branch dimensions. No transfer-clearing role is proven necessary.

### 8.9 Branch dimensions
ACC-5 must preserve existing branch dimensions exactly; this does not itself approve branch-specific mappings.

### 8.10 Inventory role set
| Role | Meaning | Legacy | Status |
|---|---|---:|---|
| `inventory_asset` | حساب مراقبة المخزون | `1140` | CONFIRMED |
| `cogs` | تكلفة البضاعة المباعة | `5110` | CONFIRMED |
| `opening_balances` | مقابل الأرصدة الافتتاحية | `3130` | CONFIRMED meaning / placement UNDER_REVIEW |
| `inventory_count_variance` | فروق الجرد الفعلي | `5180` | CONFIRMED concept |
| `inventory_manual_adjustment` | مقابل الإضافة/الصرف اليدوي | `5180` | CONFIRMED concept |
| `inventory_damage_loss` | تلف/مرتجع غير قابل للبيع | `5180` | CONFIRMED concept |

## 9. Cash / Bank / Payment Routing Contract — CONFIRMED 2026-09-06
### 9.1 CashBankAccount is the source of truth
AWJ already has a domain-specific Cash/Bank routing subsystem. Do not create semantic roles such as `cash_account`, `bank_account`, `card_account`, or `transfer_account` that duplicate it.

### 9.2 Payment methods are not Accounting Roles
Payment methods and settlement accounts remain under Payment/Cash-Bank configuration, not Account Routing.

### 9.3 PaymentService routing boundary
Customer receipt: Dr selected CashBankAccount / Cr `accounts_receivable`.
Supplier payment: Dr `accounts_payable` / Cr selected CashBankAccount.

### 9.4 Cash/Bank transfers
Transfers post concrete source/destination CashBankAccount accounts. No transfer-clearing role is proven necessary.

### 9.5 Resolver precedence principle
A domain-specific resolver that enforces permissions/policy must not be bypassed by generic Accounting Role resolution.

## 10. Legacy `5170` Semantic Audit — CONFIRMED 2026-09-06
### 10.1 Actual consumers
At the audited code baseline, `5170` is used as `ACC_ADJUSTMENT` by sales `InvoiceService` and purchase `PurchaseService`. The similarly named Stock Permit `ACC_ADJUSTMENT` is `5180` and belongs to the inventory semantics already decomposed above.

### 10.2 Sales behavior
Invoice header `adjustment` is non-taxable and included directly in total. Positive -> credit `5170`; negative -> debit `5170`.

### 10.3 Purchase behavior
Purchase header `adjustment` is included after base and input VAT. Positive -> debit `5170`; negative -> credit `5170`.

### 10.4 One semantic role
Both are one signed document-header reconciliation concept. V1 uses shared `document_adjustment`, legacy fallback `5170`; no separate sales/purchase adjustment roles.

### 10.5 Scope guard
`document_adjustment` is not a generic dumping account. Future consumers require the same accounting contract.

### 10.6 Tax and cost-center behavior
Routing changes only account resolution; current tax and cost-center treatment stays unchanged.

## 11. Current Role Catalog
**Confirmed:** `accounts_receivable`, `accounts_payable`, `sales_revenue`, `sales_shipping_revenue`, `document_adjustment`, `inventory_asset`, `cogs`, `purchase_expense`, `tax_output`, `tax_input`, `inventory_count_variance`, `inventory_manual_adjustment`, `inventory_damage_loss`.

**Confirmed meaning / placement under review:** `opening_balances`.

**Explicitly not Account Routing roles:** cash accounts, bank accounts, payment methods, card/cheque/transfer settlement accounts managed by Cash/Bank subsystem.

**Deferred/not approved:** independent `sales_adjustment` / `purchase_adjustment`; independent `purchase_returns`; separate variance gain/loss without proven need; inventory transfer clearing; cash/bank transfer clearing; generic product/category precedence beyond existing overrides; branch-specific role mappings; fiscal-close roles until fiscal design.

## 12. General Settings
No exchange-rate controls before multi-currency exists; no tax-on-journal-line controls when VAT is posted as separate lines; no per-line account toggles before end-to-end support; no non-functional switches.

## 13. Cost Centers
Reuse existing implementation. Settings may link to `/cost-centers`. Purchase-line allocation remains a separate optional functional PR.

## 14. Accounting Period Locks
Confirmed absent. Enforcement must be server-side and cover API/POS/import paths. Reversal semantics must be explicit. **Branch semantics UNRESOLVED.**

## 15. Fiscal Periods and Closing
Confirmed absent and distinct from date locks. Separate accounting design/audit is required before implementation. **Branch semantics UNRESOLVED.**

## 16. Routing Branch Semantics
**UNRESOLVED for V1.** Routing, locks, and fiscal periods each require an independent branch-policy decision.

## 17. ACC-1 / ACC-2 Readiness Contract — CONFIRMED 2026-09-06

### 17.1 RBAC convention and final permission names
Repository convention is explicit `domain.view` / `domain.manage` permissions in `Rbac::PERMISSIONS`, enforced server-side by `EnsurePermission` route middleware. The Accounting Settings workspace therefore adopts:
- `accounting_settings.view`
- `accounting_settings.manage`

`accounting_settings.view` controls access to the workspace and read-only accounting-setting endpoints. `accounting_settings.manage` controls future mapping/policy mutations.

**Default role policy:** owner/admin retain access through `*`. Do **not** automatically add these new permissions to accountant or staff system-role matrices. Accounting routing is company-wide financial policy, not ordinary bookkeeping. A tenant may explicitly grant the permissions to a custom role.

This avoids temporarily reusing `accounts.manage` and later changing security semantics.

### 17.2 Navigation contract
The sidebar already has a first-class `accounting` group containing Accounts, Journal Entries, Assets and Cost Centers. ACC-1 adds one built leaf:
- `/accounting-settings`
- key: `accountingSettings`
- permission: `accounting_settings.view`

Do not place this workspace under generic `/settings` or `/finance-settings`; cash/bank/payment settings remain Finance concerns. The existing Finance Settings hub is only the interaction/layout precedent.

### 17.3 Workspace UI contract
ACC-1 may reuse the compact Finance Settings hub pattern (title/subtitle + dense linked cards), but it must not copy its current placeholder behavior. Accounting Settings V1 shows only real destinations/capabilities.

Initial hub destinations:
- Account Routing — may be marked planned/locked until ACC-2 supplies a real endpoint/page.
- Cost Centers — real link to existing `/cost-centers`.
- Fiscal Periods — planned, no fake controls.
- Accounting Period Locks — planned, no fake controls.
- General Accounting Settings — only when a real backend-enforced policy exists.

A placeholder may communicate roadmap state but must never look interactive or persist fake values.

### 17.4 Naming contract
Do not reuse `AccountSettingsController`: it already means the user account/profile center. New backend surfaces use unambiguous Accounting naming, e.g. `AccountingSettingsController` and later `AccountingRoleMappingController`/service names as appropriate.

### 17.5 Tenant isolation model for ACC-2
Account-role mappings are **CompanyWide tenant data**, not branch-scoped data in V1. Model must extend `BaseModel` (therefore `BelongsToTenant`) and implement `CompanyWide`, matching other company-wide tenant models. No `branch_id` column is added to V1 mappings.

Database invariants:
- UUID primary key.
- `tenant_id` foreign key with cascade-on-delete, following repository convention.
- `role_key` string.
- `account_id` foreign key to accounts.
- unique `(tenant_id, role_key)`.
- index `(tenant_id, account_id)` if useful for reverse/reference checks.

Application validation is mandatory even with FKs: selected account must belong to the active tenant, exist, be active, and be a posting/detail account (`is_group = false`). Explicit invalid mapping blocks; it never falls back.

### 17.6 Mapping deletion/reset semantics
Deleting/resetting a mapping means **return to unmapped state**, which for existing tenants invokes the documented legacy fallback bridge for future postings. It never alters historical journals.

The UI/API must describe this as “use system default/legacy default” rather than implying that accounting is disabled.

### 17.7 Static catalog vs relational mappings
ACC-2 adds a static role catalog in code and relational tenant mappings only. No `accounting_roles` table and no tenant-editable role keys. API accepts only catalog keys.

Catalog metadata should include at least key, Arabic/English label/description, legacy code, domain/group, and whether the role is V1 configurable. Metadata is descriptive; the mapping row is the tenant decision.

### 17.8 Resolver contract
The resolver receives a semantic role key and resolves in this order:
1. validate role exists in static catalog;
2. find explicit tenant mapping;
3. if explicit mapping exists, validate referenced account for the active tenant and posting eligibility; invalid -> fail closed;
4. if no mapping exists, resolve the catalog legacy code for backward compatibility;
5. return concrete Account/account ID to the caller before `LedgerService`.

ACC-2 itself has **no posting consumers**. Therefore shipping ACC-2 must not change any journal generated by current services.

### 17.9 Audit contract for mapping changes
AWJ has domain-specific audit/event models but no generic accounting-settings audit framework. ACC-2 should not invent a cross-domain audit platform.

Create a narrowly scoped immutable accounting-setting audit/event record for mapping mutations, recording at minimum:
- tenant_id;
- actor user ID when available;
- event/action (`mapping_created`, `mapping_changed`, `mapping_reset`);
- role key;
- previous account ID/code snapshot when applicable;
- new account ID/code snapshot when applicable;
- timestamp.

Audit rows are company-wide tenant data and must be tenant-isolated. Do not make audit deletion part of normal settings CRUD.

### 17.10 API boundary
ACC-1 requires no mutable accounting-policy API merely to render the hub.

ACC-2 should expose a small dedicated API, conceptually:
- `GET /accounting-settings/account-routing` -> catalog + current mappings + effective legacy/mapped state; guarded by `accounting_settings.view`.
- `PUT /accounting-settings/account-routing/{roleKey}` -> set/replace explicit mapping; guarded by `accounting_settings.manage`.
- `DELETE /accounting-settings/account-routing/{roleKey}` -> reset to unmapped/legacy-default state; guarded by `accounting_settings.manage`.

Exact controller method naming may follow repository style, but do not use generic tenant JSON `Settings` for these relational mappings.

### 17.11 Required ACC-1 tests
At minimum:
- RBAC catalog contains both permissions.
- owner/admin can see/access Accounting Settings through wildcard semantics.
- accountant/staff do not receive the new policy permissions by default.
- unauthorized API access is 403 once an Accounting Settings API exists.
- sidebar visibility mirrors `accounting_settings.view`.
- workspace has no fake editable controls.
- web build/typecheck relevant to navigation/page changes.

### 17.12 Required ACC-2 tests
At minimum:
- tenant A cannot read/update/delete tenant B mappings.
- cross-tenant account ID cannot be mapped even if a raw UUID is supplied.
- group account rejected.
- inactive account rejected.
- unknown role key rejected.
- one mapping per `(tenant, role_key)`.
- unmapped role resolves legacy account exactly as before.
- valid explicit mapping resolves selected account.
- explicit mapping becoming invalid/disabled causes resolution failure, not fallback.
- reset removes explicit decision and restores legacy-compatible future resolution.
- mapping change does not mutate historical `journal_lines`.
- audit event captures actor, role and before/after account snapshots.
- resolver does not bypass CashBankAccount domain resolver.
- **zero posting consumers in ACC-2:** representative pre/post accounting service behavior remains unchanged until ACC-3.
- SQLite and PostgreSQL migration/test coverage for the new relational constraints.

### 17.13 ACC-1 / ACC-2 scope boundary
ACC-1 is workspace/RBAC/navigation only. ACC-2 is catalog/mapping/resolver/audit/API foundation only.

Neither PR may:
- modify `LedgerService`;
- replace any hardcoded posting account in business services;
- implement fiscal periods/locks;
- alter purchase-return cash behavior;
- add branch-specific mappings;
- migrate historical journals;
- seed explicit mapping rows for existing tenants in a way that changes current behavior.

## 18. Updated PR Sequence
### ACC-1 — Accounting Settings Foundation + Workspace + RBAC
Implement the confirmed §17.1–17.4 and §17.11 contracts. No accounting behavior/schema change is required except normal RBAC code/catalog/navigation/i18n/page changes.

### ACC-2 — Semantic Roles + Mapping Foundation
Implement §17.5–17.10 and §17.12–17.13: static catalog, company-wide relational tenant mappings, resolver, validation, dedicated audit, API. No posting consumer yet; invalid explicit mapping fails closed.

### ACC-3 — Sales + Payment Counterparty Routing
Confirmed sales/shared roles including `document_adjustment`; preserve product sales override; historical journals unchanged; unmapped tenants legacy-equivalent. `PaymentService` may consume `accounts_receivable` / `accounts_payable` while Cash/Bank resolution remains in `CashBankAccountService`.

### GATE-ACC-RET-1 — Purchase Return / Supplier Refund Financial Contract
Before ACC-4: remove dependency on direct legacy `1110` for new cash purchase returns; design dedicated Supplier Refund domain rather than overloading current Payment direction; preserve history; define cutover; use selected CashBankAccount and deposit authorization; define linking/allocation; require accounting, tenant-isolation, authorization, concurrency and historical-integrity tests.

### ACC-4 — Purchases + Purchase Returns Routing
Starts only after GATE-ACC-RET-1. Use confirmed purchase/shared roles including `document_adjustment`; no dedicated purchase-return role without approval; never repurpose `5180`.

### ACC-5 — Inventory / COGS Routing
Use confirmed inventory roles; preserve product COGS override; preserve branch dimensions and stock/GL invariants.

### ACC-6 — Accounting Period Lock Design + Implementation
Only after branch/enforcement/reversal decisions.

### Fiscal Periods / Closing
Separate audit/design first, then implementation PRs. Not ready for implementation.

## 19. Decisions Log
- DEC-ACC-001: Semantic roles, not codes, are the stable identity.
- DEC-ACC-002: Role catalog is static code; mappings are relational tenant data.
- DEC-ACC-003: Explicit invalid mapping blocks posting; no silent fallback.
- DEC-ACC-004: Legacy fallback is transitional and prospective only.
- DEC-ACC-005: LedgerService remains semantic-role agnostic.
- DEC-ACC-006: Fiscal close requires separate design before code.
- DEC-ACC-007: Routing/locks/fiscal branch policies are independent decisions.
- DEC-ACC-008: Product sales/COGS overrides remain higher precedence in V1.
- DEC-ACC-009: Purchase returns do not get a dedicated role merely by analogy.
- DEC-ACC-010: `5180` is not purchase returns.
- DEC-ACC-011: `5180` is decomposed by business cause into count variance, manual adjustment and damage/loss roles.
- DEC-ACC-012: Do not split stock variance gain/loss merely by sign in V1.
- DEC-ACC-013: Free-text Stock Permit reason cannot drive accounting routing.
- DEC-ACC-014: Cross-branch inventory transfer currently needs no clearing role.
- DEC-ACC-015: `opening_balances` is semantically confirmed; settings placement remains under review.
- DEC-ACC-016: Cash/Bank accounts are resolved by CashBankAccount domain, not generic Accounting Roles.
- DEC-ACC-017: Payment Methods are not Account Routing roles.
- DEC-ACC-018: Domain-specific financial resolvers with policy/permission checks take precedence over generic role resolver.
- DEC-ACC-019: Cash/Bank transfers require no semantic transfer-clearing role today.
- DEC-ACC-020: Purchase Return and Supplier Refund are distinct target operations; current direct `1110` cash return path is a financial-design gate.
- DEC-ACC-021: Do not overload existing `Payment.direction` for Supplier Refund; design a dedicated refund domain before ACC-4.
- DEC-ACC-022: Legacy `5170` is one shared `document_adjustment` role for the current sales/purchase header-adjustment concept.
- DEC-ACC-023: Do not create separate sales/purchase adjustment roles in V1 without a future proven accounting distinction.
- DEC-ACC-024: Account Routing must preserve current adjustment tax/cost-center behavior; it changes account resolution only.
- DEC-ACC-025: Accounting Settings uses dedicated `accounting_settings.view/manage` permissions; owner/admin via wildcard, accountant/staff not granted by default.
- DEC-ACC-026: `/accounting-settings` is a permission-gated leaf under the Accounting sidebar group; Finance Settings is a UI precedent, not its parent.
- DEC-ACC-027: V1 role mappings are CompanyWide tenant data with unique `(tenant_id, role_key)` and no branch dimension.
- DEC-ACC-028: Mapping reset means unmapped/system-default state, never “disable accounting”.
- DEC-ACC-029: ACC-2 introduces a dedicated narrow mapping audit trail rather than a generic cross-domain audit framework.
- DEC-ACC-030: ACC-2 has zero posting consumers; first behavior-changing account-routing adoption begins in ACC-3.

## 20. Immediate Next Step
**ACC-1 is now architecture-ready.** Prepare a focused implementation task for ACC-1 only: RBAC permissions, `/accounting-settings` hub, Accounting sidebar leaf, i18n, visibility/access tests and web build. No schema, resolver, posting, fiscal or financial behavior changes.

After ACC-1 is reviewed/merged only with explicit approval, prepare ACC-2 as a separate implementation task using §17 contracts.
