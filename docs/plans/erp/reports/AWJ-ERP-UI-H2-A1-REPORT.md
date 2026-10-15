# AWJ-ERP-UI-H2 · A1 — Route inventory and baseline (report)

STATUS: evidence only (no product code) · DATE: 2026-10-15
Plan: [AWJ-ERP-UI-H2-START-PLAN.md](../AWJ-ERP-UI-H2-START-PLAN.md) (merged #1513 → `ce57324`) · Base for evidence: `main` @ `8b2b424` (`web/` identical to `ce57324`; the backend differs by #1514 (comms schema) and #1515 (FC-4), neither on an audited UI path)

## 1. What A1 produced

| Artifact | Content |
|---|---|
| [`h2-a-evidence/ROUTE-INVENTORY-H2.md`](../h2-a-evidence/ROUTE-INVENTORY-H2.md) | Every `web/src/app/**/page.tsx` (239) classified: module, workspace posture, v3-gate scope, H1 coverage, and its baseline crawl result |
| [`h2-a-evidence/BASELINE-CRAWL-H2.md`](../h2-a-evidence/BASELINE-CRAWL-H2.md) | Baseline matrix: 232 URLs × 6 configurations = **1,392 real-browser loads** (v3 AR 1440 / 390 / 320, v3 EN dark 1440, legacy AR 1440 / 390), axe-core 4.10.2 + measurements |
| [`h2-a-evidence/KIT-ADOPTION-H2.md`](../h2-a-evidence/KIT-ADOPTION-H2.md) | Static adoption of the shared UI kit per page (input to A2/A4) |
| [`h2-a-evidence/tools/`](../h2-a-evidence/tools/README.md) | Repeatable local fixture, inventory classifier, crawl summariser, state probe, kit scan |

Screenshots (1,392) stay outside git (size). The curated subset and the screen atlas are delivered with A2.

## 2. Environment and fixture

Production build of `web/` (`next build` + `next start`) against Laravel built by `setup.sh` on a **separate** SQLite file. `PHP_CLI_SERVER_WORKERS=6`. Chromium 1194 via playwright-core 1.62.1. Fixture per [`tools/README.md`](../h2-a-evidence/tools/README.md):

| Actor | Purpose |
|---|---|
| **Tenant A** | Audited tenant. Grandfathered (local fixture), plan enterprise, all six built commercial capabilities granted FULL through `EntitlementGrantService`, seeded through the public API (`seed.sh`) |
| **Tenant B** | Isolation canary (`ISOLATION-CANARY مستأجر ب`) |
| **Tenant C** | Empty tenant, everything enabled (empty states) |
| `staff` (unscoped) | RBAC-restricted only; sees the whole tenant by design |
| `staff` (scoped) | Restricted to the branch «فرع الخبر». API check (`GET /api/invoices`): 0 invoices visible, against 5 for the unscoped user at A1 time (3 from `seed.sh`, `INV-2026-00004/5` created through the UI before the check; raw output not kept). Re-run after the A2 workflows: **0 against 30**, all 30 in the main branch |

`nav-state` of tenant A reported every capability it lists (16) as `true`, through the normal path (`GET /api/applications/nav-state`; reproduce with the tenant-A token). The 232-URL manifest the crawl loaded is committed as [`tools/routes.json`](../h2-a-evidence/tools/routes.json).

## 3. Inventory (generated)

| | Pages |
|---|---|
| `page.tsx` files | **239** |
| In H2 scope | **228** |
| Excluded with reason | 11 (7 `platform/` → AWJ-PLATFORM-UX; 4 `dev/`/`document-qa` harnesses) |
| Not covered by H1 | 30 (mostly detail pages H1 did not load; plus `/users`, `/roles`). 8 more templates H1 covered only through concrete paths (`/reports/**/:id`, `/help/:id`, `/integrations/delivery-platforms/:id`) |
| Outside the v3 gate's route scope | 21 in scope (13 Fuel, 8 auth/self-service), audited on their current surface |
| Detail templates not loaded in A1 | 30 (no seed record). Covered in A2, whose workflows create these records through the UI |

By posture: Ledger (most modules, including the App Builder list/new/versions pages), **Floor** (POS, 13), **Studio** (`/app-builder/:id/builder` and the Store Customizer `/commerce/appearance`), Fuel = **O-14 (deferred to A2)**.

## 4. Baseline vs. H1 closure

The H1 gains **held** on every audited route (v3 and legacy):

| Metric | H1 final (`f8e7ab8`+8b) | H2 baseline (`8b2b424`) |
|---|---|---|
| Page overflow-x (incl. 320 px) | 0 | **0** |
| Heading-level skips | 0 | **0** |
| Missing messages | 0 | **0** |
| axe `aria-hidden-focus`, `heading-order`, `label`, `link-name`, `empty-table-header`, `landmark-unique` | 0 | **0** |

**New since H1 closure** (code merged after H1, routes H1 did not cover, or configurations H1 did not run: legacy AR 390 is new coverage, not a regression). These go to the A2 backlog:

| Where | What (config) | Note |
|---|---|---|
| `/pos` (Floor workspace) | no `h1`, axe `landmark-one-main`, `region`, `page-has-heading-one`, `aria-allowed-attr` on the product tile (AR 390 and 320) | Phone layout of the POS workspace |
| `/pos/report` | axe `select-name` (390/320) | Unnamed select |
| `/pos/audit` | axe `target-size` (390/320) | |
| `/suppliers/:id/ledger`, `/suppliers/:id/statement` | no `h1` (EN dark 1440) | New supplier statement pages |
| `/commerce/themes`, `/commerce/published-products` | content leaves the viewport at 320 px (`offscreen` > 0) | Not page-level overflow, so clipped content |
| `/documents/governance`, `/roles` | raw i18n keys rendered | |
| `/partners/:id` | 1 unnamed button | |
| `/fuel-stations/settings` | axe `color-contrast` (390, 320) | Outside the v3 gate |
| legacy only, AR 390 | `color-contrast` on 9 routes (reports, supplier ledger, POS cash drawer, Fuel settings) | Legacy surface; relevant for all-surfaces slices |
| legacy AR 1440 | `/warehouses/:id` has no `h1` (axe `page-has-heading-one`, a **regression** against H1 final, where that rule hit only `/icon.ico`); `/roles` axe `color-contrast` | Legacy surface |
| `/invoices/new` | axe `target-size` on the "Already paid" checkbox | **Accepted** in H1 (WCAG 2.5.8 equivalent-target exception) |

**Expected, not defects:** `/dev/*` returns 404 in a production build (excluded routes). `/verify-email` returns 422 without a token. `/me` gets 403 on `/api/me/{profile,contract,attendances,payroll-items}` for an owner with no linked employee. A2 judges how that state is *shown*.

**English mode:** after excluding the language switch («ع») and the exact fixture user and branch names in the topbar (`المالك a`, `الفرع الرئيسي`: tenant data), **10 pages** still show Arabic in EN chrome positions. They are data, not catalog strings, but several are actionable and go to A2:

| What is shown in Arabic | Pages | Classification |
|---|---|---|
| Account names | Several | Known **D-ERP-UX-01** (`name_en`, separate) |
| System role names («محاسب», «مدير», «موظف») on `/roles` | 1 | Fixed system roles shown from server data in EN |
| Product and partner names | Several | The seed product and partner **have `name_en`** yet their Arabic name is shown in EN |
| Default treasury and bank names | Several | System-created defaults stored in Arabic |

**Heuristic metric, not a finding by itself:** "targets < 24 px" counts any interactive element smaller than 24×24. It excludes inline links and checkboxes/radios (`crawl.cjs`), but not WCAG's spacing or equivalent-target exceptions (202 routes). axe `target-size`, which applies the exceptions, flags only the routes above. A2 judges the dense controls by screenshot and Floor/POS against 44 px.

## 5. Shared-kit adoption (static lower bound, 228 pages traced)

| Pattern | Pages |
|---|---|
| `PageHeader` | 56 |
| `ListToolbar` | 35 |
| `DataTable` | 52 |
| Raw `<table>` | 58 |
| `EmptyState` | 27 |
| `ErrorState` | 23 |
| `LoadingState` | 33 |
| `Pagination` | 36 |
| `ConfirmDialog` | 4 |
| `FormPage` | 8 |
| `DetailPage` | 5 |
| `MobileRecord` | 0 |
| `window.confirm` | 17 pages (19 call sites in 10 files) |
| Text < 12px | 59 |

This is the measurable core of the consistency gap H2 targets. A2 confirms it on the rendered screens.

## 6. Not verified in A1

- **Not run:** 30 dynamic detail templates (no seed record; covered by A2 workflows).
- **Not run:** Firefox and WebKit (Q1), real screen readers, physical devices.
- **Not run:** Fuel sale, receiving and reconciliation paths are not exercisable locally because PHP `bcmath` is missing; they are green in CI.
- **Not run:** Performance numbers are not reported, because the local load times are not comparable to H1's (different host load).

## 7. Safety statement

No product code, test, route, migration, API, RBAC, tenant or branch logic, CI file or accounting path was changed. All writes went to a separate local SQLite file through the public API or official services, **except** one direct local update of tenant A/C `created_at` and `plan` (fixture backdating, documented in [tools/README §4](../h2-a-evidence/tools/README.md)); `grant-entitlements.php` refuses to run outside a local env on `h2-audit.sqlite`. No deploy, no v3 enablement.

## 8. Errata

- The plan ([START-PLAN.md](../AWJ-ERP-UI-H2-START-PLAN.md) line 113) was edited in this PR: the module order there now matches the C1–C12 waves of §7. Wording only; no scope or decision changed.
