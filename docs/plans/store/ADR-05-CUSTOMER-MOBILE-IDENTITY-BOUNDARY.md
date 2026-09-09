# ADR-05 — Customer / Mobile Identity Boundary

**Status:** Accepted — Architecture Direction  
**Date:** 2026-09-09  
**Scope:** AWJ Commerce consumer/mobile identity and Partner boundary only — no implementation approval

## Context

ADR-01 through ADR-04 established the Commerce Order, inventory reservation, fulfillment-source, and payment boundaries. The Existing Architecture Audit found that AWJ currently has mature ERP staff authentication/RBAC and a flat Partner/customer model, but no dedicated consumer/mobile identity boundary and no B2B Company → Location → Buyer hierarchy.

AWJ Commerce must support customer-facing channels such as AWJ Web Store and «متجرنا» without turning consumers into ERP staff users, weakening resource ownership, duplicating accounting customer truth, or leaking customer data across tenants.

## Decision

AWJ Commerce separates:

```text
Commerce Authentication Identity
Commerce Customer Account
ERP Staff User
Partner
```

These concepts may be linked where appropriate, but they are not aliases.

Consumer/mobile customers do not become ERP staff users merely to access Commerce. Commerce Customer Accounts are tenant-scoped and may operate across authorized sales channels. Partner remains AWJ's commercial/accounting customer authority and is resolved/linked/created only at an approved business milestone rather than on anonymous browsing or registration.

Commerce Orders preserve historical customer/contact/address snapshots. Guest checkout is supported for B2C. Identity verification does not silently merge Partner records. Customer-facing APIs authorize access by authenticated resource ownership inside a trusted Tenant context rather than by exposing ERP staff RBAC to consumers.

## 1. Customer Account != ERP User != Partner

These concepts answer different questions:

- **ERP Staff User:** a person authorized to operate AWJ ERP under the existing staff authentication, role, permission, branch, application, and resource-scope model.
- **Commerce Authentication Identity:** credentials/verified identity/session boundary used by a consumer or buyer to authenticate to Commerce.
- **Commerce Customer Account:** the tenant-owned customer-facing Commerce profile and relationship used across authorized Commerce channels.
- **Partner:** AWJ's existing commercial/accounting customer authority used by invoices, payments, balances, tax/business data, and other ERP financial documents.

No implementation may assume that a login identity is itself the accounting customer record.

## 2. Consumer/mobile customers are not ERP staff users

The intended boundary is:

```text
AWJ Web / «متجرنا» Mobile
          ↓
Commerce Authentication
          ↓
Commerce Customer Account
          ↓
Commerce APIs
```

not:

```text
Consumer
   ↓
ERP Staff User
   ↓
ERP RBAC / internal APIs
```

The existing ERP User/RBAC model remains for staff/internal principals unless a separately approved architecture explicitly extends it.

Commerce customer authentication must not grant access to staff routes, developer routes, internal accounting operations, or ERP permission surfaces merely because a customer has authenticated successfully.

## 3. Authentication Identity is separate from Commerce profile

Authentication concerns include concepts such as:

- verified phone/email identity;
- OTP/password/external identity credentials as later selected;
- authentication sessions/tokens;
- account recovery/security state;
- authentication audit/security controls.

Commerce Customer Account concerns include concepts such as:

- customer-facing profile;
- saved Commerce addresses;
- Commerce order ownership/history;
- preferences/favorites where later approved;
- channel relationships;
- link to Partner where established.

Exact persistence boundaries may evolve, but security identity must not be collapsed into mutable accounting/customer master data.

## 4. Customer Account is tenant-scoped

AWJ is multi-tenant. The same human may legitimately shop from multiple AWJ tenants.

For example:

```text
Tenant A
  └─ Customer X

Tenant B
  └─ Customer X
```

These are separate tenant-owned Commerce relationships.

A shared phone number, email, device, or authentication provider identity must never imply shared Orders, Addresses, Partner IDs, pricing, balances, returns, payment history, or other tenant-owned data.

Even if a future authentication layer can recognize the same human across merchants, Commerce authorization remains tenant-bound.

## 5. Customer Account may span authorized Sales Channels

