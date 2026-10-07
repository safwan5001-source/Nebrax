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

## Review round (Codex, 32 findings — all valid, all fixed)

| Finding | Fix |
|---|---|
| **P1** a design background sat *behind* the section's own opaque root (banner card, hero gradient, dark promo bands) and was hidden | `[data-sd~="bg"] > *` clears the legacy fill so the design **replaces** it; the root is no longer treated as a "nested surface" (its text follows the design). Footer/primary-foreground tokens (what dark bands are built from) are re-pointed too, with `-base` originals restored inside real nested surfaces. A section that **owns a dark surface** (`hero`, `appPromo`, `wholesale`) **ignores text colours unless the design paints a background** (they would land on a surface the contrast proof cannot see — fail-closed). |
| **P2** muted copy at 78 % opacity broke a just-passing ratio (`#757575` + black = 4.56 → 3.79) | Muted text now uses the **proven foreground itself** (no translucency); `<p>` copy follows it so utility `/80` alphas cannot lower a proven ratio. |
| **P2** headings without `id` (Canvas preview) were not recoloured | Section headings are identified structurally (any `h1–h3` not inside a surface nested in the section), not by `[id]`. |

| **P2** a frame stayed (padded / bordered / coloured band) when its section rendered nothing (unresolved shelf, no live offers, failed fetch) | `[data-sd]:empty { display: none }` — the frame is a transparent wrapper whose emptiness is decided by what the section actually rendered; unit-tested (`childNodes.length === 0`) and asserted in both stylesheets. |
| **P2** text-only design on a light section still returned colours with nothing to judge them against | `effectiveText` now carries `judged`: the design background, else the surface the colours really land on — the section's own legacy surface (`banner`, `deliveryPromise` → white) or the page background; `worstTextRatio` uses it. (The dark surface-owners already ignored text-only colours.) |

| **P2** the "nested surface" matcher (`[class*="bg-store-"]`) also matched `bg-transparent hover:bg-store-footer-border`, restoring light-on-light tokens in the wholesale secondary CTA | A *surface* is now a class **token that starts with** `bg-store-` / `bg-white` and is opaque (`^=` / `*=" …"`, minus the alpha fills used in the codebase). Variants (`hover:bg-store-*`), `bg-transparent` and alpha fills (`bg-white/80`, `bg-store-surface/90`) are not surfaces. Unit-tested by evaluating the stylesheet's own selector against real class strings. |
| **P2** `border` design left the section's legacy border in place (two borders), and an explicit `none` emitted nothing | The design **owns** the border: any `border` group (including `none`) is emitted (`none` ⇒ 0 px transparent) and `[data-sd~="border"] > * { border: none }` removes the child's legacy border. Asserted in the browser (no designed root keeps a border) and unit-tested. |

| **P1** the block was *unlayered* in the storefront, where Tailwind v4 utilities live in `@layer utilities`: an unlayered rule outranks every layered utility regardless of specificity, so the zero-specificity `:where()` reset overrode `text-store-primary-foreground` on a designed banner's CTA (dark text on dark green) — invisible to the Canvas proof, whose utilities are unlayered | The whole block now lives **inside `@layer utilities`** (same layer as the utilities; inside it ordering is specificity, so a utility on the element beats the reset exactly as in the Canvas). **New proof on the real thing:** `cust-hv-v5c-storefront-cascade.spec.ts` compiles the actual storefront `globals.css` (Tailwind v4, native layers) and renders representative markup in Chromium; with the layer wrapper removed it reproduces the reviewer's failure (CTA text `rgb(17,24,39)` on dark green), with it the CTA keeps `rgb(255,255,255)`. |
| **P2** links over a design background kept `text-store-primary` ("View all" on a dark band) | Links default to the **proven foreground** when a background exists (explicit `link` still wins); the contract's `judged` rule is unchanged for explicit colours. |
| **P2** a transparent CTA that gains an opaque surface on hover (`hover:bg-store-footer-border`) rendered designed-foreground-on-dark | Elements that gain an opaque store surface on `:hover` / `:focus-visible` restore the original text tokens for that state (zero-specificity), and the section-link rule steps aside for them. Asserted in the real-stylesheet spec (black at rest, white on the dark hover fill). |

