# AWJ Store Customizer — Master Visual & UX Completion Evidence Pass

**Type:** Evidence-only audit + proposed Horizon scope. No code, no PR, no merge, no deploy.
**Date:** 2026-10-04
**Repository:** `safwan5001-source/Nebrax`
**Base SHA (exact `origin/main`):** `a5a3479e09c3e60a32287e9f1d46e5c2fa236633` — `docs(store): close CUST-H4 horizon (#1228)`
**Author context:** CUST-H4 is CLOSED (closure report `docs/reports/CUST-H4-CLOSURE-REPORT.md`). H4 is **not** reopened here.
**Owner decides:** everything in §35. Nothing in this document modifies the Roadmap.

> **Evidence-discipline labels used throughout**
> **[AWJ-Existing]** already approved / current behaviour · **[Salla]** what official Salla documentation proves ·
> **[Daftra]** what official Daftra documentation proves · **[AWJ-Proposal]** recommendation · **[Owner-Decision]** Safwan must choose.

---

## 1. Executive Summary

**Verdict:** the Customizer is a mature *structural* editor (versions, scheduling, multi-page regions, identity, section library, honest data-backed sections) but it is **not yet a visual store builder**. Its gap is not breadth of sections — H4 closed that — it is **depth of presentation and media**.

The five findings that matter most:

1. **There is no way to put a merchant image on the storefront through AWJ.** Banner images are pasted `https` URLs (`section-content.ts`), Hero has no image field at all, and logos are Base64 data-URLs embedded in the presentation JSON. Meanwhile AWJ *does* own a production-proven, tenant-scoped, R2-backed media foundation (`R2StorageService`, `ProductMedia`, category images) that the Customizer simply does not use. **Reuse, don't invent** — the missing piece is a thin Customizer-specific media object + picker UX, not a new storage platform.
2. **Sections have almost no design vocabulary.** Every section is "content + visible". There is no background, overlay, text colour, alignment, height, width, spacing, radius or layout variant on *any* homepage section; Hero's CTA is hard-coded to `/products`. The Inspector is a flat panel (no Content/Design split) so there is nowhere to put design controls yet.
3. **Announcement/promo bar does not exist** anywhere (Canvas, contract, storefront). Salla documents it as a first-class, multi-item, scheduled, page-targeted, coloured, optionally scrolling surface.
4. **Header/Footer/Navigation are structurally editable but visually fixed**: two header styles, no colours, fixed sticky; footer colours and layout are code-fixed; navigation is 12 flat links entered as raw hrefs, and **custom header links never reach mobile** (verified in code, §27 DEF-1).
5. **Three correctness findings contradict the "no fake capability" rule** and should be triaged independent of any new feature: `accentColor` is persisted but consumed by nothing in Customizer/Storefront; custom nav links are hidden below `lg` and absent from `MobileMenu`; the Category page no longer renders category images although the catalog now exposes them (`CategoryBanner.tsx` carries a stale comment).

**Recommendation (detail §31):** insert **one new Horizon before CUST-H5** — working name **CUST-HV "Visual Design & Media Completion"** — in ~10 dependency-ordered slices, starting with a decision/contract slice and a small standalone defect-fix slice. Rationale: Undo/Redo (H5) and version *Restore* snapshot the document and reference media; building them before the document shape (section design fields, announcement region, media references) stabilises means re-testing H5 after every later field, and Restore-vs-deleted-media has no safe answer until media usage awareness exists.

**What this pass did NOT do (honest limits):** it did **not** run the app in a browser. Responsive/RTL/a11y statements come from code inspection plus prior real-browser QA (`CUST-H4-8-INTEGRATED-QA-REPORT.md`, 6 widths AR/EN). The six-width visual matrix for *new* work is therefore proposed as a Definition-of-Done item (§36), not claimed as done here. No screen-reader pass exists anywhere in prior evidence either.

---

## 2. Exact Base SHA

