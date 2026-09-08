# AWJ Supplier Master V2 — Visual & Interaction Specification

Status: Design specification / supplier proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Supplier Master V2 is a procurement/payables workspace, not a renamed Customer screen. Customer and Supplier may reuse internal primitives, but user-facing information architecture and actions reflect different business roles.

Primary questions:
- Who is this supplier?
- Is the supplier Individual or Commercial?
- What do we owe this supplier and what is due/overdue?
- What purchases, returns and outgoing payments relate to the supplier?
- What procurement/payables action can the authorized user perform next?

## 2. Evidence hierarchy for this specification

Visual implementation and future reference images SHALL follow this order:

`Actual AWJ contracts/code → approved Master Record V2 decisions → this Screen Contract → generated visual reference`

A generated image is validation material only. It is not allowed to invent fields, KPIs, tabs, actions, workflow states, navigation or financial calculations.

## 3. Current AWJ baseline verified

The current Suppliers list:
- loads `/partners?type=supplier`;
- uses `PartnerDialog` with `defaultType="supplier"`;
- supports Individual/Commercial filtering;
- supports city and phone/email-presence filters;
- links to supplier statement and ledger routes;
- currently links the supplier name to the shared `/partners/{id}` profile.

The current Quick Create/Edit dialog actually exposes only:
- name;
- entity type: Commercial / Individual;
- email;
- phone;
- city;
- Save / Cancel.

The current backend `StorePartnerRequest` additionally supports, among other fields:
- `name_en`, code;
- VAT number and CR number;
- mobile;
- address, city, building number, street, district, postal code, country;
- supplier classification;
- opening balance/date;
- active state.

The shared backend also contains Customer-oriented fields such as default price list, credit limit and credit period. Their existence does **not** authorize Supplier V2 to expose them; Supplier-specific relationship settings must be verified before use.

The current Partner profile already has details, invoices, payments, ledger, quotes, balance, membership, timeline and activity sections and desktop Tabs/mobile Accordion behavior. This is implementation evidence, not permission to copy Customer-only sections into Supplier V2.

V2 does not expose the internal `customer / supplier / both` role selector.

## 4. Screen Contract A — Add / Edit Supplier

### 4.1 Purpose

Create or edit Supplier identity and ordinary supplier master data. This screen is not a financial transaction and is not a wizard.

No Stepper is used unless a real future multi-stage supplier workflow is verified.

### 4.2 Desktop composition

Canonical order:

`Page Identity / Actions → Supplier Identity → Contact → Address → Supplier Business Identity → Relationship / Status → Save`

Use a dense single workspace with logical sections. Do not create oversized cards or decorative dashboard regions.

### 4.3 Role behavior

The route/context determines that the record is a Supplier.

Do **not** show:
- Customer / Supplier / Both selector;
- Customer classification;
- default sales price list;
- Customer credit limit/credit period merely because the shared Partner backend has those fields.

### 4.4 Entity type

Show one early selector:

`فردي (Individual) | تجاري (Commercial)`

It dynamically controls relevant identity fields.

#### Individual Supplier
Supported/approved presentation direction:
- full/display name;
- profile photo when profile media is implemented;
- email;
- phone/mobile;
- address fields;
- approved personal identifier only after Supplier-specific requirements are verified.

Do not invent National ID, gender or birth date as required Supplier fields without a verified AWJ requirement.

#### Commercial Supplier
Supported/approved presentation direction:
- trade/business name;
- organization logo when profile media is implemented;
- Commercial Registration / approved commercial identifier;
- VAT number where applicable;
- email;
- phone/mobile;
- address fields;
- representative/contact person only when the domain contract actually models it.

Irrelevant fields from the other entity type are omitted rather than left empty.

### 4.5 Shared ordinary master fields

Fields may be exposed only when backed by the actual Supplier/Partner contract and appropriate UX scope:
- Arabic/display name;
- English name where supported;
- supplier code where supported;
- entity type;
- email;
- phone/mobile;
- address/city/building/street/district/postal code/country;
- supplier classification;
- active/inactive state.

Profile photo/logo is an approved V2 requirement but is a known implementation gap; generated reference screens may reserve the identity-media affordance but must not imply that upload already works in production.

### 4.6 Consequential accounting exclusion

Opening balance is **not** part of the ordinary editable Supplier form even though the current backend request accepts opening-balance input.

V2 treats opening balance as an explicit accounting-sensitive action/workflow with authorization, auditability and ledger integrity. Corrections/reversals must not silently rewrite posted history.

Outgoing Supplier payment is likewise not a Supplier property.

### 4.7 Quick Supplier Create

Inside Purchase/Purchase Order flows, Quick Create remains intentionally smaller than the Full Add/Edit experience.

Current verified minimum is name + Individual/Commercial + email + phone + city. Future expansion should add only fields genuinely needed to complete the procurement transaction.

Quick Create:
- keeps Supplier role implicit from procurement context;
- does not show Customer/Supplier/Both;
- does not expose ledger, opening balance, payment, statement or other consequential operations;
- returns the user to the originating transaction after save.

### 4.8 Actions

Creation/edit actions are deliberately small:
- Save;
- Cancel/back as appropriate.

Do not invent Save & New, approval, posting, payment or workflow actions without verified support.

## 5. Screen Contract B — Full Supplier Profile

### 5.1 Purpose

The saved Supplier page is an operational procurement/payables workspace, not a disabled copy of Add/Edit.

Canonical anatomy:

`Identity Header → Contextual Command Bar → Compact Payables Summary → Section Navigation → Active Operational Content`

### 5.2 Identity Header

Show:
- Supplier name;
- Supplier code where available;
- Individual / Commercial badge;
- active/inactive state;
- compact useful contact line;
- Individual photo / Commercial logo when implemented;
- fallback avatar when no image exists.

