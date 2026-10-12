# H1-2 — Unified Platform Administration Shell — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-2 · Date: 2026-10-12
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §3–§5, §10, §12.9

## Outcome

Every authenticated platform page now renders inside one platform-only shell: a fixed sidebar from 1024px, a drawer below it, a shared top bar, and the five real destinations. Login stays outside the shell on `AuthShell`. Page bodies, API calls, permissions and business logic are unchanged.

## What was done

- **Route group.** `web/src/app/platform/(console)/` holds every authenticated page. Pages were moved with `git mv` and are byte-identical (100% renames). `login/` stays outside the group. URLs are unchanged (`/platform`, `/platform/tenants`, `/platform/tenants/[id]`, `/platform/prices`, `/platform/integrations`, `/platform/document-operations`, `/platform/login`).
- **`(console)/layout.tsx`** wraps children in `PlatformShell`.
- **`web/src/components/platform/platform-shell.tsx`** (new):
  - Skip link first, targeting `#platform-content`.
  - Sidebar `nav` (`aria-label`), 15rem (`lg:w-60`), `border-e`, sticky full height, no icon rail. Wordmark text, five links with a visible label and a 16px icon, `aria-current="page"` on exactly one link; tenant detail marks Tenants.
  - Top bar: menu button (below `lg`), static breadcrumb (from `sm`), `LangToggle`, `ThemeToggle`, truncated name with `title` (from `sm`), logout with a visible label.
  - Drawer below `lg`: `aria-expanded` and `aria-controls="platform-nav"` on the menu button, focus moves to the close button on open, Tab and Shift+Tab are contained in the drawer while it is open (review fix, see below), Escape / scrim / close button / choosing a link all close it, focus returns to the menu button (including after a link choice), `inert` while closed, `overflow-hidden` scroll lock removed on close and unmount, drawer closes if the viewport grows to `lg`.
  - Sign-out calls the existing `platformLogout()` then `router.replace('/platform/login')`.
  - Unauthenticated: renders only an empty busy placeholder and redirects to `/platform/login` (no console navigation is ever shown).
- **Messages.** New `platformShell` namespace in `ar.json` and `en.json`; no hard-coded sentences. `common.languageToggle` / `common.themeToggle` are reused.
- **Test config.** `vitest.config.ts` jsdom glob and one source path in `ai-provider-actions.test.ts` follow the moved folder (the glob is `src/app/platform/**/tenants/**` because micromatch does not match literal parentheses, the same issue the config already documents).
- **Docs.** H1-CONTRAST report closed as merged; horizon status and queue updated; this report.

## Not done, deliberately

- Page headers, the overview's private navigation and its logout are untouched (spec §3, §12.2). The overview therefore shows two logout buttons and duplicated navigation until H1-3.
- No new page, metric, endpoint, schema or accounting change. No `per_tenant`, no system-updates nav.
- No tenant `Sidebar`/`Topbar`/`BranchScope`, no `data-awj-ui`, no `applyAwjUiGate()`.
- Detail breadcrumb has no tenant name (spec allows static crumbs in H1-2).
- `Dialog` focus trap, `window.confirm` replacement, mobile cards, per-page patterns: later slices.
- H1-3 not started.

## Decisions that differ from the spec text

| Spec | Done | Reason |
|---|---|---|
| `main#platform-content` | `div#platform-content` with `tabIndex={-1}` | Every existing page already renders its own `<main>`. Two nested `main` landmarks are invalid HTML. The page's `<main>` stays the single landmark (verified: exactly 1 `main` on all 192 matrix pages). When H1-4 removes the page-level `main`/headers the shell element can become `main`. |
| Scrim `bg-black/40` | `bg-[color:var(--awj-elevation-scrim,rgb(0_0_0/0.4))]` | The repo's drift ratchet (`src/design/__tests__/drift-ratchet.test.ts`) fails any new fixed-palette class. Gate-off it computes to `rgba(0, 0, 0, 0.4)` (measured). |
| `inert={...}` prop | `setAttribute('inert', '')` in an effect | React 18 does not forward a boolean `inert` to the DOM (found by a failing unit test). The effect runs before the focus effect because an inert element rejects `focus()` (found in the browser, see below). Desktop is never inert. |
| Page `min-h-screen` | neutralised only inside the shell with `[&>main]:min-h-0 [&>div]:min-h-0` | Pages' own `min-h-screen` plus the top bar would force a permanent vertical scrollbar. No page edit. |

