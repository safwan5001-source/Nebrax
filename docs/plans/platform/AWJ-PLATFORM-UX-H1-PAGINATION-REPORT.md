# H1-PAGINATION — Implementation report

Status: **IN REVIEW / DO NOT MERGE / DO NOT DEPLOY**  
Horizon: AWJ-PLATFORM-UX-H1  
Slice: first code slice after the merged H1-1 spec (PR #1312)  
Date: 2026-10-11

## SHAs

| | |
|---|---|
| Base (`main`) | `eae4bd7c3c1219bdab6552519f127bdb3577d479` |
| Branch | `feat/awj-platform-ux-h1-pagination` |
| Head | The tip of that branch. The pull request body repeats the exact head SHA after push. This file is part of that commit, so the hash cannot be written inside itself. |

## What changed

The tenant list was requesting `per_page=100` and ignoring `pagination`, so any tenant past the first hundred rows could not be opened. The page now requests the existing list API:

`/platform/tenants?per_page={25|50|100}&page={n}` plus `search` when the box is not empty.

Laravel already reads `page` inside `paginate()`. No controller, service, route, or schema change.

Plan and status stay **filters of the loaded page only**. A visible sentence says so, in Arabic «التصفية على هذه الصفحة فقط» and in English "Filters apply to this page only." The footer count is `pagination.total`, not the number of rows after the in-page filter, so a partial page is not presented as the full directory.

Search still debounces 250ms and now returns to page 1 before the request. Changing the page size also returns to page 1. If the API answers with `current_page` past `last_page`, the page moves to `max(1, last_page)` and fetches once. Retry and refresh repeat the current page. The refresh control has an accessible name. The signed-out redirect is unchanged. `platformApi` is still the only client, so no tenant ERP session and no `X-Branch-Id` is introduced.

## Files

- `web/src/app/platform/tenants/page.tsx`
- `web/src/app/platform/tenants/tenants-pagination.test.tsx` (new)
- `web/src/app/platform/tenants/tenant-reference-numbers.test.tsx` (expected query is now `per_page=25&page=1`; the numeric-search assertion is otherwise the same)
- `web/src/messages/en.json` and `web/src/messages/ar.json` (`pageFilterNote`, `refresh`)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1.md` (status only)
- this report

Not changed: `routes/api.php`, `PlatformTenantController`, `PlatformTenantService`, `platform-api.ts`, `Pagination` itself, `DataTable`, global application controls, tenant detail.

## Tests

Local, from `web/`:

`npm test -- src/app/platform/tenants/tenants-pagination.test.tsx src/app/platform/tenants/tenant-reference-numbers.test.tsx`

Result: **9 passed, 2 files.**

Covered:

- Page 2 is requested and rendered; the footer uses `pagination.total` (120), not the row count.
- Page 5 at 25 per page is reachable, so a tenant after the first 100 is not stuck.
- Search and page-size changes go back to page 1. A search is not sent with the old page.
- Plan and status hide rows on this page only and do not add `plan` or `status` to the query. The note stays visible. The server total stays 80 while the filtered table is empty.
- First load shows the loading status. A failed page 2 shows `role="alert"` and retry repeats `page=2`.
- An overshot `current_page` is corrected once.
- Breakpoint classes: header `lg:flex-row`, filters `flex-wrap`, pagination `flex-col` / `sm:flex-row`.
- The page does not set `dir`. `rtl:rotate-180` stays on the existing pager icons. `documentElement.dir = rtl` is left alone.
- A signed-out operator is sent to `/platform/login` and the list API is not called.

No browser was driven. These are jsdom tests. H1-5 still owes screenshots at 320, 768, 1024, and 1440.

## CI

Recorded on the pull request after push. Not claimed green in this file until the checks finish.

## Risks

- Plan and status still do not search the whole directory. The note is the guard. A later API slice can move them server-side. This slice does not.
- The empty label is still "No tenants yet" when an in-page filter hides every loaded row. The spec says to keep that label. The footer total and the note contradict a "no tenants exist" reading.
- CSV export still exports the loaded, already filtered page. It did before. It does not export every tenant.
- `Dialog` focus trap, danger-button contrast, and the shell are not in this PR.
- Out-of-range correction trusts `last_page` from the list payload. It does not invent a second request shape.

## Gate

No merge. No deploy. `H1-CONTRAST` and H1-2 are not started.
