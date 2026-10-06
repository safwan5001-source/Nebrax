# AWJ Flowers & Gifts — Horizon 2 Progress

**Status:** IN PROGRESS — H2-1 in review  
**Date:** 2026-10-04  
**Planning Base:** `main` @ `6ded662bfada8f72f5ebf321dcf27b08be7939c1`  
**Execution Base (H2-1):** `main` @ `afe223cb654154fa55234ff2e360233bbc933ec3`  
**Cross-slice decisions:** `ADR-27-FLOWERS-MERCHANT-ADMIN-SURFACES.md`  
**Execution Authority:** `AWJ_FLOWERS_HORIZON_2_MERCHANT_ADMIN_SURFACES.md`  
**Predecessor Final Report:** `AWJ_FLOWERS_HORIZON_1_FINAL_REPORT.md`

---

## Current verified state

Horizon 1 is complete.

- H1–H16 merged.
- Final Horizon 1 Merge SHA: `6ded662bfada8f72f5ebf321dcf27b08be7939c1`.
- Core Flowers & Gifts capabilities work end to end.
- Main adoption gap: several merchant configuration capabilities are API-backed but lack complete AWJ dashboard surfaces.
- Railway is connected to `main` and may auto-deploy merged commits. Horizon 2 does not authorize manual deploys; every slice must report actual observed CI/CD state rather than assuming Production is unchanged.

---

## Slice tracker

| Slice | Scope | Status | PR | Merge SHA |
|---|---|---|---|---|
| H2-1 | Gift Policy Admin | PR OPEN | (see log) | — |
| H2-2 | Delivery Schedule Admin | NOT STARTED | — | — |
| H2-3 | Delivery Windows & Capacity | NOT STARTED | — | — |
| H2-4 | Blocked Dates & Exceptions | NOT STARTED | — | — |
| H2-5 | Fulfillment Warehouse Setup | NOT STARTED | — | — |
| H2-6 | Product Preparation Time | NOT STARTED | — | — |
| H2-7 | Product Personalization Admin | NOT STARTED | — | — |
| H2-8 | Product Add-ons Admin | NOT STARTED | — | — |
| H2-9 | Structured Product Content Admin | NOT STARTED | — | — |
| H2-10 | Unified Product Gifting Workspace | NOT STARTED | — | — |
| H2-11 | Vertical Setup Center V2 | NOT STARTED | — | — |
| H2-12 | Merchant Onboarding Flow | NOT STARTED | — | — |
| H2-13 | Permissions / RBAC / Tenant Isolation Pass | NOT STARTED | — | — |
| H2-14 | Admin UX / RTL / Mobile Polish | NOT STARTED | — | — |
| H2-15 | Real Merchant Journey Contract | NOT STARTED | — | — |
| H2-16 | Cross-Horizon Integration & Final Report | NOT STARTED | — | — |

---

## Mandatory UI evidence for every UI slice

A UI slice is not complete until its progress entry records:

- Arabic RTL mobile verification;
- Arabic RTL desktop verification;
- English LTR mobile verification;
- English LTR desktop verification;
- tablet verification when layout materially changes;
- loading state;
- empty state;
- validation/error state;
- disabled/dependency state when applicable;
- keyboard/focus behavior;
- no horizontal overflow;
- design-token compliance;
- confirmation that no AI-template visual patterns were introduced.

---

## Per-slice log

### H2-1 — Gift Policy Admin

