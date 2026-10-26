# AWJ X5b — Real HTTP 404 for legacy Spree checkout routes

- **Branch:** `claude/x5b-legacy-checkout-404` · **Base SHA:** `a9ba9bd58` (origin/main) · **PR / Head SHA / CI:** see PR. No merge, no deploy.

## Root cause and evidence
ENV0 curl showed `/sa/ar/{checkout,confirm-payment,order-placed}/awj-x5-verification` → **HTTP 200** (render of the 404 UI + `noindex`), control path → 404.

Reproduced locally with `next build` + `next start` (Next 16, `cacheComponents: true`): the three routes returned **200** with `x-nextjs-prerender: 1`, `x-nextjs-postponed: 1` and the `NEXT_HTTP_ERROR_FALLBACK;404` marker in the body; `/us/ar/zz-nonexistent-awj-probe` returned **404**. With PPR the route's shell is prerendered and streamed; the layout's `notFound()` (X5, #1765) is evaluated inside that response, after the 200 status line is committed. A layout-level `notFound()` therefore cannot set the status. (Inference from reproduced headers/body; the same mechanism is documented for streamed responses.)

## Solution
The decision moves **before rendering**, into the existing locale proxy:
- `storefront/src/lib/spree/middleware.ts` (`createSpreeMiddleware`): after the `/{country}/{locale}` prefix is confirmed canonical, if `!isWholesaleEnabled()` and the localized path is `checkout/<id>`, `confirm-payment/<id>` or `order-placed/<id>` (single segment, `payment-return` excluded by **raw** comparison), respond with `NextResponse.rewrite` to `{prefix}/awj-legacy-checkout-closed` — a path that matches no route, so the framework itself produces its standard 404 (same page/status as any unknown URL). No redirect, no data fetch, no Spree call, search string dropped.
- `isWholesaleEnabled()` stays the **single source of truth** (imported from `./config` inside the wrapper dir — not counted by the ratchet; nothing duplicated).
- The `(checkout)/layout.tsx` gate is **kept as defence in depth**: the proxy matcher skips paths containing a dot (e.g. `checkout/a.b`), which still reach the layout and get the 404 page (soft status, loads nothing). Comment updated; behaviour unchanged.

Decoding note: the router matches static segments literally, so `checkout/%70ayment-return` and `checkout/Payment-Return` resolve to the legacy `[id]` page (verified: previously soft-404) and are closed; only the exact `payment-return` stays AWJ-native.

## Files changed
`storefront/src/lib/spree/middleware.ts`, `middleware.test.ts`, `storefront/src/app/[country]/[locale]/(checkout)/layout.tsx` (comment only), tracker row X5b, this report.

## HTTP verification (local production build, `next start`, wholesale unset)
| Path (`/us/ar/…`) | Status | Redirects | noindex |
|---|---|---|---|
| `checkout/awj-x5-verification` | **404** | 0 | yes |
| `confirm-payment/awj-x5-verification` | **404** | 0 | yes |
| `order-placed/awj-x5-verification` | **404** | 0 | yes |
| `checkout/%70ayment-return`, `checkout/Payment-Return` | **404** | 0 | yes |
| `zz-nonexistent-awj-probe` (control) | 404 | 0 | yes |
| `checkout` (AWJ) | 200 | 0 | no |
| `checkout/payment-return` (AWJ) | 200 | 0 | no |

Locale-less `/checkout/abc` still takes the existing 307 to the prefixed path (pre-existing behaviour), where it then 404s. The 404 body contains no Spree strings.

**Wholesale enabled** (build and runtime with `SPREE_WHOLESALE_CHANNEL` set): the three legacy routes return 200 without the 404 marker (pass through to the legacy shell as before); AWJ routes 200; control still 404. Full legacy flow against a real Spree backend was **not** exercised (none available) — only the gate behaviour.
No orders, payments or Spree/API calls were made.

## Tests
- `src/lib/spree/middleware.test.ts` +11 tests: rewrite for each legacy route, no `Location`, odd spellings closed, AWJ routes (`/checkout`, `/checkout/payment-return`, `/cart`) untouched, deeper/unrelated paths untouched, wholesale enabled passes through, prefix canonicalisation still precedes the gate.
- Focused (middleware, proxy, `(checkout)` layout, checkout-routes structure, No-Spree env): 84 passed. Full storefront vitest: 3426 passed / 16 skipped. `tsc --noEmit` clean; biome no errors; `next build` OK.
- Spree ratchet: **unchanged** — value 4, type 147, client 68, wrapper **77**, env 9 (no increase; no baseline edit).

## Tenant isolation / security
Host resolution untouched; the gate keys only on the process env flag and the path, so there is no tenant-specific branching, no host bypass and no cross-tenant configuration read. The rewrite target is a fixed string under the request's own canonical prefix. No redirect, no new data exposure; response is the standard 404.

## Risks and remaining ENV0
- The flag is read per request in the proxy but the layout's gate is evaluated at build time for the prerendered shell; deployments set the env at build+runtime (as the wholesale layout already assumes).
- Dotted ids still return the 404 page with status 200 (proxy matcher skips them); negligible, `noindex`, no data.
- **Live verification is still required** after deployment (re-run the ENV0 curls on `alrshd.store.awjdev.xyz`); not done here. Remaining ENV0: that re-check, active storefront SHA, wholesale test-or-deferral, owner sign-off. ENV0/H0 stay open.

## Next action
Review/merge, deploy to Beta with explicit approval, re-run the three curls, then update tracker §5 with the live result.
