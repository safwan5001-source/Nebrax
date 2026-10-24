# AWJ-ERP-UI-H2-1 — ERP UI contract (page patterns and cross-cutting rules)

STATUS: **FOR OWNER REVIEW at the Decision Gate** (phase A4 · documentation only · no product code)
DATE: 2026-10-15 · Plan: [AWJ-ERP-UI-H2-START-PLAN.md](./AWJ-ERP-UI-H2-START-PLAN.md) · Evidence: [A1](./reports/AWJ-ERP-UI-H2-A1-REPORT.md), [A2 audit](./AWJ-ERP-UI-H2-A2-AUDIT.md), [A3 research](./h2-a-evidence/A3-REFERENCE-RESEARCH.md)

## ملخص للمالك
هذا العقد هو «قاعدة القبول» لكل شريحة كود في H2. **لا يضيف نظام تصميم جديداً**: التوكنز والألوان والخطوط والشبكة ومساحة المستند معرَّفة في v3 ومنفَّذة. ما يضيفه هو ما ثبت غيابه في A2:
1. **أنماط صفحات موحّدة:** قائمة، نموذج، تفاصيل، إعدادات، تقرير. كل شاشة تتبع واحداً منها بمكوّنات `components/nebrax/*` القائمة.
2. **قواعد عابرة تمنع فئات الأخطاء** التي ظهرت في A2:
   - حالة «فارغ» كاذبة عند خطأ الخادم، أو نموذج فارغ قابل للحفظ يمسح إعدادات حقيقية.
   - ترحيل أو تحويل نقدي بلا تأكيد.
   - أزرار لا يملك المستخدم صلاحيتها.
   - رسائل خادم إنجليزية خام.
   - أرقام بغير `formatRiyal`.
   - تجميع مالي في المتصفح.
3. **مستويات تأكيد T0–T3** تُطابق كلفة الخطأ.
4. **قواعد Floor لنقطة البيع** من تدقيق POS الفعلي (المسح، والدفع، وإقفال الجلسة) دون مساس بمنطق البيع.

## 1. Authority and scope

Order of authority (unchanged): **code + tests → design-system/v3 → DESIGN_SYSTEM.md → H1-1 contract → this document**. This contract does not restate tokens, colour, type, spacing, grid, Document Workspace or Totals Dock (v3 `FOUNDATIONS`, `DATA_GRID`, `DOCUMENT_WORKSPACE`, `TOTALS_DOCK`, `WORKSPACE_POSTURES`). It keeps every H1-1 rule (dialog D1–D7, menus M1–M3, toasts T1–T4, shell S1–S5, §2.5–2.8) and adds page patterns plus cross-cutting rules that A2 showed are missing.

**Numbers alignment (settles the number-alignment caution in A3 §1 «Not adopted / caution» and its RTL observations):** amounts, quantities and percentages align to the **logical end** (`text-end`: physically left in RTL, right in LTR), mono with tabular figures (v3 FOUNDATIONS §5 rule 3, DATA_GRID §7). The phrase «الأرقام يمين» in `DESIGN_SYSTEM.md` §مبادئ التخطيط is v2 wording; a docs-sync item (not a behaviour change) is listed in §6.

Each rule has an id (`R-…`), a level (MUST / SHOULD), the A2 evidence that motivates it, and how it is verified.

## 2. Cross-cutting rules

