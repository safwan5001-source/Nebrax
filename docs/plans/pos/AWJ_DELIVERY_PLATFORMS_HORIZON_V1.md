# AWJ Delivery Platforms & Settlement Horizon V1

**System:** AWJ Autonomous Engineering Horizon  
**Status:** ACTIVE — PASS-7 accepted; PASS-8 merged; each implementation still requires its own authorization
**Prepared:** 2026-10-02  
**Planning Base SHA:** `78ca324504db30185bc074fd91e77efbccaf7267`  
**Primary decision:** `docs/plans/pos/AWJ_POS_DELIVERY_PLATFORMS_ACCOUNTING_UX_DECISION.md`  
**Execution protocol:** `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`

**Current DG-3 state:** `OD-DG-3-TAX-POINT` is **ACCEPTED** by Safwan as
Option D (hybrid universal Saudi/GCC principles + versioned
evidence-backed provider/merchant policy + `UNKNOWN` fail-closed), merged in
PR #1233 at `b0c3574225531ed907991bd9c5f23a7e8f5d66bb`. This is an
architecture/documentation acceptance only. It does not authorize imported
financial posting, VAT posting, provider enablement, or deployment.

## 1. Horizon objective

Deliver a safe, production-ready AWJ foundation for delivery-platform sales from cashier/manual operation through centralized external-order ingestion, platform receivable/clearing, settlement and reconciliation, then add native provider connectors only where official onboarding and test evidence exist.

Initial platform catalog:
HungerStation, Keeta, Jahez, Mrsool, Ninja, The Chefz.

The horizon must preserve:
- gross sale value and canonical Invoice authority;
- separation of invoice customer, Sales Channel and settlement counterparty;
- canonical Payment/Ledger/Inventory authorities;
- Tenant + Branch Isolation and RBAC;
- existing POS cash/card/multi-tender behavior;
- provider secrets exclusively in AWJ Backend;
- manual fallback even when a native connector is unavailable.

## 2. Horizon boundary

### In scope
- delivery-platform/channel configuration foundation;
- manual POS channel UX with official permitted logo + name;
- external order reference and collection-policy derivation;
- Delivery Hub operational workspace;
- normalized provider/order status projection;
- platform-collected receivable/clearing routing;
- effective-dated commission/fee policy;
- expected-vs-actual commission reconciliation;
- settlement aggregate and typed components;
- refunds/cancellations interaction with canonical AWJ flows;
- POS close/Z-report presentation separation from physical tender expectations;
- backend connector framework;
- HungerStation connector when onboarding/sandbox credentials exist;
- Keeta connector when onboarding/sandbox credentials exist;
- one-provider-at-a-time readiness packets for remaining platforms.

### Explicitly out of scope
- reverse-engineered or unofficial provider APIs;
- changing the legal invoice customer merely because a platform is selected;
- hard-coded VAT recoverability;
- automatic posting of unexplained settlement variance;
- deriving channel selling prices by adding commission percentage;
- provider credentials in browser/POS;
- broad POS redesign unrelated to delivery;
- broad accounting refactor;
- production deploy/release without Safwan approval;
- implementing a provider whose official contract/credentials/test path is unavailable.

## 3. Locked invariants

1. Delivery platform = Sales Channel + External Order Source + Settlement/Collection Counterparty when applicable; not a generic payment-method enum.
2. Cashier selects the platform once. AWJ derives configured collection treatment.
3. API orders already carry channel/external reference; cashier does not re-enter them.
4. Native API terminates at AWJ Backend.
5. Platform-collected sales create no cash-drawer/card-terminal expectation.
6. Settlement is first-class and may cover many orders.
7. Unknown variance remains visible/unreconciled.
8. Commission configuration is an expectation policy; authoritative settlement evidence remains actual.
9. Printing is not an inventory event.
10. Channel selling price, expected commission and actual settlement deduction are independent concepts.
11. Historical journals are never reinterpreted by later configuration changes.
12. Every external identifier is scoped through trusted tenant/store/branch mapping; IDs are not authority.

## 4. Evidence / architecture pass before code

