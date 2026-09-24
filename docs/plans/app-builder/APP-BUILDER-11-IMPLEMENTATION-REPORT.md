# APP-BUILDER-11 — Implementation Report

STATUS: CI/PRE_MERGE_REVIEW: PASS — awaiting merge
DATE: 2026-09-24

## Outcome

Delivers "Integrated Proof of the currently accepted and actually implemented App Builder
contract" — the owner's explicit redefinition (2026-09-24, option 2) of horizon doc task 11's
original outcome line. Full redefinition rationale, the architecture finding that triggered it,
and the exact scope this task does and does not claim: `APP-BUILDER-11-UX-EVIDENCE-PASS.md`.

In one sentence: this task adds **zero new production code** (backend or frontend) — every piece
it proves was already built by `APP-BUILDER-1` through `APP-BUILDER-10`. Its only new file is a
test that drives the real, already-shipped HTTP contract through one connected merchant journey
(create → edit → theme sync from a real store → pages/navigation → validate → publish → immutable
version → restore → revalidate → publish again), plus the tenant-isolation, RBAC, and
deferred-boundary evidence a closure task like this owes.

## The user's explicit constraints, and how they were honored

The owner's redefinition decision named exactly what must not be invented. None of it was:

- **No `bindings` in App Schema.** The proof's schema payloads use only `type/id/optional/props/
  children/action` — the same allowlist `AppSchemaParser`/the Dart runtime have enforced since
  `APP-BUILDER-1`/`2`. A dedicated test (`integrated_proof_never_crosses_into_the_deferred_data_
  binding_boundary`) proves a `bindings` key is still rejected (422) *after* the full lifecycle
  runs, not just before it.
- **No Data Resource Registry contract.** Same test asserts `DataResourceRegistry::RESOURCES`
  is still `[]`.
- **No condition/expression contract, no merchant-authored visibility semantics.** Not touched —
  no schema field for either exists in the accepted contract and none was added.
- **No arbitrary JS/expression evaluation.** N/A — nothing in this task executes merchant-authored
  code; App Schema stays declarative JSON validated server-side, exactly as before.
- **No real Commerce API action dispatch.** The "Use My Store Design" leg reads real Commerce
  *presentation* data (colors/radius/density — genuinely real, genuinely live) to seed
  `schema.theme.tokens`; it never invokes `addToCart`/`openProduct`/any Commerce action dispatch,
  and no such dispatch exists anywhere in the accepted runtime to invoke.
- **No new Flutter/runtime contract invented merely to satisfy the original aspirational
  wording.** This task does not touch `mobile/` at all. It does not claim "the proven Flutter
  runtime consumes" anything — that specific clause of the original task-11 line is the one
  explicitly deferred, not reinterpreted or quietly satisfied by a fixture.
- **Does not claim real Commerce resource binding or live Commerce runtime dispatch.** Stated
  explicitly, in both this report and the evidence-pass doc, as *not* proven by this task.
- **`APP-BUILDER-7` remains untouched and `decision_required`.** No file under
  `app/Services/AppBuilder/` was modified by this task except the new test; no schema field it
  would need was added.

## What changed

- **`tests/Feature/AppBuilderIntegratedProofTest.php`** (new, the only file this task adds) — four
  tests:
  1. `full_lifecycle_create_edit_theme_sync_pages_validate_publish_restore_revalidate_publish_again`
     — the connected proof described above, one continuous scenario against the real HTTP API.
  2. `full_lifecycle_denies_every_step_across_tenants` — a second tenant is denied (404) on every
     surface the proof exercises.
  3. `full_lifecycle_denies_every_mutating_step_to_a_role_without_app_builder_permissions` — a
     `staff` token is denied every surface, reads included.
  4. `integrated_proof_never_crosses_into_the_deferred_data_binding_boundary` — the explicit
     architectural boundary as executable evidence, not just prose.
- **`docs/plans/app-builder/APP-BUILDER-11-UX-EVIDENCE-PASS.md`** (new) — the redefinition record
  and full evidence trail (see above).

No backend production file, no frontend file, no route, no migration, no permission changed.

## A real design choice worth recording

The "Use My Store Design" leg of the proof does not mock or stub the Commerce presentation data —
it seeds a real `Storefront`/`SalesChannel` row in the test tenant and calls the exact two
production endpoints the frontend's `ThemePanel` (`APP-BUILDER-8`) calls
(`GET commerce/workspace/storefronts`, `GET .../presentation`), reading the real
`StorefrontPresentationNormalizer::defaultConfig()` values (`primaryColor: #12372a`, etc.). This
was a deliberate choice over a lighter unit-level assertion: it proves the cross-module
integration (App Builder reading Commerce workspace data) actually works end to end through real
services, not just that each side's own tests pass in isolation — which is precisely what
"integrated proof" means as opposed to a per-module regression run.

