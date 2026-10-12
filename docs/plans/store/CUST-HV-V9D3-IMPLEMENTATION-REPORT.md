# CUST-HV V9d-3 — Shelf title override and "show title" — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9d-3** — third V9d slice (V9d-1 card tokens → V9d-2 layout / columns / per-section cards → **V9d-3 section title** → V9d-4 commerce-firewall closure). |
| **Branch** | `cust-hv/v9d3-shelf-titles` (stacked on V9d-2 until it merges) |
| **Authority** | V0 §14.2 (shelf title + show title) · §3.4 (capability registry) · §14.3 (commerce firewall) · §2.2 (additive, three normalizers in lock-step) · §8.1 (heading structure / accessible names) |
| **Scope** | Optional `title` and `showTitle` in the content of the four shelf sections (new arrivals, featured, offers, product shelf) in PHP (authority) + two byte-identical TS twins + the shared fixture; the storefront heading; the Canvas parity; the editor fields. No endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| `title` | Free text, trimmed, ≤ 80 code points (the product shelf's existing limit); blank = absent = the localized default title. | Presentation copy only; existing stores unchanged. |
| `showTitle` | Stored **only as `false`** (absence = shown). | Same "default = absence" canonical form as every other additive key. |
| Hidden title | The `<h2>` stays in the DOM, visually hidden (`sr-only`), as the section's `aria-labelledby` target; the heading bar disappears; the "view all" action stays visible on the end edge. | A section must keep its accessible name and its landmark; hiding a name is not removing it. |
| New arrivals | Gains a `content` object (`title` / `showTitle`) — it had none (it is catalog-driven). A section with neither stays contentless. | Smallest model that carries the choice; no id list is invented. |
| Featured / offers | Content keeps the title fields **even with no picked ids** (a title is authored copy, independent of the selection). | Editing the title before picking products must not be silently dropped. |
| Product shelf | `showTitle` appended after `source`; the existing `title` field is unchanged. | Backward compatibility. |
| Not in this slice | Per-section subtitle/description, title alignment, heading level choice. | Smallest coherent set. |

## What was built

- PHP `StorefrontPresentationNormalizer` (`shelfTitleFields`, new-arrivals content, featured / offers / productShelf carrying the fields; canonical key order pinned).
- TS twins `section-content.ts` (`ShelfTitle`, `NewArrivalsContent`, `newArrivalsContentOf`, `shelfTitleFields`, `hasShelfTitle`, `normalizeNewArrivals`); fixture `shelf-titles.json` (28 cases).
- Storefront: `SectionHeading` (`hideTitle`, shared `HeadingAction`), `FeaturedShelf`, `OffersShelf`, `ProductShelfSection`, `NewArrivalsSection`, `published-nodes` (title override + hide).
- Merchant app: Canvas headings (own title, hidden title via `sr-only` + `data-title-hidden`), `ShelfTitleFields` (title with counter-limited input + "Show title" toggle) for new arrivals / featured / offers, a toggle in the product shelf editor, shared `BufferedText` (extracted from the content-block editor so trimmed text keeps typed spaces), AR / EN strings.

## Backward compatibility

A shelf without `title` / `showTitle` renders byte-for-byte as before (same default titles, same heading bar). Existing product-shelf titles are untouched. A featured / offers selection edited after this slice keeps its ids when the title changes and vice versa (tested).

## Tests

- Shared fixture × PHP `StorefrontShelfTitlesTest`, storefront `shelf-titles.test.ts` and web `shelf-titles.test.ts` (57 cases each): trimming, 80 code points, blank = absent, `showTitle` only `false`, non-boolean ignored, empty featured/offers keep the title, canonical key order, idempotence, other section types drop the fields.
- Storefront components: `FeaturedShelf` / `OffersShelf` hidden title keeps the `aria-labelledby` target (`sr-only`), custom title, default title.
- Merchant app `ShelfTitles.ui.test.tsx`: Canvas default / own / hidden for new arrivals, featured and offers; editor writes `{title}`, `{showTitle:false}`, removes empty content, preserves picked product / offer ids.
- Full suites: web, storefront, and the PHP mirror (see PR).

## Design Quality Pass

No new visual primitive: the title reuses the existing heading and the existing `sr-only` utility. The visible state keeps the V5/V9d heading bar and rhythm; the hidden state leaves the action link on the end edge (right in LTR, left in RTL via flex `justify-end`) and removes the bar, so a hidden title never leaves an orphan accent. Editor controls are the shared `Field` / `Toggle` (44 px touch rows on small screens), keyboard-reachable, AR RTL / EN LTR strings.

## Limitations (stated)

- The Canvas's `newArrivals` section label keeps its pre-existing dangling `aria-labelledby` (a valid id would change the Canvas selectable wrapper's accessible name, which other suites pin); the storefront heading is correctly labelled.
- The product-shelf title input remains the existing controlled field.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched. **Commerce firewall:** the fields are copy and a visibility flag; nothing reads or writes a price, offer, stock, availability or tax. No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
