# AWJ Flowers & Gifts — Horizon 2 Progress

**Status:** IN PROGRESS — H2-1…H2-9 merged; H2-10 in review  
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
| H2-2 | Delivery Schedule Admin | MERGED | #1238 | `37d462f` |
| H2-3 | Delivery Windows & Capacity | MERGED | #1239 | `5ff339b` |
| H2-4 | Blocked Dates & Exceptions | MERGED | #1240 | `323c5f5` |
| H2-5 | Fulfillment Warehouse Setup | MERGED | #1241 | `a53bcd0` |
| H2-6 | Product Preparation Time | MERGED | #1243 | `a10359d` |
| H2-7 | Product Personalization Admin | MERGED | #1246 | `f294c2d` |
| H2-8 | Product Add-ons Admin | MERGED | #1248 | `bb03b69` |
| H2-9 | Structured Product Content Admin | MERGED | #1249 | `f8ec475` |
| H2-10 | Unified Product Gifting Workspace | PR OPEN | (see log) | — |
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

**Status:** MERGED  
**Base SHA:** `cfc16aa93527c3e2f11aab418355354499ef27b3`  
**Branch:** `flowers/h2-2-delivery-schedule-admin`  
**PR:** #1238  
**Head SHA:** `830b77d` (first head `01c5913`)  
**Merge SHA:** `37d462f54e091a4ba630b41ec3210b90e00e3b21` (squash)

#### Contract / scope
- Existing contract only: `GET /commerce/workspace/storefronts/{id}/delivery-schedule` and `PUT …/delivery-schedule/settings` (`commerce.manage`): `is_enabled`, `is_required`, `timezone` (any IANA id the server accepts), `lead_time_minutes` (0–43 200), `cutoff_time` (`HH:MM` or null), `max_days_ahead` (1–90). The whole document (settings + windows + blocked dates) is read once and shared by the tabs; every save returns it in full.
- No backend change. The full client for windows and blocked dates (used by H2-3/H2-4) ships here with tests.

#### UI / information architecture
- `/commerce/delivery` (previously a placeholder) now hosts the delivery workspace. Top: a **readiness strip** with the prerequisites that are true on the server today (scheduling on, ≥1 active window) — explicitly labelled as basic prerequisites, not an availability promise. Below: the "Availability rules" settings surface.
- Timezone is prominent: a picker (common GCC/MENA zones first, then all IANA zones; an unusual saved zone stays selectable), plus a live "Time now in the store" clock computed in that zone so the effect of the choice is concrete. Lead time is entered with a unit (minutes/hours/days, best unit chosen on load, converted to minutes), cut-off is a time input with an explicit "no cut-off" state, booking horizon 1–90 days.
- Switching the schedule off keeps the saved rules (note shown). Deep links: `?tab=` selects a tab; the H14 checklist now links `delivery_schedule` → `/commerce/delivery`.

#### Review findings (Codex, six P2 findings over four rounds — all verified valid, fixed, answered, resolved)
- Timezone choices came from the browser ICU list (aliases such as `Asia/Calcutta` the API rejects) → then from a too-small curated list → finally the **complete** `DateTimeZone::listIdentifiers()` set (419 ids) pinned by test; labels memoized and `Intl` formatters cached (perf).
- Orphan `role=tabpanel` with no tab bar → plain container until the tab bar ships.
- Unsaved drafts were lost on store switch and on in-app navigation (neither fires `beforeunload`) → workspace-level unsaved registry: store switch and any in-app link now ask first (browser Back remains unguarded — App Router has no reliable hook).
- Process note: `date-formatting-guardrail` (no direct `Intl.DateTimeFormat` outside `lib/`) failed the first web build; fixed by routing through `lib/timezone`.
- CI: duplicate push/PR runs; one PR-run sqlite job failed on an unrelated random-key ZATCA certificate test (`ZatcaQrCertificateMaterialExtractorTest`, leading-zero EC coordinate) and passed on the identical commit in the push run; merged on a fully green head.

#### Tests
- `delivery-schedule.test.ts` (mapping, limits, unit conversion, payload field names), `timezones.test.ts`, `delivery-workspace.test.tsx` (8 cases: load/units/clock, readiness honesty, save payload, local validation with aria, clear cut-off, server 422, retry + unusual zone, 403 + stale-store response).

#### Visual QA (`e2e/flowers-h2-2-delivery-schedule.spec.ts`, 13 cases; screenshots reviewed)
- AR/EN × 390/430/1024/1440 no overflow; enabled-without-windows shows the missing prerequisite; invalid days/lead → described errors → save; server rejection keeps the draft; load failure retry; permission state with no request; dark 390.

