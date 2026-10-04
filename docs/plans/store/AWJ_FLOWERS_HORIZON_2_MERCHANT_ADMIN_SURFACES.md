# AWJ Flowers & Gifts — Horizon 2: Merchant Admin Surfaces

**Status:** Authoritative execution plan  
**Date:** 2026-10-04  
**Repository:** `safwan5001-source/Nebrax`  
**Planning Base:** `main` @ `6ded662bfada8f72f5ebf321dcf27b08be7939c1`  
**Predecessor:** `AWJ_FLOWERS_HORIZON_1_FINAL_REPORT.md`  
**Scope:** Turn the Flowers & Gifts capabilities delivered in Horizon 1 into a complete merchant-operated admin experience inside AWJ.  
**Execution model:** Sync → Inspect → Focused research → Freeze contract → Design UX → Build → Test → Visual QA → Review → PR → CI → Merge → Sync → Continue  
**Merge authorization:** Authorized inside this Horizon when the gates below pass.  
**Manual Deploy / Production changes:** NOT authorized.

---

## 0. Purpose

Horizon 1 proved and delivered the core Flowers & Gifts capabilities end to end: taxonomy, gifting identity, personalization, structured content, add-ons, delivery scheduling, same-day promise, builder sections, storefront UX, checkout, onboarding defaults, presentation pack, and a real-API integration journey.

The largest remaining product gap is **merchant adoption**: several capabilities are available through APIs and the storefront but do not yet have complete merchant-facing administration screens.

This Horizon closes that gap.

It does **not** create a second commerce engine, duplicate product truth, duplicate inventory truth, or introduce Flowers-only accounting.

The merchant should be able to configure and operate the vertical from the AWJ dashboard without manual API access.

---

## 1. Authority and source hierarchy

Before implementing each slice, the executor must read only the relevant current sources.

Authority order:

1. current repository code and tests;
2. merged ADRs and Commerce boundaries;
3. `AWJ_FLOWERS_HORIZON_1_FINAL_REPORT.md`;
4. `AWJ_FLOWERS_HORIZON_1_PROGRESS.md`;
5. `AWJ_FLOWERS_GIFTS_VERTICAL_V1.md`;
6. this Horizon for sequencing and execution.

For UI implementation, the repository design tokens and current app shell are authoritative. The following principles are mandatory and reflect the approved AWJ design system:

- daily business/accounting tool first;
- clarity, density, speed, trust, consistency before spectacle;
- RTL first; English is the mirrored equivalent;
- existing semantic tokens are the source of truth;
- no raw ad-hoc colors in components;
- one primary identity color for actions/links/focus;
- semantic red/green/orange only for real meaning, never decoration;
- no gradients, glassmorphism, glow, heavy shadows, colored icon boxes, or AI-template aesthetics;
- Lucide icons only, clean and restrained;
- explicit empty/loading/error/success states;
- desktop productivity first, with deliberate mobile adaptation;
- visible focus and keyboard accessibility;
- default radius remains consistent with the system;
- all UI must use existing AWJ primitives before inventing new ones.

Implementation must verify current `web/src/app/globals.css`, `web/tailwind.config.ts`, shared UI primitives, and the current module patterns before styling.

---

## 2. Owner intent

The dashboard experience should feel like one coherent AWJ product, not a collection of developer forms.

The merchant should be able to answer:

- Is gifting enabled?
- What does the shopper have to enter?
- When can I deliver?
- What windows are open?
- Which warehouse fulfils same-day orders?
- How long does this product need to prepare?
- What personalization does this product accept?
- Which add-ons can a shopper choose?
- What content appears on the PDP?
- What is still missing before this Flowers store is fully configured?

Every screen must expose the **real persisted configuration** and must not invent local “configured” flags when status can be derived.

---

## 3. Executor behavior

The intended executor is Claude Code or another repository-capable coding agent.

For every slice:

1. sync latest `origin/main`;
2. record exact Base SHA;
3. inspect only relevant code/docs/tests;
4. verify existing backend contracts before changing API;
5. perform focused external UX research only when it materially improves a workflow or prevents a bad contract;
6. write or update an ADR when a reusable product/architecture decision is made;
7. design the information architecture and states before coding the UI;
8. implement the smallest coherent slice;
9. run focused tests first, then the relevant broader suites;
10. perform browser/visual QA for every UI slice;
11. review Tenant Isolation, RBAC, backward compatibility, and server authority;
12. open PR;
13. resolve valid findings;
14. inspect only relevant CI failures first;
15. merge when gates pass;
16. record Base/Head/Merge SHA and evidence in the progress ledger;
17. sync main and continue automatically.

