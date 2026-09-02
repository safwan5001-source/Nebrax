# تقرير إكمال ربط قوالب الفاتورة (Print / PDF / Thermal)

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02

---

## 1. Executive Summary

رُبطت شاشة تفاصيل الفاتورة بعقد القوالب القائم دون إعادة بناء الاستوديو أو العارض أو محرك التصدير أو ZATCA. المسودة تحلّ `print` و`pdf` و`thermal` بالتوازي؛ والفاتورة المرحّلة تقرأ اللقطات المجمّدة فقط. زر تنزيل/مشاركة PDF يلتقط `#pdf-print-root` عندما يختلف تعريف PDF عن الطباعة، ويسقط إلى `#print-root` عند التطابق. الزر الحراري يظهر عند قالب 58/80 صالح للمسودة واللقطة. الترحيل يجمّد مراجعات نوع الكتالوج المستمد من `zatca_document_type`، مع سقوط آمن لتعيينات `tax_invoice` القائمة على الفاتورة المبسطة كي لا تنكسر إيصالات POS. عملة المؤسسة واتجاه الواجهة يمرّان إلى `DocumentView`. لا هجرات ولا تغيير في قيد الترحيل.

## 2. Base branch / Base SHA

- **الفرع الأساس:** `main`
- **SHA:** `a9a2b1180eccfcdc4ee49626dc67c9b6cb2cfee9` (متطابق مع `origin/main` عند بدء العمل)

## 3. Working branch

`cursor/document-templates-completion-7cc0`

## 4. Final HEAD SHA

يُحدَّث في الالتزام الذي يضم هذا الملف. القيمة الحالية عند كتابة المسودة:

`c956daee` (قبل التزام التقرير)

> تُستبدل هذه القيمة بـ SHA الالتزام الأخير على الفرع قبل فتح/تحديث الـ PR.

## 5. Audit findings قبل التنفيذ

### موجود ومكتمل — لا يُعاد بناؤه

- مركز التصاميم / الاستوديو / المكتبة / المعالج / محرر الكتل / التعيينات / النشر / سجل المراجعات / المقارنة البصرية.
- `PrintTemplateService::resolve()`: فرع ثم مؤسسة، حسب `document_type` + `usage`.
- `resolveOutputRevisionIds()` يحل `print` / `pdf` / `thermal` بشكل مستقل (مستخدم في العروض وأوامر الشراء).
- تجميد الثلاثي داخل معاملة `InvoiceService::post()` موجود ومغطّى باختبار سابق.
- رفض المراجعات غير المنشورة، حارس الحراري، وعزل المستأجر في `PrintTemplateTest`.
- مصدر العرض الواحد: `InvoiceDocument` → `DocumentView` → القالب المسجّل. التصدير عبر `documentExporter` (`html2canvas` + `jsPDF`). لا React-PDF.
- تقسيم الصفحات في `web/src/lib/pdf.ts` (`getPdfImageSlices`).
- POS يطبع من المراجعة المجمّدة عبر `ReceiptDialog`.
- ZATCA QR يُمرَّر من `/invoices/{id}/zatca`. لا يُمسّ `ZatcaService`.
- تخصيص أعمدة الجدول في `doc-items-table.tsx`.

### موجود لكن غير موصول إنتاجياً (الفجوات الحقيقية)

1. PDF على صفحة الفاتورة كان يلتقط `#print-root` دائماً؛ `pdf_template_revision` معلن في النوع والـ API ولا يُقرأ. الحل الحي طلب `usage=print` فقط.
2. المسار المجمّد كان يسقط الختم/التوقيع/`logo_height` لأن النسخ اليدوي صفّر الأصول، بينما الحل الحي استخدم `resolveLiveTemplateDefinition`.
3. Thermal للمسودة: الزر والجذر المخفي بعد الترحيل فقط. لا `usage=thermal` حي رغم وجود التعيين.
4. `InvoiceService::post` حلّ دائماً `tax_invoice`. النوع `simplified_tax_invoice` في الكتالوج ولم يُستخدم عند التجميد ولا في الحل الحي.
5. منتقي القالب في الترويسة غيّر `templateId` بعد التجميد، وعرض قوالب حرارية داخل مسار A4.
6. `from-invoice.ts` ثبّت `SAR` + `rtl` رغم أن المحرّك يدعم عملات واتجاهات متعددة، وعملة المؤسسة تصل من `/me`.

