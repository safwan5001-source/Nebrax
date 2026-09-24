# APP-BUILDER-8 — UI/UX Evidence Pass

Written before implementation, per the horizon bootstrap's mandatory workflow. This is a "major
user-facing Builder slice" by the bootstrap's own test — it is the workspace's first cross-module
integration (reading another product's live data) and its first non-component-tree editing
surface (the schema's `theme` field, not `pages`).

## Scope, fixed by evidence before design

Research (`docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1.md` task 8; architecture doc
`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §6; direct reading of
`mobile/lib/schema/app_schema.dart`, `app/Services/AppBuilder/AppSchemaParser.php`, and the Store
Customizer's real implementation) fixed what this task can honestly build:

- The App Schema's only theme concept is `theme.tokens`: a flat, unconstrained
  `Map<String, String>`. It is structurally validated (`ThemeTokens`/`validateTheme()`) but **not
  yet consumed by any Mobile Runtime widget** (grepped `mobile/lib` for any read of `theme`/
  `ThemeTokens` outside the parser itself — none exists) and **not gated by any capability/
  compatibility check** (grepped `CapabilityManifest`/`CompatibilityResolver`/`RuntimeCapabilities`
  for `theme` — none exists). Editing it is real (persists through the same validated
  `PUT .../draft` endpoint as every other schema edit) but its visual effect today is scoped to
  this workspace's own canvas preview, not the native app — the same "framework-neutral
  approximation" honesty boundary APP-BUILDER-5 already established for component rendering.
- The Store Customizer ("Use My Store Design"'s real data source) has a rich, already-shipped,
  already-tested theme model — `StorefrontPresentationConfig`
  (`web/src/modules/store-experience-builder/presentation/config.ts`): `themePreset`,
  `primaryColor` (hex), `accentColor` (hex|null), `fontPreset` (currently one fixed value),
  `density`, `radius`, `productCard`, plus `branding.{displayName, logoDataUrl,
  compactLogoDataUrl, faviconDataUrl}`. Read via the already-built, already-permission-gated
  `GET /commerce/workspace/storefronts/{id}/presentation` (`commerce.manage`) — no new backend
  route needed for this task, mirroring APP-BUILDER-6's zero-backend-change precedent.
- **No mapping from Store Customizer's named fields to `theme.tokens` keys exists anywhere.**
  This is the one real design decision this task must make — but it is a *naming* decision inside
  an already-open, already-unconstrained string map, not a schema/contract invention (unlike
  APP-BUILDER-7's blocked Conditions/Visibility/Data work, which needed genuinely new JSON fields
  and validation rules that do not exist today).
- The Store Customizer already ships a real color-derivation function,
  `presentationCssVars(primary, radius)` (`presentation/tokens.ts`) — WCAG relative-luminance
  contrast math, tint/shade mixing, CSS custom-property output (`--store-primary`,
  `--store-primary-600/700/800/50/hover/soft/foreground`, `--store-radius`, plus generic
  `--primary`/`--primary-foreground`/`--ring`/`--radius`). This is reused directly (imported, not
  reimplemented) for both deriving `theme.tokens` values and, live, for the Builder's own canvas
  preview — the same function, one source of truth, zero invented color math.
- No "Detect/Diff/Preview/Apply" UI precedent exists anywhere in this codebase for a *settings*
  comparison. The closest reusable interaction shape is the Product Import wizard's
  `setup → preview → apply → result` stepper (`web/src/modules/products/import/`) — a
  compute-proposed-changes-then-explicit-apply pattern, though for row imports, not field diffs.

## External interaction evidence (references only — no visual identity/assets copied)

1. **Theme preset swatches + a single custom-color escape hatch.** Confirmed as *internal*
   precedent, not external: the Store Customizer's own `ThemePanel`
   (`web/src/modules/store-experience-builder/ControlPanels.tsx`) already ships exactly this
   pattern — a small grid of preset color chips, one of which is "currently selected," plus a
   native `<input type="color">` + hex text field for a custom value that automatically clears the
   preset selection when it no longer matches any swatch. Reused as the *interaction shape* only
   (preset grid + escape-hatch custom field) — visual language rebuilt in AWJ Design System tokens
   (`--primary`/`--surface`/`--border`), since `ControlPanels.tsx` itself predates
   `DESIGN_SYSTEM.md` and uses raw `neutral-*` Tailwind classes, the same gap APP-BUILDER-5's
   evidence pass already flagged for `ExperienceBuilder.tsx`.
2. **Segmented single-choice controls for small fixed enums** (density/radius/product-card style,
   each 2–3 options). Confirmed internal precedent twice over: the Store Customizer's own
   `Segmented` component, *and* this exact codebase's own `appBuilder.builder` locale/device
   toggle already shipped in APP-BUILDER-5/6 (`aria-pressed` button group, active/inactive
   AWJ-token styling) — reused verbatim rather than introducing a second implementation of the
   same control.
3. **Explicit compute → compare → confirm workflow for a one-time sync action, not a persistent
   link.** WordPress.com's "Copy site" and Shopify's theme-duplication flows both show a
   before-you-commit preview rather than silently overwriting live settings — general evidence
   that a destructive-feeling settings sync should never apply itself without an explicit review
   step, reinforcing the architecture doc's own "Review Changes — preferred default direction."

## Retained vs. rejected for this task

**Retained:**
- **Manual Theme panel** inside the Builder workspace (new top-level tab, alongside the existing
  Pages/Layers structure panel — see AWJ UX Decision below): preset swatches, custom hex color,
  density/radius/product-card-style pickers — directly editable, independent of "Use My Store
  Design." Writing to `schema.theme.tokens` goes through the exact same undo/redo/dirty/save
  pipeline APP-BUILDER-6 already built for component edits, extended to cover the schema's
  top-level `theme` field (not only `pages`).
- **"Use My Store Design"**: a one-time, explicit **Detect → Diff → Preview → Apply** action
  (the architecture doc's own "Review Changes" mode — its documented *preferred default*).
  Detect calls the existing storefront list + presentation endpoints; Diff shows each proposed
  token's current vs. new value; Preview re-renders the canvas with the proposed tokens applied
  temporarily (via `presentationCssVars`, not a new rendering path); Apply merges the proposed
  tokens into the draft schema through the same edit/history pipeline as the manual panel — so
  Undo reverts a sync exactly like it reverts any other edit.
- Color/radius/density/product-card-style tokens only — **not** logo/favicon images. Store
  Customizer's logo fields are client-rendered `data:` URIs up to 512 KiB each; the App Schema's
  own `assetUrl` prop type requires a real `https://` URL (`ComponentRegistry`'s own documented
  contract), and `theme.tokens` values are validated as plain strings with no size/type
  distinction from any other token — inlining a 512 KiB data URI into a JSON column loaded on
  every draft fetch is a real, avoidable cost with no corresponding runtime consumer yet. Deferred
  explicitly, not silently dropped (see below).
- Graceful handling of the real cross-module permission boundary: reading a storefront's
  presentation requires `commerce.manage` (`routes/api.php`'s own comment: "المسودة سرّية" — the
  draft is confidential), which is not guaranteed to be held by every `apps_builder.manage` user.
  "Use My Store Design" fails closed with a clear message, never a silent crash or an empty state
  that looks like "no store design exists."

**Rejected for this task (explicitly deferred, not silently dropped):**
- **"Linked" continuous-sync mode and full inherited/override/conflict provenance tracking**
  (architecture doc §6's three sync modes and "override tracking" concept). Both would require a
  *new persisted schema field* (which app-theme values are "linked," which are "overridden," and
  since when) that does not exist in `theme.tokens`'s flat map today — a materially different
  commitment than choosing token key names inside an already-open map. Building only "Review
  Changes" (the doc's own preferred default, a one-time explicit action with no persisted
  relationship) delivers the real value without that invention. Recorded as an explicit gap for a
  later task, the same honesty discipline `dispatchStatus: DISPATCH_PROVEN_NOOP` already applies
  to actions with no real backend effect yet.
- **Logo/branding image sync** (see above) — deferred until the App Schema has (or this task
  invents, out of its own scope) a real hosted-URL asset pipeline for Builder-authored themes.
- **Multi-storefront picker UI polish beyond a plain list** (most tenants have exactly one active
  storefront in practice; `selectStoreId()`'s own fallback already defaults to the first store).
  A full picker is built only if more than one store is detected — no dedicated empty/single-store
  UI state invented beyond what "just proceed" already covers.
- **Font preset selection UI** — `FONT_PRESETS` has exactly one value (`cairo-geist`) today; a
  picker with one immutable option is the AWJ Design System's own `Field` pattern already used
  disabled in `ControlPanels.tsx` for the identical reason. The token is still synced (its value
  never varies), just with no picker control to build.

## AWJ UX Decision

1. The Builder workspace's structure panel (currently "Pages" + "Layers" only) gains a third
   top-level section: **"Theme"** — a page-independent, schema-root-level editor, not a per-page
   or per-component concept. Selecting it swaps the Inspector's content for the Theme panel;
   selecting a component afterward returns to the existing per-component Inspector. This keeps
   APP-BUILDER-5/6's three-pane shell and responsive/mobile-tab structure completely unchanged —
   this task changes what one of the structure panel's sections contains, not the shell's shape.
2. "Use My Store Design" is a button inside the Theme panel (not a separate route/modal-heavy
   flow) — Detect/Diff/Preview happen inline in the same panel, collapsing to Apply/Cancel, so the
   merchant never loses context of the canvas they were already looking at.
3. The canvas preview (`AppBuilderCanvas`) is extended to apply the theme's color tokens
   (`--primary`/`--primary-foreground`) as CSS custom properties on its root wrapper — every
   existing `bg-primary`/`text-primary-foreground` class inside already resolves through
   `var(--primary)`/`var(--primary-foreground)` (confirmed in `tailwind.config.ts`), so this is a
   one-place override, not a per-component rewrite. **Radius/density/product-card-style tokens are
   still persisted, diffed and synced like any other token, but do not yet visually change the
   canvas**: `tailwind.config.ts`'s `borderRadius.DEFAULT` is a fixed `0.5rem`, not var-driven, and
   making every `rounded`/`rounded-lg`/`rounded-full` class across the 15-component switch
   CSS-variable-driven is a materially larger, canvas-wide change this task does not make on its
   own initiative. Recorded as an explicit, scoped gap — not silently dropped — same honesty
   discipline as APP-BUILDER-3's `dispatchStatus`.
4. All new visual language comes from `DESIGN_SYSTEM.md`'s existing tokens/components — no
   parallel design language, per Quality Gate D, matching APP-BUILDER-6's precedent of reusing an
   internal pattern's *interaction shape* while rebuilding its *visual language* in AWJ tokens.

## What this pass does not cover

Templates/navigation/page management (APP-BUILDER-9); publish/validate/version/rollback
(APP-BUILDER-10); the deferred APP-BUILDER-7 concepts (Data/Actions/Conditions/Visibility) remain
untouched by this task entirely — the Theme panel edits `schema.theme` only, never
`SchemaComponent`-level fields.
