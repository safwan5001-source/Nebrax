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
4. **Apply** — يبني Render الصورة، يُرحّل القاعدة تلقائياً عند الإقلاع، ويعطيك
   عنواناً مثل `https://nibras-api.onrender.com`.
5. تحقّق من الصحّة:
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

## متغيّرات البيئة (مرجع)

| المتغيّر | المصدر | ملاحظة |
|---|---|---|
| `APP_KEY` | يدوي | `php artisan key:generate --show` |
| `FRONTEND_URL` | يدوي | نطاق الواجهة (CORS) |
| `DB_*` | من قاعدة Render | مربوطة تلقائياً في `render.yaml` |
| `APP_ENV`/`APP_DEBUG` | افتراضي | production / false |

## منصّات بديلة

الصورة قياسية (Dockerfile واحد)، فتعمل كما هي على **Railway** أو **Fly.io** أو أي
مضيف حاويات: مرّر نفس متغيّرات البيئة، واجعل أمر التشغيل هو الافتراضي
(`entrypoint.sh`). الفرق الوحيد هو طريقة توفير قاعدة PostgreSQL وربط `DB_*`.

## ترقية لاحقة (اختياري)

`php artisan serve` مناسب للإطلاق الأولي (خيط واحد). للأحمال الأعلى، بدّله لاحقاً
بـ **Laravel Octane (FrankenPHP)** أو nginx + php-fpm دون تغيير بقية الحزمة.
