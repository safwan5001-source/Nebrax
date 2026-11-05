# AWJ Fuel Stations — UI-1 Implementation Report
**Task:** #2002 `[P0/UI-1]` — mobile shift details & nozzle meter readings, **read-only** · **Parent:** #1984 · **Base:** UI-0 merged in PR #1993 (`3d26ef4`)
**Status:** PR open, **not merged, not deployed** (awaiting independent visual/UX review + explicit owner approval). UI-2 has **not** been started. **Revision 2 (2026-11-05):** re-done to comply with the owner's *APP-ONLY / SIMPLE UX* decision recorded in #2002 (§0).
**Governing docs:** [Design System V2](./AWJ_FUEL_STATIONS_DESIGN_SYSTEM_V2.md) · [UI↔API Integration Matrix](./AWJ_FUEL_STATIONS_UI_API_INTEGRATION_MATRIX.md) · [UI-0 report](./AWJ_FUEL_STATIONS_UI_0_IMPLEMENTATION_REPORT.md) · visual evidence: [`visual-qa/VISUAL_QA_REPORT_UI_1.md`](./visual-qa/VISUAL_QA_REPORT_UI_1.md)

## 0. Product decision 2026-11-05 — APP-ONLY / SIMPLE UX (binding for UI-1 and every later phase)
Source: the updated body of #2002. How this revision complies:

| Decision | What changed / how it is enforced |
|---|---|
| Staff work **only inside the AWJ Fuel Stations app**; no hops to ERP / station-admin pages | **Removed every outbound link:** home CTA «Manage the shift in AWJ» (`/fuel-stations/shifts`), shifts-list «Open the full shifts screen in AWJ», details «…full shifts screen», settings «Manage station settings in AWJ» (`/fuel-stations/settings`), profile «Password and security in AWJ» (`/settings`). Remaining links are all under `/fuel-stations/ops/*` (+ the skip-to-content anchor and the existing `/login` sign-out). **Guard:** `app-only.test.ts` (static: every `href`/`router` target; no referral sentences; no ERP/accounting jargon in the copy) + integration + browser assertions on every screen/cell (`links leaving the app = []`) |
| Not-yet-built services show a **clear "coming" state inside the app**, not a button that leaves or a fake action | New **«Next step»** card (`next-step.ts`, `next-step-card.tsx`): derived from the real server state (open → closed → approved + readings progress); if the viewer has that step's permission it reads e.g. «Record the ending meter readings — Nozzles remaining: 3 — *This step will arrive inside the app soon*»; otherwise «Waiting for: …». **Inert text — no button, no link** (tested). No invented states (no "returned"/"submitted") |
| Home answers *where am I / what is my shift's state / what is next*, **one** primary button | Home = station in the masthead → current-shift card with a **step-of-5 progress bar** → meter liters → **Next step** → **one** primary action («View the current shift», or «Shift history» when none is open), marked `data-primary-action` and asserted `== 1`. Removed: the two permanent «Not available yet» cash/card cards, the shortcuts row and the «Coming soon» list (noise, duplicated the tab bar) |
| Radical simplicity, large touch targets, plain language | Details order: summary + progress → **Next step** → liters → **meter readings (the main content)**; progress steps / tank readings / cash are **collapsed by default** (≥56 px summaries). Zone line only shown when the station has none. Copy rewritten in employee language (e.g. «Cash in this shift», «Starting cash», «Expected cash», «Difference»; no «operational», «accounting entry», «POS»…) |
| Server must block ERP pages by URL for restricted staff | **Not part of UI-1** (needs the restricted employee gateway — a backend task). Recorded as gap **G7**; the app simply never links to ERP pages |
| Explicit UX acceptance test (new employee understands tasks & next button without explanation) | Automated *proxies* only: next step visible without scrolling on a 390×844 phone, exactly one primary action, no outbound links, jargon-free copy. **A real new-employee test was not performed — PENDING** (see the visual QA report §2, item 15) |

## 1. What shipped

