# Implementation-Ready Packet — PR-PRICE-1

**State:** GROUNDED — implementation not authorized.
**Grounding baseline:** main `70501735051f7cd4632417b38b835e8057b1bd8d`
**Approved contract:** `../phase-1-hardening/PR-PRICE-1.md`

## Confirmed invariant
Effective final sale price after all economically applicable discounts must not fall below Product `min_sale_price` unless the existing authorized override path is valid.

## Current authoritative path
`InvoiceService::create()` and `update()` execute inside DB transactions and both call the shared `applyItemsAndTotals()` path. This is the correct architectural neighborhood for the final server-owned check: validation must occur after authoritative line/header economics are known, never only in the client/POS.

The service uses integer minor units and explicitly avoids float arithmetic. Preserve that contract.

## FROM → TO
FROM: minimum-price validation can succeed at raw line economics while later invoice/header discount allocation lowers the effective line price below the floor.

TO: authoritative invoice economics allocate every economically applicable header discount deterministically to lines, combine it with line discount, then evaluate each Product line's effective commercial unit price against the Product floor before the write path can complete. The same invariant must hold for API and POS because both must converge on server authority.

## Required semantics
- floor applies to Product commercial price, not tax;
- explicit alternate-UOM price remains the commercial price source; never derive selling price by multiplying/dividing the UOM factor;
- all calculations stay in minor units;
- deterministic header-discount remainder allocation is mandatory;
- exact equality with floor passes;
- Product with null/no floor passes;
- free/100% discounts fail when floor > 0 unless explicit authorized override applies;
- override must be reauthorized at authoritative save/post time; generic manage permission is insufficient;
- client-computed totals are evidence/input only, never authority.

## Proof obligations
1. raw line above floor + header discount below floor => reject.
2. line discount alone below => reject.
3. combined line + header discount below => reject.
4. exact floor => accept.
5. above floor => accept.
6. Product without floor => accept.
7. fixed header discount multi-line allocation catches the violating line deterministically.
8. percentage header discount behaves equivalently.
9. rounding remainder cannot hide a 1-halalah floor violation.
10. taxable/non-taxable mixture does not treat tax as discount.
11. explicit alt-UOM price checked as that UOM's commercial economics without factor-derived price.
12. authorized override succeeds only through existing controlled permission/audit path.
13. unauthorized override input/flag fails closed.
14. permission revoked between client draft calculation and authoritative write fails closed.
15. API and POS produce the same authoritative decision for identical economics.
16. rollback leaves no partial invoice/line mutation on rejection.

## Expected change areas
Primary: `app/Services/Accounting/InvoiceService.php` and the existing minimum-price/override authorization helper(s) found during implementation census. Tests should target invoice create/update plus POS checkout integration where it reaches the same authority.

Do not introduce a new pricing engine, promotion engine, tier pricing, costing changes, inventory valuation changes, or UOM factor-derived selling prices.

## Claude Code stop conditions
Stop and report if enforcing the invariant requires inventing a new override policy, changing tax semantics, changing price-list semantics, or replacing existing discount allocation rather than hardening it. No merge/deploy.