# H15-09 — Platform 200% text scaling and overflow — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Follow-up to the H1-5 report ([AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md)) · Date: 2026-10-13
Scope: **Frontend only.** No Backend, API, database, calculation, permission, authentication or Tenant Isolation change. Navigation order and visibility are unchanged. No new dependency. No page redesign, no change to design tokens.

## Defect (H15-09)

With the browser text size at 200%, the platform console scrolled horizontally at page level: the shell's **Sign out** button was pushed off the right edge at 390 px, and `whitespace-nowrap` badges and other controls overflowed their containers elsewhere (H1-5: 18 of 28 combinations at 200%).

## How it was measured (and what that does and does not prove)

H1-5 emulated text scaling by overriding the root font size with CSS. This slice uses the **browser's own default-font-size preference** instead: Chromium's `webkit.webprefs.default_font_size` set to 32 px (200%) or 16 px (100%) in the browser profile. The root and every `rem` then scale exactly as they do when a user raises the browser's text size (verified: root font size 32 px, `1rem` = 32 px). Fixed-pixel breakpoints (such as `lg`/`xl`) do **not** scale, which is also what happens for real users.

- It is **not** a CSS zoom or a viewport trick, and it is **not** the browser's settings screen or its zoom control; those were **not** exercised.
- Matrix: 6 console routes (overview, tenants, tenant detail, prices, integrations, document operations) × English/Arabic × light/dark × 1280 px/390 px × 100%/200% = **96 real page loads** on a real Laravel backend (SQLite, isolated data, 45 fake tenants), no route interception.
- Per load it records: page-level horizontal scroll (`scrollWidth − clientWidth`), elements outside the viewport (excluding intentional scroll containers and the closed drawer), elements wider than their own container, clipped text, truncated text and overlapping interactive controls. Raw measurements were filtered only for things that are by design (`sr-only` text, the focus-only skip link, the date-picker button inside its input).

## Root cause (measured before changing code)

At 100% the console is clean: **0 of 48** loads with page-level horizontal scroll, nothing outside the viewport, no overlaps. At 200%: **32 of 48** loads scrolled horizontally (up to 309 px), 32 had elements outside the viewport, 4 had overlapping controls. The causes, from the measurements:

| Cause | Where | Mechanism |
|---|---|---|
| Header controls cannot fit one row | shell, every route at 390 px | menu button + language + theme + **Sign out** need about 480 px at 200% (all `rem`-sized, `shrink-0`), a 390 px row has about 374 px, and the row did not wrap, so Sign out was cut off |
| `Badge` is `whitespace-nowrap` | "Coming soon", "Mandatory", "Not assigned", "No API key stored", "Provider network…" | the badge cannot shrink below its text, so in a narrow card it overflows |
| Long action labels on `whitespace-nowrap` buttons with fixed height | "Grant all apps to all tenants" ×4, "Test connection", "Save settings", "Save plan", export, retry/assign | label wider than the container |
| Unbreakable text | application names and keys (`fuel_stations.core`, and two names that are currently untranslated raw keys, H15-06) | a long single token pushes the page 309 px wide at 390 px |
| A flex-wrap container with a `min-width` in `rem` | capability select (`min-w-52`) on tenant detail | 13 rem = 416 px at 200%, wider than the screen |
| Pixel breakpoint, rem content | the three AI-provider cards (`xl:grid-cols-3`) on integrations | at 1280 px / 200% each card is ~131 px inside, narrower than its own button: buttons overlapped |
| A header row that cannot shrink | the commercial product card header | name/code plus badge did not fit |

## What changed

