# CUST-HV V7b — Header colours behind a contrast gate — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7b** — second sub-slice of V7 (V7a header structure ✔ → **V7b header colours + contrast gate** → V7c `sticky: on-scroll-up` + overlay-on-hero → V7d navigation + icon registry → V7e footer). |
| **Branch** | `cust-hv/v7b-header-colours` (from `main` after V7a #1292) |
| **Authority** | V0 §9.1 (`surface`, `text`, `icon`) · §9.2 (text/icon colour from the resolver) · §9.4 / §4.5 (every colour pair is proven) · §2.2 (additive) |
| **Scope** | Three additive optional fields inside `header.design`: `surface.background`, `text`, `icon` (each a `ColorRef`: palette role or hex). No migration, no API route change, `PRESENTATION_CONFIG_VERSION` stays 3, no accounting effect. One new publish gate (`HeaderDesignContrast`). |

---

## AWJ Decision recorded here (what V0 left open — not a contract change)

| Question | Decision | Why |
|---|---|---|
| What does `surface.background` paint? | The `<header>` and its **identity row** (brand · search · actions). The utility strip and the category rail keep their theme surfaces. | Their text (region picker, category links) belongs to client components whose colours are the theme's; recolouring them would put text on a surface this proof does not cover. |
| What is the text colour over a designed background? | **Automatic**: the better of pure white / black over the solid background — proven by construction (≥ 4.58:1 for every colour). | Same rule as sections (`autoForeground`). |
| Secondary text (nav links, extra links)? | The text colour stepped 22 % toward the background, **only if** that still clears 4.5:1; otherwise the full text colour. | Keeps the existing "muted link" hierarchy without ever trading away legibility. |
| Explicit `text` / `icon`? | Judged at publish against what is really behind them: the designed background, else the default surface `#ffffff` plus a custom `palette.surface`. ≥ 4.5:1 for both text **and** icons (stricter than the 3:1 non-text bar, per V0 §9.4 "all colour pairs run §4.5"). | A merchant can still choose any colour; an unreadable one cannot be published. |
| Cart pill? | Keeps its own soft surface and brand text; neither a header text nor an icon colour reaches it. | Its pair (brand on soft brand tint) is the theme's own; a colour judged against the *header* would not describe it. |
| Focus ring inside the row? | Follows the text colour (`--ring`). | A brand-green ring on a dark green row would vanish. |
| Logo image? | Never recoloured (merchant artwork). Choosing a background the artwork disappears on is the merchant's call until V7c's `logo.treatment`. | No arbitrary image filters before the overlay slice can prove them. |

**Deferred, dropped fail-closed (fixture-pinned):** `surface.alpha` and gradients (V7c, with transparent / overlay-hero modes), `logo.treatment`, utility-strip / rail recolouring.

## What was built

- **PHP** `StorefrontHeaderDesignNormalizer` accepts `surface.background`, `text`, `icon` (reusing `StorefrontSectionDesignNormalizer::colorRef`; canonical order layout → … → logo → surface → text → icon → sticky → border → shadow). **`HeaderDesignContrast`** (issues/errors, paths `header.design.text` / `header.design.icon`) wired into `StorefrontPresentationPublishValidator::errors`.
- **TS twins** (web + storefront, byte-identical): `ColorRef` fields, `headerContrastIssues` (twin of the PHP gate), `resolveHeaderDesign(design, ctx)` → tokens `hbg htx hic` + validated `--hd-bg / --hd-fg / --hd-muted / --hd-icon` custom properties. Shared fixtures `header-design.json` (+ colour cases) and the new `header-contrast.json` pin PHP and both twins; ratios cross-checked.
- **Storefront**: `publishedThemeStyle` / `publishedThemeAttrs` carry the colours on the theme wrapper; `Header` marks the identity row (`data-header-row`) and brand (`data-header-brand`) **only when a design exists**; `globals.css` colour rules in the shared chrome block.
- **Canvas**: same wrapper vars/tokens on the Canvas root, same markers, the identical stylesheet block (parity-tested).
- **Editor**: three `ColourField`s (background, text, icon) in the Header panel — the automatic text colour is shown as the value, a failing explicit colour shows the ratio and a one-tap "use the automatic colour"; AR/EN.

## Backward compatibility

Absent colours ⇒ nothing is added: no `--hd-*`, no `hbg/htx/hic`, and — when there is no design at all — no new attribute in the markup (V7a's byte-identity tests still hold). Documents with V7a structure-only designs are unchanged.

## Design Quality Pass — real Chromium, the production `Header`

Extends the V7a proof to 26 designs (104 pages × 6 viewports, AR RTL / EN LTR, wordmark / image): **10 932 checks, 0 violations**. For every colour design: header and identity row paint the designed background; wordmark, menu, account icon and the cart icon take the proven (automatic or explicit) colours; secondary text equals the resolved `--hd-muted`; each clears 4.5:1 against the row; text-only / icon-only designs leave the background alone; the cart pill keeps its own colours (neither header text nor icon colour reaches it); colour designs compose with two-row, no border and soft shadow. Negative controls fail as they must: stylesheet stripped → 1 516 violations; absent design vs every design's expectations → 1 688. Evidence: `docs/plans/store/cust-hv-v7b/`.

## Tests

PHP `HeaderDesignContrastTest` (shared fixture, exact error paths, publish-validator rejection) + `StorefrontHeaderDesignTest` (extended fixture); storefront / web `header-design.test.ts` (contrast fixture, automatic colour proven ≥ 4.5:1 over a sweep of 52 backgrounds, muted-step rule, token composition), Canvas + editor tests (22), twin byte-identity, stylesheet parity.

## Limitations (stated)

- Logo artwork is not recoloured (see above); a logo that disappears on the chosen background is the merchant's to fix until V7c.
- The utility strip and the rail keep their theme surfaces under a coloured identity row.
- Hover states of ghost buttons use the theme's own muted surface and foreground (self-consistent), not the header colours.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched**. The new gate only *adds* publish rejections for an unreadable explicit header colour. No arbitrary CSS/JS/HTML: enumerated tokens and validated hex only. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
