# AWJ POS V2 — PR-7: Session Operations (إدارة الجلسة / Session Management)

Gate 2 of the AWJ POS V2 Final Completion Master Mission. Scope: bring the
in-workspace ("Start Selling") close-session flow to parity with the
already-complete, server-authoritative Session Management back-office
(`/pos/sessions`, `/pos/sessions/[id]`) — closing preview, per-payment-method
reconciliation, and a mandatory handover note — without touching any backend
contract, Shift/Session distinction, or the protected Start Selling flow.

## Existing-first findings

Before writing any code, the existing backend/frontend/tests were located and
each Master Mission requirement classified:

| Requirement | Classification | Evidence |
|---|---|---|
| POS Session vs Shift distinction | EXISTING_AND_SUFFICIENT | `PosSession.pos_shift_id` (→ `PosShift`) is already fully separate from the legacy HR `shift_id`; the workspace already sends `pos_shift_id` at open time (`pos/start/page.tsx`, unchanged). |
| Expected-cash formula, single source of truth | EXISTING_AND_SUFFICIENT | `PosSessionService::cashMovement()` computes `opening + cash_sales + cash_in − cash_out − cash_refunds` once, reused identically by `close()`, `closingPreview()`, `report()`. No frontend recomputation existed or was added. |
| Closing preview endpoint (`GET /pos-sessions/{id}/closing-preview`) | EXISTING_AND_SUFFICIENT | Already implemented and already consumed correctly by `/pos/sessions/page.tsx`. The gap was that the **in-workspace** dialog never called it. |
| Reconciliation snapshot (`PosSessionReconciliation`), immutable, per payment method | EXISTING_AND_SUFFICIENT | No backend change needed; the in-workspace dialog simply had never been sending `payment_counts`. |
| Handover note requirement, SoD confirm rules | EXISTING_AND_SUFFICIENT | Backend already enforces confirming user ≠ opener/closer + `pos.session.handover.confirm` permission on the (unchanged) confirm action on `/pos/sessions/[id]`. |
| Manual cash-drawer open | EXISTING_AND_SUFFICIENT (not a gap) | Already fully wired in `(pos)/pos/page.tsx`: `onOpenCashDrawer`, `cashDrawerDisabled` guard, `openCashDrawer()` two-phase bridge flow. Verified by reading the code directly — untouched in this PR. |
| **In-workspace close dialog itself** | **REAL_GAP** | Collected only a single "counted balance" number and posted `{closing_balance}` alone — silently discarding `payment_counts` and `handover_note`, both of which the backend has required/accepted since the sessions pages were built. This was the one concrete gap PR-7 exists to close. |
| Recount UI (`cash_recount`, approval-required) | DEFERRED (see below) | Always requires a pre-approved `PosOverrideApproval` id; no approval-request UI exists anywhere in the POS frontend yet. Same underlying gap already deferred in the PR-6 report for returns approval — not invented for this PR, cross-referenced for consistency. |
| Translation keys for the upgraded dialog | EXISTING_AND_SUFFICIENT | Every key used (`posSessions.*`: `close_title`, `close_reconciliation_hint`, `reconciliation_source`, `cash_drawer`, `expected`, `counted`, `handover_note`, `handover_note_placeholder`, `close_and_submit_handover`, `cancel`, `number`, `device`, `work_shift`, `warehouse`, `opening_balance`, `opened_at`, `view_details`; `pos.cashier`) already existed in both `ar.json` and `en.json`, verified by direct JSON inspection before writing any JSX. **Zero new translation keys added.** |

## What was implemented

Single file changed: `web/src/app/(pos)/pos/page.tsx`.

1. **Session-info panel** inside the close dialog: session number, cashier,
   POS device, work shift, warehouse, opening balance, opened-at, plus a
   `target="_blank"` link to the existing `/pos/sessions/{id}` detail page
   (report/audit/handover/variance actions already fully built there — not
   duplicated).
2. **`prepareClose()`** — replaces the old blank-dialog opener. Fetches
   `GET /pos-sessions/{id}/closing-preview`, populates the cash-drawer +
   per-payment-method rows, resets `countedBal`/`handoverNote`/`paymentCounts`.
   Wired behind the same unsaved-cart guard the old `closeSession()` used
   (`decidePosUnsavedExit`) — cart-guard behavior is unchanged.
