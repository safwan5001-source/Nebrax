# ADR-25 — Flowers & Gifts vertical onboarding: honest setup status and additive starter defaults (FLOWERS-ONBOARDING-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H14
**Date:** 2026-10-04
**Scope:** backend (`StorefrontVerticalSetupService`, three store-scoped routes) and the store settings dialog (`web/`). Additive: no migration, no new table, no change to any existing endpoint's shape.

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- H1 stores the chosen vertical in a 1:1 side table (absence = `general`) and exposes a finite list of *recommended* capabilities; changing the vertical writes one row and deletes nothing. Every `VerticalCapability::isAvailable()` still returned `false` although H2–H9 merged — the store dialog therefore showed "Coming soon" for capabilities that exist.
- Occasions and recipients are `commerce_facets` with a per-tenant-unique `system_key`; values go through `CommerceFacetService` (name/slug uniqueness, per-facet limits, locking). Facets are tenant-wide, not per storefront.
- Gift policy (`commerce_gift_settings`), delivery scheduling (`commerce_delivery_schedule_settings` + slots) are per sales channel and **off by default**; product personalization fields, add-ons and content blocks are per product; the home page's data-backed sections live in the presentation draft/published documents (ADR-21).
- Policy is configurable, not forced (CLAUDE.md rule 6). Changing a vertical must not silently delete merchant data (Horizon H14).

**EXTERNAL EVIDENCE** (`AWJ_FLOWERS_GIFTS_VERTICAL_V1.md` §14): selecting the vertical should *preconfigure, not lock*; the merchant may disable or customize.

## 2. Decision (AWJ DECISION)

1. **Availability is honest.** All nine recommended capabilities are built (H2–H9); `VerticalCapability::isAvailable()` is `true` for each. "Built" is not "configured".
2. **Setup status is derived, never stored.** `GET …/storefronts/{id}/vertical-setup` returns, per recommended capability, `configured | not_configured` computed from the real configuration: active occasion/recipient values; gift policy enabled; scheduling enabled **with** at least one active window (enabled without a window is not usable by a shopper, so not configured); products with active personalization fields / add-ons / content blocks; a visible data-backed home section in the draft (the published count is also returned). "Deliver today" is derived from scheduling (ADR-20) and has no setting of its own. A general store gets an empty list. Because it is computed per request, it can never disagree with what the merchant changed elsewhere.
3. **Starter defaults are additive, previewed, and idempotent.** A finite platform catalog (`FlowersStarterCatalog`: 12 occasions, 10 recipient values, AR + EN) is *suggested*, never read by a running store. `GET …/vertical-setup/starters` previews, `POST` applies, both only for a store whose vertical is `flowers_gifts` (422 otherwise). Rules:
   - an existing system facet is reused as the merchant left it (name, key, active state untouched);
   - a value that already exists by slug **or** name (either language, case-insensitive) is left alone — renamed, disabled or merchant-created values are never overwritten, re-enabled or duplicated;
   - a non-system facet already holding the starter key is reported `blocked` and not touched or promoted;
   - writes go through `CommerceFacetService` (its validation, limits and locks); a conflict raised by a race skips that value instead of failing the batch; the whole apply runs under the tenant row lock in one transaction;
   - a second apply creates nothing.
4. **No policy is switched on.** Gift policy, scheduling, add-ons and personalization remain merchant decisions; the checklist reports their state and points to where they are managed. Where no dashboard screen exists yet, the UI says so plainly instead of showing a dead link.
5. **Home sections are a prompt, not a write.** The builder owns draft/published revisions and version history; auto-inserting sections would race with it and publish merchant-facing content nobody reviewed. The checklist item deep-links to the builder.
6. **Permissions.** Status and preview require `commerce.manage`; apply additionally requires `products.manage`, the permission that guards facet writes everywhere else, so this route cannot be used to write taxonomy a role could not write directly.
7. **Changing the vertical back to `general` removes nothing** (verified by test): the added values remain ordinary merchant data.

## 3. Rejected / Not adopted

- A stored "onboarding completed" flag (would drift from reality).
- Enabling gift/scheduling policies on selection (policy is configurable, not forced; scheduling without windows would be a dead end for shoppers).
- Auto-writing builder sections or a presentation preset on selection (builder revisions are merchant-governed; presentation is H15).
- Starter values created per storefront (facets are tenant-wide) or recreated after the merchant deleted them in a way that fights their edits: a deleted starter is simply offered again by the next preview, which the merchant can ignore.
- A parallel write path for taxonomy.

## 4. Consequences

- Backward compatible: no existing route, payload or table changes; stores that never open the setup panel behave as before.
- **Residual / adoption gap (recorded for the final report):** the dashboard has no screens for the gift policy, the delivery schedule (settings, windows, blocked dates) or per-product personalization, add-ons and content blocks — they are API-only today. The checklist shows this honestly ("No screen yet"); building those screens is the main remaining step before a merchant can enable these features without API access.
