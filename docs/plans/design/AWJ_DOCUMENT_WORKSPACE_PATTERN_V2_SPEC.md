# AWJ Design System V2 — Document Workspace Pattern V2

**Status:** PATTERN SPECIFICATION / DESIGN BASELINE — OWNER REVIEW REQUIRED BEFORE IMPLEMENTATION  
**Date:** 2026-09-08  
**Pattern family:** Document Workspace  
**First proving case:** Sales Invoice

This document turns the Sales Invoice interaction direction into a reusable AWJ page/workspace pattern. It defines design and interaction architecture only. It does not redefine accounting, tax/ZATCA, posting, document lifecycle, permissions, APIs, database structures, tenant isolation, numbering, inventory effects, or business rules.

## 1. Pattern purpose

Use Document Workspace V2 for business documents whose primary job is to create, inspect, edit, validate, and act on a structured transaction/document with header context, parties, line items or detail content, totals, status, and lifecycle actions.

Candidate families include sales invoices, purchase invoices, quotations, purchase orders, delivery notes, credit/debit notes, returns, and other transactional documents where the business model genuinely fits this pattern.

Do not use it merely because a screen has a form.

## 2. Pattern-first rule

AWJ follows:

> **Screen → Approved Page/Workspace Pattern → Shared Components → Design Tokens**

A new document screen should begin from this pattern and specialize business content/rules. It should not invent a new shell, action grammar, validation language, responsive model, line-item experience, or mobile review model without a documented reason.

Pattern reuse must never flatten real accounting, operational, permission, or lifecycle differences between document types.

## 3. Document Workspace anatomy

The reusable pattern contains these logical regions:

1. **Document Identity / Page Header**
2. **Contextual Command Bar**
3. **Document Context**
4. **Party / Counterparty Context**
5. **Primary Detail / Line Items**
6. **Totals / Financial Summary** where applicable
7. **Additional Information**
8. **Validation / Alerts**
9. **Human Review** when required by device/workflow
10. **Document Preview** when a customer/vendor-facing representation exists
11. **Lifecycle / State Feedback**

Not every document needs every region. The pattern defines ownership and behavior, not mandatory decorative boxes.

## 4. Document Identity / Page Header

The header establishes what document the user is working on without consuming excessive vertical space.

It may contain:

- document type/title;
- document number or draft identity;
- lifecycle status;
- compact breadcrumbs only when useful;
- concise contextual metadata that materially improves orientation.

It must not become a large marketing-style hero header.

Status semantics must come from the real document domain. Visual labels must not invent states the backend does not have.

## 5. Contextual Command Bar

The command bar owns current-document actions.

Candidate actions include Save Draft, Save, Approve, Post/Issue/Finalize, Print, Preview, PDF, Duplicate, Cancel/Void, Delete, More actions, or domain-specific operations.

### Rules

- exact actions and wording are document-domain owned;
- primary action reflects the current state and permission truthfully;
- unavailable actions must have intentional hidden/disabled behavior based on UX and security semantics;
- destructive/irreversible actions receive appropriate distinction and confirmation;
- do not duplicate the same primary action in Global Header, Sidebar, and document body;
- keyboard access and visible focus are mandatory;
- overflow secondary actions rather than creating a wide action wall;
- action availability must never substitute for server authorization.

## 6. Document Context

Document Context contains transaction-level fields such as date, due date, currency, branch, warehouse, payment terms/method, project, cost center, salesperson, reference, or other document-specific fields.

The pattern does not prescribe a universal field list.

### Field hierarchy

Classify fields as:

- **Primary:** frequent or materially important to completing the document.
- **Conditional:** appears/activates because of document type, customer/supplier, tax, currency, branch, inventory, or other domain state.
- **Secondary:** useful but not worth occupying prime workspace continuously.
- **Advanced:** infrequent and appropriate for progressive disclosure.

Do not expose every available database field merely because space exists.

## 7. Party / Counterparty Context

For documents involving a customer, supplier, employee, or other party, selection must be treated as a first-class business lookup rather than a generic text field.

