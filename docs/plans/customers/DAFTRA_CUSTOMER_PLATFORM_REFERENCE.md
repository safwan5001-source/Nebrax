# AWJ Customer Platform — Daftra Reference & Architecture Notes

**Status:** Research baseline / architecture input — no implementation authorized by this document alone  
**Date:** 2026-09-09  
**Purpose:** Record externally verified Daftra customer-platform behavior before AWJ implements COM-6 customer identity, so Commerce does not become the owner of customer identity.

## 1. Decision summary for AWJ

AWJ should treat the customer as an ERP-wide customer platform concept, not a Commerce-only concept.

Proposed boundary:

```text
Partner / Customer Master (AWJ ERP commercial record)
        |
        +-- invoices / payments / receivables / statements / quotes
        +-- contacts / addresses / customer metadata
        +-- memberships / subscriptions / loyalty & balances / attendance (future apps)
        |
        +-- Customer Digital Account / Identity (optional login relationship)
                 |
                 +-- Customer Portal
                 +-- AWJ Web Store
                 +-- «متجرنا» mobile app
                 +-- future customer-facing channels
```

A digital customer account is therefore **not** a second customer master and must not be owned exclusively by Commerce.

`ERP staff User != Customer Digital Account != Partner/Customer Master`.

A Partner/Customer may exist without digital login. A digital account may be linked to the appropriate AWJ customer relationship under an explicit verified policy. Registration must not silently merge/create accounting customer records without an approved resolution policy.

For future B2B, the design must remain capable of one organization/customer master having multiple authorized customer-side identities/contacts; do not hard-code a permanent one-login-per-Partner architecture without a separate decision.

## 2. Externally verified Daftra reference

Research source: official Daftra documentation (`docs.daftra.com`), reviewed 2026-09-09.

### 2.1 Customer electronic access / portal

Daftra documents a customer-facing login capability where customers can enter the system and, according to configured permissions, access their own information. Documented customer-facing surfaces include:

- home page with recent invoices and estimates;
- invoices: view, PDF and online payment;
- estimates: view, PDF and approval;
- work orders when enabled;
- bookings/appointments when enabled;
- customer statement;
- own account/profile.

Daftra also documents customer permissions under its electronic customer platform settings. Permissions can allow/deny customer registration/access and control visibility/actions such as profile, shared notes/attachments, invoices/payment, estimates/approval, work orders, appointments and statement.

**AWJ implication:** customer authentication/ownership should be an ERP-wide customer capability reusable by portal and Commerce clients, with explicit customer-side authorization rather than staff RBAC reuse.

### 2.2 Customer master/profile

Daftra's customer profile acts as a consolidated customer record. Official documentation describes:

- core identity/address/contact information;
- customer actions such as edit, appointment, email, add payment credit and statement;
- operational tabs including invoices, estimates, payments, appointments and others;
- custom fields;
- quick operational summaries;
- financial account summary and closing balance.

Customer editing documentation also describes individual vs business customer types, account data, classification, notes/attachments, multiple contacts and multiple addresses.

**AWJ implication:** customer master/contact/address data should not be duplicated as Commerce-owned truth. Commerce/order snapshots may remain immutable historical evidence, while reusable current customer information belongs to the customer platform/master domain.

### 2.3 Memberships and subscriptions

Daftra documents memberships as customer-linked capabilities. A membership is assigned to a selected customer; packages, renewal, grace periods, stopping/freezing, attendance eligibility and invoicing/payment are integrated behaviors.

Daftra documentation states membership/subscription invoices may be created as drafts depending on settings. It also documents dependency between membership and subscription/renewal records.

**AWJ implication:** memberships/subscriptions should be future customer applications linked to the AWJ customer master and existing invoice/payment authorities, not fields embedded in Commerce Customer Account.

### 2.4 Loyalty points and balances

Daftra documents customer points/balances separately from ordinary customer receivable balance. It supports balance types/packages and tracks loyalty points earned and consumed per customer/invoice. Memberships and balances can be combined for recurring/package business models.

