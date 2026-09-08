# Multiple UOM & Barcode Completion — PR Decomposition

**Status:** DECOMPOSED against `main` @ `528a2f78619158d0ffdbd3c730f27311a9ca5e26`
**Authorized by:** owner (Safwan), this session — decomposition authored by executor, owner-approved
**Feature plan:** `MULTIPLE-UOM-BARCODE.md` (program contract; invariants below are inherited verbatim)
**Gate satisfied:** `PHASE2-DEPENDENCIES-AND-GATES.md` — "not implementation-ready until it has its own scoped PR decomposition, API/schema decisions, migration strategy, tests, failure semantics"

---

## 1. Current-main baseline (measured, not assumed)

Half of the feature area was already delivered by Phase 1. Verified on `528a2f7`:

| Scope item | State | Evidence |
|---|---|---|
| Tenant-wide unified barcode namespace (primary + alternate) | ✅ **done** | PR-UOM-1 — `barcode_registry`, `UNIQUE(tenant_id, code)`, atomic claim/release |
| Alternate barcode backend + API | ✅ **done** | `GET/POST/DELETE /products/{id}/barcodes`, carries `unit_name` + `default_quantity` |
| `Product.unit == UnitTemplate.base_unit` | ✅ **done** | PR-UOM-1 sync + semantic mutation guard |
| Live references fail closed; no unknown-unit fallback | ✅ **done** | PR-UOM-1 guard + `UnitConversion::resolve()` |
| Historical snapshots independent of later template edits | ✅ **done** | PR-INV-2 / PR-INV-3 `unit_name`+`unit_factor` snapshots |
| Explicit per-UOM price, never derived from factor | ✅ **done** | `PriceListItem(product_id, unit_name, price)`; `PriceListService::resolve()` returns `null` when absent |
| POS exposes alternate barcodes with unit + default qty | ✅ **done** | `PosController` `pos_barcodes`, filtered to allowed units |
| **Default sales UOM / default purchase UOM** | ❌ **absent** | zero hits across `app/`, `database/`, `web/src` |
| **Product UX for units + alternate barcodes** | ❌ **absent** | no UI consumes `/products/{id}/barcodes` |
| **POS UOM switching (user-facing)** | ❌ **absent** | no `unit_name` in POS UI |
| **Workbook split → Products / Barcodes / Unit Prices** | ❌ **absent** | export writes a single `Products` sheet |

Four gaps remain. They decompose into four independently reviewable PRs.

---

## 2. PR sequence

Ordering follows `PHASE2_PLANNING_HANDOFFS.md`: *"Decompose backend master-data contract, Product UX, POS UOM selection, workbook round-trip."*

| PR | Title | Schema | Depends on | Status |
|---|---|---|---|---|
| **PR-UOM2-1** | Default sales/purchase UOM (backend master-data) | 2 nullable columns | — | ✅ merged (`fa050c2`) |
| **PR-UOM2-2** | Product UX: units + alternate barcodes | none | PR-UOM2-1 (displays defaults) | ✅ merged (`e47b249`) |
| **PR-UOM2-3** | POS UOM selection, server-authoritative | none | PR-UOM2-1, PR-UOM2-2 | ✅ merged (`74d2ed6`) |
| **PR-UOM2-4** | Workbook: Products / Barcodes / Unit Prices round-trip | none | PR-UOM2-1 | in progress, this PR |

Each is opened, reviewed and merged separately. No mega-PR.

---

## 3. PR-UOM2-1 — contract (this PR)

### Goal

Give a Product an explicit **default sales UOM** and **default purchase UOM**, validated against its current unit template, failing closed on anything unknown.

### Owner decisions recorded (this session)

| # | Decision | Chosen |
|---|---|---|
| D-A | Do defaults auto-apply to invoice/purchase lines when no unit is supplied? | **NO — presentation-only.** Stored and returned by the API for UI/POS; document services untouched. Absent unit still resolves to base unit, byte-identically. Auto-apply is a separate future decision. |
| D-B | Storage | Two **nullable** string columns on `products`. `NULL` = "use base unit" — so every existing row keeps today's behaviour with no backfill. |
| D-C | Are defaults live references under the PR-UOM-1 semantic mutation guard? | **YES.** Consistent with `ProductBarcode.unit_name` and `PriceListItem.unit_name`: renaming/removing/rebasing a unit a product uses as a default is rejected, not silently left stale. |
| D-D | Does the import/export workbook carry them? | **NO** — belongs to PR-UOM2-4. |

