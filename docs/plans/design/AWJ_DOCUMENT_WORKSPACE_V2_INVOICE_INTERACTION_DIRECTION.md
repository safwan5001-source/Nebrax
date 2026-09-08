# AWJ Design System V2 — Invoice Document Workspace Interaction Direction

**Status:** DESIGN DIRECTION / OWNER REVIEW — NOT IMPLEMENTATION AUTHORIZATION  
**Date:** 2026-09-08  
**Scope:** Sales-invoice interaction model as the first proving case for `Document Workspace Pattern V2`.

This document defines interaction/design direction only. It does not change production UI, accounting rules, posting semantics, ZATCA behavior, permissions, APIs, database structures, tenant isolation, routes, or invoice lifecycle rules.

## 1. Why this document exists

The first App Shell V2 reference prototype introduced a visible multi-step sequence such as invoice data → items → review → completion. Subsequent review identified that this risks imposing a wizard on a professional ERP workflow and does not solve the same problem equally well on desktop and mobile.

This document replaces that assumption with a device-appropriate Document Workspace model while preserving human review where it provides real safety value.

## 2. Core principle

**The invoice is one business document, not a sequence of disconnected forms.**

AWJ should preserve one document mental model across devices while recomposing the interaction according to available space.

The recommended model is:

> **Desktop/Laptop: Single Document Workspace**  
> **Tablet: Responsive Document Workspace**  
> **Mobile: Responsive Sections + Human Review Gate before consequential final action**  
> **All devices: Continuous Validation + On-demand Document Preview**

A permanent `1 → 2 → 3 → 4` wizard/stepper is therefore **not the default AWJ invoice pattern**.

## 3. Desktop and laptop

Desktop/laptop should optimize for professional throughput.

The user should be able to work within one document workspace containing the relevant invoice context, customer, items/line grid, totals, additional information, validation state, and contextual commands without being forced through sequential wizard pages.

### Why

- Accountants and ERP operators often need to move back and forth between fields and line items.
- The large viewport can expose enough document context for natural human checking.
- A mandatory review page can become an extra click that repeats information already visible.
- Short laptop height remains a first-class constraint: shell chrome and document sections must not consume the working surface unnecessarily.

This does not prohibit an optional summary/preview affordance; it means review is not an obligatory wizard step simply because the screen is a document.

## 4. Tablet

Tablet retains the same document mental model rather than automatically becoming a wizard.

The layout may reflow columns, collapse secondary information, use drawers/sheets for supporting controls, or stack sections according to content pressure. The user should still be able to move naturally between invoice data, customer context, items, totals, and additional information.

Tablet landscape and portrait must be designed independently enough to remain productive.

## 5. Mobile

Mobile cannot rely on the whole invoice being visually present at once. Therefore AWJ must deliberately compensate for reduced simultaneous context.

### 5.1 Entry model

Use responsive document sections rather than a rigid global wizard. Candidate sections include:

- invoice/document data;
- customer;
- items;
- additional information where applicable;
- totals/financial summary.

Sections may use compact headings, progressive disclosure, accordions, dedicated item-edit surfaces, sheets, or other pattern-appropriate composition after prototype testing.

The user must be able to return to any section without artificial step-locking.

### 5.2 No global mobile Bottom Navigation

The App Shell rule remains:

**Global mobile navigation = compact Header + Drawer/Search.**

The phone bottom area is owned by the current Page Pattern for contextual actions when useful. It must not be occupied by a permanent global `Home | Sales | More` navigation bar by default.

## 6. Three different safety mechanisms

AWJ must distinguish three concepts that solve different problems.

### 6.1 Automated Validation

Validation detects conditions the system can prove or strongly determine from its rules and data, such as required fields, invalid combinations, calculation/rule failures, permission/state constraints, or other existing domain validations.

Validation runs continuously or at appropriate interaction boundaries and should take the user directly to the affected field/line where possible.

**Validation cannot prove user intent.**