| **P1** the published path wrapped hero / categories / newArrivals / wholesale in an extra `<div>`, so `[data-sd] > *` cleared that empty wrapper instead of the section's own surface (the Canvas passes the root directly — a published-only divergence) | A *designed* built-in section is no longer wrapped (its frame is the wrapper); an undesigned one keeps its div byte-for-byte. The stack moved to `components/home/published-nodes.tsx` (a page file may export only a page) so it is unit-tested: the frame's only child is the section root; the undesigned output is unchanged. |
| **P1** `--store-primary-foreground-base` was captured on `:root`, but `publishedThemeStyle` overrides the foreground on the theme wrapper — a light primary colour then reset a nested CTA to the `:root` white | `presentationCssVars` emits the base **on the same element** as the themed value (both twins; tested). Asserted in Chromium: light primary `#f5e6a8` keeps `#111827` CTA text inside a designed section. |
| **P2** translucent nested fills (`bg-store-footer-border/40`) composite over an arbitrary design background, which the gate cannot see (black on the mid-tone composite ≈ 2.9:1) | Translucent store fills inside a designed section become their **opaque equivalents** (`--store-surface`, `--store-footer-border`, white) and count as surfaces, so their own original foreground is proven against a known fill. Asserted on `#757575` in the compiled storefront CSS. |

| **P2** `spacing.inner` added padding on the frame while the section's own padding stayed (so `none` removed nothing and a step doubled) | Inner spacing **replaces** it: the root takes the designed padding on every side and the padded content box directly inside (banner / hero `p-5 md:p-8…`) gives its own up. Asserted on the compiled storefront CSS (`none` ⇒ 0 px) and in the Canvas proof. |
| **P2** the hover-surface reset also fired on `:focus-visible`, though the components paint those fills on hover only (keyboard focus then lost the proven foreground) | Reset limited to `:hover`; asserted that keyboard focus keeps the designed foreground. |
| **P2** `design.align` (content *block* position) and `text.align` were folded into one `text-align` | Two independent outputs: `--sec-align` (copy) and `--sec-bms` / `--sec-bme` (block margins). Asserted: a centred block with start-aligned copy. |

| **P2** the inner-padding reset zeroed *every* padded grandchild (an accordion card lost its padding) | Reset limited to content boxes the components **mark** (`data-section-content` on the banner's and hero's inner box, storefront + Canvas); asserted: the accordion card keeps `16px`. |
| **P2** block alignment targeted only the full-width root, so a hero's `max-w-2xl` content never moved | The same marker is positioned too (root **and** marked content box); asserted on a hero fixture. |

| **P2** block alignment had no visible effect on a banner (its content row is full-width) | The marked content box shrinks to its content (`inline-size: fit-content`) before the auto margins position it. Asserted on the compiled storefront CSS: narrower than the section and centred (|left − right| < 2 px). |

| **P2** Canvas benefits cards had no surface class (transparent, section foreground) while the published `BenefitsBand` cards are `bg-store-surface` (white, original text) | Canvas cards now carry the same surface classes as `BenefitsBand` (`bg-store-surface px-4 py-4`) — one card treatment in preview and publish. |
| **P2** Canvas "View all" is a `span`, so the section link colour never reached it | `data-section-action` marks heading actions that are not anchors; the same rule colours them from `--sec-link` (both stylesheets). |
| **P2** benefits has no constrained block, so `align` had no visible effect | `data-section-block` marks a component whose *root* is the content block (benefits, storefront + Canvas); it shrink-wraps under `balign` and is positioned like the marked content boxes. Asserted on the compiled CSS (narrower than the frame, centred). |

| **P2** the hero CTA's focus ring (drawn in the primary-foreground token, restored to white for the button) was white-on-pale on a light designed background | `focus-visible:outline-store-primary-foreground` elements inside a designed section redraw the ring in the section's proven foreground; asserted on the compiled storefront CSS. |
| **P2** the Canvas rendered Market's multi-question content flat while the storefront renders accordion cards | The Canvas mirrors the accordion structure and surfaces (`awj-market`, ≥ 2 headings), so preview and publish agree. |

