# AWJ Commerce — H6 Batch L: native wholesale browser E2E verification and Spree exit readiness

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-l` |
| Base (origin/main, #1828 merge) | `84e17e52ebd25b5ae2c505301a9655df2c8c0f4b` |
| PR | #1829 |
| Tested head (tooling + report content) | superseded by the review-fix commit; see the PR head (first reviewed: `955d0efa25ebcc8cc94242a5353bbf65b5ea54f1`) (the PR head moves by this docs-only update) |
| CI | pending at time of writing — see the PR checks |

**Status.** Nothing was merged, deployed, activated globally or removed. Wholesale stays off by default (`COMMERCE_WHOLESALE_BUYER_ENABLED=false`); the only place it was switched on is a throwaway local process. No production or Beta system was written to. **Spree is still not removable** (verdict in §8). This batch adds test tooling only; **no production code changed** (§10).

## 0. Verdict in five lines

1. The complete native buyer journey **works in a real browser** against the real Laravel API on the merged Batch K code: register → e-mail confirmation → sign-in → apply → staff approval → priced catalogue → cart → checkout → **one** order owned by the buyer (§4–§5).
2. The security gates held on every probe, including forged headers, price injection, cross-tenant/channel tokens, expired/revoked/suspended sessions and duplicate submission (§6).
3. **It is not deployable as-is for real traffic.** The anonymous `store/v1` limiter (30 requests/minute per connection IP) is shared by every visitor; in a real browser **the fourth page load inside one minute fails for everyone, retail included** (B1, §9). The journey only completed in this batch because the harness clears that limiter between steps.
4. Deployed evidence is **absent**: nothing could be tied to a revision, and no authorization to deploy was given. Everything below is **local-real-stack evidence** (§1).
5. Operators cannot yet run the model without engineering help (no partner-link UI, no buyer password reset, no buyer account/history) (§8–§9).

## 1. Environment discovery — local vs deployed

| Question | Finding | Evidence class |
|---|---|---|
| Frontend hosting | **Ambiguous.** `storefront/vercel.json` enables Vercel auto-deploy from `main`; `storefront/Dockerfile` and backend config (`RAILWAY_STOREFRONT_SERVICE_ID`, `AWJ_STOREFRONT_BASE_DOMAIN`) point at a Railway-hosted storefront. Which one serves wholesale buyers is not stated anywhere in the repo. | repo reading |
| Frontend revision | **Not identifiable.** No version/commit endpoint or header found. | not tested |
| API hosting / revision | Repo documents Render (first preview) and Railway (later). Revision **not identifiable**. | not tested |
| Reachable deployed hosts | `https://api.awjdev.xyz` answered a read-only unauthenticated `GET /` with a **Next.js app behind `railway-hikari`** (the ERP web app, not Laravel); `/up`, `/api/health`, `/store/v1/storefront` there return 404. `https://x.store.awjdev.xyz` answers 307; `https://store.awjdev.xyz` did not connect. Seven unauthenticated GETs in total, nothing else sent. | deployed, **non-conclusive** |
| Is merged Batch K code deployed? | **Unknown.** It cannot be established from outside, and I did not deploy. | blocked by environment |
| Wholesale host routing | Backend resolves tenant/channel from the **forwarded host** (`X-Storefront-Forwarded-Host` + gateway secret → `ResolveStorefrontDomain`); a wholesale channel is `sales_channels.wholesale_membership_enabled`. No production wholesale host is documented. | repo + local |
| Feature flags needed | `COMMERCE_WHOLESALE_BUYER_ENABLED` (deployment, default off) · channel flag `wholesale_membership_enabled` · tenant application `commerce.storefront` **enabled** (without it the staff approval API answers *"capability not enabled for this organization"* — found while building the seed) · `STOREFRONT_GATEWAY_SECRET` on both servers. | local |
| Existing browser tooling | Playwright 1.60 in `storefront/` (Spree-bound `checkout.spec.ts`; fixture-API visual suites). **No suite covered the native buyer journey.** | repo |
| Seeded buyers | None existed. A seed was written (§2). | — |

