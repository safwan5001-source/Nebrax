# ACC-5 — Inventory / COGS Account Routing

**Status:** PREPARED — execute after prior routing slices are stable  
**Risk:** High inventory + accounting integrity.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Adopt semantic routing across inventory accounting without changing perpetual-inventory valuation, quantities, branch dimensions, movement semantics or historical journals.

## Approved roles
- `inventory_asset` -> 1140
- `cogs` -> 5110
- `inventory_count_variance` -> legacy 5180
- `inventory_manual_adjustment` -> legacy 5180
- `inventory_damage_loss` -> legacy 5180

`opening_balances` -> 3130 is semantically confirmed but must remain out of configurable ACC-5 scope until parent plan explicitly resolves its settings-domain placement.

## COGS precedence
`product.cogs_account_id -> tenant cogs mapping -> legacy 5110`.
Existing product override wins.

## Stocktake
Physical count shortage/surplus uses `inventory_count_variance` as one role; debit/credit sign represents direction. Do not split gain/loss roles in V1.

## Stock Permit
Generic manual receipt/issue counterpart uses `inventory_manual_adjustment`. Do not infer damage/internal consumption/sample accounting from free-text reason.

## Damage/non-saleable return
Explicit non-saleable/damaged returned goods use `inventory_damage_loss` rather than count variance.

## Transfers
- same-branch warehouse transfer: no GL entry remains unchanged.
- cross-branch transfer: Dr/Cr same `inventory_asset` role with existing source/destination branch dimensions.
- no transfer-clearing role.

## Branch invariant
Role mapping remains company-wide in V1, but journal-line branch dimensions must be preserved exactly. Routing changes account ID only.

## Opening inventory
Do not silently route 3130 through a configurable role in ACC-5. Preserve existing opening behavior until `opening_balances` placement is approved. Inventory asset side may consume `inventory_asset` only if doing so does not create a half-configurable contract that violates the approved implementation sequence; document decision before coding.

## Fail closed / atomicity
Invalid explicit mapping must block the entire stock/accounting transaction without partial stock movement or journal. Verify transaction boundaries.

## Historical integrity
Mapping changes are prospective. Posted journals and prior stock movements are not rewritten. Reversals/corrections use original concrete accounting records according to existing service contract.

## Out of scope
No valuation-method change; no free-text reason classifier; no new inventory reason taxonomy; no branch-specific mappings; no transfer clearing; no opening-balance settings decision; no LedgerService change; no historical rewrite; no merge/deploy.

## Required tests
1. unmapped paths exact legacy accounts.
2. mapped inventory asset across applicable new movements.
3. mapped COGS with product override precedence.
4. count shortage/surplus preserve signs and same semantic role.
5. manual receipt/issue preserve signs.
6. damage/non-saleable return uses damage role.
7. free-text reason cannot switch role.
8. same-branch transfer still no journal.
9. cross-branch transfer same role both sides with correct branches.
10. invalid mapping causes atomic rollback of stock + GL.
11. tenant isolation.
12. historical journals unchanged after mapping change.
13. opening behavior not accidentally altered.
14. SQLite/PostgreSQL inventory/accounting suites.

## Acceptance criteria
Account routing is adopted by business cause, not by debit/credit sign; inventory quantities/valuation/dimensions remain unchanged; no history rewrite; financial tests pass.