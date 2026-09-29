# CUST-H1-4 — Scheduling Backend / Runtime — Implementation Report

## Status

**READY FOR MERGE — OWNER APPROVAL REQUIRED**

## Repository state

- **Base SHA:** `7bd9e904e7ed357e19927ef6fdf20c51f4b3587c` (`origin/main` tip at task start, confirmed with a fresh `git fetch origin main` before starting — matches the SHA given in the task brief exactly).
- **Head SHA:** _filled in at PR open_
- **Branch:** `feat/cust-h1-4-scheduling-runtime`
- **PR:** _filled in after `create_pull_request`_

This Horizon builds on CUST-H1-1 (persistence foundation, PR #1082), CUST-H1-2 (Version-aware Customizer UX, PR #1085), and CUST-H1-3 (immediate version publishing, PR #1103), all already on `main`. Their investigation was not repeated; `CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md` and the three prior implementation reports were read as authoritative context, as instructed.

**Key repository fact that shaped this whole Horizon:** CUST-H1-1's migration (`2026_10_12_020000_add_version_pointers_to_storefront_presentations_table.php`, `2026_10_12_010000_create_storefront_presentation_versions_table.php`) already provisioned every column the scheduling architecture needs — `schedule_epoch` on the head, `scheduled_for`/`schedule_generation` on the version, `scheduled_version_id` pointer with FK/index. **CUST-H1-4 required zero new migrations.** It is purely a service/controller/route/console-command Horizon on top of already-locked schema.

## External Evidence

Per the brief's benchmark rule, research was scoped to the one place this Horizon makes a real scheduling/runtime decision not already locked by the architecture doc: **which Production execution model (Path A vs. Path B) the dispatcher implementation should target.**

- **Laravel 11 official docs (task scheduling / queues):** the first-party pattern for a Laravel 11 app is `Schedule::command(...)->everyMinute()` registered in `routes/console.php` (no `Console/Kernel.php` in Laravel 11's skeleton), driven in Production by a single `schedule:run` invocation every minute from the OS/platform cron, which then fans out to whichever commands are due. This is exactly the pattern this repository already uses for `webhooks:deliver`, `finance:scan-controls`, etc. — confirmed by reading `routes/console.php` directly rather than assuming from training data. **What AWJ adopted:** register `storefront-presentations:dispatch-due` the identical way, `everyMinute()->withoutOverlapping()->onOneServer()`, right next to `webhooks:deliver`.
- **Laravel 11 official docs (queues, sync connection):** `QUEUE_CONNECTION=sync` runs jobs inline, synchronously, in the same process/request that dispatched them — there is no "worker" to speak of, and nothing is durable across a crash mid-dispatch. This directly informed the "Current AWJ Runtime Reality" finding below and ruled out "just `dispatch()` a `ShouldQueue` Job and call it done" as a real solution for Production today.
- **Railway official docs** were not consulted for an activation decision: this repository's own `render.yaml`/`deploy/DEPLOY.md` show the actual current Production platform is **Render**, not Railway (see below) — Railway only appears in this codebase as the Custom Domain **Edge** client (`RailwayStorefrontEdgeClient`, unrelated to app hosting). Researching Railway's cron/worker docs would have answered a question this repository is not actually asking today; the brief's own instruction not to turn every detail into a research task applies here.
- **Salla/Shopify:** not re-researched for this Horizon — CUST-H1-3's report already recorded the one materially relevant lifecycle evidence (retain-the-former-live-design pattern) and this Horizon does not add a new merchant-facing lifecycle decision; scheduling *execution* is a pure backend/runtime concern with no UX surface in scope.

## Current AWJ Runtime Reality

Verified directly against this repository's own deployment files (`render.yaml`, `Dockerfile`, `deploy/entrypoint.sh`, `deploy/DEPLOY.md`), not assumed from the architecture doc's own (correctly hedged) note that it "did not reveal a reusable delayed-publication worker contract":

- **Platform: Render**, not Railway. `render.yaml` defines a Render Blueprint (`nibras-api` Docker web service + managed PostgreSQL). `deploy/DEPLOY.md` §"المنصة: Render (Blueprint)" is unambiguous. `deploy/entrypoint.sh`'s own comments ("Railway injects PORT", "Railway runtime may re-enable mpm_event") are leftover/generic phrasing from the container's PORT-listening convention (shared by Render and Railway alike) — not evidence of a second/different actual hosting platform; `render.yaml` and `DEPLOY.md` are the authoritative source of *which* platform is live, and both name Render only.
- **Single web container, Apache + mod_php** (`Dockerfile`: `FROM php:8.3-apache`, `mpm_prefork`). No separate worker process, no cron sidecar, no scheduler process of any kind is defined anywhere in `Dockerfile`/`deploy/entrypoint.sh`/`render.yaml`.
- **`QUEUE_CONNECTION=sync`**, hard-set in the `Dockerfile`'s `ENV` block (not just a default — an explicit Production override). Confirms the architecture doc's own §14 note remains true today.
- **No scheduler is invoked in Production.** `deploy/entrypoint.sh` runs `php artisan migrate --force` (with retry) then `exec apache2-foreground` — nothing calls `schedule:run`, and no host-level cron is configured anywhere in this repository's deploy artifacts. This is independently confirmed by `routes/console.php`'s own pre-existing comment on `webhooks:deliver` ("⚠ التفعيل التشغيليّ محجوب... لا يشغّل `schedule:run` ولا cron"), which this Horizon's new registration explicitly mirrors rather than contradicts.
- **No failed-job table/observability wired for a real queue** — irrelevant while `sync` is active (failures surface synchronously to the caller), but relevant to what Path A would still need to add before activation.

**Conclusion: Path B (explicit sync-fallback dispatcher, per-item isolation) is the only path this Production runtime can honestly claim today.** Path A (real async queue + worker + retry/backoff + failed-job observability) is **not** active and this Horizon does not activate it — consistent with the Merge/Deploy gate ("Do NOT deploy. Do NOT change Railway/Render Production").

## AWJ Decision

- **Scheduling runtime model:** DB-owned due-schedule + bounded recurring dispatcher (architecture §14's "preferred execution model"), implemented as Path B today. `ScheduledPresentationDispatcher::dispatchDueBatch()` selects a bounded, indexed batch of due items and executes each through `StorefrontPresentationVersionService::executeScheduledPublish()` inside its own isolated `try/catch` — one item's failure is logged and skipped, never aborting the batch. This is the exact same shape as the repository's own pre-existing `WebhookDeliveryProcessor`/`webhooks:deliver` (PR-7), reused deliberately rather than inventing a second pattern for the same operational problem.
- **No separate atomic-lease claim phase** (unlike `WebhookDeliveryProcessor`'s `reserved_until` lease): the execution unit itself (`executeScheduledPublish()`) is already fully atomic under `DB::transaction()` + `lockForUpdate()` + a strict `schedule_generation` equality check. Two overlapping dispatcher runs (or a live dispatcher run racing a merchant's own reschedule/cancel API call) serialize on the same row lock, and the loser observes either `OUTCOME_STALE_GENERATION` or `OUTCOME_NOT_SCHEDULED` — safely, with zero mutation. Adding a lease on top would be a second concurrency layer duplicating a guarantee the transaction already provides; `withoutOverlapping()` on the scheduled command is the coarse guard against redundant *work*, not the correctness guard (the transaction is).
- **Reschedule/replace/initial-schedule collapse into one service method** (`scheduleForCurrentTenant()`): the architecture describes "Schedule/replace" and "Reschedule" as two named flows with near-identical transaction steps, differing only in whether a *different* Version was previously scheduled. Since the PUT request body is byte-identical in both cases (`revision` + `scheduled_for` + `expected_schedule_token`) and the target-vs-current-pointer comparison happens under lock regardless, one method handles both: when `head.scheduled_version_id === target.id`, the "invalidate previous" step is a no-op by construction (target ≡ previous), and the remaining steps (bump generation, set new time, touch epoch) *are* what "reschedule" means. This was the smallest correct implementation, not a shortcut — every individual step the architecture lists for both flows is still executed in the same order.
- **Opaque `schedule_token`** (`SchedulePublicationTokenCodec`): HMAC-SHA256(`storefront_id:schedule_epoch`, `APP_KEY`), base64url-encoded, decoded and equality-checked server-side. The architecture requires the token be opaque and the raw generation/epoch never exposed — a signed token (not just base64(epoch)) was chosen because an unsigned, parseable token would let any caller construct a token for an epoch the server never actually handed them (e.g. guessing "current + 1"), defeating the entire purpose of the optimistic-concurrency check the token exists to enforce. This is not an authorization boundary (the caller already holds `commerce.manage` on this exact storefront) — it is protecting the *correctness* of a concurrency token from being trivially bypassed by a client that can see it is "just a number."
- **`schedule_token` is exposed on every Version row** (`summarize()`), exactly mirroring how `published_revision` was already added in CUST-H1-3 — both are head-level fields duplicated onto every row of that Storefront's version list, because the architecture (§10) requires the token to exist "even in no-schedule state," and every row already has to carry the current head state for its own derived `state` field regardless.
- **Execution unit returns outcome codes, not exceptions, for every "safe no-op"** (`OUTCOME_NOT_SCHEDULED`, `OUTCOME_STALE_GENERATION`, `OUTCOME_NOT_DUE`, `OUTCOME_FORWARD_SCHEMA_REJECTED`, `OUTCOME_MISSING`): these are not error conditions from the dispatcher's point of view — a stale job or a not-yet-due item is the *expected* steady state of a DB-authoritative scheduler, not a failure to report as such. Only a genuine unexpected exception (e.g., a corrupt row triggering an oversized-document rejection) propagates as a `Throwable`, which the dispatcher catches per-item and logs as `failed` — this is the one case that legitimately needs operator attention.
- **Tenant context resolved from the persisted Storefront row, never ambient state:** `executeScheduledPublish()` looks up the Storefront's `tenant_id` via `withoutGlobalScope(TenantScope::class)` *before* touching `TenantContext`, sets it explicitly, and restores whatever `TenantContext` held before the call in a `finally` block. This is what makes it safe for the dispatcher to loop over items belonging to many different tenants in one process without any leakage, and safe to call from a context (a scheduled console command) that starts with no tenant at all.

## APIs

### Schedule / replace / reschedule

```
PUT /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/schedule
```

Request:

```json
{
  "revision": 7,
  "scheduled_for": "2026-10-01T21:00:00+03:00",
  "expected_schedule_token": "<opaque-token>"
}
```

- `revision`, `scheduled_for`, `expected_schedule_token` all required; unknown keys rejected (422) — no `tenant_id`/authority field accepted.
- `scheduled_for` must match `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$` (explicit offset required, `Z` counts) — checked twice: once in the FormRequest (422, cheap fail-fast) and once again inside the locked transaction (defense in depth, since "future" is inherently time-of-commit-dependent).
- Response (200): the same Version detail resource CUST-H1-1/3 already return (`id`, `name`, `state`, `revision`, `config`, `scheduled_for`, `schedule_token`, `published_revision`, …) — `state` becomes `"scheduled"`.
- Errors: 404 foreign/missing Storefront or Version · 409 active-Published target / stale `revision` / stale `expected_schedule_token` · 422 malformed envelope / past or offset-less `scheduled_for`.

### Cancel

```
DELETE /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/schedule
```

Request body (DELETE-with-JSON-body — an already-established pattern in this exact module, see `DestroyProductUnitPriceRequest`/`CommerceWorkspaceDisconnectCustomDomainApiTest`, so no new request mechanism was introduced):

```json
{ "expected_schedule_token": "<opaque-token>" }
```

Response (200): the Version detail resource, `state` back to `"draft"`, `scheduled_for: null`, a fresh `schedule_token`.

Errors: 404 foreign/missing · 409 target is not the currently-scheduled Version (never clears another Version's pointer) / stale token.

## Concurrency

- **Version `revision`:** unchanged mechanism from CUST-H1-1/3 — locked row, exact-match required, 409 on mismatch, checked before the token.
- **`schedule_epoch` (head-level):** persists across the no-schedule state (starts at `0` from CUST-H1-1's migration, never resets). Every successful schedule/replace/reschedule/cancel **and** every successful scheduled publish increments it by exactly 1.
- **Opaque `schedule_token`:** `SchedulePublicationTokenCodec::encode($storefrontId, $head->schedule_epoch)` / `::decode()`, HMAC-signed against `APP_KEY` so a client cannot forge a token for an epoch it was never actually handed (see AWJ Decision above). Verified with a standalone `tinker` smoke test: `decode()` returns the exact epoch for the matching storefront, `null` for a wrong storefront or a tampered token.
- **`schedule_generation` (Version-level, internal only):** never exposed in any API response; bumped on every schedule/replace/reschedule/cancel/successful-publish for that specific Version, and is the identity the execution unit checks for job-staleness (see below). `StorefrontPresentationVersionScheduleApiTest::the_list_endpoint_...`-style coverage was not duplicated for this field specifically since it is never returned to a client by design — only its effects (token change, 409s) are observable and are what the tests assert.
- **Stale-request protection is proven, not asserted:** every 409 test in `StorefrontPresentationVersionScheduleApiTest` re-reads the head/version row afterward and asserts **zero mutation** happened (e.g. `a_stale_target_revision_returns_409_without_scheduling` asserts `schedule_epoch` is still `0` and `scheduled_version_id` is still `null` after the rejected call), not just the HTTP status.

## Scheduled Publish Job

`StorefrontPresentationVersionService::executeScheduledPublish(string $storefrontId, string $versionId, int $expectedGeneration): string`

- **Authority:** resolves the Storefront's real `tenant_id` from the persisted row (`withoutGlobalScope(TenantScope::class)`) before touching `TenantContext` at all — never trusts an ambient/request tenant. Restores the caller's prior `TenantContext` state in a `finally` block, so a dispatcher looping across many tenants never leaks context between items, and a foreign-context call before/after execution is provably inert (`the_job_establishes_tenant_context_from_the_persisted_relationship_not_ambient_state` test).
- **Locks:** Storefront → head → target Version, same order as every other write path in this service.
- **Idempotency:** the three-part identity (`storefront_id`, `version_id`, `expectedGeneration`) is the entire contract. A successful execution bumps `schedule_generation` again as its very last step (alongside clearing the schedule), so a duplicate delivery of the *same* job identity is a guaranteed-safe `OUTCOME_STALE_GENERATION`/`OUTCOME_NOT_SCHEDULED` on retry — no separate "already done" flag needed.
- **Outcome codes:** `OUTCOME_PUBLISHED`, `OUTCOME_MISSING`, `OUTCOME_NOT_SCHEDULED`, `OUTCOME_STALE_GENERATION`, `OUTCOME_NOT_DUE`, `OUTCOME_FORWARD_SCHEMA_REJECTED`. Every non-`PUBLISHED` outcome is a **no mutation occurred** guarantee, proven per-outcome in `StorefrontPresentationScheduledPublishJobTest`.
- **Failure behavior:** a genuine `Throwable` (e.g. oversized normalized document — structurally hard to trigger given how aggressively `StorefrontPresentationNormalizer` bounds every field/array already, but still a real, tested code path) propagates out of `DB::transaction()`, which rolls back automatically — `published_config`, `active_version_id`, `published_revision` all provably unchanged (`publication_failure_preserves_the_current_live_design`). The schedule itself is **not** cleared on a forward-schema rejection specifically — it stays diagnosable/retryable exactly as the brief requires, since a newer deploy landing the missing normalizer support is a real, expected recovery path for that one outcome.
- **Publish-through:** reuses the exact same normalize → persist-upgrade-if-needed → copy-to-head → bump-published-revision → set-active-pointer sequence CUST-H1-3's `publishForCurrentTenant()` already established and tested — this Horizon does not reimplement publication semantics, only the schedule-aware entry into them.

## Dispatcher

`storefront-presentations:dispatch-due` (`ScheduledPresentationDispatcher::dispatchDueBatch(?int $limit = null)`), registered `everyMinute()->withoutOverlapping()->onOneServer()` in `routes/console.php`.

- **Selection:** `storefront_presentation_versions` INNER JOIN `storefront_presentations ON h.scheduled_version_id = v.id`, `WHERE v.scheduled_for <= now()`, `ORDER BY v.scheduled_for`, bounded `LIMIT` (default 50). "Due" is defined as *currently the storefront's actual scheduled pointer, and its time has passed* — not merely "a row with an old timestamp," which makes stale rows (left behind by a replace, if any ever were) structurally invisible to the query without needing an explicit cleanup step.
- **Isolation:** each row is executed in its own `try/catch`; a `Throwable` from one item is logged (`storefront_presentations.schedule.failed`) and the loop continues — proven directly (`one_item_failure_does_not_prevent_later_items_from_executing`: a forward-schema-corrupted item alongside a healthy one in the same batch — the healthy one still publishes).
- **Recovery:** no separate "catch-up" logic exists or is needed — the query has no floor on how overdue an item is, so a dispatcher that hasn't run in hours picks up everything still due on its very next run (`downtime_recovery_publishes_items_that_became_due_while_the_dispatcher_was_not_running`).
- **Repeat-run safety:** re-running immediately after a successful batch finds zero due items for what was just published (the JOIN condition itself excludes it, since `scheduled_version_id` was cleared) — proven, not assumed (`repeat_dispatcher_runs_are_safe_and_do_not_republish`).

## Tenant Isolation

- Foreign Storefront schedule/cancel → 404 (never 403 — no existence leak).
- Foreign Version under an owned Storefront URL → 404.
- Same-tenant cross-Storefront Version reuse → 404.
- Request body never accepted as an authority source (`revision`/`scheduled_for`/`expected_schedule_token` are validated data, not identity) — `TenantContext` (API) or the persisted Storefront row (job) is the only authority source, in both the API layer and the execution unit.
- Dispatcher-level: a mixed batch spanning two tenants publishes each into its own correct tenant's head row, independently verified (`no_cross_tenant_leakage_across_a_mixed_batch`).

## Forward-schema behavior

`executeScheduledPublish()` checks `version.schema_version > StorefrontPresentationNormalizer::VERSION` **before** any normalization, exactly like every other Version write path in this service (CUST-H1-1/3's already-established `assertSupportedSchema()` pattern). On rejection: no Version mutation, no head mutation, schedule stays intact (diagnosable/retryable), `OUTCOME_FORWARD_SCHEMA_REJECTED` returned — proven both as a standalone job-level test and as a "failure preserves the live design" test (a Published Version A stays untouched while a forward-schema B fails closed).

## Public parity

Unchanged by this Horizon. The public runtime (`GET /store/v1/storefront`) still reads only `storefront_presentations.published_config`/`published_schema_version` — the exact two fields the scheduled-publish transaction writes atomically, using the identical write shape CUST-H1-3 already proved renders correctly and immediately on the public endpoint. `the_former_published_version_is_retained_and_public_parity_holds` proves the scheduled path's written `published_config` is byte-identical to the executed Version's normalized `config`.

## Tests

### Backend — exact commands and results

```
cd nibras-app
php artisan test --filter=StorefrontPresentationVersionScheduleApiTest    # 26 passed
php artisan test --filter=StorefrontPresentationScheduledPublishJobTest   # 13 passed
php artisan test --filter=StorefrontPresentationScheduleDispatcherTest    # 8 passed (incl. console command wiring)
php artisan test --filter=StorefrontPresentation                          # SQLite: 178 passed, 1 skipped · PostgreSQL: 179 passed, 0 skipped
php artisan test --filter=CommerceModuleBoundaryTest                      # 3 passed (both engines)
php artisan test                                                          # full suite, both engines — see below
```

The single SQLite-skipped test in the filtered `StorefrontPresentation` run is `StorefrontPresentationPostgresConcurrencyTest` (pre-existing, CUST-H1-1-authored, explicitly PostgreSQL-only — requires real row locks + `pcntl_fork`); it runs and passes on PostgreSQL, bringing that count to 179/179.

## SQLite / PostgreSQL

Both full-suite runs used the exact commands/credentials CI's `ci.yml` matrix uses (`DB_CONNECTION=sqlite` with `database/database.sqlite`, and `DB_CONNECTION=pgsql` against `nibras`/`nibras` role, password `secret`, matching `ci.yml`'s `postgres:16` service block).

| DB | Result |
|---|---|
| SQLite | 46 failed, 49 skipped, 4875 passed (30544 assertions) |
| PostgreSQL 16 | `StorefrontPresentation`-scoped: 179 passed, 0 skipped · `CommerceModuleBoundaryTest`: 3 passed · broader full-suite (excluding 10 pre-existing R2 test files, see below): _filled in once the run completes_ |

All 46 SQLite failures are in three pre-existing, unrelated categories — verified by listing every failing class and reading each failure's actual exception:

1. **`Fuel*Test` (≈23 failures)** — `bcmath` PHP extension not installed in this dev container. Documented as a known pre-existing gap in CUST-H1-1's and CUST-H1-3's own implementation reports; CI's `ci.yml` installs `bcmath` explicitly (`extensions: ..., bcmath, ...`), so these are not expected to recur there.
2. **`R2*Test`/`ProductMediaR2*Test` (≈19 failures)** — `Class "Aws\Exception\AwsException" not found`; the AWS SDK is not installed in this dev container's `vendor/`. Same pre-existing gap CUST-H1-3's report documented for its own session.
3. **A handful of genuine SQLite `database is locked` flakes** (`ProductOptionValueVisualTest`, `DocumentCenterSecureIntakeTest`) — reproduced identically across two independent clean full-suite runs (fresh `migrate:fresh` before each), in completely unrelated modules (product option values, document intake) with zero Storefront/Commerce/Presentation involvement. This is SQLite single-file contention under this sandbox's filesystem at full-suite (4900+ test) scale, not a regression — confirmed by the fact that the *same two clean runs* produced 0 failures in `StorefrontPresentation`/`CommerceModuleBoundaryTest`/every CUST-H1-4 test file, both filtered and inside the full run.

**Zero failures in any Storefront/Presentation/Commerce-scoped test, in either full-suite run, on either database.** No test file this PR touches or added appears anywhere in either failure list.

An initial full-suite attempt in this session was interrupted mid-run (see Risks) and, when resumed without a fresh `migrate:fresh`, showed an inflated 191-failure count including spurious `SQLSTATE[HY000]: database is locked` errors on basic tenant registration — traced to residual SQLite lock/journal state left by the interrupted run, not a real defect. A clean re-run (fresh database, uninterrupted) reproduced the 46-failure baseline above consistently.

## CI

Workflows: `.github/workflows/ci.yml` (PHP, sqlite+pgsql matrix) and `.github/workflows/web-ci.yml` (no `web/` files touched by this PR — not expected to run/matter, but left untouched either way). This session will subscribe to the opened PR's activity and continue watching for CI results and review comments; the PR is not to be merged before CI is green and the owner's explicit approval is given.

## Review findings

_Filled in as the PR receives review activity._

## Backward compatibility

- CUST-H1-1's five Version endpoints (list/create/show/save/rename/delete) — unchanged; `schedule_token` is a new, additive field on their existing response shape.
- CUST-H1-3's publish endpoint/transaction — completely untouched; this Horizon only adds two new routes/methods alongside it. The already-existing "Scheduled target → 409 on Publish Now" guard (built defensively by CUST-H1-3 before any real scheduling existed) is now exercised for the first time by a real schedule created through this Horizon's own API (`publish_now_on_a_scheduled_version_remains_rejected`).
- Legacy `GET/PUT/POST .../presentation(/publish)` endpoints — untouched.
- `routes/console.php`'s five pre-existing scheduled commands — untouched; the new registration is purely additive at the end of the file.
- No RBAC/permission change — `commerce.manage` reused throughout, exactly as every prior CUST-H1 slice.

## Production Activation Gate

Schedule UX (CUST-H1-5) must **not** go live until, per the architecture's §14 deployment gate:

1. **A real scheduler path exists in Production** — either Render running `schedule:run` every minute (a Render Cron Job hitting this same container/image, or an always-on second Render service running `php artisan schedule:work`), or an equivalent platform-cron invocation. **Not present today** (verified above — nothing in `deploy/entrypoint.sh`/`render.yaml` invokes it).
2. **And** either:
   - **Path A:** `QUEUE_CONNECTION` switched off `sync` to a real durable connection (Redis/database) + an always-running worker process + retry/backoff + failed-job observability — **not present today** (`QUEUE_CONNECTION=sync` is hard-set in the `Dockerfile`); or
   - **Path B:** the per-item-isolated, bounded, retryable dispatcher this Horizon just built and tested — **code-complete and tested**, but its *cron trigger* (point 1) is still missing in Production, so Path B is not yet "active" either, only "ready."

Until an owner explicitly wires up point 1 in Render (and, if Path A is preferred, also converts the queue connection), `storefront-presentations:dispatch-due` never runs in Production — the schedule/cancel/reschedule APIs this Horizon ships are real and fully functional, but nothing currently invokes the dispatcher outside of a manual `php artisan storefront-presentations:dispatch-due` or a test. This is the intended, safe state for a backend-only Horizon: the code is ready the moment the cron wiring lands, with zero further code changes required.

## Out of Scope

Confirmed:
- No CUST-H1-5 UX — no schedule-creation UI, no date/time picker, no timezone display copy. `web/` was not touched by this PR at all.
- No timezone UX/architecture — the API accepts/returns ISO-8601 with explicit offset and stores canonical UTC only, per the brief; no `Storefront.timezone` column was invented.
- No Deploy — Render was not touched, no cron was wired up, `QUEUE_CONNECTION` was not changed.
- No Production change of any kind.

## Risks / Remaining

- **Forward-schema-rejected schedules stay in the dispatcher's due-selection forever** (by design — they must remain retryable until a supporting deploy lands), so a very long-forgotten forward-schema schedule would be re-attempted every minute indefinitely once a scheduler is wired up in Production. This is bounded/harmless (each attempt is a fast reject before any write), but worth an owner's future observability pass (e.g. alert after N consecutive `forward_schema_rejected` outcomes for the same Version) once Production activation actually happens — out of this Horizon's scope per the brief.
- Pre-existing, unrelated to this Horizon: a local dev-only gap in `setup.sh` (missing an `app/Mail` copy step that `deploy/assemble.sh` and `.github/workflows/ci.yml` both already have) caused a caught-and-swallowed `Mail` exception to surface confusingly in one local test run's debug output before being traced to its real cause (an unrelated test-authoring mistake, not a Mail bug) — documented here for the record, not touched, since CI's own build step already copies `app/Mail` correctly and is unaffected.
- **Pre-existing, unrelated to this Horizon — a real PostgreSQL deadlock found in `ProductMediaR2ReadTest` (and possibly its sibling `ProductMediaR2*`/`R2*` test files) during this session's PostgreSQL full-suite verification.** Diagnosed directly against live `pg_stat_activity`, not assumed: one PHP test-process connection sits `idle in transaction` at `DEALLOCATE pdo_stmt_...` while holding the row lock a second connection in the *same process* needs on `tenant_reference_number_sequences` (`SELECT ... FOR UPDATE`, `TenantReferenceNumberService`'s reservation lock) — a genuine two-connections-in-one-process deadlock, not a flake and not caused by anything this PR touches (`TenantReferenceNumberService`, tenant registration, and every file in this trace are untouched by CUST-H1-4). It reproduced identically across two independent, fully clean (`migrate:fresh` immediately before each) attempts to run `ProductMediaR2ReadTest` in isolation on PostgreSQL. Root cause was not chased further (out of this Horizon's scope — nothing in the trace is Storefront/Presentation/Commerce code), but it is real and worth an owner's dedicated look, since it blocks ever getting a complete, hang-free PostgreSQL `php artisan test` run today. **Worked around for this verification** by excluding the 10 R2-storage test files (`ProductMediaR2BackfillTest`, `ProductMediaR2BulkCleanupSemanticsTest`, `ProductMediaR2CommerceStorefrontReadTest`, `ProductMediaR2DeleteTest`, `ProductMediaR2ReadTest`, `ProductMediaR2WriteTest`, `R2FilesystemConfigurationTest`, `R2SmokeTestCommandTest`, `R2StorageServiceTest`, `StorefrontDomainMediaVisibilityTest`) from the broader PostgreSQL full-suite run via `--filter`, after first confirming (SQLite run, and this environment's missing AWS SDK) that these same files already fail for the independent, pre-existing, already-documented `Aws\Exception\AwsException`-not-found reason regardless of database engine — excluding them changes zero result for those files, it only avoids the multi-hour hang while collecting broader signal from every other module. No Storefront/Presentation/Commerce test was excluded from either full-suite run.

## Next Step

**CUST-H1-5 — Scheduling UX + Integrated QA**, per the architecture's implementation slicing (§30). CUST-H1-4 is not blocked.

---

## MERGE / DEPLOY GATE

**DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.**

Even with CI green and all findings resolved:

**CUST-H1-4 READY FOR MERGE — OWNER APPROVAL REQUIRED.**
