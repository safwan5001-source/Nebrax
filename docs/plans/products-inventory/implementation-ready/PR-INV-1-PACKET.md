# Implementation-Ready Packet — PR-INV-1

**State:** IMPLEMENTATION-READY; implementation not authorized.
**Baseline note:** implementation MUST reconcile against then-current `main` before code changes.
**Contract:** `../phase-1-hardening/PR-INV-1-cost-authorization.md`

## FROM — verified current code

`products.view_cost` already exists in `app/Support/Rbac.php`; owner/admin receive it through wildcard and accountant/staff are not automatically granted it. This PR does not create a new permission or redesign roles.

Confirmed disclosure/write surfaces:
- `ProductResource` hides `profit_margin`, `purchase_price`, and `avg_cost` only when a POS-specific `pos_hides_cost_profit` attribute is attached; non-POS consumers remain exposed.
- `PublicProductResource` intentionally excludes internal cost/inventory fields; preserve this safe contract.
- `InventoryController::index()` returns `avg_cost`, row `stock_value`, and aggregate `total_value` unconditionally.
- `InventoryController::movements()` returns `unit_cost` and `total_cost` unconditionally.
- `ProductListFilters` exposes purchase-price filter/sort capability, so hiding output alone does not close inference.
- `InventoryBalanceFilters` exposes `avg_cost_min/max`, `stock_value_min/max`, and `avg_cost`/`stock_value` sorts; Inventory export shares it.
- `ProductExportService` uses the Product import/export field contract and includes `purchase_price`; human/read-only output also includes `avg_cost`.
- `ProductActivityResource` returns raw `diff`, exposing historical old/new classified values.
- Product create/update accepts `purchase_price` under ordinary Product management without a central cost-write gate.
- `ProductImportFields` makes `purchase_price` writable/updateable; Product Import Apply therefore needs current permission reauthorization.
- POS already requires `products.view_cost` AND tenant setting `show_cost_profit_in_pos`; centralization must preserve this stricter conjunction.

## TO — central policy

One backend-owned Sensitive Product/Inventory Cost policy/classification is the source of truth.

Minimum classified set:
- `purchase_price`
- `avg_cost`
- `profit_margin`
- derived `stock_value`
- aggregate inventory valuation / `total_value`
- StockMovement `unit_cost`
- StockMovement `total_cost`
- old/new activity diff entries for classified fields
- query/filter/sort capabilities whose execution reveals classified cost.

`sale_price` is explicitly NOT sensitive cost.

Authorization:
- ordinary Product mutation: existing `products.manage`.
- actual sensitive cost write/import: `products.manage` + `products.view_cost`.
- classified read/export/filter/sort/history: `products.view_cost`.
- POS: `products.view_cost` + existing tenant POS visibility setting.

## Preferred architecture

Introduce one narrow backend support/policy class owning classified keys, view/assert semantics, sensitive mutation/import detection, activity-diff redaction, and query/export decisions. Do not duplicate independent sensitive-field arrays across resources/import/export/history.

## Exact surface behavior

### Product read/history
Unauthorized users retain non-cost Product data but classified fields are omitted/redacted server-side. Prefer omission, never fake zero cost. Activity rows remain visible when otherwise authorized; strip only classified old/new diff entries.

### Product writes
`products.manage` without cost permission can perform non-cost edits. Actual purchase-price write/change requires cost permission. Do not block solely because persisted state already contains a purchase price; test unchanged/echoed-field semantics deterministically.

### Product import
Inspect/preview disclose only authorized data. Apply MUST reauthorize actual mapped/write fields at execution time. Permission revoked after preview → fail closed before Product mutation.

### Product export/query
Unauthorized export contains no classified cost in any supported format/scope. Unauthorized purchase-price filter/sort is rejected before query execution, not silently applied.

