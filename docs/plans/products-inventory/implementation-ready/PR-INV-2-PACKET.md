# Implementation-Ready Packet — PR-INV-2

**State:** GROUNDED — accounting-sensitive; implementation not authorized.
**Grounding baseline:** main `70501735051f7cd4632417b38b835e8057b1bd8d`
**Approved contract:** `../phase-1-hardening/PR-INV-2-purchase-returns.md`

## Confirmed current code

### Historical purchase UOM exists
`PurchaseLine` persists `quantity`, `unit_name`, `unit_factor`, `unit_price` and uses the unit-conversion concern. The original purchase therefore already has historical conversion evidence that a return can consume without consulting the live UnitTemplate.

### Return line loses that semantic snapshot
`ReturnLine` currently persists `quantity` and `unit_price` but no `unit_name`, `unit_factor`, or immutable base quantity. This makes purchase-return stock semantics ambiguous for an alternative-UOM source.

### Source-return limit is currently commercial quantity
`ReturnService::assertWithinSource()` sums previously posted `ReturnLine.quantity` and compares requested quantity against source-line `quantity`. This is not a base-quantity proof for purchase lines using alternative UOMs.

### Sales return already has historical-UOM precedent
`ReturnService::returnLineBaseQuantity()` already uses the original `InvoiceLine.unit_factor` snapshot for sourced sales returns. That pattern confirms the correct principle: historical source semantics, not the product's current UOM template.

### Purchase-return valuation mismatch is concrete
`postPurchaseReturn()` currently computes inventory GL credit (`1140`) from return commercial line subtotal minus discount. It then calls `InventoryService::applyIssue()` using `ReturnLine.quantity` and `ReturnLine.unit_price`. Therefore both stock quantity and inventory valuation are tied to return commercial inputs rather than immutable historical base quantity + current inventory carrying value. This can break `Δ Inventory GL 1140 = Δ Inventory Subledger`.

## FROM → TO
FROM: a purchase return can issue the wrong base quantity for an original alternate-UOM purchase, and can credit inventory GL using supplier/commercial return value while the stock subledger issue follows a different carrying-value reality.

TO: sourced purchase returns derive and persist immutable base quantity from original PurchaseLine historical UOM semantics; posting revalidates remaining returnable base quantity atomically; stock issue removes that base quantity at current inventory carrying value under AWJ's existing global moving-average model; GL 1140 credits exactly the same carrying-value delta. Supplier liability, recoverable tax and commercial return economics remain based on the commercial return document, with any required difference treatment handled explicitly by the existing purchase-return accounting architecture.

## Non-negotiable accounting invariant
`absolute(Δ Inventory GL 1140) == absolute(Δ Inventory Subledger carrying value)` in integer minor units for every tracked purchase-return line and aggregate document.

Never force supplier credit value into inventory carrying value merely to balance the journal.

## Historical UOM contract
For a sourced PurchaseLine:
- source `unit_name`/`unit_factor` is historical authority;
- return commercial quantity × historical factor yields immutable base quantity (subject to existing conversion rules);
- later UnitTemplate edits/deletes must not reinterpret the return;
- persist enough snapshot/base-quantity evidence on ReturnLine to explain the posted stock movement later;
- cumulative returned eligibility must be compared in base quantity, not ambiguous commercial quantity.

Free purchase return behavior must remain explicitly separate: absent a source, do not invent historical UOM semantics. Preserve existing behavior unless the approved contract requires otherwise.

## Concurrency / atomicity
Inside the posting transaction:
1. lock/reload return and preserve double-post guard;
2. lock/revalidate source/eligible returned base quantity sufficiently to prevent concurrent over-return;
3. lock/revalidate warehouse stock through InventoryService;
4. determine carrying-value issue under existing global moving-average architecture;
5. create inventory movement and journal consistently;
6. any failure rolls back document, stock and GL effects together.

## Proof obligations
1. base-unit purchase return removes exact base qty.
2. original alt UOM factor 24: return 1 carton removes 24 base units.
3. changing UnitTemplate after purchase does not alter return conversion.
4. deleting/replacing live alt UOM after purchase does not alter historical sourced return semantics.
5. partial returns consume remaining eligibility in base units.
6. two concurrent returns cannot both consume the same remaining source quantity.
7. duplicate/double post remains impossible.
8. insufficient warehouse stock fails when negative stock disabled.
9. commercial value == carrying value: GL/subledger exact.
10. commercial value > carrying value: GL 1140 still equals carrying-value stock delta; commercial difference is accounted explicitly.
11. commercial value < carrying value: same invariant.
12. tax-bearing return preserves correct supplier/tax economics separately from carrying value.
13. multiple tracked + service/nontracked lines reconcile correctly.
14. rounding remains integer minor-unit exact.
15. rollback after any posting failure leaves no partial movement/journal/status mutation.
16. no per-warehouse average cost is introduced.
17. Tenant isolation and warehouse negative-stock enforcement remain green.

## Expected change areas
- `app/Services/Accounting/ReturnService.php`
- `app/Models/ReturnLine.php`
- migration for immutable purchase-return UOM/base-quantity evidence if required
- existing PurchaseLine/HasUnitConversion consumption, not reinterpretation
- InventoryService only if a narrow API is required to expose authoritative carrying-value issue result; do not redesign costing
- targeted return/accounting/inventory Feature tests

## Explicitly out of scope
No costing-method redesign, no per-warehouse moving average, no serial/lot allocation, no broad Returns UX redesign, no unrelated sales-return rewrite.

## Claude Code stop conditions
Stop and report before implementation if the existing accounting architecture has no explicit lawful destination for the commercial-vs-carrying-value difference, or if making 1140 equal subledger would require changing global moving-average semantics. Do not invent an account or accounting policy. No merge/deploy.