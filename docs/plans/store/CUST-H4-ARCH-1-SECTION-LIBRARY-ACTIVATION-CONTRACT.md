# CUST-H4-ARCH-1 — Section Library & Real Section Activation Contract

**Horizon:** CUST-H4 — Section Library & Section Quality (named and scoped in `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:585-646`)
**Status:** Architecture/Evidence draft — awaiting owner review. No runtime code, schema, or API changed by this task.
**Author:** Claude (session `session_011sFWxaxv1beYdzjrNt9RXn`), 2026-10-01. Revised 2026-10-01 per owner correction on PR #1150 (see Revision Notes below).

---

## Revision Note 1 (owner correction, 2026-10-01)

The owner reviewed the first version of this document on PR #1150 and issued a correction: **Offers must not close H4 as permanently GATED.** The instruction is explicit — where a merchant-visible section has no authoritative source today, H4 must define and build the *smallest bounded* real Commerce contract needed to make it genuinely functional, not hide it. The owner set firm boundaries on that contract: no price/stock/tax/discount/campaign truth may live in `StorefrontPresentationConfig`; Commerce stays authoritative; presentation may hold only references; do not build a broad promotions engine unless evidence proves it's needed; if a genuine architecture/security blocker makes even a bounded contract unsafe, stop and escalate rather than silently gating.

This revision:
- Replaces §23 with a bounded Offers Commerce contract (§23.1–§23.6) — no blocker was found that makes it unsafe, so Offers is redesigned as a target-LIVE capability, not re-gated.
- Updates §5's `categories`/`newArrivals`/`featured`/`offers` rows, since new evidence (gathered specifically for this correction) shows the Canvas/Published parity gap on `categories`/`newArrivals` is fixable with an already-shipped API, not permanent debt.
- Revises the implementation slice sequence (§35), Definition of Done (§39), and every section this change touches (§24, §30, §31, §33, §34, §36–§40).
- Everything **not** touched by this revision note — banner, benefits, customContent, appPromo's LIVE status, the Salla/Zid evidence, the generic contract, the UX sections — is carried forward unchanged from the first version; it was not reopened.
- This document still only documents architecture. No runtime code, schema, or API was created in this repository by this task. The new Offers table/endpoints described below are a design for a future implementation slice (§23.6, H4-6/H4-7), not work performed here.

## Revision Note 2 (owner correction, 2026-10-01)

A second review on PR #1150 corrected §23.5's public Offers route: the first revision proposed `GET /api/store/v1/storefronts/{id}/offers`, which does not match AWJ's existing production public-storefront authority model (every `store/v1` read today is Host-resolved via `ResolveStorefrontDomain` → `StorefrontContext`, with no storefront/tenant identifier in the URL, query, body, or any client-controlled header). Re-verified directly against `routes/api_storefront.php`, `app/Http/Middleware/ResolveStorefrontDomain.php`, and `app/Tenancy/StorefrontContext.php` for this correction.

This revision:
- Corrects the public route to `GET /store/v1/offers` — no storefront id, same middleware group and authority chain as `products`/`categories`/`storefront`/`cart` (§23.5).
- Separates the "Canvas preview" read from the public read: Canvas is merchant-authenticated and legitimately storefront-id-scoped via the existing workspace route (§23.4); only the *public* Published read needed correcting. Parity between the two is now described correctly as structural at the shared `StorefrontOfferResolver` **service** level, not the HTTP route level.
- Adds 8 explicit tenant-isolation/host-authority tests to §30, required before H4-6 can be considered done.
- Updates §23.6, §30, §32, §35 (H4-6/H4-7), §36–§40 to reflect the corrected route and the added test requirements.
- Does not change the already-approved bounded Offers design otherwise: `storefront_offers` remains curation/scheduling-only (no price/discount/percentage column), `CommercePriceResolver`/`Product.sale_price` remain the price authority, non-genuine discounts remain silently omitted, and no promotions engine is introduced.

---

## 1. Executive decision

The owner's instruction for this Horizon is: *visible in the merchant Section Library ⇒ real persisted contract, real Canvas renderer, real Published renderer, real data source where required, normalization/validation, responsive behavior, accessibility, parity tests — no fake sections.*

Evidence gathered directly from `origin/main` at the Base SHA below **changes the shape of the problem from what the task brief assumed**:

- Five of the six sections the brief names as activation targets — **banner, benefits, customContent, featured, appPromo** — already have a real typed content contract, a real server-authoritative normalizer, a real Canvas (editor) renderer, and a real Published (storefront) renderer today. This was built in an earlier slice (`STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md`) and is covered by passing tests on both the `web/` and `storefront/` sides. They are **LIVE**, not `DESIGN_ONLY`, with one real residual gap on `featured` (N+1 product fetch) and cosmetic/consistency gaps common to all.
- The sixth, **offers**, had a closed, owner-signed decision as of the first version of this document: `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md`, resolved 2026-09-26, Option 1 — stay gated. **The owner has since superseded that decision on this PR** (see Revision Note above): no commerce promotions/discount/campaign *engine* exists anywhere in the repository (confirmed again below, independently, against current `main`), but a genuinely authoritative, already-trusted, read-only product pricing service (`App\Services\Commerce\CommercePriceResolver`, already used by the real Cart V1 checkout path) *does* exist — and that is enough to build a small, bounded, honest Offers capability without inventing any new pricing logic. §23 defines that bounded contract. CUST-H4's Offers target is now **LIVE end-to-end**, not GATED.
- The actual uncompleted CUST-H4 work, per the Horizon Roadmap's own CUST-H4 scope (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:585-646`) and per CONTRACT-2's own explicit deferral (`STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md` §10/§24), is the **Section Library / Picker UX layer** (search, categories, thumbnails, descriptions, honest capability badges), the **capability-state + multi-instance metadata** that the current registry does not yet formalize, the **Offers bounded Commerce contract** (§23), and **wiring Categories/NewArrivals' Canvas preview to the real tenant-scoped catalog read API that CUST-H2-3/H2-4 already shipped** (§5, §21) — not rebuilding section content contracts that already exist for banner/benefits/customContent/appPromo.

This document is therefore an *activation and library* contract for nine of the ten sections, plus a *bounded build* contract for the tenth (Offers). Section 5 below gives the full truth matrix section by section; sections 18–23 give per-section activation contracts; section 35 gives the revised implementation slice sequence.

---

## 2. Base SHA and evidence scope

- **Base SHA (verified via `git fetch origin main` + `git rev-parse origin/main` at task start):**
  `1fa57c597c71ef17d3dcc520cd81bda138430d1c` — `docs(store): close CUST-H3 Store Identity horizon (#1148)`.
- All repository claims in this document were re-verified by direct file reads against this commit (three parallel evidence passes: editor/admin side, published/runtime side, prior-horizon-docs synthesis), not reused from memory or stale reports.
- Scope was deliberately narrow, per the task brief: Section Registry, section capabilities, Section Picker, homepage section instance model, section content contracts, presentation config, normalizers, Canvas renderers, Published storefront renderers, product/catalog read seams, app configuration, promotion/discount contracts, media handling, relevant tests, and the H1–H3 contracts/reports that bear on H4. No broad repository rediscovery was performed.

---

## 3. Repository sources inspected

**Editor/admin (`web/`):**
`web/src/modules/store-experience-builder/presentation/tokens.ts`, `section-capabilities.ts`, `section-content.ts`, `home-sections.ts`, `capabilities.ts`, `config.ts`, `page-regions.ts`, `page-region-registry.ts`; `web/src/modules/store-experience-builder/ControlPanels.tsx`, `ExperienceBuilder.tsx`, `StorefrontPreviewCanvas.tsx`, `messages.ts`; `web/src/modules/store-experience-builder/__tests__/section-capabilities.test.ts`; `web/src/app/(commerce)/commerce/appearance/section-editing.test.tsx`, `section-instances.test.tsx`.

**Published/runtime (`storefront/`):**
`storefront/src/app/[country]/[locale]/(storefront)/page.tsx`; `storefront/src/lib/home/sections.ts`; `storefront/src/lib/presentation/{config,section-content,public,page-runtime,public-rhythm,capabilities,page-regions,tokens}.ts`; `storefront/src/components/home/{HeroSection,CategoriesSection,NewArrivalsSection,WholesaleSection,BannerBand,BenefitsBand,CustomContentBand,FeaturedShelf,AppPromoBand}.tsx`; `storefront/src/components/products/NewArrivals.tsx`; `storefront/src/lib/data/products.ts`; `storefront/src/lib/presentation/__tests__/{config,public}.test.ts`.

**Backend (Laravel):**
`app/Support/ApplicationCatalog.php`; `app/Models/ProductMedia.php`; `app/Http/Controllers/Api/StorefrontMediaController.php`; `database/migrations/*storefront_presentations*`, `*storefront_presentation_versions*`; full-repo grep across `app/Models`, `app/Http/Controllers`, `routes/api*.php`, `database/migrations` for promotion/discount/campaign/offer/price-rule.

**Added for revision 1 (Offers bounded contract evidence):**
`app/Services/Commerce/CommercePriceResolver.php`, `app/Models/PriceList.php`, `app/Models/PriceListItem.php`, `app/Models/Product.php` (`sale_price` accessor, `discount`/`discount_type` fields), `app/Http/Controllers/Api/StorefrontProductController.php`, `app/Http/Controllers/Api/CommerceWorkspaceStorefrontProductController.php`, `app/Services/AppBuilder/DataResourceRegistry.php`; `storefront/src/lib/spree/{index,surface,config}.ts`, `storefront/src/lib/commerce/{products,config,mappers,types}.ts`; `web/src/modules/commerce-workspace/{workspace-products,workspace-categories}.ts`; `web/src/modules/store-experience-builder/{ProductPreviewPicker,ProductPreviewPickerPanel,ProductRegionInspector,CategoryPreviewPicker,CategoryPreviewPickerPanel,CategoryRegionInspector}.tsx`; `routes/api.php` (commerce workspace storefront routes); `docs/plans/store/ADR-11-COMMERCE-PROMOTIONS-DEFERRAL.md` (full text), `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md` (Preview Context Model), `docs/reports/CUST-H2-3-IMPLEMENTATION-REPORT.md`, `docs/reports/CUST-H2-4-IMPLEMENTATION-REPORT.md`, `docs/reports/CUST-H2-HORIZON-CLOSURE-REPORT.md`.

**Added for revision 2 (public storefront authority correction):**
`routes/api_storefront.php` (full `store/v1` route group and its header comment, §25-49), `app/Http/Middleware/ResolveStorefrontDomain.php` (full file), `app/Tenancy/StorefrontContext.php` (full file), re-read `app/Http/Controllers/Api/StorefrontProductController.php:38-58` specifically for its `StorefrontContext` usage pattern.

