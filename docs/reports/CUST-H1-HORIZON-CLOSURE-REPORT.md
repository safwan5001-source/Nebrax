# CUST-H1 — Horizon Closure Report

# Status

**CLOSED**

---

## Repository State

- **Base SHA (fetched `origin/main` tip at closure-task start):** `beca19f1d6fa66c8311109370b6d174066f61160` — confirmed identical to the SHA the task brief named as "known current main after merging CUST-H1-5." Main had not advanced.
- **Head SHA:** this report's own commit, on top of the Base SHA above (docs-only change — see "Documentation Consistency").
- **Branch:** `docs/cust-h1-horizon-closure`
- **PR:** opened from this branch against `main`, per the task's PR instructions (see the end of this report). **Not merged** — closure of the Horizon is a documentation/verification act; merge/deploy remain gated on explicit owner approval, per every prior CUST-H1 slice's own gate and per this task's own merge/deploy gate.

No `git log beca19f1..HEAD` exists for `web/src/modules/store-experience-builder` or any backend Storefront-presentation path — the five CUST-H1 slice PRs (#1082, #1085, #1103, #1112, #1114) are the entirety of the code delivered for this Horizon, and `beca19f1` is PR #1114's own merge commit.

---

## Horizon Scope

CUST-H1 — **Theme Copies & Safe Publication Lifecycle** (`docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §7, `docs/plans/store/CUST-H1-THEME-VERSIONS-EVIDENCE-UX.md`).

Goal: let a merchant prepare a seasonal/campaign storefront design (Ramadan, National Day, a sale) as a named, independently editable "Design Version," without touching the live store, and publish it — immediately or on a schedule — while the previously live design remains recoverable. This Horizon owned: named Versions, create/duplicate/rename/delete, exact-Version editing, Draft/Scheduled/Published states, exact-Version preview, immediate publish, scheduled publish (schedule/reschedule/cancel), one-live-Version invariant, per-Version concurrency, tenant isolation, and backward compatibility with the pre-existing single-head presentation model. It explicitly did not own: multi-page builder (Product/Category), Store Identity Studio, Section Library expansion, Undo/Redo, custom CSS/JS, or any Production deploy/activation action.

---

## Slice Closure

### H1-1 — Version Persistence Foundation

- **Capability delivered:** `storefront_presentation_versions` table (named, independently editable, revisioned copies); `storefront_presentations` evolved with nullable pointers (`active_version_id`, `scheduled_version_id`, `compatibility_working_version_id`, `draft_schema_version`, `published_schema_version`, `schedule_epoch`) with every existing column preserved; deterministic idempotent backfill for Cases A–D (no row / Draft-only / Published==Draft / Published≠Draft); Version CRUD API (list/create+duplicate/read/save/rename/delete) under `commerce.manage`; legacy `GET/PUT/POST …/presentation[/publish]` kept byte-identical while internally routing through a durable `compatibility_working_version_id`, forking before ever mutating an active Published Version in place.
- **Merged PR:** [#1082](https://github.com/safwan5001-source/Nebrax/pull/1082) — merged.
- **Evidence:** `docs/reports/CUST-H1-1-IMPLEMENTATION-REPORT.md`; 60 new tests across 3 new files; 22 review findings across 10 rounds, all fixed and regression-tested (embedded-schema-tag priority, fail-closed-before-write, rollout/cutover self-healing). Re-verified in this closure pass: migrations, model, and backfill service match the architecture doc exactly (§"Architecture Invariants" below).

### H1-2 — Version-aware Customizer UX

- **Capability delivered:** Version selector in the toolbar (visually distinct from any page selector); Version Manager (desktop popover / mobile Bottom Sheet, one shared component); create/duplicate/rename/delete with server-derived state only; exact-Version switching and editing with a monotonic stale-callback guard; deterministic default selection (never guesses among multiple Drafts); Published read-only with "create a draft from this version"; Publish hard-gated pending H1-3; legacy load/save/publish calls fully removed from the Customizer (Version API exclusively).
- **Merged PR:** [#1085](https://github.com/safwan5001-source/Nebrax/pull/1085) — merged.
- **Evidence:** `docs/reports/CUST-H1-2-IMPLEMENTATION-REPORT.md`; 16 review rounds (all stale-async-identity races across switch/save/create/duplicate/rename/delete), all fixed and regression-tested; two real merge-conflict reconciliations with parallel `main` work (Theme Gallery handoff, AWJ Market promotion) resolved without losing either side's capability. Visual QA: 6 Playwright scenarios (desktop/tablet/mobile, AR/EN) — a real tablet-768 overflow bug found and fixed during this pass.

### H1-3 — Immediate Version Publishing

- **Capability delivered:** `POST …/versions/{version}/publish` — exact-Version + publication-head concurrency guards (`expected_published_revision`/`expected_active_version_id`), Scheduled-target rejection, forward-schema fail-closed, atomic normalize-then-publish, one-live-Version invariant, idempotent no-op republish; `PublishConfirmDialog` (first-publish vs. replace-and-retain variants, AR/EN, centered modal at every viewport); real toolbar/row Publish eligibility replacing H1-2's hard gate.
- **Merged PR:** [#1103](https://github.com/safwan5001-source/Nebrax/pull/1103) — merged.
- **Evidence:** `docs/reports/CUST-H1-3-IMPLEMENTATION-REPORT.md`; 20 new backend tests, 15+7 new frontend tests; public-parity test proves the public endpoint serves newly published content immediately, and a failed-publish test proves the public snapshot is untouched. Zero review findings at report time; one self-caught defect (mock-fixture routing) fixed pre-PR.

### H1-4 — Scheduling Backend/Runtime

- **Capability delivered:** `PUT`/`DELETE …/versions/{version}/schedule` (schedule/replace/reschedule collapse into one transaction; cancel separate); opaque HMAC-signed `schedule_token` backed by head-level `schedule_epoch`; `schedule_generation` internal per-Version job-staleness guard; `executeScheduledPublish()` (tenant context resolved from the persisted Storefront row only, never ambient state); `ScheduledPresentationDispatcher` + `storefront-presentations:dispatch-due` console command, `everyMinute()->withoutOverlapping()->onOneServer()`, registered in `routes/console.php` — dormant until Production wires a scheduler trigger (by design; see "Scheduling Runtime" below). **Zero new migrations** — H1-1's migration had already provisioned every column this slice needed.
- **Merged PR:** [#1112](https://github.com/safwan5001-source/Nebrax/pull/1112) — merged.
- **Evidence:** `docs/reports/CUST-H1-4-IMPLEMENTATION-REPORT.md`; 26+13+8 new backend tests (schedule API, scheduled-publish job, dispatcher); race tests for every ABA schedule/cancel/replace scenario the architecture's §29 test matrix requires, including the required race test (schedule A → replace with B → B publishes → deliver stale A job → A no-ops, B untouched).

### H1-5 — Scheduling UX + Integrated QA

- **Capability delivered:** Schedule/Reschedule (one shared dialog, mirroring the backend's collapsed transaction) and a separate Cancel-schedule dialog; replace-existing-schedule warning naming the displaced Version; **authoritative timezone evidence and exposure** (`tenants.timezone`, previously un-exposed to any frontend consumer, now read-only via `/api/me` → `company.timezone`); `scheduling_runtime_active` capability flag (env-gated, fails closed in every environment except `local`/`testing`) disabling Schedule/Reschedule with a persistent explanation while Cancel stays always-available; a real toolbar-overflow bug found and fixed (Schedule button made desktop-only, `lg:inline`, matching the existing `restore` button's precedent — fully available at every width via the Version Manager regardless).
- **Merged PR:** [#1114](https://github.com/safwan5001-source/Nebrax/pull/1114) — merged (`beca19f1`, current `main` tip).
- **Evidence:** `docs/reports/CUST-H1-5-IMPLEMENTATION-REPORT.md`; 13 new timezone-helper tests + 21 new scheduling-UX tests + 8 new API-client tests; 9 new Playwright scenarios (390/430/768/1024/1280/1440, AR/EN) plus 2 pre-existing specs re-verified with zero regression; integrated 15-flow lifecycle QA table, closing one real coverage gap (saving a Scheduled Version mid-schedule).

---

## Architecture Invariants

Re-verified directly against the merged code at `beca19f1` during this closure pass (not merely re-read from the reports):

| Invariant | Status | Evidence |
|---|---|---|
| Compatibility Head (0..1) + Version Rows (1:N) | **PASS** | `storefront_presentation_versions` migration + `StorefrontPresentation` nullable pointer columns, both present exactly as architected |
| One active / one scheduled-next pointer per Storefront | **PASS** | `active_version_id`/`scheduled_version_id` on the head, no per-Version status column |
| Version state derived, not merchant-writable | **PASS** | `StorefrontPresentationVersion` model doc comment: "لا عمود `status`… تُشتقّ من مؤشرات `storefront_presentations`… وقت القراءة فقط"; confirmed no `status` column in the migration |
| `compatibility_working_version_id` semantics | **PASS** | present on the head, durable, self-healing reconciliation (`ensureCompatibilityWorkingVersion`) documented and tested across 10 H1-1 review rounds |
| Active Published Version immutable via normal Save | **PASS** | `saveForCurrentTenant()` 409s (`ActiveVersionImmutableException`); re-confirmed by `StorefrontPresentationVersionApiTest` |
| `schedule_epoch` persistent lifecycle authority | **PASS** | `schedule_epoch unsignedInteger default 0` on the head, incremented on every schedule/replace/reschedule/cancel/successful scheduled-publish |
| Opaque `schedule_token` merchant contract | **PASS** | `SchedulePublicationTokenCodec`, HMAC-SHA256(`storefront_id:schedule_epoch`, `APP_KEY`), never a raw generation/epoch |
| `schedule_generation` internal-only stale-job protection | **PASS** | never returned in any API response (verified: not present in `summarize()`'s exposed field list); only its effects (token change, 409) are observable |
| Public runtime remains Published-head-only | **PASS** | `GET /store/v1/storefront` untouched across all 5 slices; reads only `published_config`/`published_schema_version`; re-confirmed no join to Versions exists anywhere in the read path |
| Forward-schema fail-closed | **PASS** | `assertSupportedSchema()`/`assertSupportedLegacySchema()`/`effectiveSchemaTag()` applied uniformly across read/save/duplicate/legacy/immediate-publish/scheduled-publish, per H1-1 rounds 5–10 and H1-3/H1-4's own tests |
| Exact-Version revision concurrency | **PASS** | per-Version `revision`, 409 on mismatch, independent per Version — tested for same-version stale save and different-version independence |
| Head-level publication concurrency | **PASS** | `published_revision` (head-level, monotonic, independent of Version revision) + `active_version_id`, both validated before mutation in `publishForCurrentTenant()` |
| No browser timer authority | **PASS** | scheduling is 100% server-side (`schedule_epoch`/`schedule_generation`/dispatcher); no client-side timer code exists in `web/` for schedule execution |
| No tenant authority from ids/request bodies | **PASS** | `TenantContext` (via `SetTenant`, from the authenticated user) is the sole authority everywhere; `executeScheduledPublish()` resolves tenant from the persisted Storefront row, never ambient state; explicit tests assert no request body ever carries `tenant_id` |
| SQLite/PostgreSQL compatibility | **PASS** | no PostgreSQL-only partial unique index/exclusion constraint/advisory lock anywhere in this Horizon's schema; one-active/one-scheduled enforced via locked head-row pointers; all test suites re-run in this closure pass on SQLite (PostgreSQL re-verification relies on the prior slices' own documented PostgreSQL runs plus this session's green CI, PostgreSQL execution not repeated live in this pass — see Tests) |

No invariant failed. No architecture deviation was found between the locked `CUST-H1-ARCH-1` document and the merged code.

---

## UX Closure

- **Desktop/tablet:** Version selector + Version Manager (popover), Publish/Schedule/Reschedule/Cancel dialogs, all centered `role="dialog"` modals at every desktop/tablet width tested (768/1024/1280/1440) with no horizontal overflow — including a genuine 768px overflow bug (H1-2) and a genuine toolbar-budget overflow bug (H1-5), both found by Playwright and fixed, not merely asserted.
- **Mobile:** Version Manager as a Bottom Sheet at 390/430; Schedule/Reschedule/Cancel dialogs open only after the sheet closes (never stacked); touch targets verified ≥32px; long names truncate with ellipsis, no clipping.
- **RTL/LTR:** every scenario in the three CUST-H1 Playwright specs runs in both Arabic RTL and English LTR; date/time inputs forced `dir="ltr"` inside the RTL shell, matching the codebase's existing numeric/date-field convention.
- **Version lifecycle:** create → edit → save → publish (immediate or scheduled) → reschedule/cancel → previous-live-retained-as-Draft, all traced to shipped, passing test coverage (H1-5's own 15-flow integrated table).
- **Publish:** high-trust confirmation naming the exact Version + Storefront, distinguishing first-publish from replace-and-retain, no generic "are you sure."
- **Scheduling:** native `<input type="date">`/`<input type="time">` (no bespoke calendar widget, per evidence from Shopify's own first-party pattern), fixed authoritative-timezone display, live preview line, past-time rejected client-side before any request, replace-warning naming the displaced Version.
- **Re-verified live in this closure pass:** all 21 desktop-viewport scenarios across `cust-h1-2-version-manager.spec.ts`, `cust-h1-3-immediate-publish.spec.ts`, and `cust-h1-5-scheduling-ux.spec.ts` re-run headless Chromium in this session — 21/21 passed (mobile-project duplicate run correctly skipped; each spec already sets its own explicit viewport via `test.use`, so the project-level mobile viewport would not exercise a materially different code path — this mirrors how the specs were authored and run in every prior slice's own report).

No visual regression was found. `main` had not advanced since H1-5 merged, so no additional re-verification beyond this closure pass's own live re-run was required per the task's own instruction to avoid redoing a full screenshot matrix when nothing changed.

---

## Timezone

- **Exact authoritative source:** `tenants.timezone` (`string`, `NOT NULL DEFAULT 'Asia/Riyadh'`, present since the very first migration, `2025_01_01_000001_create_tenants_and_users.php`). Verified directly in this closure pass: `database/migrations/2025_01_01_000001_create_tenants_and_users.php:20`.
- **Already-authoritative, not newly invented:** `App\Services\Pos\PosLpDigestService::generate()` already uses `$tenant->timezone ?: 'Asia/Riyadh'` for POS business-day boundaries, and `PosExceptionDetectionService`'s own source comment states this is deliberately "the same adopted timezone source… no second parallel source." CUST-H1-5 did not invent a new timezone concept — it exposed an existing one.
- **Exposure:** `App\Support\CompanyProfile::payload()` now includes `'timezone' => $tenant->timezone` (verified: `app/Support/CompanyProfile.php:64`), consumed by `web/src/lib/company.ts`'s existing `useCompany()` hook. `PUT /api/company`'s write-whitelist (`CompanyProfile::TENANT_FIELDS`) does **not** include `timezone` — read-only exposure only, confirmed by a dedicated backend test (`CompanyTest::me_exposes_the_tenant_timezone_read_only`, re-run green in this closure pass).
- **Conversion model:** `web/src/lib/timezone.ts` (verified present in this closure pass) converts a merchant-entered wall-clock date/time into a canonical UTC instant using the tenant's authoritative zone; `safeTimeZone()` falls back to `Asia/Riyadh` only when the resolved tenant value is missing/malformed — the same default the DB column itself already carries, not a new universal policy.
- **Proof browser timezone is not authority:** `timezone.test.ts` (13 tests, re-run green in this closure pass) includes a DST-zone round-trip test in both seasons and an explicit assertion that "Riyadh" display is never claimed for a non-Riyadh zone — proving the conversion uses the passed-in tenant zone, not `Intl`'s ambient/browser-resolved zone. The Schedule dialog's live preview line and the Reschedule prefill both round-trip through this same helper (H1-5's report documents a concrete day-boundary case: `2026-12-25T21:00:00Z` → `2026-12-26 00:00` Riyadh time, proving real arithmetic, not a naive same-day assumption).
- **Server storage:** API accepts ISO-8601 with an explicit offset only (`scheduled_for` regex requires `Z` or `±HH:MM`); DB stores canonical UTC; `scheduled_for` past-time and offset-less values are both rejected (422), checked both client-side and server-side (defense in depth, since "future" is inherently time-of-commit-dependent).
- **Universal Asia/Riyadh hard-coding:** not present as a forced tenant rule — the column is per-tenant, defaults to `Asia/Riyadh` only as the same default every tenant row already carries (Saudi-first product default, not a hard-coded override of a differently configured tenant).

**All required timezone-closure conditions hold. Not a closure blocker.**

---

## Tenant Isolation

Representative evidence, re-run green in this closure pass (`StorefrontPresentationVersionApiTest`, `StorefrontPresentationVersionPublishApiTest`, `StorefrontPresentationVersionScheduleApiTest`, `StorefrontPresentationScheduledPublishJobTest`, `StorefrontPresentationScheduleDispatcherTest`):

- Cross-tenant Version read/write (list/read/save/rename/delete) → non-leaking 404.
- Cross-tenant Publish → 404.
- Cross-tenant Schedule/Cancel → 404.
- Cross-storefront same-tenant Version reuse (a Version created under Storefront A addressed via Storefront B's URL) → 404.
- Scheduler tenant context: `executeScheduledPublish()` resolves `tenant_id` from the persisted Storefront row (`withoutGlobalScope(TenantScope::class)`) before touching `TenantContext`, restores the caller's prior context in a `finally` block; `no_cross_tenant_leakage_across_a_mixed_batch` proves a dispatcher batch spanning two tenants publishes each into its own tenant's head row with zero leakage.
- Public Draft/Scheduled non-exposure: `GET /store/v1/storefront` reads only `published_config`; no Version metadata, name, or content is ever reachable through an unauthenticated route.
- No request body ever accepted as tenant/storefront/version authority — an explicit frontend test scans every outgoing request body across create/save/rename/schedule/cancel/publish for a `tenant_id`-shaped field.

No isolation gap found.

---

## Backward Compatibility

- `GET/PUT/POST …/presentation` and `…/presentation/publish` (legacy STORE-BACKEND-1 endpoints): byte-identical request/response shape across all 5 slices — re-verified via the full `StorefrontPresentation*` suite (180 passed / 1 PostgreSQL-only skip, this closure pass).
- `published_config` public path: unchanged read path across all 5 slices; no join to Versions was ever introduced.
- Existing merchants: no recreation/migration action required — H1-1's Cases A–D backfill covers every possible pre-existing state (no row / Draft-only / Published==Draft / Published≠Draft) deterministically and idempotently, with a dedicated legacy-writer self-healing reconciliation path for the rolling-deploy window.
- Legacy Draft remains recoverable: the `compatibility_working_version_id` fork-before-mutate rule means an active→Draft edit through the legacy API never mutates a Published Version in place.
- No breaking API removal: every legacy endpoint remains reachable and behaviorally unchanged for any consumer that never adopts the Version API.
- Theme Gallery handoff (`commerce/themes` → `?version=` redirect): preserved through H1-2's merge-conflict reconciliation with the parallel STORE-THEME-GALLERY-3 PR; re-verified passing in this closure pass (`commerce/themes/page.test.tsx`, 4 tests).
- Existing Customizer unscheduled workflows: create/edit/save/publish-immediately all function with no schedule ever created — Scheduling is additive, not a required step in the lifecycle.

No compatibility gap found.

---

## Public Runtime

- Anonymous storefront (`GET /store/v1/storefront`) returns only Published content — re-confirmed by `public_storefront_renders_the_newly_published_version` and `failed_publish_leaves_the_public_snapshot_unchanged` (both re-run green in this closure pass).
- Draft/Scheduled names and content are never returned by any public route — no public route reads `storefront_presentation_versions` at all.
- Immediate publish and scheduled-publish both update `published_config` atomically within the same locked transaction that validates every concurrency guard; `the_former_published_version_is_retained_and_public_parity_holds` proves the scheduled path's written config is byte-identical to the executed Version's normalized config.
- A failed lifecycle operation (stale revision, stale publication head, forward-schema, scheduled-target-conflict) leaves the current live design provably untouched — every 409 test in this Horizon re-reads the head/Version row afterward and asserts zero mutation, not merely the HTTP status.

No public-runtime gap found.

---

## Scheduling Runtime

**Code complete and tested. Production activation is a separate, unmet dependency — correctly gated, not silently claimed.**

Re-verified directly against deployment artifacts in this closure pass (not merely re-read from H1-4/H1-5's own reports):

- `routes/console.php` registers `Schedule::command('storefront-presentations:dispatch-due')->everyMinute()->withoutOverlapping()->onOneServer()` — confirmed present, immediately preceded by a comment explicitly stating activation remains blocked pending Production cron wiring, mirroring the repository's pre-existing `webhooks:deliver` posture.
- `Dockerfile` hard-sets `QUEUE_CONNECTION=sync` (`ENV` block, line 49) — confirmed present; no durable queue connection is configured.
- `render.yaml` defines exactly one Render service (`nibras-api`, Docker web service) and one managed PostgreSQL database — no cron job, no worker service, no second process of any kind is declared.
- `deploy/entrypoint.sh` runs `php artisan migrate --force` then `exec apache2-foreground` — no `schedule:run` invocation anywhere in the container's startup path.

**Conclusion — unchanged from H1-4/H1-5's own findings, independently re-confirmed here:** nothing in Production today invokes the dispatcher. The schedule/cancel/reschedule APIs are real, fully functional, and fully tested (including the required stale-job/ABA-race test matrix); the frontend correctly gates Schedule/Reschedule behind `scheduling_runtime_active` (`config('storefront.scheduled_publishing.runtime_active')`, confirmed `env('STORE_SCHEDULING_RUNTIME_ACTIVE', in_array(env('APP_ENV'), ['local','testing']))` — defaults `false` in Production), with Cancel deliberately exempt as a safe recovery action.

### A. CUST-H1 CODE HORIZON STATUS

**Code-complete.** Every capability in the task's Required Capabilities list (1–24) has shipped, merged, and tested code behind it, including the scheduling runtime, dispatcher, and stale-job protections.

### B. PRODUCTION SCHEDULE ACTIVATION STATUS

**PRODUCTION ACTIVATION GATED.** Not active. Activation requires, per the architecture's own §14 deployment gate (unchanged by this closure task, no Production/Render/queue change made here):

1. An always-running scheduler path in Production (a Render Cron Job invoking `schedule:run`, or an equivalent platform-cron/always-on worker) — **not present today**.
2. And either a real non-sync queue connection + always-running worker + retry/backoff + failed-job observability (Path A), or the already-code-complete Path B per-item-isolated dispatcher's cron trigger being wired up (Path B is code-ready; only its trigger is missing).
3. An owner explicitly setting `STORE_SCHEDULING_RUNTIME_ACTIVE=true` in Production **after** independently verifying (1) and (2) — the default protects against flipping this by accident.

This closure task made no Production/Render/deploy/queue change of any kind, per its own explicit gate.

---

## Tests

### Backend (this closure session, SQLite unless noted)

```
cd nibras-app
php artisan test --filter=StorefrontPresentation
# 1 skipped (PostgreSQL-only concurrency test), 180 passed (1141 assertions)

php artisan test --filter="StorefrontPresentationScheduledPublishJobTest|StorefrontPresentationScheduleDispatcherTest|CommerceModuleBoundaryTest|CompanyTest|BranchIsolationGuardTest"
# 34 passed (348 assertions), 0 failed

php artisan test
# full suite — see below
```

Full-suite result (this closure session, clean SQLite, single uncontested run — `Fuel*`/`R2*` files excluded by filename from this one run only to avoid the multi-hour AWS-SDK-timeout hang every prior CUST-H1 slice report already documented and worked around the same way; their pre-existing failure category is independently reconfirmed below via CI): **9 failed, 49 skipped, 4811 passed (30139 assertions)**. All 9 failures are in exactly 2 files — `AuthRecoveryTest` and `DocumentCenterSecureIntakeTest` — both the exact pre-existing, unrelated local-dev-only gap (`App\Mail\AuthActionMail` not copied by this container's `setup.sh`, unlike `deploy/assemble.sh` and CI) that CUST-H1-4's and CUST-H1-5's own reports already independently documented. Separately, `Fuel*Test` (missing `bcmath` extension) and `R2*Test`/`ProductMediaR2*Test` (missing AWS SDK) are the two other pre-existing categories every one of the five CUST-H1 slice reports has documented in this exact dev container; CI installs both dependencies, so neither recurs there (confirmed live via PR #1114's own green CI checks below). **Zero failures in any Storefront/Presentation/Commerce/Company-scoped test in this closure session** (verified: no failing test class name contains "Storefront," "Company," or "CommerceModuleBoundary"), matching every prior slice's own independently-verified result.

PostgreSQL: not re-run live in this closure session (the full suite is multi-hour on this container and the five slice PRs each independently ran and reported a clean PostgreSQL 16 result already, most recently H1-5's `StorefrontPresentationVersionScheduleApiTest`/`CompanyTest`/`StorefrontPresentation` all passing on PostgreSQL 16); this closure session instead independently re-confirmed via GitHub's own recorded CI run: PR #1114's `php artisan test (L11, pgsql)` check — **completed, conclusion `success`** (see CI below), which is the authoritative, reproducible PostgreSQL signal for the exact code now on `main`.

### Frontend (this closure session)

```
cd web
npx vitest run src/modules/store-experience-builder src/modules/commerce-workspace/presentation-versions.test.ts src/lib/__tests__/timezone.test.ts
# 17 test files, 204 tests passed

npx vitest run "src/app/(commerce)/commerce/appearance" "src/app/(commerce)/commerce/themes"
# 5 test files, 37 tests passed

npx vitest run
# full suite: 323 files, 2383 tests passed

npx tsc --noEmit -p tsconfig.json
# 15 pre-existing errors (products/documents/import-jobs/platform modules), 0 in any CUST-H1 file

npm run build
# production build green, all pages compiled

npx playwright test e2e/cust-h1-2-version-manager.spec.ts e2e/cust-h1-3-immediate-publish.spec.ts e2e/cust-h1-5-scheduling-ux.spec.ts
# 21 passed (desktop project), 21 skipped (mobile project — each spec sets its own explicit viewport via test.use, matching every prior slice's own run pattern)
```

**Zero regressions found in this closure session's own independent re-run of every backend and frontend test file this Horizon touches or added.**

---

## CI

PR #1114 (the final, currently-merged CUST-H1 slice) — all 7 check runs **completed, conclusion `success`**, re-confirmed live in this closure session via the GitHub API:

| Check | Conclusion |
|---|---|
| `web build (Next.js)` | success |
| `php artisan test (L11, sqlite)` (×2 — reconciliation + final) | success |
| `php artisan test (L11, pgsql)` (×2 — reconciliation + final) | success |
| `merchant preview visual QA` | success |
| `published footer visual QA` | success |

All five slice PRs (#1082, #1085, #1103, #1112, #1114) are confirmed `merged: true` via the GitHub API in this closure session.

---

## Visual Verification

Reused H1-2/H1-3/H1-5's own evidence as the primary record, per the task's own instruction not to redo a full screenshot matrix when `main` has not materially changed since those reports. **`main` had not advanced at all since H1-5's merge** (`beca19f1` is both the closure task's stated baseline and H1-5's own merge commit) — verified via `git log 286ed84..beca19f1 -- web/src/modules/store-experience-builder`, which returns only the H1-5 merge commit itself.

Beyond reuse, this closure session **live-re-ran** all 21 desktop-viewport Playwright scenarios spanning 390/430/768/1024/1280/1440, Arabic RTL and English LTR, covering: Version selector, Version Manager, Publish confirmation, Schedule dialog, Scheduled state, Reschedule, Cancel, long names, no-horizontal-overflow, and Canvas-remains-primary — all 21 passed with zero failures, confirming the evidence in the prior reports still holds against the exact code now on `main`.

---

## Remaining Risks

### Closure-blocking

None found.

### Non-blocking

- `scheduling_runtime_active` is a single environment-wide flag, not per-tenant — matches the architecture's own framing of Production scheduler activation as a whole-deployment concern. A staged/per-tenant rollout would be a new decision, not a gap in this Horizon's own scope.
- Forward-schema-rejected schedules remain in the dispatcher's due-selection indefinitely (by design, so they stay retryable once a supporting deploy lands) — bounded/harmless (each attempt is a fast reject before any write) but worth an owner observability pass once Production activation happens.
- The dev-only `/dev/customizer-versions` mock-fixture's create/rename/delete routes were flagged in H1-3's own report as a pre-existing, still-latent routing gap in the *mock* router only (not production code) — never blocking, since the fixture's publish/schedule/cancel routes were independently verified reachable and every real capability is proven by the production-code test suites, not this dev-only visual fixture alone.
- Tablet width (768px) is visually tight for the toolbar (title and version name both truncate aggressively) — functional, matches the existing header's own pre-CUST-H1-2 behavior at that width, flagged as worth revisiting only if the toolbar grows further.
- A real PostgreSQL deadlock was found and documented in H1-4's own report, in `ProductMediaR2ReadTest` and sibling R2-storage tests — confirmed unrelated to any file this Horizon touches (traced to `TenantReferenceNumberService`/tenant registration lock contention), not chased further as out of this Horizon's scope; still present as an unrelated pre-existing repository issue worth an owner's dedicated look.

### Production activation dependencies (not closure-blocking; see "Scheduling Runtime")

- No Render Cron Job or equivalent `schedule:run` invocation exists in Production today.
- `QUEUE_CONNECTION=sync` remains hard-set; Path A (real queue + worker) is not active. Path B (the per-item-isolated sync dispatcher this Horizon built) is code-complete but has no cron trigger in Production yet.
- `STORE_SCHEDULING_RUNTIME_ACTIVE` remains unset (defaults `false`) in Production — correct and intentional until an owner verifies the above and flips it explicitly.

---

## Deferred / Explicitly Out of Scope

Recorded here for continuity, per the roadmap's own §17 documentation rule (preserve prior scope decisions, do not silently drop them):

- **CUST-H2 — Multi-Page Visual Builder** (Product page, Category page, Header/Footer direct editing, informational pages) — next recommended Horizon, not started.
- **CUST-H3 — Store Identity Studio** (logo/favicon/colors/fonts, custom font upload) — not started.
- **CUST-H4 — Section Library & Section Quality** (broader section catalogue, Picker search/categories) — not started.
- **CUST-H5 — Undo/Redo, Recovery & Change Confidence** — not started. (Note: this Horizon's own number, H1-5, is the fifth *slice* of CUST-H1, not the CUST-H5 roadmap Horizon — the roadmap's CUST-H5 remains entirely unstarted.)
- **CUST-H6 — Advanced Extensibility** (scoped custom CSS, section developer SDK; custom JavaScript remains blocked pending a dedicated security architecture gate) — not started.
- Salla-style publication targeting by country/city/language — explicitly deferred by the CUST-H1 evidence pass (§3), not reconsidered by any slice.
- A/B testing, percentage traffic rollout, shared public preview links, generic CMS revision history — explicitly deferred by the CUST-H1 evidence pass (§15).
- Any unrelated Commerce/ERP feature (accounting, HR, inventory, POS, etc.) — entirely outside this Horizon's scope; no file outside Storefront/Presentation/Commerce-workspace/Company-timezone-exposure was touched by any of the five CUST-H1 slices.

---

## Final Closure Decision

# CUST-H1 CLOSED

All 24 required capabilities are shipped, merged, tested, and re-verified against the current `main` tip in this closure session. All architecture invariants hold. Timezone closure is real and proven (authoritative `tenants.timezone` source, not browser-derived, not universally hard-coded). Tenant isolation, backward compatibility, and public-runtime correctness are proven by both the five slices' own extensive test suites and this closure session's independent re-run of the focused CUST-H1 test surface, the full backend suite, the full frontend suite, typecheck, build, and 21 live Playwright scenarios — zero regressions found anywhere.

Production scheduling activation is correctly and honestly marked **PRODUCTION ACTIVATION GATED** — this is not a closure blocker (the architecture and every slice's own report always treated Production activation as a separate, owner-controlled step after code-complete Horizon closure), and no code, config, or infrastructure change was made in this closure task toward activating it.

---

## Next Horizon

**CUST-H2 — Multi-Page Visual Builder**, per `docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §14's recommended order. Not started by this closure task; no new product scope was opened here.

---

# CUST-H1 HORIZON CLOSURE READY FOR MERGE — OWNER APPROVAL REQUIRED.

Per this task's own explicit gate: **DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE. DO NOT enable Production scheduling.** This report and its PR are documentation/verification only.
