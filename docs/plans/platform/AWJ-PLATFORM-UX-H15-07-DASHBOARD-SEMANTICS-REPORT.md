# H15-07 — Platform dashboard description lists — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Follow-up to the H1-5 report ([AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md)) · Date: 2026-10-13
Scope: **Frontend only, one markup block.** No Backend, API, database, calculation, permission or Tenant Isolation change. Numbers, labels, currency and date formats, card order and the page appearance are unchanged. No dashboard refactor.

## Defect (H15-07)

On `/platform` axe reported `definition-list` (serious, ×1) and `dlitem` (serious, ×6) in every run of the H1-5 pass (4 of 4 there); mocked tests had not caught it.

## Root cause (reproduced before editing)

Re-run on a real Laravel backend (SQLite, isolated data) with axe-core 4.10.2, 8 combinations (en/ar × light/dark × 1280/390 px): **both rules reproduced in all 8**, always the same single list. Of the six `dl` elements on the dashboard only the **"Revenue scope" list** (the three lines "Contracted revenue / Invoiced revenue / Collected amounts", under the revenue card) was invalid. Its groups were:

```html
<dl>
  <div class="flex …">              <!-- a div group of a dl may hold only dt and dd -->
    <div>                           <!-- not allowed: a nested div -->
      <dt>Contracted revenue</dt>
      <dd>Value of active contracts …</dd>
    </div>
    <span class="pill">Shown</span> <!-- not allowed: a span -->
  </div>
</dl>
```

The HTML content model allows a `dl` to contain `div` groups, but a group may contain **only `dt` and `dd`**. The nested `div` (used to stack term and description beside the badge) and the status `span` broke it, so `dt`/`dd` pairs were no longer valid list items (`dlitem`) and the list was invalid (`definition-list`). The other five lists (the account and subscription cards and the two renewal lists) already used the valid shape `dl > div > dt + dd` and were not flagged.

## What changed

Only the revenue-scope block in `web/src/app/platform/(console)/page.tsx` (9 lines in, 9 out):

```html
<dl>
  <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
    <dt class="… sm:col-start-1">Contracted revenue</dt>
    <dd class="… sm:col-start-1">Value of active contracts …</dd>
    <dd class="pill … sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:self-start">Shown</dd>
  </div>
</dl>
```

- The status ("Shown" / "Not available") becomes a **second `dd` of the same term**: `dt` + description `dd` + status `dd`. A term may have several descriptions, so each name stays tied to its values, and a screen reader announces the term with both.
- The nested `div` is gone; the two-column layout is kept with a CSS grid instead (term and description in the first column, the status pill at the end on wide screens; stacked on narrow screens), so nothing is replaced by a table and no markup is added.
- The pill keeps its classes (filled for shown, outlined for not available) and `self-start` so it does not stretch to the row height.

Not changed: titles, figures, `formatRiyal`, dates, card and row order, the other five lists, translations (no key added or changed), requests.

## Files

| File | Change |
|---|---|
| `web/src/app/platform/(console)/page.tsx` | revenue-scope groups: valid `dl > div > dt + dd + dd`, grid layout |
| `web/src/app/platform/(console)/dashboard-semantics.test.tsx` | new, 8 regression tests |
| this report | |

## Tests actually run

**DOM tests (Testing Library, real translation files; the API client is mocked):** `dashboard-semantics.test.tsx`, 8 tests, next to the 10 existing dashboard tests (`page.test.tsx`, unchanged and passing):

| # | Required case | Covered by |
|---|---|---|
| 1, 3 | valid `dl`/`dt`/`dd` structure; no disallowed element in a wrong place | a content-model validator is itself tested against the former markup (it reports problems) and against valid markup (none); then every one of the six `dl` on the page is checked in English and Arabic (groups contain only `dt`+`dd`, no `dl > div > div`, `dl > div > span`, `dd` without `dt`, `dt` without `dd`; no `dt`/`dd` outside a `dl`) |
| 2, 4 | each name tied to its value; same indicators, order and values | for every list, the rendered `[term, description(s)]` pairs are compared with the expected ones from the real message files and the fixture: scope (3 terms with description and status), accounts (Active 9 / Inactive 3; users 120 / 20), trials 4, renewals 7/30/60 days = 1/3/5, value at risk = `formatRiyal('12345.00')` |
| 5 | number, currency and date formatting unchanged | the at-risk value is the unchanged `formatRiyal` output; the existing `page.test.tsx` assertions on every formatted figure still pass |
| 6 | AR/EN and RTL unchanged | the same structure and the same pairs from the Arabic message file; no `dir` attribute is set on or inside a list |
| 7 | accessibility not worse | see the axe table below |
| — | look preserved | the status `dd` keeps the pill classes (filled/outlined, `w-fit`, `px-2`, `rounded`), the group keeps the one-column/two-column grid classes and `self-start` |
| — | requests | the page still makes exactly the one `GET /platform/overview` |