| Screen | Route | Content (all from AWJ, read-only) |
|---|---|---|
| **Shift details** (new) | `/fuel-stations/ops/shifts/[id]` | Summary (number, AWJ status `open/closed/approved`, opened/closed stamps **in the station's time zone**, running/total duration, assigned-staff count, freshness + refresh) with a **step-of-5 progress bar** → **Next step** → **meter liters** → **meter readings grouped pump → nozzle** (product, tank, opening, closing, computed liters, status) → *collapsed:* progress steps · tank readings · cash in this shift |
| Shifts list (updated) | `/fuel-stations/ops/shifts` | Each card links to its details; an open shift no longer shows the server's stored `0` as liters; no outbound link |
| Home (rebuilt for simplicity) | `/fuel-stations/ops` | Current-shift card + progress, meter liters (computed for an open shift), **Next step**, one primary action, fuel & prices |
| Settings / Profile (links removed) | `/fuel-stations/ops/{settings,profile}` | Same content; the links to ERP station settings / security settings are gone |

No write path was added. No backend, schema, permission, or station data was touched.

## 2. What `GET` actually exposes (verified in code, and by the existing backend test)

Verified in `FuelShiftController`, `FuelShiftResource`, `FuelShiftService`, `routes/api.php`, and by running `tests/Feature/FuelShiftApiTest` (1 passed, 33 assertions) — no backend file changed.

| Need | Endpoint | Permission | Finding |
|---|---|---|---|
| Shift list | `GET /fuel-stations/shifts` (`station_id`, `status`, `mine`, paginated 50) | `fuel.shift.view` | Returns the scalar summary only — **no readings** |
| Shift detail + readings | `GET /fuel-stations/shifts/{id}` | `fuel.shift.view` | Loads `meter_readings[]` (`nozzle_id`, `reading_stage opening|closing`, `meter_milliliters`, `measured_at`), `tank_readings[]`, `cash_variance`, `staff_assignments[]` (ids only), `events`, `corrections`, cash fields |
| Single-nozzle / historical meter series | — | — | **No GET exists.** `GET /fuel-stations/readings` is the tank-reconciliation reading, not shift meters. "Historical readings" = the readings of each past shift via its details. A per-nozzle series / "previous shift's closing" needs a new endpoint (**gap G1**) |
| Nozzle ↔ pump ↔ tank ↔ product | `GET /fuel-stations/{nozzles,pumps,tanks,products}` | `fuel_stations.view` | Reused from UI-0 `catalog.ts` |

### Truthfulness rules that follow from the contract
1. **`operational_meter_milliliters` / `operational_liters` stay `0` for the whole life of an open shift** (`FuelShift::$attributes`, set only in `FuelShiftService::close`). Showing it would present an unknown as a real zero. UI-0 did this; UI-1 fixes it (home + list + details). Open shift ⇒ computed from complete pairs (closing − opening, integer mL), labelled **partial** with "X of N nozzles", and `—` (not `0`) when no nozzle is complete. Closed/approved ⇒ the server's stored total.
2. **A real `0.000` is not "missing".** Opening reading `0` is rendered `0.000`; an absent reading is "Not recorded"/"Awaiting closing reading".
3. **Reconciliation:** for closed/approved shifts the displayed nozzle differences are summed and compared with the server total; a mismatch is shown as a warning, not silently reconciled.
4. **Closing < opening** (the server rejects it at close, so it should not occur) is shown as "Needs review", excluded from totals, and counted.
5. **Meter liters ≠ POS sales ≠ collections ≠ stock.** A permanent note says so; no price, revenue or inventory figure is derived. Tank readings are labelled evidence that does not change stock. Cash is labelled operational cash, not revenue/collections/an accounting entry.
6. **Expectation rules:** only an **open** shift expects a reading for every currently-active nozzle (missing ones are listed explicitly). For closed/approved shifts only what was recorded is listed — the current setup may differ from the setup at the time, and the screen says so. Readings of nozzles that are not in the station's current setup are shown under "outside current setup", never dropped.
7. **No fixed catalog or counts:** pumps/nozzles/products/tanks come from the station's setup; no shift count, fuel grade, or device count is assumed. The static guard still forbids fuel names/prices in source.
8. **Dates/time zones:** every stamp is rendered in the selected station's IANA zone (`formatStampInZone`: date + time, so a shift crossing midnight is unambiguous); an invalid zone falls back to the device zone; invalid instants render `—`; a station with no zone says times use the device zone. Latin digits 0–9 in both locales.

## 3. Scope, isolation and branch correctness
* `useShiftDetail` key = `tenant|user|branch|branch_ids|warehouse_ids | station | shift id`; built on `useScopedQuery` (no cross-key state). A "last good result" is kept **only for the same key** to show stale data with a notice during refresh/transient failure; switching station/tenant/branch/scope drops it immediately.
* Request carries `X-Branch-Id` = the **selected station's branch** (same as the list), as required for UI-0 Codex P2.
* **Client defence in depth:** a detail whose `station_id` ≠ the selected station is treated as *not available* and **never rendered** (even if the server returned it).
* The shift id is validated (`^[A-Za-z0-9_-]{1,64}$`, `open` excluded) **before** any request, so a malformed route param cannot become another path (`../sales`, `a/b`, empty). `read-client.ts` whitelist gained exactly one pattern; `shifts/open`, `shifts/{id}/close|approve|meter-readings…` remain disallowed (tested).
* Honest states: loading, empty (no readings), 403 (permission), 404/foreign station ("not available"), 5xx, offline, malformed shape (**rejected whole**; the arrays `meter_readings`/`tank_readings` are required — an absent array is not "no readings"), and stale-with-notice. Assets failing affects only the readings section.

## 4. Backend gaps found (documented, **not** changed)
| # | Gap | Impact / mitigation |
|---|---|---|
| **G1** | No endpoint for a single nozzle's reading history (or the previous shift's closing, for continuity checks: this opening vs previous closing) | UI shows readings per shift only; a continuity check would need a new GET |
| **G2** | `GET /fuel-stations/shifts` and `/{id}` use `scopeToActiveBranch` only — **no `restrictToAccessibleStations` / warehouse-station restriction** (unlike stations, deliveries, reconciliation readings) | A user restricted to some stations inside one branch can request another station's shift **by id** (and list with another `station_id`). UI mitigates: it only ever asks for the authorized selected station, and refuses to render a shift of another station. A server fix is required for real enforcement (same family as #1998) |
| G3 | `staff_assignments` carry `user_id` only (no names) | Only a count (+ "you") is shown; no user directory lookup was invented |
| G4 | `evidence`/`evidence_key` and event payloads are free-form | Deliberately **not** rendered (may hold sensitive data); an audit timeline is a UI-3 concern |
| G5 | Station shift policy (`shift_*_reading_required`) is only in `GET /fuel-stations/settings*`, outside the UI-0 whitelist | Progress shows counts, not "required" |
| G6 | `operational_tank_variance_milliliters` and `operational_delivery_milliliters` are exposed on the shift root, but their meaning depends on the station's tolerance policy and approved deliveries (G5) | Not displayed in UI-1 rather than shown without its policy context |
| **G7** | **Employee-restricted gateway not built:** ERP pages (`/fuel-stations/*`, `/settings`) remain reachable by URL for any user with the right permission; the new decision requires the **server** to block them for staff by role/policy | Out of UI-1 (no backend work allowed). The app never links to them; a future gateway task must enforce it server-side |

