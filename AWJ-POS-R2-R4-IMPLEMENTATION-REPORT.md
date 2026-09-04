# AWJ POS V2 — R2 + R4: Return UOM Correctness & Idempotency

## Executive Summary

Two independent, previously-confirmed financial-integrity gaps in POS returns
and exchanges are closed:

- **R2 — UOM correctness**: a POS return's stock-back quantity ignored the
  original sale line's `unit_factor`. Selling 2 boxes (12 base units each)
  and returning 1 box restocked **1** base unit instead of **12**. Fixed at
  the single point where returned stock is written back
  (`ReturnService::postSalesReturn()`), using the historical, immutable
  `unit_factor` snapshot stored on the original `InvoiceLine`.
- **R4 — durable idempotency**: POS return and exchange creation had no
  server-side replay/conflict protection. A lost response followed by a
  client retry could create a second return document, a second exchange
  (return + replacement + surplus settlement), and duplicate financial/stock
  effects. Fixed by adding the same durable-attempt pattern POS checkout
  already uses (R1's `pos_checkout_attempts` table), via two new tables:
  `pos_return_attempts` and `pos_exchange_attempts`.

Both fixes are scoped strictly to POS return/exchange. R3, R5, R6 were not
touched. Nothing was merged or deployed.

## Root Cause

### R2

`ReturnLine.quantity` is stored in the **sale unit** exactly like the source
`InvoiceLine.quantity` (e.g. "1 box"). At sale time, `InvoiceService` posts
stock via `InventoryService::recordSaleCogs()`, which correctly converts to
base units using `InvoiceLine::baseQuantity()` (`quantity × unit_factor`,
with a rational/precision path for fractional lines). But
`ReturnService::postSalesReturn()` fed `$line->quantity` (the *sale-unit*
count) directly into `InventoryService::applyReceipt()`, silently assuming a
factor of 1. `ReturnLine` has no `unit_factor` column at all, so this was
never a rounding bug — it was a missing conversion, off by the product's
full box/carton/pack size on every non-trivial UOM.

### R4

`PosReturnService::create()` and `PosExchangeService::create()` each opened a
plain `DB::transaction()` and built their documents directly — no
idempotency key was accepted by either `StorePosReturnRequest` or
`StorePosExchangeRequest`, no attempt table existed, and no `QueryException`
race-handling path existed. A client retry after a lost response (network
drop, timeout, tab reload) had no server-side signal telling it "this already
happened" — it would simply create a second, independent return or exchange,
each with its own real inventory and ledger effects.

## Implementation

### R2 — `ReturnService::postSalesReturn()`

A new private helper, `returnLineBaseQuantity(ReturnLine $line, ?InvoiceLine
$source)`, is the single place base quantity is now derived:

- **Line linked to a source (`source_line_id` set — the POS path always sets
  this)**: loads the source `InvoiceLine` (one batched query for all lines on
  the document) and uses **its own stored `unit_factor`** — a snapshot taken
  at sale time that never changes even if the product's unit template is
  edited or removed later — multiplied by the returned sale-unit quantity.
  A rational/precision source line (fractional quantity, e.g. fuel) is
  all-or-nothing by construction (`PosReturnService::buildSourceItems()`
  already enforces this via its `remaining` calculation), so for that case
  the source's own `baseQuantity()` is used directly.
- **Line with no source (`source_line_id` null — the general non-POS
  `ReturnService::create()` API, which has no unit concept at all)**: falls
  back to the pre-existing behavior (`quantity` as-is), so this contract is
  completely unchanged for that path.

No new database column, no migration for R2: the historical `unit_factor` on
`InvoiceLine` was already sufficient source-of-truth data — exactly the
"snapshot data already exists" outcome the mission allowed instead of adding
new schema.

**Exchange return leg**: `PosExchangeService` builds its return leg via
`PosReturnService::create()` → `ReturnService::create()`/`post()`, the exact
same code path as a standalone return. No separate fix was needed there.

**Exchange replacement leg**: audited and found already correct —
`PosService::checkout()` (the R1-hardened path) creates the replacement
invoice through `InvoiceService`, which uses `InvoiceLine::baseQuantity()` in
`InventoryService::recordSaleCogs()` exactly like any other sale. This is
proven, not assumed: see `exchange_replacement_leg_with_unit_factor_above_one_issues_the_correct_base_quantity`
in `PosReturnUomTest.php`.

**One related, in-scope contract gap found and fixed while proving the
replacement leg**: `StorePosExchangeRequest` never declared a validation rule
for `replacement.items.*.unit`. Laravel's `FormRequest::validated()` silently
drops any input key that has no rule, so a client attempting to buy a
non-base-unit replacement (e.g. 2 boxes) always had its unit silently
stripped, forcing the wrong (base-unit) price to be resolved and rejecting
the checkout. This is squarely inside "replacement leg + unit_factor" — the
exact area R2 was asked to verify — not a new, unrelated concern, so it was
fixed: one line added, `'replacement.items.*.unit' => ['nullable', 'string',
'max:100']`, matching the identical rule already present on
`StorePosSaleRequest`. No prior request could have been relying on a
non-base-unit replacement working (it never did), so nothing regresses.

### R4 — `pos_return_attempts` / `pos_exchange_attempts`

One migration creates both tables, each mirroring R1's `pos_checkout_attempts`
exactly:

```
pos_return_attempts:   id, tenant_id, branch_id, idempotency_key, request_checksum,
                        return_id (unique), pos_session_id, created_by, created_at
                        unique(tenant_id, branch_id, idempotency_key)

pos_exchange_attempts: id, tenant_id, branch_id, idempotency_key, request_checksum,
                        exchange_id (unique), pos_session_id, created_by, created_at
                        unique(tenant_id, branch_id, idempotency_key)
```

Two new models (`PosReturnAttempt`, `PosExchangeAttempt`) enforce
write-only-from-domain-service via the same `withWriting()` guard pattern as
`PosCheckoutAttempt`, and are classified `BranchScoped` (guarded by
`BranchIsolationGuardTest`).

**`PosReturnService::create()`** — idempotency protection is **conditional
on `$data['idempotency_key']` being present**:

- Present (the public `/pos/returns` endpoint, which now requires it):
  wraps document creation in the lock-check-insert-replay pattern identical
  to `PosService::checkout()` — lock the branch row, lock/check any existing
  attempt row for the key, replay on checksum match, raise
  `PosIdempotencyConflictException` on mismatch, catch `QueryException` for
  the concurrent-race case and resolve it the same way.
- Absent (the internal call `PosExchangeService` makes to build its return
  leg): behaves exactly as before this change — a single `DB::transaction()`
  around document creation, no attempt row. This is deliberate: the exchange
  operation is protected as one atomic unit by its own
  `PosExchangeAttempt` anchor one level up, so a second, inner idempotency
  layer would only have forced the client to invent and track a second key
  for a single logical action.

**`PosExchangeService::create()`** — same pattern, now **always** requires
`idempotency_key` (the public `/pos/exchanges` endpoint). The single
`PosExchangeAttempt` row anchors the *entire* atomic operation (return +
replacement + surplus settlement); a replay returns the original
`{exchange, return, replacement}` without re-entering
`buildAndPostExchange()` at all.

**Checksums** (`returnRequestChecksum()`, `exchangeRequestChecksum()`) follow
`PosService::checkoutRequestChecksum()`'s precedent exactly: canonical,
order-independent hash over the financially-meaningful fields only —
`actor`/`approval_id` (return) are excluded, same rationale as `actor` being
excluded from POS checkout's own checksum (an authorization/identity detail,
not part of "what the operation does").

