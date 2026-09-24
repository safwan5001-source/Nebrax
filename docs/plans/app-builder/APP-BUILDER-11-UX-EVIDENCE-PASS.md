# APP-BUILDER-11 — Evidence Pass (Integrated Proof, redefined scope)

DATE: 2026-09-24

## Why this document exists, and why its shape differs from prior tasks'

Every prior major user-facing App Builder slice (4/5/6/8/9/10) got a dedicated UI/UX Evidence
Pass before implementation, per the horizon bootstrap's mandatory workflow. APP-BUILDER-11
introduces **no new user-facing slice** — it is a closure task that proves the already-built,
already-evidence-passed slices work together as one real merchant journey. This document
therefore does not repeat that per-slice evidence (it is already on record in
`APP-BUILDER-4/5/6/8/9/10-UX-EVIDENCE-PASS.md` and their implementation reports); it records
instead the **scope redefinition itself** and the verification method used to prove the
integrated journey.

## The scope redefinition (owner decision, 2026-09-24)

The horizon doc's original task 11 line reads: *"create app → edit → bind real Commerce
resource → validate → publish → proven Flutter runtime consumes compatible experience
fixture/contract; tenant/RBAC/security/accessibility/bidi/regression evidence."*

Research before implementation (see `TASK-QUEUE.md`'s dependency-check entry for the full
finding) found that **"bind real Commerce resource"** and **"proven Flutter runtime consumes"**
cannot be honestly satisfied by anything in the accepted, tested contract:

- `SchemaComponent._allowedKeys` in the tested `mobile/lib/schema/app_schema.dart` accepts only
  `type/id/optional/props/children/action` — a `bindings` key is **structurally rejected**
  (`unknown_key`), not merely unsupported.