Sales Channel describes where a commercial interaction originated; it does not define a separate customer identity.

Conceptually:

```text
             Customer Account
              /           \
       AWJ Web           «متجرنا»
```

A customer who uses web and mobile for the same tenant should not require unrelated customer profiles merely because the channel differs.

Channel-specific preferences or consent may be modeled later without duplicating the core tenant-owned customer relationship.

## 6. Guest checkout is supported for B2C

AWJ preserves the typed CheckoutIdentityPolicy direction:

```text
GUEST_OR_ACCOUNT
ACCOUNT_REQUIRED
B2B_APPROVED_ACCOUNT
```

For general B2C V1, the architecture direction is **GUEST_OR_ACCOUNT** unless a separately approved channel/business policy requires otherwise.

Guest checkout may create a Commerce Order without first creating a persistent authenticated Customer Account.

Guest does not mean financially anonymous: required customer/contact/tax/shipping data may still be captured on the Order and a Partner may later be resolved/created when the business/financial milestone requires it.

## 7. Order customer data is historical snapshot data

Commerce Order must preserve the commercial customer/contact/address information used at the time of the transaction.

Conceptually this may include:

```text
customer name
phone
email
shipping address
billing address
business/tax fields when applicable
```

Links such as `customer_account_id` or `partner_id` may coexist with the snapshot, but later profile or Partner edits must not silently rewrite historical Order facts.

This principle must carry through to downstream financial/tax documents according to their existing immutable/frozen document rules.

Exact snapshot schema is deferred.

## 8. Partner remains the commercial/accounting customer authority

ADR-05 does not replace AWJ Partner with Commerce Customer Account.

Partner continues to serve the existing ERP/accounting responsibilities, including where applicable:

- invoices and financial documents;
- payments and balances;
- customer commercial master data;
- tax/business information;
- ERP customer reporting and workflows.

Commerce Customer Account is a customer-facing identity/profile boundary, not a second receivables/customer ledger.

## 9. Partner is not created merely for browsing or registration

Anonymous browsing, cart creation, or Commerce account registration must not automatically pollute ERP Partner master data.

Conceptually:

```text
Visitor
  ↓
Customer Account / Commerce activity
  ↓
approved business milestone
  ↓
Partner resolution/link/create when required
```

The exact milestone is an implementation decision. Candidates may include Order confirmation or the first event that genuinely requires an ERP customer master.

The milestone must be selected to preserve accounting/tax/document requirements without creating unnecessary Partners.

## 10. Guest Orders may resolve to Partner when required

A Guest Checkout can still become an Invoice or other financial transaction requiring Partner/customer resolution.

Conceptually:

```text
Guest Checkout
      ↓
Commerce Order
      ↓
Partner resolution/link/create
      ↓
Invoice / existing AWJ financial flow
```

Guest status therefore does not bypass existing accounting customer requirements.

## 11. Identity matching != Partner deduplication

A verified phone/email can prove control of an authentication identifier according to the selected authentication mechanism. It does not by itself prove that every existing Partner record containing the same value must be merged or linked.

AWJ must not silently merge Partner records based solely on:

- display name;
- unverified email;
- phone number;
- similar address;
- other weak matching heuristics.

Partner linking/deduplication requires explicit, auditable rules and may require manual review depending on risk.

Existing Partner records must never be destructively merged as a side effect of Commerce login or checkout.

## 12. Phone-first capability for Saudi/mobile Commerce

The identity architecture must be capable of supporting normalized phone-based authentication suitable for Saudi/mobile Commerce, conceptually including a verified number such as:

```text
+9665XXXXXXXX
```

with OTP or another approved verification mechanism.

Email-based authentication/verification may also be supported.

ADR-05 does not select SMS/OTP provider, authentication framework, password policy, token format, or exact normalization library.

A verified Commerce phone identity does not automatically prove that an existing Partner with a matching phone number is the same commercial record.

## 13. Commerce Addresses are not forced into the current Partner address shape

The Existing Architecture Audit identified a comparatively flat Partner/address model. Consumer Commerce commonly needs multiple saved addresses.

Conceptually:

```text
Customer Account
  ├─ Home
  ├─ Work
  └─ Other
```

