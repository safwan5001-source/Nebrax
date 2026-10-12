# H1-4A — Platform Tenants Management UX — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-4A (tenant list only) · Date: 2026-10-12
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §8 and §12.3

## Outcome

`/platform/tenants` is reorganised inside the merged `PlatformShell`: a clean header, a labelled "Tenant list" section, a filter group with explicit page-only wording, honest counts and CSV scope, mobile cards that keep every field, and distinct loading, error and empty states. Search, pagination, the stale-response guard and every request URL are unchanged. Filters stay local. No API, schema, permission or tenant-detail change.

## What was done

Product code: `web/src/app/platform/(console)/tenants/page.tsx`, plus two additive optional props on the shared `DataTable`.

- **Header:** the page-level "back" link is removed (the shell owns navigation). One `h1`, subtitle, and a Refresh button with a visible label and 44px height (it was an icon-only 32px button). Page `min-h-screen` and background removed; the shell supplies them.
- **Global controls card** stays directly under the header, unchanged. It now also stays visible when the list fails (before, a list error replaced the whole page, including that card).
- **Tenant list section** (`section` + `h2`):
  - *Filters* in a labelled group: plan and status selects, 44px high, full width on phones, 176px from `sm`; **Clear filters** appears only when a filter is on.
  - *Scope text*, always visible: "Filters apply to this page only." and "CSV exports only the rows currently shown on this page, not every tenant." When a filter is on, a third sentence says other pages are not checked and the total is not affected.
  - *Count line* (`aria-live="polite"`): "Showing {shown} of {loaded} rows loaded on this page. Total across all pages: {total}." `shown` and `loaded` are local counts; `total` is the server's `pagination.total`. The local figures are never presented as the global total.
  - *DataTable* (not rebuilt): the search box now has an accessible name; the CSV button's name and tooltip say "rows shown on this page only". CSV still exports exactly the table's rows (the page's rows after the local filters).
  - *Pagination* footer unchanged.
- **Empty states:** three distinct cases. No tenants at all (`empty`), the search matched nothing (`emptySearch`), or local filters hide every loaded row (`emptyFiltered` + a hint that other pages were not checked + a Clear filters button). The last case used to read "No tenants yet", which was misleading and was listed as a risk in the H1-PAGINATION report.
- **Error state:** `role="alert"` card with a 44px Retry that repeats the same page and search; the global controls card stays.
- **Loading:** unchanged DataTable loading state; the count line is blank while loading.
- **Mobile cards** (below 768px, through the existing `mobileRecord` prop of `DataTable`): name link first (44px, wraps, `dir="auto"`), then account number and slug, users count, status and plan badges, trial date or "No trial", then a detail block with owner name, support number, owner email and phone as LTR values. Nothing the table shows is dropped.
- **Desktop and tablet table:** unchanged component. Plan and status are now the 2nd and 3rd columns (they were 7th and 8th), so the most important state is not pushed out of view by the table's contained horizontal scroll. Email, phone and trial date are `dir="ltr"`.
- **Messages:** 10 new keys in `platformTenants` (ar and en).
- **`DataTable` additive props:** `searchLabel` (defaults to the placeholder, which is the spec's rule), `exportLabel` (when absent, the button keeps its previous title and has no `aria-label`) and `exportColumnOrder` (see "Review correction"). No other behaviour changed.
- **Docs:** H1-3 report corrected to MERGED (PR #1358, `b97b19dd28818fbf9e84dfcc037602d56486fe33`, CI and pre-merge review recorded); horizon status updated; this report.

## Not done, deliberately

- Plan and status remain local to the loaded page. No server-side filter, no query parameter, no API change.
- No tenant detail change (H1-4B). No other page touched.
- No change to `Pagination`, `MobileRecord`, `Table` or any other shared component. Pagination buttons keep their shared 36 to 40px size (see risks).
- No change to search debounce, the stale-response guard, overshoot correction or request URLs.
- H1-4B not started.

## Files changed

- `web/src/app/platform/(console)/tenants/page.tsx`
- `web/src/app/platform/(console)/tenants/tenants-ux.test.tsx` (new, 10 tests)
- `web/src/app/platform/(console)/tenants/tenants-pagination.test.tsx` (3 assertions updated, see below)
- `web/src/components/data-table.tsx` (three optional props) and `web/src/components/data-table.test.tsx` (+4 tests)
- `web/src/messages/ar.json`, `web/src/messages/en.json` (+10 keys each)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4A-TENANTS-REPORT.md` (new)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-3-DASHBOARD-REPORT.md`, `AWJ-PLATFORM-UX-H1.md` (status/closure only)

### Existing H1-PAGINATION tests

All nine still pass and all behavioural assertions are unchanged (page and `per_page` query strings, page reset on search and page size, stale-response guards, overshoot correction, signed-out redirect, `pagination.total` as the count). Three assertions encoded the old markup and were updated: the empty text after a filter hides every row (now `emptyFiltered`, intentionally), the header layout class (`lg:flex-row` to `sm:flex-row`), and the filter group's wrap class (`flex-wrap` to `sm:flex-wrap`).

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run src/components/platform src/app/platform src/design src/components/data-table.test.tsx` | 18 files, 211 tests passed (after the CSV correction) |
| `npm test` (full web suite) | 501 files, 5273 tests passed (after the CSV correction) |
| `npm run build` | passed; all 7 `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, same count as `main`; none in the tenants page, its tests or `data-table` |
| ESLint | not run: the repo has no ESLint config |

New tenants tests (10, jsdom, real `DataTable` and real `ar.json`/`en.json`): no links in the header, Refresh label and height; scope text, count line, export and search names; filters change only the shown count, warn, and make no request; **CSV contains only the filtered rows of the loaded page**; **CSV header and value order are the pre-reorder order**; the three empty cases and Clear filters; error keeps the global controls and Retry reloads the same page; mobile cards keep every field in the required order with LTR values and a 44px link, and placeholders for a tenant without contact or trial; Arabic render; message keys in both locales. Search, pagination, filters, export and actions are covered together with the nine retained H1-PAGINATION tests and the two reference-number tests. The page has no row actions beyond the name link, so "actions" means that link, Refresh, Retry and Clear filters.

Real browser (Playwright-core and Chromium, Next dev server, demo mode; **the `/platform/tenants` API response was intercepted with a 25-row fixture** and the other API calls returned 503, because no Laravel API ran). Ad-hoc probes, not committed and not run by CI.

| Probe | Matrix | Result |
|---|---|---|
| Layout | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × `ar`/RTL, `en`/LTR × light, dark = 32 | 0 failures: no page-level horizontal overflow, direction and theme correct, one `h1`, no links in the header, cards below 768 (25 of 25) and the table from 768, table scroll contained, every new control (Refresh, filter selects, Clear, card name links) at least 44px |
| Behaviour (390 and 1440) | filters, pagination, search | local filters changed only the count line and made no request; Next page requested `page=2`; search requested `page=1&search=abc` |
| Keyboard (1440, en) | 14 Tab presses from Refresh | order: Refresh, the global card controls, plan, status, search, CSV, then the sortable column headers; the new controls are all reachable |
| States (390, ar) | failure, slow load | failure card showed `role="alert"` and the global controls card was still present; the loading state rendered |

The fixture used a 60-character Arabic name, a long slug and 55-character emails to stress layout. Findings from screenshots, both fixed before this report: the mobile name was clipped by `truncate` (now wraps and uses `dir="auto"`), and in RTL at 1440 the status and plan columns were pushed out of the visible table area by the scroll (now columns 2 and 3).

## Responsive and accessibility results

- **320 to 1920, RTL and LTR, light and dark:** verified as above. No page-level horizontal overflow; wide tables scroll inside their wrapper only, as the spec allows.
- **Names and targets:** search box, CSV button, filter group, Refresh and Retry all have accessible names; new controls are at least 44px.
- **Not verified:** landscape, zoom and text scaling, screen readers, and a real authenticated session against the API (rows came from the fixture). H1-5 owns those. Plan/status filters were not exercised against empty-result keyboard flows beyond the unit tests.

## Review correction: CSV column order (P1)

Finding: moving plan and status up in the table also moved them in the exported CSV, because `DataTable.exportCsv` follows the current column order. That is a backward-compatibility break for anyone parsing the export by position.

Fix, smallest form:
- `DataTable` gets one optional prop `exportColumnOrder?: string[]` (column ids). When absent, `exportCsv` is byte-for-byte what it was, so no other table changes. When present, the export columns are stably sorted by that list; unlisted columns follow in display order. Only the order is affected: header text, cell values, filtered row set and file name are untouched.
- The tenants page passes the order it shipped with in H1-PAGINATION: `name, account_number, support_number, contactName, contactEmail, contactPhone, plan, is_active, trial_ends_at, users_count`. The on-screen table keeps plan and status in columns 2 and 3.

Regression tests: the tenants test asserts the exact header row (Organization, Account number, Support number, Owner name, Owner email, Phone number, Plan, Status, Trial ends, Users) and the exact value rows for a full tenant and a tenant without contact or trial (`Free Co,1000001,2000002,Owner One,owner@example.com,+966500000000,free,true,2026-12-31,7` and `Pro Co,1000001,2000002,,,,pro,false,,7`), and that the on-screen headers start `Organization, Plan, Status`. I confirmed the test fails without the prop (the header then starts `Organization,Plan,Status,Account number`) and passes with it. Two `DataTable` tests pin the default (display order) and the override (declared order, unlisted columns following). Scope of the CSV is unchanged: the loaded page after the local filters, as before.

## Pre-merge reviews

### Implementer

One page file plus two additive `DataTable` props. The request logic (`load`, `desired`, `requestSeq`, overshoot correction) was not edited, so the retained H1-PAGINATION tests and their guard scenarios remain valid. The `useCallback` for `mobileRecord` keeps `DataTable` from re-creating rows needlessly.

### Reviewer

- The count line and the CSV note cannot imply a global figure: `total` is explicitly "across all pages", `shown` and `loaded` are explicitly "on this page", and CSV exports `data` (the locally filtered page), which a test asserts.
- Reordering the display columns reordered the CSV, because `DataTable` exports in display order. This was found by the independent review as a P1 and is corrected, see "Review correction".
- `searchLabel` defaults to the placeholder, so other screens gain a name equal to their placeholder text and nothing else changes; the two new `DataTable` tests pin both the default and the override.
- The mobile detail block reuses the card's actions slot for layout only; it contains no actions. A real row action would need a shared-component change and was out of scope.

### AWJ Guardian

- **Platform vs tenant:** the page reads only `/platform/tenants` through `platformApi`. No tenant context, branch header or ERP component is used. Platform auth and the redirect to the platform login are unchanged.
- **Data and isolation:** no request shape changed, no new field is requested or stored, no tenant data is sent anywhere new. CSV is generated in the browser from the already loaded rows, as before.
- **Money and accounting:** none involved.
- **Backward compatibility:** URLs, query strings and API calls identical; translation keys only added; `DataTable` props are optional with unchanged defaults.

## CI

Recorded on the pull request for the exact head SHA (the checks and the final head are listed in the PR and in the hand-off summary). This file is part of that head, so it does not restate results that did not exist when it was committed.

## Merge / post-merge

- Merge status: not merged. Merge SHA: none. Post-merge review: not done. Deploy: not requested.
- Post-merge verification of #1318, #1328, #1355 and #1358 on `main` has not been recorded; this slice does not claim it.

## Risks and remaining work

- **Local filters can hide rows that exist on other pages.** The text says so in three places, but a user can still miss a tenant that is not on the loaded page. The fix is server-side filtering, a separate API slice.
- **Pagination controls** (previous, next, rows per page) are 36 to 40px high. They belong to the shared `Pagination` component, which this slice must not refactor.
- **Global controls card** selects are 36px; it is a separate component and untouched.
- Display column order changed (plan and status moved up); the CSV order did not (see "Review correction").
- **Tablet width** (768 to 1023) still scrolls the 10-column table inside its wrapper when emails are long; that is allowed by the spec and a later density pass could revisit it.
- Browser rows came from an intercepted fixture, not the Laravel API.
- Pre-existing and unrelated: 48 `tsc` errors in test files; `IntlError` for a `cart.itemCount` key printed by some tests; Next dev overlay badge in dev screenshots.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after #1358 merged; the older remote history is merged in so no force-push is needed).
- Base SHA: `b97b19dd28818fbf9e84dfcc037602d56486fe33` (`origin/main` at start).
- Head SHA and PR: see the pull request.

## Next dependency-ready task

H1-4B tenant detail (spec §12.4: one-column identity grid on phones, dialogs in place of `window.confirm`, logical back icon). Not started.
