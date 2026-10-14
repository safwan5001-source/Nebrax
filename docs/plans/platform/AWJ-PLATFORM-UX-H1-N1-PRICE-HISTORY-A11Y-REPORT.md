# AWJ-PLATFORM-UX-H1-N1 — Price History Keyboard Accessibility

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY · H1 NOT CLOSED
Scope: **frontend only, N1 only** (`web/`). No Backend, API, database, permission, tenant-isolation or accounting change. N2 and the P3 items are not touched.
Source: `AWJ-PLATFORM-UX-H1-FINAL-ACCEPTANCE.md` §5 N1 (owner approval: "Implement N1 only").

Base SHA: `7d9ddb1f944b5abcac329a1b6ab1e4e25cc4a1dd` (`origin/main` when this slice started; it is later than the merge `3871c85…` named in the brief, which is an ancestor).
Branch: `claude/awj-h1-n1-price-history-a11y` · Head SHA / PR: recorded on the PR.

## 1. Root cause

At 150–200% text (and at narrow desktop widths) the price-history table is wider than its card and scrolls horizontally. The page renders the shared `Table` primitive, and `Table` itself creates the scroller (`div[data-awj-grid-scroll].overflow-x-auto`). That scroller contains no focusable element, so a keyboard-only user cannot reach it and the cut-off columns (effective date, added on) are unreachable: axe `scrollable-region-focusable` (serious, WCAG 2.1.1). The finding was data-dependent (it needs price rows) and was missed by earlier runs that had none.

A second constraint found while fixing it: the history `<section>` is already a named landmark ("Price version history"). Naming the scroll region with the same heading made axe report `landmark-unique` (moderate, duplicate region names). So the region carries its own, distinct name.

## 2. Fix (page-local; `Table` unchanged)

