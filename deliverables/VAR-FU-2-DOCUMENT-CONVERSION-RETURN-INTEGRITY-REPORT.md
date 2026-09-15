# VAR-FU-2 Document Conversion & Return Integrity Report

## Scope

Closes the two gaps discovered during VAR-FU-1 (`deliverables/VAR-FU-1-DOCUMENT-HTTP-VARIANTS-REPORT.md`):

- **GAP-07** — three document-to-document conversion helpers
  (`QuoteService::convert()`, `ProcurementService::itemsOf()`,
  `DeliveryNoteSalesInvoiceDraftBuilder::buildInvoiceItems()`) rebuilt a
  target item array from source lines without copying `product_variant_id`
  forward, so converting a variant-managed Quote/Procurement-document/
  Delivery-Note failed closed (422) rather than corrupting data, but was
  simply unusable for variant-managed lines.
- **GAP-08** — `ReturnService::assertWithinSource()` validated quantity and
  price ceilings against a return line's declared `source_line_id`, but
  never bound the return line's own `product_id`/`product_variant_id` to
  that source line's actual identity — a pre-existing gap (already present
  for `product_id` alone, before Product Variants existed), newly reachable
  over HTTP once VAR-FU-1 accepted `product_variant_id` on the Return
  endpoint.

No new validation authority was invented for either gap.
`DocumentLineVariantResolver` (VAR-DOC-1) remains the sole authority for
variant validity/tenant-match/lifecycle on every target document created by
a conversion. No accounting, ledger, tax, discount, COGS, settlement,
payment, or return-quantity-ceiling rule was changed. No POS, Commerce,
Reporting, or Settings change. GAP-02 through GAP-06 untouched.

## GAP-07 Evidence

Traced each conversion path directly in code (not re-explored broadly):

- **`QuoteService::convert()`** (`app/Services/Accounting/QuoteService.php`):
  builds `$items = $quote->lines->map(fn (QuoteLine $l) => ['product_id' => $l->product_id, 'description' => ..., ...])->all();`
  then calls `$this->invoices->create([...], $items)`. `product_variant_id`
  was absent from the mapped array — confirmed by reading the exact
  `->map()` closure before editing.
- **`ProcurementService::itemsOf()`** (`app/Services/Accounting/ProcurementService.php`):
  `return $doc->lines->map(fn (ProcurementLine $l) => ['product_id' => $l->product_id, 'description' => ..., ...])->all();`
  — used by **three** callers: `createPrintRevision()` (procurement →
  procurement, print-revision copy), `convert()` (chain:
  request→rfq→quotation→order), and `convertToPurchase()` (order → Purchase).
  All three share this one method, so one fix closes all three call sites.
  `product_variant_id` was absent.
- **`DeliveryNoteSalesInvoiceDraftBuilder::buildInvoiceItems()`**
  (`app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php`):
  groups `DeliveryNoteLine`s by a composite key
  `implode('|', [$line->product_id, $line->unit_name, $line->unit_factor, $decision['unit_price'], $decision['tax_rate'], $decision['minimum_price_override_reason'] ?? ''])`
  — **`product_variant_id` was absent from both the grouping key and the
  emitted `$invoiceItem` array.** This is a strictly worse variant of the
  same class of bug: not only would the field be dropped, but two sibling
  variants of the same product sharing the same unit/price/tax/discount-reason
  would have been silently **merged into one invoice line**, losing the
  distinction between them entirely (a `variant-managed product line
  containing product_id only` — exactly the ambiguity the mission's Core
  Identity rules forbid) — a strictly worse failure mode than the other two
  paths' clean 422 rejection.
- **`RecurringInvoiceService::generate()`** (reference, unmodified): already
  correctly builds `['product_id' => $l->product_id, 'product_variant_id' => $l->product_variant_id, ...]`
  when turning a recurring-invoice template line into a real `InvoiceLine` —
  confirmed as the exact pattern to mirror, and mirrored verbatim (same key
  name, same direct property read, no transformation).