## 6. ما كان موجوداً أصلًا ولم يتم إعادة بنائه

- منصة القوالب كاملة (`web/src/modules/print-templates/**` و`web/src/app/(app)/document-design/page.tsx`).
- عقد الحل والخدمة الخلفية `PrintTemplateService`.
- `documentExporter` و`printDocument` و`revealDocumentForCapture`.
- `InvoiceDocument` / `DocumentView` / سجل القوالب Classic/Modern/ERP/Minimal/Retail والحراري 58/80.
- تجميد المراجعات داخل معاملة الترحيل (أُعيد توجيه نوع الكتالوج فقط).
- QR/XML/CSID/UBL في `ZatcaService`.
- قيد الفاتورة عبر `LedgerService::post`.
- اختبارات العزل وأولوية الفرع ورفض غير المنشور.

## 7. الفجوات التي تم اكتشافها

انظر القسم 5 (الفجوات الست). خارج نطاق هذه المهمة عمداً:

- سندات الدفع ما زالت على PDF متجه (`createPaymentPdf`).
- فجوة PDF نفسها على المشتريات/الإشعارات/العروض.
- إعادة بناء `ThermalReceipt` ليحترم تخطيط كتل A4 (الإيصال الحراري تخطيط ثابت مقصود).
- ZATCA م2 الكاملة / Ledger / POS architecture / Design System جديد / هجرات.

## 8. التعديلات المنفذة

### محوّل إخراج موحّد (واجهة)

ملف جديد: `web/src/modules/print-templates/services/document-output-template.ts`

- `invoiceCatalogDocumentType(zatca)` → `simplified` ⇒ `simplified_tax_invoice` وإلا `tax_invoice`.
- المرحّل: print من اللقطة؛ PDF = `pdf` المجمّد ثم `print` المجمّد عبر `resolveFrozenOutputDefinition` ثم `resolveTemplateRevisionDefinition` (يحفظ الختم/التوقيع/`logo_height`)؛ thermal من اللقطة الحرارية فقط بلا سقوط إلى print. لا حل حي بعد الترحيل.
- المسودة: ثلاث تعيينات حية؛ PDF بلا تعيين يسقط إلى print الحي.
- `fallbackLive*` اختياري لتوافق تعيينات `tax_invoice` عندما يكون نوع الكتالوج `simplified_tax_invoice` بلا تعيين صريح.
- `pdfSharesPrintRoot` بمقارنة JSON حتى لا يُضاعَف DOM بلا داعٍ.
- `thermalPaperForTemplate()` يعيد 58/80 أو `null`.

### صفحة الفاتورة

- جلب `usage=print|pdf|thermal` بالتوازي للمسودة (مع `branch_id` ونوع الكتالوج). للمبسطة يُجلب `tax_invoice` احتياطياً.
- تطبيق تعريف print على المعاينة و`#print-root`.
- جذر مخفي `#pdf-print-root` عندما يختلف تعريف PDF؛ التنزيل/المشاركة يلتقطانه.
- Thermal من المحوّل (مسودة حية أو لقطة). لا زر إن لم يوجد قالب 58/80 صالح.
- إخفاء منتقي القالب عند وجود تعيين/لقطة print. القائمة A4 فقط (`PAGE_TEMPLATES`).
- CSS: `#pdf-print-root { display: none; }` بجانب `#thermal-print-root`.

### تجميد الفاتورة حسب نوع الكتالوج

`PrintTemplateContract::invoiceDocumentType()` + `resolveOutputRevisionIds($documentType, $branchId)` داخل المعاملة نفسها.

سقوط آمن: إذا كان النوع `simplified_tax_invoice` وبقي استعمال بلا تعيين، تُنسخ معرّفات `tax_invoice` القائمة. السبب: عميل الاختبار وعملاء نقاط البيع بلا رقم ضريبي 15 خانة يُرحَّلون كفاتورة مبسطة، بينما التعيينات التاريخية على `tax_invoice`. بدون هذا السقوط تنكسر `PosCheckoutTest` والاختبار الأصلي لتجميد الطباعة.

### عملة واتجاه

- `from-invoice.ts`: `currency` من `company.currency` مع افتراض `SAR`؛ `type` و`direction` اختياريان.
- `InvoiceDocument`: عملة الشركة عبر النموذج؛ اتجاه `useLocale()` (`en` → `ltr` وإلا `rtl`) ونوع الكتالوج.

