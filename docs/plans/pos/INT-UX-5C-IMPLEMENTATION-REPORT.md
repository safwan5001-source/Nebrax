# INT-UX-5c — Implementation Report

STATUS: **Draft PR open for review.** Not merged. Not deployed.
DATE: 2026-10-14
TASK: INT-UX-5c — create an AWJ-signed ingress point from the delivery-platform detail page, using the existing backend.
HORIZON: Integrations Center — INT-UX-5 (slice c of a → b → c → d, each its own PR and approval)
APPROVAL: DP-C option 3 for INT-UX-5 only (manage AWJ-signed ingress — never a native provider integration); D1–D10 of the INT-UX-5 scope report.
NOT STARTED: INT-UX-5d (reassign operator), INT-UX-6 (audit reader), INT-MAP-1, native provider connect/sync.

## 1. Gate before code

`main` @ `c47fd408200bdfbbb845d6d252d7d93a1fa29392` (INT-UX-5b merge, verified). The create contract was read from the code, not assumed:

- `POST /delivery-connectors` — gates `delivery_connector.manage` + `sales.pos`. Body (`StoreDeliveryConnectorAccountRequest`): `delivery_platform_profile_id` (uuid, required), `external_store_id` (string, required, max 191), `branch_id` (uuid, nullable). Tenant comes from the session. → `201 {data, secret}`; the secret is returned **only here and on rotate**.
- Service rules (`DeliveryConnectorAccountService::create`): the profile must exist, belong to the tenant **and be active** (else `404 profile_unavailable`); the store ID is trimmed and measured with `strlen` (**bytes**, ≤ 191; else `422 invalid_store`); a branch must be visible to the actor (`404 branch_unavailable`) and active (`422 branch_inactive`); an actor who is restricted to branches **must** send one (`422 branch_required`), an unrestricted actor may send none; `(platform_key, external_store_id)` is unique (`409 mapping_ambiguous`). The lifecycle audit event is written in the same transaction (INT-AUDIT-1).
- Create is **not idempotent**: a repeated request after a lost response returns 409 and never the secret again.
- The profile id comes from the existing `GET /delivery-platforms` (`id`, `platform_key`, `is_active`), which the page already reads. `GET /branches` is scoped to the user's allowed branches by the server.

**No functional or security decision was left open by the contract**, so none was assumed or asked. One design point worth the owner's eye is in §6 (a restricted user cannot be recognised client-side).

No backend, API, database, permission, accounting, POS or ZATCA change.

## 2. What was done

### Who sees it
- The create action is **absent** (not disabled) unless the server-computed permission list holds `delivery_connector.manage`, and in demo mode. A viewer without it sees neither the action nor any guidance.
- It is offered **only when the tenant has an active manual attribution profile** for that platform. The signed ingress is an AWJ-internal capability: the six registry platforms all use the same contract and the native-integration readiness gate is neither consulted nor bypassed (it concerns native connect, which this slice does not touch).
- **No active profile → guidance, not creation:** an explanatory box with a link to the existing setup screen `/delivery-platforms` (or a "needs company-management permission" note without the link), for the missing and the disabled cases. If the profile read itself failed it says so ("this does not mean it is missing") with no button and no link. **This slice never creates or edits a platform profile.**

### The form
- Fields are the contract's fields only: **store ID** (required) and **branch** (optional). The platform and the profile are fixed by the page.
- Store ID: trimmed (as the server does), required, **≤ 191 bytes** (Arabic letters are two bytes), and **no control characters** — the server accepts them but the ingress panel's reader would then reject the new point and fail the whole list, so the form prevents it.
- Branch: a select filled from `GET /branches` (**only with `branches.view`, only when the form opens**), active branches plus "No branch". The list is a convenience; **the server decides** (not visible → 404, inactive → 422, required for a restricted user → 422, all shown from the fixed dictionary with the form left open for correction). Without `branches.view` there is no field and the reason is stated. If the branch read fails the submit is blocked (no silent unrouted point) and a read-retry is offered.
- Submission is by an explicit button or Enter in the text field (no raw `<form>`: the structural guard for this module forbids raw form elements).

