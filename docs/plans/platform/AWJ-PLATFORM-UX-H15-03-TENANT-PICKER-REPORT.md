# H15-03 — Scan exception tenant picker: complete tenant access — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Follow-up to the H1-5 report ([AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md)) · Date: 2026-10-13
Scope: **Frontend only.** No Backend, API format, database, migration, permission or Tenant Isolation change. The other open H1-5 items are not addressed here.

## Defect (H15-03)

The file-scan exceptions card (`/platform/integrations`) filled its tenant `<select>` from one call, `GET /platform/tenants`, with the server's default page size. Only the first 20 tenants (newest first) could be chosen; with 28 tenants, 8 could never receive an exception. No search, no paging, and nothing told the administrator that the list was cut.

## Root cause

`file-scan-exceptions.tsx` read only `data` of the first page and ignored the `pagination` object the API returns. The API already supported everything needed: `GET /platform/tenants?search=&page=&per_page=` returns `{ data, pagination: { current_page, last_page, per_page, total } }` and `search` matches name, slug, owner email and (for digits) account/support number. So **no Backend change was needed**.

## What changed

All in `file-scan-exceptions.tsx` (plus message keys and tests):

- **Server-side search.** A labelled search box (debounced 250 ms) sends `search=` to the API; results replace the list from page 1. Nothing is filtered locally inside the first 20.
- **Load more.** A button pages through the API (`page=2,3,…`, 20 per page) and appends. It disappears on the last page. A line states "Showing N of TOTAL tenants" so the administrator knows whether the list is complete. All tenants are never fetched at once.
- **The selected tenant is kept** (held as its own record) while paging, searching and clearing the search; if a search no longer lists it, it stays as the first option of the select.
- **Distinct states**: loading ("Loading tenants…"); empty ("No tenants match “…”.", or the existing "No tenants are available" with no search); failure ("Could not load tenants.") with **Retry**; a failed *Load more* says the already-loaded tenants are kept, and Retry loads that same page.
- **A failed replacement search leaves nothing stale to pick:** if page 1 of a new search fails, the previous query's results are removed (only the selected tenant remains), so an unrelated tenant cannot be chosen while the UI says the search failed (Codex review finding, accepted).
- **Only a loaded tenant can be chosen.** A value that is not among the loaded (or already selected) tenants is ignored, so an arbitrary id can never be sent.
- **No duplicates.** Pages are merged by tenant id, so a row that shifts between two pages (new tenant created while paging; the API orders by `created_at` only, without an id tie-break) is listed once.
- **Stale responses are ignored.** Only the newest request writes state, so a slow earlier search cannot overwrite a later one.
- **Default selection unchanged:** on the first unfiltered load the first tenant is pre-selected exactly as before; later loads never replace a choice.
- The exception list (`GET /platform/document-file-scan-exceptions`) is now reloaded on its own (after grant/revoke), so granting no longer refetches tenants or disturbs the picker.
- Accessibility: native `<input type="search">` and `<select>` (Tab order: search, tenant, Load more), visible `<Label>`s, one polite live region (`aria-live="polite"`, referenced by `aria-describedby`) for status and errors, `aria-busy` while loading, 44 px controls. AR/EN with RTL.

**Not changed:** grant and revoke requests (same endpoints, same bodies), duration/expiry, password confirmation, status badges, platform permission scope, Tenant Isolation, the API and the database. No dependency was added.

## Files

| File | Change |
|---|---|
| `web/src/app/platform/(console)/integrations/file-scan-exceptions.tsx` | server-side search, paging, state handling, kept selection |
| `web/src/messages/en.json`, `ar.json` | 8 keys added (`scanExTenantSearch`, `…SearchPlaceholder`, `scanExTenantsLoading`, `…Showing`, `…NoMatch`, `…Failed`, `…MoreFailed`, `…More`) |
| `.../integrations/tenant-picker.test.tsx` | new, 18 regression tests |
| `.../integrations/integrations.test.tsx` | tenant mocks match `/platform/tenants?…` (path now has a query string); no assertion changed |
| this report | |

## Tests actually run

**Mocked (a fake server with the real pagination contract; not evidence about the server):** `tenant-picker.test.tsx`, 18 tests:

| # | Required case | Covered by |
|---|---|---|
| 1 | tenant in the first 20 | listed and default-selected; request is `page=1&per_page=20` without `search`; grant body has its id |
| 2 | tenant on page 2 or later | Load more twice reaches all 45; `Tenant 33` granted with its own id |
| 3 | search over a large list | `search=Tenant 4` is sent to the server; a tenant outside the first 20 (`Tenant 45`) is found; clearing the search returns to page 1 |
| 4 | no results | "No tenants match" shown; no alert, no loading text |
| 5 | API failure and retry | initial failure shows the error and Retry recovers; failed *Load more* keeps loaded rows and the selection, Retry loads page 2; a failed *replacement search* drops the previous results (only the selected tenant stays choosable) and Retry recovers |
| 6 | selection survives paging | selected `t05` kept through Load more and through a search that does not list it |
| 7 | no duplicates | page 2 repeating a row from page 1 is listed once; a slow older search cannot overwrite a newer one |
| 8 | correct tenant id | every grant asserts the exact `tenant_id` in the POST body |
| 9 | platform session only | only the platform client is called, all paths are `/platform/…`, the ERP client is never called, the ERP `token` in storage is untouched |
| 10 | keyboard | search → Tab → select → Tab → Load more; `userEvent.selectOptions` and Enter work; labels, `aria-describedby`, live region |
| 11 | grant/revoke unchanged | exact POST bodies; granting does not refetch tenants and keeps the picker state; a forged option value is refused |

