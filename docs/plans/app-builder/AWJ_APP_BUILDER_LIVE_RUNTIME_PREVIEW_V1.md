# AWJ App Builder — Live Runtime & Preview V1

**Status:** APPROVED / READY  
**Starting main SHA:** `21c012ef343c755feab012c5d41bd8649e6d549c`  
**Predecessor:** Commerce Data & Dynamic Runtime V1 — CLOSED / PASS  
**Runtime Boot prerequisite:** APP RUNTIME BOOT-1 / PR #1011 — CLOSED / PASS

## Goal

Close the product/runtime loop between Builder, Preview, validation, publishing, and the real AWJ mobile runtime:

```
Builder Draft → Preview → Validate → Publish
→ commerce/v1/experience → Runtime compatibility → Runtime rendering
```

This horizon proves that merchants can preview and publish the same supported declarative semantics that the real AWJ mobile runtime consumes. It does not enter App Factory, signing, distribution, or store submission.

## Locked starting contracts

- `commerce/v1` remains the mobile Commerce API surface.
- Runtime boot contract:
  - Published Experience → `UseFreshExperience`
  - No Published Experience / 404 → `UseDefaultExperience`
  - transient fetch failure + compatible LKG → `UseLastKnownGood`
  - transient fetch failure + no compatible LKG → `ControlledUnavailable`
- 404/no-published is a normal product state, not a fetch failure and never an LKG path.
- Default AWJ Experience is an explicit bundled product/runtime concept.
- Schema remains declarative, versioned, capability-gated, tenant-isolated, and untrusted configuration.
- Capability negotiation remains fail-closed.
- Preserve existing `itemProps`, `binding.collect`, and `$item.*` semantics.
- Current proven runtime resources/features remain limited to already activated capabilities.
- Product route context such as `$route.productId` remains out.
- `customer.profile` and `customer.orders` remain out until customer identity/login is deliberately introduced.
- No arbitrary merchant JavaScript/Dart, eval, SQL, arbitrary HTTP, or executable plugins.
- Tenant Isolation, RBAC, and Commerce authorization must remain intact.
- One Commerce Core, multiple presentation channels: Preview may differ visually from Flutter, but must not invent separate commerce truth or schema semantics.

## Execution model

Execute this horizon as small evidence-driven tasks. Do not implement the entire horizon in one PR. Each task starts from the verified evidence of the prior task. Update this durable state after each completed task with PR, base/head/merge SHA, tests, CI, remaining gaps, and next-task readiness.

Standing authority covers implementation, tests, commits, PRs, merging green dependency-safe task PRs, post-merge verification, and durable documentation within this approved horizon. It does **not** authorize Production deployment, mobile distribution, signing, TestFlight, Play distribution, or App Store/Google Play submission.

## Task queue

| Task | Purpose | State |
|---|---|---|
| LIVE-PREVIEW-1 | Preview Contract Evidence Pass | **DONE / PASS** — see `LIVE-PREVIEW-1-EVIDENCE-PASS.md` |
| LIVE-PREVIEW-2 | Preview / Runtime Semantic Parity Foundation | **DONE / PASS** — see `LIVE-PREVIEW-2-PARITY-FOUNDATION.md` |
| LIVE-PREVIEW-3 | Binding + Collection Preview Parity | READY — owner-approved scope: sample/representative data only (see durable state below) |
| LIVE-PREVIEW-4 | Action + Theme + Supported Visibility Parity | BLOCKED |
| LIVE-PREVIEW-5 | Runtime-Aware Pre-Publish Validation | BLOCKED |
| LIVE-PREVIEW-6 | Draft / Default / Published Preview States | BLOCKED |
| LIVE-PREVIEW-7 | Integrated Builder → Publish → Runtime Proof | BLOCKED |
| LIVE-PREVIEW-8 | Horizon Closure / Durable Documentation | BLOCKED |

### LIVE-PREVIEW-1 — Preview Contract Evidence Pass

Inspect only the files/contracts necessary to establish current Builder Preview versus proven Flutter Runtime behavior. Determine:

