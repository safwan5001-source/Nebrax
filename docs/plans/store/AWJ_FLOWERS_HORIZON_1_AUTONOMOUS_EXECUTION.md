# AWJ Flowers & Gifts — Autonomous Implementation Horizon

**Status:** Authoritative execution plan  
**Date:** 2026-10-03  
**Repository:** `safwan5001-source/Nebrax`  
**Planning Base:** `main` @ `318cc72d10bb304cef4b401f548772008ea1618e`  
**Scope:** End-to-end implementation of the approved Flowers & Gifts vertical direction  
**Execution model:** Inspect → Research → Plan → Build → Test → Visual QA → Review → PR → CI → Merge → Sync main → Continue  
**Merge authorization:** Authorized within this Horizon when the slice satisfies the merge gates below  
**Deploy / Production:** NOT authorized

---

## 0. Purpose and authority

This document is the execution authority for the Flowers & Gifts program already defined by:

- `AWJ_FLOWERS_GIFTS_VERTICAL_V1.md` — product/architecture direction;
- `FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md` — current AWJ reuse/gap evidence;
- `FNP_DEEP_EVIDENCE_1_REPORT.md` — external Flowers & Gifts evidence;
- `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md` — observed/inferred/unknown capability matrix.

Those documents define **what AWJ should become and what evidence supports it**.

This Horizon defines **how the work proceeds autonomously through implementation and integration**.

If documents conflict:

1. current code reality and safety constraints win;
2. merged ADRs remain authoritative for shared Commerce/accounting/inventory/security boundaries;
3. `FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md` governs proven reuse/gap status;
4. `AWJ_FLOWERS_GIFTS_VERTICAL_V1.md` governs product direction;
5. this Horizon governs execution sequencing and merge behavior.

No document in this set authorizes production deployment.

---

## 1. Owner intent

AWJ should support a reusable **Business Vertical** model.

The merchant may choose a store/business profile such as:

- General Retail;
- Flowers & Gifts;
- Grocery;
- Fruits & Vegetables;
- Fashion;
- Electronics;
- future verticals.

This Horizon implements the first real vertical:

`flowers_gifts`

The profile is a **starting configuration/capability pack**, not a permanent lock and not a second commerce engine.

Architecture:

```text
AWJ ERP Core
        ↓
AWJ Commerce Core
        ↓
Business Vertical Profile / Capability Pack
        ↓
Store Builder + Storefront UX
        ↓
Theme / Presentation
```

The Flowers & Gifts vertical must reuse AWJ authorities for Product, Variant, Inventory, Warehouse, Customer, Cart, Checkout, Commerce Order, Payment, Fulfillment, Invoice, Accounting, VAT/ZATCA and tenant ownership.

---

## 2. Executor behavior

The intended executor is Claude Code or another repository-capable coding agent.

It must start from the latest `origin/main`, not from this planning SHA.

Before each slice:

1. fetch latest `origin/main`;
2. record the exact Base SHA;
3. read only relevant current docs/code;
4. verify that assumptions still match current code;
5. perform focused external research when it materially improves a contract or UX decision.

It must not repeat the already completed broad FNP or AWJ capability audits unless new conflicting evidence appears.

---

## 3. Autonomous operating loop

For every safe implementation slice:

```text
sync latest main
→ inspect relevant evidence/code
→ focused external research when useful
→ freeze bounded contract
→ implement
→ focused tests
→ relevant integration tests
→ visual/browser QA for UI
→ security/tenant/backward-compat review
→ open PR
→ resolve valid review findings
→ inspect relevant CI
→ fix in-scope failures
→ final diff review
→ merge when gates pass
→ record Merge SHA
→ sync latest main
→ update progress log
→ continue automatically
```

The executor must **not** ask the owner whether to continue between normal safe slices.

Large work should be split into reviewable dependency-ordered PRs rather than accumulated in one mega-branch.

---

## 4. Merge authorization

Within this Horizon, merge is authorized when all applicable gates pass:

- slice scope is coherent and matches this Horizon;
- no unrelated refactor;
- no unresolved meaningful review thread;
- focused tests pass;
- required relevant integration tests pass;
- CI is green, or any unrelated blocker is clearly proven and repository norms safely allow merge;
- Tenant Isolation is explicitly reviewed and tested where applicable;
- no financial/accounting authority changed accidentally;
- no inventory authority duplicated;
- no unsafe client authority introduced;
- backward compatibility is reviewed;
- UI changes have responsive/RTL visual evidence;
- migration is additive/safe if present.

Preferred merge method: follow current repository convention.

After merge:
- record Base SHA, Head SHA and Merge SHA;
- fetch latest main;
- continue automatically.

### Not authorized

- Deploy;
- production release;
- production migration execution;
- production environment/config changes;
- payment-provider activation;
- production storefront publishing.

---

## 5. Stop conditions — only major owner decisions

Do **not** stop for ordinary engineering choices, reversible UX decisions, PR readiness, CI success, or normal in-scope bugs.

Stop and ask Safwan only when a genuinely consequential decision is required.

### Financial / accounting
- journal/posting behavior change;
- VAT/ZATCA behavior change;
- invoice numbering/immutability change;
- inventory valuation change;
- bundle accounting allocation;
- money/cash-gift accounting.

### Destructive or incompatible data/API
- destructive migration;
- irreversible conversion;
- automatic deletion of merchant data;
- breaking public/internal API contract outside approved scope.

### Security / tenancy
- Tenant Isolation cannot be preserved safely;
- public access cannot be safely bounded;
- implementation requires a broad security model redesign.

### Major product direction conflict
- new evidence contradicts the approved Vertical architecture itself;
- a shared Commerce change would materially affect all tenants in a way not safely reversible.

### Legal / compliance
- a legal/regulatory interpretation is necessary to choose the implementation.

### Production
- deploy;
- production migration;
- production infrastructure/config;
- production payment enablement.

When stopping, provide:
- exact decision;
- evidence;
- 2–3 safe options;
- recommended option;
- what safe work can continue independently.

---

## 6. Non-negotiable boundaries

Preserve:

- accounting accuracy;
- Tenant Isolation;
- security;
- server authority for money/availability;
- inventory truth;
- shipping truth;
- backward compatibility;
- idempotency;
- Arabic/RTL;
- current design system.

Never create parallel truth for:

- Product;
- ProductVariant;
- Inventory;
- Warehouse;
- Customer;
- CommerceCart;
- CommerceCheckout;
- CommerceOrder;
- Payment;
- Fulfillment;
- Invoice;
- Accounting;
- VAT/ZATCA;
- tenant ownership.

Key distinctions:

```text
Commerce Order != Sales Invoice
Reservation != Stock Movement
Gift Sender != Accounting Customer
Recipient merchandising != Delivery Recipient
Delivery Recipient != ERP Partner by default
Occasion != Variant
Collection != Category
Theme != Business Capability
```

---

## 7. Research discipline

Before freezing important architecture/UX contracts, use current original/high-quality sources when useful.

Priority evidence classes:

### Catalog/taxonomy
- Shopify official product taxonomy/metafields/collections/filtering;
- Shopify Search & Discovery;
- Saleor official categories/attributes/collections;
- Medusa official product/category/collection docs where useful.

### UX
- Baymard public evidence where accessible;
- official platform design patterns;
- strong Flowers/Gifts storefront patterns;
- Salla/Zid patterns where useful for Saudi merchant UX;
- W3C/Apple/Google accessibility guidance.

### Flowers/Gifts domain
Research when relevant:
- occasion/recipient shopping;
- personalization;
- gift sender vs purchaser vs recipient;
- add-ons;
- delivery slots/cutoffs;
- same-day promises;
- care/composition/allergen content;
- substitutions;
- failed delivery;
- no-address gifting;
- perishable cancellation/returns;
- corporate gifting;
- bouquet recipe/BOM.

Every important evidence note should distinguish:

- **EXTERNAL EVIDENCE**
- **AWJ REPOSITORY EVIDENCE**
- **AWJ DECISION**
- **INFERENCE**
- **UNKNOWN / DEFERRED**

Competitor behavior must not be represented as internal architecture unless publicly proven.

---

## 8. UX/UI freedom and constraints