**AWJ implication:** future loyalty/package balances need their own auditable subsystem. They must not be confused with accounting receivables/payables, AWJ Payment, or a Commerce order total.

### 2.5 Customer attendance

Daftra membership settings include controls for who may register attendance (for example all customers, subscribers, or active subscribers), and its customer application family includes customer attendance.

**AWJ implication:** attendance is a customer application consuming customer/membership identity, not a Commerce responsibility.

### 2.6 Financial customer balance and payments

Daftra's customer profile and reports connect customers to invoices, payments, returns/adjustments and ending balance. It also supports adding customer payment credit and allocating credit to outstanding invoices.

**AWJ implication:** AWJ's existing financial authorities remain authoritative. Customer Portal/Commerce should expose permitted projections/actions but must not create a parallel customer ledger.

## 3. Important distinctions for AWJ

The following concepts must remain distinct:

1. **Partner / Customer Master** — ERP commercial/accounting relationship and canonical customer record.
2. **Customer Digital Identity/Account** — customer-facing authentication and ownership/access relationship.
3. **Customer Portal** — UI/API projection for invoices, payments, statement, estimates, profile, etc.
4. **Commerce Customer Context** — the customer identity/context used by web store and «متجرنا»; Commerce is a consumer of customer identity.
5. **Order Customer Snapshot** — immutable historical name/contact/address evidence on an agreed CommerceOrder where required.
6. **Membership** — customer application/domain object.
7. **Subscription/Renewal** — recurring membership/service lifecycle, separate from login identity.
8. **Loyalty/Package Balance** — auditable non-ledger benefit/balance domain unless an approved accounting design says otherwise.
9. **Accounting receivable/credit** — existing AWJ financial truth, never interchangeable with loyalty/package balance.
10. **ERP User** — employee/staff identity and RBAC; not a customer login.

## 4. Required change before COM-6A

Current Commerce Master Plan describes `PR-COM-6A — Commerce Customer Account foundation` as Commerce-owned customer/mobile identity. The broader AWJ product direction now requires an architecture pass before COM-6A implementation.

Before coding COM-6A:

1. Inspect current AWJ Partner/customer schema, contacts, addresses, invoice/payment ownership, tenant rules and existing auth.
2. Decide the canonical name/namespace for ERP-wide customer digital identity (do not assume `CommerceCustomerAccount`).
3. Define Partner/Customer Master ↔ digital identity cardinality for B2C V1 while preserving future B2B multi-user capability.
4. Define account invitation/registration/linking/claim rules and duplicate-resolution policy.
5. Define tenant establishment before customer lookup/authentication.
6. Define customer-side authorization independently from staff RBAC.
7. Define portal projections for invoices, payments, statement, estimates and profile without bypassing existing financial authorities.
8. Define how Web Store and «متجرنا» consume the same identity/API contract.
9. Keep memberships, subscriptions, loyalty/balances and attendance as separately planned customer applications; identity must be extensible to them without embedding their state in the identity table.
10. Update `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` Phase 6/7 dependencies after this architecture decision.

## 5. Proposed AWJ Customer Platform roadmap (planning only)

This is a planning proposal, not implementation authorization:

- **CUS-ARCH-0:** Customer Platform architecture/evidence pass.
- **CUS-ID-1:** ERP-wide Customer Digital Identity foundation.
- **CUS-AUTH-1:** Customer authentication, ownership and tenant-safe authorization.
- **CUS-PORTAL-1:** Customer Portal read surface — profile, invoices, payments, statement, estimates.
- **CUS-CONTACT-1:** contacts and reusable addresses normalization/extension if current AWJ model requires it.
- **CUS-MEM-1:** memberships/packages.
- **CUS-SUB-1:** subscription/renewal lifecycle.
- **CUS-LOY-1:** loyalty points and package balances, explicitly separated from accounting customer balance.
- **CUS-ATT-1:** customer attendance integrated with membership eligibility where applicable.

Commerce dependencies should consume CUS-ID/CUS-AUTH rather than create a Commerce-private customer identity.

