# AWJ Commerce — H6 Batch N: deployed Beta verification and wholesale launch readiness

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-n` (docs only) |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1836 |
| Base SHA (origin/main) | `89f4117ca1d6d2d3bbdc6b3e77482305e663f6a2` (#1832, Batch M) |
| Head SHA | `3dcaa1860ddb1c9d81904397979bc3b9a6dd7655` (before this link-up commit) |
| Evidence window | 2026-10-31 07:51Z – 07:57Z (all times UTC) |
| Environment under test | Railway-hosted **public shared Beta** (retail tenant `alrshd`), probed from outside only |

**Nothing was deployed, restarted, migrated, enabled or modified.** Every request was `GET`, `HEAD` or one `OPTIONS` preflight; no `POST`, no login, no order, no token, no secret. The local E2E seed was not run against anything remote.

Status vocabulary: **PASSED** = observed and correct · **FAILED** = observed and wrong · **BLOCKED** = cannot be done without an authorization or access I do not have · **NOT TESTED** = not attempted · **UNKNOWN** = no evidence either way.

---

## 0. Supplement (2026-10-31 09:44Z) — owner-provided Railway evidence, CI Gate cause, re-probe

**Owner-provided Railway deployment evidence** (not independently verifiable from this session — no Railway access; recorded as reported):

| Service | Deployment status | Commit |
|---|---|---|
| Storefront | **SUCCESS** | `89f4117ca` (Batch M merge) |
| Laravel API | **SUCCESS** | `89f4117ca` |
| AWJ Web | **FAILED** | `89f4117ca` |

A successful API deployment is **not** treated as proof that the Batch M migrations or the runtime flags are verified: the entrypoint's fail-closed `migrate --force` makes it *likely* the migrations ran, and the flag values remain unread. Both stay **UNKNOWN** until the migrations table and the non-secret variables are read.

**Re-probe of the public storefront at 09:44Z** (read-only): the `wholesaleBuyer` i18n catalogue now contains the Batch M keys (`forgot`, `orders`, `reset`), which matches the reported storefront success at `89f4117ca`. The earlier "Batch M absent at 07:55–07:57Z" result was a build still in progress, not a stuck deploy; §3.2 and §3.3 below describe the earlier state and are superseded by this paragraph. Two new facts from the same probe:

* `/sa/ar/buyer/sign-in`, `/buyer/orders`, `/buyer/forgot-password`, `/buyer/reset-password`, `/buyer/membership` answer **HTTP 200 on the retail tenant** (`x-nextjs-postponed: 1`). They render real wholesale UI ("This is a wholesale store. Catalogue and prices are shown only to approved buyers" on `/buyer/orders`) although that tenant has no wholesale channel. The catalogue and product pages themselves are unaffected (0 gate text). This is a **retail-host exposure of wholesale pages**, same family as the legacy soft-404 defect, and is a launch blocker for B7.
* `/sa/ar/buyer` (no sub-path) is a real `404`.

**Why `CI Gate` was red on this PR.** The gate waits for the required checks on the head SHA; the `php artisan test (L11, pgsql)` job failed once on `78e0f0cd2`, so the gate failed. The artifact of that run (`test-output-pgsql`) shows exactly one failure out of 10,333 tests: `Tests\Feature\AiActionHistoryListTest::an_executed_action_carries_its_latest_execution_and_row_counts_without_n_plus_one` — `Failed asserting that 24 is identical to 23` (a query-count assertion). This PR changes only this markdown file; the SQLite job passed on the same commit; CI on `main` for `89f4117ca` (identical code) passed; and the pgsql job **passed on one re-run** of the same commit. Classification: **not documentation drift, not a required-check configuration problem, not a regression from this PR** — an order-dependent flake in an AI-actions query-count test that already warms its caches. No code was changed for it here; hardening that test is listed as a follow-up in the closure report. `CI Gate` was re-run after the pgsql job went green.

---

## 1. Verdict

**Wholesale is NOT launch-ready on the deployed Beta.** The retail storefront is up and serving, the Laravel API is up and already carries the Batch M routes, but (a) the deployed *storefront* does not yet carry Batch M (see the timing caveat in §3.2), (b) no wholesale browser verification is possible on any deployed host without environment changes that need your authorization, and (c) production e-mail, the Railway flags and the Batch M migrations could not be verified at all from here.

| Area | Result |
|---|---|
| Deployed Laravel API SHA | **UNKNOWN** (exposed nowhere); Batch M **code present** — PASSED (route evidence) |
| Deployed storefront SHA | **UNKNOWN** from the public surface; owner reports SUCCESS at `89f4117ca`; catalogue carried Batch M by 09:44Z (§0). AWJ Web deployment reported FAILED |
| Railway / Vercel build and deployment status | **BLOCKED** (no CLI, no token, no dashboard access in this session) |
| Runtime feature flags | **BLOCKED** (values); behaviour is *consistent with* wholesale disabled |
| Batch M migrations applied | **UNKNOWN** (inferred only — §3.4) |
| Gateway boundary (forged host / wrong secret / no secret) | **PASSED** |
| Direct API boundary (staff routes, `store/v1`) | **PASSED** |
| Cookie flags — buyer session | **NOT TESTED** on deployed (code-verified only) |
| Cookie flags — residual `spree_*` | **FAILED** (informational: not Secure/HttpOnly/SameSite) |
| Trusted proxy / client-IP chain | **UNKNOWN** — operator evidence still required |
| Gateway rate-limit budget on deployed | **NOT TESTED** (would load the shared bucket) |
| E-mail delivery | **BLOCKED** |
| HTTPS redirect, wildcard host routing | **PASSED** |
| Security response headers | **FAILED** (none of HSTS / nosniff / frame / referrer / CSP present on the Railway hosts) |
| Retail regression (read-only) | **PASSED** with four non-wholesale findings (§5) |
| Isolated wholesale browser suite on a deployed host | **BLOCKED** (no isolated tenant/host; suite refuses non-loopback by design) |
| Spree removal | **NOT READY** — unchanged from Batch L/M |

---

## 2. Method and limits

* Sandbox egress goes through a pre-configured agent proxy. Reachable: `*.awjdev.xyz`, `*.up.railway.app`, `*.vercel.app`. No `railway`/`vercel` CLI is installed and no `RAILWAY_*`/`VERCEL_*` credential exists in the session, so **nothing that lives only in the Railway/Vercel control plane (build logs, deployment SHAs, variable values, migration state) could be read.** Those rows say UNKNOWN or BLOCKED rather than assume `main`.
* Deployed-revision inference uses only what the public surface reveals: the server-rendered i18n catalogue shipped in the page, and route existence (a registered route answers `401`/`404-with-store-error`, an unregistered one answers the framework `404`).
* Reproduction: every command in §9 is a plain `curl`.

---

## 3. N1 — deployment inspection (read-only)

### 3.1 Hosts and environment classification

| Host | Observed | Classification |
|---|---|---|
| `https://alrshd.store.awjdev.xyz` | `200`, Next.js, `server: railway-hikari`, retail tenant "زهور الرشد / نبراس مارت" | **Railway — public shared Beta storefront (retail)** |
| `https://dominah-zhor-tyb.store.awjdev.xyz` | `200`, tenant "زهور طيبة" | Railway — second real tenant storefront (not a test tenant) |
| `https://nibras-api-production.up.railway.app` | `/api/health` → `200 {"status":"ok"}`, `x-powered-by: PHP/8.3.36` | **Railway — Laravel API (the real backend)** |
| `https://api.awjdev.xyz` | `200`, **serves the AWJ Next.js web app** (`/api/health` → HTML `404`, `/store/v1/storefront` → HTML `404`) | **Not the Laravel API despite the name** — anything pointed at it will fail |
| `https://alrshd.awjdev.xyz`, `https://preview.awjdev.xyz` | `200`, AWJ ERP/landing web app | Railway — ERP web / preview host |
| `https://awj.up.railway.app` | `/api/health` → HTML `404` | Railway — web app, not the API |
| `https://storefront-one-xi.vercel.app` | `503`, `x-vercel-error: DEPLOYMENT_PAUSED` | **Vercel — paused**; not serving traffic |
| `https://store.awjdev.xyz` | proxy `CONNECT 502` | **UNKNOWN** (egress proxy could not tunnel; may not resolve) |

