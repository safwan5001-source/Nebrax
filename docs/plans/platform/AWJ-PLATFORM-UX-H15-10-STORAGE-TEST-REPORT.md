# H15-10 — Private storage test result accuracy (B2 enhanced) — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Owner decision: B2 enhanced approved (not B1, not B3) · Date: 2026-10-13
Root cause analysis: given in the previous task's hand-off (no repository file); the facts are restated below.

## Root cause (restated)

`POST /platform/integrations/document_storage/test` → `PlatformIntegrationService::test()` → `DocumentStorageService::healthCheck()`. With the saved integration **enabled** it ran `verifyPlatformConfiguration()` (write → exists → read → delete on the saved R2/S3). With it **disabled or absent** (`PlatformIntegrationResolver::activeConfiguration()` returns `[]`) it ran the same synthetic check on the **local fallback** and returned the same Arabic text "connected to private storage", so a local pass looked like a provider connection. The local fallback is intentional: `DOCUMENT_DURABLE_STORAGE_ENABLED` (`document_center.storage.persistent_enabled`) keeps documents on local disk until it is opened.

## What changed

**Backend** (`DocumentStorageService`, `PlatformIntegrationService`):
- New `DocumentStorageService::healthCheckResult()` returns `{ok, target, operational}`. `healthCheck()` still returns a plain `bool` (it delegates), so any other caller is unaffected.
- `target` comes from the path actually run, not the `enabled` flag: `saved_provider` (integration enabled, `verifyPlatformConfiguration()` run), `local_fallback` (the driver `settings()` builds is local), `environment_storage` (no saved integration but the server environment configures a non-local driver; a third value, because that is neither of the two proposed ones).
- `operational` is where documents are stored **now** (`effectiveDriver()`, which follows the lock): `local` or `external`. It is reported separately from `target`; a passing provider test does not mean documents go there.
- The route response keeps `ok` and `message` and adds `target` and `operational_storage`. With the integration disabled, `ok` still reflects the real local test and the message says only the local fallback was tested and the external provider was not. The enabled messages are unchanged.
- No new external call when disabled; write/exists/read/delete, authentication and secret handling are untouched.

**Frontend** (`/platform/integrations`):
- Reads `target` from the response. `local_fallback` is shown as neutral information (info icon, warning-toned border, `role="status"`) even when `ok` is true, with its own bilingual text; `saved_provider` follows `ok`; `environment_storage` is labelled as such.
- A second line shows the destination for **new** document writes from `operational_storage` (local or external). It does not describe where every existing document lives: a document written while the lock was open keeps being read from the external provider after the lock closes (Codex review finding, accepted; wording corrected).
- Texts come from the translation files (8 keys added in `ar` and `en`), not from the server's Arabic message.
- Responses without `target` (older servers, other integrations) render exactly as before. The target is never inferred from the local, unsaved toggle.

## Files

| File | Change |
|---|---|
| `app/Services/DocumentCenter/DocumentStorageService.php` | `healthCheckResult()`, target constants, legacy check kept as a private method |
| `app/Services/PlatformIntegrationService.php` | `testDocumentStorage()` builds the response |
| `tests/Feature/PlatformStorageTestTargetTest.php` | new, 11 HTTP/service tests |
| `web/src/app/platform/(console)/integrations/page.tsx` | `storageTestNotice`, info tone, detail line |
| `.../integrations/integrations.test.tsx` | +8 tests |
| `web/src/messages/ar.json`, `en.json` | +8 keys each (added only) |

## Backward compatibility

`ok` and `message` keep their shape; `target`/`operational_storage` are additive. The only observable change for a client that ignores the new fields is the **message text** when the integration is disabled (it now says the local fallback was tested), and `ok` is unchanged. `healthCheck()` keeps its boolean contract (a test pins it). The existing tests for the enabled path, the lock and the diagnose command pass unchanged. Other integrations' responses are not touched.

## Tests actually run

All storage in these tests is a local fake or an in-memory mock: no external provider contacted, no real key.

