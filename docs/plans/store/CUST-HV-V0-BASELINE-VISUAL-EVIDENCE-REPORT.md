# CUST-HV V0 — Baseline Visual Evidence Report

**Type:** Evidence only (no product code touched, no issue fixed).
**Base SHA:** `5fd6e596c2217e5b524744a24156db615a9933a7` (`origin/main`, PR #1230 merged)
**Captured:** 2026-10-04 / 2026-10-05 · **Browser:** Playwright + pre-installed Chromium 147 (headless, real clicks)
**Parent contract:** `docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md`
**Screenshots / raw data:** `docs/plans/store/cust-hv-v0-baseline/` (JPEG q55; `baseline-builder.json`, `baseline-published-and-themes.json`)

---

## 1. Method and environment

| Item | Value |
|---|---|
| Stack | **Real**: Laravel (`php artisan serve`, SQLite, :8000) · `web/` (`next dev`, :3000) · `storefront/` (`next dev`, :3001). No fixtures or mocks for the builder or storefront runs. |
| Harness | Reused the committed H4-8 real-stack harness (`scripts/qa/h4-8/`: `reset.sh`, `seed.php`, `lib.mjs`) for DB reset, seed and login helpers. The V0 capture scripts were throw-away probes kept outside the repository (V0 is docs-only); their method is described here. |
| Data | Seeded merchant tenant (`qa-owner@h48.test`), storefront A. One **published** version (*Baseline V0c*) with visible: Hero (custom headline/sub), Categories, New Arrivals, Wholesale, **Banner** (title/sub/CTA, no image), **Featured** (2 products), **Benefits** (2 items), **Custom Content** (heading + paragraph), App Promo; footer tagline/copyright/contact/social; one custom header link ("روابط مخصصة"). A **draft copy** (*Baseline draft*) is what the builder opened (a published version is read-only, so click-to-edit needs a draft). |
| Widths | 390 · 430 · 768 · 1024 · 1280 · 1440 |
| Locales | Builder: Arabic RTL and English LTR (UI locale cookie). Published storefront: Arabic at all six widths; English route at 390/1440 — **resolves Arabic/RTL because the seeded tenant has no English storefront content** (pre-existing, recorded in H4-8 §17). English-LTR *storefront* chrome is therefore **not** baselined. |
| Measured per run | document horizontal overflow · toolbar geometry (items outside the viewport) · Canvas section inventory · click-to-edit result on the Banner section · header/footer chrome selection · Theme Gallery card count and Preview link target · published heading order, header height, custom-link visibility |
| Not covered | Screen-reader behaviour · long-text stress (see the existing `customizer-visual-verification/` set) · Canvas footer screenshots at every width (the Canvas scroll container did not scroll in the capture; header/footer were evidenced via chrome-selection screenshots instead) · mobile-menu *contents* (the menu sheet did not open under automation; the mobile custom-link claim is therefore evidenced by the header's visible links plus code reading) · dev-mode (`next dev`) performance numbers are not representative and are not reported |

---

## 2. Reachability

| Surface | Result |
|---|---|
| Login → `/commerce/appearance` | Reachable at all 12 width × locale combinations; `[data-experience-builder]` mounts, Canvas renders |
| `/commerce/appearance?version=<draft>` | Reachable; opens the chosen version |
| `/commerce/themes` | Reachable at all widths (AR 6, EN 2); 3 theme cards |
| Published storefront (host-resolved `a.h48.test`) | Reachable at all widths; no document overflow |

---

## 3. Customizer (builder) baseline

Document-level overflow was **0 px in all 12 runs**. The findings below are about *where controls sit*, not page scroll.

| Locale | Width | Doc overflow | Toolbar scrollWidth / clientWidth | Toolbar items outside viewport | Inspector surface | Click Banner on Canvas → inspector |
|---|---|---|---|---|---|---|
| AR | 390 | 0 | 432 / 390 | نشر | bottom sheet (dialog) | `banner` · tabs=0 |
| AR | 430 | 0 | 449 / 430 | نشر | bottom sheet (dialog) | `banner` · tabs=0 |
| AR | 768 | 0 | 839 / 768 | حفظ المسودة, نشر | **none visible** (aside+nav `display:none`, Canvas full width) | `banner` · tabs=0 |
| AR | 1024 | 0 | 1116 / 1024 | نشر, جدولة | side panel (3-column) | `banner` · tabs=0 |
| AR | 1280 | 0 | 1280 / 1280 | — | side panel (3-column) | `banner` · tabs=0 |
| AR | 1440 | 0 | 1440 / 1440 | — | side panel (3-column) | `banner` · tabs=0 |
| EN | 390 | 0 | 476 / 390 | Save draft, Publish | bottom sheet (dialog) | `banner` · tabs=0 |
| EN | 430 | 0 | 495 / 430 | Publish | bottom sheet (dialog) | `banner` · tabs=0 |
| EN | 768 | 0 | 964 / 768 | Mobile, Save draft, Publish | **none visible** (aside+nav `display:none`, Canvas full width) | `banner` · tabs=0 |
| EN | 1024 | 0 | 1271 / 1024 | Save draft, Publish, Schedule | side panel (3-column) | `banner` · tabs=0 |
| EN | 1280 | 0 | 1320 / 1280 | Schedule | side panel (3-column) | `banner` · tabs=0 |
| EN | 1440 | 0 | 1440 / 1440 | — | side panel (3-column) | `banner` · tabs=0 |

**Reading the table**

- **Click-to-edit works at every width** (Banner → Banner settings). The inspector is a **flat panel** with **no tabs** (`role="tab"` count 0): visibility switch, Title, Text, Button text, Button link, Image URL (https), Image alt, then the page's section list.
- **768 px has no visible editing surface** at all: the section inspector exists in the DOM but both the navigation rail and the inspector aside are `display:none`; only the Canvas is shown. (Confirms DEF-7 in a real browser.)
- **At 1024 px the Canvas is only ~486 px wide** (nav rail 196 + inspector 300); 1280 px gives ~698 px.
- **Toolbar items are positioned outside the viewport** whenever the toolbar content is wider than the screen (see §3.1).

### 3.1 Primary-action reachability (Arabic, clean state, Publish button probed by exact label)

| Width | Publish button x-range (viewport 0…W) | `scrollIntoView` brings it into the viewport |
|---|---|---|
| 390 | −42 … −6 (fully off-screen) | **No** |
| 430 | −19 … 18 (partly off-screen) | **No** |
| 768 | −71 … −27 (fully off-screen) | **No** |
| 1024 | −23 … 20 (partly off-screen) | Yes (after scrolling) |
| 1280 | 88 … 131 | n/a (visible) |

In Arabic the toolbar is wider than the viewport up to 1024 px and the overflow falls off the **left** edge, which a browser cannot scroll to. English (LTR) loses the **right-hand** actions (390: Save draft + Publish; 768: Mobile + Save draft + Publish; 1024: Save draft + Publish + Schedule; 1280: Schedule). Publish remains reachable through the version popover ("Publish now"), but the primary toolbar action is not. This **contradicts the Roadmap H0 closure gate** ("no clipped toolbar actions") and is **broader than** the dirty-state 39 px overflow recorded in H4-8 §10 — it occurs in the **clean** state. → **BL-1**.

### 3.2 Chrome selection (Arabic)

| Width | Header click | Footer click |
|---|---|---|
| 390 | opens *Header & navigation* sheet | probe invalid (the Header sheet was still open and intercepted the click) |
| 768 / 1440 | inspector title *الرأس والتنقل* — fields: header style, show search / account / cart / category nav, links | inspector title *التذييل* — fields: show logo, tagline, copyright (**only three**) |

### 3.3 Canvas section inventory (all widths and locales)
`hero, categories, newArrivals, wholesale, banner, featured, benefits, appPromo, customContent` — identical at every width and locale (one document, as designed).

---

## 4. Theme Gallery

| Locale | Widths | Cards | Doc overflow | "Preview" link target |
|---|---|---|---|---|
| AR | 390, 430, 768, 1024, 1280, 1440 | 3 | 0 | `https://a.h48.test/` (**the live store**, not the theme) |
| EN | 390, 1440 | 3 | 0 | `https://a.h48.test/` (**the live store**, not the theme) |

Three runtime-backed themes (AWJ Modern, AWJ Market, AWJ Bloom) as wireframe cards (Use theme / Customize / "معاينة المتجر"). The preview link opens the **live storefront**, so a merchant cannot see a theme before applying it (DEF-4 confirmed). At 1440 the grid is two columns with an orphan third card. Applying was not exercised (it would mutate the seeded store); its behaviour is documented from code in the contract.

---

## 5. Published storefront baseline (Arabic)

| Width | Doc overflow | `dir` | `<h1>` | Header height | Custom header link visible | Footer |
|---|---|---|---|---|---|---|
| 390 | 0 | rtl | متجر نبراس للقرطاسية | 113 px | **NO** | yes |
| 430 | 0 | rtl | متجر نبراس للقرطاسية | 113 px | **NO** | yes |
| 768 | 0 | rtl | متجر نبراس للقرطاسية | 133 px | **NO** | yes |
| 1024 | 0 | rtl | متجر نبراس للقرطاسية | 133 px | **yes** | yes |
| 1280 | 0 | rtl | متجر نبراس للقرطاسية | 133 px | **yes** | yes |
| 1440 | 0 | rtl | متجر نبراس للقرطاسية | 133 px | **yes** | yes |

- Section/heading order (all widths): أحدث المنتجات → تخفيضات الخريف → مختارات المتجر → مزايا المتجر → عن متجرنا → معلومات المنشأة → التواصل. The storefront renders every configured section; the Hero is the only `<h1>`.
- **DEF-1 confirmed in a real browser:** the custom link "روابط مخصصة" is in the DOM at every width but **not visible below 1024 px** (390, 430, 768) — hidden by `hidden … lg:block`; nowhere else on the page exposes it. (The mobile-menu sheet could not be opened under automation, so its contents are asserted from code: `MobileMenu` receives no custom links.) → **BL-2**.
- The English route (390 / 1440) renders Arabic/RTL — seed limitation, not a regression.
- The Hero is the plain primary-colour gradient with a fixed "تسوّق الآن" CTA at all widths; the Banner is the text card with no image (no image is configured — the current contract only allows a pasted https URL).

---

## 6. Baseline findings register (recorded, **not fixed**)

| ID | Finding | Evidence | Severity | Proposed lane |
|---|---|---|---|---|
| **BL-1** | Builder toolbar actions (Publish; Save draft; Schedule; Mobile) sit outside the viewport in the **clean** state: AR ≤ 1024 px, EN ≤ 1280 px; Publish unreachable by scrolling in AR at 390/430/768 | §3 table, §3.1 | **High** (primary action; violates the H0 gate) | V1B (toolbar IA); **Owner may promote to V1A** — the fix (overflow menu / responsive toolbar) needs no new visual architecture |
| **BL-2** | Custom header links not visible < 1024 px (= DEF-1) | §5 | High | V1A |
| **BL-3** | No visible section-editing surface at 768 px (= DEF-7) | §3 table | Medium | V1B |
| **BL-4** | At 1024 px the Canvas is ~486 px wide (3-column layout) | §3 | Low–Medium | V1B (IA) |
| **BL-5** | Theme "Preview" opens the live store (= DEF-4) | §4 | Medium | V1A |
| **BL-6** | Inspector is flat with no tabs; Banner/Hero expose content fields only (no design, no media upload; image is a URL text box) | §3 | — (baseline for V5/V6) | V5/V6 |
| **BL-7** | Footer inspector exposes only 3 fields; Header inspector exposes style + 4 toggles + links | §3.2 | — (baseline for V7) | V7 |
| **BL-8** | Hero is a fixed gradient with a fixed CTA at every width | §5 | — (baseline for V6) | V6 |
| **BL-9** | English storefront chrome cannot be baselined (seed has no English content) | §5 | Info | V11 must seed EN content |

None of these were changed in V0. BL-2/3/5 duplicate DEF-1/7/4 of the Master Gap §27.2; **BL-1 is new** and is registered in the contract as **DEF-11**.

---

## 7. Screenshot index (`cust-hv-v0-baseline/`)

- `builder-{ar,en}-{390,430,768,1024,1280,1440}-banner-selected.jpg` — builder after clicking the Banner on the Canvas (toolbar, Canvas, inspector/sheet).
- `builder-ar-{390,768,1440}-{header,footer}-selected.jpg` — header / footer chrome selected.
- `themes-ar-{390,430,768,1024,1280,1440}.jpg`, `themes-en-{390,1440}.jpg` — Theme Gallery.
- `published-ar-{390,430,768,1024,1280,1440}-{top,full}.jpg`, `published-en-{390,1440}-full.jpg` — published storefront (viewport top + full page).
- `baseline-builder.json`, `baseline-published-and-themes.json` — raw measurements.
