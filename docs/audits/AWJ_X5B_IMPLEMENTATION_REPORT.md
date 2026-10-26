# AWJ X5b — Real HTTP 404 for legacy Spree checkout routes

- **Branch:** `claude/x5b-legacy-checkout-404` · **Base SHA:** `a9ba9bd58` (origin/main) · **PR / Head SHA / CI:** see PR. No merge, no deploy.

## Root cause and evidence
ENV0 curl showed `/sa/ar/{checkout,confirm-payment,order-placed}/awj-x5-verification` → **HTTP 200** (render of the 404 UI + `noindex`), control path → 404.

Reproduced locally with `next build` + `next start` (Next 16, `cacheComponents: true`): the three routes returned **200** with `x-nextjs-prerender: 1`, `x-nextjs-postponed: 1` and the `NEXT_HTTP_ERROR_FALLBACK;404` marker in the body; `/us/ar/zz-nonexistent-awj-probe` returned **404**. With PPR the route's shell is prerendered and streamed; the layout's `notFound()` (X5, #1765) is evaluated inside that response, after the 200 status line is committed. A layout-level `notFound()` therefore cannot set the status. (Inference from reproduced headers/body; the same mechanism is documented for streamed responses.)

## Solution
The decision moves **before rendering**, into the existing locale proxy:
- `storefront/src/lib/spree/middleware.ts` (`createSpreeMiddleware`): after the `/{country}/{locale}` prefix is confirmed canonical, if `!isWholesaleEnabled()` and the localized path is `checkout/<id>`, `confirm-payment/<id>` or `order-placed/<id>` (single segment, `payment-return` excluded by **raw** comparison), respond with `NextResponse.rewrite` to `{prefix}/awj-legacy-checkout-closed` — a path that matches no route, so the framework itself produces its standard 404 (same page/status as any unknown URL). No redirect, no data fetch, no Spree call, search string dropped.
- `isWholesaleEnabled()` stays the **single source of truth** (imported from `./config` inside the wrapper dir — not counted by the ratchet; nothing duplicated).
- The `(checkout)/layout.tsx` gate is **kept as defence in depth**. Comment updated; behaviour unchanged.

Decoding note: the router matches static segments literally, so `checkout/%70ayment-return` and `checkout/Payment-Return` resolve to the legacy `[id]` page (verified: previously soft-404) and are closed; only the exact `payment-return` stays AWJ-native.

## Follow-up: dotted legacy ids (review of PR #1773)
**Finding:** the proxy matcher's first entry excludes any path containing a dot, and the proxy itself returned `NextResponse.next()` for a trailing `.\w+` (static-asset heuristic). A legacy id such as `test.123` therefore never reached the gate: baseline production build showed `/us/ar/{checkout,confirm-payment,order-placed}/test.123` → **200** soft-404 (also `checkout/abc.png`).

**Safe to fix in this PR — yes, narrowly:**
- `src/proxy.ts`: a **second, explicit matcher entry** `/:country/:locale/:section(checkout|confirm-payment|order-placed)/:id` (the first entry is untouched). It matches only four-segment paths with those exact section names; `/_next/*`, `/api/*`, `favicon.ico`, `icon`, root assets, other dotted paths, deeper paths (`…/test.123/extra`), `wholesale/checkout/…`, and unprefixed paths are **not** matched (asserted with Next's own matcher utilities in `proxy.test.ts`).
- `middleware.ts`: in the existing file-extension skip branch, if the path has a country/locale prefix, wholesale is disabled and the remainder is a legacy checkout path, answer the same rewrite-to-404 (no cookies set — the locale is unvalidated there); otherwise the old `NextResponse.next()` pass-through is returned unchanged. With wholesale enabled the dotted path is passed through exactly as before (no new headers/cookies).
- `payment-return.v2` is **not** the static `payment-return` segment, so it resolves to `checkout/[id]` and is closed; exact `payment-return` stays AWJ-native.

**Local production-build HTTP check (wholesale unset):** `checkout/test.123`, `confirm-payment/test.123`, `order-placed/test.123`, `checkout/payment-return.v2`, `checkout/abc.png` → **404**, 0 redirects, no 404 marker in a 200 body; `checkout`, `checkout/payment-return` → 200; `products/shirt.v2` unchanged (200, not routed through the gate); `/favicon.ico` 200. **Wholesale-enabled build:** the three dotted routes → 200 (pass through), AWJ routes 200, unknown path 404.
Residual trade-off: a file-like legacy path such as `checkout/abc.png` now 404s via the proxy instead of a soft-404 page — no real asset lives under those four-segment paths. The `/api/health` 500 seen in the local run is pre-existing (no such route; proxy not involved) and unrelated.

## Files changed
`storefront/src/lib/spree/middleware.ts`, `middleware.test.ts`, `storefront/src/proxy.ts`, `storefront/src/proxy.test.ts`, `storefront/src/app/[country]/[locale]/(checkout)/layout.tsx` (comment only), tracker row X5b, this report.

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
- `src/lib/spree/middleware.test.ts` +15 tests and `src/proxy.test.ts` +1 (matcher scope): rewrite for each legacy route, no `Location`, odd spellings closed, AWJ routes (`/checkout`, `/checkout/payment-return`, `/cart`) untouched, deeper/unrelated paths untouched, wholesale enabled passes through, prefix canonicalisation still precedes the gate.
- Focused (middleware, proxy, `(checkout)` layout, checkout-routes structure, No-Spree env): 84 passed. Full storefront vitest: 3433 passed / 16 skipped (after the follow-up). `tsc --noEmit` clean; biome no errors; `next build` OK.
- Spree ratchet: **unchanged** — value 4, type 147, client 68, wrapper **77**, env 9 (no increase; no baseline edit).

## Tenant isolation / security
Host resolution untouched; the gate keys only on the process env flag and the path, so there is no tenant-specific branching, no host bypass and no cross-tenant configuration read. The rewrite target is a fixed string under the request's own canonical prefix. No redirect, no new data exposure; response is the standard 404.

## Risks and remaining ENV0
- The flag is read per request in the proxy but the layout's gate is evaluated at build time for the prerendered shell; deployments set the env at build+runtime (as the wholesale layout already assumes).
- Dotted ids are now closed too (see Follow-up). Remaining non-covered case: none known; unprefixed `/checkout/<id>` first takes the existing 307 to the prefixed path and is then closed.
- **Live verification is still required** after deployment (re-run the ENV0 curls on `alrshd.store.awjdev.xyz`); not done here. Remaining ENV0: that re-check, active storefront SHA, wholesale test-or-deferral, owner sign-off. ENV0/H0 stay open.

## Next action
Review/merge, deploy to Beta with explicit approval, re-run the three curls, then update tracker §5 with the live result.
