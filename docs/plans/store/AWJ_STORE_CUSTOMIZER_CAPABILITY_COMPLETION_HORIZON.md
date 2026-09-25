# AWJ Store Customizer Capability Completion Horizon

**Status:** Proposed / ready for owner launch  
**Invocation:** نفّذ هذه المهمة بنظام الأفق  
**Repository:** `safwan5001-source/Nebrax`  
**Verified base main SHA:** `1a0cac9863e48eb4eb2e4870e1f0aa70878382af`  
**Governing process:** `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`  
**Governing product decision:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_BUILD_DONT_HIDE_DECISION.md`

## 1. Objective

Complete the intended merchant-facing Store Customizer capabilities end-to-end instead of hiding them because they are incomplete.

The target lifecycle for every completed capability is:

`Merchant edit → Draft → Save → Preview → Publish → Published Storefront`

A section type, toggle, editor panel, preview placeholder, or persisted shell is not enough to claim completion.

This horizon starts from the previous storefront visual horizon's proven state. Do not repeat broad discovery already captured there unless a current-code contradiction appears.

## 2. Scope priorities

Primary capability set:

1. Promotional banner / `banner`
2. Featured products / `featured`
3. Offers / `offers`
4. Store benefits / `benefits`
5. Store application promotion / `appPromo`
6. Custom content / `customContent`

Also inspect every other merchant-visible customizer capability and classify it from current code evidence. Do not assume the six items above are exhaustive.

## 3. Required first pass

Before code:

1. Verify latest `origin/main`; report exact SHA.
2. Confirm working tree is clean.
3. Read only the durable sources needed for this horizon:
   - `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
   - `docs/autonomous-engineering/CURRENT-STATE.md`
   - `docs/plans/store/AWJ_STOREFRONT_VISUAL_COMPLETION_HORIZON.md`
   - `docs/plans/store/AWJ_STOREFRONT_VISUAL_COMPLETION_EVIDENCE_PASS.md`
   - `docs/plans/store/AWJ_STORE_CUSTOMIZER_BUILD_DONT_HIDE_DECISION.md`
   - latest Store Customizer persistence / contract implementation reports when directly relevant.
4. Perform a focused code Evidence Pass for the merchant-visible capability set only.
5. Create/update a durable capability matrix before opening implementation PRs.

## 4. Classification

Each capability must have exactly one current classification:

- `COMPLETE`
- `IMPLEMENTATION_READY`
- `BACKEND_GATED`
- `PRODUCT_DECISION_REQUIRED`
- `DEFERRED`
- `OUT_OF_SCOPE`

The matrix must include:

`Capability | Merchant UI | Data contract | Persistence | Preview | Published runtime | RTL/LTR | Mobile/Desktop | Current classification | Evidence | Gap | Required action`

Classification is evidence, not a reason to avoid building. Under the Build, Don’t Hide decision, a missing backend is not automatically a deferral.

## 5. Mandatory carry-in cleanup

The previous horizon review found one cleanup item to handle before or alongside capability work:

### STORE-CUSTOMIZER-CLEANUP-1 — Click-to-edit interaction semantics

Review the fixed-chrome click-to-edit implementation for nested interactive semantics / keyboard / accessibility correctness.

Do not redesign the builder. Preserve behavior, but avoid invalid or confusing nested interactive patterns where practical.

This task is small and must not expand into a broad accessibility refactor.

## 6. Per-instance content contract

The current section-instance model may identify an instance with fields such as `id`, `type`, and `visible`.

For repeatable sections, this horizon must determine and implement the smallest safe durable content model needed for true per-instance authoring.

Requirements:

- different instances can hold different content;
- content survives Draft → Save → Preview → Publish → Published Runtime;
- old documents continue to normalize safely;
- unknown fields/types fail closed;
- no arbitrary merchant HTML/CSS/JS;
- content shape remains presentation-owned, not a source of commerce truth.

If choosing the field shape is materially ambiguous or migration-sensitive, produce a Decision Packet. Continue independent work where possible.

## 7. Capability rules

### 7.1 Banner

Build a real merchant-editable banner with a durable structured content contract, preview, publish, and public rendering.

Fields must be justified by current AWJ UX/architecture evidence. Do not add arbitrary configuration merely because another commerce platform has it.

### 7.2 Featured products

Build real product selection and ordering.

The customizer may reference product identifiers. It must not author:

- price,
- stock,
- availability,
- tax,
- discount truth.

Published rendering must resolve current commerce facts from the authoritative backend.

Cross-tenant product references must be impossible.

### 7.3 Offers

Do not create a parallel promotion/pricing system.

An offers section may only become live when it can point to authoritative AWJ offer/promotion data or another proven safe source.

If the repository does not yet contain sufficient offer authority, issue a Decision Packet and do not fabricate percentages, compare-at prices, or totals.

