# AWJ Fuel Stations — Price Management UX (#2011)

**Status:** PR open, **not merged, not deployed** · **Date:** 2026-11-05
**Base:** stacked on PR #2010 (`resolve()` / `GET /fuel-stations/prices/effective` / #1998 scope fix). #2010 was **not merged** when this task started, so this branch is cut from its head; retarget to `main` once #2010 merges. No parallel pricing resolver was written.
**Scope guard:** only synthetic test data. No live station/price/tenant data was read or written; no sale, invoice or posting is created by any test.

---

## 1. Contract (written before implementation)

### 1.1 Facts verified in code (inputs to the design)

| Fact | Evidence | Consequence |
|---|---|---|
| The official fuel price is `FuelStationProductPrice` (`price_per_liter_minor`, bigint, per **liter**). Sale + display both go through `FuelStationProductPriceService::resolve()` | #2010 | The UI manages **that** table only. |
| `Product.unit` of a fuel product **must be `mL`** (`FuelQuantity::assertFuelUnitMapping`). `Product.sale_price` is minor units per **base unit (mL)** | audit `AWJ_FUEL_PRICE_SOURCE_AUDIT.md` §2.2 | A card price is never a liter price and is **never multiplied by 1000**. |
| The only place a per-liter price can exist on the card is an explicit `ProductUnitPrice` for a unit whose template factor to `mL` is exactly **1000** | `UnitTemplate`, `UnitTemplateUnit.factor`, `ProductUnitPrice` | This is the single provable source for a suggestion. |
| The card has **no VAT basis flag** (`sales` settings have no `default_tax_inclusive`; only `purchases` does) | `Settings::DEFAULTS` | The card price's tax basis is **not provable** (see D-PRICE-3). |
| Price rows are immutable (`updating` throws) **and** the old overlap check also rejected any window overlapping an **open-ended** row | `FuelStationProductPrice`, old `create()` | **Once a price existed it could never be changed** through the service. A price-management UI needs an explicit, audited replacement (see D-PRICE-2). |
| `POST /fuel-stations/prices` had **no scope check** and accepted `approved_by` from the client | `storePrice`, `StoreFuelStationProductPriceRequest` | Found and fixed here (§3). |

