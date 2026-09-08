# AWJ Document Workspace V2 — Lifecycle & Stepper Reconciliation

**Status:** Authoritative reconciliation for Design System V2 docs — docs only  
**Date:** 2026-09-08  
**Related:** `AWJ_DOCUMENT_VIEW_WORKSPACE_V2_SPEC.md`

## 1. Why this reconciliation exists

Earlier Document Workspace and Sales Invoice design documents correctly rejected a **universal decorative wizard / fixed four-step stepper**. Some wording, however, can be read as rejecting every stepper. The owner decision is more precise and supersedes that blanket interpretation.

## 2. Authoritative rule

> **No decorative or universal wizard/stepper. An Actual Workflow Stepper may be used when it truthfully represents the document's verified workflow without inventing persisted lifecycle states or fragmenting the Single Document Workspace.**

Therefore phrases such as `no permanent wizard/stepper`, `no wizard/stepper`, `the visible 1 → 2 → 3 → 4 stepper is not approved`, or `no rigid 4-step wizard` remain valid **only as rejection of a universal/decorative/sequential wizard model**. They must not be interpreted as a ban on an Actual Workflow Stepper.

## 3. Actual Workflow Stepper semantics

The stepper is a visual orientation aid over the real workflow. It is not a new accounting or document state machine.

For Sales Invoice, the verified persisted lifecycle currently includes `draft`, `posted`, and `cancelled`, with `post` as the consequential operation. A UX Review stage may exist before posting without pretending that `review` is a persisted backend status.

A conceptual UI sequence may therefore communicate:

`Edit → Review → Post`

provided that:

- `Review` is clearly a UX stage unless the backend later gains an approved persisted review state;
- `Post` maps to the actual post operation;
- the user is not forced through separate wizard pages;
- Save Draft remains available according to actual rules;
- validation remains independent from workflow progress;
- permissions and server lifecycle rules remain authoritative.

## 4. Full Document Workspace lifecycle

The pattern now explicitly covers the full user journey:

`Create/Edit → Human Review when applicable → Post/Finalize → View & Actions`

`View & Actions` is a first-class state of the Document Workspace family, defined in `AWJ_DOCUMENT_VIEW_WORKSPACE_V2_SPEC.md`.

The post-save/post-finalization experience must not be treated as an unrelated generic details page.

## 5. Preview distinction

There are three distinct concepts:

- **Validation:** can AWJ prove the data/action violates a rule or requires attention?
- **Human Review:** does the operator believe the valid transaction matches their intent?
- **Document Preview:** what does the rendered customer/vendor-facing document look like?

The Actual Workflow Stepper is a fourth concept: **where am I in the verified document workflow?**

None of these should be collapsed into another.

## 6. After posting/finalization

After a document is finalized, the workflow indicator may show completed lifecycle progress where useful. Independent business states must remain independent.

For example, Sales Invoice payment state (`Unpaid / Partial / Paid`) is normally not another linear step after `Post`; it is a financial status that can evolve after posting. Purchase receipt/settlement states likewise must not be forced into a linear stepper unless the verified domain explicitly models them that way.

## 7. Device behavior

### Desktop / Laptop

- Single Document Workspace remains the baseline.
- Actual Workflow Stepper, when used, is compact orientation—not page navigation.
- No mandatory separate Review page by default unless the actual workflow requires it.

### Tablet

- Same document mental model; responsive recomposition.
- Stepper may compact/relabel without changing semantics.

### Mobile

- Responsive sections and focused editing remain the baseline.
- Human Review may be required before a consequential final action where reduced simultaneous context creates material human-error risk.
- A compact Actual Workflow Stepper/progress treatment may orient the user without step-locking sections.

## 8. RTL/LTR

The workflow sequence is logical, not merely graphical.

- Arabic RTL: deliberately authored from the right.
- English LTR: deliberately authored from the left.
- Directional connectors/chevrons mirror appropriately.
- Completed/current/available/blocked meaning must not rely on color alone.

## 9. Documents reconciled by this decision

This decision applies to the interpretation of:

- `AWJ_DOCUMENT_WORKSPACE_PATTERN_V2_SPEC.md`
- `AWJ_DOCUMENT_WORKSPACE_V2_INVOICE_INTERACTION_DIRECTION.md`
- `AWJ_SALES_INVOICE_V2_INFORMATION_ARCHITECTURE.md`
- `AWJ_SALES_INVOICE_V2_VISUAL_SPEC.md`
- `AWJ_DOCUMENT_VIEW_WORKSPACE_V2_SPEC.md`

The legacy phrases currently found in the Sales Invoice IA (`no permanent wizard/stepper`) and Sales Invoice Visual Spec (`no wizard/stepper`) are explicitly reconciled by the authoritative rule above: they reject a decorative/universal/sequential wizard, not an Actual Workflow Stepper grounded in the verified workflow.

The generic Pattern wording rejecting a `universal four-step stepper`, and the Invoice Interaction wording rejecting a permanent `1 → 2 → 3 → 4` wizard as the default, are already consistent with this rule.

If any older wording is read more broadly, **this reconciliation governs the Stepper/lifecycle interpretation**. Future edits to those documents should use the authoritative wording above and must not reintroduce a blanket ban on truthful workflow orientation.

## 10. Safety boundary

This reconciliation authorizes no production implementation, accounting change, API change, database state, permission change, ZATCA change, Tenant Isolation change, merge, deploy, or release.
