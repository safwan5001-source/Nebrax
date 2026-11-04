# محطات أَوْج | AWJ Fuel Stations — Design System V2
**Status:** Approved design direction; implementation tokens/specs proposed pending accessibility and iPhone validation  
**Date:** 2026-11-04  
**Product:** AWJ Fuel Stations — multi-tenant operator/supervisor mobile workspaces within AWJ ERP  
**Related functional plan:** [AWJ_STATION_OPERATOR_SUPERVISOR_PLAN.md](./AWJ_STATION_OPERATOR_SUPERVISOR_PLAN.md)

## 1. Product identity and boundaries
- Visual concept: **Premium Industrial Operations** / «تشغيل صناعي راقٍ»: restrained, practical, mature and production-grade. Avoid generic AI-generated dashboard looks.
- AWJ Fuel Stations is a **distinct visual experience** from AWJ ERP, not a new backend, authentication, RBAC, inventory ledger or accounting system.
- AWJ provides the source of truth: users, roles, permissions, station/branch scope, products, pumps, nozzles, tanks, transactions, prices, payment methods, stock and accounting.
- Primary target: iPhone mobile-first PWA-ready web workspace; responsive for tablets/desktop. Arabic RTL first with English LTR parity.
- No decorative 3D, glowing gradients, glassmorphism, generic fuel-station stock imagery on daily work screens, artificially perfect figures, redundant KPI tiles, or unusable interactions.

## 2. Design principles
1. **Operations before decoration**: prioritize current shift, products, quantity, collection, discrepancies and next action.
2. **Truthful numbers**: show sourced liters and sale totals separately from counted cash/card amounts; differences must be computed, never hidden by deriving sales from collections.
3. **Clarity by role**: operator, supervisor, and manager see contextual workspaces governed by AWJ RBAC server-side.
4. **One primary action per stage**: large, accessible touch targets; no high-impact action without confirmation.
5. **Explain status**: existing open/closed/approved and ordinary pending/offline/loading/error states must have readable labels and iconography, not color alone. A «returned for correction» shift state is **future-only until AWJ implements it**.
6. **Reliable audit trail**: approvals, receipt measurements and post-approval corrections must be traceable; do not mutate locked accounting records casually.
7. **Progressive disclosure**: short summary first, pump/nozzle and audit detail on demand.

## 3. Proposed semantic color palette
All tokens below are **design proposals**, not yet a shipped token package. Test contrast at actual size and both themes before release.

| Role | Token name | Light value | Usage |
|---|---|---|---|
| Core brand | `brand.navy` | `#142238` | Header, primary text, restrained dark navigation |
| Canvas | `surface.canvas` | `#F7F8FA` | Page background |
| Content | `surface.card` | `#FFFFFF` | Cards, sheets, fields |
| Primary accent | `brand.orange` | `#E87722` | One main action, active focus/selection (check accessibility) |
| Positive | `status.success` | `#14866D` | Approved/verified positive states |
| Negative | `status.danger` | `#B42332` | Deficits, errors, dangerous action |
| Caution | `status.warning` | `#A55A0C` | Pending/review required |
| Secondary ink | `text.secondary` | `#586576` | Captions and supporting text |
| Divider | `border.subtle` | `#E3E7EC` | Light 1px separators |

Build dark-mode counterparts by semantic role, **not by blindly inverting hex values**; verify WCAG AA contrast including orange text on light backgrounds. Prefer a light content surface with navy header/navigation for the default theme; offer dark mode for night work.

## 4. Typography and numbers
- Arabic preference: `IBM Plex Sans Arabic` (or tested comparable professional Arabic UI typeface); English and tabular figures should align consistently.
- English digits `0–9` throughout financial/quantity entries, with locale-aware grouping and explicit unit labels: `ر.س`, `لتر`, `ر.س/لتر`.
- Recommended desktop/mobile initial scale (validate on real devices):
  - Main page heading: **22–24px**.
  - Section heading: **16–18px**.
  - Form input/primary text: **16px** or larger to avoid iPhone Safari zoom.
  - Major financial figures: **28–32px**, tabular figures.
  - Metadata: **12–14px**, only where comfortably legible; avoid essential information in tiny text.
  - Primary button height: **52–56px**; interactive targets at least **44×44pt** equivalent.
- Amounts must preserve currency precision; quantities must respect the fuel measurement precision defined by AWJ, not JavaScript floats for financial posting.
- Never rely on font weight/color alone to convey shortage vs surplus.

