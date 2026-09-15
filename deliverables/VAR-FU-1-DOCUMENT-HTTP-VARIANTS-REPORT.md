# VAR-FU-1 Document HTTP Variants Report

## Scope

Closes **GAP-01** from `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md`
only: the eight normal ERP document HTTP request classes (Invoice, Purchase,
Quote, Credit Note, Recurring Invoice, Procurement, Delivery Note, Return)
silently stripped a client-supplied `items.*.product_variant_id` because no
validation rule existed for it, so a variant-managed product could only be
sold/purchased through POS or Commerce checkout — never through the ERP's own
document screens.

This is HTTP completion only. No new validation authority was written: every
request class gained one structural rule (`nullable`, `uuid`) and nothing
else — the existing `DocumentLineVariantResolver` (VAR-DOC-1) inside each
service remains the sole authority for product/variant relationship, tenant
match, variant-managed requirement, simple-product prohibition, active/
lifecycle validity, and historical snapshotting. No accounting, ledger, tax,
discount, COGS, settlement, payment, or inventory-valuation rule was touched.
No POS, Commerce, or Reporting file was touched. GAP-02 through GAP-06 were
not addressed, per instruction.

## Evidence

Read `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md`'s GAP-01 section
first (it already named the exact grep evidence: none of the 8 request
classes had `product_variant_id`, and `InvoiceController::store()`/`update()`
build `$data['items']` straight from `$request->validated()`, which silently
drops any key with no validation rule).

Then traced each document type's actual request → controller → service →
resolver chain directly in code (not re-explored broadly):

- **Invoice**: `StoreInvoiceRequest` (reused for both `store()` and
  `update()`, confirmed by `routes/api.php` — no separate `UpdateInvoiceRequest`
  exists) → `InvoiceController::store()`/`update()` → `$data['items']` passed
  unmodified to `InvoiceService::create()`/`update()` → `applyItemsAndTotals()`
  reads `$item['product_variant_id'] ?? null` and calls
  `DocumentLineVariantResolver::resolve()` directly. Zero service-layer
  change needed.
- **Purchase**: identical pattern — `StorePurchaseRequest` reused for
  `store()`/`update()`, `PurchaseService` already resolves the variant per
  item.
- **Quote**: `StoreQuoteRequest` reused for `store()`/`update()` (`update()`
  passes `$data['items'] ?? null`, so an update omitting `items` leaves lines
  untouched — pre-existing behavior, unaffected). `QuoteService::create()`/
  `update()` already resolve via `DocumentLineVariantResolver`.
- **Credit Note**: `StoreCreditNoteRequest`, **create-only** (confirmed via
  `routes/api.php` — no `PUT credit-notes/{id}` route exists).
  `CreditNoteService::create()` always builds lines from the client-supplied
  `$items` array directly (never auto-copies identity from
  `original_invoice_id`/`original_purchase_id` — those only set header
  references), already resolves via `DocumentLineVariantResolver`.
- **Recurring Invoice**: `StoreRecurringInvoiceRequest`, **create-only**
  (confirmed — no update route). `RecurringInvoiceService::create()` resolves
  the variant per item; `generate()` (template → real `Invoice`) already
  copies `'product_variant_id' => $l->product_variant_id` from the stored
  template line — confirmed correct and unmodified.
- **Procurement**: `StoreProcurementDocumentRequest`, and
  `UpdateProcurementDocumentRequest extends StoreProcurementDocumentRequest`
  (so one rule addition to the parent covers both `store()` and `update()`
  automatically — confirmed by reading the child class, which only overrides
  `type`/`source_document_id`/`items`-requiredness). `ProcurementService`
  already resolves the variant per item.
- **Delivery Note**: `StoreDeliveryNoteRequest` and `UpdateDeliveryNoteRequest`
  are **two independent classes** (the update one does not extend the store
  one, unlike Procurement) — both needed the rule added separately.
  `DeliveryNoteService::create()`/`update()` share one line-write helper that
  already calls `DocumentLineVariantResolver::resolve()`.
- **Return**: `StoreReturnRequest`, **create-only** (confirmed — no update
  route, only `post()`). `ReturnService::create()` already resolves the
  variant per item via `DocumentLineVariantResolver`.