### Inventory read/export/query
Unauthorized operational users may retain identity/quantity visibility, but no `avg_cost`, `stock_value`, aggregate valuation, movement `unit_cost` or `total_cost`. Inventory cost/value filters/sorts are rejected before execution. Unauthorized export has no valuation columns.

### Inventory reports
`InventoryReportController` converts several monetary keys. Implementation-time census must distinguish actual cost/valuation fields from ordinary accounting amounts; do not redact every monetary field blindly.

### POS
Delegate to central cost permission where practical while retaining `show_cost_profit_in_pos` as an additional restriction. No weakening.

## Likely change set
- one new central support/policy class;
- `ProductResource`, `ProductActivityResource`;
- ProductController/request write boundary;
- `ProductListFilters` caller authorization;
- Product export service/boundary;
- Product import field/service/apply boundary;
- `InventoryController`;
- `InventoryBalanceFilters` and export boundary/service;
- InventoryReportController only for verified classified fields;
- PosController only to converge permission logic without changing setting semantics;
- targeted security Feature tests;
- frontend only as needed to stop presenting forbidden capabilities; backend remains security boundary.

## Forbidden
No moving-average/costing algorithm changes, GL/journal changes, sale-price permission changes, role taxonomy redesign, generic export rewrite, Inventory Workspace V2, or schema migration without stopping for approval.

## Security proof matrix
1. authorized Product list/show includes current classified fields.
2. unauthorized Product list/show contains no purchase_price/avg_cost/profit_margin leakage.
3. unauthorized Product activity preserves non-cost history but strips classified old/new values.
4. authorized activity remains complete.
5. manage-without-cost can create/update non-cost fields.
6. same user cannot write/change purchase price; zero mutation on denial.
7. manage + view_cost can write purchase price.
8. authorized Product export preserves current cost contract.
9. unauthorized Product exports contain no classified values in every supported mode/format.
10. unauthorized purchase-price filter/sort rejected before execution.
11. import inspect/preview does not disclose forbidden cost data.
12. import apply with cost mapping requires current permission.
13. permission revoked after preview → apply denied with zero mutation.
14. Inventory index unauthorized retains safe operational data but no valuation.
15. Inventory movements unauthorized omit unit/total cost; authorized include them.
16. Inventory export unauthorized has no valuation columns.
17. unauthorized Inventory cost/value filter/sort rejected before execution.
18. POS matrix: permission absent = hidden; permission + setting OFF = hidden; permission + setting ON = visible.
19. PublicProductResource remains cost-free.
20. wildcard/custom-role grants remain functional.
21. Tenant isolation and RBAC suites remain green.

## Security invariants
Frontend hiding is not authorization. Redaction plus executable sensitive filter/sort is still a leak. Preview state is never later authorization. Historical and derived values are sensitive when they reveal cost. Cost permission grants neither Product management nor unrelated route access.

## Test order
1. targeted cost-security Feature tests;
2. Product resource/controller/activity;
3. Product import/export;
4. Inventory API/export/filter;
5. POS cost-profit security;
6. RBAC + tenant isolation;
7. full backend SQLite then PostgreSQL/CI matrix expected for security-sensitive changes;
8. web tests/build if UI capability visibility changes.

## Stop conditions
Stop if an established API requires sensitive values for unauthorized callers, import apply reauthorization needs material persistence redesign, report amount classification is ambiguous, centralization would weaken POS, or a newly found leak materially expands scope.

## Definition of Done
No unauthorized server response, history diff, export, query capability or Product/import write can disclose, infer or mutate classified cost. Non-cost Product/Inventory work remains usable. POS is no weaker. No accounting/costing algorithm changes.

## Eventual Claude Code handoff
Only after Safwan explicitly authorizes implementation. Reconcile against then-current `main`; mandatory final MD report with changed files, tests/results, SQLite/PostgreSQL/CI, risks/remaining, Branch/PR/Base SHA/Head SHA and next step. No Merge/Deploy.