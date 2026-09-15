# VAR-FU-4 Variant Minimum Sale Price Report

## Scope

Closes **GAP-05 only** from the Product Variants Final Closure Review:
prove and close any regression gap between Product Variants, canonical
Product/Variant × UOM pricing (VAR-PRICE-1), and existing `min_sale_price`
enforcement. The core requirement: selecting a variant sellable identity
(Product + `product_variant_id` + UOM) must never bypass the existing
minimum-sale-price guard. Per the mission's explicit "Fix Policy": if every
production path is already correct, ship regression tests and
documentation only, and do not change production code merely because the
task exists.

**Verdict of the evidence pass: no bypass exists.** No production code was
changed. This report documents why, with a full regression suite proving it.

## Evidence

- `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md` §GAP-05: names the
  concern (no dedicated regression test proving Variant sales still respect
  `min_sale_price`) and explicitly rates it "coverage-only, no known or
  suspected defect" — the lowest-priority, most conservative framing among
  the six gaps.
- `app/Services/Accounting/InvoiceService.php::minimumPriceDecision()`
  (lines ~708–762): the **sole** enforcement point. Reads `$product->min_sale_price`
  only — the function signature has no `$variant` parameter at all, and
  nothing in it ever looks at the resolved `ProductVariant`.
- `app/Services/Accounting/InvoiceService.php::applyItemsAndTotals()`
  (lines ~487–597): `$product = Product::find($item['product_id'])` is
  always the **parent** record, resolved identically whether the line sells
  a simple product or a specific variant of a variant-managed one.
  `$variant = DocumentLineVariantResolver::resolve(...)` is computed and
  carried through the line context for identity/snapshot purposes only —
  it is **never** passed into `minimumPriceDecision()`.
- `app/Models/Product.php`: `min_sale_price` (line 45) is a plain
  `integer`-cast column, not an accessor — unlike `quantity_on_hand`/
  `avg_cost` (VAR-INV-1) or `sale_price` (VAR-PRICE-1), it has no
  variant-aware read-through logic of any kind. One scalar per product,
  full stop.
- `app/Services/Accounting/PosService.php::checkout()` (line 219): calls
  `$this->invoices->create(...)` directly — POS is not a second
  implementation of the guard, it is the **same** `InvoiceService::create()`
  call path, so it inherits `minimumPriceDecision()` automatically and
  identically.
- `app/Services/Accounting/PosService.php::assertUnitPricesAllowedForPos()`
  (lines ~481–520): a **separate**, pre-existing POS-only guard — when
  `PosSettings::allowsUnitPriceOverride()` is `false` (the default), a POS
  line's `unit_price` must equal the server-computed
  `PosCustomerPriceListResolver::posPriceFor(...)` price exactly (already
  variant-aware since VAR-POS-1). This is a *different* guard for a
  *different* purpose (price-tampering prevention when override is
  disabled) and does not interact with or weaken the min-price guard, which
  still runs unconditionally downstream in `InvoiceService::create()`.
- `app/Services/Commerce/CommercePriceResolver.php` (lines 51–54, 166–169)
  and `app/Services/Commerce/CommerceOrderService.php` (lines 22–26): both
  files carry pre-existing, explicit documentation that `min_sale_price` is
  returned as **descriptive metadata only** in Commerce, and that
  `CommerceOrderService::create()`/`confirm()` **never** call
  `InvoiceService`/`LedgerService` at all — an "absolute boundary" per
  ADR-01 §2/§6. This is the same boundary the mission's own instructions
  describe and explicitly forbid crossing without new evidence of a real
  gap; none was found.
- `app/Support/DocumentLineVariantResolver.php::resolve()`: the existing
  VAR-DOC-1 fail-closed identity gate — wrong-product variant, cross-tenant
  variant, and inactive variant are all rejected with a `RuntimeException`
  **before** `applyItemsAndTotals()` ever reaches the price/quantity
  economics, let alone the min-price guard. These paths cannot be used to
  "sneak" a below-minimum price through, because they never produce a line
  at all.
- `tests/Feature/MinimumSalePriceGuardTest.php`,
  `tests/Feature/MinimumSalePriceHeaderDiscountTest.php`: the existing,
  simple-product-only regression suite for this exact guard — read in full
  to match its JSON shape, error strings, and permission/actor patterns
  exactly rather than inventing parallel conventions.

