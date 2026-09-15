# VAR-POS-1 Implementation Report

## Architecture Evidence

**POS checkout يُعيد استعمال `InvoiceService`/`InventoryService` مباشرة** —
اكتشافٌ حاسم غيّر خطة التنفيذ كلها: `PosService::checkout()` يستدعي
`$this->invoices->create([...], $data['items'])` ثم `$this->invoices->post($invoice)`
حرفياً. بما أن VAR-DOC-1 جعل `InvoiceService::create()` يحلّ `product_variant_id`
عبر `DocumentLineVariantResolver` (فشلٌ مغلَقٌ على انتماء/عزل مستأجر/نشاط) ويمرّر
المتغيّر المحلول إلى `InventoryService::recordSaleCogs()`، فإن **حاجز الأمان
الخادمي عند الإتمام موجودٌ فعلاً بلا أي كود جديد** — المطلوب فقط: (أ) تمرير
`product_variant_id` عبر الطبقات الوسيطة (Request/PosService checksum/validation)
بلا فقدانه، (ب) جعل سلطة التسعير الخاصة بـPOS (`PosCustomerPriceListResolver`)
تحلّ سعر **المتغيّر** لا الأب.

**كتالوج POS** (`PosController::products()`): يعيد كل المنتجات النشطة مع
`pos_units`/`pos_barcodes` محسوبة خادمياً. لا مسار متغيّرات موجود إطلاقاً قبل
هذه المهمة — علّقت `PosCustomerPriceListResolver::catalogUnitsFor()` نفسها
صراحة: *"هذا المسار منتجٌ بسيط فقط — حدود POS، VAR-POS-1 لاحقاً"*.

**الباركود**: لا نقطة نهاية خادمية لحلّ باركودٍ ممسوحٍ قبل هذه المهمة —
المطابقة بالكامل عميلية (`web/src/lib/pos-barcode.ts`، `matchPosBarcode`) ضد
الكتالوج المحمَّل مسبقاً. `product_barcodes` (الجدول البديل متعدد الوحدات،
PR-UOM-1) يحمل `product_id`/`unit_name` فقط — **لا عمود يربط باركوداً بمتغيّرٍ
بعينه**. `ProductVariant` نفسه **بلا حقل باركود** — الهويّة الوحيدة له SKU +
`combination_key`، فباركود المتغيّر ممكنٌ فقط عبر `product_barcodes` بعد
توسيعه.

**التسعير**: `PosCustomerPriceListResolver::posPriceFor()`/`priceFor()`
(POS فقط، منفصلة عن `CommercePriceResolver` الخاص بالمتجر الإلكتروني —
خارج النطاق) — سلطة POS الوحيدة للسعر الملزم عند إيقاف
`allow_unit_price_override`. `ProductPricingService::resolveExplicit()`/
`resolveSellable()` (VAR-PRICE-1) **جاهزتان فعلاً** بمعامل `?ProductVariant`،
`resolveSellable()` بالذات تنفِّذ **حرفياً** ما يطلبه العقد («سعر المتغيّر
الصريح ← وإلا سعر المنتج الأساسي لنفس الوحدة ← لا تراجعٌ عبر وحداتٍ مختلفة»).

**المخزون**: `InventoryService::applyReceipt()`/`applyIssue()`/
`assertStockAvailable()`/`resolveInventoryState()` تحمل معامل `?ProductVariant`
منذ VAR-INV-1؛ `recordSaleCogs()` كان يحمل تعليقاً صريحاً «السطر لا يحمل
متغيّراً بعد (VAR-DOC-1 لاحقاً)» — أُغلق هذا التعليق فعلياً في VAR-DOC-1.
هذه المهمة أضافت فقط `product_variant_id` على `stock_movements` (كان غائباً
حتى بعد VAR-INV-1) للتتبّع، بلا مسّ خوارزمية المتوسط المتحرك.

**العهدة (السلة)**: `PosHeldSale.payload` عمودٌ JSON مرن — لا حاجة migration
لحمل `product_variant_id`؛ الحاجة الفعلية كانت في `PosHeldSaleService::hold()`
الذي كان يعيد بناء مصفوفة العنصر صراحةً (يسقط أي مفتاحٍ غير مُدرَج).

## Identity Contract

