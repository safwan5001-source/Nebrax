# H15-04 — Platform audit export session handling — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Follow-up to the H1-5 report ([AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md)) · Date: 2026-10-13
Scope: **Frontend only** (`web/src/lib/platform-api.ts` and tests). No Backend, middleware, endpoint, permission, Tenant Isolation, CSV format or token-storage change. The other P2 findings are not addressed here.

## Defect (H15-04)

When a platform administrator's session expired or was revoked while the page was open, **Export audit CSV** showed a generic error, left the stale token in storage and did not return the user to sign-in, unlike every other platform request.

## Cause (confirmed on a real backend)

Two differences between `platformDownloadFile` and `platformApi`:

1. `platformDownloadFile` sent **no `Accept` header**. For an expired or missing token the Backend then answers **500 with an HTML page** (it tries to redirect to a sign-in route that does not exist for the API) instead of **401 JSON**. Measured against the real Laravel app, same expired token, same URL:

   | Request | Result |
   |---|---|
   | no `Accept` | `500 text/html` |
   | `Accept: application/json` | `401 {"message":"Unauthenticated."}` |
   | valid token, with or without `Accept` | `200 text/csv; charset=UTF-8`, `Content-Disposition: attachment; filename=platform-document-audit.csv`, identical bytes |

2. Even given a 401, `platformDownloadFile` had **no 401 handling**: it only threw. `platformApi` clears the platform session and redirects to `/platform/login`. It also fell back to a hard-coded Arabic message ("حدث خطأ") on any failure, shown on the English UI.

## Fix

In `web/src/lib/platform-api.ts`:

- **`Accept: application/json`** is now sent with the download request (compatible with the Backend contract, verified above: the file returned for a valid session is byte-identical).
- **401** goes through one helper, `expirePlatformSession()`, now shared by `platformApi` and `platformDownloadFile`: it clears the **platform** session only (`platform_token`, `platform_administrator`) and calls `window.location.assign('/platform/login')` unless already on the login page. ERP and tenant keys (`token`, `user`, `nibras_active_branch`) are never touched. `platformApi` behaves exactly as before (it now calls the same helper; a test pins this).
- **403** stays a permission refusal: the session is kept, no redirect; the page already maps it to "Your platform role does not allow this."
- **5xx**: the response body is **never read** (it can be an HTML page or a technical trace), and the thrown error carries an empty message and an empty body. The page therefore shows its own translated text ("The platform action could not be completed."). A debug backend's JSON message (SQL, trace) is not passed on either.
- **401** error message is also left empty so the page shows its own translated text instead of the server's English "Unauthenticated." during the redirect.
- Other 4xx (for example the rate limit 429) keep the server's text message, as before.
- **Unchanged:** the downloaded blob (the very object the server sent), the file name (`platform-document-audit.csv`, the caller's fallback as before), the type, the one-click anchor mechanism, the endpoint and the CSV columns. The demo-mode shortcut is unchanged.

No new translation key was needed: the page already had `platformActionFailed` and `platForbidden`.

## Files

| File | Change |
|---|---|
| `web/src/lib/platform-api.ts` | `expirePlatformSession` helper (shared), `Accept` header, 401 handling and 5xx-safe error in `platformDownloadFile` |
| `web/src/lib/platform-download.test.ts` | new: 10 regression tests, **mocked `fetch`** |
| `web/src/app/platform/(console)/document-operations/document-operations.test.tsx` | +1 test: translated texts for a 401, 403 and 500 export (page level, mocked client) |
| this report | |

## Tests actually run

**Mocked (not evidence about the server):** `platform-download.test.ts` (jsdom, `fetch` replaced) covers: 200 with the right headers and the same blob, file name, bytes (BOM and CRLF included) and anchor mechanism, session untouched; no `Authorization` header when there is no token but `Accept` still sent; 401 clears the platform session only, redirects once, starts no download, leaves ERP keys intact; 401 on the login page does not redirect again; 403 keeps the session and does not redirect; 500 with an HTML page: no body read, nothing from it in the error; 500 with a JSON debug message: not passed on; 429 keeps the server message; demo mode makes no request; and `platformApi` still clears and redirects on 401 after the refactor.
Mutation checks (each reverted change fails tests): removing `Accept` (2 tests), the download 401 handling (2), reading 5xx bodies (2), clearing the session on 403 too (1), clearing the ERP token (2).

| Check | Result |
|---|---|
| New and related tests (`platform-download`, `document-operations`) | 11 new tests added, all pass |
| Full web suite | 523 files, 5565 tests passed. A first run showed 9 unrelated files failing: my new test replaced `window.location` and the `URL` stubs and did not restore them, which leaked into other files in the same worker. Fixed (restored after every test) and the suite re-run in full, which is the result stated here |
| `tsc --noEmit` | 48 errors, equal to the baseline; none outside test/spec files, none in the changed files |
| `next build` | see the PR (recorded below if complete before this was committed) |
| GitHub CI | recorded on the PR for the final head (this file is part of that head) |

**Real backend, real browser (Chromium, Laravel on SQLite with isolated test data, Next dev server, no route interception — these are the real requests):**

| Scenario | Observed |
|---|---|
| Valid session, Export | `GET /platform/document-audit/export` → 200; download `platform-document-audit.csv`; status text shown (English and Arabic); header `occurred_at,scope,tenant_id,batch_id,event_type,stage,status,reason_code,safe_message` with the BOM; the downloaded rows equal the rows the API served just before plus the one row the export itself logs (each export writes one audit event, so two consecutive downloads differ by that row); platform and ERP sessions intact |
| Session expired (token revoked server-side while the page was open), Export | 401 JSON (before the fix: 500 HTML); redirected to `/platform/login`; `platform_token` and `platform_administrator` cleared; ERP keys (`token`, `user`, `nibras_active_branch`) intact; no HTML, trace or "Server Error" text on screen |
| Read-only platform token (403), Export | 403; the alert "Your platform role does not allow this."; still on the page; platform token kept; ERP keys intact |

## Remaining risks and separate issues

- **Backend: 500 instead of 401 when `Accept` is absent (separate Backend defect, not changed).** Any bare request without `Accept` (the export before this fix, and, measured in H1-5, `/platform/overview` and `/platform/prices` called without the header; other routes were not measured) gets a 500 HTML page for an expired or missing token. The Frontend now avoids it for the audit export by sending `Accept`, but the Backend should answer 401 JSON regardless. Fixing it needs a Backend change and **Safwan's approval**; it is not part of this PR.
- Only the export path was changed. Other direct `fetch` uses (none exist in the platform pages beyond `platformApi` and this function) were not audited here.
- The 401 redirect uses a full page navigation, as `platformApi` already does; unsaved form state on the page is lost, as it is for any other expired-session request.
- Pre-existing and unchanged: Arabic-only messages that the server itself sends (H15-12), and the other open P2/P3 items in the H1-5 report.
- No new sensitive data is exposed or stored: nothing from a 5xx body reaches the error, and the token handling is unchanged.

## Backward compatibility

No API, schema, permission or CSV change; the file, its name and type are byte-identical for a valid session; `platformApi`'s behaviour is pinned by a test; no translation key added or changed.

## Git state

- Branch: `claude/awj-h15-04-audit-export-session` (new, from `origin/main`).
- Base SHA: `71cf6396728bbc65ea0921a7afee25b3945e5189` (the H15-05 merge, PR #1378).
- Code Head SHA: `53c9d2d1` (the PR head also includes this report).
- PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. Not started: the Backend change so that a request without `Accept` answers 401 JSON (needs approval), and the remaining H1-5 P2 items. No merge, no deploy, Horizon not closed.
