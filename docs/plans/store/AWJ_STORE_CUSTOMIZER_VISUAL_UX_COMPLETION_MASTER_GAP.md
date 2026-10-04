# AWJ Store Customizer — Master Visual & UX Completion Evidence Pass

**Type:** Evidence-only audit + proposed Horizon scope. No code, no merge, no deploy.
**Date:** 2026-10-04 · **Owner revision applied:** 2026-10-04 (this revision)
**Repository:** `safwan5001-source/Nebrax`
**Base SHA (exact `origin/main`):** `a5a3479e09c3e60a32287e9f1d46e5c2fa236633` — `docs(store): close CUST-H4 horizon (#1228)`
**PR:** [#1230](https://github.com/safwan5001-source/Nebrax/pull/1230) · **Branch:** `docs/store-customizer-visual-ux-master-gap`
**Pre-revision Head SHA:** `66e134afa1316ff1af5c9d8309e5ef7a37086cb1` · **Post-revision Head SHA:** reported in the PR / final message (a commit cannot contain its own hash)
**Context:** CUST-H4 is CLOSED (`docs/reports/CUST-H4-CLOSURE-REPORT.md`) and is **not** reopened here.
**Roadmap:** unchanged. Modifying `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` and renumbering H5/H6 are separate later actions.

> **Evidence-discipline labels used throughout**
> **[AWJ-Existing]** already approved / current behaviour · **[Salla]** what official Salla documentation proves ·
> **[Daftra]** what official Daftra documentation proves · **[AWJ-Proposal]** recommendation · **[Owner-Decision]** Safwan must choose.
> **Scope tags on proposals:** **[HV]** in this Horizon · **[LATER]** later horizon · **[DECISION]** product decision required · **[REJECT]** intentionally rejected (reason always given).

---

## 1. Executive Summary

### 1.1 Product direction (Owner-confirmed in this revision)

AWJ has **two different design systems** and this document keeps them apart:

| | Editor chrome (AWJ ERP / Customizer UI) | Merchant storefront |
|---|---|---|
| Follows | AWJ ERP design system: clarity, speed, consistency, balanced density, RTL-first, accessibility, restrained motion | **The merchant's brand** |
| Colours | AWJ tokens only — merchant colours must never restyle toolbar, inspector, dialogs, sheets | Merchant palette: any brand colour, backgrounds, gradients, overlays |
| Freedom | Deliberately constrained | **Broad, expressive creative control** — stores must be able to look genuinely different |

**Target: creative freedom inside a safe typed design system.** Guardrails exist to prevent invalid contrast, broken responsive layouts, unsafe code, fake commerce capabilities and security problems. They must **not** be used as a reason to ship "five fixed colour tones, one layout per section, one visually fixed storefront". Not the target: Webflow/Figma freedom, arbitrary CSS/JS, absolute-position layout.

This revision therefore re-examined every earlier "defer / do not build" recommendation (§37 ledger) and re-classified each as **IN THIS HORIZON**, **LATER**, **DECISION**, or **REJECTED (with a concrete reason)**.

### 1.2 Verdict

The Customizer is a mature *structural* editor (versions, scheduling, multi-page regions, identity, section library, honest data-backed sections) but **not yet a visual store builder**. Its gap is not breadth of sections — H4 closed that — it is **depth of presentation, media and merchant workflow**.

### 1.3 Findings that matter most

1. **Media.** AWJ currently has **no first-party Customizer media upload/picker flow for section media such as Hero, Banner, Slider or Gallery**. Branding logos already have a file-input path using **embedded data URLs** (`FileReader.readAsDataURL`, ≤512 KiB each, stored inside the presentation JSON), and **Banner supports manually entered safe HTTPS image URLs**. Hero has no image field at all. Meanwhile AWJ owns a production-proven, tenant-scoped, R2-backed media foundation (`R2StorageService`, `ProductMedia`, category images) that the Customizer does not use. **Storage is settled (existing AWJ decision, §4.5)** — the work is the Customizer media *contract* and picker UX on that foundation.
2. **Sections have almost no design vocabulary.** Every section is "content + visible". No background, gradient, overlay, text/heading colour, alignment, height, width, spacing, border, radius, shadow, separator or layout variant exists on *any* homepage section; Hero's CTA is hard-coded to `/products`. The Inspector is a flat panel, so nowhere exists to put design controls.
3. **Colour system is one hue.** Everything derives from a single primary; `accentColor` is persisted but consumed by nothing. No palette roles, no picker for backgrounds/text/headings/links/buttons/borders/overlays.
4. **Header, Footer and Navigation are structurally editable but visually fixed** and must be treated as first-class design surfaces (backgrounds, transparency, overlay-on-hero, sticky, heights, dividers, six footer layouts, background media, nested menus). Custom header links never reach mobile (DEF-1).
5. **Announcement bar does not exist**; Salla documents it as multi-item, scheduled, page-targeted, coloured, optionally moving.
6. **Several earlier recommendations were under-scoped** and are corrected here: crop editor, separate mobile media, gradients, button styles, borders/shadows, separators, typography scales, motion, gallery variants, mega menu analysis, reusable styles.

### 1.4 Decisions closed by the Owner in this revision

| Decision | Outcome |
|---|---|
| **O1 — storage** | **CLOSED.** Official durable/R2-backed storage is already approved; the 2026-09-26 "keep embedded" decision is **superseded** (§4.5). |
| **O18 — Horizon** | **CLOSED.** **Option A** approved: a new Horizon before CUST-H5, working name **CUST-HV — Visual Design, Media & Merchant UX Completion**. No renumbering of H5/H6 yet. |
| Inspector IA | Direction closed: progressive disclosure; Content · Design · Layout (+ Advanced only if it has real content); no empty tabs. |
| V1 defect lane | **Split** into V1A (proven independent) and V1B (contract-dependent) — §32. |

### 1.5 Limits of this pass (honest)

No browser was run. Responsive/RTL/a11y statements come from code inspection plus prior real-browser QA (`CUST-H4-8-INTEGRATED-QA-REPORT.md`, 6 widths AR/EN). No screen-reader pass exists anywhere in prior evidence. The six-width matrix for *new* work is a Definition-of-Done item (§36).

---

## 2. Exact Base SHA and PR metadata

| Item | Value |
|---|---|
| `origin/main` at audit start | `a5a3479e09c3e60a32287e9f1d46e5c2fa236633` |
| H4 closure verification SHA (PR #1226) | `27a8049c5254794f49031e841d4a2549aab7e4cf` (ancestor of base) |
| Branch | `docs/store-customizer-visual-ux-master-gap` |
| PR | #1230 (ready for review) |
| Pre-revision Head SHA | `66e134afa1316ff1af5c9d8309e5ef7a37086cb1` |
| Post-revision Head SHA | see PR #1230 / final message |
| Changed files | this report only |
| Code changes / Merge / Deploy | **NONE / NONE / NONE** |

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
| **SAL-IMG** | Help Center AR — *إضافة صور وفيديوهات المنتج* `…/o67hdm4qs3h30gubvyfk7v9y` (full body read: in-product **image editor**, alt text ≤70 chars, ≤10 images per product, drag reorder, GIF allowed, YouTube-only video) |
| **SAL-STORE** | Help Center EN — *How the Salla Theme Store works* (cards, Try/Buy/Preview, statuses) — same page as SAL-THEMES second link |

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

**Existing AWJ Decision (Owner-confirmed, recorded in this revision):** *Store Customizer media must reuse AWJ's approved official durable / R2-backed storage foundation.* No parallel object store, no localStorage, no Base64-first new architecture, no second storage service.

**Supersession:** `AWJ_STORE_BRANDING_MEDIA_OWNER_DECISION.md` (2026-09-26, key `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`) is **superseded** by the later Owner decision approving official durable storage (`docs/storage.md`). Its premise (only the ephemeral `DocumentStorageService` disk existed) no longer holds for R2-backed domains. Clause-by-clause outcome is in §8.0. **O1 is closed**; only the Customizer Media Contract *details* remain (O2).

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
| **Product image editor** | In-product editor: **crop, professional filter, colour levels, resize, shape overlay**, Confirm/Cancel; alt text ≤70 chars (indexed by image search); ≤10 images per product; drag reorder; GIF supported; YouTube-only video | SAL-IMG |
| **Header components** | Header embeds breadcrumbs + main menu; supports child menu items and **mega menus with product displays** | SAL-HDR |

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

> Scope tags in the *Proposed direction* column (**[HV]** in this Horizon · **[LATER]** · **[DECISION]** · **[REJECT]**) are defined in the header and itemised in the §37 ledger. `INTENTIONALLY_DEFERRED` rows are LATER/REJECT items and always carry a reason.
>
> Every row labels evidence the way the evidence-discipline rule requires: the *AWJ today* and *Repo evidence* columns are **[AWJ-Existing]**; *Salla*/*Daftra* are **[Salla]/[Daftra]**; *Gap → Direction* is **[AWJ-Proposal]**; rows marked PRODUCT_DECISION_REQUIRED are **[Owner-Decision]**.

### 7.A Global design

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| G01 | Theme presets as complete visual systems | 7 colour presets; only `awj-market`/`awj-bloom` carry a starting bundle (density/card/header) | `TOK THEME_PRESETS`, `CFG PRESET_STARTING_BUNDLES`, `CP ThemePanel` | Themes are full templates: layout + features + visuals (SAL-STORE) | Template = framework of look *and* functions (DAF-TPL) | A preset today is a colour; a professional theme must define palette, fonts, spacing, header, footer, cards, buttons, default section styles, hero, navigation, layouts | Presets become **bundles** over the new design contract; applying stays non-destructive (Preview → Apply summary → new Draft Version). **[HV]** | PARTIAL | P1 | G04, G17, C01, F12, TG08 |
| G02 | Primary colour | Hex picker + WCAG contrast hint; derives 9 CSS tokens | `CP ThemePanel`, `TOK presentationCssVars` | Store colour from list (SAL-IDENT) | — | none | keep | COMPLETE | — | — |
| G03 | Accent / secondary colour | Field persisted + normalised; **no builder control, no storefront consumer** (only the mobile app-builder reads it) | grep `accentColor`: `CFG:87,449`, `web/…/app-builder/theme-panel.tsx:47`; none in `storefront/src` renderers | — | — | Dead field = fake capability in the contract | Outcome depends on the new palette model (accent becomes a first-class palette slot, or is retired) → **V1B**, decided in V0 **[HV]** | PARTIAL | P1 | G04/G18; V1B; O6 |
| G04 | Colour system (page/section background, text, heading, link, button, border, overlay, footer/header colours) | All colours derive from **one primary** + fixed neutral tokens; nothing else is merchant-editable | `TOK presentationCssVars`, `Header.tsx bg-store-surface`, `Footer.tsx bg-store-footer` | Banner/Slider: text colour, bg colour, bg image; light/dark footer; transparent header; dark bars (SAL-HOME, SAL-THEME-PAGES, SAL-DESIGN) | — | Stores cannot look different from one another beyond one hue | Merchant palette with named roles (brand, accent, surface, text, heading, link, border, overlay) editable via picker/hex/swatches; automatic foreground + contrast gate (G14). Presets are *starting points*, not the ceiling. **[HV]** | MISSING | P1 | G18, G14, C01 |
| G05 | Font families | 2 Arabic faces (Cairo, Tajawal) over Geist; one control | `TOK FONT_PRESETS`, `fontPresetFamilyStack` | Font list + own upload (SAL-IDENT) | — | Only 2 choices; one family for everything | Curated catalogue (≈6-10 Arabic+Latin pairs) with separate **display/heading** and **body** slot; self-hosted subsets, no third-party font CDN. **[HV]** | PARTIAL | P1 | G16, perf budget |
| G06 | Heading / body split, scale, weight, line height, letter spacing, button text | Deliberately **one** typography control (CUST-H3-2 decision) | `CUST-H3-2-COLOR-TYPOGRAPHY-EVIDENCE-DECISION.md` | Font + weight only (SAL-IDENT); no scale controls documented | — | H3-2 chose a narrow control; Owner now requires a professional typographic system | Bounded **scales** (e.g. S/M/L heading scale, body scale), weight set (400/500/700/800), line-height presets, letter-spacing only for Latin display text; section-heading presentation presets. Supersedes the narrow H3-2 scope (O20). **[HV]** | MISSING | P1 | G05, O20 |
| G07 | Custom font upload | `customFontUpload = GATED` | `capabilities.ts`, `CUST-H3-ARCH-1` | **Documented**: name + weight (Regular/Medium/Bold) + file (SAL-IDENT) | — | Storage is no longer the blocker (approved R2 foundation); remaining gates are the font-specific contract, licensing copy, CSP/`@font-face` review and subsetting | Reuse the Customizer media object (domain `storefront-fonts`); woff2 only; ≤3 weights; licensing acknowledgement; **LATER slice inside HV or follow-up horizon** (decide in V0). **[LATER]** | BACKEND_GATED | P2 | M09 contract, U3 CSP |
| G08 | Density | comfortable / compact, shared Canvas/Published helper | `TOK pageContainerPaddingClass`, `public-rhythm.ts` | — | — | none | keep | COMPLETE | — | — |
| G09 | Radius | default / subtle / sharp → `--store-radius` | `TOK RADIUS_PRESETS` | — | — | none | keep | COMPLETE | — | — |
| G10 | Borders & shadows (global tokens) | Not configurable (radius only) | — | — | — | No border/shadow vocabulary at all | Global tokens: border width (none/hairline/medium), border colour (palette role), shadow (none/soft/medium/strong) — consumed by cards, header, footer, banner, hero. **[HV]** | MISSING | P2 | G04, C07 |
| G11 | Product / category / marketing card design | standard / compact only | `TOK PRODUCT_CARD_PRESETS`, `public-rhythm.publishedProductCardBodyClass` | Image-as-cover vs full image; vertical layout; card styles (coupon/standard) (SAL-DESIGN, SAL-HOME) | — | No radius/border/shadow/background/padding/alignment/image ratio/fit/badge position/hover options | Card design contract (see PC06) — commerce data stays authoritative. **[HV]** | PARTIAL | P1 | PC06, G10 |
| G12 | Container width / spacing rhythm | Fixed `--store-content-max`; density only | `StoreContainer.tsx` | — | — | Owner has not decided global width control; per-section `contained∣full` and `maxWidth` presets are covered by C01 | Global content width presets (narrow/standard/wide) + per-section width; **[DECISION]** only for the global preset | PRODUCT_DECISION_REQUIRED | P2 | O8 |
| G13 | Dark / light storefront mode | None | — | Dark mode for header/footer bars (SAL-DESIGN); Wesam dark mode (SAL-THEME-PAGES) | — | Full automatic dark theme would double every palette role | Per-surface *inverse/dark* palettes (header/footer/section) are in; a visitor-facing light/dark switch is **[DECISION]** | PRODUCT_DECISION_REQUIRED | P3 | O8 |
| G14 | Contrast guardrails | Warn-only on primary vs white | `CP ThemePanel contrastWarn`, `TOK contrastRatio/primaryForeground` | — | — | Every merchant-colour control multiplies the risk | Guardrails *help, not restrict*: auto foreground suggestion; warn <4.5:1 body / <3:1 large text & UI; **block save only below 3:1 for text-on-background that carries content**; merchant can override a warning but not a block. **[HV]** | PARTIAL | P1 | G04, G18 |
| G15 | Gradients | None | — | Banner/Slider background colour or image; no gradient documented (SAL-HOME) | — | Hero default is a hard-coded primary gradient the merchant cannot change | Bounded gradient: `none∣solid∣linear`, **two palette/hex colours**, angle presets (0/45/90/135/180/…), optional third stop later; no free-form CSS string; rendered as one `linear-gradient()` from validated values; contrast computed against the *worst* stop. Cheap (no image bytes, no CLS). **[HV]** | MISSING | P1 | G04, G14 |
| G16 | Typographic scale & section-heading presentation | Fixed sizes; one `SectionHeading` treatment (accent bar) | `SectionHeading.tsx` | — | — | No size/weight/alignment/ornament choice for headings | See G06; plus heading presentation presets (bar / plain / centered / underlined) per section. **[HV]** | MISSING | P2 | G06, C01 |
| G17 | Button design system | One solid style; CTA colours fixed to primary | `HeroSection.tsx`, `BannerBand.tsx`, `ui/button.tsx` | — | — | No solid/outline/soft/link variants, no size, colour or hover choice, no icon placement | Global button style (`solid∣soft∣outline∣link`, radius from G09, size S/M/L, palette role, hover treatment) + per-CTA override limited to style & colour role; icon start/end (logical). Consistency preserved because only roles/variants are selectable. **[HV]** | MISSING | P1 | G04, G14 |
| G18 | Colour controls (picker, hex, swatches, recent) | `<input type="color">` + hex for primary only | `CP ThemePanel` | Colour pickers per element (SAL-HOME Enhanced Banner) | — | No reusable picker; no swatches/recents; no role concept | One `ColourField`: native picker + hex + palette swatches + preset swatches + **recent colours (per store, local, ≤8)**; shows contrast result for its role; used everywhere. **[HV]** | MISSING | P1 | G04, G14 |

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
| M09 | Customizer media contract (ownership, metadata, usage, delete policy, dimensions, variants, lifecycle) | Pattern proven for products (`commerce.manage`, 404-indistinguishable, signed workspace route) but **no customizer media contract** | `CUST-H4-ARCH-1 §24` (sketch); `ProductMedia.php`; `ServesProductMediaBytes.php` | — | — | Storage platform is **settled** (existing AWJ decision); the *contract details* are not authorised | Implement the contract in §8 on the existing R2 foundation — **O2 covers details only**. **[HV]** | BACKEND_GATED | P0 | O2, M12 |
| M10 | Logo / compact logo / favicon storage | Base64 data-URLs inside presentation JSON (≤512 KiB each) via `FileReader.readAsDataURL`, or pasted https | `CP LogoField`, `PN cappedLogo`, `capabilities.ts BRANDING_PERSISTENCE_CAPABILITY="design_only"` | Upload; identity applies to every theme (SAL-IDENT) | — | The 2026-09-26 "keep embedded" decision is **superseded** (§4.5). Remaining: (a) 3×512 KiB ≈ whole `MAX_DOCUMENT_BYTES` → save rejected; (b) Base64 duplicated into every version; (c) stringified every render | Move logos/favicon to media references on the approved R2 foundation; read legacy data-URLs forever; migrate lazily on next save (no bulk rewrite). **[HV]** | PARTIAL | P1 | M09, V4 |
| M11 | Empty / loading / uploading / error states | none (no upload) | — | — | — | Must be designed with M01 | See §26 | MISSING | P1 | M01 |
| M12 | Production enablement of the approved R2 foundation for new media | R2 write flags default **false**; Production values not visible from the repo | `config/product_media.php`, `config/category_media.php`, `docs/storage.md` | — | — | Not a platform question (approved) but an **operational precondition**: customizer media must never silently fall back to the ephemeral `document` disk | Customizer media domain is **R2-only**; picker shows a capability-gated state if R2 is not configured; verify flags (U1) before enabling uploads. **[HV]** | BACKEND_GATED | P0 | U1 |
| M13 | R2 lifecycle: orphan cleanup, replace, version/restore safety | Product media bulk-delete cleans R2 best-effort *after* commit (accepted orphan risk) | `docs/storage.md` "Delete behavior (R2-4D)" | Deleting a file removes it everywhere and substitutes default (SAL-MEDIA) | — | Customizer references live in draft + versions + published + scheduled; naive delete breaks any of them; H5 Restore will resurrect old references | Soft-delete state + reference scan (draft, all versions, published, scheduled); block with usage list; physical R2 delete by a reconciler only when unreferenced for N days; restore-safe by construction. **[HV]** | MISSING | P1 | M09, H5 |
| M14 | SEO impact of media | Banner alt optional; no dimensions; no `og:image` from Customizer | `BannerBand.tsx` | Alt text (≤70 chars on product images) is documented as an SEO signal (SAL-IMG) | — | Missing width/height/alt/lazy policy hurts CLS and image indexing; hero image could feed social share image | Alt on media object (AR/EN) with per-usage override; explicit dimensions; `loading`/`fetchPriority` policy; optional `og:image` from logo/hero only through the approved public media route. **[HV]** | MISSING | P2 | M05, M07 |

### 7.C Image presentation

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| I01 | Fit (cover / contain) | Banner hard-coded `object-cover`; cards `object-cover` | `BannerBand.tsx`, `ProductCard.tsx:108` | Product image "cover vs full image" (SAL-DESIGN) | — | No merchant choice | Per-usage `fit: cover∣contain` stored with the media reference. **[HV]** | MISSING | P1 | C01 |
| I02 | Focal point | None | — | — | — | Centre-crop decapitates portraits on narrow phones | Focal point (x/y %, UI = click on preview + 3×3 snap) → `object-position`; part of the crop model (I03). **[HV]** | MISSING | P1 | M01 |
| I03 | Lightweight crop (+ aspect presets, zoom, reset) | None. Earlier draft of this report rejected crop too early | — | **Product-image editor: crop, filters, colour levels, resize, shapes; Confirm/Cancel** (SAL-IMG) — documented for *product* images, not homepage sections | No editor documented in the pages read | No crop at all; fixed `object-cover` can mis-frame subjects | Owner requires a fair evaluation → **Option B recommended** (§14A): non-destructive crop rectangle + zoom + aspect presets + rotate 90° + Reset-to-original, stored as parameters; filters/levels/shapes **rejected** (no evidence merchants need them for storefront media; Photoshop scope). **[HV]** | MISSING | P1 | M01, M07 (variants derived server-side) |
| I07 | Rotate / zoom-in-crop / aspect-ratio presets / original-reset | None | — | Resize & crop in product editor (SAL-IMG) | — | Part of Option B | Rotate 90° steps, zoom within crop, ratio presets (16:5, 3:1, 16:9, 4:3, 1:1, 4:5), "Reset to original" always available (originals never modified). **[HV]** | MISSING | P1 | I03 |
| I08 | Flip, filters, colour levels, shapes | None | — | Filters, colour levels, shapes in product editor (SAL-IMG) | — | Owner: only if evidence supports | Flip **rejected** (mirrors embedded text/logos, confuses RTL/LTR artwork, no merchant use-case found); filters/levels/shapes **rejected** (Photoshop-class scope, uneven quality, brand images arrive finished). Revisit with usage evidence. **[REJECT]** | INTENTIONALLY_DEFERRED | — | — |
| I04 | Aspect ratio / height presets | Banner `h-36 md:h-40 md:w-56` fixed; hero min-height by preset (market vs default) | `BannerBand.tsx`, `HeroSection.tsx` | Fixed banner "728×90 or any" (SAL-HOME) | — | No ratio/height choice | 3-4 named ratios (wide 3:1, banner 16:5, standard 16:9, square) + height presets; one responsive document | MISSING | P1 | C01 |
| I05 | Separate mobile media (optional override) | None | — | No mobile-specific upload documented for Photos Slider / Enhanced Slider (SAL-HOME, SAL-ESL) | — | A landscape desktop image often crops badly on a phone | Model: one default media **+ optional mobile override**, same semantic content (alt/link/text shared), not a mobile theme; applies to Hero, Banner, Slider slides. **[DECISION]** | PRODUCT_DECISION_REQUIRED | P1 | O9, M01, I03 |
| I06 | Image fallback | Product: icon fallback on error; banner: broken `<img>` | `product-image.tsx`, `BannerBand.tsx` | Deleted media → default substituted (SAL-MEDIA) | — | Banner shows broken glyph if URL dies | `onError` hide-image fallback + decorative background | PARTIAL | P1 | M01 |

### 7.D Hero

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| H01 | Headline / subheadline | Global fields `homepage.heroHeadline` (120) / `heroSubheadline` (200); hero instance holds **no content**; non-deletable singleton | `CFG homepage`, `CAP hero.canDelete=false` | Promotion: headline + CTA (SAL-HOME) | — | Not per-instance, so no duplicate/second hero, no per-version independence beyond doc | Move to `HeroContent` on the instance (back-compat: read global as fallback); allow deletion once content is local | PARTIAL | P1 | O10 |
| H02 | CTA label + URL + style | **Hard-coded** "shopNow" → `${basePath}/products` | `HeroSection.tsx` | Button + link (any link type) (SAL-HOME) | — | Merchant cannot choose CTA, destination or look | `ctaLabel`, safe `ctaHref` (reuse `sanitizeContentHref`), style (G17), colour role. **[HV]** | MISSING | P1 | H01, G17 |
| H03 | Hero media: background image / colour / gradient | None. Fixed primary gradient | `HeroSection.tsx bg-linear-to-r from-primary-700…` | Slider/Banner: bg colour or image (SAL-HOME) | — | The earlier "storefront invention" rationale applies only to *auto-generated* imagery | `background: solid∣gradient∣image` (+ optional mobile override I05, focal/crop I03) **[HV]** | MISSING | P0 | M01, G15 |
| H04 | Overlay (colour, opacity) + text colours (heading, body) | n/a | — | Text colour, bg colour, full-screen bg (SAL-HOME Enhanced Banner) | — | Needed the moment media lands (legibility) | `overlay: none∣solid∣gradient` with **any palette/hex colour** and 0-90 % opacity; heading/body colour roles; auto-suggest light/dark text; contrast measured against overlay-blended image average (server-computed luminance sample at upload). **[HV]** | MISSING | P1 | H03, G14 |
| H05 | Content width / position / text alignment | start-aligned, `max-w-2xl` | `HeroSection.tsx` | Text alignment (SAL-HOME) | — | Fixed composition | `contentWidth` (narrow/standard/wide/full), `position` (3×3 logical grid), `align` start/center/end. **[HV]** | MISSING | P1 | C01 |
| H06 | Height (min/max), aspect ratio, full-bleed vs contained, radius, border, shadow | Fixed by theme (market 7-10 rem, default 11-18 rem) | `HeroSection.tsx` | Full-screen background mode; wide toggle (SAL-HOME, SAL-ESL) | — | No merchant control | Height presets + min/max (rem, bounded), ratio presets, `full∣contained`, radius/border/shadow from global tokens with per-section override. **[HV]** | MISSING | P1 | C01, G10 |
| H07 | Layout variants | One | — | Slider "image beside text"; Promotion; Enhanced Banner (SAL-HOME) | — | One composition | ≥4: *text-over-image*, *split (text ∣ image)*, *centered statement*, *minimal band*. **[HV]** | MISSING | P1 | H03 |
| H10 | Hero/Banner text colours & typography | Fixed (`text-store-primary-foreground`, `text-xl…lg:text-4xl`) | `HeroSection.tsx` | text colour (SAL-HOME) | — | No heading/body colour or size choice | Heading/body colour roles + size step (S/M/L/XL) from the type scale (G06). **[HV]** | MISSING | P1 | G06, G04 |
| H08 | Secondary CTA | None | — | Single button in documented elements | — | Not evidence-backed yet | Add second CTA only if V0 research shows need; model it as `ctas[≤2]` from day one to avoid a later migration. **[DECISION]** | PRODUCT_DECISION_REQUIRED | P3 | H02 |
| H09 | Mobile behaviour | Stacked, line-clamped sub | `HeroSection.tsx` | works on mobile | — | untested with images | Verify at 390/430 in DoD | PARTIAL | P1 | H03 |

### 7.E Banner

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| B01 | Title / subtitle / CTA / link / alt | Typed, sanitised, code-point-safe; `imageAlt` (H4-4) | `SC BannerContent`, `PN` | Enhanced Banner: title, subtitle, optional button+link (SAL-HOME) | — | none | keep | COMPLETE | — | — |
| B02 | Image upload / select | https URL text box | `CP BannerFields` | upload (SAL-HOME) | — | = M01 | MediaPicker | MISSING | **P0** | M01 |
| B03 | Background colour/gradient/image, overlay, text colours | None | — | **text colour, bg colour, bg image, white button** (SAL-HOME) | — | No design fields | Same background/overlay model as Hero (H03-H04) via the shared Section Visual Contract. **[HV]** | MISSING | P1 | C01, G15 |
| B04 | Content position / alignment / width | image-left text-right (md) fixed | `BannerBand.tsx` | text alignment (SAL-HOME) | — | — | `align`, `imagePosition` (start/end/top/background), `contentWidth`. **[HV]** | MISSING | P1 | C01 |
| B05 | Height, aspect ratio, full-bleed, radius, border, shadow, spacing | fixed `h-36 md:h-40 md:w-56` | `BannerBand.tsx` | any dimensions (SAL-HOME) | — | — | I04 presets + width + radius/border/shadow tokens. **[HV]** | MISSING | P1 | I04, G10 |
| B06 | Layout variants | one (image + text card) | — | Fixed banner / Enhanced banner / Promotion = 3 flavours | — | AWJ has 1 | ≥4: *card*, *full-bleed with overlay*, *split*, *text-only band*. **[HV]** | MISSING | P1 | M01 |
| B08 | CTA style/colours on Banner | Fixed primary solid button | `BannerBand.tsx` | white-button option (SAL-HOME) | — | — | Shared CTA model with Hero (G17). **[HV]** | MISSING | P1 | G17 |
| B07 | Per-banner expiry | none; whole-document scheduling exists (H1) | `CUST-H1` | optional expiry date (SAL-HOME) | — | Different problem from version scheduling | Useful for campaigns without cloning a version. **[DECISION]** (cheap: `endsAt` evaluated like announcements) | PRODUCT_DECISION_REQUIRED | P2 | O11, U5 |

### 7.F Slider / carousel / gallery

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| S01 | Slider section (media, text, CTA, overlay, colours, alignment per slide) | **None** (Swiper only inside product rails) | `ProductCarousel.tsx` (swiper ^12) | Photos Slider ≤10; Slider (bg colour or image, title, description, side image, button+link, advanced layout controls); Enhanced Slider 1-10 {image,title,description} (SAL-HOME, SAL-ESL) | — | Missing; most common homepage hero pattern | `slider`: 2-8 slides, each = media (+ optional mobile override), heading, sub, CTA, overlay, text colour, alignment; slider-level height/ratio/radius/layout; add/remove/duplicate/reorder. **[HV]** | MISSING | P1 | M01, I05, S02 |
| S02 | Slider behaviour: autoplay, interval, pause, arrows, dots, swipe, RTL | n/a | `globals.css @media (prefers-reduced-motion)` exists | autoplay undocumented (SAL-ESL: developer choice) | — | Policy needed | Autoplay **opt-in** (default off), interval 4-10 s presets, always-visible pause control when on, pause on hover/focus/touch, arrows + dots, swipe, RTL-correct, loop optional, off under `prefers-reduced-motion`. **[HV]** | PRODUCT_DECISION_REQUIRED | P1 | O4 |
| S03 | Gallery: grid & carousel modes | none | — | Card Gallery (1-8), Enhanced Card Gallery (SAL-HOME) | Gallery images manager (DAF-GAL) | Missing | `gallery`: 2-24 images, `grid` (2/3/4/6 cols, ratio, gap) and `carousel` modes, captions, per-image link. **[HV]** | MISSING | P1 | M01 |
| S04 | Product rail vs grid (merchant control), count, columns | Code decides | `FeaturedShelf.tsx:56,70`, `NewArrivalsSection.tsx`, `ProductShelfSection.tsx` | Moving vs Fixed products (SAL-HOME) | — | no merchant choice | `layout: grid∣rail`, `columns`, `count`. **[HV]** | PARTIAL | P1 | C01 |
| S05 | Gallery lightbox | `MediaLightbox` exists for PDP | `MediaLightbox.tsx` | — | — | Reusable, already a11y-reviewed on PDP | Opt-in per gallery; reuse component; focus trap, Esc, arrow keys, RTL. **[HV]** | MISSING | P2 | S03 |
| S06 | Slider transitions & motion presets | n/a | — | — | — | Owner: bounded professional motion | `slide` / `fade` / `none`, duration presets 300/500/800 ms; off under reduced-motion. **[HV]** | MISSING | P2 | S01, MO01 |
| S07 | Mobile media override per slide / hero / banner | n/a | — | not documented | — | see I05 | Single shared override mechanism. **[DECISION]** | PRODUCT_DECISION_REQUIRED | P1 | I05 |
| S08 | Gallery collage layouts | n/a | — | — | — | Visual variety | Fixed collage templates (e.g. 1+2, 2+1, mosaic-5) using CSS grid with **DOM order = reading order**. **[LATER]** (after grid/carousel prove out) | INTENTIONALLY_DEFERRED | P3 | S03 |
| S09 | Gallery masonry | n/a | — | — | — | CSS-column masonry reorders visually vs DOM → breaks keyboard/screen-reader order and RTL flow | Do not use column masonry. A grid-row-span "justified" layout that preserves DOM order may qualify later. **[DECISION]** | PRODUCT_DECISION_REQUIRED | P3 | S08, A-series |

### 7.G Announcement / promo bar

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| N01 | Announcement bar (one/many; text, icon, link) | **Nothing** | grep `announcement|promo.?bar|marquee|ticker`: no match in `storefront/src`, builder, normalizer | **Yes**: multiple; title, text, icon, link (SAL-PROMO) | — | Missing first-class chrome | Global chrome region `announcements[]` (≤5), see §12. **[HV]** | MISSING | P1 | none (media-independent) |
| N02 | Bar colours (bg, text, icon, link) | n/a | — | background + text colour (SAL-PROMO, SAL-ADV) | — | — | Full palette-role colours via ColourField with contrast gate; gradient allowed (G15). **[HV]** | MISSING | P1 | G04, G15 |
| N03 | Ticker / moving text | n/a | — | "moving text" toggle (SAL-PROMO) | — | Motion policy | Included: CSS marquee, speed presets (slow/normal/fast), pauses on hover/focus + visible pause button, static under reduced-motion, direction follows `dir`, full text always reachable. **[HV]** | MISSING | P1 | O5, MO01 |
| N04 | Expiry, scheduling, page targeting | n/a | — | **expiry date**, **pages**, **theme-version** scope (SAL-PROMO) | — | — | `startsAt?`, `endsAt?`, `pages: home∣product∣category∣all`; version scope is automatic (lives in the presentation document) | MISSING | P1 | cache (U5) |
| N05 | Sticky & dismissible (+ persistence) | n/a | — | not documented | — | Both are common in professional stores | `sticky: off∣on` (sticky sits above header, collapses on scroll on mobile), `dismissible` with per-visitor `localStorage` keyed by `announcementId+revision` (re-appears when text changes); no server state. **[HV]** | PRODUCT_DECISION_REQUIRED | P2 | O5 |
| N06 | Rotation of multiple messages | n/a | — | multiple announcements documented; display behaviour undocumented | — | Owner asks for rotation | Default = first eligible; optional `rotate` (fade/slide, 4-10 s, pause control, manual prev/next); never auto-rotating under reduced-motion. **[HV]** | MISSING | P2 | N01, MO01 |
| N07 | Animation speed / transition presets | n/a | — | — | — | — | Shared motion tokens (MO02). **[HV]** | MISSING | P3 | MO02 |

### 7.H Header & navigation

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| HD01 | Header layout variants (desktop/mobile) | `standard` / `compact` | `TOK HEADER_STYLES`, `Header.tsx compact` | per-theme layouts | — | 2 variants | ≥4: *standard*, *compact*, *centered logo*, *two-row (logo above nav)*; separate mobile arrangement presets (logo-centred / logo-start). **[HV]** | PARTIAL | P1 | HD04 |
| HD02 | Logo + compact logo | Upload (Base64) / https; compact used when header compact | `public.ts publishedLogoUrl`, `StoreBrand.tsx` | logo + favicon (SAL-IDENT) | — | storage per M10 | keep behaviour; storage migration | COMPLETE | — | M10 |
| HD03 | Logo size & alignment & treatment | fixed `size="md"` | `Header.tsx`, `StoreBrand.tsx` | — | — | No control | Size presets (S/M/L/XL by height in px), alignment start/center, optional max-width, monochrome/original treatment (contrast on dark header). **[HV]** | MISSING | P2 | M10 |
| HD04 | Header colours: background, text/icon, border, shadow, transparency | none | `Header.tsx bg-store-surface` | **transparent header**, dark bars (SAL-THEME-PAGES, SAL-DESIGN) | — | No colour control — not cosmetic: header is on every page | Palette-role colours, gradient (G15), divider/border colour + width, shadow, opacity (blur optional later); auto icon/text foreground. **[HV]** | MISSING | P1 | G04, G10 |
| HD05 | Search / account / cart toggles | Yes | `CFG header.show*` | — | — | none | keep | COMPLETE | — | — |
| HD06 | Category-nav toggle | Yes (real categories in Published; **fixture** in Canvas) | `CFG showCategoryNav`; `CAN PREVIEW_CATEGORIES` (H4 closure §16) | header menu with categories (SAL-THEME-PAGES) | — | parity gap in Canvas | Feed Canvas from the same workspace categories read as H4-3 did for the section | COMPLETE | — | see HD09 |
| HD07 | Sticky behaviour | **Always sticky** | `Header.tsx` | **sticky main menu toggle** (SAL-DESIGN) | — | No choice | `sticky: always∣on-scroll-up∣off`, optional shrink; interacts with announcement bar (N05). **[HV]** | PRODUCT_DECISION_REQUIRED | P2 | N05, O5 |
| HD08 | Mobile header | Fixed 54 px brand-centred grid, search second line | `Header.tsx` | — | — | custom links absent (NV03) | — | PARTIAL | P1 | NV03 |
| HD09 | Canvas header/footer category fixtures | `PREVIEW_CATEGORIES` still feeds header rail + footer "Shop" column | H4 closure §16 | — | — | Canvas shows invented categories | Wire to real data | PARTIAL | P2 | — |
| HD10 | Header height & spacing | fixed token `--store-header-height` | `Header.tsx` | — | — | — | Height presets (compact/standard/tall) + vertical padding. **[HV]** | MISSING | P2 | HD01 |
| HD11 | Overlay-on-hero (transparent) mode | none | — | transparent header toggle (SAL-THEME-PAGES) | — | Not cosmetic: determines legibility, LCP image position and sticky behaviour | `overlay: off∣on-hero` — header sits transparent over the hero/slider on Home (and category cover) and **becomes solid on scroll**; text/icon tone derived from hero overlay; automatic fallback to solid when the first section is not a media hero. **[HV]** | MISSING | P1 | H03, HD04, HD07 |
| HD12 | Search presentation | input always shown/hidden by toggle | `Header.tsx StoreSearch` | — | — | No style choice | `search: bar∣icon-expand∣hidden`, radius/border from tokens. **[HV]** | MISSING | P2 | HD01 |
| HD13 | Category-nav presentation | single rail | `CategoryNav.tsx` | menu with categories (SAL-THEME-PAGES) | — | — | `rail∣tabs∣hidden`; mega menu later (NV07). **[HV]** | MISSING | P2 | NV04, NV07 |
| HD14 | Header divider / border / shadow | fixed bottom border | `Header.tsx` | — | — | — | Covered by HD04 tokens. **[HV]** | MISSING | P2 | HD04 |
| NV01 | Primary links | ≤12 flat; kinds home/category/product/content/external; label ≤80; enable; up/down | `CFG header.links`, `CP HeaderPanel` | Menus with title, type, target, icon (SAL-MENU) | Name + Type + target (DAF-MENU) | no icon, no target | Keep kinds; add `openInNewTab` for external only | PARTIAL | P1 | NV02 |
| NV02 | Link pickers | **Raw `href` text box** beside a kind dropdown | `CP HeaderPanel` (select kind + input href) | choose category/product/page from list | dropdown of existing categories / products / content pages (DAF-MENU) | Merchant must know/type internal paths | Pickers reusing `CategoryPreviewPicker` / `ProductPreviewPicker` patterns | MISSING | P1 | — |
| NV03 | Custom links on mobile | **Not rendered below `lg`**: `Header` shows them `hidden … lg:block`; `MobileMenu` receives only categories + wholesale | `Header.tsx:171`, `MobileMenu.tsx` (no `extraLinks`), `layout.tsx:177,228` | menus apply to mobile | — | Link shows in Canvas but not on phones = parity defect (DEF-1) | Pass `extraLinks` into `MobileMenu` | MISSING | **P0** | — |
| NV04 | Submenus / nesting | flat | — | menus; depth undocumented in pages read (SAL-MENU) | **≤2 submenu levels** via drag or "↴" button (DAF-ORD) | — | One-level children in this Horizon (dropdown on desktop, accordion on mobile); second level only via mega menu later. **[HV]** | MISSING | P1 | NV02, NV03 |
| NV05 | Drag-and-drop ordering (keep buttons) | up/down only | `CP` | drag handle (SAL-HOME/MENU) | **up/down *and* drag** (DAF-ORD) | — | Drag on top of buttons; for children use "make child ↴" button like Daftra. **[HV]** | MISSING | P2 | NV04 |
| NV06 | Safe URLs | external must be https; internal prefixed with basePath | `URL sanitizeExternalUrl`, `public.ts resolvePresentationHref` | — | — | none | keep | COMPLETE | — | — |
| NV07 | Mega menu (+ category imagery) | none | — | Twilight header supports **mega menus with product displays** (SAL-HDR) | — | Owner: analyse, do not build automatically | Evaluated: needs category images (exist), product cards, a11y menu pattern, mobile fallback. **[LATER]** — own contract after nesting ships. | INTENTIONALLY_DEFERRED | P3 | NV04, CT01 |
| NV08 | Menu item icons & badges ("new"/"sale" labels) | none | — | optional icon image per item (SAL-MENU) | — | — | Curated icon keys (same set as Benefits) + optional text badge (≤12 chars, tone from palette). **[HV]** | MISSING | P2 | BN02 |
| NV09 | Header/footer menu assignment | header links only; footer links code-fixed | `Footer.tsx` | assign menus to header/footer per theme version (SAL-MENU) | — | — | Named menus (`main`, `footer-a`, `footer-b`, …) reused by Header, MobileMenu and Footer groups. **[HV]** | MISSING | P1 | F04 |

### 7.I Footer

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Content (tagline ≤200, copyright ≤120, logo, contact, WhatsApp, social ≤8, apps) | Complete, sanitised | `CFG footer/contact/social/apps`, `Footer.tsx` | support channels, social, app links (SAL-THEME-PAGES) | — | none | keep | COMPLETE | — | — |
| F02 | Footer colours: background, text, heading, link, hover | Fixed `--store-footer*` tokens | `Footer.tsx:204` | light/dark footer (Wesam, SAL-THEME-PAGES) | — | No control; footer is brand-critical | Palette-role colours incl. hover, gradient, opacity; auto contrast. **[HV]** | MISSING | P1 | G04, G15, G14 |
| F03 | Footer layout variants | Fixed grid `grid-cols-2 sm:grid-cols-3` + contact grid | `Footer.tsx:234,302` | — | — | One layout | **≥6**: *compact*, *columns*, *centered*, *editorial* (large tagline + sparse links), *minimal* (single row), *brand-heavy* (large logo + CTA band) — each with defined mobile stacking and RTL mirroring (§20). **[HV]** | MISSING | P1 | F12 |
| F04 | Footer navigation groups | Code-fixed: policy links + category links | `lib/constants/policies.ts`, `Footer.tsx` | choose menu for footer (SAL-MENU) | — | Merchant cannot add/rename/reorder footer links | `footer.groups[≤6]` × links (same kinds & pickers as header), group titles, per-group column span. **[HV]** | MISSING | P1 | NV02, NV09 |
| F05 | Footer top divider, border, spacing, padding, column gap | none | — | — | — | Owner: do not defer | `divider: none∣line∣wave∣angle` (see C05), border width/colour, padding top/bottom presets, column gap presets. **[HV]** | MISSING | P1 | C05, G10 |
| F06 | Footer mobile layout | stacked 2-col | `Footer.tsx` | — | — | untested with long AR/EN | Each layout defines its mobile stack explicitly (§20); verified in DoD. **[HV]** | PARTIAL | P1 | F03 |
| F07 | CR/VAT/SBC identity presentation | Official marks, no merchant-minted "verified" | `STORE-TRUST-*`, `CFG verification` | verification number auto in footer (SAL-IDENT) | — | none | keep | COMPLETE | — | — |
| F08 | Footer logo: size, treatment, alignment | `showLogo` only | `Footer.tsx StoreBrand` | — | — | — | Size presets, original/monochrome-light/monochrome-dark treatment, alignment start/center/end. **[HV]** | MISSING | P1 | M10 |
| F09 | Footer background image / gradient / opacity | none | — | — | — | Brand-heavy footers need it | Media-backed background (M01) with overlay colour/opacity & fixed-contrast text; gradient (G15). **[HV]** | MISSING | P1 | M01, G15 |
| F10 | Footer alignment & content ordering | fixed | — | — | — | — | `align` + ordering of {brand, groups, contact, social, apps, identity} within the chosen layout. **[HV]** | MISSING | P2 | F03 |

### 7.J Homepage-wide & product/category surfaces

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| C01 | Shared optional Section Visual Contract | **None.** Only `{id,type,visible,content?}` | `CFG PresentationHomeSection` | per-element layout/colour/alignment (SAL-HOME) | — | No place to attach design | Typed optional `design` per section **with capability flags per type** (not every field everywhere): background (solid/gradient/media), width/maxWidth, spacing (padding top/bottom), content & heading alignment, border/colour, radius, shadow, separator, overflow, layout variant. **[HV]** | MISSING | P0 | normalisers ×3, IN01 |
| C02 | Section heading text / visibility | Only `productShelf`/`discovery`/`deliveryPromise` carry `title`; others use fixed i18n | `SC`, `SectionHeading.tsx` | rename element; main title per element | — | no title override on featured/offers/newArrivals/categories | `title?` + `showTitle` on those types | PARTIAL | P2 | C01 |
| C03 | Section anchor id | none | — | — | — | Needed for in-page links, not for visual design | Cheap (`id` slug, validated). Useful with announcement/menu links. **[LATER]** (after nav pickers) | INTENTIONALLY_DEFERRED | P3 | NV02 |
| C04 | Rename a section (editor label) | none | — | **Rename element** (SAL-HOME) | — | merchants with 6 banners cannot tell them apart | optional `label` (editor-only, never rendered) | PRODUCT_DECISION_REQUIRED | P2 | O13 |
| C05 | Section separators / shapes (divider line, spacing, colour band, geometric, overlap) | none | — | — | — | Owner: reject only with evidence | `separator`: `none∣line∣band∣wave∣angle∣curve` top/bottom, colour role, height presets — implemented as inline SVG/CSS clip with `aria-hidden`, mirrored in RTL. **Overlap/negative margin**: only for hero→next-section cards on ≥md with a safe fallback to none on mobile (**[DECISION]**, risk of clipped focus rings). **[HV]** for line/band/wave/angle/curve | MISSING | P2 | C01, G15 |
| C06 | Section background media (image, pattern) | none | — | Moving Products with Background; Promotion bg (SAL-HOME) | — | — | Section `background: media` using M01 with overlay; no video backgrounds. **[HV]** | MISSING | P1 | M01, C01 |
| C07 | Section border, radius, shadow | none (global radius only) | — | — | — | — | Per-section tokens from G10/G09 with capability flags. **[HV]** | MISSING | P2 | C01, G10 |
| C08 | Overflow behaviour (clip / visible / scroll-x for rails) | implicit | — | — | — | — | Declared per type (rails scroll, heroes clip), not merchant-editable except rail `peek`. **[HV]** | PARTIAL | P3 | C01 |
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
| PC06 | Card richness: radius, border, shadow, background, padding, alignment, badge position, hover | `standard`/`compact` only | `ProductCard.tsx` | coupon vs standard card styles (SAL-HOME) | — | Owner requires richer card design | Card design contract shared by product/category/marketing cards: radius, border, shadow, bg role, padding step, content alignment, image ratio/fit, badge position (start-top/end-top/overlay-bottom), hover (none/lift/zoom/reveal-CTA). **Prices, discounts, stock badges stay Commerce-driven** (only position/shape selectable). **[HV]** | MISSING | P1 | G10, G11, MO01 |
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
| CC02 | Block types: image, button, divider, spacer, callout, 2-col rows | none | — | Promotion, Card Gallery | drag-and-drop elements (DAF-CP; palette not enumerated) | no image/button | add `image` (M01), `button`, `divider`, `spacer`, callout; **2-column rows with a mandatory single-column mobile stack** (safe: the stack is fixed, not merchant-defined); ≤12 blocks. **[HV]** | MISSING | P1 | M01 |
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
| TG01 | Theme gallery | `/commerce/themes`: 3 runtime-backed themes as wireframe cards | `theme-registry.ts`, `themes/page.tsx` | Theme Store: cards with rating/activity; Try · Buy · Preview (SAL-STORE) | Template list with View Demo (DAF-TPL) | 3 themes; wireframe thumbnails | Grow to ≈6-8 *complete visual systems* (TG08) with real previews. **[HV]** | PARTIAL | P1 | TG02, TG08 |
| TG02 | Preview with merchant data, Desktop/Mobile | "Preview" opens the **live store URL** — it does **not** show the theme (misleading, DEF-4) | `themes/page.tsx:205-218` | "Preview your store with a theme" (SAL-THEMES) | **View Demo** before Apply (DAF-TPL) | No true preview | Preview = open the theme as an **unsaved draft in the Canvas** (read-only, merchant data), Desktop/Mobile toggle | MISSING | P1 | none |
| TG03 | Apply creates new Draft Version | Yes; named "<theme> — Theme Gallery"; rolls back version on failure; routes to appearance | `themes/page.tsx handleUseTheme` | duplicate then customise (SAL-THEMES) | — | none | keep | COMPLETE | — | — |
| TG04 | Apply confirmation / "what will change" | Immediate on click; no summary | `themes/page.tsx:56-110` | — | **Apply → OK confirm** (DAF-TPL) | Safe (new version) but opaque | One-line summary dialog: "creates a draft version; changes: colour, density, header, card; keeps: content, logos, links" | MISSING | P1 | — |
| TG05 | Reset / restore defaults | none (global or per-section) | — | — | "reset … elements within default pages" (DAF-TPLEDIT) | — | Per-section "Reset to defaults" + "Reset design" | MISSING | P2 | C01 |
| TG06 | Safe rollback | Versions: switch back; live version not deletable | H1 | cannot delete active version (SAL-THEMES) | — | none | keep | COMPLETE | — | — |
| TG07 | Vertical presets / compatibility | Flowers pack adds backed sections only | `flowers-pack.ts`, ADR-26 | industry browse (SAL-THEMES) | — | one vertical | Add `retail`/`services` packs only with real backing | PARTIAL | P3 | — |
| TG08 | Theme as a complete visual system | Preset = primary colour (+ market/bloom bundles) | `CFG PRESET_STARTING_BUNDLES`, `flowers-pack.ts` | Templates control layout elements & features (SAL-STORE) | Template = look + functions (DAF-TPL) | A theme must define palette, fonts, spacing, header, footer, cards, buttons, default section styles, hero, navigation, layouts | `ThemeDefinition` = typed bundle of the HV contract; apply = merge into a **new Draft Version** (never overwrite content/media/links); summary lists exactly which design areas change; recovery = switch back to previous version (H1). **[HV]** | MISSING | P1 | C01, G01 |
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
| IN01 | Inspector information architecture | **Single flat panel**: visibility toggle + content fields | `CP HomepagePanel` | grouped option tabs per version | — | Nowhere to put design controls | Rich sections: **Content · Design · Layout** (+ **Advanced** only if it has real content); simple sections: one compact panel; no empty tabs (§22). **[HV]** | MISSING | P0 | C01 |
| EA01 | Add / select / duplicate / hide | Yes, capability-aware | `CP HomepagePanel`, `CAP` | same set | — | none | keep | COMPLETE | — | — |
| EA02 | Reorder (keyboard/touch) | Up/Down buttons | `CP` | drag handle | up/down **and** drag (DAF-ORD) | fine | keep as the accessible path | COMPLETE | — | — |
| EA03 | Reorder by drag-and-drop | none | — | drag handle (SAL-HOME) | drag (DAF-ORD) | — | Drag (pointer + touch long-press) layered on the Up/Down buttons; Canvas follows. **[HV]** | MISSING | P2 | — |
| EA04 | Delete confirmation | `deleteSection` removes immediately, no confirm | `CP:deleteSection` | **confirmation before delete** (SAL-HOME) | — | easy accidental loss (recoverable only via versions) | confirm *only* when the section has authored content; otherwise undo-toast is H5 | PARTIAL | P2 | H5 |
| EA05 | Reset section to defaults | none | — | — | reset default pages (DAF-TPLEDIT) | — | see TG05 | MISSING | P2 | — |
| EA06 | Undo / redo | none | Roadmap CUST-H5 | not documented | — | owned by H5 | do not pull into CUST-HV | INTENTIONALLY_DEFERRED | — | H5 |
| W01 | Duplicate section **including design** | Duplicate clones content only today (design doesn’t exist yet) | `CP duplicateSection` | Duplicate keeps all settings (SAL-HOME) | — | Must cover design + media refs | Deep clone of `content` + `design` (media refs shared, not copied). **[HV]** | PARTIAL | P1 | C01 |
| W02 | Copy / paste section style | none | — | — | — | Speeds up consistent styling | "Copy style" / "Paste style" between same-type sections (design only, not content); toast confirmation; undo arrives with H5. **[HV]** | MISSING | P2 | C01 |
| W03 | Reset design to default | none | — | — | reset default pages (DAF-TPLEDIT) | — | Per-section "Reset design" + "Reset all design" (content untouched). **[HV]** | MISSING | P1 | C01 |
| W04 | Reusable section presets (“save as preset”) | none | — | — | — | Power-merchant workflow | Preset = design-only template stored per store (≤24); apply to any compatible section; start with built-in presets per section type. **[LATER]** (built-ins in HV, user-saved presets after) | INTENTIONALLY_DEFERRED | P3 | C01 |
| W05 | Duplicate/copy section across pages | Sections exist on Home only; Product/Category use fixed regions | `page-regions.ts` | — | — | Architecture does not allow Home sections on other pages today | Not applicable until sections exist outside Home. **[LATER]** | INTENTIONALLY_DEFERRED | P3 | H2 follow-up |

### 7.M Cross-cutting

| ID | Capability | AWJ today | Repo evidence | Salla | Daftra | Gap | Proposed direction | Status | Pri | Deps / Risks |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Desktop / Tablet / Mobile = one document | Yes; viewport resolved in JS (`viewport` prop) in Canvas vs CSS breakpoints in Published | `CAN:256-335` | works on mobile (SAL-EDIT) | — | drift risk (§27) | keep model; add per-breakpoint snapshot tests | COMPLETE | — | — |
| R02 | Section-editing surface at 768 px | **None** — Canvas only (pre-existing) | H4-8 §10 | — | — | Fix depends on the new Inspector IA | **V1B** — decide with IN01 in V0, implement with V5. **[HV]** | MISSING | P1 | IN01, V1B |
| R03 | Builder header overflow when draft dirty at 768/1024 | reproduced on pre-H4-7 baseline (39 px) | H4-8 §10 | — | — | pre-existing | fix in cleanup slice | PARTIAL | P2 | — |
| RT01 | RTL/LTR builder & storefront | verified AR/EN at 6 widths in H4-8 | QA report | — | — | none | keep | COMPLETE | — | — |
| RT02 | RTL for new carousel/ticker/drag | no such components yet | — | — | — | each new motion/drag control needs RTL spec | spec in §24 | MISSING | P1 | S01, N03, EA03 |
| A01 | Reduced motion | global CSS rule + `motion-reduce:` on cards | `globals.css:66,259` | — | — | no autoplay features exist yet | mandatory for S01/N03 | PARTIAL | P1 | — |
| A02 | Assistive-technology pass | **never performed** (QA sandbox had no AT) | H4 closure §13 | — | — | unknown real-world SR behaviour | include NVDA/VoiceOver pass in DoD | MISSING | P1 | — |
| MO01 | Bounded motion system (hover, slider/ticker transitions, subtle reveal) | Hover scale on cards with `motion-reduce:` guard; no other motion | `ProductCard.tsx:108`, `globals.css` | — | — | Owner: professional bounded motion, not "no motion" | Motion tokens (MO02), allowed uses: hover feedback, slider/ticker, subtle fade-up reveal (opt-in per section, once, ≤400 ms, never above-the-fold LCP element); everything off under `prefers-reduced-motion`; no scroll-jacking/parallax. **[HV]** | MISSING | P2 | MO02 |
| MO02 | Duration & easing presets | — | — | — | — | — | `instant 0 / fast 150 / base 300 / slow 500 ms`, two easings. **[HV]** | MISSING | P3 | — |
| SE01 | SEO effect of media & markup | alt optional; no dimensions | `BannerBand.tsx` | Alt ≤70 chars indexed by image search (SAL-IMG) | — | — | alt required-with-warning on informative images, decorative flag otherwise; one `<h1>`; hero text as real text (not baked into images); lazy below fold. **[HV]** | MISSING | P2 | M14 |
| UR01 | Undo/Redo & Restore compatibility of the new contract | n/a (H5 not started) | Roadmap H5 | — | — | New design/media fields must be undo-friendly | Document stays plain immutable JSON; media referenced by id; cropping stored as parameters; "Restore" re-validates media refs (M13). **[HV]** | PARTIAL | P1 | H5 |
| LC01 | Theme application × recovery × media | Apply creates a new Draft Version; rollback = switch version | `themes/page.tsx` | Duplicate/preview/publish (SAL-THEMES) | — | Theme media (e.g., default hero art) would need ownership rules | Theme assets ship as AWJ-owned read-only media; applying copies *references*, never merchant media; deleting a theme never deletes merchant media. **[HV]** | PARTIAL | P2 | TG08, M13 |
| ST01 | Save/conflict/stale/lifecycle states | draft/saved/conflict banners, version conflict reload | `EB versionConflict`, H1 | — | — | none | keep | COMPLETE | — | — |
| PA01 | Preview ↔ Published parity architecture | 3 normalisers + 2 renderer sets + mirror; parity by duplication + fixtures | §4.1; `tests/Fixtures/presentation/*` | — | — | every new field = 3+ edits, drift risk | single JSON-Schema/fixtures source + generated types + one parity harness (§27) | PARTIAL | **P1** | — |
| PF01 | Config size / dirty-check cost | `presentationConfigsEqual` = `JSON.stringify` ×2 every render; doc may embed ≤1.5 MiB of Base64 | `config.ts:605`, `EB:359` | — | — | wasteful; disappears when M10 lands | migrate logos; shallow/hash compare | PARTIAL | P2 | M10 |
| PF02 | LCP / CLS for image sections | banner `<img>` has no width/height or lazy/priority policy; proxy images unoptimised | `BannerBand.tsx`, `product-image.tsx` | — | — | regress risk | explicit dims + `priority` on first hero only | PARTIAL | P1 | M07 |

---
## 8. Media audit

### 8.0 Existing AWJ Decision — storage is settled

**[AWJ-Existing]** *Store Customizer media must reuse AWJ's approved official durable / R2-backed storage foundation* (`docs/storage.md`; `R2StorageService`; `ProductMedia`; category images; H4-8b signed workspace route). **Do not invent** a parallel object store, localStorage, a Base64-first new architecture, or a second storage service.

**Supersession (explicit).** The 2026-09-26 owner decision `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED` (`AWJ_STORE_BRANDING_MEDIA_OWNER_DECISION.md`) is **superseded** by the later Owner decision that official durable storage is approved. Its premise (the only file authority is the ephemeral `DocumentStorageService` disk) no longer holds for R2-backed domains. Consequences:

| Clause of the old decision | Status now |
|---|---|
| "Do not add a branding upload endpoint" | **Superseded** — Customizer media (including logos) uses the approved foundation |
| "Do not add a branding-only bucket or a second storage service" | **Retained and strengthened** — no parallel store of any kind |
| "Keep banner media on the https URL contract" | **Superseded** — picker/upload becomes primary; https URL kept only as a legacy/Advanced read path |
| "Do not rewrite existing presentation documents" | **Retained** — Base64 logos and https URLs keep rendering; migration is lazy on next save, never a bulk rewrite |
| "Do not enable `DOCUMENT_DURABLE_STORAGE_ENABLED` from Store Customizer" | **Retained** — the Customizer uses the **R2 domain**, not `DocumentStorageService` |

**What is still open (O2 only):** the *Customizer Media Contract details* — media ownership, metadata, usage references, delete policy, dimensions, variants, lifecycle (§8.2). Storage platform selection is **not** open.

### 8.1 Reuse map

| Need | Reuse | New |
|---|---|---|
| Bytes in R2, tenant prefix from `TenantContext` only | `R2StorageService::put/get/delete`, new **domain** `storefront-media` (key `tenant/{tid}/storefront-media/{media_id}/{uuid}.{ext}` passes the safe-segment regex) | none |
| Upload validation | `StoreProductMediaRequest` rules (5 MB, `jpg,jpeg,png,webp`) | decoded-dimension + pixel cap, magic-byte check; no SVG, no GIF/animated |
| Draft preview in Canvas | H4-8b signed workspace route (`temporarySignedRoute`, fresh tenant/channel re-check) | route variant for customizer media |
| Public delivery | `StorefrontMediaController` host-resolved pattern, indistinguishable 404 | **published-reference gate** (below) |
| RBAC | `commerce.manage` (as every presentation route) | none |
| Streaming | `ServesProductMediaBytes` trait | none |

### 8.2 Customizer Media Contract (sketch for O2 — not an authorisation)

| Aspect | Proposal |
|---|---|
| **Ownership** | Tenant-level library row `storefront_media` (one library serves all of a tenant's storefronts); `CompanyWide` under the branch-isolation guard; `uploaded_by`; RBAC `commerce.manage`. |
| **Metadata** | `original_name, mime, size, width, height, sha256 (dedupe), alt_ar, alt_en, dominant/average luminance (for overlay contrast), created_at`. Alt lives on the asset; per-usage override allowed. |
| **Reference in the document** | `{ mediaId, crop?, focal?, fit?, rotate?, alt? }` — opaque UUID + **non-destructive** edit parameters. Never a URL. Normalisers keep ids by shape; **publish** validates existence/tenancy and rejects or strips dangling ids; draft save stays tolerant. |
| **Original** | Never modified. Crop/rotate are parameters; "Reset to original" is always possible. |
| **Variants** | Server-derived WebP (and JPEG fallback) at fixed widths (e.g. 480/768/1280/1920) **after applying crop/rotate**, generated at upload or first publish; `width/height` stored for CLS-safe markup. Imaging capability is U4; strategy is O3. |
| **Limits** | 5 MB, `jpg/jpeg/png/webp`, max pixel count, min dimensions per usage (warn, not block, below recommended), per-tenant library quota (plan limit hook). |
| **Usage references** | Derived by scanning draft + **all versions** + published + scheduled presentation documents for the `mediaId`; also a small denormalised "published media ids" set maintained at publish time for the public gate. |
| **Delete policy** | Soft delete → **blocked with a usage list** when referenced; never "delete everywhere and substitute default" (Salla's behaviour, SAL-MEDIA) because AWJ has scheduled versions and Restore. Unreferenced assets are physically removed from R2 by a reconciler after a grace period. |
| **Public read gate** | Host-resolved route serves a media id **only if the resolved storefront's published config references it**, else uniform 404 — otherwise an unpublished campaign image would be world-readable by guessing ids. |
| **Lifecycle / R2** | Orphan reconciliation (see M13); original + variants share a prefix so deletion is one prefix-scoped operation per asset (no bucket listing); restore-safe (H5). |
| **Cache** | Content-hashed variant names → `Cache-Control: public, max-age=31536000, immutable`; workspace preview stays `private, max-age=600`. |
| **R2-only** | No `document`-disk fallback for this domain; if R2 is not configured the picker shows a capability-gated state (M12). |
| **Legacy** | Existing https `imageUrl` and Base64 logos render forever; UI offers the picker, "external URL" demoted to Advanced. |

### 8.3 Merchant UX (modelled on **[Salla]** SAL-MEDIA + **[Daftra]** DAF-GALADD, simplified)

`MediaPicker` (sheet on mobile, dialog/popover on desktop): **Upload** (drag-drop, multi-file, progress, per-file error) · **Library** (grid, search, newest first, "unused" filter). Selected media shows thumbnail, dimensions, **alt AR/EN**, **Edit (crop · focal · fit · rotate · reset)**, Replace, Remove, "Used in N places". Folders and assign-to-product (Salla) are not needed.

### 8.4 Audit answers (required checklist)

| Item | State |
|---|---|
| upload · drag-drop · choose existing · reuse · replace · remove | MISSING for Customizer (M01-M03) |
| safe deletion / usage awareness / lifecycle | MISSING (M04, M13) |
| alt text / SEO | PARTIAL (M05, M14) |
| file / MIME / size / dimensions | PARTIAL (M06) |
| optimisation / variants / thumbnails | MISSING (M07) |
| public delivery / caching | PARTIAL (M08) |
| Tenant Isolation / RBAC | proven for products; customizer contract missing (M09) |
| empty / loading / error | MISSING (M11) |

---

## 9. Global design audit

### 9.1 Principle

Global tokens set the brand; **sections may override a bounded, typed subset** (§13). Editor chrome never consumes merchant tokens (Roadmap §4 #1, unchanged).

### 9.2 Colour system (revises the earlier five-tone proposal)

**[AWJ-Proposal]** a **merchant palette with named roles**, edited with real colour controls:

| Role | Used for | Overridable at |
|---|---|---|
| `brand` (primary) | buttons, links, accents | global |
| `accent` (secondary) | highlights, badges | global |
| `surface` / `surfaceAlt` | page & section backgrounds | global, header, footer, section |
| `text` / `heading` | body & heading colour | global, section |
| `link` (+ hover) | inline links, footer links | global, header, footer |
| `border` | cards, dividers | global, section |
| `overlay` | media overlays | hero, banner, slider, footer, section background |

**Controls (`ColourField`)**: native colour picker · hex input (validated `#rrggbb`) · palette swatches (the roles above) · preset swatches (from the theme) · **recent colours** (per store, local, ≤8) · "suggest foreground" · live contrast badge for the role pair. Presets (`default/soft/brand/inverse/muted`) remain as one-click starting points — **not** the ceiling.

**Contrast policy (help, not restrict):** compute automatically against the effective background (for gradients: worst stop; for image+overlay: the server-sampled luminance blended with the overlay). Warn below 4.5:1 body / 3:1 large text and UI; **block save only when informative text falls below 3:1** and offer the nearest compliant foreground in one click; the merchant may override warnings, never blocks. Decorative text may be flagged `decorative` to opt out.

### 9.3 Gradients — evaluation

| Option | Evidence | Verdict |
|---|---|---|
| none / solid | baseline | **[HV]** |
| **Linear, 2 merchant colours, angle presets** (0/45/90/135/180/225/270/315) | zero image bytes, no CLS, one validated `linear-gradient()`; Salla documents bg colour or image only, Daftra nothing (so this is differentiation, not copying) | **[HV]** |
| Linear with a 3rd stop | adds a stop-position control + more contrast cases | **[LATER]** |
| Radial / conic | uncommon in commerce chrome; adds centre/shape controls | **[LATER]** |
| Free-form CSS gradient string | injection surface, unbounded contrast cases, cannot be validated by token | **[REJECT]** — security + unverifiable contrast |
| Animated / mesh gradients | continuous repaint cost, motion a11y, cannot be contrast-checked | **[REJECT]** |

### 9.4 Typography (expanded)

| Control | Proposal | Scope |
|---|---|---|
| Display/heading family | curated catalogue (≈6-10 Arabic+Latin pairs) | **[HV]** |
| Body family | separate slot from heading | **[HV]** (supersedes the narrow H3-2 single control — **O20**) |
| Heading scale / body scale | 3 steps each (S/M/L), applied globally; sections choose a size *step* | **[HV]** |
| Weight | 400/500/700/800 set, per role | **[HV]** |
| Line height | compact/normal/relaxed presets (Arabic needs generous values) | **[HV]** |
| Letter spacing | Latin display text only; never Arabic (breaks letter joining) | **[HV]** limited |
| Section-heading presentation | accent bar / plain / centred / underlined | **[HV]** |
| Button text | inherits scale step + weight | **[HV]** |
| Custom font upload | media contract + licensing + CSP + subsetting | **[LATER]** |
| Free px sizes / per-element fonts | unlimited combinations, breaks hierarchy and responsive rhythm | **[REJECT]** |

### 9.5 Buttons

Variants `solid · soft · outline · link`; sizes S/M/L; colour role; radius from global; hover treatment (darken/lift/underline); icon start/end using **logical** placement (mirrors in RTL). Global default style plus per-CTA override limited to variant + colour role, so buttons stay consistent while carrying brand expression. **[HV]** (earlier "defer" withdrawn.)

### 9.6 Borders, radius, shadows

Global tokens: radius (existing 3 + `pill`, `none`), border width (none/hairline/medium) and colour role, shadow (none/soft/medium/strong). Cards, header, footer, hero, banner and sections consume them; per-section override via capability flags (§13). **[HV]**

### 9.7 Other globals

Density (done), container width presets (**[DECISION]** O8), visitor dark/light switch (**[DECISION]** O8; per-surface inverse palettes are **[HV]**).

---

## 10. Header audit — a first-class design surface

**[AWJ-Existing]** `standard`/`compact`, show/hide search/account/cart/category-nav, logo + compact logo, ≤12 flat custom links, always-sticky, 54 px mobile grid. **[Salla]** sticky toggle, transparent header, dark bars, per-version menu assignment (SAL-DESIGN, SAL-THEME-PAGES, SAL-MENU).

| Capability | Proposal | Scope | Rows |
|---|---|---|---|
| Background colour / gradient, text & icon colour | palette roles + auto foreground | **[HV]** | HD04 |
| Opacity / transparency | alpha on background; optional backdrop blur later | **[HV]** (blur **[LATER]**) | HD04 |
| **Overlay-on-hero** | header transparent over hero/slider, **solid on scroll**; tone derived from hero overlay; auto-fallback to solid when the first section is not a media hero — *not cosmetic*: it decides legibility, the LCP image position and sticky behaviour | **[HV]** | HD11 |
| Sticky | `always ∣ on-scroll-up ∣ off` (+ shrink); coordinated with announcement bar | **[HV]** | HD07 |
| Height | compact/standard/tall + vertical padding | **[HV]** | HD10 |
| Logo size / alignment / treatment | size presets, start/center, original/mono | **[HV]** | HD03 |
| Search presentation | bar / icon-expand / hidden | **[HV]** | HD12 |
| Category-nav presentation | rail / tabs / hidden; mega menu later | **[HV]** / **[LATER]** | HD13, NV07 |
| Divider / border / shadow | tokens (G10) | **[HV]** | HD14 |
| Spacing | gap presets | **[HV]** | HD10 |
| Desktop/mobile layouts | ≥4 layouts + 2 mobile arrangements | **[HV]** | HD01 |

**Rule kept:** no visual option ships without Published parity — "transparent" is only offered when overlay-on-hero is implemented end-to-end.

---

## 11. Navigation audit

**[AWJ-Existing]** flat list, five link kinds, raw `href` entry, up/down reorder, https-only externals, 12-link cap; custom links not rendered on mobile (DEF-1). **[Salla]** menus: title, link type, target, optional icon, drag-drop, per-version assignment; header components support child items and **mega menus with product displays** (SAL-MENU, SAL-HDR). **[Daftra]** types Category/Link/Home/Product/Contact/Content Page; **up/down + drag**; **≤2 submenu levels** via drag or "↴" button (DAF-MENU, DAF-ORD).

| Capability | Scope | Notes |
|---|---|---|
| Fix mobile delivery of custom links | **V1A** | DEF-1; independent of the new design contract |
| Link pickers (category/product/content page) | **[HV]** | reuse existing picker patterns |
| One-level submenu | **[HV]** | desktop dropdown, mobile accordion; keyboard "make child" button (Daftra pattern) |
| Drag-and-drop (keep buttons) | **[HV]** | |
| Icons & text badges on items | **[HV]** | curated icon keys |
| Named menus assigned to header/footer/mobile | **[HV]** | feeds footer groups (F04) |
| Mega menu (+ category imagery) | **[LATER]** | evaluated, not omitted: needs category images (exist), product cards, a11y menu pattern, mobile fallback; own contract after nesting ships. Salla Twilight proves the pattern (SAL-HDR) |
| Second submenu level | **[LATER]** (via mega menu) | Daftra allows 2 levels; AWJ starts with 1 to keep mobile navigation simple |
| Label/menu overflow | **[HV]** | long AR/EN must wrap/truncate predictably |

---

## 12. Announcement bar audit — full decision

**Decision: BUILD** as first-class **global storefront chrome**, not a homepage section.

**[Salla]** SAL-PROMO: title, text, icon (picker), link (product/category/external/…), expiry, pages, theme version, background colour, text colour, "moving text" toggle; enable/disable, edit, delete; multiple announcements. SAL-ADV: `icon, url, target, description, bg_color, text_color` (ticker/dismiss undocumented).

| Aspect | AWJ Proposal | Differs from Salla because… |
|---|---|---|
| Model | `announcements[]` in the presentation document (≤5), each `{ id, text ≤120, icon? (curated key), href?, colours (palette roles or hex), startsAt?, endsAt?, pages[home∣product∣category∣all], motion static∣ticker, rotate? }` + master `enabled` | adds **start date** (Salla has expiry only) for Ramadan→Eid sequences; version scope is automatic (lives in the document) |
| Colours | full colour controls + gradient allowed; auto foreground & contrast gate | |
| Icon | curated icon set (same as Benefits/menu) | |
| Link | same safe-href rules as CTA | |
| Multiple | default = **first eligible** (enabled, in dates, matches page); optional **rotation** (fade/slide, 4-10 s, pause control, manual prev/next) | auto-rotation is opt-in and disabled under reduced-motion |
| Ticker | CSS marquee, speed presets slow/normal/fast, pauses on hover/focus + visible pause button, static under reduced-motion, direction follows `dir`, text always reachable by AT | |
| Timing | `startsAt/endsAt` evaluated server-side at render (U5: bounded by published-config cache TTL) | |
| Page targeting | home / product / category / all; **never checkout, cart, account** | protects conversion-critical flows |
| Sticky | optional; sticky bar sits above header, both collapse on scroll-down on mobile | stacked sticky bars would eat the mobile viewport |
| Dismissible | optional; per-visitor `localStorage` keyed by `announcementId + revision` (reappears when the text changes); no server state | |
| Desktop/mobile | one line on desktop; ≤2 lines on mobile then ellipsis; ≥44 px link target | |
| Accessibility | `region` landmark with label; **not** `role="alert"`; focus-visible; no colour-only meaning | |
| Parity | Canvas renders the same component; editor-only chip "scheduled/expired"; Published omits ineligible | |
| Backend | normalisers ×3 + fixtures; **no table, no migration** | |

Rows N01-N07 · independent of media → ships early (V3).

---

## 13. Homepage / sections audit — the Section Visual Contract

All 13 section types are LIVE with typed content (H4). None has design. **[AWJ-Proposal]** a shared **optional** `design` object whose fields are enabled **per section type through capability flags** — not every property on every section.

Shared vocabulary (each field optional; absent ⇒ today's rendering byte-for-byte):
`background` (`none ∣ solid ∣ gradient ∣ media+overlay`) · `width` (`contained ∣ wide ∣ full`) · `maxWidth` (presets) · `spacing` (padding top / bottom steps) · `align` (content) · `headingAlign` · `border` (width + colour role) · `radius` · `shadow` · `separator` (top/bottom) · `overflow` (declared per type) · `layout` (variant).

| Field | hero | banner | slider | gallery | categories | product sections¹ | benefits | customContent | appPromo | wholesale | announcement² |
|---|---|---|---|---|---|---|---|---|---|---|---|
| background solid/gradient | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| background media + overlay | ✔ | ✔ | ✔ | – | – | ✔ | ✔ | ✔ | ✔ | – | – |
| width / maxWidth | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a |
| spacing top/bottom | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a |
| content / heading align | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| border / radius / shadow | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| separator | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| overflow | fixed | fixed | fixed | fixed | rail∣grid | rail∣grid | – | – | – | – | – |
| layout variants | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | – | ✔ |
| title override / show-title | – | – | – | ✔ | ✔ | ✔ | ✔ | – | – | – | – |

¹ newArrivals, featured, offers, productShelf, discovery (colours/spacing/layout only; **price, discount, stock and offer status are never selectable**). ² global chrome, listed for symmetry.

**Rule:** `SECTION_CAPABILITIES` declares each type's allowed subset; the three normalisers drop anything else, so typed discipline and fail-closed behaviour from H4 are preserved while the storefront gains real expressiveness.

### 13.1 Separators / shapes — evaluation

| Option | Verdict |
|---|---|
| Divider line | **[HV]** |
| Spacing separator | **[HV]** (spacing steps) |
| Colour band | **[HV]** |
| Simple geometric (wave, angle, curve) | **[HV]** — inline SVG/CSS clip, `aria-hidden`, mirrored under RTL, height presets, colour role |
| Section overlap (negative margin) | **[DECISION]** — only for hero→next-section cards on ≥md with automatic fallback to none on mobile; risk of clipped focus rings and overlapping touch targets must be tested |
| Complex decorative shapes / patterns | **[REJECT]** for now — no evidence of merchant demand, each adds untestable responsive states and image bytes |

---

## 14. Hero / Banner audit — professional composition

| Capability | Hero | Banner | Scope |
|---|---|---|---|
| Content | headline, sub, **CTA label + href** (+ optional 2nd CTA **[DECISION]**) | title, sub, CTA, link, alt (exists) | **[HV]** |
| Media | image; background `solid∣gradient∣image` | image | **[HV]** |
| Overlay | colour (any), opacity 0-90 %, solid or gradient | same | **[HV]** |
| Text colours | heading, body | heading, body | **[HV]** |
| CTA style | variant + colour role (G17) | same | **[HV]** |
| Content width & position | narrow/standard/wide/full; 3×3 logical grid; align start/center/end | align, imagePosition | **[HV]** |
| Height | presets + min/max (bounded rem) | presets + ratio | **[HV]** |
| Aspect ratio | presets | presets | **[HV]** |
| Full-bleed / contained | ✔ | ✔ | **[HV]** |
| Radius / border / shadow | tokens | tokens | **[HV]** |
| Focal point / fit / crop | §14A | §14A | **[HV]** |
| Desktop vs mobile treatment | one document; optional **mobile media override** (§14B) | same | **[DECISION]** for override |
| Layout variants | text-over-image · split · centered statement · minimal band | card · full-bleed overlay · split · text-only band | **[HV]** |
| Hero content per-instance & deletable | O10 | n/a | **[DECISION]** |

### 14A. Image editing — options compared

| Option | Scope | Pros | Cons |
|---|---|---|---|
| **A — fit + focal point only** | `object-fit` + `object-position` | tiny; no variants needed; fully CSS | cannot change framing/ratio per usage; users re-upload to fix crops; poor result on ultra-wide banners |
| **B — lightweight crop + focal + fit + aspect presets (+ rotate 90°, zoom-in-crop, Reset to original)** | non-destructive parameters, server-derived variants | matches the real merchant job ("make this photo fit my banner"); evidence that Salla ships crop (+ more) for product images (SAL-IMG); originals never touched | needs a crop UI (touch + keyboard), variant pipeline (U4) |
| C — full image editor (filters, levels, resize, shapes) | Salla's product editor scope (SAL-IMG) | feature parity with Salla's *product* editor | Photoshop-class scope, inconsistent results, large a11y/touch surface; brand images arrive finished; no evidence merchants edit **storefront** media this way |

**Recommendation: Option B [HV]** (O21). Rotate/flip/zoom: rotate 90° and zoom-in-crop **[HV]**; **flip [REJECT]** (mirrors embedded text and logos, confuses RTL/LTR artwork, no use-case found); filters/levels/shapes **[REJECT]** (Option C scope; revisit with usage evidence). Aspect presets: 16:5, 3:1, 16:9, 4:3, 1:1, 4:5. **Reset to original** is always available.

### 14B. Responsive media — separate mobile image

A desktop landscape image frequently crops badly on a narrow phone. **Model under evaluation:** one default media + **optional mobile override**; alt, link and text are shared (same semantic content); *not* an independent mobile theme; applies to Hero, Banner and Slider slides; implemented with `<picture>`/`srcset` art direction. **Evidence:** neither Salla (SAL-HOME, SAL-ESL) nor Daftra documents a mobile-specific image upload in the pages read, so this is not benchmark-mandated; AWJ's own rule is "one responsive design document", which this respects. **Classification: PRODUCT DECISION REQUIRED (O9)** — recommendation: adopt, because focal point + crop alone cannot rescue a 3:1 banner on a 9:16 viewport.

---

## 15. Slider / carousel / gallery / motion audit

### 15.1 Slider — first-class **[HV]**

| Aspect | Proposal |
|---|---|
| Slides | 2-8; per slide: media (+ optional mobile override), heading, sub, CTA (variant/colour), overlay, text colour, alignment |
| Slider-level | height/ratio preset, full-bleed/contained, radius, layout (text-over-image / split) |
| Controls | arrows + dots (logical RTL), swipe/drag, keyboard, add/remove/duplicate/reorder (buttons + drag) |
| Motion | transition `slide ∣ fade ∣ none`, duration presets 300/500/800 ms |
| Autoplay | **opt-in** (default off); interval 4/6/8/10 s; visible pause control when on; pauses on hover/focus/touch; never under `prefers-reduced-motion` (O4) |
| Performance | first slide eager, others lazy with dimensions; Swiper loaded dynamically; ≤8 slides |
| Reuse | Swiper (already a dependency) with `dir` handling — RTL behaviour of the current product rail is unverified (U6) |

### 15.2 Gallery — classified individually

| Variant | Verdict | Reason |
|---|---|---|
| Grid (2/3/4/6 columns, ratio, gap) | **[HV]** | baseline; DOM order = reading order |
| Carousel | **[HV]** | shares the slider engine |
| Captions | **[HV]** | text; alt remains separate |
| Per-image link | **[HV]** | safe-href rules |
| Lightbox | **[HV]** opt-in | component exists (`MediaLightbox`, PDP); needs focus trap, Esc, arrow keys, RTL |
| Collage (fixed templates, CSS grid, DOM order preserved) | **[LATER]** | adds many layout states; ship after grid/carousel prove out |
| Masonry | **[DECISION]** (O27) | CSS-column masonry visually reorders content relative to DOM → breaks keyboard/screen-reader order and RTL flow; a grid-row-span "justified" layout that preserves DOM order may qualify |

### 15.3 Motion (professional, bounded)

**Allowed:** slider transitions, ticker, hover feedback (lift/zoom/underline), subtle once-only fade-up reveal (opt-in per section, ≤400 ms, never on the LCP element). **Tokens:** `instant 0 / fast 150 / base 300 / slow 500 ms` + two easings. **Always:** everything off under `prefers-reduced-motion`; no scroll-jacking, no parallax (**[REJECT]**: vestibular harm and scroll-performance cost, no benchmark need — Salla's "parallax background" is a developer theme feature, SAL-HP); no motion that blocks input. The *editor* stays restrained; this applies to the storefront.

---

## 16. Product sections / cards audit

Data and truth are complete (PS01, PS05, PS06). Presentation is code-fixed. **Add (all [HV]):** `layout grid∣rail`, `columns`, `count`, `imageRatio`, `imageFit`, section title/show-title, background/spacing/separator from §13.

**Card design contract (PC06)** — shared by product, category and marketing cards: radius, border, shadow, background role, padding step, content alignment, image ratio/fit, **badge position** (start-top / end-top / overlay-bottom), hover (none / lift / zoom / reveal-CTA), density. **Commerce firewall:** price, compare-at, discount, stock and offer-status *content* stay Commerce-driven; the Customizer chooses only **shape, colour role and position**. Quick-view / favourite toggles stay unexposed until each is real end-to-end (PC04).

## 17. Product page audit

Regions (9) with server-enforced fixed-required rules are complete (PP01). Presentation gaps: gallery placement variants (PP02, **[LATER]** pending evidence), `zoom` toggle (PP03, **[HV]**, Salla documents it — SAL-DESIGN), card/section styling reuse, buttons (G17). Related products stay **[LATER]** until Commerce provides a related-products source (PP04).

## 18. Category page audit

Regions (6) complete (CP01). **Highest-value fix:** render the category **cover** (CP02) — data exists since #1110 and the Home categories section already uses it, while `CategoryBanner.tsx` still documents "no image". Add an optional `cover` region shown only when the category has an image (never a placeholder); grid columns/card treatment reuse §16 presets (CP03). The stale comment itself is a V1A doc fix; the cover feature is V9.

## 19. Content pages / block editor audit

1. **Custom Content section** (homepage): heading + paragraph today. **[HV]** add `image` (needs M01), `button`, `divider`, `spacer`, quote/callout, and **2-column rows with a mandatory single-column mobile stack** (safe because stacking is fixed, not merchant-defined); ≤12 blocks; no HTML/JS/CSS.
2. **Content pages** (About/FAQ/…): Pages panel is honestly marked **GATED**, Published ignores `pages` (CC03). [Daftra] DAF-CP: create by name → drag-drop blocks → save. Separate backend decision; **[LATER]**, reusing the block set from (1) so the editor is built once (O15).

---

## 20. Footer audit — a full design surface

### 20.1 Content (global, mostly exists)

logo · tagline · **navigation groups** · contact · social · apps · legal/business identity · copyright · official badges/seals (CR/VAT/SBC marks remain official, non-editable presentation).

### 20.2 Design controls **[HV]**

| Group | Controls |
|---|---|
| Colour | background (solid/gradient/media), text, heading, link, **hover** colour, divider/border colour, opacity (technically meaningful for overlay-on-media footers); auto contrast with one-click fix |
| Media | background image + overlay colour/opacity, fixed-contrast text (F09) |
| Divider / border | top divider `none ∣ line ∣ wave ∣ angle ∣ curve`, border width/colour (F05, C05) |
| Spacing | padding top/bottom presets, column gap presets |
| Logo | size presets, original / monochrome-light / monochrome-dark treatment, alignment (F08) |
| Alignment & order | `start ∣ center ∣ end`, ordering of {brand, groups, contact, social, apps, identity} within the layout (F10) |

### 20.3 Layouts — six professional layouts, each with mobile + RTL defined

| Layout | Desktop | Mobile stacking | RTL |
|---|---|---|---|
| **Compact** | one row: logo · inline links · social · copyright | logo → links wrap → social → copyright; single column | order mirrors; logical alignment |
| **Columns** | brand block + up to 4 link groups + contact column | brand → groups as 2-col grid → contact → identity; groups collapse to accordions when >4 | column order mirrors; accordion chevrons flip |
| **Centered** | centred logo, tagline, link row, social row | already single column; link row wraps | symmetric |
| **Editorial** | large tagline/statement left, sparse link groups right, contact below | statement → groups (2-col) → contact | statement side mirrors |
| **Minimal** | single line: copyright + 3 links + social | wraps to two lines; social below | order mirrors |
| **Brand-heavy** | large logo + CTA band (newsletter/WhatsApp/app badges) above columns | band first, then columns collapse | band content mirrors |

Each layout is a typed variant over the same data; none duplicates content. **Footer backgrounds/dividers are no longer deferred.**

---

## 21. Theme gallery audit — complete visual systems

**[AWJ-Existing]** `/commerce/themes`: three runtime-backed themes; **Apply creates a new Draft Version** (preset + Flowers sections for the floral theme), rolls the version back on failure and opens it in the editor — already safer than Daftra's destructive Apply.

**[AWJ-Proposal]** A theme is a **`ThemeDefinition` = typed bundle over the HV contract**: palette · fonts & scales · spacing/density · header · footer layout · product-card style · button style · default section styles · hero composition · navigation layout · default section layouts (TG08). Flow stays non-destructive:

**Preview** (the theme over *the merchant's own data* in the Canvas, unsaved, Desktop/Mobile) → **Apply summary** ("creates a draft version · changes palette, fonts, header, footer, cards, buttons, section styles · keeps content, media, links, logos") → **new Draft Version** → recovery by switching back (H1). Theme-owned art ships as AWJ read-only media; applying copies **references** only and never touches merchant media (LC01). Catalogue ≈6-8 themes across verticals; Reset-design available per section and globally (W03). **[Salla]** Try/Preview before purchase (SAL-STORE); **[Daftra]** View Demo → Apply → confirm (DAF-TPL).

---

## 22. Inspector / Section Library / editing workflow

### 22.1 Inspector IA (progressive disclosure, no empty tabs)

| Section complexity | Inspector |
|---|---|
| Simple (wholesale, deliveryPromise, appPromo) | one compact panel: visibility → content |
| Rich (hero, banner, slider, gallery, benefits, customContent, product sections, announcement, header, footer) | **Content** · **Design** (colour, background, overlay, typography step, borders/shadow, separator) · **Layout** (variant, width, spacing, alignment, columns, height) |
| Advanced | shown **only** when it has real content (e.g. external image URL fallback, section label, per-section motion) |

Evaluated per section by complexity; no tab is rendered empty. Design groups are collapsible with "common first" (Tone/Background, Variant, Alignment).

### 22.2 Section Library

Search + 7 categories + honest states are complete. Add schematic thumbnails (SL02) and verify keyboard model (SL05). Recommended/recent stays **[REJECT]** for now — no usage data to rank by.

### 22.3 Reusable design / style workflow (evaluated, not omitted)

| Workflow | Verdict | Notes |
|---|---|---|
| Duplicate section **including design** | **[HV]** | deep-clone `content` + `design`; media refs shared, not copied (W01) |
| Copy / paste section **style** | **[HV]** | design-only clipboard between compatible types (W02) |
| Reset design to default (section, global) | **[HV]** | content untouched (W03) |
| Built-in reusable section presets per type | **[HV]** | shipped with themes |
| User "save section as preset/template" | **[LATER]** | store-level preset library (≤24); architecture ready because `design` is plain JSON |
| Duplicate/copy across pages | **[LATER]** | only Home has sections today; Product/Category use fixed regions (W05) |
| Rename section (editor-only label) | **[DECISION]** (O13) | recommended; never rendered |

### 22.4 Direct manipulation & actions

Click-to-edit for sections, header, footer, branding, WhatsApp, social, regions is complete. Add: hover label + selected-section action bar (move ↑↓, duplicate, hide, delete) — Salla's hover action bar (SAL-EDIT); drag reorder on top of buttons; delete confirmation only when a section has authored content; an Undo toast arrives with H5.

---
## 23. Desktop / Tablet / Mobile audit

Evidence: **prior** real-browser QA only (H4-8 rerun, AR/EN); **this pass ran no browser.**

| Width | Merchant UI evidence | Storefront evidence | Open items |
|---|---|---|---|
| 390 / 430 | preview-first, Bottom Sheet, no overflow (H4-8 §10) | no overflow | Header custom links absent (NV03); long AR/EN covered by `customizer-visual-verification/*` screenshots (not re-inspected here) |
| 768 | **Canvas only, no section-editing surface (R02)** | no overflow | tablet merchants cannot edit sections → **V1B** (decided with the new IA) |
| 1024 | builder header overflows when dirty (39 px, pre-existing, R03) | ok | **V1B** (toolbar may change with the new IA) |
| 1280 / 1440 | ok | ok | — |
| Canvas scaling | viewport simulated in JS (`viewport` prop), not CSS | CSS breakpoints | drift risk (PA-2) |

**Rule kept:** one design document; no per-device overrides (I05).

## 24. RTL / LTR audit

Builder and storefront verified AR+EN at six widths (H4-8). New work must specify: logical properties only (`ms/me/ps/pe`, `start/end`); arrows/chevrons mirrored (`rtl:rotate-180` pattern exists); slider swipe & arrow semantics follow `dir`; marquee direction follows `dir`; drag-drop with keyboard parity (up/down buttons stay); alignment control labels are **start/center/end** (not left/right), icons logical; announcement and hero text positions flip. Swiper RTL behaviour in `ProductCarousel` is unverified (U6).

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

**Additions for HV:** every Footer layout (§20.3), Header layout, Hero/Banner/Slider variant and Announcement ticker defines its own mobile stack and RTL mirroring before implementation; gradient angle presets are expressed as logical directions (`to end`, `to start`) so a 'left→right' gradient flips with `dir`; overlay-on-hero and sticky behaviours are verified in both directions; the crop UI is operable with keyboard (arrow keys nudge, +/- zoom) and in RTL.

### 27.2 Defect register (code-verified, not browser-verified) — with lane assignment

| ID | Defect | Evidence | Severity | Lane |
|---|---|---|---|---|
| DEF-1 | Custom header links never appear on mobile | `Header.tsx:171` (`hidden … lg:block`); `MobileMenu.tsx` has no link prop; `layout.tsx` passes `extraLinks` to Header only | High | **V1A** |
| DEF-2 | `accentColor` persisted but unused | §7 G03 | Medium | **V1B** (outcome depends on the palette model) |
| DEF-3a | `CategoryBanner.tsx` comment says the category resource "exposes no image" (stale since #1110) | `CategoryBanner.tsx:34-44` | Low | **V1A** (comment/doc only) |
| DEF-3b | Category page does not render the category image | same | Medium | **V9** (feature: optional `cover` region) |
| DEF-4 | Theme gallery "Preview" opens the live store, not the theme | `themes/page.tsx:205-218` | Medium (misleading) | **V1A** (honest label/behaviour; true preview is V10) |
| DEF-5 | Three max-size logos exceed `MAX_DOCUMENT_BYTES` (1.5 MiB) → save rejected; Base64 copied into every version | `PN:34-36`, `StorefrontPresentationService.php:553` | Medium | **V4** (needs media) |
| DEF-6 | Section delete is immediate even with authored content | `CP deleteSection` | Low | **V1B** (rule depends on IA + H5 undo toast) |
| DEF-7 | No section-editing surface at 768 px | H4-8 §10 | Medium | **V1B** |
| DEF-8 | Builder header overflows when draft is dirty at 768/1024 | H4-8 §10 | Low | **V1B** (toolbar may change with the new IA) |
| DEF-9 | `capabilities.ts` header comment says version history DEFERRED (stale since H1) | `capabilities.ts:9,30` | Low | **V1A** (doc/comment; the exported constant is read-only metadata — verify no consumer before touching) |
| DEF-10 | `HeroSection.tsx` prop doc says "AWJ exposes no hero contract today, so nothing supplies these yet" — the layout *does* pass `heroHeadline/heroSubheadline` | `HeroSection.tsx:11-12` vs `page.tsx:60,73` | Low | **V1A** (comment only) |

**Additional code-proven independent defects:** none beyond DEF-1/3a/4/9/10 were found during this revision (searched stale "STORE-UI-6" comments, hero/category/capability docs, nav delivery path).

---

## 28. Performance considerations

- **Document weight:** `JSON.stringify` ×2 per render for dirty-check with up to 1.5 MiB Base64 inside (`config.ts:605`, `EB:359`) — **not measured**, structurally wasteful; resolved by M10.
- **Images:** product proxy images render `unoptimized`; banner is a raw `<img>` without width/height/priority. Hero/slider imagery without variants would regress LCP/CLS/bandwidth.
- **Budget (proposed):** first hero/slide ≤150 KB WebP at mobile width, `fetchPriority=high` on **one** LCP image per page, all others lazy with explicit dimensions (CLS <0.1); slider ≤8 slides, Swiper dynamic; announcement is text-only.
- **Cheap vs expensive design:** gradients, colours, borders, shadows, separators (inline SVG/CSS) cost **zero network bytes** — they are the preferred route to visual variety; media-backed backgrounds cost variants + LCP risk and need the budget above. Backdrop blur, animated gradients and parallax are the costly ones (rejected/later).
- **Variants (O3, U4):** no resize library is referenced in `composer.json` (grep negative — confirm GD/Imagick on the Railway image). Options: server variants at upload (recommended), edge resizing (new infrastructure), or originals with caps (not for hero).
- **Canvas:** media list paginated (24) with thumbnails; picker state local to avoid whole-`ExperienceBuilder` rerenders (file is 3,365 lines); selecting/editing one section must not re-mount siblings; the crop UI works on a downscaled preview, not the original.
- **Document growth:** `design` objects add bytes per section; keep enum/preset values short, store only non-default fields, and keep `MAX_DOCUMENT_BYTES` headroom once logos leave the JSON.
- **SEO:** hero text stays real text, one `<h1>`, alt policy (M14/SE01), no text baked into images.

---

## 29. Proposed AWJ UX Contract (end-to-end merchant workflow)

| Moment | Contract |
|---|---|
| **Open** | Standalone workspace (exists): page selector, version name + state, Desktop/Tablet/Mobile, unsaved indicator. First paint = Canvas. |
| **Select** | Click any section/header/footer/announcement → outline + inspector; list in sync (exists). Hover label chip; selected shows a compact action bar (move ↑↓, duplicate, hide, delete). Links never navigate. |
| **Edit content** | Instant Canvas update; text commits on blur/debounce; links validated inline in plain language. |
| **Edit media** | Click image slot → MediaPicker (Upload ∣ Library) → drag-drop/choose → progress → auto-select → **Edit image** (crop · focal · fit · rotate · reset) → alt prompt (hint) → apply. Errors named (type/size/dimensions/offline/R2 unavailable). Optional mobile override (if O9 approved). |
| **Edit design** | Inspector → **Design**: background/colour, overlay, typography step, border/shadow, separator; **Layout**: variant, width, spacing, alignment. Common controls first; Advanced only if populated. Contrast feedback inline with one-click fix. |
| **Add section** | "+" → Library (search/categories/thumbnail/description) → Add → appended **and selected**; Canvas scrolls to it. |
| **Reorder** | Up/Down buttons (keyboard + touch) **and** drag; Canvas follows. |
| **Duplicate / hide / delete / copy style / reset design** | Same menu on list row and on-canvas bar. Delete confirms only with authored content. Undo toast arrives with H5. |
| **Preview** | Desktop/Tablet/Mobile (one document); tablet has an inspector; page navigator Home/Product/Category. |
| **Save** | Draft of the selected version only; conflict banner (exists). |
| **Publish** | Separate; shows what goes live; atomic; scheduling per H1; publish-time media validation. |
| **Theme apply** | Preview (merchant data) → Apply summary → new Draft Version → opens in editor. |

---

## 30. Proposed capability boundaries — creative freedom inside a safe typed design system

### 30.1 AWJ WILL build **[HV]** (storefront)

| Area | Vocabulary |
|---|---|
| **Colour** | merchant palette roles (brand, accent, surface, surfaceAlt, text, heading, link, border, overlay) via picker + hex + swatches + presets + recent colours; per-surface overrides (header, footer, section); automatic foreground + contrast calculation/warnings/limited blocks. Presets (`default/soft/brand/inverse/muted`) are conveniences, not limits. |
| **Backgrounds** | none · solid · **linear gradient (2 colours + angle presets)** · media with overlay |
| **Typography** | heading & body families (curated), 3-step scales, weight set, line-height presets, section-heading styles, button text |
| **Buttons** | solid / soft / outline / link × size × colour role × hover × icon placement |
| **Surfaces** | radius, border (width + colour), shadow, separators (line/band/wave/angle/curve), spacing & padding steps, width/maxWidth, content & heading alignment |
| **Layout variants** | per type: Hero ≥4, Banner ≥4, Slider ≥2, Gallery grid/carousel, Header ≥4, **Footer 6**, Cards, Benefits, Categories, Product sections grid/rail |
| **Media** | picker, library, alt AR/EN, crop + focal + fit + aspect + rotate + reset, optional mobile override (pending O9), variants |
| **Chrome** | announcement bar (ticker, rotation, sticky, dismissible, scheduling, targeting), header (transparency, overlay-on-hero, sticky, height), nested navigation, footer groups |
| **Motion** | bounded presets (§15.3) |
| **Workflow** | duplicate with design, copy/paste style, reset design, built-in section presets, theme bundles |

### 30.2 Guardrails (what they are for)

| Guardrail | Prevents | Must **not** prevent |
|---|---|---|
| Contrast engine (suggest → warn → block only <3:1 informative text) | unreadable text | any brand colour, dark or light, vivid or muted |
| Typed `design` + capability flags + fail-closed normalisers (PHP authority + 2 TS twins) | injected/unknown properties, document bloat | expressive combinations of valid values |
| Responsive-by-construction variants (defined mobile stack + RTL for each) | broken layouts at 390-1440 | layout variety |
| Safe URLs / sanitised media refs / R2-only media / reference-gated public reads | XSS, hotlink tracking, enumeration | merchant imagery |
| Commerce firewall | fake prices/discounts/stock/offers | card shape, colour, position |
| Reduced-motion + pause controls | vestibular/a11y harm | professional motion |
| Tenant isolation, host-resolved runtime, Draft/Published separation, revision concurrency, backward compatibility | data leaks, regressions | none |

### 30.3 AWJ will NOT build — each with a concrete reason

| Item | Reason |
|---|---|
| Arbitrary CSS/JS/HTML, custom code | breaks the typed-contract/security model; H6 owns any constrained custom CSS; Daftra itself warns template editing "requires … programming" (DAF-TPLEDIT) |
| Absolute positioning / free canvas | cannot guarantee responsive/RTL integrity; contradicts "one responsive document" |
| Free-form CSS gradient strings | injection surface; contrast cannot be computed |
| Animated/mesh gradients, parallax, scroll-jacking | repaint cost, vestibular harm, uncheckable contrast |
| Flip, filters, colour levels, shapes on images | Option C scope; no storefront use-case found; flip corrupts text/logos |
| SVG uploads, animated GIF uploads | script/XSS vector (SVG); motion/a11y/bandwidth (GIF) |
| Price/discount/stock/offer *content* design controls | commerce firewall |
| Per-element px sizes / unlimited per-section fonts | destroys hierarchy and responsive rhythm (bounded scales instead) |
| Editor chrome themed by merchant colours | Roadmap §4 #1 |
| Reviews/blog/FAQ elements with no data source | no fabricated data |

### 30.4 Hard invariants (unchanged)

Tenant isolation · host-resolved public runtime · Draft/Published separation · revision concurrency · fail-closed normalisation · backward compatibility (absent `design`/`announcements` ⇒ today's output byte-for-byte) · no fabricated commerce data · safe URLs · RBAC `commerce.manage` · one responsive document (mobile override changes *media*, not content).

---

## 31. Recommended Horizon structure — **Option A APPROVED (O18 closed)**

**Owner decision recorded:** a new Horizon **before** existing CUST-H5 — working name **CUST-HV — Visual Design, Media & Merchant UX Completion**. **H5/H6 are not renumbered**; Roadmap modification is a separate later action.

| Option | Verdict |
|---|---|
| **A. New Horizon before H5** | **Approved.** H5 snapshots a document shape that is stable only after HV; Restore needs media-usage safety first. |
| B. Extend H4 | Not selected — H4 is formally CLOSED; its scope is Section Library & Quality. |
| C. Renumber (H5=Visual…) | Not selected now — rewrites references; Owner may revisit when the Roadmap is updated. |
| D. H5 first | Not selected — H5 would be re-verified after every new field; Restore vs deleted media unresolved. |

## 32. Recommended implementation slices (inside CUST-HV)

Every slice begins with the **Implementation Evidence Gate** (§36A).

| Slice | Scope | Exit | Depends |
|---|---|---|---|
| **V0 — Decisions & contracts (docs)** | Close remaining O-items; ADR "Customizer media on R2" (O2 details); Section Visual Contract; Colour/Typography/Button/Motion tokens; Announcement contract; Footer/Header layout specs; Inspector IA incl. 768; golden fixtures; **baseline six-width browser evidence run** | Owner sign-off | — |
| **V1A — Independent defects (may start now)** | DEF-1 mobile custom links; DEF-4 honest Preview label/behaviour; DEF-9 + DEF-10 + DEF-3a comment/doc fixes. Each with tests; **no new visual architecture** | defects closed, CI green | none |
| **V1B — Contract-dependent UX defects (after V0)** | `accentColor` outcome (DEF-2); 768/tablet inspector (DEF-7); builder-header overflow (DEF-8); delete-confirmation rule (DEF-6) — all follow the V0 IA | closed together with V5 | V0, V5 |
| **V2 — Customizer Media Foundation (backend)** | `storefront_media` on R2 domain, upload/list/patch/delete+usage, soft-delete/reconciler, signed workspace read, reference-gated public read, publish validation, variants pipeline, tenancy/RBAC tests | isolation + lifecycle suites green | V0 |
| **V3 — Announcement bar** | contract ×3, Canvas + Published, ticker/rotation/sticky/dismiss, scheduling, targeting, a11y, parity | parity + a11y checks | V0 |
| **V4 — MediaPicker, image editor, logos** | shared picker; crop/focal/fit/rotate/reset; mobile override (if O9); logos/favicon → refs (lazy migration; fixes DEF-5) | states table §26 | V2 |
| **V5 — Section Design Contract + Inspector IA + ColourField** | `design` per type with capability flags, palette roles, gradients, buttons, borders/shadows, separators, normalisers ×3, Content/Design/Layout inspector, copy/paste style, reset design | back-compat proof | V0 |
| **V6 — Hero & Banner v2** | per-instance hero (O10), CTA, media, overlay, variants, ratios, mobile override | parity per variant; LCP budget | V2, V4, V5 |
| **V7 — Header / Footer / Navigation** | header colours/transparency/overlay-on-hero/sticky/height; 6 footer layouts + groups + media; nav pickers, one-level children, drag, icons; Canvas fixtures removed | parity + mobile nav | V5 (and V6 for overlay-on-hero) |
| **V8 — Slider, Gallery, Motion** | slider, gallery grid/carousel/lightbox, motion tokens, RTL/reduced-motion | a11y + RTL checks | V2, V4, V5 |
| **V9 — Cards, product/category presentation, content blocks, benefits** | card contract, grid/rail presets, category cover, benefits icons/columns, customContent blocks incl. 2-col rows, product `zoom` | commerce-firewall tests | V4, V5 |
| **V10 — Theme gallery v2 & workflow polish** | `ThemeDefinition` bundles, true Preview, Apply summary, built-in section presets, Library thumbnails, hover action bar, drag reorder | DoD run | V5-V9 |
| **V11 — Verification & closure** | 6 widths × AR/EN, long content, AT pass, parity harness, perf, closure report | Horizon DoD (§36) | all |

## 33. Dependencies

```
V1A (independent defects) ─────────────────────────────────────────► can ship before/alongside V0
V0 ─┬─► V2 (media) ─► V4 (picker/editor/logos) ─┬─► V6 (hero/banner) ─┐
    │                                           ├─► V8 (slider/gallery)├─► V10 ─► V11
    ├─► V3 (announcement) ──────────────────────┤                      │
    └─► V5 (design contract/IA) ─┬─► V7 (chrome/nav) ───────────────────┘
                                 ├─► V9 (cards/category/blocks)
                                 └─► V1B (accent, 768 inspector, header overflow, delete rule)
```
External: R2 configured in Production (U1) · imaging capability (U4) · CSP position (U3) · remaining Owner decisions (§35). **H5 depends on V2/V5 being stable** (Restore ↔ media references; Undo ↔ design JSON).

## 34. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Production R2 flags off ⇒ media on ephemeral disk | R2-only domain; gated state; U1 before V2 merge |
| R2 | Public media enumerable before publish | reference-gated public route; uniform 404 |
| R3 | Deleting used media breaks scheduled/old versions | block-with-usage; soft-delete; publish validation |
| R4 | Parity drift ×3 normalisers as the contract grows | golden fixtures + generated resolver + parity test |
| R5 | LCP/CLS regression from media | variants, dimensions, single priority image, budgets; prefer CSS-only visuals |
| R6 | **State explosion** from freer design (variants × colours × breakpoints) | typed capability flags; variants defined with mobile+RTL; snapshot matrix per variant |
| R7 | Contrast failures from free colours | auto-foreground, warn/block policy, theme-safe defaults |
| R8 | Motion/a11y harm | defaults off, pause, reduced-motion |
| R9 | Backward compatibility | absent `design` ⇒ identical output; fixtures from existing documents |
| R10 | Base64 → media migration touching live documents | lazy, read-compatible, no bulk rewrite |
| R11 | Hotlinked https banner images track visitors/break (no CSP found) | demote external URL to Advanced; CSP review (U3) |
| R12 | Cached published config vs time-based expiry | document TTL bound (U5) |
| R13 | Document size growth (`design` ×30 sections) | store non-default fields only; headroom after logos leave JSON |
| R14 | Crop/variant pipeline cost & failure modes | async-safe generation, fallback to original with cap, clear error states |
| R15 | Theme bundles overwrite merchant intent | Apply = new Draft Version + summary; never touches content/media/links |

---

## 35. Product decisions

### 35.1 Closed

| # | Decision | Status |
|---|---|---|
| O1 | Storage platform / supersession of the "keep embedded" decision | **CLOSED** (Existing AWJ Decision, §4.5/§8.0) |
| O17 | Inspector: progressive Content/Design/Layout (+Advanced if real) | **CLOSED** (Owner direction) |
| O18 | Horizon structure | **CLOSED — Option A** |
| O19 | Defect lane | **CLOSED — split into V1A / V1B** |

### 35.2 Remaining Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| **O2** | Customizer Media Contract **details only**: ownership, metadata, usage refs, delete policy, dimensions, variants, lifecycle, library quota (§8.2) | Approve §8.2 as the V0 starting point |
| **O3** | Variant strategy: server WebP variants vs edge resizing vs originals | Server variants |
| **O4** | Slider autoplay policy | Opt-in, default off, pausable |
| **O5** | Announcement: ticker, rotation, sticky, dismissible (all proposed in) | Approve all four, defaults off |
| **O6** | `accentColor` → becomes a first-class palette role (V1B) | Adopt |
| **O7** | Button variant set solid/soft/outline/link | Approve (now in HV) |
| **O8** | Global content-width presets; visitor-facing light/dark switch | Width presets yes; visitor switch later |
| **O9** | Optional mobile media override (Hero, Banner, Slider) | **Adopt** (PRODUCT DECISION REQUIRED per Owner) |
| **O10** | Hero content per-instance and hero deletable | Yes |
| **O11** | Per-banner expiry | Yes (shares announcement logic) |
| **O12** | Navigation nesting: 1 level in HV, mega menu later | Approve |
| **O13** | Editor-only section label | Yes |
| **O14** | Any new commerce-displaying option (sort, price hierarchy) | No |
| **O15** | Content-page authoring as a later horizon reusing the block set | Yes |
| **O16** | Curated icon set (~24 keys) | Approve |
| **O20** | Supersede CUST-H3-2's single typography control with heading+body families and scales | Yes |
| **O21** | Image editing = Option B (crop + focal + fit + aspect + rotate + reset) | Yes |
| **O22** | Gradient scope: 2-colour linear + angle presets in HV; 3-stop/radial later | Yes |
| **O23** | Section overlap (negative margin) allowed on ≥md only | Decide in V0 after prototype |
| **O24** | User-saved section presets timing | After built-ins |
| **O25** | Mega menu timing | After nesting ships |
| **O26** | Custom font upload timing | Late HV or follow-up |
| **O27** | Gallery masonry/collage | Collage later; masonry only if DOM-order-preserving |

---

## 36. Proposed Definition of Done (for CUST-HV)

- [ ] V0 decisions recorded; ADRs merged; Roadmap update proposed separately.
- [ ] **Implementation Evidence Gate (§36A) completed for every slice.**
- [ ] Every visual control has Canvas ↔ saved Draft ↔ Published parity test; no Canvas-only styling.
- [ ] Backward compatibility: a pre-HV document renders byte-identically (golden fixtures).
- [ ] Tenant isolation tests for media (upload, signed read, public read, delete, usage, foreign ids, unpublished ids) and R2 lifecycle (orphan reconciler, soft-delete, restore safety).
- [ ] R2 configuration verified in Production **before** enabling uploads.
- [ ] Real-browser matrix **390, 430, 768, 1024, 1280, 1440 × AR/EN**, long Arabic/English, editor and storefront; 768 has an inspector; every Footer/Header/Hero/Banner/Slider variant checked at mobile + RTL.
- [ ] Keyboard-only pass and **screen-reader pass (NVDA + VoiceOver)** recorded.
- [ ] Reduced-motion verified for slider/ticker/reveal/hover; contrast engine verified for every colour control incl. gradients and overlays.
- [ ] LCP/CLS budgets met on Home with hero + slider on throttled mobile; SEO checks (alt, one `<h1>`, dimensions).
- [ ] No fake capability: every visible control changes Published output; unsupported = gated state.
- [ ] Commerce firewall tests: no design field can alter price/discount/stock/offer status.
- [ ] Undo/Redo-compat review: document remains plain immutable JSON; Restore re-validates media refs.
- [ ] Full suites + build + CI green; implementation report with Base/Head SHA; Owner merge approval; closure report.

## 36A. Implementation Evidence Gate (applies to every later slice — not a one-time exercise)

Before a slice's UX contract is finalised, it must record, in its own evidence section:

1. **Salla** — inspect the *current* official docs relevant to the slice (help centre + Twilight) and cite them.
2. **Daftra** — inspect the *current* official docs relevant to the slice and cite them.
3. For each benchmark behaviour state **what AWJ adopts**, **what AWJ changes**, **what AWJ rejects and why**.
4. Record anything undocumented as *undocumented*, never as absent.

Pre-seeded starting sources (re-fetch when the slice starts — pages change):

| Slice | Salla starting points | Daftra starting points |
|---|---|---|
| V2/V4 media | media library (SAL-MEDIA), product images & editor (SAL-IMG), identity (SAL-IDENT) | gallery, product & category images (DAF-GAL, DAF-PIMG, DAF-CIMG) |
| V3 announcement | promotional bar article (SAL-PROMO), Advertisement component (SAL-ADV) | — (record "none found" if still true) |
| V5/V6 design & hero/banner | homepage elements incl. Enhanced Banner, Slider (SAL-HOME), design options (SAL-DESIGN) | template editing (DAF-TPLEDIT) |
| V7 chrome & nav | header/footer theme guides, menus (SAL-THEME-PAGES, SAL-MENU, SAL-HDR) | menu items & ordering (DAF-MENU, DAF-ORD) |
| V8 slider/gallery | Photos Slider, Enhanced Slider, Card Gallery (SAL-HOME, SAL-ESL) | gallery manager (DAF-GAL, DAF-GALADD) |
| V9 cards/blocks | Twilight product card, Features Grid/FAQ elements | content page designer (DAF-CP, DAF-CPE) |
| V10 themes/workflow | theme store, theme versions, interactive editor (SAL-STORE, SAL-THEMES, SAL-EDIT) | template apply (DAF-TPL) |

---

## 37. Scope classification ledger (replaces "Items intentionally deferred")

Every item previously deferred or prohibited is re-classified. **IN** = in this Horizon · **LATER** = later horizon · **DECISION** = product decision required · **REJECT** = intentionally rejected.

| # | Item | Earlier stance | Now | Evidence / reason |
|---|---|---|---|---|
| L01 | Crop editor | deferred | **IN** (Option B) | Salla ships crop (+more) for product images (SAL-IMG); needed to frame banners; §14A |
| L02 | Focal point | proposed | **IN** | prevents mobile mis-framing |
| L03 | Full image editor / filters / levels / shapes | — | **REJECT** | Photoshop-class scope, no storefront use-case evidence |
| L04 | Flip | — | **REJECT** | mirrors text/logos, RTL/LTR artwork confusion |
| L05 | Rotate 90°, zoom-in-crop, aspect presets, reset | — | **IN** | part of Option B |
| L06 | Separate mobile media | deferred | **DECISION** (O9, recommend adopt) | art-direction need; not documented by Salla/Daftra; respects one-document rule |
| L07 | Gradients (2-colour linear, angle presets) | rejected | **IN** | zero bytes, boundable, contrast-checkable |
| L08 | 3-stop / radial gradients | rejected | **LATER** | extra controls, no demand evidence |
| L09 | Free-form gradient string; animated/mesh gradients | rejected | **REJECT** | injection; repaint cost; unverifiable contrast |
| L10 | Merchant colour palette & real colour picker | limited to 5 tones | **IN** | Owner direction; Salla exposes bg/text colours (SAL-HOME) |
| L11 | Button styles | deferred | **IN** | brand expression with consistency |
| L12 | Borders / shadows | deferred | **IN** | tokens, cheap |
| L13 | Heading/body families & scales | one control | **IN** (O20) | professional typography; bounded scales |
| L14 | Custom font upload | gated | **LATER** | storage no longer blocks; licensing/CSP/subsetting remain; Salla supports it (SAL-IDENT) |
| L15 | Free px sizes / per-element fonts | — | **REJECT** | hierarchy and responsive rhythm |
| L16 | Container width presets | decision | **DECISION** (O8) | |
| L17 | Visitor dark/light switch | decision | **DECISION** (O8); per-surface inverse palettes **IN** | doubles every palette role |
| L18 | Footer backgrounds, dividers, spacing, layouts | deferred | **IN** | Owner: full design surface |
| L19 | Header transparency / overlay-on-hero | cosmetic? | **IN** | decides legibility/LCP/sticky |
| L20 | Header sticky control | decision | **IN** (behaviour modes) | Salla documents sticky toggle (SAL-DESIGN) |
| L21 | Section separators (line/band/geometric) | rejected | **IN** | SVG/CSS, a11y-hidden |
| L22 | Section overlap | rejected | **DECISION** (O23) | focus-ring clipping, mobile fallback |
| L23 | Complex decorative shapes/patterns | rejected | **REJECT** | no demand evidence; untestable states |
| L24 | Slider (first-class) | proposed | **IN** | |
| L25 | Slider autoplay | decision | **IN** opt-in (O4) | |
| L26 | Gallery grid / carousel / captions / links | proposed | **IN** | |
| L27 | Gallery lightbox | rejected | **IN** opt-in | component exists |
| L28 | Gallery collage | rejected | **LATER** | after grid/carousel |
| L29 | Gallery masonry | rejected | **DECISION** (O27) | DOM-order/a11y; only order-preserving variant |
| L30 | Announcement ticker / rotation / sticky / dismissible | decision | **IN** (O5) | Salla documents moving text (SAL-PROMO) |
| L31 | Nested menu (1 level) | decision | **IN** (O12) | Daftra ≤2 levels (DAF-ORD) |
| L32 | Mega menu | not analysed | **LATER** | Salla Twilight supports (SAL-HDR); needs own contract |
| L33 | Menu icons / badges | — | **IN** | Salla optional icon (SAL-MENU) |
| L34 | Drag-and-drop ordering | P3 | **IN** | keep buttons as a11y path |
| L35 | Secondary CTA | rejected | **DECISION** | model `ctas[≤2]` now |
| L36 | Per-banner expiry | deferred | **DECISION** (O11) | Salla optional expiry (SAL-HOME) |
| L37 | Section rename/label | decision | **DECISION** (O13) | Salla Rename (SAL-HOME) |
| L38 | Section anchor id | rejected | **LATER** | low value until pickers/anchors exist |
| L39 | Copy/paste style, reset design, duplicate-with-design | — | **IN** | workflow |
| L40 | User-saved section presets | — | **LATER** | built-ins first |
| L41 | Cross-page section copy | — | **LATER** | sections exist on Home only |
| L42 | Content blocks: image, button, divider, spacer, callout, 2-col rows | partial | **IN** | mandatory single-col mobile stack |
| L43 | Content-page authoring backend | gated | **LATER** | needs backend; reuse block set |
| L44 | Video / YouTube embeds, video backgrounds | rejected | **LATER** | CSP/privacy/LCP/mobile data; Salla supports YouTube (SAL-HOME) |
| L45 | Parallax / scroll-jacking | rejected | **REJECT** | vestibular harm, scroll cost |
| L46 | Subtle reveal motion | — | **IN** opt-in | once, ≤400 ms, never on LCP element |
| L47 | Countdown timers | — | **DECISION** | could imply false urgency unless bound to a real Offer end date |
| L48 | SVG uploads | rejected | **REJECT** | script vector |
| L49 | Animated GIF uploads | — | **REJECT** | motion/a11y/bandwidth (Salla allows GIF for products, SAL-IMG) |
| L50 | Related products | deferred | **LATER** | needs Commerce source |
| L51 | Quick view / favourite toggles | deferred | **LATER** | until each is real end-to-end |
| L52 | Price/discount/stock design | — | **REJECT** | commerce firewall |
| L53 | Custom CSS/JS/HTML | H6 | **LATER (H6) / REJECT for HV** | security model |
| L54 | Absolute positioning | rejected | **REJECT** | responsive/RTL integrity |
| L55 | Recommended/recent Section Library items | rejected | **REJECT** (for now) | no usage data |
| L56 | Reviews / blog / FAQ elements | — | **LATER** | no data source today |
| L57 | Undo/Redo | H5 | **LATER (H5)** | HV keeps JSON undo-friendly |

---

## 38. Final recommendation

1. **Proceed with CUST-HV (Option A, approved)** — V0 first; **V1A may start immediately** (four code/doc fixes, no new architecture).
2. **Media:** implement the Customizer media contract (O2 details) on the existing R2 foundation; no parallel store; verify Production R2 flags (U1) first.
3. **Ship the Announcement bar early (V3)**; it needs no media.
4. **Introduce the Section Visual Contract + palette + Inspector IA (V5) before any per-surface visual work**, so Hero/Banner/Header/Footer/Slider all land on one vocabulary and one parity harness.
5. Treat guardrails as help, not restriction: the success test is that two merchants' stores look genuinely different while remaining readable, responsive and safe.
6. Hold **H5** until V2/V5 are merged and stable.

---

## 39. No-Miss check (expanded second pass)

"Covered in" points to the section/row; items not recommended say why.

| Item | Covered in | Recommendation / why not |
|---|---|---|
| Colours | §9.2, G04, G18 | roles + picker/hex/swatches/recents **[HV]** |
| Gradients | §9.3, G15 | 2-colour linear **[HV]**; free-form/animated **[REJECT]** |
| Typography | §9.4, G05-G06, G16 | bounded scales **[HV]** |
| Spacing | §13, C01 | padding steps **[HV]** |
| Backgrounds | §13, C06, F09 | solid/gradient/media **[HV]** |
| Imagery | §8, §14 | picker/library **[HV]** |
| Crop / focal | §14A, I02-I08 | Option B **[HV]**; flip/filters **[REJECT]** |
| Responsive media | §14B, I05, S07 | mobile override **[DECISION]** O9 |
| Borders / radius / shadows | §9.6, G10, C07 | tokens **[HV]** |
| Separators | §13.1, C05 | line/band/wave/angle/curve **[HV]**; overlap **[DECISION]** |
| Header | §10, HD* | first-class **[HV]** |
| Footer | §20, F* | full design surface **[HV]** |
| Navigation | §11, NV* | nesting **[HV]**, mega **[LATER]** |
| Announcement | §12, N* | **[HV]** |
| Hero / Banner | §14, H*, B* | **[HV]** |
| Slider | §15.1, S01-S02, S06-S07 | **[HV]** |
| Gallery | §15.2, S03, S05, S08-S09 | grid/carousel/lightbox **[HV]**, collage **[LATER]**, masonry **[DECISION]** |
| Product sections | §16, PS*, S04 | presets **[HV]** |
| Cards | §16, PC06, G11 | **[HV]** |
| Category presentation | §18, CT*, CP* | cover **[HV]** (V9) |
| Product page | §17, PP* | zoom **[HV]**; layout variants/related **[LATER]** |
| Content blocks | §19, CC* | **[HV]**; page authoring **[LATER]** |
| Theme Gallery | §21, TG* | complete systems **[HV]** |
| Section Library | §22.2, SL* | thumbnails **[HV]**; recents **[REJECT]** (no data) |
| Inspector | §22.1, IN01 | Content/Design/Layout (+Advanced if real) |
| Direct manipulation | §22.4, DM* | action bar **[HV]** |
| Drag/drop | EA03, NV05 | **[HV]** with button fallback |
| Duplicate / hide / delete | EA*, W01 | duplicate-with-design **[HV]**; delete-confirm rule V1B |
| Reusable styles / presets | §22.3, W02-W05 | copy-style **[HV]**; user presets **[LATER]** |
| Mobile / Tablet | §23, R02 | 768 inspector V1B |
| RTL / LTR | §24 | per-variant specs required |
| Accessibility | §25, A02 | AT pass in DoD |
| Motion / reduced motion | §15.3, MO01-02 | bounded **[HV]** |
| Performance | §28, PF* | budgets; CSS-first visuals |
| SEO impact of media | M14, SE01, §28 | alt/dimensions/h1 policy **[HV]** |
| Canvas / Draft / Published parity | §27 | harness + fixtures |
| Backward compatibility | §30.4, DoD | byte-identical when absent |
| Tenant isolation | §8.2, DoD | reference-gated public reads |
| R2 lifecycle | M12-M13, §8.2 | soft-delete + reconciler |
| Media deletion / reference safety | M04, M13 | block-with-usage |
| Theme application / recovery | TG03, TG06, LC01 | new Draft Version, switch back |
| Future Undo/Redo compatibility | UR01 | plain JSON, refs by id |
| Salla / Daftra evidence | §3, §5-6, §36A | mandatory per slice |

**Gaps in this pass:** no live browser, no AT, Production flags unknown, Daftra block palette unknown, Salla undo/mobile specifics undocumented in pages read.

**Unknowns:** U1 Production values of `PRODUCT_MEDIA_R2_ENABLED` / `CATEGORY_MEDIA_R2_ENABLED` (render.yaml stale vs Railway) · U2 Daftra drag-drop element palette · U3 CSP at the edge (none in `next.config.ts`/`proxy.ts`/`vercel.json`) · U4 GD/Imagick availability · U5 published-config cache vs time-based expiry · U6 Swiper RTL in `ProductCarousel` · U7 screen-reader behaviour · U8 hero Canvas↔Published visual equivalence not re-run.

---

## 40. Final execution report

| Item | Value |
|---|---|
| Reviewed | Customizer UI, presentation contract (PHP + 2 TS twins), published renderers, media/storage stack, theme gallery, roadmap/H4 closure/QA reports |
| External official docs inspected | Salla ≈19 pages (help centre + Twilight, incl. product image editor), Daftra 10 tutorials |
| Master Gap Matrix rows | **189** |
| — COMPLETE | **30** |
| — PARTIAL | **36** |
| — MISSING | **94** |
| — INTENTIONALLY_DEFERRED | **12** |
| — PRODUCT_DECISION_REQUIRED | **13** |
| — BACKEND_GATED | **4** |
| Scope ledger | 57 items (§37): IN / LATER / DECISION / REJECT |
| Defect register | 11 entries (DEF-1…10 with 3a/3b) — lanes V1A/V1B/V4/V9 |
| Owner decisions | 4 closed; 23 remaining (§35) |
| Horizon | **CUST-HV — Option A approved**, slices V0, V1A, V1B, V2-V11 |
| Base SHA | `a5a3479e09c3e60a32287e9f1d46e5c2fa236633` |
| PR / Branch | #1230 · `docs/store-customizer-visual-ux-master-gap` |
| Pre-revision Head SHA | `66e134afa1316ff1af5c9d8309e5ef7a37086cb1` |
| Code changes / Merge / Deploy | **NONE / NONE / NONE** |

---

## 41. Revision log (Owner revision pass, 2026-10-04)

| Section | Change |
|---|---|
| Header, §1, §2 | Metadata updated (PR #1230, pre-revision head); product direction (two design systems); exact media wording; decisions closed |
| §3.2, §5 | Added SAL-IMG (Salla product image editor, alt ≤70) and mega-menu evidence |
| §4.5 | Storage supersession recorded as an Existing AWJ Decision |
| §7 | Matrix rewritten for colour, gradients, typography, buttons, borders/shadows, crop, mobile media, hero/banner, slider/gallery, announcement, header, navigation, footer (6 layouts), section contract, separators, cards, theme systems, workflow, motion, SEO, lifecycle, undo compatibility |
| §8 | Media audit re-based on settled storage; contract details; lifecycle; supersession table |
| §9-§16, §19-§22 | Expanded per Owner items 5-24 |
| §14A-B | Crop options A/B/C compared; responsive media evaluated |
| §27.2 | Defects re-laned V1A/V1B; DEF-10 added |
| §30 | Rewritten: creative freedom inside a safe typed system; guardrails vs non-restrictions |
| §31-§33 | Option A approved; V1 split; dependency graph updated |
| §35 | Closed/remaining decisions separated |
| §36, §36A | DoD expanded; Implementation Evidence Gate added |
| §37 | Replaced by 57-item scope classification ledger |
| §39-§40 | Expanded no-miss audit; counts recomputed |
