# AWJ POS V2 — R3 + R6: Invoice Branch Access & Customer Eligibility

## 1. Executive Summary

Two independent, previously-confirmed authorization gaps in POS are closed:

- **R3 — direct POS invoice branch access**: `GET /invoices/{id}` and
  `GET /invoices/{id}/zatca` (the general invoice detail/receipt endpoints,
  which every "view invoice" and "reprint receipt" link in the POS recent-
  invoices list resolves to) never applied branch scoping, unlike every
  sibling read on the same controller (`payments`, `accounting`, `inventory`,
  `notes`, `duplicate`). A branch-restricted user who learned another
  branch's invoice UUID (leak, guess, stale link) could view it in full —
  same tenant only, never cross-tenant. Fixed by routing both through the
  controller's own pre-existing `scopeToActiveBranch()`/`visibleInvoice()`
  primitive, the exact same one its neighbors already use.
- **R6 — POS customer eligibility**: `PosService::checkout()` never
  validated that `partner_id` was an eligible POS customer — only that it
  existed in the tenant. An inactive customer, an inactive `both`-type
  partner, or a supplier-only partner (never shown in the picker, but
  reachable by a direct/crafted request with a known id) could all complete
  a real, financially-effective checkout. Fixed by enforcing, inside
  `PosService::checkout()` before any invoice or stock effect, the exact
  eligibility rule the codebase already uses for the POS default-customer
  setting (`Partner.is_active && type IN ('customer','both')`) — extracted
  once into `PosSettings::isEligibleCustomer()` and now shared by both call
  sites instead of existing as two independent, driftable copies.

Both fixes are minimal, additive, and confined to R3/R6. R5 was not started.
Nothing was merged or deployed.

## 2. Actual Base SHA

