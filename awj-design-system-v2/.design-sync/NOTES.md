# Sync notes — AWJ Design System V2

## Fixed: `bg-*/<opacity>` on CSS-variable colors did not compile

**Root cause (verified with a minimal repro, not specific to this package):** Tailwind
CSS 3.4.19's opacity-modifier syntax (`bg-positive/10`, `bg-border/60`, etc.) cannot
resolve when the underlying color in `tailwind.config.ts` is defined as a bare
`var(--token)` string. Tailwind silently emits **no CSS at all** for any class using
that pattern; there is no build warning.

**Impact before the fix:** `Skeleton` (`bg-border/60`) was completely invisible;
`Badge` tones `positive`/`warning`/`negative` and the `Table` row-hover state
(`hover:bg-primary-soft/40`) lost their background tint (text/border colors without
opacity modifiers still rendered fine).

**This is very likely present in the real `web/` application too** — it uses the
identical `tailwind.config.ts` color-definition pattern (`positive`, `negative`,
`warning`, `border`, `primary.soft` all as bare `var(--token)`). Not verified
against the live app in this session (out of scope: this sync only touches
`awj-design-system-v2/`) — worth an explicit check there.

**Fix applied (approved by the user), scoped to `awj-design-system-v2/` only:**
for the 5 tokens actually used with an opacity modifier anywhere in this package's
16 components — `border`, `primary-soft`, `positive`, `negative`, `warning` — added
a companion `--<token>-channel` CSS variable (the same color's decimal RGB
decomposition, e.g. `--positive-channel: 22 101 52;` for `#166534`) in both
`:root` and `.dark` in `src/styles/globals.css`, and pointed just those 5 Tailwind
color entries in `tailwind.config.ts` at `rgb(var(--<token>-channel) / <alpha-value>)`.

The original hex `--<token>` variables were **left untouched** — `toast.tsx` reads
`var(--positive)`/`var(--negative)`/`var(--warning)`/`var(--primary)` directly as an
inline `style={{color}}` value (not through Tailwind), so those needed to keep
resolving to a real color string. No component logic, class name, or visual value
changed; unmodified classes (`bg-positive`, `border-border`, etc.) resolve to the
exact same opaque color as before (`<alpha-value>` defaults to `1`).

**Verified after the fix** (see the "Fixed during this sync" section below for the
verification steps and results) — `Skeleton`, `Badge`, and `Table`'s hover state now
render their tints correctly in both light and dark mode. All 16 previews are graded
`good`; nothing is pending.

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
- **`bg-*/<opacity>` on CSS-variable colors** (see above) — added `-channel` RGB
  variables for `border`, `primary-soft`, `positive`, `negative`, `warning` in
  `src/styles/globals.css` and updated their `tailwind.config.ts` color entries
  to `rgb(var(--x-channel) / <alpha-value>)`. Verified: `grep` of the compiled
  `dist/styles.css` shows `.bg-border\/60`, `.bg-positive\/10`,
  `.bg-negative\/10`, `.bg-warning\/10`, and `.hover\:bg-primary-soft\/40\:hover`
  all now emit real `rgb(... / 0.N)` rules; the non-opacity classes
  (`.bg-border`, `.text-positive`, `.border-negative`, etc.) still resolve
  through `--tw-bg-opacity`/`--tw-text-opacity: 1` — fully opaque, unchanged
  from before. Re-captured `Skeleton` (now visibly painting its three bars in
  both themes), `Badge` (all 5 tone chips now show their tinted backgrounds),
  and `Table` (verified the `hover:bg-primary-soft/40` row tint with a direct
  Playwright hover screenshot, since a static capture can't show `:hover`).
  Confirmed dark mode separately for all three (`.dark` class + a fresh
  screenshot per component) — each resolves its own theme's `-channel` value,
  not the light one. `Skeleton` re-graded `good`; `Badge` and `Table` grades
  refreshed via `package-capture.mjs --force` since a CSS-only change doesn't
  auto-invalidate a source-keyed grade.

## Re-sync risks

- The `cssEntry` fix (raw `globals.css` → compiled `dist/styles.css`) depends
  on `npm run build` having been run with the current `package.json` (which
  chains `build:js` then `build:css`). A re-sync that only runs `tsc` (skipping
  `build:css`) will silently regress to the zero-Tailwind-output bug with no
  error from the converter — it will just copy whatever's at `dist/styles.css`,
  stale or missing.
- **Adding a new `-channel` token pair:** if a future component needs an
  opacity modifier on a color that doesn't yet have a `-channel` variable
  (currently only `border`, `primary-soft`, `positive`, `negative`, `warning`
  have one), it will hit the exact same silent-failure bug. Follow the same
  pattern: add `--<token>-channel: <R> <G> <B>;` to both `:root` and `.dark`
  (the exact decimal decomposition of that theme's existing hex value — don't
  approximate), then point that one Tailwind color entry at
  `rgb(var(--<token>-channel) / <alpha-value>)`. Leave the original hex
  variable untouched if anything (like `toast.tsx`'s inline styles) reads it
  directly via `var(--x)` outside of Tailwind.
- `dropdown.tsx` remains excluded (documented in the package README) — it
  imports `next/link`, unresolvable outside a Next.js app. Revisit if/when the
  source component is changed to accept a link-renderer prop instead.