- what Preview currently renders and which schema/version it consumes;
- current Preview interpretation of component structure and theme tokens;
- bindings, `binding.collect`, `itemProps`, and `$item.*`;
- visibility semantics;
- action representation/dispatch semantics;
- compatibility/capability checks;
- whether Default AWJ Experience can be previewed;
- concrete places where Preview and live runtime can diverge;
- security/Tenant Isolation implications.

Deliver an evidence-backed gap matrix, the smallest recommended parity approach, and either `LIVE-PREVIEW-2 READY` or a Decision Gate.

**Evidence pass only. Do not rewrite Preview in this task.**

### LIVE-PREVIEW-2 — Preview / Runtime Semantic Parity Foundation

After LP-1 review, establish the smallest shared/derived contract needed so Preview does not become an independent schema interpreter. Semantic parity is required; pixel-identical Web/Flutter rendering is not.

### LIVE-PREVIEW-3 — Binding + Collection Preview Parity

Prove supported Preview semantics for `commerce.products`, `commerce.cart`, `binding.collect`, `itemProps`, and item-scoped substitution already supported by Runtime.

### LIVE-PREVIEW-4 — Action + Theme + Supported Visibility Parity

Align only already-supported action/theme/visibility semantics. Unsupported capabilities must be explicit/fail-closed rather than simulated as working.

### LIVE-PREVIEW-5 — Runtime-Aware Pre-Publish Validation

Inspect existing validation first. Strengthen the existing Validate → Publish boundary only where evidence shows a gap. Reuse existing schema/version/capability contracts; do not create duplicate validators.

### LIVE-PREVIEW-6 — Preview States

Make Draft, Default AWJ Experience, and currently Published Experience states unambiguous where appropriate. Preview must never imply that a draft is an actual production/mobile release.

### LIVE-PREVIEW-7 — Integrated Proof

Prove, using real contracts wherever feasible:

```
Builder Draft
→ Preview
→ Validate
→ Publish
→ commerce/v1/experience
→ real startup resolver
→ runtime compatibility
→ runtime rendering
```

Isolated unit tests alone are insufficient for the horizon's end-to-end claim.

