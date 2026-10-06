# ADR-27 — Flowers & Gifts merchant admin surfaces: information architecture and shared conventions (FLOWERS-H2-ADMIN)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_2_MERCHANT_ADMIN_SURFACES.md`
**Date:** 2026-10-06
**Scope:** `web/` only unless a slice states otherwise (H2-5 adds one thin, additive route over an existing service). No new tables, no change to any existing endpoint's shape, no new Commerce authority.

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- Horizon 1 delivered the Flowers & Gifts capabilities with admin **APIs** but left most without a dashboard screen; the H14 checklist honestly reports "no screen yet" for them.
- Capabilities fall into two scopes that already exist in the backend and must not be blurred:
  - **Channel/store-scoped** (`/commerce/workspace/storefronts/{id}/…`): gift policy, delivery schedule (settings, windows, blocked dates). Ownership is derived from the trusted store, never from a client-supplied channel or tenant key.
  - **Product-scoped** (`/commerce/workspace/products/{id}/…`): preparation time, personalization, add-ons, structured content. `{id}` is a product selector only; ownership is `TenantScope` (non-revealing 404).
- The commerce workspace already has a shared store selector (`CommerceStoreProvider`), a navigation list (`nav.ts`), a permission helper mirroring `Rbac`, and the AWJ design tokens and primitives (`FormAlert`, `FormActions`, `EmptyState`, `Tabs`, `Switch`, …).
- Policy is configurable, not forced (CLAUDE.md rule 6): nothing in this Horizon switches a policy on.

## 2. Decision (AWJ DECISION)

1. **Two homes, by scope.** Store-scoped settings live in the commerce workspace under `/commerce/*` and follow the selected store: `/commerce/gifting` (H2-1) and `/commerce/delivery` (H2-2…H2-5, tabs: schedule rules · windows · blocked dates · fulfilment warehouse). Product-scoped settings live in the **existing product workspace** (H2-10 unifies them), never in a parallel product list.
2. **The server is the only authority** for every value shown: policy fields, windows, dates, warehouse, preparation time, definitions, prices and availability. Screens load persisted state, send full documents on save, and re-render what the server returned. No client-side promise/price/capacity computation; client validation only mirrors documented backend limits to fail fast, and the backend rejection is always surfaced.
3. **No configured-flag duplication.** Readiness is derived by the server (`vertical-setup`); screens never store a "completed" marker.
4. **Switching a policy off keeps its values.** Saves always send the complete field set; the UI states plainly that values remain saved while the capability is off.
5. **Shared kit** (`web/src/modules/commerce-workspace/flowers-admin/`): `admin-http` (typed result with `forbidden | not_found | invalid | conflict | unavailable`, field-error extraction, store/product path builders), `messages` (AR/EN pack with parity test), `StoreGate` (store catalog states + `key={store.id}` reset so a draft can never cross stores), `SettingsList/SettingRow` (compact rows in one surface — no card-per-field), `useUnsavedGuard`, `failureText`.
6. **Permissions mirror the routes.** Store-scoped screens need `commerce.manage` (read and write, as the routes require); product-scoped screens need `products.view` to read and `products.manage` to write. A user without the permission sees a permission state and the screen issues **no** request. Hiding is never the only guard — the routes enforce.
7. **Stale-response safety.** Every load is cancellable on store/product change; a late response from a previous store/product is discarded (tested).
8. **UI standard (merge gate).** Arabic RTL first with mirrored LTR; 390/430/1024/1440 verified; loading / empty / populated / saving / validation / server-error / permission states; visible focus; `aria-invalid` + described errors; semantic tokens only; Lucide icons; no gradients, glow, heavy shadows or coloured icon boxes.

## 3. Rejected / Not adopted

- A single mega-page for all Flowers settings (mixes channel and product scopes and creates duplicate navigation to the same authority).
- Client-side "same-day/earliest date" calculation or capacity counters (the promise is server-derived — ADR-20).
- A parallel Flowers-only warehouse/fulfilment model (the existing `FulfillmentPolicy` is the authority — H2-5 only exposes it).
- Per-field cards, decorative previews that re-implement the storefront renderer, and any stored "setup completed" flag.
- Mobile-channel (`mobile-channel/*`) administration screens in this Horizon — the routes exist for delivery scheduling but App Builder / mobile gifting administration is explicitly deferred.
