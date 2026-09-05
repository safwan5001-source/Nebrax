# AWJ POS Workspace V2 — PR-1: Workspace Foundation & Operational Shell

## A. Executive Summary

PR-1's mandate was to establish or minimally improve the stable operational
foundation of AWJ POS: a correct topbar/navigation hierarchy, real (non-fake)
navigation only, preserved cart/session/customer/device state, and corrected
POS Session vs. Shift terminology.

**Finding: the operational shell described by the PR-1 contract already
exists on `main` and is fully functional.** `PosTopbar`
(`web/src/components/pos/pos-topbar.tsx`) already implements the exact target
hierarchy — primary POS access/context, frequent operations (recent invoices,
held carts), operational context (branch, device, connectivity, session
number), exit (Return to ERP), and a secondary/overflow menu (warehouse
switch, cash drawer, return, exchange, account/settings/logout) — with every
action wired to a real, working handler in `web/src/app/(pos)/pos/page.tsx`.
There is no fake Invoices/Returns tab, no "coming soon" placeholder, and no
decorative icon anywhere in the shell. The Start Selling flow
(`web/src/lib/pos-workspace.ts` + its dedicated test suite) already enforces
every invariant PR-1 was asked to protect (same-tab `/pos/start`, new-tab
`/pos` only after session success, no premature tab, existing-session
adoption, unsaved-cart guard on exit) and was correctly left untouched.

The one real, in-scope defect found: **the shell mislabels the POS Session as
"Shift" in two places** — the session-number badge in the topbar (`pos.session`
key = "Shift"/"الوردية") and the button that opens session management
(`pos.manage_shift` = "Manage shift"/"إدارة الوردية", wired to the existing
close-session dialog). This is exactly the terminology confusion Section 10
of the mission describes. PR-1 corrects only this: two translation values (one
renamed key) and the two JSX call sites that read them. No component was
rebuilt, no state ownership changed, no new abstraction was introduced.

## B. Existing Implementation Classification

| Area | Status | Notes |
|---|---|---|
| POS route/page (`app/(pos)/pos/page.tsx`) | **IMPLEMENTED & USABLE** | Full selling flow; unchanged. |
| Desktop/mobile topbar (`pos-topbar.tsx`) | **IMPLEMENTED & USABLE** — one terminology defect | Hierarchy (A–E) already present; only the session/session-management labels were wrong. |
| Start Selling flow (`pos-workspace.ts`, `/pos/start`) | **IMPLEMENTED & USABLE** | Every invariant in Section 9 already enforced and covered by `pos-workspace.test.ts`. Not touched. |
| POS Session context/state (`session` prop, `posSessions` dialogs) | **IMPLEMENTED & USABLE** | Close/reconcile dialog (`closeOpen` in `page.tsx`) is the real "session management" target; only its topbar label was wrong. |
| Device/branch/cashier context | **IMPLEMENTED & USABLE** | Rendered in topbar from `session.pos_device`, `branch`, `cashier` props; read-only display, untouched. |
| Cart state ownership | **IMPLEMENTED & USABLE** | Owned entirely by `page.tsx`/`use-pos-active-carts.ts`; topbar has no cart state. |
| Customer selection state ownership | **IMPLEMENTED & USABLE** | Owned by `page.tsx`; topbar never touches it. |
| Held/suspended/multiple carts | **IMPLEMENTED & USABLE** | Real dialog (`pos-held-sales-dialog.tsx`), real count badge, real resume/discard. Not touched. |
| Session/cart recovery | **IMPLEMENTED & USABLE** | `pos-cart-snapshot.ts`/`use-pos-active-carts.ts`; not touched. |
| Interaction mode (AUTO/TOUCH/KEYBOARD_MOUSE/HYBRID) | **IMPLEMENTED & USABLE** | `pos-interaction-policy.ts` + `data-interaction-mode` on the shell root; not touched. |
| Connectivity indicator | **IMPLEMENTED & USABLE** | `usePosNetworkStatus()` + `CircleDot` in topbar; not touched. |
| Current invoices / latest-invoices action | **IMPLEMENTED & USABLE** | Real dialog (`pos-recent-invoices-dialog.tsx`), server-authoritative (R5). Not touched. |
| Session Management action | **IMPLEMENTED BUT UX INCOMPLETE → FIXED** | Wired correctly to the existing close-session dialog; label said "Manage shift". Fixed to "Session Management"/"إدارة الجلسة" — behavior unchanged. |
| Return to ERP action | **IMPLEMENTED & USABLE** | Goes through the unsaved-cart guard, does not end the session; not touched. |
| Overflow/more menu | **IMPLEMENTED & USABLE** | Warehouse switch, cash drawer, return, exchange — all real, permission/state-gated. Not touched. |
| POS translations (`pos.*`) | **PARTIALLY IMPLEMENTED → FIXED** | `pos.session` badge label and `pos.manage_shift` button label used "Shift" for a POS Session concept. Fixed; the legitimate Shift string (`pos.open_to_start`, describing the Start Selling opening-balance requirement) was left exactly as-is because it correctly describes the real organizational Shift precondition, not the POS Session. |
| Relevant frontend tests (`pos-topbar.test.tsx`, `pos-workspace.test.ts`) | **IMPLEMENTED & USABLE** | Both already exist and pass; one new test case added to `pos-topbar.test.tsx` to lock in the terminology fix. |
| Invoice Center / Returns workspace / mode selector | **DEFERRED (correctly, on `main` already)** | No such screen or placeholder exists anywhere in the POS shell; none was added. |

