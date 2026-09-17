# STORE-UI-1 — Final Implementation Report

**Task:** `STORE-UI-1 — Storefront Shell`
**Date:** 2026-09-17
**Repository:** safwan5001-source/Nebrax
**Authorities:** `docs/plans/store/AWJ_STOREFRONT_RESPONSIVE_BASELINE_V1.md` (LOCKED),
`docs/plans/store/AWJ_STOREFRONT_DESIGN_SYSTEM.md`, and the product owner's
approved *Responsive Visual Baseline V1 — Final Candidate* reference

> Regenerated from the final head. Earlier revisions of this file described the
> state at `d0f63f3`, before the design-fidelity pass and the review rounds that
> followed; every section below reflects the head named in §2.

---

## 1. Status

**Completed** — implemented, refined against the approved visual reference,
reviewed, validated, and pushed.

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
- **Last code commit:** `740384e7619e1e2aeeb0350ce41b8756ff2538c7`
- **Head SHA:** the PR's current head. This report is committed to the branch it
  describes, so pinning its own commit's hash here is not possible; the table
  below is the authoritative record of substantive change, and anything after
  the last row is documentation only.
- **Diff against base:** 29 files. All of it under `storefront/` except this
  report.

| Commit | What it did |
| --- | --- |
| `35d7aeb` | The shell: tokens, header, real category rail, bottom navigation, footer, RTL/LTR |
| `28cff77` | First revision of this report |
| `d0f63f3` | Codex round 1 — Arabic face unreachable; category routes lost the bottom-nav selection |
| `9e35199` | Recorded round 1 in this report |
| `83d4ff7` | Design-fidelity pass against the approved final-candidate reference |
| `89e3a86` | Codex round 2 — skip-link target behind the header; two search instances |
| `dde154b` | Product-owner visual corrections (brand, title, density, rail, footer) |
| `0b13bef` | Codex round 3 — category rail collapsed its own reserved row |
| `740384e` | Codex round 4 — focus indicator on the utility trigger; this report regenerated |

---

## 3. Existing architecture reused

Nothing was rebuilt from a prototype. The existing `storefront/` Next.js app and
its AWJ commerce seams are the foundation.

| Seam | How it was used |
| --- | --- |
| `(storefront)/layout.tsx` | Its request-cached `getRootCategories`, its `connection()` deferral and its Suspense boundaries are kept. The shell renders the categories the layout already fetched — one fetch, one taxonomy, no second catalogue. |
| `Header`, `Footer`, `CartButton`, `MobileMenu`, `RegionPreferences`, `DocumentShell` | Adapted in place rather than replaced. |
| `SearchToggle.tsx` | Renamed to `StoreSearch.tsx`; git records it as a rename. It was imported only by `Header`. |
| `SearchBar` | Extended with two optional props (field `className`, an optional submit control). Its only consumer is `StoreSearch`. |
| `CartContext`, `POLICY_LINKS`, `isWholesaleEnabled`, `localeDirection` | Consumed unchanged. |
| `next-intl`, `next-themes`, `next/font/google`, Tailwind v4, shadcn-style UI | Existing stack; **no dependency added or upgraded**. |

Category data still comes from `getCategories` → `fetchCategories` →
`storefrontFetch("categories")`, i.e. the AWJ `store/v1` catalogue. The shell
narrows each category to `{ id, name, permalink }` for rendering and adds
nothing to it.

---

## 4. Implementation

### 4.1 Store Theme Token foundation

A semantic `--store-*` layer in `globals.css` is the single presentation seam a
later Store Customizer can override without touching a component. Values are the
approved reference's **literal hex**, not a perceptual re-encoding of them, so
nothing drifts from what was signed off.

- **Surfaces / text:** `background` `#f8f9fa`, `surface` `#ffffff`,
  `surface-muted` `#f3f4f6`, `foreground` `#111827`, `muted-foreground`
  `#636a78`, `border` `#e5e7eb`, `border-strong` `#d1d5db`.
