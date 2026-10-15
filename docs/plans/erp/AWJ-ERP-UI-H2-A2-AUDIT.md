# AWJ-ERP-UI-H2 · A2 — State and workflow audit, consolidated backlog

STATUS: evidence only (no product code) · DATE: 2026-10-15 · Phase A (D3) · For the owner's **Decision Gate**
Plan: [AWJ-ERP-UI-H2-START-PLAN.md](AWJ-ERP-UI-H2-START-PLAN.md) §5.1 and §7 · Baseline: [A1 report](reports/AWJ-ERP-UI-H2-A1-REPORT.md) · Contract: [A4](AWJ-ERP-UI-H2-1-UI-CONTRACT.md) · References: [A3](h2-a-evidence/A3-REFERENCE-RESEARCH.md)

## الملخص (للمالك)

- دُقّقت **كل وحدات ERP الموجودة** في أربع مجموعات متوازية، بالحالات (فارغ/تحميل/خطأ/ممنوع/قراءة فقط/تحقق/نص طويل/بيانات كثيرة) و**مسارات عمل حقيقية** من البداية للنهاية في متصفح فعلي، لا لقطات فقط: فاتورة ← ترحيل ← تحصيل، مرتجع، إشعار دائن، بيع POS كامل وإقفال جلسة، رصيد افتتاحي، تحويل مخزني، جرد، دورة مشتريات كاملة، قيد يدوي ← عكس، مسيّر رواتب ← صرف، تحويل خزينة، إعدادات الضرائب، والمزيد.
- **147 ملاحظة**: ‏**9 P0** · 29 P1 · 86 P2 · 23 P3، مُجمَّعة في **28 بنداً موحّداً** (`ERP-UI-H2-001..028`) مربوطة بقواعد عقد A4 وبشرائح B/C.
- **الأرقام المالية مطابقة للـAPI** في كل ما فُحص، **إلا ثلاثة**: مستحق العميل في صفحة الطرف يُحسب في المتصفح ويخطئ (SAL-03)، وكشف المورّد يُسقط استرداد المورّد (OPS-03، خلل خادمي)، ولوحة التحكم تعدّ المسودة غير مدفوعة وتجمع النقد في المتصفح (PLT-06).
- **العزل سليم:** مستأجر ب لم يظهر في أي قائمة أو منتقٍ. المستخدم المقيّد بفرع لا يرى مستندات الفرع الرئيسي؛ لكنه يرى أرصدة المؤسسة في لوحة التحكم ومخزون المخازن المؤسسية (قراران للمالك: SAL-13، OPS-32).
- **أخطر نمطين متكررين:** (١) إجراء لا يُعكس (ترحيل/صرف/حذف/إقفال) بنقرة واحدة بلا تأكيد في **أكثر من 15 موضعاً**؛ (٢) خطأ تحميل يتحوّل إلى «لا توجد بيانات» أو «0 ⃁» — وفي الإعدادات إلى **نموذج فارغ قابل للحفظ يمحو الإعداد الحقيقي**.
- **قرارات مطلوبة منك** في §9: إصلاح عاجل لـP0 (واجهة فقط)، ومسار خلفي منفصل لخللين خادميين (POS لا يبيع منتجاً بلا قالب وحدات؛ كشف المورّد)، وO-14 (الوقود: Ledger)، وقرارات السياسة، وإطلاق B/C.

## 1. Method and coverage

| Group | Modules | Report (verbatim) | Evidence |
|---|---|---|---|
| **PLT** | Settings & admin, Commerce Admin, App Builder, Store Customizer, Fuel, Documents, Dashboard, Auth/self-service | [A2-PLT.md](h2-a-evidence/A2-PLT.md) | [`a2/plt/`](h2-a-evidence/a2/plt/) (15) |
| **FIN** | Accounting, Finance, Reports, HR | [A2-FIN.md](h2-a-evidence/A2-FIN.md) | [`a2/fin/`](h2-a-evidence/a2/fin/) (15) |
| **SAL** | Sales, Customers | [A2-SAL.md](h2-a-evidence/A2-SAL.md) | [`a2/sal/`](h2-a-evidence/a2/sal/) (17) |
| **OPS** | POS, Inventory & products, Purchases | [A2-OPS.md](h2-a-evidence/A2-OPS.md) | [`a2/ops/`](h2-a-evidence/a2/ops/) (16) |