### R-STATE — one honest state at a time
| # | Rule | Evidence |
|---|---|---|
| R-STATE-1 | MUST follow H1-1 §2.5 precedence: loading → forbidden → error → empty → data. | H1-1 |
| R-STATE-2 | **A failed load is never shown as empty data.** No «لا توجد…», blank card, `0`, `0.00` or «لم يُعثر» when the request failed: show the localized error state with retry. | FIN-04/05, SAL-06/07, PLT-05/12, OPS-12, PROBE-02 |
| R-STATE-3 | **An editor whose data did not load is not editable.** Settings and edit forms render no inputs and no Save until the GET succeeds; on failure they show the error state. Saving defaults over real data must be impossible from the UI. | **PLT-01, SAL-01 (P0)**; PROBE-01 (record edit forms) |
| R-STATE-4 | Loading shows a skeleton shaped like the content (`LoadingState` variants), never the empty text, and never an endless skeleton: a request that ends in error leaves the skeleton. | FIN-04/05 |
| R-STATE-5 | Not-found (404) is a localized page state with a link back to the list. It never shows the exception text and never offers «إعادة المحاولة». The same applies to a record outside the user's branch scope (a localized «غير متاح لك» state, not a retry). | PLT-08, FIN-08, SAL-21, OPS-33 |
| R-STATE-6 | Forbidden (403) uses the shared localized state. It shows no create/manage actions, no counts and no empty-state CTA (extends H1-1 §2.5). | PLT-21/24, SAL-06, OPS-12 |
| Verify | `probe-states.cjs` per changed route (empty / loading / error / forbidden), plus a Vitest per state component. | |

### R-CONFIRM — friction proportional to the cost of a mistake
Tiers (A3 §8, adapted):

| Tier | When | Pattern |
|---|---|---|
| **T0** | Reversible, local: save draft, add a line, change a filter | No dialog. A toast that names the result |
| **T1** | Reversible by the user but consequential: delete a draft, remove a row, discard unsaved changes, disable a setting | `ConfirmDialog` (`tone: 'danger'` for delete/disable). The title is a question naming the object; the confirm button names the action («حذف المسودة», not «نعم/موافق»); the cancel button is «إلغاء» |
| **T2** | **Posts to the ledger or moves money**, or reversible only by a separate document: post invoice/credit note/return/manual journal/expense/receipt, payroll accrual and payment, treasury transfer, refund, confirm delivery, post an inventory opening / stock permit / stocktake / debit note, close a POS session | `ConfirmDialog` with a **summary**: document number, amount via `formatRiyal`, account/treasury/method, date. The confirm button names the action («ترحيل القيد», «صرف 6,000.00 ⃁ نقداً») |
| **T3** | Irreversible or company-wide: replace a whole settings list, remove tax definitions, mass actions on many records | T2 plus an explicit statement of scope («سيُستبدل كل…») and typed confirmation only when the action is both irreversible and wide |

| # | Rule | Evidence |
|---|---|---|
| R-CONFIRM-1 | Every T2/T3 action MUST confirm. No «post on create» default: a create dialog that also posts is labelled «إنشاء وترحيل» and confirms. | **FIN-01, FIN-02, SAL-02, OPS-02 (P0)**; FIN-07, SAL-05, OPS-10 |
| R-CONFIRM-2 | No `window.confirm`; the shared dialog only (19 product call sites; the `useConfirm()` fallback stays). | B5 |
| R-CONFIRM-3 | Focus returns to the invoking control after the dialog closes (H1-1 D4); the cancel label is never «إعادة المحاولة». | SAL-04, PLT-30 |
| R-CONFIRM-4 | A company-wide policy switch is never a side control on an operational form; it lives in its settings section with a T1 confirmation. | FIN-16 |
| Verify | Vitest: the action is not called before confirm, and is called once after. Browser: keyboard path and RTL button order. | |

### R-PERM — show only what the user can do
| # | Rule | Evidence |
|---|---|---|
| R-PERM-1 | Create / edit / post / delete / manage controls render only when `useCan()` allows the exact permission of the target route. View-only users see read-only pages, never full forms that end in 403. | FIN-09, SAL-10, PLT-15/16 |
| R-PERM-2 | Hiding is presentation only. Server guards and RBAC are unchanged; no permission is added or widened. | Plan §4.2 |
| Verify | Vitest per page with a view-only capability set, plus a browser check with the `staff` fixture. | |

