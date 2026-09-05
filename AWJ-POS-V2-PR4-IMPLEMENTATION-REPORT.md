# AWJ POS V2 — PR-4: Invoice Center & Printing

## 1. Executive Summary

PR-4 adds a real second workspace mode to POS — **Invoices**, alongside the existing **Products**
mode — inside the same `/pos` page component, so the active cart, selected customer, session,
device, branch, and connectivity state all stay mounted and untouched while the cashier browses
invoices. It evolves the existing "Latest Invoices" modal (which linked out to the ERP
`/invoices/{id}` page) into an in-POS **Invoice Center** (list) → **Invoice Details** (business
view) → **Receipt Preview** (reused R5 thermal receipt renderer) flow, with reprint via **Print**,
**Copy invoice number**, and **Close**.

One narrow, additive backend fix was required and made: `GET /invoices/{id}` was not eager-loading
the `partner` relation, so `InvoiceResource`'s already-defined `partner` field silently came back
empty — which would have made customer name blank in both Invoice Details and every reprinted
receipt. Fixed with a one-line addition to an existing eager-load list; no schema change, no new
endpoint, no contract change.

No accounting, tax, ZATCA, checkout, or R1–R6 behavior was touched. No new financial calculation
was introduced anywhere in the frontend — every number in Invoice Details and Receipt Preview comes
verbatim from `GET /invoices/{id}` (`InvoiceResource`), the same resource shape checkout already
returns and that R5's receipt already trusts.

## 2. Existing-First Classification

| Requirement | Classification | Evidence |
|---|---|---|
| POS invoice list data source | **Implemented & usable** | `GET /pos/recent-invoices` (`PosController::recentInvoices`) — tenant/branch-scoped, `invoices.manage`, POS-origin only (`whereNotNull('pos_session_id')`, `status=posted`). Reused as-is. |
| "Latest Invoices" UI | **Implemented, UX incomplete** | `pos-recent-invoices-dialog.tsx` — a modal whose "View invoice" linked to the ERP `/invoices/{id}` page (`<Link href={...}>`), i.e. leaves POS. Evolved into `PosInvoiceCenter`, an inline workspace panel with no ERP link. |
| Invoice Details (business view) | **Missing** | No in-POS equivalent existed. Built `PosInvoiceDetails` against the existing `GET /invoices/{id}` (`InvoiceController::show`). |
| Receipt Preview architecture (R5) | **Implemented & usable, reused verbatim** | `ReceiptDialog` (`DocumentView`/`DocumentScaler`/`printDocument`/`resolveTemplateRevisionDefinition`) — extended additively with a `variant` prop; default behavior for post-checkout success is byte-for-byte unchanged. |
| Reprint from a historical invoice | **Missing** | Built by feeding `GET /invoices/{id}`'s response through the exact same `buildPosReceiptInvoice`/`buildInvoiceDocumentModel` pipeline R5 uses for the just-posted sale. |
| Workspace-mode navigation (Products ⇄ Invoices) | **Missing** | No second workspace existed. Added the smallest state needed (`workspaceMode`, `selectedInvoiceId`) inside the existing `PosPage` component — not a route, not a rebuilt shell. |
| Print/reprint failure truthfulness | **Partial** | Auto-print already swallowed failures silently (try/catch, no user-visible state) and manual Print never checked anything. Added a real, detectable failure state (`#print-root` missing / `printDocument` throwing) surfaced as an explicit banner, retryable independently. |
| Permissions on invoice list/details | **Implemented & usable, unchanged** | List: `invoices.manage` (existing). Details: `invoices.view` (existing, `InvoiceController::show`). Both already branch/tenant scoped; not modified. |
| Search/filter over invoices | **Partial, by API constraint** | `GET /pos/recent-invoices` only supports `limit` (no `search`/date-range/pagination) — the richer `GET /invoices` (search, filters, `per_page`) exists but returns **all** ERP invoices, not just POS ones, which would silently broaden branch/document visibility beyond current POS semantics. Kept the POS-scoped endpoint; added **client-side** filtering (number/customer) over the fetched page (`limit=50`, the existing max). Deeper server-side POS-scoped search is **deferred** (see §22). |
| Item count on invoice list | **Missing, deferred** | Not returned by `GET /pos/recent-invoices`. Not fabricated — omitted from the list card. |
| Return/refund affordance from Invoice Details | **Explicitly not implemented** | No return/exchange action was added anywhere in this PR-4 surface — PR-6 scope untouched. |