- **Downstream authority already correct, confirmed unmodified**:
  `InvoiceService::create()`, `PurchaseService::create()`, and
  `ProcurementService::writeLines()` (used by `ProcurementService::create()`,
  and therefore transitively by `convert()`/`convertToPurchase()`/
  `createPrintRevision()` via `$this->create(..., $this->itemsOf($doc))`)
  each already call `DocumentLineVariantResolver::resolve($product, $item['product_variant_id'] ?? null, $tenantId)`
  on every item — this was VAR-DOC-1's original wiring, untouched here. Once
  the three mapping functions stop dropping the field, the existing resolver
  call picks it up with **zero further change**.

**No document type's conversion path was found un-ready.** Every one of the
three already routes its created lines through an existing, already-correct
`DocumentLineVariantResolver` call — the only defect was the field never
reaching that call. No STOP condition was triggered for any of the three.

## GAP-07 Fix

Three minimal, mechanical edits, each adding exactly one field, mirroring
`RecurringInvoiceService::generate()`'s already-correct pattern verbatim —
**server-derived from the source line's own already-resolved, already-valid
identity, never inferred from the live catalog and never accepted from a
client input** (none of the three conversion endpoints' request payloads
carry a product/variant field at all — `POST /api/quotes/{id}/convert` takes
only `payment_type`; `POST /api/procurement/{id}/convert` takes only
`target`/`partner_id`/`payment_type`; `POST /api/delivery-notes/invoice-draft`'s
`line_pricing` carries only `delivery_note_line_id`/`unit_price`/`tax_rate`/
`discount`/`minimum_price_override_reason` — no product/variant field exists
in any of the three request contracts to spoof):

1. **`QuoteService::convert()`** — added
   `'product_variant_id' => $l->product_variant_id,` to the mapped `$items`
   array.
2. **`ProcurementService::itemsOf()`** — added
   `'product_variant_id' => $l->product_variant_id,` to the mapped return
   array (fixes `convert()`, `convertToPurchase()`, and
   `createPrintRevision()` simultaneously, since all three call this one
   method).
3. **`DeliveryNoteSalesInvoiceDraftBuilder::buildInvoiceItems()`** — two
   changes:
   - Added `$line->product_variant_id ?? ''` to the grouping key, so two
     sibling variants can no longer collapse into one group regardless of
     matching unit/price/tax/discount-reason.
   - Stored `'product_variant_id' => $line->product_variant_id` on the group
     (safe — every line sharing a group now shares the same value by
     construction, since it is part of the key) and added
     `'product_variant_id' => $group['product_variant_id'],` to the emitted
     `$invoiceItem`.
   - **A latent bug this fix would otherwise have introduced was found and
     avoided, not created**: `createLinksAndEvents()` looks up each created
     `InvoiceLine` by `->where('description', $sourceDescription)->sole()`,
     and `sourceDescription()` derives its uniqueness suffix from
     `substr(hash('sha256', $groupKey), 0, 12)` — since `$groupKey` now
     includes `product_variant_id`, two sibling-variant groups automatically
     get distinct description suffixes (because their keys differ), so the
     `->sole()` lookup continues to resolve unambiguously with **zero
     additional change** to `createLinksAndEvents()` itself. This was
     verified by reading the function before editing, not discovered by a
     failing test.

Target documents continue to be created exclusively through
`InvoiceService::create()`/`PurchaseService::create()`, which continue to run
`DocumentLineVariantResolver::resolve()` on every line exactly as before —
no validation logic was duplicated or bypassed.

**Conversion historical truth, explicitly distinguished:**
- **Identity propagated from source**: `product_id` + `product_variant_id`
  are copied literally — the exact concrete Variant the source line
  referred to, never re-derived from "what the product currently looks
  like."
