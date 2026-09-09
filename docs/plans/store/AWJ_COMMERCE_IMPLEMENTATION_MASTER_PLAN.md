# AWJ Commerce — Implementation Master Plan

**Status:** Implementation planning baseline — no production implementation authorized by this document alone  
**Date:** 2026-09-09  
**Base:** `f78508af038cd0c7dfee3828259b006f90106ff4`  
**Scope:** AWJ Commerce Core, AWJ web commerce, Mobile Commerce API for «متجرنا», and future connected channels.

## 1. Purpose

This plan converts the merged Commerce architecture audit, research, ADR-01 through ADR-05, and Evidence Passes 01–03 into a dependency-ordered implementation program.

The plan does not authorize merge, deployment, production release, accounting-rule changes, ZATCA-rule changes, or unrelated refactoring. Every implementation PR remains independently reviewable and requires the normal AWJ approval flow.

## 2. Evidence hierarchy

Implementation decisions must be traceable to one of:

- **AWJ VERIFIED** — current repository behavior.
- **ADR APPROVED** — merged Commerce ADR.
- **EXTERNAL VERIFIED** — authoritative external evidence.
- **INFERENCE / PLAN** — implementation organization derived from the above.
- **OPEN / REQUIRES VERIFICATION** — cannot be implemented as an assumption.

When this plan conflicts with an existing merged ADR, the ADR wins until explicitly superseded.

## 3. Non-negotiable architecture

1. `CommerceOrder != Invoice`.
2. `Reservation != StockMovement`.
3. `PaymentIntent != provider attempt/transaction != AWJ Payment`.
4. `Return != Refund != CreditNote != Exchange`.
5. `SalesChannel != Branch != Warehouse != PickupLocation`.
6. Commerce customer identity is not ERP staff `User` and is not `Partner`.
7. Existing `InvoiceService`, `InventoryService`, `LedgerService`, `PaymentService`, ZATCA and approved accounting services remain authorities for their existing financial/inventory responsibilities.
8. Commerce must not directly write journal lines, stock valuation, COGS or ZATCA artifacts.
9. Legacy ERP invoice/POS flows are not forced through CommerceOrder in the initial rollout.
10. Product Variants are not a prerequisite for the first Commerce vertical slice.
11. No universal Saudi invoice-trigger default is approved.
12. Tenant isolation, idempotency and backward compatibility are release gates, not follow-up improvements.

Canonical lifecycle:

```text
Cart
  -> Checkout
  -> Commerce Order
  -> Inventory Reservation
  -> Payment Intent / payment mode
  -> Fulfillment
  -> Invoice when the approved Saudi trigger says it is due
  -> Existing AWJ accounting/ZATCA path
```

## 4. Delivery strategy

Implementation is split into small PRs. A later PR must not be started merely because an earlier PR is coded; its dependency must be merged and its required gate passed.

Recommended initial vertical slice:

```text
Existing AWJ Product/SKU
  -> Commerce Listing
  -> fixed fulfillment warehouse
  -> ATS/reservation
  -> Commerce Order
  -> one approved payment mode
  -> Fulfillment
  -> approved Invoice trigger
  -> existing Invoice/Payment/Accounting/ZATCA services
```

The first slice intentionally excludes first-class variants, marketplace behavior, automatic multi-warehouse split fulfillment, generic promotions rules engine, B2B company hierarchy, and broad external-channel synchronization.

---

# PHASE 0 — Implementation contracts and safety harness

## PR-COM-0 — Commerce module boundary & test harness

**Goal:** establish namespace/module boundaries and test scaffolding without business behavior.

**Scope:**
- Define Commerce domain/service/API namespaces following current repository conventions.
- Add Commerce-specific test organization.
- Add architecture tests/guards where current AWJ testing patterns support them.
- Document prohibited direct writes from Commerce into ledger/stock valuation/ZATCA internals.

**No:** order schema, reservation schema, payment integration, storefront UI.

**Acceptance:**
- Existing test suites remain green.
- Tenant/branch guard suites remain green.
- No behavior change to legacy sales/POS.

---

