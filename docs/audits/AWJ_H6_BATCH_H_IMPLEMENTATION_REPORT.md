# AWJ Commerce — H6 Batch H: Wholesale Security, Buyer Verification & B2B Contract Foundation

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-h` |
| PR | #1819 |
| Base SHA (origin/main, #1812 merge) | `89f344b2bb30f77d5f924a8aed0ca0baab4554d3` |
| Code head SHA (all CI green) | `604d49353416c6d105751cc4df2d3a6675a9aa21` |
| Report commit | docs-only commit on top of the code head above (changes this file only; its own CI run is listed in the PR checks) |

**Status.** Nothing is merged, deployed or activated. `commerce.wholesale_buyer_enabled` stays off by default; no production setting, no tenant row and no existing order was touched. The Spree exit is **not** complete.

## 1. Outcome by priority

| # | Item | Result |
|---|---|---|
| P0a | Trusted client-IP / per-visitor throttling | **Blocked, documented, not implemented.** The proxy chain between the storefront and the API cannot be established from the repository, so no forwarding header is trusted. The shared-gateway-bucket behaviour is characterized by tests. |
| P0b | Buyer e-mail verification | **Implemented.** Hashed, expiring, single-use tokens bound to tenant + channel; real delivery through the existing Resend-backed Laravel mailer; neutral responses; rate limits; storefront UI. |
| P1 | Buyer attribution on orders | **Implemented.** Server-authoritative owner on wholesale orders, re-checked inside the order transaction, immutable once set. No migration needed (column already existed). |
| P1 | Buyer-specific pricing | **Specified and pinned, not implemented** (precedence is not unambiguous today; see B2B contracts §2). |
| P1 | Wholesale policy contracts (VAT, MOQ, min amount, terms, COD/online, suspension) | **Documented with options and recommended defaults; nothing enforced** (owner decisions, §7). |
| P2 | Cart / checkout integration | **Deferred.** Required contracts (tax, MOQ/min amount, terms, buyer pricing) are unresolved. The storefront still does not forward the buyer token to the cart or checkout, and the legacy Spree checkout is untouched. |

## 2. P0a — Trusted client-IP boundary (blocked)

Full record: `docs/audits/AWJ_H6_BATCH_H_TRUSTED_CLIENT_IP_DECISION.md`.

**Verified facts** (code): the API has no `trustProxies` (deliberate, per earlier edge-scheme and media-storage reports); the storefront forwards only `Host` and the gateway secret; the gateway secret authenticates the *caller*, not a client address. **Not verifiable** from the repository: which hop(s) sit between the storefront server and the public API URL (the docs reference both Render and Railway; `AWJ_COMMERCE_API_URL` is a public URL), so the number of trusted hops and whether the edge rewrites or appends `X-Forwarded-For` is unknown. Trusting a header on that basis would be a speculative fix, which the brief forbids.

**What the tests pin** (`tests/Feature/StorefrontClientIpBoundaryTest.php`, 5 tests):
- eight spoofing header families (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Forwarded`, …) are inert, even with the correct gateway secret — the secret alone does not make a client address trustworthy;
- rate-limit identity is the connection address; the per-email limit survives rotating spoofed IPs (so brute-force on one account is still capped);
- **characterization:** all buyers behind the gateway share one tenant+IP bucket (20 logins/min) — this is the open weakness, now explicit and guarded against silent change;
- tenants remain independent.

**Exact activation blocker:** an operator must confirm, on the real deployment, the hop count and header behaviour of the edge in front of the API (procedure in the decision record), after which Option A (`trustProxies` with an explicit hop count, plus a gateway-forwarded, signed client address) or Option C (gateway-signed client identity) can be chosen. **Owner decision D-T1.**

## 3. P0b — Buyer e-mail verification (implemented)

**Reuse.** Delivery uses the existing Laravel `Mail` facade with the `MailServiceProvider` Resend HTTPS transport (the pattern of staff auth mail). The Messaging Foundation (`CommunicationOutbox`, COMMS-02-B) is enqueue-only with no provider or network gate, and the ADR leaves auth mail untouched, so it was *not* used and no second mail architecture was created.

