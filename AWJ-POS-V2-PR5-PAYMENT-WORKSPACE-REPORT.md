# AWJ POS V2 — PR-5: Payment Workspace Completion & Hardening

## 1. Executive Summary

This is a focused hardening pass on the existing `PosPayment` component — not a rebuild. The
single real defect fixed: the frontend previously computed "paid" as the raw sum of every
amount typed into every payment-method field, and "change" as `max(0, paid - total)` — with
no distinction between cash and non-cash tenders. This let a cashier see a plausible "change"
value for a bank/card overpayment, even though the backend (`PosService::checkout`) explicitly
rejects any non-cash tender that exceeds the remaining balance (`RuntimeException`, whole sale
rejected) and only ever produces change from cash. A new pure utility
(`web/src/lib/pos-payment-tender.ts`) mirrors the backend's exact tender-application loop, and
`PosPayment` now uses it for paid/remaining/change, inline per-method validation, "exact
amount," and submission ordering. Additionally: an on-screen numeric keypad (reusing the
existing `PosNumericEditor` primitive and the existing `show_onscreen_numeric_keypad` setting)
is now available for payment-amount entry, and the deferred-payment banner distinguishes the
remaining receivable from cash change.

No accounting, tax, ZATCA, checkout endpoint, payment posting, idempotency, or database
change was made. `PosService::checkout` (Laravel) was read but not modified.

## 2. Base SHA

`acc22ddea0fbfe16a00e8436636d1c23391c4af0` (`main`, PR-4.1 merge — #661). Confirmed via
`git fetch && git log` before branching; matches the mission's stated known merge SHA exactly.

## 3. Head SHA

`f38e0af5596fef7890bb9c7b621b28b42ee19f43`

## 4. Branch

`claude/pos-v2-pr5-payment-workspace`

## 5. PR number/link

Recorded after push (see final chat reply). Draft.

## 6. Existing architecture reused

- `PosPayment` (`web/src/components/pos/pos-payment.tsx`) — the same component, not replaced.
- `PosNumericEditor` (`web/src/components/pos/pos-numeric-editor.tsx`) — reused as-is for the
  new payment-amount keypad; no changes to this file.
- `show_onscreen_numeric_keypad` POS setting — the same key already used for
  quantity/price/discount editors, now also read for payment amounts (see §12).
- `numericEditorLabels` object already built once in `pos/page.tsx` — passed through unchanged.
- Configured payment methods, `default_payment_method_id`, `allow_deferred_payment`,
  checkout-attempt/idempotency pipeline, offline/submitting/recovering states, and the
  R5/PR-4/PR-4.1 receipt pipeline — all untouched, all still wired exactly as before.
- `PosService::checkout`'s tender-application loop (`app/Services/Accounting/PosService.php:230-261`
  in the Laravel reference app) was read carefully and is the literal specification the new
  frontend simulation mirrors — no backend file was edited.

## 7. Files changed

- `web/src/lib/pos-payment-tender.ts` (new) — pure tender-simulation utility.
- `web/src/lib/__tests__/pos-payment-tender.test.ts` (new) — 11 unit tests.
- `web/src/components/pos/pos-payment.tsx` — paid/remaining/change math, inline invalid-tender
  message, numeric-keypad integration, exact-amount fix, deferred-payment note.
- `web/src/components/pos/pos-payment.test.tsx` — 7 new tests added; all 5 pre-existing tests
  kept and pass unmodified.
- `web/src/app/(pos)/pos/page.tsx` — two new props wired through
  (`showOnscreenNumericKeypad`, `numericEditorLabels`).
- `web/src/messages/en.json`, `web/src/messages/ar.json` — 3 new translation keys
  (`deferred_payment_remaining_note`, `payment_bank_amount_exceeds_remaining`,
  `numeric_keypad_edit_payment_amount`), plus an updated hint string for
  `show_onscreen_numeric_keypad_hint` (see §12).