The implementing agent starts from current `main`, not from this planning SHA blindly, and performs a narrow evidence pass:

- current POS checkout/session/close extension points;
- existing SalesChannel/domain reuse opportunities;
- canonical Invoice/Payment/Ledger routing;
- current refund/credit-note and inventory consumption/reversal authorities;
- existing commerce order/source/channel models;
- existing secret/encryption, webhook, idempotency, audit and dead-letter patterns;
- current branch/RBAC scoping;
- canonical pricing/publication model for future channel prices;
- current reporting/Z-report boundaries.

The pass must produce evidence, not redesign the whole POS.

Any discovered material conflict with the locked accounting/security decisions becomes a Decision Gate.

## 5. Dependency-safe task queue

| Order | Task | Risk | Depends on | Outcome |
|---|---|---:|---|---|
| 0 | DLV-EVIDENCE-1 | high | accepted decision | Current-main implementation map + exact reuse points + unresolved gates |
| 1 | DLV-FOUNDATION-1 | high | EVIDENCE-1 | Tenant-scoped delivery platform/channel configuration and collection policy foundation |
| 2 | DLV-POS-1 | high | FOUNDATION-1 | Manual POS channel selector + external ref + derived platform-collected treatment |
| 3 | DLV-HUB-1 | high | FOUNDATION-1 | Delivery Hub read model/workspace with branch-scoped normalized order projection |
| 4 | DLV-ACCOUNTING-1 | critical | FOUNDATION-1 + EVIDENCE-1 | Platform receivable/clearing semantic routing without changing gross sale |
| 5 | DLV-COMMISSION-1 | critical | ACCOUNTING-1 | Effective-dated commission/fee policy and expected calculation |
| 6 | DLV-SETTLEMENT-1 | critical | ACCOUNTING-1 + COMMISSION-1 | Settlement aggregate, typed deductions/tax/refund/adjustment components and matching |
| 7 | DLV-RECON-1 | critical | SETTLEMENT-1 | Expected-vs-actual reconciliation, partial/unmatched states and variance workflow |
| 8 | DLV-REFUND-1 | critical | ACCOUNTING-1 + HUB-1 | Cancellation/refund/compensation integration with canonical credit-note/inventory rules |
| 9 | DLV-CLOSE-1 | high | ACCOUNTING-1 + POS-1 | POS close/Z-report channel totals without contaminating physical tender expectations |
| 10 | DLV-CONNECTOR-CORE-1 | critical | HUB-1 | Backend-only connector framework: secrets, auth, mapping, idempotency, replay, audit, retry/recovery |
| 11 | DLV-HUNGERSTATION-1 | critical | CONNECTOR-CORE-1 + official onboarding | HungerStation native connector against official contract/test environment |
| 12 | DLV-KEETA-1 | critical | CONNECTOR-CORE-1 + official onboarding | Keeta native connector against official contract/test environment |
| 13 | DLV-PROVIDER-READINESS-1 | high | CONNECTOR-CORE-1 | Jahez/Mrsool/The Chefz/Ninja individual readiness packets; no connector without verified official contract |
| 14 | DLV-VERTICAL-1 | critical | 2–10 complete | End-to-end manual/platform-collected vertical proof across POS → accounting → settlement |
| 15 | DLV-QA-1 | critical | VERTICAL-1 + eligible native connectors | Cross-boundary security/accounting/regression proof |
| 16 | DLV-CLOSE-HORIZON-1 | high | all implementation-ready tasks resolved | Closure report, deferred providers/gates, durable state, next-horizon recommendation |

Tasks are promoted to `ready` one at a time from current-main evidence. An unmerged dependency does not unlock its child.

### 5.1 PASS-7 / PASS-8 durable reconciliation

The original queue order remains historical and is not silently rewritten.
PASS-7 is now accepted, but its evidence-backed prerequisites remain required
before any imported financial transition. PASS-8 freezes the evidence contract,
version vocabulary, posting-prerequisite matrix, and accounting-
representability boundary; it does not implement those prerequisites.

