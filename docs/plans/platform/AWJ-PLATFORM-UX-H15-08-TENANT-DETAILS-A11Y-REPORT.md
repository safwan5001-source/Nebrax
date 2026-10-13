# H15-08 — Tenant details accessibility — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Follow-up to the H1-5 report ([AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md)) · Date: 2026-10-13
Scope: **Frontend only.** No Backend, API, database, migration, permission, Tenant Isolation or request-body change. No new dependency. The page layout and appearance are unchanged apart from a focus ring on one region.

## Defect (H15-08)

On `/platform/tenants/[id]`, axe reported two findings in every language, theme and viewport run of the H1-5 pass: `select-name` (critical) and `scrollable-region-focusable` (serious).

## Root cause (reproduced before changing code)

Re-run on a real Laravel backend (SQLite, isolated data) with axe-core 4.10.2, 8 combinations (en/ar × light/dark × 1280/390 px). Both findings reproduced, and the page was inspected to identify the exact elements:

| Finding | Element | Cause |
|---|---|---|
| `select-name` (critical), all 8 runs | the **filter select of the "Application overrides" card** (`application-override-card.tsx`) — "All applications / Commercially gated / Built non-mandatory" | rendered with no `<label>`, no `id`, no `aria-label` (`labels: 0`); the shared `Select` component adds none and a nearby search box does not name it |
| `scrollable-region-focusable` (serious), the 1280 px runs | the **application products table wrapper of the "Subscription & Applications" card** (`commercial-operations-card.tsx`) | the table has `min-w-[56rem]` (896 px) inside a 798 px wrapper with `overflow-x-auto`, so it scrolls horizontally, but the wrapper holds **no focusable element** (the cells are text and badges), so a keyboard user can neither reach nor scroll it |

At 390 px the wrapper is `hidden` (the card view replaces it), so only `select-name` applies there.

## What changed and why

1. **Select name.** A visually hidden label, `<Label htmlFor={id} className="sr-only">`, with a stable `useId()` id, linked to the select (`<Select id=…>`). The text is a new key `platform.applicationOverrides.filterLabel`: "Filter applications" / «تصفية التطبيقات». The label is for assistive technology; the sighted layout is identical. Values, options, `onChange` and the data fetched are untouched. The name does not depend on a placeholder.
2. **Scroll region.** The products wrapper becomes a **named, focusable region only while it actually overflows**: `role="region"`, `tabIndex={0}`, `aria-labelledby` pointing at the section's **existing visible heading** (`Products & applications` / «المنتجات والتطبيقات», so no duplicated text or new translation) and a visible focus ring (`focus-visible:ring-2 ring-primary/40`, the app's standard ring) with `rounded-md` so the ring follows the edge. When the table fits, no `tabindex` or `role` is added, so no unnecessary tab stop exists. A small hook, `use-horizontal-overflow.ts` (ResizeObserver, `resize` fallback), measures `scrollWidth > clientWidth`.

Not changed: widths, spacing, the table, mouse/touch scrolling, RTL behaviour, the mobile card view, the other tables (the contract table and the override table each contain focusable buttons, and axe did not flag them).

## Files

| File | Change |
|---|---|
| `web/src/components/platform/application-override-card.tsx` | labelled filter select (`useId`, `sr-only` label) |
| `web/src/components/platform/commercial-operations-card.tsx` | heading id, conditional focusable named region with focus ring |
| `web/src/components/platform/use-horizontal-overflow.ts` | new, tiny measuring hook |
| `web/src/messages/en.json`, `ar.json` | one key added: `platform.applicationOverrides.filterLabel` |
| `web/src/components/platform/tenant-details-a11y.test.tsx` | new, 12 regression tests |
| this report | |

## Tests actually run

**DOM tests (Testing Library, real translation files; the API client is mocked):** `tenant-details-a11y.test.tsx`, 12 tests:

| # | Required case | Covered by |
|---|---|---|
| 1, 2 | accessible name in Arabic and English | `getByLabelText` / `getByRole('combobox', {name})` return the select in both languages; the name comes from a `<label for>` (not the placeholder); the selected option is the "All applications" state |
| 3 | selection and `onChange` still work | the value changes to `commercial` and `built` and the table rows filter accordingly; options and values identical in Arabic |
| 4 | no request or body change | the only call is the unchanged `GET …/application-overrides/summary`; the commercial card makes exactly its three unchanged GETs; no write is sent |
| 5 | reachable by Tab | when the table overflows, Tab from the preceding control lands on the region, which has `tabindex=0` and exactly one tab stop was added |
| 6 | visible focus indicator | the region carries the focus ring classes (and the computed ring is verified in the real browser below) |
| 7 | RTL and scrolling intact | the `dir` is not touched, the wrapper keeps `overflow-x-auto`, `hidden lg:block` and the table keeps `min-w-[56rem]`; checked in Arabic |
| 8 | no extra tab stop | when the table fits there is no `tabindex`, `role` or `aria-labelledby`; the region gains and loses the stop as the measured width changes |
| — | name of the region | the region's accessible name equals the visible heading in both languages (`aria-labelledby` → the `h3`) |

