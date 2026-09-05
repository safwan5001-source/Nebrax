# Implementation-Ready Packet — PR-PRICE-1

**State:** IMPLEMENTATION-READY; implementation not authorized.
**Current code baseline verified:** main `70501735051f7cd4632417b38b835e8057b1bd8d`.
**Contract:** `../phase-1-hardening/PR-PRICE-1.md`

## FROM — verified current code

The minimum-sale-price guard already exists in the authoritative `InvoiceService`, not only in UI/controller code.

`applyItemsAndTotals()` currently:
1. resolves Product/UOM and quantity precision;
2. computes line gross and line-level discount;
3. computes `lineNet` before tax;
4. immediately calls `minimumPriceDecision(product, lineNet, quantity, unitFactor, precision, reason, actorId, tenantId)`;
5. stores the line and minimum-price audit snapshot;
6. after all lines are built, computes invoice/header `discount` through `applyDiscount($subtotal, $taxTotal, ...)`.

Therefore the guard evaluates the line after its own discount but **before the invoice/header discount**. The invoice discount later lowers net sales/revenue proportionally, so a line can pass the floor and then become economically below it.

At posting, `post()` again computes header discount from stored line nets and allocates resulting `netSales` revenue proportionally across invoice lines, with the last line carrying rounding remainder. It does not re-run the minimum-price guard against that final allocated economics.

## Existing policy that must be preserved

Sales setting:
- `sales.enforce_min_sale_price` controls enforcement.
- new-tenant default is currently true.

Existing explicit override permission:
- `sales.minimum_price_override` in `Rbac::PERMISSIONS`.
- owner/admin via wildcard; custom role may receive explicit grant.

Existing override flow:
- line input `minimum_price_override_reason`;
- authenticated actor is injected server-side as `minimum_price_override_actor_id`, not trusted from client payload;
- below-floor line requires non-empty reason and actor with `sales.minimum_price_override`;
- line snapshots `min_sale_price_snapshot`, reason and approving user.

Existing test anchor:
- `tests/Feature/MinimumSalePriceGuardTest.php` covers default setting/toggle, owner override + audit snapshot, accountant denial, and POS using the same guard.

## TO — exact invariant

> Effective final sale economics for each Product line, after its line discount **and its deterministic share of the invoice/header discount**, must not fall below the Product minimum sale price unless the existing explicit override is valid.

Tax is not a discount and must not be used to make a below-floor line appear compliant.
Shipping and adjustment are document-level economics but are not Product sale price and must not raise a Product line above its floor.

## Authoritative implementation boundary

Keep the rule in `InvoiceService` so standard invoice, POS and other flows that create invoices through the service share one server authority.

Refactor the current decision timing rather than creating a second independent pricing engine:
1. build/normalize line economics and historical UOM/precision snapshots;
2. compute subtotal from post-line-discount pre-tax line nets;
3. compute capped header discount using existing `applyDiscount()` semantics;
4. deterministically allocate the header discount/net sales across lines using the same allocation/rounding rule used by authoritative accounting/posting;
5. evaluate each Product line's **final allocated net** against its minimum threshold;
6. only then persist/accept the minimum-price decision/audit snapshot, or fail the transaction.

Implementation may use a small shared allocation helper so create/update and post cannot drift. Do not duplicate two rounding algorithms.

## Deterministic header allocation

The current posting path allocates final `netSales` proportionally to each line's post-line-discount `lineNet`, and assigns the final rounding remainder to the last line. The minimum-price check must use the same economic allocation convention, or both paths must be refactored to one shared helper preserving existing totals.

Required invariant:
- sum(final allocated line nets) = invoice `subtotal - discount` exactly in minor units;
- no lost/created halala;
- deterministic line order/remainder;
- floor check consumes exactly those allocated nets.

## Minimum threshold math

Preserve current UOM semantics:
- ordinary line threshold = `min_sale_price × quantity × unit_factor`;
- fractional/precision line uses exact rational comparison already implemented, avoiding float;
- explicit alternative-UOM price remains a commercial price; do NOT derive price from unit factor;
- unit factor only converts minimum threshold/base quantity semantics as today.

For final header-discount evaluation, compare final allocated pre-tax line net against the same quantity/UOM threshold. Exact equality passes.

## Override semantics

Do not invent a new approval system in this PR.

If final allocated economics are below floor:
- require the existing line `minimum_price_override_reason`;
- require current authenticated actor to hold `sales.minimum_price_override`;
- persist the existing minimum snapshot/reason/approver fields;
- unauthorized reason/flag never bypasses the rule.

If a line was above the floor before header discount but falls below only after allocation, it now requires the same explicit override as any directly below-floor line.

## Create/update/post safety

Create/update must reject invalid final economics inside their existing DB transaction before a successful draft response.

Posting must not become a client-trust boundary. Because drafts can be historical or otherwise exist before this fix, implementation should revalidate the final minimum-price invariant in the authoritative locked posting path using stored line/UOM/minimum snapshots/current approved semantics as appropriate. Do not silently manufacture an override at post.

If revalidation of legacy draft semantics cannot be done without changing historical policy, stop and document the exact case rather than weakening the invariant.

## POS and other creators

