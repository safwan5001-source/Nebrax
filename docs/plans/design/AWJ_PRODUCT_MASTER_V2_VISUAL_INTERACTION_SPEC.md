# AWJ Product Master V2 — Visual & Interaction Specification

Status: Design specification / operational proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Product Master V2 is the operational/inventory proving case for Master Record Pattern V2. It must make product/service identity, commercial data and inventory state easy to understand without turning inventory movements into editable product properties.

Primary questions:
- Is this an Item (`good`) or Service (`service`)?
- How is it identified/scanned/sold/purchased?
- What fields and actions actually apply to this type?
- What is its current inventory state when inventory applies?
- What are its authoritative commercial/cost values subject to permissions?

## 2. Current AWJ baseline

The existing Product Profile already implements a substantial Master Workspace: product identity and SKU, active state, Edit and overflow actions, stock/average-cost/sale-price summary, information, inventory movements, timeline/activity, product media, units and alternate barcodes.

It also already separates inventory actions into explicit operations: transfer, receipt/add inventory operation and issue. Product copy resets opening quantity instead of copying current stock.

AWJ backend already models `type = good | service`; V2 must make that distinction behavioral rather than merely displaying a badge.

## 3. Daftra reference — Item versus Service

Official Daftra documentation was reviewed as a product/UX reference, not as an AWJ or ZATCA source of truth.

Daftra explicitly starts creation as either “new product” or “new service”. The two share much of the core record, but type-specific fields differ. Shared examples include name, SKU, classification, brand, unit template, barcode, purchase/sale pricing, taxes, notes/tags/status. Daftra also documents unit templates for both products and services, including service-like units such as hour/session.

Daftra product-only behavior includes inventory-management data such as low-stock notification and inventory quantity/unit behavior. Its saved product view exposes stock information, stock movements and stock operations.

Daftra service-only behavior includes a service-duration field in minutes for its booking use case.

AWJ conclusion: adopt the **dynamic type principle**, not Daftra-specific fields blindly. In particular, AWJ must not add service duration until an actual AWJ booking/service workflow requires it.

Reference pages:
- Daftra: “إضافة منتج جديد أو خدمة جديدة”.
- Daftra: “ربط قالب وحدة القياس بالمنتج”.
- Daftra: “باركود المنتج/ الخدمة”.

## 4. Item / Service type contract

At create time, the user chooses one clear type:

`صنف (Item) | خدمة (Service)`

This choice changes the information architecture, validation and available actions.

### Shared fields/capabilities
Subject to actual AWJ support:
- name / English name;
- SKU/code;
- category;
- brand where meaningful;
- description;
- unit and unit template;
- default sales/purchase unit where applicable;
- barcode where useful (do not prohibit service barcode merely because inventory is absent);
- sale price;
- purchase price/cost visibility subject to permission;
- tax rate;
- pricing rules such as minimum sale price/discount/profit margin where supported;
- tags/internal notes;
- active state;
- media where useful.

### Item (`good`)
Item exposes inventory semantics when tracking is enabled:
- inventory tracking;
- reorder level;
- quantity-on-hand summary;
- average cost subject to permission;
- inventory movements;
- receipt / issue / transfer actions;
- supplier relationship where supported;
- inventory/accounting configuration where applicable.

### Service (`service`)
Service must not expose inventory-only concepts:
- no quantity-on-hand summary;
- no reorder level;
- no stock movement tab;
- no receipt / issue / transfer stock actions;
- no opening stock action;
- no misleading average inventory cost metric.

Service retains valid non-inventory capabilities such as units, pricing, tax and barcode when supported by the actual business workflow.

Service-specific attributes are added only when an AWJ module genuinely consumes them. A generic “duration in minutes” field is therefore not part of V2 baseline merely because Daftra uses one for bookings.

## 5. Type-change safety

Create-time type selection is straightforward. Changing an existing record between Item and Service is not an ordinary cosmetic edit.

Before implementation, AWJ must define lifecycle guards for type changes, especially when an Item has inventory movements, valuation/history, document references or accounting effects. V2 must not promise unrestricted `good ↔ service` conversion.

No type-change accounting/inventory behavior is invented by this design specification.

## 6. Canonical Full Product Workspace

`Identity Header → Contextual Command Bar → Compact Operational Summary → Section Navigation → Active Operational Content`

### Identity Header
- Primary image where available; restrained fallback when absent.
- Name.
- SKU/code.
- Type: Item / Service.
- Active/inactive state.
- Category/brand as secondary identity when useful.

Product media may include multiple images; this differs intentionally from the single identity photo/logo expected for Customer/Supplier.

