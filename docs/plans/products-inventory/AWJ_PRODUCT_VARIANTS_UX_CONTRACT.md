# AWJ Product Variants — UI/UX Contract

**Status:** UX architecture / documentation only — implementation is NOT authorized  
**Date:** 2026-09-14  
**Depends on:** `AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md`, `AWJ_PRODUCT_VARIANTS_VAR_CORE_1_PLAN.md`  
**References reviewed:** Microsoft Dynamics 365 product dimensions / variant suggestions; Shopify product variants / bulk editor. Daftra item-group behavior remains a domain reference from the compatibility audit.  
**Scope:** desktop + mobile creation/editing experience for Product Options and Variants. Inventory/pricing/media persistence remains owned by their scoped implementation PRs.

## 1. UX principles

AWJ is a daily ERP/accounting tool. Variant UX prioritizes clarity, density, speed, trust, keyboard/touch efficiency and predictable bulk operations over decorative cards.

The table is the hero on desktop. Mobile uses progressive disclosure rather than shrinking a wide desktop grid.

The UI must distinguish three concepts visually and linguistically:
- Product = shared parent/family;
- Option/Value = dimensions such as Color=Black and Size=XL;
- Variant = one concrete combination such as Black / XL.

UOM (piece/pack/dozen) must never be presented as a Variant option.

## 2. Reference patterns adopted

### Microsoft Dynamics pattern

Dynamics defines variants from combinations of product dimension values and provides **Variant suggestions**: users choose values, request suggestions, review the resulting combinations, select the combinations they actually support, then create them. AWJ adopts the idea of a reviewable suggestion stage rather than silently persisting every Cartesian combination.

### Shopify pattern

Shopify keeps Options/Values close to the Product details page, lists Variants on the Product page, supports individual editing and checkbox-driven bulk editing, and provides a dedicated bulk editor for many variants. AWJ adopts the inline Options section + dense Variant table + explicit bulk actions pattern.

### AWJ adaptation

AWJ does not copy either product literally. It combines:
1. simple inline Option creation;
2. automatic combination preview;
3. explicit selection of supported combinations;
4. dense spreadsheet-like editing for operational fields;
5. safe lifecycle warnings where changing Options affects existing Variants.

## 3. Product create/edit information architecture

Recommended sections in the Product workspace:

1. Basic information
2. Classification / category / brand
3. **Options & Variants**
4. Units & Barcodes
5. Pricing
6. Inventory
7. Images
8. Online Store / publication
9. Accounting / advanced fields as applicable

Sections may be tabs, grouped panels or the existing AWJ Product form pattern; `VAR-CORE-1` must not redesign unrelated Product UI.

## 4. Options editor

The user enables Variants through an explicit action such as **Add options / إضافة خيارات**, not an unexplained boolean switch.

Each Option row contains:
- option name, e.g. Color;
- ordered values represented as compact editable chips/tokens, e.g. Black, White, Blue;
- drag/reorder affordance where supported;
- edit/remove action;
- validation/error state.

Example:

```text
اللون   [أسود ×] [أبيض ×] [أزرق ×]   + إضافة قيمة
المقاس  [S ×] [M ×] [L ×] [XL ×]     + إضافة قيمة

+ إضافة خيار
```

The interface should show the projected combination count immediately:

```text
3 colors × 4 sizes = 12 possible combinations
```

This is an informational preview, not proof that all 12 will be created.

## 5. Variant suggestion / generation stage

AWJ should generate **suggestions**, not silently create all Cartesian combinations.

After Options/Values change, show a clear action:

**Review combinations (12) / مراجعة التركيبات (12)**

The review surface shows all possible new combinations with checkboxes. Existing Variants are visually distinguished and are not recreated.

Default behavior for a brand-new Product may preselect all suggested combinations for speed, but creation occurs only after explicit Save/Create confirmation. The user can deselect impossible/unwanted combinations before persistence.

Example:

| Select | Variant | Status |
|---|---|---|
| ✓ | Black / S | New |
| ✓ | Black / M | New |
| — | Black / XL | Not offered |
| ✓ | White / S | New |

For an existing Product, new Option Values must never silently create combinations. The user reviews/selects suggestions explicitly.

## 6. Desktop Variant table — the hero

After creation, Variants appear in a dense table.

Core `VAR-CORE-1` columns:
- selection checkbox;
- Variant display name / combination;
- SKU;
- status;
- validation indicator/actions.

Later scoped PRs may add columns such as:
- cover thumbnail;
- barcode / default UOM;
- base selling price;
- available quantity;
- online publication status.

Do not add future columns in `VAR-CORE-1` before their authorities exist.

Required table behavior:
- sticky header when useful;
- search/filter by option value, SKU and status;
- sortable relevant columns;
- row selection;
- bulk actions;
- keyboard-friendly cell navigation/editing where consistent with AWJ tables;
- horizontal scroll on constrained widths rather than destructive column wrapping;
- clear unsaved/validation states.

## 7. Bulk editing

Bulk editing is mandatory UX for products with many Variants.

Core actions may include:
- activate/deactivate selected Variants;
- controlled SKU generation/assignment if approved by the SKU contract.

Later PRs add scoped bulk actions for price, publication, images or other attributes.

Bulk operations must always state scope, for example:

```text
8 variants selected
[Activate] [Deactivate] [More]
```

Never apply a parent-row edit to all children implicitly without making the scope visible.

## 8. Individual Variant detail

Clicking/tapping a Variant opens a focused detail surface rather than expanding every possible field inside the main Product form.

Desktop may use a side sheet or dedicated detail route according to existing AWJ form patterns. Mobile should use a full-screen detail view/sheet.

Header example:

```text
قميص كلاسيك
أسود / XL
SKU: SHIRT-BLK-XL
```

Shared Product metadata remains clearly identified as inherited/shared; Variant-specific data is separately labeled.

## 9. Editing Options after Variants exist

This is a high-risk UX and must be explicit.

### Adding a value

Adding `Green` to Color does not automatically create Green × every Size. Show new suggestions and let the user select which combinations to create.

### Renaming a value

Renaming a display value does not create a new Variant identity. Warn only when the change affects customer-facing display/search, not as if inventory were being migrated.

### Removing/deactivating a value

If the value is unused, deletion may be available according to lifecycle rules.

If it participates in existing/protected Variants, destructive deletion is unavailable. Offer deactivation or management of affected Variants, with an affected-count message.

Example:

```text
"أسود" مستخدم في 4 متغيرات.
لا يمكن حذفه لأنه جزء من هويات قائمة.
يمكنك تعطيله بعد مراجعة المتغيرات المتأثرة.
```

No cascade-delete UX.

## 10. Simple -> Variant-managed conversion UX

The entry action must communicate that this changes the Product's sellable/inventory identity.

For a Product with no blocking operational footprint, the user can enter the Options workflow and confirm conversion.

For a Product with stock/inventory-semantic state, `VAR-CORE-1` blocks conversion and explains why; it does not offer a fake automatic distribution.

Example:

```text
لا يمكن تحويل هذا المنتج إلى منتج متعدد الخيارات الآن.
يوجد رصيد مخزني قائم يحتاج إلى توزيع صريح على المتغيرات.
سيتم دعم هذا المسار من خلال عملية تحويل مخزون مخصصة.
```

Do not show a generic "Something went wrong" error.

When `VAR-INV-1` later provides a migration workflow, this UX can become a guided allocation step while preserving the same invariant.

## 11. Mobile UX

Mobile must not be a squeezed desktop table.

Recommended flow:

1. Product details
2. Options card/section
3. `12 variants` summary row
4. tap to open Variant list
5. compact searchable/filterable list
6. tap Variant -> full-screen Variant detail
7. multi-select mode for bulk actions

Variant list row example:

```text
Black / XL
SHIRT-BLK-XL                Active
```

Use chips for option filters such as `Black`, `XL`, `Active`. Keep primary actions reachable without horizontal scrolling.

For combination review on mobile, use a full-screen selection list with a sticky bottom action:

```text
10 of 12 selected
[Create selected variants]
```

## 12. Large-combination safety

The UI must calculate and display the potential Cartesian count before generating/rendering a huge set.

Do not adopt an arbitrary Shopify/Dynamics platform limit as an AWJ business rule without capacity evidence. Instead, implementation must define tested server/UI limits or pagination/virtualization strategy based on AWJ performance.

For unusually large combinations, show a warning and require review rather than freezing the page or creating thousands of records accidentally.

## 13. Bilingual / RTL-LTR

Arabic is primary and English is supported using the same AWJ localization policy.

- RTL for Arabic, LTR for English;
- option/value names must render correctly in either direction;
- SKU/barcode remain visually stable and copyable;
- Variant display-name composition must use a centralized formatter, not client-specific string concatenation;
- snapshots preserve the transaction-time display semantics defined by `VAR-ARCH-1`.

## 14. Accessibility and operational quality

- checkbox/radio controls have labels and touch targets;
- keyboard focus is visible;
- validation is not color-only;
- status is text + semantic indicator;
- destructive actions require clear confirmation when allowed;
- loading/saving states prevent accidental duplicate submissions;
- table/list remains usable at browser zoom and on narrow mobile widths.

## 15. UX acceptance criteria

Before Product Variant UI is considered complete:

1. user can add Options/Values without leaving Product workflow;
2. potential combination count is visible;
3. combinations are reviewed before creation;
4. unwanted combinations can be excluded;
5. duplicate combinations cannot be created through UI or API;
6. existing Variants are manageable through a dense desktop table;
7. multi-select/bulk operations exist;
8. mobile has a dedicated list/detail flow rather than a squeezed table;
9. changing Options with existing Variants shows affected-state guidance;
10. unsafe Simple -> Variant conversion produces a specific actionable explanation;
11. Arabic/English and RTL/LTR are verified;
12. UI never conflates Variant with UOM;
13. UI never invents price from UOM factor;
14. no destructive lifecycle action bypasses backend guards.

## 16. Decision

AWJ adopts a **suggest → review → create → bulk manage** Variant workflow.

The key adaptation is deliberate: Dynamics contributes the reviewable Variant Suggestions concept; Shopify contributes accessible inline Options and bulk variant management; AWJ keeps its own dense ERP table-first design, strict lifecycle/inventory guards, bilingual RTL/LTR behavior, and mobile-first progressive disclosure.

This UX contract should guide `VAR-CORE-1` and later scoped Variant PRs without expanding their domain responsibilities.
