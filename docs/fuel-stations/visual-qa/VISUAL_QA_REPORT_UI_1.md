# VISUAL_QA_REPORT_UI_1 — AWJ Fuel Stations UI-1 (shift details & meter readings, read-only)

| | |
|---|---|
| **Status** | **PASS — implementer self-assessment for the implemented UI-1 slice (Chromium, iPhone-size emulation).** Real iPhone/Safari: **BLOCKED** (no device/WebKit here). Independent reviewer sign-off: **PENDING** — this is **not** the independent approval the issue requires. |
| **Task / PR** | #2002 (UI-1) · base: UI-0 merged in PR #1993 (`3d26ef4`) · contract: PR #1990 / [Design System V2](../AWJ_FUEL_STATIONS_DESIGN_SYSTEM_V2.md) |
| **Reference** | [`../reference/NEBRAS_STATION_UI_V2.reference.html`](../reference/NEBRAS_STATION_UI_V2.reference.html) — its «قراءات المضخات» (meters) and «فترات التشغيل» (shifts) pages. Its Nebras name, sample numbers, two-shift model and mock logic are **not** requirements. |
| **Build under test** | Production build (`next build` + `next start`), API fully intercepted, all names labelled *Fixture*/«تجريبية»; **no station or tenant data touched** (the sandbox has no access to any). |
| **Evidence** | [`ui-1/`](ui-1/) (sheets + side-by-side comparison) · machine probes [`ui-1/automated-findings-ui1.json`](ui-1/automated-findings-ui1.json) |

> Passing unit/e2e tests were **not** used as evidence of design success. The conclusions below rest on screenshots I opened and compared against the reference. The first rendering of the list card wrapped its label and was visibly taller than the reference — fixed (§4) and re-captured.

## 1. Method
1. Production build; Playwright (Chromium, `isMobile`, touch) with `e2e/fuel-ops-visual-qa-ui1.spec.ts`: **5 screens** (home, shifts list, details of an open / closed / approved shift) × **5 viewports** (320×568, 375×812, 390×844, 414×896, 430×932) × **light/dark** × **AR (RTL)/EN (LTR)** = **100** full-page captures, **36** state captures (13 states at 390 — dark for 5), and the reference pages at the same viewports.
2. Composites: reference ↔ implementation side by side, per-screen sheets, width sheets, scrolled-to-end sheets (bottom-nav clearance), state sheets.
3. Automated probes on every matrix cell: horizontal overflow, touch targets < 44 px, **clipped text** (`scrollWidth > clientWidth` with hidden/auto overflow), last-content clearance above the fixed nav, `<select>` font size, Next dev overlay, `dir`/theme class, **Arabic-Indic digits**, console errors, and **any non-GET request**.

## 2. Results by criterion

