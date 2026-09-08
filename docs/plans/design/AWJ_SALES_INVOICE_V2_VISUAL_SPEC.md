# AWJ Design System V2 — Sales Invoice Visual Specification

**Status:** VISUAL SPECIFICATION / OWNER REVIEW — NOT IMPLEMENTATION AUTHORIZATION  
**Date:** 2026-09-08  
**Pattern:** Document Workspace V2  
**Proving case:** Sales Invoice  
**Required references:** `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`, `AWJ_V2_DESIGN_QUALITY_BAR.md`, `AWJ_APP_SHELL_V2_VISUAL_INTERACTION_DIRECTION.md`, `AWJ_DOCUMENT_WORKSPACE_PATTERN_V2_SPEC.md`, `AWJ_DOCUMENT_WORKSPACE_V2_INVOICE_INTERACTION_DIRECTION.md`, `AWJ_SALES_INVOICE_V2_INFORMATION_ARCHITECTURE.md`

This specification translates the verified Sales Invoice information architecture into a visual/responsive composition. It is a design target, not a production implementation plan. Exact pixel values remain token/component decisions unless explicitly marked as a hard behavioral constraint.

## 1. Visual objective

The Sales Invoice should feel like a professional accounting workbench: calm, dense, fast, trustworthy, and unmistakably designed around invoice entry rather than around generic SaaS cards.

The visual hierarchy should answer, in order:

1. Which invoice am I working on?
2. Who is the customer?
3. What am I selling and in what quantities/prices?
4. What is the financial result?
5. What action am I about to take?
6. Is there anything requiring attention?

## 2. Global shell relationship

The invoice does not create its own navigation system.

Use the App Shell V2 direction:

- Arabic: primary navigation on the right; English mirrored to the left.
- Quiet/neutral navigation surface as the baseline candidate.
- Compact global header containing only global context/utilities.
- No colored icon tiles or decorative navigation treatment.
- No global mobile bottom navigation.
- When space pressure requires it, global navigation becomes overlay/drawer before sacrificing the document working surface.

The invoice owns only its Page Header, document commands, workspace content, contextual panels/sheets, and mobile contextual actions.

## 3. Desktop anatomy

