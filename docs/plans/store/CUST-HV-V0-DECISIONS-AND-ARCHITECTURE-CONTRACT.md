# CUST-HV V0 — Decisions & Architecture Contracts

**Horizon:** CUST-HV — Visual Design, Media & Merchant UX Completion (runs **before** CUST-H5; H4 stays CLOSED)
**Slice:** V0 — Decisions & Contracts (documentation / architecture only)
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `5fd6e596c2217e5b524744a24156db615a9933a7` (`origin/main`; PR #1230 merged)
**Authority chain:** `AWJ_STORE_CUSTOMIZER_VISUAL_UX_COMPLETION_MASTER_GAP.md` (approved evidence + proposals) → **this document** (frozen contracts for V1+) → slice implementation reports.
**Companion:** `CUST-HV-V0-BASELINE-VISUAL-EVIDENCE-REPORT.md` (browser baseline) · Roadmap section "HORIZON CUST-HV" in `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md`.
**Status:** Proposed for Owner review (docs-only PR). Nothing here authorises merge, deploy or Production change. **No application code is changed.**

> Labels: **[AWJ-Existing]** approved/current · **[Salla]** / **[Daftra]** official-doc evidence · **[AWJ-Contract]** frozen by this document · **[Owner-Decision]** still needs Safwan.
> **FROZEN** = binding for V1+ slices; changing it needs an Owner-approved amendment.

---

## 0. Purpose and scope

V0 turns the Owner's decisions on the Master Gap into **implementable contracts** so that V1–V11 can be built without re-deciding architecture. It:

1. records the Owner decisions (§1);
2. fixes the cross-cutting invariants and rollout rules (§2);
3. defines the typed **Section Visual Contract** and the shared token systems (§3-§6);
4. defines the **media**, **Hero/Banner**, **Header**, **Footer**, **navigation**, **announcement**, **slider/gallery**, **card**, **content-block**, **theme**, **workflow** and **inspector** contracts (§7-§18);
5. fixes slice scope, order, dependencies and gates (§19-§20);
6. records the external evidence gate (§21) and the V0 checks performed (§22).

Out of scope for V0: any implementation of V1A…V11, any content-page backend, any Production flag change.

---

## 1. Decision register

### 1.1 Frozen decisions

| ID | Master-Gap ref | Decision | State | Contract |
|---|---|---|---|---|
| D-01 | O1 | **Storage architecture is CLOSED.** Customizer media reuses AWJ's approved official durable/R2-backed foundation. No parallel store, no localStorage, no Base64-first architecture, no second storage service. The 2026-09-26 `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED` decision is **superseded** (§7.1). | FROZEN | §7 |
| D-02 | O2 | **Customizer Media Contract approved**: tenant-scoped, `commerce.manage`, metadata, dimensions, alt text, usage references, safe-delete, soft-delete + orphan reconciliation, publish-time reference validation, public access only when referenced by Published state, signed/private workspace reads, no path/disk leakage. | FROZEN | §7 |
| D-03 | O3 | **Server-generated modern variants**: WebP (JPEG fallback), a practical width ladder, original retained where required, explicit width/height. No external image platform unless evidence proves the server path unsuitable. | FROZEN (library choice → V2 evidence, N-1) | §7.5 |
| D-04 | O21 | **Image editing = bounded Option B**: crop, focal point, fit, aspect presets, rotate, zoom-in-crop, reset-to-original. **No** filters, colour correction, Photoshop-style editing or arbitrary transforms. | FROZEN | §7.6 |
| D-05 | O9 | **Optional mobile-image override** for Hero, Banner, Slider. One responsive document stays authoritative; art direction, not a mobile theme. | FROZEN | §7.7 |
| D-06 | O6 | `accentColor` becomes a **real first-class palette role**. | FROZEN | §4 |
| D-07 | O22 | Backgrounds: **solid** and **two-colour linear gradient with bounded angle presets**. Radial, three-stop, animated/mesh **deferred**; no free-form CSS gradient strings. | FROZEN | §4.4 |
| D-08 | Contrast | Contract: (1) attempt automatic accessible foreground first; (2) normal text ≥ **4.5:1**; (3) large text and applicable non-text UI may use **3:1** where the standard allows; (4) **3:1 is never sufficient for normal body text**; (5) publishing informative text/UI below its applicable threshold is **prevented until resolved**; (6) a merchant's chosen background colour is **never prohibited** merely because an automatic foreground can solve the pairing. | FROZEN | §4.5 |
| D-09 | O20 | Typography expands from one control to bounded: heading family, body family, heading scale, body scale, weights, line-height presets, section-heading style, button text treatment. No unlimited per-element typography. | FROZEN | §5 |
| D-10 | O26 | **Custom fonts are deferred** to late CUST-HV or an immediate follow-up, gated on proven media foundation, CSP, licensing, and format/subsetting/performance policy — but **represented in the architecture** (reserved `fontFamily` kind + media domain). | FROZEN (deferral) | §5.4 |
| D-11 | O7 | Buttons: **solid · soft · outline · link/text** with bounded size, radius, colour role, hover state, optional icon placement. Typed surface controls: border, border colour, radius, shadow, spacing, section padding, separator. No arbitrary CSS. | FROZEN | §6 |
| D-12 | O8 | **Bounded content-width presets.** **No** visitor-facing global dark/light switch in this Horizon. Dark/inverse merchant surfaces remain allowed per Header/Footer/section. | FROZEN | §6.3 |
| D-13 | O23 | **Section overlap** only as bounded, responsive-safe presets; no raw negative-margin input; fallback to none on narrow screens; focus rings visible; no clipping of interactive content. | FROZEN (geometry finalised at V5/V6 with visual evidence, N-4) | §6.5 |
| D-14 | O10 | **Hero is per-instance content** and follows normal section capability rules (addable/removable). Hard-invariant analysis in §8.1 found **no** architectural reason to keep an immutable singleton. | FROZEN | §8.1 |
| D-15 | O11 | **Optional Banner start/end window** reusing the existing UTC-instant window semantics and the shared `@/lib/timezone` helpers used by Version scheduling and Offers; **no second scheduler** (a passive visibility predicate evaluated at request time). Evidence in §8.4 shows Version scheduling is *not* a substitute, so the stop-condition in the brief is **not** triggered. | FROZEN | §8.4 |
| D-16 | O4 | Slider autoplay: **off by default**, opt-in, interval ≥ 5 s, pause control, pause on interaction/hover, disabled by `prefers-reduced-motion`; manual navigation and swipe always work. | FROZEN | §13.1 |
| D-17 | O5 | Announcement bar: multiple items, optional ticker, rotation, sticky, dismissible, scheduling, page targeting, colour/design controls, links/icons, RTL, reduced motion; conservative/off defaults; dismissal persistence defined without cross-tenant/user leakage. | FROZEN | §12 |
| D-18 | O12 / O25 | **One nested submenu level** in CUST-HV with drag/reorder, keyboard alternative, typed internal destinations, safe externals, desktop/mobile parity, RTL. **Mega menu is LATER**, and the schema must not preclude it. | FROZEN | §11 |
| D-19 | O13 | **Merchant-facing internal section labels** — editor metadata only, never public unless explicitly mapped to content. | FROZEN | §17.1 |
| D-20 | O14 | **Commerce firewall**: no design control may fabricate or override price, sale price, discount, stock, offer truth, availability, tax or checkout amounts. | FROZEN | §14 |
| D-21 | O15 | Content-page authoring is a **LATER** horizon; CUST-HV defines/reuses a shared bounded **block vocabulary** so pages need no second editor. | FROZEN | §15 |
| D-22 | O16 | **Curated icon registry** (bounded, extensible without schema break; no SVG upload). | FROZEN | §11.4 |
| D-23 | O24 | Built-in section/style presets belong to CUST-HV; user-saved presets come after, architecture must not prevent them. | FROZEN | §17 |
| D-24 | O27 | Gallery: grid, carousel, optional lightbox now; collage later; masonry only if DOM-order-preserving and accessible. | FROZEN | §13.2 |
| D-25 | IA | Inspector: progressive disclosure; rich sections **Content / Design / Layout** (+ **Advanced** only with real fields); simple sections compact; mobile/tablet usable; **768 px gets a real editing surface**. | FROZEN | §18 |
| D-26 | Footer | Footer is a **first-class design surface** with content, design and six layouts. | FROZEN | §10 |
| D-27 | Header | Header contract incl. transparent mode and overlay-on-Hero legibility. | FROZEN | §9 |
| D-28 | Section Visual Contract | Typed capability groups, per-type exposure, **absent design ⇒ current output** (non-negotiable). | FROZEN | §3 |
| D-29 | Motion | Bounded motion tokens; restraint by default; reduced motion; no parallax / scroll-jacking; no harmful animation on LCP content. | FROZEN | §6.6 |
| D-30 | Theme | Themes are complete visual systems; apply = Preview → Apply summary → **new Draft Version**; never overwrites Published. | FROZEN | §16 |
| D-31 | O18 | **Option A**: CUST-HV inserted before H5; H5/H6 not renumbered. | FROZEN | Roadmap |
| D-32 | O19 | Defect lanes split V1A / V1B. | FROZEN | §20 |

### 1.2 Decisions that could not be safely frozen (and why)

| ID | Item | Why not frozen | Handling |
|---|---|---|---|
| N-1 | **Imaging capability / library** for variants and crop rendering (U4) | No imaging library is referenced in `composer.json`; the Railway PHP image's GD/Imagick availability is unverifiable from the repo | Contract fixes *what* (server-generated WebP + JPEG fallback, width ladder). V2's Evidence Gate must verify GD/Imagick and memory limits. If the server path is unsuitable → **STOP and return to Owner** (no external platform without evidence) |
| N-2 | Production values of `PRODUCT_MEDIA_R2_ENABLED` / `CATEGORY_MEDIA_R2_ENABLED` / R2 credentials (U1) | Not readable from the repo | **Operational go-live prerequisite**, not a decision (§7.1). Customizer media is R2-only and fail-closed |
| N-3 | **DEF-11** (builder toolbar actions off-screen in the clean state — new in V0 baseline) lane | Fix is independent of new visual architecture (suggests V1A) but touches toolbar IA also reshaped by the 768 editing surface (suggests V1B) | Registered as V1B by default; **Owner may promote to V1A** (§20) |
| N-4 | Exact **overlap preset geometry** (O23) | Needs a visual prototype to prove focus-ring/clipping safety | Preset *mechanism* frozen; numeric geometry finalised in V5/V6 with six-width evidence |
| N-5 | **Font catalogue** (which pairs) | Licensing and subsetting need slice-time verification | Rules frozen: self-hosted, OFL-class licences only, ≥ 6 pairs, Arabic+Latin, `font-display: swap`, subset |
| N-6 | Variant **numeric ladder** and quality | Needs measurement on real images | Ladder frozen as 480/768/1280/1920 (+160/320 thumbnails); quality tuned in V2 |

All other Owner decisions were frozen as given; **no contradiction with repository evidence** was found that would force a deviation.

---

## 2. Global invariants and rollout rules

### 2.1 Invariants (nothing in CUST-HV may weaken these)

Tenant Isolation · Storefront Isolation · host-resolved Published runtime · Draft/Published separation · Version semantics (H1) · revision concurrency · backward compatibility · RBAC (`commerce.manage` for every presentation/media write) · fail-closed normalisation · safe URLs · commerce truth · accounting/financial authority (`LedgerService`, `InvoiceService`, cart/checkout pricing are never touched).

### 2.2 Compatibility rules for every contract below

1. **Additive and optional.** New keys are optional; an absent key renders **exactly** today's output (golden fixtures from existing documents are the proof). `PRESENTATION_CONFIG_VERSION` stays `3` for additive keys (CONTRACT-2 / H4 precedent); a version bump is only for a reinterpretation or removal, and requires Owner sign-off.
2. **Rollout order is fixed: PHP normalizer → storefront renderer → web builder.** The version service already rejects documents from a *newer* schema when dispatching scheduled publishes (`OUTCOME_FORWARD_SCHEMA_REJECTED`); the PHP authority must accept a key before any UI can send it, and the renderer must tolerate a key before the builder can write it.
3. **Three normalizers stay in lock-step** (PHP authority + `web` twin + `storefront` twin). Each new field ships with: a golden fixture in `tests/Fixtures/presentation/`, PHP tests, both TS suites, and a Canvas ↔ Published parity assertion.
4. **Normalisation is fail-closed:** unknown keys dropped; enums outside the set → key removed (not defaulted to a visible value); hex colours must match `^#[0-9a-fA-F]{6}$`; ids match `^[a-zA-Z0-9_-]{1,64}$`; strings are length-capped in **Unicode code points**; arrays are capped; the document cap (`MAX_DOCUMENT_BYTES` 1.5 MiB) is unchanged.
5. **Size discipline:** only non-default values are stored; per-section `design` ≤ 2 KB serialised; total sections still ≤ 30.
6. **No computed commerce or media bytes in the document.** Media is referenced by id; prices, discounts, stock, availability are never persisted in presentation JSON (unchanged H4 rule).
7. **Editor chrome never consumes merchant tokens** (Roadmap §4 #1).

---

## 3. Contract A — Section Visual Contract (typed design architecture)

### 3.1 Principles

- **Typed capability groups, not a style bag.** A section's `design` object may contain only the groups its type declares. Unknown groups/keys are dropped by all three normalizers.
- **Each group is small, enumerated, and renderer-resolved.** The renderer maps a group to class names and CSS custom properties through one pure function; no arbitrary CSS strings ever reach the DOM.
- **Absent ⇒ legacy.** A section with no `design` renders byte-identically to the pre-HV output.
- **One document, all breakpoints.** The only per-breakpoint inputs are the *media override* (§7.7) and responsive presets that resolve differently by breakpoint inside the renderer (e.g. spacing steps), never merchant-authored per-device styles.

### 3.2 Primitive types (shared by all groups)

```ts
type Hex = `#${string}`;                       // ^#[0-9a-fA-F]{6}$
type PaletteRole = 'brand'|'accent'|'surface'|'surfaceAlt'|'text'|'heading'|'link'|'border'|'overlay';
type ColorRef = { role: PaletteRole } | { hex: Hex };
type Alpha = 0|5|10|15|20|25|30|35|40|45|50|55|60|65|70|75|80|85|90|95|100;
type Step = 'none'|'xs'|'sm'|'md'|'lg'|'xl';   // spacing / padding steps (resolved per breakpoint)
type Direction = 'to-end'|'to-start'|'to-bottom'|'to-top'
               |'to-bottom-end'|'to-bottom-start'|'to-top-end'|'to-top-start'; // logical, mirrors in RTL
type MediaRef = { mediaId: string; fit?: 'cover'|'contain'; focal?: { x: number; y: number };   // 0-100
                  crop?: CropParams; rotate?: 0|90|180|270; alt?: string };
type CropParams = { x: number; y: number; w: number; h: number; aspect: AspectKey; zoom?: number }; // normalised 0-1
type AspectKey = '16:5'|'3:1'|'16:9'|'4:3'|'1:1'|'4:5'|'free-locked';
type Gradient = { kind: 'gradient'; from: ColorRef; to: ColorRef; direction: Direction };   // two colours, bounded direction
```

### 3.3 Groups

```ts
interface SectionDesign {
  background?:
    | { kind: 'solid'; color: ColorRef }
    | { kind: 'gradient'; from: ColorRef; to: ColorRef; direction: Direction }
    | { kind: 'media'; media: MediaRef; mobile?: MediaRef; overlay?: Overlay };
  text?:        { heading?: ColorRef; body?: ColorRef; link?: ColorRef; align?: 'start'|'center'|'end' };
  typography?:  { headingScale?: 'sm'|'md'|'lg'|'xl'; bodyScale?: 'sm'|'md'|'lg';
                  headingWeight?: 400|500|700|800; lineHeight?: 'tight'|'normal'|'relaxed';
                  headingStyle?: 'bar'|'plain'|'centered'|'underline' };
  width?:       { mode: 'contained'|'wide'|'full'; max?: 'narrow'|'standard'|'wide' };
  spacing?:     { top?: Step; bottom?: Step; inner?: Step };           // section padding
  align?:       'start'|'center'|'end';                                // content block alignment
  layout?:      string;                                               // variant key, per type (§3.4)
  border?:      { width: 'none'|'hairline'|'medium'; color?: ColorRef };
  radius?:      'none'|'sm'|'md'|'lg'|'pill';
  shadow?:      'none'|'soft'|'medium'|'strong';
  separator?:   { top?: SeparatorKind; bottom?: SeparatorKind; color?: ColorRef; height?: 'sm'|'md'|'lg' };
  overlap?:     'none'|'sm'|'md';                                      // §6.5, hero→next only
  mediaTreatment?: { aspect?: AspectKey; fit?: 'cover'|'contain'; height?: 'compact'|'standard'|'tall'|'screen' };
  motion?:      { reveal?: 'none'|'fade-up' };                         // §6.6
}
type Overlay = { color: ColorRef; alpha: Alpha };                      // bg overlay, ≤ 90
type SeparatorKind = 'none'|'line'|'band'|'wave'|'angle'|'curve';
```

### 3.4 Per-type capability registry (authoritative)

`SECTION_CAPABILITIES[type].design` declares the allowed groups and variants. A section never exposes a group it cannot render.

| Type | Allowed groups | `layout` variants |
|---|---|---|
| `hero` | background (solid/gradient/media), text, typography, width, spacing, align, border, radius, shadow, separator, overlap, mediaTreatment, motion | `text-over-image` · `split` · `centered` · `minimal` |
| `banner` | background, text, typography, width, spacing, align, border, radius, shadow, separator, mediaTreatment, motion | `card` · `full-bleed` · `split` · `text-band` |
| `slider` (new) | background (solid/gradient), text, width, spacing, radius, border, shadow, mediaTreatment, motion | `text-over-image` · `split` |
| `gallery` (new) | background, spacing, width, radius, border, shadow, separator, mediaTreatment | `grid` · `carousel` |
| `categories` | background, text (heading), typography(headingStyle), spacing, width, border, radius, separator, layout | `grid` · `rail` · `circle-grid` |
| `newArrivals`, `featured`, `offers`, `productShelf` | background, text (heading), typography(headingStyle), spacing, width, separator, layout (+ card tokens §14) | `grid` · `rail` |
| `discovery` | background, text (heading), spacing, separator | `tiles` · `chips` (existing) |
| `benefits` | background, text, typography, spacing, align, border, radius, shadow, separator, layout | `flat` · `cards` · `columns-2/3/4` |
| `customContent` | background, text, typography, width(max), spacing, align, separator | — |
| `appPromo` | background, text, spacing, border, radius, separator, layout | `band` · `card` |
| `deliveryPromise`, `wholesale` | background, spacing, separator | — |

Rules: `separator`, `overlap` and `motion.reveal` are *section-edge* properties and are only meaningful on the types listed; `radius/border/shadow` fall back to the global surface tokens (§6.2) when absent.

### 3.5 Resolution and rendering

- One pure resolver per runtime (`resolveSectionDesign(type, design, ctx) → { className, style, dataAttrs }`), generated from a single source file and diff-checked in CI so the web Canvas and the storefront cannot drift.
- `style` may contain **only** CSS custom properties whose values come from validated tokens (`--sec-bg`, `--sec-fg`, `--sec-pad-top`, …); no `style` string from the document is ever interpolated.
- `dataAttrs` (`data-design-layout`, `data-design-tone`, …) are emitted on every section root so parity tests compare structure, not pixels.

### 3.6 Required tests per field (V5 onward)

Golden fixture round-trip · PHP/TS normalizer parity · "absent ⇒ unchanged" snapshot · Canvas ↔ Published attribute parity · contrast engine cases (§4.5) · six-width/RTL visual evidence for each layout variant · tenant-isolation test whenever a `MediaRef` appears.

---

## 4. Contract B — Palette, colour and contrast

### 4.1 Palette (D-06)

`primaryColor` stays the stored **brand** value and `accentColor` stays the stored **accent** value (existing keys, no dual source of truth). Remaining roles live in an additive `palette` object:

```ts
interface PresentationPalette { surface?: Hex; surfaceAlt?: Hex; text?: Hex; heading?: Hex; link?: Hex; border?: Hex; overlay?: Hex }
```

- **Role resolution:** `brand = primaryColor`; `accent = accentColor ?? derive(brand)`; each other role falls back to today's fixed token, so absent palette ⇒ unchanged output.
- **`accentColor` becomes live:** consumed by badges, highlights, link hover accents, selected states in storefront chrome, and exposed as a palette role in the builder (closes DEF-2; V1B). Legacy documents with `accentColor: null` render unchanged.
- **Presets** (`default/soft/brand/inverse/muted` tone shortcuts and the existing theme presets) are *starting points that write ordinary palette values*; they are not a cap on merchant colour.

### 4.2 Controls (`ColourField`, V5)

Native colour picker · hex input (validated) · palette-role swatches · theme swatches · **recent colours** (per store, browser-local, ≤ 8, editor-only metadata, never persisted in the document) · "suggest foreground" · live contrast badge for the role pair · reset-to-role.

### 4.3 Where colour applies

Page/section background, text, heading, link (+hover), button fill/outline/label, border/divider, overlay, header/footer/announcement/card surfaces — each through a `ColorRef` (role or hex), never a raw CSS string.

### 4.4 Gradients (D-07)

`{ kind: 'gradient', from, to, direction }`; eight logical directions (mirrored under RTL by the resolver); rendered as one validated `linear-gradient()`. **Deferred**: three-stop, radial/conic, animated/mesh. **Rejected**: free-form strings. Contrast is evaluated at the **worst** of the two stops (§4.5).

### 4.5 Contrast contract (D-08)

1. **Auto foreground first.** For each text-on-surface pair the resolver chooses the foreground (palette `text`/`heading`, or a light/dark neutral, or a brand tint) that meets the target. Because a light or dark neutral always achieves ≥ 4.5:1 against any opaque background, **no background colour is ever rejected**.
2. **Targets (WCAG 2.1 AA, relative-luminance formula already implemented in `tokens.ts`).** Normal text **≥ 4.5:1**. Large text (≥ 24 px, or ≥ 18.66 px bold) and applicable non-text UI (control boundaries needed to identify a control, focus indicators, meaningful icons/graphics) **≥ 3:1**. **3:1 is never accepted for normal text.** Logos, decorative elements and disabled controls are exempt.
3. **Effective background:** gradient → each stop is checked, worst wins; semi-transparent colours are composited over the effective backdrop; image + overlay → luminance sampled on the server at upload (stored in media metadata) and blended with the overlay (an *estimate*, flagged as such).
4. **Warn tier:** within ~0.5 of target, estimated cases (image/overlay), hover/focus states whose colours differ from rest — shows ratio, nearest compliant colour, one-click apply; merchant may proceed.
5. **Block tier (publish gate):** informative text below 4.5:1 (normal) or below 3:1 (large text/applicable UI) **cannot be published** until resolved. The block always carries the tier-1 one-click fix (adjust foreground; or nearest compliant background), so it constrains the *pairing*, not the brand colour.
6. **Authority:** the editor computes advisory results live; the **PHP publish step recomputes** with the same algorithm and rejects a block-tier document (`422` with machine-readable `code` per offending path). The editor can therefore never be bypassed.
7. Server-side check is limited to values it can compute (hex pairs, gradient stops, overlay over sampled luminance); anything image-dependent beyond the sampled average is warn-tier by definition.

---

## 5. Contract C — Typography (D-09, D-10)

### 5.1 Tokens

```ts
interface TypographyTokens {
  headingFamily?: FontFamilyKey;  bodyFamily?: FontFamilyKey;   // from the curated catalogue
  headingScale?: 'sm'|'md'|'lg'; bodyScale?: 'sm'|'md'|'lg';     // global scale steps
  headingWeight?: 400|500|700|800; bodyWeight?: 400|500|700;
  lineHeight?: 'tight'|'normal'|'relaxed';                        // Arabic default 'relaxed'
  sectionHeading?: 'bar'|'plain'|'centered'|'underline';         // default section-heading style
  buttonText?: { weight?: 500|700|800; case?: 'normal'|'upper' };// 'upper' Latin only
}
type FontFamilyKey = string;   // key in the catalogue; reserved: `custom:<mediaId>` (§5.4, not enabled in HV)
```

### 5.2 Rules

- Catalogue ≥ 6 Arabic+Latin pairs, **self-hosted, subsetted, OFL-class licences only**, `font-display: swap`, loaded only when selected (no third-party font CDN). `fontPreset` (`cairo-geist`, `tajawal-geist`) maps to catalogue keys for backward compatibility; absent `typography` ⇒ the preset's stack, exactly as today.
- Scales are named steps resolved by the renderer (e.g. heading `md` = current sizes), never pixel inputs.
- **Letter spacing is not exposed for Arabic text** (it breaks letter joining); Latin-only display tracking is a fixed property of heading styles.
- Sections choose a **size step** (§3.3 `typography`), not a family; per-section font families are **not** offered (hierarchy and performance).

### 5.3 Supersedes

CUST-H3-2's "one merchant-facing typography control, no heading/body split" is superseded by D-09 for the heading/body split and scales; the H3-2 curated-fonts-only and CSP stance remain.

### 5.4 Custom fonts (deferred, represented)

Reserved: `FontFamilyKey` namespace `custom:<mediaId>`, media domain `storefront-fonts` (R2), `woff2` only, ≤ 3 weights, licensing acknowledgement, CSP `font-src` review, subsetting policy. **Not enabled** until its own Evidence Gate passes (media foundation proven, CSP position known — U3, licensing copy approved).

---

## 6. Contract D — Buttons, surfaces, width, separators, overlap, motion

### 6.1 Buttons (D-11)

```ts
interface ButtonTokens {
  style?: 'solid'|'soft'|'outline'|'link';
  size?: 'sm'|'md'|'lg';
  radius?: 'none'|'sm'|'md'|'lg'|'pill';
  colour?: PaletteRole;                         // brand | accent | text | inverse via surface/text roles
  hover?: 'darken'|'lift'|'underline'|'none';
  icon?: { key?: IconKey; placement?: 'start'|'end' };   // logical placement; mirrors in RTL
}
```
A global default plus a **per-CTA override limited to `style` and `colour`** (hero, banner, slider, announcement, header actions). Label contrast follows §4.5. Hover/focus-visible states are always present; focus ring colour is the `ring` token and must itself meet 3:1 against its backdrop.

### 6.2 Surfaces

```ts
interface SurfaceTokens { radius?: 'none'|'sm'|'md'|'lg'|'pill'; border?: { width: 'none'|'hairline'|'medium'; color?: ColorRef }; shadow?: 'none'|'soft'|'medium'|'strong' }
```
Global tokens; sections/cards override only if their capability allows. Existing `radius` presets (`default/subtle/sharp`) map to `lg/md/sm`.

### 6.3 Content width (D-12)

`layout.contentWidth: 'narrow'|'standard'|'wide'` = `64rem | 85rem (today's --store-content-max) | 100rem`, default **standard**. Per section: `width.mode: contained | wide | full`. **No visitor-facing light/dark switch.** Inverse/dark merchant surfaces (header, footer, announcement, sections) are palette choices, not a mode.

### 6.4 Separators

`line | band | wave | angle | curve` at section top/bottom, colour role, height `sm|md|lg`. Implemented as inline SVG / CSS clip, `aria-hidden`, `pointer-events:none`, mirrored under RTL, never covering interactive content. Complex decorative shapes/patterns are **not** offered (no demand evidence, untestable responsive states).

### 6.5 Overlap presets (D-13)

`overlap: 'none'|'sm'|'md'` on `hero` only (the *following* section overlaps upward). Requirements frozen: preset-only (no raw margin); active only ≥ `md` breakpoint, forced to `none` below it; the overlapping surface sits above with a defined `z-index` contract; **focus rings and interactive content must never be clipped** (verified by a keyboard traversal test at six widths); disabled automatically when the first section is not a media hero. Numeric geometry is finalised in V5/V6 (N-4).

### 6.6 Motion (D-29)

```ts
interface MotionTokens { duration: 'instant'|'fast'|'base'|'slow';     // 0 / 150 / 300 / 500 ms
                          easing: 'standard'|'emphasized'; }            // two curves
```
Allowed uses: slider transition (`slide|fade|none`), announcement ticker/rotation, hover feedback, **subtle one-time reveal** (`fade-up`, ≤ 400 ms, opt-in per section). **Never:** parallax, scroll-jacking, looping decorative animation, animation on the LCP element or on content above the fold that could delay it, arbitrary keyframes/durations from input. **Always:** everything resolves to static under `prefers-reduced-motion: reduce`; autoplay-like motion (slider/ticker/rotation) has a visible pause control; no motion blocks input.

---

## 7. Contract E — Customizer Media (D-01 … D-05)

### 7.1 Storage decision (CLOSED) and operational prerequisite

**[AWJ-Existing / Owner-confirmed]** Customizer media reuses the approved official R2-backed foundation (`R2StorageService`, `docs/storage.md`; `ProductMedia`; category images; H4-8b signed workspace route). **Supersession:** the 2026-09-26 `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED` decision no longer governs the Customizer. Its prohibition of a **parallel store** and of **bulk-rewriting existing documents** is *retained*.

**Operational prerequisite — not a decision.** Verifying Production R2 flags/credentials (N-2) is a go-live checklist item before Customizer media writes/reads are enabled in Production. A failed check means *fix the configuration*; it never reopens the storage decision and never triggers a fallback to the ephemeral `DocumentStorageService` disk.

### 7.2 Data model (tenant-scoped)

`storefront_media` — `CompanyWide` under the branch-isolation guard, extends `BaseModel` (automatic tenant scope):

| Column | Notes |
|---|---|
| `id` (uuid), `tenant_id` | tenant from `TenantContext` only |
| `kind` | `image` now; `font` reserved (§5.4) |
| `original_name`, `mime`, `size`, `sha256` | `mime` ∈ `image/jpeg, image/png, image/webp`; sha256 for de-duplication within a tenant |
| `width`, `height`, `avg_luminance`, `dominant_colour` | measured at upload (luminance feeds §4.5) |
| `alt_ar`, `alt_en` | defaults; per-usage `alt` override lives in `MediaRef` |
| `storage_key`, `variants` (json) | **never exposed by any API** (no path/disk/bucket leakage) |
| `state` | `active` · `deleted` (soft) · `purged` |
| `deleted_at`, `purge_after`, `uploaded_by`, timestamps | |

R2 key: `tenant/{tenant_id}/storefront-media/{media_id}/{file}` — tenant segment derived by `R2StorageService` from `TenantContext`; callers never supply a prefix or key; filenames are server-generated.

### 7.3 API (workspace, `commerce.manage`)

| Call | Behaviour |
|---|---|
| `POST …/media` (multipart, ≤ 8 files) | validate (§7.4), store original, enqueue/run variant generation, return metadata + **thumbnail URL via signed workspace route** |
| `GET …/media` | search by name/alt, newest first, `unused` filter, cursor pagination (24) |
| `PATCH …/media/{id}` | rename, `alt_ar`/`alt_en` |
| `DELETE …/media/{id}` | **409 with usage list** if referenced by draft, any version, published or scheduled state; otherwise soft delete |
| `GET …/media/{id}/usage` | exact references (version id + path) |
| `GET …/media/{id}/file` | signed, short-lived (20 min, `temporarySignedRoute`), re-checks tenant + state on every read |

Foreign/missing ids return the established uniform non-revealing 404. **No response contains a disk, bucket, key or internal path.**

### 7.4 Validation

`jpg/jpeg/png/webp` only; no SVG, no GIF/animated; max 5 MB (same as product media); magic-byte sniffing (not extension); decoded dimensions: min 320 px on the short edge (warn below the per-usage recommendation, block below 320), max pixel count 40 MP, max 8192 px per edge; strip EXIF (privacy) after reading orientation; per-tenant library quota (plan-limit hook, default to be set in V2). Upload rate limiting reuses the workspace write limiter.

### 7.5 Variants (D-03)

Server-generated after applying crop/rotate: **WebP** at widths **480 / 768 / 1280 / 1920** (+ **160 / 320** thumbnails), JPEG fallback for clients without WebP, original retained (needed for re-cropping and as the source of truth), explicit `width`/`height` stored per variant. Filenames are content-hashed → `Cache-Control: public, max-age=31536000, immutable` on the public route; workspace stays `private, max-age=600`. Renderers emit `srcset`/`sizes` from the ladder and `width`/`height` to prevent CLS. **No external image platform** unless V2's evidence proves the server path unsuitable (N-1) — then STOP for Owner review.

### 7.6 Image editing (D-04) — bounded Option B

Editable per **usage** (not per asset), stored as parameters in `MediaRef` — the original is never modified:

| Control | Contract |
|---|---|
| Crop | normalised rectangle `{x,y,w,h}` locked to an aspect preset; `zoom` 1-4× within the crop; keyboard operable (arrows nudge, +/- zoom) |
| Aspect presets | 16:5 · 3:1 · 16:9 · 4:3 · 1:1 · 4:5 |
| Focal point | `{x,y}` 0-100; click on preview + 3×3 snap; drives `object-position` and the server crop centre |
| Fit | `cover` · `contain` |
| Rotate | 90° steps |
| Reset | restore original framing in one action, always available |

**Not provided:** filters, colour correction, flip, resize handles, shapes, arbitrary transforms (**rejected**: Option C scope; no storefront evidence; flip corrupts embedded text/logos and RTL/LTR artwork). **[Salla]** ships crop + filters + levels + resize + shapes, documented for *product* images only (SAL-IMG); **[Daftra]** documents no image editor.

### 7.7 Responsive media override (D-05)

`background.media.mobile?: MediaRef` (and per-slide `mobile?` for Slider; Banner/Hero image slots). Rules: same semantic content (**alt, link, text, CTA shared**); used below `md` via `<picture>` art direction (`media="(max-width: 767px)"`); never changes layout structure; editor shows both previews; absent ⇒ the default media. Not offered for Gallery/Cards in HV.

### 7.8 References, publish validation, public access

- Document stores only `MediaRef` (id + edit parameters) — never URLs, paths, dimensions or luminance.
- **Draft save** tolerates dangling ids (the Canvas shows a "media removed" placeholder). **Publish** (and version-publish/schedule-dispatch) validates that every `mediaId` exists, belongs to the tenant, is `active`, and (for informative images) has alt or is flagged decorative; failures return `422` with `code` + path; scheduled publish that fails validation fails closed and leaves the previous Published state intact (existing H1 guarantee).
- **Published-reference gate:** the host-resolved public route (`/store/v1/media/customizer/{id}[/{variant}]`) serves a media id **only if the resolved storefront's *Published* config references it**; otherwise uniform 404. A small denormalised "published media ids" set is rebuilt at publish time; there is no per-request JSON scan.
- Legacy: existing https `imageUrl` and Base64 logos continue to render; they migrate lazily on next save; **no bulk rewrite**.

### 7.9 Delete policy and lifecycle

Soft delete only when unreferenced (§7.3). A reconciler purges `deleted` assets after `purge_after` (default 30 days) and removes any R2 object with no row after a grace period, by prefix-scoped operations (never bucket listing exposed to controllers). Restore of an older version (H5) re-validates references; a restored version that points to a purged asset shows the missing-media placeholder and cannot be published until resolved. Theme-owned art ships as AWJ read-only media: applying a theme copies **references**, deleting a theme never deletes merchant media.

### 7.10 Merchant UX (MediaPicker)

Upload (drag-drop, multi-file, progress, per-file error) ∣ Library (grid, search, unused filter) tabs; selected media card: thumbnail, name, dimensions, alt AR/EN, **Edit image**, Replace, Remove, "Used in N places". States defined for loading, empty, uploading, processing (variants), success, validation error, network error, stale (deleted elsewhere), permission denied and **capability-gated** (R2 not configured). Sheet on mobile, dialog on desktop; focus returns to the opener.

### 7.11 Tests (V2/V4)

Tenant A/B isolation for every call · foreign and unpublished id probes on the public route · signed-URL expiry/tampering · mime/magic-byte/size/dimension rejection · soft-delete with usage → 409 · reconciler idempotency · publish-time dangling-reference rejection · scheduled-publish fail-closed · no path/disk/bucket in any response (schema assertion) · R2-unavailable → gated state, never ephemeral fallback.

---

## 8. Contract F — Hero & Banner

### 8.1 Hero is per-instance (D-14) — invariant analysis

**Current:** `hero` is a non-deletable singleton (`CAP.hero.canDelete=false`) whose text lives in two global keys (`homepage.heroHeadline/heroSubheadline`); the storefront renders it through `implemented.hero`, keyed by *type* (`storefront/.../(storefront)/page.tsx`).

**Candidate hard reasons to keep a required singleton, and verdicts:**

| Reason | Verdict |
|---|---|
| Global headline would be orphaned on delete | Removed by moving content onto the instance (migration below) |
| Page needs one `<h1>` | `<h1>` rendered by the **first visible hero instance**; additional hero instances render `<h2>`; with **no** hero the home page renders a visually-hidden `<h1>` with the store name |
| Type-keyed renderer cannot render several heroes | Replace with the instance-keyed `publishedNodes` path already used by banner/featured/offers |
| Existing documents have exactly one hero with global text | Backward-compat rule below |

→ **No hard architectural reason found.** **Final invariants (frozen):**

1. `hero` follows normal capability rules: `canDelete: true`, `canDuplicate: true`, **`maxInstances: 3`** (bounded; Banner/Slider cover further bands).
2. A home page may have **zero** hero instances.
3. Exactly one `<h1>` per home page, as above.
4. **Back-compat:** a hero instance **without** `content` renders from the legacy `homepage.heroHeadline/heroSubheadline` (and store-name fallback) exactly as today. On first edit the builder copies the legacy text into the instance's `content` and stops reading the globals for that instance; the globals remain readable for old versions and are never rewritten in bulk.
5. Default document for new stores keeps one visible hero (unchanged defaults).

### 8.2 Content model

```ts
interface HeroContent { headline: string; subheadline?: string; ctas?: Cta[]; }          // ≤120 / ≤200 code points
interface BannerContent { /* existing: title, subtitle, ctaLabel, ctaHref, imageUrl, imageAlt */
                          media?: MediaRef; mobileMedia?: MediaRef; ctas?: Cta[];
                          window?: { startsAt?: string; endsAt?: string }; }             // §8.4
interface Cta { label: string; href: string;                                            // sanitizeContentHref rules
                style?: ButtonTokens['style']; colour?: PaletteRole; icon?: { key: IconKey; placement: 'start'|'end' } }
```
`ctas` holds **≤ 2** items from day one (a second CTA is a presentation choice but the model must not need a later migration); the legacy `ctaLabel/ctaHref` remain valid and map to `ctas[0]`. Hero's former hard-coded `/products` CTA remains the default only when no CTA is authored.

### 8.3 Design (via §3.3)

Both support: media (default + mobile), background solid/gradient/media, overlay (colour + alpha ≤ 90), heading/body colours, CTA style/colour, content width & position (3×3 logical grid), alignment, width mode, height preset (`compact|standard|tall|screen`) with bounded min/max, aspect presets, radius, border/shadow, focal/fit/crop, layout variants (§3.4). **Hero-specific:** `overlap`, header overlay interplay (§9.3). **Banner-specific:** `window`, `full-bleed`.

### 8.4 Banner start/end window (D-15) — evidence

- **Existing semantics:** Offers evaluate `starts_at`/`ends_at` against `CarbonImmutable::now('UTC')` with reasons `scheduled`/`expired` (`StorefrontOfferResolver:105,177-178`); Version scheduling stores `scheduled_for` as a UTC instant and the builder converts wall time ↔ UTC through `@/lib/timezone` (`safeTimeZone`, `zonedWallTimeToUtcIso`, `utcIsoToZonedWallTime`, `timeZoneDisplayLabel`) with an explicit timezone label (`ScheduleDialogs.tsx`).
- **Why Version scheduling cannot replace it:** it swaps the **whole** presentation document at one instant; a campaign banner that appears/disappears independently would force a new Version per window and cannot express "hide this one banner on a date" without publishing everything else. So the optional window is a *per-banner visibility predicate*.
- **No second scheduler:** no job, no queue, no table. The window is stored as two UTC ISO instants and evaluated at request time against server UTC. The storefront fetches the config with `cache: "no-store"` (`fetchStorefrontConfig`), so evaluation is current to the request; the Banner/Announcement renderers must stay in the dynamic request scope or receive the window as a cache-key input (otherwise a `use cache` TTL bounds the error — U5).
- **Semantics:** `startsAt` inclusive, `endsAt` exclusive; both optional; `endsAt > startsAt` else the pair is dropped; invalid ISO → dropped; merchant edits in store timezone with the timezone shown (reuse the Version dialog pattern); Canvas shows an editor-only chip *scheduled / expired* and keeps the section visible for editing; Published omits ineligible banners (an omitted banner leaves no empty wrapper).

### 8.5 Header interplay and legibility

See §9.3; Hero exposes `mediaTreatment.height` so the header-overlay offset is computable, and exposes its effective overlay tone to the header resolver.

---

## 9. Contract G — Header (D-27)

### 9.1 Model

```ts
interface HeaderDesign {
  layout?: 'standard'|'compact'|'centered'|'two-row';          // desktop; existing style standard|compact map to the first two
  mobileLayout?: 'logo-centre'|'logo-start';
  height?: 'compact'|'standard'|'tall';
  logo?: { size?: 'sm'|'md'|'lg'|'xl'; align?: 'start'|'center'; treatment?: 'original'|'mono-light'|'mono-dark' };
  surface?: { background?: ColorRef | Gradient; alpha?: Alpha; text?: ColorRef; icon?: ColorRef };
  mode?: 'solid'|'transparent'|'overlay-hero';
  sticky?: 'always'|'on-scroll-up'|'off';
  search?: 'bar'|'icon-expand'|'hidden';                          // existing showSearch=false ≡ hidden
  categoryNav?: 'rail'|'tabs'|'hidden';                           // existing showCategoryNav=false ≡ hidden
  border?: { width?: 'none'|'hairline'|'medium'; color?: ColorRef }; shadow?: 'none'|'soft'|'medium';
}
```
Existing `header.style`, `showSearch/Account/Cart/CategoryNav` remain the source for those behaviours when `design` is absent (no change to current output).

### 9.2 Behaviour

- **Transparent mode:** background alpha < 100 with a page-level fallback surface; text/icon colour from the resolver (§4.5 against the *effective* backdrop).
- **Sticky modes:** `always` (current), `on-scroll-up` (reappears on upward scroll; never hides while a menu/search is open or focus is inside the header), `off`. Sticky stacking with the announcement bar: the announcement bar is above the header and **never** sticky together with a sticky header on viewports < `md` (it collapses on scroll-down) — avoids a stack that eats the mobile viewport.
- **Height & spacing presets** feed `--store-header-height*` tokens so existing offsets (`--store-header-offset`) stay correct.
- **Search / category presentation** are presentation only; search suggestions and category data are unchanged commerce reads.

### 9.3 Overlay-on-Hero legibility (frozen behaviour)

1. Active only on the **Home** page, only when the first visible section is a `hero`/`slider`/`banner` with a media background; otherwise it silently falls back to `solid` (never a transparent header over unknown content).
2. The header is transparent over the media at scroll 0 and becomes **solid** after a small scroll threshold (or immediately when a menu/search/focus is active) with a `<= 200 ms` fade (instant under reduced motion).
3. Text/icon tone is derived from the hero's **effective overlay + sampled luminance** (§4.5 estimate → warn-tier) with an automatic scrim (a vertical gradient `overlay` colour at ≤ 40 % alpha behind the header band) added when the estimate is below target; the merchant can choose `light`/`dark` tone explicitly.
4. The hero reserves the header height (no content under the header); the first interactive element is never hidden behind it; skip-link and focus rings remain visible.
5. Mobile: same rule; the header height token for mobile is used.
6. Canvas renders the identical behaviour with a scroll-position simulator; Published and Canvas share the resolver.

### 9.4 Accessibility & RTL

Landmarks unchanged; logo alignment uses logical start/center; icon order mirrors; sticky/transparent changes never trap focus; all colour pairs run §4.5.

---

## 10. Contract H — Footer (D-26)

### 10.1 Model

```ts
interface FooterConfig {                 // existing: tagline, showLogo, copyright
  layout?: 'compact'|'columns'|'centered'|'editorial'|'minimal'|'brand-heavy';
  groups?: { id: string; title: string; menu?: string /* NavigationDoc menu id */; links?: NavItem[]; span?: 1|2 }[];   // ≤ 6 groups × ≤ 8 links
  design?: {
    surface?: { background?: ColorRef | Gradient | { media: MediaRef; overlay?: Overlay }; alpha?: Alpha };
    text?: ColorRef; heading?: ColorRef; link?: ColorRef; linkHover?: ColorRef;
    divider?: { kind?: SeparatorKind; color?: ColorRef; height?: 'sm'|'md'|'lg' };
    border?: { width?: 'none'|'hairline'|'medium'; color?: ColorRef };
    spacing?: { top?: Step; bottom?: Step; columnGap?: Step };
    logo?: { size?: 'sm'|'md'|'lg'; treatment?: 'original'|'mono-light'|'mono-dark'; align?: 'start'|'center'|'end' };
    align?: 'start'|'center'|'end';
  };
}
```
Content already modelled elsewhere stays authoritative: `contact`, `social`, `apps`, `whatsapp`, `verification`, `sbc` (official trust/seal elements remain official, non-editable marks; merchant colours may style the *container*, never the mark artwork).

### 10.2 Layout contracts (each: desktop · mobile stacking · RTL · accessibility)

| Layout | Desktop | Mobile stacking (< `md`) | RTL | Accessibility |
|---|---|---|---|---|
| **compact** | one row: logo · inline link list · social · copyright | logo → links wrap (2 cols) → social → copyright | inline order mirrors | single `<footer>` landmark; link groups as one `<nav aria-label>` |
| **columns** | brand block + ≤ 4 link groups + contact column, identity row beneath | brand → groups in a 2-col grid → contact → identity; > 4 groups collapse into disclosure sections | column order mirrors; chevrons flip | each group `<nav aria-labelledby>`; disclosures are `<button aria-expanded>` with visible focus |
| **centered** | centred logo, tagline, link row, social row | already single column; link row wraps, ≥ 44 px targets | symmetric | heading order preserved (no skipped levels) |
| **editorial** | large tagline/statement on the start side, sparse link groups on the end side, contact below | statement → groups (2 col) → contact | statement side mirrors | the statement is a `<p>`, not a heading; groups keep `<h2>` headings |
| **minimal** | single line: copyright + ≤ 3 links + social | wraps to two lines; social beneath | order mirrors | all links keep visible text (icons never alone) |
| **brand-heavy** | large logo + CTA band (WhatsApp / newsletter-free apps badges / primary CTA) above columns | band first, columns collapse into disclosures | band content mirrors | CTA band is a `<section aria-label>`; badges are official artwork with alt |

Frozen cross-layout rules: same data feeds every layout (no content duplication); all text/link pairs pass §4.5 against the footer surface (media background → overlay required); the divider/border sit **outside** the focus order; touch targets ≥ 44 px; no layout hides identity/verification information at any width.

### 10.3 Content groups

Footer link groups reuse the navigation item model and pickers (§11) — categories, products, content pages (policy pages), external. Legacy fixed links (`POLICY_LINKS`, category links) continue to render when `groups` is absent.

---

## 11. Contract I — Navigation and icons (D-18, D-22)

### 11.1 Schema (nested now, mega-menu-ready)

```ts
interface NavigationDoc { menus: Menu[] }                          // ≤ 6 menus
interface Menu { id: string; name: string; items: NavItem[] }      // ≤ 24 items per menu
interface NavItem {
  id: string; label: string;                                       // ≤ 80
  target: NavTarget; enabled: boolean;
  icon?: IconKey; badge?: { text: string; tone?: PaletteRole };    // text ≤ 12
  children?: NavItem[];                                            // CUST-HV: depth ≤ 1 (child items must not have children)
  presentation?: { kind: 'link' | 'dropdown' /* HV */ | 'mega' /* reserved, LATER */ };
  meta?: Record<string, never>;                                    // reserved extension point (mega-menu panels, imagery)
}
type NavTarget =
  | { kind: 'home' } | { kind: 'category'; id: string } | { kind: 'product'; id: string }
  | { kind: 'content'; slug: string }
  | { kind: 'external'; href: string; newTab?: boolean };
```
- **Depth** is enforced by a constant (`MAX_NAV_DEPTH = 1` child level), not by the shape, so a later `mega` panel or a second level is a constant/capability change, not a schema break.
- **Typed internal targets:** `category`/`product` store ids (never free paths); `content` stores a known slug from `CONTENT_PAGE_SLUGS`; the renderer resolves the URL, so a deleted category/product renders as a disabled/omitted item (never a dead link).
- **Safe external links:** https only, same sanitiser; `newTab` adds `rel="noopener noreferrer"`.
- **Back-compat:** `header.links` (flat, ≤ 12) keeps working. If `navigation.menus` has a menu with `id: 'main'` it supersedes `header.links` for the header; otherwise the legacy list is used. Legacy → menu migration happens lazily on first nav edit; old versions are untouched.
- **Assignment:** header uses `main`; mobile menu uses `main` plus categories; footer groups may reference any menu id (`groups[].menu`); a missing menu id degrades to the group's own `links` or is omitted.

### 11.2 Interaction

Keyboard-complete tree editing: Up/Down move, **"Make child ↴ / Move out ↰"** buttons (the keyboard alternative — **[Daftra]** uses the same "↴" pattern, DAF-ORD), drag-and-drop on top (pointer + touch long-press), enable/disable, remove with confirmation only when an item has children. Pickers for category/product/content (reuse existing picker components); no raw internal href entry.

### 11.3 Storefront rendering

Desktop: dropdown (hover + focus + `Enter/Space`, `Esc` closes, arrow keys move) — **no hover-only access**; mobile: accordion in the menu sheet; **parity rule (fixes DEF-1/BL-2):** every enabled header item appears in the mobile menu at all widths < `lg`. RTL: dropdown aligns to the logical inline-start of its parent; chevrons mirror; `aria-expanded/aria-controls` on parents.

### 11.4 Icon registry (D-22)

```ts
type IconKey = string;     // key into ICON_REGISTRY v1; unknown keys render nothing (fail-closed)
```
`ICON_REGISTRY` is a **static, code-owned map** `key → { svg path data | lucide component, label ar/en, tags }` shared by Benefits, announcement, navigation, buttons. Starter set (~24, semantic): `truck, shield-check, credit-card, gift, clock, phone, message-circle, mail, map-pin, store, star, heart, tag, percent, package, refresh-ccw, headphones, leaf, sparkles, badge-check, calendar, users, lock, globe`. Rules: **no arbitrary SVG upload**; keys are stable and append-only (removing a key is a breaking change → needs a deprecation alias); extensible by adding keys without schema change; icons are decorative by default (`aria-hidden`) unless used alone (then require a text alternative); directional icons mirror under RTL.

---

## 12. Contract J — Announcement bar (D-17)

### 12.1 Model

```ts
interface AnnouncementsDoc {
  enabled: boolean;                                                // master switch, default false
  items: Announcement[];                                           // ≤ 5
  behaviour?: { rotate?: boolean; rotateInterval?: 6|8|10; ticker?: boolean; tickerSpeed?: 'slow'|'normal'|'fast';
                sticky?: boolean; dismissible?: boolean };         // all default false/off
}
interface Announcement {
  id: string; text: string;                                        // ≤ 120 code points, plain text
  icon?: IconKey; href?: string;                                   // safe href rules
  surface?: { background?: ColorRef | Gradient; text?: ColorRef; link?: ColorRef };
  window?: { startsAt?: string; endsAt?: string };                 // UTC ISO, same semantics as §8.4
  pages?: ('home'|'product'|'category'|'all')[];                   // never checkout/cart/account
  enabled: boolean;
}
```

### 12.2 Behaviour (all optional, conservative defaults)

- **Eligibility:** `announcements.enabled` ∧ item `enabled` ∧ within window ∧ page match. Default display = **first eligible item**; multiple items exist for sequencing and scheduling.
- **Rotation (opt-in):** fade/slide between eligible items, interval **6 / 8 / 10 s** (never below 5 s), visible pause control, pauses on hover/focus/touch, manual prev/next; **never** under `prefers-reduced-motion` (shows the first eligible item statically).
- **Ticker (opt-in):** CSS marquee, speed presets, pauses on hover/focus + visible pause button, direction follows `dir`, static under reduced motion, full text always reachable by assistive tech (`aria-label`/visually-hidden duplicate) and never the only place a critical message appears.
- **Sticky (opt-in):** sits above the header; on viewports < `md` it collapses on scroll-down so the stack never exceeds one sticky band.
- **Dismissible (opt-in):** persistence is **per browser, per origin, per announcement revision**, stored in `localStorage` under `awj.ann.<announcementId>.<contentHash>` with value `1` (no user identifier, no tenant identifier, no server call). Isolation argument: every storefront is served from its own origin (managed subdomain or custom domain), so storage is origin-scoped and cannot leak across tenants; the key includes only the announcement id and a hash of its text/link/window, so editing the message makes it reappear; clearing site data or private browsing simply shows it again. If storage is unavailable, dismissal lasts for the page session only. No cookies, no analytics, no server state.
- **Timing:** evaluated at request time (UTC); if the renderer sits inside a cached scope, the window is a cache-key input (U5).
- **Targeting:** `home|product|category|all`; never rendered on cart, checkout, account or auth pages.
- **Accessibility:** `role="region"` + accessible name ("Announcements"), **not** `role="alert"`/`aria-live=assertive`; links keep underline/contrast; dismiss/pause are real buttons ≥ 44 px; colour pairs run §4.5; no colour-only meaning.
- **RTL:** logical alignment; marquee and rotation direction mirror; icon placement logical.
- **Parity:** the Canvas renders the same component; ineligible items show an editor-only chip.

**[Salla]** SAL-PROMO documents title/text/icon/link/expiry/pages/theme-version/colours/moving-text and multiple items; SAL-ADV adds nothing on ticker/dismiss. **AWJ adopts** the field set; **changes** it by adding a start date, gradient/palette colours, rotation and dismissal with defined persistence; **rejects** a separate "title" field (one line suffices) and a per-version selector (the document is already version-scoped).

---

## 13. Contract K — Slider and Gallery

### 13.1 Slider (new section type `slider`, D-16)

```ts
interface SliderContent { slides: Slide[] }                                  // 2-8
interface Slide { id: string; media: MediaRef; mobile?: MediaRef; heading?: string; sub?: string;
                  cta?: Cta; overlay?: Overlay; text?: ColorRef; align?: 'start'|'center'|'end' }
interface SliderBehaviour { autoplay: boolean /* default false */; interval?: 5|6|8|10; transition: 'slide'|'fade'|'none'; duration?: 'fast'|'base'|'slow';
                            arrows: boolean; dots: boolean; loop?: boolean }
```
Requirements: autoplay **off by default**, opt-in, **interval ≥ 5 s**, visible **pause/play control** whenever autoplay is on, pause on hover/focus/touch-start, **disabled entirely under `prefers-reduced-motion`**, manual arrows/dots/swipe/keyboard always functional, logical RTL (swipe and arrows follow `dir`), only the first slide is eager (others lazy with dimensions), ≤ 8 slides, each slide is `role="group" aria-roledescription="slide"` with "n of N", inactive slides `aria-hidden` + `inert`. Reuse the Swiper dependency (dynamic import; RTL verification U6 first). Slides add/remove/duplicate/reorder with buttons + drag.

### 13.2 Gallery (new section type `gallery`, D-24)

`gallery`: 2-24 images, `layout: grid | carousel`, columns `2|3|4|6` (responsive collapse), aspect preset, gap step, optional captions, optional per-image safe link, **optional lightbox** (reuses `MediaLightbox`: focus trap, `Esc`, arrow keys, RTL, restore focus). **Collage → LATER. Masonry → only a DOM-order-preserving, accessible implementation (e.g. grid-row-span); CSS-column masonry is excluded** because it reorders visual vs DOM order, breaking keyboard/screen-reader order and RTL flow. Images use the shared variants + `srcset`; alt required-with-warning (decorative flag allowed).

---

## 14. Contract L — Cards, product & category presentation, commerce firewall (D-20)

### 14.1 Card design tokens (product, category, marketing cards)

```ts
interface CardTokens { radius?: …; border?: { width, color }; shadow?: …; background?: ColorRef;
                       padding?: Step; align?: 'start'|'center'; imageRatio?: AspectKey; imageFit?: 'cover'|'contain';
                       badgePosition?: 'start-top'|'end-top'|'overlay-bottom'; hover?: 'none'|'lift'|'zoom'|'reveal-cta'; density?: 'comfortable'|'compact' }
```
Global default with per-section override where the type allows (§3.4). Existing `productCard: standard|compact` maps to `density`.

### 14.2 Product/category sections

`layout: grid | rail`, `columns 2|3|4`, `count` (bounded, existing limits), section title override + show-title, background/spacing/separator. **Category page:** optional `cover` region rendered only when the category has an image (never a placeholder); the data exists since #1110 — the stale `CategoryBanner.tsx` comment is a V1A doc fix, the cover itself is V9. Product page: `zoom: on|off`, gallery thumbnails placement variants **LATER**.

### 14.3 Commerce firewall (frozen allow/deny)

| Allowed (presentation of authoritative data) | Forbidden (any design/theme/preset/block control) |
|---|---|
| position, shape, colour role, size step of price / compare-at / badge / stock text | setting, scaling, hiding-to-mislead, or writing **price, sale price, discount %, stock count, availability, offer status, tax, shipping or checkout totals** |
| show/hide a *real* badge the Commerce layer already produced | creating a badge ("Sale", "Last 3!") the data does not support |
| choose which Commerce-valid products/offers a section references (existing pickers) | storing prices, names, images or availability of products inside presentation JSON |
| countdown **only** if later bound to a real Offer end instant (not in HV) | arbitrary urgency copy generated by a timer without a data source |

Tests (V9): a fixture proves no presentation field can change any value returned by `CommercePriceResolver`/`StorefrontOfferResolver`; schema assertion that no design key accepts numeric price/discount/stock; Canvas and Published both read authoritative data only.

---

## 15. Contract M — Shared content-block vocabulary (D-21)

One bounded vocabulary used by the homepage **Custom Content** section now and by content pages later (no second editor architecture):

| Block | Fields | Notes |
|---|---|---|
| `heading` | text ≤ 120, level `2` or `3`, align | no `h1` |
| `paragraph` | text ≤ 600 (plain; line breaks only) | no HTML |
| `image` | `MediaRef`, caption, link? | alt required-with-warning |
| `button` | `Cta` | style/colour roles |
| `divider` | style `line` or `dots` | decorative |
| `spacer` | `sm`, `md` or `lg` | only vertical rhythm |
| `callout` | tone `info`, `success` or `warning`, text | icon from registry |
| `columns` | 2 columns of blocks, **mandatory single-column stack below `md`** | no nested columns; stack is fixed, not merchant-defined |

Bounds: ≤ 12 top-level blocks (+ ≤ 4 per column); no HTML/JS/CSS/embeds; no absolute positioning. Content-page authoring (new backend, route, SEO) is **LATER** and will persist the same block array.

---

## 16. Contract N — Theme definition (D-30)

```ts
interface ThemeDefinition {
  id: string; version: 1; name: { ar: string; en: string }; vertical: 'general'|'retail'|'floral'|…;
  palette: { brand: Hex; accent?: Hex } & PresentationPalette;
  typography: TypographyTokens; buttons: ButtonTokens; surfaces: SurfaceTokens; layout?: { contentWidth?: … };
  header: HeaderDesign; footer: Pick<FooterConfig,'layout'|'design'>;
  cards: CardTokens; motion?: MotionTokens;
  sectionDefaults: Partial<Record<SectionType, SectionDesign>>;   // default styles per type
  heroDefaults?: Partial<HeroContent & { design: SectionDesign }>; navigationDefaults?: { layout?: …};
  sectionPacks?: SectionPackRule[];                                 // e.g. the Flowers pack (backed sections only)
  assets?: ThemeAssetRef[];                                         // AWJ-owned read-only media
}
```
**Apply is non-destructive and ordered:** (1) **Preview** — render the theme over the merchant's own data in the Canvas, unsaved, read-only, Desktop/Mobile; (2) **Apply summary** — lists exactly which design areas will change (palette, fonts, header, footer, cards, buttons, section styles) and what is kept (content, media, links, logos, section order/visibility except explicitly listed pack additions); (3) **new Draft Version** created and saved (revision-checked, rolls the version back on failure — as `themes/page.tsx` does today); (4) opens in the editor. The Published store and existing versions are **never** overwritten; recovery = switch back to the previous version (H1). Themes copy **references** to theme assets; merchant media is never touched. Registry growth: ≈ 6-8 themes across verticals; a theme is `available` only when every token it uses is runtime-backed (existing rule in `theme-registry.ts`).

---

## 17. Contract O — Labels, presets and style workflow (D-19, D-23)

### 17.1 Section labels (O13)
`homepage.sections[i].label?: string` (≤ 60 code points). **Editor metadata only**: shown in the section list, inspector title and Canvas selection chip; **never** rendered on the storefront, never used as `aria-label`/heading unless a content field is explicitly mapped to it; stripped from the public snapshot where the public API does not need it (public runtime ignores the key).

### 17.2 Workflow capabilities (V5/V10)
Duplicate **with design** (deep clone `content` + `design` + `label` suffix; media refs shared) · **Copy style / Paste style** (design only, same-type or compatible-group) · **Reset design** (section / global; content untouched) · **built-in section presets** per type, shipped with themes · reuse of Canvas hover action bar.

### 17.3 Later (architecture-ready)
User-saved presets: a store-level `presets[]` (design-only JSON, ≤ 24) is possible because `design` is plain JSON with no embedded ids except `MediaRef` (presets referencing media would hold refs and reuse the usage scan). Cross-page copy waits until sections exist outside Home.

---

## 18. Contract P — Inspector and editor surfaces (D-25)

| Section complexity | Inspector |
|---|---|
| Simple (`wholesale`, `deliveryPromise`, `appPromo`) | one compact panel: visibility → content |
| Rich (hero, banner, slider, gallery, benefits, customContent, product sections, announcement, header, footer) | **Content** · **Design** · **Layout** |
| Advanced | rendered **only** if it holds real fields (e.g. external image URL fallback, per-section motion) |

Rules: no empty tab ever; Design groups collapsible with "common first" (background/colour, variant, alignment); every control change updates the Canvas immediately and is part of the same draft revision; the contrast badge sits beside each colour pair.

**Tablet (768 px) must have a real editing surface** (BL-3 / DEF-7): below `lg` the inspector opens as a **side drawer** (≥ 320 px, over the Canvas) at 768 and a **bottom sheet** below 600; the navigation rail becomes a drawer; the toolbar collapses secondary actions into an overflow menu so **Save, Publish and Exit are always visible** (BL-1). At 1024 px the Canvas must keep a usable width (≥ 560 px) — the nav rail collapses to icons. Final geometry is decided and evidenced in V1B/V5; the requirement (a visible editing surface and reachable primary actions at every width in both directions) is frozen.

---

## 19. Slice plan, boundaries and dependencies

Every slice: (1) **Implementation Evidence Gate** (§21.3) → (2) UX contract refresh against this document → (3) implementation → (4) verification (six widths × AR/EN, a11y, parity, tenant tests where applicable) → (5) pre-merge review → (6) **Owner merge approval** → (7) report. No slice deploys to Production without separate approval.

| Slice | Scope (what it may touch) | Must NOT | Exit gate | Depends on |
|---|---|---|---|---|
| **V0** Decisions & Contracts | this document, Roadmap section, baseline evidence | any code | Owner approves PR | — |
| **V1A** Independent defects | DEF-1 (custom links in `MobileMenu`), DEF-3a/DEF-9/DEF-10 (stale comments/docs), DEF-4 (honest theme Preview label/behaviour). Each with tests | new design/media architecture; toolbar/IA redesign | defects closed, CI green, six-width check for DEF-1 | none |
| **V1B** Contract-dependent UX defects | DEF-2 (accent role outcome per §4.1), DEF-6 (delete-confirmation rule), DEF-7/BL-3 (768 editing surface), DEF-8 + DEF-11/BL-1 (toolbar overflow/primary actions), BL-4 (1024 Canvas width) | before V0 approval and the V5 IA decisions | Save/Publish/Exit reachable at all widths in AR+EN; editing surface at 768 | V0; co-designed with V5 |
| **V2** Customizer Media Foundation | `storefront_media` model/migration, R2 domain, upload/list/patch/delete/usage, signed workspace route, published-reference gate, variants pipeline, reconciler, publish-time validation, RBAC, tenant tests (§7) | picker UI; any Production flag change | isolation + lifecycle suites green; N-1 evidence recorded | V0 (+ N-2 prerequisite before enabling in Production) |
| **V3** Announcement Bar | `announcements` contract ×3, Canvas + Published, ticker/rotation/sticky/dismiss, window + targeting, a11y, parity (§12) | media features | parity + a11y + reduced-motion checks | V0 |
| **V4** MediaPicker / Image Editor / Logos | picker, crop/focal/fit/rotate/reset, mobile override mechanism, logos+favicon → `MediaRef` (lazy migration; fixes DEF-5) (§7) | design contract fields | states table implemented; legacy documents render unchanged | V2 |
| **V5** Section Visual Contract / Inspector / Colour | `design` per type, palette roles, `ColourField`, contrast engine (client + PHP publish gate), gradients, buttons, surfaces, separators, overlap presets, Content/Design/Layout inspector, copy/paste style, reset design (§3-§6, §18) | per-surface features beyond the contract | back-compat proof (absent design ⇒ identical); contrast tests | V0 |
| **V6** Hero & Banner v2 | per-instance Hero, CTA model, media/background/overlay/variants, mobile override use, Banner window (§8) | header overlay behaviour (V7) | per-variant parity + LCP budget | V2, V4, V5 |
| **V7** Header / Footer / Navigation | header design + overlay-on-hero + sticky, six footer layouts + groups + media, nested navigation + pickers + drag + icons, Canvas fixture removal (§9-§11) | mega menu | parity + mobile nav parity + RTL per layout | V5, V6 (overlay-on-hero) |
| **V8** Slider / Gallery / Motion | `slider`, `gallery` (grid/carousel/lightbox), motion tokens, reduced motion (§6.6, §13) | collage, masonry | a11y + RTL + reduced-motion checks | V2, V4, V5 |
| **V9** Cards / Product & Category / Content Blocks | card contract, grid/rail presets, category `cover` (DEF-3b), benefits icons/columns, shared block vocabulary in Custom Content, product `zoom` (§14, §15) | any commerce value control | commerce-firewall tests | V4, V5 |
| **V10** Theme Gallery / Workflow Polish | `ThemeDefinition` bundles, true Preview, Apply summary, built-in presets, Library thumbnails, hover action bar, drag reorder (§16, §17) | user-saved presets | DoD run | V5-V9 |
| **V11** Verification & Closure | six widths × AR/EN, long content, AT pass, parity harness, perf budgets, EN storefront seed (BL-9), closure report | new features | Horizon DoD (Master Gap §36) | all |

```
V1A (independent) ──────────────────────────────────────────────────► may ship before/alongside V0 approval
V0 ─┬─► V2 ─► V4 ─┬─► V6 ──┐
    │             ├─► V8 ──┼─► V10 ─► V11
    ├─► V3 ───────┤        │
    └─► V5 ─┬─► V7 (needs V6 for overlay-on-hero)
            ├─► V9
            └─► V1B (co-designed with V5)
```
Dependencies from the approved Master Gap are **preserved unchanged**; the only refinement is that **V1B is co-designed with V5** (its 768 surface and toolbar must follow the Content/Design/Layout IA) and V7's overlay-on-hero explicitly depends on V6.

**H5 (Undo/Redo & Recovery)** follows CUST-HV; the HV contract keeps the document plain immutable JSON and media referenced by id so Undo/Restore stay cheap. **H6 (Advanced Extensibility)** remains later.

---

## 20. Defect lanes (V1A / V1B)

| ID | Defect | Lane | Evidence |
|---|---|---|---|
| DEF-1 / BL-2 | custom header links not shown below `lg` (and not passed to `MobileMenu`) | **V1A** | Master Gap §27.2; baseline §5 (hidden at 390/430/768) |
| DEF-3a | stale `CategoryBanner.tsx` comment | **V1A** | Master Gap |
| DEF-4 / BL-5 | theme "Preview" opens the live store | **V1A** | baseline §4 |
| DEF-9 | stale `capabilities.ts` comment (version history DEFERRED) | **V1A** | Master Gap |
| DEF-10 | stale `HeroSection.tsx` prop doc | **V1A** | Master Gap |
| DEF-2 | `accentColor` unused | **V1B** (outcome fixed by §4.1: becomes a live palette role) | Master Gap |
| DEF-6 | section delete without confirmation (rule depends on IA + H5 undo) | **V1B** | Master Gap |
| DEF-7 / BL-3 | no editing surface at 768 px | **V1B** | baseline §3 |
| DEF-8 | builder header overflow when dirty at 768/1024 | **V1B** (subsumed by DEF-11) | H4-8 §10 |
| **DEF-11 / BL-1** | **builder toolbar primary actions (Publish, Save draft, Schedule) off-screen in the clean state (AR ≤ 1024, EN ≤ 1280); Publish unreachable by scrolling in AR at 390/430/768** — *new in V0* | **V1B by default; Owner may promote to V1A** (N-3) | baseline §3.1 |
| DEF-3b | category page ignores category image | V9 | Master Gap |
| DEF-5 | three max logos exceed the document cap; Base64 duplicated per version | V4 | Master Gap |
| BL-4 | Canvas ≈ 486 px wide at 1024 | V1B | baseline §3 |

**V1A is confirmed independent of new visual architecture:** each fix is local (a prop passed through, a label/href, comment edits) and none depends on `design`, palette, media or the new inspector IA.

---

## 21. External evidence gate (V0 record)

### 21.1 Method
Official pages re-fetched on 2026-10-05 (Salla help centre pages show "last updated" 31 Aug 2026 for homepage elements, announcement bar, design options and identity, 9 Sep 2026 for the media library; Daftra tutorials re-fetched and unchanged from the previous capture). Items not documented are recorded as *undocumented*, never as absent. Competitors are inputs, not specifications.

### 21.2 What AWJ adopts / changes / rejects

| Topic | Salla (official) | Daftra (official) | AWJ adopts | AWJ changes | AWJ rejects — why |
|---|---|---|---|---|---|
| **Media library** | One library; drag-drop + multi-upload; folders; search/filter; "choose from gallery" in every slot; alt AR/EN; assignment status; deleting removes it everywhere and substitutes a default (SAL-MEDIA) | Drag-drop or select to upload; delete icon in gallery editor (DAF-GALADD, DAF-GAL) | picker with Upload/Library, alt AR/EN, usage view | **block delete while referenced** (versions + scheduled publish make silent substitution unsafe); no folders | folder system, assign-to-product (products own their media) |
| **Image editing** | Product-image editor: crop, filters, colour levels, resize, shapes; alt ≤ 70 chars (SAL-IMG) | none documented | crop, aspect, rotate, zoom, reset | parameters stored on the usage, original untouched; focal point added | filters, levels, shapes, flip (no storefront-media use-case; Photoshop scope) |
| **Banner / hero design** | Enhanced Banner: expiry, title/sub, button+link, text & background colour, background image, alignment, white-button style, full-screen mode (SAL-HOME) | not documented (homepage editing needs "programming knowledge", DAF-TPLEDIT) | those controls as typed fields | colour via palette/hex + contrast engine; window start+end; ratios/variants | developer-grade editing (Daftra's weakness) |
| **Slider** | Photos Slider ≤ 10; Slider with bg colour/image, title, description, side image, button, "advanced layout controls"; Enhanced Slider 1-10 (SAL-HOME, SAL-ESL — autoplay undocumented) | gallery manager only | first-class `slider` (2-8 slides, per-slide CTA/overlay) | autoplay opt-in ≥ 5 s with pause, reduced-motion off | default autoplay |
| **Announcement bar** | multiple items; title/text/icon/link/expiry/pages/theme-version/colours/moving text; enable/disable/edit/delete (SAL-PROMO, SAL-ADV) | none found | field set, multiple items, ticker, targeting | + start date, gradients/palette, rotation, sticky, dismissal with defined persistence; version scope implicit | separate title field; per-version selector |
| **Header/footer** | sticky menu, dark bars, transparent header, light/dark footer, footer support channels/badges/social/app links (SAL-DESIGN, SAL-THEME-PAGES) | none | transparent + sticky modes, inverse surfaces | overlay-on-hero with defined legibility; **six footer layouts** + media/gradient/divider | fixed light/dark switch only |
| **Colour & type** | store colour + font list + custom font upload (name/weight/file); Twilight CSS variables document only `--color-primary*` and `--font-main` (SAL-IDENT; Twilight *Themes CSS Variables* `docs.salla.dev/421945m0`) | not documented | store colour/font, custom font later | full palette roles, heading/body families, scales, buttons, surfaces | single-hue model |
| **Design options** | per-version toggles: numerals, breadcrumbs, product-image height (cover/full), vertical layout, view-all, sticky menu, dark bars, add-to-cart confirmation, **image zoom** (SAL-DESIGN) | — | image fit presets, zoom toggle, sticky | as above | — |
| **Menus** | custom menus, link type (category/product/page/URL), target, icon, drag-drop, per-version assignment (SAL-MENU); Twilight header supports child items and **mega menus** (SAL-HDR) | item types (Category/Link/Home/Product/Contact/Content Page); up/down **and** drag; **≤ 2 submenu levels** with "↴" button (DAF-MENU, DAF-ORD) | typed targets, drag + keyboard buttons, named menus assigned to header/footer, icons | one child level now, schema reserves `mega` | raw internal paths; mega menu now (later) |
| **Theme / template** | Theme Store cards, Try/Preview/Buy, draft/scheduled/published, duplicate versions, can't delete active (SAL-STORE, SAL-THEMES) | Settings → Website Template → **View Demo → Apply → OK** (DAF-TPL) | Preview → Apply, version safety | preview over merchant data; Apply summary; Apply creates a **new Draft Version** (never overwrites live) | destructive apply |
| **Editor interaction** | hover label + action bar (Edit/Hide/Move/Duplicate/Add/Delete), drag handle, rename, delete confirmation (SAL-HOME, SAL-EDIT) | per-page designer, drag-drop (DAF-CP) | action bar, drag + buttons, labels, confirm-when-content | confirmation only when content exists; undo with H5 | — |
| **Content pages** | informational pages exist | create by name → drag-drop blocks → save (DAF-CP, DAF-CPE) | shared block vocabulary | authoring is a later backend horizon | — |
| **Product / category images** | ≤ 10 per product, drag order, GIF, YouTube (SAL-IMG) | multi-image gallery, ✔ main image, category image ≤ 20 MB (DAF-PIMG, DAF-CIMG) | category cover on category page | 5 MB cap, no GIF | GIF/animated (motion/a11y), video (CSP/LCP) |

*Undocumented in the pages read:* undo/redo, draft semantics, per-device design, slider autoplay, announcement dismissal.

### 21.3 Evidence gate for every later slice
Each slice report must (1) re-inspect the **current** relevant Salla and Daftra pages, (2) state what AWJ adopts/changes/rejects and why, (3) mark undocumented items as undocumented. The pre-seeded starting sources per slice are listed in Master Gap §36A.

---

## 22. Verification performed in V0

| Check | Result |
|---|---|
| Base SHA verified (`git fetch`; `5fd6e59…` is `origin/main`, PR #1230 merged) | ✔ |
| Fresh branch from latest `origin/main`; **no application file modified** (`git diff --name-only` limited to docs + screenshots/JSON under `docs/plans/store/`) | ✔ |
| Existing PHP tests that back the compatibility contract (§2.2): `StorefrontPresentationNormalizerTest` + `StorefrontPresentationLegacyCompatibilityForkTest` | **70 passed, 350 assertions** (unknown keys dropped, legacy documents preserved, forward behaviour) |
| Existing web unit tests for section capabilities / presentation config / page regions | **56 passed** |
| Browser baseline (real stack, six widths, AR/EN) | performed — `CUST-HV-V0-BASELINE-VISUAL-EVIDENCE-REPORT.md` |
| Documentation static validation | no markdown/docs linter is configured in the repository; manual checks: internal links/paths exist, tables well-formed, section cross-references resolve |

No test was modified, skipped or added; no app code was touched to make a check pass.

---

## 23. Risks and unknowns

| # | Risk / unknown | Mitigation |
|---|---|---|
| R-1 | Contract breadth ⇒ combinatorial state explosion (variants × colours × breakpoints × RTL) | typed capability flags; every variant defines mobile + RTL; snapshot matrix; golden fixtures |
| R-2 | Three-implementation drift (PHP + 2 TS) | generated resolver + fixtures + parity harness (§3.5/§2.2) |
| R-3 | Imaging capability on the server (N-1) | V2 evidence gate; STOP to Owner if unsuitable |
| R-4 | Production R2 configuration (N-2) | operational go-live checklist; gated picker state |
| R-5 | Contrast engine too strict/loose | auto-foreground first; block only informative text; override of warn-tier only; tests |
| R-6 | Document growth | non-default storage, 2 KB per-section budget, logos leave the JSON (V4) |
| R-7 | Overlap/transparent-header regressions in focus/legibility | preset-only, ≥ md only, keyboard traversal tests, fallback to solid |
| R-8 | Public media enumeration | published-reference gate, uniform 404 |
| R-9 | Delete vs scheduled/restored versions | block-with-usage, soft delete, publish validation |
| R-10 | Toolbar defect (DEF-11) ships unnoticed while features pile up | recommend promoting to V1A (N-3) |
| U-1 | CSP at the edge (U3 in Master Gap) | V2/V8 evidence gate; required before custom fonts |
| U-2 | Published-config caching vs time windows (U5) | dynamic scope or cache-key input (§8.4) |
| U-3 | Swiper RTL (U6) | verify before the Slider slice |
| U-4 | Screen-reader behaviour (U7) | NVDA + VoiceOver pass in V11 |
| U-5 | English storefront chrome unbaselined (BL-9) | seed EN content in V11 |
