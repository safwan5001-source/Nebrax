# AWJ POS V2 — PR-4.1: Receipt Preview UX Fix

## Summary

Real-world visual review after PR-4 (merged as `afb7b01`) found the desktop Receipt
Preview dialog visually too small: on large monitors the thermal receipt rendered at
tiny natural size inside a small, mostly-empty modal, making text and the ZATCA QR
harder to read than necessary before printing.

This follow-up widens and heightens the preview dialog on desktop (`sm:`/`lg:`
breakpoints only) and visually enlarges the receipt itself via a scoped CSS `zoom`
applied *inside* `DocumentScaler`'s own measured content — not around it — so the
receipt stays legible, keeps its thermal (58/80mm) proportions, and uses far more of
the available viewport height. Mobile (below `sm:`, ~640px) is completely untouched:
the dialog keeps its original narrow, shrink-to-fit layout that already worked
correctly.

This is a presentation-only change. No accounting, tax, ZATCA, checkout, payment,
backend, or database logic was touched.

## Root UX problem

- `ReceiptDialog`'s `PosDialog` wrapper was capped at `max-w-sm sm:max-w-md` (≤ 28rem
  / 448px), and the preview's scroll area was separately capped at
  `max-h-[min(55vh,28rem)]` (≤ 448px tall).
- The thermal document itself (`ThermalLayout`) renders at its physical width in CSS
  pixels (`width: 80mm` ≈ 302px on screen), and `DocumentScaler` **never scales up**
  — it only shrinks (`scale = Math.min(1, avail / contentW)`) to avoid clipping on
  narrow (mobile) screens. So on a 1440px+ desktop monitor, the receipt rendered at
  its true ~302px width inside a dialog that itself was already narrow, with large
  unused space around both the dialog and the receipt.
- Fixing this required making the receipt visually *larger than its natural physical
  size* on desktop, which `DocumentScaler`'s architecture deliberately does not do
  (by design, for its 28 other call sites across invoices/quotes/purchases/reports).

## Files changed

- `web/src/components/pos/receipt-dialog.tsx` — dialog width/height, preview layout,
  zoom wrapper placement.
- `web/src/app/globals.css` — new `.receipt-preview-zoom` rule + print-safety
  override.
- `web/src/components/pos/receipt-dialog.test.tsx` — updated width assertions for the
  new `sm:max-w-xl lg:max-w-2xl` classes.

No other files were touched. `DocumentScaler`, `DocumentView`, `ThermalLayout`,
`printDocument`, `resolveTemplateRevisionDefinition`, the template registry, and every
other `DocumentScaler` consumer are unmodified.

## Implementation

### 1. Dialog shell (`receipt-dialog.tsx`)

```
className="max-w-sm sm:max-w-xl sm:h-[min(88dvh,52rem)] lg:max-w-2xl"
```

- Mobile (below `sm:`): unchanged — `max-w-sm`, no explicit height (shrink-to-fit, as
  before PR-4.1).
- `sm:` and up: width grows to `max-w-xl` (36rem / 576px), then `lg:max-w-2xl` (42rem
  / 672px) on wider desktops. Height is explicitly set to `min(88dvh, 52rem)` so the
  dialog uses ~88% of the viewport height (capped at 52rem so it doesn't grow
  unreasonably tall on very tall monitors), still bounded by `PosDialog`'s own
  `max-h-[calc(100dvh-2rem)]` safety margin.

### 2. Internal flex layout

The dialog body content became a flex column (`flex h-full min-h-0 flex-col`) with
three regions:
- header (invoice number / total) — `shrink-0`
- print-error banner (conditional) — `shrink-0`
- **preview area** — `min-h-0 flex-1 overflow-auto` — grows to fill all remaining
  dialog height; contains its own dedicated scroll region (not the browser page).
- action buttons (Print / Copy / Close) — `shrink-0`, always directly below the
  preview area.

Inside the preview area, a `flex min-h-full items-center justify-center` wrapper
centers the receipt both horizontally and vertically when it's shorter than the
available space, while `min-h-full` (not `h-full`) lets the wrapper grow taller than
its parent for long receipts — avoiding the classic "flex-centering clips overflow"
bug, so a receipt taller than the dialog remains scrollable to both its top and
bottom edges.

### 3. The zoom (`.receipt-preview-zoom`, in `globals.css`)

```css
.receipt-preview-zoom { zoom: 1; }
@media (min-width: 640px) { .receipt-preview-zoom { zoom: 1.3; } }
@media (min-width: 1024px) { .receipt-preview-zoom { zoom: 1.45; } }
@media print { .receipt-preview-zoom { zoom: 1 !important; } }
```

`zoom` (not `transform: scale()`) was chosen because it is layout-affecting: ancestors
correctly reflow to account for the enlarged box, unlike `transform`, which only
repaints without changing layout — the latter would need manual height/width
bookkeeping to avoid overlap. Print is explicitly neutralized (`zoom: 1 !important`)
so printed/PDF output is guaranteed pixel-identical to before this change, independent
of the existing `.doc-scaler-inner { transform: none !important }` print reset (which
resets a different property).