Also: both locales have all new keys and the picker renders in Arabic.

Mutation checks (each reverted change fails tests): dropping the `search` parameter (5 tests fail), disabling the id-based merge (1), accepting an unknown value as the selection (1), keeping old results after a failed search (1).

| Check | Result |
|---|---|
| integrations folder | 7 files, 68 tests passed (the 50 existing ones unchanged and passing, plus 18 new) |
| Full web suite (`npm test`) | 524 files, 5591 tests passed |
| `tsc --noEmit` | 48 errors, equal to the baseline; none outside test/spec files, none in the changed files |
| `next build` | exit 0 |
| GitHub CI | recorded on the PR for the final head (this file is part of that head) |

**Real backend, real browser (Chromium; Laravel on SQLite with 45 isolated tenants named `H1503 Tenant 01..45`; Next dev server; no route interception — these are the real requests):**

| Scenario | Observed |
|---|---|
| Open the page | 20 options, "Showing 20 of 45 tenants." and a Load more button; newest tenant pre-selected; `GET /platform/tenants?per_page=20&page=1` → 200 (sent twice in the dev server because React Strict Mode runs effects twice; the second answer is the one used) |
| Tenant 03 (the 43rd newest) | not in the first 20; after Load more twice (`page=2`, `page=3`, both 200): 45 options, 45 unique, Load more gone, "Showing 45 of 45" |
| Selection kept | chose Tenant 03, searched `Tenant 4`: `GET …&search=Tenant+4` → 200, 6 matches, Tenant 03 still selected (shown first) |
| Empty | `zzz-no-such` → "No tenants match “zzz-no-such”." |
| Keyboard | Tab from the search box lands on the tenant select |
| Real grant | searched `Tenant 03`, chose it, `POST /platform/document-file-scan-exceptions` → **201** with `tenant_id` = Tenant 03's real id; the stored row's `tenant_id` equals it (read back from the database); the ERP token in localStorage was untouched |
| Arabic | `dir="rtl"`, search label "بحث عن مؤسسة", "يُعرض 20 من 45 مؤسسة.", Load more reaches 40 |

Not run against the real backend: the API-failure and retry paths (covered by the mocked tests only).

## Reviews

**Implementer.** Smallest fix that uses the existing API: server search plus the existing pagination; no new dependency, no Backend change. The selected tenant is held apart from the loaded rows so no later load can replace it. The mocks in the existing test file had to accept a query string; no assertion was edited.

**Reviewer.** Checked that no code path sends an id the administrator did not pick (an unknown select value is ignored), that merging by id handles the API's order by `created_at` only, that a slow earlier response cannot win, and that a failed second page does not lose the first. Grant/revoke code is byte-identical apart from no longer refetching tenants.

**AWJ Guardian.** No change to permissions, Tenant Isolation, the API or the database; only the platform client and platform token are used; all test data is isolated (45 fake tenants, a fake password, no production data). Exception grant, expiry, password confirmation and revoke are untouched. No merge, deploy or production action taken.

## Remaining risks

- The tenants API orders by `created_at` descending without an id tie-break. Tenants created in the same instant, or created while an administrator is paging, can shift between pages; the UI merges by id (no duplicates) but could in theory miss a row that moved to an already-loaded page. Search finds any tenant regardless. A stable secondary sort would be a small Backend change and needs Safwan's approval; it is not part of this PR.
- Search matches the API's fields (name, slug, owner email, account/support number); other fields are not searchable.
- The first tenant is still pre-selected on first load (unchanged behaviour). After a granting mistake the exception can be revoked; making "no default" would be a separate UX decision.
- Real screen reader and browsers other than Chromium: NOT VERIFIED.
- Pre-existing and unchanged: the `IntlError` console noise from `appBuilder.*` message keys containing a dot, and the other open H1-5 items.

## Backward compatibility

No API, schema, permission or request-body change. Grant and revoke payloads are identical. Eight translation keys added, none changed.

## Git state

- Branch: `claude/awj-h15-03-tenant-picker` (new, from `origin/main`).
- Base SHA: `bf64b95f464a71efe841f0f41729786d59f934f2` (the H15-10 merge, PR #1383).
- Code Head SHA / PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. Not started (each needs direction): the Backend `Accept` 401 behaviour, the Backend 422/409 for concurrent duplicate prices, a stable secondary sort for the tenants API, and the remaining H1-5 P2/P3 items. No merge, no deploy, Horizon not closed.
