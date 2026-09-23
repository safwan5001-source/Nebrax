# MOBILE-RUNTIME-9 — Implementation Report

STATUS: in progress (CI pending — this task's own CI run is the first real
build-proof evidence; see "CI" below)
DATE: 2026-09-23

## Outcome

`.github/workflows/mobile-ci.yml` gains two new jobs proving horizon
MR-12/Gate G's release-mode buildability requirement, alongside the
existing `check` (analyze+test) job:

- **`android-release-build`** (`ubuntu-latest`, same runner as `check`):
  `flutter build apk --release` and `flutter build appbundle --release`.
  Both use the stock `flutter create` template's release `signingConfig`
  (`android/app/build.gradle.kts` reuses the **debug** keystore for the
  release build type — its own pre-existing comment says so), which is
  exactly the Definition of Done's "release-mode build proof... within
  available non-production credentials": a real Release-configuration
  build, never a production/store signing key.
- **`ios-release-build`** (`macos-latest` — this repository's mobile CI
  had no macOS runner before this task): `flutter build ios --release
  --no-codesign`. This is Gate G's "maximum non-signing level available":
  a real Release-configuration `Runner.app` for a device architecture,
  with the entire code-signing step skipped — no Apple Developer account,
  certificate, or provisioning profile is required, used, or even
  present anywhere in this repository.

Both new jobs upload their build output as a CI artifact (14-day
retention) so MOBILE-RUNTIME-10 (MR-18, "release artifact/binary size
recorded") can measure real sizes without re-running either build —
this task's own job is buildability proof, not the size measurement
itself.

`mobile/README.md`'s Commands section already anticipated both exact
commands back in MOBILE-RUNTIME-1 (`flutter build apk --release` /
`flutter build ios --release --no-codesign`, both already labeled "Gate
G, task 9") — this task executes that plan rather than inventing a new
one. Its "release-mode build jobs are added in MOBILE-RUNTIME-9" note is
updated to describe what now actually exists.

No Dart/Kotlin/Swift source file changed — this is a CI-workflow and
documentation task only. No new Flutter/native dependency (no MR-19
review needed: no package was added, only two new CI jobs using
first-party `flutter build`/`actions/upload-artifact`).

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence read before starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` read for
  MR-12 ("Horizon must prove release-mode buildability for both Android
  and iOS as far as available CI/tooling permits. A successful local/
  simulator debug run alone is insufficient. Store signing, merchant
  certificates, App Store/Play submission and production release are
  outside this horizon and remain owner-gated."), Gate G ("Android
  release build; iOS release/archive build to the maximum non-signing
  level available; no production signing/release required; build
  instructions reproducible."), and §9 Definition of Done's exact
  wording ("Android and iOS release-mode build proof exists within
  available non-production credentials").
- `mobile/README.md` read in full: its "Commands" section had already
  recorded the exact two build commands this task should run, each
  labeled `(Gate G, task 9)` — written back in MOBILE-RUNTIME-1, before
  any of this task's own work began. This task's job was to make those
  commands actually run somewhere real, not to decide what they should
  be.
- `mobile/android/app/build.gradle.kts` read in full: confirmed the
  release `buildTypes` block already reuses `signingConfigs.getByName
  ("debug")` (the stock `flutter create` template's own choice, with its
  own `// TODO: Add your own signing config for the release build`
  comment) — this is what makes `flutter build apk --release` work at
  all without a production keystore, and is exactly the "non-production
  credentials" the Definition of Done anticipates. No change was needed
  to this file.
- `.github/workflows/mobile-ci.yml` read in full: its own header comment
  already said "Release-build jobs (Android/iOS) are added in
  MOBILE-RUNTIME-9 once there is a runtime worth building" — this task
  is that promised addition, on the existing `check` job's exact
  Flutter-setup pattern (`subosito/flutter-action@v2` pinned to
  `3.47.5`), not a new/different toolchain-setup mechanism.
- This session's own environment checked directly: `uname -a` confirms
  Linux; `flutter doctor -v` reports `[✗] Android toolchain - Unable to
  locate Android SDK`; there is no Xcode on Linux at all. **Neither
  release build can be attempted locally in this session** — this is
  the first MOBILE-RUNTIME task where the *only* available verification
  path is CI itself, not a local `flutter build` run before pushing.
  This is stated plainly rather than glossed over: unlike MOBILE-RUNTIME-
  7/8's native Kotlin/Swift code (written carefully but genuinely never
  compiled anywhere in this horizon until now), this task's new CI jobs
  themselves *are* the compile step — a red `android-release-build` or
  `ios-release-build` check on this PR is a real, actionable signal to
  fix, not an acknowledged-and-accepted gap.