**Evidence classes used below:** *Browser* = passed in real Chromium against the real local API; *API-test* = passed only in automated API tests (earlier batches, re-run here); *Not tested*; *Blocked*.

## 2. Safe test environment

| Requirement | How it is met |
|---|---|
| Isolated, no real data | Throwaway SQLite file whose path must contain `e2e`; seed and helper PHP scripts **refuse to run** unless `E2E_ALLOW_SEED=1`, driver is SQLite and the path contains `e2e` |
| Loopback only | Spec throws unless `E2E_API_URL` is `127.0.0.1`/`localhost`; there is no `webServer` entry so it can never be pointed at a deployed host by default |
| No capture / settlement / tax invoice / accounting | Checkout used the native **no-payment-method** path ("Nothing is charged now"); the order records assert **0** invoices, payments, allocations, journal entries/lines, stock movements, payment attempts, credit notes |
| No global activation | Flag set only in the local PHP process; deployment default untouched |
| No security bypass | E-mail verification was **not** bypassed: the confirmation link was read from the app's own `log` mail transport and used in the browser. Rate limiters, gateway secret and RBAC unchanged |

**Stack** (`storefront/scripts/e2e/wholesale-stack.sh up`): Laravel assembled by `setup.sh` from `84e17e52e`, served by `php -S` on `127.0.0.1:8000`, `APP_ENV=production`, SQLite, `MAIL_MAILER=log`, `QUEUE_CONNECTION=sync`; storefront **`next build` + `next start` (production mode)** on `:3001`; hosts `wholesale.e2e.localhost`, `wholesale2.e2e.localhost`, `retail.e2e.localhost`, `other.e2e.localhost` (Chromium resolves `*.localhost` to loopback). Chromium only (headless, build 1243); desktop 1280×900 EN and mobile 390×844 AR.

**Seed** (`e2e/support/wholesale-e2e-seed.php`, real models/services): tenant A with wholesale channel WS, a second wholesale channel WS2 and a retail channel; tenant B with its own wholesale channel (cross-tenant probe); products P1 (partner list 5.00 / channel list 7.00 / retail 10.00), P2 (channel list 9.00), P3 (no wholesale price anywhere), plus a retail-only product; four seeded buyers (suspended, approved-unlinked, partner-linked, extra); an owner for the staff API. All test credentials are throwaway constants that exist only in this sandbox.

**Two harness accommodations (disclosed, neither weakens a gate):**
1. `resetBuckets()` deletes the file cache before each user action — required because of B1 (§9). The harness-free behaviour is recorded separately (F01).
2. Session *expiry* is simulated by back-dating the Sanctum token in the throwaway DB (a browser test cannot wait out the TTL); the backend's `expires_at->isPast()` check is what then refuses it.

## 3. Test matrix (32 browser tests: 30 desktop, 2 mobile — **32 passed in each of two consecutive fresh-stack runs**)

Run: `playwright test --config=playwright.wholesale-e2e.config.ts` → `32 passed` twice in a row on freshly seeded stacks (≈2 min each). Trace for every test: `storefront/test-results/wholesale-e2e/artifacts/*/trace.zip` (≈30 MB, **not committed**); sanitized evidence JSON: `evidence-desktop-en.json`, `evidence-mobile-ar.json`; screenshots committed under `docs/audits/assets/h6-batch-l/`.

### 3.1 Buyer journey (your items 1–14)

