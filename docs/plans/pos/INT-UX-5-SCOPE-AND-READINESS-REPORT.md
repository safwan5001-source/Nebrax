# INT-UX-5 — Scope & Readiness Report

STATUS: **BLOCKED — owner decisions required** (one blocking gate, several pre-implementation decisions). Investigation only: **no code, migration, API, permission or test was changed.** Not merged, not deployed.
DATE: 2026-10-14
BASE VERIFIED: `main` @ `7d9ddb1f944b5abcac329a1b6ab1e4e25cc4a1dd` (matches the stated state: INT-UX-4 `176965d0`, INT-AUDIT-1 backend `af82fcb0`, its documentation `7d9ddb1f`).

## 1. INT-UX-5 as defined in Horizon

`DLV-INTEGRATIONS-UX-DESIGN-1.md` §11:

> **INT-UX-5 — Ingress management actions *(only if DP-C option 3 is approved)***
> - **Scope.** Create, rotate (with one-time reveal), disable (with irreversibility warning), reassign operator, using the **existing** endpoints; extract/neutralize `ConfirmDialog` and `SecretRevealDialog` for shared use.
> - **Depends on.** INT-UX-4, DP-C, **INT-AUDIT-1** (hard: no rotate/disable/create/reassign UI before lifecycle audit exists).
> - **Acceptance.** Secret appears only in the reveal dialog and is cleared on close; disable dialog states irreversibility; reassign copy per §5.7.
> - **Security.** No storage/URL/log of secrets; `delivery_connector.manage`/`reassign` enforced server-side and mirrored client-side; actions absent (not disabled) without permission.
> - **Tests.** Secret-handling component tests; permission matrix; error-code mapping.
> - **Excludes.** Provider connections, re-enable (GAP-4), remap.

Related: §5.7 (action table and copy), §5.9 (states), §7.1–7.2 (hardening), §9.3–9.4 (labels/messages), DP-C, DP-E, DP-F. The Handoff records the same hard dependency on INT-AUDIT-1.

## 2. Dependencies

| Dependency | State |
|---|---|
| INT-UX-4 (read-only panel) | **Done** (`176965d0`) |
| INT-AUDIT-1 (lifecycle audit) | **Done** (`af82fcb0`): create, rotate, disable audited in the operation's transaction; reassign already audited (`delivery_connector_operator_events`) |
| DP-F | **Approved** |
| **DP-C option 3 (full management UI)** | **NOT approved.** Only option 2 was approved, "for INT-UX-4 only … not a standing approval", and the Horizon header makes INT-UX-5 conditional on option 3. The recommendation text adds: *only after an owner decision on who legitimately builds custom adapters* — not yet made |
| DP-E (finance-role visibility) | Unchanged (owner/admin only). Not needed for management actions; needed only for the audit *reader* (INT-UX-6) |
| Audit reader (INT-UX-6) | Deferred by decision; **not required** by INT-UX-5 (writes are already audited) |

## 3. Operations: allowed and excluded

| Operation | Allowed by INT-UX-5 | Endpoint (existing) |
|---|---|---|
| Create signed ingress point | Yes | `POST /delivery-connectors` |
| Rotate secret (one-time reveal) | Yes | `POST /delivery-connectors/{id}/rotate-secret` |
| Disable (irreversible, with warning) | Yes | `POST /delivery-connectors/{id}/disable` |
| Reassign operator | Yes | `POST /delivery-connectors/{id}/reassign` |
| Extract neutral `ConfirmDialog` / `SecretRevealDialog` | Yes (web refactor, behavior-preserving for the developer screens) | — |
| Provider connect / authorize / reconnect / sync, pause/resume | **Excluded** (Track P, `DESIGN_ONLY`) | — |
| Re-enable a disabled point (GAP-4), branch re-home/remap (INT-MAP-1) | **Excluded** | none exist |
| Edit store id / platform / branch of an existing point | **Excluded** (mapping is immutable server-side) | none exist |
| Read the audit log | **Excluded** (INT-UX-6, deferred) | none |
| Webhook test/replay, payload viewing | **Excluded** | — |
| Any change to POS, accounting, ZATCA, readiness, manual attribution | **Excluded** | — |

## 4. Existing API contract (verified in the code)

