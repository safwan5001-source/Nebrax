# AWJ Fuel Stations — Fuel Price Source Audit (#2008, with #1998)

**Status:** PR open, **not merged, not deployed** · **Date:** 2026-11-05
**Scope guard:** no price, station or tenant data was read from or written to a live environment. Everything below is from code and isolated tests. Nothing was inferred from the screenshot, and no numeric price is assumed.

---

## 1. Verdict (read this first)

| Question | Answer |
|---|---|
| Why does the app say «السعر غير مضبوط»? | The app reads **only** `fuel_station_product_prices` (the table the fuel-sale service prices from). That message is *truthful* when that table has no active row for the station/organization **now**. The price the owner sees on the AWJ product card lives in a **different store** (`products.sale_price`) that **no code links to the fuel price**. |
| Is the card price a valid fuel price? | **Not provably.** Unit, tax semantics, validity dates and approval trail all differ (§3). It must not be used as an automatic fallback. |
| Did the app's displayed price match the sale price? | It was *designed* to, but it re-implemented the resolution in the browser (paged price history, device clock, 6-page cap). Any divergence (clock skew, history > 6 pages, rules drift) showed a different state than the sale would use. |
| What was fixed? | One **server-side** price decision shared by the sale and the display (§4). Display = what finalization will use. No silent fallback. |
| What needs the owner? | **D-PRICE-1** — whether (and how) the product-card price may *seed* fuel prices (§6). Nothing is decided on the owner's behalf. |

> **Live-data caveat.** I cannot tell from code *which* of the causes in §2.3 applies to «نبراس الطموح». The read-only checks in §2.4 settle it in minutes.

---

## 2. Root cause

### 2.1 The authoritative sale path (verified)

`FuelSaleService::finalize` (`app/Services/FuelSaleService.php`):

1. Corporate authorization with a **contract special price** → that price + contract tax mode (corporate sales only).
2. Otherwise → `FuelStationProductPriceService::effective($station, $fuelProduct, now())`:
   **station override → organization default (`fuel_station_id IS NULL`) → throws `FUEL_PRICE_NOT_CONFIGURED`.**
   The code comment is explicit: it does **not** read `Product.sale_price`.
3. Tax mode = `FuelStationSettingsService::fuelPriceTaxMode` (station → tenant → Saudi default `tax_inclusive` → otherwise **throws**, sale rejected).
4. Invoice line: `unit_price = price_per_liter_minor`, `unit = FuelProduct.display_unit` (`L`), quantity = `quantity_mL / 1000` as an exact rational, `tax_rate = Settings sales.default_tax_rate`, `tax_inclusive` from step 3.

Price rows: `FuelStationProductPrice` — `price_per_liter_minor` (bigint minor units **per liter**), `effective_from`/`effective_until`, `status`, immutable, created only through `FuelStationProductPriceService::create` (overlap lock, active-product/station checks, `approved_by`, configuration-event audit).

### 2.2 The product card is a different thing (verified)

| Aspect | Fuel price row | `Product.sale_price` (card) |
|---|---|---|
| Unit | **per liter**, integer minor units | per **base unit** of the product. For fuel the Product's base unit **must be `mL`** (`FuelQuantity::assertFuelUnitMapping`). A per-liter price of 2.18 SAR = 0.218 halala/mL **cannot be stored as an integer** per mL. Typing 218 on the card means 218 halalas per **mL** — 1000× wrong. |
| Per-liter on the card | Only via `ProductUnitPrice` with `unit_name='L'` (needs a unit template); no code ties it to a `FuelProduct`. Conversion between units by factor is explicitly forbidden (`ProductUnitPrice` docblock). | |
| Tax | `fuel_price_tax_mode` (inclusive/exclusive) is part of the decision and snapshotted on the sale | no inclusive/exclusive flag on the price |
| Validity | dated windows, overlap-guarded, never edited | none |
| Approval / audit | `approved_by`, `reason`, `FuelStationConfigurationEvent` | none specific to fuel |
| Station scope | station override + tenant default | tenant-wide only |
| Min-price rules | — | `min_sale_price` / `enforce_min_sale_price` apply to normal invoices, not to fuel sales |

Conclusion: even when the card price is "right" to a human, it is **not safe, not dated, not unit-compatible and not tax-qualified** as a fuel price. The sale service rejects exactly this by design.