`26e586739591a6702794c8ec4b104fb2ffe060cd` — confirmed as `origin/main`'s
HEAD at session start (fetched fresh; matches the R2+R4 merge commit
(#647) the task referenced, so no drift since that merge).

## 3. Head SHA

Recorded at PR creation time (see Git section below / PR page).

## 4. Branch

`claude/r3-r6-pos-branch-customer-hardening`

## 5. PR Number/Link

Draft PR — number/link recorded after creation (see Git section below).

## 6. R3 Root Cause

`InvoiceController` has a private `visibleInvoice(Request $request, string
$id)` helper (`scopeToActiveBranch(Invoice::query(), $request)->findOrFail($id)`)
used consistently by `payments()`, `accounting()`, `inventory()`, `notes()`,
`downloadNoteAttachment()`, and `duplicate()`. **`show()` — the plain
`GET /invoices/{id}` used to view or reprint any invoice, including a
posted POS sale — never called it**, using bare
`Invoice::with([...])->findOrFail($id)` instead: tenant-scoped (automatic via
`BaseModel`/`TenantScope`), but not branch-scoped. `zatca()` (`GET
/invoices/{id}/zatca`, the receipt QR/hash data POS fetches right after
checkout) had the identical gap: `Invoice::findOrFail($id)` with no
`Request` parameter at all, so it could not have called `visibleInvoice()`
even if it had tried.

The POS "recent invoices" **list** (`PosController::recentInvoices()`)
already correctly uses `scopeToActiveBranch()`, so a restricted user never
*sees* a foreign-branch invoice in that list — but clicking through relies on
the frontend navigating to `/invoices/{id}`, and nothing stopped a direct
request to that same URL with a different, known id.

## 7. R3 — Exact Authorization Model Discovered

No new model was invented; R3 reuses the following pre-existing, already-
established mechanism end to end:

1. **Tenant isolation** — automatic and unconditional via `BaseModel`'s
   `TenantScope`; every query is already confined to the current tenant
   before anything else applies.
2. **`User::allowedBranchIds()`** — `null` for a user with no explicit
   `branches()` assignments (**unrestricted**: sees every branch in the
   tenant), or the array of assigned branch ids for a **restricted** user.
3. **`User::canAccessBranch($id)`** — `true` for an unrestricted user
   regardless of `$id`; for a restricted user, `true` only if `$id` is in
   their assigned set.
4. **`SetBranch` middleware`** — resolves the request's active branch from
   the `X-Branch-Id` header, but **only accepts it if
   `$user->canAccessBranch($requested)`**; otherwise falls back to a safe
   default. This guarantees `BranchContext::id()` is *always* a branch the
   current user is legitimately allowed to be in — a forged header cannot
   plant an unauthorized active branch.
5. **`ApiController::scopeToActiveBranch()`** — the read-side enforcement
   primitive: filters a query to the active branch (default), or, with
   `?branch=all`, to every branch **the user is allowed to see**
   (`allowedBranchIds()`) — never to every branch in the tenant regardless of
   the user's own assignment. Rows with `branch_id IS NULL` (pre-branch data)
   remain visible to everyone, by design (documented in the method's own
   docblock — a historical-data provision, not a new interpretation).

R3's fix is simply: make `show()` and `zatca()` go through step 5 like every
sibling method already does. No new primitive, no new permission, no new
column.

## 8. R3 Implementation

`app/Http/Controllers/Api/InvoiceController.php`:

- `show(string $id)` → `show(Request $request, string $id)`, wrapping the
  same eager-load chain in `$this->scopeToActiveBranch(Invoice::with([...]),
  $request)->findOrFail($id)` instead of a bare `Invoice::with([...])->findOrFail($id)`.
- `zatca(string $id)` → `zatca(Request $request, string $id)`, using the
  existing `$this->visibleInvoice($request, $id)` helper (identical to
  `payments()`/`accounting()`/etc.).

No other method on `InvoiceController` was touched. `update()`,
`updateClassification()`, `destroy()`, and `post()` still use bare
`Invoice::findOrFail($id)` — **left alone deliberately**: those all mutate
*draft* invoices (guarded by their own "must be draft" checks), and POS never
leaves a checkout invoice in draft state (`PosService::checkout()` creates
and posts atomically) — so they sit outside the "direct POS invoice access"
attack surface this mission describes, and touching them would be exactly
the "redesign of invoice permissions" the mission explicitly forbids
broadening into. This is flagged in Risks/Remaining below for visibility,
not silently dropped.

`ZatcaSubmissionController` (a separate, unrelated ZATCA submission-history
endpoint) was checked and confirmed **not** referenced by any POS frontend
code — left untouched.

## 9. R6 Root Cause

`PosController::checkout()` calls `Partner::findOrFail($data['partner_id'])`
— proves the partner exists and belongs to the current tenant (via
`TenantScope`), nothing more. `PosService::checkout()` /
`executeCheckoutWithinTransaction()` never re-checked eligibility either; it
went straight to price-list resolution and invoice creation. Meanwhile,
`SalesConfigController` already enforces a **stricter, correct** rule for
the POS *default*-customer setting (`is_active` + `type IN ('customer',
'both')`) via a private `findEligiblePosCustomer()` — checkout itself was
the *only* POS customer-facing path that did **not** apply this rule,
exactly matching the audit's framing ("the default POS customer setting
already has stronger eligibility validation than checkout").

The frontend `CustomerPickerDialog` filtered by `type` (`customer`/`both`)
but never by `is_active` — an inactive customer/both partner was shown and
selectable in the normal picker, matching the audit's "inactive customer →
reachable through normal picker" finding.

## 10. Canonical Customer Eligibility Rule Discovered

`SalesConfigController::findEligiblePosCustomer(string $id): ?Partner`:

```php
Partner::query()->whereKey($id)->where('is_active', true)
    ->whereIn('type', ['customer', 'both'])->first();
```

Used for: validating a newly-configured `default_customer_id` (write path),
and re-validating the *currently configured* one on every settings read
(`normalizePosDefaultCustomerForRead()` — which nulls out a `default_customer_id`
that has since become inactive or changed type, so the effective default
customer is always re-verified against this exact rule, never stale). The
legacy by-name default-customer fallback in the same method inlines the
identical `is_active` + `type IN (...)` condition. This is unambiguously the
system's one, pre-existing definition of "who is an eligible POS customer" —
R6 extends it to checkout rather than inventing a second one.

## 11. R6 Implementation

`app/Support/PosSettings.php` — new public static predicate, extracted
directly from the rule above so there is exactly one definition instead of
two independently-maintained copies:

```php
public static function isEligibleCustomer(Partner $partner): bool
{
    return $partner->is_active && in_array($partner->type, ['customer', 'both'], true);
}
```

`app/Http/Controllers/Api/SalesConfigController.php` —
`findEligiblePosCustomer()` refactored to call `PosSettings::isEligibleCustomer()`
(fetch-then-check instead of a DB-filtered query; same result for the same
input, since both express the identical two conditions). The
by-name legacy fallback query was left as its own inline DB filter
(unrelated code path, lower risk to leave untouched, not required for R6).

`app/Services/Accounting/PosService.php` — new private
`assertCustomerEligibleForPos(string $partnerId): void`, called at the top
of `executeCheckoutWithinTransaction()` (before price-list resolution,
before any invoice or stock write), raising the same `RuntimeException` →
422 pattern every other POS assertion in this file already uses
(`assertProductsAllowedForPos`, `assertUnitPricesAllowedForPos`,
`assertDiscountsAllowedForPos`). A missing or ineligible partner throws
immediately; nothing is silently substituted (per requirement: never
silently convert an invalid customer into another one).

**Exchange replacement leg**: `PosExchangeService::buildAndPostExchange()`
routes its replacement sale through `PosService::checkout()` too, so it now
inherits the same eligibility check on `$source->partner_id` (the *original*
sale's customer). This is intentional, not a side effect to work around: an
exchange's replacement leg is a real new sale, and letting a customer who
has since been deactivated receive new merchandise through "exchange" while
blocked from ordinary checkout would reopen exactly the loophole R6 closes.
All existing exchange tests use active customers throughout, so no currently
passing scenario is affected — see Tests below.

**Frontend** (`web/src/components/pos/customer-picker.tsx`): the fetched
partner list is now filtered by `p.is_active && ['customer','both'].includes(p.type)`
instead of type alone — the smallest possible correction so the normal
picker only ever offers eligible customers, exactly mirroring what the
server now enforces. `customer-picker.test.tsx` updated to include an
inactive customer fixture and assert it is not rendered.

## 12. Files Changed and Why

| File | Change | Why (R3/R6) |
|---|---|---|
| `app/Http/Controllers/Api/InvoiceController.php` | `show()`/`zatca()` now branch-scoped via the existing `scopeToActiveBranch()`/`visibleInvoice()` primitive | R3 |
| `app/Support/PosSettings.php` | New `isEligibleCustomer(Partner): bool` — single source of truth for POS customer eligibility | R6 |
| `app/Http/Controllers/Api/SalesConfigController.php` | `findEligiblePosCustomer()` now calls the shared predicate instead of duplicating the condition | R6 |
| `app/Services/Accounting/PosService.php` | New `assertCustomerEligibleForPos()`, called before any checkout side effect | R6 |
| `web/src/components/pos/customer-picker.tsx` | Picker now also filters out inactive partners (was type-only) | R6 (UX hardening, not the enforcement itself) |
| `web/src/components/pos/customer-picker.test.tsx` | Updated fixture + assertion for the `is_active` filter | R6 test |
| `tests/Feature/PosInvoiceBranchAccessTest.php` | New — 7 tests covering R3 | R3 |
| `tests/Feature/PosCheckoutTest.php` | 4 new tests covering R6 appended | R6 |

No migration. No new/changed request field. No route added, removed, or
renamed (two existing route closures gained a `Request $request` parameter,
which Laravel resolves automatically regardless of declared order — the URL,
verb, and response shape are all unchanged).

## 13. Tests Run — Exact Commands/Results

### A. New targeted R3 tests — SQLite

```
php artisan test --filter=PosInvoiceBranchAccessTest
```
**7 passed / 99 assertions.**

### B. New targeted R6 tests — SQLite

```
php artisan test --filter=PosCheckoutTest
```
**24 passed / 285 assertions** (20 pre-existing R1 tests + 4 new R6 tests, all
green together).

### C. Existing directly related tests — SQLite

```
php artisan test --filter='PosDefaultCustomerSettingsTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|ApiInvoiceTest|BranchIsolationGuardTest'
```
**57 passed / 767 assertions.**

### D. Broader financial regression — SQLite

```
php artisan test --filter='LedgerTest|InvoiceTest|PaymentTest|ReturnWithProductTest|ReturnWindowPolicyTest|InvoiceRelationsApiTest|InvoiceNoteApiTest|InvoiceInventoryApiTest|InvoiceAppointmentTest|InvoiceTemplateOverrideTest|ZatcaSubmissionAttemptTest|ZatcaTest'
```
**156 passed / 739 assertions.**

### Full suite — SQLite

```
php artisan test
```
**2303 passed, 1 skipped, 25 failed** (16470 assertions). All 25 failures are
the same pre-existing, environment-only gaps already documented in the R1
and R2+R4 reports for this repository, confirmed unrelated to R3/R6:

- **24** `FuelReconciliationTest`/`FuelSupplyReceivingTest`/`FuelSaleServiceTest`/
  `FuelAviRfidServiceTest`/`FuelSaleApiTest`/`FuelSupplyReceivingApiTest` —
  `Call to undefined function App\Services\bcmul()`; this session's PHP has
  no `bcmath` extension (`php -m` confirms), which `FuelCostBasisService`
  needs. Unrelated module; CI installs `bcmath` explicitly.
- **1** `DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted_and_the_page_limit_fails_closed` —
  this environment is missing `poppler-utils` (`pdfinfo`/`pdftoppm` absent).
  Unrelated to POS; CI installs `poppler-utils` explicitly.

Neither gap was worked around in production code.

## 14. SQLite Results

Summarized above — see sections A–D and Full suite. All R3/R6-relevant
tests green; only the two pre-existing, unrelated environment gaps fail.

## 15. PostgreSQL Results

```
php artisan migrate:fresh --force
```
Succeeds cleanly (no new migration in this PR — the pre-existing schema from
R1/R2/R4 applies unchanged).

```
php artisan test --filter='PosInvoiceBranchAccessTest|PosCheckoutTest'
```
**31 passed / 384 assertions** (targeted R3+R6).

```
php artisan test --filter='PosInvoiceBranchAccessTest|PosCheckoutTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|LedgerTest|InvoiceTest|PaymentTest|ReturnWithProductTest|ReturnWindowPolicyTest|ZatcaTest'
```
**199 passed / 1513 assertions** (broader financial + POS regression).

Full/broader suite on PostgreSQL was scoped to the above (not a bare full
run) since the two known environment gaps (`bcmath`, `poppler-utils`) are
engine-independent and would only re-confirm the same, already-documented
finding; the 199-test run covers every module R3/R6 touches or could
plausibly affect on PostgreSQL specifically, per the mission's "meaningful
backend verification on both engines" instruction.

## 16. Frontend Build/Tests

Frontend files changed (`customer-picker.tsx`, its test), so both were run:

```
npx vitest run src/components/pos/customer-picker.test.tsx   → 1 passed
npx vitest run                                                → 222 files, 1405 tests passed
npm run build                                                 → ✓ Compiled successfully, 150/150 static pages, exit 0
```

## 17. Tenant Isolation Verification

- Unaffected by construction: both fixes operate strictly *inside* the
  tenant boundary already established by `TenantScope`. R3's
  `scopeToActiveBranch()` filters branches *within* the current tenant only;
  R6's `Partner::find($partnerId)` in `PosService` resolves inside the same
  automatic tenant scope every other POS lookup already uses.
- `PosInvoiceBranchAccessTest::a_different_tenant_cannot_reach_the_invoice_at_all`
  confirms a foreign tenant gets 404 on the same invoice id, unchanged from
  before this PR (this was never the vulnerable path — the audit explicitly
  states R3 "was NOT a cross-tenant bypass").
- `PosCheckoutTest::it_isolates_references_to_the_tenant` (pre-existing,
  unmodified) continues to pass, confirming R6 didn't relax the existing
  tenant check on `partner_id` in the controller.

## 18. Branch Isolation Verification

- `BranchIsolationGuardTest` (fails the whole suite if any business model is
  unclassified) passes unchanged — no new model was introduced by R3/R6.
- `PosInvoiceBranchAccessTest` explicitly covers: same-branch allow,
  cross-branch deny (the core R3 fix), `?branch=all` still respecting the
  user's own allowed set (not every tenant branch), an unrestricted user's
  cross-branch access preserved, and the pre-existing return/exchange
  session-branch guard (`assertSourceMatchesSession`) still rejecting a
  foreign-branch source invoice — confirming R3 did not touch or weaken that
  separate, already-existing guard.

## 19. Accounting/Financial Regression Verification

- `LedgerTest`, `InvoiceTest`-family, `PaymentTest`, `ReturnWithProductTest`,
  `ReturnWindowPolicyTest`, `ZatcaTest`, `ZatcaSubmissionAttemptTest` all pass
  unchanged on both engines — R3/R6 touch no journal-entry, tax, or ZATCA
  logic.
- R1 protections re-verified directly: `PosCheckoutTest`'s
  `it_rejects_a_direct_checkout_referencing_an_inactive_product` and
  `it_ignores_a_tampered_tax_rate_and_uses_the_products_authoritative_rate`
  both still pass unmodified alongside the 4 new R6 tests in the same run.
- R2 (UOM) and R4 (idempotency) protections re-verified directly:
  `PosReturnUomTest` (6/6) and `PosReturnExchangeIdempotencyTest` (13/13)
  both pass unchanged.
- Checkout idempotency re-verified: `PosCheckoutIdempotencyTest` (7/7)
  unchanged — R6's new assertion runs *before* the idempotency
  replay/conflict logic in `executeCheckoutWithinTransaction()`, so a
  replayed request with an already-validated customer is unaffected, and a
  first-time request with an ineligible customer fails the same way on every
  retry (no idempotency-key state is written before the assertion passes).

## 20. Backward Compatibility Assessment

- **R3**: `show()` and `zatca()` gained a `Request $request` parameter each
  (Laravel resolves controller parameters by type/route-binding, not
  declaration order, so this is not a breaking signature change for the
  route). Response shape, status codes for the success path, and the URL/verb
  are all unchanged. The only behavior change is that a request for an
  invoice outside the caller's allowed branch(es) now 404s instead of 200 —
  which is the fix itself, not a regression, and only affects
  branch-*restricted* users (unrestricted users, the ERP-admin default, see
  no change at all).
- **R6**: `StorePosSaleRequest`'s contract is completely unchanged — no new
  field, no relaxed/tightened field-level rule. The only behavior change is
  that a checkout naming an ineligible `partner_id` now 422s before any
  document is created, instead of succeeding. Every existing passing test
  already used an active `customer`/`both` partner (the only kind the
  frontend picker offered, until this PR also tightened it), so no currently
  legitimate flow is affected — confirmed by the full existing `PosCheckoutTest`,
  `PosReturnTest`, and `PosReturnUomTest` suites passing unmodified.

## 21. API/DB Changes

**None.** No migration, no new table/column, no new required request field,
no route added/removed/renamed, no changed response shape for any successful
request.

## 22. Risks / Remaining Limitations

- `InvoiceController::update()`, `updateClassification()`, `destroy()`, and
  `post()` still resolve their invoice via bare `Invoice::findOrFail($id)`
  (tenant-scoped, not branch-scoped). These all operate on *draft* invoices
  — a state POS checkout never leaves an invoice in — so they sit outside
  this mission's "direct POS invoice access" scope by design, not oversight.
  If branch-restricted users are ever given draft-invoice edit permissions
  in the general (non-POS) invoice screens, this would be worth a dedicated,
  separate review.
- `PosExchangeService`'s replacement leg now inherits the R6 eligibility
  check transitively (see §11) — this is intentional and tested indirectly
  (existing exchange tests all use active customers and continue to pass),
  but there is no *dedicated* new test asserting "exchange rejects a
  since-deactivated customer" specifically; it follows directly from
  `PosService::checkout()` being a single, shared code path, not from
  separate logic that could drift.
- Local dev/test environment gaps (`bcmath` extension missing,
  `poppler-utils` missing) are documented, not fixed, and confirmed
  unrelated to this PR; CI installs both explicitly.

## 23. Confirmation R5 Was NOT Started

Confirmed. No file under this PR's diff relates to receipt source migration,
POS Invoice Center, Product Quick View, cart Selected Line UX, numeric
keypad UX, payment workspace, session UX, receipt templates, printer/
hardware, offline-first, category presentation, product-card redesign,
ZATCA, or tax logic. The diff is exactly: two `InvoiceController` methods
(R3), one new `PosSettings` predicate + its two call sites (R6), and the
corresponding tests.

## 24. Next Recommended Step

R3 and R6 are complete and verified on both SQLite and PostgreSQL. **Stop
here** — do not begin R5. Recommend human review of the Draft PR, in
particular the two intentionally-untouched draft-invoice mutation endpoints
(§22) and the transitive effect on the exchange replacement leg, before
merge.

## Git

- Branch: `claude/r3-r6-pos-branch-customer-hardening`
- Base SHA: `26e586739591a6702794c8ec4b104fb2ffe060cd`
- Head SHA: recorded at PR creation time
- Draft PR: link recorded after creation