### R-MONEY — numbers exactly as the server sends them
| # | Rule | Evidence |
|---|---|---|
| R-MONEY-1 | Every amount is shown with `formatRiyal` (2 decimals) and the `SAUDI_RIYAL_SYMBOL` U+20C1. No `formatRiyalShort` / `formatNumberShort` on financial KPIs. No «SAR», «ر.س», «ريال» or ﷼ as an amount unit in any human interface, including previews and PDFs (DESIGN_SYSTEM.md). | PLT-04, SAL-17, PLT-25, OPS-19 |
| R-MONEY-2 | **No new client-side financial aggregation.** Totals, balances, amounts due and counts by status come from the server. Where a screen sums today, the slice either uses an existing server value or records a backend dependency; it does not invent a rule. | SAL-03, PLT-06, FIN-24, SAL-30 |
| R-MONEY-3 | Messages that quote amounts show riyals, not halalas. | FIN-06 |
| R-MONEY-4 | Red/green appear only with a sign or financial meaning (negative / loss / overdue). Not for debit vs credit columns, not for kinds or statuses, not on `0.00`. | FIN-12, SAL-30/35, OPS-35 |
| R-MONEY-5 | The minus sign leads the number inside its direction isolation (v3 FOUNDATIONS §5 rule 5): «−5.00», never «5.00-», and it does not wrap away from the digits. | OPS-18 |
| Verify | Parity check of every changed amount against the API field contract (plan §5.1), plus the `money.test.ts` guard. | |

### R-VALID — one validation pattern
(A3 §2 candidate C2.x; Primer and Carbon disagree on disabled submit. AWJ decision below.)

| # | Rule | Evidence |
|---|---|---|
| R-VALID-1 | Forms set `noValidate`. No native browser bubbles (they appear in English). | PLT-11, FIN-14, SAL-20 |
| R-VALID-2 | Errors are inline under the field (`aria-invalid` + `aria-describedby`). With more than 3 errors, a summary at the top lists them as links to the fields, and focus moves to the summary (or to the first invalid field). | FIN-14, SAL-22 |
| R-VALID-3 | The submit button stays **enabled** except while submitting. Clicking it reveals what is missing, instead of a silently disabled button. | FIN-14, PLT-13, SAL-22, OPS-27 |
| R-VALID-4 | Server 422 errors map to their fields with the client's localized text, by code where the API gives one, otherwise by field name. A raw English message is never shown (R-TEXT-1). | PLT-10, FIN-08, OPS-16 |
| R-VALID-5 | **Values are never silently rewritten.** Out-of-range input is rejected with a message, not clamped, rounded or dropped. | PLT-02, SAL-23 |
| R-VALID-6 | Required fields carry a visible marker and `aria-required`. | FIN-14 |
| Verify | Vitest for empty submit, invalid submit and server 422 mapping; keyboard path. | |

### R-TEXT — the user's language, not the system's
| # | Rule | Evidence |
|---|---|---|
| R-TEXT-1 | No raw server text, exception, model name or internal code in the UI («No query results for model…», «Server Error», `safety_check_pending`, `CashBankTransfer`, permission keys, `fields.*`). Map to catalog strings; unknown codes fall back to a localized generic message. | PLT-19, FIN-08/11/32, SAL-21, OPS-20 |
| R-TEXT-2 | No developer jargon in user copy («layout», «ListView», «float», «append-only», «token أو secret»). Domain terms (COGS, GRNI) appear only where the role uses them, with a plain label. | PLT-23/25 |
| R-TEXT-3 | English mode: every chrome string comes from the catalog, including `aria-label`s (e.g. the date-picker label `input.tsx:179`). System roles (`is_system`) display their name through the catalog, keyed by `slug` (`app/Models/Role.php`). User-editable records (treasury, account, product, partner names) are tenant data and stay as stored: that is D-ERP-UX-01 / `name_en`, outside H2. | FIN-25/32, A1 §4 |
| R-TEXT-4 | Two screens never share one title. | FIN-20 |
| R-TEXT-5 | The mono numeric face applies to digits only; Arabic words and labels never render in it (letters lose their joining). | OPS-17, PLT-35, FIN-29 |

### R-NAV, R-DATE, R-LINK
| # | Rule | Evidence |
|---|---|---|
| R-NAV-1 | Exactly one sidebar item is active per route. | PLT-33, FIN-30, SAL-33 |
| R-NAV-2 | After create, land on the created record's detail (or stay with a toast linking to it); never silently on the list. | SAL-29/31, PLT-13 |
| R-LINK-1 | A posted document shows its journal entry number as a link, and links to related documents (credit notes, returns, payments, reversal) where the API returns them. Where it does not, record a backend dependency; do not compute links. | FIN-10, SAL-08 |
| R-DATE-1 | Default document dates are today's date in the **tenant timezone** (`company.timezone`, `web/src/lib/timezone.ts`), never the UTC date from `toISOString()` and never the browser's zone. | SAL-11 |
| R-DATE-2 | One display format per surface: inputs and tables use the same convention per locale (decided in B1). | FIN §4.7 |