### In scope

- Migration: `products.default_sales_unit`, `products.default_purchase_unit` — `string(255) nullable`.
- Validation on product create/update: a supplied default must be the base unit or a named alternate unit **of the product's current template**. Unknown → 422, never a silent fallback.
- Products with no template: only `Product.unit` (the base) is acceptable.
- Exposure in `ProductResource` (and therefore the POS/product read surfaces that use it).
- Extend PR-UOM-1's `assertSemanticEditIsSafe()` so the two columns count as live references.
- Tests on SQLite **and** PostgreSQL, plus UOM/barcode regression.

### Explicitly out of scope

- Any change to `InvoiceService`, `PurchaseService`, `UnitConversion`, POS checkout, or any document line. **No behaviour change to any existing document path.**
- Any pricing behaviour. No factor-derived money, no new price surface.
- Any accounting/GL/account-mapping change.
- UI (PR-UOM2-2), POS switching (PR-UOM2-3), workbook (PR-UOM2-4).
- Weighted Barcode (D-02) and Product Variants (D-03) — remain `NEEDS DECISION`.
- Barcode namespace changes — PR-UOM-1's contract is consumed unchanged.

### Invariants inherited (must not regress)

- base quantity remains inventory truth; commercial UOM is input/presentation only;
- money is never derived from a conversion factor;
- `Product.unit == UnitTemplate.base_unit`;
- one tenant-wide atomic barcode namespace;
- strict tenant isolation; branch scope never hides a real reference;
- historical documents stay interpretable regardless of later template edits.

### Failure semantics

| Case | Result |
|---|---|
| default unit not in the product's current template | 422, fail closed |
| default unit set while product has no template and value ≠ `Product.unit` | 422 |
| `null` / omitted | accepted — means base unit; no behaviour change |
| template edit that renames/removes/rebases a unit used as a default | 422 from the PR-UOM-1 guard |

### Acceptance criteria

1. A default can be set to the base unit or any alternate of the current template, and is returned by the API.
2. An unknown unit is rejected 422 — on create and on update — with nothing written.
3. A product without a template accepts only its own base unit.
4. Existing products (NULL defaults) behave **exactly** as before: an invoice/purchase line with no unit still resolves to base unit with factor 1.
5. Renaming, removing, or rebasing a unit that some product uses as a default is rejected by the template guard.
6. Cross-tenant: a template/unit in another tenant can never validate a default here.
7. Branch: a product in another branch using the affected unit still blocks the template edit.
8. Full UOM/barcode regression suites stay green on SQLite and PostgreSQL.

### Migration strategy

Additive, nullable, no backfill, no data rewrite. Down-migration drops both columns. Deterministic on both engines.

---

## 4. PR-UOM2-2 — contract

**Status:** merged to `main` (`fa050c2ccfc7ec5dc960c7797c6f69bb415a6b89`) before this section was authored — see §3.

### Goal

Give the Product screens a UI for what PR-UOM-1 and PR-UOM2-1 already built on the backend: managing alternate barcodes (`ProductBarcode` / `barcode_registry`) and viewing/setting the two default-UOM fields. No new backend capability — this PR is frontend-only, consuming existing endpoints.

### Current-main baseline (measured before implementation)

- `GET/POST/DELETE /products/{id}/barcodes` exist and are fully tested (PR-UOM-1) but **no UI calls them** — confirmed by grep across `web/src`.
- `default_sales_unit` / `default_purchase_unit` are already returned by `ProductResource` and accepted by `StoreProductRequest`/`UpdateProductRequest` (PR-UOM2-1), but **no form field reads or writes them**.
- `web/src/messages/{ar,en}.json` already contain unused `products.*` keys for this exact UI (`alternate_barcodes`, `add_barcode`, `barcode_code`, `barcode_default_quantity`, `barcode_label`, `barcode_quantity`, `barcode_quantity_invalid`, `barcode_added`, `barcode_deleted`, `alternate_barcodes_hint`, `no_alternate_barcodes`) — confirmed unused by grep. Reused verbatim rather than inventing new copy.
- `GET /unit-templates` already returns each template's alternate `units` (name + factor); nothing new needed to populate unit dropdowns.

