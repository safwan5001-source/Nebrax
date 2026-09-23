# AWJ Mobile Runtime — Performance Measurement Method + Provisional Baseline (MR-18)

**Status:** Method/budgets established at MOBILE-RUNTIME-1 (§1-6, unchanged,
still provisional). Device-independent metrics measured at MOBILE-RUNTIME-10
(§7.1); device-backed metrics explicitly not measurable in this environment
(§7.2) — see §7 for the full result.
**Parent:** `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4 MR-18.

## 1. Why this exists now

MR-18 requires that MOBILE-RUNTIME-1 fix the measurement *method* and
provisional *budgets* before any optimization work happens, so later tasks
have a fixed target to measure against rather than inventing one after the
fact. MOBILE-RUNTIME-10 reports actual measured numbers against this
document and records regressions.

"Runs successfully" is not proof of performance. Every number below must be
reproducible from a documented command, not eyeballed.

## 2. Environment constraint — evidence, not a workaround

This horizon executes in a headless Linux CI/dev container with no attached
Android emulator, iOS simulator, or physical device. Flutter's own
recommended timeline/profiling tooling (`flutter run --profile
--trace-startup`, DevTools timeline) requires a running app on a device or
emulator to produce `start_up_info.json`. Where a task cannot attach a real
device/emulator, it must say so explicitly rather than fabricate a number.
Device/emulator-dependent measurements are deferred to MOBILE-RUNTIME-10 and
recorded there as either real measurements (if a device/emulator becomes
available through CI, e.g. `reactivecircus/android-emulator-runner` or an
Xcode Simulator on a `macos-latest` runner) or an explicit known-limitation
with the reason no device-backed measurement was possible.

External evidence for the measurement method itself:
- https://docs.flutter.dev/perf/app-startup — `flutter run --profile --trace-startup` writes `start_up_info.json` with `timeToFirstFrameMicros` and related timings; this is Flutter's own first-party startup measurement mechanism.
- https://docs.flutter.dev/tools/devtools/performance — DevTools Performance view / timeline for frame-by-frame jank inspection.
- https://docs.flutter.dev/perf/rendering-performance — jank/frame-budget guidance (16.67ms budget at 60Hz, 8.33ms at 120Hz).

## 3. Measurement method (fixed now)

| Metric | Method | Source |
|---|---|---|
| Cold startup | `flutter run --profile --trace-startup`, read `timeToFirstFrameMicros` from the generated `build/start_up_info.json` | docs.flutter.dev/perf/app-startup |
| Warm startup (resume from background) | Manual/instrumented timestamp: app-lifecycle `resumed` event to next rendered frame (`WidgetsBindingObserver` + a single debug-only frame-callback timestamp, stripped from release builds) | Flutter `WidgetsBindingObserver.didChangeAppLifecycleState` |
| First meaningful runtime render | Time from `runApp()` call to the first frame that renders real App-Schema-driven content (not a loading spinner) — instrumented via a `Timeline.timeSync`/`dart:developer` event pair, inspected in DevTools timeline | docs.flutter.dev/tools/devtools/performance |
| Schema parse/validate/render path | Wall-clock `Stopwatch` around the schema-kernel's `parse()` → `validate()` → first `render()` call (introduced in MOBILE-RUNTIME-2/3), logged only in debug/profile builds | Internal instrumentation |
| Product-list scroll / image loading | DevTools Performance timeline while scrolling a representative product list (frame build+raster time per frame; target 16.67ms budget) | docs.flutter.dev/perf/rendering-performance |
| Memory/jank observations | DevTools Memory view snapshot + "janky frames" count from the Performance view during the scroll scenario above | DevTools |
| Release artifact/binary size | `flutter build apk --analyze-size` / `flutter build ios --analyze-size --no-codesign` (writes a size breakdown); plain artifact byte size from CI build output as a fallback when `--analyze-size` needs a device-profile that CI lacks | https://docs.flutter.dev/perf/app-size |

## 4. Provisional budgets (targets, not yet measured)

These are provisional, conservative budgets consistent with general Flutter
guidance for a commerce list/detail/cart app on a mid-range device profile.
They are **not** derived from an AWJ-specific device fleet (no telemetry
exists yet — this is a proof horizon, not a production fleet). MOBILE-
RUNTIME-10 must state whether each was met, missed, or not measurable in
this environment, and must not silently redefine a budget to make a result
look passing.

| Metric | Provisional budget | Rationale |
|---|---|---|
| Cold startup (`timeToFirstFrameMicros`) | ≤ 2500 ms on a mid-range profile/emulator | Conservative; Flutter's own startup guidance treats multi-second cold start as a problem worth the dedicated `perf/app-startup` doc |
| Warm/resume startup | ≤ 700 ms | Resume should not re-pay full cold-start cost |
| First meaningful render (post-splash, real content) | ≤ 1500 ms after `runApp()` on a compatible network/schema fetch | Bounded by network + schema parse, not just widget build |
| Frame build+raster (product list scroll) | ≤ 16.67 ms/frame (60Hz budget); flag any run with >5% janky frames | docs.flutter.dev/perf/rendering-performance |
| Android release APK size (this proof's scope, not a full commerce catalog) | ≤ 40 MB uncompressed app size at MOBILE-RUNTIME-9 baseline; re-baseline once Home/Product/Cart (task 5) and images land | Provisional starting point for a minimal-dependency shell; will be revisited once real screens exist |
| iOS release IPA size (unsigned archive) | ≤ 50 MB at MOBILE-RUNTIME-9 baseline | Same caveat as above |

## 5. MOBILE-RUNTIME-1 baseline snapshot (shell only, no device)

No device/emulator was available in this environment at MOBILE-RUNTIME-1.
The only measurements possible at this stage are static, device-independent
facts about the shell as committed:

- `flutter analyze`: 0 issues.
- `flutter test`: 2/2 passing, wall time ~1–2s in CI (not a performance
  metric — recorded only as evidence the harness itself is fast enough not
  to distort later measurements).
- The shell has zero network calls, zero App Schema parsing, and a single
  static screen — so cold-start/first-render numbers measured against it
  would not be representative of the real proof (Home/Product/Cart, task
  5) and are deliberately not fabricated here.

MOBILE-RUNTIME-10 is the task obligated to produce real measured numbers
against the budgets in §4, using a device/emulator obtained at that point
(CI-hosted Android emulator and/or iOS Simulator on `macos-latest`, or
explicit documentation of why one could not be obtained), and to report
release artifact sizes from the MOBILE-RUNTIME-9 build outputs.

## 6. Non-goals

This document does not set SLAs for production traffic, does not commit to
a specific device matrix, and does not authorize skipping correctness,
accessibility or security work to hit a budget (per the horizon's own
MR-18: "Do not optimize by weakening correctness, accessibility, security or
image fidelity without an explicit tradeoff").

## 7. MOBILE-RUNTIME-10 measured results

**Owner decision recorded for this section** (2026-09-23, preserved from
this task's handoff): "Document the limitation, measure what's
device-independent." Every number below is real and reproducible from the
commands cited — nothing is estimated, interpolated, or "converted" from a
different metric. Every metric this environment cannot genuinely measure is
recorded as **NOT MEASURED** with the exact reason, never a guess.

### 7.1 Measured — device-independent

| Metric | Method | Result |
|---|---|---|
| Schema parse+resolve (Home) | `Stopwatch` around `AppSchema.parse` + `CompatibilityResolver.resolve`, 500 iterations after 20-run warmup, `flutter test test/performance/schema_performance_test.dart` | n=500, median 94µs, p90 215µs, max 2228µs, mean 135.6µs |
| Schema parse+resolve (Cart) | same method | n=500, median 28µs, p90 67µs, max 678µs, mean 40.5µs |
| Schema parse only (Home, isolates parse from resolve) | same method | n=500, median 13µs, p90 19µs, max 531µs |
| Headless widget-tree render, cold (first pump in a fresh `flutter test` isolate — includes this process's one-time engine/binding init, not repeated per real app launch) | `Stopwatch` around `tester.pumpWidget`/`pumpAndSettle` of `ExperienceView` for the resolved Home page, `flutter test` | 511,978µs (single sample) |
| Headless widget-tree render, warm (second pump of the identical tree in the same isolate — isolates steady-state rebuild/layout/paint from one-time init) | same method | 1,628µs (single sample) |
| `flutter analyze` | `flutter analyze` | 0 issues |
| `flutter test` (full suite, harness speed sanity only, not a performance metric) | `flutter test` | 251/251 passing, ~11–12s wall time in this environment |
| Android release artifact size | `flutter build apk --release` + `flutter build appbundle --release` (`mobile-ci.yml`'s `android-release-build` job, `ubuntu-latest`) | see this task's implementation report for the exact byte sizes from this PR's own CI run |
| iOS release artifact size (unsigned) | `flutter build ios --release --no-codesign` (`mobile-ci.yml`'s `ios-release-build` job, `macos-latest`) | see this task's implementation report for the exact byte size from this PR's own CI run |

The widget-tree render numbers are an explicit **proxy**, not a
first-meaningful-render measurement: `flutter test` runs against
`AutomatedTestWidgetsFlutterBinding` on the Dart VM host, not a real device
GPU/raster pipeline, and there is no network fetch or real image decode in
this scenario (`ExperienceView` renders an already-resolved in-memory tree
with no product images). It is genuinely useful as a headless, reproducible,
device-independent signal for "did this change make rendering the schema
tree dramatically slower" — it is not comparable to §4's
first-meaningful-render budget and this section does not claim it satisfies
that budget.

### 7.2 NOT MEASURED — requires a real device/emulator/simulator

| Metric | Why NOT MEASURED |
|---|---|
| Cold startup `timeToFirstFrameMicros` (`flutter run --profile --trace-startup`) | Requires a running app on an attached Android emulator, iOS Simulator, or physical device. This task's authoring environment is a headless Linux container with no display server, no Android SDK/AVD, and no Xcode/iOS Simulator. |
| Warm/resume startup wall-clock | Same reason — requires a running, backgroundable app instance on a device/emulator to actually measure a lifecycle-driven resume, not just unit-test a lifecycle *callback* (which MR-16's `lifecycle_resume_test.dart` does prove, as a decision-mechanism test — see this task's implementation report). |
| First meaningful runtime render (device-measured, with real network/image decode) | Same reason; §7.1's headless widget-test number is a proxy, not this metric. |
| Product-list scroll / image loading frame timing | Same reason — DevTools' Performance timeline requires a running device/emulator session. |
| Memory/jank observations (DevTools Memory view, janky-frame count) | Same reason. |

`mobile-ci.yml`'s two release-build jobs (`android-release-build` on
`ubuntu-latest`, `ios-release-build` on `macos-latest`) build the app but do
not boot an emulator/Simulator or launch it — they prove Gate G
(buildability), not runtime performance. Per explicit owner instruction,
this task does **not** add emulator/Simulator CI infrastructure (e.g.
`reactivecircus/android-emulator-runner`, an Xcode Simulator boot step) to
obtain these numbers — that is deferred to whichever future task actually
needs device-backed measurement, with its own cost/maintenance review, not
bundled into this horizon's final proof task.

None of the budgets in §4 that require a device are marked "met" or
"missed" — they are marked **not measurable in this environment**, per this
document's own §2 instruction not to fabricate a number.
