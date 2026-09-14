# تقرير: إصلاح تذبذب/فشل ImportJobInventoryOpeningApplyTest على PostgreSQL

## Root Cause المثبت (لا افتراض flake)

الفشل **حتمي 100%**، ليس تذبذب CI. السبب الجذري:

`ImportJobInventoryOpeningApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock`
(ومثيلها في `ImportJobWorkbookApplyTest`) ينشئ في إعداده `Product` عبر Eloquent
(`Product::create(['sku' => ..., ...])`) على **نفس الاتصال الافتراضي** الذي تُغلّفه
`RefreshDatabase` بمعاملةٍ واحدة لا تلتزم (commit) إلا في `tearDown()`.

`Product::booted()` (من دمج **VAR-CORE-1**، PR #806 — ميزة منفصلة تماماً ومُدمَجة
لاحقاً في `main`) يطالب بـ SKU عند الإنشاء عبر `SkuRegistryEntry::claim()`، وهذه بدورها
تستدعي `lockTenantAnchor()`:

```php
private static function lockTenantAnchor(): void
{
    $tenantId = app(TenantContext::class)->id();
    if ($tenantId !== null) {
        Tenant::whereKey($tenantId)->lockForUpdate()->first();
    }
}
```

هذا `SELECT ... FOR UPDATE` **صحيحٌ ومقصودٌ في الإنتاج** — يُسلسل مطالبات SKU المتزامنة
عبر جدولين (`sku_registry` و`products`) لا يجمعهما قيدٌ فريدٌ واحد. في الإنتاج يُغلَق
فوراً مع التزام طلب إنشاء المنتج (مللي‑ثوانٍ). لكن داخل هذا الاختبار، بما أن
`RefreshDatabase` تُبقي المعاملة مفتوحة حتى نهاية الاختبار، يبقى القفل **محجوزاً حصرياً
على صفّ المستأجر لبقية الاختبار كله**.

لاحقاً في نفس الاختبار، يفتح الاختبار اتصال PostgreSQL منفصلاً حقاً (`rival`) بمهلة
`lock_timeout = '200ms'` ليثبت أن قفل `import_jobs` حقيقي. عند إدراج صفٍّ في
`import_jobs`/`price_lists` يشير بمفتاح أجنبي إلى نفس صفّ المستأجر، يطلب PostgreSQL
قفل `FOR KEY SHARE` على ذلك الصفّ للتحقق من المفتاح الأجنبي — فيصطدم بالقفل الحصري
المفتوح أعلاه، وينتظر حتى تنتهي مهلة الـ200ms المخصَّصة أصلاً لفحصٍ مختلفٍ تماماً
(قفل `import_jobs`)، فيفشل بـ `SQLSTATE[55P03]`.

**أُثبت بالأدلة**: تتبّع مباشر لقفل PostgreSQL (`pg_locks`/`pg_stat_activity`) مع
`log_lock_waits`/`log_statement=all` أظهر بوضوح: الاتصال الافتراضي ينفّذ
`select * from tenants ... for update` مباشرةً بعد `insert into products`، ثم
`insert into sku_registry` — والاتصال `rival` ينتظر تلك المعاملة بعينها (`ShareLock on
transaction <xid>`) قبل أن يفشل.

## لماذا ليس CI flake

- تكرار الاختبار **15 مرة منعزلاً** على PostgreSQL حقيقي قبل الإصلاح → **15/15 فشل**
  بنفس الخطأ حرفياً في كل مرة.
- **20 مرة إضافية** → **20/20 فشل**.
- بعد الإصلاح: **25 مرة منعزلاً** + **6 مرات لكامل الصنف (72 اختباراً)** + **6 مرات
  لكامل مجموعة `ImportJob*` (57×6 = 342 اختباراً)** → **صفر فشل** في كل الحالات.

## الإصلاح ولماذا هو الصحيح

**لا تعديل على الكود الإنتاجي إطلاقاً.** قفل `lockTenantAnchor()` صحيحٌ ومقصود
(يمنع تصادم SKU فعلياً عبر VAR-CORE-1)، وإضعافه كان سيعيد فتح الثغرة التي أُغلقت به —
ممنوعٌ صراحةً بتعليمات المهمة.

الإصلاح **على مستوى الاختبار فقط**: إنشاء منتج التجهيز (fixture) عبر
`Product::withoutEvents()` بدل `Product::create()` المباشر، فيتخطّى حدث `saved()`
(ومن ثمّ `SkuRegistryEntry::claim()`/القفل) الذي لا علاقة له بما يفحصه أيٌّ من
الاختبارين (قفل صفّ `import_jobs`/`price_lists`، لا اتساق سجلّ SKU). مطابقة الاستيراد
(`InventoryOpeningImportService`/`ProductWorkbookService`) تقرأ `products.sku` مباشرةً،
لا `sku_registry` — فتخطّي الحدث لا يغيّر ما يفحصه الاختبار.