**Prior horizon docs (`docs/plans/store/`, `docs/reports/`):**
`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md`, `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md`, `AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`, `STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md`, `AWJ_STORE_CUSTOMIZER_BUILD_DONT_HIDE_DECISION.md`, `AWJ_STORE_CUSTOMIZER_UX_V2.md`, `AWJ_STOREFRONT_DESIGN_SYSTEM.md`, `ADR-11-COMMERCE-PROMOTIONS-DEFERRAL.md`, `CUST-H3-ARCH-1-IDENTITY-CONTRACT.md`, `docs/reports/CUST-H3-HORIZON-CLOSURE-REPORT.md`, `CUST-H2-ARCH-1-PAGE-CONTRACT.md`.

Every finding below is traceable to one of these files with file:line citations as given by the evidence passes.

---

## 4. Current section inventory

The ten declared homepage section type keys (`HOME_BUILDER_SECTION_KEYS`, `web/.../presentation/tokens.ts:82-93`, mirrored byte-for-byte in `storefront/src/lib/presentation/tokens.ts:69-80`):

`hero · categories · newArrivals · wholesale · banner · featured · offers · benefits · appPromo · customContent`

`IMPLEMENTED_HOME_SECTION_KEYS` (`tokens.ts:98-100`) — derived from the narrower legacy `storefront/src/lib/home/sections.ts:12-17` list — names only `hero, categories, newArrivals, wholesale` as the "always-implemented" set; this label predates CONTRACT-2 and is stale relative to what the renderer actually does today (see §5). `GATED_HOME_SECTION_KEYS = ["offers"]` (`tokens.ts:102`) is the only section the codebase itself currently flags as not-live.

---

## 5. Capability truth matrix

Capability states used: **LIVE**, **PARTIAL**, **DESIGN_ONLY**, **GATED**. A partial capability is never flattened into LIVE.