Do not show internal Partner role terminology.

### 5.3 Contextual Command Bar

Only actions verified by actual domain/routes/permissions may appear.

Current verified supplier-specific navigation includes:
- Edit Supplier;
- Supplier Statement;
- Supplier Ledger.

V2 candidate actions that require implementation/domain verification before appearing as authoritative UI:
- New Purchase Invoice;
- New Purchase Order;
- Register outgoing Supplier Payment;
- export/print/share beyond the capabilities already verified on statement/ledger surfaces.

Generated visual references must visually distinguish or omit unverified candidate actions rather than presenting them as existing production capability.

Customer sales actions never appear in Supplier Master.

### 5.4 Compact Payables Summary

The target V2 may show only authoritative backend/accounting facts. Candidate semantic facts:
- current Supplier balance / amount payable;
- open payable amount;
- due/overdue amount;
- last Purchase or last Payment context when authoritative and useful.

Important current-code caveat: the shared Partner Profile contains frontend display derivations around generic invoice/payment data. These are not sufficient evidence to claim that every proposed Supplier payables KPI is already correctly implemented for the Supplier domain.

Therefore the Screen Contract locks the **semantic slots**, not invented numbers or calculations. Implementation must bind them to verified backend/accounting outputs.

Use dense facts, not oversized SaaS KPI cards.

### 5.5 Section navigation

Target Supplier sections are capability-driven. They may include only when supported:
- Details;
- Purchase Invoices;
- Outgoing Payments;
- Supplier Statement / Ledger;
- Purchase Orders;
- Purchase Returns / Supplier Credits;
- Balance context;
- Timeline;
- Activity / Audit.

Current shared Partner tabs named `invoices`, `payments`, `quotes`, `membership`, etc. are not copied blindly. Customer Quotations, Sales invoices, Customer membership and other Customer-only concepts are excluded unless a real Supplier-domain capability independently justifies them.

Desktop/laptop: dense Tabs/section navigation where appropriate.
Mobile: responsive Accordion/compact section navigation while preserving logical section/deep-link context where supported.

### 5.6 Details section

Details are entity-aware.

Individual prioritizes personal name/contact/address and only verified personal identifiers.

Commercial prioritizes business name, CR/approved commercial identifier, VAT where applicable, contact/address and representative only if modeled.

Supplier classification remains separate from entity type.

### 5.7 Financial and operational actions

Opening balance, outgoing payments and balance corrections are explicit consequential operations. Profile editing must never mutate posted accounting history.

Purchase-related operations must preserve actual permissions, tenant/branch isolation and accounting/inventory contracts.

## 6. Mobile Screen Contract

Mobile is the same Supplier information model, recomposed — not a separate wizard.

Priority:
1. identity/photo-logo/name/type/status;
2. compact payables summary when authoritative;
3. primary verified contextual action(s);
4. section navigation/content;
5. secondary details/activity.

No global Master Record bottom navigation is introduced by this pattern. Dense ledger/purchase history uses responsive record/table behavior rather than squeezed desktop tables.

## 7. Arabic RTL / English LTR contract

Verify deliberately:
- supplier/business names and long text;
- Individual/Commercial labels;
- VAT/CR/approved IDs;
- phone/email and mixed-direction values;
- money/sign semantics;
- Purchase/Payment references;
- action ordering;
- Tabs/Accordion directionality;
- desktop/laptop/tablet/mobile.

Mirroring must not alter financial meaning or logical action order.

## 8. Customer ↔ Supplier boundary

Shared Master Record grammar:
- Identity Header;
- Individual/Commercial entity type;
- photo/logo/fallback;
- active state;
- contact/address;
- contextual actions;
- compact authoritative summary;
- related-record sections;
- timeline/activity;
- Quick Create + Full Workspace;
- consequential-action separation.

Customer-specific:
- Sales invoices;
- Customer quotations;
- incoming payments;
- Customer classification / price list / credit policy;
- receivables language.

Supplier-specific:
- Purchase invoices;
- Purchase orders where supported;
- outgoing Supplier payments;
- Supplier classification;
- purchase returns / Supplier credits;
- payables language.

Internal Partner reuse must not erase these distinctions.

## 9. Visual Reference Gate

Before generating or approving a Supplier image/mockup, verify it against this checklist:
- no Customer/Supplier/Both selector;
- Individual/Commercial is visible and dynamic;
- no invented Supplier fields;
- no opening balance as ordinary form input;
- no invented Stepper/Wizard;
- no Customer-only tabs/actions;
- no unverified payables calculations;
- profile is operational, not a disabled form;
- photo/logo is treated as approved future capability, not falsely claimed current production support;
- desktop/mobile follow the same information model;
- RTL/LTR and mixed financial/identifier content remain correct.

Any generated image that violates this gate is a concept only and must not become implementation documentation.

## 10. Known implementation gaps intentionally deferred

- Supplier profile photo/logo storage/API/UI.
- final Supplier Individual/Commercial field and validation matrix.
- dedicated Supplier full-profile route instead of generic Partner profile.
- removal/internal retention of `Partner.type=both`.
- Supplier-specific payment-term/settings contract if needed.
- exact Purchase/Payment/Return relationships and permissions.
- authoritative Supplier payables summary endpoints/semantics where current generic Partner behavior is insufficient.

These require deliberately scoped implementation inspection/PRs; they are not part of this documentation checkpoint.

## 11. Acceptance

Supplier Master V2 is visually ready only when Add/Edit and Full Profile can be rendered from this contract without inventing business behavior, while remaining clearly procurement/payables-oriented and preserving accounting, security, tenant isolation, responsive behavior and Arabic/English parity.