| Check | Result |
|---|---|
| `PlatformStorageTestTargetTest` (new) | disabled with saved settings → `local_fallback`, correct message, `ok` true, provider builder never called, temp file removed; no saved settings → `local_fallback`; local failure → `ok` false + `local_fallback`; enabled success → `saved_provider`, `ok` true, object cleaned; enabled failure → `saved_provider`, `ok` false; lock closed vs open changes only `operational_storage`; disabled + lock open stays `local_fallback`; environment-configured storage → `environment_storage`; response keys exactly `ok, message, target, operational_storage`, no secret or key id in the response or in any log record; `healthCheck()` still a boolean; read-only platform token still 403 |
| Related backend (SQLite, isolated file DB) | 88 passed, 5 failed |
| Related backend (PostgreSQL 16 local, database cloned from a migrated template) | 88 passed, 5 failed (identical) |
| The 5 failures | all in `DocumentStorageDiagnoseTest`: `Class "Aws\Exception\AwsException" not found` — this container has no AWS SDK. They fail identically without this change (seen in the earlier full Laravel runs); GitHub CI on this PR is the authority for them. Not caused by this change |
| Frontend `integrations` folder | 50 tests passed (8 new): local pass is information not success, local failure is an alert, provider success/failure follow `ok`, operational line is separate, older response unchanged, target not inferred from the unsaved toggle, other integrations unchanged, keys in both languages |
| Mutation checks | backend: reporting disabled as `saved_provider` fails 5 tests; deriving `operational` from the enabled flag instead of the lock fails 1. Frontend: showing a local pass as plain success fails 1; ignoring `target` fails 5 |
| Full web suite | 523 files, 5573 tests passed |
| `tsc --noEmit` | 48 errors, equal to the baseline (all in test/spec files) |
| `next build` | exit 0 |
| GitHub CI | recorded on the PR for the final head |

**Real backend, isolated test data (real Laravel app on SQLite; fake endpoint and fake key ids, nothing production):**

| Saved state | `POST .../document_storage/test` |
|---|---|
| no row | 200 `ok:true target:local_fallback operational_storage:local`, message says local fallback only |
| saved and disabled | same: `local_fallback` |
| saved and enabled, endpoint unreachable | 200 `ok:false target:saved_provider operational_storage:local`, message "could not verify the private storage" |

The fake secret never appeared in a response or the application log; no `healthchecks` file was left on the local disk.

## Pre-merge reviews

**Implementer.** Backend change is confined to the storage test: one new method, one response builder, the old logic moved unchanged into a private method. Frontend change is one notice builder and one tone. Nothing in the resolver, the lock, document read/write or the other integrations changed.

**Reviewer.** `target` is derived from what ran, which the "disabled but env-configured S3" case shows matters (a third value was added rather than mislabelling it). `operational_storage` is derived from the lock-aware driver, and a test fails if it follows the enabled flag instead. The five Diagnose-test failures were checked to be the missing AWS SDK in this container, not the change.

**AWJ Guardian.** No change to storage selection, document handling, schema, permissions or Tenant Isolation; the test writes and deletes only a synthetic `healthchecks/` object and no tenant data. No external call was added for a disabled integration. Responses and logs carry no key or secret (asserted). `operational_storage` exposes only `local` or `external`, to platform administrators who already see the integration settings. No merge, deploy or production action taken.

## Remaining risks and open items

- A client that treated "`ok:true`" on a disabled card as "provider connected" now gets a message saying otherwise; `ok` itself is unchanged by design (owner decision), so such a client must read `target`. The only client found is this page.
- `environment_storage` is a value beyond the two proposed; it only appears when the server environment configures a non-local driver with no saved integration.
- The 5 `DocumentStorageDiagnoseTest` failures in this container are environmental; their status on CI decides.
- Production's `DOCUMENT_DURABLE_STORAGE_ENABLED` value and any real provider were not examined or contacted.

## Git state

- Branch: `claude/awj-h15-10-storage-test-target` (new, from `origin/main`).
- Base SHA: `704a7efe1f5aabdd4ba3cb8b92394510446261e7`.
- Code head: `e8d5a65ad3f7365af050a2f710222c08c6af6245`; the PR head also includes this report.
- PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. No merge, deploy or Horizon closure.
