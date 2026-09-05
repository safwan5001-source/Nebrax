# AWJ POS V2 — R5: Server-Authoritative Receipt

## Executive Summary

The immediate POS receipt shown right after a successful checkout was built
by **re-deriving** every financial and document fact (invoice number stayed
server-sourced, but date, customer, line items, subtotal, tax, and total
were all recomputed from the client's local cart state) instead of reading
them from the checkout response, which already contains the full posted
`Invoice` (via `InvoiceResource`). Reprint (the general invoice detail page)
was already correct — it fetches `GET /invoices/{id}` fresh. R5 makes the
immediate receipt use exactly the same authoritative source reprint already
uses: the checkout response itself, minimally extended with the one field it
was missing (`partner`).

**Chosen approach**: reuse the existing canonical `InvoiceResource` already
returned by `POST /pos/checkout` (mission's option 1), extended with a small,
additive `partner` field. No second network fetch was introduced, and the
redundant ZATCA-QR fetch that already duplicated data present in the same
response was removed. Full rationale in §"Root Cause" and §"Chosen
Authoritative Source and Why" below.

## Actual Base SHA

`ef4e86132eea922510e47ed38834c07fef050da3` — confirmed as `origin/main`'s
HEAD at session start (fetched fresh; matches PR #649, R3+R6, merged).

## Head SHA

`641a8a2` (commit `fix(pos): make receipt server-authoritative (R5)`, pushed to
`origin/claude/r5-pos-server-authoritative-receipt`).

## Branch

`claude/r5-pos-server-authoritative-receipt`

## PR Number/Link

Draft PR #651 — https://github.com/safwan5001-source/Nebrax/pull/651

## Exact Pre-Fix Receipt Data Flow

1. `POST /pos/checkout` → `PosController::checkout()` → `PosService::checkout()`
   posts a real `Invoice` (R1-hardened: server-authoritative product
   eligibility and tax rate) and returns
   `(new InvoiceResource($invoice->load(['lines', 'thermalTemplateRevision'])))`
   — the full canonical invoice representation, including `number`,
   `invoice_date`, `subtotal`, `tax_amount`, `total`, `lines[]`
   (`quantity`, `unit_price`, `tax_rate`, `line_tax`, `line_total`, …), and
   `zatca.qr` (ZATCA phase-1 QR/hash are generated synchronously inside
   `InvoiceService::post()`, in the same transaction, before the response is
   built — confirmed by `ZatcaTest::posting_an_invoice_populates_qr_and_hash`).
2. The frontend (`web/src/app/(pos)/pos/page.tsx`) declared its own,
   deliberately narrow `PosCheckoutResponse` TypeScript type with only 4
   fields (`id`, `number`, `total`, `thermal_template_revision`) — so
   TypeScript only ever "saw" those 4 fields, even though the server sent
   far more.
3. After a successful checkout, the receipt-building code:
   - Took `created.number` from the server response (this part was already
     correct).
   - **Recomputed** `subtotal`/`tax_amount`/`total` from
     `cart.reduce((a, l) => { const c = lineCalc(l); ... })` — a client-side
     calculation over the local cart array.
   - **Recomputed** every line's `description`/`quantity`/`unit_price`/
     `tax_rate`/`line_tax`/`line_total` from `cart.map(...)`, again via the
     client-side `lineCalc()`/`effectiveLinePrice()` helpers.
   - Used `new Date().toISOString().slice(0, 10)` (the browser's current
     date) instead of the invoice's actual `invoice_date`.
   - Used `customer.name` from the locally-selected customer object (no
     `vat_number`/`city` at all — `null, null`), never the persisted
     invoice's own customer.
   - Derived a display `payment_type` from `tenders.reduce(...)` (client
     tender amounts), not from anything on the persisted invoice.
   - Fetched ZATCA QR via a **second** network call,
     `GET /invoices/{id}/zatca`, even though the checkout response already
     carried the same `zatca.qr` value.
4. Reprint (`web/src/app/(app)/invoices/[id]/page.tsx`) was **already
   correct**: it fetches `GET /invoices/{id}` and `GET /invoices/{id}/zatca`
   fresh and renders directly from that response — no client recomputation.
   This confirmed the bug was isolated to the *immediate* receipt path, not
   the canonical document-rendering machinery (`buildInvoiceDocumentModel()`
   itself is a pure display-mapping function with no recalculation; it was
   simply being fed a fabricated `SourceInvoice` instead of the real one).

## Root Cause

`PosCheckoutResponse`'s TypeScript type was never widened to match what
`InvoiceResource` actually returns. Because the type only declared 4 fields,
every other financial/document fact "wasn't there" as far as the component
could see, so the code that built the receipt reached for the only other
data it had in scope — the local `cart` array — and recomputed everything
from it. This is exactly the class of bug the mission describes: a stale/
locally-recomputed value standing in for a persisted server fact, with nothing
technically preventing the two from disagreeing (a discount, price override,
or tax correction applied server-side between cart submission and response
would silently not show up on the receipt).

## Chosen Authoritative Source and Why

**Chosen: extend the existing checkout response (mission's option 1: "returning
the existing canonical invoice resource from checkout"), not a second fetch.**

Rationale:

- The checkout response is already the full `InvoiceResource` for the
  invoice that was just posted — line items, totals, tax, and ZATCA QR are
  all already present in the JSON payload the frontend already receives; only
  the frontend's *type declaration* (and thus the code built against it)
  never used them.
- A second `GET /invoices/{id}` fetch immediately after checkout would add a
  network round-trip and a consistency window for no benefit — the data
  would be byte-identical to what the checkout response already contains, and
  a persisted invoice's core financial fields are immutable after posting
  (per this repo's non-negotiable rule: journal entries and their source
  documents are immutable after posting; corrections go through a reversal,
  never a mutation), so there is no staleness risk from using the checkout
  response directly.
- The **one** genuinely missing field was `partner` (name/VAT/city) —
  `InvoiceResource` only exposed `partner_id`. Rather than inventing a
  parallel receipt-specific customer lookup, the resource itself was
  minimally extended with a `partner` field using the exact same
  `whenLoaded()` pattern the resource (and `PublicInvoiceResource`) already
  uses for other optional relations — additive, opt-in (only appears when the
  relation is eager-loaded), and zero risk to any other consumer of
  `InvoiceResource` that doesn't load `partner`.
- The redundant `GET /invoices/{id}/zatca` fetch after checkout was removed
  in favor of reading `zatca.qr` directly from the already-returned checkout
  response — same authoritative source, one less network call, one less
  possible (spurious) failure point that had nothing to do with whether the
  QR was actually ready (it always was, synchronously, before the checkout
  response was even built).

This is the smallest change that makes the invoice server-authoritative:
one relation eager-loaded, one resource field added, and the frontend
pointed at data it was already receiving instead of data it was
recalculating.

## Exact Post-Fix Data Flow

1. `PosController::checkout()` now eager-loads `partner` alongside `lines`
   and `thermalTemplateRevision` before building the response — one extra
   relation load, no new query pattern.
2. `InvoiceResource` now exposes an additive `partner` field
   (`whenLoaded('partner', ...)` → `{id, name, vat_number, city}` or `null`),
   using the exact predicate pattern already established by
   `PublicInvoiceResource`'s own `partner` field.
3. The frontend's `PosCheckoutResponse` TypeScript type is widened to match
   what the server actually returns: `invoice_date`, `payment_status`,
   `subtotal`, `tax_amount`, `total`, `notes`, `partner`, `zatca.qr`, and
   full `lines[]` (with `quantity`, `unit_price`, `unit_price_before_tax`,
   `tax_rate`, `line_tax`, `line_total`).
4. A new, small, pure, unit-tested module,
   `web/src/lib/pos-receipt.ts`, provides:
   - `buildPosReceiptInvoice(created, cartUnits?)` — maps the checkout
     response directly onto the existing `SourceInvoice` shape
     `buildInvoiceDocumentModel()` already consumes. `cartUnits` (the cart's
     own per-line unit selection, e.g. "carton") is accepted **purely for the
     cosmetic description suffix** the receipt already showed (`"Product
     (carton)"`) — it changes no financial value; every quantity, price, tax,
     and total comes from `created` alone.
   - `posReceiptCustomer(created, fallbackName)` — reads the customer's
     name/VAT/city from `created.partner`; falls back to the
     already-selected customer's name only if the server response somehow
     lacks the relation (defensive backward compatibility, not the expected
     path).
5. The checkout success handler in `web/src/app/(pos)/pos/page.tsx` now
   calls these two functions directly on `result.checkout.data` — the exact
   server response — instead of the removed `cart.reduce`/`cart.map`
   recomputation block.
6. `fetchQr` no longer performs a network call; it synchronously wraps
   `created.zatca?.qr ?? null` — the same field now already present in the
   checkout response.
7. **Payment-type display**: the receipt's payment-type label used to be
   derived from `tenders.reduce(...)` (client-side tender sum). The
   server's `payment_type` column is *not* the right substitute — it is
   always `'credit'` for every POS invoice regardless of how it was paid
   (POS architecture: every sale posts as a credit invoice, settled by
   separate receipt-voucher payments; see `PosService::checkout()`). Using
   it directly would have shown "credit" on every receipt, including
   fully-paid cash sales — a real display regression, not a fix. The correct
   authoritative substitute, already on the persisted invoice, is
   `payment_status` (`unpaid`/`partial`/`paid`, derived server-side from the
   actual payment vouchers posted): `payment_status === 'unpaid' ? 'credit' :
   'cash'` reproduces the exact same visible behavior as the old
   `tenders.reduce(...) > 0` check (any payment at all → "cash"; none →
   "credit"), now computed from the server's own authoritative payment
   state instead of the client's tender list.
8. Reprint is unchanged — it was already correct — so both paths now read
   from the same class of source (the persisted invoice), verified directly
   by a new backend test comparing the checkout response to a subsequent
   `GET /invoices/{id}` fetch of the same invoice.

## Files Changed

| File | Change | Why |
|---|---|---|
| `app/Http/Controllers/Api/PosController.php` | `checkout()` eager-loads `partner` alongside the existing `lines`/`thermalTemplateRevision` | So the response carries customer data |
| `app/Http/Resources/InvoiceResource.php` | New additive `partner` field (`whenLoaded`) | Single missing field needed for a server-authoritative receipt |
| `web/src/lib/pos-receipt.ts` | New — pure functions `buildPosReceiptInvoice()`, `posReceiptCustomer()` | Testable, single place that maps the server response onto the receipt model |
| `web/src/lib/pos-receipt.test.ts` | New — 7 unit tests | Proves server values (not cart/tampered values) drive the receipt |
| `web/src/app/(pos)/pos/page.tsx` | Widened `PosCheckoutResponse` type; replaced `cart.reduce`/`cart.map` receipt-building with `buildPosReceiptInvoice`/`posReceiptCustomer`; `fetchQr` reads `created.zatca.qr` instead of a second network call | The actual R5 fix — receipt now built from the server response |
| `tests/Feature/PosCheckoutTest.php` | 3 new tests | Backend proof: checkout response matches a subsequent fetch, reflects authoritative tax, and replay carries identical receipt data |

No migration. No new/changed request field. No route added, removed, or
renamed. `InvoiceResource`'s new `partner` field is additive and opt-in
(only present when the relation is eager-loaded) — every other consumer of
`InvoiceResource` is unaffected.

## Tests and Exact Results

### New targeted backend tests — SQLite

```
php artisan test --filter=PosCheckoutTest
```
**27 passed / 330 assertions** — 24 pre-existing (R1/R6) + 3 new R5 tests, all
green together:

- `checkout_response_matches_the_persisted_invoice_returned_by_a_subsequent_fetch` —
  asserts the checkout response's `partner.name/vat_number/city` and
  `zatca.qr` are present and correct, then fetches the same invoice via
  `GET /invoices/{id}` and asserts `number`, `invoice_date`, `subtotal`,
  `tax_amount`, `total`, `zatca.qr`, and every line's
  `(quantity, unit_price, tax_rate, line_tax, line_total)` are identical
  between the two responses.
- `checkout_response_reflects_the_authoritative_tax_not_a_tampered_client_value` —
  R1 regression check: a request tampering `tax_rate` still gets the
  server-authoritative rate reflected directly in the checkout response's
  own line/total data (not just accepted silently).
- `replayed_checkout_response_still_carries_the_same_persisted_receipt_data` —
  R4 regression check: replaying an idempotent checkout returns the same
  `id`, `number`, `partner.name`, `zatca.qr`, and `total` as the original —
  proving replay doesn't regenerate or diverge from the original receipt
  facts.

### New targeted frontend tests

```
npx vitest run src/lib/pos-receipt.test.ts
```
**7 passed** — proves `buildPosReceiptInvoice`/`posReceiptCustomer` use only
the server-provided invoice (number, date, totals, line values, payment
status → display mapping, customer identity), never a passed-in "client
total" (no such parameter exists to begin with), and that the cosmetic
unit-suffix never changes a financial value.

### Directly related backend regression — SQLite

```
php artisan test --filter='PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|ZatcaTest|ZatcaSubmissionAttemptTest'
```
**80 passed / 911 assertions** combined (75 + 5, run as two batches; see raw
logs) — R1 (product/tax authority), R2 (UOM), R3 (branch access), R4 (return/
exchange idempotency), R6 (customer eligibility), checkout idempotency,
branch isolation, and ZATCA all pass unchanged.

### Broader financial regression — SQLite

```
php artisan test --filter='LedgerTest|InvoiceTest|PaymentTest|ReturnWithProductTest|ReturnWindowPolicyTest|InvoiceRelationsApiTest|InvoiceNoteApiTest|InvoiceInventoryApiTest'
```
**121 passed / 566 assertions.**

### Full suite — SQLite

```
php artisan test
```
**2320 passed, 1 skipped, 25 failed** (16676 assertions). All 25 failures are
the same pre-existing, environment-only gaps already documented in every
prior report for this repository (R1, R2+R4, R3+R6), confirmed unrelated to
R5:

- **24** `FuelReconciliationTest`/`FuelSupplyReceivingTest`/`FuelSaleServiceTest`/
  `FuelAviRfidServiceTest`/`FuelSaleApiTest`/`FuelSupplyReceivingApiTest` —
  `Call to undefined function App\Services\bcmul()`; this session's PHP has
  no `bcmath` extension. Unrelated module; CI installs `bcmath` explicitly.
- **1** `DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted_and_the_page_limit_fails_closed` —
  this environment is missing `poppler-utils`. Unrelated to POS; CI installs
  it explicitly.

Neither gap was worked around in production code.

## SQLite Result

Summarized above — see "Tests and Exact Results". All R5-relevant tests
green; only the two pre-existing, unrelated environment gaps fail.

## PostgreSQL Result

```
php artisan migrate:fresh --force
```
Succeeds cleanly — no new migration in this PR, the pre-existing R1–R6 schema
applies unchanged.

```
php artisan test --filter='PosCheckoutTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|ZatcaTest|ZatcaSubmissionAttemptTest|LedgerTest|InvoiceTest|PaymentTest|ReturnWithProductTest|ReturnWindowPolicyTest'
```
**210 passed / 1607 assertions**, including `PosCheckoutTest`'s full 27/27
(confirmed in a separate targeted run) — same coverage as SQLite, all green.

A bare full-suite run on PostgreSQL was not repeated (it would only re-confirm
the same two engine-independent, already-documented environment gaps); the
210-test run above covers every module R5 touches or could plausibly affect
on PostgreSQL specifically.

## Frontend Tests/Build

```
npx vitest run src/lib/pos-receipt.test.ts   → 7 passed
npx vitest run                                → 223 files, 1412 tests passed
npm run build                                 → ✓ Compiled successfully, exit 0
```

Frontend files changed (`pos-receipt.ts` + its test, `pos/page.tsx`), so
both the targeted test, the full frontend suite, and the production build
were run.

## Checkout Idempotency Regression

- `PosCheckoutIdempotencyTest` (7/7, unchanged) — the idempotency-key
  lock/checksum/replay logic in `PosService::executeCheckoutWithinTransaction()`
  was not touched by R5; only the *response the client reads afterward*
  changed (more fields exposed), not how or when the attempt row is written.
- New `replayed_checkout_response_still_carries_the_same_persisted_receipt_data`
  confirms a replay (same key, same payload) returns the exact same `id`,
  `number`, `partner`, `zatca.qr`, and `total` as the original request —
  proving the widened response doesn't introduce any divergence between a
  first response and a replayed one.
- The frontend's `checkoutAttemptRef`/`pendingAttempt` key-management logic
  (unrelated to receipt building) was not touched.

## Tenant/Branch Isolation Regression

- `BranchIsolationGuardTest` (4/4, unchanged) — no new model was introduced.
- `PosInvoiceBranchAccessTest` (7/7, unchanged) — R3's branch scoping on
  `GET /invoices/{id}` and `GET /invoices/{id}/zatca` is untouched; R5 only
  changed what `POST /pos/checkout` itself returns (a request the caller
  already has full, branch-legitimate access to, being the very session that
  just created the invoice).
- No new cross-tenant or cross-branch read was introduced: `partner` is
  loaded via the invoice's own existing `partner()` relation
  (`referenceBelongsTo`), which resolves within the same tenant scope every
  other invoice relation already uses.

## Accounting/Tax/ZATCA Regression

- No journal entry, tax calculation, or ZATCA generation logic was touched.
  `LedgerTest`, `InvoiceTest`-family, `PaymentTest`, `ReturnWithProductTest`,
  `ZatcaTest`, `ZatcaSubmissionAttemptTest` all pass unchanged on both
  engines.
- R1 (server-authoritative product/tax) re-verified directly:
  `checkout_response_reflects_the_authoritative_tax_not_a_tampered_client_value`
  (new) plus the pre-existing `it_rejects_a_direct_checkout_referencing_an_inactive_product`
  and `it_ignores_a_tampered_tax_rate_and_uses_the_products_authoritative_rate`
  all pass in the same run.
- R2 (UOM/base quantity) and R4 (return/exchange idempotency) re-verified
  directly: `PosReturnUomTest` (6/6) and `PosReturnExchangeIdempotencyTest`
  (13/13) pass unchanged.
- ZATCA QR is now read from the *same* `zatca_qr` column the existing ZATCA
  pipeline already populates — no new QR/hash/TLV generation path, no change
  to `ZatcaService`.

## Backward Compatibility

- **API**: `InvoiceResource`'s new `partner` field is purely additive and
  conditional (`whenLoaded`) — any existing caller of `InvoiceResource` that
  doesn't eager-load `partner` sees no change in its response shape at all.
  `PosController::checkout()`'s eager-load list gained one relation; the
  response's existing fields, status codes, and the 409/422/200/201
  semantics are all unchanged.
- **Frontend**: `PosCheckoutResponse`'s TypeScript type was widened (more
  optional/required fields declared to match what the server already sent) —
  this is a type-level change only, not a runtime contract change; the
  actual HTTP request/response between frontend and backend for
  `POST /pos/checkout` is unchanged (same body shape sent, same JSON
  received — the frontend simply now *reads* more of what was already
  there).
- No existing test needed to be weakened, skipped, or have its assertions
  loosened to pass.

## Explicit Confirmation

- **No migration.** Confirmed: `git diff` for this PR contains zero files
  under `database/migrations/`.
- **No breaking API change.** Confirmed: no required field added to any
  request; no response field removed, renamed, or changed in meaning for any
  existing caller; the one new response field (`partner`) is additive and
  conditional.
- **No accounting/tax/ZATCA rule change.** Confirmed: `InvoiceService`,
  `LedgerService`, `ZatcaService`, and `PosService`'s financial logic
  (product eligibility, tax authority, customer eligibility, idempotency)
  are byte-for-byte unchanged in this PR — the only backend change is one
  eager-loaded relation and one additive resource field.

## Risks/Remaining

- The receipt's payment-type display now derives from `payment_status`
  instead of client tender sums. This reproduces the exact prior *visible*
  behavior for every currently-passing scenario (verified by the full
  existing `PosCheckoutTest` suite passing unmodified), but there is no
  *dedicated* new test asserting the display label itself for a partial-cash
  sale specifically (only that the underlying `payment_status` value is
  correctly read) — a low-risk gap given `buildInvoiceDocumentModel()`'s
  mapping (`=== 'cash' ? 'cash' : 'credit'`) is itself unchanged and already
  covered by its own existing tests.
- `fetchQr`'s network call was removed in favor of a synchronous read of
  `created.zatca.qr`. This is correct for every currently-possible POS
  checkout (ZATCA phase-1 QR/hash generation is unconditional and
  synchronous inside `InvoiceService::post()`), but if a future change ever
  made ZATCA generation conditional or asynchronous for some tenant
  configuration, this assumption would need revisiting — flagged here for
  visibility, not because any such path exists today (confirmed by tracing
  `InvoiceService::post()` directly, §"Chosen Authoritative Source and Why").
- The exchange flow's own receipt path was **not** touched (confirmed no
  receipt-building code exists in `pos-exchange-dialog.tsx` — it only
  navigates via `replacement_invoice.number`), per the mission's scope
  ("the immediate POS receipt/receipt preview after successful **checkout**").
  If exchange later grows an equivalent immediate-receipt feature, it should
  reuse `buildPosReceiptInvoice`/`posReceiptCustomer` rather than
  reintroducing client-side recomputation.

## Confirmation Broader POS V2 UX Was Not Started

Confirmed. The diff touches exactly: one controller eager-load, one resource
field, one new small pure-function module and its test, one test file
addition, and the wiring inside the existing checkout success handler in
`pos/page.tsx` (no new component, no visual redesign, no new receipt
template, no payment workspace/returns/session/hardware/offline-first code).
The receipt's visual output is unchanged for every currently-passing
scenario — only its *data source* changed, per the mission's explicit
instruction to keep the UI visually stable.

## Recommended Next Step

R5 is complete and verified on both SQLite and PostgreSQL, plus the frontend
build and full test suite. **Stop here** per the mission's instruction.
Recommend human review of the Draft PR — in particular the payment-type
display mapping (`payment_status` → `cash`/`credit`) and the removal of the
redundant ZATCA-QR fetch — before merge.

## Git

- Branch: `claude/r5-pos-server-authoritative-receipt`
- Base SHA: `ef4e86132eea922510e47ed38834c07fef050da3`
- Head SHA: `641a8a2`
- Draft PR: https://github.com/safwan5001-source/Nebrax/pull/651