## Files changed

Renamed unchanged (`git mv`): the 17 files under `web/src/app/platform/` (page, prices, tenants + `[id]`, integrations + helpers/tests, document-operations) → `web/src/app/platform/(console)/…`.

New:
- `web/src/app/platform/(console)/layout.tsx`
- `web/src/components/platform/platform-shell.tsx`
- `web/src/components/platform/platform-shell.test.tsx`
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-2-SHELL-REPORT.md`

Modified:
- `web/src/messages/ar.json`, `web/src/messages/en.json` (+16 lines each)
- `web/vitest.config.ts` (1 line), `web/src/app/platform/(console)/integrations/ai-provider-actions.test.ts` (1 path)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1.md`, `docs/plans/platform/AWJ-PLATFORM-UX-H1-CONTRAST-REPORT.md` (status/closure only)

Not touched: `globals.css`, `button.tsx`, `LangToggle`, `ThemeToggle`, `login/page.tsx`, any `app/` PHP, routes, migrations.

## Tests actually run

Unit/component (vitest, jsdom, real components, mocked router/auth):

| Command | Result |
|---|---|
| `npx vitest run src/components/platform src/app/platform src/design` | 15 files, 159 tests passed after the review fix (19 shell tests plus the untouched pagination, reference-number, integrations, commercial, drift-ratchet and contrast tests) |
| `npm test` (full web suite, after the review fix) | 490 files, 5178 tests passed. An earlier run had one failure, the drift ratchet on the first scrim class, fixed (see decisions) |
| `npm run build` | passed; all seven `/platform*` routes build with unchanged URLs |
| `npx tsc --noEmit` | 48 errors, identical count to `main`; none in files touched here (they are existing test-file type errors) |
| ESLint | not run: the repo has no ESLint config (`next lint` prompts interactively) |

New shell tests (19 after the review fix; the focus ones are described in the review-fix section): active-destination matching (exact overview, segment-boundary prefix, trailing slash, `/platform/tenantsx` and login not matched); exactly five declared hrefs; five links with one `aria-current`, tenant detail marks Tenants; skip target is a focusable `div` with a single `main` on the page; unauthenticated redirect renders no console; `aria-expanded`/`aria-controls`/closed `inert`; not inert at the desktop breakpoint; Escape closes, restores focus and unlocks scroll; scrim and close button close; link click closes; logout calls `platformLogout` then redirects; breadcrumbs; 44px classes on the new controls.

Real browser (Playwright-core + Chromium 1194, Next dev server, demo mode, no backend API): these were run against the real app, not mocked. They are an ad-hoc probe run during this slice; the scripts are not committed and CI does not repeat them.

| Probe | Matrix | Result |
|---|---|---|
| Page-level horizontal overflow, direction, theme, shell presence, `aria-current`, one `main` | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × 6 routes (including tenant detail) × `ar`/RTL and `en`/LTR × light/dark = 192 pages | 0 overflow, direction matched locale and theme matched in all 192; menu visible and nav inert below 1024, menu hidden and nav not inert from 1024; exactly one current link on every page |
| Drawer, keyboard, targets | same 8 widths × 2 locales × 2 themes = 32 on `/platform/tenants` | keyboard open via Enter, focus lands on the close button, drawer opens on the inline-start side (right in RTL, left in LTR), scroll locked, no overflow while open, Escape closes and returns focus to the menu button, drawer inert again, Tab never enters the closed drawer, skip link is the first Tab stop and moves focus to `#platform-content`; all shell controls (menu, close, toggles, logout, nav links) at least 44×44 |
| Scrim | 390px | computed `rgba(0, 0, 0, 0.4)`; a click on the scrim closed the drawer |
| Login and guard | login with no demo flag; `/platform/prices` with no session | login renders no shell and no console nav; the unauthenticated console route redirected to `/platform/login` with no shell |
| Screenshots | 320/390/768/1024/1440, both locales and themes, open and closed | reviewed visually (RTL sidebar on the right, LTR on the left, dark tokens, focus ring on the close button) |

