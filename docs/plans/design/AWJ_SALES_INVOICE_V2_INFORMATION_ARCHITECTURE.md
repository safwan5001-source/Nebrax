# AWJ Design System V2 — Sales Invoice Information Architecture

**Status:** PROVING-CASE IA / DESIGN BASELINE — NOT IMPLEMENTATION AUTHORIZATION  
**Date:** 2026-09-08  
**Pattern:** Document Workspace V2  
**Source of truth inspected:** current `InvoiceForm`, `StoreInvoiceRequest`, invoice controller/service lifecycle paths on `main`.

This document maps the real AWJ Sales Invoice surface into the Document Workspace V2 pattern. It is intentionally grounded in current production-domain fields and behavior. It does not authorize or redefine accounting, posting, ZATCA, inventory, payment, permissions, APIs, database structures, tenant isolation, or lifecycle semantics.

## 1. Confirmed current lifecycle relevant to design

The current create/edit form operates on the editable invoice/draft surface and exposes two distinct completion intents:

- **Save Draft**
- **Save & Post**

The current submit flow creates or updates the invoice first, then calls `POST /invoices/{id}/post` when the post intent is selected.

Current invoice status filtering includes:

- `draft`
- `posted`
- `cancelled`

The design must preserve the actual domain meaning of these states and transitions. It must not rename `post` to `issue`, `approve`, or another term unless a separate domain/lifecycle decision explicitly changes the product terminology.

## 2. Confirmed real data surface

The current sales invoice supports, directly or conditionally:

- customer/partner;
- invoice number preview for creation;
- invoice date;
- due date / payment-term helper;
- ZATCA document type (`standard` / `simplified`);
- warehouse;
- price list;
- cost center;
- salesperson;
- invoice-level discount;
- shipping;
- adjustment;
- tax-inclusive/exclusive mode;
- notes;
- draft print/PDF design override;
- paid-already state;
- payment method;
- payment reference;
- cash/bank account;
- line product or free description;
- quantity;
- UOM;
- unit price;
- tax rate;
- line discount;
- minimum-price override reason when applicable;
- line cost-center allocations;
- calculated subtotal/tax/final total.

The pattern must not silently remove these capabilities merely to simplify the visual reference.

## 3. Information hierarchy

### 3.1 Primary — always easy to reach and visually dominant

These fields/data define the everyday invoice-entry workflow:

1. **Customer**
2. **Invoice identity / number**
3. **Invoice date**
4. **Line items**
   - product/service identity or free description;
   - quantity;
   - UOM where applicable;
   - unit price;
   - line discount;
   - tax;
   - line total.
5. **Financial Summary**
   - subtotal;
   - relevant discount/tax/charges;
   - **final total**.
6. **Primary document actions**
   - Save Draft;
   - Save & Post, subject to real permission/state/domain rules.

The line-item surface is the main working area on desktop/laptop and should receive the largest practical width.

### 3.2 Conditional — visible/prominent only when the workflow makes them relevant

- **Due date / payment-term helper** — relevant to due/credit context.
- **Paid already** — gateway to immediate collection details.
- **Payment method / reference / cash account** — shown only when immediate collection is selected, while preserving the current safe state behavior.
- **Minimum-price override reason** — relevant only when the line is below the configured minimum-price boundary and the real domain requires an override path.
- **Line cost-center allocations** — relevant when allocation is enabled for that line.
- **UOM selector** — materially relevant when a product has alternate units.
- **Price-list apply behavior** — relevant when a price list is selected and active.
- **Warehouse** — may become more prominent when inventory context requires explicit operator attention.

Conditional does not mean optional in the domain. It means the UI exposes it according to actual state/context rather than giving it permanent prime space.

### 3.3 Secondary — available without competing with customer/items/totals

Baseline secondary information:

- warehouse when normal/default selection is sufficient;
- price list;
- document-level cost center;
- salesperson;
- notes.

The current form already places warehouse, price list, cost center, and salesperson after the main commercial/financial workflow. V2 should preserve that productivity principle while improving the presentation and access model.

### 3.4 Advanced / specialized — deliberate progressive disclosure

Candidates:

- ZATCA document type;
- draft print/PDF design override;
- tax-inclusive/exclusive mode when not routinely changed;
- adjustment;
- detailed cost-center allocation controls;
- specialized pricing override details.

