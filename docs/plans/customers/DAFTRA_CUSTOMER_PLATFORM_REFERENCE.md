# AWJ Customer Platform — Daftra Reference & Architecture Notes

**Status:** Research baseline + approved product direction; implementation still requires repository evidence pass  
**Date:** 2026-09-09  
**Scope:** AWJ-wide customer platform. This document is independent from Commerce; Commerce is only one consumer.

## 1. Approved product direction

AWJ treats the customer as an ERP-wide concept, not a Commerce-owned customer database.

```text
Partner / Customer Master
        |
        +-- invoices / payments / receivables / statements / quotes
        +-- contacts / addresses / customer metadata
        +-- memberships / subscriptions / loyalty / attendance (future apps)
        |
        +-- Customer Digital Identity / Account
                 |
                 +-- Customer Portal
                 +-- AWJ Web Store
                 +-- «متجرنا» mobile app
                 +-- future customer-facing channels
```

**Decision:** Customer Digital Identity is a shared AWJ platform capability. It is not owned exclusively by Commerce and is not a second customer master.

`ERP staff User != Customer Digital Identity != Partner / Customer Master`.

A Partner/Customer may exist without digital login. A visitor or guest cart is not automatically a Partner or Customer Digital Identity. Commerce may support browsing/cart as guest; customer identity is required only where the selected checkout/account policy requires it.

For future B2B, one organization/customer master must be able to have multiple authorized customer-side identities/contacts. Do not hard-code one login per Partner as a permanent architecture.

## 2. External verification

### 2.1 Daftra
Official Daftra documentation was reviewed on 2026-09-09. It documents customer electronic access/portal capabilities including customer profile, invoices, PDF/online payment, estimates/approval, statements, appointments/work orders where enabled, and customer-side permissions. Its customer profile is the commercial/customer hub and memberships, subscriptions, points/balances and attendance are customer-linked applications rather than a separate store customer master.

**AWJ implication:** customer authentication and ownership should be reusable outside Commerce, while existing ERP financial authorities remain authoritative.

### 2.2 Cross-check: Odoo / Shopify / Adobe Commerce
External product/documentation cross-check supports the same separation of concerns:

- Odoo customer accounts also provide access to customer portal information such as orders/invoices and are not merely a cart credential.
- Shopify customer accounts represent customer-facing identity/history, and its B2B model separates company/organization context from the individual customer who can act for it.
- Adobe Commerce distinguishes registered customer accounts from guest checkout and supports customer/company user concepts rather than requiring every guest/cart to become the ERP customer master.

**Conclusion from external evidence:** AWJ should share customer identity across customer-facing channels, but must keep guest/cart, digital identity, and ERP commercial customer record as distinct concepts with explicit linking rules.

## 3. Canonical AWJ distinctions

1. **Partner / Customer Master** — canonical ERP commercial/accounting customer relationship.
2. **Customer Digital Identity/Account** — customer-facing authentication and ownership/access identity.
3. **Customer Portal** — customer-facing projection/actions for permitted ERP data.
4. **Commerce Customer Context** — Commerce's use of the shared AWJ customer identity; Commerce does not own identity truth.
5. **Guest / Guest Cart** — may browse/add to cart without creating Customer Digital Identity or Partner.
6. **Order Customer Snapshot** — immutable historical name/contact/address evidence on the agreed order where required.
7. **Membership / Subscription / Loyalty / Attendance** — separate customer applications linked to customer platform concepts, not fields embedded in Commerce identity.
8. **Accounting receivable/credit** — existing AWJ financial truth; never interchangeable with loyalty/package balance.
9. **ERP User** — employee/staff identity and RBAC; not customer login.

## 4. Current AWJ repository evidence

Repository inspection confirms the existing `App\Models\Partner` is already the commercial party model for customer/supplier/both. It carries tenant/branch context, commercial identity/contact/address fields, classifications, default price list, credit limit/period and customer/supplier role helpers. Existing AWJ screens also use Partner in invoices, purchases, quotes, credit/debit notes, CRM and customer statement surfaces.

Current Partner is therefore the existing commercial/customer master candidate; it must not be replaced by a Commerce customer table merely to support login.

However, current evidence does **not** establish an ERP-wide customer digital login model. Exact customer authentication provider, identity schema, linking/claim policy, B2B cardinality and normalized reusable address/contact model remain implementation decisions requiring CUS-ARCH-0.

## 5. Minimum Customer Platform slice required to unblock Commerce

AWJ does **not** need to build the full Customer Platform before Commerce continues. The minimum shared foundation is:

### CUS-ARCH-0 — Customer Identity architecture/evidence pass
Must inspect current Partner schema, tenant/branch behavior, staff auth, invoice/payment ownership, existing contact/address behavior and API conventions. It must lock names, cardinality and linking rules before schema work.

### CUS-ID-1 — Shared Customer Digital Identity foundation
A tenant-safe customer-facing identity/account independent from staff `User` and separate from Partner. It must support explicit linkage to the appropriate customer master without silent duplicate/merge behavior and preserve future B2B multi-user capability.

### CUS-AUTH-1 — Customer authentication + ownership guard
Customer login/session/token boundary, tenant established before customer lookup, ownership-safe access, no staff RBAC reuse, no cross-customer ID guessing, and explicit registration/invitation/claim behavior.

