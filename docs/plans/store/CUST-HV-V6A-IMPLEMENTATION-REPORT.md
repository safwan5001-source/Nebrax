# CUST-HV V6a — Per-instance Hero (content, buttons, one `<h1>`) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6a** — first part of V6 (V6a per-instance hero → V6b hero media / overlay / mobile art direction / region-luminance contrast → V6c banner window, CTAs, placement, height, overlap, layout variants) |
| **Branch** | `cust-hv/v6a-hero-instance` (from `main` after V5e) |
| **Authority** | V0 D-14 · §8.1 (per-instance hero; invariants 1–5) · §8.2 (`HeroContent`, `Cta`, ≤ 2 CTAs) · §2.2 (additive, three normalizers in lock-step) |
| **Depends on** | V5 (design contract), V5e-2b (global buttons — a hero CTA is not a "primary button", it is inverted on the brand gradient and stays outside those tokens) |

---

## Implemented

### Contract (PHP authority + web twin + storefront twin, one shared fixture)
Additive and optional; a hero without `content` is byte-identical to today; version stays 3.

```ts
section.content (type "hero") = {
  headline: string;            // ≤ 120 code points
  subheadline?: string;        // ≤ 200 code points
  ctas?: { label: string; href: string }[];   // ≤ 2; label ≤ 80; href = sanitizeContentHref (store path "/…" or https)
}
```

| Rule | Behaviour |
|---|---|
| **Absent vs empty** | no `content` ⇒ the instance reads the legacy `homepage.heroHeadline/heroSubheadline` (V0 §8.1.4). `{ "headline": "" }` is **explicit empty content**: the store name + the default CTA. Whitespace alone collapses to `""`; a non-object, or an object that says nothing, is *absent*. |
| **Text is kept as written** | The builder re-normalizes the whole config on **every keystroke**, so trimming in the normalizer would swallow the space typed between two words (the reason banner alt text needs a deferred field). Headline / supporting line / button text are therefore only code-point truncated; every renderer trims. |
| **Drafts survive** | A button with a label but no link (or the reverse) is kept as a draft and only a *complete* button renders; a wholly empty one is dropped and does not use a slot. An unsafe `href` (`javascript:`, `//host`, whitespace, `http:`) is emptied on its own — the label stays. |
| **Bounded** | `MAX_HERO_INSTANCES = 3`; instances beyond the third are dropped in order by all three normalizers (the V0 bound was UI-only before, so an API client could exceed it). Zero heroes is allowed (v2+: absence is deletion). |
| **Defaults** | The default document still has exactly one visible hero without `content` (V0 §8.1.5). |

Shared fixture `tests/Fixtures/presentation/hero-content.json` (19 cases: canonical key order, empty vs absent, caps, drafts, unsafe hrefs, code-point truncation incl. astral emoji, trailing space survives, non-object inputs) — read by PHP `StorefrontPresentationHeroContentTest` and by both TS `section-content.hero.test.ts`. Each twin also asserts idempotence and the 3-hero cap.

### Storefront rendering
- `publishedNodes` takes an optional `renderHero`, so a hero is **instance-keyed** (every other built-in already was). Without it a hero stays the shared type-keyed node — callers that do not opt in are untouched. The wrapper rules are the existing ones: an undesigned hero keeps its legacy `<div>`; a designed hero is wrapped by its `SectionDesignFrame` alone.
- **Exactly one `<h1>`** (V0 §8.1.3): the *first visible* hero renders `<h1>`, further heroes `<h2>`; each has its own heading id (`home-hero` for the first/legacy one, `home-hero-<id>` otherwise) and `aria-labelledby` follows. With **no visible hero** the page now renders a visually-hidden `<h1>` naming the store (placed last in the stack so its box never alters the vertical rhythm) — before this slice a document with no visible hero had no `<h1>` at all.
- `HeroSection`: `ctas`, `headingId`, `headingLevel`. With no complete button the one default "Shop now" CTA renders exactly as before (same markup, same classes). Authored buttons: the first keeps the default CTA's look, the second is the quieter outline companion; both resolve through the shared `destination()` (extracted from `BannerBand` so Banner and Hero cannot disagree). Buttons whose destination cannot be resolved fall back to the default CTA.

### Merchant Canvas
The same behaviour in the preview: per-instance content, first visible hero `<h1>` / others `<h2>`, hidden store `<h1>` when none, complete buttons only. **Pre-existing Canvas defect fixed on the way:** the merchant app's Tailwind theme has no `primary-500/600/700` scale, so the hero's gradient stops were never assembled and the Canvas hero rendered **white text on the page background** (on `main` today). The preview stylesheet now composes the gradient explicitly, in the reading direction (`to left` under RTL), as the storefront does.