Defects the real browser caught and that were fixed before this report:

1. Drawer focus stayed on the menu button because the nav was still `inert` when focus ran (the unit test could not see it because jsdom does not enforce inert). Fixed by ordering the effects.
2. At 320 and 375px in English the language and theme toggles were squeezed to 31 and 43px wide next to the longer "Sign out" label. Fixed with a `shrink-0` wrapper; re-run showed 0 sub-44px shell controls.

## Review fix — drawer focus management (PR review finding)

Finding: choosing a link in the drawer called `setOpen(false)` without moving focus out first, so the focused link became `inert`, and Tab / Shift+Tab were not contained, so focus could reach the page behind the open drawer.

Change, in `platform-shell.tsx` only:

1. Link `onClick` is now `open && dismiss()`. `dismiss` already focuses the menu button before closing. The `open` guard keeps desktop sidebar clicks (drawer never open) from touching focus.
2. The existing document `keydown` handler (active only while open) now also handles Tab: if focus is outside the drawer it is pulled to the first control (last on Shift+Tab); Tab on the last control wraps to the first and Shift+Tab on the first wraps to the last; everything else is left to the browser. Ctrl/Alt/Meta+Tab is ignored. First control is the close button, last is the Document operations link.

Why a Tab wrap and not `inert` on the page behind: marking the header inert would also make the menu button unfocusable at the moment `dismiss` returns focus to it, and would need another effect-ordering rule. The wrap is 15 lines, local to the already-existing open-state effect, and behaves the same in RTL and LTR (it uses DOM order, not direction). Trade-off: a screen reader virtual cursor can still read the page behind; that is the same limit the spec records for `Dialog` and remains an H1-5 item.

New regression tests (6, in `platform-shell.test.tsx`, 19 in the file): link choice moves focus to the menu button (verified to fail without the change); desktop link click does not steal focus; Tab from the last link wraps; Shift+Tab from the first control wraps; Tab inside the drawer is left to the browser and escaped focus is pulled back; Tab is not intercepted when closed or with Ctrl/Alt/Meta. Escape, scrim, close-button, aria and `inert` tests are unchanged and still pass.

Real browser (Chromium, demo mode, RTL and LTR at 320, 390 and 768): 14 Tab presses and 14 Shift+Tab presses from the open drawer never left `#platform-nav` in any of the six runs; selecting a link navigated (at 320/RTL the first dev-server compile of the next route was slower than the 1.2 s wait, but focus and closing were already correct); focus ended on the menu button with `aria-expanded="false"`; Escape still returned focus to the menu button. At 1440 Tab still reaches page controls (the sidebar does not trap).

## Responsive and accessibility results