### CUS-CONTACT-1-MIN — Checkout address/contact minimum
Only if repository evidence shows current Partner flat fields are insufficient for reusable checkout/customer addresses. Build the smallest shared customer address/contact capability needed by checkout; do not build the full future customer application here.

**Commerce unblock gate:** after CUS-ARCH-0 + CUS-ID-1 + CUS-AUTH-1, plus the minimum address/contact capability only if required, Commerce may resume using this shared identity. The full Customer Portal, memberships, subscriptions, loyalty and attendance are not prerequisites for Commerce.

## 6. Commerce impact

COM-5B is unaffected.

The current Commerce Master Plan wording `PR-COM-6A — Commerce Customer Account foundation` must **not** be implemented as a Commerce-private identity.

After the minimum Customer Platform gate is merged, Commerce Phase 6 should be reframed as integration with the shared AWJ Customer Platform. COM-7 checkout/public/mobile APIs consume the same customer identity that can later power Customer Portal. «متجرنا» and Web Store are clients, not customer databases.

## 7. Full Customer Platform roadmap — independent project

- **CUS-ARCH-0:** architecture/evidence pass.
- **CUS-ID-1:** shared Customer Digital Identity foundation.
- **CUS-AUTH-1:** customer authentication, ownership and tenant-safe authorization.
- **CUS-CONTACT-1:** contacts and reusable addresses as required by the general customer platform.
- **CUS-PORTAL-1:** customer portal read surface — profile, invoices, payments, statement, estimates.
- **CUS-MEM-1:** memberships/packages.
- **CUS-SUB-1:** subscription/renewal lifecycle.
- **CUS-LOY-1:** loyalty points/package balances, explicitly separated from accounting balance.
- **CUS-ATT-1:** customer attendance integrated with membership eligibility where applicable.

This roadmap belongs to `docs/plans/customers/` and is independent from the Commerce implementation plan.

## 8. External references

### Daftra official documentation
- https://docs.daftra.com/
- https://docs.daftra.com/tutorial/%D8%B9%D8%B1%D8%B6-%D8%AD%D8%B3%D8%A7%D8%A8-%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84/
- https://docs.daftra.com/user_manual/%D8%A7%D9%84%D8%AA%D8%AD%D9%83%D9%85-%D9%81%D9%8A-%D8%B5%D9%84%D8%A7%D8%AD%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1/
- https://docs.daftra.com/tutorial/%D8%B9%D8%B1%D8%B6-%D9%85%D9%84%D9%81-%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84/
- https://docs.daftra.com/tutorial/%D8%AA%D8%B9%D8%AF%D9%8A%D9%84-%D9%85%D9%84%D9%81-%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84/
- https://docs.daftra.com/user_manual/crm-comprehensive-guide/
- https://docs.daftra.com/user_manual/%D8%AF%D9%84%D9%8A%D9%84-%D8%B4%D8%A7%D9%85%D9%84-%D9%86%D8%B8%D8%A7%D9%85-%D8%A7%D9%84%D8%B9%D8%B6%D9%88%D9%8A%D8%A7%D8%AA-%D9%81%D9%8A-%D8%AF%D9%81%D8%AA%D8%B1%D8%A9/
- https://docs.daftra.com/tutorial/%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D8%B6%D9%88%D9%8A%D8%A7%D8%AA/
- https://docs.daftra.com/tutorial/%D8%A5%D8%B6%D8%A7%D9%81%D8%A9-%D8%B9%D8%B6%D9%88%D9%8A%D8%A9/
- https://docs.daftra.com/tutorial/%D8%AA%D8%AA%D8%A8%D8%B9-%D9%86%D9%82%D8%A7%D8%B7-%D9%88%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D9%83%D8%AA%D8%B3%D8%A8%D8%A9/
- https://docs.daftra.com/tutorial/%D8%AA%D8%AA%D8%A8%D8%B9-%D9%86%D9%82%D8%A7%D8%B7-%D9%88%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83%D8%A9/
- https://docs.daftra.com/user_manual/%D8%AF%D9%84%D9%8A%D9%84-%D8%B4%D8%AD%D9%86-%D8%A7%D9%84%D8%B1%D8%B5%D9%8A%D8%AF-%D9%88%D8%A7%D9%84%D8%A7%D8%B3%D8%AA%D9%87%D9%84%D8%A7%D9%83/

### Cross-check references
- Odoo customer accounts / portal: https://www.odoo.com/documentation/18.0/applications/websites/ecommerce/customer_accounts.html
- Shopify customer accounts: https://help.shopify.com/en/manual/customers/customer-accounts/manage
- Shopify B2B companies/customers: https://help.shopify.com/en/manual/b2b/companies-and-customers
- Adobe Commerce B2B REST overview: https://developer.adobe.com/commerce/webapi/rest/b2b/

## 9. Evidence classification

- Daftra behavior: **EXTERNAL VERIFIED** from official documentation.
- Odoo/Shopify/Adobe cross-check: **EXTERNAL VERIFIED** at product-pattern level.
- Existing AWJ Partner role/fields and usage: **AWJ VERIFIED** from current repository.
- Shared ERP-wide customer identity direction: **OWNER APPROVED PRODUCT DIRECTION**.
- Exact identity schema/auth provider/linking/cardinality/address normalization: **OPEN / CUS-ARCH-0 REQUIRED**.

This document does not authorize schema/auth/accounting/deployment changes by itself. Implementation begins only through separately reviewed Customer Platform PRs.