Mutation checks (each reverted change fails tests): removing the label (4 fail), never making the region focusable (6), always making it focusable (2), removing the focus ring (2). One of my own mistakes along the way: the first version of the suite hung because the `useTranslations` mock returned a new function on every render and re-fired the cards' load effects; the mock now returns a stable function per locale and namespace, like next-intl.

| Check | Result |
|---|---|
| `tenant-details-a11y` (12 new) and the existing platform component/tenant tests | 12 new tests pass; the existing platform component and tenant page tests pass unchanged (run as part of the full suite) |
| Full web suite (`npm test`) | 530 files, 5684 tests passed |
| `tsc --noEmit` | 48 errors, equal to the baseline; none outside test/spec files, none in the changed files |
| `next build` | exit 0 |
| GitHub CI | recorded on the PR for the final head (this file is part of that head) |

**axe-core is not a dependency of `web/`** and was not added; automated axe was therefore run in the real browser (below), not in Vitest.

**Real backend, real browser (Chromium; Laravel on SQLite with isolated data; Next dev server; no route interception):**

| Check | Before | After |
|---|---|---|
| axe 4.10.2 (wcag2a/aa, 2.1 a/aa, 2.2 aa, best-practice), `/platform/tenants/[id]`, en/ar × light/dark × 1280/390 | `select-name` critical in 8/8; `scrollable-region-focusable` serious in 4/4 at 1280 | **both gone in 8/8**; the only remaining finding is `heading-order` (moderate), which is H15-11, not part of this task |
| Tab from the plan select | the products region was not reachable | reached in en and ar; computed focus indicator: a 2 px `rgba(59,130,246,.5)` ring (box-shadow) |
| Keyboard scroll (focused region, arrow key) | not possible | en (LTR): `scrollLeft` 0 → 40; ar (RTL): 0 → −40 (Chromium's negative-`scrollLeft` RTL model); the next Tab leaves the region |
| 390 px | wrapper hidden | unchanged: wrapper hidden, no role/tabindex, no page-level horizontal scroll |
| Width ≥ 1024 | — | the table overflows its wrapper at every width tested (798 px wrapper against an 896 px table, also at 1920 px), so in the current layout the region is a tab stop at all desktop widths; the "fits, no stop" branch is covered by the DOM tests, not by a real run |

**NOT VERIFIED:** a real screen reader (none available here); the announced name and role of the new `region` and the labelled select have been checked only through the accessibility tree rules (axe, Testing Library roles). Browsers other than Chromium; the browser's own zoom UI. Automated tools are not a substitute for a screen-reader pass.

## Reviews

**Implementer.** Reproduced and located both findings before editing. The select gets a real label (not a placeholder or a title). The scroll region reuses the section's own heading as its name and only becomes a tab stop while it truly scrolls, so there is no unneeded stop. No Backend, API, payload or layout change.

**Reviewer.** Checked that `useId` ids are stable across renders, that the hook only sets state when the measurement changes, that `role="region"` is never rendered without a name (`aria-labelledby` is added in the same branch), that the wrapper stays hidden below `lg` (no tab stop on mobile), and that the other two scroll regions are not flagged because they contain focusable controls.

**AWJ Guardian.** No change to permissions, Tenant Isolation, financial or commercial rules, requests or stored data; all test data is isolated (fake tenants, fake token). No merge, deploy or production action taken.

## Remaining accessibility risks

- The override search input is named only by its placeholder (axe does not flag it; a visible or hidden label would be more robust). Out of scope here, not changed.
- The override and contract tables rely on their action buttons for keyboard access to their scroll regions; if all of a row's buttons are disabled, a horizontally scrolling table without a focusable child would have the same problem. axe did not flag them in the tested data.
- `heading-order` on the same page (H15-11) and the other open H1-5 P2/P3 items are unchanged.
- No real screen-reader pass; native browser zoom and text-size checks are still open from H1-5.

## Backward compatibility

No API, schema, permission or request change; one translation key added, none changed; the DOM gains an `id`, a hidden `<label>` and (while overflowing) `role`/`tabindex`/`aria-labelledby` on one wrapper.

## Git state

- Branch: `claude/awj-h15-08-tenant-details-a11y` (new, from `origin/main`).
- Base SHA: `54151ac4d0135356b2a1e5bedad7fcdb9d5aa7c0` (`main` at the time; it already contains the H15-03 merge `18ae2b3e` plus one unrelated later merge, #1388).
- Code Head SHA / PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. Not started (each needs direction): the Backend `Accept` 401 behaviour, the Backend 422/409 for concurrent duplicate prices, a stable sort tie-break for the tenants API, `heading-order` (H15-11), and the remaining H1-5 P2/P3 items. No merge, no deploy, Horizon not closed.
