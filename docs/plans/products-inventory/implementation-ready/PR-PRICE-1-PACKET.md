# Implementation-Ready Packet — PR-PRICE-1

**State:** GROUNDED — implementation not authorized.
**Baseline:** `70501735051f7cd4632417b38b835e8057b1bd8d`
**Architecture contract:** `../phase-1-hardening/PR-PRICE-1.md`

## FROM
The approved audit found the minimum-sale-price guard evaluates the line price before economically applicable invoice/header discount is allocated. Therefore a line can pass its floor check and later end with effective net unit revenue below `min_sale_price` after header discount.

## TO — invariant
For every inventory/commercial Product subject to minimum sale price, final effective sale consideration after all economically applicable line and document discounts must not fall below the minimum sale price unless the existing authorized override path explicitly permits it.

The rule must be centralized at the canonical pricing/invoice calculation boundary used by all relevant sales creation/update/posting paths. UI-only validation is insufficient.

## Accounting/rounding contract
Use integer minor units and the engine's canonical discount allocation/rounding. The floor decision must use the same final monetary allocation that feeds invoice totals; do not create a second approximate percentage calculation. Multi-line header discount allocation and remainder halala must be deterministic. Tax is not a discount and must not be used to mask a below-floor pre-tax selling price unless the existing pricing contract explicitly defines minimum price tax-inclusive.

## Required cases
- no discount; exactly at floor PASS.
- line discount leaves exactly floor PASS; below floor denied.
- header fixed/percentage discount that takes effective unit price below floor denied.
- combined line + header discount denied when final effective price below floor.
- multi-line invoice: only affected line(s) fail according to deterministic header-discount allocation.
- halala rounding boundary covered.
- authorized existing override succeeds and is auditable; unauthorized override fails.
- zero/min-null/no-floor Product preserves existing behavior.
- draft/update/recalculation paths cannot bypass the rule.
- POS and ordinary invoice paths cannot disagree if they share the same commercial engine.

## Expected change areas
Canonical invoice/pricing calculation service and its targeted tests; request/controller only if needed to pass existing override context. Avoid frontend duplication except displaying backend validation cleanly.

Forbidden: redesign discount policy, invent new override permission, change tax rules, change invoice totals, introduce floating-point money, unrelated POS UI work.

## Stop conditions
Stop if minimum price tax basis or override semantics are ambiguous in current code; resolve from existing settings/permissions/tests or raise NEEDS DECISION rather than invent policy.

## Handoff rule
Claude Code later reconciles exact current calculation service/function and proves the final allocated effective price invariant with focused monetary tests. No merge/deploy.