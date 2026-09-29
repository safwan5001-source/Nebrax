# CUST-H1-3 — Immediate Version Publishing — Implementation Report

## Status

**READY FOR MERGE — OWNER APPROVAL REQUIRED**

## Repository state

- **Base SHA:** `ab88efc773e2580c3eecb009624d7cf60b76a283` (`origin/main` tip at task start, confirmed with a fresh `git fetch origin main` before starting — matches the SHA given in the task brief exactly).
- **Head SHA:** `50cfb5675fcfb38cfa2063bf666d3a1cf6ce8edc`
- **Branch:** `feat/cust-h1-3-immediate-version-publishing`
- **PR:** [#1103](https://github.com/safwan5001-source/Nebrax/pull/1103)

This Horizon builds on CUST-H1-1 (persistence foundation, PR #1082) and CUST-H1-2 (Version-aware Customizer UX, PR #1085), both already on `main`. CUST-H1-1/CUST-H1-2 investigation was not repeated; their implementation reports were read as authoritative context.

## External Evidence

Per the brief's benchmark rule, research was scoped to the one genuinely new UX decision this Horizon adds on top of the already-locked CUST-H1 architecture and the already-shipped CUST-H1-2 UI: **the publish confirmation dialog's content and destructive-action posture.** Everything else (API shape, concurrency semantics, state derivation, one-live-version rule) was already locked by `CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md` and is not a UX decision open for this Horizon to make.

- **Salla** (`docs/plans/store/CUST-H1-THEME-VERSIONS-EVIDENCE-UX.md` §3, already-recorded evidence from the CUST-H1 evidence pass): theme copies are a first-class merchant lifecycle — named versions, explicit states, publish as a distinct confirmed action. **What this proves:** a mature regional platform treats "which design is live" as a reviewable decision, not a silent side effect of editing. **What AWJ adopted:** the confirmation names the version and is a distinct step from Save. **What was not copied:** Salla's geographic/language-targeted publication — explicitly out of scope for CUST-H1 (§3 of the evidence doc), not reconsidered here.
- **Shopify** (same evidence doc, §4): publishing a new theme moves the previously-published theme back to unpublished (draft) rather than deleting it — one live theme at a time, former live theme recoverable. **What this proves:** the "replace, don't destroy" pattern is a common, proven mental model for this exact operation. **What AWJ adopted:** the confirmation body explicitly states retention ("سيُحتفَظ بالنسخة المنشورة الحالية كنسخة سابقة يمكن الرجوع إليها" / "The current live version will be kept as a retrievable previous version") — the same guarantee the architecture already locked (§11: former live Version row is never deleted), now surfaced to the merchant at the moment of the decision rather than left implicit.
- **AWJ Decision:** the dialog is centered (not a Bottom Sheet) on every viewport, since — unlike the Version Manager, which is a persistent browsing surface — a confirmation is a one-shot modal decision; a centered dialog is compact and equally viewable on 390px and 1440px alike, matching how this same codebase already renders its other modal confirmation (`role="dialog" aria-modal="true"`, e.g. the CUST-H1-2 mobile Version Manager sheet uses `items-end` for a persistent panel, while this is `items-center` for a one-shot decision). Two body variants were added — "first publish" (no existing live design) vs. "replace" (an existing live design will be superseded) — because the Shopify/Salla evidence and the architecture's own retention guarantee only make sense to state when there is something to retain; a storefront's first-ever publish has nothing to replace or retain, and claiming otherwise would be a plainly false statement in a high-trust confirmation.
- Not researched further: destructive-action confirmation copy patterns are already established in this exact module (the existing `versionDeleteConfirmBody`/delete-row confirmation, and CUST-H1-2's own discard-edit `window.confirm` dialogs) — reusing that established voice/structure rather than re-deriving generic HIG/Material confirmation-dialog guidance was the faster and more consistent choice, and the brief itself says not to turn every small implementation detail into a research task.

## Current AWJ Reality

- `StorefrontPresentationVersionService` (CUST-H1-1) already implements `createForCurrentTenant`/`showForCurrentTenant`/`saveForCurrentTenant`/`renameForCurrentTenant`/`deleteForCurrentTenant`, all under the Storefront → head → Version lock order, with `ForwardSchemaVersionException`/`StaleVersionRevisionException`/`ActiveVersionImmutableException`/`VersionLifecycleConflictException` already defined and wired to 409s.
- The legacy `StorefrontPresentationService::publishForCurrentTenant()` (STORE-BACKEND-1, unmodified by CUST-H1-1) already implements the exact publish-transaction shape this Horizon needed to replicate for the new Version-aware endpoint: normalize-then-persist-then-copy-to-head, no-op detection via content+pointer equality, and the `effectiveSchemaTag()` embedded-tag-priority pattern — this was read and used as the direct template for the new `publishForCurrentTenant()` on `StorefrontPresentationVersionService`.
- CUST-H1-2 (frontend) had already built the entire Version Manager UI, exact-version switching, and the busy/conflict/stale-callback guard machinery (`versionRequestTokenRef`, `versionWriteRequestRef`, `stillCurrent()`, `selectedVersionIdRef`) — the Publish button existed but was **permanently disabled** with a "coming in a later update" message, by design, since CUST-H1-3 didn't exist yet.
- The version list/detail response (CUST-H1-1) exposed `state`/`revision`/`scheduledFor`/`lastPublishedAt` but **not** any head-level field — there was no way for the frontend to know `published_revision` to send as `expected_published_revision`. This Horizon needed to add that one field.

## AWJ Decision

- **Publish endpoint:** implemented as `StorefrontPresentationVersionService::publishForCurrentTenant()`, following the exact 21-step transaction in the architecture's §11, reusing the legacy service's already-proven patterns (no-op detection, embedded-schema-tag normalization) rather than inventing new ones.
- **`published_revision` exposure:** added to every Version summary/detail row (`summarize()`), not as a separate "publication head" endpoint — every Version row for a given Storefront already carries the same head-level value (mirroring how `state` is already a per-row *derived* field from the same head), so no new endpoint or response envelope was needed. `active_version_id` itself is **not** exposed as a raw field; the frontend derives `expected_active_version_id` from whichever row already reports `state === 'published'` in the same list — avoiding leaking an internal pointer concept the architecture's response model (§26) doesn't otherwise expose.
- **Frontend eligibility:** Publish is offered (toolbar and Version Manager row) only for `state === 'draft'` — never for `published` or `scheduled` — matching the CUST-H1-2 UX table (§6.2) verbatim: Published never showed a Delete or (now) a Publish action; Scheduled shows no publish path pending CUST-H1-4/5. The backend's idempotent-republish and scheduled-target-409 paths exist and are tested, but the UI never intentionally reaches them — they are pure defense-in-depth for a directly-called API or a stale-client race.
- **Publish requires a saved (non-dirty) Version:** the toolbar Publish button is disabled while there are unsaved local edits, with an explicit "save first" tooltip. Publishing always targets the server-persisted `revision` the merchant last saved — publishing while genuinely-unsaved content is showing in the editor would silently publish something other than what's on screen, which is a worse trust violation than requiring one extra Save click.
- **Conflict classification:** since the backend has no separate error-code field on this path (unlike, e.g., Inventory Opening's `code`-based errors), the frontend classifies a 409 by matching the server's own Arabic message text into `stale` / `scheduled_conflict` / `unsupported_schema`. This was a deliberate choice to avoid adding a new error-code convention to a single endpoint when the rest of this exact module (save/rename/delete) already works this way (`classifyWriteFailure`/`classifyDeleteFailure` are also 409-status-only, undifferentiated by sub-reason) — introducing a code field for just this one action would be an inconsistent one-off.

## What changed

### Backend publish endpoint

`POST /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/publish` — new route, same `commerce.manage` middleware/permission as every other Version route, `whereUuid` on both path segments.

### Publish transaction

`StorefrontPresentationVersionService::publishForCurrentTenant()`:
1. Lock Storefront → head → target Version (existing helper methods reused).
2. Validate target `revision` (409 `StaleVersionRevisionException` — reused from save/rename).
3. Validate `published_revision`/`active_version_id` against the request's `expected_*` fields (409, new `StalePublicationHeadException`).
4. Reject a currently-Scheduled target (409, reused `VersionLifecycleConflictException`).
5. Fail closed on forward schema (409, reused `ForwardSchemaVersionException`) — **before** any normalization.
6. Normalize and persist the upgrade atomically back to the target Version (schema-version bump only, no merchant-facing revision bump) — whether or not content actually changed, so a re-publish of an already-current-schema Version is a true no-op write.
7. Idempotent no-op short-circuit when already active and byte-identical to `published_config` — no `published_at`/`published_revision` rewrite.
8. Otherwise: copy the normalized config into `published_config`, set `published_schema_version`, increment head-level `published_revision` by exactly 1, set `published_at = now()`, set `active_version_id = target.id`, set target `last_published_at = now()`. Former active Version row is never touched or deleted — its derived `state` simply stops being `published` on the next read.

### Version state transition / compatibility-head updates

- `draft_config`/`draft_schema_version`/`compatibility_working_version_id` (the legacy compatibility surface) are never touched by this new publish path — only the target Version and the head's `published_*`/`active_version_id` fields move.
- `published_revision` (head-level, monotonic, independent of any single Version's own `revision`) is now also surfaced on every Version list/detail row, additive to the existing response shape.

### Customizer Publish UX

- Toolbar Publish button: real eligibility (`state === 'draft'`, not dirty, no open conflict, not mid-write) replacing the CUST-H1-2 hard gate.
- `VersionManagerPanel`: new "نشر الآن / Publish now" action on Draft rows (desktop popover and mobile Bottom Sheet), reusing the exact same shared busy-slot serialization (`otherRowBusy`/`busy !== null`) already governing duplicate/rename/delete.
- `PublishConfirmDialog`: new centered modal — names the version and storefront, states the live design will be replaced (or that this is the first publish), states retention of the current live version when one exists. Arabic and English copy both written (not translated placeholders).

### Conflict/error UX

- `stale` (either revision-stale sub-case) → closes the dialog, refreshes the version list (does **not** resubmit the publish), shows a specific "publication state changed, review and retry" message.
- `scheduled_conflict` → specific "cancel the schedule first" message.
- `unsupported_schema` → specific "format newer than supported" message.
- `forbidden`/`not_found`/generic → existing-pattern fallback messages.
- No automatic retry anywhere in this flow.

### Mobile/desktop behavior

- Same dialog markup renders on every viewport (no separate mobile variant) — centered, `max-w-sm`, `max-h-[85dvh]` with independent scroll, tested at 390/430/768/1280/1440 for no horizontal overflow.
- Clicking "Publish now" inside the mobile Version Manager Bottom Sheet closes the sheet before opening the confirmation (never stacks two full-screen overlays).

## Files changed

```
app/Http/Controllers/Api/CommerceWorkspaceStorefrontPresentationVersionController.php   (+ publish action)
app/Http/Requests/PublishStorefrontPresentationVersionRequest.php                        (new)
app/Services/Commerce/StalePublicationHeadException.php                                  (new)
app/Services/Commerce/StorefrontPresentationVersionService.php                           (+ publishForCurrentTenant, sameDocument, published_revision on summarize())
routes/api.php                                                                            (+ publish route)
tests/Feature/CommerceModuleBoundaryTest.php                                              (+ 1 allow-listed route)
tests/Feature/StorefrontPresentationVersionPublishApiTest.php                             (new, 20 tests)

web/src/lib/mock-data.ts                                                                  (+ mock publish handler; moved inside the existing `m !== 'GET'` block — see Review findings)
web/src/app/dev/customizer-versions/page.tsx                                              (+ draft-and-published scenario)
web/src/app/(commerce)/commerce/appearance/page.test.tsx                                  (2 assertions updated for the removed hard gate)
web/src/modules/commerce-workspace/presentation-versions.ts                               (+ publishPresentationVersion, publishedRevision field, classifyPublishFailure)
web/src/modules/commerce-workspace/presentation-versions.test.ts                          (+ 7 tests)
web/src/modules/store-experience-builder/ExperienceBuilder.tsx                            (real Publish gating, PublishConfirmDialog, handleConfirmPublish, toSummary +publishedRevision)
web/src/modules/store-experience-builder/VersionManagerPanel.tsx                          (+ "Publish now" Draft-row action, "publish" VersionRowAction variant)
web/src/modules/store-experience-builder/messages.ts                                      (+ ~20 ar/en message keys; removed the now-dead versionPublishGated pair)
web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.test.tsx             (1 assertion updated for the removed hard gate)
web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.publish.test.tsx     (new, 15 tests)
web/e2e/cust-h1-3-immediate-publish.spec.ts                                                (new, 6 Playwright scenarios)
```

## API contract

Request:
```json
POST /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/publish
{
  "revision": 7,
  "expected_published_revision": 12,
  "expected_active_version_id": "3b7f...-uuid-or-null"
}
```
`expected_published_revision`/`expected_active_version_id` must be present in the body even when `null` (meaning "nothing published yet" / "no active version") — this is itself a valid, checkable publication-head state, not an omission.

Response (200): the published Version's full detail resource — identical shape to every other Version endpoint's response (`id`, `storefront_id`, `name`, `state`, `schema_version`, `config`, `revision`, `scheduled_for`, `last_published_at`, `created_at`, `updated_at`, `published_revision`).

Errors: 401 unauthenticated · 403 permission/self-service · 404 foreign/missing Storefront or Version · 409 stale revision / stale publication head / scheduled target / forward schema · 422 malformed envelope.

## Concurrency

- **Revision guard:** target Version's `revision` must match the locked row; else 409, zero mutation.
- **`published_revision` guard:** head's current `published_revision` (a monotonic, head-level, per-Storefront counter independent of any Version's own revision) must match `expected_published_revision`; else 409.
- **`active_version_id` guard:** head's current active Version id must match `expected_active_version_id`; else 409.
- Both guards are checked together **before** the scheduled-target check and **before** any normalization/mutation — a stale request never partially applies.
- **Stale-session behavior:** the documented scenario (Session A reviews Published X, Session B publishes Y, Session A's later Publish Z request) is directly covered by `stale_expected_active_version_id_returns_409` and `stale_expected_published_revision_returns_409` — A's request carries A's stale reviewed state (`active_version_id = X`), the server's current state is now `Y`, mismatch → 409, Y is never overwritten. No code path retries automatically; the frontend requires an explicit re-open of Publish after refreshing.

## Tenant Isolation

No authority ever accepted from the request body — `revision`/`expected_published_revision`/`expected_active_version_id` are data to validate against, never identity. Storefront/Version ownership resolved exclusively via `TenantContext` (`lockOwnedStorefront`/`lockOwnedVersion`, identical to every other Version endpoint). Tests: cross-tenant Storefront publish → 404; cross-tenant Version under an owned Storefront URL → 404; same-tenant cross-Storefront Version reuse → 404; unknown envelope key (e.g. an attempted `tenant_id`) → 422 before any read. No regression to CUST-H1-1's guarantees — the publish service method calls the same private ownership helpers, unmodified.

## Public parity

The public runtime (`GET /store/v1/storefront` → `StorefrontPresentationService::publishedSnapshotForStorefront()`) is completely unmodified by this PR. It already reads `storefront_presentations.published_config`/`published_schema_version` exclusively — the exact two fields this publish transaction writes atomically. `public_storefront_renders_the_newly_published_version` publishes a Version with custom `themePreset`/`homepage.heroHeadline` and asserts the public endpoint serves that exact content immediately afterward, with no restart/cache-clear. `failed_publish_leaves_the_public_snapshot_unchanged` proves a 409 leaves the previously-published content untouched on the public endpoint.

## Tests

### Backend

```
cd nibras-app
php artisan test --filter=StorefrontPresentationVersionPublishApiTest   # 20 passed
php artisan test --filter=StorefrontPresentation                        # 130 passed, 1 skipped (SQLite) / 131 passed (PostgreSQL)
php artisan test --filter=CommerceModuleBoundaryTest                    # 3 passed
php artisan test                                                        # full suite, both engines
```

| DB | Result |
|---|---|
| SQLite | 4858 passed, 30 failed (pre-existing/unrelated), 49 skipped |
| PostgreSQL 16 | 4858 passed, 30 failed (pre-existing/unrelated), 0 skipped |

The 30 failures are 100% in `Fuel*Test` (missing `bcmath` extension in this container, already documented in CUST-H1-1's report) and `R2*Test` (missing `Aws\Exception\AwsException` — AWS SDK not installed in this dev container). Verified identical failing-test set on both engines; none touch Storefront/Presentation/Commerce code. CI installs both `bcmath` and the AWS SDK, so these are not expected to recur there.

### Frontend

```
cd web
npx vitest run src/modules/commerce-workspace/presentation-versions.test.ts                        # 22 passed
npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.publish.test.tsx   # 15 passed
npx vitest run                                                                                       # 2270 passed (318 files)
npx tsc --noEmit -p tsconfig.json    # 15 pre-existing, unrelated errors only (verified against files this PR does not touch)
npm run build                        # production build green, all pages compiled
```

Two pre-existing tests' assertions were updated (not their scope) because they asserted the CUST-H1-2 *hard* publish gate, which this PR intentionally replaces:
- `ExperienceBuilder.test.tsx` — "opens the exact version … " now asserts Publish is enabled for the opened eligible Draft.
- `commerce/appearance/page.test.tsx` — same assertion, plus its "gates Publish" test renamed to "enables real Publish for an eligible Draft" with the assertion flipped.

## Visual verification

`web/e2e/cust-h1-3-immediate-publish.spec.ts`, 6 scenarios, all passing headless Chromium against the real `ExperienceBuilder` behind the existing local Demo mode (`/dev/customizer-versions`, `NODE_ENV=production` → 404):

- **Desktop 1440 AR** — first-ever publish: confirmation shows the "first publish" body (no retention claim), success flips the editor to read-only Published.
- **Desktop 1440 EN** — replacing an existing live version: confirmation shows the replace + retain body in English; after success, the previously-live version is shown as Draft in the manager.
- **Tablet 768 AR** — confirmation dialog fits with no horizontal overflow.
- **Mobile 390 AR** — Publish now from the bottom-sheet Version Manager: sheet closes before the confirmation opens (never stacked), confirmation fits, submit button is touch-target-sized, success message shows.
- **Mobile 430 EN** — a Published version's toolbar never offers a normal Publish action.
- **Desktop 1280 AR** — a Scheduled version's toolbar Publish is disabled with a cancel-schedule tooltip.

## CI

Workflows: `.github/workflows/ci.yml` (PHP, sqlite+pgsql matrix) and `.github/workflows/web-ci.yml` (`npm run test` + `npm run build`). Both verified green locally under the same invocations CI uses before pushing. This session subscribed to PR #1103's activity and will continue watching for CI results and review comments after this report is filed; the PR is not to be merged before that monitoring loop confirms green CI and the owner's explicit approval.

## Review findings

None yet at report time (PR just opened). One self-caught defect during implementation, fixed before commit:

| Finding | Root cause | Fix |
|---|---|---|
| The new publish route in the dev-only visual fixture's mock router (`mock-data.ts`) was silently unreachable — every publish attempt in `/dev/customizer-versions` returned a generic fallback success (`{id: 'demo-new'}`) instead of actually mutating mock state, so the very Playwright spec meant to verify this Horizon visually would have "passed" against the wrong backend response. | A pre-existing, unrelated catch-all `return resolve({ data: { id: 'demo-new' } })` inside the mock router's `if (method !== 'GET') { … }` block intercepts *any* unmatched mutating request — the real Version CRUD routes (create/rename/delete, and now publish) are matched further down, *outside* that block, so they are structurally unreachable for POST/PUT/PATCH/DELETE. This is a pre-existing bug affecting CUST-H1-2's own mock create/rename/delete routes too, never caught because the existing `cust-h1-2-version-manager.spec.ts` only exercises pre-seeded GET-based scenarios. | Moved only the new publish handler inside the `if (method !== 'GET')` block, alongside the other mutation routes it needs to sit next to. Deliberately did not touch the pre-existing (still-latent) issue for create/rename/delete, to keep this PR scoped to what CUST-H1-3 needs — worth flagging to the owner as a separate, small follow-up if anyone wants CUST-H1-2's own mock-fixture create/rename/delete flows to be visually testable too. |

## Backward compatibility

- `GET/PUT/POST .../presentation(/publish)` (legacy STORE-BACKEND-1 endpoints) — completely untouched.
- CUST-H1-1's five Version endpoints (list/create/show/save/rename/delete) — unchanged in behavior; `published_revision` is a new, additive field on their existing response shape, never a breaking change to consumers that ignore unknown fields.
- CUST-H1-2's Version Manager UI, exact-version switching, stale-callback guards — unchanged; the only removed code is the now-dead hard publish gate (`handlePublishGatedClick`, `versionPublishGated` message keys) it explicitly flagged in its own report as "the first thing revisited when CUST-H1-3 lands."
- Theme Gallery's `?version=` handoff — untouched, not exercised by this PR.

## Out of scope (confirmed)

- No scheduling backend/runtime, no `storefront-presentations:dispatch-due` command, no schedule/reschedule/cancel endpoints or UX.
- No timezone architecture — deferred to the scheduling Horizon per the architecture.
- No Deploy / Production Release of any kind.
- No new Storefront sections, Media Picker, or Store Identity Studio work.
- No RBAC/permission change — reuses `commerce.manage` throughout, exactly as every prior CUST-H1 slice.

## Risks / remaining work

- The dev-only mock-fixture bug described above (create/rename/delete routes in `/dev/customizer-versions` also silently unreachable) is pre-existing and out of this PR's scope; flagged above for the owner's attention as a possible small follow-up, not blocking this Horizon.
- `classifyPublishFailure()`'s 409-sub-reason classification is message-text-based (no dedicated error-code field on this path yet) — consistent with every other Version write endpoint in this exact module today, but worth a future pass if this module ever adopts a `code`-based error convention (as Inventory Opening already does) across the board.
- No scheduling runtime exists yet, so the "Scheduled target → 409" path can currently only be reached by a merchant clicking Publish on a version that was scheduled through direct API/DB manipulation (no schedule-creation UX exists until CUST-H1-4/5) — fully implemented and tested regardless, since it is required by this Horizon's own transaction contract and guards against a currently-hypothetical-but-architecturally-required race.

## Next step

**CUST-H1-4 — Scheduling Backend/Runtime**, per the architecture's implementation slicing (§30). CUST-H1-3 is not blocked.

---

## MERGE / DEPLOY GATE

**DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.**

Even with CI green and all findings resolved:

**CUST-H1-3 READY FOR MERGE — OWNER APPROVAL REQUIRED.**
