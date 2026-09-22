# AWJ Mobile Runtime — `mobile/`

This workspace is the **AWJ Mobile Runtime Proof Horizon V1** deliverable
(`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md`), executed under
نظام الأفق (`docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`).

It proves that AWJ can run a trusted, native mobile commerce runtime on iOS
and Android that consumes the completed `/commerce/v1` boundary. It is a
**runtime proof**, not the App Builder editor, not the App Factory
build/release/signing system, and not a production store release.

## Isolation boundary

`mobile/` is a self-contained Flutter workspace. It does not share code with
`web/` (Next.js merchant/admin UI) or `storefront/` (Next.js customer
storefront). It consumes AWJ Commerce exclusively through the committed
`/commerce/v1` OpenAPI contract (`docs/openapi/commerce-api-v1.yaml`) — no
parallel pricing/stock/payment/shipping/tenant/order logic is implemented in
Dart. See `CLAUDE.md` and the horizon document's "Non-negotiable boundaries"
for the full list of hard constraints this workspace must never cross.

## Toolchain

- **Flutter:** `3.47.5` (stable channel). Pin CI to this exact version via
  `subosito/flutter-action`'s `flutter-version: 3.47.5`; do not float to
  `stable` unpinned, so a CI run is reproducible independent of when it runs.
- **Dart SDK:** `3.13.4` (bundled with the pinned Flutter release —
  `pubspec.yaml`'s `environment.sdk: ^3.13.4` constraint follows it).
- **Platforms targeted:** `android`, `ios` only (`flutter create
  --platforms=android,ios`). No desktop/web platform folders are generated —
  this proof is mobile-only per the horizon's scope.
- **Dependency pinning:** `pubspec.lock` is committed (standard Dart/Flutter
  practice for applications, not libraries) so `flutter pub get` resolves
  identically in CI and locally.

## Commands

Run all commands from this directory (`mobile/`):

```bash
flutter pub get      # resolve dependencies from the committed lockfile
flutter analyze       # static analysis — must report "No issues found!"
flutter test           # widget/unit tests — must report "All tests passed!"
flutter build apk --release          # Android release build (Gate G, task 9)
flutter build ios --release --no-codesign   # iOS release build, unsigned (Gate G, task 9)
```

CI runs `pub get` + `analyze` + `test` on every push/PR touching `mobile/**`
(`.github/workflows/mobile-ci.yml`). Release-mode build jobs are added in
MOBILE-RUNTIME-9 once there is a runtime worth building.

## Current state (MOBILE-RUNTIME-1)

This task only proves the workspace itself: a reproducible shell that
analyzes and tests cleanly, with pinned toolchain and CI. It intentionally
does **not** yet include:

- App Schema parsing/rendering (MOBILE-RUNTIME-2/3);
- any Commerce API call (MOBILE-RUNTIME-4);
- Home/Product/Cart screens (MOBILE-RUNTIME-5);
- ar/en language switching — the shell defaults to Arabic + RTL via a plain
  `Directionality` override per AWJ's project-wide "RTL أولاً" rule, but the
  full `flutter_localizations` delegate stack lands in MOBILE-RUNTIME-6;
- deep links, push, or native release builds (MOBILE-RUNTIME-7/8/9).

`lib/app.dart` holds the single placeholder shell screen; `lib/main.dart` is
the entry point. Later tasks build inside `lib/` following the App
Schema → Component/Action Registry → Commerce client → screens layering
from the horizon document rather than restructuring this shell.

## Dependencies

No non-trivial dependency has been added yet. `cupertino_icons` (iOS-style
icon font, MIT-compatible, first-party Flutter team package) and
`flutter_lints` (dev-only static analysis rule set, BSD-3-Clause,
first-party Dart team package) are the stock `flutter create` defaults and
carry no license/maintenance/security review burden per MR-19 (trivial,
official, dev-time-only or icon-font packages). Every future non-trivial
package addition records its own license/maintenance/security review in the
task's implementation report before being pinned in `pubspec.yaml`.

## Performance measurement

Method and provisional budgets/baselines are documented in
`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md` (MR-18).
MOBILE-RUNTIME-10 reports measured results against this baseline.
