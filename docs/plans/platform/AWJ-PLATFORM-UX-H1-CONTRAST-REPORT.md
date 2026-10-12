# H1-CONTRAST — Implementation Report

STATUS: MERGED (PR #1328) / NOT DEPLOYED / POST-MERGE VERIFICATION NOT DONE
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

## Recovery pass (Claude, 2026-10-11)

- Branch `feat/awj-platform-ux-h1-contrast` (one Grok commit, `52618f2`) was merged into `claude/awj-h1-contrast-recovery-fx8unn` on top of current `origin/main` (`e0e5160`). The merge was clean; no stray changes were left by the stopped session.
- Fix: the Grok commit replaced the existing `Button asChild` test. It is restored, with an added danger-on-asChild case. `button.test.tsx` now has 6 tests, all passing.
- Verified: `button.tsx` is unchanged versus `main`. `--negative`, `--positive` and `--warning` are unchanged, so financial status colors are unchanged. The v3 rule (`globals.css` line ~1619) is still later and more specific.

## Build / lint / typecheck

- Full `npm test` in `web/`: 483 files, 4982 tests, all passed.
- `npm run build`: passed.
- `tsc --noEmit`: 48 errors, all in unrelated test files (e.g. `SliderFields.test.tsx`). Count is identical with and without this change; none touch `button` or `globals.css`.
- ESLint is not configured in the repo (interactive prompt), so lint was not run.

## CI

Exact Head `c4310e1db356e5389027d5a5ee665d6f662fd632` of PR #1328. All 7 GitHub check runs finished `success` (checked via the GitHub API before merge):

| Check | Result |
|---|---|
| web build (Next.js), two runs | success |
| php artisan test (L11, sqlite), two runs | success |
| php artisan test (L11, pgsql), two runs | success |
| storefront (lint + typecheck + test) | success |

## Pre-merge review

- PRE_MERGE_REVIEW: PASS, recorded as a comment on PR #1328 by the repository owner account (`safwan5001-source`) for the exact Head above.
- Reviewed Head SHA: `c4310e1db356e5389027d5a5ee665d6f662fd632`
- Findings / resolution: no open review threads. The one bot comment was an automated Codex usage-limit notice, not a finding. The pending-CI wording that this file carried before the merge is superseded by the table above.

## Merge

- Merge status: merged into `main` on 2026-10-11 (about 20:28 UTC), as a single-parent commit on `main`.
- Merge SHA: `bda44687e98e69c95c452846baeac473b3ff5e4d` (parent `b35017b377543aea3ae112703b7022316dcb4c23`, title "fix(platform): H1-CONTRAST — gate-off dark danger button contrast (#1328)"). Confirmed to be an ancestor of `main`.
- The merge was not performed by the Claude session that prepared the PR. Deploy and production release did not happen.

## Post-merge review

- POST_MERGE_REVIEW: not done. No evidence of target-branch checks or a smoke run on `bda4468` was collected, so none is claimed.
- Reviewed Merge SHA: none
- Target-branch checks/smoke: none recorded
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

- Implementation branch: `feat/awj-platform-ux-h1-contrast` (Grok commit `52618f2`), merged into `claude/awj-h1-contrast-recovery-fx8unn` with the `asChild` test restored (Head `c4310e1`).
- PR: #1328, merged. Base SHA at PR time: `e0e5160a0d396cc46a035f9d225046a721a965d2`.
- Merge SHA: `bda44687e98e69c95c452846baeac473b3ff5e4d`.

## Recommended next dependency-ready task

H1-2 platform shell, from latest `main`. See `AWJ-PLATFORM-UX-H1-2-SHELL-REPORT.md`.
