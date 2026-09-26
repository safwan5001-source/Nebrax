# AWJ Store Customizer — Visual Verification Report

**Status:** Closed. No deploy.  
**Date:** 2026-09-26  
**Verified `origin/main` at start:** `b0ec2f0941f6168716ac3a117b6a8debb697da42`  
**Pass document base:** `298908cb3d5c8809f6bce34e1abacc6c2f1a0695` (parent of the pass commit; latest main already contained the pass).

This is the browser pass the capability-completion closure left open. It is not a new feature horizon. Offers stay `PRODUCT_DECISION_REQUIRED`.

## What was rendered

No merchant session and no populated published store were available, same constraint as the closure. Evidence uses the real components, not a second authoring surface:

| Surface | Harness | Production? |
|---|---|---|
| Merchant preview | `web` dev route `/dev/customizer-visual` mounts `StorefrontPreviewCanvas`, the canvas `/commerce/appearance` already mounts. Click-to-edit chrome handlers are on, so the logo is a button and not also a link. | The route 404s when `NODE_ENV=production`. |
| Published storefront | `storefront` dev route `/dev/customizer-visual` mounts `BannerBand`, `BenefitsBand`, `CustomContentBand`, `FeaturedShelf`, and `AppPromoBand` — the same components `app/[country]/[locale]/(storefront)/page.tsx` mounts. Featured calls real `fetchProduct` against a local catalog fixture. | The route 404s when `NODE_ENV=production`. |
| Storefront `/dev` mirror | `?surface=harness` mounts the existing storefront `ExperienceBuilder`. | Inspected only to classify harness drift. |

Viewports: `390, 430, 768, 1024, 1280, 1440`.  
Locales: Arabic `dir=rtl`, English `dir=ltr`.  
Preview device flag follows the editor: mobile under 768, tablet at 768, desktop from 1024. The editor itself only frames 390 / 768 / 1280; the extra widths are the published page and the canvas at that CSS width.

Screenshots: `docs/plans/store/customizer-visual-verification/`.  
Populated content was captured at all six widths, both locales, both surfaces. Empty, long, missing-media, and missing-product were captured at 390 and 1440 (long also at 768). Every cell was also measured in the browser (`document.scrollWidth` versus `clientWidth`, plus overflowing nodes). A cell is not marked from code inspection alone.

Catalog fixture used by `FeaturedShelf`: `rose-01` (name, English name, SAR 85.00, thumbnail), `rose-nophoto` (no thumbnail), `rose-long` (unbroken token name), `missing-prod` (HTTP 404). Price and stock come from that response, not from the presentation document.

## Evidence matrix

Legend: **PASS** = no horizontal page overflow and the section state matches the published contract. **P3** = noted, not fixed.

### Populated

| Surface | Locales | Widths | Result |
|---|---|---|---|
| Merchant preview | ar, en | 390, 430, 768, 1024, 1280, 1440 | **PASS** for banner, benefits, custom content, featured ids, app promo, offers gate. |
| Published | ar, en | same | **PASS**. Featured renders the catalog card (باقة ورد جوري / Garden rose bunch, 85.00 SAR) and drops nothing when the id exists. |

Reviewed shots include `preview-populated-ar-390.jpg`, `preview-populated-en-1440.jpg`, `published-populated-ar-1280.jpg`, `published-populated-en-390.jpg`.

Arabic is RTL and English is LTR on both surfaces. New bands use logical layout (`flex`, grid, `md:flex-row`). No physical `left`/`right` utility was added. No control was mirrored onto the wrong side.

### Empty

| Surface | Behavior | Result |
|---|---|---|
| Preview | Banner, benefits, custom content, and featured stay visible as labeled shells so the merchant can still select them. Offers stays the promotions gate. App promo without store URLs is the dashed "add the Apps link" note. | **PASS** (editor must keep the instance) |
| Published | Homepage omission rules: empty banner, benefits, custom content, featured, and app promo render nothing. Offers is skipped. | **PASS** |

Shots: `preview-empty-en-1440.jpg`, `published-empty-ar-390.jpg`.

### Long unbroken text

