# AWJ Master Record Pattern V2 — Specification

Status: Design-system working specification. Documentation only; no production/API/DB/accounting changes.

## 1. Purpose

Master Record V2 defines the reusable ERP grammar for long-lived business entities such as Customer, Supplier and Product. It is distinct from Document Workspace: a master record persists and participates in many transactions; it is not itself a transactional document with posting lifecycle.

Canonical architecture:

`Master Record → Approved Pattern → Shared Components → Design Tokens`

The pattern must preserve ERP density, speed, permission awareness, tenant/branch rules, accounting integrity, Arabic RTL and English LTR.

## 2. Two interaction surfaces

### Quick Create / Edit
Used inside transactional work such as invoice or purchase entry. It must let the user create the minimum valid record without abandoning the current workflow. It must not become a miniature full profile.

### Full Master Workspace
Used to manage the entity after creation. Canonical anatomy:

`Identity Header → Contextual Actions → Key Summary → Details / Relations → Activity & Audit`

Desktop may use tabs where they improve density. Mobile recomposes the same information vertically and may use accordions where appropriate; it is not a separate information model.

## 3. Property versus consequential action

A core AWJ rule:

> Identity and operational attributes may be edited as record properties. Financial, inventory, or other consequential events must be represented as explicit actions/workflows, not disguised as ordinary form fields.

Examples:
- Product opening stock is an inventory event, not a normal editable quantity field.
- Customer/Supplier opening balance is an accounting event, not an ordinary profile property.
- Stock receipt/issue/transfer remain inventory actions.

## 4. Customer and Supplier domain decision

The user-facing V2 domain SHALL present **Customer** and **Supplier** as separate master experiences.

The UI SHALL NOT expose a selector whose choices are `customer / supplier / both` or the Arabic equivalent "عميل / مورد / كلاهما".

Current internal `Partner` reuse does not dictate the V2 UX. During implementation, backend/API/schema implications must be inspected separately. Current/demo records are experimental and are not by themselves a reason to preserve obsolete `both` UX. Architecture, accounting integrity, tenant isolation and genuine external compatibility remain protected.

This decision separates two axes that must not be confused:
1. Business role: Customer vs Supplier.
2. Entity type: Individual vs Commercial.

## 5. Customer entity type — Individual vs Commercial

`Individual / Commercial` is a meaningful entity type, not a decorative classification. It changes labels, visible fields and validation rules.

### Individual customer
Intended for a natural person acting in their own capacity.

Candidate V2 identity fields:
- Full name (Arabic; English where supported)
- Profile photo
- National/personal identifier where applicable
- Gender where business requirements justify it
- Birth date where business requirements justify it
- Mobile / phone / email
- Address

### Commercial customer
Intended for a company, establishment or other commercial entity.

Candidate V2 identity fields:
- Trade/business name (Arabic; English where supported)
- Company/establishment logo
- Commercial Registration / relevant commercial identifier
- VAT number where applicable
- Contact/representative person
- Mobile / phone / email
- Address

### Shared commercial settings
Where supported by AWJ:
- Customer classification
- Default price list
- Credit period
- Credit limit
- Active/inactive state

These settings do not make an Individual customer "commercial"; they are business relationship settings independent of legal/entity type.

### External-reference note
Daftra documentation was reviewed as a benchmark for the Individual/Commercial distinction and customer data behavior. It supports treating the choice as field/validation behavior rather than a cosmetic label. AWJ must still validate Saudi/ZATCA requirements against the authoritative applicable rules before implementation; Daftra is a product reference, not AWJ's legal authority.

## 6. Customer/Supplier profile image

V2 SHALL support a profile visual for both Customer and Supplier.

Presentation rule:
- Individual: profile photo.
- Commercial: organization logo.
- No uploaded image: generated avatar/fallback based on the record name.