## Existing min_sale_price Authority

Answering the mission's "First: establish current contract" checklist,
strictly from code:

1. **Authority location**: `InvoiceService::minimumPriceDecision()` (private
   method). No other file implements this guard independently — POS calls
   through to the same method via `InvoiceService::create()`.
2. **Granularity**: **Product-level.** Not UOM-aware (the same
   `min_sale_price` scalar applies regardless of which unit the line sells
   in — only the *comparison* is unit-factor-adjusted, the floor value
   itself never changes per UOM). Not Variant-aware (no per-variant
   storage exists or is consulted).
3. **Enforcement timing**: at `InvoiceService::create()` — i.e., at
   **document creation** (Invoice, and by inheritance POS checkout, which
   creates a credit Invoice under the hood). Not at posting
   (`InvoiceService::post()`), not at quote/calculation-only time.
4. **Setting**: `Settings::get('sales', 'enforce_min_sale_price')` — a
   per-tenant toggle, defaulting to `true` for new tenants (see
   `MinimumSalePriceGuardTest::a_new_tenant_enforces_the_minimum_price_by_default_and_can_toggle_the_policy`).
5. **Override permission**: `sales.minimum_price_override` (`Rbac.php`
   line 79) — held by `owner`/`admin` roles by default, not `accountant`.
6. **Override requires reason + actor**: yes to both. A non-empty
   `minimum_price_override_reason` string is required per line, and the
   actor is resolved server-side from `$data['minimum_price_override_actor_id']`,
   which the controllers (`InvoiceController`, `PosController`) inject
   exclusively from `$request->user()?->id` — **never** trusted from the
   client payload directly, and validated via `$actor->hasPermission(...)`
   before the override is granted.
7. **Client-supplied vs. server-resolved price**: the compared value
   (`unit_price` → line net economics) is **client-supplied** on every
   surface examined (Invoice, POS) — this is the documented, intentional
   design (users type prices; the system rejects a below-floor entry rather
   than silently computing one). The **floor** itself
   (`Product::min_sale_price`) is always server-authoritative. This matches
   the mission's own framing exactly ("إذا السعر النهائي يمكن للمستخدم
   إدخاله/تعديله: الـguard يقارن السعر الفعلي... بالحد الأدنى").
8. **Surfaces that must share this guard**: Invoice (direct) and POS
   (inherited via the same `InvoiceService::create()` call) — confirmed the
   only two. Quote, Recurring Invoice, Credit Note, Procurement, Delivery
   Note, and Purchase do not implement any `min_sale_price` guard for
   *either* simple or variant products — this is pre-existing, symmetric
   (not variant-specific) behavior, unrelated to GAP-05, and out of this
   task's scope to change.

## Existing Business Contract

Confirmed unchanged and untouched: `Settings::get('sales', 'enforce_min_sale_price')`
gate, `sales.minimum_price_override` permission, mandatory non-empty
override reason, server-injected actor with permission re-check, and the
existing rejection message strings (`'سعر «{name}» الصافي أقل من الحد
الأدنى...'`, `'السعر الأقل من الحد الأدنى يتطلب اعتماد مالك أو مدير
مخوّل.'`). No new Setting was added, per instruction.

## Variant Pricing Interaction

**The guard is structurally blind to variant identity.** Since
`minimumPriceDecision()` never receives `$variant` and reads only
`$product->min_sale_price` (keyed off `product_id`, which is always
resolved identically for every line regardless of variant selection), no
variant — sibling A, sibling B, one using an explicit `ProductUnitPrice`,
one falling back to the product's own canonical same-UOM price via
VAR-PRICE-1 — can produce a different floor value or skip the comparison.
The mission's own worked example (Product min 10 SAR, Variant A canonical
15 SAR, Variant B canonical 8 SAR) was reproduced directly:
`variant_explicit_price_below_product_min_cannot_bypass_guard` sets
Variant B's own explicit `ProductUnitPrice` to 8.00 SAR under a 10.00 SAR
product minimum and confirms the sale is rejected with the identical
message a simple product would receive.

