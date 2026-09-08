# AWJ Supplier Master V2 — Visual & Interaction Specification

Status: Design specification / supplier proving case for `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md`. Documentation only; no production/API/DB/accounting change.

## 1. Role

Supplier Master V2 is a procurement/payables workspace, not a renamed Customer screen. Customer and Supplier may reuse internal primitives, but the user-facing information architecture and actions must reflect their different business roles.

Primary questions:
- Who is this supplier?
- Is the supplier Individual or Commercial?
- What do we owe this supplier and what is due/overdue?
- What purchases, returns and outgoing payments relate to the supplier?
- What procurement/payables action can the authorized user perform next?

## 2. Current AWJ baseline

The current Suppliers list already filters the shared Partner API by `type=supplier`, supports Individual/Commercial filtering, city/contact filters, statement and ledger links, and uses `PartnerDialog` with `defaultType="supplier"` for create/edit.

The current supplier route also has dedicated statement and ledger surfaces. This proves supplier-specific navigation exists even though the underlying record is currently shared with Partner.

V2 must not expose the internal `customer / supplier / both` role selector.

## 3. Canonical Full Supplier Workspace

`Identity Header → Contextual Command Bar → Compact Payables Summary → Section Navigation → Active Operational Content`

### Identity Header
- Profile photo for Individual.
- Organization logo for Commercial.
- Fallback avatar when no image exists.
- Supplier name.
- Supplier code where applicable.
- Individual / Commercial badge.
- Active / inactive state.
- Compact contact line where useful.

### Contextual actions
Candidate actions, subject to permissions and actual domain support:
- Edit supplier.
- New purchase invoice.
- New purchase order where supported.
- Register outgoing supplier payment.
- Supplier statement / ledger.
- Export/print/share where supported.
- Secondary actions in overflow.

Customer sales actions must never leak into Supplier Master merely because both currently reuse Partner internals.

## 4. Compact Payables Summary

Use dense ERP summary facts rather than large dashboard cards. Candidate facts:
- Current supplier balance / amount payable.
- Open payable amount.
- Due / overdue amount.
- Last purchase or last payment context where useful and authoritative.

All accounting values come from authoritative backend/accounting outputs. UI presentation must not invent payable calculations.

## 5. Section model

Supplier-oriented sections should be based on actual supported capabilities:
- Details.
- Purchase invoices.
- Outgoing payments.
- Supplier statement / ledger.
- Purchase orders where supported.
- Purchase returns / supplier credits where supported.
- Balance context.
- Timeline.
- Activity / audit where supported.

Do not copy Sales invoices, customer quotations, customer credit semantics or other Customer-only concepts into Supplier Master.

Desktop/laptop: dense Tabs where appropriate.
Mobile: responsive recomposition/Accordion where appropriate while preserving the same logical sections.

## 6. Individual versus Commercial

The same entity-type principle applies to Supplier, but supplier-specific validation must be confirmed before implementation rather than blindly copied from Customer.

### Individual supplier
Candidate identity presentation:
- Full name.
- Profile photo.
- Approved personal identifier where genuinely required.
- Contact information.
- Address.

### Commercial supplier
Candidate identity presentation:
- Trade/business name.
- Organization logo.
- Commercial Registration / approved commercial identifier.
- VAT number where applicable.
- Representative/contact person when modeled.
- Contact information.
- Address.

Do not render irrelevant fields from the other entity type as empty form noise.

## 7. Supplier relationship settings

Supplier classification is supplier-specific and must not be confused with customer classification.

Future implementation inspection should determine the actual supported procurement relationship settings before adding them to V2. Do not invent supplier credit/payment-term fields solely for visual symmetry with Customer.

## 8. Consequential accounting actions

Supplier opening balance is an accounting-sensitive operation, not an ordinary mutable profile property.

Outgoing payments and balance corrections must remain explicit authorized accounting operations with auditability and ledger integrity. Profile editing must never silently rewrite posted financial history.

## 9. Quick Create versus Full Workspace

Quick Supplier Create remains useful from Purchase/Purchase Order workflows. It should capture the minimum valid supplier identity/contact data and return the user to the procurement transaction.

It must not expose the full supplier ledger or consequential accounting operations.

Full Supplier Workspace is used for complete identity, procurement relations, payables context, statement and activity.

## 10. Responsive and bilingual contract

Verify deliberately in Arabic RTL and English LTR across desktop/laptop/tablet/mobile, including:
- supplier name and long organization names;
- money/sign semantics;
- VAT/CR/IDs;
- phone/email;
- purchase/payment references;
- tabs/accordion/action directionality;
- long translated labels.

## 11. Customer ↔ Supplier boundary

Shared Master Record grammar:
- Identity Header.
- Individual/Commercial entity type.
- Photo/logo/fallback avatar.
- Active state.
- Contact/address presentation.
- Contextual actions pattern.
- Compact financial summary pattern.
- Related-record sections.
- Timeline/activity.
- Quick Create + Full Workspace coexistence.
- consequential-action separation.

Customer-specific:
- Sales invoices.
- Customer quotations.
- Incoming/received payments.
- Customer classification / price list / credit policy.
- Receivables-oriented balance language.

Supplier-specific:
- Purchase invoices.
- Purchase orders where supported.
- Outgoing supplier payments.
- Supplier classification.
- Purchase returns / supplier credit relationships.
- Payables-oriented balance language.

Internal model reuse must not erase these business distinctions.

## 12. Known implementation gaps intentionally deferred

- Supplier profile photo/logo storage/API/UI.
- Final supplier Individual/Commercial field and validation matrix.
- Dedicated Supplier full profile route if V2 chooses to stop routing through generic Partner profile.
- Removal/internal retention of `Partner.type=both`.
- Supplier-specific payment-term/settings contract if needed.
- Exact purchase/payment/return relationships and permissions.

These require deliberately scoped implementation inspection/PRs; they are not part of this documentation checkpoint.

## 13. Acceptance as a proving case

Supplier Master V2 validates the pattern when it shares the Master Record grammar with Customer without becoming a renamed copy, keeps procurement/payables semantics clear, preserves accounting/security/tenant integrity, and works equally in Arabic/English and responsive layouts.