- **Snapshot generated fresh at the target**: `variant_descriptor_snapshot`
  on the new target line is **not** copied from the source line's own
  snapshot — it is generated anew by `DocumentLineVariantResolver::descriptor()`
  at target-creation time, exactly like every other new document line
  (confirmed: none of the three fixed call sites pass a `variant_descriptor_snapshot`
  key at all; the target service always derives its own). This matches the
  pre-existing conversion contract already in effect for `product_name_snapshot`
  (the target's own name snapshot is taken from the *live* product at
  conversion time, not copied from the source's snapshot — confirmed
  unchanged, not touched by this task) — conversion has never been a
  "copy the old document's historical truth forward" operation; it creates
  a **new** document whose own snapshot reflects the catalog at conversion
  time, while its *identity* (which concrete Variant) is preserved exactly.
  This distinction was not invented for this task — it is the existing,
  unmodified behavior for every other snapshotted field.
- **Inactive/deactivated Variant**: if the source line's Variant has since
  been deactivated, `DocumentLineVariantResolver::resolve()` rejects it
  (`! $variant->is_active` → `RuntimeException` → `422`) — the **existing,
  documented, unmodified** contract for creating *any* new document line
  against an inactive Variant. Conversion does not get a special exception
  or a bypass; it fails closed exactly like a fresh invoice would. No new
  policy was invented for this — the pre-existing rule was simply left to
  apply, since nothing in this task suppresses or special-cases it.

## Conversion Matrix

| Source | Target | Simple | Variant | Authority | Tests |
|---|---|---|---|---|---|
| Quote | Invoice (draft) | Unchanged | Propagated, fresh snapshot | `DocumentLineVariantResolver` via `InvoiceService::create()` | 3 |
| Procurement (request/rfq/quotation) | Procurement (next stage) | Unchanged | Propagated, fresh snapshot | `DocumentLineVariantResolver` via `ProcurementService::writeLines()` | 1 (chain test covers this leg) |
| Procurement (order) | Purchase (draft) | Unchanged | Propagated, fresh snapshot | `DocumentLineVariantResolver` via `PurchaseService::create()` | 2 (1 simple, 1 as the second leg of the chain test) |
| Delivery Note (confirmed) | Invoice (draft) | Unchanged | Propagated, fresh snapshot, no sibling merge | `DocumentLineVariantResolver` via `InvoiceService::create()` | 3 |

## GAP-08 Evidence

`ReturnService::assertWithinSource()` (`app/Services/Accounting/ReturnService.php`)
is called from two places:
- **`create()`** — before any `ReturnLine` is written, using the raw
  client-supplied `$items` array.
- **`post()`** — re-run inside the posting transaction (with a row lock on
  the return), using the *already-persisted* `ReturnLine` rows re-mapped to
  an array; the method's own docblock explains why: two drafts created
  concurrently against the same source line don't reserve quantity at
  create-time, so the guard must run again, inside a lock, at posting.

Before this task, the method's loop over each item did:
```php
$sourceLine = $sourceLines->get($lineId);
if (! $sourceLine) { throw ...; }           // only checks the line EXISTS on the source
$price = (int) ($item['unit_price'] ?? 0);
if ($price > (int) $sourceLine->unit_price) { throw ...; }   // price ceiling only
$requested[$lineId] = ...;                                    // quantity accumulation only
```
**No comparison of `product_id`/`product_variant_id` against
`$sourceLine->product_id`/`$sourceLine->product_variant_id` existed at all.**
This means a return line could declare a real, valid `source_line_id`
belonging to a genuinely posted source document, while carrying a
*different* product or variant than what that exact line actually sold — as
long as that different product/variant independently passed
`DocumentLineVariantResolver`'s own checks (same tenant, real product/variant,
active). **This defect predates Product Variants entirely** — the same
absence of a `product_id` check already existed before `product_variant_id`
was ever added to `ReturnLine` (VAR-DOC-1). It became reachable over HTTP
specifically once VAR-FU-1 started accepting `product_variant_id` on
`POST /api/returns` — before that, only `product_id` could have been
mismatched this way (and, per the code, apparently always could).

The `post()`-time re-check had an additional, narrower problem of its own:
its re-mapped array only carried `source_line_id`, `quantity`, and
`unit_price` — **not** `product_id`/`product_variant_id` — so even after
fixing `assertWithinSource()` itself, the posting-time re-guard would have
silently skipped the new identity check entirely (every item's derived
`product_id`/`product_variant_id` would resolve to `null`, which could
accidentally *pass* against a source line whose own identity happens to be
`null` too, or simply never run the comparison meaningfully for a
variant-managed source). This was found and fixed in the same change.

