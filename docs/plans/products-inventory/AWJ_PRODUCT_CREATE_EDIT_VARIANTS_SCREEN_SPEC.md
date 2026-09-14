# AWJ Product Create/Edit + Variants — Screen Specification

**Status:** UI/UX implementation specification — documentation only  
**Date:** 2026-09-14  
**Depends on:** `AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md`, `AWJ_PRODUCT_VARIANTS_VAR_CORE_1_PLAN.md`, `AWJ_PRODUCT_VARIANTS_UX_CONTRACT.md`  
**Scope:** detailed Product create/edit information architecture and Variant-management interaction for desktop and mobile. No backend/schema implementation is authorized.

## 1. UX principles

The Product screen is a daily ERP work surface. Optimize for clarity, density, speed, keyboard/touch usability and confidence before decoration.

- One Product create/edit surface; Variant support appears only when needed.
- Simple Product remains simple. Do not force variant controls into the primary path.
- Use neutral surfaces, semantic tokens, light borders and restrained elevation. No gradients, decorative color blocks or oversized marketing cards.
- Desktop is information-dense; tables are the hero for Variant management.
- Mobile is task-oriented and touch-first; do not shrink the desktop table into an unusable grid.
- Arabic is primary with full RTL; English uses LTR without changing information architecture.
- Preserve current AWJ Product capabilities and progressively disclose advanced sections.

## 2. Product create/edit information architecture

Recommended section order:

1. Basic information
2. Classification
3. Images
4. Selling & purchasing
5. Units, barcodes & unit prices
6. Inventory
7. Options & variants — only when enabled
8. Online store / Commerce publication
9. Accounting & advanced settings
10. Internal notes / metadata

Exact visibility remains permission/capability-aware. Sections unavailable to the user must not leak restricted data such as cost.

## 3. Desktop shell

Use a wide ERP form rather than a narrow modal for the complete Product workflow.

Header:

```text
Products / New Product

Create Product                                      [Cancel] [Save]
Required-field / validation summary when needed
```

For edit:

```text
Products / Classic Shirt

Classic Shirt      SKU: SHIRT-001     Active        [More] [Save changes]
```

The primary content uses a dense two-column form where fields naturally pair, but long/complex sections span the full content width.

A sticky local section navigator may be used on sufficiently wide screens:

```text
Basic | Pricing | Units & barcodes | Inventory | Variants | Store | Advanced
```

It is navigation, not separate pages; unsaved form state remains intact.

## 4. Basic information

Desktop example:

```text
Basic information
┌──────────────────────────────┬──────────────────────────────┐
│ Product name *               │ English name                │
│ [Classic Shirt            ]  │ [Classic Shirt           ]  │
├──────────────────────────────┼──────────────────────────────┤
│ SKU *                        │ Product type                 │
│ [SHIRT-001                ]  │ [Goods                  ▾]  │
└──────────────────────────────┴──────────────────────────────┘
Description [.................................................]
```

SKU remains explicit even when later Variant SKUs exist. When a Product becomes variant-managed, UI copy must make clear whether the parent SKU is a family/catalog code and must not imply it is the concrete sellable SKU.

## 5. Images

Show compact gallery/upload management near the upper merchandising portion of the Product screen, not buried in advanced settings.

- explicit cover indicator;
- reorder affordance;
- add/remove images subject to permission;
- future visual Option Value media appears from Variant/Option workflow but reuses the approved media authority;
- exact Variant override media is advanced and must not clutter initial Product creation.

## 6. Selling, purchasing, UOM and barcode

For a Simple Product, preserve a direct pricing workflow.

Units/barcodes should use a compact editable table on desktop:

```text
Units & barcodes
Base unit: Piece

Unit       Factor    Barcode          Selling price      Default
Piece      1         628...           5.00               Sales
Pack       6         628...           27.00              —
Dozen      12        628...           50.00              —
                                              [+ Add unit/barcode]
```

Important: factor and selling price are visually separate columns. The UI must never imply that price is automatically factor × base price.

Barcode remains resolver input; UI may edit UOM price in the same row/workflow while persistence uses the canonical pricing authority.

## 7. Inventory

For Simple Product, inventory configuration remains familiar.

When Product is variant-managed, the parent Product section must not display a misleading writable parent quantity or average cost. Instead show a neutral explanation such as:

> Inventory is tracked per variant. Open Variants to review stock by combination.

