# AWJ Multiple Barcode × UOM × Selling Price — UX & Domain Contract

**Status:** Approved product UX/domain decision — documentation only  
**Date:** 2026-09-14  
**Scope:** Product Create/Edit, multiple barcodes, UOM resolution, canonical selling-price authority, and future POS/Commerce consumption.  
**Related:** `AWJ_PRODUCT_CREATE_EDIT_VARIANTS_SCREEN_SPEC.md`, `AWJ_PRODUCT_VARIANTS_UX_CONTRACT.md`, VAR-PRICE-1, future VAR-POS-1 and VAR-COM-1.

## 1. Reference behavior and AWJ decision

The approved interaction is based on the reviewed Daftra Product Create/Edit behavior: the normal Product form exposes one primary Barcode field and a compact **Multiple / باركود متعدد** action. Activating it expands the barcode area inline in the same Product form and reveals an editable multiple-barcode table. It does not navigate to a separate page.

AWJ adopts this interaction pattern while preserving AWJ's own design system and domain authorities. The reference is behavioral, not a requirement to copy Daftra's visual styling or persistence model.

## 2. Default collapsed state

For the common Simple Product path, keep barcode entry compact and fast:

```text
Barcode
[ 6281007069328                         ]   [Multiple barcodes]
```

The advanced table remains collapsed until needed so ordinary Product creation is not made heavier.

## 3. Expanded multiple-barcode state

Activating **Multiple barcodes** expands an inline section below the primary barcode field.

Desktop conceptual structure:

```text
Multiple barcodes & units

Unit          Factor     Barcode          Quantity     Selling price     Actions
Piece         1          628...A          1            5.00              Remove
Pack          6          628...B          1            27.00             Remove
Carton        12         628...C          1            50.00             Remove

                                                     [+ Add barcode/unit]
```

Arabic labels should use clear business terminology. Prefer human-readable UOM descriptions such as **باكيت — 6 حبات** or **كرتون — 12 حبة** rather than exposing only technical strings such as `pcs 6`.

## 4. Required row semantics

Each editable row represents a barcode alias resolving to a concrete sellable identity and UOM. The UI exposes, as applicable:

- UOM / unit;
- conversion factor as read-only or controlled by the canonical UOM authority;
- barcode;
- quantity where required by the current barcode/UOM workflow;
- selling price for that UOM;
- remove/action control.

The row may combine barcode and UOM-price editing for user convenience, but that does not make the barcode record the pricing authority.

## 5. Canonical example

The following is explicitly valid and must remain supported:

| Sellable unit | Factor | Barcode | Canonical base selling price |
| --- | ---: | --- | ---: |
| Piece | 1 | A | SAR 5.00 |
| Pack | 6 | B | SAR 27.00 |
| Carton / Dozen | 12 | C | SAR 50.00 |

The system MUST NOT infer SAR 30.00 for Pack from `6 × 5`, nor SAR 60.00 for Carton from `12 × 5`.

**Conversion factor and commercial selling price are independent authorities.**

## 6. Price authority

VAR-PRICE-1 remains authoritative.

The price entered in the multiple-barcode row is a convenient Product Create/Edit editing surface for the canonical `Product/Variant × UOM` price. It is not an independent `Barcode.price` truth.

Conceptually:

```text
Barcode
   ↓ resolves
Product + optional ProductVariant + UOM
   ↓ prices through
Canonical Pricing Authority
```

Therefore:

- editing the selling price in this table updates the same canonical UOM price authority used elsewhere;
- no duplicate barcode-specific base price should be persisted merely because the field is visually adjacent to the barcode;
- multiple barcodes resolving to the same sellable identity + UOM resolve to the same canonical base price unless a separately approved future barcode-specific promotion domain is introduced;
- no factor-derived fallback is permitted for alternate UOM prices.

## 7. Pricing precedence remains unchanged

The multiple-barcode UX does not replace or bypass approved pricing precedence.

When resolving an actual sale, approved customer/partner Price List and Sales Channel pricing rules remain authoritative above the canonical base UOM price according to VAR-PRICE-1.

Minimum-price controls, override permissions, reason/actor requirements and other financial guards remain unchanged.

The client, scanner or POS payload MUST NOT be trusted as the price authority.

## 8. Barcode resolution

The target contract is:

```text
Barcode → Product + optional Variant + UOM → Pricing Authority
```

Barcode is therefore an identity/resolution input, not financial truth.

Barcode uniqueness and lookup must preserve existing tenant/security rules. This UX must not weaken Tenant Isolation or permit cross-tenant resolution/leakage.

## 9. Variant compatibility

The contract must support both:

```text
Simple Product:
Barcode → Product + UOM
```

and future/current Variant-managed identity:

```text
Variant-managed Product:
Barcode → Product + ProductVariant + UOM
```

No synthetic/default Variant is introduced for Simple Products.

A Variant's barcode/UOM mapping must resolve only to a Variant belonging to the same Product and tenant.