### In scope

- `ProductDialog` (used for both quick-create and edit, from the product list and profile pages): two new `Select` fields for `default_sales_unit`/`default_purchase_unit` (base unit or any alternate of the selected template); an "Alternate Barcodes" section (add/list/delete), shown only in edit mode (`product?.id` truthy) — a new product has no id yet, so no barcode can be attached before the first save, matching the existing media-upload section's own precedent in the same file.
- `/products/new` (the full-page create form): the same two default-unit `Select` fields, for parity — no barcode section (same reason: no id yet).
- `/products/[id]` (profile "info" tab): read-only display of the base+alternate units, the two default units, and the alternate barcodes — Quick View, per the program's UX contract; all mutation stays in `ProductDialog` via the Edit button already on this page.
- New translation keys only for what did not already exist (`default_sales_unit`, `default_purchase_unit`, `default_unit_base_option`, a short presentation-only hint, `units`, `unit_base_badge`, `barcode_delete_confirm`).

### Explicitly out of scope

- Any backend change: no new route, no new column, no change to `ProductController`, `UnitTemplateController`, `StoreProductBarcodeRequest`, or any validation already shipped in PR-UOM-1/PR-UOM2-1.
- Any change to how `InvoiceService`/`PurchaseService`/POS resolve a line's unit — D-A (presentation-only) stays in force; the new selects only read/write the two columns, nothing else.
- Any pricing UI or factor-derived price.
- POS UOM switching (PR-UOM2-3) and the workbook (PR-UOM2-4).
- A parallel barcode system, a second `barcode_1`/`barcode_2` style field, or bypassing `barcode_registry`.
- A general redesign of the product screens: no new tab, no new route, no restructuring of the existing dialog/page layout beyond adding the fields/section above in-place.

### Acceptance criteria

1. From the product list or profile page, an existing product can have alternate barcodes added, listed, and deleted through the UI, using the existing API and its existing validation (unit membership, atomic namespace, tenant isolation) — the UI adds no client-side policy the backend does not already enforce.
2. A barcode add/delete failure (e.g. duplicate code, invalid unit) surfaces the backend's exact error message; no client-side guess of success.
3. `default_sales_unit`/`default_purchase_unit` can be set to the base unit or any alternate of the product's current template, in both the quick dialog and the full-page create form, and persist correctly.
4. Selecting a default unit does not change any invoice/purchase/POS line behavior — verified by not touching those code paths at all (frontend or backend).
5. The profile page's info tab shows the base+alternate units, the two defaults, and the alternate barcodes without an extra network round trip beyond what the page already fetches in parallel.
6. Loading, empty, and error states are explicit for the barcode list (skeleton while loading, a translated empty-state message, inline error on failure) — no silent blank sections.
7. RTL layout, existing design tokens, and existing component primitives (`Card`, `Input`, `Select`, `Button`, `Badge`) only — no new UI primitives.
8. `npm run build` and the existing frontend test suite stay green; no test weakened or removed.

### Deviations requiring owner sign-off

None expected — this PR touches no schema, no API contract, and no accounting/GL path. If mid-implementation something outside this scope turns out to be required, stop and ask rather than expanding it.

---

## 5. PR-UOM2-3 — contract

### Goal

Close the last open item named in PR-UOM2-2's own report: decide, and implement, whether `default_sales_unit` becomes an initial suggestion in the POS cart, and finish whatever POS UOM-switching gap that decision leaves open.

### Current-main baseline (measured before implementation — this is the load-bearing finding of this PR)

POS UOM switching is **not greenfield**. It is already built and tested, end to end, from before this PR:

