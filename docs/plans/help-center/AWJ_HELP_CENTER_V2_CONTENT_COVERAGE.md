# AWJ Help Center V2 — PR-HELP-2B Content Coverage Matrix

**Scope:** PR-HELP-2B — Content Coverage  
**Baseline:** `main` at `26fa6dff8234a1ccfcdbd450e28d8f58729bb043`  
**Method:** Compare the shipped navigation and implemented screens with the ten V1 articles and the centralized contextual-help mapping delivered in PR-HELP-2A. A route is not treated as evidence that an article is needed; rows represent user workflows that are implemented and materially benefit from in-product guidance.

## Priority model

- **P1:** frequent daily work, financially or operationally sensitive work, or a multi-state workflow where incorrect use has material impact.
- **P2:** useful operational coverage with lower frequency or risk.
- **P3:** specialist or administrative coverage that should be considered after the core workflows.
- **N/A:** navigation placeholder or a screen that does not justify a dedicated article.

## Baseline matrix

This matrix is the pre-implementation audit. The delivery decision column defines the bounded set that PR-HELP-2B will validate against the actual UI before content is written. If the UI does not provide enough evidence for accurate documentation, the row remains a gap rather than being filled with assumptions.

| AWJ screen / workflow | Existing help article | Baseline coverage | Missing content | Priority | PR-HELP-2B delivery decision |
|---|---|---:|---|---:|---|
| Dashboard and first-use orientation | `first-steps` | Covered | — | P1 | Preserve |
| Active branch selection | `switch-active-branch` | Covered | — | P1 | Preserve |
| Sales invoices | `create-sales-invoice` | Covered | — | P1 | Preserve |
| Customer receipts | `record-customer-payment` | Covered | — | P1 | Preserve |
| Purchase invoices | `record-purchase-invoice` | Covered | — | P1 | Preserve |
| Products | `create-product` | Covered | — | P1 | Preserve |
| Stocktakes | `run-stocktake` | Covered | — | P1 | Preserve |
| Manual journals | `manual-journal-entry` | Covered | — | P1 | Preserve |
| Accounting period locks | `period-locks` | Covered | — | P1 | Preserve |
| POS session and sale | `pos-session-and-sale` | Covered | — | P1 | Preserve |
| Customers and suppliers | — | Missing | Create a partner with its real type and contact/account fields | P1 | Added: `create-partner` |
| Sales quotations | — | Missing | Create a quotation, its line/tax fields, and its actual lifecycle | P1 | Added: `create-sales-quote` |
| Delivery notes and invoice draft | — | Missing | Create/confirm a delivery note and use eligible confirmed notes in an invoice draft | P1 | Added: `delivery-notes` |
| Sales returns and credit notes | — | Missing | Explain the implemented return/credit workflows without inventing posting behavior | P1 | Deferred; corrective flows need a dedicated accounting review |
| Purchase request to purchase order | — | Missing | Explain the implemented procurement stages and transitions | P2 | Deferred; the multi-document transition set is larger than this bounded increment |
| Purchase returns and debit notes | — | Missing | Explain the implemented corrective-document workflow | P1 | Deferred; corrective flows need a dedicated accounting review |
| Inventory opening balances | — | Missing | Prerequisites, import/manual entry, validation, and implemented status behavior | P1 | Added: `import-inventory-opening` |
| Stock permits | — | Missing | Actual permit types, fields, statuses, and stock effect shown by the UI | P1 | Added: `stock-permits` |
| Cash and bank transfers | — | Missing | Same-currency account transfer fields and real validation rules | P1 | Deferred; access-control finding requires separate owner review |
| Expenses | — | Missing | Create and review an expense using current fields/statuses | P1 | Added: `record-expense` |
| Fiscal years: create, close, reopen | — | Missing | Permission prerequisites, readiness checks, blockers, acknowledgement, and history | P1 | Added: `fiscal-year-close` |
| Reports catalog | — | Missing | How to select and run the reports that are actually registered | P2 | Deferred; lower priority than the delivered daily/risk workflows |
| Warehouses and inventory balances | `create-product`, `run-stocktake` | Partial | Dedicated warehouse/balance administration guidance | P2 | Defer; current articles cover the linked daily tasks |
| Recurring invoices | `create-sales-invoice` | Partial | Template scheduling and run lifecycle | P2 | Defer to a later coverage increment |
| Supplier payments and refunds | `record-purchase-invoice` | Partial | Settlement/refund-specific flow | P2 | Defer to a later coverage increment |
| Chart of accounts, routing, assets, cost centers | `manual-journal-entry`, `period-locks` | Partial | Specialist accounting administration | P2 | Defer; requires its own focused accounting review |
| HR, documents, fuel stations, developer tools, and application settings | — | Missing | Specialist module guidance | P3 | Defer; outside the prioritized core workflow set |
| Navigation placeholders without an implemented user workflow | — | Not applicable | — | N/A | Do not create articles from route/navigation presence alone |

## Safety rules for this matrix

- Contextual mappings are added only after the corresponding article is validated against an implemented screen.
- An article action is optional. It is omitted when the existing frontend does not expose enough permission context to render a protected deep link safely.
- Help content describes observable UI and existing validation only; it does not define accounting, permission, or tenant semantics.
- Findings in product behavior are recorded separately and are not fixed in PR-HELP-2B.

## Validated implementation evidence

| Delivered workflow | Evidence reviewed in the application |
|---|---|
| Customers and suppliers | Partner create page and shared form: party type, entity type, contacts, national address, opening balance, credit controls, and default customer price list |
| Sales quotations | Quote create/detail pages: customer, validity, tax mode, line fields, issue/revision lock, and conversion to an invoice with credit payment terms |
| Delivery notes | Delivery-note form/list/detail and permission constants: draft, confirmation, cancellation reason, invoice eligibility, and separate action permissions |
| Inventory opening balances | List/import/detail pages and import contract: file inspection, mapping, preview blockers, draft creation, posting, and immutability |
| Stock permits | List/create/detail pages: receipt/issue/transfer, warehouse selection, entered versus average cost, draft, and posting effect |
| Expenses | Expense list/create/detail pages: expense account, classification, supplier/vendor, cost center, attachments, draft operations, and posting |
| Fiscal years | Fiscal-year screen and tests: view/manage/close/reopen permissions, readiness groups, acknowledgement, period-lock blocker, generations, and event history |

## Findings intentionally not fixed

- The cash/bank transfer screen displays and updates `allow_negative_transfer_balance` on the same page without an explicit frontend permission check. PR-HELP-2B does not change authorization or finance settings, so no article or contextual mapping was added for this screen pending a separate security/ownership review. Backend authorization remains authoritative.
- Existing locale data emits `next-intl` warnings for dotted keys under `developer.events`. These pre-date PR-HELP-2B and are not modified here.

## Coverage measurement

The baseline contains **10 covered priority workflows and 10 contextual mappings**. PR-HELP-2B raises this to **17 documented workflows and 17 contextual mappings**. The seven additions are counted only after content, Arabic/English parity, related-reference, and route-mapping tests pass.
