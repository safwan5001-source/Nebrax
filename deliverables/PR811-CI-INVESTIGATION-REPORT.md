# تقرير: فحص فشل PostgreSQL على PR #811

## الخلاصة الحاسمة أولًا

**الفشل الموصوف في الطلب غير موجود في الـ CI الفعلي لهذا الـ PR.** تم فتح الـ job والـ logs الخاصة بالفشل الوحيد الفعلي (لا تخمين، لا rerun أعمى) وتبيّن أنه **فشل مختلف تمامًا** عمّا ورد في الوصف الأصلي:

- **الوصف الأصلي:** `ProductVariantCoreTest > duplicate option values are rejected after normalization` — `UniqueViolation` على `product_options_tenant_id_name_unique`.
- **الواقع في CI:** لا وجود إطلاقًا لهذا الاختبار أو هذا القيد في أي log. الفشلان الفعليان في `ImportJobInventoryOpeningApplyTest` و`ImportJobWorkbookApplyTest`، وكلاهما `SQLSTATE[55P03]` (lock timeout)، ولا علاقة لهما بـ Product Variants.

## ١. الـ Job والـ logs الفعلية

- Run: `34869696688` → Job: `php artisan test (L11, pgsql)` (`id: 104062239142`) — الفشل الوحيد بين 6 check runs على PR #811.
- محتوى اللوق الفعلي (مسحوب ومقروء كاملًا):

```
Tests: 2 failed, 3685 passed (23563 assertions)

FAILED Tests\Feature\ImportJobInventoryOpeningApplyTest … QueryException
SQLSTATE[55P03]: Lock not available: canceling statement due to lock timeout
CONTEXT: while locking tuple (1,86) in relation "tenants"
SQL: insert into "import_jobs" ...

FAILED Tests\Feature\ImportJobWorkbookApplyTest > a conc…  QueryException
SQLSTATE[55P03]: Lock not available: canceling statement due to lock timeout
CONTEXT: while locking tuple (0,128) in relation "tenants"
SQL: insert into "price_lists" ...
```

لا وجود لأي `UniqueViolation`، ولا لاسم `ProductVariantCoreTest`، ولا لعبارة `product_options_tenant_id_name_unique` في كامل اللوق.

## ٢. تحقّق سلبي إضافي (إثبات عدم التخمين)

- البحث عن `product_options_tenant_id_name_unique` في كامل الكود والمهاجرات: **غير موجود بتاتًا**. القيد الفعلي الوحيد على `product_options` هو `unique(product_id, name_key)`، واسمه الحقيقي في PostgreSQL: `product_options_product_id_name_key_unique` (تحقّق مباشر عبر `\d product_options`).
- تشغيل `ProductVariantCoreTest::duplicate_option_values_are_rejected_after_normalization` **15 مرة منعزلة** على PostgreSQL 16 حقيقي → **15/15 نجاح**.
- تشغيل كامل `ProductVariantCoreTest` (31 اختبارًا) **8 مرات كاملة** → **248/248 نجاح**، صفر فشل، صفر تذبذب.
- تشغيل `ProductVariantPostgresConcurrencyTest` (races حقيقية عبر pcntl_fork) → **3/3 نجاح**.
- تشغيل مجموعة `Product*` الأوسع (413 اختبارًا ذا صلة) → 411 نجاح، وفشلان فقط ناتجان عن فجوة معروفة ومسبقة في `setup.sh` المحلي (لا تنسخ `app/Support/Inventory/*.php`، خلافًا لـ `ci.yml`) — غير متعلقين بالمهمة ولا يظهران في CI الفعلي أصلًا.

## السبب الجذري الحقيقي

لا يوجد عيب في `ProductVariantCoreTest` ولا في قيد `product_options`. الفشل الحقيقي الوحيد في CI هو **تذبذب/سباق أقفال PostgreSQL** (`SQLSTATE[55P03]`, lock timeout) في اختبارين غير مرتبطين بـ Product Variants إطلاقًا، وهما اختباران قائمان مسبقًا على `main` (`ImportJobInventoryOpeningApplyTest`, `ImportJobWorkbookApplyTest`) — كلاهما يتنافسان على قفل `FOR KEY SHARE` على صف `tenants` نفسه، نمط معروف من اختبارات التزامن الحساسة لحمل الـ CI runner.

**دليل داعم:** يوجد run آخر لنفس الـ job (`34869696032`) على كود شبه مطابق **نجح بالكامل** بلا أي فشل — ما يرجّح تذبذبًا مرتبطًا بضغط الـ CI runner، لا خللًا حتميًا في الكود.

## القرار

- **لا يوجد إصلاح مطلوب لـ Product Variants/UOM** — المشكلة الموصوفة غير موجودة أصلًا؛ أي تعديل هناك كان سيكون حلًا لعطل وهمي.
- الفشلان الفعليان (`ImportJob*`) **خارج نطاق الطلب تمامًا** — ليسا من ملفات PR #811 نفسه (اختباران قائمان مسبقًا على `main`)، ولا علاقة لهما بـ Checkout/Idempotency.
- **لم يُطبَّق أي تعديل على الكود.**

## الملفات المتغيرة

لا شيء من ناحية الكود المصدري. تم فقط دفع commit دمج (`git merge origin/main`) كان ضروريًا محليًا لمطابقة merge-ref الذي يبنيه CI فعليًا لأي PR — لا تعديل منطقي فيه.

## الاختبارات والنتائج

| المجموعة | العدد | النتيجة |
|---|---|---|
| `duplicate_option_values_are_rejected_after_normalization` (منعزل × 15) | 15 | 15/15 ✓ |
| `ProductVariantCoreTest` كاملًا (× 8 مرات) | 248 | 248/248 ✓ |
| `ProductVariantPostgresConcurrencyTest` | 3 | 3/3 ✓ |
| مجموعة `Product*` الأوسع | 413 | 411 ✓ (فشلان محليان من فجوة `setup.sh` المعروفة، غير ظاهرين في CI) |

## CI

- الفشل الفعلي الوحيد في CI لهذا الـ PR لا علاقة له بالسيناريو الموصوف؛ راجع القسمين ١ و٢ أعلاه.

## Base/Head SHA

- Base: `c152e3ee634be3e7c2bb12db299a5ddd44472558` (main)
- Head عند بدء الفحص: `2b8a6e429a34aed760936a2a76a894daf9774964`
- Head بعد دفع commit الدمج (بلا تعديل منطقي): `30b1656d94699a0d00eb3755f8ccbe55eedc70fa`

## مخاطر متبقية

- تذبذب `ImportJobInventoryOpeningApplyTest`/`ImportJobWorkbookApplyTest` في CI (lock timeout على `tenants`) لا يزال قائمًا كخطر تشغيلي على `main`، لكنه **خارج نطاق PR #811** صراحة (الملفان ليسا من تغييرات هذا الـ PR). يُوصى بفتحه كمهمة منفصلة إن رغب المالك بمتابعته (مثل رفع `lock_timeout` في اختبار التزامن أو إضافة إعادة محاولة مضبوطة).
- لم يُلمس إصلاح Checkout/Idempotency الموجود مسبقًا في #811 — لا ارتباط مثبت بينه وبين أي من الفشلين الفعليين.