| Capability | State | Evidence |
|---|---|---|
| POS catalog exposes `pos_units` (base + alternates with an explicit customer price) and `pos_barcodes` (filtered to allowed units) | ✅ done | `PosController::products()`, `PosCustomerPriceListResolver::catalogUnitsFor()` |
| Cart line carries `unit: string \| null`; a `<select>` lets the cashier switch it when >1 priced unit exists | ✅ done | `pos-active-cart.ts` `PosCartLine`; `page.tsx` `setUnit()` and the unit `<select>` |
| Scanning an alternate barcode pre-fills that barcode's own `unit_name`/`default_quantity` into the new line | ✅ done | `pos-barcode.ts` `matchPosBarcode()` / `appendPosCartProduct()` |
| Checkout resolves the unit server-side via the same `UnitConversion::resolve()` every document uses, snapshots `unit_name`/`unit_factor` on the line, and inventory posting reads `baseQuantity()` (`quantity × factor`) — never the entered quantity directly | ✅ done | `InvoiceService::create()`, `HasUnitConversion::baseQuantity()`, `InventoryService::recordSaleCogs()` |
| An alternate unit can only be sold at an explicit `PriceListItem` price (or, if `allow_unit_price_override` is on, any cashier-entered price re-validated at checkout) — never a price derived from `factor` | ✅ done | `PosCustomerPriceListResolver::posPriceFor()`, `PosService::assertUnitPricesAllowedForPos()` |
| Held sales (`PosHeldSale`) and the localStorage cart snapshot (`pos-cart-snapshot.ts`, versioned) both already carry `unit` per line | ✅ done | `StorePosHeldSaleRequest`, `isPosCartLine()` |
| Regression tests already exist for all of the above | ✅ done | `PosCheckoutTest`, `PosReturnUomTest`, `pos-barcode.test.ts`, `pos-cart-snapshot.test.ts` (see Implementation Report §10 for the full list) |
| **`default_sales_unit` pre-selecting a unit when a product is added by tap/click (not barcode scan)** | ❌ **the only real gap** | `addProduct(p)` with no `unitName` always resolves `pos_units[0]` (base); `default_sales_unit` is declared nowhere in `page.tsx`'s `Product` interface before this PR |

### Owner decision recorded (this session)

| # | Decision | Chosen |
|---|---|---|
| D-E | Does `default_sales_unit` pre-select the unit when a product is added to the POS cart by tap/click? | **NO.** Tap/click-add stays on the base unit exactly as today — D-A (presentation-only) is extended to POS verbatim, not narrowed or reinterpreted. `default_sales_unit` may be shown as a passive label only (never changes `unitName`/`unitFactor`/`quantity`/`price`). Only an explicit, manual unit choice by the cashier (the existing `<select>`) changes a line's unit. Barcode-scan pre-fill is unrelated to `default_sales_unit` — it is (and remains) driven by the scanned barcode's own `unit_name`/`default_quantity`, per its own established contract, not by this decision. |

### In scope

- One informational marker: the unit `<select>` in a cart line appends `(افتراضي)`/`(default)` to the option whose name equals the product's `default_sales_unit`, when set. Pure label; the `<select>`'s `value`, `onChange`, and every downstream computation are untouched.
- `Product.default_sales_unit?: string | null` added to `page.tsx`'s own `Product` type (the field was already on the wire via the shared `ProductResource`, just not typed/read here).
- A structural regression test asserting `default_sales_unit` appears in `page.tsx` in exactly those two places (type + label) — nowhere inside `addProduct`/`pricedUnit`/checkout-payload construction — so a future edit that quietly wires it into unit selection breaks the build instead of shipping silently.
- New translation keys: `products.default_sales_unit_marker` (ar/en).
- This §5 contract itself, and marking PR-UOM2-2's row merged in §2.

### Explicitly out of scope

- Any change to `addProduct()`, `pricedUnit()`, `setUnit()`, checkout payload construction, or any backend file — D-A/D-E mean zero behavior change to unit selection.
- `default_purchase_unit` in POS — POS is a sales-only surface; the purchase default has no POS relevance and is not touched.
- Weighted Barcode (D-02), Product Variants (D-03) — unchanged, still `NEEDS DECISION`.
- PR-UOM2-4 (workbook round-trip) — not started.
- Any accounting/GL, tax, discount, minimum-price, invoice-posting, or inventory-valuation change.
- Any widening of tenant/branch scope or relaxing of an existing guard.
- General POS redesign — the only visual change is a short suffix inside an option string of an already-existing `<select>`.

### Invariants inherited (must not regress)

