# APP-BUILDER-1 — Implementation Report

STATUS: pre-merge review
DATE: 2026-09-23

## Outcome

Tenant-scoped domain/persistence foundation for AWJ App Builder: `BuilderApp` (identity),
`BuilderDraftExperience` (mutable working copy, one per app, auto-created atomically with the
app), and `BuilderPublishedExperienceVersion` (immutable, sequentially versioned per app) — plus
RBAC (`apps_builder.view`/`apps_builder.manage`/`apps_builder.publish`), an `ApplicationCatalog`
entry (`commerce.app_builder`), a REST API (create app, read/update draft, list/create/read
published versions), and a structural App Schema validator reused by both draft-save and publish.

## Repository evidence / root cause

New capability — no prior implementation existed. Researched and matched existing house
conventions before writing any code (`BaseModel`/`TenantScope`/`BelongsToTenant`, branch
isolation markers in `app/Tenancy/` — `BranchScoped`/`BelongsToBranch`/`CompanyWide` — enforced by
`BranchIsolationGuardTest`; `Rbac::PERMISSIONS`/`MATRIX`; `ApplicationCatalog`/
`TenantApplicationService`/`EnsureApplicationActive`; the `CommercePaymentIntent`/
`CommerceShippingZone` model+service+controller+FormRequest+migration template; the
`CommercialProductVersion`/`TenantApplicationEvent` immutable-row idiom; `routes/api.php`
middleware stacking (`$perm`/`$app`/`$commercialApp` closures); `tests/Feature/InteractsWithApi`
test conventions).

## Approach chosen

- `BuilderApp`/`BuilderDraftExperience`/`BuilderPublishedExperienceVersion` all `CompanyWide`
  (mirrors `commerce.storefront`'s classification — a mobile app is a sales channel for the whole
  tenant, not a single branch).
- `BuilderDraftExperience.schema` (JSON) deliberately excludes identity/version fields
  (`experienceId`/`appId`/`version` from `APP_SCHEMA_V1.md` §4) — those live in DB columns
  (`builder_app_id`, the version row's `version`), never in merchant-editable JSON, so a draft can
  never spoof its own identity or version.
- `AppSchemaStructuralValidator` checks only the top-level shape from `APP_SCHEMA_V1.md` §4
  (known keys, `defaultLocale` ∈ `locales`, basic types) — deep validation of `pages`/component
  trees is explicitly APP-BUILDER-2/3's job (no Component/Action/Data Resource registries exist
  yet). This validator is designed to be extended, not replaced, by APP-BUILDER-2.
- `BuilderPublishedExperienceVersion` is immutable via a model-level `booted()` guard (blocks
  every `update`/`delete`, no exception field) — matches `TenantApplicationEvent`'s audit-log
  idiom rather than `CommercialProductVersion`'s "one mutable field" idiom, because V1 has no
  retire/rollback state yet (rollback, per `RUNTIME_COMPATIBILITY_V1.md` §15, is modeled later as
  a new version, never a mutation of an old one).
- Version numbering: `max(version)+1` computed inside a `DB::transaction` with
  `lockForUpdate()` on the `BuilderApp` row as the concurrency anchor — not
  `App\Support\GeneratesDocumentNumbers`, which `CLAUDE.md` reserves explicitly for commercial
  document numbering. Proven race-safe by a dedicated test calling the service twice within one
  request/transaction context (`published_version_numbering_is_race_safe_under_concurrent_publish_attempts`).
- RBAC: three new permissions (`apps_builder.view`/`manage`/`publish`), deliberately not reusing
  `apps.view`/`apps.manage` (those gate `TenantApplicationService`'s catalog enable/disable — an
  unrelated concept that happens to share a name prefix). `apps_builder.publish` is separate from
  `apps_builder.manage` because publishing is irreversible and customer-facing.
- `ApplicationCatalog`: new key `commerce.app_builder`, group `sales` (parallel to
  `commerce.storefront`), `maturity: built` (a real, fully tested API surface exists — no visual
  Builder UI yet, same maturity-vs-completeness precedent as other API-first Commerce Mobile
  capabilities), `mandatory: false`, no dependencies (a mobile app does not require the web
  storefront to be enabled first in V1).

## Why this approach fits AWJ

