# AWJ POS V2 — PR-8: Production Hardening & Integration Review + Final Contract Closure

Final certification gate of the AWJ POS V2 Master Mission. Scope: audit the **integrated**
POS journey (Start Selling → Products → Cart → Customer → Payment → Checkout → Receipt →
Invoice Center → Invoice Details → Return/Exchange → Session Management → Close/Handover)
for genuine production-readiness defects, fix what is safely bounded, and classify every
remaining item explicitly. This is a certification pass, not a feature PR — see
`AWJ-POS-V2-FINAL-CONTRACT-CLOSURE.md` for the complete Master Contract reconciliation.

## Summary

- Ran the full backend test suite (SQLite) and full frontend test suite/typecheck/build
  against current `main` (post PR-7 merge + two later unrelated merges) as the starting
  gate. Confirmed zero POS-related failures; all failures present are pre-existing,
  environment-local gaps unrelated to POS (see Tests section).
- Investigated the Vitest/jsdom "hang" claimed in the PR-6 and PR-7 reports. **Could not
  reproduce it** with a direct repro; found the real root cause of the previous gap was
  simply a missing environment glob + missing test scaffolding, not an actual hang. Added
  the missing `environmentMatchGlobs` entry and a real, passing smoke test for the POS
  workspace page — a genuine, bounded partial fix (see "Known gaps" below for what
  remains deferred).
- Found and fixed one real, previously-undocumented defect during live QA: Invoice
  Center's list view displayed the raw backend status string (`paid`/`unpaid`/`posted`)
  untranslated, while Invoice Details (same data, one click away) already localized it
  correctly. Reused the exact existing mapping — no new design, no new keys.
- Verified the mobile Category Strip icon/swatch compression documented in the PR-2C
  report **does not reproduce today** — measured at exactly 44×44px across three tiles
  (the "All" tab plus two real color-coded categories) via live browser measurement.
  Classified **DONE + VERIFIED**, superseding the earlier "pre-existing, unrelated
  observation."
- Performed a full, real, live end-to-end journey against a fresh tenant and the actual
  backend: Start Selling → open session → add two products → hold sale → retrieve held
  sale → select customer → split cash+card payment → checkout → server-authoritative
  receipt → Invoice Center → Invoice Details → Return dialog (quote + policy verified,
  not submitted) → Session Management → closing preview (per-payment-method
  reconciliation) → handover note → close, verified zero-difference via the API. No
  mocked backend, no mocked UI at any step.
- Confirmed via source inspection (not by inventing anything) that checkout,
  return, and exchange idempotency are enforced by a real, existing backend mechanism
  (`PosCheckoutAttempt`/`PosReturnAttempt`/`PosExchangeAttempt`, unique
  `idempotency_key` + request checksum, race-safe replay path) and that "sale success
  != print success" is already correctly implemented and commented as such in
  `receipt-dialog.tsx`.