- `entered quantity × unit_factor = base_quantity`, computed exactly as before, exclusively by `HasUnitConversion::baseQuantity()`, and it alone drives stock movement.
- Money is never derived from `unit_factor`; POS pricing stays exactly `PosCustomerPriceListResolver`'s explicit-price-or-null rule.
- `default_sales_unit`/`default_purchase_unit` remain presentation-only everywhere, POS included (D-A extended by D-E, not reopened).
- Unified `barcode_registry` namespace and barcode→unit/default-quantity resolution unchanged.
- A product with no template or no alternate units keeps today's base-unit-only behavior byte-identically.
- Tenant isolation / branch scope / RBAC guards unchanged — zero backend files touched.

### Acceptance criteria

1. Tapping/clicking a product tile still adds it at the base unit, regardless of whether `default_sales_unit` is set — verified structurally (guard test) and by the full existing POS test suite staying green unmodified.
2. When `default_sales_unit` is set and the product has ≥2 priced units, the unit `<select>` shows `(افتراضي)`/`(default)` next to the matching option; when unset, or the product has only the base unit, the select renders exactly as before.
3. Manually switching a cart line's unit, barcode-scan pre-fill, checkout `entered qty × factor = base qty`, POS UOM pricing, and held-sale/localStorage-cart round-trip all continue to pass their existing test suites unmodified.
4. No backend file changes; no schema/migration; no new route.
5. `npm run build` and the full frontend test suite stay green; no test weakened or removed.

### Deviations requiring owner sign-off

The only architecturally significant open question (whether `default_sales_unit` pre-selects in POS) was put to the owner before implementation, per the task's own instruction to stop rather than guess — see the "D-E" decision above. No further deviation.

---

## 6. PR-UOM2-4 — contract

### Goal

Complete the workbook round-trip: one `.xlsx` file with three independent sheets —
**Products**, **Barcodes**, **Unit Prices** — that can be exported and re-imported
without loss, alongside the existing single-sheet Products CSV/XLSX path (untouched).

### Current-main baseline (measured before implementation)

| Capability | State | Evidence |
|---|---|---|
| Product round-trip CSV/XLSX (single sheet) — `ProductImportFields`, `ProductImportService`, `ProductExportService`, `/products/import/*`, `/products/export` | ✅ done | unchanged by this PR |
| `ProductBarcode` + unified `barcode_registry` atomic namespace, `GET/POST/DELETE /products/{id}/barcodes` | ✅ done (PR-UOM-1) | reused unchanged |
| `PriceListItem(price_list_id, product_id, unit_name, price)` + `PriceListService::resolve()/upsertItem()` — explicit price, never derived from a UOM factor | ✅ done | reused unchanged |
| `SpreadsheetReader`/`SpreadsheetWriter` | **hardcoded to exactly one worksheet** | `SpreadsheetReader::readXlsx()` always resolves "the first sheet" (`firstSheetPath()`); `SpreadsheetWriter::xlsx()` always writes exactly one `sheet1.xml` |
| A "Workbook" / multi-sheet concept anywhere in the codebase | ❌ **absent** | fully greenfield — confirmed by grep across `app/`, `web/src`, `routes/` |
| A tenant-wide default/base `PriceList` concept (`is_default`) | ❌ **absent** | `PriceList` has no such column; every price list is an equal, named, `is_active` row a user picks per-document |

Two real gaps close this PR: (1) `SpreadsheetReader`/`SpreadsheetWriter` need genuine multi-sheet
capability, added as new methods — the existing single-sheet methods are untouched, so every
existing caller (product single-sheet import/export, Inventory Opening import) is byte-identical
before and after. (2) There is no field catalog yet for a Barcodes sheet or a Unit Prices sheet.

### Owner decision recorded (this session)

