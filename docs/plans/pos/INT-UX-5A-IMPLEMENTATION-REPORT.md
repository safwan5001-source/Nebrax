# INT-UX-5a — Implementation Report

STATUS: **Draft PR open for review.** Not merged. Not deployed.
DATE: 2026-10-14
TASK: INT-UX-5a — neutral shared dialogs + management foundations. **No management action is enabled.**
HORIZON: Integrations Center — INT-UX-5 (slice a of a → b → c → d, each its own PR and approval)
APPROVAL: DP-C option 3 for INT-UX-5 only (AWJ-signed ingress, never a native provider integration); D1–D10 of `INT-UX-5-SCOPE-AND-READINESS-REPORT.md` adopted (recorded in `DLV-INTEGRATIONS-UX-DESIGN-1.md` under DP-C).
NOT STARTED: INT-UX-5b / 5c / 5d, INT-UX-6, INT-MAP-1.

## 1. Gate before code

`main` @ `7d9ddb1f944b5abcac329a1b6ab1e4e25cc4a1dd` (verified; unchanged since the scope report). PR #1446 (the scope report) was still open and unmerged; Horizon on `main` still carried the INT-UX-5 header "only if DP-C option 3 is approved", so the decision record is part of this PR. No backend, API, database or permission change was needed or made.

## 2. What was done

1. **Neutral dialogs** (`web/src/components/shared/`):
   - `confirm-dialog.tsx` — no translation namespace; every string (title, message, confirm/cancel/busy labels) is a prop. Same markup and behavior as before (danger tone only when asked, both buttons inert while busy, technical detail rendered `ltr`).
   - `secret-reveal-dialog.tsx` — takes a `labels` object instead of a namespace. Same guarantees (masked by default, explicit "saved" confirmation before the done button works, state reset on close, never written to storage or logged). New **opt-in** `requireConfirmToClose` (default `false` = the old behavior, byte-for-byte): when on, Escape, backdrop click and the top close button do nothing before the confirmation and a hint appears. Not enabled anywhere yet; 5b will enable it for the ingress secret.
2. **Backward compatibility:** `components/developer/confirm-dialog.tsx` and `components/developer/secret-reveal.tsx` are now thin wrappers with the **same path, name, props and `developer.*` translations**. Their callers (API keys, Webhooks, App Builder) are untouched. The wrappers cannot opt into the lock, so the developer screens behave exactly as before.
3. **Foundations (no network, nothing wired to a screen):**
   - `web/src/lib/ingress-management.ts`: action availability on **existing permissions only** (manage = create/rotate/disable; reassign needs `delivery_connector.reassign` **and** `users.view`; rotate/disable absent for a disabled point; an unavailable action is absent, never disabled) and a **safe error dictionary** keyed by `error_code`/status — it never carries server text; it separates *definite failure* from *outcome unknown* (network or 5xx): **no blind retry for create and rotate** (the secret may already exist and be lost), retry allowed for the idempotent disable and reassign.
   - `web/src/components/integrations/use-ingress-permissions.ts`: permission skeleton hook, no request.
   - AR/EN messages `integrationCenter.ingressManagement.errors.*` (16 entries; the unknown-outcome text tells the user to refresh, rotate if the secret was not saved, and not to repeat the request).
4. **Structural guard** (`no-connection-controls.test.ts`) extended minimally: both new files are scanned; they must contain no `api(`/`fetch`/management routes, and no display component may import them yet.
5. **Decisions** recorded in Horizon (DP-C option 3 for this slice only, the controls above, D1–D10) without changing the slice's scope.

## 3. Changed files

| File | Change |
|---|---|
| `web/src/components/shared/confirm-dialog.tsx`, `secret-reveal-dialog.tsx` | **new** neutral components |
| `web/src/components/developer/confirm-dialog.tsx`, `secret-reveal.tsx` | now thin wrappers (same API) |
| `web/src/lib/ingress-management.ts` | **new** availability rules + error dictionary |
| `web/src/components/integrations/use-ingress-permissions.ts` | **new** permission hook skeleton |
| `web/src/messages/ar.json`, `en.json` | `integrationCenter.ingressManagement.errors` |
| `web/src/components/integrations/no-connection-controls.test.ts` | narrow guard extension |
| `web/src/components/shared/__tests__/*` (2), `web/src/components/developer/__tests__/neutral-wrappers.test.tsx`, `web/src/lib/ingress-management.test.ts`, `web/src/components/integrations/use-ingress-permissions.test.tsx` | **new** tests |
| `web/e2e/int-ux-5a-neutral-dialogs.spec.ts` | **new** real-browser spec |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | DP-C option 3 / D1–D10 record |
| `docs/plans/pos/INT-UX-5A-IMPLEMENTATION-REPORT.md` | this report |