The executor has meaningful creative freedom in UX/UI.

Creativity should come from:

- information architecture;
- hierarchy;
- workflow;
- responsive behavior;
- progressive disclosure;
- domain-specific interactions;
- useful states;
- excellent microcopy;
- polished but restrained motion.

AWJ design values:

**clarity > density > speed > trust > consistency > spectacle**

Use:
- current AWJ tokens;
- existing primitives;
- Lucide icons;
- RTL-first layouts;
- visible focus;
- existing radius system;
- current light/dark conventions.

Avoid:
- AI-looking template layouts;
- arbitrary gradients;
- glassmorphism;
- excessive shadows;
- huge empty hero sections;
- random colored icon boxes;
- excessive pills;
- uncontrolled visual novelty.

Storefront presentation may be more expressive than accounting/admin surfaces, but business logic must remain outside themes.

---

# 9. Horizon slice map

## H1 — Business Vertical Foundation

Create the reusable mechanism for a store/business profile.

Current functional targets:
- `general`;
- `flowers_gifts`.

Future identifiers may include grocery, fruits_vegetables, fashion, electronics, but must not be implemented speculatively.

Requirements:
- tenant/store scoped;
- finite platform-owned identifiers;
- additive and backward compatible;
- existing stores default safely;
- profile drives recommended capabilities/presets, not core Commerce authority;
- profile changes do not silently destroy merchant data;
- no arbitrary executable rule system.

Merchant UX should let the user choose a business type in plain language and explain that AWJ prepares recommended settings that remain customizable.

---

## H2 — Taxonomy & Merchandising Foundation

Resolve and implement boundaries among:

- Category;
- Facet / Attribute;
- Occasion;
- Recipient;
- Brand;
- Collection;
- Variant / Option.

Must decide:
- first-class vs governed facet modeling;
- tenant scope;
- localization;
- slug/SEO;
- multi-value assignment;
- active/inactive;
- sort order;
- duplicate prevention;
- indexing/performance;
- Store Builder query semantics;
- storefront filters;
- generic Commerce vs Flowers ownership.

Rules:
- Occasion/Recipient are not Variants;
- Collection is not Category;
- do not build category explosion such as `Flowers > Birthday > For Her > Red > Deliver Today`;
- “Deliver Today” cannot be static taxonomy when availability is dynamic.

If a reusable shared Commerce facet/collection layer is the right architecture, implement it there.

---

## H3 — Gifting Identity & Gift Message

Keep separate:

```text
Purchaser / authenticated customer
Gift Sender Display Identity
Delivery Recipient
Saved Recipient
Delivery Address Snapshot
```

Requirements:
- purchaser remains current Commerce/Customer authority;
- delivery recipient does not become ERP Partner automatically;
- gift sender may differ from purchaser;
- hide-sender/surprise behavior may be merchant configurable;
- saved recipient belongs to gifting/Commerce context, not ERP master data by default;
- order snapshots preserve historical truth.

Gift Message supports bounded server-validated fields such as:
- message;
- sender display name;
- hidden sender flag;
- optional recipient name;
- language only if justified;
- length limits;
- sanitization.

No gift sender field may become accounting identity.

---

## H4 — Personalization

Support merchant-defined customer inputs where justified:

- short text;
- long text;
- image;
- select;
- additional bounded types only with evidence.

Requirements:
- schema belongs to product capability;
- values persist in cart;
- values snapshot into completed order;
- fulfillment/admin can see required values;
- server validation;
- no unsafe generic HTML;
- any price impact is server-authoritative.

Customer uploads must have:
- separate safe ownership/lifecycle if ProductMedia is unsuitable;
- MIME/type validation;
- size limit;
- tenant-safe storage/access;
- retention/deletion behavior.

Do not claim image-composite preview unless it is truly implemented.

---

## H5 — Structured Flowers/Gifts Content

Add structured reusable content where useful.

Flowers:
- composition;
- flower type;
- stem count/size;
- arrangement;
- vase;
- care;
- natural variation.

Food/cake/chocolate:
- flavor;
- servings;
- allergens;
- storage;
- preparation lead time.

Gifts:
- dimensions;
- materials;
- included items;
- personalization instructions.

