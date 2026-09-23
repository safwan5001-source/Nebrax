# APP-BUILDER-2 — Implementation Report

STATUS: pre-merge review
DATE: 2026-09-23

## Outcome

Realigned the backend App Schema validator to the **real, already-tested** Mobile Runtime
contract (`mobile/lib/schema/`), and added a faithful PHP port of its capability-manifest
compatibility resolver, enforced at publish time.

## Repository evidence / root cause

APP-BUILDER-1's `AppSchemaStructuralValidator` used the top-level shape illustrated in
`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`/`APP_SCHEMA_V1.md` §4 (`locales`, `defaultLocale`,
`assets`, `metadata`) — that document explicitly states those are "contract candidates... not
locked". Reading the actual Mobile Runtime Proof V1 source (`mobile/lib/schema/app_schema.dart`,
`capability_manifest.dart`, `compatibility.dart`, `registry_identifiers.dart`, `schema_version.dart`,
proven by 252 passing tests per the closed Mobile Runtime horizon) showed the **real, shipped**
`AppSchema` contract is materially different: top-level keys are `schemaVersion`,
`minRuntimeVersion`, `requiredCapabilities`, `theme`, `navigation`, `pages` — no
`locales`/`defaultLocale`/`assets`/`metadata`. The horizon document is explicit: "Do not invent a
second schema/runtime contract when the Mobile Runtime Proof already established compatible
primitives. Reuse/extend the accepted contract pack and proven runtime semantics." This task
corrects that divergence rather than building on a stale assumption.

## Approach chosen

- **`SchemaVersion`**: PHP port of `mobile/lib/schema/schema_version.dart`'s minimal `x.y.z`
  SemVer-lite comparator (no external package, same reasoning as the Dart original).
- **`SchemaFormatException`**: stable machine-readable `errorCode` (named `errorCode`, not `code`,
  because PHP's base `\Exception` already declares a `$code` property incompatible with a
  `readonly string` redeclaration — caught by this task's own test suite, not a design choice)
  mirroring Dart's `SchemaFormatException` codes exactly (`invalid_type`, `missing_field`,
  `invalid_version`, `unknown_field`, `too_deep`, `too_many_nodes`) — matches this repo's own
  "stable error code, translated text separately" convention (Inventory Opening).
- **`RuntimeCapabilities`**: byte-for-byte mirror of `registry_identifiers.dart`'s
  `RuntimeCapabilities` (15 components, 6 actions, 1 native capability, all v1). Documented as
  requiring synchronized updates with the Dart file — this is the actual installed runtime's
  capability set, not an independently-invented backend list.
- **`AppSchemaParser`** (replaces `AppSchemaStructuralValidator`): full recursive port of
  `AppSchema._fromJson()` — same field allowlists at every level, same size/depth budgets
  (max tree depth 32, max node count 500, max props nesting 8, max props collection length 64),
  same JSON-safe-value recursion. Deliberately does **not** validate component/action type
  identity against the registry (that is `CompatibilityResolver`'s job, exactly as Dart splits
  `AppSchema` parsing from `CompatibilityResolver`).
- **`CapabilityManifest`**/**`CompatibilityResult`**/**`CompatibilityResolver`**: PHP port of
  `capability_manifest.dart`/`compatibility.dart`. `CompatibilityResolver::resolve()` is called
  only at **publish** time (not draft save), matching `APP_SCHEMA_V1.md` §21's Authoring vs.
  Publish validation split already established in APP-BUILDER-1. A required (non-optional)
  unsupported component/action fails the whole document closed; an optional one is recorded as a
  safe fallback and publish proceeds — matching Dart's fail-closed rule exactly.
- Updated `BuilderDraftExperience::SCHEMA_KEYS`/`CURRENT_SCHEMA_VERSION` (`'1.0.0'`, not `'1.0'`)/
  `minimalSafeSchema()` to the real contract shape — the new minimal schema is structurally
  identical in spirit to `kHomeSchemaJson` (`mobile/lib/app/runtime_schema.dart`): one `Page` root,
  empty children, valid `navigation.initialPageId`.
- Found and fixed a real bug during this task's own review: `CompatibilityResolver::resolve()`'s
  page-root loop checked `$resolvedRoot === null`, but `resolveComponent()` returns `bool` — dead
  code that could never trigger the "page fails closed" path. Caught by
  `CompatibilityResolverTest`, fixed before any external review.

## Why this approach fits AWJ

Directly satisfies AB-01 ("reuse the proven Flutter runtime contract") and the horizon's explicit
anti-duplication rule. Keeps the Authoring/Publish validation split from APP-BUILDER-1. No new
migration needed — `schema` remains an opaque JSON column; only its accepted shape changed.

