# AWJ POS V2 — PR-6: Returns & Exchanges

## Summary

**This is an integration PR, not a new-feature PR.** Existing-first inspection found that
the POS Return/Exchange **engine and UI already existed in full** — `PosReturnService` /
`PosExchangeService` (backend, complete with idempotency, historical-UOM protection, cash-
refund and exchange-surplus policy), `PosReturnDialog` / `PosExchangeDialog` (frontend,
complete: invoice picker, quantity controls capped at remaining, live server quote, cash-
block reasoning, tender collection for exchange, idempotency-key reuse across retry) — all
already merged, already tested (29 backend Feature tests across 3 suites), and already wired
into the POS topbar dropdown.

**The one real, concrete gap** relative to the mission's required cashier journey ("Invoice
Center → select invoice → Invoice Details → **explicitly** Start Return / Exchange") was that
the dialogs were invoice-agnostic: opening either from the topbar always started at the
invoice picker, with no way to jump directly into a return/exchange for the invoice the
cashier is *already looking at* in Invoice Details. This PR closes exactly that gap — nothing
more — by:

1. Adding two new optional props to both dialogs (`preselectedInvoiceId`) that, once the
   dialog's own existing invoice-list fetch resolves, auto-select the matching invoice via
   the dialog's own existing `chooseInvoice()` — reusing 100% of the existing fetch/quote/
   submit logic, adding zero new API calls or new logic paths.
2. Adding two explicit buttons to `PosInvoiceDetails` — "بدء مرتجع" (Start return) / "بدء
   استبدال" (Start exchange) — gated on `invoice.status === 'posted'` (same gate as the
   existing Receipt Preview action), with Start Exchange additionally gated on an active
   cart (same condition already used to disable the topbar's Exchange item).
3. Wiring these through `pos/page.tsx` with two new preselect-id state variables, cleared on
   dialog close so a later topbar-triggered open doesn't carry a stale preselection.

No backend file was changed. No new API endpoint. No new database table/column. No
accounting/tax/inventory/ZATCA logic was touched.

## Existing-first findings

| Requirement area (from mission) | Classification | Evidence |
|---|---|---|
| Return quote/execute, quantity-safety, idempotency | EXISTING_AND_SUFFICIENT | `PosReturnService::quote/create`, `PosReturnTest`, `PosReturnUomTest`, `PosReturnExchangeIdempotencyTest` — 29 tests, all still passing |
| Exchange settlement (surplus/due), tender collection | EXISTING_AND_SUFFICIENT | `PosExchangeService::quote/create`, `PosExchangeDialog`'s existing tender grid |
| Historical UOM protection | EXISTING_AND_SUFFICIENT | `ReturnService::returnLineBaseQuantity()` uses the invoice line's frozen `unit_factor`, never a client-supplied value; `PosReturnUomTest` (6 tests) covers factor=1 and factor>1, partial/multi-partial |
| Cash-refund policy / exchange-surplus policy truthfulness | EXISTING_AND_SUFFICIENT | Both dialogs already render the server's `cash_block_reason`/`exchange_surplus_policy` verbatim, disable the blocked option, never invent a value |
| Durable idempotency (retry-safe) | EXISTING_AND_SUFFICIENT | `PosCheckoutAttemptController` reused as-is by both dialogs; server-side `PosReturnAttempt`/`PosExchangeAttempt` unique-key + checksum + 409-on-mismatch already covered by 13 backend tests |
| Tenant/branch/session isolation | EXISTING_AND_SUFFICIENT | `assertSourceMatchesSession` (posted, same session, same branch, same warehouse) — `PosReturnTest::it_rejects_a_return_from_another_open_pos_session_before_writing_any_document` |
| **Invoice Center/Details → explicit Start Return/Exchange** | **REAL_GAP → CLOSED THIS PR** | No hook point existed (`onStartReturn`/`onStartExchange`/preselect prop); added in this PR — see below |
| Reason/approval controls when required | **DEFERRED** (see below) | No frontend approval-request UI exists anywhere in POS today (not returns-specific) |
| Frontend component tests for the two dialogs | **DEFERRED** (test-infra limitation, see below) | Verified via direct reproduction on the *unmodified* base files |

## What was already present

- `PosReturnDialog` (225 lines) and `PosExchangeDialog` (206 lines), both fully functional,
  wired into `PosTopbar`'s dropdown (`onReturn`/`onExchange`), rendered in `pos/page.tsx`.
- Complete backend contracts: `GET /pos/returnable-invoices`, `GET
  /pos/returnable-invoices/{id}`, `POST /pos/returns/quote`, `POST /pos/returns`, `POST
  /pos/exchanges/quote`, `POST /pos/exchanges` — all gated by `invoices.manage` permission +
  `sales.pos` application-active middleware, all tenant/branch/session-scoped.
- Full i18n (`ar.json`/`en.json`), no missing translation keys.

## What was actually changed

1. **`pos-return-dialog.tsx`** — added optional `preselectedInvoiceId` prop. After the
   existing invoice-list fetch resolves, if this id matches an invoice in the list, the
   dialog calls its own existing `chooseInvoice()` automatically — same code path as a
   cashier clicking that invoice manually. If the id isn't found (e.g., invoice outside the
   current session), the dialog falls back to its normal picker — no error, no dead end.
