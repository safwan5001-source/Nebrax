# Implementation-Ready Packet — PR-INV-1

**State:** GROUNDED — surface census continues; implementation not authorized.
**Baseline:** main `f73a3f2bb5685e8f9e995e0febe61f81459c2a88`
**Contract:** `../phase-1-hardening/PR-INV-1-cost-authorization.md`

## FROM — verified current code

### Product read surface
`ProductResource` currently hides `profit_margin`, `purchase_price`, and `avg_cost` only when a POS-specific synthetic attribute `pos_hides_cost_profit` is attached. The resource comment explicitly says other ERP/webhook/fuel consumers do not set that flag, so the same cost fields remain visible outside POS.

### Inventory read surface
`InventoryController::index()` returns `avg_cost`, per-row `stock_value`, and aggregate `total_value` unconditionally. `movements()` returns `unit_cost` and `total_cost` unconditionally.

### Product filter/sort inference
`ProductListFilters` exposes `purchase_price_gte/lte/eq` and `purchase_price` sort to any caller that reaches the endpoint. Product list and Product export share this filter/sort contract.

### Inventory filter/sort inference
`InventoryBalanceFilters` exposes `avg_cost_min/max`, `stock_value_min/max`, and sorts by `avg_cost`/`stock_value`. Inventory export uses the same filter/sort contract.

### Product writes
`StoreProductRequest::authorize()` returns true and validates `purchase_price` as a normal nullable field. `ProductController::store/update` passes validated data into Product domain/lifecycle services without a local sensitive-cost authorization check.

### Product import
`ProductController` exposes import fields/inspect/preview/apply through `ProductImportService`; apply receives file/options/user id. The approved contract requires permission reauthorization at apply time, not trust in preview.

## TO — exact policy boundary

Create one backend-owned Sensitive Product/Inventory Cost policy/classification and make all classified surfaces consume it.

Classified minimum set:
- `purchase_price`
- `avg_cost`
- `profit_margin`
- derived `stock_value` / aggregate inventory value
- StockMovement `unit_cost`
- StockMovement `total_cost`

`sale_price` is explicitly NOT sensitive cost.

### Read/export/filter/sort
Require `products.view_cost`. Unauthorized operational users retain non-cost Product/Inventory functionality, but classified fields are omitted/redacted and classified filters/sorts are rejected rather than silently applied.

### Writes
Ordinary Product mutation remains `products.manage`. Any create/update/import operation that actually writes `purchase_price` requires both `products.manage` and `products.view_cost`. Do not require cost permission merely because an unchanged cost field exists in persisted state.

### Import TOCTOU
Inspect/preview must not disclose cost beyond current permission. Apply must reauthorize mapped/actual cost fields at execution time so permission revocation between preview and apply fails closed.

### Activity/history
Old/new/dirty diff representations must redact classified fields for unauthorized readers on both sides of the diff while preserving unrelated history.

### POS convergence
Replace or delegate the POS-local cost classification to the central policy where practical. POS may keep its tenant setting `show_cost_profit_in_pos` as an additional restriction; it must never become weaker than `products.view_cost`.

## Expected change areas
Likely:
- new narrowly scoped backend support/policy class under `app/Support` or equivalent;
- `ProductResource`;
- `InventoryController`;
- `ProductListFilters` + request/controller rejection of classified query capabilities;
- `InventoryBalanceFilters` + export request/controller rejection;
- Product create/update authorization path;
- Product import field/preview/apply authorization;
- Product export and Inventory export column selection;
- Product activity resource/history redaction;
- POS cost gate delegation;
- targeted Feature tests.

Do not change costing algorithms, moving average, inventory posting, GL, sale-price permissions, role taxonomy, or generic export architecture.

## Security proof obligations
1. Unauthorized Product list/show has no purchase_price/avg_cost/profit_margin leakage.
2. Authorized Product list/show remains backward-compatible for cost fields.
3. Unauthorized Product activity cannot infer old/new cost values.
4. Unauthorized Product catalog and round-trip exports contain no classified cost.
5. Unauthorized Inventory list has no avg_cost/stock_value/total_value leakage.
6. Unauthorized movement response has no unit_cost/total_cost leakage.
7. Unauthorized Product purchase-price filter/sort is rejected deterministically.
8. Unauthorized Inventory avg-cost/value filter/sort is rejected deterministically.
9. Unauthorized create/update may change non-cost fields but cannot write/change purchase_price.
10. Authorized products.manage + products.view_cost can write purchase_price.
11. Import inspect/preview/apply obey current permission; revoked permission before apply fails closed.
12. Export cannot bypass policy through `scope=all`, `filtered`, selected IDs, CSV/XLSX, or round-trip template.
13. POS requires both central permission and its existing visibility setting where that setting applies.
14. Owner/admin wildcard remains functional; explicit grant remains functional.
15. Tenant isolation tests remain green.

## Compatibility contract
Authorized callers keep existing field names/monetary formatting. Unauthorized callers lose only classified data/capabilities, not unrelated operational fields. Avoid returning fake zero cost because that is semantically dangerous; omit/redact according to existing resource conventions.

## Stop conditions
Stop and report if centralizing policy would require changing role semantics, public API contract beyond classified redaction, accounting algorithms, or broad export infrastructure. Record newly found cost surfaces in this packet before adding them to implementation scope.

## Claude Code handoff
When later authorized, reconcile against then-current main SHA, implement only the classified-cost boundary, run targeted security tests then full relevant backend suite, and return mandatory MD Implementation Report. No merge/deploy.