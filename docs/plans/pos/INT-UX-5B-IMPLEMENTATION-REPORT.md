# INT-UX-5b — Implementation Report

STATUS: **Draft PR open for review.** Not merged. Not deployed.
DATE: 2026-10-14
TASK: INT-UX-5b — rotate the secret and disable an AWJ-signed ingress point, from the existing ingress panel on the delivery-platform detail page.
HORIZON: Integrations Center — INT-UX-5 (slice b of a → b → c → d, each its own PR and approval)
APPROVAL: DP-C option 3 for INT-UX-5 only (manage AWJ-signed ingress — never a native provider integration); D1–D10 of `INT-UX-5-SCOPE-AND-READINESS-REPORT.md`.
NOT STARTED: INT-UX-5c (create), INT-UX-5d (reassign), INT-UX-6 (audit reader), INT-MAP-1, native provider connect/sync.

## 1. Gate before code

`main` @ `13ba94b56b34f4aacc81da6c49963701a9747124` (INT-UX-5a merge, verified). The existing contracts were read, not assumed:

- `POST /delivery-connectors/{id}/rotate-secret` → 200 `{data, secret}`; the old secret stops at once; the server would also rotate a disabled point (the UI does not offer it).
- `POST /delivery-connectors/{id}/disable` → 200 `{data}`; irreversible, idempotent, original `disabled_at` kept.
- Both: `delivery_connector.manage` + `sales.pos` capability; errors through the fixed `error_code`/status set already mapped by the 5a dictionary.
- INT-AUDIT-1 (merged) writes the lifecycle event inside the same transaction, so both actions are audited server-side whatever the caller.

**No backend, API, database, permission, accounting, POS or ZATCA change.**

## 2. What was done

### Rotate secret
- Action **absent** (not disabled) unless the server-computed permission list holds `delivery_connector.manage` **and** the point is `configured`; never for a disabled point; never in demo mode.
- `ConfirmDialog` states that the current secret stops working immediately and that the new one is shown once. Cancel sends nothing.
- One `POST` to the existing route. A `useRef` lock is raised before the first `await`, so a double click sends one request; while it runs the dialog cannot be closed (Escape, backdrop, cancel, and the X is hidden) and both buttons are inert.
- Success → `SecretRevealDialog` with **`requireConfirmToClose`**: masked by default, no close before "I have saved the secret". The secret lives in one React state value until the dialog closes, then is `null`; it is never written to storage, logged, tracked or put in a URL. After closing a notice names the point (never the secret) and the list is re-read.
- **Unknown outcome** (network loss, 5xx, or a 2xx whose secret cannot be read): one request only, no automatic repeat, **no retry button**. The notice says the result did not arrive, the list is re-read at once, and the user rotates again deliberately only if the point shows and the secret was not saved.

### Disable ingress point
- Same visibility rule as rotate.
- Dialog warns it **cannot be undone from this interface**, and requires the **store ID typed literally** (case-sensitive, no trimming) before the confirm button is enabled. The hook re-checks the typed value, so the guard does not depend on the dialog.
- One `POST`, same lock and same no-close-while-busy rules. Success → notice + list re-read (the point shows *Disabled* and loses its actions). **No re-enable action exists.**
- **Unknown outcome:** the list is re-read first; while it loads the panel is in its loading state, so no action is offered until the real status arrives. The notice does not say "you can try again".

### Error handling
403 / 404 / 409 / 422, known `error_code`s, network and 5xx all map to the fixed AR/EN dictionary from 5a (plus `disableOutcomeUnknown`, `demoUnavailable`). **Raw server text is never shown.** 404/409/unknown outcomes re-read the list.

### Shared dialog review (owner's note on the screenshots)
The top **X** of the secret dialog used to be visible yet inert while the lock was on. It is now **hidden** until the save is confirmed (and while a confirm dialog is busy). This needed one optional prop, `hideClose` (default `false`), on `ui/Dialog` and `ConfirmDialog`; every other caller, including the developer screens, behaves exactly as before (tests assert the X is always there without the lock).

## 3. Changed files