If the user selects the wrong customer, enters a plausible but wrong quantity, chooses the wrong product, or types a valid but unintended price, the data may be technically valid. AWJ must not claim such input is correct merely because validation passes.

### 6.2 Human Review Summary

Human review exists to help the user catch **semantically plausible but unintended data**.

On mobile, where the whole document is not simultaneously visible, a concise review surface is valuable before a consequential final action.

The review should emphasize information humans can sanity-check quickly:

- customer identity;
- invoice/document date and important context;
- branch/warehouse when relevant to the workflow;
- item count;
- item names;
- quantities;
- unit prices;
- discounts where material;
- tax treatment/amounts as appropriate;
- subtotal;
- discount total;
- tax total;
- **final invoice total prominently**;
- payment/due context where relevant;
- warnings or validation issues.

The goal is not to reproduce every form field. The goal is to make mistakes such as **wrong customer, wrong product, wrong quantity, wrong price, or an unexpectedly high/low total** visually discoverable by the human operator.

Each review block should offer a direct path back to edit the relevant section.

### 6.3 Document Preview

Preview answers a different question:

> **What will the customer-facing invoice document look like?**

It should use the real AWJ document rendering/preview path when implemented, not a fake summary card pretending to be the printed invoice.

Preview should be available on demand and, on mobile, may open full-screen so the user can inspect the customer-facing document and return to editing without losing state.

**Review Summary ≠ Document Preview.**

Both may exist because they serve different purposes.

## 7. Mobile review gate

### Proposed rule

A Human Review Summary should be shown before a **consequential final invoice action** on mobile when that action creates the business/accounting/legal effect defined by AWJ's actual invoice lifecycle.

The exact final-action label and lifecycle semantics must come from the production invoice domain and are **not invented by this design document**.

### Draft save

Saving a draft should **not require the full human review gate by default**. Draft remains editable and should preserve speed/recovery.

Normal validation required to preserve data integrity still applies.

### Important accounting rule

The design layer must not redefine what `issue`, `post`, `approve`, `finalize`, `send`, or equivalent actions mean. Before implementation, the Document Workspace must map its UI actions to the existing AWJ invoice lifecycle and accounting/ZATCA semantics exactly.

## 8. Review Summary information hierarchy

The mobile review surface should be optimized for rapid sanity checking.

Recommended hierarchy:

1. **Customer** — visually prominent identity.
2. **Final total** — visually prominent monetary amount.
3. **Items** — product, quantity, unit price, line total; enough detail to detect unexpected values.
4. **Financial breakdown** — subtotal, discounts, tax, final total.
5. **Critical document context** — date, due/payment context, branch/warehouse/currency where applicable.
6. **Validation and warnings** — clearly separated by severity.
7. **Edit links/actions** — direct return to the relevant section.
8. **Final contextual action** — only when lifecycle/domain rules permit.

The final total must not be hidden below long secondary metadata.

## 9. Error, warning, and informational semantics

Do not treat every concern as the same yellow warning.

The Document Workspace must distinguish:

- **Blocking error:** the system/domain says the action cannot proceed.
- **Warning:** the action may proceed under the actual domain rules, but the user should review something meaningful.
- **Information:** useful context that does not imply a problem.
- **Human sanity check:** prominent data shown for review even though the system has no evidence it is wrong.

A technically valid but unusually high or low invoice amount must not automatically be labeled an error unless AWJ has an explicit rule/evidence for doing so. The review UI instead makes the total prominent so the human can detect intent mismatch.

Future anomaly detection, AI, customer-history comparison, price-deviation detection, or policy thresholds would be separate capabilities requiring their own requirements and confidence/false-positive handling; they are not assumed by this pattern.

## 10. Item review on mobile

The item review must remain compact but meaningful.

For each line, prioritize:

- product identity;
- quantity and UOM where relevant;
- unit price;
- discount when present/material;
- tax treatment/amount when relevant;
- line total.

