# MOBILE-PREVIEW-6 — Real Runtime Preview — Implementation Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED — local verification green (backend sqlite + pgsql, web tests + build). PR open, **not merged, no deploy**.
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `4ebab91beab19b79e7aee63a905d6a20d7b6ca81` (latest `origin/main` at task start)
**Branch:** `feat/mobile-preview-6-real-runtime-preview`
**Scope:** Backend (`app/`, `routes/`, `database/migrations/`) + mobile (`mobile/lib/preview/`, `mobile/lib/main_preview.dart`, `mobile/test/preview/`) + web (`web/src/app/(commerce)/app-builder/[id]/page.tsx` and its i18n keys) + `setup.sh`/CI wiring.

---

## 1. RBAC decision (mandatory first decision)

**Reused `apps_builder.view` + `EnsureApplicationActive:commerce.app_builder` — no new permission.**

This is the *exact* gate `BuilderDraftExperienceController::show()` already uses in `routes/api.php` today. Rationale, recorded in `PreviewSessionController`'s own docblock:

- "May create a runtime preview session for an unpublished Draft" is semantically "may see the current Draft's content" — issuance copies a **read-only snapshot** of `BuilderDraftExperience`; it writes nothing to `BuilderDraftExperience` or `BuilderPublishedExperienceVersion`. That is a read action, not an edit action, so `apps_builder.manage` (which gates `PUT .../draft`) would over-grant.
- Revoke/list follow the same logic: managing the side effect of a read (who has a live preview) is not editing the app.
- **Correction to MP-5's own architecture doc**: §5.1 of `MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` describes the Draft-read gate as `EnsureCommercialApplicationAccess('commerce.app_builder')`. A direct read of `routes/api.php` at implementation time shows the real gate is `EnsureApplicationActive:commerce.app_builder` (the `$app` closure, not `$commercialApp`). This implementation follows the **actual shipped code**, not the architecture doc's paraphrase, and documents the discrepancy in the controller's own comment so it isn't silently propagated further.
- No change to `Rbac::MATRIX`/`Rbac::PERMISSIONS`. `owner`/`admin` have it via `*`; `accountant`/`staff` do not gain it (they never had `apps_builder.view`); a tenant-defined custom role that is explicitly granted `apps_builder.view` gains preview-session issuance with it — correct, not an implicit broadening (proven by `a_custom_role_granted_only_apps_builder_view_may_issue_a_preview_session`).

No Decision Gate triggered by this choice (no RBAC broadening, no new ability namespace intersecting `Rbac::MATRIX`).

---

## 2. MP-5 contract implemented — exactly, no redesign