- **Create** — body `delivery_platform_profile_id` (uuid, required), `external_store_id` (string ≤191, required), `branch_id` (uuid, optional). 201 `{data: <account>, secret: "dsec_…"}`. Needs an **active** manual profile for the platform (`profile_unavailable` 404 otherwise), a visible/active branch (`branch_unavailable` 404, `branch_inactive` 422), a **branch for branch-restricted users** (`branch_required` 422), a valid store id (`invalid_store` 422); a store id already mapped anywhere → `mapping_ambiguous` 409 (the store id is **globally unique and never released**).
- **Rotate** — empty body; 200 `{data, secret}`; version n→n+1; the previous secret is invalid immediately (live senders using it start failing). Server does **not** check status: a disabled point can still be rotated (observation A5).
- **Disable** — empty body; 200 `{data}`; irreversible; idempotent (repeat = 200, no new event).
- **Reassign** — body `user_id` (uuid); the server validates eligibility (`operator_ineligible` 422: inactive, other tenant, or not allowed for the point's branch; an unrouted point accepts only an unrestricted user). Does not touch the secret.
- **Resource** — `secret` appears **only** in the create/rotate response, top level, never in `data`; reads return no secret (`secret_prefix` is returned by the list — INT-UX-4 deliberately never reads it).
- Server gates on all four: `delivery_connector.manage` (reassign: `.reassign`) + application `sales.pos` (`disabled` **and** `suspended` reject writes).

## 5. Permission × operation matrix (existing names only)

| Operation | Server gate | owner/admin | accountant | staff | self_service | Custom role |
|---|---|:-:|:-:|:-:|:-:|---|
| See the panel / list | `delivery_connector.view` + `sales.pos` | ✓ | ✗ | ✗ | ✗ | if granted |
| Create / rotate / disable | `delivery_connector.manage` + `sales.pos` enabled | ✓ | ✗ | ✗ | ✗ | if granted |
| Reassign | `delivery_connector.reassign` + `sales.pos` enabled | ✓ | ✗ | ✗ | ✗ | if granted |
| **Picker inputs** (data the forms need) | | | | | | |
| — platform profile id (create) | `GET /delivery-platforms`: `invoices.view` | ✓ | ✓ | ✓ | ✗ | |
| — branch list (create) | `GET /branches`: `branches.view` | ✓ | ✓ | ✓ | ✗ | |
| — **user list (reassign)** | `GET /users`: **`users.view`** (a *different* permission) | ✓ | ✗ | ✗ | ✗ | |

Client rules (from Horizon and the INT-UX-4 pattern): permissions read from the server-computed list, never from the role name; an action without permission is **absent**, not disabled; the server stays the authority. **Gap:** a custom role granted `delivery_connector.reassign` but not `users.view` cannot populate the operator picker. With "no new permissions", the reassign action would require **both** permissions to be shown.

## 6. Tenant isolation, branch scoping and audit coverage

- **Isolation (existing, tested):** tenant-scoped model; foreign ids are 404; the list and all four routes apply `visibleTo()` (restricted users see/act only on accounts of their allowed branches; unrouted accounts are hidden from them); a restricted user cannot create an unrouted or foreign-branch point. The UI must not widen this: it renders what the server returns and treats 404/403 as "not available", never as empty.
- **Audit (INT-AUDIT-1) for the operations the UI can call:** create ✔ `ingress.created`; rotate ✔ `secret.rotated` (n→n+1); disable ✔ `ingress.disabled` (once, on the real transition); reassign ✔ operator event. A failed audit write rolls the operation back (UI sees a 5xx; nothing changed). **No double counting:** rapid repeat of disable is idempotent. The audit rows cannot be shown in the UI yet (INT-UX-6); the UI must not imply a visible history.
- **Residual risks to design for:**
  1. **Lost one-time secret.** Create/rotate commit on the server before the response arrives. If the response is lost (network drop, tab closed, crash), the secret is gone: the user must **rotate again**. There is no idempotency key on these endpoints (no API change allowed). The UI must handle "unknown outcome": no blind retry of create (a retry returns `mapping_ambiguous`), clear copy, and a refresh of the list.
  2. **Double submit** of create/rotate: the in-flight state must disable the submit and the dialog must be non-dismissible while a request is pending.
  3. **Rotate is disruptive:** it invalidates the live secret at once; the confirm step must say so.
  4. **Secret exposure surfaces:** React state only (cleared on close), never storage/URL/query/log/analytics/error toasts/clipboard history beyond the explicit copy; masked by default; the confirm-saved gate before closing; no secret in `data-*`, `title`, `aria-label`, test snapshots or screenshots (the INT-UX-4 sentinel technique applies). Browser dev tools and extensions can always see a response body: this is inherent and is why the secret is shown once and rotation exists.
  5. **Demo mode:** the app's mock API has no connector management routes; a demo user must see a neutral unavailable state, never a fabricated secret.
  6. **Observation (no change here):** create/rotate responses carry the secret without an explicit `Cache-Control: no-store` (Laravel's default `no-cache, private` applies; POST responses are not cached by browsers). Hardening would be a backend decision.
  7. **Observation A5:** the server allows rotating a *disabled* point. The UI should simply not offer it (absent); whether the server should refuse is a separate backend decision.

## 7. Mixing signed ingress with native provider integration (R-GATE)

- INT-UX-5 manages **AWJ-signed ingress** only. It must keep the approved term «نقطة استقبال أحداث موقّعة» and never say «متصل بالمنصة», «حساب التاجر مرتبط», «المزامنة مفعّلة», «جاهز للتكامل الأصلي». No Connect/Authorize/Reconnect/Sync verbs anywhere; the new actions are titled for the ingress (Create ingress point / Rotate signing secret / Disable ingress point / Reassign operator) and sit in the ingress panel, **never** in the capability-ladder rows nor as a provider's primary action (R-GATE-7).
- The secret dialog states it is for **AWJ-signed event delivery only**, not a provider credential; the store id the user types is a **label** chosen by the operator, not a verified provider identity (the existing note on branch ≠ provider store mapping stays).
- The structural guard test (`no-connection-controls.test.ts`) currently forbids any write and any raw button: it must be **narrowed deliberately and minimally** (allow exactly the four POSTs, from the one management hook, with the new components) — and it keeps forbidding every connect/sync/OAuth/credential string.
- Disable copy: «لا يمكن إعادة التفعيل من هنا حالياً.» + the store id stays reserved; no "delete" wording.

## 8. Visual and functional requirements

- **Surfaces:** actions live **inside the INT-UX-4 panel** on the delivery-platform detail page (no new route, no page redesign); a row action menu (desktop) / card actions (mobile) opening `Dialog`s (existing primitives: `Dialog`, `Select`/`Combobox`, `Button`, `Skeleton`, `Badge`; destructive confirmation via the extracted neutral `ConfirmDialog`).
- **Create dialog:** platform is fixed by the page; branch picker (active, accessible branches only; unrouted option only for unrestricted users); store-id field (text, `ltr`, ≤191, trimmed); if the tenant has **no active manual profile** for this platform → explain and link to the existing setup (`company.manage`), do not create a profile here (excluded).
- **Secret dialog:** the extracted neutral `SecretRevealDialog` (masked by default, copy, explicit "I saved it" gate, state cleared on close, non-dismissible by backdrop/Escape before confirmation); wording «احفظ السر الآن. لن يُعرض مرة أخرى.»
- **Rotate:** confirm step (impact stated) → reveal. **Disable:** confirm with irreversibility text and the store id; no typed confirmation unless the owner asks (decision below). **Reassign:** operator picker (names only), result copy «تمت إعادة الإسناد. لم يتغير السر.» plus the rotate-separately note.
- **RTL/LTR and themes:** AR RTL + EN LTR, light + dark; store ids/secrets in `dir="ltr"`; tokens only, no green for ingress state; AA contrast; logical properties; focus trap and return focus; keyboard operable; `role="alertdialog"` for destructive confirms; 44 px targets on mobile.
- **States:** loading (skeleton, buttons show progress and are inert), success (toast + list refresh, secret only in the dialog), empty (panel empty state gains the **Create** action only for `manage` holders), validation errors (inline, mapped from `error_code`), 403 / POS off / **suspended** (actions absent or a neutral "read-only" note), 404 on a stale row ("no longer available", refresh), 409 `mapping_ambiguous` (store id already mapped, cannot be reused), 422 branch/operator errors, 5xx/network "outcome unknown" (see §6.1), 401 (existing global redirect), mid-session permission change (re-read on next action).
- **Error-code dictionary** (client-side, by `error_code`, never raw server text): `mapping_ambiguous`, `profile_unavailable`, `branch_unavailable`, `branch_inactive`, `branch_required`, `invalid_store`, `operator_ineligible`, `connector_unavailable`, `tenant_required`, plus generic 403/5xx.
- **Tests required:** secret-handling component tests (not in storage/DOM after close, masked default, confirm gate, cleared state); permission matrix per action (absent without permission, zero requests); POS off/suspended; branch-restricted fixtures; error-code mapping; no secret/prefix in any attribute (sentinel); double-submit; unknown-outcome path; structural guard updated narrowly; AR/EN × light/dark × desktop/mobile e2e with a mocked API (no real secret ever); the developer screens' existing tests unchanged after the dialog extraction.

## 9. Decisions needed (with recommendation)

| # | Decision | Recommendation |
|---|---|---|
| **D1 — BLOCKING** | **Approve DP-C option 3** (full management UI) for INT-UX-5, and state **who legitimately builds custom adapters** (the audience of the secret). Without it the slice is not authorized by its own Horizon header | Approve for **owner/admin and `delivery_connector.manage` holders only**, scoped to this slice; the audience is the tenant's own integrator/developer, not a merchant self-service flow |
| D2 | Operator identity display in the reassign picker and the panel. DP-C's data limits say **no operator identifiers and no approved name source**; the picker needs `GET /users` (`users.view`) and returns email/role/branches | Allow **name only** (no email) in the picker and the current-operator label, shown only to holders of both `delivery_connector.reassign` and `users.view`; otherwise hide Reassign. Amend the DP-C data limits accordingly |
| D3 | Reassign permission rule when a role has `reassign` but not `users.view` | Require both; no new permission, no API change |
| D4 | Slicing (see §10) | 5a foundations → 5b rotate+disable → 5c create → 5d reassign |
| D5 | Rotate on a **disabled** point | UI: absent. Server: leave as is (separate backend decision) |
| D6 | Typed confirmation (store id) for **disable** | Yes — it is irreversible and the store id stays reserved forever |
| D7 | Create when the tenant has **no active manual profile** | Show an explanation + link to the existing manual-attribution setup; never create a profile from here |
| D8 | "Unknown outcome" handling of a lost create/rotate response (§6.1) | Specify as above; no retry button for create; guide to refresh and rotate |
| D9 | Arabic/English copy approval (labels above and the §9.4 catalog) | Approve with the existing approved term; keep the forbidden-phrase tests |
| D10 | Demo mode | Neutral unavailable state; no mock secrets |

## 10. Size and recommended split (web only; no backend, API, DB, RBAC change)

Estimated total: **medium-large** (≈ 15–20 web files, ≈ 40–60 unit/component tests, one e2e spec, no PHP). Split into small, independently reviewable PRs, each stopping for review:

1. **INT-UX-5a — foundations (small):** extract neutral `ConfirmDialog` and `SecretRevealDialog` (translations by prop/namespace), leave the developer screens behaviorally identical (their tests unchanged), add the management hook/client skeleton and the error-code dictionary, narrow the structural guard. No visible change.
2. **INT-UX-5b — rotate + disable (medium):** row actions, confirms, one-time reveal, irreversibility warning, permission gating, states, tests.
3. **INT-UX-5c — create (medium):** dialog with branch/store inputs, profile precondition, unknown-outcome handling.
4. **INT-UX-5d — reassign (small–medium):** operator picker per D2/D3.

## 11. Suggested first executable scope (after D1–D3 are decided)

**INT-UX-5a + INT-UX-5b together would be too large; start with 5a only** (pure web refactor, zero new capability, zero risk to the secret surface), then 5b as a separate PR. Nothing starts before the owner's approval.

## 12. Verdict

**BLOCKED** — D1 (DP-C option 3 and the adapter-audience statement) is a hard prerequisite per Horizon. All technical dependencies are met: the endpoints exist, INT-AUDIT-1 covers every operation the UI can call, isolation and permissions are sufficient, and no backend change is needed. **READY to implement 5a → 5b → 5c as soon as D1 is approved; 5d additionally needs D2/D3.**

## 13. Changed files and git

- **Changed files:** this report only. No code, migration, API, RBAC or test change.
- **Base:** `main` @ `7d9ddb1f944b5abcac329a1b6ab1e4e25cc4a1dd`. **Branch:** `docs/int-ux-5-scope-gate`. **PR / head SHA:** in the PR and the final message.
- INT-UX-5, INT-UX-6, INT-MAP-1 **not started**. Nothing merged or deployed.
