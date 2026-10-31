# AWJ ERP — Native Retail Customer Accounts (B2C) — Implementation Report

| | |
|---|---|
| **Task** | Replace the storefront "Customer accounts are currently unavailable" screen with working AWJ-native retail customer accounts |
| **Repository** | `safwan5001-source/Nebrax` |
| **Branch** | `feat/b2c-customer-accounts` |
| **PR** | __PR_URL__ |
| **Base** | `origin/main` @ `ddd5e76f2b385f908667e3c94d4482bbfabc8d7c` |
| **Head SHA (code)** | __HEAD_CODE__ |
| **Head SHA (PR head, incl. this metadata commit)** | __HEAD_PR__ |
| **Status** | Built and verified locally. **Closed by default** (deployment flag + per-channel flag). Not merged, not deployed, not activated, no remote migrations run. **Stopped for review.** |

---

## 1. What was built

Native retail shopper accounts on the Host-resolved `store/v1` storefront API and the `storefront/` Next.js app, reusing the existing AWJ identity stack (`CustomerIdentity` + Sanctum `customer:access` tokens bound to `store-channel:{id}`, `CustomerContext`, the buyer e-mail-verification and password-reset services, the owner-scoped address and order services). **No parallel authentication system, no Spree.**

| Requirement | Result |
|---|---|
| 3. Register / login / logout / password reset | `auth/register`, `auth/verify-email`, `auth/verification/resend`, `auth/login`, `auth/logout`, `auth/password/forgot|reset` on retail hosts; storefront pages `/account`, `/account/register`, `/account/verify`, `/account/forgot-password`, `/account/reset-password` |
| 4. Persistent, secure, revocable sessions | "Keep me signed in" → 30-day server token + persistent HttpOnly cookie; off → 1-day token + browser-session cookie. Revoked by logout, "end session", "sign out other devices", password change (keeps the current one), password reset (ends all) |
| 5. Profile + delivery addresses | `account/profile` (name, phone; e-mail read-only), `account/password`, `account/addresses` CRUD (Saudi National Address shape, default shipping) |
| 6. Order history + detail, server-side ownership | `account/orders`, `account/orders/{id}` — owner from the verified session + the host's channel; foreign / other-channel / missing id → one identical 404 |
| 7. Guest shopping preserved | Guest cart/checkout/payment routes unchanged; a bad/absent/foreign token is a plain guest request |
| 8. Guest-order linking only via a verified process | `POST account/orders/claim` (§3) — explicit, proof-gated, audited, once |
| 9. Mobile-first Arabic RTL + English LTR | New `retailAccount` message namespace (ar + en; logical CSS properties only; LTR phone/digit fields; Arabic-Indic digit normalisation); verified in a real browser at 390 px RTL and 1280 px LTR |
| 10. Unavailable screen replaced | `AccountsGate`: the API's per-host answer decides — accounts open ⇒ working flows; closed ⇒ the same honest notice as before (fail closed) |

### Architecture in one picture

```
Browser ──(Server Action, same-origin, SameSite=Lax cookie)──▶ Next.js server ──(gateway secret + X-Customer-Token)──▶ Laravel store/v1
   HttpOnly awj_account_session                                    lib/data/customer.ts                                     RetailAccountGate → AuthenticateCommerceCustomer
   JS-readable awj_account_hint=1 (presence only, no secret)       never returns token / upstream text                        → BindStorefrontBuyerToChannel → EstablishCustomerContext
```

### Gates (all default **closed**)

* `config('commerce.retail_accounts_enabled')` (env `COMMERCE_RETAIL_ACCOUNTS_ENABLED`, default `false`) **and**
* `sales_channels.customer_accounts_enabled` on the Host-resolved **web** channel (staff setting via `SalesChannelSettingsService`, audited, refused while the deployment flag is off; DB-level model guard: web channels only).
* Either missing ⇒ every account/identity route is the uniform `404`; `GET store/v1/storefront` announces `capabilities.customer_accounts` (boolean only) so the storefront can fail closed.
* Opening retail does **not** open wholesale and vice versa: `auth/*` + `me` sit behind `EnsureBuyerIdentityEnabled` (wholesale **or** retail); `wholesale/*` and `buyer/*` stay behind `EnsureWholesaleBuyerEnabled` alone.

---

## 2. Changed files

### Backend (Laravel)