Aggregate parent quantity may be displayed read-only where useful, but parent average cost must not be presented as financial truth when sibling Variant costs differ.

## 8. Options & variants entry point

Do not show the full Variant matrix until the user enables/starts Variant configuration.

Collapsed/simple state:

```text
Options & variants
Sell this Product in multiple options such as color or size.

[+ Add options]
```

If Product has an operational/inventory footprint that prevents safe Simple → Variant-managed transition, clicking this action must run the server-authoritative transition gate and explain blockers. UI must not offer an unsafe client-only bypass.

## 9. Option builder

Desktop:

```text
Options

Color
[Black ×] [White ×] [Blue ×]                         [Remove option]
[+ Add value]

Size
[S ×] [M ×] [L ×] [XL ×]                            [Remove option]
[+ Add value]

[+ Add another option]

3 colors × 4 sizes = 12 possible combinations
                                         [Review combinations]
```

Requirements:
- inline value entry optimized for keyboard;
- Enter commits a value and keeps focus ready for the next value;
- duplicate normalized values rejected immediately and server-side;
- drag/reorder or accessible move actions may control display order without changing logical combination identity;
- destructive edits affecting existing Variants use impact-aware confirmation, not generic “Are you sure?”.

## 10. Combination review

Generation creates proposals, not silently persisted Variants.

Desktop table:

```text
Review combinations                         10 of 12 selected
[Search] [Filter by Color ▾] [Filter by Size ▾]       [Select all]

✓  Combination       Status
☑  Black / S         New
☑  Black / M         New
☐  Black / L         Not selected
☑  Black / XL        New
...

[Back to options]                    [Create 10 variants]
```

Rules:
- existing combinations are identified and cannot be duplicated;
- only genuinely new combinations are selectable for creation;
- count is always visible before committing;
- large combination explosions require a warning before rendering/creating excessive rows; exact safe limit belongs to implementation/performance validation rather than an arbitrary UI-only constant.

## 11. Variant management table — desktop

After creation, table becomes the primary management surface.

Initial `VAR-CORE-1` columns should remain within actual core authority:

```text
☐  Variant          SKU              Status        Actions
□  Black / S        SH-BLK-S         Active        ⋯
□  Black / M        SH-BLK-M         Active        ⋯
□  White / XL       SH-WHT-XL        Inactive      ⋯
```

Future scoped PRs may add/filter columns for:
- UOM/base price/barcode (`VAR-PRICE-1`);
- available stock (`VAR-INV-1`);
- image/cover (`VAR-MEDIA-1`);
- online publication (`VAR-COM-1`).

Do not render fake/placeholder editable fields before their backend authority exists.

Table capabilities:
- search by combination/SKU;
- filters by Option Value and status;
- row selection;
- bulk activate/deactivate where lifecycle allows;
- bulk SKU action only if deterministic and collision-safe;
- column density suitable for ERP work;
- sticky header for long lists;
- clear empty/filter-empty states.

## 12. Variant detail editor — desktop

Editing one Variant should use a side sheet/drawer or focused detail surface rather than navigating away and losing Product context.

Core phase:

```text
Black / XL
Product: Classic Shirt

Combination
Color    Black
Size     XL

SKU      [SH-BLK-XL]
Status   [Active]

[Cancel] [Save]
```

Later modules add their own sections only when implemented: pricing/UOM/barcodes, inventory, media, Commerce.

Changing the combination of a Variant with protected references must follow lifecycle/domain rules; UI cannot mutate identity merely because fields are editable.

## 13. Bulk editing

Bulk actions are essential for ERP-scale Variant work.

Selection toolbar example:

```text
8 selected     [Activate] [Deactivate] [Edit…] [More ▾]
```

Bulk editor should operate only on fields whose semantics are safe for bulk changes. Never expose inventory quantity, average cost, historical identity or protected accounting fields as generic bulk overwrite controls.

Future price bulk actions must remain UOM-aware and respect minimum-price/permission rules.

## 14. Mobile information architecture

Mobile uses progressive steps/sections, not a squeezed desktop grid.

Product create/edit top:

```text
‹ Products                 Save
New Product

[Basic information]
[Images]
[Selling & units]
[Inventory]
[Options & variants]
[Online store]
[Advanced]
```

Sections may be cards/accordions or dedicated subviews depending on current Product form architecture, but controls must remain full-width/touch-friendly and preserve unsaved state.

