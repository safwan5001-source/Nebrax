# CUST-HV — Master Horizon Execution Plan

**Project:** أَوْج / AWJ  
**Repository:** `safwan5001-source/Nebrax`  
**Horizon:** CUST-HV — Visual Design, Media & Merchant UX Completion  
**Execution range:** V1A → V11  
**Authority:** `CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md` + `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` + Master Gap  
**Baseline:** `main@2a068b8c94d6bd68f2670ee63ae2363ae94faa2f` — CUST-HV V0 merged  
**Status:** Execution orchestration document. This document does not authorize Merge, Deploy, Production release, breaking API/DB changes, or changes to frozen V0 decisions.

---

## 1. Purpose

This document is the operating contract for executing the complete CUST-HV Horizon after V0.

The objective is to let Claude Code execute the Horizon substantially autonomously, while keeping the work reviewable, dependency-safe and aligned with AWJ's product, accounting, security and design standards.

The Horizon is **not** one giant PR.

It is one coherent product Horizon executed **slice by slice**, with an independent implementation/review/verification loop for each slice.

The implementation sequence is:

`V1A → V1B → V2 → V3 → V4 → V5 → V6 → V7 → V8 → V9 → V10 → V11`

A later slice may start only when its actual dependency gates are satisfied.

---

## 2. Execution model

For every slice:

1. **Read only the relevant current evidence**
   - current `main`;
   - the V0 contract;
   - the Horizon roadmap;
   - the latest implementation/handoff report;
   - only the code and tests required for the active slice.

2. **Do not restart repository-wide discovery**
   - reuse prior evidence;
   - inspect new areas only when the active slice requires it.

3. **Confirm the exact scope**
   - what is included;
   - what is explicitly excluded;
   - frozen invariants that apply;
   - dependencies;
   - Definition of Done.

4. **Implement the smallest coherent slice**
   - avoid unrelated refactors;
   - avoid speculative abstractions;
   - preserve backward compatibility;
   - preserve Tenant Isolation;
   - preserve Draft/Published and revision semantics;
   - preserve commerce truth.

5. **Test progressively**
   - focused tests first;
   - then integration tests;
   - then build/CI;
   - do not weaken tests for security, Tenant Isolation, publishing, media ownership or commerce truth.

6. **Perform a Design Quality Pass**
   - functionally correct is not enough;
   - inspect layout, hierarchy, responsive behavior, RTL/LTR, empty/loading/error/processing states, touch ergonomics and accessibility;
   - improve reversible UX/design issues inside the current slice before closing it.

7. **Open one independent PR for the slice**
   - keep the PR focused;
   - include exact Base SHA and Head SHA;
   - do not merge.

8. **Address findings**
   - inspect only the relevant review comments/CI jobs;
   - fix real in-scope findings;
   - do not expand scope because an automated reviewer suggests unrelated work.

9. **Produce the required Implementation Report**
   - what was implemented;
   - changed files;
   - tests and results;
   - build/CI;
   - responsive/RTL/LTR evidence where relevant;
   - risks and remaining work;
   - Base SHA;
   - Head SHA;
   - Branch;
   - PR;
   - next slice / next action.

10. **Continue automatically to the next dependency-safe slice**
    - unless a STOP condition in §7 applies.

---

## 3. Creative autonomy

The roadmap, V0 contract and Master Gap define product intent, safety boundaries, invariants and required capabilities.

They are **not a pixel prison**.

Claude Code is explicitly encouraged to improve the solution when it can produce a better merchant experience without violating a frozen contract.

### 3.1 Areas where creative judgment is encouraged

Claude Code may improve:

- visual hierarchy;
- layout composition;
- responsive behavior;
- spacing and density;
- component composition;
- inspector ergonomics;
- contextual actions;
- empty states;
- loading states;
- processing states;
- error states;
- discoverability;
- micro-interactions;
- bounded transitions and motion;
- preview behavior;
- mobile editing UX;
- media workflows;
- theme presentation;
- merchant-facing language;
- sensible defaults;
- accessibility UX.

If the literal existing UI is mediocre, do not preserve mediocrity merely for parity.

Benchmark professional commerce builders and SaaS products where useful, but do not blindly copy them.

### 3.2 Product quality principle

> **Merchant delight with accountant-grade reliability.**

The Storefront and Store Customizer may be expressive, polished and visually rich.