| File | Change |
|---|---|
| `database/migrations/2026_12_23_010000_add_retail_customer_accounts.php` | **New.** `sales_channels.customer_accounts_enabled` (default false); append-only `commerce_order_ownership_claims` (unique per order); `down()` refuses while claims exist |
| `app/Services/Commerce/RetailAccountGate.php` | **New.** The one definition of "retail accounts open on this host" |
| `app/Http/Middleware/EnsureBuyerIdentityEnabled.php`, `EnsureRetailAccountsEnabled.php` | **New** gates |
| `app/Http/Middleware/EstablishRetailCustomerIfPresent.php` | **New.** Optional identity on cart/checkout routes (never blocks; inert on closed hosts and wholesale channels) |
| `app/Http/Controllers/Api/StorefrontAccountController.php` | **New.** profile, password, sessions, claim (strict bodies, identity from token only) |
| `app/Services/Commerce/CommerceOrderOwnershipClaimService.php`, `app/Models/CommerceOrderOwnershipClaim.php` | **New.** The only NULL→identity path for an order's owner |
| `app/Models/CommerceOrder.php` | Immutability rule kept; one narrow sanctioned transition (`attachOwnerAfterVerifiedClaim`) |
| `app/Http/Requests/BuyerLoginRequest.php` | **New** (`remember`) |
| `app/Http/Controllers/Api/StorefrontBuyerAuthController.php` | login: retail-only hosts honour `remember`; wholesale TTL unchanged |
| `app/Services/CustomerAuthenticationService.php` | optional `$ttlDays` (default behaviour identical) |
| `app/Services/Commerce/BuyerEmailVerificationService.php`, `BuyerPasswordResetService.php`, `app/Mail/Buyer*Mail.php`, `resources/views/emails/buyer-*.blade.php` | E-mail links land on `/account/*` on retail hosts (`/buyer/*` unchanged where wholesale is open); neutral (non-wholesale) wording for shoppers |
| `app/Http/Controllers/Api/StorefrontConfigController.php` | `capabilities.customer_accounts` |
| `routes/api_storefront.php` | Identity group split; `account/*` group; `EstablishRetailCustomerIfPresent` on cart/checkout |
| `app/Providers/TenancyServiceProvider.php` | rate limiters `storefront-account-write|password|claim` (keyed by identity) |
| `app/Models/SalesChannel.php`, `SalesChannelSettingsService.php`, `CommerceStaffChannelSettingsController.php`, `config/commerce.php` | flag, staff setting, config |
| `CLAUDE.md` | project doc section |

### Storefront (Next.js)

| Area | Files |
|---|---|
| Session / actions | `src/lib/account/account-session.ts` (new), `session-cookies.ts`, `src/lib/data/customer.ts` (rewritten), `src/lib/commerce/account.ts` (new), `config.ts` (server-held token on cart requests), `storefront.ts` (+`customerAccounts`), `capabilities.ts`, `src/contexts/AuthContext.tsx`, `src/lib/proxy/storefront-proxy.ts` (`/account/verify` public) |
| Screens | `AccountsGate`, `AccountSignIn`, register / forgot / reset pages, **new** `/account/verify`, `AccountProfileForm` (+password), `AccountSessionsPanel` (new), `AccountAddresses` (live), `AccountOrdersView` (list, detail, claim form), `OrdersUnavailable`, orders pages, `account-nav.ts` |
| i18n | `messages/{ar,en,de,es,fr,pl}.json` (+`retailAccount`, 83 keys) |
| Tests | see §3 |
| E2E | `e2e/retail-accounts-journey.spec.ts`, `e2e/support/retail-accounts-e2e-seed.php`, `scripts/e2e/retail-accounts-stack.sh`, `playwright.retail-accounts-e2e.config.ts` (default config ignores the stack-bound spec) |

---

## 3. Guest-order → account linking (the ownership process)

`POST store/v1/account/orders/claim { order_number, order_reference? }` — authenticated, retail-gated, throttled (10/min, 60/h per account).

1. Identity: active + **verified e-mail** (login already requires it) + same tenant.
2. Order: same tenant **and the host's channel**, `confirmed`, `customer_identity_id IS NULL`, locked `FOR UPDATE`.
3. **Proof — one of:** (a) the signed order reference (`CommerceOrderReference`, bound to tenant|channel|order) **or** (b) the account's verified e-mail equals the e-mail the order was placed with. The order snapshot's e-mail alone authorises nothing.
4. Success: `attachOwnerAfterVerifiedClaim` + an immutable `commerce_order_ownership_claims` row (`proof` recorded); unique index per order ⇒ at most one claim ever. Already mine ⇒ idempotent 200.
5. **Every** failure (unknown number, other tenant/channel, draft, already owned by someone else, wrong/foreign reference, e-mail mismatch) ⇒ one identical `404` — the endpoint is not an order-number oracle.

No automatic linking exists anywhere. Orders placed while signed in are owned from creation through the existing `CustomerContext` mechanism (`EstablishRetailCustomerIfPresent`), not through a claim. `CommerceOrder::booted()` still forbids every other owner change (reassign, clear, bare `save()`), asserted by test.

---

## 4. Verification

