# REPORT.md — A2 audit, Group PLT (Settings & Admin · Commerce Admin · App Builder · Store Customizer · Fuel · Documents · Dashboard · Auth)

> **Committed evidence:** the curated images of this report are under [`a2/plt/`](a2/plt/) (JPEG, at most 1100 px wide). References to `shots/`, `run.log`, `*.jsonl`, `wf*/` or `out-states/` point to the full local run, kept outside git for size; it is reproducible with [`tools/`](tools/README.md). The auditor's report is kept verbatim apart from evidence paths.

> Saved by the coordinator verbatim from the auditor's hand-back (the auditor's harness refused file writes). Evidence files referenced below exist in this directory. P0 (PLT-01) re-verified by the coordinator in code: `web/src/components/settings/tax-settings-card.tsx:32` `.catch(() => setRows([]))` + `:52` PUT of the whole list; `app/Http/Controllers/Api/SalesConfigController.php` `update()` accepts `data: present|array` (empty allowed) and stores it.

Environment: local only (web 127.0.0.1:3001, API 127.0.0.1:8000), v3 surface. Viewports: AR 1440 light (primary), AR 390 (mobile), EN dark 1440 (from `out-v3b`). Records tagged `H2-A2-PLT`. Evidence paths relative to this directory: `shots/` (all screenshots), `capture-{d,m}.jsonl`, `wf1..wf8.jsonl`, `states.jsonl` (raw), `*.cjs` (scripts), `sheet_*.jpg` (contact sheets), [`E01`](a2/plt/E01_tax_load_error_empty_list_save.jpg)..E15`.

Severity: **P0 1 · P1 6 · P2 22 · P3 8** (37 distinct findings).

## 1. Screens covered

| Module | Routes (AR 1440 + 390 full page; EN-dark 1440 from baseline) |
|---|---|
| Dashboard | `/dashboard` |
| Settings & admin | `/settings` (4 tabs), `/tax-settings`, `/branches`, `/branches/new`, `/branches/:id` (main, new, unknown id), `/branches/settings`, `/applications`, `/integrations`, `/integrations/communications`, `/integrations/delivery-platforms`, `/integrations/delivery-platforms/hungerstation`, `/developer`, `/developer/{docs,keys,security,webhooks}`, `/notifications`, `/help`, `/help/first-steps`, `/help/does-not-exist`, `/whats-new` |
| Documents | `/documents`, `/documents/{governance,operations,settings,usage}`, `/documents/:id` (own batch `a2fd2923…`, unknown id), `/documents/:id/diagnostics` |
| Commerce Admin | `/commerce`, `/commerce/{stores,onboarding,published-products (both tabs),merchandising,themes,domains,integrations,delivery,gifting}` |
| Store Customizer | `/commerce/appearance`: opened, section selected, settings panel, More menu, exit. Every write request was blocked in the browser (0 attempted). Nothing saved or published |
| App Builder | `/app-builder`, `/app-builder/new` (3 start options), `/app-builder/:id`, `/builder`, `/versions`, unknown id |
| Fuel | All 13 screens on their current surface (outside the v3 gate). Open-shift and sale-draft dialogs opened and cancelled |
| Auth | `/`, `/login`, `/register`, `/forgot-password`, `/reset-password` (no token), `/verify-email` (no token), `/me` (owner and staff), redirects of `/dashboard` and `/me` without a token |

**Not covered:** App Builder element editing (the new app has none; adding one changes builder data); Studio save/publish (forbidden by the brief and blocked: no store); creating a commerce store (adds shared commerce state).

## 2. State matrices

OK · ISSUE (id) · N/A · NV = not verified. Empty = tenant C or real empty; loading = main request delayed 6 s; error = main request answered 500; forbidden = `staff`. Logs: `states.jsonl` + `out-states` (tenant C).

**Dashboard / Settings / Admin**

| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /dashboard | ISSUE 05 | OK | ISSUE 05 | OK | N/A | N/A | OK | OK |
| /settings | OK | OK | OK (inline + retry) | OK | N/A | ISSUE 11 | OK | N/A |
| /tax-settings | ISSUE 01 | NV | **ISSUE 01** | OK | N/A | ISSUE 02 | OK | N/A |
| /branches | N/A | ISSUE 12 | ISSUE 12 | OK | N/A | N/A | OK (120 chars) | NV |
| /branches/new, /:id | N/A | NV | ISSUE 08 | ISSUE 15 | N/A | ISSUE 13 | OK | N/A |
| /branches/settings | N/A | OK | ISSUE 14 | ISSUE 15 | N/A | N/A | OK | N/A |
| /applications | ISSUE 07 | OK | OK | OK | N/A | N/A | N/A | OK (45) |
| /integrations*, /developer* | OK | OK | OK | OK | N/A | NV | N/A | N/A |
| /notifications | ISSUE 36 | OK | OK | OK | N/A | N/A | N/A | NV |
| /help, /help/:slug, /whats-new | OK | OK | NV | OK | N/A | N/A | N/A | OK |
| /me | ISSUE 27 | NV | ISSUE 27 | ISSUE 27 | N/A | N/A | N/A | N/A |

**Documents**

| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /documents | OK | NV | OK | ISSUE 21 | N/A | ISSUE 20 | N/A | NV |
| /documents/:id | N/A | NV | ISSUE 08 | ISSUE 21 | OK | N/A | N/A | N/A |
| /documents/:id/diagnostics | ISSUE 19 | NV | NV | OK | N/A | N/A | N/A | N/A |
| /documents/{governance,operations,settings,usage} | OK | OK | NV | OK | N/A | NV | N/A | N/A |

**Commerce / Studio / App Builder**

| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /commerce | ISSUE 22 | OK | NV | OK | N/A | N/A | N/A | N/A |
| /commerce/stores | OK | OK | OK | OK | N/A | NV | N/A | N/A |
| /commerce/{onboarding,domains,delivery,gifting} | ISSUE 22 | OK | NV | OK (domains: ISSUE 16) | N/A | N/A | N/A | N/A |
| /commerce/{published-products,themes,integrations} | OK | OK | NV | ISSUE 16 | N/A | N/A | OK | NV |
| /commerce/appearance | ISSUE 18 | OK | NV | ISSUE 16 | OK | N/A | N/A | N/A |
| /app-builder | OK | OK | OK | OK | N/A | N/A | N/A | N/A |
| /app-builder/new | N/A | OK | OK | ISSUE 16 | N/A | ISSUE 31 | N/A | N/A |
| /app-builder/:id, /builder, /versions | ISSUE 32 | NV | ISSUE 08 | NV | N/A | N/A | N/A | N/A |

**Fuel (13 screens)**

| Group | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| Overview / readiness / alerts | OK | OK | OK | ISSUE 24 | N/A | N/A | N/A | N/A |
| Master data | OK | OK | ISSUE 24 | ISSUE 24 | N/A | ISSUE 25 | OK | NV |
| Shifts / sales / receiving | OK | OK | NV | ISSUE 24 | NV (bcmath) | ISSUE 25 | N/A | NV |
| Devices / AVI / contracts / maintenance / safety | OK | OK | NV | ISSUE 24 | N/A | NV | N/A | N/A |
| Settings | OK | OK | NV | OK | N/A | NV | N/A | ISSUE 26 (390) |

**Auth**

| Route | empty submit | wrong input | throttle | mobile |
|---|---|---|---|---|
| /login | OK (inline, Arabic, focus to email) | NV (throttled) | ISSUE 09 | OK |
| /register | OK (5 inline errors, focus to first) | OK | N/A | OK |
| /forgot-password | ISSUE 11 (browser bubble) | OK (does not reveal whether the account exists) | N/A | OK |
| /reset-password, /verify-email without token | ISSUE 28 / ISSUE 10 | — | — | — |

## 3. Workflows

| # | Workflow | Clicks | Result | Issues | Evidence |
|---|---|---|---|---|---|
| W1a | Settings → «تعديل ملف المؤسسة» → change «المدينة» → «حفظ» → revert | 6 | Save: toast «تم التحديث بنجاح», API updated. **Revert to empty: same toast, API keeps the old value** | 03, 10, 11 | `shots/w1_05b_company_saved_toast.png`, E06 |
| W1b | Tax: «إضافة» → name + rate → «حفظ» → remove row → «حفظ» | 5 | Saved, but 2.5 → 3, 150 → 100, −5 → 0 without notice. List reverted to the original 3 rows | 01, 02 | E01, `shots/w1_11_tax_150_clamped.png` |
| W2 | «أضف فرع» → empty / duplicate code / long name → «حفظ» → open branch → «إعدادات الفروع» → toggle → leave | 7 | Created (toast «تمت الإضافة بنجاح»). Back on the list, which first shows «0 نتيجة». Opening the branch goes straight to the edit form. Unsaved toggle lost on leaving | 12, 13, 14 | `shots/w2_01_branch_dup_code.png`, `shots/w2_02_branches_after_create.png` |
| W3 | Applications: «تفعيل الصيانة والسلامة» switch → dialog → «إلغاء» | 2 | Cancelled, no write (nav-state and request log compared). Focus not returned to the switch. Switch reachable by Tab | 07, 30 | E04, `shots/w3_02_disable_dialog.png` |
| W4 | Commerce onboarding → stores → published products (2 tabs) → Studio: home page sections, select hero, settings panel, More menu, exit | ~8 | Selection syncs between page and panel. Save/publish/schedule disabled with tooltip only. False conflict notice. No prompt on exit. 0 writes | 18, 22 | E07, `shots/w4_05_studio_section_selected.png` |
| W5 | «إنشاء تطبيق» → «البدء من الصفر» → name → «إنشاء» → builder → versions | 6 | App created with no toast. «نشر» enabled on an empty app. Versions page plain text only | 23, 31, 32 | E08, E09, `shots/w5_06_versions.png` |
| W6 | Documents upload: .txt (rejected) → fake PDF → real 597 B PDF → «رفع وإرسال» → review → diagnostics | 5 | Batch created; stays at «فحص السلامة بانتظار المعالجة». Raw internal codes shown | 19, 20, 21 | E10, `shots/w6_02_upload_invalid_type.png` |
| W7 | Fuel: walk 13 screens; create station → fuel product → tank (invalid then valid); open «فتح شفت» / «مسودة بيع جديدة», cancel | ~14 | Station, product and tank created. Tank validation error shown off-screen | 24, 25, 26 | E12, E13, E14, `sheet_fuel1..3.jpg` |
| W8 | Home → redirect → login empty / wrong / correct (Enter) → forgot (unknown email) → register validation → reset/verify without token | ~10 | Redirects and validation OK. **Login could not be completed (429)** | 09, 10, 28 | E15 |

**Keyboard:** login submits with Enter; applications switch reachable by Tab; company dialog closes on Escape with unsaved edits and no prompt; Studio shortcuts not verified.

**Dashboard numbers vs API** (period 15/10/2026):

| Card | Shown | API | Matches formatRiyal? |
|---|---|---|---|
| الأداء المالي | `3,028.5` | `"3028.50"` | No |
| صافي الدخل | `-10,471.5` | `"-10471.50"` | No |
| ذمم العملاء | `3,482.78` | `"3482.78"` | Yes |
| النقد والبنك | `0` | `"0.00"` (summed in the browser) | No |
| قيمة المخزون (twice) | `0` | `"0.00"` | No |
| Revenue vs expense bars | `3,028.50` / `13,500.00` | same | Yes |
| Latest invoices | `22,999.98`, `205.28`, `3,277.50` | same | Yes |
| Payment donut | «غير مدفوعة 3» | 2 posted + 1 draft | No |

**Isolation:** the tenant-B canary never appeared (51 routes as staff, 6 as branch-scoped staff, owner dropdowns used: fuel customers, branch lists). Branch-scoped staff sees only «فرع الخبر».

## 4. Consistency notes

1. **Page headers differ:** /settings breadcrumb + title + description + badge; /tax-settings title only, then a card repeating it; /branches/settings Save in the header; Fuel small label above title plus a blue explanation box; Commerce «التجارة الإلكترونية» label above the title.
2. **Save placement differs per screen:** top of the card (tax); page header (branch settings); bottom, not sticky, under a map (branch form); dialog footer (company); one Save per section (fuel settings).
3. **KPI card rows** on top of every fuel page (3–10), `/documents/operations` (7); inventory card twice on the dashboard.
4. **Two editor looks:** Store Customizer uses graphite chrome (per WORKSPACE_POSTURES §7.2); App Builder uses the light ERP look with blue buttons (E07 vs E08).
5. **Forbidden screens differ:** clean translated page (Developers, Integrations, Applications); Documents keeps tabs/filters and puts the message at the bottom; Fuel keeps create buttons, `0` counts and «لا توجد … بعد»; document detail offers «إعادة المحاولة» on a permission error.
6. **Two sidebar items highlighted** on `/branches/new`, `/branches/settings`, `/developer/keys`, `/app-builder/:id/versions` («المتاجر» + «صانع التطبيقات»).
7. **Currency labels:** fuel uses «(ر.س)», «(ريال)» and `⃁`; the money rule allows only the riyal sign.
8. **Validation styles differ:** login/register inline translated; company, forgot-password and fuel use the browser pop-up (English in Chromium); branch and app forms just disable the button.
9. **Dark mode (EN):** dashboard, applications, themes and fuel look correct.

## 5. Findings

### P0
**H2-PLT-01 · P0 · Tax settings: a failed load can wipe all tax rates** — /tax-settings. When `GET /api/sales-config/taxes` fails (500) the card shows «لا توجد ضرائب معرّفة بعد.»; «حفظ» and «إضافة» stay enabled, no error. «حفظ» sends `PUT /sales-config/taxes {"data":[]}` (intercepted, never reached the server). Code: `tax-settings-card.tsx` `.catch(() => setRows([]))` and Save sends the full list. Evidence E01, `wf1.jsonl` step `tax-load-500`. Impact: one click after a temporary error deletes VAT 15%, zero-rated and exempt for the whole company. Direction: error with retry; disable Save until the list has loaded.

### P1
- **H2-PLT-02 · P1 · Tax rates changed without telling the user** — 2.5 → 3, 150 → 100, −5 → 0; nameless rows dropped; only feedback is the toast «حُفظت إعدادات الضرائب»; red delete removes a row with no confirmation. Evidence `wf1.jsonl`, `shots/w1_11_tax_150_clamped.png`. Direction: validate and explain instead of rewriting; confirm row removal.
- **H2-PLT-03 · P1 · Company profile: clearing a field says "updated" but the old value stays** — cleared «المدينة», toast «تم التحديث بنجاح», `GET /api/me` still returns `city "H2-A2-PLT مدينة"`; API `city:null` also keeps it; server comment says empty should clear. Evidence `wf1.jsonl`. **Backend dependency.** Left behind: tenant A city «H2-A2-PLT مدينة».
- **H2-PLT-04 · P1 · Dashboard KPI amounts not in the standard money format** — `3,028.5`, `-10,471.5`, `0` (the same page elsewhere shows `3,028.50`); cards use `formatNumberShort` / `formatRiyalShort`, which drop trailing zeros; same at 390. Evidence E02, `shots/m__dashboard.png`. Direction: `formatRiyal` or a short format keeping 2 decimals.
- **H2-PLT-05 · P1 · Dashboard shows `0 ⃁` as fact when its data fails** — with `/invoices`, `/accounts`, `/income-statement` at 500 every KPI shows 0 and the chart is flat; no error, no retry; no `catch` on the `Promise.all`. Evidence E03.
- **H2-PLT-06 · P1 · Dashboard counts a draft as unpaid and sums totals in the browser** — donut «غير مدفوعة 3» = 2 posted unpaid + 1 draft of 22,999.98; receivables sparkline includes the draft; cash summed client-side from accounts 1110 + 1120 only (other cash/bank accounts would be missed; untested with data). Evidence `shots/d__dashboard.png`, `dashboard/page.tsx` 112–135. Direction: exclude drafts; totals from the server.
- **H2-PLT-07 · P1 · Application Management contradicts what is actually on** — «مفعّلة 0», every capability «غير مفعّلة / غير متاح — لا يمكن التفعيل لأن الوصول الفعال مرفوض», while `nav-state` returns true for all 16 keys and the modules work; `GET /applications` returns `enabled:false`, `effective_access:"denied"`; tenant C identical. Evidence E04, `sheet_states1.jpg`, `wf3.jsonl`. **Backend dependency** (may concern grandfathered/seeded tenants only).

### P2
- **H2-PLT-08** "Not found" pages show raw server errors or a blank edit form: `/documents/<unknown>` and `/app-builder/<unknown>` show `No query results for model [App\Models\DocumentBatch|BuilderApp] …` in red with «إعادة المحاولة»; `/branches/<unknown>` shows an empty «تعديل فرع» form. E09.
- **H2-PLT-09** Login throttle message English, no wait time: «Too Many Attempts.» (period on the wrong side in RTL); limit 5/min per IP. E15.
- **H2-PLT-10** Server error messages in English in the Arabic UI: «The currency field must be 3 characters.», «The token field is required.», «Too Many Attempts.»; Applications and Fuel error boxes print server text. E06, `shots/w8_12_verify.png`.
- **H2-PLT-11** Browser pop-up validation and errors far from their fields: company dialog, forgot-password, fuel master data use the native required bubble (English); company server errors at the dialog bottom, field not marked, focus not moved; currency/country free text («XX», «1» accepted until the server rejects). `wf1.jsonl`.
- **H2-PLT-12** Branch list shows «0 نتيجة · صفحة 1 من 1» while loading and «لا توجد فروع» on error (every company has a main branch). E05.
- **H2-PLT-13** Branch form flow: Save disabled until a name is entered, unexplained; duplicate-code error «كود الفرع مستخدم مسبقاً.» next to Save, far from «الكود»; country names in English; after create lands on the list; opening a branch goes straight to edit (no view page). `shots/w2_01_branch_dup_code.png`.
- **H2-PLT-14** Branch settings: leaving after a toggle gives no warning; load failure = blank page + toast «حدث خطأ»; main-branch list offers «— لا فرع رئيسي —»; disabled switch unexplained. `shots/w2_05_branch_settings_dirty.png`, `out-states/shots/error__branches_settings.png`.
- **H2-PLT-15** Staff without `branches.manage` see editable branch forms and settings with «حفظ»; the server refuses (403 verified) and the user sees a generic error. E11.
- **H2-PLT-16** Commerce permissions inconsistent for staff: blocked `/commerce/{stores,onboarding,merchandising,delivery,gifting}` and `/app-builder`; open `/commerce/{published-products,themes,domains,integrations}`, `/app-builder/new` and the whole Store Customizer. `states.jsonl`, `sheet_states3.jpg`.
- **H2-PLT-17** = 08 for the C9 wave (counted once).
- **H2-PLT-18** Store Customizer with no store: header «لا يوجد متجر يمكن اختياره» but the editor shows the sample «متجر النور» as title and store; More menu red dot and «تم تعديل هذه النسخة من جلسة أخرى…» in a brand-new session; Save/Publish/Schedule disabled with the reason («اختر متجراً أولاً…») only in a tooltip while «نشر» still looks filled; no warning on leaving with edits. E07, `wf4.jsonl`.
- **H2-PLT-19** Document Center raw codes: statuses `safety_check_pending`, `pending`, `received`, `document-diagnostics-v1`; governance dropdowns `legal_review`, `privacy_request` and seven `fields.*` keys; group `document_center` on /applications; diagnostics says «لا توجد حزم…» while showing the batch; batch named by a cut id «a2fd2923». E10, `sheet_docs.jpg`.
- **H2-PLT-20** Upload dialog keeps a rejected `.txt` and its error after valid files are added; with it present «رفع وإرسال» does nothing and says nothing; a 9-byte fake PDF is accepted client-side. `shots/w6_02_upload_invalid_type.png`.
- **H2-PLT-21** Document Center forbidden message hidden at the bottom under tabs/filters; detail page offers «إعادة المحاولة» on a permission error. `shots/w6_11_staff_documents.png`.
- **H2-PLT-22** Commerce home is a placeholder («هذه الشاشة جزء من مساحة العمل وستنمو لاحقاً…»), whereas COMMERCE_ADMIN §5.1 expects channel cards and an attention list; onboarding/domains/delivery/gifting say «لا يوجد متجر إلكتروني بعد» with no create action; «عرض المتجر» stays in the header without a store. `sheet_commerce1.jpg`, `sheet_commerce2.jpg`.
- **H2-PLT-23** App Builder editor: developer terms («layout», «ListView», page «home»); «نشر» enabled on an empty app; no h1; light ERP look instead of the Studio graphite chrome. E08.
- **H2-PLT-24** Fuel forbidden and error screens still show create buttons («إضافة المحطات», «فتح شفت», «مسودة بيع جديدة», «جهاز جديد»…), `0` counts and «لا توجد المحطات بعد.» on 12 of 13 pages for staff (incl. branch-scoped); master-data error looks the same. E12.
- **H2-PLT-25** Fuel forms: tank error «حدود الخزان غير متسقة: يجب أن يكون الميت ≤ …» at the top of the page, out of view of Save, with «إعادة المحاولة»; technical terms «الـfloat الافتتاحي», «COGS», «GRNI», «append-only», «ATG», «token أو secret», «عند حد API فقط»; labels «(ر.س)», «(ريال)», unit «L»; sale dialog customer is a plain dropdown of every customer. E13, E14.
- **H2-PLT-26** Fuel settings at 390: 25 controls shorter than 32 px; 1 axe colour-contrast (the only axe failure in PLT). `capture-m.jsonl`.
- **H2-PLT-27** `/me` for a user not linked to an employee: «مرحباً،» with no name, active «تسجيل حضور», 4 calls refused (403), toast «هذا الحساب غير مرتبط بسجل موظف.». `shots/d__me.png`.
- **H2-PLT-28** `/reset-password` without a token shows the full form with no invalid-link message. `shots/w8_11_reset_no_token.png`.
- **H2-PLT-29** Every fuel page opens with KPI cards and a blue explanation box before the list or form (see §7). `sheet_fuel1..3.jpg`.
- **H2-PLT-30** Applications dialog only asks for an optional reason (does not say what changes or what depends on it); header «تفعيل (5)» opens the same dialog for 5 apps; focus not returned to the switch after «إلغاء». `shots/w3_02_disable_dialog.png`.

### P3
- **H2-PLT-31** No toast after «إنشاء» on a new app; «استخدام تصميم متجري» selectable without a store.
- **H2-PLT-32** Versions page: plain text «لم يُنشر أي إصدار بعد.», no container, no next step.
- **H2-PLT-33** Two sidebar items highlighted at once (§4.6).
- **H2-PLT-34** Subscription card: unlimited (`∞`) shows a 4% bar; status twice («الاشتراك فعال» + «نشط»).
- **H2-PLT-35** Monospace font on Arabic words: «الفرع الرئيسي» in the 390 branch card, «لـتر» in fuel cards.
- **H2-PLT-36** Empty notifications list still shows «0 نتيجة · صفحة 1 من 1» and pager.
- **H2-PLT-37** «تطبيقات AWJ» in the Arabic UI; brand elsewhere is «أَوْج».
- **H2-PLT-38** Inventory value card twice on the dashboard.

## 6. Not verified
Real login (correct/wrong password): 429 every time (all auditors share one IP limit; same after 75 s) · Fuel sale finalize/receiving/reconciliation (bcmath missing locally) · Document extraction (processing off, no worker) · Studio/App Builder publish (forbidden by the brief) · Studio shortcuts · many-rows states (seed too small) · 200% zoom, Ink, legacy comparison for this group · dashboard cash with other cash/bank accounts (no such balances in the seed).

## 7. Evidence for O-14 (Fuel posture)

| Screen | Look | User | Fits today |
|---|---|---|---|
| /fuel-stations | 7 KPI cards, station list, quick links, explanation box | manager | Ledger |
| /readiness, /alerts | KPI cards, filters, list | manager | Ledger |
| /master-data | tabs, inline form, list | back office | Ledger |
| /devices, /avi-rfid, /corporate-contracts, /maintenance, /safety | KPI cards, lists with CSV, "new" dialogs | back office | Ledger |
| /settings | sections, each with its own Save | admin | Ledger |
| /receiving | long form on the page plus a list | clerk | Ledger |
| /shifts | KPI cards and list; «فتح شفت» = 2-field dialog | forecourt supervisor | Ledger today; could be Floor |
| /sales | KPI cards and list; «مسودة بيع جديدة» = small dialog (station, nozzle, shift, customer plain dropdown, AVI authorization, quantity) | pump-side sale | Ledger today; strongest Floor candidate |

Facts: no pump/nozzle grid, large keypad or touch layout on any screen; at 390, 13 of 31–33 controls on sales/receiving and 9 of 27 on shifts are shorter than 44 px; none of the 13 screens is on the v3 surface. Observation (not a decision): mixed — Ledger for the 11 back-office screens; Floor for shifts and sales only if a forecourt use case is confirmed.

## 8. Records left in tenant A
Branch «H2-A2-PLT فرع الدمام الشرقية…» (code 00002) · App «H2-A2-PLT تطبيق تجريبي» `a2fd285b-3218-4a74-8db3-da2209eeb7e5` (draft) · Document batch `a2fd2923-f1d9-4200-a669-54302c4b105f` · Fuel station H2PLT-ST1, product H2PLT-D, tank H2PLT-T1 · Company city «H2-A2-PLT مدينة» (not revertible; PLT-03). Tax list reverted; no application state changed; nothing published.

Evidence: [`E01_tax_load_error_empty_list_save`](a2/plt/E01_tax_load_error_empty_list_save.jpg) … `E15_login_throttle_english.jpg` (15 files).

## Evidence index (committed)

- [`E01_tax_load_error_empty_list_save.jpg`](a2/plt/E01_tax_load_error_empty_list_save.jpg)
- [`E02_dashboard_kpi_short_format.jpg`](a2/plt/E02_dashboard_kpi_short_format.jpg)
- [`E03_dashboard_api_500_shows_zeros.jpg`](a2/plt/E03_dashboard_api_500_shows_zeros.jpg)
- [`E04_applications_zero_enabled.jpg`](a2/plt/E04_applications_zero_enabled.jpg)
- [`E05_branches_api_500_empty_state.jpg`](a2/plt/E05_branches_api_500_empty_state.jpg)
- [`E06_company_422_english.jpg`](a2/plt/E06_company_422_english.jpg)
- [`E07_studio_no_store_false_conflict.jpg`](a2/plt/E07_studio_no_store_false_conflict.jpg)
- [`E08_app_builder_jargon_publish_enabled.jpg`](a2/plt/E08_app_builder_jargon_publish_enabled.jpg)
- [`E09_app_builder_raw_exception_404.jpg`](a2/plt/E09_app_builder_raw_exception_404.jpg)
- [`E10_documents_raw_status_codes.jpg`](a2/plt/E10_documents_raw_status_codes.jpg)
- [`E11_staff_branch_settings_editable.jpg`](a2/plt/E11_staff_branch_settings_editable.jpg)
- [`E12_staff_fuel_forbidden_with_actions.jpg`](a2/plt/E12_staff_fuel_forbidden_with_actions.jpg)
- [`E13_fuel_tank_error_offscreen.jpg`](a2/plt/E13_fuel_tank_error_offscreen.jpg)
- [`E14_fuel_sale_form_mobile_ledger_posture.jpg`](a2/plt/E14_fuel_sale_form_mobile_ledger_posture.jpg)
- [`E15_login_throttle_english.jpg`](a2/plt/E15_login_throttle_english.jpg)
