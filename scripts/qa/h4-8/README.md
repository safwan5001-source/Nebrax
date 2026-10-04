# CUST-H4-8 integrated QA harness

Drives the **real** stack (Laravel on :8000 + web on :3000 + storefront on :3001), no fixtures/stubs.
Written for the Claude Code cloud sandbox (absolute `/home/user/...` paths; override `H48_SEED`/`H48_OUT`).
See `docs/reports/CUST-H4-8-INTEGRATED-QA-REPORT.md` for setup, results and caveats.

1. Sync the Laravel app from the repo (the `setup.sh` copy step), `php artisan migrate:fresh`.
2. `./reset.sh` — migrate:fresh + `seed.php` (tenant, 2 storefronts + 1 foreign tenant, products A–E, ATS, price lists, offers) → `seed.json`.
3. Start: `STOREFRONT_GATEWAY_SECRET=h48-secret php artisan serve`; `cd web && npm run dev -- -p 3000`;
   `cd storefront && STOREFRONT_GATEWAY_SECRET=h48-secret AWJ_COMMERCE_API_URL=http://127.0.0.1:8000 next dev -p 3001`
   (no `AWJ_STOREFRONT_DEV_HOST`: hosts `*.h48.test` are mapped to 127.0.0.1 via Chromium `--host-resolver-rules`, so the genuine Host header reaches `ResolveStorefrontDomain`).
4. Run scripts with `node <script>.mjs` (long ones in the foreground; the public unauth limit is 30/min/IP, scripts clear the cache between loads).

`merchant-flow.mjs` is the main merchant → draft → reload → publish → parity flow. PHP scripts run from `/home/user/nibras-app` (`php <script>.php`).

Assertions use `checks()` from `lib.mjs`: any failed check makes the process exit 1 (`node checks-selftest.mjs` verifies this).