Recommended top-to-bottom anatomy:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Global Header — compact, global only                                    │
├───────────────┬──────────────────────────────────────────────────────────┤
│               │ Page Header: فاتورة مبيعات · draft/number              │
│ Primary Nav   │ Command Bar: Cancel | Save Draft | Save & Post          │
│               ├──────────────────────────────────────────────────────────┤
│               │ Customer + essential invoice context                    │
│               ├──────────────────────────────────────────────────────────┤
│               │ Line Items — dominant editable grid                     │
│               │                                                          │
│               ├──────────────────────────────────────────────────────────┤
│               │ Commercial adjustments                                  │
│               ├──────────────────────────────────────────────────────────┤
│               │ Financial Summary — final total strongly emphasized     │
│               ├──────────────────────────────────────────────────────────┤
│               │ Payment (conditional)                                   │
│               ├──────────────────────────────────────────────────────────┤
│               │ Additional information                                  │
│               ├──────────────────────────────────────────────────────────┤
│               │ Notes / validation                                      │
└───────────────┴──────────────────────────────────────────────────────────┘
```

This is one scrollable Document Workspace, not sequential screens.

## 4. Page Header

### Content

Primary:

- `فاتورة مبيعات` / localized equivalent;
- current number when known, otherwise draft/new identity;
- actual lifecycle status where useful.

Secondary, only when valuable:

- compact breadcrumb/back affordance;
- concise branch/company context if not already unambiguous in the Global Header.

### Visual treatment

- compact height;
- title visually clear but not oversized;
- status uses restrained semantic treatment and text, not color alone;
- no hero banner;
- no large decorative document icon;
- no duplicated customer/total here.

## 5. Command Bar

Desktop/laptop baseline:

- **Save & Post** = primary action when domain/state/permission permit;
- **Save Draft** = secondary action;
- **Cancel/Back** = quiet secondary action;
- Preview/design/other commands live as secondary or overflow according to context.

The bar should remain visually connected to the document header, not appear as a floating unrelated toolbar.

Do not make all actions equally prominent.

### Sticky behavior

A compact sticky document command treatment may be tested if long documents make actions hard to reach, but it must not create a second oversized header or consume line-grid height. Any sticky implementation must be tested on constrained-height laptops.

## 6. Customer + essential invoice context

This is the first editable region.

### Desktop wide

Use a compact grid, approximately prioritizing customer at twice the width of an ordinary field.

Recommended visible fields:

- Customer — widest/highest priority;
- invoice number preview/identity;
- invoice date;
- due/payment-term context where applicable.

ZATCA document type should not automatically occupy equal visual priority with customer/date. It belongs in a compact specialized/advanced position unless actual workflow testing proves frequent deliberate choice is required.

### Selected customer state

After selection, preserve fast re-selection but expose enough identity to sanity-check the choice. Avoid turning the customer into a giant profile card.

If customer selection drives a default price list or ZATCA type, communicate the resulting state without a noisy toast storm.

## 7. Line Items — dominant surface

The line grid is the visual center of gravity on desktop/laptop.

### Desktop wide columns

Baseline priority order for Arabic RTL should preserve a natural invoice scan path while keeping numeric columns aligned. Candidate visible columns:

- product/item;
- description;
- unit price;
- quantity;
- line discount;
- tax;
- total including VAT;
- row action.

UOM is exposed within/adjacent to the line when applicable without permanently widening every line for products that have no alternate unit.

Advanced per-line information such as cost-center allocations and minimum-price override reason should expand from the line or use a focused subordinate surface rather than permanently inflating every row.

### Density

- compact row height appropriate for daily ERP entry;
- inputs should read as an editable grid, not a collection of separate cards;
- header labels remain visible/readable;
- financial values use AWJ numeric typography and consistent alignment;
- row separators subtle but sufficient;
- active row/cell is unmistakable;
- hover/focus/validation states are stronger than decorative borders.

### Add line

`إضافة بند` belongs with the grid header/edge, not as a large full-width empty-state button once lines exist.

### Empty state

When no meaningful line exists, show a concise first-line affordance. Do not fill the workspace with illustration/marketing copy.

## 8. Commercial adjustments

Tax mode, invoice-level discount, shipping, and adjustment should not compete with line entry.

Recommended desktop presentation:

- compact horizontal/2–4 column control group below the line grid;
- show only the active discount input mode cleanly;
- shipping and adjustment remain compact numeric controls;
- advanced/help text only where needed.

Do not use four independent large cards.

## 9. Financial Summary

Keep the summary below/after the line grid and commercial adjustments as the default V2 baseline. Do not reserve a permanent 300px-style side column that harms the grid.

### Visual hierarchy

- subtotal and tax: standard financial rows;
- zero-value optional adjustments may be omitted from the visual summary;
- non-zero discount/shipping/adjustment shown explicitly;
- final total separated by spacing/divider and strongest numeric emphasis;
- final total is prominent but not a dashboard KPI tile.

### Width

On wide desktop, summary content may align to the logical end side of the document while leaving explanatory/other content on the other side, but it should remain within the document flow.

## 10. Payment section

Default state is a compact `Paid already` control.

When disabled, payment details do not consume visible workspace height.

When enabled, reveal:

- payment method;
- payment reference;
- cash/bank account.

The reveal should feel like an expansion of the same business section, not a modal detour.

Preserve the current behavior where hiding the section does not unexpectedly destroy the user's entered payment details during the same editing session.

## 11. Additional information

Warehouse, price list, document-level cost center, salesperson, and similar secondary information belong in a restrained section below the primary financial workflow.

### Desktop

Use a compact multi-column grid. The section may be collapsible if prototype testing shows it improves long-document productivity without harming discoverability.

### Advanced subgroup

ZATCA type, design override, allocation detail, and other specialized controls may use a secondary disclosure level inside the document. Do not create a third navigation hierarchy in the App Shell for them.

## 12. Notes

Notes are a simple document field, not a large content editor. Keep default height modest with resize/expansion where appropriate.

## 13. Validation visual language

### Field/cell error

- place next to the actual source;
- clear error text;
- semantic icon/color may support, never replace, text;
- preserve entered value.

### Row error

- mark the relevant row/cell;
- if the row is collapsed on tablet/mobile, its compact record must still expose that attention is required.

### Form summary

When multiple blocking errors exist, show a concise summary with jump links rather than a generic `Save failed` banner alone.

### Warnings

Only show warnings backed by real product/domain evidence. A high-looking total is not itself a warning.

## 14. Standard desktop target

Target behavior for a typical wide desktop:

- persistent expanded navigation if space permits;
- compact global/page chrome;
- customer/context mostly in one compact region;
- line grid comfortably displays its primary columns without horizontal page scrolling;
- summary remains in normal flow;
- secondary sections do not dominate the first viewport.

Do not enforce a narrow centered max-width that wastes ERP working space.

## 15. Constrained-height laptop target

This viewport is a separate acceptance case, not a scaled desktop screenshot.

### Requirements

- reduce vertical chrome before reducing useful content;
- Page Header + Command Bar remain compact;
- customer/context region uses tight but readable spacing;
- line grid should become visible quickly after entering the page;
- avoid stacking multiple sticky bars;
- primary actions remain reachable;
- if a sticky command treatment is used, it must not obscure grid rows or totals;
- secondary sections may remain below fold without hiding their existence.

The goal is to maximize working rows visible at once.

## 16. Tablet landscape

The shell may switch global navigation to overlay if persistence creates content pressure.

Inside the document:

- preserve customer/context multi-column layout where possible;
- preserve a compact line grid for core columns;
- move description/discount/tax/advanced details into row expansion or focused edit surface if necessary;
- keep line total visible in the scan row;
- totals remain in normal document flow.

## 17. Tablet portrait

Do not squeeze the desktop grid until every column becomes unreadable.

Recommended composition:

- stacked/2-column Customer & Invoice region;
- compact item records showing product, quantity, unit price or key price context, and line total;
- tap/keyboard opens a focused line-edit surface for full detail;
- commercial adjustments compactly stacked;
- financial summary prominent;
- Additional Information collapsed or lower priority.

Tablet portrait still supports serious document work and should not look like a stretched phone UI.

## 18. Mobile — top structure

No global bottom navigation.

Top area:

- compact App Header with navigation/search access;
- compact document identity row/header;
- avoid duplicating two tall title bars.

The document body is section-based and scrollable.

## 19. Mobile — Customer & Invoice section

First section should expose:

- Customer prominently;
- invoice date;
- number/draft identity;
- due/payment-term context if relevant.

Secondary specialized settings are hidden behind a clear `Additional/Advanced` affordance rather than inserted between customer and items.

## 20. Mobile — Items list

Each compact item record should answer at a glance:

- what item is this?
- how many?
- what is the resulting line amount?

Secondary line information can appear in a concise second line when materially useful.

### Focused line editor

Opening a line provides the full editable set required for that line:

- product/description;
- quantity;
- UOM;
- unit price;
- discount;
- tax;
- advanced allocations/override only when applicable.

The editor may be a full-screen mobile surface or sheet chosen after prototype testing. It must preserve unsaved document state and provide an obvious return to the item list.

## 21. Mobile — Financial Summary

After items, expose a compact summary with the final total visually strong.

Commercial adjustments can be edited from this region without making every adjustment control permanently expanded.

The user should be able to see the current final total during normal document editing before deciding to post.

## 22. Mobile — contextual action bar

Baseline contextual actions:

- secondary: **Save Draft**;
- primary: **Review & Post** (interaction label may be refined, but the actual consequential operation remains the current `post` lifecycle).

Important: the review action is not itself the posting operation. It opens Human Review; posting occurs only from the review surface after validation/domain checks.

The bar:

- sits above the safe-area inset;
- adapts/hides appropriately while the software keyboard is open;
- does not cover the final content;
- does not contain Home/Sales/global navigation destinations.

## 23. Mobile Human Review — visual composition

The Review surface is purpose-built for human sanity checking, not a copy of the edit form.

### First viewport

```text
┌─────────────────────────────┐
│ مراجعة الفاتورة             │
│ العميل: شركة المثال         │  ← strong identity
│                             │
│ الإجمالي النهائي            │
│ 18,425.00 ر.س               │  ← strongest number
│                             │
│ 4 بنود · 08/09/2026         │
├─────────────────────────────┤
│ البنود                      │
│ Product A                   │
│ 2 × 1,000.00   = 2,000.00  │
│ Product B                   │
│ 10 × 180.00    = 1,800.00  │
│ ...                         │
```

The actual prototype should use realistic AWJ data and Arabic formatting, not these placeholder amounts as product truth.

### Items

Every line remains inspectable. Use compact rows; expand details only where necessary. Provide a direct edit affordance per line/section.

### Financial breakdown

Show subtotal, actual non-zero adjustments, tax, and final total. Repeat final total near the final action if the review is long.

### Critical context

Show payment/due/warehouse/ZATCA/branch context only when relevant enough to verify before posting.

### Final action

Use the domain-correct posting action. A secondary `Back to edit` path must be obvious.

## 24. Plausible human mistake scenario

The prototype must deliberately show a case such as quantity `10` where `1` may have been intended, or price `1,800` where `180` may have been intended.

The UI must **not** label this as an automated anomaly unless a real rule exists.

The design proves its value by making customer, quantity, unit price, line total, and final total easy for the human to notice.

## 25. Mobile Document Preview

Preview is separate from Review.

- open on demand;
- full-screen is acceptable/preferred on narrow phones;
- show the real document representation when implemented;
- clear close/back control;
- preserve edit/review state;
- Preview does not post or silently save.

Do not mix edit controls into the rendered invoice itself.

## 26. Responsive transition principles

Do not rely on device names alone. Layout transitions respond to actual available space, zoom, text scaling, shell state, and content pressure.

Conceptual progression:

- **Wide:** expanded shell + full document grid.
- **Standard desktop/laptop:** expanded shell if healthy; compact document chrome.
- **Pressured desktop/tablet landscape:** shell may overlay; line grid drops secondary columns before primary financial relationships.
- **Tablet portrait:** compact item records + focused line editing.
- **Phone:** section-based document + focused line editor + contextual bottom actions + Human Review before post.

Exact breakpoints are implementation/prototype findings, not arbitrary visual-spec constants.

## 27. RTL/LTR behavior

Arabic RTL is authored deliberately.

- navigation side mirrors with locale;
- document scan order must remain natural;
- financial numbers remain consistently aligned;
- mixed SKU/Latin identifiers use correct bidi handling;
- chevrons/back affordances mirror where directional;
- item edit actions remain discoverable;
- English LTR should not be a broken mechanical mirror.

## 28. Visual tokens and style constraints

Use AWJ centralized tokens and established typography.

- no raw one-off colors;
- no gradients;
- no glassmorphism;
- no heavy shadows;
- restrained radius consistent with AWJ;
- no decorative icon containers;
- semantic colors only for real semantic meaning;
- quiet surfaces and borders;
- financial typography optimized for scanning;
- light and dark themes both deliberate.

The neutral Sidebar baseline remains the preferred reference candidate; do not make the invoice mockup dependent on a dark/saturated Sidebar.

## 29. Interaction states the visual prototype must show

At minimum:

1. empty/new draft;
2. populated draft;
3. active line editing;
4. conditional Paid already expanded;
5. below-minimum-price path when legitimately triggered;
6. line allocation expanded;
7. blocking validation error;
8. multi-error summary;
9. saving state;
10. draft save success continuation;
11. mobile Human Review;
12. return from Review to edit;
13. mobile Preview;
14. posted/read-only or post-success destination relationship, grounded in actual current product behavior;
15. long invoice with many lines;
16. long Arabic labels;
17. large monetary values;
18. English LTR sanity state.

## 30. Accessibility acceptance

The visual/reference prototype must account for:

- keyboard navigation through desktop line entry;
- visible focus;
- touch targets on mobile/tablet;
- no color-only error/status meaning;
- logical focus restoration after sheets/dialogs;
- accessible labels for compact icon actions;
- zoom/text scaling without loss of primary actions/data;
- sufficient contrast in light/dark;
- reduced-motion-safe transitions.

## 31. What is intentionally not fixed yet

This visual spec does not lock:

- exact Sidebar width;
- exact App Header height;
- exact pixel breakpoints;
- exact grid column pixel widths;
- whether mobile line editing is sheet vs full-screen surface;
- whether Additional Information is accordion vs disclosure panel;
- exact sticky-command implementation;
- final microcopy for `Review & Post`;
- any new accounting/ZATCA/payment/inventory behavior.

Those should be resolved through the high-fidelity prototype and current-domain verification, not guessed in prose.

## 32. Visual acceptance gate

The Sales Invoice reference is acceptable only if, when viewed without explanation, it clearly demonstrates:

- AWJ rather than generic SaaS identity;
- professional ERP density;
- customer/items/totals hierarchy;
- line-entry dominance on desktop;
- efficient constrained-height laptop behavior;
- deliberate tablet recomposition;
- deliberate phone recomposition;
- no wizard/stepper;
- no global phone bottom navigation;
- Human Review before mobile posting;
- Preview separate from Review;
- real validation separated from human sanity checking;
- all important current invoice capabilities remain reachable;
- no invented domain behavior.

## 33. Next step

Produce the corrected high-fidelity **AWJ Sales Invoice V2 reference prototype** from this specification and review it against the required state/viewport matrix before any implementation planning.

After visual acceptance, validate the Document Workspace pattern against one purchase-side document and one non-invoice document before broad rollout.

---

**No merge, deploy, production release, accounting change, API change, database change, permission change, entitlement change, route change, or tenant-isolation change is authorized by this specification.**
