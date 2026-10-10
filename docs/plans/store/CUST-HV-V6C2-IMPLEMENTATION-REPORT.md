# CUST-HV V6c-2 — Banner CTA model — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-2** — second sub-slice of V6c (V6c-1 window ✔ → **V6c-2 CTA model** → V6c-3 placement grid + height presets → V6c-4 hero overlap + banner layout variants) |
| **Branch** | `cust-hv/v6c2-banner-cta` (from `main` after V6c-1 #1282) |
| **Authority** | V0 §8.2 (`ctas` ≤ 2 from day one; the legacy `ctaLabel/ctaHref` map to `ctas[0]`) |
| **Scope** | Additive optional key `content.ctas` on the Banner. No migration, no API route change, no gate change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

---

## What was built

| Layer | Change |
|---|---|
| **PHP authority** `StorefrontPresentationNormalizer` | Banner `content` gains `ctas` (≤ 2) **after `imageAlt`, before `window`**. One shared `normalizeCtaList()` now serves Hero and Banner (the Hero loop moved into it unchanged — its behaviour is pinned by a test). An authored button is content: it keeps an otherwise empty banner alive. |
| **Twins** (`web` + `storefront` `section-content.ts`) | Same shared `normalizeCtaList`, `MAX_BANNER_CTAS`, `BannerContent.ctas?`, and `bannerCtasOf(content)` — the *effective* buttons: `ctas` when authored, else the legacy pair as `ctas[0]`. |
| **Entry rules** (identical in all three) | label kept as written (the builder re-normalises on every keystroke, so trimming would swallow the space between two words; renderers trim) and code-point truncated to 80; link through `sanitizeContentHref` (`/path` or `https://`, never `javascript:` / `data:` / `//host` / `http:` / whitespace / quotes); a draft keeps a label without a link or the reverse; a wholly empty entry is dropped; non-objects skipped; a third entry is dropped; **`style` / `colour` / `icon` are not accepted yet** (below). |
| **Storefront** `BannerBand` | Renders the effective buttons; only a **complete** one (label + resolvable link) renders and an incomplete draft never borrows another's link. **One button keeps the legacy markup** (plus protective classes, below). **Two** sit in a wrapping row: a brand-primary solid first, an outline second in the **heading colour** (so it is legible on the section surface for exactly the reason the title is). The accessible-heading fallback uses the first label. |
| **Canvas** | Same decision and markup, `data-banner-cta` for tests. |
| **Merchant editor** | `CtaSlots` (two slots: label + a link edited locally and **committed on blur**, because the live normaliser empties a half-typed `https://…`) extracted from Hero and shared with Banner; the Banner's two plain inputs (which had that latent half-typed-link defect) are replaced. Editing writes `ctas` **and mirrors `ctas[0]` into the legacy pair**, so a reader that predates this slice still shows the first button. An empty slot is not stored; clearing slot 1 promotes slot 2. AR/EN hint added. |
| **Global button tokens (V5e-2b)** | The first button is the store's solid CTA (reached by class, as before). The second is marked `data-slot="button" data-variant="outline"` so the existing size / corner / weight / case rules reach it, and a store-wide "pill" setting does not leave it mismatched; its fill and colour stay its own. **No CSS change.** The guard test `global-buttons-selector` now reads every quoted class string (the second button's classes sit in a ternary) while still counting only strings that match the real selector — counts unchanged (Banner 2 / ProductCard 1 / QuickView 2). |

## A defect found and fixed on the way

An 80-character label sat in a fixed-height (`h-10`) `inline-flex` button with no truncation, so on phones the text wrapped and **spilled out of the button** — for the single legacy button too. Buttons now carry `max-w-full` and an inner `truncate` span. Proven in the real browser (below) with a negative control.

## Backward compatibility

| Case | Result |
|---|---|
| Banner with only `ctaLabel/ctaHref` | Same normalised output (no `ctas` key), same single button. |
| Authored single `ctas[0]` | Byte-identical HTML to the equivalent legacy banner (test). |
| Hero | Same normalised output for the same input (shared function; dedicated test in PHP and both twins). |
| Older reader of a new document | Ignores `ctas`, shows the mirrored first button. |
| An older writer saving a document that has `ctas` | Its normaliser drops the unknown key → the document is legacy-only again, consistent with the mirror. |

## Deliberately NOT in this slice
- **Per-CTA `style` / `colour` / `icon`** (V0 §8.2 lists them on `Cta`). They need the button-token integration and the shared contrast gate for a *per-button* colour, and icons belong with the icon registry (V7). Accepting the keys now would store values nothing renders or validates, so the normaliser drops them (a test pins it).
- No publish-gate change: like Hero, an incomplete draft is kept and simply not rendered.

## Design Quality Pass

Real Chromium over the **published** banner (production `publishedNodes` + `BannerBand`, the compiled storefront CSS), 6 configurations (legacy, two short, two 80-character, one 80-character, Arabic labels, with image) × 6 widths (390 · 430 · 768 · 1024 · 1280 · 1440) × AR RTL + EN LTR:

| | |
|---|---|
| Checks | **72** |
| Violations | **0** — no horizontal overflow; every button inside its section; every button ≥ 40 px tall; no label spilling out of its button |
| Worst CTA label contrast (painted colours) | **13.08 : 1** (≥ 4.5 required) |
| Long labels | ellipsised in 8 renders (the 80-character cases at 390–430 px) |
| **Negative control** | the same long-label pages with the protective classes stripped: **8 violations** ("label spills out of the button") — the measurement can fail |

Evidence: `docs/plans/store/cust-hv-v6c2/banner-cta-proof-summary.json`. Tooling is env-gated and inert in CI: `storefront/src/components/home/__tests__/banner-cta-proof.render.test.tsx` (`BANNER_CTA_PROOF_DIR`) + `storefront/scripts/banner-cta-proof/measure.mjs` (reuses `scripts/pixel-proof/build-css.mjs`).

Editor: two stacked fieldsets in the existing 320-wide inspector with the same fields Hero already uses (nothing new to learn); the link is a `dir="ltr"` deferred field; keyboard-native inputs only. The Canvas shows the same buttons the storefront does.

## Tests

| Suite | Result |
|---|---|
| Shared fixture `banner-ctas.json` (15 cases) | read by PHP, web and storefront tests — identical output **including key order**, idempotent |
| PHP `StorefrontPresentationBannerCtasTest` | passed (fixture, only banner/hero accept, Hero unchanged) |
| Storefront `published-nodes.banner-ctas` | legacy, authored-single = legacy bytes, two buttons, `ctas` wins over stale pair, incomplete draft skipped, trim, label-only banner, empty omitted, outline marker reached by the token selector |
| Web `ControlPanels.banner-ctas` | slots, legacy fills slot 1, `ctas` wins, mirror, second button, promote-on-clear, clear-all removes `ctas`, link deferred to blur, Hero still has two slots; Canvas renders |
| Storefront full | see PR |
| Web `store-experience-builder` + commerce/appearance + `src/lib` | see PR |
| Full `php artisan test` | see PR |

## Invariants
Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** (no endpoint, gate or persistence change; the new key rides the existing presentation document and its three normalisers). Links go through the same `sanitizeContentHref` as Hero and the legacy Banner link. No arbitrary CSS/JS/HTML: two bounded strings per button. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