3. **`submitClose()`** — replaces the old single-field submit. Posts the full
   `{closing_balance, payment_counts, handover_note}` payload to
   `POST /pos-sessions/{id}/close`, byte-for-byte matching the payload shape
   `/pos/sessions/page.tsx` already sends.
4. **Dialog markup** — replaced the primitive one-input form with the
   reconciliation table (cash drawer row + one row per non-cash payment
   method, each showing `expected` when not blinded and a required `counted`
   input), the mandatory handover-note textarea, and the same submit-disabled
   validation (`isValidRiyal` on every counted field, handover note ≥ 3
   trimmed chars) already proven correct on the sessions list page.
5. **Local type additions** (additive only): `ClosingPreviewMethod` /
   `ClosingPreview` interfaces mirroring the sessions-page shapes; the local
   `PosSession` interface gained `opening_balance` / `opened_at` / `pos_shift`
   — all three already present in the real `PosSessionResource` response
   (confirmed by reading `revalidateSession()`), just not previously typed.

Nothing else in the ~2450-line file was touched. `finishCloseSession`/
`closeSession` were renamed in place to `prepareClose`/`submitClose`;
`grep` confirms no leftover references to the old names.

## Changed files

- `web/src/app/(pos)/pos/page.tsx` (+182 / −20 lines) — the only change in
  this PR.

No backend file, migration, route, or test was touched.

## Backend contracts reused/changed

**Reused, unchanged:**
- `GET /pos-sessions/{id}/closing-preview`
- `POST /pos-sessions/{id}/close` (body: `closing_balance`, `payment_counts[]`, `handover_note`)
- `PosSessionResource` fields `opening_balance`, `opened_at`, `pos_shift`

**Changed:** none.

## Financial/accounting impact

None. This PR touches only how the frontend collects and displays data that
already flows through the existing, untouched `PosSessionService::close()`
pipeline. No new journal entries, no new accounting paths, no change to the
expected-cash formula. The one financial transaction exercised during QA
(a real cash sale, real session close with a real shortage) posted through
the pre-existing, unmodified backend exactly as it did before this PR.

**No accounting entries were added or changed by this PR** — per the
mandatory pre-PR protocol, there is no new-journal-entry table to present
because no new financial operation was introduced. The one entry generated
during QA (the sale itself) is the standard, pre-existing POS sale entry:

| # | Account | Debit | Credit |
|---|---|---:|---:|
| 1 | 1110 الصندوق (Cash) | 132.25 | |
| 2 | 4110 إيرادات المبيعات (Sales revenue) | | 115.00 |
| 3 | 2120 ضريبة مخرجات (Output VAT) | | 17.25 |

(Standard existing POS checkout entry, unchanged by this PR — shown only
because a real sale was posted during QA, not because PR-7 introduces it.)

## Tenant/Branch/permission/approval/SoD analysis

Unchanged. The dialog still operates on the caller's own open session
(`session.id`, already tenant/branch-scoped by `SetTenant`/`SetBranch` on
every route it calls); no new endpoint, no new permission gate. SoD rules
(handover confirm requiring a different user than opener/closer; optional
`self_approval_blocked_for_variance` for acknowledge/settle) live entirely on
the unchanged `/pos/sessions/[id]` confirm/acknowledge/settle actions, which
this PR does not touch — the in-workspace dialog only ever performs the
*close* step (opener closing their own session), which has no SoD
restriction by design (SoD applies to the *handover confirm*, a distinct,
later step by a different user).

## Closing Preview / expected cash / actual cash / difference behavior

Verified live end-to-end against the real backend (see Browser QA):
opening balance 200.00 SAR + one real cash sale of 132.25 SAR → closing
preview correctly showed **expected 332.25 SAR** for the cash drawer row,
computed entirely server-side by the unmodified `cashMovement()` formula.
Blind-cash-count handling is unchanged: the controller layer (untouched)
nulls `expected_amount` when the tenant setting is enabled, and the dialog
already hides the "expected" line whenever `expected_amount === null` — no
new frontend logic was needed for that case since the JSX pattern was
copied verbatim from the already-correct sessions-page implementation.

## Close and handover behavior

