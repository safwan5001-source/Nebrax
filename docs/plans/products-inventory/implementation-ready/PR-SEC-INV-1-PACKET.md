# Implementation-Ready Packet — PR-SEC-INV-1

**State:** READY AFTER FINAL TEST-PATH CENSUS; implementation not authorized.
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
- targeted API/feature tests for Stocktake/StockPermit authorization.

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

## Concurrency/accounting/UOM
No new concurrency mechanism. Existing posting locks remain untouched. No accounting/UOM changes. Security denial occurs before domain service invocation, therefore before any stock/GL effect.

## Stop conditions
Stop and report rather than expand if:
- warehouse access semantics differ between list/store and User helpers;
- a direct action intentionally supports cross-warehouse access not represented by document warehouse ids;
- established failure semantics require a project-wide authorization redesign;
- tests reveal another same structural gap outside Stocktake/StockPermit. Record it separately; do not add it to this PR automatically.

## Claude Code final handoff requirements
When owner later authorizes execution, prompt Claude Code to implement only this packet from then-current `main`, first reconciling SHA/code drift. Mandatory final MD Implementation Report. No Merge/Deploy.