2. **`pos-exchange-dialog.tsx`** — identical pattern, same prop name.
3. **`pos-invoice-details.tsx`** — two new optional props, `onStartReturn` and
   `onStartExchange` (plus `canStartExchange`), rendered as two new outline buttons next to
   the existing Receipt Preview action, only when `invoice.status === 'posted'`. Both props
   are optional and default to not rendering the buttons at all — any other caller of this
   component (none exist today outside `pos/page.tsx`) is unaffected.
4. **`pos/page.tsx`** — two new state variables (`returnPreselectId`/`exchangePreselectId`),
   a shared `canExchangeNow` boolean (replacing the duplicated inline expression previously
   only used for the topbar's `exchangeDisabled`, now reused for the Invoice Details button
   too), and wiring for the new callbacks/props. The preselect id is cleared on dialog close
   so the *next* open (e.g., from the topbar) doesn't carry a stale invoice.
5. **`messages/{en,ar}.json`** — 2 new keys: `invoice_details_start_return`,
   `invoice_details_start_exchange`.

## Files changed

- `web/src/components/pos/pos-return-dialog.tsx`
- `web/src/components/pos/pos-exchange-dialog.tsx`
- `web/src/components/pos/pos-invoice-details.tsx`
- `web/src/app/(pos)/pos/page.tsx`
- `web/src/messages/en.json`
- `web/src/messages/ar.json`

## Backend contracts reused (verbatim, unmodified)

- `PosReturnService::quote(array $data, User $actor): array`
- `PosReturnService::create(array $data, User $actor): ReturnDocument`
- `PosExchangeService::quote(array $data, User $actor): array`
- `PosExchangeService::create(array $data, User $actor): array`
- Routes: `GET pos/returnable-invoices`, `GET pos/returnable-invoices/{id}`, `POST
  pos/returns/quote`, `POST pos/returns`, `POST pos/exchanges/quote`, `POST pos/exchanges`.

## Backend changes

**None.** `app/Services/Accounting/PosReturnService.php`,
`app/Services/Accounting/PosExchangeService.php`, `app/Http/Controllers/Api/PosController.php`,
and all related FormRequests were read for reference only.

## Accounting/inventory/tax impact

None. This PR only adds a UI shortcut to already-existing, already-authoritative backend
operations. Every return/exchange in this PR's browser QA was posted through the exact same
`PosReturnService`/`PosExchangeService` code path as before — verified by a real posted
return (`SRET-2026-00001`) and a real exchange settlement quote, both against real seeded
invoices.

## Tenant/Branch/permission review

Unchanged. The preselect mechanism does not bypass any check: the dialog still fetches
`/pos/returnable-invoices` (session/tenant/branch-scoped) and only auto-selects an invoice
**already present in that scoped list** — an invoice id from another tenant, branch, or POS
session simply won't match anything in the fetched list, and the dialog falls back to the
normal picker (empty auto-select, no error, no information disclosure). No new invoice is
ever fetched or exposed by id alone; the existing `GET /pos/returnable-invoices/{id}` call
(itself already session-scoped, per `assertSourceMatchesSession`) is the same one the picker
flow already uses.

## Idempotency review

Unchanged — both dialogs still use `PosCheckoutAttemptController` exactly as before. The
preselect flow does not create any new request path; `chooseInvoice()` (which resets the
attempt controller for a new invoice, exactly as it did for a manually clicked invoice) is
the same function called either way.