| # | Item | Result | Class | Evidence |
|---|---|---|---|---|
| 1 | Registration | Neutral "check your email" state | **Browser ✅** | `02-register-done.png` |
| 2 | E-mail verification via configured test transport | Mail addressed to the channel host; link confirms once; **replay refused** with the generic state; sign-in **before** confirmation refused with the indistinguishable message and no cookie | **Browser ✅** | `04-verified.png` |
| 3 | Sign-in + secure session cookie | `awj_buyer_session`: **HttpOnly, Secure, SameSite=Lax, host-only**; token absent from `document.cookie`, web storage, every requested URL and the DOM | **Browser ✅** | `05-membership-after-signin.png` |
| 4 | Pending membership | no application → apply → *Pending review* (1.2 s when it works); catalogue stays gated. **Intermittent defect: in 1 of the 2 final runs (and 2 earlier runs) the button stayed on "Submitting…" although the application was recorded; a reload showed Pending** (see B1 consequence, §9) | **Browser ✅** | `06-pending-gated.png` |
| 5 | Staff approval | Via staff API `POST commerce/wholesale/memberships/{id}/approve`; buyer's next load shows *Approved* | **Browser ✅ (buyer side)** · staff side **API only** | `07-approved.png` |
| 6 | Listing and detail | P1 **7.00**, P2 **9.00**, never the retail 10.00; detail pages priced | **Browser ✅** | `08-listing.png`, `09-detail-p1.png` |
| 7 | Buyer-specific price precedence | Partner-linked buyer sees P1 **5.00** (partner list) and P2 **9.00** (channel fallback) | **Browser ✅** | `B1-linked-buyer-prices.png` |
| 8 | Unavailable wholesale product | P3 shows "Not available for wholesale", **no add button** on its card, detail shows the state | **Browser ✅** | `09-detail-p3-unavailable.png`, `E02-listing.png` (AR) |
| 9 | Add / update / remove | add 7.00 → qty 2 = 14.00 → remove → empty → re-add P1+P2 = 16.00 | **Browser ✅** | `10-cart-two-lines.png` |
| 10 | Cart recovery | survives refresh; **follows the buyer into a brand-new browser context** after sign-in (cart is buyer-owned) | **Browser ✅** | `10-cart-qty2-after-refresh.png` |
| 11 | Address and shipping | typed contact + address + **Pickup** exercised. "Standard delivery" not exercised ("charge calculated later"); there is no saved-address book | **Browser ✅ (pickup only)** | `12-review.png` |
| 12 | Checkout, non-capturing | payment stage states no method is enabled and "nothing is charged now"; placed; confirmation shows "commercial commitment. No payment has been processed" | **Browser ✅** | `12-payment-stage-no-capture.png`, `12-confirmation.png` |
| 13 | Single order, correct buyer/channel | **1 order**, owned by the buyer, channel = WS, lines 700 + 900 minor, `price_source=price_list` with a list id, total 1600, 0 financial rows | **Browser ✅** + DB read | §5 |
| 14 | Suspension and revocation | suspended: catalogue gated, cart priceless, membership shows *Suspended*; reinstated: access returns. Sign-out clears the cookie and the old token answers **401**; expired session shows the sign-in gate | **Browser ✅** | `14-suspended-cart.png`, `15-expired-session-gate.png` |

### 3.2 Security (your §4) — all are real HTTP calls shaped exactly like the storefront server's, plus two browser checks