#### Tenant Isolation / RBAC
- Client sends no tenant/channel id; `commerce.manage` for read+write (route); page issues no request without it.

#### Backward compatibility
- Replaces a placeholder page; no behaviour change for existing stores.

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD: not observable from GitHub (no Railway status on the PR); production verification: NOT PERFORMED.

#### Next
- H2-3 — Delivery Windows & Capacity.

---

### H2-3 — Delivery Windows & Capacity

**Status:** MERGED  
**Base SHA:** `37d462f54e091a4ba630b41ec3210b90e00e3b21` (H2-2 merged)  
**Branch:** `flowers/h2-3-delivery-windows`  
**PR:** #1239  
**Head SHA:** `3218ebf` (first head `ebc930b`)  
**Merge SHA:** `5ff339b7581be46891766d7361edb6446f8d1057` (squash)

#### Contract / scope
- Existing contract: `PUT …/delivery-schedule/slots` (full-set, id-stable replace; `sort_order` = presentation order) and read-only `GET commerce/workspace/shipping-zones` (zone restriction for delivery windows).
- **Backend (additive, two changes):** (1) `PUT …/slots` accepts an optional `expected_revision`; the document now carries `slots_revision` (sha1 of the current windows). The comparison runs **inside the channel lock**, so a replacement built on a stale list is rejected with 409 without writing (two administrators saving at the same moment can no longer overwrite each other); omitting it keeps the old unconditional behaviour. (2) **Found by driving the real API, not by mocks:** `slots.*.weekdays.*` used Laravel `distinct`, which compares values across *all* windows, so two windows on the same weekdays (morning + evening — the commonest setup) were rejected with "duplicate value". Uniqueness is now checked per window; regression test added. Strictly more permissive; no response shape change; no migration.