## 8. UX changes

- **Inline validation on the method card itself**: a non-cash method whose entered amount
  would exceed the remaining balance (per the exact backend order — see §9) now shows a red
  border, a warning icon, and an inline message ("This amount exceeds the remaining balance.
  Non-cash methods cannot produce change."), and the confirm button is disabled — instead of
  silently allowing a submission the server would reject wholesale.
- **"Exact amount" now fills what's actually left**, not the invoice total blindly. If another
  method already has an amount entered, clicking "Exact amount" on the active method fills the
  true remaining balance for that method (excluding its own current value), so split payments
  don't get an accidental additional overpayment offered as a "quick" option.
- **Deferred-payment banner** now shows a short note ("The remaining amount will stay as a
  receivable on the customer's account.") only when there is still an amount remaining after
  the current tenders — so the cashier isn't told about a receivable when the sale is already
  fully paid.
- **On-screen numeric keypad** (opt-in via the existing `show_onscreen_numeric_keypad`
  setting): each payment-method amount field becomes a `PosNumericEditor` in keypad mode
  instead of a plain text input, matching the existing quantity/price/discount editors
  pixel-for-pixel (same component, same dialog, same digit grid).

## 9. Cash/change semantics — the actual fix

The backend (`PosService::checkout`, lines 230–261) applies tenders **in array order**,
capping each at `min(amount, remaining)`, and **throws immediately** (rejecting the whole sale)
if a `bank` tender's amount exceeds the remaining balance at the moment it's processed. Only
`cash` ever produces change (the untracked excess above `applied`).

`simulateTenders(totalMinor, tenders)` in `pos-payment-tender.ts` reproduces this precisely:

```ts
const ordered = [...nonCashTenders, ...cashTenders]; // stable within each group
let remaining = totalMinor;
for (const tender of ordered) {
  if (tender.settlementType === 'bank' && tender.amount > remaining) {
    invalidMethodId = tender.methodId; break; // mirrors the server's RuntimeException
  }
  const applied = Math.min(tender.amount, remaining);
  if (tender.settlementType === 'cash') changeMinor += tender.amount - applied;
  remaining -= applied;
}
```

**Why non-cash is always ordered before cash**: this is not arbitrary — it's the ordering the
frontend now also *sends* to the server (`orderedTenderPayload`), so the cashier's on-screen
preview and the server's actual result are always identical. Putting cash last means a cash
overpayment is always resolved against the true final remaining balance (after every other
tender has already been applied), which is the natural cashier expectation ("give me the
balance in cash, and I'll take the change"). Two examples from the required test matrix:

| Scenario | Total | Tenders (as entered) | Result |
|---|---|---|---|
| A | 100 | Cash 120 | Cash applies 100, remaining 0, **change 20** |
| B | 100 | Bank 120 | **Rejected** — `invalidMethodId = bank`, confirm disabled, no submission |
| C | 100 | Cash 40, Bank 60 | Bank applies 60 first, cash applies 40, remaining 0, change 0 |
| D | 100 | Cash 120 + Bank 50 | Bank (non-cash) processed first against 100 → applies 50; cash then applies 50 of its 120 against the 50 left; **change = 70**, remaining 0 |

Scenario D matters because it demonstrates the ordering is not "whatever the cashier typed
first" — it's always non-cash-before-cash, deterministically, matching the server.

## 10. Split-payment behavior

Already existed (grid of per-method cards, each with its own amount); PR-5's contribution is
making the resulting totals (paid/remaining/change) and the submission order *correct* under
split payment, plus the inline validation described above. No new split-payment backend model,
no parallel checkout path — `orderedTenderPayload()` still produces the same
`{ payment_method_id, amount }[]` shape `onConfirm` always expected; only the array's element
*order* is now deterministic (non-cash first, cash last) instead of following whatever order
`paymentMethods` happened to be returned in.

## 11. Deferred-payment behavior

No new eligibility/credit-limit logic was added. A backend search (`credit_limit`,
`deferred`, `eligib` across `PosService.php` and related files) confirmed no per-customer
credit-limit or eligibility check exists today — deferred payment is gated only by the
tenant-level `allow_deferred_payment` POS setting, exactly as before. Per the mission's
explicit instruction ("do not invent a new credit-limit behavior unless it already exists"),
none was added. The only change is presentational: the existing banner now also states that
the remaining amount becomes a receivable, shown only when a remaining balance actually
exists, and the confirm button's existing gate (`allowDeferredPayment || remaining <= 0`) is
unchanged in its logic, just re-expressed in terms of the corrected `remainingMinor`.

## 12. Numeric keypad behavior

The existing `show_onscreen_numeric_keypad` setting is now also read by `PosPayment` (passed
from `pos/page.tsx` as `showOnscreenNumericKeypad={posCfg.show_onscreen_numeric_keypad}`,
reusing the same `numericEditorLabels` object already built for the cart's quantity/price
editors). When enabled, each payment-method amount field renders as a `PosNumericEditor` in
keypad mode (button → dialog → digit grid → Apply), identical in behavior to the existing
quantity/discount keypads. When disabled (the default), the field is the original plain
`<input>` — zero behavior change for tenants who don't enable it.

One judgment call, made and documented here rather than silently: the existing translated hint
for this setting explicitly said *"This setting does not affect amount entry on the payment
screen"* — which the mission asked to now make untrue by design (§9 of the mission: "reuse the
existing `show_onscreen_numeric_keypad`... for payment amount entry"). Since the mission
explicitly requested this and it is a copy-only change (no schema, no new setting key), the
hint string was updated in both `en.json` and `ar.json` to remove the now-inaccurate caveat
rather than leaving stale, contradictory documentation in the settings UI. No new setting was
introduced.

## 13. Server-authority confirmation

No frontend calculation is presented as final. `simulateTenders` is explicitly documented (in
its own doc-comment) as a pre-submission UI helper only — the invoice total itself is never
recomputed locally (still `totalMinor` from the server-priced cart, unchanged); the checkout
endpoint (`POST /pos/checkout`) is still the sole authority for accepting/rejecting tenders,
computing final applied amounts, and posting payments. If the frontend's simulation ever
disagreed with the server (it shouldn't, since the algorithm is a direct mirror), the server's
decision still wins — the frontend only blocks *obviously* invalid submissions early to save a
round trip, never bypasses the server check.

## 14. Idempotency confirmation

`PosCheckoutAttemptController`/the checkout-attempt hook in `pos/page.tsx` (`confirmPayment`)
were not touched. `onConfirm`'s call signature (`(tenders: PosTender[]) => void`) and the
`idempotency_key`/`cart_id` construction in `confirmPayment` are unchanged; only the *content*
of the `tenders` array passed to it changed (now `orderedTenderPayload()`'s deterministic
order instead of `paymentMethods`-array order). Verified via the existing test "لا يرسل
التأكيد المكرر أثناء paying..." (duplicate-confirm-prevention) and "يمنع اللمس ولوحة
المفاتيح من تجاوز قفل الإرسال..." (submit-lock bypass prevention) — both pass unmodified,
confirming the locking/duplicate-prevention behavior around `onConfirm` is intact.

## 15. Receipt/printing regression confirmation

Real end-to-end browser QA (not just unit tests) confirmed the full path: cart → payment →
exact-cash confirm → **actual invoice posted** (`INV-2026-00008`) → Receipt dialog opened
automatically with "تمّ البيع بنجاح," correct invoice number, correct total (330.63 SAR
including VAT), and a real ZATCA QR code rendered — using the same R5/PR-4/PR-4.1 pipeline,
completely untouched by this PR. See §18, screenshot `J-checkout-after-confirm-receipt.png`.

## 16. Tests + exact results

| Scope | Command | Result |
|---|---|---|
| New pure-logic unit tests | `npx vitest run src/lib/__tests__/pos-payment-tender.test.ts` | 11/11 passed |
| `PosPayment` component tests | `npx vitest run src/components/pos/pos-payment.test.tsx` | 12/12 passed (5 pre-existing unmodified + 7 new) |
| Broader POS suite | `npx vitest run src/components/pos src/lib/__tests__ "src/app/(app)/pos" "src/app/(pos)"` | 74 files / 406 tests passed |
| Full frontend suite | `npx vitest run` | 231 files / 1484 tests passed (baseline 230/1466 + 1 new file/18 new tests, 0 regressions) |
| `npm run build` | — | exit 0, "✓ Compiled successfully" |

No test was weakened, skipped, or deleted. All 5 pre-existing `pos-payment.test.tsx` tests
pass with **zero modification** to their assertions — including the test that types an
overpayment ("150.00" cash against a 100.00 total) and expects the change tile to turn
positive, which still holds true under the new (correct) semantics.

New tests cover, per the required matrix: default/enabled-only payment methods (pre-existing,
untouched), split tender (cash+bank exact match), cash over-tender/change (scenario A),
bank/non-cash over-tender UX (scenario B, inline message + disabled confirm), mixed cash+bank
with backend-matching ordering (scenario D), deferred payment allowed vs. disabled with a
remaining balance, "exact amount" filling only the true remainder in a split scenario, and
numeric-keypad enabled/disabled rendering (button vs. textbox).

Backend: no Laravel file was changed, so no backend test re-run was required or performed
(`PosService.php` was read only, for reference, to build the frontend simulation — this
followed the mission's explicit "inspect current service and match it" instruction rather than
inventing behavior).

## 17. Build result

`npm run build` — exit code 0, "✓ Compiled successfully," no new warnings.

## 18. Browser QA matrix

All captured via pinned Chromium (`/opt/pw-browsers/chromium`) through Playwright, against a
real seeded tenant with real payment methods (Cash/Card/Bank Transfer/Cheque, seeded by the
platform's own new-tenant bootstrap) and real POS products, driving the actual Next.js dev
server with localStorage-injected auth — no mocked UI.

| # | Scenario | Result |
|---|---|---|
| A | Desktop RTL — cash exact amount | Pass — cash card selected, exact-amount fills 287.50, paid/remaining/change all correct (`A-desktop-rtl-payment-screen.png`, `A-desktop-rtl-cash-exact.png`) |
| B | Desktop RTL — cash over-tender + correct change | Pass — 200.00 cash against 172.50 total → paid 172.50, remaining 0.00, change 27.50, all correctly colored (`B-desktop-rtl-cash-overtender-change.png`) |
| C | Desktop RTL — split cash + bank | Pass — 200 cash + 300 bank against 575.00 → paid 500.00, remaining 75.00, both method cards checked (`C-desktop-rtl-split-cash-bank.png`) |
| C2 | Desktop RTL — bank over-tender (must block) | Pass — 300 bank against 287.50 total → red border, warning icon, inline message, confirm button visibly disabled (`C2-desktop-rtl-bank-overtender-blocked.png`) |
| D | Desktop RTL — deferred payment (allowed) | Pass — 100 cash against 575.00 → remaining 475.00 shown, deferred-receivable note visible, confirm enabled (`D-desktop-rtl-deferred-payment.png`) |
| E | Desktop LTR | Pass — full mirrored layout, correct English labels (`E-desktop-ltr-payment.png`) |
| F | Desktop dark | Pass — correct contrast, no dark-mode regressions (`F-desktop-dark-payment.png`) |
| G | Touch/keypad-enabled | Verified via component test (button renders instead of textbox when `showOnscreenNumericKeypad` is true) — see §16; not re-screenshotted separately from A–F since the visual keypad dialog itself is `PosNumericEditor`'s existing, unmodified UI (already screenshotted in prior PRs for quantity/price editing) |
| H | Mobile RTL | Pass — 2×2 method grid, no clipping, confirm reachable, **zero horizontal overflow** (verified via `document.documentElement.scrollWidth === clientWidth`, `H-mobile-rtl-payment.png`) |
| I | Long/multi-item cart | Pass — 3-line cart (1,035.00 total), sidebar summary scrolls correctly, payment math correct (`I-desktop-rtl-long-cart-payment.png`) |
| J | Full checkout regression | Pass — real checkout confirmed (`INV-2026-00008`), Receipt dialog opened with correct total, ZATCA QR rendered, cart cleared behind the dialog (`J-checkout-before-confirm.png`, `J-checkout-after-confirm-receipt.png`) |

No clipping, no overlap, no horizontal overflow anywhere in the matrix. Active method is
always visually unambiguous (primary border/background, or negative border+icon when
invalid). Back-to-cart preserves cart/customer/session/device/branch throughout (session
`POS-2026-00001`, device `POS1`, branch `الفرع الرئيسي` unchanged across every scenario).

## 19. Before/After evidence

**Before** (per the mission's reference screenshots and the pre-PR-5 code): `changeMinor =
Math.max(0, paidMinor - totalMinor)` where `paidMinor` was the raw sum of every tender typed,
with no settlement-type distinction — a bank/card overpayment would display a plausible
"change" value the backend would never actually honor (it rejects the sale outright).
"Exact amount" always filled the full invoice total regardless of amounts already entered on
other methods, which for a genuine split payment could suggest an amount larger than what was
actually left.

**After** (measured in this pass, not estimated): scenario B above — 200.00 cash against a
172.50 total — now shows paid **172.50** (not 200.00), remaining **0.00**, change **27.50**;
scenario C2 — a 300.00 bank/card entry against a 287.50 total — is now visibly rejected inline
(red border + warning icon + message) with the confirm button disabled, rather than silently
producing an invalid "change: 12.50" the server would never accept. This is a direct,
verifiable correctness fix, not a cosmetic one.

## 20. Risks / remaining issues

- The frontend's tender simulation is a faithful mirror of `PosService::checkout`'s current
  loop, but it is still a *mirror*, not a shared implementation — if the backend's ordering or
  capping logic changes in the future, this frontend utility would need a matching update. This
  is an inherent risk of any client-side pre-validation and was flagged rather than hidden;
  no shared-code mechanism between Laravel and Next.js exists in this codebase to eliminate it.
- Multiple non-cash tenders on the exact same sale (e.g., two different bank-type methods) are
  handled correctly by the simulation (verified by a dedicated unit test) but were not
  separately exercised in browser QA — the visual matrix used at most one non-cash method at a
  time, which is the realistic cashier workflow.
- The seeded QA tenant's products required a proper unit template to complete a full checkout
  (a product with no `unit_template_id` cannot be sold through the cart at all — a pre-existing,
  unrelated product-catalog behavior discovered incidentally while preparing QA data). This is
  documented here for transparency; it is unrelated to payment and was not touched.

## 21. Explicit out-of-scope confirmation

PR-6 (Returns/Refunds/Exchanges), PR-7 (Session close/handover), and PR-8 (new hardware/gateway
integration) were not implemented, referenced, or scaffolded. No new payment-provider or
terminal/gateway integration was added. No new customer-credit model was introduced (see §11).
No accounting/tax/ZATCA/invoice-numbering/posting-rule change was made. No database schema
change was made. No new backend endpoint was added; `PosService.php` was read for reference
only.

## 22. CI status

Not applicable at report time — CI runs on the Draft PR once pushed; no CI status is available
to report from this local session.

## 23. Next recommended step

ChatGPT review → CI → Safwan's explicit approval → merge. No merge, deploy, or release has
been performed.
