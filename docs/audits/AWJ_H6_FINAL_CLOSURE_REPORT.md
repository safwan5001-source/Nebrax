# AWJ H6 — Final closure report

| | |
|---|---|
| Branch | `claude/h6-final-closure` |
| PR | __PR__ |
| Base SHA (origin/main) | `89f4117ca1d6d2d3bbdc6b3e77482305e663f6a2` (#1832, Batch M) |
| Head SHA | __HEAD__ |
| Related open PR | #1836 (Batch N verification report) — see §1 |
| CI | __CI__ |

Nothing was merged, deployed, restarted or migrated against a deployed environment; no environment variable was changed; wholesale stays disabled by default; no Spree code or route was deleted. The E2E seed ran only against a throwaway local SQLite file.

---

## 0. Can H6 be declared complete?

**Not yet — and the reason is no longer engineering depth, it is four explicit decisions/actions that belong to the owner.** Everything that could be fixed and proven without touching a deployed environment is fixed and proven (§2–§5, §7). What remains:

| # | Remaining item | Why it blocks "complete" | Who |
|---|---|---|---|
| R1 | **Deploy order and verification of this PR** (API first, then storefront), then re-run the §6 read-only checks against the deployed hosts | The fixes are proven locally; they are not live until deployed. Deployed SHAs/migrations/flags are still UNKNOWN from outside | owner (deploy), me (re-verify) |
| R2 | **Quick order by SKU** — the one Spree journey feature with no native replacement | Build or formally discontinue; until then the Spree wholesale group cannot be deleted | owner decision |
| R3 | **AWJ Web deployment FAILED at `89f4117ca`** — root cause not provable without the Railway build log (§4) | A failed web deploy means the staff UI for partner linking (Batch M) is not live | owner (read the log / redeploy) |
| R4 | **Isolated environment for the deployed wholesale browser run**, mail delivery, trusted-proxy evidence | Wholesale cannot be activated on the shared environment; the suite refuses non-loopback targets by design | owner authorization |

Open commercial rules (MOQ, B2B tax, terms) are unchanged and are *not* invented here.

---

## 1. PR #1836 — closed out

* **Why `CI Gate` was red.** The gate waits for the required checks on the head SHA. On `78e0f0cd2` the `php artisan test (L11, pgsql)` job failed once. The uploaded `test-output-pgsql` artifact shows **one failure in 10,333 tests**: `Tests\Feature\AiActionHistoryListTest::an_executed_action_carries_its_latest_execution_and_row_counts_without_n_plus_one` — `Failed asserting that 24 is identical to 23` (a query-count assertion).
* **Classification.** Not report drift (the PR touches one markdown file), not a required-check configuration problem (the gate behaved correctly), not a regression from this work. It is an order-dependent flake in an unrelated AI-actions query-count test; the same commit passed SQLite, `main` at `89f4117ca` (identical code) passed both databases, and the pgsql job **passed on one re-run**. No code was changed for it. *Follow-up (not done here):* harden that test (compare against a second warmed measurement, or pin the cache state) so it stops costing a CI cycle.
* **Report updated** (`ff3ffced`): owner-provided Railway evidence recorded as reported — Storefront **SUCCESS** and Laravel API **SUCCESS** at `89f4117ca`, AWJ Web **FAILED** at `89f4117ca` — with the explicit statement that a successful API deployment does **not** verify the Batch M migrations or the runtime flags; both stay UNKNOWN until the `migrations` table and the non-secret variables are read.
* **Independent confirmation of the storefront claim.** At 09:44Z the public storefront's i18n catalogue carries the Batch M keys (`forgot`, `orders`, `reset`); at 07:57Z it did not. That fits a build that finished after the first probes.
* `CI Gate` on #1836 was re-run after the pgsql job went green: __N_GATE__

---

## 2. Storefront defects — fixed at the right boundary

**Root cause shared by three of them.** With `cacheComponents` (PPR) the storefront streams its response, so by the time a page calls `notFound()` the `200` status line has already been sent (`x-nextjs-postponed: 1`). A `notFound()` inside a layout/page can therefore never produce a real 404. The only place that can is the **proxy** (`src/proxy.ts`), which runs before rendering — the same mechanism X5b already uses for legacy checkout (rewrite to a path that matches no route). I reused it rather than inventing another.

**New finding while fixing them (Batch N supplement).** The native buyer pages (`/buyer/sign-in`, `/orders`, `/forgot-password`, …) were **live on the retail tenant** with wholesale wording ("This is a wholesale store…") because nothing told the storefront whether a host is wholesale. That is closed here too, using one additive, boolean-only API field.

| Defect (verified on `alrshd.store.awjdev.xyz`) | Fix | Boundary |
|---|---|---|
| No security headers | HSTS (`max-age=31536000`, no `includeSubDomains`/`preload`), `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, `Permissions-Policy` (camera/microphone/geolocation off) | `next.config.ts` `headers()` — the application, because the Railway edge adds none |
| Unknown tenant host → `200` empty shell | Real 404 for every localized page when the API gives its **definitive** "no valid store" 404; any other failure fails **open** (a blip never 404s a live store); stale-answer window 10 min; off-switch `STOREFRONT_UNKNOWN_HOST_404=0` | proxy + `GET store/v1/storefront` |
| Legacy `/wholesale/*` → `200` soft-404 | Real 404; on a **native wholesale host** they redirect 308 to the native equivalent (`/wholesale`, `/sign-in` → `/buyer/sign-in`; `/apply` → `/buyer/membership`; `/cart` → `/cart`; `/products[/…]` → `/products`), query preserved; no equivalent ⇒ 404. When the Spree wholesale add-on is **on**, the portal is untouched | proxy |
| Native `/buyer/**` live on retail hosts | Real 404 unless the API says wholesale is open for that host (fail closed for the capability) | proxy + `capabilities.wholesale_buyer` |
| `/sa` → `/sa/ar/sa` → 404 | A bare 2-letter country goes to `/{country}/{locale}` with the usual locale negotiation; `/products`-style bare pages unchanged | proxy |
| `spree_country`/`spree_locale` not Secure/HttpOnly/SameSite | `HttpOnly`, `SameSite=Lax`, `Secure` in production. Names, values, path and max-age unchanged; only the server reads them (verified: no `document.cookie`, writes only in the proxy) | proxy |
| Header/footer "My account / Order history" → Spree `/account` (L2) | On a native wholesale host they point to `/buyer/membership` and `/buyer/orders` (header, footer, mobile menu); retail unchanged | layout + `account-links.ts` |

**CSP — deliberately not set.** A resource-restricting CSP would need an inventory of every script/style/image/connect origin in use (Sentry, payment redirects, R2 media proxy, store customization) and a report-only soak; none of that can be done safely from here, and a wrong CSP breaks checkout. Only `frame-ancestors` is set, because nothing embeds the live storefront (the customizer previews an in-workspace canvas — ARCH-1 — and payment redirects are top-level). Pinned by `next-config-headers.test.ts`, which also asserts no `default-src`/`script-src`/… appears.

**Preserved:** locale redirects and cookie values, the account redirect for protected pages, legacy checkout X5b closure, static assets and `/icon`, tenant isolation (the host context is read per Host from the API; nothing is inferred from the URL), DTC pricing/cart/checkout (E2E D01/D02 green).

**Deploy order matters:** API first, then storefront. A new storefront against an old API sees no `capabilities` ⇒ every host is "not wholesale" ⇒ native buyer pages 404. With wholesale disabled everywhere today that is harmless; it only matters at activation time.

**Deploy note (owner decision):** Railway's default platform domain for the storefront service is not a tenant host, so it will now answer 404 instead of the generic shell. Set `STOREFRONT_UNKNOWN_HOST_404=0` on that service if that domain is still used for demos.

---

## 3. Backend change (additive, read-only)

* `App\Services\Commerce\WholesaleBuyerGate` — the single definition of "wholesale buying is open on this host" (deployment flag **and** a wholesale-flagged web channel on the Host-resolved context). `EnsureWholesaleBuyerEnabled` now delegates to it (behaviour identical, covered by the existing wholesale suites).
* `StorefrontConfigController` adds `data.capabilities.wholesale_buyer` (boolean). No identifiers, no tenant/channel data, no write path, no migration.
* `StorefrontWholesaleCapabilityTest` (6 tests): open host, flag off, retail host, another tenant's wholesale channel does not open a retail host, unknown host / missing / wrong secret resolve nothing, payload is exactly `{wholesale_buyer: bool}`.

---

## 4. AWJ Web deployment failure at `89f4117ca`

**I cannot read the Railway build log from this session, so the root cause is not proven.** What I could establish:

* The web diff in Batch M is six TS/TSX files in one module (`commerce-workspace/wholesale/sections/buyers/*`, +507/−18). No `package.json`, lockfile or `next.config.mjs` change since the previous merge.
* `web build (Next.js)` was **green in CI** on the Batch M head and on `main` at `89f4117ca`.
* I built `web/` locally from the same tree with the same command Railway uses (`npm run build`): **exit 0** (3 m 52 s cold, 2 m 51 s warm; peak RSS of the largest process **≈ 2.8 GB**; types and lint pass; 218 static pages).
* `web/` fetches **~15 Google font families at build time** (`next/font/google` in `src/app/layout.tsx` and `store-experience-builder/presentation/fonts.ts`). A single failed font fetch aborts `next build`. The identical failure class hit the storefront `docker-context` job today (`module-not-found` on `cairo_*.module.css`) and passed on re-run.

**Most probable cause (unproven): a transient Google-Fonts/network failure, or a memory/time limit on the Railway builder, during that one build — not the code.** To confirm, search the failed deployment's build log for: `Failed to fetch` / `from Google Fonts` / `module-not-found` (fonts), `exit code 137` / `Killed` / `SIGKILL` (memory; local peak is ~2.8 GB), or `npm ERR!` (registry).

**Minimal repair:** redeploy the same commit (owner action; no code change). **Durable repair (not done, own PR):** self-host the font faces with `next/font/local` so the build has no external dependency; it touches ~15 families and needs visual verification, so it was not bundled here.

---

## 5. Native wholesale vs. the remaining Spree dependencies

Only what the buyer journey needs; no financial policy invented; nothing deleted.

| Journey step | Native state | Evidence | Spree still needed? |
|---|---|---|---|
| Authentication, e-mail verification, session | built (K/M) | E2E 02–05, 15; unit; PG | no |
| Buyer account / membership states / company+phone | built (M) | E2E 06–07, 14; unit | no |
| Password reset | built (M); **delivery needs production mail** (unverified) | E2E G01 (log mail) | no |
| Pricing precedence, partner linking | built (J/M) | E2E 08–09, 13b, price-precedence; PG | no (Spree had none) |
| Product listing / variants / search / sort | built (G/J) | E2E 08–09; PHP precedence suite | no |
| Cart (buyer-owned, cross-context) | built (K) | E2E 10–11, C09 | no |
| Checkout, order, double-submit safety | built (K), **non-capturing** | E2E 12–13, C10 | no |
| Order history / detail | built (M) | E2E 13c, E03 | no |
| **Payment-method compatibility** | COD/pickup verified; the buyer's linked partner flows into the order via `CustomerPartnerResolver::linkedPartnerId()`; **online payment for wholesale is not enabled** (H4 gates unchanged, capture disabled) | E2E 12–13; code read of checkout payment-methods | no — but online wholesale payment is *not* a verified capability |
| Account / order-history navigation | fixed here (L2) | E2E H04 | no |
| Legacy `/wholesale/*` URLs and redirects | fixed here | E2E H01, H03, H08 | route group still present, now unreachable unless the Spree add-on is on |
| **Quick order by SKU** | **not built** | — | **yes — only Spree has it** |

**Quick order — decision requested, not guessed.** Feasible without new financial rules: `store/v1/products?search=` already matches `sku` (product and variant), and `POST cart/items` accepts `product_id` + `product_variant_id` + `quantity` under the same price gating. A native page (`/buyer/quick-order`: "SKU, qty" lines → per-line added / not found / ambiguous / not purchasable) is roughly one focused slice with tests. I did not build it in this closure because it needs buyer-token propagation through the *cached* product-list path (a correctness-sensitive area), a new route and six-locale strings, and the owner may prefer to discontinue it. **Choose: build, or discontinue.** Until then `/wholesale/quick-order` answers a real 404 on non-Spree hosts rather than a misleading page.

---

## 6. Deployment findings (read-only, from Batch N + owner evidence)

* Owner-reported Railway: Storefront SUCCESS and API SUCCESS at `89f4117ca`; **AWJ Web FAILED** at `89f4117ca` (§4).
* Public surface at 09:44Z: storefront carries Batch M; API carries Batch M routes; gateway and direct-API boundaries PASSED (Batch N §4).
* **Still UNKNOWN / BLOCKED:** exact deployed SHAs from outside, Batch M migrations, flag values, production mail (`MAIL_MAILER=resend`, sender domain), trusted-proxy chain (D-T1), per-visitor rate limiting.
* **Only the pre-fix defects remain live until this PR is deployed.** After deploying, re-run the Batch N §9 commands plus: `curl -sI <storefront>/sa/en/products` (headers), `…/sa/en/buyer/sign-in` (expect 404 on retail), `…/sa/en/wholesale` (404), a random subdomain (404), `…/sa` (→ `/sa/ar`).

---

## 7. Verification

| Check | Result |
|---|---|
| Storefront `tsc --noEmit` | clean |
| Storefront lint (`biome lint`) | no errors (6 warnings, 3 infos — pre-existing) |
| Storefront unit tests (`vitest run`) | __UNIT__ |
| `pnpm check:locales` | in sync |
| `pnpm check:spree-ratchet` | **at baseline, no growth**: `value_imports=4 · type_imports=4 · client_access=52 · wrapper_imports=69 · env_reads=9` |
| Storefront production build | __BUILD__ |
| AWJ Web `npm run build` (local, same tree) | exit 0, peak ≈ 2.8 GB |
| PHP focused, **SQLite** | 303 passed, 26 skipped (2,756 assertions) — wholesale, storefront config/identity/policy, boundary, gateway/IP, buyer account, partner link, precedence, checkout, cart, domain |
| PHP focused, **PostgreSQL 16** | **333 passed** (3,198 assertions) — same set + `BranchIsolationGuard` |
| New PHP tests | `StorefrontWholesaleCapabilityTest` (6) |
| New/extended storefront tests | `middleware.test.ts` (+17 closure cases), `edge-storefront-locale.test.ts` (+7), `storefront.test.ts` (+2), `account-links.test.ts` (2), `next-config-headers.test.ts` (3) |
| Browser E2E (existing Batch L/M suite, Chromium, loopback throwaway stack) | __E2E__ |
| `CI Gate` / CI on this PR | __CI_RESULT__ |

**Changed existing tests:** none weakened. `middleware.test.ts`, `edge-storefront-locale.test.ts` and `storefront.test.ts` only gained cases; the E2E spec gained H01–H08. Behaviour covered by the old cases (locale fall-through, fail-closed resolver, cookie values, X5b) still passes unmodified.

---

## 8. Files changed

__FILES__

---

## 9. Spree dependencies still active, and the safe-removal decision

Ratchet (unchanged): 4 value imports, 4 type imports, 52 client accesses, 69 wrapper imports, 9 env reads. Still Spree-backed in `src/`: `lib/data/{cart,checkout,customer,orders,addresses,payment,credit-cards,markets,countries,cookies,wholesale}.ts`, `lib/commerce/{surface,capabilities,cart-cookies}.ts`, `components/layout/{Header,Footer}.tsx` (the `isWholesaleEnabled()` links), `components/home/WholesaleSection.tsx`, `proxy.ts`/`lib/spree/middleware.ts`, `app/api/webhooks/spree`, the `(wholesale)`, `(storefront)` and `(checkout)` route groups, `@spree/sdk`/`@spree/cli`.

| Item | Decision |
|---|---|
| `(wholesale)` route group, `lib/spree` wholesale client, `SPREE_WHOLESALE_CHANNEL` | **Not removable yet.** Everything except quick order has a verified native replacement; removal needs R2 (build or discontinue) and one wholesale host proven on a deployed isolated environment (rollback path) |
| Legacy `checkout/[id]`, `confirm-payment`, `order-placed` routes | **Safe removal candidate** (already closed with a real 404; delete in a cleanup PR) |
| `components/home/WholesaleSection.tsx` Spree link | **Safe removal candidate** after the same precondition as the wholesale group |
| `app/api/webhooks/spree` | **Blocked** — cannot confirm "no Spree store live for any tenant" without Railway access |
| `spree_country`/`spree_locale` cookie *names* | **Unsafe to rename now** (readers are in `lib/data/{cookies,markets,countries}`); their security attributes are fixed here |
| `lib/data/*`, `(storefront)`/`(checkout)` groups, `@spree/*` | **Unsafe to remove** — still the DTC backbone |

**Spree is not removed, and nothing here authorizes removal.**

---

## 10. Authorization / decisions requested

1. **Deploy** this PR (API first, then storefront) — or tell me to wait; then I re-run §6 against the deployed hosts.
2. **R3:** paste the failed AWJ Web build log (or redeploy the same SHA); I will confirm the cause.
3. **R2:** build or discontinue quick order.
4. **R4:** an isolated Railway environment (own DB) for the deployed wholesale browser run, a mail sink/verified sender, the proxy-chain evidence, and `STOREFRONT_UNKNOWN_HOST_404` for the default platform domain.
5. Optional small PRs: self-host web fonts; harden `AiActionHistoryListTest`; a CSP report-only soak after an origin inventory.