# PHASE 1 — Inventory truth before checkout

## PR-COM-1A — Available-to-Sell read model

**Dependency:** PR-COM-0.  
**ADR:** ADR-02.

**Goal:** expose a single server-side ATS calculation for Commerce without changing On Hand.

Contract:

```text
ATS = max(0, On Hand - Active Reserved)
```

**Requirements:**
- tenant scoped;
- warehouse scoped;
- product/sellable identity scoped;
- UOM normalized to base quantity using existing AWJ conversion authority;
- no accounting/valuation effect;
- no client-computed ATS authority.

**Important:** exact class/table names are not prescribed here until implementation inspection confirms current conventions.

**Tests:** unit/service + tenant isolation + warehouse separation + UOM cases.

## PR-COM-1B — Inventory Reservation aggregate

**Dependency:** PR-COM-1A.

**Goal:** first-class auditable reservation lifecycle.

Approved lifecycle:

```text
ACTIVE -> CONSUMED
ACTIVE -> RELEASED
ACTIVE -> EXPIRED
```

Only ACTIVE reduces ATS.

**Requirements:**
- atomic availability check and acquisition;
- idempotent create/release/consume/expire operations;
- tenant + warehouse + sellable identity ownership validation;
- reference to owning Commerce operation without making reservation accounting truth;
- no StockMovement when merely reserving;
- partial consumption preserves remaining reservation where required.

**Mandatory tests:**
- PostgreSQL concurrency tests with competing reservations;
- duplicate/idempotent mutation tests;
- cross-tenant denial;
- wrong-warehouse denial;
- release/expiry restores ATS;
- reservation never changes On Hand/avg_cost/GL.

**Release gate C1:** Commerce may not promise stock before this PR is merged and verified.

---

# PHASE 2 — Sales Channel and fulfillment source

## PR-COM-2A — Sales Channel foundation

**Dependency:** PR-COM-1B.  
**ADR:** ADR-03.

**Goal:** introduce tenant-owned channel identity without coupling channel to accounting documents.

Initial channel categories may represent AWJ web/mobile/external channels, but exact enum/storage form must follow implementation inspection and migration conventions.

**Requirements:**
- tenant isolation;
- active/inactive state;
- stable internal identity;
- no synthetic channel forced onto historical invoices/POS records.

## PR-COM-2B — Channel fulfillment policy

**Dependency:** PR-COM-2A.

**V1 policy:** `FIXED_LOCATION` / fixed eligible warehouse source.

**Foundation only:** future `PRIORITY_LOCATIONS` may be representable without implementing routing engine behavior.

**Reject in V1:** automatic split fulfillment across warehouses.

Routing is successful only when reservation acquisition succeeds atomically in the selected warehouse.

**Tests:** tenant isolation, inactive channel, invalid warehouse ownership, unavailable stock, deterministic fixed-source selection.

---

# PHASE 3 — Commerce catalog presentation

## PR-COM-3 — Commerce Listing foundation

**Dependency:** PR-COM-2A.

**Goal:** separate ERP Product truth from storefront presentation.

**Reuse:** existing Product/ProductMedia and public-safe resource patterns.

**Commerce-specific concerns:**
- publish state;
- storefront title/description where needed;
- SEO metadata where needed;
- channel visibility;
- storefront categorization/collection mapping only to the level required by the first slice;
- media ordering/selection using existing media capabilities where possible.

**Non-negotiable:** cost/accounting/private product fields must not leak into public/mobile responses.

**Variants:** current Product/SKU is the sellable unit in the first slice. API/snapshot contracts must avoid making that assumption impossible to evolve later, but no variant schema is authorized here.

---

# PHASE 4 — Pricing and commercial snapshot

## PR-COM-4A — Commerce Price Resolution boundary

**Dependencies:** PR-COM-3; existing PriceList infrastructure.

**Goal:** one Commerce-facing commercial price resolution boundary that composes existing verified pricing sources without replacing Invoice financial authority.

**Reuse/extend:**
- `PriceListService`;
- customer/default price-list semantics where applicable;
- POS resolver behavior only where semantics are truly shared;
- existing `min_sale_price` protections.

