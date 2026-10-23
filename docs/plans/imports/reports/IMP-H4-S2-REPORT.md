# IMP-H4-S2 — Price-list items import: field contract, service and durable-engine adapter

**Branch:** `claude/imp-h4-s2-price-list-items` · **No migration, env, route, permission, accounting/ledger, ZATCA or AI-setting change.** The adapter is **not registered** in `ImportDomainRegistry`/`ImportJobDomain`; registration, the sync inspect/preview endpoints and the domain gates come in the next slice (as H3 did). Standard (deterministic) path only — the AI action (H4-S4) stays behind IMP-X-01.

## What it adds

This extracts the workbook's "Unit Prices" sheet logic into a standalone, row-unit path. The workbook itself is untouched.

- `PriceListItemImportFields` — `nebrax_id` / `sku` (product identifiers), `unit_name`, `price` (required; riyals → halalas). **Never in the contract:** a price-list column (the list is a run option — owner decision D-F of the workbook contract: no guessed/default list), product variants (VAR-PRICE-1 pricing is a later slice with an explicit contract), cost, quantity, tenant/branch. A legacy numeric `id` column is *not* auto-mapped to the Nebrax UUID (tested).
- `PriceListItemImportService` — `template`, `inspect`, `preview`/`previewWithPlan`, windowed `apply`:
  - **Price list = frozen run option** (`price_list_id`): must exist in the organisation and be active, otherwise a closed failure (`ProductWorkbookService::resolveActivePriceList`, the same single source the workbook uses). Resolved again *after* the lock at apply time, so deactivating it while a run waits fails closed.
  - **Product matching:** Nebrax ID then SKU (the name is never an identifier — refused with a clear message); the id and SKU of one row pointing at different products is `identifier_conflict`; lookups go through the branch-scoped `Product` query exactly like `PriceListController::storeItem`; inactive products refused.
  - **Item identity = product + unit.** A blank unit is the product's base unit; a named unit resolves through `UnitConversion` (unknown unit / no template → row error, never a guessed factor). Stored unit and write path are exactly `PriceListService::upsertItem` (raw requested unit passed through, as the workbook documents).
  - **Modes** `create | update | upsert` (default **`upsert`** = the workbook's behaviour). An identical price is `skip`. The preview shows `current_price` next to the new price.
  - **Price bounds:** ≥ 0, ≤ 2 decimals, and ≤ `StorePriceListItemRequest`'s 100,000,000,000 halalas cap (the workbook's looser 13-digit check is *not* inherited).
  - **In-file duplicates** — same product+unit, *including when written two ways* (id vs SKU, blank vs explicit base unit) — fail the whole file at the first chunk before any write. Identity is resolved for the whole file with light columns (`id, sku, unit`); full product models (with unit templates) are loaded only for the window.
  - **Concurrency (rule 11):** the analysis + write run after a PostgreSQL transaction-scoped advisory lock keyed by tenant + price list (no tenant-anchor lock, no-op on SQLite). The DB's unique index is the last guard, but `updateOrCreate` would *silently* let racing `create` imports all succeed — the lock is what keeps create-mode semantics.
- `PriceListItemImportAdapter` (`price_list_items`, `UNIT_ROW`): canonical options (`price_list_id`, `mode`, `mapping`), plan-drift expectation, repair-claim hook, failures export (selling price only — no cost/sensitive column).
- **Gate note for the registration slice:** the direct API writes items under `company.manage` (not `products.manage`); the registered domain must declare the same gates (the planned invariant test enforces "domain gates = direct API gates").

## Tests

- `PriceListItemImportTest` (22, SQLite + PostgreSQL): contract (no list/variant/cost, Arabic mapping, legacy `id` not mapped), template importable, missing/inactive/foreign price list + bad options fail closed, base/named-unit creates in halalas (Arabic digits), upsert create/update/skip with `current_price`, create/update mode errors, product resolution (unknown, malformed, conflicting, inactive, blank, never by name), unit and price validation incl. the exact cap boundary, **cross-form in-file duplicates fail the whole file**, windows + plan drift, atomic abort, wide-row guard, **no product-card price change and no journal entry**, **tenant isolation**, adapter options and chunk.
- `PriceListItemImportConcurrencyPostgresTest` (1, real PostgreSQL + `pcntl_fork`): four racing `create` imports of the same 30 prices — exactly one succeeds, the rest fail with a named row failure; 30 rows total. **Negative control:** with the lock removed all four "succeed" (4 ≠ 1); restored → green. Local PostgreSQL 16, not only CI.

## Known limits (disclosed)

- Variants are not priceable through import yet.
- Whole-file identity resolution runs once per chunk (light columns, bounded; revisit if 20k-row files show up slow).
- Unit-name matching inherits `UnitConversion`/template semantics as-is (no extra case folding).
- No endpoints/UI until the next slices; no screenshots (no UI here).

## Independent review (read-only subagent) — disposition

No blocking defect; stored-vs-requested unit handling, duplicate-key correctness, window/ordinal handling, price bounds, preview-vs-apply and tenant/branch scoping were traced clean. Findings:

| # | Finding | Disposition |
|---|---|---|
| 1 | The advisory-lock key used the raw `price_list_id` string; PostgreSQL resolves a UUID in any letter case, so two spellings of one list took different locks | **Fixed**: the id is lower-cased in `options()` and in the adapter's canonical form + test |
| 2 | The lock serialises import against import only; the screen's `storeItem`/`destroyItem` and the workbook sheet take no lock, so an API write landing between analysis and write is overwritten by `updateOrCreate` | **Accepted, documented** (same stance as partners/taxonomy; closing it needs the lock in `PriceListService`, a separate hardening) |
| 3 | A row that later errors (unit/inactive/…) still registers its product+unit key as the "first occurrence", so the duplicate message can point at an erroring row | **Accepted** (cosmetic; the file fails either way) |
| 4 | Inherited normaliser: `25,5` is read as 255 (comma = thousands separator), as in the workbook and product import | **Disclosed**: the preview shows the parsed price per row; a bound preview is the control. Parked as a cross-importer policy question, not changed here |
| T | Missing tests: price 0, explicit-base vs blank unit round trip, update-mode equal price, uppercase id, duplicate in a later window, other-branch product | **Added** (adapter plan/repair-claim branches are exercised by the shared engine tests, not duplicated here) |

No Codex review (quota exhausted).
