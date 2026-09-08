# Sync notes — AWJ Design System V2

## Known issue: `bg-*/<opacity>` on CSS-variable colors does not compile (action required)

**Root cause (verified with a minimal repro, not specific to this package):** Tailwind
CSS 3.4.19's opacity-modifier syntax (`bg-positive/10`, `bg-border/60`, etc.) cannot
resolve when the underlying color in `tailwind.config.ts` is defined as a bare
`var(--token)` string (as `background`, `surface`, `text`, `muted`, `border`,
`positive`, `negative`, `warning` all are here — copied verbatim from
`web/tailwind.config.ts`). Tailwind silently emits **no CSS at all** for any
class using that pattern; there is no build warning.

**Impact in this package:**
- `Skeleton` (`bg-border/60`) is **completely invisible** — nothing paints at all.
  Confirmed both via `package-validate.mjs`'s render check (fired
  `[RENDER_THIN] mounts have no text and paint nothing`) and by inspecting the
  compiled `dist/styles.css` directly (`grep bg-border` shows only the plain
  `.bg-border` rule, no `\/60` variant).
- `Badge` tones `positive`/`warning`/`negative` (`bg-<tone>/10 text-<tone>`) lose
  their background tint — the text color still renders correctly (it has no
  opacity modifier), so the tone is still visually distinguishable, just without
  the pill background. Same root cause, smaller visual impact.

**This is very likely present in the real `web/` application too** — it uses the
identical `tailwind.config.ts` color definitions. Not verified against the live
app in this session (out of scope: this sync only touches `awj-design-system-v2/`),
but worth an explicit check there.

**Why it wasn't patched here:** fixing it requires changing how colors are
defined in `tailwind.config.ts` (e.g. switching to space-separated RGB channels
so Tailwind's opacity math has a value to work with:
`--positive: 22 101 52; ... positive: 'rgb(var(--positive) / <alpha-value>)'`).
That's a real token-definition change, not a build/tooling adaptation — out of
scope for this sync's "no invented tokens, no redesign" constraint. Flagged to
the user for a decision; **not fixed in this sync**.

**Current grading status:** `Skeleton` is graded `needs-work` and stays pending
on every re-sync until this is resolved (or the preview is reworked to a
token that doesn't need an opacity modifier, if the user decides that's
preferable to a config fix). `Badge` is graded `good` — the tone distinction
still functions via text color alone, just without the tint background.

## Known render warns (triaged, non-blocking)

- `AccordionItem` — `[RENDER_THIN]` on its own standalone floor card ("mounted
  text is just AccordionItem"). Expected: it's a compound sub-component of
  `Accordion` and is composed inside `Accordion`'s own authored preview
  (`.design-sync/previews/Accordion.tsx`), per the skill's guidance for
  context-required leaves. Its own solo card is intentionally left on the floor.

## Fixed during this sync

- **`cssEntry` was pointing at the raw `src/styles/globals.css`** (with
  unprocessed `@tailwind` directives) rather than a compiled stylesheet. The
  converter just copies whatever `cssEntry` names — it does not run Tailwind
  itself. This meant the very first build shipped ZERO Tailwind utility classes
  (`bg-primary`, `text-primary-foreground`, etc. all missing), which was
  invisible until the `Button` contact-sheet screenshot was inspected (primary/
  danger variants showed as unstyled boxes). Fixed by adding a `build:css`
  script (`tailwindcss -i src/styles/globals.css -o dist/styles.css`) to
  `package.json`'s `build` script, and pointing `cssEntry` at `dist/styles.css`.
  **Always run `npm run build` (not just `build:js`) before re-syncing.**
- **`Dialog`'s preview rendered as a ~14px gray sliver** in `cardMode: single`
  capture. Root cause: the card's single-story mount point (`.ds-single`, a
  `transform`-based containing block for `position:fixed` descendants) has no
  intrinsic height of its own — `Dialog` renders in place (no React portal), so
  its `fixed inset-0` resolves against that zero-height containing block and
  collapses per the CSS auto-height circular-dependency rule. Fixed by wrapping
  the preview's `Dialog` in a plain `<div style={{ position: 'relative', height:
  420 }}>` in `.design-sync/previews/Dialog.tsx` — a normal in-flow sibling that
  gives `.ds-single` real height, so `Dialog`'s `fixed` positioning resolves
  correctly. This is preview-only composition scaffolding; `Dialog`'s own
  markup/behavior is untouched.
- **`Sheet` and `ToastProvider` needed no such fix** — `Sheet` uses a React
  portal (`SheetPrimitive.Portal`) that mounts to `document.body`, so its
  `fixed` positioning resolves against the real (definite-size) browser
  viewport, not the zero-height `.ds-single` wrapper. `ToastProvider`'s toast
  stack uses `bottom`/`end` offsets only (not `inset-0`), so it doesn't hit the
  same auto-height circular dependency.

## Re-sync risks

- The `cssEntry` fix above depends on `npm run build` having been run with the
  current `package.json` (which chains `build:js` then `build:css`). A re-sync
  that only runs `tsc` (skipping `build:css`) will silently regress to the
  zero-Tailwind-output bug with no error from the converter — it will just
  copy whatever's at `dist/styles.css`, stale or missing.
- The token/opacity issue above is a standing, un-fixed limitation. If a future
  re-sync adds any new component or preview using a `bg-*/<opacity>` (or
  similar) class on `background`, `surface`, `text`, `muted`, `border`,
  `primary`, `positive`, `negative`, or `warning`, expect the same silent
  failure. Grep `dist/styles.css` for the expected class before trusting a
  screenshot that "looks close enough."
- `dropdown.tsx` remains excluded (documented in the package README) — it
  imports `next/link`, unresolvable outside a Next.js app. Revisit if/when the
  source component is changed to accept a link-renderer prop instead.
