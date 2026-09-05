# AWJ — Delivery Note Extraction + Human Review — Implementation Report

**PR مفتوح، غير مدموج، غير منشور — كما طُلب.**

## ما تم تنفيذه

إصلاح كامل لمسار Delivery Note من الاستخراج حتى `REVIEWED`، محصور بالكامل بفرع `delivery_note` في كل ملف (بلا أي تأثير على `purchase_invoice`/`expense`):

1. **`DocumentExtractionNormalizer::lines()`** — لا يُحذف سطر يحمل كمية بلا وصف. سطر يُحذف فقط إن لم يحمل وصفاً **ولا** كمية معاً.
2. **توجيه Gemini** — كتلة تعليمات إضافية خاصة بـ`delivery_note` (رقم أحمر مطبوع، خط يد للتاريخ/العميل، ربط DIESEL المطبوع بالكمية المكتوبة حتى مع اختلاف الموضع، تجاهل التوقيع/الختم/الدوائر) — نص فقط، بلا تغيير مخطط، وبلا اختلاق دليل غير موجود.
3. **`DocumentReviewReadinessPolicy::deliveryNoteGaps()`** — يستبدل الاستثناء الفوري بقائمة كاملة قابلة لإعادة الاستخدام:
   - `recipient_name` (العميل) مطلوب تحديداً — `issuer_name` لا يُرضي الشرط أبداً (تصحيح المالك).
   - `document_number` أصبح إلزامياً (كان اختيارياً).
   - سطر واحد على الأقل بكمية رقمية موجبة فعلياً (لا نص غير فارغ فقط) — ضجيج (توقيع/ختم) لا يُرضي الشرط أبداً.
4. **`DocumentReviewService::EDITABLE`** — إضافة `fields.issuer_name`/`fields.recipient_name`.
5. **`GET /document-batches/{id}/review`** — حقل جديد `readiness_gaps` (لسند التسليم فقط، فراغ لأي نوع آخر) يُشتقّ من نسخة غير محجوبة تطابق ما يتحقق منه الإكمال الفعلي تماماً.
6. **الواجهة** — مكوّن `ReadinessGapsPanel` جديد (يعرض كل فجوة بالعربية/الإنجليزية مع زر تعديل مباشر عند إمكانه)، تلميح توضيحي في حقل "سبب" مودال إكمال المراجعة، وسطر سياق ثابت "هذا التدفّق مخصّص لتسليم الديزل" (سياق عمل، لا دليل استخراج ملفَّق).

## الملفات المتغيّرة

**Backend:** `DocumentExtractionNormalizer.php`, `DocumentReviewReadinessPolicy.php`, `DocumentReviewService.php`, `DocumentReviewController.php`, `DocumentReviewResource.php`
**Frontend:** `readiness-gaps-panel.tsx` (جديد) + اختباره، `review-workspace.tsx`, `review-command-dialog.tsx`, `document-review.ts`, `contract.ts`, `ar.json`/`en.json`
**اختبارات:** `DocumentDeliveryNoteReviewTest.php` (إعادة كتابة افتراضيات fixture + 8 اختبارات جديدة/معدَّلة)، `DocumentExtractionNormalizerTest.php` (+2)، `DocumentReviewServiceTest.php` (تصحيح فرضية واحدة قديمة)

## API contract changes

- `GET /document-batches/{id}/review` → حقل إضافي `readiness_gaps: {code, target_key}[]` — إضافي بحت، فراغ لكل نوع سوى `delivery_note`.
- `POST /document-batches/{id}/change` → يقبل الآن `fields.issuer_name`/`fields.recipient_name` كـ`target_key` صالح (كان يُرفض سابقاً بـ"غير قابل للتعديل").

## Migrations

**لا يوجد.** كل شيء منطق تطبيق حي، لا تخزين إضافي.

## الاختبارات والنتائج الدقيقة

