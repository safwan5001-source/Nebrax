## AWJ Design System V2 — build with these components

This is a **RTL-first, Arabic-primary** design system extracted verbatim from AWJ's
production application. Every visual decision below is a real, shipped convention —
not a suggestion.

**Direction and language.** Set `dir="rtl"` and `lang="ar"` on the page root by
default (the source app switches to `dir="ltr"` only for an English locale). Arabic
copy is the default register for generated text; numeric/financial values still use
Latin digits (see `.num` below) even in Arabic copy.

**Dark mode.** Tailwind's `darkMode: 'class'` — add a `.dark` class to any ancestor
(typically `<html>`) to switch every token to its dark value. There is no
`ThemeProvider` component; dark mode is pure CSS, no wrapper needed.

**Styling idiom — real tokens only, never invent a class.** Every surface, text, and
border color is a Tailwind utility backed by a CSS custom property, defined in both
a light and dark value:

| Class | Use |
|---|---|
| `bg-background` / `text-text` | page background / default text color |
| `bg-surface` | card, input, dialog, and panel backgrounds (`--surface`) |
| `text-muted` | secondary/help text, placeholders |
| `border-border` | all hairline borders |
| `bg-primary` / `hover:bg-primary-hover` / `text-primary-foreground` | primary action fill (buttons) |
| `bg-primary-soft` / `text-primary` | selected/active tint (active tab underline color, selected list item) |
| `text-positive` / `text-negative` / `text-warning` | status text (paid/overdue/pending, success/error) |
| `rounded` | the system's one border-radius (0.5rem) — do not introduce other radii |
| `.num` | tabular-nums + monospace font for any financial amount or code — always pair with Latin digits |

**Known gap — do not use opacity modifiers on these tokens.** `bg-<token>/<N>`
(e.g. `bg-positive/10`, `bg-border/60`) does not compile in this build (a
pre-existing Tailwind/token-definition limitation, not a class you got wrong) and
renders as fully transparent. Use the plain token class instead, or a fully-opaque
value. Building tinted status backgrounds via this pattern will silently produce
nothing visible.

**Typography.** `IBM Plex Sans Arabic` (`font-sans`, the default) and `IBM Plex Mono`
(`font-mono`, used only via `.num`). No third family. Weights actually shipped: 400,
500, 600, 700 — do not request a weight outside that set.

**Where the truth lives.** Read `styles.css` (and its `@import` of `_ds_bundle.css`)
for the complete compiled token/utility set before styling anything by hand — it is
the single source of truth for every class and custom property named above. Each
component's own `.d.ts` and `.prompt.md` under `components/<group>/<Name>/` is the
API contract; read it before composing that component.

**Build example** (real, verified-rendering composition):

```tsx
import { Card, CardHeader, CardTitle, CardContent, Badge } from 'awj-design-system-v2';

function InvoiceSummaryCard() {
  return (
    <Card style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>إجمالي المبيعات هذا الشهر</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="num" style={{ fontSize: 24, fontWeight: 600 }}>
          48,320.00 ر.س
        </p>
        <Badge tone="positive">+12% عن الشهر الماضي</Badge>
      </CardContent>
    </Card>
  );
}
```