**Opt-in, default unchanged.** `Badge` and `Button` get an optional `wrap` prop (default `false`, so the ERP is unaffected). With `wrap`: `max-w-full shrink-0 whitespace-normal …`. `shrink-0` + `max-w-full` is deliberate: the control keeps its natural one-line width and wraps its text **only when its container is genuinely narrower**. A first version without `shrink-0` wrapped badges early inside flex rows and changed the 100% layout; the geometry check below caught it. For buttons the fixed height becomes the same *minimum* height (`min-h-8`/`min-h-9`, or the caller's `min-h-11`), with small vertical padding so a single line has exactly the old height.

1. **`platform-shell.tsx`** — the right-hand header controls (language, theme, name, **Sign out**) now sit in one wrapper that may wrap onto a second row (`flex flex-wrap justify-end`). It deliberately has **no** `min-w-0` (so it can never become narrower than its widest control). Order, the 44 px targets, `shrink-0`, labels and the focus ring are unchanged; at 100% the row fits, nothing wraps.
2. **Platform badges** (every `<Badge` in `components/platform` and `app/platform`) pass `wrap`. In the commercial products table, which already scrolls inside its own wrapper, the badges keep their original look (a `wrap` flag on the three helpers) to avoid a 1 px column drift.
3. **Platform buttons that overflowed** pass `wrap` (bulk "all apps" actions, retry/assign, Test/Save in the integration and AI cards, Save plan, export audit); callers' `h-11` became `min-h-11`.
4. **Long names and keys** break instead of widening the page: `break-words` on application names and keys in the global and override cards, `min-w-0` where they sit in a flex row, `[overflow-wrap:anywhere]` on the AI-provider card title block.
5. **rem-based minimums**: the capability field uses `min-w-[min(13rem,100%)]`; the three AI-provider cards use `xl:grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))]`, which is the same three columns at 100% (verified) and fewer columns when the text is larger.
6. The global-controls filter row and the commercial product header got `min-w-0`/`break-words`-style fixes only; **no** `flex-wrap` was added where it would reflow at 100%.

Not changed: tokens, navigation order and visibility, labels and translations, requests, calculations, the other shared components.

## Files

| File | Change |
|---|---|
| `web/src/components/ui/badge.tsx`, `button.tsx` | optional `wrap` prop (default unchanged) |
| `web/src/components/platform/platform-shell.tsx` | wrapping header control group |
| `web/src/components/platform/{commercial-operations-card,global-application-controls-card,application-override-card,contract-management-card}.tsx` | badges/buttons `wrap`, break/min-w fixes |
| `web/src/app/platform/(console)/{integrations/page,integrations/file-scan-exceptions,tenants/page,tenants/[id]/page,prices/page,document-operations/page}.tsx` | badges/buttons `wrap`, rem-based grid and minimums |
| `web/src/components/ui/wrap-contract.test.tsx` | new, 7 tests |
| `web/src/components/platform/text-scaling.test.tsx` | new, 10 tests |
| `docs/plans/platform/h15-09-evidence/*.png` | 6 before/after screenshots (about 144 KB) |
| this report | |

## Results

### Real browser, 96 page loads (before → after)

| Signal | 100% before | 100% after | 200% before | 200% after |
|---|---|---|---|---|
| Page-level horizontal scroll | 0 / 48 | **0 / 48** | **32 / 48** (up to 309 px) | **0 / 48** |
| Elements outside the viewport | 0 | 0 | 32 loads | **0** |
| Overlapping interactive controls | 0 | 0 | 4 loads | **0** |
| Clipped text | 0 | 0 | 0 | 0 |

English and Arabic (RTL), light and dark, 1280 px and 390 px are all included; the figures are the totals over all of them.

### 100% layout unchanged

- Geometry of **every visible element** (35,428 compared) before vs after, header subtree excluded because its wrapper shifts path keys: **44 of 48 pages identical.** The 4 that differ are `/platform/tenants` at 390 px (English/Arabic × light/dark), where the two application cards whose names are untranslated raw keys (`applications.keys.document_center_core`, `…commerce_app_builder`, H15-06) used to spill past the card edge and now wrap onto a second line (+24 px each, +48 px page height). This is the overflow fix itself; it ends when H15-06 adds the translations.
- Header at 100%: **8 of 8 screenshots byte-identical** before and after (English/Arabic × light/dark × 1280/390).
- Evidence at 200% (`docs/plans/platform/h15-09-evidence/`): `before-header-200pct-{en,ar}-390.png` shows Sign out cut off at the edge; `after-header-200pct-{en,ar}-390.png` shows two rows with Sign out complete; `before/after-tenants-200pct-en-390.png` the same on the tenants page.

### Keyboard and focus (real)

At 200%, Tab order through the header is menu → language → theme → Sign out in English and Arabic at 390 px (and language → theme → Sign out at 1280 px). Every stop has a visible focus ring, lies fully inside the viewport and keeps its size (88 px at 200%, 44 px at 100%, so the targets scale with the text).

### Accessibility tooling

axe-core 4.10.2 (wcag2a/aa, 2.1 a/aa, 2.2 aa, best-practice) on 48 loads (6 routes × English/Arabic × 1280/390 × 100%/200%): results are **identical before and after in all 48 loads**; the only finding anywhere is `heading-order` (moderate, H15-11, out of scope).

### Automated tests

| Check | Result |
|---|---|
| `wrap-contract.test.tsx` (7) | the default `Badge`/`Button` are exactly as before; `wrap` classes; caller overrides still win; `asChild`; the prop does not reach the DOM |
| `text-scaling.test.tsx` (10) | header wrapper contract (wraps, no `min-w-0`, same order, sticky one-row look); Sign out keeps its label, 44 px target, focus ring, no truncation; the toggle group cannot be squeezed; keyboard order and the five unchanged destinations; table badges original vs card badges wrapping; product-card header; retry/assign buttons; source guards: every platform `Badge` has `wrap`, no platform screen hard-codes `whitespace-nowrap` except the price amount, the provider grid and name/key rules |
| Mutation checks | 6 reverted changes each fail tests: `min-w-0` back on the header wrapper (1), `shrink-0` off the badge (2), `max-w-full` off the button (2), table badges wrapping again (1), a platform badge without `wrap` (1), provider grid back to `xl:grid-cols-3` (1) |
| Full web suite (`npm test`) | 534 files, 5711 tests passed (no existing test changed) |
| `tsc --noEmit` | 48 errors, equal to the baseline; none outside test/spec files, none in the changed files |
| `next build` | exit 0 |
| GitHub CI | recorded on the PR for the final head (this file is part of that head) |

jsdom has no layout, so the unit tests pin the class contracts and behaviour; the layout results above come from the real browser runs and are not reproduced by Vitest.

## Residual risks and what is not verified

- **Not verified:** a real screen reader; the browser's own text-size **settings screen** and zoom control (only the underlying Chromium preference was used); Firefox and WebKit (not installed). Automated checks and Chromium are not a substitute.
- At 390 px and 200% the **brand text shows as "P…"** in the header: it was already `truncate` (and previously invisible because the row was clipped); the full name is in the drawer and the text node. Not changed here.
- At 390 px and 200% the sticky header is two rows tall (about 185 px of a 900 px viewport).
- At 200% some controls are still a little wider than their own container (never past the viewport, never overlapping): up to 65 px for the "Platform administrator password" label and 32–44 px for the "Save plan" and "Inspect access" buttons at specific widths, a few smaller for labels and a checkbox. They do not scroll the page; a further pass could tune them.
- The AI-provider cards show fewer columns when the text is larger (intended; unchanged at 100%).
- The raw `applications.keys.*` text for two applications is H15-06 (missing translations) and is not fixed here.
- Pixel breakpoints still do not follow text size; only the grids and minimums touched here use `rem`-based widths.

## Reviews

**Implementer.** Measured first with the browser's real text-size preference rather than a CSS override, fixed each proven cause at its source with the smallest local change, and then checked the 100% layout element by element. That check caught two of my own first attempts (early badge wrapping, a `flex-wrap` that moved a toggle) and a 1 px table drift, all corrected before this report.

**Reviewer.** Checked that the default `Badge`/`Button` are untouched (the ERP uses them in 177 files), that `wrap` cannot shrink a control before its container is genuinely narrower, that no text is hidden or ellipsised to solve an access problem (only the pre-existing brand truncation remains), that Sign out keeps its label and 44 px target, and that the header wrapper cannot become narrower than its widest control.

**AWJ Guardian.** No change to permissions, authentication, Tenant Isolation, requests, calculations, labels or stored data; test data is isolated (fake tenants, fake token). No merge, deploy or production action taken.

## Backward compatibility

No API, schema, permission or request change; no translation key added or changed; `Badge`/`Button` defaults are identical (pinned by tests). At 100% the layout is identical except the two raw-key cards on the tenants page at 390 px described above.

## Git state

- Branch: `claude/awj-h15-09-text-scaling` (new, from `origin/main`).
- Base SHA: `c146ecbd7a41352b8a10b569d99c5076ea03280d` (the H15-07 merge, PR #1395; equal to `origin/main` at the time).
- Code Head SHA / PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. Not started (each needs direction): the Backend `Accept` 401 behaviour, the Backend 422/409 for concurrent duplicate prices, a stable sort tie-break for the tenants API, H15-06 (two missing translations), H15-11 (`heading-order`), a native-browser text-size and screen-reader pass, and the remaining H1-5 P2/P3 items. No merge, no deploy, Horizon not closed.
