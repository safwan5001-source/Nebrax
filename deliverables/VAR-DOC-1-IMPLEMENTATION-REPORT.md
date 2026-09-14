# VAR-DOC-1 Implementation Report

## Architecture Evidence

**البحث في `ProductReferenceRegistry`** (`app/Support/ProductReferenceRegistry.php`) كشف التصنيف الرسمي والوحيد
لكل سطر مستندٍ يشير إلى منتج، بفئة `BUSINESS_HISTORICAL` — ثماني نماذج بالضبط:

| النموذج | الجدول | لقطة اسم/SKU/باركود موجودة سلفاً؟ | يمسّ InventoryState؟ |
|---|---|---|---|
| `InvoiceLine` | `invoice_lines` | نعم (منذ 2025_01_01_000067) | نعم — `InventoryService::recordSaleCogs()` |
| `PurchaseLine` | `purchase_lines` | لا (`description` فقط) | نعم — `PurchaseService::post()` |
| `ReturnLine` | `return_lines` | لا | نعم — `ReturnService` (مبيعات وشراء) |
| `CreditNoteLine` | `credit_note_lines` | لا | لا |
| `QuoteLine` | `quote_lines` | لا | لا |
| `RecurringInvoiceLine` | `recurring_invoice_lines` | لا | لا (يولّد `InvoiceLine` لاحقاً) |
| `ProcurementLine` | `procurement_lines` | لا | لا |
| `DeliveryNoteLine` | `delivery_note_lines` | نعم | لا (توثيق تسليم فقط، بلا InventoryService) |

`CommerceOrderLine` مصنَّفٌ أيضاً `BUSINESS_HISTORICAL` لكنه **خارج النطاق صراحة** (VAR-COM-1).
`InventoryOpeningLine`/`FuelSale` كذلك مصنَّفان لكنهما مستندان مختلفان جوهرياً (فتح مخزون/وقود)
غير مذكورين في قائمة المهمة، فبقيا بلا `product_variant_id` في هذا الملف.

**اكتشافٌ حاسم غيّر خطة التنفيذ:** `InventoryService` (VAR-INV-1) **يحمل فعلاً** معاملات
`?ProductVariant $variant = null` في `applyReceipt()`/`applyIssue()`/`assertStockAvailable()`/
`resolveInventoryState()` — البنية التحتية للمخزون جاهزةٌ بالكامل. `recordSaleCogs()` يحمل تعليقاً
صريحاً: *"سطر الفاتورة لا يحمل متغيّراً بعد (VAR-DOC-1 لاحقاً)"* — كانت هذه المهمة الوحيدة
المتبقية على جانب المخزون: **تمرير** المتغيّر المحلول من السطر، لا بناء آلية جديدة.

**`ProductVariantService::deleteVariant()`** يحمل تعليقاً مطابقاً: *"لا مرجعٍ تاريخي/مخزني يشير
إلى متغيّرٍ اليوم (VAR-DOC-1/VAR-INV-1 مستقبلاً)"* — التحقق من InventoryState/أسعار المتغيّر
موجودٌ فعلاً بنفس النمط (`throw` قبل الحذف)؛ المطلوب إضافة تحقّقٍ مماثل لمراجع المستندات.

**ترتيب الخيار/القيمة الحتمي** موجودٌ فعلاً في `ProductMediaGalleryService::resolveGallery()`
(VAR-MEDIA-1): `$variant->optionValues()->with('option')->get()->sortBy(fn ($v) => [(int) ($v->option->sort_order ?? 0), (int) $v->sort_order])`
— أُعيد استعماله حرفياً بدل اختراع ترتيبٍ ثانٍ.

