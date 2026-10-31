# AWJ Store — Storefront

The buyer-facing storefront of AWJ Commerce: Next.js 16 (App Router, `cacheComponents`), React 19, Tailwind, `next-intl`
(`ar`, `en`, `de`, `es`, `fr`, `pl`; RTL-first). It renders what the AWJ Laravel API serves under `store/v1` — catalogue,
cart, checkout, payment return, policies, sitemap — and the native wholesale buyer journey (`/buyer/**`, Quick Order).
Tenant, storefront and sales channel come from the visitor's real `Host`, resolved by the API behind a shared gateway
secret; nothing tenant-related is read from the browser.

This directory began as a fork of [Spree Storefront](https://github.com/spree/storefront) (MIT — see `LICENSE` and
`NOTICE`). No Spree backend, SDK or client code remains in it; the exit is documented in
`docs/audits/AWJ_H6_FINAL_SPREE_EXIT_REPORT.md`.

## Setup

```bash
pnpm install
cp .env.example .env.local   # then set AWJ_COMMERCE_API_URL and STOREFRONT_GATEWAY_SECRET
pnpm run dev                 # http://localhost:3001
```

`.env.example` lists every variable with comments. The two that matter for a working store are
`AWJ_COMMERCE_API_URL` and `STOREFRONT_GATEWAY_SECRET` (it must equal the API's own value).

## Commands

| | |
|---|---|
| `pnpm test` | Vitest unit/integration suite (run it with `AWJ_*` variables unset) |
| `pnpm exec tsc --noEmit` | type check (remove `.next` first — stale `.next/types` give false errors) |
| `pnpm exec biome check src` | lint + format check |
| `pnpm check:locales` | all six message files have the same keys |
| `pnpm check:spree-ratchet` | fails if any Spree import, client access or `SPREE_*` read is (re)introduced |
| `pnpm build` / `pnpm start` | production build / server |
| `scripts/e2e/wholesale-stack.sh up` then `pnpm exec playwright test --config=playwright.wholesale-e2e.config.ts` | browser journey against a throwaway local Laravel stack |

## Notes

- Buyer sign-in/registration is gated (`ACCOUNT_AUTH_CAPABILITY` in `src/lib/commerce/capabilities.ts`): there is no
  buyer-identity service behind `store/v1` yet, so the account actions refuse and the screens say so.
- The inbound `/api/webhooks/spree` route is retained pending an owner decision and answers 503 while
  `SPREE_WEBHOOK_SECRET` is unset.
- Country/locale cookies are `awj_country` / `awj_locale` (the proxy still reads the legacy `spree_*` pair once and
  expires it).
