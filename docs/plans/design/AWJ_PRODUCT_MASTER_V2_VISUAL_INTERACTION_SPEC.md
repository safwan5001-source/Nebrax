# AWJ Product Master V2 — Visual & Interaction Specification

Status: Design specification / operational proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Product Master V2 is the operational/inventory proving case for Master Record Pattern V2. It must make product identity, commercial data and inventory state easy to understand without turning inventory movements into editable product properties.

Primary questions:
- What product/service is this?
- How is it identified/scanned/sold/purchased?
- What is its current inventory state when inventory tracking applies?
- What are its authoritative commercial/cost values subject to permissions?
- What inventory action can the authorized user perform next?

## 2. Current AWJ baseline

The existing Product Profile already implements a substantial Master Workspace: product identity and SKU, active state, Edit and overflow actions, stock/average-cost/sale-price summary, information, inventory movements, timeline/activity, product media, units and alternate barcodes.

It also already separates inventory actions into explicit operations: transfer, receipt/add inventory operation and issue. Product copy resets opening quantity instead of copying current stock.

V2 should refine this existing capability rather than replace it with an unrelated page model.

## 3. Canonical Full Product Workspace

`Identity Header → Contextual Command Bar → Compact Operational Summary → Section Navigation → Active Operational Content`

### Identity Header
- Primary product image where available; restrained fallback when absent.
- Product name.
- SKU.
- Product type: good/service where useful.
- Active/inactive state.
- Category/brand as secondary identity when useful.

Product media may include multiple images; this differs intentionally from the single identity photo/logo expected for Customer/Supplier.

### Contextual Command Bar
Candidate actions based on actual support/permissions:
- Edit product.
- Transfer stock.
- Receive/add stock operation.
- Issue stock.
- Copy product.
- Delete/deactivate according to lifecycle rules.
- Secondary actions in overflow.

Inventory-impacting actions must remain visually distinct from ordinary profile editing.

## 4. Compact operational summary

For inventory-tracked goods, prioritize:
- Quantity on hand.
- Average cost, only when user has cost visibility permission.
- Sale price.
- Reorder context where supported and meaningful.

For services/non-inventory products, inventory metrics should be absent or clearly not applicable rather than displaying misleading zeroes.

Financial/cost values must use authoritative backend values and preserve AWJ money precision/permission rules.

## 5. Information architecture

### Identity & catalog
- Arabic/primary name and English name where supported.
- SKU.
- Primary barcode.
- Alternate barcodes.
- Product type.
- Category.
- Brand.
- Description.
- Tags/internal notes where permitted.

### Units
- Base unit.
- Unit template/conversions.
- Default sales unit.
- Default purchase unit.
- Barcode-to-unit relationships where supported.

### Commercial & tax
- Sale price.
- Purchase/cost-related price only for authorized users.
- Minimum sale price where supported.
- Discount/default discount behavior.
- Profit margin where supported and permission-safe.
- Tax rate.

### Inventory
- Track inventory state.
- Reorder level.
- Supplier relationship where supported.
- Inventory movements as related operational history, not editable stock fields.

### Accounting
- Sales account.
- COGS account where applicable.
- Accounting fields must remain permission-aware and must not be casually changed in a way that rewrites historical accounting.

### Media
The current product profile supports multiple images. V2 keeps media as a genuine product capability rather than treating it as decorative avatar behavior.

## 6. Consequential inventory rule

Stock quantity is not a normal mutable Product property.

Opening quantity is an initialization/action concept; subsequent quantity changes must flow through inventory movements/permits and their existing authorization, branch/tenant and valuation rules.

Therefore V2 must never provide a generic Edit Product form field that silently overwrites quantity-on-hand.

This is the Product equivalent of the Master Record principle used for Customer/Supplier opening balances.

## 7. Quick Create/Edit versus Full Workspace

Product Quick Create/Edit remains necessary inside invoice, purchase, quotation and other transactional contexts.

Quick Create should capture the minimum valid product/service identity and commercial configuration needed to continue the transaction. It must not expose a full inventory-history workspace.

Full Product Workspace is where media, units/barcodes, inventory movements, operational actions and activity are managed.

## 8. Section model

Recommended V2 sections based on actual capabilities:
- Overview / Product information.
- Inventory movements (only where applicable).
- Units & barcodes if information density warrants a dedicated section; otherwise keep within information.
- Media within information or a dedicated area depending final layout density.
- Timeline.
- Activity / audit.

Do not create empty tabs merely to force symmetry with Customer/Supplier.

## 9. Responsive behavior

Desktop/laptop: dense summary + Tabs + information grid; media and structured product data may use a balanced two-column region.

Mobile:
- identity/image/name/status first;
- compact key metrics;
- primary action + overflow;
- vertically recomposed product information;
- units/barcodes remain readable;
- inventory movements use responsive record/table behavior rather than a blindly shrunken desktop table.

No global mobile bottom navigation is introduced by this pattern.

## 10. Arabic RTL / English LTR

Verify deliberately:
- SKU/barcode direction remains readable and scan-friendly.
- money/quantity/unit combinations.
- Arabic and English names.
- mixed-direction category/brand/reference values.
- action ordering and Tabs.
- long unit names and conversion factors.
- desktop/laptop/tablet/mobile.

## 11. Cost and security visibility

Average cost, purchase price and other sensitive cost/profit information must respect the existing centralized permission model (including `products.view_cost` where applicable).

The V2 design must define graceful absence/redaction states instead of leaking cost through summary cards, derived values, exports or secondary sections.

## 12. Master Record pattern validation

Product proves that Master Record V2 is not limited to business parties.

Shared grammar with Customer/Supplier:
- identity header;
- contextual actions;
- compact summary;
- organized details/relations;
- activity/audit;
- Quick Create + Full Workspace;
- consequential actions separated from properties;
- responsive and bilingual behavior.

Product-specific semantics:
- multi-image media;
- SKU/barcodes/units;
- inventory state and movements;
- stock operations;
- cost visibility permissions;
- sales/purchase/accounting configuration.

The pattern is successful only if these differences remain first-class rather than being flattened into a generic form template.

## 13. Known implementation work intentionally deferred

- Visual refactor of the current Product Profile to the final V2 hierarchy.
- Responsive mobile refinements.
- Any changes to product lifecycle/deletion guards.
- Any changes to inventory valuation, stock permits, branch/tenant rules or accounting routing.
- Any changes to cost permissions.

Those require separately scoped implementation PRs and appropriate tests; none belong to this documentation checkpoint.