| Probe | Outcome | Class |
|---|---|---|
| Cross-tenant: tenant-A token on tenant-B host | 401 | API probe in browser suite ✅ |
| Cross-tenant login with valid credentials | refused (422) | ✅ |
| Cross-channel: WS token on WS2 host | 401 | ✅ |
| Sign-in on the sibling wholesale channel | **allowed (200) by design** (identity is tenant-wide, membership per channel) but the token has **no access**: catalogue 403, add-to-cart 403 | ✅ (observed design, §9 note) |
| Unapproved buyer (no application / pending) | catalogue gated in the browser; API 403 | **Browser ✅** |
| Suspended buyer | can authenticate; catalogue 403, add-to-cart 403 | ✅ |
| Missing / malformed token | 401 / 401 | ✅ |
| Expired / revoked token | 401 / 401 (revoked by real logout) | ✅ |
| Forged `X-Customer-Identity-Id`/`X-Partner-Id`/`X-Price-List-Id`/`X-Tenant-Id` | prices identical to baseline | ✅ |
| Browser sends its own `X-Customer-Token` to the storefront | still the sign-in gate (Batch K stripping holds) | **Browser ✅** |
| Buyer token without / with wrong gateway secret | 404 / 404 (mutation gateway hides the route) | ✅ |
| Cart cookie from another channel | the same buyer is made **approved on WS2** (apply + staff approve) so the request passes the token/membership gates and reaches cart resolution: WS2 catalogue 200, replaying the WS cart cookie there returns **200 with 0 items and no WS product id**; on the retail channel (no buyer) also 0 items | ✅ |
| Missing approved price | `422 validation_failed`, `details.reason=unavailable_for_wholesale` | ✅ |
| Price manipulation (`unit_price`, `price`, `price_minor`, `price_list_id`, `partner_id` in body) | **all four attempts rejected 422**, no line left behind; the honest add is priced **500** by the server | ✅ |
| Duplicate checkout | replay with one idempotency key → 201 then 200, **one** order; a UI double-click produced one order (the second click may not have landed — the key replay is the authoritative proof) | ✅ |
| Order ownership | another approved buyer reading the order's payment status → **404** | ✅ |
| Fail-closed login limiting | 5×422 then 429; rotating `X-Forwarded-For` does **not** reset it | ✅ |

### 3.3 DTC regression smoke (your §5) — **Browser ✅**

Retail host: no gate, retail price 10.00, **no buyer cookie** set; add to cart → checkout → order placed. Order line provenance is the retail `product_default` with **no** price list (`wholesale_provenance_leaked: false`). Existing retail behaviour is unchanged (`D01-retail-listing.png`, `D02-retail-confirmation.png`). Backend DTC suites also pass (§7).

### 3.4 Mobile Arabic/RTL — **Browser ✅**

390×844: the gate, sign-in and register pages render `dir=rtl` with 0 px horizontal overflow, **measured only after the real content (gate title, e-mail field, name field) was visible**. For an approved buyer the Arabic listing, a **cart that holds a real line** (5.00) and the **checkout contact form** (step 1 of 6, populated order summary) also overflow by 0 px (`mobile-ar-E01-*.png`, `E02-*.png`). Arabic copy was visually reviewed on the listing, cart and checkout step 1 only; full Arabic wording review is **not tested**. Cosmetic: the store name is truncated in the phone header ("....localhost").

> **Second review pass (`7cf95fc`).** The checkout step now asserts what the buyer actually sees — the *Order placed* heading, an order number of shape `CORD-9999-99999`, and the "No payment has been processed" notice — instead of waiting for a URL change (the success state is a local stage, not a URL); the retail smoke now asserts the same heading, an order number and the notice (the first attempt at this edit silently did not apply and was only caught by the next review). The cart-cookie isolation probe (C09) now uses a buyer who is genuinely approved on the destination channel, so it can no longer pass on token binding alone. The stack runner no longer skips the build when a `.next` directory exists.

> **Correction (review of `955d0ef`).** The first version of the mobile cart/checkout tests measured overflow before the page had rendered and with an empty cart, so those two screenshots were blank and the "0 px" claim for them was not evidence. The tests now add a real line and assert the cart line and checkout form are visible before measuring; the screenshots in this PR are from the corrected run.

## 4. Order evidence (sanitized; no emails, names or tokens)

```
orders in the journey buyer's run     : 1
owner = the registering buyer         : true
channel                               : wholesale (WS)
lines                                 : qty 1 @ 700 minor (price_list) · qty 1 @ 900 minor (price_list)
total                                 : 1600 minor (SAR 16.00)
payment intent record                 : method pay_on_pickup · status awaiting_collection (non-capturing; one per order)
invoices / payments / allocations     : 0 / 0 / 0
journal entries / lines               : 0 / 0
stock movements / payment attempts    : 0 / 0
credit notes                          : 0
```

The partner-linked buyer's order (API) shows `unit_price_minor=500`, `price_source=price_list`.

