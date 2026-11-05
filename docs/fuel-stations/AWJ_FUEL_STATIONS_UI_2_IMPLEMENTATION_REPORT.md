# AWJ Fuel Stations — UI-2 Implementation Report (seller writes inside the app)

**Issue:** #2007 · **Base:** `main` @ `e69501e` (UI-1 merged) · **Date:** 2026-11-05 · **Status:** PR open, **not merged, not deployed** (owner approval required)
**Companion docs:** [Write Contract & Risk Gate (Stage A)](AWJ_FUEL_STATIONS_UI_2_WRITE_CONTRACT_AUDIT.md) · [Visual QA report](visual-qa/VISUAL_QA_REPORT_UI_2.md)

> **No real data was touched.** Everything ran against: Vitest with a stateful fake of `FuelShiftService`, PHPUnit on an isolated in-memory test database (fresh tenant per test), and Playwright with a fully intercepted API (all names labelled *Fixture*). No credentials were requested or used. No station/tenant was contacted. The owner enters Nebras station data himself from the iPhone.

## 1. What a seller can now do — entirely inside `/fuel-stations/ops`

| Screen | Route | Server calls it makes |
|---|---|---|
| Home — next step is now **one in-app primary button** (inside the first iPhone screen) | `/fuel-stations/ops` | GET only |
| **Open shift** — explicit starting cash (no default), confirm dialog, then registers *the current user* on the shift | `/shifts/open` | `POST shifts/open`, `POST shifts/{id}/staff` |
| **Starting / ending readings** — dynamic pumps → nozzles + tanks from the station's real setup, review-before-save, per-row results | `/shifts/[id]/readings/[opening\|closing]` | `POST …/meter-readings`, `POST …/tank-readings` |
| **Handover** — readiness check → cash entries + count → protected confirmation | `/shifts/[id]/handover` | `POST …/cash-movements`, `POST …/close` |

Exactly **six** write actions exist, through one client (`write-client.ts`). Not implemented (by instruction or because BLOCKED): approve / variance review / corrections, fuel sales, sale payments, prices, receiving, card/network totals.

## 2. Contract & Risk Gate (summary — full table in Stage A doc)
The audit found nine server behaviours the UI must neutralise. All are now **machine-verified** in `tests/Feature/FuelShiftSellerContractTest.php` (7 tests, 89 assertions, passing):

| Risk | Verified server behaviour | How the app handles it |
|---|---|---|
| R1 | Readings are immutable once saved | Mandatory review step + "can't be changed" notice + acknowledgement when warnings exist |
| R2 | `closing < opening` is **accepted at record time**, then `close` refuses → shift can never be closed (no correction path for an open shift) | **Hard-blocked in the client** before any POST; shown as an error with the opening value; also blocks the handover if such a pair exists |
| R3 | `open` replays the *first* shift for any known key — even if closed, even with another float | Fresh key per intent persisted in `sessionStorage` with a payload fingerprint; reply must be `open` + this station + the float we sent, else "unconfirmed" |
| R4 | Cash-movement key replays the first effect even if the amount differs | Same fingerprinted key; success needs the movement (type/amount/reason) in the reply |
| R5 | Expected cash = float + in − out − expense and **excludes fuel-sale cash** (documented CYCLE_4 §4) | Shown with an explicit note; difference saved `pending_review`, never settled |
| R6 | Tank readings (opening + closing) are **required by default** and block closing | Implemented; also feed "next step" and progress |
| R7 | Starting float must be explicit even when 0 (default policy) | No pre-filled value; "No cash (0)" is a deliberate button |
| R8 | Open and staff-assign are two calls | Second step with its own state and retry ("already assigned" counts as done) |
| R10 | `FuelShiftController` enforces branch only — **no station/warehouse scope on writes** (G2/G7) | **Not changed.** Recorded as a separate backend security item; not claimed fixed |

### Idempotency / duplicate protection (not just a disabled button)
- **Readings:** deterministic evidence key `awj-ops:{m|t}:{shift}:{asset}:{stage}` (server-unique per that triple) → a retry returns the same row; a different value is rejected by the server.
- **Open / cash entry:** per-intent key + payload fingerprint + 30-min TTL in `sessionStorage`; cleared only when the outcome is settled.
- **Close:** state-guarded on the server; after a timeout the app **re-reads** the shift instead of re-sending.
- **Four honest outcomes** (`ok`, `unverified`, `rejected`, `unknown`, plus `not_sent` offline): after a lost reply the user sees *"The action may have gone through. Check the shift's status…"* with a "Check status" button. No automatic retry anywhere.

## 3. BLOCKED items (not built, not faked)
B1 what counts in "counted cash" / sales↔drawer reconciliation (**owner decision**) · B2 fuel-sale payment collection (per-sale invoice + receipt = real accounting) · B3 meter rollover/reset policy (**owner decision**; today a legitimate reset cannot be recorded and the app says "ask your supervisor") · B4 official previous reading (no per-nozzle series API; a **reference-only** "last recorded ending" is taken from the last non-open shift and only *warns*) · B5 network/card totals declaration (no endpoint — shown as "Not available right now", no input) · B6 shift-to-shift cash hand-off record · B7 submitted/returned states · B8 restricted-staff gate G7 / station scope on writes.