Do not ask Safwan whether to continue between ordinary safe slices.

Do not open a large parallel stack of dependent PRs. Prefer one active slice at a time unless the work is truly independent.

---

## 4. Merge authorization and deployment reality

Safe merges inside this Horizon are authorized when all applicable gates pass.

A merge is allowed only when:

- scope matches the Horizon;
- no unrelated refactor;
- no unresolved meaningful review thread;
- focused tests pass;
- relevant integration tests pass;
- CI is green, or an unrelated known flake is proven and handled according to repository precedent;
- Tenant Isolation is explicitly reviewed/tested where applicable;
- RBAC is explicit;
- no client-side price/availability authority is introduced;
- backward compatibility is reviewed;
- UI work has browser evidence in Arabic RTL and English LTR;
- mobile and desktop are both checked;
- keyboard/focus and error states are checked;
- migrations, if any, are additive and safe.

### Manual deploy is not authorized

The executor must not trigger:

- Railway deploy/redeploy;
- production migration execution;
- production environment/config changes;
- payment activation;
- production storefront publication.

### Important: auto-deploy from main

Railway may automatically deploy merges to `main`.

Therefore the executor must **never claim “Production unchanged” merely because it did not manually deploy**.

After each merged slice:

- record whether merge-to-main can trigger CI/CD;
- if production status is observable with available tooling, record the actual result;
- distinguish:
  - **Manual deploy:** not performed;
  - **Automatic CI/CD deployment:** observed / not observed / unknown;
  - **Production verification:** performed / not performed / unknown.

If a production-impacting auto-deploy creates a real safety concern, stop and report it.

---

## 5. Stop conditions

Do not stop for normal UI decisions, reversible layout choices, ordinary bugs, or PR readiness.

Stop only for consequential owner decisions.

### Financial / accounting
- journal/posting change;
- VAT/ZATCA change;
- invoice numbering/immutability change;
- inventory valuation change;
- money/cash-gift accounting;
- bundle allocation/accounting.

### Data/API
- destructive migration;
- irreversible conversion;
- automatic merchant-data deletion;
- breaking shared API contract outside approved scope.

### Security / tenancy
- Tenant Isolation cannot be preserved;
- a picker or endpoint would expose cross-tenant information;
- broad authorization redesign is required.

### Product architecture
- a proposed admin surface requires a new shared Commerce authority rather than exposing an existing one;
- evidence contradicts the existing vertical architecture.

### Production
- manual deploy;
- production migration;
- production config;
- production payment activation.

When stopping, provide the decision, evidence, 2–3 options, recommendation, and safe work that can continue.

---

## 6. UI/UX quality bar — mandatory for every UI slice

UI quality is a **merge gate**, not a polish task at the end.

Every UI slice must explicitly cover:

### 6.1 Information architecture
- clear page title and scope;
- primary action obvious;
- related controls grouped semantically;
- advanced settings progressively disclosed;
- no developer/API jargon when merchant language exists;
- no duplicate configuration surfaces for the same authority.

### 6.2 States
Every async surface must deliberately handle:
- initial loading;
- empty state;
- populated state;
- saving;
- saved/success feedback;
- validation error;
- server error;
- stale/conflict state when relevant;
- permission/read-only state;
- disabled/unavailable dependency state.

No dead buttons. No silent failure.

### 6.3 Responsive behavior
Verify at minimum:
- Arabic RTL mobile ~390/430 px;
- English LTR mobile;
- tablet ~1024 px when layout materially changes;
- desktop ~1440 px.

Desktop admin screens should preserve useful information density.

On mobile:
- tables may become cards or stacked rows where needed;
- destructive/secondary actions must remain reachable;
- dialogs/sheets must fit the viewport;
- no horizontal overflow.

### 6.4 Accessibility
- visible focus;
- semantic labels;
- correct field associations;
- `aria-invalid` and described errors;
- keyboard operation for dialogs, selects, reorder controls, and tabs;
- touch targets appropriate for mobile;
- meaning never conveyed by color alone.

### 6.5 Visual system
Use current AWJ tokens and primitives.