| File | Change |
|---|---|
| `web/src/lib/ingress-operations.ts` | **new** — the only code that calls the rotate/disable routes and the only place that reads the secret from the response; no storage/log/URL |
| `web/src/components/integrations/use-ingress-management.ts` | **new** — state machine: dialog, lock, reveal, notice, re-read |
| `web/src/components/integrations/ingress-management-layer.tsx` | **new** — confirm / typed-confirm / reveal dialogs + notice |
| `web/src/components/integrations/ingress-row-actions.tsx` | **new** — the two row buttons (uses the 5a permission hook) |
| `web/src/components/shared/typed-confirmation-field.tsx` | **new** — neutral "type the value to confirm" field |
| `web/src/components/integrations/signed-ingress-panel.tsx`, `delivery-platform-detail.tsx`, `delivery-platform-detail-screen.tsx` | optional `management` prop wired through; without it the panel is read-only as before |
| `web/src/components/shared/confirm-dialog.tsx`, `secret-reveal-dialog.tsx`, `web/src/components/ui/dialog.tsx` | optional `children`/`confirmDisabled`/`hideClose` (defaults = old behavior) |
| `web/src/lib/ingress-management.ts` | two new dictionary keys |
| `web/src/messages/ar.json`, `en.json` | actions, dialogs, notices, errors, notes (the old "this panel is read-only" line is now conditional) |
| Tests | `ingress-management.test.tsx` (45), `use-ingress-management.test.tsx`, `ingress-operations.test.ts`, `typed-confirmation-field.test.tsx`, extended `confirm-dialog`/`secret-reveal-dialog`/`signed-ingress-panel`/`ingress-management` tests, structural guard rewritten for 5b |
| `web/e2e/int-ux-5b-rotate-disable.spec.ts` | **new** real-browser spec (real clicks and keys, no `dispatchEvent`) |
| `web/e2e/int-ux-4-signed-ingress.spec.ts`, `int-ux-5a-neutral-dialogs.spec.ts` | updated: the owner now sees rotate/disable; the "no action" assertion moved to a viewer without manage |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | slice header status |

## 4. Tests and results (local)

- **Related first:** `src/components/integrations`, `shared`, `developer`, `src/lib` → 104 files / 873 tests ✅ (before the last additions); after them the integrations folder: 9 files / 237 tests ✅.
- **Full Vitest:** 581 files / **6230 tests** ✅.
- **`npm run build`** ✅.
- **Behavior covered (Vitest):** permission matrix (owner; manage only; reassign-only; viewer; demo) — actions absent, never disabled; confirm-then-send; cancel sends nothing; **double submit = one request** (both actions); **no close while busy**; one-time secret: masked, locked, cleared on close, absent from DOM/localStorage/sessionStorage/console/URL afterwards; **unknown outcome** (network, 502, unreadable success ×4): one request, no retry control, list re-read, no reveal; disable: store-ID literal match (six wrong variants), re-read before any new action; 403/404/409/422 map to dictionary text and raw server text never appears; no create/reassign/re-enable control; AR + EN.
- **Mutation checks (each made tests fail, then reverted):** remove the request lock; remove the typed-ID guard in the hook; remove `requireConfirmToClose`; offer rotate on a disabled point; remove `confirmDisabled` on the dialog.
- **Structural guard:** the only code that touches the rotate/disable routes is `lib/ingress-operations.ts`; only the management hook calls it; it has exactly two POST routes, no create/reassign, and no storage/console/analytics/location access; the only buttons allowed in the integrations module are retry, the two row actions and notice dismissal.
- **Playwright (real Chromium, real clicks/keys):** `int-ux-5b-rotate-disable` + `int-ux-5a-neutral-dialogs` + `int-ux-4-signed-ingress`, desktop and mobile projects → **92 / 92 passed** (AR/EN × light/dark; the 5b spec covers rotate, locked secret, disable with typed ID, lost rotate response, raw-server-text absence, and read-only viewers).

## 5. Visual verification

Screenshots reviewed for the panel, rotate confirm, locked secret (masked and revealed), done notice, disable confirm and done, and the unknown-outcome notice — AR/EN × light/dark × desktop (1440) / mobile (390). Findings: RTL/LTR correct, the store ID and secret stay LTR inside RTL, buttons have ≥44 px height on touch, no horizontal overflow, dark-mode warning and notice readable, no X in the locked secret dialog. One defect found and fixed during review: the dialog title (`New secret for ingress point KTA-RIYADH…`) was truncated on mobile, so the title is now short and the store ID is in the description (wrapped in bidi isolates). The red "N Issues" chip is the Next dev-server indicator, not product UI. No reference-product research was needed: the pattern is the already-approved AWJ confirm/reveal pair.

## 6. Risks and what remains

- **Real server not exercised.** Browser and component tests intercept the API; the contracts were read from the controller and the merged 5a/AUDIT-1 reports. The first real end-to-end proof is the owner's review or staging.
- **The server still allows rotating a disabled point** (D5: backend permissiveness is a separate matter, not changed here). The UI never offers it.
- **A disabled point cannot be re-enabled** from anywhere (by design; GAP-4 stays open).
- **Unknown-outcome wording is conservative.** The user must read the refreshed list; there is no automatic reconciliation (would need a backend read of the event, INT-UX-6 scope).
- **`hideClose`** is a small additive change to the shared `Dialog`; defaults preserve every existing screen.
- **Pre-existing, unrelated:** the INT-UX-1 mobile flake `summary error keeps the card usable` and TypeScript errors in unrelated test files (`tsc` reports none in files touched here).
- **Remaining in INT-UX-5:** 5c create, 5d reassign. INT-UX-6 (audit reader, needs the DP-E read-permission decision) and INT-MAP-1 are not started.

## 7. Git state

Branch `feat/int-ux-5b-rotate-disable` · PR: see below · Base SHA `13ba94b56b34f4aacc81da6c49963701a9747124` · Head SHA: see the PR (this report is the last commit).

## 8. Next step

Owner review of the Draft PR. After approval, INT-UX-5c (create) as a separate assignment. No merge, no deploy.
