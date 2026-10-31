# AWJ H6 — Spree exit: final acceptance & removal preparation

| | |
|---|---|
| Branch | `claude/h6-spree-exit-acceptance` |
| PR | {{PR}} |
| Base SHA (origin/main) | `2ee50f220ac8fd1d954990e95b0ccd4d6e2a08a9` (#1851; contains #1846, merge SHA `b3556eef0`) |
| Head SHA | {{HEAD}} |
| CI | {{CI}} |

**Verdict: BLOCKED** for *wholesale activation* and for the *final Spree exit*; **READY for review** for the one small removal in this PR (§5). The reasons are in §0; none of them is a defect in the code that was built.

Nothing was merged, deployed, restarted or migrated; no Railway variable or service was changed (all Railway calls were read-only); wholesale was not activated; no remote resource was created. Local browser runs used only a throwaway loopback stack.

---

## 0. Why BLOCKED, and what unblocks it

| # | Blocker | Evidence | Who |
|---|---|---|---|
| B1 | **No isolated environment exists.** The Railway project has exactly one environment, `production`, with one Postgres (`nibras-db`). Deployed wholesale acceptance cannot be run without either touching production data or creating a second environment. | `list-services` → one environment; §2 | owner authorisation to create one (§2) |
| B2 | **The storefront running in production does not yet contain Quick Order.** The Laravel API does (`2ee50f220`); the storefront's two newer deployments are *Waiting for CI* and the live one is `3a3c60291`. This clears by itself when CI on main goes green — re-check before relying on it (§1). | Railway status snapshot §1 | nobody (time) |
| B3 | **Mail delivery and trusted-proxy behaviour are not verified on the deployed stack.** Mail/Resend variables exist; whether a real inbox receives the verification mail has never been exercised. No proxy-trust configuration exists (deliberate, `EdgeScheme.php`; open decision D-T1). | §3.3 | owner (isolated-env test inbox; D-T1) |
| B4 | **Most of the Spree runtime is still in the codebase and unmigrated** (checkout/payment/orders data layer, retail account pages, `lib/spree` proxy, webhook route, SDK packages). Only the proven-dead wholesale portal is removed here. | §4 | later PRs, each needing its own proof |

Not a blocker (resolved): the **AWJ Web** deployment failures. AWJ Web is live and healthy on a successful deployment (`b3556eef0`) after the last failure; the failures were the intermittent `next/font` Google Fonts fetch, in `web/`, the same fault that flaked CI (§1.3).

---

## 1. Exact deployed SHAs (Railway, read-only, snapshot ~16:00 UTC 2026-10-31)

Source: Railway MCP `describe-environment` / `environment-status` / `list-deployments` / `describe-service`. Project «أَوْج AWJ», environment `production`. Nothing was deployed or changed by this work.

### 1.1 Table

| Service | Role | Live deployment | Commit | Contains Quick Order (#1846)? |
|---|---|---|---|---|
| `nibras-api` | Laravel API | SUCCESS `dc19f471…` (15:37Z), healthcheck `/api/health`, 1/1 replica | `2ee50f220` | **Yes** |
| `awj-scheduler` | Laravel cron (`*/5`) | SUCCESS `6482e801…`, last run succeeded 15:55Z | `2ee50f220` | n/a (same code as API) |
| `awj-preview-host` | preview host | SUCCESS | `2ee50f220` | n/a |
| `Nebrax` (AWJ Web, `web/`) | staff web app | SUCCESS `1870b5b9…` (`b3556eef0`); `2ee50f220` BUILDING at snapshot | `b3556eef0` → `2ee50f220` | n/a (`web/` unchanged by #1846) |
| `storefront` | Next.js storefront | **live: SUCCESS `1cce6f18…` = `3a3c60291`**; `b3556eef0` and `2ee50f220` both **WAITING — "Waiting for CI"** | `3a3c60291` live | **No — not yet** |
| `nibras-db` | PostgreSQL 18, 500 MB volume | online since 2026-09-02 | — | — |
| `awj-clamav` | AV scanner | online | — | — |

### 1.2 Reading the table

- **Quick Order is live in the API only.** The storefront service has `checkSuites: true`: it deploys only after CI on the commit is green. The previous storefront deployment waited ~26 minutes (15:09→15:35), so the two queued ones should go live shortly. **Re-check `storefront` live SHA before treating Quick Order as deployed**; the report states the snapshot, not a promise.
- The API and AWJ Web have `checkSuites: false` and deploy on push. A GitHub merge is therefore *not* evidence of a storefront deploy — exactly the point of the instruction.
- **Wholesale is off in production.** `nibras-api` has no `COMMERCE_WHOLESALE_BUYER_ENABLED` variable (names listed; values were not read), and the config default is `false`. So the new routes exist but answer 404.
- Deployment/runtime config facts that matter: storefront variables are `AWJ_COMMERCE_API_URL`, `NEXT_PUBLIC_DEFAULT_COUNTRY`, `NEXT_PUBLIC_DEFAULT_LOCALE`, `STOREFRONT_GATEWAY_SECRET` — **no `SPREE_*` variable** (this is the proof used in §4 that the Spree portal cannot render in production).
- No migration is part of #1846. How migrations are run on the API deploy is not visible from the service config (no release command shown); not needed for this change, noted for any future one.

### 1.3 AWJ Web deployment failure — status: resolved, cause class proven

- Failed deployments: `ec32253e…` (07:48Z) and `7f9df2b3…` (14:47Z, `c304cce52`).
- `ec32253e` build log: `next/font … TypeError: Cannot read properties of null (reading '1')` in `web/src/modules/store-experience-builder/presentation/fonts.ts` — a Google Fonts fetch failure at build time. The `7f9df2b3` log only carries the generic "npm run build exited 1" line, so its cause is *probable, not proven*.
- The deployment after the last failure (`3a3c60291`) was later replaced (status REMOVED = superseded), and `b3556eef0` is a **SUCCESS** that is the live AWJ Web deployment; `2ee50f220` was building at the snapshot. So the service is healthy now; I did not verify that `3a3c60291` itself reached SUCCESS. GitHub CI showed the same `next/font` failure intermittently on this repo (and on PR #1846). It is not caused by Quick Order or by this PR.
- Residual risk (not fixed here): both Railway builds and CI fetch Google Fonts at build time, so a font-CDN hiccup can fail a build. Self-hosting the fonts (`next/font/local`) would remove that class; it is a small independent change, not in this scope.

---

## 2. Isolated acceptance environment

**Finding: none exists.** One Railway environment (`production`), one database. Per the rules of this task nothing was created.

The browser suite refuses by design to seed anything but a throwaway local SQLite file whose path contains `e2e` on loopback; that safeguard was **not** bypassed.

### 2.1 Minimal infrastructure for a deployed acceptance run (needs owner authorisation)

A second Railway environment (e.g. `acceptance`) in the same project, containing:

| Service | Notes |
|---|---|
| Postgres | its own volume — never the production `nibras-db` |
| Laravel API (`nibras-api` clone) | own `APP_KEY`, own `STOREFRONT_GATEWAY_SECRET`; `COMMERCE_WHOLESALE_BUYER_ENABLED=true` **only here**; mail: a capturing transport (log driver or a sandbox inbox) and a test-only sender, not the production Resend key |
| Storefront clone | `AWJ_COMMERCE_API_URL` → the acceptance API (private network), same gateway secret as that API |
| (optional) scheduler | only if a scenario needs cron |
| Domains | a wildcard under a separate base domain (or Railway service domains) so channel hosts are distinct from production |

Data: tenants/channels/products created through the normal provisioning and staff APIs of the acceptance API (or a purpose-written, separately guarded seed that can only run when `APP_ENV=acceptance` *and* the DB host is the acceptance one). The existing seed helper must not be pointed at it.

### 2.2 Repeatable plan (what runs once the environment exists)

1. Confirm the acceptance deploy SHAs equal the SHAs under test (§1) and that the database host is not the production one.
2. Provision the tenant and the three channels (wholesale, second wholesale, retail), prices, partner, a priced/unpriced product, a variant product.
3. Run the same journey as the local suite (§3.1) in a **remote-isolated mode** of the suite — this is a *new, explicitly opted-in mode* (e.g. `E2E_REMOTE_ISOLATED=1` plus an allow-list of the acceptance hostnames and a refusal when the API reports a production marker). It is the one safeguard-related code change this needs and must be reviewed on its own; it is not part of this PR.
4. Mail: register a buyer with a controlled inbox, follow the real verification link (this is also the Resend/transport proof).
5. Proxy: record what client IP the API sees for requests through the storefront server and through the edge (read the limiter's key, not a header), to close D-T1 with evidence.
6. Tear down the environment; confirm production unchanged (deployment list and variable names).

A GitHub-Actions alternative needs no remote resource (Laravel + a Postgres service + `next start` on one runner, loopback only, same safeguards). It would prove "production build on PostgreSQL" but is *not* a deployed environment, so it does not replace the plan above. I did not add it; it is a CI change for the owner to decide.

---

## 3. Wholesale acceptance

### 3.1 What was verified, where, and what it does **not** prove

All of the following ran **locally** on a throwaway SQLite stack, loopback only, against a fresh production build of this branch: **56 of 56 passed** (desktop-EN and mobile-AR). **This is not deployed acceptance and must not be cited as such.**

| Required journey item | Local browser evidence | Deployed? |
|---|---|---|
| Registration, email verification | 02 (neutral register), 03 (login refused before confirm), 04 (mail goes to the channel host; link confirms once only) | **Not verified** |
| Sign-in, session security | 05 (HttpOnly cookie, token never in the browser), 15 (sign-out revokes server-side; expiry refused), C04/C05/C07 (missing/garbage/expired/revoked tokens, no direct-to-API mutation) | Not verified |
| Membership approval | 06, 07 | Not verified |
| Partner linking & price precedence | 13b (link → partner price; unlink restores), B1 partner-list 5.00 vs channel fallback 9.00 | Not verified |
| Catalogue & variants | 08, 09, Q03 (variant by its own SKU) | Not verified |
| Native Quick Order by SKU | Q01–Q12 | Not verified (storefront not yet live, §1) |
| Atomic multi-line add | Q04 (only eligible lines), Q06 (price withdrawn → whole batch rejected, nothing added) | Not verified |
| Cart recovery | 10 (refresh recovery), 11 (cart follows the buyer to a new browser context) | Not verified |
| Checkout & order without payment capture | 12 (double submit → ONE order), 13, Q07, Q08 (financial tables untouched) | Not verified |
| Order history & ownership | 13c (own order visible; another buyer's is one not-found), C10 | Not verified |
| Suspension & revocation | 14, C03, Q09 | Not verified |
| Tenant/channel isolation | C01, C02, C06, C09, Q10, Q11 | Not verified |
| DTC regression | D01, D02 (retail browse → confirmed order, unchanged) | Not verified |
| Arabic RTL & mobile | E01–E03, Q12, H08 | Not verified |
| Real-404s, redirects, headers, cookies | H01–H08 | Not verified |

Backend equivalents (isolation, RBAC, price-surface boundary, cart/checkout, quick order) are in §6 on both engines.

### 3.2 Gaps the local run cannot close

Deployed behaviour of: the real storefront→API hop and gateway secret, edge/TLS and Host routing for channel domains, real mail delivery, real client-IP seen by the limiter, production Postgres at scale and its lock timeouts.

### 3.3 Mail transport and trusted-proxy evidence (separate, as required)

**Mail.** Buyer verification and password reset use the platform transport (`Mail::to()->send()`; production is Resend over HTTPS per the service comments). The API service has `MAIL_MAILER/HOST/PORT/USERNAME/PASSWORD/ENCRYPTION/FROM_*` and `RESEND_KEY` defined (names only; values were deliberately not read). **Delivery to a real inbox has not been exercised for buyers** — status: **UNVERIFIED**. The local `log` transport only proves the mail is built and the link is single-use.

**Trusted proxy.** The repository intentionally does **not** enable `trustProxies` (`app/Support/EdgeScheme.php` explains why it would alter Host/Forwarded handling that tenant resolution relies on) and the API service defines no proxy-trust variable. Consequence, already designed for in H6 Batch M: the real visitor IP is **not provable**, so no header is trusted; storefront-gateway traffic is limited per store (budget), direct traffic per IP, and login limiters are per-email plus a tenant/IP bucket shared by all buyers of one store. Local tests C11/F01 prove the limiter is fail-closed and does not collapse. Whether the edge supplies a verifiable client IP is **open (D-T1)** and needs the isolated-environment measurement in §2.2 step 5.

---

## 4. Spree removal assessment

### 4.1 Method

Reverse-dependency greps with fixed-string filtering (no regex accidents on route-group brackets), `pnpm check:spree-ratchet`, middleware tests, Railway variable names, and a full build/test run. A candidate is removable only if it has **(a)** a native replacement, **(b)** no required active caller, **(c)** preserved legacy URLs, **(d)** no API/route/cookie contract break, **(e)** a one-commit revert.

### 4.2 Proof that the Spree wholesale portal cannot render in production

- The portal's layout `notFound()`s unless `isWholesaleEnabled()` (= `SPREE_WHOLESALE_CHANNEL` set).
- The deployed storefront service defines **no `SPREE_*` variable** (§1.2) → disabled in production.
- Even if it were set, `getWholesaleClient()` requires a Spree backend that **does not exist** ("no Spree backend exists", `lib/spree/config.ts`), so the portal could never have worked.
- The proxy already answered real 404s/308s for every `/wholesale/*` URL when the add-on is off (H6 final closure), and now always does (this PR).
- Inbound references to the group: none (the group had no tests and nothing imported it).

### 4.3 Inventory and classification (after this PR)

Ratchet after this PR: `spree_value_imports=4, spree_type_imports=4, spree_client_access=52, spree_wrapper_imports=68 (was 69), spree_env_reads=9`.

| Area | Class | Native replacement | Required caller? | Status |
|---|---|---|---|---|
| `(wholesale)/wholesale/**` — 15 files | **Removed here** | `(storefront)/buyer/*`, native cart/checkout, `/buyer/quick-order` | none | **REMOVED (W1a)** |
| `lib/wholesale.ts` + its test | **Removed here** (orphan after the above) | `WholesaleBuyer*` data layer | none | **REMOVED** |
| Legacy `/wholesale/*` URLs | Compatibility, kept | 308 to the native equivalent on a native wholesale host; real 404 elsewhere | public URLs | **KEPT (middleware, now unconditional)** |
| `(checkout)/{checkout,confirm-payment,order-placed}/[id]` | Dead in production; **not removed** | `(store-checkout)/checkout` + `/checkout/payment-return` | `CartDrawer` still builds `/checkout/${spreeCart?.id}` for a Spree cart that cannot exist; the pages' own error redirect | R1 — needs the data-layer set below removed together |
| `lib/data/{checkout,payment,orders,express-checkout-flow,credit-cards,gift-cards,addresses,countries}.ts`, Spree branches of `data/cart.ts`, `data/wholesale.ts` (still imported by `checkout.ts`) | Unmigrated runtime; **not removed** | AWJ-native equivalents for checkout; none yet for saved cards/gift cards | entangled with `CartContext.surface` and the checkout routes | R1 |
| Header/Footer/MobileMenu/`WholesaleSection` links, `CartContext` `surface`, `messages` `wholesale` namespace | Dead conditional code (`isWholesaleEnabled()` false in prod); **not removed** | native buyer links | tests stub them; presentation section key `wholesale` | W1b |
| Retail account pages: orders, addresses, credit-cards, gift-cards, wishlist, payment-methods, profile | **Unmigrated** — capability states `design_only`/`gated` | none yet | live retail customers | later slices, owner decisions |
| `lib/spree/*` (middleware, locale, cookies) | **Live** — the proxy for every request; cookies `spree_country`/`spree_locale` | rename only (R3) | every request | do not delete |
| `app/api/webhooks/spree` + `lib/webhooks/*` | External dependency; answers 503 today | none | unknown consumers | R2, decision D-14 |
| `@spree/sdk`, `@spree/cli`, `@stripe/*`, `@adyen/adyen-web`, `@paypal/react-paypal-js` | Still imported by the above | — | yes | R4, last |
| Cosmetic: `name: nextjs-starter-spree`, `e2e:up`, `bootstrap-spree.sh`, README | Safe at the end | — | no | R4 |

`SPREE_*` env reads that remain (names): `SPREE_API_URL`, `SPREE_PUBLISHABLE_KEY`, `SPREE_WEBHOOK_SECRET`, `SPREE_WHOLESALE_CHANNEL`, `SPREE_WHOLESALE_PUBLISHABLE_KEY` — none is set on the deployed storefront.

### 4.4 Backward compatibility and rollback of what was removed

- **URLs:** `/…/wholesale`, `/wholesale/sign-in|apply|quick-order|cart|products[/…]` behave exactly as before in production (redirect on native wholesale hosts, real 404 elsewhere); new test covers the add-on-env-set case (previously it passed through to the portal).
- **API/cookies:** no API route, cookie name, header or Laravel code changes.
- **Rollback:** `git revert` of the single removal commit restores the files; no data or schema is involved.

---

## 5. The removal PR (smallest safe scope)

**One PR, storefront only, deletes only proven-dead code and changes one guard:**

- Delete the 15-file `(wholesale)/wholesale` route group and orphaned `lib/wholesale.ts` (+ test).
- `lib/spree/middleware.ts`: legacy `/wholesale/*` handling no longer depends on `isWholesaleEnabled()` (the portal it protected is gone).
- `lib/spree/middleware.test.ts`: the test that asserted pass-through to the portal when the add-on env is set is **replaced** by one asserting the 404/308 behaviour in that case (the intended behaviour change, disclosed).
- Comments in `(checkout)/layout.tsx` and `(storefront)/cart/page.tsx` updated to stop referring to the deleted group.
- `scripts/spree-ratchet/baseline.json`: `spree_wrapper_imports` 69 → 68.

**Files changed:** see `git diff origin/main...HEAD --stat` (23 files: 17 deleted, 5 modified, 1 added (this report); +255 / −1963 lines). **Not touched:** any Laravel file, any API contract, `data/*`, `CartContext`, Header/Footer, messages, packages.

Explicitly **not** removed although mostly dead: everything in the §4.3 rows marked R1/W1b/R2/R3/R4 — each still has a caller, a test dependency or an owner decision.

---

## 6. Verification

| Check | Result |
|---|---|
| Storefront `pnpm test` | **255 files / 3677 tests passed**, 16 skipped (pre-existing); the removed `lib/wholesale` test and the superseded middleware test are gone, one middleware test added |
| `tsc --noEmit`, Biome lint, `check:locales` | clean (lint: 0 errors; 6 warnings/3 infos pre-existing) |
| `pnpm build` (production build of the E2E stack) | succeeded |
| Spree dependency ratchet | OK; baseline tightened (`spree_wrapper_imports` 68) |
| Backend SQLite — wholesale, DTC cart/checkout, commerce boundary/price, branch isolation, API tenant isolation, RBAC, storefront gateway/IP/security, payment-gateway tenant guard (451 passed, 27 skipped = PostgreSQL-only) | green |
| Backend PostgreSQL — same filter, `lock_timeout=60s` (478 passed) | green |
| Browser E2E | 56 / 56 passed on a fresh production build of this branch (no payment captured); the build printed a `Sitemap index unavailable … headers() inside generateStaticParams` notice from sitemap code this PR does not touch — not compared against a pre-change build, so not claimed as pre-existing |
| CI Gate | {{CI}} |

Backend code is unchanged by this PR (storefront-only); the backend runs confirm main's state, not new code. The full PHP suite is CI's job (no ParaTest locally; `ext-bcmath` missing locally).

---

## 7. Remaining blockers and exact next actions

1. **Wait for / confirm the storefront deployment** of `2ee50f220` (Railway shows it waiting for CI) and record the live SHA. Owner: nobody; me on request.
2. **Authorise an isolated acceptance environment** (§2.1) — or choose the CI-runner alternative. Without it, wholesale cannot be activated or accepted deployed.
3. **Review and approve the safeguard-aware remote-isolated test mode** (§2.2 step 3) as its own PR.
4. **Decide D-T1** (client-IP trust) and **D-14** (webhook) — or accept the documented limits.
5. **Merge this removal PR** (low risk: dead code, public URLs unchanged, one revert).
6. Next removal slices, each with its own proof: R1 (legacy checkout routes + data layer + `CartDrawer` Spree branch), W1b, then R2, R3, R4; the retail account pages need replacement features first.
7. Optional hardening: self-host fonts to stop `next/font` Google fetch failures (§1.3).

## 8. Explicit verdict

**BLOCKED** — wholesale must not be activated and the Spree exit is not final until B1–B4 clear. The removal PR itself is **READY for review**.
