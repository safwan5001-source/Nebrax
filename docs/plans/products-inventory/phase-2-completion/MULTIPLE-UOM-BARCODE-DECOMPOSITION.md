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
| **PR-UOM2-2** | Product UX: units + alternate barcodes | none | PR-UOM2-1 (displays defaults) | in progress, this PR |
| PR-UOM2-3 | POS UOM selection, server-authoritative | none expected | PR-UOM2-1, PR-UOM2-2 | not started |
| PR-UOM2-4 | Workbook: Products / Barcodes / Unit Prices round-trip | none | PR-UOM2-1 | not started |

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