## 4. Other design decisions
- **Server time only:** `measured_at`/`recorded_at` are never sent (static test).
- **Draft protection:** typed-but-unsaved readings persist in `sessionStorage` only (8 h TTL, scoped by tenant|user|station|shift|stage), labelled *"kept on this device only, not saved to the system yet"*, wiped on server confirmation.
- **Policy is read, not guessed:** `GET stations/{id}/settings`; unknown ⇒ strict display but **no client block based on a guess**.
- **Server-rule parity:** required nozzles/tanks = `status='active'` (what `assertCloseReadiness` checks), not the stricter display rule.
- **Closing tank readings inherit the opening reading type** (the server fails close on mismatch).
- **Scope:** all state is keyed by `scopeKey` (tenant|user|branch|access) — a scope change remounts the tree and drops local state/drafts/late replies. `X-Branch-Id` = the selected station's branch.
- **Boundary guard widened deliberately, not weakened:** `read-only-guard.test.ts` → `write-boundary.test.ts` (POST only in `write-client.ts`, exactly six literal routes, no approve/sales/payments/prices/receiving paths, no effect-driven POST, no client clock, no ERP links).

## 5. Real test results
| Suite | Result |
|---|---|
| Vitest `src/modules/station-ops` | **21 files / 730 tests passed** (بعد دمج #2023؛ كان 19/666) (new: `entry`, `cash`, `intents`, `write-client` units; `write-flows.integration` = 37 tests incl. axe a11y in AR/RTL; `write-boundary` guard; updated next-step/read-client/home tests) |
| PHPUnit `FuelShiftSellerContractTest` | **7 passed / 89 assertions** (RBAC per write, defaults, R2/R3/R4, no journal/stock/payment/invoice rows) |
| PHPUnit `--filter=Fuel` (sandbox SQLite, `ext-bcmath` installed) | **224 passed · 7 skipped (PostgreSQL-only)** — includes `FuelShiftSellerContractTest` (7) and #2023's `FuelShiftCashReconciliationTest`. The earlier 50 `bcmul` failures were purely the missing extension. No production PHP is changed by this PR. Full suite + PostgreSQL: CI. |
| `next build` (production, 10 GB heap — the default heap OOMs on this repo) | ✅ compiled, lint + types, 232 pages |
| Playwright on the production build — UI-0/1/2 functional | **72 passed** (re-run after merging #2023) · cash-summary spec (#2023) **16 passed** (desktop 1440 + iPhone-size 390; EN + AR): full journey open→readings→handover, lost reply ×2, forbidden/refusal, offline, missing readings, no-permission |
| Playwright visual-QA matrix (UI-2) | **129 passed** (re-run after the merge); 128 captures, **0 flagged** by probes (overflow, <44 px targets, clipped text, <16 px fields, action-bar/nav overlap, Arabic-Indic digits, off-app links, non-whitelisted POST, console errors) |

Two defects were found **by looking/probing, not by unit tests**, and fixed: (1) names truncated with "…" at 320 px (user/station on the open form, review rows, product on home) → now wrap; (2) the home's primary button sat below the fold on 390×844 → next step + button moved above the liters card. Also the redundant nozzle name in each field label was shortened (full name kept as `aria-label`).

## 6. Not done / limits (be explicit)
- **Real iPhone/Safari: NOT tested** (no device/WebKit here) — keyboard behaviour, `dvh`/notch, sticky bar with the on-screen keyboard are Chromium-emulated only. Required before any rollout.
- **Real new-employee usability session: not run.** Proxies only (steps per task, one primary action, no jargon test).
- **Independent review (Codex) and owner approval: pending.** No merge/deploy.
- Server-side station/warehouse write scope (R10/G7), owner decisions B1/B3, sales/network handover — open items above.
- Pricing gap #1998: untouched; these screens use no prices.

## 7. Files
`write-client.ts` · `write-outcome.ts` · `intents.ts` · `drafts.ts` · `entry.ts` · `cash.ts` · `policy.ts` · `write-ui.tsx` · `open-shift-screen.tsx` · `readings-entry-screen.tsx` · `handover-screen.tsx` · routes under `app/(fuel-ops)/fuel-stations/ops/shifts/…` · `next-step*`/`home`/`shift-detail` wiring · `data.ts` (policy + previous-closing hooks) · `schemas.ts`/`read-client.ts` (cash movements, settings read path) · ar/en messages · tests (`__write-backend.ts` fake, units, integration, boundary) · `tests/Feature/FuelShiftSellerContractTest.php` · Playwright specs + support mock · docs.

## 8. Post-merge note — integration with #2023 (cash summary, D1/D2/D5)
- Merged `main` @ `83208677` into this branch with no textual conflicts; UI-2 write flows, the new `cash_summary` section on shift details and the permission gating are all kept.
- **One compatibility fix:** the handover screen previews expected cash/variance locally with the movements-only formula. That equals the server only while the server basis is `movements_only` (the default). If the server reports `receiving_shift_receipts`, `cashTotals()` now returns `null` — no local expected/variance and no client-side block on it; the server alone decides, and the shift details page shows its summary. Older servers (no `cash_summary`) behave exactly as before. Unit + integration tests added.
- `FUEL_SHIFT_CASH_RECEIPTS_ENABLED` stays **off by default** (`config/fuel_stations.php` → `false`; not set in any CI/deploy file). This PR does not change it.