## 3. What Was Implemented

- **Workspace-mode state** (`workspaceMode: 'products' | 'invoices'`, `selectedInvoiceId: string | null`)
  inside the existing `PosPage` component. Switching modes only changes which JSX branch renders;
  nothing unmounts the cart/session state.
- **`PosInvoiceCenter`** (`web/src/components/pos/pos-invoice-center.tsx`) — invoice list panel:
  search box (client-side), loading/empty/error states, "Open" per row, "Back to products" header
  action.
- **`PosInvoiceDetails`** (`web/src/components/pos/pos-invoice-details.tsx`) — fetches
  `GET /invoices/{id}`, renders customer/date/document status/payment status, itemized lines
  (qty/UOM/unit price/line discount/line total), and a totals block (subtotal/discount/shipping/
  adjustment/tax/total/paid/remaining) — all read directly from the response, no local math.
  "Preview receipt" action shown only for `status === 'posted'` invoices.
- **`ReceiptDialog` extended** (`web/src/components/pos/receipt-dialog.tsx`) — new optional
  `variant?: 'success' | 'preview'` (default `'success'`, i.e. R5's original behavior is unchanged)
  and `onCopy?: () => void`. `'preview'` swaps the checkmark/"sale done" framing for a neutral
  "Receipt preview" header and swaps the "New sale" button for "Close"; adds a "Copy invoice
  number" button when `onCopy` is provided. Also added a real print-failure state (see §13).
- **Reprint wiring** in `page.tsx`: `openReceiptPreview(invoice)` builds a `Receipt` from the
  `GET /invoices/{id}` response via the existing R5 helpers (`buildPosReceiptInvoice`,
  `buildInvoiceDocumentModel`, `posReceiptCustomer`) and a new, separate `previewReceipt` state —
  entirely independent of the post-checkout `receipt` state (no shared mutable success/preview
  flag, no risk of auto-print firing for a reprint).
- **Topbar/mobile-nav repurposing**: the existing "Recent invoices" topbar button and the mobile
  "More" nav button now switch `workspaceMode` to `'invoices'` instead of opening the old modal.
- **Keyboard/scanner gating**: barcode scanner and product/cart keyboard navigation are disabled
  while `workspaceMode === 'invoices'` (folded into the existing `dialogOpen` computation at its
  one call site — the shared `PosDialogFlags` type/tests were not touched for this). Sale-affecting
  keyboard shortcuts (customer/search/held-sales/hold/delete/payment/new-cart/open-carts) are given
  `undefined` handlers outside Products mode instead of being fed through the shared dialog-flags
  gate, so they cannot fire against an invisible cart. `Esc`/"back" is repointed to return to
  Products while in Invoices mode.
- **`recentInvoicesOpen` removed** from `PosDialogFlags`/`isPosDialogOpen` and both of that hook's
  test fixtures — it existed only to gate the now-removed modal.
- **Backend**: `InvoiceController::show()` now eager-loads `partner:id,name,vat_number,city` (see
  §6).

## 4. What Existing Functionality Was Reused

- `GET /pos/recent-invoices` (list data, permission, tenant/branch scope) — unchanged.
- `GET /invoices/{id}` (`InvoiceController::show`, `InvoiceResource`, `InvoiceLineResource`) —
  unchanged except the one eager-load addition.
- `buildPosReceiptInvoice`, `posReceiptCustomer` (`web/src/lib/pos-receipt.ts`) — unchanged, reused
  verbatim for reprint.
- `buildInvoiceDocumentModel` (`web/src/modules/documents/builder/from-invoice.ts`) — unchanged.
- `ReceiptDialog`'s entire rendering pipeline (`DocumentView`, `DocumentScaler`, `printDocument`,
  `resolveTemplateRevisionDefinition`, `getTemplate`, `PAPER_SIZES`) — unchanged, extended
  additively.