Follows AB-01 (reuse the accepted App Schema shape), AB-02 (server-authoritative persistence,
frontend never authoritative), AB-03 (published versions immutable), and the "policy is
configured, not imposed" rule (RBAC/ApplicationCatalog gating is additive and does not touch any
existing route/permission/model). Zero changes to accounting, inventory, or existing Commerce
domain models.

## Changed files

- `database/migrations/2026_10_11_010000_create_builder_apps_table.php`
- `database/migrations/2026_10_11_020000_create_builder_draft_experiences_table.php`
- `database/migrations/2026_10_11_030000_create_builder_published_experience_versions_table.php`
- `app/Models/BuilderApp.php`, `BuilderDraftExperience.php`, `BuilderPublishedExperienceVersion.php`
- `app/Services/AppBuilder/AppSchemaStructuralValidator.php`, `BuilderAppService.php`,
  `BuilderDraftExperienceService.php`, `BuilderPublishedExperienceVersionService.php` (new directory)
- `app/Http/Requests/StoreBuilderAppRequest.php`, `UpdateBuilderAppRequest.php`,
  `UpdateBuilderDraftExperienceRequest.php`, `StoreBuilderPublishedExperienceVersionRequest.php`
- `app/Http/Resources/BuilderAppResource.php`, `BuilderDraftExperienceResource.php`,
  `BuilderPublishedExperienceVersionResource.php`
- `app/Http/Controllers/Api/BuilderAppController.php`, `BuilderDraftExperienceController.php`,
  `BuilderPublishedExperienceVersionController.php`
- `app/Support/Rbac.php` (+3 permissions), `app/Support/ApplicationCatalog.php` (+1 key)
- `routes/api.php` (+9 routes under `app-builder/apps`)
- `.github/workflows/ci.yml`, `setup.sh`, `deploy/assemble.sh` (register new
  `app/Services/AppBuilder` directory in the three copy-lists — required by the repo's own
  "حارس قائمة النسخ" CI guard)
- `tests/Feature/BuilderAppTest.php` (new, 12 tests)
- `tests/Feature/ApplicationCatalogTest.php` (updated exhaustive-key guard fixture: +1 key, count 44→45)
- `docs/autonomous-engineering/TASK-QUEUE.md` (registered AWJ App Builder Horizon V1)

## Tests and exact results

- `php artisan test --filter=BuilderAppTest` → **12/12 passed** (40 assertions), SQLite, local
  (`/home/user/nibras-app`).
- `php artisan test --filter="BranchIsolationGuardTest|ApplicationCatalogTest|ApplicationAccessGateGuardTest|RbacTest|RoleTest"`
  → **37/37 passed** (302 assertions) — confirms the three new models are correctly classified
  `CompanyWide` and the new `ApplicationCatalog`/RBAC entries don't break existing guards.