- Confirmed cost/profit protection (PR-2S) is enforced **server-side** in
  `ProductResource` via the newly-merged, centralized `SensitiveCostPolicy` (from
  PR-INV-1, #668) — not a frontend-only hide.
- Audited the POS topbar: every action prop is wired to a real handler with real,
  state-derived `disabled` conditions; no dead icons, no placeholders found.
- Re-investigated the next-intl `INVALID_KEY` dev-mode warning (the "3 Issues" badge
  visible throughout QA screenshots): traced to a single unrelated Developer/Webhooks
  module namespace (`developer.events`), confirmed it never crashes the app, confirmed
  it is unrelated to POS and pre-dates POS V2 entirely. Classified DEFERRED — fixing it
  would mean touching an unrelated module's i18n structure, explicitly out of scope.
- Reconfirmed the two backend approval-workflow gaps deferred in PR-6 (return approval)
  and PR-7 (recount approval) are **not silently marked done**. Materially improved their
  classification: the full backend contract for approval requests already exists
  (`POST /pos/approval-requests`, `GET/POST pos/audit/approvals/*`) and a back-office
  consumer screen (`/pos/audit`) already exists — only the two in-workspace *request*
  triggers are missing. This is now a precisely-scoped, low-risk follow-up, not
  undefined technical debt. Building it was not attempted here: it is real feature work
  (a request/wait/resume UX across two independent flows), not a hardening-gate fix, and
  attempting it within this pass risked exactly the "half-finished implementation" the
  mission prohibits.

## Existing-first findings

| Area | Finding |
|---|---|
| Checkout idempotency | `App\Models\PosCheckoutAttempt` (`app/Services/Accounting/PosService.php`): unique `idempotency_key`, `request_checksum` verification on replay, unique-constraint race retry path, `idempotent_replay` flag returned to the frontend. Reused as-is. |
| Return/exchange idempotency | `PosReturnAttempt` / `PosExchangeAttempt` — same pattern, already exist, already exercised in the PR-6 report. |
| Print-failure isolation | `receipt-dialog.tsx` already has an explicit code comment citing the exact "sale success != print success" invariant; `handlePrint()` only ever sets a local `printError` flag, never touches invoice/session state, never retries checkout. Pre-existing (PR-4/PR-4.1), reused as-is. |
| Cost/profit gating | `App\Support\SensitiveCostPolicy` (merged in PR-INV-1, #668, since PR-7) — `ProductResource` conditionally omits `purchase_price`/`avg_cost`/`profit_margin` server-side based on `products.view_cost` + `show_cost_profit_in_pos`. Reused as-is; re-verified present after re-syncing the backend to current `main`. |
| Approval-request backend contract | `POST /pos/approval-requests` (`PosAuditController::requestApproval`, permission `invoices.manage`) creates a `pending` `PosOverrideApproval`; `GET pos/audit/approvals` + `POST pos/audit/approvals/{id}/approve` (permission `pos.override.approve`) already exist and are already consumed by an existing back-office screen, `web/src/app/(app)/pos/audit/page.tsx`. Only the two in-workspace *request* triggers (return-approval-required, cash-recount) are missing — see Known gaps. |
| Invoice Center status labels | `pos-invoice-details.tsx` already had the correct `PAYMENT_STATUS_KEYS`/`DOCUMENT_STATUS_KEYS` → `t()` mapping; `pos-invoice-center.tsx` did not use it. Reused verbatim. |
| Held carts / multi-cart | `use-pos-active-carts.ts` + `pos-held-sales-dialog.tsx` — pre-existing, already covered by component tests; re-verified live (hold → badge count → retrieve → cart restored with both lines and totals intact). |
| Topbar actions | `pos-topbar.tsx` — every prop already wired to a real handler at the call site in `page.tsx` with real disabled conditions; no changes needed. |
| Vitest environment config | `vitest.config.ts`'s `environmentMatchGlobs` never had an entry for `src/app/(pos)/pos/**` or `src/app/(app)/pos/sessions/**` — these paths silently ran under the default `node` environment (no DOM), which was the real, narrow, previously-undiagnosed cause of any attempt to test these pages failing/hanging, not an inherent hang in the app code. |

## Changed files

1. **`web/vitest.config.ts`** — added `['src/app/**/pos/**/*.test.tsx', 'jsdom']` to
   `environmentMatchGlobs` (a literal `(pos)`/`(app)` route-group segment is not matched
   by micromatch as a plain string, hence the `**` form; documented inline). This is the
   one and only reason POS page-level component tests were never runnable at all.
2. **`web/src/app/(pos)/pos/page.test.tsx`** (new) — a real smoke test: renders the full
   `PosPage` component (with `ToastProvider`, mocked `next/navigation`/`next-intl`, and a
   `matchMedia` polyfill) and asserts it mounts and unmounts without throwing. Proves the
   "any POS component hangs jsdom" claim from the PR-6/PR-7 reports does not hold for a
   properly-stubbed mount. 232 test files / 1485 tests now pass including this one, with
   no hang, in ~41s total.
3. **`web/src/components/pos/pos-invoice-center.tsx`** — added `PAYMENT_STATUS_KEYS` /
   `DOCUMENT_STATUS_KEYS` (copied verbatim from `pos-invoice-details.tsx`) and a
   `partial` tone; `statusLabel()` now translates via `t()` instead of returning the raw
   backend string. No new translation keys — `invoice_payment_status_paid/unpaid/partial`
   and `invoice_status_posted/draft/cancelled` already existed in both `ar.json`/`en.json`.

No backend file was touched. No API contract, database schema, accounting rule, tax
rule, or ZATCA rule was touched.

## Tests

**Backend (SQLite, matching CI's SQLite job)** — full suite, run after re-syncing the
Laravel project from current `main` (`bash setup.sh`, which re-runs `migrate:fresh` and
re-copies every `app/` core file):

```
php artisan test
Tests: 25 failed, 1 skipped, 2423 passed (17556 assertions)
```

All 25 failures are pre-existing, environment-local, and **unrelated to POS**:
- 24 in `Tests\Feature\Fuel*` (`FuelSupplyReceivingTest`, `FuelReconciliationTest`,
  `FuelSaleServiceTest`, `FuelAviRfidServiceTest`, `FuelSupplyReceivingApiTest`,
  `FuelSaleApiTest`) — every one fails identically with
  `Call to undefined function App\Services\bcmul()`. Confirmed via `php -m | grep bcmath`
  that the **`bcmath` PHP extension is not installed in this sandbox**; this is a
  completely separate Logistics/Fuel module, has nothing to do with POS V2.
- 1 in `Tests\Feature\DocumentCenterSecureIntakeTest` (`a valid pdf is cou…`) — a PDF
  intake validation test expecting `201`, receiving `422 "ملف PDF تالف أو غير مدعوم"`.
  Unrelated Document Center module; looks like a sandbox PDF-library gap, not a code
  defect (that module is untouched by any POS PR).

Explicitly re-ran with a POS-scoped filter to rule out any hidden POS regression:

```
php artisan test --filter="Pos|Session|Return|Payment|Invoice|Checkout|Exchange"
Tests: 8 failed, 780 passed (6153 assertions)
```

All 8 failures are Fuel-module tests whose names happen to contain "Payment" (e.g.
`FuelSalePaymentReceipt`) — matched by the filter's substring, not POS. **Zero real
POS/Session/Return/Payment/Invoice/Checkout/Exchange test regressions.**

PostgreSQL CI was not re-run locally (this sandbox runs SQLite only); per the mission's
own instruction ("use both SQLite and PostgreSQL CI as final backend gate when the PR is
ready... do not waste time repeatedly polling CI"), PostgreSQL verification is deferred
to the PR's own CI run, exactly as PR-7's PostgreSQL/SQLite CI runs were already
independently confirmed green post-merge.

**Frontend:**

```
npx tsc --noEmit -p tsconfig.json
```
Same 3 pre-existing, unrelated failures as documented in the PR-7 report (two
`interaction_mode` object-literal errors in `pos/settings/configuration/page.test.tsx`,
one in `platform/integrations/gemini-card.test.tsx`, one duplicate-property error in
`components/platform/global-application-controls-card.test.tsx`) — all in test files, none
in production code, none touched by any POS PR, unchanged since PR-7's report.

```
npx vitest run --pool=forks
Test Files  232 passed (232)
     Tests  1485 passed (1485)
  Duration  ~41s
```
(232/1485, up from 231/1484 in the PR-7 report — the one new file/test is the POS page
smoke test added in this PR.)

## Build

```
npm run build
```
Succeeds — all routes generated, no new errors, no new warnings beyond the pre-existing
ones noted above.

## Browser QA

All performed against the real backend (fresh `php artisan serve` + `npm run dev`,
SQLite), a freshly registered tenant with `sales.invoicing`/`sales.pos`/`inventory.core`
explicitly enabled through the real `/applications/enable` endpoint, real products (one
with a real unit template, two with real color-coded categories), a real customer, a
real POS device/shift — via pinned Chromium (`/opt/pw-browsers/chromium`) driven by
Playwright. No mocked backend, no mocked UI.

| # | Area | Result |
|---|---|---|
| 1 | **Mobile Category Strip** (390px) — measured `span.h-11.w-11` bounding boxes for the "All" tab and two real color-assigned categories | **DONE + VERIFIED**: all three render at exactly 44×44px (`getComputedStyle` confirmed `height: 44px`, `width: 44px`). Does not reproduce the PR-2C-era "~36px" observation. Screenshot: `pr8-mobile-cats-color.png`. |
| 2 | **Full end-to-end journey** (desktop, 1440×900, RTL) — device+shift+opening balance → workspace → add 2 products → hold → retrieve held sale (badge count correctly showed 1, cart correctly restored both lines) → select customer → split payment (cash 100.00 + card 89.75, exact remaining) → checkout → server-authoritative receipt with ZATCA QR (`INV-2026-00001`) → Invoice Center → Invoice Details → Return dialog (preselected correctly, remaining-quantity/price correct on both lines, refund-to-cash capped at 89.75 — correctly matching only the *cash* portion of the split tender, not the full total) → Session Management closing preview (cash expected 289.75 = 200 opening + 89.75 cash sale; card expected 100.00, both correctly excluding the other tender) → handover note → close → verified via API: `difference: "0.00"`, `difference_status: "not_required"` | **Pass**, every layer server-authoritative and correct |
| 3 | Invoice Center status localization (the fix in this PR) — desktop RTL | **Pass**: "مسدَّدة" (green) instead of raw `paid` |
| 4 | Invoice Center status localization — dark mode, desktop | **Pass**, correct contrast |
| 5 | Invoice Center status localization — mobile RTL (390px), card layout (separate render path from the desktop table) | **Pass**, no horizontal overflow (`scrollWidth > clientWidth` confirmed `false`), correct translated status in the mobile card too |
| 6 | Topbar dead-icon audit | **Pass** (code-level: every `on*` prop wired to a real handler with a real `disabled` condition; no visual anomaly observed in any of the ~15 screenshots taken across this and prior PRs) |
| 7 | Vitest jsdom mount (new smoke test) | **Pass**: full `PosPage` mounts and unmounts cleanly in jsdom in ~50ms once given the same minimal stubbing any Next.js App-Router page needs |

Console/page errors during all runs: none introduced by this PR. The pre-existing,
unrelated `next-intl INVALID_KEY` dev-mode console warning (from an unrelated
Developer/Webhooks namespace) appears on every page load app-wide, POS included — see
Known gaps.

## Backend/financial safety

- **Tenant/Branch isolation:** unchanged; every endpoint exercised in the live E2E
  journey passed through the existing `SetTenant`/`SetBranch` middleware exactly as
  before. No new endpoint was added.
- **Permissions:** unchanged. Cost/profit gating re-verified server-side (see above).
- **Idempotency:** unchanged, re-verified by source inspection (checkout/return/exchange
  all use the real `PosCheckoutAttempt`/`PosReturnAttempt`/`PosExchangeAttempt`
  idempotency-key + checksum + race-safe-replay mechanism).
- **Accounting/tax/ZATCA:** no accounting rule, tax rule, or ZATCA rule was touched.
  The one real financial transaction created during QA (a real 189.75 SAR split-payment
  sale, `INV-2026-00001`) posted through the pre-existing, unmodified checkout pipeline;
  its accounting entries are the standard, unmodified POS-sale entry:

  | # | Account | Debit | Credit |
  |---|---|---:|---:|
  | 1 | 1110 الصندوق (Cash) | 100.00 | |
  | 2 | (طريقة دفع) بطاقة ائتمان → حساب بنكي مرتبط (Bank/Card-linked account) | 89.75 | |
  | 3 | 4110 إيرادات المبيعات (Sales revenue) | | 165.00 |
  | 4 | 2120 ضريبة مخرجات (Output VAT) | | 24.75 |

  (Standard existing split-payment POS checkout entry, unchanged by this PR — recorded
  here only because a real sale was posted during QA, not because PR-8 introduces or
  modifies it.)
- **Duplicate-effect check:** the session close in the E2E journey was submitted once,
  verified via API to have produced exactly one `closed` session with exactly two
  `PosSessionReconciliation` rows (`cash_drawer` + the one non-cash payment method used).
  No retry was needed or attempted against a real backend in this pass (idempotency
  itself is verified by source inspection, per above, and was already live-verified for
  the session-close path specifically in the PR-7 report's shortage-close test).

## Known gaps (every item explicitly classified)

1. **Mobile Category Strip compression** (documented in the PR-2C report) —
   **DONE + VERIFIED.** Superseded: measured 44×44px live across three tiles including
   two real color-coded categories (evidence: `pr8-mobile-cats-color.png`, bounding-box
   measurements in this report's Browser QA table). No longer reproduces; no fix was
   needed because there is nothing currently broken to fix.

2. **Approval-request UI for approval-required refunds** (deferred in PR-6) —
   **DEFERRED.**
   *Reason:* real feature work (a request → wait-for-supervisor → resume UX), not a
   hardening-gate fix; the mission explicitly warns against feature dumps in PR-8.
   *Risk if left undone:* a cashier hitting an approval-required return still has no
   in-workspace path to request approval; they must be told out-of-band to have a
   supervisor act via `/pos/audit`. No safety risk — the backend correctly blocks the
   action either way; this is a workflow-friction gap only.
   *Target:* now precisely scoped (materially improved over the PR-6 deferral): the full
   backend contract already exists and needs no design —
   `POST /pos/approval-requests` (operation `return_refund` or equivalent), and the
   existing `/pos/audit` screen already lets an authorized supervisor approve it. The
   remaining work is exactly one new in-workspace trigger (a "request approval" state in
   the return dialog) plus a resume path once approved.

3. **Cash-recount / approval-required recount UI** (deferred in PR-7) — **DEFERRED**,
   same reasoning and same materially-improved target as item 2 (operation
   `cash_recount` against the identical, already-existing three-endpoint contract).

4. **Component-test infrastructure gap** (documented in PR-6/PR-7) — **PARTIALLY FIXED,
   remainder DEFERRED.**
   *What was fixed:* the root cause was investigated directly (a repro of a bare,
   unmocked `fetch()` in a jsdom mount effect did **not** hang — it failed fast with
   `ECONNREFUSED`; mounting the real, full `PosPage` component also did **not** hang once
   given standard Next.js test stubbing). The actual, narrow cause of "no test exists and
   none can be added" was that `vitest.config.ts`'s `environmentMatchGlobs` had no entry
   matching `src/app/(pos)/pos/**` or `src/app/(app)/pos/sessions/**` (Next.js route-group
   parentheses aren't matched literally by micromatch), so any test placed there silently
   ran under `environment: 'node'` (no DOM) and would fail immediately, which is easy to
   mistake for "unable to test this file at all." Fixed the glob and added one real,
   passing smoke test.
   *What remains deferred:* full interaction-level coverage (open a real session inside
   the test, add to cart, pay, close) — this requires mocking the page's ~15+ distinct
   API endpoints called across its lifecycle with realistic, consistent fixture data, a
   non-trivial test-authoring investment for the largest single component in the
   frontend, not a timing/environment fix.
   *Risk:* regressions in this page are still only caught by manual/browser QA (as
   performed across PR-6/PR-7/PR-8) or the broader integration surface, not CI unit
   tests.
   *Target:* a dedicated frontend test-authoring PR building realistic API fixtures for
   the POS workspace's full endpoint surface.

5. **next-intl `INVALID_KEY` dev-mode console warning** ("3 Issues" badge visible in
   every screenshot across PR-6/PR-7/PR-8) — **DEFERRED.**
   *Reason:* traced to `web/src/messages/{ar,en}.json`'s `developer.events` object, which
   stores its keys as literal dotted strings (`"partner.created"`) instead of nested
   objects, and is pulled into validation because `event-picker.tsx` (an unrelated
   Developer/Webhooks module component) calls `useTranslations('developer')` on the
   *whole* namespace rather than a leaf. Reproduces on every page load app-wide
   (confirmed on a vanilla `/dashboard` load with zero POS interaction), not POS-specific,
   and pre-dates POS V2 entirely.
   *Is it production-affecting?* No. It is a `console.error` from `use-intl`'s dev-mode
   validator, not a thrown exception — every POS screen across three PRs' worth of
   screenshots rendered and functioned correctly despite it. Not reproduced as an issue
   in a production build in this pass (production builds suppress this class of dev-only
   validation).
   *Risk:* none beyond a confusing console warning during development.
   *Target:* a small, unrelated localization fix in the Developer/Webhooks module
   (either nest `developer.events` properly, or scope `event-picker.tsx`'s
   `useTranslations` call to a leaf namespace) — explicitly out of POS V2 scope per the
   mission's own instruction not to expand into unrelated localization refactoring.

6. **Pre-existing TypeScript errors** (documented in PR-7) — **DEFERRED, unchanged.**
   Re-ran `tsc --noEmit` fresh in this pass: identical 3 errors, identical files, all in
   test-file object literals (not production code), none in any POS file, none
   introduced or worsened by PR-6/PR-7/PR-8. Confirmed stable across three PRs — genuine
   pre-existing repository debt, not growing.

7. **Backend PostgreSQL CI** — **N/A for local verification** (this sandbox runs SQLite
   only). Evidence: PR-7's PostgreSQL CI run was already independently confirmed green
   by the user post-merge; this PR introduces zero backend changes, so there is nothing
   for a PostgreSQL-specific code path to newly break. Final confirmation deferred to
   this PR's own CI run, per the mission's explicit instruction not to poll CI locally.

8. **Hardware verification boundary** (printer/scanner/cash-drawer) — **N/A, evidence
   below.** No physical hardware is attached to this sandbox. The software input path
   was verified: `receipt-dialog.tsx`'s print-failure handling only ever checks for the
   real DOM `#print-root` element (never asserts a printer is connected — see Existing-
   first findings), and the manual cash-drawer flow (`openCashDrawer()`, confirmed
   already fully wired in the PR-7 investigation) truthfully reports
   `unsupported`/`not_configured`/`printer_unavailable`/etc. rather than ever claiming a
   fake success. No physical-device claim was made or tested; this boundary is
   unchanged from prior PRs and is inherent to a sandboxed environment, not a defect.

## Final end-to-end journey

See Browser QA row 2 above for the full narrative with every intermediate state
verified. Summary of what was **not** independently re-verified as part of this specific
run (already verified with real backends in the cited prior PR's own QA and not repeated
here to avoid redundant, time-consuming re-proof of already-settled behavior): the
exchange flow specifically (verified live in the PR-6 report), the shortage/surplus
session-close variance path specifically (verified live in the PR-7 report), and the
handover-confirm/SoD/variance-settlement screens on `/pos/sessions/[id]` (unchanged,
pre-existing, exercised only via the "Session details" link opening correctly, not via a
full second-user confirm cycle in this pass).

## CI

Not polled. This PR's own CI (backend SQLite + PostgreSQL, frontend build/test) will run
once pushed; per the mission's instruction, its result is to be checked once, not
repeatedly polled.

## Git metadata

- **Branch:** `claude/pos-v2-pr8-production-hardening`
- **PR:** [#672](https://github.com/safwan5001-source/Nebrax/pull/672) (Draft, open, unmerged)
- **Base SHA:** `3e4556c8ea74467b19bf8de64b125c215b4c621e` — `main` tip at branch
  creation; verified live via `pull_request_read` to be identical to the PR's current
  `base.sha` (no drift since creation).
- **Head SHA:** `b960de14f017a9e35b744177d656fbba604170b1` — verified live against
  PR #672's `head.sha` via `pull_request_read` immediately before this line was written.
  (As with the PR-6/PR-7 reports: a documentation-only commit cannot record its own
  resulting hash in advance; this value predates that commit and is confirmed accurate
  as of the moment written — any further edit to this file would need one more
  verification pass, which the chat reply performs instead of an unbounded loop here.)

## Risks / remaining work

- Low risk overall: two small, additive, well-tested fixes (a config glob + a
  translation-mapping reuse) plus one new passing test. No API/schema/accounting/tax/
  ZATCA change.
- The two approval-request UI gaps (items 2–3 above) are the largest remaining
  functional gaps in the whole POS V2 journey, now precisely scoped for a dedicated
  follow-up rather than left as vague technical debt.
- The component-test coverage gap (item 4) means the POS workspace's day-to-day
  interaction logic still relies on manual/browser QA for regression detection.

## Recommended next step

Review by ChatGPT/owner. Per the gate/stop condition: **not merged, not deployed, not
released.** Awaiting review of PR-8 and the accompanying
`AWJ-POS-V2-FINAL-CONTRACT-CLOSURE.md`.
