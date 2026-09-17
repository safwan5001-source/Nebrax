# STORE-UI-1 — Final Implementation Report

**Task:** `STORE-UI-1 — Storefront Shell`
**Date:** 2026-09-17
**Repository:** safwan5001-source/Nebrax
**Authorities:** `docs/plans/store/AWJ_STOREFRONT_RESPONSIVE_BASELINE_V1.md` (LOCKED),
`docs/plans/store/AWJ_STOREFRONT_DESIGN_SYSTEM.md`

---

## 1. Status

**Completed** — implemented, validated, pushed, PR open and unmerged.

Not merged. Not deployed. Auto-merge not enabled. Waiting on product-owner
visual review.

---

## 2. Repository state

- **Branch:** `claude/store-ui-1-shell-9meluy`
  The suggested `feat/store-ui-1-storefront-shell` was not used: this session is
  bound to the branch above and pushing elsewhere is not permitted.
- **PR:** https://github.com/safwan5001-source/Nebrax/pull/855
- **Base SHA:** `0beee2374396c338e5a211b0fddbe87b989be6bd`
  Verified as the current `main` after `git fetch origin main`, and identical to
  PR #854's merge SHA.
- **Head SHA:** `35d7aeb80318ea847124c07b02018c030e251d5f`
- **Diff:** 22 files, +1036 / −343, confined to `storefront/`.

---

## 3. Existing architecture reused

Nothing was rebuilt from the Stitch prototype. The existing `storefront/`
Next.js app and its AWJ commerce seams are the foundation.

| Seam | How it was used |
| --- | --- |
| `(storefront)/layout.tsx` | Its request-cached `getRootCategories`, its `connection()` deferral and its Suspense boundaries are kept verbatim. The shell renders the categories the layout already fetched — one fetch, one taxonomy, no second catalogue. |
| `Header`, `Footer`, `CartButton`, `MobileMenu`, `RegionPreferences`, `DocumentShell` | Adapted in place rather than replaced. |
| `SearchToggle.tsx` | Renamed to `StoreSearch.tsx`; git records it as a rename. It was imported only by `Header`. |
| `SearchBar`, `CartContext`, `POLICY_LINKS`, `isWholesaleEnabled`, `localeDirection` | Consumed unchanged. |
| `next-intl`, `next-themes`, `next/font/google`, Tailwind v4, shadcn-style UI | Existing stack; no dependency added or upgraded. |

Category data still comes from `getCategories` → `fetchCategories` →
`storefrontFetch("categories")`, i.e. the AWJ `store/v1` catalogue. The shell
narrows each category to `{ id, name, permalink }` for rendering and adds
nothing to it.

---

## 4. Implementation

### 4.1 Store Theme Token foundation

A semantic `--store-*` layer in `globals.css` is the single presentation seam a
later Store Customizer can override without touching a component:

- **Surfaces / text:** `background`, `surface`, `surface-muted`, `foreground`,
  `muted`, `muted-foreground`, `border`, `border-strong`.
- **Primary:** an 11-step AWJ Modern green ramp plus `primary`,
  `primary-hover`, `primary-foreground`, `primary-soft`.
- **Status:** `destructive`, `success`, `warning`.
- **Shell metrics:** `content-max`, `radius`, `header-height`,
  `header-height-lg`, `nav-height`, `bottom-nav-height`, `focus-ring`.

These are exposed as Tailwind utilities (`bg-store-surface`,
`text-store-muted-foreground`, `max-w-store`, `h-store-nav`, …), and the
existing shadcn aliases (`--primary`, `--background`, `--border`, `--ring`,
`--radius`) plus the `primary-50..950` ramp now resolve to them.

`--store-radius` keeps the repository's existing `0.625rem`, so no component's
corner radius changes.

### 4.2 Header

Sticky banner whose composition changes twice rather than once:

- **< md:** 56px identity row (menu, brand, cart) + a dedicated full-width
  search row; categories live in the drawer.
- **≥ md:** search moves inline into the row (72px), the category rail appears,
  the account action surfaces.
- **≥ lg:** the drawer retires; region and wholesale controls surface in the row.

Adds a skip link to `#main-content`.

### 4.3 Category navigation

`CategoryNav` replaces the previous `sr-only` list with the visible rail:

- Built from the same authoritative categories; renders "All products" plus the
  root categories.
- Pages horizontally when the categories overrun the width. Controls appear only
  on measured overflow, via a `ResizeObserver` that also observes the items so
  the Arabic webfont swap re-triggers the measurement.