### 4.1 Backend — SQLite and PostgreSQL

| Suite | SQLite | PostgreSQL 16 |
|---|---|---|
| `RetailCustomerAccountsTest` (19 tests, 239 assertions — gates, register/verify/login/logout, remember-me TTLs, channel binding, sessions, password change/reset, profile, address IDOR, order IDOR, claim proofs, signed-in checkout ownership, immutability, rate limits, staff switch) | ✅ | ✅ |
| `RetailOrderClaimPostgresConcurrencyTest` (6 forked processes, 3 identities, one order ⇒ exactly one owner + one audit row) | skipped by design (needs PG) | ✅ |
| Wholesale regression: `WholesaleBuyerAccountTest`, `WholesaleBuyerFoundationTest`, `BuyerEmailVerificationTest`, `StorefrontWholesaleCapabilityTest`, `WholesalePriceSurfaceBoundaryTest`, `StaffChannelPricingSettingsTest`, `CommerceCustomerAuthApiTest`, `StorefrontGatewayRateLimitTest` | ✅ | ✅ |
| Full `php artisan test` | __FULL_SQLITE__ | — (CI matrix) |

Two **existing guard tests were updated, deliberately** (they exist to force a decision on every new surface): `WholesalePriceSurfaceBoundaryTest` (new `account.*` routes classified *reviewed, no channel price*) and `StorefrontWholesaleCapabilityTest` (capabilities payload is now `{wholesale_buyer, customer_accounts}`).

> Local environment note: `bcmath` is not installed in this sandbox (the setup script warns about it), so the 26 `Fuel*` tests that call `bcmul` error here independent of this change; CI installs it.

### 4.2 Storefront

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ exit 0 |
| `biome check` (src, e2e, messages) | ✅ 0 errors (no warnings added) |
| `pnpm check:locales` | ✅ all 6 locales in sync |
| `vitest run` | ✅ 248 files / 3602 tests passed (16 skipped, pre-existing) |
| `pnpm build` (production) | ✅ |
| New unit tests | `customer.test.ts` (24: cookie flags, remember-me, no token/upstream-text leak, closed-host refusal, id validation, claim/address bodies), `AccountOrdersView.test.tsx`, rewritten `AccountAddresses`, `AccountAuthGate.architecture`, `AccountAuthUnavailable`, `AuthContext*` (no request without the hint), `storefront.test.ts` (capability fail-closed) |

### 4.3 Real-browser E2E (Playwright + real Laravel, throwaway SQLite, production `next start`)

`scripts/e2e/retail-accounts-stack.sh up` → `playwright test --config=playwright.retail-accounts-e2e.config.ts` — **14/14 passed**.

**Mobile Arabic RTL (390×844, `ar-SA`), 13 serial steps:** closed host shows the notice with no credential field · RTL + no horizontal overflow · register → neutral "check your email" → unverified cannot sign in · mailed link verifies, replay refused · sign-in with *keep me signed in*: cookie `HttpOnly`, `SameSite=Lax`, expiry > 25 days, not readable from `document.cookie`, hint cookie JS-readable and value `1` · **browser restart** (session cookies dropped, persistent kept) ⇒ still signed in · profile edit with Arabic-Indic phone digits · address add (Arabic-Indic digits) / edit / delete · guest order via API → neutral claim failure for a wrong number → verified-email claim → order listed and detail opens · **second customer: cannot open the order URL (same not-found state as a nonexistent id), cannot claim it, cannot claim a third party's guest order** · sessions panel · change password + forgot/reset by e-mailed link (old sessions ended) · non-persistent login is a session cookie and does not survive a restart; **sign-out revokes the token at the API (`/me` 200 → 401)**.
**Desktop English LTR (1280):** `dir=ltr`, sign-in / register / verify render on the open host, notice on the closed host.

Screenshots: `docs/audits/assets/b2c-accounts/` (`mobile-ar-*`, `desktop-en-*`).

### 4.4 CI

__CI__

---

## 5. Security findings

### Controls verified (by test)

