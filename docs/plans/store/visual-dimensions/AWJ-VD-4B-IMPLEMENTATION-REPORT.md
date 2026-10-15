# AWJ-VD-4B — Implementation Report (Storefront visual renderer for `discovery`)

STATUS: **PR pending** — branch pushed, PR not opened, nothing merged or deployed.
DATE: 2026-10-15
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-4b (H1-4)
AUTHORITY: the owner authorized this slice on 2026-10-15 as **storefront/UI only**: no API, DB, migration, permission, security or tenant-isolation change, and no change to the merged contracts (VD-1c `meta.facets[].visual` + `sources`, the guarded image route and proxy, VD-4a display keys, VD-1a resolver). No Decision-Gate item was hit.

## Outcome

A `discovery` section now renders its real visuals, templates and display options:

- Each option carries its name, slug, count, own visual, proxied `imageSources` and the facet-level `defaults`, read through `parseListingFacets`.
- Each option is resolved by the VD-1a resolver, with `resolveDiscoveryDisplay` supplying the `section` and `template` contexts. Nothing re-implements precedence.
- Five layouts render: `image-grid`, `image-cards`, `carousel`, `icon-grid`, `text-list`.
- A **legacy** document (no `layout`, no `template`) keeps the tiles/chips markup **byte for byte** (proved below).

**Not touched:** API, DB, migrations, RBAC, the guarded image route and proxy, the VD-1a/VD-2/VD-4a modules (`facet-visual.ts`, `facet-visual-style.ts`, `facet-visual-tile.tsx`, `discovery-templates.ts`, `section-content.ts`), the web twins, `commerce-firewall`, and all PHP.

## Behavior

### Data path (`fetchDiscoveryValues`)
- The facet axis goes through `parseListingFacets` (re-normalized documents, canonical proxy sources only, `count > 0`).
- The one facet row is selected by key **before** parsing. Otherwise the parser's cap of 8 groups could hide a dimension the legacy code would find.
- Options gain optional `visual` and `imageSources`, and the result gains optional `defaults`. These keys are **absent** when empty, so the existing equality tests are unchanged.
- The brand axis keeps its original code and carries no visuals.
- A failed read still rejects, and the section still disappears.

### Resolution (`lib/presentation/discovery-items.ts`, pure)
- `resolveFacetValueVisual({defaults}, option.visual, {section, template, usableMediaIds})`. `usableMediaIds` is the media that has sources. The parser already removed any image without sources.
- **Fallback frames (D-08).** The resolver's `content: "none"` means two things:
  - *Text by choice* (an explicit `content: "none"`) stays frameless.
  - *Nothing set anywhere*, or *an image/icon asked for but unavailable*, is a fallback. It keeps the shaped frame and shows the name's initial, so a grid row stays aligned.
  - This also defines the **brand axis**: initials in the resolved shape (default circle, `md`), with the name visible and linked by `brand_id`.
- **`icon-grid`** applies §3.6 rule 3 (resolved icon, then image, then initial) by swapping the resolver's image-over-icon order for that layout only.
- **`text-list`** ignores media and `showLabel`: the name is the whole link.
- `valueSort` sorts first (`count` descending, ties in API order, never mutating the input), then `maxItems` caps. The cap is clamped to 4–24 and defaults to 12.
- `valueSort` and `maxItems` also apply on the legacy path. Their defaults equal legacy behaviour, so a true legacy document is unchanged.

### Layouts and options (`components/home/DiscoveryItems.tsx`)
- **Links.** Every item is a real `next/link` to the URL built exactly as today (`discoveryListingParams` / `href`).
  - The accessible name is always the value's name. With `showLabel=false` the tile keeps it `sr-only` and the link gets a `title`.
  - Images are decorative (`alt=""`).
  - Each link has `min-h-11` and a visible `focus-visible` outline.