- Marks the open category, including when a child permalink is active.
- No categories → no rail, instead of an empty strip.

### 4.4 Mobile bottom navigation

`MobileBottomNav` — Home / Products / Cart / Account, every one an existing
storefront route. Cart badge withheld until hydration. `safe-area-inset-bottom`
padding, plus a spacer element in the layout so no page content sits beneath it.

**No wishlist entry:** the storefront has no wishlist persistence, and a dead
tab would imply a capability the platform does not have.

### 4.5 Shared content container

`StoreContainer` encodes the storefront's one measure
(`max-w-store px-4 sm:px-6 lg:px-8`) and is used by every shell region — header
rows, rail, footer — so brand, search, first category and first footer column
share one vertical line. The 27 existing page-level `container mx-auto` usages
were deliberately left alone as out-of-scope churn; `--store-content-max` is set
to `80rem`, which matches their current effective bound.

### 4.6 Footer

Recomposed onto the store surface: three balanced link columns with labelled
`nav` landmarks, and a bottom identity bar. Category links capped at
`FOOTER_CATEGORY_LIMIT = 6`.

It still carries only real navigation. No service promises, payment marks,
social accounts, contact details, guarantees or regulatory badges were added.

### 4.7 RTL / LTR

Logical properties throughout (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`).
The cart badge moved from a physical `right-0` to `end-0`. Paging chevrons
follow reading direction. The merchant name is isolated with `<bdi>` in the
header and footer so an Arabic store name inside an English page — and the
reverse — keeps its surrounding characters in page order.

### 4.8 Typography

Tajawal is declared alongside Geist on every document. Arabic is the
storefront's default locale and Geist ships no Arabic glyphs, so the primary
language was rendering in whatever face the device happened to have. One font
stack serves both scripts because the browser resolves per character.

Tajawal is the approved AWJ Store default face
(`AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md` §5) and arrives through the existing
`next/font/google` seam — **no new package**.

### 4.9 Accessibility

Skip link, labelled `nav` landmarks, `aria-current="page"` on the active
bottom-nav item, accessible names on every icon-only action and on the paging
controls, `outline-offset` added to the global focus ring, and reduced-motion
handling on the rail's smooth scrolling.

---

## 5. Design decisions

**Aliasing `--primary` to the store token rather than scattering green.**
The instruction forbids spreading the prototype's green through components. The
alternative to aliasing was green shell chrome sitting on a neutral catalogue —
two palettes, and in `CheckoutPageContent` a literally green button with a blue
`hover:bg-primary-700`. Pointing the existing aliases and the ramp at one token
gives the whole surface a single source of truth with zero component churn, and
leaves the Customizer one property to override.

**The whole banner sticks, not an inner row.**
The first build made only the identity row sticky so search and the rail would
scroll away. Visual QA showed it vanishing on the first scroll: a sticky element
can only travel inside its parent's box, and the parent was only as tall as the
header. Full-sticky is the correct behaviour and it keeps search, cart and menu
permanently reachable — 56px of pinned chrome on a phone, where the bottom
navigation carries the rest.

**Search is a live field, not a toggle.**
The previous header hid search behind an icon and an animated overlay. A field
present in both placements is materially stronger discovery for a commerce
shell, and removing the overlay also removed its transition and focus-management
code. Net simplification, not added surface.

**A paging rail, not a mega-menu.**
Subcategory data is already fetched, so a hover mega-menu was available — and
declined. It is a navigation capability, not shell infrastructure, and it brings
real keyboard and screen-reader obligations. Subcategories stay in the drawer
and on the category pages. When uncertain, simplify.

**Footer category cap.**
With twelve root categories the Shop column became a 13-item sitemap three times
the height of its neighbours, on both mobile and desktop. Six keeps the footer
balanced; the full tree stays one tap away behind "All products", the rail and
the menu.

**No letter-spacing on translatable strings.**
`tracking-tight` / `tracking-wide` break Arabic's connected script. The brand
wordmark and every footer heading avoid them and build hierarchy from size,
weight and colour instead.

**Restraint check.** No gradients beyond the two functional edge fades on the
rail, no glassmorphism, no decorative blur, no shadows beyond the skip-link
chip, no pills, no badges that are not real counts, no invented metrics or trust
indicators, no card-in-card, no decorative animation.

---

## 6. Files changed

| File | Purpose |
| --- | --- |
| `storefront/src/app/globals.css` | `--store-*` token layer; shadcn aliases repointed; AWJ Modern green ramp; dual-script font stack; `store-rail` utility; focus `outline-offset` |
| `storefront/src/components/layout/StoreContainer.tsx` | **new** — shared content measure |
| `storefront/src/components/layout/Header.tsx` | recomposed responsive header; skip link; `<bdi>` brand |
| `storefront/src/components/layout/CategoryNav.tsx` | **new** — real category rail with RTL-aware overflow paging and active state |
| `storefront/src/components/layout/MobileBottomNav.tsx` | **new** — primary mobile navigation over existing routes |
| `storefront/src/components/layout/StoreSearch.tsx` | renamed from `SearchToggle.tsx`; live lazy-loaded search field for both placements |
| `storefront/src/components/layout/Footer.tsx` | recomposed footer; labelled columns; category cap; `<bdi>` identity |
| `storefront/src/components/layout/CartButton.tsx` | badge uses store tokens and a logical `end-0` placement |
| `storefront/src/components/layout/MobileMenu.tsx` | drawer offsets read `--store-header-height` instead of a hard-coded `top-16` |
| `storefront/src/components/layout/DocumentShell.tsx` | Tajawal font variable on every document |
| `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx` | wires the rail into the header slot, `#main-content`, the bottom nav and its spacer |
| `storefront/src/app/[country]/[locale]/(storefront)/layout.test.tsx` | updated for the new shell structure |
| `storefront/src/components/layout/DocumentShell.test.tsx` | updated; asserts both faces are declared on every locale |
| `storefront/src/components/layout/__tests__/CategoryNav.test.tsx` | **new** |
| `storefront/src/components/layout/__tests__/MobileBottomNav.test.tsx` | **new** |
| `storefront/messages/{ar,de,en,es,fr,pl}.json` | 7 shell keys added; 2 dead search-overlay keys removed |

---

## 7. Responsive QA

Method: Chromium, real render of the running storefront against a local AWJ
`store/v1` stub carrying 12 root categories with long Arabic names, so the rail
genuinely overflows. Header, category navigation, content container, bottom
navigation and footer inspected at the top and bottom of the page at every
width, in both directions.

`document.scrollWidth === document.clientWidth` at **all ten** width × direction
combinations — no unintended horizontal scrolling anywhere.

| Width | Result |
| --- | --- |
| **390** | 56px identity row + search row; bottom navigation present with legible labels and no clipping; page content clears the fixed bar; footer balanced and readable. |
| **768** | Search inline, category rail appears, drawer still available for the full tree; bottom navigation correctly absent; actions not cramped. |
| **1024** | Search fills the middle of the bar; rail shows its end paging control; active category underline correct. |
| **1280** | Brand / search / actions in disciplined proportion; rail overflows into the paging control as designed. |
| **1440** | Content bounded at the 1280px measure; no oversized empty margins; header reads as navigation infrastructure, not a marketing band. |

Also verified: sticky behaviour after scrolling (390 and 1280), skip-link focus
chip, drawer offset sitting under the identity row, rail paged to its end in
RTL, and bottom-navigation clearance at the end of the page.

**Four issues were found during QA and fixed before the PR was opened:**

1. A doubled 2px border seam between the identity row and the category rail.
2. An under-filled desktop search field leaving an awkward gap before the actions.
3. A lopsided 13-item footer column.
4. A sticky row that did not stick, because its parent box was only as tall as
   the header.

---

## 8. RTL / LTR QA

- **Arabic RTL:** drawer opens from the start edge; chevrons point in reading
  order; the rail pages towards negative `scrollLeft`; the cart badge sits on
  the correct side; footer and bottom navigation mirror correctly;
  `© 2026 <name>` resolves in page order — verified by measuring element box
  positions, not by eye.
- **English LTR:** the same shell mirrored. Arabic category names inside the
  English page render in Tajawal and disturb neither the surrounding Latin text
  nor the copyright line.

---

## 9. Tests

| Command | Result |
| --- | --- |
| `pnpm vitest run "src/app/[country]/[locale]/(storefront)/layout.test.tsx"` | 2 passed |
| `pnpm vitest run src/components/layout/__tests__/CategoryNav.test.tsx` | 4 passed |
| `pnpm vitest run src/components/layout/__tests__/MobileBottomNav.test.tsx` | 4 passed |
| `pnpm vitest run src/components/layout/DocumentShell.test.tsx` | 5 passed |
| `pnpm test` (full suite) | **54 files, 423 tests, all passed** |
| `pnpm check` (Biome lint + format) | clean, 0 warnings |
| `pnpm check:locales` | all locales in sync with `en.json` |
| `npx tsc --noEmit` | clean |

**Baseline before any change on this branch:** 52 files, 413 passed. So the
branch adds 2 files and 10 tests and breaks nothing. There were **no
pre-existing failures** — the suite was green before the work started and is
green now.

New coverage: the rail links only to supplied categories and to nothing else; it
marks the open category including a child permalink; it hides its paging
controls when nothing overflows; it pages towards negative `scrollLeft` in RTL.
The bottom navigation offers only routed destinations and no wishlist, marks the
current surface without falsely marking Home, shows the cart count after
hydration, and clears the safe-area inset. The document declares the Arabic face
on every locale, not only on Arabic routes.

**No existing test was weakened, skipped or removed.** The two modified test
files were updated because the shell they assert on changed shape.

---

## 10. Build

`pnpm build` — **succeeds**, including the build-time fetch of the added font.

The prerender log lines reading `AWJ_COMMERCE_API_URL is not configured` are the
expected no-backend path in this environment and are present on the baseline
build too; the build exits 0 and generates all 63 static pages.

---

## 11. CI

On head `35d7aeb`:

| Check | State |
| --- | --- |
| `storefront (lint + typecheck + test)` | ✅ success (both triggered runs) |
| `php artisan test (L11, sqlite)` | in progress at time of writing |
| `php artisan test (L11, pgsql)` | in progress at time of writing |

No merge conflict — the head is based on the current `main`. No review threads.
`mergeable_state: unstable` reflects the still-running backend jobs, not a
conflict.

The backend suites are expected green: this diff touches nothing under `app/`,
`routes/`, `database/`, `config/` or `tests/`. The session is subscribed to PR
activity with a recurring check-in; if either backend job goes red it will be
root-caused rather than assumed unrelated.

---

## 12. Visual Preview

No preview deployment is wired for this repository, and none was created —
deploying is out of scope for this task.

Screenshots covering all ten width × direction combinations were captured during
QA and the representative set was delivered to the product owner in the
implementation session (mobile RTL 390, desktop RTL 1440, tablet LTR 768, and
both footer / bottom-navigation views).

To inspect it directly:

```bash
cd storefront
pnpm install
# .env.local needs AWJ_COMMERCE_API_URL pointing at a running AWJ backend
pnpm dev     # http://localhost:3001/sa/ar   and   http://localhost:3001/sa/en
```

Check at 390 / 768 / 1024 / 1280 / 1440, in both `/sa/ar` and `/sa/en`.

---

## 13. Risks / remaining issues

- **Widest visual surface.** `--primary` and the `primary-50..950` ramp now
  resolve to AWJ Modern green, so surfaces outside the shell — product-card
  hover, checkout buttons, filter chips, gift-card meters — change colour. This
  is the approved baseline direction and a token change only, with no behaviour
  change, but it is the largest visual delta in the PR and the thing most worth
  the product owner's eye.
- **Root categories only** appear in the rail. Subcategories remain in the
  drawer and on the category pages. A desktop mega-menu was deliberately not
  built.
- **Pre-existing, untouched:** prices render with Arabic-Indic digits on the
  English storefront. That is `Intl` formatting in the price component and
  belongs to catalogue/pricing display, not the shell.
- **The footer category cap of 6** is a presentation choice, not configuration.
  If the product owner wants it merchant-controlled it belongs to STORE-UI-6.
- **No automated visual-regression coverage.** The repository has none, and
  adding a framework was out of scope. Visual QA for this task was manual and
  is recorded in §7.

---

## 14. Scope confirmation

| Boundary | Status |
| --- | --- |
| No backend/API changes | ✅ confirmed — diff is confined to `storefront/` |
| No database/migration changes | ✅ confirmed |
| No accounting/inventory changes | ✅ confirmed |
| No tenant/security changes | ✅ confirmed |
| No checkout/payment/shipping implementation | ✅ confirmed |
| No duplicate taxonomy, catalogue, price or inventory truth | ✅ confirmed — the rail reads the existing authoritative fetch |
| No invented commerce capability, content or claim | ✅ confirmed — no wishlist tab, no footer promises |
| No new external dependency, no dependency upgrade | ✅ confirmed |
| No changes mixed with PR #794 | ✅ confirmed |
| No production deployment | ✅ confirmed |
| PR not merged, auto-merge not enabled | ✅ confirmed |

---

## 15. Next step

**Product-owner visual review of PR #855 against
`AWJ Store — Responsive Visual Baseline V1 — LOCKED`.**

Merge is **not** recommended until that review is complete. Visual revisions may
be requested even with CI fully green; that is expected and in line with the
baseline's acceptance rule:

> **No visual approval = No merge.**