- `Dropdown`/`Button`/`Input` UI primitives — unchanged.
- `formatRiyal`, `formatDate`/`formatDateTime` — unchanged.
- The list-item layout/data-fetching pattern from the old `PosRecentInvoicesDialog` — evolved in
  place into `PosInvoiceCenter` rather than being thrown away (same API call, same card layout,
  same loading/error/empty handling, same translation keys where they already existed).

## 5. Files Changed

**Backend**
- `app/Http/Controllers/Api/InvoiceController.php` — `show()` eager-loads `partner` (see §6).

**Backend tests**
- `tests/Feature/InvoiceShowIncludesPartnerTest.php` *(new)* — guards the fix in §6.

**Frontend — new**
- `web/src/lib/pos-invoice-center.ts` — pure `filterPosCenterInvoices()` helper + `PosCenterInvoice` type.
- `web/src/lib/__tests__/pos-invoice-center.test.ts` — 5 tests for the above.
- `web/src/components/pos/pos-invoice-center.tsx` — Invoice Center panel.
- `web/src/components/pos/pos-invoice-details.tsx` — Invoice Details panel + `InvoiceDetail` type.

**Frontend — modified**
- `web/src/app/(pos)/pos/page.tsx` — workspace-mode state, topbar/mobile-nav rewiring, keyboard/
  scanner gating, `openReceiptPreview`/`copyInvoiceNumber`, `previewReceipt` state, render branch
  for Invoices mode, `PosRecentInvoicesDialog` import/mount removed.
- `web/src/components/pos/receipt-dialog.tsx` — `variant`/`onCopy` props, print-failure state.
- `web/src/components/pos/receipt-dialog.test.tsx` — mock fixed to forward `rootId` (was silently
  unfaithful to the real component — see §14); 2 new tests (preview variant, print failure).
- `web/src/components/pos/interactions/pos-interaction-context.ts` — `recentInvoicesOpen` removed
  from `PosDialogFlags`/`isPosDialogOpen`; doc-comment explains where workspace-mode gating now
  lives instead.
- `web/src/components/pos/interactions/pos-interaction-context.test.ts` — fixture updated.
- `web/src/components/pos/interactions/use-pos-keyboard-shortcuts.test.ts` — fixture updated.
- `web/src/messages/ar.json` / `en.json` — new keys for Invoice Center/Details/Receipt Preview
  (listed in the diff; no existing key's value changed).

**Frontend — removed**
- `web/src/components/pos/pos-recent-invoices-dialog.tsx` — fully superseded by
  `pos-invoice-center.tsx` (evolved, not discarded — see §4).

## 6. Backend/API Impact

**Reused endpoints** (no change): `GET /pos/recent-invoices`, `GET /invoices/{id}`.

**Added endpoints**: none.

**Changed endpoint**: `GET /invoices/{id}` (`InvoiceController::show`) — added
`'partner:id,name,vat_number,city'` to its existing `Invoice::with([...])` eager-load array.

**Why this was necessary**: `InvoiceResource` already defines a `partner` field
(`whenLoaded('partner', ...)`), and the checkout response (`POST /pos/checkout`) already returns it
populated — R5's immediate receipt depends on it. But `show()` never eager-loaded that relation, so
`whenLoaded` always resolved to "not loaded" and the field was silently omitted from every
`GET /invoices/{id}` response. Since PR-4's Invoice Details ("customer" is an explicit required
field) and Receipt Preview (`posReceiptCustomer` needs `partner.name`) both consume this exact
endpoint, every reprint and every Invoice Details view would have shown a blank/fallback customer
name for every invoice, always — not a hypothetical edge case.