- **Columns.** `--disc-cols-m/t/d` custom properties, re-clamped to the contract ranges, are read by three static arbitrary-value classes (base, `sm:`, `lg:`). No class name is built at runtime.
- **Carousel.**
  - A native scroll-snap grid (`snap-x snap-mandatory`, `overscroll-x-contain`), with no script.
  - RTL is the browser's own (verified: `scrollLeft` goes negative and the first item sits at the inline-start edge).
  - `motion-safe:scroll-smooth` only, so `prefers-reduced-motion` gives `scroll-behavior: auto` (verified).
  - `rows` (1–2) stacks rows **below `md` only** and is one row from `md` up. This follows §3.7's "carousel, on mobile". The resolver already limits `rows` to the carousel.
  - Column width is the largest frame plus padding. Scroller padding keeps focus rings from being clipped.
  - The links are the focusable content, so there is no extra tab stop.
- **`textPosition`.**
  - `below` is the default.
  - `beside` is a row with the frame capped at 45% so the caption keeps room in narrow cells.
  - `overlay` puts the caption on the frame over the new token pair `--store-scrim` / `--store-scrim-foreground`.
    - The pair is white on 72% black, and a test composites it over a pure-white photo and asserts at least 4.5:1 (it is 9.3:1).
    - A frameless text-only item is never overlaid.
  - `contentSequence: label-first` reverses the visual order only; the DOM order is unchanged.
- **`cardStyle`** (plain / outlined / elevated / filled), **`align`** (start / center), **`gap`** (tight / normal / loose) map to static token classes.
- **`showCounts`.**
  - The visible number is `aria-hidden`, and a sibling `sr-only` description ("N products", ICU plural in six locales) is referenced by `aria-describedby`, so it never changes the link's name.
  - The visible number is **not drawn when the label is hidden**, because it would be an unexplained figure. Assistive technology still gets it.
- **Performance.**
  - Images are `loading="lazy"` and `decoding="async"` with explicit `width`/`height` and frame `aspect-ratio`.
  - `srcset` uses the files' real widths, WebP preferred, with a 2x JPEG/WebP `src` fallback. `sizes` is the tile's default (frame width × zoom).
  - **No eager / `fetchPriority` for the first row:** the section sits below the hero in every pack, and an eager image would compete with the real LCP. Not justified.
- **RTL/LTR.** Logical properties only. A test scans every layout's markup for physical `left/right/ml/mr/pl/pr/rounded-l/r/border-l/r` and raw hex.
- Heading and `aria-labelledby` are unchanged in both paths.

## Changed files

**New**
- `storefront/src/lib/presentation/discovery-items.ts`
- `storefront/src/components/home/DiscoveryItems.tsx`
- `storefront/src/lib/presentation/__tests__/discovery-items.test.ts` (24 tests)
- `storefront/src/components/home/__tests__/DiscoverySection.vd4b.test.tsx` (60 tests)
- this report

**Modified**
- `storefront/src/lib/commerce/data-sections.ts` (facet branch through `parseListingFacets`; `visual`, `imageSources`, `defaults`)
- `storefront/src/lib/commerce/__tests__/data-sections.test.ts` (+5 tests)
- `storefront/src/components/home/DiscoverySection.tsx` (legacy markup untouched; new branch when a layout resolves)
- `storefront/src/app/globals.css` (two scrim tokens + theme aliases, additive)
- `storefront/messages/{ar,en,de,es,fr,pl}.json` (`home.discoveryProductCount`)

## Tests and exact results

| Check | Command (from the worktree root) | Result |
|---|---|---|
| Focused | `pnpm --dir storefront exec vitest run <3 files above + DataSections.h9b>` | all passed |
| Storefront full | `pnpm --dir storefront test` | **204 files passed / 15 skipped; 2669 tests passed / 15 skipped** (main before: 200/15 files, 2580 tests) |
| Biome | `pnpm --dir storefront check` | 0 errors; 2 warnings + 2 infos, all in files this slice does not touch |
| Locales | `pnpm --dir storefront check:locales` | all six locale files in sync |
| Types | `pnpm --dir storefront exec tsc --noEmit` | exit 0 |

PHP and web were not run: neither was touched.

**What the tests pin:**
- **Legacy byte identity.**
  - Goldens were generated by rendering the **pre-change component from origin/main** with the same inputs. In that same run the new component was asserted equal to it, then the throwaway copy was deleted.
  - Covered: tiles with HTML-escaping names, chips with a merchant title, brand tiles, the 12 cap and API order.
  - Visuals the API sent are ignored by a legacy tile.