Long invoices should not render an unbounded review wall. The prototype should test grouped/expandable line review while preserving the ability to inspect every line before the final action.

The user must be able to jump from a reviewed line directly to editing that line.

## 11. Contextual mobile action area

The phone bottom region may host pattern-owned actions when this materially improves completion speed.

Examples include Draft Save and the domain-correct final action. Exact actions, labels, ordering, destructive treatment, and availability must be derived from actual invoice lifecycle/state/permissions.

The action area must not obscure totals, validation messages, keyboard input, or the last editable content. Safe-area insets and mobile browser UI must be handled.

## 12. State preservation

Opening Review Summary or Document Preview must not discard unsaved form state, item edits, scroll context, or validation state.

Returning from Review to edit a customer/line/amount should return the user to the relevant context with minimal navigation cost.

If the user changes data after review, the Review Summary must reflect the new data before the consequential final action.

## 13. Desktop optional review

Desktop/laptop do not require a separate mandatory review page by default because the document workspace can expose the relevant context concurrently.

However, the pattern may provide an optional review/summary command if user testing shows value, or if a particular document type has a domain/legal workflow that genuinely requires explicit confirmation.

Do not force all Document Workspace types into identical review behavior merely for visual consistency.

## 14. Reference prototype corrections

The previous App Shell visual reference should be interpreted with these corrections:

- the visible `1 → 2 → 3 → 4` invoice stepper is **not approved** as the default invoice interaction model;
- desktop/laptop should demonstrate a Single Document Workspace;
- tablet should demonstrate responsive recomposition of that workspace;
- mobile should demonstrate responsive sections;
- mobile should demonstrate Human Review Summary before the consequential final action;
- Document Preview remains a separate on-demand capability;
- global mobile Bottom Navigation remains non-approved;
- a mobile contextual bottom action area may be shown when justified by the invoice pattern.

## 15. Prototype scenarios required

The next invoice prototype should demonstrate at least:

1. desktop/laptop invoice entry with line grid and totals visible in one workspace;
2. constrained-height laptop behavior;
3. tablet landscape/portrait recomposition;
4. mobile invoice entry with several items;
5. mobile Human Review Summary with a clearly visible customer and final total;
6. a plausible human mistake scenario such as a wrong but technically valid quantity/price, demonstrating why review is valuable without falsely claiming automated detection;
7. a blocking validation error and direct edit path;
8. on-demand full-screen mobile Document Preview;
9. returning from Review/Preview without losing state;
10. draft save without forced full review.

## 16. Pattern-first implication

This Sales Invoice is the proving case for `Document Workspace Pattern V2`, not a one-off screen design.

The reusable pattern should eventually define:

- document identity/header;
- contextual commands;
- parties/context;
- line-item editing;
- totals;
- additional information;
- validation semantics;
- responsive recomposition;
- human review policy;
- preview policy;
- action/state ownership;
- accessibility and keyboard/touch behavior.

Other documents may specialize these rules, but they should not invent a new interaction grammar without a documented reason.

## 17. Explicit non-approvals

This document does not approve:

- a mandatory global invoice wizard;
- the previous 4-step visual stepper;
- a global mobile Bottom Navigation bar;
- any new accounting or ZATCA lifecycle;
- any new anomaly/AI detection;
- automatic warnings based solely on a designer's assumption that an amount is unusual;
- exact final-action wording before production lifecycle verification;
- production implementation.

## 18. Next deliverable

Create the corrected high-fidelity AWJ Sales Invoice / Document Workspace V2 reference prototype using these interaction rules and the App Shell V2 direction.

The prototype should validate the pattern across desktop/laptop/tablet/mobile rather than merely producing a beautiful single-size mockup.

Only after owner review of the interaction and visual reference should implementation planning begin.

---

**No merge, deploy, production release, accounting change, API change, database change, permission change, entitlement change, route change, or tenant-isolation change is authorized by this document.**
