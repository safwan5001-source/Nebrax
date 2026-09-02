# تقرير إكمال ربط قوالب الإشعارات الدائنة (Print / PDF)

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** تكامل فقط — لا Debit Notes، لا Thermal جديد، لا تغيير في الترحيل المحاسبي أو ZATCA، لا دمج، لا نشر.

---

## Executive Summary

رُبطت شاشة الإشعار الدائن (`/credit-notes/[id]` عندما `type !== 'purchase'`) بعقد القوالب القائم من PR #611 و#612 دون إعادة بناء المحوّل أو العارض. المسودة تحلّ `usage=print` و`usage=pdf` بالتوازي حسب الفرع؛ والمستند المرحّل (`status === 'posted'`) يقرأ اللقطات المجمّدة فقط. PDF يلتقط `#pdf-print-root` عندما يختلف التعريف عن الطباعة. عملة المؤسسة واتجاه الواجهة يمرّان إلى `DocumentView`. مسار الإشعار المدين بقي على الحل السابق عمداً. لا هجرات ولا تغيير في `CreditNoteService::post()`.

---

## Audit Findings

**Base branch:** `main`  
**Base SHA الفعلي عند التفريع:** `a2d91184720796b4568dfafb7c6f537b1e9db3cc`  
(دمج PR #612؛ `git fetch origin main` ثم التفريع.)

### موجود ومكتمل — لم يُعاد بناؤه

- محوّل #611/#612: `resolveDocumentOutputTemplates` + سقوط PDF إلى print + `pdfSharesPrintRoot`.
- الحل الخلفي: فرع ثم مؤسسة. التجميد عند `CreditNoteService::post()` يكتب print/pdf/thermal عبر ثلاثة `resolve()`.
- نوع الكتالوج: `credit_note` للمبيعات. الحالات: `draft` / `posted` / `cancelled`. لا `issueForPrint` ولا `print_issued_at`.
- العارض: `CreditNoteDocument` → `DocumentView` → `documentExporter`. `#pdf-print-root` مخفي في CSS أصلاً.
- `branch_id` في `CreditNoteResource`.
- اختبار تجميد أساسي يغطي دائن ومدين عند الترحيل.
- قيد الترحيل عبر `LedgerService::post`. `qr: null` — لا ZATCA على هذا المستند.

### فجوات حقيقية قبل هذا PR

1. الصفحة حلّت `usage=print` فقط ودمجت المعاينة من لقطة print. PDF التقط `#print-root` دائماً.
2. مستند `posted` بلا لقطة كان يمكن أن يعود لتعيين حي.
3. `from-credit-note.ts` ثبّت SAR وrtl ولم يسقط إلى شعار الشركة.
4. لا اختبار إعادة تعيين بعد الترحيل ولا `pdf = null` لإشعار مبيعات.

### خارج النطاق (وُثِّق ولم يُنفَّذ)

- Debit Notes (`type === 'purchase'` / `debit_note`).
- Thermal جديد (الزر الحراري المرحّل القائم تُرك كما هو).
- فواتير المشتريات، السندات، Design Center، هجرات، تغيير `CreditNoteService`.

---

## Implementation

الاستدعاء:

- `documentType: 'credit_note'`
- `isPosted: note.status === 'posted'`
- لا `fallbackLive*` ولا `liveThermal`

### Credit Note (مبيعات)

| المحور | السلوك |
| --- | --- |
| **resolution** | مسودة: `GET /print-templates/resolve?document_type=credit_note&usage=print\|pdf` مع `branch_id`. مرحّل: اللقطات فقط. |
| **Print** | المعاينة و`#print-root` من تعريف print عبر المحوّل (ختم/توقيع/`logo_height`). |
| **PDF** | جذر مخفي `#pdf-print-root` عند اختلاف التعريف؛ وإلا التقاط `#print-root`. |
| **freezing / lifecycle** | `POST /credit-notes/{id}/post` → `CreditNoteService::post()`. إعادة تعيين print بعد الترحيل لا تغيّر اللقطة. غياب تعيين pdf يترك العمود `null`؛ الواجهة تسقط PDF إلى print الحي (مسودة) أو لقطة print التاريخية (مرحّل). |
| **renderer / root** | `CreditNoteDocument` → `DocumentView` → `documentExporter`. |
| **fallbacks** | عملة `getCurrency(company.currency)` مع افتراض SAR. اتجاه `useLocale()` (`en` → ltr). شعار الشركة عند غياب شعار القالب. |

### Debit Notes

لم يُنفَّذ عقد Print/PDF المستقل. `type === 'purchase'` يبقى على الحل السابق (`usage=print` + `credit-note-template-design`).

لم يُمسّ `CreditNoteService`.

---

## Changed Files

| ملف | الدور |
| --- | --- |
| `web/src/app/(app)/credit-notes/[id]/page.tsx` | حل print/pdf لإشعار المبيعات، محوّل، جذر PDF؛ مسار المدين كما هو |
| `web/src/components/credit-notes/credit-note-document.tsx` | اتجاه من `useLocale()` |
| `web/src/modules/documents/builder/from-credit-note.ts` | عملة الشركة + اتجاه اختياري + شعار الشركة |
| `web/src/modules/documents/builder/from-credit-note.test.ts` | SAR/EUR/LTR وافتراض SAR |
| `web/src/modules/print-templates/services/document-output-template.test.ts` | 4 اختبارات لـ `credit_note` |
| `web/src/modules/documents/services/export/template-export-contract.test.ts` | حراسة صفحة الإشعار الدائن |
| `tests/Feature/CreditNoteTest.php` | إعادة تعيين بعد post + pdf null لإشعار مبيعات |
| `AWJ_CREDIT_NOTES_TEMPLATE_COMPLETION_IMPLEMENTATION_REPORT.md` | هذا التقرير |

لم يُمسّ `document-output-template.ts` (إعادة استخدام كما هو).

---

## Tests

### PHP — `php artisan test` كاملاً في `/tmp/nibras-app`

```
Tests:    1 skipped, 2130 passed (15134 assertions)
Duration: 122.93s
```

منها `CreditNoteTest` PASS: التجميد القائم + `reassigning_print_after_post_does_not_change_the_frozen_sales_credit_note` + `posting_a_sales_credit_note_without_pdf_assignment_leaves_pdf_revision_null` (مع بقاء قيد محاسبي واحد) + عزل المستأجر.

### Vitest — `npm run test` في `web/`

```
Test Files  186 passed (186)
Tests       1080 passed (1080)
Duration    20.25s
```

منها:

- `document-output-template.test.ts`: **23** اختباراً (4 جديدة لـ `credit_note`).
- `from-credit-note.test.ts`: 3.
- `template-export-contract.test.ts`: 9.

### Frontend build

`npm run build` (Next.js 15.5.19، يشمل فحص الأنواع): نجح بعد محاذاة نوع اللقطة المجمّدة مع عقد المحوّل (`definition?: Record<string, unknown>`).

تحقق متصفح تفاعلي **لم يُنفَّذ**: لا جلسة مستأجر. البديل: Vitest + بناء الإنتاج + مجموعة PHP.

---

## Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | 2130 ناجح، 1 متخطّى |
| `npm run test` | 186 ملفاً / 1080 اختباراً |
| `npm run build` | نجح |
| `npm run lint` | غير مُعدّ (Web CI = test + build) |
| GitHub CI | PR [#613](https://github.com/safwan5001-source/Nebrax/pull/613) — يُراقَب؛ لم يُدمَج |

---

## Safety Review

| المحور | النتيجة |
| --- | --- |
| **Tenant Isolation** | الحل الحي عبر `/print-templates/resolve` القائم. اختبار `credit_notes_are_tenant_isolated` قائم. |
| **Branch isolation** | `branch_id` يُمرَّر في استعلام الحل. أولوية الفرع ثم المؤسسة لم تُغيَّر. |
| **Backward Compatibility** | مستند بلا تعيين PDF يبقى `pdf_* = null`. مسار المدين كما هو. إشعار مرحّل بلا لقطة لا يعود لتعيين حي. |
| **Accounting** | **لا تغيير.** الترحيل ما زال: مدين 4110 (+ 2120) / دائن 1130 أو 1110. الاختبار الجديد يثبت بقاء قيد واحد بعد الترحيل بلا تعيين PDF. |
| **ZATCA** | لا. `qr: null`. `ZatcaService` لم يُمس. |
| **migrations** | **لا هجرات.** |

---

## Risks / Remaining Work

- Debit Notes على الصفحة المشتركة ما زالت بلا جذر PDF مستقل.
- Thermal حي للإشعار الدائن غير موصول؛ الزر الحراري المرحّل القائم بقي.
- التحقق البصري اليدوي يحتاج مستأجراً تجريبياً.
- `isPosted` يعني لقطة مجمّدة؛ هنا يُمرَّر من `status === 'posted'`.

---

## Explicit exclusions respected

Debit Notes · Thermal جديد · Purchase Invoices · السندات · Design Center · ZATCA · accounting refactor · API redesign · هجرات · Merge · Deploy.

---

## Git Metadata

- **Branch:** `cursor/credit-notes-template-wiring-7cc0`
- **PR number/link:** [#613](https://github.com/safwan5001-source/Nebrax/pull/613)
- **Base SHA:** `a2d91184720796b4568dfafb7c6f537b1e9db3cc`
- **Implementation SHA:** `d3b86763bc9012f1df7b2e818ac719ea565cc8c4`
- **Head SHA:** `334674c0190c5af041d26c97f76fda0b667805e4`
- **عدد commits:** 3 (`feat` + تقرير + تثبيت SHA)
- **Merge:** لم يُدمَج
- **Deploy:** لم يُنشَر

---

## Next Step

**Debit Notes** — ربط `type === 'purchase'` / `document_type: 'debit_note'` بالمحوّل نفسه لعقد Print/PDF المستقل، دون تنفيذ في هذا PR.

---

## ملحق: القيد المحاسبي (لم يتغيّر)

| العملية | مدين | دائن |
| --- | --- | --- |
| مسودة إشعار دائن | لا قيد | لا قيد |
| ترحيل إشعار دائن آجل | 4110 (+ 2120 ضريبة) | 1130 العملاء |
| ترحيل إشعار دائن نقدي | 4110 (+ 2120) | 1110 الصندوق |

عبر `LedgerService::post` فقط. النقود بالهللات.
