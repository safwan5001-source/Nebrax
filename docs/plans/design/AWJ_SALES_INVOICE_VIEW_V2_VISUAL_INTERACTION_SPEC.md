# AWJ Sales Invoice View V2 — Visual & Interaction Specification

**Status:** Proving-case specification — owner review required before implementation  
**Date:** 2026-09-08  
**Pattern:** Document View Workspace V2  
**Production route inspected:** `web/src/app/(app)/invoices/[id]/page.tsx` on `main`

## 1. Objective

Transform the existing Sales Invoice detail page into the first complete proving case for `Document View Workspace V2` without discarding its working operational capabilities.

The target is not a PDF viewer and not a generic stack of detail cards. It is a professional accounting workspace where the user can immediately identify the invoice, understand its lifecycle/financial state, see the authentic issued document, and perform the next valid action.

## 2. Functional baseline that must be preserved

The current route already provides:

- invoice number;
- lifecycle status (`draft / posted / cancelled` as applicable);
- payment status (`unpaid / partial / paid`);
- draft post action;
- draft edit/delete;
- duplicate;
- collect/add payment when posted and not fully paid;
- create sales return when posted;
- notes/attachments;
- print;
- PDF export;
- share;
- Excel export;
- thermal print when available;
- real `InvoiceDocument` rendering inside `DocumentScaler`;
- collapsible document preview;
- details;
- financial summary;
- payments;
- notes/attachments;
- inventory movements;
- accounting entries;
- revision/activity history;
- frozen/live document-template resolution according to current document-output rules.

V2 may reorganize these capabilities but must not silently remove them.

## 3. Target desktop hierarchy

Recommended hierarchy:

```text
Document Identity + lifecycle/payment status       Primary contextual action(s) | More
Actual Workflow Indicator (compact, when useful)
──────────────────────────────────────────────────────────────────────────────
Authentic Document Preview                         Operational Summary / Quick Facts
                                                   Total / Paid / Remaining
                                                   Customer / Date / Due Date
──────────────────────────────────────────────────────────────────────────────
Relations: Payments | Notes & Attachments | Inventory | Accounting
──────────────────────────────────────────────────────────────────────────────
Activity / Revision History
```

This is a conceptual hierarchy, not a mandate for a permanent 50/50 split. The layout must respond to actual available width and document-paper readability.

## 4. Header

The first viewport must answer:

- Which invoice?
- What lifecycle state?
- What payment state?
- What is the next valid action?

### Primary identity

- localized document type + invoice number;
- lifecycle badge;
- independent payment-status badge;
- concise customer/date/total context may appear if it improves recognition without duplicating a large details block.

### Status separation

Do not visually imply that `Paid` is a lifecycle successor to `Posted`.

`Posted` describes document/accounting lifecycle.  
`Unpaid / Partial / Paid` describes financial settlement state.

They may be displayed near each other but must remain semantically independent.

## 5. Actions

### Draft

Primary/available actions may include, according to actual permissions/domain rules:

- Post;
- Edit;
- Duplicate;
- Add Note/Attachment;
- Print/PDF/Share/Excel as supported;
- Delete Draft.

### Posted and not fully paid

The operationally important action is **Record/Add Payment**. It should not be buried among low-frequency export actions when the user can validly collect against the invoice.

Other actions may include:

- Create Return;
- Duplicate;
- Add Note/Attachment;
- Print/PDF/Share/Excel;
- Thermal Print where available.

### Fully paid

Payment action disappears/changes according to actual domain capability; status remains clear.

### Action hierarchy

- one current primary action at most;
- high-frequency secondary actions remain reachable;
- export/rare actions may live in overflow;
- destructive actions separated from routine actions;
- UI visibility never replaces backend authorization.

## 6. Actual Workflow Indicator

A compact Actual Workflow Stepper may orient the user when it adds value.

For the current Sales Invoice domain, a conceptual interaction sequence may be:

`Edit → Review → Post`

but only `draft/posted/cancelled` are treated as persisted lifecycle truth unless the backend contract changes separately. `Review` is UX progress, not a fabricated stored invoice status.

After posting, the indicator may communicate completion of the posting path. Payment state remains a separate badge/financial summary.

The stepper must not become a large decorative band or force navigation through wizard pages.

## 7. Authentic Document Preview

The current real `InvoiceDocument` + `DocumentScaler` path is the correct baseline.

### Rules

- preview remains authentic to the AWJ document engine;
- do not replace it with a screenshot or duplicate HTML summary pretending to be the invoice;
- posted/frozen output continues respecting current frozen-revision behavior;
- preview remains collapsible;
- print/PDF/thermal output contracts remain independent where the engine currently resolves them independently;
- preview controls do not mix editing controls into the printed document surface.

### Desktop sizing

The preview should be prominent enough to recognize/read the document, but should not consume the entire operational page. At wide widths, prototype a composition that gives the authentic document meaningful space while keeping high-value operational/financial context immediately accessible.

At narrower desktop/laptop widths, stacking preview and operational regions is preferable to making both unusably narrow.

## 8. Operational summary / quick facts

