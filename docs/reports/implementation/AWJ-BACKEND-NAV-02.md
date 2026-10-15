# AWJ-BACKEND-NAV-02 — Commercial Dependency Navigation Parity

STATUS: in review (PR open; see "Reviews" and "Closure" below)
DATE: 2026-10-15
BASE: `origin/main` @ `0bfa84d`

## Outcome

`GET /applications/nav-state` now agrees with the route guard for **commercial capabilities that have dependencies**.

- **`fuel_stations.avi` entitled but `fuel_stations.core` not:** the AVI/RFID link is **hidden**. Before, it was shown and every `fuel-stations/avi-rfid/*` route returned **403**.
- **Both entitled (and enabled):** unchanged, visible.
- **`core` read-only:** AVI stays visible for reads (the guard allows reads); writes stay refused by the guard.

No entitlement rule, route guard, RBAC rule, migration or API shape changed. Nothing is granted. Visibility can only go from shown to hidden, and only where the route already returns 403.

## Problem evidence

NAV-01 "Remaining work" recorded the gap: `navVisibility()` does not evaluate dependencies, `ApplicationAccessDecision` does.

| Layer | Contract |
|---|---|
| Catalog | `fuel_stations.avi`, `.maintenance`, `.integrations`: `access: commercial`, `dependencies: [fuel_stations.core]` |
| Routes (`routes/api.php` 1313+) | `EnsureCommercialApplicationAccess:fuel_stations.avi` → `ApplicationAccessDecision::decide(...)` |
| Decision | Evaluates the entitlement of the key **and recursively of every dependency**; a denied dependency denies the key (`DEPENDENCY_NOT_ENTITLED` / `DEPENDENCY_DISABLED` / `DEPENDENCY_READ_ONLY` for writes) |
| `navVisibility()` (before) | `enabled && entitled` for the key itself only |
| Web (`fuel-workspace-nav.ts`, `sidebar.tsx`) | Hides only on an explicit `false` |

The same defect applied to `fuel_stations.maintenance` (4 nav items) and `fuel_stations.integrations` (device registry).

## Root cause

`navVisibility()` re-implemented a subset of the decision (own entitlement + own status) and left the dependency walk out.

## Fix (smallest safe change)

`app/Services/TenantApplicationService.php` (+27 / −1):

- New private `dependenciesAllowRead($key, $application)`. For a **commercial key with dependencies** it delegates to `ApplicationAccessDecision::decide($tenant, $key, READ)` and accepts anything but `DENIED`. For every other key it returns `true`, so the result is exactly what it was.
- `navVisibility()` ANDs it into the existing `enabled && entitled`.
- The decision service is resolved lazily with `app()` because it depends on this service (constructor injection would be circular).

Why delegate instead of walking `ApplicationCatalog::dependenciesFor()` here: the dependency semantics (entitlement, app status, suspended, read-only vs write, cycles, not-built) live in one place. A second copy would drift. Parity is now by construction for these keys.

### Scope boundary (deliberate)

| Keys | Behavior |
|---|---|
| Commercial **with** dependencies (`fuel_stations.avi/maintenance/integrations`) | Now delegated to the decision → dependency-aware |
| Commercial without dependencies (`sales.invoicing`, `fuel_stations.core`, `document_center.core`) | Unchanged (batched resolver path from NAV-01) |
| Operational keys with dependencies (`sales.pos`, `hr.payroll`, …) | **Unchanged.** Their guard `EnsureApplicationActive` checks the key's own status only and never evaluates dependencies; hiding them for a dependency would make the UI narrower than the server |

Cost: three extra decision evaluations per nav-state call, only for the three dependent commercial keys.

### Not adopted
| Option | Why not |
|---|---|
| Walk dependencies inside `navVisibility()` | Duplicates entitlement/status/read-only rules; guaranteed drift |
| Apply dependency rules to every key | Changes behavior of operational keys whose guards ignore dependencies |
| Change the guard, grants or plan materialization | Forbidden: entitlement rules must not change |
| Web-side workaround | The web must not compute entitlements; nav-state is the contract |

## Changed files

