# AWJ Document View Workspace V2 — Pattern Specification

**Status:** Proposed design-system contract — docs only  
**Scope:** Post-save / post-finalization document viewing and actions  
**Production code:** Unchanged  

## 1. Purpose

AWJ documents do not end at Create/Edit. The document experience is a continuous lifecycle:

`Create/Edit → Review → Post/Finalize → View & Actions`

`Document View Workspace` is the canonical read/action workspace shown after a document has been saved or finalized. It is not a PDF viewer and it is not a generic record-details page.

The first proving case is Sales Invoice. Purchase Invoice is the second comparison case. Existing production behavior is the functional baseline: V2 must not silently remove working accounting, inventory, payment, attachment, printing, revision, or lifecycle capabilities.

## 2. Core principle

> **Document View Workspace = operational document page + authentic document preview.**

The authentic preview is a first-class region, but it is not the entire workspace.

For document types supported by the AWJ Document Engine, the preview should render the real document representation used for print/PDF rather than a decorative screenshot or a separately recreated approximation.

For finalized/frozen documents, historical rendering must respect the document's frozen revision/definition where the domain already provides that behavior.

## 3. Canonical anatomy

A Document View Workspace should compose these regions when applicable:

1. **Document Identity Header**
   - document type and number
   - primary lifecycle status
   - relevant independent statuses such as payment/receipt state
   - key party/date/amount context when useful

2. **State-aware Command Bar**
   - only actions valid for the document type, current state, permissions, tenant/branch context, and accounting rules
   - primary consequential action visually distinct
   - secondary/export actions grouped without overwhelming the workspace

3. **Actual Workflow Indicator**
   - may represent the verified real workflow
   - must not invent persisted backend lifecycle states
   - is guidance, not a wizard that fragments the workspace

4. **Authentic Document Preview**
   - real AWJ document rendering when available
   - collapsible where this improves operational efficiency
   - print/PDF/thermal behavior remains governed by the actual document-output contracts

5. **Operational Details**
   - business metadata not sufficiently communicated by the rendered document
   - notes and domain-specific operational facts

6. **Financial Summary**
   - totals and financial state in a compact, trustworthy presentation
   - financial values use established AWJ numeric/monetary conventions

7. **Relations Workspace**
   - examples: payments, notes/attachments, inventory movements, accounting entries, linked documents
   - Desktop/Laptop baseline: Tabs when horizontal space is sufficient
   - Mobile/narrow baseline: Accordion/stacked disclosure for the same relationships
   - responsive recomposition must not remove information or capability

8. **Activity / Revision History**
   - lifecycle/audit history where supported

## 4. Actions are state- and permission-aware

Actions must come from actual domain capability, not a universal menu. Examples may include Edit Draft, Post/Finalize, Record Payment, Create Return/Credit document, Duplicate, Add Note/Attachment, Print, PDF, Share, spreadsheet export, thermal print, Cancel/Reverse, or Delete Draft.

This specification does **not** authorize new accounting transitions, APIs, database states, or permissions. V2 visual design must map to the existing/approved domain operation and permission model.

Consequential actions must not be enabled merely because they fit visually.

## 5. Actual Workflow Stepper contract

There is no universal decorative `1 → 2 → 3 → 4` wizard.

An **Actual Workflow Stepper** may be used when it truthfully represents the verified document workflow without inventing persisted lifecycle states or splitting the Single Document Workspace into artificial pages.

Rules:

- Stepper does not change accounting, API, DB, or lifecycle contracts.
- A step cannot bypass an allowed transition.
- UX `Review` is not a persisted backend status unless the domain actually persists it.
- The final stage name comes from the real operation (`Post`, `Approve`, `Issue`, etc.).
- `Save Draft` does not require Human Review by default.
- Validation, Human Review, Preview, and workflow progress are separate concepts.
- Completed/current/available/blocked states must not rely on color alone.
- Arabic RTL authors sequence deliberately from the right; English LTR deliberately from the left while preserving logical workflow order.

After finalization, the header may communicate completed workflow progress, but independent financial/fulfilment states such as `Unpaid / Partial / Paid` or receipt status should normally remain independent statuses unless the verified domain workflow explicitly makes them lifecycle stages.

## 6. Responsive behavior

### Desktop / Laptop

- Keep the workspace operational and information-dense.
- Authentic preview can be prominent, but must not monopolize the viewport.
- Relations may use Tabs with the active relation content in the same region.
- High-frequency actions remain quickly reachable.

### Tablet

- Preserve the same mental model with responsive recomposition.
- Avoid creating a separate tablet-only workflow.

### Mobile

Priority order is generally:

`Identity & status → critical contextual actions → key financial/context summary → document preview → operational relations/history`

- Do not shrink an A4 document until it becomes unreadable and call that mobile support.
- Preview may be collapsed, scaled appropriately, or opened into a focused/full-screen viewing experience.
- Relations use Accordion/stacked disclosure rather than cramped horizontal tabs when space is insufficient.
- Contextual document actions belong to the document pattern; do not introduce a universal global bottom navigation.

## 7. Arabic / English requirements

Every proving implementation must verify:

- Arabic RTL authored deliberately.
- English LTR authored deliberately.
- header, actions, workflow indicator, tabs/accordion, tables, preview controls, arrows/chevrons.
- mixed-direction values: money, dates, invoice numbers, SKU/barcodes, references.
- text expansion and long party/document labels.
- Desktop, Laptop, Tablet, and Mobile.

## 8. Current Sales Invoice functional baseline

The current Sales Invoice detail route already demonstrates important functional capabilities that V2 should preserve unless separately changed by an approved domain task:

- independent detail route after creation/save
- draft vs posted behavior
- lifecycle and payment status badges
- draft edit/post/delete
- duplicate
- payment action when posted and not fully paid
- sales return creation when posted
- notes/attachments
- print, PDF, share, spreadsheet export, and thermal output where available
- authentic `InvoiceDocument` preview inside `DocumentScaler`
- document preview collapse/expand
- details and financial summary
- related payments, notes/attachments, inventory movements, and accounting entries
- Desktop relations as Tabs and narrow/mobile relations as Accordion
- revision/activity history
- frozen output/template behavior for posted documents where already implemented

This is a **functional baseline, not a visual freeze**. V2 may improve hierarchy, density, grouping, responsive composition, and interaction clarity without discarding valid capabilities.

## 9. Purchase Invoice comparison note

Purchase Invoice already has a dedicated detail workspace with similar preview/actions/relations concepts. It is the second proving case for this pattern.

The pending Purchase Payment Alignment work changes the purchase payment contract and removes the legacy Purchase `payment_type` concept. Therefore the V2 Purchase View specification must be based on the verified post-alignment contract, not on the legacy field currently visible on `main`.

Do not merge visual redesign with that accounting/payment-contract change.

## 10. Explicit non-goals

This document does not:

- implement UI code;
- change accounting behavior;
- change APIs or database schema;
- change Tenant Isolation or RBAC;
- redesign ZATCA behavior;
- authorize merge/deploy;
- force all document types into identical actions;
- turn Document Workspace into a multi-page wizard;
- make the printable A4/PDF representation the whole application page.

## 11. Proving sequence

1. Reconcile the general Document Workspace docs with this full-lifecycle contract and Actual Workflow Stepper rule.
2. Define Sales Invoice View V2 visual/interaction direction against the real current route.
3. Compare Purchase Invoice after the payment-alignment contract is verified.
4. Validate the full pattern against a mature non-invoice document selected from the actual repository implementation.
5. Only then generalize further document-family rules.