**Controllers** (`PosController::storeReturn()`, `storeExchange()`): catch
`PosIdempotencyConflictException` → HTTP 409; on replay, HTTP 200 with an
`idempotent_replay: true` marker in the payload — identical to
`PosController::checkout()`'s existing precedent.

**API contract change**: `idempotency_key` (`required|uuid`) added to
`StorePosReturnRequest` and `StorePosExchangeRequest`. Since the *quote*
endpoints (`/pos/returns/quote`, `/pos/exchanges/quote`) never write a
document, requiring it there would have been meaningless and would have
broken existing quote callers for no reason — `quoteReturn()` was moved onto
a new, narrower `QuotePosReturnRequest` (mirroring the pre-existing
`QuotePosExchangeRequest` vs. `StorePosExchangeRequest` split, which already
established this exact precedent for exchange). `quoteExchange()` was
already on `QuotePosExchangeRequest` and needed no change.

**Frontend**: `pos-return-dialog.tsx` and `pos-exchange-dialog.tsx` each now
hold a `PosCheckoutAttemptController` (the existing utility from
`web/src/lib/pos-checkout-attempt.ts`, built for POS checkout in an earlier
PR and reused as-is here — no new frontend abstraction). A stable UUID is
generated once per selected invoice (`ensure()`), sent as `idempotency_key`,
reused across retries of the same submit, and only rotated
(`reset()`/`resetAfterSuccess()`) when the dialog reopens, a different
invoice is chosen, or the submission succeeds. This gives return/exchange the
same retry/double-submit protection POS checkout already had.

