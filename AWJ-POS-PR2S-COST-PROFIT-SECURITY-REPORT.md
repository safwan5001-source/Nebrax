# AWJ POS — PR-2S: Cost & Profit Data Protection

## 1. Executive Summary

PR-2 (Draft PR #654, unmerged) found that `ProductResource` — used by the
endpoint feeding the POS catalog — unconditionally serialized
`purchase_price`, `avg_cost`, and `profit_margin` with no permission gate, so
any POS user (any role able to operate POS at all) received these fields on
the wire regardless of whether they should see them. This PR fixes that
server-side, independently of PR #654, from current `main`.

**Fix**: a new permission, `products.view_cost`, is the real security
boundary; a new tenant-level POS setting, `show_cost_profit_in_pos`
(default OFF), further restricts display even for authorized users. The most
restrictive condition always wins — the setting can never grant what the
permission denies, and the permission alone (setting OFF) is not enough to
expose the fields inside POS. The three sensitive fields are now **absent**
from the JSON response (not null, not hidden by the frontend) unless both
conditions hold. Every other consumer of `ProductResource` (ERP product
pages, fuel station master data, webhooks) is provably unaffected — they
never set the new transient flag, so they see exactly what they saw before.

## 2. Base SHA

`b94718a432d01dab7d5bde04dda2259717ef2a28` — `origin/main` at session start,
fetched fresh. This branch deliberately does **not** include PR #654's
(unmerged) changes — confirmed by `git log` showing no PR-2 commits reachable
from this branch's history, per the mission's explicit independence
requirement.

## 3. Existing Permission Audit

Inspected `app/Support/Rbac.php` (the single source of truth for permission
slugs and the four system roles) before adding anything:

- **No existing permission** relates to product cost, purchase price,
  average cost, profitability, or margin. `cost_centers.view`/
  `cost_centers.manage` exist but govern accounting cost centers (a general
  ledger dimension), an unrelated concept — reusing that slug would have been
  semantically wrong and would have accidentally gated an unrelated feature.
- `products.view`/`products.manage` govern general product CRUD/catalog
  access. Both `staff` and `accountant` already carry `products.view` in the
  default `MATRIX` — using either as the cost/profit gate would have made
  the fix a no-op for exactly the roles most likely to need restriction.
- `invoices.manage` (the permission that actually gates `POST /pos/products`
  today) is explicitly called out in the mission as insufficient, and
  confirmed as such: `accountant` has `invoices.manage` (can fully operate
  POS) but, before this fix, received cost/margin data it had no dedicated
  authorization for.
- No POS settings key anywhere in `PosSettings.php`/`SalesConfigController.php`
  relates to cost/profit visibility — confirmed by reading every key in both
  files' defaults arrays.

**Conclusion**: no existing permission or setting provides this boundary.
Creating one is necessary, not a duplication.

## 4. Exact Permission(s) Reused or Added

**Added**: `products.view_cost` (registered in `Rbac::PERMISSIONS`, the
assignable-permission catalog used by the custom-role UI and validated by
`RoleController`). **Not** added to `accountant` or `staff` in `Rbac::MATRIX`
— only `owner`/`admin` (via the existing `'*'` wildcard) have it by default,
preserving the safest possible default for every existing tenant. A tenant
that wants a custom role (e.g., "senior accountant") to see cost/profit in
POS can grant `products.view_cost` explicitly through the existing custom
role management screen — no new UI needed for that, it is already generic.

**One permission covers both cost and profitability** — see §12 for why this
was a deliberate, documented resolution of the cost/profit ambiguity the
mission asked to inspect, rather than an oversight.

## 5. ProductResource / Call-Site Analysis

`grep -rl ProductResource app` found it used by:

| Consumer | Effect of this fix |
|---|---|
| `PosController::products()` (`GET /pos/products`) | **The only call site that sets the new transient flag.** This is the fix's actual target. |
| `ProductController` (ERP `/products`, `/products/{id}`) | **Unaffected.** Never sets the flag → `$hidesCostProfit` is always `false` here → identical output to before this PR. Verified by a new test (§19). |
| `FuelStationMasterDataController` | **Unaffected**, same reason. |
| `WebhookServiceProvider` (outbound `product.created`/etc. events) | **Unaffected**, same reason. |
| `ProductExportService`/`ProductImportService` | Do not use `ProductResource` for their I/O (checked; they read/write `Product` model attributes directly), so irrelevant here. |
| `PublicProductController`/`PublicProductResource` | Already a **separate, narrower resource class** that never includes cost/margin at all — confirmed as the codebase's own established precedent for "a different API surface needs a reduced product shape," which is exactly the pattern this fix follows at the field level via a conditional rather than a full parallel class (see §7 for why a conditional was chosen over a second resource class here). |

## 6. Root Cause of the Original Exposure

`ProductResource::toArray()` returned `purchase_price`, `avg_cost`, and
`profit_margin` unconditionally — no `$this->when()`, no permission check,
no POS-specific gate — while `PosController::products()` (the POS catalog
endpoint) was gated only by the generic `invoices.manage` permission, which
authorizes operating POS, not viewing commercial/cost data. No permission or
setting existed anywhere to distinguish the two.

## 7. Security Implementation

**Chosen approach**: a transient, request-scoped attribute set only by the
POS catalog path, read conditionally by `ProductResource`.

- `PosController::products()` computes
  `$revealCostProfit = Rbac::allows($request->user()?->role ?? '', 'products.view_cost') && PosSettings::showsCostProfitInPos();`
  once per request, then calls `$product->setAttribute('pos_hides_cost_profit', ! $revealCostProfit)`
  on every product in the catalog collection — the exact same established
  idiom this file already uses for `pos_units`/`pos_barcodes`/`sale_price`
  (transient, request-only attributes that never touch the database).
- `ProductResource::toArray()` reads this via
  `array_key_exists('pos_hides_cost_profit', $this->resource->getAttributes())`
  (present only when set by the POS path) and wraps the three fields in
  `$this->when(! $hidesCostProfit, ...)` — Laravel's own mechanism for
  **omitting a key entirely** from the JSON (not `null`, not present-but-empty)
  when the condition is false.
- **Why this layer, not a global `ProductResource` rewrite or a second
  resource class**: per the mission's instruction to choose the narrowest
  safe enforcement layer. A global unconditional removal would have broken
  every other consumer (§5). A parallel `PosProductResource` class would have
  duplicated the entire 30-field mapping for a 3-field difference, and (more
  importantly) `PosController::products()` also attaches
  POS-specific transient fields (`pos_units`, `pos_barcodes`, `sale_price`
  override) that `ProductResource` already merges in — duplicating that
  logic into a second class would be exactly the kind of unrelated,
  risk-bearing refactor the mission's STOP gate warns against. The
  attribute-flag approach reuses the resource the POS path already returns,
  touches zero other call sites, and is trivially reviewable as a 3-line
  diff plus one flag.

## 8. POS Setting Implementation

- **`app/Support/PosSettings.php`**: added `'show_cost_profit_in_pos' => false`
  to the existing `DEFAULTS` array (the same `tenants.settings['sales_config']['pos']`
  JSON-backed structure every other POS toggle already uses — no new
  persistence mechanism, no migration) and a new
  `PosSettings::showsCostProfitInPos(?Tenant $tenant = null): bool` reader,
  mirroring every other boolean reader already in the file
  (`allowsDiscount()`, `allowsUnitPriceOverride()`, etc.).
- **`app/Http/Controllers/Api/SalesConfigController.php`**: added
  `'show_cost_profit_in_pos' => false` to the inline `pos` defaults array
  (line 43) and `'data.show_cost_profit_in_pos' => ['nullable', 'boolean']`
  to the `pos` section's validation rules — the same two places every
  existing POS boolean setting is registered.
- **No migration.** The setting lives in the same JSON column every other
  POS setting already uses.

## 9. Default Behavior for Existing Tenants

A tenant that has never saved this key gets `false` from
`array_merge(self::DEFAULTS, ...)` (the same mechanism that already
guarantees this for every other POS setting) — confirmed by a dedicated test
(`existing_tenants_default_to_the_setting_off_with_no_migration`, §19) that
registers a fresh tenant, never touches the setting, and asserts both that
`GET /sales-config/pos` reports `show_cost_profit_in_pos: false` and that the
POS catalog never includes the sensitive fields for that tenant's owner
account before the setting is ever saved.

## 10. Settings UI Implementation

Added to the existing POS admin configuration screen,
`web/src/app/(app)/pos/settings/configuration/page.tsx` — the established
location for exactly this class of setting (`show_product_images`,
`allow_discount`, `allow_unit_price_override` all live in the same
"Products and pricing" `FormSection`). The new control:

- Uses the exact same `Switch` + label + hint pattern as every neighboring
  toggle in that section — no new component, no new visual pattern.
- Label (English/Arabic, matching the mission's exact requested wording):
  "Show cost and profitability in POS" / "إظهار التكلفة والربحية في نقطة
  البيع".
- Hint text explicitly states the setting alone grants nothing.
- Default OFF (`show_cost_profit_in_pos: false` in the page's config
  defaults, matching the backend default).
- This screen's own `PUT /sales-config/pos` route already requires
  `company.manage` (confirmed in `routes/api.php`) — the existing
  admin-only authorization for this whole configuration screen, unchanged
  by this PR. No cashier-facing surface was touched; this is exactly "a
  tenant/admin policy, not a cashier preference" per the mission.

## 11. API Response Verification

All four required combinations, verified against the actual serialized JSON
(not frontend rendering) in `tests/Feature/PosProductCostVisibilityTest.php`:

| # | Permission (`products.view_cost`) | Setting (`show_cost_profit_in_pos`) | Result |
|---|---|---|---|
| 1 | No (accountant) | OFF (default) | Fields absent — `unauthorized_user_never_receives_cost_fields_regardless_of_the_setting` |
| 2 | No (accountant) | ON | Fields **still** absent — same test, second half |
| 3 | Yes (owner, via `*`) | OFF (default) | Fields absent — `authorized_user_receives_cost_fields_only_when_the_setting_is_also_on`, first half |
| 4 | Yes (owner, via `*`) | ON | Fields present, with correct values — same test, second half |

All assertions use `assertArrayHasKey`/`assertArrayNotHasKey` directly on the
decoded JSON response body — proving actual field **absence**, not merely
that the frontend chooses not to render an existing field.

## 12. Cost-vs-Profit Permission Behavior

The mission asked to inspect whether cost and profit should be governed by
separate permissions and, if their relationship is ambiguous, to document
rather than invent policy. Inspection finding: `profit_margin` is a plainly
stored, user-entered integer (`Product::$fillable`, validated as
`nullable|integer|min:0|max:1000` in `StoreProductRequest`) — it is **not**
computed at read time from `purchase_price`/`sale_price`. However, in normal
business use a tenant enters a margin that reflects
`(sale_price − cost) / cost`, and `sale_price` is **always** visible in POS
(every cashier needs it to sell). This means a user granted "see profit but
not cost" could trivially reconstruct `cost = sale_price / (1 + margin)`
from two numbers already in front of them — profitability visibility
inherently reveals protected cost data in this data model.

**Resolution documented, not invented as an arbitrary split**: rather than
create two permissions with an unsafe gap between them (`products.view_margin`
without `products.view_cost` would leak cost anyway), **one permission,
`products.view_cost`, governs both** `purchase_price`/`avg_cost` and
`profit_margin` together. The security-verification table in §19 shows one
permission column governing both field groups identically — this is the
deliberate outcome of the ambiguity check in the mission's §8, not an
oversight or a missed requirement.

## 13. Tenant Isolation Verification

- The new setting is read via `PosSettings::group($tenant)`, the exact same
  tenant-resolved (`TenantContext`-scoped) accessor every other POS setting
  uses — no new global/static state was introduced.
- Verified directly:
  `the_setting_is_tenant_scoped_and_does_not_bleed_across_tenants` registers
  two separate tenants, enables the setting only for tenant A, and asserts
  tenant B's catalog still has the fields absent while tenant A's (with an
  authorized user) has them present — proving no cross-tenant leakage.

## 14. Branch Isolation Verification

No existing branch scoping on `PosController::products()` or `Product`
queries was touched — the query, its `where('is_active', true)` filter, and
`PosSettings::constrainProductsByCategory()` are all unchanged. The new
setting is deliberately tenant-level (not branch-level), matching the
mission's explicit instruction not to silently convert it to a branch-level
policy, since no existing branch-level equivalent exists to justify that.

## 15. Backward Compatibility

- Existing tenants that never save `show_cost_profit_in_pos`: behave as OFF
  (§9), so no previously-visible-by-accident data becomes newly *more*
  visible, and the fix only *removes* an over-exposure, never adds one.
- Existing ERP product workflows (`ProductController`'s `/products` list and
  detail endpoints): completely unaffected — verified directly by
  `other_product_resource_consumers_outside_pos_are_unaffected`, which
  asserts `GET /products/{id}` still returns `purchase_price`/`profit_margin`
  with their real values for the same product whose POS catalog entry now
  hides them.
- `RoleTest`'s existing assertion that `meta.permissions` echoes
  `Rbac::PERMISSIONS` verbatim continues to pass with the new slug appended
  — no test needed loosening.

## 16. Financial/Accounting Side-Effect Verification

No accounting, tax, ZATCA, inventory-costing, checkout, or invoice-posting
code was touched. `purchase_price`, `avg_cost`, and `profit_margin` remain
stored and computed exactly as before — this PR only controls whether three
already-computed, already-stored values are *serialized* into one specific
API response. Confirmed by the full financial regression suite (§17) passing
unchanged on both engines.

## 17. R1–R6 Preservation

No file under `PosService`, `PosReturnService`, `PosExchangeService`,
`InvoiceService`, `InvoiceResource`, or any return/exchange/checkout path
was modified. `PosCheckoutTest`, `PosCheckoutIdempotencyTest`,
`PosReturnTest`, `PosReturnUomTest`, `PosReturnExchangeIdempotencyTest`,
`PosInvoiceBranchAccessTest`, `BranchIsolationGuardTest` all pass unchanged
on both SQLite and PostgreSQL (§19/§20).

## 18. Files Changed

| File | Change |
|---|---|
| `app/Support/Rbac.php` | New `products.view_cost` permission slug (assignable list only; not added to `accountant`/`staff` matrix) |
| `app/Support/PosSettings.php` | New `show_cost_profit_in_pos` default (false) + `showsCostProfitInPos()` reader |
| `app/Http/Controllers/Api/SalesConfigController.php` | New default + validation rule for the same setting key |
| `app/Http/Resources/ProductResource.php` | `purchase_price`/`avg_cost`/`profit_margin` wrapped in `$this->when(! $hidesCostProfit, ...)`, gated by a transient attribute |
| `app/Http/Controllers/Api/PosController.php` | Computes `$revealCostProfit` (permission AND setting) once per request, sets the transient flag on every catalog product |
| `tests/Feature/PosProductCostVisibilityTest.php` | New — 5 backend tests, exact JSON assertions |
| `web/src/app/(app)/pos/settings/configuration/page.tsx` | New Switch control in the existing "Products and pricing" section |
| `web/src/app/(app)/pos/settings/configuration/page.test.tsx` | 1 new test for the toggle |
| `web/src/messages/en.json` / `ar.json` | New `posSettings.show_cost_profit_in_pos`/`_hint` keys |

No file under `database/migrations/` was added or changed.

## 19. Tests and Exact Results

### Targeted — SQLite
```
php artisan test --filter=PosProductCostVisibilityTest
```
**5 passed (52 assertions).**

### Broader POS/product regression — SQLite
```
php artisan test --filter='PosProductCostVisibilityTest|PosCheckoutTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|ProductBarcodeAndMediaTest|SalesConfigTest|RoleTest'
```
**152 passed (1507 assertions).**

### Full suite — SQLite
```
php artisan test
```
**2344 passed, 1 skipped, 25 failed (16912 assertions).** All 25 failures are
the same pre-existing, environment-only gaps documented in every prior
report for this repository: 24 `Fuel*Test` failures (`Call to undefined
function App\Services\bcmul()` — this environment's PHP lacks the `bcmath`
extension; CI installs it) and 1 `DocumentCenterSecureIntakeTest` failure
(missing `poppler-utils`; CI installs it). Neither is related to this PR;
neither was worked around in production code.

## 20. SQLite/PostgreSQL Results

### PostgreSQL
```
php artisan migrate:fresh --force
```
Succeeds cleanly — confirms, mechanically, that this PR needs no migration.

```
php artisan test --filter='PosProductCostVisibilityTest|PosCheckoutTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|ProductBarcodeAndMediaTest|SalesConfigTest|RoleTest'
```
**121 passed (1393 assertions)** — all 13 test classes green, including
`PosProductCostVisibilityTest` (verified again standalone: 5/5, 52
assertions).

```
php artisan test --filter='LedgerTest|InvoiceTest|PaymentTest|ReturnWithProductTest|ApiProductTest|ProductTest'
```
**126 passed (587 assertions)** — broader financial regression, all green.

A bare full-suite run was not repeated on PostgreSQL (it would only
re-confirm the same two engine-independent, already-documented environment
gaps); the runs above cover every module this PR touches or could plausibly
affect, on PostgreSQL specifically.

## 21. Frontend Tests/Build

```
npx vitest run "src/app/(app)/pos/settings/configuration/page.test.tsx"
```
**18 passed** (17 pre-existing + 1 new).

```
npx vitest run
```
**224 test files, 1422 tests passed** — full frontend suite, zero failures.

```
npm run build
```
**Exit code 0.**

## 22. Security Verification Truth Table

| Cost Permission (`products.view_cost`) | Profit Permission (same slug, §12) | POS Setting (`show_cost_profit_in_pos`) | Cost fields (`purchase_price`, `avg_cost`) in POS API | Profit field (`profit_margin`) in POS API |
|---|---|---|---|---|
| No | No | OFF | Absent | Absent |
| No | No | ON | Absent | Absent |
| Yes | Yes | OFF | Absent | Absent |
| Yes | Yes | ON | Present | Present |

Every row verified by an actual API response assertion in
`PosProductCostVisibilityTest` (§11/§19) — no row relies on frontend
rendering as a proxy for API exposure.

## 23. Known Limitations

- Only one permission slug governs both cost and profit, as a deliberate,
  documented resolution of an unsafe split (§12) — not a limitation to fix
  later, but worth a reviewer's explicit sign-off given the mission
  anticipated a possible two-permission model.
- No dedicated custom-role UI test was added for granting
  `products.view_cost` to a non-system role — the existing generic custom
  role management screen and its existing tests (`RoleTest`) already cover
  assigning arbitrary permissions from `Rbac::PERMISSIONS`, which now
  includes this slug; no new UI or test surface was needed for that part.

## 24. Deferred Items

- **Category Color mode** — still DEFERRED/BLOCKED. No `color` column exists
  on `product_categories`; unchanged by this PR. Not silently marked done,
  not touched.
- **Category Presentation Mode (`Default | Image | Color`)** — still
  DEFERRED/BLOCKED. No persisted POS category-presentation setting exists;
  unchanged by this PR. Not silently marked done, not touched.

## 25. Risks

- None identified beyond the single documented design choice in §12/§23.
  The fix is additive and fails safe in every combination (§22).

## 26. Draft PR Number/Link

Recorded after creation (see below).

## 27. Branch

`claude/pos-pr2s-cost-profit-security`

## 28. Base SHA

`b94718a432d01dab7d5bde04dda2259717ef2a28`

## 29. Head SHA

Recorded after commit (see below).

## 30. Integration Note for PR #654

PR #654 (Draft, unmerged) built a POS Product Quick View that already
deliberately never reads or renders `purchase_price`/`avg_cost`/
`profit_margin` — confirmed by re-reading its `pos-product-quick-view.tsx`
and `pos-receipt.ts`-adjacent types, neither of which declares these fields.
**No code in #654 needs to change for this fix to apply cleanly once both
merge**: the `Product` TypeScript type PR #654 introduced never requested
these fields from `/pos/products`, and this PR does not add or rename any
field PR #654 depends on — it only removes three fields from the response
under specific conditions, and only for tenants/users that were never
supposed to have them. If a future PR wants an authorized, setting-enabled
POS surface to show cost/margin (e.g., an extended Quick View section, or a
margin column in a manager view), it should:

1. Check the user's own returned permissions (already available from `/me`,
   the same pattern PR #654 established for `products.view` gating on the
   "Open in ERP" link) for `products.view_cost`.
2. Read `show_cost_profit_in_pos` from `GET /sales-config/pos` (already
   fetched by the POS page as `posCfg`).
3. Only then read `purchase_price`/`avg_cost`/`profit_margin` from the
   catalog response — which will simply be present or absent per this PR's
   server-side gate, requiring no further frontend-side security logic.

## 31. Recommended Next Step

Merge this PR independently of #654 (no ordering dependency either way).
When #654 is ready to merge, no rebase-driven conflict is expected — the two
PRs touch disjoint files (this PR never touches `pos-product-tile.tsx`,
`pos-product-quick-view.tsx`, or `pos/page.tsx`). After both are in, consider
a small follow-up PR that lets an authorized manager expand Quick View to
show cost/margin when `show_cost_profit_in_pos` is on — using the three-step
integration pattern in §30 — as a natural, explicitly separate next task.
