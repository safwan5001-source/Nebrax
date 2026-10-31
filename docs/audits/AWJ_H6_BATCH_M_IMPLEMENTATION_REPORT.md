# AWJ Commerce — H6 Batch M: visitor rate limiting, partner linking and wholesale buyer account

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-m` |
| PR | __PR__ |
| Base SHA (origin/main) | `5c07d1d37d54cf27ffe4582e7dd95a40037b818a` (branched from the #1829 merge `2889dd986fb3169a8c8655677ad19c1d15b31aee`; the only commit since is #1830, web app-builder, disjoint) |
| Head SHA | __HEAD__ |
| CI | __CI__ |

**Status.** Nothing was merged, deployed or run against live data. Wholesale stays **disabled by default** (`COMMERCE_WHOLESALE_BUYER_ENABLED=false`; every new route is a uniform 404 while it is off). Spree is **not** removed. Two additive migrations; no change to accounting, POS pricing, price lists, ZATCA or any financial table.

## 0. Result in six lines

1. **P0 fixed without trusting any client address.** The shared per-IP bucket that failed the 4th page load for everyone (Batch L F01) is replaced, **for gateway-authenticated requests only**, by a per-storefront budget; direct requests, authentication brakes and the kill switch are covered by 11 adversarial tests. In a real browser the same 12-load probe now passes 12/12 (§2, §6).
2. **The trust boundary for a per-visitor limit is still not provable** from the repository or this environment (§2.3). That part stays fail-closed, with the exact operator evidence listed.
3. **Staff can now link an approved buyer to a customer** (search, link, unlink, effective price list, audit trail) with two required permissions; buyers can never assign their own partner or price list (§3).
4. **Buyers now have the account essentials:** order history and detail (own orders on this channel only), password reset, optional company/phone on the application, and a gate that states their real membership state (§4).
5. **Browser suite: 36/36 in both modes** — with the per-step limiter reset the Batch L harness needed, and with it **removed** (§6).
6. **Not claimed:** deployed behaviour (nothing deployed), per-visitor fairness, real e-mail delivery, HTTPS cookie behaviour on real domains (§7).

## 1. Root causes and what was completed

| # | Finding (source) | Root cause | Fix in this PR |
|---|---|---|---|
| P0 | 4th page load in a minute fails for **everyone**, retail included (Batch L B1/F01) | `store/v1` sits behind `EnforcePublicApiRateLimit:unauth` = 30 req/min keyed on `request->ip()`. Every storefront visitor reaches Laravel from the storefront server, so there was **one** bucket for the whole platform; a page costs 7–11 API calls | Gateway-authenticated traffic is budgeted **per storefront** (§2); direct traffic unchanged |
| P0b | Apply button stuck on "Submitting…" (Batch L) | The post-action refresh was throttled by the same bucket | Gone with P0 (browser evidence: `apply_ui_stuck_on_submitting_until_reload: false`) |
| B3 | No operator surface to link a buyer to a partner price list | `CustomerPartnerLinkService` had no caller outside tests; owner decision D-B3 was open | Staff API + web drawer panel (§3). **D-B3 is treated as approved by this batch's brief** |
| A1 | No order history / detail for native buyers (`/account` is "not available yet") | none built | `GET store/v1/buyer/orders[/{id}]` + `/buyer/orders` pages (§4.1) |
| A2 | No buyer password reset | none built | `auth/password/forgot|reset` + pages (§4.2) |
| A3 | Application captured no company/phone | none | Optional unverified fields on the membership (§4.3) |
| A4 | A **suspended** buyer was told "not approved yet" (Batch L finding) | the 403 carried no state | 403 now carries the buyer's own `membership_status`; the gate words itself truthfully (§4.4) |

## 2. P0 — visitor rate limiting

### 2.1 Topology inspected (evidence)

| Fact | Evidence |
|---|---|
| Storefront (Next) is the only caller of `store/v1` in production; it forwards only `X-Storefront-Forwarded-Host` + `X-Storefront-Gateway-Secret` (+ buyer token / cart cookie); **no client address** | `storefront/src/lib/commerce/config.ts` |
| Laravel does not trust forwarding headers: `request->ip()` = `REMOTE_ADDR`, no `trustProxies` (deliberate: it would touch Host/scheme resolution) | `app/Support/EdgeScheme.php`, Batch H record |
| The gateway secret proves the **sender is the storefront server**, not the visitor's address | `ResolveStorefrontDomain`, `RequireStorefrontMutationGateway` |
| The anonymous class is `unauth` = 30/min per IP and covers **every** `store/v1` read **and** write, including login | `routes/api_storefront.php`, `PublicApiRateLimits` |
| Real-browser measurement (Batch L F01, re-run here): before the fix loads 1–3 succeed and 4–12 fail for retail and wholesale alike | `evidence-desktop-en.json` F01 |
| Deployment evidence for Vercel/Railway/CDN chain | **absent** (Batch H/I decision records stand) |

### 2.2 What was implemented (and why this is not a speculative IP fix)

`EnforcePublicApiRateLimit` now chooses a **budget** per request:

- **Gateway-verified** request (the gateway secret matched in `ResolveStorefrontDomain`, which alone sets the server-side attribute `storefront_gateway_verified`; never derived from a header the client can choose) **and** a resolved storefront ⇒ budget keyed `pubapi:gw:{read|write}:{tenant}:{storefront}` with `storefront.gateway_limits.read_per_minute` (default **600**) / `write_per_minute` (default **120**). One store can no longer exhaust another store's, nor the direct, budget.
- **Everything else** (no secret, wrong secret, `ApiClient`, any other class) ⇒ exactly the previous `unauth` 30/min per connection IP.
- **`STOREFRONT_GATEWAY_READ_LIMIT=0` / `…_WRITE_LIMIT=0`** restores the legacy shared bucket **exactly** (kill switch; tested).
- **No client IP header is read anywhere.** `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP`, `True-Client-IP`, `X-Client-IP`, `X-Storefront-Client-Ip`, `X-Originating-IP` are all inert (tested with rotating values).
- **Authentication endpoints keep their own brakes untouched:** login 5/min per **account** + 20/min per tenant/IP; register, verify, resend, apply, and the new reset limiters. The write budget does not replace them.

### 2.3 What is deliberately still NOT solved, and why (fail-closed)

A **per-visitor** brake (an abusive visitor throttled without affecting honest ones) needs the visitor's real address *as the storefront server received it*, and that depends on the unverified edge chain (Vercel vs Railway vs CDN, hop count, append-vs-overwrite). A signed gateway→backend header would only prove the *sender*, not that the value is true (Batch I addendum §1). Nothing in this environment can observe that chain, so **no visitor identity is trusted**. Consequences, stated plainly:

- **One abusive visitor can consume their store's gateway budget** (600 reads / 120 writes per minute) and cause 429s for that store's other visitors for the rest of the minute. This is bounded to **that store** (previously: the whole platform) and to a rate an abuser needed 30/min to reach before.
- The per-tenant login brake (20/min) is **still shared by every buyer of a tenant** (documented limitation, pinned by `StorefrontClientIpBoundaryTest`; also felt by the browser suite, which waits out `Retry-After` like a real client).
- The default 600/120 is a **policy number**, not a measured capacity: it is an env setting (CLAUDE.md rule 6) the owner can tune or zero.

**Exact operator evidence that would unlock a per-visitor limit** (unchanged from Batch I §5, restated): (1) which service actually answers `https://<store host>` in production and whether any CDN/WAF precedes it; (2) the values the storefront server really receives for `x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for` from two networks, with and without a forged `X-Forwarded-For: 1.2.3.4`; (3) the hop count / overwrite-vs-append result recorded in a dated note under `docs/audits/`; (4) the owner's choice of source setting. Only then implement the signed-visitor design in the Batch I addendum §4.

