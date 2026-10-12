# CUST-HV V10a — ThemeDefinition bundles and the pure Apply core — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V10a** — first V10 slice (**V10a model + Apply core** → V10b Preview / Apply summary / new Draft + gallery → V10c section labels, copy / paste style, reset design → V10d Library thumbnails, hover action bar, drag reorder). |
| **Branch** | `cust-hv/v10a-theme-definitions` (stacked on V9e until it merges) |
| **Authority** | V0 §16 (Contract N — theme definition, AMEND-6) · D-30 · §14.3 (commerce firewall) · §2.2 (absence = default) |
| **Scope** | Merchant app only, **no I/O**: the `ThemeDefinition` type, six built-in bundles and the pure `applyTheme(config, theme)` returning the next document and the Apply summary. No PHP, endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. The existing gallery page is untouched until V10b wires it. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| What a theme is | A bundle of **existing typed tokens only**: identity (preset / primary / accent / font preset), typography, buttons, surfaces, cards, layout, motion, density, product card, header (style + structural design), footer (layout) and a default `design` per section type. No colour roles in header / footer / section designs. | Every value is a member of a closed list the three normalizers already enforce; structural tokens cannot fail a contrast gate, so a built-in theme is publishable by construction. |
| Theme ids vs presets | A theme builds **on** an allow-listed `themePreset`; it adds no new preset id. Six themes: Modern, Market, Bloom (the three existing identities, now complete bundles), Atelier, Trade, Sand. | V0: "a theme is `available` only when every token it uses is runtime-backed"; adding a preset id would touch every allow-list. |
| Replace vs merge | Within the areas a theme covers, the result is the theme's value — or the store default where the theme says nothing. Content, media, links, logos, navigation, announcements, section order and visibility are never touched. Per-section `design` is replaced by the type's default (or cleared) and reported in the summary as "sections restyled". | "A theme is a complete visual system"; recoverable because the apply lands in a NEW Draft Version (V10b). |
| Palette overrides | A theme apply drops `palette` role overrides (listed under *identity*). | Role overrides are part of the identity the theme replaces; the summary says so. |
| Assets | `ThemeDefinition.assets` exists but **applying a theme that lists any fails closed** (`assets_unsupported`); no built-in theme lists one. | Clone-on-apply (AMEND-6) needs a global tenant-less asset store plus a server-side R2 copy — new infrastructure that nothing needs while no theme ships imagery. Gating the capability keeps the invariant (a global asset is never written into a tenant document) without speculative infra. **DEFERRED** until a theme ships stock imagery; the tenant-isolation proof below holds meanwhile. |
| Apply summary shape | Ten areas in a fixed order (`identity · typography · buttons · surfaces · cards · layout · motion · header · footer · sections`), each `changed` or not (sections also list the ids), plus the fixed "kept" list, plus `noop`. | The data the V10b dialog renders; computed by comparing normalized before / after, so it cannot disagree with what is saved. |

## Tests (`themes.test.ts`, 39)

- Registry: ≥ 6 unique ids, bilingual names / descriptions, allow-listed preset, safe primary; **no media / asset / URL / commercial key** in any theme.
- Per theme: applies and **loses nothing to normalisation** (each group equals the theme's); passes the button-contrast gate (and an outline button on its primary would also pass); **idempotent** (re-applying is a no-op with an identical document); keeps all section content, order, visibility, branding, navigation, announcements and footer tagline.
- Summary: all areas in order, kept list, restyled section ids (and only those), design limited to what the section type may use; input never mutated.
- Contrast control: a pale primary **does** fail an outline button (the gate is wired).
- Assets: a theme listing an asset is refused without touching the input; **no applied document from any built-in theme holds a media reference it did not already own** (the tenant-isolation proof the Horizon asks for, V10).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published (the core is pure; the write path is V10b's), concurrency, media ownership: untouched. **Commerce firewall:** themes are closed-list tokens; nothing sets, hides or restates a price, offer, stock or tax. No arbitrary CSS / JS / HTML. No journal entry.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