No backend, API, migration, RBAC, financial, POS or ZATCA file changed. No visible UI action was added.

## 4. Tests and results

| Area | Evidence |
|---|---|
| Neutral `ConfirmDialog` | shows only given labels in AR/EN; handlers; danger tone; busy state inert; `ltr` detail |
| Neutral `SecretRevealDialog` | masked default; secret absent from the DOM until revealed; never in `localStorage`/`sessionStorage`, the console, any attribute or the page title (sentinel secret); exact copy; confirmation gate; state reset between secrets; renders nothing (and no secret) when closed |
| `requireConfirmToClose` | default unchanged (Escape/top close dismiss at once); when on: Escape, backdrop and top close do nothing before confirmation and the hint shows; after confirmation Escape and the done button close |
| Backward compatibility | developer wrappers render `developer.secret`/`developer.common` text in AR and EN, keep the default dismissal, cannot opt into the lock; the existing developer tests (`secret-reveal.test`, `keys-workspace.test`, `i18n-render.test`) pass **unchanged** |
| Permissions | wildcard; server list over role name; role fallback only when the list is absent; accountant/staff/self_service get nothing; manage ≠ reassign; reassign needs both permissions; rotate/disable absent for disabled; no request ever made |
| Error handling | every known code → its own key and a definite outcome; lost response on create/rotate → `outcome unknown`, **never retryable**; disable/reassign → retryable; unknown `error_code` strings never become messages; no server/exception text or secret in any result; dictionary complete in AR and EN; forbidden-phrase scan |
| Structural | foundations have no network or management routes and are imported by no component |
| Mutation check | breaking the lock condition fails the lock test (then restored) |

Results (local):
- Related Vitest (shared, developer, integrations, lib): 17 files / 251 tests passed.
- **Full Vitest: 574 files / 6130 tests passed.**
- `npm run build`: succeeded.
- Playwright `int-ux-5a-neutral-dialogs.spec.ts`: 10 tests; with `int-ux-4-signed-ingress.spec.ts` (48): **58/58 passed.** The 5a spec drives the real Webhooks screen (confirm → one-time secret) in AR RTL / EN LTR × light / dark × desktop 1440 / mobile 390 with a mocked API (sentinel secret; it never reaches the DOM before reveal, storage, or after close), and asserts the integration page still has no management action and issues no write. One selector note: the dropdown item is activated with `dispatchEvent('click')` because Playwright's stability wait never settles in dev mode on that menu — a test-harness detail, not product behavior.
- INT-UX-1/2 Playwright specs were **not re-run**: 5a does not touch those pages (their Vitest suites passed in the full run).

## 5. Build and CI (observed)

Code head `530411e7189bd679927ebfbb92713d8241056b76`, read from the check runs after completion:

| Check | Result |
|---|---|
| `web build (Next.js)` (two runs) | success |
| `php artisan test (L11, sqlite)` | success |
| `php artisan test (L11, pgsql)` | success |
| `CI Gate` | success |

Codex review threads: none. CI on the report commit that follows this observation is reported in the PR and the final message (a document cannot embed the result of the run it triggers).

## 6. Visual verification

Screenshots reviewed (confirm dialog, masked and revealed secret; AR/EN × light/dark × desktop/mobile): same layout and tokens as before, secret and URLs in `ltr` inside RTL, warning block readable in dark, no overflow on 390 px. A red "N Issues" chip in the screenshots is the Next.js dev-server indicator, not product UI. No reference-product research was needed: 5a changes no visible surface.

## 7. Risks and remaining work

- **Top close (X) button.** The shared `Dialog` always shows it. With the lock on it does not close before confirmation but shows the hint; hiding it would require changing `Dialog` (out of 5a). Decide in 5b whether that is acceptable.
- **Dead code by design.** The foundations are tested but unused until 5b/5c/5d; the structural guard prevents accidental use before then.
- **Dialog contract.** The neutral components take mandatory label props; any future caller must pass them (type-checked).
- **Demo mode and the audit reader** are untouched (D10 is for 5b+; the reader belongs to INT-UX-6).
- Remaining slices, each its own PR and approval: **5b** rotate + disable (confirm with typed store ID, one-time reveal with the lock on, permission/POS gating); **5c** create (branch/store form, missing-profile guidance, outcome-unknown handling); **5d** reassign (operator name only, both permissions).

## 8. Git state

- Branch: `feat/int-ux-5a-neutral-dialogs` · Draft PR: #1448
- Base: `main` @ `7d9ddb1f944b5abcac329a1b6ab1e4e25cc4a1dd`
- Code head: `530411e7189bd679927ebfbb92713d8241056b76` (the report commit follows it; the final head SHA is in the PR and the final message).

## 9. Next step

Owner review of Draft PR #1448. After approval, INT-UX-5b as a separate assignment. INT-UX-6 and INT-MAP-1 are not started.