VAR-PRICE-1's resolution precedence (Variant explicit same-UOM → Product
canonical same-UOM fallback → unresolved; never factor-derived, never
cross-UOM, never sibling-fallback) is completely untouched by this task —
the min-price guard does not consult `ProductPricingService` at all, so
there is no interaction to break. Two tests
(`variant_using_product_same_uom_canonical_fallback_still_receives_min_guard`,
`no_factor_derived_price_affects_the_min_price_comparison`) prove the guard
still fires correctly regardless of which pricing tier a client-sent price
happens to match, and that a factor-multiplied UOM price is never
mistakenly compared against a factor-multiplied (or un-multiplied) floor —
the unit-factor-adjusted comparison already implemented in
`minimumPriceDecision()` (`$minimum * $quantity * $unitFactor`) was
exercised directly with an alternate UOM (`alternate_uom_variant_price_receives_correctly_converted_min_guard`).

## Price List Interaction

`PriceListService`/`PosCustomerPriceListResolver` resolve a price
(including a variant-specific `PriceListItem`) that becomes the line's
`unit_price` exactly like any manually-typed price — the min-price guard
runs downstream regardless of where the number came from. Verified with a
customer-scoped price list carrying an explicit 8.00 SAR price for a
variant under a 10.00 SAR product minimum, checked out through POS: the
price list resolves and passes POS's own price-match check (since
`unit_price` equals the resolved list price exactly, so no
"unauthorized override" trip), then the min-price guard still rejects it.
This single test also proves customer/price-list precedence cannot bypass
the guard (mission items 9 and 10 — the same code path answers both, since
POS's price list resolution has no separate "trusted" status once the
number becomes `unit_price`).

## POS

POS is not a separate implementation — `PosService::checkout()` calls
`InvoiceService::create()` directly and inherits `minimumPriceDecision()`
unmodified. `assertUnitPricesAllowedForPos()` is a distinct, pre-existing,
already variant-aware guard (VAR-POS-1) for a different concern (price
tampering when unit-price override is disabled) and does not weaken or
bypass the min-price guard. Regression coverage:
`price_list_resolved_price_below_min_still_receives_the_guard_in_pos`
(new) plus the full pre-existing `PosVariantCheckoutTest` suite (19 tests,
re-run clean, unmodified).

## Normal Documents

Invoice (direct call site) is covered by 15 of the 19 new tests plus the
full pre-existing `MinimumSalePriceGuardTest`/`MinimumSalePriceHeaderDiscountTest`
suites (19 tests, re-run clean, unmodified) and `VariantDocumentLineTest`
(19 tests, unrelated to pricing but proves the variant/document identity
layer this guard depends on is itself unaffected). Quote, Recurring
Invoice, Credit Note, Procurement, Delivery Note, Purchase: no
`min_sale_price` guard exists for these today, for simple or variant
products alike — a pre-existing, symmetric absence, not a variant-specific
regression, and therefore out of GAP-05's scope.

## Commerce Boundary

Documented, not extended. `CommerceOrderService::create()`/`confirm()`
never call `InvoiceService`/`LedgerService` — an explicit architectural
boundary (ADR-01 §2/§6, `CommerceBoundary`) that predates this task.
`CommercePriceResolver::resolve()` returns `min_sale_price` as descriptive
metadata (`ResolvedCommercePrice::$minSalePrice`) only, by pre-existing
design, documented in its own class docblock before this task touched
anything. `commerce_price_resolver_returns_min_sale_price_as_descriptive_metadata_only_for_a_variant`
proves this boundary holds for a variant specifically: a variant's own
explicit price below the product's minimum resolves successfully
(`resolved === true`) with the floor value surfaced only as data, never as
a rejection — matching the mission's explicit instruction not to move
enforcement to `CommerceOrder` absent evidence of a real gap. None was
found; none was added.

## Override / Permission / Reason / Actor

All four held to the existing simple-product contract, tested directly on
the Variant path with **zero widening**:

- `allowed_override_succeeds_for_a_variant_sale_with_reason_and_permission`:
  owner + reason → 201, snapshot carries the exact reason and the owner's
  `id` as `approved_by_user_id`, matching `InvoiceLineResource`'s existing
  JSON shape.
- `override_without_permission_fails_for_a_variant_sale`: an `accountant`
  (lacks `sales.minimum_price_override`) is rejected with the exact
  existing message, even with a reason supplied.