- **Primary:** an 11-step ramp built around the reference's `#12372a`, plus
  `primary`, `primary-hover`, `primary-foreground`, `primary-soft`.
- **Status:** `destructive` `#dc2626`, `success` `#059669`, `warning` `#d97706`.
- **Footer band:** `footer`, `footer-foreground`, `footer-muted`, `footer-link`,
  `footer-border` — the approved footer is dark and cannot be expressed with the
  light surface tokens.
- **Shell metrics:** `content-max` `85rem`, `radius` `0.75rem`, `header-height`
  `3.375rem`, `header-height-lg` `4rem`, `utility-height` `1.75rem`,
  `nav-height` `2.375rem`, `bottom-nav-height` `3.75rem`, `focus-ring`, and
  `header-offset` (§4.9).

These are exposed as Tailwind utilities (`bg-store-surface`,
`text-store-muted-foreground`, `max-w-store`, `h-store-nav`, …), and the existing
shadcn aliases (`--primary`, `--background`, `--border`, `--ring`, `--radius`)
plus the `primary-50..950` ramp resolve to them.

**One deliberate deviation from the reference:** `--store-muted-foreground` is
one step darker than its `#6b7280`, which measures 4.39:1 on
`--store-surface-muted` — under AA for the category rail and the utility strip,
both of which sit on that surface. The value used reads the same and clears
4.94:1 there and 5.44:1 on white.

### 4.2 Header

A sticky banner, 133px on desktop and 113px on a phone.

- **≥ md:** three bands matching the reference's desktop anatomy — a 28px
  utility strip carrying region, language and currency; a 64px identity row with
  the wordmark, search and the shopper actions; a 38px category rail.
- **< md:** the utility strip and the rail fold away. The identity row compacts
  to 54px with the wordmark centred between the menu and the cart, and search
  wraps onto a second line of the same band.
- **≥ lg:** the drawer retires and the wholesale link surfaces in the row.

The identity band is **one grid**, not two stacked rows, so a single search
instance moves between placements (§11, round 2).

Two actions in the reference are deliberately absent: wishlist has no
persistence behind it, and the header cart total has no field on the cart
context — `CartContext` exposes `itemCount` only.

### 4.3 Store identity

Purely typographic: the merchant's name set in Cairo 800 in the brand colour,
white on the footer band. AWJ gives the storefront a name and no logo asset; an
earlier revision generated a monogram tile from the initial, which the product
owner read — correctly — as a placeholder, because it presents as branding the
merchant never chose. When the Customizer can supply a logo it replaces this
without the surrounding layout moving.

### 4.4 Category navigation

`CategoryNav` replaces the previous `sr-only` list with the visible rail:

- Built from the same authoritative categories; renders "all products" plus the
  root categories.
- Pages horizontally when the categories overrun the width. Controls appear only
  on measured overflow, via a `ResizeObserver` that also observes the items so
  the Arabic webfont swap re-triggers the measurement.
- Marks the open category with both styling and `aria-current`, including when a
  child permalink is active.
- Inactive items are plain text; only the open category takes a surface, at a
  tighter radius than the shell's buttons so it reads as a selected tab rather
  than a row of controls.
- **Renders for every outcome, including an empty or failed category response**,
  so the row reserved by the fallback is never dropped (§11, round 3).

### 4.5 Mobile bottom navigation

`MobileBottomNav` — Home / Products / Cart / Account, every one an existing
storefront route, 60px with `safe-area-inset-bottom` padding and a spacer in the
layout so no page content sits beneath it. Cart badge withheld until hydration.
Shop owns the `/c` subtree as well as `/products`, so the bar keeps its
selection throughout category browsing.

**No wishlist entry:** the storefront has no wishlist persistence, and a dead tab
would imply a capability the platform does not have.

### 4.6 Shared content container

