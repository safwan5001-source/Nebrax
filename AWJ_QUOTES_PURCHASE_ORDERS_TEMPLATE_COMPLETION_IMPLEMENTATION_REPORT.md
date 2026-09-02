# تقرير إكمال ربط قوالب عروض الأسعار وأوامر الشراء (Print / PDF)

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** تكامل فقط — لا إعادة بناء لمنصة القوالب، لا Credit Notes، لا Thermal UI، لا دمج، لا نشر.

---

## Executive Summary

رُبطت شاشة عرض السعر (`/quotes/[id]`) وتفاصيل أمر الشراء (`ProcurementDetail` عندما `type === 'order'`) بعقد القوالب القائم من PR #611 دون إعادة بناء المحوّل أو العارض أو التصدير. المسودة تحلّ `usage=print` و`usage=pdf` بالتوازي حسب الفرع؛ والمستند الصادر للطباعة (`print_issued_at`) يقرأ اللقطات المجمّدة فقط. PDF يلتقط `#pdf-print-root` عندما يختلف التعريف عن الطباعة، ويسقط إلى جذر الطباعة عند التطابق. عملة المؤسسة واتجاه الواجهة يمرّان إلى `DocumentView`. لا هجرات، لا تغيير في `QuoteService` / `ProcurementService` / `InvoiceService`، ولا قيد محاسبي عند الإصدار أو التحويل.

---

## Audit Findings