**Reuse over rewrite**: 100% of the shell, state ownership, and navigation
wiring was reused as-is. The only new code is a one-line JSX comment
explaining the Shift/Session distinction at the one call site where it could
be re-confused in the future.

## C. Scope Delivered

- Corrected two POS translation entries so the UI names the POS Session
  correctly instead of "Shift":
  - The session-number badge in the topbar (`pos.session`): "Shift"/"الوردية"
    → "Session"/"الجلسة".
  - The button/menu item that opens session management
    (`pos.manage_shift` → renamed `pos.manage_session`): "Manage
    shift"/"إدارة الوردية" → "Session Management"/"إدارة الجلسة".
- Updated the two JSX call sites in `pos-topbar.tsx` that read the renamed key,
  and added a short clarifying comment at the button.
- Added one focused test to `pos-topbar.test.tsx` asserting the new labels
  render and the old "Shift" wording does not.

Nothing else was changed. No component was added, removed, or restructured.
No `workspaceMode` abstraction was introduced (none was needed — the current
single-screen selling shell already satisfies PR-1).

## D. Changed Files

| File | Change | Why |
|---|---|---|
| `web/src/messages/en.json` | `pos.session`: "Shift" → "Session"; `pos.manage_shift` → `pos.manage_session`: "Manage shift" → "Session Management" | POS Session ≠ Shift; both labels described the operational POS Session, not an organizational Shift |
| `web/src/messages/ar.json` | Same two keys, Arabic: "الوردية" → "الجلسة" (badge), `manage_shift` → `manage_session`: "إدارة الوردية" → "إدارة الجلسة" | Same reason, Arabic UI |
| `web/src/components/pos/pos-topbar.tsx` | Both `t('manage_shift')` call sites updated to `t('manage_session')`; short clarifying comment added above the button | Keep code and translation keys in sync; document the distinction for future editors |
| `web/src/components/pos/pos-topbar.test.tsx` | One new test: asserts the "Session Management" button renders, "Manage shift" does not, and the session badge is titled "الجلسة" | Lock in the terminology fix as a regression test |
| `AWJ-POS-V2-PR1-IMPLEMENTATION-REPORT.md` | New | Required deliverable |

No file under `app/`, `database/`, `routes/`, or any other backend path was
touched. `git status --short` on this branch shows exactly the four files
above plus this report.

## E. State Ownership