`StoreContainer` encodes the storefront's one measure
(`max-w-store px-4 sm:px-6 lg:px-8`, 1360px) and is used by every shell region —
header bands, rail, footer, bottom navigation — so the wordmark, the search
field, the first category and the first footer column share one vertical line.
The 27 existing page-level `container mx-auto` usages were deliberately left
alone as out-of-scope churn.

### 4.7 Footer

A dark band closing the page, as the approved reference draws it. Identity takes
its own full-width line as the band's masthead, with a hairline beneath it, and
three link groups divide the width evenly below. Category links are capped at
`FOOTER_CATEGORY_LIMIT = 6`.

It carries only navigation the storefront actually has. The reference's about
paragraph, payment marks and registration badge are absent: AWJ configures none
of them, and a footer is exactly where an invented claim reads as a commitment.

### 4.8 RTL / LTR

Logical properties throughout (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`); the
mobile wordmark is centred with a grid rather than absolute offsets, so it
mirrors for free. The cart badge moved from a physical `right-0` to `end-0`.
Paging chevrons follow reading direction. The merchant name is isolated with
`<bdi>` in the header and footer so an Arabic name inside an English page — and
the reverse — keeps its surrounding characters in page order.

### 4.9 Typography

Cairo is declared alongside Geist on every document, and Geist names it as its
own fallback so Arabic glyphs actually reach it (§11, round 1). Arabic is the
storefront's default locale; the weight hierarchy of the approved reference
depends on Cairo's heavy cuts. Both faces arrive through the existing
`next/font/google` seam — no new package. Cairo was approved by the product
owner for Responsive Baseline V1.

Every locale bundle used to wrap the authoritative store name in a generic word
— `"متجر {storeName}"` in Arabic, `"{storeName} Storefront"` in the other five.
For a store already called *متجر نبراس الطموح* that rendered the word twice.
`home.welcome` now presents the name alone, in all six bundles; no component and
no merchant data was touched.

### 4.10 Accessibility

Skip link to `#main-content`, with `scroll-margin-top` derived from the band
metrics so the landing clears the sticky banner. Labelled `nav` landmarks,
`aria-current="page"` on the active bottom-nav item and the open category,
accessible names on every icon-only action and on the paging controls, a focus
indicator on the utility trigger, a footer band that states its own focus ring
because the global black outline is invisible on it, and reduced-motion handling
on the rail's smooth scrolling.

---

## 5. Design decisions

**Aliasing `--primary` to the store token rather than scattering green.**
Scoping the palette to shell components only would have left green chrome above
a differently-coloured catalogue — and in `CheckoutPageContent` a green button
with a blue `hover:bg-primary-700`. See §6 for the scope audit.

**The whole banner sticks, not an inner row.** The first build made only the
identity row sticky. Visual QA showed it vanishing on the first scroll: a sticky
element can only travel inside its parent's box, and the parent was only as tall
as the header.

**Search is a live field, not a toggle.** A field present in both placements is
materially stronger discovery for a commerce shell, and removing the overlay also
removed its transition and focus-management code.

**A paging rail, not a mega-menu.** Subcategory data is already fetched, so a
hover mega-menu was available — and declined. It is a navigation capability, not
shell infrastructure, and it brings real keyboard and screen-reader obligations.

**Footer category cap and masthead.** Twelve root categories turned one column
into a sitemap three times the height of its neighbours. A lone wordmark in a
quarter-width column then read as a gap where content had been removed, so
identity took the full measure instead.

**No letter-spacing on translatable strings.** `tracking-tight` / `tracking-wide`
break Arabic's connected script; hierarchy comes from size, weight and colour.

**Restraint check.** No gradients beyond the two functional edge fades on the
rail, no glassmorphism, no decorative blur, no shadows beyond the skip-link chip,
no badges that are not real counts, no invented metrics or trust indicators, no
card-in-card, no decorative animation.

---

## 6. Token-scope audit

The concern raised was that aliasing `--primary` and the ramp changes surfaces
outside STORE-UI-1. The audit found the premise does not hold.

Every consumer of `--primary` or the ramp — **24 files** — is inside
`storefront/src`: account, cart, checkout, product cards, filters, breadcrumbs
and the UI primitives. Nothing outside the storefront app can reach them; `web/`
(the ERP) is a separate Next.js app with its own `globals.css` and design system.
So "outside STORE-UI-1" is not "outside the storefront".

The reference settles the direction: `#12372a` appears **31 times** in it, on
cart, checkout and product CTAs. A shell-only token boundary would give a
deep-green header above a near-black "add to cart", contradicting the approved
design and needing to be undone in STORE-UI-2/3/4.

**Decision: keep the alias.** The boundary was tightened where it genuinely
could be — `--store-*` is now the declaration and the shadcn names are aliases
of it, so a Customizer override touches one block.

---

## 7. Files changed

28 files, +1947 / −371.

| File | Purpose |
| --- | --- |
| `src/app/globals.css` | `--store-*` token layer, shadcn aliases, AWJ Modern ramp, footer tokens, shell metrics, `--store-header-offset`, dual-script font stack, `store-rail` utility, focus offset |
| `src/components/layout/StoreBrand.tsx` | **new** — typographic identity, light and dark tones |
| `src/components/layout/CategoryNav.tsx` | **new** — real category rail, RTL-aware overflow paging, active state |
| `src/components/layout/MobileBottomNav.tsx` | **new** — primary mobile navigation over existing routes |
| `src/components/layout/StoreContainer.tsx` | **new** — shared content measure |
| `src/components/layout/StoreSearch.tsx` | renamed from `SearchToggle.tsx`; live lazy-loaded field |
| `src/components/layout/Header.tsx` | three responsive bands, one search instance, skip link |
| `src/components/layout/Footer.tsx` | dark band, masthead, three even columns, own focus ring |
| `src/components/layout/CartButton.tsx` | `action` variant, store tokens, logical badge placement |
| `src/components/layout/RegionPreferences.tsx` | `utility` variant and its focus indicator |
| `src/components/layout/MobileMenu.tsx` | drawer offsets read the header-height token |
| `src/components/layout/DocumentShell.tsx` | Cairo, and Geist's fallback naming it |
| `src/components/search/SearchBar.tsx` | optional field styling and submit control; dropdown on the store measure |
| `src/app/[country]/[locale]/(storefront)/layout.tsx` | wires the rail, `#main-content` and its scroll margin, bottom nav, spacer |
| `messages/{ar,de,en,es,fr,pl}.json` | 8 shell keys added, 2 dead search-overlay keys removed, `home.welcome` corrected |
| 6 test files | see §9 |

---

## 8. Responsive and RTL/LTR QA

Chromium, real render of the running storefront against a local AWJ `store/v1`
stub carrying 12 root categories with long Arabic names, so the rail genuinely
overflows. Header, category navigation, content container, bottom navigation and
footer inspected at the top and bottom of the page at every width, in both
directions.

`document.scrollWidth === document.clientWidth` at **all ten** width × direction
combinations — no unintended horizontal scrolling anywhere.

| Width | Result |
| --- | --- |
| **390** | 54px identity row + wrapped search line (113px total); bottom navigation legible, page content clears it; footer balanced. |
| **768** | Utility strip, inline search with submit, category rail, drawer still available; bottom navigation correctly absent. |
| **1024** | Search fills the middle; rail shows its end paging control; active category marked. |
| **1280** | Wordmark / search / actions in disciplined proportion; rail overflows into the paging control. |
| **1440** | Content bounded at the 1360px measure; no oversized empty margins. |

Also verified: sticky behaviour after scrolling, skip-link landing (§11), drawer
offset under the identity row, rail paged to its end in RTL, bottom-navigation
clearance, and the **empty-catalogue** case — a zero-category stub produces the
same 133px header as a populated one.

**Arabic RTL** — drawer opens from the start edge, chevrons point in reading
order, the rail pages towards negative `scrollLeft`, the cart badge sits on the
correct side, `© 2026 <name>` resolves in page order (verified by measuring box
positions, not by eye). **English LTR** — the same shell mirrored; Arabic
category names inside the English page render in Cairo and disturb neither the
surrounding Latin text nor the copyright line.

---

## 9. Tests

| Command | Result |
| --- | --- |
| `pnpm test` (full suite) | **56 files, 431 tests, all passed** |
| `pnpm check` (Biome lint + format) | clean |
| `pnpm check:locales` | all locales in sync with `en.json` |
| `npx tsc --noEmit` | clean |

**Baseline before any change on this branch:** 52 files, 413 passed. The branch
adds 4 files and 18 tests and breaks nothing. There were no pre-existing
failures.

New coverage: Geist names the Arabic face as its fallback, so the generated Arial
fallback cannot silently swallow Arabic again; the header mounts exactly one
search field; the bottom navigation keeps Shop selected on a nested category path
and does not select on a merely prefixed route; the rail links only to supplied
categories, marks the open one including a child permalink, hides its paging
controls when nothing overflows, pages towards negative `scrollLeft` in RTL, and
still renders a band with zero categories; every locale presents the merchant
name without wrapping it.

**No existing test was weakened, skipped or removed.** Modified test files were
updated because the shell they assert on changed shape.

---

## 10. Build

`pnpm build` — **succeeds**, including the build-time fetch of both faces. The
prerender log lines reading `AWJ_COMMERCE_API_URL is not configured` are the
expected no-backend path in this environment and are present on the baseline
build too; the build exits 0 and generates all 63 static pages.

---

## 11. CI and review rounds

`storefront (lint + typecheck + test)` has passed on every head pushed. The
backend suites (`php artisan test` on sqlite and pgsql) run on every branch push;
this diff touches nothing under `app/`, `routes/`, `database/`, `config/` or
`tests/`. No merge conflict at any point — the head has stayed based on the
current `main`.

Three automated review rounds from `chatgpt-codex-connector`. **Every finding was
real**, verified against primary evidence before any code changed, fixed,
answered on its thread and resolved.

**Round 1 (`35d7aeb`).**
*Arabic never reached its face.* `--font-geist` expands to `"Geist", "Geist
Fallback"`, and that generated face is `local(Arial)` with no `unicode-range`, so
it answered for Arabic. Confirmed by grepping the emitted CSS. The reviewer's
suggested remedy, `adjustFontFallback: false`, does **not** work — the Turbopack
build ignores it. Naming the Arabic face as Geist's own fallback does. Verified
with CDP `CSS.getPlatformFontsForNode` on both locales.
*Category routes lost the bottom-nav selection*, because category pages live
under `/c`, not `/products`. Nav items now own additional route subtrees.

**Round 2 (`9e35199`).**
*The skip link landed behind the header it had just skipped.* The banner's height
is now the `--store-header-offset` token, summed from the band metrics and
switched at `md`; `main` carries it as `scroll-margin-top`. Measured by following
the link and reading back where `main` landed.
*Search lost its query across `md`*, because the header mounted two instances and
hid one with CSS. The identity band is now one grid in which a single instance
changes placement.

**Round 3 (`dde154b`).**
*The category rail collapsed its own reserved row* when the catalogue returned
nothing, dropping the 38px the fallback had reserved and shifting the page up —
the fallback failing at exactly the case it existed for. The guard's
justification was wrong: the rail always carries its "all products" entry, so it
is never the empty strip the guard claimed to avoid. Removing it makes every
outcome resolve to the same height.
**Round 4 (`0b13bef`).**
*No focus indicator on the utility trigger.* The shared base className carried
`outline-none`, which suppresses the app's global `:focus-visible` outline; the
drawer's variant compensates with its own animated underline, and the utility
variant had no substitute. `outline-none` moved to the drawer branch, and the
utility branch now lets the app's own ring through — measured at solid 1px, 2px
offset, the same treatment the rail links and the skip link get, at 4.94:1
against the strip it sits on.
*The report was stale*, still describing `d0f63f3`: a 23-file diff, Tajawal,
`0.625rem`/`80rem`, and a rail that vanished for an empty catalogue. Regenerated
as this document.

---

## 12. Product-owner visual review

The owner reviewed the fidelity pass and approved the overall shell direction,
**Cairo typography**, the dark footer, the responsive structure, search, RTL/LTR
handling and the mobile bottom navigation, and asked for five corrections, all
delivered in `dde154b`:

1. **Brand fallback** → typographic wordmark replacing the generated monogram.
2. **Mixed-language title** → traced to the locale bundles and corrected there
   (§4.9), with the hero component untouched for STORE-UI-2.
3. **Desktop density** → bands trimmed from 143px to 133px, nothing removed.
4. **Category rail** → inactive items lose their hover box; only the open
   category takes a surface.
5. **Footer balance** → identity promoted to a full-width masthead.

---

## 13. Visual preview

No preview deployment is wired for this repository, and none was created —
deploying is out of scope. Screenshots covering all ten width × direction
combinations were captured during QA and delivered to the product owner in the
implementation session, alongside the rendered approved reference for direct
comparison.

To inspect it directly:

```bash
cd storefront
pnpm install
# .env.local needs AWJ_COMMERCE_API_URL pointing at a running AWJ backend
pnpm dev     # http://localhost:3001/sa/ar   and   http://localhost:3001/sa/en
```

Check at 390 / 768 / 1024 / 1280 / 1440, in both `/sa/ar` and `/sa/en`.

---

## 14. Risks / remaining issues

- **Widest visual surface.** `--primary` and the ramp resolve to the AWJ Modern
  green, so surfaces outside the shell — product-card hover, checkout buttons,
  filter chips — change colour. Token change only, no behaviour change, and the
  approved direction (§6), but it is the largest visual delta in the PR.
- **Root categories only** in the rail. Subcategories remain in the drawer and on
  the category pages; no desktop mega-menu.
- **Pre-existing, untouched:** prices render with Arabic-Indic digits on the
  English storefront. That is `Intl` formatting in the price component and
  belongs to catalogue/pricing display, not the shell.
- **The `--store-header-offset` overshoots by 38px** on a storefront whose
  desktop rail is absent, leaving the skip-link landing slightly lower than
  necessary — harmless in the direction that matters.
- **The footer category cap of 6** is a presentation choice, not configuration.
  If it should be merchant-controlled it belongs to STORE-UI-6.
- **No automated visual-regression coverage.** The repository has none, and
  adding a framework was out of scope. Visual QA was manual and is recorded in §8.

---

## 15. Scope confirmation

| Boundary | Status |
| --- | --- |
| No backend/API changes | ✅ diff confined to `storefront/` plus this report |
| No database/migration changes | ✅ |
| No accounting/inventory changes | ✅ |
| No tenant/security changes | ✅ |
| No checkout/payment/shipping implementation | ✅ |
| No duplicate taxonomy, catalogue, price or inventory truth | ✅ the rail reads the existing authoritative fetch |
| No invented commerce capability, content or claim | ✅ no wishlist tab, no cart total, no footer promises |
| No homepage/hero/product-section redesign | ✅ reserved for STORE-UI-2 |
| No new external dependency, no dependency upgrade | ✅ |
| No changes mixed with PR #794 | ✅ |
| No production deployment | ✅ |
| PR not merged, auto-merge not enabled | ✅ |

---

## 16. Next step

**Product-owner visual review of PR #855 at its current head.**

Merge is **not** recommended until that review is complete. Visual revisions may
be requested even with CI fully green; that is expected and in line with the
baseline's acceptance rule:

> **No visual approval = No merge.**
