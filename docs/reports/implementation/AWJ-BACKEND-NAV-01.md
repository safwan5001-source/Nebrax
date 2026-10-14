# AWJ-BACKEND-NAV-01 — `sales.invoicing` Navigation / Entitlement Parity

STATUS: in review
DATE: 2026-10-14

## Outcome

Navigation now matches the backend for **Delivery Notes** (إشعارات/سندات التسليم):
- **Tenant without the `sales.invoicing` commercial entitlement:** the sidebar link and the invoice form's "invoice draft from delivery notes" entry are hidden. Before, they were shown and the route returned **403**.
- **Entitled tenant:** both stay visible.

No entitlement rule changed and nothing was granted. No accounting, API route, RBAC, migration or tenant-isolation change.

## Problem evidence

- `docs/plans/erp/AWJ-ERP-UX-H1-8-CLOSURE.md` §6 item 2: "`nav-state` has no `sales.invoicing` key: the sidebar still shows Delivery Notes to a tenant whose entitlement returns 403."
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-5A-REPORT.md`: for a legacy test tenant, `GET /applications/nav-state` returned no `sales.invoicing` key while `GET /delivery-notes` was refused by `commercialApp('sales.invoicing', 'read')`. This was recorded for the owner as a backend/catalog decision. The owner has now assigned it.
- "إشعارات التسليم" is the Arabic module name of `delivery_notes` (`web/src/messages/ar.json`, roles screen). No backend code emits bell notifications for delivery notes, so the visible surface is the Delivery Notes entry.

## Root cause (proven)

The defect has three parts, and it needs all three:

| Layer | Contract | Fact |
|---|---|---|
| Catalog (`ApplicationCatalog`) | `sales.invoicing`: `mandatory: true`, `access: commercial` | Mandatory means it can never be disabled. Its delivery-note routes are still commercially gated. |
| Routes (`routes/api.php` 707–721) | `EnsureCommercialApplicationAccess:sales.invoicing` | `ApplicationAccessDecision` denies when the entitlement is `DENIED` → **403** |
| `TenantApplicationService::navVisibility()` | `array_filter(... ! $application['mandatory'] ...)` | **Every mandatory key is dropped**, even a commercially gated one |
| Web (`sidebar.tsx`, `nav-visibility.ts`) | Documented rule: "a missing key means always visible (mandatory)" | The Delivery Notes item (`appKey: 'sales.invoicing'`) is shown |

So the frontend read "missing" as "mandatory, always visible", while the backend's route guard still demanded an entitlement. The two layers disagreed only for the one capability that is both mandatory and commercial.

A second surface had the same defect: `invoice-form.tsx` always offered "create invoice draft from delivery notes" on a new invoice. It checked neither the entitlement nor the RBAC permission (`delivery_notes.invoice`) that the target route requires.

**Proven by tests on the unfixed code:** all 10 new backend tests fail on `origin/main` (missing key), and 3 of the 5 new invoice-form tests fail without the web change. All pass with the fix.

## Fix (smallest safe change)

### Backend — `TenantApplicationService::navVisibility()` (+11 / −3)
- A built capability enters the contract when it is **non-mandatory, or mandatory with `access: commercial`**. Today the second group is only `sales.invoicing`.
- A mandatory capability's application status is always `enabled`, exactly as `statusFor()` already says. Its visibility is therefore the **existing** entitlement rule for commercial keys: visible unless the resolver returns `DENIED`. A read-only entitlement stays visible because reads are allowed.
- Unchanged:
  - mandatory operational keys (`accounting.ledger`, `crm.customers`, …) and unbuilt keys are still absent (the web reads absence as "always visible");
  - non-mandatory keys behave exactly as before;
  - the response shape (`data: {key: bool}`) is the same, with one key added.

### Web
- `web/src/lib/use-application-visible.ts` (new): reads nav-state for one key with the sidebar's own contract.
  - Only an explicit `false` hides the item. A missing key or a failed read hides nothing, because the server guards the route anyway.
  - It returns `null` while loading, so a secondary action never flickers.
  - It reuses the existing `isApplicationHidden` reader.
- `web/src/components/invoices/invoice-form.tsx`: the delivery-draft action (header action and boundary section) is shown only when **all** of these hold:
  - the form is not in edit mode;
  - nav-state reports `sales.invoicing` visible;
  - the user holds `delivery_notes.invoice`, the permission on the `invoice-draft` routes.
- `sidebar.tsx`: **unchanged.** Its Delivery Notes item already declares `appKey: 'sales.invoicing'` and `permission: 'delivery_notes.view'`; it just receives the key now.

### Docs
`CLAUDE.md` (catalog P2 section): one rule stating that a mandatory capability is absent from nav-state unless it is `ACCESS_COMMERCIAL`.

### Not adopted
| Option | Why not |
|---|---|
| Grant `sales.invoicing` to tenants or change the legacy/plan materialization | Changes entitlement rules and grants access. Forbidden by the task. |
| Make delivery-note routes operational (drop the commercial guard) | Widens access. Forbidden. |
| Hide the link in the web only (hard-code a check) | The web must not compute entitlements; nav-state is the contract. |
| Compute nav visibility through `ApplicationAccessDecision` for all keys | Larger change. It would also start applying dependency rules to the existing non-mandatory keys, which changes their behavior. Out of scope; see Remaining work. |

## Changed files

| File | Change |
|---|---|
| `app/Services/TenantApplicationService.php` | `navVisibility()` includes mandatory commercial keys; mandatory status is always `enabled` |
| `tests/Feature/SalesInvoicingNavigationParityTest.php` | New, 10 tests |
| `tests/Feature/ApplicationNavStateEntitlementTest.php` | Contract test: `sales.invoicing` is now present (`false` for an unentitled tenant); `accounting.ledger` and `hr.payroll` are still asserted absent |
| `web/src/lib/use-application-visible.ts` | New hook |
| `web/src/components/invoices/invoice-form.tsx` | Delivery-draft entry gated by nav-state + RBAC |
| `web/src/components/invoices/invoice-form.test.tsx` | 5 new tests |
| `web/src/components/layout/__tests__/delivery-notes-nav.test.ts` | New, 4 tests |
| `CLAUDE.md` | One contract line |
| `docs/reports/implementation/AWJ-BACKEND-NAV-01.md` | This report |

## Tests

### Backend: `SalesInvoicingNavigationParityTest` (10 tests)
| Test | Proves |
|---|---|
| unentitled tenant | The key is **present** and `false`, and `GET /delivery-notes` → 403 (the guard agrees) |
| invoicing surface itself | `GET /invoices` → 200 for the same unentitled tenant, so the mandatory part is never hidden |
| full entitlement | Key `true`; `GET /delivery-notes` → 200 |
| read-only entitlement | Key `true`; GET → 200; `POST /delivery-notes` → 403 (writes still refused) |
| revoked entitlement | Hidden again; GET → 403 |
| state rows never decide a mandatory key | A legacy tenant with no rows is still hidden without an entitlement. An entitled tenant with no state row is visible. Disabling a mandatory key → 422 and the key stays visible |
| cross-tenant | Entitled A: `true`/200. Bare B: `false`/403. No leak |
| roles | Owner and staff get the identical nav-state; RBAC stays a separate gate |
| contract shape | For **every** catalog key: present ⇔ built ∧ (non-mandatory ∨ commercial). `accounting.ledger`, `crm.customers`, `hr.payroll` are absent |
| **generic parity guard** | For **every** commercial key, in three uniform entitlement states (none / FULL / READ_ONLY): nav visible ⇔ `ApplicationAccessDecision(READ)` ≠ DENIED. Any future commercial capability is covered automatically |

### Web (vitest)
| File | Tests |
|---|---|
| `invoice-form.test.tsx` (5 new) | Entitled + permitted → shown. Unentitled → hidden even for the owner. Entitled without `delivery_notes.invoice` → hidden. Missing key or failed read → shown (sidebar contract). Edit mode → never shown |
| `delivery-notes-nav.test.ts` (4 new) | Sidebar entry hidden on `sales.invoicing: false` even for the owner; shown when entitled and permitted; hidden without `delivery_notes.view`; declared once with the guard's key and permission |

### Results (local)
| Run | Result |
|---|---|
| New backend class on **unfixed** `origin/main` service | **10/10 fail** (regression proof) |
| New backend class, fixed | 10/10 pass, 123 assertions |
| Related backend (`ApplicationNavState*`, `Application*Enforcement*`, `PlatformApplicationOverrideRegression`, `ApplicationAccessDecision`, `ApplicationCatalog`, `ApplicationAccessGateGuard`, `DeliveryNote*`, `TenantApplication*`) | 131 passed |
| invoice-form web tests **without** the web change | 3 of the 5 new tests fail (regression proof) |
| Web vitest: `components/layout`, `components/invoices`, `lib` | 113 files, **858 passed** |
| `npm run build` (the Web CI gate) | ✅ (123 s) |
| `tsc --noEmit` | None of its 48 errors are in this diff; all are in unrelated test files that the build does not type-check |
| Full PHP suite, pgsql, 4 workers | _see §CI_ |
| Full PHP suite, sqlite | _see §CI_ |

## Security / tenant isolation / backward compatibility
- **Entitlements and RBAC:** no rule changed; nothing is granted. Visibility can only go from `shown` to `hidden`, and only where the route already returns 403. Every route guard is unchanged.
- **Tenant isolation:** `navVisibility()` keeps the tenant from `TenantContext`; entitlements are resolved per tenant. The cross-tenant test proves there is no leak.
- **Backward compatibility:** the response shape is the same; one key is added. Every web consumer was checked:
  - the sidebar and the commerce/fuel workspace navs hide only on an explicit `false` for their own keys;
  - the sales-settings page reads only `compliance.zatca`.

  Mobile and the storefront do not read nav-state. Entitled tenants see no change.
- **Accounting:** none. No ledger, journal or money path is touched. No new financial operation, so there are no journal entries.

## Risks
- **Tenants without the entitlement lose the Delivery Notes link.** That is the fix: they already got 403. If some production tenants are expected to use delivery notes but lack the grant, that is an entitlement-assignment question for the owner (granting is out of scope). The link reappears as soon as a grant exists.
- **Web fail-open:** a failed nav-state read keeps the entry visible, the sidebar's documented behavior. The server still refuses with 403.

## Remaining work (not in scope)
- `navVisibility()` does not evaluate **dependencies**; `ApplicationAccessDecision` does. Example: a tenant entitled to `fuel_stations.avi` but not `fuel_stations.core` would see the AVI entry while its route guard denies it. This is pre-existing and does not involve `sales.invoicing` (which has no dependencies). It should be its own task, because aligning it changes behavior for non-mandatory keys.

## CI / reviews / merge
_Filled after CI and reviews._