### R-A11Y (additions to H1)
| # | Rule | Evidence |
|---|---|---|
| R-A11Y-1 | Combobox and select: after a keyboard choice, focus stays on the control (WCAG 2.4.3). | SAL-12 |
| R-A11Y-2 | Each page has one `h1` (including the POS workspace and the supplier ledger/statement). | A1 §4, PLT-23 |
| R-A11Y-3 | Text contrast ≥ 4.5:1, including badges («مسودة» `bg-muted` + `text-muted` is 1:1). | FIN-17, SAL-16 |
| R-A11Y-4 | Floor (POS) and touch targets ≥ 44 px; Ledger targets ≥ 24 px with WCAG exceptions. | A1, PLT-26, OPS-30 |
| R-A11Y-5 | Every control has an accessible name; in repeated rows the name includes the row's item («حذف المتغيّر أحمر», «الكمية المعدودة: Filter»). Decorative images use `alt=""` so they do not prefix names. | OPS-08, OPS-31 |

## 3. Page patterns

Each pattern names the shared components to use (existing, `components/nebrax/*` + `data-table.tsx`). **A screen that needs something the pattern lacks extends the shared component, not a local copy** (HORIZONS §2A).

### P-LIST — list page
- **Anatomy:** `PageHeader` (h1, one primary action, overflow menu for secondary actions) → `ListToolbar` (search + quick filters + active filter chips + «مسح الكل») → `DataTable` (sortable headers as the only sort control; column chooser; density toggle O-06, list-only, `localStorage`) → `Pagination` (hidden when there is one page and no rows).
- **Rules:**
  - Filters live in the URL.
  - Bulk actions appear on selection only.
  - Row actions go at the logical end.
  - Status uses one badge style (glyph + text).
  - Mobile uses `MobileRecord` cards (title, amount at the end, status, 1–2 secondary facts).
- **States:** R-STATE. The empty state names the next step and its CTA respects R-PERM.
- **Replaces (A2):**
  - 3 sort controls per list.
  - Raw `<table>` lists (58 pages).
  - Hand-built tab strips (HR).
  - «0 نتيجة · صفحة 1 من 1» on empty lists.

### P-FORM — create/edit form (non-document)
- **Anatomy:** `FormPage` (h1, back link) → `FormSection`s (titled groups, 1–2 columns at ≥ 1024, 1 column below) → `FormActions` (primary + «إلغاء»), sticky at the bottom on long forms → `FormAlert` for the error summary.
- **Rules:**
  - R-VALID throughout.
  - Unsaved-changes guard on leave (T1).
  - Pickers longer than ~10 options use `Combobox` with search, not a native select.
  - Dates use the shared date input.
- **Replaces (A2):**
  - Four scaffolds and Save-at-top variants (FIN §4.1).
  - Native datetime-local.
  - Native selects for customers, products and accounts.

### P-DOC — financial document (create, view, post)
- Follows v3 **Document Workspace + Totals Dock** (already implemented on Sales Invoice). Waves C1/C4/C5 extend it to quote, credit note, delivery note, recurring, payment, expense, receipt, custody and manual journal, **one domain variant per slice** (DOCUMENT_WORKSPACE §12).
- **Rules:**
  - Lifecycle from real states only.
  - Totals from the API.
  - Post = T2.
  - Posted = read-only with JE link (R-LINK-1).
  - No new lifecycle states and no draft-posting preview (O-03 stays separate).

### P-DETAIL — master record and non-document detail
- **Anatomy:** `DetailPage` (h1 + status + primary actions) → `DetailSummary` (server values only) → sections or tabs.
- **Rules:**
  - Opening a record lands on its view, not on an edit form (branches, PLT-13).
  - Edit is an explicit action.
  - Amounts follow R-MONEY-2.