**Placement — child of `DocumentScaler`, not its parent.** The zoom wrapper is placed
*inside* `<DocumentScaler>`, wrapping only `<DocumentView>`:

```tsx
<DocumentScaler>
  <div className="receipt-preview-zoom">
    <DocumentView ... rootId="print-root" />
  </div>
</DocumentScaler>
```

This was a real bug caught during implementation (see below) — the first attempt
wrapped `<DocumentScaler>` itself in the zoom `div`, which broke `DocumentScaler`'s own
internal centering math.

### Bug caught and fixed during this pass: horizontal receipt clipping

Wrapping `DocumentScaler` in an *ancestor* zoom `div` caused the receipt's right edge
to be clipped by the dialog boundary (confirmed via `getBoundingClientRect()` on the
live DOM: `.doc-scaler-inner`'s translate-computed right edge extended ~99px past
`.doc-scaler-outer`'s own right edge, which clips via `overflow: hidden`).

Root cause: `DocumentScaler` measures its own `avail` (outer width) and `contentW`
(inner `scrollWidth`) to compute a centering `offsetX` via `transform:
translate3d(...)`. When the zoom was applied *above* `DocumentScaler`, its `offsetX`
math was computed correctly in isolation, but composing that `translate3d(...)` with
the ancestor's `zoom` in the same subtree produced a translate offset large enough to
push the (already-centered) content past its own clipping container — CSS `zoom` and
a descendant's `transform: translate()` do not compose predictably across engines,
which is part of why `zoom` was never standardized.

Fix: move the zoom wrapper to be a *child* of `DocumentScaler` (inside the content it
measures), not an ancestor. `DocumentScaler`'s `inner.scrollWidth` measurement then
directly reflects the already-zoomed content size (since `zoom` is layout-affecting,
`scrollWidth` correctly includes it), so its own `scale`/`offsetX` math stays
internally consistent with no nested-transform conflict. Verified via direct DOM
measurement after the fix: the receipt's right edge (939.4px) now sits safely inside
both `.doc-scaler-outer`'s right edge (1014px) and the outer scroll container's right
edge (1039px) — confirmed visually too (before: "الإجمالي شامل الضريبة" and other
right-column text and totals were cut off mid-word; after: fully readable, nothing
clipped).

## Safety confirmation

No changes to:
- accounting / journal entries / ledger posting
- tax / VAT calculation
- ZATCA (QR generation, UUID/ICV, PIH hash chain, UBL)
- checkout / payment / tender logic
- invoice numbering
- idempotency
- session / tenant / branch isolation
- customer logic
- receipt data construction (`buildPosReceiptInvoice`, `buildInvoiceDocumentModel`)
- the frozen thermal template revision mechanism
- `printDocument()` / print pipeline / `#print-root` semantics
- any backend endpoint, migration, or database schema

The change is scoped to `ReceiptDialog`'s own JSX layout and one new, print-neutralized
CSS class. `DocumentScaler` and every one of its other 28 call sites (invoices,
quotes, purchases, credit notes, returns, reports, print-template studio, etc.) are
untouched and unaffected — the zoom class is applied only inside `receipt-dialog.tsx`.

## Tests

| Scope | Command | Result |
|---|---|---|
| Targeted | `npx vitest run src/components/pos/receipt-dialog.test.tsx` | 5/5 passed |
| Broader POS | `npx vitest run src/components/pos src/lib/__tests__ "src/app/(app)/pos"` | 73 files / 388 tests passed |
| Full frontend | `npx vitest run` | 230 files / 1466 tests passed (identical to PR-4 baseline, 0 regressions) |
| Production build | `npm run build` | exit 0, "✓ Compiled successfully" |

No assertions were weakened, skipped, or deleted. `receipt-dialog.test.tsx`'s width
assertions were updated to match the intentional new width classes (`sm:max-w-xl
lg:max-w-2xl`), keeping the existing negative guard (`not.toContain('max-w-xs')`).

## Build

`npm run build` — exit code 0, compiled successfully in ~17–32s across repeated runs,
no new warnings introduced.

## Browser QA

All screenshots captured via pinned Chromium (`/opt/pw-browsers/chromium`) through
Playwright, against a real seeded tenant (`PR4-1 UX`) with three real posted POS
invoices (`INV-2026-00001` short/1-line, `INV-2026-00002` multi-item, `INV-2026-00003`
16-line for scroll testing), driving the actual Next.js dev server with
localStorage-injected auth (no mocked UI).

| # | Scenario | Viewport | Result |
|---|---|---|---|
| A | Desktop RTL light, short receipt | 1440×900 | Pass — large, centered, fully readable, no clipping |
| — | 1366×768 desktop RTL (shorter viewport) | 1366×768 | Pass — same quality, dialog height correctly adapts (`min(88dvh,52rem)` → 675.8px measured) |
| B | Desktop LTR | 1440×900 | Pass — layout/labels flip correctly, receipt content stays in its own internal RTL |
| C | Desktop dark mode | 1440×900 | Pass — dialog chrome follows dark theme; receipt paper stays white (fidelity preserved) |
| D | Long receipt (16 lines) scrolling | 1440×900 | Pass — top and scrolled-to-bottom both captured; footer/ZATCA notice/QR all reachable, no clipping in either state |
| E | Mobile RTL, Invoice Center | 390×844 | Pass — unaffected by this change (menu → "آخر الفواتير") |
| F | Mobile RTL, short receipt | 390×844 | Pass — identical to pre-PR-4.1 behavior (zoom media query starts at `sm:`/640px, does not apply) |
| G/H | Mobile RTL, long receipt (top + scroll check) | 390×844 | Pass — no horizontal overflow (`document.documentElement.scrollWidth === clientWidth`, verified `false` via script), fully scrollable |

**Functional regression check:** Products → Invoice Center → Invoice Details → Receipt
Preview → Close → back to list → back to Products, confirmed via screenshot: cart
empty as expected (no items had been added), customer selector reset, session/branch/
device context (`POS-2026-00001` / `POS1` / الفرع الرئيسي) all intact and unchanged
throughout the round trip. No checkout occurred during Receipt Preview → Print/Close.

**"3 Issues" dev indicator** — re-diagnosed with live console capture, identical to
every prior mission this session: `IntlError: INVALID_KEY` for three dotted keys
(`partner.created`, `product.created`, `invoice.created`) under the `developer.events`
i18n namespace in `ar.json`/`en.json`. Confirmed unrelated to this change (no file
touched by PR-4.1 defines or references these keys), dev-only (a `use-intl` strict
namespace validator that only runs in development), and absent from the production
build path (`npm run build` succeeds cleanly). Per instructions, left undiagnosed-but-
untouched: not fixed, not suppressed.

## Before / After

Measured via `getBoundingClientRect()` on the live DOM (Chromium, Playwright), not
estimated.

| | Before (PR-4) | After (PR-4.1) |
|---|---|---|
| Dialog max-width (desktop) | `sm:max-w-md` = 28rem / 448px | `sm:max-w-xl` (576px) → `lg:max-w-2xl` (672px) |
| Dialog height (desktop) | none (shrink-to-fit content) | `min(88dvh, 52rem)` — measured 792px @ 1440×900, 675.8px @ 1366×768 |
| Preview scroll area cap | `max-h-[min(55vh,28rem)]` ≤ 448px | `flex-1` (fills remaining dialog height) |
| Receipt visible width (desktop, natural/unscaled) | ~302px (80mm thermal @ 96dpi) | 438.4px measured (zoom 1.45× applied at `lg:`, 302×1.45≈438, matches) |
| Receipt visible height (short receipt, desktop) | natural content height (~300–350px, unscaled) | 592.7px measured @ 1440×900 |
| Horizontal clipping | n/a (not previously an issue at natural size) | none — verified zero at both desktop (DOM measurement) and mobile (`scrollWidth === clientWidth`) |

Viewport used for primary measurement: 1440×900 (desktop RTL) and 1366×768 (secondary
desktop). Mobile measured at 390×844.

## Known issues

None found beyond the pre-existing, out-of-scope "3 Issues" dev indicator documented
above. The one real defect discovered during implementation (horizontal receipt
clipping from the ancestor-zoom placement) was caught before finalizing and fixed by
relocating the zoom wrapper inside `DocumentScaler` — see "Bug caught and fixed" above.

## Scope exclusions

PR-5 (Payment Workspace), PR-6 (Returns/Refunds/Exchanges), PR-7 (Session Operations),
and PR-8 (Production Hardening/Hardware Integration) remain completely untouched. No
Return/Refund UI was added or referenced. No backend endpoint, API contract, or
database schema was added or changed.

## Git

- Repository: `safwan5001-source/Nebrax`
- Branch: `claude/pos-v2-pr4-1-receipt-preview-ux`
- Base: latest `main` at session start — PR-4 merge commit `afb7b0152f52c20fa907cd000a4fc27a45341dc5` (#659, confirmed via `git log`/`git pull`)
- PR: created as Draft (see final chat reply for URL/number)
- Head SHA: `30e713ce4d222cc37bfaca7c1c844df62fc7b1eb`

## Risks / Remaining

- The `zoom` CSS property is non-standard (not in the CSS spec) but is supported
  consistently across current Chromium, Safari 17+, and Firefox 126+ — all engines
  relevant to AWJ's desktop POS terminals. On an engine that ignores it entirely, the
  receipt would simply render at its pre-PR-4.1 natural size (graceful degradation,
  no breakage — `zoom: 1` is the unconditional base rule).
  - This is a judgment call, not a stop condition: it was not raised to the user
    before implementing, since it introduces no risk to receipt data, printing
    correctness (explicitly neutralized for print via `@media print`), or any
    financial/backend behavior — only a cosmetic degradation path on an
    unsupported engine. Flagged here for visibility rather than as a blocker.
- Zoom factors (1.3 / 1.45) were chosen empirically to look well-proportioned across
  1366–1920px desktop widths in this QA pass; no explicit "make it exactly Nx bigger"
  spec was given, so these are a judgment call and can be tuned by request.

## Next step

ChatGPT review → CI → Safwan's explicit approval → merge. No merge, deploy, or
release has been performed.
