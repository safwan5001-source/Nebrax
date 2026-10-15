# AWJ-ERP-UI-H2 phase A — evidence tooling (not part of the product build)

Local, isolated audit environment only. Never point any of this at production or a real tenant.

## Fixture (repeatable)
1. Backend: `setup.sh`, then a **separate** SQLite file so the test DB is untouched:
   `touch database/h2-audit.sqlite && APP_ENV=local DB_CONNECTION=sqlite DB_DATABASE=$PWD/database/h2-audit.sqlite php artisan migrate` (no `--force`: a non-local env must stop at Laravel's prompt)
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
  shell endpoints learnt from a minimal page) and forbidden (staff), with screenshots and DOM readings.
- `kit_usage.py` — static adoption of the shared UI kit (`components/nebrax/*`, `DataTable`, states, confirm) per page;
  a lower bound (2 import levels).
- `routes.json` — the 232-URL manifest the baseline crawl loaded (concrete paths, fixture ids).