**Status:** PR OPEN (Merge SHA and CI result are recorded in the next slice's ledger update)  
**Base SHA:** `afe223cb654154fa55234ff2e360233bbc933ec3`  
**Branch:** `flowers/h2-1-gift-policy-admin`  
**PR:** see the slice tracker  
**Head SHA / Merge SHA:** recorded after merge (the ledger entry for a merged slice lands in the following slice's PR)

#### Contract / scope
- Existing contract only: `GET|PUT /commerce/workspace/storefronts/{id}/gift-settings` (`commerce.manage`), four fields — `is_enabled`, `message_max_length` (1–500, default 250), `allow_hide_sender` (default on), `recipient_phone_required` (default on). The plan's "message required / sender display" fields do not exist in the backend contract and were **not** invented.
- No backend change. No migration. Store ownership is derived server-side (`{id}` is a store selector; foreign store → 404).

#### UI / information architecture
- New workspace page `/commerce/gifting` ("الإهداء" / "Gifting") in the Channel group (permission `commerce.manage`, Gift icon). One compact settings surface (`SettingsList`: one row per setting, no card-per-field), a plain-language "what shoppers will see" summary derived from the draft (text only, not a second renderer), dirty/saved indicator, Save + Discard.
- Switching gifting off keeps the other values (full field set is always sent; an info note says so).
- Shared kit introduced for the Horizon (`web/src/modules/commerce-workspace/flowers-admin/`): `admin-http`, `messages` (AR/EN + parity test), `StoreGate`, `SettingsList/SettingRow`, `useUnsavedGuard`, `failureText`. Decisions recorded in `ADR-27`.
- The H14 checklist now deep-links `gift_settings` → `/commerce/gifting` (no longer "no screen yet").

#### Tests
- `gift-settings.test.ts` (client mapping/limits/paths/payload/failure classification), `gift-policy-panel.test.tsx` (load, dirty, save payload, local validation with aria, server 422 keeps draft, discard, retry, 403 state, stale-store response discarded), `messages.test.ts` (AR/EN parity + placeholders), nav/vertical-setup tests updated.
- Full web suite: 381 files / 3164 tests passed. `npm run build`: see CI.

#### Visual QA (Playwright `e2e/flowers-h2-1-gift-policy.spec.ts`, 13 cases; screenshots reviewed)
- Arabic RTL 390/430/1024/1440 and English LTR 390/430/1024/1440 populated: no horizontal overflow, `dir` correct.
- Dirty → invalid length (red field + described error, `aria-invalid`) → save success; keyboard Space toggles the switch with a visible focus ring; server-422 error keeps draft; load failure shows Retry; `commerce.manage`-less user sees a permission state and **zero** API calls; dark mode 390 legible.
- Design-token compliance: semantic tokens/primitives only; no gradients/glow/heavy shadows/colored icon boxes.

#### Tenant Isolation / RBAC
- No new server surface. Client sends no tenant/channel identifier; `{id}` is the store id from the tenant-scoped store list. Page renders a permission state (and issues no request) without `commerce.manage`; the route itself enforces `commerce.manage` for both read and write.

#### Backward compatibility
- Purely additive web screen + one nav item + one destination-map entry. Non-Flowers stores can use it (gifting is a generic channel policy); nothing is switched on automatically.

#### Deferred
- Mobile channel gift policy (no `mobile-channel/gift-settings` route exists — would require a backend addition; App Builder/mobile gifting admin is out of Horizon 2 scope).

#### Deployment observation
- Manual deploy: NOT PERFORMED
- Automatic CI/CD deploy: UNKNOWN until merge (Railway is connected to `main`; observed state is recorded after merge)
- Production verification: NOT PERFORMED

#### Next
- H2-2 — Delivery Schedule Admin (`/commerce/delivery`).

---

## Per-slice log template

### H2-x — Name

**Status:** NOT STARTED / IN PROGRESS / PR OPEN / REVIEW / CI / MERGED / BLOCKED  
**Base SHA:**  
**Branch:**  
**PR:**  
**Head SHA:**  
**Merge SHA:**  

#### Contract / scope
- 

#### UI / information architecture
- 

#### What was implemented
- 

#### Tests
- 

#### CI
- 

#### Visual QA
- Arabic RTL mobile:
- Arabic RTL desktop:
- English LTR mobile:
- English LTR desktop:
- Tablet:
- Dark mode:
- Empty/loading/error:
- Keyboard/focus:
- Overflow:

#### Tenant Isolation / RBAC
- 

#### Backward compatibility
- 

#### Findings / risks
- 

#### Deferred
- 

#### Deployment observation
- Manual deploy: NOT PERFORMED
- Automatic CI/CD deploy: UNKNOWN / NOT OBSERVED / OBSERVED
- Production verification: NOT PERFORMED / UNKNOWN / VERIFIED
- Notes:

#### Next
- 

---

## Deferred / evidence-gated

Do not pull these into Horizon 2 merely because adjacent UI is being built:

- bundles;
- bouquet BOM / recipe / assembly;
- substitutions;
- no-address gifting;
- recipient notifications;
- customer image/file personalization upload;
- money/cash gifts;
- corporate gifting;
- saved recipients before shared identity/address contract;
- reorder before safe repricing/availability contract;
- wishlist before shared capability;
- payment activation / gateway fee accounting;
- perishable/personalized returns policy;
- App Builder/mobile admin unless separately authorized.

---

## Final report target

At H2-16 create:

`docs/plans/store/AWJ_FLOWERS_HORIZON_2_FINAL_REPORT.md`

It must contain the complete branch/PR/SHA table, test/CI evidence, UI evidence, security/tenancy review, remaining risks, deferred domains, and the **actual** deployment state.