## Tests and exact results

- `tests/Feature/AppBuilderIntegratedProofTest.php` → **4/4 passed** (61 assertions).
- `php artisan test --filter="AppBuilderIntegratedProofTest|BuilderAppTest|AppSchemaParserTest|
  CompatibilityResolverTest|ComponentRegistryTest|ActionRegistryTest|DataResourceRegistryTest|
  AppBuilderRegistryTest|BranchIsolationGuardTest|ApplicationCatalogTest|TenantApplicationTest|
  StorefrontPresentationDraftApiTest|CommerceWorkspaceStorefrontsApiTest"` → **126/126 passed**
  (741 assertions) — confirms zero interference with every App Builder suite and the two
  Commerce-workspace suites this task's proof reads from.
- `npx vitest run` (full frontend suite) → **2076/2076 passed** (296 files) — unaffected, since
  zero frontend files were touched by this task.
- `npm run build` → succeeds.
- `php artisan test` (full backend suite, no filter) → **4638 passed, 35 failed, 49 skipped
  (29263 assertions), 579.31s.** The 35 failures are exactly the known pre-existing baseline
  (`FuelSupplyReceivingTest` → `FuelCostBasisService` calling `bcmul`/`bcadd`/etc. — the local
  environment's PHP build lacks the `bcmath` extension, unrelated to App Builder). Passed count is
  +4 over the prior baseline of 4634, exactly matching this task's 4 new
  `AppBuilderIntegratedProofTest` cases. **Zero new regressions.**

## Accounting impact

**None.** This task adds a test file and a docs file only. No route, model, migration, or
journal-affecting operation is created, changed, or exercised in a new way — every endpoint the
proof calls (`POST/GET/PUT app-builder/apps/*`, `GET commerce/workspace/storefronts*`) already
existed unchanged from `APP-BUILDER-1`/`2`/`8`/`10` and Commerce workspace's own prior tasks.

## Self-review

### Implementer

Proved the real, connected, already-built journey end to end — not a rewrite of any of its
pieces, and not a claim beyond what the pieces actually do. The one leg the owner explicitly
forbade inventing (real Commerce resource binding / live runtime dispatch) is named, in both this
report and the evidence pass, as deferred — never implied as done by omission.

### Reviewer

- Verified directly against the source, not from memory, that `SchemaComponent._allowedKeys` in
  `mobile/lib/schema/app_schema.dart` still excludes `bindings` and that
  `DataResourceRegistry::RESOURCES` is still `App\Services\AppBuilder\DataResourceRegistry::RESOURCES
  = []` — both asserted directly by the new boundary test, not just read once and assumed static.
- Confirmed the "Use My Store Design" leg calls the *exact* two endpoints
  (`GET commerce/workspace/storefronts`, `GET .../{id}/presentation`) the real `ThemePanel`
  component calls, at the exact response paths (`data.stores[].id`, `data.draft.primaryColor`) —
  read directly from `CommerceWorkspaceStorefrontsController::index`/
  `StorefrontPresentationService::present()`, not guessed.
- Confirmed restore never auto-publishes: the proof asserts
  `builder_published_experience_versions` count stays at 2 immediately after the `PUT .../draft`
  restore call, before any subsequent `validate`/`versions` call.
- Confirmed the tenant-isolation and RBAC tests exercise every surface the main proof touches
  (show, draft read/write, validate, publish, versions list/show) — not a subset.

### AWJ Guardian

- Tenant/RBAC isolation: no new route, no new permission — the proof exercises exactly the gates
  `APP-BUILDER-1`/`2`/`10` already established (`apps_builder.view`/`.manage`/`.publish`,
  `commerce.manage` for the storefront reads), verified with real HTTP calls under real tenant/
  role contexts, not middleware inspection alone.
- App Schema stays declarative/untrusted configuration: the deferred-boundary test is direct,
  executable proof that this task's own comprehensive exercise of the contract did not require —
  and does not accidentally permit — a live data-binding escape hatch.
- No production code path was added or changed, so no new attack surface, no new migration, no
  new mutation path exists to audit beyond what `APP-BUILDER-1`–`10`'s own Guardian reviews
  already covered.
