# AWJ Store Customizer Capability Completion — Evidence Pass

**Task:** STORE-CAP-0  
**Verified `origin/main` at start:** `a48c132e820b1c39da032f0f46ec29de4d136f7d`  
**Documented horizon base (older):** `1a0cac9863e48eb4eb2e4870e1f0aa70878382af`  
**Governing decision:** `AWJ_STORE_CUSTOMIZER_BUILD_DONT_HIDE_DECISION.md`

The newer SHA is the horizon-definition commit itself (`#1027`). This pass uses that SHA, not the older documented base.

## What the code actually does

Presentation contract v2 stores homepage instances as `{id, type, visible}`. Unknown keys are dropped. v1 `{key, visible}` migrates to `id = key`. v2 absence is deletion. `presentation: null` still uses the default implemented stack.

Public homepage (`storefront/.../page.tsx` before this horizon) rendered only `hero`, `categories`, `newArrivals`, `wholesale`. The other six types were in `GATED_HOME_SECTION_KEYS` and the merchant preview drew a dashed placeholder.

`apps.iosUrl` / `apps.androidUrl` / `apps.appName` / `showHomepageSection` / `showFooterLinks` already exist. Footer links are live when the URL is an allow-listed store host. The homepage flag did not render a band.

`sales.promotions` is `coming_soon`. ADR-11 defers coupons/promotions and says a future engine must be Commerce-Core shared, after a financial review. There is no `commerce.promotions` resource. Storefront product reads are tenant-scoped (`fetchProduct` → `store/v1/products/{id}`).

Click-to-edit chrome (`web/.../StorefrontPreviewCanvas.tsx`) put `role="button"` on `<header>` and `<footer>` while the logo control and footer links were also interactive. That is nested interactive content.

## AWJ decisions taken inside this horizon

These are not new pricing, storage, or RBAC architectures.

1. **Optional per-instance `content` stays on contract version 2.** Missing content is empty. Empty content is omitted, so old `{id,type,visible}` documents stay stable. Unknown content keys are dropped. Text is plain text. No HTML/CSS/JS/iframe field exists.
2. **Banner fields** are title (120), subtitle (200), ctaLabel (80), ctaHref (https or same-site path), imageUrl (https only). No data-URL image and no new object store — that remains the branding-storage decision gate.
3. **Benefits** are up to 6 `{id,title,body}` items. **Custom content** is up to 8 `heading|paragraph` blocks. **Featured** stores up to 8 product ids and no price, stock, tax, or discount. The published page resolves ids through the existing tenant catalog and drops misses.
4. **App promo** reads the existing apps object. It renders only when the section is visible and at least one allow-listed store URL exists. The Apps toggle and the section visibility stay in sync. No QR and no store badge without a URL.
5. **Offers stay unpublished.** See the decision packet. The merchant still sees the section, with an honest gate, not a hidden control and not a fake discount.

## Matrix

| Capability | Merchant UI | Data contract | Persistence | Preview | Published runtime | RTL/LTR | Mobile/Desktop | Classification | Evidence | Gap | Required action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hero, categories, newArrivals, wholesale | Live | v2 instance + global hero copy | Live | Live | Live | Locale `dir` | Existing sections | COMPLETE | Prior visual horizon + current page | None in this horizon | Do not rebuild |
| banner | Was gated placeholder | Optional content, this pass | Normalizer persists non-empty content | Merchant canvas renders text/CTA/https image | Public `BannerBand` when any field is set | Inherits page dir | Existing store container | IMPLEMENTATION_READY | `StorefrontPresentationNormalizer`, both TS twins, preview canvas | Was `{id,type,visible}` only | Build in this horizon |
| featured | Was gated | product ids only | Same | Ids shown; prices not copied into the canvas | `FeaturedShelf` via `fetchProduct` | Same | Product card grid | IMPLEMENTATION_READY | `store/v1/products/{id}` is tenant-scoped | Must not copy financial truth | Build in this horizon |
| offers | Visible, gated badge | No promotion document | Content key is stripped | Honest gate copy | Not rendered | Copy in ar/en | Same chrome | PRODUCT_DECISION_REQUIRED | ADR-11, `sales.promotions` coming_soon, empty promotions registry | Building offers would invent prices or a second engine | Decision packet. Do not implement |
| benefits | Was gated | Structured items | Normalizer | Item list | `BenefitsBand`, blank items omitted | Same | Grid | IMPLEMENTATION_READY | Same contract as banner | No icon registry in the presentation contract | Build without icons |
| appPromo | Apps fields already exist; section was gated | Existing `apps` object | Live | Band only with a real store URL | `AppPromoBand` | Same | Same | IMPLEMENTATION_READY | Footer already allow-lists Apple/Google hosts | Homepage did not consume them | Build from those fields |
| customContent | Was gated | heading/paragraph blocks | Normalizer | Text blocks | `CustomContentBand` as text nodes | Same | Same | IMPLEMENTATION_READY | UX V2 forbids free-form HTML | No executable markup | Build structured blocks only |
| chrome click-to-edit | Live | Editor state only | n/a | Header/logo/footer | n/a | Both | Both | IMPLEMENTATION_READY | Nested `role=button` in `StorefrontPreviewCanvas` | Invalid nesting | STORE-CUSTOMIZER-CLEANUP-1 |
| branding file storage | Data URL cap | Unchanged | Unchanged | Unchanged | Unchanged | n/a | n/a | PRODUCT_DECISION_REQUIRED | Persistence architecture | New object storage is out of scope | Do not open |
| undo / version history / Market / Floral | Unchanged | Unchanged | Unchanged | Unchanged | Unchanged | n/a | n/a | DEFERRED | Prior closure | Owner did not expand this horizon | Do not start |

## Visual QA

Not claimed in this evidence pass. The implementation PR must record what was actually rendered. Widths required by the horizon: 390, 430, 768, 1024, 1280, 1440. This sandbox has no PHP runtime, so PHPUnit is CI-only.
