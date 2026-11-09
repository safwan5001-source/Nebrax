# محطات أَوْج | AWJ Fuel Stations
# Final UI/UX Implementation Contract — V2
**Status:** Mandatory design implementation/review contract (pending PR merge).  
**Applies to:** AWJ Fuel Stations operator, supervisor, fuel receiving and supporting account screens.  
**Depends on:** [Design System V2](./AWJ_FUEL_STATIONS_DESIGN_SYSTEM_V2.md), [Functional Plan](./AWJ_FUEL_STATIONS_OPERATOR_SUPERVISOR_PLAN.md), [Verified API Matrix](./AWJ_FUEL_STATIONS_UI_API_INTEGRATION_MATRIX.md).  
**Primary task:** #1984; first implementation task: #1988.  
**Approval principle:** Passing code/unit/browser tests **never substitutes for visual and interaction acceptance**.

## 0. Purpose, priority and source hierarchy
The first UI-0 implementation demonstrated functional progress but was visually inconsistent with the **approved mobile operator prototype**. This document is a corrective *implementation contract*, not a request to rewrite all working data adapters.

Priority for UI decisions:
1. Tenant/auth/security/accounting correctness + existing AWJ API contracts.
2. This **visual implementation contract** and the approved V2 Design System.
3. The approved operator reference prototype (the original Arabic `NEBRAS_STATION_UI_V2.html`; historical, standalone demo, not a production backend). A copy must be attached to the implementer's task or committed as a read-only reference before a final visual comparison; a ChatGPT sandbox link is **not** accessible to Claude Code by default.
4. Relevant functional plan and integration matrix.
5. Ad hoc screenshots/early UI-0 code are **not approved visual references**.

**Do not silently treat the reference's hard-coded station name, logo letter, sample numbers, two shifts, labels or JavaScript mock logic as product requirements.** The *composition, hierarchy, spacing, brand restraint, and interaction patterns* are the approved reference direction. Final name is **«محطات أَوْج | AWJ Fuel Stations»** with authorized tenant/station identity dynamically from AWJ.

## 1. Design direction and fidelity targets
**Premium Industrial Operations:** elegant, restrained, efficient station operations UI designed for iPhone. Not a generic ERP dashboard, template, AI-looking card collection, or consumer e-commerce storefront.

### Approved composition translated from reference
- Home top = **midnight navy masthead** with brand, small operational identity, a single accessible icon/action, contextual greeting and operator station/shift label.
- **Current shift white foreground panel overlapping the lower edge of the navy masthead** in light mode; adapt with a raised high-contrast semantic surface in dark mode.
- Main content = warm near-white canvas, readable compact sections, one **large financial/quantity summary** followed by two restrained collection cards.
- One **visually dominant orange primary CTA** for the next permitted action. Lower-priority actions in compact bordered cards/secondary buttons.
- **Fixed bottom navigation** inside safe area with properly reserved scroll padding; never overlap content or keyboard.
- Specialist screens = navy small masthead, clear title/subtitle, single-column content and step-driven forms. Avoid horizontal clipping, oversized empty space, giant irrelevant decoration or repeated headers.

### Palette and typography (semantic tokens, no raw colors spread through components)
| Token | Approved baseline | Use |
|---|---|---|
| `brand.navy` | `#142238` | masthead/header/dark ink |
| `brand.orange` | `#E87722` | limited actionable accent, not whole page |
| `surface.canvas` | `#F7F8FA` | light page background |
| `surface.card` | `#FFFFFF` | primary card |
| `status.success` | `#14866D` | approved/matched states |
| `text.secondary` | `#586576` | helper labels |
| `border.subtle` | `#E3E7EC` | hairlines / borders |
Choose accessible dark equivalents by semantic role; do not invert blindly. The reference prototype used a slightly darker orange `#D76A19` for its CTA; use the design system's `#E87722` as authoritative while checking contrast for white CTA text and adopting an accessible foreground/background variant where necessary.

