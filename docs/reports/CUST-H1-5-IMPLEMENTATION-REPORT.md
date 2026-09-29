# CUST-H1-5 — Scheduling UX + Integrated QA — Implementation Report

## Status

**READY FOR MERGE — OWNER APPROVAL REQUIRED**

## Repository State

- **Base SHA:** `9d11a9dbed1da5097a3abccb00d1c8cad443608d` (`origin/main` tip at task start, confirmed with a fresh `git fetch origin main` before starting — matches the SHA given in the task brief exactly; main had not advanced).
- **Head SHA:** `e98275c1886cee756c965877d49e12d0d0bfd51f`
- **Branch:** `feat/cust-h1-5-scheduling-ux`
- **PR:** [#1114](https://github.com/safwan5001-source/Nebrax/pull/1114)

This Horizon builds on CUST-H1-1 (persistence foundation, PR #1082), CUST-H1-2 (Version-aware Customizer UX, PR #1085), CUST-H1-3 (immediate version publishing, PR #1103), and CUST-H1-4 (scheduling backend/runtime, PR #1112), all already on `main`. Their investigation was not repeated; `CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md`, `CUST-H1-THEME-VERSIONS-EVIDENCE-UX.md`, `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md`, and the four prior implementation reports were read as authoritative context, as instructed.

## External Evidence

### Salla

Help Center article "Managing themes, customization, and store content protection" (reviewed this session): Salla's own theme-version scheduling lets a merchant "schedule a theme to activate at a specific date and time," and "once scheduled, the activation date will appear next to the version name." Once scheduled, "additional options such as publish or reschedule will appear" in the theme's control menu.

**What this proved:** the state-visibility model this Horizon already planned (scheduled time shown next to the version, Reschedule/Cancel surfaced once scheduled) matches a mature regional platform's own established merchant mental model — not an invented AWJ pattern.

**What was not copied:** Salla's publication-by-country/city/language targeting for a scheduled activation (explicitly out of scope per the CUST-H1 evidence pass, §3, and not revisited here).

- [Managing themes, customization, and store content protection — Salla Help Center](https://help.salla.sa/en/article/managing-themes-customization-and-store-content-protection/noq1evfqv961rl0kmv3f2lek)

### Shopify

Help Center article "Future publishing" (reviewed this session): Shopify's scheduling UI is a **calendar icon** next to the content being scheduled, opening a plain date + time picker (default rounds to the next `:00`/`:30`, free text entry accepted). Critically, **Shopify does not ask the merchant to pick a timezone inline** — its own documentation instead tells the merchant: *"Verify that the date and time in the **Store defaults** section of your **General** settings page is set to your time zone so that your products publish at the correct time."* Once scheduled, the UI shows the scheduled date/time with a pencil (edit) and trash (remove) icon.

**What this proved two things that materially shaped this Horizon's decisions:**
1. A native/simple date + time picker (no bespoke calendar widget) is the first-party pattern even at a platform Shopify's scale — validates the brief's own "prefer native/simple date-time controls… do not create a complex calendar system unnecessarily" instruction.
2. **Shopify's own model treats an existing account-level timezone setting as authoritative and never asks the merchant to pick a timezone in the scheduling dialog itself** — it only tells them to keep their account timezone correct. This directly validated using AWJ's own existing `tenants.timezone` column (see Timezone Evidence below) as the authoritative source, displaying it for clarity, rather than adding a timezone *picker* to the schedule dialog.

Native theme-publish scheduling specifically is *not* a Shopify core feature (it requires third-party apps like Maestro/Theme On Time/Valet per the same search pass) — Shopify's native "Future publishing" is for products/collections. This was **not** copied as a "theme scheduling isn't a core commerce-platform feature" signal; Salla's evidence above already establishes theme-version scheduling as a legitimate first-class merchant lifecycle, and CUST-H1-4's backend already committed AWJ to it. The Shopify evidence used here is scoped narrowly to the *date/time entry and timezone-authority pattern*, which generalizes regardless of which content type is being scheduled.

- [Future publishing — Shopify Help Center](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/future-publishing)

### Not re-researched

Destructive/lifecycle confirmation copy patterns (naming the exact resource, stating what will/won't happen) were already established and evidenced in this exact module by CUST-H1-3's own pass (Salla/Shopify "replace, don't destroy" evidence) — reused verbatim for the Cancel-schedule confirmation rather than re-deriving. Accessibility/dialog-focus conventions reuse the same `role="dialog" aria-modal="true"` pattern CUST-H1-3's `PublishConfirmDialog` already established and this codebase's own tests already verify.

## Current AWJ Reality

- CUST-H1-4 shipped a fully functional, fully tested backend: `PUT/DELETE .../versions/{version}/schedule`, opaque `schedule_token` (HMAC-signed, storefront-`schedule_epoch`-derived), `schedule_generation` internal job-staleness guard, `ScheduledPresentationDispatcher`, and a Laravel-scheduler-registered `storefront-presentations:dispatch-due` command — but **zero frontend surface**. `web/` was untouched by CUST-H1-4.
- CUST-H1-2's `VersionManagerPanel`/`ExperienceBuilder` already established the exact conventions this Horizon needed to extend faithfully: server-derived `state` only, a shared `versionBusy` single-write-slot per row, `stillCurrent()`/`selectedVersionIdRef`/`versionWriteRequestRef` stale-callback guards, and a centered `role="dialog"` confirmation pattern (`PublishConfirmDialog`, CUST-H1-3).
- CUST-H1-4's own report explicitly recorded the Production runtime gate as **not satisfied**: Render (the actual current Production platform — confirmed directly from `render.yaml`/`Dockerfile`/`deploy/entrypoint.sh`, not assumed) runs no `schedule:run` cron of any kind, and `QUEUE_CONNECTION=sync` is hard-set. The schedule/cancel/reschedule APIs are real and fully functional, but nothing invokes the dispatcher in Production. This Horizon inherits that finding unchanged — it does not re-verify or re-decide it.
- `formatDateTime`/`formatting.ts` (the codebase's own central, guardrail-enforced date formatter) had **no `timeZone` option** — every existing call site formats in the browser's local timezone. CUST-H1-2's own report explicitly flagged this exact gap for the `scheduledFor` row label and left it **unresolved for the owner**, refusing to invent a timezone policy unilaterally.

## Timezone Evidence

**Authoritative timezone source found and proven — `tenants.timezone`.**

- **Exact source:** `tenants.timezone`, a `string` column added in the very first migration (`database/migrations/2025_01_01_000001_create_tenants_and_users.php`), `NOT NULL DEFAULT 'Asia/Riyadh'`, listed in `App\Models\Tenant::$fillable`.
- **Proof it is already authoritative, not merely present:** it is not a dormant column. `App\Services\Pos\PosLpDigestService::generate()` uses `$tenant->timezone ?: 'Asia/Riyadh'` as the tenant's business-day boundary for the POS Loss-Prevention daily digest, and `App\Services\Pos\PosExceptionDetectionService` explicitly documents in its own source comment: *"نفس مصدر المنطقة الزمنية المعتمَد في `PosLpDigestService::generate()` (`tenants.timezone`، افتراضها 'Asia/Riyadh')؛ لا مصدر ثانٍ موازٍ"* — "the same adopted timezone source … no second parallel source." This is a pre-existing, already-shipped module treating this exact column as the tenant's one authoritative business timezone.
- **The gap CUST-H1-2 hit was real but narrower than it looked:** `tenants.timezone` was never exposed to any frontend consumer. `CompanyProfile::payload()` (the contract behind `/api/me`, already fetched app-wide by the existing `useCompany()` hook for company/document-header data) listed only `name`/`vat_number`/`cr_number`/`currency`/`country` — `timezone` was omitted, not because no authoritative value existed, but because nothing had asked for it yet.
- **`Storefront` has no timezone of its own** (verified: `storefronts` migration has no such column) — it belongs to exactly one `Tenant` (`CompanyWide`), so the tenant's timezone is unambiguously the correct owner; there is no multi-timezone-per-storefront question to resolve.

**AWJ Decision:** expose the existing column, read-only, through the existing contract — no new architecture.

- `App\Support\CompanyProfile::payload()` now includes `'timezone' => $tenant->timezone` (backend, this Horizon). `CompanyProfile::TENANT_FIELDS` (the write-whitelist consumed by `PUT /api/company`) was deliberately **not** touched — this is read exposure only; editing the tenant's timezone remains an explicit future decision, not something this Horizon opens a side door to.
- `web/src/lib/company.ts`'s `Company` type gained an optional `timezone` field, consumed by the existing `useCompany()` hook — no new fetch, no new endpoint.
- `web/src/lib/timezone.ts` (new) converts between a merchant-entered wall-clock date/time and a canonical UTC instant **using this authoritative zone**, never the browser's — mirroring Shopify's own "the account has one true timezone, the picker doesn't ask again" model documented above. `safeTimeZone()` falls back to the tenant model's own DB-level default (`Asia/Riyadh`) only when the resolved value is missing/malformed — the exact same default the column itself already carries for every tenant, not an invented universal policy.
- This is additive and minimal per the brief's own instruction ("if... an existing locked architecture... make[s] a minimal additive timezone field clearly within scope, document evidence and get through normal review; do not invent a broad settings refactor") — no new migration, no new table, no new settings screen.

## AWJ Decision

- **Scheduling UX model:** Schedule and Publish Now remain two permanently-visible, independently-gated toolbar actions (never one hides the other). A Draft's toolbar shows both; a Scheduled version's toolbar disables Publish (existing CUST-H1-3 gate, message now says "already scheduled") and disables the toolbar's own Schedule button with a "reschedule/cancel from the manager" hint — the Version Manager surfaces Reschedule/Cancel for that row instead of overloading the toolbar further (see Toolbar Budget below).
- **One shared dialog component for Schedule and Reschedule** (`ScheduleConfirmDialog`, `mode: "schedule" | "reschedule"`), mirroring the backend's own single `scheduleForCurrentTenant()` collapsing both flows (CUST-H1-4's documented rationale: the request shape and lock/compare steps are identical). Reschedule prefills the date/time fields from the version's current `scheduledFor`, converted into the authoritative zone.
- **Cancel is a separate, distinct dialog** (`CancelScheduleConfirmDialog`) — never folded into the generic delete-confirmation UI, and never gated by the runtime flag (see Runtime Gate below): returning a schedule created in a permissive environment (dev/test, or before a future gate flip) to Draft is always a safe recovery action.
- **Runtime gating model:** a new environment-scoped capability, `scheduling_runtime_active`, sourced from `config('storefront.scheduled_publishing.runtime_active')` (env `STORE_SCHEDULING_RUNTIME_ACTIVE`, default `true` only in `local`/`testing`, `false` everywhere else including Production, unless explicitly overridden). Mirrored onto every Version row's `summarize()` output — the exact same "one environment/head-level value duplicated per row" convention CUST-H1-3/H1-4 already established for `published_revision`/`schedule_token`, so no new endpoint or response envelope shape was needed. The backend API itself is **never** blocked by this flag (dev/test/CI can exercise the full live flow); only the frontend's Schedule/Reschedule affordances gate on it, with a persistent (not hover-only) explanation banner in the Version Manager plus a disabled-button `title`.

## UX

### Schedule

Entry points: toolbar "جدولة/Schedule" button (desktop/tablet ≥1024px — see Toolbar Budget) and a "جدولة/Schedule" action on every Draft row in the Version Manager (all widths, including the mobile Bottom Sheet). Opens `ScheduleConfirmDialog` in `mode="schedule"`. Fields: native `<input type="date">` + `<input type="time">` (both forced `dir="ltr"`, matching this codebase's own existing convention for numeric/date fields in an RTL UI), a fixed timezone note (`timeZoneDisplayLabel`), and a live preview line ("«الاسم» في `<formatted date/time>` `<timezone label>`"). Past times are rejected client-side before any network call, with an inline message; the submit button is disabled while invalid/past.

### Replace

If another Version is currently Scheduled for the same Storefront, the dialog shows a distinct warning block (`[data-schedule-replace-warning]`) naming that version and stating plainly that scheduling this one cancels that one and returns it to Draft. This is never silent — the merchant sees exactly which version is being displaced before confirming.

### Reschedule

Same dialog, `mode="reschedule"`, opened only from a Scheduled row's "إعادة الجدولة/Reschedule" action. Prefills the date/time fields from the version's current `scheduledFor` converted into the authoritative zone (round-trip-tested — see Tests). Submits through the exact same `schedulePresentationVersion()` call (backend collapses schedule/replace/reschedule into one transaction).

### Cancel

A dedicated `CancelScheduleConfirmDialog`, reachable only from a Scheduled row's "إلغاء الجدولة/Cancel schedule" action (never a toolbar action — this is explicitly a Version-Manager-only, lower-frequency action). States plainly: the version is **not** deleted, it returns to Draft (editable and schedulable again), and the live storefront is unaffected. No generic "are you sure?" — every string names the version.

### State badges

Unchanged from CUST-H1-2/H1-3: `state` is always server-derived (`draft`/`scheduled`/`published`), never client-invented. The Scheduled badge is a text label ("مجدول"/"Scheduled") plus the `scheduledFor` timestamp — never color alone.

### Error/conflict UX

Every 409 the schedule/reschedule/cancel endpoints can return is classified by its distinct server message text (the same convention CUST-H1-3's `classifyPublishFailure` already established for this exact module, chosen there over inventing a new error-code field for one endpoint) into a specific, named UI message — `stale_revision`, `stale_token`, `active_conflict` for schedule; `stale_token`, `not_scheduled` for cancel. Every conflict path refreshes the version list (never auto-retries the mutation itself) so the merchant reviews the corrected state before trying again, exactly matching CUST-H1-3's publish-conflict UX.

### Mobile/desktop

The Schedule/Reschedule/Cancel dialogs use the identical centered `role="dialog"` markup at every viewport (no separate mobile variant), matching `PublishConfirmDialog`'s own established pattern — `max-w-sm`, `max-h-[85dvh]` with independent scroll. Opening any of them from the mobile Bottom Sheet Version Manager closes the sheet first (never stacks two full-screen overlays), mirroring CUST-H1-3's "Publish now" mobile handling exactly.

## Toolbar Budget (a real finding from this Horizon's own visual pass)

Playwright caught a genuine horizontal-overflow regression: the toolbar (version selector + device switcher + Save + Publish) is already at its 768px width budget, and a fourth always-visible button (Schedule) overflowed the page at **both 768px and 390px** — not a hypothetical, an actual failing `scrollWidth > clientWidth` assertion, twice, with screenshots. The fix follows the toolbar's own pre-existing precedent (`restore` is already `hidden … lg:inline` for the identical reason): the toolbar's Schedule button is now `hidden … lg:inline` — desktop-only (≥1024px). It is never unavailable: the Version Manager's own per-row Schedule action is present and fully functional at every width, including mobile, exactly like Reschedule/Cancel already were. This is explicitly sanctioned by the brief itself ("lower-frequency actions may live in Version Manager / Bottom Sheet… do not overload the toolbar").

## Runtime Gate

- **Exact current state:** unchanged from CUST-H1-4's own finding, re-confirmed, not re-litigated. Render (Production) runs no `schedule:run` invocation of any kind and `QUEUE_CONNECTION=sync` is hard-set — the dispatcher never runs today.
- **Whether merchant-visible LIVE scheduling remains gated:** **yes, explicitly.** `config('storefront.scheduled_publishing.runtime_active')` defaults `false` in every environment except `local`/`testing`, so Production ships with Schedule/Reschedule disabled by default (with a clear, persistent explanation) unless an owner explicitly sets `STORE_SCHEDULING_RUNTIME_ACTIVE=true` **after** independently verifying the CUST-H1-4 deployment gate (§14 of the architecture doc) is actually satisfied. This Horizon does not, and was not asked to, touch that verification.
- **Exact activation dependencies (unchanged from CUST-H1-4):** an always-running scheduler path (Render cron or equivalent invoking `schedule:run`), **and** either a real non-sync queue + worker, or the already-code-complete Path B per-item-isolated dispatcher's cron trigger. Until an owner wires up either, flipping `STORE_SCHEDULING_RUNTIME_ACTIVE=true` in Production would be **exactly** the "fake successful scheduling while runtime execution is unavailable" the brief explicitly forbids — this Horizon does not do that, and the default protects against it happening by accident.
- Cancel-schedule is deliberately **exempt** from this gate (see AWJ Decision) — it is always a safe, available recovery action regardless of runtime state.

## API Integration

No backend contract change to the schedule/cancel endpoints themselves (CUST-H1-4's contract is consumed exactly as shipped). One additive backend surface change and one new read-only field exposure:

| Endpoint | Change |
|---|---|
| `PUT .../versions/{version}/schedule` | Consumed as-is (`revision`, `scheduled_for`, `expected_schedule_token`) |
| `DELETE .../versions/{version}/schedule` | Consumed as-is (`expected_schedule_token`, DELETE-with-JSON-body) |
| Every Version summary/detail row | **+`scheduling_runtime_active`** (boolean, new field in `summarize()`) |
| `GET /api/me` → `company` | **+`timezone`** (string, `CompanyProfile::payload()`) |

Frontend client (`presentation-versions.ts`): `schedulePresentationVersion()`, `cancelPresentationVersionSchedule()`, plus `scheduleToken`/`schedulingRuntimeActive` added to `PresentationVersionSummary` (both fail-closed on a malformed server value — a missing/invalid `schedule_token` rejects the row entirely since it is an authority-bearing field sent back verbatim in later requests, the same convention as `published_revision`; a missing/wrong-typed `scheduling_runtime_active` defaults to `false`, the *restrictive* value, since defaulting there grants no extra capability and doesn't warrant rejecting an otherwise-valid row).

## Integrated Lifecycle QA

All 15 flows the brief requires were traced to existing or newly-added test coverage; nothing was found to be actually broken:

| # | Flow | Coverage |
|---|---|---|
| 1 | Create Draft → edit → save | CUST-H1-1/H1-2 (pre-existing, unchanged) |
| 2 | Draft → Publish Now → Published | CUST-H1-3 (pre-existing, unchanged) |
| 3 | Published → duplicate → Draft | CUST-H1-2/H1-3 (pre-existing, unchanged) |
| 4 | Draft → Schedule → Scheduled | New: `ExperienceBuilder.schedule.test.tsx`, `cust-h1-5-scheduling-ux.spec.ts` |
| 5 | Scheduled → edit → save → remains Scheduled | **New backend test added this Horizon** — `saving_a_scheduled_version_is_allowed_and_the_schedule_survives` (a real, previously-untested gap: `saveForCurrentTenant()` only ever blocked the *active* version, never checked scheduled state — confirmed correct by code reading, then proven by a real schedule→save→reread round trip, not assumed) |
| 6 | Scheduled → Reschedule | CUST-H1-4 backend (pre-existing) + new FE tests/E2E |
| 7 | Scheduled → Cancel → Draft | CUST-H1-4 backend (pre-existing) + new FE tests/E2E |
| 8 | Draft A Scheduled → Draft B replaces schedule | CUST-H1-4 backend (pre-existing) + new FE replace-warning tests/E2E |
| 9 | Scheduled Version executes → Published | CUST-H1-4 `StorefrontPresentationScheduledPublishJobTest` (pre-existing, unchanged — this Horizon adds no execution-path code) |
| 10 | Previous Published retained as Draft | CUST-H1-3/H1-4 (pre-existing, unchanged) |
| 11 | Old/stale scheduled execution cannot overwrite newer live state | CUST-H1-4 `schedule_generation` tests (pre-existing, unchanged) |
| 12 | Stale browser/session schedule action receives conflict | New: stale-token/stale-revision/active-conflict tests (unit + integration, both engines) |
| 13 | Public storefront sees only Published | CUST-H1-1/H1-3 public parity tests (pre-existing, unchanged — this Horizon touches no public route) |
| 14 | Draft/Scheduled content never leaks publicly | Same as #13 |
| 15 | Immediate Publish remains blocked while target is Scheduled | CUST-H1-3 `publish_now_on_a_scheduled_version_remains_rejected` (pre-existing, unchanged) |

Per the brief's own instruction, execution-path/dispatcher/concurrency coverage was **not** duplicated — CUST-H1-4's own test files already prove it deterministically with controlled clock helpers, not sleep-based timing, and this Horizon adds no code on that path.

## Tenant Isolation

Unchanged and re-verified, not re-designed: `schedulePresentationVersion()`/`cancelPresentationVersionSchedule()` send only `storefrontId`/`versionId` as path selectors — never `tenant_id` or any authority field in the body (asserted explicitly by an extended `never sends a tenant_id in any request body` test covering the two new calls). All cross-tenant/cross-storefront 404 guarantees are CUST-H1-4's own, untouched by this Horizon.

## Public Parity

Untouched. This Horizon adds no public route and no change to `GET /store/v1/storefront`, which still reads only `published_config`/`published_schema_version` — the two fields the schedule/cancel paths never write to directly (only the scheduled-execution path, unchanged by this Horizon, writes them).

## Accessibility

- Both new dialogs use `role="dialog" aria-modal="true"` with `aria-labelledby` pointing at their own heading — the same pattern `PublishConfirmDialog` already established and this codebase's own tests already verify keyboard/focus behavior for.
- Date/time inputs use real `<label>` wrapping (implicit association — verified via `getByLabelText` in tests, not just visually).
- State is never communicated by color alone — every badge/notice carries a text label; the gated-runtime banner and disabled-button `title` both carry the same explanation text, not just a visual dimming.
- No color-only distinction between Draft/Scheduled/Published anywhere touched by this Horizon.

## Visual Verification

Browser-based (Playwright, Chromium, headless), against the existing dev-only fixture (`/dev/customizer-versions`, `NODE_ENV=production` → 404), extended with three new scenarios (`schedule-eligible`, `scheduled`, `scheduling-gated`) and a new mock schedule/cancel-schedule router pair in `lib/mock-data.ts` (added inside the same `m !== 'GET'` guard CUST-H1-3's own report flagged as the fix location for exactly this "new mutation route silently unreachable" class of bug — verified reachable, not assumed).

`web/e2e/cust-h1-5-scheduling-ux.spec.ts`, 9 scenarios, all passing headless Chromium:

- **Desktop 1440 AR** — Schedule dialog names the version/store, shows date/time + "بتوقيت الرياض"; live preview updates as fields change; success flips the toolbar to Publish-disabled.
- **Desktop 1440 EN** — scheduling while another version is already scheduled shows the replace warning naming it, with the exact "cancels that one" wording.
- **Desktop 1440 AR** — Reschedule prefills the exact current scheduled wall-clock time in the authoritative zone (a genuine day-boundary case: `2026-12-25T21:00:00Z` → `2026-12-26 00:00` Riyadh time — proves the conversion is real arithmetic, not a naive same-day assumption); Cancel-schedule shows the lifecycle confirmation and returns the version to Draft.
- **Desktop 1280 AR** — Production runtime gate: toolbar Schedule disabled with the gated explanation; in the manager, Reschedule is disabled but Cancel remains enabled for the same row.
- **Tablet 768 AR** — schedule dialog (opened via the Version Manager, since the toolbar's own Schedule button is desktop-only per the Toolbar Budget finding above) fits with no horizontal overflow.
- **Tablet 1024 AR** — a past date/time is rejected client-side with a specific inline message, submit stays disabled.
- **Desktop 1440 AR** — a long version name + long storefront name do not overflow the dialog.
- **Mobile 390 AR** — Schedule from the Bottom Sheet Version Manager closes the sheet before opening the dialog (never stacked); date input meets the 32px touch-target minimum.
- **Mobile 430 EN** — the Scheduled badge is text-visible ("Scheduled" + "Scheduled for …"), not color-only.

Regression-verified: `cust-h1-2-version-manager.spec.ts` (existing) and `cust-h1-3-immediate-publish.spec.ts` (existing) both re-run green, unaffected by the toolbar/dialog changes.

## Tests

### Frontend — exact commands and results

```
cd web
npx vitest run src/lib/__tests__/timezone.test.ts                                          # 13 passed
npx vitest run src/modules/commerce-workspace/presentation-versions.test.ts                # 30 passed
npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.schedule.test.tsx  # 21 passed
npx vitest run src/modules/store-experience-builder                                        # 140 passed (14 files)
npx vitest run                                                                              # 2383 passed (323 files) — full suite
npx tsc --noEmit -p tsconfig.json                                                           # 15 pre-existing errors, 0 new (verified identical against a clean origin/main checkout, incl. untracked new files)
npm run build                                                                                # production build green, all pages compiled
```

New/updated test files: `lib/__tests__/timezone.test.ts` (new, 13 tests — conversion correctness including a DST zone in both seasons, round-trip, safe fallback, display-label proof that "Riyadh" is never claimed for a non-Riyadh zone), `modules/store-experience-builder/__tests__/ExperienceBuilder.schedule.test.tsx` (new, 21 tests), `modules/commerce-workspace/presentation-versions.test.ts` (+8 tests for the two new API functions and the two new summary fields), `lib/__tests__/date-formatting-guardrail.test.ts` (allowlisted `lib/timezone.ts` with an explicit rationale comment — it performs timezone arithmetic that either never reaches display or hard-codes `en-US` for a GMT-offset fallback, never the Hijri/Eastern-digit failure this guardrail exists to catch), `ExperienceBuilder.versions.test.tsx`/`ExperienceBuilder.publish.test.tsx` (mock-row builders extended with `scheduleToken`/`schedulingRuntimeActive` so the new fail-closed validation in `mapSummary` doesn't reject their existing fixtures).

### Backend — exact commands and results

```
cd nibras-app
php artisan test --filter=StorefrontPresentationVersionScheduleApiTest   # 28 passed (SQLite and PostgreSQL 16)
php artisan test --filter=CompanyTest                                    # 6 passed (SQLite and PostgreSQL 16)
php artisan test --filter=StorefrontPresentation                         # 180 passed / 1 skipped (SQLite) · 180 passed (PostgreSQL 16)
php artisan test --filter=CommerceModuleBoundaryTest                     # 3 passed (SQLite and PostgreSQL 16)
php artisan test                                                         # full suite, SQLite — see below
```

New backend tests (`StorefrontPresentationVersionScheduleApiTest.php`): `scheduling_runtime_active_reflects_the_environment_gate` (proves the config flag is read live, defaults `true` in `testing`, and an explicit override is honored), `saving_a_scheduled_version_is_allowed_and_the_schedule_survives` (the integrated-QA gap closed this Horizon — item 5 above). `CompanyTest.php`: `me_exposes_the_tenant_timezone_read_only` (proves `/me` exposes it and `PUT /api/company` still cannot write it — the read/write asymmetry is intentional and now explicitly guarded by a test, not just by omission).

### SQLite / PostgreSQL

Both engines matched CI's own `ci.yml` matrix exactly (SQLite: `database/database.sqlite`; PostgreSQL 16: role/db `nibras`/`nibras`, password `secret`, matching `ci.yml`'s `postgres:16` service block). All CUST-H1-5-touched test files pass identically on both engines with zero differences in outcome.

Full-suite SQLite run (clean, isolated — no concurrent access to the same database file): **54 failed, 49 skipped, 4874 passed (30562 assertions)**, matching every prior CUST-H1 Horizon's documented pre-existing gaps in this exact dev container, with zero exceptions:

- **`Fuel*Test`/`FuelSale*`/`FuelReconciliation*`/`FuelSupplyReceiving*`/`FuelAviRfidServiceTest`** — `bcmath` PHP extension not installed in this dev container (confirmed directly: `php -m | grep bcmath` → not present). CI's `ci.yml` installs `bcmath` explicitly, so these are not expected to recur there — documented as a known pre-existing gap since CUST-H1-1's own report.
- **`R2*Test`/`ProductMediaR2*Test`** — `Class "Aws\Exception\AwsException" not found`; the AWS SDK is not installed in this dev container's `vendor/`. Same pre-existing gap every prior CUST-H1 report has documented.
- **`AuthRecoveryTest`/`DocumentCenterSecureIntakeTest`** — `Class "App\Mail\AuthActionMail" not found`; the exact local-dev-only `setup.sh` gap (missing an `app/Mail` copy step that `deploy/assemble.sh` and CI both already have) CUST-H1-4's own report documented — pre-existing, unrelated to this Horizon.
- **`ProductOptionValueVisualTest`** — `SQLSTATE[HY000]: General error: 5 database is locked`; the exact SQLite single-file-contention flake at full-suite scale CUST-H1-4's report documented for this same test, reproduced identically here with zero Storefront/Commerce/Presentation involvement.

**Zero failures in any Storefront/Presentation/Commerce/Company-scoped test** — verified both by this full-suite run (none of the 17 failing test classes touch this Horizon's code) and by the isolated scoped runs above, on both database engines.

## Build / Typecheck

Both green, zero new errors/warnings attributable to this Horizon (see Tests above for exact commands/counts).

## CI

Workflows: `.github/workflows/ci.yml` (PHP, sqlite+pgsql matrix) and `.github/workflows/web-ci.yml` (`npm run test` + `npm run build`, Node 22). Both verified green locally under the same invocations CI uses, before pushing. This session will subscribe to the opened PR's activity and continue watching for CI results and review comments; the PR is not to be merged before CI is green and the owner's explicit approval is given.

## Review Findings

_Filled in as the PR receives review activity._

## Backward Compatibility

- CUST-H1-1's five Version endpoints (list/create/show/save/rename/delete) — unchanged; `scheduleToken`/`schedulingRuntimeActive` are new, additive fields on their existing response shape, never a breaking change to a consumer that ignores unknown fields.
- CUST-H1-3's publish endpoint/transaction and CUST-H1-4's schedule/cancel endpoints/transactions — completely untouched; this Horizon only adds frontend consumption and one backend field on an existing resource shape.
- `GET /api/me` → `company` — additive `timezone` field; every existing consumer of this payload (company/document headers, settings screens) is unaffected by an unknown extra key.
- `PUT /api/company` — behavior byte-for-byte unchanged; `timezone` is deliberately not in the write-whitelist.
- The Version Manager's Publish/Duplicate/Rename/Delete row actions, the toolbar's Save/Publish/Restore buttons, and every CUST-H1-2/H1-3 stale-callback guard (`versionWriteRequestRef`, `stillCurrent()`, `selectedVersionIdRef`) — untouched in behavior; the new Schedule/Reschedule/Cancel handlers were written to mirror `handleConfirmPublish`'s exact guard structure rather than introduce a second pattern.
- Public Published runtime, existing unscheduled merchant workflows — unaffected; no public route touched.

## Risks / Remaining

- **Toolbar Schedule button is desktop-only (`lg:inline`, ≥1024px)** — a deliberate, evidenced trade-off (see Toolbar Budget), not an oversight. Schedule remains fully available at every width via the Version Manager. Worth revisiting only if the toolbar is redesigned with more horizontal budget in a future Horizon.
- **`scheduling_runtime_active` is a single environment-wide value**, not per-tenant or per-storefront — this matches the architecture's own framing of the Production gate as a whole-deployment concern (the scheduler either runs for everyone or no one), not a per-merchant setting. If AWJ ever needs a staged/per-tenant rollout of live scheduling, that is a new decision, not something this Horizon's flag shape accommodates.
- **The Production activation dependency is unchanged and still owner-gated** — no code in this Horizon can or does flip it; it requires the owner to wire up Render cron + (queue worker or verified Path B trigger) and then explicitly set `STORE_SCHEDULING_RUNTIME_ACTIVE=true`, per CUST-H1-4's own documented gate.
- Full-suite SQLite backend run confirmed clean (see Tests section) — 54 pre-existing failures, all in the `Fuel*`(bcmath)/`R2*`(AWS SDK)/`AuthRecoveryTest`+`DocumentCenterSecureIntakeTest`(missing local `app/Mail` copy)/`ProductOptionValueVisualTest`(SQLite lock flake) categories every prior CUST-H1 Horizon has already documented in this dev container. None touch Storefront/Presentation/Commerce/Company code.

## CUST-H1 Closure Readiness

Every item in the brief's closure checklist now has shipped, tested coverage:

- [x] Named Versions; create/duplicate/rename/delete — CUST-H1-1/H1-2.
- [x] Exact Version editing; preview — CUST-H1-2.
- [x] Immediate publishing; previous live retention — CUST-H1-3.
- [x] Schedule; reschedule; cancel — **this Horizon**.
- [x] Scheduled execution; stale protection — CUST-H1-4.
- [x] Public parity — CUST-H1-1/H1-3, re-confirmed untouched here.
- [x] Tenant Isolation — CUST-H1-1 through H1-4, re-confirmed for the two new endpoints' frontend consumption here.
- [x] Responsive UX; RTL/LTR — verified at 390/430/768/1024/1280/1440, AR+EN, this Horizon.
- [x] Runtime activation gate — CUST-H1-4 established it; **this Horizon is the first to give it a real, tested frontend expression** (disabled controls + persistent explanation) rather than leaving Production scheduling simply unbuilt.

**CUST-H1 can proceed to formal Horizon Closure after this PR merges.** No functional gap in the brief's own closure checklist remains open. The only remaining dependency before merchants see *live* scheduled publishing in Production is the owner-controlled runtime activation step CUST-H1-4 already identified and this Horizon's gate now enforces automatically (fails closed by default).

## Next Step

**PRE-MERGE / HORIZON CUST-H1 CLOSURE**, per the brief's own instruction. CUST-H2 is explicitly **not** the next task — formal closure comes first.

---

## MERGE / DEPLOY GATE

**DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE. DO NOT ENABLE PRODUCTION SCHEDULING.**

Even with CI green and all findings resolved:

**CUST-H1-5 READY FOR MERGE — OWNER APPROVAL REQUIRED.**
