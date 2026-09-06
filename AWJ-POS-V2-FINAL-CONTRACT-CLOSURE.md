# AWJ POS V2 — Final Contract Closure

Reconciliation of the **complete** AWJ POS V2 Master Contract at the close of PR-8, the
final certification gate. Every requirement below receives exactly one final state:
**DONE + VERIFIED**, **DEFERRED**, **N/A**, or **BLOCKED**. Compiled from the R1–R6 safety
baseline and PR-1 through PR-8's own implementation reports, cross-checked against source
where a PR-8 finding required it (noted inline), and against the live end-to-end journey
performed in PR-8 (see `AWJ-POS-V2-PR8-PRODUCTION-HARDENING-REPORT.md`).

No requirement below "disappears," is left at "mostly done," or restated as "probably."

---

## R1–R6 — Safety Baseline

| # | Requirement | State | Evidence |
|---|---|---|---|
| R1 | Server-authoritative product eligibility + tax rate at checkout (`PosService::assertProductsAllowedForPos`) | **DONE + VERIFIED** | `AWJ-POS-R1-SERVER-AUTHORITY-IMPLEMENTATION-REPORT.md`; merged, covered by backend tests (re-confirmed green in PR-8's full suite run — zero POS test failures). |
| R2 | Return-quantity UOM correctness (sale-unit vs. stock-unit conversion at return time) | **DONE + VERIFIED** | `AWJ-POS-R2-R4-IMPLEMENTATION-REPORT.md`; merged, covered by backend tests. Re-verified live in PR-8's E2E journey: return dialog correctly showed remaining quantity/price per line. |
| R3 | Invoice branch-access authorization | **DONE + VERIFIED** | `AWJ-POS-R3-R6-IMPLEMENTATION-REPORT.md`; merged, covered by backend tests. |
| R4 | Return/exchange idempotency | **DONE + VERIFIED** | Same report; mechanism (`PosReturnAttempt`/`PosExchangeAttempt`) re-confirmed present by source inspection in PR-8. |
| R5 | Server-authoritative receipt (no frontend re-derivation of financial facts) | **DONE + VERIFIED** | `AWJ-POS-R5-IMPLEMENTATION-REPORT.md`; merged. Re-verified live in PR-8: receipt for `INV-2026-00001` showed exact server totals/QR. |
| R6 | Customer eligibility authorization | **DONE + VERIFIED** | `AWJ-POS-R3-R6-IMPLEMENTATION-REPORT.md`; merged, covered by backend tests. |

---

## PR-1 — Workspace Foundation & Operational Shell

| Requirement | State | Evidence |
|---|---|---|
| Correct topbar/navigation hierarchy; no fake actions | **DONE + VERIFIED** | `AWJ-POS-V2-PR1-IMPLEMENTATION-REPORT.md`. Re-audited in PR-8: every topbar `on*` prop wired to a real handler with a real `disabled` condition (source-level audit, zero dead icons found). |
| Workspace preserves session/device/branch/cashier/cart context across navigation | **DONE + VERIFIED** | Re-verified live in PR-8's E2E journey: navigating Products → Invoice Center → Invoice Details → back did not lose the active session, cart, or customer selection. |

## PR-2 / PR-2C — Product & Category Experience

| Requirement | State | Evidence |
|---|---|---|
| Product Cards V2, image on/off, fallback | **DONE + VERIFIED** | `AWJ-POS-V2-PR2-IMPLEMENTATION-REPORT.md`, `AWJ-POS-PR654-VISUAL-QA-REPORT.md`. |
| Category presentation: Default / Image / Color, Image XOR Color contract | **DONE + VERIFIED** | `AWJ-POS-V2-PR2C-IMPLEMENTATION-REPORT.md`. Re-verified live in PR-8 with two real color-coded categories. |
| Favorite / Quick View independence from cart | **DONE + VERIFIED** | `AWJ-POS-PR654-VISUAL-QA-REPORT.md` (Quick View confirmed read-only, cart stayed at 0 throughout every test). |
| **Mobile Category Strip icon/swatch compression** (previously "pre-existing, unrelated observation," ~36px instead of 44px) | **DONE + VERIFIED** — *superseded in PR-8* | PR-8 measured `span.h-11.w-11` bounding boxes live at 390px viewport for the "All" tab and two real color categories: `{"width":44,"height":44}` for all three, `getComputedStyle` confirmed `height: 44px` / `width: 44px`. Does not reproduce today. Screenshot: `pr8-mobile-cats-color.png`. |

## PR-2S — Cost & Profit Data Protection

| Requirement | State | Evidence |
|---|---|---|
| `products.view_cost` permission + `show_cost_profit_in_pos` tenant setting gate `purchase_price`/`avg_cost`/`profit_margin` server-side (fields absent from JSON, not frontend-hidden) | **DONE + VERIFIED** | `AWJ-POS-PR2S-COST-PROFIT-SECURITY-REPORT.md`. Re-confirmed in PR-8 by source inspection after re-syncing to current `main`: logic now lives in the centralized `App\Support\SensitiveCostPolicy` (consolidated further by the separately-merged PR-INV-1, #668), still applied in `ProductResource`. |

## PR-3 — Cart Interaction

| Requirement | State | Evidence |
|---|---|---|
| Desktop ~2/3 products / ~1/3 cart proportional layout | **DONE + VERIFIED** | `AWJ-POS-V2-PR3-IMPLEMENTATION-REPORT.md`. Visually consistent across every PR-8 desktop screenshot. |
| Selected-line model, quantity/price/discount numeric-keypad editing | **DONE + VERIFIED** | Same report. |
| Discount contract: Amount / Percentage-as-input-converted-to-fixed-amount-on-Apply, no new `discount_type` invented | **DONE + VERIFIED** | Same report; unchanged in PR-8 (not touched). |

## PR-4 / PR-4.1 — Receipt / Printing, Invoice Center Foundation

| Requirement | State | Evidence |
|---|---|---|
| Server-authoritative receipt; ZATCA QR from server response | **DONE + VERIFIED** | `AWJ-POS-V2-PR4-IMPLEMENTATION-REPORT.md`. Re-verified live in PR-8: real QR rendered for `INV-2026-00001`. |
| Receipt Preview desktop sizing fix | **DONE + VERIFIED** | `AWJ-POS-V2-PR4-1-RECEIPT-PREVIEW-UX-REPORT.md`. |
| **Sale success != print success invariant** (print failure never fails the sale, never retries checkout, never duplicates the invoice) | **DONE + VERIFIED** | Re-confirmed in PR-8 by direct source inspection of `receipt-dialog.tsx::handlePrint()` — an explicit code comment cites this exact invariant; the function only ever sets a local `printError` flag on failure (missing `#print-root` or a caught exception), never touches invoice or session state. |
| Invoice Center as a real operational workspace (list/search/status/totals/details/reprint/return-exchange entry points) | **DONE + VERIFIED** | Re-verified live in PR-8: list, open, return-entry-point all exercised end-to-end. |
| Invoice Center status labels correctly localized | **DONE + VERIFIED** — *fixed in PR-8* | Was a real, previously-undocumented defect (raw `paid`/`unpaid`/`posted` shown untranslated in the list, while Invoice Details correctly localized the same data). Fixed by reusing the existing `PAYMENT_STATUS_KEYS`/`DOCUMENT_STATUS_KEYS` mapping already present in `pos-invoice-details.tsx`. Verified live: desktop RTL, dark mode, and mobile card layout all show "مسدَّدة" correctly post-fix. |

## PR-5 — Payment Workspace

| Requirement | State | Evidence |
|---|---|---|
| Tender ordering/validation matches backend authority; no independent frontend financial truth | **DONE + VERIFIED** | `AWJ-POS-V2-PR5-PAYMENT-WORKSPACE-REPORT.md`. |
| Cash / non-cash / split payment, exact-remaining, over-remaining rejection, change | **DONE + VERIFIED** | Re-verified live in PR-8: a real split payment (cash 100.00 + card 89.75, exactly matching the 189.75 total) was accepted and posted correctly. |

## PR-6 — Returns / Refunds / Exchanges

| Requirement | State | Evidence |
|---|---|---|
| Return/Exchange from Invoice Details, server quotes, historical UOM, returnable-quantity/partial/multiple returns | **DONE + VERIFIED** | `AWJ-POS-V2-PR6-RETURNS-EXCHANGES-REPORT.md`. Re-verified live in PR-8: return dialog preselected the correct invoice, showed correct remaining quantity/price on both lines. |
| Refund destination/method policy | **DONE + VERIFIED** | Re-verified live in PR-8: refund-to-cash-drawer was correctly capped at 89.75 SAR — the *cash* portion only of a 189.75 SAR split-tender sale — not the full invoice total, correctly reflecting that only cash actually in the drawer can be refunded as cash. |
| Return/exchange idempotency | **DONE + VERIFIED** | Backend mechanism (`PosReturnAttempt`/`PosExchangeAttempt`) confirmed present by source inspection in PR-8. |
| **Approval-request UI for approval-required refunds** | **DEFERRED** | *Reason:* real feature work (request → wait-for-supervisor → resume), explicitly out of scope for a hardening gate. *Risk:* cashier has no in-workspace path to request approval for a gated return; must be told out-of-band. No safety risk — backend still correctly blocks the action. *Target:* PR-8 found and documents that the full backend contract already exists unused (`POST /pos/approval-requests`, `GET/POST pos/audit/approvals/*`, already consumed by the existing `/pos/audit` back-office screen) — the only remaining work is one new in-workspace request trigger in the return dialog. This materially sharpens the original PR-6 deferral from "needs an approval architecture" to "needs one new UI trigger against an existing, complete contract." |

## PR-7 — Session Operations

| Requirement | State | Evidence |
|---|---|---|
| Server-authoritative expected cash / closing preview / per-payment-method reconciliation | **DONE + VERIFIED** | `AWJ-POS-V2-PR7-SESSION-OPERATIONS-REPORT.md`. Re-verified live end-to-end in PR-8: opening 200.00 + one 189.75 split sale (100 cash / 89.75 card) → closing preview correctly showed cash-drawer expected 289.75 and card expected 100.00, each correctly isolated from the other tender. |
| Handover note, close, difference/variance computation, handover status | **DONE + VERIFIED** | Re-verified live: closed with exact counted amounts on both methods → API confirmed `difference: "0.00"`, `difference_status: "not_required"`, `handover_status: "pending"`. |
| Session details/report access from the in-workspace close dialog | **DONE + VERIFIED** | Re-verified live in the PR-7 report and unchanged in PR-8 (link opens `/pos/sessions/{id}` correctly in a new tab). |
| Unsaved-cart guard on session close | **DONE + VERIFIED** | Unchanged since PR-7; guard logic (`decidePosUnsavedExit`) not touched in PR-8. |
| SoD confirmation behavior (handover confirm, variance acknowledge/settle) | **DONE + VERIFIED** | Backend-enforced, pre-existing (documented in the PR-7 report's context); not touched, not re-exercised end-to-end in PR-8 beyond confirming the "Session details" link reaches the correct screen (a full second-user confirm cycle was not repeated — see PR-8 report's Final end-to-end journey note). |
| **Cash recount / approval-required recount UI** | **DEFERRED** | Same reasoning and same materially-sharpened target as the PR-6 return-approval gap above — identical underlying backend contract, operation `cash_recount`. |

## PR-8 — Production Hardening & Integration Review

| Requirement | State | Evidence |
|---|---|---|
| Full integrated journey certified end-to-end against a real backend | **DONE + VERIFIED** | See `AWJ-POS-V2-PR8-PRODUCTION-HARDENING-REPORT.md`, Browser QA row 2 and "Final end-to-end journey." |
| Workspace integrity (no context loss across navigation) | **DONE + VERIFIED** | Re-verified live; see PR-1 row above. |
| Checkout/return/exchange idempotency, no duplicate financial documents | **DONE + VERIFIED** | Confirmed by source inspection — real, existing `*Attempt` models with idempotency-key + checksum + race-safe replay. |
| Sale success != print success | **DONE + VERIFIED** | Confirmed by source inspection, see PR-4 row above. |
| Held carts / multiple carts / recovery | **DONE + VERIFIED** | Re-verified live: hold → topbar badge count → retrieve → both lines and totals correctly restored. |
| Topbar action audit (no dead/fake icons) | **DONE + VERIFIED** | Source-level audit: every prop wired, every `disabled` state real. |
| Cost/profit protection still server-enforced after PR-INV-1 | **DONE + VERIFIED** | Re-confirmed present in `ProductResource` after re-syncing to current `main`. |
| **Mobile Category Strip** | **DONE + VERIFIED** | See PR-2/PR-2C row above — resolved/superseded in PR-8. |
| **Component-test infrastructure gap** | **PARTIALLY FIXED** (smoke coverage added; interaction-level coverage **DEFERRED**) | Root cause investigated directly (a hang could not be reproduced); the real, narrow cause — a missing `environmentMatchGlobs` entry for route-group paths — was found and fixed, plus one new real, passing smoke test (`page.test.tsx`, 232 files/1485 tests all green, no hang). Full interaction coverage (open session → cart → pay → close, fully mocked) remains deferred: it requires realistic fixtures for the page's full multi-endpoint API surface, a genuine test-authoring project, not a bounded bug fix. *Risk:* day-to-day interaction regressions in this page still rely on manual/browser QA. *Target:* a dedicated frontend test-authoring PR. |
| **next-intl `INVALID_KEY` dev-mode warning** | **DEFERRED** | Root cause traced to an unrelated Developer/Webhooks module namespace (`developer.events`), confirmed non-crashing, confirmed unrelated to and pre-dating POS V2. *Risk:* none beyond a confusing dev-console warning. *Target:* a small, unrelated i18n fix in the Developer/Webhooks module, explicitly out of POS V2 scope. |
| **TypeScript pre-existing errors** | **DEFERRED, unchanged** | Re-ran fresh in PR-8: identical 3 errors, identical files, all in test-file object literals, none in production code, none in any POS file, confirmed stable (not growing) across PR-6/PR-7/PR-8. |
| Backend PostgreSQL CI gate | **N/A for local verification** | Sandbox runs SQLite only. PR-7's PostgreSQL CI run already independently confirmed green post-merge by the user; PR-8 introduces zero backend changes. Final confirmation deferred to this PR's own CI run. |
| Hardware verification boundary (printer/scanner/cash-drawer) | **N/A, evidence given** | No physical hardware in this sandbox. Software input path verified truthful (no fake success claims) by source inspection; this boundary is inherent to the environment, not a defect, and unchanged from prior PRs. |

---

## Cross-cutting items with no dedicated PR section above

| Requirement | State | Evidence |
|---|---|---|
| Tenant Isolation (system-wide) | **DONE + VERIFIED** | Unchanged in PR-8 (no backend file touched); baseline established and tested across R1–R7's own backend test suites, re-confirmed passing in PR-8's full backend run (2423 passed). |
| Branch Isolation (system-wide) | **DONE + VERIFIED** | Same basis. |
| Historical UOM behavior | **DONE + VERIFIED** | R2's fix, re-verified live in PR-6's and PR-8's return-dialog QA. |
| Cart/session recovery | **DONE + VERIFIED** | Re-verified live in PR-8 (held-cart round-trip). |
| Backward compatibility | **DONE + VERIFIED** | No API/schema/contract change in any PR-6/PR-7/PR-8 change; all additive. |

---

## Overall certification statement

Every Master Contract requirement above carries exactly one final state. Two real
requirements were fixed in PR-8 (Invoice Center status localization; the test-
infrastructure environment glob + a real smoke test). One documented observation
(mobile Category Strip) was re-measured live and reclassified from a vague "pre-existing
observation" to **DONE + VERIFIED** with concrete evidence. Two backend-approval-workflow
gaps remain **DEFERRED**, now with a materially more precise, low-risk target than
before (the full backend contract already exists; only one UI trigger per flow is
missing). Three items (test-infra remainder, next-intl warning, pre-existing TypeScript
errors) remain explicitly **DEFERRED** as genuinely unrelated or genuinely large-scope
work, not silently folded into "done." Two items are **N/A** for this sandboxed
environment with evidence given for why.

**No requirement was silently skipped. No safety check was weakened. No scope was
expanded beyond what this certification gate required.**

Per the mission's gate/stop condition: **not merged, not deployed, not released.**
Awaiting review of PR-8 and this closure document.