### 1.2 API (all server-enforced)

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /fuel-stations/prices/effective?station_id=` · `?scope=tenant_default` | `fuel.sale.view` | Exactly one of the two. Source, `price_per_liter_minor`, `unit=L`, `tax_mode`, validity, `sellable`, `blockers`. Station outside scope ⇒ 404. (Tenant mode added here; station mode from #2010.) |
| `GET /fuel-stations/prices?station_id=\|scope=\|fuel_product_id=\|page=` | `fuel.sale.view` | History, 50/page, newest first; scoped (#1998). Rows now carry `entry_source`. |
| `GET /fuel-stations/prices/suggestions?station_id=` (omit for organization) | **`fuel.sale.price.manage`** | **Read-only preview.** Never writes. Raw card price is never returned. |
| `POST /fuel-stations/prices` | **`fuel.sale.price.manage`** | See §1.3. |

### 1.3 `POST /fuel-stations/prices` contract

- **Scope (server):** `fuel_station_id` ⇒ `accessibleStation()` (404 outside the user's branches/warehouses). **Organization scope (`fuel_station_id = null`) ⇒ 403 for any user restricted to a branch or warehouse** — an organization price affects every station.
- **Approver:** always the authenticated user. `approved_by` is no longer accepted from the request (it used to allow attributing approval to an arbitrary UUID).
- **Start time:** `start_now: true` ⇒ the **server** stamps the time (whole seconds); otherwise an explicit `effective_from`. The UI never sends a client clock for "now".
- **Amount:** integer minor units per liter, `1 … 1,000,000` (10,000 SAR/L sanity cap — a unit-mistake guard, not a pricing policy).
- **Overlap:** default = rejected `422 price_overlap` (+ `can_supersede`, `conflicts[]`). Unchanged behavior for existing callers. (Boundary fix: adjacent windows `[a,b)` / `[b,c)` no longer count as overlap.)
- **Explicit supersede (`supersede: true`):** closes the overlapping **open-ended** price by setting its `effective_until` = the new start. It never touches the old price value, its start, or any sale. Refused with a reason when: the new price has an end (`supersede_requires_open_ended`), is back-dated (`supersede_backdated`, > 5 s in the past), or an existing price starts at/after the new start (`supersede_conflicts_with_later_price`). Both sides are audited (`FuelStationConfigurationEvent`).
- **Idempotency:** `idempotency_key` (`[A-Za-z0-9_-]{8,64}`, unique per tenant — additive migration). Same key + same (station, product, price) ⇒ `200` with the existing row and `meta.replayed = true` (no second row, no second audit, no second supersede); same key + different payload ⇒ `409 idempotency_key_conflict`. The product row lock serializes concurrent creates.
- **Product-card source (`source: {type:'product_card', confirm_tax_mode, confirm_unit:'L'}`):** the server **recomputes** the suggestion inside the transaction and requires: suggestion available, `confirm_unit = L`, `confirm_tax_mode` equals the fuel VAT mode in force, and the price equals the suggestion now (`suggestion_unavailable` / `suggestion_unit_unconfirmed` / `suggestion_tax_mode_mismatch` / `suggestion_stale`). The row is saved as `entry_source = product_card` with an audit reason. `Product.sale_price` and `ProductUnitPrice` are **never modified**.

### 1.4 What counts as a provable suggestion

Available only if **all** hold, else `blocked` with `blockers[]`:

1. Fuel product active and linked to a Product; mapping valid (`mL` base, `L` display).
2. The Product has a unit template with base `mL` and a unit with **factor exactly 1000**, and an explicit unit price on exactly **one** such unit (`requires_liter_price` / `ambiguous_liter_price`).
3. That price is positive (`price_not_positive`).
4. Fuel VAT mode for the target scope is set (`tax_mode_unset`).
5. The card's tax rate equals the default rate used by the sale (`tax_rate_mismatch`) — the sale uses `sales.default_tax_rate`, not the card.

Everything else stays **BLOCKED**: a price held only on the base unit (mL), no liter unit, several liter units, unit not factor-1000 even if named "L", unknown/unset VAT mode, tax-rate mismatch, inactive product. In those cases the UI says «يتطلب تحديد سعر اللتر» and offers no transfer.

---

## 2. UX (iPhone first)

Route: `/fuel-stations/prices` (workspace nav entry «أسعار الوقود», `fuel_stations.view` + `fuel.sale.view`; link from settings → pricing). Module: `web/src/modules/fuel-prices/`.

- **Scope control** (station / organization) + native station `<select>` (16 px, no iOS zoom). Station scope lists only products with an **active nozzle** at that station (+ a count of hidden registered products); organization scope lists all active fuel products.
- **Product card:** price/L (Latin digits), **source** (station / organization), **VAT basis**, **since date** (station time zone), server **sale blockers**, actions «تعديل/ضبط السعر» + «سجل الأسعار». Missing price = «السعر غير مضبوط» (never `0`), with the explicit note that the card price is not used automatically.
- **Sheet (full-screen on phone):** form (price, now/scheduled, note, VAT explanation) → **review** (product, scope, price, VAT, start, source; replacement notice with a required acknowledgement; for a card suggestion the price is **read-only** and two acknowledgements are required: unit = liter, same VAT basis) → single confirm. Double-tap lock; one logical attempt = one idempotency key; after a timeout/offline the same key is reused and the board is refetched; editing inputs starts a new attempt.
- **States:** loading skeleton, empty, no permission, offline, server error with retry, invalid response (refused, no number), read-only user (no write controls, no suggestions request), branch-restricted user (organization price read-only).
- **History sheet:** newest first, from/to, source badge, status, paging («عرض المزيد»), empty and error-with-retry states.
- **No stale cache:** key-scoped loader (tenant|user|scope) — switching scope shows `loading` immediately, late replies for a previous scope are dropped.

Visual QA: `docs/fuel-stations/visual-qa/price-management/` (19 iPhone 390×844 @2x shots: AR/EN, light/dark, every sheet step, organization scope, read-only, forbidden, error; + one desktop). Production build (no dev overlay). Chromium at iPhone size ≠ real Safari.

---

## 3. Findings fixed on the way (server-side)

| # | Finding | Fix |
|---|---|---|
| F1 | `POST /fuel-stations/prices` did not check station scope: a branch-restricted user with `fuel.sale.price.manage` could price an out-of-scope station or the whole organization | `accessibleStation()` (404) + organization scope refused (403) for restricted users |
| F2 | `approved_by` accepted from the client | Removed from the request; approver = actor |
| F3 | A price, once created open-ended, could not be changed | Explicit audited supersede (D-PRICE-2) |
| F4 | `effective_from <= newUntil` flagged adjacent windows as overlap | `<` (strict) |
| F5 | Amount unbounded | Integer 1…1,000,000 |

---

## 4. Test evidence

| Suite | Result |
|---|---|
| `FuelPriceManagementApiTest` (18) | RBAC (403 viewer), station/org/branch/warehouse/foreign-tenant scope, approver spoof ignored, server-stamped start, validation (float/0/oversize/inverted window/no start), overlap rejected & untouched, supersede (closes only the end, keeps history, 2 audit events, other scopes untouched), supersede refusals (temporary / back-dated / later price), adjacent scheduled price, **idempotency** (replay, conflict, replay after supersede closes nothing twice), history pagination 50/10, organization effective view, suggestion availability/exposure, blocked suggestions (mL-only, ambiguous, zero, factor ≠ 1000, tax rate, unit mapping, inactive, VAT unset), save-with-confirmation (missing/wrong confirmations, stale, source recorded, card rows untouched, **no journal/invoice**), blocked/changed card refused, suggestion + overlap follows supersede rule |
| `FuelEffectivePriceApiTest`, `FuelSaleServiceTest` (#2010) | still green (resource gained `entry_source`) |
| Web `src/modules/fuel-prices` | 90 tests: exact-minor parsing (incl. float traps, Arabic digits), schedule rules, payload building, row/suggestion view mapping, loader (no previous-scope data), client over real `api()` with stubbed `fetch` (paths, GET-only reads, 403/404/5xx/offline/timeout/shape), board + sheets integration (all states above, double tap = 1 POST, timeout reuses key, edit → new key, overlap/stale refusal refetch, supersede ack, suggestion acks, history paging, AR digits, axe ×4) |
| Playwright `fuel-prices-2011.spec.ts` (iPhone + desktop, AR/EN) | 32 passed: RTL/LTR, no horizontal overflow, targets ≥ 44 px, input ≥ 16 px, Latin digits, one POST with key and no client clock, replacement ack, suggestion acks |
| Full `php artisan test` | see PR description (run on the final head) |

Local runs are SQLite; PostgreSQL runs in CI. The new unique index and trigger-free additive migration work on both.

---

## 5. Not done / BLOCKED / owner decisions

| ID | Item | Status |
|---|---|---|
| **D-PRICE-2** | Replacing an open-ended price shortens its `effective_until`. Implemented as **explicit-only** (per request flag + UI acknowledgement), never automatic, never back-dated. Whether the owner accepts "closing" as consistent with "prices are immutable" is a policy call. | Implemented behind explicit opt-in; **needs owner sign-off before any production use** |
| **D-PRICE-3** | The card price has **no VAT-basis declaration**. The suggestion therefore assumes the target fuel VAT mode and **requires the user's explicit attestation** (checkbox + server-side match). It is a user attestation, not a system proof. If the owner wants stricter, a per-unit-price VAT flag must be added to the product model first. | Implemented as attestation; flagged |
| **D-PRICE-4** | Organization-scope writes are refused for any user restricted to a branch/warehouse (conservative; an organization price changes every station). | Implemented; confirm |
| — | Suggestion needs a unit template with a factor-1000 liter unit **and** an explicit unit price. Tenants that store a per-liter price any other way (e.g. a mL price typed as liters) stay **BLOCKED** by design — they must enter the price manually. | By design |
| — | No bulk/automatic transfer; one product at a time with its own review. | By design |
| — | Station-level VAT mode editing stays in station settings (unchanged); the sheet only explains it and blocks when unset. | Out of scope |
| — | Real Safari/iPhone device verification not done (Chromium at iPhone size). | Required before any activation |
| — | `pumps/nozzles/tanks` `station_id` filter (#1998 secondary item) still open. | Out of scope |

No production or live data was touched. Nothing here changes `Product.sale_price`, historical sales, or any posting.
