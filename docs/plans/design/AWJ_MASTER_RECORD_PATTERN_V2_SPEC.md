# AWJ Master Record Pattern V2 — Specification

Status: Design-system specification. Documentation only; no production/API/DB/accounting changes.

## 1. Purpose

Master Record V2 defines the reusable ERP grammar for long-lived business entities such as Customer, Supplier and Product. It is distinct from Document Workspace: a master record persists and participates in many transactions; it is not itself a transactional document with posting lifecycle.

Canonical architecture:
`Master Record → Approved Pattern → Shared Components → Design Tokens`

The pattern preserves ERP density, speed, permission awareness, tenant/branch rules, accounting integrity, Arabic RTL and English LTR.

## 2. Two interaction surfaces

### Quick Create / Edit
Used inside transactional work such as invoice, purchase, quotation or purchase-order entry. It captures the minimum valid record/change needed without abandoning the transaction. It must not become a miniature full profile and must not expose consequential financial/inventory operations.

### Full Master Workspace
Used to manage the entity after creation:
`Identity Header → Contextual Command Bar → Compact Key Summary → Section Navigation → Active Operational Content`

The grammar is shared; semantics are record-specific. Customer uses receivables context, Supplier uses payables/procurement context, and Product uses commercial/inventory context where applicable.

Desktop/laptop may use dense Tabs. Mobile recomposes the same logical information with compact navigation/Accordion where appropriate. Full View is an operational workspace, not a disabled edit form.

Master Record does not inherit the Document Workspace Stepper. A Stepper appears only if a real verified multi-stage master workflow exists.

## 3. Property versus consequential action

> Identity and operational attributes may be edited as record properties. Financial, inventory, or other consequential events must be explicit actions/workflows, not disguised as ordinary form fields.

Examples:
- Product opening stock is an inventory event, not an editable quantity field.
- Customer/Supplier opening balance is an accounting event, not a profile property.
- Stock receipt/issue/transfer remain inventory actions.
- Customer receipts and Supplier outgoing payments remain authorized financial operations.

Consequential actions preserve actual authorization, audit, tenant/branch, accounting and inventory rules.

## 4. Customer and Supplier domain decision

V2 presents **Customer** and **Supplier** as separate user-facing master experiences. It SHALL NOT expose `customer / supplier / both` (عميل / مورد / كلاهما).

Current internal `Partner` reuse does not dictate V2 UX. Backend/API/schema implications are inspected separately during implementation. Experimental/demo records are not a reason to preserve obsolete `both` UX; architecture, accounting integrity, tenant isolation and genuine external compatibility remain protected.

Two distinct axes:
1. Business role: Customer vs Supplier.
2. Entity type: Individual vs Commercial.

Sales-context Quick Create creates a Customer without asking Supplier/Both. Procurement-context Quick Create creates a Supplier without asking Customer/Both.

## 5. Entity type — Individual versus Commercial

`Individual / Commercial` changes labels, visible fields and validation behavior; it is not decorative.

**Individual:** natural person. Candidate presentation: full name, profile photo, approved applicable personal identifier, contact and address. Gender/birth date only if approved as genuine AWJ requirements.

**Commercial:** company/establishment/business entity. Candidate presentation: trade/business name, organization logo, approved commercial identifier/CR, VAT number where applicable, representative/contact person where modeled, contact and address.

Irrelevant fields are omitted rather than rendered empty. Customer and Supplier validation matrices are verified independently; Supplier validation is not blindly copied from Customer.

Daftra was reviewed only as a product/UX benchmark for dynamic entity-type behavior. Saudi/ZATCA-sensitive requirements require authoritative verification before implementation.

## 6. Customer/Supplier profile visual

V2 supports one primary identity visual:
- Individual: profile photo.
- Commercial: organization logo.
- Absent: generated/fallback avatar based on name.

It belongs prominently in the Full Master Workspace header, not automatically in every dense table/selector.

Current Partner contract lacks this capability, so implementation requires explicit backend/storage/API/UI scope with tenant isolation, authorization, upload validation and cleanup.

Product media is intentionally different: Product may have multiple product images rather than one party identity image/logo.

## 7. Customer Master semantics

Customer Master is a sales/receivables workspace. Subject to actual support/permissions it may include identity/contact/address, Customer classification, price list, credit period/limit/status, authoritative receivables summary, Sales invoices, received payments, statement/ledger, quotations, applicable returns/credit notes, timeline/activity/audit, and contextual sales/receipt/statement actions.

Opening balance remains an explicit accounting-sensitive operation. Financial values come from authoritative backend/accounting outputs; V2 invents no alternative accounting calculations.

## 8. Supplier Master semantics

Supplier Master is a procurement/payables workspace, not a renamed Customer screen. Subject to actual support/permissions it may include identity/contact/address, Supplier classification and verified procurement settings, authoritative payables summary, Purchase invoices, outgoing payments, statement/ledger, Purchase Orders where supported, purchase returns/supplier credits, timeline/activity/audit, and contextual procurement/payment/statement actions.