**Severity assessment, as the mission asks:** this is not a hypothetical.
Before this fix, a client could submit a return citing a real
`source_line_id` that sold Variant A of a Product, while declaring Variant
B (a sibling, or even an unrelated product) as the line's own identity — as
long as B independently resolved. At posting, `postSalesReturn()`/
`postPurchaseReturn()` restock **the identity the `ReturnLine` itself
carries** (`loadMissing('lines.product', 'lines.variant')`, confirmed by
reading the posting methods), not the source line's identity — so this
would have **restocked the wrong Variant's `InventoryState`** (or the wrong
Product's) while the accounting reversal amount stayed correctly bounded by
the *source line's* price ceiling. This is a real inventory-correctness
risk (wrong stock quantity/avg_cost ends up in the wrong bucket), not an
accounting-total risk (the reversed revenue/tax total was always computed
correctly from the return line's own bounded price/quantity, independent of
which product/variant the line claimed). **Severity: real, but bounded to
inventory-location correctness, not financial-total correctness** — no
journal entry amount was ever wrong, only which `InventoryState` row
received the restocked quantity.

## GAP-08 Invariant

Added immediately after the existing "does this `source_line_id` belong to
this source document" check, before the existing price-ceiling check
(smallest insertion point, no reordering of existing logic):

```php
$itemProductId = $item['product_id'] ?? null;
if ($itemProductId !== $sourceLine->product_id) {
    throw new RuntimeException('منتج بند المرتجع لا يطابق منتج سطر المستند المصدر.');
}
$itemVariantId = $item['product_variant_id'] ?? null;
if ($itemVariantId !== $sourceLine->product_variant_id) {
    throw new RuntimeException('متغيّر بند المرتجع لا يطابق متغيّر سطر المستند المصدر.');
}
```

**Nullable identity, exact semantics as specified:**
- Simple source line (`source_line.product_variant_id === null`) → the
  return item's `product_variant_id` **must also be `null`** (or absent —
  `?? null` normalizes both to the same value). A sibling-free, non-null
  substitution is impossible by construction (there is no sibling to
  substitute when the source was simple).
- Variant-managed source line (`source_line.product_variant_id === <UUID>`)
  → the return item's `product_variant_id` **must equal that exact same
  UUID** — a sibling Variant of the same Product is rejected, not just a
  Variant of a different Product. This is strictly stronger than "the
  Variant is valid and belongs to the same Product," which is all
  `DocumentLineVariantResolver` alone would have guaranteed.
- Strict `!==` comparison throughout (not `==`), so `null` never
  coincidentally compares equal to an empty string or `"0"`.

The `post()`-time re-guard now maps `'product_id' => $l->product_id, 'product_variant_id' => $l->product_variant_id,`
from the **already-persisted, already-validated** `ReturnLine` — this is
strictly a defense-in-depth re-confirmation against the concurrent-draft
race the method already exists to close, not a second trust boundary (the
identity was already proven correct once, at `create()` time; this just
makes sure the *lock-protected* re-run enforces the same invariant, rather
than silently comparing `null` to `null` regardless of the real values).

## UOM / Source Contract

Checked before touching anything: `ReturnLine`'s own `$fillable` (`app/Models/ReturnLine.php`)
has **no `unit_name`/`unit_factor` columns at all** — confirmed by reading
the model directly. Returns do not track UOM identity today, independent of
Variants (this predates both VAR-DOC-1 and this task). This is a genuine,
pre-existing, **independent** gap — not touched, per the mission's own
instruction to document rather than widen scope for an independent UOM gap.
It is independent because it cannot be used to bypass the identity invariant
this task closes: the new check binds `product_id`+`product_variant_id`
exactly, regardless of unit — there is no unit-based path around it. No
conversion-factor semantics were changed anywhere in this task.

## Return Security

All ten of the mission's listed negative controls are covered by real HTTP
tests against `/api/returns` (not service-layer shortcuts):

