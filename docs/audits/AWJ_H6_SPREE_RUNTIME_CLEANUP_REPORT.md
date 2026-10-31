# AWJ H6 — Spree runtime cleanup

| | |
|---|---|
| Branch | `claude/h6-spree-runtime-cleanup` |
| PR | {{PR}} |
| Base SHA (origin/main) | `86867089d8b655e8f70d21648b1976eedd69dd4e` (#1853) |
| Head SHA | {{HEAD}} |
| CI | {{CI}} |

Storefront-only. No Laravel file, API contract, schema, accounting/VAT/ZATCA rule, payment/refund/cancellation path, tenant/channel isolation, buyer authentication, wholesale price precedence, or DTC cart/checkout behaviour was touched. Nothing was merged, deployed, migrated or activated.

**Result:** 35 files and 3 packages removed (−5 287 lines of code, +21 / −125 in edited files); Spree client accesses 52 → 45, wrapper imports 68 → 59. Everything removed had no live caller; everything uncertain was kept (§3).

---

## 1. Method (targeted, not a re-audit)

One reproducible import-graph pass over `storefront/src` (442 modules): treat every route file (`page|layout|route|…`), `proxy.ts` and instrumentation as live roots **except** the legacy `(checkout)` group, then list modules that no live root reaches. That list was then verified *per module* against **resolved** importers (tests, mocks and config included) — a fixed point, so a module is deleted only when every importer is itself deleted. The first grep-by-basename pass produced false importers (e.g. `cookies`, `categories`) and was discarded in favour of resolved paths.

A mistake caught by the post-delete recheck, recorded for transparency: `src/components/checkout/` is **mixed** — it holds the dead Spree checkout UI *and* the live AWJ-native checkout (`AwjCheckoutFlow`, `awj/*`, `CheckoutProgress`, `PaymentBrandMark`). A directory-level delete would have removed the native checkout; it was reverted before any commit and only the 12 dead files were deleted. The graph was re-run after deletion and now shows no live module depending on a deleted one (`tsc` clean).

## 2. Removed (all reversible by `git revert`; no data or schema involved)

| Group | Files | Why it is safe |
|---|---|---|
| Legacy Spree checkout routes `(checkout)/**` | `layout.tsx`, `CheckoutShell.tsx`, `checkout/[id]/{page,CheckoutPageContent,CheckoutSidebar}.tsx`, `confirm-payment/[id]/page.tsx`, `order-placed/[id]/page.tsx`, `layout.test.tsx`, `confirm-payment/__tests__/page.test.tsx` (9) | Layout `notFound()`ed unless the Spree add-on env is set; the deployed storefront defines **no `SPREE_*` variable**, and no Spree backend exists. The only thing that linked to these URLs (the wholesale portal) was removed in #1853. The proxy still answers a real 404 for these URLs (§4). |
| Spree checkout UI | `components/checkout/{AddressEditModal,AddressFormFields,AddressSection,AddressSelector,AdyenPaymentForm,CouponCode,DeliveryMethodSection,PayPalPaymentForm,PaymentSection,StripePaymentForm,Summary}.tsx`, `index.ts` (12) | Imported only by the removed routes (resolved-path check, tests included). The live AWJ checkout components in the same directory are untouched. |
| Spree order components | `components/order/{AddressBlock,OrderTotals,PaymentInfo}.tsx` (3) | Importers ⊆ removed set. |
| Checkout state/hook | `contexts/CheckoutContext.tsx`, `hooks/useCountryStates.ts` (2) | Importers ⊆ removed set. |
| Spree data wrappers | `lib/data/{addresses,countries,credit-cards,cookies}.ts` (4) | Importers ⊆ removed set; `cookies.ts` was the Spree-session `isAuthenticated()` helper with no caller. Removes 7 `getClient()` accesses. |
| Spree-only utilities | `lib/utils/{address,credit-card,payment-gateway,order-status,format}.ts` (5) | Importers ⊆ removed set (no test imported them). |
| Packages | `@adyen/adyen-web`, `@paypal/react-paypal-js`, `react-svg-credit-card-payment-icons` | No remaining importer in `src`, `e2e`, `scripts` or config after the deletions (grep across all). Lockfile change is **deletions only** (−93 lines, no version movement). |

## 3. Retained, and why (active, or uncertain ⇒ kept)

| Dependency | Class | Evidence / reason |
|---|---|---|
| `@stripe/stripe-js`, `@stripe/react-stripe-js`, `lib/utils/stripe.ts`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **Active (statically)** | Still imported by `components/checkout/ExpressCheckoutButton.tsx`, which the live `CartDrawer` renders for the Spree-cart branch. Runtime-dead (no Spree cart can exist) but removing it means editing the cart drawer + `CartContext` Spree branch — W1b. |
| `CartContext` `surface`, `CartDrawer` Spree branch, `data/{cart,checkout,payment,orders,express-checkout-flow,wholesale}.ts` | **Active (statically)** | Reachable from live routes through the cart provider/drawer. Dead *branches* in live files, not dead files; deleting needs behavioural edits to the DTC cart UI and their tests — separate, proportionate PR (W1b). |
| Header/Footer/MobileMenu wholesale links, `WholesaleSection`, `isWholesaleEnabled()`, `messages.wholesale` | **Uncertain / dead conditional** | Gated by `isWholesaleEnabled()` (false in production); `WholesaleSection` is a presentation-section key. Left to W1b. |
| Retail account pages (orders, addresses, credit-cards, gift-cards, wishlist, payment-methods, profile, auth forms) | **Active and required** | Live retail routes; capability states `gated`/`design_only`. They import `lib/data/customer` and the layout imports `getAccessToken/getRefreshToken` from `lib/spree`. No Spree *data* is rendered, but replacing them is a product decision, not a deletion. |
| `lib/spree/*` (middleware, locale, cookies, config, auth-helpers, jwt, surface) | **Active and required** | `middleware.ts` is the proxy for every request (locale/country, host context, legacy-URL 404/308, cookie attributes). Cookie names `spree_country/spree_locale` are a public contract. Rename-only later (R3). |
| `app/api/webhooks/spree` + `lib/webhooks/*`, `SPREE_WEBHOOK_SECRET` | **Uncertain — external contract** | Answers 503 today; unknown consumers (decision D-14). Kept. |
| `@spree/sdk` (10 non-test importers, incl. live `lib/commerce/{mappers,types,cart-types}.ts`, `data/{products,categories}.ts`) | **Active** | Types/values still flow through the live commerce mappers. Not removable until they are re-typed (T-track). |
| `@spree/cli`, `e2e:up`, `scripts/e2e/bootstrap-spree.sh`, `e2e-backend/` | **Uncertain** | The old Spree-backed e2e harness; `bootstrap-spree.sh` runs `npx @spree/cli seed`. Unknown whether anyone still runs it — kept for R4. |
| `SPREE_API_URL`/`PUBLISHABLE_KEY`/`WHOLESALE_*`/`WEBHOOK_SECRET` env reads (9) | **Active (code reads)** | Reads live in `lib/spree/config.ts`, `DocumentShell` (preconnect origin), the webhook route. None of these variables is set on the deployed storefront. |
| `components/ui/{card,category-image,alert-dialog,popover}`, `i18n/request.ts`, `lib/metadata/categories.ts` | **Unreferenced / kept** | Generic design-system primitives and a next-intl config (`i18n/request.ts` is loaded by the plugin, not by an import) — not Spree-specific; not part of this exit. |

## 4. Historical links and contracts

- `/{checkout,confirm-payment,order-placed}/{id}` (and dotted ids, `/checkout/Payment-Return` spellings) keep answering a **real 404** from the proxy. The proxy guard no longer depends on the Spree add-on env (the pages are gone, so the env can no longer open them); four middleware tests that asserted "lets it through when the add-on is enabled" were **changed to assert the closed behaviour** (a disclosed, intended behaviour change).
- The native checkout (`/checkout`, `/checkout/payment-return`) is unchanged and still tested (`AwjCheckoutFlow*`, `PaymentReturn*`, `PaymentStage`, no-Spree-env guard).
- `no-spree-env.test.ts`: its X5 case imported the deleted layout; it now asserts the route group no longer exists (the closure itself is covered by the middleware tests). No other guard was weakened.
- Legacy `/wholesale/*` redirects (from #1853) untouched.

## 5. Spree counters (`pnpm check:spree-ratchet`)

| Counter | Before | After |
|---|---|---|
| `spree_value_imports` | 4 | 4 |
| `spree_type_imports` | 4 | 4 |
| `spree_client_access` | 52 | **45** |
| `spree_wrapper_imports` | 68 | **59** |
| `spree_env_reads` | 9 | 9 |

Baseline tightened in this PR. Packages with Spree/payment SDKs: 5 → 2 payment SDKs (`@stripe/*` retained), 3 removed.

## 6. Verification (proportionate)

| Check | Result |
|---|---|
| Import-graph recheck after deletion | no live module depends on a deleted one; only generic UI primitives, `i18n/request.ts` and one test-only util remain unreachable |
| `tsc --noEmit`, Biome lint | clean (6 warnings / 3 infos pre-existing) |
| Affected suites (`lib/data`, `lib/spree`, `components/checkout`, `components/cart`, `contexts`) | 524 tests; the 4 changed middleware tests pass in their new form |
| Full storefront `pnpm test` | {{UNIT}} |
| Production build (`pnpm build`) | {{BUILD}} |
| Spree ratchet | OK at the new, lower baseline |
| Backend SQLite / PostgreSQL | not run — no backend change |
| Browser suite | not run — routing/auth/cart/checkout behaviour is unchanged for every URL that existed in production before (the removed routes were already 404 there) |
| CI Gate | {{CI}} |

## 7. Remaining blockers and exact next action

Nothing here changes the BLOCKED verdict of the acceptance report for **wholesale activation** (no isolated environment; mail and client-IP trust unverified). For the Spree exit itself:

1. **Merge this PR** (low risk; reversible).
2. **W1b — one PR**: remove the dead *branches* in live files: `CartContext.surface` + Spree actions in `data/cart.ts`, the Spree branch and `ExpressCheckoutButton` in `CartDrawer`, then `data/{checkout,payment,orders,express-checkout-flow,wholesale}.ts`, `lib/utils/{stripe,express-checkout}.ts`, `@stripe/*` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, the `isWholesaleEnabled()` links and `WholesaleSection`/`messages.wholesale`. Needs DTC cart/drawer tests and one browser run (cart/checkout is touched).
3. **Owner decisions** before R2–R4: D-14 (webhook), whether `e2e-backend`/`bootstrap-spree.sh`/`@spree/cli` are still run, and replacement scope for retail account pages.
4. Then R3 (rename `lib/spree` + cookies with a one-release dual read) and R4 (drop `@spree/sdk`, config, docs) when the counters reach 0.
