# CUST-HV V6c-5 — Per-CTA button style (Hero & Banner) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-5** — fifth sub-slice of V6c (… V6c-4 overlap ✔ → **V6c-5 per-CTA style** → V6c-6 per-CTA colour + `soft` behind a region-contrast gate → layout variants) |
| **Branch** | `cust-hv/v6c5-hero-banner-layout` (from `main` after V6c-4 #1285) |
| **Authority** | V0 §6.1 ("a global default plus a **per-CTA override limited to `style` and `colour`**; label contrast follows §4.5") · §8.2 (`Cta { label, href, style?, colour?, icon? }`) · V6 owns "buttons" (Master Horizon) |
| **Scope** | One additive optional key on each CTA of a Hero or Banner: **`style`** (`solid` \| `outline` \| `link`). No migration, no API route change, no publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

---

## AWJ Decision recorded here (what V0 left open — not a contract change)

V0 §6.1 freezes *that* a CTA may override `style` and `colour`, but not what a style means on a Hero/Banner button, which sits on a **section** surface (brand gradient, solid, or a proven picture) rather than on the page. Two facts shaped the decision:

1. The hero's buttons are deliberately **not** global buttons (they are inverted on the brand gradient; a pinned test says "V6 owns it"); the banner's solid CTA is one. So there is no single "global look" for a per-CTA override to replace.
2. A colour/fill chosen by the merchant over a section background needs a **region contrast proof** (§4.5) — new gate code, in three languages — whereas a style that paints with colours the section **already proves** needs none.

So this slice delivers the part that is safe **by construction** and defers the part that needs a gate:

| Style | Hero look | Banner look | Why no new contrast surface |
|---|---|---|---|
| `solid` | the inverse fill (today's primary) | the brand fill (today's primary) | unchanged pairs the sections already ship |
| `outline` | the inverse outline (today's secondary) | the heading-colour outline (today's secondary) | border/label = the section's own foreground |
| `link` | text only, section foreground, underlined | text only, heading colour, underlined | label = the colour of the heading, proven against the same backdrop |

Absent `style` ⇒ **by position** (first `solid`, second `outline`), exactly what both sections always did. `soft` is **deliberately not accepted yet**: a translucent tint of the foreground over an arbitrary backdrop *lowers* the label's contrast, so it is not safe by construction — it ships with `colour` behind the region-proven gate (V6c-6). `colour` and `icon` are likewise dropped fail-closed until then (test-pinned).

## What was built

| Layer | Change |
|---|---|
| **Contract (PHP authority + 2 TS twins)** | `Cta.style?: 'solid'\|'outline'\|'link'`, kept in canonical order `label, href, style`; anything else (wrong case, non-string, `soft`, unknown) is dropped on its own and the button stays; a style alone is not a button (the empty CTA is dropped). Shared fixtures `banner-ctas.json` (+4 cases, 1 re-scoped) and `hero-content.json` (+2) read by PHP, web and storefront. |
| **Published renderers** | `HeroSection` and `BannerBand` pick the look by `style ?? position` and expose `data-cta-style`. The banner's first-button classes remain **one** string carrying the three classes the global button tokens address (the pinned selector test now counts 1 instead of 2 — the duplicate is gone); only the outline look is the shared Button's outline variant for those tokens, a text link is not a global button. A single default banner button is byte-identical to before. |
| **Canvas** | The same looks and attributes in the editor preview. |
| **Merchant UI** | One "Button style" select per CTA slot of Hero and Banner (Automatic / Filled / Outlined / Text link), disabled while the slot is empty (an empty slot is not stored, so a look chosen for it would vanish); Automatic removes the key rather than storing `undefined`. AR + EN copy. |

## Backward compatibility
Absent `style` ⇒ identical normalised output, identical classes and behaviour (the only DOM difference is the additive `data-cta-style` attribute). A pre-V6c-5 document renders as before; an older reader that ignores the key shows the positional look. The banner editor still mirrors `ctas[0]` label/href into the legacy pair.

## Design Quality Pass — real Chromium, the published hero (production `HeroSection`) and banner (`BannerBand`)

2 types × 2 surfaces (**default** · **proven picture background**) × 6 style combinations (automatic, explicit positional default, solid+solid, outline+outline, link+link, link+solid) × 2 directions = **48 pages**, each at 6 real device viewports (390×844 · 430×932 · 768×1024 · 1024×768 · 1280×800 · 1440×900):

| | |
|---|---|
| Checks | **288** page×viewport · **576** buttons · **48** absent-vs-explicit equality checks |
| Violations | **0** |
| Asserted | `link` and `outline` labels are exactly the section **heading's** computed colour (the colour the section proves against its own backdrop), so no new contrast surface · `solid`: opaque fill, label ≥ 4.5:1 over its own fill · `link`: underlined, no fill, **tap height kept** (hero 36 px / 44 px from md, banner 40 px) · `outline`: 2 px border · the two buttons never overlap and stay inside the section · no horizontal overflow · **absent style computes exactly like the explicit positional default** (colour, fill, border, decoration, padding, height, weight) |
| **Negative control** | a rule recolouring `link` buttons injected: **144 violations** — the measurement can fail |

Evidence: `docs/plans/store/cust-hv-v6c5/cta-style-proof-summary.json` and three screenshots (hero link+solid on a picture, LTR 1280; banner link+solid, RTL 390; hero outline+outline, LTR 1280). Tooling is env-gated and inert in CI: `storefront/src/components/home/__tests__/cta-style-proof.render.test.tsx` (`CTA_STYLE_PROOF_DIR`) + `storefront/scripts/cta-style-proof/measure.mjs`.

## Tests

| Suite | Result |
|---|---|
| `banner-ctas.json` / `hero-content.json` (PHP · web · storefront) | identical output incl. key order; every style kept; wrong-case / non-string / `soft` / unknown dropped; style alone is not a button; `colour`/`icon` still dropped |
| `HeroSection`, published banner | absent ⇒ by position; explicit wins per button; link drops the fill but keeps tap-height classes and the heading-family colour; only the outline look is a `data-slot="button"` outline; single default banner button's class string byte-identical |
| Global button selector pin | `BannerBand` now carries exactly 1 solid-CTA class string (the tokens still reach it) |
| `ControlPanels` | options; disabled while empty; writes onto that button only; legacy mirror untouched; Automatic removes the key; Hero has the same control; AR/EN copy |
| Canvas | hero and banner looks and attributes equal the storefront's |
| Storefront full | 1647 passed (+5 env-gated skipped) · `tsc` (tests included) and biome clean |
| Web `store-experience-builder` + commerce/appearance + `src/lib` | 1784 passed (no `tsc` error in the touched modules) |
| Full `php artisan test` | 5844 passed, 58 skipped, **28 failed — exactly the known container-only set** (26 `Fuel*` needing bcmath, `ResendMailTransportTest`, `UserInvitationTest`); CI runs them with the extensions |

## Limitations (stated)
- `soft`, `colour` and `icon` are not in this slice (see the decision above); a hand-built document carrying them is normalised to the same button without them.
- A merchant-chosen colour over a section background needs the region-proven gate — V6c-6.
- The banner's legacy `ctaLabel/ctaHref` pair has no style (only `ctas[]` does), by design: it means `ctas[0]` with the positional default.

## Invariants
Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the key rides the existing presentation document and its three normalizers; no endpoint, gate or persistence change. No arbitrary CSS/JS/HTML: an enumerated token mapped to fixed classes. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