| # | Decision | Chosen |
|---|---|---|
| D-F | Which `PriceList` do a workbook's Unit Prices rows belong to, given `PriceListItem` is scoped by `price_list_id` and no default/base list exists? | **One price list, chosen explicitly by the user before every run — required, never guessed.** `price_list_id` is a mandatory parameter on both the workbook import and export endpoints. Import/export are symmetric round-trips for that one chosen list. No `is_default`/base-list concept is introduced. The endpoint fails closed (422) if the operation needs a price list and none was supplied — never falls back to "the first list" or any implicit choice. The chosen list must belong to the caller's tenant (validated like every other tenant-scoped reference) and be `is_active` (mirrors `PriceListService`'s own guard). Price stays an explicit `(product, unit)` value inside that one list; never derived from `unit_factor`. `PriceList`'s model, invoice/POS price-list behavior, and existing pricing paths are untouched. |

### In scope

- `SpreadsheetReader::readWorkbookXlsx()` (new method) — enumerates every `<sheet>` in an
  `.xlsx` workbook (not just the first) and returns `sheet name => rows`. XLSX only; CSV/TXT
  are rejected immediately with a clear error (CSV cannot represent three sheets — the existing
  single-sheet Products CSV path is untouched and remains the way to work with CSV).
- `SpreadsheetWriter::workbookXlsx()` (new method) — writes N worksheets (headers/rows/types
  per sheet) into one `.xlsx`, each with its own content-type, relationship, and worksheet part.
- `App\Support\BarcodeImportFields` (new) — Barcodes sheet catalog: `nebrax_id, sku, code,
  unit_name, default_quantity, label`. Product match priority is `nebrax_id` then `sku` —
  identical rule to the Products sheet, never the name.
- `App\Support\UnitPriceImportFields` (new) — Unit Prices sheet catalog: `nebrax_id, sku,
  unit_name, price`. Same product-match rule.
- `App\Services\ProductWorkbookService` (new) — orchestrates the three sheets:
  - **Products sheet**: re-uses `ProductImportService`/`ProductExportService` **unchanged** —
    the Products sheet's rows are round-tripped through the exact existing single-sheet
    machinery (same validation, same `mode`/`blank_policy`/`master_data_policy`/`mapping`
    options, same tests), not a reimplementation.
  - **Barcodes sheet**: create-only, mirroring `ProductController::storeBarcode()`'s exact
    validation (unit membership against the product's effective template, live duplicate check
    via `BarcodeRegistryEntry`, same defaults for `unit_name`/`default_quantity`) — no new
    barcode-writing policy invented.
  - **Unit Prices sheet**: upsert via `PriceListService::upsertItem()` unchanged, against the
    one `PriceList` selected for the run.
  - `apply()` runs all three sheets inside **one outer transaction**: Products first (so a
    product created by this same file is immediately resolvable), then Barcodes, then Unit
    Prices — all-or-nothing, matching the existing single-sheet "no error rows before write"
    invariant, applied workbook-wide.
- New routes (additive, `products.manage`/`products.view`, no new `EnsureApplicationActive`
  key — matching the existing product import/export routes): `GET /products/workbook/template`,
  `GET /products/workbook/fields`, `POST /products/workbook/inspect`,
  `POST /products/workbook/preview`, `POST /products/workbook/apply`,
  `GET /products/workbook/export`.
- Tests on SQLite **and** PostgreSQL.

### Explicitly out of scope

- Any change to `ProductImportService`, `ProductExportService`'s behavior, `ProductImportFields`,
  `PriceListService`, `PriceList`, `ProductBarcode`, `BarcodeRegistryEntry`, `UnitConversion`, or
  any accounting/GL/tax/discount/minimum-price/inventory-valuation path. (`ProductExportService::row()`
  is widened from `private` to `public` — a pure visibility change with no behavior change, so the
  Products sheet of the workbook export can call the exact same row-building code instead of a copy.)
- Weighted Barcode (D-02) and Product Variants (D-03) — untouched, still `NEEDS DECISION`. A
  Barcodes-sheet row is one code for one product/unit, exactly like `storeBarcode()` today.
- Frontend UI. This PR is **backend-only**, matching how PR-UOM2-1 (backend master-data) preceded
  PR-UOM2-2 (its UI) in this same program. The workbook upload/mapping/preview screen and the
  export dialog's price-list picker are a follow-up UI pass, not part of this PR.
- An `update`/`delete` mode for the Barcodes sheet, or a distinct `mode` option for the Unit
  Prices sheet — both sheets have exactly one natural semantic each (create-only for barcodes,
  upsert for prices), so no new mode vocabulary is introduced.
- Any `is_default`/base price list concept — explicitly rejected by D-F.
- Any change to how invoices/purchases/POS resolve or display price-list pricing.

### Invariants inherited (must not regress)

- `Product.unit == UnitTemplate.base_unit`; base quantity is inventory truth; commercial UOM
  is presentation/input only.
- One tenant-wide atomic barcode namespace; no `barcode_1`/`barcode_2`/parallel namespace.
- Money is never derived from `unit_factor`; every Unit Prices row is an explicit, stored price.
- `default_sales_unit`/`default_purchase_unit` remain presentation-only (D-A) — the workbook
  round-trips their existing columns on the Products sheet exactly as `ProductImportFields`
  already does; nothing new reads or auto-applies them.
- Strict tenant isolation; a `price_list_id`/`nebrax_id` from another tenant never resolves,
  never leaks existence, always reads as "not found."
- Historical documents stay interpretable regardless of later template/price-list edits.

### Failure semantics

| Case | Result |
|---|---|
| `price_list_id` missing on the workbook import/export request | 422 at request validation — fail closed, never guessed |
| `price_list_id` belongs to another tenant, or doesn't exist | 422 "not found" — no existence leak |
| `price_list_id` refers to an inactive price list | 422, mirroring `PriceListService`'s own guard |
| A Barcodes/Unit-Prices row's `nebrax_id`/`sku` resolves no product in tenant scope | row error, row skipped |
| A Barcodes row's `code` is blank, or already claimed (in-file duplicate or live DB conflict) | row error — same message class as `storeBarcode()` |
| A Barcodes row's `unit_name` is set but not in the product's effective template (base + alternates) | row error, fail-closed — no default beyond blank-means-base-unit |
| A Unit Prices row's `unit_name` is unknown to the product's template | row error (via `UnitConversion::resolve()`'s existing fail-closed exception) |
| A Unit Prices row's `price` is blank or not a valid non-negative money value | row error |
| The uploaded file is CSV/TXT | 422 immediately — workbook import requires `.xlsx` |
| The Barcodes or Unit Prices sheet is entirely absent from the uploaded workbook | not an error — that sheet contributes zero rows; only the Products sheet is mandatory |
| Any row across any of the three sheets is an error | `apply()` refuses the whole workbook — matches the existing single-sheet "no partial write" rule |
| A product/unit pair has no explicit `PriceListItem` in the selected list | omitted from the Unit Prices export — never a synthesized/derived row |

### Acceptance criteria

1. Exporting Products+Barcodes+Unit Prices for a chosen `price_list_id`, then re-importing the
   same file unmodified, changes nothing (idempotent round-trip).
2. A Barcodes-sheet row with `unit_name`/`default_quantity`/`label` creates a `ProductBarcode`
   identical in shape to one created via `POST /products/{id}/barcodes`.
3. `default_sales_unit`/`default_purchase_unit` round-trip on the Products sheet exactly as
   today; no document/POS behavior changes (zero files under `Invoice`/`Purchase`/POS touched).
4. A duplicate barcode code — within the file or already claimed in the tenant — is rejected,
   never silently overwritten, never crosses into another tenant's barcode space.
5. An unknown UOM name on either new sheet is rejected fail-closed, never defaulted to factor 1.
6. A Unit Prices row with no explicit price for a (product, unit) pair is never fabricated from
   `unit_factor` on export, and import never derives one either.
7. The existing single-sheet Products CSV/XLSX import/export (`/products/import/*`,
   `/products/export`) is provably unaffected — same tests, same results, before and after.
8. Cross-tenant: a `price_list_id`/`nebrax_id`/`sku` from another tenant never resolves anywhere
   in the workbook path.
9. Full regression (existing product import/export + barcode + price-list suites) stays green
   on SQLite and PostgreSQL.

### Migration strategy

None. Zero new tables or columns — the workbook is a new read/write surface over `Product`,
`ProductBarcode`, `PriceListItem`, `BarcodeRegistryEntry`, and `PriceList`, all unchanged.

### Deviations requiring owner sign-off

The one real architectural fork (which price list a Unit Prices sheet targets) was put to the
owner before implementation — D-F above. No further deviation. Frontend UI is explicitly deferred
(see "Explicitly out of scope"), disclosed rather than silently dropped.
