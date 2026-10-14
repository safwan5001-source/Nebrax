# AWJ-ERP-UX-H1-1 — ERP UI contract and acceptance rubric

STATUS: SPECIFICATION (documentation only)
DATE: 2026-10-14
Horizon: [AWJ-ERP-UX-H1](./AWJ-ERP-UX-H1.md) · Evidence: [H1-0 audit](./AWJ-ERP-UX-H1-0-AUDIT.md)

## 1. What this document is

The ERP horizon does **not** introduce a new design system. Tokens, colour, typography, spacing, density, radius, elevation, focus ring, RTL rules and the accessibility target are already specified in [`design-system/v3/FOUNDATIONS.md`](../../../design-system/v3/FOUNDATIONS.md) (target, behind the `data-awj-ui="3"` gate) and [`DESIGN_SYSTEM.md`](../../../DESIGN_SYSTEM.md) (in force for the legacy path). This file adds only what the H1-0 evidence showed to be missing: **behavioral contracts** for the shared interactive pieces, **state precedence** rules, and the **acceptance rubric** every H1 implementation PR is measured against.

Order of authority is unchanged: code + tests → v3 → DESIGN_SYSTEM.md → this document. Where this document and v3 disagree, v3 wins and the difference is recorded here.

## 2. Behavioral contracts (shared primitives)

### 2.1 Modal dialog (`components/ui/dialog.tsx`) — WAI-ARIA APG *Dialog (Modal)*

| # | Rule |
|---|---|
| D1 | On open, focus moves inside: a control that focused itself (`autoFocus`) keeps it; otherwise the first focusable control of the body; on coarse pointers the dialog container (avoids the virtual keyboard covering the dialog). |
| D2 | Tab / Shift+Tab never leave the open dialog; they wrap at the ends. |
| D3 | Escape closes only the top-most open dialog (nested dialogs close one level at a time). |
| D4 | On close, focus returns to the element that opened the dialog when it still exists. |
| D5 | Page behind does not scroll while a dialog is open. |
| D6 | `role="dialog"`, `aria-modal="true"`, an accessible name (the visible title), a visible close button named in the interface language (`common.close`). |
| D7 | No change to the props or call signature; callers keep their content, actions and request payloads. |

### 2.2 Menus and popovers (`components/ui/dropdown.tsx`) — APG *Menu Button*

| # | Rule |
|---|---|
| M1 | The trigger exposes `aria-haspopup` and `aria-expanded`. |
| M2 | A closed menu is neither focusable nor exposed to assistive technology (`inert`), including custom children such as the notifications panel. |
| M3 | Opening/closing animation may keep the node mounted; M2 still holds. |

### 2.3 Toasts (`components/ui/toast.tsx`)

| # | Rule |
|---|---|
| T1 | The toast region stays inside the viewport at every width ≥ 320 px (inline margin on both sides on phones). |
| T2 | Success/info: `role="status"` (polite). Error: `role="alert"` (assertive). |
| T3 | Auto-dismiss pauses while the toast is hovered or focused; errors stay longer than successes. A toast is never the only place a failed financial action is reported — the form/page keeps its own error. |
| T4 | Dismiss button named in the interface language. |

### 2.4 ERP shell (`app/(app)/layout.tsx`, `components/layout/*`)

| # | Rule |
|---|---|
| S1 | A skip link ("Skip to main content") is the first focusable element; it is visible on focus and moves focus to `main`. |
| S2 | No page-level horizontal scroll caused by the shell at 320 px; topbar actions fit or collapse. |
| S3 | Shell targets ≥ 24×24 px (WCAG 2.5.8); touch targets 44 px where v3 `touch` density applies. |
| S4 | The mobile menu trigger exposes `aria-expanded` and `aria-controls`; the drawer returns focus to it on close (already true). |
| S5 | Unbuilt modules stay listed with the "soon" badge (DESIGN_SYSTEM.md) but are **not links**: no navigation, no prefetch, `aria-disabled="true"`. |

### 2.5 State precedence on data pages

One state at a time, in this order: **loading → forbidden → error → empty → data**.

