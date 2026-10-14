# H1-0 crawl tooling (evidence only — not part of the product build)

Re-runs the AWJ-ERP-UX-H1-0 matrix against a **local, isolated** backend and a production build of `web/`. Never point it at production or a real tenant.

1. Build Laravel with `setup.sh`, start `php artisan serve --port=8000`, register a throwaway tenant through `POST /api/register`, then seed it through the API: `./seed.sh <token>` (public endpoints only; posting goes through the normal services).
2. `cd web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api npm run build && npx next start -p 3001`.
3. In a scratch directory: `npm install axe-core@4.10.2`, copy `crawl.cjs` next to `node_modules/`, write the route list (`routes.json`, from `web/.next/app-path-routes-manifest.json` with dynamic segments replaced by fixture ids), save `GET /api/me` → `user` as `user.json`.
4. `TOKEN=<token> USER_JSON="$(cat user.json)" UI=3 node crawl.cjs routes.json out-v3 ar-light-1440,ar-light-390 1 1` (`UI=legacy` for the legacy path; args: configs, axe 0/1, screenshots 0/1). The crawler resumes from `results.jsonl`.
5. `python3 aggregate.py <dir-with-v3a,v3b,v3c,legacy> CRAWL-EVIDENCE.md` and `python3 inventory.py <dir> ROUTE-INVENTORY.md routes-skipped.json`.

`probe-*.cjs` are the keyboard/geometry probes quoted in the audit (dialog focus, shell/drawer/skip-link, toast region, widest element). They expect `TOKEN` in the environment and `user.json` one directory up. Paths to `playwright-core` and Chromium are those of the Claude Code cloud container; adjust locally.