This classification is a visual/interaction hierarchy only. Any field that is legally, fiscally, operationally, or configuration-wise required must remain discoverable and correctly enforced.

## 4. Desktop/laptop target composition

Sales Invoice V2 should be a **Single Document Workspace**.

Recommended reading/working order:

1. compact Document Header + current state/identity;
2. compact Command Bar;
3. Customer + essential document context;
4. Line Items — largest working surface;
5. Commercial adjustments where used;
6. Financial Summary with prominent final total;
7. conditional Payment section;
8. Additional Information / operational-accounting metadata;
9. Notes;
10. validation/error summary when needed.

Do not add a mandatory Review page on desktop/laptop by default.

Do not put a permanent totals sidebar beside the line grid if it materially reduces line-entry width. The current implementation explicitly moved totals below the commercial adjustments because a side column consumed valuable grid width. V2 should preserve that insight and test any alternative against constrained widths before accepting it.

## 5. Constrained-height laptop behavior

The design must work when width is adequate but height is limited.

Priorities:

- keep App Shell/Page Header/Command Bar vertically compact;
- avoid large section headers and excessive card padding;
- let line items receive useful viewport height;
- keep primary actions reachable without creating multiple sticky layers;
- avoid sticky elements covering the last editable row or validation message;
- do not require scrolling through secondary metadata before reaching totals/actions.

## 6. Tablet target composition

Tablet preserves the same document mental model.

### Landscape

- customer/context can remain multi-column;
- line-item relationships should remain tabular where practical;
- secondary line details may use expansion/sheet/edit surface;
- totals remain directly reachable.

### Portrait

- customer/context stack more aggressively;
- lines use a compact list plus dedicated editing surface when the dense grid no longer works;
- financial summary remains compact;
- secondary/advanced information uses deliberate progressive disclosure.

Tablet does not require the mobile Human Review gate merely because the layout reflows; whether a separate review is valuable should be validated against simultaneous context and interaction testing.

## 7. Mobile entry architecture

Mobile is not a shrunken desktop grid and not a rigid 4-step wizard.

Recommended document sections:

1. **Customer & Invoice**
2. **Items**
3. **Totals / Commercial adjustments**
4. **Payment** when relevant
5. **Additional information**

Sections may collapse/reopen, but the user can navigate back to any section without step-locking.

### Items on mobile

The entry surface must make it easy to:

- scan every existing line;
- add a line;
- identify product/service;
- see quantity and line total at a glance;
- open a focused line editor for quantity, UOM, unit price, discount, tax, description, allocations, or override details as applicable;
- return to the list without losing state.

Do not render each line as an oversized generic card if a denser, clearer record-row composition works better.

## 8. Mobile action model

The phone bottom region is owned by the Document Workspace, not global navigation.

For the current Sales Invoice lifecycle, the baseline actions are:

- **Save Draft** — may execute directly after required integrity validation;
- **Save & Post** — must pass through Human Review Summary before the consequential post action.

The global mobile shell remains Header + Drawer/Search.

The contextual action area must respect safe areas, keyboard visibility, validation messages, and the last editable content.

## 9. Mobile Human Review Summary — exact information hierarchy

The review is designed to expose plausible human mistakes that automated validation cannot prove.

### 9.1 First viewport / highest prominence

1. **Customer identity**
2. **Final invoice total**
3. **Invoice date**
4. **Number of line items**
5. Current validation/blocking state if any

The user should not have to scroll past secondary metadata to see customer and final total.

### 9.2 Line review

For every line prioritize:

- product/service identity or description;
- quantity;
- UOM when applicable;
- unit price;
- line discount when non-zero/material;
- tax rate/amount where useful;
- line total.

Every reviewed line needs a direct edit path.

Long invoices may use compact expandable/grouped review, but every line must remain inspectable before posting.

### 9.3 Financial breakdown

Show according to actual calculation/domain values:

- subtotal;
- invoice discount when present;
- shipping when present;
- tax total;
- adjustment when non-zero;
- **final total again with strongest numeric emphasis**.

### 9.4 Critical conditional context

Show when relevant:

- due date / payment context;
- Paid already state;
- payment method/reference when immediate payment is declared;
- warehouse when operationally material;
- price-list context when useful for verification;
- ZATCA document type when the user is expected/authorized to choose it and the distinction matters before posting;
- branch/company context when needed to prevent consequential posting in the wrong context.

### 9.5 Secondary information

