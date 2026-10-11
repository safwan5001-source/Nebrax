# H1-CONTRAST — Implementation Report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
DATE: 2026-10-11

## Outcome

Gate-off dark danger fills no longer put white text on `#f87171` (2.77:1). The text is `#0e1014` (6.88:1), which clears WCAG 2.2 AA 1.4.3 for normal text (4.5:1). Light mode stays white on `#b91c1c` (6.47:1). Button sizes, variants, and `--negative` are unchanged. v3 dark still uses `--awj-text-inverse`.

## Repository evidence / root cause

`Button` danger is `bg-negative text-white`. Gate-off `.dark --negative` is `#f87171`. The v3 correction at `html[data-awj-ui="3"].dark .bg-negative.text-white` does not apply on platform routes because they do not set `data-awj-ui`.

## Approach chosen

In the gate-off token block of `web/src/app/globals.css`, outside the generated v3 markers:

- `:root { --danger-fg: #ffffff; }`
- `.dark { --danger-fg: #0e1014; }`
- `.dark .bg-negative.text-white { color: var(--danger-fg); }`

`#0e1014` is the existing dark `--background`. The selector is less specific than the v3 rule, and the v3 rule stays later in the file.

## Why this approach fits AWJ

It uses the existing danger fill and the existing dark background ink. It does not turn on the v3 gate, does not recolor `--negative` / `--positive` / `--warning`, and does not change button geometry. `text-negative` stays the light red in dark mode.

## Changed files

- `web/src/app/globals.css`
- `web/src/components/ui/button.test.tsx` (new)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1.md` (status only)
- this report

Not changed: `button.tsx` classes and sizes, platform pages, API, schema, generated `html[data-awj-ui="3"]` block.

## Tests and exact results

From `web/`:

`npm test -- src/components/ui/button.test.tsx`

**4 passed.**

- Danger still has `bg-negative`, `text-white`, `hover:opacity-90`.
- `md` and `icon` stay `h-9`; `sm` stays `h-8`.
- Source still has both `--negative` values, both `--danger-fg` values, the gate-off rule, and the later v3 rule.
- Contrast math: white/`#f87171` is below 4.5; `#0e1014`/`#f87171` and white/`#b91c1c` are at least 4.5.
- jsdom does not resolve custom properties. The winning specified color is `var(--danger-fg)` in gate-off dark, `#fff` in light, and `var(--awj-text-inverse)` when the v3 selector matches.

Headless Chromium, using the rules copied from `globals.css` plus the two utility stand-ins Tailwind would emit:

| Mode | Text | Fill |
|---|---|---|
| Light, gate off | `rgb(255, 255, 255)` | `rgb(185, 28, 28)` |
| Dark, gate off | `rgb(14, 16, 20)` | `rgb(248, 113, 113)` |
| Dark, `data-awj-ui="3"` | `rgb(14, 26, 49)` | not this slice's token remap |
| Dark, gate off, opacity 0.9 | still `rgb(14, 16, 20)` | `--negative` still `rgb(248, 113, 113)` |

## Build / lint / typecheck

Not run as a separate local production build. CI `web build (Next.js)` is the build check.

## CI

Recorded on the pull request for the final head. Not claimed green in this file until those checks finish.

## Pre-merge review

- PRE_MERGE_REVIEW: not requested
- Reviewed Head SHA: the pull request head
- Findings / resolution: see the three passes below. No open blocker.

## Merge

- Merge status: not merged
- Merge SHA: none

## Post-merge review

- POST_MERGE_REVIEW: not done
- Reviewed Merge SHA: none
- Target-branch checks/smoke: none
- Findings / resolution: none

## Self-review

### Implementer

The rule sits above the generated token block, so `tokens:generate` will not delete it. `button.tsx` was not edited, so the CSS hook classes remain. Hover stays `opacity` rather than a second color pair; Chromium kept `rgb(14, 16, 20)` at opacity 0.9.

### Reviewer

Specificity is 0,3,0 versus the v3 selector `html[data-awj-ui="3"].dark .bg-negative.text-white` (one element, one attribute, three classes). Chromium resolved v3 dark text to `rgb(14, 26, 49)` (`#0E1A31`), not `rgb(14, 16, 20)`. Light mode has no `.dark` ancestor, so the new rule does not apply.

Shared callers of the same pair, not only `Button`:

- `web/src/components/layout/notification-bell.tsx` count badge
- `web/src/app/(pos)/pos/page.tsx` cart count

They get the same dark-mode ink. That is the same contrast defect, not a new color role. `input.tsx` uses `hover:bg-negative hover:text-white` without the resting `bg-negative text-white` pair, so it is outside the selector.

### AWJ Guardian

No tenant or branch isolation change. No accounting, inventory, pricing, payment, or permission change. `--negative` is still `#b91c1c` in light and `#f87171` in dark, so financial and status ink that uses `text-negative` is unchanged. No API, schema, or migration. Backward compatible: the class names are the same; only the computed dark text color of this pairing changes.

## Accounting impact

None. No journal, tax, or money formatter change.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

Class names and button sizes are unchanged. Dark danger text is darker. v3 screens keep their existing inverse text.

## API / DB / migration impact

None.

## External research used

WCAG 2.2 SC 1.4.3 contrast minimum is 4.5:1 for normal text. The ratios were calculated from the token hex values: 2.77, 6.88, and 6.47.

## Risks / remaining work

- The count badges above change with the button. They are 9–10px, so they also needed 4.5:1. No separate badge design was introduced.
- jsdom cannot resolve the custom property to `rgb(14, 16, 20)`. The Chromium probe did. CI does not repeat that probe.
- H1-2 and the page slices are not started.

## Discovered backlog

None that blocks this slice.

## Git state

- Branch: `feat/awj-platform-ux-h1-contrast`
- PR: see the pull request opened from this branch
- Base SHA: `31035783a36b3fbaf329b7c789c8af64e9097279`
- Head SHA: the pull request head after push. This file is part of that commit.

## Recommended next dependency-ready task

H1-2 platform shell, from latest `main`, only after this contrast PR is either merged or explicitly left behind. Stop before merge.