| State | Contract |
|---|---|
| Forbidden (HTTP 403, including commercial entitlement) | Localized message from the client catalog (not the raw server sentence), no "retry", no empty-state call to action, no create button for the forbidden resource. |
| Error (network/5xx) | Localized message, a retry action, previously loaded data kept when present. |
| Empty | Only when the request succeeded with zero rows; its call to action respects permissions. |

### 2.6 Mixed-direction text

Free-text names that may be Latin inside RTL (or Arabic inside LTR) — party, product, account, warehouse — are isolated (`<bdi>` or `dir="auto"`) in list cells and cards. Numbers, codes and dates keep the existing `.num` LTR isolation.

### 2.7 Visually hidden inputs

A control hidden for a custom picker must not inherit layout classes from the shared `Input` (width/padding/border). Use a plain element with `sr-only` (or the shared component's own escape hatch) so it cannot widen the page; the visible label stays the activation target and keyboard focus remains visible on it.

### 2.8 Money at narrow widths

Layout may wrap, stack or switch to one column; **number formatting never changes for space** (no truncation, no abbreviation that was not already the screen's format, no ellipsis on an amount). An amount and its riyal sign stay together and fully inside their container at 320 px.

Negative amounts keep the minus sign immediately to the left of the digits in both directions (`-10,471.50`, never `10,471.50-`): amounts are LTR-isolated as v3 FOUNDATIONS §12.3 already specifies. Today `.num` sets only the font, so in RTL the sign moves to the right (ERP-UX-027); the fix must isolate inline amounts without changing the `text-start/end` alignment of table cells, and is verified by comparing every rendered amount string before/after.

## 3. Acceptance rubric for every H1 implementation PR

A PR is merge-eligible only when each applicable line is evidenced in its report:

| Area | Required evidence |
|---|---|
| Scope | Affected routes/usages listed; prohibited areas named (accounting, tax, inventory, pricing, RBAC, tenant/branch, API, DB) and untouched. |
| Behavior | Request payloads, endpoints, permissions and tenant/branch scoping unchanged (diff review; network capture when a page action is involved). |
| Unit/component | New or updated Vitest tests for the changed contract; full `npm run test` green. |
| Build | `npm run build` (typecheck) green. |
| Browser | Real-browser check of the changed contract on a production build against the local backend: keyboard sequence, AR + EN, light + dark where the change is visual, 320/390/1440 where layout is involved. |
| Accessibility | axe on affected routes: the targeted rule reaches 0 and no new rule appears; keyboard result stated separately from axe. |
| Visual | Before/after at fixed viewport and data for visible changes. |
| Finance | Money values identical before/after (text compare) on any page whose layout changed. |
| CI | Required checks green on the exact final head; `PRE_MERGE_REVIEW: PASS` with that SHA. |
| After merge | Merge SHA recorded; `main` contains the change; `POST_MERGE_REVIEW: PASS`. |

## 4. Verification matrix used by H1-8

Routes: every crawled ERP route (H1-0 inventory). Widths: 320, 360, 390, 768, 1024, 1280, 1440. Locales: AR-RTL, EN-LTR. Themes: light, dark (v3), light (legacy). UI modes: v3 gate on and legacy. Roles: owner plus at least one restricted role. Explicitly recorded as not performed when not run: real screen readers, Firefox/WebKit, physical devices, OS text scaling.

## 5. External Evidence / AWJ Decision / Rejected

- **External Evidence:** WAI-ARIA APG Dialog (Modal) and Menu Button patterns; WCAG 2.2 SC 1.4.10, 2.4.1, 2.4.3, 2.5.8, 4.1.2; SAP UI5 `sap.m.Table` pop-in at phone width (visually inspected, H1-0 §7).
- **AWJ Decision:** contracts D1–D7, M1–M3, T1–T4, S1–S5 and §2.5–2.8 above; applied by fixing the shared primitive once rather than per page.
- **Rejected / Not Adopted:** a bottom tab bar for global navigation on phones (v3 reserves the bottom area for page actions/totals); swapping the custom dialog for a third-party one in this horizon (larger change surface than the defect); hiding unbuilt modules entirely (DESIGN_SYSTEM.md keeps them visible with "soon").
