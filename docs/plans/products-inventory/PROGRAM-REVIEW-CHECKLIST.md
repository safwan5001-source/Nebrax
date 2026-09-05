# Products & Inventory — Program Review Checklist

Use before merging the planning/audit documentation and again before authorizing implementation.

## Audit alignment
- [ ] Every Phase-1 P1 finding maps to exactly one implementation contract.
- [ ] No confirmed P1 is silently downgraded.
- [ ] PASS findings are not turned into unnecessary rebuilds.
- [ ] Daftra benchmark items remain benchmark/adopt/improve decisions, not copied requirements.

## Architecture
- [ ] Existing InventoryService/perpetual inventory remains core.
- [ ] TenantScope remains hard security boundary.
- [ ] BranchScope is not mistaken for tenant security.
- [ ] Global Product moving average remains valuation model.
- [ ] Warehouse quantities remain ProductWarehouseStock truth.
- [ ] Base UOM remains inventory quantity truth.
- [ ] Price is never derived from UOM factor.
- [ ] Product Catalog and Inventory Opening effects remain separate.

## Accounting
- [ ] Every financial stock PR explicitly proves `Δ1140 = Δ inventory subledger`.
- [ ] Supplier/customer commercial value can differ from carrying value where domain requires.
- [ ] Draft/review/import-preview states do not accidentally post stock/GL.
- [ ] No new accounts or valuation method introduced without explicit approval.

## Security & privacy
- [ ] Same-tenant branch/warehouse UUID access is covered.
- [ ] Cost read/write/export/history/filter/sort inference is centralized.
- [ ] Direct actions and list/create access boundaries agree.
- [ ] No inaccessible source is exposed through movement drilldown.

## Concurrency
- [ ] Double-post/idempotency preserved.
- [ ] Stocktake stale snapshot explicitly resolved.
- [ ] Purchase-return remaining quantity is concurrency-safe.
- [ ] Barcode namespace uniqueness is atomic.
- [ ] Reservations/serial allocation plans require atomic availability.

## Lifecycle/UOM
- [ ] Product reference registry includes known missing references.
- [ ] New Product refs must declare classification.
- [ ] In-use UOM semantic mutation cannot reinterpret stock/live refs.
- [ ] Historical snapshots remain interpretable.

## Scale/UX
- [ ] Imports use durable jobs rather than raised synchronous limits.
- [ ] Inventory Workspace is server-side and warehouse-aware.
- [ ] Dense accounting-tool UX takes precedence over decorative dashboards.

## Workflow
- [ ] Claude Code is the implementation agent.
- [ ] Every executable PR prompt requires final MD Implementation Report.
- [ ] ChatGPT reviews reports before next PR/merge decision.
- [ ] No Merge/Deploy/Production Release is implicitly authorized by documentation.