# CUST-H4-ARCH-1 — Section Library & Real Section Activation Contract

**Horizon:** CUST-H4 — Section Library & Section Quality (named and scoped in `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:585-646`)
**Status:** Architecture/Evidence draft — awaiting owner review. No runtime code, schema, or API changed by this task.
**Author:** Claude (session `session_011sFWxaxv1beYdzjrNt9RXn`), 2026-10-01.

---

## 1. Executive decision

The owner's instruction for this Horizon is: *visible in the merchant Section Library ⇒ real persisted contract, real Canvas renderer, real Published renderer, real data source where required, normalization/validation, responsive behavior, accessibility, parity tests — no fake sections.*

Evidence gathered directly from `origin/main` at the Base SHA below **changes the shape of the problem from what the task brief assumed**:

- Five of the six sections the brief names as activation targets — **banner, benefits, customContent, featured, appPromo** — already have a real typed content contract, a real server-authoritative normalizer, a real Canvas (editor) renderer, and a real Published (storefront) renderer today. This was built in an earlier slice (`STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md`) and is covered by passing tests on both the `web/` and `storefront/` sides. They are **LIVE**, not `DESIGN_ONLY`, with one real residual gap on `featured` (N+1 product fetch) and cosmetic/consistency gaps common to all.
- The sixth, **offers**, already has a closed, owner-signed decision: `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md`, resolved 2026-09-26, Option 1 — **stay gated until AWJ has an authoritative shared Promotions Engine**. No commerce promotions/discount/campaign model exists anywhere in the repository (confirmed again below, independently, against current `main`). CUST-H4 **affirms this decision and does not reopen it.**
- The actual uncompleted CUST-H4 work, per the Horizon Roadmap's own CUST-H4 scope (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:585-646`) and per CONTRACT-2's own explicit deferral (`STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md` §10/§24), is the **Section Library / Picker UX layer** (search, categories, thumbnails, descriptions, honest capability badges) and the **capability-state + multi-instance metadata** that the current registry does not yet formalize — not rebuilding section content contracts that already exist.