- **Viewports (320, 375, 390, 430, 768, 1024, 1440, 1920):** verified in a real browser for page-level overflow and shell behaviour, both directions, both themes (table above).
- **Touch targets:** 44px on every new shell control, measured, not only classed. Existing page controls (`size="sm"`, 32px) are intentionally unchanged (spec §12).
- **Keyboard/focus:** skip link, drawer open, Escape, focus return (also after a link choice), inert, Tab/Shift+Tab containment while open: verified in the browser.
- **Landmarks:** one `nav` for site navigation (`aria-label`), one for the breadcrumb (`aria-label`), one `main` (the page's own), `h1` untouched.
- **Light/dark:** the shell uses only existing tokens; the only non-token value is the scrim fallback inside `var(--awj-elevation-scrim, …)`.
- **Not verified:** landscape orientation, browser zoom and text scaling, real iOS safe-area insets (the `env()` paddings are present but the headless browser has none), screen-reader announcements, a real authenticated platform session against the Laravel API (the probe used the repository's demo mode; list pages showed their normal load-error state because no API ran). H1-5 owns the full closure pass.

## Pre-merge reviews

### Implementer

Scope is the shell, the route group and its messages. Page files are pure renames, so blame and history follow. All imports inside the moved pages are relative to their own folder or `@/`, so nothing needed rewriting; the four stale source paths (vitest glob, one `readFileSync` path) were found by a repository-wide search and fixed. The two real-browser defects above were reproduced, fixed and re-measured.

### Reviewer

- Specificity/regression: no CSS added; the shell uses utilities only. `[&>main]:min-h-0` has higher specificity than the page's `.min-h-screen`, confirmed by the absence of a permanent vertical scrollbar in screenshots.
- `inert`: `setAttribute` in an effect keyed on `open`, `desktop`, `ready`. It also reruns when `ready` flips so the first mount is covered. A race where the nav is inert at the instant the matchMedia query flips is closed by the same dependency list.
- Focus: `dismiss` focuses the menu button before the drawer closes. The first version used it for Escape, scrim and the close button but not for link choice, so a focused link could become inert; PR review caught this and it is fixed (see the review-fix section). Tab was not contained while open; also fixed there.
- Pages still own their auth redirect, so removing the shell would not weaken any guard; the shell's own guard is an addition for navigation chrome, not the security boundary.
- Existing overview private nav and double logout are accepted per spec until H1-3.

### AWJ Guardian

- **Platform vs tenant:** the shell imports no tenant `Sidebar`, `Topbar`, `BranchScope` or `AuthenticatedCompanyBrowserIdentity`, and does not call `applyAwjUiGate()` or set `data-awj-ui`. It reads only `platform-auth`/`platform-api` session helpers. A tenant session has no platform token, so the shell redirects to `/platform/login`; server-side platform authorization is unchanged.
- **Data/API:** the shell makes no request. No endpoint, schema, migration or money formatter changed. No `float`/money arithmetic introduced.
- **Isolation/PII:** the signed-in administrator name from the existing local session is displayed, as the overview already did. No tenant data enters the shell.
- **Backward compatibility:** URLs, query strings, API calls and page bodies are identical; only chrome is added around them.
- **Accounting impact:** none.

## CI

Recorded on the pull request for the exact head SHA (the checks, their results and the final head are listed in the PR and in the hand-off summary). This file is part of that head, so it does not restate results that did not exist when it was committed.

## Merge / post-merge

- Merge status: not merged. Merge SHA: none.
- Post-merge review: not done.
- Deploy / production release: not requested, not done.

## Risks and remaining work

- Two logout buttons and duplicated destination links on the overview until H1-3 (accepted by spec).
- Page-level `<main>` elements and `min-h-screen` are neutralised from the shell, not removed; H1-4 should delete them with each page's header so the shell can become `main`.
- The real-browser checks are manual and uncommitted; CI covers only the unit tests and the build.
- Pre-existing and unrelated: 48 `tsc` errors in test files, `IntlError` for a `cart.itemCount` key printed during some existing tests, and an outdated "IN REVIEW" status line in `AWJ-PLATFORM-UX-H1-PAGINATION-REPORT.md` (PR #1318 is merged). None were changed here.
- Dev-mode only: Next.js dev overlay badge appears in screenshots; it is not part of the product.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after PR #1328 merged, per the session's branch rule).
- Base SHA: `11abda97dd1d25782d27f06f0312a3d5abec57a2` (`origin/main` when work started; PR #1328 merge `bda44687…` is its ancestor).
- Head SHA and PR: see the pull request.

## Next dependency-ready task

**H1-3 — Platform overview.** From latest `main` after this PR is merged and verified: remove the overview's private navigation and logout (the shell has both), keep the same API fields and the contracted-revenue notice, no new charts; acceptance in spec §12.2. Stop before merge.
