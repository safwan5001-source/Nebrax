# AWJ H6 — Native Quick Order by SKU & Spree exit readiness

| | |
|---|---|
| Branch | `claude/h6-quick-order` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1846 |
| Base SHA | `c945a1dc6505882b7de70efb172a872de440f1e6` (#1841, H6 final closure) |
| Head SHA | code head `5bdfb21a3` (this report's later edits are docs-only on top of it) |
| CI | running at the time of writing — see §10 |

Nothing was merged, deployed, restarted or migrated against a deployed environment. No environment variable was changed. Wholesale stays disabled by default (`commerce.wholesale_buyer_enabled`). **No Spree code, route, dependency or file was removed.** There is no migration in this PR. The browser suite ran only against a throwaway local SQLite file on loopback, and no payment was captured.

---

## 0. Outcome

| Question | Answer |
|---|---|
| Is native Quick Order by SKU built? | **Yes** — `/buyer/quick-order` on a wholesale host, backed by three new `buyer/quick-order/*` endpoints. It feeds the **existing** AWJ cart and the **existing** native checkout; there is no second cart or checkout engine. |
| Is the last Spree wholesale journey feature now replaced? | **Yes.** Quick order was the only wholesale feature with no native replacement (closure report R2). |
| Can Spree be removed now? | **No — not in this PR, and not yet by anyone.** The smallest safe candidate (W1, the `(wholesale)` route group) is now technically unblocked, but removal needs deployed isolated verification and your explicit approval (§8). |
| What blocks the next step? | Deployment/runtime items that only the owner can do (§9). |

---

## 1. What was built

### 1.1 Backend (`routes/api_storefront.php`, `StorefrontQuickOrderController`, `CommerceCartService::addMany`)

All three routes sit inside the existing `EnsureWholesaleBuyerEnabled` group and behind `EnsureWholesalePriceAccess`. That middleware re-checks, on **every request**, that the wholesale flag is open, that the host resolves to a wholesale-flagged channel, and that the authenticated buyer's membership **on this channel** is approved.

| Route | Verb | Purpose |
|---|---|---|
| `buyer/quick-order/lookup?q=&limit=` | GET | Resolve a typed SKU or name into purchasable **lines** (≤ 20 products, ≤ 12 variants each). Read-only. |
| `buyer/quick-order/resolve?skus[]=` | GET | Resolve a **pasted list** of SKUs exactly, in request order (one result per SKU, ambiguous parent SKUs list their variants). Read-only. |
| `buyer/quick-order/add` | POST (`RequireStorefrontMutationGateway`) | Add ≤ 50 lines to the buyer's cart **all-or-nothing**. |

**Server-side resolution.** A simple product is found by its own SKU; a variant product by the **variant's** SKU (or all active variants when the parent SKU matched). Matching is case-insensitive on both databases (see §6, defect 1). Only active products published on the resolved channel are considered.

**Pricing.** Every line is priced by `CommercePriceResolver`, i.e. the approved precedence **partner list → channel list → unavailable**. A line with no eligible price is `available: false`, carries **no price**, and exposes `unavailable_reason`; the base retail sale price is never a fallback and never appears.

**Bulk add is atomic.** `CommerceCartService::addMany()` runs one outer transaction and calls the existing `add()` per line inside a savepoint. Every failing line is collected (`index` + machine `reason`), then the whole transaction rolls back and the API answers 422 with `error.details.reason = quick_order_rejected` and `lines[{index, reason}]`. Result: no cart is created, an existing cart is left exactly as it was, and there are no partial lines. This reuses `add()`'s own checks (purchasable, variant resolution, unit resolution, quantity, price) rather than re-implementing them.

**What the API refuses to trust.** The request accepts only `product_id`, optional `product_variant_id`, `unit_key`, `quantity` per line. Any other key (price, partner, price list, buyer, tenant, channel, …) is a 422, exactly as on `cart/items`. Cart ownership is the existing cart token/buyer binding; another buyer cannot write into a cart.

**Checkout.** Lines are repriced on every cart read and at checkout by the existing path, so a price changed after review is picked up there too (E2E Q06/Q07 prove the add-time and read-time behaviour).

### 1.2 Storefront (`storefront/`)

| Piece | File |
|---|---|
| Route | `src/app/[country]/[locale]/(storefront)/buyer/quick-order/page.tsx` (gate page: sign-in / membership states reuse the existing buyer gate) |
| UI | `src/components/wholesale-buyer/QuickOrder.tsx` — search by SKU/name, variant selection, quantities, **paste a list** (`SKU qty` per line), multi-line review with per-line status, remove/edit, a single submit that sends **only eligible lines**, then continues to the native cart/checkout |
| View-model | `src/lib/commerce/quick-order.ts` (parse, merge, quantity validation, failure mapping) |
| Server actions | `src/lib/data/wholesale-buyer.ts`: `searchQuickOrder`, `resolveQuickOrderSkus`, `addQuickOrderLines` (HttpOnly buyer-session cookie, existing `storefrontBuyerRequest`/`storefrontCartRequest` transports; the browser never holds the buyer token) |
| Entry points | quick-order link on `BuyerMembershipPanel` (approved only); legacy `/wholesale/quick-order` on a native wholesale host now 308s to `/buyer/quick-order` (`lib/spree/middleware.ts`); previously this was a 404 |
| i18n | `wholesaleBuyer.quickOrder.*` and `membership.quickOrder` in all six locale files (ar/en/de/es/fr/pl); `check:locales` green |

Reuse: existing `StoreContainer`, buttons, inputs, money formatting, design tokens, and `WholesaleBuyer*` gate components. Arabic is RTL, English LTR; the mobile layout puts a full-width submit within thumb reach.

Unavailable or invalid lines are **shown in the review with a reason and excluded from submit** (they are never silently dropped and never sent). Server-side validation is authoritative regardless of what the form allowed.

---

## 2. Requirement → proof matrix

| Requirement | Proof |
|---|---|
| Approved membership required | `WholesaleQuickOrderTest::only an approved buyer on this channel can look up or add`; E2E Q01 (signed-out gate) |
| Suspended buyer loses access on the same session | `a suspended buyer loses lookup and add on the same session`; E2E Q09 |
| Tenant/channel isolation | `a session or approval from another channel unlocks nothing here`; `a product not published on this channel cannot be added`; E2E Q10 (token approved on `ws` unlocks nothing on `ws3`) |
| Retail host has no quick order; flag off = 404 | `a retail host has no quick order at all`; `the deployment flag off makes both routes a 404`; existing E2E D01/D02 and H01 |
| Server-side SKU resolution (exact SKU) | `an exact sku resolves to one line…`; `a pasted list resolves each sku exactly in request order`; E2E Q02 |
| Variant SKU | `a product name lists its active variants and never an inactive one`; `variant and unit consistency is enforced by the server`; E2E Q03 |
| Price precedence, no retail fallback | `an unpriced product is unavailable with no price and the sale price is never exposed`; the existing `WholesalePricePrecedence*` suites are unchanged and green |
| Price withdrawn between review and submit | E2E Q06: whole batch rejected, nothing added |
| Quantity validation | `quantities and the payload shape are validated and a browser price is refused`; component tests; E2E Q05 (client) and Q11 (API) |
| Browser never supplies prices/identities | `…a browser price is refused`; E2E Q11 (price, partner, buyer, unknown field → 422; missing gateway secret refused) |
| Atomic bulk add, no partial state | `one bad line rejects the whole batch and creates no cart and no line`; `a rejected batch leaves an existing cart exactly as it was`; `repeated and duplicate lines merge into one cart line` |
| Max lines | `exactly the maximum number of lines is accepted`; `the documented line ceiling matches the controller` |
| Cart ownership | `a cart belongs to its buyer and another buyer cannot write into it` |
| Checkout revalidation | `the added lines are repriced on every read so checkout never trusts…`; E2E Q07/Q08 |
| Checkout completion, **no payment capture** | E2E Q07 (review → confirmation with the non-capturing payment method), Q08 (exactly one order, owned by the buyer, on the quick-order channel, server priced, no invoice/payment/journal rows) |
| Cart totals | E2E Q02/Q04/Q06 assert unit, line and total figures exactly (`25.00 / 28.00 / 50.00 / 7.00 / 78.00` for the mixed cart) |
| Retail regression | existing E2E D01/D02 (retail browse + confirmation) unchanged and green |
| Mobile Arabic layout | E2E Q12 (RTL, no horizontal scroll, search/paste/review/submit reachable) |

---

## 3. Browser evidence

Screenshots (copied from the Playwright run) are in `docs/audits/assets/h6-quick-order/`:

| File | Shows |
|---|---|
| `desktop-en-Q02-exact-sku-ready.png` | exact SKU resolved, server price, ready to add |
| `desktop-en-Q03-variant-sku.png` | variant found by its own SKU, priced per variant |
| `desktop-en-Q04-review-mixed.png` | mixed paste: eligible, invalid SKU, ambiguous parent, unavailable (no price) |
| `desktop-en-Q05-quantity-errors.png` | client-side quantity errors, nothing sent |
| `desktop-en-Q07-review.png`, `…-Q07-confirmation.png` | native checkout review and confirmation |
| `desktop-en-Q09-suspended.png` | suspended buyer gets the approval gate |
| `mobile-ar-Q12-mobile-arabic-review.png`, `…-added.png` | Arabic RTL on a phone viewport |

The remaining screenshots of the 56-test run were generated locally in `storefront/test-results/` (git-ignored).

---

## 4. Verification

| Check | Result |
|---|---|
| `WholesaleQuickOrderTest` | 29 tests, **SQLite and PostgreSQL green** |
| Related PHP suites (SQLite): Wholesale\*, StorefrontCart\*/Checkout\*, CommerceCart\*/Checkout\*, CommerceModuleBoundary, CommercePrice\*, BranchIsolationGuard, ApplicationCatalog, StorefrontGateway\*, StorefrontClientIp, StorefrontRoutesRegistered, StorefrontPriceParity | **414 passed, 27 skipped, 0 failed** |
| Related PHP suites (PostgreSQL): WholesaleQuickOrder, WholesalePriceSurfaceBoundary, WholesaleCartCheckoutBoundary, WholesalePricePrecedence, WholesaleBuyer, StorefrontCart/Checkout, CommerceCart, CommerceModuleBoundary, BranchIsolationGuard | 282 passed on the first run + the 2 quick-order failures fixed (§6) and re-run green; boundary test re-run green |
| Storefront `pnpm test` | **256 files passed, 3675 tests passed**, 16 skipped (pre-existing) |
| `tsc --noEmit` | clean |
| `pnpm lint` (Biome) | 0 errors (6 warnings / 3 infos are pre-existing) |
| `pnpm check:locales` | all six locales in sync |
| `pnpm check:spree-ratchet` | OK at the unchanged baseline (4 / 4 / 52 / 69 / 9) — this PR adds **no** Spree dependency |
| Production build | the E2E stack serves `next start` of a production build of this source |
| Playwright wholesale suite (local isolated stack, desktop-en + mobile-ar) | **56 / 56 passed**, run on a fresh production build of `280acb341`; the review fixes after it (paste-box handling, SKU length) are covered by unit/component/backend tests, not by a browser re-run (12 new Q-tests; the rest are the pre-existing journey, security, retail-regression, rate-limit, closure and Arabic-mobile tests) |
| CI Gate | running at the time of writing — see §10 |

Not run locally: the full PHP suite (no ParaTest here; `ext-bcmath` is absent so Fuel\* tests fail locally by environment, not by this change) — CI runs it.

---

## 5. Existing tests / files touched (disclosed)

No financial or security assertion was weakened.

| File | Change | Why |
|---|---|---|
| `tests/Feature/WholesalePriceSurfaceBoundaryTest.php` | the three new route names were added to `PRICE_BEARING` | the guard enumerates price-bearing wholesale routes; the new routes **are** price-bearing and are now under the same gating assertions. This **extends** the guard. |
| `storefront/src/lib/spree/middleware.ts` / `.test.ts` | `/wholesale/quick-order` maps to `/buyer/quick-order` on a native wholesale host (was: 404) | closes the last legacy redirect gap |
| `storefront/src/lib/commerce/__tests__/wholesale-buyer.architecture.test.ts` | the three new files are listed | the architecture guard requires new buyer files to be declared |
| `storefront/e2e/wholesale-buyer-journey.spec.ts` | (a) `H01`/`H03` previously asserted that `/wholesale/quick-order` is 404; they now assert the redirect; (b) test 08's listing-card locator changed to `getByRole("link", …)` because the streaming render produced a hidden duplicate node (strict-mode violation) and (c) `signIn` takes an origin | (a) is the intended behaviour change; (b)/(c) are locator/helper fixes with the same assertions |
| `storefront/e2e/support/wholesale-e2e-seed.php` | adds the `ws3` quick-order channel, products/variants/price list and buyers | seed for Q-tests, throwaway DB only (guarded by `E2E_ALLOW_SEED` and an `e2e` path) |

---

## 6. Defects found by verification, and fixed in this PR

1. **PostgreSQL case sensitivity (real bug, would have shipped).** `LIKE` is case-insensitive on SQLite and **case-sensitive on PostgreSQL**, so a buyer typing `cof-100` found nothing in production while the SQLite tests passed. Found by the PostgreSQL run; fixed by comparing `lower(column) like lower(term)`; the existing lowercase-SKU tests now guard it on both engines.
2. A parent SKU that matched alongside a variant's own SKU returned only one variant (`elseif`); now two independent checks.
3. UI: the submit button stayed disabled after a pasted import (React transition + server action); replaced by an explicit in-flight flag with `try/finally`.
5. Codex review of the PR (three P2 findings, all verified as real and fixed with a regression test each): (a) while an add is in flight the submitted rows could still be edited, so those edits were lost when the response cleared the row — the quantity input, remove and pick controls are now disabled while pending; (b) merging a duplicate SKU treated an invalid quantity as 0, silently turning a typo into a smaller valid order — the invalid text is now preserved and keeps blocking; (c) an exact variant SKU could be crowded out by ≥ limit other products that merely mention it, because only the parent SKU was prioritised before the limit — the ordering now ranks an exact active-variant SKU match first.
6. Codex re-review of the fix commit (three more P2 findings, verified and fixed with tests): (a) the 50-line limit was checked on the pasted batch alone, so rows beyond the merged capacity were dropped silently — capacity is now checked on the merged list and each row that does not fit is reported (`list_full`, six locales) and kept in the paste box; (b) after a partial import the whole paste text stayed, so correcting a typo and retrying applied the good rows twice — only the unresolved rows now stay in the paste box; (c) the per-product 12-variant cap in `candidateTargets()` could cut off an exact variant SKU when more than 12 variants merely contain the term — exact matches are now ordered first before the cap.
7. Third Codex pass (two more P2 findings, verified and fixed with tests): (a) pasted-list parsing digit-normalised the whole line, which could rewrite a SKU that itself contains Arabic-Indic or Persian digits — only the quantity token is normalised now and the SKU reaches the server exactly as typed; (b) the paste box stayed editable while an import was resolving, so typed edits could be overwritten by the response — it is disabled while the import is in flight.
8. Fourth Codex pass (one P2, verified): pasted SKUs were truncated to 120 characters before exact resolution, although catalogue SKUs may be 255 — a longer SKU could resolve to a different product. The endpoint now accepts up to 255; the data layer never truncates, and a SKU longer than 255 (which cannot exist) is reported "not found" in its own row position.
9. Fifth Codex pass (two P2, verified): (a) merging duplicate rows clamped the sum to the 999,999 ceiling, silently reducing the order — the true sum is kept so the row shows `too_large` and blocks submit; (b) a product with an active **required personalization field** looked orderable but made the whole add fail with an unindexed 422 — lookup now reports it `available: false` with `personalization_required` (add it from its product page; six locales), and `addMany()` turns the validation failure into an indexed `quick_order_rejected` line for any client that ignores the lookup.
10. Sixth Codex pass (two P2, verified; the first was a gap in my own previous fix): (a) the API line mapper collapsed `personalization_required` into `not_purchasable`, so the buyer never saw the "add it from its product page" instruction — the reason is now preserved end to end; (b) clearing the search box while a lookup was in flight did not invalidate that lookup, so its late response repopulated the picker — the outstanding ticket is now invalidated.
11. Seventh Codex pass (one P2, verified with a failing-before test): after an ambiguous parent SKU was pasted, the picker showed all its variants, but setting the search term then fired the debounced substring search, which could shrink the choices (a variant whose SKU does not contain the parent SKU disappeared). The term change that follows an import no longer triggers a search; the exact-resolution candidates stay until the buyer edits the search.
12. Eighth Codex pass (one P2, a knock-on of fix 11, verified with a failing-before test): the 2-character minimum-search rule ran before the "keep the imported candidates" rule, so a valid one-character ambiguous parent SKU (e.g. `A`) lost its variant choices — the import rule now takes precedence.
13. Ninth Codex pass (one P2, verified with a failing-before test): choosing a variant from an ambiguous pasted parent SKU dropped the quantity typed in that row (`SHIRT 12` produced one shirt). The pasted quantity is now carried to the first variant picked from those candidates.
14. Tenth Codex pass (one P2, a knock-on of fix 13, verified with a failing-before test): after a variant was picked for an ambiguous pasted row, that row stayed in the paste box with its warning, so a retry after fixing another typo would add it again. Picking now consumes the originating row (text and warning).
4. E2E reliability only (no product change): a shared logged-in browser context broke the sign-in step of two gate tests (they now use a fresh context); cart assertions poll a fixed expected figure; the price-withdrawn test restores state with a park/restore helper instead of deleting a row.

---

## 7. Spree dependency inventory

Classification of what still exists in `storefront/` after this PR. Counts are reproducible: `pnpm check:spree-ratchet` (4/4/52/69/9) and the commands in the existing exit plan (`docs/plans/store/AWJ_SPREE_EXIT_MIGRATION_PLAN.md`).

| Area | State | Class |
|---|---|---|
| Wholesale quick order (Spree `(wholesale)/wholesale/quick-order/*`) | replaced by `/buyer/quick-order` | **Fully replaced** |
| Wholesale gate / sign-in / apply / browse / cart / product (`(wholesale)/wholesale/**`, 15 files) | replaced by `/buyer/*`, native cart, native catalogue; the layout `notFound()`s unless the Spree wholesale add-on is configured; on a native wholesale host the legacy URLs redirect 308 | **Fully replaced; dead code in production** (the add-on env is unset) — **first removal candidate (W1)** |
| Checkout routes `(checkout)/checkout/[id]`, `confirm-payment/[id]`, `order-placed/[id]` | layout `notFound()`s unless the wholesale add-on is configured; DTC checkout is the native AWJ flow | **Dead code in production** (R1 candidate, large) |
| `lib/data/{checkout,payment,orders,express-checkout-flow,credit-cards,gift-cards,addresses,countries}.ts` and Spree functions of `data/cart.ts` | only reachable from the dead routes above | **Dead code once W1/R1 land** |
| Account pages `orders`, `addresses`, `credit-cards`, `gift-cards`, `wishlist`, `payment-methods`, `profile` | still Spree-backed or gated (`ACCOUNT_AUTH` capability is `gated`) | **Legacy route still used / owner decision** — not replaced for retail customers |
| `getClient(` / `getClientForSurface(` / `withAuthRefresh(` | 14 non-test source files | **Unsafe removal candidate** until the account pages and DTC paths are replaced |
| `lib/spree/*` (config, middleware, locale, cookies) | middleware is the **live locale/country/host proxy** for every request (cookies `spree_country`/`spree_locale`) | **Unsafe removal candidate** — must be renamed, not deleted (R3) |
| `app/api/webhooks/spree` + `lib/webhooks/*` | returns 503 today; consumers unknown | **External dependency** — needs decision D-14 |
| Packages `@spree/sdk`, `@spree/cli`, `@stripe/*`, `@adyen/adyen-web`, `@paypal/react-paypal-js` | still imported by the dead checkout set and type imports | **Unsafe removal candidate** until R1 + T1/T2 |
| Naming/Docs: `name: nextjs-starter-spree`, `e2e:up` scripts, `bootstrap-spree.sh`, README, fallback "Spree Store" | cosmetic | **Safe at R4**, after R1–R3 |

Reverse-dependency note for W1 (so the deletion cannot surprise anyone): `Header.tsx`, `Footer.tsx`, `home/WholesaleSection.tsx`, `lib/spree/middleware.ts`, `(checkout)/layout.tsx`, `CartContext` (`surface`) and the `messages/*` `wholesale` namespace still reference `isWholesaleEnabled` / the group, and four test files stub it.

---

## 8. Removal-readiness decision

**Decision: Spree is not removable yet. Do not delete anything on the strength of this PR.** The Quick Order blocker is gone, so the plan's W1 slice is now the smallest safe step; it is *not* done here.

Smallest safe plan, in order (each its own PR, each reversible by `git revert`):

| Step | Scope | Gate before merge |
|---|---|---|
| **W1** | delete `(wholesale)/**`, `data/wholesale.ts`, `WholesaleSection`, header/footer wholesale links, `SPREE_WHOLESALE_*` config, `CartContext.surface`, the `wholesale` message keys; legacy `/wholesale/*` stays 404/308 as today | (1) this PR deployed and the §9 checks run on an isolated environment; (2) your explicit approval; (3) Footer/Header/CartContext tests simplified without lowering coverage; (4) ratchet baseline lowered in the same PR |
| **R1a–c** | dead checkout/payment/orders data files, then routes and components, then payment SDK packages; keep 308s for `/checkout/[id]`, `/confirm-payment/[id]`, `/order-placed/[id]` | W1 merged; analytics (AN1) events wired to AWJ checkout; payment-return suite green |
| **R2** | webhook route and handlers | decision D-14 |
| **R3** | rename `lib/spree` and the cookies with a one-release dual-read | middleware tests extended old↔new |
| **R4** | remove the SDK/CLI, config, docs, scripts, README text | all of the above; `rg -il "@spree|SPREE_"` = 0 outside LICENSE/NOTICE |
| **Account pages (S-track)** | replace retail account areas | independent of W1; required before R3/R4 |

Final gate (unchanged from the exit plan §G): zero runtime Spree calls, no `SPREE_*` required, ratchet = 0, all suites green, and a deployment verification approved explicitly by you.

---

## 9. Deployment / runtime blockers (owner)

1. **Deploy order:** API first (new routes are inert while `commerce.wholesale_buyer_enabled` is off), then the storefront. Neither is done by this PR. No migration is included.
2. Deployed SHAs, migration state, flags and mail transport on the shared environment remain **unverified from here**.
3. **AWJ Web build failure at `89f4117ca`** (closure report §4) is still unresolved without the Railway build log.
4. Wholesale must not be activated on the shared environment; the deployed browser run needs an **isolated environment** with mail delivery and trusted-proxy evidence. The suite refuses non-loopback targets by design.
5. Open commercial rules (MOQ, B2B tax, payment terms) are unchanged and not invented here.
6. Known limit, unchanged: the sign-in rate limiter for all buyers of one store shares a tenant/IP bucket until a trusted client-IP source is proven.

---

## 10. PR, SHAs and CI

- PR: #1846, branch `claude/h6-quick-order`, base `c945a1dc6505882b7de70efb172a872de440f1e6`.
- Head SHA (code): `5bdfb21a3`.
- CI: pending when this report was written; the PR page is the source of truth. If the PostgreSQL job fails only in `AiActionHistoryListTest` (a known intermittent count flake unrelated to this change), it is re-run once and noted on the PR.

## 11. Recommended final action

1. Review and merge this PR (it is inert in production: flag off, no migration, no Spree removal).
2. Deploy API then storefront to an **isolated** environment and re-run the Playwright suite against it (read-only checks first).
3. If green, approve **W1** as the next and only removal step; keep R1–R4 and the account-page replacement as separate, later approvals.