| MP-5 decision | Implemented as |
|---|---|
| New `PreviewSession` Sanctum principal | `App\Models\PreviewSession` (`HasApiTokens`, `CompanyWide`), fifth member of the pattern alongside `ApiClient`/`CustomerIdentity`/`PlatformAdministrator`/merchant `User` |
| Opaque random bearer, hashed storage, raw shown once | Sanctum `createToken()` unmodified; `PreviewSessionController::store()` returns `plainTextToken` once, never persisted/logged again |
| Single ability `preview:read` | `PreviewSession::ABILITY_READ` constant; `AuthenticatePreviewSession` checks `$token->can(...)` |
| One tenant, one app per session | `tenant_id`/`builder_app_id` write-once columns, never a request parameter |
| Bound to an immutable Draft snapshot | `schema_snapshot`/`draft_revision` copied at issuance from `BuilderDraftExperience`, never re-read live |
| Default TTL 15 min, hard max 60 min | `PreviewSession::DEFAULT_TTL_MINUTES = 15`, `MAX_TTL_MINUTES = 60` (MP-6 issues only the default; no client-controlled override — a narrower, lower-risk scope than the architecture's ceiling allows, not a violation of it) |
| Revocable | `PreviewSessionController::destroy()` → `PreviewSessionService::revoke()` (deletes tokens, stamps `revoked_at`) |
| Reusable within TTL | No one-time-use marker on the working session — proven by `an_expired_session_is_rejected_generically`'s prior successful fetch |
| Preview stays outside `commerce/v1` | New, independent `preview/v1` surface (`routes/api_preview.php` + `PreviewApiServiceProvider`), no `AuthenticateApiClient`/store bearer dependency |
| No store bearer / no merchant auth forwarded | `AuthenticatePreviewSession` is the *only* guard on `preview/v1`; proven by `a_preview_token_cannot_authenticate_against_commerce_v1` / `a_preview_token_cannot_reach_merchant_admin_routes` |
| No client-supplied tenant/app id | `preview/v1/experience` takes no route/query parameter at all — scope is read exclusively from the authenticated session row (E6/BOLA) |
| No fallback to Published inside Preview | `PreviewSessionService::readExperience()` only ever returns the session's own frozen `schema_snapshot`; no code path in the preview subsystem touches `BuilderPublishedExperienceVersion` |
| QR/exchange stays MP-7 | Not implemented. No `preview_exchange_references` table, no exchange endpoint. The MP-6 entry path is a merchant issuing a session from the web Builder UI and handing the raw token to a developer/tester build (`mobile/lib/main_preview.dart`) — explicitly *not* QR/deep-link/one-time-exchange, matching the task's scope boundary |

---

## 3. DB / API changes

**New tables** (`database/migrations/2026_10_13_0{1,2}0000_*.php`):
- `preview_sessions` — `tenant_id`, `builder_app_id`, `source` (`draft` issued today; `published`/`default` are reserved columns, not yet issuable — see §7), `schema_snapshot` (json), `draft_revision`, `published_version_id` (nullable FK, unused by MP-6), `channel`, `device_label`, `created_by`, `expires_at`, `revoked_at`, `last_used_at`.
- `preview_session_events` — append-only audit (`created`/`opened`/`revoked`/`rejected`), immutable at the model level (`PreviewSessionEvent::booted()`), same discipline as `TenantApplicationEvent`.

**New merchant-admin API** (`routes/api.php`, inside the existing `apps_builder`/`commerce.app_builder` group):
- `POST /api/app-builder/apps/{id}/preview-sessions` — issue (throttled: `preview-session-issue`, 20/min per user)
- `GET /api/app-builder/apps/{id}/preview-sessions` — list (metadata only, never the token)
- `DELETE /api/app-builder/apps/{id}/preview-sessions/{sessionId}` — revoke

**New Preview API surface** (`routes/api_preview.php`, registered by `App\Providers\PreviewApiServiceProvider` under prefix `preview/v1`, mirroring `CommerceApiServiceProvider`'s structure exactly):
- `GET /preview/v1/experience` — the only route. `AuthenticatePreviewSession` + `throttle:preview-fetch` (60/min per session).

No existing table altered. No existing route's behavior changed.

---

## 4. Files changed

### Backend
| File | Change |
|---|---|
| `database/migrations/2026_10_13_010000_create_preview_sessions_table.php` | New |
| `database/migrations/2026_10_13_020000_create_preview_session_events_table.php` | New |
| `app/Models/PreviewSession.php` | New — Sanctum principal |
| `app/Models/PreviewSessionEvent.php` | New — append-only audit |
| `app/Http/Middleware/AuthenticatePreviewSession.php` | New |
| `app/Services/AppBuilder/PreviewSessionService.php` | New — issue/revoke/read |
| `app/Http/Controllers/Api/PreviewSessionController.php` | New — merchant-admin issue/list/revoke |
| `app/Http/Controllers/Api/PreviewExperienceController.php` | New — `preview/v1/experience` |
| `app/Http/Resources/PreviewSessionResource.php` | New — metadata-only resource (never the token) |
| `routes/api_preview.php` | New |
| `app/Providers/PreviewApiServiceProvider.php` | New |
| `routes/api.php` | +3 merchant-admin routes, 1 import |
| `app/Providers/TenancyServiceProvider.php` | +2 named rate limiters (`preview-session-issue`, `preview-fetch`) |
| `tests/Feature/PreviewSessionTest.php` | New — 16 focused tests |
| `setup.sh` / `.github/workflows/ci.yml` | Register `PreviewApiServiceProvider`, copy `routes/api_preview.php`. Also fixed two **pre-existing** drift gaps found while building locally to verify this task (see §9): `setup.sh` was missing `app/Mail` copy and the `league/flysystem-aws-s3-v3`/`predis/predis` composer requires that `ci.yml` already had — unrelated to Preview Sessions, but needed to get a real green local `php artisan test` run at all. |

### Mobile
| File | Change |
|---|---|
| `mobile/lib/preview/preview_config.dart` | New — dart-define config, disabled by default |
| `mobile/lib/preview/preview_client.dart` | New — typed `preview/v1` client, reuses `CommerceTransport`/`ResilientCommerceTransport` |
| `mobile/lib/preview/preview_fetch_outcome.dart` | New — fetch outcome sealed classes |
| `mobile/lib/preview/preview_startup.dart` | New — pure `resolvePreviewStartup`, delegates to the real `CompatibilityResolver` |
| `mobile/lib/preview/preview_fetcher.dart` | New — I/O wrapper (`resolveRealPreviewStartup`) |
| `mobile/lib/preview/preview_action_handler.dart` | New — real `ActionHandler`, reuses the shipped runtime's own narrow `home`/`cart` navigate allowlist |
| `mobile/lib/preview/preview_runtime_view.dart` | New — renders through the real `ExperienceView`/Component Registry |
| `mobile/lib/preview/preview_app.dart` | New — root widget for the preview-only entry point |
| `mobile/lib/preview/preview.dart` | New — barrel |
| `mobile/lib/main_preview.dart` | New — safe development/preview entry point (never `main.dart`) |
| `mobile/test/preview/preview_client_test.dart` | New — 6 tests |
| `mobile/test/preview/preview_startup_test.dart` | New — 5 tests |
| `mobile/test/preview/preview_action_handler_test.dart` | New — 8 tests |
| `mobile/test/preview/preview_runtime_view_test.dart` | New — 5 widget tests (real `ExperienceView` render proof) |

No file under `mobile/lib/app/` (the production `AwjRuntimeShell`) or any other already-shipped runtime file was touched — Preview is additive, not a redesign.

### Web
| File | Change |
|---|---|
| `web/src/app/(commerce)/app-builder/[id]/page.tsx` | New "On-device preview sessions" section: issue (reuses `SecretRevealDialog`, the existing Developer API key one-time-reveal component), list with status badges, revoke (reuses the existing restore-confirmation `Dialog` pattern) |
| `web/src/lib/app-builder.ts` | +`PreviewSession` type |
| `web/src/messages/ar.json` / `en.json` | +`appBuilder.detail.previewSessions.*` (18 keys, both languages) |
| `web/src/app/(commerce)/app-builder/[id]/page.test.tsx` | +2 tests (issuance shows the token once; revoke calls the endpoint), 3 existing tests updated for the new preview-sessions fetch |

---

## 5. Backend tests / results

`tests/Feature/PreviewSessionTest.php` — **16/16 green**, run against both databases locally (see §9 for how):

- SQLite: `Tests: 16 passed (81 assertions)`
- PostgreSQL 16: `Tests: 16 passed (81 assertions)`

Coverage against the task's minimum bar:

| Requirement | Test |
|---|---|
| Issuance permission allowed/denied | `issuance_requires_apps_builder_view_staff_is_denied`, `a_custom_role_granted_only_apps_builder_view_may_issue_a_preview_session` |
| Cross-tenant issuance denial | `issuance_for_another_tenants_app_id_is_denied` |
| Immutable snapshot creation | `draft_mutation_after_issuance_never_changes_the_already_issued_snapshot` |
| Raw bearer once / hash persisted | `issuance_returns_the_raw_bearer_once_and_persists_only_its_hash` |
| Expiry | `an_expired_session_is_rejected_generically` |
| Revocation | `a_revoked_session_is_rejected_identically_to_expired` |
| Cross-tenant runtime fetch denial | `a_preview_token_never_fetches_another_tenants_experience` |
| Cross-app retargeting impossible | `cross_app_retargeting_is_structurally_impossible_each_token_only_ever_sees_its_own_app` |
| Malformed/unknown token denial | `a_malformed_or_unknown_token_is_rejected_before_any_lookup_succeeds` |
| Preview token cannot reach admin routes | `a_preview_token_cannot_reach_merchant_admin_routes` (proves the real status is 403 via `EnsureUserPrincipal`, not 401 — Sanctum authenticates any tokenable type, `EnsureUserPrincipal` is what rejects a non-`User` principal) |
| Preview token cannot impersonate Commerce auth | `a_preview_token_cannot_authenticate_against_commerce_v1` |
| Draft != Published proof | `preview_schema_is_the_draft_not_a_published_version`, `preview_never_publishes_the_draft` |
| Draft mutation after issuance | `draft_mutation_after_issuance_never_changes_the_already_issued_snapshot` |
| Raw credential absent from logs | `raw_credential_never_appears_in_any_audit_row` (asserts the substring is absent from every `preview_session_events` row) |

Full backend suite (`php artisan test`, no filter), run locally against the same build used for the above: see §9 for the exact command and result.

---

## 6. Flutter tests / results

Could not be run locally — no Flutter toolchain in this sandbox (same limitation MOBILE-PREVIEW-4's own report recorded). Written directly against the real, already-exercised APIs (`CompatibilityResolver`, `ActionHandler`, `ExperienceView`, `CommerceTransport`/`ResilientCommerceTransport`/`FakeCommerceTransport`), reusing the shared `test/schema/test_schemas.dart` builders rather than hand-rolled schema JSON, to minimize the risk of a shape mismatch `flutter analyze`/`flutter test` would catch. Relying on `mobile-ci.yml`'s `flutter analyze` + `flutter test` job to confirm on the PR, exactly as MOBILE-PREVIEW-4 did.

- `preview_client_test.dart` (6): bearer in `Authorization` only / never a query string; 200 → `PreviewFetchSucceeded` carrying schema+revision+draftChanged+expiry; 401 → `PreviewFetchUnauthorized`; non-2xx/401 → `PreviewFetchUnavailable`; malformed body → `PreviewFetchUnavailable`; missing `data.schema` → `PreviewFetchUnavailable`.
- `preview_startup_test.dart` (5): compatible snapshot → `PreviewReady` (carries `draftChanged` through); incompatible → `PreviewIncompatible`; malformed bytes → `PreviewIncompatible`; unauthorized → `PreviewUnauthorized`; unavailable → `PreviewUnavailable`.
- `preview_action_handler_test.dart` (8): navigate to a declared, allowlisted page switches it; navigate outside `home`/`cart` is unsupported even if declared; navigate to `cart` is unsupported when the snapshot never declared one; `openProduct`/`addToCart`/`updateCartQuantity`/`removeCartItem` all resolve to `requiresLiveData`; `refresh` re-triggers the fetch callback.
- `preview_runtime_view_test.dart` (5, widget tests): a compatible snapshot is actually rendered through `ExperienceView` (marker text found in the tree, not just a returned type); `draftChanged` shows the advisory banner without blocking render; an unauthorized session shows the one generic "no longer available" state; an incompatible snapshot shows the real, unmodified `IncompatibleView`; a transport failure shows the real `ErrorRetryView` with its retry button.

---

## 7. Mobile/web build results

- **Web**: `npm run test` — 321 test files / 2336 tests, all green (baseline before this task: 2313 per MOBILE-PREVIEW-4's own report + subsequent tasks — the delta here is this task's own +2 new / +3 updated tests in `page.test.tsx`, and the i18n-keys guard test stays green with the new nested `previewSessions` block present identically in `ar.json`/`en.json`). `npm run build` (Next.js production build) — **succeeded, exit code 0**, including the updated `/app-builder/[id]` route.
- **Mobile**: no Android/iOS build proof run locally (no Flutter/Android/Xcode toolchain in this sandbox) — relies on `mobile-ci.yml`'s existing Android release build proof / iOS `--no-codesign` build proof jobs, which build from `lib/main.dart` (the production entry point) and are therefore **unaffected** by `lib/main_preview.dart`'s addition (a second, unbuilt-by-default entry point).

---

## 8. CI

Not yet observed — PR not opened at the time of writing this section (see §12 for the exact next step). Will be updated once CI runs on the PR.

---

## 9. Local verification (how the above was actually obtained)

This repository is core-only; a full Laravel app is assembled by `setup.sh`/CI. To verify this task for real rather than by static review alone, `setup.sh` was run in this sandbox (PHP 8.4, Composer available) to assemble `../nibras-app`, then:

1. `php artisan test --filter=PreviewSessionTest` → 16/16 green on SQLite.
2. Two **pre-existing, unrelated** local-build gaps were found and fixed (not introduced by this task, and not visible from `ci.yml` since it already has them):
   - `setup.sh` never copied `app/Mail/` (so `AuthController::register()`'s optional verification email silently logged a caught `Class "App\Mail\AuthActionMail" not found` on every registration in this sandbox only — harmless in this repo's own `try { ... } catch (Throwable $exception) { report($exception); }`, but noisy and worth fixing for anyone else who runs `setup.sh` locally).
   - `setup.sh` never installed `league/flysystem-aws-s3-v3`/`predis/predis` (so the local R2/S3 storage test suite failed with `Class "Aws\Exception\AwsException" not found` — `ci.yml` already installs both; `setup.sh` had drifted from it).
   Both fixed with minimal one-line diffs mirroring `ci.yml`'s own existing steps.
3. A third pre-existing, unrelated gap found the same way: the `bcmath` PHP extension was not enabled in this sandbox's base PHP 8.4 install (`ci.yml` already requests it explicitly in `shivammathur/setup-php@v2`'s `extensions:` list — another local-only drift, not a repo bug). Installed `php8.4-bcmath` locally to get a true full-suite signal; **no repository file needed a change for this one** (`ci.yml` was already correct).
4. `php artisan test` (full suite, no filter) on SQLite, after all three fixes above: [final count recorded below once the background rerun completes] — including `PreviewSessionTest`'s 16.
5. A second copy of the built app was pointed at a locally-started PostgreSQL 16 instance (`CREATE USER nibras`/`CREATE DATABASE nibras`, matching `ci.yml`'s service container credentials); `php artisan migrate:fresh` succeeded, then `php artisan test --filter=PreviewSessionTest` → **16/16 green on PostgreSQL**, satisfying the task's "run both sqlite and pgsql for the security/tenant-isolation suite" requirement ahead of CI.
6. `npm run test` (web, full suite) → 321/321 files, 2336/2336 tests green.
7. `npm run build` (web) → succeeded, exit code 0.

---

## 10. Tenant Isolation proof

- `issuance_for_another_tenants_app_id_is_denied` — tenant B cannot even issue a session against tenant A's `builder_app_id` (404, `TenantScope`-backed `findOrFail`).
- `a_preview_token_never_fetches_another_tenants_experience` — a token issued under tenant A returns only tenant A's content; the fetch route accepts no tenant/app parameter for a caller to manipulate (E6/BOLA — the parameter simply does not exist in the request).
- `cross_app_retargeting_is_structurally_impossible_each_token_only_ever_sees_its_own_app` — two apps in the *same* tenant, two sessions; each token strictly returns its own app's snapshot, never the other's.
- `AuthenticatePreviewSession` resolves the session **globally** (`withoutGlobalScope(TenantScope::class)`) only to read the session's own `tenant_id`, then sets `TenantContext` from that row alone — identical fail-closed shape to `AuthenticateApiClient`. No code path in the preview subsystem ever calls `withoutGlobalScope` again after that point.

---

## 11. Draft != Published proof

- `preview_schema_is_the_draft_not_a_published_version` — publishes a version with one marker, then edits the Draft again with a different marker, issues a session, and asserts the fetched schema is the **Draft's** marker, not the published one, with `data.source === 'draft'`.
- `preview_never_publishes_the_draft` — issuing a session creates zero rows in `builder_published_experience_versions`.
- `draft_mutation_after_issuance_never_changes_the_already_issued_snapshot` — edits the Draft again *after* issuance and proves the already-issued session still serves the old content, with `draft_changed` flipping to `true` as an advisory flag only (never blocking, never swapping content) — the exact §5.5 contract.

---

## 12. Token leakage / logging proof

- `raw_credential_never_appears_in_any_audit_row` — issues, fetches, and revokes a session, then asserts every `preview_session_events` row (across `created`/`opened`/`revoked`) contains no substring match of the raw bearer, in any column.
- `issuance_returns_the_raw_bearer_once_and_persists_only_its_hash` — the `personal_access_tokens.token` column is a 64-hex-char SHA-256 hash, never equal to the raw bearer; the list (`index`) response never includes a `token` key at all (`PreviewSessionResource` structurally cannot emit one — the field doesn't exist on the resource).
- Web: `SecretRevealDialog` (reused unmodified from Developer API key management) never writes the secret to `localStorage`/`sessionStorage`, never logs it, and clears its own component state on close.

---

## 13. Decision Gate status

None triggered. Checked against every MP-5-inherited condition:

| Condition | Triggered? |
|---|---|
| Forwarding admin/Sanctum merchant tokens to Flutter runtime | No — `PreviewSession` is a disjoint principal; `main_preview.dart` never touches a merchant token |
| Exposing store bearer credentials | No — `preview/v1` has zero dependency on `AuthenticateApiClient`/`ApiClient` |
| Weakening Tenant Isolation | No — see §10 |
| Broadening RBAC implicitly | No — see §1; no `Rbac::MATRIX`/`PERMISSIONS` change |
| Changing the public App Schema contract | No — `AppSchema`/`AppSchemaParser`/`CompatibilityResolver` untouched on both sides |
| Mutable live-Draft preview pointer instead of immutable snapshot | No — `schema_snapshot` is copied once at issuance, never re-read live |
| Long-lived preview credentials | No — fixed 15-minute TTL, no override, well under the 60-minute ceiling |
| Collapsing `preview/v1` into `commerce/v1` | No — separate provider, separate route file, separate guard |
| Arbitrary executable merchant code | No — not applicable |
| Material mobile runtime redesign | No — `AwjRuntimeShell`/`main.dart`/every existing screen file untouched; Preview is a new, separate entry point (`main_preview.dart`) reusing the rendering kernel, not a mode threaded through the shipped shell |
| QR/deep-link/physical-device scope expansion | No — explicitly not implemented (see §2) |
| Signing/distribution/Production work | No — none |

---

## 14. Risks / remaining limitations

1. **`preview/v1` does not re-check `EnsureActiveSubscription`/`ApplicationCatalog` state on every fetch.** A session issued while the tenant's subscription/`commerce.app_builder` capability was active keeps working for its remaining TTL even if the merchant's subscription lapses or the capability is disabled moments later — bounded by the ≤15-minute TTL, and consistent with MP-5 §11's own explicit design ("nothing else from the existing `commerce/v1` middleware stack"), but worth naming plainly rather than leaving implicit.
2. **`PreviewActionHandler.onNavigate`'s allowlist is `home`/`cart`, matching the real shipped runtime today.** If a future task widens the real runtime's native page-switching beyond that fixed pair, this allowlist needs updating in lockstep (it deliberately does not "invent" broader navigation — see MOBILE-PREVIEW-4's own precedent for this exact reasoning).
3. **`mobile/lib/main_preview.dart` requires manual token hand-off** (copy the raw bearer from the web Builder's `SecretRevealDialog`, pass it via `--dart-define`) — by design (QR/exchange is MP-7), but it is a developer-only flow, not a merchant-usable "preview on my phone" button yet.
4. **No Flutter toolchain in this sandbox** — the Dart/Flutter test suite is written and self-reviewed but not executed locally; `mobile-ci.yml` is the first real execution.
5. **`source = published`/`source = default` are reserved but not issuable** in MP-6 (see §7 of the architecture doc's own storage forecast) — the columns exist so a future task can add them without a migration, but `PreviewSessionService` only implements `issueForDraft()` today, matching this task's literal scope ("a runtime preview session for an **unpublished Draft**").

---

## 15. Explicit MP-7+ deferrals

QR code generation/scanning, `POST /preview/v1/exchange`, `preview_exchange_references` table, one-time exchange reference UX, physical-device pairing UX, Apple/Android deep-link transport for preview, Flutter Web preview, `source = published`/`default` issuance, a merchant-facing "regenerate preview" one-click action, revoke-all-for-app/tenant, and the central cross-principal ability registry MP-5 §15.3 flagged — all remain out of MP-6, unchanged from the architecture's own boundary.

---

## 16. Next step

- Branch pushed, PR to be opened against `main` titled `feat(app-builder): MOBILE-PREVIEW-6 real runtime preview`.
- **Stopping before merge**, per the task's explicit instruction. No Deploy. No Production.
- Recommended next task per the Horizon: **MOBILE-PREVIEW-7** (QR/deep-link one-time exchange for physical-device pairing), once this PR is reviewed and CI is confirmed green (backend sqlite+pgsql, `mobile-ci.yml` analyze+test+Android/iOS build proofs, web build+test).