- `override_requires_a_reason_and_fails_without_one_for_a_variant_sale`:
  omitting the reason on a variant line is rejected with the exact existing
  message.
- `override_actor_propagates_correctly_for_the_variant_override_path`:
  confirms the actor id in the response snapshot is the authenticated
  user's own id — never anything the client could have supplied (the
  payload sent in every test in this suite never includes
  `minimum_price_override_actor_id`, proving the controller-side injection
  is what the variant path actually relies on too, not a client-suppliable
  field).

## Money Semantics

`the_halala_boundary_is_exact_for_a_variant_sale`: 999/1000/1001 halalas
against a 1000-halala minimum on an actual variant sale — 999 rejected,
1000 accepted (no override), 1001 accepted. Integer comparison throughout,
matching the mission's exact required boundary numbers; no float path was
found or introduced.

## Tenant Isolation

No change. Two negative controls, both resolving through the pre-existing
`DocumentLineVariantResolver::resolve()` fail-closed checks **before** the
price guard is ever reached:

- `a_variant_belonging_to_a_different_product_fails_closed_before_the_price_guard`:
  a variant from Product A submitted against Product B's `product_id`,
  with an intentionally very high price (999,999 halalas — would pass any
  price guard) — rejected on identity, not price.
- `a_cross_tenant_variant_is_a_negative_control_and_never_influences_pricing`:
  a second tenant's own variant-managed product's variant id submitted
  under a first tenant's product — same identity rejection, same message,
  proving cross-tenant variant IDs cannot leak into or influence another
  tenant's pricing decision at all.
- `an_inactive_variant_cannot_be_sold_regardless_of_price`: a deactivated
  variant, priced generously above the minimum, is still rejected at the
  existing sellable-identity boundary — inactivation cannot be used as a
  side door around anything.

No `exists:` validation was added or needed (none existed to begin with on
this path) — the fail-closed behavior is domain-authority-driven
(`DocumentLineVariantResolver`), consistent with the VAR-FU-1 precedent
cited in the mission.

## Production Changes

**None.** Per the mission's explicit Fix Policy, since every surface
examined already routes through the single existing, variant-blind
`minimumPriceDecision()` guard correctly, no production code was modified.
No new min-price authority was created; no existing one was altered.

## Changed Files

- `tests/Feature/VariantMinimumSalePriceGuardTest.php` (new) — 19 regression
  tests, SQLite + PostgreSQL.

No other file touched.

## Tests

New file `tests/Feature/VariantMinimumSalePriceGuardTest.php`, 19 tests
mapped to the mission's 22-item required matrix (items 19 and 21 are
satisfied by re-running/relying on the pre-existing, unmodified suites
named below rather than duplicating them):

1. Simple below min rejected → `simple_product_below_min_is_rejected`
2. Simple equal min accepted → `simple_product_equal_min_is_accepted`
3. Variant explicit price below product min cannot bypass →
   `variant_explicit_price_below_product_min_cannot_bypass_guard`
4. Variant explicit price equal min → normal path →
   `variant_explicit_price_equal_min_follows_normal_allowed_path`
5. Variant explicit price above min allowed →
   `variant_explicit_price_above_min_is_allowed`
6. Variant via product same-UOM canonical fallback still guarded →
   `variant_using_product_same_uom_canonical_fallback_still_receives_min_guard`
7. Alternate UOM explicit Variant price, correct guard →
   `alternate_uom_variant_price_receives_correctly_converted_min_guard`
8. No factor-derived price affects comparison →
   `no_factor_derived_price_affects_the_min_price_comparison`
9/10. Price List / customer precedence doesn't bypass →
   `price_list_resolved_price_below_min_still_receives_the_guard_in_pos`
   (one test proves both, since POS's price-list resolution has no
   special trust once it becomes `unit_price`)
11. Allowed override succeeds only under policy →
    `allowed_override_succeeds_for_a_variant_sale_with_reason_and_permission`
12. Override without permission fails →
    `override_without_permission_fails_for_a_variant_sale`
13. Override requires reason →
    `override_requires_a_reason_and_fails_without_one_for_a_variant_sale`
14. Correct actor propagation →
    `override_actor_propagates_correctly_for_the_variant_override_path`
15. Wrong-product Variant fails closed →
    `a_variant_belonging_to_a_different_product_fails_closed_before_the_price_guard`
