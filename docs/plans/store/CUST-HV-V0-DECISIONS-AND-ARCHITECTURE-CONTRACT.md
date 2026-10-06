# CUST-HV V0 — Decisions & Architecture Contracts

**Horizon:** CUST-HV — Visual Design, Media & Merchant UX Completion (runs **before** CUST-H5; H4 stays CLOSED)
**Slice:** V0 — Decisions & Contracts (documentation / architecture only)
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `155b2a3efb4bda1a77ae308ffd92f33c3a0dc28d` (`origin/main` after the final sync; includes PR #1230 and **AWJ-PRODUCT-MEDIA-3A.2**, PR #1229). Authored at `5fd6e596c2217e5b524744a24156db615a9933a7`; the sync brought in only `Dockerfile`, CI workflows, `tests/Fixtures/gd-runtime-smoke.php` and the 3A.2 report — **no `app/`, `web/` or `storefront/` runtime code changed**, so the contracts and the browser baseline remain valid.
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
| D-03 | O3 | **Server-generated modern variants**: WebP (JPEG fallback), a practical width ladder, original retained where required, explicit width/height. No external image platform unless V2 evidence proves the production runtime unsuitable. | FROZEN (GD runtime proven; library/tuning → V2, N-1) | §7.5 |
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
| D-33 | Owner sync 2026-10-05 | **DEF-11 / BL-1 (builder toolbar primary actions off-screen) is promoted to V1A**, narrowly scoped: Save / Publish / Exit (the required primary actions) reachable at 390 · 430 · 768 · 1024 · 1280 · 1440 in AR and EN, via a responsive overflow mechanism where necessary; **no full toolbar redesign, no V5 Inspector/IA pre-implementation**. DEF-8 (dirty-state sibling of the same overflow) is subsumed. **DEF-7 / 768 inspector stays V1B.** | FROZEN | §20 |

### 1.2 Decisions that could not be safely frozen (and why)

| ID | Item | Why not frozen | Handling |
|---|---|---|---|
| N-1 | **Imaging implementation choices** — the server imaging **capability is PROVEN** | **Proven Existing Capability** (`AWJ-PRODUCT-MEDIA-3A.2-IMPLEMENTATION-REPORT.md`, PR #1229, merged as `155b2a3`): the production Docker image (`php:8.3-apache`) loads **GD with JPEG, PNG and WebP support**; the runtime smoke (`tests/Fixtures/gd-runtime-smoke.php` — load, `gd_info()` format flags, create/read, resize 4×2→2×1 preserving the ratio, write JPEG and WebP) runs during the image build and in `runtime-smoke.yml`; production-image Docker smoke and CI = **PASS**. Not part of that slice and therefore still absent: Imagick, the `exif` extension, Intervention Image, any derivative generation, and an actual Railway deploy of the image. | The Owner decision that image variants are **server-generated is NOT reopened** (only V2 evidence proving the production runtime unsuitable could do so → then **STOP and return to Owner**). **Still open for V2:** (a) raw GD directly vs a pinned higher-level library such as Intervention Image (planned separately as AWJ-PRODUCT-MEDIA-3A.3); (b) dependency/version choice; (c) memory limits; (d) concurrency/runtime cost; (e) real-image quality tuning; (f) final variant quality/compression values; (g) EXIF-orientation handling (no `exif` extension in the image). V2 must also coordinate with the product-media derivative work (AWJ-PRODUCT-MEDIA-3 `thumbnail`/`card`) so AWJ ends up with **one** imaging path, not two |
| N-2 | Production values of `PRODUCT_MEDIA_R2_ENABLED` / `CATEGORY_MEDIA_R2_ENABLED` / R2 credentials (U1) | Not readable from the repo | **Operational go-live prerequisite**, not a decision (§7.1). Customizer media is R2-only and fail-closed |
| N-3 | ~~DEF-11 lane~~ — **RESOLVED**: promoted to V1A by the Owner (D-33) | — | no longer open |
| N-4 | Exact **overlap preset geometry** (O23) | Needs a visual prototype to prove focus-ring/clipping safety | Preset *mechanism* frozen; numeric geometry finalised in V5/V6 with six-width evidence |
| N-5 | **Font catalogue** (which pairs) | Licensing and subsetting need slice-time verification | Rules frozen: self-hosted, OFL-class licences only, ≥ 6 pairs, Arabic+Latin, `font-display: swap`, subset |
| N-6 | Variant **numeric ladder** and quality | Needs measurement on real images | Ladder frozen as 480/768/1280/1920 (+160/320 thumbnails); quality tuned in V2 |

All other Owner decisions were frozen as given; **no contradiction with repository evidence** was found that would force a deviation.

### 1.3 Amendments — PR #1232 automated review (Codex, 2026-10-05 and 2026-10-06)

Twelve architecture-contract blockers have now been raised as review threads on PR #1232 across two review passes. Each is an **amendment to an already-frozen decision**, resolved below rather than left open, because the review correctly identified a self-contradiction or an unbounded-cost defect in this document (not a new feature request). Resolution detail lives in the cross-referenced section; this table is the audit trail.

| ID | Amends | Finding (Codex thread) | Resolution |
|---|---|---|---|
| AMEND-1 | D-02 / §7.8 | Public media route would be a raw host-resolved Laravel URL; the deployed storefront's browser cannot supply the server-only forwarded-host/gateway headers that route needs (same constraint already solved for product media by `storefront/src/app/api/storefront/media/[id]/route.ts`) | Published Customizer media is served through a **same-origin Next.js proxy route**, never a direct Laravel URL; see §7.8 |
| AMEND-2 | D-03, D-04 / §7.5, §7.6 | Per-usage crop/rotate/focal (`MediaRef`) cannot be represented by one asset-level `variants` value; two different Hero/Banner crops of the same asset had no way to coexist | **Deterministic transform-key derivative model**: unmodified-frame requests use the existing asset-level base variants; any usage with a crop/rotate/focal/fit different from the default frame is addressed by a key derived from the normalised transform + source id + width + format, so two crops never collide; see §7.5/§7.6 |
| AMEND-3 | D-08 / §4.5, §9.3 | Whole-image average luminance can pass the publish gate while the actual region behind the text has near-zero contrast | Average luminance becomes **advisory only**; the publish gate uses **region-specific sampled luminance** (the content's 3×3 placement cell) and **exact overlay-compositing math** to either pass or require a guaranteed-sufficient scrim; see §4.5 |
| AMEND-4 | §7.5 cache policy | `public, max-age=31536000, immutable` lets a shared cache keep serving media after it is unpublished/deleted, defeating the Published-reference gate | Public route moves to a **bounded, revalidating** cache policy (`max-age=300, must-revalidate` + content-hash `ETag`), so revocation takes effect within minutes instead of never; see §7.5 |
| AMEND-5 | D-03 / §7.2, §7.5, §7.8, §7.10 | No model distinguished "variant rows exist" from "variant generation actually succeeded"; a race or failure could let a document publish before its derivatives exist | Explicit **derivative readiness states** (`pending`/`ready`/`failed`) on both base variants and transform derivatives; Publish/scheduled-publish **fails closed** until the document's required derivative set is `ready`; MediaPicker exposes `failed` with Retry; see §7.2/§7.5/§7.8/§7.10 |
| AMEND-6 | D-30 / §7.9, §16 | "Themes copy references to AWJ-owned read-only media" contradicts §7.8's tenant-only `MediaRef` validation — no documented exception existed | Theme assets move to a **separate, global, tenant-less namespace** (never a `storefront_media` row); **Apply clones** each referenced asset into a new tenant-owned `storefront_media` row and rewrites the draft's `MediaRef`s to the clone — no tenant-isolation exception anywhere; see §7.9/§16 |
| AMEND-7 | D-15 / §8.4, §12 | "Invalid ISO → dropped" and "`endsAt > startsAt` else dropped" silently turn a *restricted* window into *unrestricted* visibility on a validation failure — the opposite of fail-closed | **Draft preserves** invalid input for correction; **Publish/scheduled-publish rejects** invalid timestamps or `endsAt <= startsAt` with a path-specific `422`, exactly like §7.8's media validation; an invalid window is never normalised to "no window"; see §8.4/§12 |
| AMEND-8 | AMEND-3 / §4.5, §7.2 | AMEND-3's `region_luminance` is sampled once on the **original asset**; after a per-usage crop/rotate/zoom (§7.6) the content cell the merchant actually sees can hold entirely different pixels than the original cell the gate checked, so a low-contrast *transformed* composition could still pass | Each transform derivative gets its **own** `region_luminance`, sampled on the rendered (cropped/rotated/zoomed) pixels when the derivative is generated; the §4.5 gate reads the asset's grid only for a no-transform usage, and the matching derivative's grid for a transformed one — never the original substituted for a crop; see §4.5, §7.2, §7.5 |
| AMEND-9 | AMEND-2/AMEND-5 / §7.5, §7.8, §7.10 | Generating every referenced `transformKey` synchronously inside Publish is unbounded: a maximum-size document (30 sections, an 8-slide Slider, mobile overrides) can require thousands of GD operations in one request, exceeding PHP/request limits | Derivative generation moves to **save time** (bounded to the usages actually changed by that save, hard-capped at 16 new `transformKey`s inline; any excess defers to a bounded background sweep, an Artisan scheduled command). **Publish only verifies readiness — it never generates.** MediaPicker gets scoped processing/failed/queued states with per-usage Retry; see §7.5, §7.8, §7.10 |
| AMEND-10 | §7.8, §13.2, §15 | `MediaRef`/the data model had no decorative flag, although §7.8 already permitted missing alt "when flagged decorative" and Gallery promised one — an intentionally decorative image with an empty alt had no valid representable state | Added `decorative?: boolean` to `MediaRef` (per **usage**, not per asset): `true` ⇒ empty alt valid, renderer emits `alt=""`; false/absent on an informative image ⇒ alt required before Publish. Normalisation, publish validation, Gallery and the content-block vocabulary all updated; see §3.2, §7.8, §13.2, §15 |
| AMEND-11 | AMEND-2 / §7.5, §7.6 | The transform key serialised every persisted edit parameter except `CropParams.zoom`; two usages with identical crop/focal/rotate/fit but different 1-4× zoom would collide on one immutable key and one usage would silently receive the other's framing | `zoom` (rounded to 2 decimal places) is included explicitly in `normalizedTransform` — it is not derivable from the crop rectangle, since it crops the rendered output a second time within the already-selected crop; see §7.5, §7.6 |
| AMEND-12 | AMEND-1 / §7.5, §7.8 | The base-variant vocabulary (`480w`, …) had no format component, so a renderer could not construct distinct WebP/JPEG URLs, and content negotiation (the implicit alternative) was undefined — no `Vary: Accept`, ambiguous cache semantics | Format becomes an **explicit path segment**: `/{mediaId-or-transformKey}/{width}w.{format}` (`format ∈ {webp, jpg}`), e.g. `480w.webp`, `480w.jpg`, `{transformKey}/768w.webp` — chosen over content negotiation because it stays simple to reason about with the AMEND-1 proxy and the AMEND-4 `ETag` cache; see §7.5, §7.8 |

None of D-01, D-06, D-07, D-09 … D-14, D-16 … D-29, D-31 … D-33 are touched by these amendments; §20/§20.1 (DEF-11/V1A) and the DEF-7/V1B placement are explicitly unaffected and unchanged. AMEND-8 through AMEND-12 refine AMEND-2/AMEND-3/AMEND-5/AMEND-1 themselves (a second-pass correction on this document's own first set of fixes, not on an original D-ID), so no further "D-" row is affected beyond what the first pass already touched.

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
                  crop?: CropParams; rotate?: 0|90|180|270; alt?: string; decorative?: boolean };  // AMEND-10
type CropParams = { x: number; y: number; w: number; h: number; aspect: AspectKey; zoom?: number }; // normalised 0-1; zoom 1-4, included in transform identity (AMEND-11, §7.5)
type AspectKey = '16:5'|'3:1'|'16:9'|'4:3'|'1:1'|'4:5'|'free-locked';
type Gradient = { kind: 'gradient'; from: ColorRef; to: ColorRef; direction: Direction };   // two colours, bounded direction
```

**`MediaRef.decorative` (AMEND-10, resolves a PR #1232 review finding).** Per **usage**, not per asset — the same uploaded image can be informative in one placement and decorative in another (e.g. a texture used as a Gallery image vs. a product photo). `decorative: true` makes an empty/absent `alt` **valid** for that usage and the renderer emits `alt=""` (never omits the attribute — screen readers must see an explicit empty string, not a missing one, to skip the image). `decorative: false` or absent on an **informative** image (any `MediaRef` not flagged decorative) requires a non-empty `alt` before Publish (§7.8). Normalisation: non-boolean values are dropped (fail-closed to "not decorative", the safer default — an image silently losing its decorative flag only produces an avoidable alt-required warning, never a missing-alt image shipped live).

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

### 4.5 Contrast contract (D-08, amended — AMEND-3)

1. **Auto foreground first.** For each text-on-surface pair the resolver chooses the foreground (palette `text`/`heading`, or a light/dark neutral, or a brand tint) that meets the target. Because a light or dark neutral always achieves ≥ 4.5:1 against any opaque background, **no background colour is ever rejected**.
2. **Targets (WCAG 2.1 AA, relative-luminance formula already implemented in `tokens.ts`).** Normal text **≥ 4.5:1**. Large text (≥ 24 px, or ≥ 18.66 px bold) and applicable non-text UI (control boundaries needed to identify a control, focus indicators, meaningful icons/graphics) **≥ 3:1**. **3:1 is never accepted for normal text.** Logos, decorative elements and disabled controls are exempt.
3. **Effective background:** gradient → each stop is checked, worst wins; semi-transparent colours are composited over the effective backdrop. **Image backgrounds — region-specific, not whole-image average (AMEND-3):** the server samples luminance on a **3×3 logical grid** of regions aligned with the content-position grid already used for Hero/Banner content placement (§8.3), mirrored for RTL. The contrast check for a given text/CTA block uses the **sampled luminance of the specific cell its content occupies** (or, if content spans cells, the worst of the cells it overlaps), never the whole-image average. **The grid used must match what is actually rendered (AMEND-8):** a usage with no crop/rotate/focal uses the **asset's own** `region_luminance` (`storefront_media`, sampled at upload); a usage with a transform uses that **transform derivative's own** `region_luminance` (`storefront_media_derivatives`, sampled when the derivative is generated — §7.5) — the original asset's grid is never substituted for a cropped/rotated usage, because a crop can place entirely different pixels in a given content cell than the untransformed image had there. An overlay on top of the correct region is **exact compositing math** (a known alpha/colour layer over a known backdrop luminance is deterministic arithmetic, not an estimate), so once an overlay of sufficient alpha is applied the resulting ratio is **guaranteed**, not advisory.
4. **Warn tier:** within ~0.5 of target on a *computable* pairing (hex/gradient-stop pairs, or an image region **before** any overlay is applied), hover/focus states whose colours differ from rest — shows ratio, nearest compliant colour, one-click apply; merchant may proceed.
5. **Block tier (publish gate):** informative text below 4.5:1 (normal) or below 3:1 (large text/applicable UI) **cannot be published** until resolved — **including text over a media background**, evaluated per point 3 above. The block always carries a guaranteed one-click fix: for hex/gradient pairings, the nearest compliant foreground or background; for a media background, the **minimum overlay alpha that mathematically guarantees the threshold** against that region's sampled luminance (computed exactly, bounded to the existing `Overlay.alpha ≤ 90` cap), or moving the content to a region whose sampled luminance already meets the target without an overlay. If alpha 90 cannot reach the target against an extreme region luminance (practically rare), the fix offers repositioning the content instead — publish stays blocked until one of the two is applied.
6. **Authority:** the editor computes advisory results live; the **PHP publish step recomputes** with the same algorithm — region-specific luminance and overlay compositing included — and rejects a block-tier document (`422` with machine-readable `code` per offending path, e.g. `homepage.sections[i].design.text`). The editor can therefore never be bypassed.
7. **What stays advisory:** the whole-image `avg_luminance` is a cheap preview/thumbnail signal (e.g. MediaPicker sorting, a quick merchant-facing hint before a section is even placed) and is **never** the sole input to the block-tier gate. Anything the server genuinely cannot compute exactly (no region sampled yet, e.g. a brand-new upload mid-request, or a transform derivative that is still `pending`/`failed` — AMEND-8/AMEND-9) is treated as the worst case for that image (block, not warn) rather than silently passing; this is the same readiness check §7.8 already performs before Publish, so a document can never reach the contrast gate with an un-sampled region in the first place.

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
| `width`, `height`, `avg_luminance`, `dominant_colour` | measured at upload; `avg_luminance` is **advisory only** (§4.5.7) |
| `region_luminance` (json, 9 floats) | **AMEND-3:** luminance of a 3×3 logical content-position grid, row-major, logical (not physical) orientation so the renderer mirrors it under RTL; this — not `avg_luminance` — feeds the §4.5 publish gate, but **only for usages with no transform** (AMEND-8); a cropped/rotated usage reads the matching row in `storefront_media_derivatives` below instead |
| `alt_ar`, `alt_en` | defaults; per-usage `alt` override lives in `MediaRef` |
| `storage_key`, `variants` (json) | base (asset-level) variant set; **never exposed by any API** (no path/disk/bucket leakage) |
| `variants_state` | **AMEND-5:** `pending` \| `ready` \| `failed` — readiness of the base variant set; today resolves to `ready` synchronously before the upload response returns (`QUEUE_CONNECTION=sync`), modelled explicitly so a future real queue needs no contract change |
| `state` | `active` · `deleted` (soft) · `purged` |
| `deleted_at`, `purge_after`, `uploaded_by`, timestamps | |

R2 key: `tenant/{tenant_id}/storefront-media/{media_id}/{file}` — tenant segment derived by `R2StorageService` from `TenantContext`; callers never supply a prefix or key; filenames are server-generated.

**`storefront_media_derivatives` (new, AMEND-2/AMEND-5)** — one row per **transform-derived** file (crop/rotate/focal/fit different from the default full frame); the base (no-transform) variant set stays on `storefront_media.variants` above and is unaffected:

| Column | Notes |
|---|---|
| `id` (uuid), `media_id` (FK → `storefront_media`, same tenant by construction) | |
| `transform_key` | `sha256(media_id ':' normalized_transform ':' width ':' format)` truncated to 32 hex chars — see §7.5 for `normalized_transform` (now includes `zoom`, AMEND-11) |
| `width`, `format`, `storage_key` | one row per (transform, width, format) combination actually used; `format` is addressable in the public path (AMEND-12, §7.8) |
| `region_luminance` (json, 9 floats) | **AMEND-8:** sampled on the *rendered* (cropped/rotated/zoomed) pixels when this derivative is generated — the asset's own `region_luminance` is never substituted here, because the cropped frame can show entirely different pixels per cell than the original |
| `state` | `pending` \| `ready` \| `failed` (AMEND-5) |
| `generated_at` / `created_at` | **AMEND-9:** generation is triggered when the usage's transform is saved (bounded per save, not at Publish) — see §7.5. Derivatives are immutable once `ready` — the key is content-derived, so there is nothing to invalidate |

Unique index `(media_id, transform_key, width, format)`: two usages that resolve to the same normalised transform share one derivative row (cheap re-use); two usages with *different* crops of the *same* asset always resolve to different `transform_key`s and therefore different rows — they can never collide or overwrite each other.

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

`jpg/jpeg/png/webp` only; no SVG, no GIF/animated; max 5 MB (same as product media); magic-byte sniffing (not extension); decoded dimensions: min 320 px on the short edge (warn below the per-usage recommendation, block below 320), max pixel count 40 MP, max 8192 px per edge; strip EXIF (privacy) after applying orientation — the production image has **no `exif` extension** (3A.2 deliberately left it out), so orientation handling is a V2 choice (add `exif`, or a library that reads orientation); per-tenant library quota (plan-limit hook, default to be set in V2). Upload rate limiting reuses the workspace write limiter.

### 7.5 Variants and derivative identity (D-03, amended — AMEND-2, AMEND-4, AMEND-5, AMEND-8, AMEND-9, AMEND-11, AMEND-12)

**One authoritative model for two cases.** A `MediaRef` usage either applies **no transform** (default full frame — the common case: a plain image drop with no crop) or a **transform** (crop/rotate/focal/fit different from the default — §7.6). The two cases are served by two distinct, non-conflicting layers so that per-usage transforms (which are authored on the *usage*, not the asset) can never collide with — or be confused for — the asset-level files:

- **Base variants (unchanged mechanism, asset-level):** generated once at upload, after reading orientation, as **WebP** at widths **480 / 768 / 1280 / 1920** (+ **160 / 320** thumbnails), JPEG fallback for clients without WebP, original retained (source of truth for every future crop), explicit `width`/`height` stored per variant (`storefront_media.variants`). These serve any usage with no transform, and are the thumbnail source in the MediaPicker library.
- **Transform derivatives (new, `storefront_media_derivatives`, §7.2):** when a usage's `crop`/`rotate`/`focal`/`fit`/`zoom` differs from the default frame, its rendered file is addressed by a **deterministic transform key**: `transformKey = sha256(mediaId + ':' + normalizedTransform + ':' + width + ':' + format)` truncated to 32 hex chars, where `normalizedTransform` serialises `crop{x,y,w,h,aspect}` (rounded to 4 decimal places), `rotate`, `focal{x,y}` (rounded to the nearest integer), `fit` **and `zoom`** (rounded to 2 decimal places on its 1-4 range — AMEND-11) in one fixed field order — so trivially-equal inputs (floating-point noise) collapse to the same key, and genuinely different framings always diverge. **`zoom` is included explicitly, not assumed derivable from the crop rectangle:** two usages can share an identical `crop{x,y,w,h,aspect}`/`focal`/`rotate`/`fit` and still choose different 1-4× `zoom` values, which crop the *rendered* frame further within the already-cropped rectangle — omitting it would let two visually different framings collide on one immutable key. **The key is derived by the renderer/server from the `MediaRef`'s own fields — it is never authored or stored in the presentation document itself** (§3.2's `MediaRef` type is unchanged). Two different Hero/Banner usages of the same source asset therefore address two independent, immutable files that can never overwrite each other, satisfying the per-usage model in §7.6 without weakening the asset-level base variants that still serve the no-transform case.
- **Generation timing — bounded, at save, never bulk at Publish (AMEND-9).** A maximum-size document (30 sections, an 8-slide Slider with independent crops, mobile overrides) could require thousands of GD operations if generated synchronously inside one Publish request — far beyond a safe PHP request budget. Generation instead happens when the **specific usage's transform is saved** (the builder's per-section/per-slide content-save call, not a bulk document save): the server diffs the saved `MediaRef`s against the previously stored ones, and generates only the `transformKey`s that are **new or changed** by that save. This is naturally bounded to a handful of derivatives per request (one user edit = one usage), consistent with `QUEUE_CONNECTION=sync` (no real background worker exists to enqueue onto, the same constraint already documented for bulk product import). **Hard bound:** a single save generates at most **16** new/changed `transformKey`s inline (covering every normal single-usage edit, including its width/format fan-out); any additional new `transformKey`s in that same save (e.g. a bulk action such as "apply this crop to all slides", or a large direct-API payload) are persisted as `pending` and left to a **bounded background sweep** — an Artisan scheduled command (the same pattern as the §7.9 purge reconciler), run frequently (e.g. every minute) and processing a capped batch (e.g. ≤ 50 pending derivatives) per run until the queue drains. Each generated derivative also gets its `region_luminance` sampled on the *rendered* pixels at the same time (AMEND-8, §7.2), never copied from the asset.
- **Publish only verifies, never generates (AMEND-9).** Publish and scheduled-publish validation (§7.8) **only checks** that every required `transformKey`'s row exists with `state = ready`; it performs **no** generation of any kind. A document referencing a `transformKey` that is still `pending` (saved recently, not yet swept) or `failed` fails Publish closed with a path-specific `422` (§7.8) — the merchant retries from the MediaPicker/crop UI (§7.10) rather than Publish silently waiting on or triggering bulk work.

**Public delivery and cache policy (AMEND-1, AMEND-4):** see §7.8 for the same-origin proxy requirement and the revised `Cache-Control`. The 1-year `immutable` policy originally specified here is **superseded** — it let a shared cache keep serving a media id after it was unpublished/deleted, bypassing the Published-reference gate. Renderers emit `srcset`/`sizes` from the ladder and `width`/`height` to prevent CLS exactly as before; only the cache header and the delivery path change.

**Proven Existing Capability (PR #1229 / `155b2a3`):** GD with JPEG, PNG and WebP is loaded in the production Docker image, with resize/read/write smoke and production-image Docker smoke passing. **Still open for V2 (N-1):** raw GD vs a pinned higher-level library (e.g. Intervention Image, AWJ-PRODUCT-MEDIA-3A.3), dependency/version, memory limits, concurrency/runtime cost, real-image quality tuning, final quality/compression values, EXIF orientation. The Owner decision that variants are server-generated is **not reopened**; **no external image platform** unless V2 evidence proves the production runtime unsuitable — then STOP for Owner review. V2 shares a single imaging path with the product-media derivative work (MEDIA-3), and that path now covers both the base-variant and transform-derivative generators.

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

**Identity (AMEND-2, AMEND-11):** these parameters — **including `zoom`** — are exactly the inputs to §7.5's `normalizedTransform`. Storing them per usage (never per asset) is what makes two different crops of the same asset addressable without conflict — the usage's own crop/rotate/focal/fit/zoom *is* the transform key's input, so there is nothing to additionally author or reconcile; the model in §7.5 was built to fit this section's existing per-usage storage, not the other way round. `zoom` is kept as an explicit, independently persisted parameter (not derived from the crop rectangle) because it crops the *rendered* output a second time within the already-selected crop; two usages that save identical `crop`/`focal`/`rotate`/`fit` but different `zoom` are visually different framings and must address different derivatives.

### 7.7 Responsive media override (D-05)

`background.media.mobile?: MediaRef` (and per-slide `mobile?` for Slider; Banner/Hero image slots). Rules: same semantic content (**alt, link, text, CTA shared**); used below `md` via `<picture>` art direction (`media="(max-width: 767px)"`); never changes layout structure; editor shows both previews; absent ⇒ the default media. Not offered for Gallery/Cards in HV.

### 7.8 References, publish validation, public access (amended — AMEND-1, AMEND-4, AMEND-5, AMEND-9, AMEND-10, AMEND-12)

- Document stores only `MediaRef` (id + edit parameters) — never URLs, paths, dimensions or luminance.
- **Draft save** tolerates dangling ids (the Canvas shows a "media removed" placeholder). **Publish** (and version-publish/schedule-dispatch) validates, for every `mediaId` referenced:
  1. exists, belongs to the tenant, is `active` (unchanged);
  2. **(AMEND-10) alt/decorative:** `decorative === true` ⇒ valid regardless of `alt` (empty/absent is correct); otherwise (informative — `decorative` false or absent) a non-empty `alt` is required;
  3. **its base `variants_state` is `ready`** (AMEND-5) — a media id whose base variants are still `pending`/`failed` cannot be published;
  4. **(AMEND-9) every `transformKey` the document's usages resolve to (§7.5) has a `storefront_media_derivatives` row with `state = ready`** — Publish **only verifies this; it never generates a derivative**. A `transformKey` that is `pending` (saved but not yet processed — §7.5) or `failed` fails Publish closed on that specific path; there is no fallback generation at Publish time.
  Any failure returns `422` with a machine-readable `code` + the offending path; scheduled publish that fails validation fails closed and leaves the previous Published state intact (existing H1 guarantee). Banner/Announcement `window` validation follows the same fail-closed pattern — see §8.4.
- **Public delivery is a same-origin proxy, never a raw Laravel URL (AMEND-1), with an explicit format segment (AMEND-12).** The deployed storefront's browser cannot supply the server-only forwarded-host/gateway headers the host-resolved Laravel route requires — exactly the constraint `storefront/src/app/api/storefront/media/[id]/route.ts` already solves for product media via `toRenderableMediaUrl()`/`AWJ_MEDIA_PROXY_PATH_PREFIX`. Customizer media follows the identical pattern: a new Next.js route handler `storefront/src/app/api/storefront/media/customizer/[id]/[file]/route.ts` forwards `FORWARDED_HOST_HEADER`/`GATEWAY_SECRET_HEADER` to Laravel's `/store/v1/media/customizer/{id}/{file}` and streams back the body, content type, and (revised) `Cache-Control`. **Format is an explicit path segment, not content negotiation** (no `Accept`/`Vary` ambiguity, simplest to reason about with the proxy + `ETag` caching in AMEND-4): `{id}` is either the plain `mediaId` (base variant) or a `transformKey` (derivative, which already encodes its source `mediaId` — the origin resolves `mediaId` from the derivative row to run the Published-reference gate below), and `{file}` is `{width}w.{format}` or `thumb-{160|320}.{format}` with `format ∈ {webp, jpg}` — e.g. `/{mediaId}/480w.webp`, `/{mediaId}/480w.jpg`, `/{mediaId}/thumb-160.webp`, `/{transformKey}/768w.webp`. **No renderer (Canvas or storefront) ever emits the raw `/store/v1/media/customizer/...` path to the browser** — only the `/api/storefront/media/customizer/{id}/{file}` proxy path, so format, variant and transform identity all travel end to end explicitly.
- **Published-reference gate (unchanged authority, at the Laravel origin the proxy calls):** that origin route serves a media id **only if the resolved storefront's *Published* config references it**; otherwise uniform 404, which the proxy passes through unchanged. A small denormalised "published media ids" set is rebuilt at publish time; there is no per-request JSON scan.
- **Cache policy respects revocation (AMEND-4):** the previously specified `public, max-age=31536000, immutable` is **replaced** with `public, max-age=300, must-revalidate` plus a content-hash `ETag` (the base variant's content hash, or the `transformKey`, which is itself content-derived) on **both** the Laravel origin response and the Next.js proxy's pass-through. A shared/CDN cache may serve a hit for at most 5 minutes without re-asking the origin; a revalidation request is a cheap conditional `GET` (304 when nothing changed, since the bytes behind an unchanged `ETag` never change) so there is no real performance cost, but once a merchant unpublishes or deletes a media id the reference gate takes effect for every cache within one revalidation window — never "indefinitely". The workspace signed route is unaffected (`private, max-age=600`, already short and non-shared).
- Legacy: existing https `imageUrl` and Base64 logos continue to render; they migrate lazily on next save; **no bulk rewrite**.

### 7.9 Delete policy and lifecycle (amended — AMEND-6)

Soft delete only when unreferenced (§7.3). A reconciler purges `deleted` assets after `purge_after` (default 30 days) and removes any R2 object with no row after a grace period, by prefix-scoped operations (never bucket listing exposed to controllers). Restore of an older version (H5) re-validates references; a restored version that points to a purged asset shows the missing-media placeholder and cannot be published until resolved.

**Theme-owned art never becomes a cross-tenant `MediaRef` (AMEND-6).** Theme source assets live in a **separate, global, tenant-less namespace** (§16) — never a `storefront_media` row, so §7.8's tenant-only validation needs no exception. **Applying** a theme that references `assets` **clones** each one into a brand-new tenant-owned `storefront_media` row (R2 server-side copy into `tenant/{tenant_id}/storefront-media/{new_media_id}/{file}`, base variants either copied alongside or regenerated — V2 choice, not a contract change either way) and rewrites the resulting Draft Version's `MediaRef`s to point at the clone. From that point on the clone is ordinary tenant-owned media: it is deletable, replaceable, counted in usage, and indistinguishable from anything the merchant uploaded. Deleting or retiring the AWJ-owned source asset later **never** affects any tenant's already-applied clone (full independence after Apply), and deleting a tenant's clone never touches the global source. **Trade-off, documented rather than hidden:** each tenant that applies a theme gets its own stored copy of that theme's stock imagery (a handful of curated images per theme, not a library) — a small, bounded storage cost, accepted because the alternative (a shared cross-tenant reference) is a tenant-isolation exception this document will not introduce. `sha256`-based de-duplication *within* a tenant (already in §7.2) still applies if the same tenant applies the theme again or re-uploads the same bytes; cross-tenant de-duplication is a V2+ optimisation, not required for correctness.

### 7.10 Merchant UX (MediaPicker) (amended — AMEND-5, AMEND-9, AMEND-10)

Upload (drag-drop, multi-file, progress, per-file error) ∣ Library (grid, search, unused filter) tabs; selected media card: thumbnail, name, dimensions, alt AR/EN, **decorative toggle** (AMEND-10 — when on, the alt fields disable and grey out, since `decorative: true` makes an empty alt correct rather than missing), **Edit image**, Replace, Remove, "Used in N places". States defined for loading, empty, uploading, **processing** (`variants_state = pending` — variant generation in progress; near-instant today since base-variant generation runs inline under `QUEUE_CONNECTION=sync`, but modelled as an explicit state so a future real queue needs no UX change), **ready/success** (`variants_state = ready`), **failed** (`variants_state = failed` — a clear error plus a **Retry** action that re-runs generation on the same asset; the asset stays visible and renameable but cannot be selected into a design until it is `ready`), validation error, network error, stale (deleted elsewhere), permission denied and **capability-gated** (R2 not configured).

**Per-usage transform readiness (AMEND-9) — distinct from the asset-level states above, because derivative generation now happens at save, not at upload:** after a crop/rotate/focal/fit/zoom edit (§7.6) is saved, the editor shows that specific usage as **processing** until its `transformKey` row reaches `ready` (typically sub-second — a bounded handful of resize/encode operations, §7.5); **failed** shows a scoped error with a usage-level **Retry** (re-generates only that one `transformKey`, not the whole asset or document) and keeps the previous framing visible in the Canvas so the merchant is never looking at a broken image while retrying; if the edit was part of a bulk action that exceeded the 16-per-save bound and was deferred to the background sweep, the usage shows **queued** (a sub-state of processing — "will be ready shortly," no retry needed yet, the sweep itself persists `failed` if it ultimately fails). Publish is blocked (§7.8) while any referenced usage is processing/queued/failed, surfaced inline at the Save/Publish toolbar (not only inside the picker) so the merchant is not left guessing why Publish is disabled. Sheet on mobile, dialog on desktop; focus returns to the opener.

### 7.11 Tests (V2/V4) (amended)

Tenant A/B isolation for every call · foreign and unpublished id probes on the public route · signed-URL expiry/tampering · mime/magic-byte/size/dimension rejection · soft-delete with usage → 409 · reconciler idempotency · publish-time dangling-reference rejection · scheduled-publish fail-closed · no path/disk/bucket in any response (schema assertion) · R2-unavailable → gated state, never ephemeral fallback.

**Added by the amendments:** no renderer output (Canvas HTML, storefront HTML, SSR payload) ever contains the raw `/store/v1/media/customizer/` host-resolved path — only the `/api/storefront/media/customizer/{id}/{file}` proxy path with an explicit format segment (AMEND-1, AMEND-12) · two usages with different crop params (including two usages differing **only** in `zoom`) on the same source asset resolve to two different `transformKey`s and two independent, non-overwriting derivative rows (AMEND-2, AMEND-11) · after unpublish/delete, a request replaying a previously-cached response's `ETag` gets a fresh 404 within one revalidation window, not a stale 200 (AMEND-4) · publish is rejected (`422`) when a referenced media id's `variants_state` or a required `transformKey`'s state is not `ready`, **and Publish never itself triggers generation** — a `pending`/`failed` derivative at Publish time stays exactly that (AMEND-5, AMEND-9) · a saved crop/rotate/focal/zoom edit generates its derivative's own `region_luminance` from the rendered pixels, and the §4.5 contrast gate for that usage reads the derivative's grid, never the original asset's (AMEND-8) · a single save that would require more than 16 new derivatives defers the overflow to `pending` and the background sweep drains it within a bounded number of runs, never inline at save or at Publish (AMEND-9) · an image flagged `decorative: true` with no `alt` publishes cleanly and renders `alt=""`; the same image with `decorative` false/absent and no `alt` is blocked at Publish (AMEND-10) · applying a theme twice on two different tenants produces two distinct tenant-owned `storefront_media` rows with no row visible to, or deletable by, the other tenant (AMEND-6, tenant-isolation test).

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
- **Semantics (amended — AMEND-7):** `startsAt` inclusive, `endsAt` exclusive; both optional. **Draft save preserves exactly what the merchant entered**, including a malformed timestamp or `endsAt <= startsAt` — it is corrected later, never silently rewritten; the Canvas shows an editor-only **"invalid window"** chip (distinct from *scheduled*/*expired*) and keeps the section visible and editable like any other draft content. **Publish (and scheduled-publish dispatch) rejects the document** with `422` and a path-specific error (e.g. `homepage.sections[i].content.window.endsAt`) if either timestamp fails ISO-8601 parsing or if `endsAt <= startsAt`; a scheduled publish that fails this check fails closed and leaves the previous Published state intact (the same H1 guarantee as §7.8's media validation). **An invalid or malformed window is never normalised to "no window" (unrestricted visibility)** — doing so would make a restricted banner *more* visible on a validation failure, the opposite of fail-closed. Consequently, for any document that has passed Publish, `endsAt > startsAt` holds for every present window by construction, not by a drop-on-failure rule. Merchant edits in store timezone with the timezone shown (reuse the Version dialog pattern); Published omits ineligible (not-yet-started/expired, but validly-windowed) banners (an omitted banner leaves no empty wrapper).

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
3. Text/icon tone is derived from the hero's **effective overlay + the region-specific sampled luminance behind the header band** (§4.5.3 — the top row of the 3×3 grid, not the whole-image average) with an automatic scrim (a vertical gradient `overlay` colour at ≤ 40 % alpha behind the header band) added when that region's exact compositing result is below target; because the scrim's effect on a known region luminance is exact math (§4.5.3), this is a **guarantee for the header band**, not a warn-tier estimate. The merchant can choose `light`/`dark` tone explicitly, which the resolver still validates against the same region before accepting it.
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
  window?: { startsAt?: string; endsAt?: string };                 // UTC ISO; same amended semantics as §8.4 (AMEND-7)
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
- **Validation (AMEND-7):** an announcement's `window` follows the exact same rule as §8.4 — Draft preserves whatever was entered (including invalid/`endsAt<=startsAt`); Publish/scheduled-publish rejects the document with a path-specific `422` (e.g. `announcements.items[i].window.endsAt`) rather than silently making the item always-eligible. The rule applies per item, so one invalid item blocks only its own path, not the whole announcement document.
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

`gallery`: 2-24 images, `layout: grid | carousel`, columns `2|3|4|6` (responsive collapse), aspect preset, gap step, optional captions, optional per-image safe link, **optional lightbox** (reuses `MediaLightbox`: focus trap, `Esc`, arrow keys, RTL, restore focus). **Collage → LATER. Masonry → only a DOM-order-preserving, accessible implementation (e.g. grid-row-span); CSS-column masonry is excluded** because it reorders visual vs DOM order, breaking keyboard/screen-reader order and RTL flow. Images use the shared variants + `srcset`; alt required-with-warning, unless the image's `MediaRef.decorative` is `true` (AMEND-10, §3.2), in which case an empty alt is correct and not warned on.

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
| `image` | `MediaRef`, caption, link? | alt required-with-warning, or empty when `decorative: true` (AMEND-10) |
| `button` | `Cta` | style/colour roles |
| `divider` | style `line` or `dots` | decorative |
| `spacer` | `sm`, `md` or `lg` | only vertical rhythm |
| `callout` | tone `info`, `success` or `warning`, text | icon from registry |
| `columns` | 2 columns of blocks, **mandatory single-column stack below `md`** | no nested columns; stack is fixed, not merchant-defined |

Bounds: ≤ 12 top-level blocks (+ ≤ 4 per column); no HTML/JS/CSS/embeds; no absolute positioning. Content-page authoring (new backend, route, SEO) is **LATER** and will persist the same block array.

---

## 16. Contract N — Theme definition (D-30, amended — AMEND-6)

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
  assets?: ThemeAssetRef[];                                         // AWJ-owned source media — a GLOBAL, tenant-less namespace, never a `storefront_media` row (§7.9)
}
```
**Apply is non-destructive and ordered:** (1) **Preview** — render the theme over the merchant's own data in the Canvas, unsaved, read-only, Desktop/Mobile; (2) **Apply summary** — lists exactly which design areas will change (palette, fonts, header, footer, cards, buttons, section styles) and what is kept (content, media, links, logos, section order/visibility except explicitly listed pack additions); (3) **new Draft Version** created and saved (revision-checked, rolls the version back on failure — as `themes/page.tsx` does today) — **as part of the same step, every referenced `ThemeAssetRef` is cloned into a new tenant-owned `storefront_media` row (§7.9, AMEND-6) and the draft's `MediaRef`s are rewritten to the clone's id before the Draft Version is saved**; (4) opens in the editor. The Published store and existing versions are **never** overwritten; recovery = switch back to the previous version (H1). **Themes do not reference merchant media, and merchant documents never reference the global theme-asset namespace** — the clone in step 3 means the draft holds only ordinary tenant-owned `MediaRef`s, identical in shape and validation to anything the merchant uploaded; no exception to §7.8's tenant-only check is needed. Registry growth: ≈ 6-8 themes across verticals; a theme is `available` only when every token it uses is runtime-backed (existing rule in `theme-registry.ts`).

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

**Tablet (768 px) must have a real editing surface** (BL-3 / DEF-7): below `lg` the inspector opens as a **side drawer** (≥ 320 px, over the Canvas) at 768 and a **bottom sheet** below 600; the navigation rail becomes a drawer. (Toolbar primary-action reachability — **Save, Publish and Exit always visible** — is **not** part of this IA work: it is delivered earlier and narrowly by **V1A / DEF-11**, §20.1; V1B/V5 may restyle the overflow mechanism but must preserve the guarantee.) At 1024 px the Canvas must keep a usable width (≥ 560 px) — the nav rail collapses to icons. Final geometry is decided and evidenced in V1B/V5; the requirement (a visible editing surface at 768 px and reachable primary actions at every width in both directions) is frozen.

---

## 19. Slice plan, boundaries and dependencies

Every slice: (1) **Implementation Evidence Gate** (§21.3) → (2) UX contract refresh against this document → (3) implementation → (4) verification (six widths × AR/EN, a11y, parity, tenant tests where applicable) → (5) pre-merge review → (6) **Owner merge approval** → (7) report. No slice deploys to Production without separate approval.

| Slice | Scope (what it may touch) | Must NOT | Exit gate | Depends on |
|---|---|---|---|---|
| **V0** Decisions & Contracts | this document, Roadmap section, baseline evidence | any code | Owner approves PR | — |
| **V1A** Independent defects (**six**) | DEF-1 (custom links in `MobileMenu`), DEF-3a/DEF-9/DEF-10 (stale comments/docs), DEF-4 (honest theme Preview label/behaviour), **DEF-11/BL-1 (builder toolbar primary actions reachable — narrow scope, §20.1; subsumes DEF-8)**. Each with tests | new design/media architecture; **full toolbar redesign**; V5 Inspector/IA; the 768 editing surface | defects closed, CI green; six-width AR+EN check for DEF-1 **and** DEF-11 (clean and dirty states) | none |
| **V1B** Contract-dependent UX defects | DEF-2 (accent role outcome per §4.1), DEF-6 (delete-confirmation rule), **DEF-7/BL-3 (768 editing surface — depends on the new editor IA)**, BL-4 (1024 Canvas width) | before V0 approval and the V5 IA decisions; must not re-open V1A's primary-action guarantee | visible editing surface at 768 and a usable Canvas width at 1024 in AR+EN | V0; co-designed with V5 |
| **V2** Customizer Media Foundation | `storefront_media` + `storefront_media_derivatives` model/migration (incl. per-asset and per-derivative `region_luminance`, AMEND-8), R2 domain, upload/list/patch/delete/usage, signed workspace route, **same-origin public proxy route with explicit format segment** (AMEND-1, AMEND-12), published-reference gate, base-variant **and transform-key derivative** pipeline keyed on the **full** normalised transform including `zoom` (AMEND-2, AMEND-11), **save-time bounded generation + background sweep, Publish-time verify-only** (AMEND-9), **revalidating cache policy** (AMEND-4), **derivative-readiness states enforced at publish** (AMEND-5), reconciler, publish-time validation (incl. `decorative`, AMEND-10), RBAC, tenant tests (§7) | picker UI; any Production flag change; **any derivative generation inside the Publish request path** | isolation + lifecycle suites green; **no raw `/store/v1/media/customizer/...` URL in any renderer output; every base-variant and derivative URL carries an explicit format segment; two framings that differ only in `zoom` never collide; a revoked/unpublished id 404s within one revalidation window; publish rejects until required derivatives are `ready` without Publish ever generating one itself; a maximum-size document's save-time generation stays within the 16-per-save bound, with overflow proven to drain via the background sweep**; N-1 choices recorded (library, version, memory, concurrency, quality values) | V0 (+ N-2 prerequisite before enabling in Production) |
| **V3** Announcement Bar | `announcements` contract ×3, Canvas + Published, ticker/rotation/sticky/dismiss, window + targeting, a11y, parity (§12) | media features | parity + a11y + reduced-motion checks | V0 |
| **V4** MediaPicker / Image Editor / Logos | picker, crop/focal/fit/rotate/**zoom**/reset, **decorative toggle** (AMEND-10), mobile override mechanism, logos+favicon → `MediaRef` (lazy migration; fixes DEF-5) (§7) | design contract fields | states table implemented **(incl. `processing`/`ready`/`failed`/`queued` + per-usage Retry, AMEND-5/AMEND-9)**; legacy documents render unchanged; **a save with two usages differing only in zoom produces two independently retryable derivatives** | V2 |
| **V5** Section Visual Contract / Inspector / Colour | `design` per type, palette roles, `ColourField`, contrast engine (client + PHP publish gate), gradients, buttons, surfaces, separators, overlap presets, Content/Design/Layout inspector, copy/paste style, reset design (§3-§6, §18) | per-surface features beyond the contract | back-compat proof (absent design ⇒ identical); contrast tests | V0 |
| **V6** Hero & Banner v2 | per-instance Hero, CTA model, media/background/overlay/variants, mobile override use, Banner window (§8) | header overlay behaviour (V7) | per-variant parity + LCP budget **+ region-specific contrast gate proven against real (non-uniform) images, not whole-image average (AMEND-3) + the contrast check reading the correct (transform-specific, not original-asset) region for a cropped Hero/Banner image (AMEND-8) + Banner window publish-rejection proof (AMEND-7)** | V2, V4, V5 |
| **V7** Header / Footer / Navigation | header design + overlay-on-hero + sticky, six footer layouts + groups + media, nested navigation + pickers + drag + icons, Canvas fixture removal (§9-§11) | mega menu | parity + mobile nav parity + RTL per layout | V5, V6 (overlay-on-hero) |
| **V8** Slider / Gallery / Motion | `slider`, `gallery` (grid/carousel/lightbox), motion tokens, reduced motion (§6.6, §13) | collage, masonry | a11y + RTL + reduced-motion checks | V2, V4, V5 |
| **V9** Cards / Product & Category / Content Blocks | card contract, grid/rail presets, category `cover` (DEF-3b), benefits icons/columns, shared block vocabulary in Custom Content, product `zoom` (§14, §15) | any commerce value control | commerce-firewall tests | V4, V5 |
| **V10** Theme Gallery / Workflow Polish | `ThemeDefinition` bundles, true Preview, Apply summary, built-in presets, Library thumbnails, hover action bar, drag reorder, **theme-asset clone-on-apply** (§16, §17, AMEND-6) | user-saved presets | DoD run **+ proof that no applied draft references the global theme-asset namespace — only cloned, tenant-owned `MediaRef`s (AMEND-6, tenant-isolation test)** | V5-V9 |
| **V11** Verification & Closure | six widths × AR/EN, long content, AT pass, parity harness, perf budgets, EN storefront seed (BL-9), closure report | new features | Horizon DoD (Master Gap §36) | all |

```
V1A (6 independent defects, incl. DEF-11 toolbar reachability) ───────► may ship before/alongside V0 approval
V0 ─┬─► V2 ─► V4 ─┬─► V6 ──┐
    │             ├─► V8 ──┼─► V10 ─► V11
    ├─► V3 ───────┤        │
    └─► V5 ─┬─► V7 (needs V6 for overlay-on-hero)
            ├─► V9
            └─► V1B (768 editing surface, accent, delete rule, 1024 Canvas width — co-designed with V5; builds on V1A's toolbar guarantee)
```
Dependencies from the approved Master Gap are **preserved unchanged**; the refinements are that **V1B is co-designed with V5** (its 768 surface must follow the Content/Design/Layout IA) and that **DEF-11 moved from V1B to V1A** (Owner sync, D-33) because primary-action reachability is independent of the new visual architecture and V7's overlay-on-hero explicitly depends on V6.

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
| DEF-8 | builder header overflow when dirty at 768/1024 | **V1A** (subsumed by DEF-11 — same overflow mechanism; dirty state is in DEF-11's verification) | H4-8 §10 |
| **DEF-11 / BL-1** | **builder toolbar primary actions (Publish, Save draft, Schedule) off-screen in the clean state (AR ≤ 1024, EN ≤ 1280); Publish unreachable by scrolling in AR at 390/430/768** — *new in V0; reachability defect that violates the previously closed H0 "no clipped primary actions" gate* | **V1A (promoted by the Owner, D-33)** — narrow scope, §20.1 | baseline §3.1 |
| DEF-3b | category page ignores category image | V9 | Master Gap |
| DEF-5 | three max logos exceed the document cap; Base64 duplicated per version | V4 | Master Gap |
| BL-4 | Canvas ≈ 486 px wide at 1024 | V1B | baseline §3 |

**V1A is confirmed independent of new visual architecture.** Its six items are local — a prop passed through (DEF-1), a label/href (DEF-4), comment/doc edits (DEF-3a, DEF-9, DEF-10) and a responsive toolbar overflow (DEF-11) — and none depends on `design`, palette, media or the new inspector IA. **DEF-7 (768 editing surface) is deliberately kept in V1B** because the correct surface depends on the new editor IA.

### 20.1 V1A handling of DEF-11 (narrow, frozen)

| Aspect | Contract |
|---|---|
| Required primary actions | **Exit to Commerce, Save draft, Publish** — always visible (not in an overflow) at 390, 430, 768, 1024, 1280, 1440 in **Arabic RTL and English LTR**, in the **clean, dirty and version-conflict** states |
| Secondary controls | page selector, version selector, viewport-mode switch, Open store, Schedule, status text may collapse into a single keyboard-operable **overflow ("More") menu** that exposes the same actions; unsaved/saved/conflict status must stay perceivable (icon + text, or at the top of the overflow) |
| Mechanism | responsive overflow with logical (RTL-correct) alignment; **no** horizontal-scroll toolbar, **no** re-ordering of Save/Publish semantics, version logic or permission checks |
| Non-goals | no full toolbar redesign; no Inspector/IA work (V5); no 768 editing surface (V1B); no design tokens; no new menus beyond the overflow |
| Verification | geometry assertions that Exit/Save/Publish rects lie inside the viewport at all six widths × AR/EN × {clean, dirty, conflict}; keyboard reach + focus return for the overflow; the existing publish/save tests unchanged and green; before/after screenshots |
| Longevity | the overflow is interim UI: V1B/V5 may restyle or relocate it but **must preserve the primary-action reachability guarantee** (tested forever) |

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
| Base SHA verified (`git fetch`; authored at `5fd6e59…`; **final sync to `155b2a3…` = `origin/main` incl. PR #1229**; sync diff touched no `app/`, `web/` or `storefront/` runtime code) | ✔ |
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
| R-3 | Imaging **implementation** risk (capability proven; library/version, memory, concurrency, quality, EXIF — N-1) and duplicate imaging paths with product media (MEDIA-3) | V2 evidence gate and measurement on real images; one shared imaging path; STOP to Owner only if the production runtime proves unsuitable |
| R-4 | Production R2 configuration (N-2) | operational go-live checklist; gated picker state |
| R-5 | Contrast engine too strict/loose | auto-foreground first; block only informative text; override of warn-tier only; tests |
| R-6 | Document growth | non-default storage, 2 KB per-section budget, logos leave the JSON (V4) |
| R-7 | Overlap/transparent-header regressions in focus/legibility | preset-only, ≥ md only, keyboard traversal tests, fallback to solid |
| R-8 | Public media enumeration | published-reference gate, uniform 404 |
| R-9 | Delete vs scheduled/restored versions | block-with-usage, soft delete, publish validation |
| R-10 | Toolbar defect (DEF-11) ships unnoticed while features pile up | **Mitigated** — promoted to V1A (D-33), which may start immediately |
| R-11 | Same-origin media proxy adds one network hop + a thin Next.js route to keep correct (AMEND-1) | Mirrors the already-shipped, already-tested product-media proxy pattern exactly; no new design, only a second route handler |
| R-12 | Transform-key derivatives generated inline at Publish could slow a large Publish (AMEND-2/AMEND-5) | Bounded by §7.6's small per-usage parameter set and ≤ 30 sections/document (§2.2.5); V2 measures real-image timing before enabling in Production (shares N-1's evidence gate) |
| R-13 | Revalidating cache policy (5 min) trades a little CDN offload for correct revocation (AMEND-4) | Conditional-`GET`/`ETag` revalidation is a cheap round trip, not a re-fetch; accepted trade-off, not reopened without new evidence |
| R-14 | Theme-asset clone-on-apply duplicates a small set of images per tenant that applies a theme (AMEND-6) | Bounded (curated theme asset sets are small); explicitly accepted in §7.9 as the cost of zero tenant-isolation exceptions |
| R-15 | Save-time derivative generation adds latency to the content-save call instead of Publish (AMEND-9) | Hard-capped at 16 new derivatives per save (a small, fast GD batch); overflow is deferred to the background sweep rather than blocking the save response |
| R-16 | A bounded background sweep still needs *some* execution path under `QUEUE_CONNECTION=sync` (no real worker) (AMEND-9) | Same mechanism already relied on for the §7.9 purge reconciler (an Artisan scheduled command); not a new operational dependency |
| R-17 | Per-derivative `region_luminance` sampling adds one more computation per generated file (AMEND-8) | Bounded by the same 16-per-save cap as R-15; sampling a 3×3 grid is cheap relative to the resize/encode work already being done |
| R-18 | `decorative` defaulting to false/absent could let a merchant mis-flag an informative image as decorative, hiding real content from assistive tech (AMEND-10) | Accepted as a merchant-content-authoring responsibility, consistent with every other alt-text field in this contract; not a technical gap — the picker never defaults an upload to `decorative: true` |
| U-1 | CSP at the edge (U3 in Master Gap) | V2/V8 evidence gate; required before custom fonts |
| U-2 | Published-config caching vs time windows (U5) | dynamic scope or cache-key input (§8.4) |
| U-3 | Swiper RTL (U6) | verify before the Slider slice |
| U-4 | Screen-reader behaviour (U7) | NVDA + VoiceOver pass in V11 |
| U-5 | English storefront chrome unbaselined (BL-9) | seed EN content in V11 |

---

## 24. PR #1232 review-thread resolution log (Codex, 2026-10-05 and 2026-10-06)

### 24.1 First pass (2026-10-05, head `5b0862f`)

Seven review threads from `chatgpt-codex-connector` are each resolved by an amendment above (§1.3). Every thread below is addressed; none is deferred or left open.

| Thread | Finding (one line) | Resolved by | Section |
|---|---|---|---|
| [`r4179920056`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4179920056) | Public route would be a raw host-resolved Laravel URL the browser can't fetch | AMEND-1 — same-origin Next.js proxy, variant/transform identity in the path | §7.8 |
| [`r4179920059`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4179920059) | Per-usage crop/rotate has no way to address two different outputs of one asset | AMEND-2 — deterministic `transformKey` derivative model | §7.5, §7.6 |
| [`r4179920063`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4179920063) | Average luminance can pass the gate while the actual text region has no contrast | AMEND-3 — region-specific sampled luminance + exact overlay-compositing gate | §4.5, §9.3 |
| [`r4180013495`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4180013495) | 1-year immutable cache defeats the Published-reference revocation gate | AMEND-4 — bounded, revalidating cache policy with content-hash `ETag` | §7.5, §7.8 |
| [`r4180013497`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4180013497) | No state distinguishes "variant row exists" from "generation actually succeeded" | AMEND-5 — explicit `pending`/`ready`/`failed` readiness, publish fails closed | §7.2, §7.5, §7.8, §7.10 |
| [`r4180013501`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4180013501) | Theme assets "copy references" but §7.8 requires tenant-owned `mediaId`s — undocumented exception | AMEND-6 — global tenant-less theme-asset namespace + clone-on-apply into tenant-owned media | §7.9, §16 |
| [`r4180013504`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4180013504) | Invalid/malformed Banner window is silently dropped, making the banner unrestricted | AMEND-7 — Draft preserves, Publish rejects with a path-specific error; never normalised to unrestricted | §8.4, §12 |

### 24.2 Second pass (2026-10-06, head `241b76f`)

Five further threads, raised after the first pass landed, catch gaps that the first pass's own fixes introduced or left open. Each is resolved by a second-pass amendment (§1.3).

| Thread | Finding (one line) | Resolved by | Section |
|---|---|---|---|
| [`r4191556107`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4191556107) | AMEND-3's `region_luminance` is only on the original asset; a crop/rotate can show different pixels in a checked cell | AMEND-8 — per-derivative `region_luminance`, sampled on the rendered transform, never substituted from the asset | §4.5, §7.2, §7.5 |
| [`r4191556116`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4191556116) | A max-size document could need ~2,880 synchronous GD operations inside one Publish request | AMEND-9 — generation moves to bounded save-time processing + background sweep; Publish only verifies readiness | §7.5, §7.8, §7.10 |
| [`r4191556121`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4191556121) | No per-usage decorative flag, although §7.8/Gallery already assumed one | AMEND-10 — `MediaRef.decorative?: boolean`, with normalisation/validation/Gallery/content-block updates | §3.2, §7.8, §13.2, §15 |
| [`r4191556129`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4191556129) | `transformKey` omits `zoom`; two different zoom values on an otherwise-identical crop would collide | AMEND-11 — `zoom` included explicitly (rounded to 2 decimals) in `normalizedTransform` | §7.5, §7.6 |
| [`r4191556133`](https://github.com/safwan5001-source/Nebrax/pull/1232#discussion_r4191556133) | Base-variant path has no format component; WebP/JPEG URLs aren't distinguishable, and negotiation (if intended) is undefined | AMEND-12 — explicit format path segment (`480w.webp`/`480w.jpg`), not content negotiation | §7.5, §7.8 |

No general (non-review-thread) PR comments were present on PR #1232 at the time of either pass (`get_comments` returned none both times).