- Typography: **IBM Plex Sans Arabic** for Arabic; align Latin and numeric glyphs; no random font substitution.
- Heading 22–24px, section headings 16–18px, primary text and inputs ≥16px, key amount 28–32px, helper text 12–14px when legible.
- Western digits `0–9` for financial values, tabular aligned amounts, explicit `ر.س`, `لتر`, `ر.س/لتر`, locale-aware grouping and AWJ-authoritative decimal precision.
- Recommended 4/8/12/16/24/32px spacing, 16–20px horizontal page padding, 10–16px cards. Touch targets ≥44×44pt equivalent; primary CTA height 52–56px. These dimensions are baseline targets, not exemptions from device-accessibility validation.
- Subtle borders, minimal restrained shadow; no neon, glassmorphism, large gradients, glowing buttons, big stock photographs or arbitrary emoji as functional icons. Use the approved Lucide/icon library with consistent stroke.

## 2. App shell and navigational behavior
- Support mobile viewport widths **320, 375, 390/393, 414 and 430px**, and tablet/desktop without horizontal overflow.
- RTL first; English LTR must reverse directional navigation/back chevrons and preserve number layout.
- Top masthead contains **AWJ Fuel Stations**, optional authorized tenant logo/name, selected station and current role; never show hard-coded `Acme Fuel`, `Harbor Station`, `Sami`, `Alpha Grade` or `Beta Grade` in production.
- Station selector shows only scoped authorized stations from AWJ; changing station clears previous station's content, cached queries and in-flight stale renders. Show loading/error/empty station states.
- Role-driven bottom nav: 4 or 5 items max at once; operator defaults to Home, Products/Meters, Shifts, Profile. Supervisor defaults to Overview, Approvals, Receiving, Reports, Profile. Settings via profile/visible header. Disable/omit features **only in keeping with actual AWJ permissions** and label unimplemented features «قريبًا» without pretending they work.
- Desktop may use side navigation; retain same information hierarchy and no distinct data source.
- Respect `env(safe-area-inset-bottom)`, keyboard, zoom, 200% text size, Dynamic Type and Safari toolbar. Bottom bar must not cover final list item, CTA, dialog, toast or focused input.
- Sticky CTA must not compete with bottom nav. A page-scoped submit button remains visible without two sticky stacked bars.

## 3. Mandatory component library
Build/reuse typed components and document props/states. Components MUST follow V2 tokens:
1. `StationAppShell`: masthead, scoped tenant identity, station picker, page heading, bottom navigation and safe-area layout.
2. `ShiftStatusBadge`: explicit text + icon (open/closed/approved, with pending/returned only if supported by API).
3. `CurrentShiftCard`: shift identifier, stage, time/date, assigned staff when available and source freshness; no invented zero liters.
4. `MetricCard` / `FinancialSummary`: sale total and liters **separate from collections**, explicit currency/unit/precision, drilldown and unavailable state.
5. `FuelProductRow`: AWJ product name, effective verified price or «السعر غير متوفر», number of real assigned pumps/nozzles, quantity, link to detail.
6. `PumpNozzleRow`: actual pump/nozzle identifiers, mapped product/tank, opening/closing meter, validations, inaccessible/no assignment states.
7. `CashCollectionPanel`: cash, network/card, other supported AWJ methods, count and variance based on independently sourced sales. No mock payment method in production.
8. `ActionButton` and `SecondaryAction`: loading, disabled explanation, confirmation, failure/retry, RBAC.
9. `ShiftHandoverStepper`: evidence/reconciliation/confirmation, read-only until backend operations are approved for write.
10. `SupervisorReviewCard`: operator, shift, exceptions, detail/approve; return for correction future-only.
11. `FuelReceiptWizard`: delivery identification, tank readings before/after, supplier docs, quantity variance and approval when supported by existing receiving API.
12. `SettingRow`, `ProfileHeader`, `ReadOnlyIdentityField`, `AuditTimeline`, `DocumentAttachment` (if supported), `EmptyState`, `ErrorState`, `LoadingSkeleton`, `PermissionState`, `OfflineNotice`, `ConfirmDialog`, `Toast`.
- If a reusable existing component matches these requirements, use it rather than duplicate. No dead/inert visible buttons.
- Build a **component showcase/story/test fixtures** for visual and state QA, separate from production data.