- **Option building:** visibility (`count > 0`, a selected zero-count value is dropped), merchant vs count sort with stable ties and no mutation, sort-before-cap, `maxItems` clamp, `contentSequence`.
- **Data:** the visual, `imageSources` and `defaults` pass through; a value without a visual carries exactly `value|name|count`; non-canonical sources drop the image; a dimension beyond the first 8 facets is still found; brands carry no visuals.
- **CSS variables:** columns clamp per device; template → explicit precedence; `rows` only for the carousel.
- **Resolver wiring:**
  - section-explicit beats the value, the value beats facet defaults, facet defaults beat the template, the template beats the system default;
  - `showLabel=false` from the section wins;
  - the fallback icon survives;
  - no sources means no image request.
- **Per layout:** structure, exact hrefs, accessible names with `showLabel=false`, the 44px/focus classes, srcset/sizes/lazy/size attributes.
- **Fallbacks:** no visual → initial in the shaped frame; an image error → icon with the same frame width; no sources; text-only stays frameless.
- **Carousel semantics:** snap classes, motion-safe smooth only, no tab stops, rows, item width.
- **Overlay:** scrim classes, top anchor for label-first, never on a frameless item, and the contrast proof parsed from `globals.css`.
- **Misc:** long Arabic name (clamp, `title`, `min-w-0`); the same markup in AR and EN; logical-properties scan; null section on a failed or empty read.

## Visual verification

**Setup.** A throwaway harness, not committed, lives in `/tmp/claude-0/-home-user-Nebrax/e47f16e5-e49f-5a8f-b570-fa18b5d982cc/scratchpad/vd4b/`.
- It bundles the **real** `DiscoverySection`, `parseListingFacets`, resolver and tile (only `next-intl/server`, `next/link`, the fetch config and the product mapper are stubbed).
- It compiles the real `globals.css` through Tailwind.
- It serves WebP/JPEG fixtures through the production proxy path shape. Images are delayed 500 ms and one media id returns 404.
- Chromium drives it.

**Matrix.** 33 cases × widths 390 / 768 / 1280 / 1440 × Arabic RTL and English LTR, which is **264 captures**:
- legacy tiles and chips;
- all 5 layouts and all 7 templates;
- carousel rows=2, carousel lg arch, carousel with `showLabel=false`;
- `showLabel=false`, overlay (circle and portrait with counts), beside, label-first, align-start, elevated, filled/tight, star, many columns (4/6/8), sort by count with `maxItems`, icon-grid with facet defaults, text-list with counts;
- the brand axis in image-grid, icon-grid and text-list.

Every dataset includes:
- values with an image (focal point, zoom, `contain`);
- an icon-only value;
- a white photo (overlay worst case);
- an image that **fails to load**, with a fallback icon;
- a value with **no visual at all**;
- a 70+ character Arabic name.

**Automatic checks on all 264 captures: 0 problems.**
- `document.scrollWidth <= clientWidth` at every width and direction.
- No element of the section outside the viewport (the carousel scroller excluded, since it clips).
- Every link at least 43.5px tall.
- No broken `<img>` left in the DOM.
- The section's height unchanged between before images load (500 ms delay) and after: no layout shift, including when an image fails.
- No console or page errors.

**Opened and looked at** (the Read tool): image-grid at 390 and 1280 RTL; all 7 templates (mobile and desktop sheets, RTL and LTR); carousel rows=2 in both directions; carousel lg arch with counts; carousel with hidden labels; overlay circle and portrait with counts; beside; showLabel=false; elevated hearts; star; brand image-grid; and the carousel keyboard focus state.

**Defects found by looking or by the checks, all fixed:**
1. **Page overflow in the carousel (found by the `scrollWidth` check).** The `sr-only` count spans are absolutely positioned. With no positioned ancestor inside the scroller they escaped its clipping and widened the whole page (1644px at a 390px viewport). The list is now `relative`, with a comment and a test.
2. **Overlay caption leaked a third line (found by eye).** `line-clamp-2` plus vertical padding shows part of the next line in the padding. The vertical padding was replaced by `leading-5`.
3. **Orphan counts (found by eye).** A count shown beside a hidden name looked like a stray number, so it is no longer drawn visually (see Behavior).
4. A doc comment containing `…` made Tailwind generate a junk class from its scan. The comment was reworded.

