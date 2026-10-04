# ADR-26 — AWJ Bloom: a Flowers & Gifts presentation pack (FLOWERS-THEME-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H15
**Date:** 2026-10-04
**Scope:** presentation only — one theme preset (PHP / web / storefront twins), the Theme Gallery entry and its apply flow. No migration, no endpoint, no new persistence.

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- Theme presets are a closed allow-list mirrored in three places that must change together: `StorefrontPresentationNormalizer::THEME_PRESETS` (PHP), `store-experience-builder/presentation/tokens.ts` (web) and `storefront/src/lib/presentation/tokens.ts`. An unknown id fails closed to `awj-modern`; a merchant-chosen primary colour survives any preset. The Theme Gallery registry had a *planned*, non-applicable floral entry ("Boutique Floral"), and its rule says a planned entry must not expose a preset until every allow-list is updated atomically.
- "Applying" a gallery theme already creates a **new draft version** (never the published store, never the working draft), then saves the preset selection into it; a failure deletes that draft.
- The data-backed home sections (ADR-21) store references and editorial text only. The merchant's own facet key is the `dimension`; products, prices, availability and dates are read live.
- Vertical doc §15 / Horizon H15: a theme chooses *how* capabilities are presented and must not own occasions, recipients, delivery truth, gift/personalization persistence, add-on pricing, inventory or checkout validation.

## 2. Decision (AWJ DECISION)

1. **`awj-bloom` ("AWJ Bloom") is a closed, additive preset** — id, a rosewood primary `#9d2449` (7.55:1 against white text), labels in the web and storefront customizer catalogues and the App Builder preset list — added to all three allow-lists in one change. It is a colour identity: **no starting bundle** (density, card, header and radius stay the merchant's / the defaults; the default radius is already the softest). Existing documents, presets and stores are untouched.
2. **The gallery's floral entry is now the applicable `awj-bloom`** (the planned placeholder is replaced, not kept alongside). The registry's "no preset until runtime-backed" invariant is preserved by shipping both together.
3. **The apply flow adds gift sections only when the store can back them,** into the new draft version only:
   - a `discovery` section per **active system facet** (occasion, recipient) the merchant actually has, using *their* facet key;
   - a `deliveryPromise` band only when delivery scheduling is **configured** (enabled with a usable window — the H14 status);
   - placed directly after the hero (or first), existing sections keep their order and content, nothing is added twice, the section limits are respected, and a merchant's own discovery for the same facet or existing delivery promise is left alone (idempotent).
   - Editorial titles are plain starter text (AR/EN) the merchant edits in the builder.
4. **The pack never blocks the theme.** If facets or setup status cannot be read, or the store has none, the theme still applies (colour only). The other gallery themes never read store data.
5. **Gallery cards preview their own colour** (each card now tints its mock with its preset's primary instead of the admin app's), so Bloom is not shown as a generic blue placeholder.
6. **Boundaries.** The theme/pack owns no taxonomy, delivery truth, gift or personalization persistence, add-on pricing, inventory or checkout validation: sections reference data that H2–H12 already own. "Nebras-inspired" styling is **not** adopted here — no Nebras-specific behaviour or branding is hard-coded.

## 3. Rejected / Not adopted

- A starting bundle (radius/density/card) for Bloom — nothing in the evidence says florals need one; a bundle forces choices the merchant would have to undo.
- Seasonal presets (Mother's Day / Ramadan): evidence-gated; they would be pure presentation but need a seasonal-content decision first.
- Writing the pack into the live or working draft, or into published config.
- A product shelf in the pack: it needs a collection or facet *value* reference the merchant has not chosen; guessing one would publish arbitrary merchandising.
- Theme-owned copy for occasions/recipients (they are merchant data).

## 4. Consequences

- Additive and backward compatible (a closed list gains one id; stored documents with other ids are unchanged; an unknown/old id still fails closed).
- Residual: Bloom is a colour + section starter, not a full visual redesign (typography/imagery treatments, seasonal variants) — those need a design/evidence pass of their own.