### اختبار OpenSSL محلي (غير منتج)

`tests/Feature/ZatcaCredentialTest.php`: `default_bits = 2048` في إعداد OpenSSL المؤقت حتى يولَّد مفتاح `secp256k1` على PHP 8.3 في هذه البيئة. لا تغيير في `ZatcaService` ولا في عقد الشهادات.

## 9. الملفات التي تغيرت

| ملف | الدور |
| --- | --- |
| `app/Support/PrintTemplateContract.php` | `invoiceDocumentType()` |
| `app/Services/Accounting/InvoiceService.php` | تجميد حسب نوع الكتالوج + سقوط `tax_invoice` |
| `tests/Feature/InvoiceTest.php` | تجميد المبسطة، null pdf/thermal، ثبات اللقطة، سقوط tax_invoice |
| `tests/Feature/PrintTemplateTest.php` | ربط النوع + استقلال resolve pdf |
| `tests/Feature/ZatcaCredentialTest.php` | `default_bits` لاختبار الشهادات محلياً |
| `web/src/modules/print-templates/services/document-output-template.ts` | المحوّل |
| `web/src/modules/print-templates/services/document-output-template.test.ts` | Vitest للمحوّل |
| `web/src/app/(app)/invoices/[id]/page.tsx` | الربط الإنتاجي |
| `web/src/app/globals.css` | إخفاء `#pdf-print-root` |
| `web/src/components/invoices/invoice-document.tsx` | عملة/اتجاه/نوع الكتالوج |
| `web/src/modules/documents/builder/from-invoice.ts` | عملة الشركة والحقول الاختيارية |
| `web/src/modules/documents/builder/from-invoice.test.ts` | USD/LTR وافتراض SAR |
| `web/src/modules/documents/services/export/template-export-contract.test.ts` | حراسة ربط الصفحة بالمحوّل |
| `AWJ_DOCUMENT_TEMPLATES_COMPLETION_REPORT.md` | هذا التقرير |

## 10. Database migrations إن وجدت

**لا هجرات.** لم تُضف أعمدة ولا جداول. حقول `print_template_revision_id` / `pdf_template_revision_id` / `thermal_template_revision_id` قائمة مسبقاً.

## 11. Print behavior النهائي

- **مسودة:** تعيين `usage=print` الحي لنوع الكتالوج (ثم `tax_invoice` إن كانت مبسطة بلا تعيين). الختم/التوقيع/`logo_height` من المراجعة المنشورة.
- **مرحّلة:** لقطة `print_template_revision` فقط. تغيير التعيين بعد الترحيل لا يغيّر المعاينة ولا الطباعة.
- الطباعة تستهدف `#print-root` عبر `printDocument`.
- منتقي القالب يظهر فقط عند غياب تعيين/لقطة print، ويستبعد القوالب الحرارية.

## 12. PDF behavior النهائي

- **مسودة:** تعيين `usage=pdf` المستقل؛ عند غيابه سقوط إلى print الحي (وعد العقد للمستند بلا لقطة PDF).
- **مرحّلة:** لقطة `pdf_template_revision` ثم لقطة print التاريخية عبر `resolveFrozenOutputDefinition`. لا حل حي.
- إن اختلف التعريف يُرسم `InvoiceDocument` ثانٍ مخفي `#pdf-print-root` ويُلتقط للتنزيل/المشاركة. إن تطابقا يُلتقط `#print-root`.
- المصدر نفسه: `InvoiceDocument` → `DocumentView` → `documentExporter`. لا React-PDF ولا `createInvoicePdf`.

## 13. Thermal behavior النهائي

- لا سقوط إلى print أبداً.
- الزر يظهر فقط إذا أعطى `thermalPaperForTemplate` ورقاً `thermal_58` أو `thermal_80`.
- المسودة: تعيين `usage=thermal` الحي (مع احتياطي `tax_invoice` للمبسطة).
- المرحّلة: اللقطة الحرارية المجمّدة فقط.
- الجذر المخفي `#thermal-print-root` يُطبع عبر `printDocument` بأبعاد 58/80 مم.
- POS لم يُمس؛ التجميد الخلفي مع السقوط إلى `tax_invoice` يحفظ إيصال الصندوق للفاتورة المبسطة.