Mutation checks (each reverted change fails tests): the former markup (5 fail), the status turned back into a loose `span` (3), two renewal terms swapped (1), the `self-start` removed (1). One mistake of mine along the way: my first router mock returned a new object each render and made the page reload endlessly in the test; it now uses a stable router like `page.test.tsx`.

| Check | Result |
|---|---|
| `dashboard-semantics` (8 new) + `page.test.tsx` (10 existing) | 18 passed |
| Full web suite (`npm test`) | 531 files, 5693 tests passed |
| `tsc --noEmit` | 48 errors, equal to the baseline; none outside test/spec files, none in the changed files |
| `next build` | exit 0 |
| GitHub CI | recorded on the PR for the final head (this file is part of that head) |

**Real backend, real browser (Chromium; Laravel on SQLite with isolated data; Next dev server; no route interception):**

| Check | Before | After |
|---|---|---|
| axe 4.10.2 (wcag2a/aa, 2.1 a/aa, 2.2 aa, best-practice), `/platform`, en/ar × light/dark × 1280/390 | `definition-list` ×1 and `dlitem` ×6 in 8/8 | **no violation at all in 8/8** |
| Appearance of the revenue-scope block | — | **byte-identical screenshots** of the block before and after, in 8 combinations (en/ar × light/dark × 1280/390); the "before" run was confirmed to serve the old markup (nested `div`/`span` present) and the "after" run the new (absent) |
| Geometry | dl heights 207 / 283 (en) and 149 / 225 (ar) | identical; the page's horizontal extent is unchanged (1280 and 390) |
| Counts | the scope list had 3 `dt` and 3 `dd` | 3 `dt` and **6 `dd`** (description + status per term), by design |

**NOT VERIFIED:** a real screen reader (none available here), so how a particular reader announces a term with two descriptions is not confirmed; browsers other than Chromium; the browser's own zoom UI. Automated tools are not a substitute for a screen-reader pass.

## Reviews

**Implementer.** Reproduced and located the one invalid list before editing, kept the change to that block, reused the existing grid utilities instead of adding markup, and proved the appearance unchanged by comparing screenshots and geometry rather than assuming it.

**Reviewer.** Checked that no other `dl` on the page or in the shared components used on it is invalid (the other five are `dl > div > dt + dd`), that the status as a second `dd` keeps one term per group, that the narrow-screen order (term, description, status) matches the former reading order, and that no `dd` margin or indentation appears (the base styles reset it, confirmed by the identical screenshots).

**AWJ Guardian.** No change to metrics, calculations, labels, formats, permissions, Tenant Isolation, requests or data; all test data is isolated (fake tenants, fake token). No merge, deploy or production action taken.

## Remaining accessibility risks

- Real screen-reader announcement of `dt` + two `dd` is unverified; the content model is valid and axe is clean, which is not the same as a tested reading experience.
- Other components outside the dashboard also use `dl` (for example the commercial card's inspector and card view); they were not flagged by axe on the pages tested and were not changed.
- The status as a second description is a modelling choice: if the owner prefers the status to be a visually separate element for assistive technology, a different structure (for example a text-only suffix in the term) would be needed.
- The other open H1-5 P2/P3 items are unchanged (H15-11 heading order, H15-09 text scaling, and so on).

## Backward compatibility

No API, schema, permission, text or request change; no translation key added. The DOM of one list changes shape (as described); its look is byte-identical in the tested combinations.

## Git state

- Branch: `claude/awj-h15-07-dashboard-semantics` (new, from `origin/main`).
- Base SHA: `b13f0f0c55de380b79ef4ddd937018de3c0b6b7f` (the H15-08 merge, PR #1391; equal to `origin/main` at the time).
- Code Head SHA / PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. Not started (each needs direction): the Backend `Accept` 401 behaviour, the Backend 422/409 for concurrent duplicate prices, a stable sort tie-break for the tenants API, H15-11 heading order, and the remaining H1-5 P2/P3 items. No merge, no deploy, Horizon not closed.
