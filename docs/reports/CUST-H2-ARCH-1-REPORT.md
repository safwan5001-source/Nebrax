# CUST-H2-ARCH-1 — Multi-Page Visual Builder Evidence Pass + Architecture — Final Report

## Status

**ARCHITECTURE LOCK CANDIDATE — READY FOR MERGE — OWNER APPROVAL REQUIRED.**

Documentation-only task. No application code, database, API, or deployment change was made. Do not merge. Do not deploy. Do not production release.

---

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):** `0d6040b92b62212cb71a5dae86827fffcebe94a5` — confirmed identical to the SHA the task named as the known post-CUST-H1-closure main tip. **Main had not advanced.**
- **Head SHA:** this report's own commit, on the branch below, on top of the Base SHA (docs-only change).
- **Branch:** `docs/cust-h2-multipage-architecture`
- **PR:** opened against `main` from this branch (see end of this report). **Not merged.**

---

## Task Scope

CUST-H2-ARCH-1 is the architecture-entry slice for HORIZON CUST-H2 — Multi-Page Visual Builder (`docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §7). Explicitly evidence + architecture only: no Product-page or Category-page editing was implemented, no public runtime was changed, no presentation schema was changed in code, no migration was added, no API was changed. Two documents were produced:

1. `docs/plans/store/CUST-H2-MULTI-PAGE-EVIDENCE-UX.md`
2. `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`

---

## External Evidence Summary

**Salla** (help.salla.sa / docs.salla.dev): confirmed Salla separates Home/Product/Category/informational pages as distinct customizable surfaces, with a documented global-settings-vs-page-specific-settings split on the Product page (quick-purchase toggle called out as page-specific), and confirmed Twilight's theme-developer components are scoped to a page via a file-path convention (`home.custom-slider` → `src/views/components/home/`). Several Salla help-center fetches returned thin content (JS-rendered SPA); findings are graded by confidence in the evidence document rather than overstated.

**Shopify** (shopify.dev / help.shopify.com, directly fetched, high confidence): templates map one page type → one-or-more template files with alternate templates supported; the template selector sits in the toolbar, visually separate from Save/device switcher; global theme settings live behind a separate icon from template-specific settings; sections declare `enabled_on`/`disabled_on` restricting them to specific page templates, enforced by omission from the Add-section picker.

**AWJ decision:** Shopify's `enabled_on`/`disabled_on` model is the direct precedent for the Page Capability Registry's `allowedPageTypes`; Salla's global/page-specific settings split and AWJ's own pre-existing code comment (`VersionSelector.tsx:4-7`, already anticipating a future page selector) jointly ground the decision to keep the Page Navigator visually and semantically separate from the Version Selector.

Full citations and confidence grading are in the evidence document §2.

---

## Current AWJ Reality (verified by direct code inspection, not assumed from prior docs)

- `ExperienceBuilder.tsx`'s toolbar has **no page control today** — a static, non-functional `t("currentPage")` label sits exactly where a Page Navigator belongs, immediately before `VersionSelector`.
- `VersionSelector.tsx`'s own doc comment **already** states it is deliberately separate from any future page selector — CUST-H1 pre-disambiguated this before CUST-H2 was scoped.
- `StorefrontPresentationConfig` is 100% Homepage/chrome-shaped; there is no Product/Category namespace anywhere in the schema (TS or PHP twin).
- **The public Product and Category pages have zero presentation seam today** — fully hardcoded, fully real-data component trees (`ProductDetails.tsx`, `CategoryBanner.tsx` + `ProductListing.tsx`) with no import of the presentation system at all. This is the single largest finding: CUST-H2 introduces the *first* seam these pages have ever had, not an extension of an existing one.
- Persistence is **whole-document, Version-level**: one JSON `config` column, one `revision` per Version, no per-page column, no fragment save.
- **Confirmed, not invented, gap:** no authenticated Commerce-workspace (`commerce.manage`) product/category read endpoint exists. `CommerceProductController`/`CommerceCategoryController` exist but are wired only under the anonymous/mobile-token `commerce/v1` API (`routes/api_commerce.php`), a different auth chain than the Customizer's own workspace chain. This blocks only the future Preview-entity picker (CUST-H2-3/H2-4), not the schema/registry foundation (CUST-H2-1).
- Only `offers` is capability-**gated** on Home; `hero`/`categories`/`newArrivals`/`wholesale` are unconditionally implemented; `banner`/`benefits`/`customContent`/`featured`/`appPromo` are live-but-content-gated. (This corrects an over-broad reading in the task's own framing.)
- Test surface: extensive backend `StorefrontPresentation*Test.php` coverage; only one, unrelated Playwright spec exists for the whole Customizer (`store-brand-qa.spec.ts`); **no Playwright coverage exists for the Product or Category pages at all** today.

Full evidence with file:line citations is in the evidence document §3.

---

## Final Architecture Recommendation

**Additive namespace inside the existing Version document — zero new tables, zero new columns.**

`StorefrontPresentationConfig` gains one new optional top-level key, `pagePresentation?: { product?: ProductPagePresentation; category?: CategoryPagePresentation }`, each holding an ordered list of typed `PageRegionInstance` entries (`{ id, key, visible, content? }`) drawn from a closed, page-type-scoped `PAGE_REGION_REGISTRY`. `homepage` and every existing top-level field are untouched — the task's own illustrative `global:`/`pages.home` wrapper was evaluated and **not** adopted literally, because `pages` is already a taken key (informational/CMS pages) and wrapping every existing field would be pure breaking churn for zero merchant benefit. This asymmetry (Home stays at `homepage`, Product/Category live under the new `pagePresentation` key) is recorded explicitly as an honest cost, not hidden.

Full contract, including the Page Type Registry, the Page Capability Registry shape, and the complete Global vs Page-Specific classification matrix, is in the architecture document.

---

## Schema Decision

**No DB migration.** Schema bump `StorefrontPresentationNormalizer::VERSION` 2 → 3, additive-only. Every existing Version continues to normalize and render byte-identically with `pagePresentation` absent — nothing to backfill, because nothing existing changes shape. The existing forward-schema fail-closed rule (an H1 invariant) is reused unchanged to protect a v3-tagged Version from being read by v2-only code during a rolling deploy.

---

## Concurrency Decision

**Version-level revision remains the sole concurrency granularity.** Two sessions editing different pages of the same Version still share one `revision`; the second save gets the existing 409 stale-revision response — a deliberately coarse-but-safe conflict, reusing H1's already-tested behavior rather than adding a second, page-level concurrency axis with no evidenced merchant need. Rationale and the exact reasoning against page-level revisions are in the architecture document's Concurrency section.

---

## Product Page Region Map (summary — full table in the architecture document)

FIXED_REQUIRED: `media_gallery`, `identity`, `price`, `quantity_cta`. Conditionally FIXED_REQUIRED: `variant_selector` (only when the product has variants). OPTIONAL_TOGGLE, reorderable: `availability`, `description`, `custom_fields`, `sku_options_details`. **DEFERRED** (no data model exists): `specifications`, `related_products`, `trust_shipping_payment`.

## Category Page Region Map (summary — full table in the architecture document)

FIXED_REQUIRED: `breadcrumbs`, `identity_title`, `filter_sort_bar` (layout-configurable only; facet/sort logic never forked), `product_grid` (infinite-scroll pagination is commerce-authoritative, not a presentation choice in H2 V1). OPTIONAL_TOGGLE: `description`, `subcategories_rail`. **DEFERRED**: `category_banner_image` (no image field on the category resource), `promotional_content` (no such region exists today).

---

## Capability Gates Recorded

| Capability | State | Exact missing contract |
|---|---|---|
| `pagePresentation` schema/registry (CUST-H2-1) | Design complete, code not started | None — self-contained JSON/normalizer change |
| Page Navigator UI (CUST-H2-2) | Design complete, code not started | None |
| Preview Product/Category picker (CUST-H2-3/H2-4) | **GATED** | Authenticated Commerce-workspace product/category read endpoint (`commerce.manage`-scoped) — does not exist today; `CommerceProductController`/`CommerceCategoryController` exist but only under the mobile/anonymous `commerce/v1` auth chain |
| Public Product/Category runtime honoring `pagePresentation` (CUST-H2-5) | **DEFERRED** to that slice | Requires teaching `ProductDetails.tsx`/`CategoryBanner.tsx`/`ProductListing.tsx` to read region order/visibility — zero presentation seam exists on those files today |

---

## Proposed Implementation Slices

CUST-H2-1 (schema/registry foundation, no migration, no UI) → CUST-H2-2 (Page Navigator + page-aware Canvas shell, honest placeholders) → CUST-H2-3 (Product structured editing, blocked on the picker endpoint gap) → CUST-H2-4 (Category structured editing) → CUST-H2-5 (cross-page parity: closes the public-runtime chain) → CUST-H2 Horizon Closure. Each slice independently reviewable/testable per the roadmap's own Horizon lifecycle; none is authorized to start merely because this document exists.

---

## Tests / CI

No application code was changed; no new tests were required or added by this task. Existing CI (`ci.yml` PHP sqlite+pgsql, `web-ci.yml` Next.js build) runs against a documentation-only diff and is expected to pass without modification, since no source file under `app/`, `database/`, `web/src/`, or `storefront/src/` was touched.

---

## Risks

- The `pagePresentation`/`homepage` naming asymmetry (recorded explicitly above) could read as inconsistent to a future reader; it is a deliberate backward-compatibility trade-off, not an oversight, and is documented as such in the architecture document rather than smoothed over.
- The confirmed missing workspace catalog-read endpoint is a real dependency for CUST-H2-3/H2-4 and must be scoped as its own small backend task (or folded into CUST-H2-3's own slice) rather than discovered mid-implementation.
- Coarse Version-level concurrency across two simultaneously-edited pages is an accepted, not eliminated, risk — if real merchant usage later proves this a frequent pain point, a follow-up Horizon (not CUST-H2) would need to revisit it.
- Several Salla help-center fetches in this pass returned thin content due to client-side rendering; those specific claims are graded "Medium" confidence in the evidence document rather than presented as fully verified, consistent with the roadmap's own prior caution about unverified external sources (`design-system/foundations/numbering-reference.md`'s own precedent for flagging unverified external sourcing).

---

## Unresolved Decisions (for owner review, not silently assumed)

1. Whether the Preview-entity-picker's missing workspace endpoint should be built as its own micro-slice before CUST-H2-3, or folded into CUST-H2-3 itself.
2. Whether `variant_selector`'s "conditionally FIXED_REQUIRED" treatment needs a distinct capability-state value beyond the four the roadmap specifies (LIVE/DESIGN_ONLY/GATED/DEFERRED) — this document treats it as LIVE with a data-dependent existence rule inside the FIXED_REQUIRED/CONFIGURABLE requirement axis, not a fifth state, but flags the nuance for owner confirmation.
3. Whether CUST-H2-5's public-runtime wiring should ship as one slice per the current proposal, or be split further once CUST-H2-3/H2-4's actual region editing UX is seen in review.

---

## Next Step

Owner review of both documents and this report. If approved, CUST-H2-1 (schema/registry foundation) may be scoped as its own implementation task, following this architecture's Implementation Slicing section. No implementation begins from this task alone.

---

# CUST-H2-ARCH-1 READY FOR MERGE — OWNER APPROVAL REQUIRED.

Per this task's own explicit gate: **DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.** This report and its PR are documentation only.