## Historical-UOM review

Unchanged — not touched by this PR. Confirmed still fully covered by `PosReturnUomTest` (6
tests, all passing after this PR, since no backend/UOM-related file was touched).

## Tests and exact results

| Scope | Command | Result |
|---|---|---|
| Broader POS frontend | `npx vitest run src/components/pos src/lib/__tests__ "src/app/(app)/pos" "src/app/(pos)"` | 74 files / 406 tests passed (identical to PR-5 baseline) |
| Full frontend suite | `npx vitest run` | 231 files / 1484 tests passed (identical to baseline, 0 regressions) |
| `npm run build` | — | exit 0, "✓ Compiled successfully" |
| Backend: Return/Exchange/Idempotency/UOM | `php artisan test --filter="PosReturnTest\|PosReturnUomTest\|PosReturnExchangeIdempotencyTest"` | 29/29 passed (387 assertions) — unchanged since no backend file was touched |

### Frontend component tests for the two dialogs — DEFERRED (documented, not silently skipped)

A genuine, pre-existing limitation in this repository's test environment was discovered and
directly reproduced: rendering `PosReturnDialog` (or `PosExchangeDialog`) with `open=true`
and a non-null `sessionId` — which triggers the component's existing `useEffect` that calls
`api(...)` on mount — hangs the Vitest/jsdom test runner indefinitely (confirmed via `ps`
showing a runaway worker process, and via file-based tracing that never reached a single
checkpoint inside the test body). This was verified to be **pre-existing, not something this
PR introduced**: the exact same hang reproduces on the *unmodified* base version of
`pos-return-dialog.tsx` (confirmed via `git stash` to temporarily revert this PR's two-line
diff to that file, re-running the identical trace test, and observing the identical hang,
then restoring the change via `git stash pop`). Consistent with this, **no test file for
either dialog, nor for `PosInvoiceDetails` itself, existed anywhere in the repository before
this PR** — this exact component-mounts-and-immediately-fetches pattern appears to have never
been unit-tested in the POS module. No test was weakened, deleted, or skipped to obtain green
CI — none existed to weaken. Given the size of the actual code change (two small, additive,
optional props), and that real backend behavior is already covered by 29 Feature tests, this
was verified instead via real browser QA (below) rather than sunk further into diagnosing a
test-infrastructure issue outside this PR's scope. Flagged as a candidate for a follow-up
investigation (see Deferred items).

## Build result

`npm run build` — exit code 0, "✓ Compiled successfully in 44s," no new warnings.

## Browser QA matrix

All captured via pinned Chromium (`/opt/pw-browsers/chromium`) through Playwright, against a
real seeded tenant with two real posted POS invoices (`INV-2026-00001`, 3 lines/460.00 SAR;
`INV-2026-00002`, 1 line/17.25 SAR), driving the actual Next.js dev server with
localStorage-injected auth — no mocked UI, no mocked backend.

| # | Scenario | Result |
|---|---|---|
| A | Desktop RTL — Invoice Details shows both new buttons; Start Exchange correctly disabled (no active cart) | Pass (`A-invoice-details-with-return-exchange-buttons.png`) |
| B | Start Return from Invoice Details → dialog opens **directly** to the preselected invoice's line list (picker skipped) → quantity increase triggers a fresh server quote → 4 forced clicks past the remaining-quantity cap are absorbed without exceeding it (quantity stayed at 3, matching `remaining`) → real submit → real posted return `SRET-2026-00001` with a session-linked confirmation toast | Pass (`B-return-dialog-preselected-invoice.png`, `B-return-dialog-quote-loaded.png`, `B-return-dialog-quantity-clamped.png`, `B-return-success.png`) |
| C | Dark mode — return dialog (second invoice) | Pass, correct contrast (`C-return-dialog-dark.png`) |
| D | Desktop LTR — Invoice Details + return dialog, English labels/mirrored layout | Pass (`D-invoice-details-ltr.png`, `D-return-dialog-ltr.png`) |
| E | Start Exchange from Invoice Details with an active cart item → preselected invoice → **live evidence of the earlier B-scenario return already reflected** (قهوة عربية line correctly shows "مُرتجع بالكامل" / fully returned, remaining 0, because that return was really posted against this same invoice earlier in this QA run) → quote shows correct return/replacement/surplus math and truthfully states the surplus policy is customer-credit-only | Pass (`E-exchange-dialog-preselected.png`, `E-exchange-quote-settlement.png`) |
| F | Mobile RTL — Invoice Details (both buttons visible, no clipping) and the return dialog (no overflow) | Pass, `document.documentElement.scrollWidth === clientWidth` confirmed `false` in both (`F-mobile-invoice-details.png`, `F-mobile-return-dialog.png`) |

