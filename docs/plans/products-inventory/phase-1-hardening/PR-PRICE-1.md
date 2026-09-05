# PR-PRICE-1 — Minimum Sale Price after Final Discounts

**Priority:** P1  
**Status:** PLANNED

## Confirmed problem

Line minimum-price validation can pass before invoice/header discount is applied. The header discount can then reduce effective final line economics below `minimum_sale_price` without using the authorized override path.

## Invariant

> Effective final sale price after all economically applicable discounts must not fall below the Product minimum sale price unless the existing authorized override is valid.

The authoritative check must occur after the final discount allocation/economic calculation, not only at raw line-price entry.

## Design requirements

- centralize the rule in the authoritative invoice/pricing domain path shared by relevant API/POS flows;
- define deterministic allocation/rounding of header-level discount to lines using existing money/minor-unit conventions;
- evaluate the economically effective unit price/base commercial line consistently;
- preserve explicit per-UOM pricing; never derive price from UOM quantity factor;
- tax must not be mistaken for discount when evaluating the floor;
- line discount + header discount combinations must be covered;
- authorized override must be explicit/auditable and not inferred from generic manage permission;
- final validation belongs inside the authoritative write/post transaction/path so client-calculated values cannot bypass it.

## Edge cases

Zero quantity invalid upstream; free/100% discount; fixed vs percentage discounts; rounding remainder on header allocation; multiple lines; mixed taxable/non-taxable lines; alternative UOM explicit prices; Product without minimum price; exact equality with floor; override revoked between draft/client calculation and authoritative save/post.

## Out of scope

No new pricing engine, tier pricing, promotion engine or change to quantity conversion. Do not change inventory valuation/COGS.

## Acceptance tests

- raw line above floor + header discount pushes below → reject without override;
- line discount alone below → reject;
- combined discounts below → reject;
- effective price exactly floor → accept;
- above floor → accept;
- authorized override → accept through existing controlled path;
- unauthorized override flag/input → reject;
- multi-line header allocation catches only violating line(s) deterministically;
- POS/API produce same authoritative result;
- tax and rounding cases cannot create a hidden bypass.