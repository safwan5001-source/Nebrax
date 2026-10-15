# INT-UX-6 / PR-6a — Implementation Report

STATUS: **Draft PR open for review.** Not merged. Not deployed.
DATE: 2026-10-15
TASK: INT-UX-6 / PR-6a — register the independent audit permission `delivery_connector.audit.view` (**inert foundation only**).
HORIZON: Integrations Center — INT-UX-6 (PR-6a → PR-6b0 → PR-6b → PR-6c → PR-6d → PR-6e).
CONTRACT: `INT-UX-6-CONTRACT-AND-SECURITY-GATE.md` §3.1, §3.4, §8 (merged in #1483, merge SHA `ee36573f46e11bc4568f943f989d68ffcd3f5c90`); DP-E record in `DLV-INTEGRATIONS-UX-DESIGN-1.md`; decisions D1–D9 Approved.
NOT STARTED: PR-6b0 (operator-event context snapshot), PR-6b (audit reader API), the screen, INT-ACT-1, INT-MAP-1.

## 1. What was implemented

Two production lines and nothing else:

1. **`App\Support\Rbac::PERMISSIONS`** — `delivery_connector.audit.view` added **once**, directly after `delivery_connector.view`, `.manage`, `.reassign`, with a comment stating it is read-only, independent of the siblings, owner/admin via `*` only, never in `MATRIX`, never seeded or backfilled, and **inert** (no route or reader uses it yet).
2. **`web/src/modules/roles/risk.ts`** — the key classified **`data`** (D6), so the role editor flags granting it as sensitive.

Deliberately **not** touched: `Rbac::MATRIX`, `Rbac::allows`, `Rbac::covers`, `roles` rows, any migration/seeder/backfill, routes, controllers, resources, audit models/services, tenant/branch isolation, `sales.pos` gating, INT-UX-4/5 screens, role-editor structure, messages (no translation was needed: the editor derives *Delivery connectors › Audit › View* from `perm_modules.delivery_connector`, `perm_areas.audit`, `perm_actions.view`, which already exist in both locales).

## 2. Changed files

| File | Change |
|---|---|
| `app/Support/Rbac.php` | +5 lines: the key and its comment in `PERMISSIONS` |
| `web/src/modules/roles/risk.ts` | +2 lines: `'delivery_connector.audit.view': 'data'` |
| `tests/Feature/DeliveryConnectorAuditPermissionTest.php` | **new** — 13 backend tests (real RBAC + HTTP + DB, no mocks) |
| `web/src/modules/roles/delivery-connector-audit-permission.test.ts` | **new** — 6 tests: risk class, registry drift/duplicate, real AR/EN labels, grouping |
| `web/src/components/roles/role-editor-audit-permission.test.tsx` | **new** — 6 tests (EN + AR): the real role editor with real product messages |
| `docs/plans/pos/INT-UX-6A-IMPLEMENTATION-REPORT.md` | this report |

No migration, seeder, route, API, model, service, message-file or data change.

## 3. Permission matrix — before / after

Registry: **134 → 135** keys; the only difference is the new key (verified by diffing the `PERMISSIONS` block against `origin/main`).

| Holder | `delivery_connector.view` | `.manage` | `.reassign` | **`.audit.view`** before | **`.audit.view`** after | Why |
|---|:-:|:-:|:-:|:-:|:-:|---|
| owner | ✔ (`*`) | ✔ | ✔ | n/a (key did not exist) | **✔ via `*`** | existing wildcard; stored role is `['*']` |
| admin | ✔ (`*`) | ✔ | ✔ | n/a | **✔ via `*`** | same |
| accountant | ✘ | ✘ | ✘ | n/a | **✘** | not in `MATRIX` and not in the stored role |
| staff | ✘ | ✘ | ✘ | n/a | **✘** | same |
| self_service | ✘ | ✘ | ✘ | n/a | **✘** | same |
| custom role created **before** this PR (any permission set, including a role holding every other registry key) | per its list | per its list | per its list | n/a | **✘** | stored explicit lists are the source of truth; nothing writes the new key into them |
| custom role holding view + manage + reassign | ✔ | ✔ | ✔ | n/a | **✘** | no inheritance from the siblings |
| custom role holding **only** `audit.view` | ✘ | ✘ | ✘ | n/a | **✔** | no inheritance to the siblings; every existing connector endpoint still 403 |

## 4. Results

### 4.1 Backend (real Laravel app built by `setup.sh`; same code CI builds)

| Run | Result |
|---|---|
| New test file, SQLite | **13 / 13 passed** (147 assertions) |
| Related RBAC / roles / delivery-connector set — `DeliveryConnectorAuditPermissionTest`, `RoleTest`, `RoleGrantBoundaryTest`, `ApiRbacTest`, `DeliveryConnectorCoreTest`, `DeliveryConnectorLifecycleAuditTest`, `DeliveryHubProjectionTest`, `DeliveryFinancialRoleGateTest`, `AccountingSettingsRbacTest`, `ApplicationAccessGateGuardTest`, `BranchIsolationGuardTest` — **SQLite** | **120 passed** (1729 assertions) |
| Same set — **PostgreSQL 16** (local server, CI credentials) | **120 passed** (1731 assertions) |
| Full `php artisan test` — SQLite (local) | **7065 passed, 132 skipped, 26 failed.** All 26 failures are `Call to undefined function App\Services\bcmul()` in the `Fuel*` tests: the **bcmath PHP extension is not installed in this sandbox** (the session-start script warns about exactly this; CI installs it). No failure touches RBAC, roles, delivery connectors or anything in this diff. (A first full run, before the local Laravel copy was fully re-synced from the repository, showed 238 failures — missing Commerce/Communications classes plus the same bcmath cause; it is superseded by this run.) |
| **CI — full suite, SQLite and PostgreSQL, CI Gate, web build** (authoritative, with bcmath) | on code/report head `577d0ce276947c0b52907ee5dcbd739a3cfbabfd`: `php artisan test (L11, sqlite)` ✅ · `php artisan test (L11, pgsql)` ✅ · `CI Gate` ✅ · `web build (Next.js)` ✅. The final head (this report's last commit) is recorded in the PR description after its own CI read. |

**What the backend tests prove** (no mocks; each goes through `Rbac`, the role HTTP API and real DB rows):
registered **exactly once**, adjacent to its siblings, no duplicate in the registry; owner/admin allowed via `*`; accountant/staff/self_service denied in `MATRIX` **and** in stored roles; **no migration or seeder mentions the key** (a source scan guards "no backfill"); a "legacy" custom role holding every *other* key still lacks it, even after being edited; view+manage+reassign do **not** imply it, and it does **not** imply them; a role with only the audit key gets **403** on list/show/create/rotate/disable/reassign and on `/users` while the owner gets 200 on the same list (so the 403 is the permission, not missing data); **no route references the key and no audit-read route exists**; `/api/roles` meta lists it once and role create/update accept it under the current rules while near-miss keys (`…audit.manage`, `…audit`, wrong case, bare `audit.view`) and `*` still return 422; the **grant ceiling** blocks an actor without the key from granting it (create, edit own role, edit another role), and an actor who holds it can grant **only** it, not `view`/`manage`/`reassign`; `Rbac::covers` is directional and exact.

**Mutation checks** (each made tests fail, then reverted): key removed from the registry (6 tests failed); key added to `MATRIX['accountant']` (1); `Rbac::allows` made to grant `audit.view` to `delivery_connector.view` holders (3). On the frontend: removing the risk entry (3 tests failed across 2 files).

### 4.2 Frontend

| Check | Result |
|---|---|
| New/related role tests (`modules/roles`, `components/roles`) | 6 files / **70 tests** ✅ |
| **Full Vitest** | **629 files / 7167 tests** ✅ |
| `tsc --noEmit` (files under `modules/roles`, `components/roles`) | no errors |
| `npm run build` | ✅ compiled successfully |

**What the frontend tests prove:** the key is classified `data` while the three siblings stay unclassified; the web risk map and the server registry agree (existing drift guard + a one-copy, adjacency check); with the **real** AR/EN product messages the module reads *Delivery connectors* / *موصّلات التوصيل* and the permission reads **"Audit — View" / "التدقيق — عرض"**, distinct from the plain *View* / *عرض* (no two labels collide inside the module); in the **real role editor** (both locales) the key is listed unchecked, ticking it selects only itself (no inheritance), is counted as a sensitive *"Exposes or exports sensitive data"* grant, and is sent verbatim (`["delivery_connector.audit.view"]`); a role stored with the three siblings shows the audit box **unchecked**. Observation (no change made): the editor sorts equal actions by key, so *Audit — View* is listed above the plain *View* inside the module; the labels remain unambiguous.

## 5. Risks and compatibility with existing roles

- **No implicit grant.** The only holders are `*` roles (owner/admin). The key is not in `MATRIX`; no stored role is touched; no migration/seeder/backfill exists (guarded by a test). Granting it to a custom role is a deliberate role-editor action under the unchanged grant ceiling.
- **Inert.** No route, middleware, controller, resource or UI reads the key, so holding it changes nothing today; a test asserts no route references it. Real access arrives only with PR-6b.
- **A role can now contain a key that does nothing.** An admin could tick *Audit — View* in a custom role before PR-6b ships; it has no effect until then. Accepted by the approved sequencing (PR-6a before PR-6b).
- **`*` holders cannot be excluded** (no deny rules): owner/admin will be able to read the audit once PR-6b exists, including of their own actions (already recorded as G6 in the contract).
- **Wide stored roles.** Any role that stores the explicit list of *all* registry keys (not `*`) does **not** get the new key; this is the intended "no implicit grant" behaviour and is covered by a test.
- **Role-editor catalog** now has one more entry in *Delivery connectors*; no structural change.
- **Local environment note.** The local Laravel app copy was refreshed from this branch before testing (setup copies files at session start). PostgreSQL was started from the installed 16 server using the CI database/credentials.

## 6. Not done (by design)

PR-6b0 (context snapshot columns + writer), PR-6b (reader route/controller/resource/indexes), PR-6c/6d (UI data layer, screen, navigation, role-editor risk surfacing beyond the flag), PR-6e (docs re-sync), INT-ACT-1, INT-MAP-1, any migration, seeder or backfill, any change to tenant/branch isolation, `sales.pos` gating or INT-UX-4/5 screens.

## 7. Git state

Branch `feat/int-ux-6a-audit-permission` · Base SHA `ee36573f46e11bc4568f943f989d68ffcd3f5c90` (`origin/main` at start, contains the gate merge) · Draft PR and final Head SHA: recorded in the PR description (a report cannot name its own commit).

## 8. Next step

Owner review of this Draft PR. After approval, **PR-6b0** (additive operator-event context snapshot: `branch_id`, `platform_key`, `external_store_id`, `branch_context_recorded`, written inside the reassignment transaction; no backfill, no FK change) as a separate assignment. No merge, no deploy.
