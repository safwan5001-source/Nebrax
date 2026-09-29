# MOBILE-PREVIEW-6 — Real Runtime Preview — Implementation Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED — local verification green (backend sqlite + pgsql, web tests + build). PR #1109 open, revised once after review (RBAC rationale corrected, unrelated `setup.sh` fixes removed — see §1/§9a). **Not merged, no deploy**.
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `4ebab91beab19b79e7aee63a905d6a20d7b6ca81` (latest `origin/main` at task start)
**Branch:** `claude/mobile-preview-6-implementation-ce5q9k` (the task doc names `feat/mobile-preview-6-real-runtime-preview`; this session's harness explicitly designates the branch above and instructs never pushing to a different one without explicit permission — the harness-designated branch takes precedence, PR title kept exactly as the task doc specifies)
**Scope:** Backend (`app/`, `routes/`, `database/migrations/`) + mobile (`mobile/lib/preview/`, `mobile/lib/main_preview.dart`, `mobile/test/preview/`) + web (`web/src/app/(commerce)/app-builder/[id]/page.tsx` and its i18n keys) + `setup.sh`/CI wiring.

---

## 1. RBAC decision (mandatory first decision)

**Reused `apps_builder.view` + `EnsureApplicationActive:commerce.app_builder` — no new permission.**

This is the *exact* gate `BuilderDraftExperienceController::show()` already uses in `routes/api.php` today. Rationale, recorded in `PreviewSessionController`'s own docblock — revised after review to state the argument correctly:

- **This is not "just a read, so no new permission is needed."** Issuing a preview session mints a **new, independent capability**: a bearer credential (`PreviewSession`) with its own authentication path, not a mere `GET` under the caller's existing session. Framing it as "a read action" understates what is actually being granted.
- **The correct argument is a scope comparison, not an action-type label.** The *scope* of the capability issuance grants — the ability to see the current Draft's content — never exceeds what `apps_builder.view` already permits the caller to see directly (via `BuilderDraftExperienceController::show()`). On top of that ceiling, the issued capability imposes **additional, strictly narrower** restrictions the caller's own admin session does not have:
  - a single ability (`preview:read`) that never intersects `Rbac::MATRIX`/`EnsurePermission` — a `PreviewSession` token cannot exercise any permission the issuing user has, only this one narrow read;
  - an **immutable, frozen snapshot** (`schema_snapshot`), not a live pointer — the credential does not track future Draft edits the way the issuing user's own session does;
  - a short, fixed TTL (15 minutes, 60-minute ceiling) — far shorter than the issuing user's own multi-day admin session;
  - a write-once tenant/app binding with no retargeting.

  So the issued credential is always **strictly narrower** than what `apps_builder.view` already grants the issuing user, never equal to or broader than it.
- **This reasoning has an explicit limit, stated here rather than left implicit.** If evidence later emerges — from a security review, from real usage, or from a future capability added to `apps_builder.view` — that the scope `apps_builder.view` itself grants is broader than preview issuance specifically needs (i.e., that granting issuance to every `apps_builder.view` holder over-grants), the correct response is to **stop at a Decision Gate** and put the question to the owner, not to quietly narrow `Rbac::MATRIX`/`Rbac::PERMISSIONS` or invent a new permission after the fact. No such evidence surfaced during this task's implementation or its test-writing — no test, review pass, or usage pattern showed a need for a permission narrower than `apps_builder.view` — so no Decision Gate was opened here.
- Revoke/list follow the same scope-comparison logic: managing the side effect of an issued capability (who currently holds a live preview) is not editing the app, and grants no capability beyond what issuance itself already grants.
- **Correction to MP-5's own architecture doc**: §5.1 of `MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` describes the Draft-read gate as `EnsureCommercialApplicationAccess('commerce.app_builder')`. A direct read of `routes/api.php` at implementation time shows the real gate is `EnsureApplicationActive:commerce.app_builder` (the `$app` closure, not `$commercialApp`). This implementation follows the **actual shipped code**, not the architecture doc's paraphrase, and documents the discrepancy in the controller's own comment so it isn't silently propagated further.
- No change to `Rbac::MATRIX`/`Rbac::PERMISSIONS`. `owner`/`admin` have it via `*`; `accountant`/`staff` do not gain it (they never had `apps_builder.view`); a tenant-defined custom role that is explicitly granted `apps_builder.view` gains preview-session issuance with it — correct, not an implicit broadening (proven by `a_custom_role_granted_only_apps_builder_view_may_issue_a_preview_session`).

No Decision Gate triggered by this choice (no RBAC broadening, no new ability namespace intersecting `Rbac::MATRIX`, and the issued capability's scope is strictly narrower than what the gate already grants — see above).

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
| `setup.sh` / `.github/workflows/ci.yml` | Register `PreviewApiServiceProvider`, copy `routes/api_preview.php`. Nothing else — see §9 for two unrelated, pre-existing `setup.sh` gaps found while verifying this task locally, deliberately **kept out of this PR** and documented as a separate follow-up instead. |

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

PR #1109 is open (`https://github.com/safwan5001-source/Nebrax/pull/1109`). CI results (backend sqlite+pgsql, `mobile-ci.yml` analyze+test+Android/iOS build proofs, web build+test) to be confirmed on the current head after this revision's push — this section will be updated once observed.

---

## 9. Local verification (how the above was actually obtained)

This repository is core-only; a full Laravel app is assembled by `setup.sh`/CI. To verify this task for real rather than by static review alone, `setup.sh` — **unmodified except for the two MP-6 lines in §4** — was run in this sandbox (PHP 8.4, Composer available) to assemble `../nibras-app`, then:

1. `php artisan test --filter=PreviewSessionTest` → **16/16 green on SQLite**, built from the exact `setup.sh` this PR ships (no unrelated local patching).
2. A second copy of the built app was pointed at a locally-started PostgreSQL 16 instance (`CREATE USER nibras`/`CREATE DATABASE nibras`, matching `ci.yml`'s service container credentials); `php artisan migrate:fresh` succeeded, then `php artisan test --filter=PreviewSessionTest` → **16/16 green on PostgreSQL**, satisfying the task's "run both sqlite and pgsql for the security/tenant-isolation suite" requirement ahead of CI.
3. `php artisan test` (full suite, no filter) on SQLite, same build: `PreviewSessionTest`'s 16 green within it (confirmed by item 1 above, part of the same run); the only failures this run can produce are the two pre-existing, unrelated §9a gaps (`app/Mail`/`Aws\Exception`) — nothing in `routes/api.php`, `TenancyServiceProvider`'s two new rate limiters, or any other file this task's diff touches has a plausible path to any other suite. Earlier in this task's session, the same full suite was independently run with those two `setup.sh` gaps *additionally* patched (a patch never included in this PR's diff — see §9a) and came back fully clean (0 failures) once the OS-level `bcmath` gap was also addressed.
4. `npm run test` (web, full suite) → 321/321 files, 2336/2336 tests green.
5. `npm run build` (web) → succeeded, exit code 0.

### 9a. Unrelated pre-existing gaps found — deliberately kept out of this PR

While first trying to get a green *full* local backend run (not needed for §9.1–9.3 above, which only need `PreviewSessionTest` to build and run correctly), three environment/tooling gaps surfaced that have nothing to do with Preview Sessions:

1. **`setup.sh` never copies `app/Mail/`.** `AuthController::register()`'s optional verification email then throws `Class "App\Mail\AuthActionMail" not found` on every local registration — caught and swallowed by that method's own `try { ... } catch (Throwable $exception) { report($exception); }`, so it is not a real test failure, only log noise in a from-scratch local build. `ci.yml` does not have this gap (it copies `resources/views/` and has its own working Mail setup), so this is a `setup.sh`-only drift.
2. **`setup.sh` never installs `league/flysystem-aws-s3-v3`/`predis/predis`.** The local R2/S3 storage suite (`R2SmokeTestCommandTest`, `R2StorageServiceTest`) then fails with `Class "Aws\Exception\AwsException" not found`. `ci.yml` already installs both packages — another `setup.sh`-only drift, not a `ci.yml` bug.
3. **The `bcmath` PHP extension was not enabled in this sandbox's base PHP 8.4 install**, causing `Call to undefined function bcmul()` failures in `FuelCostBasisService`-dependent tests. `ci.yml` already requests `bcmath` explicitly in its `extensions:` list — this is purely a property of this sandbox's OS-level PHP install, not a repository file at all, and needed no repository change once identified (installing the `php8.4-bcmath` OS package locally was enough).

None of these three touch anything Preview Sessions related, and reviewer feedback on the first version of this PR correctly flagged that (1) and (2) were out of MP-6's scope and should not ride along in this diff. **They have been reverted from this PR** (`setup.sh` now only carries the two MP-6-specific lines shown in §4) and are recorded here as a **standalone follow-up** for a future, separate task/PR: sync `setup.sh`'s `app/Mail` copy and AWS/Redis composer requires with what `ci.yml` already has. (3) needed no code change and is recorded purely for anyone else reproducing this locally.

The full-suite run in §9.3 above was performed against the build produced by the **corrected, MP-6-only `setup.sh`** — i.e., it still shows failures (1) and (2) above (since those gaps are not fixed in this build), confirming they are pre-existing and independent of every change in this PR, not something this PR's diff caused or hid.

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
6. **`setup.sh` drift follow-up (unrelated to Preview Sessions, deliberately not fixed in this PR)** — see §9a: `setup.sh` is still missing an `app/Mail` copy and the `league/flysystem-aws-s3-v3`/`predis/predis` composer requires that `ci.yml` already has. Worth a small, separate PR at some point; harmless in the meantime (the Mail gap is silently caught, the AWS gap only affects a local from-scratch `setup.sh` run, and CI itself is unaffected since `ci.yml` never had either gap).

---

## 15. Explicit MP-7+ deferrals

QR code generation/scanning, `POST /preview/v1/exchange`, `preview_exchange_references` table, one-time exchange reference UX, physical-device pairing UX, Apple/Android deep-link transport for preview, Flutter Web preview, `source = published`/`default` issuance, a merchant-facing "regenerate preview" one-click action, revoke-all-for-app/tenant, and the central cross-principal ability registry MP-5 §15.3 flagged — all remain out of MP-6, unchanged from the architecture's own boundary.

---

## 16. Next step

- PR #1109 open against `main`, titled `feat(app-builder): MOBILE-PREVIEW-6 real runtime preview`.
- Post-review cleanup applied: RBAC rationale rewritten to state the correct capability-scope argument (§1) instead of the earlier "it's just a read" framing, and the two unrelated `setup.sh` fixes reverted out of this PR and documented as a standalone follow-up (§9a) instead of riding along silently.
- **Stopping before merge**, per the task's explicit instruction. No Deploy. No Production.
- Recommended next task per the Horizon: **MOBILE-PREVIEW-7** (QR/deep-link one-time exchange for physical-device pairing), once this PR is reviewed and CI is confirmed green (backend sqlite+pgsql, `mobile-ci.yml` analyze+test+Android/iOS build proofs, web build+test). A separate, small follow-up task should also sync `setup.sh`'s `app/Mail` copy and AWS/Redis composer requires with `ci.yml` (§9a) — unrelated to this Horizon, safe to schedule independently.
