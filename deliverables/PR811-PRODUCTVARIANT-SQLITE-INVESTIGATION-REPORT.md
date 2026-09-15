# تقرير: فحص `ProductVariantCoreTest > duplicate option names` على SQLite

## الخلاصة الحاسمة أولًا

**الفشل الموصوف غير موجود لا في CI الفعلي ولا محليًا.** فُحص سجل كل job فعلي
لهذا الفرع (لا تخمين)، وأُعيد إنتاج الاختبار محليًا على SQLite بعدة صور — ولم يظهر
`ProductVariantCoreTest > duplicate option names are rejected after normalization`
فاشلًا في أيٍّ منها، ولا ظهرت `product_options_product_id_name_key_unique` كخطأ فعلي
في أي log.

## ١. فحص كل job فعلي لهذا الفرع (لا افتراض)

راجعتُ **كل** تشغيلات CI المسجّلة لفرع `com-checkout-1c/storefront-wiring` حتى الآن
(بحثًا نصيًا مباشرًا عن `ProductVariant`/`UniqueViolation`/`FAILED` في كل سجل):

| Commit | Job | النتيجة | الفشل الفعلي |
|---|---|---|---|
| `b6b9102` | pgsql | فشل | `ImportJobWorkbookApplyTest` — lock timeout (مُصلَح لاحقًا في `3d27771`) |
| `b6b9102` | sqlite | **نجاح** | — |
| `e9c4c78` (push) | pgsql+sqlite | **نجاح** | — |
| `e9c4c78` (pull_request، نفس الـcommit) | pgsql+sqlite | فشل | `ReportEffectiveScopeTest` (5 فشل، مطابق حرفيًا في الجوبين) |

**لا ظهور واحد لـ`ProductVariantCoreTest` فاشلًا في أي job، على أي محرك، عبر كل
تاريخ الفرع.** الفشل الوحيد المتبقي فعليًا في CI الحالي هو `ReportEffectiveScopeTest`
(تقارير المخزون حسب النطاق — لا علاقة له بـProduct Variants)، وهو خارج نطاق هذا
الطلب صراحة.

## ٢. إعادة الإنتاج محليًا (SQLite)

- الاختبار المستهدف منعزلًا: **10 تشغيلات متتالية → 10/10 نجاح**.
- `ProductVariantCoreTest` كاملًا (31 اختبارًا): **5 تشغيلات → 155/155 نجاح**.
- **كامل مجموعة الاختبارات** (`php artisan test` بلا فلتر، مطابقًا لأمر CI حرفيًا) على
  SQLite: **`PASS Tests\Feature\ProductVariantCoreTest`** — صفر فشل فيه، ضمن تشغيلة
  كاملة أظهرت 48 فشلًا **كلها** من فجوة معروفة سابقًا وموثّقة في هذه الجلسة
  (`setup.sh` المحلي لا ينسخ `app/Support/Inventory/*.php` خلافًا لـ`ci.yml` في CI
  الفعلي)، ولا علاقة لأيٍّ منها بـProduct Variants أو القيد المذكور.

## السبب الجذري

لا سبب جذري لإصلاحه — **لا يوجد عطل**. القيد `product_options_product_id_name_key_unique`
حقيقي وصحيح (على `unique(['product_id','name_key'])`)، ومنطق التطبيع
(`name_key` = تصغير+تشذيب) في `ProductOption`/`ProductVariantService` يعمل كما هو
مصمَّم: الاختبار يرسل `'  اللون  '` بعد إنشاء `'اللون'`، ويتوقع `422` — وهذا **بالضبط**
ما يحدث في كل تشغيلة تحققتُ منها، بلا اصطدام غير متوقَّع بقيد قاعدة البيانات.

## القرار

- **لا تعديل على الكود** — لا على `ProductOption`، لا على `SkuRegistryEntry`، لا على
  أي قاعدة Product Variants/UOM، لا على schema، لا على Checkout/Cart/Commerce.
- لا داعٍ لأي إصلاح لأن الفشل الموصوف لا يتكرر ولم يظهر قط في سجلّ فعلي.

## الملفات المتغيرة

لا شيء.

## الاختبارات ونتائجها

| التشغيلة | العدد | النتيجة |
|---|---|---|
| الاختبار المستهدف منعزلًا (SQLite) | 10 | 10/10 ✓ |
| `ProductVariantCoreTest` كاملًا (SQLite) | 5 × 31 = 155 | 155/155 ✓ |
| كامل مجموعة الاختبارات محليًا (SQLite، مطابقة CI) | 1 | `ProductVariantCoreTest`: 31/31 ✓ (48 فشلًا أخرى، كلها فجوة `setup.sh` معروفة مسبقًا وغير متعلقة) |

## CI

لم يُعَد تشغيل أي CI ضمن هذه المهمة (لا تعديل يستحق دفعًا). آخر حالة فعلية لـPR #811:
- `ReportEffectiveScopeTest` (5 فشل) — الفشل الحقيقي المتبقي، ظاهر في push ناجح
  وفشل pull_request لنفس الـcommit (`e9c4c78`) — إشارة تذبذب واضحة، **خارج نطاق
  هذا الطلب** الذي حدَّد `ProductVariantCoreTest` تحديدًا.
- PR #811 **ما زال ممنوعَ الدمج** كما طُلب — لم يُدمَج ولم يُنشَر.

## Base/Head SHA

- Base: `c152e3ee634be3e7c2bb12db299a5ddd44472558` (main)
- Head: `e9c4c7894e1e70b9a71139db5d64ef39bd6938af` (بلا تغيير — لا شيء دُفع في هذه المهمة)

## المخاطر والمتبقي

- **الفشل الحقيقي المتبقي على CI هو `ReportEffectiveScopeTest`**، ليس
  `ProductVariantCoreTest`. إن كان هذا هو المقصود فعليًا، أخبرني لأفتحه كمهمة
  منفصلة بنفس البروتوكول (سجل فعلي أولًا، سبب جذري مثبت، إصلاح أصغر حتمي).
- إن كان لدى حضرتك سجل CI أحدث أو مختلف يُظهر هذا الفشل فعليًا (رابط job محدد)،
  أرسله وسأفتحه مباشرة بدل الاعتماد على وصف نصي فقط — كما حدث سابقًا في هذه
  الجلسة، النص المنقول قد لا يطابق الـlog الفعلي حرفيًا.