`web/src/app/platform/(console)/prices/page.tsx`
- The existing outer `div` of the desktop table (`hidden … md:block`) is now the single scroller and uses the H15-08 pattern: `useHorizontalOverflow` measures it, and **only while it truly scrolls** it gets `role="region"`, `tabIndex={0}` and `aria-label`. When it fits there is no role, no tab stop and no label.
- The `Table` wrapper is told not to scroll on its own (`wrapperProps={{ className: 'overflow-x-visible' }}`, merged by `cn`), otherwise the inner wrapper would remain the real scroller and hide the overflow from the measured element.
- Focus indicator: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary` (solid primary, not the translucent `/40` used elsewhere, to meet the 3:1 non-text contrast in both themes) with `rounded-md`.

`web/src/messages/{en,ar}.json`: one new key in the existing `platformPrices` namespace, `historyScrollRegion` — EN "Price version history, scrollable table", AR «سجل نسخ الأسعار، جدول قابل للتمرير» (the section heading's own text plus "scrollable table", so it is tied to the section title but not a duplicate landmark name).

`web/src/components/ui/table.tsx`: **not changed.** Its existing optional `wrapperProps` was enough, so the 26 other consumers are untouched by construction; a test pins that.

## 3. Files changed

| File | Change |
|---|---|
| `web/src/app/platform/(console)/prices/page.tsx` | page-local scroll region (+10/−2 lines) |
| `web/src/messages/en.json`, `ar.json` | 1 key each |
| `web/src/app/platform/(console)/prices/price-history-scroll.test.tsx` | new, 14 tests |
| `docs/plans/platform/h1-n1-evidence/*.png` | 2 focus screenshots |

## 4. Verification

Real: local Laravel + Next dev server, isolated test data (1 test platform administrator, 8 test tenants, 3 test price versions), Chromium via Playwright with the browser's real default-font-size preference for 100/150/200% text, axe-core 4.10.2. No production system touched.

### 4.1 Real browser, price history (24 combinations: EN/AR × 100/150/200% × 1280/1024/768/390 px)

| Check | Before (main) | After |
|---|---|---|
| axe (wcag2a/aa, 2.1, 2.2 aa, best-practice) | `scrollable-region-focusable` serious ×1 in **9 of 24** (EN 150/1024, 150/768, 200/1280, 200/1024, 200/768; AR 150/1024, 200/1280, 200/1024, 200/768) | **0 of 24** (also no `landmark-unique`) |
| Table overflows → Tab stop | none (unreachable) | in every overflowing combination exactly one stop, reached by Tab; region named "Price version history, scrollable table" / «سجل نسخ الأسعار، جدول قابل للتمرير» |
| Table fits → extra Tab stop | n/a | **none** (100% at all widths, 150% at 1280, AR 150/768): no `tabindex`, no `role` |
| Below `md` (390 px) | cards list | unchanged; the table block is hidden, no stop |
| Keyboard scrolling | impossible | LTR: arrow keys move `scrollLeft` 0 → 240 and back to 0; RTL: 0 → −188 and back to 0 (`ArrowLeft` forward, `ArrowRight` back) |
| Focus indicator (200%, 1280 px) | none | 2 px solid primary: light `rgb(30,64,175)` on `rgb(255,255,255)` **8.72:1**; dark `rgb(79,140,255)` on `rgb(24,27,32)` **5.37:1** (both ≥ 3:1) |

Evidence: `h1-n1-evidence/focus-en-light-200pct-1280.png`, `focus-ar-dark-200pct-1280.png` (region focused and scrolled by keyboard).

### 4.2 No change elsewhere

| Check | Result |
|---|---|
| axe on all 6 console routes × AR/EN × 1280/390 × 100/200% (48 loads), final code | **no violations at all** (the page now has 3 price rows, i.e. the data condition that exposed N1) |
| Geometry of every visible element, 6 routes × AR/EN × light/dark × 1280/390 at 100% text, before vs after (33 312 elements) | **0 moved, resized, added or removed** |
| Price data, currency, dates, column order | covered by unit tests (headers in order, row values, mobile cards) and by the geometry result |

### 4.3 Automated tests

`price-history-scroll.test.tsx` (jsdom; scroll size and `ResizeObserver` are driven because jsdom has no layout; real layout is covered in 4.1):
1. overflow → named, focusable region (EN and AR);
2. fits → no `tabindex`, `role` or `aria-label` (EN and AR);
3. name differs from the section landmark but extends the same title (no duplicate landmark name);
4. Tab reaches the region only while it overflows;
5. visible focus-ring classes present and not translucent;
6. the `Table` wrapper does not scroll on its own (single scroller);
7. resize flips the stop on and off;
8. headers, order, values, currency, dates and the mobile card list are unchanged with and without the region;
9. `Table` without `wrapperProps` keeps its default wrapper classes and gains no role/tabindex/label; `wrapperProps` stays additive;
10. source guard: `components/ui/table.tsx` was not given any keyboard behaviour.

**Mutation checks (6, all caught):** drop `tabIndex`; always apply the region; replace the name with `aria-labelledby`; remove the inner wrapper override; remove the focus-ring classes; add `tabIndex` to the shared `Table`.

### 4.4 Suites, build, CI

| Check | Result |
|---|---|
| `src/app/platform/(console)/prices` (existing 51 + 14 new) | pass |
| Full web suite | 570 files / 6102 tests passed |
| `tsc --noEmit` | 48 errors = recorded baseline on `main` |
| `next build` | exit 0 |
| GitHub CI on the final head | see the PR |

## 5. Residual risks / not verified

- **Not verified:** real screen readers (NVDA/JAWS/VoiceOver/TalkBack), Firefox, WebKit, the browser's native zoom (text size was set through Chromium's real font-size preference).
- **Other pages are not covered:** the same "scrollable region without focusable content" condition can arise on any table that overflows and has no focusable cell. axe found none on the other five console routes with the test data, but only the prices table was fixed; none of the other 26 `Table` consumers was changed or measured here.
- The hook measures at mount and on size changes of the scroller and its first child. A change in content width without a size change of those elements is not observed; the prices history remounts after a save (a skeleton replaces it while reloading), which re-measures.
- The focus ring here is solid primary; elsewhere in the console it is the translucent `ring-primary/40` (H15-08). That difference is deliberate (3:1 non-text contrast) and not propagated to other components in this slice.
- N2 (tenant card truncation at 200% on phones), the deferred Backend items, and the P3 list are unchanged and still need the owner's decisions recorded in the H1 final acceptance report.

## 6. Git

Base SHA `7d9ddb1f944b5abcac329a1b6ab1e4e25cc4a1dd` · Branch `claude/awj-h1-n1-price-history-a11y` · PR and Head SHA on the PR. No merge, deploy, production release or closing of the H1 Horizon without Safwan's explicit approval.

## 7. Next step

Safwan's review of this PR. After it, H1 still needs his decisions on N2, the deferred Backend items, the P3 bundle and the unverified environments (see the final acceptance report §7).
