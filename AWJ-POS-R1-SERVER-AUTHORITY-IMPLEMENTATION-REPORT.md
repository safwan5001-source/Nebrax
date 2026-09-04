# AWJ POS — R1: Server Authority for Product Eligibility and Tax Rate

## Summary

R1 closes two financial-integrity gaps in POS checkout (`PosService::checkout`):

1. **Product eligibility** — a direct/crafted checkout request could reference a
   product that had been deactivated (`is_active = false`) after the client's
   catalog was loaded/cached, since checkout never re-checked `is_active`.
2. **Tax rate authority** — `items.*.tax_rate` was accepted from the client and
   used as-is in `InvoiceService::applyItemsAndTotals()` to compute
   `line_tax`/`total`, so a manipulated request could understate (or overstate)
   VAT on the resulting invoice.

Both are now enforced server-side, inside the same DB transaction as the rest
of POS checkout's existing validations (session, category policy, unit price,
discount policy).

## Root Cause

- `PosService::assertProductsAllowedForPos()` fetched only `id, category_id`
  for the submitted product IDs and checked category policy — it never
  selected or checked `is_active`. The POS catalog endpoint
  (`PosController::products`) filters `is_active = true`, but that is a
  read/display filter; it was never re-asserted at checkout, so it was not a
  real server-side guarantee.
- `InvoiceService::applyItemsAndTotals()` (shared by every document type —
  invoices, quotes, purchases, returns, POS) reads
  `$item['tax_rate'] ?? default_tax_rate` directly from the request payload
  with no cross-check against the product's own `tax_rate` column. This is
  correct/expected for manually-priced documents where a user may legitimately
  override a line's tax treatment, but POS checkout — a flow meant to be
  driven entirely by the trusted catalog — was reusing that same permissive
  path with no additional guard.

## Implementation

Both fixes are contained entirely in `PosService`, the one place POS checkout
is orchestrated, and do not touch `InvoiceService`, its request contract, or
any other document type that legitimately allows a user-supplied `tax_rate`.

1. **Product eligibility** — `assertProductsAllowedForPos()` now also selects
   `is_active` and rejects the whole checkout (`RuntimeException` → HTTP 422,
   no invoice/payment created) if any referenced product is inactive. This
   runs before any invoice or stock mutation, consistent with the existing
   category-policy check right next to it.

