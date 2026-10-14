# INT-UX-5d — Implementation Report

STATUS: **Draft PR open for review.** Not merged. Not deployed.
DATE: 2026-10-14
TASK: INT-UX-5d — reassign the responsible operator of an AWJ-signed ingress point, from the existing ingress panel on the delivery-platform detail page, using the existing backend only.
HORIZON: Integrations Center — INT-UX-5 (slice d of a → b → c → d, each its own PR and approval)
APPROVAL: DP-C option 3 for INT-UX-5 only (manage AWJ-signed ingress — never a native provider integration); D1–D10 of `INT-UX-5-SCOPE-AND-READINESS-REPORT.md`.
NOT STARTED: INT-UX-6 (audit reader), INT-MAP-1, native provider connect/sync, Backend idempotency for create.

## 1. Gate before code

`main` @ `c88401d21a9f81d48220f8cdec03678537f10e79` (INT-UX-5c merge, verified). The reassign contract was read from the code, not assumed:

- `POST /delivery-connectors/{id}/reassign` — gates `delivery_connector.reassign` + `sales.pos` capability. Body: `user_id` (uuid) only. Response `{data}` (the account resource; never a secret).
- `DeliveryConnectorAccountService::reassign`:
  - the account must be visible to the actor, else `404 connector_unavailable`;
  - the actor must be active, and the target must exist in the same tenant, be active and be able to operate the point, else `422 operator_ineligible`. Eligibility: an **unrouted** point needs a target with **no branch restriction**; a **branch-routed** point needs the branch active and a target who can access it;
  - a request for the **operator who already holds the point** is a **no-op** (200, no change, no audit event);
  - otherwise it updates `operated_by` and appends a `delivery_connector_operator_events` row (INT-AUDIT-1, same transaction) — so every reassignment is audited server-side whatever the caller;
  - it never touches the branch, platform profile, store ID, status or secret. It does **not** check the point's status (the server would reassign a disabled point; see §6).
- Operator list: `GET /users` (`users.view`) returns every tenant user with `id`, `name`, `email`, `role`, `is_active`, `branch_ids` (empty = unrestricted). The browser receives the email field from the server; the UI reader drops it (see §2).
- **Idempotency per the actual contract:** reassigning to the current operator is a server no-op, so repeating the *same* request is safe. The UI still never repeats it automatically.

**No backend, API, database migration, permission, accounting, POS or ZATCA change. No decision requiring a backend change or an attempt-retention policy arose, so nothing was assumed or asked.**

## 2. What was done

### Who sees it (D3)
- The action and the operator column exist only when the server-computed permission list holds **both** `delivery_connector.reassign` **and** `users.view`, and never in demo mode. Absent — not disabled — otherwise. `/users` is not even requested without both permissions.
- Offered on **configured** points only (a UI policy; see §6). A disabled point shows its operator but no action.
- Hiding is presentation only; the server stays the authority (403/404/422 are handled).

### Operator identity (D2: name only)
- `lib/ingress-operators.ts` is a pure **allow-list reader** for `/users`: `id`, `name`, `is_active`, `branch_ids` only. Email, role, employee link and every other field never enter state, DOM, request or notice. Malformed or duplicate rows are skipped; a non-list payload is a read failure.
- The current operator (`operated_by` of each point) enters UI state only for holders of both permissions, and is rendered **as a name** (`Unknown` if the user is not in the directory) — never as an id.
- **Same-name candidates are excluded, never numbered** (review follow-up, see §9): if two or more *eligible* operators share a name, **all of them** are removed from the choice list and a warning (AR/EN) says they cannot be told apart safely here and to go back to an administrator. Candidates with unique names stay selectable. No order suffix, email, id or any other detail is used to tell people apart.