The AWJ ERP/editor shell remains:

- clear;
- fast;
- trustworthy;
- consistent;
- operational;
- appropriately dense;
- RTL-first;
- accessible;
- restrained where decoration does not improve work.

### 3.3 Better-than-spec rule

If a materially better UX/design solution is identified:

1. verify that it does not violate a frozen V0 invariant;
2. keep it inside the active slice;
3. implement it when it is a reversible design/UX improvement;
4. document the improvement and reasoning in the Implementation Report.

If it changes a frozen Product/Architecture decision, stop and report:

`PRODUCT DECISION REQUIRED`

with:

- current decision;
- proposed improvement;
- evidence;
- benefits;
- risks;
- compatibility/migration impact;
- recommendation.

Do not silently reinterpret frozen decisions.

---

## 4. Non-negotiable boundaries

Never weaken or creatively reinterpret:

- Tenant Isolation;
- authentication/authorization;
- media ownership;
- Published-reference gating;
- Draft vs Published semantics;
- Version/revision concurrency;
- stale-response guards;
- Publish safety;
- commerce truth;
- pricing authority;
- inventory authority;
- offer truth;
- accounting behavior;
- accessibility requirements;
- backward compatibility;
- current API/DB contracts outside the active slice.

Do not introduce:

- arbitrary merchant CSS;
- arbitrary merchant JavaScript;
- unsafe HTML;
- unrestricted absolute positioning;
- free-form Webflow/Figma-style layout;
- heavy animation that harms performance/accessibility;
- speculative infrastructure that AWJ does not operate.

---

## 5. V0 contract boundary

V0 freezes **what must be true**.

The implementation slice owns **how it is proven**.

Do not reopen V0 simply because implementation details were deliberately left unfrozen.

Examples:

### Contrast / accessibility

Frozen invariant:

- text and applicable UI over merchant-controlled colours, gradients, images, transforms and overlays must satisfy the applicable WCAG contrast requirement against the actual rendered result;
- normal text: at least 4.5:1;
- applicable large text/non-text UI: at least 3:1;
- if compliance cannot be proven safely, Publish fails closed or offers a proven accessible automatic fix.

Implementation details such as pixel/compositing algorithm, colour-space handling, evidence shape and sampling strategy belong to V5/V6 and must be proven there.

### Derivative processing

Frozen invariant:

- every required derivative reaches READY or FAILED;
- no permanent-pending state;
- Publish/scheduled Publish verify readiness only;
- Publish never performs unbounded/bulk derivative generation;
- processing cannot rely solely on infrastructure Production does not guarantee.

Worker topology, batching, queue/scheduler/request-driven orchestration, retry cadence and performance tuning belong to V2 and must be proven there.

---

## 6. Horizon slice map

### V1A — Independent proven defects

Scope:

- DEF-1 — custom Header links on mobile;
- DEF-3a — stale CategoryBanner comment;
- DEF-4 — honest Theme Preview behavior;
- DEF-9 — stale capabilities comment;
- DEF-10 — stale HeroSection documentation;
- DEF-11 — Exit / Save draft / Publish remain reachable at 390, 430, 768, 1024, 1280 and 1440 in AR and EN; secondary actions may move into a keyboard-operable responsive overflow.

Restrictions:

- no full toolbar redesign;
- no V5 Inspector redesign;
- DEF-7 remains V1B.

### V1B — Builder editing-surface defects

Focus:

- 768 px editing surface;
- related builder layout/IA defects explicitly assigned by the V0 contract;
- preserve Canvas dominance;
- no premature implementation of V5 design controls.

### V2 — Media Foundation

Owns proving:

- Customizer media lifecycle on the existing AWJ R2 foundation;
- tenant-scoped ownership;
- upload/library/update/safe delete/usage;
- signed/private workspace reads;
- published same-origin media delivery;
- transform identity;
- derivative readiness lifecycle;
- server-generated variants;
- imaging implementation choice against proven Production runtime;
- processing orchestration against actual AWJ deployment capability;
- retry/recovery;
- no permanent-pending state;
- Publish remains verify-only.

V2 must coordinate with Product Media derivatives so AWJ converges on one imaging path rather than parallel implementations.

### V3 — Announcement Bar

Implement the typed announcement system required by V0:

- multiple items;
- links/icons;
- sticky behavior;
- optional rotation/ticker;
- dismiss behavior;
- visibility scheduling;
- page targeting;
- RTL/LTR;
- reduced-motion behavior;
- design controls within typed boundaries.

### V4 — Media Picker / Image Editor / Identity media

Owns:

- merchant MediaPicker;
- upload/select/reuse;
- processing/failed/retry states;
- bounded image editing;
- crop;
- focal point;
- fit;
- approved aspect presets;
- rotate;
- zoom/reset;
- optional mobile media override where V0 permits;
- logo/identity media integration.

No Photoshop-style features.

### V5 — Section Visual Contract / Inspector / Palette / Typography

Owns:

- typed Section Visual Contract implementation;
- Content / Design / Layout inspector organization;
- Advanced only where real fields exist;
- palette roles including first-class `accentColor`;
- bounded typography system;
- button/surface styles;
- content width;
- spacing;
- borders;
- radius;
- shadow;
- separators;
- backgrounds/gradients;
- bounded motion primitives;
- accessibility proof for chosen contrast-validation implementation.

Absent design settings must preserve current output.

### V6 — Hero & Banner

Owns:

- per-instance Hero behavior;
- Hero/Banner design depth;
- media;
- mobile art direction;
- overlay;
- content placement;
- buttons;
- bounded overlap;
- scheduling/visibility where applicable;
- actual-rendered-result contrast proof;
- responsive/RTL/LTR verification.

### V7 — Header / Footer / Navigation

Owns:

- Header as first-class design surface;
- transparent/overlay behavior;
- sticky/height/dividers/design controls;
- Footer as first-class design surface;
- six Footer layouts;
- nested navigation level;
- drag/reorder + keyboard alternative;
- typed internal destinations;
- safe external links;
- curated icon registry;
- desktop/mobile parity;
- RTL/LTR.

Mega menu remains later unless Owner explicitly changes the frozen decision.

### V8 — Slider / Gallery / Motion

Owns:

- slider;
- autoplay opt-in/off by default;
- interval at least 5 s;
- pause controls;
- reduced-motion behavior;
- swipe/manual navigation;
- Gallery grid/carousel/lightbox;
- accessible DOM ordering;
- bounded motion.

### V9 — Cards / Product / Category / Content blocks

Owns presentation depth while preserving the Commerce Firewall.

No design setting may fabricate or override:

- price;
- discount;
- inventory;
- offer truth;
- availability;
- tax;
- checkout amounts.

### V10 — Themes / Workflow polish

Owns:

- themes as complete visual systems;
- Preview → Apply summary → new Draft Version;
- never overwrite Published;
- tenant-safe theme media handling;
- built-in presets;
- workflow polish;
- merchant confidence and clarity.

### V11 — Integrated Verification & Horizon Closure

Must verify the Horizon as one product:

- Desktop/Tablet/Mobile;
- 390 / 430 / 768 / 1024 / 1280 / 1440;
- AR RTL;
- EN LTR;
- keyboard/accessibility where applicable;
- media ownership/isolation;
- Draft vs Published parity;
- stale-response guards;
- commerce truth;
- version/revision concurrency;
- backward compatibility;
- representative realistic merchant content;
- production-like build/CI evidence.

CUST-HV is not complete before V11 closure evidence is accepted.

---

## 7. Mandatory STOP conditions

Stop the autonomous Horizon execution and return to Safwan when any of the following occurs:

1. `PRODUCT DECISION REQUIRED`;
2. contradiction with a frozen V0 decision;
3. security or Tenant Isolation uncertainty that cannot be proven within the slice;
4. accounting or financial behavior change;
5. breaking API contract;
6. breaking database migration or destructive data change not already authorized;
7. architecture requires new Production infrastructure not already approved;
8. implementation evidence proves a frozen mechanism impossible and would require changing the product contract;
9. merge is required;
10. deploy / Production release is required.

Do not merge, deploy or release automatically.

---

## 8. PR and dependency policy

Default:

- one PR per slice;
- do not combine unrelated slices;
- later slices should branch from the latest accepted/merged dependency base;
- if a slice is blocked on an unmerged dependency, do not create a long stack of fragile dependent PRs unless explicitly justified.

If Safwan authorizes continuous implementation before merges, maintain explicit dependency metadata and rebase/sync safely when upstream slices merge.

Never hide dependencies.

---

## 9. CI and review discipline

