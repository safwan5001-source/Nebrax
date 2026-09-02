# تقرير إكمال ربط قوالب الإشعارات المدينة (Print / PDF)

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** تكامل قوالب فقط — Debit Notes / `debit_note` — لا Thermal جديد، لا تغيير في الترحيل المحاسبي أو ZATCA، لا كسر لسلوك Credit Notes في #613، لا دمج، لا نشر.

---

## Executive Summary

رُبط مسار الإشعار المدين (`/credit-notes/[id]` عندما `type === 'purchase'`) بعقد Print/PDF القائم من #611–#613 دون إعادة بناء المحوّل أو العارض ودون تعديل `CreditNoteService`. المسودة تحلّ `usage=print` و`usage=pdf` بالتوازي حسب الفرع ونوع الكتالوج `debit_note`؛ والمستند المرحّل (`status === 'posted'`) يقرأ اللقطات المجمّدة فقط. PDF يلتقط `#pdf-print-root` عندما يختلف التعريف عن الطباعة، لكلا نوعَي الصفحة المشتركة. مسار الإشعار الدائن بقي على نفس استدعاء المحوّل بـ `credit_note`. لا هجرات ولا تغيير في قيد المدين (2110 أو 1110 / 5115 + 1150).

---

## Audit Findings

**Base branch:** `main`  
**Base SHA الفعلي عند التفريع:** `c10455d8ee8541e5b3bdf7f51fc6f43a939e58fc`  
(دمج PR #613؛ `git fetch origin main` ثم التفريع إلى `cursor/debit-notes-template-wiring-7cc0`.)

### 1) مسار العرض والتمييز

- القائمة `/debit-notes` تفتح التفاصيل عبر `/credit-notes/{id}` — لا صفحة تفاصيل مستقلة.
- التمييز في الصفحة: `note.type === 'purchase'` → إشعار مدين. غير ذلك → إشعار دائن مبيعات.
- النموذج واحد: `CreditNote`. النوع عبر `CreditNoteOwnershipResolver`.

### 2) Lifecycle / الحالات

`draft` / `posted` / `cancelled`. ليست `issueForPrint` ولا `print_issued_at`.

### 3–4) نقطة التجميد — من الكود لا افتراض

[`CreditNoteService::post()`](app/Services/Accounting/CreditNoteService.php) داخل معاملة الترحيل **بعد** `LedgerService::post`:

```php
$documentType = $isPurchase ? 'debit_note' : 'credit_note';
$printAssignment = $this->printTemplates->resolve($documentType, 'print', $note->branch_id);
$pdfAssignment = $this->printTemplates->resolve($documentType, 'pdf', $note->branch_id);
$thermalAssignment = $this->printTemplates->resolve($documentType, 'thermal', $note->branch_id);
```

ثم كتابة `print_template_revision_id` / `pdf_template_revision_id` / `thermal_template_revision_id` مع `status = posted`. غياب تعيين usage يترك العمود `null` — لا اختلاق revision.

### 5) الفرع والشركة

- `branch_id` على المستند يُمرَّر في `/print-templates/resolve?...&branch_id=`.
- الشركة من `GET /me`؛ الطرف من `GET /partners/{id}` (مورد عند المدين).
- عملة/اتجاه/شعار الشركة تمر عبر `from-credit-note.ts` + `useLocale()` كما ثُبّتت في #613 — لم تُعد بناءً.

### 6) سلوك Print/PDF قبل هذا PR (مسار purchase)

- `applyDebitDesign`: حل حي `usage=print` فقط.
- لقطة print فقط؛ PDF يلتقط `#print-root` دائماً (`isSalesCreditNote` كان يحجب الجذر المخفي).
- مستند `posted` بلا لقطة كان يمكن أن يعود لتعيين حي.

### 7) اختبارات قائمة قبل التعديل

- تجميد `debit_note` عند post في `CreditNoteTest::posting_an_credit_note_freezes_the_matching_published_template_revision`.
- قيد المدين: `DebitNoteTest` + `CreditNotePostingOwnershipTest`.
- عزل المستأجر على `/api/credit-notes` لإشعار المبيعات.

### موجود ومكتمل — لم يُعاد بناؤه

- محوّل `resolveDocumentOutputTemplates` (سقوط PDF إلى print، `pdfSharesPrintRoot`، تجاهل الحي بعد التجميد).
- `from-credit-note.ts`: `type: 'debit_note'` عند `purchase`، عملة الشركة، اتجاه صريح، شعار الشركة.
- `CreditNoteDocument` → `DocumentView` → `documentExporter`.
- الزر الحراري المرحّل القائم.

### خارج النطاق (وُثِّق ولم يُنفَّذ)

- Thermal جديد أو حل حراري حي.
- تغيير `CreditNoteService::post()` / Ledger / ZATCA.
- هجرات، Design Center، فواتير المشتريات، السندات.
- Merge / Deploy.

لا blocker خارج النطاق.

---

## Implementation

الاستدعاء الموحّد في الصفحة المشتركة:

- `documentType: type === 'purchase' ? 'debit_note' : 'credit_note'`
- `isPosted: status === 'posted'`
- لا `fallbackLive*` ولا `liveThermal`

### Debit Note (مشتريات)

| المحور | السلوك |
| --- | --- |
| **resolution** | مسودة: `GET /print-templates/resolve?document_type=debit_note&usage=print\|pdf` مع `branch_id`. مرحّل: اللقطات فقط (حتى لو `null`). |
| **Print** | المعاينة و`#print-root` من تعريف print عبر المحوّل. |
| **PDF** | جذر مخفي `#pdf-print-root` عند اختلاف التعريف؛ وإلا التقاط `#print-root`. سقوط العرض إلى print دون كتابة revision. |
| **freezing / lifecycle** | `POST /credit-notes/{id}/post` → `CreditNoteService::post()` بنوع `debit_note`. إعادة تعيين print بعد الترحيل لا تغيّر اللقطة. |
| **renderer / root** | `CreditNoteDocument` → `DocumentView` → `documentExporter`. |
| **fallbacks** | عملة `getCurrency(company.currency)` مع افتراض SAR. اتجاه `useLocale()`. شعار الشركة عند غياب شعار القالب. |

### Credit Notes

لم يُكسر عقد #613: نفس المحوّل، ونوع الكتالوج يبقى `credit_note` عندما `type !== 'purchase'`. حُذف الفرع اليدوي للمدين فقط.

لم يُمسّ `CreditNoteService` ولا `document-output-template.ts`.

---

## Changed Files

| ملف | الدور |
| --- | --- |
| `web/src/app/(app)/credit-notes/[id]/page.tsx` | حذف `applyDebitDesign`؛ محوّل موحّد؛ جذر PDF لكلا النوعين |
| `web/src/modules/print-templates/services/document-output-template.test.ts` | 4 اختبارات لـ `debit_note` |
| `web/src/modules/documents/builder/from-credit-note.test.ts` | حالة `type: 'purchase'` → `debit_note` + عملة/اتجاه/شعار |
| `web/src/modules/documents/services/export/template-export-contract.test.ts` | حراسة `'debit_note'` وجذر PDF وغياب `applyDebitDesign` |
| `tests/Feature/CreditNoteTest.php` | إعادة تعيين بعد post، pdf null، قيد 2110/5115/1150، عزل مستأجر للمدين |
| `AWJ_DEBIT_NOTES_TEMPLATE_COMPLETION_IMPLEMENTATION_REPORT.md` | هذا التقرير |

لم يُمسّ: `document-output-template.ts`، `from-credit-note.ts`، `credit-note-document.tsx`، `CreditNoteService.php`، `debit-notes/page.tsx`.

---

## Tests

### PHP — `php artisan test` كاملاً في `/tmp/nibras-app`

```
Tests:    1 skipped, 2133 passed (15157 assertions)
Duration: 126.77s
```

`CreditNoteTest` 11 ناجحاً (106 assertions)، منها الجديدة:

- `reassigning_print_after_post_does_not_change_the_frozen_purchase_debit_note`
- `posting_a_purchase_debit_note_without_pdf_assignment_leaves_pdf_revision_null` (مع قيد 2110 مدين / 5115 و1150 دائن، وغياب 1140)
- `purchase_debit_notes_are_tenant_isolated`

المجموعة الكاملة تشمل `DebitNoteTest` و`CreditNotePostingOwnershipTest` دون تعديل خدماتهما.

### Vitest — `npm run test` في `web/`

```
Test Files  186 passed (186)
Tests       1086 passed (1086)
Duration    20.77s
```

منها:

- `document-output-template.test.ts`: **27** اختباراً (4 جديدة لـ `debit_note`: مسودة مستقلة، سقوط PDF، تجميد، تجاهل الحي بعد posted).
- `from-credit-note.test.ts`: **4** (اختبارات الدائن لم تُغيَّر + حالة purchase).
- `template-export-contract.test.ts`: **10**.

### Frontend build

`npm run build` (Next.js 15.5.19، يشمل فحص الأنواع): نجح. مسار `/credit-notes/[id]` و`/debit-notes` ضمن الصفحات المولَّدة.

تحقق متصفح تفاعلي **لم يُنفَّذ**: لا جلسة مستأجر ولا بيانات إشعار مدين في هذه البيئة. البديل: Vitest + بناء الإنتاج + مجموعة PHP.

---

## Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | 2133 ناجح، 1 متخطّى |
| `npm run test` | 186 ملفاً / 1086 اختباراً |
| `npm run build` | نجح |
| `npm run lint` | غير مُعدّ (Web CI = test + build) |
| GitHub CI | **نجح** على `b33f3211` في [#614](https://github.com/safwan5001-source/Nebrax/pull/614): 5 فحوصات خضراء (sqlite ×2، pgsql ×2، Web CI). لم يُدمَج |

---

## Safety Review

| المحور | النتيجة |
| --- | --- |
| **Tenant Isolation** | الحل الحي عبر `/print-templates/resolve` القائم (Sanctum + نطاق المستأجر). اختبار جديد `purchase_debit_notes_are_tenant_isolated` + القائم للمبيعات. |
| **Branch isolation** | `branch_id` يُمرَّر في استعلام الحل لكلا النوعين. أولوية الفرع ثم المؤسسة لم تُغيَّر. |
| **Backward Compatibility** | مستند بلا تعيين PDF يبقى `pdf_* = null`. إشعار مرحّل بلا لقطة لا يعود لتعيين حي. سلوك الدائن عبر المحوّل كما في #613. |
| **Accounting** | **لا تغيير.** الترحيل ما زال: مدين 2110 (أو 1110 نقداً) / دائن 5115 (+ 1150). لا 1140. الاختبار الجديد يثبت القيد بعد الترحيل بلا تعيين PDF. |
| **ZATCA** | لا. `qr: null`. `ZatcaService` لم يُمس. |
| **migrations** | **لا هجرات.** |

---

## Risks / Remaining Work

- Thermal حي للإشعار المدين غير موصول؛ الزر الحراري المرحّل القائم بقي كما هو.
- التحقق البصري اليدوي يحتاج مستأجراً تجريبياً بتعيينات print/pdf مختلفة لـ `debit_note`.
- `isPosted` في المحوّل يعني لقطة مجمّدة؛ هنا يُمرَّر من `status === 'posted'` دون إعادة تسمية.
- رابط الرجوع في صفحة التفاصيل ما زال `/credit-notes` حتى عند فتح إشعار مدين (خارج النطاق).

---

## Explicit exclusions respected

Credit Notes (سلوك #613) · Thermal جديد · Purchase Invoices · السندات · Design Center · ZATCA · accounting refactor · API redesign · هجرات · Merge · Deploy.

---

## Git Metadata

- **Branch:** `cursor/debit-notes-template-wiring-7cc0`
- **PR number/link:** [#614](https://github.com/safwan5001-source/Nebrax/pull/614)
- **Base SHA:** `c10455d8ee8541e5b3bdf7f51fc6f43a939e58fc`
- **Implementation SHA:** `007e7ce6750bd7bd698841011f714c18ce10981b`
- **CI-green SHA:** `b33f32115df7d25318f7b21cb9ad7a9ed3fe2310` (5/5 فحوصات خضراء)
- **Final Head SHA:** `d540307cfd1a53538bab524d24337894b76fc9cc`
- **عدد commits:** 12
- **Merge:** لم يُدمَج
- **Deploy:** لم يُنشَر

---

## Next Step

مراجعة [#614](https://github.com/safwan5001-source/Nebrax/pull/614) ودمجها يدوياً. لم يُدمَج من هذا الوكيل.

---

## ملحق: القيد المحاسبي (لم يتغيّر)

| العملية | مدين | دائن |
| --- | --- | --- |
| مسودة إشعار مدين | لا قيد | لا قيد |
| ترحيل إشعار مدين آجل | 2110 الموردون | 5115 مردودات ومسموحات المشتريات (+ 1150 ضريبة مدخلات) |
| ترحيل إشعار مدين نقدي | 1110 الصندوق | 5115 (+ 1150) |

عبر `LedgerService::post` فقط. النقود بالهللات. **لا 1140.**
