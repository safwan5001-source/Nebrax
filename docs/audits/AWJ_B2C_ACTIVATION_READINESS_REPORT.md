# AWJ B2C Account Activation Readiness — Report

| | |
|---|---|
| **Branch** | `claude/b2c-activation-readiness` |
| **PR** | opened from this branch (number in the PR itself) — one focused PR, **not merged, not deployed** |
| **Base** | `origin/main` @ `c43559f68e1f561a80193e06b93e01e1156a8995` (includes PR #1860) |
| **Code head** | see `git log` of the branch; the PR tip may be a docs-only commit recording results on top of the code commit |
| **Scope guard** | No merge, no deploy, no retail activation, no Railway variable read or written (only `list-projects`/`list-services`/`search-docs`) |

## 0. Verdict

| Area | Verdict |
|---|---|
| Shared auth rate limit | **Mechanism built and proven locally; OFF by default.** It cannot be switched on safely until the operator proves what the Railway edge puts in `X-Real-IP` (§1.5). Until then activation of a busy B2C store stays **blocked** on this item. |
| Mail readiness | **Code path is sound; inbox delivery is NOT proven** (nothing sent). A read-only readiness command and the exact manual check are provided (§2). |
| Activation controls | **Verified closed by default, per-storefront, wholesale-independent, guest checkout unchanged** (§3). |

## 1. Rate limits

### 1.1 Findings (exact)

* Every shopper reaches Laravel from the storefront server (service `storefront` on Railway), so `request()->ip()` is one address for the whole platform. The auth limiters keyed `{name}|{tenant}|ip|{ip}` (`storefront-buyer-register` 10/min, `-login` 20/min, `-reset-request` 20, `-reset` 30, `-verify` 30, `-resend` 10) are therefore **one store-wide bucket**: one abusive visitor locks every shopper of that store out; real B2C volume exceeds 20 logins/min. **Reproduced in a real browser** (§4): shopper A throttled at attempt 21 → unrelated shopper B throttled too.
* The per-address limiters (login 5/min per e-mail, register 3, reset 3, resend 3/h) are the real brute-force control and are **independent of the IP dimension** — untouched.
* The same limiters serve wholesale hosts. Laravel deliberately has no `trustProxies`; `request->ip()` = `REMOTE_ADDR`; every IP header is inert (pinned by the existing `StorefrontClientIpBoundaryTest`, unchanged).
* The gateway secret (`X-Storefront-Gateway-Secret`, verified in `ResolveStorefrontDomain`, which alone sets `storefront_gateway_verified`) proves **who is calling**, not **whether an address is true**. That boundary is why the earlier batches refused to guess.

### 1.2 Design (reuses the existing gateway trust; no `X-Forwarded-For` trust)

```
visitor ─▶ Railway edge ─▶ storefront (Next.js) ──signed──▶ Laravel
                           reads ONE operator-declared    verifies: gateway flag + HMAC
                           source, validates it,          (host-bound, fresh) + public IP
                           signs host|ip|timestamp        ⇒ per-visitor bucket
```

* **Storefront** (`client-attestation.ts`, only for non-GET calls in `storefrontBuyerRequest`): sends `X-Storefront-Client-Ip`, `-Ts`, `-Sig` **only if** `STOREFRONT_CLIENT_IP_SOURCE` is set (`vercel` | `real-ip` | `xff-right:N`; unset = nothing sent). `xff-right:N` counts proxies from the **right**, so anything a visitor writes on the left of `X-Forwarded-For` is never read. Private/loopback/link-local/CGNAT/malformed values are discarded. A raw `X-Forwarded-For` is never forwarded.
* **Laravel** (`App\Support\StorefrontClientIdentity`): honours the identity only if **all** hold — `storefront.client_identity.enabled` (`STOREFRONT_SIGNED_CLIENT_IP_ENABLED`, default **false**); gateway flag set by `ResolveStorefrontDomain`; HMAC valid (key = HMAC(gateway secret, `awj-storefront-client-ip.v1`), message binds forwarded **host**, address, timestamp); timestamp within ±60 s; address public. Anything else ⇒ the legacy `tenant|ip` bucket **exactly as today** (a forgery gains nothing, not even a higher cap).
* **Limit shape when a valid identity exists:** per-visitor bucket with the **same** per-minute number as before + a **store-wide backstop** (`backstop_multiplier` 10 × the number, e.g. login 200/min/store) so distributed credential spraying is still braked. IPv6 aggregates on /64; an IPv4-mapped form (`::ffff:a.b.c.d`) is reduced to its IPv4 first (same visitor, private-mapped refused) — fixed after Codex review of `0f1e7a7`. Keys include the tenant (stores stay isolated).
* **Wholesale not weakened:** the per-visitor mode applies only on a host where retail accounts are open **and wholesale is closed**. Wholesale hosts (and dual-mode hosts) keep the original shared bucket and number. Tested.

### 1.3 Files changed

| File | Change |
|---|---|
| `app/Support/StorefrontClientIdentity.php` | **New.** Verification + limiter dimension |
| `app/Providers/TenancyServiceProvider.php` | 6 storefront-buyer limiters call `StorefrontClientIdentity::networkLimits()` (per-address limits unchanged) |
| `config/storefront.php` | `client_identity` block (enabled=false, skew 60, backstop ×10) |
| `storefront/src/lib/commerce/client-attestation.ts` | **New.** Source selection, validation, signing |
| `storefront/src/lib/commerce/config.ts` | attach attestation on non-GET buyer/account calls, only when a source is configured; never throws |
| `app/Console/Commands/CommerceRetailAccountsReadinessCommand.php` | **New.** Read-only readiness check (§2) |
| `tests/Feature/StorefrontSignedClientIdentityTest.php` (22), `CommerceRetailAccountsReadinessCommandTest.php` (4), `BuyerMailFailureLoggingTest.php` (1), `storefront/src/lib/commerce/__tests__/client-attestation.test.ts` (23) | **New** |
| `storefront/e2e/retail-signed-identity.spec.ts`, `playwright.signed-identity-e2e.config.ts`, `playwright.config.ts` (ignore pattern) | **New** opt-in browser proof (loopback-only guard) |
| `CLAUDE.md` | short section |

No migration, no route, no permission, no change to checkout/payment/ZATCA/accounting.

### 1.4 Protection evidence

PHP (`StorefrontSignedClientIdentityTest`, 23 tests, SQLite **and** PostgreSQL): 60 independent signed visitors all pass (legacy would stop at 20) · one abusive visitor throttled at 21 while another passes · same victim e-mail from 6 "visitors" ⇒ 429 on the 6th (per-address brake intact) · store backstop stops 41 distinct visitors (multiplier 2) and a sibling store is unaffected · **9 forgery classes** (wrong secret, tampered address, expired, future, signed for another host, private, loopback, garbage signature, missing signature) each fall back to the shared legacy bucket (21st = 429) · plain `X-Forwarded-For`/`X-Real-IP`/`Forwarded`/`CF-Connecting-IP`/`True-Client-IP`/unsigned `X-Storefront-Client-Ip` inert even with the feature on · no secret ⇒ 404, never a signed identity · default config closed (static assertion) · wholesale and dual hosts keep the 20/min shared limit · /64 grouping · same visitor on two stores has two buckets · register/forgot use the same dimension. The signature vector is pinned in both PHP and TS tests (a drift would silently disable the feature, safe but invisible).

### 1.5 What is still unproven (blocks turning the flag on)

* Railway docs list `X-Real-IP` as the header "for identifying client's remote IP" (`docs.railway.com/networking/public-networking/specs-and-limits`). They do **not** say a client-supplied `X-Real-IP` is overwritten. Not verified here (deployed edge not probed). The `storefront` service is on Railway (project "أَوْج AWJ", production); no Vercel team exists on this account, and whether a CDN/WAF fronts custom store domains is unknown.
* **Manual probe (operator, one test store with the flag ON):** from one machine send ≥25 failed sign-ins through the real store host with a **different forged `X-Real-IP` on each request** (the committed spec is the template — its loopback guard is deliberate and must be relaxed by the operator, not blindly). **Throttled at ≈21 ⇒ the edge overwrites the header ⇒ safe to keep on. Never throttled ⇒ the header is forgeable ⇒ turn the flag off** (the damage is bounded either way: the per-address brake and the store backstop still apply, but per-visitor fairness would be spoofable).
* Even then the residual risk is spoofable *fairness*, not a weaker per-account brake or a weaker store cap.

## 2. Mail readiness

### 2.1 Code review findings

| Check | Result | Evidence |
|---|---|---|
| Link host | Store's own **verified, active** `StorefrontDomain` (primary first) — never a request header; only a strict `/xx/yy` prefix is client-influenced. No verified domain ⇒ nothing sent, warning logged | `BuyerEmailVerificationService::storeHostname`, `BuyerEmailVerificationTest::the_link_host_is_the_stores_own_domain_never_a_request_header` |
| Page family | Retail host ⇒ `/account/*`; wholesale host ⇒ `/buyer/*` | `BuyerPasswordResetService::pagePrefix`, `RetailCustomerAccountsTest` |
| Expiry | Verification **1440 min** (`COMMERCE_BUYER_VERIFICATION_TTL_MINUTES`), reset **60 min** (`…PASSWORD_RESET_TTL_MINUTES`), minimum 5; single use; SHA-256 only stored; tenant + channel bound; resend gap 60 s | `an_expired_token_fails`, replay/other-tenant/other-host tests |
| Sender | Platform-wide `MAIL_FROM_ADDRESS`/`MAIL_FROM_NAME` (no per-tenant sender exists). Production transport `MAIL_MAILER=resend` via `MailServiceProvider` (HTTPS, 5 s connect / 10 s timeout, no auto-retry) with `RESEND_KEY` (not `RESEND_API_KEY`) — `deploy/DEPLOY.md` | code |
| Failure handling | Shopper always gets neutral 202; candidate token retired, previous link stays valid; send runs after the response | `a_mail_transport_failure_is_swallowed…` |
| Failure logging | Warning `buyer verification mail failed` / `buyer password reset mail failed` with **only** `tenant_id`, `identity_id`, exception class. **New test** proves no address, token, `token=`, password or provider message text appears in the log record or the response | `BuyerMailFailureLoggingTest` |

No code defect found in the mail path; no change made to it.

### 2.2 Readiness command (new, read-only)

`php artisan commerce:retail-accounts-readiness` prints the gate state, mail transport, sender, key *presence* (never values), TTLs, signed-identity flag, and for each store with accounts enabled the **exact host the e-mail links will use**; exits 1 and says `BLOCKER:` for: non-delivering transport (`log`/`array`/`null`), invalid/placeholder sender (`example.com`, `resend.dev` — Resend's sandbox only delivers to the account owner), missing `RESEND_KEY`, missing gateway secret, or an enabled store with no verified domain. With the deployment flag off these are only notes. Tested not to send mail and not to echo secrets.

### 2.3 Why delivery is not proven, and the exact manual step

Nothing was sent and no Railway variables were read, so the production transport, key and sender-domain verification are **unobserved**. Before enabling:

1. On the Railway API service run `php artisan commerce:retail-accounts-readiness` — must show transport `resend`, `RESEND_KEY: present`, a real sender on a Resend-**verified** domain, and the store's own host as link host.
2. Pick **one internal test store** (flag still off elsewhere), turn on §3 flags for that store only, register with a mailbox you control, and confirm: the message reaches the **inbox** (not spam), the sender/domain is right, the link opens `https://<that store's host>/<country>/<locale>/account/verify?token=…`, verifies once, and a second click is refused; repeat with *Forgot password* (link valid 60 min, ends all sessions). Check SPF/DKIM pass in the message headers.
3. Watch Railway logs for `buyer … mail failed` during the test.

## 3. Activation controls

| Requirement | Result | Evidence |
|---|---|---|
| `COMMERCE_RETAIL_ACCOUNTS_ENABLED` off unless explicitly enabled | `env(…, false)`; static test asserts shipped default; flag-on config cannot be forced on at channel level while the deployment flag is off (`customer_accounts_deployment_disabled`, 409) | `CommerceRetailAccountsReadinessCommandTest`, `SalesChannelSettingsService` |
| Independent per-storefront setting | `sales_channels.customer_accounts_enabled`, host-resolved; open store A + closed store B in one tenant ⇒ B uniformly 404 | `RetailCustomerAccountsTest` (RA/RB/DTC) |
| Closed refusal | Uniform **404** on all `auth/*`, `me`, `account/*`; `GET storefront` reports `capabilities.customer_accounts:false` | same |
| Retail does not activate wholesale | Retail-open host: `buyer/*`, `wholesale/*` ⇒ 404 and `wholesale_buyer:false`; wholesale host: `account/*` ⇒ 404 | `an_open_host_announces_the_capability_and_wholesale_routes_stay_closed_there` |
| Guest checkout unchanged | Guest cart + checkout + order reference succeed on closed and gated-off hosts | `everything_is_a_uniform_404…guest_checkout_is_untouched` |

## 4. Tests and CI

Local (assembled Laravel app, PHP 8.3; **bcmath absent** so unrelated `Fuel*` tests were not run — same note as PR #1860).

| Suite | SQLite | PostgreSQL 16 |
|---|---|---|
| Focused auth/isolation/gateway/mail set (signed identity, readiness, mail-failure log, gateway limit, client-IP boundary, public-API limit, retail accounts, buyer e-mail verification, wholesale buyer/foundation/capability/price-surface, commerce customer auth, channel settings, retail PG concurrency) | **196 passed** (before the mail-log test) | **198 passed** (incl. 2 PG-only concurrency classes) |
| New: `StorefrontSignedClientIdentityTest` + readiness + mail-failure log | passed | **27 passed / 519 assertions** |

Storefront: `tsc --noEmit` clean · `biome check` on touched files clean (`biome lint .`: 7 pre-existing warnings, identical with and without this change, none in touched files) · **full `vitest run`: 3632 passed, 16 skipped** (250 files; includes 23 new) · `pnpm build` succeeded.

Browser regression (local throwaway stack, production `next start`, real Laravel + SQLite):

* Existing retail-accounts journey (flag defaults): first full run **13 passed, 1 timed out** (last mobile step, 90 s timeout with the page closing while waiting for `#email` — environment slowness on a single-threaded `php -S`, flag path not exercised); re-running the mobile project **13/13 passed**, desktop **1/1 passed**. I treat the single timeout as a flake but report it.
* New signed-identity spec, real browser contexts presenting their own `x-real-ip`:

| Scenario | Feature **OFF** (shipped default) | Feature **ON** (`real-ip`) |
|---|---|---|
| Abusive shopper A | throttled at attempt **21** | throttled at attempt **21** |
| Independent shopper B right after | **throttled (locked out)** | **not throttled** |
| Shopper C, only forged `X-Forwarded-For`/`X-Client-IP`/`X-Storefront-Client-Ip` (new value each attempt) | throttled at attempt 1 | throttled at attempt **21** (gets no bucket of its own) |

GitHub CI results are recorded on the PR (see PR checks); this report is written before they complete and does not claim them.

## 5. Remaining activation requirements

1. **Edge proof** (§1.5) → then set `STOREFRONT_SIGNED_CLIENT_IP_ENABLED=true` on the API **and** `STOREFRONT_CLIENT_IP_SOURCE=real-ip` (or the proven mode) on the `storefront` service. Both are needed; either alone changes nothing.
2. **Inbox delivery proof** (§2.3) on one test store.
3. Owner decision (unchanged): whether dual-mode (B2B+B2C) hosts should also get per-visitor limits — currently deliberately **not** (no weakening of wholesale).
4. Known limits carried over from PR #1860: COD orders have no inline claim reference; fixed 30-day session; no e-mail change flow.

## 6. Safe activation and rollback

**Activation order (nothing below was done by this PR):**
1. Merge/deploy this PR — behaviour identical (all new paths inert).
2. Run the readiness command; fix blockers.
3. §1.5 probe and §2.3 inbox test on one internal store.
4. `COMMERCE_RETAIL_ACCOUNTS_ENABLED=true` (API) — still inert per store.
5. Enable `customer_accounts_enabled` for that one store (staff channel settings). Re-run the readiness command.
6. Roll out store by store.

**Rollback (any step, immediate, no migration):**
* Per store: set the channel's `customer_accounts_enabled` off ⇒ uniform 404 (existing sessions stop working; guest checkout unaffected).
* Everything retail: `COMMERCE_RETAIL_ACCOUNTS_ENABLED=false`.
* Visitor identity only: `STOREFRONT_SIGNED_CLIENT_IP_ENABLED=false` (instantly back to the shared bucket) and/or unset `STOREFRONT_CLIENT_IP_SOURCE`.
* Code: revert the PR; no schema or data was touched.
