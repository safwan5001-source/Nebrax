# AWJ POS UI V3 — Autonomous Horizon Plan

**System:** AWJ Autonomous Engineering Horizon  
**Horizon:** AWJ POS UI V3  
**Status:** PROPOSED — owner review/merge required before execution launch  
**Prepared:** 2026-10-02  
**Planning Base SHA:** `c2fcc694d9220e8c74989211c55dab655bc96a1e`  
**Primary design source:** `docs/plans/design/AWJ_POS_UI_V3_VISUAL_DIRECTION.md`  
**Execution protocol:** `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`  
**Chosen executor for this Horizon:** Grok

---

## 1. Horizon objective

Deliver the complete **AWJ POS UI V3** redesign over the existing mature POS foundation as one autonomous engineering Horizon, while preserving the current accounting, checkout, session, inventory, security and tenant-isolation contracts.

The Horizon is a single owner-approved body of work, but it must be executed through dependency-safe sequential PR slices rather than one giant PR.

The target outcome is a cashier experience that is:

- visually attractive and clearly distinct from AWJ Ledger/ERP;
- fast under real cashier pressure;
- touch-first where appropriate;
- equally safe for keyboard, scanner and hybrid operation;
- responsive across desktop, POS displays, iPad and mobile;
- Arabic RTL first, with correct English LTR mirroring;
- compatible with Light/Dark through AWJ Floor-specific tokens;
- visually modern without decorative or AI-looking excess.

---

## 2. Source of truth and launch baseline

The approved UI/UX direction is:

`docs/plans/design/AWJ_POS_UI_V3_VISUAL_DIRECTION.md`

The implementing agent must:

1. fetch latest `origin/main` before execution;
2. report the exact execution Base SHA;
3. confirm the approved V3 visual-direction document exists on that Base;
4. inspect only the current POS files/contracts required for the active slice;
5. use the latest merged implementation report from the preceding slice instead of restarting broad discovery.

The Planning Base SHA above is evidence for this Horizon document only. It is **not** a fixed implementation base.

---

## 3. Horizon boundary

### In scope

- Floor workspace shell and cashier topbar;
- approximately 65/35 catalog/cart desktop composition;
- horizontal category navigation;
- Compact / Standard / Visual product-density modes;
- simplified product-tile information hierarchy;
- added-to-cart visual state;
- cart visual hierarchy and touch quantity controls;
- selected-line editing treatment;
- totals / Pay hierarchy;
- terminal-like Payment Workspace V3;
- contextual numeric entry/keypad;
- split-payment visual treatment;
- Paid / Remaining / Change hierarchy;
- responsive layouts for desktop, compact desktop, iPad landscape, portrait tablet and mobile;
- full-height Cart workspace on portrait/mobile;
- sticky transaction bar on narrow layouts;
- Light/Dark Floor-specific presentation;
- Arabic RTL / English LTR visual parity;
- Touch / Keyboard-Mouse / Hybrid / scanner regression protection;
- visual QA and final polish;
- durable per-slice implementation reports and final Horizon report.

### Explicitly out of scope

- accounting semantic changes;
- invoice authority changes;
- tax-calculation changes;
- ZATCA changes;
- inventory-posting changes;
- checkout financial-authority changes;
- payment-accounting semantic changes;
- session-lifecycle redesign;
- tenant/branch isolation changes;
- RBAC redesign;
- database schema changes;
- public API redesign;
- delivery-platform accounting changes;
- broad POS architecture refactoring;
- unrelated cleanup;
- Production Deploy / Production Release.

---

## 4. Locked invariants

The following remain authoritative throughout the Horizon:

1. Existing POS checkout/accounting authority remains unchanged.
2. Existing session lifecycle remains unchanged.
3. Tenant and Branch Isolation must not weaken.
4. RBAC remains server-authoritative.
5. Scanner/HID behavior remains functional.
6. Touch, Keyboard-Mouse, AUTO and HYBRID modes remain supported.
7. Responsive layouts are views over one canonical POS state, not separate business-state forks.
8. Payment split/deferred/change semantics remain unchanged unless a Decision Gate is raised.
9. Existing checkout idempotency and recovery behavior must remain intact.
10. Product variants, units, discounts and price-override policy remain intact.
11. Returns/exchange/receipt/cash-drawer behavior must remain intact.
12. Visual redesign must not silently remove operational capability.
13. Backward compatibility is required.
14. Merge does not imply Deploy.

