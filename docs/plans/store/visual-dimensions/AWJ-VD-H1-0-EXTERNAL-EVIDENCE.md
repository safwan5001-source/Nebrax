# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — H1-0 External Evidence

DATE ACCESSED: 2026-10-14
METHOD:
- Playwright 1.56.1 with Chromium at desktop 1440×900 and mobile 390×844 (locale `ar-SA`).
- Screenshots were **viewed**, and computed styles and DOM were read.
- Official docs were fetched directly, plus MDN browser-compat-data and web-features Baseline data.
- Third-party screenshots are kept in the session evidence folder and **are not committed to the repository**. Their names are listed at the end.

> **SEEN** = what the source actually shows. **INFERENCE** = our reading. **AWJ DECISION** is in the Decision Register only.

## A. Visual references

### A1. FNP Saudi — https://www.fnp.sa/ (Arabic by default, `dir=rtl`)

**SEEN:**
- **The «هدايا لكل مناسبة» section:**
  - Occasion tiles (يوم المدير، أكتوبر الوردي، يوم ميلاد، التخرج، مولود جديد…).
  - **Shape:** an Islamic arch, aspect 3:4 (`aspect-ratio: .75`).
  - **The arch is baked into the AVIF image.** `clip-path: none` and `mask: none`, with `object-fit: contain` and `loading="lazy"`.
- **Desktop:** a horizontal scroller with 180×240 tiles, about 6.5 visible. The prev/next arrow sits on the left, which is the "next" side in RTL.
- **Mobile (verified visually):** the scroller becomes **two rows**. Each column holds 2 tiles of about 97×130, and the next column peeks in to signal that it scrolls.
- **Label:** overlaid on the bottom of the image (`absolute bottom-0`). Because the image background is light, it reads as if it sits under the image.
- **Click:** goes to a dedicated path (`/gifts-birthday`). That page is a product listing whose facet sidebar includes «المناسبة».
- **Recipient:** not shown as tiles on the home page. It is a menu link with the recipient encoded in the path.
- **Accessibility:** `<a aria-label="…">` containing an `img alt="…"` and visible text (the name is repeated three times).

**INFERENCE:**
- Baking the shape into the image forces a designer to pre-compose every image.
- The two-row mobile layout fits more than 10 occasions into a small height.

### A2. Floward — https://floward.com/ar-sa

**Blocked:** Cloudflare returns 403 to every attempt, and there is no Wayback capture. **No evidence collected.**

### A3. Salla — Raed theme (official source + Salla's official preview images)

The public demo store returns 410, and the theme marketplace requires a login. We fell back to the official source:
- https://raw.githubusercontent.com/SallaApp/theme-raed/master/twilight.json
- `src/views/components/home/main-links.twig`

**SEEN (verified visually from the official preview):**
- The «روابط سريعة» component is a `salla-slider type="carousel"` with 1/6-width slides on desktop.
- Each item is either an **icon** chosen by the merchant (`sicon-*`) or a category image `w-16 h-16 object-cover rounded-full` (a 64px circle).
- **If the category has no image, the template falls back to the icon.**
- The preview shows white rounded cards with the icon above an Arabic label, plus «عرض الكل».

### A4. Shopify Dawn — "Collection list"

The demo home page does not include the section. Evidence comes from the official source: `sections/collection-list.liquid` and `snippets/card-collection.liquid`.

**SEEN:**
- `image_ratio` is adapt / portrait / square (default).
- `columns_desktop` is 1–6 (default 3). `columns_mobile` is 1–2. `swipe_on_mobile` is optional.
- Maximum 15 blocks.
- **A collection without an image is rendered as a text card (`card--text`)**, with no placeholder image.

## B. Official documentation

| Source | What it says | Relevance |
|---|---|---|
| Shopify Search & Discovery — filters (help.shopify.com/en/manual/online-store/search-and-discovery/filters) | Filter values can carry a colour, a pattern or an image. Images are for "icons, logos, or other graphics that shouldn't be cropped". "Themes will often prioritize displaying a swatch's image over its color". | Visual identity for a filter value is an established practice. Fallback order is image → colour/icon. |
| Shopify Liquid `swatch` (shopify.dev/docs/api/liquid/objects/swatch) | "Color and image for visual representation" for filter values and option values. | The visual identity is attached to the **value** and reused across surfaces. |
| MDN `clip-path` | `url()` references an SVG `<clipPath>`. `polygon()` takes percentages and scales with the element. `path()` uses fixed coordinates and **does not grow with the element**. Baseline: `clip-path` on HTML elements since 2020; `shape()` is only Baseline low (2026). | Supports D-09 and §3.4: polygons for star/diamond/hexagon, `objectBoundingBox` for curves, and no `path()` or `shape()`. |
| MDN `clipPathUnits` | `objectBoundingBox`: coordinates are relative to the element's bounding box (1 unit). | Responsive curved shapes (heart/vase/arch). |
| MDN `mask-image` | Masking by alpha channel. Baseline widely available (2026). | A valid alternative, but not needed since `clip-path` covers everything. |
| MDN `object-fit` / `object-position` | `cover` clips, `contain` letterboxes, `object-position` aligns the content. Baseline 2020. | Framing via CSS (D-09). |
| WCAG 2.2 — 1.1.1 / images tutorial | An image inside a link that already has a text label gets `alt=""`. An image-only tile needs an alt that names the destination. | §3.9: the tile name is always the link's accessible name. |
| WCAG 2.2 — 2.5.8 | Minimum target size is 24×24 CSS px. | Our 44px minimum goes beyond it. |
| WCAG 2.2 — 1.4.11 | 3:1 contrast for visuals that identify the control and for the focus indicator; photos are exempt. | Icon-colour contrast check (§3.9). |
| OWASP File Upload Cheat Sheet | Allow only the image types you need; decode and re-encode; beware of XML parsers (XXE/bombs). It does not name SVG explicitly. | INFERENCE: SVG is executable XML, so no SVG upload. Icons come from a code-owned set (D-10). |

## C. Patterns across references (SEEN), and how AWJ uses them

| Pattern | Seen at | How AWJ uses it |
|---|---|---|
| The tile is a **real link** to a listing page, not an in-page filter | FNP, Salla, Dawn | Unchanged: `products?facet[key]=slug` (ADR-21) |
| Grid with configurable columns, or a horizontal scroller | Dawn (grid 1–6 / 1–2), Salla and FNP (carousel) | Five layouts + columns per device (§3.7) |
| **Two-row carousel on mobile** | FNP | **Added** as the optional `rows` field (1 or 2) for `carousel` on mobile, and the default of the `swipe-rail` template |
| Shape as a presentation setting, or baked into the image | Dawn/Salla (setting), FNP (baked) | Shape as a presentation setting over a single original (amendment 3). Baking is rejected because every image would need pre-composing. |
| No image → icon or text card, never a broken image | Salla (icon), Dawn (text) | Fallback chain image → icon → text (§3.6) |
| Mobile column minimum is 1 for large cards | Dawn | Mobile `columns` range is 1–4 |
| Short Arabic labels under the media or over its bottom | FNP, Salla | `textPosition: below | overlay` |
