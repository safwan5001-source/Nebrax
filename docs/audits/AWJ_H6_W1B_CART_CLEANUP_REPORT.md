# AWJ H6 — W1b: remove dead Spree branches from the live cart

| | |
|---|---|
| Branch | `claude/h6-w1b-cart-cleanup` |
| PR | _filled in when opened (see the PR page)_ |
| Base SHA (origin/main) | `ec79c16eff43bdee26a6b0273bdb402e5d2e328b` (#1856) |
| Head SHA | code head `2ee7a350c5f1dee620e106d656d31f396a6dd964`; any later commit on the branch changes this report only |
| CI | see the PR's checks (the PR page is the source of truth) |

Storefront-only. No Laravel file, API contract, schema, accounting/VAT/ZATCA rule, payment capture/refund path, tenant/channel isolation, buyer authentication, wholesale price precedence or AWJ cart/checkout behaviour was touched. Nothing was merged, deployed, migrated or activated; wholesale stays off.

**Result:** 39 files changed (+236 / −3 887). The live cart is now a single AWJ-native path (`StorefrontCart`): the `surface` concept, every Spree cart action and the Stripe express-checkout button are gone from it. Spree client accesses 45 → 20, wrapper imports 59 → 26, value imports 4 → 3.

---

## 1. Method

Same reproducible import-graph pass as the previous cleanup (roots = every route file, `proxy.ts`, instrumentation; per-module *resolved* importers, tests/mocks/config included; fixed-point deletion). Rule: a module is deleted only when **every** importer is itself deleted or edited out, and the graph is re-run afterwards. `src/components/checkout/` is mixed (live AWJ checkout beside dead Spree UI), so only named files were removed, never the directory.

## 2. Live files simplified (dead *branches* removed)

| File | Removed | Kept |
|---|---|---|
| `contexts/CartContext.tsx` | `surface` prop/field, `AnyCart`, `isAwj` branching, the Spree actions (`addToCart`, `getCart`, `updateCartItem`, `removeCartItem`), the `/order-placed/` refresh special-case (that route no longer exists) | AWJ actions (`getAwjCartState`, `addAwjItem`, `updateAwjItem`, `removeAwjItem`), `accessIssue` handling and its localized wording, add-on lines excluded from `itemCount`, refresh on navigation |
| `components/cart/CartDrawer.tsx` | Spree line view, discount block, `ExpressCheckoutButton`, express-processing state, GA4 `view_cart`/`remove_from_cart` for Spree carts | AWJ lines + add-on grouping, server-sent subtotal, `CouponField`, checkout (`/checkout`) and cart links |
| `app/.../cart/page.tsx` | `isStorefrontCart` narrowing, Spree `view_cart` effect | AWJ cart page unchanged |
| `hooks/useCountrySwitch.ts` | Spree-only `updateCartMarket` sync | cookies, redirect rebasing, navigation, loading guard |
| `components/products/{ProductCard,QuickView}.tsx`, `products/[slug]/ProductDetails.tsx` | `surface === "wholesale"` branches (link-only card, hidden quick view, empty gifting, Spree variant-id add-to-cart fallback) | the single AWJ add-to-cart path, gifting/personalization selections, variant-managed rule |
| `lib/data/cart.ts` | `getCart`, `getOrCreateCart`, `addToCart`, `updateCartItem`, `removeCartItem`, `clearCart` and all `@/lib/spree` imports | the five AWJ actions |

## 3. Deleted (no active caller — evidence)

| Module | Importers before | Why safe |
|---|---|---|
| `components/checkout/ExpressCheckoutButton.tsx` | `CartDrawer` (Spree branch only) | branch removed; runtime-dead (no Spree cart can exist) |
| `lib/data/express-checkout-flow.ts` | `ExpressCheckoutButton` | importer deleted |
| `lib/data/payment.ts` | `express-checkout-flow`, its test | importers deleted |
| `lib/data/checkout.ts` | `useCountrySwitch` (removed branch), `payment`, `express-checkout-flow`, tests | importers deleted/edited |
| `lib/data/orders.ts` | `checkout`, `payment` | importers deleted |
| `lib/data/wholesale.ts` | `checkout`, `wholesale-boundary.test.ts` (its characterization half) | importers deleted/edited |
| `lib/utils/stripe.ts`, `lib/utils/express-checkout.ts` | `ExpressCheckoutButton` (+ a unit test) | importer deleted |
| `lib/utils/completed-order-cache.ts` | `ExpressCheckoutButton` (dynamic import) | importer deleted; surfaced by the post-delete graph |
| Packages `@stripe/stripe-js`, `@stripe/react-stripe-js` | only `utils/stripe.ts` / `ExpressCheckoutButton` (grep across `src`, `e2e`, `scripts`, configs: zero remaining) | lockfile change is deletions only (−48 lines, no version movement) |
| `.env.example` `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | read only by `utils/stripe.ts` | no reader remains |

The graph re-run after deletion: 400 modules, 63 roots, **6** unreachable — all generic UI primitives, `i18n/request.ts` (loaded by the next-intl plugin) and `lib/metadata/categories.ts`; none Spree- or cart-related.

## 4. Tests changed (disclosed; nothing for live behaviour weakened)

- **Deleted with their subject:** `data/__tests__/{checkout,payment,resolve-surface}.test.ts`, `utils/__tests__/express-checkout.test.ts`.
- **Reduced:** `wholesale-boundary.test.ts` lost the two blocks characterizing the deleted `data/wholesale.ts`; its architecture guard ("AWJ-native commerce modules stay Spree/wholesale-free") is kept. `data/__tests__/cart.test.ts` lost the Spree-action blocks, kept every AWJ action case and gained a static guard that `data/cart.ts` imports neither `@/lib/spree` nor `@spree/*`. `CartContext.test.tsx`, `useCountrySwitch.test.ts`, `ProductCard/QuickView/ProductDetails(.gifting)` tests lost their `surface: "wholesale"` cases (those asserted removed behaviour); `surface` mocks dropped from the product list tests.
- **Guard kept honest:** `wholesale-buyer.architecture.test.ts` listed deleted files (`data/{checkout,orders,payment}.ts`) in its "buyer token never leaks" and "no shared cache" lists; they now name the live `lib/data/awj-checkout.ts`, so those guards still read a real file.
- Not touched: all AWJ cart/checkout/payment-return tests, Quick Order and wholesale-buyer UI tests, route/middleware guards, isolation and price-precedence assertions.

## 5. Spree counters (`pnpm check:spree-ratchet`)

| Counter | Before | After |
|---|---|---|
| `spree_value_imports` | 4 | **3** |
| `spree_type_imports` | 4 | 4 |
| `spree_client_access` | 45 | **20** |
| `spree_wrapper_imports` | 59 | **26** |
| `spree_env_reads` | 9 | 9 |

Baseline tightened in this PR. Spree/payment SDK packages: `@stripe/*` removed; `@spree/sdk`, `@spree/cli` remain.

## 6. Verification

| Check | Result |
|---|---|
| Import-graph recheck | no live module depends on a deleted one (§3) |
| `tsc --noEmit` (after `rm -rf .next`) | clean |
| Biome check | clean (the same 6 warnings / 3 infos as before) |
| `check:locales` | all six locales in sync |
| Full storefront `pnpm test` (clean env: `AWJ_*`/gateway vars unset) | **249 files / 3 589 tests passed**, 16 skipped (pre-existing). Fewer files/tests than the previous 253 / 3 666 because the deleted modules' tests are gone. Includes `CartContext`, `CartDrawer`, `CartLine/Summary/EmptyState/CouponField`, ProductCard/QuickView/ProductDetails, Quick Order and wholesale-buyer UI, AWJ checkout/payment-return, proxy/middleware, route-inventory and `no-spree-env` guards |
| Spree ratchet | OK at the new baseline |
| Production build | `pnpm build` (Next 16, Turbopack) compiled and finished TypeScript inside the stack boot, exit 0; it prints the same `Sitemap index unavailable … headers() inside generateStaticParams` notice from sitemap code this PR does not touch |
| Browser regression (ONE run, real Laravel on a throwaway SQLite, production `next start`, Chromium, desktop-en 1280×900 + mobile-ar 390×844) | **56 / 56 passed** (3.6 min): D01 retail browsing, **D02 retail cart → checkout → confirmed order**, wholesale journey 01–… (sign-in, register, verification, price precedence, security C-series), Quick Order Q-series incl. **Q12 Arabic/RTL on a phone**, E01–E03 mobile Arabic, H01–H08 closure (real 404s, redirects, headers, cookies) |
| Backend SQLite / PostgreSQL | not run — no backend file changed |
| CI Gate | see the PR's checks |

Run history, stated plainly: the first browser attempt reported 13 failures that were all `browserType.launch: Executable doesn't exist` (the pinned Playwright looks for `chromium_headless_shell-1223`; the sandbox ships `-1243`). That is a sandbox/harness path issue, not the code; the same single run was repeated with `PW_CHROMIUM_PATH` set to the installed headless shell (the config's documented override) against the same stack and passed 56/56. A first attempt to boot the stack also died because my own shell was killed by a `pkill -f` pattern; the stack was brought up cleanly afterwards.
Not exercised in the browser: the **cart drawer** itself (the D02/E02 journeys use the cart page); it is covered by the `CartDrawer` unit suite above.

## 7. Retained dependencies and remaining blockers

| Item | Class | Reason |
|---|---|---|
| `lib/spree/*`, `proxy.ts` (middleware) | Active, required | proxy for every request; cookie names `spree_country/spree_locale` are a public contract |
| `lib/commerce/surface.ts` (`Surface` type), `isStorefrontCart`/`cart-types.ts` | Active | `Surface` is still used by `lib/spree/*` and `data/products`; `isStorefrontCart` by the cart mappers/tests — left alone to avoid a new abstraction |
| `lib/data/{customer,markets}.ts`, retail account pages, auth forms | Active, required | live retail account routes; replacement is a product decision |
| `app/api/webhooks/spree` + `lib/webhooks/*`, `SPREE_WEBHOOK_SECRET` | Uncertain — external contract | unchanged (owner decision D-14) |
| `@spree/sdk` | Active | still types/values in `lib/commerce/{mappers,types,cart-types}.ts`, `data/{products,categories}.ts` |
| `@spree/cli`, `e2e/checkout.spec.ts`, `scripts/e2e/bootstrap-spree.sh` (still mentions Stripe keys) | Uncertain | the old Spree-backed e2e harness; unknown whether anyone runs it |
| `isWholesaleEnabled()` links in Header/Footer/MobileMenu, `components/home/WholesaleSection.tsx`, `messages.wholesale` | Dead conditional (false in production) | not part of the cart; deliberately not bundled into this PR |
| Wholesale activation | BLOCKED (unchanged) | no isolated environment; mail and client-IP trust unverified |

## 8. Recommended next removal scope

1. **W1c (one PR):** remove the `isWholesaleEnabled()`-gated links (Header, Footer, MobileMenu), `WholesaleSection` and `messages.wholesale` (six locales), then `isWholesaleEnabled`/`getWholesaleClient`/`WHOLESALE_*` from `lib/spree/config.ts` and the matching env reads; tighten the ratchet again. Needs header/footer unit tests and the same browser run.
2. **Owner decisions** before R3/R4: D-14 (webhook), whether `e2e-backend` / `bootstrap-spree.sh` / `@spree/cli` are still run, replacement scope for retail account pages.
3. Then R3 (rename `lib/spree` + cookies with a one-release dual read) and R4 (drop `@spree/sdk`, config, docs) once the counters reach 0.
