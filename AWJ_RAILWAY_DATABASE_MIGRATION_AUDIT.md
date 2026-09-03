# AWJ Railway Database Migration Audit

**Phase:** 1 — Audit and preparation only  
**Date:** 2026-09-03  
**Status:** STOP. No dump import, database reset, deployment, merge, or infrastructure cutover until Safwan approves.  
**Classification:** Experimental product; accounting/business data still treated as valuable.

This document is a repository-and-ops audit. It does **not** execute a database migration.

---

## 1. Executive Summary

Railway currently hosts a working Next.js frontend (`https://awj.up.railway.app`) and a working Laravel API (`https://nibras-api-production.up.railway.app`). `/api/health` succeeds, Laravel migrations have run, and the **frontend demo login** works. Existing real-user login returns invalid credentials.

That combination is **exactly what this codebase predicts** if Railway PostgreSQL is a fresh schema (plus any post-deploy registration) and does **not** contain the old Render tenant/user rows:

- Demo login never hits the API or PostgreSQL. It is a `localStorage` preview (`demo@nibras.test`).
- Production entrypoint runs `php artisan migrate --force` only. It does **not** seed users.
- There is no Laravel `DatabaseSeeder` and no `php artisan db:seed` path.
- `/api/health` returns a static `{"status":"ok"}` and does **not** query the database.
- Real login looks up `users.email` globally and checks the bcrypt hash. Missing row or different hash → `بيانات الدخول غير صحيحة.`

**Safest migration strategy:** recover the Render database, take a full logical `pg_dump`, restore it into a **new empty** PostgreSQL (not the live Railway database that already has migrations/catalog rows), then run `php artisan migrate --force` for **pending** migrations only. Keep the current Railway database as rollback.

**Do not** import the Render dump into the current Railway database. Unique keys (`users.email`, `tenants.slug`, `tenants.account_number`, `tenant_reference_number_sequences.id`, `commercial_products.code`, invoice/ZATCA counters) will collide or silently mix two tenant graphs.

**Urgent, independent of this PR:** Render Free Postgres expired around 2026-09-01. Official policy is a **14-day grace window to upgrade to paid** before permanent deletion. Today is 2026-09-03. Safwan should recover/export Render immediately. Do not wait on review of this report.

---

## 2. Current Architecture

```mermaid
flowchart LR
  browser[Browser]
  fe[Railway Next.js awj.up.railway.app]
  api[Railway Laravel nibras-api-production]
  rdb[(Railway PostgreSQL schema plus possible new tenants)]
  renderDb[(Render nibras-db / nibras_icuj suspended or expired)]
  browser --> fe
  fe -->|"NEXT_PUBLIC_API_URL .../api"| api
  api --> rdb
  renderDb -.->|not connected suspected source of real data| api
```

| Layer | Confirmed / documented state |
|---|---|
| Frontend | Next.js 15 in `web/`, Railway URL `https://awj.up.railway.app` |
| API | Laravel 11 kernel assembled in Docker, Railway URL `https://nibras-api-production.up.railway.app` |
| Frontend API base | `NEXT_PUBLIC_API_URL=https://nibras-api-production.up.railway.app/api` |
| Railway env name | `production` — **not** permission for destructive ops; AWJ is still experimental |
| Previous DB | Render Postgres service `nibras-db`, database `nibras_icuj`, free plan, Frankfurt, expired ~2026-09-01 |
| Current DB | Railway PostgreSQL; Laravel migrations reported successful; real Render users not present (inferred from login) |

This repository is a **Laravel kernel**, not a full Laravel app. Production image flow:

1. [`Dockerfile`](Dockerfile) copies the kernel to `/core`.
2. [`deploy/assemble.sh`](deploy/assemble.sh) runs `composer create-project laravel/laravel:^11.0`, copies kernel files, installs production Composer deps.
3. [`deploy/entrypoint.sh`](deploy/entrypoint.sh) caches config/routes, runs `php artisan migrate --force` (5 attempts), then `php artisan serve`.

The only infrastructure-as-code file for hosting is [`render.yaml`](render.yaml) (Render Blueprint). There is **no** `railway.toml`, `nixpacks.toml`, or Railway-specific env file in the repo.

---

## 3. Repository Findings

### 3.1 Expected PostgreSQL environment variables

Kernel defaults and Render Blueprint agree. Laravel 11’s assembled `config/database.php` (from `laravel/laravel`, not vendored in this kernel) uses:

| Variable | Role |
|---|---|
| `DB_CONNECTION` | Must be `pgsql` in production. Dockerfile sets this. [`render.yaml`](render.yaml) sets it. |
| `DB_HOST` | Postgres host |
| `DB_PORT` | Postgres port (5432 typically) |
| `DB_DATABASE` | Database name |
| `DB_USERNAME` | Role |
| `DB_PASSWORD` | Password — never commit or paste into git/chat |
| `DB_URL` | Laravel 11 URL form (`pgsql://…`). **Not** Railway’s default name `DATABASE_URL`. If Railway only injects `DATABASE_URL`, map it to `DB_URL` **or** split it into `DB_*`. Migrations already ran, so the live mapping currently works; keep it documented and unchanged during restore except when pointing at the **new** restored instance. |

Other production env the image expects:

| Variable | Role |
|---|---|
| `APP_KEY` | Required for encrypted columns (ZATCA credentials, webhook secrets, platform integration settings, POS pairing secrets, document extraction payloads). If missing, entrypoint generates a **temporary** key on each boot — that would break decryption after restore. Copy the **Render API** `APP_KEY` onto Railway before relying on restored encrypted data. Password hashes are bcrypt and do **not** depend on `APP_KEY`. |
| `FRONTEND_URL` | CORS allow-list in [`deploy/cors.php`](deploy/cors.php). Comma-separated origins. Empty → `*`. Should include `https://awj.up.railway.app`. |
| `APP_ENV` / `APP_DEBUG` | `production` / `false` |
| `PORT` | Injected by the platform; entrypoint defaults to 8000 |
| `CACHE_STORE` / `SESSION_DRIVER` / `QUEUE_CONNECTION` | Dockerfile: `file` / `file` / `sync`. No Redis, no DB `jobs` table required at runtime. |
| `DOCUMENT_DURABLE_STORAGE_*` | Currently local/ephemeral (`false` / `local` in Render Blueprint). Attachment blobs are **not** in PostgreSQL. |

CI’s PostgreSQL analog is **Postgres 16** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Dump from an older major version into the same or a newer major is the supported direction.

### 3.2 Seeders / demo accounts

- No `database/seeders/` directory.
- No `DatabaseSeeder`, no `php artisan db:seed`, no `db:seed` in Docker/entrypoint/CI production path.
- [`ChartOfAccountsSeeder`](app/Services/Accounting/ChartOfAccountsSeeder.php) is an **application service**, invoked on **register** (and in tests), not on boot.
- [`CashBankAccountService::bootstrapDefaults()`](app/Services/Accounting/CashBankAccountService.php) (cash/bank + default payment methods) also runs on register, not on boot.
- Frontend demo: [`web/src/lib/demo.ts`](web/src/lib/demo.ts) and [`web/src/app/login/page.tsx`](web/src/app/login/page.tsx) `enterDemo()` → `enableDemo()` → dashboard. No `/login` call.

### 3.3 Startup migrate vs seed

[`deploy/entrypoint.sh`](deploy/entrypoint.sh):

- Runs `php artisan migrate --force` on **every container start**.
- Retries 5 times (cold managed Postgres).
- **Exits 1** if migrate fails — container does not serve on an old schema.
- Does **not** run seeders.
- `migrate:fresh` appears only in [`setup.sh`](setup.sh) (local SQLite) and CI. **Never** in production entrypoint.

### 3.4 Unique constraints that make a merge dangerous

| Object | Constraint | Why a live-DB import breaks |
|---|---|---|
| `users.email` | Unique globally (`000027`) | Same person registering on Railway occupies the email; dump insert fails or login hits the new hash |
| `tenants.slug` | Unique | New registration vs old company slug |
| `tenants.account_number` / `support_number` | Unique | [`000114`](database/migrations/2025_01_01_000114_add_tenant_reference_numbers.php) assigns from a global counter starting at 1000000 / 1000 |
| `tenant_reference_number_sequences` | PK `id = 1` | Both DBs have exactly one counter row |
| `commercial_products.code` | Unique | Catalog rows inserted by data migrations |
| `accounts (tenant_id, code)` | Unique | Fresh COA from register vs restored COA |
| `invoices (tenant_id, zatca_icv)` | Unique | ICV chain must stay a single legal-entity sequence |
| Document numbers | `(tenant_id, branch_id, number)` for branch-scoped docs | New invoices on Railway would collide after a merge |

---

## 4. Database / Migration Findings

### 4.1 Kernel migrations