### The dialog
- Neutral `ConfirmDialog` (not danger) with: the store ID, the **current operator** (name or "Unknown"), a select of **eligible operators with unique names only** (active, not the current operator, branch scope compatible — a client-side mirror of the server rule, used only to narrow the choices — and not excluded for a name collision), and a summary "from X to Y". Copy states that the branch, status, store ID and secret do not change, and that the previous operator may still hold the secret and should be rotated separately.
- Confirm is disabled until a valid candidate is chosen; the hook re-checks that the id is among the selectable candidates (eligible **and** not excluded for a name collision) of a **ready** directory, so the guard does not depend on the dialog.
- Directory states are explicit: loading; **read failure ≠ "no operators"** (message plus a read-only retry); empty (no eligible operator). Missing branch scope for a user ⇒ not eligible (fail closed).

### Sending
- One `POST` to the existing route with exactly `{ user_id }`. Ids are validated client-side (plain identifiers; the server is final). A `useRef` lock is raised before the first `await`, so a double click sends one request; while it runs the select and both buttons are inert and the dialog cannot be closed (Escape, backdrop, cancel; the X is hidden).
- Success → dialog closes, notice with the **new operator's name** (no email/id), and the list is re-read; the displayed operator comes from the server response to that re-read, not from local assumption.
- **Failures** (fixed AR/EN dictionary; raw server text never shown):
  - `403` / `404` / `connector_unavailable` → dialog closes, notice, list re-read.
  - `422 operator_ineligible` → dialog stays with the message, and the operator directory is re-read (eligibility changed).
  - other `422` → generic validation message; `409` → conflict message (dialog stays, one request).
  - **Unknown outcome** (network loss, 5xx, an unreadable 2xx): one request, **no retry control, no automatic repeat**; dialog closes, a neutral notice says to check the operator shown, and the list is re-read.
- Nothing is written to browser storage, console, URL or analytics.

## 3. Changed files

| File | Change |
|---|---|
| `web/src/lib/ingress-operators.ts` | **new** — pure allow-list reader for `/users`, name lookup, eligibility mirror, duplicate-name labels |
| `web/src/lib/ingress-operations.ts` | `reassignIngressOperator(id, userId)` — the only caller of the reassign route |
| `web/src/lib/signed-ingress.ts` | `operatedBy` read only on request (`{ operators: true }`); never rendered raw |
| `web/src/lib/ingress-management.ts` | new dictionary key `reassignOutcomeUnknown` |
| `web/src/components/integrations/use-signed-ingress.ts` | `useOperatorDirectory` (both permissions, not demo, cancel-safe) |
| `web/src/components/integrations/use-ingress-management.ts` | reassign state machine: lock, eligibility guard, outcome mapping, re-read |
| `web/src/components/integrations/ingress-reassign-dialog.tsx` | **new** — dialog |
| `web/src/components/integrations/ingress-row-actions.tsx`, `ingress-management-layer.tsx`, `signed-ingress-panel.tsx`, `delivery-platform-detail-screen.tsx` | wiring: row button, notice, operator column/row, directory read |
| `web/src/messages/ar.json`, `en.json` | actions, dialog, notice, errors, notes |
| Tests | `ingress-reassign.test.tsx` (36), `ingress-operators.test.ts` (15), additions to `ingress-operations.test.ts` and `use-ingress-management.test.tsx`; guard `no-connection-controls.test.ts`, `signed-ingress-panel.test.tsx`, `ingress-management.test.tsx` updated |
| `web/e2e/int-ux-5d-reassign-operator.spec.ts` | **new** real-browser spec; `int-ux-4-signed-ingress.spec.ts`, `int-ux-5b-rotate-disable.spec.ts` updated (the owner now legitimately sees reassign) |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | slice header status |

## 4. Tests and results (local)

**Important distinction.** Every browser and component test here **intercepts the API** with a stateful mock. They prove the UI's behaviour against the contract read from the code; **none was run against a real backend.**