## 6. Commerce impact

COM-5B is unaffected and may continue under its existing contract.

**Do not start current COM-6A as written until CUS-ARCH-0 resolves the ERP-wide identity boundary and the Commerce Master Plan is updated.**

COM-7 Public/Mobile Commerce API should use the same customer identity that powers the AWJ Customer Portal. «متجرنا» is a client of this shared identity and Commerce API, not a separate customer database.

## 7. External references — official Daftra documentation

- Daftra user guide home / customer application taxonomy: https://docs.daftra.com/
- Customer account view / electronic customer access: https://docs.daftra.com/tutorial/%D8%B9%D8%B1%D8%B6-%D8%AD%D8%B3%D8%A7%D8%A8-%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84/
- Customer permissions / electronic customer platform: https://docs.daftra.com/user_manual/%D8%A7%D9%84%D8%AA%D8%AD%D9%83%D9%85-%D9%81%D9%8A-%D8%B5%D9%84%D8%A7%D8%AD%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1/
- Customer profile: https://docs.daftra.com/tutorial/%D8%B9%D8%B1%D8%B6-%D9%85%D9%84%D9%81-%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84/
- Customer profile editing / contacts / addresses: https://docs.daftra.com/tutorial/%D8%AA%D8%B9%D8%AF%D9%8A%D9%84-%D9%85%D9%84%D9%81-%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84/
- CRM comprehensive guide: https://docs.daftra.com/user_manual/crm-comprehensive-guide/
- Membership system guide: https://docs.daftra.com/user_manual/%D8%AF%D9%84%D9%8A%D9%84-%D8%B4%D8%A7%D9%85%D9%84-%D9%86%D8%B8%D8%A7%D9%85-%D8%A7%D9%84%D8%B9%D8%B6%D9%88%D9%8A%D8%A7%D8%AA-%D9%81%D9%8A-%D8%AF%D9%81%D8%AA%D8%B1%D8%A9/
- Membership settings: https://docs.daftra.com/tutorial/%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D8%B6%D9%88%D9%8A%D8%A7%D8%AA/
- Add membership: https://docs.daftra.com/tutorial/%D8%A5%D8%B6%D8%A7%D9%81%D8%A9-%D8%B9%D8%B6%D9%88%D9%8A%D8%A9/
- Points earned tracking: https://docs.daftra.com/tutorial/%D8%AA%D8%AA%D8%A8%D8%B9-%D9%86%D9%82%D8%A7%D8%B7-%D9%88%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D9%83%D8%AA%D8%B3%D8%A8%D8%A9/
- Points consumed tracking: https://docs.daftra.com/tutorial/%D8%AA%D8%AA%D8%A8%D8%B9-%D9%86%D9%82%D8%A7%D8%B7-%D9%88%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83%D8%A9/
- Balance/package guide: https://docs.daftra.com/user_manual/%D8%AF%D9%84%D9%8A%D9%84-%D8%B4%D8%AD%D9%86-%D8%A7%D9%84%D8%B1%D8%B5%D9%8A%D8%AF-%D9%88%D8%A7%D9%84%D8%A7%D8%B3%D8%AA%D9%87%D9%84%D8%A7%D9%83/
- Customer balance report: https://docs.daftra.com/tutorial/%D8%B9%D8%B1%D8%B6-%D8%AA%D9%82%D8%B1%D9%8A%D8%B1-%D8%A3%D8%B1%D8%B5%D8%AF%D8%A9-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1/

## 8. Evidence classification

- Daftra behavior above: **EXTERNAL VERIFIED** from official documentation.
- AWJ target boundary/roadmap: **INFERENCE / PLAN**, pending repository evidence pass and owner approval.
- Exact AWJ schema, cardinality, authentication provider, customer registration/linking policy and B2B organization-user model: **OPEN / REQUIRES VERIFICATION**.

This document is a research reference. It does not authorize schema, authentication, accounting, merge, deployment or customer-portal behavior changes by itself.
