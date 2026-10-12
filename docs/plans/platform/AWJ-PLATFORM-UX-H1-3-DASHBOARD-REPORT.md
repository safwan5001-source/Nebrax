# H1-3 — Platform Executive Dashboard — Implementation report

STATUS: MERGED (PR #1358, `b97b19dd28818fbf9e84dfcc037602d56486fe33`) / NOT DEPLOYED / POST-MERGE VERIFICATION NOT RECORDED
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-3 · Date: 2026-10-12
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §12.2 (Overview)

## Outcome

`/platform` now reads as an executive dashboard inside the merged `PlatformShell`. The page's private destination buttons, signed-in name and logout are gone (the shell owns them). Figures are grouped into four labelled sections in a fixed reading order, and the contracted-revenue figures are explicitly separated from invoiced and collected money. Every figure comes from the same `GET /platform/overview` payload and the same `formatRiyal` call as before.

## What was done

File: `web/src/app/platform/(console)/page.tsx` (one file; no shared component edited).

- **Removed:** the four destination buttons, the "signed in as" text and the page logout (and the `Link`/`platformLogout` imports). The page keeps its session guard only (redirect to `/platform/login` and no request when there is no platform session).
- **Header:** eyebrow, single `h1`, subtitle, and one Refresh button (44px high). Read-only line below it.
- **Sections in order** (each `section[aria-labelledby]` with an `h2`):
  1. *Contracted revenue*: monthly contracted revenue as the primary figure, annual contracted revenue, the existing contracted-revenue notice, and a "what the revenue figures cover" list: Contracted revenue = **Shown**; Invoiced revenue = **Not available**; Collected amounts = **Not available**, each with one sentence. No amount is shown for the two unavailable items.
  2. *Accounts*: Tenants (total, active, inactive), Users (total, active, inactive), Subscriptions (active count, active trials).
  3. *Upcoming renewals*: renewals in 7, 30 and 60 days, then the upcoming renewal value (a contract value), with a note that it is not collected cash.
  4. *Breakdown by plan*: the existing table (row headers now `th scope="row"`), contained scroll, or the existing empty sentence.
- **States:** first load shows a skeleton shaped like the final layout; **refresh keeps the last good figures** (the button disables and spins, `main` gets `aria-busy`) instead of blanking the page; a load failure shows an `role="alert"` card with a 44px retry; the empty plan list keeps its sentence.
- **Messages:** 13 new keys in the existing `platform` namespace of `ar.json` and `en.json`. Old keys (`manageTenants`, `logout`, `signedInAs`, …) are left in place; they are now unused by this page and were not removed to keep the diff small.
- **Docs:** H1-PAGINATION report corrected to MERGED (PR #1318, `31035783…`); H1-2 report corrected to MERGED (PR #1355, `2bc1c125…`, CI and pre-merge review recorded); horizon status updated; this report.

## Not done, deliberately

- No charts, trends, health scores or any metric the API does not return. `average_active_subscription` is in the payload and was not displayed before; it is still not displayed.
- No new endpoint, schema, permission or money arithmetic. No figure is derived, summed or re-rounded in the page.
- No tenant ERP surface touched; no shared component touched; no refactor outside the dashboard.
- Invoiced and collected amounts are **not** computed or estimated. The page says they are not available from this data source.
- H1-4 not started.

## Files changed

- `web/src/app/platform/(console)/page.tsx` (rewritten layout; same data/state logic)
- `web/src/app/platform/(console)/page.test.tsx` (new)
- `web/src/messages/ar.json`, `web/src/messages/en.json` (+13 keys each)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-3-DASHBOARD-REPORT.md` (new)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-PAGINATION-REPORT.md`, `…-H1-2-SHELL-REPORT.md`, `AWJ-PLATFORM-UX-H1.md` (status/closure only)

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run src/components/platform src/app/platform src/design` | 16 files, 169 tests passed |
| `npm test` (full web suite) | 496 files, 5235 tests passed |
| `npm run build` | passed; all 7 `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, same count as `main`; none in `page.tsx` or its test |
| ESLint | not run: the repo has no ESLint config |

New dashboard tests (10, jsdom, real page, mocked API and session, real `ar.json`/`en.json` and `formatRiyal`): no navigation, no logout and no signed-in name, the only button is Refresh; one `h1` and the four sections in order; every existing API field is rendered with the same formatter and `average_active_subscription` is not shown; the contracted/invoiced/collected block lists the three items with one Shown and two Not available and contains no digits; skeleton first, then last figures retained and `aria-busy` while refreshing; failure alert and retry reload the same endpoint; empty plan sentence; session guard; Arabic render; message keys exist in both locales. The mock's `useTranslations`/`useRouter` are stable objects, as in the real libraries; unstable mocks made the existing `useCallback([t])`/`useEffect` pair reload forever, which is a property of the test double, not of the page.

Real browser (Playwright-core + Chromium, Next dev server, demo mode; **the overview response was intercepted and replaced with a fixture**, because demo mode has no overview endpoint and no Laravel API ran): an ad-hoc probe, not committed, not run by CI.

| Probe | Matrix | Result |
|---|---|---|
| Page-level overflow, direction, theme, one `h1`, zero links in the page body, no logout in the page body, exactly one logout in the shell, four sections, one `main`, table scroll contained, Refresh at least 44px | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × `ar`/RTL, `en`/LTR × light, dark = 32 | 0 failures after the fix below |
| States | 390px: failure card, empty plan list, slow-load skeleton | rendered and reviewed in screenshots |

The fixture used deliberately large figures (monthly 987,654,321.00; annual 11,851,851,852.00; renewal value 1,234,567.89; a 30-character plan name) to stress layout. The first run **failed at 320px** in all four locale/theme combinations: the renewal value (`text-2xl`) overflowed a half-width grid cell and the monthly figure (`text-3xl`) was marginally wider than the card. Fixed by putting the renewal value on its own row below the three counts and by sizing the monthly figure `text-2xl` below 400px (`text-3xl` from 400px, `text-4xl` from `sm`). Re-run: 32 of 32 pass. The plan table keeps its own horizontal scroll inside the card at 320px, which the spec allows.

## Responsive and accessibility results

- Viewports 320 to 1920, both directions, both themes: verified in a real browser as above; no page-level horizontal overflow.
- Reading order is the DOM order; headings `h1` then four `h2`s then the revenue-scope `h3`; table has `scope` on column and row headers.
- Errors are `role="alert"`; refresh state is `aria-busy` on `main`; icons are `aria-hidden`.
- Colour: only existing semantic tokens (`text-text`, `text-muted`, `bg-primary-soft`, `text-primary`, `border-border`); the drift ratchet test passes. "Not available" is a neutral outlined chip, not red or green, so it does not read as a financial status.
- Not verified: landscape, zoom and text scaling, screen readers, and a real authenticated session against the API (the figures in the browser came from the fixture). H1-5 owns those.

## Pre-merge reviews

### Implementer

Only the page file changed in product code. The data effect, `load`, error handling and money formatting are the previous code; the changes are layout, labels, the refresh-keeps-data behaviour, and the guard no longer storing the administrator name. The first browser run found a real 320px overflow that the jsdom tests cannot see; it was fixed and re-measured.

### Reviewer

- The revenue-scope block cannot show a number: it renders only translated strings (asserted by a test). Nothing in the page multiplies, sums or rounds money; plan totals and averages are not computed.
- Refresh no longer swaps the page for a skeleton, so a failed refresh replaces the figures with the error card (as before) rather than leaving stale numbers beside an error.
- The page's `<main>` stays the single landmark inside the shell's `div`. `min-h-screen` is no longer on the page; the shell neutralised it anyway.
- Old message keys remain; no key was renamed, so no other consumer can break.

### AWJ Guardian

- **Money:** values come from the same string fields through the same `formatRiyal`; no float arithmetic, no new derived total. Contracted MRR/ARR and renewal value keep their meaning (contract value, not cash). The page now says explicitly that invoiced and collected amounts are not available here and does not fabricate them.
- **Platform vs tenant:** the page reads only `/platform/overview` through `platformApi`; no tenant context, branch header or tenant ERP component is involved. Permissions and the session guard are unchanged.
- **Data/API/DB:** none changed. No migration.
- **Backward compatibility:** URL and API unchanged; translation keys only added.

## CI

Final Head `53db1b59f4846e3a77cd4c614e65f3b9b7ebaf7e` of PR #1358: all 8 GitHub check runs `success` (CI Gate, web build ×2, php artisan test sqlite ×2, pgsql ×2, storefront lint/typecheck/test), read through the GitHub API.

## Merge / post-merge

- PRE_MERGE_REVIEW: PASS, recorded as a comment on PR #1358 by the repository owner account for the exact Head above; no unresolved review threads. The only bot comment was a Codex usage-limit notice.
- Merge status: merged on 2026-10-12 (about 05:50 UTC). Merge SHA `b97b19dd28818fbf9e84dfcc037602d56486fe33`, confirmed an ancestor of `main` (subject "feat(platform): H1-3 platform executive dashboard (#1358)"). The merge was not performed by the Claude session.
- Post-merge review: not done. No target-branch check or smoke evidence on `b97b19d` was collected, so none is claimed.
- Deploy / production release: not done.

## Risks and remaining work

- The browser figures came from an intercepted fixture, not from the Laravel API; the field shapes match the page's TypeScript interface and the existing code path, but a real authenticated run is an H1-5 item.
- "Not available" for invoiced and collected states what this data source provides today. If a billing/collections source is ever added to the overview payload, those two rows must be revisited, not silently filled.
- Unused translation keys remain in `platform` (old nav and logout labels); a later cleanup can remove them.
- Pre-existing and unrelated: 48 `tsc` errors in test files; `IntlError` for a `cart.itemCount` key printed by some existing tests; the Next dev overlay badge visible in dev screenshots.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after #1355 merged; the old remote history is merged in so no force-push is needed).
- Base SHA: `2bc1c1250af710af96a9aa3b0428e2a4f61925cc` (`origin/main` at start).
- Head SHA: `53db1b59f4846e3a77cd4c614e65f3b9b7ebaf7e`. PR: #1358 (merged).

## Next dependency-ready task

H1-4A tenants list (see `AWJ-PLATFORM-UX-H1-4A-TENANTS-REPORT.md`), then H1-4B tenant detail and the remaining pages, one per PR.
