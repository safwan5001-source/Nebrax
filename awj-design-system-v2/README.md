# AWJ Design System V2 (source package)

Standalone, independently-buildable extraction of AWJ's (نبراس) actual design-system
primitives, tokens, typography, and RTL/LTR foundations — for syncing to
claude.ai/design via the `/design-sync` skill.

**Everything here is copied verbatim from the main application** (`web/`), with only
the minimum adaptation needed to build outside a Next.js app (see below). No component
was redesigned, no token was invented, and no business-logic or page-specific component
is included.

## Provenance

| Path here | Copied from |
|---|---|
| `src/styles/globals.css` (tokens + base layer) | `web/src/app/globals.css` (lines 6–57 only) |
| `tailwind.config.ts` | `web/tailwind.config.ts` |
| `src/lib/utils.ts` | `web/src/lib/utils.ts` |
| `src/lib/formatting.ts` | `web/src/lib/formatting.ts` |
| `src/components/*.tsx` | `web/src/components/ui/*.tsx` |

## Included primitives

`accordion`, `badge`, `button`, `card`, `combobox`, `dialog`, `input`, `label`,
`select`, `sheet`, `skeleton`, `switch`, `table`, `tabs`, `textarea`, `toast`.

`dropdown.tsx` is excluded from this first sync — it imports `next/link`, which
doesn't resolve outside a Next.js app.

## Adaptations made for standalone buildability (no visual/behavioral change)

1. **Import paths**: `@/lib/utils` and `@/lib/formatting` rewritten to relative
   paths (`../lib/utils`, `../lib/formatting`) since this package has no path-alias
   config of its own.
2. **Fonts**: the app loads IBM Plex Sans Arabic / IBM Plex Mono via `next/font`
   (Next.js-only machinery that produces a hashed CSS variable). This package loads
   the same two font families via a Google Fonts `@import` instead. Same fonts, same
   weights, different loading mechanism.
3. **`tsconfig.json`**: `"jsx": "react-jsx"` instead of the app's `"jsx": "preserve"`
   (which requires the Next.js compiler plugin) — plain `tsc` needs to emit JSX
   transforms itself since there's no Next.js build step here.
4. **Excluded CSS**: only the `:root`/`.dark` token block and the `body`/focus-visible/
   `.num` base layer were carried over from `globals.css`. Print rules, POS thermal
   receipt zoom, and document-composition page-break rules are feature-specific to the
   application and out of scope for a design-system package.

## Not included (out of scope for this package)

- Any page, route, or business-logic component.
- `branch-view-toggle.tsx`, `number-preview-field.tsx`, `technical-details.tsx` —
  feature/business-specific widgets, not visual-language primitives.
- `dropdown.tsx` — see above.