- **179** PHP files in [`database/migrations/`](database/migrations/).
- Almost all business PKs are **UUID** (`HasUuids` on [`BaseModel`](app/Models/BaseModel.php) and [`User`](app/Models/User.php) / [`Tenant`](app/Models/Tenant.php)).
- Integer sequences: `personal_access_tokens.id`, Laravel `migrations.id`. Document numbering is **`max()+1` in application code**, not PostgreSQL `SERIAL` ([`GeneratesDocumentNumbers`](app/Support/GeneratesDocumentNumbers.php)).
- Tenant display numbers live in table `tenant_reference_number_sequences` (locked row `id=1`), not a Postgres sequence.
- No migration uses `CREATE EXTENSION`, `uuid-ossp`, or `gen_random_uuid()`.
- Duplicate timestamps exist (two `000058_*`, two `000077_*`, two `000114_*`, two `000130_*`, etc.). Laravel records the **filename** in `migrations`. Restore must keep that table intact so pending files are the only ones applied later.

### 4.2 Data-writing migrations (must run at most once, against the restored dataset)

These are not empty `Schema::create` files. If Render never ran them, they must run **after** restore. If Render already ran them, they must **not** run again on a DB that already contains their `migrations` rows plus dumped data.

Examples:

- [`000114_add_tenant_reference_numbers`](database/migrations/2025_01_01_000114_add_tenant_reference_numbers.php) — backfills `account_number` / `support_number`, inserts counter row `id=1`.
- [`000075_create_roles`](database/migrations/2025_01_01_000075_create_roles.php) — inserts system roles per existing tenant.
- [`000070_create_cash_bank_accounts_and_transfers`](database/migrations/2025_01_01_000070_create_cash_bank_accounts_and_transfers.php) — backfills cash/bank entities from accounts.
- [`000053_branch_scoped_document_numbering`](database/migrations/2025_01_01_000053_branch_scoped_document_numbering.php) — expands unique indexes; **dedupes `zatca_icv`**.
- [`000058_migrate_legacy_print_designs`](database/migrations/2025_01_01_000058_migrate_legacy_print_designs.php) and [`000068_upgrade_migrated_print_template_definitions`](database/migrations/2025_01_01_000068_upgrade_migrated_print_template_definitions.php).
- Commercial catalog inserts: [`000107`](database/migrations/2025_01_01_000107_register_fuel_stations_commercial_product.php), [`000116`](database/migrations/2025_01_01_000116_register_document_center_commercial_product.php) (idempotent `where code` checks, still UUID-sensitive).
- Role permission backfills: fuel, delivery notes, document operations, self-service role (`000092`).

**Full dump restore into empty Postgres preserves Render’s `migrations` table.** Then `php artisan migrate --force` applies only files Render did not have. That is the correct forward path if Railway’s API image is newer than the last Render deploy.

### 4.3 Conflict if dumping into the current Railway DB

Railway has already run current migrations, so it already has:

- Schema at (or near) HEAD.
- `migrations` rows for those files.
- Counter row `id=1`.
- Commercial catalog rows.
- Possibly a newly registered tenant (COA, branch, warehouse, owner user).

Importing Render data on top of that is a merge, not a restore. This audit **rejects** that merge.

---

## 5. Authentication and Tenant Isolation Findings

### 5.1 Login

[`AuthController::login`](app/Http/Controllers/Api/AuthController.php):

1. `User::where('email', $data['email'])->first()` — `User` does not use `TenantScope`; lookup is global.
2. `Hash::check` against stored bcrypt.
3. Reject inactive user (403) or inactive/expired subscription via `PlanGate` (403).
4. Issue Sanctum token, 7-day TTL.

Register ([`RegisterRequest`](app/Http/Requests/RegisterRequest.php)) requires globally unique email and unique tenant slug. One transaction creates tenant, reference numbers, COA, cash/bank defaults, system roles, main branch, default warehouse, and owner.

### 5.2 Isolation

- [`SetTenant`](app/Http/Middleware/SetTenant.php) sets `TenantContext` **only** from `$request->user()->tenant_id`.
- [`AuthenticateApiClient`](app/Http/Middleware/AuthenticateApiClient.php) sets it **only** from `api_clients.tenant_id` after Sanctum token resolution. Comment in code: not from header/query/body.
- [`TenantScope`](app/Tenancy/TenantScope.php) adds `WHERE tenant_id = ?` when context is set. It is fail-open if context is missing; public tenant routes therefore sit behind [`PublicApiTenantGuard`](app/Http/Middleware/PublicApiTenantGuard.php) (fail-closed).
- [`SetBranch`](app/Http/Middleware/SetBranch.php) may read `X-Branch-Id`, but only if it is a UUID **and** `Branch::whereKey` succeeds under TenantScope **and** the user may access that branch. Demo leftover `br-1` is ignored.