## 4. Screen-by-screen final contract

| ID | Screen | Required hierarchy + actions | States and data contract |
|---|---|---|---|
| O-01 | Operator Home | navy masthead → overlapping current shift → large sales/liters → cash/card cards → one orange next-action → shortcuts → outstanding issues | dynamic AWJ station/shift, clear no-shift/error/permission/offline; sale not calculated from cash/card |
| O-02 | Products | grouped fuel products with liters/price/source status, expand into actual pump/nozzle mapping; no hard-coded 3 fuel types | products from AWJ; product with no mapped active nozzle is not dispensable; missing approved price ≠ zero |
| O-03 | Product Details | product name, price effective time, related tanks/pumps/nozzles, quantity evidence by shift | scoped mapping, pagination if needed, inherited route permission checks |
| O-04 | Meter Readings | pump/nozzle rows with opening and closing values, numeric keypad, computed nonnegative liters, warnings for rollover/invalid/duplicate | only server-validated writes when stage enables; default UI-0 read-only; no synthetic readings |
| O-05 | Shift Handover | stepper, independent sales summary, actual cash/card/other collections, variance, note required if policy, confirmation | `open→closed→approved` are currently supported; no fake `submitted/returned`; idempotency & audit |
| O-06 | Shift History | selected date range, status, details, seller/station, source totals, variance, approval | API pagination, all configured shifts per day, loading/empty/retry |
| S-01 | Supervisor Overview | current station operational status, actionable shifts, anomalies, tank/receiving summary, quick review | permission-scoped, don't imply unverified stock level |
| S-02 | Shift Review | exact source meter readings, sales, cash/card, variance, operator and audit; approve if allowed | correction/return is labeled future-only until backend implements; approval confirmation & server response |
| S-03 | Cash Handover | counted cash, expected sales, signed handover, responsible user/time | never silently post financial adjustment; require policy and API contract |
| S-04 | Fuel Receipt | staged delivery entry, supplier/vehicle/document/product/tank, measured before/after, concurrent dispensing, variance, upload only if supported | station/tank/warehouse scope and GRNI prerequisites sourced from AWJ; one inventory posting |
| S-05 | Tank Status | tank/product/capacity/current *verified* level/variance/last reading, operational alerts | separate tank measurement and accounting inventory; no fabricated balance |
| S-06 | Reports | selected station/date/custom number of shifts, product liters, sales, cash, network, variance, approval, exports | no double aggregation, match detail rows, explicit filters, Excel/PDF when implemented |
| A-01 | Settings | personal appearance/language first, authorized station settings as distinct section; center-managed fuel/price/device/payment configuration | AWJ API only, permission-based edit or read-only explanation; safe save/errors |
| A-02 | My Profile | AWJ identity, staff role/station scope read-only, profile prefs, security/password via AWJ, logout | no separate users/passwords; session logout completes |
| A-03 | Select Station | searchable authorized station list, scoped identity, empty state, remembered allowed choice | switching tenant/station invalidates previous scoped views |
| A-04 | Help & Issues | contextual assistance, server validation errors, audit-backed unresolved anomalies | no generic «3 Issues» DevTools widget or test overlay in released UI |

Each screen must have: responsive mobile design, RTL/LTR, both themes, relevant loading/empty/error/permission/unavailable states, action availability and meaningful keyboard/screen-reader labels. For screens outside current implementation slice, show appropriately labeled *not yet implemented* or leave them out of production nav; mockup screens may exist only in a clearly labeled preview.

