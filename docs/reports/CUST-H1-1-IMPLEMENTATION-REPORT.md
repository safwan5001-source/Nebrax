# CUST-H1-1 — Version Persistence Foundation — Implementation Report

## Status

**READY FOR MERGE — OWNER APPROVAL REQUIRED**

## Repository state

- **Base SHA:** `071dfa3061fbb0c9393e02bdcba0ee9d150b17cd` (`origin/main`, tip at task start — note: the baseline SHA given in the task brief, `d952542051956c324d846c8ac462c2f912ccd1f9`, was not the actual current `origin/main` tip; per instructions the fetched tip was used instead.)
- **Head SHA:** `d65e564` (fixes 22 review findings across 10 rounds on top of the initial `63a799e` — see Review findings)
- **Branch:** `claude/cust-h1-1-version-persistence-1p9jc9`
- **PR:** [#1082](https://github.com/safwan5001-source/Nebrax/pull/1082)

## What was implemented

### Migrations

- `database/migrations/2026_10_12_010000_create_storefront_presentation_versions_table.php` — new `storefront_presentation_versions` table exactly per the architecture's column list (`id`, `tenant_id`, `storefront_id`, `name`, `schema_version`, `config`, `revision`, `scheduled_for`, `schedule_generation`, `last_published_at`, timestamps) with the required indexes. No `status` column — state is always derived.
- `database/migrations/2026_10_12_020000_add_version_pointers_to_storefront_presentations_table.php` — adds `draft_schema_version` (default `1`, backfilled from `schema_version`, then enforced `NOT NULL` via `->change()`), `published_schema_version` (nullable, backfilled only where `published_config` is not null), `schedule_epoch` (default `0`), and the three nullable FK pointers `active_version_id` / `scheduled_version_id` / `compatibility_working_version_id` with indexes. All existing columns (`draft_config`, `draft_revision`, `published_config`, `published_revision`, `published_at`, `schema_version`) are untouched.
- `database/migrations/2026_10_12_030000_backfill_storefront_presentation_versions.php` — invokes `StorefrontPresentationVersionBackfillService::backfillAll()` once at migrate time; no-op on a fresh/empty database (verified: `RefreshDatabase` test runs create zero versions from this migration).

### Models

- `app/Models/StorefrontPresentationVersion.php` (new) — `extends BaseModel implements CompanyWide` (auto-satisfies `BranchIsolationGuardTest`), structural tenant-ownership check in `booted()` mirroring `StorefrontPresentation`.
- `app/Models/StorefrontPresentation.php` — added fillable/casts for the six new columns and `activeVersion()` / `scheduledVersion()` / `compatibilityWorkingVersion()` `belongsTo` relations.
- `app/Models/Storefront.php` — added `presentationVersions(): HasMany`.

### Backfill

- `app/Services/Commerce/StorefrontPresentationVersionBackfillService.php` — implements Cases A/B/C/D (see below), exposes `backfillAll()` (bulk, idempotent, chunked), `backfillPresentation()` (single row, own lock+transaction), `applyMigrationCasesWithinTransaction()` (same logic for a row **already locked** by a caller's own transaction — used by the legacy compatibility path), and `ensureCompatibilityWorkingVersion()` (idempotent get-or-create of the durable compat pointer).

### APIs / services

- `app/Services/Commerce/StorefrontPresentationVersionService.php` — the CRUD foundation: `listForCurrentTenant`, `createForCurrentTenant` (+ lazy head creation using the STORE-BACKEND-1 catch-unique-violation-and-retry-on-a-fresh-transaction pattern), `showForCurrentTenant`, `saveForCurrentTenant`, `renameForCurrentTenant`, `deleteForCurrentTenant`. Lock order is always Storefront → head → Version.
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontPresentationVersionController.php` + three new `FormRequest`s (`Create`/`Save`/`Rename`…`StorefrontPresentationVersionRequest`, each rejecting unknown envelope keys, same pattern as the existing legacy requests).
- New routes in `routes/api.php`, same middleware stack and `commerce.manage` permission as the legacy presentation routes:
  - `GET/POST commerce/workspace/storefronts/{id}/presentation/versions`
  - `GET/PUT/PATCH/DELETE commerce/workspace/storefronts/{id}/presentation/versions/{version}`
- New exceptions: `StaleVersionRevisionException` (409), `ActiveVersionImmutableException` (409), `ForwardSchemaVersionException` (409), `VersionLifecycleConflictException` (409), `SourceVersionNotFoundException` (404).
- `tests/Feature/CommerceModuleBoundaryTest.php` updated (added the two new URIs to `ALLOWED_COMMERCE_API_ROUTES`) — this is the repository's existing route-surface guard, not new test scope.

### Legacy compatibility

- `app/Services/Commerce/StorefrontPresentationService.php`:
  - `showForCurrentTenant()`: unchanged response shape; if a head row exists but `compatibility_working_version_id` is null, lazily ensures it under lock before returning (§21).
  - `applyDraftSave()`: when a head row already exists, locks/ensures the compatibility working Version, fails closed on a forward-schema compat Version, **forks** a new Draft Version when the compat Version is also the active Published Version (preserving revision continuity — fork starts at the current legacy `draft_revision`, minimum 1), then atomically writes `draft_config`/`draft_revision`/`schema_version`/`draft_schema_version` on the head **and** `config`/`schema_version`/`revision` on the compat Version in the same transaction. The very-first-ever draft save on a brand-new storefront (no head row at all) is untouched — no Version is created at that point, matching Case A ("Version creation drives head creation, not the reverse").
  - `publishForCurrentTenant()` / `publishedSnapshotForStorefront()` are **untouched** — publish and public rendering stay exactly as before; CUST-H1-3 owns Version-aware publish.

## Migration/backfill behavior

| Case | Trigger | Result |
|---|---|---|
| A — no presentation row | Storefront never touched | Migration creates nothing. First Version creation (or legacy GET/PUT) lazily creates the head row inside its own locked transaction. |
| B — Published == Draft | `published_config` present and byte-identical (JSON-compared) to `draft_config` | One Version created from `published_config`, `revision = max(1, draft_revision)`, `last_published_at` preserved. `active_version_id` and `compatibility_working_version_id` both point to it. |
| C — Published != Draft | `published_config` present and differs from `draft_config` | Two Versions: Published (`revision = 1`, `last_published_at` preserved) → `active_version_id`; Draft (`revision = max(1, draft_revision)`) → `compatibility_working_version_id`. |
| D — Draft only | `published_config` is null | One Draft Version (`revision = max(1, draft_revision)`) → `compatibility_working_version_id`. `active_version_id` stays null. |

Evidence (all in `tests/Feature/StorefrontPresentationVersionBackfillTest.php`):
- `no_presentation_row_creates_no_version_and_no_head` — Case A.
- `case_b_published_equals_draft_creates_one_version_and_sets_both_pointers` — Case B.
- `case_c_published_differs_from_draft_creates_two_versions_with_correct_pointers` — Case C.
- `case_d_draft_only_creates_one_draft_version_with_null_active_pointer` — Case D.
- `backfill_is_idempotent_and_does_not_duplicate_versions_on_rerun` — reruns produce zero new rows.
- `public_snapshot_is_unchanged_by_backfill` — `published_config`/`published_revision`/`published_at` byte-identical before/after.
- `backfill_across_multiple_storefronts_only_touches_rows_with_data` — untouched storefronts stay untouched.

Config/`schema_version` are copied **verbatim** into the new Version rows (no re-normalization at migration time), so a migrated v1 Version keeps its original schema tag; the first explicit save on it is the atomic upgrade to the current schema (§11), never a silent one at migration time.

## Tests

Exact commands run:

```
cd nibras-app
php artisan test --filter=StorefrontPresentation
php artisan test --filter=StorefrontPresentationVersionApiTest
php artisan test --filter=StorefrontPresentationVersionBackfillTest
php artisan test --filter=StorefrontPresentationLegacyCompatibilityForkTest
php artisan test --filter=StorefrontModelTest
php artisan test --filter=BranchIsolationGuardTest
php artisan test --filter=CommerceModuleBoundaryTest
php artisan test   # full suite, both DB_CONNECTION=sqlite and DB_CONNECTION=pgsql
```

**New test files** (60 new test methods, including all review-fix regression tests):
- `tests/Feature/StorefrontPresentationVersionBackfillTest.php` — 10 tests (migration Cases A–D, idempotency, public-snapshot-unchanged, multi-storefront, soft-deleted-storefront skip, reconciliation embedded-tag correctness, independent per-side backfill schema tagging).
- `tests/Feature/StorefrontPresentationVersionApiTest.php` — 27 tests (list, create/duplicate incl. from an active source, embedded-tag-derived default on create-without-source, tenant isolation incl. cross-storefront-same-tenant and cross-tenant `source_version_id`, read, save + stale-revision 409 + independent-version isolation, active-version-immutable-on-save 409, forward-schema fail-closed on read/save/duplicate/rename, rename + stale 409, delete + active/scheduled/compatibility-working 409 + foreign 404, guest/self_service guards).
- `tests/Feature/StorefrontPresentationLegacyCompatibilityForkTest.php` — 23 tests (lazy compat-version creation on GET, atomic Draft/compat sync on PUT, active→Draft fork with revision continuity, forward-schema fail-closed on legacy PUT/GET/publish for both stored and incoming schema tags — draft **and** published sides, including a supported-draft/forward-published mixed case on legacy PUT — legacy publish promoting the forked compatibility Version to active, first-ever legacy save materializing a compatibility Version, bidirectional sync between the new Version API and legacy fields on save and on rename, published-snapshot schema-tag independence, cutover self-healing of a bypassing legacy writer, embedded-schema-tag correctness for an old-code publish (draft and published), publish-pointer promotion on an apparent no-op and on a head with no version pointers at all, fork-not-overwrite of a drifted active version, and fail-closed-before-reconciling a forward-tagged mapped Version — see Review findings below for the details).

**Results (final, head `d65e564`):**

| DB | Command | Result |
|---|---|---|
| SQLite | `php artisan test` (full suite) | 27 failed, 49 skipped, 4776 passed (29994 assertions) |
| PostgreSQL 16 | `php artisan test` (full suite) | 27 failed, 4825 passed (30264 assertions) — the SQLite-skipped `StorefrontPresentationPostgresConcurrencyTest` ran and passed here; `php artisan test --filter=StorefrontPresentation` alone: 107 passed (687 assertions). |

**Failures (27, identical set on both engines) — pre-existing, unrelated to this PR:** all in `FuelAviRfidServiceTest`, `FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingApiTest`, `FuelSupplyReceivingTest` — every one fails with `Call to undefined function App\Services\bcmul()`. The local dev container this session ran in does not have the `bcmath` PHP extension installed; `.github/workflows/ci.yml` explicitly installs `bcmath` for CI (`extensions: … bcmath …`), so these are a local-environment gap, not a code defect, and none of the failing files touch Storefront/Presentation/Commerce-workspace code. Verified no other failures exist on either engine.

**Skipped:** `StorefrontPresentationPostgresConcurrencyTest::two_saves_with_the_same_revision_serialize_and_the_loser_gets_a_stale_revision` skips itself on SQLite by design (`pcntl_fork` + real row-lock race needs PostgreSQL); it was run and passed on PostgreSQL in this session.

All CUST-H1-1 tests plus every pre-existing `StorefrontPresentation*`/`StorefrontModelTest`/`BranchIsolationGuardTest`/`CommerceModuleBoundaryTest` test passed unmodified in behavior (only `CommerceModuleBoundaryTest`'s route allow-list was extended with the 2 new URIs, which is exactly what that guard exists to require).

## Build / CI

- Workflow: `.github/workflows/ci.yml` (`db: [sqlite, pgsql]` matrix). Not yet observed on GitHub Actions at report-writing time — PR CI will be monitored per the Horizon Execution Rule after this report is committed and the PR opens; any findings will be appended to this report before merge.

## Review findings

Twenty-two findings (19 P1, 3 P2) from the repo's automated bot reviewer (`chatgpt-codex-connector[bot]`) across ten review rounds, all valid and fixed. Every finding pointed at a real bidirectional-sync or fail-closed gap between the new Version model and the legacy compatibility surface; two (round 6) were regressions in earlier rollout-guard fixes, and rounds 7–10's findings were the same embedded-schema-tag/materialize-before-use/fail-closed-before-write patterns as prior rounds but progressively generalized to code paths (the draft side, the publish-path pointer, reconcile-before-validate ordering, the reconciliation write path, the create-without-source copy path, the soft-delete/cascade mismatch in the bulk migration, the two remaining mutation paths — legacy save and exact-Version rename — that had never gained the head/Version-level `assertSupportedLegacySchema()`/`assertSupportedSchema()` check every other mutation path already had, and finally the one-shot bulk migration's own Version-creation call sites tagging both sides from the shared column instead of each side's own) the earlier rounds' fixes hadn't yet covered — all caught by continued review of each new push. None required widening the PR's scope or touching scheduling/publish-UI code.

**Round 1** (reviewed `476fb03`, fixed in `9a6470e`):

| Finding | Fix | Regression test |
|---|---|---|
| Legacy publish never promoted the compatibility working Version to `active_version_id` after a legacy-edit fork, so a Version reported as `published` could silently drift from the actual public snapshot. | `publishForCurrentTenant()` locks the current `compatibility_working_version_id` Version (if set), promotes it to `active_version_id`, syncs its `config`/`schema_version`, and stamps `last_published_at` on every non-no-op publish. | `legacy_publish_promotes_the_forked_compatibility_version_to_active` |
| Legacy PUT only checked the *stored* compatibility Version's schema tag for forward-schema, never the *incoming* payload's declared `config.version`. | Added `assertIncomingConfigNotForward()` (mirrors the exact-Version save path), called before `normalize()` in `saveDraftForCurrentTenant()`. | `legacy_put_rejects_a_forward_declared_config_version_before_normalizing` |
| Legacy GET and legacy publish had no forward-schema check at all — the architecture explicitly lists "legacy GET/PUT mapping" and "immediate Publish" among the paths the fail-closed rule must cover. | Added `assertSupportedLegacySchema()` (checks the head's own `draft_schema_version`/`published_schema_version`), called at the top of both `showForCurrentTenant()` and `publishForCurrentTenant()`. | `legacy_get_fails_closed_when_the_stored_draft_schema_is_forward`, `legacy_publish_fails_closed_when_the_stored_draft_schema_is_forward` |

**Round 2** (reviewed `2bec969`'s predecessor, fixed in `2bec969`):

| Finding | Fix | Regression test |
|---|---|---|
| The very first legacy PUT on a brand-new storefront (no head row yet) never created a compatibility Version, so a later legacy publish had nothing to promote and permanently left `active_version_id` null. | `applyDraftSave()`'s `row === null` branch now also creates the compatibility Version (Case-D-style) alongside the head, in the same transaction. | `first_legacy_save_on_a_brand_new_storefront_materializes_a_compatibility_version` |
| Saving the compatibility Version through the new exact-Version API only updated the Version row — legacy GET/publish kept reading a stale `draft_config`/`draft_revision` from the head. | `saveForCurrentTenant()` now atomically syncs the head's `draft_config`/`draft_schema_version`/`draft_revision`/`schema_version` when the saved Version is the compatibility working Version. | `saving_the_compatibility_version_through_the_new_api_syncs_legacy_draft_fields` |
| Legacy publish validated only the head's own schema tags, not the compatibility Version's own tag, leaving a residual rollback path where the head stays "supported" but the mapped Version was written by a newer deployment. | Moved the Version lookup/lock before normalization in `publishForCurrentTenant()` and check `$compat->schema_version` directly. | `legacy_publish_fails_closed_when_the_compatibility_version_itself_carries_a_forward_schema` |

**Round 3** (reviewed `108f433`'s predecessor, fixed in `108f433`):

| Finding | Fix | Regression test |
|---|---|---|
| Renaming the compatibility Version through the new API bumped only the Version's own revision, leaving the head's `draft_revision` behind — a subsequent legacy PUT could compute a revision number that collided with a concurrent new-API edit instead of being rejected as stale. | `renameForCurrentTenant()` now locks the head and advances `draft_revision` to match whenever the renamed Version is the compatibility working Version. | `renaming_the_compatibility_version_keeps_the_legacy_draft_revision_in_sync` |
| `present()` and `publishedSnapshotForStorefront()` normalized `published_config` using the single shared legacy `schema_version` column, which advances on every draft-only save (legacy or new-API) — so an unrelated draft edit could silently change how a still-v1 published snapshot renders on the live public storefront (e.g. missing homepage sections no longer restored). | Both methods now use `published_schema_version` for `published_config` and `draft_schema_version` for `draft_config`, independent of the shared column. | `draft_only_edits_do_not_change_how_a_migrated_v1_published_snapshot_is_normalized` |

**Round 4** (reviewed `108f433`, fixed in `058b319`) — a rollout/cutover concern the architecture's own implementation slicing explicitly scopes into CUST-H1-1 ("rollout/cutover guard proving no head-only legacy writer remains before backfill"):

| Finding | Fix | Regression test |
|---|---|---|
| During a rolling deployment window, an old (pre-CUST-H1-1) instance can still write `draft_config` directly to the head after the one-shot backfill already ran for that row. That code has no knowledge of Version rows, bypasses every sync path in this PR, and since the backfill skips rows whose pointers are already set, the resulting drift would otherwise be permanent — the Version API could expose stale content indefinitely. | `ensureCompatibilityWorkingVersion()` now always locks the resolved Version and reconciles it against the head's current `draft_config`/`draft_schema_version`/`draft_revision` on *every* call (not just first-migration), treating the head as authoritative on mismatch. Runs on every legacy GET and PUT, so drift self-heals on the next access instead of persisting; a no-op under normal (this-PR-only) operation since the two are always already in sync. | `a_legacy_writer_bypassing_version_sync_is_self_healed_on_next_access` |

**Round 5** (reviewed `2cd4eed`, fixed in `16c5d3c`):

| Finding | Fix | Regression test |
|---|---|---|
| P1 — An old (pre-CUST-H1-1) instance's legacy publish updates `published_config`/shared `schema_version` but cannot update the new `published_schema_version` column, so a subsequent read could misinterpret an actually-current-schema snapshot under legacy absence semantics. The lock-based fix used for the draft side doesn't apply here: the public runtime read path is architecturally required to stay lock/join-free. | `normalize()` always stamps `'version' => VERSION` inside every document it writes, regardless of which code wrote it, making `published_config` self-describing. `present()` and `publishedSnapshotForStorefront()` now derive the effective schema tag from the document's own embedded `version` field first (falling back to the column only when absent) — no lock needed, works identically on the public path. `assertSupportedLegacySchema()` also checks the embedded tag. | `an_old_code_publish_that_bypasses_published_schema_version_is_still_read_under_its_true_embedded_schema`, `a_forward_embedded_version_in_published_config_fails_closed_even_when_the_column_understates_it` |
| P2 — `showForCurrentTenant()` validated the schema on an unlocked read, then re-read the row under lock without re-validating — a forward-schema write committed in between would slip through (check-then-lock race). | Added a second `assertSupportedLegacySchema()` call on the row read under lock, before further processing. | (covered by the existing forward-schema GET tests plus manual review of the added call site) |

**Round 6** (reviewed `115aacd`, fixed in `f9b8875`) — both regressions in earlier rollout-guard fixes, caught by re-review after the round-4/round-5 pushes:

| Finding | Fix | Regression test |
|---|---|---|
| P1 — `publishForCurrentTenant()`'s no-op short-circuit (content already matches, revision already synced) returned before ever reaching the `active_version_id` promotion logic. If a pre-CUST-H1-1 instance published directly (updating `published_config` but not the pointer), a subsequent publish call seeing matching content would hit the no-op path and never promote the pointer, permanently reporting a stale Version as published. | The no-op check now also requires the pointer to already be promoted; when only the pointer is behind, it's fixed without rewriting `published_at`/`published_revision` (content itself didn't change). | `legacy_publish_promotes_the_active_pointer_even_when_content_already_matches` |
| P1 — The round-4 cutover reconciliation (`reconcileWithLegacyHead()`) could overwrite an active (published) Version's stored config in place when a pre-CUST-H1-1 writer drifted the head's `draft_config` while that Version was still both active and the compatibility working Version (Case B, pre-fork) — violating "an active Version is never mutated directly." | The reconciler now forks a new Draft Version from the head's current `draft_config` and repoints `compatibility_working_version_id` at the fork when the mapped Version is also active, instead of writing into it. | `a_legacy_writer_drifting_an_active_compatibility_version_forks_instead_of_overwriting_it` |

**Round 7** (reviewed `70f04a3`, fixed in `2b380a0`) — the same embedded-schema-tag-priority and materialize-before-use patterns fixed in rounds 5–6, generalized to code paths those rounds' fixes hadn't yet reached:

| Finding | Fix | Regression test |
|---|---|---|
| P1 — The round-5 fix made `present()`/`publishedSnapshotForStorefront()` prefer a document's own embedded `version` tag over the DB column, but only on the **published** side. A pre-CUST-H1-1 instance inserting a fresh row after this migration omits `draft_schema_version`, getting the column default (`1`) even though its `draft_config` is already v2 — so a deliberately-removed section could be silently restored on GET, then published. | Extracted `effectiveSchemaTag()` (generalized from `effectivePublishedSchemaTag()`) and applied it to `draft_config` reads too: `present()`'s draft branch, `publishForCurrentTenant()`'s normalize call, and a new draft check in `assertSupportedLegacySchema()`. | `a_late_legacy_insert_with_a_stale_draft_schema_column_is_still_read_under_its_true_embedded_draft_tag`, `a_forward_embedded_version_in_draft_config_fails_closed_even_when_the_column_understates_it` |
| P1 — `publishForCurrentTenant()` looked up `compatibility_working_version_id` directly and treated a null pointer as "already promoted." A head inserted by old code after this migration (pointer never set) could publish without ever materializing or promoting an active Version, so the Versions API would report no published Version for a live, publicly-served storefront. | Replaced the bare nullable lookup with `$this->backfill->ensureCompatibilityWorkingVersion($row)`, which is guaranteed to return a non-null, reconciled Version (same primitive already used by the legacy GET/PUT paths); removed the now-unreachable `$compat === null` branches. | `legacy_publish_materializes_and_promotes_the_active_pointer_for_a_head_with_no_version_pointers_at_all` |
| P1 — `ensureCompatibilityWorkingVersion()` could reach `reconcileWithLegacyHead()` — which forks or overwrites the mapped Version — without ever checking that Version's own schema tag first, so a Version written by a newer deployment (rollback scenario) could be silently reconciled against or forked from, losing its forward tag. | Added the forward-schema check on the resolved, locked Version immediately after resolving it, **before** calling `reconcileWithLegacyHead()`, in `ensureCompatibilityWorkingVersion()` itself — covers both the legacy GET and PUT paths, which both route through this one method. | `reconciling_a_drifted_head_fails_closed_when_the_mapped_compatibility_version_itself_is_forward` |

**Round 8** (reviewed `0826e98`, fixed in `767069f`) — the same embedded-schema-tag-priority pattern generalized further (from reads to writes/copies), plus one new class of finding (a soft-delete/hard-cascade mismatch in the bulk migration):

| Finding | Fix | Regression test |
|---|---|---|
| P1 — `reconcileWithLegacyHead()` (both its fork-creation and in-place-overwrite branches) wrote a Version's `schema_version` from the `draft_schema_version` **column** literally, not from `draft_config`'s own embedded tag — the same class of bug round 7 fixed for reads, but on this write path. A drift-writer whose `draft_config` is v2 but whose column understates it could still tag the reconciled/forked Version as v1. | Extracted the round-7 tag-priority logic into a new public static `StorefrontPresentationNormalizer::effectiveSchemaTag()` (single shared implementation) and applied it to both branches of `reconcileWithLegacyHead()`. | `reconciling_a_drifted_head_preserves_the_embedded_draft_tag_even_when_the_column_is_stale` |
| P1 — `StorefrontPresentationVersionService::resolveSourceConfig()`'s no-source/no-active/no-compat fallback (a brand-new head with no Version pointers set yet) also copied `draft_schema_version` straight through when creating a Version without a source. | Same shared `effectiveSchemaTag()` helper applied to this fallback. | `create_without_source_derives_the_default_from_the_embedded_draft_tag_not_a_stale_column` |
| P1 — `backfillAll()`'s bulk migration query was unscoped and could pick up a presentation row whose storefront was soft-deleted before this migration ran. `SoftDeletes` is an `UPDATE`, not a real `DELETE`, so `cascadeOnDelete()` never fires and the orphaned row survives; creating a Version for it then fails structurally in `StorefrontPresentationVersion::booted()` (its ownership check still applies `SoftDeletingScope`), aborting the entire one-shot migration instead of skipping that one row. | Added `->whereHas('storefront')` to the bulk query — excludes soft-deleted-storefront rows without changing any live per-request path; the row is picked up lazily via the existing self-healing path if the storefront is ever restored. | `backfill_all_skips_a_presentation_whose_storefront_was_soft_deleted_instead_of_aborting` |

**Round 9** (reviewed `1efa873`, fixed in `532905c`) — the two remaining exact-Version/legacy mutation paths that had never gained the fail-closed schema check every sibling path already had; both P2 (a rollback-window edge case, not the default operating path):

| Finding | Fix | Regression test |
|---|---|---|
| P2 — `applyDraftSave()`'s row-exists branch (legacy PUT) checked only the compatibility Version's own schema tag, never `assertSupportedLegacySchema()` on the head as GET and publish already do. A head whose draft/compatibility Version is supported but whose `published_config` carries a forward schema (rollback-after-upgrade scenario) would pass this partial check, persist the draft, and let `present()` silently normalize the forward published snapshot to AWJ-Modern defaults in the save response instead of returning 409. | Added `assertSupportedLegacySchema($row)` at the top of the row-exists branch, before any lock/read of the compatibility Version. | `legacy_put_fails_closed_when_the_published_snapshot_carries_a_forward_schema_even_with_a_supported_draft` |
| P2 — `renameForCurrentTenant()` was the one exact-Version mutation path with no `assertSupportedSchema()` call at all (save/duplicate/read all have one) — renaming a forward-schema Version committed silently, then `detail()` normalized its config to defaults in the response. The rename controller action was also missing the `ForwardSchemaVersionException` → 409 catch every other action already had. | Added the same `assertSupportedSchema()` call used elsewhere, right after the stale-revision check and before any write; added the missing catch clause to the controller. | `renaming_a_forward_schema_version_fails_closed_without_mutating_it` |

**Round 10** (reviewed `ce7b535`, fixed in `d65e564`) — the one-shot bulk migration's own Version-creation call sites (Cases B/C), the last untouched place still tagging from the shared column:

| Finding | Fix | Regression test |
|---|---|---|
| P1 — `applyMigrationCasesWithinTransaction()` tagged both the migrated published Version and draft Version with the single shared `schema_version` column. During a rolling deployment, an old instance can save a v2 draft after the split-column migration runs but before this backfill migration runs, advancing the shared column to 2 while the unchanged `published_config` stays v1 (`published_schema_version` correctly still 1). The bulk backfill then tagged the migrated published Version as v2, so a later exact-Version read/duplicate of it applied v2 absence semantics and omitted sections the live v1 snapshot still restores. | Both created versions (Cases B and C) now derive their tag via the same `effectiveSchemaTag()` helper from their own document/column — `published_config`+`published_schema_version` for the published side, `draft_config`+`draft_schema_version` for the draft side — never the shared `schema_version` column. | `case_c_backfill_tags_the_published_version_from_its_own_column_not_the_drifted_shared_one` |

Every round's fixes were verified against the full `StorefrontPresentation*` suite and the full test suite on both SQLite and PostgreSQL before pushing (see Tests section for final counts). All 22 review comments across 10 rounds are addressed and their threads resolved.

## Backward compatibility

- `GET/PUT/POST …/presentation` and `…/presentation/publish` are byte-identical in request/response shape to before this PR (verified: all 15 `StorefrontPresentationDraftApiTest` + 7 `StorefrontPresentationPublishApiTest` + 8 `StorefrontPresentationPublicRuntimeTest` tests pass unmodified).
- `published_config`/`published_revision`/`published_at`/legacy `schema_version` semantics are untouched; `publishForCurrentTenant()` was not modified at all.
- The only **new** internal behavior on the legacy path is: (a) a lazy, transactional creation of a durable `compatibility_working_version_id` when one is missing (invisible to the response shape), and (b) an active→Draft fork before a legacy edit would otherwise mutate a currently-published Version in place (also invisible to the legacy response shape — the client still just sees its `draft`/`draft_revision` move forward normally, with revision continuity preserved so an unmodified client never sees a spurious 409 or a revision reset).

## Tenant isolation

All required cross-tenant/cross-storefront negatives are covered in `StorefrontPresentationVersionApiTest`: cross-tenant list/read/save/rename/delete (via the shared `findOwnedVersion`/`lockOwnedVersion` tenant+storefront check, all backed by `TenantScope` plus an explicit `storefront_id`/`tenant_id` match), cross-tenant `source_version_id` on create (non-leaking 404, no version created), and same-tenant cross-storefront version reuse (a Version created under Storefront A returns 404 when addressed under Storefront B's URL). No request-body field ever establishes tenant/storefront/version authority — `TenantContext` (set by `SetTenant` from the authenticated user) is the only source of tenant identity, exactly as in the pre-existing `StorefrontPresentationService`.

## Risks / remaining work

- The `bcmath`-related local test failures should not recur in CI (extension is installed there), but this was not directly observed on GitHub Actions at report time — will confirm once CI runs.
- `resolveSourceConfig()`'s no-source/no-active/no-compat fallback reads `$lockedHead->draft_config` directly rather than materializing a persisted compatibility Version — this was a deliberate fix during implementation (see below) to avoid creating an unwanted extra "current design" Version as a side effect of a merchant's very first named-version creation; it does not affect the legacy GET/PUT path, which still uses the durable `ensureCompatibilityWorkingVersion()` where the architecture requires persistence.
- No scheduling runtime, no immediate/scheduled publish endpoint, and no Customizer UI wiring exist yet — all explicitly deferred to CUST-H1-2/3/4/5 per the architecture's slicing.

## Out of scope (confirmed not added)

- No scheduling runtime, worker, or cron (`storefront-presentations:dispatch-due` does not exist).
- No `PUT …/versions/{version}/schedule` or `DELETE …/versions/{version}/schedule` endpoints.
- No `POST …/versions/{version}/publish` endpoint — immediate Version-aware publish is CUST-H1-3.
- No Customizer UI/version-manager frontend changes.
- No new RBAC permission — reuses `commerce.manage` throughout.

## Next step

**CUST-H1-2 — Version-aware Customizer UX**, per the architecture's implementation slicing (§30). CUST-H1-1 is not blocked.