`DLV-CLOSE-1` is implemented on its focused PR and awaits the ordinary review/
merge gates. It remains bounded to POS close/Z-report presentation and
channel-total separation, using existing manual-POS session attribution only; it
does not require imported-order VAT recognition. `DLV-COMMISSION-1`,
`DLV-SETTLEMENT-1`, `DLV-RECON-1`, `DLV-REFUND-1`, `DLV-CONNECTOR-CORE-1`, and
all imported financial-transition work remain blocked by their respective
evidence, provider, DG-3, or owner gates. Manual POS remains independent and
unchanged.

After `DLV-CLOSE-1` merges, no further delivery financial implementation task is
promoted as ready. `DLV-CONNECTOR-CORE-1` is only a candidate for a separately
authorized projection/intake-security scope; it is not authorization for
imported-order financial behavior.

## 6. Task acceptance highlights

### DLV-FOUNDATION-1
- additive tenant-scoped configuration;
- platform identity distinct from invoice customer/payment method;
- collection mode supports at least platform-collected vs merchant-collected semantics without hard-coded provider behavior;
- branch/store override only where configured;
- effective configuration snapshot/reference survives later configuration edits;
- cross-tenant/branch/RBAC negatives.

### DLV-POS-1
- default direct/in-store behavior unchanged;
- configured platforms show logo + name and accessible selected state;
- one selection records channel and derives collection treatment;
- no duplicate platform payment choice;
- manual external reference captured according to channel policy;
- no ledger account selection exposed to cashier;
- mobile/touch/keyboard modes remain usable.

### DLV-HUB-1
- unified branch-authorized delivery order workspace;
- normalized AWJ status plus preserved provider-native source status/evidence;
- manual and future API orders project through one operational surface;
- provider actions appear only when capability contract supports them;
- no financial posting authority moves into Hub UI.

### DLV-ACCOUNTING-1
- gross sale preserved;
- platform-collected consideration routes to platform receivable/clearing through canonical services;
- no cash/bank receipt is fabricated;
- merchant-collected flow remains canonical existing tender flow;
- immutable accounting-relevant channel/collector snapshot;
- SQLite + PostgreSQL, tenant/branch/RBAC/idempotency/accounting negatives.

### DLV-COMMISSION-1
- effective-dated policy; no timeless percentage;
- explicit contractual calculation-base semantics;
- store/branch overrides cannot cross tenant or rewrite history;
- commission expectation never fabricates provider invoice/tax evidence;
- channel pricing remains separate.

### DLV-SETTLEMENT-1 / DLV-RECON-1
- one settlement may match many orders;
- typed fee, fee-tax, refund, merchant-funded/platform-funded promotion and other supported adjustments;
- net bank deposit reconciles against matched gross and authoritative components;
- partial/unmatched states preserved;
- unknown variance cannot auto-post to miscellaneous expense;
- posting/import idempotent and auditable;
- valid fee-tax evidence required before recoverable-input-VAT treatment.

### DLV-REFUND-1
- original external order/invoice linkage retained;
- issued invoice uses canonical credit-note/refund authority;
- compensation is typed evidence, not automatically sales;
- inventory reversal/waste follows canonical lifecycle, never print/reprint;
- retries cannot duplicate financial or stock effects.

### DLV-CONNECTOR-CORE-1
- secrets encrypted and server-side;
- provider-specific webhook authentication;
- trusted tenant/store/branch mapping before tenant-owned lookup;
- replay protection + idempotency;
- safe retry/dead-letter/manual recovery;
- no PII/token leakage in diagnostics;
- duplicate/out-of-order event tests;
- foreign tenant/store/vendor IDs fail closed.

### Native provider tasks
Each connector needs an evidence appendix frozen at implementation time:
- official API/partner contract;
- onboarding/credential status;
- sandbox or controlled test path;
- event/status semantics;
- authentication/signature rules;
- retry/idempotency expectations;
- cancellation/refund behavior;
- capability gaps.

No evidence = `owner_gate` / `blocked`, not guessed implementation.

## 7. Quality gates

Every task follows `docs/autonomous-engineering/QUALITY-GATES.md`.

