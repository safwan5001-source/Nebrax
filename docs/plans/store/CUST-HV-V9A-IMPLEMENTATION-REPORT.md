# CUST-HV V9a — Category page `cover` region — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9a** — first V9 slice (category `cover` → benefits → content blocks → cards/rails → product zoom). |
| **Branch** | `cust-hv/v9a-category-cover` (from `main` after V8f) |
| **Authority** | V0 §14.2 (DEF-3b, optional category cover) · §2.2 (additive, three normalizers in lock-step) · commerce firewall (a region toggle cannot change commerce truth) |
| **Scope** | One new optional region key on the **category** page. No endpoint, schema, migration, Publish rule or accounting change; `PRESENTATION_CONFIG_VERSION` stays 3. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Source of the picture | The category's **own** image (`category.image`, already served by the storefront read model). The region has no media field of its own. | A second picture would be a second source of truth; nothing is invented when the category has none. |
| Default | **Hidden.** An existing store (no stored `cover`) renders exactly as today; the merchant opts in. | Backward compatibility; CLAUDE.md rule 6 (protective default). |
| Position | Canonical order: `breadcrumbs → cover → identity_title → …`. A stored list that predates `cover` is completed with it (hidden) at that position — in the editor in memory only, written to the Draft by an actual edit; the storefront's fail-safe merge does the same. | A missing key never changes what the page shows. |
| Fixed-required | `cover` is **not** fixed-required: its authored `visible` is kept (PHP authority + both twins). | It is optional by definition. |
| Rendering | `category.image.url` only → 16:5 banner (`aspect-[16/5]`, `object-cover`, 1600×500, `priority`), alt = the image's alt, else the category name. No image → nothing drawn, even when "shown". | Never fabricates; LCP + reserved space (no layout shift). |
| Canvas | The workspace category read model does not expose `image`, so the Canvas draws a dashed 16:5 note shell (`data-category-preview-cover`) saying the live picture is the category's own. | Honest preview without a backend change (deferred, stated). |
| Editor | A normal toggle in the category regions inspector (`regionCover`, AR/EN), dependency `category.image`, fallback "omit". | Existing region-capability machinery; no new control. |

## What was built

- PHP `StorefrontPresentationNormalizer::CATEGORY_PAGE_REGION_KEYS` (+`cover`).
- Storefront + web twins: `page-regions.ts` (`cover`, `CATEGORY_REGIONS_DEFAULT_HIDDEN`, default list hidden, web `completeCategoryRegions`), storefront `page-runtime.ts` (fail-safe merge honours the hidden-by-default set), `CategoryBanner.tsx` (cover node; prop type accepts the SDK `Category` with an optional `image`).
- Web: registry capability, inspector label, Canvas note shell, ExperienceBuilder completes the stored list, strings.

## Backward compatibility

A store with no `cover` stored or published renders byte-identically (the region defaults to hidden everywhere: PHP passes unknown-order lists through unchanged, the storefront merge appends hidden, the editor completes hidden). Older Published versions are never rewritten.

## Tests

- Storefront: `CategoryBanner.test.tsx` +5 (off by default; between breadcrumbs and title when shown; alt falls back to the category name; nothing without a picture; nothing when hidden), `page-runtime.test.ts` (fallback default, stored docs predating / including cover, missing-required fallback keeps cover hidden). Storefront `tsc` clean, vitest 1056 passed.
- Web: `page-presentation.test.ts` +4 (key order, not fixed-required, hidden default, authored visibility kept, completion of an older stored list, no touch when present); store-experience-builder suite 98 files / 1819 tests green.
- PHP: `StorefrontPresentationNormalizerTest::category_cover_is_an_optional_region_that_keeps_its_authored_visibility`; the whole `StorefrontPresentation*` family (272 tests) green.

## Design Quality Pass

The only visual surface is the banner: a full-width 16:5 image inside the category header — the frame reserves its size before the picture loads, `object-cover` fills it at every width, and it inherits the page's logical (RTL-neutral) layout; no text sits over it, so no contrast verdict applies. The Canvas shell is a plain dashed box with a note (semantic tokens, wraps at 390).

## Limitations (stated)

- The Canvas does not show the real category picture (the workspace category API lacks `image`); a backend change was deliberately not made in a presentation slice.
- One framing (16:5, cover). Per-category focal point / other ratios are not part of the contract.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched — the region stores only a boolean, the picture is the tenant's own category image already served. Commerce firewall: the region toggles an image; it sets nothing about prices, offers, stock or tax. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