## 5. Interaction states — coverage matrix
For every component involving remote data, test:
- `loading`, `success`, `empty`, `403 forbidden`, `404 unavailable/out-of-scope`, `422 validation`, `5xx/server error`, `network offline`, `timeout`, `stale after station switch`, `retry`, and `unpriced/unconfigured` as applicable.
For each permitted write: `idle`, `editing`, `invalid`, `submitting`, `confirmed`, `server rejected`, `duplicate retry/idempotency`, `locked after approval`.
- No buttons advertise success until a server response confirms it.
- Do not show `0` in place of `unknown`, missing, not configured or not yet measured.
- Error/variance uses text and status icon, never color alone.
- Show current shift state as the API does; do not create unsupported «returned» transitions in frontend state.
- Ignore pending/stale requests after tenant/station change.
- Accessibility: discernible labels, visible focus, semantic headings and field errors, screen readers, minimum touch targets, high contrast in light/dark.

## 6. Data integrity and RBAC (hard gates)
- **All real data** from existing AWJ Fuel Stations APIs: stations, products, effective price records, tanks, pumps, nozzles, readings, shifts, sales, collections and deliveries.
- No parallel DB, custom role system, hard-coded tenant, products, pump counts, opening cash, meters, stock or prices.
- AWJ backend is the ultimate RBAC/tenant/branch/station/warehouse/asset gate. UI hiding does not replace the server check.
- Seller/supervisor/operator see only actual permissions; tenant-specific branding is cosmetic only.
- Financially risky actions never run in a visual preview. Settings and profile may show only actual available data/controls.
- **Operator and supervisor working flows are staged:** UI-0 read-only; write flows require separate PRs, domain tests and owner go-live approval.
- No modifying Nebras or any live tenant setup/data. Owner handles station setup manually and independently.

## 7. Visual QA — REQUIRED EVIDENCE / MERGE BLOCKER
**Visual approval is a mandatory gate alongside CI.** Codex/ChatGPT review must independently approve it before the owner is asked to merge.

### Capture requirements
Provide real browser captures (not AI-generated renderings):
- iPhone 390×844 / 393×852; small 320×568; wide 430×932.
- **Light and dark mode**, Arabic RTL and English LTR; minimum Home, Products, Shift Readings/Handover, Supervisor Overview, Receiving, Settings and Profile as implemented.
- A separate screenshot of bottom navigation with long page content and keyboard open; capture no clipped content.
- State examples: active shift, no active shift, empty products, missing price, forbidden, loading, variance, server failure/offline.
- For partial UI slices, screenshot all **implemented** screens and mark deferred ones in a coverage table rather than fabricating screenshots.

### Comparison and sign-off
1. Reviewer opens approved standalone **operator reference HTML** and implementation at the same iPhone viewport; compares **navy masthead, raised shift card, section density, financial hierarchy, CTA accent, border/padding scale, bottom nav and typography**.
2. Make **side-by-side comparison** with a list of deltas and their dispositions (fixed / accepted with reason / blocking).
3. Required functional snapshots and screenshot-based regression tests (Playwright when available), deterministic fixture data.
4. Acceptance must cover typography and spacing, RTL/LTR directionality, financial legibility, contrast, touch/keyboard, true dark mode, safe areas and no console/test-overlay intrusions.
5. **Any significant disparity on identity, hierarchy, top/current shift card, primary CTA, navigation, or usability FAILS visual gate.** «Looks good» or test count alone does not satisfy gate.
6. A qualified reviewer writes a structured `VISUAL_QA_REPORT.md` with status `PASS | FAIL | BLOCKED`, reference location, captures, comparison table, open defects, date and reviewer decision.
7. **No approval or merge** while visual QA = FAIL/BLOCKED, even if lint, typecheck, build and all unit/e2e tests pass.
8. If the reference HTML is not accessible to the implementer, mark side-by-side comparison BLOCKED; request it from the owner or use a repository-attached copy after evidence, rather than claiming parity.
9. No deployment until owner explicitly authorizes it, and financial/system acceptance is separate.