- GitHub-hosted runner images were relied on for two facts that could not
  be verified locally in this session, both standard, long-documented
  properties of GitHub's own `ubuntu-latest`/`macos-latest` images: (1)
  `ubuntu-latest` ships a preinstalled Android SDK (`ANDROID_HOME`/
  `ANDROID_SDK_ROOT` already set, common platform/build-tools versions
  present) — the same runner the existing `check` job already uses
  successfully for `flutter test`'s Android-adjacent tooling; (2)
  `macos-latest` ships Xcode and CocoaPods preinstalled, which
  `flutter build ios` needs internally (it runs `pod install` itself
  when `ios/Podfile` exists, which it already does since MOBILE-RUNTIME-1).
  If either assumption is wrong, this PR's own CI will show it directly.

## Approach chosen

1. **Reuse the exact commands MOBILE-RUNTIME-1 already committed to
   `README.md`, not new ones.** `flutter build apk --release` /
   `flutter build ios --release --no-codesign` were chosen 8 tasks ago
   specifically for this task — re-deriving them from scratch risked
   silently drifting from that already-reviewed plan.
2. **New jobs, not new steps on `check`.** `android-release-build` and
   `ios-release-build` are separate jobs (not additional steps inside
   `check`) so: a release-build failure is individually attributable in
   the PR checks list rather than hidden inside a job whose name says
   "analyze + test"; the iOS job can run on a different runner OS
   (`macos-latest`) than the other two (`ubuntu-latest`); and a slow
   release build never blocks the fast `flutter analyze`/`flutter test`
   feedback loop `check` exists to give — all three run in parallel.
3. **No signing infrastructure invented.** The Android job uses exactly
   the debug-signing config `flutter create` shipped with this project
   from MOBILE-RUNTIME-1 — no keystore was generated, no secret was
   added to repository/CI settings. The iOS job never touches signing at
   all (`--no-codesign` skips the step entirely) — no Apple Developer
   account, certificate, provisioning profile, or `ExportOptions.plist`
   exists anywhere in this diff. This is a deliberate reading of Gate
   G's "no production signing/release required": *required* is read as
   "not needed for this task to pass," not "permitted if convenient" —
   inventing even a throwaway signing setup would be scope creep this
   task's own bar does not ask for.