| Section | Registry entry (`section-capabilities.ts`) | Typed content contract | Normalization/validation | Draft persistence | Published persistence | Canvas renderer | Published renderer | Real data source | Empty/missing-data | Responsive | RTL/LTR | A11y | Tests | **State** | **Exact blocker** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **hero** | max 1, no dup, no delete (`:35`) | No — global `heroHeadline`/`heroSubheadline` (`config.ts:107-8`), by design (singleton, document-global) | Yes, via `normalizePresentationConfig` | Yes | Yes | Live, real text (`StorefrontPreviewCanvas.tsx:500-524`) | Live, `HeroSection.tsx` | Config only, no fetch | Falls back to store name / i18n "shop" string | `isMarket` density variants | gradient + chevron flip, `<bdi>` isolation | `aria-labelledby`, `id` landmark | Direct (`section-editing.test.tsx:109-143`) | **LIVE** | None |
| **categories** | max 1, no dup, delete ok (`:36`) | No — catalog-managed | n/a | Yes | Yes | **Mock** static `PREVIEW_CATEGORIES` (`Canvas:526-569`) — deliberate, per `preview-fixtures.ts:14-18`'s own comment: "not AWJ commerce facts... labeled as fixtures so they cannot be read as the live store" | **Real** `getCategories({depth_eq:0})` (`CategoriesSection.tsx:123`) | Real catalog API | `[]` on fetch error; section omitted if empty | `isMarket` tile-count/grid variant | logical CSS only | `aria-labelledby`, `alt` per tile | Visibility/order test only | **LIVE** (visibility/order); **Canvas/Published parity gap — now fixable, targeted for H4** | The blocker CUST-H2-ARCH-1 originally named for this ("no authenticated `commerce.manage` catalog read endpoint exists") **is now closed**: `GET /api/commerce/workspace/storefronts/{id}/categories` shipped and merged in CUST-H2-4 (PR #1129). H4-3 wires Canvas to it, replacing the mock fixture |
| **newArrivals** | max 1, no dup, delete ok (`:37`) | No — catalog-managed | n/a | Yes | Yes | **Mock** static `PREVIEW_PRODUCTS` (`Canvas:571-612`), same deliberate-fixture pattern as categories | **Real** `cachedListProducts(...).sort:-available_on` (`NewArrivals.tsx:38-47`) | Real catalog API | `[]` → dashed empty-state card | Carousel (market) vs grid | inherited from ProductCard | `Suspense`/skeleton, `aria-labelledby` | Reorder test only | **LIVE** (visibility/order); same parity gap as categories, **same fix** | `GET /api/commerce/workspace/storefronts/{id}/products` shipped and merged in CUST-H2-3 (PR #1119, `workspace-products.ts`). H4-3 wires Canvas to it |
| **wholesale** | max 1, no dup, delete ok (`:38`) | No | n/a | Yes | Yes | Static placeholder text only (`Canvas:614-628`) | Real: gated by `isWholesaleEnabled()` addon flag, intentionally static/no-fetch (`WholesaleSection.tsx:13-14,22`) | Addon flag only, by design | Returns `null` if addon disabled | 2-col on `lg` | none explicit | `aria-labelledby`, `id` | Singleton/duplicate-disabled test | **LIVE** | None — editor placeholder text is intentional per component's own comment |
| **banner** | unlimited, dup ok, delete ok (`:39`) | Yes — `BannerContent{title,subtitle,ctaLabel,ctaHref,imageUrl}` + `normalizeBanner`/`isEmptyBanner` (`section-content.ts:14-20,142-161`) | Yes, `sanitizeExternalUrl` on href/image | Yes | Yes | Live, authored content (`Canvas:630-665`) | Live, `BannerBand.tsx`; dropped if all fields empty (`page.tsx:152-161`) | Merchant-authored only | Placeholder in editor; section omitted when empty in Published | `md:flex-row` | none explicit | `aria-labelledby`, image `alt=""` (decorative, not merchant-described) | Generic instance tests only; no banner-specific test found | **LIVE** | Minor a11y gap: banner image has no merchant-authored alt text field |
| **featured** | unlimited, dup ok, delete ok (`:40`) | Yes — `FeaturedContent{productIds}`, max 8 (`section-content.ts:42-44,196-208`) | Yes, id-shape + dedupe + cap | Yes | Yes | Shows only ID **text chips**, no price/image resolve (`Canvas:707-723`) | Live, `FeaturedShelf.tsx`; resolves each id via **`Promise.allSettled(productIds.map(id => fetchProduct(id)))`** — N individual fetches, not batched (`FeaturedShelf.tsx:25-30`) | Real catalog API, per-product fetch | Failed/missing ids silently dropped; `null` if all fail | Carousel (market) vs grid | inherited from ProductCard | `aria-labelledby` | Generic instance tests only | **PARTIAL → target LIVE in H4** | (1) Editor has no real product picker — raw ID text input only. **Fix path confirmed real and low-risk**: `GET /api/commerce/workspace/storefronts/{id}/products` (tenant-scoped, paginated, search/category-filterable) already exists and already powers `web/src/modules/commerce-workspace/workspace-products.ts`, used today by CUST-H2-3's Product-page picker — reuse the data layer; the existing picker *UI* (`ProductPreviewPicker*`) is single-select and CUST-H2-coupled, so Featured needs a new, small, multi-select picker component built on the same data layer, not a new endpoint. (2) Published renderer does N unbatched product fetches — needs a batched `ids[]` filter on `StorefrontProductController::index` (additive, see §21) |
| **offers** | unlimited, dup/delete **not gated at this layer** (`:41`) | Target: `OffersContent{offerIds}` — same shape precedent as `FeaturedContent.productIds` (§23.3); content carries **zero price/discount data**, only references | Fail-closed by design, extended per §23.3 | Yes (today `{id,type,visible}` only; `content.offerIds` additive) | Yes (same) | Target: live, resolves real `storefront_offers` + live price comparison via the new public Offers read (§23.5), same pattern as Featured | Target: live, new `<OffersBand>`/`<OffersShelf>` component reading the same public Offers read as Canvas — single resolution path, true parity by construction | **New, bounded**: `storefront_offers` (scheduling/curation only) + existing `CommercePriceResolver`/`Product.sale_price` for live price truth — **no new pricing logic**, see §23 | A curated product with no currently-genuine discount (price not actually below base) is silently omitted — same fail-closed pattern every other optional section already uses | Reuse Featured's carousel/grid pattern | Reuse Featured/ProductCard patterns | `aria-labelledby`, reuse ProductCard a11y | None yet — new tests required in H4-7 | **GATED today → target LIVE in H4** (§23) | No authoritative Commerce promotions/discount *engine* exists and none is being built. What's missing instead is a thin curation+scheduling table and two small, read-only, additive API surfaces — not a schema/security blocker. See §23 for the full bounded design, and the Revision Note for why this supersedes the original decision packet |
| **benefits** | unlimited, dup ok, delete ok (`:42`) | Yes — `BenefitsContent{items}`, max 6, `{id,title,body}` (`section-content.ts:22-30,163-176`) | Yes | Yes | Yes | Live, authored items (`Canvas:667-686`) | Live, `BenefitsBand.tsx`; dropped if no item has title/body (`page.tsx:172-174`) | Merchant-authored only | Placeholder in editor; omitted when empty in Published | `sm:grid-cols-2 lg:grid-cols-3` | `break-words` | `aria-labelledby` | Generic instance tests only | **LIVE** | None found. No icon field (task brief allows "optional icon if safely supported" — not yet present; not a blocker to LIVE, a future enhancement) |
| **appPromo** | max 1, no dup, delete ok (`:43`) | No dedicated `SectionContent` entry — content lives in `config.apps{iosUrl,androidUrl,appName,showHomepageSection,showFooterLinks}` (`config.ts:143-149,254-260`) | Yes — `isSafeAppStoreUrl`/`isSafePlayStoreUrl` + `sanitizeExternalUrl`, 80-char `appName` cap (`config.ts:526-534`) | Yes | Yes | Conditionally live: real app-store badges if `hasApps`, else placeholder (`Canvas:726-759`) | Live, `AppPromoBand.tsx`; `null` if neither URL validates (`AppPromoBand.tsx:21-23`) | Real, merchant-authored app URLs (Apps settings panel, not this section's own panel) | `null` section when no real URL | flex-wrap button row | none explicit | Uses `OfficialStoreBadge` sub-component | Generic instance tests only; no dedicated appPromo content test | **LIVE** | Content is authored from a separate "Apps" settings panel, not this section's own Content tab — a UX consistency gap (see §22), not a functional one |
| **customContent** | unlimited, dup ok, delete ok (`:44-49`) | Yes — `CustomContent{blocks}`, max 8, `{id,kind:"heading"\|"paragraph",text}` (`section-content.ts:38-40,178-194`) | Yes, bounded to two safe kinds | Yes | Yes | Live, authored blocks (`Canvas:688-705`) | Live, `CustomContentBand.tsx`; dropped if no block has non-empty text (`page.tsx:185-187`); accordion variant on `awj-market` theme (`:66-67,112-115`) | Merchant-authored only, structured blocks | Placeholder in editor; omitted when empty in Published | prose vs accordion | `break-words` | `aria-labelledby`, native `<details>/<summary>` disclosure | Generic instance tests only | **LIVE** | None found. No HTML/iframe/embed exists — confirms the brief's safety requirement is already met |

---

## 6. Current Section Picker

No dedicated Section Picker component exists. The "add section" UI is inline in `ControlPanels.tsx:1046-1073` (`data-section-picker`): one `<button data-picker-option>` per `HOME_BUILDER_SECTION_KEYS` entry, showing **translated label text only — no thumbnails, no descriptions, no icons, no categories, no search**. Disabled when the type is a maxed-out singleton or `MAX_HOME_SECTIONS=30` (`config.ts:66`) is reached. The only honesty signal present is a small `gatedBadge` pill ("Not enabled" / "غير مفعّل") shown next to `offers` in both the picker list (`:1063-1067`) and the composer row list (`:1124-1128`). This is a real, working, non-deceptive gate — it is just minimal. This is exactly the gap the Horizon Roadmap names for CUST-H4 (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:589-598`).

## 7. Current Canvas rendering

`StorefrontPreviewCanvas.tsx` holds one render branch per section type (`:500-780`), orchestrated by `ExperienceBuilder.tsx` which owns `selectedSection` state and composes `<ControlPanels>` + `<StorefrontPreviewCanvas>` but contains no per-section rendering logic itself. Per-type behavior is detailed in §5. The two honest exceptions to "live preview of authored content" are (a) `categories`/`newArrivals`, which preview static mock arrays instead of live catalog data (a pre-existing, deliberately-labeled, non-fabricating gap — targeted for a real fix in H4-3, §5, §21), and (b) `offers`, which today renders only the gated placeholder (targeted to render real curated+resolved content in H4-6/H4-7, §23).

## 8. Current Published rendering

`storefront/src/app/[country]/[locale]/(storefront)/page.tsx` is the single entry point. `fetchStorefrontConfig()` returns the **Published** config only (`page.tsx:47`) — Draft is unreachable from the public runtime, consistent with the Draft/Published separation established in `AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`. `publishedNodes()` (`page.tsx:120-234`) dispatches on `section.type`, with an explicit `if (!section.visible || section.type === "offers") continue;` (`page.tsx:142`) as the runtime enforcement of the Offers gate, independent of (and redundant with) the normalizer-level content-stripping already covered by `config.test.ts:238-291`.

## 9. Existing content contracts

`section-content.ts` exists **in duplicate**, byte-for-byte identical, in both `web/src/modules/store-experience-builder/presentation/section-content.ts` and `storefront/src/lib/presentation/section-content.ts` — the `web/` copy's own header comment states this explicitly ("twin of storefront/.../section-content.ts. Keep the two normalizers aligned."). Same duplication pattern for `page-regions.ts`. This is a real, acknowledged maintenance risk (two files that must be hand-kept in sync) but not a correctness bug today — it is flagged for H4 to decide whether to formalize (see §34).

## 10. Existing data dependencies

- `categories`/`newArrivals`: live catalog reads (`getCategories`, `cachedListProducts`) on the Published side, already batched per request (not per-item); Canvas side still mock, targeted for a real-data fix in H4-3 using the already-shipped `commerce/workspace/storefronts/{id}/{products,categories}` endpoints (§5, §23's sibling finding).
- `featured`: real per-id product reads, **not batched** (§5, §21); editor has no real picker.
- `wholesale`: a boolean addon flag only, no data fetch by design.
- `appPromo`: config-only (merchant-entered URLs), no external fetch.
- `banner`/`benefits`/`customContent`: merchant-authored content only, no fetch.
- `offers`: today none. Target: a new, bounded, read-only resolution combining `storefront_offers` (curation/scheduling, no price data) with the existing `CommercePriceResolver`/`Product.sale_price` (live price truth) — see §23.

---

## 11. Salla evidence

First-party pages actually opened and inspected (not summarized from search snippets):

1. **`https://docs.salla.dev/422558m0` — "Themes Home Page"** (screenshot captured and visually inspected). Shows the Home Page template's file location (`src/views/pages/index.twig`) and an example wireframe render: header/nav, a hero/banner block, then a 6-up row of square image placeholders, then a 3-up row of larger cards — i.e. Salla's home page is explicitly composed of stacked, independent, reusable blocks, matching AWJ's own section-list model.
2. **`https://docs.salla.dev/422580m0` — "Twilight Theme Components Overview"** (screenshot captured and visually inspected). Contains a first-party infographic titled "Twilight Theme Components" with four **component categories**: **Home Components** ("Banners & Video, Testimonials, Sliders & Parallax, Trust Features, Products Sections & More"), **Header Components**, **Footer Components**, **Products Components** ("**Offers**, Color/Size/Image, Multiple Options, Product List, Comment Form, Quick Search, Similar Products & More"). This is the first-party confirmation that Salla treats "Offers" as a **product-detail-page** component (tied to live SKU/price truth), not a free-standing homepage marketing section — evidence that offers-type UI should always be tied to authoritative price data, which is exactly the principle AWJ's bounded Offers contract (§23) follows: real, live-resolved prices, never an invented percentage.
3. Search evidence (not independently screenshot-verified, used only as corroborating text): `docs.salla.dev/421921m0` ("Twilight.json") documents that home-page "Theme Features" are a closed, named list declared in a theme manifest (`component-` prefixed keys) — a schema-declared registry, same shape as AWJ's `HOME_BUILDER_SECTION_KEYS`.

A direct attempt to reach Salla's **merchant-facing** Theme Editor help article (`help.salla.sa/article/67562780`, "إدارة وتخصيص تصميم الثيم") returned a 404 at the URL surfaced by search — recorded honestly rather than fabricating its content. No merchant-editor screenshot from Salla's help center was obtained; the Twilight developer-docs infographic above is the actual visual evidence used.

## 12. Zid evidence

First-party pages actually opened and inspected (screenshots captured and visually inspected):

1. **`https://docs.zid.sa/theme-development` — "Theme Development"**. States a theme combines "Jinja templates, settings schemas, and assets," and gives an explicit numbered flow: understand architecture → learn Jinja → explore templates → (continues to settings/sections). Confirms a **schema-driven** editor model (merchant-visible settings come from a JSON schema file, not ad hoc code).
2. **`https://docs.zid.sa/architecture-1379322m0` — "Architecture"**. Shows the literal theme directory tree:
   ```
   sections/
     slider.jinja
     slider.schema.json
   components/
     pagination.jinja
   templates/
     home.jinja
     cart.jinja
     product.jinja
   layout.jinja / layout.schema.json
   footer.jinja / footer.schema.json
   header.jinja / header.schema.json
   ```
   Each section is a **markup + schema pair**; the schema is what the Theme Editor UI renders as merchant-facing settings. This is first-party confirmation of a pattern AWJ already effectively has (typed `SectionContent` per type + a normalizer), just not formalized as an on-disk schema file.
3. Search evidence (not independently screenshot-verified): Zid's docs describe sections as able to "render multiple components to build complex layouts," with components as the reusable sub-unit — a two-level composition model (section → components) that AWJ does not currently need, given AWJ's sections are self-contained.

---

## 13. Visual screenshot evidence matrix

| Source | Page/Document | Screenshot inspected | Observed pattern | Why it matters | Useful for AWJ? | AWJ decision |
|---|---|---|---|---|---|---|
| Salla | Themes Home Page (`docs.salla.dev/422558m0`) | Yes | Home page = stack of independent reusable blocks (hero, image grid, cards) | Confirms the section-stack model is the industry-standard shape | Yes | **Already exists in AWJ** (homepage.sections array) |
| Salla | Twilight Theme Components Overview (`docs.salla.dev/422580m0`) | Yes | 4-category component taxonomy incl. "Offers" filed under **Products**, not Home | Offers tied to live product/price data in Salla too, not a free-standing marketing claim | Yes | **Adopt the principle**: AWJ's Offers gate (no price invention) matches Salla's own architecture, not a weaker position |
| Zid | Theme Development (`docs.zid.sa/theme-development`) | Yes | Theme = templates + settings **schemas** + assets | Schema-driven settings is the categorical pattern both competitors use | Yes (partial) | **Adapt**: AWJ keeps its TS-typed contract (already equivalent in effect) rather than introducing a parallel JSON-schema file format — no evidence a file-based schema format is required for H4 |
| Zid | Architecture (`docs.zid.sa/architecture-1379322m0`) | Yes | Section = markup + schema pair; section vs. component as two composition levels | Confirms "one section = one typed settings contract" is correct; two-level section→component nesting is not needed for AWJ's current section set | Yes (partial) | **Reject** the two-level nesting as unnecessary for H4 — AWJ sections are self-contained; revisit only if a future section genuinely needs sub-components |

---

## 14. External Evidence vs AWJ Decisions

**External Evidence** (Salla, Zid — benchmark only, not requirements):
- Both competitors render the homepage as a stack of independently toggleable, typed blocks.
- Both expose a declared/schema list of available block types to the merchant-facing editor.
- Salla explicitly places "Offers" under Product components (live price/SKU-bound), not under Home components.
- Zid's taxonomy is schema-file-driven; Salla's is manifest-driven (`twilight.json`).

**AWJ Decision:**
- AWJ already implements the "stack of typed blocks" pattern (`homepage.sections: PresentationHomeSection[]`) — no architectural change needed.
- AWJ keeps its existing TypeScript contract (`SectionContent` + normalizer) as the "schema." Introducing a parallel on-disk JSON-schema file format is **rejected** for H4 — no merchant-facing or technical need identified, and it would duplicate the existing fail-closed normalizer without adding capability.
- Salla's practice of tying "Offers" to live product/price truth, not free-standing marketing claims, is the exact principle AWJ's bounded Offers contract (§23) follows — the offer price shown is always resolved from the same authoritative pricing path checkout uses, never an invented percentage. The evidence reinforces *how* Offers should be built honestly, not that it should stay unbuilt.
- AWJ's taxonomy (§15 below) is adopted from the existing Horizon Roadmap (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:600-608`), which already reflects evidence gathered in an earlier horizon pass (`§2` of that same roadmap file references Salla benchmark work) — this task's fresh Salla/Zid evidence corroborates rather than contradicts it, so the existing taxonomy is kept rather than re-derived from scratch.

---

## 15. Target Section Library UX

Per `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:589-598`, the Section Picker must support: search, categories, clear thumbnails/previews, short descriptions, compatibility/gated state, and "most used/recent" only where evidence supports it (no evidence of usage telemetry exists today — **omit** "most used" from H4's scope; revisit only if usage data becomes available). Additional states the current registry doesn't yet expose but the picker must render honestly: **already-added** (relevant for duplicable types), **max-instance-reached** (already enforced in code via `canAddSectionType`, just not visibly explained in the picker today), and **current-page compatibility** (today only `home` exists as a page type for sections; CUST-H2's `PageType` registry is `"home"|"product"|"category"` — Home sections are not yet modeled in that registry, see §17).

## 16. Target taxonomy

Adopted verbatim from the existing roadmap (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:600-608`), validated against the current 10-key registry rather than kept merely because the roadmap listed it:

| Category (Arabic) | English | Sections that map to it today |
|---|---|---|
| المنتجات | Products | featured |
| التصنيفات والتنقل | Categories & Navigation | categories, newArrivals |
| العروض والتسويق | Offers & Marketing | offers (target LIVE, §23), wholesale |
| الصور والفيديو | Images & Video | banner, hero |
| المحتوى | Content | customContent |
| الثقة والخدمات | Trust & Services | benefits |
| التطبيق والتواصل | App & Communication | appPromo |

All seven categories have at least one real mapped section — **no empty category** is created, satisfying the task's explicit instruction not to keep empty categories merely because the roadmap listed them.

## 17. Generic section contract

Reusing CONTRACT-2 (`STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md`) as the base, extended with the fields CONTRACT-2 itself explicitly deferred to "the Section Picker PR" (§10, §24 of that report):

| Field | Source today | H4 change |
|---|---|---|
| Stable type key | `HOME_BUILDER_SECTION_KEYS` (closed registry) | Keep |
| Instance id | `PresentationHomeSectionV2.id`, safe-id pattern `/^[a-zA-Z0-9_-]{1,64}$/` | Keep |
| Allowed page types | Not modeled for Home sections (CUST-H2's `PageType` registry covers only product/category regions) | **Document as deliberately out of scope**: Home sections remain their own registry; CUST-H2-ARCH-1 itself flagged unifying them as optional future cleanup, "not required for CUST-H2 V1" — H4 inherits that same non-requirement |
| Max instances / singleton | `SECTION_CAPABILITIES[type].maxInstances` | Keep, **expose in Picker UI** (today enforced but not explained) |
| Duplicate/delete rules | `SECTION_CAPABILITIES[type].canDuplicate/canDelete` | Keep |
| Hide/show | `visible` flag, uniform across all types | Keep |
| Typed content | `SectionContent` union (4 of 10 types) | Keep; no change needed for the 4 that already have it |
| Typed visual settings | Not a separate concept today — visual choices (density, theme) are global, not per-section | **Document as deliberately out of scope** — no evidence any H4 target section needs per-instance visual settings beyond content |
| Defaults | `DEFAULT_HOME_SECTIONS`, per-type content defaults | Keep |
| Validation/normalization | `normalizeOptionalSectionContent`, per-field sanitizers | Keep |
| **Capability state** | **Not a first-class field** — inferred indirectly from `GATED_HOME_SECTION_KEYS` + UI copy | **Add**: formalize `state: "live" \| "partial" \| "gated"` per type in `SECTION_CAPABILITIES`, sourced directly from this document's truth matrix (§5), so the Picker can render state honestly without re-deriving it from scattered constants |
| Safe URL rules | `sanitizeExternalUrl`, `isSafeAppStoreUrl`/`isSafePlayStoreUrl` | Keep |
| Media rules | https-URL-only for banner image; no upload | **Document gap**, see §24 — not solved in H4 |
| Data dependency / authority | Documented per-type in §5/§10 | Formalize as a field alongside `state` |
| Empty state / missing data | Documented per-type in §5 | Keep existing behavior; no section currently violates "fail closed" |
| Responsive rules | `isMarket` density variants, Tailwind breakpoints | Keep |
| RTL/LTR | logical CSS, `<bdi>`, gradient/chevron flips | Keep; extend consistently where currently "none explicit" (see §25–§28) |
| Accessibility | `aria-labelledby` landmarks on every section | Keep; close the one named gap (banner alt text, §18) |
| Canvas renderer | `StorefrontPreviewCanvas.tsx` per-type branch | Keep |
| Published renderer | `page.tsx` + per-type component | Keep |
| Preview/Published parity | Mostly true; two named exceptions (categories/newArrivals mock preview), plus Offers today (no Canvas/Published parity at all, since neither renders real content) | **Fix in H4**: categories/newArrivals wired to the real workspace catalog API (H4-3); Offers built with Canvas and Published sharing one server-side resolution path by construction, so parity is structural, not tested-after-the-fact (H4-6/H4-7) |
| Tests | Generic instance tests + per-type where they exist | Add Picker-level tests (search/category/badge rendering) in H4 implementation slices |
| Backward compatibility | Proven by `config.test.ts` legacy-migration suite | Keep; any new `state`/metadata field must be additive and optional, never required on old stored documents |

---

## 18. Banner activation contract

**Current state: LIVE.** No new persistence, renderer, or data source needed. Residual items for H4:
- Add a merchant-authored `imageAlt` field to `BannerContent` (currently `alt=""` hardcoded in `BannerBand.tsx:33`) — a real accessibility gap, small and additive (optional string, defaults to empty, never required).
- Expose capability state honestly in the Picker (`live`).
- No change to `ctaHref`/`imageUrl` sanitization (`sanitizeExternalUrl` already covers safe internal/external link behavior).

## 19. Benefits activation contract

**Current state: LIVE.** No new persistence, renderer, or data source needed. Residual items:
- Optional icon field was named in the task brief ("optional icon if safely supported"). No icon system exists anywhere in the Store Customizer today (no icon picker, no icon asset pipeline). Adding one is a **new capability**, not an activation of an existing one — **out of scope for H4**, documented as a future enhancement, not a blocker to LIVE.
- No layout variants — evidence shows no real design need identified (single grid layout serves both themes via `isMarket` responsive variant already).

## 20. Custom Content activation contract

**Current state: LIVE and already safe.** `CustomBlock{kind:"heading"|"paragraph",text}` is a closed, bounded, structured-block model — confirmed no arbitrary HTML, no iframe/embed, no inline code anywhere in `customContent`'s contract or renderer. This already satisfies the task's explicit prohibition. No change needed.

## 21. Featured Products activation contract

**Current state: PARTIAL, target LIVE in H4-5.** Re-investigated for this revision with a direct answer on both named gaps — neither needs a new backend endpoint:

1. **Editor-side product picker**: today the Content tab is a raw product-ID text input (`FeaturedFields`, `ControlPanels.tsx:997-1007`), not a real searchable product picker. **Confirmed real fix path**: `GET /api/commerce/workspace/storefronts/{id}/products` already exists (`commerce.manage`-gated, tenant-scoped via session `SetTenant`, supports `search`/`category_id`/`page`/`per_page`, shipped and merged in CUST-H2-3, PR #1119), and its data layer (`web/src/modules/commerce-workspace/workspace-products.ts`, `listWorkspaceProducts()`) is already used by `ExperienceBuilder.tsx` today for CUST-H2's Product-page preview picker. The *data layer is directly reusable as-is*. The existing picker *UI components* (`ProductPreviewPicker.tsx`/`ProductPreviewPickerPanel.tsx`) are **not** directly reusable — they're single-select and bound to CUST-H2's unpersisted "which product am I previewing" editor state (`ProductPreviewPickerPanel.tsx:10-11`); Featured needs its own small multi-select picker component built on the same `workspace-products.ts` data layer, not a new endpoint.
2. **Published-side N+1 fetch**: `FeaturedShelf.tsx:25-30` resolves each `productId` via its own `fetchProduct(id)` call (`Promise.allSettled`). No batched "products by ids" read exists in `storefront/src/lib/data/products.ts` today, and the underlying public endpoint it calls (`StorefrontProductController::index`, `store/v1/products`) supports `search`/`category_id`/`sort`/`page`/`per_page` but was not confirmed to support an `ids[]` filter. **Target fix**: add a small, additive `ids[]` query filter to `StorefrontProductController::index` (no schema change — it's a query-param addition to an existing read endpoint) and a `fetchProductsByIds()` client helper, replacing the N unbatched calls with one batched read.
3. The contract already correctly stores **presentation-only** data (`productIds`, ordering implicit in array order) and never copies price/stock/discount — this part needs no change. Missing/deleted/unpublished products are already handled safely (`Promise.allSettled` drops failures silently, section omitted if all fail) — this fallback behavior is correct and should be kept exactly as-is.
4. Max selected products: already capped at 8 (`MAX_FEATURED_PRODUCTS`). No change needed.
5. This same `ids[]`-filtered batched read (item 2) is also the right foundation for Offers' public resolution read (§23.5) — one new query capability serves both fixes.

## 22. App Promo activation contract

**Current state: LIVE**, contrary to the task brief's framing. `config.apps{iosUrl,androidUrl,appName,showHomepageSection,showFooterLinks}` is real, validated (`isSafeAppStoreUrl`/`isSafePlayStoreUrl`), and already drives both the Canvas (`hasApps` conditional real badges) and Published (`AppPromoBand.tsx`, `null` when no valid URL) renderers. The repo does not invent app availability — it reads real merchant-entered URLs and renders nothing when they're absent or unsafe, exactly as required.

The only residual item: content is authored from a separate "Apps" settings surface, not from this section's own Content tab in `ControlPanels.tsx` (which shows only a static note). This is a **UX consistency gap** (violates the "every section editor follows Content/Design/Layout/Advanced" rule for its own instance), not a functional or data-honesty gap. H4 should surface the same Apps fields inline in the appPromo section's own Content tab (reusing the existing config fields and validators, no new contract) so merchants don't have to leave the section they're editing — implementation detail for a future slice, not this task.

## 23. Offers data/truth decision

**Superseded in this revision.** The first version of this document affirmed the existing `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md` (Option 1, stay gated). The owner reviewed that and issued a correction on PR #1150: Offers must become a real, LIVE, end-to-end section in H4, built on the smallest bounded Commerce contract that keeps Commerce authoritative and presentation reference-only. This section documents that contract, re-derived from fresh, independent evidence against the current Base SHA — not from the earlier gated conclusion.

### 23.1 What stays true from the original evidence

Re-confirmed, unchanged:
- `ApplicationCatalog.php:80-85`: `sales.promotions` (a full merchant-facing promotions *application*) maturity is still `coming_soon`.
- `docs/plans/store/ADR-11-COMMERCE-PROMOTIONS-DEFERRAL.md` (full text re-read for this revision) confirms **zero implementation of a coupon/discount/campaign engine** exists — no `Coupon`/`Discount`/`Promo` model, migration, service, or route anywhere. Its accepted decision: *"When eventually built, the promotion system must be Commerce-Core/shared... Financial/order-total review is a prerequisite before implementation begins... sequenced after the Payment Intent model (ADR-09)."* Its explicitly open question: *"Whether any coupon/promotion capability is ever in scope at all."*
- `app/Services/AppBuilder/DataResourceRegistry.php` confirms `commerce.promotions` has no backend resource on the `commerce/v1` surface today.
- `Product.discount`/`discount_type` (`Product.php:38,46`) are inert, advisory-only fields — not consumed by `CommercePriceResolver`, `StorefrontProductController`, or `InvoiceService`. `Invoice.discount`/`InvoiceLine.line_discount` are document-level manual adjustments applied only inside a specific transaction being written — neither is a usable "which products are currently on sale" source.
- `PriceList`/`PriceListItem` (`app/Models/PriceList.php`, `PriceListItem.php`, both re-read in full for this revision) are a **different concept**: a sales clerk's manually-selected customer/tier pricing override on an invoice draft, `CompanyWide`-scoped, with **no time-bounding columns at all**. Reusing/repurposing them for a storefront marketing "offer" would conflate two different business meanings in one row and was rejected.

### 23.2 What's new in this revision — the seam that makes a bounded contract possible

- **`App\Services\Commerce\CommercePriceResolver`** (`app/Services/Commerce/CommercePriceResolver.php`) is a real, already-shipped, read-only price resolution service. Its own header comment states its role precisely: *"اقتراح، لا محرك مالي"* ("a proposal, not a financial engine") — it does not store or invent a price, it coordinates existing authoritative sources (`PriceListService`, `Product.sale_price`, unit conversion) and returns a `ResolvedCommercePrice` (amount in minor-unit bigint, real `Tenant.currency`, a `source` tag, never a hardcoded currency). Per its own docblock it is the exact service that powers a real cart line (**"سطر سلة تجارة — Cart V1"**) — i.e. the number it resolves is, today, already the number an anonymous customer's cart would charge.
- **`Product.sale_price`** (`Product.php:312-329`) is the product's own base/reference price — a computed accessor over `ProductUnitPrice`, not a raw column, but a real, stable, already-public value (exposed via `store/v1/products`).
- **The public storefront's own view-model already has an unused slot for this**: `storefront/src/lib/commerce/mappers.ts` hard-codes `original_price: null` / `prior_price: null` today (lines ~233, ~291, ~411) — the Spree-derived UI components this storefront reuses already expect an "original vs. current price" pair for strikethrough sale display; it has simply never been populated with real data.
- **A real, authenticated, tenant-scoped, paginated, search-capable product/category read already exists** for the merchant workspace (`GET /api/commerce/workspace/storefronts/{id}/products`, `.../categories`, shipped in CUST-H2-3/H2-4, PRs #1119/#1129) — the exact gap CUST-H2-ARCH-1 once named as blocking any real merchant-facing product picker is now closed.

Given these four facts, Offers does not need a promotions *engine* at all. It needs (a) a thin, non-financial table recording which products a merchant wants to *feature as potentially on offer* and when, and (b) a read that compares the product's already-public base price against the same live `CommercePriceResolver` result checkout would use, and shows the difference **only when it is genuinely, currently true**. This is a curation-and-honest-display layer over pricing decisions the merchant already makes elsewhere (editing `Product.sale_price` or their sales channel's price list) through the existing, already-reviewed pricing system — not a new pricing mechanism, not a coupon system, not a campaign/stacking engine, and not a change to checkout's amount-due math. This is why it does not require reopening ADR-11's deferral of a promotions *engine*: it builds nothing ADR-11 deferred.

### 23.3 The bounded contract

**New table — `storefront_offers`** (curation/scheduling only, zero price/discount columns):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `tenant_id` | uuid, FK, cascade-delete | `BaseModel` tenant scope, same pattern as every other tenant-scoped table in this document |
| `storefront_id` | uuid, FK | Ownership-checked via the same `ownedStorefront()` pattern `CommerceWorkspaceStorefrontProductController` already uses — foreign/missing → 404, never 403 |
| `product_id` | uuid, reference | Resolved the same way `PriceListItem.product()` resolves — `referenceBelongsTo`, outside branch scope but inside tenant scope; a foreign-tenant id simply fails to resolve (`Product`'s own `BaseModel` scope), same safe-failure pattern Featured's `productIds` already relies on |
| `starts_at` | nullable datetime | |
| `ends_at` | nullable datetime | |
| `is_active` | boolean, default true | Merchant on/off switch, independent of the validity window |
| `position` | integer | Merchant-controlled ordering |
| timestamps | | |

No `price`, `discount`, `percent`, or `price_list_id` column — deliberately. The table cannot express a discount; it can only say "consider this product for the Offers rail, optionally within this window." This is the central safety property: **it is architecturally impossible for a merchant (or a compromised client) to write an invented discount through this table**, closing exactly the failure mode Option 2 of the original decision packet warned about ("merchants type a percentage the cart will not honor").

**Resolution (new, read-only service, e.g. `App\Services\Commerce\StorefrontOfferResolver`)** — for each `storefront_offers` row where `is_active` and within its validity window:
1. `referencePrice = Product.sale_price` (the product's own public base price).
2. `offerPrice = CommercePriceResolver->resolve($productId, $storefront's sales_channel_id)->amount` — the *same* resolution path real Cart V1 checkout uses for that product, on that channel, with no partner context (anonymous customer).
3. If `offerPrice` is null or `offerPrice >= referencePrice` → **not currently, genuinely discounted** → silently omit this row from the response. Fail-closed, identical in spirit to how `banner`/`benefits`/`customContent` are omitted when their content is empty.
4. Otherwise: `discountAmount = referencePrice − offerPrice`, `discountPercent = round(discountAmount / referencePrice × 100)` — computed fresh on every read, never stored.
5. Eligibility also requires the product to be sellable/published on that storefront's channel (reuse the same `AvailableToSellService` check `CommerceWorkspaceStorefrontProductController` already applies).
6. Currency is read from `Tenant.currency`, never hardcoded — same rule `CommercePriceResolver` already follows.

Because step 2 uses the exact channel-default resolution path checkout uses, **the price shown on the storefront is, by construction, always the price checkout will actually honor** — there is no second, display-only pricing path that could drift from reality.

**Presentation content** (`StorefrontPresentationConfig`) — `offers` section content becomes:
```ts
interface OffersContent { offerIds: string[] } // max 8, same cap/shape precedent as FeaturedContent.productIds
```
This is the *only* change to `StorefrontPresentationConfig`/`section-content.ts`: a list of references to `storefront_offers.id`. No price, discount, validity date, or any Commerce fact is ever written into presentation JSON — satisfying the owner's explicit boundary. `GATED_HOME_SECTION_KEYS` drops `offers`; `offers` moves out of the gated branch in `ControlPanels.tsx`/`StorefrontPreviewCanvas.tsx` into the same "has typed content, has a real picker" pattern `featured` already follows.

### 23.4 Workspace (merchant curation) API

Following the exact precedent `CommerceWorkspaceStorefrontProductController`/`CategoryController` already set:
```
GET    /api/commerce/workspace/storefronts/{id}/offers
POST   /api/commerce/workspace/storefronts/{id}/offers
PATCH  /api/commerce/workspace/storefronts/{id}/offers/{offer}
DELETE /api/commerce/workspace/storefronts/{id}/offers/{offer}
```
Same auth chain as every sibling route in that group: `auth:sanctum`, `SetTenant`, `SetBranch`, `EnsureActiveSubscription`, `EnsurePermission:commerce.manage`, `ownedStorefront()`. Request body for create/update: `{product_id, starts_at?, ends_at?, is_active?, position?}` — the controller **explicitly rejects** any `price`/`discount`/`percent`-shaped field in the request body (defense in depth, named here precisely because that is the exact attack/footgun surface being closed). The merchant picks candidate products via the *existing* `GET .../products` read (§21) — no new product-search capability is needed for curation; a product that isn't currently genuinely discounted simply won't render once curated (fail-closed), which is a UX nuance (§23.7) not an architecture gap.

### 23.5 Public (Published) read — corrected to Host-resolved authority

**Corrected in this revision.** The first version of this document proposed `GET /api/store/v1/storefronts/{id}/offers`. That does not match AWJ's existing, already-shipped public storefront authority model and was wrong — re-verified directly against `routes/api_storefront.php` for this correction. The real pattern, used by every other `store/v1` read today (`categories`, `products`, `media`, `storefront`, `cart`), never takes a storefront id as a route or query parameter at all:

```
routes/api_storefront.php:25-34 (doc comment, quoted):
  السلسلة الأمنية لكل مسار: Host الوارد → ResolveStorefrontDomain (يحلّ
  StorefrontDomain النشط والموثَّق ثم Storefront النشط ثم SalesChannel
  النشطة من نوع web التابعة لنفس المستأجر، ويضبط TenantContext/
  StorefrontContext لعمر الطلب فقط — 404 غير كاشف عند أي فشل) →
  EnforcePublicApiRateLimit:unauth → استعلام قراءة معزول.
  لا `{tenantSlug}` في مسارات هذه المجموعة — الحسم كلّه من الـ Host، لا من الرابط.
```

i.e.: *Host → `ResolveStorefrontDomain` (resolves the active, verified `StorefrontDomain`, then the active `Storefront`, then the active `web`-type `SalesChannel` of the same tenant, sets `TenantContext`/`StorefrontContext` for the request's lifetime only — uniform non-revealing 404 on any failure) → rate limit → isolated read.* No tenant/storefront identifier ever appears in the URL for this route group — confirmed directly in `routes/api_storefront.php:36-49`, where `products`, `categories`, `storefront`, `cart`, and `media` all take zero storefront-identifying parameter.

**Corrected route:**
```
GET /store/v1/offers
```
Registered in the same `Route::middleware([ResolveStorefrontDomain::class, EnforcePublicApiRateLimit::class.':'.PublicApiRateLimits::CLASS_UNAUTH])` group as every sibling `store/v1` route (`routes/api_storefront.php:36-39`) — no new middleware stack invented. The controller resolves authority exactly the way `StorefrontProductController::index` already does today (`StorefrontProductController.php:48-49`):
```php
$storefront = app(StorefrontContext::class);
$channelId = $storefront->salesChannelId();
// + $storefront->tenantId(), $storefront->storefrontId() — never a request input
```
The Offers query is scoped to `storefront_offers.storefront_id === $storefront->storefrontId()` (and implicitly `tenant_id`, via `BaseModel`'s tenant scope on the `Product`/`storefront_offers` query) — **never** from a route parameter, query string, request body, or client-controlled header. `StorefrontContext` (`app/Tenancy/StorefrontContext.php`) only ever holds values `ResolveStorefrontDomain` set from the resolved Host; nothing downstream can override `tenantId()`/`storefrontId()`/`salesChannelId()` — there is no setter reachable from a controller action.

One real nuance worth recording precisely, because it is part of how "the Host remains authority" actually holds in production: `storefront/` (Next.js) is the sole production caller of this Laravel endpoint, not the visitor's browser directly, so `$request->getHost()` as Laravel sees it would reflect the Next.js server's own host, not the storefront domain the visitor typed. `ResolveStorefrontDomain::incomingHostname()` (`ResolveStorefrontDomain.php:134-145`) handles this with a narrow, server-only escape hatch: it accepts an `X-Storefront-Forwarded-Host` header **only** when paired with a correct `X-Storefront-Gateway-Secret` header (constant-time `hash_equals` comparison against a server-only secret the browser never receives) — a wrong or missing secret is treated identically to no header at all, falling back to the real Laravel-visible host (which then safely 404s). This is not a competing resolution mechanism and does not change the authority model in this document: it only changes *where the hostname string comes from*, never who may supply a tenant/storefront id directly.

Response shape — only currently-real, currently-active, currently-discounted offers, filtered server-side per §23.3 step 3 so the client never re-derives "is this discounted": `{productId, name, thumbnailUrl, referencePrice, offerPrice, discountPercent, currency, startsAt, endsAt}`.

**Canvas (editor) read — corrected framing.** The first version of this document said Canvas calls "the same read" as Published through "an authenticated equivalent." That blurred two different authority models together and is corrected here: Canvas is a merchant-authenticated, Draft-stage preview for a *specific* storefront being edited, so it legitimately uses the **workspace** route (§23.4, `GET .../workspace/storefronts/{id}/offers`, already `storefront_id`-scoped with `ownedStorefront()` ownership checks) extended to return the same resolved shape (name, thumbnail, referencePrice, offerPrice, discountPercent) as the public read — it must **not** call the Host-resolved public route (Canvas isn't reached via the merchant's own storefront hostname). Parity between Canvas and Published is therefore structural at the **service** level, not the route level: both the workspace controller and `store/v1/offers` call the same underlying `StorefrontOfferResolver` (§23.3), each from its own correctly-scoped authority boundary, exactly the precedent `CommerceWorkspaceStorefrontProductController` and `StorefrontProductController` already set by both reusing `CommercePriceResolver`/`AvailableToSellService` without duplicating them.

A `commerce.offers` entry may later be added to `app/Services/AppBuilder/DataResourceRegistry.php` (mobile app builder catalog) following the exact shape its existing entries use (`id/version/apiSurface/listEndpoint/detailEndpoint/fields/queryParams/paginated/auth/notes`) — not required for H4's own closure. If added, its `listEndpoint`/`detailEndpoint` must read `store/v1/offers` (Host-resolved, no id), matching every other `commerce.*` entry's existing pattern of never requiring a client-supplied `storefront_id` to read public storefront data; it must **not** document the old, corrected `storefronts/{id}/offers` shape.

### 23.6 What this explicitly does not do

- Does not create a `Coupon`/`Discount`/`Promotion` model, code, or campaign/stacking rules.
- Does not touch `LedgerService`, `InvoiceService`, cart totals, or checkout's amount-due computation in any way — purely a read-only curation+display layer over pricing decisions that already affect checkout through the existing, unmodified `CommercePriceResolver` path.
- Does not modify `PriceList`/`PriceListItem`'s schema, semantics, or any existing caller of them.
- Does not add tax computation (mirrors `CommercePriceResolver`'s own explicit "tax absent by design" boundary).
- Does not build a broad enterprise promotions engine — exactly one new table, zero new pricing logic, three small additive API route groups (workspace CRUD, workspace Canvas-preview read, public `store/v1/offers`).
- Does not change AWJ's existing public storefront authority model in any way: the public read is Host-resolved exactly like every other `store/v1` route (§23.5, corrected) — it does not introduce a storefront-id-bearing public route, and it does not give any public request a way to select or override tenant/storefront/channel.

This reframes Offers as a **display capability over already-authoritative pricing data**, not a promotions/discount **engine** — which is the distinction that lets it proceed without reopening ADR-11's deferral (that ADR deferred an engine that changes amount-due semantics; this does not) and without the financial/order-total review ADR-11 names as a prerequisite for *that* engine. This reframing is itself a decision the owner is making by issuing this correction; it is recorded here as the explicit reasoning, not asserted silently.

### 23.7 Residual, non-blocking items

- **No native time-bounding exists anywhere else in Commerce** to borrow — `starts_at`/`ends_at` on the new table is the first such field in the codebase. It's a plain nullable-datetime pair with no new abstraction, so this is not treated as a blocker, but it is a genuinely new pattern worth the owner's awareness.
- **Merchant UX for picking "currently discounted" candidates**: the workspace product list (§21, §23.4) doesn't yet surface resolved vs. base price, so a merchant curating Offers can't see at a glance which products currently qualify. Worth a small additive field on the workspace products read in a later slice; not required for the architecture to be sound (fail-closed display already prevents any dishonest outcome either way).
- **Stop/escalation check, explicit**: no architecture or security blocker was found that makes this bounded contract unsafe. If the owner's financial/accounting review (referenced in ADR-11 for the engine case) is judged to apply here too, that is an owner call to make before H4-6/H4-7 implement this — flagged, not silently assumed away.

---

## 24. Media contract and gaps

Two existing, **non-unified** media patterns were found (no new pattern implemented by this task):

1. **Product media** (`app/Models/ProductMedia.php`): real tenant-scoped media object — `tenant_id`-scoped, R2-backed (`disk='r2'`), served through `StorefrontMediaController` which 404s indistinguishably for bad ids vs. unpublished products. This is the only genuine tenant-scoped upload/storage pattern in the repo today, but it is scoped strictly to products/variants.
2. **Branding media** (logo/favicon): inline base64 **data URLs stored directly in the presentation JSON document** (`config.ts:99-104`), explicitly flagged in the code itself as a stopgap (`capabilities.ts:17,44-48`: `BRANDING_PERSISTENCE_CAPABILITY = "design_only"`, "Data URLs round-trip until" a real tenant-scoped branding media object exists).
3. **Section images** (banner/hero): `section-content.ts:9` is explicit — "Images are https URLs only — no data URLs and no new media store." Merchants must supply an already-hosted https URL; **no upload affordance exists for banner images today.**

**H4 does not build media architecture** (per the task's own explicit instruction). If a real tenant-scoped section-media object is later authorized, it should extend pattern 1 (product-media/R2), not pattern 2 (branding data-URLs, which the code already marks for replacement). The needed contract, documented for a future decision, not built here:
- Tenant ownership: `tenant_id`-scoped row, same shape as `ProductMedia`.
- Uploader authorization: same RBAC gate as other Store Customizer write paths (`commerce.manage`).
- Allowed MIME types: image formats only (jpeg/png/webp), explicit allow-list.
- File size/dimension limits: TBD by a future decision packet.
- Storage: R2, same disk/convention as `ProductMedia`.
- Generated URLs: served through a guarded controller, same 404-for-both-cases pattern as `StorefrontMediaController`.
- Replacement/deletion/reference cleanup: needs a decision on orphan cleanup when a banner section is deleted — not resolved here.
- Cache behavior: TBD.

**Decisive clarification for H4 closure (resolving the ambiguity, per owner instruction):** the current https-URL-only behavior is **safe and sufficient for H4's Definition of Done**. Banner is LIVE today under that constraint, correctly sanitizes every URL, and no H4-target section (banner, offers' product thumbnails — which come from the existing product-media/R2 pipeline already, not a new upload path) requires a new upload affordance to reach LIVE. A managed tenant-scoped section-media upload object (the contract sketched above) is **explicitly deferred past H4** as a separate, future decision — it is not required for, and must not be treated as blocking, H4 closure. This document takes a position rather than leaving it open: no new media architecture ships in this Horizon.

---

## 25. Desktop UX

Already established by `AWJ_STORE_CUSTOMIZER_UX_V2.md` (not re-litigated by H4): standalone full-screen workspace, Canvas-dominant, contextual section editing, independent-scroll sidebar/canvas/settings panel, scroll-to-section + highlight on selection. The Section Picker (§15) is additive to this model — a panel/dialog within the existing workspace chrome, not a new full-screen flow.

## 26. Mobile UX

Already established by `AWJ_STORE_CUSTOMIZER_UX_V2.md`: preview-first, Bottom-Sheet-equivalent for settings, independently scrollable, touch-sized controls, Canvas position preserved, no horizontal clipping. The Section Picker must follow the same Bottom Sheet pattern on mobile, not a separate modal paradigm.

## 27. Responsive rules

`isMarket` (AWJ Market theme preset) is confirmed as the dominant responsive/variant driver across nearly every Published section component (carousel vs. grid, tile-count, accordion vs. prose), not raw breakpoints alone. This pattern should be followed, not replaced, by any new Section Picker or Featured-picker UI.

## 28. RTL/LTR

Confirmed present and correct on `hero` (gradient flip, chevron rotation, `<bdi>` bidi isolation) and generally via logical CSS (`break-words`, directionless flex) on the content-driven sections. **Gap**: no RTL-specific code found on `banner`, `benefits`, `appPromo`, or `customContent` beyond shared logical-CSS primitives — this appears sufficient today (Tailwind's logical properties handle direction automatically) but was not exhaustively visually verified pixel-by-pixel in this evidence pass; flagged for visual QA in a later H4 implementation slice (§36), not assumed safe by default.

## 29. Accessibility

Every section has at minimum an `aria-labelledby` landmark tied to its heading. Named gap: banner's decorative `alt=""` should become merchant-authorable (§18). No other accessibility violation was found in the evidence pass; `customContent`'s accordion variant already uses native `<details>/<summary>` (correct semantic disclosure, not a custom ARIA widget).

## 30. Tenant/security boundaries

- `storefront_presentations` and `storefront_presentation_versions` both carry `tenant_id` (FK, cascade-delete) and `storefront_id`, with compound unique constraints — presentation config cannot cross tenant boundaries by schema construction.
- Draft is unreachable from the public runtime (`public.ts:1-4`, `page.tsx:47` reads Published only) — confirmed at the code level, not just by convention.
- Unknown section types are dropped (fail-closed) at normalization — confirmed by `config.test.ts:139-156`.
- **New boundary created by this revision**: `storefront_offers` (§23.3). Same tenant-scoping pattern as every other table in this document — `tenant_id` FK, `BaseModel` scope, `product_id` resolved via the same safe cross-tenant-failing reference pattern `PriceListItem.product()` already uses. **Two different, correctly-separated authority models for the two read paths (corrected in this revision, §23.5):**
  - **Workspace CRUD + Canvas-preview read** (§23.4): `storefront_id` route param, ownership-checked via the existing `ownedStorefront()` pattern (404 for foreign/missing, never 403) — same model every sibling `commerce/workspace/storefronts/{id}/...` route already uses, `commerce.manage`-gated, `auth:sanctum` + `SetTenant`.
  - **Public Published read** (§23.5, `GET /store/v1/offers`): **no storefront id in the route at all** — authority comes exclusively from `ResolveStorefrontDomain` resolving the request Host to a verified `StorefrontDomain` → `Storefront` → `SalesChannel`, setting `StorefrontContext` for the request's lifetime only (`ResolveStorefrontDomain.php:69-128`, `StorefrontContext.php`). The query is scoped to `StorefrontContext::storefrontId()`/`tenantId()`, values a controller can read but never set — there is no public-facing mutator. This is the exact same model `StorefrontProductController`, `StorefrontCategoryController`, `StorefrontConfigController`, and `StorefrontCartController` already use (`routes/api_storefront.php:36-51`). Exposes only already-public-equivalent fields (price, name, thumbnail — the same class of data `store/v1/products` already exposes publicly), never Draft-stage or cross-tenant data.
- The Featured product picker's search seam (§21) reuses the existing tenant-scoped `commerce/workspace/storefronts/{id}/products` boundary — no new one needed.
- **Required tenant-isolation tests for the Offers public read** (per owner correction), to be written in H4-6/H4-7, not this task:
  1. A request to Host A cannot read Offers belonging to Storefront B.
  2. No public request parameter (route, query, body, or header) can select a foreign-tenant storefront — only `X-Storefront-Forwarded-Host` + the correct server-only `X-Storefront-Gateway-Secret` can supply an alternate hostname (`ResolveStorefrontDomain.php:134-145`), and a wrong/missing secret falls back to the real Laravel-visible host exactly as if no header were sent.
  3. An unknown hostname fails closed (404, same uniform message as every other `ResolveStorefrontDomain` failure).
  4. An inactive or unverified `StorefrontDomain` fails closed (404), matching existing `ResolveStorefrontDomain` behavior for `products`/`categories`/`storefront`.
  5. Public Offers resolution uses `StorefrontContext::salesChannelId()` from the resolved context, passed into `CommercePriceResolver`, never a channel id from the request.
  6. `GET /store/v1/offers` accepts no storefront UUID of any kind — confirmed by route definition (no `{id}` segment) and by a test asserting a supplied `storefront_id` query param has no effect on which storefront is resolved.
  7. A `storefront_offers` row referencing a foreign-tenant `product_id` cannot leak or resolve — `Product`'s own `BaseModel` tenant scope means a cross-tenant reference simply fails to resolve, same as Featured's existing `productIds` handling.
  8. Workspace CRUD (§23.4) still returns the established non-revealing 404 for a foreign/missing `storefront_id`, unchanged by this correction.
- Application-layer query scoping (Laravel global scope/middleware enforcement in controllers) was not independently re-verified in this evidence pass beyond the schema-level guarantees above, for either the pre-existing tables or the newly designed `storefront_offers` — flagged as a verification item for the implementation slices (H4-6/H4-7), not assumed.

## 31. Commerce truth boundaries

Confirmed respected everywhere today: `featured` stores only `productIds` (never price/stock/discount); no section anywhere stores a copied price, tax, stock quantity, or eligibility value. Offers' bounded contract (§23) preserves this boundary exactly rather than crossing it: `offers` content becomes `{offerIds}` (references only, §23.3), and every price/discount value is resolved live, server-side, on every read — never stored in `StorefrontPresentationConfig`, never cached into presentation JSON, never writable by a client. The new `storefront_offers` table itself carries no price/discount column, so even at the Commerce-data layer (outside presentation entirely) there is nowhere to smuggle an invented number. This is the owner's explicit boundary from the correction, satisfied by construction rather than by gating the section away from the boundary.

## 32. Performance budget

- `categories`, `newArrivals`: one batched catalog/product-list request each — already correct.
- `featured`: **N unbatched requests** — the one real performance gap in the current architecture (§21). Target: one batched request via an `ids` filter.
- `wholesale`, `appPromo`, `banner`, `benefits`, `customContent`: no data fetch (config/content only) — zero marginal request cost.
- `hero`: no fetch.
- `offers`: one request (`GET /store/v1/offers`) resolving all curated-and-currently-genuine offers for the resolved storefront in a single call — same batched-by-construction shape as `categories`/`newArrivals`, not per-item. The Host-resolution chain (`ResolveStorefrontDomain`) it rides on is the same chain every other `store/v1` read already pays on every request; this is not new SSR cost, it's the existing cost every sibling public read already has.
- No SSR/Canvas-rerender cost concerns were identified beyond the Featured N+1 issue.

## 33. Backward compatibility

Proven by `storefront/src/lib/presentation/__tests__/config.test.ts`: legacy v1 `{key,visible}` migrates deterministically to `{id:key,type:key,visible}`; v1 semantics (missing sections re-appended at list end) are preserved for old documents while v2+ treats absence as real deletion; unknown types are always dropped; duplicate ids collapse to first-wins; the list is capped at `MAX_HOME_SECTIONS=30`. Any field this document proposes adding (`state` on `SECTION_CAPABILITIES`, `imageAlt` on `BannerContent`, `offerIds` on the new `OffersContent`) must be additive/optional and must not require a schema version bump, consistent with CONTRACT-2's own precedent of changing shape without a DB migration.

**Offers specifically**: existing `offers` instances today persist as `{id,type,visible}` with no `content` key. Adding `OffersContent{offerIds}` support is purely additive — an old document with no `content` on its `offers` instance remains valid and renders as empty (section omitted), identical to how `banner`/`benefits`/`customContent` already behave before a merchant adds anything. No migration of existing `offers` instances is required.

## 34. Schema/version decision

**No presentation-document schema or version bump is justified by this document.** All proposed JSON-shape additions (banner `imageAlt`, formalized `state` field, Featured product-picker UI, batched product-ids fetch, Offers' `OffersContent{offerIds}`) are additive to existing JSON shapes with no persisted-document shape change, consistent with CONTRACT-2's own precedent.

**One genuine new DB table is proposed** (`storefront_offers`, §23.3) — this is a Commerce-domain migration, not a presentation-schema bump, and does not touch `StorefrontPresentationConfig`'s stored shape, `storefront_presentations`, or `storefront_presentation_versions` at all. It is called out explicitly here because it is the one piece of this document that is not purely additive-to-JSON: it is a new table, requiring an actual migration in a future implementation slice (not created by this task).

The `section-content.ts` duplication between `web/` and `storefront/` (§9) is flagged as a maintenance risk worth a future decision (shared package vs. kept-in-sync twins) but is explicitly **not** required to resolve before H4 can proceed — it is a tooling/DX question, not a merchant-facing capability gap. Offers' new `OffersContent` type must be added to both twins identically when implemented, same as every other type in that file.

---

## 35. Proposed H4 implementation slices

Revised twice now: first from the task brief's content-first assumption (most content contracts already existed), and again in this revision to fold in the Offers bounded-build and the categories/newArrivals parity fix the owner's correction requires. Each slice is independently shippable and testable, per the AWJ Horizon system. This closely follows the sequence the owner's correction proposed, adjusted only where repository evidence changes a dependency:

- **H4-1 (this document).** Evidence + Activation Contract, including this revision. ✅ This PR.
- **H4-2. Capability Registry + Section Library UX.** Formalize `state` on `SECTION_CAPABILITIES` (§17) sourced from §5's matrix, then build the actual Picker on top of it: search, 7-category taxonomy (§16), thumbnails/short descriptions per type, honest state badges, already-added/max-instance states explained in the UI. Folded into one slice (vs. the original version's two) because the Picker needs the formalized state field to exist first — no reason to ship them separately. No content-contract changes.
- **H4-3. Real Canvas catalog parity for Categories/New Arrivals.** Wire `StorefrontPreviewCanvas.tsx`'s `categories`/`newArrivals` branches to the already-shipped `commerce/workspace/storefronts/{id}/{products,categories}` reads (§5, §21) instead of `PREVIEW_CATEGORIES`/`PREVIEW_PRODUCTS`. No new backend endpoint needed — confirmed in this revision's evidence pass. Independent of H4-4/H4-5/H4-6.
- **H4-4. Banner / Benefits / Custom Content / App Promo completion.** Small polish items on sections already confirmed LIVE: `imageAlt` on `BannerContent` (§18), `config.apps` fields surfaced inline in appPromo's own Content tab (§22). Treated as completion/polish, not rebuilding — these sections' core contracts, normalizers, and renderers are not touched.
- **H4-5. Featured Products real picker + batched data read.** Build a new multi-select product picker on the existing `workspace-products.ts` data layer (§21); add an `ids[]` filter to `StorefrontProductController::index` and a `fetchProductsByIds()` helper, replacing `FeaturedShelf.tsx`'s N unbatched calls with one batched read.
- **H4-6. Real Offers Commerce contract.** Build `storefront_offers` (migration), `StorefrontOfferResolver`, the workspace CRUD routes, the workspace Canvas-preview read, and the **Host-resolved public route `GET /store/v1/offers`** (§23.3–§23.5, corrected in this revision — not a `storefronts/{id}/offers` shape). Backend-only slice — no Canvas/Published UI yet. Must include the 8 tenant-isolation/host-authority tests listed in §30. Depends on nothing else in this list (it's additive, new-table work) but should land before H4-7 since H4-7 needs it to render against.
- **H4-7. Offers Canvas + Published implementation.** `OffersContent{offerIds}` in both `section-content.ts` twins, the new picker UI (reusing H4-5's multi-select picker pattern) reading the workspace Canvas-preview read, `GATED_HOME_SECTION_KEYS` loses `offers`, new `<OffersBand>`/`<OffersShelf>` Published component calling `GET /store/v1/offers` (no storefront id, Host-resolved — §23.5), Canvas branch replacing the gated placeholder. Depends on H4-6.
- **H4-8. Integrated responsive / RTL / LTR / accessibility / parity QA.** Cross-cutting verification pass across all ten sections on the now-complete Picker + activation set, including Offers' Canvas/Published parity (structural by construction, §23.5, but still verified) and the categories/newArrivals fix from H4-3. Mobile/desktop, RTL/LTR visual check (§28's flagged gap), accessibility audit.
- **H4 Closure.**

Two deviations from the owner's proposed sequence, both evidence-driven and noted per the task's own allowance to adjust the split when evidence proves a safer order: (1) capability-state formalization is folded into H4-2 rather than kept separate, since the Picker literally cannot render honest badges without it existing first; (2) H4-3 (categories/newArrivals parity) is confirmed to need no new backend work, so it can run fully in parallel with H4-4/H4-5 rather than gating on anything.

## 36. Verification matrix

| Item | Verified in this task? | How |
|---|---|---|
| Section Library useful/searchable | No — H4-2 not yet built | N/A |
| Taxonomy coherent | Yes | §16, no empty categories |
| Every merchant-visible section real | Architecture defined for all 10; 9 confirmed real today, Offers has a bounded contract targeting LIVE (§23), not yet implemented | §5 matrix |
| No fake toggle / no fake price | Yes, by construction | Offers' new table carries no price/discount column (§23.3); every other section already enforces this (§31) |
| Typed content/settings per LIVE/target-LIVE section | Yes, for banner/benefits/customContent/featured/offers(target); hero/categories/newArrivals/wholesale/appPromo confirmed LIVE without needing a typed per-instance contract (global or config-sourced, by design) | §5, §23.3 |
| Server normalization | Yes | `normalizePresentationConfig`, fail-closed, tested |
| Draft/Published persistence | Yes | `storefront_presentations` schema, tenant-scoped |
| Canvas/Published renderer exist | Yes for 9; designed, not yet built, for Offers | §5, §23.5 |
| Canvas/Published parity | 2 pre-existing exceptions (categories/newArrivals) now have a confirmed, no-new-backend fix path (H4-3); Offers designed for structural parity (single shared resolution path, §23.5) | §5, §27 |
| Responsive/mobile/desktop | Confirmed present; not pixel-level re-verified | §27 |
| RTL/LTR | Confirmed present on hero; not exhaustively verified elsewhere | §28 — flagged for H4-8 |
| Accessibility | Confirmed present; one named gap (banner alt) | §29 |
| Tenant boundaries | Confirmed at schema level for existing tables and designed for the new `storefront_offers` table; app-layer not independently re-verified for either | §30 |
| Backward compatibility | Confirmed via existing test suite; Offers' addition confirmed purely additive | §33 |
| Commerce truth never in presentation | Yes, by construction, including the new Offers contract | §31 |
| No promotions engine built | Yes — exactly one new non-pricing table + three small additive read/write API groups; no coupon/campaign/stacking logic | §23.6 |
| Public Offers route matches existing storefront authority model | Yes, corrected in this revision — `GET /store/v1/offers`, Host-resolved via `ResolveStorefrontDomain`/`StorefrontContext`, no storefront id in any public parameter | §23.5, §30 |
| 8 tenant-isolation/host-authority tests specified | Yes — listed explicitly, not yet written (H4-6) | §30 |
| Focused/broader tests | Not run in this task (docs-only, no runtime code changed) | See §40 |
| CI | N/A to this PR (docs-only) | — |

## 37. Risks/blockers

- **Featured N+1 fetch** (§21, §32) is a real scalability risk once merchants select near the 8-product cap on a high-traffic storefront — prioritized as H4-5.
- **`section-content.ts` duplication** (§9, §34) is a standing maintenance risk (drift between `web/` and `storefront/` copies) — not blocking, but should be tracked. Offers' new `OffersContent` type must be added to both twins identically.
- **RTL/LTR and responsive claims beyond hero** were not pixel-verified visually in this evidence pass (text-based code reading only) — H4-8 must include actual visual QA, not just code inspection.
- **Media architecture** (§24) remains a real gap for banner/hero images, now explicitly deferred past H4 (decided, not left ambiguous) — no owner decision needed before H4 closes.
- **Offers is new, untested surface area** (§23): a genuine new DB table and three new API route groups, even though bounded and non-pricing. It deserves the same scrutiny as any new Commerce-adjacent table — tenant-isolation tests, request-validation tests rejecting any price-shaped field, the 8 host-authority tests in §30, and a focused review before H4-6 merges.
- **The first version of this document's public route proposal was architecturally wrong** (`storefronts/{id}/offers` instead of Host-resolved `/store/v1/offers`) and was corrected only on a second owner review. This is recorded as a risk-process lesson, not just a content fix: any future new `store/v1` route in this document or a successor must be checked against `routes/api_storefront.php`'s existing pattern before being proposed, not derived from the workspace-route pattern by analogy.
- **`starts_at`/`ends_at` is a new time-bounding pattern** (§23.7) with no precedent elsewhere in Commerce — worth a second look during H4-6's implementation to confirm the validity-window check (open-ended vs. both-bounds vs. start-only) matches merchant expectations.

## 38. Stop/escalation gates

No stop condition from the task brief, or from the owner's correction's own stop clause ("if a genuine architecture/security blocker makes even a bounded Offers contract unsafe, stop and escalate"), was triggered:

- No section requires an undocumented Commerce truth change — Offers' bounded contract reuses `CommercePriceResolver` and `Product.sale_price` exactly as they exist today.
- Offers' sourcing question is now resolved by a bounded, bounded-scope contract (§23) rather than by gating — re-derived from fresh evidence, not assumed.
- Tenant ownership is unambiguous for both existing tables and the newly designed `storefront_offers` table (schema-level `tenant_id` scoping, same pattern throughout).
- Media ownership for section images is explicitly, decisively deferred past H4 (§24) — not left ambiguous, not worked around with an invented upload path.
- No DB migration, schema, or API change was **made** by this task — `storefront_offers` and its API routes are a *design*, for a future implementation slice (H4-6), consistent with "no runtime code, schema, or API changed by this task."
- No section requires copying price/stock/discount into presentation data — confirmed none do; Offers' contract is designed specifically to preserve this boundary while still being real (§23.3, §31).
- No promotions/discount *engine* is being built — re-confirmed against ADR-11's specific concern (amount-due semantics, checkout totals) and found not to apply here (§23.6).
- **AWJ's existing public storefront authority model is preserved, not changed**: re-verified directly against `routes/api_storefront.php`, `ResolveStorefrontDomain.php`, and `StorefrontContext.php` for this correction (§23.5, §30) — the corrected public Offers route carries no storefront identifier of any kind, matching every sibling `store/v1` route exactly.
- All external visual evidence cited (§11, §12, §13) was actually opened and inspected via screenshot; the one page that could not be reached (Salla help center merchant article, §11) is reported as a 404, not fabricated.

## 39. H4 Definition of Done

Adopting CUST-H3's closure template (`docs/reports/CUST-H3-HORIZON-CLOSURE-REPORT.md`), updated per the owner's correction: every capability closes as **LIVE** (verified Canvas/Published parity). **GATED BY DESIGN is no longer an acceptable closing state for Offers** — it is only acceptable, per the owner's own stop clause, if H4-6/H4-7's implementation uncovers a genuine architecture/security blocker this document's evidence pass did not find; absent that, H4 does not close with Offers gated. Applied to H4's actual scope:

- [ ] H4-2 through H4-8 implementation slices land (this document does not implement them).
- [ ] Section Library is searchable, categorized (§16), with honest per-type state badges.
- [ ] `SECTION_CAPABILITIES` formalizes `state` per type, matching §5's matrix.
- [ ] Banner gains merchant-authorable `imageAlt`; appPromo content editable from its own Content tab.
- [ ] Categories/NewArrivals Canvas preview wired to the real `commerce/workspace/storefronts/{id}/{products,categories}` read, closing the parity gap (§5, §21, H4-3).
- [ ] Featured gets a real product picker and a batched published-side product-ids read.
- [ ] **Offers is LIVE end-to-end**: `storefront_offers` table exists and is tenant-isolated; workspace CRUD and the Host-resolved public read route (`GET /store/v1/offers`, no storefront id) exist and reject any price-shaped input; `OffersContent{offerIds}` is live in both `section-content.ts` twins; Canvas and Published both render real, live-resolved offers through the same `StorefrontOfferResolver` service; a curated-but-not-genuinely-discounted product is honestly omitted, never faked.
- [ ] All 8 tenant-isolation/host-authority tests from §30 pass, specifically confirming no public request parameter can select or override tenant/storefront/sales-channel for Offers.
- [ ] Canvas/Published parity re-confirmed for all 10 types — no known, undocumented gap remains unaddressed.
- [ ] Mobile, desktop, RTL, LTR, accessibility visually re-verified (not just code-read) in H4-8.
- [ ] Tenant boundaries re-confirmed at the application layer (not just schema), specifically for the new `storefront_offers` table and any new Featured product-search seam.
- [ ] Backward compatibility re-confirmed via the existing `config.test.ts` suite plus new tests for any additive fields, including Offers' purely-additive `content` shape.
- [ ] Commerce truth boundary re-confirmed by a specific test: no API response or stored row lets a client write a price/discount value through the Offers surface.
- [ ] Focused and broader relevant tests pass; build passes; CI green or unrelated failures precisely documented.
- [ ] Horizon Closure report written, following the CUST-H3 closure template, explicitly noting Offers closed LIVE rather than GATED.

No section may close H4 as a merchant-visible fake. No section closes H4 as a permanently gated placeholder unless H4-6/H4-7 surfaces a genuine blocker this document did not find — in which case that must be escalated to the owner, not silently re-gated.

## 40. Recommended next action

Owner review of this revised architecture/evidence document, specifically:
1. Confirm the bounded Offers Commerce contract (§23) — one new non-pricing table, two small additive API route groups, zero new pricing logic, zero touch to checkout/Ledger/Invoice — matches the owner's intent for "smallest bounded contract," and that reframing it as a display capability rather than a promotions engine (§23.6) correctly sidesteps ADR-11's deferral rather than quietly violating it.
2. Confirm the revised slice order (§35) — H4-2 through H4-8 — including Offers landing as its own backend slice (H4-6) before its UI slice (H4-7).
3. Approve the additive-field proposals in this document before any implementation slice touches code: `imageAlt` (banner), `state` (capability registry), `OffersContent{offerIds}`, and the new `storefront_offers` table/migration.
4. Confirm the media decision (§24) — https-URL-only stays sufficient for H4 closure, managed upload is explicitly out of scope for this Horizon.
5. Confirm the corrected public Offers route (§23.5) — `GET /store/v1/offers`, Host-resolved, no storefront id in any public parameter, matching the existing `store/v1` authority model exactly — is now correct; this was wrong in the first revision and is fixed here against direct evidence from `routes/api_storefront.php`/`ResolveStorefrontDomain.php`/`StorefrontContext.php`.
6. On approval, proceed to **H4-2 (Capability Registry + Section Library UX)** as the first implementation slice, with H4-3 through H4-5 free to run in parallel once H4-2 lands, and H4-6 (Offers backend) startable independently of all of them.

No merge, deploy, or production release is requested or performed by this task.