## 14. Revision freezing behavior

داخل معاملة `InvoiceService::post()` بعد بناء ZATCA وقبل `update` الحالة إلى `posted`:

```
$documentType = PrintTemplateContract::invoiceDocumentType($invoice->zatca_document_type);
$revisionIds = $this->printTemplates->resolveOutputRevisionIds($documentType, $invoice->branch_id);
// إن كانت مبسطة وبقي استعمال null ← نَسْخ معرّف tax_invoice القائم لذلك الاستعمال فقط
```

- غياب تعيين pdf/thermal يترك المعرّف `null` ولا ينسخ print إلى تلك الأعمدة.
- إعادة تعيين القالب بعد الترحيل لا تغيّر الصف (مثبّت باختبار).
- القيود المحاسبية وZATCA XML/QR كما هي.

## 15. ZATCA regression check

- لم يُعدَّل `ZatcaService` ولا توليد QR/XML/ICV/PIH.
- الصفحة ما زالت تجلب `/invoices/{id}/zatca` وتمرّر `qr` إلى `InvoiceDocument`.
- نوع الكتالوج للقوالب يُشتق من `zatca_document_type` (`simplified` / `standard`) دون تغيير خوارزمية الاستنتاج من الرقم الضريبي.
- اختبارات `ZatcaCredentialTest` خضراء بعد `default_bits` في إعداد OpenSSL **للاختبار فقط**.

## 16. RTL/LTR check

- الافتراض في `from-invoice` يبقى `rtl` للتوافق.
- `InvoiceDocument` يمرّر `direction` من `useLocale()`: `en` → `ltr`، وإلا `rtl`.
- العارض القائم يستخدم خصائص منطقية في الكتل؛ لم تُضف قيم `left`/`right` جديدة في هذه المهمة.
- لم يُتح تحقق متصفح تفاعلي (لا جلسة مستأجر أمام الواجهة في هذه البيئة). العقد مغطّى بـ Vitest.

## 17. Multi-currency check

- `getCurrency(company.currency)` يدعم SAR/USD/EUR/AED وغيرها في السجل القائم؛ المجهول يسقط إلى SAR.
- اختبار: شركة `USD` → `model.currency === 'USD'`؛ رمز مجهول → `SAR`.
- المبالغ تبقى هللات في النموذج وتُنسَّق في طبقة العرض.

## 18. Multi-page check

- لم يُمس `getPdfImageSlices` / حدود صفوف الجدول.
- `web/src/lib/__tests__/pdf-page-breaks.test.ts`: اختباران ناجحان (حد آمن قبل نهاية A4، وسقوط حسابي للكتلة الطويلة).
- التحقق البصري متعدد الصفحات عبر متصفح **لم يُنفَّذ** في هذه الجولة (لا خادم واجهة مصادق عليه). الاعتماد على اختبارات الصفحة الآمنة القائمة.

## 19. Design System compliance

- لا ألوان جديدة ولا تدرجات ولا ظلال ثقيلة.
- منتقي القالب والإجراءات تستخدم مكوّنات الشريط/القائمة القائمة (`Button`, `Dropdown`, `Card`).
- إخفاء الجذور عبر CSS موجود أصلاً للحراري؛ أُضيف `#pdf-print-root` فقط.
- RTL-first محفوظ؛ لا هوية تصميم جديدة.

## 20. الاختبارات التي تم تشغيلها ونتائجها

### PHP (`php artisan test` كاملاً في `/tmp/nibras-app` بعد دمج النواة)

```
Tests:    1 skipped, 2124 passed (15108 assertions)
Duration: 135.82s
```

من ضمنها:

- `InvoiceTest`: تجميد الثلاثي، ثبات اللقطة بعد إعادة التعيين، تجميد `simplified_tax_invoice` فوق `tax_invoice`، pdf/thermal تبقى `null` بلا تعيين، سقوط المبسطة إلى تعيينات `tax_invoice`.
- `PrintTemplateTest`: `invoiceDocumentType`، استقلال `usage=pdf`.
- `PosCheckoutTest`: الإيصال الحراري المجمّد لكل عملية.