The selected party region should make identity easy to verify and may show only high-value supporting data such as tax identity, contact, address, balance/credit context, or other domain-approved information.

Changing the party must trigger the real dependent-domain behavior and validation defined by the application. The design must not silently assume what should reset or recalculate.

On mobile Human Review, party identity is visually prominent because a technically valid wrong party is a plausible human error.

## 8. Primary Detail / Line Items

For line-based documents, the line area is the primary working surface.

### Desktop/laptop

Prefer a dense editable grid/table when the workflow is naturally tabular.

The grid should support the actual business columns while protecting scanability. Candidate concepts include product/service identity, description, quantity, UOM, unit price, discount, tax, line total, warehouse, dimensions/classifications, and row actions.

Not all columns belong in every document or at every width.

### Interaction principles

- rapid keyboard progression for professional users;
- predictable add-line behavior;
- efficient product/service lookup;
- clear active/editing state;
- inline validation attached to the relevant row/cell;
- totals recalculate according to domain rules;
- destructive row removal is deliberate but not cumbersome;
- bulk/repeated entry patterns should not require excessive modal hopping;
- long descriptions and Arabic text must not destroy grid usability.

### Tablet

Preserve table relationships where practical. Recompose secondary columns through detail expansion, side sheet, row editor, or other deliberate mechanisms rather than blindly converting every row into a large card.

### Mobile

Do not force a desktop grid into a narrow viewport.

Use a dedicated compact line list + line editor/detail surface, or another tested mobile composition that preserves product, quantity, price, discount/tax context, and line total. The user must be able to scan existing lines and edit any line efficiently.

## 9. Totals / Financial Summary

For financial documents, totals are a first-class region, not footer decoration.

The region may include subtotal, discounts, taxable base, taxes, charges, rounding, paid/remaining context, and final total according to the actual document domain.

### Rules

- final amount receives the strongest numeric emphasis;
- use AWJ financial typography/number formatting conventions;
- values align consistently for scanning;
- negative/positive semantic colors are used only when they carry real financial meaning;
- totals remain reachable during line-entry workflows without covering important content;
- on mobile, the final total is prominent in the Human Review Summary.

The UI must not recalculate independently from a different formula than the authoritative domain logic.

## 10. Additional Information

Secondary document data belongs in a controlled additional-information region: notes, references, delivery/payment details, attachments, classifications, custom/optional metadata, and other document-specific information.

Use progressive disclosure when this protects the primary workflow. Do not hide legally/accounting-critical information merely to make the screen look clean.

## 11. Validation and alerts

Validation is continuous or occurs at appropriate interaction boundaries.

The pattern distinguishes:

- **Blocking Error** — action cannot proceed under actual domain rules.
- **Warning** — meaningful issue to review but action may proceed if domain permits.
- **Information** — useful context without implying a problem.
- **Human sanity-check data** — values shown prominently because intent cannot be validated automatically.

### Behavior

- attach field/line errors as close to the source as possible;
- provide a summary when multiple problems exist;
- summary entries should navigate to the relevant field/line;
- preserve user input while resolving errors;
- do not generate speculative warnings from UI assumptions;
- do not use AI/anomaly language unless such capability actually exists and is separately specified.

## 12. Human Review policy

Human Review is not a universal wizard step.

### Desktop/laptop

No mandatory separate Review page by default because enough document context can be visible simultaneously. Optional review may exist where a specific document workflow benefits from it.

### Mobile

A concise Human Review Summary is proposed before a consequential final action for documents where the narrow viewport prevents simultaneous visual verification.

Prioritize:

1. party identity;
2. final total;
3. line items with product/quantity/unit price/line total;
4. discounts/taxes/financial breakdown;
5. critical document context;
6. validation/warnings;
7. direct edit paths;
8. final action.

Saving a draft does not require full Human Review by default.

The exact consequential action and its semantics come from each document's real lifecycle.

## 13. Document Preview policy

Preview is separate from Human Review.

