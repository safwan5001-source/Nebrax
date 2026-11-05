# VISUAL_QA_REPORT_UI_2 — AWJ Fuel Stations UI-2 (seller writes: open shift, readings, handover)

| | |
|---|---|
| **Status** | **PASS — implementer self-assessment (Chromium, iPhone-size emulation).** Real iPhone/Safari: **BLOCKED**. Real new-employee UX session: **PENDING**. Independent reviewer sign-off + owner approval: **PENDING** (this is not that approval). |
| **Task** | #2007 (UI-2) · base `main` @ `e69501e` · contract: [Design System V2](../AWJ_FUEL_STATIONS_DESIGN_SYSTEM_V2.md) |
| **Reference** | [`NEBRAS_STATION_UI_V2.reference.html`](../reference/NEBRAS_STATION_UI_V2.reference.html) — its «قراءات المضخات» (meters) and «تسليم الفترة» (handover) pages. Its sample numbers, sales/card reconciliation and mock logic are **not** requirements. |
| **Build under test** | Production build (`next build` + `next start`), API fully intercepted by a stateful mock that mimics `FuelShiftService`; all names *Fixture*/«تجريبية». **No station or tenant data touched.** |
| **Evidence** | [`ui-2/sheets`](ui-2/sheets/) · [`ui-2/comparison`](ui-2/comparison/) · machine probes [`ui-2/automated-findings-ui2.json`](ui-2/automated-findings-ui2.json) (128 cells) |

> Passing tests were **not** used as evidence of design success. I opened the captures and compared them with the reference; two visible defects were found that way and fixed (§4).

## 1. Method
16 states reached by **real interaction** (not injected state) × viewports (390×844 at AR/EN × light/dark; 320×568 and 430×932 at AR/EN light) = **128 full-page captures** + viewport captures + the reference pages at 320/390. States: home with open shift · open form (empty / filled / confirm / success) · readings (empty / filled with warnings / review dialog / ending-below-opening blocked / complete) · handover (readiness incomplete / counted with shortage / confirm dialog / done) · lost-reply notice · server-refusal notice.
Probes on every cell: horizontal overflow, targets < 44 px, clipped text, field font < 16 px, action bar vs bottom nav, Arabic-Indic digits, links leaving `/fuel-stations/ops`, POSTs outside the six-route whitelist, console errors, dev overlay.