| # | Criterion (issue §7–8) | Result | Evidence |
|---|---|---|---|
| 1 | V2 tokens / Premium Industrial Operations, no ERP template | **PASS** | Same navy masthead → raised card → 32px figure → bordered cards as UI-0; tokens still scoped under `[data-fuel-ops]`. [screens-390 AR light](ui-1/sheets/screens-390-ar-light.png) |
| 2 | Matches the reference's meters/shifts pages in order, density, radius, proportions | **PASS with accepted deltas (§3)** | [readings AR 390](ui-1/comparison/readings-ar-light-390x844-reference-vs-implementation.png) · [shifts AR 390](ui-1/comparison/shifts-ar-light-390x844-reference-vs-implementation.png) · 320: [readings](ui-1/comparison/readings-ar-light-320x568-reference-vs-implementation.png), [shifts](ui-1/comparison/shifts-ar-light-320x568-reference-vs-implementation.png) |
| 3 | One-handed iPhone use; 44 px targets; safe area; no overlap with bottom nav | **PASS** | 100/100 cells: 0 targets < 44 px; min clearance above the nav **41 px**; nav padded by `env(safe-area-inset-bottom)`. [scrolled-bottom](ui-1/sheets/scrolled-bottom.png) |
| 4 | RTL/LTR + light/dark legible | **PASS** | [AR light](ui-1/sheets/screens-390-ar-light.png) · [AR dark](ui-1/sheets/screens-390-ar-dark.png) · [EN light](ui-1/sheets/screens-390-en-light.png) · [EN dark](ui-1/sheets/screens-390-en-dark.png). Logical utilities only (existing static test covers the new files). |
| 5 | Digits 0–9 only | **PASS** | 0/100 cells contain Arabic-Indic digits; unit tests assert the same for AR. |
| 6 | Widths 320→430 | **PASS** | 0 px overflow, **0 clipped text** in 100/100. Each nozzle shows opening|closing in two columns and the computed liters on its own row so 7–8-digit meters with 3 decimals never clip at 320. [open](ui-1/sheets/widths-detail-open-ar-light.png) · [closed (EN dark)](ui-1/sheets/widths-detail-closed-en-dark.png) |
| 7 | Honest states: loading / empty / 403 / 404 / offline / stale / error / missing reading | **PASS** | [data states AR](ui-1/sheets/states-data-ar-light.png) · [data states EN](ui-1/sheets/states-data-en-light.png) · [error states AR](ui-1/sheets/states-errors-ar-light.png) · [error states EN](ui-1/sheets/states-errors-en-light.png) · dark: [AR](ui-1/sheets/states-ar-dark.png) · [EN](ui-1/sheets/states-en-dark.png). Includes: open-partial, open-no-readings, closed, approved, **mismatch + invalid pair**, no time zone, **refresh failed → last data kept with notice**. |
| 8 | `0` vs unknown/missing | **PASS** | Open shift's stored `0` is never shown (list card says "Computed when the shift closes"; details show `—` + "not computed yet" until a nozzle completes). Opening reading `0` renders `0.000`; absent readings render "Not recorded". Unit + integration + e2e tests. |
| 9 | Read-only: no write endpoint, no button that claims to save | **PASS** | 0 non-GET requests in all 136 captures **and** in the functional specs; controls on the details screen = *Refresh* only (tested); upcoming actions are inert text with a «قريباً» badge. |
| 10 | No cross-station/tenant leakage | **PASS** (functional) | Integration + e2e: station switch clears at once; foreign-station shift "not available" and its data never reaches the DOM; tenant switch; malformed id never becomes a request. Not re-proved visually. |
| 11 | Console / overlay intrusions | **PASS (production)** | 0 console errors, 0 Next overlays in all runs. (Dev-mode `IntlError INVALID_KEY` for `developer.events` keys is a pre-existing repo-wide noise.) |
| 12 | Keyboard open | **N/A** | UI-1 has no text field (only a native station `<select>` and buttons). |
| 13 | **Real iPhone / Safari** | **BLOCKED** | No device/WebKit. Sunlight, Dynamic Type, Safari toolbar, native `<select>` sheet, `dvh`/notch behaviour, `Intl` date output on Safari remain unverified. **Deferral item D1.** |
| 14 | Independent reviewer sign-off; owner approval | **PENDING** | Required before any merge/deploy. Deferral item D2. |

## 3. Accepted differences vs the reference (with reason)
| # | Delta | Reason |
|---|---|---|
| A1 | Reference's meters page is an input form (two numeric fields + "review" button). Ours is a **read-only** list of readings | Issue §4: no recording in UI-1; no button may claim to save. The input form belongs to UI-2 |
| A2 | Reference shows one pump with a hard-coded fuel name; ours groups **every** pump/nozzle of the station | Issue §6/DS §13: no fixed catalog/device counts; names come from AWJ setup |
| A3 | Reference shows "الفترة الأولى 06:00—02:00" and SAR sales; ours shows shift number, real stamps, and **meter liters** | Schedules/sales aren't in the verified read API; sales are never derived from meters |
| A4 | Station picker row + back chevron in the masthead; AWJ mark, not "NEBRAS STATION" | Dynamic identity (DS §13); same as UI-0 A1–A3 |
| A5 | Details page is long (≈4,200 px at 320) vs the reference's single card | Real data: N pumps × M nozzles + progress + tanks + cash; sections are ordered by importance (summary → liters → progress → readings) |
| A6 | Bottom tabs: Home / Products / Shifts / Profile (reference: Handover / Meters / Shifts) | As UI-0 A8 |
| A7 | List card rows (`label … value`) are denser than the reference's single value row, plus a "View details" link row (44 px) | One explicit, large tap target per card instead of a whole-card link with a long accessible name |