### Creating
- One `POST` to the existing endpoint with exactly the three contract fields (`branch_id` omitted when there is none). A request lock raised before the first `await` makes a double click send one request; while it runs the form cannot be closed (Escape, backdrop, cancel; the X is hidden) or edited. No automatic retry.
- Success → `SecretRevealDialog` with `requireConfirmToClose`: masked by default (reveal and copy available), no close before "I have saved the secret". The secret is one React state value until the dialog closes, then `null`; never stored, logged, tracked or put in a URL. The list is refreshed **after** the dialog closes (not behind it), and a success notice names the point (never the secret).
- **Explicit refusal** (409/422/404/403 with the fixed messages): the form stays open with an inline message so the user can correct and submit again — nothing was created, so that is a new deliberate action, not a blind retry.
- **Unknown outcome** (network loss, 5xx, or a 2xx whose secret cannot be read): the form closes with the "result unknown, do not repeat the request" notice, **no retry control, no automatic repeat**, and the list is re-read. The outcome is then **reconciled against the fresh list**: if a point with that store ID that was not there before appears, configured and at secret version 1, the notice becomes "it appears to have been created but its secret did not reach you — use *Rotate secret* on its row" (the 5b path; **never rotated automatically**); if none appears it says so honestly; if the re-read itself fails the unknown-outcome notice simply stays. The list shown at the moment of failure never decides the outcome (compared by identity, since React may batch loading and ready into one render).
- Notices and dialogs now sit **above** the list so a result such as "secret lost" is visible on mobile without scrolling.

## 3. Changed files

| File | Change |
|---|---|
| `web/src/lib/ingress-create.ts` | **new** — `checkStoreId` (trim, bytes, control chars), `readBranchOptions` (active only, fail-closed) |
| `web/src/lib/ingress-operations.ts` | `createIngressPoint` (third POST route; the only place that reads the secret, still no storage/log/URL) |
| `web/src/lib/integration-center.ts` | `readActiveProfileIds` (strict reader of the profile ids the create call needs) |
| `web/src/components/integrations/use-ingress-management.ts` | create state, request lock, unknown-outcome reconciliation (`observe`) |
| `web/src/components/integrations/ingress-create-dialog.tsx` | **new** — the form |
| `web/src/components/integrations/ingress-create-entry.tsx` | **new** — the create button / profile guidance |
| `web/src/components/integrations/use-signed-ingress.ts` | `useBranchOptions` (read on form open, `branches.view` only) |
| `web/src/components/integrations/ingress-management-layer.tsx`, `ingress-row-actions.tsx`, `signed-ingress-panel.tsx`, `delivery-platform-detail.tsx`, `delivery-platform-detail-screen.tsx`, `use-delivery-integration-data.ts` | wiring (optional props; without them the panel is unchanged) |
| `web/src/components/shared/plain-text-field.tsx` | **new** — neutral labelled text field |
| `web/src/messages/ar.json`, `en.json` | create form, guidance, notices |
| Tests | `ingress-create.test.tsx` (screen-level create flows, both locales), `lib/ingress-create.test.ts`, extended `ingress-operations.test.ts`, `use-ingress-management.test.tsx`, `no-connection-controls.test.ts` (structural guard updated), 5b screen test adjusted |
| `web/e2e/int-ux-5c-create-ingress.spec.ts` | **new** real-browser spec; `int-ux-4-signed-ingress.spec.ts` adjusted (owner now also sees the create action) |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | slice header status |

## 4. Tests and results (local)

