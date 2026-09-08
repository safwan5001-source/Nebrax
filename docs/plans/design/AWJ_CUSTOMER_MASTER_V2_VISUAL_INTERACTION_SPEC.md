# AWJ Customer Master V2 — Visual & Interaction Specification

Status: Design specification / proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Customer Master V2 is a business-party proving case for Master Record Pattern V2. The saved page is not a disabled form; it is the Customer operational/receivables workspace.

Primary questions:
- Who is this customer?
- Is the customer Individual or Commercial?
- What is the customer's authoritative financial position?
- What is due/overdue?
- What sales transactions and received payments relate to the customer?
- What action can the authorized user perform next?

## 2. Evidence hierarchy

Visual implementation and generated references SHALL follow:

`Actual AWJ contracts/code → approved Master Record V2 decisions → this Screen Contract → generated visual reference`

Images validate the contract; they do not define it. Do not invent fields, KPIs, tabs, actions, workflow states or accounting calculations to make a mockup look complete.

## 3. Current AWJ baseline verified

The shared Partner backend currently supports:
- name and English name;
- internal role `customer|supplier|both`;
- entity type `individual|commercial`;
- code;
- VAT and CR values;
- email, phone and mobile;
- address/city/building/street/district/postal code/country;
- customer classification and supplier classification;
- default price list;
- credit limit and credit period;
- opening balance/date as an accounting action input;
- active state.

The current Partner Quick Create/Edit dialog exposes only name, Individual/Commercial, email, phone and city, with Customer role supplied by context when used as Customer create.

The current Partner Profile already provides operational capabilities around details, invoices, payments, ledger/statement, quotations, balance, timeline and activity, with desktop Tabs and mobile Accordion behavior. V2 should rationalize this existing capability rather than invent an unrelated Customer CRM.

V2 does not expose Customer/Supplier/Both to the user. Customer is the domain/route role.

## 4. Screen Contract A — Add / Edit Customer

### 4.1 Purpose

Create/edit Customer identity and ordinary commercial relationship properties. This is one responsive Master Record workspace, not a wizard.

No Stepper is used unless a genuine future multi-stage Customer workflow is verified.

### 4.2 Desktop composition

Canonical order:

`Page Identity / Actions → Customer Identity → Contact → Address → Commercial/Personal Identity → Customer Relationship Settings → Save`

Use dense logical sections. Avoid decorative dashboard composition and unnecessary whitespace.

### 4.3 Domain role

Customer role is implicit from Customer context/route.

Do not show:
- Customer / Supplier / Both selector;
- Supplier classification or Supplier procurement settings.

### 4.4 Entity type

Show early:

`فردي (Individual) | تجاري (Commercial)`

The selection changes applicable identity fields, validation and profile presentation.

#### Individual Customer
Approved direction:
- full/display name;
- personal photo when profile media is implemented;
- contact information;
- address;
- personal/national identifier only when approved and applicable;
- gender/birth date only if deliberately approved as genuine AWJ business requirements.

Do not show CR/company fields as empty noise.

#### Commercial Customer
Approved direction:
- trade/business name;
- organization logo when profile media is implemented;
- CR / approved commercial identifier;
- VAT number where applicable;
- contact information;
- address;
- representative/contact person only when actually modeled.

Do not show person-only fields as empty noise.

### 4.5 Ordinary Customer relationship settings

Actual backend-supported Customer fields include:
- Customer classification;
- default price list;
- credit limit;
- credit period;
- active/inactive state.

These are business relationship properties, not legal entity type. An Individual customer may still have a price list or credit terms.

### 4.6 Profile media

One primary Customer identity asset is an approved V2 requirement:
- Individual → profile photo;
- Commercial → organization logo;
- absent → fallback avatar/initial.

Storage/API/UI is not implemented by this documentation PR. A generated reference may show the intended affordance but must not falsely imply current production upload support.

### 4.7 Consequential accounting exclusion

Opening balance is not an ordinary editable Customer field, even though the backend request accepts opening-balance input for accounting workflow purposes.

Opening balance create/correct/reverse must remain explicit, authorized and auditable and must preserve ledger integrity. Profile editing must never silently rewrite posted financial history.

Receiving a payment is likewise an operation, not a Customer property.

### 4.8 Quick Customer Create

Quick Create inside Sales/Quotation flows remains smaller than Full Add/Edit.

Current verified minimum dialog fields are name + Individual/Commercial + email + phone + city. Future additions should be only what is genuinely required to continue the originating transaction.

Quick Create:
- keeps Customer role implicit;
- never shows Customer/Supplier/Both;
- does not expose opening balance, statement, ledger or payment operations;
- returns the user to the originating transaction after save.

### 4.9 Actions

Create/Edit keeps actions small:
- Save;
- Cancel/back as appropriate.

Do not invent approval/posting/payment workflow controls for ordinary Customer editing.

## 5. Screen Contract B — Full Customer Profile

### 5.1 Canonical anatomy