**Review asks:** Is this the transaction I intended?  
**Preview asks:** What will the customer/vendor-facing document look like?

Where a rendered document exists, Preview should use the real rendering path when implemented and be available on demand.

On mobile it may open full-screen. Closing Preview returns to the same editing/review state without losing unsaved work.

## 14. Lifecycle and state model

The pattern supports document states but does not define them.

Each adopting screen must map:

- backend/domain states;
- allowed transitions;
- permissions;
- accounting/inventory/tax/ZATCA effects;
- reversibility;
- immutable/frozen fields after relevant transitions;
- audit requirements;
- UI labels/actions.

No design implementation may infer lifecycle semantics from button names alone.

## 15. Desktop composition

Desktop/laptop baseline is a **Single Document Workspace**, not a sequential wizard.

Recommended composition characteristics:

- compact Page Header + Command Bar;
- primary document/party context above or beside the detail surface according to available width;
- line grid receives the largest practical working area;
- totals remain easy to inspect;
- secondary information does not crowd primary entry;
- broad data screens use available width rather than decorative centered max-width layouts;
- constrained-height laptops are explicitly tested.

Exact columns and region placement may vary by document subtype within the pattern.

## 16. Tablet composition

Tablet keeps one document mental model while reflowing regions.

Landscape may preserve more desktop relationships. Portrait may stack document/party sections and use dedicated detail editing for lines.

The shell may move global navigation to overlay independently of the Document Workspace's internal recomposition.

Do not equate tablet with oversized phone.

## 17. Mobile composition

Mobile uses responsive sections and dedicated task surfaces rather than a miniaturized desktop form.

Candidate flow within one document mental model:

- Document Context;
- Party;
- Items;
- Additional Information;
- Financial Summary;
- Human Review before consequential final action;
- optional full-screen Preview.

The user can return to any editable region without artificial wizard locks.

The global App Shell remains compact Header + Drawer/Search. A bottom area may host **contextual document actions** when useful; it is not global navigation.

## 18. State preservation and navigation

The pattern must preserve work across:

- opening/closing drawers/sheets;
- item editing;
- Review;
- Preview;
- validation navigation;
- responsive recomposition where technically feasible;
- accidental navigation protections according to existing application policy.

Review must refresh after edits. Direct edit links should return to the relevant context. Preview must not silently persist/finalize a document.

## 19. Loading, empty, error, and success states

Every implementation must define:

- initial loading/skeleton state;
- lookup loading/empty/error;
- line-item empty state with clear first action;
- calculation/update pending state where relevant;
- save-in-progress state;
- save failure preserving user data;
- validation failure;
- permission/state conflict;
- stale/concurrent update handling where supported by the domain;
- successful draft save;
- successful consequential action;
- offline/network degradation behavior where relevant to the existing product.

Do not use a generic green success screen for every action if the user needs to continue working in the document.

## 20. Unsaved changes

The pattern must deliberately handle unsaved changes.

Leaving the workspace, changing a context that would invalidate entered lines, closing mobile editing, or other destructive navigation should follow existing AWJ policy/domain behavior and must not silently discard work.

Do not introduce autosave as a design assumption unless the document domain actually supports it safely.

## 21. Permissions and security

- Server authorization remains authoritative.
- Tenant isolation is never a visual concern alone and must remain enforced by backend/domain boundaries.
- Hidden/disabled actions must reflect permission/state truthfully but do not provide security themselves.
- Sensitive financial data such as cost/profit must respect existing permissions.
- Review/Preview must not expose fields the user is not authorized to view.
- Branch/company context must remain clear before consequential actions.

## 22. Accessibility

The pattern must support:

- semantic labels and relationships;
- full keyboard operation for desktop data entry;
- logical RTL/LTR focus order;
- visible focus;
- touch targets appropriate to tablet/mobile;
- errors associated with fields/rows;
- error summary navigation;
- screen-reader understandable totals and statuses;
- accessible dialogs/drawers/sheets with focus management;
- no color-only state meaning;
- browser zoom/text scaling;
- reduced motion;
- long Arabic labels and localization expansion.