> **Note (owner decision resolving LIVE-PREVIEW-3's Decision Gate, 2026-09-25):** LIVE-PREVIEW-3
> proves binding/collection resolution semantics using clearly labeled representative/sample
> data (not live merchant data) — see "Current durable state" below. That sample-data proof does
> **not** satisfy this task. LIVE-PREVIEW-7 still requires real contracts wherever feasible, and
> must not claim LP-3's sample-data evidence as proof of live merchant-data Preview parity.

### LIVE-PREVIEW-8 — Closure

Close only after exit criteria are evidenced and durable state records all intentional deferrals.

## Decision Gates

Stop and report a narrow evidence-based Decision Gate rather than implementing speculative architecture if:

1. Preview and Flutter require fundamentally incompatible schema semantics.
2. Parity would require a second independent interpreter rather than sharing/deriving the established contract.
3. A required runtime feature is not capability-gated.
4. The task requires Product route context or customer identity outside this horizon.
5. Pre-publish safety requires a material public schema/API contract change.
6. Tenant Isolation, RBAC, or Commerce authorization would need to change.
7. The solution requires arbitrary executable merchant code.
8. Scope expands into App Factory, signing, distribution, store submission, or Production deployment.

## Non-goals

- App Factory / native project generation / white-label generation
- Apple or Android signing
- certificates/profiles
- TestFlight / Play Internal Testing
- App Store / Google Play submission
- Production mobile release/deployment
- arbitrary merchant code or general-purpose expression engine
- customer identity/login, customer profile/orders
- Product route-context expansion
- broad storefront redesign
- unrelated ERP refactoring

## Testing and CI

For implementation tasks: focused tests → relevant integration/widget tests → analyze/typecheck → broader affected suite → CI → post-merge verification.

Do not weaken tests for Tenant Isolation, security, schema compatibility, runtime fallback, or publishing. Do not repeatedly poll CI. An unrelated pre-existing failure must be proven unrelated before any out-of-scope change is considered.

## Real-device gate

Repository release-mode CI/build proof remains valid engineering evidence during this horizon. Separately, **real-device verification is mandatory before the first actual mobile distribution**. That later operational gate should use a controlled real tenant and cover startup, Published/Default behavior, network/LKG behavior where safely testable, Home/Cart rendering, bindings/collection hydration, and actions/mutations.

This horizon does not authorize distribution.

## Exit criteria

The horizon is CLOSED / PASS only when evidence proves:

1. the real mobile boot contract remains green;
2. Preview semantics are documented and aligned with the supported Runtime contract;
3. supported binding/collection semantics do not silently diverge;
4. supported actions/theme/visibility do not silently diverge;
5. pre-publish validation rejects unsupported/incompatible Runtime schemas fail-closed;
6. Draft / Default / Published Preview states are unambiguous;
7. integrated evidence proves Builder → Preview → Validate → Publish → `commerce/v1/experience` → Runtime;
8. relevant CI is green;
9. Tenant Isolation/security guarantees remain intact;
10. intentional deferrals are explicitly documented.

## Current durable state

- Starting main SHA: `21c012ef343c755feab012c5d41bd8649e6d549c`
- APP RUNTIME BOOT-1: PASS
- PR #1011: merged
- Backend CI: green
- Mobile CI: green
- Android/iOS release-build proof: green
- **LIVE-PREVIEW-1: DONE / PASS** (evidence-only, no code changed) — full report:
  `docs/plans/app-builder/LIVE-PREVIEW-1-EVIDENCE-PASS.md`. Headline findings: Preview
  (`web/src/modules/app-builder/canvas.tsx`) renders the live draft's component/theme structure
  correctly (registry parity confirmed), but never evaluates `binding`/`collect`/`itemProps`/
  `$item.*` (already live for `commerce.products`/`commerce.cart`), never evaluates
  `visibility`, never dispatches/distinguishes wired-vs-inert `action`s, never runs
  `CompatibilityResolver` during editing (only at explicit Validate/Publish, where it already IS
  the real, shared check), cannot preview a Published version or the Default AWJ Experience, and
  the Theme panel's tokens have ~zero live effect on the shipped runtime today (key mismatch:
  Builder writes `primaryColor`, runtime reads `colorPrimary` from the bundled Default schema
  only, never from a tenant's published experience). No Decision Gate triggered (all 8 checked).
- **LIVE-PREVIEW-2: DONE / PASS** — full report:
  `docs/plans/app-builder/LIVE-PREVIEW-2-PARITY-FOUNDATION.md`. PR #1014. Base SHA:
  `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4`. **Merge SHA: `53bfc74dd7b6bc77fa4ff6fdf08bf0625ca136c9`**
  (squash-merged; verified via `get_commit` against `main`). Adds
  `web/src/modules/app-builder/runtime-contract.ts` (a documented, narrow TypeScript port of
  `mobile/lib/app/binding_resolution.dart`'s binding resolution + visibility evaluation — not yet
  wired into `canvas.tsx`, per the horizon's own LP-2/LP-3 split), a single canonical conformance
  fixture (`contracts/app-builder/binding-visibility-conformance.v1.json`, 23 cases) asserted from
  both `web/src/modules/app-builder/runtime-contract.test.ts` and
  `mobile/test/app/binding_visibility_conformance_test.dart`, both CI workflows' path triggers
  extended to cover the shared fixture, and an additive `AppSchemaBinding.collect` field on the
  web schema type (was missing entirely). **CI evidence (all green on PR head
  `644ad7bffe53836b3b3b19c332bec64cbfb91dc9`, 12/12 check runs)**: `mobile (analyze + test)` ✅
  (the authoritative confirmation that `binding_visibility_conformance_test.dart` passes —
  unverifiable locally, no Flutter toolchain in-session), `mobile (Android/iOS release build
  proof)` ✅, `web build (Next.js)` ✅, `php artisan test (L11, sqlite/pgsql)` ✅ (unaffected,
  triggered because `ci.yml` has no path filter). No Decision Gate triggered; no capability
  broadened; fail-closed semantics preserved (see the report's dedicated fixture cases).
- **LIVE-PREVIEW-3 — Binding + Collection Preview Parity: DECISION GATE RESOLVED (owner decision,
  2026-09-25) — Option 3 approved. READY to implement.**
  While scoping which data LP-3 should feed `resolveNodeBindings` for a live Preview render,
  reading `app/Services/AppBuilder/DataResourceRegistry.php` found that `commerce.products`
  resolves to `GET commerce/v1/products` (`CommerceProductController`) — the **public
  `commerce/v1` storefront surface**, authenticated by `ResourceDefinition::AUTH_STORE_BEARER`
  (a per-channel store-bearer token; the same surface the real Flutter runtime itself calls),
  **not** the merchant's own Sanctum session the Builder UI is authenticated with. This is a
  materially different situation from the one LIVE-PREVIEW-1 §11 anticipated and recommended
  ("reuse the tenant-scoped, already-authorized commerce endpoints... exactly as `ThemePanel`'s
  'Use my store design' flow already does") — that flow calls `commerce/workspace/*`
  (`commerce.manage`-gated, same Sanctum auth as the rest of the app); there is no equivalent
  Sanctum-authenticated internal endpoint already in use by the web app for reading
  `commerce/v1/products`-shaped product data. Three options were put to the owner:
  (a) mint/forward a store-bearer token from a merchant's Builder session (a new,
  security-sensitive auth path); (b) a new Sanctum-authenticated internal endpoint proxying
  `commerce/v1/products`-equivalent data (new API surface); (c) representative/sample data only,
  shaped to the real resource contracts, for both `commerce.products` and `commerce.cart`.

  **Owner approved option (c).** LIVE-PREVIEW-3's scope is therefore fixed as follows:
  - Preview feeds `resolveNodeBindings` **clearly labeled representative/sample data**, shaped to
    exactly match `DataResourceRegistry`'s real field contracts for `commerce.products` (list
    shape: `id/name/description/sku/category/price/in_stock/thumbnail_url/...`) and
    `commerce.cart` (single shape: `status/items/subtotal/currency/...`) — sufficient to prove
    `binding.collect`, `itemProps`, and `$item.*` resolve identically to the real runtime for any
    schema that declares them, without claiming the *values* shown are a real tenant's data.
  - **Sample/representative data is not live merchant data**, and **Preview must visibly
    communicate this** (a persistent, unambiguous label/badge in the bound-preview UI — never a
    silent assumption merchants could mistake for their real catalog/cart).
  - **No store-bearer token minting or forwarding**, from the Builder session or anywhere else in
    this task.
  - **No new Sanctum-authenticated internal proxy endpoint**, or any other new backend route, for
    fetching real commerce data into Preview.
  - **No RBAC, Tenant Isolation, Commerce authorization, public API, or schema-surface expansion**
    of any kind in this task — `resolveNodeBindings`'s pure function signature already accepts
    caller-supplied `resourceData`; LP-3 only needs to supply that argument, never a new fetch
    path, new route, new permission, or new schema field beyond LP-2's already-landed
    `AppSchemaBinding.collect`.
  - **Real live product/cart data in Builder Preview is intentionally deferred** to a separately
    scoped follow-up task, not silently dropped — to be scoped only after a deliberate decision
    on which of options (a)/(b) above (or another mechanism) is acceptable, outside this horizon
    task unless the owner later folds it back in explicitly.
  - **This does not touch LIVE-PREVIEW-7 or the horizon's exit criteria.** LIVE-PREVIEW-7 must
    still prove the integrated Builder → Preview → Validate → Publish → `commerce/v1/experience`
    → real startup resolver → runtime compatibility → runtime rendering flow using real contracts
    wherever feasible (its own text, unchanged, below). LP-3's sample data proves Preview's
    *binding/collection resolution semantics* match the runtime's, in isolation from live data —
    it must never be cited, here or in LP-7/LP-8, as evidence that Preview shows live merchant
    data, and does not relax exit-criteria item 7's own "integrated evidence... using real
    contracts" bar.