1. `return_same_simple_product_source_line_succeeds` — same simple
   Product/source line → `201`, then posted successfully (`assertOk()`).
2. `return_different_product_against_source_line_fails` — different Product
   against the same `source_line_id` → `422`, zero rows created.
3. `return_variant_source_same_variant_succeeds` — Variant source + same
   Variant → `201`, posted successfully.
4. `return_variant_source_sibling_variant_fails` — Variant source + sibling
   Variant of the *same* Product → `422`, zero rows created, **and the
   sibling's own `InventoryState` is confirmed completely untouched**
   (quantity still `20`, the exact seeded value) — proving the rejection
   happens before any inventory effect, not as a partially-applied one.
5. `return_variant_source_null_variant_fails` — Variant source + omitted
   `product_variant_id` → `422`, zero rows created.
6. `return_simple_source_injected_variant_fails` — Simple-product source +
   an injected (real, valid, but unrelated) Variant id → `422`, zero rows
   created.
7. `return_variant_from_another_product_fails` — a real, active, same-tenant
   Variant that simply belongs to a *different* Product than the one on the
   return item → `422`, zero rows created.
8. `return_variant_from_another_tenant_fails` — a real Variant from a
   genuinely different tenant → `422`, zero rows created.
9. `crafted_source_line_id_cannot_cross_tenant_boundary` — `original_id`
   points at the caller's own real, posted Invoice, but the item's
   `source_line_id` is a real `InvoiceLine` UUID belonging to an entirely
   different tenant's own posted Invoice (with a correctly-matching
   product/variant, so this isn't caught by the new identity check at all —
   it is caught by the **pre-existing** `$sourceLines->get($lineId)` lookup,
   which is scoped to `$source->lines()` — the caller's own Invoice — so a
   foreign line id is simply never found) → `422`, zero rows created. This
   test exists to prove the boundary holds even against a well-formed,
   real, cross-tenant ID, not a guessed one.
10. **Failed validation creates no partial effect** — every one of the
    negative tests above asserts `ReturnDocument::count() === 0` (and, for
    #4, `ReturnLine::count() === 0` too) after the rejected attempt,
    confirming the `RuntimeException` is thrown *before* `ReturnDocument::create()`
    inside `create()`'s `DB::transaction()`, not after a partial write
    that then gets rolled back by luck.

## Historical Truth

Return creation itself has always written its own line-level snapshot
(`variant_descriptor_snapshot`, via `DocumentLineVariantResolver::descriptor()`)
independently at `ReturnLine::create()` time — unchanged by this task. The
new identity check runs *before* that snapshot is written, so it cannot
affect what gets snapshotted; it only decides whether the line is allowed to
exist at all. No return's already-posted historical line is reinterpreted by
this change — the check applies only at `create()` (before any row exists)
and at `post()` (before the ledger entry/inventory movement is generated),
never as a read-time reinterpretation of an already-posted return.

## Tenant Isolation

Every rejection path in this task — GAP-07's conversions (which never accept
a client-supplied identity at all, so there is no tenant-boundary input
surface to test) and GAP-08's new invariant — routes through models that
already carry `TenantScope`, plus the pre-existing `$source->lines()`
relationship query (itself tenant-scoped through `Invoice`/`Purchase`'s own
scope) for source-line resolution. No `exists:` validation rule, no
unscoped global lookup, and no client-supplied tenant id was introduced
anywhere in this task. Three dedicated cross-tenant tests (GAP-08 tests #8
and #9 above, plus `variantManagedProduct()` calls under a second,
freshly-created `Tenant` in three other tests) confirm the boundary holds
against real, well-formed, cross-tenant UUIDs — never guessed ones, since a
guessed UUID trivially fails first.

## Accounting / Inventory Safety

**Not changed**: return quantity rules (the pre-existing sold/returned
accumulation and remaining-quantity ceiling in `assertWithinSource()` is
untouched — the new checks are inserted immediately before it, not woven
into it), inventory valuation, moving-average cost calculation, journal
entries (`LedgerService::post()` calls in `postSalesReturn()`/
`postPurchaseReturn()` are byte-identical), taxes, discounts, payment/
settlement logic, and the source quantity ceiling itself. GAP-07's fixes
touch zero accounting code — they only add a field to a plain PHP array
before it reaches an already-existing, already-correct service call.