4. **Build artifacts preserved for MOBILE-RUNTIME-10, not measured here.**
   MR-18 assigns "release artifact/binary size recorded" to
   MOBILE-RUNTIME-10 explicitly ("MOBILE-RUNTIME-10 must report measured
   results and regressions"). This task uploads the APK/AAB/`Runner.app`
   as CI artifacts (14-day retention) so that task can measure real
   sizes without re-running either build, but does not itself compute or
   record a size number — that would be reaching into a later task's
   own scope.
5. **`mobile-ci.yml`'s existing path filter needed no change.** The
   workflow already triggers only on `mobile/**` (and its own file's)
   changes; the two new jobs inherit that scope automatically — no
   per-job `paths` filter was needed or added.

## Why this approach fits AWJ

- MR-12/Gate G satisfied to the letter once CI confirms both jobs green:
  release-mode buildability for both platforms, no production signing
  required, build instructions reproducible (documented in
  `mobile/README.md`'s Commands section, unchanged commands, just now
  actually exercised somewhere).
- Horizon boundary "no production deploy/release; no App Store/Google
  Play submission; no merchant signing/account ownership change" is
  respected structurally: nothing in this diff builds a signed `.ipa`,
  registers with Apple/Google, or touches any store-facing credential.
- MR-19 is not triggered: no new Flutter package, no new native
  dependency — only CI job definitions using tooling (`flutter build`,
  `actions/upload-artifact`) already present or first-party.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.
- Zero touch on any Dart/Kotlin/Swift source file — this task is
  infrastructure/documentation only, so it carries no risk to any
  previously-proven behavior (MOBILE-RUNTIME-1–8's own tests are
  unaffected and continue to pass, confirmed below).

## Changed files

```
.github/workflows/mobile-ci.yml   (new android-release-build/ios-release-build jobs + artifact upload)
mobile/README.md                  (Commands section note updated to describe what now exists)
docs/plans/mobile/MOBILE-RUNTIME-9-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 6.3s)

$ flutter test
...
00:10 +190: All tests passed!
```

190/190 tests still passing, 0 analyze issues — unchanged from
MOBILE-RUNTIME-8, since this task touches no Dart source. This is the
expected/correct result for a CI-workflow-only task, not evidence this
task's own release-build proof (which only CI itself can produce — see
below).

## Build / lint / typecheck

`flutter analyze` (above, 0 issues). YAML syntax of the updated
`mobile-ci.yml` validated locally (`python3 -c "import yaml;
yaml.safe_load(...)"`, parses cleanly, both new job keys present).
**Neither release build itself could be run in this session** — no
Android SDK, no Xcode on this Linux environment (see "Repository
evidence" above). This PR's own CI run against `android-release-build`/
`ios-release-build` is therefore this task's actual build-proof
evidence, not a local re-run.

## CI

_Pending — this PR's CI run against the two new jobs is the first real
compile-time verification either has ever had. Recorded here once
`android-release-build` and `ios-release-build` (plus the existing
`check` and `ci.yml` sqlite/pgsql jobs) all report `conclusion:success`
on the exact reviewed head._

## Pre-merge review

_Pending._

## Merge

_Pending._

## Post-merge review

_Pending._

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-9's outcome ("reproducible native build
evidence") and MR-12/Gate G's exact bullets? "Release-mode buildability
proof for both Android and iOS as far as available CI/tooling permits"
— pending this PR's own CI, the honest answer until it reports green.
"A successful local/simulator debug run alone is insufficient" — not
attempted; both jobs build in `--release` mode specifically. "No
production signing/release required" ✓ (neither job touches signing
infrastructure at all beyond the pre-existing stock debug key). "Build
instructions reproducible" ✓ (`mobile/README.md`'s Commands section,
unchanged wording, matches exactly what CI runs). Did I reuse existing
authority instead of duplicating? Yes — same Flutter-setup action/pin
version as `check`, same working-directory convention, no new
toolchain-installation mechanism invented.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that the Android job's signing story is exactly the
pre-existing stock debug key, not a newly-generated keystore or a
secret added to repository/CI settings — confirmed by reading
`android/app/build.gradle.kts`'s unchanged `buildTypes.release` block;
(2) that the iOS job genuinely never touches signing — `--no-codesign`
is the flag, and no `ExportOptions.plist`/provisioning profile/
certificate file was added anywhere in this diff; (3) that no `mobile/**`
Dart/Kotlin/Swift source file changed at all, so this task carries zero
behavioral risk to MOBILE-RUNTIME-1–8's own proven code; (4) that the
new jobs are genuinely gated by the same `mobile/**` path filter as
`check` (no per-job override that could widen or narrow the trigger
unexpectedly). Is any code broader than the task? No signing setup, no
App Store/Play Console configuration, no deployment step — this task
stops exactly at "does it build." Are the artifact-upload additions
scope creep? No — they store this task's own build output for a
different task's explicit, already-planned use (MR-18/MOBILE-RUNTIME-10),
without measuring anything here.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — this task touches no
runtime code path at all, only CI/build tooling. Is any financial value
computed with unsafe types or client authority? No — this task computes
nothing. Can authorization be bypassed? No — no auth-adjacent code
touched. Could this task's changes leak a secret? No production signing
material exists anywhere in this diff to leak; the debug keystore
`flutter create` ships with every Flutter project is not a secret (it is
committed to every Flutter git repository by convention and is
explicitly documented by Google as unsuitable for production use — its
entire purpose is being public/shared). No API token, certificate, or
provisioning profile was added to this repository or to GitHub Actions
secrets. Are secrets/PII exposed? None — this task adds no logging,
telemetry, or data path of any kind.

