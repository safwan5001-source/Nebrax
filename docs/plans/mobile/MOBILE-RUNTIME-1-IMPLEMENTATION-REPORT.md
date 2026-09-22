# MOBILE-RUNTIME-1 — Implementation Report

STATUS: review (implementation complete, pre-merge review pending final CI observation)
DATE: 2026-09-22

## Outcome

An isolated, reproducible Flutter workspace (`mobile/`) exists with a pinned
toolchain, a minimal placeholder shell, a green `flutter analyze`/`flutter
test` baseline, CI wired to run them on every relevant push/PR, and a
documented performance-measurement method + provisional budget baseline
(MR-18). No dependency beyond `flutter create`'s stock defaults was added.

## Repository evidence / root cause

This is horizon-launch work, not a bug fix. Repository evidence checked
before starting:
- No `mobile/` directory existed (`ls mobile` → not found).
- No Flutter/Dart toolchain was preinstalled in this execution environment
  (`which flutter`/`dart` → not found).
- `web/` (Next.js merchant UI) and `storefront/` (Next.js customer
  storefront) exist and are unrelated Node/TS workspaces — MR-02 requires
  `mobile/` stay isolated from both, confirmed no naming/path conflict.
- `docs/openapi/commerce-api-v1.yaml` exists and is committed (needed later
  by MOBILE-RUNTIME-4, confirmed present now so the README can reference it
  accurately).
- Existing CI conventions inspected (`.github/workflows/ci.yml`,
  `storefront-ci.yml`) to match this repo's established workflow shape
  (path-filtered triggers, `actions/checkout@v4`, one focused job).

## Approach chosen

1. Installed Flutter `3.47.5` stable (current stable release verified via
   `storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`,
   released 2026-09-18) into `/opt/flutter-sdk` — outside the repository,
   not committed; CI installs its own copy via `subosito/flutter-action`
   pinned to the identical version string, so the toolchain is reproducible
   without depending on this session's local install surviving.
