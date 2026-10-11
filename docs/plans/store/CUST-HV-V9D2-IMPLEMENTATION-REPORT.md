# CUST-HV V9d-2 — Product / offer shelves: layout, columns and the section's own card tokens — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9d-2** — second V9d slice (V9d-1 card tokens → **V9d-2 shelf layout / columns / per-section card override** → V9d-3 section title → V9d-4 commerce-firewall closure). |
| **Branch** | `cust-hv/v9d2-section-cards` (stacked on V9d-1 until it merges) |
| **Authority** | V0 §14.2 (`layout: grid | rail`, `columns 2|3|4`) · §14.1 (global default with per-section override) · §3.4 (capability registry) · §14.3 (commerce firewall) · §2.2 (additive, three normalizers in lock-step) |
| **Scope** | Three additive `design` groups for the product / offer shelves (`layout`, `columns`, `cards`) in PHP (authority) + two byte-identical TS twins + the shared fixture; the shelves' rendering; the Canvas parity; the Design-tab controls. No endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| `layout` | `grid` · `rail` on **newArrivals, featured, productShelf**; **absence = the theme's own form** (a grid in Modern, a rail in Market), so — unlike hero / banner / gallery — **both values are stored** (the default depends on the theme). An explicit value wins in either theme. | Existing stores unchanged; the choice is meaningful in both themes. |
| Offers | `columns` and `cards` but **no `layout`**: there is no offer carousel, and none is invented. | Capability = what the renderer can honestly draw. |
| `columns` | `2 | 3 | 4` on wide screens (`design.columns`); phones always show two; tablets three (two when 2 was chosen); absence = today's `2 / 3 / 4` grid and `2 / 3 / 5` rail. | The storefront's locked two-column phone browsing. |
| Per-section card tokens | `design.cards` = the same closed lists as the document's `cards` (`align`, `imageRatio`, `imageFit`, `hover`), on the same four shelf types. The resolver writes the **same validated `--cd-*` variables** onto the section's own frame; custom properties inherit, so **the nearest scope wins with no extra machinery**. | One mechanism for both scopes. |
| Revert to today's | In a section's override, `start` alignment and `cover` fit **are written out** (a store-wide `center` / `contain` must be overridable); at the document level they still emit nothing. A section cannot re-select "today's height frame" or "today's hover" while the store-wide token is set — clear the store-wide token instead (stated). | Keeps "absent ⇒ identical" at the document level. |
| Where the choice reaches the page | `published-nodes` passes the section's `layout` / `columns` to the shelf; the new-arrivals shelf, built once by the page, receives them by `cloneElement` (as the hero's `designed` does). | No second data path. |
| Canvas | A shelf with a choice carries `data-shelf` / `data-vp` / `data-cols`; a Canvas-only block (before the V5c parity marker) turns them into the storefront's own numbers for the SIMULATED device, and draws a rail as a native scroll-snap strip (no Swiper in the editor). A shelf with no choice carries no attribute: the legacy preview, byte for byte. | Same pattern as the gallery / benefits / content blocks. |
| Not in this slice | Section title override + show-title (V9d-3); `count` for shelves that have no limit today (selection-based shelves; the product shelf keeps its existing `limit`); category tiles. | Smallest coherent set; stated. |

## What was built

- PHP `StorefrontSectionDesignNormalizer` (`layout` `grid|rail` for shelves, `columns`, `cards`; canonical order `… layout · columns · border · radius · shadow · cards · separator …`) and `StorefrontGlobalTokensNormalizer::cards()` (shared by both scopes).
- TS twins: `section-design.ts` (`LAYOUTS.shelf`, `SHELF_COLUMNS`, `ShelfLayout`, capability rows, normalisation), `global-tokens.ts` (`normalizeGlobalCards`, `resolveCardTokens(…, scope)`), `section-design-resolve.ts` (section card tokens → `data-sd` + variables); fixture +24 cases and the four capability rows.
- Stylesheet: the `cd-*` rules gain their `[data-sd~="cd-*"]` twins (and the mirrored preview rules).
- Storefront: `lib/home/shelf-layout.ts` (`shelfForm`, `shelfGridClass`, `shelfRailBreakpoints`), `FeaturedShelf`, `ProductShelfSection`, `OffersShelf`, `NewArrivals(Section)`, `published-nodes`.
- Merchant app: Canvas shelves (`data-shelf`), Canvas-only CSS, Design tab (shelf layout labels + hint, columns select, "Cards in this section" group with an "as the whole store" first choice), AR / EN strings.

## Backward compatibility

A shelf without `layout`, `columns` or `cards` renders as before: same form per theme, same classes (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` is `shelfGridClass(undefined)`), same Swiper breakpoints (3 / 5), no extra attribute on the Canvas. `layout: "split"` and other types' variants are still dropped on shelves.

## Tests

- Shared fixture × PHP `StorefrontSectionDesignTest`, storefront and web design tests: every shelf keeps `grid` / `rail`; offers have no layout; columns 2 / 3 / 4 only (strings, 5 and `3.0` handled); cards closed lists, unknown values dropped one by one, density / radius / shadow / price / discount / stock never survive; canonical order; types without the groups drop them.
- Resolver tests (both apps): the section's tokens reach the frame with the same variables as the document's; `start` / `cover` written out in a section; columns and layout add no token or variable; **no card key names a price, discount, stock, availability, offer or tax**.
- `shelf-layout` unit tests, `NewArrivals` (explicit rail in Modern, explicit grid in Market, every column count), `DesignInspector` (grid / rail / Automatic, columns, the card override writes the canonical form and removes itself, offers have columns + cards but no layout, other types show neither).
- PHP: `StorefrontGlobalTokensTest`, `StorefrontSectionDesignTest`, the `StorefrontPresentation*` family, content-block and gallery suites green in the CI-equivalent mirror (404 tests).

## Design Quality Pass — real Chromium

`scripts/card-proof` (now **2 018 checks, 0 violations**) adds, on the production `ProductCard` and the production grid class: the **shelf column count** for auto / 2 / 3 / 4 in AR RTL / EN LTR at 390 / 768 / 1280 (phones 2, tablets 3 or 2, desktops the chosen count; every first row full; no overflow) and the **override**: with the document saying "centred, no hover motion", a section whose own tokens say "start, whole picture, 1:1, lift" shows exactly that (alignment, fit, frame ratio, −4 px lift with shadow) while its sibling keeps the document's (centred, cover, height frame, no motion). Negative control `--nosection` (the section-scope rules removed) fails the override checks; the earlier controls (`--noratio`, `--nohover`, `--noalign`, `--leak`) still fail as before.

## Limitations (stated)

- Offers have no rail; the Canvas rail is a native strip (the storefront's Market rail is Swiper); the real-pixel proof covers the grid forms and the card tokens, the rail's per-view numbers are unit-tested.
- A section override cannot re-select today's height frame or hover while a store-wide value is set.
- No title override / `count` yet (V9d-3), no category tiles.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched. **Commerce firewall:** every key is a closed-list value that styles a card or arranges a grid; nothing reads or writes a price, offer, stock or tax (tested at the key level and, in the browser, by asserting every commercial string identical across variants). No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