### 2.3 Candidate causes of the message (one or more may apply live)

| # | Cause | Where it shows |
|---|---|---|
| C1 | No `FuelStationProductPrice` row was ever created for these products (price entered only on the product card). **Most likely given the report.** | `not_configured` |
| C2 | Rows exist but are **future-dated, expired, or `inactive`**. | `not_configured` |
| C3 | Rows exist for a **different `fuel_product_id`** than the one the nozzles/tank use (e.g. duplicate fuel product registry entries). | `not_configured` for the dispensed product |
| C4 | Rows exist for **another station** only (no organization default). | `not_configured` |
| C5 | Device clock behind server time made a currently-valid row look future-dated (old client logic used `Date.now()`). | wrongly `not_configured` — **removed by this PR** |
| C6 | History longer than the client's 6-page cap (old logic). | «تعذّر تأكيد…» — **removed by this PR** |

### 2.4 Read-only verification (no writes; run by an authorized operator)

```sql
-- per product: how many rows, and are any active and currently effective?
SELECT fp.code, fp.name, fp.is_active, p.unit AS product_unit, p.sale_price AS card_sale_price,
       COUNT(pr.id) AS rows_total,
       COUNT(*) FILTER (WHERE pr.status='active' AND pr.effective_from <= now()
                          AND (pr.effective_until IS NULL OR pr.effective_until > now())) AS rows_effective_now
FROM fuel_products fp
JOIN products p ON p.id = fp.product_id
LEFT JOIN fuel_station_product_prices pr ON pr.fuel_product_id = fp.id AND pr.tenant_id = fp.tenant_id
WHERE fp.tenant_id = :tenant
GROUP BY fp.code, fp.name, fp.is_active, p.unit, p.sale_price;
```
Also compare `nozzles.fuel_product_id` against the products above (C3), and the `tenants.settings` / station overrides for `fuel_price_tax_mode`.
After deploy, `GET /api/fuel-stations/prices/effective?station_id=…` returns the exact verdict per product (`status`, `source`, `blockers`).

---

## 3. Price priority (documented, now enforced in one place)

1. **Station override** — active, `effective_from <= now < effective_until`, newest `effective_from` wins.
2. **Organization default** (`fuel_station_id IS NULL`), same window rules.
3. **Nothing** → `not_configured`; the sale is rejected (`FUEL_PRICE_NOT_CONFIGURED`).
4. ~~Product-card price~~ — **not a source.** Not adopted pending D-PRICE-1 (§6).

Contract special prices (corporate sales with authorization) are a separate, authorized-sale concept and are **not** shown as the pump price.

`FuelStationProductPriceService::resolve()` implements 1–3 and returns `{price, source}|null`; `effective()` (used by `finalize`) is now a thin wrapper that throws on `null`. **The display and the sale call the same function.**

---

## 4. What changed

### Backend
| Item | Change |
|---|---|
| `FuelStationProductPriceService::resolve()` | new, non-throwing; `effective()` delegates to it (behavior of the sale unchanged). Constants `SOURCE_STATION_OVERRIDE` / `SOURCE_TENANT_DEFAULT`. |
| `FuelStationSettingsService::fuelPriceTaxModeOrNull()` | non-throwing read of the same decision; `fuelPriceTaxMode()` now wraps it (same exception/message). |
| `FuelEffectivePriceReadService` | read-only presenter: per product `status` (`effective`/`not_configured`/`product_inactive`), `source`, `price_per_liter_minor` (int), `unit` (`L`), `tax_mode`, `effective_from/until`, `evaluated_at` (server time), `sellable`, `blockers[]` (`price_not_configured`/`tax_mode_unset`/`product_inactive`/`unit_mapping_invalid`). Never returns 0 for missing; never touches `Product.sale_price`. |
| `GET /api/fuel-stations/prices/effective?station_id=` | new; `fuel.sale.view` + `fuel_stations.core`; station resolved via `accessibleStation()` → **404 uniform** for foreign tenant / out-of-branch / out-of-warehouse; `station_id` required UUID (422). Optional `fuel_product_id`. No writes. |
| **#1998** `GET /api/fuel-stations/prices` | now restricted to the user's accessible stations (organization-default rows stay visible); `station_id` of an inaccessible/unknown station → 404; new `scope=station\|tenant_default` (+422 when combined with `station_id`); `uuid` validation. Response shape unchanged; unrestricted users unchanged. |

