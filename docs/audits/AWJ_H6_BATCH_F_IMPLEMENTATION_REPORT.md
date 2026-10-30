# AWJ Commerce — H6 Batch F: Native Wholesale Pricing Foundation & Price Parity

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-f` |
| PR | #1809 |
| Base | `origin/main` @ `7cb5843fff7f9d906e18fbf92de135babd637ccc` (PR #1807, Batch E) |
| Head | `1612d485d30180d14e34fb60fab3cf43228334bf` (code); a docs-only commit recording CI results may follow |
| Status | Ready for review. **Not merged. Not deployed. Wholesale not enabled anywhere.** |

## 0. Executive summary

| Area | Result |
|---|---|
| List/detail/cart price divergence | **Fixed.** Root cause identified and proven by failing-first tests; one authoritative resolution path now serves all three surfaces. |
| DTC prices | **Unchanged, byte-for-byte** for any channel without an active channel price list (no list query is even issued). |
| Staff channel settings API | `GET/PUT commerce/channels/{id}/pricing-settings`, new explicit permission, tenant-scoped, audited, no implicit activation. |
| Wholesale price visibility | New fail-closed gate on every price-bearing `store/v1` route; authentication alone grants nothing. |
| Order-line price provenance | **Implemented** (additive, reversible, server-resolved, immutable, new lines only). |
| PostgreSQL concurrency | **Real multi-process** (`pcntl_fork`, separate connections) test of membership transitions + settings edits, run on PG 16; mutation-checked. |
| Exclusions | Respected: no activation, no SMS/OTP/email, no public registration, no wholesale UI, no Spree-checkout replacement, no payment/cancellation/accounting/ZATCA change. |

## 1. Root cause and before/after pricing behaviour

### Root cause

`StorefrontProductController::index()` priced each listing row with `Product.sale_price` read directly
(`$product->isVariantManaged() ? 0 : (int) $product->sale_price`), justified by a code comment claiming the result
is "necessarily identical" to `CommercePriceResolver::resolve()` because no *partner* price list is resolved for an
anonymous visitor. That reasoning missed the second precedence tier: **the sales channel's own
`default_price_list_id`** (COM-PRICE-1 precedence: partner list → channel list → item → `sale_price`).
`show()`, the cart and checkout all go through `CommercePriceResolver`, which applies the channel list. So a channel
with an active price list displayed the retail price in the listing and the list price on the product page, in the
cart and at checkout.

### Before / after

| Scenario (same channel, anonymous) | Before | After |
|---|---|---|
| No channel price list | list = detail = cart = `sale_price` | **identical** (unchanged) |
| Active channel list, product has item | list = `sale_price` ✗, detail = cart = list price | list = detail = cart = list price |
| Active channel list, product has no item | all `sale_price` | all `sale_price` |
| Inactive channel list | all `sale_price` | all `sale_price` (list ignored everywhere) |
| Corrupt / cross-tenant list reference | list showed retail price silently ✗, detail failed closed | **both fail closed with the same status**; never a silent retail fallback |
| Variant-managed product | listing `0` | listing `0` (unchanged; per-variant price resolved in `show()`) |

## 2. DTC compatibility evidence

The invariant "a channel with no active channel price list prints exactly `Product.sale_price`" is enforced
structurally and by test:

* `CommercePriceResolver::browsePrices()` returns `sale_price` for every simple product when the channel has no
  `default_price_list_id` or the list is inactive, and issues **no** `price_list_items` query in that case.
* `StorefrontPriceParityTest`:
  * `a_channel_without_a_price_list_lists_exactly_the_product_sale_price` (includes a genuine `0` price) — passed
    both **before** and **after** the fix (it is the pre-existing behaviour, not a new expectation);
  * `an_inactive_channel_price_list_is_ignored_everywhere` — passed before and after;
  * `pagination_and_response_shape_are_unchanged_by_channel_pricing` — passed before and after.
* `WholesalePriceVisibilityTest::an_unflagged_dtc_channel_is_untouched_whatever_the_deployment_flag` /
  `a_stray_buyer_token_header_changes_nothing_on_a_dtc_channel`: the new gate is a pass-through for every
  non-flagged channel (identical bodies, no auth, no header read) with the deployment flag on **and** off.
* No precedence, discount-eligibility, currency, tax-inclusivity or rounding logic was touched. The only behavioural
  change for DTC is for a channel that *already* has an active channel list: the listing now agrees with the
  detail/cart it was always contradicting. That is the bug, not a new pricing decision; no new precedence decision was
  required, so nothing was deferred.

Tests-first record: the parity suite was written and run against unmodified code — **4 failed / 3 passed**
(failures: channel-list parity, cross-channel, fail-closed, N+1; passes: the three DTC invariants). After the fix:
**7/7**.

## 3. Pricing-resolution architecture

```
store/v1 listing  ──►  CommercePriceResolver::browsePrices(Collection $products, $channelId)   ← batched, anonymous, no unit/variant
store/v1 detail   ──►  CommercePriceResolver::resolve($id, $channelId)                          ← single
cart / checkout   ──►  CommercePriceResolver::resolve(…)                                        ← single (+ lock when committing)
commerce order    ──►  CommercePriceResolver::resolve(…)                                        ← single
```

* `browsePrices()` is the batched twin of `resolve()` for the browse context (no partner, base unit, simple
  products). Same tiers in the same order: channel's active default list item for the product's own unit →
  `Product.sale_price`. One `price_list_items` query per page (asserted with `DB::listen`: exactly 1 for 12 products).
* Same fail-closed rule: a `default_price_list_id` that `TenantScope` cannot resolve throws, exactly as `resolve()`
  does — the list endpoint returns the same status as the detail endpoint (tested).
* No second price source is created; pagination, filters, sort and the response envelope are untouched.
* **Base price source.** `Product::sale_price` is an accessor over `product_unit_prices` (VAR-PRICE-1); the
  `products.sale_price` column is legacy. `browsePrices()` therefore loads base prices in one `product_unit_prices`
  query (same value as the accessor: the product's own unit, `0` if none) instead of one query per row — verified by a
  test that the query count does not grow from 1 to 12 rows.
* **Price sort.** On a channel with an active list, `sort=sale_price|-sale_price` orders by the displayed price
  (list item, else base unit price, else 0) via a correlated subquery before pagination, so page 1 holds the genuinely
  cheapest displayed products (review finding, tested incl. pagination). Channels without a list keep the exact
  historical statement (asserted by test).
* **Caching:** the listing had none and gets none (nothing to invalidate).
* **Channel scoping:** the channel comes from the Host-derived `StorefrontContext` only; a list on channel A can never
  affect channel B of the same tenant or any other tenant (tested with a second web channel on its own host).

## 4. Wholesale price visibility (authorization)

`EnsureWholesalePriceAccess` is applied after the host resolver on every price-bearing `store/v1` route:
`products`, `products/{id}`, `offers`, `cart` (+ item mutations), `checkout` (+ `checkout/payment-methods` and all
checkout mutations including `complete`). It is also on the non-production legacy `{tenantSlug}/products*` routes
so they cannot become a side door.

| Channel state | Result |
|---|---|
| Not flagged `wholesale_membership_enabled` (all DTC) | pass-through, no change |
| Flagged, deployment flag `commerce.wholesale_buyer_enabled` **off** | uniform **404** for everyone, including an approved buyer. The channel is dark; no fallback to retail prices, another channel or another tenant |
| Flagged, flag on, no/invalid `X-Customer-Token` | **401** |
| Flagged, flag on, token minted for another host/channel/tenant | **401** (`BindStorefrontBuyerToChannel`) |
| Flagged, flag on, valid session, membership not `approved` (none/pending/rejected/suspended) | **403** |
| Flagged, flag on, valid session, `approved` | normal response with the channel price list prices |

The three buyer checks are the existing Batch E middleware (`AuthenticateCommerceCustomer`,
`BindStorefrontBuyerToChannel`, `EnsureApprovedWholesaleBuyer`) run through a pipeline — no new auth logic.
Membership is read fresh on every request, so suspension/reinstatement affects the *same* session immediately (tested).

Deliberately **not** gated: `orders/{order}/payment-status` and `checkout/payment-intent` (they operate on an
already-created order via a signed order reference; gating them could strand a paid buyer after a suspension).
Because a flagged channel cannot reach cart/checkout without approval, such orders can only originate from approved
buyers. `/commerce/v1` (M2M API-key surface) is out of scope and unchanged — see risks.

## 5. Staff channel-settings API (contracts and RBAC)

`GET  /api/commerce/channels/{id}/pricing-settings`
`PUT  /api/commerce/channels/{id}/pricing-settings`

* **Permission:** `commerce.channel_settings.manage` — owner/admin via `*` only; **not** in `Rbac::MATRIX`, not granted
  to any stored role by migration (tested: accountant, staff and a custom role holding `commerce.manage`,
  `commerce.wholesale.manage`, `commerce.orders.view` are all 403). Plus `EnsureApplicationActive:commerce.storefront`.
* **PUT body (all optional, ≥ 1 required):** `default_price_list_id` (uuid | `null` to clear),
  `wholesale_membership_enabled` (bool). `tenant_id` is `prohibited` (422). Unknown keys are ignored; a body with no
  recognised key is 422 `no_changes_supplied`.
* **Validation:**
  * channel resolved under `TenantScope`, `type = web` only (else 404 on `GET`, 422 `channel_not_web` on `PUT`);
  * price list resolved under `TenantScope` (+ soft-delete scope) — foreign, deleted and unknown ids give the *same*
    422 `price_list_not_found` body (no cross-tenant existence oracle); inactive ⇒ 422 `price_list_inactive`;
  * **currency:** price lists carry no currency column; the tenant is single-currency (`Tenant.currency`, which
    `CommercePriceResolver` reads). Same-tenant + active therefore *is* the compatibility rule; nothing to mismatch;
  * **no implicit activation:** turning `wholesale_membership_enabled` **on** while the deployment gate
    `commerce.wholesale_buyer_enabled` is off ⇒ **409 `wholesale_deployment_disabled`** (otherwise the price gate would
    turn the whole storefront dark). Turning it off is always allowed. The API never touches the deployment flag.
* **Concurrency:** channel row locked `FOR UPDATE` for the whole change, so concurrent edits serialise and each audit
  event records the true before/after (PG test below).
* **Response:** `{data: {id, name, type, default_price_list{id,name,is_active}|null, wholesale_membership_enabled,
  wholesale_deployment_enabled (read-only), recent_changes[≤10]}}`. No `tenant_id`, no credentials.
* The **model guard** (`SalesChannel` saving: web-only wholesale flag; active same-tenant default list) still holds
  underneath and is tested directly.

## 6. Audit evidence

Table `sales_channel_setting_events` (additive migration `2026_12_16_010000`): `tenant_id`, `sales_channel_id`
(RESTRICT), `actor_user_id`, `changes` JSON = changed keys only as `{key: {from, to}}`, `created_at`. Append-only
(model refuses update/delete; `down()` refuses while rows exist). **One event per effective change; a request that
changes nothing writes nothing** (tested). Tests assert actor, timestamp, tenant and exact before/after for assign,
clear, flag-on and flag-off. The membership decisions keep their Batch E event table.

## 7. Order-line price provenance — decision: **implemented**

Inspection showed it is safe and additive: order lines are already a snapshot (`unit_price`, `line_total`, names),
both creation paths already hold the resolver result, and nothing shared with accounting/ZATCA is involved.

* Migration `2026_12_17_010000`: `commerce_order_lines.price_source` (`price_list` | `product_default`) and
  `price_list_id` (FK → `price_lists`, **RESTRICT**, like `invoices.price_list_id`). Both nullable. PostgreSQL CHECK
  keeps them mutually consistent. Reversible; `down()` refuses while any line carries provenance. Verified
  up → down(2 steps) → up on PostgreSQL 16 and SQLite.
* `price_list_id` is persisted only when the list actually **supplied** the price (`ResolvedCommercePrice::provenanceListId()`):
  an active list with no item for the product falls back to `product_default` with a NULL list (otherwise the PG
  CHECK would reject the order and SQLite would store misleading evidence — caught in review; tested in both creation paths).
* Written **only** server-side from `ResolvedCommercePrice` in `CommerceCheckoutService::revalidateAndPrice`
  (store/v1 + commerce/v1 checkout) and `CommerceOrderService::createLine` (commerce/v1 order API). Request items cannot
  supply it (tested: forged `price_source`/`price_list_id`/`unit_price` in an item are ignored).
* **Immutable:** `CommerceOrderLine` refuses any update touching either column — which also forbids back-filling a
  historical `NULL`. Historical lines stay `NULL`: no backfill, no recalculation, no rewrite.
* `PriceListService::delete()` now also refuses a list that priced an order line (soft-delete would otherwise leave
  evidence pointing at a deleted list); the FK RESTRICT is the hard backstop.
* "Relevant channel context" = the order's own `sales_channel_id` (already stored); not duplicated per line.
* Not exposed: buyer and staff serializers are unchanged (explicit field maps; asserted that the buyer payload does not
  contain either key) — so no API contract, OpenAPI or storefront type changed.
* Unchanged: `unit_price`, `line_total`, order total, invoice/accounting/VAT/ZATCA (asserted: no journal entry,
  invoice or stock movement is created).

## 8. Tenant-isolation tests

* Parity: second web channel on the same tenant; second tenant — list never leaks across (`StorefrontPriceParityTest`).
* Price gate: token from a sibling channel (same tenant) and from another tenant both 401; approval on channel 1 gives
  nothing on flagged channel 2 (403) (`WholesalePriceVisibilityTest`).
* Settings API: other tenant's channel ⇒ 404 on `GET` and `PUT`; other tenant's price list ⇒ same 422 as unknown id;
  client `tenant_id` ⇒ 422; other tenant's owner cannot read this tenant's channel (`StaffChannelPricingSettingsTest`).
* Provenance: forged foreign `price_list_id` in an item ignored; list used by a line cannot be deleted.

## 9. PostgreSQL concurrency evidence

`tests/Feature/WholesaleMembershipPostgresConcurrencyTest.php` — real `pcntl_fork` processes with their own PDO
connections, a shared start barrier, no wrapping transaction, **fails (not skips) if `pcntl` is missing on PG**,
skips on SQLite only. Run locally on PostgreSQL 16:

| Test | Result |
|---|---|
| approve vs reject on one pending membership ×6 rounds | exactly one winner each round, loser `invalid_transition`, one staff event, final status = winner |
| 4 simultaneous approvals | 1 winner, 3 `invalid_transition`, 1 staff event |
| 2 simultaneous suspensions of an approved buyer | 1 winner, `suspended`, approve+suspend events only |
| decision vs a process holding `FOR UPDATE` on the row for 400 ms | decision waited (≥150 ms asserted) then applied to current state |
| 4 simultaneous applications by one identity | one membership, one event |
| 4 concurrent channel-settings edits | all serialised; audit chain contiguous (`from` = previous `to`), final value = chain end |

**Mutation check (evidence the test is not vacuous):** removing `lockForUpdate()` from
`WholesaleMembershipService::transition` made the three opposing-decision tests fail; removing it from
`SalesChannelSettingsService::update` made the audit-chain test fail in 3/3 runs. Both mutations were reverted.
The existing Batch E "concurrency" tests remain serial SQLite tests and are **not** counted as concurrency evidence.

## 10. Modified / added files

Production: `StorefrontProductController` (listing uses `browsePrices`), `CommercePriceResolver` (+`browsePrices`),
`EnsureWholesalePriceAccess` (new), `routes/api_storefront.php`, `CommerceStaffChannelSettingsController` (new),
`SalesChannelSettingsService`/`SalesChannelSettingsException`/`SalesChannelSettingEvent` (new), `routes/api.php`,
`Rbac` (+permission), `CommerceOrderLine` (+fillable, immutability guard), `CommerceCheckoutService` and
`CommerceOrderService` (provenance), `PriceList` (+relation), `PriceListService` (delete guard), two additive migrations.
Tests: `StorefrontPriceParityTest`, `WholesalePriceVisibilityTest`, `StaffChannelPricingSettingsTest`,
`WholesaleMembershipPostgresConcurrencyTest` (new); additions to `CommerceCheckoutApiTest`,
`CommerceOrderServiceTest`; route allow-list entry in `CommerceModuleBoundaryTest`. No existing assertion was
loosened or removed.

## 11. Tests and CI results

### One existing test expectation changed (disclosed)

`StorefrontOfferPublicApiTest::existing_product_endpoints_are_unchanged_by_offers` asserted that the **listing** shows
`25000` (base price) for a product whose channel price list says `19000` — i.e. it pinned the very divergence this
batch fixes. The test's purpose (offers never alter `GET /products`) is preserved (the before/after equality
assertion is unchanged); the pinned value is now `19000`, and I added an assertion that the detail endpoint returns the
same `19000`. No other existing assertion was changed or removed.

### Local results (SQLite unless stated)

| Check | Result |
|---|---|
| New: `StorefrontPriceParityTest` | 10/10 (4 failed before the fix; +sort, +base-price N+1 after review) |
| New: `WholesalePriceVisibilityTest` | 9/9 |
| New: `StaffChannelPricingSettingsTest` | 15/15 |
| Added tests in `CommerceCheckoutApiTest` + `CommerceOrderServiceTest` (+ the two existing suites) | all pass (incl. 10 new) |
| Re-run after review fixes (parity, order, checkout, offers, wholesale visibility, storefront products, resolver): 232 tests | pass on **SQLite and PostgreSQL 16** |
| `Storefront*/Flowers*/Catalog*/Facet*/Visual*` classes | 1343 passed, 17 skipped |
| `CommerceModuleBoundaryTest` (route allow-list) | pass |
| New: `WholesaleMembershipPostgresConcurrencyTest` on **PostgreSQL 16** | 6/6 (82 assertions); mutation-checked (§9) |
| Migrations up → rollback(2) → up | pass on PostgreSQL 16 and SQLite |
| Full backend suite, SQLite, 838 test classes in 28 chunks (3 parallel lanes) | see below |
| Spree ratchet (`pnpm check:spree-ratchet`) | OK, counts equal baseline (no storefront code changed) |
| Storefront typecheck/tests | not run: no response contract changed (explicit serializers, no new/renamed field on any existing payload) |

**Full-suite triage.** First pass had failures in 15 classes; none touch this change:

* `Fuel*` (7 classes, 29 tests): `Call to undefined function bcmul()` — `bcmath` is not installed in the sandbox (CI installs it).
* `AiActionControlInFlightStopTest`, `AiDocumentExternalQaTest`, `AiPlatformBudgetTest`, `AttachmentDurabilityS1Test`,
  `H5ImportEndpointsTest`, `ImportJobApplyTest`, `ImportJobFailedUnitsTest`, `ImportJobRepairTest`: caused by my three
  lanes sharing one `storage/` tree; **all pass (194 passed, 1 skipped) when re-run serially**.
* `StorefrontOfferPublicApiTest`: the real regression described above (fixed).
* One chunk was killed by signal 9 because of `CommerceOrderCancellationApiTest`, a stale file in my *local* assembled
  app that does not exist in the repository (`git ls-tree origin/main`); every other class of that chunk
  (30 classes incl. `CommerceOrderServiceTest`, `CommercePriceResolverTest`, `CommerceStaffOrderApiTest`, the
  cancellation/reservation/invoice-on-payment suites) passes individually.

Net: no failing test attributable to this change locally. **The local PostgreSQL full-suite run was not performed**
(only the new PG test and migrations); the CI `pgsql` matrix job is the authority for that. CI and CI Gate results:
see below.

### CI (GitHub Actions, PR #1809, head `1612d485d`)

| Check | Result |
|---|---|
| `php artisan test (L11, sqlite)` | success |
| `php artisan test (L11, pgsql)` — includes `WholesaleMembershipPostgresConcurrencyTest` | success |
| `CI Gate` | success |
| Codex review of `1612d48` | completed, no findings (2 findings on the first head, both valid, fixed and resolved) |

The first CI run (head `8a9b48b`) was cancelled by the newer push, not failed.

## 12. Deferred work and risks

| Item | Note |
|---|---|
| `/commerce/v1` (API-key/M2M) price surface for a flagged channel | Not gated here: it is a machine-to-machine surface authenticated by a store API client, a different trust model. Gate it (or forbid flagged channels for API clients) before any wholesale activation. **Recommended Batch G prerequisite.** |
| Turning the flag **off** on a channel that has a list | Allowed and audited; the channel becomes a normal DTC channel serving the list prices publicly. This is the same state as assigning a list to any DTC channel; it needs the same owner/admin permission. |
| Assigning a list to an existing DTC channel | Changes the prices that channel shows (and, via the resolver, what carts/checkouts charge). That is the intended, already-existing precedence made reachable through an API; it is explicit, permissioned and audited, and was not performed in any environment by this PR. |
| Wholesale storefront UI, buyer registration UI, SMS/OTP/email | Explicitly out of scope. |
| Provenance exposure to staff UI / reports | Persisted but not surfaced; add to the staff order serializer when a consumer exists. |
| `payment-status` / `payment-intent` not behind the gate | Deliberate (see §4). |
| Pre-existing: `sort=sale_price` on a channel **without** a list orders by the legacy `products.sale_price` column | Since VAR-PRICE-1 that column is not the price authority, so DTC price-sort order is effectively arbitrary (ties → `id desc`). Not changed here (it would alter DTC ordering, outside this batch's approved scope); recommend fixing with owner approval, e.g. in Batch G. |
| Local gaps | `bcmath` is not installed in the sandbox: bcmath-dependent suites (e.g. fuel) fail locally and pass in CI. The pre-existing stale `CommerceOrderCancellationApiTest.php` copy in the local assembled app is environmental. |

## 13. Recommended Batch G

Wholesale **catalog-visibility and ordering rules** on top of this foundation, still gated: (1) close the
`/commerce/v1` side door (reject flagged channels for API clients or apply the same gate); (2) per-membership
tier → price list mapping (so two approved buyers can see different lists) behind the same audit pattern;
(3) minimum-order-quantity / pack-size rules enforced in `CommerceCheckoutService::revalidateAndPrice`;
(4) expose `price_source`/`price_list_id` in the staff order view and an order-line pricing report; (5) a staged,
owner-approved activation runbook (still a separate decision).