`MinimumSalePriceGuardTest` proves POS reaches the same InvoiceService guard. Preserve that architecture. Do not implement a POS-only floor algorithm.

Also inspect and keep compatible:
- Delivery Note → Sales Invoice Draft builder, which accepts line pricing and minimum-price override reason;
- POS exchange replacement invoice path where it ultimately uses InvoiceService;
- duplicate invoice path through `create()`;
- Public invoice API: its request intentionally excludes minimum-price override reason, so it must never gain an unauthorized override path. If policy enforcement applies there, below-floor final economics simply fail unless the established public contract has an explicit server-authorized path.

## Expected change set
Likely:
- `app/Services/Accounting/InvoiceService.php` — central refactor/shared allocation + final floor check;
- possibly one narrowly scoped pricing/allocation value helper if it materially prevents create/post drift;
- `tests/Feature/MinimumSalePriceGuardTest.php` — expand final-discount matrix;
- targeted Invoice/POS/Delivery Note draft tests where needed.

Inspect-only unless evidence requires change:
- `StoreInvoiceRequest` / POS request validation;
- InvoiceLine model/audit fields;
- `Rbac.php` (permission already exists);
- invoice frontend warning calculation;
- DeliveryNoteSalesInvoiceDraftBuilder;
- PosService/PosExchangeService;
- line precision/UOM services.

Frontend may be updated later to predict the final violation more accurately, but server correctness is mandatory and cannot depend on frontend prediction.

## Forbidden
- no new pricing engine;
- no promotion/tier-pricing system;
- no new approval workflow;
- no change to moving average, inventory valuation or COGS;
- no global tax/rounding redesign;
- no UOM factor/pricing redesign;
- no permission rename (`sales.minimum_price_override` stays authoritative);
- no unrelated invoice posting/accounting refactor.

## Required acceptance matrix
1. no header/line discount; effective above floor → accept.
2. exact equality to floor → accept.
3. raw price above floor + line discount below floor → reject without override.
4. raw/line net above floor + fixed header discount pushes final allocated net below → reject.
5. percentage UI converted to fixed header amount pushes below → authoritative fixed amount still rejects.
6. line + header discount combination below → reject.
7. free/100% effective line below positive floor → reject without override.
8. Product without positive minimum → existing behavior unchanged.
9. enforcement setting OFF → existing bypass behavior preserved.
10. authorized override + reason → accept and snapshot approver/reason/minimum.
11. unauthorized actor + reason → reject.
12. missing reason → reject even for privileged actor.
13. multi-line header discount where only one line crosses floor → reject based on that line.
14. multi-line rounding remainder → deterministic; allocated nets sum exactly to document net sales.
15. taxable and non-taxable mixed lines → tax does not affect floor economics.
16. tax-inclusive lines → compare pre-tax economic net consistently; no hidden tax bypass.
17. alternative UOM with explicit price and factor → correct threshold; price not factor-derived.
18. fractional/precision line → exact rational comparison remains overflow-safe/no float.
19. standard Invoice API and POS yield same accept/reject for equivalent economics.
20. Delivery Note invoice-draft pricing cannot bypass final floor.
21. duplicate/create path cannot bypass final floor.
22. posting a draft revalidates authoritative final economics and cannot create an unapproved below-floor posted invoice.
23. override permission revoked before authoritative save/post → fail closed where approval is being established/revalidated; do not trust client flag.
24. existing invoice totals, VAT, revenue allocation and ledger tests remain green.

## Accounting/rounding invariants
- header discount remains capped/treated by existing `applyDiscount()` semantics;
- `subtotal`, `discount`, `tax_amount`, `total` formulas do not change except rejection of previously unsafe documents;
- allocated line net sum equals net sales exactly;
- ledger revenue allocation remains identical for valid invoices;
- tax calculation is not repurposed as floor calculation;
- no float for money or precision math.

## Test execution order
1. expanded `MinimumSalePriceGuardTest`.
2. targeted InvoiceService/Invoice API tests for header discount and allocation.
3. POS checkout minimum-price tests.
4. Delivery Note → invoice draft pricing tests.
5. fractional/UOM pricing tests.
6. Invoice accounting/ledger/tax regression tests.
7. full backend SQLite then PostgreSQL/CI matrix expected for financial rule changes.
8. web tests/build only if frontend prediction/UI is changed.

## Stop conditions
Stop and report rather than expand if:
- create-time and post-time header allocation currently differ in a way that cannot be unified without changing posted accounting totals;
- historical draft revalidation requires a new approval/audit schema;
- another document type implements an independent sale-pricing authority rather than routing through InvoiceService;
- fixing the floor would require changing tax, UOM pricing, COGS or promotion semantics.

## Definition of Done
There is no path through standard invoice, POS or other in-scope InvoiceService creators where line-level validation passes and a later invoice/header discount silently pushes effective Product sale economics below minimum. The existing explicit override permission/reason/audit path remains the only allowed exception. Financial totals and ledger behavior for valid invoices remain unchanged.

## Eventual Claude Code handoff
Only after Safwan explicitly authorizes implementation. Start from then-current main and reconcile code drift. Mandatory final MD report: changed files, exact financial/security tests and results, SQLite/PostgreSQL/CI, risks/remaining, Branch/PR/Base SHA/Head SHA, next step. No Merge/Deploy.