## 5. Layout and spacing
- Mobile-first: single-column, minimal horizontal scrolling, safe-area-aware sticky bottom navigation/actions, clear priority hierarchy.
- Recommended spacing scale: `4, 8, 12, 16, 24, 32px` (proposed); consistent page padding 16–20px.
- Restrained card corners (e.g. 10–14px), subtle borders; avoid heavy drop shadows.
- Primary action may be sticky above navigation only when it does not cover fields or keyboard.
- Mobile tables should become readable lists/expandable rows; retain granular pump/nozzle data, filtering and summary totals.
- No decorative photos on core transaction screens; use imagery only where it serves identity or evidence (e.g. receipt/bill of lading).

## 6. Components (design specification)
- **App shell**: active station, current role, shift status, clear access to Profile and Settings; visible contextual navigation.
- **Station selector**: only AWJ-authorized stations, if more than one.
- **Product summary**: actual products returned by AWJ (including petrol 91, petrol 95, diesel if configured), liters, effective price, total revenue, link to associated nozzle/meter readings; never hard-code a fixed 3-product catalog.
- **KPI summary**: sales, liters, cash, card and variance; allow source/drill-down and indicate pending/stale data.
- **Meter reading row**: pump/nozzle, product, opening, closing, computed liters, error/help, optional evidence.
- **Collection block**: sales amount independent from counted cash + card + other methods, clear variance; special handling for credit sales, advances, expenses and float per approved policy.
- **Shift action panel**: reflect current AWJ backend states **open → closed → approved**. Additional draft/submitted/returned states are proposals requiring backend transition and authorization support; never display unsupported production actions. Provide confirmations and respect irreversible boundaries.
- **Supervisor review card**: staffed shift, status, products, readings, payment totals, discrepancy, document links and approval. «Return with reason» is a **future workflow pending API implementation**, not currently operable.
- **Fuel receipt stepper**: shipment identity → pre-unload tank measurement → actual delivered quantity/post-unload measurement → attachments/variance → authorized approval.
- **Settings page**: user preferences separated from station/financial policies (role restricted); products/prices/pumps/station shifts always AWJ-owned.
- **Profile page**: AWJ-backed user identity, role and station scope read-only, permitted profile preferences, security/password redirect to AWJ mechanism, activity, logout.
- **Feedback components**: skeleton, empty, blocked permission, offline, validation error, success notice, pending sync; no false ‘saved’ acknowledgments.

## 7. Role-specific navigation
### Operator
Home (current shift) · Products & meter readings · Cash & Card / shift handover · Shift history · Profile/Settings.
- Focus on the station's **configured number and schedule of shifts** (two daily shifts in the Nebras pilot only); never force per-vehicle manual sale entry if no forecourt integration.
- Operator must only access assigned station/shift/assets as granted by AWJ.

### Supervisor
Operations overview · Shift reviews/approvals · Fuel receiving · Tanks and alerts · Reports · Profile/Settings.
- Review outstanding work first; show exceptions and unresolved discrepancies.
- Cash custody handover between shifts, with actor/time and counts.

### Manager/accountant
Use AWJ existing management workspace/report permissions; do not rebuild general ledger, accounting or RBAC management in this design.

## 8. Interaction contracts
- **Shift, current backend:** open → record opening readings → record collections/closing readings → close → approve. **Proposed future branch:** close → supervisor returns with reason → corrected/resubmitted → approve, only after backend state transitions, authorization, audit and tests are implemented. Post-approval adjustments require authorized correction and audit record.
- **Products**: product-nozzle mapping determines readings/sales; totals grouped by fuel; changed prices during a shift must use correct effective-price/transaction history, not a single later price.
- **Reconciliation**: distinguish fuel meter variance, cash/card collection variance, tank physical/book variance and supplier delivery variance.
- **Fuel receiving**: measure before/after unload and account for possible concurrent dispensing; capture evidence, transport details, discrepancy causes; receiving inventory movement must not duplicate purchase posting.
- **Settings**: visual user preferences may be local/personal; station/financial settings must round-trip AWJ source of truth with server permission validation.
- **Profile**: session/profile sourced from AWJ; no separate user database or password storage.

## 9. Accessibility, localization, performance
- Arabic RTL and English LTR with logical CSS properties; keyboard focus and screen-reader labels.
- WCAG 2.2 AA target for contrast, focus visibility, status and non-color cues.
- Large numeric keypad on mobile; accessible input labels, errors next to fields, real validation.
- Optimistic UI only when safe, with reconciled server confirmation. Explicit offline read-only/pending states; no unverified offline financial writes.
- Support compact low-latency rendering on iPhone and slow station networks; no unnecessary image payloads.
- Thorough real-device iPhone Safari testing (sunlight, dark mode, zoom, accessibility text size, keyboard, safe areas).