### Frontend (`web/src/modules/station-ops`)
- `prices.ts` rewritten: **no** client-side priority/clock/pagination logic; maps the server row to a display state. Anything inconsistent (non-`L` unit, unknown status/source/tax mode, effective row without price/source, product missing from the response) ⇒ `error`, never a number.
- One request per station (`/fuel-stations/prices/effective`); the read-only allow-list now permits that path and **no longer** the history path.
- `PriceLabel` shows: price per liter, **source** (station / organization default), **VAT mode** (included / before / not set), **effective-since** (and until), and the server's **sale blockers** in plain words. States are distinct: not set (+hint, no ERP link) · product inactive · no permission · load failed. The old «incomplete» state is gone with the paging cap.

### Not done on purpose
- **No fallback to the product card.** No price, station or tenant data was created, edited or imported.
- No price-entry UI in the app (write path = a later, separately approved slice; the app stays read-only per UI-0/UI-1).
- #1998 secondary item (`station_id` filter on pumps/nozzles/tanks) is **not** addressed here.

---

## 5. Behaviors worth knowing

- **Display ≠ lock.** The sale takes the price at `finalize` (`now()`), not at draft time. If a price changes between the screen and finalization, the sale uses the newer one. `evaluated_at` is returned so clients can show staleness.
- **Tax mode unset** (non-Saudi tenant with no setting): the price is still shown (it *is* the effective price) but `sellable=false` with `tax_mode_unset`, because finalization would reject it.
- **Zero price:** a genuine row with `price_per_liter_minor` ≥ 1 is required to create a price (service rule); the display never renders a missing price as 0.
- The tax **rate** on the invoice line comes from `sales.default_tax_rate`, not from `FuelProduct.tax_category` (free text, not consumed by the sale). Out of scope here; flagged for the tax review.

---

## 6. Owner decision required — D-PRICE-1 (config-vs-policy rule 6)

Whether the product-card price may feed fuel prices. Options:

| Option | What | Assessment |
|---|---|---|
| **A (recommended, current behavior)** | Fuel price table is the single source. Prices are entered once, in the fuel-price screen, with dates, approval and tax mode. | Safe, auditable, matches the sale. Needs a one-time entry (or B). |
| **B** | A **one-time, explicit, audited "adopt from product card"** action (per product/station, owner approves unit = per liter, tax mode and start date) that *creates* normal price rows. | Removes double entry without a silent fallback. Requires a unit-safe source (e.g. `ProductUnitPrice` `L`) — the `mL` base price **cannot** be used. Needs its own task + tests. |
| C | Automatic runtime fallback to `Product.sale_price` | **Not recommended / not implemented.** Unit mismatch (mL), no tax flag, no dates/approval, and silently diverges from the sale service. |

Until decided, products without a fuel price show «السعر غير مضبوط» with the hint to ask the supervisor — never a number.

---

## 7. Test evidence

| Suite | Result |
|---|---|
| `tests/Feature/FuelEffectivePriceApiTest.php` (new, 10 tests) | station > tenant default + source/unit/tax; missing ⇒ `not_configured`, card price 1000 ignored; future/expired/inactive; window precedence & fall-back; tax mode unset ⇒ blocker; station tax override; non-liter unit & inactive product; read-only (row counts unchanged) + 422/401/403/cross-tenant 404; branch/warehouse-restricted users 404; **#1998** history scoping, `scope=tenant_default`, 404/422, owner unchanged |
| `FuelSaleServiceTest::the_displayed_effective_price_is_exactly_the_price_and_tax_mode_finalization_uses` (new) | for no price / tenant default / station override + exclusive tax mode, the displayed price, source and tax mode **equal** what `finalize` stored; no price ⇒ both reject |
| Existing `--filter=Fuel` | 145 passed, 3 skipped, 0 failed (SQLite) |
| Web `src/modules/station-ops` | 384 passed (new: `toPriceResult` states, one-request-per-station, unit/shape refusal, source/VAT/date rendering, VAT-unset blocker, allow-list excludes history) |

Money is `bigint` minor units end to end (asserted as PHP `int`/JSON number). PostgreSQL runs in CI (`ci.yml`); local verification here was SQLite.
