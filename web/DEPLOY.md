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

## التحقق محلياً قبل النشر

```bash
cd web
npm install
npm run build      # يجب أن ينجح (يفرضه Web CI أيضاً)
```