- **Related Vitest first** (`src/components/integrations`, `src/lib`): 102 files / 1043 tests ✅ (1066 after the §9 follow-up).
- **Full Vitest:** 596 files / **6570 tests** ✅.
- **`npm run build`:** ✅ compiled successfully (exit 0).
- **Behaviour covered (Vitest):** permission matrix (owner; reassign + users.view; reassign alone; users.view alone; manage alone; viewer; demo) — actions absent and `/users` never requested without both; only configured points; names only (no email/id/employee id in DOM, requests or notice); eligible list (active, not current, unrouted ⇒ unrestricted only, routed ⇒ unrestricted or branch-including, unknown scope ⇒ none, same-name candidates excluded with a warning); confirm blocked without a valid choice; request body exactly `{ user_id }` on the existing route; success notice with the new name, list re-read, secret/branch/status/store ID unchanged in the mock backend; invalid and out-of-list ids never sent (path-like, empty, unknown, inactive, current, out-of-scope); 403/404/409/422 (known and unknown code) and network/502/unreadable success; one request in every failure; no retry control; no raw server text; busy locks (double click and same-tick double confirm = one request; no close/edit while busy); directory loading / read failure with retry / empty; no storage writes or operator data in the console; AR + EN.
- **Mutation checks** (each made tests fail, then reverted): remove the request lock (caught by the hook test; the screen test alone did **not** catch it, which is why the same-tick hook test exists); unrouted point admits restricted users; current operator not excluded; confirm enabled without a selection; `users.view` not required.
- **Structural guard** (`no-connection-controls.test.ts`): only `lib/ingress-operations.ts` calls the four POST routes (exactly four), the reassign body is exactly `{ user_id }`, the operator reader keeps an allow-list and no component reads `.email`, `/users` is read only from the signed-ingress hook, and the only buttons in the module remain the declared ones.
- **Playwright (real Chromium, real clicks and keys; API intercepted):** first full run of `int-ux-5d` + 5c + 5b + 5a + INT-UX-4 on desktop and mobile: **164 passed, 14 failed**. All 14 were corrected expectations, none a product defect: INT-UX-4 and one 5b test asserted the pre-5d button set (the owner / a reassign + users.view user now legitimately sees *Reassign*); and two defects in my own new spec (a strict-mode locator matching the disabled row's operator cell as well, and an Arabic name hard-coded in the English runs). No assertion was weakened and no real click was replaced. Re-run of the affected tests: **46 / 46 passed**; row screenshot run: 8 / 8. Together with the first run's 164 passes, every test in the five specs has passed on its final code.
- **Environment note.** An orphan dev server on port 3001 from an interrupted earlier run made one Playwright run hang with no output. It was identified (port and process list), stopped, and every later run used a single Playwright-managed server with no parallel runs.

## 5. Visual verification

Screenshots reviewed for the panel, the action row, the dialog (empty and selected), the 422 state, the done notice and the unknown-outcome notice — AR/EN × light/dark × desktop (1440) / mobile (390). Findings: RTL/LTR correct; names render correctly in both scripts; the store ID stays LTR; the select, summary and error read clearly in dark mode; on mobile the dialog fits 390 px and the three row actions wrap without clipping; on desktop the three actions wrap onto a second line in the actions cell (no clipping, no page overflow). The red "N Issues" chip is the Next dev-server indicator, not product UI. No reference-product research was needed: the pattern is the already-approved AWJ confirm dialog.

## 6. Risks, decisions and what remains

- **Real server not exercised** (see §4). The first real end-to-end proof is the owner's review or staging.
- **Configured-only is a UI policy.** The server would also reassign a disabled point. Hiding it is a conservative choice; if the owner wants reassignment of disabled points (e.g. to clean up ownership), it is a one-line change. *Decision for the owner.*
- **Client-side eligibility is convenience, not authority.** It mirrors the server rule to narrow the list; the server's `422 operator_ineligible` is final and is handled (the dialog stays and the directory refreshes). It cannot see the branch's active state (server-only).
- **`GET /users` sends every tenant user, including email, to the browser** of a holder of `users.view`. The UI never keeps or renders email, but the data does cross the wire (it already does for the existing users screen). A narrower backend operators endpoint would remove that; it is a backend change and was **not** made.
- **Users list scope.** `GET /users` is not branch-scoped for the actor. Only eligible names are rendered, so out-of-scope users are not listed as choices, but the current operator's name is shown even if that user is outside the actor's branches (it is already the point's operator).
- **Same-name operators cannot be chosen from this screen** (mitigates the wrong-person risk; see §9). The limitation that remains: someone who legitimately needs to be assigned and shares a name with another eligible user (or with the point's current operator) must be handled by an administrator who can tell the accounts apart — this slice offers no safe, non-email way to do it in the UI.
- **Unknown outcome is reconciled by the user** reading the refreshed operator; no automatic reconciliation (would need an event reader — INT-UX-6).
- **The previous operator may still hold the secret.** The dialog and the notice say so and point to *Rotate secret*; reassignment does not rotate it.
- **Pre-existing, unrelated:** the dev-server message about message keys containing a dot (`appBuilder…signalOption`, `developer.events`) exists on `main`; the INT-UX-1 mobile flake mentioned in the 5b report was not observed in the runs here.
- **Remaining in INT-UX-5:** none. INT-UX-6 (audit reader, needs the DP-E read-permission decision), INT-MAP-1 and Backend idempotency for create are not started.

## 9. Review follow-up — wrong-operator risk on identical names

**Risk addressed.** The first version told same-named candidates apart with an order suffix (`Sam (1)`, `Sam (2)`). The order is not an identity: it is unrelated to who the person is, can change when the list refreshes, and invites assigning the wrong person to an ingress point. It is removed.

**Behaviour now.**
- Among the **eligible** candidates (active, scope-compatible, not the current operator), any two or more whose names match are **all excluded** from the select, and a note lists the affected name(s) once: they cannot be told apart safely here; ask an administrator. Unique names next to them stay selectable.
- "Same name" is deliberately conservative (`nameKey`): Unicode-normalised, case-folded, whitespace-collapsed, with combining marks (Arabic tashkeel, Latin accents) and tatweel removed — so `Sam` / `sam ` / `Sám` and `محمد` / `مُحَمَّد` collide. The accepted error is over-exclusion, never mixing up two people.
- **One decision beyond the literal request (flagged for the owner):** the point's **current operator's** name is counted too, so a candidate sharing it is excluded. Otherwise the summary could read "from Sam to Sam". The current operator is never a candidate itself. If you prefer the strict reading (compare only eligible candidates among themselves), it is a one-line change in `operatorChoices`.
- Only eligible candidates are compared: an inactive or out-of-scope namesake does not exclude an eligible user (they are not in the list anyway).
- If *every* eligible candidate is ambiguous, there is no select, the note explains why (instead of the misleading "no eligible operator" text), and confirm stays disabled.
- **Enforced in the hook, not only the UI.** `confirmReassign` accepts an id only if it is among the selectable candidates of a ready directory, so a direct call with an excluded id (or an inactive, out-of-scope, current, unknown or path-like id) sends nothing.
- No email, internal id or any other data is shown or kept to tell people apart; the note carries names only. No backend, API, permission or server-side eligibility change.

**Tests added/changed.** `lib/ingress-operators.test.ts` (`nameKey`, `operatorChoices`: two same names excluded together; unique name beside a colliding pair stays; distinct names unchanged; current-operator namesake; only eligible compared; no ids in the output) · `use-ingress-management.test.tsx` (direct `confirmReassign` with each excluded id sends nothing; the unique name still sends; distinct names unchanged) · `ingress-reassign.test.tsx` (AR + EN: warning text, no numbering, no email/id in the DOM, unique name sends; all-ambiguous state; no regression with distinct names; current-operator namesake) · `int-ux-5d-reassign-operator.spec.ts` (real browser, AR/EN × light/dark × desktop/mobile). Mutation checks (each made tests fail, then reverted): hook guard lets excluded ids through; no exclusion at all; current operator's name not counted.

**Remaining limits.** Same as §6: the UI cannot offer a safe distinguishing attribute without exposing email or ids, so those users are simply not selectable here; the real backend was not exercised.

## 7. Git state

Branch `feat/int-ux-5d-reassign-operator` · Base SHA `c88401d21a9f81d48220f8cdec03678537f10e79` · Draft PR: see the PR (number and final Head SHA are recorded in the PR description; a report cannot name its own SHA).

## 8. Next step

Owner review of the Draft PR. No merge, no deploy, and INT-UX-6 / Backend idempotency are not started.
