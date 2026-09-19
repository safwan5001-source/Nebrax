# AWJ Store Customizer UX V2

**Status:** Documentation only. UX direction record. Not implemented. Not merged. Not deployed.
**Date:** 2026-09-19
**Repository:** `safwan5001-source/Nebrax`
**Base:** `main` `5dd415f7358137cac3e030b21ca7b629c15815c0` (Commerce API V1 PR-4 merge, #836)
**Related authority:** `AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md` (STORE-CUSTOMIZER-ARCH-1, persistence lock), `STORE-UI-6-IMPLEMENTATION-REPORT.md` (current Customizer), `AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` (capability honesty policy).

---

## 1. Status

This document records the approved **UX direction** for the next evolution of the AWJ Store Customizer ("UX V2") before any code is written. It is a **reference specification**, not an implementation.

- No application code is changed by this document.
- No database, API, or persistence change is proposed here.
- The existing Customizer (STORE-UI-6) is **not** a final UX baseline and is **not** deprecated by this document; it remains the current production surface until a V2 slice is reviewed and merged.
- The exploratory external prototype **"AWJ Store Customizer V2 Prototype V0.2"** exists only to prove UX direction. It is **not** a visual baseline. Its colors, dimensions, and visual details must **not** be carried into production as a source of truth.

## 2. Purpose

The functional reference for UX V2 is a **direct visual customization experience** — conceptually similar to the Salla Theme Editor — without copying Salla literally.

The goal: the merchant should feel they are **editing their store itself**, not filling a settings page that describes the store.

This document:

1. Fixes the UX principles, information architecture, scroll model, and section model V2 must follow.
2. Distinguishes **what exists today** (repository evidence) from **what V2 targets**.
3. Proposes a small, reviewable PR sequence for implementation.
4. Preserves existing architectural decisions that do not conflict with this specification, including the locked persistence architecture (STORE-CUSTOMIZER-ARCH-1) and the design-first capability honesty policy.

## 3. UX principles

### 3.1 Visual Editor

The **Live Store Preview is the center** of the customization experience. The merchant sees their store while editing. Settings panels orbit the preview; the preview never becomes a thumbnail beside a form.

### 3.2 Click-to-Edit

Any element visible in the preview that is customizable must be reachable by **clicking it directly** — the shortest path to its settings. Examples:

- Header → header settings
- Logo → logo settings
- Hero banner → banner settings
- Product section → section settings
- Categories → category navigation settings
- Footer → footer settings

The merchant must never be forced to search a long settings tree for an element that is in front of them in the preview.

### 3.3 Structured Sections

AWJ is **not** a free-form website builder (not Webflow). Page content is composed of **structured, reusable Sections** with a fixed operation set:

- Add
- Edit
- Reorder
- Duplicate
- Hide / Show
- Delete

Sections must preserve responsive behavior and design integrity; a section can never be placed into a broken layout.

### 3.4 Add Section

A single clear action — **+ إضافة قسم** — opens an organized Section Picker, grouped for example by:

- الأكثر استخدامًا (most used)
- المنتجات (products)
- المحتوى (content)
- التنقل (navigation)
- التسويق (marketing)

…with search when the list is long.

### 3.5 Progressive Disclosure

Never show every property at once. Everyday settings appear first (e.g. **المحتوى** / **التصميم**), with **إعدادات متقدمة** (advanced settings) collapsed behind them for rarely used options: spacing, container width, advanced alignment, visibility behavior, and future custom styling capabilities.

Target: **80% of merchants can customize their store without opening Advanced Settings.**

### 3.6 Theme Tokens

Theme Tokens remain an **internal implementation layer**. The merchant never sees technical names such as `--store-primary`; they see **لون المتجر** ("store color"). The system translates the merchant's choice into the correct token. The existing token architecture (`--store-*` / `presentationCssVars`) must not be broken.

### 3.7 Global Design vs Page Content

These concerns are separated explicitly — never merged into one settings screen:

| Layer | Contains |
|---|---|
| **هوية المتجر** (Store identity) | Logo, favicon, colors, fonts |
| **Global Design** | Buttons, product cards, radius, shared visual behavior |
| **Page Structure** | Sections, order, visibility |
| **Selected Section Settings** | Content, layout, section-specific appearance |
| **Advanced** | Advanced options only |

## 4. Information architecture

UX V2 maps the layers above onto the Customizer as follows:

1. **Store identity** — one surface for logo / favicon / colors / fonts (today's "Appearance" + "Identity" panels, kept distinct from page content).
2. **Global design** — shared component styling (buttons, product cards, radius, density), expressed in merchant language, compiled to tokens.
3. **Page structure** — the Sections list: add / reorder / duplicate / hide / delete. This is the evolution of today's homepage composer.
4. **Section settings** — opened by selecting a section in the list **or by clicking it in the preview** (Click-to-Edit), organized with progressive disclosure (content → design → advanced).
5. **Advanced** — a clearly separated destination, not an always-visible column.

The current implementation already separates these concerns into outline panels (`web/src/modules/store-experience-builder/ControlPanels.tsx`, mirrored in `storefront/src/components/customizer/ControlPanels.tsx`); V2 reorganizes them around preview-first interaction rather than introducing a new settings taxonomy.

## 5. Desktop behavior

Core layout:

- **Top Toolbar**
- **Customizer Sidebar**
- **Live Preview Canvas** — takes the largest possible area.

This matches the current direction: at 1440px the current Customizer already gives the preview the dominant column (196px outline / 320px inspector / **924px preview**, measured in STORE-UI-6). V2 keeps preview dominance.

Top Toolbar contains at minimum:

- Exit / Back
- Current page
- Undo / Redo (future)
- Desktop / Tablet / Mobile (preview mode switch)
- Preview
- Draft status
- Publish

### Scroll behavior (a core requirement, not a visual detail)

- Independent scroll for the **Customizer Sidebar**.
- Independent scroll for the **Live Preview Canvas**.
- Independent scroll for the **Settings panel / sheet** when options overflow.
- **Top Toolbar stays available while scrolling.**
- Scrollbars are visible but unobtrusive.

### Scroll-to-Section

When a section is chosen from the sections list:

1. It becomes **Selected**.
2. The Live Preview **scrolls to it automatically**.
3. It is **visually highlighted**.
4. Its settings open when needed.

The merchant never hunts manually for a section inside a long page.

### Scroll position preservation

Opening and closing a section's settings must **not** lose the merchant's current position in the preview.

## 6. Mobile behavior

Do **not** ship a shrunken desktop Customizer. Mobile gets its own UX:

- The **preview is the main screen**.
- Primary actions are touch-appropriate: **Sections**, **Add**, **Design**.
- Selecting an element opens its settings in a **Bottom Sheet** (or an equivalent mobile pattern).
- The Bottom Sheet itself scrolls when settings overflow.
- The merchant must be able to **actually customize the store from a phone**, not only preview it.

Current state for contrast: today's mobile experience is a **Customize / Preview tab pair** (390px), with Save/Publish as a dedicated action row — functional but panel-first. V2 inverts the priority to preview-first with bottom-sheet editing.

## 7. Scroll model

Consolidated requirements (see §5 and §6):

| Surface | Rule |
|---|---|
| Sidebar (desktop) | Independent scroll |
| Preview canvas | Independent scroll; position preserved across settings open/close |
| Settings panel / sheet | Independent scroll on overflow |
| Top toolbar | Fixed / always reachable |
| Bottom sheet (mobile) | Scrollable on overflow |
| Section selection | Triggers preview scroll-to-section + highlight |

## 8. Section model

- Sections are **structured and reusable**, with the operation set in §3.3 (Add / Edit / Reorder / Duplicate / Hide / Show / Delete).
- Sections are **responsive by construction**: the same section data renders correctly across Desktop / Tablet / Mobile preview modes. Preview modes are viewport simulations, **not independent themes**; one design document stays responsive across all of them.
- Repository evidence: today's homepage model (`StorefrontPresentationConfig.homepage.sections`, keys `hero`, `categories`, `newArrivals`, `wholesale` implemented; `banner`, `featured`, `offers`, `benefits`, `appPromo`, `customContent` gated in `capabilities.ts`) already supports **visibility and order** per section. V2 extends this model toward a general section registry; it does **not** replace it with free-form placement.
- Gated sections without a data contract stay gated: persisting `visible: true` must not make them live (locked rule from STORE-CUSTOMIZER-ARCH-1 §7).

## 9. Theme/identity model

- **Theme Tokens stay internal.** Merchant-facing language ("لون المتجر") maps to `--store-*` tokens (`presentationCssVars`, closed enums + validated hex). The token layer and its normalization (`normalizePresentationConfig()`, fail-closed to AWJ Modern) are preserved.
- **Store identity** (logo, favicon, display name, colors, fonts) is edited as identity, not as page content.
- Persistence follows the locked architecture: one `storefront_presentations` head row per storefront (`draft_config` + `published_config` + integer revisions); identity/presentation never lives on `storefronts`, `sales_channels`, or `tenants.settings`.
- Branding media remains `DESIGN_ONLY` (data URLs with caps) until a tenant-scoped media object exists; ERP `company.logo` is not storefront branding.

## 10. Draft / Preview / Publish direction

**Save must never mean editing the live published store directly.**

Target model (already locked in STORE-CUSTOMIZER-ARCH-1; restated here as the UX contract):

- **Published Version** and **Draft Version** are distinct.
- The merchant edits the **Draft**.
- The system shows a clear state such as **تم حفظ التغييرات كمسودة** ("changes saved as draft").
- Then: **معاينة** (preview), then **نشر التغييرات** (publish changes).
- Publish is an atomic promote of draft → published; a failed publish leaves the previous published snapshot unchanged.
- The design must allow **Version History / Restore** in the future (deferred capability — documented, not built).
- Preview is the **in-workspace canvas** fed by the draft; there is no preview token, no unpublished-theme public route, and no iframe of the live store. Public anonymous traffic only ever sees the published snapshot.

## 11. Accessibility considerations

- **RTL-first**: the builder and the preview follow their own `dir` independently; logical CSS properties only; store names in `<bdi>` (current behavior, preserved).
- **Keyboard reachability**: Click-to-Edit targets in the preview must also be reachable from the sections list (the list is the keyboard/screen-reader path to the same settings); section operations (reorder, hide/show, delete) must be operable without drag-and-drop.
- **Focus management**: opening a section's settings moves focus into the panel/sheet; closing it returns focus to the originating section control without losing preview scroll position (§7).
- **Visible selection/highlight**: the selected section's preview highlight must not rely on color alone.
- **Touch targets**: mobile actions (Sections / Add / Design, bottom-sheet controls) sized for touch.
- **Contrast**: merchant-chosen colors are validated hex on a closed token set; the editor chrome itself follows the existing design system contrast rules.
- Localization remains Arabic-first with English supported, as today.

## 12. Tenant/security boundaries

Any future design must preserve:

- **Tenant isolation** — tenant from the authenticated user (`SetTenant` / `TenantContext`), never from `{id}`, Host, header, cookie, or body.
- **Storefront ownership boundaries** — foreign or missing storefront `{id}` → **404, not 403** (no existence leak / IDOR).
- **Backward compatibility** — stores with no presentation row keep today's AWJ Modern rendering byte-compatibly.
- **Existing Commerce contracts** — presentation contains no products, prices, inventory, or listings; no commerce business rules change.
- **Safe publishing** — server re-normalizes before any write; publish is transactional; failed publish preserves the previous published snapshot.
- **Responsive integrity** — sections cannot be configured into broken layouts.
- **No cross-tenant effect** — customizing one tenant's storefront must never affect another tenant.
- Draft secrecy — drafts are workspace-only (`commerce.manage`); the public runtime reads published only.
- Merchant-entered verification data never mints a Verified badge.

## 13. Repository evidence

Narrow pass, limited to Store / Commerce Workspace / storefront customization / theme-token surfaces and existing Store docs. The full repository was not re-audited.

| Source | What it established |
|---|---|
| `web/src/modules/store-experience-builder/` (`ExperienceBuilder.tsx`, `ControlPanels.tsx`, `StorefrontPreviewCanvas.tsx`, `messages.ts`) | Current merchant Customizer at `/commerce/appearance`: editor outline (196px) + inspector (300–320px) + live preview (924px at 1440). Arabic-first RTL. Settings-panel-first navigation; **no click-to-edit**, **no add/duplicate/delete section operations**, no bottom-sheet mobile pattern. |
| `storefront/src/components/customizer/` + `storefront/src/lib/presentation/` | The storefront-side mirror and the canonical presentation contract. |
| `storefront/src/lib/presentation/config.ts` | `StorefrontPresentationConfig` v1: theme/font/density/radius/product-card presets, branding (data-URL logos), header + nav links (≤12), homepage sections (visibility + order), footer, contact, WhatsApp, social (≤8), verification (stored, never rendered as a badge), apps, pages metadata. `normalizePresentationConfig()` fails closed to AWJ Modern. |
| `storefront/src/lib/presentation/capabilities.ts` + `web/.../presentation/capabilities.ts` | Capability honesty matrix: most capabilities `DESIGN_ONLY`, verification/pages `GATED`, version history `DEFERRED`. |
| `docs/plans/store/AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md` (STORE-CUSTOMIZER-ARCH-1) | **Locked** Draft → Preview → Publish → Published Runtime architecture: `storefront_presentations` 1:1 row, workspace `GET/PUT …/presentation` + `POST …/publish` under `commerce.manage`, additive `presentation` on `GET /store/v1/storefront`, public reads published only. |
| `docs/plans/store/STORE-UI-6-IMPLEMENTATION-REPORT.md` | Current Customizer status, measured layout, responsive behavior at 390/430/768/1024/1280/1440, capability states, explicit non-goals. |
| `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` | Design-first policy: missing backend capability blocks production activation, never blocks honest design. |
| `docs/plans/store/AWJ_STOREFRONT_RESPONSIVE_BASELINE_V1.md`, `AWJ_STOREFRONT_DESIGN_SYSTEM.md` | Responsive baseline and storefront design system that sections must not break. |
| Workspace storefront APIs (`routes/api.php`, `CommerceModuleBoundaryTest`) | Existing internal `/api/commerce/workspace/storefronts…` pattern the customizer backend will extend (per ARCH-1); new routes must be allow-listed. |
| `GET /store/v1/storefront` | Public Host-resolved identity (`name`, `default_locale`); additive `presentation` is the designed extension point. |

## 14. Existing capabilities to preserve

- **Theme token layer**: `--store-*` / `presentationCssVars`, closed preset enums, hex validation, fail-closed normalization.
- **`StorefrontPresentationConfig` v1** as the persistence contract (and its PHP twin planned in ARCH-1).
- **In-workspace preview canvas** using real storefront primitives (`StoreBrand`, `storeContainerClassName`, category accents) — V2 makes it the center and interactive, not replaces it.
- **Homepage section visibility + order** model (composer) as the seed of the structured section registry.
- **Locked persistence architecture** (ARCH-1): ownership, draft/publish lifecycle, concurrency, cache, and security invariants.
- **Capability honesty policy**: no fake save/publish success, no invented APIs, no `localStorage` persistence, no Verified badge from merchant text.
- **Responsive baseline** and the current 390/768/1024/1280/1440 layout breakpoints as measured facts to build on.
- **URL safety** (`sanitizeExternalUrl` / `sanitizeLogoUrl`, https-only, no SVG logos, app-store host allow-lists).

## 15. Known gaps

Gaps between the current implementation and this specification (documented, **not** fixed here):

1. **No Click-to-Edit**: preview elements are not selectable; settings are reached only through the outline/inspector panels.
2. **No section add / duplicate / delete**: the homepage composer supports visibility + order only; there is no Section Picker.
3. **No Scroll-to-Section / preview highlight**: selecting a panel does not scroll the preview or highlight a section.
4. **Mobile UX is panel-first** (Customize / Preview tabs), not preview-first with bottom-sheet editing.
5. **No progressive disclosure model**: panels present their full field sets; there is no standard content/design/advanced split.
6. **No global-design vs page-content separation in navigation**: identity, header, homepage, footer, contact, WhatsApp, social, verification, apps, and content are sibling outline entries rather than layered per §3.7.
7. **No Undo/Redo**, no draft status indicator copy in a toolbar, no desktop/tablet/mobile switch presented as preview modes of one document (the current device-width switch is editor-side).
8. **Draft/publish UI honesty** is in place, but the backend contracts it points to (ARCH-1) are not implemented yet; Save/Publish are intentionally inert.
9. **Section model is homepage-only**: only homepage sections exist in the config; header/footer/identity are fixed regions, not sections.
10. **No version history/restore** (explicitly deferred everywhere).

No conflicts were found between this specification and the locked persistence architecture or the current code structure. If implementation later reveals a genuine architectural conflict, it must be documented and resolved with the smallest possible change — not by widening scope.

## 16. Explicit non-goals

- No application code change in this task; documentation only. No merge, no deploy.
- No rewrite of the existing Customizer or storefront.
- No free-form page builder (no arbitrary HTML/CSS/JS, no Webflow-style canvas). `customContent` stays a gated placeholder.
- No copying of Salla (or the external Prototype V0.2) as a literal visual/interaction source of truth.
- No new persistence architecture, preview token, unpublished-theme public route, or iframe of the live store (ARCH-1 already rejected these).
- No branding media upload/CMS, no pages CMS, no Verified-business authority, no version history in V2 slices unless separately approved.
- No changes to commerce business rules, accounting, inventory, orders, or tenant/subscription logic.
- No breaking of the existing `--store-*` token architecture.

## 17. Proposed implementation PR sequence

Small, reviewable PRs. Sequence:

| PR | Scope | Explicitly excluded |
|---|---|---|
| **PR-STORE-CUSTOMIZER-V2-1** | Customizer Shell + Live Preview + Section Selection (top toolbar, sidebar, preview-dominant canvas, scroll model, scroll-to-section + highlight, click-to-edit routing to existing panels) | New persistence architecture, real publish, any Commerce business-rule change |
| **PR-STORE-CUSTOMIZER-V2-2** | Section Editing: add, edit, reorder, duplicate, hide/show, delete (Section Picker, structured operations on the existing section model) | New section data contracts beyond the existing config keys |
| **PR-STORE-CUSTOMIZER-V2-3** | Store Identity + Global Theme Controls (merchant-language controls compiling to tokens; identity surface per §3.7) | New token systems; branding media upload |
| **PR-STORE-CUSTOMIZER-V2-4** | Draft / Preview / Publish architecture (implements the already-locked STORE-CUSTOMIZER-ARCH-1: `storefront_presentations`, workspace APIs, additive public `presentation`) | Version history/restore (deferred), preview tokens |

If repository inspection during implementation shows this split needs adjustment for genuine architectural reasons, document the reason and propose the **smallest** possible amendment rather than expanding scope.

## 18. Acceptance criteria

This documentation is complete only if it:

- [x] Is grounded in real repository evidence (§13).
- [x] Distinguishes current state from the V2 target (§13, §14, §15).
- [x] Does not claim the external Prototype is the production design (§1).
- [x] Does not propose an unnecessary rewrite (§16).
- [x] Preserves Theme Tokens and useful existing architecture (§9, §14).
- [x] Documents Desktop and Mobile behavior (§5, §6).
- [x] Documents scroll behavior explicitly (§5, §7).
- [x] Documents Click-to-Edit and Scroll-to-Section (§3.2, §5).
- [x] Documents Structured Sections (§3.3, §8).
- [x] Documents Draft/Preview/Publish (§10).
- [x] Defines tenant isolation boundaries (§12).
- [x] Provides a small, reviewable PR sequence (§17).

---

*Documentation only. No code, schema, API, or deployment change is authorized by this document. Do not merge the resulting PR without owner review. Do not deploy.*