بما أن `withoutEvents()` يعطّل كل أحداث النموذج (لا حدثاً بعينه)، عُوِّض `tenant_id`
صراحةً في الحمولة (كان يُملأ عبر `BelongsToTenant`'s `creating` — حدثٌ حقيقي).
توليد `id` عبر `HasUuids` **ليس** حدثاً بل جزءٌ من `Model::performInsert()` نفسه فبقي
يعمل بلا تأثّر — تحقَّق من هذا مباشرة (محاولة أولى بتمرير `id` صريح فشلت بصمت لأن
`id` ليس ضمن `$fillable`؛ الإصلاح النهائي يلتقط النموذج المُنشأ فعلياً بدل افتراض معرّفه).

لا تغيير في: مهلة `lock_timeout`، منطق إعادة المحاولة، تسلسل الاختبارات، أو أي
assertion. القفل الحقيقي قيد الاختبار (`import_jobs`) لا يزال يُثبَت بنفس الآلية
تماماً.

## الملفات المتغيرة

- `tests/Feature/ImportJobInventoryOpeningApplyTest.php` — تجهيز المنتج عبر
  `Product::withoutEvents()` بدل الإنشاء المباشر.
- `tests/Feature/ImportJobWorkbookApplyTest.php` — نفس النمط، ولا يستعمل
  `createProduct()` المشترك (يستعمله باقي اختبارات الملف كما هو دون تعديل).

**لا تعديل على أي ملف إنتاجي، لا Checkout، لا Cart، لا Pricing، لا مخزون، لا محاسبة،
لا schema، لا API.**

## الاختبارات ونتائجها (PostgreSQL 16 حقيقي)

| التشغيلة | العدد | قبل الإصلاح | بعد الإصلاح |
|---|---|---|---|
| `ImportJobInventoryOpeningApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` (منعزل) | 15 ثم 20 | 35/35 فشل | — |
| نفس الاختبار (منعزل، بعد الإصلاح) | 25 | — | 25/25 ✓ |
| `ImportJobInventoryOpeningApplyTest` كاملاً | 6 × 12 = 72 | — | 72/72 ✓ |
| `ImportJobWorkbookApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` (منعزل) | 10 ثم 15 | 10/10 فشل | 15/15 ✓ |
| مجموعة `ImportJob*` كاملةً (كل ملفات الاستيراد معاً) | 6 × 57 = 342 | 1 فشل متكرر | 342/342 ✓ |

**الهدف: صفر فشل — محقَّق.**

## CI

لم يُعَد تشغيل GitHub Actions ضمن هذه المهمة (الإصلاح دُفع للفرع نفسه لتلتقطه أعمال
CI تلقائياً)؛ التحقق أعلاه كلّه محلي على PostgreSQL 16 حقيقي مطابقٍ لبيئة CI
(نفس إصدار الحاوية، نفس المهاجرات).

## Base/Head SHA

- Base: `c152e3ee634be3e7c2bb12db299a5ddd44472558` (main)
- Head قبل هذه المهمة: `30b1656d94699a0d00eb3755f8ccbe55eedc70fa`
- Head بعد الإصلاح: `3d27771` (فرع `com-checkout-1c/storefront-wiring`، مدفوع)

## المخاطر والمتبقي

- **قفل `lockTenantAnchor()` نفسه سلوكٌ إنتاجي صحيح وموسَّع**: أي مسار إنتاجي طويل
  المعاملة (نادر، لكن ممكن نظرياً — مثلاً معاملة طويلة تُنشئ منتجاً ثم تنتظر عملية
  أخرى على نفس المستأجر) قد يصطدم بنفس الفئة من الانتظار في الإنتاج الحقيقي — هذا
  خارج نطاق هذه المهمة تماماً (لم يثبت التحليل حاجة لتغييره، ولا يجوز المساس به بلا
  إثبات).
- اختباران مشابهان آخران في نفس العائلة (`ImportJobApplyTest`,
  `DocumentNumberingTest`) يستعملان نمط `rival`/`lock_timeout` مشابهاً لكنهما **لا
  ينشئان `Product`** في إعدادهما — تحقّقتُ أنهما غير متأثرين (لا `Product::create`
  في أيٍّ منهما)، فلم يُعدَّلا.
- لم يُلمس إصلاح Checkout/Idempotency الموجود مسبقاً في #811 — لا ارتباط بينه وبين
  هذا الفشل.