Avoid:
- decorative gradients;
- giant empty hero areas;
- excessive cards;
- excessive pills;
- random badges;
- colored icon containers;
- ornamental shadows;
- “AI dashboard” layouts.

Use icons only when they improve scanability.

### 6.6 Visual QA evidence
Before merge of a UI slice:
- run the relevant browser/e2e path;
- capture or review the actual rendered state;
- test at least one error/empty state when relevant;
- verify RTL spacing and mirrored controls;
- verify dark mode if the changed surface is used in both modes;
- record the result in the progress log.

A unit test alone is not sufficient UI verification.

---

# 7. Horizon slice map

## H2-1 — Gift Policy Admin

Build the merchant UI for the existing gift policy contract.

Expose only existing supported fields, for example:
- enable/disable gifting;
- message enabled/required where supported;
- message max length;
- sender display behavior;
- hide-sender behavior;
- recipient phone requirement;
- any other existing bounded policy fields.

Requirements:
- no new Flowers-only truth;
- load existing persisted policy;
- safe defaults;
- clear explanation of shopper effect;
- validation mirrors backend limits;
- save is server authoritative;
- dirty state and save feedback;
- read-only behavior for insufficient permissions;
- “disabled” state must not delete existing values unless backend semantics already do so.

UX direction:
- use a compact settings form;
- preview/summary text may explain what shoppers will see, but must not become a second renderer;
- avoid one-card-per-field visual noise.

---

## H2-2 — Delivery Schedule Admin

Build the main settings surface for the existing delivery scheduling contract.

Expose supported configuration such as:
- enabled/disabled;
- schedule required/optional;
- timezone;
- lead time;
- cutoff;
- booking horizon;
- delivery/pickup methods where the contract supports them.

Requirements:
- server-authoritative values;
- dependency warnings;
- show when same-day cannot work because prerequisites are missing;
- do not invent a delivery engine in the UI.

UX:
- operational language first;
- group “availability rules” separately from “time windows” and “exceptions”;
- explain timezone prominently without technical jargon.

---

## H2-3 — Delivery Windows & Capacity

Build the merchant management UI for existing delivery windows.

Support:
- create;
- edit;
- enable/disable;
- weekday selection;
- start/end time;
- method where applicable;
- capacity where supported;
- ordering if supported;
- delete with safe dependency handling.

Requirements:
- prevent impossible ranges client-side, but backend remains authoritative;
- show conflicts/errors returned by server;
- no fake capacity calculations in browser;
- preserve stable IDs and history semantics.

UI:
- desktop dense list/table;
- mobile cards/stacked rows;
- quick scan of day, time, method, capacity, status;
- avoid oversized cards.

---

## H2-4 — Blocked Dates & Exceptions

Build administration for blocked dates / schedule exceptions already supported by the backend.

Support:
- list;
- add;
- remove/disable as contract allows;
- clear merchant-facing explanation.

Requirements:
- date interpretation follows channel timezone;
- do not silently reinterpret dates in browser timezone;
- duplicate/conflict handling;
- errors are explicit.

---

## H2-5 — Fulfillment Warehouse Setup

Expose the existing fulfilment source/warehouse requirement needed by delivery promises and same-day eligibility.

Requirements:
- use current Warehouse/Fulfillment authorities;
- tenant-safe picker;
- branch/company scope consistent with current Commerce semantics;
- no duplicate warehouse model;
- clearly state why a warehouse is required for deliver-today;
- do not claim same-day availability until backend says so.

If the underlying assignment contract is incomplete, stop only if a shared-architecture decision is genuinely required; otherwise implement the smallest existing seam.

---

## H2-6 — Product Preparation Time

Expose the existing product preparation-time capability in the product workspace.

Merchant should be able to understand:
- whether preparation time is configured;
- how it affects earliest delivery;
- what unit/range the backend contract permits.

Requirements:
- keep server truth;
- no client date promise calculation;
- respect permissions;
- clear default/unset state.

---

## H2-7 — Product Personalization Admin

Build the product-workspace editor for the existing personalization contract.

Support current field types only:
- text;
- textarea;
- select.

Support existing attributes:
- label;
- key/slug;
- required;
- help text where supported;
- max length;
- select options;
- order;
- active state if supported.

Requirements:
- no arbitrary HTML;
- no unsupported upload field;
- validate keys exactly as backend does, including hyphenated slugs;
- warn when changing a field could affect carts if the API exposes such semantics;
- do not invent price modifiers.