`product_id` + `product_variant_id` (`null` لمنتجٍ بسيط، إلزاميٌّ فعلياً
لمنتجٍ متعدد الخيارات) + `unit` — نفس عقد VAR-DOC-1 حرفياً، ممتدٌّ إلى نقطة
البيع. **الحكم الملزم الوحيد** يبقى `DocumentLineVariantResolver::resolve()`
داخل `InvoiceService::create()` — لا نسخة موازية منه في POS. طبقات POS
(الطلب/الخدمة) تضيف فحوصاً **مبكرة** (رسائل أوضح، فشلٌ أسرع) لا تستبدل الحكم
النهائي: `PosController::checkout()`/`storeHeldSale()`/`storeExchange()` تتحقق
من وجود المتغيّرات ضمن المستأجر (`assertTenantOwnedAll`)، و
`PosService::assertUnitPricesAllowedForPos()` تحلّ سعر المتغيّر المرسَل فقط
بعد التحقّق محلياً من انتمائه لنفس المنتج/المستأجر (وإلا `null` صراحةً، فتُرفض
كسعرٍ غير مطابق).

## Barcode Resolution

**`App\Services\Pos\PosBarcodeResolver`** — نقطة القرار الوحيدة، تُستهلَك عبر
`POST /api/pos/barcode` (خادميٌّ بالكامل). ترتيب الحلّ: `ProductBarcode`
(بديل، يحمل الآن `product_variant_id` اختيارياً) أولاً، ثم `products.barcode`/
`products.sku` (الأساسي). كلاهما مُصفًّى بمستأجر السياق النشط (`TenantContext`)
لا معرّفٍ من العميل. **فشلٌ مغلَق دائماً**: باركودٌ غير موجود، خارج المستأجر
(نفس رسالة «not found» — لا تسريب وجوده في مستأجرٍ آخر)، منتجٌ متعدد الخيارات
بلا `product_variant_id` محلولٍ من الباركود (لا افتراض أول متغيّر)، أو متغيّرٌ
معطَّل. `ProductBarcode::booted()` يحمل حارس `saving` مطابقاً لـ`ProductMedia`
حرفياً (VAR-MEDIA-1's نمط) — متغيّرٌ لا يتبع المنتج أو من مستأجرٍ آخر يُرفض
قبل أي كتابة.

**الباركود لا يحدِّد السعر أبداً** — `PosBarcodeResolver::priced()` يستدعي
`posPriceFor()` (سلطة VAR-PRICE-1 نفسها)، لا يقرأ سعراً مخزَّناً على الباركود.
اختبارٌ صريح (`barcode_does_not_determine_price_the_canonical_authority_does`)
يثبت أن نفس الباركود يعيد سعرين مختلفين حسب قائمة سعر العميل.

## Pricing

`posPriceFor()`/`priceFor()` امتدّتا بمعامل `?ProductVariant $variant = null`
(توافقٌ رجعيٌّ كامل — `null` يبقي سلوك المنتج البسيط حرفياً). عند وجود متغيّر:
`fallback = ProductPricingService::resolveSellable($product, $variant, null)`
— سلطة VAR-PRICE-1 الجاهزة أصلاً، تحقّق حرفياً «سعر المتغيّر الصريح ← سعر
الأب لنفس الوحدة ← لا سعر»، **لا تراجعٌ عبر وحداتٍ مختلفة ولا على شقيقٍ آخر**.
`catalogVariantPricesFor()` (جديدة) توازي `catalogUnitsFor()` لكن `product_variant_id`
صريحٌ لا `whereNull` — عكس ما تستبعده الدالة الأصلية تماماً.

**خطأ اكتُشف وأُصلح أثناء التطوير (ليس في الإنتاج القائم قبل هذه المهمة)**:
تمرير اسم وحدةٍ صريح (حتى لو كان وحدة الأساس نفسها) إلى
`ProductPricingService::resolveExplicit()`/`PriceListService::resolve()`
يفشل لمنتجٍ بلا قالب وحدات (`UnitConversion::resolve()` يتطلب قالباً لأي اسمٍ
غير `null`). كودي الجديد (`PosBarcodeResolver`) كان يمرّر الاسم الصريح دوماً؛
الإصلاح: `posPriceFor()` يمرّر `null` صراحةً لفرع «ليست وحدة بديلة» بدل الاسم
المُستلَم — يطابق الاصطلاح المتّبع في بقية طبقة التسعير بالضبط.

## Cart

**الهويّة**: `PosCartLine` (يعرّف الشكل لكلٍّ من الحالة المحلية والـheld-sale)
اكتسب `productVariantId`/`variantDescriptor` اختياريَّين — إضافيّان بحتاً.
`appendPosCartProduct()`/`matchPosBarcode()` (`web/src/lib/pos-barcode.ts`)
تميّزان الآن هويّة السطر بـ(منتج + متغيّرٌ اختياري + وحدة) — أسود/كبير + قطعة
**لا يندمج** مع أبيض/صغير + قطعة، ولا مع أسود/كبير + كرتون. منتجٌ بسيط
(`variant` غائب) يحتفظ بالسلوك السابق حرفياً (مفتاح `منتج:وحدة` فقط).

**استرجاع الجلسة**: `PosHeldSaleService::hold()` كان يُسقط أي مفتاحٍ غير
مُدرَج صراحةً عند بناء `payload.items` — أُضيف `product_variant_id` إليه.
`PosHeldSaleResource` (الاستجابة) وواجهة `retrieveSale()` (استعادة السلة)
كلاهما يحمل الحقل الآن كاملاً من الحفظ حتى الاستئناف.

**متغيّرٌ أصبح معطَّلاً بين الحفظ والإتمام**: لا إعادة تفسيرٍ عمياء — العهدة
تُستعاد بهويّتها القديمة كما هي، و**الإتمام** (لا الاسترجاع) هو من يعيد
التحقّق ويفشل مغلَقاً (`checkout_fails_closed_when_the_variant_is_deactivated_after_the_cart_was_saved`)،
بلا خصمٍ مخزنيٍّ جزئي.

## Checkout Security

لا حكمٌ ثانٍ مبنيٌّ من الصفر — `DocumentLineVariantResolver::resolve()` (داخل
`InvoiceService::create()`) هو الحاجز الملزم الوحيد، وهو **موجودٌ أصلاً** منذ
VAR-DOC-1. أُضيف:
- `assertTenantOwnedAll(ProductVariant::class, ...)` في `checkout()`/
  `storeHeldSale()`/`storeExchange()` — فحصٌ مبكرٌ إضافي (422 سريعة، رسالة
  أوضح) قبل الوصول لطبقة الأعمال.
- `assertUnitPricesAllowedForPos()` تتحقق من انتماء المتغيّر المرسَل للمنتج/
  المستأجر **محلياً** قبل استعمال سعره — متغيّرٌ غير مطابقٍ يُعامَل كـ`null`
  فيفشل حكم مطابقة السعر تلقائياً (لا يُحسَب سعرٌ بمزاوجةٍ خاطئة أصلاً).

اختبارات سلبية مباشرة (كلها `422` من نقطة نهاية `/api/pos/checkout` الحقيقية،
لا اختبار وحدة): تركيبة منتج/متغيّرٍ خاطئة، متغيّرٌ عابرٌ للمستأجر، منتجٌ
متعدد الخيارات بلا متغيّر، منتجٌ بسيطٌ بمتغيّرٍ صريح، متغيّرٌ معطَّل، سعرٌ لا
يطابق سلطة التسعير الخاصة بالمتغيّر (سعر الشقيق مثلاً).

## Inventory

`InvoiceService::create()`/`post()` (المُستدعاة من `PosService::checkout()`
حرفياً بلا وسيط) تمرّر المتغيّر المحلول لكل من `resolveInventoryState()` و
`applyReceipt()`/`assertStockAvailable()` — **لا كودٌ مخزنيٌّ جديد كُتب لـ
POS تحديداً**؛ الطريق موجودٌ أصلاً منذ VAR-DOC-1. اختبارٌ صريح يثبت أن بيع
أسود/كبير عبر `/api/pos/checkout` الحقيقي يخفّض `InventoryState` الخاصة به
فقط، بينما أبيض/صغير (الشقيق) يبقى بكميته ومتوسط تكلفته كما هما تماماً — لا
مخزون أبٍ موازٍ يظهر لمنتجٍ متعدد الخيارات.

## Documents

لا منطق لقطةٍ تاريخية جديد داخل POS إطلاقاً — `PosService::checkout()` يمرّر
`items` مباشرةً إلى `InvoiceService::create()`، الذي يستدعي
`DocumentLineVariantResolver::descriptor()` (سلطة VAR-DOC-1 الوحيدة) ويكتب
`variant_descriptor_snapshot` مرّةً واحدة. الفاتورة الناتجة عن بيع POS **لا
تختلف بنيوياً عن أي فاتورة أخرى** تحمل متغيّراً — نفس الجدول، نفس الحارس، نفس
الثبات بعد الترحيل (مُثبَتٌ فعلياً في `VariantDocumentLineTest`، VAR-DOC-1).

## Idempotency / Concurrency

`checkoutRequestChecksum()` (المُستخدَمة لاكتشاف تعارض إعادة الإرسال) كانت
تتجاهل `product_variant_id` تماماً — **ثغرة حقيقية اكتُشفت وأُصلحت**: إعادة
إرسالٍ بنفس `idempotency_key` لكن بمتغيّرٍ مختلف كانت ستُحسَب checksum مطابقاً
فتُقبل كـ«نفس الطلب» بدل تعارضٍ (409). أُضيف `product_variant_id` إلى مصفوفة
عنصر الـchecksum. لا تغييرٌ في بنية القفل/المعاملة القائمة (`Branch::lockForUpdate()`
+ `PosCheckoutAttempt` بقيدٍ فريد) — نفس الآلية، مدخلٌ إضافي في التوقيع فقط.

اختباران يثبتان: نفس المفتاح + نفس المتغيّر مرّتين → فاتورةٌ واحدة، خصمٌ
مخزنيٌّ واحد. نفس المفتاح + متغيّرٌ مختلف → `409` (تعارضٌ صريح، لا إعادة
تشغيلٍ صامتة تخصم مخزون المتغيّر الثاني خطأً).

## Tenant Isolation

سلبيّات مباشرة عبر `/api/pos/checkout` و`/api/pos/barcode` الحقيقيَّين:
متغيّرٌ عابرٌ للمستأجر (فشلٌ مغلَق، رسالةٌ لا تفرّق «غير موجود» عن «مستأجرٌ
آخر»)، باركودٌ عابرٌ للمستأجر (نفس الرسالة — لا تسريب وجوده)، متغيّرٌ من
منتجٍ آخر لنفس المستأجر. `PosBarcodeResolver` يعتمد `TenantContext` النشط
حصراً، لا أي معرّفٍ من جسم الطلب.

## Frontend

**لا إعادة تصميم** — تعديلاتٌ إضافية محدودة على `web/src/app/(pos)/pos/page.tsx`
(نموذج `Product`/`addProduct`/إعادة مزامنة الكتالوج/عرض السطر)، ملفين جديدين
صغيرين (`pos-variant-picker-dialog.tsx`، توسيع `pos-barcode.ts`)، وحقلين في
`pos-active-cart.ts`/`pos-held-sales-dialog.tsx`:

- **اختيار المتغيّر**: `addProduct()` يفتح `PosVariantPickerDialog` (لائحة
  أزرارٍ بوصف التركيبة وسعرها — لا Configurator) بدل الإضافة المباشرة، عندما
  `product.pos_variants.length > 0` ولا متغيّرٌ مُمرَّرٌ صراحةً بعد (النقر
  المباشر، البحث السريع، ونتيجة الباركود الناجحة كلها تمرّ عبر نفس الدالة).
- **لقطة الوصف في سطر السلة**: `description` السطر يصبح «اسم المنتج — تركيبة
  المتغيّر» تلقائياً — لا عنصر واجهة إضافي منفصل.
- **الوحدة**: قائمة اختيار الوحدة البديلة **مخفيّةٌ عمداً** لسطر متغيّرٍ (لا
  تسعير متغيّرٍ لوحدة بديلة مبنيٌّ بعد — قرار نطاقٍ موثَّق أدناه).
- **الباركود**: `matchPosBarcode()` تطابق باركوداً بديلاً يحمل `product_variant_id`
  فيعيد المتغيّر الصحيح مباشرة؛ منتجٌ متعدد الخيارات **لا يُطابَق أبداً** عبر
  SKU/الباركود الأساسي، ولا عبر باركودٍ بديلٍ بلا متغيّرٍ محدَّد (لا مسار بيعٍ
  غامض). المطابقة تبقى عميليةً ضد الكتالوج المحمَّل مسبقاً (نفس بنية POS
  الحالية)؛ نقطة النهاية الجديدة `/api/pos/barcode` **جاهزةٌ ومُختبَرة** لمن
  يريد جولة خادمية حقيقية لكل مسحة لاحقاً (خارج هذه الجولة — انظر Risks).
- **إعادة مزامنة الكتالوج**: كانت `useEffect` تعيد تسعير كل سطرٍ من `pricedUnit`
  (تسعير الأب) دون تمييز — كان سيكسر سطر متغيّرٍ صامتاً؛ أُصلح ليقرأ
  `pos_variants` بمعرّف المتغيّر بدلاً من ذلك.

## Changed Files

**Migrations (جديدة):** `2026_09_30_010000_add_variant_identity_to_product_barcodes.php`
— `product_variant_id` نطاقي على `product_barcodes`.

**Backend:**
- `app/Models/ProductBarcode.php` — `product_variant_id` + `variant()` +
  حارس `saving` (انتماء/مستأجر).
- `app/Services/Pos/PosBarcodeResolver.php` — **جديد**: نقطة حلّ الباركود
  الوحيدة.
- `app/Services/Accounting/PosCustomerPriceListResolver.php` — `priceFor()`/
  `posPriceFor()` بمعامل `?ProductVariant`؛ `catalogVariantPricesFor()` جديدة.
- `app/Http/Controllers/Api/PosController.php` — `products()` يعرض
  `pos_variants`/`product_variant_id` على الباركودات؛ `resolveBarcode()`
  جديدة (`POST /api/pos/barcode`)؛ فحوصٌ مبكرة إضافية لعزل المستأجر على
  المتغيّرات في `checkout()`/`storeHeldSale()`/`storeExchange()`؛
  `returnableInvoice()` يعرض هويّة المتغيّر.
- `app/Services/Accounting/PosService.php` — `checkoutRequestChecksum()`
  يشمل `product_variant_id`؛ `assertUnitPricesAllowedForPos()` يحلّ سعر
  المتغيّر المتحقَّق من انتمائه محلياً.
- `app/Services/Accounting/PosReturnService.php` — يمرّر `product_variant_id`
  من سطر الفاتورة المصدر.
- `app/Services/Accounting/PosHeldSaleService.php` — `hold()` يحفظ
  `product_variant_id` بدل إسقاطه.
- `app/Http/Requests/StorePosSaleRequest.php`،
  `StorePosHeldSaleRequest.php`، `StorePosExchangeRequest.php` — قاعدة
  `items.*.product_variant_id` إضافية.
- `app/Http/Resources/ProductResource.php`، `PosHeldSaleResource.php` —
  حقول `pos_variants`/`product_variant_id` إضافية.
- `routes/api.php` — `POST /pos/barcode`.

**Frontend:**
- `web/src/lib/pos-active-cart.ts` — `PosCartLine.productVariantId`/
  `variantDescriptor`.
- `web/src/lib/pos-barcode.ts` — مطابقة/إضافة متغيّرات-محورية.
- `web/src/components/pos/pos-variant-picker-dialog.tsx` — **جديد**.
- `web/src/components/pos/pos-held-sales-dialog.tsx` — `PosHeldSaleItem.product_variant_id`.
- `web/src/app/(pos)/pos/page.tsx` — `Product.pos_variants`، `addProduct()`
  variant-aware، عرض السطر، إعادة مزامنة الكتالوج، حمولات الإتمام/التعليق/
  الاستعادة.
- `web/src/messages/{ar,en}.json` — نصوص لائحة الاختيار.

**Tests (جديدة):** `tests/Feature/PosVariantCheckoutTest.php` (19 اختباراً)،
`web/src/lib/__tests__/pos-barcode.test.ts` (6 اختبارات VAR-POS-1 إضافية).

**Test-only fix:** `tests/Feature/PosCheckoutTest.php` — تحديث تأكيدٍ واحدٍ
حرفي (`pos_barcodes` الآن يحمل `product_variant_id: null` إضافياً).

## Tests

**الأمر:** `php artisan test --filter=PosVariantCheckoutTest` — 19/19 ✅
(SQLite وPostgreSQL كلاهما، انظر الجدول). `npx vitest run src/lib/__tests__/pos-barcode.test.ts` — 10/10 ✅.

| البيئة | PosVariantCheckoutTest | الانحدار (POS×6 + Invoice + VariantDocumentLine + ProductVariantCore + InventoryState) | كامل بلا فلتر |
|---|---|---|---|
| SQLite | 19/19 ✅ | 172/172 ✅ | 3727 نجح، 27 فشل (معزولة — `bcmath`/PDF مفقودان في البيئة، لا علاقة لها بـVAR-POS-1، نفس الأساس الموثَّق في VAR-DOC-1)، 39 مُتجاوَز (اختبارات PostgreSQL الحقيقية) ✅ |
| PostgreSQL | 19/19 ✅ | 227/227 ✅ (شمل الفلتر الموسَّع نفسه) | جارٍ — سيُحدَّث في commit متابعةٍ صغير إن ظهر ما يستحق تصحيحه |

`migrate:fresh --force` على PostgreSQL نجح كاملاً بما فيها الـmigration الجديدة
(`add_variant_identity_to_product_barcodes`) بلا أي خطأ توافق.

**الواجهة**: `npx tsc --noEmit` — صفر أخطاءٍ جديدة في أي ملفٍّ لمسته هذه
المهمة (الأخطاء الموجودة قبلها في ملفاتٍ أخرى غير مرتبطة لم تتغيّر).
`npm run build` — نجح كاملاً. `npx vitest run` على ملفَي POS المتأثرين —
11/11 ✅ (شاملةً اختبار تركيب الصفحة الحالي بلا كسر).

## Build / CI

الفرع/الملفات المذكورة أعلاه فقط عُدِّلت. لا تغييرٌ في `composer.json`/
`package.json`. الانحدار المُستهدَف + المُوسَّع أخضرٌ بالكامل على SQLite
(172 + 19 اختباراً). تشغيلٌ كاملٌ بلا فلتر على PostgreSQL بدأ قبل تسليم هذا
التقرير — إن اكتمل قبل الدفع سيُذكَر هنا، وإلا فسيُدفَع commit متابعةٍ صغير
إن ظهر ما يستحق تصحيحاً (نفس النمط المتّبع في الجولات السابقة). GitHub
Actions على الفرع بعد الدفع — لم تُفحص بعد.

## Risks / Remaining

- **تسعير وحدةٍ بديلة لمتغيّرٍ فعلي غير مبنيٍّ في الواجهة**: الخادم
  (`posPriceFor`) يدعمه فعلياً (نفس مسار المنتج البسيط)، لكن قائمة اختيار
  الوحدة **مخفيّةٌ عمداً** لسطر متغيّرٍ في الواجهة تجنّباً لعرض سعرٍ غير
  محلولٍ بشكل صحيح دون جولة كتالوجٍ إضافية لكل (متغيّر × وحدة) — قرار نطاقٍ
  صريح، لا نقص أمان (الخادم يرفض أي سعرٍ لا يطابق السلطة على أي حال).
- **مسح الباركود في الواجهة عمليٌّ لا خادميّ لكل مسحة** — يطابق ضد الكتالوج
  المحمَّل مسبقاً (نفس بنية POS القائمة قبل هذه المهمة تماماً). نقطة النهاية
  `POST /api/pos/barcode` **جاهزةٌ ومُختبَرة بالكامل** لمن يريد جولةً خادمية
  حقيقية لكل مسحة (مفيدٌ خصوصاً لمنتجٍ لم يصل بعد ضمن صفحة الكتالوج
  المحمَّلة)؛ لم يُستهلَك من `scanCode()` في هذه الجولة تفادياً لإعادة كتابة
  مسار الماسح الفوري بالكامل — الأمان غير متأثر لأن checkout يعيد التحقّق
  الكامل مهما كان مصدر إضافة السطر.
- **إشعار/تبديل الباركود UI الخاص بمنتجٍ متعدد الباركود** (المذكور في العقد
  الموثَّق `AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md`) خارج
  النطاق صراحةً — لم يُلمَس.
- **VAR-COM-1** (متجرٌ إلكتروني)، **VAR-REPORT-1** (أبعاد التقارير)، **إعادة
  تصميم إنشاء/تعديل المنتج** — مؤجَّلة صراحةً كما طُلب، بلا أي تغيير هنا.
- تشغيل PostgreSQL الكامل قد لا يكتمل قبل تسليم هذا التقرير — سيُحدَّث/يُدفَع
  commit متابعةٍ صغير إن لزم.

## Git

- Branch: `claude/var-pos-1-variant-pos`
- PR: "VAR-POS-1: Variant-aware POS selection and checkout"
- Base SHA: `15f6c53d4fddc8fc0a19ac96ab6738eb3ea44d4b`
- Head SHA: `bb94bcada702b6362b4bd67cc83ed61ef6ce12d1`

## Next Step

**VAR-COM-1** فقط، وبعد موافقة صفوان الصريحة على هذا التقرير أولاً. لا
Merge، لا Deploy، لا بدء أي عملٍ آخر حتى تصل تلك الموافقة.
