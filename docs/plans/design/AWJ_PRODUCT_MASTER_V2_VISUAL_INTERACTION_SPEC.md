# AWJ Product Master V2 — Visual & Interaction Specification

Status: Design specification / operational proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Product Master V2 is the operational/inventory proving case for Master Record Pattern V2. Product type changes both data and available operations.

Primary questions:
- Is this an Item (`good`) or Service (`service`)?
- How is it identified/scanned/sold/purchased?
- What fields and actions actually apply to this type?
- What is its current inventory state when inventory applies?
- What commercial/cost values may this user see?

## 2. Evidence hierarchy

Visual implementation and generated references SHALL follow:

`Actual AWJ contracts/code → approved Master Record V2 decisions → this Screen Contract → generated visual reference`

Images validate this contract only. They cannot add fields, stock metrics, charts, tabs, warehouses, price tiers, actions or accounting settings merely to make the screen look complete.

## 3. Current AWJ contract verified

`StoreProductRequest` currently supports:
- name / English name;
- SKU with catalog/branch-sharing uniqueness semantics;
- barcode with institution-wide unified barcode identity protection;
- type `good|service`;
- unit, unit template, default sales/purchase unit;
- description;
- category/category ID and brand/brand ID;
- reorder level;
- supplier ID;
- sales account and COGS account;
- minimum sale price;
- discount + percent/amount type;
- profit margin;
- tags/internal notes;
- sale price and purchase price in integer minor units;
- tax rate;
- track inventory;
- initial quantity as an action concept, not a stored mutable quantity field;
- active state.

The existing Product Profile already provides a substantial Master Workspace: identity/SKU/status, Edit/overflow, product media, units/alternate barcodes, stock/average-cost/sale-price summaries, inventory movements, timeline/activity and explicit inventory actions such as transfer, receipt/add inventory operation and issue. Product copy resets opening quantity instead of copying stock.

These are the baseline facts. A mockup must not silently expand them.

## 4. Reference research boundary

Daftra was reviewed only as product/UX reference. It supports the principle that Product and Service share core commercial identity but diverge on inventory behavior. AWJ adopts that dynamic-type principle, not Daftra-specific fields.

For example, service duration is not part of AWJ V2 baseline unless an actual AWJ booking/service workflow later requires it.

## 5. Screen Contract A — Add / Edit Product

### 5.1 Purpose and shape

Create/edit ordinary Product Master properties. It is one responsive Master Record workspace, not a wizard.

No Stepper is used for form sections.

Canonical desktop order:

`Page Identity / Actions → Type → Identity & Media → Catalog → Units & Barcodes → Commercial & Tax → Type-specific Operations/Configuration → Accounting → Notes/Status → Save`

Sections may be compacted/reordered for density, but the semantic boundary is preserved.

### 5.2 Type selector

Show early:

`صنف (Item) | خدمة (Service)`

Type changes fields **and operational affordances**.

Changing an existing record's type is not assumed to be unrestricted. Existing inventory movements, valuation/history, document references and accounting effects may require lifecycle guards. UI must not promise casual `good ↔ service` conversion before implementation rules are verified.

### 5.3 Shared actual fields

Subject to permission/context, both types may use actual supported fields:
- Arabic/display name and English name;
- SKU;
- barcode;
- description;
- category;
- brand;
- unit / unit template;
- default sales unit;
- default purchase unit;
- sale price;
- purchase price/cost only when semantically appropriate and authorized;
- minimum sale price;
- default discount + type;
- profit margin when permission-safe;
- tax rate;
- sales account;
- tags/internal notes;
- active state;
- media where supported.

Do not invent model/subcategory/default warehouse/tax-inclusive mode/multiple price tiers/inventory account or similar fields unless separately verified in AWJ.

### 5.4 Item-specific fields

For Item (`good`), expose inventory configuration only according to actual semantics:
- track inventory;
- reorder level when inventory tracking applies;
- supplier relationship where supported;
- COGS account where semantically applicable.

`initial_quantity` is not an ordinary forever-editable Product property. It is an opening-stock/initialization action and must be treated as consequential inventory behavior.

Do not provide a generic editable Quantity on Hand field.

### 5.5 Service-specific composition

Service omits inventory-only concepts entirely:
- no Track Inventory control if Service cannot inventory-track by domain rule;
- no reorder level;
- no opening quantity/opening stock;
- no stock warehouse selector invented for symmetry;
- no COGS/inventory configuration unless the actual accounting model explicitly supports a meaningful Service use;
- no receipt/issue/transfer configuration.

Service retains meaningful units, barcode, pricing, tax, sales account, media, notes and commercial identity where supported.

Irrelevant inventory fields are omitted, not disabled or shown as N/A.

### 5.6 SKU / barcode safety

Visuals must respect that SKU and barcode are not casual labels:
- SKU uniqueness depends on catalog sharing/branch scope;
- barcode is protected institution-wide through the unified barcode registry and historical identity.

Do not imply a barcode can be freely recycled from inactive/soft-deleted products.

### 5.7 Money and cost

Prices are stored in minor units. UI formatting/parsing must preserve AWJ money precision.

Purchase price, average cost, profit/margin and derived sensitive values must follow centralized cost permissions including `products.view_cost` where applicable. Hiding one cost field while leaking the same value through a summary or calculation is forbidden.

### 5.8 Quick Create/Edit

Quick Product Create/Edit remains available from transactional contexts such as invoice, purchase and quotation.