### 2.4 Adversarial tests (`tests/Feature/StorefrontGatewayRateLimitTest.php`, 11)

many visitors behind one gateway (120 reads, rotating forged addresses) all succeed · forged headers neither grant a bucket nor raise the cap · a malicious high-volume client stopped at the store budget (50 ok / 30 × 429 with `Retry-After`) · store A's abuse leaves store B untouched · direct requests keep 30/min per IP and a fresh address gets its own · invalid secret is treated as direct (never reaches the gateway budget) · direct abuse cannot consume the gateway budget and vice versa · reads and writes are separate budgets · kill switch restores the legacy bucket exactly · per-account (5) and per-tenant (20) login brakes still bite long before the store budget · response header advertises the **effective** limit, not a client value. Existing `StorefrontClientIpBoundaryTest` (7) and `PublicApiRateLimitTest` (8) pass **unchanged**.

## 3. Phase 2 — staff partner linking

Reuses `CustomerPartnerLinkService` (the single writer: row locks, eligibility, one active link per identity, `customer_access.manage` re-check). New thin layer `WholesalePartnerLinkAdminService` + `CommerceStaffWholesalePartnerLinkController`:

| Route | Purpose |
|---|---|
| `GET commerce/wholesale/partners/eligible?q&limit` | active customer partners of this tenant (name/code/phone/email search, wildcards escaped); no credit/VAT fields |
| `GET commerce/wholesale/memberships/{id}/partner-link` | active link, **history (audit)**, and the **effective price list** |
| `PUT …/partner-link` `{partner_id}` | link (approved buyer only; same partner idempotent; another active link ⇒ 409 `already_linked`) |
| `DELETE …/partner-link` | unlink (any membership status, so a suspended buyer's special price can be removed) |

- **Authorization:** `commerce.wholesale.manage` **and** `customer_access.manage` (owner/admin via `*`; each alone is refused — tested), `EnsureApplicationActive:commerce.storefront`, deployment flag (404 while off). Buyers reach none of it (a buyer token on these routes ⇒ 401/403).
- **Isolation:** every query is tenant-scoped; another tenant's membership/partner is a plain 404; a membership on a non-wholesale channel is 404.
- **Effective price list** comes from the new `WholesalePriceAuthority::describeFor()`, which reuses the two private methods the real pricing precedence uses — so the staff screen cannot drift from what actually prices the buyer (partner list → channel list → none; inactive list falls through; verified by a test that deactivates the partner list).
- **Audit trail:** the existing `customer_partner_links` rows (`linked_by`, `linked_at`, `revoked_by`, `revoked_at`); revoked links are kept. No new audit table was needed.
- **Never touched:** `partners`, `price_lists`, `price_list_items`, POS `apply_customer_price_list` (a test snapshots all three before/after link+unlink).
- **Web (`web/…/sections/buyers`)**: the "unavailable / D-B3" placeholder is replaced by `PartnerLinkPanel` in the buyer drawer (effective list, active link, debounced customer search, link, confirm-then-unlink, history), hidden controls + explanation without both permissions, RTL/AR + EN. The membership list shows the linked customer; the drawer shows the buyer's application company/phone as *unverified context*.

## 4. Phase 3 — buyer account

### 4.1 Order history and detail
`GET store/v1/buyer/orders` (paged, 25 default, `per_page` validated ≤ 50) and `GET buyer/orders/{uuid}` behind `EnsureWholesalePriceAccess` (token + channel binding + **approved** membership re-checked each request; also establishes `CustomerContext` from the verified token). Ownership = `CommerceOrderService::ownedOrders()` (the same source `/commerce/v1/me/orders` uses) **plus** this channel. Another buyer's order, another channel's order (same identity), a malformed id and a missing order are **the same 404**. Output reuses the approved public `CommerceOrderSerializer` — tests assert no invoice/journal/partner/price-list/cost/ledger/tenant/identity fields leak.
A suspended or rejected buyer gets 403 exactly like the catalogue (history is price-bearing).
Storefront: `/buyer/orders`, `/buyer/orders/[id]` (list, empty, not-found, unavailable, gate states), linked from the membership page.

### 4.2 Password reset
Mirrors the approved e-mail-verification design in its **own table** (`customer_password_reset_tokens`): only SHA-256 stored; 60-min TTL (`COMMERCE_BUYER_PASSWORD_RESET_TTL_MINUTES`) and single-use; bound to tenant **and** channel from the Host-resolved contexts; link host = the store's own verified domain (never a request header; only a strict `/xx/yy` locale prefix is client-influenced); mail through the existing transport after the response; a new token retires old ones only after the mail is handed to the transport.
`POST auth/password/forgot` is a neutral **202** for unknown / inactive / unverified / cooling-down / eligible alike (tested: identical bodies); `POST auth/password/reset` is one generic 422 for wrong / expired / used / other-tenant / other-channel tokens, and a failed attempt **never consumes** the token. Completing it changes the password, **ends every session of the identity on every channel**, issues no token (no auto-login) and **does not verify the e-mail**. A verification token cannot reset a password and a reset token cannot verify an e-mail (separate tables; tested both ways). Limiters: per account 3/min + per tenant/IP 20/min for requests; per tenant/IP 30/min for consumption. Pages `/buyer/forgot-password`, `/buyer/reset-password` (no token consumed while rendering; `referrer: no-referrer`; local length/confirm validation before the token is spent).

### 4.3 Company and phone on the application
Optional `company_name` (≤150) and `contact_phone` (validated) on **`wholesale_memberships`** — deliberately **not** on the buyer identity, because `customer_identities.phone` feeds phone-OTP login and an unverified application phone must never land there. Stored on first application only; shown to staff as *unverified context*; used for nothing else. `BuyerApplyRequest` **refuses** `partner_id`, `price_list_id`, tenant/channel/identity ids with 422 (other unknown fields such as `status` keep being ignored, exactly as before).

### 4.4 Membership states
The buyer-facing 403 now carries `details.membership_status` (`none|pending|rejected|suspended`) — the buyer's **own** state only (they can read it at `wholesale/membership` anyway). The storefront gate shows: *Apply for wholesale access* / *Application under review* / *Not approved* / *Account suspended* instead of "not approved yet" for everyone. All six storefront locales carry the 53 new keys (`pnpm check:locales` green).

## 5. Security decisions

| Decision | Reasoning | Evidence |
|---|---|---|
| No IP header is trusted anywhere | trust boundary unprovable here | 8 header families tested inert |
| Per-storefront gateway budget instead of per-visitor | proves only what is provable: sender + store | `StorefrontGatewayRateLimitTest` |
| Direct traffic stays 30/min per IP | brute-force/API-abuse protection preserved | direct-limit tests |
| Credential brakes untouched | account-based throttling is the real brute-force control | 5/20 login tests; reset limiter tests |
| Kill switch `0` = legacy behaviour | reversible, owner-controlled policy | tested |
| Link needs two permissions | review right ≠ right to change prices | RBAC test (each alone refused) |
| Link only for approved buyers; unlink always | no special price for a buyer who cannot buy; removable when suspended | tests |
| Buyer can never send partner/price list | pricing authority stays staff-only | `BuyerApplyRequest` 422 + tests |
| Reset in its own token table; never verifies e-mail; ends all sessions | purposes separated structurally; takeover recovery | tests both directions |
| Order history = approved only, own + this channel, one 404 | IDOR-proof and consistent with catalogue | `WholesaleBuyerAccountTest` |
| Application phone stays off the identity | OTP login must not trust unverified data | test |

## 6. Verification

### 6.1 Automated
| Suite | Result |
|---|---|
| New backend: `StorefrontGatewayRateLimitTest` 11 · `WholesalePartnerLinkStaffApiTest` 12 · `WholesaleBuyerAccountTest` 13 | all pass (SQLite) |
| Related existing: `StorefrontClientIpBoundaryTest`, `PublicApiRateLimitTest`, `WholesaleBuyerFoundationTest`, `BuyerEmailVerificationTest`, `WholesalePricePrecedenceTest`, `CommerceModuleBoundaryTest` | pass |
| Full backend, SQLite | All classes pass in two chunked lanes except the `Fuel*` classes, which fail only locally on the missing `ext-bcmath` (`Call to undefined function App\Services\bcmul()`; CI installs it). `WholesalePriceSurfaceBoundaryTest` initially failed on the four new unclassified routes and was fixed (8/8). A transient `ImportJob*` failure was a shared-SQLite-file corruption from concurrent lanes and passes on a fresh database. |
| Backend, PostgreSQL (focused + concurrency) | Batch M + wholesale/storefront-buyer/boundary classes: 135 passed (1559 assertions). Wider slice (`Wholesale\|StorefrontBuyer\|CustomerPartnerLink\|CommerceStaffWholesale\|PublicApiRateLimit\|BranchIsolationGuard\|Migration`): 286 passed, 1 skipped (2263 assertions). |
| Storefront: `tsc --noEmit` | clean |
| Storefront: Biome | unchanged baseline (5 warnings / 3 infos, none in touched files) |
| Storefront: vitest (full) | 252 files passed, 16 skipped; **3,604 tests passed** |
| Storefront: `pnpm check:locales` | six locales in sync |
| Storefront: `pnpm build` | exit 0 (production build used by the browser run) |
| Storefront: Spree ratchet | at baseline |
| Staff web (`web/`): wholesale module vitest | 32 files / 206 tests passed |

### 6.2 Browser (real Chromium, real API, throwaway DB, payment capture off — `evidence-*.json`, screenshots in `docs/audits/assets/h6-batch-m/`)
Run twice on freshly seeded stacks, **36 passed each time**:
- **with** the Batch L per-step limiter reset: 36/36;
- **without it** (`E2E_NO_BUCKET_RESET=1`): **36/36** — the suite no longer needs the harness workaround.

| Evidence | Result |
|---|---|
| **F01** (the Batch L blocker) | 12 consecutive page loads, anonymous retail **and** signed-in wholesale buyer: **12/12 ok, first failed load = none** (before: 4th failed) |
| Apply → Pending | 0.9 s, `apply_ui_stuck_on_submitting_until_reload: false` |
| Gate wording | no application → "Apply for wholesale access"; applied → "under review"; suspended → "Your wholesale account is suspended" (and the page does **not** contain "has not been approved yet") |
| Application context | company + phone typed in the browser reached the reviewer via the staff API, as context only |
| **13b** partner link | staff links the buyer → listing shows **5.00** (was 7.00); unlink → **7.00**; history keeps who linked/unlinked |
| **13c** order history | the buyer's single order listed, detail shows the 7.00 + 9.00 lines and the not-paid note; another buyer's order id ⇒ not-found state with no data |
| **C10** | duplicate submit ⇒ exactly one more order; another buyer gets **404** on both the old (`payment-status`) and new (`buyer/orders/{id}`) reads and does not see it in their list |
| **G01** password reset | neutral forgot for known/unknown address; mailed link host = channel host; new password works, old refused, link single-use, a pre-reset session token answers **401** after the reset |
| **E01–E03** mobile Arabic | RTL, **0 px** overflow on gate/sign-in/register, populated cart/checkout, forgot, reset (no-token), and order history |
| Batch L C01–C11, D01–D02 | unchanged results (cross-tenant/channel, forged headers, price injection, duplicate checkout, DTC) |

**Harness change (disclosed):** the browser suite's `login()`/`signIn()` now wait out a `429 Retry-After` like a real client, because the per-tenant login brake (20/min) is compressed by a test run; and the staff (ERP) login token is cached for the run because that endpoint is throttled at 5/min.

## 7. Remaining blockers and unverified items

| ID | Item | State |
|---|---|---|
| B2 | **No deployed evidence.** Nothing was deployed; revisions of any deployed API/storefront still unknown | open — needs owner authorization (Batch N) |
| D-T1 | Per-visitor limiting; operator proxy-chain evidence (§2.3) | open — operator |
| L1 | Per-tenant login brake (20/min) is shared by all buyers of a tenant; one abusive visitor can burn a store's gateway budget | documented residual |
| L2 | Footer/header "My Account / Order History" on a native wholesale host still point at the unavailable Spree-era `/account`; the new `/buyer/*` pages are linked from the membership page only | open — small storefront-nav slice |
| L3 | Real e-mail delivery (Resend/domain/SPF/DKIM) never exercised — the app's `log` transport was used for reset and verification | operator |
| L4 | HTTPS-only behaviour of the `Secure` buyer cookie on real domains; non-Chromium browsers | not tested |
| L5 | Quick order by SKU, saved addresses, reorder, buyer profile edit | not built (Spree-parity gaps) |
| L6 | MOQ, minimum order, B2B tax display, payment terms/credit/COD | owner decisions (unchanged from Batch L §8) |
| L7 | The payments-section placeholder in the staff workspace that cites D-B3 for a *credit* link is untouched (a different capability) | open |

## 8. Spree dependency counts (`pnpm check:spree-ratchet`, at baseline — **no growth**)

`spree_value_imports=4 · spree_type_imports=4 · spree_client_access=52 · spree_wrapper_imports=69 · spree_env_reads=9`. The new buyer pages import nothing from `@spree/*`/`lib/spree` (the architecture test now covers 7 more files). Residual Spree cookies (`spree_country`, `spree_locale`) and the legacy `/wholesale/*` soft-404 are unchanged from Batch L.

## 9. Modified files

**Backend (new):** `StorefrontBuyerOrderController`, `CommerceStaffWholesalePartnerLinkController`, `WholesalePartnerLinkAdminService` (+ exception), `BuyerPasswordResetService`, `CustomerPasswordResetToken`, `BuyerPasswordResetMail` + view, `BuyerApplyRequest`, `BuyerForgotPasswordRequest`, `BuyerResetPasswordRequest`, migrations `2026_12_21_010000_add_application_details_to_wholesale_memberships` and `2026_12_21_020000_create_customer_password_reset_tokens`.
**Backend (changed):** `EnforcePublicApiRateLimit`, `ResolveStorefrontDomain` (server-side flag), `EnsureApprovedWholesaleBuyer` (state in 403), `StorefrontBuyerAuthController` (reset + generic after-response helper), `StorefrontWholesaleController`, `WholesaleMembershipService::apply` (+details), `WholesaleMembership` (fillable), `WholesalePriceAuthority::describeFor`, `CommerceStaffWholesaleMembershipController` (partner-link summary + application context), `TenancyServiceProvider` (2 limiters), `routes/api.php`, `routes/api_storefront.php`, `config/storefront.php`, `config/commerce.php`.
**Storefront:** order list/detail views + pages, forgot/reset forms + pages, `BuyerMembershipPanel` (company/phone, orders link), `BuyerSignInForm` (forgot link), `CatalogAccessGate` (truthful states), `ProductListing` + PDP (pass the state), `lib/commerce/wholesale-buyer.ts`, `lib/data/wholesale-buyer.ts`, six `messages/*.json`.
**Staff web:** `partner-link-panel.tsx` (new), `api.ts`, `membership-sheet.tsx`, `buyers-section.tsx`, `messages.ts`.
**Tests (new):** 3 backend files (36 tests), `buyer-orders.test.ts`, `buyer-account-ui.test.tsx`; **E2E:** `wholesale-buyer-journey.spec.ts` (36 tests), seed (`resettable` buyer, `partner_id`), docs screenshots; `CLAUDE.md` (a Batch M section).

### Existing tests changed (disclosed — none weakened)
- `CommerceModuleBoundaryTest`: the route allow-list gains the two new staff routes (it exists to force exactly this).
- `buyers-section.test.tsx` (web): the test asserting the **placeholder** "partner linking unavailable" is replaced by five tests of the real feature; `mockServer` learns the partner-link routes.
- `lib/data/__tests__/wholesale-buyer.test.ts`: the mocked `StorefrontApiError` gains an optional `details` argument (additive).
- `wholesale-buyer-ui.test.tsx`: a type cast widened (`as unknown as`) because the gate messages gained a nested `membership` object.
- `wholesale-buyer.architecture.test.ts`: seven new files added to the guarded list (stricter, not looser).
- E2E spec: F01 flips from "characterize the failure" to "assert 12/12 succeed"; steps 06/14 assert the truthful gate wording; C10 counts a delta (the journey now places an extra order).

**Behaviour changes to be aware of:** `POST wholesale/application` now returns 422 for `partner_id`/`price_list_id`/tenant/channel/identity fields (previously silently ignored); the wholesale 403 body gains `error.details.membership_status`.

## 10. Recommended Batch N

1. **Authorized Beta deployment + this suite unchanged on it** (closes B2; capture the real proxy chain for D-T1 in the same visit; decide per-visitor limiting from evidence).
2. **Storefront navigation for native buyers:** point the footer/header account and order-history links at `/buyer/*` on wholesale hosts (L2) and hide the Spree-era account entry there.
3. **Real e-mail:** configure and verify the sending domain; run verification + reset mails end to end (L3).
4. **Owner decisions** needed before any further commercial work: MOQ / minimum order, B2B tax display, terms/credit/COD (L6).
5. Then, slice by slice, the Spree-exit candidates from the Batch L report (§6.3), starting with quick order by SKU (L5) if the owner wants parity rather than a waiver.