**Must not:** recalculate posted historical invoices or become a parallel tax/accounting engine.

Output is a commercial quote/snapshot input, not an accounting posting.

## PR-COM-4B — Minimal promotion contract (optional for launch)

**Dependency:** PR-COM-4A.

This PR exists only if the chosen launch slice requires promotions.

**Do not build:** generic rules engine.

Allowed V1 promotion types must be explicitly selected before coding. All discounts must preserve minimum-sale-price and authorized override contracts.

If no launch requirement exists, defer this PR.

---

# PHASE 5 — Commerce Order

## PR-COM-5A — Commerce Order aggregate

**Dependencies:** PR-COM-1B, 2B, 4A.  
**ADR:** ADR-01.

**Goal:** independent non-accounting commercial order authority.

Order must preserve immutable/historical snapshots sufficient to explain what customer agreed to, including product/sellable reference, description, quantity/UOM normalization evidence as needed, unit/commercial price, discounts, taxes as commercial snapshot data, shipping amount, customer/contact/address snapshot, channel and fulfillment-source context.

**No accounting impact on confirmation.**

Do not make Quote, Invoice or DeliveryNote the CommerceOrder table/model.

**State model:** exact states must be finalized during implementation from required transitions; do not invent extra states merely for UI convenience.

## PR-COM-5B — Order reservation orchestration

**Dependency:** PR-COM-5A.

Connect approved order transition to ADR-02 reservation timing policy.

Supported policy vocabulary from ADRs:
- `ON_ORDER_CONFIRMATION`
- `ON_PAYMENT_CONFIRMED`

No universal tenant default is assumed by this plan. The first launch slice must choose its policy explicitly.

**Tests:** duplicate confirmation, insufficient ATS, partial quantities, rollback on reservation failure, cross-tenant references.

---

# PHASE 6 — Customer/mobile identity

## PR-COM-6A — Commerce Customer Account foundation

**Dependency:** can proceed after PR-COM-3, but must be merged before authenticated customer APIs.  
**ADR:** ADR-05.

**Goal:** tenant-owned customer-facing account separate from ERP User and Partner.

**Rules:**
- no staff RBAC reuse;
- no secrets/credentials stored on Partner;
- same human may have separate tenant relationships;
- identity matching does not silently merge Partners;
- registration/browsing/cart does not automatically create Partner unless a later approved resolution milestone requires it.

## PR-COM-6B — Commerce authentication & ownership guard

**Dependency:** PR-COM-6A.

Exact auth provider/method remains implementation/provider decision; phone-first Saudi capability should remain possible.

**Mandatory:**
- ownership-scoped customer APIs;
- tenant established before tenant data lookup;
- ID guessing cannot expose another account/order/address;
- guest-to-account claim requires proof;
- no ERP staff session/token accepted as an implicit consumer identity contract unless explicitly designed and approved.

## PR-COM-6C — Customer addresses & immutable order address snapshot

**Dependency:** PR-COM-6B.

Multiple commerce addresses are separate from the flat Partner address. Order snapshots remain immutable after order agreement even if account address changes later.

---

# PHASE 7 — Cart, Checkout and Mobile Commerce API

## PR-COM-7A — Cart/checkout commercial validation

**Dependencies:** PR-COM-4A, 5A, 6A as required by chosen guest/account policy.

**Goal:** server-authoritative checkout validation.

Validate at checkout:
- listing/channel availability;
- current commercial pricing;
- ATS/reservation policy;
- customer/guest required data;
- fulfillment source;
- shipping selection;
- totals/currency;
- idempotency key.

Client totals are never authority.

## PR-COM-7B — Public/Mobile Commerce API V1

**Dependency:** PR-COM-7A.

This is the first-class API consumed by AWJ web storefront and «متجرنا» mobile app.

Initial surface should cover only the vertical slice: catalog/listing, product detail, availability projection, cart/checkout, order creation/read, and customer ownership operations required by the selected identity policy.

**Security:** public-safe resources only; rate limiting and existing API conventions; no internal accounting/cost fields.