This document is therefore an *activation and library* contract, not a from-scratch build plan. Section 5 below gives the full truth matrix section by section; sections 18–23 give per-section activation contracts; section 35 gives the revised implementation slice sequence.

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
| **categories** | max 1, no dup, delete ok (`:36`) | No — catalog-managed | n/a | Yes | Yes | **Mock** static `PREVIEW_CATEGORIES` (`Canvas:526-569`) | **Real** `getCategories({depth_eq:0})` (`CategoriesSection.tsx:123`) | Real catalog API | `[]` on fetch error; section omitted if empty | `isMarket` tile-count/grid variant | logical CSS only | `aria-labelledby`, `alt` per tile | Visibility/order test only | **LIVE** (visibility/order); **Canvas/Published parity gap** (preview is mock, publish is real) | Editor preview infidelity — pre-existing, outside H4's six named targets |
| **newArrivals** | max 1, no dup, delete ok (`:37`) | No — catalog-managed | n/a | Yes | Yes | **Mock** static `PREVIEW_PRODUCTS` (`Canvas:571-612`) | **Real** `cachedListProducts(...).sort:-available_on` (`NewArrivals.tsx:38-47`) | Real catalog API | `[]` → dashed empty-state card | Carousel (market) vs grid | inherited from ProductCard | `Suspense`/skeleton, `aria-labelledby` | Reorder test only | **LIVE** (visibility/order); same parity gap as categories | Same as categories |
| **wholesale** | max 1, no dup, delete ok (`:38`) | No | n/a | Yes | Yes | Static placeholder text only (`Canvas:614-628`) | Real: gated by `isWholesaleEnabled()` addon flag, intentionally static/no-fetch (`WholesaleSection.tsx:13-14,22`) | Addon flag only, by design | Returns `null` if addon disabled | 2-col on `lg` | none explicit | `aria-labelledby`, `id` | Singleton/duplicate-disabled test | **LIVE** | None — editor placeholder text is intentional per component's own comment |
| **banner** | unlimited, dup ok, delete ok (`:39`) | Yes — `BannerContent{title,subtitle,ctaLabel,ctaHref,imageUrl}` + `normalizeBanner`/`isEmptyBanner` (`section-content.ts:14-20,142-161`) | Yes, `sanitizeExternalUrl` on href/image | Yes | Yes | Live, authored content (`Canvas:630-665`) | Live, `BannerBand.tsx`; dropped if all fields empty (`page.tsx:152-161`) | Merchant-authored only | Placeholder in editor; section omitted when empty in Published | `md:flex-row` | none explicit | `aria-labelledby`, image `alt=""` (decorative, not merchant-described) | Generic instance tests only; no banner-specific test found | **LIVE** | Minor a11y gap: banner image has no merchant-authored alt text field |
| **featured** | unlimited, dup ok, delete ok (`:40`) | Yes — `FeaturedContent{productIds}`, max 8 (`section-content.ts:42-44,196-208`) | Yes, id-shape + dedupe + cap | Yes | Yes | Shows only ID **text chips**, no price/image resolve (`Canvas:707-723`) | Live, `FeaturedShelf.tsx`; resolves each id via **`Promise.allSettled(productIds.map(id => fetchProduct(id)))`** — N individual fetches, not batched (`FeaturedShelf.tsx:25-30`) | Real catalog API, per-product fetch | Failed/missing ids silently dropped; `null` if all fail | Carousel (market) vs grid | inherited from ProductCard | `aria-labelledby` | Generic instance tests only | **PARTIAL** | (1) Editor has no real product picker — raw ID text input only; (2) Published renderer does N unbatched product fetches — real N+1 risk at scale |
| **offers** | unlimited, dup/delete **not actually gated at this layer** (`:41`) — gating is enforced elsewhere | No content contract; any smuggled `content` (e.g. `{discountPercent:50}`) is stripped to `undefined` at normalization (`config.test.ts:238-291`) | Fail-closed by design | Yes (as `{id,type,visible}` only) | Yes (as `{id,type,visible}` only) | Generic dashed placeholder + "Not enabled" badge, explicit gated copy (`Canvas:762-779`, `messages.ts:225-226`) | **No render branch exists** — `page.tsx:142` explicitly `continue`s past any `offers` section before the type switch | **None exists in the repo** (re-confirmed, §22) | N/A — never renders | N/A | N/A | N/A | Gated-note test + picker gated-badge test | **GATED (by owner decision)** | No authoritative Commerce promotions/discount source exists anywhere in the codebase; owner selected Option 1 in `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md` (2026-09-26) — stay gated until a dedicated Promotions Engine horizon |
| **benefits** | unlimited, dup ok, delete ok (`:42`) | Yes — `BenefitsContent{items}`, max 6, `{id,title,body}` (`section-content.ts:22-30,163-176`) | Yes | Yes | Yes | Live, authored items (`Canvas:667-686`) | Live, `BenefitsBand.tsx`; dropped if no item has title/body (`page.tsx:172-174`) | Merchant-authored only | Placeholder in editor; omitted when empty in Published | `sm:grid-cols-2 lg:grid-cols-3` | `break-words` | `aria-labelledby` | Generic instance tests only | **LIVE** | None found. No icon field (task brief allows "optional icon if safely supported" — not yet present; not a blocker to LIVE, a future enhancement) |
| **appPromo** | max 1, no dup, delete ok (`:43`) | No dedicated `SectionContent` entry — content lives in `config.apps{iosUrl,androidUrl,appName,showHomepageSection,showFooterLinks}` (`config.ts:143-149,254-260`) | Yes — `isSafeAppStoreUrl`/`isSafePlayStoreUrl` + `sanitizeExternalUrl`, 80-char `appName` cap (`config.ts:526-534`) | Yes | Yes | Conditionally live: real app-store badges if `hasApps`, else placeholder (`Canvas:726-759`) | Live, `AppPromoBand.tsx`; `null` if neither URL validates (`AppPromoBand.tsx:21-23`) | Real, merchant-authored app URLs (Apps settings panel, not this section's own panel) | `null` section when no real URL | flex-wrap button row | none explicit | Uses `OfficialStoreBadge` sub-component | Generic instance tests only; no dedicated appPromo content test | **LIVE** | Content is authored from a separate "Apps" settings panel, not this section's own Content tab — a UX consistency gap (see §22), not a functional one |
| **customContent** | unlimited, dup ok, delete ok (`:44-49`) | Yes — `CustomContent{blocks}`, max 8, `{id,kind:"heading"\|"paragraph",text}` (`section-content.ts:38-40,178-194`) | Yes, bounded to two safe kinds | Yes | Yes | Live, authored blocks (`Canvas:688-705`) | Live, `CustomContentBand.tsx`; dropped if no block has non-empty text (`page.tsx:185-187`); accordion variant on `awj-market` theme (`:66-67,112-115`) | Merchant-authored only, structured blocks | Placeholder in editor; omitted when empty in Published | prose vs accordion | `break-words` | `aria-labelledby`, native `<details>/<summary>` disclosure | Generic instance tests only | **LIVE** | None found. No HTML/iframe/embed exists — confirms the brief's safety requirement is already met |

---

## 6. Current Section Picker

No dedicated Section Picker component exists. The "add section" UI is inline in `ControlPanels.tsx:1046-1073` (`data-section-picker`): one `<button data-picker-option>` per `HOME_BUILDER_SECTION_KEYS` entry, showing **translated label text only — no thumbnails, no descriptions, no icons, no categories, no search**. Disabled when the type is a maxed-out singleton or `MAX_HOME_SECTIONS=30` (`config.ts:66`) is reached. The only honesty signal present is a small `gatedBadge` pill ("Not enabled" / "غير مفعّل") shown next to `offers` in both the picker list (`:1063-1067`) and the composer row list (`:1124-1128`). This is a real, working, non-deceptive gate — it is just minimal. This is exactly the gap the Horizon Roadmap names for CUST-H4 (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:589-598`).

## 7. Current Canvas rendering

`StorefrontPreviewCanvas.tsx` holds one render branch per section type (`:500-780`), orchestrated by `ExperienceBuilder.tsx` which owns `selectedSection` state and composes `<ControlPanels>` + `<StorefrontPreviewCanvas>` but contains no per-section rendering logic itself. Per-type behavior is detailed in §5. The two honest exceptions to "live preview of authored content" are (a) `categories`/`newArrivals`, which preview static mock arrays instead of live catalog data (a pre-existing parity gap, not a fabrication — the editor never claims this is live catalog data), and (b) `offers`, which renders only the gated placeholder.

## 8. Current Published rendering

`storefront/src/app/[country]/[locale]/(storefront)/page.tsx` is the single entry point. `fetchStorefrontConfig()` returns the **Published** config only (`page.tsx:47`) — Draft is unreachable from the public runtime, consistent with the Draft/Published separation established in `AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`. `publishedNodes()` (`page.tsx:120-234`) dispatches on `section.type`, with an explicit `if (!section.visible || section.type === "offers") continue;` (`page.tsx:142`) as the runtime enforcement of the Offers gate, independent of (and redundant with) the normalizer-level content-stripping already covered by `config.test.ts:238-291`.

## 9. Existing content contracts

`section-content.ts` exists **in duplicate**, byte-for-byte identical, in both `web/src/modules/store-experience-builder/presentation/section-content.ts` and `storefront/src/lib/presentation/section-content.ts` — the `web/` copy's own header comment states this explicitly ("twin of storefront/.../section-content.ts. Keep the two normalizers aligned."). Same duplication pattern for `page-regions.ts`. This is a real, acknowledged maintenance risk (two files that must be hand-kept in sync) but not a correctness bug today — it is flagged for H4 to decide whether to formalize (see §34).

## 10. Existing data dependencies

- `categories`/`newArrivals`: live catalog reads (`getCategories`, `cachedListProducts`) — real Commerce data, already batched per request (not per-item).
- `featured`: real per-id product reads, **not batched** (§5, §21).
- `wholesale`: a boolean addon flag only, no data fetch by design.
- `appPromo`: config-only (merchant-entered URLs), no external fetch.
- `banner`/`benefits`/`customContent`: merchant-authored content only, no fetch.
- `offers`: none.

---

## 11. Salla evidence

First-party pages actually opened and inspected (not summarized from search snippets):

1. **`https://docs.salla.dev/422558m0` — "Themes Home Page"** (screenshot captured and visually inspected). Shows the Home Page template's file location (`src/views/pages/index.twig`) and an example wireframe render: header/nav, a hero/banner block, then a 6-up row of square image placeholders, then a 3-up row of larger cards — i.e. Salla's home page is explicitly composed of stacked, independent, reusable blocks, matching AWJ's own section-list model.
2. **`https://docs.salla.dev/422580m0` — "Twilight Theme Components Overview"** (screenshot captured and visually inspected). Contains a first-party infographic titled "Twilight Theme Components" with four **component categories**: **Home Components** ("Banners & Video, Testimonials, Sliders & Parallax, Trust Features, Products Sections & More"), **Header Components**, **Footer Components**, **Products Components** ("**Offers**, Color/Size/Image, Multiple Options, Product List, Comment Form, Quick Search, Similar Products & More"). This is the first-party confirmation that Salla treats "Offers" as a **product-detail-page** component (tied to live SKU/price truth), not a free-standing homepage marketing section — directly corroborating AWJ's own decision to keep homepage Offers gated until there is an authoritative price/discount source, rather than inventing one.
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
- AWJ's Offers gate is **reinforced, not weakened**, by Salla's own practice of keeping offer-like sections tied to authoritative product/price data.
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
| العروض والتسويق | Offers & Marketing | offers (gated), wholesale |
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
| Preview/Published parity | Mostly true; two named exceptions (categories/newArrivals mock preview) | **Document, do not fix in H4** — pre-existing, outside the six named target sections, no owner instruction to touch already-LIVE sections' internals |
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

**Current state: PARTIAL.** This is the one target section with a real, concrete gap:

1. **Editor-side product picker**: today the Content tab is a raw product-ID text input (`FeaturedFields`, `ControlPanels.tsx:997-1007`), not a real searchable product picker. H4 should connect it to the existing tenant-scoped product search/list seam already used elsewhere in `web/` (not a new backend endpoint) — architecture only, no implementation in this task.
2. **Published-side N+1 fetch**: `FeaturedShelf.tsx:25-30` resolves each `productId` via its own `fetchProduct(id)` call (`Promise.allSettled`). No batched "products by ids" read exists in `storefront/src/lib/data/products.ts` today (confirmed: only `cachedListProducts` with list filters, no `ids[]`/`filter[ids]` support found). **Target fix** (for a future implementation slice, not this task): add an `ids` filter to the existing product list read path and a `fetchProductsByIds()` helper, replacing the N unbatched calls with one batched read — satisfying the task's "avoid one-request-per-product" requirement.
3. The contract already correctly stores **presentation-only** data (`productIds`, ordering implicit in array order) and never copies price/stock/discount — this part needs no change. Missing/deleted/unpublished products are already handled safely (`Promise.allSettled` drops failures silently, section omitted if all fail) — this fallback behavior is correct and should be kept exactly as-is.
4. Max selected products: already capped at 8 (`MAX_FEATURED_PRODUCTS`). No change needed.

## 22. App Promo activation contract

**Current state: LIVE**, contrary to the task brief's framing. `config.apps{iosUrl,androidUrl,appName,showHomepageSection,showFooterLinks}` is real, validated (`isSafeAppStoreUrl`/`isSafePlayStoreUrl`), and already drives both the Canvas (`hasApps` conditional real badges) and Published (`AppPromoBand.tsx`, `null` when no valid URL) renderers. The repo does not invent app availability — it reads real merchant-entered URLs and renders nothing when they're absent or unsafe, exactly as required.

The only residual item: content is authored from a separate "Apps" settings surface, not from this section's own Content tab in `ControlPanels.tsx` (which shows only a static note). This is a **UX consistency gap** (violates the "every section editor follows Content/Design/Layout/Advanced" rule for its own instance), not a functional or data-honesty gap. H4 should surface the same Apps fields inline in the appPromo section's own Content tab (reusing the existing config fields and validators, no new contract) so merchants don't have to leave the section they're editing — implementation detail for a future slice, not this task.

## 23. Offers data/truth decision

**No change.** This task independently re-confirmed, against the current Base SHA, every piece of evidence the existing decision packet cites:
- `ApplicationCatalog.php:80-85`: `sales.promotions` maturity is still `coming_soon`.
- Full-repo grep of `app/Models`, `app/Http/Controllers`, `routes/api*.php`, `database/migrations` for promotion/discount/campaign/offer/price-rule: **zero matches** for an authoritative promotions/discount/campaign engine. The only "discount" fields found are ordinary line/document-level ERP discount amounts on `Product`, `Invoice`, `Purchase`, `ReturnLine` (ordinary accounting fields, not a marketing rules engine) — not a usable source for a merchant-facing offers section.
- `storefront/src/lib/presentation/__tests__/config.test.ts:238-291` proves any smuggled `content` on an `offers` instance (e.g. `{discountPercent:50}`) is stripped to `undefined` at normalization — defense in depth, independent of the renderer-level skip.

**AWJ Decision (reaffirmed, not reopened):** Option 1 from `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md` — Offers stays **GATED** until a dedicated, separately authorized AWJ Promotions & Discounts Engine horizon exists, with financial/accounting review and a shared Commerce-Core source of truth, per `ADR-11-COMMERCE-PROMOTIONS-DEFERRAL.md`. H4's only Offers-related work is **UX honesty in the Section Library**: the Picker card must show the section, explain why it's gated (reusing the existing `gatedSection`/`gatedBadge` copy verbatim — already correct), and never let a merchant toggle it into an implied-functional state. No runtime code, migration, API, or pricing rule is authorized by this document, consistent with the original packet.

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

Until that decision exists, banner/hero images remain https-URL-only. This is a real, named limitation — not a blocker to banner being LIVE (it already honestly requires an externally-hosted URL and sanitizes it), just a known UX rough edge for merchants without existing image hosting.

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
- No new authorization/data boundary is created by this document. The one boundary candidate flagged for a future slice is the Featured product picker's search seam, which must respect existing tenant-scoped product query boundaries (no new ones needed — reuse the existing product list/search path used elsewhere in `web/`).
- Application-layer query scoping (Laravel global scope/middleware enforcement in controllers) was not independently re-verified in this evidence pass beyond the schema-level guarantees above — flagged as a verification item for the implementation slices, not assumed.

## 31. Commerce truth boundaries

Confirmed respected everywhere: `featured` stores only `productIds` (never price/stock/discount); `offers` content is stripped entirely; no section anywhere stores a copied price, tax, stock quantity, or eligibility value. This boundary is already correctly enforced by the existing normalizer and is the exact reason Offers is gated rather than faked.

## 32. Performance budget

- `categories`, `newArrivals`: one batched catalog/product-list request each — already correct.
- `featured`: **N unbatched requests** — the one real performance gap in the current architecture (§21). Target: one batched request via an `ids` filter.
- `wholesale`, `appPromo`, `banner`, `benefits`, `customContent`: no data fetch (config/content only) — zero marginal request cost.
- `hero`: no fetch.
- No SSR/Canvas-rerender cost concerns were identified beyond the Featured N+1 issue.

## 33. Backward compatibility

Proven by `storefront/src/lib/presentation/__tests__/config.test.ts`: legacy v1 `{key,visible}` migrates deterministically to `{id:key,type:key,visible}`; v1 semantics (missing sections re-appended at list end) are preserved for old documents while v2+ treats absence as real deletion; unknown types are always dropped; duplicate ids collapse to first-wins; the list is capped at `MAX_HOME_SECTIONS=30`. Any field this document proposes adding (`state` on `SECTION_CAPABILITIES`, `imageAlt` on `BannerContent`) must be additive/optional and must not require a schema version bump, consistent with CONTRACT-2's own precedent of changing shape without a DB migration.

## 34. Schema/version decision

**No schema or version bump is justified by this document.** All proposed additions (banner `imageAlt`, formalized `state` field, Featured product-picker UI, batched product-ids fetch) are additive to existing JSON shapes or are pure UI/data-seam changes with no persisted-document shape change. The `section-content.ts` duplication between `web/` and `storefront/` (§9) is flagged as a maintenance risk worth a future decision (shared package vs. kept-in-sync twins) but is explicitly **not** required to resolve before H4 can proceed — it is a tooling/DX question, not a merchant-facing capability gap.

---

## 35. Proposed H4 implementation slices

Revised from the task brief's assumed order, because evidence shows most "build" work is already done. Each slice is independently shippable and testable, per the AWJ Horizon system.

- **H4-1 (this document).** Evidence + Activation Contract. ✅ This PR.
- **H4-2. Section Library / Picker UX.** Build the actual Picker: search, 7-category taxonomy (§16), thumbnails/short descriptions per type, honest capability-state badges (live/gated) sourced from the formalized `state` field (§17), already-added/max-instance states explained in the UI (today enforced silently). No content-contract changes. This is the highest-value, lowest-risk slice and should go first since it needs nothing from H4-3/H4-4.
- **H4-3. Capability-state formalization.** Add `state` (and any other deferred metadata CONTRACT-2 named) to `SECTION_CAPABILITIES`, sourced directly from §5's matrix. Additive only, no schema bump. Enables H4-2's honest badges with a single source of truth instead of scattered constants.
- **H4-4. Banner accessibility + appPromo in-panel editing.** Add `imageAlt` to `BannerContent` (additive, optional). Surface `config.apps` fields inline in appPromo's own Content tab instead of a separate settings surface. Both are small, independent, low-risk polish items on already-LIVE sections.
- **H4-5. Featured Products real picker + batched fetch.** The one section with a genuine PARTIAL→LIVE gap: connect the Content tab to a real product search/picker (reusing existing tenant-scoped product query seams), and replace `FeaturedShelf.tsx`'s N `fetchProduct` calls with one batched `ids`-filtered read. This is the slice most likely to touch a real data-read seam and deserves its own focused review.
- **H4-6. Offers Picker honesty pass.** Smallest slice: ensure the Picker (built in H4-2) renders Offers' existing gated copy correctly and consistently; no other change. Could be folded into H4-2 directly if the owner prefers fewer slices.
- **H4-7. Integrated parity + responsive + accessibility QA.** Cross-cutting verification pass across all ten sections on the now-complete Picker + activation set: Canvas/Published parity (explicitly re-confirming the pre-existing categories/newArrivals mock-preview gap is documented, not silently expanded), mobile/desktop, RTL/LTR visual check (§28's flagged gap), accessibility audit.
- **H4 Closure.**

This order is safer than the task brief's assumed H4-2(banner+benefits+customContent)→H4-3(featured)→H4-4(appPromo)→H4-5(offers) sequence because those three sections need no build work — sequencing the Picker first lets every other slice land against a UI that can already express "live" vs "gated" honestly from day one, rather than retrofitting honesty messaging after each content slice.

## 36. Verification matrix

| Item | Verified in this task? | How |
|---|---|---|
| Section Library useful/searchable | No — H4-2 not yet built | N/A |
| Taxonomy coherent | Yes | §16, no empty categories |
| Every merchant-visible section real | Partially — 9/10 confirmed real; offers confirmed honestly gated | §5 matrix |
| No fake toggle | Yes | Offers gate confirmed consistent across registry, ControlPanels, Canvas, normalizer, and Published renderer |
| Typed content/settings per LIVE section | Yes, for banner/benefits/customContent/featured; hero/categories/newArrivals/wholesale/appPromo confirmed LIVE without needing a typed per-instance contract (global or config-sourced, by design) | §5 |
| Server normalization | Yes | `normalizePresentationConfig`, fail-closed, tested |
| Draft/Published persistence | Yes | `storefront_presentations` schema, tenant-scoped |
| Canvas/Published renderer exist | Yes, all 10 | §5 |
| Canvas/Published parity | Mostly yes; 2 pre-existing exceptions documented (§5, §27), not fixed in H4 | — |
| Responsive/mobile/desktop | Confirmed present; not pixel-level re-verified | §27 |
| RTL/LTR | Confirmed present on hero; not exhaustively verified elsewhere | §28 — flagged for H4-7 |
| Accessibility | Confirmed present; one named gap (banner alt) | §29 |
| Tenant boundaries | Confirmed at schema level; app-layer not independently re-verified | §30 |
| Backward compatibility | Confirmed via existing test suite | §33 |
| Focused/broader tests | Not run in this task (docs-only, no runtime code changed) | See §40 |
| CI | N/A to this PR (docs-only) | — |

## 37. Risks/blockers

- **Featured N+1 fetch** (§21, §32) is a real scalability risk once merchants select near the 8-product cap on a high-traffic storefront — prioritized as H4-5.
- **`section-content.ts` duplication** (§9, §34) is a standing maintenance risk (drift between `web/` and `storefront/` copies) — not blocking, but should be tracked.
- **RTL/LTR and responsive claims beyond hero** were not pixel-verified visually in this evidence pass (text-based code reading only) — H4-7 must include actual visual QA, not just code inspection.
- **Media architecture** (§24) remains a real gap for banner/hero images; no owner decision exists yet on whether to build a section-media object. Flagged, not resolved.

## 38. Stop/escalation gates

No stop condition from the task brief was triggered:
- No section requires an undocumented Commerce truth change.
- Offers' sourcing question was already resolved by an existing owner decision (re-confirmed, not reopened).
- Tenant ownership is unambiguous (schema-level `tenant_id` scoping confirmed).
- Media ownership is ambiguous for section images, but this is **documented as a gap**, not worked around — no DB migration or media architecture was invented or implemented.
- No DB migration, schema, or API change was made or proposed as required for H4-2 through H4-6.
- No section requires copying price/stock/discount into presentation data — confirmed none do, and Offers is the explicit case where this boundary is being protected, not crossed.
- All external visual evidence cited (§11, §12, §13) was actually opened and inspected via screenshot; the one page that could not be reached (Salla help center merchant article, §11) is reported as a 404, not fabricated.

## 39. H4 Definition of Done

Adopting CUST-H3's closure template (`docs/reports/CUST-H3-HORIZON-CLOSURE-REPORT.md`): every capability closes as either **LIVE** (verified Canvas/Published parity) or **GATED BY DESIGN** (an explicit, owner-reviewed decision — not a miss). Applied to H4's actual scope:

- [ ] H4-2 through H4-7 implementation slices land (this document does not implement them).
- [ ] Section Library is searchable, categorized (§16), with honest per-type state badges.
- [ ] `SECTION_CAPABILITIES` formalizes `state` per type, matching §5's matrix.
- [ ] Banner gains merchant-authorable `imageAlt`; appPromo content editable from its own Content tab.
- [ ] Featured gets a real product picker and a batched published-side product-ids read.
- [ ] Offers Picker card renders existing gated copy honestly; no functional change.
- [ ] Canvas/Published parity re-confirmed for all 10 types, with the two pre-existing mock-preview exceptions (categories/newArrivals) explicitly documented as known, out-of-H4-scope debt rather than silently left ambiguous.
- [ ] Mobile, desktop, RTL, LTR, accessibility visually re-verified (not just code-read) in H4-7.
- [ ] Tenant boundaries re-confirmed at the application layer (not just schema), specifically for any new Featured product-search seam.
- [ ] Backward compatibility re-confirmed via the existing `config.test.ts` suite plus new tests for any additive fields.
- [ ] Focused and broader relevant tests pass; build passes; CI green or unrelated failures precisely documented.
- [ ] Horizon Closure report written, following the CUST-H3 closure template.

A section may remain unavailable only if honestly gated — Offers is the only such section, and it already is.

## 40. Recommended next action

Owner review of this architecture/evidence document, specifically:
1. Confirm the Offers decision is to be **affirmed, not reopened** (§23) — this document assumes yes based on the existing signed packet.
2. Confirm the revised slice order (§35) — Picker-first — is acceptable versus the task brief's content-first assumption, now that evidence shows the content contracts already exist.
3. Approve `imageAlt` (banner) and `state` (capability registry) as the only two additive-field proposals in this document, before any implementation slice touches code.
4. On approval, proceed to **H4-2 (Section Library / Picker UX)** as the first implementation slice.

No merge, deploy, or production release is requested or performed by this task.
