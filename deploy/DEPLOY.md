# نشر نبراس ERP — الـ Backend

الـ backend (Laravel 11 + PostgreSQL) يُنشر كحاوية Docker. المستودع نواة؛ صورة
Docker تُجمّع التطبيق الكامل وقت البناء عبر `deploy/assemble.sh`، ثم تُرحّل القاعدة
وتُقلع الخادم عبر `deploy/entrypoint.sh`.

## المنصة: Render (Blueprint)

الملف `render.yaml` في الجذر يعرّف كل شيء: خدمة ويب (Docker) + قاعدة PostgreSQL
مُدارة + ربط متغيّرات القاعدة تلقائياً.

### الخطوات

1. **ولّد مفتاح التطبيق** (مرة واحدة، محلياً):
   ```bash
   php artisan key:generate --show      # ينسخ مثل: base64:xxxxx...
   ```
2. **Render Dashboard → New → Blueprint** واربط مستودع `safwan5001-source/Nebrax`.
   يكتشف Render ملف `render.yaml` ويعرض الخدمة + القاعدة.
3. اضبط المتغيّرين المعلّمين `sync:false` على خدمة `nibras-api`:
   - `APP_KEY` = الناتج من الخطوة 1.
   - `FRONTEND_URL` = نطاق الواجهة على Vercel (مثل `https://nibras.vercel.app`).
     (يمكن إضافة أكثر من نطاق مفصولاً بفواصل.)
4. اضبط أيضاً بيانات تخزين الكائنات الخاص المتوافقة مع S3/R2 والمعلّمة `sync:false`:
   - `DOCUMENT_STORAGE_KEY` و`DOCUMENT_STORAGE_SECRET` و`DOCUMENT_STORAGE_BUCKET` و`DOCUMENT_STORAGE_ENDPOINT`.
   - يبقى `DOCUMENT_STORAGE_DRIVER=s3` كما هو في الـ Blueprint. لا تحفظ صور المنتجات على قرص Render المحلي لأنه مؤقت وقد يُمسح عند إعادة البناء أو الاستبدال.
5. **Apply** — يبني Render الصورة، يُرحّل القاعدة تلقائياً عند الإقلاع، ويعطيك
   عنواناً مثل `https://nibras-api.onrender.com`.
6. تحقّق من الصحّة:
   ```bash
   curl https://nibras-api.onrender.com/api/health   # {"status":"ok"}
   ```

## ربط الواجهة (Vercel)

على مشروع الواجهة في Vercel، اضبط متغيّر البيئة:

```
NEXT_PUBLIC_API_URL = https://nibras-api.onrender.com/api
```

ثم أعد النشر (Redeploy). بعدها يصبح **إنشاء العملاء/الفواتير/المنتجات محفوظاً فعلياً**
في قاعدة الإنتاج (لا وضع المعاينة).

## أول استخدام

- سجّل شركة جديدة عبر شاشة الدخول (زر التسجيل) → يُنشئ مستأجراً + مالكاً + دليل
  حسابات سعودياً تلقائياً.
- كل مستأجر معزول تماماً (TenantScope).

## الترحيل عند كل نشر — وماذا لو فشل

`deploy/entrypoint.sh` يشغّل `php artisan migrate --force` عند **كل إقلاع**، بخمس
محاولات لتفادي فشل الاتصال البارد بقاعدة مُدارة. فلا خطوة ترحيل يدوية بعد أي دمج:
يكفي أن يُعيد Render النشر.

**وإن فشلت المحاولات الخمس، تتوقّف الحاوية بـ `exit 1` عمداً.** الإقلاع بمخطّط
قديم يُنتج خدمةً «تعمل» بأخطاء ٥٠٠ متفرّقة وأرقام مبتورة بلا إنذار — وهو أخطر ما
يصيب نظاماً محاسبياً لأنه يفشل صامتاً. بالفشل الصريح تُعلن المنصة النشر فاشلاً
و**تُبقي النسخة السابقة السليمة تخدم**.

فإن رأيت نشراً فاشلاً برسالة `✗ تعذّر ترحيل قاعدة البيانات`، فالسبب في القاعدة أو
متغيّرات `DB_*` لا في الكود — راجع سجلّ الترحيل في نفس الصفحة.

### كيف تتأكّد أن آخر هجرة وصلت الإنتاج

```bash
php artisan migrate:status      # من Shell الخدمة (خطط مدفوعة)
```

بلا Shell: من لوحة Render → الخدمة → **Events**، تأكّد أن آخر نشر **ناجح** عند
آخر دمج على `main` أو بعده. أو استعلم القاعدة مباشرةً:

```sql
SELECT migration FROM migrations ORDER BY id DESC LIMIT 5;
```

## متغيّرات البيئة (مرجع)

| المتغيّر | المصدر | ملاحظة |
|---|---|---|
| `APP_KEY` | يدوي | `php artisan key:generate --show` |
| `FRONTEND_URL` | يدوي | نطاق الواجهة (CORS) |
| `DB_*` | من قاعدة Render | مربوطة تلقائياً في `render.yaml` |
| `APP_ENV`/`APP_DEBUG` | افتراضي | production / false |
| `DOCUMENT_STORAGE_DRIVER` | `render.yaml` | `s3` في الإنتاج لتخزين صور المنتجات والمرفقات |
| `DOCUMENT_STORAGE_KEY` / `DOCUMENT_STORAGE_SECRET` | يدوي | مفاتيح تخزين الكائنات، تبقى خاصة |
| `DOCUMENT_STORAGE_BUCKET` / `DOCUMENT_STORAGE_ENDPOINT` | يدوي | الحاوية ونقطة النهاية الخاصة بـ S3/R2 |

## منصّات بديلة

الصورة قياسية (Dockerfile واحد)، فتعمل كما هي على **Railway** أو **Fly.io** أو أي
مضيف حاويات: مرّر نفس متغيّرات البيئة، واجعل أمر التشغيل هو الافتراضي
(`entrypoint.sh`). الفرق الوحيد هو طريقة توفير قاعدة PostgreSQL وربط `DB_*`.

## ترقية لاحقة (اختياري)

`php artisan serve` مناسب للإطلاق الأولي (خيط واحد). للأحمال الأعلى، بدّله لاحقاً
بـ **Laravel Octane (FrankenPHP)** أو nginx + php-fpm دون تغيير بقية الحزمة.