## Files Changed

| File | Purpose | R2/R4 |
|---|---|---|
| `app/Services/Accounting/ReturnService.php` | Restock quantity now derived from the source line's historical `unit_factor` instead of assumed 1:1 | R2 |
| `app/Services/Accounting/PosReturnService.php` | Optional durable idempotency wrapper around `create()`; unchanged behavior when no key is supplied (internal exchange call) | R4 |
| `app/Services/Accounting/PosExchangeService.php` | Mandatory durable idempotency wrapper around `create()`, anchoring the full return+replacement+settlement operation | R4 |
| `app/Models/PosReturnAttempt.php` | New — idempotency anchor for standalone POS returns | R4 |
| `app/Models/PosExchangeAttempt.php` | New — idempotency anchor for POS exchanges | R4 |
| `database/migrations/2026_09_05_010000_create_pos_return_and_exchange_attempts.php` | New — creates both attempt tables | R4 |
| `app/Http/Requests/StorePosReturnRequest.php` | `idempotency_key` now required | R4 |
| `app/Http/Requests/StorePosExchangeRequest.php` | `idempotency_key` now required; `replacement.items.*.unit` validation rule added (was silently dropped — found while testing R2's replacement leg) | R4 (+ R2-adjacent) |
| `app/Http/Requests/QuotePosReturnRequest.php` | New — narrower contract for `/pos/returns/quote`, which never needed `idempotency_key` | R4 (contract hygiene) |
| `app/Http/Controllers/Api/PosController.php` | `quoteReturn()` moved to the new request; `storeReturn()`/`storeExchange()` handle 409 conflict and 200 replay | R4 |
| `web/src/components/pos/pos-return-dialog.tsx` | Stable per-intent `idempotency_key` via `PosCheckoutAttemptController` | R4 |
| `web/src/components/pos/pos-exchange-dialog.tsx` | Same | R4 |
| `tests/Feature/PosReturnTest.php` | Existing helpers updated to send `idempotency_key` (backward-compat callers) | R4 |
| `tests/Feature/PosReturnUomTest.php` | New — 6 tests covering R2 | R2 |
| `tests/Feature/PosReturnExchangeIdempotencyTest.php` | New — 13 tests covering R4 | R4 |

## Database / API / Backward Compatibility

- **Migration**: additive only — two new tables, no columns changed or
  dropped on any existing table, `down()` drops them cleanly. Verified on
  both SQLite and PostgreSQL (`migrate:fresh` / `migrate` succeed on both).
- **API**: `idempotency_key` becomes a required field on `POST /pos/returns`
  and `POST /pos/exchanges`. This is a breaking change for any *existing*
  caller of those two specific endpoints that doesn't send it — the only two
  known callers (`pos-return-dialog.tsx`, `pos-exchange-dialog.tsx`) are
  updated in this same PR. `GET`/quote endpoints, `/pos/checkout`, and every
  other POS endpoint are unaffected.
- `replacement.items.*.unit` becomes accepted (previously silently dropped)
  on `POST /pos/exchanges` — purely additive; no existing request shape
  changes meaning.
- No change to `InvoiceService`, `PurchaseService`, or any non-POS return
  path.

## Accounting & Inventory Verification

No new financial operation or journal shape was introduced — the existing
POS return/exchange entries are structurally unchanged; R2 only corrects the
*quantity* fed into the existing restock call, and R4 only prevents that same
existing effect from happening twice.

**Return (sales) — unchanged shape, now correct quantity:**

| Account | Debit | Credit |
|---|---|---|
| 4110 إيرادات المبيعات | ✓ | |
| 2120 ضريبة مخرجات (if any) | ✓ | |
| 1130 العملاء / 1110 الصندوق | | ✓ |

Plus, when restocked and tracked: `1140 المخزون` debited / `5110 تكلفة
البضاعة المباعة` credited, for `base_quantity × avg_cost` — **`base_quantity`
is now `unit_factor`-correct** (this is the entirety of R2's change; no
account or entry shape changed).

**Exchange — unchanged shape:** return leg as above (credit), replacement
leg is a standard POS credit sale (per R1's documented entries), surplus cash
settlement (when applicable): `1130 العملاء` debited / `1110 الصندوق`
credited.

Verified in `PosReturnUomTest.php` by asserting `Product.quantity_on_hand`
and the exact `StockMovement.quantity` after partial, full, and multi-step
partial returns, and in `PosReturnExchangeIdempotencyTest.php` by asserting
`JournalEntry`/`StockMovement`/`Product.quantity_on_hand` are **identical**
before and after a replayed request.

## Tenant Isolation & Permissions

- No new cross-tenant read/write path: `InvoiceLine::whereIn('id', ...)` in
  `ReturnService` relies on `BaseModel`'s automatic `TenantScope`, same as
  every other model query in this codebase.
- Both new models (`PosReturnAttempt`, `PosExchangeAttempt`) are
  `BranchScoped` and their `booted()` guard cross-checks the linked
  document's own `tenant_id`/`branch_id` before allowing creation — the same
  defense-in-depth pattern as `PosCheckoutAttempt`.
- `BranchIsolationGuardTest` (which fails the whole suite if any business
  model is unclassified) passes with both new models included.
- Explicit test: `the_same_return_key_is_isolated_across_tenants` and
  `the_same_exchange_key_is_isolated_across_tenants` — the identical
  idempotency key used by two different tenants produces two independent
  documents, with `PosReturnAttempt::withoutGlobalScopes()->count() === 2`
  proving there is no accidental cross-tenant collision on the unique index
  (each row still carries its own correct `tenant_id`).
- No existing permission/RBAC check on the return/exchange routes was
  touched.

## Idempotency

Directly verified in `PosReturnExchangeIdempotencyTest.php`:

- Same key + same payload → HTTP 200, `idempotent_replay: true`, same
  document id, exactly 1 document/attempt row/journal entry in the database.
- Same key + a logically different payload (different `source_line_id`,
  different replacement price) → HTTP 409, still exactly 1 document.
- Different key → a second, independent document, as expected.
- Replay does not touch inventory or accounting a second time: stock
  quantity, `StockMovement` count, and `JournalEntry` count for the
  original document are asserted identical before and after the replay call.
- **Concurrency**: true parallel requests cannot be exercised reliably inside
  a single-connection PHPUnit process (SQLite or PostgreSQL). Per the
  mission's own fallback instruction, the actual protection mechanism was
  proven directly instead: `the_database_rejects_a_second_return_attempt_row_for_the_same_tenant_branch_and_key`
  inserts a second `PosReturnAttempt` row for an already-used
  `(tenant_id, branch_id, idempotency_key)` directly against the database and
  asserts a `QueryException` (the exact exception the `catch (QueryException
  $exception)` branch in `PosReturnService::create()`/`PosExchangeService::create()`
  is written to handle) — confirming the unique index those catch blocks
  depend on is actually present and enforced by the database engine itself,
  not merely assumed by the PHP-level lock.
- No attempt row is ever left orphaned without recovery: the attempt row is
  only inserted **after** the document is fully built and posted, inside the
  same transaction — if anything earlier throws, the whole transaction (and
  any partial attempt-row insert) rolls back, and the same key can be retried
  cleanly.

## Tests

### Targeted — SQLite

```
php artisan test --filter=PosReturnUomTest
php artisan test --filter=PosReturnExchangeIdempotencyTest
```
Result: **6 passed / 78 assertions** (`PosReturnUomTest`), **13 passed / 158
assertions** (`PosReturnExchangeIdempotencyTest`).

### Targeted — PostgreSQL

```
php artisan test --filter='PosReturnUomTest|PosReturnExchangeIdempotencyTest'
```
Result: **19 passed / 239 assertions**.

### Directly related regression — SQLite

```
php artisan test --filter='PosReturn|PosCheckout|PosExchange'
```
Result: **56 passed / 725 assertions** (includes the pre-existing
`PosReturnTest`, `PosCheckoutTest`, `PosCheckoutIdempotencyTest` — all still
green, protecting R1).

### Broader financial regression — SQLite

```
php artisan test --filter='LedgerTest|InvoiceTest|PaymentTest|BranchIsolationGuardTest|ReturnWithProductTest|ReturnWindowPolicyTest'
```
Result: **117 passed / 582 assertions.**

### Broader financial regression — PostgreSQL

```
php artisan test --filter='PosReturn|PosCheckout|PosExchange|LedgerTest|InvoiceTest|PaymentTest|BranchIsolationGuardTest|ReturnWithProductTest|ReturnWindowPolicyTest'
```
Result: **173 passed / 1307 assertions.**

### Full suite — SQLite

```
php artisan test
```
Result: **2292 passed, 1 skipped, 25 failed** (16336 assertions). All 25
failures are pre-existing, environment-only, and unrelated to R2/R4:

- **24** are `FuelReconciliationTest`/`FuelSupplyReceivingTest`/
  `FuelSaleServiceTest`/`FuelAviRfidServiceTest`/`FuelSaleApiTest`/
  `FuelSupplyReceivingApiTest` failures, all `Call to undefined function
  App\Services\bcmul()` — this local test environment's PHP is missing the
  `bcmath` extension (confirmed via `php -m`), which `FuelCostBasisService`
  depends on. This module is not part of POS/returns/exchanges. CI installs
  `bcmath` explicitly and is unaffected (same finding already documented in
  the prior R1 PR/report).
- **1** is `DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted_and_the_page_limit_fails_closed`,
  failing with "ملف PDF تالف أو غير مدعوم" — this environment is missing
  `poppler-utils` (`pdfinfo`/`pdftoppm` not found via `which`), which the
  document-center PDF page-counting path needs. Also unrelated to POS; CI
  installs `poppler-utils` explicitly (see `.github/workflows/ci.yml`).

Neither gap was worked around by changing production code — both are
documented here as instructed rather than expanded into this PR's scope.

### Broader/full — PostgreSQL

Not run as a full suite (would hit the same two unrelated environment gaps);
the broader financial/POS regression above (173 tests) was run instead,
covering every module this PR touches or could plausibly affect on
PostgreSQL specifically.

## Build/CI

- Not observed directly (no CI run triggered from this local session before
  the PR is opened). Local `npm run build` for `web/` completed successfully
  (`✓ Compiled successfully`, all 150 static pages generated, exit code 0) —
  this validates the two changed `.tsx` files compile and type-check
  correctly, but is not a substitute for the actual GitHub Actions run.

## Compatibility

- **API**: `idempotency_key` is now required on `POST /pos/returns` and
  `POST /pos/exchanges` (breaking for any caller besides the two updated
  frontend dialogs — documented above). No other endpoint's contract
  changed except the additive `replacement.items.*.unit` field.
- **Database**: additive migration only, backward compatible, tested on both
  engines.
- **ZATCA**: untouched — return/exchange journal entries and their downstream
  effects are unchanged in shape.
- **Existing POS return/exchange documents**: unaffected. R2 only changes
  behavior for *new* returns processed after this deploy; no historical
  document is re-interpreted or re-posted.

## Risks / Remaining

- The `replacement.items.*.unit` fix (see Implementation) is a small,
  additive contract fix discovered while testing R2's replacement leg. It is
  low-risk (purely additive validation rule) but is technically outside the
  strict letter of "R2 = return quantity, R4 = idempotency" — flagged here
  explicitly for reviewer visibility rather than silently bundled.
- `PurchaseLine` likely has the same `unit_factor` snapshot as `InvoiceLine`,
  and `ReturnService::postPurchaseReturn()` was **not** audited or changed —
  purchase returns are not a POS concept and were explicitly out of this
  mission's scope. If purchase returns exhibit the same UOM gap, that is a
  separate, undocumented-until-now risk worth a follow-up task.
- True concurrent-request idempotency (two requests landing genuinely in
  parallel) is protected by the database's unique index (verified directly,
  see Idempotency section) but was not exercised via actual parallel HTTP
  requests in this test run, per the documented PHPUnit/single-connection
  limitation.
- Local dev/test environment gaps (`bcmath` extension missing,
  `poppler-utils` missing) are documented, not fixed, and do not affect CI.

## Git

- Branch: `r2-r4-pos-return-uom-idempotency`
- Base SHA: `60630feed07283cebe127e2d9e1b3a2303dfea58` (origin/main at session
  start — confirms R1 (#645) is on main, one commit ahead of the historical
  audit reference SHA `aa23bff70959b2c82c1443f38ac41153a1fa7e13`, unrelated
  document-scanning work)
- Head SHA: recorded at PR creation time
- Draft PR: link recorded after creation

## Next Step

R2 and R4 are complete and verified on both SQLite and PostgreSQL. **Stop
here** — do not begin R3, R5, or R6. Recommend human review of the Draft PR,
in particular the `replacement.items.*.unit` contract fix and the required
`idempotency_key` breaking change on the two POS return/exchange endpoints,
before merge.