Do not create one database column per merchant idea.

Prefer bounded content structures or governed attributes.

---

## H6 — Add-ons

Examples:
- chocolate;
- balloon;
- vase;
- greeting card;
- teddy bear;
- topper;
- wrapping.

Model principles:
- reference real Product/ProductVariant;
- price is authoritative from AWJ;
- inventory-aware;
- optional eligibility by product/category/occasion;
- checkout revalidation;
- separate order lines unless current architecture proves another safe representation.

Tests should cover:
- price tampering;
- cross-tenant references;
- inactive/unpublished add-on;
- insufficient inventory;
- invalid relationship;
- checkout revalidation.

---

## H7 — Delivery Scheduling Contract

Build on existing shared authorities:
- CommerceShippingZone;
- ShippingRateService;
- FulfillmentPolicy;
- AvailableToSell;
- InventoryReservation;
- Warehouse/Fulfillment Source.

Do not fork shipping.

Target concepts:
- service level;
- delivery vs pickup;
- date;
- time slot;
- start/end;
- cutoff;
- disabled dates;
- lead time;
- optional capacity;
- destination compatibility;
- product restrictions;
- fulfillment source;
- tenant timezone;
- earliest available fulfillment.

Do not hard-code competitor marketing labels.

Checkout must revalidate availability before completion.

---

## H8 — Availability / Same-day

Derive delivery promise from authoritative state.

Conceptually:

```text
eligible =
  published
  AND sellable
  AND destination supported
  AND fulfillment source valid
  AND ATS/policy allows sale
  AND preparation lead time satisfied
  AND cutoff not passed
  AND eligible service/slot exists
```

Do not duplicate ATS.

Avoid N+1 availability queries.

Expose a reusable shared-Commerce availability seam where appropriate for:
- PDP;
- cards;
- collections;
- Store Builder;
- Deliver Today.

“Deliver Today” must change automatically when eligibility changes.

---

## H9 — Store Builder Flowers Experience

Extend the current builder; do not create another builder.

Candidate data-backed sections:

### Discovery
- Shop by Occasion;
- Shop by Recipient;
- Flower Types;
- Gift Categories;
- Brands.

### Merchandising
- Best Sellers;
- New Arrivals;
- Premium;
- Personalized Gifts;
- Products by Occasion;
- Products by Recipient;
- Deliver Today;
- Curated Collections.

### Editorial/trust
- Delivery Promise;
- Gift Message Explainer;
- Care Guide;
- Why Shop With Us;
- Store Story.

### Seasonal
- Valentine’s;
- Mother’s Day;
- Ramadan;
- Eid;
- Graduation;
- merchant campaigns.

Retain:
- Add;
- Edit;
- Reorder;
- Duplicate;
- Hide/Show;
- Delete;
- Draft;
- Preview;
- Publish;
- Desktop/Tablet/Mobile preview;
- click-to-edit;
- fail-closed normalization.

Sections consume data; they do not own business truth.

---

## H10 — Storefront Discovery UX

Provide a purpose-built gifting discovery experience across:

- category;
- occasion;
- recipient;
- facets;
- brand;
- collection;
- search;
- destination/availability context where safe.

Priorities:
- mobile;
- Arabic RTL;
- visual merchandising;
- fast scanning;
- accessible filtering;
- empty/loading/error states;
- unavailable states.

Do not use competitor copyrighted assets.

---

## H11 — Flowers/Gifts PDP

Capability-driven blocks may include:

1. media;
2. title;
3. price;
4. variants;
5. structured attributes/composition;
6. destination;
7. earliest delivery;
8. date/slot;
9. personalization;
10. gift message;
11. add-ons;
12. quantity;
13. add to cart;
14. care/allergen/content;
15. fulfillment notes;
16. recommendations.

Do not render irrelevant empty blocks.

Use progressive disclosure on mobile.

---

## H12 — Cart & Checkout Gifting UX

Reuse current server-authoritative cart/checkout.

Preserve:

```text
Cart line
 ├ Product / Variant
 ├ Personalization
 ├ Add-ons
 └ relevant gifting context

Checkout
 ├ Purchaser/contact
 ├ Delivery Recipient
 ├ Delivery Address
 ├ Service/date/slot
 ├ Gift Message
 ├ Payment
 └ Confirmation
```

