# AWJ H6 — Final Spree exit (consolidated)

| | |
|---|---|
| Branch | `claude/h6-final-spree-exit` |
| PR | _linked on the PR page_ |
| Base SHA (origin/main) | `7c7ccddb0ae25a15f1ef17fde261941d44b2d65e` (#1857) |
| Head SHA | code head `578fb9f17229f7a2ce7a6b14f3b2f3aa86719836`; any later commit on the branch changes this report only |
| CI | see the PR's checks (the PR page is the source of truth) |
| **Verdict** | **BLOCKED — by exactly one external contract (the inbound Spree webhook, owner decision D-14). Everything independently safe is done in this PR; see §10.** |

Storefront only. No Laravel file, API contract, schema, accounting/VAT/ZATCA rule, payment capture/refund/cancellation path, tenant/channel isolation, buyer authentication, wholesale price precedence or AWJ cart/checkout/Quick Order behaviour was changed. Nothing was merged, deployed, migrated remotely or activated; wholesale stays off.

**Result:** `lib/spree` (the SDK client wrapper), `@spree/sdk` and `@spree/cli` are gone; the retail account actions no longer have any upstream client; the shared proxy has an AWJ name and explicit tests; the legacy Spree E2E harness is removed. The Spree ratchet is **0 / 0 / 0 / 0 / 1** — the single remaining count is the webhook route's `SPREE_WEBHOOK_SECRET` read.

---

## 1. Remaining scope, classified

| Dependency | Class | Outcome in this PR |
|---|---|---|
| `lib/spree/{config,auth-helpers,cookies,locale,jwt,surface,types,index}` (Spree client, token refresh, Spree cart/auth cookies, `Surface`) | **Removable** — only importers were the retail-account actions (gated, refusing), `markets.ts` (two unused Spree-backed exports) and the layout's token read | **Deleted** |
| `lib/spree/middleware.ts` (the live proxy) | **Replaceable** (logic is AWJ; only name and cookie names were Spree) | **Moved/renamed** to `lib/proxy/storefront-proxy.ts` (`createStorefrontProxy`), behaviour pinned by its existing tests (62 after removing five env-duplicate cases) + 5 new |
| Retail account routes / `lib/data/customer.ts` | **Replaceable** — `ACCOUNT_AUTH_CAPABILITY = "gated"`; there is no buyer-identity service, so no live path existed | Actions rewritten as typed refusals (`capability_unavailable`), no client, no env; session cookies renamed `awj_account_*` |
| Commerce mappers / Spree types | **Already AWJ-owned** — `lib/commerce/{mappers,types,cart-types}` import nothing from `@spree/sdk` (only comments mention it). The only `@spree/sdk` type imports were in `app/dev/*` fixtures and 11 tests | Re-pointed to `StoreProduct/StoreCategory/StoreCountry/StoreMarket/StoreProductFilters/StoreProductPage/StoreProductListParams` |
| `@spree/sdk` | **Removable** after the above, plus the webhook's `verifyWebhookSignature` | **Removed** (signature check ported natively — §3) |
| `@spree/cli`, `e2e:up/e2e:down`, `scripts/e2e/bootstrap-spree.sh`, `e2e/checkout.spec.ts` | **Removable** — proven dead (§4) | **Removed**; `dev-with-env.sh` no longer requires `.env.e2e`; README rewritten |
| Header / Footer / MobileMenu `/wholesale` links, `WholesaleSection`, `isWholesaleEnabled` | **Removable** — pointed at the deleted portal; gated by an env that is unset in production | **Removed** (published `wholesale` home-section key kept in the presentation schema and renders nothing, as before) |
| `messages.wholesale` (Spree portal copy), `header/footer/home.wholesale*`, `expressCheckout` | **Removable** | **Pruned in all six locales** (kept `wholesale.hiddenPrice.*`, still used by `HiddenPricePrompt`/`ProductDetails`) |
| `SPREE_API_URL`, `SPREE_PUBLISHABLE_KEY`, `SPREE_IMAGES_URL`, `SPREE_WHOLESALE_*` reads (`config.ts`, `DocumentShell` preconnect, `next.config.ts` image patterns) | **Removable** | **Removed**; `images.remotePatterns` is now empty (it only allowed `localhost/rails/active_storage/**` in production) |
| `app/api/webhooks/spree` + `lib/webhooks/*` + `SPREE_WEBHOOK_SECRET` | **Externally blocked** — external caller not ruled out | **Retained**, SDK-free; owner decision stated in §3 |

## 2. What was removed and replaced

- **Deleted modules:** all of `src/lib/spree/*` except the three files that moved, `lib/commerce/surface.ts` (+ test), `components/home/WholesaleSection.tsx`, `lib/data/__tests__/customer.test.ts`, `e2e/checkout.spec.ts`, `scripts/e2e/bootstrap-spree.sh`. 16 files deleted, 5 added.
- **Packages:** `@spree/sdk`, `@spree/cli` (lockfile: deletions only, −87 lines, no version movement).
- **Replaced with AWJ-native equivalents (contracts preserved):**
  - `createSpreeMiddleware` → `createStorefrontProxy`. Route ownership unchanged and explicit: bare/country-only paths → `/{country}/{locale}`; locale canonicalisation; legacy `/{checkout,confirm-payment,order-placed}/[id]` → real 404; `/buyer/**` 404 unless the API says the Host is wholesale-open; legacy `/wholesale/*` → 308 to the native equivalent or 404; unknown Host → 404; protected `/account/*` → sign-in unless an account-session cookie exists.
  - Locale cookies `spree_country/spree_locale` → `awj_country/awj_locale` (HttpOnly, SameSite=Lax, Secure in production, same max-age). **Dual-read migration:** the proxy still reads the legacy pair as a fallback and expires it in the same response once the new pair is set (remove the fallback one release later).
  - Internal request headers `x-spree-request-{pathname,search}` → `x-awj-request-{pathname,search}` (set by the proxy on the request only).
  - Account session cookie names `_spree_jwt/_spree_refresh_token` → `awj_account_session/awj_account_refresh` (nothing sets them while sign-in is gated; logout expires them **and** the six legacy `_spree_*` cookies so old browsers shed them).
  - `verifyWebhookSignature`/`WebhookEvent` → `lib/webhooks/signature.ts` (§3).
  - `Surface`/`surface` parameters on `data/{products,cached}.ts` and `metadata/product.ts` (already ignored) removed.
- **Removed UI branches:** the `/wholesale` links in header (desktop), mobile menu and footer; the home wholesale pitch (it rendered `null` in every deployment because `SPREE_WHOLESALE_CHANNEL` is unset).

## 3. The Spree webhook — inspected, retained, one decision needed

| Question | Evidence |
|---|---|
| Authentication | HMAC-SHA256 over `"{timestamp}.{payload}"`, hex, constant-time compare, ±300 s replay window, headers `x-spree-webhook-{signature,timestamp,event}`; `503` while `SPREE_WEBHOOK_SECRET` is unset; `401` for missing/forged/stale; handlers run only after verification |
| Business side effects | Sends transactional **e-mails only** (order confirmation / cancellation / shipped / password reset) through Resend, with an in-memory idempotency set. No database write, no accounting, VAT, ZATCA, stock, payment or order state is touched |
| Callers in the repository | None (no PHP, workflow, config or doc emits to this path) |
| Active external source | `storefront` service on Railway, read-only: variable **names** are `AWJ_COMMERCE_API_URL`, `NEXT_PUBLIC_DEFAULT_COUNTRY`, `NEXT_PUBLIC_DEFAULT_LOCALE`, `STOREFRONT_GATEWAY_SECRET` — **`SPREE_WEBHOOK_SECRET` is not set**, so the route answers 503 to every caller; HTTP request count for `/api/webhooks/spree` over the last 168 h: **0** (all statuses). The other service with a public domain (`awj-preview-host`) has only `ANDROID_APP_LINK_SHA256_FINGERPRINTS` |
| What the evidence cannot show | That no third-party Spree install was *ever* pointed at the URL, or that no other deployment of this code (outside this Railway project) has the secret set. The Railway HTTP log retained for the service covers a limited window and was empty for this path |

**Decision: retained, not deleted.** The route is inert in the only deployment I can inspect, but "cannot ever be called" is not proven. I did not invent that proof.

What this PR changed about it: nothing functional. The SDK import was replaced by a native port of the 8-line verification function, pinned by `lib/webhooks/__tests__/signature.test.ts` — 13 outcomes **recorded from the SDK v1.2.1 function before it was removed** (valid, 299 s edge, 301 s too old/new, custom tolerance in/out, wrong secret, tampered body, non-numeric/empty timestamp, short/empty/upper-case signature) plus a fixed vector produced with the `openssl` CLI. A new route test (`api/webhooks/spree/route.test.ts`) pins 503-unset, 401 missing/forged/replayed, 200 dispatched, 200 unhandled.

**Owner decision needed (D-14), exactly:** confirm that no Spree store or other system is configured to POST to `https://<any storefront host>/api/webhooks/spree`, and that AWJ's transactional e-mail is (or will be) sent from the Laravel API rather than from this route. If confirmed, deleting it is a 5-file change with no side effects: `app/api/webhooks/spree/route.ts` (+test), `lib/webhooks/{handler,handlers,signature}.ts` (+test), `lib/emails/*`, `app/dev/emails/*`, the `RESEND_API_KEY`/`EMAIL_FROM`/`SPREE_WEBHOOK_SECRET` lines in `.env.example`, and `baseline.json`'s last count goes to 0. If a sender exists, the route stays as is.

## 4. Legacy E2E harness — removed, with evidence

`e2e/checkout.spec.ts` drove the Spree guest checkout with a Stripe test card against a Dockerised Spree 5 (`e2e-backend/docker-compose.yml`). All three of these are independently true: (1) `e2e-backend/` **does not exist in the repository**, so `e2e:up`/`e2e:down` could not run; (2) the app no longer contains the Stripe/Spree checkout UI the test drives (removed in #1856/#1857); (3) no CI workflow runs the storefront's default Playwright config (the only workflow that runs Playwright, `store-brand-qa.yml`, uses `playwright.brand-qa.config.ts` for the storefront and the `web/` app's own config). `@spree/cli` was used only by `bootstrap-spree.sh`. The default `playwright.config.ts` is kept for the fixture-route specs (`cust-h2-5-…`, which only need `next dev`); the AWJ checkout is covered by D02 and the unit suites.

## 5. Files changed

93 files, +760 / −3 613 (`git diff --shortstat origin/main...HEAD`). Grouped:

- **Deleted (16):** see §2. **Added (5):** `lib/account/session-cookies.ts`, `lib/proxy/locale-cookies.ts`, `lib/webhooks/signature.ts`, `lib/webhooks/__tests__/signature.test.ts`, `app/api/webhooks/spree/route.test.ts`. **Moved (4):** `lib/spree/middleware(.test).ts` → `lib/proxy/storefront-proxy(.test).ts`, `lib/spree/webhooks.ts` → `lib/webhooks/handler.ts`, `spreeRatchet.test.ts` → `src/__tests__/`.
- **Rewritten:** `lib/data/customer.ts` (refusals), `README.md`, `.env.example` (Spree block), `scripts/e2e/dev-with-env.sh`, `playwright.config.ts` (comments), `next.config.ts` (no Spree image patterns, no `transpilePackages`).
- **Edited:** Header, Footer, MobileMenu, `DocumentShell`, home `page.tsx`, account layout, `data/{markets,products,cached}.ts`, `metadata/product.ts`, `utils/cookies.ts`, `i18n/routing.ts`, `proxy.ts`, six `messages/*.json` (570 deleted lines in total, no additions), `app/dev/*` type imports, `scripts/mobile-menu-proof/mount.tsx`, comments in `capabilities.ts`/`cart-cookies.ts`/`edge-storefront-locale.ts`.
- **Tests:** 40 edited, 6 deleted (§7).

## 6. Spree dependency counts (`pnpm check:spree-ratchet`)

| Counter | Before (base `7c7ccdd`) | After |
|---|---|---|
| `spree_value_imports` | 3 | **0** |
| `spree_type_imports` | 4 | **0** |
| `spree_client_access` | 20 | **0** |
| `spree_wrapper_imports` | 26 | **0** |
| `spree_env_reads` | 9 | **1** (`SPREE_WEBHOOK_SECRET`, webhook route) |

`@spree/*` packages in `package.json`: 2 → **0**. The ratchet scanner and its test are kept as the regression guard (a re-introduced `@/lib/spree`, `@spree/*`, client access or `SPREE_*` read fails `check:spree-ratchet`).

## 7. Tests changed (disclosed; no security/financial/isolation assertion weakened)

- **Deleted with their subject:** `customer.test.ts` (tested the removed Spree-backed *live* login/refresh/associate-cart path; the gated refusals, classification allowlist and “no upstream text reaches the buyer” guards remain in `customer.gated.test.ts`, `AccountAuthGate.architecture.test.ts`, `account-errors` tests), `lib/spree/__tests__/{auth-helpers,jwt}.test.ts`, `commerce/__tests__/surface.test.ts`.
- **Converted from spy-based to structural:** `sitemap.test.ts` and `no-spree-env.test.ts` wrapped the real `@/lib/spree` in spies to prove no Spree client was built. The module no longer exists, so the guarantee is now structural (and `check:spree-ratchet` enforces it); the behavioural assertions (sitemap/policies/cart/checkout work with every `SPREE_*` unset, no Spree wording or credential leaks) are unchanged.
- **Strengthened:** `customer.gated.test.ts` (logout expires the new and six legacy cookies; module imports no Spree code), `AccountAuthGate.architecture.test.ts` (no upstream call of any kind in `customer.ts`), `wholesale-boundary.test.ts` guard kept.
- **Intentional output change:** `Footer.legacy.test.tsx` pins the footer markup byte-for-byte; its fixture contained the `/wholesale` footer item because the test forced `isWholesaleEnabled() === true`. That item (`<li>…/wholesale…</li>`, ×2) is removed from the fixture; the production-default markup (env unset) is unchanged byte-for-byte.
- **Mobile menu tests:** the “Wholesale” entry cases became “never renders a legacy `/wholesale` entry” plus the ordering that remains meaningful.
- **New:** 13-case signature parity + fixed vector; webhook route contract (5); proxy cookie-migration and account-cookie cases (5); browser **D03** (retail account) and a rewritten **H06** (new cookie names, attributes, locale switch, legacy-pair migration).

## 8. Verification

| Check | Result |
|---|---|
| Import graph | 393 modules, 6 unreachable — the same generic UI primitives / `i18n/request.ts` / `lib/metadata/categories.ts`; none Spree-related |
| `tsc --noEmit` (after `rm -rf .next`) | clean |
| Biome | clean (same pre-existing warnings/infos) |
| `check:locales` | six locales in sync |
| Ratchet | OK at 0/0/0/0/1 |
| Targeted suites first | proxy (67), webhooks (signature + route: 18), layout/Header/Footer/MobileMenu (181), customer gated (7) |
| Full storefront `pnpm test` (clean env: `AWJ_*`/gateway unset) | **247 files / 3 569 tests passed**, 16 skipped (pre-existing). A first run had 2 failures I introduced and fixed: the footer legacy fixture (above) and a wrong argument index in my own new logout assertion |
| Production build | `pnpm build` (Next 16, Turbopack): compiled, TypeScript finished, exit 0 (same unrelated sitemap notice as on `main`) |
| **Consolidated browser regression** (one run, real Laravel on a throwaway SQLite, production `next start`, Chromium desktop-en 1280×900 + mobile-ar 390×844) | **57 / 57 passed** (3.4 min): D01 retail browsing, **D02 retail cart → checkout → confirmed order**, **D03 retail account**, wholesale journey (register/verify/sign-in/price precedence/security C-series/G01 password reset), Quick Order Q-series incl. **Q12 Arabic RTL on a phone**, E01–E03 mobile Arabic, **H01–H08** (real 404s, redirects, headers, **H06 cookies + legacy migration**), cross-channel Q10, API-trust Q11 |
| Backend SQLite / PostgreSQL | not run — no backend file changed |
| CI Gate | see the PR's checks |

Honest notes: the browser harness needs `PW_CHROMIUM_PATH` pointed at the sandbox's installed headless shell (the pinned Playwright looks for a different build); that is a sandbox path issue, the config documents the override. The cart **drawer** is covered by unit tests, not by the browser journeys (they use the cart page).

## 9. Security and backward-compatibility assessment

- **Tenant/channel isolation, buyer identity/sessions/membership, wholesale price precedence:** untouched; the wholesale suite (C-series, price precedence, Q10 cross-channel, Q11 API-trust) passes unchanged.
- **Account:** behaviour for every visitor is identical (gated before and after); the refusal is now unconditional, so flipping `ACCOUNT_AUTH_CAPABILITY` cannot make an action pretend to authenticate or send credentials anywhere. A stale `_spree_jwt` cookie no longer opens the account shell (it opened a shell for a signed-out user before); it redirects to sign-in, which is the correct outcome.
- **Webhook:** verification semantics preserved (§3); still fails closed (503) without a secret.
- **Cookies:** only the names changed; attributes, lifetime and values are the same; old cookies are read once and expired, so returning visitors keep their market/language. **Rollback caveat:** after rolling back to the previous code, the old proxy ignores `awj_*` and falls back to geo/Accept-Language/default for that visitor until it sets `spree_*` again — cosmetic, no data loss.
- **Public URLs/API:** no route added or removed; the legacy-URL behaviour (404/308) is pinned by the proxy tests and H01–H08. `images.remotePatterns` is empty (previously only `localhost` Spree Active-Storage paths).
- **`<head>`:** the `preconnect`/`dns-prefetch` to `SPREE_API_URL` is gone; it was never emitted in production (variable unset).
- **Not changed:** RTL/LTR, localisation (six locales in sync), mobile layout (E01–E03/Q12/H08 pass).

## 10. Deployment and activation status

Nothing deployed, merged or activated. **No environment change is required** on Railway: no removed code reads a variable that is set there. No migration. Wholesale buying stays off (no isolated acceptance environment; mail and client-IP trust unverified, as in earlier reports). `SPREE_WEBHOOK_SECRET` must stay unset unless D-14 resolves to “a sender exists”.

## 11. Risks and rollback

- **Rollback:** `git revert` of the merge commit restores everything (packages come back through the lockfile; no data or schema is involved). Cookie caveat in §9.
- **Risk — retained legacy cookie fallback:** harmless but should be removed a release after deploy (`LEGACY_*` in `lib/proxy/locale-cookies.ts`, the migration block in `storefront-proxy.ts`).
- **Risk — pruned `messages.wholesale`:** any untracked consumer of those keys would render a missing-message fallback. The repository has none (grep for the namespace and `useTranslations("wholesale")`, plus the six-locale parity check and the unit suite).
- **Unpruned:** other possibly-unused message namespaces (`orderPlaced`, `coupon`, `checkoutLayout`, `creditCards`, `giftCards`, `address`, `navigation`) are not touched — they are not Spree *code* and I could not prove each unused with the same standard.

## 12. Final verdict

**BLOCKED — on one owner decision (D-14, the inbound `/api/webhooks/spree` route).** Evidence: all Spree SDK, client, wrapper, env-read (except the webhook secret), package, E2E-harness and UI-branch dependencies are removed (ratchet 0/0/0/0/1; no `@spree/*` package; 57/57 browser, 3 569 unit tests, build green). The remaining route is retained only because an external sender cannot be ruled out; its code no longer depends on Spree packages. Once D-14 is answered, the follow-up is mechanical (§3) and the verdict becomes **CODE EXIT COMPLETE**.