The visual belongs prominently in the Full Master Workspace identity header. It must not be forced into every dense table, invoice selector or combobox; those surfaces preserve ERP information density unless a specific usability case requires imagery.

Current AWJ Partner contract does not yet provide this capability, so implementation requires an explicit backend/storage/API/UI scope and must not be smuggled into a visual-only change.

## 7. Customer Master — proposed information architecture

### Create/Edit
1. Identity header: image/logo, Individual/Commercial, active state.
2. Identity fields: dynamically appropriate to entity type.
3. Contact information.
4. Address / national-address information.
5. Business relationship settings: classification, price list, credit period, credit limit.
6. Additional information where actually supported.
7. Save.

Opening balance is excluded from the ordinary form-field hierarchy and exposed as an explicit accounting operation where applicable.

### View Workspace
The Customer Full Master Workspace should build on AWJ's existing Partner Profile capability while improving hierarchy:

1. Identity Header
   - photo/logo/fallback avatar
   - customer name
   - Individual/Commercial
   - active/inactive
   - customer code where applicable
2. Contextual Actions
   - Edit
   - create relevant sales transaction(s)
   - receive/register payment where permitted
   - statement/export actions
   - additional actions according to permissions and actual domain support
3. Key Financial Summary
   - current/closing balance
   - open amount
   - overdue/due amount
   - credit exposure/limit where supported
4. Details
   - identity, tax/commercial identity, contact and address
5. Relations
   - invoices
   - payments
   - ledger/statement
   - quotations
   - returns/credit notes where applicable
6. Activity / Timeline / Audit

Financial values shown in the UI must come from authoritative backend/accounting data; the V2 presentation must not invent new accounting calculations.

## 8. Product proving case

Current Product Profile already validates the Full Master Workspace concept: identity + SKU/status, edit/contextual actions, stock/average cost/sale price summary, information, inventory movements, timeline/activity, media, units and barcodes.

V2 must preserve the distinction between product properties and inventory events. Transfer, receipt, issue and opening quantity behavior are operational inventory actions, not free edits to stock-on-hand.

Product Quick Create/Edit remains valuable inside invoices/purchases and must coexist with the full Product Master Workspace.

## 9. Responsive and bilingual contract

Every Master Record V2 proving case must be deliberately verified in:
- Arabic RTL
- English LTR
- Desktop/laptop
- Tablet
- Mobile
- mixed-direction values: money, SKU, barcode, VAT/CR/IDs, phone/email
- long labels and text expansion

Mirroring direction must not alter logical information order or financial meaning.

## 10. Current implementation gaps intentionally deferred

Do not implement as part of this documentation checkpoint. Known candidate gaps include:
- Customer/Supplier profile image storage/API/UI.
- Individual-specific identity fields not present in the current Partner contract (for example National ID, gender, birth date if ultimately approved).
- Commercial representative/contact modeling if not already represented adequately.
- Removal or internal retention of `Partner.type = both`.
- Exact validation differences for Individual vs Commercial, including ZATCA-sensitive requirements.

Each requires repository inspection and a deliberately scoped implementation PR before production change.

## 11. Proving-case sequence

1. Customer Master V2 — first human/business-party proving case.
2. Product Master V2 — operational/inventory proving case.
3. Supplier Master V2 — validate that shared Partner internals do not force Customer UX onto procurement.
4. Only then consider extending the pattern to other master entities such as Employee.

## 12. Decisions locked in this checkpoint

- Customer and Supplier are separate user-facing master experiences.
- No user-facing Customer/Supplier/Both selector in V2.
- Individual/Commercial is an entity-type decision that changes fields/validation.
- Customer and Supplier support profile photo/logo with fallback avatar.
- Quick Create/Edit and Full Master Workspace coexist.
- Consequential financial/inventory events are actions, not ordinary editable profile fields.
- Customer opening balance remains accounting-sensitive and separate from ordinary profile editing.
- Arabic RTL and English LTR are first-class requirements.
