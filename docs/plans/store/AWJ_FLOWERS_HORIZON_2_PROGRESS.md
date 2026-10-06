# AWJ Flowers & Gifts — Horizon 2 Progress

**Status:** IN PROGRESS — H2-1 merged; H2-2 in review  
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
| H2-1 | Gift Policy Admin | MERGED | #1237 | `cfc16aa` |
| H2-2 | Delivery Schedule Admin | PR OPEN | (see log) | — |
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

**Status:** MERGED  
**Base SHA:** `afe223cb654154fa55234ff2e360233bbc933ec3`  
**Branch:** `flowers/h2-1-gift-policy-admin`  
**PR:** #1237  
**Head SHA:** `bda518e53185f37ffa2c00196644ad004cb08769` (first head `562ba7d3062e33e20540fc0a4001e6c9929d1b7d`)  
**Merge SHA:** `cfc16aa93527c3e2f11aab418355354499ef27b3` (squash)

#### Contract / scope
- Existing contract only: `GET|PUT /commerce/workspace/storefronts/{id}/gift-settings` (`commerce.manage`), four fields — `is_enabled`, `message_max_length` (1–500, default 250), `allow_hide_sender` (default on), `recipient_phone_required` (default on). The plan's "message required / sender display" fields do not exist in the backend contract and were **not** invented.
- No backend change. No migration. Store ownership is derived server-side (`{id}` is a store selector; foreign store → 404).

#### UI / information architecture
- New workspace page `/commerce/gifting` ("الإهداء" / "Gifting") in the Channel group (permission `commerce.manage`, Gift icon). One compact settings surface (`SettingsList`: one row per setting, no card-per-field), a plain-language "what shoppers will see" summary derived from the draft (text only, not a second renderer), dirty/saved indicator, Save + Discard.
- Switching gifting off keeps the other values (full field set is always sent; an info note says so).
- Shared kit introduced for the Horizon (`web/src/modules/commerce-workspace/flowers-admin/`): `admin-http`, `messages` (AR/EN + parity test), `StoreGate`, `SettingsList/SettingRow`, `useUnsavedGuard`, `failureText`. Decisions recorded in `ADR-27`.
- The H14 checklist deep-links `gift_settings` → `/commerce/gifting`.

#### Review findings (Codex, both verified valid and fixed in `bda518e`, threads answered and resolved)
- **P1** — the workspace store selector is hidden below `md`, so on mobile the page configured the default store without naming it. Fixed: `StoreGate` shows the target store (switchable when several) on small screens, hidden from `md` up; `store-gate.test.tsx` + a 390px multi-store Playwright case.
- **P2** — summary promised "the sender name always appears" when hiding is off, which the checkout does not guarantee. Fixed copy: "The option to hide the sender name is not offered."

#### Tests
- `gift-settings.test.ts`, `gift-policy-panel.test.tsx`, `store-gate.test.tsx`, `messages.test.ts` (AR/EN parity); nav/vertical-setup tests updated.
- Full web suite: 381 files / 3164 tests passed; `npm run build` exit 0.
- CI on the merged head: php artisan test (sqlite) ✅, php artisan test (pgsql) ✅, web build ✅ (pull_request run). The duplicate push-event run's pgsql job was still running when the PR-event run was fully green; merged on the green PR-event run.

#### Visual QA (Playwright `e2e/flowers-h2-1-gift-policy.spec.ts`, 15 cases; screenshots reviewed)
- Arabic RTL and English LTR at 390/430/1024/1440 populated: no horizontal overflow, `dir` correct.
- Dirty → invalid length (described error, `aria-invalid`) → save success; Space toggles the switch with a visible focus ring; server-422 keeps draft; load error offers Retry; `commerce.manage`-less user gets a permission state and **zero** API calls; dark mode 390; multi-store mobile store context.
- Design-token compliance: semantic tokens/primitives only; no gradients/glow/heavy shadows/colored icon boxes.

#### Tenant Isolation / RBAC
- No new server surface; no tenant/channel identifier sent by the client; route enforces `commerce.manage` for read and write.

#### Backward compatibility
- Additive web screen + nav item + destination-map entry. Nothing is enabled automatically; non-Flowers stores unaffected.

#### Deferred
- Mobile channel gift policy (no `mobile-channel/gift-settings` route; App Builder/mobile gifting admin is outside Horizon 2).

#### Deployment observation
- Manual deploy: NOT PERFORMED
- Automatic CI/CD deploy: recorded in the final report (Railway is connected to `main`; per-merge observation is limited to what GitHub exposes — no deployment status/check from Railway appeared on the PR)
- Production verification: NOT PERFORMED

#### Next
- H2-2 — Delivery Schedule Admin.

---

### H2-2 — Delivery Schedule Admin

**Status:** PR OPEN  
**Base SHA:** `cfc16aa93527c3e2f11aab418355354499ef27b3`  
**Branch:** `flowers/h2-2-delivery-schedule-admin`  
**PR / Head / Merge SHA:** recorded in the next slice's ledger update after merge

#### Contract / scope
- Existing contract only: `GET /commerce/workspace/storefronts/{id}/delivery-schedule` and `PUT …/delivery-schedule/settings` (`commerce.manage`): `is_enabled`, `is_required`, `timezone` (any IANA id the server accepts), `lead_time_minutes` (0–43 200), `cutoff_time` (`HH:MM` or null), `max_days_ahead` (1–90). The whole document (settings + windows + blocked dates) is read once and shared by the tabs; every save returns it in full.
- No backend change. The full client for windows and blocked dates (used by H2-3/H2-4) ships here with tests.

#### UI / information architecture
- `/commerce/delivery` (previously a placeholder) now hosts the delivery workspace. Top: a **readiness strip** with the prerequisites that are true on the server today (scheduling on, ≥1 active window) — explicitly labelled as basic prerequisites, not an availability promise. Below: the "Availability rules" settings surface.
- Timezone is prominent: a picker (common GCC/MENA zones first, then all IANA zones; an unusual saved zone stays selectable), plus a live "Time now in the store" clock computed in that zone so the effect of the choice is concrete. Lead time is entered with a unit (minutes/hours/days, best unit chosen on load, converted to minutes), cut-off is a time input with an explicit "no cut-off" state, booking horizon 1–90 days.
- Switching the schedule off keeps the saved rules (note shown). Deep links: `?tab=` selects a tab; the H14 checklist now links `delivery_schedule` → `/commerce/delivery`.

#### Tests
- `delivery-schedule.test.ts` (mapping, limits, unit conversion, payload field names), `timezones.test.ts`, `delivery-workspace.test.tsx` (8 cases: load/units/clock, readiness honesty, save payload, local validation with aria, clear cut-off, server 422, retry + unusual zone, 403 + stale-store response).

#### Visual QA (`e2e/flowers-h2-2-delivery-schedule.spec.ts`, 13 cases; screenshots reviewed)
- AR/EN × 390/430/1024/1440 no overflow; enabled-without-windows shows the missing prerequisite; invalid days/lead → described errors → save; server rejection keeps the draft; load failure retry; permission state with no request; dark 390.

#### Tenant Isolation / RBAC
- Client sends no tenant/channel id; `commerce.manage` for read+write (route); page issues no request without it.

#### Backward compatibility
- Replaces a placeholder page; no behaviour change for existing stores.

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD and production verification: see the final report.

#### Next
- H2-3 — Delivery Windows & Capacity.

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