- **Environment:** the A1 fixture (local production build of `web/`, Laravel on a separate SQLite file; tenants A/B/C; unscoped and branch-scoped `staff`). Every write went through the UI or the public API; records are tagged `H2-A2-<GROUP>` and listed in each group report §8.
- **Each group report has:** a screens-covered list; a **state matrix** per route (empty, loading, error, forbidden, read-only, validation, long text, many rows); a **workflow table** (clicks, result, findings, evidence); consistency notes; financial-number parity; findings with *Observed* separated from *Direction*; and what was not verified.
- **States** combine the A1 state probe ([`tools/probe-states.cjs`](h2-a-evidence/tools/probe-states.cjs), 4 states on every route) with targeted runs by each auditor (simulated 500, delayed APIs, staff tokens, invalid input, long names).
- **Screen atlas:** [أطلس شاشات أَوْج H2](https://claude.ai/artifact/XY24Jjnb9ofHzk5EZ4JvCZ) (private to the owner). 228 in-scope screens from the A1 crawl, with desktop 1440 and phone 390 side by side. Each screen shows the backlog items of §4 that touch it, and the atlas also carries the Decision Gate list of §9. Full screenshots (1,392 baseline, 800 state-probe and about 1,370 workflow shots) stay outside git; the curated ones are committed.
- **P0 findings were re-checked in the code** before this document (§3, "Verified").

## 2. Headline numbers

| | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| PLT | 1 | 6 | 22 | 8 | 37 |
| FIN | 2 | 5 | 21 | 7 | 35 |
| SAL | 3 | 11 | 18 | 7 | 39 |
| OPS | 3 | 7 | 25 | 1 (bundle of 9) | 36 |
| **All** | **9** | **29** | **86** | **23** | **147** |

**Financial-number parity.** Every checked document, list, statement, report and POS figure equals the API value formatted by `formatRiyal`, except SAL-03, OPS-03 and PLT-06 (§3). Format deviations (old ﷼ sign, «SAR», dropped trailing zeros, halalas in an error) are ERP-UI-H2-010.

**Isolation.** Tenant B's canary never appeared. Branch-scoped staff saw none of the main branch's documents. Two scope questions go to the owner (SAL-13, OPS-32); they are not leaks under the current rules.

## 3. P0 — must not wait for the waves

| # | Finding | Where | Layer | Verified in code | Proposed handling |
|---|---|---|---|---|---|
| 1 | **PLT-01** A failed load of tax rates shows an empty list; Save sends `PUT {"data":[]}` and would delete every VAT rate | `/tax-settings` | UI | `tax-settings-card.tsx`: `.catch(() => setRows([]))`, Save PUTs the full list | Hotfix (UI): no inputs and no Save until loaded; error state with retry (R-STATE-3) |
| 2 | **SAL-01** Same pattern in sales settings (orders, statuses, fields, shipping, sources): blank savable form after a load error overwrites real config | `/sales-settings/*` | UI | `sales-config/config-form.tsx:49`, `config-list-editor.tsx:47` | Hotfix (UI), same fix as #1 |
| 3 | **FIN-01** Payroll accrual and cash/bank payment post on one click | `/hr?tab=runs` dialog | UI | `components/hr/run-detail-dialog.tsx:74` | Hotfix (UI): `useConfirm` with amount, method, treasury |
| 4 | **FIN-02** Treasury transfer posts with no confirmation | `/cash-and-bank/transfer` | UI | `cash-and-bank/transfer/page.tsx:49` | Hotfix (UI) |
| 5 | **SAL-02** Return dialog posts on «إنشاء» («ترحيل فوري» pre-checked) | Return dialog (sales; OPS-02 for purchases) | UI | `returns/create-return-dialog.tsx:86` (`postNow` default `true`) | Hotfix (UI): default to draft; post behind confirmation |
| 6 | **OPS-02** Opening, stock permit, stocktake, debit note, supplier refund post (and opening draft deletes) on one click | inventory and purchase detail pages | UI | `stock-permits/[id]/page.tsx:44`, `stocktaking/[id]/page.tsx:88`, `inventory-openings/[id]/page.tsx:39`, `credit-notes/[id]/page.tsx:164` (debit note), `supplier-refunds/[id]/page.tsx:64`: no `useConfirm`; the purchase return is `create-return-dialog.tsx:86` (#5) | Hotfix (UI) |
| 7 | **SAL-03** Partner page computes "amount due" in the browser and shows 4,480.00 where the ledger closes at 3,566.56 | `/partners/:id` | UI | `partners/[id]/page.tsx` 126–151: `Number()` sum of invoice `remaining` (ignores credit notes, returns) | Hotfix (UI): show the ledger balance the page already fetches (statement `closing_balance`, `partners/[id]/page.tsx:120`); remove or label the per-invoice overdue figure until SAL-08 is decided |
| 8 | **OPS-01** POS checkout fails (422) for every product without a unit template, which is every default product; no visible error at 1440×900 | `/pos` | **Backend** + UI | `InvoiceService.php:546` resolves the POS unit name `piece` through `UnitConversion::resolve`, which throws without a template; `DeliveryNoteService.php:283` maps the base unit to `null`, POS does not | **Separate backend fix** (not H2); the UI part (show the checkout error) rides C2 |
| 9 | **OPS-03** Supplier statement and ledger omit a posted supplier refund (closing 8.92 instead of −19.60); the label calls a debit position a credit balance | supplier statement/ledger | **Backend** | `ReportService::partnerStatementSourceRoles` (`ReportService.php:685`) maps invoices, purchases, payments, credit notes and returns, **not** supplier/customer refunds, so `partner_role` filtering drops them | **Separate backend fix** (financial report; likely affects customer refunds on the customer statement too) |

Items 1–7 are UI-only, small and independent. They are outside D3 (no code before the gate), so they need the owner's explicit go (§9, decision 1). Items 8–9 are backend defects in financial paths; under the plan (§4.2) they leave H2 and need their own task.

## 4. Consolidated backlog

Priority = highest source finding. **Rule** = the A4 contract rule that fixes it. **Slice** = where it lands. Layer **UI** unless stated.

| ID | Theme | Source findings | P | Rule (A4) | Slice |
|---|---|---|---|---|---|
| ERP-UI-H2-001 | Load failure becomes a savable empty settings form | PLT-01, SAL-01, PLT-14 | P0 | R-STATE-3 | Hotfix → B4 |
| ERP-UI-H2-002 | Irreversible action without confirmation (post, pay, delete, close session, status change, company-wide toggle) | FIN-01, FIN-02, FIN-07, SAL-02, SAL-05, OPS-02, OPS-10, OPS-28, FIN-16, PLT-02 | P0 | R-CONFIRM-1..4 | Hotfix (P0 subset) → **B5 widened** beyond `window.confirm` |
| ERP-UI-H2-003 | Financial totals computed in the browser | SAL-03, PLT-06, SAL-27, FIN-24, SAL-30 | P0 | R-MONEY-2 | Hotfix (SAL-03: statement `closing_balance`) → C1; PLT-06/FIN-24 need server values (§8) |
| ERP-UI-H2-004 | POS checkout unit name (backend) and invisible checkout error | OPS-01 | P0 | P-FLOOR | **Backend task** + C2 |
| ERP-UI-H2-005 | Partner statement drops refunds (backend) | OPS-03 | P0 | — | **Backend task** |
| ERP-UI-H2-006 | Error, 403 or loading shown as "no records", `0 ⃁` or a blank page | SAL-06, SAL-07, PLT-05, PLT-12, FIN-04, FIN-05, OPS-12, PLT-24 | P1 | R-STATE-1, 2, 4, 6 | **B4** (one state component) + B2 |
| ERP-UI-H2-007 | Actions not aware of permissions (full forms, then 403 after submit) | FIN-09, SAL-10, PLT-15, PLT-16, PLT-24 | P1 | R-PERM-1..2 | B1 + each wave (UI hides by `permissions`; RBAC unchanged) |
| ERP-UI-H2-008 | Validation: 6 patterns, English server text, native bubbles, errors far from fields | PLT-09, PLT-10, PLT-11, PLT-13, FIN-08, FIN-14, SAL-15, SAL-20, SAL-22, OPS-16, OPS-27 | P1 | R-VALID-1..6 | **B3** |
| ERP-UI-H2-009 | Not-found and out-of-scope detail pages: raw `No query results for model…`, pointless retry, blank edit form, no h1 | PLT-08, FIN-08, SAL-21, OPS-33 | P2 | R-STATE-5 | B4 |
| ERP-UI-H2-010 | Money format drift: old ﷼, «SAR», short format, halalas, minus side, red/green without financial meaning | PLT-04, SAL-17, OPS-19, OPS-18, FIN-06, FIN-12, SAL-30 | P1 | R-MONEY-1, 3, 4, 5 | B2 (cells) + C waves |
| ERP-UI-H2-011 | POS Floor: scan double-add, amount due invisible below 1024 px, variant barcode price, session close shortage, walk-in customer, payment layout at 720/900 px, out-of-stock tile, `/pos/start` dead end, long logs | OPS-04, 05, 06, 10, 11, 22, 23, 24, 25, 27, 31, 34, 35 | P1 | P-FLOOR | **C2** (no change to sale, payment or stock logic) |
| ERP-UI-H2-012 | Accessibility: unnamed inputs/buttons, focus lost after Combobox, tiny variant controls, tile names start with company name, Arabic `aria-label` on every date field | OPS-08, SAL-12, OPS-30, OPS-31, PLT-30, FIN-25 | P1 | R-A11Y-1, 4, 5; R-CONFIRM-3; R-TEXT-3 | B3 (shared Combobox, date input) + C2/C3 |
| ERP-UI-H2-013 | Sales documents: «إلغاء» labelled «إعادة المحاولة», recurring schedule cannot be stopped (API `DELETE` exists), UTC default date, preselected customer, no link to the created document, DN→invoice resubmittable | SAL-04, SAL-09 (stop via the existing `DELETE`, with confirmation), SAL-11, SAL-18, SAL-19, SAL-29, SAL-31, SAL-32, SAL-28 | P1 | P-DOC, R-CONFIRM-3, R-DATE-1, R-NAV-2 | C1 |
| ERP-UI-H2-014 | Raw codes and keys in Arabic UI: statuses, event codes, class names, permission keys, `posAudit.eventLabels.*`, `fields.*` | PLT-19, OPS-20, FIN-11, FIN-20, FIN-32, PLT-37, A1 raw keys (`/documents/governance`, `/roles`) | P2 | R-TEXT-1, 3, 4 | Each wave (catalog strings only; `name_en` stays separate) |
| ERP-UI-H2-015 | Typography and tone: monospace on Arabic words, invisible «مسودة» badge (1.00:1), two sidebar items highlighted | OPS-17, PLT-35, FIN-29, FIN-17, SAL-16, PLT-33, FIN-30, SAL-33 | P2 | R-TEXT-5, R-A11Y-3, R-NAV-1 | B1 (shell, badge tone) |
| ERP-UI-H2-016 | List pattern drift: three sort controls, missing status column, `/supplier-refunds` off-pattern, native selects for long lists, HR tabs, pager on empty lists, plurals | SAL-25, SAL-26, SAL-34, OPS-29, FIN-27, FIN-28, PLT-36 | P2 | P-LIST | **B2** (+ O-06 density) |
| ERP-UI-H2-017 | Form scaffold drift and copied labels («اختر العميل» on supplier fields, «إضافة منتج» for an option value, quantity buttons named "return") | FIN-15, SAL-24, OPS-21, OPS-26, PLT-13, SAL-31 | P2 | P-FORM | B3 + C1/C3/C4 |
| ERP-UI-H2-018 | Accounting traceability: posted documents do not link their journal entry or reversal; transfers and payroll expose no JE | FIN-10; SAL-08 counted as a dependency (§8), not a source, so the item stays at FIN-10's priority | P2 | R-LINK-1 | C5 (display only; links only where the API returns them) |
| ERP-UI-H2-019 | Commerce Admin, App Builder, Store Customizer: placeholder home, sample store shown without a store, "edited in another session" on a fresh session, developer terms, publish enabled on an empty app | PLT-18, PLT-22, PLT-23, PLT-31, PLT-32 | P2 | P-STUDIO | C9 (UI only; persistence untouched) |
| ERP-UI-H2-020 | Document Center: raw statuses, rejected file kept in upload dialog, forbidden message hidden | PLT-19, PLT-20, PLT-21 | P2 | R-STATE-6, R-VALID-2, R-TEXT-1 | C11 |
| ERP-UI-H2-021 | Fuel: create buttons and `0` counts on forbidden/error screens, errors out of view, technical terms, 390 targets | PLT-24, PLT-25, PLT-26, PLT-29 | P2 | P-LIST/P-FORM (Ledger) | C10 (O-14, §7) |
| ERP-UI-H2-022 | Inventory flows: opening preview passes variant parents that posting rejects, wrong counters, stock-permit draft cost 0.00, no over-stock warning, stocktake value hidden until posted | OPS-09, OPS-13, OPS-14, OPS-15 | P1 | P-DOC | C3 (preview rule, counters, provisional stocktake value and permit draft cost: **backend**, §8) |
| ERP-UI-H2-023 | Purchases: RFQ has no supplier field (dead end), 11 status clicks, invoice from PO has no warehouse | OPS-07, OPS-28 | P1 | P-DOC | C4 (verify API before UI) |
| ERP-UI-H2-024 | Reports: inverted range not validated, families differ in chrome/exports, aging ignores the period shown | FIN-13, FIN-26, FIN-03 | P1 | P-REPORT | C6 (aging: **backend**) |
| ERP-UI-H2-025 | Auth and self-service: English throttle message, `/me` without employee, `/reset-password` without token | PLT-09, PLT-27, PLT-28 | P2 | R-STATE-5, R-TEXT-1 | C12 (no auth logic change) |
| ERP-UI-H2-026 | Dashboard: KPIs in short format, duplicated inventory card | PLT-04, PLT-38 | P1 | R-MONEY-1 | C11 |
| ERP-UI-H2-027 | Settings: rates silently rewritten (2.5→3, 150→100), clearing a company field says "updated" but keeps it, no unsaved-change guard | PLT-02, PLT-03, SAL-23 | P1 | P-SETTINGS, R-VALID-5 | C8 (PLT-03: **backend**) |
| ERP-UI-H2-028 | Finance details: custody filter ambiguous, treasury page lists transfers only, manual-journal editor race, configured payment methods ignored | FIN-18, FIN-19, FIN-22, FIN-21 | P2 | P-DOC | C5 (FIN-22 treasury movements and FIN-21: **backend/owner**, §8) |

P3 findings stay in the group reports and ride the wave of their module when the slice already touches the file.

## 5. Cross-module patterns (why B comes before C)

| Pattern | Seen in | Count | One shared fix |
|---|---|---|---|
| Error shown as empty, zero or blank | every group | 40+ routes | B4 state component; lists via `DataTable` (B2) |
| One-click irreversible action | SAL, FIN, OPS, PLT | 15+ actions | B5: `useConfirm` everywhere (19 `window.confirm` + these) |
| Full form for a user without permission, 403 after submit | SAL, FIN, PLT | 30+ screens | B1/B3: render by `user.permissions` (display only) |
| Validation patterns | all | 6 patterns | B3 field errors + summary; server messages mapped by `code` |
| Raw backend messages | all | 20+ | B4 not-found/forbidden; B3 422 mapping |
| Money format drift | SAL, OPS, PLT, FIN | 8 surfaces | B2 money cell + `formatRiyal` only |
| Kit adoption gap (A1) | — | 56 of 228 pages use `PageHeader`; 52 `DataTable`; 0 `MobileRecord` | B1/B2 migration |

## 6. Module state matrices (summary)

Derived from the per-route matrices in each group report §2 with one rule: ✓ = every verified route OK · ◐ = some routes ISSUE (half or fewer) · ✗ = more than half ISSUE · NV = most routes not verified.

| Module | Empty | Loading | Error | Forbidden | Validation | Many rows | Key workflows (result) |
|---|---|---|---|---|---|---|---|
| Sales | ✓ | ◐ | ✗ | ✗ | ✗ | ◐ (22 extra invoices; drafts counted as unpaid) | Invoice → post → pay → print ✓ · Return ✗ (posts on create) · CN ✓ (no confirm) · Recurring ◐ (cannot stop) |
| Customers | ✓ | ◐ | ✗ | ✗ | ✗ | ◐ | Partner summary ✗ (SAL-03) |
| POS | ◐ | ✓ | ◐ | ✓ | ✗ | ◐ | Sale ✗ for default products (OPS-01) · Sale with unit template ✓ · Close ◐ (hidden shortage) |
| Inventory | ✓ | ✓ | ◐ | ✓ (OPS-32 is an owner decision, not counted) | ◐ | NV | Opening ✓ / ✗ for variants · Transfer ✓ · Stocktake ✓ (no confirm) |
| Purchases | ✓ | ✓ | ✗ | ◐ | ◐ | NV | PR → RFQ ✗ (dead end) · PQ → PO → bill → pay ✓ · Return ✗ (posts on create) · DN/refund ✓ (no confirm) |
| Accounting | ✓ | ◐ | ✗ | ✗ | ◐ | NV | Manual journal → post → reverse ✓ (no confirm) |
| Finance | ✓ | ◐ | ◐ | ✗ | ◐ | NV | Expense ✓ · Receipt ✓ · Transfer ✗ (no confirm) · Custody ✓ |
| Reports | ✓ | ◐ | ◐ | ✓ | ✗ (inverted range) | NV | Trial balance parity ✓ · Aging ✗ (period ignored) |
| HR | ✓ | ◐ | ◐ | ◐ | ◐ | NV | Payroll → accrue → pay ✗ (no confirm) |
| Settings & admin | ✗ | ◐ | ✗ | ◐ | ◐ | NV | Tax settings ✗ (PLT-01) · Branch ✓ · Applications ◐ (PLT-07) |
| Commerce / App Builder / Customizer | ◐ | ✓ | ◐ | ◐ | ◐ | NV | App create ✓ · Customizer without store ◐ |
| Documents | ◐ | NV | ◐ | ◐ | ✗ (upload) | NV | Upload ◐ |
| Dashboard | ◐ | ✓ | ✗ | ◐ | N/A | NV | KPI parity ✓ except drafts and format |
| Fuel | ✓ | ✓ | ◐ | ✗ | ◐ | NV | Master data ✓ · Sale/receiving NV (bcmath locally) |
| Auth / self-service | ✓ | ✓ | ✓ | N/A | ◐ | N/A | Login NV (rate limit shared by auditors) |

## 7. O-14 — Fuel posture (evidence, D6)

From [A2-PLT §7](h2-a-evidence/A2-PLT.md): 11 of the 13 Fuel screens are back-office (dashboard, readiness, alerts, master data, devices, AVI/RFID, contracts, maintenance, safety, settings, receiving) and fit **Ledger**. `/fuel-stations/shifts` and `/fuel-stations/sales` are Ledger today; `sales` is the strongest **Floor** candidate (pump-side sale), but no screen has a pump/nozzle grid, keypad or touch layout, and at 390, 13 of 31–33 controls on sales/receiving and 9 of 27 on shifts are below 44 px. None is on the v3 surface (gate-excluded).

**Recommendation (AWJ Decision for the owner):** classify all 13 as **Ledger** for H2 (C10 = Ledger consistency, states, permissions, targets). Re-open Floor for `shifts`/`sales` only with a confirmed forecourt use case and a separate design slice.

## 8. Dependencies outside H2 (backend or owner policy — not fixed in H2)

| ID | What | Type |
|---|---|---|
| OPS-01 | POS sends the base unit name; `InvoiceService` resolves it against a missing unit template → 422 for every default product | **Backend defect, urgent** |
| OPS-03 | `partnerStatementSourceRoles` ignores supplier/customer refunds → wrong statement balance | **Backend defect, urgent (financial)** |
| PLT-03 | Clearing a company profile field returns success but keeps the old value | Backend defect |
| PLT-07 | `/applications` shows «مفعّلة 0 / الوصول مرفوض» for grandfathered tenants while nav-state and routes allow everything (`stateFor()` shows stored state by design) | Backend/owner (display contract) |
| SAL-08 | Invoice «المتبقي» ignores posted credit notes and returns | Owner/ADR (AR presentation) |
| SAL-13 | Branch-scoped user sees tenant-wide cash and receivables on the dashboard | Owner policy |
| SAL-14 | Credit note and return for the same line round differently (506.71 vs 506.73) | Backend (rounding contract) |
| FIN-03 | Aging endpoints take no period | Backend |
| FIN-21 | Configured payment methods not offered on receipts/expenses/custody | Backend/owner |
| FIN-23 | Custody settlement allows any posting account (VAT output, revenue, capital) | Owner policy (configurable-policies) |
| OPS-09, OPS-15 | Opening preview rule and counters disagree with posting | Backend |
| SAL-09 | Recurring schedule **pause/edit**: only `DELETE recurring-invoices/{id}` exists (stop rides C1) | Backend |
| PLT-06, FIN-24, FIN-22, OPS-13, OPS-14 | Server values R-MONEY-2 needs: dashboard KPIs (only `dashboard/sales-breakdown` exists), group account balances (API returns `"0.00"`), treasury movements (no endpoint), provisional stocktake value and permit draft cost | Backend; until then slices keep today's display and add no browser aggregation |
| OPS-32 | Branch-scoped staff can read company-wide warehouse stock | Owner policy |
| `name_en` | D-ERP-UX-01 (Arabic data in EN) | Separate, unchanged |

## 9. Decision Gate — decisions requested

1. **P0 hotfix (UI only, outside D3, all-surfaces):** the behaviour reaches users of the legacy surface too on the next deploy (merge ≠ deploy, D2/D8). Approve a small slice now for §3 items 1–7 (load-error guard on tax and sales settings; confirmation on payroll, transfer, return, inventory/purchase posts; server balance on the partner page)? Each is local, with tests, no API/accounting change.
2. **Backend track:** open a separate task for OPS-01 (POS unit) and OPS-03 (statement refunds)? Both touch financial/sales paths and need full `php artisan test` and the journal tables of CLAUDE.md.
3. **O-14:** accept "Fuel = Ledger for H2" (§7)?
4. **Policy questions:** SAL-08 (remaining after CN/returns), SAL-13 and OPS-32 (branch scope of dashboard and warehouses), FIN-23 (custody accounts), PLT-07 (applications display).
5. **A4 contract:** approve [AWJ-ERP-UI-H2-1-UI-CONTRACT.md](AWJ-ERP-UI-H2-1-UI-CONTRACT.md) as the H2 rulebook.
6. **Launch B then C** in the plan order, with B5 widened to all irreversible actions (ERP-UI-H2-002) and B4 first among B (largest spread).

## 10. Coordination with parallel work

- **Third theme for Design System v3 (owner notice, 2026-10-15):** a separate, independent task is adding a third theme to the v3 design system. It is still in development and its branch is **not merged into `main`**. H2 phase A is unaffected (docs and evidence only), and H2's scope is unchanged.
- **Before any shared change in phase B:** check the status of that branch first (merged or not, and which tokens and components it touches). Shared changes here means tokens, `components/nebrax/*`, `components/ui/*`, `data-table.tsx`, the shell, and the theme/`data-awj-ui` gate. Rebase B slices on it when it merges, so the two efforts do not conflict. In particular:
  - B1 (shell, badge tone).
  - B2 (list cells, money cell).
  - B4 (state component).
  - Contract rules that depend on colour and contrast: R-A11Y-3, R-MONEY-4, and the Floor amount-due contrast.

  Each must be verified on the new theme as well as the existing ones once it exists.

## 11. Not verified (all groups)

Legacy surface for most workflows; 200% zoom and the Ink theme; Firefox/WebKit (Q1); real screen readers and devices; real login (shared rate limit); Fuel sale/receiving/reconciliation (`bcmath` missing locally, green in CI); Studio publish; document extraction (no worker); POS returns/exchange, cash drawer, offline, printing; many-row states outside Sales (seed too small); exported/printed file contents. Each group report §6/§7 lists its own.