`submitClose()` posts `closing_balance` (from the cash-drawer row's counted
input), `payment_counts` (one entry per non-cash payment method actually
returned by the preview), and `handover_note` (trimmed, or `null` if empty —
though the submit button is disabled below 3 trimmed characters, matching
the sessions-page rule). On success it navigates to `/dashboard`, identical
to the pre-PR behavior. Handover then sits in `pending` status exactly as
before, awaiting confirmation by a different user via the unchanged
`/pos/sessions/[id]` page.

## Retry/error safety

Unchanged idempotency posture: `close()` is a single POST guarded server-side
(session status transition `open → closed`); a second close attempt against
an already-closed session is rejected by the existing backend validation, not
by anything added here. `prepareClose()` resets all preview state before
each open, so a failed preview fetch (network error, closing-preview mid-air
edge case) surfaces `sessionError` and leaves `closePreview` `null`, which
correctly keeps the submit button disabled (`!closePreview` is part of the
disabled condition) — no partial/invalid submission is possible.

## Tests and exact results

No backend files were touched, so no PHP test run was required for this PR's
own change; `php artisan test` was left to the last full run performed for
PR-6 (unaffected).

Frontend:

```
npx tsc --noEmit -p tsconfig.json
# 3 pre-existing failures, all in files untouched by this PR:
#   - src/app/(app)/pos/settings/configuration/page.test.tsx (2 errors)
#   - src/platform/integrations/gemini-card.test.tsx (1 error)
#   - src/components/platform/global-application-controls-card.test.tsx (1 error)
# Zero errors in web/src/app/(pos)/pos/page.tsx.

npx vitest run --pool=forks src/components/pos src/lib/money.test.ts src/lib/pos-workspace.test.ts
# Test Files  26 passed (26) · Tests  135 passed (135)

npx vitest run --pool=forks   # full suite
# Test Files  231 passed (231) · Tests  1484 passed (1484)
```

As documented in the PR-6 report, no test file exists yet for
`(pos)/pos/page.tsx` itself (a pre-existing Vitest/jsdom hang affects any POS
component whose mount-triggered `useEffect` calls `api()` with a non-null
session — confirmed pre-existing via `git stash` in the PR-6 investigation,
not a PR-7 regression). No new test file was added for this same reason;
this is called out explicitly below as a deferred item.

## Build result

```
npm run build
# ✓ Compiled successfully, all routes generated, no new errors.
```

## Browser QA

All performed against the real backend (fresh Laravel `serve` + `npm run
dev`, SQLite), a freshly registered tenant (`sales.invoicing`, `sales.pos`,
`inventory.core` explicitly enabled through the real `/applications/enable`
endpoint — no backend bypass), a real product with a real unit template, a
real customer, and a real POS device/shift, via pinned Chromium
(`/opt/pw-browsers/chromium`) driven by Playwright. No mocked backend, no
mocked UI.

| # | Scenario | Result |
|---|---|---|
| A | Desktop RTL — open session (200.00 SAR opening), one real cash sale (132.25 SAR, `INV-2026-00001`), then "إدارة الجلسة" → dialog shows session-info panel (number, cashier, device, work shift, warehouse, opening balance, opened-at) + reconciliation table with **server-computed expected 332.25 SAR** for the cash drawer | Pass |
| B | Submit-disabled validation: disabled with nothing filled → disabled with only counted amount filled (no handover note) → **enabled** once a ≥3-char handover note is added | Pass, verified via `button.isDisabled()` at each step |
| C | Real shortage close: counted 300.00 vs expected 332.25 → submitted with handover note → session closed, redirected to `/dashboard`. Verified via API: `closing_balance: "300.00"`, `expected_balance: "332.25"`, `difference: "-32.25"`, `variance_type: "shortage"`, `difference_status: "pending"`, `handover_status: "pending"`, one `PosSessionReconciliation` row (`reconciliation_key: "cash_drawer"`, `count_source: "operator"`) created | Pass |
| D | Dark mode — close dialog (second session, 100.00 opening) | Pass, correct contrast throughout, no unreadable text |
| E | Mobile RTL (390×844) — close dialog opened via the "..." dropdown's "إدارة الجلسة" item (the desktop inline button is `lg:`-only, unchanged) | Pass, `document.documentElement.scrollWidth > clientWidth` confirmed `false` (no horizontal overflow), no clipped content |
| F | Desktop LTR/English (`locale` cookie) — full workspace + close dialog | Pass, correct mirroring, all labels translated ("Close session", "Cashier", "POS device", "Work shift", "Warehouse", "Opening balance", "Reconciliation source", "Counted cash in drawer", "Cash drawer", "Expected", "Handover note", "Close and submit handover", "Session details") |
| G | "Session details" link → opens `/pos/sessions/{id}` in a **new tab** (`target="_blank"`, POS workspace state preserved) → real existing detail page renders (X/Z report, drawer movements, audit log, reconciliation-by-source panel) | Pass |

