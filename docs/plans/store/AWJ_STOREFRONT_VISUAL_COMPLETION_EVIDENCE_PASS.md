# AWJ Storefront Visual Completion — Evidence Pass

**Status:** Evidence complete for the surfaces this environment could render. Not a completion claim.  
**Verified `origin/main` SHA:** `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4`  
**Commit on that SHA:** `docs: LIVE-PREVIEW-1 Preview Contract Evidence Pass (#1013)`  
**Observed at:** 2026-09-25. Main had not moved past the SHA named in the task brief.  
**Method:** Current code and capability registers, not historical report status lines. Reports were used only to name intended UX.

## 1. What was verified before any code change

| Check | Result |
|---|---|
| `origin/main` | `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4`. No intervening commits. |
| Public storefront | `storefront/` Next.js. Routes under `src/app/[country]/[locale]/`. |
| Merchant Customizer | `web/src/modules/store-experience-builder/` at `/commerce/appearance`. |
| Dev harness | `storefront/src/app/dev/store-ui-5` and `store-ui-6`. Not production routes. |
| Theme registry | Closed presets only: `awj-modern`, `navy`, `burgundy`, `sand`, `slate` in `storefront/src/lib/presentation/tokens.ts`, the web twin, and `StorefrontPresentationNormalizer.php`. |
| Ready themes other than AWJ Modern | **Not in code.** `awj-market` and `boutique-floral-01` are specifications, not registered presets. |

## 2. Visual QA actually rendered

Playwright Chromium against `next dev` on port 3001. Console errors were the dev HMR websocket only (`ERR_INVALID_HTTP_RESPONSE` on `/_next/webpack-hmr`). No Laravel `store/v1` was running, so catalog/search/PDP/checkout with real products were **not** claimed as visually verified. Empty and shell states that render without the API were captured.

Artifacts: `docs/plans/store/storefront-visual-completion-qa/`.

| Surface | 390 | 430 | 768 | 1024 | 1280 | 1440 | Arabic RTL | English LTR | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Customizer dev harness `/dev/store-ui-6` | rendered | rendered | rendered | rendered | rendered | rendered | yes (`dir=rtl`, locale locked to `ar` by the harness page) | **not rendered** — harness has no locale query | Preview canvas + AWJ editor chrome. This harness is the storefront mirror, not the merchant web editor. |
| Account harness overview / orders-empty / sign-in | rendered | rendered | rendered | rendered | rendered | rendered | overview + empty orders | overview + sign-in | Designed gated account chrome. |
| Public home `/sa/ar` | rendered | rendered on retry (first capture raced paint) | rendered | rendered | rendered | rendered | yes | not this URL | Shell, hero, empty arrivals (“لا توجد منتجات”), footer. No published presentation (API down → defaults). |
| Public products `/sa/en/products` | shell | shell | shell | shell | shell | shell | switcher still offers AR | page copy followed `en` where the shell translated; some captures raced | Empty catalog, not a populated grid. |
| Public cart `/sa/ar/cart` | shell | shell | shell | shell | shell | shell | yes | not this URL | Empty-cart path without a live cart API. |
| PDP simple / variant | **unavailable** | | | | | | | | No product slug without the catalog API. |
| Checkout / confirmation | **unavailable** | | | | | | | | Requires a cart and checkout API. |
| Merchant Customizer on `web` `/commerce/appearance` | **not browser-rendered** | | | | | | | | Interaction covered by Vitest (`section-selection`, instances, editing). |
| Theme other than AWJ Modern | **unavailable as a ready theme** | | | | | | | | Color presets exist. Market / Floral do not. |

Do not read a screenshot as proof of a live commercial fact. Empty product shelves here mean the catalog API was absent, not that the store has no products.

## 3. Capability authority used for classification

Buyer capabilities: `storefront/src/lib/commerce/capabilities.ts`.  
Presentation capabilities: `storefront/src/lib/presentation/capabilities.ts`.  
Where `AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` still says delivery pricing is unpriced `DESIGN_ONLY`, the code is newer: `DELIVERY_PRICING_CAPABILITY = "live"`. Classification follows the code.

## 4. Matrix

Classification is exactly one of `COMPLETE`, `IMPLEMENTATION_READY`, `BACKEND_GATED`, `PRODUCT_DECISION_REQUIRED`, `DEFERRED`, `OUT_OF_SCOPE`.