Avoid making the user open multiple collapsed cards merely to answer routine questions.

High-value view facts include:

- customer;
- invoice date;
- due date;
- final total;
- paid amount;
- remaining amount;
- cost center when relevant/authorized.

Do not retain legacy `cash/credit payment_type` merely for visual continuity if the approved domain contract removes or supersedes it.

The final amount, paid, and remaining values should be highly scannable using AWJ financial typography, without becoming dashboard KPI tiles.

## 9. Details and financial summary

The current separate collapsible Details and Financial Summary are a functional baseline, not mandatory V2 visual structure.

V2 may combine/recompose high-value facts into a compact side/summary region on wide screens while preserving deeper details through progressive disclosure.

Principle:

> Frequent questions should not require opening several accordions; low-frequency metadata should not crowd the first viewport.

## 10. Relations

Relations remain a first-class operational region.

### Desktop / sufficient width

Use Tabs for:

- Payments;
- Notes & Attachments;
- Inventory Movements;
- Accounting.

The active tab displays its content in the same stable region.

### Mobile / insufficient width

Recompose the same relations into Accordion/stacked disclosures. This is responsive recomposition, not feature removal.

### Accounting

Accounting entries remain read-only operational evidence according to existing permissions. Financial tables must preserve numeric alignment and dense scanability.

### Inventory

Movement records remain operational/accounting evidence and should not be reduced to decorative cards on desktop.

## 11. Activity / revision history

Revision/activity history remains available but does not compete with invoice identity, document preview, financial state, or immediate actions in the first viewport.

Default collapsed behavior is acceptable when the current workflow supports it.

## 12. Mobile hierarchy

Recommended order:

1. compact invoice identity;
2. lifecycle + payment state;
3. primary contextual action;
4. high-value summary: customer, total, paid, remaining, date/due;
5. authentic document preview entry/card;
6. relations as Accordion;
7. revision/activity.

### Preview on mobile

Do not present an unreadably tiny A4 page as the only viewing experience.

The page may show a recognizable preview/thumbnail or scaled surface, but must offer a focused/full-screen document viewing experience using the authentic rendering path. Returning must preserve page context.

### Actions on mobile

Use a compact pattern-owned contextual action treatment when needed. Do not introduce global Bottom Navigation.

## 13. Tablet

Tablet preserves the same mental model.

- Landscape may use preview + summary relationships if enough real width exists.
- Portrait should stack rather than squeeze A4 and operational information side by side.
- Relations recompose according to available space, not device label alone.

## 14. Loading / errors / empty relations

Preserve deliberate states for:

- invoice loading;
- load failure with retry;
- not found with a route back;
- relations loading;
- relations unavailable;
- empty payments/notes/inventory/accounting;
- action/export progress and failure.

V2 must not trade these states for a visually cleaner happy-path-only mockup.

## 15. RTL / LTR

Arabic RTL and English LTR must both be authored/tested.

Verify:

- back affordance direction;
- action ordering;
- status grouping;
- stepper sequence/direction;
- Tabs/Accordion alignment;
- A4 preview orientation/content;
- money/date/invoice identifiers;
- mixed Arabic + Latin invoice/customer/product references;
- table numeric alignment.

## 16. Visual character

- quiet neutral shell;
- dense professional ERP workspace;
- restrained borders and elevation;
- no large marketing cards;
- no decorative colored icon boxes;
- no giant status banner;
- no unnecessary gradients;
- final monetary values strong through typography/alignment rather than spectacle;
- authentic document paper may naturally contrast against the application workspace surface.

## 17. Required prototype states

Before implementation approval, demonstrate at minimum:

1. Desktop — posted + unpaid;
2. Desktop — posted + partial payment;
3. Desktop — fully paid;
4. Desktop — draft with Post/Edit actions;
5. constrained-height laptop;
6. tablet landscape;
7. tablet portrait;
8. mobile posted invoice summary;
9. mobile full-screen authentic preview;
10. mobile relations Accordion;
11. accounting relation open;
12. invoice with several payments;
13. long invoice/document preview;
14. Arabic RTL;
15. English LTR;
16. loading/error/not-found/relations-unavailable states.

## 18. Explicit non-goals

This specification does not authorize:

- production UI changes;
- accounting or posting changes;
- new invoice statuses;
- new payment behavior;
- ZATCA changes;
- API/database changes;
- Tenant Isolation/RBAC changes;
- removal of existing functional capabilities;
- a universal four-step wizard;
- a fake persisted Review state;
- a PDF-only invoice detail page;
- global mobile Bottom Navigation;
- merge/deploy/release.

## 19. Acceptance direction

Sales Invoice View V2 is ready for implementation planning only after its prototype proves that an accountant can, with minimal navigation cost:

1. identify the invoice and customer;
2. understand lifecycle and payment state;
3. see total/paid/remaining;
4. inspect the authentic customer-facing document;
5. perform the next valid action;
6. inspect payments, inventory, accounting, notes/attachments, and history;
7. do the same coherently in Arabic RTL and English LTR across desktop/tablet/mobile.