## 2. Results
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | V2 tokens / premium industrial look, no ERP template | **PASS** | Navy masthead → bordered cards → orange single CTA; same tokens as UI-0/1 scoped under `[data-fuel-ops]`. [EN light](ui-2/sheets/screens-390-en-light.png) · [AR light](ui-2/sheets/screens-390-ar-light.png) |
| 2 | Matches the reference's meters/handover pages | **PASS with accepted deltas (§3)** | [meters AR 390](ui-2/comparison/meters-entry-ar-light-390x844-reference-vs-implementation.png) · [handover AR 390](ui-2/comparison/handover-ar-light-390x844-reference-vs-implementation.png) · 320: [meters](ui-2/comparison/meters-entry-ar-light-320x568-reference-vs-implementation.png), [handover](ui-2/comparison/handover-ar-light-320x568-reference-vs-implementation.png) |
| 3 | One-handed iPhone use; 44 px targets; safe area; sticky action bar never under the nav | **PASS** | 128/128: 0 targets < 44 px; action bar sits ≥ 41 px above the nav in every cell; inputs 56 px tall, ≥ 16 px font (no iOS zoom), `inputmode=decimal`. |
| 4 | RTL/LTR + light/dark legible | **PASS** | [AR light](ui-2/sheets/screens-390-ar-light.png) · [AR dark](ui-2/sheets/screens-390-ar-dark.png) · [EN light](ui-2/sheets/screens-390-en-light.png) · [EN dark](ui-2/sheets/screens-390-en-dark.png). Logical utilities only (static test). |
| 5 | Digits 0–9 only | **PASS** | 0/128 cells contain Arabic-Indic digits; unit test accepts Arabic input and sends Latin integers. |
| 6 | 320 → 430 widths | **PASS** | 0 px overflow, 0 clipped text in 128/128 (after fix §4.1). [open form](ui-2/sheets/widths-open-form-filled-ar-light.png) · [ending blocked](ui-2/sheets/widths-entry-closing-blocked-en-light.png) · [handover](ui-2/sheets/widths-handover-ready-ar-light.png) · [lost reply](ui-2/sheets/widths-state-lost-reply-en-light.png) |
| 7 | Honest states: error / blocked / unconfirmed / refused / offline / empty | **PASS** | Sheets above include: closing-below-opening error with the opening value, lost-reply warning with "Check status", server-refusal message, disabled review button with reason. Offline and no-permission covered by Playwright functional specs (not captured). |
| 8 | **Single primary action per screen; next step visible without scrolling** | **PASS** | Probe: ≤ 1 primary action outside a dialog in every functional step; home's step + button are inside the first 390×844 screen after fix §4.2. [home](ui-2/sheets/screens-390-en-light.png) |
| 9 | Safe-write UX: confirmation before every write; no "saved" without server proof | **PASS (functional)** | Review dialogs for open/readings/handover; handover needs an acknowledgement checkbox; each success banner only after a verified reply (Playwright + 37 integration tests). |
| 10 | App-only: no link leaves `/fuel-stations/ops`; no ERP jargon | **PASS** | 0 off-app links in 128 cells and every functional step; static copy test. |
| 11 | Writes limited to the six whitelisted routes | **PASS** | 0 non-whitelisted POSTs in 128 cells; max 9 POSTs per cell (the 9-reading batch). |
| 12 | Keyboard open (iPhone) | **PARTIAL** | Enter moves focus to the next field (asserted in Playwright); sticky bar uses `position: sticky` (not `fixed`) to limit iOS keyboard issues. **Real Safari keyboard/visual-viewport behaviour is unverified.** |
| 13 | **Real iPhone / Safari** | **BLOCKED** | No device/WebKit. Deferral **D1** — required before rollout. |
| 14 | Independent reviewer / owner approval | **PENDING** | Deferral **D2** (Codex review requested in the PR). |
| 15 | New-employee comprehension | **PENDING (real test)** — heuristics only | Steps: open (1 field) → readings (one list, one review) → handover (3 numbered cards). One primary button each. No real session was run and none is claimed. |

## 3. Accepted differences vs the reference
| # | Delta | Reason |
|---|---|---|
| A1 | Reference meters page = one pump, two inputs, hard-coded fuel name. Ours lists **every active nozzle and tank of the station**, with a review step | Dynamic setup (DS §13); readings are immutable on the server so review-before-save is a safety requirement |
| A2 | Reference handover reconciles *sales vs cash vs card* with a variance box. Ours counts **cash against the operational expected** (float ± documented entries) and shows "Network and cards — not available right now" | Sales/card reconciliation has no verified server contract (**BLOCKED B1/B5**); inventing it would be false verification |
| A3 | Reference stepper (1–2–3) → ours three numbered cards (readings, cash, handover) | Same mental model; every step is a real, verifiable server state |
| A4 | Reference "send to supervisor" → ours "hand over" with a protected confirmation; supervisor approval stays a separate supervisor action | The server is `open → closed → approved`; no submitted/returned states |
| A5 | Pages are longer than the reference (9 inputs at once) | Real station size; sticky action bar keeps the primary button reachable |
| A6 | Reference variance box is green/neutral; ours shows direction (overage/shortage) as text + icon, never colour alone | Accessibility rule |

## 4. Defects found by looking/probing — fixed
1. **Names truncated with "…" at 320 px** (user/station on the open form and confirm, review-row title, product name on home) → wrap instead of truncate. (10 matrix cells failed the clipped-text probe before the fix.)
2. **Home primary button below the fold** on 390×844 → next step + button now above the liters card.
3. **Redundant label**: each reading field repeated the pump/nozzle name already in the row heading → visible label is now "Starting/Ending reading", full name kept as `aria-label` (contains the visible text, WCAG 2.5.3).
4. Probe false positive in my own spec (counted plain `<label>` text as a tap target) → restricted to labels wrapping checkboxes/radios.

## 5. Open, non-blocking
Tiny text: the only < 12 px text is the 11 px bottom-nav labels (inherited from UI-0). Sunlight/Dynamic Type/Safari toolbar behaviour unverified. The home "next step" clock icon suggests waiting even when an action exists — cosmetic, deferred.
