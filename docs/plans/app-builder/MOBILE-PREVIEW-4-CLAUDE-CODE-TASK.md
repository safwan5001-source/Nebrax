# MOBILE-PREVIEW-4 — Claude Code Task

## Goal
Close **Runtime Semantic Parity** gaps between Browser App Preview and the shipped AWJ mobile runtime contract without creating a second runtime truth.

## Start
- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Expected baseline at task creation:
  `4f948607a847ff45d011fdc05c7b14c78afce9c5`
- Verify and report exact Base SHA.

## Read first
Only the relevant Horizon evidence:
- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-3-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-SALLA-MOBILE-BENCHMARK.md`
- `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md`

Do not repeat broad repo discovery.

## Required external benchmark pass
Before coding, do a concise evidence-first pass using official/current sources where available.

Review relevant patterns from:
- Salla
- Zid
- Shopify
- Flutter official docs
- optionally Wix / Squarespace / FlutterFlow only if directly useful

Study not only Preview, but also:
- UI/UX flows
- app navigation
- component/section patterns
- feature exposure
- empty/loading/error/auth-dependent states
- simple vs advanced customization
- responsive desktop/mobile-admin behavior

Rules:
- write **External Evidence → AWJ Decision → MP-4 Scope**
- do not copy any platform blindly
- do not assume feature parity between Salla/Zid/Shopify/etc.
- update `APP-BUILDER-BENCHMARK-MATRIX.md` only with durable, evidenced patterns
- if evidence implies a schema/auth/security/runtime redesign, STOP at the Decision Gate

## MP-4 scope
Prove and align Browser Preview semantics for supported runtime behavior:

1. **Navigation**
   - Browser Preview navigation should follow the same declarative navigation intent as the shipped runtime where representable.
   - No invented routes or native behavior.
   - Unsupported/native-only destinations must show a truthful limitation state.

2. **Actions**
   - Match runtime availability/disabled behavior for supported actions.
   - Do not fake commerce mutations.
   - Actions requiring live auth/data remain explicitly unavailable unless already safely supported.

3. **Bindings**
   - Prove parity for supported binding resolution.
   - Preserve `itemProps`, `binding.collect`, and `$item.*`.
   - No silent fallback that renders misleading success.

4. **Collections / repeated nodes**
   - Conformance-test repeated rendering against shared fixtures.
   - Browser Preview and Flutter runtime must agree on supported declarative semantics.

5. **Component registry identifiers**
   - Verify Browser Preview coverage against runtime-supported component identifiers.
   - No second independent component contract.
   - Missing/native-only support must be surfaced honestly.

6. **Capability states**
   - Preserve fail-closed semantics.
   - Unsupported capability must not be simulated as working.
   - Use explicit preview limitation/unsupported UI where needed.

7. **Preview states**
   - Cover useful app-level states already supported by the current architecture:
     Home / Categories / Cart / Orders / Account or equivalent existing pages.
   - Empty/auth-dependent states should be truthful.
   - Do not introduce customer login or live-data auth architecture in MP-4.

## Conformance strategy
Prefer shared fixtures and explicit cross-runtime semantic assertions over duplicated implementation.

Where practical:
- use the same schema fixtures for web and Flutter tests
- compare declarative intent/output semantics, not pixel identity
- keep the real Flutter `CompatibilityResolver` and runtime registry authoritative

If exact browser representation is impossible, document the limitation instead of inventing behavior.

## Hard boundaries
Do **not**:
- change public App Schema without Decision Gate
- weaken fail-closed compatibility
- add Preview Session/token architecture
- forward admin/store credentials
- add live merchant commerce auth
- add customer identity/login
- add Flutter Web embedding
- add QR/Open-on-phone
- change Tenant Isolation/RBAC/Commerce auth
- change DB/API/accounting behavior
- deploy/sign/distribute/publish

## Tests
Add focused conformance proof for:
- navigation semantics
- action available/disabled/unsupported states
- bindings + collect + itemProps + `$item.*`
- repeated collections
- component identifier parity
- capability fail-closed behavior
- truthful native-only limitation state
- no preview interaction causes save/publish/mutation
- Design mode remains backward compatible

Run focused tests first, then relevant web/mobile tests and build required by touched files.

## Horizon workflow
Use one branch:
`feat/mobile-preview-4-runtime-semantic-parity`

Open one PR:
`feat(app-builder): MOBILE-PREVIEW-4 runtime semantic parity`

Continue:
implementation → focused tests → broader relevant tests/build → PR → CI → in-scope findings → ready for closure.

Stop only:
- before merge unless explicit approval exists
- at a Decision Gate
- if the task would cross MP-5 security scope

No Deploy/Production.

## Final report
Return a concise Markdown report with:
- Base / Head SHA
- Branch / PR
- evidence pass + benchmark matrix updates
- exact semantic gaps found
- exact fixes
- files changed
- conformance fixtures/tests
- web/mobile/build/CI results
- Decision Gate status
- backward compatibility
- risks / remaining limitations
- explicit MP-5+ deferrals
- next step
