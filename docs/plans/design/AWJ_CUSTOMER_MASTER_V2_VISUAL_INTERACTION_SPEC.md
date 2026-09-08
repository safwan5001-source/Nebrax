# AWJ Customer Master V2 — Visual & Interaction Specification

Status: Design specification / proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Customer Master V2 is the first business-party proving case for Master Record Pattern V2. The page is not a saved form; it is the customer's operational workspace.

Primary questions it must answer quickly:
- Who is this customer?
- Is the customer Individual or Commercial?
- What is the customer's current financial position?
- What is due/overdue?
- What transactions and payments relate to the customer?
- What action can the authorized user perform next?

## 2. Canonical desktop anatomy

`Identity Header → Contextual Command Bar → Compact Financial Summary → Section Navigation → Active Operational Content`

### Identity Header
Show prominently:
- Profile photo for Individual, organization logo for Commercial, fallback avatar when absent.
- Customer display name.
- Customer code where applicable.
- Entity type badge: Individual / Commercial.
- Active / inactive state.
- One compact contact line where useful.

Do not expose Customer/Supplier/Both as a user-facing role selector. This workspace is Customer Master.

### Contextual Command Bar
Prioritize a small number of frequent actions and move secondary actions to overflow.

Candidate actions, subject to actual permissions/domain support:
- Edit customer.
- New sales invoice.
- New quotation.
- Register/receive payment.
- Customer statement.
- Export/print/share where supported.
- Overflow for less frequent actions.

Permissions and business state determine visibility/enabled state. Do not present unavailable financial actions as decorative disabled controls without a useful reason.

### Compact Financial Summary
Use dense ERP summary facts rather than oversized dashboard cards. Candidate facts:
- Current/closing balance.
- Open amount.
- Due/overdue amount.
- Credit limit/exposure where configured.

All accounting values must be authoritative backend/accounting outputs. The client presentation must not invent alternative accounting calculations.

## 3. Section model

Preserve and rationalize useful capabilities already present in the current Partner Profile:
- Details.
- Sales invoices.
- Payments.
- Ledger / customer statement.
- Quotations.
- Balance/credit context where needed.
- Returns / credit notes where functionally relevant.
- Timeline.
- Activity / audit where supported.

Avoid tabs that contain no meaningful customer capability. Section names must describe user tasks, not internal model names.

Desktop/laptop: dense Tabs are preferred when they fit without horizontal chaos.
Mobile: recompose the same section model using compact navigation/Accordion as appropriate. The user must not lose section context when crossing responsive breakpoints.

## 4. Details — entity-aware rendering

### Individual
Prioritize personal identity:
- Full name.
- Profile photo.
- National/personal identifier if approved and applicable.
- Gender/birth date only if approved as genuine business requirements.
- Contact information.
- Address.

Do not render empty company-only fields such as Commercial Registration merely to preserve form symmetry.

### Commercial
Prioritize organization identity:
- Trade/business name.
- Organization logo.
- Commercial Registration / approved commercial identifier.
- VAT number where applicable.
- Representative/contact person when modeled.
- Contact information.
- Address.

Do not render person-only fields merely as empty placeholders.

## 5. Business relationship settings

Keep separate from legal/entity identity:
- Customer classification.
- Default price list.
- Credit period.
- Credit limit.
- Active/inactive state.

Individual customers may still have price lists or credit terms; those settings do not change their entity type.

## 6. Consequential accounting actions

Opening balance is not a mutable profile field. It is an explicit accounting-sensitive operation.

Any create/correct/reverse opening-balance flow must preserve AWJ accounting rules, authorization, auditability and ledger integrity. A future visual implementation must not provide an ordinary text input that silently rewrites posted accounting history.

The same principle applies to other consequential financial operations reachable from Customer Master.

## 7. Quick Create versus Full Workspace

Quick Customer Create remains available inside transaction entry where supported. It captures the minimum valid customer identity/contact data needed to continue the transaction.

It must not duplicate the full workspace or expose consequential accounting operations.

After creation, the user may open the Full Customer Master Workspace for complete identity, commercial settings, financial relations and activity.

## 8. Mobile composition

Mobile priority order:
1. Identity: avatar/logo, name, type and status.
2. Essential financial summary.
3. Primary contextual action(s).
4. Section navigation/content.
5. Secondary details/activity.

Avoid a persistent global bottom navigation inside this pattern. Any bottom action area must be pattern-owned and justified by a focused editing/action flow.

Do not shrink desktop tables blindly. Transaction/ledger sections need responsive record presentation or controlled horizontal behavior according to the DataTable/document rules.

## 9. Arabic RTL / English LTR

Verify deliberately:
- Header/action ordering in both directions.
- Tabs/Accordion affordances.
- Money alignment and sign semantics.
- Customer code, VAT/CR/ID, phone, email and mixed-direction content.
- Long Arabic and English business names.
- Long translated action labels.

Direction mirroring must never change financial meaning or logical workflow order.

## 10. Visual character

Follow AWJ Design System V2 direction:
- dense daily-accounting workspace;
- neutral surfaces;
- restrained hierarchy;
- no decorative gradients/heavy shadows;
- no oversized SaaS dashboard cards;
- semantic colors only for meaningful state/financial semantics;
- clear numbers and financial alignment;
- image/logo supports identity without dominating the workspace.

## 11. Current architecture mapping

The existing Partner Profile already provides a substantial base: details, invoices, payments, statement/ledger, quotations, balance-related information, timeline/activity and responsive Tabs/Accordion behavior.

V2 should evolve this capability rather than replace it with an unrelated screen model.

Known future implementation gaps are intentionally outside this documentation scope:
- Profile photo/logo storage/API/UI.
- Approved Individual-specific identity fields missing from the current Partner contract.
- Commercial representative modeling if needed.
- User-facing removal of `both` and any backend contract cleanup.
- Final Saudi/ZATCA-sensitive validation matrix.

## 12. Proving-case acceptance

Customer Master V2 validates Master Record Pattern V2 when it demonstrates:
- clear identity without form clutter;
- entity-aware Individual/Commercial presentation;
- separate Customer and Supplier UX;
- fast operational/financial context;
- explicit consequential actions;
- coexistence of Quick Create and Full Workspace;
- usable responsive recomposition;
- Arabic/English parity;
- no accounting/security/tenant semantics invented by the UI.