| State | Owner before PR-1 | Changed by PR-1? |
|---|---|---|
| Cart | `page.tsx` (`cart`, `use-pos-active-carts.ts`) | No |
| Customer | `page.tsx` (`customer` state) | No |
| POS Session | `page.tsx` (`session` state, fetched from `GET /pos-sessions?mine=1`) | No |
| Device | `session.pos_device` (server-sourced) | No |
| Held carts | `use-pos-active-carts.ts` / held-sales dialog | No |
| Recovery | `pos-cart-snapshot.ts` | No |
| Interaction mode | `pos-interaction-policy.ts` / `data-interaction-mode` on shell root | No |

PR-1 changed zero state ownership. The only edits are string labels read by
already-existing, already-wired UI elements.

## F. Terminology

| Location | Old wording | New wording | Why this one was in scope |
|---|---|---|---|
| Topbar session-number badge (`pos.session`) | "Shift" / "الوردية" | "Session" / "الجلسة" | The badge displays `session.number` — the POS Session's own number — not a work-shift identifier. Labeling it "Shift" was factually wrong. |
| Topbar session-management button/menu item (`pos.manage_shift` → `pos.manage_session`) | "Manage shift" / "إدارة الوردية" | "Session Management" / "إدارة الجلسة" | The button opens the existing close/reconcile dialog for the active POS Session (`closeOpen` in `page.tsx`), not a Shift-management screen. |

**Explicitly NOT changed** (legitimate Shift wording, left as-is):
- `pos.open_to_start`: "Open a shift by entering the opening cash balance to
  start selling." / "افتح وردية بإدخال الرصيد النقدي الافتتاحي للبدء في
  البيع." — this correctly describes the real Device + Shift + opening
  balance precondition for Start Selling (Section 9's own model: Shift and
  POS Session are separate concepts, and this string is genuinely about the
  Shift precondition, not the Session).
- `posSessions.manage_session` ("Manage open session" / "إدارة الجلسة
  المفتوحة") on `/pos/sessions/[id]` — already correct, untouched.
- Any HR/organizational Shift screen (`/pos/settings/shifts`) — untouched,
  out of scope, and a legitimate use of "Shift".

No broad search-and-replace was performed; only the two keys whose actual
call sites label a POS Session were touched, confirmed by grep to have no
other consumers before editing.

## G. Safety Verification

- **Tenant Isolation**: not applicable — no data-fetching, query, or API call
  was touched. Change is limited to static translation strings and label text.
- **Branch Isolation**: not applicable, same reason.
- **Permissions**: not applicable — `cashDrawerDisabled`, `exchangeDisabled`,
  `warehouseDisabled` and all other gating props/logic in `page.tsx` are
  byte-for-byte unchanged.
- **Financial side effects**: none. The changed button (`onManageSession`)
  still calls the exact same handler
  (`session ? (setCountedBal(''), setSessionError(null), setCloseOpen(true)) : router.push('/dashboard')`)
  as before — only the visible label text changed. No checkout, invoice,
  payment, return, exchange, inventory mutation, Cash In/Out, or POS Session
  open/close call was added, removed, or reordered.
- **R1–R6**: none of R1 (server product/tax authority), R2 (historical UOM),
  R3 (branch invoice isolation), R4 (return/exchange idempotency), R5
  (server-authoritative receipt), or R6 (customer eligibility) code paths were
  touched — this PR does not modify `PosController`, `PosService`,
  `InvoiceResource`, or any return/exchange/checkout logic.
- **Cart/session preservation**: confirmed by inspection — the changed button
  only opens/does not open the same dialog as before; it performs no cart,
  customer, session, or device mutation itself.
- **Start Selling preservation**: untouched. `pos-workspace.ts` and
  `pos-workspace.test.ts` (both already enforcing every invariant in Section 9)
  are unmodified and still pass.
- **Barcode/UOM preservation**: untouched — no file under
  `components/pos/interactions/` or `lib/pos-barcode.ts` was modified.

## H. Tests

```
npx vitest run src/components/pos/pos-topbar.test.tsx src/lib/__tests__/pos-workspace.test.ts
```
**Result: 2 test files, 11 tests passed.** (4 in `pos-topbar.test.tsx`
including the new terminology test; 7 in `pos-workspace.test.ts`, all
pre-existing and unmodified.)

```
npx vitest run src/components/pos src/lib/__tests__/pos-workspace.test.ts src/lib/pos-receipt.test.ts "src/app/(pos)"
```
**Result: 26 test files, 121 tests passed.** — broader POS-directly-related
regression (interaction modules, shortcuts, receipt building, active carts,
etc.), all green.

```
npx vitest run
```
**Result: 224 test files, 1417 tests passed** (full frontend suite; 1416
pre-existing + 1 new). Zero failures, zero skipped beyond pre-existing state.

Backend: no backend file was changed in this PR, so no backend test run was
required per the mission's own instruction ("do not modify backend code
merely to make PR-1 tests easier" — inversely, no backend change means no
backend regression risk to verify here). The repository's CI still runs the
full PHP suite on every push, unaffected by this PR's diff.

