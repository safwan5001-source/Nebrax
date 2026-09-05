# PR-INV-1 — Central Sensitive Cost Authorization

**Priority:** P1  
**Status:** PLANNED

## Confirmed problem

`products.view_cost` exists but sensitive Product/Inventory cost data is not centrally enforced. Confirmed surfaces include Product resource/activity/export, Inventory valuation/export/movements, cost-derived filter/sort inference, Product purchase-price writes and Product Import purchase-price apply.

Sensitive classification includes at minimum: purchase price, average cost, profit margin, stock value, movement unit cost, movement total cost. Sale price is not cost.

## Policy contract

- ordinary Product edit: `products.manage`.
- sensitive cost write: `products.manage` + `products.view_cost`.
- sensitive cost read/export/filter/sort: `products.view_cost`.
- owner/admin wildcard remains authorized; accountant/staff remain unauthorized unless explicitly granted.
- POS existing local gate must converge on, not bypass, the central policy.

## Architecture direction

Create one backend-owned sensitive-cost classification/policy reusable by resources, history redaction, requests/controllers, import/export and query/filter layers. Avoid multiple independent arrays that can drift.

Unauthorized users may still use operational Product/Inventory endpoints when otherwise permitted, but response/export/query capabilities must not disclose or infer cost. Choose deterministic safe behavior per surface: redact/omit fields for safe read shapes; reject cost-specific filter/sort/write requests; safe export omits sensitive columns or uses an explicitly safe template.

## Import rule

Inspect/preview UX policy may show only what authorization permits. Apply must always reauthorize the actual mapped fields and reject any attempt to write `purchase_price` without cost permission. Never trust a preview/session created under older permissions.

## Activity/history

Raw dirty diffs can disclose prior/new cost values. Redaction must operate on both old and new values/field entries without corrupting unrelated audit history.

## Out of scope

No change to costing algorithm, moving average, GL, sale-price permission, role redesign or broad export framework refactor.

## Tests

Authorized vs unauthorized for:
- Product list/show;
- Product activity/history;
- Product export catalog and round-trip;
- Inventory list/valuation;
- Inventory export;
- movement cost fields;
- cost/value filters and sorts;
- Product create/update with and without purchase_price changes;
- import inspect/preview/apply as policy requires;
- permission revoked between preview and apply;
- POS cost visibility remains no weaker than current behavior.

## Acceptance

No server response, export, historical diff, query capability or write path can disclose/change classified cost without `products.view_cost`, while non-cost Product/Inventory work remains usable for users with their existing ordinary permissions.