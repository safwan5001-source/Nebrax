# MOBILE-PREVIEW-9 — Claude Code Task

## Goal

Close the **AWJ App Builder — Real Mobile Preview Horizon** truthfully and durably.

This task is primarily a **closure / exit-criteria / owner-decision** pass over MOBILE-PREVIEW-1…8. It must not manufacture “Horizon complete” if the required real-device evidence is still absent.

The Horizon exit criterion that remains materially open after MP-8 is:

> real Android and iOS device verification is recorded.

MP-8 also surfaced two operational/product gates that affect whether that proof can be executed honestly:

1. mobile build-flavor / package separation for the preview entry point;
2. real preview host + Universal/App Link association infrastructure.

MP-9 must resolve the closure status from evidence, not from intent.

---

## Start

- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Baseline at task creation:
  `7dcdb3d63b6faeb2513938cfc44c5cb2cf14a340`
- Verify and report the exact Base SHA before doing anything else.

Do not broadly rediscover the repository.

---

## Read first

- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-6-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-7-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-8-INTEGRATED-PROOF-REPORT.md`
- `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md`

Inspect implementation only where needed to verify closure claims.

---

## Non-negotiable evidence rule

Use these evidence classes consistently:

- **CODE** — source inspection proves the implementation exists.
- **TEST** — automated test executed successfully.
- **CI** — GitHub CI result on the relevant merged/final implementation.
- **OPERATIONAL** — deployed host/domain/association/routing evidence.
- **REAL-DEVICE** — actual Android/iOS device or emulator/simulator execution.
- **OWNER-DECISION** — explicit Safwan approval for a Decision Gate.
- **DEFERRED** — intentionally out of this Horizon.

Never upgrade CODE/TEST/CI evidence into REAL-DEVICE or OPERATIONAL evidence.

Never state “Horizon closed / complete” unless every mandatory exit criterion is actually satisfied.

---

## 1. Task / PR ledger

Build a durable ledger for MOBILE-PREVIEW-1 through MOBILE-PREVIEW-8.

For each task record:

- task name;
- PR;
- Base SHA;
- final Head SHA if available;
- Merge SHA;
- implementation/report artifact;
- main deliverable;
- relevant tests;
- CI status;
- Decision Gates triggered;
- unresolved items carried forward.

Use Git history / PR evidence, not memory alone.

Do not alter previous reports merely to normalize formatting.

---

## 2. Exit-criteria audit

Evaluate every criterion from the Horizon’s **Exit criteria** section individually.

Required output format:

| Criterion | Evidence | Status |
|---|---|---|
| ... | CODE / TEST / CI / OPERATIONAL / REAL-DEVICE | PASS / OPEN / DEFERRED-BY-SCOPE |

For criteria 1–9 and 11–12, cite the concrete merged implementation/test/report evidence.

For criterion 10:

> real Android and iOS device verification is recorded

The status may be **PASS only with actual execution evidence**.

Source inspection, Flutter unit/widget tests, release build proofs, or “should work” do not satisfy this criterion.

---

## 3. Build-flavor / packaging Decision Gate

MP-8 identified the current shared native target/package limitation.

Before changing any Android `applicationId`, iOS bundle ID, Flutter flavor, native target, signing setting, scheme, or product packaging:

### First produce an owner decision packet

Document:

- exact current Android applicationId/package behavior;
- exact current iOS bundle ID / target behavior;
- how `main.dart`, `main_preview.dart`, and `main_device_preview.dart` are launched today;
- whether a developer can run the device-preview entry point without changing package identity;
- whether production runtime and preview runtime must coexist side-by-side on one device to execute the required proof;
- smallest viable alternatives.

At minimum compare:

**Option A — temporary/manual entry-point execution**
- no durable flavor/package redesign;
- use existing project identity;
- suitable only if it can prove the required matrix honestly.

**Option B — dedicated test-only preview flavor**
- separate Android `applicationIdSuffix`;
- separate iOS bundle identifier / scheme as needed;
- no App Store/Play distribution;
- must remain additive and non-production.

**Option C — defer physical-device coexistence**
- closure status remains OPEN/PARTIAL;
- do not claim Horizon completion.

### STOP for Safwan if implementation of Option B or any equivalent packaging change is required.

Do not choose on the owner’s behalf.

---

## 4. Preview domain / association Decision Gate

MP-8 confirmed the preview host is still a reserved `.example` placeholder and no real association deployment exists.

Before any DNS, HTTPS hosting, `apple-app-site-association`, `assetlinks.json`, certificate fingerprint, reverse-proxy/CDN, or public fallback deployment:

Produce an owner decision packet containing:

- proposed real preview hostname pattern;
- hosting target options already compatible with AWJ infrastructure;
- required HTTPS routing;
- AASA requirements;
- Android assetlinks requirements;
- certificate/signing dependency;
- fallback-page requirements;
- access-log redaction requirements;
- `Referrer-Policy`;
- analytics/telemetry prohibition for reference-bearing fallback URLs;
- rollback / disable plan.

### STOP before any real DNS/hosting/association deployment unless Safwan explicitly approves it.

No Production change is authorized by this task alone.

---

## 5. URL/reference security closure

Reconfirm the MP-8 conclusion without redesign:

- QR/deep link carries a one-time exchange reference, not a PreviewSession bearer;
- reference remains 5-minute TTL;
- hash-only persistence;
- atomic one-time consume;
- no raw reference in first-party application/audit logs;
- no merchant/admin/store bearer forwarding.

Carry the operational P2 forward explicitly:

> once a real preview host exists, proxy/CDN access logs and browser fallback must not leak the final reference path segment.

Minimum future host controls:

- no analytics on fallback;
- no reference echo;
- no redirect propagation;
- `Referrer-Policy: no-referrer` (or stricter equivalent);
- path/final-segment redaction in infrastructure logs where supported.

If new evidence proves the path design itself unsafe, STOP for a security Decision Gate. Do not silently redesign the exchange transport.

---

## 6. Real-device execution

If the current environment genuinely has the needed tooling and no unresolved owner Decision Gate blocks execution, run the real-device matrix.

### Android minimum

- install/run the real device-preview entry point;
- cold start from valid preview link;
- warm start from valid preview link;
- wrong-host link ignored;
- expired reference controlled;
- already-consumed reference controlled;
- successful exchange reaches `PreviewRuntimeView`;
- frozen Draft snapshot renders;
- later Draft edit does not mutate current preview;
- regenerated QR opens newer snapshot;
- revoked/expired PreviewSession fails closed;
- no Published mutation.

### iOS minimum

Run the equivalent matrix where technically possible.

Universal Link success must not be claimed without a real associated-domain setup that actually resolves and verifies.

### Evidence requirements

Record:

- device/emulator/simulator type;
- OS version;
- build command;
- entry point;
- package/bundle identity;
- exact link used with sensitive reference redacted;
- observed result;
- screenshots/log snippets only where they do not expose credentials.

If physical-device execution is impossible, say so and keep criterion 10 OPEN.

Emulator/simulator proof may be recorded separately but must not be mislabeled as physical-device proof.

---

## 7. Regression / backward-compatibility proof

Reconfirm, with the narrowest necessary checks:

- production `main.dart` unchanged in behavior;
- Design Canvas remains available;
- Browser App Preview remains distinct;
- Published Experience runtime remains unchanged;
- Default AWJ Experience remains unchanged;
- Last Known Good behavior remains unchanged;
- no preview flow publishes Draft;
- preview auth cannot access merchant admin / commerce / customer surfaces;
- Tenant Isolation remains fail-closed;
- no accounting/financial code path changed.

Do not reopen unrelated setup/environment defects.

---

## 8. Tests

Run progressively and only as needed.

Minimum closure verification:

1. focused PreviewSession / PreviewExchange / PreviewIntegratedChain tests on SQLite;
2. focused PostgreSQL preview + concurrency tests;
3. Flutter preview/deep-link/widget tests if toolchain exists;
4. relevant web preview/QR tests if closure work touches web;
5. build proofs only for platforms touched or required by real-device execution;
6. full CI on the final PR.

Do not modify `setup.sh` or unrelated dependencies as part of MP-9.

Any pre-existing environment/setup defects must be documented as separate follow-up work.

---

## 9. Closure status model

The final closure report must choose exactly one:

### A. CLOSED / PASS
Allowed only if:
- all mandatory Horizon exit criteria pass;
- Android + iOS real-device verification is genuinely recorded;
- no unresolved security/Tenant Isolation Decision Gate remains.

### B. IMPLEMENTATION COMPLETE / OPERATIONAL GATES OPEN
Use when the feature implementation is complete but real domain/device/signing/association work remains owner- or environment-gated.

This status means the Horizon is **not fully closed**.

### C. BLOCKED — OWNER DECISION REQUIRED
Use when a required closure step cannot proceed without a Decision Gate.

Do not soften B/C into “complete”.

---

## 10. Durable closure report

Create:

`docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_CLOSURE_REPORT.md`

Include:

- final closure status;
- Base / Head SHA;
- branch / PR;
- MOBILE-PREVIEW-1…9 task/PR/merge ledger;
- exit-criteria matrix;
- exact preview truth levels delivered:
  - Level A — Design Canvas
  - Level B — Browser Mobile Preview
  - Level C — Real Runtime Preview
  - Level D — Physical Device Preview
- security architecture summary;
- Tenant Isolation / RBAC / auth-boundary proof;
- Draft vs Published proof;
- one-time exchange proof;
- URL/logging assessment;
- Android evidence;
- iOS evidence;
- tests / builds / CI;
- backward-compatibility proof;
- operational readiness;
- known limitations;
- explicitly deferred signing / TestFlight / Play / App Store work;
- all owner Decision Gates and their disposition;
- next recommended Horizon.

If Level D lacks actual evidence, mark it **NOT VERIFIED / OPEN**.

---

## 11. Decision Gates

STOP before implementation if MP-9 requires:

- public App Schema changes;
- weaker compatibility/fail-closed behavior;
- weaker Tenant Isolation or RBAC;
- merchant/admin/store token forwarding;
- PreviewSession bearer inside QR/link;
- changing one-time exchange semantics;
- new long-lived public preview surface;
- build flavor / applicationId / bundle-ID / native target redesign without owner approval;
- Production DNS/domain changes;
- association-file Production deployment;
- signing/provisioning;
- TestFlight / Play / App Store work;
- Production release/deploy;
- weakening logging/redaction controls.

---

## 12. Explicit non-goals

- no customer identity expansion;
- no Flutter Web;
- no App Factory work;
- no Store Customizer work;
- no unrelated setup.sh fixes;
- no unrelated dependency cleanup;
- no Production deploy;
- no app-store submission;
- no signing automation;
- no speculative refactor.

---

## 13. Branch / PR

Use one branch:

`docs/mobile-preview-9-closure`

Open one PR:

`docs(app-builder): MOBILE-PREVIEW-9 horizon closure`

If owner-approved code is genuinely required for the real-device Decision Gate, STOP first. After approval, keep the smallest safe scope and document why code was necessary.

---

## 14. Horizon workflow

latest main
→ read merged MP evidence
→ build task/PR ledger
→ audit all exit criteria
→ resolve or surface owner Decision Gates
→ execute real-device proof only where honestly possible and approved
→ produce durable closure report
→ focused verification
→ PR
→ CI
→ address in-scope findings
→ owner review
→ stop before merge.

No Deploy. No Production. No DNS. No signing unless separately and explicitly approved.

---

## 15. Final implementation report

In addition to the durable closure report, the final handoff must state:

- what was done;
- files changed;
- tests and results;
- build/CI status;
- risks / remaining items;
- Branch / PR / Base SHA / Head SHA;
- Decision Gate status;
- whether the Horizon is truly CLOSED or still operationally gated;
- exact next action.

Do not recommend closure merely because the PR is green.