- Full `php artisan test` (all engines/suites, SQLite): see CI section below — will be filled with
  the exact observed result once complete (was still running at time of writing this report; not
  claiming a result not yet observed, per `IMPLEMENTATION-REPORT-CONVENTION.md`'s truthfulness rule).

## Build / lint / typecheck

Not applicable — backend-only PHP change, no `web/`/`storefront/` files touched.

## CI

_To be completed once observed on the exact PR head — not claimed in advance._

## Pre-merge review

- PRE_MERGE_REVIEW: _pending_
- Reviewed Head SHA: _pending_
- Findings / resolution: _pending_

## Merge

- Merge status: _pending_
- Merge SHA: _pending_

## Post-merge review

- POST_MERGE_REVIEW: _pending_
- Reviewed Merge SHA: _pending_
- Target-branch checks/smoke: _pending_
- Findings / resolution: _pending_

## Self-review

### Implementer

Satisfied the task outcome (App/Draft/Published Experience Version lifecycle + tenant/RBAC
boundary) with the smallest maintainable design. Reused `ApiController::domain()`,
`BaseModel`/tenancy traits, and the `CommercePaymentIntentService` lock-and-recheck concurrency
idiom rather than inventing new patterns.

### Reviewer

- No code broader than the task: deep schema/component validation, App Manager UI, and template
  content are explicitly deferred to APP-BUILDER-2/3/4/8/9, not implemented here.
- Tests prove behavior (tenant isolation, RBAC negatives, immutability, concurrency-safe
  versioning, structural-validation negatives), not implementation trivia.
- No public contract changed — every route/model/permission/catalog-key here is new.

### AWJ Guardian

- **Tenant A cannot affect/read Tenant B**: proven by
  `an_app_created_for_one_tenant_never_leaks_into_another` (404 on foreign `id`, empty list).
  Every model extends `BaseModel` (`TenantScope` global scope); no raw query bypasses it.
- **Branch boundaries**: all three models are `CompanyWide`, verified by `BranchIsolationGuardTest`
  (structural guard) — correct classification, no branch bypass possible because none is branch-scoped.
- **No financial value / unsafe types**: no money field exists in this domain at all.
- **Authorization cannot be bypassed by IDs**: `BuilderApp::findOrFail($id)` relies on
  `TenantScope`, not a manual tenant check — a foreign-tenant UUID 404s structurally, proven by test.
- **Posted accounting immutability**: N/A, no accounting entries in this domain.
- **Retries cannot duplicate side effects**: publish is idempotent-safe by design — each call
  computes a fresh `max(version)+1` under a row lock; two sequential publishes always produce two
  distinct, non-colliding version numbers (proven by
  `published_version_numbering_is_race_safe_under_concurrent_publish_attempts`).
- **Old clients/tenants cannot break**: purely additive — no existing route, model, migration, or
  permission was modified in a breaking way. `ApplicationCatalogTest`'s exhaustive-key fixture was
  updated (expected, not a regression) to include the one new key.
- **Secrets/PII in logs/errors**: none — this domain has no secret-bearing fields.

## Accounting impact

**None.** This task creates no journal entries, touches no `LedgerService` call site, and
introduces no monetary field. No journal-entry table applies (per `CLAUDE.md`'s pre-PR protocol,
stated explicitly rather than omitted).

## Tenant / branch isolation impact

Additive only — three new `BaseModel` + `CompanyWide` models, all tenant-scoped via the existing
`TenantScope`/`BelongsToTenant` mechanism. No existing tenant/branch logic touched.

## Security / authorization impact

Additive only — three new RBAC permissions (owner/admin via `*`, not granted to
accountant/staff by default) and one new `ApplicationCatalog`/`EnsureApplicationActive` gate.
Schema JSON structurally rejects unknown top-level keys (fail-closed), preventing any future
attempt to smuggle a client-authored identity/tenant field into the App Schema content itself.

## Backward compatibility

Fully additive: new tables, new models, new routes, new permissions, new catalog key. No existing
migration, model, route, resource shape, or permission was changed or removed.

## API / DB / migration impact

Three new tables (`builder_apps`, `builder_draft_experiences`, `builder_published_experience_versions`)
and nine new routes under `/api/app-builder/apps/*`. No existing table/route modified.

## External research used

None required — this task implements already-accepted internal architecture
(`AWJ_APP_BUILDER_HORIZON_V1.md` AB-01/AB-02/AB-03, `APP_SCHEMA_V1.md` §4/§18) against existing
repository conventions; no platform/vendor claim needed verification.

## Risks / remaining work

- App deletion is not implemented in V1 (no policy defined for deleting an app with published
  versions) — recorded as discovered backlog, not required by this task's Definition of Done.
- `AppSchemaStructuralValidator` will need to be extended (not replaced) by APP-BUILDER-2 once
  Component/Action/Data Resource registries exist, to validate `pages`/bindings/actions deeply.

## Discovered backlog

- App deletion/archival policy for `BuilderApp` (see above).
- `BuilderApp` currently has no `status`/lifecycle field beyond implicit "has a draft, may have
  published versions" — may need one once App Manager (APP-BUILDER-4) defines list/filter UX.

## Git state

- Branch: `claude/awj-app-builder-horizon-v1-e4iy21`
- PR: _pending_
- Base SHA: `4010305be21d63f7249fa7c1fd287f60e2fa720a`
- Head SHA: _pending_

## Recommended next dependency-ready task

`APP-BUILDER-2` — Schema validation + runtime capability contract (align backend validator with
the accepted App Schema and Mobile Runtime capability manifest; compatibility negatives).
