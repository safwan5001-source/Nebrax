# ACC-2 — Semantic Accounting Roles & Mapping Foundation

**Status:** READY AFTER ACC-1  
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`  
**Planning baseline:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`  
**Dependency:** ACC-1 reviewed and merged first.  
**Risk:** Medium — tenant-isolated financial configuration foundation, but **zero posting consumers** in this PR.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Build the semantic account-routing foundation without changing a single existing accounting posting path. Introduce the static role catalog, company-wide tenant mappings, resolver, validation, mapping audit trail and narrow API/UI for Account Routing.

## Non-negotiable accounting contract
1. Semantic role key is stable identity; account code is only legacy fallback.
2. No mapping -> legacy-compatible resolution.
3. Valid explicit mapping -> mapped account.
4. Explicit invalid/disabled/missing/group/cross-tenant mapping -> FAIL CLOSED; never silently fall back.
5. Historical journal lines are never re-resolved or rewritten.
6. `LedgerService` stays role-agnostic.
7. ACC-2 has zero posting consumers; no business service replaces `ACC_*` yet.
8. Cash/Bank accounts and PaymentMethods are not generic semantic roles.

## Static role catalog
Implement a code-owned catalog (e.g. `App\Support\AccountingRoles`) rather than an `accounting_roles` table. Initial V1 configurable keys:

| Key | Legacy | Domain |
|---|---:|---|
| `accounts_receivable` | 1130 | Receivables |
| `accounts_payable` | 2110 | Payables |
| `sales_revenue` | 4110 | Sales |
| `sales_shipping_revenue` | 4130 | Sales |
| `document_adjustment` | 5170 | Shared document accounting |
| `inventory_asset` | 1140 | Inventory |
| `cogs` | 5110 | Inventory |
| `purchase_expense` | 5150 | Purchases |
| `tax_output` | 2120 | Tax |
| `tax_input` | 1150 | Tax |
| `inventory_count_variance` | 5180 | Inventory |
| `inventory_manual_adjustment` | 5180 | Inventory |
| `inventory_damage_loss` | 5180 | Inventory |

`opening_balances` / 3130 is semantically known but settings placement is not yet approved; do not make it tenant-configurable in ACC-2 unless the parent plan is explicitly updated first.

Catalog metadata should include key, Arabic/English label and description, legacy code, domain/group and configurability. API must reject arbitrary keys not present in catalog.

## Relational mapping model
Create company-wide tenant data conceptually named `AccountRoleMapping` / table `account_role_mappings`.

Required invariants:
- UUID primary key.
- `tenant_id` FK, cascade on tenant delete.
- `role_key` string.
- `account_id` FK to accounts.
- unique `(tenant_id, role_key)`.
- useful index `(tenant_id, account_id)` if justified.
- model extends `BaseModel` and implements `CompanyWide`.
- no `branch_id` in V1.

Do not seed explicit mappings for existing tenants. Existing tenants remain unmapped and therefore preserve legacy behavior.

## Mapping validation
A selected account must:
- exist in the active tenant;
- be active;
- be a posting/detail account (`is_group=false`);
- be a valid Account record;
- not be accepted merely because a raw UUID exists in another tenant.

Use tenant-scoped lookup first; never fetch an arbitrary Account unscoped and then trust client tenant data.

## Resolver
Create a narrowly named resolver/service. Contract:
1. validate semantic role exists in static catalog;
2. query explicit mapping under active tenant scope;
3. if mapping exists, validate mapped account still exists/is active/is posting-eligible;
4. invalid explicit mapping -> domain exception / clear posting-safe failure;
5. if no mapping, resolve the catalog legacy account code within active tenant;
6. legacy account missing/disabled/group -> clear failure; do not invent an account;
7. return concrete Account/account ID before callers reach LedgerService.

No Invoice/Purchase/Payment/Return/Inventory service may call this resolver in ACC-2.

## Reset semantics
DELETE/reset of a mapping removes the explicit tenant decision and returns the role to **System Default / legacy fallback** for future resolution. It never means “disable accounting”. It never changes historical journals.