| **P2** other section-level focus rings (a category card's `outline-store-primary`) vanish on a designed background close to the primary colour | Generalised: **every** `focus-visible:outline-store-*` indicator that is not inside a nested surface is redrawn in the section's proven foreground (the ring is drawn outside the element, on the designed background). Asserted: a card link on a primary-coloured band gets a white ring. |

| **P2** a design that resolves to nothing (only default steps) still swapped the legacy `<div>` for a Fragment, changing the parent's flow | The wrapper is dropped only when `resolveSectionDesign` actually returns a frame; otherwise the legacy div is kept byte-for-byte (unit-tested). |
| **P2** the full-bleed `clip-path` on the frame clipped all descendant painting at its top/bottom edges (focus outlines of edge content) | The band is now drawn by a `::before` pseudo-element behind the content; the clip applies to the pseudo only. Asserted: frame `clip-path: none`, pseudo clipped, no page overflow. |

| **P2** a background painted on the square frame while the child's surface was cleared, so hero / banner / promo bands lost their `rounded-store` corners | The frame inherits the radius token when its direct child carries `rounded-store` (unless the design sets its own radius or bleeds); a shelf with no legacy corners stays square. Asserted on the compiled storefront CSS. |
| **P2** `overflow: clip` on a radius frame cut the offset focus outlines of links/buttons at its edges | the frame no longer clips anything: the radius rounds what it paints (fill, border, shadow) and the section root inherits it (`[data-sd~="radius"][data-sd] > * { border-radius: inherit }`); cascade spec asserts `overflow: visible` and matching radii |
| **P2** the legacy-corner fallback only ran for `bg`: a border-only / shadow-only frame around a rounded banner/hero/promo drew a square border/shadow | the fallback now applies to `bg`, `border` and `shadow` frames (not radius / bleed); cascade spec covers border-only, shadow-only and a square shelf |
| **P2** the Canvas's empty-banner placeholder kept its own `px-5 py-6` under designed inner spacing (the content-box marker existed only on the authored branch) | the placeholder carries `data-section-content` like the authored box, so `none` removes it and a step replaces it; jsdom test pins both branches |
| **P2** the published `BannerBand` / `HeroSection` / `BenefitsBand` emitted their design markers even with no design, breaking "absent design ⇒ byte-identical" | the markers are emitted only while a frame is active (`designed` prop; the hero is cloned with it by `published-nodes` when its design resolves to a frame); a unit test pins plain / designed / inert-design output |

The browser proof now also asserts, at all six widths in RTL and LTR, that **no designed section's root still paints its own fill** and that a heading colour reaches the Canvas heading; a mutation run (rule removed) fails it for banner / appPromo / deliveryPromise / shelf / discovery, so the check is not vacuous. The scenario gained `hero` and `wholesale` designs (the two dark surface-owners) and a distinct heading colour on benefits. 13/13 green.

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
| Real browser | `cust-hv-v5c-design-render-proof.spec.ts` **13/13** (Canvas) + `cust-hv-v5c-storefront-cascade.spec.ts` **13/13** (the real compiled storefront stylesheet — local evidence gate, as V3/V4b/V5a) |
| Backend | **no backend file changed** (`git diff origin/main` touches no `app/` `routes/` `database/` `tests/` `config/`); the full run on the identical backend is V5b's (5751 passed, 28 env-only failures) · PostgreSQL by CI |

Evidence: `docs/plans/store/cust-hv-v5c/*.jpg`.

## Limitations & deferred (stated, not hidden)

- **`width.mode = wide` renders as `contained`.** The page container is a fixed-width column; a "wider than the column" section needs the container restructured (V5d / V1B layout work). The V5d inspector will offer only the modes the renderer supports.
- **A gradient does not bleed.** Only a solid band can extend past the container without adding scrollable overflow; a full-width gradient waits for the same restructuring.
- **`typography` is accepted by the contract but not rendered** — scales and heading styles need integration inside each component; that is V5e.
- **Some gradients cannot be made readable.** V0 promised an automatic foreground for every *opaque colour*; for a *gradient* neither white nor black may reach 4.5:1 across its whole range (the documented `#d1456a → #1e8b9a` pair reaches ≈ 4.0 either way). The resolver still picks the better one and the V5d publish gate will **block** such a design — the fail-closed rule, not a bug.
- **A design background replaces the section's own surface** (hero gradient, banner card, dark promo bands); text colours on `hero`/`appPromo`/`wholesale` are not applied without one.
- **Canvas vs storefront parity** is structural (same resolver, same stylesheet block, test-enforced); I did not run the storefront in a browser against a live backend — the Canvas browser proof exercises the identical resolver and stylesheet.
- **`accentColor` is still not consumed by storefront chrome** (badges, highlights, link hover) — DEF-2 / V1B, with the inspector.

## Next dependency-safe slice

**V5d** — `ColourField` (role swatches, hex, recent colours, live contrast badge, "suggest foreground"), the Content / Design / Layout inspector for the declared groups, copy/paste style and reset design, the **PHP publish contrast gate** (client and server running the identical V5a algorithm over `effectiveText`), and the V1B items (768 editing surface, DEF-2 accent, DEF-6 delete confirmation, BL-4 Canvas width).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