**Base branch:** `main`  
**Base SHA الفعلي عند التفريع:** `264692dcb7906bdd86d63f54aba6524d8d539978`  
(متطابق مع دمج PR #611؛ `git fetch origin main` ثم التفريع من أحدث `main`.)

### موجود ومكتمل — لم يُعاد بناؤه

- محوّل #611: `web/src/modules/print-templates/services/document-output-template.ts` (`resolveDocumentOutputTemplates` + سقوط PDF إلى print + `pdfSharesPrintRoot`).
- الحل الخلفي: فرع ثم مؤسسة في `PrintTemplateService::resolve()`، و`resolveOutputRevisionIds()`.
- تجميد عروض الأسعار عند `QuoteService::issueForPrint()` بنوع `'quotation'` — ليس عند sent/accepted/convert. اختبار قائم: `QuoteTest::issuing_a_quote_freezes_templates_...`.
- تجميد أوامر الشراء عند `ProcurementService::issueForPrint()` بنوع `'purchase_order'` بعد `approved` — ليس عند approve. اختبار قائم: `ProcurementTest::an_issued_order_freezes_templates_...`.
- العارض واحد: `QuoteDocument` / `PurchaseOrderDocument` → `DocumentView` → `documentExporter`. CSS يخفي `#pdf-print-root` أصلاً من #611.
- عزل المستأجر وأولوية الفرع ورفض غير المنشور في `PrintTemplateTest`.

### فجوات حقيقية فقط (قبل هذا PR)

1. **عرض السعر** (`web/src/app/(app)/quotes/[id]/page.tsx`): حل حي `usage=print` فقط. بعد الإصدار دُمج `print_template_revision ?? pdf_template_revision` في تعريف واحد. PDF/مشاركة التقطا `#print-root` دائماً. لا استدعاء لـ `resolveDocumentOutputTemplates`.
2. **أمر الشراء** (`web/src/components/procurement/procurement-detail.tsx`): المعاينة والطباعة وPDF بعد `print_issued_at` فقط، وجذر واحد `purchase-order-print-root`، وتعريف مدمج يدوياً يسقط الختم/`logo_height` إن لم يمر عبر `resolveTemplateRevisionDefinition`. لا حل حي قبل الإصدار. `branch_id` غائب عن `ProcurementDocumentResource` رغم أن النموذج `BelongsToBranch`.
3. **`from-quote.ts` / `from-purchase-order.ts`:** `currency: 'SAR'` و`direction: 'rtl'` ثابتان. الفاتورة بعد #611 تقرأ `company.currency` وتمرّر الاتجاه من `useLocale()`.
4. **اختبارات الخلفية:** الإصدار يجمد print/pdf المنفصلين، لكن إعادة التعيين بعد الإصدار و`pdf_template_revision_id = null` عند غياب تعيين PDF لم تكونا مثبتتين لأمر الشراء (ولا إعادة التعيين لعرض السعر).

### خارج النطاق (وُثِّق ولم يُنفَّذ)

- Credit Notes، فواتير المشتريات، السندات، الإشعارات، أذون التسليم.
- Thermal UI لعروض/أوامر الشراء (الخلفية تجمّد الحراري عبر `resolveOutputRevisionIds` كما هو).
- منتقي قالب جديد، إعادة تصميم الصفحات، ZATCA، قيود محاسبية، هجرات.
- تعميم `invoiceCatalogDocumentType` / `fallbackLive*` (خاص بالفاتورة المبسطة).

---

## Implementation

الاستدعاء الوحيد للمحوّل:

- `documentType: 'quotation'` أو `'purchase_order'`
- `isPosted: Boolean(print_issued_at)` — نفس معنى اللقطة المجمّدة في صفحة الفاتورة؛ لا إعادة تسمية
- لا `fallbackLive*` ولا `liveThermal` ولا زر حراري

### Quote (عرض السعر)

| المحور | السلوك |
| --- | --- |
| **resolution** | مسودة: `GET /print-templates/resolve?document_type=quotation&usage=print\|pdf` مع `branch_id`. صادر: اللقطات فقط؛ يُتخطى الطلب الحي. |
| **Print** | المعاينة و`#print-root` من تعريف print عبر المحوّل (ختم/توقيع/`logo_height`). الطباعة تستهدف `print-root`. لا منتقي قالب. |
| **PDF** | إن اختلف التعريف يُرسم `QuoteDocument` مخفي بـ `rootId="pdf-print-root"`؛ التنزيل/المشاركة يلتقطانه. إن تطابقا يُلتقط `#print-root`. |
| **freezing / lifecycle** | نقطة التجميد تبقى `POST /quotes/{id}/issue` → `QuoteService::issueForPrint()`. sent/accepted/convert لا تجمّد. إعادة تعيين print بعد الإصدار لا تغيّر اللقطة. غياب تعيين pdf يترك العمود `null`؛ الواجهة تسقط PDF إلى print الحي (مسودة) أو إلى لقطة print التاريخية (صادر). |
| **renderer / root** | `QuoteDocument` → `DocumentView` → `documentExporter`. لا عارض ثانٍ. |
| **fallbacks** | عملة: `getCurrency(company.currency)` مع افتراض SAR. اتجاه: `useLocale()` (`en` → ltr وإلا rtl). شعار الشركة عند غياب شعار القالب. لا حقول API جديدة. |

### Purchase Order (أمر الشراء)

| المحور | السلوك |
| --- | --- |
| **resolution** | داخل `ProcurementDetail` عندما `type === 'order'` فقط (لا RFQ/طلب/عرض شراء). مسودة/غير صادر: حل حي print+pdf مع `branch_id`. بعد `print_issued_at`: لقطات فقط. |
| **Print** | المعاينة على `purchase-order-print-root` من تعريف print. الطباعة تستهدف هذا الجذر. |
| **PDF** | جذر مستقل `#pdf-print-root` إن اختلف التعريف؛ وإلا التقاط جذر الطباعة الحالي. |
| **freezing / lifecycle** | التجميد عند `ProcurementService::issueForPrint()` بعد `approved` فقط. زر «إصدار للطباعة» يبقى نقطة التجميد. سطح المسودة: بطاقة المعاينة وأزرار الطباعة/PDF الموجودة أصلاً تظهر لكل أمر شراء حتى قبل الإصدار — بلا أزرار أو تخطيط جديد. |
| **renderer / root** | `PurchaseOrderDocument` → `DocumentView` → `documentExporter`. |
| **fallbacks** | نفس عملة/اتجاه/شعار الشركة كنمط العرض. `branch_id` أُضيف إلى `ProcurementDocumentResource` لأن الحل حسب الفرع يحتاجه؛ ليس إعادة تصميم API. |

لا تغيير في `QuoteService` / `ProcurementService` / `InvoiceService`.

---

## Changed Files

| ملف | الدور |
| --- | --- |
| `web/src/app/(app)/quotes/[id]/page.tsx` | حل print/pdf مستقل، محوّل، جذر PDF |
| `web/src/components/quotes/quote-document.tsx` | اتجاه من `useLocale()` |
| `web/src/modules/documents/builder/from-quote.ts` | عملة الشركة + اتجاه اختياري + شعار الشركة |
| `web/src/modules/documents/builder/from-quote.test.ts` | SAR/EUR/LTR وافتراض SAR |
| `web/src/components/procurement/procurement-detail.tsx` | حل حي/مجمّد لأمر الشراء، جذر PDF، معاينة قبل الإصدار |
| `web/src/components/procurement/purchase-order-document.tsx` | اتجاه من `useLocale()` |
| `web/src/modules/documents/builder/from-purchase-order.ts` | عملة الشركة + اتجاه اختياري |
| `web/src/modules/documents/builder/from-purchase-order.test.ts` | USD/LTR فوق العقد القائم |
| `web/src/modules/print-templates/services/document-output-template.test.ts` | 5 اختبارات لـ `quotation` و`purchase_order` |
| `web/src/modules/documents/services/export/template-export-contract.test.ts` | حراسة استدعاء المحوّل وجذر PDF في صفحتي العرض والأمر |
| `app/Http/Resources/ProcurementDocumentResource.php` | كشف `branch_id` للحل حسب الفرع |
| `tests/Feature/QuoteTest.php` | إعادة تعيين بعد الإصدار + pdf null |
| `tests/Feature/ProcurementTest.php` | المثل لأمر الشراء |
| `AWJ_QUOTES_PURCHASE_ORDERS_TEMPLATE_COMPLETION_IMPLEMENTATION_REPORT.md` | هذا التقرير |

لم يُمسّ `document-output-template.ts` (إعادة استخدام كما هو).

---

## Tests

### PHP — `php artisan test` كاملاً في `/tmp/nibras-app` بعد نسخ ملفات النواة المتغيرة

```
Tests:    1 skipped, 2128 passed (15122 assertions)
Duration: 121.65s
```

من ضمنها:

- `QuoteTest` PASS — التجميد القائم + `reassigning_print_after_issue_does_not_change_the_frozen_quote` + `issuing_a_quote_without_pdf_assignment_leaves_pdf_revision_null` + عزل المستأجر.
- `ProcurementTest` PASS — التجميد القائم + `reassigning_print_after_issue_does_not_change_the_frozen_purchase_order` + `issuing_a_purchase_order_without_pdf_assignment_leaves_pdf_revision_null` + السلسلة بلا قيد وبلا مخزون.
- اختبارات العزل/الفرع/غير المنشور في `PrintTemplateTest` لم تُعد ولم تُكسر.

### Vitest — `npm run test` في `web/`

```
Test Files  185 passed (185)
Tests       1072 passed (1072)
Duration    19.54s
```

منها:

- `document-output-template.test.ts`: **19** اختباراً (14 قائمة للفواتير + 5 لعروض/أوامر الشراء: مسودة منفصلة، سقوط PDF، تجميد وتجاهل التعيين الحي).
- `from-quote.test.ts`: 3.
- `from-purchase-order.test.ts`: 2.
- `template-export-contract.test.ts`: 8 (منها حراسة quotes + procurement-detail).

---

## Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | 2128 ناجح، 1 متخطّى |
| `npm run test` | 185 ملفاً / 1072 اختباراً |
| `npm run build` (Next.js 15.5.19، يشمل فحص الأنواع) | نجح |
| `npm run lint` | غير مُعدّ في المشروع (Web CI = test + build فقط) |
| GitHub CI | PR [#612](https://github.com/safwan5001-source/Nebrax/pull/612) — يُراقَب حتى اكتمال الفحوصات؛ لم يُدمَج |

تحقق متصفح تفاعلي **لم يُنفَّذ**: لا جلسة مستأجر مصادق عليها أمام الواجهة في هذه البيئة. البديل: Vitest للعقد + بناء الإنتاج + مجموعة PHP الكاملة.

---

## Safety Review

| المحور | النتيجة |
| --- | --- |
| **Tenant Isolation** | الحل الحي عبر `/print-templates/resolve` القائم (نطاق المستأجر). لا استعلام يتجاوز `TenantScope`. اختبار `quotes_are_tenant_isolated` قائم. |
| **Branch isolation** | `branch_id` يُمرَّر في استعلام الحل. لأمر الشراء كُشف الحقل من المورد لأن النموذج `BelongsToBranch`. أولوية الفرع ثم المؤسسة لم تُغيَّر. |
| **Backward Compatibility** | مستند بلا تعيين PDF يبقى `pdf_* = null` في اللقطة؛ الواجهة تسقط إلى print وفق عقد #611. لا منتقي قالب جديد. RFQ/طلب/عرض شراء بلا تغيير. |
| **Accounting impact** | **لا تغيير.** إصدار العرض/الأمر والتحويل إلى مسودة فاتورة/مشترى لا يولّدان قيداً (عقد قائم؛ `JournalEntry::count() === 0` في الاختبارات). |
| **ZATCA impact** | لا. العرض والأمر ليسا مستندين ضريبيين؛ `qr: null` كما كان. `ZatcaService` لم يُمس. |
| **migrations** | **لا هجرات.** أعمدة المراجعات قائمة مسبقاً. |

---

## Risks / Remaining Work

- Credit Notes وفواتير المشتريات والسندات والإشعارات وأذون التسليم ما زالت خارج عقد Print/PDF المستقل على الواجهة (بعضها يجمّد خلفياً).
- Thermal UI لعروض/أوامر الشراء غير موصول؛ الخلفية تجمّد `thermal_template_revision_id` عبر `resolveOutputRevisionIds` دون سطح في هذه الشاشات.
- التحقق البصري اليدوي (RTL/LTR، معاينة مسودة أمر شراء، PDF بجذر مستقل) يحتاج مستأجراً تجريبياً بعد المراجعة.
- `isPosted` في المحوّل يعني «لقطة مجمّدة» وليس ترحيلاً محاسبياً؛ إعادة تسميته ستكسر صفحة الفاتورة.

---

## Git Metadata

- **Branch:** `cursor/quotes-po-template-wiring-7cc0`
- **PR number/link:** [#612](https://github.com/safwan5001-source/Nebrax/pull/612)
- **Base SHA:** `264692dcb7906bdd86d63f54aba6524d8d539978`
- **Implementation SHA:** `10752a4c6f6a4da517c4d40c6b1222e2864c15e1`
- **Report SHA:** `6d86303fdfd4bb71439b1e9707473e98b5319969`
- **Head SHA:** `881bdc7e839ae22b5a60dbfcce1cbce9cd3c20d0`
- **عدد commits:** 3 (`feat` + تقرير + ربط PR #612)
- **Merge:** لم يُدمَج
- **Deploy:** لم يُنشَر

---

## Next Step

**Credit Notes** — ربط شاشة الإشعارات (`/credit-notes/[id]`) بالمحوّل نفسه لعقد Print/PDF المستقل، دون تنفيذ في هذا PR. لا دمج ولا نشر من هذه المهمة.

---

## ملحق: القيد المحاسبي

لا قيد عند أي عملية في هذا النطاق:

| العملية | الأثر الدفتري |
| --- | --- |
| إصدار عرض سعر للطباعة | لا قيد — تجميد مراجعات فقط |
| تحويل عرض إلى مسودة فاتورة | لا قيد (`status=draft`) |
| إصدار أمر شراء للطباعة | لا قيد — تجميد مراجعات فقط |
| تحويل أمر شراء إلى مسودة مشترى | لا قيد ولا حركة مخزون |

النقود في العارض تُحوَّل من نصوص الريال إلى هللات عند حدّ `DocumentView` فقط؛ لا كتابة في `journal_lines`.
