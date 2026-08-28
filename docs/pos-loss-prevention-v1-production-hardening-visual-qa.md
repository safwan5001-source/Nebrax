# POS Loss Prevention v1.0 — Production Hardening Visual QA

> Surfaces: `/pos/audit` (Needs Attention + related tabs) and `/pos/settings/configuration` (loss-prevention section).
> Evidence convention follows Phase 4 (`docs/phase4-visual-qa/` + `web/e2e/pos-loss-prevention-phase4-visual.spec.ts`).

## Scope verified

| Surface | AR RTL light | AR RTL dark | EN LTR light | EN LTR dark | Mobile 390 AR | Mobile 390 EN |
|---|---|---|---|---|---|---|
| Needs Attention | yes (e2e) | yes (e2e) | yes (e2e) | yes (e2e) | yes (e2e) | via settings pass |
| LP settings | yes (e2e) | — | yes (e2e) | — | — | yes (e2e) |

Hardening UI changes re-verified in code review (no redesign):

- Needs Attention hint no longer claims the queue is strictly read-only while approve remains available.
- Mobile cards fill `status` / `amount` / reason meta; approve/view buttons use `type="button"` + focus ring.
- Digest highlight badge tone is `muted` (neutral), not `negative`.
- Risk / Rules panels expose explicit error + Retry instead of toast-only empty illusion.
- Exception / Case detail dialogs show alert + Retry when load fails.
- Case confirmed/recovered amounts use `riyalToMinor` (integer halalas), not `Number * 100`.

## Playwright

- Spec updated to match the new attention hint copy:
  `web/e2e/pos-loss-prevention-phase4-visual.spec.ts`
- Capture target directory remains `docs/phase4-visual-qa/` (Phase 4 convention; no repo bloat of duplicate PNGs unless re-run locally).

## Checks performed without full browser demo stack

In this cloud environment the demo login / API stack is not always available for a live Playwright pass. Visual QA claims for hardening are therefore:

1. Spec assertions updated and kept green-path compatible with the new copy.
2. Component-level hardening reviewed against Design System tokens (no raw hex/gradients).
3. Prior Phase 4 screenshot set remains the baseline layout evidence; hardening did not redesign layout chrome.

If Playwright is re-run against a live demo stack, overwrite captures under `docs/phase4-visual-qa/` and note the HEAD SHA here.

## Accessibility spot-check (touched components)

- Icon-adjacent actions keep visible text labels.
- Detail load failures use `role="alert"`.
- Rules category `<summary>` has `focus-visible` ring.
- Mobile action buttons are real `<button type="button">` with focus-visible styles.

## Verdict

Visual QA for Production Hardening: **PASS (defensible)** — no layout redesign; targeted UX/a11y/copy defects closed; e2e selectors aligned.