Primary save action should remain easy to reach; destructive actions are not placed adjacent to it.

## 15. Mobile Option builder

```text
Options & variants

Color
Black   White   Blue
[+ Add value]

Size
S   M   L   XL
[+ Add value]

12 possible combinations
[Review combinations]
```

Adding/editing an Option may use a bottom sheet with full-width inputs and touch targets consistent with AWJ mobile patterns.

## 16. Mobile combination review

Do not use a wide table.

```text
Review combinations
10 of 12 selected

[Search combinations]
[Color ▾] [Size ▾]

☑ Black / S
   New

☑ Black / M
   New

☐ Black / XL
   Not selected

────────────────────────
[Create 10 variants]
```

The commit action remains sticky at the bottom where platform safe-area rules require.

## 17. Mobile Variant list

```text
Variants (10)
[Search]
[Color ▾] [Size ▾] [Status ▾]

Black / S                 ›
SH-BLK-S              Active

Black / M                 ›
SH-BLK-M              Active
```

Tapping a row opens the Variant editor as a full-height sheet/detail screen. Do not expose every future inventory/price/media field in the list itself.

Multi-select mode may be entered explicitly for bulk actions rather than showing checkboxes permanently on a small screen.

## 18. Validation and safety UX

Validation should be local first and summarized when Save fails.

Examples:
- duplicate SKU: identify the conflicting catalog identity without exposing another tenant;
- duplicate combination: “Black / XL already exists.”;
- cross-product/tenant reference failures are generic safe errors and never leak foreign entity details;
- unsafe Simple → Variant conversion: show actionable blockers such as existing stock/reservations rather than a generic failure;
- deleting an Option Value used by Variants: show affected Variant count and offer safe deactivation/edit path when allowed.

Server remains authoritative for every invariant.

## 19. Permissions

UI visibility/action availability must follow backend permissions. Hiding a field is not authorization.

In particular:
- cost/average-cost information remains protected by existing cost-view permission semantics;
- Product/Variant lifecycle actions require their approved management permission;
- Commerce publication remains under Commerce permission/boundary;
- pricing actions must not grant price/min-price override authority implicitly.

## 20. Accessibility and interaction quality

- keyboard traversal on desktop must follow visual order;
- Option value chips/tags need accessible names and remove actions;
- focus returns predictably after add/remove actions;
- status is never conveyed by color alone;
- tables support horizontal overflow only when necessary, without clipping controls;
- mobile targets follow AWJ touch sizing conventions;
- dialogs/sheets trap and restore focus correctly;
- RTL/LTR icons and directional controls mirror appropriately.

## 21. Empty, loading and error states

Do not use decorative empty-state illustrations in this daily ERP surface.

Prefer concise operational copy:

- No variants yet → “Add options such as color or size to create variants.”
- Filter returned none → “No variants match these filters.” + Reset filters.
- Save conflict → preserve user input and identify the row/field requiring correction.
- Partial bulk failure → do not claim full success; report succeeded/failed counts and preserve actionable failures.

## 22. Implementation slicing

UI implementation should follow backend authority:

1. `VAR-CORE-1`: Option builder, combination review, core Variant table/detail, lifecycle-safe state changes.
2. `VAR-INV-1`: stock/availability projections and inventory-specific actions.
3. `VAR-PRICE-1`: UOM/barcode/base price and price-list-aware surfaces.
4. `VAR-MEDIA-1`: Product/Option Value/Variant image mapping and cover UX.
5. `VAR-POS-1`: POS-specific selector/scanner UX.
6. `VAR-COM-1`: storefront selection/publication UX.

This prevents a visually complete but semantically fake UI.

## 23. Acceptance criteria

The final Product + Variant UI is acceptable only when:

- simple Product creation remains fast and uncluttered;
- Variant creation is understandable without training;
- proposed combinations are reviewed before persistence;
- desktop supports efficient management of many Variants through a dense table;
- mobile has a native touch workflow rather than a shrunken table;
- bulk actions are available without weakening lifecycle/accounting/inventory rules;
- no UI field invents price, stock, cost or publication authority;
- Arabic RTL and English LTR are first-class;
- permissions and Tenant Isolation fail closed server-side;
- visual language remains consistent with AWJ design system.

## 24. Decision

This specification is the UI/UX authority for Product Variant integration unless superseded by a later approved design decision. Implementation should preserve the information architecture and safety boundaries while allowing component-level refinement during visual QA.
