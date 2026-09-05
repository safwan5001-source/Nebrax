# PR-SEC-INV-1 — Same-Tenant Inventory Record Authorization

**Priority:** P1 / first implementation gate  
**Status:** PLANNED — not implemented

## Confirmed problem

Stocktake and Stock Permit are tenant-isolated but intentionally use explicit branch filtering rather than a global `BranchScoped` filter. List/create paths enforce branch/warehouse access; direct record actions load tenant-scoped IDs without consistently reasserting the current user's allowed branch/warehouse access.

Affected confirmed actions:
- Stocktake: show, count, post, destroy.
- Stock Permit: show, post, destroy.

This is not cross-tenant leakage. It is same-tenant authorization for users restricted to selected branches/warehouses.

## Required invariant

Knowing a UUID never grants access. A restricted user must not read or mutate/post a Stocktake whose operational warehouse/branch is inaccessible. For Stock Permit, authorization must account for the operational branch and all relevant source/target warehouses; cross-branch transfer semantics must remain valid for users authorized to both sides.

## Design constraints

- Do not weaken TenantScope.
- Do not blindly convert Stocktake/StockPermit to `BranchScoped`; their explicit accounting/cross-branch semantics are intentional.
- Reuse/centralize existing `ApiController`/branch/warehouse authorization semantics where practical; avoid controller-specific policy drift.
- Record authorization must run before exposing detail data and before state-changing domain calls.
- `branch=all` means all branches the user is actually allowed to access, not unrestricted tenant access.
- Preserve source/target warehouse validation for transfer.
- Do not change accounting, UOM, posting, numbering or inventory behavior in this PR.

## Scope

1. Define one authoritative record-access check/query policy for warehouse-bound explicit-scope inventory documents.
2. Apply to confirmed Stocktake/StockPermit direct actions.
3. Cover source and target warehouse for transfer permits.
4. Add regression tests for allowed and denied users inside the same tenant, plus cross-tenant controls.
5. Keep list/store behavior consistent with direct-action behavior.

## Out of scope

DeliveryNote already uses `BranchScoped` and is not to be rewritten here. Inventory Opening is intentionally CompanyWide and multi-branch. Do not audit/refactor unrelated ERP documents. No permission taxonomy redesign.

## Failure semantics

Use the project's established authorization/not-found convention consistently. Do not reveal inaccessible record data in error payloads. State-changing denial must occur before stock/GL effects.

## Test matrix

- same tenant, same allowed branch/warehouse → allowed;
- same tenant, different disallowed branch → denied;
- same tenant, branch allowed but warehouse restricted → denied where warehouse restrictions apply;
- transfer source allowed/target denied → denied;
- transfer target allowed/source denied → denied;
- both transfer warehouses allowed → allowed;
- `branch=all` with limited owned branches → cannot escape owned set;
- other tenant UUID → remains inaccessible;
- denied post/count/destroy produces no mutation, stock movement or journal entry;
- existing posting lock/double-post tests remain green.

## Acceptance

All confirmed direct UUID paths enforce the same access boundary as discovery/creation, with no accounting/UOM behavior change and no regression to legitimate cross-branch transfer.