ADR-05 does not require changing Partner schema to store every Commerce address.

Commerce Address may become a separate capability while Order retains the immutable address snapshot actually used for fulfillment/billing.

Whether/how selected addresses synchronize to Partner is deferred.

## 14. Customer-facing API authorization is ownership-based

Customer APIs must authorize access from the authenticated Commerce principal and trusted Tenant context.

Typical resources may include:

```text
my profile
my addresses
my orders
my returns
my payment status
```

The client must not gain access to another customer's resource merely by supplying a guessed `customer_id`, `order_id`, address ID, or similar identifier.

Resource ownership must be established server-side.

Commerce customer authorization must not reuse `developer.*` permissions or expose the ERP staff RBAC permission surface as the consumer authorization model.

## 15. Tenant Isolation is mandatory

Every Commerce Identity-to-Customer Account relationship and every Customer Account-to-Partner/Order/Address relationship must be tenant-safe.

Forbidden examples include:

```text
Tenant A authenticated customer
       ↓
Tenant B Order
```

or:

```text
Tenant A Customer Account
       ↓
Tenant B Partner
```

Future implementation must explicitly validate ownership rather than relying only on incidental global scopes.

Authentication callbacks, OTP flows, mobile/public APIs, background jobs, order-linking flows, and Partner-resolution flows must establish trusted Tenant context before reading or mutating tenant-owned resources.

Cross-tenant negative tests are mandatory.

## 16. Account linking requires proof of control

A Guest Order may later be associated with an authenticated Customer Account only through a trusted linking flow that establishes sufficient proof of control over the relevant identity/order context.

AWJ must not attach historical Guest Orders to an account merely because the account currently supplies the same unverified phone/email string.

The exact claim/linking mechanism is deferred.

## 17. B2B foundation preserves person-vs-company separation

Future B2B Commerce may require a structure conceptually similar to:

```text
Partner / Company
      ↓
Company Location
      ↓
Buyer Identity
```

Multiple authenticated buyers may act for one commercial Partner/company.

This reinforces the rule that Login Identity != Partner.

ADR-05 does not approve B2B Company/Location/Buyer schema, permissions, purchasing limits, approval flows, payment terms, or Partner changes. Those remain Later/follow-up architecture.

## 18. «متجرنا» is a client/channel, not a reason to build marketplace identity now

For the current architecture, «متجرنا» consumes AWJ Commerce as a mobile sales channel/client.

ADR-05 does not introduce a global multi-merchant marketplace identity model merely because «متجرنا» may evolve later.

If «متجرنا» becomes a marketplace/platform with multiple merchants under one consumer identity, that requires a dedicated future ADR covering marketplace tenancy, consent, identity federation, merchant/customer relationships, and data isolation.

V1 must not pre-implement that complexity.

## 19. Security and privacy boundaries

Future implementation must apply least privilege to consumer identity and customer data.

At minimum:

- authentication secrets/tokens are not exposed through Partner/customer APIs;
- staff-only fields are not exposed to consumer APIs merely because they exist on Partner;
- sensitive accounting/internal metadata is not included in public/mobile customer resources;
- authentication/session endpoints use appropriate rate limiting and abuse controls;
- verification/account-recovery flows are auditable and resistant to account takeover;
- customer data access remains tenant- and owner-bound;
- logs must avoid unnecessary exposure of secrets/OTP values/tokens.

Exact privacy retention and regulatory requirements require implementation/security review.

## 20. Backward compatibility

ADR-05 does not require rewriting existing ERP staff authentication, Partner, invoice, payment, POS customer, or developer API flows.

New Commerce identity/customer capabilities may be introduced alongside existing ERP boundaries.

Legacy records may be linked/migrated only through separately scoped and tested changes.

Existing Partners must not automatically receive consumer login credentials or Customer Accounts simply because Commerce is enabled.

## 21. Required implementation invariants

Any future implementation must preserve at least these invariants:

1. Commerce Authentication Identity, Commerce Customer Account, ERP Staff User, and Partner remain distinct concepts.
2. Consumer authentication never implicitly grants ERP staff/developer privileges.
3. Commerce Customer Account is tenant-scoped.
4. A Customer Account may operate across authorized Sales Channels without duplicating core identity per channel.
5. Guest checkout is supported for B2C unless an explicit policy requires an account.
6. Historical Order customer/contact/address facts are snapshot data and are not silently rewritten by later profile edits.
7. Partner remains the commercial/accounting customer authority.
8. Browsing/registration alone does not automatically create Partner master records.
9. Identity verification does not silently merge Partner records.
10. Guest-to-account historical Order linking requires trusted proof of control.
11. Customer-facing API access is derived from authenticated resource ownership, not client-supplied customer identifiers.
12. Customer-facing APIs do not expose ERP staff RBAC as the consumer authorization model.
13. Commerce Address needs do not force premature mutation of the current Partner address model.
14. Cross-tenant Customer/Partner/Order/Address linkage or access is forbidden.
15. Existing ERP/POS authentication/customer behavior is not silently changed.

## 22. Explicit non-decisions

ADR-05 intentionally does **not** decide:

- authentication framework/provider;
- SMS/OTP provider;
- password vs passwordless default;
- exact phone/email normalization implementation;
- token/session technology;
- Customer Account database schema;
- Commerce Identity database schema;
- Commerce Address database schema;
- exact Partner creation/resolution milestone;
- Partner deduplication algorithm;
- automatic Partner merge rules;
- guest-order claim mechanism;
- account recovery UX;
- social login;
- biometric/device authentication;
- public/mobile API endpoint contract;
- favorites/wishlist schema;
- consent/marketing-preference schema;
- B2B Company/Location/Buyer schema;
- B2B purchasing roles/limits/approvals;
- marketplace identity;
- global cross-tenant consumer profile;
- Commerce-to-Partner address synchronization;
- privacy retention periods.

These require implementation plans, security/privacy review, or follow-up ADRs.

## 23. Consequences

### Benefits

- Keeps public/mobile consumers outside the ERP staff security boundary.
- Preserves Partner as the existing financial/commercial customer authority.
- Supports guest checkout without sacrificing downstream accounting identity requirements.
- Allows one tenant-owned customer relationship across Web and «متجرنا».
- Creates a clean path to multiple saved addresses and future B2B buyers.
- Avoids uncontrolled Partner proliferation from anonymous browsing/registration.
- Prevents dangerous silent customer merges based on weak identifiers.
- Provides a clear Tenant Isolation/resource-ownership model for mobile/public APIs.

### Costs and trade-offs

- Introduces a new Commerce identity/customer-account boundary rather than reusing ERP User directly.
- Requires explicit Partner resolution/linking workflows.
- Guest-to-account claiming and duplicate detection require careful security design.
- Multiple customer representations require clear synchronization ownership.
- Future B2B and marketplace identity remain separate work rather than being solved generically in V1.

## 24. Architecture foundation completed

With ADR-05, the first Commerce architecture gate covers:

```text
ADR-01  Commerce Order ↔ Accounting
ADR-02  Reservation ↔ Inventory / Available-to-Sell
ADR-03  Sales Channel ↔ Warehouse / Fulfillment Source
ADR-04  Payment Intent ↔ Financial Settlement / Refund
ADR-05  Customer Identity ↔ Partner / ERP User
```

The recommended next artifact is an **AWJ Commerce Implementation Master Plan** grounded in the Existing Architecture Audit, Commerce research, Best-of-Breed decisions, and ADR-01 through ADR-05.

The implementation plan should define dependency-ordered, small PRs with explicit accounting, Tenant Isolation, concurrency, idempotency, API, backward-compatibility, test, and rollout gates.

The Existing Architecture Audit identified Inventory Reservation / Available-to-Sell as the highest-priority missing foundational capability, so it is a likely first implementation stream subject to the Master Plan.

No production implementation, migration, authentication change, Partner schema change, API change, accounting change, POS behavior change, merge, or deployment is authorized by this ADR.

## References

- `ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md`
- `ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md`
- `ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md`
- `ADR-04-PAYMENT-INTENT-CAPTURE-REFUND.md`
- `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md`
- `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`
- `AWJ_COMMERCE_PLATFORM_RESEARCH.md`
- `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md`
- `AWJ_STORE_MASTER_PLAN.md`