UX:
- compact reorderable field list;
- inline summary;
- focused editor for one field;
- preview can illustrate control shape, but backend contract remains truth.

---

## H2-8 — Product Add-ons Admin

Build the merchant editor for product add-on relationships.

Requirements:
- picker references real Product/ProductVariant;
- tenant-safe search;
- never accept/store client price;
- show current authoritative product price only as read-only context if useful;
- max quantity and activation according to API;
- prevent self-reference and invalid relationships;
- reflect unavailable/unpublished products honestly;
- safe removal.

UX:
- searchable picker;
- selected add-ons in a dense list;
- name, variant, availability/status context;
- avoid image-heavy layout unless product media genuinely improves identification.

---

## H2-9 — Structured Product Content Admin

Build the editor for Horizon 1 content blocks.

Support only governed block types already implemented, such as:
- composition;
- care;
- natural variation;
- included items;
- dimensions;
- materials;
- allergens;
- storage;
- preparation notes;
- personalization instructions.

Requirements:
- plain text only;
- ordered;
- active/inactive where supported;
- no arbitrary block type invention;
- no raw HTML.

UX:
- content-type picker from closed list;
- reorder;
- concise guidance text;
- no card explosion.

---

## H2-10 — Unified Product Gifting Workspace

Unify product-specific Flowers capabilities into a coherent product workspace experience.

The merchant should not have to discover unrelated hidden routes.

Provide a clear information architecture around:
- preparation;
- personalization;
- add-ons;
- structured content.

Rules:
- reuse H2-6/7/8/9 components;
- do not create new persistence;
- existing generic product editing remains intact;
- non-Flowers products/stores are not cluttered unnecessarily;
- capability visibility should follow the vertical/capability model.

Deliverable includes a deliberate tab/section strategy consistent with the existing product workspace.

---

## H2-11 — Vertical Setup Center V2

Upgrade the H14 checklist into an operational setup center.

For each capability:
- show real derived status;
- explain what is missing;
- provide a working deep link to the correct admin surface;
- never show a dead link;
- show “not applicable” only when the contract proves it;
- never store a duplicate completion flag.

Recommended groups:
- Catalog & discovery;
- Gifting;
- Delivery;
- Products;
- Storefront presentation.

The merchant should be able to understand store readiness in under a minute.

---

## H2-12 — Merchant Onboarding Flow

Build a guided setup flow for a Flowers & Gifts merchant using the real configuration screens.

Target journey:
1. choose/confirm Flowers & Gifts;
2. starter occasions/recipients;
3. gift policy;
4. delivery setup;
5. fulfilment warehouse;
6. configure at least one product capability;
7. builder/theme readiness.

Rules:
- no automatic activation of policies without explicit merchant action;
- no data deletion on exit/back;
- progress derived from real configuration;
- user can leave and resume safely;
- use progressive disclosure;
- do not force completion before the merchant can use unrelated AWJ modules.

---

## H2-13 — Permissions / RBAC / Tenant Isolation Pass

Perform a dedicated integration pass across all new admin surfaces.

Verify:
- permissions for read vs manage;
- non-revealing 404/403 behavior consistent with repo convention;
- cross-tenant IDs rejected;
- pickers cannot enumerate foreign tenant data;
- branch scoping is correct;
- stale form submissions do not apply to another selected product/store;
- no tenant IDs accepted from browser when server context should determine them.

Add focused regression tests for any gap found.

---

## H2-14 — Admin UX / RTL / Mobile Polish

Run a deliberate cross-surface UI quality pass.

Review:
- hierarchy;
- density;
- labels/microcopy;
- loading/skeletons;
- empty states;
- validation;
- server errors;
- toasts;
- dialogs/sheets;
- keyboard;
- focus;
- mobile action placement;
- RTL;
- LTR;
- dark mode where applicable;
- no overflow;
- consistent destructive confirmation;
- consistent unsaved-change behavior.

Do not redesign unrelated AWJ modules.

Fix only Horizon-related inconsistencies and shared primitives when the fix is safe and clearly reusable.

---

## H2-15 — Real Merchant Journey Contract

Create an end-to-end merchant administration journey using real APIs and real UI contracts.