**Keyboard / motion check (Chromium).**
- Tabbing 12 times into a 12-item RTL carousel scrolls to the last item, which is fully in view and `:focus-visible` with a 2px outline.
- `scroll-behavior` is `smooth` normally and `auto` under `prefers-reduced-motion: reduce`.
- Scroll snap is `x mandatory`.

**Not verified visually, and why.**
- Dark mode (D-13, out of scope).
- A real hydrated SSR page on Next. The harness renders client-side. SSR output is covered by `renderToStaticMarkup` tests, and the pre-hydration image-failure path is the VD-2 tile's own, already tested.
- Real store fonts (the harness uses system fonts, so glyph metrics differ slightly from production).

## Self-review

### Implementer
- The tile is used **unchanged** (its web twin is byte-enforced), so overlay and beside are done with CSS variants on the tile's last and first child. Both use `:not(.sr-only)` so a hidden label is never positioned.
- The empty-frame fallback (initial for "nothing set") is a VD-4b rendering decision on top of D-08. It was chosen so that a facet with some images and some none keeps an aligned grid, and so brands look intentional. A frameless label would also satisfy "never a broken image", but the grid would be ragged.
- With `showLabel=false`, a value that falls back to its initial shows its label (the tile's own VD-2 rule: nothing visual would remain). Its row is therefore taller than its siblings'. This is documented behavior, not a bug.

### Reviewer-style
- No Tailwind class name is built dynamically; every `--disc-*` consumer is a literal class (the harness confirmed they compile).
- The new scrim tokens live in `:root` with theme aliases. Merchant theming does not override them on purpose: a caption sits on an arbitrary photo, so the pair is fixed and proven.
- `Intl.NumberFormat(locale)` is used for the visible count (Latin digits in `ar` on this Node/ICU).

### Residual risks
- **Parser caps.** `parseListingFacets` keeps the first 40 values per group. `valueSort: count` therefore sorts within the first 40 the API listed. A facet with more than 40 live values and a top count beyond the 40th would miss it. The API order is the merchant's `sort_order`, and `maxItems` tops out at 24, so this is unlikely. Lifting it means changing the shared parser, which is outside this slice.
- **Name trimming.** A facet name that is blank after trimming now yields no section (the parser drops it), where the old code would have rendered it. The API requires a name, so this is theoretical. Value names are trimmed (the legacy code did not), which changes a legacy tile's bytes only for a name with surrounding whitespace.
- **Carousel bleed.** The scroller bleeds 8px past the content edge so focus rings are not clipped, so a partial neighbouring item shows 8px inside the page gutter. A full-bleed carousel would need the page gutter value, which the section does not know.
- **`rows` interpretation.** Two rows apply below `md` only (§3.7: "carousel, on mobile"). VD-4c should offer `rows` only for a carousel.
- **VD-5.** A real-image load on a deployed storefront (CDN/proxy, cache window) remains VD-5's browser verification.

## Accounting impact

**None.** No financial operation and no journal entry.

## Tenant / branch isolation, RBAC, API, DB

**None.** No model, query, endpoint, migration or permission. The facet data is the already-merged `store/v1` `meta.facets`, read through the existing parser. The proxy paths are the only image URLs that reach an `<img>` (the parser drops anything else). No merchant string reaches CSS: keys index closed lists or code constants, and integers are clamped at the render boundary.

## Backward compatibility

- A document with neither `layout` nor `template` renders **byte-identical** markup (golden tests).
- `display: tiles|chips` is still honoured when `layout` is absent.
- `fetchDiscoveryValues` keeps its result shape, and the new keys are absent when empty. Existing consumers and tests are unchanged.
- `globals.css` and the message catalogs are additive. `commerce/v1` and the web twins are untouched.
- Rollback: remove `layout` / `template` from a section and it returns to the legacy markup.

## Git state

- Branch: `feat/vd-4b-storefront-visual-renderer` from `origin/main` @ `a37d893`
- PR: not opened (as instructed). Head SHA: see the final message.
