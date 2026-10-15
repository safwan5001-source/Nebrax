# AWJ-ERP-UI-H2 phase A — evidence tooling (not part of the product build)

Local, isolated audit environment only. Never point any of this at production or a real tenant.

## Fixture (repeatable)
1. Backend: `setup.sh`, then `php artisan config:clear` (the env overrides below have no effect on a cached config), then a
   **separate** SQLite file so the test DB is untouched:
   `rm -f database/h2-audit.sqlite && touch database/h2-audit.sqlite && APP_ENV=local DB_CONNECTION=sqlite DB_DATABASE=$PWD/database/h2-audit.sqlite php artisan migrate` (no `--force`: a non-local env must stop at Laravel's prompt). The file is recreated on every run so tenants A/B/C start clean (tenant C must stay empty for the empty-state probe); it is the dedicated audit file only, never `database.sqlite`
   and `PHP_CLI_SERVER_WORKERS=6 APP_ENV=local DB_CONNECTION=sqlite DB_DATABASE=$PWD/database/h2-audit.sqlite QUEUE_CONNECTION=sync php artisan serve --host=127.0.0.1 --port=8000`.
   Every backend command below carries the same `APP_ENV=local DB_CONNECTION=sqlite DB_DATABASE=$PWD/database/h2-audit.sqlite` prefix.
2. Web: `cd web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api npm run build && npx next start -p 3001`.
3. Tenants through `POST /api/register`: **A** (audited), **B** (isolation canary: one partner named
   `ISOLATION-CANARY مستأجر ب`), **C** (empty, for empty states).
4. Tenant A and C — local fixture only: `created_at` before the enforcement cut-over, plan `enterprise`, and every built
   commercial capability granted FULL through the official `EntitlementGrantService`:
   `TENANT_ID=<id> APP_ENV=local DB_CONNECTION=sqlite DB_DATABASE=$PWD/database/h2-audit.sqlite php artisan tinker --execute="require '<repo>/docs/plans/erp/h2-a-evidence/tools/grant-entitlements.php';"`
   (absolute path: tinker runs from the Laravel root). The script refuses to run unless the env is `local`, the connection is
   `sqlite` and the file is `h2-audit.sqlite`. It is the one direct write of the fixture: it backdates `tenants.created_at` and sets
   `plan` (fixture only); the grants themselves go through `EntitlementGrantService`.
5. Seed tenant A through the public API: `../../h1-0-evidence/tools/seed.sh <token-A>`.
6. Actors in tenant A: an unscoped `staff` user (RBAC only — sees the whole tenant by design,
   `UserAccessScopeTest`), and a **branch-scoped** `staff` user created through `POST /api/users` with
   `branch_ids: [<second branch>]` after `POST /api/branches {"name":"فرع الخبر"}`. The scoped user must see none of the
   seed documents (all in the main branch). Tokens are issued locally with `$user->createToken()` because `/api/login`
   is rate-limited.

## Tools
- `h2_inventory.py` — classifies every `web/src/app/**/page.tsx` (module, posture, v3 gate scope, H1 coverage) and joins crawl results.
- `../../h1-0-evidence/tools/crawl.cjs` — H1 real-browser crawler (axe-core 4.10.2, measurements, screenshots), reused unchanged.
- `probe-states.cjs` — renders each route as empty (tenant C), loading (delayed page APIs), server error (500 on page APIs;
  shell endpoints = the intersection of what two minimal pages request, `SHELL_ROUTES=/whats-new,/help`, so neither page's own
  API is mistaken for shell) and forbidden (staff), with screenshots and DOM readings. `/whats-new` was re-probed after this fix:
  loading shows a spinner, error shows «تعذّر تحميل التحديثات» with retry.
  Pages that load a shell endpoint for their own content get it probed too, through per-route overrides in the script
  (an override key also covers its child routes, e.g. `/warehouses/new` and `/warehouses/<id>`; `nav-state` on the sales-settings hub/e-invoice, integrations, delivery platforms; `branches` on branches, branch settings,
  warehouses, inventory, users, fuel master data; extend with `PAGE_SHELL_OVERRIDES`). `/api/me` is never failed: the
  app layout ends the session on it by design. Re-probing those 10 routes changed no A2 verdict: `/branches` shows
  «لا توجد فروع» on error (already PLT-12); the sales-settings hub keeps its cards when `nav-state` fails (server still guards).
- `kit_usage.py` — static adoption of the shared UI kit (`components/nebrax/*`, `DataTable`, states, confirm) per page;
  a lower bound (2 import levels).
- `routes.template.json` + `make_routes.py` — the 235-URL manifest the baseline crawl loaded, with record ids as placeholders
  (`{C1}`, `{I1}`, `{JE1}`, `{MAIN_BRANCH}`…). Every fresh fixture has new UUIDs, so build the list for the current run first:
  `python3 make_routes.py routes.template.json routes.json @seed-output.txt MAIN_BRANCH=<id> MAIN_WAREHOUSE=<id> JE1=<id>`.
  It refuses to write while any placeholder is unresolved. Filled with this run's ids it reproduces the manifest the baseline loaded exactly (232 URLs in the first pass, plus `/journal-entries/:id`, `/help/create-sales-invoice` and `/integrations/delivery-platforms/jahez` added after review, the last two with H1's own concrete paths).