**ملاحظة بيئة:** التشغيل الأول فشل على GD و`poppler-utils` وOpenSSL بدون `default_bits`. بعد تثبيت `php8.3-gd` و`poppler-utils` وإضافة `default_bits` في اختبار الشهادات صارت المجموعة خضراء. CI الرسمي يثبّت poppler وPHP 8.4.

### Vitest (`web/`)

```
Test Files  184 passed (184)
Tests       1062 passed (1062)
```

منها 14 اختباراً على المحوّل الجديد تغطي البنود 1–8 و12 من قسم اختبارات المهمة (حل print/pdf/thermal، استقلال PDF، سقوط PDF، لا سقوط حراري، تجميد، تجاهل التعيين الحي بعد الترحيل، احتياطي tax_invoice، 58/80).

## 21. Build / lint / typecheck results

| الأمر | النتيجة |
| --- | --- |
| `npm run test` (Vitest) | نجح: 184 ملفاً / 1062 اختباراً |
| `npm run build` (Next.js 15.5.19، يشمل فحص الأنواع) | نجح بعد إصلاح نوع `frozenRevision` |
| `npm run lint` | **غير مُعدّ:** `next lint` يطلب تهيئة ESLint تفاعلياً ولا يوجد `.eslintrc`. Web CI يشغّل `npm test` + `npm run build` فقط ولا يشغّل lint. لم تُ confَغ تهيئة ESLint في هذه المهمة. |

## 22. المخاطر أو القيود المتبقية

- سقوط `tax_invoice` على الفاتورة المبسطة هو توافق متعمّد مع التعيينات القائمة؛ العقد الحرفي «لا سقوط عبر الأنواع» يُطبَّق عندما يوجد تعيين مبسطة صريح (يفوز). المستأجر الذي يريد قالباً مختلفاً للمبسطة يجب أن يعيّن `simplified_tax_invoice`.
- سندات الدفع والمشتريات والعروض والإشعارات لم تُربَط بجذر PDF مستقل في هذه المهمة.
- الإيصال الحراري ما زال تخطيطاً ثابتاً (`ThermalReceipt` / قالب thermal) وليس إعادة تدفّق كتل A4.
- التحقق البصري اليدوي (A4 طويلة، RTL/LTR في المتصفح، QR على الورق) غير متاح هنا.
- `npm run lint` غير مُشغَّل في CI الحالي.

## 23. أي Follow-up مطلوب

1. ربط فجوة PDF نفسها على `/purchases/[id]` و`/quotes/[id]` و`/credit-notes/[id]` عبر المحوّل الجديد (قابل لإعادة الاستخدام).
2. قرار منتج لاحق: هل يبقى سقوط `tax_invoice` للمبسطة أم يُنقل إلى شاشة تعيين مزدوجة في إعدادات POS.
3. تهيئة ESLint للواجهة إن رُغب بفرض `npm run lint` في Web CI.
4. تحقق متصفح يدوي متعدد الصفحات وحراري 58/80 على مستأجر تجريبي بعد الدمج.

## 24. PR number/link إن تم إنشاؤه

يُستكمل بعد فتح الـ PR عبر أداة إدارة الطلبات. الفرع: `cursor/document-templates-completion-7cc0`.

## 25. Merge status

**لم يُدمَج.** لا دمج إلى `main` من هذه المهمة.

## 26. Deployment status

**لم يُنشَر.** لا نشر إنتاج.

---

## ملحق: القيد المحاسبي (لم يتغيّر)

ترحيل الفاتورة ما زال عبر `LedgerService::post` فقط. التجميد يكتب معرّفات المراجعات على صف الفاتورة داخل المعاملة نفسها ولا يمس السطور.

| العملية | مدين | دائن |
| --- | --- | --- |
| بيع نقدي | 1110 الصندوق (الإجمالي) | 4110 إيرادات المبيعات (الصافي) + 2120 ضريبة مخرجات |
| بيع آجل | 1130 العملاء (الإجمالي) | 4110 + 2120 |
| تكلفة البضاعة (صنف متتبَّع) | 5110 تكلفة البضاعة | 1140 المخزون |
| تسوية «مدفوعة مسبقاً» نقداً | 1110 | 1130 |
| تسوية تحويل/بطاقة | 1120 البنك | 1130 |

النقود بالهللات (`bigint`). غير المتوازن يُرفض من المحرك. القيود بعد الترحيل لا تُعدَّل إلا بعكس عبر `LedgerService::reverse()`.