- **Related first:** `src/components/integrations`, `src/lib`, `src/components/shared` → 101 files / 937 tests ✅ (before the last additions).
- **Full Vitest:** 583 files / **6320 tests** ✅. **`npm run build`** ✅.
- **Behavior covered:** permission and demo matrix (manage only; viewer; reassign-only; demo); missing / disabled / unreadable profile guidance and link vs. no link; validation (empty, whitespace, control char, 191-byte boundary, Arabic byte counting); exact request body (trimmed store ID, `branch_id` only when chosen); branch list (active only, `branches.view` gating, failed read blocks submit with a read retry); Enter submits once; success reveal (masked, locked close, list refreshed only after closing, no secret in DOM / storage / console / URL afterwards); **double submit = one request** and no close/edit while busy; explicit refusals 409/422/404/403 (nine contract cases) keep the form open and never show server text, then a corrected submit works; **unknown outcomes** (network, 502, unreadable 2xx, empty secret): one request, no retry control, list re-read, reconciliation to "secret lost" / "not created" / "still unknown", stale-list and pre-existing-point cases; 5b rotate/disable suites unchanged and green; AR + EN.
- **Mutation checks (each made tests fail, then reverted):** remove the create lock; treat unknown outcomes as explicit refusals; let the stale list decide (needed one new hook-level test to be caught); count characters instead of bytes; show create without `manage`; refresh the list before the secret dialog closes; stop blocking submit on a failed branch read.
- **Structural guard:** the only code touching the connector routes is `lib/ingress-operations.ts` (now exactly three POST routes: create, rotate, disable; create body limited to the three contract fields; no reassign); only the management hook calls it; buttons allowed in the module are the declared ones only.
- **Playwright (real Chromium, real clicks/keys):** `int-ux-5c` + `5b` + `5a` + `int-ux-4`, desktop and mobile projects → **126 / 126 passed** (AR/EN × light/dark).
- **Important:** these are UI tests with an intercepted API. They are **not** proof of operation against a real backend; the contract was read from the controller, request and service code.

## 5. Visual verification

Screenshots reviewed (panel, form, validation, locked and revealed secret, created, explicit refusal, unknown outcome, guidance) in AR/EN × light/dark × desktop (1440) / mobile (390). RTL/LTR correct, store ID and secret LTR inside RTL, form and notices readable in dark, ≥ 44 px touch targets, no horizontal overflow. One defect found and fixed during review: on mobile the "secret lost" notice sat **below** the list, out of view — notices/dialogs now render above the list. The red "N Issues" chip is the Next dev-server indicator, not product UI.

## 6. Risks and what remains

- **Real backend not exercised** (see §4).
- **A branch-restricted user cannot be recognised client-side.** The user object carries no restriction flag and `GET /branches` returns the user's allowed branches either way. So the form always offers "No branch" and a restricted user who picks it is refused by the server (`branch_required`, fixed message, form stays open). Alternatives (a new field on `/me`, or inferring from list size) would need a backend change or a guess — not done; flagging for the owner.
- **Without `branches.view` no branch can be chosen**, so a restricted user without that permission cannot create (the server refuses and the form says why). This is the contract working as designed.
- **The store ID is globally unique per platform** (`platform_key + external_store_id`, no tenant in the key), so a 409 may mean another tenant holds it; the fixed message does not reveal which (DP-A context, unchanged).
- **Reconciliation is best-effort and honest:** the list is branch-scoped; a created point outside the user's visible scope would read as "not created". The notice says "most likely".
- **Unchanged and out of scope:** the server still allows rotating a disabled point (UI never offers it); no re-enable; rotate/disable from 5b untouched. Pre-existing unrelated: the INT-UX-1 mobile flake `summary error keeps the card usable`, and TypeScript errors in unrelated test files (none in files touched here).
- **Remaining in INT-UX-5:** 5d reassign operator. INT-UX-6 and INT-MAP-1 are not started.

## 7. Git state

Branch `feat/int-ux-5c-create-ingress` · Draft PR #1463 · Base SHA `c47fd408200bdfbbb845d6d252d7d93a1fa29392` · code head `8fb108a30795d28510409bb2e23eccb098f30c07`; this report's own commit is the final head (a report cannot name its own SHA — the final Head SHA is the PR head).

## 8. Next step

Owner review of the Draft PR (and a view on the restricted-user point in §6). After approval, INT-UX-5d as a separate assignment. No merge, no deploy.