**نصف الخدمات (Quote/CreditNote/RecurringInvoice/Procurement) لم تكن تستدعي `Product::find()` أصلاً**
— كانت تخزّن `product_id` خاماً بلا أي تحقق. تطبيق حارس VAR-DOC-1 ("منتجٌ متعدد الخيارات يلزمه
متغيّرٌ فعلي") يتطلّب حتماً حلّ المنتج أولاً؛ هذا توسيعٌ ضروري لتطبيق العقد، لا توسيع نطاقٍ.

## Decisions

- **`product_variant_id`**: عمودٌ اختياري (`nullable`) في الجداول الثمانية، `FK → product_variants`
  بسلوك `nullOnDelete()` — يطابق `product_id` نفسه على الجداول ذاتها حرفياً (شبكة أمان قاعدة بيانات
  لا حارساً فعلياً؛ الحارس الحقيقي في `ProductVariantService::deleteVariant()` أدناه).
- **`variant_descriptor_snapshot`**: نصٌّ حتمي «أسود / كبير» — أسماء القيم (لا معرّفاتها) بترتيب
  `(option.sort_order, value.sort_order)`، مفصولة بـ` / `. لا سجلٌّ منظَّم (JSON) لأن العقد يطلب
  «تمثيلاً صغيراً حتمياً»، والنص الحتمي يكفي ولا يحتاج فك تشفير عند العرض.
- **`App\Support\DocumentLineVariantResolver`**: نقطة قرارٍ واحدة تستدعيها الخدمات الثماني كلها —
  `resolve(Product, ?variantId, tenantId): ?ProductVariant` (يرفض عزل مستأجر، انتماء خاطئ، متغيّر
  معطَّل، أو منتجاً بسيطاً يحمل `variant_id`، أو منتجاً متعدد الخيارات بلا `variant_id` — Fail closed
  في كل الحالات) و`descriptor(ProductVariant): ?string`. لا نسخة مكرّرة من هذا المنطق ثماني مرات.
- **لا لقطة اسم/SKU/باركود جديدة** على الجداول الستة التي تفتقدها: عمود `description` الموجود على
  الجميع يخدم دور لقطة الاسم فعلياً (`?? $product?->name`، معلَّقٌ عليه صراحةً في الكود الأصلي) —
  العقد يطلب اللقطة «حيثما يدعم النموذج الحالي ذلك»؛ بناء بنية لقطةٍ كاملة جديدة لستة جداول كان
  توسيع نطاقٍ حقيقياً خارج «الهويّة القابلة للبيع» التي يطلبها VAR-DOC-1.
- **`stock_movements.product_variant_id`**: عمودٌ إضافي (لم يكن مذكوراً صراحة في تعداد المهمة) —
  اكتُشف أن `applyReceipt()`/`applyIssue()` القائمتين من VAR-INV-1 تحسبان الأرقام على هويّة
  المتغيّر الصحيحة بالفعل، لكن صفّ `StockMovement` نفسه لا يسجّل *أيّ* متغيّرٍ كانت له الحركة —
  فتبقى الحركة تاريخياً غامضة الهويّة. إضافةٌ صغيرة وآمنة، لا تغييرَ في خوارزمية المتوسط المتحرك.

## Changed Files

**Migrations (جديدة):**
- `2026_09_29_010000_add_variant_identity_to_document_lines.php` — `product_variant_id` +
  `variant_descriptor_snapshot` على الجداول الثمانية.
- `2026_09_29_020000_add_variant_identity_to_stock_movements.php` — `product_variant_id` على
  `stock_movements`.

**Support (جديد):**
- `app/Support/DocumentLineVariantResolver.php` — محلِّل/مُلقِّط الهويّة الوحيد.

**Models (تعديل — `$fillable` + علاقة `variant()`، وللنماذج التي افتقدت `product()` أصلاً
(`CreditNoteLine`, `RecurringInvoiceLine`) أُضيفت أيضاً مع `ResolvesBranchReferences`):**
`InvoiceLine`, `PurchaseLine`, `ReturnLine`, `CreditNoteLine`, `QuoteLine`,
`RecurringInvoiceLine`, `ProcurementLine`, `DeliveryNoteLine`, `StockMovement`.

**Services (تعديل — حلّ المتغيّر قبل الكتابة + تمريره لـ`InventoryService` حيث يلزم):**
- `InvoiceService.php` — `applyItemsAndTotals()` (الإنشاء/التعديل) و`duplicate()`.
- `PurchaseService.php` — `writeLines()` و`post()` (استلامٌ مخزني بهويّة المتغيّر).
- `ReturnService.php` — إنشاء السطر + `postSalesReturn()`/`postPurchaseReturn()` (كلا الاتجاهين).
- `QuoteService.php`, `CreditNoteService.php`, `RecurringInvoiceService.php` (إنشاءً وتوليد
  فاتورةٍ من القالب معاً), `ProcurementService.php`, `DeliveryNoteService.php`.
- `InventoryService.php` — `recordSaleCogs()` يمرّر متغيّر السطر المحمَّل الآن؛ `applyReceipt()`/
  `applyIssue()` يسجّلان `product_variant_id` على `StockMovement`.
- `ProductVariantService.php` — `deleteVariant()` حارسٌ جديد (مرجعٌ في أي سطر مستندٍ من الثمانية).
- `app/Support/ProductReferenceRegistry.php` — إضافة `variantScopedBusinessDocumentLines()`
  (قائمةٌ صريحة، لا `inClass(BUSINESS_HISTORICAL)` العامة، لتفادي كسر استعلامٍ على عمودٍ غير
  موجود في `CommerceOrderLine`/`FuelSale`/`InventoryOpeningLine`).

**API (إضافيٌّ بحت — لا كسر توافق):**
- `InvoiceLineResource`, `ProcurementLineResource`, `QuoteLineResource`, `CreditNoteLineResource` —
  إضافة `product_variant_id`/`variant_descriptor` (لا `PurchaseLineResource`/`ReturnLineResource`/
  إلخ مخصَّصة قائمة لبقية الأنواع؛ خارج نطاق هذه الجولة).

**Tests (جديد):** `tests/Feature/VariantDocumentLineTest.php` (19 اختباراً).

## Migration

عمودان إضافيّان (`nullable`) على ثمانية جداول موجودة + عمودٌ واحد على `stock_movements` —
`ALTER TABLE` بحت، لا إعادة كتابة. الفهرس على `product_variant_id` في كل جدول. `FK` بسلوك
`nullOnDelete()` مطابقٍ حرفياً لسلوك `product_id` القائم على الجداول نفسها. تعمل على SQLite
(مُتحقَّقة عبر `setup.sh`) وPostgreSQL (`migrate:fresh --force` نظيف، بلا أخطاء).

## Tenant Isolation

`DocumentLineVariantResolver::resolve()` يرفض دائماً بمقارنة صريحة مع `$tenantId` من **رأس
المستند نفسه** (`$invoice->tenant_id`، `$purchase->tenant_id`، إلخ) — لا من مدخلات العميل مطلقاً.
اختبارات سالبة: `a_variant_must_belong_to_the_stated_product` (متغيّرٌ من منتجٍ آخر، نفس المستأجر)،
`a_cross_tenant_variant_is_denied` (متغيّرٌ حقيقي من مستأجرٍ آخر تماماً)، `a_simple_product_rejects_an_explicit_variant_id`،
`a_variant_managed_product_without_a_variant_id_is_rejected` — أربعتها ترمي `RuntimeException`
قبل أي كتابة. `BranchIsolationGuardTest`/`ProductReferenceClassificationGuardTest` (اختبارا
معمار موجودان) لا يزالان أخضرين بعد كل التعديلات، مؤكِّدَين أن كل نموذجٍ جديد المرجع مصنَّفٌ.

## Historical Immutability

خمسة اختبارات صريحة تثبت أن المستند المرحَّل لا يعيد قراءة الكتالوج الحيّ:
`renaming_the_product_after_posting_does_not_change_the_historical_line`،
`renaming_an_option_value_after_posting_does_not_change_the_historical_descriptor`،
`sku_and_barcode_changes_after_posting_do_not_change_the_historical_line`،
`price_changes_after_posting_do_not_change_the_historical_unit_price_or_totals`،
`deactivating_a_variant_after_posting_does_not_corrupt_the_historical_document`. الآلية:
`variant_descriptor_snapshot` يُكتب **مرة واحدة** عند إنشاء السطر (`DocumentLineVariantResolver::descriptor()`
تُستدعى فقط في مسار الكتابة، لا القراءة)؛ لا كودٍ يعيد اشتقاقه من `$line->variant` عند العرض.

## Inventory

`InvoiceService`/`PurchaseService`/`ReturnService` تحمِّل `lines.variant` قبل الترحيل، ثم تمرّر
الكائن مباشرة إلى `InventoryService::applyReceipt()`/`applyIssue()`/`assertStockAvailable()`/
`resolveInventoryState()` — التوقيعات جاهزةٌ من VAR-INV-1، لم تتغيّر. منتجٌ بسيط → `$variant = null`
(سلوكٌ سابقٌ حرفياً). متغيّرٌ فعلي → `InventoryState` الخاصة به وحدها. اختبار `sibling_variant_inventory_remains_unchanged_after_a_sale`
يثبت أن بيع أسود/كبير لا يمسّ أبيض/صغير إطلاقاً (كمية ومتوسط تكلفة معاً). `Product.quantity_on_hand`/
`avg_cost` القديمان لم يُكتبا في أي موضعٍ جديد.

## Pricing

لم تُلمَس `ProductPricingService`/`CommercePriceResolver`/`ProductUnitPrice` إطلاقاً. `unit_price`
يبقى مُدخَلاً صريحاً (يدوياً أو محلولاً من طبقة تسعيرٍ أعلى خارج هذا العقد) يُحفَظ كما هو حرفياً على
السطر — `no_factor_derived_price_is_introduced_for_a_variant_line` يثبت `unit_factor === 1` و`unit_price`
مطابقاً للمُدخَل. `price_changes_after_posting_do_not_change_the_historical_unit_price_or_totals`
يثبت أن سعراً صريحاً جديداً على `ProductUnitPrice` بعد الترحيل لا يغيّر شيئاً على السطر التاريخي.

## Lifecycle

`ProductVariantService::deleteVariant()` يرفض الحذف الحقيقي الآن إذا كان للمتغيّر مرجعٌ في أيٍّ من
الجداول الثمانية (`variantScopedBusinessDocumentLines()`) — بنفس رسالة/نمط فحصَي `InventoryState`/
`unitPrices` القائمين حرفياً (`throw new RuntimeException(...)` قبل أي حذفٍ فعلي، لا بعده).
التعطيل (`is_active = false`) يبقى المسار المتاح دائماً ولا يُمنع أبداً. اختباران يثبتان هذا:
مرجعٌ في فاتورة (مستندٌ يمسّ مخزوناً)، ومرجعٌ في عرض سعرٍ وحده (مستندٌ لا يمسّ مخزوناً) — كلاهما
يمنع الحذف بالتساوي.

## Tests

**الأمر:** `php artisan test --filter=VariantDocumentLineTest` (19 اختباراً جديداً، مصمَّمة تغطي
البنود ١٩-١ من خطة المهمة عدا #17 — انظر أدناه).

| البيئة | VariantDocumentLineTest | الانحدار (Invoice/Purchase/Return/Quote/CreditNote/RecurringInvoice/Procurement/DeliveryNote/ProductVariantCore/InventoryState/ProductMediaGallery/ReportEffectiveScope/ImportJob×2/BranchIsolationGuard/ProductReferenceClassificationGuard) |
|---|---|---|
| SQLite | 19/19 ✅ | 267 passed, 2 skipped (اختبارا تزامن PostgreSQL فقط) ✅ |
| PostgreSQL | 19/19 ✅ | 288/288 ✅ (الاختباران السابقان يعملان فعلياً هنا) |

**#17 (طباعة/PDF/حراري):** فحصٌ بالكود لا اختبارٌ تنفيذي — `InvoiceLineResource` (المستهلَك من
مسارات الطباعة/PDF) يقرأ `product_name_snapshot ?? $product?->name` مسبقاً (نمطٌ قائم قبل هذا
العقد)؛ أُضيف `product_variant_id`/`variant_descriptor` بنفس المبدأ إضافياً. لا قالب طباعة أُعيد
تصميمه (خارج النطاق صراحة).

**الانحدار الأوسع:** لم يُشغَّل `php artisan test` الكامل بلا فلتر ضمن هذا التقرير (نطاقه الفعلي
غطّاه فلتر الانحدار أعلاه بدقة أكبر على الأنظمة المتأثرة مباشرة)؛ تشغيلٌ كاملٌ على PostgreSQL بدأ
في الخلفية للتحقق النهائي — نتيجته تُذكر في القسم التالي إن اكتمل قبل تسليم هذا التقرير، وإلا
فالحالة معروفة من الجولات السابقة (٢٧ فشلاً بيئياً غير مرتبط: `bcmath` مفقود + فجوة PDF واحدة —
لا شيء منها يمسّ Product/Variant/Document/Inventory).

## Build / CI

الفروع/النماذج/الخدمات المذكورة أعلاه فقط عُدِّلت. لا تغييرٌ في `composer.json`/`package.json`.
`web/` لم يُلمَس. GitHub Actions على الفرع الجديد بعد الدفع — الحالة تُذكر بعد الدفع، لم تُفحص بعد.

## Risks / Remaining

- **`PurchaseLineResource`/`ReturnLineResource`/`RecurringInvoiceLineResource`/`DeliveryNoteLineResource`
  المخصَّصة غير موجودة أصلاً** (تُسلسَل عبر مسارٍ آخر لم يُفحص بعمق) — الحقلان الإضافيان
  (`product_variant_id`/`variant_descriptor`) لم يُضافا حيث لا يوجد Resource مخصَّص؛ الأعمدة نفسها
  متاحة عبر أي استعلامٍ مباشر أو `whenLoaded` مستقبلي بلا حاجة لتعديل مخطط.
- **طبقة التسعير التلقائي (اختيار وحدة/سعرٍ افتراضي عبر `ProductPricingService` عند الإنشاء
  اليدوي بدل `unit_price` صريح) لم تُفحص لكل الأنواع الثمانية** — فُحصت فقط عبر `unit_price` صريح
  مُدخَل، وهو المسار الوحيد المُختبَر مسبقاً في `InvoiceTest`/`PurchaseTest`؛ لا دليل على انكسارٍ،
  لكن لم يُثبَت تفصيلياً لكل نوع.
- **VAR-POS-1** (اختيار متغيّر في واجهة نقطة البيع)، **VAR-COM-1** (`CommerceOrderLine`)،
  **VAR-REPORT-1** (أبعاد المتغيّر في التقارير) — مؤجَّلة صراحة كما طُلب، بلا أي تغيير هنا.
- تشغيل الاختبارات الكامل بلا فلتر لم يُكمَل ضمن هذه الجولة عند كتابة هذا القسم (انظر أعلاه) —
  إن ظهرت نتيجته لاحقاً وفيها ما يستحق تصحيحاً، سيُدفَع كـcommit صغيرٍ منفصل قبل أي مراجعة.

## Git

- Branch: `claude/var-doc-1-variant-document-snapshots`
- PR: يُفتح بعد هذا التقرير.
- Base SHA: `fbc3fc1b96b7d30199131c10b9770fe9a8829879`
- Head SHA: يُملأ بعد الدفع.

## Next Step

**VAR-POS-1** فقط، وبعد موافقة صفوان الصريحة على هذا التقرير أولاً. لا Merge، لا Deploy، لا بدء
أي عملٍ آخر حتى تصل تلك الموافقة.