**Important:** «متجرنا» is the first reference client, not a reason to embed app-specific business logic into Commerce Core.

---

# PHASE 8 — Payments

## PR-COM-8A — Payment Intent foundation

**Dependencies:** PR-COM-5A, 7A.  
**ADR:** ADR-04.

**Goal:** provider-neutral payment orchestration.

Separate:
- Commerce PaymentIntent;
- provider attempt/transaction;
- existing AWJ Payment financial settlement;
- refund.

Modes allowed by architecture:
- immediate capture;
- authorize then capture;
- COD;
- pay on pickup.

The first launch slice chooses only the modes actually needed.

## PR-COM-8B — Provider adapter + inbound callback foundation

**Dependency:** PR-COM-8A.

Exact provider is OPEN until selected.

**Mandatory callback pipeline:**

```text
verify authenticity/signature
 -> establish trusted tenant context
 -> validate provider refs + amount + currency + state
 -> deduplicate/idempotency check
 -> persist provider event/attempt evidence
 -> perform allowed state transition
 -> acknowledge/retry safely
 -> reconcile asynchronously when needed
```

Browser redirect/success page never marks paid.

No PAN/CVV storage.

Reuse existing AWJ idempotency/outbound-webhook patterns where semantics fit; do not blindly reuse outbound trust assumptions for inbound events.

## PR-COM-8C — Payment settlement bridge

**Dependency:** PR-COM-8B.

When provider truth reaches the approved financial point, bridge to existing AWJ `PaymentService` rather than creating a second settlement ledger.

**Accounting tests mandatory.**

---

# PHASE 9 — Fulfillment

## PR-COM-9A — Fulfillment aggregate

**Dependencies:** PR-COM-5B and selected payment policy.

**Goal:** operational fulfillment separate from Invoice and accounting.

V1:
- one selected warehouse per fulfillment/order slice;
- partial fulfillment foundation only if launch scenario requires it;
- reservation consumption tied to actual approved fulfillment transition;
- no automatic multi-warehouse split.

Existing DeliveryNote behavior may be reused/extended only where semantics match; DeliveryNote itself must not be redefined into accounting authority.

## PR-COM-9B — Shipping method/rate snapshot

**Dependency:** PR-COM-7A/9A as appropriate.

Shipping selection becomes part of CommerceOrder commercial snapshot. When invoiced, the approved amount enters existing `Invoice.shipping` semantics.

**Gate:** current fixed 15% shipping VAT assumption must be explicitly accepted for launch scope or generalized through a separately approved accounting/tax change before broader shipping scenarios.

Shipment/Fulfillment never posts shipping revenue directly.

---

# PHASE 10 — Saudi invoice trigger and accounting bridge

## PR-COM-10A — Saudi launch-scenario invoice matrix decision

**Documentation/decision PR before automatic invoicing.**

**Dependencies:** selected launch payment + fulfillment behavior.

Must explicitly approve behavior for the actual supported launch scenarios, including relevant subset of:
- B2C/B2B;
- immediate payment;
- prepayment;
- partial payment;
- COD;
- pay on pickup;
- fulfillment/delivery;
- partial fulfillment;
- invoice-before-supply.

If evidence is legally/accountingly ambiguous, owner/accounting/tax review is required. Do not encode a guess.

## PR-COM-10B — Commerce-to-Invoice bridge

**Dependency:** PR-COM-10A.

Generate/prepare Invoice only at the approved trigger, using existing InvoiceService/ZATCA authority.

**Must preserve:**
- immutable Commerce commercial snapshot/audit trail;
- InvoiceService calculations and safeguards;
- ZATCA document classification;
- existing ledger posting path;
- existing inventory/COGS path at the appropriate approved event;
- idempotency so retries cannot create duplicate invoices.

**No direct journal/stock/ZATCA writes from Commerce.**

---

# PHASE 11 — Returns, refunds and exchanges

## PR-COM-11A — Commerce Return request/authorization boundary

**Dependencies:** completed order/fulfillment slice.

Return remains operational and distinct from Refund/CreditNote/restock.