## 10. Product Create/Edit interaction requirements

- The primary Product form remains simple by default.
- **Multiple barcodes** is progressive disclosure, not a separate screen.
- Expanding/collapsing the section must not discard unsaved row state.
- Add/remove/edit operations should validate locally for fast UX while the server remains authoritative.
- Duplicate/conflicting barcode errors must identify the current tenant's conflicting input safely without leaking foreign-tenant data.
- Price fields use AWJ money conventions and integer-minor-unit persistence; UI formatting must not introduce float authority.
- Factor and selling price must be visually separate so the interface never implies automatic multiplication.
- Existing Product/UOM/barcode capabilities must remain backward compatible.

## 11. Desktop UX

Desktop uses a compact, dense editable table. The table is the hero for multiple-barcode management.

Use restrained ERP styling: neutral surfaces, clear borders, semantic validation only, no decorative cards or unnecessary color.

Keyboard traversal should follow row/column visual order. Adding a row should place focus predictably into the first required editable field.

## 12. Mobile UX

Do not squeeze the desktop table into an unusable wide grid.

The same information should be edited through compact stacked rows/cards or a focused bottom-sheet row editor with full-width controls and AWJ touch targets.

A mobile row should make these facts immediately understandable:

```text
Pack — 6 pieces
Barcode: 628...B
Selling price: SAR 27.00
[Edit] [Remove]
```

The domain contract and validation are identical to desktop.

## 13. POS responsibility — VAR-POS-1

VAR-PRICE-1 established the canonical UOM price authority, but end-to-end scanner behavior belongs to VAR-POS-1.

VAR-POS-1 must ensure that scanning barcode B in the canonical example resolves the correct sellable identity and Pack UOM, then obtains the effective price through the approved Pricing Authority. It must not calculate the price from factor or trust a barcode/client-supplied price.

Changing UOM inside POS must re-resolve the effective price for the selected UOM using the same pricing rules.

## 14. Commerce responsibility — VAR-COM-1

Commerce must consume the same sellable identity/UOM/pricing authorities rather than creating a storefront-specific barcode-price truth.

Variant-aware Commerce wiring remains scoped to VAR-COM-1 and must not be pulled into the Product UX implementation merely to make this screen appear complete.

## 15. Historical document truth

Posted/historical documents must snapshot the actual sold identity and commercial facts required by the approved document architecture, including relevant Product/Variant descriptor, UOM/factor, unit price, discount, tax and totals.

Later edits to barcode mappings, UOM prices, Product data or Variant data must never reinterpret historical posted transactions.

## 16. Settings policy

This separation is **not tenant-configurable**:

- barcode identity/resolution correctness;
- Tenant Isolation;
- canonical price authority;
- no factor-derived invented price;
- immutable historical transaction truth.

These are domain correctness boundaries, not business-policy choices.

## 17. Implementation boundaries

Already established:

- VAR-PRICE-1: canonical Product/Variant × UOM base-price authority and pricing precedence.

Product Create/Edit implementation must provide:

- progressive **Multiple barcodes** interaction;
- inline barcode/UOM/selling-price editing;
- persistence wiring to existing barcode/UOM and canonical pricing authorities without creating competing truths.

Future milestones provide:

- VAR-POS-1: scanner/UOM/effective-price end-to-end POS behavior;
- VAR-COM-1: Variant/UOM/pricing consumption in Commerce.

Do not use this UX contract to expand scope into accounting, inventory valuation, documents, POS or Commerce prematurely.

## 18. Acceptance criteria

The feature is complete only when all of the following hold:

1. A Simple Product can still be created quickly with one primary barcode.
2. The user can expand **Multiple barcodes** inline without leaving Product Create/Edit.
3. Each alternate sellable UOM can have its own explicit commercial selling price.
4. Factor never silently derives or overwrites that price.
5. The row price writes to the canonical UOM pricing authority, not a competing barcode price field.
6. Barcode resolves Product + optional Variant + UOM safely within the tenant.
7. Multiple aliases for the same identity/UOM cannot create contradictory canonical base prices.
8. Desktop remains dense and keyboard-efficient.
9. Mobile remains touch-usable without a squeezed desktop grid.
10. POS and Commerce consume the same authorities when their milestones are implemented.
11. Historical posted transactions remain immutable snapshots.
12. No security, Tenant Isolation, inventory, accounting or pricing guard is weakened.

## 19. Decision

AWJ adopts **progressive inline multiple-barcode editing** in Product Create/Edit, with a selling-price field presented alongside each barcode/UOM for operational convenience.

The UI intentionally resembles the proven business workflow observed in Daftra, while AWJ keeps a stricter architectural separation:

> **Barcode identifies the sellable identity and UOM; the canonical pricing subsystem owns the price.**

This document is the approved authority for Multiple Barcode × UOM × Selling Price UX/domain behavior unless superseded by a later explicitly approved decision.