| Surface | Desktop | Mobile | Arabic RTL | English LTR | Loading | Empty | Error | Disabled/Gated | Customizer parity | Current state | Evidence | Gap | Classification | Proposed action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shell / header / search / category nav / mobile nav / footer | Designed and used on public home | 390 home rendered; bottom nav is the mobile pattern | `dir=rtl` on `ar` | `DocumentShell` sets `dir` from locale | Suspense fallbacks for category/mobile nav | n/a | No route `error.tsx` | Header flags from published presentation, default on when unpublished | Preview canvas mirrors flags; header is not click-to-edit until the chrome PR | STORE-UI-1 + published chrome in `(storefront)/layout.tsx` | Code + home screenshots | Designed 404 is missing (`notFound()` uses the framework page) | IMPLEMENTATION_READY for the 404 only; shell otherwise COMPLETE | Next task: AWJ `not-found` inside the store shell. Do not invent a CMS. |
| Homepage implemented sections | Default stack renders | Same | RTL | LTR via locale | Category/product sections have their own empty handling | “لا توجد منتجات” seen | API failure becomes empty, not a fake catalog | Gated section types are not public | Preview renders the same four types from the draft | `page.tsx` + `HeroSection` / `CategoriesSection` / `NewArrivalsSection` / `WholesaleSection` | Screenshot + `resolveHomeSections` | **Published v2 deletion was resurrected** by `resolveHomeSections` after normalization. Fixed in the fidelity PR: `resolvePublishedImplementedSections` | IMPLEMENTATION_READY (fix in this horizon, not merged) | Keep the fix. No presentation at all still uses defaults. |
| Homepage gated sections (banner, featured, offers, benefits, customContent) | Preview dashed placeholder | Same | Both locales in the editor copy | Same | n/a | Placeholder, not a live band | n/a | Public renderer drops them | Duplicates look identical | `GATED_HOME_SECTION_KEYS`; contract is `{id,type,visible}` only | `tokens.ts`, preview canvas, CONTRACT-2 | No per-instance content payload. Offers must not invent prices | PRODUCT_DECISION_REQUIRED for a safe text/content shape; offers/featured product picks are BACKEND_GATED if they need catalog or promotion truth | Do not activate on the public store. |
| appPromo section | Preview placeholder even when URLs exist | Same | Copy exists | Copy exists | n/a | Hidden in preview when no safe URL | n/a | Public home drops the key. Footer app links are live when `showFooterLinks` and the URL is an allow-listed store host | Footer parity exists; homepage section does not | `MOBILE_APP_LINKS_CAPABILITY = live` for links, section still gated | `layout.tsx` footer vs `page.tsx` drop list | Homepage band would be presentation-only, but no approved section layout beyond the gated note | DEFERRED | Leave gated. Footer links stay the live surface. |
| Catalog / search / category | Listing components exist | Responsive classes exist | Message catalogs | Message catalogs | Skeletons exist | Empty-state copy exists | Filter failures are logged, not a full error page | No fake facets | Not a customizer page | `products/page.tsx`, `c/[...permalink]/page.tsx`, `ProductListing` | Code. Browser: empty shell only | Populated grid, filters, and category-not-found were not visually verified here | COMPLETE for the designed contract; populated visual QA is evidence-limited, not a new feature | Re-run visual QA against a real `store/v1` later. |
| Product card | Implemented | Implemented | Implemented | Implemented | Skeleton sibling | Imageless placeholder | Unavailable product has no add action | Wishlist heart is in-memory only | `productCard` compact is preview padding only | `ProductCard.tsx` | Unit tests + empty shelf screenshot | Published `productCard` / `density` are not applied on the public card | IMPLEMENTATION_READY | Follow-up: map published density/card style onto existing card padding without a second card component. |
| PDP / gallery / variants / qty / add to cart | Implemented for AWJ products | Implemented | Implemented | Implemented | Gallery has media states | Missing product calls `notFound()` | Not browser-verified | No reviews, no related products | n/a | `ProductDetails.tsx` | Tests, not this browser pass | None that invent commerce | COMPLETE as a designed PDP. Related/reviews stay DEFERRED | No code in this horizon. |
| Cart drawer + cart page | Implemented | Implemented | Implemented | Implemented | Line image fallback | `CartEmptyState` | Local error flags | Coupon field is honest and inert | n/a | `CartDrawer.tsx`, `cart/page.tsx` | Tests. Browser: empty shell only | No client-summed total (intentional) | COMPLETE | Keep server amounts. |
| Checkout stages + confirmation | Designed stages exist | Designed | Designed | Designed | Stage-local | Requires a cart | Not rendered here | Card/online payment design-only; cash methods live; tax row absent | n/a | `AwjCheckoutFlow` | Code + `PAYMENT_CAPABILITY`, `DELIVERY_PRICING_CAPABILITY`, `TAX_PRESENTATION_CAPABILITY` | Tax row must stay absent | COMPLETE for presentation. Tax is DEFERRED | Do not draw a tax line. |
| Auth | Register/sign-in/forgot/reset exist | Harness sign-in rendered at 390 | Harness EN sign-in rendered | Same | Account shell hides chrome while session loads | n/a | Form errors exist in components | n/a | n/a | Account auth pages + `AuthenticatedAccountShell` test | Harness screenshot | None found in this pass | COMPLETE | None. |
| Account overview / profile | Live session + profile update | Harness rendered | Harness | Harness | Loading gate tested | n/a | n/a | Phone remains read-only where the contract is | n/a | STORE-UI-5 | Harness + tests | None new | COMPLETE | None. |
| Orders / order detail / timeline | Designed | Designed | Designed | Designed | Designed | Live route passes `orders={[]}` plus gated notice | Detail does not load a real order | `ACCOUNT_ORDER_*` are `design_only` | n/a | Account order pages | Code + empty-orders harness | Must not fabricate orders | BACKEND_GATED | Keep the gated notice. |
| Addresses / wishlist page / saved payment methods | Designed inert UI | Designed | Designed | Designed | Designed | Honest empty/inert | Actions refuse success | `design_only` | n/a | Account components | Tests | No persistence | BACKEND_GATED | Do not write `localStorage`. |
| Policies route | Spree `getPolicy` if that backend answers | Not rendered | Not rendered | Not rendered | Not verified | Policy-not-found copy exists | Not verified | AWJ pages CMS is gated; this route is not that CMS | Customizer page toggles do not fill this body | `policies/[slug]/page.tsx` | Code | Spree HTML body is not an AWJ pages contract | OUT_OF_SCOPE for a new CMS. Existing route stays as-is | Do not paste merchant HTML. |
| WhatsApp / social / contact | Published footer + floating link when enabled and URL-safe | Same | Same | Same | n/a | Hidden when disabled or unsafe | n/a | WhatsApp does not send a message; it is a `wa.me` link | Preview showed real external `<a href>` that could leave the editor | `publishedWhatsAppHref`, layout | Code | Preview anchors could navigate away | IMPLEMENTATION_READY | Chrome PR prevents default in the editor and routes the click to the panel. |
| Business identity / verification | Legal name, CR, VAT from tenant identity can show. Merchant “verified” request does not mint a badge | Same | Same | Same | n/a | Hidden when absent | n/a | `BUSINESS_VERIFICATION_CAPABILITY = gated` | Preview keeps the request inert | Normalizer forces `requestedVerifiedLabel` false on the public snapshot | `StorefrontPresentationPublicRuntimeTest` | None to activate | BACKEND_GATED | Do not render موثّق from merchant text. |
| 404 / unavailable | Framework `notFound()` | Not a designed AWJ page | Unknown | Unknown | n/a | n/a | Default Next page | n/a | n/a | No `not-found.tsx` under the storefront segment | Repo search | Missing designed state | IMPLEMENTATION_READY | Separate small PR. Not started here. |
| Theme switching | Five color presets publish and paint `--store-primary*` | Same | Same | Same | n/a | Unknown preset fails closed to AWJ Modern | n/a | n/a | Preview uses the same tokens | `presentationCssVars` | Code | `density`, `productCard`, `accentColor` do not change the public page. Font preset is a single disabled choice | IMPLEMENTATION_READY for density/product card. Accent/font stay DEFERRED (no second font, accent unused) | Do not register Market or Floral in this horizon. |
| Customizer desktop shell | Standalone, no Commerce sidebar | n/a | RTL default | LTR control exists on the web builder | Save blocked without a store id | n/a | Publish failure copy exists | Version history control explains it is deferred | Canvas is the merchant surface | `ExperienceBuilder.tsx` | Vitest + harness screenshot at ≥768 | Undo/redo absent | COMPLETE for the approved shell. Undo is DEFERRED | None. |
| Customizer mobile | Preview-first, bottom sheet, section click opens settings | Harness at 390 still showed a 1280 canvas label (mirror differs from web, which forces 390 under 768) | RTL | Not harness-verified | Same | Same | Same | Same | Web tests switch `data-preview-viewport` | `section-selection.test.tsx` | Test, not a web screenshot | Harness is not the merchant editor | COMPLETE for the web editor’s approved mobile pattern | Do not treat `/dev/store-ui-6` as the production editor. |
| Click-to-edit header / logo / footer | Was missing | Was missing | Both | Both | n/a | n/a | n/a | Panels already exist | UX V2 §3.2 | V2-1 deferred it; V2-3 did not add it | `StorefrontPreviewCanvas.tsx` before this horizon | Fixed in the chrome PR: header, branding, footer, WhatsApp, social | IMPLEMENTATION_READY (fix in this horizon, not merged) | Keep selection as editor state, not presentation data. |
| Section add / reorder / duplicate / hide / delete | Arrow reorder, not drag | Bottom sheet | Both | Both | n/a | Picker disables singletons already present | n/a | Gated types stay badged | Public page must honor v2 delete (see homepage row) | `section-capabilities.ts` | Vitest 11+10+8 | DnD not required | COMPLETE | UX V2 says reorder must work without drag. |
| Draft / save / publish honesty | Live API when a store id exists | Same | Messages | Messages | `busy` states | No store → blocked, no fake success | 409 stale revision, publish failure | Version history deferred | Published snapshot only on the public GET | `ExperienceBuilder` lifecycle | Existing tests | Logo/display-name hints still said nothing is saved | IMPLEMENTATION_READY | Chrome PR corrects the hints. Data URLs already persist under the 512 KB cap. |
| Branding media upload | File input → data URL | Same | Same | Same | n/a | Typographic fallback | SVG/oversize become null | No object storage | Public `publishedLogoUrl` sanitizes | `sanitizeLogoUrl`, `MAX_LOGO_BYTES` | Persistence architecture § branding | A tenant media object is not an approved provider decision | PRODUCT_DECISION_REQUIRED | Do not add S3/upload in this horizon. |
| Undo / redo | Not built | Not built | n/a | n/a | n/a | n/a | n/a | n/a | n/a | No history stack | V2-1/V2-2/V2-3 | Explicitly future | DEFERRED | Do not invent a stack in this horizon. |
| Version history / restore | Restore-default resets the local draft only | Same | Copy says deferred | Copy says deferred | n/a | n/a | n/a | `VERSION_HISTORY_CAPABILITY = deferred` | n/a | Persistence architecture rejected revision tables | `capabilities.ts` | No published revision list | DEFERRED | Keep the confirm + client reset. |
| Per-instance section content | Not in the schema | Same | n/a | n/a | n/a | Duplicates share a placeholder | n/a | Public drop | Preview cannot show different banner copy | `PresentationHomeSection` | CONTRACT-2 | Adding a payload is a presentation schema decision, not commerce truth, but the field shape is not approved | PRODUCT_DECISION_REQUIRED | Decision packet only if a later task must choose the fields. Not opened: no safe default shape was specified. |
| Wishlist heart / compare / reviews / ratings / related / category imagery / compare-at merchandising / coupons / card payment / tax | Hearts and coupon field are designed and honest | Same | Same | Same | Where designed | Where designed | Where designed | design_only or absent | n/a | Capability file | Code | Activating them would fake commerce | BACKEND_GATED or DEFERRED as already recorded in `capabilities.ts`. Reviews, related, comparison, category imagery, tax: DEFERRED (nothing honest to turn on) | No implementation. |