Reuse existing ReturnDocument where semantics match; do not collapse all return states into it by assumption.

## PR-COM-11B — Refund orchestration

**Dependencies:** payment provider capability + PR-COM-11A.

Refund cannot exceed refundable captured amount. Provider refund state and AWJ financial correction remain distinct evidence/authorities.

## PR-COM-11C — CreditNote/restock bridge

Use existing CreditNote/ReturnDocument/accounting/inventory services according to verified semantics.

Restock decision is independent from refund decision.

**OPEN:** future Commerce return valuation policy must not silently change existing current-average-cost behavior without a dedicated accounting decision.

## PR-COM-11D — Exchange foundation (Later)

Exchange = return + replacement + financial delta. Extend existing PosExchange concepts only after compatibility review; not required for first vertical slice.

---

# PHASE 12 — External channels

## PR-COM-12A — External channel identity & mapping foundation

**Dependency:** stable SalesChannel, listing, order, reservation APIs.

Introduce mappings for AWJ internal identities to external store/channel identities only after exact target provider is selected.

AWJ remains inventory source of truth; external stock projection derives from ATS.

## PR-COM-12B — Event ingestion / synchronization

**Requirements:**
- verified webhook authenticity;
- tenant-safe store/channel resolution;
- idempotent event handling;
- external IDs;
- explicit sync direction;
- retry/backoff;
- reconciliation jobs;
- loop prevention;
- audit/log visibility.

Do not assume webhook ordering or exactly-once delivery.

## PR-COM-12C — First external provider adapter

Provider selected only after web/«متجرنا» pilot proves Commerce Core. Salla/Zid/Shopify are candidates; this plan does not choose one.

---

# PHASE 13 — B2B commerce (Later)

Future model direction from research:

```text
Partner / Company
  -> Company Location
  -> Buyer Commerce Identity
```

Potential later capabilities: catalogs, negotiated pricing, approval, payment terms, buyer permissions.

No B2B hierarchy schema is authorized until the Partner compatibility audit for that milestone.

---

# PHASE 14 — Product Variants (Later compatibility program)

Variants begin with a dedicated audit, not a migration.

Mandatory compatibility coverage:
- Product lifecycle;
- inventory/reservation identity;
- warehouses;
- UOM;
- ProductBarcode registry;
- PriceListItem;
- POS/scanning/held carts;
- invoice snapshots;
- purchases/receiving;
- returns/DeliveryNote/CreditNote/exchange;
- import/export;
- public APIs;
- reports/search;
- tenant uniqueness/ownership.

Only after this audit may AWJ choose between child SKU, template/variant split, or another verified model.

---

# 15. Cross-cutting gates for every implementation PR

## Tenant Isolation

- Every new tenant-owned model participates in AWJ tenant guard conventions.
- Explicit same-tenant ownership checks for referenced tenant entities.
- Background/inbound jobs establish trusted TenantContext before tenant queries.
- External IDs never independently select a tenant.
- Add cross-tenant negative tests.

## Branch/Warehouse isolation

Branch and Warehouse are not interchangeable. Use existing BranchContext/guards only where branch semantics genuinely apply; warehouse ownership/source checks remain explicit.

## Idempotency

Use/reuse established AWJ idempotency patterns. Required on externally retryable and financially/materially mutating Commerce commands.

## Concurrency

Reservation/ATS correctness must be proven on PostgreSQL, not inferred from SQLite tests.

## Accounting

Any PR touching Invoice/Payment/CreditNote/Return accounting bridges requires targeted accounting tests and broader relevant accounting suites. No test reduction for financial paths.

## Backward compatibility

Existing POS/invoice/public APIs must remain stable unless a separately approved compatibility change is required. New Commerce behavior should be additive initially.

## Security

- public-safe serialization;
- ownership checks;
- no payment-card secrets;
- verified provider callbacks;
- replay protection;
- rate limiting/auth appropriate to endpoint class.

## Observability

Material asynchronous operations should expose enough correlation/audit data to diagnose retries, provider events, reservation conflicts and reconciliation without exposing secrets.

---