2. `flutter create --project-name awj_mobile_runtime --org sa.nebrax
   --platforms=android,ios mobile` — Android + iOS only (no desktop/web
   platform folders), matching the horizon's mobile-only scope. Chose
   `sa.nebrax` as the reverse-domain org because no existing bundle-id/
   package-id convention exists anywhere in the repository (checked via
   grep for `com.nebrax`/`sa.nebrax`/bundle-id patterns — none found); it
   matches the GitHub org/repo (`safwan5001-source/Nebrax`) and product
   branding. Resulting identity: Android `sa.nebrax.awj_mobile_runtime`,
   iOS `sa.nebrax.awjMobileRuntime`. This is a durable identity per
   `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §20A ("do not regenerate
   identifiers on every build") — recorded here so no later task
   accidentally changes it.
3. Replaced the generated counter-demo app (`lib/main.dart`) with a
   minimal placeholder shell (`lib/app.dart`: `AwjMobileRuntimeApp` +
   `_RuntimeShellScreen`) — a single bilingual static screen, no state, no
   network. Kept deliberately small: App Schema rendering, the Commerce
   client, and real screens are separately-scoped later tasks
   (MOBILE-RUNTIME-2/3/4/5); building any of that now would be scope
   creep this task's own outcome does not require.
4. Set the shell's default text direction to RTL via a plain
   `Directionality` override in `MaterialApp.builder`, rather than pulling
   in the full `flutter_localizations` + ARB + language-switching stack
   now. Rationale: CLAUDE.md's "الواجهات RTL أولاً" is a project-wide
   non-negotiable that should hold from the very first screen, but full
   ar/en switching is MOBILE-RUNTIME-6's dedicated outcome — a one-line
   `Directionality` override satisfies the non-negotiable today without
   duplicating work task 6 will do properly.
5. Added `.github/workflows/mobile-ci.yml` mirroring the existing
   `storefront-ci.yml` shape (path-filtered on `mobile/**`, one job,
   `actions/checkout@v4` for consistency with every other workflow in this
   repo). Verified `subosito/flutter-action` (MIT license, current
   community-standard action, `flutter-version`+`channel`+`cache` inputs
   match its current documented usage) via `WebFetch` against its GitHub
   README rather than assuming stale prior knowledge, per the protocol's
   "verify current official documentation" research rule.
6. Wrote `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md`
   (MR-18): fixes the measurement method (Flutter's own
   `--trace-startup`/DevTools timeline tooling, cited from
   `docs.flutter.dev`) and provisional budgets now, explicitly records
   that this environment has no attached device/emulator so no real
   number is fabricated at this stage, and assigns MOBILE-RUNTIME-10 the
   obligation to measure for real.
7. Updated the three durable-state documents
   (`MASTER-EXECUTION-PLAN.md`, `TASK-QUEUE.md`, `CURRENT-STATE.md`) to
   close out the Commerce Mobile API readiness horizon's active-horizon
   pointer and open this horizon, linking to
   `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` rather than
   duplicating its task table, per 00-START-HERE's documentation rule.

## Why this approach fits AWJ

- MR-01/MR-02/MR-19 are satisfied directly: Flutter-first, isolated
  workspace at `mobile/`, no non-trivial dependency added without review.
- Nothing here touches `app/`, `database/`, `routes/`, or any accounting/
  tenant/RBAC code — this task cannot affect posted accounting, tenant
  isolation, or backward compatibility, because it introduces a brand-new,
  currently-inert client workspace with zero wiring into the PHP backend.
- The RTL default keeps faith with CLAUDE.md's non-negotiable rule from
  the first commit rather than deferring it silently.
- Documenting the performance method now (rather than inventing numbers
  post hoc at task 10) matches MR-18's explicit sequencing requirement.

## Changed files

```
mobile/                                  (new Flutter workspace — generated + edited files below)
mobile/lib/main.dart                     (edited — entry point calls AwjMobileRuntimeApp)
mobile/lib/app.dart                      (new — placeholder shell widget)
mobile/test/widget_test.dart             (edited — 2 tests: renders shell, defaults to RTL)
mobile/README.md                         (edited — workspace/toolchain/command documentation)
mobile/pubspec.yaml, pubspec.lock, analysis_options.yaml, android/**, ios/**  (generated by `flutter create`, unedited except pubspec description)
.github/workflows/mobile-ci.yml          (new)
docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md   (new)
docs/plans/mobile/MOBILE-RUNTIME-1-IMPLEMENTATION-REPORT.md    (new, this file)
docs/autonomous-engineering/MASTER-EXECUTION-PLAN.md  (edited — horizon pointer)
docs/autonomous-engineering/TASK-QUEUE.md             (edited — new authorized horizon section)
docs/autonomous-engineering/CURRENT-STATE.md          (edited — horizon switch + execution log)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 8.5s)

$ flutter test
00:00 +0: loading /home/user/Nebrax/mobile/test/widget_test.dart
00:00 +0: AwjMobileRuntimeApp boots to the runtime shell screen
00:00 +1: AwjMobileRuntimeApp defaults to RTL text direction
00:00 +2: All tests passed!
```

Run locally in this session's environment (Flutter 3.47.5 installed to
`/opt/flutter-sdk`, not part of the repository).

## Build / lint / typecheck

`flutter analyze` (above) is this task's lint/typecheck gate — Dart has no
separate typecheck step outside analysis. Release-mode build proof
(`flutter build apk --release`, `flutter build ios --release --no-codesign`)
is explicitly MOBILE-RUNTIME-9's (Gate G) outcome, not this task's; no build
was attempted here beyond what `flutter analyze`/`flutter test` require
internally (dependency resolution via `flutter pub get`).

## CI

Not yet observed on GitHub Actions at the time of writing this report —
`.github/workflows/mobile-ci.yml` is new in this same change set. Per Gate
9/Gate 7, this task's `PRE_MERGE_REVIEW: PASS` will not be recorded until
this workflow is observed green on the PR's exact final Head SHA.

## Pre-merge review

- PRE_MERGE_REVIEW: **pending** — recorded after CI is observed green on
  the exact PR head (see Gate 9). This report is updated in place once
  that happens; do not treat this section as final until it says PASS with
  a Head SHA.

## Merge

- Merge status: not yet opened/merged.

## Post-merge review

- POST_MERGE_REVIEW: not yet applicable.

## Self-review

### Implementer
Did I satisfy the actual outcome? Yes — "reproducible shell,
tests/analyze/build baseline" (horizon doc §8, row 1) is evidenced above.
Is there a simpler safe design? No — this is already the minimum
`flutter create` scaffold plus the smallest edits needed to (a) remove the
irrelevant counter demo and (b) satisfy the RTL non-negotiable. Did I reuse
existing AWJ authority instead of duplicating business logic? N/A — no
business logic exists in this task. Are failure states deliberate? N/A —
no runtime failure paths exist yet in a static placeholder shell.

### Reviewer
What would I reject if this PR came from another engineer? Two things I
checked specifically: (1) that `pubspec.lock` is committed (it is — apps
should lock, unlike libraries); (2) that the `.gitignore` files
`flutter create` generated actually exclude `.dart_tool/`, `build/`,
`.idea/`, `*.iml`, Android `local.properties`/keystores, and iOS
`Pods/`/`DerivedData/` (verified by reading each generated `.gitignore` and
confirming `git status --short` shows only `mobile/` as one untracked unit,
not hundreds of build artifacts). Is any code broader than the task? No —
`lib/app.dart` is ~40 lines, one widget, no premature abstraction for
schema/registry/client layers that don't exist yet. Are tests proving
behavior rather than implementation trivia? The two tests assert
user-visible outcomes (the shell text renders; the effective text
direction at that render point is RTL) rather than internal structure.
Did I accidentally change a public contract? No public contract exists yet
for this workspace.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — no network call, no
data access exists in this task. Can branch boundaries be bypassed? Not
applicable, same reason. Is any financial value computed with unsafe types
or client authority? No financial value is computed anywhere in this task.
Can authorization be bypassed by IDs/headers/host/schema input? Not
applicable — no schema/auth exists yet (MOBILE-RUNTIME-2/4). Is posted
accounting immutable? Untouched — this task does not import, reference, or
call any PHP/Laravel code. Could retries duplicate side effects? No side
effects exist. Could old clients/tenants break? No — this is a new,
currently-unshipped, unreferenced workspace; nothing in the existing
Laravel/Next.js applications imports or depends on `mobile/`. Are secrets/
PII exposed in logs/errors/artifacts? No secret material exists in this
task; the CI workflow contains no credentials.

## Accounting impact

None. No accounting code, journal entries, or financial computation exists
in this task's diff.

## Tenant / branch isolation impact

None. This task adds no network call, no data access, and no tenant-aware
code path. The Flutter workspace has no channel to the Laravel backend yet
(that begins in MOBILE-RUNTIME-4, behind the committed `/commerce/v1`
contract, server-resolved tenant as MR-03 requires).

## Security / authorization impact

None materially: no secrets, no auth, no network. The one thing worth
recording for future reviewers: `mobile/android/.gitignore` and
`mobile/ios/.gitignore` (both `flutter create` defaults, unedited) already
exclude keystores/certificates/`local.properties`, so no signing material
can land in this repository by accident as later tasks touch these
directories.

## Backward compatibility

Fully preserved — nothing in `app/`, `web/`, `storefront/`, `routes/`,
`database/`, or any existing CI workflow was modified. `mobile-ci.yml` is
additive and path-filtered, so it cannot affect any other workflow's
trigger/behavior.

## API / DB / migration impact

None. No API, database, or migration touched.

## External research used

- `https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`
  — confirmed `3.47.5` is the current Flutter stable release
  (released 2026-09-18, 4 days before this task).
- `https://github.com/subosito/flutter-action` (via `WebFetch`) — confirmed
  current documented usage (`channel`/`flutter-version`/`cache` inputs),
  MIT license, active maintenance, before pinning it in CI.
- `https://docs.flutter.dev/perf/app-startup`,
  `https://docs.flutter.dev/tools/devtools/performance`,
  `https://docs.flutter.dev/perf/rendering-performance`,
  `https://docs.flutter.dev/perf/app-size` — Flutter's own first-party
  performance-measurement tooling, cited in the MR-18 baseline document
  rather than inventing a measurement method from memory.

## Risks / remaining work

- No Android SDK, Chrome, or Linux GTK toolchain is installed in this
  session's local environment, so local builds/device runs are not
  possible here — only `flutter analyze`/`flutter test`/`flutter pub get`.
  Actual release-mode build proof (Gate G) must run in CI
  (`ubuntu-latest` for Android, `macos-latest` for iOS) at
  MOBILE-RUNTIME-9; this is expected sequencing, not a gap introduced by
  this task.
- CI has not yet been observed green on GitHub Actions for this exact
  diff — required before `PRE_MERGE_REVIEW: PASS` can be recorded (Gate
  9/Gate 7). This report will be updated once observed.

## Discovered backlog

None discovered beyond what the horizon document already scopes into
later tasks.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: (recorded once opened)
- Base SHA: `51a80685289aecdc7354ebcd8d1a32a2c92ac449` (`origin/main`, PR #947)
- Head SHA: (recorded once pushed)

## Recommended next dependency-ready task

`MOBILE-RUNTIME-2` (App Schema + compatibility kernel) — dependency-ready
only after this task's Post-Merge Review passes, per the protocol's
"dependency and merge rule."