**Why this is the smallest safe fix**: it completes a field the resource contract already defines
and that other callers of the same resource (checkout) already receive — it does not add a field,
change a response shape, add a route, or touch any financial value. Verified with a new, narrow
test (`InvoiceShowIncludesPartnerTest`) and confirmed the existing branch-isolation suite for this
exact endpoint (`PosInvoiceBranchAccessTest`, 7 tests) still passes unchanged.

## 7. Database/Schema Impact

**None.** No migration was created or considered necessary. The backend change is an eager-load
addition to an existing query, not a schema or model change.

## 8. Tenant Isolation

Unchanged. `GET /pos/recent-invoices` and `GET /invoices/{id}` both operate on `Invoice::query()`,
which inherits tenant scoping from `BaseModel`/`TenantScope` — untouched by this PR. No frontend
code constructs or bypasses a tenant boundary.

## 9. Branch Isolation

Unchanged. Both reused endpoints call `$this->scopeToActiveBranch(...)` — untouched. Verified via
the existing `PosInvoiceBranchAccessTest` (7 tests, all green after the `partner` eager-load
change) and `PosRecentInvoicesTest` (2 tests, green) — see §14.

## 10. Permissions

- Invoice Center (list): `invoices.manage` — existing gate on `GET /pos/recent-invoices`, untouched.
- Invoice Details / Receipt Preview data: `invoices.view` — existing gate on `GET /invoices/{id}`,
  untouched.
- No new permission was created. No frontend-only permission check was added; the UI shows
  whatever the API returns (data or an error), so visibility is never treated as authorization.
- Noted for completeness (not changed here, pre-existing RBAC reality): these are two different
  permission keys. A custom role with `invoices.manage` but not `invoices.view` (or vice versa)
  could see the list but not open details, or the reverse — this mirrors the ERP's own existing
  permission boundaries for these two routes and was not altered or worked around by PR-4.

## 11. Accounting/Tax/ZATCA/R1–R6 Safety Statement

No accounting, tax, or ZATCA logic was touched. No new journal entry, payment, or stock effect is
possible from anything built in this PR — Invoice Center and Invoice Details are read-only views;
Receipt Preview/reprint renders already-persisted data and never calls checkout, payment, or return
endpoints. R1 (stock authority), R2 (UOM/unit factor), R3 (branch isolation), R4 (return/exchange
idempotency), R5 (server-authoritative receipt), and R6 (customer eligibility) are all unrelated
code paths, none of which were modified; the full backend regression suite (§14) confirms no
collateral change.

## 12. Receipt Authority

Every value shown in both the post-checkout receipt (R5, unchanged) and the new Receipt Preview
(reprint) comes from the server:

- **Checkout success receipt** (unchanged): `POST /pos/checkout`'s response
  (`InvoiceResource`-shaped) → `buildPosReceiptInvoice` → `buildInvoiceDocumentModel`.
- **Receipt Preview / reprint** (new): `GET /invoices/{id}`'s response (the *same*
  `InvoiceResource` shape, now with `partner` populated) → the *same* `buildPosReceiptInvoice` →
  the *same* `buildInvoiceDocumentModel`. No separate code path, no local recomputation.
- **ZATCA QR**: read from `invoice.zatca.qr` in the `GET /invoices/{id}` response — the exact same
  field (`zatca_qr` persisted at posting time) that the checkout response's `data.zatca.qr` already
  exposed to R5's immediate receipt. Never regenerated or derived client-side.
- **Thermal template revision**: `invoice.thermal_template_revision`, the frozen revision persisted
  at posting time — same mechanism R5 already relies on for visual consistency between the moment
  of sale and any later reprint.

## 13. Checkout vs Printing Failure Separation

