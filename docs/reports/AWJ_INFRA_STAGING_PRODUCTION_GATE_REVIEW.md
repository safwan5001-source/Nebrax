# AWJ Infrastructure Safety — Staging & Production Deployment Gate (Review)

**Status: DESIGN + REPOSITORY CHANGES READY; A0–A1 EXECUTED, A2–A3 BLOCKED (§0). LIVE PRODUCTION PROTECTION IS *NOT* ENABLED.** The only live change so far is the creation of the inert `production` git branch. Nothing in Railway or GitHub settings was changed; no service was created; no AI flag was touched; no merge or deploy was performed. Production was inspected read-only (service/deployment/config metadata, variable **names** only, one deploy-log line). No secret or variable value was read, printed or stored.

## 0. Execution log — owner-approved steps A0–A3 (2026-10-17)

Owner approved the promotion-branch design in principle and authorised **A0–A3 only**. Result: **A0 done · A1 done · A2 blocked (no tool, nothing created) · A3 partially done (local dry-run only; Actions dry-run blocked)**. No Railway setting, no GitHub setting, no deploy, no migration, no staging resource was touched. PR #1556 is unmerged.

| Step | Result | Evidence |
|---|---|---|
| **A0 — AI flags** | **VERIFIED OFF (by absence) on both PHP runtime services**; no value was read or shown | Railway `get-service-config` (variable *names* only) re-run today: `nibras-api` 36 names and `awj-scheduler` 13 names — neither contains `AI_ASSISTANT_ENABLED` nor `AI_ASSISTANT_DOCUMENTS_ENABLED`; shared variables: none; repo has no `.env`/Dockerfile setting for them; code defaults are `false`. `Nebrax`, `storefront`, `awj-preview-host` are Node services that never read the flags. Residual limit unchanged: absence of the variable, not a runtime readback. |
| **A1 — `production` branch** | **CREATED**, exactly at `6258840b7fef68fbc533f78176006c0cd7b1ad9d` (= `main` HEAD = the commit all five Railway services run) | Pre-checks: all 5 services' source branch is `main`, none tracks `production`; no GitHub workflow deploys; `ci.yml` pushes only on `main`. Post-checks: `git ls-remote` → `refs/heads/main` and `refs/heads/production` both `6258840b…`; **0 workflow runs on `production`**; latest Railway `nibras-api` deployment still created 08:40:51 UTC (no new deployment). Creating it did not and cannot deploy. |
| **A2 — Environment `production` + required reviewer, branch rules** | **NOT DONE — BLOCKER (tooling)** | The only sanctioned GitHub interface in this session (MCP tools) has no environment, deployment-protection or ruleset capability, and I did not bypass it with raw API calls. Existence/configuration of the environment, reviewers and rulesets remains **UNVERIFIED**. Exact owner steps in §0.1. |
| **A3 — dry-run** | **Local dry-run PASSED; Actions dry-run BLOCKED** | See §0.2. |

### 0.1 A2 blocker and exact owner steps (public repo → all features available at no cost)

**Why it matters:** a job that names `environment: production` auto-creates an **unprotected** environment if it does not exist, and then runs with no review. Because I cannot create it, I closed this hole in code instead (below), so a missing/misconfigured environment now fails closed.