* **Tenant + storefront isolation:** identity token must be minted for *this host's channel* (replay on another store of the same tenant ⇒ 401); a wholesale-host token never reaches `account/*`; a same-e-mail identity in another tenant is a different person.
* **IDOR:** addresses (update/delete by another customer ⇒ same response as a missing id; list never leaks), orders (other customer's / other channel's / missing ⇒ identical 404), sessions (other account's or other store's token id ⇒ 404), claim (uniform 404).
* **Mass-assignment:** every account body is `rejectUnknown`; `tenant_id`, `customer_identity_id`, `email`, `email_verified_at`, `is_active`, `id` ⇒ 422. Storefront actions allow-list their bodies.
* **Enumeration:** register / forgot / resend are neutral 202; login failures are indistinguishable (unknown, wrong password, unverified, inactive); profile phone conflict is a generic 422; the e-mail link host is the store's own verified domain, never a request header.
* **Sessions:** new random token per login (no fixation); logout/revoke are server-side; password change and reset end the other sessions; expired/revoked token ⇒ 401 and the storefront clears its cookies; token never in a URL, body, log, `localStorage`, or a JS-readable cookie.
* **CSRF:** all mutations are Next.js Server Actions (framework same-origin check, POST-only) with a `SameSite=Lax` cookie; the Laravel API is never called from a browser, only server-to-server with the gateway secret + `X-Customer-Token`, so there is no ambient credential for a cross-site request.
* **Rate limits:** existing per-address and per-tenant/IP limiters on register/login/verify/resend/forgot/reset; new per-identity limiters on account writes (30/min), password change (5/min) and claim (10/min, 60/h).
* **Wholesale untouched:** wholesale buyer login keeps its 7-day token and response shape (only an additive `session_days: null`); `wholesale/*`, `buyer/*`, price-visibility middleware, quick-order and the price authority are unmodified; the existing wholesale suites pass unchanged.
* **Checkout / payment / accounting contracts:** no change to `CommerceOrder` totals, snapshots, payment intents, postings, invoices, ledger, inventory or ZATCA. The only order-model change is the audited NULL→owner transition above.

### Residual findings / risks (none blocks the PR; items 1–3 block *activation*)

| # | Finding | Severity | Note |
|---|---|---|---|
| 1 | **Shared tenant/IP login & register bucket.** Every shopper reaches Laravel from the storefront server's IP, so `storefront-buyer-login` (20/min per tenant+IP) and `…-register` (10/min) are effectively *store-wide* ceilings. The per-e-mail limit stays effective, but at B2C volume the shared bucket throttles real shoppers and is a cheap lock-out DoS | **High for activation** | Pre-existing design (CLAUDE.md "Batch M", D-T1 open). Needs a gateway-signed client-IP header honoured only when `storefront_gateway_verified` (an owner decision — not guessed here) |
| 2 | **Verification/reset delivery in production** depends on the configured mail transport and sender domain; E2E used the app's `log` transport | **High for activation** | Confirm Resend/domain for the tenant before switching on |
| 3 | Non-market locale files (`de/es/fr/pl`) carry the **English** text for the new namespace (key parity satisfied; AWJ markets are ar/en) | Low | translate before those locales are enabled for any market |
| 4 | COD / pickup orders have **no** inline order reference (it is returned only when online checkout is enabled), so for them the proof is the verified e-mail only; a guest who used a different e-mail cannot link after the fact | Low (by design) | Orders placed while signed in need no claim |
| 5 | Order numbers are sequential; protected by proof + per-account throttle + uniform 404, but not secret | Low | — |
| 6 | Password policy is the platform's (≥ 8 chars, no breach check) | Low | consistent with existing identity |
| 7 | Fixed expiry, no sliding renewal: after 30 days the shopper signs in again | Info | deliberate (revocation-first) |
| 8 | E-mail change is not offered (it is the login identifier) | Info | needs a verified-change flow |
| 9 | Signed-in cart ownership reuses `CommerceCartService::resolveCurrent` (guest-cart adoption/merge). It is the same code the wholesale storefront and mobile app already run, exercised here through order stamping, but cart-merge edge cases were not re-audited | Low | follow-up soak on staging |
| 10 | A session sync (`syncSession`) fetches the full storefront config to read one boolean; only visitors holding the hint cookie (or opening an account page) pay this | Low (perf) | a dedicated capability endpoint would be cheaper |

---

## 6. Deployment / rollout notes (for the reviewer)

* **Order:** apply migration `2026_12_23_010000` first, then deploy code. With the deployment flag off the code never queries the new column, so code-before-migration is also safe; the reverse is simplest.
* **Rollback:** code is flag-inert; `down()` of the migration refuses once any ownership claim exists (audit evidence).
* **Activation (not done here):** `COMMERCE_RETAIL_ACCOUNTS_ENABLED=true`, then per store `PUT commerce/channels/{id}/pricing-settings { "customer_accounts_enabled": true }` (staff API; permission `commerce.channel_settings.manage`, owner/admin). Do **not** activate before items 1–2 above.

## 7. Remaining blockers

1. **Owner decision on trusted client-IP forwarding** (finding 1) before any busy B2C store is switched on.
2. **Production mail path confirmation** (finding 2).
3. CI on the PR (see §4.4) — including the PostgreSQL matrix — and ChatGPT/owner review.
4. Retail E2E is runnable locally/CI-ready but is **not wired into a workflow** yet (it needs the assembled Laravel app like the wholesale E2E).

_Not done, by instruction:_ merge, deploy, global activation, remote migrations.