## I. Build

```
npm run build
```
**Result: exit code 0.** Production build compiled successfully; no new
type errors, no new warnings attributable to this change.

## J. UI Verification

**Automated** (via the test runs above, using `jsdom` + Testing Library):
- The "Session Management" button renders with the correct accessible name
  and the old "Manage shift" wording is absent (`pos-topbar.test.tsx`, new
  test).
- The session badge exposes the corrected title/text ("الجلسة") via
  `getByTitle`.
- Existing automated coverage for Return-to-ERP guard behavior, mobile
  overflow menu callbacks (recent invoices, held), and Start Selling
  tab-opening invariants all continue to pass unmodified.

**Manual**: not performed in this session (no browser/visual pass was run
against a live server). The change is a two-string label swap read through
`next-intl` in a component with existing, passing render tests for both
Arabic (RTL) and the same component tree under light/dark (the topbar itself
carries no new conditional class, icon, or layout change — only text content
sourced from the already-locale-aware `useTranslations('pos')` hook — so RTL/
LTR and light/dark rendering paths are structurally unchanged from before this
PR). Distinguishing explicitly: **RTL/LTR, light/dark, desktop/mobile,
keyboard, and touch behavior were not re-verified manually in a browser for
this PR** — only via the automated component tests above, which exercise the
same DOM the browser would render. No claim of manual verification is made
beyond that.

## K. Deferred V2 Scope

Explicitly not started in this PR:
- Product/Category V2 (PR-2)
- Wider Cart, Selected Line, numeric keypad (PR-3)
- Invoice Center / Receipt Preview V2 (PR-4)
- Payment Workspace (PR-5)
- Returns/Exchanges V2 (PR-6)
- Session Operations V2 (PR-7)
- Hardware/production hardening (PR-8+)

## L. Risks / Remaining Issues

- None identified. The change is a two-key translation fix plus its call
  sites and one new test; there is no hidden TODO, no partially-wired prop,
  and no follow-up required for this specific fix to be complete.
- As noted in §J, no live-browser manual pass was performed this session;
  if the team wants an explicit human visual sign-off on the Arabic/English
  label change before merging, that remains outstanding (not a defect, just
  unperformed manual QA).

## M. Git Metadata

- Repository: `safwan5001-source/Nebrax`
- Branch: `claude/pos-v2-pr1-workspace-foundation`
- Base SHA: `f1eef8e80adfb926f14ca79bd4b173dc7cea7388`
- Head SHA: `8652554`
- Draft PR: #653 — https://github.com/safwan5001-source/Nebrax/pull/653

## N. Recommended Next Step

Proceed to PR-2 (Product/Category) only after a human reviewer confirms the
Arabic/English "Session Management" wording reads correctly in context on a
live POS screen — this PR's change is small enough that the Draft PR diff
itself should be sufficient for that review without further automated work.