Customer-only Sales/Quotation/receivables semantics must not leak into Supplier Master. Do not invent Supplier credit/payment-term settings for visual symmetry. Supplier opening balance and outgoing payments remain explicit accounting-sensitive operations.

## 9. Product Master semantics — Item versus Service

Product Master is the operational/inventory proving case. AWJ already models `type = good | service`; V2 presents this as:
`صنف (Item) | خدمة (Service)`

The choice controls Create/Edit fields, validation, saved-profile content and operational affordances — not merely a badge.

Shared capabilities where supported include identity/name, SKU/code, category/brand, description, units/templates, sales/purchase units, barcode where meaningful, pricing, tax, notes/tags, status and product media.

### Item
When inventory tracking applies, Item may expose quantity on hand, authorized average cost, reorder context, inventory movements and authorized receipt/issue/transfer actions. Stock quantity is not an editable Product property; opening stock and subsequent quantity changes flow through inventory operations.

### Service
Service is intentionally non-inventory: no quantity-on-hand or average-inventory-cost summary, reorder presentation, inventory-movements section, receipt/issue/transfer commands, or opening-stock action. These are omitted rather than shown as zero/disabled/N/A.

Service retains valid non-inventory units, pricing, tax and barcode capabilities. Service-specific fields are added only when an AWJ workflow consumes them; Daftra booking duration is not copied without a real AWJ requirement.

Changing an existing Item↔Service is not promised as unrestricted editing. Implementation must define lifecycle guards when inventory movements, valuation/history, document references or accounting effects exist.

## 10. Summary, permissions and truthful absence

Compact summaries are semantic:
- Customer: receivables.
- Supplier: payables.
- Item: inventory/commercial.
- Service: non-inventory commercial.

Sensitive information is permission-aware. Product cost/profit values must respect centralized visibility permissions and cannot leak through summaries, derived values, exports or secondary sections.

If content is semantically inapplicable, omit it rather than forcing misleading zeroes or empty tabs for symmetry.

## 11. Section navigation and responsive behavior

Customer, Supplier and Product need not have identical sections. Desktop/laptop may use dense Tabs; mobile uses responsive recomposition/Accordion or compact section navigation while preserving logical/deep-link context where supported.

Related transaction, ledger and inventory-history surfaces follow appropriate responsive DataTable/list/document behavior rather than blindly shrinking desktop tables.

No persistent global mobile bottom navigation is introduced by this pattern.

## 12. Arabic RTL / English LTR

Verify every proving case across Arabic RTL, English LTR, desktop/laptop/tablet/mobile, mirrored actions/sections, mixed-direction money/SKU/barcode/VAT/CR/IDs/phone/email/document references, long labels/names, and financial sign/number alignment.

## 13. Proving cases reconciled

1. **Customer** — business-party / receivables.
2. **Supplier** — procurement / payables; proves shared Partner internals do not force Customer UX.
3. **Product** — operational/inventory; proves Item|Service subtype behavior, media, units/barcodes, inventory actions and cost visibility fit the shared grammar.

Shared grammar:
`Identity Header → Contextual Command Bar → Compact Key Summary → Section Navigation → Active Operational Content`

Shared rules: Quick Create/Edit + Full Workspace coexist; Full View is operational; no Stepper by default; consequential actions are separate from properties; permissions/security/tenant/accounting/inventory semantics remain authoritative; inapplicable content is omitted; responsive and bilingual behavior are first-class.

## 14. Implementation gaps intentionally deferred

This checkpoint does not implement:
- Customer/Supplier profile-image storage/API/UI.
- approved Individual-specific fields or commercial representative modeling.
- `Partner.type = both` API/schema cleanup decision.
- final Customer/Supplier Individual/Commercial validation matrices including Saudi/ZATCA-sensitive rules.
- dedicated Supplier full-profile route decision.
- Supplier-specific procurement/payment settings contract.
- final Item/Service create/edit UI or type-change lifecycle guards.
- Product profile visual/responsive refactor.
- inventory valuation/lifecycle/deletion/stock-permit/branch/tenant/accounting-routing/cost-permission changes.

Each requires separately scoped implementation and appropriate tests.

## 15. Decisions locked in this checkpoint

- Customer and Supplier are separate user-facing masters; no Customer/Supplier/Both selector.
- Individual/Commercial changes fields/validation.
- Customer/Supplier use one primary photo/logo with fallback; Product retains multi-image media.
- Product Item|Service changes Create/Edit, saved profile, sections, summary and actions; Service exposes no inventory-only UI.
- Quick Create/Edit and Full Master Workspace coexist.
- Full Master Workspace is operational, not a disabled form.
- No Master Record Stepper by default.
- Consequential financial/inventory events are actions, not ordinary fields.
- Financial/cost summaries are authoritative and permission-aware.
- Inapplicable content is omitted rather than forced for symmetry.
- Arabic RTL and English LTR are first-class requirements.
