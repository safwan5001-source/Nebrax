# APP-BUILDER-10 — Implementation Report

STATUS: CI/PRE_MERGE_REVIEW: PASS — awaiting merge
DATE: 2026-09-24

## Outcome

Delivers "Validate/Publish/Version/Rollback foundation" (horizon doc task 10: "Draft → Validate →
Published Experience; immutable versions; compatibility-safe rollback within contract"). This is
the first task in this horizon to touch backend files since `APP-BUILDER-2` — a dependency check
(recorded in `docs/autonomous-engineering/TASK-QUEUE.md`) found that almost everything task 10
needs was already built in `APP-BUILDER-1`/`APP-BUILDER-2`; only a thin validate-only endpoint was
genuinely missing.

Three pieces, each grounded directly in the real backend contract (models, services, routes, RBAC,
prior implementation reports — read via a dedicated research pass before scoping) rather than the
architecture doc's richer, explicitly-undecided aspiration:

1. **Validate.** `BuilderPublishedExperienceVersionService::publish()` already ran structural
   validation (`AppSchemaParser`) then compatibility resolution (`CompatibilityResolver` against
   `CapabilityManifest::current()`) before creating a version row — but there was no way to run
   those same two checks without risking a real, RBAC-gated, irreversible-feeling publish attempt.
   `publish()` was refactored to extract a shared `validatedDraftSchema()` private method; a new
   public `validate()` method calls it and discards the result — same checks, same error messages,
   zero new validation rule, no row created. Exposed via a new `POST .../validate` route.
2. **Publish, made visible as a review flow.** A "Publish" button in the Builder workspace header
   (beside Save, `APP-BUILDER-6`) opens a dialog that runs Validate automatically, shows its single
   clear result (pass or the same error message publish would throw), takes an optional note, and
   only enables the actual confirm once validation passes. Disabled — with a visible, specific
   reason, never silently — while the draft has unsaved changes (publishing reads the *saved*
   draft, not in-memory edits) or the user lacks `apps_builder.publish`.
3. **Rollback = restore + review, never restore + auto-publish.** A new `/app-builder/[id]/versions`
   page (linked from the App Manager detail page's existing, now-summarized version list) lists
   every published version with its note and publisher (`published_by`/`published_by_name`, the
   former already stored but not previously exposed — a trivial Resource addition, not a new
   concept) and one action per row: "Restore to draft." Restoring fetches that version's full
   historical schema (`GET .../versions/{version}`, already existed), writes it via the existing
   `PUT .../draft`, and redirects into the Builder workspace — the merchant reviews the restored
   draft like any other edit and must explicitly Validate/Publish again through the flow above.
   Zero new backend logic: the existing publish pipeline's compatibility check applies
   automatically, satisfying "compatibility-safe rollback within contract" for free.

A focused `APP-BUILDER-10-UX-EVIDENCE-PASS.md` was written and completed **before** implementation,
per the horizon bootstrap's mandatory workflow — the workspace's first publish-surface UI. The
architecture doc's richer "Validation UX" (structured Blocker/Warning/Info Issues panel),
"Version comparison" (diffs), and "Impact classification" (native-build/release tracking) are
explicitly out of this task's scope — none have any backing data model anywhere in the codebase,
the same class of not-yet-decided gap that made treating `APP-BUILDER-7`'s Data/Conditions/
Visibility as a hard requirement a Decision Escalation Gate; task 10's own outcome line does not
require any of them.

## The user's explicit constraints for this horizon, and how they were honored

- **No new App Schema contract invented.** `validate()`/`publish()`/rollback all operate on the
  schema as an already-validated opaque JSON document via the already-accepted `AppSchemaParser`/
  `CompatibilityResolver` — no new field, no new validation rule.
- **No dependency on the still-deferred `APP-BUILDER-7`.** None of this touches `SchemaComponent`-
  level Actions/Conditions/Visibility/Data; `APP-BUILDER-7` remains untouched, still
  `decision_required` in `TASK-QUEUE.md`.
- **No duplication of prior tasks' work.** Reuses `APP-BUILDER-6`'s undo/redo/dirty/save pipeline
  shell (the Publish button sits beside Save, gated by the same `dirty` state, not a parallel one),
  `invoices/[id]/page.tsx`'s established `Dialog` + confirm/cancel `Button` pattern (no new dialog
  shape invented), and the exact `publish()` validators for both Validate and (indirectly, via the
  existing pipeline) Rollback's compatibility safety.

## What changed

- **`app/Services/AppBuilder/BuilderPublishedExperienceVersionService.php`** — `publish()`'s
  validation logic extracted into a private `validatedDraftSchema(BuilderApp $app): array`; new
  public `validate(BuilderApp $app): void` calls it and discards the result. Same two exceptions,
  same messages, as `publish()` always threw.
- **`app/Http/Controllers/Api/BuilderPublishedExperienceVersionController.php`** — new
  `validateDraft()` method (`$this->domain(...)` wraps the service call into the same 422 response
  shape every other domain error already uses); `index()`/`show()` now eager-load the `publisher`
  relation (already defined on the model, just never called) to avoid N+1 when exposing its name.
- **`app/Http/Resources/BuilderPublishedExperienceVersionResource.php`** — exposes `published_by`
  (already stored, not previously serialized) and a new `published_by_name` (from the `publisher`
  relation).
- **`routes/api.php`** — new `POST app-builder/apps/{id}/validate`, gated by `apps_builder.manage`
  (not `.publish` — it mutates nothing, so it belongs with the daily editing permission, not the
  narrower irreversible-publish one).
- **`web/src/lib/app-builder.ts`** — `BuilderPublishedVersion` gains `schema?`, `published_by`,
  `published_by_name`.
- **`web/src/app/(app)/app-builder/[id]/builder/page.tsx`** — new "Publish" header button (disabled
  while `dirty`, while saving, or without `apps_builder.publish`, each with a distinct visible
  reason via `title`) and a `Dialog` (reusing the codebase's established post-confirmation pattern)
  that calls `openPublishDialog()` → `runValidate()` (auto-runs on open) → `confirmPublish()`
  (enabled only once validation passes).
- **`web/src/app/(app)/app-builder/[id]/page.tsx`** — the existing version list is capped to the 3
  most recent rows plus a "View all versions" link to the new versions page (the detail page stays
  a summary, its existing role since `APP-BUILDER-4`).
- **`web/src/app/(app)/app-builder/[id]/versions/page.tsx`** (new) — full version list (version,
  note, publisher, date) with a "Restore to draft" action per row, confirmed via the same `Dialog`
  pattern, redirecting into the Builder workspace on success.
- **`web/src/messages/ar.json` / `en.json`** — new `appBuilder.builder.publish.*` and
  `appBuilder.versions.*` namespaces; `appBuilder.detail.viewAllVersions` added.
- **`tests/Feature/BuilderAppTest.php`** — 3 new tests for the validate endpoint (success without
  creating a version, rejects the same incompatible draft `publish()` would reject, RBAC) + 1 new
  test asserting `published_by_name` is exposed on both `store()`'s response and the `index()` list.

## A real bug caught during self-review (before any external review)

The `BuilderPublishedExperienceVersionResource`'s first draft used `$this->whenLoaded('publisher',
...)` for `published_by_name` — correct for `index()`/`show()` (both eager-load the relation now)
but silently `null` for `store()`'s response, which returns the freshly-created model without ever
loading that relation. Caught by the new `published_version_exposes_the_publisher_name` test
failing with `null` instead of the expected name. Fixed by resolving `$this->publisher?->name`
directly instead of gating behind `whenLoaded` — Eloquent lazy-loads it once on the single
freshly-created row (no N+1 risk there, unlike the list endpoints, which already eager-load).

## Tests and exact results

- `php artisan test --filter=BuilderAppTest` → **22/22 passed** (was 18/18 — 4 new: `validate`
  succeeds without creating a version row; `validate` rejects the same incompatible draft `publish`
  would reject; `validate` requires `apps_builder.manage`; a published version exposes
  `published_by_name` on both the publish response and the list).
- `php artisan test --filter="BuilderAppTest|AppSchemaParserTest|CompatibilityResolverTest|ComponentRegistryTest|ActionRegistryTest|DataResourceRegistryTest|AppBuilderRegistryTest|BranchIsolationGuardTest|ApplicationCatalogTest|TenantApplicationTest"`
  → **97/97 passed** — confirms zero regression to tenant/RBAC/ApplicationCatalog or any prior App
  Builder task.
- `npx vitest run "src/app/(app)/app-builder/[id]/builder/page.test.tsx"` → **22/22 passed** (was
  18/18 — 4 new: Publish disabled while dirty; Publish disabled without the publish permission;
  validation passes automatically then confirming calls the versions endpoint; a failed validation
  blocks the confirm button and shows the error).
- `npx vitest run "src/app/(app)/app-builder/[id]/versions/page.test.tsx"` → **4/4 passed** (new
  file: loads and renders every version with note/publisher; empty state; restore fetches the full
  historical schema, writes it to the draft, and redirects to the builder; error state).
- `npx vitest run "src/app/(app)/app-builder/[id]/page.test.tsx"` → **3/3 passed** (existing test
  extended with a "View all versions" link-href assertion).
- `npx vitest run src/lib/app-builder.test.ts "src/app/(app)/app-builder/new/page.test.tsx"` →
  **28/28 + 5/5 passed** — unaffected by this task's type-only addition to `BuilderPublishedVersion`.
- `npx vitest run` (full frontend suite) → **2076/2076 passed** (296 files) — zero regressions
  anywhere else in the codebase.
- Manual `ar.json`/`en.json` key-parity check → **0 missing in either direction**; the codebase's
  own `i18n-keys.test.ts` guard test is included in the full suite run above and passed.
- `npx tsc --noEmit` → zero errors in any App Builder file (pre-existing unrelated errors in a
  handful of other modules' test files, unchanged by this task).
- `npm run build` → succeeds, exit code 0; `/app-builder/[id]/versions` present in the route
  manifest (3.36 kB).
- `php artisan test` (full backend suite, no filter) — run per the mandatory pre-commit protocol
  despite this task genuinely touching backend files (the first since `APP-BUILDER-2`): **4634
  passed, 35 failed, 49 skipped (29202 assertions), 574.00s.** The 35 failures are exactly the
  known pre-existing baseline, all in `Tests\Feature\FuelSupplyReceivingTest` →
  `App\Services\FuelCostBasisService` calling `bcmul()`/`bcadd()`/`bcsub()`/`bcdiv()`/`bccomp()` —
  the local test environment's PHP build is missing the `bcmath` extension entirely, unrelated to
  App Builder in any way and already documented as this exact baseline in every prior App Builder
  task's report. Passed count is up from the prior baseline of 4630 by exactly +4, matching the 4
  new `BuilderAppTest` cases added by this task. **Zero new regressions.**

## Accounting impact

**None.** This task adds no route, model, migration, or journal-affecting operation. It exposes one
new endpoint (`POST .../validate`) that performs read-only checks and creates no row, and reuses
`PUT .../draft`/`POST .../versions` exactly as built in `APP-BUILDER-1`/`APP-BUILDER-2`. No
accounts, debits, or credits are involved anywhere in this change.

## Self-review

### Implementer

Built three real, working features against the actual backend contract, verified by direct code
reading before design (not the architecture doc's aspiration taken at face value): Validate genuinely
runs the same checks Publish would, Publish genuinely creates an immutable version through the
unchanged existing service, and Restore genuinely writes a historical schema back into the real
draft row. No capability implied that doesn't exist: the Issues panel stays a single clear message,
not a fabricated structured list; there is no diff generation pretending to summarize changes.

### Reviewer

- No code broader than the task: no `APP-BUILDER-11` integrated-proof work, no `APP-BUILDER-7`
  Data/Conditions/Visibility. The Inspector/Actions editing (`APP-BUILDER-6`) is untouched.
- No new App Schema contract invented — verified directly against `AppSchemaParser.php`/
  `CompatibilityResolver.php`: `validate()` calls the identical two methods `publish()` already
  called, in the identical order, with the identical exception messages.
- The Publish button's `disabled={dirty || saving || !canPublish}` guardrail is a real correctness
  fix, not just a UX nicety: `publish()` reads the *saved* draft from the database, so publishing
  while `dirty` would silently publish stale content — the button is structurally incapable of
  producing that outcome now.
- Rollback never auto-publishes — verified by reading the actual `confirmRestore()` implementation:
  it calls only `PUT .../draft`, never `POST .../versions`; the merchant lands in the Builder
  workspace and must take the separate, visible Publish action.
- RBAC verified with a real HTTP test, not just middleware reading: `validate_requires_the_manage_permission`
  exercises the full route with a `staff` token (which has neither `apps_builder.manage` nor
  `.publish`) and asserts a 403, the same pattern every prior App Builder RBAC test already uses.

### AWJ Guardian

- Tenant/RBAC isolation: the one new route (`POST .../validate`) uses the exact same
  `apps_builder.manage` + `commerce.app_builder` gate pair every other draft-editing route already
  uses — no new permission invented, no gate weakened.
- App Schema stays declarative/untrusted configuration: `validate()`/`publish()`/the restored draft
  are all still plain JSON validated server-side by the same `AppSchemaParser::validate()` +
  `CompatibilityResolver::resolve()` pair already authoritative since `APP-BUILDER-1`/`2` — no new
  client-side trust boundary.
- Published version immutability is untouched: no new mutation path was added to
  `BuilderPublishedExperienceVersion` (rollback never updates or reactivates an old row — it always
  creates a new one, through the unchanged `publish()` path, exactly as the model's own docblock
  and `RUNTIME_COMPATIBILITY_V1.md` §15 already specified before this task existed).