**Flow.**
1. `POST store/v1/auth/register` — neutral `202`, identical for a new and an existing address. A verification mail is scheduled **after the response** (`app()->terminating`, with tenant/channel/storefront contexts re-established) so latency does not reveal whether an address exists.
2. The link is `https://{host}{/xx/yy}/buyer/verify?token=…`. The host is the storefront's own primary-first, verified, active domain from the database — never a request header. The locale prefix must match `^/[a-z]{2}/[a-z]{2}$`.
3. The verify page does **not** consume the token on render; consumption requires a click (defence against mail scanners and link prefetchers). `POST store/v1/auth/verify-email` returns `200 {verified:true}` or one generic `422`.
4. `POST store/v1/auth/verification/resend` — neutral `202`; a silent no-op for unknown, inactive, already-verified or in-gap addresses.
5. Unverified buyers cannot log in (existing behaviour, now with a way out).

**Token properties** (`customer_email_verification_tokens`, migration `2026_12_19_010000`): 64-character random secret, only its SHA-256 is stored; TTL `commerce.buyer_verification_ttl_minutes` (default 1440); single use (all of an identity's tokens are retired on success); bound to tenant **and** sales channel — a token presented on another channel's host is rejected *and not consumed*; a failed mail send marks the candidate token used and keeps the previous link valid; resend gap `commerce.buyer_verification_resend_gap_seconds` (default 60). Request bodies cannot carry `tenant_id`, `customer_identity_id` or `sales_channel_id`.

**Rate limits** (`TenancyServiceProvider`): `storefront-buyer-verify` 30/min per tenant+IP; `storefront-buyer-resend` 10/min per tenant+IP and 3/hour per tenant+e-mail; existing login limits unchanged.

**Evidence** (`tests/Feature/BuyerEmailVerificationTest.php`, 17 tests): mail dispatched and link host comes from the store domain, not headers; locale prefix strictness; neutral registration; token stored hashed; unverified login blocked; **replay**, **expiry**, **wrong tenant**, **wrong host/channel (not consumed)**, malformed and forged tokens; resend neutrality and eligibility; supersede and gap; transport failure swallowed with previous link kept; per-address rate limit; gateway-secret and deployment-gate 404s; a DTC host exposes none of it. A mutation of the channel binding made the wrong-host test fail, as intended.

**Operational blocker.** Production must have `MAIL_MAILER=resend`, a valid `RESEND_KEY` and a verified sender domain; otherwise registration still succeeds neutrally but no mail arrives. Not verified here (no production access).

## 4. P1 — Buyer attribution on orders (implemented)

Contract and layer table: `docs/audits/AWJ_H6_BATCH_H_B2B_CONTRACTS.md` §1.

- `EnsureWholesalePriceAccess` (flagged channels only) runs the three buyer checks (valid token → bound to this host's channel → `approved`, read fresh) and only then sets `CustomerContext` (partner deliberately `null`) for the request, clearing it in `finally`.
- The cart is owned by the identity (existing machinery); a cart token is useless to any other bearer.
- `CommerceOrderService::createFromCheckout` re-reads the membership **inside the order transaction with a shared row lock**; anything but `approved` ⇒ refusal and a full rollback. A suspension therefore cannot slip between the middleware check and the insert.
- `CommerceOrder::updating` forbids changing `customer_identity_id`: no rewrite, no later claim of a guest order.
- **Review fix (Codex P2, verified real, introduced by this PR):** establishing `CustomerContext` on the store cart/checkout routes made identity-based cart recovery reachable there, and `StorefrontCartController` / `StorefrontCheckoutController` discarded the rotated cart token, so a buyer on a second browser would see the cart but `checkout/complete` (no identity fallback) would 404. Both controllers now hand the rotated token back (cookie), mirroring `/commerce/v1`; two regression tests fail without the fix.
- **Review fix 2 (Codex P2, verified real, introduced by this PR):** `verify()` locked the token and then the identity while retiring all of the identity's live tokens, so two outstanding links (possible after concurrent resends) verified in parallel could deadlock on PostgreSQL (SQLSTATE 40P01 → HTTP 500). Locking is now identity → token with the token re-validated under the identity lock. A new multi-process test reproduces the deadlock on the old code and passes now.
- Request-supplied `customer_identity_id` / `partner_id` / `tenant_id` are rejected (422).
- DTC, guest and mobile flows are unchanged: a buyer token on a DTC host attributes nothing. No accounting, VAT, ZATCA, payment or lifecycle code was touched; no historical order was rewritten.

**PostgreSQL concurrency** (`tests/Feature/WholesaleBuyerPostgresConcurrencyTest.php`, real `pcntl_fork`, 5 tests): two outstanding links verified in parallel never deadlock; four processes presenting one token ⇒ exactly one succeeds (removing `lockForUpdate` in `verify` makes it fail); suspension-first vs concurrent order ⇒ no order after suspension; an in-flight order delays a suspension; and an **isolated approval-check lock test** that fails when `sharedLock()` is removed. *Candour:* the end-to-end order variant does **not** discriminate the shared lock, because the order also serializes on the numbering-anchor tenant row lock; that is why the isolated test exists.

## 5. P1 — Buyer-specific pricing (not implemented)

Mapping and reasons in the B2B contracts doc §2. Summary: `CustomerIdentity → WholesaleMembership(approved) → CustomerPartnerLink(active) → Partner.default_price_list`, with the channel list as the live fallback. It is not built because (a) the partner-list resolver is gated by the POS-only setting `apply_customer_price_list`, so reusing it would silently couple wholesale to a POS toggle; (b) no staff surface assigns partner lists to wholesale buyers; (c) four call sites must change together to keep listing/detail/cart/checkout parity; (d) precedence (partner list > channel list > base) needs owner confirmation. A characterization test pins today's behaviour: **a linked partner's price list does not change wholesale prices.** Owner decisions D-B1..D-B4.

## 6. P1 — Wholesale policy contracts (documented, not enforced)

Matrix in the B2B contracts doc §3 (VAT mode, MOQ, minimum amount, payment terms/credit, COD vs online, suspension effect on carts) with options and recommended defaults. A test pins that today's checkout applies none of MOQ / minimum amount / terms for wholesale — a deliberate "blocker" contract so enforcement cannot arrive by accident.

## 7. Owner decisions required

| ID | Decision | Recommendation |
|---|---|---|
| D-T1 | Client-IP strategy; operator to verify proxy chain | Verify hops, then Option A (explicit hop count) or C (gateway-signed client IP) |
| D-B1..B4 | Buyer pricing precedence, gating, assignment surface, parity rollout | partner list > channel list > base; independent of the POS toggle |
| D-M1/M2 | MOQ and minimum order amount: scope, units, enforcement point | per-product MOQ + per-channel minimum, enforced server-side at checkout |
| D-P1/P2 | Payment terms/credit eligibility; COD for wholesale | credit off by default; COD per channel setting |
| D-S1 | Suspended buyer's existing cart | retain read-only, block checkout |
| D-I1 | Mail transport for production | confirm Resend credentials/sender domain |
| D-V1 | Verification TTL and resend gap | 24 h / 60 s (current defaults) |
| Tax | B2B VAT display/calculation mode | decide before any checkout wiring (EXT-05 dependency) |

## 8. Checkout decision

**Deferred.** Missing contracts: authoritative tax calculation for B2B, MOQ/minimum amount, payment terms and COD policy, buyer-specific pricing parity. Attribution and approval re-check (the preconditions) are in place and tested, so checkout wiring can start once the decisions above are made. The Batch G guard test that the storefront does not forward the buyer token to cart/checkout remains green.

## 9. Files changed

Backend + storefront + tests + docs as listed (originally 41 files, +2,699 / −31; later commits add the two review fixes, their regression tests and the one-line generated model) (`git diff --stat 89f344b2b..HEAD`).

- **Backend:** `CustomerEmailVerificationToken` model + migration `2026_12_19_010000`; `BuyerEmailVerificationService`; `BuyerVerificationMail` + `emails/buyer-verification` view; `BuyerRegisterRequest`, `BuyerVerifyEmailRequest`, `BuyerResendVerificationRequest`; `StorefrontBuyerAuthController`; `routes/api_storefront.php`; `TenancyServiceProvider` (limiters); `config/commerce.php`; `EnsureWholesalePriceAccess`; `CommerceOrder` (immutable owner); `CommerceOrderService` (in-transaction re-check).
- **Storefront:** `lib/commerce/wholesale-buyer.ts`, `lib/data/wholesale-buyer.ts`; `BuyerRegisterForm`, `BuyerVerifyEmail`, `BuyerResendForm`, `BuyerSignInForm`; pages `buyer/{register,verify,resend}`; messages in ar, en, de, es, fr, pl.
- **Tests:** `BuyerEmailVerificationTest` (new), `StorefrontClientIpBoundaryTest` (new), `WholesaleBuyerPostgresConcurrencyTest` (new), `WholesaleCartCheckoutBoundaryTest` (extended), `WholesalePriceSurfaceBoundaryTest` (two route names added to the reviewed list); storefront vitest suites extended.
- **Generated (owner-approved scope addition):** `web/src/modules/developer/docs/openapi-model.generated.ts` (one line, produced by `pnpm openapi:generate`, not hand-edited).
- **Docs:** this report, `AWJ_H6_BATCH_H_TRUSTED_CLIENT_IP_DECISION.md`, `AWJ_H6_BATCH_H_B2B_CONTRACTS.md`.

**Changed existing assertion (disclosed).** Batch G's test asserting that checkout orders are *not* attributed to the buyer was a deliberate blocker pin; it is replaced by positive attribution tests plus negative ones (forged ids, non-approved buyer, immutability, DTC). No other existing assertion was weakened or removed.

## 10. Verification

| Gate | Result |
|---|---|
| New/affected backend suites, SQLite | verification, client-IP, foundation, boundary, price-surface: green |
| Cart / checkout / order / CommerceOrder suites | SQLite 367 passed, 18 skipped; PostgreSQL 385 passed |
| PostgreSQL concurrency (new) | 5 passed; skipped on SQLite |
| Mutation checks | channel binding, `lockForUpdate` in `verify`, `sharedLock` in approval check — each fails its test when removed |
| Full backend suite, SQLite (29 chunks, 844 test classes) | All green except (a) 26 `Fuel*` tests that need `ext-bcmath` (`Call to undefined function App\Services\bcmul()`; absent locally only, installed in CI) and (b) one `AiActionHistoryListTest` query-count assertion that failed once inside its chunk and passed on rerun of the same chunk and in isolation (unrelated to this change; flaky under chunk ordering). |
| Affected backend suites, PostgreSQL | 456 passed (verification, client-IP, wholesale boundary/foundation/visibility, module boundary, cart/checkout/order) |
| Storefront `tsc --noEmit` | exit 0 |
| Biome | exit 0; 5 warnings / 3 infos — same as baseline |
| Vitest | 247 files passed, 16 skipped; 3,548 tests passed, 16 skipped |
| Locale parity (`check:locales`) | all six locales in sync |
| Spree ratchet | OK |
| `pnpm build` | exit 0; `/buyer/register`, `/buyer/verify`, `/buyer/resend` build |
| CI / CI Gate (code head `604d49353`) | **All 9 checks green:** `php artisan test` SQLite and PostgreSQL, `web build (Next.js)` (both event runs), `storefront (lint + typecheck + test)`, `docker-context`, `published footer visual QA`, `merchant preview visual QA`, `CI Gate`. Two infrastructure failures on this head were re-run once each and passed: `docker-context` (Docker build could not resolve the Google Fonts `next/font` import) and `published footer visual QA` (storefront dev server answered 404 until its 120 s startup timeout; no test ran). `CI Gate` had failed fast off the first of those and passed on its single re-run. |
| OpenAPI drift fix | `web build (Next.js)` had been red since #1812 (89f344b2b): that PR reworded the `sort` parameter description in `docs/openapi/public-api-v1.yaml` without regenerating the committed web model, so `openapi-model.drift.test.ts` failed on `main` and on this PR. Fixed here at the owner's request with `pnpm openapi:generate`: exactly one line changed in `web/src/modules/developer/docs/openapi-model.generated.ts` (the `sort` description now includes the `sale_price` ordering sentence), matching the #1812 contract change. No other contract file or generated line changed; drift tests 8/8 and the local production build pass. |

Environment note: `Fuel*` tests need `ext-bcmath`, absent locally, and fail only here (CI installs it).

**Uncovered / not verified:** real e-mail delivery through Resend in a deployed environment; the production proxy chain; behaviour of the new routes behind a real edge; verification under the Messaging Foundation (not integrated by design); wholesale checkout end-to-end (deferred).

## 11. Spree dependency counts (ratchet)

| Metric | Before | After |
|---|---|---|
| spree_value_imports | 4 | 4 |
| spree_type_imports | 4 | 4 |
| spree_client_access | 52 | 52 |
| spree_wrapper_imports | 69 | 69 |
| spree_env_reads | 9 | 9 |

Unchanged by design: Batch H adds native-API surface only. **The Spree exit is not complete**; the legacy Spree checkout remains the live path.

## 12. Recommended next step

Batch I should be decision-driven: (1) operator confirms the proxy chain and the owner picks D-T1, then implement the chosen client-IP boundary; (2) owner settles tax, MOQ/minimum amount, terms and D-B1..B4; (3) only then wire the buyer token through cart and checkout with those contracts enforced server-side behind a per-channel setting, keeping Spree as fallback until parity evidence exists.
