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

| PR | Title | Schema | Depends on |
|---|---|---|---|
| **PR-UOM2-1** | Default sales/purchase UOM (backend master-data) | 2 nullable columns | — |
| PR-UOM2-2 | Product UX: units + alternate barcodes | none | PR-UOM2-1 (displays defaults) |
| PR-UOM2-3 | POS UOM selection, server-authoritative | none expected | PR-UOM2-1, PR-UOM2-2 |
| PR-UOM2-4 | Workbook: Products / Barcodes / Unit Prices round-trip | none | PR-UOM2-1 |

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
