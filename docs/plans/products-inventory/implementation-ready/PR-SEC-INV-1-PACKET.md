# Implementation-Ready Packet — PR-SEC-INV-1

**State:** IMPLEMENTATION-READY; implementation not authorized.
**Baseline:** main `f73a3f2bb5685e8f9e995e0febe61f81459c2a88`
**Contract:** `../phase-1-hardening/PR-SEC-INV-1.md`

## FROM — verified current code

`StocktakeController`:
- `index()` uses `scopeToActiveBranch()`.
- `store()` validates tenant Warehouse, `assertWarehouseAllowed()`, and tenant Products.
- `show()` directly `findOrFail()` then returns resource.
- `count()` directly `findOrFail()` then domain count.
- `post()` directly `findOrFail()` then domain post.
- `destroy()` directly `findOrFail()` then delete if draft.

`StockPermitController`:
- `index()` uses `scopeToActiveBranch()`.
- `store()` validates tenant source/target warehouses and calls `assertWarehouseAllowed()` for both.
- `show()`, `post()`, `destroy()` directly `findOrFail()` without reasserting record warehouse access.

`ApiController` current reusable primitives:
- `scopeToActiveBranch()` respects `allowedBranchIds()` and makes `branch=all` mean all user-owned branches, not tenant-wide unrestricted access.
- `assertWarehouseAllowed()` verifies TenantScope-visible Warehouse, active state, `canAccessWarehouse()` and `canAccessBranch()`.
- central/no-branch Warehouse can pass warehouse permission without fabricated branch.

## TO — exact boundary

All direct UUID read/mutation paths for Stocktake and StockPermit must enforce the same user's operational Warehouse/Branch access before resource exposure or domain mutation.

### Stocktake
Authorize its `warehouse_id` for show/count/post/destroy. TenantScope remains first boundary. Do not use `branch_id` alone when Warehouse permission is narrower.

### Stock Permit
Authorize `warehouse_id` and, when non-null, `target_warehouse_id` for show/post/destroy. A transfer requires access to both endpoints. Receipt/issue must not invent a target requirement.

## Preferred implementation shape

Prefer one small reusable protected helper in `ApiController` or a narrowly named inventory-record authorization helper that composes `assertWarehouseAllowed()`. Avoid introducing policies/global scopes/permission taxonomy unless current tests prove a helper cannot express the boundary.

The helper must not resolve an implicit/default warehouse for a record whose stored warehouse id is null unless existing domain semantics explicitly require that. Direct record authorization should authorize what the record actually references; do not mutate or reinterpret the document while checking access.

## Expected change set
Likely code changes:
- `app/Http/Controllers/Api/ApiController.php` (only if central helper added)
- `app/Http/Controllers/Api/StocktakeController.php`
- `app/Http/Controllers/Api/StockPermitController.php`
- targeted API/feature authorization tests.

Verified regression test anchors:
- `tests/Feature/StocktakeTest.php` — domain/accounting behavior, including snapshot/open/count/post semantics and posted-document guard. Keep green; do not repurpose as the sole HTTP authorization suite.
- `tests/Feature/StockPermitTest.php` — receipt/issue/transfer accounting, frozen cost, warehouse distribution and cross-branch transfer behavior. Keep green; do not weaken its ledger invariants.
- `tests/Feature/ApiInventoryTest.php` — existing API inventory report/movement/tenant-isolation coverage; useful as neighboring API regression, but it does not currently prove direct Stocktake/StockPermit UUID authorization.

Preferred new test placement: add a narrowly named HTTP feature suite such as `tests/Feature/StockDocumentAuthorizationTest.php` (or extend an existing authorization suite only if implementation-time census finds a clearly canonical home). Do not bury the security matrix inside service-only tests because the defect is controller/direct-route authorization.

Inspect-only unless evidence requires change:
- Stocktake/StockPermit models and services;
- User branch/warehouse access helpers;
- BranchContext;
- route middleware/permissions;
- inventory posting tests.

Forbidden in this PR:
- StocktakeService/StockPermitService accounting or UOM behavior changes;
- `BranchScoped` conversion;
- DeliveryNote/InventoryOpening changes;
- migrations/schema changes;
- permission taxonomy redesign.

## API/failure contract
No successful response shape changes. Denied direct access must use the project's safe established error convention and must not reveal document/resource content. Do not expose whether a UUID belongs to another inaccessible branch beyond existing safe semantics. Cross-tenant remains protected by TenantScope.

## Proof matrix
1. same tenant + allowed Stocktake warehouse → show/count/post/destroy reach normal domain behavior.
2. same tenant + disallowed Stocktake warehouse → all four denied.
3. same tenant + branch allowed but warehouse disallowed → denied.
4. StockPermit receipt/issue source allowed → normal behavior.
5. StockPermit source disallowed → show/post/destroy denied.
6. transfer source allowed + target denied → denied.
7. transfer source denied + target allowed → denied.
8. transfer both allowed → normal behavior.
9. central/no-branch warehouse follows warehouse permission and is not rejected merely because branch_id is null.
10. `branch=all` list behavior stays limited to allowed branches; direct UUID cannot bypass it.
11. other-tenant UUID remains inaccessible under TenantScope.
12. denied count/post/destroy creates no line mutation, document state change, StockMovement, ProductWarehouseStock delta or JournalEntry.
13. existing double-post/posting tests stay green.

## Required test execution order
1. new targeted HTTP authorization suite.
2. `php artisan test --filter=StocktakeTest`.
3. `php artisan test --filter=StockPermitTest`.
4. neighboring API authorization/tenant-isolation tests, including `ApiInventoryTest` and canonical RBAC/tenant suites found on implementation baseline.
5. broader backend suite only after targeted tests pass; do not reduce PostgreSQL coverage if CI normally runs it.

## Concurrency/accounting/UOM
No new concurrency mechanism. Existing posting locks remain untouched. No accounting/UOM changes. Security denial occurs before domain service invocation, therefore before any stock/GL effect.

## Stop conditions
Stop and report rather than expand if:
- warehouse access semantics differ between list/store and User helpers;
- a direct action intentionally supports cross-warehouse access not represented by document warehouse ids;
- established failure semantics require a project-wide authorization redesign;
- tests reveal another same structural gap outside Stocktake/StockPermit. Record it separately; do not add it to this PR automatically.

## Definition of Done
- Every direct Stocktake/StockPermit UUID route in scope is guarded before resource exposure or service mutation.
- Both source and target warehouses are enforced for transfer permits.
- Denial has zero stock, document, or GL side effects.
- Tenant isolation remains unchanged and green.
- Existing Stocktake/StockPermit accounting invariants remain green.
- No schema, UOM, accounting, permission-taxonomy or unrelated controller changes.
- Implementation report records exact tests, results, changed files, branch/PR/Base SHA/Head SHA, risks and next step.

## Claude Code final handoff requirements
When owner later authorizes execution, prompt Claude Code to implement only this packet from then-current `main`, first reconciling SHA/code drift. Mandatory final MD Implementation Report. No Merge/Deploy.