There is **no `memberships` table**. Company membership is `users.tenant_id`. Branch/warehouse assignment tables are `branch_user` and `user_warehouse`. Catalog key `crm.memberships` is unrelated.

### 5.3 Why “invalid credentials” is the expected Railway symptom

| Observation | Explanation |
|---|---|
| Demo login works | Frontend-only; never queries `users` |
| Health works | Static JSON; never queries Postgres |
| Real login fails | Email not in Railway `users`, **or** same email was re-registered on Railway with a new hash/UUID/tenant |
| Passwords after a correct restore | bcrypt in `users.password`; work with any `APP_KEY` as long as the hash row is restored |

Sanctum rows in `personal_access_tokens` can be restored but are short-lived; users should log in again after cutover. API client tokens (hashed) restore with the table; plaintext keys are not in the database.

### 5.4 Application grandfathering

[`TenantApplicationService::ENFORCEMENT_CUTOVER_AT = '2026-08-21 00:00:00'`](app/Services/TenantApplicationService.php). Tenants whose `created_at` is before that instant are treated as grandfathered for unset application keys. **Restoring `tenants.created_at` is required** so optional modules do not silently go `disabled` for the old company. Re-registering a company on Railway creates a **new** tenant after the cutover and loses that grandfathering.

---

## 6. Railway Current DB Risk Assessment

This audit did **not** connect to Railway PostgreSQL (no credentials in the workspace; live query would be out of Phase 1 scope). Assessment is from code + reported runtime behaviour.

| Risk | Likelihood | Impact |
|---|---|---|
| Railway DB is schema-only (empty business tables except `migrations` / catalog backfills) | High — matches demo-works / real-login-fails | Importing Render **over** it still collides on catalog/counter uniques |
| Someone used **Register** on Railway after deploy | Medium | New tenant UUIDs, COA, owner email occupying the global unique; **must not merge** with Render tenant |
| Someone used only frontend Demo | High | No Railway tenant rows created |
| Live Railway DB already holds new posted journals/invoices | Unknown; treat as possible | Dump Railway **before** any wipe; decide retention separately; default is keep as rollback, do not merge into Render data |
| `APP_KEY` on Railway differs from Render | High if generated at first boot | Restored encrypted columns will not decrypt until the Render key is applied |
| Health check used as proof of data | N/A | Invalid proof; health does not touch SQL |
| Environment name `production` | N/A | Does not authorize drop/restore onto the live instance |

**Recommendation:** treat the current Railway database as a **throwaway schema plus possible experimental registrations**. Dump it for safety, then restore Render into a **new** empty Postgres and point the API at that instance only after verification.

---

## 7. Render Data Recovery Requirements

**Safwan must do this manually.** This agent must not connect to, upgrade, or modify Render.