### 7.4 Benefits

Build structured merchant-authored benefit items with safe limits and localization-aware rendering.

No executable markup.

### 7.5 App promotion

Use real application metadata and allow-listed URLs only.

Do not render App Store / Google Play availability, QR targets, or application claims that are not actually configured.

### 7.6 Custom content

Use safe structured blocks.

Forbidden:
- arbitrary HTML
- arbitrary CSS
- JavaScript
- iframe
- executable embed code
- unsafe URL schemes

Prefer a small typed block model over a generic page-builder-within-the-builder.

## 8. Merchant UX rule

Do not solve incomplete intended capabilities by silently hiding them.

During implementation, a capability may honestly show a gated or not-yet-available state, but horizon completion requires building every safely buildable in-scope capability.

A control must never imply a successful published behavior that the public runtime cannot honor.

## 9. Preview ↔ Published parity

For each completed capability, prove:

- authoring behavior;
- persisted draft;
- saved reload;
- preview;
- publish;
- normalized public payload;
- published storefront rendering.

Preview-only success is not completion.

The public runtime must remain fail-closed for unknown or malformed presentation values.

## 10. Visual QA

For each changed merchant-facing capability, verify:

- 390
- 430
- 768
- 1024
- 1280
- 1440

And:

- Arabic RTL
- English LTR
- mobile
- desktop
- loading where relevant
- empty
- error
- long content
- missing optional media
- safe fallback

Record unavailable cells honestly. Do not replace missing evidence with assumptions.

## 11. Security / data / business invariants

Preserve:

- Tenant Isolation
- `commerce.manage`
- Draft/Public separation
- backward compatibility
- existing `presentation: null` fallback
- server-owned prices
- server-owned discounts
- server-owned tax
- server-owned stock / availability
- no cross-tenant product/media references
- no arbitrary executable merchant content
- unknown presentation values fail closed

Do not change accounting, invoicing, payments, tax, posting, or inventory valuation semantics in this horizon.

## 12. Decision Gates

Stop and issue a Decision Packet only for a material gate such as:

- presentation schema choice with meaningful backward-compatibility impact;
- DB migration with material risk;
- tenant/auth/RBAC change;
- new media/object-storage provider architecture;
- pricing/discount/tax/payment authority;
- large scope expansion;
- another owner-significant architectural trade-off.

A Decision Packet must include:
- problem;
- current repository evidence;
- options;
- trade-offs;
- backward compatibility impact;
- tenant/security impact;
- data/migration impact;
- preview/public-runtime impact;
- what independent work can continue.

Do not stop merely because the backend is not built yet.

## 13. Task execution model

Use the official Horizon cycle:

`Evidence → Architecture/Decision → Durable docs → Small PR → Focused tests → Risk-based tests → Implementer review → Reviewer → AWJ Guardian → CI Exact Head → PRE_MERGE_REVIEW PASS → Merge → POST_MERGE_REVIEW PASS → Durable state → Next ready task`

Rules:

- no stacked dependent PRs by default;
- no broad rediscovery between PRs;
- no polling loops;
- inspect only failed CI jobs/logs first;
- any head movement invalidates PRE_MERGE_REVIEW;
- post-merge failure blocks dependents and is fixed forward by a new PR.

## 14. Merge and release authority

In-scope PRs in this explicitly launched horizon may merge automatically after all Horizon gates pass.

This horizon does **not** authorize:

- Production Deploy
- Production Release
- Production Migration
- destructive Production action
- App Store / Google Play release

Those require explicit owner approval.

## 15. Definition of Done

Do not close this horizon until:

1. Every merchant-visible customizer capability in scope is classified from current code evidence.
2. Every safely buildable `IMPLEMENTATION_READY` capability is completed end-to-end.
3. Relevant repeatable sections have durable per-instance content.
4. Preview ↔ Published parity is proven for completed capabilities.
5. Mobile/Desktop and RTL/LTR are verified for changed UI.
6. No open P1/P2 remains.
7. No misleading merchant control claims unsupported published behavior.
8. CI is green on exact final heads.
9. PRE_MERGE_REVIEW and POST_MERGE_REVIEW are recorded.
10. Remaining blockers are genuine Decision Gates, explicit owner deferrals, or external authorities outside this horizon.
11. Closure report is committed.

Closure report path:

`docs/plans/store/AWJ_STORE_CUSTOMIZER_CAPABILITY_COMPLETION_CLOSURE_REPORT.md`

## 16. Horizon end

At Horizon End:

- write the closure report;
- update durable Current State / Task Queue;
- report final main SHA;
- list PR/Base/Head/Merge SHAs;
- list completed capabilities;
- list remaining gates/deferred items;
- report tests/CI/visual QA/security/backward-compatibility/performance;
- do not deploy;
- do not start a third horizon automatically.