## 23. RTL/LTR

Arabic RTL is a first-class authored layout, not a post-processing mirror.

Review:

- field alignment;
- numeric alignment;
- table column order;
- directional icons;
- chevrons;
- drawer/sheet entry direction;
- breadcrumbs;
- action order;
- mixed Arabic/Latin identifiers;
- currency/number presentation;
- keyboard progression.

English LTR must remain equally coherent.

## 24. Density

Document Workspace is an ERP productivity surface.

Use balanced high information density, compact controls where appropriate, restrained whitespace, strong grouping without excessive cards, and no decorative dashboard treatment.

Density may relax on touch devices but should not turn each field into an oversized consumer-app block.

## 25. Reusable component candidates

Implementation planning may later map the pattern to shared components such as:

- `DocumentHeader`
- `DocumentCommandBar`
- `DocumentContextSection`
- `PartyLookup/PartySummary`
- `DocumentLineGrid`
- `MobileLineEditor`
- `DocumentTotals`
- `DocumentValidationSummary`
- `DocumentReviewSummary`
- `DocumentPreviewTrigger/Surface`
- `DocumentMobileActionBar`
- `DocumentStatus`

These names are conceptual only. Do not create components merely to match this list if existing AWJ components can be evolved safely.

## 26. Adoption checklist per document type

Before adopting the pattern, specify:

1. document type and purpose;
2. lifecycle states/transitions;
3. consequential final action(s);
4. permissions;
5. tenant/company/branch scope;
6. party type and lookup rules;
7. primary document fields;
8. line/detail model;
9. totals/calculation authority;
10. tax/ZATCA implications where applicable;
11. inventory implications where applicable;
12. validation rules already enforced by domain;
13. human-review fields;
14. preview/rendering source;
15. desktop/tablet/mobile specialization;
16. keyboard/touch requirements;
17. loading/error/success states;
18. audit/immutability requirements;
19. backward-compatibility constraints;
20. tests required before implementation acceptance.

## 27. First proving case — Sales Invoice

Sales Invoice remains the first reference implementation because it exercises nearly every part of the pattern: party selection, financial context, line items, discounts/taxes, totals, document rendering, responsive entry, human review, and consequential lifecycle actions.

However, Sales Invoice-specific fields or lifecycle semantics must not be promoted into the generic pattern unless they genuinely apply to other document types.

## 28. Explicit non-approvals

This specification does not approve:

- a universal document wizard;
- a universal four-step stepper;
- a universal set of document fields;
- a universal final action name;
- new accounting/posting/ZATCA behavior;
- new autosave behavior;
- new anomaly/AI detection;
- global mobile Bottom Navigation;
- identical mobile/desktop composition;
- blind table-to-card conversion;
- production implementation.

## 29. Design acceptance gate

A Document Workspace design is not ready for implementation until it demonstrates:

- real document content rather than placeholders;
- desktop and constrained-height laptop productivity;
- tablet landscape and portrait;
- mobile entry, line editing, totals, Review, and Preview where applicable;
- Arabic RTL and English LTR;
- keyboard/touch/focus behavior;
- loading/empty/error/success states;
- long Arabic labels and large monetary values;
- permission-sensitive content/actions;
- no loss of accounting/domain semantics;
- no invented backend state;
- clear distinction between Validation, Human Review, and Preview;
- consistency with App Shell V2 and AWJ Design Quality Bar.

## 30. Next step

Use this pattern specification to produce and review the **Sales Invoice Document Workspace V2 visual reference** across the required viewport/state matrix.

After the Sales Invoice proves the pattern, validate the same grammar against at least one purchase-side document and one non-invoice document before declaring Document Workspace V2 mature enough for broad implementation.

No production implementation should begin merely because this document exists.

---

**No merge, deploy, production release, accounting change, API change, database change, permission change, entitlement change, route change, or tenant-isolation change is authorized by this specification.**