- `DataResourceRegistry::RESOURCES` is deliberately empty (`APP-BUILDER-3`'s own finding) — zero
  Commerce data resources are registered in the compatible runtime contract.
- Every registered `Action` (`addToCart`, `openProduct`, …) is `DISPATCH_PROVEN_NOOP` — real
  Commerce API dispatch (`MOBILE-RUNTIME-4/5`) was never built, and that work belongs to the
  **already-closed** Mobile Runtime Proof V1 horizon, not this one.
- `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §"Open Decisions after 04B" lists "exact Data
  Source Registry contract" as explicitly **not locked** — the same undecided item that made
  `APP-BUILDER-7` a Decision Escalation Gate.

Escalated to the owner (mirroring `APP-BUILDER-7`'s own escalation). Owner decision, option 2:
redefine APP-BUILDER-11 as an **Integrated Proof of the currently accepted and actually
implemented App Builder contract** — prove the full real journey (create → edit →
components/actions already supported → theme / Use My Store Design → pages/navigation/templates
→ Validate → Publish → immutable published version → restore/rollback to draft → revalidate)
end to end, with tenant/RBAC/security/accessibility/bidi/regression evidence drawn from what is
actually built. Explicitly **not** claiming real Commerce resource binding or live Commerce
runtime dispatch. That portion of the original task-11 intent is recorded as deferred,
`decision_required`, tied to the same architecture boundary as `APP-BUILDER-7` — not silently
dropped, not marked done.

## What is proven (real, tested, evidence-backed)

All exercised through the real HTTP contract in
`tests/Feature/AppBuilderIntegratedProofTest.php`, one connected scenario, not isolated units:

1. **Create** — `POST /app-builder/apps` (`creation_source: template`), safe minimum shell seeded
   atomically (`APP-BUILDER-1`).
2. **Edit** — `PUT .../draft` with a schema built only from real, registry-backed components
   (`Section`/`Text`/`ProductList`/`ProductCard`/`Button`/`CartList`/`CartSummary`) and a real
   `navigate` action between two pages — the exact shape of the shipped "Catalog" template
   (`APP-BUILDER-9`), not an invented one.
3. **Theme / Use My Store Design** — a real `Storefront` seeded in the same tenant; the proof
   calls the exact same two real, already-shipped, `commerce.manage`-gated endpoints the frontend
   (`ThemePanel`, `APP-BUILDER-8`) calls (`GET commerce/workspace/storefronts`,
   `GET .../presentation`), reads the real default presentation config, and writes derived tokens
   into `schema.theme.tokens` via the same `PUT .../draft` — no simulated/mocked Commerce data.
4. **Pages / navigation / templates** — adds a third page, moves `navigation.initialPageId` to it
   and back, each transition validated server-side by the unchanged `AppSchemaParser`
   (`APP-BUILDER-2`/`9`).
5. **Validate** — `POST .../validate` (`APP-BUILDER-10`) confirms compatibility without creating
   a version.
6. **Publish → immutable version** — `POST .../versions` creates version 1; a further draft edit
   and second publish creates version 2 while `GET .../versions/1` proves version 1's schema is
   byte-for-byte unchanged (immutability under a *real* concurrent edit, not just a unit assertion
   on the model).
7. **Restore/rollback to draft** — the real mechanism settled in `RUNTIME_COMPATIBILITY_V1.md`
   §15 and built in `APP-BUILDER-10`: `PUT .../draft` with version 1's historical schema, proven
   to leave the published-versions table untouched (a restore is a draft write, never an implicit
   publish).
8. **Revalidate → publish again** — `POST .../validate` then `POST .../versions` on the restored
   draft creates version 3, proven identical to version 1's schema — the round trip is exact.

## Security / tenant-isolation / RBAC evidence

- `full_lifecycle_denies_every_step_across_tenants`: a second tenant gets a safe 404 (never a
  leak, never a different error shape) on every surface the proof exercises — show, draft read,
  draft write, validate, publish, versions list, version show — for an app it does not own.
- `full_lifecycle_denies_every_mutating_step_to_a_role_without_app_builder_permissions`: a `staff`
  token (zero `apps_builder.*` permissions, the same established pattern every prior App Builder
  RBAC test uses) is denied create, draft write, validate, publish, **and** read (app show,
  versions list) — confirming `apps_builder.view` gates reads too, not only `.manage`/`.publish`
  gating writes.
- `integrated_proof_never_crosses_into_the_deferred_data_binding_boundary`: executable evidence,
  not just a written claim, that the full proof above never required weakening the contract — a
  `bindings` key is still structurally rejected (422) and `DataResourceRegistry::RESOURCES` is
  still empty after the entire lifecycle runs.

## Accessibility / bidi evidence

No new UI is introduced by this task, so no new accessibility/bidi surface exists to evidence-pass.
What is proven by direct code reading of the actual shipped screens (not re-asserted from memory):

- `web/src/modules/app-builder/canvas.tsx:337` sets the canvas preview's `dir` attribute live from
  the selected preview locale (`locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr'`) — the
  mobile canvas genuinely re-renders RTL/LTR on toggle, not just the admin chrome around it
  (`APP-BUILDER-5`'s own evidence pass claim, reconfirmed here against the current file).
  `web/src/modules/app-builder/theme-panel.tsx`/`inspector.tsx` correctly force `dir="ltr"` only
  on the narrow fields that must stay LTR regardless of UI locale (hex color codes, URLs) — the
  same deliberate exception already established for money/code fields elsewhere in the codebase.
- `ar.json`/`en.json` key parity for every `appBuilder.*` namespace is enforced by the codebase's
  own `i18n-keys.test.ts` guard, included in the full frontend suite run below (2076/2076 passed).
- The AWJ Design System's shared layout/RTL primitives (already the authoritative visual language
  per every prior App Builder evidence pass) are unchanged and untouched by this task — no new
  primitive was introduced that could regress them.

## Regression / compatibility evidence

- New test file `tests/Feature/AppBuilderIntegratedProofTest.php`: **4/4 passed** (61 assertions).
- `php artisan test --filter="AppBuilderIntegratedProofTest|BuilderAppTest|AppSchemaParserTest|CompatibilityResolverTest|ComponentRegistryTest|ActionRegistryTest|DataResourceRegistryTest|AppBuilderRegistryTest|BranchIsolationGuardTest|ApplicationCatalogTest|TenantApplicationTest|StorefrontPresentationDraftApiTest|CommerceWorkspaceStorefrontsApiTest"` → **126/126 passed** (741 assertions) — zero interference between the new integrated proof and any App Builder/Commerce-workspace suite it touches.
- `npx vitest run` (full frontend suite, unchanged since zero frontend files touched) → **2076/2076 passed** (296 files).
- `npm run build` → succeeds.
- `php artisan test` (full backend suite, no filter) → recorded in the implementation report once
  the background run completes.

## Explicitly out of scope (deferred, not silently dropped)

Recorded as a connected follow-up architecture/evidence track with `APP-BUILDER-7`, for
owner/ChatGPT review after Horizon closure — see `APP-BUILDER-12`'s closure report:

- Real Commerce data resource binding (a schema `bindings` concept, a populated
  `DataResourceRegistry`, and the `COMMERCE_MOBILE_API_READINESS.md` evidence `DATA_RESOURCE_REGISTRY_V1.md`
  itself requires before locking any resource).
- Live Flutter runtime dispatch of a real Commerce action (`MOBILE-RUNTIME-4/5`) — belongs to a
  different, already-closed horizon, not this one.
- By extension, `APP-BUILDER-7`'s own Data/Conditions/Visibility remain untouched and
  `decision_required`, unchanged by this task.