## Narrow audit trail
Do not build a generic audit framework. Add an immutable tenant-isolated audit/event record for mapping mutations with at least:
- tenant_id;
- actor user ID nullable only where repository conventions require;
- action: `mapping_created`, `mapping_changed`, `mapping_reset`;
- role_key;
- previous account ID and code snapshot where applicable;
- new account ID and code snapshot where applicable;
- timestamp.

Normal settings CRUD must not expose audit-row deletion.

## API
After ACC-1 permissions exist:
- `GET /accounting-settings/account-routing` — `accounting_settings.view`
- `PUT /accounting-settings/account-routing/{roleKey}` — `accounting_settings.manage`
- `DELETE /accounting-settings/account-routing/{roleKey}` — `accounting_settings.manage`

GET should return enough data to render role groups, explicit mapping, effective state (`mapped` vs `system_default`) and eligible account selection without leaking another tenant's accounts.

Mutation validation and authorization must be server-side.

## Frontend Account Routing page
Create a real Account Routing destination from `/accounting-settings` only after API exists.

Design goals:
- dense accounting workspace, not oversized SaaS cards;
- group roles by accounting domain;
- each row shows role name, short description, current effective account and state (`System default` / explicit mapping);
- account picker uses only eligible active posting accounts from current tenant;
- reset action clearly says it restores system default, not disables posting;
- warning/help text explains changes affect future postings only and never rewrite posted journals;
- RTL/LTR and AWJ design tokens; no raw decorative colors.

Do not expose cash/bank/payment-method routing here.

## Explicitly out of scope
Do NOT:
- modify `LedgerService`;
- modify any posting service or replace any hardcoded account constant;
- seed mappings that alter current tenant behavior;
- add branch-specific mappings;
- implement fiscal periods/locks;
- implement Supplier Refund or alter Purchase Return;
- add product/category routing beyond existing fields;
- add generic cash/bank semantic roles;
- rewrite historical journals;
- merge/deploy.

## Required tests
Run targeted tests first. Must cover:
1. tenant A cannot read tenant B mappings.
2. tenant A cannot map tenant B account UUID.
3. inactive account rejected.
4. group account rejected.
5. unknown role rejected.
6. unique mapping per tenant/role.
7. unmapped role resolves exact legacy account.
8. valid mapping resolves selected account.
9. explicit mapping later becoming invalid/disabled fails closed.
10. reset restores legacy-compatible resolution.
11. historical `journal_lines.account_id` unchanged after mapping mutation/reset.
12. audit created/changed/reset records actor + role + before/after snapshots.
13. view/manage RBAC separation.
14. accountant/staff without explicit permission cannot mutate mappings.
15. owner/admin wildcard remains valid.
16. resolver does not become a substitute for CashBankAccount resolver.
17. representative accounting posting tests remain byte/amount/account equivalent because there are zero consumers.
18. SQLite migration/tests pass.
19. PostgreSQL migration/tests pass.
20. frontend account-routing page tests/build/typecheck pass.

## Acceptance criteria
- Static catalog exists with approved V1 keys only.
- Relational mapping is tenant-isolated and company-wide.
- Explicit invalid mapping fails closed.
- API/RBAC works as contracted.
- Audit trail exists for mapping changes.
- Account Routing UI is real and honest about future-only effect.
- No current posting service consumes resolver.
- Existing accounting behavior remains unchanged.
- No merge/deploy.

## Implementation report contract
Return MD report with status, summary, exact files, migration/schema, tests/results (SQLite + PostgreSQL), frontend build/typecheck, RBAC results, tenant-isolation evidence, audit evidence, confirmation of zero posting consumers, risks/remaining, Branch/PR/Base SHA/Head SHA, explicit no merge/no deploy, and next step.

## Stop conditions
STOP if implementation requires changing a posting service, LedgerService, branch routing semantics, purchase-return financial behavior, historical data, or a role outside the approved catalog.

## Final instruction
Implement ACC-2 only after ACC-1 is reviewed. Keep the diff narrow. This PR creates infrastructure, not accounting behavior adoption.