# 16. Recommended implementation order

Critical path:

```text
COM-0
 -> COM-1A -> COM-1B
 -> COM-2A -> COM-2B
 -> COM-3
 -> COM-4A
 -> COM-5A -> COM-5B
 -> COM-7A -> COM-7B
 -> COM-8A -> COM-8B -> COM-8C
 -> COM-9A / COM-9B
 -> COM-10A -> COM-10B
```

Customer identity `COM-6A..6C` should be inserted before authenticated customer functionality; it can proceed partly in parallel after catalog contracts stabilize, but merging parallel branches must not bypass dependency review.

Returns follow a working fulfillment/payment/invoice slice. External channels follow proof of the native AWJ/«متجرنا» Commerce Core.

---

# 17. V1 / Foundation / Later classification

## V1 required
- Commerce module/test boundary.
- ATS + reservation.
- SalesChannel + fixed fulfillment source.
- CommerceListing.
- Commerce price resolution.
- CommerceOrder + reservation orchestration.
- checkout validation.
- Mobile Commerce API for the first reference client.
- required customer identity mode for launch.
- required payment mode/provider integration.
- fulfillment.
- Saudi invoice-trigger decision for supported scenarios.
- Commerce-to-existing-Invoice/Payment/accounting bridge.

## V1 foundation but possibly dormant
- partial fulfillment-ready boundaries where cheap and safe;
- provider attempt/event audit;
- future routing policy representation without routing engine;
- public contracts that do not block future sellable variants.

## Later
- first-class variants;
- automatic multi-warehouse routing/split fulfillment;
- broad promotions/loyalty;
- B2B hierarchy/payment terms;
- exchanges;
- multiple external providers/channels;
- marketplace behavior.

---

# 18. Definition of Done for a Commerce PR

A PR is not complete merely because code exists.

Required as applicable:
1. scope matches its task document;
2. migrations reviewed for tenant/backward compatibility;
3. targeted tests green;
4. tenant isolation negative tests green;
5. PostgreSQL concurrency tests green where reservation involved;
6. accounting/ZATCA tests green where financial bridge involved;
7. web/API build/tests green where affected;
8. no unrelated refactor;
9. implementation report MD includes changed files, tests/results, build/CI, risks/remaining, branch/PR/Base SHA/Head SHA and next step;
10. CI green;
11. explicit owner approval before merge;
12. explicit owner approval before deploy/production release;
13. production verification only after an explicitly approved deployment.

---

# 19. Open decisions that must remain visible

1. Saudi invoice trigger for each launch scenario.
2. Launch reservation timing policy.
3. Launch checkout identity policy.
4. First payment provider and capture mode.
5. Whether launch shipping scope can safely retain current AWJ shipping VAT semantics.
6. Whether launch needs any promotion at all.
7. Customer-to-Partner resolution/creation milestone.
8. Partial fulfillment inclusion in first release.
9. First external provider after native pilot.
10. Future Product Variant architecture.

None may be silently converted into a default by an implementation agent.

---

# 20. First implementation milestone

**Milestone M1 — Stock Promise Foundation**

Execute only:

1. `PR-COM-0` — module/test boundary.
2. `PR-COM-1A` — ATS read model.
3. `PR-COM-1B` — atomic Inventory Reservation.

Why first: the current audit identifies the absence of Reservation/ATS as the highest-priority Commerce gap, and every credible checkout/order/payment path depends on being able to promise stock without changing On Hand prematurely.

M1 must finish with PostgreSQL concurrency evidence before Commerce Order checkout implementation begins.

---

# 21. Implementation handoff rule

For each PR, create a narrow task document or execution prompt from this Master Plan. The implementation agent must inspect only the current code paths necessary for that PR, preserve merged ADRs, and return a final MD report containing:

- summary of what was implemented;
- files changed;
- migrations/schema impact;
- tests and exact results;
- build/CI status;
- tenant/accounting/security implications;
- risks and remaining work;
- Branch / PR / Base SHA / Head SHA;
- recommended next step.

No implementation agent may merge or deploy without Safwan's explicit approval.