Before the fix, a token within the normalizer limits (banner title 120, benefit title 80, benefit body 200, paragraph 600) expanded the document to about 1040–1164px at every width through 1024, on both the preview canvas and the published bands. That is a horizontal-scroll defect. Classified **P2** and fixed (below). After the fix, remeasured at 390, 768, and 1440 for Arabic and English on both surfaces. Document `scrollWidth` matched `clientWidth` (English preview was at most 1px over, scrollbar rounding, not the previous ~1000px overflow). The token box itself wraps. Shot: `published-long-ar-390.jpg`.

### Missing optional media

Banner with text and no image still shows the title, subtitle, and CTA. A featured id whose catalog row has `thumbnail_url: null` uses the existing product-card placeholder, not a broken image. App promo with both store URLs empty is omitted on the published page and shown as a non-published note in preview. **PASS.** Shots: `preview-missing-media-ar-390.jpg`, `published-missing-media-en-1440.jpg`.

### Missing product reference

| Surface | `rose-01` + `missing-prod` | Result |
|---|---|---|
| Preview | Both ids render as chips. The existing hint says only the id is stored and price, stock, and availability stay on the catalog. | **PASS** (intentional; preview must not invent a price) |
| Published | `fetchProduct` 404 is dropped. Only the live rose card remains, with the server price. | **PASS** |

Shot: `published-missing-product-ar-390.jpg`, `preview-missing-product-en-1440.jpg`.

### Preview ↔ published parity

| Capability | After this pass | Classification |
|---|---|---|
| Banner | Preview now uses the same stacked-to-row composition as `BannerBand` (`flex-col`, `md:flex-row`, image `md:w-56`). CTA renders only when the label exists and the href is `https://` or a same-site path, matching the published band. | Aligned |
| Benefits | Preview grid is `sm:grid-cols-2 lg:grid-cols-3`, matching the published band. | Aligned |
| Custom content | Both are heading + paragraph, plain text, `max-w-3xl`, wrapping. | Aligned |
| Featured | Preview shows ids plus the catalog hint. Published shows product cards. This is the locked contract (no copied price). | Accepted divergence, not a defect |
| App promo | Both are a footer-colored band with App Store / Google Play when the allow-listed URLs exist, and hidden or non-published when they do not. | Aligned |
| Offers | Preview gate. Published skip. | Unchanged, still gated |

### Chrome

On the merchant canvas, header and footer are not buttons. The logo control is a button and `StoreBrand` is not a link while click-to-edit is on (`linked={false}`). No nested interactive control was found in the new bands.

## Harness drift

**Decision: the storefront `/dev` customizer mirror is non-authoritative. It was not updated.**

`storefront/src/components/customizer/StorefrontPreviewCanvas.tsx` still falls through banner, benefits, custom content, and featured to the old dashed placeholder. Captured at 1280 Arabic (`harness-ar-1280.jpg`) with those sections visible and filled. The canvas showed the labels and the sentence "هذا القسم مصمَّم للمعاينة. لا يُنشر على المتجر الحي قبل وجود عقد بياناته." It did **not** show the authored title "ورد الموسم وصل". The merchant surface remains the web experience builder. Updating the mirror would create a second authoring surface, which this pass forbids.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| P2 | Unbroken authored text overflowed the viewport on the preview canvas and the published banner, benefits, and custom-content bands. | Fixed. `break-words` / `min-w-0` on those bands and the matching preview nodes. Featured shelf items are `min-w-0`. Featured id chips use `break-all`. |
| P3 | Preview footer link column overflows by roughly 30px at 390 (and the English shop column at 768) because fixture category names do not wrap. Present on the empty scenario too, so it is not caused by the new sections. | Not fixed. Pre-existing preview chrome, outside this pass. |
| — | Offers, Market, Floral, undo/redo, version history. | Out of scope. |

No P1. No tenant, permission, price, stock, or HTML-execution change. Text is still React text. Banner images stay `https`. No migration.

## Fix

Tests: `storefront/src/components/home/__tests__/SectionBands.test.tsx` (3 passed).

`PRE_MERGE_REVIEW` is posted on the pull request against the exact head after CI is green. `POST_MERGE_REVIEW` is posted against the merge SHA. No deploy.

## Not done

- Production deploy, release, or production migration.
- An offers / promotions engine.
- Another horizon.