## Accounting impact

None — this task adds no financial operation of any kind; it is a CI
workflow and documentation change only.

## Tenant / branch isolation impact

None — no runtime/tenant code touched.

## Security / authorization impact

Neutral-to-positive: no new signing credential, secret, or trust
relationship is introduced anywhere. The Android release build's
debug-signing posture is unchanged from what `flutter create` shipped in
MOBILE-RUNTIME-1 (not weakened, not strengthened, just now actually
exercised in CI); the iOS build has no signing posture at all
(`--no-codesign`), which cannot itself be a security regression since
there is no signing to compromise.

## Backward compatibility

`check`'s existing behavior (name, steps, trigger) is completely
unchanged — the two new jobs are additive siblings. No existing job, no
existing step order, no existing env var was modified.

## API / DB / migration impact

None — no server-side file touched, no mobile source file touched;
CI-workflow and documentation only.

## External research used

None new beyond what MOBILE-RUNTIME-1 already established
(`flutter build apk`/`flutter build ios --no-codesign` as the two
Gate-G-satisfying commands, already documented in `mobile/README.md`
before this task began) and what is standard, widely-documented
GitHub Actions runner-image behavior (`ubuntu-latest` ships an Android
SDK; `macos-latest` ships Xcode/CocoaPods) relied on because this
session's own Linux environment could not verify either toolchain
locally.

## Risks / remaining work

- **This task's actual pass/fail evidence is entirely CI-dependent** —
  unlike every prior MOBILE-RUNTIME task, there is no local fallback
  verification. If either new job fails, it must be genuinely debugged
  (not merely "acknowledged" the way MOBILE-RUNTIME-7/8's un-compiled
  native code was) before this PR can honestly claim Gate G is
  satisfied — a red build-proof job blocks merge exactly like a red
  `ci.yml`/`check` job would.
- **Neither built artifact has been installed on a real or simulated
  device.** Gate G asks for buildability, not installability/runtime
  proof on a device — that bar (MR-16 lifecycle, Gate H final runtime
  evidence) belongs to MOBILE-RUNTIME-10, which this task's uploaded
  artifacts are positioned to help with (a real APK/`Runner.app` to
  install, not something that must be rebuilt first).
- **iOS runner/Xcode version is whatever `macos-latest` currently
  resolves to** — not pinned to a specific Xcode version. If a future
  `macos-latest` image change breaks the build, that surfaces as a CI
  failure on a later, unrelated PR rather than this one; pinning a
  specific Xcode version was considered and deliberately not done,
  since GitHub's own `macos-latest` label already tracks a supported,
  Flutter-compatible default and over-pinning risks staleness for no
  benefit this task's own bar requires.

## Discovered backlog

- MOBILE-RUNTIME-10 can now download this task's uploaded
  `android-release-build`/`ios-release-build` CI artifacts directly to
  measure real release artifact sizes against MR-18's provisional
  budgets, rather than needing its own build step.
- The production Android Application ID / iOS Bundle ID Decision Gate
  (`mobile/README.md`'s own section, open since MOBILE-RUNTIME-1) remains
  unresolved — this task's builds still use
  `com.example.awjmobileruntimeproof`, correctly, since resolving that
  identity is Safwan's decision, not something a release-build-proof
  task should invent.

## Continuation-mechanism follow-up

`subscribe_pr_activity` + `send_later` continue to be used as the
primary/fallback continuation strategy for this task's CI wait, per the
standing horizon instruction (no `ScheduleWakeup`). This task's CI wait
is expected to run longer than prior tasks' `check`-only wait, since two
new, previously-never-executed release-build jobs (one on a `macos-latest`
runner, historically slower to schedule/run than `ubuntu-latest`) are
added to the same PR.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- Base SHA: `3a3650bbf786fd1475a5e9731f037fa6f7d8087a` (`origin/main`, PR #963)
- Head SHA: _pending push_
- PR: _pending_

## Recommended next dependency-ready task

`MOBILE-RUNTIME-10` (Final compatibility/security/performance/runtime
evidence + horizon closure report) — depends on 9 (this task) per the
horizon's dependency table (§8 row 10); becomes dependency-ready once
this task's Post-Merge Review passes.