Suggested journey:
- Flowers vertical exists;
- apply/inspect starters;
- enable gift policy;
- configure delivery;
- create/edit delivery window;
- add blocked date;
- assign fulfilment warehouse;
- set preparation time;
- add personalization;
- add add-on;
- add structured content;
- verify Setup Center readiness;
- verify public/storefront contract reflects the merchant settings.

The journey must catch contract drift between dashboard clients and backend APIs.

Where practical:
- backend fixture/contract;
- web client parses the same contract;
- browser smoke path exercises the actual admin UI.

No production data.

---

## H2-16 — Cross-Horizon Integration & Final Report

Final closure slice.

Tasks:
1. sync latest main;
2. inspect all Horizon 2 admin flows;
3. run the full merchant journey;
4. identify integration inconsistencies;
5. fix only Horizon-related issues;
6. verify non-Flowers backward compatibility;
7. verify Tenant Isolation/RBAC;
8. verify RTL/LTR/mobile/desktop;
9. inspect query/performance regressions where relevant;
10. write `AWJ_FLOWERS_HORIZON_2_FINAL_REPORT.md`.

Final report must include:
- each slice;
- branch;
- PR;
- Base SHA;
- Head SHA;
- Merge SHA;
- tests;
- CI;
- visual QA;
- security/Tenant Isolation review;
- backward compatibility;
- risks;
- deferred items;
- actual deployment state, distinguishing manual deploy from automatic CI/CD.

---

## 8. Deferred / evidence-gated domains

These remain outside automatic Horizon 2 implementation unless separately evidenced and safely contracted:

- fixed/configurable bundles;
- bouquet BOM / recipe / assembly;
- substitutions;
- failed-delivery business rules beyond existing scheduling;
- no-address gifting;
- recipient notification;
- customer file/image upload for personalization;
- money bouquets / cash gifts;
- corporate gifting;
- perishable/personalized return and cancellation policy;
- saved recipients until the customer-identity/address authority is ready;
- reorder until server re-pricing/availability semantics are ready;
- wishlist until shared Commerce capability is ready;
- online/card payment activation or gateway fee/VAT rules;
- App Builder/mobile gifting administration unless explicitly added to a future Horizon.

---

## 9. Required tests by change type

### Backend/API
- focused feature tests;
- tenant isolation;
- permissions;
- invalid IDs;
- malformed inputs;
- backward compatibility;
- concurrency/locking only where the existing contract requires it;
- sqlite + PostgreSQL in CI.

### Web admin
- client mapping tests;
- component behavior;
- stale-request/race protection where relevant;
- validation;
- read-only permission state;
- full web suite when shared UI/client code changes.

### Visual
For every UI PR:
- Arabic RTL mobile;
- Arabic RTL desktop;
- English LTR mobile;
- English LTR desktop;
- tablet when layout changes materially;
- no horizontal overflow;
- relevant empty/error/disabled state;
- visible keyboard focus.

---

## 10. Progress discipline

Use:

`docs/plans/store/AWJ_FLOWERS_HORIZON_2_PROGRESS.md`

Update it after every merged slice.

Never rely only on chat history.

Each slice entry must include:
- status;
- Base SHA;
- branch;
- PR;
- Head SHA;
- Merge SHA;
- implementation summary;
- tests/results;
- CI;
- visual QA;
- Tenant Isolation/RBAC;
- backward compatibility;
- findings/risks;
- deferred;
- next slice;
- deployment observation.

---

## 11. Definition of done

Horizon 2 is complete when:

- H2-1 through H2-16 are merged or explicitly documented as evidence-gated/deferred;
- a merchant can configure the shipped Flowers capabilities through AWJ UI without manual API calls for the in-scope surfaces;
- Setup Center deep-links only to real working screens;
- the real merchant journey passes;
- non-Flowers tenants remain backward compatible;
- Tenant Isolation/RBAC tests pass;
- Arabic RTL and English LTR are visually verified;
- mobile and desktop are usable;
- final report exists;
- deployment state is reported factually.

---

## 12. Final execution instruction

Once this Horizon is merged, the executor should start from the latest `main`, read this document and the progress ledger, and continue autonomously through H2-1 → H2-16.

Do not re-run the broad Horizon 1 investigation.

Do not open speculative features.

Do not sacrifice UI quality to “finish” a slice.

**A screen that technically saves data but is confusing, visually inconsistent, inaccessible, or broken on RTL/mobile is not done.**