#### UI / information architecture
- New "Windows" tab in the delivery workspace: windows grouped by method (delivery / pickup), each row showing label (AR/EN), time range, weekdays, capacity, zone, active state; add/edit in a dialog, reorder, activate/deactivate, delete behind a destructive confirmation (open checkouts keep their windows' ids — replace is id-stable). Capacity is entered as a number or "unlimited"; remaining capacity is never computed on the client (server authority).
- Tabs `?tab=rules|windows`; the H2-11 checklist deep-links `delivery_scheduling` here.

#### Review findings (Codex, 10 findings over four rounds — all verified valid, fixed, answered, resolved; then Codex hit its usage limit)
- Concurrency (P1×3): preflight read failure must abort the write; a stale list must close the edit dialog (no retry of an old draft); and the check must be **atomic with the write** → server-side `expected_revision` under the channel lock (409), with `slots_revision` derived from the *same* snapshot as the returned slots.
- Zones (P2×4): inactive zones not offered for new selection; zones refreshed on every dialog open; a newly chosen zone revalidated on save and **fails closed** if the read fails; each row shows its destination.
- Unsaved work (P2×2): the window draft registers with the unsaved guard; tab switching confirms before dropping a rules draft.
- CI: one sqlite job failed on the unrelated ZATCA certificate test again (EC coordinates lose leading zero bytes in `openssl_pkey_get_details`, ≈1/128 random keys); fixed in the test itself (pad to 32 bytes). Merged on a fully green pull_request-event run (sqlite, pgsql, web).

#### Tests
- `slot-editor.test.ts`, `weekday-names.test.ts`, `windows-panel.test.tsx`; backend `CommerceDeliveryScheduleTest` (30 tests incl. the new shared-weekday case) green locally.
- Playwright `flowers-h2-3-delivery-windows.spec.ts`: AR/EN × 390/430/1024/1440, dialog validation, delete confirmation, server rejection, dark mode.

#### Tenant Isolation / RBAC
- No tenant/channel id from the client; `commerce.manage` read+write; zone ids validated server-side per tenant.

#### Backward compatibility
- Additive UI; the validation change only accepts input that was wrongly rejected before.

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD: not observable from GitHub; production verification: NOT PERFORMED.

#### Next
- H2-4 — Blocked Dates & Exceptions.

---

### H2-4 — Blocked Dates & Exceptions

**Status:** MERGED  
**Base SHA:** `5ff339b7581be46891766d7361edb6446f8d1057` (H2-3 merged)  
**Branch:** `flowers/h2-4-blocked-dates`  
**PR:** #1240  
**Head SHA:** `3f9f538`  
**Merge SHA:** `323c5f58d6e7ad9cc9d2591d9b049f07936ee873` (squash)

#### Contract / scope
- Existing contract: `PUT …/delivery-schedule/blocked-dates` (full-set replace of `{date Y-m-d, method all|delivery|pickup, reason}`; dates are calendar days in the store time zone).
- Backend (additive): `expected_revision` on that PUT + `blocked_dates_revision` in the document, compared **inside the channel lock** (409, nothing written) — the same optimistic-concurrency pattern as slots, applied up front after the H2-3 review.

#### UI / information architecture
- "Blocked dates" tab: an add form (date, applies to all/delivery/pickup, optional reason) and the list with upcoming dates first (weekday + day/month/year, Latin digits) and past dates folded away with a confirmed bulk removal. Duplicate / overlapping-with-"all" / over-limit entries are refused locally with described errors; the server's rejection is always shown.
- The half-filled form registers with the unsaved guard (browser warning, in-app navigation and tab/store switch confirmations); a failed freshness read aborts the write; a stale list refreshes the view and stops the action.

#### Review / CI
- Codex had reached its usage limit before this PR opened, so no automated findings were posted; the slice was self-reviewed against the H2-3 findings (all applied up front, see above). CI: pull_request and push runs both green (sqlite, pgsql, web) on the merged head.

#### Tests
- `blocked-dates.test.ts`, `blocked-dates-panel.test.tsx` (revision sent, stale ⇒ refresh without write, pre-read fallback aborts on failure, unsaved guard); backend `CommerceDeliveryScheduleTest` (32 tests incl. the blocked-dates revision case); Playwright `flowers-h2-4-blocked-dates.spec.ts` (11 cases, AR/EN × 390/430/1024/1440, dark).

#### Tenant Isolation / RBAC
- No tenant/channel id from the client; `commerce.manage` read+write; foreign store ⇒ 404 (covered by the H2-13 access matrix).

#### Backward compatibility
- Additive; omitting `expected_revision` keeps the previous unconditional replace.

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD: not observable from GitHub; production verification: NOT PERFORMED.

#### Next
- H2-5 — Fulfilment Warehouse Setup.

---

### H2-5 — Fulfilment Warehouse Setup

**Status:** MERGED  
**Base SHA:** `323c5f58d6e7ad9cc9d2591d9b049f07936ee873` (H2-4 merged)  
**Branch:** `flowers/h2-5-fulfillment-warehouse`  
**PR:** #1241  
**Head SHA:** `ba7bfb1` (first head `7452c8b`)  
**Merge SHA:** `a53bcd0ab3a5b6e9e9bffcc7e6be588ddbf64c7a` (squash)

#### Contract / scope
- **One thin new backend route pair over the existing `FulfillmentPolicyService`** (no new table, no new authority): `GET|PUT /commerce/workspace/storefronts/{id}/fulfillment` (`commerce.manage`). `GET` returns the channel's current warehouse (or null) and the tenant's warehouses (restricted to the user's allowed warehouses when the account is branch-limited); `PUT {warehouse_id}` assigns one active warehouse via `setFixedWarehouse` (single row replaced, never duplicated). Foreign/unknown/disallowed warehouse ⇒ one non-revealing 422; inactive ⇒ 422; foreign store ⇒ 404; self-service ⇒ 403. No journal entry and no stock movement is created.

#### UI / information architecture
- "Fulfilment" tab in the delivery workspace: states plainly that same-day availability needs a warehouse to compute stock/lead from, shows the current assignment, offers only active warehouses (an inactive current one is shown, flagged, and cannot be re-chosen), links to "Create warehouse" when none exist, and the readiness strip gains the warehouse prerequisite. The H2-11 checklist deep-links `same_day_delivery` here when the warehouse is the gap. Unsaved choice registers with the unsaved guard.

#### Review / CI
- Codex out of quota (no automated findings). **CI caught one real miss:** `CommerceModuleBoundaryTest` pins the registered Commerce route URIs and lacked the new `…/storefronts/{id}/fulfillment` route; fixed by adding it to the allowlist (the first push ran only filtered suites locally — lesson: backend slices add their routes to that allowlist, and CI is the full-suite gate). Merged on a fully green head (sqlite, pgsql, web; both runs).

#### Tests
- Backend `CommerceFulfillmentAdminApiTest` (7): listing isolation, assign/replace keeps one row, invalid inputs, tenant isolation, RBAC, no accounting/stock effect, the setup checklist flips `same_day_delivery` to configured only after assignment. Web `fulfillment.test.ts`, `fulfillment-panel.test.tsx` (11 incl. unsaved guard); Playwright `flowers-h2-5-fulfillment-warehouse.spec.ts` (AR/EN × 390/430/1024/1440, dark, empty).

#### Tenant Isolation / RBAC
- Store ownership from `TenantContext`; warehouse ids resolved through tenant-scoped queries and the user's allowed set; covered again by the H2-13 access matrix.

#### Backward compatibility
- Additive routes; the same-day promise logic is untouched (it already read this policy).

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD: not observable from GitHub; production verification: NOT PERFORMED.

#### Next
- H2-6 — Product Preparation Time.

---

### H2-6 — Product Preparation Time

**Status:** MERGED  
**Base SHA:** `a53bcd0ab3a5b6e9e9bffcc7e6be588ddbf64c7a` (H2-5 merged)  
**Branch:** `flowers/h2-6-product-preparation`  
**PR:** #1243  
**Head SHA:** `8d9a15c` (earlier heads `5ba1d5f`, `396279d`)  
**Merge SHA:** `a10359d5f9de12a972c728f5dcc71397e4e45319` (squash)

#### Contract / scope
- Existing contract: `GET|PUT /commerce/workspace/products/{id}/preparation` (`products.view` read / `products.manage` write): `{ preparation_minutes }`. Effective lead time = the larger of the channel lead time (H2-2) and this product's preparation time (ADR-20); the server computes any promise — no date is computed on the client.
- No backend change.

#### UI / information architecture
- New **Gifting** tab on the existing product page (`/products/{id}?tab=gifting`), shown **only** when the tenant has a Flowers & Gifts store **and** the user holds `commerce.manage` (the capability read needs the store list); otherwise the tab is absent and no request is issued. First section: "Preparation time" — number + unit (minutes/hours/days) with the current state in words ("No product-specific lead time" / duration), the effect explained, read-only without `products.manage`.

#### Tests
- `preparation.test.ts`, `preparation-section.test.tsx`, `use-flowers-capability.test.tsx` (incl. no request without `commerce.manage`); Playwright `flowers-h2-6-product-preparation.spec.ts` (AR/EN × 390/430/1024/1440, dark, errors, read-only).

#### Tenant Isolation / RBAC
- Product ownership is `TenantScope` (non-revealing 404); write requires `products.manage`; tab hidden and zero requests for users without `commerce.manage` (an accountant with `products.manage` but no `commerce.manage` does not see the tab — deliberately conservative).

#### Backward compatibility
- Additive tab; general-retail tenants and unaffected stores see no change.

#### Review / CI
- Codex out of quota (no automated findings). The capability read was gated on `commerce.manage` (no 403 per product page) and the read-only e2e case seeds both permissions. One transient `next build` failure (Google Fonts fetch) on an earlier head; later builds green. Merged on a fully green head (sqlite, pgsql, web; both runs).

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD: not observable from GitHub; production verification: NOT PERFORMED.

#### Next
- H2-7 — Product Personalization Admin.

---

### H2-7 — Product Personalization Admin

**Status:** MERGED  
**Base SHA:** `a10359d5f9de12a972c728f5dcc71397e4e45319` (H2-6 merged)  
**Branch:** `flowers/h2-7-product-personalization`  
**PR:** #1246  
**Head SHA:** `135e737` (earlier heads `04abbd4`, `524bd00`, `d5d9e15`, `b6229a8`, `74dc7ff`)  
**Merge SHA:** `f294c2d11da7b4f15a04895c3801684dd776580e` (squash)

#### Contract / scope
- Existing contract: `GET|PUT /commerce/workspace/products/{id}/personalization` (`products.view` read / `products.manage` write) — a full-set replace of the product's personalization field definitions. The server stays the authority on validation and on what a shopper may enter.
- **Small additive backend change:** the document carries a `revision` (sha1 of the stored definitions); `PUT` accepts an optional `expected_revision`, compared **inside the product lock** — a mismatch returns 409 and writes nothing (no lost update between two merchants). Omitting it keeps the legacy behaviour (backward compatible). Revision and returned data come from the same snapshot.

#### UI / information architecture
- "Personalization" section in the product Gifting tab: list of fields (label, type, required, limits) with add/edit dialog (focus-trapped), reorder, remove, and one explicit Save. States: loading, empty, populated, saving, success, validation (field-level, `aria-invalid`), server error, 409 (reload + warning), read-only without `products.manage`. Unsaved edits register with the unsaved guard. When the server returns no revision, the client falls back to a pre-read and fails closed if that read fails.

#### Tests
- Backend `CommerceProductPersonalizationApiTest` (adds the stale-revision 409 case); web `personalization.test.ts`, `personalization-section.test.tsx`; Playwright `flowers-h2-7-product-personalization.spec.ts`.

#### Tenant Isolation / RBAC
- Product ownership via `TenantScope` (non-revealing 404); write requires `products.manage`; no accounting, stock or invoice effect.

#### Backward compatibility
- `expected_revision` optional; response gains `revision` additively.

#### Review / CI
- Codex review was available again for this PR (6 rounds, all valid, all fixed with a test, replied and resolved):
  1. validate option English labels (field-level); carry the fallback pre-read revision into the PUT;
  2. fail the document load on any row the client cannot parse (a whole-set save would otherwise delete it server-side); Unicode-aware length counting, no UTF-16 `maxLength` caps;
  3. **P1** — an active + required select with no active option makes the product unpurchasable: rejected on the **server** (`assertOptions`, 422, nothing written) and in the client;
  4. cart-impact warning also for a first active required field;
  5. a failed refresh after a 409 is reported (not claimed) and the stale revision dropped; leaving the Gifting tab (and sidebar links on the product page) now confirms before discarding a draft — this also closes the same gap for the H2-6 preparation draft.
- The same lessons (fallback revision carried; fail-closed mapping; failed-refresh handling) were applied proactively to add-ons (H2-8) and content (H2-9).
- One transient `next build` failure (Google Fonts fetch in an untouched module) was re-run once; both web runs on the final head green. Merged on a fully green head (sqlite, pgsql, web; both runs).

#### Deployment observation
- Manual deploy: NOT PERFORMED; automatic CI/CD: not observable from GitHub; production verification: NOT PERFORMED.

#### Next
- H2-8 — Product Add-ons Admin.

---

### H2-8 — Product Add-ons Admin

**Status:** MERGED  
**Base SHA:** `f294c2d11da7b4f15a04895c3801684dd776580e` (H2-7 merged)  
**Branch:** `flowers/h2-8-product-addons`  
**PR:** #1248  
**Head SHA:** `497d4f4` (earlier head `fcc540e`)  
**Merge SHA:** `bb03b6974023f71568c39070721863430fd64574` (squash)

#### Contract / scope
- Existing contract: `GET|PUT /commerce/workspace/products/{id}/addons` (`products.view` read / `products.manage` write) — a full-set replace of the product's add-on relations (target product + optional variant + max quantity + active). Add-on prices/availability stay with the target product/variant; the admin never sends or computes a price.
- **Small additive backend change** (same pattern as H2-7): the document carries a `revision` (projects only `addon_product_id`, `addon_variant_id`, `max_quantity`, `is_active`); `PUT` accepts an optional `expected_revision` compared inside the product + target locks — 409 and nothing written on mismatch. Optional, so the legacy behaviour is preserved.

#### UI / information architecture
- "Add-ons" section in the product Gifting tab: search/choose a product (and variant), quantity 1–10, active toggle, list with inactive-target-product flags, remove, one explicit Save. States: loading, empty, populated, saving, success, validation, server error, 409 (reload + warning, or a reported failed refresh), read-only without `products.manage`. Unreadable rows fail the load instead of being dropped; the fallback pre-read's revision is carried into the PUT.

#### Tests
- Backend `CommerceProductAddonApiTest` (stale-revision 409 case); web `addons.test.ts`, `addons-section.test.tsx`; Playwright `flowers-h2-8-product-addons.spec.ts`.

#### Tenant Isolation / RBAC
- Product and target ownership via `TenantScope`; write requires `products.manage`; no accounting, stock or invoice effect.

#### Backward compatibility
- `expected_revision` optional; response gains `revision` additively.

#### Review / CI
- Codex review ran on the first head (then hit its usage limit): 2 valid P2s, both fixed with tests, replied and resolved — (1) the editor now reads the target's and the parent's publication (`CommerceListing.is_published` stays the single source) and shows a non-blocking warning on the candidate card and on each listed row when the add-on is published on no store or shares no published store with the parent (no warning without evidence); (2) the picker, variant select, Cancel and "Add to list" are locked for the whole save so nothing confirmed mid-PUT is silently replaced by the response.
- Merged on a fully green head (sqlite, pgsql, web; both runs).

#### Deployment observation
- Manual deploy: NOT PERFORMED; production verification: NOT PERFORMED.

#### Next
- H2-9 — Structured Product Content Admin.

---

### H2-9 — Structured Product Content Admin

**Status:** MERGED  
**Base SHA:** `bb03b6974023f71568c39070721863430fd64574` (H2-8 merged)  
**Branch:** `flowers/h2-9-product-content`  
**PR:** #1249  
**Head SHA:** `4314efd`  
**Merge SHA:** `f8ec4757f932da6ff350a24fbdf5998f2ca82f64` (squash)

#### Contract / scope
- Existing contract: `GET|PUT /commerce/workspace/products/{id}/content` (`products.view` read / `products.manage` write) — a full-set replace of the product's structured content blocks, from a closed list of 10 block types (composition, care, natural variation, included items, dimensions, materials, allergens, storage, preparation notes, personalization instructions), one block per type, plain text (≤ 2000 characters counted as Unicode characters, ≤ 40 lines), optional English text, active toggle. No HTML/rich text.
- **Small additive backend change** (same pattern as H2-7/H2-8): the document carries a `revision`; `PUT` accepts an optional `expected_revision` compared inside the product lock — 409 and nothing written on mismatch; optional, so the legacy behaviour is preserved.

#### UI / information architecture
- "Product content" section in the product Gifting tab: ordered list of blocks (type, preview, active toggle), add (only unused types are offered) / edit dialog (Arabic text required, English optional, live character/line counters), reorder, delete with confirmation, one explicit Save. States: loading, empty, populated, saving, success, validation (field-level), server error, 409 (reload + warning, or a reported failed refresh), read-only without `products.manage`. Unreadable block types fail the load instead of being dropped; the fallback pre-read's revision is carried into the PUT.

#### Tests
- Backend `CommerceProductContentApiTest` (stale-revision 409 case); web `content.test.ts`, `content-section.test.tsx`; Playwright `flowers-h2-9-product-content.spec.ts`.

#### Tenant Isolation / RBAC
- Product ownership via `TenantScope`; write requires `products.manage`; no accounting, stock or invoice effect.

#### Backward compatibility
- `expected_revision` optional; response gains `revision` additively.

#### Review / CI
- Codex had reached its usage limit before reviewing this PR, so CI was the only automated gate; the lessons from the H2-7/H2-8 reviews had been applied up front (see above). Merged on a fully green head (sqlite, pgsql, web; both runs).

#### Deployment observation
- Manual deploy: NOT PERFORMED; production verification: NOT PERFORMED.

#### Next
- H2-10 — Unified Product Gifting Workspace.

---

### H2-10 — Unified Product Gifting Workspace

**Status:** PR OPEN  
**Base SHA:** `f8ec4757f932da6ff350a24fbdf5998f2ca82f64` (H2-9 merged)  
**Branch:** `flowers/h2-10-product-gifting-workspace`  
**PR / Head / Merge SHA:** recorded in the next slice's ledger update after merge

#### Contract / scope
- Frontend-only composition: no new API, no new persistence. The four product-level sections (preparation time, personalization, add-ons, structured content) keep their own independent endpoints, validation, revisions and Save bars; the workspace only unifies navigation and context.

#### UI / information architecture
- The product page's **Gifting** tab is now one workspace with a sub-tab bar (Preparation · Personalization · Add-ons · Content), each showing the number of saved items reported by the server (not a client guess). One section visible at a time; all four stay mounted (hidden when inactive) so a section's unsaved draft survives sub-tab changes, and each section loads once when the tab opens. Deep links via `?section=` (unknown values fall back to the first section) kept in sync with `history.replaceState`. Sub-tabs are a real ARIA tablist/tabpanel set. A failure in one section does not block the others. The outer-tab and sidebar-link unsaved guards (H2-7) cover every section.

#### Tests
- `gifting-workspace.test.tsx` (sub-tab navigation, counts, deep link, draft survives a sub-tab change, read-only), updated section tests, Playwright `flowers-h2-10-product-gifting-workspace.spec.ts`.

#### Tenant Isolation / RBAC
- No change: each section's own routes enforce `products.view` / `products.manage` and tenant scoping; the tab stays hidden (and zero requests) without `commerce.manage`.

#### Backward compatibility
- Additive; the H2-6 `?tab=gifting` deep link and every earlier section behave as before.

#### Deployment observation
- Manual deploy: NOT PERFORMED; production verification: NOT PERFORMED.

#### Next
- H2-11 — Vertical Setup Center V2.

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