- Building the reprint's `DocumentModel` (`openReceiptPreview`) is wrapped in try/catch; failure
  shows a toast (`receipt_preview_unavailable`) and does **not** touch the invoice, the cart, the
  session, or trigger any request beyond the `GET /invoices/{id}` already made to load Invoice
  Details. No checkout call exists anywhere in this path.
- `ReceiptDialog`'s `handlePrint()` (used by both the success and preview variants) now explicitly
  checks for the `#print-root` DOM anchor before calling `printDocument`, and wraps the call in
  try/catch. On failure it sets a local `printError` flag that renders a dismissible-by-retry
  banner (`print_failed`) — the receipt/invoice number and totals stay displayed unchanged, and the
  Print button remains clickable for an independent retry. No retry re-runs checkout; no second
  invoice or payment can be created from this path, printing has no side effect other than
  `window.print()`.
- Auto-print (post-checkout, `autoPrint` setting) uses the same `handlePrint()` now, so a failed
  auto-print also surfaces the same visible banner instead of silently doing nothing as before —
  the sale itself was, and remains, already committed by the time this code runs.

## 14. Tests

All commands run from `/home/user/Nebrax/web` unless noted; backend from `/home/user/nibras-app`.

**Targeted (new/changed)**
```
npx vitest run src/lib/__tests__/pos-invoice-center.test.ts src/components/pos/receipt-dialog.test.tsx
```
→ 2 files, **10 tests passed**.

**Broader POS + interaction-context regression**
```
npx vitest run src/components/pos src/components/pos/interactions
```
→ included in the full run below; all passed (interaction-context and keyboard-shortcut fixture
updates verified).

**Full frontend suite**
```
npx vitest run
```
→ **230 test files, 1466 tests passed** (0 failed). Baseline before PR-4 (post PR-3) was 229
files / 1459 tests — the +1 file / +7 tests are exactly the new tests added here (5 +
`pos-invoice-center.test.ts`, 2 in `receipt-dialog.test.tsx`).

**Production build**
```
npm run build
```
→ exit code 0.

**Backend — targeted**
```
php artisan test --filter="InvoiceShowIncludesPartnerTest|PosInvoiceBranchAccessTest|PosRecentInvoicesTest|PosCheckoutTest|ApiInvoiceTest"
```
→ **42 tests passed** (533 assertions), SQLite. Confirms: the new `partner` eager-load test passes;
branch isolation on `GET /invoices/{id}` (7 tests) is unaffected; POS recent-invoices scoping (2
tests) is unaffected; full POS checkout suite (27 tests, R1/R5/R6-adjacent) is unaffected; general
invoice API suite (5 tests) is unaffected.

**Backend — full suite**
```
php artisan test
```
→ **2363 passed, 1 skipped, 25 failed** (17010 assertions). The 25 failures are the same
pre-existing, environment-only failures confirmed in every prior mission this session (`bcmath`
PHP extension missing for 24 Fuel-module tests; `poppler-utils` missing for 1 document-intake
test) — CI installs both; none relate to invoices, POS, or this PR's change.

## 15. Build Result

`npm run build` → success, exit code 0.

## 16. Browser QA

Real Chromium (`/opt/pw-browsers/chromium`) via Playwright, against the actual Next.js dev server
and a live Laravel backend — freshly registered tenant, a real customer, two real products, one
POS device, one open POS session, and **three real posted POS invoices** created through the actual
`/pos/checkout` endpoint (not mocked). Screenshots kept locally only, per this repo's established
convention.