2. **Tax rate authority (server replacement)** — a new
   `withAuthoritativeTaxRates()` step runs right after the existing
   product/price/discount policy checks and before `InvoiceService::create()`
   is called. For every line with a `product_id`, it overwrites
   `item['tax_rate']` with that product's own `tax_rate` column (already
   fetched by `assertProductsAllowedForPos()`, so no extra query). For a
   descriptive line with no `product_id`, it uses the tenant's
   `Settings::get('sales', 'default_tax_rate')` — the same fallback
   `InvoiceService` already uses today. The client-submitted `tax_rate` is
   never read again after this point.

   **Why replacement, not mismatch-rejection:** POS is a closed loop — the
   only place a `tax_rate` for a POS line should come from is the tenant's own
   product catalog, which the server already resolves independently. Silent
   replacement:
   - Requires no new error code/response shape (100% backward compatible with
     existing POS clients that already send the catalog's own rate).
   - Cannot be used to probe the server's authoritative rate via a 409/422 diff
     (mismatch-rejection would leak that signal).
   - Keeps checkout deterministic and idempotent: the same request always
     produces the same authoritative invoice regardless of what the client
     sent.

   Mismatch-rejection was considered and rejected because it would break any
   existing well-behaved POS client that sends a rate the server later changes
   (e.g. tenant support edits a product's `tax_rate`), turning a routine
   catalog update into a hard failure at the counter — a worse outcome for a
   financial-integrity fix than silently using the correct rate.

## Changed Files

- `app/Services/Accounting/PosService.php`
  - `assertProductsAllowedForPos()`: now selects and checks `is_active`;
    returns the fetched `Product` collection (keyed by id) instead of `void`,
    so the tax-rate step can reuse it without a second query.
  - New `withAuthoritativeTaxRates()`: replaces every line's `tax_rate` with
    the product's own rate (or the sales default for descriptive lines) before
    `InvoiceService::create()` is called.
  - `executeCheckoutWithinTransaction()`: wires the two together — validates
    products, then rewrites `$data['items']` with authoritative tax rates,
    then proceeds exactly as before (invoice create → post → tenders → drawer
    → audit → idempotency record).
- `tests/Feature/PosCheckoutTest.php`
  - `it_rejects_a_direct_checkout_referencing_an_inactive_product`
  - `it_ignores_a_tampered_tax_rate_and_uses_the_products_authoritative_rate`

No migration, no new columns, no API contract change (`StorePosSaleRequest`
and `PosController::checkout()` are untouched — `tax_rate` remains an
accepted, now purely advisory, input field).

## Financial / Tax Behavior

The authoritative tax source for a POS line is:

- **Product line** (`product_id` present): `products.tax_rate` — the same
  column already shown/edited on the product record and used everywhere else
  in the system.
- **Descriptive line** (no `product_id`): `Settings::get('sales',
  'default_tax_rate')` — the tenant's configured default (15 by default),
  identical to what `InvoiceService` already falls back to.

`InvoiceService::applyItemsAndTotals()` is unmodified: it still computes
`line_tax`, `line_total`, and the invoice `total` purely from the line items
it's given — R1 simply ensures those line items carry the server's own
`tax_rate` by the time they reach that function, for the POS path only.

**Manipulation scenario prevented:** a checkout request for a 100.00 SAR item
with `tax_rate: 0` (instead of the product's real 15%) previously produced an
invoice totaling 100.00 SAR with zero VAT. After R1, the same request still
succeeds, but the server ignores the submitted `0` and computes the invoice
using the product's real 15%, producing 115.00 SAR total with 15.00 SAR VAT —
verified in `it_ignores_a_tampered_tax_rate_and_uses_the_products_authoritative_rate`.

**Existing legitimate flows unaffected:** every existing POS test sends a
`tax_rate` that already matches the product's real rate (15, the seeded
default), so totals are byte-identical before/after this change — confirmed
by all pre-existing POS/invoice/payment tests passing unmodified.

## Tenant Isolation

Unaffected — no query in the new/changed code paths reads across tenants.
`Product::whereIn('id', $ids)` already relies on `BaseModel`'s automatic
`TenantScope` (see `assertTenantOwnedAll()` in `PosController::checkout()` for
the pre-existing explicit tenant-ownership check, which is untouched). The
existing `it_isolates_references_to_the_tenant` test still passes, and no new
cross-tenant read/write was introduced.

## Idempotency

Unaffected by design:

- The idempotency checksum (`checkoutRequestChecksum()`) is computed from the
  **original, client-submitted** request in `checkout()`, *before*
  `executeCheckoutWithinTransaction()` runs and rewrites `tax_rate`. Replay
  and conflict semantics (same key + same payload → replay; same key +
  different payload → 409) are keyed off exactly what the client sent, which
  is unchanged behavior.
- The authoritative-tax-rate rewrite happens only on the *first* successful
  execution, inside the transaction that creates the invoice. A replay never
  re-enters that code path — it returns the already-created invoice from
  `replayCheckoutAttempt()`.
- Confirmed by the full, unmodified `PosCheckoutIdempotencyTest` suite passing
  on both SQLite and PostgreSQL (7/7 in each run).

## Tests

### Targeted — SQLite

```
php artisan test --filter=PosCheckoutTest
php artisan test --filter=PosCheckoutIdempotencyTest
```
Result: **20 passed / 250 assertions** (`PosCheckoutTest`, includes the 2 new
R1 tests), **7 passed / 88 assertions** (`PosCheckoutIdempotencyTest`).

### Targeted — PostgreSQL

```
php artisan test --filter='PosCheckoutTest|PosCheckoutIdempotencyTest'
```
Result: **27 passed / 338 assertions**.

### Broader regression — SQLite

```
php artisan test --filter='Pos|LedgerTest|InvoiceTest|PaymentTest'
```
Result: **451 passed / 3543 assertions**, plus 3 pre-existing failures in
`FuelReconciliationTest`/`FuelSupplyReceivingTest` — all `Call to undefined
function App\Services\bcmul()`. Unrelated to R1: the local test environment's
PHP is missing the `bcmath` extension (confirmed via `php -m`), which
`FuelCostBasisService` depends on for rational cost-basis math. This module is
untouched by R1. CI (`.github/workflows/ci.yml`) installs `bcmath` explicitly
and is unaffected.

### Full suite — SQLite

```
php artisan test
```
Result: **2277 passed, 1 skipped, 13 failed** (16082+ assertions). All 13
failures are the same pre-existing `bcmath` gap in the Fuel module described
above (`FuelReconciliationTest`, `FuelSupplyReceivingTest`) — none touch POS,
invoicing, payments, or tax logic. (One additional, separately-diagnosed and
environment-only issue was found and fixed *locally* during this task: the
assembled Laravel app at `/home/user/nibras-app` was missing
`app/Jobs/Accounting/` because the local `setup.sh` script's copy list
predates that directory being added — CI's copy list already includes it, so
CI is unaffected. This was not a code change; it only affected local test
execution and is not part of this PR's diff.)

### Broader regression — PostgreSQL

```
php artisan test --filter='Pos|LedgerTest|InvoiceTest|PaymentTest'
```
Result: **451 passed / 3543 assertions**, same 3 pre-existing `bcmath`
failures as SQLite, nothing else.

## Compatibility

- **API**: No contract change. `StorePosSaleRequest` validation rules are
  untouched; `items.*.tax_rate` remains `nullable|integer|min:0|max:100` and
  is still accepted (now purely advisory for POS).
- **Database**: No migration. No new columns, tables, or indexes.
- **ZATCA**: No change. Invoice tax fields are still populated by
  `InvoiceService` from the (now server-corrected) line items exactly as
  before; QR/TLV and Phase 2 fields are computed downstream, unaffected.
- **Existing POS clients/integrations**: Unaffected as long as they send the
  product's real tax rate (the expected/only correct behavior today) — totals
  are unchanged. A client that was (accidentally or otherwise) sending a
  mismatched rate will now see the *correct* total instead of an
  under/over-taxed one.

## Risks / Remaining

- `withAuthoritativeTaxRates()` intentionally does not distinguish "client
  sent the correct rate" from "client sent a wrong rate" — both are silently
  normalized to the product's rate. This is the deliberate, documented
  trade-off (see Implementation). If product analytics ever need to detect
  tampering attempts specifically (vs. stale client caches), that would need
  a separate, explicit audit log entry — out of scope for R1.
- This does not address tax-rate trust for *other* document types (manual
  invoices, quotes, purchases, returns) — those retain their existing,
  intentionally more permissive behavior where a user may override a line's
  tax rate. R1 was scoped to POS checkout only, per the mission brief.
- Local dev/test environment gaps found during this task (`bcmath` PHP
  extension missing; local `setup.sh` copy list stale for
  `app/Jobs/Accounting/`) are documented here rather than fixed in this PR, as
  instructed — they do not affect CI and are unrelated to R1.

## Git

- Branch: `claude/r1-pos-server-authority-8mxb2o`
- Base SHA: `9d7d39fc509227d02f37434db83be211dedb0fc2` (origin/main at session
  start; one commit ahead of the historical audit's reference SHA
  `aa23bff70959b2c82c1443f38ac41153a1fa7e13`, unrelated document-scanning
  work)
- Head SHA: recorded at PR creation time
- PR: Draft — link recorded after creation

## Next Step

R1 is complete and verified. **Stop here** — do not begin R2 or any other POS
V2 work. Recommend human review of the Draft PR (in particular the
replacement-vs-rejection tax-authority decision above) before merge.