Sources: [Render Free instance limits](https://render.com/docs/free), [Render Postgres recovery and backups](https://render.com/docs/postgresql-backups).

### 7.1 What the repo defined

[`render.yaml`](render.yaml):

- Service name: `nibras-db`
- Requested database name: `nibras`
- Plan: `free`
- Region: `frankfurt`

Render often suffixes the real database name. **`nibras_icuj` is consistent with that.** Connection user/password are dashboard secrets — do not copy them into git.

### 7.2 Free-plan facts that matter this week

- Free Postgres expires **30 days after creation**.
- After expiry the instance is **inaccessible** until upgraded.
- **14-day grace** to upgrade to **any paid compute plan**. After grace, Render **deletes the database and all data**.
- Free plan: **no PITR**, **no dashboard logical backups**, **no snapshots**.
- Deleting the instance also destroys any chance of recovery. **Do not delete `nibras-db`.**

Expiry ~2026-09-01 + 14 days ≈ **2026-09-15**. Today is 2026-09-03. Act now.

### 7.3 Exact manual steps for Safwan

1. Open [Render Dashboard](https://dashboard.render.com) with the account that owns `nibras-db`.
2. Open Postgres **nibras-db**. Confirm name `nibras_icuj` and status (expired / suspended / available).
3. **If expired or inaccessible:** Billing → add a payment method if needed → **upgrade this database to a paid compute plan**. Upgrading the workspace plan alone does **not** revive a Free database.
4. Wait until the instance is **Available**.
5. Info page: copy **External Database URL**. Keep it only in a password manager. Never commit it.
6. On a trusted machine with PostgreSQL client tools (same major as the server, or newer client):

```bash
# Placeholders only — do not commit real URLs.
export RENDER_EXTERNAL_URL='postgresql://USER:PASS@HOST:PORT/nibras_icuj'

# Record server version first.
psql "$RENDER_EXTERNAL_URL" -c 'SHOW server_version;'

# Custom-format dump (preferred for pg_restore). Schema public only. No owner/ACL from Render.
pg_dump \
  --dbname="$RENDER_EXTERNAL_URL" \
  -n public \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file=awj-render-nibras_icuj-$(date -u +%Y%m%dT%H%MZ).dump
```

7. Store the dump offline (encrypted disk / private object storage). Compute a checksum (`sha256sum`) and keep it with the file.
8. **Verify the dump on a local empty Postgres** (see §9.2). Inspect counts before any Railway restore.
9. If the instance is already gone or grace has ended: open a Render support ticket from the dashboard. Assume data may be unrecoverable. Do not create a new empty Free database expecting old rows.

Dashboard **Create export** / PITR exist only on **paid** plans. After a successful upgrade, those are optional extras; `pg_dump` is still the migration artifact we want.

### 7.4 What this dump will and will not contain

**Will contain (if the instance still has data):** schema, `migrations` rows, tenants, users, hashes, journals, invoices, ZATCA columns, POS, entitlements, encrypted ciphertext, timestamps, UUIDs, FKs.

**Will not contain:** files that lived on the Render **web** container disk (`DOCUMENT_STORAGE_DRIVER=local`). Invoice/purchase attachments and logos may have metadata in SQL and missing blobs. S3/R2 was never enabled in the Blueprint.

---

## 8. Recommended Migration Strategy

| Strategy | Verdict | Why |
|---|---|---|
| Full `pg_dump` / `pg_restore` into the **current** Railway DB | **Reject** | Schema already exists; unique/PK collisions; mixed tenant graphs |
| Data-only restore into current Railway schema | **Reject** | Catalog/counter collisions; missing columns if dump is older; data-backfill migrations already marked ran |
| Selective table copy | **Reject** | Double-entry FKs (`journal_lines` → entries → invoices/payments), UUID graph, ICV chain |
| Re-register the company and re-key invoices | **Reject** | New UUIDs, new ICV/PIH, lost posted journals |
| `migrate:fresh` on Railway then import | **Reject as a live step** | Drops current Railway data; if used at all, only on a **new empty** instance **before** restore, which `pg_restore` already implies |
| **Full logical dump → restore into a NEW empty PostgreSQL → `php artisan migrate --force` for pending files only** | **Accept** | Preserves UUIDs, FKs, timestamps, `migrations` history; then schema catches up to current code |

Preferred topology:

1. Dump current Railway DB (rollback artifact).
2. Provision a **second** Railway PostgreSQL (empty).
3. Restore Render dump there.
4. Run pending Laravel migrations against that instance.
5. Verify (§10).
6. Point API `DB_*` / `DB_URL` at the restored instance.
7. Keep old Railway DB untouched until rollback window ends.

If a second plugin is impossible, restore onto the current instance **only after** (a) Railway dump verified, (b) explicit Safwan approval to drop that instance’s contents, (c) freeze API writes. That is still Phase 2.

---

## 9. Exact Safe Migration Procedure

**Do not run this until Safwan approves Phase 2.** Commands use placeholders. Never paste real passwords into git, tickets, or chat.

### 9.0 Preconditions

- [ ] Render instance upgraded and `pg_dump` file in hand, checksum recorded.
- [ ] Local restore rehearsal succeeded (§9.2).
- [ ] Railway current DB dumped.
- [ ] Render `APP_KEY` copied to the API service that will use the restored DB (or already identical).
- [ ] `FRONTEND_URL` includes `https://awj.up.railway.app`.
- [ ] PostgreSQL major: restore target ≥ dump source.
- [ ] Maintenance window: no new Railway registrations you intend to keep (or export them separately — **do not merge**).

### 9.1 Dump the current Railway database (rollback)

```bash
export RAILWAY_CURRENT_URL='postgresql://USER:PASS@HOST:PORT/DBNAME'
psql "$RAILWAY_CURRENT_URL" -c 'SHOW server_version;'
pg_dump \
  --dbname="$RAILWAY_CURRENT_URL" \
  -n public \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file=awj-railway-pre-cutover-$(date -u +%Y%m%dT%H%MZ).dump
sha256sum awj-railway-pre-cutover-*.dump
```

Optional read-only inventory (no writes):

```sql
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM invoices;
SELECT COUNT(*) FROM journal_entries;
SELECT migration FROM migrations ORDER BY id DESC LIMIT 20;
```

If Railway `users.email` includes a real address that also exists on Render, that is a **collision**. Do not merge. The Render row is the source of truth for historical accounting unless Safwan explicitly prefers the Railway registration.

### 9.2 Rehearse restore locally (required)

```bash
# Empty local database — not Railway.
createdb awj_restore_rehearsal
pg_restore \
  --dbname=postgresql://localhost/awj_restore_rehearsal \
  --verbose \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  awj-render-nibras_icuj-YYYYMMDDThhmmZ.dump
```

Then inspect (read-only):

```sql
SELECT COUNT(*) AS tenants FROM tenants;
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS invoices FROM invoices;
SELECT COUNT(*) AS journal_entries FROM journal_entries;
SELECT COUNT(*) AS journal_lines FROM journal_lines;
SELECT id, next_account_number, next_support_number FROM tenant_reference_number_sequences;
SELECT migration FROM migrations ORDER BY id;
-- Sample balance identity: posted entries should have matching debit/credit sums.
SELECT journal_entry_id,
       SUM(debit) AS d,
       SUM(credit) AS c
FROM journal_lines
GROUP BY journal_entry_id
HAVING SUM(debit) <> SUM(credit);
```

The last query should return **zero rows**. Drop the rehearsal DB when done: `dropdb awj_restore_rehearsal`.

If `pg_restore` errors on existing objects, the target was not empty. Stop.

### 9.3 Provision empty Railway PostgreSQL

Create a **new** Railway Postgres plugin/instance. Do **not** run the Laravel API against it until restore finishes (entrypoint would migrate an empty schema first and recreate the collision surface). Options:

- Temporarily disconnect the API from this new instance (do not boot a web service pointed at it), **or**
- Restore first, then attach.

Confirm the new database has no user tables in `public` besides nothing (or only default Postgres objects):

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
```

### 9.4 Restore into the empty instance

```bash
export RAILWAY_EMPTY_URL='postgresql://USER:PASS@HOST:PORT/DBNAME'
pg_restore \
  --dbname="$RAILWAY_EMPTY_URL" \
  --verbose \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  awj-render-nibras_icuj-YYYYMMDDThhmmZ.dump
```

Flags **not** to use against a database that still has wanted objects: `--clean` on the live original Railway instance.

If the dump is directory format (`pg_dump --format=directory`):

```bash
pg_restore \
  --dbname="$RAILWAY_EMPTY_URL" \
  --verbose \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  --format=directory \
  path/to/dump-dir
```

### 9.5 Apply pending Laravel migrations only

Point a **one-off** Laravel process (or a stopped-then-started API after env switch) at the restored DB:

```bash
php artisan migrate:status
php artisan migrate --force
php artisan migrate:status
```

Expect: files already in dumped `migrations` = `Ran`; newer kernel files = `Pending` then `Ran`. **Do not** `migrate:fresh`. **Do not** `db:seed`.

If migrate tries to `CREATE TABLE` that already exists, the dump’s `migrations` table is incomplete relative to the schema — stop and inspect; do not `--pretend` into a fix by dropping tables.

### 9.6 Application env cutover (after §10)

1. Set API `DB_*` or `DB_URL` to the **restored** instance.
2. Confirm `APP_KEY` is the Render key.
3. Confirm `FRONTEND_URL` includes the Railway frontend origin.
4. Redeploy/restart API once so entrypoint migrate is a no-op (already at HEAD).
5. Frontend `NEXT_PUBLIC_API_URL` should already be `https://nibras-api-production.up.railway.app/api` — no change required unless the API hostname changes.

Do not delete Render `nibras-db` or the pre-cutover Railway dump until verification and a rollback window pass.

---

## 10. Verification Checklist

Perform on the restored DB / API **before** calling the cutover done. Do not log passwords, tokens, VAT numbers, or ciphertext.

### 10.1 SQL identity

- [ ] `pg_restore` exited 0.
- [ ] Tenant / user / invoice / journal_entry / journal_line counts match the local rehearsal.
- [ ] `HAVING SUM(debit) <> SUM(credit)` on `journal_lines` grouped by `journal_entry_id` is empty.
- [ ] `tenant_reference_number_sequences` has one row; `next_*` greater than any assigned tenant number.
- [ ] `SELECT COUNT(*) FROM invoices WHERE zatca_icv IS NOT NULL;` plus unique `(tenant_id, zatca_icv)` still holds.
- [ ] `migrations` last names include files present in this kernel, or only a short pending tail that `migrate --force` then applied.

### 10.2 Auth

- [ ] Known Render user email + password succeeds on `POST /api/login` (not demo button).
- [ ] Response `user.tenant_id` is the **old UUID**, not a new Railway registration.
- [ ] Demo button still works (frontend-only) and is **not** used as proof of data.
- [ ] `/api/health` still `{"status":"ok"}` (liveness only).

### 10.3 Isolation and numbering

- [ ] Authenticated invoice list shows that tenant’s documents only.
- [ ] Next invoice number continues the restored `max()+1` series (no reset to `00001` unless the dump had no invoices).
- [ ] Optional modules for a pre-2026-08-21 tenant still behave as grandfathered unless `tenant_application_states` says otherwise.

### 10.4 Encrypted columns (smoke, no secret dump)

- [ ] If `zatca_credentials` has rows: opening the ZATCA settings/API for that tenant does **not** throw decrypt errors. Do not print `credentials`.
- [ ] If no ZATCA rows, skip; Phase 2 ZATCA signing was already documented as incomplete.

### 10.5 Attachments

- [ ] `document_files` / purchase attachments: expect **broken blobs** if they lived on Render’s ephemeral disk. Record as known gap; not a reason to reject the SQL restore.

---

## 11. Rollback Plan

1. **Do not drop** the pre-cutover Railway dump or the original Railway Postgres instance until Safwan confirms the restored login and a journal spot-check.
2. To roll back API traffic: point `DB_*` / `DB_URL` back to the **pre-cutover** Railway instance (or restore `awj-railway-pre-cutover-*.dump` into a new empty instance if the old plugin was destroyed — avoid destroying it).
3. Restart the API. Entrypoint will migrate that schema forward if needed; it will not seed.
4. Render `nibras-db` (if still paid/available) remains a third copy until the Railway restored instance is trusted. Then it can be downgraded/deleted in a later approved step — **not** in Phase 1 or 2 restore day unless cost forces it, and only after two verified dumps exist.
5. Do **not** `migrate:rollback` to “undo” a bad import. Accounting tables are not designed for rollback as a data-recovery tool.

---

## 12. Risks / Blockers

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Render grace ends ~2026-09-15; data permanently deleted | **Critical** | Safwan upgrades + `pg_dump` immediately |
| R2 | Render instance already deleted | **Critical** | Support ticket; historical data may be gone |
| R3 | Import into current Railway DB | **Critical** | Forbidden; use new empty Postgres |
| R4 | `APP_KEY` mismatch | High | Copy Render API key before trusting ZATCA/webhooks |
| R5 | Railway registration with same email | High | Do not merge; Render dump wins for accounting |
| R6 | Schema older on Render than kernel HEAD | Medium | Restore dump including `migrations`, then `migrate --force` only |
| R7 | Postgres major downgrade | High | Restore only to same or newer major |
| R8 | Attachment blobs on local disk | Medium | Accept loss; SQL still authoritative for amounts |
| R9 | Entrypoint migrate on empty new DB before restore | High | Do not boot API against the empty target until restore completes |
| R10 | Treating `/api/health` or Demo as data proof | Medium | Use real login + SQL counts |
| R11 | Re-running data-backfill migrations | High | Preserve dumped `migrations` table |
| R12 | Secrets leaking into git/chat | High | Placeholders only in this document |
| R13 | Environment name `production` used as approval | Low | Ignored; AWJ is experimental; still no destructive ops without approval |

**Blockers for Phase 2:** no verified Render dump; no rehearsal restore; no Railway pre-cutover dump; no Safwan approval.

---

## 13. Files inspected

Read-only. Not modified except this report file.

- [`render.yaml`](render.yaml)
- [`Dockerfile`](Dockerfile)
- [`deploy/entrypoint.sh`](deploy/entrypoint.sh)
- [`deploy/assemble.sh`](deploy/assemble.sh)
- [`deploy/DEPLOY.md`](deploy/DEPLOY.md)
- [`deploy/cors.php`](deploy/cors.php)
- [`setup.sh`](setup.sh)
- [`HOW_TO_RUN.md`](HOW_TO_RUN.md)
- [`README.md`](README.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`web/DEPLOY.md`](web/DEPLOY.md)
- [`web/.env.production.example`](web/.env.production.example)
- [`web/.env.local.example`](web/.env.local.example)
- [`web/src/lib/demo.ts`](web/src/lib/demo.ts)
- [`web/src/lib/auth.ts`](web/src/lib/auth.ts)
- [`web/src/app/login/page.tsx`](web/src/app/login/page.tsx)
- [`app/Http/Controllers/Api/AuthController.php`](app/Http/Controllers/Api/AuthController.php)
- [`app/Http/Controllers/Api/HealthController.php`](app/Http/Controllers/Api/HealthController.php)
- [`app/Http/Controllers/Api/PublicHealthController.php`](app/Http/Controllers/Api/PublicHealthController.php)
- [`app/Http/Controllers/Api/PlatformAuthController.php`](app/Http/Controllers/Api/PlatformAuthController.php)
- [`app/Http/Requests/LoginRequest.php`](app/Http/Requests/LoginRequest.php)
- [`app/Http/Requests/RegisterRequest.php`](app/Http/Requests/RegisterRequest.php)
- [`app/Http/Middleware/SetTenant.php`](app/Http/Middleware/SetTenant.php)
- [`app/Http/Middleware/SetBranch.php`](app/Http/Middleware/SetBranch.php)
- [`app/Http/Middleware/AuthenticateApiClient.php`](app/Http/Middleware/AuthenticateApiClient.php)
- [`app/Http/Middleware/PublicApiTenantGuard.php`](app/Http/Middleware/PublicApiTenantGuard.php)
- [`app/Tenancy/TenantContext.php`](app/Tenancy/TenantContext.php)
- [`app/Tenancy/TenantScope.php`](app/Tenancy/TenantScope.php)
- [`app/Tenancy/BelongsToTenant.php`](app/Tenancy/BelongsToTenant.php)
- [`app/Models/User.php`](app/Models/User.php)
- [`app/Models/Tenant.php`](app/Models/Tenant.php)
- [`app/Models/BaseModel.php`](app/Models/BaseModel.php)
- [`app/Models/ZatcaCredential.php`](app/Models/ZatcaCredential.php)
- [`app/Models/WebhookEndpoint.php`](app/Models/WebhookEndpoint.php)
- [`app/Support/GeneratesDocumentNumbers.php`](app/Support/GeneratesDocumentNumbers.php)
- [`app/Services/TenantReferenceNumberService.php`](app/Services/TenantReferenceNumberService.php)
- [`app/Services/TenantApplicationService.php`](app/Services/TenantApplicationService.php)
- [`database/migrations/`](database/migrations/) (179 files; key files listed in §§3–5)
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Official Render docs: free instances, Postgres backups/recovery

---

## 14. Tests / checks performed and results

| Check | Result |
|---|---|
| Repository inspection of deploy, auth, tenancy, migrations, frontend demo | Completed (read-only) |
| Count of kernel migrations | 179 files |
| Search for `db:seed` / `DatabaseSeeder` / `database/seeders` | None |
| Search for Railway config / `DATABASE_URL` in repo | None |
| Search for `CREATE EXTENSION` / `uuid-ossp` | None |
| Official Render recovery policy (grace, no free backups) | Fetched 2026-09-03 |
| Live Render SQL | **Not run** (no credentials; forbidden in Phase 1) |
| Live Railway SQL | **Not run** |
| `pg_dump` / `pg_restore` | **Not run** |
| `php artisan test` | **Not run** — kernel repo has no assembled Laravel app; not required for a docs-only audit |
| `npm run build` | **Not run** — no `web/` code change |
| Deploy / merge / `migrate:fresh` | **Not run** |

---

## 15. Any files changed (prefer none)

Application code, migrations, schema, Docker, and env examples: **none**.

This phase adds only:

- `AWJ_RAILWAY_DATABASE_MIGRATION_AUDIT.md` (this file)

---

## 16. Branch

`cursor/railway-db-migration-audit-3b54`

Created from current `origin/main` (not the stale local snapshot).

---

## 17. Base SHA

`57c48ddcd1fcc2aaa6023dc9947822bf450a74c0`  
(`origin/main` at branch creation — Merge PR #619)

---

## 18. Head SHA

`266e91784fb8cdd236b80a568e825355c15d8d5f` (documentation commit on `cursor/railway-db-migration-audit-3b54`). Branch tip after the SHA stamp commit will be one commit ahead of this hash.

---

## 19. Next recommended action

**Safwan, in this order:**

1. **Today:** Render Dashboard → `nibras-db` → upgrade to paid if expired → `pg_dump` as in §7.3. Do not delete the instance.
2. Rehearse restore locally (§9.2). Confirm tenant/user/invoice/journal counts and balanced journals.
3. Dump current Railway Postgres (§9.1). Do not drop it.
4. Approve Phase 2 explicitly (import into a **new empty** Railway Postgres, then `migrate --force` pending only, then env cutover).
5. After approval, execute §9.3–§9.6 and §10. Do not merge tenant graphs. Do not `migrate:fresh`. Do not re-register the company as a substitute for restore.

This Phase 1 PR should remain documentation-only until that approval.