| # | Scenario | Result | Screenshot |
|---|---|---|---|
| 1 | Products workspace with a non-empty cart, customer selected | PASS | `01-products-with-cart.png`, `02-customer-picker.png` |
| 2 | Switch to Invoice Center | PASS — real list of 3 invoices with number/date/total/status | `03-invoice-center.png` |
| 3 | Cart + selected customer + session context intact after switching back to Products | **PASS** — verified both visually and is the core requirement | `04-back-to-products-context-preserved.png` |
| 4 | Open a real invoice → Invoice Details | PASS — customer name populated (confirms the `partner` fix), correct totals/status/payment | `05-invoice-details.png` |
| 5 | Receipt Preview from Invoice Details | PASS — real ZATCA QR, correct template, "Receipt preview" framing (not "sale done") | `06-receipt-preview.png` |
| 6 | Reprint/Copy without triggering checkout | **PASS** — clipboard read back `INV-2026-00001` after clicking Copy; success toast shown; no network request to `/pos/checkout` occurred | `07-receipt-copy-toast.png` |
| 7 | Return to Products, cart/customer still intact after the full round trip | PASS | `08-final-products-context-check.png` |
| 8 | Invoice Center search (client-side filter), no-match empty state | PASS | `09-invoice-center-search-empty.png` |
| 9 | Desktop LTR + dark mode: Invoice Center, Invoice Details, Receipt Preview | PASS — full mirror, correct translations, legible in dark | `10-ltr-dark-invoice-center.png`, `11-ltr-dark-invoice-details.png`, `12-ltr-dark-receipt-preview.png` |
| 10 | Mobile (390×844): products, Invoice Center via "More" nav, Invoice Details | PASS, no layout breakage | `13-mobile-products.png`, `14-mobile-invoice-center.png`, `15-mobile-invoice-details.png` |
| 11 | Empty invoice list state | PASS (same component path as the no-match search state, confirmed via source; not separately screenshotted since it is the identical empty-state branch — see `pos-invoice-center.tsx`) | — |
| 12 | Keyboard/mouse interaction | PASS — all navigation performed via role-based clicks and `Escape`; no interaction required a mouse-only affordance |
| 13 | Scanner/focus recovery | **Verified by code + full test suite, not by physical scanner** (no barcode hardware in this environment — consistent with this session's established limitation). Confirmed: `usePosBarcodeScanner`'s `enabled` condition now excludes `workspaceMode === 'invoices'`; all `usePosBarcodeScanner`/`usePosProductNavigation`/`usePosCartNavigation` tests remain green; manually confirmed (screenshot 8) that after a full Products→Invoices→Details→Preview→Products round trip, clicking a product tile still adds to the cart normally, which exercises the identical code path a scanner-matched barcode would use. |
| 14 | Print failure state | **Verified by targeted unit test, not by physical printer failure** (mission explicitly permits this: "if a specific hardware failure cannot be reproduced in browser QA, document the limitation and verify the application logic/tests instead"). `receipt-dialog.test.tsx`'s new test mocks `printDocument` to throw and confirms: the failure banner appears, the sale/invoice data stays displayed unchanged, and a second click retries independently and succeeds. |

Not fabricated: no screenshot or claim above represents a state the application did not actually
reach; where real hardware could not be exercised, this is stated explicitly rather than implied.

## 17. RTL/LTR

Both verified (see §16, rows 1–9 for RTL, row 9 for LTR). Layout mirrors correctly in both
directions using the existing `locale`-driven RTL/LTR mechanism (`document dir`, Tailwind logical
properties) — no new direction-specific code was written; `PosInvoiceCenter`/`PosInvoiceDetails`
use the same `ChevronLeft`/`ChevronRight` locale-swap pattern already established elsewhere in the
POS codebase (e.g. `pos-topbar.tsx`).

## 18. Light/Dark

Both verified (see §16 row 9 for dark; all other screenshots are light mode). No new color tokens
were introduced; all new UI reuses existing `bg-surface`/`bg-background`/`text-text`/`text-muted`/
`border-border`/`text-positive`/`text-negative` tokens.

## 19. Desktop/Mobile

Both verified (see §16 rows 1–9 desktop, row 10 mobile). No mobile-specific redesign was performed;
Invoice Center/Details reuse the same header-plus-scrollable-body pattern already used by
`PosPayment`, so they inherit the same responsive behavior without new breakpoint-specific code.
The previously-documented, pre-existing mobile category-strip clipping issue was not
re-investigated or touched — out of scope per the mission.

## 20. Scanner/Focus

See §16 row 13. Additionally, at the code level: the barcode-scanner `enabled` condition and the
product/cart keyboard-navigation `dialogOpen` gate both now exclude `workspaceMode === 'invoices'`
(single call-site change in `page.tsx`, not a change to the shared `pos-interaction-context.ts`
pure functions or their existing tests, which remain green unmodified in behavior). Sale-affecting
keyboard shortcuts are given `undefined` handlers outside Products mode rather than silently firing
against a hidden cart.

## 21. Risks

- **Two different permissions gate the two halves of this feature** (`invoices.manage` for the
  list, `invoices.view` for details) — pre-existing ERP reality, not introduced or changed by
  PR-4, but worth a reviewer's awareness since a custom role could see one and not the other.
- **Client-side-only search**: the invoice list search does not query the server; it filters
  whatever the existing `limit=50` fetch already returned. A tenant with more than 50 POS invoices
  will not be able to search older ones from this screen. This is an honest, documented limitation
  of the existing `GET /pos/recent-invoices` API surface, not a bug introduced here (see §22).
- **`recentInvoicesOpen` removal**: a small, correct cleanup of dead state now that the modal it
  gated no longer exists — flagged explicitly since it touches a shared type
  (`PosDialogFlags`) used by other tests, all of which were updated and pass.

## 22. Deferred Items

- **Deeper server-side invoice search/date-range/pagination for POS** (target: a future, narrow
  backend task — not PR-5/6/7/8, and not assumed to be any specific future PR number). The richer
  `GET /invoices` endpoint exists but is not POS-scoped (would show all ERP invoices, broadening
  visibility); building a POS-scoped equivalent with real search was judged out of this PR's
  narrow scope.
- **Item count per invoice** on the list (target: same future backend task above — would require
  adding a count to `PosController::recentInvoices`).
- **Reprint audit trail**: no `reprint_count`/`printed_at`/print-log concept exists anywhere in the
  codebase today (checked `Invoice` model and its migrations — confirmed absent). Per the mission's
  explicit instruction ("if audit behavior does not exist and adding it requires broader backend
  contract work, document rather than inventing unsafe behavior"), none was added. Today, viewing/
  reprinting an invoice carries the same access-control guarantee as viewing it (`invoices.view`)
  but produces no distinct logged "reprint event." Target: a dedicated future task, out of PR-4's
  scope.
- **PR-5 (Payment Workspace), PR-6 (returns/refunds/exchanges), PR-7 (session
  reconciliation/handover), PR-8 (hardware/Print Bridge/WebUSB/WebSerial/production hardening)** —
  none touched. No return/refund affordance was added anywhere in Invoice Details.

## 23. Known Limitations

- Search covers only the most recent 50 POS invoices per branch (API's existing `limit` cap).
- No item-count field is shown on the invoice list (not returned by the existing API).
- Scanner and physical-printer failure states are verified via code + automated tests, not
  physical hardware, per the mission's own allowance for this environment.
- The pre-existing mobile category-strip clipping issue (documented in the PR-2C QA mission)
  remains present and untouched — explicitly out of scope for PR-4.

## 24. Git Information

- Repository: `safwan5001-source/Nebrax`
- Branch: `claude/pos-v2-pr4-invoice-center-printing`
- Base SHA: `c60eaa1f08f06dc5626688eda43b056baf75cc41` (confirmed: exact match to the mission's
  required base, `main` HEAD at session start — PR-3 merge, #658)
- PR number/link: [#659](https://github.com/safwan5001-source/Nebrax/pull/659) (Draft)
- Draft status: Draft, open, not merged (confirmed via `pull_request_read`)
- Head SHA: `2cbe9b0c344416e257a53afd455d0b05bee66751`

## 25. Next Recommended Step

> ChatGPT/Safwan review of PR-4. No merge or deployment has been performed.