| File | Change |
|---|---|
| `app/Services/TenantApplicationService.php` | Dependency-aware visibility for dependent commercial keys |
| `tests/Feature/ApplicationDependencyNavigationParityTest.php` | New, 10 tests |
| `tests/Feature/SalesInvoicingNavigationParityTest.php` | Comment only: the "uniform grants" docblock now points at the new guard |
| `CLAUDE.md` | One contract line |
| `docs/reports/implementation/AWJ-BACKEND-NAV-02.md` | This report |

No web change: the sidebar and the fuel workspace nav already hide on an explicit `false` for `fuel_stations.avi/maintenance/integrations`.

## Tests (`ApplicationDependencyNavigationParityTest`)

| Test | Proves |
|---|---|
| avi without core | **Key case.** `fuel_stations.avi` entitled, `core` not: nav `avi=false`, `core=false`, `GET /fuel-stations/avi-rfid/tags` → 403 |
| avi with core | Both `true`; route → 200 |
| core alone | `core=true`, `avi=false`, route → 403 |
| read-only dependency | `avi=true`; GET → 200; POST → 403 (writes refused) |
| revoked dependency | Visible, then hidden after revoking `core`; route → 403 |
| disabled dependency application | AVI enabled and entitled, `core` entitled but its app is disabled: hidden, route → 403. Isolates the dependency path (the key alone would pass) |
| cross-tenant | A (both) `true`/200; B (avi only) `false`/403. No leak |
| RBAC | Owner and `viewer` get identical nav-state; the viewer is still refused by RBAC on the route (separate gate, not widened) |
| unchanged keys | `document_center.core` visible, `sales.invoicing` hidden, mandatory operational key absent, operational `sales.pos` visible |
| **generic mixed-grant guard** | For **every** built commercial key with dependencies: all 9 combinations of own × dependency grant (none/read-only/full): nav visible ⇔ `decide(READ) ≠ DENIED`. Any future dependent commercial capability is covered automatically |

### Results
| Run | Result |
|---|---|
| New class on **unfixed** `origin/main` service | **5 of 10 fail** (regression proof); with the fix 10/10 pass, 107 assertions |
| Related backend (`ApplicationNavState*`, `ApplicationEnforcement*`, `SalesInvoicingNavigationParity`, `PlatformApplicationOverride*`, `PlatformGlobalApplicationOverride*`, `ApplicationAccess*`, `ApplicationCatalog*`, `TenantApplication*`, `FuelStationsCommercial*`, `FuelStationsFoundation*`, `DeliveryNote*`, `Entitlement*`) | 232 passed, 2144 assertions |
| Full PHP suite, sqlite, serial | 6956 passed, 99 skipped, 26 failed (653 s). All 26 are in `FuelAviRfidService`, `FuelReconciliation`, `FuelSaleApi`, `FuelSaleService`, `FuelSupplyReceiving*` and need `bcmath`, absent locally (`bcmul` etc.): the same set recorded as the baseline in NAV-01, green in CI. No navigation, application, entitlement or delivery-note test fails |

## Security / tenant isolation / backward compatibility
- **Entitlements and RBAC:** no rule changed, nothing granted. `decide()` is called without an RBAC verdict, the same as the guard's first stage; RBAC stays its own middleware.
- **Tenant isolation:** the tenant comes from `TenantContext`; the cross-tenant test proves no leak.
- **Backward compatibility:** same response shape, same keys. Fully entitled tenants see no change. Tenants with an AVI/maintenance/integrations grant but no `core` grant lose a link that already returned 403.
- **Accounting:** none. No ledger, journal or money path touched, so there are no journal entries.

## Risks
- A tenant granted AVI/maintenance/integrations without `core` now sees the link disappear. That is an entitlement-assignment question for the owner (granting is out of scope); the link returns as soon as `core` is granted and enabled.
- Web fail-open on a failed nav-state read is unchanged; the server still refuses with 403.

## Remaining work (not in scope)
- Operational keys with dependencies: aligning them would need `EnsureApplicationActive` to evaluate dependencies first. Not proposed; there is no observed disagreement today.
- `name_en` on report account rows (D-ERP-UX-01) stays a separate owner decision.

## Reviews and closure
Filled in on the PR (Reviewer, AWJ Guardian, CI, PRE_MERGE_REVIEW, POST_MERGE_REVIEW).