Owner steps (GitHub UI; ~3 minutes; none of them deploys anything):
1. Settings → **Environments** → *New environment* → `production`.
2. *Required reviewers*: add `safwan5001-source`. *Prevent self-review*: **off** (single owner). *Deployment branches and tags*: *Selected* → add `main`.
3. Settings → **Rules → Rulesets** → *New branch ruleset* → name `production-release-branch`, enforcement *Active*, target branch `production`, rules: **Restrict deletions** and **Block force pushes**. (Deliberately *not* "Restrict updates": that would also block the workflow's own fast-forward push.)

Optional equivalent via `gh` (not executed by me; no secrets involved):
```
gh api -X PUT repos/safwan5001-source/Nebrax/environments/production --input - <<'JSON'
{"prevent_self_review":false,"reviewers":[{"type":"User","id":225775880}],
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/safwan5001-source/Nebrax/environments/production/deployment-branch-policies -f name=main
```
Residual (unchanged): the sole admin can still push to `production` directly or use Railway UI redeploy — the gate stops mistakes and other contributors, not the owner acting deliberately.

### 0.2 A3 — what was and was not tested

| Test | Result |
|---|---|
| Dispatch *Promote to Production* from the PR branch (`dry_run=true`) | **404** — GitHub only dispatches `workflow_dispatch` workflows that exist on the default branch. The workflow cannot run before it is merged to `main`; the `verify` job additionally requires `ref == main`. |
| Verifier on **real** `main` HEAD, real `production` (equal) | `NOT RELEASABLE — production is already at this commit`; both `php artisan test` checks **PASS** on `6258840` (read from the live GitHub API) |
| Verifier, **simulated** local-only ref `production = 1f94e18` (AI-03), candidate `6258840`; **nothing pushed**, local ref restored afterwards | **RELEASABLE**, migrations carried: 0 |
| Candidate not on `main` (PR #1556 head) | `NOT RELEASABLE — not on main` (even though its checks pass) |
| Approval guard on a real run without a protected environment (run 39018270846) | `BLOCK — no recorded approval`, exit 1 (endpoint reachable; fail-closed confirmed) |
| Unit tests | `python3 -m unittest discover -s scripts/release` → **12 OK** (3 new: no approval record blocks; only `approved` for this environment counts; malformed records do not crash) |

**New code in this PR (hardening found while preparing A2):** `release_gate.py require-approval` + a `promote`-job step that reads `GET /actions/runs/{id}/approvals` and refuses to push unless a reviewer actually approved for `production`.

### 0.3 The ordering catch-22 and the safe order

The workflow lives only in PR #1556, and merging anything to `main` currently **redeploys all five production services** (no gate yet). So the Actions dry-run (A3) and approval test need either a benign redeploy or Railway cutover first. Recommended order — **repoint Railway before merging #1556**:

1. Owner completes A2 steps (§0.1) — inert.
2. Owner does **A4** (Railway: five services → branch `production`, Wait for CI on). Same SHA, so at most one redeploy of identical code; from here merges to `main` deploy nothing.
3. Verify with runbook §9 (I can run the read-only check).
4. Owner merges #1556 → zero production effect (nothing tracks `main`). 
5. Run the Actions dry-run, then the approval rehearsal (`dry_run=false` on a releasable SHA → must pause at *Review deployments* → **Reject**).

Alternative (not recommended): merge #1556 first and accept one redeploy of the same code (no migrations: workflow/scripts/docs only).

## 1. Bottom line

| Question | Answer |
|---|---|
| Does CI gate production deploys today? | **No.** All five production services track `main` with `checkSuites:false`. Verified twice (§2.3). |
| Is there a staging environment? | **No.** One Railway environment (`production`). |
| Are the AI flags on in production? | **VERIFIED OFF by absence** on both PHP runtime services (variable not defined; code default `false`). No value readback was done (§4). |
| What is ready now? | A promotion workflow + release-gate script (tested), a deployment runbook, and this design — all inert until the owner performs the Railway/GitHub steps in §7. |
| What actually protects production? | **Nothing yet.** `production` branch exists (A1 done) but no Railway service tracks it. Protection starts only after A2 (owner, GitHub UI) and A4 (owner, Railway). Until then every merge to `main` still deploys to production immediately. |
| Recommended staging cost | ≈ **$10/month** (core) · ≈ **$18/month** with ClamAV, from measured production usage (§6). Needs your approval; nothing was provisioned. |

## 2. Verified current topology (evidence)

Legend: **V** = verified in this task from a live read-only source · **D** = documented in repo/earlier report, not re-verified · **U** = unknown / could not be verified with available tools.

### 2.1 Railway (project `أَوْج AWJ`, one environment `production`)

| Service | Source | Trigger branch | Root dir | Build/run | Health check | `checkSuites` (Wait for CI) | Status |
|---|---|---|---|---|---|---|---|
| `nibras-api` (Laravel) | repo `safwan5001-source/Nebrax` | `main` | `.` | Dockerfile (build log: "load build definition from Dockerfile"); `entrypoint.sh` → `migrate --force` → Apache | `/api/health` | **false** | V |
| `Nebrax` (Next.js web) | same repo | `main` | `/web` | Railpack | none | **false** | V |
| `storefront` (Next.js) | same repo | `main` | `/storefront` | Railpack | none | **false** | V |
| `awj-preview-host` | same repo | `main` | `/preview-host` | Railpack | `/health` | **false** | V |
| `awj-scheduler` (cron `*/5 * * * *`, `php artisan schedule:run`) | same repo | `main` | `.` | Railpack, restart `NEVER` | n/a | **false** | V |
| `nibras-db` (Postgres 18 SSL image, volume 500 MB, ≈0.21 GB used) | image | — | — | — | — | — | V |
| `awj-clamav` (`clamav/clamav:1.4.6`, volume 1 GB) | image | — | — | — | — | — | V |

Other facts: `staged: null` and `pendingWork: []` (no pending Railway changes) · shared variables: none · no `railway.json/toml` in the repo, so deploy configuration lives only in the Railway UI (not versioned, drift is invisible — **D/V**) · custom domains `awjdev.xyz`, `*.awjdev.xyz` (web), `*.store.awjdev.xyz` (storefront), `preview.awjdev.xyz`.

### 2.2 GitHub

| Fact | Value | Status |
|---|---|---|
| Repository visibility | **public**; one collaborator (owner, admin) | V |
| `ci.yml` triggers | `push: main`, `pull_request: **`, `workflow_dispatch` — no path filter (check suites always exist) | V (file) |
| `CI Gate` workflow | PR-only, **informational** ("not a Required Check" in its own header) | V (file) |
| Branch protection / rulesets on `main` | last recorded `protected:false`, `rulesets=[]` (V2-1A post-merge report); **not re-verified** (no tool reads rulesets) | D / U |
| Environments, required reviewers, secrets | not readable with available tools | U |
| Deploy jobs in `.github/workflows` | none (CI only) — Railway deploys via its own GitHub App | V |

### 2.3 The deploy-before-CI race — verified from two independent sources

| Event (UTC, 2026-10-17) | Source | Time |
|---|---|---|
| PR #1554 merged → `main` push → CI run 39018270846 created | GitHub run `created_at` | 08:40:52 |
| Railway deployments created for **all five** services @ `6258840` | Railway `list-deployments` (`createdAt`) | **08:40:51.750** |
| `nibras-api`: `▶ ترحيل قاعدة البيانات…` (**`migrate --force` ran on production DB**) | Railway deploy log | 08:41:57 |
| `nibras-api` deployment `SUCCESS`, live | Railway | 08:42:02 |
| CI run finished (`success`) | GitHub `updated_at` | **08:58:05** |

Production was running the new code **and had migrated its database ~16 minutes before CI finished**. The AI-03 merge (deployment created 06:10:44.939, CI run 06:10:46) shows the same pattern. If that CI had failed, the broken commit and its migrations would already have been live. (The earlier animated-media reports describe the same behaviour, so this is systemic, not a one-off.)

### 2.4 Migrations, backups, rollback

| Item | Finding | Status |
|---|---|---|
| Migrations | `deploy/entrypoint.sh` runs `php artisan migrate --force` on **every container start** (5 retries, aborts boot on failure). A deploy = a schema change; code rollback does **not** roll the schema back. | V |
| Backups | No backup/restore procedure in the repo; whether Railway volume backups are enabled on `nibras-db` is not exposed by the tools. | **U** |
| Rollback | `canRollback:true` on current deployments (image rollback). Image retention depends on the Railway plan (72 h Hobby / 120 h Pro per docs); plan **U**. | V/U |
| Build reproducibility | `deploy/assemble.sh` runs `composer create-project laravel/laravel:^11.0` + `composer require …` with no lockfile at image-build time → two builds of the same commit can differ in dependency versions. Staging validates the *source*, not the exact production *image*. | V (file) |
| Secrets ownership | Variables exist only as Railway service variables (names seen; values never read): app key, DB, mail/Resend, R2 keys, storefront gateway secret. Repo contains no `.env`. | V |

## 3. AI activation flags — per production runtime service

Method: Railway `get-service-config` returns variable **names** only (values are not part of that response); `list-variables` (values) was deliberately **not** called. Flags are read only by the Laravel runtime (`config/ai_assistant.php`, default `false`); no `.env` or Dockerfile/`entrypoint.sh` sets them (grep: none).

| Production service | `AI_ASSISTANT_ENABLED` | `AI_ASSISTANT_DOCUMENTS_ENABLED` | Basis |
|---|---|---|---|
| `nibras-api` (API runtime) | **VERIFIED OFF** (not defined → default `false`) | **VERIFIED OFF** (not defined → default `false`) | variable name absent from the service's 36 variable names; shared variables: none |
| `awj-scheduler` (PHP runtime) | **VERIFIED OFF** (not defined) | **VERIFIED OFF** (not defined) | variable names list has 13 entries, no AI flag |
| `Nebrax` (web), `storefront`, `awj-preview-host` | n/a — Node services, never read these flags | n/a | — |

Honest limit: this proves the variables are **not set**; it is not a runtime readback of the effective value. A one-minute owner check removes the residual doubt (§7, A0): sign in as an owner/admin, open the assistant — an off platform shows the "unavailable / platform disabled" state; or `GET /api/ai-assistant/status`.

## 4. Proposed architecture

### 4.1 Production deployment gate (what truly enforces, and what does not)

Railway's native **Wait for CI** (`checkSuites`) is real and useful, but it is not sufficient alone:

| Control | Enforces CI-before-deploy? | Enforces owner approval? | Weakness |
|---|---|---|---|
| Wait for CI on `main` | Yes (skips on failure; waits up to 2 h) | **No** | A merge still deploys the moment CI is green; "skipped/neutral" workflows never block; cancelled blocks only if nothing else succeeded; **Deploy Latest Commit / redeploy / rollback in the Railway UI and `railway up` bypass it** |
| Disable auto-deploy, deploy manually | No (owner can deploy a red commit) | Yes (human click) | Relies on discipline; no check |
| GitHub check "CI Gate" (informational) | No | No | Cosmetic — Railway ignores it |
| **Promotion branch `production`** moved only by an approval-gated workflow *(proposed)* | **Yes** — `release_gate.py` verifies the exact SHA | **Yes** — GitHub Environment `production` with required reviewer | Direct push to `production` and Railway-UI bypasses remain (mitigations below) |

**Proposed (two layers):**

1. **GitHub (this PR):** `.github/workflows/promote-production.yml` — the only sanctioned way to fast-forward the `production` branch. `verify` job (read-only) checks: commit is on `main`; is a fast-forward of `production`; **both `php artisan test` checks (SQLite and PostgreSQL) succeeded on that exact SHA**; no check on the SHA is running or failed (advisory visual checks excepted); lists the migrations the release carries. `promote` job runs under `environment: production` (**owner approval**), re-verifies after approval (approval may take hours), then does a plain, non-force `git push <sha>:refs/heads/production`. `dry_run` defaults to `true` and `workflow_dispatch` is required, so merging this PR deploys nothing.
2. **Railway (owner, UI):** point the five production services at branch **`production`** and switch **Wait for CI** on. After this, merges to `main` no longer touch production; a push to `production` deploys only if the commit's check suites are green (second, independent enforcement).

Why a promotion branch and not "Wait for CI + manual click": it is the only design here where *both* conditions (green CI on the exact commit, explicit owner approval) are enforced by machinery rather than habit, with no new secret and no Railway token stored in GitHub.

**Residual bypasses (documented, not hidden):** (a) a write-access user pushing straight to `production` — the sole collaborator today is the owner; if collaborators are added, add a ruleset on `production` (restrict updates; Option B uses an environment-scoped token so only the approved job can push — requires a new secret → separate approval); (b) Railway project members using Deploy/Redeploy/Rollback in the UI or CLI tokens; (c) Railway's `GitHub App` webhook race for brand-new commits is covered by (1) because production only receives commits that already finished CI. **Not enforced by anything**: soak time in staging before promotion (recommended in the runbook; automating it needs a Railway API token in GitHub — not proposed).

### 4.2 Staging (independent, mock-only)

Create a new Railway environment **`staging`** via **Empty Environment** and add services one by one. **Do not use "Duplicate Environment"**: per Railway docs it copies variables (secrets, mail keys, R2 keys, DB references) and configuration — exactly the sharing we must avoid.

| Resource | Staging design | Isolation rule |
|---|---|---|
| Database | **new** `nibras-db-staging` (Postgres, own volume) | never reference production DB variables; new credentials |
| API | `nibras-api` @ branch `main`, Wait for CI **on**, health check `/api/health` | own `APP_KEY`; `APP_DEBUG=false` |
| Web | `Nebrax` @ `main` (root `/web`); `NEXT_PUBLIC_API_URL` → staging API domain | generated `*.up.railway.app` domains — **no change to `awjdev.xyz` DNS** |
| Scheduler | `awj-scheduler` cron `*/5 * * * *` | required for `ai:prune-records` and `documents:sweep-scans` |
| ClamAV | `awj-clamav` — **only for the documents phase** | otherwise documents stay `scan_incomplete` (fail-closed) |
| Not created | `storefront`, `awj-preview-host` | not needed for the AI pilot |
| Mail | `MAIL_MAILER=log`; **no** `RESEND_KEY` | staging must never send real e-mail |
| Storage | `DOCUMENT_STORAGE_DRIVER=local`; **no** R2 keys, all `*_R2_ENABLED=false` | no shared bucket; local disk is ephemeral (acceptable for a pilot) |
| Sessions/queues | own DB, `QUEUE_CONNECTION=sync` (image default), file cache | nothing shared with production |
| AI flags | phase A: `AI_ASSISTANT_ENABLED=true`, `AI_ASSISTANT_PROVIDER=mock`, `AI_ASSISTANT_DOCUMENTS_ENABLED=false`; phase B adds documents `=true` | staging only; **no provider key of any kind**; needs approval to set |
| Data | one synthetic SAR tenant + synthetic users; no production data copy | — |

**Documents phase caveat (new finding):** the Document Center's extraction providers are Anthropic/OpenAI/Gemini only (no mock/local provider in `app/Services/DocumentCenter`), i.e. paid and external. A reviewed document therefore cannot be produced in staging without either a paid provider (forbidden here) or a **synthetic seeding fixture** (a staging-only, `APP_ENV`-guarded seeder — a separate small PR, not proposed in this one). **Recommendation: pilot phase A (finance tools) first; phase B only after the fixture exists.**

### 4.3 Migrations and release ordering

- The promote workflow lists migrations carried by the release and **refuses** unless `acknowledge_migrations=true` (to be set only after a verified DB backup).
- Release order: merge → CI green on `main` → staging deploys the same SHA automatically (migrations run on the staging DB first) → soak/verify → promote → production boots and migrates.
- Schema changes must stay backward-compatible with the previous release (expand → deploy → contract in a later release) because a code rollback does not undo them.
- **Backup is a hard precondition** for any release with migrations; its existence is currently **U** (owner A7).

## 5. Pilot GO / NO-GO criteria (staging mock)

**GO** requires all of: gate steps A1–A4 done and a dry-run approval test passed · staging has its own DB with no production reference (checked variable *names/references*, not values) · MAIL/R2/provider variables absent · phase-A checks from the AI-05 report pass in staging (status states, consent, three finance tools vs `ReportService`, audit metadata-only, `ai:prune-records` ran, no external host in network log) · rollback rehearsed once.
**NO-GO** on any of: staging variable references production resources · any real e-mail/storage/provider egress observed · a staging merge deployed without green CI · unexplained cross-tenant data · production deployment appears during the pilot.

## 6. Expected cost (estimate, not provisioned)

Basis: Railway docs (RAM $10/GB·mo, CPU $20/vCPU·mo, volume $0.15/GB·mo, egress $0.05/GB, builds free) × measured production **7-day averages** (`get-service-metrics`).

| Staging service | Avg RAM | Avg CPU | ≈ $/month |
|---|---|---|---|
| API | 0.18 GB | 0.001 vCPU | 1.8 |
| Postgres + 0.5 GB volume | 0.12 GB | 0.001 vCPU | 1.3 |
| Web (Next.js) | 0.67 GB (peaks to 3.6 GB) | 0.002 vCPU | 6.8 |
| Scheduler (cron, seconds per run) | — | — | < 0.2 |
| **Core total** | | | **≈ 10** (plan for ≤ 15) |
| ClamAV + 1 GB volume (documents phase) | 0.78 GB | ~0 | ≈ 7.9 |
| **With ClamAV** | | | **≈ 18** (plan for ≤ 25) |

Subscription: Hobby $5 includes $5 usage; Pro $20 includes $20 usage — the workspace plan is **U**, so the incremental bill is between $0 (covered by the included credit) and the figures above. Cost lever: staging deployments can be removed between pilots (only volume ≈ $0.08–0.23/month remains). GitHub Actions: public repo, no extra cost; the gate adds ≈ 1 min per promotion.

## 7. Exact owner approvals and manual steps

Nothing below has been done. Each is a live change that needs your explicit go-ahead.

| # | Where | Action | Prerequisite / note |
|---|---|---|---|
| A0 | Railway dashboard | **DONE by names-only check (§0)** — optional owner runtime confirmation that the assistant shows as unavailable | residual: absence ≠ readback |
| A1 | Git | **DONE** — `production` = `6258840b7fef68fbc533f78176006c0cd7b1ad9d` | the workflow refuses to run without it |
| A2 | **BLOCKED for Claude → owner (§0.1)** GitHub → Settings → Environments | Create `production`: required reviewer = you; **Prevent self-review OFF** (sole owner); deployment branches = `main` only | public repo → available at no cost |
| A3 | **Local dry-run done; Actions dry-run needs the workflow on `main` (§0.3)** GitHub → Actions | Run *Promote to Production* with `dry_run=false` on a harmless SHA **once, to confirm it pauses for review**; reject it | proves approval is real before cutover |
| A4 | Railway → each of 5 services → Settings | Source branch `main` → `production`; enable **Wait for CI** | order: `awj-scheduler` last; expect at most one redeploy of the same SHA |
| A5 | GitHub → Rules | (optional hardening) ruleset on `production`: block force-push/deletion | direct-push restriction needs Option B (new secret) |
| A6 | Railway | Approve and create `staging` per §4.2 and its cost | §6 |
| A7 | Railway → `nibras-db` volume | Confirm backups are enabled; take and test-restore one before the first release carrying migrations | currently **U** |
| A8 | After A4 | Verify no auto-deploy: see runbook §9 (I can do the read-only check for you) | |

## 8. Rollout and rollback

**Rollout order:** A0 → A1 → A2 → A3 → A4 → A8 (production protected) → A6/A7 → provision staging → AI phase A pilot → decision. **Rollback of the gate itself (instant, no data risk):** in Railway set each service's source branch back to `main` (and Wait for CI off if desired) — production returns to today's behaviour; the `production` branch and workflow are harmless. **Rollback of a release:** Railway image rollback (code only) or promote a revert commit; schema is not reverted (see runbook §6).

## 9. Risk register

| ID | Risk | Severity | Mitigation / owner |
|---|---|---|---|
| R1 | Deploy-before-CI to production + auto-migrate (verified) | **High** | §4.1, steps A1–A4 · Owner |
| R2 | Migrations run at boot with no verified backup | **High** | A7 + acknowledge flag · Owner |
| R3 | Staging created by "Duplicate Environment" would copy prod secrets, DB refs, mail/R2 keys | **High if done wrong** | Use Empty Environment (§4.2) · Owner |
| R4 | Railway UI/CLI can bypass the gate (redeploy/rollback/`up`) | Medium | Limit project members; documented; no tool can remove it · Owner |
| R5 | Non-reproducible image builds (unlocked Composer) → staging ≠ prod image | Medium | Follow-up: commit a lockfile / pin versions · Engineering |
| R6 | Deploy config is not in git (no `railway.json`) → silent drift | Medium | Runbook §7 drift check; follow-up config-as-code · Engineering |
| R7 | `main` unprotected / CI Gate informational | Medium | After cutover `main` no longer deploys; still add ruleset later · Owner |
| R8 | Wait for CI semantics (skipped/neutral never block, cancelled nuance, 2 h timeout); Railway documents that the workflow must have a `push` trigger — `ci.yml` triggers on push to `main` only, so whether the toggle is offered for branch `production` is **U** (check at A4; the promote gate still enforces CI by itself) | Low | Production only receives CI-verified SHAs; gate re-checks · — |
| R9 | AI flags: absence verified, value readback not | Low | A0 · Owner |
| R10 | Documents pilot needs a synthetic seeder (no mock extraction provider) | Medium (scope) | Phase A first; seeder PR later · Engineering |
| R11 | Public repo: workflow logs are public | Low | The workflow handles no secret besides `GITHUB_TOKEN`, prints none · — |
| R12 | Single admin/collaborator (approval is self-approval) | Low | Acceptable now; add a second reviewer when the team grows · Owner |

## 10. Changed files, tests, PR

| Item | Value |
|---|---|
| Files | added: `.github/workflows/promote-production.yml` · `scripts/release/release_gate.py` · `scripts/release/test_release_gate.py` · `docs/runbooks/AWJ_DEPLOYMENT_RUNBOOK.md` · this report. Updated in the A0–A3 round: the workflow (approval-record guard step), the script (+`require-approval`), its tests, the runbook, this report. No pre-existing repository file modified. |
| Focused tests | `python3 -m unittest discover -s scripts/release` → **12 tests OK** (originally 9; +3 approval-guard) (green commit; missing/running/failed required check; failed path check blocks but advisory does not; re-run supersedes failure; foreign-app check cannot satisfy the gate; running unclassified job blocks; migration detection). |
| Live smoke | `release_gate.py verify` against the real `main` HEAD `6258840`: both `php artisan test` checks → PASS; reports "`production` branch does not exist yet" (expected before A1). |
| Existing gate impact | `python3 scripts/ci-gate/ci_gate.py validate` → **OK** (the new workflow is `workflow_dispatch`-only, so it is not a PR check and changes no required-check manifest). |
| Build / CI | CI results for the Draft PR are recorded in the PR checks (not claimed here). No application code touched; no PHP/web build impact. |
| Branch / PR | `infra/staging-production-gate-20261017` → Draft PR (see PR). **Do not merge without your decision**: merging to `main` still redeploys production until A4 is done. |
| Base SHA | `6258840b7fef68fbc533f78176006c0cd7b1ad9d` |
| Head SHA | recorded in the PR (report-only follow-ups may change it) |
| PR #1555 | untouched |
| Task brief | `AWJ_INFRA_STAGING_PRODUCTION_GATE_CLAUDE_CODE_TASK.md` applied in full (an earlier message of the same request arrived without the attachment; no work was lost). |

## 11. Design/PR-ready vs live protection

| Layer | State |
|---|---|
| Promotion workflow, gate script, tests, runbook, this design | **READY (Draft PR, unmerged)** |
| `production` branch, GitHub Environment + reviewer, Railway repointing + Wait for CI | **NOT DONE — requires owner A1–A4** |
| Staging environment | **NOT CREATED — requires owner A6 and cost approval** |
| Production protected against deploy-before-CI | **NO (today)** |

## 12. Next smallest action

Owner: do **A2** in the GitHub UI (§0.1: environment `production` with you as required reviewer, deployment branch `main`, and the delete/force-push ruleset on `production`) — inert, no production effect. Then tell me; the next step is the Railway cutover **A4** (separate approval), followed by merging #1556 and the Actions dry-run + approval rehearsal (§0.3).