16. Cross-tenant Variant negative control →
    `a_cross_tenant_variant_is_a_negative_control_and_never_influences_pricing`
17. Inactive Variant cannot become sellable →
    `an_inactive_variant_cannot_be_sold_regardless_of_price`
18. 999/1000/1001 halala boundary →
    `the_halala_boundary_is_exact_for_a_variant_sale`
19. Existing simple-product tests remain green → verified by re-running
    `MinimumSalePriceGuardTest` (4 tests) and
    `MinimumSalePriceHeaderDiscountTest` (15 tests) unmodified
20. POS Variant checkout regression → covered directly by test 9/10 above
    plus the full pre-existing `PosVariantCheckoutTest` suite (19 tests)
    re-run clean
21. Normal Invoice Variant regression →
    `a_normal_invoice_guards_a_simple_line_and_a_variant_line_independently_together`
    (a single invoice with one simple line above its floor and one variant
    line below its product's floor is rejected wholesale; with both lines
    corrected, both are accepted independently, each carrying its own
    correct `product_variant_id`/no-override snapshot) plus
    `VariantDocumentLineTest` (19 tests) re-run clean
22. Commerce boundary, documented and tested per actual architecture →
    `commerce_price_resolver_returns_min_sale_price_as_descriptive_metadata_only_for_a_variant`

### SQLite

```
VariantMinimumSalePriceGuardTest (new)          19/19 passed (113 assertions)
MinimumSalePriceGuardTest                        4/4  passed
MinimumSalePriceHeaderDiscountTest              15/15 passed
ProductUnitPriceTest (VAR-PRICE-1)              19/19 passed
PosVariantCheckoutTest                          19/19 passed
VariantDocumentLineTest                         19/19 passed
DocumentHttpVariantsTest (VAR-FU-1)             19/19 passed
```

### PostgreSQL

Same seven files together:

```
114/114 passed (498 assertions)
```

Full `php artisan test` was not run locally, per the mission's explicit
instruction — the targeted set above covers the guard itself, every
document/POS surface that calls it, VAR-PRICE-1's own regression suite, and
VAR-FU-1's HTTP-layer variant regression suite. CI covers the broader run.

## CI

Not run in this environment; relies on the repository's `ci.yml` (SQLite +
PostgreSQL) for the wider suite.

## Backward Compatibility

Trivially total: no production file was touched, so nothing could have
changed for any existing caller, simple-product or otherwise. The existing
`MinimumSalePriceGuardTest`/`MinimumSalePriceHeaderDiscountTest` suites
re-run byte-for-byte unmodified and green.

## Risks / Deferred

- **Quote, Recurring Invoice, Credit Note, Procurement, Delivery Note, and
  Purchase have no `min_sale_price` guard at all today** — for simple
  products just as much as for variants. This is a pre-existing, symmetric
  gap unrelated to Variants and explicitly out of GAP-05's scope (GAP-05 is
  about a Variant-specific regression relative to simple-product behavior,
  not about extending guard coverage to new document types). Flagged here
  for visibility only; no fix proposed or implied.
- **No UOM-specific or Variant-specific `min_sale_price` storage exists or
  was created**, per explicit instruction. A future business decision to
  make the minimum sensitive to UOM or to a specific variant's economics
  would be a genuine policy change requiring a stop-and-ask, not something
  this task should or did infer from the evidence.

## Git

- Branch: `claude/var-fu-4-variant-min-sale-price`
- PR: opened after this report, title "VAR-FU-4: Harden minimum sale price
  for product variants"
- Base SHA: `3833ec5b8d2491efb74d6b2b7a1087edba9a182b` (`origin/main` at task
  start — main had moved one commit past the given last-confirmed-merge
  SHA `632ed82c136695983404928940e24d79d00d09a6`/PR #829, via an unrelated
  docs commit #830; confirmed `632ed82c` is an ancestor of this base)
- Head SHA: `ed2690c0542a509d9c27edc2a5f16b53bfde8291` (before this "record head SHA" follow-up commit)

## Journal Entries (pre-PR protocol)

None. No production code changed — this task added regression tests only.
No journal entries, ledger postings, tax, COGS, inventory valuation,
payment, or discount logic was touched.

## Final Verdict

GAP-05: **CLOSED**

## Next Step

GAP-06 only after approval.
