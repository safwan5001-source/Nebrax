# AWJ Deployment Runbook — production gate & staging

Companion to `docs/reports/AWJ_INFRA_STAGING_PRODUCTION_GATE_REVIEW.md` (design and evidence). **Until the §2 cutover is done, none of this protects production: every merge to `main` still deploys immediately.** Never paste variable values, tokens or keys into issues, PRs, logs or chat (this repo is public).

## 1. Model in one paragraph

`main` = integration branch (staging follows it). `production` = release branch, moved **only** by the *Promote to Production* workflow after (a) green CI on that exact commit and (b) owner approval in the GitHub Environment `production`. Railway production services deploy from `production` with *Wait for CI* on. Deploying runs `php artisan migrate --force` at boot.

## 2. One-time cutover (owner; each step is a live change)

1. **Confirm flags (A0):** `AI_ASSISTANT_ENABLED` and `AI_ASSISTANT_DOCUMENTS_ENABLED` are not set on `nibras-api` / `awj-scheduler`.
2. **Create `production`** at the commit that is deployed now (Railway → `nibras-api` → latest deployment → commit): `git push origin <deployed-sha>:refs/heads/production`. *(Done 2026-10-17 at `6258840b7fef68fbc533f78176006c0cd7b1ad9d`.)*
3. **GitHub → Settings → Environments → New → `production`:** required reviewers = owner; *Prevent self-review* off (single owner); *Deployment branches* = selected → `main`.
4. **Order matters:** the workflow only exists on `main` after PR #1556 is merged, and until step 5 (Railway repoint) every merge to `main` still deploys production. So do step 5 **before** merging the workflow. Then:
   **Dry approval test:** Actions → *Promote to Production* → Run on `main`, `dry_run=false`, `sha` = a commit that is already releasable. Confirm the `promote` job **stops at "Waiting for review"**, then **Reject**. If it did not wait, stop: the environment is misconfigured. (Even then the job fails closed at *Require a recorded owner approval* — GitHub auto-creates an unprotected environment if none exists, so never rely on the environment alone.)
5. **Railway, per service** (`nibras-api`, `Nebrax`, `storefront`, `awj-preview-host`, then `awj-scheduler`): Settings → Source → branch `production`; enable **Wait for CI** (if the toggle is missing, note it and rely on the workflow gate). A redeploy of the same SHA is expected once.
6. **Verify (§9).**

Revert of the cutover: set the five services back to branch `main`.

## 3. Staging (after owner approval of the plan and cost)

Create environment **`staging`** with **Empty Environment** (never *Duplicate Environment* — it copies production variables and secrets). Add: Postgres (new volume), `nibras-api`, `Nebrax`, `awj-scheduler` (cron `*/5 * * * *`, `php artisan schedule:run`); `awj-clamav` only for the documents phase. All app services: branch `main`, **Wait for CI on**, generated `*.up.railway.app` domains.

Required variable *names* (set fresh, staging-only values): `APP_KEY` (new), `APP_ENV`, `APP_DEBUG=false`, `DB_*` (point to the staging Postgres service only), `MAIL_MAILER=log`, `DOCUMENT_STORAGE_DRIVER=local`, `AWJ_*` base domains as needed, web `NEXT_PUBLIC_API_URL` → staging API. **Must be absent:** `RESEND_KEY`, every `R2_*`, `STOREFRONT_GATEWAY_SECRET`, any provider key. Checklist before first use: no variable references a production service or database; the API health check `/api/health` is green; a registration of a synthetic SAR tenant works.

AI mock pilot flags (staging only, after approval): phase A `AI_ASSISTANT_ENABLED=true`, `AI_ASSISTANT_PROVIDER=mock`, `AI_ASSISTANT_DOCUMENTS_ENABLED=false`; phase B adds documents `true` (needs a synthetic document fixture — not available yet). Flags are read through `config:cache` at boot: **a variable change needs a redeploy**.

## 4. Normal release

1. PR merged to `main` → CI green on `main` → staging deploys the same SHA automatically (migrations run on the staging DB).
2. Verify on staging (smoke + the feature's checks). Recommended soak ≥ one working day for anything touching accounting, auth, tenancy or migrations.
3. If the release carries migrations: **confirm a fresh DB backup** exists, then run with `acknowledge_migrations=true`.
4. Actions → *Promote to Production* → `dry_run=true` first and read the summary (`RELEASABLE`, checks, migration list); then `dry_run=false` and approve in *Review deployments*.
5. Watch Railway: build → boot (`▶ ترحيل قاعدة البيانات…`) → health check → `SUCCESS`; then smoke-test production.

## 5. CI failed

Before promotion: nothing reaches production — fix forward on `main`, wait for green, promote the new SHA. After promotion (the gate re-verifies, so this means CI was green but behaviour is wrong): go to §6. Never re-run only the failed leg and promote on a partial result: the gate requires both `php artisan test` checks on the SHA, and a cancelled/failed check blocks.

## 6. Rollback

1. **Code only, fast:** Railway → service → Deployments → previous `SUCCESS` deployment → *Rollback* (image retention is plan-dependent: 72 h Hobby / 120 h Pro; beyond that redeploy rebuilds from source and may differ — unpinned Composer deps).
2. **Via git:** revert PR on `main` → CI green → promote the revert SHA (fast-forward only).
3. The `production` branch then points to a commit that Railway no longer runs if you rolled back in the UI: **either promote a revert commit or accept the drift and record it** (§7).
4. **Schema is not rolled back.** Releases with migrations must be backward-compatible with the previous code; restoring the database from backup is a separate, owner-decided incident procedure.

## 7. Environment drift check (weekly or after any Railway change)

Compare what is *deployed* with what is *approved*: production service `latestDeployment` commit must equal the `production` branch head; staging must follow `main`; Railway source branch of each production service must be `production` and *Wait for CI* on; `staged`/`pendingWork` must be empty. Any difference without a recorded reason is an incident.

## 8. Flags

Production: both AI flags stay unset/`false`. A change is a production release decision (owner approval, redeploy, documented). To check without secrets: list variable **names** only; never list values. Staging flags: §3.

## 9. Verify production did not deploy automatically

After cutover, merge any trivial docs PR to `main`, wait 10 minutes, then confirm for each production service: **no new deployment** was created and `latestDeployment` commit is unchanged (Railway Deployments tab, or ask Claude to run the read-only `list-deployments` check). A new production deployment right after a `main` merge means a service is still tracking `main` — set its branch to `production`.