It:
- asks Item/Service early;
- captures only minimum identity/commercial data required to continue;
- dynamically omits inapplicable Service inventory fields;
- does not expose inventory history or stock operations;
- does not mutate Quantity on Hand as a normal property.

### 5.9 Create/Edit actions

Keep actions small:
- Save;
- Cancel/back as appropriate.

Do not invent posting, stock approval or workflow Stepper actions.

## 6. Screen Contract B — Full Product Profile

### 6.1 Canonical anatomy

`Identity Header → Contextual Command Bar → Compact Operational Summary → Section Navigation → Active Operational Content`

The profile is an operational workspace, not a disabled Product form.

### 6.2 Identity Header

Show:
- primary image/fallback;
- name;
- SKU/code;
- Item/Service badge;
- active/inactive state;
- category/brand as restrained secondary identity when useful.

Product may have multiple media images; this intentionally differs from the single identity photo/logo of Customer/Supplier.

### 6.3 Contextual actions

Shared actual/candidate actions grounded in current profile:
- Edit;
- Copy;
- delete/deactivate according to lifecycle rules;
- overflow for secondary actions.

Inventory-tracked Item may expose authorized explicit operations already represented by the current profile:
- Transfer stock;
- Receive/add inventory operation;
- Issue stock.

Service never receives those actions.

### 6.4 Item profile — inventory tracked

May show only verified/authoritative operational facts:
- Quantity on Hand;
- Average Cost when authorized;
- Sale Price;
- reorder context where meaningful;
- inventory movements;
- media/units/barcodes;
- timeline/activity;
- authorized receipt/issue/transfer actions.

Do not invent Pending Receipt, Pending Issue, Available for Sale, Inventory Value, warehouse breakdowns or charts unless actual AWJ endpoints/contracts are deliberately verified for them.

### 6.5 Item profile — not inventory tracked

Follow actual tracking semantics. Do not pretend a non-tracked Item has normal stock history merely because it is `good`.

Inventory-only summary/sections/actions that have no truthful meaning are omitted.

### 6.6 Service profile

Service is a full Master Workspace but non-inventory:
- identity/media;
- Service badge/status;
- sale price;
- relevant unit/barcode/tax/commercial context;
- purchase/cost information only when semantically supported and authorized;
- timeline/activity.

Omit entirely:
- Quantity on Hand;
- Average Inventory Cost;
- reorder presentation;
- Inventory Movements section/tab;
- Receive / Issue / Transfer commands;
- opening stock.

Do not show zero/disabled/N/A placeholders. Truthful absence is the rule.

### 6.7 Profile invariant

`type` controls both **record fields and operational affordances**.

A Service must never look like an Item with empty stock cards. An inventory-tracked Item must not lose valid inventory operations merely to share a generic profile layout.

## 7. Section Contract

Shared sections/capabilities only where useful:
- Overview / information;
- media;
- units/barcodes;
- commercial/tax/accounting details according to permissions;
- timeline;
- activity/audit.

Item-only when inventory applies:
- inventory movements;
- inventory operational context.

Do not add Sales, Purchases, Documents, Assemblies, Related Products or other tabs solely because a generated visual has room for them. Each requires actual AWJ capability verification before becoming part of the contract.

## 8. Consequential inventory rule

Stock quantity is not a normal mutable Product property.

Opening quantity is initialization/action behavior. Subsequent changes flow through inventory movements/permits and preserve authorization, branch/tenant isolation, valuation and accounting rules.

Service has no opening-stock concept.

## 9. Mobile Screen Contract

Mobile uses the same information model, recomposed:
1. image/name/type/status;
2. compact applicable authoritative summary;
3. primary action + overflow;
4. section content;
5. secondary information/activity.

For Item, movements use responsive record/table behavior. Service contains no empty inventory section.

No persistent global bottom navigation is introduced by Master Record Pattern.

## 10. Arabic RTL / English LTR

Verify deliberately:
- Item/Service terminology;
- SKU/barcode direction;
- money/quantity/unit combinations;
- Arabic/English names;
- action ordering and sections;
- long unit names/conversion factors;
- dynamic appearance/disappearance;
- desktop/laptop/tablet/mobile.

## 11. Visual Reference Gate

Before generating/approving Product imagery verify:
- no wizard/form Stepper;
- only actual verified fields;
- Item/Service selector is behavioral;
- Service has no inventory-only fields/cards/tabs/actions;
- non-tracked Item does not fake inventory history;
- no editable Quantity on Hand;
- opening stock is not a normal mutable field;
- no invented warehouses, price tiers, charts, pending stock KPIs or tabs;
- cost data is permission-safe;
- profile is operational, not a disabled form;
- no global mobile bottom navigation;
- RTL/LTR, SKU/barcode, money and units remain correct.

Any visual violating this gate is concept-only and cannot become implementation documentation.

## 12. Known implementation work intentionally deferred

- final Item/Service create/edit UI;
- type-change lifecycle guards;
- visual refactor of current Product Profile;
- responsive refinements;
- product lifecycle/deletion changes;
- inventory valuation/stock permit/branch/tenant/accounting-routing changes;
- cost-permission changes;
- future Service-only fields until an actual workflow requires them.

## 13. Acceptance

Product Master V2 is visually ready only when Add/Edit and Full Profile can be rendered from this contract without inventing business behavior, with truthful Item/Service recomposition, explicit inventory operations, permission-safe cost data, responsive behavior and Arabic/English parity.