Do not blindly copy FNP’s step order.

Choose the best sequence based on current AWJ constraints and UX evidence.

Must preserve:
- server-authoritative totals;
- server-authoritative shipping;
- idempotent completion;
- availability revalidation;
- immutable order snapshots;
- no ERP jargon in shopper UI.

---

## H13 — Account / Saved Recipient / Order Experience

Reuse existing shared Commerce account/order capabilities.

Investigate safe additions for:
- saved recipients;
- relationship with saved addresses;
- order history;
- fulfillment timeline;
- gifting-context visibility;
- reorder only when semantics are safe;
- wishlist only if shared Commerce capability is ready.

Do not create Flowers-only copies of generic account capabilities.

---

## H14 — Vertical Onboarding & Defaults

When Flowers & Gifts is selected, AWJ may prepare safe editable defaults such as:

- recommended navigation;
- starter occasions;
- starter recipient dimensions;
- recommended facets;
- gift message;
- personalization;
- add-on setup prompts;
- delivery configuration prompts;
- starter builder sections;
- generic Flowers & Gifts presentation preset.

Defaults are editable.

Changing vertical must not silently delete merchant data.

---

## H15 — Cross-Horizon Integration / Polish

After safe slices are merged:

1. sync latest main;
2. inspect end-to-end flow;
3. find integration inconsistencies;
4. fix only Horizon-related issues;
5. run visual verification;
6. run relevant broader tests;
7. review performance;
8. review Tenant Isolation;
9. review accessibility;
10. review RTL/LTR;
11. review mobile;
12. review backward compatibility;
13. review docs.

Create and merge a polish PR only if real integration changes are required.

---

# 10. Explicit evidence-gated domains

The following are NOT automatic implementation requirements.

## G1 — Fixed/configurable bundles
Research component inventory, price allocation, order representation and fulfillment first.

## G2 — Bouquet BOM / Recipe / Assembly
High risk because it may affect:
- component inventory consumption;
- costing;
- labor;
- waste/yield;
- substitution;
- preparation;
- profitability.

Do not casually model as an ordinary bundle.

## G3 — Substitution
Requires customer promise, florist permission, audit, value/price rules, notification and fulfillment semantics.

## G4 — Failed delivery
Requires status, retry/redelivery, fees, cancellation/refund boundaries.

## G5 — No-address gifting
Requires privacy, recipient contact workflow, timing, expiry/no-response and fulfillment behavior.

## G6 — Money bouquets / cash gifts
Very high risk. Requires legal/accounting/VAT/cash-custody/refund/reconciliation evidence.

Do not implement embedded cash value as ordinary merchandise.

## G7 — Corporate gifting
Requires multi-recipient/campaign/B2B orchestration separate from ordinary cart checkout.

## G8 — Returns/cancellation
Perishable and personalized products require dedicated policy evidence.

---

# 11. Testing standard

Run progressively:
1. focused tests;
2. relevant integration tests;
3. broader suites when justified.

Mandatory where applicable:

### Tenant Isolation
- cross-tenant reads denied;
- cross-tenant mutations denied;
- public storefront cannot resolve foreign IDs;
- foreign product/variant/add-on/media/recipient/slot rejected.

### Taxonomy
- multi-value;
- inactive;
- localization;
- filtering;
- duplicates;
- tenant scope.

### Gifting
- purchaser/sender/recipient distinction;
- hidden sender;
- snapshots.

### Personalization
- validation;
- upload security;
- ownership;
- cart persistence;
- snapshot.

### Add-ons
- tampered price rejected;
- inventory;
- eligibility;
- checkout revalidation.

### Delivery
- timezone;
- cutoff;
- disabled date;
- lead time;
- destination;
- fulfillment source;
- capacity if implemented;
- race/concurrency if relevant.

### Same-day
- valid case;
- cutoff passed;
- unsupported destination;
- no ATS;
- no slot;
- unpublished product.

### Backward compatibility
- generic stores;
- existing storefront;
- existing cart;
- existing checkout;
- ERP/POS unaffected.

