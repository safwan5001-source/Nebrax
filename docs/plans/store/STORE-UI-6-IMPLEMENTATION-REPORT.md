# STORE-UI-6 — Store Experience Builder / Customizer

## 1. Status

**Visual refinement round pending review.** Architecture and
capabilities were accepted. **Visual approval is not granted.**
**Not merged, not deployed.** `NO VISUAL APPROVAL = NO MERGE`.

## 2. Git

| | |
|---|---|
| **Latest main SHA** | `50e66740b5e7757edd30e3dd7ae2304d8b9f325f` — STORE-UI-5 merge (PR #868) |
| **Base SHA** | `50e66740b5e7757edd30e3dd7ae2304d8b9f325f` (verified ancestor of this branch) |
| **Branch** | `feat/store-ui-6-store-customizer` |
| **Head SHA** | `PLACEHOLDER_HEAD_SHA` |
| **PR** | [#871](https://github.com/safwan5001-source/Nebrax/pull/871) |

`git merge-base --is-ancestor 50e66740b5e7757edd30e3dd7ae2304d8b9f325f HEAD` holds.

## 3. The policy this pass operates under

The owner's design-first decision, recorded in
`docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`:

> **Missing backend capability does not block storefront design completion.
> It blocks production activation.**

The Customizer is designed in full. Identity that already exists
(`storefronts.name`, `default_locale`) is used as the typographic fallback.
Everything else is page-lifetime draft against a live preview. What
design-first never licenses — inventing an API, adding a migration, faking
a commercial fact, substituting `localStorage` for persistence, reporting
save/publish success, minting a Verified badge from merchant-typed text,
using AWJ corporate branding as the merchant identity — was not done
anywhere in this diff.

## 4. Evidence pass — what was read, not assumed

Narrow, per the brief. The full Commerce architecture was not re-audited.

| Source | What it established |
|---|---|
| `storefronts` / workspace storefront resource | Live identity is **name + default_locale only**. No presentation / theme / logo / contact / WhatsApp / social / verification / apps / pages columns. |
| `GET store/v1/storefront` | Host-resolved `{ name, default_locale }`. Fail-closed. No published presentation payload. |
| `GET /api/commerce/workspace/storefronts/{id}` | Workspace identity. Auth: Sanctum + `EnsureUserPrincipal` + `SetTenant` + `commerce.manage`. Foreign `{id}` → **404, not 403**. |
| Branding media | No tenant-scoped storefront logo/favicon object. ERP `company.logo` and product `GET store/v1/media/{id}` are **not** this contract. |
| Contact / WhatsApp / social | No storefront contact, WhatsApp or social fields. ERP company phone is not this contract. Spree `STORE_*` env is not an AWJ contract. |
| Verification | No AWJ-or-external verified status. Merchant-typed CR / license / URL is never sufficient. |
| Pages | No AWJ pages CMS. Leftover Spree `policies.get` is not an AWJ contract. |
| Homepage | `resolveHomeSections()` is the public seam. Implemented keys: hero, categories, newArrivals, wholesale. Banner / featured / offers / benefits / app / custom have no data contract. |
| Preview | No unpublished-theme public route, no preview token. Iframe of the live storefront is not an unpublished-theme preview. |
| Publish | No draft/published revision. `storefronts.name` PATCH is not a theme publish. |

## 5. Capability matrix

Unchanged in this visual round.

| Capability | Backend contract | State | Action taken |
|---|---|---|---|
| Theme persistence | none | **DESIGN_ONLY** | Preset, primary, density, radius, product-card. Tokens as `--store-*`. Save inert. |
| Branding persistence | none | **DESIGN_ONLY** | Logo / compact logo / favicon as page-lifetime data URLs. Typographic fallback. Never AWJ branding. |
| Homepage composition | none | **DESIGN_ONLY** | Visibility + order + hero copy. Public homepage still uses defaults. |
| Custom nav links | none | **DESIGN_ONLY** | Add / edit / remove / reorder / enable. External hrefs https-only. |
| Footer | none | **DESIGN_ONLY** | Tagline, copyright, show-identity. |
| Contact | none | **DESIGN_ONLY** | Phone, email, address, hours. Preview-only. |
| WhatsApp | none | **DESIGN_ONLY** | Enable, E.164, opening message, floating/footer/both. Preview `wa.me` only. No send. |
| Social links | none | **DESIGN_ONLY** | Add / edit / remove / reorder / enable. https-only. |
| Business verification | none | **GATED** | Merchant CR/license/URL captured. Preview never renders a Verified badge. Requested-badge toggle is stored and ignored by the renderer. |
| Mobile app links | none | **DESIGN_ONLY** | App Store / Play URLs. Section absent without a valid URL. |
| Informational pages | none | **GATED** | About / contact / FAQ / policies as designed entry points. No CMS. |
| Draft persistence | none | **DESIGN_ONLY** | Page-lifetime React state. Save reports that nothing was stored. |
| Customizer preview session | none | **DESIGN_ONLY** | In-editor canvas using storefront tokens + `StoreBrand`. Not an iframe of the live store. |
| Publish | none | **GATED** | Publish never reports success. Does not mutate the live storefront. |
| Version history / restore | none | **DEFERRED** | Nothing built. Editor restore-default is page-lifetime draft reset only. |

Each entry's **exact missing contract** is in
`storefront/src/lib/presentation/capabilities.ts` and in the design-first
policy register §5.16–§5.30.

## 6. Implemented surfaces

### Merchant workspace

`/commerce/appearance` replaces the destination placeholder with the
Experience Builder. The workspace shell full-bleeds this route so the
preview is the hero, not a padded settings card. Nav label is
**بناء تجربة المتجر** / **Store experience**.

Arabic-first RTL; English LTR. Desktop (`lg+`): editor outline
(196px) + inspector (300–320px) + live preview (the remainder).
Measured at 1440: nav 196 / inspector 320 / preview **924**.
Mobile: **Customize / Preview** tabs. Device width switch
(390 / 768 / 1280) lives on `md+` where a framed preview actually
fits. Locale stays reachable on a phone.

### Presentation contract

`StorefrontPresentationConfig` v1. `normalizePresentationConfig()` fails
closed to AWJ Modern (`#12372a`, Cairo + Geist, comfortable, default
radius). Unknown homepage keys are dropped. Unsupported colours are
rejected. External URLs are https-only. Logo URLs allow `https` and
raster data URLs; SVG/javascript are rejected.

### Live preview

`StorefrontPreviewCanvas` applies `--store-*` to the same visual language
as the public storefront: `StoreBrand`, `storeContainerClassName`,
category-accent tiles, hero, new arrivals (no prices), wholesale band,
footer. Preview catalog is labeled as fixtures. Public homepage is
untouched and still resolves the default section list. This visual
round did not redesign the storefront preview.

### StoreBrand

Optional `logoUrl`. Absent or unsafe values keep the typographic
fallback. AWJ corporate branding is never substituted.

### Honest lifecycle

Save and Publish are visible and clickable. Both refuse, write nothing
(including no browser storage), and show the capability notice. Dirty
state is page-lifetime only.

## 7. Responsive behaviour

Verified at 390 / 430 / 768 / 1024 / 1280 / 1440.

| Width | Layout |
|---|---|
| 390 / 430 | Customize / Preview tabs. Header is title + locale only. Panel picker is a native select. Save / Publish sit above the tabs, not in the title row. |
| 768 | Two-pane. Panel picker remains a select so names stay readable. Device switch appears. Preview takes the remainder. |
| 1024 / 1280 / 1440 | Editor outline + inspector + preview. Preview is the hero (924px of 1440). |

## 8. RTL / LTR

Builder `dir` follows the Customizer locale. Preview canvas `dir`
follows independently. Logical CSS (`ms` / `me` / `ps` / `pe` / `start` /
`end`). Store name sits in `<bdi>`.

## 9. Data-authority decisions

- Live identity is `storefronts.name`. Display-name override is draft-only.
- Preview products have **no prices**.
- WhatsApp is a constructed `wa.me` URL, never a send.
- Merchant CR/license may appear as merchant-provided footer text. They
  never become a Verified badge.
- Save / Publish never report success.
- Public storefront does not read the draft.

## 10. Tenant / security assessment

No stop condition was hit. This visual round did not touch isolation,
authorization, APIs, schema, or persistence.

| Guardrail | Held how |
|---|---|
| Tenant isolation | Untouched. No new workspace fetch. Selected store name is display-only. |
| No invented API / migration / schema | Architecture test. Capabilities record the missing contracts. |
| No browser storage as persistence | Architecture test (`localStorage.(get\|set\|remove)Item`). Save/Publish spies. |
| URL safety | `sanitizeExternalUrl`, `sanitizeLogoUrl`, WhatsApp E.164, App Store / Play host allow-lists. |
| Verification | Renderer ignores `requestedVerifiedLabel`. Architecture test forbids `Verified` / `موثّق` on the canvas. |
| AWJ branding as merchant identity | `StoreBrand` has no AWJ fallback mark. |
| Iframe of live storefront | Not used. In-editor canvas only. |
| Second catalog | Preview fixtures are labeled and unused by the public homepage. |

The web app cannot import the storefront's Tailwind v4 token sheet, so
`web/src/modules/store-experience-builder/` mirrors the builder with a
local `store-preview.css`. It is the same contract, not a second
Customizer.

## 11. Shared-component impact

Reused: `StoreBrand` (logo slot added), `storeContainerClassName`,
`categoryAccent`, `--store-*` / `presentationCssVars`,
`resolveHomeSections` (public seam, still default-only).

Locked STORE-UI-1–5 customer surfaces were not redesigned.

## 12. Changed files

**Visual round (chrome only)**
- `storefront/src/components/customizer/{ExperienceBuilder,ControlPanels,messages}.tsx|ts`
- `web/src/modules/store-experience-builder/{ExperienceBuilder,ControlPanels,messages}.tsx|ts`
- `docs/plans/store/store-ui-6-visual-qa/*.png` (required recaptures)

**Unchanged this round:** presentation contract, capabilities, preview
canvas, StoreBrand, public homepage, APIs, schema, persistence.

## 13. Tests and exact results

Visual surfaces first, then required storefront validation:

```
storefront customizer + presentation + StoreBrand + Header
  →  7 files, 29 tests passed
web vitest appearance + presentation
  →  2 files, 6 tests passed
storefront pnpm test
  →  78 files, 555 tests passed
storefront biome check (changed customizer files)
  →  3 files, no fixes applied
```

This pass still asserts:

- Save / Publish do not claim success and write no `localStorage`
- Navy preset updates `--store-primary` on the canvas
- Additional nav labels appear in the preview
- Requesting a verified badge does not mint `Verified` on the canvas
- Architecture: no presentation API client, no browser storage, no Verified badge in the preview renderer
- `/commerce/appearance` is no longer the destination placeholder

## 14. Build result

TypeScript was not re-run as a gate for chrome-only class and copy
changes. The public storefront is unchanged. `/dev/store-ui-6` remains
the design harness (`notFound()` in production). Merchant surface is
`/commerce/appearance`.

## 15. CI status

Not yet run at report time. No Laravel/PHP files were changed.

## 16. Visual QA

Harness: development-only `/dev/store-ui-6`. Recaptured after this
chrome pass:

| Width | Locale | Surface | File |
|---|---|---|---|
| 1440 | AR | Appearance | `desktop-1440-ar-theme.png` |
| 1440 | AR | Homepage composer | `desktop-1440-ar-homepage.png` |
| 1440 | AR | WhatsApp | `desktop-1440-ar-whatsapp.png` |
| 1440 | AR | Verification | `desktop-1440-ar-verification.png` |
| 1440 | EN | Appearance | `desktop-1440-en-theme.png` |
| 768 | AR | Appearance | `tablet-768-ar-theme.png` |
| 390 | AR | Customize | `mobile-390-ar-edit.png` |
| 390 | AR | Preview | `mobile-390-ar-preview.png` |
| 390 | EN | Customize | `mobile-390-en-edit.png` |

Observed while capturing:

- Desktop 1440 preview is the hero (924px canvas column).
- Editor outline is Appearance / Identity / Header & navigation /
  Homepage / Footer / Contact / WhatsApp / Social / Verification /
  Apps / Content, with hairline group breaks and a solid selected row.
- Theme presets are selectable mini-store plates, not a 5-column chip row.
- Homepage is a composer list (reorder + name + gated + visibility),
  with hero copy as its own block.
- WhatsApp / Verification / Apps use intro copy + grouped fields,
  not a flat settings form.
- Mobile 390 header is title + locale only. Save / Publish are a
  dedicated action row above Customize / Preview.
- Storefront preview itself was not redesigned.

## 17. Visual refinement (this round)

Chrome only. Capabilities, honesty, tenant isolation, and the
storefront preview canvas are unchanged. No backend, API, schema,
persistence, or browser storage was introduced.

What changed:

- **Preview dominance.** Inspector stays ~300–320px readable; the
  outline is 196px from `lg` up; preview fills the rest.
- **Editor outline, not a settings list.** Named surfaces in
  store-building order, icons + labels, selected row is inverted
  fill, groups separated by hairlines rather than category captions.
- **Theme presets** are 2-column visual plates (header + product
  tiles) with a hard selected border.
- **Homepage composer** communicates show / hide / reorder as a
  layer list.
- **Contact, WhatsApp, Verification, Apps** have section headings
  and grouped controls.
- **Mobile action hierarchy.** Title row, panel select, controls,
  Save / Publish, then Customize / Preview. Desktop actions are not
  squeezed into the 390px title.

## 18. Explicit non-goals (held)

- No merge, no deploy, no auto-merge.
- No invented presentation API, migration or schema.
- No `localStorage` / `sessionStorage` / cookies as persistence.
- No fake save or publish success.
- No second catalog.
- No AWJ branding as merchant identity.
- No page builder / HTML blocks / liquid.
- No iframe of the live storefront as unpublished-theme preview.
- STORE-UI-1–5 locked surfaces were not redesigned.
- Version history is deferred.
- Storefront preview was not redesigned.

## 19. Stop

This branch is open for **visual review only**.
`NO VISUAL APPROVAL = NO MERGE`.