### P-SETTINGS — settings centre and sections
- **Anatomy:** hub with grouped section cards → section page with `PageHeader` + `FormSection`s → one Save per section in `FormActions` (sticky).
- **Rules:**
  - R-STATE-3 (not editable until loaded).
  - R-VALID-5 (no silent rewrite).
  - T1/T3 for removals and list replacement.
  - The unsaved-changes guard applies.
  - A disabled switch says why.
- **Replaces (A2):** Save in the header, at the top of a card, or below a map; blank pages on load error.

### P-REPORT — report page
- Keeps the «تحليل أولاً» rule (DESIGN_SYSTEM.md layout principle 7): h1 + period/scope chip → filters → summary → details, with the A4 preview behind «معاينة التقرير».
- **Rules:**
  - The period shown is the period sent to the API. Where an API ignores dates, the UI says so (backend dependency).
  - An inverted range is a validation error.
  - Errors follow R-STATE (no «لا توجد أرصدة» on failure).
  - One chrome for all report families (back link, description, exports).
- **Replaces (A2):** FIN-03/04/13/26.

### P-FLOOR — POS (and forecourt if O-14 says so)
- Follows WORKSPACE_POSTURES §6:
  - ≥ 44 px targets, scanner/keyboard focus, short-height 1280×720 and 390 portrait.
  - Cart → payment → result hierarchy.
  - h1 present (visually hidden is acceptable).
- **Rules (A2 OPS):**
  - A scan never activates the focused control: the scanner consumes its terminating Enter, and focus leaves a tile after a tap (OPS-04).
  - The amount due is readable at every width (R-A11Y-3), and the paid / remaining / change strip is visible at 1280×720 without scrolling (OPS-05, OPS-22).
  - The cart shows the price the server will accept, from the same source as the variant picker (OPS-06).
  - A checkout error is shown inside the payment pane, never only in code or under a toast that covers the total (OPS-01 UI part, OPS-22).
  - Opening payment moves focus into it; the default method comes from configuration, not alphabetical order (OPS-24).
  - A rule that blocks confirm (a registered customer is required) is visible before confirm (OPS-11).
  - An out-of-stock tile is disabled with its reason **only when `inventory.allow_negative_stock` is off**; otherwise it stays enabled with the out-of-stock marker (OPS-25).
  - Closing a session shows the live over/short amount **unless blind cash count is enabled** (`pos.blind_cash_count_enabled`, where the server withholds the expected amount); it confirms (T2) when the amount is not zero, or always in blind mode, and lands on the session's Z report (OPS-10).
  - The cart shows subtotal, discount and tax before payment (OPS-35), **reusing the cart computation the payment pane already shows** (`pos/page.tsx`); the server stays authoritative at checkout, and no new tax or pricing rule is added.
- **A posture rule never overrides a tenant setting.** Where a configurable policy exists (`Settings`, `PosSettings`, `BranchSettings`), the UI follows the setting; the rule describes the default presentation only (CLAUDE.md rule 6).
- No change to sale, payment or inventory logic.

### P-STUDIO — Store Customizer and App Builder
- Follows WORKSPACE_POSTURES §7 (graphite editor chrome, canvas/inspector/tree, draft/save/publish clarity).
- **Rules:**
  - App Builder adopts the same Studio chrome as the Customizer.
  - Publish is disabled with a visible reason (not a tooltip only) when there is nothing to publish.
  - No sample-store identity when no store exists.
- UI only (D7): no change to persistence, versions or publish logic. A conflict notice that the UI cannot explain is a backend dependency.