## 10. Screen inventory for V2
1. Operator home/current shift.
2. Fuel products and product details (pumps/nozzles).
3. Opening & closing meter readings.
4. Cash/card/other payment reconciliation and handover.
5. Shift history/detail/corrections.
6. Supervisor home + work queue.
7. Shift approval with evidence and audit trail; future return-for-correction only after backend implementation.
8. Fuel supply receipt wizard + document upload.
9. Tank levels, deliveries, shortages/alerts.
10. Daily reports (all configured daily shifts; per product, liters, cash/card, variance) + Excel/PDF.
11. Settings (personal + operational restricted).
12. My Profile/security/logout.

## 11. Design QA gates — before implementation approval
- No unexplained dummy numbers or hard-coded catalog in production UI; fixture/mock labeling must be obvious in prototypes.
- Validate with station staff that each flow matches real operations and a **variable number of shifts** (including a two-shift pilot).
- Verify AWJ APIs, field mappings, active prices, role/branch/station security and ledger posting boundaries **before** connecting prototypes.
- Review against [fuel audit](../audits/FUEL-STATIONS-COMPREHENSIVE-AUDIT.md) and [remediation plan](./FUEL_REMEDIATION_HORIZON.md), including open decisions.
- Test both themes, RTL/LTR, all interaction states and 44pt touch target requirements on actual iPhone.
- No production deployment or change to AWJ's global design tokens implied by this documentation.

## 12. Governance
- This is a separate AWJ Fuel Stations design layer. The existing AWJ ERP design system is unchanged.
- This document is the **design baseline for AWJ Fuel Stations V2**. Actual UI code, token implementation, mocks, motion and components must be checked against these principles.
- Proposals and dimensions remain subject to implementation and usability verification; approval of design direction is **not** approval of accounting behaviors, permissions changes, or deployment.

## 13. Multi-tenant product identity (approved)
- Product name: **محطات أَوْج | AWJ Fuel Stations**. Internal operations experience may be labeled **تشغيل المحطات | Station Operations**.
- Interface belongs to the AWJ product family while retaining a distinct premium industrial visual design from the main AWJ ERP console.
- Tenant station name, logo and any *permitted* brand accent are resolved from tenant/station settings, never hard-coded to a particular operator.
- A safe AWJ-branded fallback appears when a tenant has not supplied a valid station identity.
- All examples drawn from محطة نبراس الطموح are explicitly labeled **pilot fixture only**, never global defaults.
- Do not hard-code the number of shifts, product catalog, fuel prices, pumps, nozzles, tanks, payment methods, station list or locale per tenant; load these from authorized AWJ services.
- Tenant isolation and server-side role/scope checks are mandatory. Tenant branding must never affect the authentication boundary, records, accounting ledger or audit trail.
- Test two distinct tenants with different catalogs/roles/logos and confirm isolation, role-dependent screen content, correct fallback and no cross-tenant cache/data leakage.


## Authoritative data contract — AWJ Fuel Stations only (approved)
The new operator/supervisor workspaces are **presentation and workflow clients** of the existing AWJ Fuel Stations domain. **No second source of truth** may be created for master data, fuel transactions, inventory, or accounting.

- Tenant, branch, fuel stations, products and station-product mapping, effective fuel prices, tanks, pumps, nozzles, meters/readings, physical stock, receipts, shifts, staff, sales, collections and reporting must be read from their authoritative AWJ services/API.
- Employee identity, permissions and station scope come from AWJ authentication/RBAC. Server-side tenant/branch/station/warehouse/asset checks remain required.
- On station selection, fetch only the authorized and associated products, pumps/nozzles and tanks; never ship hard-coded diesel/91/95 catalogs, fixed prices, station identifiers, shift counts or mock balances in production.
- If a record is missing, display an honest unavailable/not-configured state and point permitted admins to the **existing AWJ setup flow**. Do not silently create placeholder master data.
- Any future edit uses the existing AWJ domain API with server authorization rather than storing a parallel copy in this workspace.
- Transactions, meter readings, delivery receipts and approvals must commit through established AWJ commands with idempotency and without double-posting sales, ledger or inventory movements.
- Where needed API coverage is absent, record a specific gap and extend the existing module, not a new duplicate backend.
- Mock data is permitted only in clearly labeled demos/tests, never production screens.
- QA must cover at least two tenants with differing products/assets/roles to prove isolation, configuration propagation and non-leaking caches.