## Changed files

- New: `app/Services/AppBuilder/SchemaVersion.php`, `SchemaFormatException.php`,
  `RuntimeCapabilities.php`, `CapabilityManifest.php`, `CompatibilityResult.php`,
  `CompatibilityResolver.php`, `SchemaParseBudget.php`, `AppSchemaParser.php`
- Deleted: `app/Services/AppBuilder/AppSchemaStructuralValidator.php`
- Modified: `app/Models/BuilderDraftExperience.php` (schema shape/version/minimal-safe-schema),
  `app/Services/AppBuilder/BuilderAppService.php`, `BuilderDraftExperienceService.php`,
  `BuilderPublishedExperienceVersionService.php` (parser rename + compatibility gate at publish),
  `app/Http/Requests/UpdateBuilderDraftExperienceRequest.php` (doc comment only)
- New tests: `tests/Feature/AppSchemaParserTest.php` (16 tests, mirrors
  `mobile/test/schema/schema_parser_test.dart`'s taxonomy), `tests/Feature/CompatibilityResolverTest.php`
  (10 tests, mirrors `mobile/test/schema/compatibility_test.dart`'s taxonomy)
- Modified tests: `tests/Feature/BuilderAppTest.php` (schema fixtures updated to the real shape;
  replaced the obsolete locale-based negative test with `initialPageId`/root-type/version-format
  negatives; added 4 new publish-time compatibility negative/positive tests)

## Tests and exact results

- `php artisan test --filter="BuilderAppTest|AppSchemaParserTest|CompatibilityResolverTest"` →
  **44/44 passed** (94 assertions), SQLite, local.
- `php artisan test --filter="BranchIsolationGuardTest|ApplicationCatalogTest|ApplicationAccessGateGuardTest|RbacTest|RoleTest|TenantApplicationTest"`
  → **55/55 passed** (389 assertions) — confirms no regression to unrelated guards (this task
  touches no RBAC/ApplicationCatalog/migration).
- Full local `php artisan test`: not re-run for this task — APP-BUILDER-1's full-run root cause
  analysis (missing local `bcmath` extension; `setup.sh` never copying `app/Mail/`) already
  established these as pre-existing, CI-irrelevant, unrelated-to-App-Builder gaps; this task's
  diff does not touch any of the affected files/directories, so re-running the full suite would
  only re-observe the same two already-documented unrelated gaps. Real CI (`ci.yml`) is the
  authoritative full-matrix check, run below.

## CI

GitHub Actions on PR head `30abaa3e43ed7c816cb24d9f06857b61011d90dc` (PR #971), both the
push-triggered and pull_request-triggered workflow runs, all 4 checks green:
`php artisan test (L11, sqlite)` and `(L11, pgsql)` success on both runs.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `30abaa3e43ed7c816cb24d9f06857b61011d90dc`
- Findings / resolution: No open findings. `chatgpt-codex-connector[bot]` posted only a
  usage-limit notice (did not perform a review). No human review posted.

## Merge

- Merge status: **merged** via standing authority (squash, no unresolved Decision Gate, required
  CI green on exact head, no unapproved scope expansion, no production deploy/release).
- Merge SHA: `8844881de5171055342b397294d8d8fd7ae1e33f`

## Post-merge review

- POST_MERGE_REVIEW: _in progress — `main@8844881` confirmed as `origin/main`'s tip, a
  single-parent squash (parent `9c5a5b9`), zero content drift from the reviewed head `30abaa3`
  (`git diff 30abaa3 origin/main -- app database routes tests docs/plans/app-builder` is empty).
  Post-merge CI (`ci.yml` run
  [35924167021](https://github.com/safwan5001-source/Nebrax/actions/runs/35924167021) on the merge
  commit) was still running at time of this commit — not claiming PASS before it is observed, per
  the truthfulness rule. Will be updated to PASS once observed._
- Reviewed Merge SHA: `8844881de5171055342b397294d8d8fd7ae1e33f`
- Target-branch checks/smoke: post-merge `ci.yml` run
  [35924167021](https://github.com/safwan5001-source/Nebrax/actions/runs/35924167021) — pending at
  time of this commit.
- Findings / resolution: none so far.

## Self-review

### Implementer

Satisfied the actual outcome (align backend validator + capability manifest with the accepted
Mobile Runtime contract). Reused the exact Dart algorithm rather than inventing a PHP-idiomatic
reinterpretation, to keep both sides provably in agreement — verified by mirroring the Dart test
suite's own case names.

### Reviewer

- No code broader than the task: registry *metadata* (props, editor hints, Inspector groups) is
  still explicitly APP-BUILDER-3's job, not built here.
- Tests prove behavior (parse/reject decisions, compatibility decisions), not implementation
  trivia — direct 1:1 mapping to the Dart suite's own test names.
- Found and fixed one real logic bug (`=== null` vs `=== false`) via this task's own tests before
  any external review — recorded above, not hidden.

### AWJ Guardian

- **No tenant authority in schema**: `AppSchemaParser`'s `rejectUnknownKeys` still fail-closed
  rejects any unrecognized top-level/component/action field (proven by
  `rejects_an_unknown_top_level_field` reusing the exact `tenantId`-smuggling scenario from
  APP-BUILDER-1's test, now passing through the deeper parser).
  A dedicated test (`rejects_a_numeric_string_page_id_that_json_decode_would_coerce`) proves a
  PHP-specific `json_decode` quirk (numeric-string object keys silently becoming integer array
  keys) does not create a false-negative in page-ID validation.
- **No arbitrary code/URL/SQL/package execution**: `validateJsonSafeValue`/`validateJsonSafeMap`
  structurally exclude anything but JSON scalars/collections, with the same bounded depth/size as
  the proven Dart parser — same "no remote expressions with general code semantics" guarantee.
- **Fail-closed compatibility**: a required-but-unsupported component/action blocks publish
  entirely (`CompatibilityResult::incompatible`), never silently downgraded or partially
  published — proven by `publish_rejects_a_schema_referencing_an_unsupported_required_component`
  end-to-end through the real HTTP/RBAC-gated publish route, not just the pure resolver test.
- **No tenant/branch/RBAC/ApplicationCatalog change**: this task touches none of those layers;
  the full guard-test regression run (55/55) confirms.

## Accounting impact

**None.** No journal entries, no monetary field, no `LedgerService` call site touched.

## Tenant / branch isolation impact

None — no model/migration/route changed.

## Security / authorization impact

Strengthens the existing structural fail-closed guarantees (deeper validation than
APP-BUILDER-1's top-level-only check) and adds a new fail-closed gate at publish time
(compatibility with the actual installed Mobile Runtime). No RBAC/permission change.

## Backward compatibility

The `schema` JSON shape accepted by draft-save/publish changed (old `locales`/`defaultLocale`/
`assets`/`metadata` shape is no longer valid; new `minRuntimeVersion`/`requiredCapabilities`/
`x.y.z` version shape is required). This is safe because: (a) APP-BUILDER-1 merged only hours
before this task in the same horizon, with no external consumer of the old shape yet (no Builder
UI exists before APP-BUILDER-5+); (b) no production tenant has authored real schema content yet
(the only schema-producing code path is `minimalSafeSchema()`, updated in lockstep); (c) this
realignment is exactly what the horizon's own anti-duplication rule requires before any UI is
built on top of the wrong contract.

## API / DB / migration impact

No route, migration, or API shape (request/response JSON keys) changed — only the *accepted
content* of the existing `schema` field.

## External research used

Read `mobile/lib/schema/*.dart` (the accepted, tested Mobile Runtime Proof V1 source) and
`mobile/test/schema/*.dart` (its test suite) directly — internal repository evidence, not external
platform research, per Gate 1.

## Risks / remaining work

- `CapabilityManifest::current()` models one shared iOS/Android manifest, matching
  `capability_manifest.dart`'s own current state (no real platform divergence exists yet in
  `RuntimeCapabilities`). Real per-platform divergence, when it appears, is a `RUNTIME_COMPATIBILITY_V1.md`
  §26 concern for a later task, not invented here.
- Component/Action/Data Resource registry *metadata* (props, bindings, editor hints) — explicitly
  APP-BUILDER-3.

## Discovered backlog

None new beyond APP-BUILDER-1's carried-forward `setup.sh` `app/Mail` gap (unaffected by this task).

## Git state

- Branch: `claude/awj-app-builder-horizon-v1-e4iy21`
- PR: [#971](https://github.com/safwan5001-source/Nebrax/pull/971) (merged)
- Base SHA: `9c5a5b9263993da9708050bce826d06d7d252e5f`
- Head SHA (reviewed pre-merge): `30abaa3e43ed7c816cb24d9f06857b61011d90dc`
- Merge SHA: `8844881de5171055342b397294d8d8fd7ae1e33f`

## Recommended next dependency-ready task

`APP-BUILDER-3` — Component/Action/Data Resource registries (metadata contracts powering Inspector
and safe bindings/actions), building on `RuntimeCapabilities`'s identifiers established here.