Financial/security/tenant tasks require, where applicable:
- focused tests first;
- negative authorization/isolation tests;
- SQLite + PostgreSQL;
- relevant full/module regression and frontend build/type/lint;
- exact-final-head Reviewer + AWJ Guardian review;
- CI green on exact Head;
- `PRE_MERGE_REVIEW: PASS`;
- merge only under current authorized merge policy;
- `POST_MERGE_REVIEW: PASS` on real Merge SHA before dependents unlock.

No reduction of financial/security verification to save quota.

## 8. Decision Gates

`DELIVERY-DECISION-PASS-7` records the DG-3 tax-point decision packet in
`docs/plans/pos/DELIVERY-DECISION-PASS-7-DG-3-TAX-POINT-REPORT.md`. It
recommends a hybrid of universal Saudi VAT timing principles and
versioned, evidence-backed provider policy; unresolved or contradictory tax
facts remain a posting blocker. This reference does not authorize the
imported-order command or change the financial-role gate.

Stop and issue a Decision Packet when any of these is material and not already proven:

- accounting posting semantics conflict with canonical AWJ authority;
- legal/tax role of a platform contract changes invoice identity/tax treatment;
- recoverability of provider-fee VAT is not evidenced;
- destructive/irreversible migration;
- public API breaking change;
- strategic credential/provider commitment;
- provider official contract/sandbox unavailable for a native connector;
- ambiguous inventory/cancellation rule that would change existing AWJ business semantics;
- production deploy/release.

Independent ready work may continue when safe.

## 9. Definition of Done — Horizon V1

Horizon V1 is complete when:

1. Manual configured delivery-channel POS flow works without regressing direct cash/card/multi-tender.
2. Delivery Hub foundation works with tenant/branch/RBAC isolation.
3. Platform-collected sales preserve gross value and route through canonical receivable/clearing.
4. Effective-dated commission expectation exists and remains separate from actual provider evidence.
5. Settlement/reconciliation supports matched, partial and unmatched states with visible variance.
6. Refund/cancellation/compensation and inventory boundaries are proven against canonical AWJ rules.
7. POS close separates delivery-channel sales from physical tender expectations.
8. Connector Core is secure, backend-owned and provider-neutral.
9. HungerStation/Keeta native connectors are completed only if their official onboarding/test prerequisites are available; otherwise each is truthfully deferred/owner-gated and does not make the safe core incomplete.
10. Remaining provider connectors are either separately evidenced and implemented in authorized follow-up tasks or explicitly deferred with readiness packets.
11. Required tests/reviews/CI/post-merge evidence are green for every completed task.
12. Closure report distinguishes completed core, provider-specific completion, deferred gates and production state.
13. No production deploy/release is claimed without Safwan's explicit approval.

## 10. Tool allocation

- **ChatGPT:** evidence/architecture review, Decision Packets, task prompts, report review.
- **Cursor:** bounded UI/read-model/documentation PRs such as POS selector or focused Delivery Hub slices when independently scoped.
- **Claude Code:** recommended executor for DLV-ACCOUNTING-1 through DLV-RECON-1, Connector Core, native connectors and final cross-boundary QA because they are multi-file/high-risk.
- **Codex:** reserve for direct repo debugging, failing Build/CI or targeted independent code review when justified.
- **Work:** not required for normal execution of this horizon.

Every Cursor/Claude task must end with an MD implementation report containing: changed files, tests/results, build/CI, risks/remaining, Branch/PR/Base SHA/Head SHA and next dependency-ready task.

## 11. Launch rule

This document **does not itself authorize autonomous coding**.

After this plan is reviewed/merged and Safwan explicitly authorizes execution of this horizon:
1. update durable autonomous-engineering current state/task queue to this authorized horizon;
2. launch from latest `origin/main`;
3. run DLV-EVIDENCE-1;
4. promote only genuinely-ready tasks;
5. continue PR-by-PR without asking “continue” for routine steps;
6. stop only at a real Decision Gate, owner production gate, blocker, or Horizon End.

**Merge != Deploy.**
