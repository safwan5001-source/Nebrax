# AWJ ENV0 — HTTP Verification (read-only)

- **Branch:** `claude/env0-http-verification` · **Base SHA:** `60e2d232bbb41bf658f993befd47da23c6f17920` (origin/main) · **PR / Head SHA / CI:** see PR. Docs only; no merge, no deploy, no app changes.

## Headline finding
The three legacy Checkout routes return **HTTP 200 (soft-404), not 404.** Behaviorally closed (no Spree content, no data, `noindex`), but the status code does not match the X5 intent. Tracked as new slice `X5b` (Planned, owner decision) — not fixed here.

## Exact HTTP results (curl GET, no redirect following needed; 2026-10-26T17:44Z, host `https://alrshd.store.awjdev.xyz`, wholesale disabled)
| Route | Status | Final URL | Redirects |
|---|---|---|---|
| `/sa/ar/checkout/awj-x5-verification` | **200** | same | 0 |
| `/sa/ar/confirm-payment/awj-x5-verification` | **200** | same | 0 |
| `/sa/ar/order-placed/awj-x5-verification` | **200** | same | 0 |
| control `/sa/ar/zz-nonexistent-awj-probe` | **404** | same | 0 |
| control `/sa/ar`, `/sa/ar/checkout` (AWJ) | 200 | same | 0 |

Relevant headers (legacy routes): `HTTP/2 200`, `content-type: text/html; charset=utf-8`, `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, `x-nextjs-postponed: 1`, `server: railway-hikari`; **no `Location`**. Body: `<meta name="robots" content="noindex">`, `NEXT_HTTP_ERROR_FALLBACK;404`, "This page could not be found".

**Cause (inferred from headers/body, not code-changed):** `notFound()` in the layout fires after the streamed response has begun (`x-nextjs-postponed`), so the 404 UI is rendered with an already-sent 200 status. Only GET requests were made; no payment or write action.

## Railway evidence (prior read-only inspection, 2026-10-26; reported, not re-run here — no Railway access from this environment)
Names only, values redacted: storefront 18 names · `nibras-api` 61 · `Nebrax` 17 — **0 `SPREE_*`** in all three.

## Deployed SHAs
- Backend published: `60e2d232bbb41bf658f993befd47da23c6f17920` (= main after #1771).
- Storefront last verified active: `096f18f2d1077975ce0a2f33fa67f6c126ec7123`. **Current active SHA not verified** (no Railway access). `git diff 096f18f..main -- storefront` = 0 files, so a newer build of main would carry identical storefront code.

## Wholesale-enabled compatibility (kept open)
Untested. Deferral is reasonable only if recorded explicitly: the enabled branch (`isWholesaleEnabled()` ⇒ legacy shell) is unchanged and covered by unit tests, but deferral does **not** complete the criterion and does not cover other unverified items (X5b, other hosts/tenants, mobile).

## Files changed
`docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` (X5, new X5b, ENV0 row, §4 gate, §5 log + note, R-02, R-ENV0-HTTP) · `docs/audits/AWJ_STORE_COMMERCE_HORIZON_HANDOFF.md` (dated update) · this report.

## Validation
Docs-only; SHAs cross-checked against git (`60e2d23`, `096f18f` ancestors of main). HTTP evidence reproducible with the curl commands above. CI: see PR.

## Risks
SEO/crawler/monitoring see 200 on dead URLs (mitigated by `noindex`); no data exposure. Railway counts are second-hand. Active storefront SHA unverified.

## Next action
Owner decision on X5b (accept documented soft-404, or approve a slice that sets the real 404 before streaming, then re-run these curls). Then verify the active storefront deployment SHA in Railway, decide wholesale test vs written deferral, and sign off ENV0.