## 4. Delta list — fixed during QA (found by looking)
1. List card: the "Operational liters (from meters)" label wrapped onto two lines and the open-shift cell read `— · Computed when…` (awkward) → short label «اللترات من العدادات / Meter liters», compact `label | value` rows (like the reference's `.line`), open value is plain muted text.
2. Details: the liters section had a screen-reader-only heading that repeated the *closed* caption even for an open shift → the section is labelled by the actual caption (open vs closed).
3. A first-frame "Updated —" flash before the fetch time was recorded → the fetch time is now captured synchronously with the data (idempotent per data identity).

## 5. Open, non-blocking
* O1 11 px is the smallest text on the screens (inherited `FinancialSummary` cell captions from UI-0). DS §4 prefers 12–14 px for metadata; not changed here to keep UI-0's approved composition. Reviewer decision.
* O2 Native `<select>` for the station picker (as UI-0): iOS rendering unverified (D1).
* O3 Dark masthead vs canvas contrast is close (UI-0 O3); separation relies on the raised card.
* O4 `Intl` date strings differ by locale (AR: `2026/11/04، 6:00 صباحًا`, EN: `4 Nov 2026, 06:00 AM`) — both come from the shared central formatters.
* **Backend gaps G1–G6** are listed in the [implementation report](../AWJ_FUEL_STATIONS_UI_1_IMPLEMENTATION_REPORT.md) §4. G2 (shift GETs aren't station-restricted) is a server issue the UI only mitigates.

## 6. Results (actual runs on the final code)
| Check | Result |
|---|---|
| `vitest` module `station-ops` | **12 files / 324 tests passed** (UI-0: 10 files / 245; UI-1 adds `readings.test.ts` 23 + `shift-detail.integration.test.tsx` 37; two UI-0 tests that asserted the stored-`0` behaviour were corrected) |
| Full `web` suite (`vitest run`) | **879 files / 10,520 tests passed** (UI-0 run was 872 / 10,386, on a different `main`) |
| `next build` (production) | passed; route `/fuel-stations/ops/shifts/[id]` present |
| Playwright functional `playwright.fuel-ops.config.ts` (UI-0 + UI-1, desktop 1440 + mobile 390) | **50 / 50 passed** |
| Playwright visual `fuel-ops-visual-qa-ui1.spec.ts` | **137 / 137 passed** (100 matrix + 36 states + reference captures) |
| Probes (100 matrix cells) | overflow max **0 px** · touch targets < 44 px **0** · clipped text **0** · min clearance above nav **41 px** · `<select>` font **16 px** · Arabic-Indic digits **0** · non-GET requests **0** · console errors **0** · dev overlays **0** |
| Backend contract (read-only verification) | `php artisan test --filter=FuelShiftApiTest` → 1 passed (33 assertions); **no backend file changed** |

## 7. Deferrals (explicit)
* **D1 — Real iPhone/Safari**: BLOCKED; required before any activation.
* **D2 — Independent visual review + owner approval**: PENDING.
* **D3 — CI + Codex review**: to be recorded on the PR.
* UI-2 (writes) **not started**.

## 8. Re-run
```
cd web && npx next build && npx next start -p 3012 &
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.fuel-ops.config.ts            # functional (UI-0 + UI-1)
VQA_OUT=/tmp/vqa-ui1 VQA_REFERENCE_HTML=$PWD/../docs/fuel-stations/reference/NEBRAS_STATION_UI_V2.reference.html \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-visual-qa-ui1.spec.ts
```
The sheet/comparison composer is a local helper (not in the repo); raw per-cell images are regenerated by the spec.