---

## 5. Existing behavior to preserve

The Horizon must preserve the current working foundation, including:

- dedicated POS workspace;
- sessions;
- cart/session recovery;
- held carts;
- recent invoices;
- customer selection;
- barcode scanning;
- HID scanner behavior;
- keyboard navigation;
- Touch / AUTO / KEYBOARD_MOUSE / HYBRID modes;
- product variants;
- product units;
- favorites;
- discounts;
- price override;
- configured payment methods;
- split tender;
- deferred payment;
- returns;
- exchange;
- receipts;
- printing;
- cash drawer integration;
- network/offline state;
- checkout recovery/idempotency.

Where the V3 design needs a different visual composition, prefer reuse/recomposition of the existing behavior rather than rewriting its domain implementation.

---

## 6. Approved visual decisions

These decisions are already approved in the source design document and are not open implementation questions:

### Floor identity
POS is a specialized **Floor Workspace**, not a visual clone of Ledger/ERP.

### Sale workspace
Desktop/landscape target is approximately:

- 65% catalog;
- 35% cart.

The ratio is responsive, not a rigid pixel rule.

### Category navigation
Default is a horizontal, scrollable category strip.

Large category sets use overflow/search rather than a permanent narrow category rail.

### Product density
Three modes:

- Compact;
- Standard;
- Visual.

**Standard is the V3 default.**

### Cart surface
Default is Light / high-contrast Floor surface.

The whole cart is not permanently dark.

A stronger local Outcome surface may emphasize totals/payment result.

### Theme
POS follows the user's AWJ Light/Dark preference with Floor-specific tokens/surfaces.

No independent POS theme engine in V3.

### Portrait/mobile cart
Products and Cart are explicit workspaces.

Cart is a **full-height transaction workspace**, not the main flow inside a partial-height sheet.

### Payment
Payment is a dedicated terminal-like workspace with:

- dominant Amount Due;
- large payment-method targets;
- contextual numeric entry;
- Paid / Remaining / Change;
- one dominant Confirm Payment action.

---

## 7. Dependency-safe task queue

| Order | Task | Depends on | Primary outcome |
|---|---|---|---|
| 0 | POS-UI-V3-EVIDENCE | merged Horizon plan | Current-main implementation map; exact component reuse points; no broad rediscovery |
| 1 | POS-UI-V3-1 | EVIDENCE | Floor shell + topbar + responsive 65/35 foundation |
| 2 | POS-UI-V3-2 | V3-1 post-merge PASS | Product catalog + horizontal categories + density modes |
| 3 | POS-UI-V3-3 | V3-2 post-merge PASS | Cart hierarchy + touch controls + totals/Pay |
| 4 | POS-UI-V3-4 | V3-3 post-merge PASS | Payment Workspace V3 |
| 5 | POS-UI-V3-5 | V3-4 post-merge PASS | Touch/responsive portrait/mobile compositions |
| 6 | POS-UI-V3-6 | V3-5 post-merge PASS | Full visual QA, interaction regression, final polish |
| 7 | POS-UI-V3-CLOSE | V3-6 post-merge PASS | Final Horizon report + durable closure state |

Dependent work does not unlock until the prerequisite slice is merged and its post-merge review passes.

---

## 8. POS-UI-V3-EVIDENCE — bounded evidence pass

### Goal

Map the approved V3 visual direction onto the latest current POS implementation without repeating a broad POS investigation.

### Inspect only what is needed

At minimum:

- POS page/layout root;
- current topbar;
- responsive layout helpers;
- product tile/category presentation;
- cart line controls/editor;
- payment workspace;
- interaction-mode policy;
- scanner/focus hooks;
- existing POS visual/E2E tests;
- Floor posture/tokens currently available.

### Deliverable

Create an evidence report identifying:

- components to preserve;
- components to restyle;
- components to recompose;
- any missing presentation-only state;
- test surfaces affected;
- exact likely files per slice;
- any real Decision Gate.

Do not implement code in the Evidence task unless a trivial documentation correction is required.

---

## 9. POS-UI-V3-1 — Floor Shell + Topbar + Layout

### Scope

Implement:

- simplified cashier-oriented topbar;
- AWJ POS identity/context;
- dominant search/barcode affordance;
- connectivity/session/cashier context;
- secondary operations moved progressively to overflow;
- full-screen Floor shell;
- desktop/landscape approximately 65/35 catalog/cart composition;
- responsive shell foundation;
- no ERP sidebar.

### Constraints

- no business-logic change;
- no accounting/session/API change;
- preserve unsaved-exit behavior;
- preserve current navigation/state continuity;
- preserve keyboard focus/scanner behavior.

### Acceptance

- desktop and 1024×768 remain usable;
- no horizontal page overflow;
- critical cart/pay region remains visible;
- RTL/LTR mirror correctly;
- existing POS operations remain reachable.

---

## 10. POS-UI-V3-2 — Product Catalog Experience

### Category navigation

Implement horizontal scrollable categories.

Support:

- All;
- Favorites;
- normal categories;
- overflow/search strategy where needed.

Do not preserve the current permanent category rail merely for backward visual parity.

### Density modes

Implement:

#### Compact
- minimal/no image;
- high catalog throughput;
- name + price dominant.

#### Standard
- default;
- balanced media and density.

#### Visual
- larger image treatment;
- suited to visual-selection merchants.

### Product tile hierarchy

Priority:

1. product identity;
2. price;
3. image;
4. quantity already in cart;
5. actionable stock state;
6. secondary metadata.

Barcode/SKU/detailed stock must not dominate every normal tile.

### Added-to-cart state

Prefer:

- immediate pressed feedback;
- quantity badge;
- existing optional sound/haptic.

Avoid repetitive intrusive success toasts for normal product adds.

---

## 11. POS-UI-V3-3 — Cart Experience

### Cart

Create a stronger transaction workspace without making it a dense administrative table.

Prioritize:

- product name;
- unit price;
- quantity;
- line total.

### Quantity

Touch controls:

`−   qty   +`

must respect touch minimums.

### Secondary line actions

Discount/unit/price override should use the selected-line action/editor treatment where appropriate instead of permanently crowding every row.

### Totals

Hierarchy:

- subtotal;
- discount;
- tax;
- grand total.

Grand Total and Pay are strongest.

### Surface

- default Light/high-contrast Floor surface;
- local Outcome emphasis allowed;
- whole cart not permanently dark.

---

## 12. POS-UI-V3-4 — Payment Workspace

Recompose existing payment into a cashier terminal workspace.

### Primary visual questions

1. Amount Due?
2. Payment method?
3. Remaining / Change?

### Desktop direction

Approximately:

- 34–38% transaction summary;
- 62–66% interaction area.

### Preserve current payment semantics

- configured payment methods;
- default method;
- cash/bank settlement semantics;
- split tender;
- exact amount;
- quick amounts;
- change calculation;
- deferred policy;
- offline block;
- submitting/recovering lock;
- checkout idempotency.

### Split tender

Applied methods and amounts remain explicit.

Remaining updates immediately.

A second selected method naturally targets remaining amount.

### Numeric entry

Keyboard:
- physical numpad immediate;
- keypad need not permanently consume layout.

Touch:
- contextual keypad;
- approximately 56–64px keys.

### Financial result

Expose:

- Paid;
- Remaining;
- Change.

Remaining dominates while incomplete.

Change dominates when relevant.

### Confirm

One dominant Confirm Payment action.

No competing equal primary button.

---

## 13. POS-UI-V3-5 — Touch / Responsive

### Wide desktop — >= approximately 1280px
- catalog/cart persistent split;
- keyboard/pointer/scanner first-class;
- full quick actions.

### Compact desktop / iPad landscape — approximately 900–1279px
- retain split;
- protect cart width;
- reduce catalog columns before touch targets;
- collapse secondary labels.

### Portrait tablet — approximately 600–899px
Use two explicit workspaces:

1. Products
2. Cart

Products default during selection.

When cart has items, persistent transaction bar shows:

- count;
- total;
- View Cart / Pay.

Cart opens as a full-height transaction workspace.

### Mobile — < approximately 600px
Use:

- compact cashier header;
- sticky search;
- horizontal categories;
- 2-column or density-dependent catalog;
- sticky transaction bar;
- full-screen Cart workspace;
- vertical payment flow;
- safe-area-aware actions.

### Touch targets

