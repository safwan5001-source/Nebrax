# AWJ Fuel Stations — UI-0 Implementation Report
**Task:** #1988 `[P0/UI-0]` — mobile shell + read-only AWJ data integration · **Parent:** #1984
**Date:** 2026-11-04 · **Status:** PR open, **not merged, not deployed** (awaiting independent visual review + explicit owner approval)

> **Visual correction (PR #1990 contract):** the first UI-0 drop passed its tests but did not match the approved operator prototype. The presentation layer was rebuilt (non-sticky navy masthead with greeting and station picker, raised current-shift card, 32px summary, cash/card cards, orange CTA, shortcuts, fixed bottom tabs) while keeping the data adapters, routing, auth/RBAC and tests. Evidence and verdict: [`visual-qa/VISUAL_QA_REPORT.md`](./visual-qa/VISUAL_QA_REPORT.md). Where this report describes the old header (language/theme toggles, sticky bar), the visual QA report supersedes it.
**Governing docs:** [Operator/Supervisor Plan](./AWJ_FUEL_STATIONS_OPERATOR_SUPERVISOR_PLAN.md) · [Design System V2](./AWJ_FUEL_STATIONS_DESIGN_SYSTEM_V2.md) · [UI↔API Integration Matrix](./AWJ_FUEL_STATIONS_UI_API_INTEGRATION_MATRIX.md)

## 1. What shipped

A mobile-first **«محطات أَوْج | AWJ Fuel Stations» — «تشغيل المحطات | Station Operations»** workspace at `/fuel-stations/ops`, built as a **presentation layer** over the existing AWJ Fuel Stations APIs. It reads only; there is no write path anywhere in the module.

| Screen | Route | Content (all from AWJ) |
|---|---|---|
| Home | `/fuel-stations/ops` | Current open shift of the selected station; dispensable fuel products with effective price and pump/nozzle counts; honest "configured but not dispensable" note; permission-aware "coming soon" items |
| Products & pumps | `/fuel-stations/ops/products` | Dispensable products → nozzles; pumps → nozzles (with block reason); tanks with product and capacity |
| Shifts | `/fuel-stations/ops/shifts` | Server-filtered list (all / open / awaiting approval / approved), explicit *Load more* pagination, read-only |
| Settings | `/fuel-stations/ops/settings` | Personal, device-local preferences (language, theme) kept separate from read-only station facts; link to AWJ admin only with `fuel_stations.manage` |
| Profile | `/fuel-stations/ops/profile` | AWJ identity, role, derived workspace type, authorized scope, what-my-permissions-allow, link to AWJ security settings, sign-out through AWJ |

Shell: navy header with tenant identity (company name/logo from AWJ settings, neutral "AWJ" mark as fallback), native-select station switcher (only the stations AWJ returns), language/theme toggles, safe-area-aware bottom navigation on phones that becomes a side rail from `md`, offline banner, skip link.

## 2. Decisions and where I deviated

| Topic | Decision |
|---|---|
| Route placement | New route group `(fuel-ops)` mounted at `/fuel-stations/ops`. The existing `(fuel)` desktop workspace is untouched. Living under `/fuel-stations` keeps it inside the path already excluded from the AWJ v3 UI gate — no change to the shared gate regex (only the route-group guard test now lists `(fuel-ops)` next to `(fuel)`). |
| Auth / identity / RBAC | Same Bearer token, `currentUser()`, `useCan()` and live `/me` refresh as the rest of AWJ. No second login, no stored credentials, no role editor. Workspace "type" (supervisor / attendant / view-only) is a *display label derived from permissions*, never an authorization. |
| Visual layer | V2 palette as CSS variables **scoped under `[data-fuel-ops]`** (test-enforced). Global AWJ tokens are unchanged. |
| **Deviation from V2 colors** | `positive` (`#14866D → #0B6E5A`) and `warning` (`#A55A0C → #8F4D08`) were darkened, and a `--fo-control` border token was added, because the proposed values failed WCAG AA for tinted badges and control boundaries. The contrast test reads the shipped CSS. The brand orange `#E87722` is used as a fill only; interactive orange text uses `#A8470A`. |
| Data cache | None across keys by design (see §4). Going back to a station refetches. |
| PWA / offline writes | Not in UI-0 (read-only; only an offline banner). |

> **Superseded for prices (#2008):** the app no longer rebuilds the effective price from `GET /fuel-stations/prices`; it reads the server-resolved `GET /fuel-stations/prices/effective`, and #1998 is fixed. See [`AWJ_FUEL_PRICE_SOURCE_AUDIT.md`](./AWJ_FUEL_PRICE_SOURCE_AUDIT.md). The price rows in §3/§6 below describe the original UI-0 workaround.

## 3. API mapping (verified against `routes/api.php` and `app/Http/Resources/Fuel*Resource.php`)

| UI | Endpoint | Route permission | Notes |
|---|---|---|---|
| Authorized stations | `GET /fuel-stations/stations` | `fuel_stations.view` | Server restricts to accessible stations/branches/warehouses |
| Products | `GET /fuel-stations/products` | `fuel_stations.view` | Tenant registry → **never shown as dispensable by itself** |
| Pumps / Nozzles / Tanks | `GET /fuel-stations/{pumps,nozzles,tanks}` | `fuel_stations.view` | Server has no `station_id` filter on these; client keeps only `fuel_station_id === selected` rows |
| Effective price | `GET /fuel-stations/prices` | `fuel.sale.view` | Resolved per product: station override → tenant default (mirrors `FuelStationProductPriceService::effective`) |
| Current / listed shifts | `GET /fuel-stations/shifts?station_id&status&page` | `fuel.shift.view` | Paginated (50); open shift = `status=open` |

Every response is parsed with zod against the **actual resource fields**; a mismatch is rejected whole (`invalid_shape`) rather than partially rendered. The client allow-lists exactly these seven GET paths and refuses anything else before a request is made.

**Dispensable rule (acceptance criterion 1).** A product is dispensable at a station only if an **active nozzle** exists there whose **pump is active**, whose **tank is active and carries the same product**, whose product is active, and the station is active. Registry products without such a chain appear only as a count ("registered without an active nozzle at this station: N") — never as a sellable product. A nozzle that disagrees with its tank's product is blocked and labelled (`product_tank_mismatch`).

**Price truthfulness.** Unavailable ≠ zero: `not set`, `not available for your permissions` (no `fuel.sale.view`, and no request is sent), `could not confirm` (page cap reached) and `could not load` are distinct states; a genuine 0 price would display as such.

## 4. Isolation guarantees (tenant / branch / station)

* One query hook (`useScopedQuery`) holds **state for exactly one key**. Keys are `tenant|user|branch|station|resource`. On a key change the very next render exposes `loading` — old data cannot be rendered for even one frame. Late responses for a previous key are discarded, and in-flight requests are aborted.
* `StationOpsProvider` re-mounts the whole subtree when `(tenant, user, active branch)` changes (session switch, branch switch), dropping selection and data together. The remembered station is stored per `tenant+user` and is honoured only if the server still lists it.
* Station-scoped screens render under `key={station.id}` so local state (filters, expanded rows) is reset on switch.
* Defence in depth: rows whose `fuel_station_id` is not the selected station are ignored client-side; price rows of other stations are dropped on arrival. **The server remains the authority** for isolation.

## 5. Quality evidence (actual runs)

| Check | Result |
|---|---|
| `npx tsc --noEmit` — files added/changed by UI-0 | 0 errors (repo has unrelated pre-existing type errors in other test files; not touched) |
| `vitest run src/modules/station-ops` | **10 files / 241 tests passed** (catalog 12 · prices 14 · tokens 37 · messages 4 · read-only guard 87 · nav 4 · rtl 13 · integration 43 · read-client 9 · scoped-query 6) |
| **Entire `web` Vitest suite** (`npx vitest run`) | **853 files / 10,187 tests passed** (final tree after the visual rebuild). A first full run caught one real regression — the repo-wide *drift ratchet* flagged fixed-palette classes (`text-white`, `bg-white`…) in my shell; replaced by scoped semantic tokens and re-run green |
| `next build` (final tree) | **Passed** (rebuilt for the visual QA run); all five routes emitted (`/fuel-stations/ops`, `/products`, `/shifts`, `/settings`, `/profile`, ≈2–6 kB page JS each) |
| Playwright `e2e/fuel-ops-ui-0.spec.ts` — Chromium, 390×844 touch (iPhone-size) + 1440 desktop, AR/RTL + EN/LTR, light/dark | **18/18 passed** (final tree) + 133/133 visual-QA probes on a production build (see `visual-qa/`). Screenshots reviewed manually; one visual issue found and fixed (Arabic unit rendered in the monospace numeric font, repeated "Pump 1" inside the pump card, "1 pumps" plural wording) |
| CI (GitHub Actions, `web-ci.yml`) | See the PR checks — recorded in the PR description once complete; not claimed here |

Test files (`web/src/modules/station-ops/`):

| File | What it proves |
|---|---|
| `catalog.test.ts` | Dispensable rules; unmapped/other-station/inactive/mismatched assets never dispensable; no built-in fuel names |
| `prices.test.ts` | Station vs tenant price, expired/future/inactive rows, other-station rows ignored, page cap → "incomplete", 403/abort handling |
| `read-client.test.ts` | GET-only through shared `api()`, path allow-list, 401/403/404/5xx/offline classification, malformed shapes rejected, demo mode never calls the API |
| `use-scoped-query.test.tsx` | No cross-key leakage in the next render, stale response ignored, abort on switch/unmount, retry |
| `station-ops.integration.test.tsx` | Full screens against a fake AWJ backend: authorized stations only, price states, station switching (incl. slow + late responses), **tenant switch**, **branch switch**, 403/404/5xx/offline+retry/malformed, no-permission paths issue no request, shifts pagination/filter/read-only, role-aware nav, inert "coming soon", profile/settings read-only, AR/EN with Latin digits, axe (no violations, both locales) |
| `read-only-guard.test.ts` | Static: no write verbs, no direct `fetch`, `api()` only in `read-client.ts`, no hard-coded fuel names/prices/tenant names, no mock/demo imports, no idempotency helpers |
| `fuel-ops-tokens.test.ts` | WCAG AA contrast computed from the shipped CSS (both themes), all CSS scoped under `[data-fuel-ops]` |
| `messages.test.ts` / `rtl-logical.test.ts` | AR/EN key parity and usage; logical (RTL-safe) utilities only |
| `e2e/fuel-ops-ui-0.spec.ts` | Browser run (Chromium): direction, bottom-nav placement, ≥44px targets, ≥16px field font, no horizontal overflow, `viewport-fit=cover`, station switch, GET-only traffic, dark theme, no-permission block |

## 6. Gaps and limits (stated plainly)

1. **Not verified on a real iPhone / Safari (WebKit).** E2E ran in Chromium at 390×844 with touch emulation. Sunlight/dark/zoom/Dynamic Type/keyboard/safe-area checks from Design System V2 §11 remain a required manual step before any rollout.
2. **No live-API run.** Data in tests is a fake backend shaped by the real resources. Per the task, no tenant or station (including Nebras) data was read or modified; nothing was run against production.
3. **Backend gap — `GET /fuel-stations/prices`:** it neither restricts rows to the user's accessible stations nor allows asking for the tenant default alone. UI-0 works around it (station-filtered query first; unfiltered fallback keeps only tenant-default rows and drops others on arrival; page cap → "could not confirm"). Recommended backend follow-up: scope the endpoint to accessible stations and support a `scope=station|tenant` filter. **No backend change was made in this task.** Tracked separately as **#1998**.
4. **Backend gap — pumps/nozzles/tanks have no `station_id` filter**; the screen downloads the accessible set and filters client-side. Fine for typical station counts; revisit for very large tenants.
5. **Tank levels are not shown** (only capacity). A current-level read needs tank-reading endpoints and the reconciliation policy (UI-1+).
6. **Staff assignment of the current shift** is not shown (list endpoint does not embed it); the home screen shows the station's open shift, not "my" shift. If more than one open shift appears (the DB has a one-open-per-station index, so this should not happen), the newest is shown with a warning.
7. **Not built (by design, shown as inert "Soon" items, never as buttons):** meter readings, collection/handover, shift approval, fuel receiving, reports (UI-1…UI-5). Station *operational* settings (shift schedule, payment methods, thresholds) are not displayed — only station identity facts from the stations endpoint.
8. **Personal settings** are language and theme only; font-size and haptic preferences from the plan were not built because they have no implementation yet (the plan forbids clickable options without real effect).
9. **PWA install / offline cache** not included (read-only offline banner only).
10. Pre-existing `IntlError INVALID_KEY` console noise in vitest comes from existing `developer.events` message keys, not from this change.

## 7. UI-0 exit checks (from the Integration Matrix)

| Exit check | Status |
|---|---|
| `fuel_stations.view`-only user sees only authorized stations/assets/products; denied APIs don't crash unrelated sections | ✅ tested (prices 403 keeps products; shifts without permission shows a message) |
| Station switch fully changes scoped data; nothing left or cached under the wrong key | ✅ tested incl. slow/late responses |
| Product without a mapped nozzle is not shown as dispensable | ✅ tested |
| Unavailable price/measurement distinguished from zero | ✅ tested |
| No hard-coded station, seller, product, pump, nozzle or price in data adapters | ✅ static guard |
| Tests verify permissions, source mapping, empty/error states, cross-tenant isolation | ✅ see §5 |

## 8. Scope confirmation

No POST/PUT/PATCH/DELETE · no backend, route, permission, migration or config change · no tenant/station data touched · `docs/agent-workspace/TASK.md` and the active orchestration task untouched · no merge, no deploy.