### 3.2 Deployed revisions

| Component | Deployed SHA | Evidence | Batch K | Batch L | Batch M |
|---|---|---|---|---|---|
| Storefront (`alrshd.store.awjdev.xyz`) | **UNKNOWN** | The `wholesaleBuyer` i18n namespace embedded in the page (`/sa/en`) has **exactly** the key set of `84e17e52e` (Batch K, #1828): 0 keys missing, 0 extra; it lacks the 53 keys Batch M added (`forgot`, `reset`, `orders`, `gate.membership`, application company/phone). Identical at 07:51Z and 07:55Z (same CSS/JS chunk hashes). | present | not distinguishable (L added tests only, no messages) | **not present** |
| Laravel API (`nibras-api-production…`) | **UNKNOWN** | `GET /api/commerce/wholesale/partners/eligible` and `…/memberships/{uuid}/partner-link` → `401 Unauthenticated` (route registered; a control path `/api/zz-nonexistent-probe` → `404`). `GET /store/v1/buyer/orders` and `/store/v1/wholesale/access` → store-resolution `404` JSON whose message differs from the unknown-route `404` (route registered). All four are Batch M routes. | present | present (superset) | **present (routes)** |

**Timing caveat — read this before drawing a conclusion.** Batch M merged at **07:48:33Z**; the first probe was at **07:51Z**, three minutes later. The API already served the new routes at 07:52:22Z, so it had redeployed; the storefront image (a slower Next.js build) may simply still have been building. The "M absent from the storefront" result is therefore **provisional**; the re-probe time and outcome are recorded in §3.3. Neither a green CI nor a merged PR proves what Railway is running — the SHA stays UNKNOWN until the Railway deployment list is read.

### 3.3 Storefront re-probe

Re-probed at **07:57Z** (9 minutes after the merge): the `wholesaleBuyer` catalogue is still the Batch K key set (same CSS chunk hashes as 07:51Z), and `/sa/ar/buyer/forgot-password` and `/sa/ar/buyer/orders` still answer `404`. So at the end of this evidence window the storefront had **not** picked up Batch M. This is not a failure of the merge: it may be a build still in progress, a failed build, or auto-deploy not enabled for that service — **which one cannot be told without the Railway deployment list.** Re-run the §9 catalogue check later; if the key set still lacks `forgot`/`orders`, treat the storefront deploy as stuck.

### 3.4 Migrations and runtime flags

* **Batch M migrations** (`2026_12_21_010000_add_application_details_to_wholesale_memberships`, `2026_12_21_020000_create_customer_password_reset_tokens`): **UNKNOWN — cannot be read.** Indirect inference only: `deploy/entrypoint.sh` runs `php artisan migrate --force` (5 attempts) **before** starting the web server and exits `1` otherwise, and the container `CMD` is that script. A running API that already serves Batch M routes therefore *implies* the migrations ran, provided Railway builds from this Dockerfile (not verified). This is an inference, not evidence; confirm with `SELECT migration FROM migrations ORDER BY id DESC LIMIT 5` or the Railway deployment log.
* **Flags — `COMMERCE_WHOLESALE_BUYER_ENABLED` and the storefront wholesale switch:** **BLOCKED**. The unauthenticated staff routes answer `401` *before* the flag check (`abort_unless(config('commerce.wholesale_buyer_enabled'), 404)` runs inside the controller), so the flag is invisible from outside. What *is* consistent with "disabled": every native `/{country}/{locale}/buyer/*` page is `404` on `alrshd.store.awjdev.xyz`, and no wholesale gate text is rendered on the catalogue or product pages (§5).
* Variable **names** reported by earlier audits (values never read): `nibras-api` has `MAIL_*`, `RESEND_KEY`, `STOREFRONT_GATEWAY_SECRET`, `AWJ_TENANT_BASE_DOMAIN`, R2 variables (`AWJ-ANIMATED-MEDIA-STAGING-ACCEPTANCE.md`); the 2026-10-26 ENV0 inspection found 0 `SPREE_*` variables. Both are second-hand and predate Batches K–M.

---

## 4. N2 — security and infrastructure evidence

| # | Check | Request (all GET unless stated) | Result | Status |
|---|---|---|---|---|
| S1 | Storefront host → tenant resolution | `https://alrshd.store.awjdev.xyz/sa/ar` | `200`, tenant catalogue, correct legal name/VAT | PASSED |
| S2 | Wildcard host routing | `dominah-zhor-tyb.store.awjdev.xyz` | `200`, different tenant | PASSED |
| S3 | **Unknown tenant host** | `does-not-exist-awjn.store.awjdev.xyz/sa/ar` and `/sa/ar/products` | **`200`**, generic empty shell titled "المتجر", no products, no robots meta. No tenant data leaks, but resolution fails *open to a 200 page* instead of a `404` | **FAILED** (low; soft-404 for crawlers/monitors) |
| S4 | Gateway: forged forwarded host, **no** secret | API `GET /store/v1/storefront` with `X-Storefront-Forwarded-Host: alrshd.store.awjdev.xyz` | `404` store-not-resolved | PASSED |
| S5 | Gateway: forged host + **wrong** secret | same + `X-Storefront-Gateway-Secret: not-a-real-secret` | `404` store-not-resolved | PASSED |
| S6 | Gateway secret configured | storefront renders live tenant data through the gateway while S4/S5 are refused | secret exists and matches on both sides — **inferred** | PASSED (inferred) |
| S7 | Direct API, staff routes | `/api/commerce/orders`, `/api/commerce/wholesale/partners/eligible` | `401 Unauthenticated` | PASSED |
| S8 | Direct API, `store/v1` without gateway | `/store/v1/{storefront,products,buyer/orders,me,wholesale/access}` | uniform `404` JSON "no valid store" — no price/product/order data | PASSED |
| S9 | Cookie flags, buyer session `awj_buyer_session` | needs a wholesale-enabled host and a login | code: `httpOnly: true`, `secure` in production, `sameSite: "lax"` (`storefront/src/lib/commerce/buyer-session.ts`) | **NOT TESTED** on deployed |
| S10 | Cookie flags, residual locale cookies | `Set-Cookie` on `/sa/ar` | `spree_country`, `spree_locale`: `Path=/; Max-Age=31536000` — **no Secure, no HttpOnly, no SameSite**, Spree-named. Non-sensitive values; unchanged since Batch L | **FAILED** (informational) |
| S11 | HTTPS | `http://alrshd.store.awjdev.xyz/sa/ar` | `301 → https://…` | PASSED |
| S12 | Security headers | storefront `/sa/ar`, API `/api/health` | **absent:** `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Content-Security-Policy`, `Permissions-Policy` (storefront has no `headers()` in `next.config`; Railway edge adds none). Only the paused Vercel host sends HSTS | **FAILED** |
| S13 | CORS | API `/api/health`, `OPTIONS` with `Origin: https://evil.example` | `access-control-allow-origin: *`, `allow-methods: GET`, no credentials | INFO — Laravel default; confirm intended (`FRONTEND_URL` effect) |
| S14 | Trusted proxy / client IP | `X-Forwarded-For`/`X-Real-IP` sent to `/api/health` → `200` | response carries `x-railway-edge`, `x-hikari-trace`, `server: railway-hikari`. Laravel has no `trustProxies` (deliberate, Batch M). Whether the Railway edge overwrites vs appends `X-Forwarded-For` is **not provable from outside** | **UNKNOWN** — the operator evidence in the Batch I addendum is still owed |
| S15 | Rate-limit configuration / behaviour | `STOREFRONT_GATEWAY_READ_LIMIT`/`WRITE_LIMIT` are Railway variables; behavioural proof needs a burst | a few dozen anonymous storefront page loads across ~6 minutes produced no `429`/`5xx` on tenant pages, which is *consistent with* the per-storefront budget, but this is not a load test and does not prove the API runs Batch M's limiter (the routes, not the limiter, were observed) | **NOT TESTED** |
| S16 | E-mail delivery | needs `MAIL_MAILER`/`RESEND_KEY`/sender domain and a real send | `deploy/DEPLOY.md` documents `MAIL_MAILER=resend` + `RESEND_KEY`; variable *names* seen earlier; values, sender-domain verification and queue mode (`QUEUE_CONNECTION=sync`) unverified. Verification mail and password reset (Batch H/M) both depend on it | **BLOCKED** |

Forged forwarded-IP headers were sent only to `/api/health` and were not relied upon for any conclusion.

---

## 5. N3 — retail regression (read-only)

Host `https://alrshd.store.awjdev.xyz`, tenant "زهور الرشد", wholesale not enabled. Timestamps 07:51–07:55Z.

| Check | URL | Status |
|---|---|---|
| Storefront availability | `/sa/ar` | `200` — PASSED |
| Product catalogue | `/sa/ar/products` | `200`, ≈220 KB, price rendered ("٧٥ ر.س") — PASSED |
| Product detail | `/sa/ar/products/a2dc0021-b690-4a5e-b68e-f403d843f181` | `200`, title "ابو ولد \| نبراس مارت", price rendered — PASSED |
| Locale routing | `/sa/en` `200`; `/sa/xx` `307 → /sa/ar`; `/ae/ar` `200` | PASSED |
| Cart / checkout shell | `/sa/ar/cart` `200`; `/sa/ar/checkout` `200` (page renders) | PASSED (no order created) |
| **No unexpected wholesale buyer gate** | catalogue and PDP body text searched for "تاجر"/"جملة"/"Wholesale"/"Sign in"/"تسجيل الدخول" — **0 matches** outside the script payload | PASSED |
| Native buyer pages closed while disabled | `/sa/ar/buyer`, `/buyer/orders`, `/buyer/forgot-password` | `404` ×3 — PASSED (also consistent with Batch M not yet being on the storefront) |
| Legacy Spree wholesale routes | `/sa/ar/wholesale`, `/sign-in`, `/apply`, `/cart`, `/quick-order` | `200` ×5 with "page could not be found" body (soft-404, **X5b still open**) — FAILED (status code), no data exposed |
| `robots.txt` | `/robots.txt` | `200`; disallows `/*/account`, `/*/cart`, `/*/checkout` — PASSED |
| `sitemap.xml` | `/sitemap.xml` | `404` — FAILED (SEO, pre-existing) |

Findings that are **not** wholesale-related and not caused by Batches K–M: `/sa` → `307 /sa/ar/sa` → `404` (broken bare-country redirect, origin not investigated); `/zz/ar` accepts an unknown country with `200`; `GET /api/health` on the storefront host returns a plain-text `500` (the storefront has no such route; low impact, not a customer path); S3 above.

Header/footer "حسابي / سجل الطلبات" still link to `/sa/ar/account` (renders the shell, no account content) — open item L2 from Batch L/M.

---

## 6. N4 — isolated wholesale verification

**Not run. BLOCKED, by design and by missing authorization.**

1. **No isolated Beta tenant or host is evidenced.** The only two storefronts found (`alrshd`, `dominah-zhor-tyb`) are real retail tenants on the shared environment. No test tenant, no wholesale-flagged channel, no test buyers or price lists exist or are known to me.
2. **The Batch L/M suite cannot target a deployed host.** `playwright.wholesale-e2e.config.ts` has no `webServer` and the spec refuses non-loopback API/store URLs; the seed refuses to run unless `E2E_ALLOW_SEED=1`, SQLite and a throwaway file. These guards were left intact and were not worked around.
3. **No credentials.** There is no staff token, buyer identity or Railway access in this session, and registering a buyer would write to a live tenant and send mail.
4. **Enabling wholesale is an environment change.** `COMMERCE_WHOLESALE_BUYER_ENABLED` is a **deployment-wide** variable on the API service. Even when on, it only activates for a web channel flagged `wholesale_membership_enabled`, but it also unlocks the staff `commerce/wholesale/*` routes for every tenant. Doing it on the public shared API conflicts with your rule; it therefore needs an isolated environment or your explicit decision.

### Browser test matrix

| Journey | Local (Batch M, loopback SQLite stack, not re-run here) | Deployed Beta |
|---|---|---|
| Retail DTC smoke (catalogue, PDP, cart, checkout shell) | PASSED (36/36 suite) | PASSED read-only (§5); checkout **not completed** |
| Buyer register → verify e-mail → sign in | PASSED | **NOT TESTED** (needs flag + mail) |
| Pending / approved / rejected / suspended gating | PASSED | **NOT TESTED** |
| Approved price precedence, cart, non-capturing checkout | PASSED | **NOT TESTED** |
| Order history / detail, cross-buyer IDOR | PASSED | **NOT TESTED** |
| Password reset | PASSED (mail = log driver) | **NOT TESTED** (mail BLOCKED) |
| Staff partner-link UI | PASSED (unit + API) | **NOT TESTED** |
| Tenant/channel isolation | PASSED | **NOT TESTED** (S4–S8 prove only the unauthenticated boundary) |

"Local PASSED" is the Batch M result and is **not** evidence about the deployed environment.

---

## 7. N5 — Spree exit assessment

Counts (`pnpm check:spree-ratchet` on `89f4117ca`): `spree_value_imports=4 · spree_type_imports=4 · spree_client_access=52 · spree_wrapper_imports=69 · spree_env_reads=9` — at baseline, no growth.

| Item | Native AWJ state | Classification |
|---|---|---|
| Gate / register / verify / sign-in | Local browser PASSED (K/L/M); deployed untested | **Verified parity** (local) |
| Apply with company + phone | Built in M; **not on the deployed storefront yet** | **Verified parity** (local) — deployment pending |
| Staff approval workspace | API + web UI built and unit-tested | **Verified parity** (local) |
| Gated catalogue, price precedence, cart, checkout, order | Local browser PASSED, non-capturing | **Verified parity** (local) |
| Buyer order history / detail | Built in M, IDOR-tested | **Verified parity** (local) |
| Buyer password reset | Built in M; delivery depends on mail | **Blocked by infrastructure** (mail unverified) |
| Partner linking (buyer ↔ price list) | Built in M; Spree had none | **Verified parity** (new capability) |
| Quick order by SKU | none | **Missing feature** |
| Reorder, saved addresses, profile edit | none | **Missing feature** |
| MOQ / minimum order / B2B tax / terms / COD | undecided | **Missing feature** (owner decision) |
| Header/footer account & order-history links | point at Spree-era `/account` | **Missing feature** (L2, small) |
| Legacy `(wholesale)` route group + wholesale client + `SPREE_WHOLESALE_CHANNEL` | soft-404 on deployed | **Safe removal candidate** — after quick order is built or waived, and after a wholesale host has passed browser verification (rollback path) |
| `components/home/WholesaleSection.tsx` Spree link | — | **Safe removal candidate** (same precondition) |
| Legacy `checkout/[id]`, `confirm-payment`, `order-placed` routes | `200` soft-404 | **Safe removal candidate** (also closes X5b) |
| `app/api/webhooks/spree` | no Spree store believed live | **Blocked by infrastructure** (cannot confirm "no Spree store for any tenant" without Railway) |
| `spree_country` / `spree_locale` cookies | live on every host (S10) | **Unsafe to remove** until `lib/data/{cookies,markets,countries}` are native |
| `lib/data/{cart,checkout,customer,orders,addresses,payment,credit-cards,…}`, `(storefront)`/`(checkout)` groups, `@spree/sdk`/`@spree/cli` | still import Spree | **Unsafe to remove** |
| Spree wording in shipped i18n (footer/"Powered by Spree") | present in the payload | **Safe removal candidate** (copy; confirm unrendered first) |

**Do not delete Spree.** No existing Spree wholesale account is migrated; buyers must re-register and be approved.

---

## 8. Launch blockers

| # | Blocker | Kind |
|---|---|---|
| B1 | Deployed storefront and API SHAs are unverified; the storefront did not yet carry Batch M | access |
| B2 | Batch M migrations unverified on the deployed database | access |
| B3 | No isolated wholesale environment, test tenant, test buyers or staff credentials | authorization |
| B4 | E-mail delivery (`resend`, sender domain, queue) unverified — blocks verification mail and password reset | access |
| B5 | Trusted client-IP chain unproven (D-T1); per-visitor limiting still absent | evidence |
| B6 | No security response headers (HSTS, nosniff, frame, referrer, CSP) on the Railway hosts | change needed |
| B7 | Unknown tenant host returns `200` empty shell; legacy routes return `200` soft-404; `/sa` redirect chain; no sitemap | change needed |
| B8 | Missing Spree-parity features (quick order, reorder, addresses) and open commercial rules | owner decision |
| B9 | `api.awjdev.xyz` points at the web app, not the Laravel API | confirm / fix routing |

## 9. Reproduction

```bash
A=https://nibras-api-production.up.railway.app; S=https://alrshd.store.awjdev.xyz
curl -s $A/api/health                                   # {"status":"ok"}
curl -s -o/dev/null -w '%{http_code}\n' $A/api/commerce/wholesale/partners/eligible   # 401 => Batch M route registered
curl -s -o/dev/null -w '%{http_code}\n' $A/api/zz-nonexistent-probe                   # 404 control
curl -s -o/dev/null -w '%{http_code}\n' -H 'X-Storefront-Forwarded-Host: alrshd.store.awjdev.xyz' $A/store/v1/storefront  # 404
curl -s $S/sa/en | grep -o 'wholesaleBuyer' | wc -l     # catalogue present; compare key set with git show <sha>:storefront/messages/en.json
```

## 10. Authorization requested before any further step

1. **Read-only Railway access** (or a pasted deployment list): project, service names, the **commit SHA of the active deployment** for the API and each storefront service, deployment status, and variable **names** plus the values of the non-secret flags only (`COMMERCE_WHOLESALE_BUYER_ENABLED`, `STOREFRONT_GATEWAY_*_LIMIT`, `MAIL_MAILER`, `QUEUE_CONNECTION`). This closes B1, B2 (with a `migrations` query) and part of B4.
2. **Choose the isolation model for wholesale browser verification** — recommended: a separate Railway *environment* (own database, API and storefront) so the public shared environment is never touched. Alternative needing explicit sign-off: on the shared API, set the deployment flag and create one new isolated tenant/channel (a deployment-wide flag change plus data creation).
3. If (2) is approved: authorization to create the test tenant, test buyers and price lists there, a mail sink or verified test sender, and a staff test credential — and a target-aware (non-loopback) variant of the browser suite, which is a code change I would propose as its own PR.
4. **Operator proxy evidence** for D-T1 (what the Railway edge does to `X-Forwarded-For`), per the Batch I addendum.
5. Approval to propose, as separate small PRs: security headers on the storefront, a real `404` for unknown tenant hosts and legacy routes, the `/sa` redirect fix, and the L2 account-link fix.

Recommended order: 1 → re-run §3.2/§3.3 → 2/3 → browser matrix → B5–B7 slices → B8 decisions.