**Confirmed Variant-ready domain path exists for all 8 — no STOP triggered
for any document type.** Every one of the 8 already calls
`DocumentLineVariantResolver::resolve()` (verified by direct `grep` inside
each service file, not assumed), because VAR-DOC-1 already wired this for all
eight `BUSINESS_HISTORICAL` document-line models. This task's own evidence
pass could not find a single document type whose domain layer was not ready —
so no document type was skipped.

**Two related gaps found during evidence-gathering, not fixed (see Risks/
Deferred, GAP-07 and GAP-08 below)** — found while checking whether
"payload propagation" holds all the way through, per the mission's explicit
instruction to check for the field getting lost in "a line mapper" before
reaching the resolver. Both are **downstream of** the 8 create/update paths
this task closes, in genuinely different files/services, and are documented
rather than silently fixed, per the mission's explicit "STOP for that path,
document it, don't widen architecture silently" instruction:

- `QuoteService::convert()` and `ProcurementService::itemsOf()` (used by both
  `ProcurementService::convert()` and `convertToPurchase()`) rebuild a plain
  `$items` array from the source document's own lines via
  `->map(fn ($l) => [...])` — a "line mapper" exactly as the mission's
  Payload Propagation section warns about — and never include
  `'product_variant_id' => $l->product_variant_id`. Converting a
  variant-managed Quote/Procurement-Order therefore fails closed (422) at
  the destination Invoice/Purchase, because `RecurringInvoiceService::generate()`'s
  own correct sibling pattern (which *does* copy this field, confirmed) shows
  what the fix would look like — but implementing it touches two service files
  outside this task's literal 8-request scope, so it was left as GAP-07.
- `DeliveryNoteSalesInvoiceDraftBuilder::buildInvoiceItems()` groups delivery-note
  lines by a composite key (`product_id|unit_name|unit_factor|price|tax|reason`)
  that does **not** include `product_variant_id`, and its emitted invoice-item
  array never sets the field either — so converting a delivery note into an
  invoice draft would both drop variant identity and risk merging two sibling
  variants into one invoice line if their price/tax/unit happened to match.
  Not fixed here — same reasoning as above (GAP-07).
- `ReturnService::assertWithinSource()` validates a linked return line's
  `quantity`/`unit_price` against its declared `source_line_id`, but never
  cross-checks the line's `product_id`/`product_variant_id` against that
  source line's own identity — a client could, in principle, submit a return
  against a real, valid `source_line_id` while declaring a *different*
  (but self-consistent, resolver-valid) product/variant than what was
  actually sold on that line. This is **pre-existing** (the same gap already
  exists for `product_id` alone, independent of variants, and predates this
  task) — not introduced by adding the HTTP rule, but now reachable via the
  real HTTP endpoint for the first time since `product_variant_id` was never
  accepted there before. Documented as **GAP-08**, not fixed, since fixing it
  means changing `ReturnService`'s own accounting-adjacent validation logic —
  exactly the kind of "reveals a real bug, STOP and document" case the
  mission's Accounting section anticipates.

## Document Coverage Matrix

| Document | Request class | Create/Update | Before | After | Domain authority | Tests |
|---|---|---|---|---|---|---|
| Invoice | `StoreInvoiceRequest` (shared) | Both | Field silently dropped by `validated()` | Accepted, propagated | `DocumentLineVariantResolver` via `InvoiceService::create()`/`update()` | 5 |
| Purchase | `StorePurchaseRequest` (shared) | Both | Same | Accepted, propagated | `DocumentLineVariantResolver` via `PurchaseService::create()`/`update()` | 2 |
| Quote | `StoreQuoteRequest` (shared) | Both | Same | Accepted, propagated | `DocumentLineVariantResolver` via `QuoteService::create()`/`update()` | 1 |
| Credit Note | `StoreCreditNoteRequest` | Create only | Same | Accepted, propagated | `DocumentLineVariantResolver` via `CreditNoteService::create()` | 1 |
| Recurring Invoice | `StoreRecurringInvoiceRequest` | Create only | Same | Accepted, propagated | `DocumentLineVariantResolver` via `RecurringInvoiceService::create()`; `generate()` already copied it correctly | 1 |
| Procurement | `StoreProcurementDocumentRequest` (+ `UpdateProcurementDocumentRequest` inherits) | Both | Same | Accepted, propagated | `DocumentLineVariantResolver` via `ProcurementService::create()`/`update()` | 1 (covers both create and update) |
| Delivery Note | `StoreDeliveryNoteRequest` + `UpdateDeliveryNoteRequest` (independent classes) | Both | Same | Accepted, propagated | `DocumentLineVariantResolver` via `DeliveryNoteService::create()`/`update()` | 1 (covers both create and update) |
| Return | `StoreReturnRequest` | Create only | Same | Accepted, propagated | `DocumentLineVariantResolver` via `ReturnService::create()` | 1 |

