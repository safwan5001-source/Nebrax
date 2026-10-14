# AWJ-PLATFORM-UX-H1 — Closure Governance & H15-13 Assessment

STATUS: **FOR OWNER DECISION** · Documentation only · No application code changed · No financial or accounting rule changed · No waiver created · Horizon **OPEN**
Date: 2026-10-14 · Base: `origin/main` @ `a9f4acfc7a8b4fbc4353dccb04705184c1f5d10c` (merge of #1452, verified)

Roles (set by the owner): **Technical Owner = Claude Code** (follows up and prepares evidence); **Decision Owner = Safwan** (priorities, waivers, closure, merge, deploy). Assigning an owner does not close an item and does not accept any risk.

## 1. Register update (what changed in `AWJ-PLATFORM-UX-H1-CLOSURE-BACKLOG.md`)

Every item now shows: Technical Owner (Claude Code), Decision Owner (Safwan), priority, **severity**, acceptance criteria, evidence in hand, **evidence required**, **status** and **ticket reference** ("none assigned": no tracker ticket exists and none was invented). Item `BL-H1-11` (stale-response guard) was added to the table.

| Ref | Item | Priority | Severity | Status |
|---|---|---|---|---|
| N1 | price-history keyboard scroll | Done | Closed | Done (#1449) |
| BL-H1-01 | N2 text clipped at 200% on phones | P3 | Low | Open — not started |
| BL-H1-02 | duplicate price race → Backend 500 | P2 | Medium | Open — not started |
| BL-H1-03 | tenants ordering on equal `created_at` | P2 | Medium | Open; PostgreSQL case NOT VERIFIED |
| BL-H1-04 | retention dry-run validation | P2 | Low–Medium | Open — not started |
| BL-H1-05 | H15-12 Arabic-only server messages | P3 | Low | Open — not started |
| BL-H1-06 | H15-14 confirmation stays ticked | P3 | Low–Medium | Open — not started |
| BL-H1-07 | H15-16 targets < 44 px | P3 | Low | Open — not started |
| BL-H1-08 | H15-17 (a) IntlError, (b) duplicate dependency text, (c) session-guard mismatch | P3 | (c) Low–Medium, **provisional, not lowered** | Open; TC-A/TC-B NOT VERIFIED |
| BL-H1-09 | 320/350 px at 200% text | P3 | Low | Open — not started |
| — | H15-15 no confirmation on Save plan / End trial | decision | n/a | Existing design decision kept |
| BL-H1-10 | **H15-13** comma interpretation in amounts | assessment | **High potential impact, likelihood unmeasured** | Assessment delivered (§2); policy decision pending |
| BL-H1-11 | stale-response guard | verification | n/a | **NOT VERIFIED** |

Closure condition 1 (owners) is recorded as roles; **Safwan confirms** whether that satisfies it. No tickets exist. No waiver has been recorded for anything.

## 2. H15-13 — independent analytical assessment (read-only)

Nothing was changed. The only execution was a read-only call of the real `riyalToMinor` from `web/src/lib/money.ts` on `a9f4acfc…` (Node `--experimental-strip-types`), using the inputs listed in §2.2.

### 2.1 Actual usage

`riyalToMinor` is used by **48 non-test source files** besides its definition (an earlier draft said 49; that counted the definition). Only two test files mention it (`lib/__tests__/money.test.ts`, `lib/fuel-quantity.test.ts`); **no test pins any comma, Arabic-comma, space or ambiguous-separator behaviour**. The comment in `money.ts` states the intent "tolerates thousands separators".

Classification by reading the call sites (not every call was traced individually):

**A. User-typed amounts (about 40 files; text inputs, mostly `inputMode="decimal"`)** — the exposed paths:
- *Sales:* `components/invoices/invoice-form.tsx` (line price, line discount, invoice discount, shipping, adjustment, allocations), `app/(app)/quotes/new`, `app/(app)/recurring-invoices/new`, `components/credit-notes/credit-note-form.tsx` and `invoice-linked.ts` (typed price), `app/(pos)/pos/page.tsx` (cart discount, unit price), `components/pos/pos-payment.tsx` (tenders), `components/pos/pos-exchange-dialog.tsx`, `components/delivery-notes/delivery-note-invoice-draft-wizard.tsx`, `components/customer-refunds/create-customer-refund-dialog.tsx`, `components/supplier-refunds/create-supplier-refund-dialog.tsx`.
- *Purchases:* `components/purchases/purchase-form.tsx`, `components/procurement/procurement-form.tsx`.
- *Cash and journals:* `components/payments/{payment-dialog,document-payment-form,general-payment-form}.tsx`, `app/(app)/receipt-vouchers/new`, `app/(app)/expenses/new`, `app/(app)/employee-custodies/{new,[id]}`, `app/(app)/cash-and-bank/transfer`, `app/(app)/manual-journals/new`, `app/(app)/assets/new`, `app/(app)/pos/sessions` (opening cash), `app/(app)/stock-permits/new` (receipt line cost is typed; issue lines read the product's server `avg_cost`).
- *Catalogue and partners:* `components/products/{product-dialog,product-workspace,product-multi-barcode-table}.tsx` (purchase, sale, minimum sale price, unit prices), `app/(app)/sales-settings/pricelists`, `components/partners/partner-form.tsx` (credit limit, opening balance).
- *Other:* `components/hr/contract-dialog.tsx` (allowance amounts), `app/(fuel)/fuel-stations/{shifts,receiving,corporate-contracts,settings,sales,maintenance}`, `modules/pos-audit/case-detail.tsx` (confirmed loss, recovered amount), `lib/pos-open-session.ts`, and **`app/platform/(console)/prices/page.tsx`** (monthly price).

**B. Server decimal strings converted back (not typed):** `modules/documents/builder/from-{invoice,quote,purchase,purchase-order,credit-note,payment}.ts`, `components/reports/financial-comparison.ts`, and the source-line amounts in `components/returns/create-return-dialog.tsx`. These receive API decimals such as `"1150.00"` (no commas), so the comma rules do not affect them.

Not inventoried: amount paths that use **other** parsers (for example `lib/fuel-quantity.ts` handles quantities) and inputs that bypass `riyalToMinor`.

### 2.2 Executed behaviour (real function, `a9f4acfc…`)

| Input typed | Result (minor units → riyal) | Reading |
|---|---|---|
| `1000.50`, `100.5`, `0.30` | 100050, 10050, 30 | correct |
| `1,500`, `1,234,567.89`, `1,500.50` | 150000, 123456789, 150050 | correct as thousands grouping |
| `١٬٢٣٤٫٥٠`, `٠٫٥٠`, `١٢٣٤٫٥٠`, `1٫5` | 123450, 50, 123450, 150 | correct (Arabic-Indic digits, Arabic thousands `٬` and decimal `٫` separators) |
| `1,5` | 1500 → **15.00** | **10× if the user meant 1.50** |
| `1,50` | 15000 → **150.00** | **100×** |
| `0,5` / `0,50` | 500 → **5.00** / 5000 → **50.00** | **10× / 100×** |
| `12,34` | 123400 → **1234.00** | **100×** |
| `3,14` | 31400 → **314.00** | **100×** |
| `12,000` | 1200000 → **12000.00** | **1000× if a comma-decimal user meant 12.000** (three-digit tail) |
| `0,500` | 50000 → **500.00** | **1000×** if meant 0.500 |
| `1,500`, `999,999` | 150000, 99999900 | grouping; ambiguous with a three-decimal comma number |
| `1 500` | 150000 → 1500.00 | grouping by space accepted |
| `1 500,50` | 15005000 → **150050.00** | **100×** (European style) |
| `1,,5` / `,5` / `5,` | 1500 / 500 / 500 | malformed commas **accepted** |
| `1.500,50` | NaN (rejected) | safe |
| `1.000`, `1.505` | NaN (rejected) | safe (3 decimals) |
| `1،5`, `١،٥` (Arabic comma U+060C) | NaN (rejected) | safe |
| `.5`, `5.`, `+5`, `1e3`, `0x10`, `abc`, `1..5` | NaN (rejected) | safe |
| `-5` | -500 | negative accepted (each form must refuse it itself) |
| `` and ` ` (empty/space) | 0 | empty = zero, **not** NaN |
| 15 digits (`9999999999999.99`) | accepted; 16+ rejected | bound |

### 2.3 Why this is a locale problem, not an edge case

- In many locales (and in a comma-decimal style used by some Arabic and European users), the comma is the **decimal** separator. `riyalToMinor` strips every comma, so a one- or two-digit tail after a comma is read as part of the integer: a **silent 10× or 100× error**, with no NaN and no message.
- Partly resolvable for SAR because halalas have 2 decimals: a comma followed by 1–2 digits at the end of the number cannot be grouping and is almost certainly a decimal comma. **A comma followed by exactly 3 digits is NOT safely resolvable** (`12,000`, `1,500`, `0,500`): a thousands-grouping user means 12,000 / 1,500 / 500, while a comma-decimal user who writes three decimals (as with some other currencies, or by habit) means 12.000 / 1.500 / 0.500 — the parser accepts it as grouping and the error is **1000×**. Only a second comma group (`1,234,567`) or an explicit `.`/`٫` decimal part (`1,500.00`) disambiguates.
- Mobile numeric keypads (`inputMode="decimal"` is used in 43 files) show the device locale's decimal key, which may produce `,` (device region) or `٫` (Arabic keyboards). `٫` is handled; `,` is not. **How many real users type `,` as a decimal is not measured**, and no device was tested.

### 2.4 Financial and accounting risk

- A mis-read amount is a **valid** amount to the Backend (it receives minor units only), so double-entry stays balanced and nothing rejects it. The error would surface only on reconciliation or when a customer or auditor sees it.
- Affected money paths include customer invoices (and, through them, ZATCA-reported documents), payments and allocations, refunds, expenses, custodies, manual journals, assets, transfers, POS tenders and opening cash, partner credit limits and opening balances, product prices and the platform's own contract prices.
- Partial mitigations that exist in some forms (caps against the remaining balance on payments, previews such as the platform price preview that shows the parsed amount) reduce but do not remove the risk. Where the intended value is smaller than the typed-and-misread one, caps block it; where the misread value is smaller or within caps, nothing blocks it. Correction is possible through reversal documents (`LedgerService::reverse`, credit notes), but a ZATCA-reported invoice with a wrong amount is a compliance-visible event.
- A stricter parser returns NaN more often. **Consumers differ in how they treat NaN** (read from code, not executed): `invoice-form.tsx` checks `Number.isFinite` before submit, whereas some call sites use `riyalToMinor(x) >= 0` filters or arithmetic where NaN silently drops a line or propagates (for example `purchase-form.tsx`), and `app/(fuel)/fuel-stations/maintenance/page.tsx:164` converts NaN to `undefined` (the field is simply omitted). A policy change therefore also requires a per-consumer check that invalid input is **visibly** rejected.
- **Assessment:** impact potentially **High**; likelihood **unknown**. It is proposed to keep it rated at least **P2 pending the owner's decision**; it is not downgraded by this document. No Backend or accounting rule needs to change to fix the input side.

### 2.5 Proposed input policy (options for the owner; nothing implemented)

Under the project rule that a policy with more than one reasonable answer is put to the owner (and made configurable where it is business policy):

| Option | Rule | Pros | Cons |
|---|---|---|---|
| **A1 (recommended)** | **Reject every ambiguous form; accept only unambiguous ones.** Decimal separator `.` or `٫` (max 2 decimals). A comma/`٬`/space is accepted as thousands grouping **only when it is unambiguous**: (i) two or more groups of exactly 3 digits (`1,234,567`, `12,000,000`) **or** (ii) the number also has an explicit `.`/`٫` decimal part (`1,500.00`, `12,000.50`). **Rejected:** a comma followed by 1–2 trailing digits (`1,5`, `12,50`), a single comma followed by exactly 3 digits with no decimal part (`12,000`, `1,500`, `0,500`, `999,999`), any group after a leading `0` (`0,500`, `0,500.00`), malformed commas (`1,,5`, `,5`, `5,`) and mixed styles (`1 500,50`, `1.500,50`). Clear bilingual message ("type the amount with a dot for decimals, e.g. 1500.00"). | Removes the silent 10×/100×/1000× errors; plain `1500` and `1500.00` keep working | Users who type `1,500` get an error and must retype (`1500` or `1,500.00`); consumers must show NaN visibly |
| A2 | Like A1 but a single-comma three-digit tail is **accepted only after an explicit confirmation** showing the parsed amount ("Read as 1,500.00 SAR — confirm?") | Keeps `1,500` usable | Relies on the user's attention; extra UI on every money form; still ambiguous in bulk/import paths |
| B | Locale-driven interpretation from a tenant/user setting (decimal separator) | Matches each user's habit | New settings, more blast radius, still ambiguous without explicit setup; a wrong setting recreates the error |
| C | Keep parsing, add a **parsed-amount preview** next to every amount field | No rejection | Mitigation only; relies on the user reading it; 40+ forms to change |

Recommended direction: **A1**, with **C** on the highest-risk forms (invoices, payments, journals) and **B** only if the owner wants it as a later business setting. Decision belongs to Safwan.

**Acceptance tests (to be run when an implementation is approved; none has been executed):**
1. *Unit, `riyalToMinor`:* every row of §2.2 under Option A1 — valid rows unchanged (`1000`, `1000.50`→100050, `1500.00`, `1,500.00`→150000, `12,000.00`→1200000, `1,234,567`→123456700, `12,000,000`, `1,234,567.89`, `١٬٢٣٤٫٥٠`, `0.30`, `100.5`); **ambiguous rows → NaN:** two-digit/one-digit comma tails (`1,5`, `1,50`, `12,34`, `0,5`, `0,50`, `3,14`), **three-digit single-comma tails (`12,000`, `0,500`, `1,500`, `999,999`)**, leading-zero groups (`0,500.00`), malformed commas (`1,,5`, `,5`, `5,`) and mixed styles (`1 500,50`, `1.500,50`); already-rejected rows still NaN; 15-digit bound unchanged; no float arithmetic. (Under A2 the three-digit single-comma rows instead return a value flagged `needsConfirmation`.)
2. *Property test:* for every integer minor amount m, `riyalToMinor(format(m)) === m` for the formats the UI itself produces (with and without grouping).
3. *Per-category UI tests (one representative per group in §2.1 A):* typing `12,50` **and `12,000`** each show the bilingual error, does not enable submit/post, and sends no request; typing `12.50` and `1,250.50` works exactly as today; mutation check: removing the guard makes the test fail.
4. *NaN handling audit:* a test (or checklist with evidence) per consumer proving that NaN is surfaced, never silently dropped or summed (`purchase-form.tsx` and the `>= 0` filter sites first).
5. *Platform prices:* the preview shows the error for `1,5`; `199.5` → 19950 and the Arabic-digit cases unchanged (they are covered today).
6. *Device check (NOT VERIFIED today):* on real iOS and Android keyboards with comma-decimal regions and Arabic keyboards, record which character the decimal key produces in a representative field, and confirm the outcome is the error (A) rather than a wrong amount.
7. *Regression:* a golden-file run over the existing invoice, payment and POS test suites with no change in valid-input totals.

## 3. Unverified checks — independent matrix

Every check below stays **NOT VERIFIED** until it is executed with recorded evidence or Safwan records a written waiver **for that specific check**. No waiver has been recorded.

| ID | Check | Why not done | Needed to run | Pass criteria | Evidence artifact | Runnable by Claude Code here? | Status | Waiver |
|---|---|---|---|---|---|---|---|---|
| V1 | Real screen readers (NVDA/JAWS/VoiceOver/TalkBack) on login and the 6 console pages | No screen reader in the environment | Tester with the AT and browsers; scripted pass (names of regions incl. the price-history region, headings, dialogs, alerts, retry) | Every control, region and alert is announced with a correct name and order, EN and AR | Tester log with AT/browser versions and notes | **No** | NOT VERIFIED | none |
| V2 | Firefox | Not installed (Chromium only); installing browsers is not allowed here | Firefox ESR/current on a machine | Same console matrix (layout, axe, keyboard, focus ring, RTL) shows no defect | Matrix output + screenshots | **No** | NOT VERIFIED | none |
| V3 | WebKit/Safari | Not installed | Safari/WebKit | Same as V2 | Same | **No** | NOT VERIFIED | none |
| V4 | Native browser zoom and text-size settings (Ctrl +/−, 200%, 400%; OS text size) | Only the browser's default-font-size preference and viewport emulation were used | Manual pass in desktop browsers | No horizontal page scroll or clipped content beyond the recorded P3 items; keyboard reachable | Notes + screenshots | **Partial** (font-size preference only; native UI zoom no) | NOT VERIFIED | none |
| V5 | Production build served with the production Backend | No production access; deploy not authorized | A production-like staging or the real stack, with approval | Console works against the production API and config (cookies, CORS, `APP_DEBUG=false`) | Staging report | **No** | NOT VERIFIED | none |
| V6 | Real external integrations (R2, ClamAV, AI providers) and real documents | No credentials or test accounts | Test accounts and sample documents | Save/test flows and document operations behave with non-empty real data | Integration report | **No** | NOT VERIFIED | none |
| V7 | Concurrent PostgreSQL cases: BL-H1-02 duplicate race, BL-H1-03 ordering ties | Never executed (PostgreSQL 16 client exists locally; no run) | A local or CI PostgreSQL database and the two tests in the register | Race → one 201 and one 422/409; paging with equal `created_at` returns every tenant once | Test output on PostgreSQL | **Yes, possible** (same approach as H1-5), not run | NOT VERIFIED | none |
| V8 | Stale-response guard under out-of-order latency (BL-H1-11) | Local backend answers in milliseconds; never exercised for real | Real browser + test backend with per-request delay injection (Playwright route delay) | The five cases of the register §3 all pass in EN and AR | Script output + screenshots | **Yes, possible**, not run | NOT VERIFIED | none |
| V9 | H15-17(c) TC-A and TC-B in a real browser | Derived from code only | Chromium with localStorage set to each state | Outcomes as in register §4a, no loop, no data shown | Script output | **Yes, possible**, not run | NOT VERIFIED | none |
| V10 | H15-13 device keyboards (comma/Arabic keyboards on real phones) | No devices | iOS/Android devices with comma-decimal regions | Records which character the decimal key emits and the resulting amount | Device log | **No** | NOT VERIFIED | none |
| V11 | Full Laravel suites locally | Container lacks image/AWS dependencies; failures there are environmental | CI (already green on every merge) | n/a | CI runs | CI evidence only | Covered by CI, not a local PASS | none |

## 4. Tests required and their status

| Test | Belongs to | Status |
|---|---|---|
| H15-13 acceptance tests 1–7 (§2.5) | BL-H1-10 | **Not written, not run** (no implementation approved) |
| Stale-response cases 1–5 | BL-H1-11 / V8 | **Not run** |
| TC-A and TC-B (unit + browser) | BL-H1-08 / V9 | **Not written, not run** |
| Concurrent duplicate price (two POSTs) and tenant ordering ties on PostgreSQL | BL-H1-02, BL-H1-03 / V7 | **Not run** |
| Retention body shapes | BL-H1-04 | **Not run** (the three shapes were exercised by hand in H1-5/the final acceptance review) |
| N2 / 320–350 px / touch-target measurements | BL-H1-01, 07, 09 | **Not run** after the original measurements |

## 5. Remaining risks

- **Financial (BL-H1-10):** silent mis-parse of comma decimals across about 40 input paths; likelihood unmeasured; potentially High.
- **Security (BL-H1-08 c):** assessed as fail-closed with no escalation found in the code; not reproduced in a browser; provisional rating.
- **Data integrity (BL-H1-02, 03):** generic 500 in a race; possible repeated/skipped tenant on PostgreSQL ties; both unreproduced on PostgreSQL.
- **Accessibility/compatibility:** V1–V4 unverified; N2, 320/350 px and targets < 44 px open.
- **Operational:** V5–V6 unverified; production behaviour unknown.

## 6. Decisions required from Safwan

1. H15-13: choose the input policy (A / B / C or other), approve (or decline) an implementation task, and set its priority; confirm the rating while it stays open.
2. Confirm whether role-level ownership (Technical: Claude Code; Decision: Safwan) satisfies closure condition 1, given that no tracker tickets exist (and say if tickets should be opened).
3. For each of V1–V10: ask for the check to be executed, or record a **separate written waiver naming that check**. V7–V9 can be run by Claude Code on request.
4. Confirm or change the priority/severity of BL-H1-01…09 as listed in §1.
5. Approve the Backend changes (BL-H1-02, 03, 04) if they should proceed; they are outside this documentation task.
6. Whether a reviewer other than the agent that built H15-03…H15-11 should sign the final acceptance.

## 7. Closure position

**H1 must stay OPEN.** Mandatory closure conditions are not met: condition 1 awaits Safwan's confirmation, condition 2 awaits the policy decision, condition 3 has **no** evidence or waiver for any V-check, and condition 4 (approval of the closure document) is pending. This document does not propose closing H1, does not waive anything and does not authorize merge or deploy.

## 8. Git

Base SHA `a9f4acfc7a8b4fbc4353dccb04705184c1f5d10c` (`origin/main`, merge of #1452) · Branch `claude/awj-h1-closure-governance` · Head SHA and PR: recorded on the PR (documentation-only PR; waits for the owner's approval before any merge).

## 9. Next step

Safwan reviews this report and the updated register and answers §6. On request, Claude Code runs V7, V8 and V9 (documentation of results only, no application change) and prepares the H15-13 implementation PR **only after** the policy decision and approval.