`Identity Header → Contextual Command Bar → Compact Receivables Summary → Section Navigation → Active Operational Content`

The profile is an operational workspace, not a saved form.

### 5.2 Identity Header

Show:
- photo/logo/fallback;
- Customer name;
- Customer code where available;
- Individual/Commercial badge;
- active/inactive state;
- compact useful contact line.

Do not show internal Partner role terminology.

### 5.3 Contextual Command Bar

Actions must map actual capabilities and permissions.

Customer-domain candidates grounded in current AWJ capabilities include:
- Edit Customer;
- New Sales Invoice where route/domain support exists;
- New Quotation where supported;
- Receive/Register Payment where supported;
- Customer Statement / Ledger;
- statement/ledger export/print/share where actually supported.

Secondary actions belong in overflow. Do not add CRM opportunities, branches, memberships or other attractive-looking actions merely for mockup completeness unless they are real Customer capabilities.

### 5.4 Compact Receivables Summary

Semantic slots may include:
- current/closing balance;
- open amount;
- due/overdue amount;
- credit limit/exposure where configured.

All financial values must come from authoritative backend/accounting outputs. Current Partner Profile contains display derivations over backend values; implementation must preserve existing accounting semantics and must not create a second client-side accounting model.

Use dense facts rather than oversized SaaS KPI cards. Do not invent annual-sales charts, invoice counts, last-sale metrics or other KPIs unless they are intentionally supported by actual data/contracts.

### 5.5 Section navigation

Customer-oriented sections based on real capabilities:
- Details;
- Sales Invoices;
- Received Payments;
- Ledger / Customer Statement;
- Quotations;
- Balance / credit context where meaningful;
- Returns / Credit Notes where functionally supported;
- Timeline;
- Activity / Audit where supported.

Do not expose Supplier purchase/payables concepts.

Current generic Partner sections such as `membership` are not automatically retained in V2 merely because the shared profile contains them; each section must represent a real Customer task.

Desktop/laptop: dense Tabs/section navigation where appropriate.
Mobile: same logical sections recomposed through compact navigation/Accordion while preserving section context/deep links where supported.

### 5.6 Details rendering

Individual prioritizes personal identity/contact/address and only approved identifiers.

Commercial prioritizes business identity, CR/approved identifier, VAT where applicable, contact/address and representative only when modeled.

Irrelevant fields are omitted, not rendered as disabled/empty placeholders.

### 5.7 Financial operations

Opening balance, received payment and balance correction are explicit financial operations with permissions and auditability. Edit Customer never mutates posted accounting history.

## 6. Mobile Screen Contract

Mobile is the same Customer information model recomposed, not a separate workflow.

Priority:
1. identity/photo-logo/name/type/status;
2. essential authoritative receivables summary;
3. primary contextual action(s);
4. section navigation/content;
5. secondary details/activity.

No persistent global bottom navigation is introduced by Master Record Pattern. A bottom action area is allowed only when owned by a focused pattern flow and justified.

Do not squeeze desktop financial tables into the viewport. Use approved responsive record/table behavior.

## 7. Arabic RTL / English LTR contract

Verify:
- header/action ordering;
- tabs/Accordion directionality;
- money alignment/sign semantics;
- Customer code, VAT/CR/IDs, phone/email and mixed bidi content;
- long organization/personal names;
- translated action labels;
- desktop/laptop/tablet/mobile.

Direction mirroring never changes financial meaning.

## 8. Visual character

Follow AWJ Design System V2:
- dense daily-accounting workspace;
- neutral surfaces and restrained hierarchy;
- no gradients/heavy shadows;
- no oversized generic dashboard cards;
- semantic colors only for meaningful states;
- clear financial number alignment;
- photo/logo supports identity without dominating the page.

## 9. Visual Reference Gate

Before generating/approving Customer imagery verify:
- no Customer/Supplier/Both selector;
- Individual/Commercial dynamic behavior is clear;
- no invented wizard/Stepper;
- no invented CRM tabs/actions/KPIs;
- no opening balance as ordinary profile field;
- no Supplier concepts;
- financial summaries are semantic slots backed by authoritative data, not invented calculations;
- profile is operational, not a disabled form;
- photo/logo is an approved future capability, not falsely presented as already implemented;
- mobile has no global bottom navigation;
- RTL/LTR and mixed identifiers/money remain correct.

A visual violating this gate is concept-only and cannot become implementation documentation.

## 10. Known implementation gaps intentionally deferred

- Customer photo/logo storage/API/UI.
- approved Individual-specific identity fields absent from current Partner contract.
- Commercial representative modeling if needed.
- user-facing removal of `both` and any backend contract cleanup.
- final Saudi/ZATCA-sensitive validation matrix.
- final authoritative Customer summary endpoint/semantics where generic Partner behavior needs hardening.

## 11. Acceptance

Customer Master V2 is visually ready only when Add/Edit and Full Profile can be rendered from this contract without inventing business behavior, while preserving Customer receivables semantics, accounting/security/tenant integrity, responsive behavior and Arabic/English parity.