### Merchant editor
- Hero capability: `canDelete: true`, `canDuplicate: true`, `maxInstances: 3`. `canDuplicateSection` now also honours `maxInstances` (it ignored it — Duplicate would have made a 4th hero).
- New `HeroFields` (selected hero): headline, supporting line, two button slots (text + link). A hero with no `content` shows the legacy text as its starting values; **the first edit writes explicit content and the instance stops reading the globals** (the globals are never rewritten).
- Adding a hero from the Library starts it with `{ headline: "" }` (store name + default CTA), never the legacy text. Duplicating a hero that still reads the globals makes that text explicit on the copy.
- Delete asks first only once a hero *says something* (an explicit-empty hero is removed immediately).
- The global "hero content" section is removed from the nothing-selected state: with per-instance content the globals are legacy-only.

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontPresentationHeroContentTest` (shared 19-case fixture incl. key order + idempotence; only a hero accepts hero content; 5 heroes → 3 in order; zero heroes; legacy globals untouched; default doc has one content-less visible hero) · `StorefrontPresentationNormalizerTest` unchanged and green |
| Twins | the same fixture ×2 + idempotence + cap + `heroContentOf` never mistakes another content shape for a hero's |
| Storefront | `HeroSection` (4 new: legacy markup byte-identical incl. one `<h1 id=home-hero>`; `<h2>` + own id; authored CTAs primary/secondary with prefixed hrefs; unresolvable CTAs fall back) · `published-nodes` (4 new: per-instance rendering, first visible = `<h1>`; wrapper rules; opt-out path unchanged; `hasVisibleHero`) |
| Merchant | capabilities (hero bounded 3, add up to 3, duplicate respects the bound) · `ControlPanels.hero` (8: legacy prefill, first-edit copy, per-instance isolation, two buttons + drafts, explicit-empty, add, duplicate, delete confirm) · `StorefrontPreviewCanvas.hero` (5) · the 12 tests that encoded the old "hero is a non-deletable singleton" contract were updated to the new one |
| Real browser — Canvas (`cust-hv-v6a-hero.spec.ts`, 13: AR/EN × 390 · 430 · 768 · 1024 · 1280 · 1440 + hidden-hero page) | one `<h1>` + one `<h2>`; no horizontal overflow; the two buttons keep reading order (primary first; right-to-left under RTL) and wrap above one another on a narrow screen instead of overflowing; neither is clipped by its hero; the explicit-empty second hero shows the store name and the default CTA |
| Full suites (local) | PHP: 5794 passed, 28 failed — all the known container-only suites (Fuel* need bcmath; Resend mail transport; user-invitation mail views), none touched by this slice · storefront 1474 · web 3906 (437 files) · biome + tsc clean |
| Regression (Chromium) | V5e-3 separators 7/7 · V5e-2b buttons 10/10 (a hero CTA is still outside the global button tokens) |

## Design Quality Pass
Evidence `docs/plans/store/cust-hv-v6a/` (EN/AR × 390 and 1280). Checked: the gradient now paints in both directions; heading, supporting line and both buttons read clearly on it; the primary button sits at the reading start in RTL; at 390 the buttons stay on one row (they wrap, not shrink, when the labels are longer); the second hero's store name + default CTA keep the same rhythm as the first; no overflow at any of six widths. **Not claimed here:** contrast of text over a *media* background — there is no hero media yet (V6b owns the region-luminance proof); the brand gradient behind hero text is unchanged from today.

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation / RBAC / Draft-Published / revision concurrency | Untouched — validated additive content in the existing section document |
| Backward compatibility | A hero without `content` renders from the legacy globals with today's exact markup and heading id; absent content ⇒ no key; version stays 3; the globals are never rewritten |
| Accessibility | exactly one `<h1>` per home page (hidden store heading when no hero); unique heading ids and `aria-labelledby` per instance; buttons are real links; focus styles unchanged |
| Security | hero hrefs use the same `sanitizeContentHref` as Banner CTAs (store path or https only; `javascript:`/`data:`/`//host` rejected); no HTML or CSS reaches the page from the content |
| Commerce / accounting | Untouched |

## Limitations / next
- **V6b** — hero media (default + mobile), overlay, content placement grid, height presets, layout variants, and the contrast proof against the *rendered region* (not a whole-image average). `Cta.style` / `Cta.colour` / `Cta.icon` are not accepted yet: per-CTA overrides (style + colour) belong with the button-token integration in V6b/V6c, icons with the registry (V7).
- **V6c** — Banner window (D-15), CTAs, placement, overlap presets.
- The legacy dev-only customizer copy under `storefront/src/components/customizer/` is intentionally left alone.
- There is no page-level test of `page.tsx`; the hidden-`<h1>` condition is the exported, unit-tested `hasVisibleHero`.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