- inspect the failing job/log first;
- do not poll CI repeatedly without need;
- run focused tests first;
- broaden only when needed;
- security/Tenant Isolation/media ownership/financial correctness tests must not be reduced;
- automated review suggestions are evidence, not automatic scope expansion;
- fix relevant real findings;
- document non-applicable findings with evidence.

A slice is not “done” merely because code exists.

It is ready for Owner merge review only when:

- intended implementation is complete;
- focused tests pass;
- required broader tests pass;
- build passes;
- CI is green or any unrelated known failure is explicitly proven;
- open relevant review threads are resolved;
- Implementation Report is complete.

---

## 10. Design Quality Pass — mandatory before slice closure

After functional tests pass, inspect the result again as a product.

Ask:

- Is the primary action obvious?
- Is the Canvas still dominant?
- Are controls grouped logically?
- Is routine editing fast?
- Is mobile genuinely usable rather than compressed desktop?
- Are touch targets sufficient?
- Does 768 px have a real usable editing surface?
- Are long Arabic and English labels resilient?
- Are empty/loading/error/processing states clear?
- Does the UI feel coherent with AWJ?
- Is motion restrained?
- Are merchant-facing terms understandable?
- Are there unnecessary controls or implementation vocabulary?
- Does the result feel premium enough to ship commercially?

Fix reversible, in-scope quality issues before closing the slice.

---

## 11. Required Implementation Report

Every slice must end with a Markdown report containing:

### Identity

- Horizon;
- Slice;
- Branch;
- PR;
- Base SHA;
- Head SHA.

### Implemented

- exact capabilities delivered;
- notable UX/design improvements;
- any better-than-spec improvements and why.

### Files changed

- grouped by backend / web / storefront / tests / docs.

### Tests

- focused tests;
- integration tests;
- build;
- CI;
- responsive/visual/browser evidence when relevant.

### Safety

- Tenant Isolation;
- auth/permissions;
- Draft/Published;
- version/revision concurrency;
- media ownership;
- commerce/accounting truth;
- backward compatibility.

### Findings / risk

- resolved findings;
- known limitations;
- deferred implementation details;
- operational prerequisites.

### Status

Explicitly state:

- Merge: NOT PERFORMED unless Safwan explicitly authorized it;
- Deploy: NOT PERFORMED unless Safwan explicitly authorized it;
- Production release: NOT PERFORMED unless Safwan explicitly authorized it.

### Next action

Name the next dependency-safe slice or the exact Owner decision required.

---

## 12. Master instruction for Claude Code

When this document is supplied to Claude Code, use the following operating instruction:

> Execute CUST-HV from V1A through V11 using this Master Horizon Execution Plan, the merged V0 contract and the Horizon Roadmap as authority.
>
> Work autonomously slice by slice. Do not repeatedly ask for permission to continue normal implementation.
>
> For each slice: inspect only relevant evidence, implement within scope, test progressively, perform the Design Quality Pass, open a focused PR, address relevant findings, verify CI and produce the required Markdown Implementation Report.
>
> Continue to the next dependency-safe slice automatically unless a mandatory STOP condition is reached.
>
> You have creative autonomy in reversible UX/design decisions. The roadmap is a contract, not a pixel prison. Improve mediocre existing UI when you can produce a better merchant experience without violating frozen invariants.
>
> Optimize for **merchant delight with accountant-grade reliability**.
>
> Never weaken Tenant Isolation, security, Draft/Published semantics, revision concurrency, accessibility, media ownership, commerce truth, accounting correctness or backward compatibility.
>
> Never merge, deploy or release to Production without explicit Safwan approval.
>
> Do not reopen closed Horizons or re-investigate the full repository unless new evidence makes that necessary.

---

## 13. Horizon completion rule

CUST-HV is complete only when:

1. V1A through V11 are either implemented or explicitly Owner-deferred with documented rationale;
2. all required slice PRs are reviewed and merged by Owner approval;
3. V11 integrated verification passes;
4. remaining risks are documented and accepted;
5. Horizon closure report is created;
6. no required deploy/Production verification is falsely marked complete before it actually occurs.

After CUST-HV closure, the roadmap proceeds to:

- **CUST-H5 — Undo / Redo, Recovery & Change Confidence**
- then **CUST-H6 — Advanced Extensibility**

H5/H6 retain their existing numbering.
