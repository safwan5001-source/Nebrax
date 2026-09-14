# نشر واجهة نبراس على Vercel

> الواجهة (Next.js) تعيش في المجلد الفرعي **`web/`** من المستودع.
> الـ backend (Laravel/PHP) **لا يُنشر على Vercel** — يحتاج استضافة PHP منفصلة
> (Railway / Render / خادم). Vercel للواجهة فقط.

## سبب خطأ `404: NOT_FOUND`

إذا ربطت المستودع بـ Vercel دون ضبط مجلد الجذر، فإن Vercel يبني من **جذر المستودع**
(حيث توجد نواة Laravel بلا `package.json`) فلا يجد تطبيقاً يقدّمه → 404.
تطبيق Next.js موجود في `web/`، لا في الجذر.

## الخطوات (مرّة واحدة)

### 1) مجلد الجذر — **إلزامي**
في مشروع Vercel: **Settings → Build & Deployment → Root Directory** اضبطه إلى:

```
web
```

> هذا الإعداد **لا يمكن ضبطه عبر `vercel.json`** — هو إعداد لوحة تحكم Vercel حصراً،
> وهو الحل الأساسي لخطأ 404. بعد ضبطه يكتشف Vercel تلقائياً أنه مشروع Next.js.

### 2) متغيّر البيئة
في **Settings → Environment Variables** أضف (لبيئة Production على الأقل):

| الاسم | القيمة |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<عنوان-الـ-backend>/api` |
| `NEXT_PUBLIC_TENANT_BASE_DOMAIN` | `awj.app` (لاحقة التسجيل `{slug}.awj.app`؛ للمحلي `localhost`) |

(القيمة الافتراضية في الكود `http://localhost:8000/api` للتطوير فقط — انظر `src/lib/api.ts`.)

### 3) أعد النشر (Redeploy)
بعد ضبط مجلد الجذر والمتغيّر، شغّل **Redeploy** على آخر نشر.

## ما الذي يثبّته المستودع تلقائياً

عند ضبط مجلد الجذر = `web`، يقرأ Vercel ملف **`web/vercel.json`** الذي يثبّت:
- `framework: nextjs`
- `buildCommand: npm run build`
- `installCommand: npm install`
- النشر التلقائي عند الدفع إلى `main`.

فلا يتبقّى عليك يدوياً سوى **مجلد الجذر** و**متغيّر `NEXT_PUBLIC_API_URL`** (خطوتان لوحة تحكم).

> نطاقات المستأجر `{slug}.awj.app` تحتاج إعداد Vercel منفصلاً **لم يُنفَّذ في هذا المستودع**: أضف
> `awj.app` و`*.awj.app` كدومينات للمشروع `web/` بعد ضبط DNS/TLS. التفاصيل في
> `docs/plans/tenancy/AWJ_TENANT_SUBDOMAIN_V1_IMPLEMENTATION_REPORT.md`. لا توسّع الكوكي إلى `.awj.app`.

> **بيئة Railway الحالية (`*.awjdev.xyz`) — مُصحَّح بدليل حيّ:** صياغة سابقة هنا
> افترضت أن الويلدكارد يصل فقط إلى backend الـ API وأن Vercel لا بد أن يستقبله
> منفصلاً. **دليل حيّ يبطل هذا الافتراض:** `https://alrshd.awjdev.xyz` يعرض
> فعلياً صفحة AWJ العامة (الهبوط) عبر HTTPS بنجاح — فالطلب يصل إلى خدمة قادرة
> على تقديم HTML كامل، أياً كانت. **لا يثبت المستودع أي هذه الخدمة فعلياً**
> (لا Dockerfile لهذا المشروع، ولا دليل نشر حالي غير `web/vercel.json` الموثّق
> أعلاه) — فلا تفترض Vercel تحديداً ولا تطلب أي تغيير نطاق بناءً على ذلك.
>
> **ما لم يثبته ظهور الصفحة:** الصفحة المعروضة هي صفحة الهبوط العامة نفسها بلا
> فرق حسب المضيف — هذا متوقّع لأن `web/` لا يحمل `middleware.ts` ولا أي منطق
> توجيه يقرأ hostname الطلب، و`NEXT_PUBLIC_TENANT_BASE_DOMAIN` يُستهلَك هنا في
> مكان واحد فقط (لاحقة `صفحة الدخول` في شاشة التسجيل)، بلا أثر على التوجيه. فضبط
> `NEXT_PUBLIC_TENANT_BASE_DOMAIN=awjdev.xyz` **لن يغيّر** ما تعرضه `/` على هذا
> المضيف. حسم المستأجر الفعلي يحدث على مستوى الـ backend فقط (Host ثم Origin،
> `TenantHostnameResolver`) عند نداء API حقيقي (مثل تسجيل الدخول)، لا عبر أي
> صفحة تُعرَض — انظر التفصيل الكامل في
> `docs/plans/tenancy/AWJ_TENANT_SUBDOMAIN_RAILWAY_AWJDEV_REPORT.md`.

## التحقق محلياً قبل النشر

```bash
cd web
npm install
npm run build      # يجب أن ينجح (يفرضه Web CI أيضاً)
```