| Item | Value |
|---|---|
| `git fetch origin main` → `origin/main` | `a5a3479e09c3e60a32287e9f1d46e5c2fa236633` |
| Local `HEAD` at audit start | same (detached, clean) |
| H4 closure verification SHA (PR #1226) | `27a8049c5254794f49031e841d4a2549aab7e4cf` (ancestor of base) |
| Branch / Head SHA / PR | none (report file only, uncommitted) |

---

## 3. Sources reviewed

### 3.1 AWJ repository (read at Base SHA)

| Area | Files |
|---|---|
| Roadmap / UX / persistence | `docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` (§§1-17 read in full; §18-21 headers), `AWJ_STORE_CUSTOMIZER_UX_V2.md` (structure), `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` (§24 media), `docs/reports/CUST-H4-CLOSURE-REPORT.md` (full), `CUST-H4-8-INTEGRATED-QA-REPORT.md` (§§7-12) |
| Storage / media decisions | `docs/storage.md` (full), `AWJ_STORE_BRANDING_MEDIA_OWNER_DECISION.md`, `config/product_media.php`, `config/category_media.php`, `deploy/DEPLOY.md` / `render.yaml` (storage lines), `AWJ-STOREFRONT-CATEGORY-MEDIA-IMPLEMENTATION-REPORT.md` |
| Media code | `app/Services/R2StorageService.php`, `ProductMediaService.php`, `app/Models/ProductMedia.php`, `Http/Controllers/Api/ServesProductMediaBytes.php`, `StorefrontMediaController`, `CommerceWorkspaceMediaController`, `StoreProductMediaRequest.php`, `storefront/src/components/ui/product-image.tsx` |
| Presentation contract (web twin) | `web/src/modules/store-experience-builder/presentation/{config,tokens,urls,section-content,section-capabilities,page-regions,page-region-registry,home-sections,flowers-pack}.ts` |
| Presentation contract (PHP authority) | `app/Support/Commerce/StorefrontPresentationNormalizer.php` (constants, logo/banner/section paths), `SaveStorefrontPresentationRequest.php`, `routes/api.php` (presentation routes + RBAC) |
| Customizer UI | `ControlPanels.tsx` (nav groups, Theme/Branding/Header/Homepage/Footer/Pages panels, Banner fields, LogoField), `ExperienceBuilder.tsx` (dirty/conflict/save), `StorefrontPreviewCanvas.tsx` (selection/chrome/viewport), `SectionLibrary.tsx`, `web/src/app/(commerce)/commerce/themes/page.tsx`, `commerce-workspace/theme-registry.ts` |
| Public storefront | `storefront/src/lib/presentation/{public,public-rhythm}.ts`, `components/home/{HeroSection,BannerBand,SectionHeading,CategoriesSection,NewArrivalsSection,FeaturedShelf,…}.tsx`, `components/layout/{Header,Footer,StoreContainer,MobileMenu}.tsx`, `components/products/{ProductCarousel,ProductCard,MediaGallery}.tsx`, `app/.../c/[...permalink]/CategoryBanner.tsx`, `storefront/next.config.ts`, `lib/constants/policies.ts` |
| Parity / tests | `storefront/src/components/customizer/*` (third copy "mirror"), `storefront/src/app/dev/customizer-visual/*`, `tests/Fixtures/presentation/*`, test inventory under `__tests__/` |

Not re-investigated (proven in prior reports and treated as evidence): versions/scheduling (H1), page regions (H2), identity (H3), offers backend (H4-6).

### 3.2 Salla (official, fetched 2026-10-04)

| ID | Source |
|---|---|
| **SAL-HOME** | Help Center EN — *Add and customize homepage elements* `help.salla.sa/en/article/customize-homepage-elements/lgvskplmoaiadn443wlar1fy` (full body read) |
| **SAL-PROMO** | Help Center AR — *إضافة الشريط الإعلاني أعلى صفحات المتجر* `help.salla.sa/article/…/k70g0e7z5tto9xx8ilgyvq6n` (full body read) and legacy *إنشاء شريط الإعلانات* `/article/1289015776` |
| **SAL-ADV** | Twilight — *Salla Advertisement* `docs.salla.dev/478502m0` |
| **SAL-ESL** | Twilight — *Enhanced Slider* `docs.salla.dev/doc-422597` |
| **SAL-HP** | Twilight — *Themes Home Page* `docs.salla.dev/422558m0` |
| **SAL-HDR** | Twilight — *Header Components* `docs.salla.dev/doc-422601` |
| **SAL-DESIGN** | Help Center EN — *Theme design options* `…/theme-design-options/p3b5xvoo6g0l79a7y76qp25k` |
| **SAL-EDIT** | Help Center EN — *Design your store in real time with Salla's interactive editor* `…/acr9nvtaygh1im3cd72e19fx` |
| **SAL-IDENT** | Help Center AR — *تخصيص هوية متجرك: الشعار واللون والخط* `…/xqtm6xx4ed1knb0lm9tbygb5` (full body read) |
| **SAL-MEDIA** | Help Center AR — *إدارة الوسائط: رفع الصور وتنظيمها* `…/a8srfevcnvbw6b5xovi18v6z` (full body read) |
| **SAL-THEMES** | Help Center EN — *Managing themes, customization…* `…/noq1evfqv961rl0kmv3f2lek`; *How the Salla Theme Store works* `…/rddasl45j3g2nlj4xekoj0sp` |
| **SAL-MENU** | Help Center EN — *Managing menus by theme version* `…/symr1rd71tgcls2i9ievdvcb` |
| **SAL-THEME-PAGES** | Help Center EN — Raed / Wesam theme guides (header/footer toggles) |

### 3.3 Daftra (official `docs.daftra.com`, fetched 2026-10-04)

| ID | Tutorial |
|---|---|
| **DAF-TPL** | *Applying the Shop Front Template* |
| **DAF-TPLEDIT** | *Editing Default Pages in the Shop Front Template* |
| **DAF-CP / DAF-CPE** | *Adding a Content Page* / *Editing a Content Page* |
| **DAF-MENU / DAF-ORD** | *Adding an Item to the Shop Front Menu* / *Ordering Menu Items* |
| **DAF-GAL / DAF-GALADD** | *Managing Shop Front Gallery Images* / *Adding an Image to Your Shop Front Gallery* |
| **DAF-PIMG / DAF-CIMG** | *Adding Product/Service Images to the Online Shop* / *Adding Category Images to the Shop Front* |

### 3.4 Evidence that could NOT be obtained (stated, not guessed)

- Salla's *interactive editor* and *design options* articles do not document undo/redo, draft semantics, or per-control mobile behaviour; I do not claim Salla lacks them, only that it is **undocumented in the pages read**.
- Salla Twilight docs list components but **do not document** autoplay, recommended image dimensions for sliders, or RTL notes (stated explicitly by the Enhanced Slider page).
- Daftra's tutorials are step lists; the drag-and-drop **content-page element palette is not enumerated** in them, so I cannot say which blocks Daftra offers. Daftra warns that editing template default pages (homepage) "requires sufficient knowledge of web page programming" (**DAF-TPLEDIT**).
- Production environment flags (`PRODUCT_MEDIA_R2_ENABLED`, `CATEGORY_MEDIA_R2_ENABLED`, `DOCUMENT_DURABLE_STORAGE_ENABLED`) cannot be read from the repo — see Unknown U1.

---

## 4. Current AWJ architecture summary

### 4.1 Three-layer presentation contract

```
Merchant UI (web/…/store-experience-builder)   ← Canvas = its OWN re-implementation of the storefront
        │  PUT draft / version  (config JSON, revision-checked)
        ▼
PHP authority  StorefrontPresentationNormalizer  (fail-closed, MAX_DOCUMENT_BYTES 1.5 MiB)
        │  publish → published snapshot
        ▼
Public storefront (storefront/, Next 15) reads Published only, host-resolved tenant
```

Normalizer implementations: **PHP (authoritative) + web TS twin + storefront TS twin**, plus a **third renderer copy** (`storefront/src/components/customizer/*` "mirror", used by dev harness). Parity is by *duplication + shared fixtures*, not by shared code. [AWJ-Existing]

### 4.2 Document shape today (`PRESENTATION_CONFIG_VERSION = 3`)

`themePreset (7) · primaryColor · accentColor · fontPreset (2) · density (2) · radius (3) · productCard (2) · branding{displayName, logo/compactLogo/favicon as data-URL or https} · header{style (2), showSearch/Account/Cart/CategoryNav, links ≤12 flat} · homepage{sections ≤30 [{id,type,visible,content?}], heroHeadline, heroSubheadline (GLOBAL, not per-instance)} · footer{tagline, showLogo, copyright} · contact · whatsapp · social ≤8 · verification · sbc · apps · pages[7 fixed slugs, GATED] · pagePresentation{product ≤9 regions, category ≤6 regions}`

There is **no `design`/`style` namespace on sections, header, footer or global config beyond the four enum presets above.**

### 4.3 Section registry (13 types, all LIVE)

`hero(singleton, non-deletable) · categories · newArrivals · wholesale · appPromo · deliveryPromise` (singletons) · `banner · featured(≤8) · offers(≤8) · benefits(≤6) · customContent(≤8 blocks: heading|paragraph only) · productShelf · discovery` (multi). Content contracts are typed and bounded (`section-content.ts`).

### 4.4 Editor chrome

13 panels in 4 groups (Theme/Branding · Header/Homepage/Product/Category/Footer · Contact/WhatsApp/Social · Verification/Apps/Pages). Section editing = **one flat panel**: visibility toggle + type-specific content fields. **No Content/Design/Layout/Advanced tabs exist** (grep `role="tab"` in builder: none). Reorder = up/down buttons (no drag). Add = Section Library (search, 7 categories, honest state badges). Click-to-edit works for sections, header, footer, branding, WhatsApp, social, product regions, category regions. [AWJ-Existing]

### 4.5 Approved media/storage foundations (what exists, precisely)

| Foundation | Evidence | Status |
|---|---|---|
| `R2StorageService` — ACL-free `put/get/exists/delete`, server-derived key `tenant/{tenant_id}/{domain}/{resource_id}/{filename}`, tenant read **only** from `TenantContext` | `app/Services/R2StorageService.php`; `docs/storage.md` — real Production smoke test passed against `awj-production` bucket (AWJ-R2-3) | **Production-proven** |
| `ProductMedia` (disk column `document`\|`r2`, per-row backend, 5 MB, jpg/jpeg/png/webp, ≤8 per scope, guarded stream routes, 404-indistinguishable) | `ProductMedia.php`, `ProductMediaService.php`, `StoreProductMediaRequest.php` | Code complete; **new writes to R2 gated by `PRODUCT_MEDIA_R2_ENABLED` (default false)** |
| Category images on R2 (`tenant/{id}/product-category-media/{cat}/{file}`, no migration) | `docs/storage.md`; `CategoryMediaR2Test` | Flag `CATEGORY_MEDIA_R2_ENABLED` default false |
| Workspace signed media route (20-min, `temporarySignedRoute`, fresh tenant/channel re-check) | H4-8b; `CommerceWorkspaceMediaController` | Merged, QA'd |
| Public host-resolved media route `max-age=3600` | `StorefrontMediaController` | Merged |
| `DocumentStorageService` (local disk unless durable flag on) | `deploy/DEPLOY.md`: `DOCUMENT_DURABLE_STORAGE_ENABLED=false`, ephemeral disk | Documented as **not durable** |

**Two documents conflict and need an Owner reconciliation (§35 O1):**
`AWJ_STORE_BRANDING_MEDIA_OWNER_DECISION.md` (2026-09-26, key `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`) rules *no branding upload endpoint, no second storage service, keep Base64 logos, keep banner https URLs* because the only file authority it considered (`DocumentStorageService`) is ephemeral. `docs/storage.md` documents a later, separate R2 foundation with Production proof and two live consumers. The decision's *premise* (no durable storage) no longer holds for R2-backed domains, but its *text* has not been superseded.

---

## 5. Salla evidence summary

| Topic | What Salla documents | Source |
|---|---|---|
| **Homepage element catalogue** | ≈26 elements incl. Fixed Banner (728×90 or any), Photos Slider (≤10 images + link each), Enhanced Animated Images (≤10, 900×600), Enhanced Square Images, Square Photos, Store Highlights (≤3), Promotion (headline + CTA + link), Slider (slides: bg colour **or** image, title, description, side image, button+link, "advanced layout controls"), Features Grid (layout, content alignment, text alignment), Statistics, FAQ, Card Gallery / Enhanced Card Gallery (1-8 cards), Enhanced Categories (≤30), Short Videos (≤10), YouTube, Blog, Reviews (≤30), Deals (≤10 coupons), Moving Products, Moving Products with Background, **Enhanced Banner** | SAL-HOME |
| **Enhanced Banner controls** | optional **expiry date**, title+subtitle, optional button+link; **text colour, background colour, background image, text alignment, optional white-button style, full-screen background mode** | SAL-HOME |
| **Element management** | Hide (with "Show Again"), Duplicate (all settings), **Rename**, Delete (**confirmation shown**), reorder by **drag handle**, Edit by clicking name; elements/options "differ from one theme to another" | SAL-HOME |
| **Interactive editor** | Hover highlights section with label + **action bar**: Edit · Hide · Move Up/Down · Duplicate · Add · Delete; works on mobile; instant preview | SAL-EDIT |
| **Announcement/promo bar** | Path: Store Design → Customize → Store Pages → *Header* tab → *Announcement bar* → "+ New announcement". Fields: **title, text, icon (picker), link (product/category/external…), expiry date, pages where it shows, theme version it applies to, background colour, text colour, "moving text" toggle**. Manage: enable/disable, edit, delete. Multiple announcements supported ("+ create new"). Appears at **top of chosen pages**. | SAL-PROMO |
| **Advertisement component** | fields `icon, url, target, description, bg_color, text_color`; docs state nothing about multiple items, ticker or dismissal | SAL-ADV |
| **Design options** | per-version tab: Arabic numerals, "Powered by" label, breadcrumbs, **unify product image height (cover vs full image)**, vertical product layout, "View all" button, **sticky main menu**, **dark mode for top/bottom bars**, add-to-cart confirmation, **image zoom** in product slider. Docs say these are "organised by functional category rather than colour/typography" | SAL-DESIGN |
| **Header/footer by theme** | Wesam: dark mode, **transparent header** toggle, newsletter/app icons in footer, store map, **light/dark footer**. Raed: header menu with categories, footer support channels, business-certificate badge, social, app links | SAL-THEME-PAGES |
| **Identity** | Store data (name, description, **logo**, **favicon**), **store colour**, **font** from list or **own font upload** (name, weight Regular/Medium/Bold, file). Identity applies to *every* theme. Business-verification number shown in footer automatically | SAL-IDENT |
| **Media library** | One library: **drag-and-drop & multi-upload**, folders, search, filter by type/size/linked product, "choose from gallery" in every upload slot, file details (size, dates), **edit name + alt text AR/EN**, copy link, download, assign to product(s), **assignment status**, **delete warning: removes everywhere it is used and substitutes default**, best-practice "review unused files" | SAL-MEDIA |
| **Menus** | Core menus (fixed) + custom menus; items = title + link type (category/product/page/URL) + target + optional icon; **drag-and-drop**; **assign menus to header/footer per theme version** | SAL-MENU |
| **Theme versions** | Duplicate, customise independently, preview ("how your store will look when activated"), publish default/custom (market/language) with schedule; **cannot delete active version** | SAL-THEMES |
| **Theme store** | Cards: name, price, rating, best-suited activity; hover = **Try for free · Buy · Preview**; **preview store with a theme before purchase**; statuses Draft/Scheduled/Published | SAL-THEMES |

**Not documented / not proven by Salla:** undo/redo; autoplay semantics for Salla sliders; ticker speed; dismissal of announcements; per-device design.

## 6. Daftra evidence summary

| Topic | What Daftra documents | Source |
|---|---|---|
| **Template apply flow** | Shop Front → Settings → *Website Template* → **View Demo** (preview before applying) → **Apply** → **OK** (explicit confirmation). A template = "framework of visual appearance and visible functionalities (image placements, content, buttons…)" | DAF-TPL |
| **Template page editing** | Per-template *Settings* → manage a default page (homepage, login, product, order-confirmation) → Save. **Warns the homepage "requires sufficient knowledge of web page programming"** | DAF-TPLEDIT |
| **Content pages** | Manage Content → *New Content* (name only) → Save → *Edit* → **design by dragging & dropping elements into the empty area** → Save. Content pages can be linked from the menu | DAF-CP, DAF-CPE |
| **Menu items** | Fields: Name, Type ∈ {Category, Link, Home Page, Product, Contact Us Page, Content Page}, target value; item moves to a right-hand ordering list; Save | DAF-MENU |
| **Menu ordering** | **Up/down arrow buttons *or* drag-and-drop**; **submenus up to 2 levels below a top item** via drag or a "↴" button (keyboard-reachable alternative) | DAF-ORD |
| **Gallery** | Manage Gallery Images: edit title, delete, download; add by **drag-and-drop or "select from your computer"**; size/format limited by system | DAF-GAL, DAF-GALADD |
| **Product images** | Multi-image gallery; drag-and-drop upload; **✔ marks the main image** used everywhere | DAF-PIMG |
| **Category images** | Upload in category edit; appears on homepage category list and category page; **max 20 MB** | DAF-CIMG |

**UX lessons (not features to copy):** (1) *View Demo → Apply → confirm* is the simplest mental model for templates; (2) up/down **and** drag for ordering gives a keyboard/touch path for free; (3) content-page creation starts with **just a name**; (4) Daftra's weakness is explicit: homepage editing is developer-grade — AWJ's structured sections are already better and must not regress to that.

---
## 7. Master Gap Matrix

**Status vocabulary** (as required): `COMPLETE · PARTIAL · MISSING · INTENTIONALLY_DEFERRED · PRODUCT_DECISION_REQUIRED · BACKEND_GATED`.
**Priority:** **P0** = a merchant cannot brand/operate credibly without it, or it is a "no fake capability" defect · **P1** = required for a "mature visual builder" claim · **P2** = high-value, schedulable · **P3** = optional/later · `—` = nothing to do.

**Evidence shorthand (repo, all under Base SHA):**
`CP` ControlPanels.tsx · `EB` ExperienceBuilder.tsx · `CAN` StorefrontPreviewCanvas.tsx · `CFG` presentation/config.ts · `TOK` tokens.ts · `SC` section-content.ts · `CAP` section-capabilities.ts · `URL` urls.ts · `PN` StorefrontPresentationNormalizer.php · `SFH` storefront components (HeroSection/BannerBand/Header/Footer/…) · `ST` docs/storage.md.
**External shorthand:** SAL-*/DAF-* per §3.2/§3.3. `—` = the source documents nothing relevant (not "Salla lacks it").

> Every row labels evidence the way the evidence-discipline rule requires: the *AWJ today* and *Repo evidence* columns are **[AWJ-Existing]**; *Salla*/*Daftra* are **[Salla]/[Daftra]**; *Gap → Direction* is **[AWJ-Proposal]**; rows marked PRODUCT_DECISION_REQUIRED are **[Owner-Decision]**.

### 7.A Global design

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| G01 | Theme presets | 7 colour presets; only `awj-market`, `awj-bloom` carry a starting bundle | `TOK THEME_PRESETS`, `CFG PRESET_STARTING_BUNDLES`, `CP ThemePanel` | Themes are full templates (layout+features) | Template = "framework of look + functions" (DAF-TPL) | 4 of 7 presets are colour-only; no preset owns background/typography/section defaults | Promote presets to *bundles* (colour + type + density + card + header + default section styling) once the design contract exists | PARTIAL | P2 | G04, C01 |
| G02 | Primary colour | Hex picker + WCAG contrast hint; derives 9 CSS tokens | `CP ThemePanel`, `TOK presentationCssVars` | Store colour from list (SAL-IDENT) | — | none | keep | COMPLETE | — | — |
| G03 | Accent / secondary colour | Field persisted + normalised; **no builder control, no storefront consumer** (only mobile app-builder reads it) | grep `accentColor`: `CFG:87,449`, `web/…/app-builder/theme-panel.tsx:47`; none in `storefront/src` renderers | — | — | Dead field = fake capability in the contract | Either wire it into a bounded token (§30) **or** remove from the contract in a back-compat way | PARTIAL | P1 | O6 |
| G04 | Backgrounds, surfaces, text colours | Fixed tokens (`--store-surface`, `--store-footer*`); not merchant-editable | `SFH Header bg-store-surface`, `Footer bg-store-footer` | Dark mode for bars; light/dark footer; transparent header (SAL-DESIGN, SAL-THEME-PAGES) | — | No way to change page/section/footer/header background | Bounded **palette tokens** (e.g. surface / muted / brand-tint / inverse) chosen by name, with auto-foreground + contrast check; free hex only as an Advanced option | MISSING | P1 | C01, G14 |
| G05 | Font presets | 2 Arabic faces (Cairo, Tajawal) over Geist; single control | `TOK FONT_PRESETS`, `CUST-H3-2` decision | Font list + own upload (SAL-IDENT) | — | Only 2 choices | Add 2-4 more *curated* faces behind the same control (needs font-loading review) | PARTIAL | P2 | G07 perf |
| G06 | Heading/body split, font sizing | Deliberately one control | `CUST-H3-2-COLOR-TYPOGRAPHY-EVIDENCE-DECISION.md` | — | — | n/a | Respect H3-2 decision; revisit only with evidence | INTENTIONALLY_DEFERRED | P3 | — |
| G07 | Custom font upload | `customFontUpload = GATED` | `capabilities.ts`, `CUST-H3-ARCH-1` | **Documented**: name + weight + file (SAL-IDENT) | — | Needs tenant media + CSP + licensing copy | Do *after* media foundation (reuse R2 domain `storefront-fonts`) | BACKEND_GATED | P3 | M09, CSP (U3) |
| G08 | Density | comfortable / compact, shared Canvas/Published helper | `TOK pageContainerPaddingClass`, `public-rhythm.ts` | — | — | none | keep | COMPLETE | — | — |
| G09 | Radius | default / subtle / sharp → `--store-radius` | `TOK RADIUS_PRESETS` | — | — | none | keep | COMPLETE | — | — |
| G10 | Borders, shadows, button style | Not configurable (radius only) | — | — | — | Roadmap H3 listed "button shape"; only radius shipped | 3-option *button style* (solid / soft / outline) if Owner wants; borders/shadows stay theme-owned | MISSING | P3 | O7 |
| G11 | Product-card style | standard / compact only | `TOK PRODUCT_CARD_PRESETS`, `public-rhythm.publishedProductCardBodyClass` | Image-as-cover vs full image; vertical layout (SAL-DESIGN) | — | No image-fit/ratio/title-lines | Add `imageFit` + `imageRatio` presets (see PC02) | PARTIAL | P2 | PC02 |
| G12 | Container width / spacing rhythm | Fixed `--store-content-max`; density only | `StoreContainer.tsx` | — | — | Owner has not decided whether width is merchant-controllable | Keep global; allow per-section `full`/`contained` only (C01) | PRODUCT_DECISION_REQUIRED | P3 | O8 |
| G13 | Dark/light storefront | None | — | Dark mode for header/footer bars (SAL-DESIGN) | — | No dark surfaces | Defer; footer/header *inverse* tokens (G04) cover the common ask | PRODUCT_DECISION_REQUIRED | P3 | O8 |
| G14 | Contrast guardrails | Warn-only on primary vs white | `CP ThemePanel contrastWarn` | — | — | Every new colour control multiplies the risk | Compute foreground automatically (as `primaryForeground` does) and **block** save below 3:1 / warn below 4.5:1 for any merchant colour | PARTIAL | P1 | G04 |

### 7.B Media

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| M01 | Upload an image for a section (hero/banner/…) | **Not possible.** Banner `imageUrl` = pasted https; Hero has no image | `SC` header comment "Images are https URLs only"; `CP BannerFields` text input; `HS` no image prop | Upload in every slot + "choose from gallery" (SAL-MEDIA) | Drag-drop or select (DAF-GALADD) | The single largest gap | Customizer media object on R2 (§8) | MISSING | **P0** | M09, M12 |
| M02 | Choose existing / reuse | None for storefront; ERP has `product-media-section.tsx` for products only | `web/src/components/products/product-media-section.tsx` | Library: search, filter, folders, reuse (SAL-MEDIA) | Gallery images manager (DAF-GAL) | No shared picker | One `MediaPicker` (upload ∣ library tab) | MISSING | P1 | M01 |
| M03 | Replace / remove | Clear the URL text | `CP BannerFields` | Edit name/alt, move, unassign, delete (SAL-MEDIA) | Delete icon in gallery edit (DAF-GAL) | No replace-in-place preserving alt/placement | Replace = pick another media; keep alt unless changed | PARTIAL | P1 | M01 |
| M04 | Safe deletion + usage awareness | n/a (no object) | — | **Warns** deletion removes it everywhere & substitutes default; per-file assignment status (SAL-MEDIA) | — | Deleting a used image would break draft/versions/published | Reference scan over draft + all versions + published before delete; block or require explicit "remove from N places" | MISSING | P1 | M01; **H5 Restore** |
| M05 | Alt text | Banner `imageAlt` only (≤150, default decorative); logos `alt=""`; hero none | `SC MAX_BANNER_IMAGE_ALT_LENGTH`, `CP LogoField` | Alt AR/EN on file (SAL-MEDIA) | — | Alt lives per usage, not per asset; no bilingual | Alt stored on media object (AR/EN) with per-usage override | PARTIAL | P1 | M01, A-series |
| M06 | Validation (MIME, size, dimensions) | Logos: client `accept` + server regexp + **512 KiB**; products: **5 MB jpg/jpeg/png/webp**; banner: URL regexp only | `PN MAX_LOGO_BYTES`, `StoreProductMediaRequest`, `URL SAFE_LOGO` | "size and format comply with system" (DAF-GALADD) | 20 MB category cap (DAF-CIMG) | No server-side magic-byte/dimension checks on any customizer media | Reuse product rules (5 MB, jpg/png/webp, no SVG), add decoded-dimension min/max + pixel cap | PARTIAL | P0 | M01 |
| M07 | Optimisation, thumbnails, dimensions | **None found.** Proxy images render `unoptimized`; banner uses raw `<img>` with no width/height | `product-image.tsx` (unoptimized for proxy), `BannerBand.tsx`; no resize lib referenced in `composer.json` (grep negative — verify) | "use images suited to quality and speed" (best practice only) | — | LCP/CLS/bandwidth risk grows with hero images | Generate 2-3 WebP variants at upload (needs imaging lib decision) and serve by `srcset`; store width/height | MISSING | P1 | O3, U4 |
| M08 | Public delivery & caching | Product media: `public, max-age=3600` via host-resolved route; workspace: `private, max-age=600` signed | `StorefrontMediaController:66,89`, `CommerceWorkspaceMediaController:78` | — | — | 1h cache, no ETag/immutable; fine for products, wasteful for static brand assets | Content-hashed filenames → `immutable` long cache for customizer media | PARTIAL | P1 | M01 |
| M09 | Tenant isolation / RBAC for customizer media | Pattern proven for products (`commerce.manage`, 404-indistinguishable, signed workspace route) but **no customizer media contract** | `CUST-H4-ARCH-1 §24` (sketch: tenant row, `commerce.manage`, jpeg/png/webp, R2, guarded controller) | — | — | Contract never authorised | Implement §24 sketch exactly, extending `ProductMedia` pattern | BACKEND_GATED | **P0** | O1, O2 |
| M10 | Logo / compact logo / favicon storage | **Base64 data-URLs inside presentation JSON** (≤512 KiB each) or pasted https | `CP LogoField FileReader.readAsDataURL`, `PN cappedLogo`, `capabilities.ts BRANDING_PERSISTENCE_CAPABILITY="design_only"` | Upload; one identity across all themes (SAL-IDENT) | — | (a) Brief says "no ad-hoc Base64 architecture"; (b) 3×512 KiB ≈ 1.5 MiB = whole `MAX_DOCUMENT_BYTES` → a save with three max logos is rejected; (c) base64 duplicated into every version; (d) stringified on every render (§28) | Migrate to media object refs (back-compat read of existing data-URLs; lazy re-save) | PRODUCT_DECISION_REQUIRED | P1 | O1 (supersedes 2026-09-26 decision) |
| M11 | Empty / loading / uploading / error states | none (no upload) | — | — | — | Must be designed with M01 | See §26 | MISSING | P1 | M01 |
| M12 | Production R2 enablement for new media | Flags default **false**; Production state not visible from repo | `config/product_media.php`, `config/category_media.php`, `deploy/DEPLOY.md` (`DOCUMENT_DURABLE_STORAGE_ENABLED=false`) | — | — | If the flag is off in Production, new customizer media would land on an ephemeral disk | Customizer media must be **R2-only** (no `document` fallback) or refuse when R2 is not configured | BACKEND_GATED | **P0** | U1 |

### 7.C Image presentation

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| I01 | Fit (cover / contain) | Banner hard-coded `object-cover`; product cards `object-cover` | `BannerBand.tsx`, `ProductCard.tsx:108` | Product image "cover vs full image" toggle (SAL-DESIGN) | — | No merchant choice | Per-media-usage `fit: cover∣contain` | MISSING | P2 | C01 |
| I02 | Focal point | none | — | — | — | Centre-crop can decapitate portraits on mobile | One `focal` (9-point grid or x/y %) → `object-position`; shared by all breakpoints | MISSING | P2 | M01 |
| I03 | Crop tool | none | — | — | — | — | **Do not build** (focal + aspect presets cover the need; avoids Figma-style editing) | INTENTIONALLY_DEFERRED | — | — |
| I04 | Aspect ratio / height presets | Banner `h-36 md:h-40 md:w-56` fixed; hero min-height by preset (market vs default) | `BannerBand.tsx`, `HeroSection.tsx` | Fixed banner "728×90 or any" (SAL-HOME) | — | No ratio/height choice | 3-4 named ratios (wide 3:1, banner 16:5, standard 16:9, square) + height presets; one responsive document | MISSING | P1 | C01 |
| I05 | Separate mobile image / responsive focal | none | — | — | — | Risk of per-device divergence | Defer; roadmap rule: one responsive document | INTENTIONALLY_DEFERRED | — | O9 |
| I06 | Image fallback | Product: icon fallback on error; banner: broken `<img>` | `product-image.tsx`, `BannerBand.tsx` | Deleted media → default substituted (SAL-MEDIA) | — | Banner shows broken glyph if URL dies | `onError` hide-image fallback + decorative background | PARTIAL | P1 | M01 |

### 7.D Hero

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| H01 | Headline / subheadline | Global fields `homepage.heroHeadline` (120) / `heroSubheadline` (200); hero instance holds **no content**; non-deletable singleton | `CFG homepage`, `CAP hero.canDelete=false` | Promotion: headline + CTA (SAL-HOME) | — | Not per-instance, so no duplicate/second hero, no per-version independence beyond doc | Move to `HeroContent` on the instance (back-compat: read global as fallback); allow deletion once content is local | PARTIAL | P1 | O10 |
| H02 | CTA label + URL | **Hard-coded** "shopNow" → `${basePath}/products` | `HeroSection.tsx` | Button + link (any link type) (SAL-HOME) | — | Merchant cannot choose CTA | `ctaLabel` + safe `ctaHref` (reuse `sanitizeContentHref`) | MISSING | P1 | H01 |
| H03 | Hero image / background | None. Gradient from primary | `HeroSection.tsx bg-linear-to-r from-primary-700…` ("anything put there would be storefront invention" — comment) | Slider/Banner: bg colour or image (SAL-HOME) | — | The comment is right *because no merchant image exists*; with M01 it stops being true | `background: { kind: gradient∣solid∣image }` | MISSING | **P0** | M01 |
| H04 | Overlay colour / opacity / text colour | n/a | — | Text colour, bg colour, full-screen bg (SAL-HOME Enhanced Banner) | — | Needed the moment H03 lands (legibility) | `overlay: none∣dark∣light∣brand` + 3 strengths; auto text colour; contrast check | MISSING | P1 | H03, G14 |
| H05 | Alignment / content position | start-aligned only | `HeroSection.tsx max-w-2xl` | Text alignment (SAL-HOME) | — | — | `align: start∣center` (logical, RTL-safe) + `valign` optional | MISSING | P2 | C01 |
| H06 | Height presets, width, radius | Fixed by theme (market 7-10 rem; default 11-18 rem) | `HeroSection.tsx` | Full-screen mode; wide toggle (`is_wide`, SAL-ESL) | — | — | `height: compact∣standard∣tall`, `width: contained∣full` | MISSING | P2 | C01 |
| H07 | Alternate layouts | one | — | Slider "image beside text" (SAL-HOME) | — | — | 2 variants: text-over-image, split (text + image) | MISSING | P2 | H03 |
| H08 | Secondary CTA | none | — | single button | — | — | Keep one CTA | INTENTIONALLY_DEFERRED | — | — |
| H09 | Mobile behaviour | Stacked, line-clamped sub | `HeroSection.tsx` | works on mobile | — | untested with images | Verify at 390/430 in DoD | PARTIAL | P1 | H03 |

### 7.E Banner

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| B01 | Title / subtitle / CTA / link / alt | Typed, sanitised, code-point-safe; `imageAlt` (H4-4) | `SC BannerContent`, `PN` | Enhanced Banner: title, subtitle, optional button+link (SAL-HOME) | — | none | keep | COMPLETE | — | — |
| B02 | Image upload / select | https URL text box | `CP BannerFields` | upload (SAL-HOME) | — | = M01 | MediaPicker | MISSING | **P0** | M01 |
| B03 | Background colour, overlay, opacity, text colour | none | — | **text colour, bg colour, bg image, white button** (SAL-HOME) | — | no design fields | `style: { background: token, overlay, textTone }` | MISSING | P1 | C01, G14 |
| B04 | Content position / alignment | image left, text right (md) fixed | `BannerBand.tsx` | text alignment | — | — | `align`, `imagePosition` | MISSING | P2 | C01 |
| B05 | Height, aspect, full-width, radius, spacing | fixed `h-36 md:h-40 md:w-56` | `BannerBand.tsx` | any dimensions | — | — | I04 presets + `width` | MISSING | P1 | I04 |
| B06 | Layout variants | one (image + text card) | — | Fixed banner / Enhanced banner / Promotion = 3 flavours | — | AWJ has 1 | 3 variants: *card*, *full-bleed image*, *text-only band* | MISSING | P1 | M01 |
| B07 | Per-banner expiry | none; whole-document scheduling exists (H1) | `CUST-H1` | optional expiry (SAL-HOME) | — | different problem | Keep version scheduling; add expiry only if Owner wants campaign banners without a new version | INTENTIONALLY_DEFERRED | P3 | O11 |

### 7.F Slider / carousel / gallery

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| S01 | First-class image Slider section | **None** (Swiper only inside product rails) | `ProductCarousel.tsx` (swiper ^12) | Photos Slider ≤10; Slider; Enhanced Slider 1-10 slides {image, title, description} (SAL-HOME, SAL-ESL) | — | Missing, and it is the most common merchant homepage hero | **Yes — one `slider` section**, 2-6 slides {media, title, subtitle, link/CTA}, add/remove/duplicate/reorder; reuse Swiper | MISSING | P1 | M01, S02 |
| S02 | Autoplay / pause / arrows / dots / swipe / RTL / reduced motion | n/a | `globals.css @media (prefers-reduced-motion)` exists | not documented (SAL-ESL says developer's choice) | — | Policy needed | Default **no autoplay**; if enabled: ≥5 s, pause on hover/focus, pause button, off under reduced-motion | PRODUCT_DECISION_REQUIRED | P1 | O4 |
| S03 | Gallery section | none | — | Card Gallery (1-8), Short Videos (SAL-HOME) | Gallery images manager (DAF-GAL) | — | `gallery`: 2-12 images, grid 2/3/4 columns, optional captions; **no masonry, no lightbox** | MISSING | P2 | M01 |
| S04 | Product rail vs grid (merchant control) | Code decides (carousel for featured/shelf at some widths, grid otherwise) | `FeaturedShelf.tsx:56,70`, `NewArrivalsSection.tsx`, `ProductShelfSection.tsx` | Moving Products vs Fixed Products (SAL-HOME) | — | no merchant choice | `layout: grid∣rail` + `columns` preset | PARTIAL | P2 | C01 |
| S05 | Lightbox / masonry / video | none | `MediaLightbox.tsx` exists for PDP | YouTube, Short Videos | — | — | Not for this Horizon | INTENTIONALLY_DEFERRED | — | CSP/privacy |

### 7.G Announcement / promo bar

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| N01 | Announcement bar (one or many; text, icon, link) | **Nothing** — grep `announcement\|promo.?bar\|marquee\|ticker` across `storefront/src`, builder, normalizer: no match | — | **Yes**: multiple, title + text + icon + link (SAL-PROMO) | — | Missing surface | Global *chrome region* `announcements[]` (max 3), see §12 | MISSING | **P1** | none (media-independent) |
| N02 | Bar colours | n/a | — | background + text colour (SAL-PROMO, SAL-ADV) | — | — | Token palette (brand / inverse / accent-tint / neutral) + auto foreground | MISSING | P1 | G14 |
| N03 | Moving text / carousel of messages | n/a | — | "moving text" toggle (SAL-PROMO); ticker undocumented (SAL-ADV) | — | motion & a11y policy | Off by default; if on: CSS-only marquee, pause on hover/focus, disabled under `prefers-reduced-motion`, never the only way to read the text | PRODUCT_DECISION_REQUIRED | P2 | O5 |
| N04 | Expiry, scheduling, page targeting | n/a | — | **expiry date**, **pages**, **theme-version** scope (SAL-PROMO) | — | — | `startsAt?`, `endsAt?`, `pages: home∣product∣category∣all`; version scope is automatic (lives in the presentation document) | MISSING | P1 | cache (U5) |
| N05 | Sticky / dismissible | n/a | — | not documented | — | — | Default non-sticky, non-dismissible; dismiss only with per-visitor `localStorage` flag (no server state) | PRODUCT_DECISION_REQUIRED | P3 | O5 |

### 7.H Header & navigation

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| HD01 | Layout variants | `standard` / `compact` | `TOK HEADER_STYLES`, `Header.tsx compact` | per-theme | — | 2 variants | Add `centered-logo`; keep ≤3 | PARTIAL | P2 | HD04 |
| HD02 | Logo + compact logo | Upload (Base64) / https; compact used when header compact | `public.ts publishedLogoUrl`, `StoreBrand.tsx` | logo + favicon (SAL-IDENT) | — | storage per M10 | keep behaviour; storage migration | COMPLETE | — | M10 |
| HD03 | Logo size / alignment | fixed `size="md"`; centred on mobile, start on md | `Header.tsx` | — | — | — | 3 size presets | MISSING | P3 | — |
| HD04 | Header colours, transparency | none | `Header.tsx bg-store-surface` | **transparent header**, dark bar (SAL-THEME-PAGES) | — | no colour control | `tone: surface∣brand∣inverse`; transparent only when overlaying a hero image (needs H03) | MISSING | P2 | G04, H03 |
| HD05 | Search / account / cart toggles | Yes | `CFG header.show*` | — | — | none | keep | COMPLETE | — | — |
| HD06 | Category-nav toggle | Yes (real categories in Published; **fixture** in Canvas) | `CFG showCategoryNav`; `CAN PREVIEW_CATEGORIES` (H4 closure §16) | header menu with categories (SAL-THEME-PAGES) | — | parity gap in Canvas | Feed Canvas from the same workspace categories read as H4-3 did for the section | COMPLETE | — | see HD09 |
| HD07 | Sticky control | **Always sticky** (`sticky top-0`) | `Header.tsx` | **sticky main menu toggle** (SAL-DESIGN) | — | no choice | Add `sticky: on∣off` only if announcement-bar interaction is resolved | PRODUCT_DECISION_REQUIRED | P3 | N05 |
| HD08 | Mobile header | Fixed 54 px brand-centred grid, search second line | `Header.tsx` | — | — | custom links absent (NV03) | — | PARTIAL | P1 | NV03 |
| HD09 | Canvas header/footer category fixtures | `PREVIEW_CATEGORIES` still feeds header rail + footer "Shop" column | H4 closure §16 | — | — | Canvas shows invented categories | Wire to real data | PARTIAL | P2 | — |
| NV01 | Primary links | ≤12 flat; kinds home/category/product/content/external; label ≤80; enable; up/down | `CFG header.links`, `CP HeaderPanel` | Menus with title, type, target, icon (SAL-MENU) | Name + Type + target (DAF-MENU) | no icon, no target | Keep kinds; add `openInNewTab` for external only | PARTIAL | P1 | NV02 |
| NV02 | Link pickers | **Raw `href` text box** beside a kind dropdown | `CP HeaderPanel` (select kind + input href) | choose category/product/page from list | dropdown of existing categories / products / content pages (DAF-MENU) | Merchant must know/type internal paths | Pickers reusing `CategoryPreviewPicker` / `ProductPreviewPicker` patterns | MISSING | P1 | — |
| NV03 | Custom links on mobile | **Not rendered below `lg`**: `Header` shows them `hidden … lg:block`; `MobileMenu` receives only categories + wholesale | `Header.tsx:171`, `MobileMenu.tsx` (no `extraLinks`), `layout.tsx:177,228` | menus apply to mobile | — | Link shows in Canvas but not on phones = parity defect (DEF-1) | Pass `extraLinks` into `MobileMenu` | MISSING | **P0** | — |
| NV04 | Submenus / nesting | flat | — | menus (depth undocumented in pages read) | **up to 2 submenu levels** (DAF-ORD) | — | 1 level of children is enough for AWJ; Owner choice | PRODUCT_DECISION_REQUIRED | P2 | O12 |
| NV05 | Drag-and-drop ordering | up/down only | `CP aria-label moveUp/moveDown` | drag handle (SAL-HOME/MENU) | **up/down *and* drag** (DAF-ORD) | — | Add drag, **keep** buttons as the keyboard/touch path | MISSING | P3 | — |
| NV06 | Safe URLs | external must be https; internal prefixed with basePath | `URL sanitizeExternalUrl`, `public.ts resolvePresentationHref` | — | — | none | keep | COMPLETE | — | — |

### 7.I Footer

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Content (tagline ≤200, copyright ≤120, logo, contact, WhatsApp, social ≤8, apps) | Complete, sanitised | `CFG footer/contact/social/apps`, `Footer.tsx` | support channels, social, app links (SAL-THEME-PAGES) | — | none | keep | COMPLETE | — | — |
| F02 | Footer colours (bg, text, link) | Fixed `--store-footer*` tokens | `Footer.tsx:204` | **light/dark footer** (Wesam) | — | none | `tone: default∣brand∣inverse` with auto link/foreground + contrast guard | MISSING | P2 | G04, G14 |
| F03 | Layout variants / columns | Fixed grid `grid-cols-2 sm:grid-cols-3` + contact grid `sm:2 lg:3` | `Footer.tsx:234,302` | — | — | none | 2 variants max (compact / expanded) | MISSING | P2 | — |
| F04 | Footer navigation groups | Code-fixed: policy links (`POLICY_LINKS`) + category links | `lib/constants/policies.ts`, `Footer.tsx` | choose menu for footer per version (SAL-MENU) | — | Merchant cannot add/rename/reorder footer links | `footer.groups[]` (≤4 groups × ≤6 links) reusing nav link kinds | MISSING | P2 | NV02 |
| F05 | Divider / spacing / bg image | none | — | — | — | — | Do not build | INTENTIONALLY_DEFERRED | — | — |
| F06 | Mobile layout | stacked 2-col | `Footer.tsx` | — | — | untested with long AR/EN | verify in DoD | PARTIAL | P2 | — |
| F07 | CR/VAT/SBC identity presentation | Official marks, no merchant-minted "verified" | `STORE-TRUST-*`, `CFG verification` | verification number auto in footer (SAL-IDENT) | — | none | keep | COMPLETE | — | — |

### 7.J Homepage-wide & product/category surfaces

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| C01 | Bounded common section design contract | **None.** Only `{id,type,visible,content?}` | `CFG PresentationHomeSection` | per-element layout/colour/alignment (SAL-HOME) | — | no place to attach design | Typed `design?` per section type, whitelist of fields (§30); *not* a universal bag | MISSING | **P1** | normalisers ×3, IN01 |
| C02 | Section heading text / visibility | Only `productShelf`/`discovery`/`deliveryPromise` carry `title`; others use fixed i18n | `SC`, `SectionHeading.tsx` | rename element; main title per element | — | no title override on featured/offers/newArrivals/categories | `title?` + `showTitle` on those types | PARTIAL | P2 | C01 |
| C03 | Section anchor id | none | — | — | — | — | Not needed | INTENTIONALLY_DEFERRED | — | — |
| C04 | Rename a section (editor label) | none | — | **Rename element** (SAL-HOME) | — | merchants with 6 banners cannot tell them apart | optional `label` (editor-only, never rendered) | PRODUCT_DECISION_REQUIRED | P2 | O13 |
| CT01 | Categories section data | Real categories; image → verified colour → neutral | `CategoriesSection.tsx`, #1110 | Enhanced Categories ≤30 (SAL-HOME) | category images (DAF-CIMG) | none | keep | COMPLETE | — | — |
| CT02 | Categories layout / columns / tile / ratio | Hard-coded columns (2/3/4/6 or compact 3/4/6/8) | `CategoriesSection.tsx:154-157` | card layout | — | none | `layout: grid∣rail`, `shape: square∣circle`, `columns` preset | MISSING | P2 | C01 |
| CT03 | Category image authoring from Customizer | Authored in ERP product-categories only; Customizer cannot link there | `ProductCategoryController` | — | category edit → image (DAF-CIMG) | context switch | Deep-link "edit category image" from the categories inspector | MISSING | P3 | — |
| PS01 | Product-section data sources | featured picker (≤8), offers (≤8), shelf (collection/facet), newArrivals | H4 closure | Featured Products rules (SAL-HOME) | — | none | keep | COMPLETE | — | — |
| PS02 | Grid vs rail, count, columns | code-fixed (2/3/4) | see S04 | Moving vs Fixed products | — | — | = S04 | PARTIAL | P2 | — |
| PS03 | Title override on featured / newArrivals / offers | fixed i18n (Canvas vs Published copy differs slightly for Featured) | H4 closure §10 | main title per element | — | — | = C02 | MISSING | P2 | — |
| PS04 | New-Arrivals sorting / source | newest only | `NewArrivalsSection.tsx` | rules per Featured Products | — | — | keep newest; any new sort must be a Commerce-backed enum | PRODUCT_DECISION_REQUIRED | P3 | O14 |
| PS05 | Empty-data behaviour | Omitted, never faked | H4-8 §12 | — | — | none | keep | COMPLETE | — | — |
| PS06 | Pricing / offers truth | Live via `CommercePriceResolver`; no stored discount | H4-6/7 | — | — | none | **Never** let design controls touch price/discount | COMPLETE | — | guard |
| PC01 | Card style | standard / compact | `public-rhythm.ts` | — | — | — | = G11 | PARTIAL | P2 | — |
| PC02 | Image ratio / fit / title lines | fixed (`line-clamp-2`, `object-cover`) | `ProductCard.tsx` | image cover vs full (SAL-DESIGN) | — | none | presets only | MISSING | P2 | G11 |
| PC03 | Price hierarchy, compare-at, badges, stock | Commerce-authoritative, not configurable | `ProductCard.tsx`, offers | — | — | commerce truth | **Do not expose**; only typography weight presets if ever | PRODUCT_DECISION_REQUIRED | P3 | O14 |
| PC04 | Quick view / favourite toggles | components exist but wishlist persistence is not established (Header comment says wishlist has none) | `Header.tsx` doc, `WishlistButton.tsx` | — | — | exposing a toggle may promise a non-real feature | Do not add toggles until each is real end-to-end | INTENTIONALLY_DEFERRED | — | — |
| PC05 | Hover & reduced motion | `motion-reduce:` variants present | `ProductCard.tsx:108` | — | — | none | keep | COMPLETE | — | — |
| PP01 | Product-page regions (9) visibility/order | LIVE, fixed-required rules enforced server-side | `page-regions.ts` | PDP elements (Twilight) | — | none | keep | COMPLETE | — | — |
| PP02 | Product-page layout variants | one | — | — | — | — | 2 gallery placements if evidence demands | MISSING | P3 | — |
| PP03 | Gallery presentation (thumbs, ratio, zoom) | gallery + lightbox exist; not configurable | `MediaGallery.tsx`, `MediaLightbox.tsx` | **image zoom toggle** (SAL-DESIGN); multi-image, ✔ main (DAF-PIMG) | — | no merchant control | optional `zoom: on∣off` | PARTIAL | P3 | — |
| PP04 | Related products | none | — | — | — | needs data authority | Only when Commerce supplies a related-products source | INTENTIONALLY_DEFERRED | — | — |
| CP01 | Category-page regions (6) | LIVE | `page-regions.ts` | — | — | none | keep | COMPLETE | — | — |
| CP02 | Category cover / image on category page | **Not rendered**, though `store/v1/categories` now exposes `image {url, alt}` (#1110). `CategoryBanner.tsx` comment still says "category resource exposes no image" | `CategoryBanner.tsx:34-44` vs `AWJ-STOREFRONT-CATEGORY-MEDIA-IMPLEMENTATION-REPORT.md` | — | category image appears on **category page** too (DAF-CIMG) | Stale decision; data exists | Add optional `cover` region (visible only when category has image) | MISSING | P1 | DEF-3 |
| CP03 | Category grid columns / card treatment | fixed | `ProductListing` | — | — | — | = PC02/S04 presets | MISSING | P2 | — |
| CP04 | Filter layout | fixed | — | — | — | — | defer | INTENTIONALLY_DEFERRED | — | — |

### 7.K Content, app promo, benefits

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| CC01 | Custom Content blocks | heading (120) + paragraph (600), ≤8, no HTML | `SC normalizeCustom` | FAQ, Features Grid, Blog | content-page designer (DAF-CP) | text-only | keep closed model | PARTIAL | P1 | CC02 |
| CC02 | Block types: image, button, divider | none | — | Promotion, Card Gallery | drag-and-drop elements (DAF-CP; palette not enumerated) | no image/button | add `image`, `button`, `divider` (+ `spacer` only if proven); **no columns** in first cut | MISSING | P1 | M01 |
| CC03 | Content pages (About, FAQ, …) authoring | 7 fixed slugs with title + enable only; panel itself shows **"GATED"** badge; Published does not consume `pages` | `CP PagesPanel`, `capabilities.ts INFORMATIONAL_PAGES_CAPABILITY="gated"`, `layout.tsx` (no `pages`) | pages exist (Twilight "informational pages") | **create page by name → drag-drop design** (DAF-CP) | Panel is honest but authoring has no backend | Separate backend decision (page document + `store/v1/pages/{slug}`) — **outside CUST-HV**, schedule as CUST-H7-class | BACKEND_GATED | P2 | O15 |
| CC04 | Arbitrary HTML/JS/CSS | forbidden | Roadmap §4, H6 | custom CSS / code supported | Daftra homepage = "programming knowledge" | — | never in this Horizon | INTENTIONALLY_DEFERRED | — | — |
| AP01 | App promo content | name + validated App Store/Play URLs | `CFG apps`, `urls.ts` | store application links | — | none | keep | COMPLETE | — | — |
| AP02 | App promo design | one layout, fixed colours | `AppPromoBand.tsx` | — | — | no background/mockup | tone + optional image via M01 (P3) | MISSING | P3 | M01 |
| BN01 | Benefits content | title (80) + body (200), ≤6 | `SC` | Store Highlights ≤3, Features Grid | — | none | keep | COMPLETE | — | — |
| BN02 | Benefits icons | none (H4 deferred icon system) | `BenefitsBand.tsx` | icons + colours (Statistics, Card Gallery, Quick Links) | — | text-only | **Reassessed:** ship a *closed curated icon set* (~24 keys, lucide subset, stored as key string) — no upload, no SVG | MISSING | P2 | O16 |
| BN03 | Benefits layout (columns/alignment/card vs flat) | one | — | Features Grid: layout, content & text alignment | — | — | `columns: 2∣3∣4`, `style: flat∣card` | MISSING | P2 | C01 |

### 7.L Theme gallery, Section Library, direct manipulation, inspector, actions

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| TG01 | Theme gallery | `/commerce/themes`: 3 runtime-backed themes (awj-modern, awj-market, awj-bloom) as wireframe cards | `theme-registry.ts`, `themes/page.tsx` | Theme Store: cards with rating/activity; Try · Buy · Preview (SAL-THEMES) | Templates list (DAF-TPL) | 3 themes; wireframe thumbnails | Add real previews (below); ≤6 themes total near-term | PARTIAL | P2 | TG02 |
| TG02 | Preview with merchant data, Desktop/Mobile | "Preview" opens the **live store URL** — it does **not** show the theme (misleading, DEF-4) | `themes/page.tsx:205-218` | "Preview your store with a theme" (SAL-THEMES) | **View Demo** before Apply (DAF-TPL) | No true preview | Preview = open the theme as an **unsaved draft in the Canvas** (read-only, merchant data), Desktop/Mobile toggle | MISSING | P1 | none |
| TG03 | Apply creates new Draft Version | Yes; named "<theme> — Theme Gallery"; rolls back version on failure; routes to appearance | `themes/page.tsx handleUseTheme` | duplicate then customise (SAL-THEMES) | — | none | keep | COMPLETE | — | — |
| TG04 | Apply confirmation / "what will change" | Immediate on click; no summary | `themes/page.tsx:56-110` | — | **Apply → OK confirm** (DAF-TPL) | Safe (new version) but opaque | One-line summary dialog: "creates a draft version; changes: colour, density, header, card; keeps: content, logos, links" | MISSING | P1 | — |
| TG05 | Reset / restore defaults | none (global or per-section) | — | — | "reset … elements within default pages" (DAF-TPLEDIT) | — | Per-section "Reset to defaults" + "Reset design" | MISSING | P2 | C01 |
| TG06 | Safe rollback | Versions: switch back; live version not deletable | H1 | cannot delete active version (SAL-THEMES) | — | none | keep | COMPLETE | — | — |
| TG07 | Vertical presets / compatibility | Flowers pack adds backed sections only | `flowers-pack.ts`, ADR-26 | industry browse (SAL-THEMES) | — | one vertical | Add `retail`/`services` packs only with real backing | PARTIAL | P3 | — |
| SL01 | Library search + 7 categories + state badges | Yes | `SectionLibrary.tsx`, `CAP` | element picker | — | none | keep | COMPLETE | — | — |
| SL02 | Thumbnails / live previews | text cards only | `SectionLibrary.tsx` | element list (no thumbnails evidenced) | — | — | static schematic thumbnails per type | MISSING | P2 | — |
| SL03 | Singleton/max + disabled reason | "already added" | H4-8 §8 | — | — | none | keep | COMPLETE | — | — |
| SL04 | Mobile sheet | in-place replace of sheet body | `ControlPanels.tsx` | — | — | none | keep | COMPLETE | — | — |
| SL05 | Keyboard operation | labelled controls; full keyboard model (roving focus in list) not evidenced | tests | — | — | unverified | verify in a11y slice | PARTIAL | P2 | — |
| SL06 | Recommended / recent | none | — | suggested themes | — | no usage data | do not build | INTENTIONALLY_DEFERRED | — | — |
| DM01 | Canvas click → inspector | sections, header, footer, branding, WhatsApp, social, product & category regions | `CAN:387-470,1190-1240` | click Edit on any section (SAL-EDIT) | — | none | keep | COMPLETE | — | — |
| DM02 | Hover affordance + inline action bar | selection outline only; actions live in side list | `CAN awj-preview-section` | **hover label + action bar: Edit/Hide/Move/Duplicate/Add/Delete** (SAL-EDIT) | — | slower path for common actions | Lightweight floating bar on selected section (move ↑↓, duplicate, hide, delete) — keyboard reachable | MISSING | P2 | EA03 |
| DM03 | No accidental public navigation | `preventDefault` on header/footer/link clicks in many branches | `CAN:1082,1091,1359,1381,1407,1416,1467` | — | — | exhaustive proof not obtained | add a Canvas-wide click guard test | PARTIAL | P2 | — |
| DM04 | Focus, scroll-to-selection, mobile select | specified (UX V2 §5, H4-ARCH-1 §25), exercised in H4-8 | QA §11 | — | — | none | keep | COMPLETE | — | — |
| IN01 | Inspector IA | **Single flat panel**: visibility toggle + content fields; no Content/Design split | `CP HomepagePanel` | grouped option tabs per version | — | nowhere to place design controls | §22 IA: Content · Design (progressive); Layout/Advanced only where populated | MISSING | **P1** | C01 |
| EA01 | Add / select / duplicate / hide | Yes, capability-aware | `CP HomepagePanel`, `CAP` | same set | — | none | keep | COMPLETE | — | — |
| EA02 | Reorder (keyboard/touch) | Up/Down buttons | `CP` | drag handle | up/down **and** drag (DAF-ORD) | fine | keep as the accessible path | COMPLETE | — | — |
| EA03 | Reorder by drag-and-drop | none | — | drag handle (SAL-HOME) | drag (DAF-ORD) | — | add drag on top of buttons (dnd-kit keyboard sensor) | MISSING | P2 | — |
| EA04 | Delete confirmation | `deleteSection` removes immediately, no confirm | `CP:deleteSection` | **confirmation before delete** (SAL-HOME) | — | easy accidental loss (recoverable only via versions) | confirm *only* when the section has authored content; otherwise undo-toast is H5 | PARTIAL | P2 | H5 |
| EA05 | Reset section to defaults | none | — | — | reset default pages (DAF-TPLEDIT) | — | see TG05 | MISSING | P2 | — |
| EA06 | Undo / redo | none | Roadmap CUST-H5 | not documented | — | owned by H5 | do not pull into CUST-HV | INTENTIONALLY_DEFERRED | — | H5 |

### 7.M Cross-cutting

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Desktop / Tablet / Mobile = one document | Yes; viewport resolved in JS (`viewport` prop) in Canvas vs CSS breakpoints in Published | `CAN:256-335` | works on mobile (SAL-EDIT) | — | drift risk (§27) | keep model; add per-breakpoint snapshot tests | COMPLETE | — | — |
| R02 | Section-editing surface at 768 px | **None** — Canvas only (pre-existing) | H4-8 §10 | — | — | tablet merchants cannot edit | give 768 the bottom-sheet or side-drawer inspector | MISSING | P1 | — |
| R03 | Builder header overflow when draft dirty at 768/1024 | reproduced on pre-H4-7 baseline (39 px) | H4-8 §10 | — | — | pre-existing | fix in cleanup slice | PARTIAL | P2 | — |
| RT01 | RTL/LTR builder & storefront | verified AR/EN at 6 widths in H4-8 | QA report | — | — | none | keep | COMPLETE | — | — |
| RT02 | RTL for new carousel/ticker/drag | no such components yet | — | — | — | each new motion/drag control needs RTL spec | spec in §24 | MISSING | P1 | S01, N03, EA03 |
| A01 | Reduced motion | global CSS rule + `motion-reduce:` on cards | `globals.css:66,259` | — | — | no autoplay features exist yet | mandatory for S01/N03 | PARTIAL | P1 | — |
| A02 | Assistive-technology pass | **never performed** (QA sandbox had no AT) | H4 closure §13 | — | — | unknown real-world SR behaviour | include NVDA/VoiceOver pass in DoD | MISSING | P1 | — |
| ST01 | Save/conflict/stale/lifecycle states | draft/saved/conflict banners, version conflict reload | `EB versionConflict`, H1 | — | — | none | keep | COMPLETE | — | — |
| PA01 | Preview ↔ Published parity architecture | 3 normalisers + 2 renderer sets + mirror; parity by duplication + fixtures | §4.1; `tests/Fixtures/presentation/*` | — | — | every new field = 3+ edits, drift risk | single JSON-Schema/fixtures source + generated types + one parity harness (§27) | PARTIAL | **P1** | — |
| PF01 | Config size / dirty-check cost | `presentationConfigsEqual` = `JSON.stringify` ×2 every render; doc may embed ≤1.5 MiB of Base64 | `config.ts:605`, `EB:359` | — | — | wasteful; disappears when M10 lands | migrate logos; shallow/hash compare | PARTIAL | P2 | M10 |
| PF02 | LCP / CLS for image sections | banner `<img>` has no width/height or lazy/priority policy; proxy images unoptimised | `BannerBand.tsx`, `product-image.tsx` | — | — | regress risk | explicit dims + `priority` on first hero only | PARTIAL | P1 | M07 |

---
## 8. Media audit

**[AWJ-Existing]** AWJ has three unrelated media mechanisms (`CUST-H4-ARCH-1 §24`): (1) tenant-scoped, R2-capable `ProductMedia`/category media — the only real object store; (2) Base64 logos inside the presentation JSON; (3) pasted https URLs for banner. The Customizer uses only (2) and (3).

**[AWJ-Proposal] — extend pattern (1); do not create a second platform.** Everything below reuses `R2StorageService` (domain string only), the `ProductMedia` upload rules, the H4-8b signed-workspace-route pattern and `StorefrontMediaController`'s indistinguishable-404 pattern.

### 8.1 Reuse map

| Need | Reuse | New |
|---|---|---|
| Bytes in R2, tenant prefix from `TenantContext` only | `R2StorageService::put/get/delete` with a new **domain** `storefront-media` (key `tenant/{tid}/storefront-media/{media_id}/{uuid}.{ext}` already satisfies the safe-segment regex) | none |
| Upload validation | `StoreProductMediaRequest` rules (5 MB, `jpg,jpeg,png,webp`) | decoded-dimension + pixel-cap checks; reject SVG/GIF/animated |
| Draft preview in Canvas | H4-8b signed workspace route (`temporarySignedRoute`, fresh tenant/channel re-check) | route variant for customizer media |
| Public delivery | `StorefrontMediaController` host-resolved pattern, 404 indistinguishable | **published-reference check** (below) |
| RBAC | `commerce.manage` (as every presentation route) | none |
| Streaming | `ServesProductMediaBytes` trait | none |

### 8.2 Minimum contract (sketch — not an authorisation)

- **Row** `storefront_media`: `id, tenant_id, original_name, mime, size, width, height, sha256, alt_ar, alt_en, disk='r2' (only), path, created_by, timestamps`. Tenant-level (not per-storefront) so one library serves all storefronts of a tenant; classify per the branch-isolation guard (`CompanyWide`).
- **API** (workspace, `commerce.manage`): `POST` multi-upload · `GET` list (search, 24/page, thumbnail URLs) · `PATCH` name/alt · `DELETE` → **409 with usage list** when referenced by draft, any version, or published · `GET {id}/usage`.
- **Reference in presentation JSON:** `{ mediaId, fit?, focal?, alt? }` — an opaque UUID, never a URL. Normalisers keep the id by shape; **publish** (server) verifies every `mediaId` exists in the same tenant and **rejects or strips** dangling ids. Draft save stays tolerant.
- **Public read must be reference-gated:** the host-resolved route serves a media id **only if the resolved storefront's *published* config references it**, else uniform 404. Otherwise an uploaded-but-unpublished campaign image would be world-readable by guessing ids. Cost: maintain a small denormalised "published media ids" set at publish time (not a per-request JSON scan).
- **Legacy:** existing https `imageUrl` and Base64 logos keep rendering (no rewrite of stored documents). UI offers the picker; "external URL" becomes an Advanced fallback until Owner retires it (O1).
- **R2-only:** no `document`-disk fallback for this domain; if R2 is not configured the picker shows a *capability-gated* state (M12), never a silent ephemeral write.
- **Deletion safety:** block-with-usage (preferred over Salla's "delete everywhere, substitute default") because AWJ has versions and scheduled publication: a silent substitution would alter a *scheduled* future version.

### 8.3 Merchant UX (modelled on **[Salla]** SAL-MEDIA + **[Daftra]** DAF-GALADD, simplified)

`MediaPicker` (shared; sheet on mobile, popover/dialog on desktop): tabs **Upload** (drag-drop + file button, multi-file, per-file progress and error) · **Library** (grid, search by name, newest first, "unused" filter). Selected media shows: thumbnail, name, dimensions, **alt AR/EN**, Replace, Remove, "Used in N places". After selecting, the owning inspector shows fit + focal point.
Folders, bulk move, assign-to-product (Salla) are **not** needed; products already own their media.

### 8.4 Audit answers (required checklist)

| Item | State |
|---|---|
| upload · drag-drop · choose existing · reuse · replace · remove | all MISSING for Customizer (M01-M03) |
| safe deletion / usage awareness | MISSING (M04) |
| alt text | PARTIAL, banner only (M05) |
| file / MIME / size / dimensions | PARTIAL (M06) |
| optimisation / thumbnails | MISSING (M07) |
| public delivery / caching | PARTIAL (M08) |
| Tenant Isolation / RBAC | proven for products; contract missing for customizer (M09) |
| empty/loading/error | MISSING (M11) |

---

## 9. Global design audit

**Global (stay global):** primary colour, font preset, density, radius, product-card style, container width, button style. **Overridable per section (bounded):** surface tone, spacing preset, alignment, width (contained/full), heading visibility/title, layout variant. **Never overridable per section:** font, radius, primary colour, any pricing/commerce display.

| Area | Today | Gap | Direction |
|---|---|---|---|
| Colour system | primary only (+ dead accent) | no surfaces/tints | named tone tokens (§30), auto foreground, contrast guard |
| Typography | 2 Arabic faces | few choices, no upload | curated faces (G05); upload after media (G07) |
| Density / radius / card | 2 / 3 / 2 | fine | card gets fit/ratio presets |
| Dark/light | none | Owner call | inverse tones for header/footer/banner cover 90 % of the need |
| Contrast | warn on primary only | multiplies with new colour controls | enforce centrally (G14) |
| Accessibility | contrast hint only | no focus-ring/motion theming | tokens already expose `--ring` |

**Dead field:** `accentColor` (G03). Do not add a control for it until Owner picks wire-or-remove (O6).

---

## 10. Header audit

[AWJ-Existing] `standard`/`compact`, show/hide search/account/cart/category-nav, logo + compact logo, ≤12 custom links, always-sticky, 54 px mobile grid. [Salla] sticky toggle, transparent header, dark bars, per-version menu assignment (SAL-DESIGN, SAL-THEME-PAGES, SAL-MENU). [Daftra] nothing on header visuals.

Gaps: logo size (HD03), colours/transparency (HD04), sticky choice (HD07), mobile parity of links (NV03/HD08), Canvas fixtures (HD09). **Do not fake:** a "transparent header" control is only honest when a hero image can sit beneath it (needs H03) — ship together or not at all.

## 11. Navigation audit

[AWJ-Existing] flat list, five link kinds, raw `href` entry, up/down reorder, https-only externals, 12-link cap. [Salla] menus with title/type/target/icon, drag-drop, per-theme-version assignment. [Daftra] item types Category / Link / Home / Product / Contact / Content Page; **up/down + drag**; **submenus ≤2 levels** via drag or a "↴" button.

[AWJ-Proposal] (1) **pickers** for category/product/content (NV02) — highest-value, lowest-risk; (2) **fix mobile** (NV03); (3) one nesting level (children) only if Owner approves (O12), using a "make child" button as the keyboard path (Daftra's own pattern); (4) drag on top of buttons (NV05). Deep-link kinds stay a closed set; no free-form internal paths.

---

## 12. Announcement bar audit — full decision

**Decision: BUILD** as a *global chrome region*, not a homepage section (it must appear above the header on selected pages and belong to the design version).

[Salla] SAL-PROMO fields: title, text, icon, link, expiry, pages, theme version, background colour, text colour, moving-text toggle; enable/disable, edit, delete; multiple announcements. SAL-ADV adds nothing on ticker/dismiss (undocumented).

| Aspect | AWJ Proposal | Why differs / same |
|---|---|---|
| Model | `announcements[]` in the presentation document, **max 3**, each `{ id, text ≤120, icon? (curated key), href? (safe), tone (token), startsAt?, endsAt?, pages[home\|product\|category\|all], motion static\|marquee }` + `enabled` | Same field set as Salla minus separate "title" (one line is enough); *adds start date* (Salla only has expiry) — needed for "Ramadan → Eid" sequences. Version scoping is automatic (lives in the document) so no "choose theme version" field. |
| Multiple items | Show the **first eligible** (enabled, within dates, matches page) — multiple items exist for *sequencing/scheduling*, not rotation | Avoids auto-rotating carousels (motion, a11y). Rotation only if Owner opts in (O5). |
| Colours | tone tokens (brand / inverse / soft / neutral) with auto foreground and contrast gate | Not free hex; keeps contrast safe |
| Moving text | Off by default; if on: CSS marquee, **pauses on hover/focus**, **static under `prefers-reduced-motion`**, direction follows `dir`; text always available to AT | [Salla] offers it; AWJ constrains it |
| Expiry / schedule | `endsAt`/`startsAt` evaluated against server time at render; whole-version scheduling (H1) remains the macro tool | **U5:** published config is cached (`cacheLife` minutes) — bound expiry error to cache TTL, document it |
| Page targeting | home / product / category / all; **never checkout/cart/account** | Protect conversion-critical flows |
| Placement | Strip **above** the header, **not sticky**; header stays sticky | Avoids stacked sticky bars on mobile |
| Dismiss | Not dismissible by default; if Owner allows, per-visitor `localStorage` flag only (no server state) | |
| Link | same safe-href rules as banner CTA | |
| Mobile | wraps to ≤2 lines then ellipsis; link target ≥44 px | |
| A11y | landmark `region` with label; **not** `role="alert"`; real link text; focus-visible; no colour-only meaning | |
| Preview parity | Canvas renders the same component; editor-only chip "scheduled"/"expired"; Published omits ineligible | per §27 |
| Backend | Normalisers ×3 + fixtures; **no table, no migration** | |

Row IDs: N01-N05. Priority P1. Independent of media → can ship **early** (slice V3).

---

## 13. Homepage / sections audit

All 13 section types are LIVE with typed content (H4). None has design. The proposed **bounded Common Design Contract (C01)** is not "every field on every section":

| Field | hero | banner | slider | gallery | categories | product sections | benefits | customContent | appPromo | wholesale |
|---|---|---|---|---|---|---|---|---|---|---|
| `tone` (surface token) | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| `width` contained∣full | ✔ | ✔ | ✔ | – | – | – | – | – | – | – |
| `spacing` compact∣default∣relaxed | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| `align` start∣center | ✔ | ✔ | – | – | – | – | ✔ | ✔ | – | – |
| `height` preset | ✔ | ✔ | ✔ | – | – | – | – | – | – | – |
| `layout` variant | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | – | – | – |
| `showTitle` / `title` | – | – | – | ✔ | ✔ | ✔ | ✔ | – | – | – |
| `radius`, `border` | **no** (global) | | | | | | | | | |

Rule: each type declares its own allowed subset in `SECTION_CAPABILITIES` (typed capability), normalisers drop anything else. This keeps H4's "typed content" discipline and prevents a universal style bag.

## 14. Hero / Banner audit

Hero today is a gradient band with global headline/sub and a fixed CTA. Banner is a card with a 224 px side image. **Target**:

| | Hero | Banner |
|---|---|---|
| Content | headline, sub, **CTA label + href** | title, sub, CTA (exists), alt (exists) |
| Media | `background: gradient∣solid∣image` | image (media) |
| Design | overlay (none/dark/light/brand × 3), align, height (compact/standard/tall), width (contained/full) | tone, overlay, align, imagePosition, height/ratio, width |
| Variants | text-over-image · split | card · full-bleed · text-band |
| Mobile | one document; stacked; focal point honoured | same |

Hero comment in `HeroSection.tsx` ("anything put there would be storefront invention") remains correct for *auto-generated* imagery; merchant-supplied imagery is not invention. Hero content must become per-instance (H01/O10) so a second hero/banner-like instance and version diffs behave.

## 15. Carousel / gallery audit

**Slider: YES.** One `slider` section (S01) — evidence: Salla ships three slider flavours (SAL-HOME, SAL-ESL) and it is the dominant homepage pattern. 2-6 slides, each `{ media, title?, subtitle?, link?/CTA? }`, add/remove/duplicate/reorder (up/down + drag), height preset, **no autoplay by default** (O4), arrows + dots, swipe, RTL-correct, reduced-motion aware, first slide eager/rest lazy. Reuse Swiper (already a dependency; add `dir` handling and verify, U6).
**Gallery: YES, later (S03):** 2-12 images, 2/3/4-column grid, optional captions. **No masonry, no lightbox** (S05). Salla's video/YouTube elements are out (CSP/privacy).

## 16. Product sections / cards audit

Data and truth are complete (PS01, PS05, PS06). Presentation is code-fixed. Add only **presets**: `layout grid∣rail`, `columns 2∣3∣4`, `imageRatio`, `imageFit`, `showTitle/title`. **Commerce truth firewall:** no design control may read, store or alter price, compare-at, discount, stock or offer status; badge/price hierarchy options are not exposed (PC03). Quick view/favourite toggles stay unexposed until each is real (PC04).

## 17. Product page audit

Regions (9) with server-enforced fixed-required rules are complete (PP01). Gaps are presentation-only: optional `zoom` (PP03) and, if evidence appears, a second gallery placement (PP02). Related products stay deferred until Commerce provides a source (PP04). Variants/quantity/CTA remain FIXED_REQUIRED.

## 18. Category page audit

Regions (6) complete (CP01). **Highest-value fix:** render the category **cover** (CP02) — the data exists since #1110 and the Home categories section already uses it (image → verified colour → neutral), while `CategoryBanner.tsx` still documents "no image" and renders none. Add as an *optional region* shown only when the category has an image (never a placeholder). Grid columns/card treatment reuse the same presets as product sections (CP03).

## 19. Content pages / block editor audit

Two distinct things:
1. **Custom Content section** (homepage): heading + paragraph only. [AWJ-Proposal] add `image` (needs M01), `button` (safe href, same rules as CTA), `divider`; `spacer` only if a concrete need appears; **no columns** in the first cut (columns multiply responsive states). Max blocks stay bounded (≤12). No HTML/JS/CSS.
2. **Content pages** (About/FAQ/…): the Pages panel is honestly marked **GATED** and Published ignores `pages`; there is no page-body backend. [Daftra] DAF-CP shows the merchant mental model (**create by name → drag-drop blocks → save**). This is a **separate backend + product decision** (document model, public route, SEO) — recommend a later horizon reusing the *same block set* defined in (1) so the block editor is built once (CC03, O15).

---

## 20. Footer audit

Content and trust identity are complete (F01, F07). Design is fixed. **Content vs styling split:** content = tagline, copyright, contact, social, apps, identity (global, unchanged); styling = `tone` (default/brand/inverse), `layout` (compact/expanded), and **navigation groups** (≤4 × ≤6 links reusing nav kinds) — F02-F04. Backgrounds images, dividers, spacing knobs: not built (F05). SBC/CR/VAT marks stay official, non-editable presentation.

## 21. Theme gallery audit

[AWJ-Existing] `/commerce/themes`: three runtime-backed cards; **Apply creates a new Draft Version, applies preset (+ Flowers sections when category is floral), rolls the version back on failure, opens it in the editor** — this is already safer than Daftra's destructive "Apply". Gaps: (1) "Preview" opens the *live store* (DEF-4); (2) no summary before apply; (3) wireframe thumbnails; (4) no reset.
[AWJ-Proposal] **View Demo → Apply** à la Daftra, but non-destructive: *Preview* = the theme rendered over **the merchant's own data** inside the Canvas (unsaved, read-only, Desktop/Mobile); *Apply* shows a one-line summary ("creates a new draft version · changes colour, density, header, cards · keeps your content, logos, links") then proceeds as today. Cap catalogue at ~6 themes; add presets only as bundles (G01).

## 22. Inspector / Section Library UX audit

**Recommended inspector IA (progressive, no empty tabs):**

| Section kind | Layout of inspector |
|---|---|
| Simple (wholesale, deliveryPromise, appPromo) | one compact panel: visibility → content |
| Rich (hero, banner, slider, gallery, benefits, customContent, product sections) | **Content** (what it says/shows) · **Design** (tone, align, height, width, spacing, variant) — Design groups open collapsed except *Variant* and *Tone* |
| Advanced | only when a real advanced field exists (e.g. external image URL fallback, section label); otherwise absent |

"Layout" is folded into Design (variant, width, columns) — a fourth tab would be mostly empty. This deliberately deviates from Roadmap §3.3/H4 "always Content/Design/Layout/Advanced" — **[Owner-Decision O17]**; evidence: the current flat panel has no design fields, and the brief forbids empty tabs.

**Section Library:** search + 7 categories + honest states are complete (SL01, SL03, SL04). Add static schematic thumbnails (SL02) and verify keyboard model (SL05). Do not add recommended/recent (SL06).

---

## 23. Desktop / Tablet / Mobile audit

Evidence: **prior** real-browser QA only (H4-8 rerun, AR/EN); **this pass ran no browser.**

| Width | Merchant UI evidence | Storefront evidence | Open items |
|---|---|---|---|
| 390 / 430 | preview-first, Bottom Sheet, no overflow (H4-8 §10) | no overflow | Header custom links absent (NV03); long AR/EN covered by `customizer-visual-verification/*` screenshots (not re-inspected here) |
| 768 | **Canvas only, no section-editing surface (R02)** | no overflow | tablet merchants cannot edit sections |
| 1024 | builder header overflows when dirty (39 px, pre-existing, R03) | ok | fix |
| 1280 / 1440 | ok | ok | — |
| Canvas scaling | viewport simulated in JS (`viewport` prop), not CSS | CSS breakpoints | drift risk (PA-2) |

**Rule kept:** one design document; no per-device overrides (I05).

## 24. RTL / LTR audit

Builder and storefront verified AR+EN at six widths (H4-8). New work must specify: logical properties only (`ms/me/ps/pe`, `start/end`); arrows/chevrons mirrored (`rtl:rotate-180` pattern exists); slider swipe & arrow semantics follow `dir`; marquee direction follows `dir`; drag-drop with keyboard parity (up/down buttons stay); alignment control labels are **start/center** (not left/center), icons logical; announcement and hero text positions flip. Swiper RTL behaviour in `ProductCarousel` is unverified (U6).

## 25. Accessibility audit

| Requirement | State |
|---|---|
| Keyboard operation / focus / focus return | verified for Offers CRUD (H4-8 §11); not for whole builder |
| Accessible names, labelled upload inputs | present for logos (H3-1) |
| Contrast | primary only; centralise (G14) |
| Alt text | partial (M05) |
| Motion preferences | CSS rule exists; required for slider/ticker |
| Carousel/announcement a11y | not yet applicable → specified in §12/§15 |
| Drag-drop fallback | up/down buttons already exist; keep |
| Touch targets | ≥40 px verified in H4-7; keep 44 px for new |
| Error announcements | not evidenced — add `aria-live` for upload errors |
| Colour-only meaning | verified (text states) in H4-8 |
| Screen-reader pass | **never done** (A02) |

## 26. State / error UX audit

| Surface | loading | empty | uploading | success | error | validation | network | stale/conflict | unsupported | permission | gated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Version save/publish | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ (H1) | – | ✔ | – |
| Product/offer pickers | ✔ | ✔ | – | ✔ | ✔ (retry) | ✔ | ✔ | – | – | – | – |
| **Media picker (new)** | spec | spec | **spec** | spec | **spec** | **spec** (type/size/dims) | spec | spec (media deleted elsewhere) | **spec** (R2 not configured) | spec | **spec** |
| Theme preview/apply | spec | – | – | ✔ | ✔ (apply failed) | – | ✔ | – | – | ✔ | ✔ (planned themes) |
| Announcement | – | spec ("no active announcement") | – | spec | spec | spec | – | spec (expired/scheduled chip) | – | – | – |

"spec" = must be defined in the slice contract; none may fail silently.

---

## 27. Preview / Draft / Published parity audit

### 27.1 Structural parity risks

| # | Finding | Evidence |
|---|---|---|
| PA-1 | Contract implemented 3× (PHP, web TS, storefront TS) + renderers 2× + a third "mirror" renderer copy | §4.1; `storefront/src/components/customizer/*` |
| PA-2 | Canvas simulates breakpoints in JS; Published uses CSS | `CAN:256-335` |
| PA-3 | Canvas header rail and footer "Shop" use `PREVIEW_CATEGORIES` | H4 closure §16 |
| PA-4 | Canvas Latin digits vs Published Arabic-Indic digits | H4 closure §16 |
| PA-5 | Featured heading copy differs | H4 closure §16 |
| PA-6 | Canvas shows empty-state placeholders; Published omits empty sections (documented, intentional) | H4 closure §10 |
| PA-7 | Custom nav links visible in Canvas, hidden below `lg` and in MobileMenu on Published | DEF-1 |

**[AWJ-Proposal]** (a) one **golden-document fixture set** extended for every new field (already used by PHP + both TS suites); (b) one pure `resolveSectionDesign(design) → {className, dataAttrs}` per twin generated from a single source with a CI diff check; (c) a parity test that renders each section in Canvas and Published components under jsdom and compares `data-design-*` attributes + landmark structure; (d) every visual control ships with a **Canvas ↔ Draft ↔ Published** assertion in the slice (Roadmap §9). No Canvas-only styling.

### 27.2 Defect register (found during this pass; code-verified, not browser-verified)

| ID | Defect | Evidence | Severity | Suggested handling |
|---|---|---|---|---|
| DEF-1 | Custom header links never appear on mobile | `Header.tsx:171` (`hidden … lg:block`), `MobileMenu.tsx` has no link prop, `layout.tsx` passes `extraLinks` to Header only | High (merchant-visible, fake on mobile) | Quick fix slice (V1) |
| DEF-2 | `accentColor` persisted but unused | §7 G03 | Medium | O6 |
| DEF-3 | Category page ignores category image; stale comment | `CategoryBanner.tsx:34-44` | Medium | CP02 |
| DEF-4 | Theme gallery "Preview" opens the live store, not the theme | `themes/page.tsx:205-218` | Medium (misleading) | TG02 |
| DEF-5 | Three max-size logos exceed `MAX_DOCUMENT_BYTES` (1.5 MiB) → save rejected; Base64 copied into every version | `PN:34-36`, `StorefrontPresentationService.php:553` | Medium | M10 |
| DEF-6 | Section delete is immediate, no confirm even with authored content | `CP deleteSection` | Low | EA04 |
| DEF-7 | No section-editing surface at 768 px | H4-8 §10 | Medium | R02 |
| DEF-8 | Builder header overflow when dirty at 768/1024 | H4-8 §10 | Low | R03 |
| DEF-9 | `capabilities.ts` header comment says version history DEFERRED (stale since H1) | `capabilities.ts:9` | Low | doc cleanup |

---

## 28. Performance considerations

- **Document weight:** `JSON.stringify` ×2 per render for dirty-check with up to 1.5 MiB Base64 inside (`config.ts:605`, `EB:359`) — **not measured**, but structurally wasteful; resolved by M10.
- **Images:** product proxy images render `unoptimized` (`product-image.tsx`) because the proxy needs the visitor Host; banner is a raw `<img>` with no width/height/priority. Adding hero/slider imagery without variants would regress LCP/CLS and mobile bandwidth.
- **Budget (proposed):** hero/first slide ≤ 150 KB WebP at mobile width, `fetchPriority=high` on **one** LCP image per page only; all others lazy with explicit dimensions (CLS < 0.1); slider ≤ 6 slides, Swiper loaded dynamically; announcement is text-only (0 KB images).
- **Variant generation (O3, U4):** no resize library is referenced in `composer.json` (grep negative — confirm GD/Imagick on the Railway image). Alternatives: server variants at upload (preferred), edge resizing (Cloudflare Images — new infrastructure, Owner call), or serve originals with a hard 5 MB/dimension cap (not recommended for hero).
- **Canvas:** media list paginated (24), thumbnails not originals; picker state local to avoid whole-`ExperienceBuilder` rerenders (file is 3,365 lines); preview of selected-section changes must not re-mount sibling sections.
- **Publish path:** unchanged (no new tables except the media table and a published-media-id set).

---

## 29. Proposed AWJ UX Contract (end-to-end merchant workflow)

| Moment | Contract |
|---|---|
| **Open** | Standalone workspace (exists). Shows page selector, version name + state, Desktop/Tablet/Mobile, unsaved indicator. First paint = Canvas. |
| **Select** | Click any section/header/footer/announcement → outline + inspector opens; list stays in sync (exists). Hover shows a label chip; selected shows the compact action bar (DM02). Links never navigate. |
| **Edit content** | Instant Canvas update; text fields commit on blur/debounce; links validated inline with plain-language errors. |
| **Edit media** | Click image slot → MediaPicker (Upload ∣ Library). Drag-drop or choose; progress per file; on success auto-select; alt prompt (non-blocking hint); fit + focal control appear. Errors named (type/size/dimensions/offline). |
| **Edit design** | Inspector → **Design**: Tone, Alignment, Height/Variant first; spacing/width under "More". No hex fields unless Advanced. Contrast warnings inline. |
| **Add section** | "+" → Library (search/categories/thumbnail/description) → Add → new section appended **and selected**, Canvas scrolls to it (exists, add thumbnail). |
| **Reorder** | Up/Down buttons (keyboard + touch) **and** drag (desktop/touch long-press); Canvas follows. |
| **Duplicate / hide / delete** | Same menu on list row and on-canvas bar. Delete confirms only when the section has authored content. Undo toast arrives with H5. |
| **Preview** | Desktop/Tablet/Mobile switch (one document). Tablet has an inspector (R02). Page navigator for Home/Product/Category. |
| **Save** | Saves **draft of the selected version** only; never affects live. Conflict banner (exists). |
| **Publish** | Separate, explicit; shows what goes live; atomic; scheduling per H1. |
| **Theme apply** | View Demo → Apply (summary) → new draft version → opens in editor. |

---

## 30. Proposed capability boundaries

### 30.1 AWJ WILL build (bounded vocabulary)

`tone: default∣soft∣brand∣inverse∣muted` · `width: contained∣full` · `spacing: compact∣default∣relaxed` · `align: start∣center` · `height: compact∣standard∣tall` · `overlay: none∣dark∣light∣brand × subtle∣medium∣strong` · `fit: cover∣contain` · `focal: 3×3 grid` · `ratio: wide∣banner∣standard∣square` · `layout` variants per type · `columns: 2∣3∣4` · curated icon keys (~24) · announcement tone/pages/dates.

### 30.2 AWJ will NOT build (this Horizon)

Arbitrary hex/gradient per section · crop editor · separate mobile image/design · absolute positioning · custom CSS/JS/HTML · video/YouTube backgrounds or embeds · parallax/entrance animations · masonry/lightbox · countdown timers (Salla's *example copy* mentions one; it is not a documented feature) · per-section fonts/radius · reviews/blog/FAQ elements (no data source) · SVG uploads · auto-rotating hero by default · any control touching price/discount/stock · editor-label-driven rendering.

### 30.3 Hard invariants (unchanged)

Tenant isolation · host-resolved public runtime · Draft/Published separation · revision concurrency · fail-closed normalisation · backward compatibility (absent `design` ⇒ today's rendering byte-for-byte) · no fabricated commerce data · safe URLs · RBAC `commerce.manage` · one responsive document.

---

## 31. Recommended Horizon structure

| Option | What | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. New Horizon before H5** — working name **CUST-HV "Visual Design & Media Completion"**, H5/H6 keep their names | one coherent capability; H5 snapshots a stable document shape; Restore has media-usage safety | delays Undo/Redo | **Recommended** |
| B. Extend H4 (H4-9…) | no renumbering | H4 is formally CLOSED; reopening contradicts Roadmap §17 and the closure verdict; scope (media, chrome, nav) isn't "Section Library & Quality" | Reject |
| C. Renumber (H5 = Visual, H6 = Undo, H7 = Extensibility) | clean sequence | rewrites docs/PR references; Roadmap forbids automatic renaming | Same sequencing as A, more churn — Owner may choose |
| D. Do H5 first, Visual after | Undo ships sooner | H5 must be re-verified after every new field; Restore vs deleted media unresolved; history snapshots grow with Base64 logos | Not recommended |

Rationale for A in one line: **Undo/Redo and Restore are only cheap and safe once the document schema and media references stop changing.**

## 32. Recommended implementation slices (inside CUST-HV)

| Slice | Scope | Exit | Depends |
|---|---|---|---|
| **V0 — Decisions & contracts (docs)** | Answer O1-O17; ADR "Customizer media on R2"; Section Design Contract; Announcement contract; golden fixtures; **baseline six-width browser evidence run** of current Canvas/Published | Owner sign-off | — |
| **V1 — Defect quick-fix lane** | DEF-1 (mobile links), DEF-4 (honest Preview label/behaviour), DEF-9, (O6 outcome for accent), 768 inspector (R02) or its design | defects closed with tests | none — can start before V0 completes |
| **V2 — Customizer Media Foundation (backend)** | `storefront_media` + R2 domain, upload/list/patch/delete+usage, signed workspace read, reference-gated public read, publish-time validation, RBAC, tenant tests, R2-config gate | tenant-isolation suite + R2 mocked tests green | V0 (O1,O2,O3) |
| **V3 — Announcement bar** | contract ×3, Canvas + Published, scheduling, targeting, a11y, parity tests | parity + a11y checks | V0 (independent of V2) |
| **V4 — MediaPicker + Logos** | shared picker UI; logo/favicon migration path (read legacy, write refs) | states table §26 implemented | V2 |
| **V5 — Section Design Contract + Inspector IA** | `design?` typed per section, normalisers ×3, Content/Design inspector, tone/spacing/width/align | back-compat proof (absent design = unchanged) | V0 |
| **V6 — Hero & Banner v2** | hero content per-instance, CTA, image/background, overlay, variants; banner variants/height/ratio; focal/fit | Canvas↔Published parity per variant; LCP budget | V2, V4, V5 |
| **V7 — Header / Footer / Navigation** | nav pickers, children (if O12), drag, header tone/logo size, footer tone/layout/groups, Canvas fixture removal | parity + mobile nav | V5 |
| **V8 — Slider & Gallery** | `slider`, `gallery`, RTL/reduced-motion, perf budget | a11y + RTL checks | V2, V4, V5 |
| **V9 — Product/Category presentation** | card ratio/fit/columns presets; category cover region; benefits icons/columns; customContent image/button/divider | commerce-truth firewall tests | V5, V4 |
| **V10 — Theme gallery v2 & editing polish** | true preview, apply summary, reset, library thumbnails, hover action bar, drag reorder, delete-confirm rule | DoD run | V5-V9 |
| **V11 — Verification & closure** | 6 widths × AR/EN, long content, AT pass, parity harness, perf, closure report | Horizon DoD (§36) | all |

Each slice follows the Horizon lifecycle (evidence → UX contract → implementation → verification → pre-merge → **owner merge approval**).

---

## 33. Dependencies

```
V0 ─┬─► V2 (media) ─► V4 (picker) ─┬─► V6 (hero/banner) ─┐
    │                              ├─► V8 (slider/gallery)├─► V10 ─► V11
    ├─► V3 (announcement) ─────────┤                      │
    └─► V5 (design contract) ──────┴─► V7 (chrome/nav) ───┘
V1 (defects) — independent, can precede everything
```
External: R2 configured in Production (U1) · imaging capability (U4) · CSP position (U3) · Owner decisions (§35). H5 depends on V2/V5 being stable (Restore ↔ media references).

## 34. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Production R2 flag off ⇒ media on ephemeral disk | R2-only domain; gated state; U1 check before V2 merge |
| R2 | Public media enumerable before publish | reference-gated public route; uniform 404 |
| R3 | Deleting used media breaks scheduled/old versions | block-with-usage; publish-time validation |
| R4 | Parity drift ×3 normalisers | golden fixtures + generated resolver + parity test |
| R5 | LCP/CLS regression from images | variants, dimensions, single priority image, budgets |
| R6 | Scope creep toward Webflow | §30.2 as an enforceable list; typed capability per section |
| R7 | Contrast failures from new colour controls | token palette + central contrast gate |
| R8 | Motion/a11y harm from slider/marquee | defaults off, pause, reduced-motion |
| R9 | Backward compatibility | absent `design`/`announcements` ⇒ byte-identical output; fixtures from existing documents |
| R10 | Base64 → media migration touching live documents | lazy, read-compatible, no bulk rewrite (consistent with 2026-09-26 "do not rewrite existing documents") |
| R11 | Hotlinked https banner images (no CSP found) track visitors / break | retire external URL after migration (O1) |
| R12 | Cached published config vs expiry | document TTL bound (U5) |

---

## 35. Product decisions requiring Owner approval

| # | Decision | My recommendation |
|---|---|---|
| **O1** | Supersede `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED` for the Customizer (authorise R2-backed media for banner/hero/slider/gallery **and** logos; retire https-URL entry) | Yes — its premise (only ephemeral storage) no longer holds for R2 domains |
| **O2** | Approve media contract: tenant-level object, 5 MB, jpg/png/webp, `commerce.manage`, block-delete-with-usage, library size cap/plan limit | Yes |
| **O3** | Image variants: server-generated WebP vs edge resizing vs originals | Server variants |
| **O4** | Slider autoplay: none ∣ opt-in (≥5 s, pausable) | None by default, opt-in allowed |
| **O5** | Announcement: marquee allowed? dismissible? rotation of multiple? | Marquee opt-in; no dismiss; first-eligible only |
| **O6** | `accentColor`: wire to a token or remove | Remove from contract (no consumer) unless a design need exists |
| **O7** | Button-style option (solid/soft/outline) | Defer |
| **O8** | Merchant control of container width / dark mode | Defer; use tones |
| **O9** | Separate mobile image / focal | Defer (one document) |
| **O10** | Hero content becomes per-instance and hero becomes deletable | Yes |
| **O11** | Per-banner expiry | Defer; use version scheduling |
| **O12** | Navigation children (1 level) | Yes, 1 level |
| **O13** | Editor-only section label ("rename") | Yes (cheap, high clarity) |
| **O14** | Any new commerce-displaying option (sort, badges, price hierarchy) | No |
| **O15** | Content-page authoring as a separate backend horizon reusing the block set | Yes, later |
| **O16** | Approve curated icon set (~24) | Yes |
| **O17** | Inspector: Content/Design (progressive) instead of mandatory four tabs | Yes |
| **O18** | Horizon option A/B/C/D (§31) | A |
| **O19** | Run V1 defect lane immediately, independent of the Horizon | Yes |

## 36. Proposed Definition of Done (for CUST-HV)

- [ ] V0 decisions recorded; ADRs merged.
- [ ] Every visual control has Canvas ↔ saved Draft ↔ Published parity test; no Canvas-only styling.
- [ ] Backward compatibility: a pre-CUST-HV document renders byte-identically (golden fixtures).
- [ ] Tenant isolation tests for media (upload, read signed, read public, delete, usage, foreign ids, unpublished ids).
- [ ] R2-configured gate verified in Production **before** enabling uploads.
- [ ] Real-browser matrix **390, 430, 768, 1024, 1280, 1440 × AR/EN**, long Arabic & English, for editor and storefront; 768 has an inspector.
- [ ] Keyboard-only pass and **screen-reader pass (NVDA + VoiceOver)** recorded.
- [ ] Reduced-motion verified for slider/marquee; contrast gate verified for every colour control.
- [ ] LCP/CLS budgets met on Home with hero + slider on a throttled mobile profile.
- [ ] No fake capability: every visible control changes Published output; unsupported = gated state.
- [ ] Commerce firewall tests: no design field can alter price/discount/stock.
- [ ] Full test suites + build + CI green; implementation report with Base/Head SHA; owner merge approval; closure report.

## 37. Items intentionally deferred

Undo/Redo & Restore (H5) · custom CSS/JS, section SDK, theme packages (H6) · content-page authoring backend · custom font upload · dark storefront · crop editor · separate mobile images · per-banner expiry · related products · video/YouTube · masonry/lightbox · reviews/blog/FAQ elements · recommended/recent in Library · footer backgrounds/dividers · button/border/shadow styling.

## 38. Final recommendation

1. **Approve Option A** and start with **V0** (decisions + baseline visual evidence run) and **V1** (defect lane) in parallel.
2. **Build the media foundation (V2) by extending the existing R2/ProductMedia pattern** — do not add localStorage, Base64 or a second storage stack; resolve O1 explicitly because an older owner decision still says otherwise.
3. **Ship the Announcement bar early (V3)**: highest Salla gap, zero media dependency, no migration.
4. **Introduce the bounded Section Design Contract (V5) before any visual control** so every later feature lands on one vocabulary and one parity harness.
5. Hold **H5** until V2/V5 are merged and stable.

---

## 39. No-Miss check (second pass)

| Question | Answer |
|---|---|
| Every current Customizer panel inspected? | Yes — all 13 panel ids enumerated (`CUSTOMIZER_NAV_GROUPS`); Theme, Branding, Header, Homepage, Footer, Pages, Banner fields read in detail; Contact/WhatsApp/Social/Verification/Apps read at function level only |
| Every home section type on main? | Yes — 13 types from `ALL_HOME_SECTION_KEYS`; renderers read for hero, banner, categories, newArrivals, featured; others via contracts + H4 closure |
| Header and Footer? | Yes (published components + Canvas selection code) |
| Product and Category pages? | Regions/contracts and `CategoryBanner`/gallery inspected; PDP renderer not read line-by-line |
| Media? | Yes, services, models, controllers, requests, docs, flags |
| Theme presets / gallery? | Yes (`ThemePanel`, `themes/page.tsx`, registry, flowers pack) |
| Mobile? | From code + prior QA; **no new browser run** |
| RTL? | From code + prior QA |
| Accessibility? | From code + prior QA; no AT |
| Empty/loading/error? | Matrix §26 |
| Preview vs Published parity? | §27 |
| Save/Publish workflow? | Reviewed via H1 evidence + `EB` conflict code; not re-run |
| Salla / Daftra checked? | Yes — primary pages fetched; limits stated in §3.4 |
| Content vs Design vs Layout distinguished? | Yes (§13, §22, §30) |
| Controls AWJ should NOT build? | §30.2 |
| Avoided inventing backend/commerce authority? | Yes — media object is a *proposed* contract needing O1/O2; commerce firewall stated |

**Gaps in this pass:** no live browser, no AT, production flags unknown, Daftra block palette unknown, Salla undo/mobile specifics unknown (§3.4).

**Unknowns:** U1 Production values of `PRODUCT_MEDIA_R2_ENABLED` / `CATEGORY_MEDIA_R2_ENABLED` (render.yaml is stale vs Railway) · U2 Daftra drag-drop element palette · U3 CSP at the edge (none in `next.config.ts`/`proxy.ts`/`vercel.json`) · U4 GD/Imagick availability · U5 published-config cache vs time-based expiry · U6 Swiper RTL in `ProductCarousel` · U7 screen-reader behaviour · U8 hero Canvas↔Published visual equivalence not re-run.

---

## 40. Final execution report

| Item | Value |
|---|---|
| Reviewed | Customizer UI, presentation contract (PHP + 2 TS twins), published storefront renderers, media/storage stack, theme gallery, roadmap/H4 closure/QA reports |
| AWJ files/docs inspected | see §3.1 (≈60 files/docs) |
| External official docs inspected | Salla ≈17 pages (help centre + Twilight), Daftra 10 tutorials — §3.2/§3.3 |
| Findings (Master Gap Matrix rows) | **150** |
| — COMPLETE | **31** |
| — PARTIAL | **33** |
| — MISSING | **57** |
| — INTENTIONALLY_DEFERRED | **14** |
| — PRODUCT_DECISION_REQUIRED | **11** |
| — BACKEND_GATED | **4** |
| P0 rows | 7 (M01, M06, M09, M12, B02, H03, NV03) |
| Defects register | 9 (DEF-1…9) |
| Owner decisions | 19 (O1…O19) |
| Proposed Horizon | Option A: **CUST-HV** before H5, slices V0-V11 |
| Main risks | R1-R12 (§34) |
| Remaining unknowns | U1-U8 |
| Base SHA | `a5a3479e09c3e60a32287e9f1d46e5c2fa236633` |
| Branch / Head SHA | none |
| PR | **NONE** |
| Code changes | **NONE** (this report file only, uncommitted) |
| Tests | not required; no existing claim needed re-verification |
| Merge / Deploy | **NONE** |
| Recommended next action | Owner answers O1, O2, O18, O19 → authorise V0 + V1 |