## 5. Environment-independent facts worth keeping

- A cart belongs to the buyer identity, not the browser: signing in on a new device recovers it.
- The order confirmation number format is `CORD-YYYY-NNNNN`.
- The verification mail link is `https://<channel-host>/<country>/<locale>/buyer/verify?token=…` (host matches the channel).
- `Secure` cookies were accepted by Chromium on `http://*.localhost`; **a real HTTPS deployment was not exercised**.

## 6. Spree exit readiness (your §6)

### 6.1 Legacy (Spree) wholesale journey vs native

| Capability | Legacy `(wholesale)` group | Native AWJ | Parity |
|---|---|---|---|
| Gate / sign-in | Spree customer sign-in wall | `/buyer/sign-in` + e-mail verification | **Proven (browser)** |
| Apply for access | `apply` form incl. phone + company (stored as customer metadata) | register + one-click apply; **no company/phone captured** | **Missing** (data) |
| Approval | Spree-side | staff API (Batch E); web workspace UI exists but **not browser-tested here** | **Partial** |
| Gated catalogue / PDP | yes | yes, with precedence and unavailable state | **Proven (browser)** |
| Cart | `WholesaleCartView` | native cart | **Proven (browser)** |
| Checkout / order | Spree checkout | native checkout → one native order | **Proven (browser)** |
| Quick order by SKU | `quick-order` (SKU combobox, multi-line) | **none** | **Missing** |
| Buyer account, order history, reorder | Spree account | `/account` says *"Customer accounts are not available yet"*; footer "My Account / Order History" lead to it | **Missing** |
| Buyer password reset | Spree | **none** (no route, no screen) | **Missing** |
| Saved addresses | Spree | none | **Missing** |
| Operator partner-link (buyer ↔ price list) | n/a | **no staff API or UI** (`CustomerPartnerLinkService` has no caller under `app/` — only tests and this batch's seed) | **Missing** |
| MOQ / minimum order / B2B tax / terms / COD | Spree-side or none | not implemented, decisions open (§8) | **Undecided** |

### 6.2 Dead routes, imports and remaining dependencies

- **Dead/misleading routes:** five `/{country}/{locale}/wholesale/*` routes were probed (`/`, `sign-in`, `apply`, `cart`, `quick-order`) and all answer **HTTP 200**; the body was inspected for `/wholesale` and `/wholesale/cart` and is "page could not be found" (a soft 404, because the layout calls `notFound()` when the Spree flag is off) — the other three were not body-inspected — correct to the user, wrong to crawlers and monitors.
- **Spree ratchet (this run):** `value_imports=4 · type_imports=4 · client_access=52 · wrapper_imports=69 · env_reads=9` (equal to baseline; `pnpm check:spree-ratchet` green).
- **Still Spree-backed in `src/`** (importers of `@/lib/spree` / `getClient`): `lib/data/{cart,checkout,customer,orders,addresses,payment,credit-cards,markets,countries,cookies,wholesale}.ts`, `lib/commerce/{surface,capabilities,cart-cookies}.ts`, `components/layout/{Header,Footer}.tsx`, `components/home/WholesaleSection.tsx`, `proxy.ts`, `app/api/webhooks/spree`, and the `(wholesale)`, `(storefront)` and `(checkout)` route groups. `@spree/sdk` and `@spree/cli` remain in `package.json`.
- **Residual cookies:** the native host still sets `spree_country` and `spree_locale` (non-HttpOnly).

### 6.3 Safe removal candidates (**do not remove in this batch**)

| Candidate | Precondition |
|---|---|
| `(wholesale)` route group + `lib/spree` wholesale client + `SPREE_WHOLESALE_CHANNEL` | owner decision to drop **quick order**, or build native quick-order; capture of company/phone on apply decided |
| `components/home/WholesaleSection.tsx` Spree link | same |
| `app/api/webhooks/spree` | only after **no** Spree store is live for any tenant |
| `spree_country`/`spree_locale` cookie names | after `lib/data/{cookies,markets,countries}.ts` are native |

### 6.4 Verdict

**NOT READY to remove Spree.** The native *ordering* path is proven; the *operating* path around it (account, password reset, quick order, partner linking, application data) and the deployment path (B1, no deployed evidence) are not. Removal needs the missing-parity rows closed or explicitly waived by the owner.

### 6.5 Risks and rollback requirements

- Keep the Spree surface selectable per host until a deployed wholesale host has completed this suite; rollback = flag the host back to the Spree surface (`SPREE_WHOLESALE_CHANNEL` unchanged) — do not delete the route group before that.
- Orders created natively cannot be re-entered into Spree; a rollback mid-flight leaves native orders that Spree users cannot see. Decide order-history ownership before any cut-over.
- Buyer identities are tenant-wide and separate from Spree customers: **no migration of existing Spree wholesale accounts exists**; every existing buyer would have to re-register and be re-approved.

## 7. Automated regression re-run (this batch)

| Suite | Result | Class |
|---|---|---|
| Wholesale browser E2E (this batch) | 32 / 32 passed | Browser |
| Backend (SQLite) `--filter='Wholesale\|StorefrontClientIp\|StorefrontBuyer\|StorefrontCheckout\|StorefrontCart\|CommerceOrder'` | **365 passed, 39 skipped (PostgreSQL-only), 0 failed** | API-test |
| Storefront vitest (`lib/commerce`, `lib/data`, cart, wholesale-buyer, contexts) | 53 files, 628 tests passed | unit |
| `tsc --noEmit` (storefront) | clean | — |
| Biome (new files) | clean after format | — |
| `pnpm check:spree-ratchet` | OK, at baseline | — |
| PostgreSQL concurrency tests | **not re-run here** (covered by CI in Batches J/K) | Blocked/not re-run |
| Full backend + full storefront suites | **not re-run**; CI runs them on the PR | — |

## 8. Operator dependencies (separate, none implemented)

| Dependency | State | Needed from |
|---|---|---|
| **Trusted visitor IP / proxy chain (D-T1)** | **Unverified.** Laravel has no `trustProxies`; `request->ip()` is the immediate peer. With a public API URL this is a Railway edge address; with a private URL it is the storefront service. Neither was observed. Now **quantified as B1** | operator: real request chain evidence + decision |
| **Real e-mail delivery** | Only the `log` transport was exercised. Production is documented as Resend over HTTPS; sending domain, SPF/DKIM and deliverability **unverified** | operator |
| **MOQ / minimum order** | none; cart and order accept 1 unit | owner |
| **VAT / B2B tax display** | totals shown as the line sum; no tax line was observed; EXT-05 tax-opinion gate unrelated to this path | owner + tax advisor |
| **Payment terms, credit, COD** | none; native checkout records a commitment with a pay-on-pickup intent | owner |
| **Partner linking** | no operator surface | engineering (product decision: who links buyers to partners) |

## 9. Deployment blockers and findings

**Blockers (must be closed before any real wholesale host):**

| ID | Finding | Evidence |
|---|---|---|
| **B1** | **Shared anonymous limiter.** `store/v1` read/write routes use `EnforcePublicApiRateLimit:unauth` = **30 req/min keyed on `request->ip()`**; every visitor arrives from the storefront server, so the whole platform shares one bucket. A page costs ≈7–11 API calls. Measured with no harness reset: **loads 1–3 succeed, load 4 and every later load in that minute render "Something went wrong"** — for an anonymous retail visitor *and* for a signed-in wholesale buyer (`F01`, `F01-signed-in-buyer-after-repeated-loads.png`). Buyer reads are `no-store`, so wholesale cannot hide behind caching. Earlier batches documented the shared bucket; this is its first real-browser severity measure. The choice of fix (trusted forwarded IP vs. gateway-keyed bucket vs. raising the class) is a decision, not applied here. | spec F01 |
| **B2** | **No deployed evidence.** Revision of API and storefront unknown; no staging wholesale host known. This suite must be re-run against an authorized Beta stack. | §1 |
| **B3** | **Operators cannot link a buyer to a partner price list** — partner-specific pricing (proven correct) is unusable without code/SQL. | `CustomerPartnerLinkService` |

**B1 consequence seen in the journey:** the *Apply for wholesale access* button intermittently stays on "Submitting…" (observed ≥ 45 s) while the membership **is** recorded server-side; the log shows the post-action page refresh hitting the throttled limiter. There is no error state and no timeout, so a real buyer would be stuck and might re-submit. The suite records this (`apply_ui_stuck_on_submitting_until_reload`) and confirms the state by reloading.

**Other findings (non-blocking, ranked):**

1. No buyer password reset and no buyer account/order history (`/account` is a "not available yet" page).
2. A **suspended** buyer sees "your membership has **not been approved yet**" on the catalogue/cart gate (the membership page itself says *Suspended*) — wording is inaccurate for that state.
3. Legacy `/wholesale/*` routes return **200** with a not-found body (soft 404).
4. Sign-in on a **sibling wholesale channel** succeeds for a buyer with no membership there (access is correctly denied, but the token is issued) — consistent with the documented design; flagging so it is a decision, not an accident.
5. Prices render with Arabic-Indic numerals under the **English** locale (cosmetic, `٧٫٠٠ ر.س.`).
6. Gate heading and product links are present **twice** in the DOM (accessibility: duplicate `h1`/links).
7. Application captures no company name or phone, unlike the legacy flow.
8. Address form's Country is a free-text field; checkout cannot proceed without it (validated behaviour, but easy to miss).

## 10. Not tested / blocked

- **Blocked:** any deployed environment; real proxy chain and visitor IP; real e-mail delivery; HTTPS-only behaviour of the `Secure` cookie on real domains.
- **Not tested:** Firefox/WebKit/real devices; staff approval through the web merchant workspace UI (API used); "Standard delivery" with a delivery charge; payment capture (excluded by instruction); PostgreSQL under the browser; Arabic wording beyond the listing; accessibility audit; load/soak.

## 11. Files in this PR (tooling only)

`storefront/e2e/wholesale-buyer-journey.spec.ts` · `storefront/playwright.wholesale-e2e.config.ts` · `storefront/e2e/support/wholesale-e2e-{seed,evidence,expire-session}.php` · `storefront/scripts/e2e/wholesale-stack.sh` · `storefront/playwright.config.ts` (**one line**: `testIgnore` so the default Spree suite never loads this spec) · `docs/audits/assets/h6-batch-l/*.png` (27 screenshots) · this report. **No existing test or production file was changed or weakened.**

Reproduce: `LARAVEL_ROOT=<setup.sh output> storefront/scripts/e2e/wholesale-stack.sh up` (it **always rebuilds the current storefront source**; `E2E_SKIP_BUILD=1` is an explicit, warned opt-out), export the three variables it prints, then `pnpm exec playwright test --config=playwright.wholesale-e2e.config.ts` (set `PW_CHROMIUM_PATH` when the sandbox browser build differs). The suite is **not wired into CI** (it needs the assembled Laravel app).

## 12. Recommended next batch

**Batch M — wholesale go-live blockers** (one PR, owner decisions first):
1. **B1:** decide and implement the limiter identity (verified trusted visitor IP *or* a gateway-keyed per-visitor bucket), with the harness reset removed from this suite so it runs unaided.
2. **B3:** staff partner-link surface (list/link/unlink with audit), reusing `CustomerPartnerLinkService`.
3. Buyer account essentials: password reset, order history for the owning buyer; correct the suspended-state gate wording.
4. Soft-404 → real 404 for legacy `/wholesale/*` when the Spree flag is off.

Then **Batch N**: with explicit owner authorization to deploy a Beta stack, re-run this suite there unchanged (B2), capture the proxy chain for D-T1, and decide Spree removal slice by slice from §6.3.