### Reviewer checklist (all mandatory for the current slice)
- [ ] V2 components use semantic tokens; no copied AWJ ERP page template as final operational UI.
- [ ] Reference-like masthead/shift card/metric/action hierarchy, justified where role differs.
- [ ] Light and dark genuinely legible; readable 0–9 quantities and prices.
- [ ] Actual scoped API data only; demo fixtures isolated and labeled.
- [ ] Navigation and CTAs work or are explicitly unavailable; no inert buttons.
- [ ] No station or tenant cross-contamination.
- [ ] Safe area, scroll, keyboard and 320px narrow screen pass.
- [ ] Required screenshots, comparison evidence, VISUAL_QA_REPORT and tests attached.
- [ ] Review sign-off with documented residual nonblocking issues.
- [ ] Owner approval before merge/deploy.

## 8. What the current UI-0 work should do now
1. **Keep existing correct adapters, routing, auth, RBAC and tests**; do not throw away functional implementation.
2. Compare current screenshots against this specification; log discrepancies.
3. Refactor presentation/components into V2 shell and composition where needed, without widening backend scope.
4. Ensure strings and demo fixtures are not hard-coded in production. Demo `Acme Fuel`/`Harbor Station` is acceptable only for isolated test fixtures.
5. Fix bottom navigation overlay and any page/keyboard clipping.
6. Run unit/integration/build/browser checks and capture **fresh** iPhone screenshots across light/dark + RTL/LTR.
7. Submit `VISUAL_QA_REPORT.md`, API/data source mapping, tests and PR. **Stop before merge/deploy**.

## 9. Delivery matrix / slices
- **UI-0 (now):** read-only station picker, mapped fuel products/nozzles/pumps/tanks, current shift, auth/roles, profile/settings shell, high-quality V2 layout and visual proof.
- **UI-1:** reliable operator meter readings and real shift flow only after verified backend contract.
- **UI-2:** cash/card reconciliation/shift closing and supervisor review under existing backend policies and audit trail.
- **UI-3:** fuel receiving with physically measured tank variance and idempotent inventory movement.
- **UI-4:** full reports, exports, visual polish, wider tenant/UAT coverage.
- **Pilot:** owner-verified Nebras tenant data and parallel reconciliation by owner; operational go-live only after explicit acceptance.
Screens spec is product-wide, **not** a request to fake-complete all features in UI-0.

## 10. Handoff report contract for Claude
Claude must provide:
- branch/PR/head SHA, linked issue #1988 and reference documents;
- list of implemented / preview-only / deferred screens;
- component inventory and token conformance;
- exact existing API endpoints and role/tenant scopes;
- test commands + observed results, not anticipated results;
- QA screenshots with viewport, locale and theme labels;
- `VISUAL_QA_REPORT.md` PASS/FAIL/BLOCKED with justified differences;
- known blockers / remaining slices;
- no merge, deploy, mutation of live tenant data.

## 11. Source/reference accessibility
The historical operator prototype is a **standalone, locally supplied HTML demonstration** (title `NEBRAS STATION V2 — البائع`, 4 pages: home, handover, meters, shifts). It illustrates the agreed composition: navy `#142238` top, a white shift card overlay, `#F7F8FA` canvas, 32px KPI amount, small two-up cash/card cards, orange CTA, bordered shortcuts and safe-area bottom tabs. It uses local mock data and client-side fake submission. **It is not proof of end-to-end product behavior**.

This spec captures its visual invariants in text so work can proceed. A final parity sign-off still requires giving the implementer the original HTML file or an accessible, exact repository copy of it and comparing screenshots. Do not infer that it is available in the implementer's environment solely because a ChatGPT link exists.