- `DocumentDeliveryNoteReviewTest`: **17/17 ناجح**.
- `DocumentExtractionNormalizerTest`: **+2 ناجح** (سطر كمية-فقط يبقى، سطر بلا دليل يُحذف كسابقاً).
- `DocumentReviewServiceTest`: **6/6 ناجح** (بعد تصحيح فرضية اختبار واحد كانت تفترض `issuer_name` غير قابل للتعديل — استُبدلت بـ`subtotal_minor` الذي يبقى فعلاً خارج القائمة).
- **Backend كامل:** `php artisan test` → **2348 ناجح، 1 مُتخطّى، 25 فاشل** — كل الفاشل مسبق وغير متعلق (مؤكَّد بلا تغيير قبل هذا الفرع): اختبار PDF واحد يحتاج `pdfinfo` غائباً عن هذه البيئة، و24 اختبار `Fuel*` يحتاجون امتداد `bcmath` الغائب أيضاً. صفر فشل جديد في مركز المستندات.
- **Frontend:** `npx vitest run` → **225 ملف / 1424 اختبار ناجح** (يشمل 3 اختبارات جديدة لـ`ReadinessGapsPanel`).
- **Frontend build:** `npm run build` → **نجح**.

## مراجعة الأمن/عزل المستأجر

لا مساس بأي بوّابة أمنية. إسناد استثناء الفحص، CLEAN-only للمعاينة/التنزيل، عزل tenant/branch، RBAC، والنسخة التفاؤلية — كل ذلك بلا تغيير؛ كل مسار جديد يعمل داخل دورة حياة الطلب القائمة لـ`DocumentReviewService`/`DocumentReviewController` بلا نقطة دخول جديدة. `readiness_gaps` تُحسب من نسخة **غير محجوبة** (تطابق ما يفحصه `assertReady()` تماماً) فلا فجوة زائفة لحقل محجوب للعرض فقط، ولا تسريب لمحتوى محجوب — تُعرض فقط `code`/`target_key`، لا قيمة أبداً.

## دليل عدم الأثر المحاسبي/المخزني

مضمون معمارياً لا مجرد اختبار: لا يوجد `DeliveryNoteDraftBuilder` أو ما يماثله في مركز المستندات، و`completionTargetStatus()` يوجّه `delivery_note` إلى `REVIEWED` دائماً لا `READY_FOR_DRAFT` — مسارات إنشاء المسودة غير قابلة للوصول أصلاً لهذا النوع. الاختبار `completing_a_delivery_note_review_creates_no_accounting_inventory_or_master_data_records` يثبّت صفر صف في `invoices`, `purchases`, `expenses`, `journal_entries`, `stock_movements`, `document_transaction_links`.

## المخاطر/المتبقي

- "سطر واحد يكفي بكمية موجبة" (لا "كل سطر") قرار تصميم ضروري بسبب إصلاح الـ normalizer: بعد أن توقف حذف الأسطر الصامت، سطر ضجيج (وصف بلا كمية) يجب ألا يحظر إكمالاً بدليل كمية حقيقي موجود فعلاً. موثَّق في الكود وهنا لمراجعة المالك إن كان القصد أشدّ صرامة.
- فئتا الفشل المسبقتان (`pdfinfo`, `bcmath`) ثغرات بيئة اختبار لا كود — أُشير إليهما بدل الالتفاف عليهما.

## Branch / PR

- **Branch:** `claude/document-center-prod-fix-4b3s1o`
- **PR:** [#656](https://github.com/safwan5001-source/Nebrax/pull/656)
- **Base SHA (merge-base مع main):** `b94718a432d01dab7d5bde04dda2259717ef2a28`
- **Head SHA:** `0355fc26e3d9de5938fb88adac37b12da9b1e942`

## التوصية التالية

الدمج بعد المراجعة، ثم إعادة رفع المستند الفعلي كدفعة جديدة (ملف الدفعة الأصلي غير قابل للاستعادة حسب تشخيص التخزين السابق) للتحقق من الحلقة الكاملة: استخراج Gemini بالتوجيه الجديد → عرض `readiness_gaps` الحقيقية → تصحيح بشري → إكمال ناجح → `REVIEWED`.