### Contextual Command Bar
Shared candidates:
- Edit.
- Copy.
- Delete/deactivate according to lifecycle rules.
- Secondary actions in overflow.

Item-only inventory actions, when applicable and authorized:
- Transfer stock.
- Receive/add stock operation.
- Issue stock.

Service never receives fake inventory actions for visual symmetry.

## 7. Compact operational summary

### Item with inventory tracking
Prioritize:
- Quantity on hand.
- Average cost, only with cost visibility permission.
- Sale price.
- Reorder context where meaningful.

### Service
Prioritize non-inventory commercial facts such as sale price and relevant unit/tax context. Inventory metrics are omitted, not rendered as zero.

Financial/cost values must use authoritative backend values and preserve AWJ money precision/permission rules.

## 8. Information architecture

### Identity & catalog
- Names.
- SKU/code.
- Primary/alternate barcodes where applicable.
- Item/Service type.
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

Units remain available to Service where meaningful; examples can include hour/session without implying inventory stock.

### Commercial & tax
- Sale price.
- Purchase/cost-related price only for authorized users.
- Minimum sale price where supported.
- Discount/default discount behavior.
- Profit margin where supported and permission-safe.
- Tax rate.

### Inventory — Item only
- Track inventory state.
- Reorder level.
- Supplier relationship where supported.
- Inventory movements as related operational history, not editable stock fields.

### Accounting
- Sales account.
- COGS/inventory-related account only where semantically applicable.
- Accounting fields remain permission-aware and cannot rewrite historical accounting.

### Media
The current profile supports multiple images. V2 keeps media as a genuine record capability rather than decorative avatar behavior.

## 9. Consequential inventory rule

Stock quantity is not a normal mutable Item property.

Opening quantity is an initialization/action concept; subsequent quantity changes flow through inventory movements/permits and their authorization, branch/tenant and valuation rules.

V2 must never provide a generic Edit Item field that silently overwrites quantity-on-hand. Service has no opening-stock concept.

## 10. Quick Create/Edit versus Full Workspace

Quick Create/Edit remains necessary inside invoice, purchase, quotation and other transactional contexts.

The type choice appears early and dynamically controls applicable fields. Quick Create captures only the minimum valid Item/Service identity and commercial configuration required to continue the transaction.

It must not expose full inventory history or consequential stock operations.

## 11. Section model

Shared:
- Overview / information.
- Media/units/barcodes as appropriate to density.
- Timeline.
- Activity/audit.

Item-only when inventory applies:
- Inventory movements.
- Inventory operational context.

Do not create empty Service tabs to force symmetry with Item.

## 12. Responsive behavior

Desktop/laptop: dense summary + sections + information grid; media and structured data may use a balanced two-column region.

Mobile:
- image/name/type/status first;
- compact applicable metrics;
- primary action + overflow;
- vertically recomposed information;
- units/barcodes remain readable;
- Item inventory movements use responsive record/table behavior.

No global mobile bottom navigation is introduced by this pattern.

## 13. Arabic RTL / English LTR

Verify deliberately:
- Item / Service terminology;
- SKU/barcode direction;
- money/quantity/unit combinations;
- Arabic and English names;
- action ordering and sections;
- long unit names and conversion factors;
- dynamic field appearance/disappearance;
- desktop/laptop/tablet/mobile.

## 14. Cost and security visibility

Average cost, purchase price and other sensitive cost/profit information must respect the existing centralized permission model (including `products.view_cost` where applicable).

V2 defines graceful absence/redaction states instead of leaking cost through summaries, derived values, exports or secondary sections.

## 15. Master Record pattern validation

Product proves that Master Record V2 is not limited to business parties and that a master-record subtype can change behavior without becoming a separate generic form clone.

Shared grammar with Customer/Supplier remains identity header, contextual actions, compact summary, organized details/relations, activity/audit, Quick Create + Full Workspace, consequential-action separation, responsive and bilingual behavior.

Product-specific semantics remain Item/Service type, multi-image media, SKU/barcodes/units, Item inventory state/actions, and cost visibility permissions.

## 16. Known implementation work intentionally deferred

- Final Item/Service create/edit UI.
- Type-change lifecycle guards.
- Visual refactor of current Product Profile.
- Responsive refinements.
- Any product lifecycle/deletion changes.
- Any inventory valuation, stock permit, branch/tenant or accounting-routing changes.
- Any cost-permission changes.
- Any future Service-only fields such as duration until an actual AWJ workflow requires them.

These require separately scoped implementation PRs and appropriate tests; none belong to this documentation checkpoint.
