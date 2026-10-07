# CUST-HV V5c — Design resolver & renderers (Canvas + published storefront) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5c** — third slice of V5 (V5a engine+palette ✓ → V5b contract ✓ → **V5c renderers** → V5d inspector/ColourField/publish gate + V1B → V5e typography/buttons/surfaces/separators/motion) |
| **Branch** | `cust-hv/v5c-design-renderers` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `169ad076` — `origin/main` after V5b (#1267) merged |
| **Authority** | V0 §3.1 (absent ⇒ legacy), §3.5 (one pure resolver per runtime, parity by structure), §4.5 (auto foreground first), §6.3 (width) |
| **Depends on** | V5a (engine, palette) · V5b (contract) |

V5c is the first V5 slice that **changes pixels** — but only for a section that carries a `design`. No UI authors one yet (V5d) and nothing in Production does, so published output is unchanged today by construction; what is new is a rendering path that is already proved against a real browser.

---

## Implemented

### 1. One pure resolver, two runtimes — `section-design-resolve.ts`
`resolveSectionDesign(type, design, ctx) → { attrs, style } | null`. **Byte-identical** in `web/` and `storefront/` (a test fails on any drift, along with `section-design.ts`, `palette.ts` and `contrast-engine.ts`).

- Output is only `data-sd` (a list of the groups in effect) + `data-design-type`, and `--sec-*` custom properties whose values come from validated tokens/hex colours. **No string from the document is ever interpolated** (asserted against a value alphabet: no `url`, `expression`, `;`, braces).
- `null` ⇒ the caller renders the section **exactly as before** — no wrapper, no attribute.
- Roles resolve through the merchant's palette, then **today's fixed tokens** (`resolveRoleHex`: surface `#fff`, surfaceAlt `#f3f4f6`, text/heading `#111827`, border `#e5e7eb`, link→brand, accent→`accentColor ?? derive(brand)`).
- **Auto foreground first** (V0 §4.5.1): a section with a background and no explicit text colour gets white or pure black, whichever the V5a engine proves better against the **whole** background range (a gradient's interior, not its ends).
- Gradient directions are logical and mirror under RTL (`to-end` ⇒ `to right` in LTR, `to left` in RTL).

### 2. Frames — `SectionDesignFrame` (Canvas + storefront)
Wraps a section only when it has a design. Storefront: `publishedNodes` was split so each section's node is built as before and wrapped *afterwards*; the Canvas wraps inside the existing selectable shell, so selection/keyboard behaviour is unchanged.

### 3. Stylesheet (twin blocks, test-enforced equal modulo the preview scope)
`[data-sd~="…"]` rules for **background, spacing, align, width (`max`; `full` = solid bleed), border, radius, shadow** and **text colours**.

**Text colours** re-point the store's own text tokens inside the section, so every component that reads them follows — and anything that paints its own surface (`bg-store-*`, `bg-white`: cards, chips, buttons) gets the original tokens back via a **zero-specificity `:where()`** reset, so a utility like `text-store-primary-foreground` on that very element still wins. Section-level headings/links are recoloured only when they are *not* inside a nested surface.

**Full bleed** is a solid band that extends past the page container using a `box-shadow` spread (adds no scrollable overflow) clipped horizontally (`clip-path`); a radius or drop shadow on something that bleeds off screen has no meaning, so they apply to contained sections only.

---

## Proof — real browser, real components (Implementation Evidence Gate)

`web/e2e/cust-hv-v5c-design-render-proof.spec.ts` mounts the **real Canvas** (the component the builder uses) with **every section type that declares a design**, each wearing a different one — dark solid, dark gradient, light band with border and pill radius, bordered card with shadow, full-bleed band — in **Arabic RTL and English LTR at 390 · 430 · 768 · 1024 · 1280 · 1440** (**13/13 passing**). In Chromium, for every visible text node inside a designed section it:

- computes the drawn colour and the **background actually behind it** (first painted ancestor; a gradient sampled through its real range; the bleed band's shadow spread) and asserts **≥ 4.5:1 (≥ 3:1 for large text)**;
- asserts **no horizontal page overflow** (the bleed band is the risk);
- asserts that a section **without** a design has no `data-sd` / `data-design-type` anywhere.

**The proof caught three real defects in my first cut — all fixed, all now regression-proof:**

| # | Defect found by the run | Fix |
|---|---|---|
| 1 | Heading rule recoloured section headings that sit inside a **white card** (white-on-white, ratio 1.00) | Heading/link recolouring excludes anything inside a nested surface |
| 2 | The nested-surface reset set `color:` at normal specificity and **overrode** `text-store-primary-foreground` on the CTA (dark on dark green, 1.36:1) | Reset moved into `:where()` (zero specificity) so explicit utilities win |
| 3 | The same reset made a dark app-promo band's text dark (ratio 1.00) | same as 2 |

---

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC | No route, model, query or migration. |
| Draft vs Published | Rendering only; the document, versions, publish and schedule paths are untouched. |
| Media ownership | No media (`background.kind = media` is still dropped by V5b). |
| Commerce / accounting truth | Untouched; no price/stock/offer data is read or written. |
| Backward compatibility | **Absent design ⇒ no wrapper, byte-identical** (unit-tested on the frame, and in the browser: zero `data-sd` on a plain document). Storefront page tests 45/45 unchanged. |
| Accessibility | Every drawn text node in every designed section measured ≥ 4.5:1 in a real browser at six widths × RTL/LTR. The **publish gate** (V5d) will make this a server-enforced property rather than a property of my fixtures. |

## Verification

| Gate | Result |
|---|---|
| Web | `section-design-resolve.test.tsx` **17** (resolver, frame, byte-identical twins, stylesheet parity) · full vitest **427 files / 3702** (drift ratchet ✓) |
| Storefront | `section-design-resolve.test.tsx` **12** · full vitest **142 files / 1284** · `tsc` ✓ · `biome check` ✓ |
| Real browser | `cust-hv-v5c-design-render-proof.spec.ts` **13/13** (local evidence gate, as V3/V4b/V5a) |
| Backend | **no backend file changed** (`git diff origin/main` touches no `app/` `routes/` `database/` `tests/` `config/`); the full run on the identical backend is V5b's (5751 passed, 28 env-only failures) · PostgreSQL by CI |

Evidence: `docs/plans/store/cust-hv-v5c/*.jpg`.

## Limitations & deferred (stated, not hidden)

- **`width.mode = wide` renders as `contained`.** The page container is a fixed-width column; a "wider than the column" section needs the container restructured (V5d / V1B layout work). The V5d inspector will offer only the modes the renderer supports.
- **A gradient does not bleed.** Only a solid band can extend past the container without adding scrollable overflow; a full-width gradient waits for the same restructuring.
- **`typography` is accepted by the contract but not rendered** — scales and heading styles need integration inside each component; that is V5e.
- **Some gradients cannot be made readable.** V0 promised an automatic foreground for every *opaque colour*; for a *gradient* neither white nor black may reach 4.5:1 across its whole range (the documented `#d1456a → #1e8b9a` pair reaches ≈ 4.0 either way). The resolver still picks the better one and the V5d publish gate will **block** such a design — the fail-closed rule, not a bug.
- **Headings recolour only when they carry an `id`** (every `SectionHeading` and section title does). A title without one keeps following the body foreground, which is still provable.
- **Canvas vs storefront parity** is structural (same resolver, same stylesheet block, test-enforced); I did not run the storefront in a browser against a live backend — the Canvas browser proof exercises the identical resolver and stylesheet.
- **`accentColor` is still not consumed by storefront chrome** (badges, highlights, link hover) — DEF-2 / V1B, with the inspector.

## Next dependency-safe slice

**V5d** — `ColourField` (role swatches, hex, recent colours, live contrast badge, "suggest foreground"), the Content / Design / Layout inspector for the declared groups, copy/paste style and reset design, the **PHP publish contrast gate** (client and server running the identical V5a algorithm over `effectiveText`), and the V1B items (768 editing surface, DEF-2 accent, DEF-6 delete confirmation, BL-4 Canvas width).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