**Severity of the pre-fix gap**, restated per the mission's explicit
instruction to document rather than re-engineer posting: as detailed in
"GAP-08 Evidence" above, a mismatched return could have caused a real
`InventoryState` to be restocked for the *wrong* Variant/Product while the
financial total remained correct (bounded by the source line's own price).
This is now closed. No posting logic was redesigned to close it — only the
pre-posting identity gate was tightened.

## Transaction / Concurrency

Checked, not modified: `create()` already calls `assertWithinSource()`
*inside* its own `DB::transaction()`, after `resolveSource()` has already
resolved and validated the source document but before any `ReturnDocument`/
`ReturnLine` row is written. `post()` already re-runs the same guard inside
its own `DB::transaction()`, after `ReturnDocument::lockForUpdate()->findOrFail()`
re-locks the return row and re-confirms it is still `draft` — the existing,
documented purpose of this second run (closing the two-concurrent-drafts
race on the same source line's remaining quantity). This task's fix runs
*inside* both of these pre-existing transaction/lock boundaries, unchanged —
no new lock was added, and none was needed: the identity check reads only
already-locked/already-resolved data (`$sourceLine`, itself fetched from
`$source->lines()->get()` at the top of `assertWithinSource()`, inside the
same transaction as everything else in the method) and the caller-supplied
`$item` array, so there is no new TOCTOU window — the check is exactly as
atomic as the pre-existing price/quantity checks it sits beside.

## Backward Compatibility

- **Simple Products are completely unaffected** for both gaps: GAP-07's
  three conversion fixes add a field that is simply `null` for every simple
  Product's line (verified by `quote_conversion_simple_product_remains_unchanged`,
  `procurement_conversion_simple_product_remains_unchanged`,
  `delivery_note_invoice_draft_simple_product_remains_unchanged`); GAP-08's
  new invariant requires a simple source line's return item to have
  `product_variant_id === null`, which is exactly what every existing,
  valid simple-product return already sends (never previously sent a
  variant field at all, since it didn't exist before VAR-DOC-1/VAR-FU-1) —
  confirmed by `return_same_simple_product_source_line_succeeds` posting
  successfully end-to-end.
- **Existing valid conversions and returns continue working** — the full
  pre-existing `QuoteTest`, `ProcurementTest`, `ProcurementApiTest`,
  `DeliveryNoteTest`, `DeliveryNoteInvoiceDraftBuilderTest`, `ReturnTest`,
  `NegativeStockPolicyTest`, and `PosReturnTest` suites (which exercise
  every one of these flows for simple products and pre-existing return
  scenarios, including `PosReturnService`'s own already-correct
  source-derived identity, confirmed compatible with the new invariant by
  construction) all pass unmodified.
- **No HTTP schema changed.** No request class was touched by this task —
  GAP-07's fixes are entirely internal to service-layer array construction;
  GAP-08's fix is entirely internal to `ReturnService`'s own validation
  logic. `StoreReturnRequest` (already carrying `items.*.product_variant_id`
  since VAR-FU-1) is unchanged.
- **No new required field.** No response contract changed — every touched
  resource/response shape is identical to before this task.

## No Settings

No new tenant `Setting` was added. Both invariants (source-line identity
binding, conversion identity propagation) are domain-correctness
requirements, not configurable business policy — matching the mission's
explicit instruction.

## Changed Files

**Modified:**
- `app/Services/Accounting/QuoteService.php` — `convert()`'s item-mapping
  gains `'product_variant_id' => $l->product_variant_id,` (GAP-07).
- `app/Services/Accounting/ProcurementService.php` — `itemsOf()`'s
  item-mapping gains the same field (GAP-07; fixes `convert()`,
  `convertToPurchase()`, and `createPrintRevision()` simultaneously).
- `app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php` —
  `buildInvoiceItems()`'s grouping key and emitted item both gain
  `product_variant_id` (GAP-07; also closes the sibling-variant-merge risk
  this task's own analysis found in the pre-fix grouping key).
- `app/Services/Accounting/ReturnService.php` — `assertWithinSource()`
  gains the product/variant identity-binding check (GAP-08); `post()`'s
  re-mapped item array for the posting-time re-guard gains
  `product_id`/`product_variant_id` so the re-check actually enforces the
  same invariant instead of silently comparing `null` to `null`.

**New:**
- `tests/Feature/DocumentConversionReturnIntegrityTest.php` (17 tests).

**Not touched:** every request class, every controller, `DocumentLineVariantResolver`,
`InvoiceService`, `PurchaseService`, `ProcurementService::writeLines()`,
`RecurringInvoiceService`, `LedgerService`, `InventoryService`'s posting
methods, any migration, POS, Commerce, Reporting, Settings.

## Tests

**New** (`tests/Feature/DocumentConversionReturnIntegrityTest.php`) —
**17/17 passed** on SQLite and PostgreSQL, 104 assertions:

GAP-07 (8 tests): `quote_conversion_simple_product_remains_unchanged`,
`quote_conversion_preserves_variant_identity`,
`quote_conversion_does_not_substitute_a_sibling_variant`,
`procurement_conversion_simple_product_remains_unchanged`,
`procurement_chain_conversion_preserves_variant_identity_through_both_steps`
(covers both `itemsOf()` call sites — chain conversion and
convert-to-purchase — in one flow), `delivery_note_invoice_draft_preserves_variant_identity`,
`delivery_note_invoice_draft_keeps_sibling_variants_as_separate_lines`,
`delivery_note_invoice_draft_simple_product_remains_unchanged`.

GAP-08 (9 tests): `return_same_simple_product_source_line_succeeds`,
`return_different_product_against_source_line_fails`,
`return_variant_source_same_variant_succeeds`,
`return_variant_source_sibling_variant_fails`,
`return_variant_source_null_variant_fails`,
`return_simple_source_injected_variant_fails`,
`return_variant_from_another_product_fails`,
`return_variant_from_another_tenant_fails`,
`crafted_source_line_id_cannot_cross_tenant_boundary`.

**Regression** — run progressively per the mission's required order:
1. New GAP-07/GAP-08 tests — 17/17, above.
2. Existing Quote/Procurement/Delivery Note/Return tests
   (`QuoteTest`, `ProcurementTest`, `ProcurementApiTest`, `DeliveryNoteTest`,
   `DeliveryNoteInvoiceDraftBuilderTest`, `ReturnTest`,
   `NegativeStockPolicyTest`, `PosReturnTest`) — included in the combined
   run below.
3. VAR-DOC-1/VAR-FU-1 document regression (`VariantDocumentLineTest`,
   `DocumentHttpVariantsTest`) — included below.
4. Relevant Invoice/Purchase/CreditNote/RecurringInvoice regression
   (`InvoiceTest`, `PurchaseTest`, `CreditNoteTest`, `RecurringInvoiceTest`)
   — included below.

**Combined targeted run** (`DocumentConversionReturnIntegrityTest|VariantDocumentLineTest|DocumentHttpVariantsTest|QuoteTest|ProcurementTest|ProcurementApiTest|DeliveryNoteTest|DeliveryNoteInvoiceDraftBuilderTest|ReturnTest|NegativeStockPolicyTest|PosReturnTest|CreditNoteTest|RecurringInvoiceTest|InvoiceTest|PurchaseTest`):

| Environment | Result |
|---|---|
| SQLite | **237/237 passed** (1444 assertions) |
| PostgreSQL | **237/237 passed** (1444 assertions) |

**Broader HTTP sweep** (`Api.*Invoice|Api.*Purchase|Api.*Quote|Api.*CreditNote|Api.*Procurement|Api.*DeliveryNote|Api.*Return|ApiReportsTest|ApiTenantIsolationTest|ImportJobInventoryOpeningApplyTest|InventoryStateTest|ProductVariantCoreTest`)
on SQLite: **138 passed, 1 skipped, 1 failed** — the failure is
`FuelSupplyReceivingApiTest` (`Call to undefined function App\Services\bcmul()`),
the same pre-existing, environment-only `bcmath`-extension gap documented in
every prior VAR-* milestone in this program; matched the filter purely
because its class name contains "Api", has zero relationship to documents,
conversions, returns, or this task's diff.

Full unfiltered `php artisan test` was **not run** — not required, per this
task's own instruction ("لا تشغّل full suite محليًا بلا سبب حقيقي"), and no
such reason arose: every targeted/broader suite above is green except the
one pre-existing, unrelated `bcmath` gap already documented across every
prior milestone in this program.

## Build / CI

- `php -l` clean on all 5 changed/new PHP files.
- No `composer.json`/`package.json` change — no `web/` file touched, no
  frontend build required.
- GitHub Actions on the pushed branch — not checked within this session
  (push happens after this report, per instruction).

## Risks / Deferred

- **Return UOM identity remains untracked** (`ReturnLine` has no
  `unit_name`/`unit_factor` columns at all) — a genuine, pre-existing,
  independent gap, confirmed not exploitable to bypass the identity
  invariant this task adds (the check binds product+variant exactly,
  regardless of unit). Not fixed here, per instruction not to widen scope
  for an independent gap that doesn't threaten the invariant being closed.
- **Delivery-note draft pricing still resolves at the Product level, not
  variant level**, in `DeliveryNoteSalesInvoiceDraftBuilder::assertPriceDecision()`/
  `hasMissingPriceListItem()`/`suggestedPrice()` (all still call
  `$this->priceLists->resolve($priceList, $product, $unit)` without a
  variant parameter, even though `PriceListService::resolve()` has accepted
  an optional `?ProductVariant` since VAR-PRICE-1/VAR-POS-1). This is a
  distinct concern from GAP-07 (pricing precedence accuracy, not identity
  propagation) — GAP-07 only required the *identity* to survive the
  conversion, which it now does; the *price-list lookup* used to compute
  the invoice's suggested price still does not consult the variant's own
  price-list entry if one exists, falling back to whatever the Product-level
  entry resolves to. Not fixed here — this is closer to a GAP-02/05-adjacent
  pricing-precedence gap than a GAP-07 identity-propagation gap, and fixing
  it would touch pricing resolution logic this task's mandate explicitly
  excludes. Flagged as a follow-up candidate, likely belonging alongside
  GAP-02.
- **GAP-02 through GAP-06** — untouched, exactly as instructed.
- No Store/Commerce/POS/Reporting/Settings change of any kind was made.

## Git

- Branch: `claude/var-fu-2-document-conversion-return-integrity`
- PR: VAR-FU-2: Preserve variant identity across document conversions and returns
- Base SHA: `3794738`
- Head SHA: `959c8ae`

## Final Verdict

**GAP-07: CLOSED.**

All three known conversion paths (Quote → Invoice, Procurement chain +
Procurement → Purchase, Delivery Note → Invoice draft) now propagate
`product_variant_id` server-side from the source line's own already-resolved
identity, verified end-to-end through the real HTTP endpoints, with the
Delivery Note path additionally verified to no longer merge sibling variants
into one invoice line. Every target document continues to be created
exclusively through the existing `DocumentLineVariantResolver`-backed
authority — no parallel validation was introduced.

**GAP-08: CLOSED.**

`ReturnService::assertWithinSource()` now binds a return line's declared
identity (`product_id` + nullable `product_variant_id`) exactly to its
declared source line's own identity, at both `create()` and the
concurrency-protecting `post()`-time re-check, verified by 9 real HTTP
negative-control tests covering simple/variant/sibling/cross-product/
cross-tenant/null-variant/injected-variant scenarios, each confirmed to
create zero rows on rejection. The pre-fix gap's real (but financially
bounded) inventory-correctness risk is documented with its exact mechanism
and severity.

## Next Step

GAP-02 (ProductUnitPrice UI/HTTP) and GAP-03 (Multiple Barcode UX) only, and
only after Safwan's explicit approval of this report. No other follow-up —
including the delivery-note variant-pricing gap noted above — starts before
that approval.