Cost center, salesperson, notes, design override, and other secondary metadata should not displace customer/items/totals. They can appear in a compact expandable details region if review value exists.

## 10. Why Human Review is required before mobile Save & Post

The current application already protects several provable integrity conditions, including required customer, valid quantities, allocation consistency, and backend domain validation.

But a technically valid invoice may still be semantically wrong because the operator intended something else:

- wrong customer selected;
- wrong product selected;
- quantity `10` instead of `1`;
- price `1,800` instead of `180`;
- wrong but valid warehouse;
- wrong payment context;
- unexpectedly high/low total caused by otherwise valid entries.

The system must not invent a warning merely because a number looks unusual. The Human Review surface makes the critical values visually obvious and lets the operator decide whether they match intent.

## 11. Validation vs Review vs Preview

### Validation

Answers: **Can AWJ prove something is invalid or requires attention under existing rules?**

### Human Review

Answers: **Is this the transaction the operator intended?**

### Document Preview

Answers: **What will the rendered/customer-facing invoice look like?**

These are separate surfaces/responsibilities and must not be collapsed into one generic confirmation screen.

## 12. Preview behavior

Preview remains on-demand.

On mobile it may open full-screen using the real document-rendering path when implemented.

Opening/closing Preview must not:

- post the invoice;
- silently save/finalize it;
- lose unsaved line edits;
- reset validation state;
- return the user to the beginning of the document.

## 13. Current behavior worth preserving

The current implementation contains several deliberate safety/productivity choices that V2 should not regress:

- new line quantity starts empty rather than silently defaulting to `1`;
- a touched line with missing/invalid quantity blocks safe save behavior instead of being silently dropped;
- customer lookup is restricted to customer/both partner types;
- selecting a customer can suggest its active default price list and ZATCA document type;
- immediate-payment details are gated by `Paid already` and hidden without discarding entered state;
- the server remains authoritative for minimum-price override enforcement and permission;
- cost-center allocation totals are validated;
- totals preview avoids floating-point money calculations and is intended to mirror backend rules;
- tenant/branch-owned references are checked by backend boundaries;
- posted invoices are not treated as ordinary editable drafts.

A visual redesign must preserve these behavioral safeguards unless a separately approved domain change supersedes them.

## 14. Visual design implications

The V2 reference should therefore show:

- a quiet neutral App Shell consistent with the current App Shell V2 direction;
- compact Page Header/Command Bar;
- customer identity with high visual priority;
- line grid as the dominant desktop working surface;
- financial numbers aligned and easy to scan;
- final total strongly emphasized without a decorative KPI-card treatment;
- conditional sections that appear only when relevant;
- restrained Additional Information;
- clear field/row validation;
- no large dashboard cards;
- no decorative icon tiles;
- no permanent wizard/stepper;
- no global mobile bottom navigation;
- mobile contextual actions only;
- separate Human Review and Document Preview.

## 15. Required visual-reference scenarios

The Sales Invoice V2 visual reference must include at minimum:

1. standard desktop create/edit workspace;
2. constrained-height laptop;
3. tablet landscape;
4. tablet portrait;
5. mobile entry with multiple lines;
6. mobile focused line editing;
7. mobile Human Review before Save & Post;
8. mobile full-screen Preview;
9. blocking validation error with direct edit path;
10. plausible-but-valid human mistake visible in Review without fake anomaly detection;
11. immediate-payment conditional state;
12. secondary/advanced information expanded state;
13. long Arabic label / large monetary value stress case;
14. English LTR sanity case.

## 16. Non-approvals

This IA does not approve:

- production UI implementation;
- changing `post` semantics or accounting effects;
- changing invoice statuses;
- new approval workflow;
- new ZATCA behavior;
- new payment behavior;
- new inventory behavior;
- autosave;
- AI/anomaly detection;
- warning thresholds based on guessed user intent;
- removing currently supported fields;
- changing permissions;
- changing APIs/database;
- weakening tenant/branch isolation;
- a universal document wizard;
- global mobile Bottom Navigation.

## 17. Next design deliverable

The next deliverable is the **AWJ Sales Invoice V2 Visual Specification**, translating this IA into exact region placement and responsive behavior for desktop/laptop/tablet/mobile.

That specification should be reviewed before any production implementation plan is created.

---

**No merge, deploy, production release, accounting change, API change, database change, permission change, entitlement change, route change, or tenant-isolation change is authorized by this document.**