## 5. Material gap notes

### 5.1 Published homepage resurrection — IMPLEMENTATION_READY

`normalizePresentationConfig` / the PHP normalizer already treat v2 absence as deletion. `fetchStorefrontConfig` normalizes before the page renders. `page.tsx` then called `resolveHomeSections`, which appends any missing implemented section. A merchant who deleted Categories still got Categories on the public homepage. Preview did not.

Fix stays inside the render seam. No API, schema, or price change. Empty published implemented list stays empty. `presentation === null` still uses the default stack (backward compatible).

### 5.2 Chrome click-to-edit and stale hints — IMPLEMENTATION_READY

UX V2 §3.2. Panels `header`, `branding`, `footer`, `whatsapp`, `social` already exist. Selection is editor state. External preview anchors called `preventDefault` so the editor does not navigate to `wa.me` or a social URL.

`logoHint` / `displayNameHint` claimed the logo and name were session-only. `branding.displayName` and capped raster data URLs already round-trip through draft/publish. The hint now says that, including the 512 KB cap and the SVG rejection. It does not claim a file-storage upload exists.

### 5.3 Not started, still IMPLEMENTATION_READY

- Designed storefront `not-found` (shell + bilingual empty state, no new data).
- Public application of published `density` and `productCard` (padding/rhythm only).

These do not depend on merging the two fixes above. They were left so the open PRs stay reviewable. They are not closed.

### 5.4 Explicitly not implementation

Branding object storage, per-instance content fields, undo/redo, version history, DnD, `awj-market`, `boutique-floral-01`, payment, coupons, tax, wishlist persistence, order history, addresses, saved cards, reviews, related products, category imagery, verification badge, pages CMS.

## 6. Invariants checked, not changed

Tenant isolation, `commerce.manage`, draft secrecy, published-only public payload, server-side money, no arbitrary merchant HTML/CSS/JS, URL/media sanitization, `CommerceOrder != Invoice`, fail-closed unknown section types, stores with `presentation: null` keep AWJ Modern defaults.