Console/page errors during all runs: none introduced by this change. (One
pre-existing, unrelated dev-mode-only warning appears on every page load —
`INVALID_KEY` from `use-intl` about dotted keys under `developer.events` in
the messages files — reproducible on a vanilla `/dashboard` load with no POS
interaction at all; not touched by, and unrelated to, this PR.)

## Risks

- **Low.** The change is additive/replacement within a single dialog in a
  single file; no shared component, hook, or backend contract was modified.
  The protected Start Selling flow (`pos/start/page.tsx`,
  `pos-open-session.ts`, `pos-workspace.ts`) was not touched and was not
  exercised differently by this change — it was used only as-is to seed QA
  sessions.
- The cart-unsaved-exit guard path (`closeSessionDialog` → guarded
  `prepareClose`) was manually re-verified to preserve the exact prior
  control flow (guard first, then fetch-and-open), but has no automated test
  coverage, consistent with the pre-existing test-infrastructure limitation
  below.

## Explicit deferred items (reason / risk / target)

1. **Recount UI (`cash_recount` approval flow).**
   *Reason:* always requires a pre-obtained `PosOverrideApproval` id (policy
   defaults to `approval_required`); no approval-request UI exists anywhere
   in the POS frontend today — the same gap already deferred in the PR-6
   report for returns approval.
   *Risk if left undone:* none new — recount was never available from the
   in-workspace dialog before this PR either.
   *Target:* a future PR introducing a general approval-request UI, which
   both this and the PR-6-deferred return-approval gap would then consume.

2. **Automated test coverage for `(pos)/pos/page.tsx`'s close dialog.**
   *Reason:* pre-existing Vitest/jsdom hang for any POS component whose
   mount-triggered `useEffect` calls `api()` with a non-null session,
   confirmed pre-existing (not a regression) via `git stash` during the
   PR-6 investigation. No test file exists for this page today.
   *Risk if left undone:* regressions in this dialog would only be caught by
   manual/browser QA (as performed here) or by the broader integration
   surface, not by CI unit tests.
   *Target:* a dedicated frontend test-infrastructure fix (mocking/timing
   strategy for mount-time `api()` calls in jsdom) — out of scope for a
   feature PR, flagged consistently across PR-6 and PR-7.

## Branch / PR / SHAs

- **Branch:** `claude/pos-v2-pr7-session-operations`
- **PR:** [#670](https://github.com/safwan5001-source/Nebrax/pull/670) (draft)
- **PR-7 branch point** (where this branch was created from): `fc88081ec71eb72303d454182cfd0d97726ba5b3`.
- **Current GitHub PR base tip** (`main` advanced by one unrelated merge —
  `f7ae6ed` / PR-INV-1 #668, central sensitive-cost authorization for
  Product/Inventory — while this branch was in progress): `f7ae6ed28036551c080e4ba53065daedff40a8f1`.
  Confirmed via `git log fc88081..origin/main` to be exactly that one commit,
  and confirmed it does not touch `web/src/app/(pos)/pos/page.tsx` — no
  conflict, no rebase needed.
- **Head SHA:** `c17993ee461d20c9b14eff0ee2a7c0974b8aac09` — verified live
  against PR #670's `head.sha` via `pull_request_read` immediately before
  this line was written. (As with the PR-6 report: a documentation-only
  commit cannot record its own resulting hash in advance; this is the exact
  final SHA after the report commit, confirmed live, not chased further to
  avoid an unbounded edit/verify loop.)

## Next step

**STOP.** Per explicit instruction: do not start PR-8, do not merge, do not
deploy. Awaiting review of PR-7.