Never weaken security, accounting, Tenant Isolation or financial tests merely to make CI green.

---

# 12. Performance standard

Inspect:
- facet queries;
- occasion/recipient mappings;
- collections;
- builder feeds;
- storefront lists;
- delivery eligibility;
- same-day calculations.

Prefer:
- set-based operations;
- eager loading;
- indexing;
- server pagination/filtering;
- batch availability evaluation.

Do not introduce uncontrolled per-product query loops.

---

# 13. Visual and accessibility QA

For changed UI, verify where relevant:

- 390 mobile;
- 430 mobile;
- tablet portrait;
- tablet landscape;
- 1024;
- 1440;
- Arabic RTL;
- English LTR;
- light/dark where supported;
- touch targets;
- keyboard for admin surfaces;
- horizontal overflow;
- long Arabic labels;
- empty/loading/error;
- unavailable state;
- personalization;
- add-ons;
- delivery selection;
- cart/checkout.

Accessibility minimum:
- semantic labels;
- visible focus;
- keyboard reachability;
- sufficient contrast;
- color not sole state indicator;
- sheet/modal focus handling;
- accessible upload;
- error association;
- icon labels;
- logical RTL behavior;
- reduced motion when animation exists.

---

# 14. CI behavior

Avoid wasteful polling.

On failure:
1. inspect failing job;
2. inspect relevant logs;
3. classify as Horizon-caused vs unrelated;
4. fix Horizon-caused failures;
5. do not repair unrelated broad debt;
6. rerun only necessary checks.

Never bypass a meaningful security/financial/Tenant Isolation failure.

---

# 15. Living progress log

The authoritative progress ledger is:

`docs/plans/store/AWJ_FLOWERS_HORIZON_1_PROGRESS.md`

After every merged slice, update it with:

- Slice;
- Status;
- Base SHA;
- Branch;
- PR;
- Head SHA;
- Merge SHA;
- What reached main;
- Tests;
- CI;
- Visual verification;
- Risks;
- Deferred items;
- Next slice.

The progress log is the primary handoff source for “where are we?” and must be updated before moving materially beyond a completed slice.

---

# 16. Required final report

At completion create:

`docs/plans/store/AWJ_FLOWERS_HORIZON_1_FINAL_REPORT.md`

It must contain:

- Executive Summary;
- final architecture;
- Business Vertical behavior;
- final taxonomy model;
- gifting identity;
- personalization;
- add-ons;
- delivery/availability/same-day;
- Store Builder;
- storefront;
- cart/checkout;
- account/saved recipient work;
- UX/UI decisions and evidence;
- accessibility;
- Tenant Isolation;
- performance;
- exact tests/results;
- CI per PR;
- all changed areas;
- every branch/PR/Base SHA/Head SHA/Merge SHA;
- risks;
- all deferred high-risk domains;
- next recommended Horizon.

Production section must explicitly state:

```text
MERGES: PERFORMED AS AUTHORIZED
DEPLOY: NOT PERFORMED
PRODUCTION: NOT CHANGED
```

---

# 17. Definition of Done

The Horizon is done only when the safe scope has been:

```text
researched
→ designed
→ implemented
→ tested
→ visually verified
→ reviewed
→ PR-reviewed
→ CI-checked
→ merged
→ integrated
→ cross-reviewed
→ documented
```

It is not complete merely because:
- architecture docs exist;
- models exist;
- UI mocks exist;
- a PR is open;
- one slice is merged.

Safe implementation should continue automatically until all non-gated Horizon slices are complete.

---

# 18. Final execution directive

Normal behavior:

```text
inspect
→ research
→ plan
→ build
→ test
→ verify
→ review
→ PR
→ CI
→ merge
→ sync main
→ update progress
→ continue
```

Do not repeatedly ask Safwan whether to continue.

Use creativity in UX/UI.
Use restraint in core architecture.
Use evidence before assumptions.

Protect accounting, security, Tenant Isolation, inventory truth, server authority and backward compatibility.

Only interrupt Safwan for a major decision listed in the Stop Conditions.

**Merge safe Horizon slices.**
**Do not deploy.**