- ordinary control: minimum approximately 44×44;
- Pay/Confirm: 56–64px;
- quantity: minimum 44px;
- keypad: 56–64px;
- category target: effective minimum 44px.

Reduce density before reducing critical touch size.

---

## 14. POS-UI-V3-6 — Visual QA + Polish

Final evidence pass must cover at minimum:

### Languages
- Arabic RTL;
- English LTR.

### Theme
- Light;
- Dark.

### Interaction
- Touch;
- Keyboard/Mouse;
- Hybrid;
- scanner;
- focus restoration.

### Transaction
- add/remove/quantity;
- customer;
- hold/resume;
- cart recovery;
- payment;
- split payment;
- deferred state where configured;
- success/receipt;
- session continuity.

### Required viewport evidence

- approximately 390px phone;
- approximately 430px phone;
- portrait tablet;
- iPad landscape;
- 1024×768;
- 1440px desktop.

### Required visual guarantees

- no horizontal page overflow;
- no clipped critical action;
- no browser zoom required to complete sale;
- no required state depends on hover alone;
- Light/Dark readable;
- RTL/LTR composition correct.

---

## 15. Visual rules

AWJ POS may feel livelier than Ledger, but must remain controlled.

Use:

- AWJ primary for active/selected/primary action;
- semantic colors only for semantic meanings;
- neutral structural surfaces;
- product imagery as primary visual richness;
- stronger typographic hierarchy;
- subtle functional depth.

Avoid:

- arbitrary new brand palette;
- rainbow category decoration;
- excessive nested cards/borders;
- decorative gradients;
- glow;
- glassmorphism;
- slow ornamental animation;
- dashboard-like equal card grids;
- AI-looking visual clutter.

---

## 16. Accessibility

Maintain throughout:

- visible keyboard focus;
- RTL/LTR correctness;
- WCAG-compatible contrast;
- non-color state indicators;
- touch target minimums;
- reduced-motion compatibility where applicable;
- keyboard operation;
- scanner-safe focus behavior.

Do not remove focus outlines without a visible equivalent.

---

## 17. Testing strategy

Run tests progressively for each slice.

Order:

1. focused changed-component/unit tests;
2. relevant POS tests;
3. interaction/scanner/focus tests;
4. build/type/lint as applicable;
5. targeted visual/E2E;
6. broader regression when risk justifies it.

Do not weaken financial/security/tenant tests because the Horizon is UI-focused.

If unrelated pre-existing failures exist:

- prove they are pre-existing;
- document them;
- do not silently fix them unless they block the Horizon and a separate in-scope fix is justified.

Inspect failing CI jobs/logs first.

Avoid wasteful repeated polling.

---

## 18. PR, review and merge protocol

This Horizon is executed PR-by-PR.

Before every Merge:

- Implementer self-review;
- Reviewer review on exact final Head;
- AWJ Guardian review;
- required tests complete;
- required CI green on exact final Head;
- no unresolved in-scope finding;
- no unresolved Decision Gate;
- record:
  - `PRE_MERGE_REVIEW: PASS`
  - `Reviewed Head SHA: <sha>`

If Head changes, review is invalidated and must be repeated.

After Merge:

- verify PR actually merged;
- record real Merge SHA;
- inspect target-branch result;
- inspect available post-merge checks;
- run smoke/regression if risk requires it;
- record:
  - `POST_MERGE_REVIEW: PASS`
  - `Reviewed Merge SHA: <sha>`

A failed post-merge review blocks dependent slices.

Use Fix Forward through a new PR; never rewrite `main` history.

---

## 19. Merge / Deploy policy

The owner intends this Horizon to proceed autonomously through routine implementation and sequential PRs once the Horizon plan itself is approved/merged and execution is explicitly launched.

However:

- follow repository branch-protection and review requirements;
- do not bypass required checks;
- do not merge with unresolved findings;
- do not confuse Merge with Deploy.

This Horizon does **not** authorize:

- Production Deploy;
- Production Release;
- destructive Production operations.

Those require Safwan's explicit approval.

---

## 20. Decision Gates

Stop and produce a Decision Packet only when a material issue requires changing the approved boundaries, such as:

- accounting semantic change;
- checkout/payment accounting semantic change;
- database/schema change;
- public API breaking change;
- tenant/security/RBAC boundary change;
- destructive migration;
- contradiction between approved V3 design and current architecture that cannot be solved safely inside presentation/composition;
- material visual decision outside the approved direction;
- production deployment/release.