Response-resource coverage (additive `product_variant_id`/`variant_descriptor`
fields, matching VAR-DOC-1's own established pattern):

| Document | Resource | Status |
|---|---|---|
| Invoice | `InvoiceLineResource` | Already had both fields (VAR-DOC-1) |
| Purchase | reuses `InvoiceLineResource` (via `PurchaseResource`) | Already had both fields — confirmed by reading `PurchaseResource`/`ReturnResource`, which both serialize their `lines` through `InvoiceLineResource::collection()` generically; since `PurchaseLine`/`ReturnLine` already carry the columns, no resource change was needed |
| Quote | `QuoteLineResource` | Already had both fields (VAR-DOC-1) |
| Credit Note | `CreditNoteLineResource` | Already had both fields (VAR-DOC-1) |
| Recurring Invoice | `RecurringInvoiceLineResource` | **Added in this task** (additive, matches the established pattern) |
| Procurement | `ProcurementLineResource` | Already had both fields (VAR-DOC-1) |
| Delivery Note | `DeliveryNoteResource` (inline line mapping) | **Added in this task** (additive, matches the established pattern) |
| Return | reuses `InvoiceLineResource` (via `ReturnResource`) | Already had both fields, same mechanism as Purchase |

## HTTP Contract

Every one of the 9 touched request classes (8 document types, Delivery Note
split into 2 classes) gained exactly one rule:

```php
'items.*.product_variant_id' => ['nullable', 'uuid'],
```

- **Structural only** — `nullable` + `uuid`. No `exists:product_variants,id`
  rule was used anywhere, per the mission's explicit Security instruction:
  an `exists:` rule queries the table globally (bypassing `TenantScope`
  unless carefully qualified) and would either become a second,
  divergent Tenant-Isolation authority or silently leak whether a given UUID
  exists in *another* tenant depending on how it's written — neither
  acceptable when a real, already-tested, fail-closed authority
  (`DocumentLineVariantResolver`) already exists one layer down.
- **Never globally required.** Every document's `items.*.product_variant_id`
  rule is `nullable`; a simple product's line (or any line with no variant)
  continues to omit the field or send `null` with zero behavior change.
- **No repo-wide tenant-aware validation primitive was reused or invented**
  for this rule specifically, because none existed for this exact shape
  (a nullable, structurally-checked-only UUID) — every other tenant-scoped
  ID field in these same request classes (`product_id`, `partner_id`,
  `cost_center_id`, …) uses the identical bare `['nullable', 'uuid']` pattern
  already, confirmed by reading each file before editing — so this rule
  matches its neighbors exactly, not a new convention.

## Payload Propagation

Traced explicitly for every one of the 8 document types, per the mission's
own warning list (`validated()`, `safe()`, `only()`, `map()`, `array_map()`,
DTO, normalizer, line mapper, service argument, `createMany()`, update path):

- **`validated()`**: every controller (`InvoiceController`, `PurchaseController`,
  `QuoteController`, `CreditNoteController`, `RecurringInvoiceController`,
  `ProcurementController`, `DeliveryNoteController`, `ReturnController`) calls
  `$data = $request->validated();` then passes `$data['items']` (or
  `$data['items'] ?? null` for Quote's/Procurement's `update()`) straight
  into the service's `create()`/`update()` method — **no intermediate
  `only()`, `map()`, `array_map()`, or DTO transformation strips or
  reshapes the items array anywhere in any of the 8 controllers.** Confirmed
  by reading every `store()`/`update()` method body directly (not assumed).
- **Service layer**: every one of the 8 services reads
  `$item['product_variant_id'] ?? null` directly off the raw associative
  array passed in — verified this exact expression exists in
  `InvoiceService::applyItemsAndTotals()`, `QuoteService` (line creation),
  `CreditNoteService::create()`, `RecurringInvoiceService::create()`,
  `ProcurementService` (line creation), `DeliveryNoteService` (line creation),
  `ReturnService::create()` — all pre-existing from VAR-DOC-1, none modified
  by this task. Purchase's line-writing path was confirmed identical in
  shape (grep-verified, not re-quoted here for brevity).
- **`createMany()`**: not used by any of the 8 services for line creation —
  every one creates lines individually inside a loop (confirmed), so there is
  no bulk-insert path that could silently drop a key via a differently-shaped
  array.
- **Update path**: Invoice, Purchase, Quote, Procurement, and Delivery Note
  all have real update endpoints, and every one was traced the same way as
  create — `$data['items']` (or `?? null`) flows unchanged into the same
  resolver-backed service method used by create. No separate/divergent update
  item-mapping logic exists for any of the 5.
- **Conclusion**: for all 8 document types' own create/update HTTP paths, the
  *only* place the field could have been lost was the missing validation
  rule itself — confirmed by this trace, not assumed. Adding the rule alone
  was sufficient; **zero service-layer code changes were needed or made.**
  The two propagation gaps that *do* exist (Quote/Procurement `convert()`,
  Delivery Note's invoice-draft builder) are downstream conversion features,
  not part of the 8 documents' own create/update contract — see GAP-07 in
  Risks/Deferred.

## Domain Authority Reuse

No new validation authority was written anywhere in this task.
`App\Support\DocumentLineVariantResolver::resolve(Product $product, ?string $variantId, string $tenantId): ?ProductVariant`
(VAR-DOC-1) remains the single point of decision for:
- Product/Variant relationship (`$variant->product_id !== $product->id`)
- Tenant match (both product-vs-tenant and variant-vs-tenant, never trusting
  client input)
- Variant-managed requirement (`$product->isVariantManaged()` with no
  variant supplied → reject)
- Simple-product prohibition (`! $product->isVariantManaged()` with a variant
  supplied → reject)
- Active/lifecycle validity (`! $variant->is_active` → reject)

`DocumentLineVariantResolver::descriptor(ProductVariant $variant): ?string`
remains the single point for the deterministic
`(option.sort_order, value.sort_order)`-ordered snapshot string, called only
at line-creation time, never at read/display time. Neither method was
modified. No FormRequest in this task duplicates any of these rules.

## Historical Snapshot Verification

No snapshot logic was written in HTTP — confirmed the existing VAR-DOC-1
snapshot mechanism (`product_name_snapshot`, `product_variant_id`,
`variant_descriptor_snapshot`, and, where the line model already supports it,
`product_sku_snapshot`/`product_barcode_snapshot`) is what actually persists
once the field reaches the resolver, via the pre-existing, unmodified write
path. Verified end-to-end through the real HTTP endpoint (not the service
directly) in `snapshots_persisted_correctly_through_http_path`: an
Invoice created via `POST /api/invoices` with an explicit
`product_variant_id` persists `product_id`, `product_variant_id`,
`product_name_snapshot` (matching the product's name at creation time), and
`variant_descriptor_snapshot` (`"أسود / كبير"`) correctly; renaming the
product and renaming an option value **after** posting leaves the persisted
line's snapshot fields completely unchanged, proving the HTTP path does not
bypass or weaken VAR-DOC-1's "never re-read the live catalog for a posted
document" guarantee.

## Tenant Isolation

Not re-delegated to the FormRequest layer anywhere — every negative test in
this task exercises the real HTTP endpoint end-to-end, and every rejection is
produced by `DocumentLineVariantResolver` (via the service's `$this->domain()`
wrapper converting its `RuntimeException` into a `422`), not by Laravel's
validator:

- **Same-tenant valid Variant accepted** — `invoice_variant_create_via_http`,
  `purchase_variant_create_via_http`, and one dedicated test per remaining
  document type.
- **Simple Product without Variant remains accepted** —
  `invoice_simple_product_create_via_http`,
  `field_omitted_backward_compatibility_across_document_types` (Invoice,
  Purchase, Quote in one test).
- **Variant-managed Product with valid Variant accepted** — every
  per-document "variant path" test.
- **Cross-tenant Variant rejected** — `invoice_cross_tenant_variant_rejected_via_http`
  and `purchase_cross_tenant_variant_rejected_via_http`, both asserting the
  real HTTP endpoint returns `422` and that **zero rows were created**
  (`Invoice::count()`/`PurchaseLine::count()` asserted `0`, not just the
  HTTP status) — proving the rejection happens before any write, not as a
  partial/rolled-back side effect.
- **Variant belonging to another Product rejected** —
  `invoice_wrong_product_variant_rejected_via_http` and
  `no_sibling_variant_substitution_across_products_is_possible` (a second,
  differently-worded test of the same guarantee, per the mission's explicit
  test-list item #17).
- **Inactive Variant rejected** — `inactive_variant_fails_closed_via_http`.
- **Crafted `product_variant_id` cannot bypass the tenant boundary** — the
  cross-tenant tests above use a *real, valid* `ProductVariant` UUID
  belonging to a genuinely different tenant (not a guessed/malformed one),
  proving the boundary holds even against a well-formed, existing ID.
- **Malformed input rejected at the structural layer** —
  `malformed_uuid_rejected_at_http_layer` confirms a non-UUID string is
  rejected by the HTTP validator itself (`422`,
  `assertJsonValidationErrors(['items.0.product_variant_id'])`) before ever
  reaching the resolver — the one and only responsibility this task's own
  validation rule carries.

## Backward Compatibility

- **Existing clients that omit `product_variant_id` for simple products
  continue working unchanged** — verified via
  `field_omitted_backward_compatibility_across_document_types` (Invoice,
  Purchase, Quote) and every other document's own "variant path" test, which
  implicitly re-confirms the simple-product path is untouched by using the
  same product fixtures elsewhere in the file.
- **No existing field name changed.** The new field is `product_variant_id`
  everywhere, matching the column name VAR-DOC-1 already established on
  every line model — no synonym, no new casing convention.
- **`product_variant_id` is never required globally** — `nullable` on every
  one of the 9 rule additions, confirmed by reading each file after editing.
- **No response contract changed except two purely additive field pairs**
  (`RecurringInvoiceLineResource`, `DeliveryNoteResource`'s inline line
  array), both mirroring the exact `product_variant_id`/`variant_descriptor`
  shape VAR-DOC-1 already shipped for the other six document types — no
  existing key was renamed, removed, or reshaped.

## Changed Files

**Modified (validation rule only, one line + a short explanatory comment
each):**
- `app/Http/Requests/StoreInvoiceRequest.php`
- `app/Http/Requests/StorePurchaseRequest.php`
- `app/Http/Requests/StoreQuoteRequest.php`
- `app/Http/Requests/StoreCreditNoteRequest.php`
- `app/Http/Requests/StoreRecurringInvoiceRequest.php`
- `app/Http/Requests/StoreProcurementDocumentRequest.php` (covers
  `UpdateProcurementDocumentRequest` via inheritance — that file itself was
  not touched)
- `app/Http/Requests/StoreDeliveryNoteRequest.php`
- `app/Http/Requests/UpdateDeliveryNoteRequest.php`
- `app/Http/Requests/StoreReturnRequest.php`

**Modified (additive response fields only, matching VAR-DOC-1's existing
pattern):**
- `app/Http/Resources/RecurringInvoiceLineResource.php`
- `app/Http/Resources/DeliveryNoteResource.php`

**New:**
- `tests/Feature/DocumentHttpVariantsTest.php` (19 tests)

**Not touched:** every service file (`InvoiceService`, `PurchaseService`,
`QuoteService`, `CreditNoteService`, `RecurringInvoiceService`,
`ProcurementService`, `DeliveryNoteService`, `ReturnService`),
`DocumentLineVariantResolver`, every controller, every migration, the
Ledger/accounting layer, POS, Commerce, and Reporting.

## Tests

**New** (`tests/Feature/DocumentHttpVariantsTest.php`) — **19/19 passed**
on SQLite, 87 assertions:

1. `invoice_simple_product_create_via_http`
2. `invoice_variant_create_via_http`
3. `invoice_wrong_product_variant_rejected_via_http`
4. `invoice_cross_tenant_variant_rejected_via_http`
5. `invoice_update_draft_propagates_variant_via_http`
6. `purchase_variant_create_via_http`
7. `quote_variant_create_via_http`
8. `credit_note_variant_path_via_http`
9. `recurring_invoice_variant_path_via_http`
10. `procurement_variant_path_via_http` (covers both create and its own
    draft-update propagation)
11. `delivery_note_variant_path_via_http` (covers both create and its own
    draft-update propagation)
12. `return_variant_path_via_http`
13. `field_omitted_backward_compatibility_across_document_types`
14. `malformed_uuid_rejected_at_http_layer`
15. `inactive_variant_fails_closed_via_http`
16. `variant_managed_product_without_variant_id_fails_closed_via_http`
17. `snapshots_persisted_correctly_through_http_path`
18. `no_sibling_variant_substitution_across_products_is_possible`
19. `purchase_cross_tenant_variant_rejected_via_http`

All 18 of the mission's explicitly-numbered test-plan items are covered
(items 1–11 map 1:1 to tests 1–12 above, since Procurement's and Delivery
Note's own tests each fold their "update/draft propagation" sub-case into
the same test method; item 12 "update/draft Variant propagation" is
additionally covered standalone for Invoice as test 5; items 13–18 map to
tests 13–19 directly).

**VAR-DOC-1 regression** (`VariantDocumentLineTest`, the service-layer
authority this task's HTTP layer sits on top of): **19/19 passed**,
unchanged — this task did not modify `DocumentLineVariantResolver` or any
service, so this is a pure confirmation, not new coverage.

**Targeted document-family regression**
(`DocumentHttpVariantsTest|VariantDocumentLineTest|InvoiceTest|PurchaseTest|QuoteTest|CreditNoteTest|RecurringInvoiceTest|ProcurementTest|DeliveryNoteTest|ReturnTest|ApiInvoiceTest|ProductVariantCoreTest|InventoryStateTest`):
**230/230 passed** (1308 assertions) on both SQLite and PostgreSQL.

**Broader HTTP-level sweep**
(`Api.*Invoice|Api.*Purchase|Api.*Quote|Api.*CreditNote|Api.*Procurement|Api.*DeliveryNote|Api.*Return|ApiReportsTest|ApiTenantIsolationTest`):
**76 passed, 1 failed** on both SQLite and PostgreSQL — the 1 failure is
`FuelSupplyReceivingApiTest` (`Call to undefined function App\Services\bcmul()`),
the same pre-existing, environment-only `bcmath`-extension gap documented in
every prior VAR-* milestone report in this program; it matched
`Api.*Return` purely by filter-string coincidence (its class name contains
"Api"), has zero relationship to documents, variants, or this task's diff,
and was already failing on `main` before this branch existed.

**Cross-cutting regression**
(`SalesReport|PurchaseReport|InventoryReport|Dashboard|VariantReporting|VariantDocumentLine|ProductVariantCore|InventoryState|PosVariantCheckout|Storefront|CommerceCart|CommerceCheckout|CommerceOrder|DocumentHttpVariants`)
— run to confirm the two additive resource changes did not disturb Reporting
(which reads these same line models), POS, or Commerce: **388 passed, 17
skipped** (the 17 are real PostgreSQL-only concurrency tests, correctly
skipped on SQLite), **zero failures**, on SQLite.

**SQLite/PostgreSQL**: all of the above targeted and cross-cutting suites
were run on both engines with identical results (`migrate:fresh --force`
succeeded cleanly on PostgreSQL 16, no new migration in this task since it
is HTTP-only). Full unfiltered `php artisan test` was **not run** — not
required by this task's own instruction ("Full suite فقط إذا يوجد سبب حقيقي
أو CI يتطلبها") and no such reason arose: every targeted/cross-cutting suite
above is green except the one pre-existing, unrelated `bcmath` gap already
documented across every prior milestone in this program.

## Build / CI

- `php -l` clean on all 11 changed/new PHP files.
- No `composer.json`/`package.json` change — no frontend build required (no
  `web/` file touched; no API response *shape* changed for any field an
  existing frontend client would already be reading, only additive keys).
- GitHub Actions on the pushed branch — not checked within this session
  (push happens after this report, per instruction).

## Risks / Deferred

- **GAP-07 (new, discovered in this task) — document *conversion* helpers
  drop `product_variant_id`.** `QuoteService::convert()`,
  `ProcurementService::itemsOf()` (shared by `ProcurementService::convert()`
  and `convertToPurchase()`), and
  `DeliveryNoteSalesInvoiceDraftBuilder::buildInvoiceItems()` each rebuild a
  plain items array from a source document's own lines via a `->map()`
  "line mapper" that never copies `product_variant_id` forward — unlike
  `RecurringInvoiceService::generate()`, which already does this correctly
  (confirmed, unmodified). Practical effect: converting a variant-managed
  Quote to an Invoice, or a variant-managed Procurement Order to a Purchase,
  or a variant-managed Delivery Note into an invoice draft, currently fails
  closed (`422`, "this product requires a concrete variant") rather than
  silently dropping or misassigning the variant — no data corruption, but
  these three conversion features are **currently unusable** for a
  variant-managed line. The Delivery Note builder additionally groups lines
  by a key that omits `product_variant_id`, which would also risk merging
  two sibling variants into one invoice line once the field is threaded
  through — that grouping key needs fixing alongside the field addition, not
  after. Not fixed in this task: these are three separate files outside the
  8 request classes this task's mandate covers, and the mission's own
  instruction is to STOP and document a related-but-not-ready path rather
  than widen scope silently. **Recommended as the very next follow-up** —
  small, mechanical (mirror `RecurringInvoiceService::generate()`'s existing
  correct pattern), and high-value since Quote→Invoice and
  Procurement-Order→Purchase conversion are primary, not edge-case,
  workflows.
- **GAP-08 (new, discovered in this task) — `ReturnService::assertWithinSource()`
  does not cross-validate a linked return line's product/variant identity
  against its declared `source_line_id`'s own product/variant.** It checks
  quantity and price ceilings against the source line, but a client could
  submit a *different*, independently-valid product/variant than what the
  cited source line actually sold, as long as `DocumentLineVariantResolver`'s
  own checks (tenant, product-ownership, active) pass on their own terms.
  This is a **pre-existing** gap (the same absence already existed for
  `product_id` alone, predating both this task and VAR-DOC-1), not
  introduced by adding the HTTP rule — but it is reachable through the real
  `/api/returns` endpoint for the first time now that `product_variant_id`
  is accepted there at all. Not fixed here, per the mission's explicit
  "if `product_variant_id` reveals a real [accounting-adjacent] bug: STOP
  and document instead of expanding scope" instruction — fixing it means
  changing `ReturnService`'s own validation logic, not HTTP completion.
  **Recommended as a follow-up**, scoped narrowly to adding a
  product/variant identity cross-check inside `assertWithinSource()`.
- **GAP-02 through GAP-06** (ProductUnitPrice UI/HTTP, Multiple Barcode UX,
  `InventoryBalanceExportService`, `min_sale_price` Variant test, POS Variant
  photos) — untouched, exactly as instructed.
- No Store/Commerce/POS/Reporting/Settings change of any kind was made.

## Git

- Branch: `claude/var-fu-1-document-http-variants`
- PR: VAR-FU-1: Complete variant support across ERP document HTTP flows
- Base SHA: `0b2f9a7c0ece44d9e41c87e2c793c495c62370aa`
- Head SHA: يُملأ بعد الدفع.

## Final Verdict

**GAP-01 CLOSED.**

All eight document types named in the Final Closure Review now accept
`items.*.product_variant_id` over their real HTTP create endpoints (and
every update endpoint that exists for them), propagate it unmodified to the
same `DocumentLineVariantResolver`-backed domain authority VAR-DOC-1 already
proved correct at the service layer, and persist the same historical
snapshot fields through the real HTTP path. Tenant isolation, cross-product
rejection, inactive-variant rejection, and backward compatibility for
simple products are all verified against the real endpoints, not just the
service layer. Two narrower, related, pre-existing/newly-reachable gaps
(GAP-07: conversion helpers; GAP-08: Return source-line cross-validation)
were found, are not part of GAP-01's own scope, and are documented rather
than silently fixed or silently left undiscovered.

## Next Step

GAP-02 (ProductUnitPrice UI/HTTP) and GAP-03 (Multiple Barcode UX) only,
and only after Safwan's explicit approval of this report. No other
milestone, and no unrequested fix to GAP-07/GAP-08, starts before that
approval.