## 5. Files
**New:** `web/src/modules/station-ops/{readings.ts, next-step.ts, next-step-card.tsx, shift-detail-screen.tsx, shift-progress.tsx, shift-readings-section.tsx, readings.test.ts, next-step.test.ts, app-only.test.ts, shift-detail.integration.test.tsx}` · `web/src/app/(fuel-ops)/fuel-stations/ops/shifts/[id]/page.tsx` · `web/e2e/{fuel-ops-ui-1.spec.ts, fuel-ops-visual-qa-ui1.spec.ts, support/fuel-ops-ui1-mock.ts}` · `web/playwright.fuel-ops.config.ts` · `docs/fuel-stations/visual-qa/ui-1/**` · `docs/fuel-stations/visual-qa/VISUAL_QA_REPORT_UI_1.md` · this report.
**Changed:** `schemas.ts` (detail/reading schemas) · `read-client.ts` (one id-validated path) · `data.ts` (`useShiftDetail`) · `format.ts` (fixed-3 liters, stamps, elapsed) · `masthead.tsx` (`raised`, `backHref`) · `shift-card.tsx` (details link, compact rows, open-shift liters, `note`) · `home-screen.tsx` (rebuilt: progress, next step, one primary action), `shifts-screen.tsx` / `settings-screen.tsx` / `profile-screen.tsx` (outbound links removed), `nav.ts` (unused `COMING_SOON` removed) · `__fixtures__.ts` / `__test-harness.ts` (detail support) · `messages.test.ts` · `read-client.test.ts` · `station-ops.integration.test.tsx` (two UI-0 tests that asserted the stored-`0` behaviour were corrected) · `playwright.visual-qa.config.ts` (matches the UI-1 spec too) · `web/src/messages/{ar,en}.json` (**only inside the `stationOps` block**: new `shiftDetail`/`next` copy, referral/jargon copy rewritten, obsolete keys such as `home.cta*`, `soon`, `metric` removed) · `CLAUDE.md` (UI-1 note).

## 6. Verification (actual runs)
See the "Results" section of the visual QA report for the final numbers (unit/integration, Playwright functional on a production build, visual matrix) — they are recorded there from the final commit's runs.

## 7. Not done / deferred (explicit)
* Real **iPhone / Safari**: BLOCKED (no device/WebKit here). Must be verified before any activation.
* Independent visual review and owner approval: **PENDING**.
* Writes (record readings, close, approve, collect), events/audit timeline, corrections, supervisor queue: UI-2..UI-3 — **not started**.
* Per-nozzle history and continuity checks: need G1.