## 4. Acceptance per code slice
The plan §8 criteria 1–11 apply, plus, for each slice:
1. **Rule list:** the `R-…` and `P-…` ids the slice satisfies, each with a before/after evidence line.
2. **Surface:** the slice is classified **v3-only** or **all-surfaces** (plan §3). All-surfaces slices are verified on both.
3. **Scope check:** no new local component when a shared one exists. Shared-component changes come first with a proof screen.
4. **Prohibited areas untouched:** API, RBAC, accounting, persistence, migrations (diff review).
5. **Visual verification matrix (themes):**
   - Default in every capture. Core Light and Ink as samples, as the plan §5 note sets out after AWJ Core was merged (#1522, D-41).
   - **Core Dark is recorded as evidence only** until its Dark-mode follow-up closes.
   - Floor and Studio are verified on Default only, because they adopt neither Ink nor Core.
   - A slice never edits theme tokens, generated token blocks, `awj-theme` or the shell focus rule (A2 §10).

## 5. Decisions recorded here (AWJ Decision) and not adopted
- **AWJ Decision:**
  - T0–T3 tiers.
  - Submit stays enabled (Primer) rather than disabled (Carbon), except while submitting.
  - `noValidate` everywhere.
  - Numbers at the logical end.
  - Create lands on the record.
  - Density toggle on lists only (O-06).
  - Studio chrome for App Builder.
- **Not adopted:**
  - **Deleting posted documents together with their entries:** Daftra and Zoho allow it; it conflicts with ledger immutability (A3 §8).
  - **Void without a reversing entry:** same reason.
  - **Client-computed balances:** they conflict with R-MONEY-2.
  - **A snapshot regression gate:** D5.
  - **Typed confirmation for every delete:** excessive. T3 only.
  - **From A3 «Not adopted / caution»:** collapsed (icon-only) search on lists; row actions visible on hover only (unreachable by touch and keyboard); floating labels on desktop forms; auto-save on financial documents (explicit Save and Post stay); a recycle bin for posted documents (conflicts with immutability; drafts delete with T1).

## 6. Backend and owner dependencies surfaced by A2 (outside H2, listed for routing)

| Item | Why it is not UI |
|---|---|
| `/applications` shows «مفعّلة 0» for tenants registered before 2026-08-21 while enforcement treats capabilities as enabled (PLT-07) | `TenantApplicationService::stateFor()` intentionally shows stored state; aligning it is a backend/owner decision |
| Invoice «المتبقي» ignores posted credit notes and returns (SAL-08) | Settlement semantics: ADR needed. The SAL-03 hotfix uses the ledger balance the partner page already fetches (statement `closing_balance`); only a per-invoice due view depends on SAL-08 |
| Credit note vs return rounding differs by 0.01–0.02 (SAL-14) | Backend tax/rounding: accounting decision |
| Branch-scoped user sees tenant-wide cash and receivables (SAL-13) | Record-scope policy for account balances: owner decision |
| Company field cannot be cleared (PLT-03); aging API ignores dates (FIN-03); recurring **pause/edit** (SAL-09: only `DELETE recurring-invoices/{id}` exists, used for «stop» in C1) | Backend fixes or contract |
| Server values R-MONEY-2 needs but no endpoint provides: dashboard KPIs except `dashboard/sales-breakdown` (PLT-06); group account balances return `"0.00"` (FIN-24); treasury movements (FIN-22, no endpoint); provisional stocktake value and stock-permit draft cost (OPS-13, OPS-14) | Backend: until each exists, the slice keeps today's display and adds no new browser aggregation |
| Configured payment methods ignored by receipt/expense/custody (FIN-21) | Product decision on where methods apply |
| `name_en` on report rows (D-ERP-UX-01) and on partners/products display in EN | Separate owner decision (unchanged) |
| **POS checkout 422 for every product without a unit template (OPS-01, P0)** | `InvoiceService` resolves the POS base-unit name through `UnitConversion::resolve`, which throws without a template; delivery notes map the base unit to `null`. Backend fix |
| **Supplier/customer statement drops refunds under `partner_role` (OPS-03, P0)** | `ReportService::partnerStatementSourceRoles` has no refund mapping. Backend fix (financial report) |
| Opening-stock preview passes variant parents that posting rejects; preview counters (OPS-09, OPS-15) | Import preview rule and counters are server-side |
| Branch-scoped staff read company-wide warehouse stock (OPS-32); custody settlement allows any posting account (FIN-23) | Owner policy (configurable-policies) |
| `DESIGN_SYSTEM.md` «الأرقام يمين» wording and U+1EE01 glyph in docs (A1) | Docs sync only |