**Functional/quantity-safety verification (from scenario B):** partial return of a multi-line
invoice, quantity clamp at remaining (verified by deliberately forcing clicks past the cap),
live re-quote on every quantity change, real posted return linked to the active cashier
session. **Cross-scenario data integrity** (scenario E): the return posted in B is correctly
reflected as already-returned when the same invoice is opened again minutes later in a fresh
browser context — proof this is real server state, not a client-side illusion.

## Known risks

- The pre-existing test-environment hang (see above) means no automated regression coverage
  exists for `PosReturnDialog`/`PosExchangeDialog`/`PosInvoiceDetails` beyond what real
  browser QA in this report captured. A future session with time to invest in root-causing
  the jsdom/Vitest hang (candidates: React 18 + jsdom's `MessageChannel`/microtask scheduling
  interaction with this repo's specific Vitest/testing-library version pins, or an
  environment-specific `fetch`/network-timer issue in this sandbox) would let these
  components gain real unit coverage.
- The exchange-surplus and cash-refund policy strings shown to the cashier are the server's
  own Arabic messages passed through verbatim (`quote.cash_block_reason`,
  `exchange_surplus_policy`) — this is correct/intended (no invented wording), but means any
  future backend wording change flows straight to the UI without a translation-key
  indirection layer. Pre-existing behavior, not introduced by this PR.

## Deferred items

- **Reason/approval controls for returns when a tenant's loss-prevention policy requires
  them** (`PosSettings::auditOperationPolicy('refund')` can be configured to
  `approval_required`, in which case the backend throws "هذه العملية تحتاج اعتماداً مسجلاً
  قبل تنفيذها" — a real, correctly-enforced server-side gate). **Deferred, not silently
  dropped**, for three concrete reasons: (1) the *default* policy for `'refund'` is
  `AUDIT_POLICY_ALLOWED` — most tenants are unaffected; (2) a direct grep across the entire
  POS frontend confirms **no approval-request UI exists anywhere in POS today**, for *any*
  override operation (not just returns) — building one from scratch would be a cross-cutting
  feature (affecting `cash_recount` and any future policy-gated operation identically), not a
  returns-specific fix, and doing it properly (request → pending-approval state → a second
  authorized user approves → consume) is a materially larger scope than this integration PR;
  (3) per the mission's own stop-condition guidance, a materially new workflow/architecture
  addition should be flagged rather than silently built into an unrelated PR. **Risk**: a
  tenant that opts into `approval_required` for refunds today will see the existing generic
  error message surfaced (the dialogs already display `err.message` from any `ApiError`
  correctly — this is not a crash or a silent failure) but has no in-app way to obtain or
  submit an approval. **Target**: a dedicated cross-cutting PR for POS override-approval UI,
  benefiting returns, cash-recount, and any future policy-gated operation uniformly.
- **Component-level render tests for `PosReturnDialog`/`PosExchangeDialog`/
  `PosInvoiceDetails`** — deferred pending a root-cause fix for the test-environment hang
  documented above. **Risk**: regressions to these components would only be caught by manual
  or browser-automation QA, not CI. **Target**: a focused test-infrastructure investigation,
  ideally bundled with whichever future PR next touches these files.

## Branch

`claude/pos-v2-pr6-returns-exchanges`

## PR number/link

Recorded after push (see final chat reply). Draft.

## Base SHA

`b6ff1c5bb592fdbc09785717ad4c9a3d1b6ffbdd` (`main`, confirmed to contain the PR-5 merge
commit `eed979d`, via `git fetch && git log` before branching).

## Head SHA

Recorded after commit (see final chat reply).

## Recommended next step

ChatGPT/owner review of this PR → CI → explicit authorization to proceed to Gate 2 (PR-7,
Session Operations). Do not start PR-7 until authorized. No merge, deploy, or release has
been performed.
