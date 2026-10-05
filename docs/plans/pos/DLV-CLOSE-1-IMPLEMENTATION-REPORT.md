# DLV-CLOSE-1 — POS Session Close & Z-Report Delivery Separation

**Status:** IMPLEMENTED — PR pending review/merge
**Implementation base:** `ac67e67add4e2edb3887d7812e931aeca12c09c7`
**Scope:** Manual POS session reporting only. No imported-order financial posting,
VAT/tax-point work, settlement, commission, reconciliation, connector, or refund
architecture is implemented by this task.

## Proven pre-change behavior and gap

`PosService` creates every manual POS invoice with the authoritative
`invoices.pos_session_id`. For `platform_collected`, it then creates the accepted
platform-receivable-clearing `Payment` with `method=bank` and deliberately leaves
`payments.pos_session_id` null. Merchant-collected delivery sales use the ordinary
session-bound tender flow.

`PosSessionService::cashMovement()` and `expectedNonCashTenderRows()` already read
only posted received payments whose `pos_session_id` is the session. Therefore the
platform-clearing payment was already excluded from drawer and terminal
expectations despite its legacy `bank` representation. The session report also
already reads posted invoices by `invoices.pos_session_id`, so it includes the
canonical gross sale. The missing piece was a safe delivery-channel presentation
alongside those gross sales.

## Implementation

The session-report endpoint now derives an additive `report.delivery_platforms`
section from the same loaded, tenant/branch/session-scoped invoice collection that
forms its sales totals. It joins only immutable `DeliveryInvoiceContext` rows and
their pinned profile/version snapshots. It returns:

- total delivery-channel sales and invoice count;
- platform-collected and merchant-collected informational subtotals;
- a deterministic row per historical platform-profile version, with the pinned
  display metadata and the central platform key.

The X/Z report renders a compact **Delivery platforms** section only when such
rows exist. It uses the central platform presentation registry for the known brand
mark/name and a neutral monogram/name fallback for an unknown key. No second
registry or current-profile re-read was introduced.

## Close and accounting semantics

| Concept | Source and treatment |
|---|---|
| Gross session sales | `report.gross_sales` from posted invoices explicitly linked by `invoices.pos_session_id`; delivery invoices remain visible here. |
| Physical/cashier tender expectation | Posted received payments explicitly linked by `payments.pos_session_id`; unchanged. |
| Platform-collected delivery sale | Appears in gross and delivery-channel totals only; its clearing payment has no session and cannot create cash/card/bank expectation or variance. |
| Merchant-collected delivery sale | Appears in gross and delivery-channel totals; its ordinary session tender appears once in the existing cash/card expectation. |

The delivery section is informational and is never added to expected tender. A
merchant-collected amount is intentionally visible in both its channel total and
its one physical tender total; those are different report dimensions, not two
collections.

No Invoice customer, Payment routing, ledger posting, stock movement, COGS,
revenue, or canonical POS close reconciliation authority changes. In particular,
`Invoice.partner_id` remains the actual/default customer and the accepted
platform-receivable-clearing path remains intact.

## Session attribution and isolation

No new session linkage was inferred. The implementation relies exclusively on the
existing `Invoice.pos_session_id` written by manual POS checkout. Context lookup is
also constrained by the session's tenant and branch and by the already scoped
invoice IDs. A foreign tenant or active branch cannot obtain a report for the
session. Historical invoices without `DeliveryInvoiceContext` retain their former
behavior and produce an empty delivery section.

## Refund / return boundary

Existing session-level posted return totals and physical cash-refund treatment are
unchanged. This task does not derive a delivery-specific refund breakdown because
the required provider/canonical refund linkage belongs to `DLV-REFUND-1`. Delivery
channel sales are posted-sale totals, not a newly invented net-of-refund measure.

## Verification

Focused feature coverage verifies:

- ordinary cash and bank/session tender expectations remain unchanged;
- platform-collected sales are shown in gross/channel figures but absent from
  expected cash, expected card/bank rows, and close variance;
- merchant-collected cash and bank sales are counted once in their ordinary
  session tender and also in delivery-channel information;
- a mixed session has exact non-duplicated totals;
- sessions with no delivery context retain an empty/zero additive section;
- tenant and active-branch report access remains isolated.

Existing POS session tests continue to cover canonical return behavior; no
delivery refund policy was added.

## Dependency impact and next Horizon candidate

`DLV-CLOSE-1` closes the manual-POS reporting separation identified by
`DLV-POS-1` and PASS-8. It does not unblock imported financial posting or any
PASS-8 DG-3 evidence/policy/VAT-projection/accounting-representability gate.

After this change there is **no additional delivery financial implementation task
promoted as dependency-ready**. `DLV-CONNECTOR-CORE-1` is the next candidate only
for a separately authorized, projection/intake-security scope; it is not promoted
by this implementation and must not add imported financial behavior. Commission,
settlement, reconciliation, refund, provider connectors, and imported-order
financial transition remain blocked by their recorded evidence/owner gates.