Do not stop for normal implementation choices.

Make bounded implementation decisions consistent with the approved V3 document.

---

## 21. Executor policy — Grok

For this Horizon, Safwan has chosen **Grok** as the primary executor.

This is an execution-tool choice for this Horizon and does not change AWJ's engineering safety protocol.

Grok must follow the same:

- current-main start rule;
- Evidence Pass;
- dependency-safe queue;
- exact-Head review;
- AWJ Guardian review;
- CI gates;
- post-merge review;
- durable report requirements;
- Decision Gates;
- no-production-deploy rule.

If Grok cannot perform a required repository action or verification reliably, it must report the limitation rather than fabricate completion.

Do not automatically hand the task to Work/Codex merely because Grok reaches a routine implementation issue.

Escalate tool choice only when there is a concrete capability gap or a high-risk debugging need.

---

## 22. Per-PR implementation report

Every implementation PR must create/update a Markdown report containing:

- task/slice;
- what was implemented;
- exact files changed;
- relevant design decisions;
- reused existing components/contracts;
- tests run;
- exact results;
- build/type/lint;
- visual QA;
- RTL/LTR;
- viewport evidence where applicable;
- risks;
- deferred items;
- unrelated/pre-existing failures;
- Base SHA;
- Head SHA;
- Branch;
- PR number/link;
- merge status;
- Merge SHA when merged;
- PRE_MERGE_REVIEW result;
- POST_MERGE_REVIEW result;
- next dependency-ready Horizon task.

The next slice must consume the previous merged report rather than rediscovering the whole POS.

---

## 23. Final Horizon report

At completion create:

`AWJ_POS_UI_V3_HORIZON_FINAL_REPORT.md`

The final report must include:

- Horizon objective;
- all PRs and Merge SHAs;
- final production-code surface changed;
- final POS visual architecture;
- final screenshots/evidence matrix;
- test/build/CI summary;
- RTL/LTR status;
- Light/Dark status;
- viewport matrix;
- interaction-mode/scanner status;
- known limitations;
- deferred/out-of-scope items;
- confirmation that accounting/session/security/tenant contracts were not intentionally changed;
- production deployment state;
- recommended next Horizon, if any.

---

## 24. Definition of Done

The Horizon is complete only when:

1. Floor Shell + Topbar V3 is implemented.
2. Sale Workspace V3 composition is implemented.
3. Horizontal category navigation is implemented.
4. Compact / Standard / Visual product modes work.
5. Standard is the default density.
6. Product tiles reflect V3 hierarchy.
7. Cart V3 is implemented.
8. Totals / Pay hierarchy is implemented.
9. Payment Workspace V3 is implemented.
10. Split tender remains working.
11. Touch/responsive compositions are implemented.
12. Portrait/mobile Cart uses full-height transaction workspace.
13. Sticky transaction controls are safe-area correct.
14. Arabic RTL is verified.
15. English LTR is verified.
16. Light and Dark are verified.
17. Touch / Keyboard-Mouse / Hybrid remain working.
18. Scanner/HID behavior remains working.
19. Required viewport matrix is verified.
20. No horizontal overflow remains.
21. No critical action is clipped.
22. Existing checkout/accounting/session/security/tenant contracts remain intact.
23. Required tests/build/CI are green, or any unrelated pre-existing failure is explicitly evidenced and does not invalidate the Horizon.
24. Every merged slice has PRE_MERGE and POST_MERGE review evidence.
25. Final Horizon report exists.
26. Production has **not** been deployed unless Safwan separately authorizes it.

---

## 25. Launch rule

This document **does not by itself launch implementation**.

After Safwan reviews/merges this Horizon plan and explicitly says to launch it with Grok:

1. Grok fetches latest `origin/main`;
2. reports exact Base SHA;
3. confirms this Horizon plan and the approved visual-direction document exist on that Base;
4. runs `POS-UI-V3-EVIDENCE`;
5. promotes only genuinely-ready tasks;
6. executes sequential PRs without asking “continue” for routine steps;
7. stops only at a genuine Decision Gate, blocker, Production gate, or Horizon End;
8. produces the final Horizon report.

**Merge != Deploy.**
