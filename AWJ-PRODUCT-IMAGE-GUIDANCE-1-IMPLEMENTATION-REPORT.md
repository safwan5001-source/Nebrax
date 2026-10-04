# AWJ-PRODUCT-IMAGE-GUIDANCE-1 — تقرير التنفيذ

## الحالة

تم تنفيذ إرشاد UX غير حاجب قرب مناطق رفع صور المنتج، وفتح PR مستقل للمراجعة. لم يتم الدمج أو النشر.

| الحقل | القيمة |
|---|---|
| Base SHA | `cb6478281577b9a9abdd6ed31c339afb23db9940` |
| Head SHA |  |
| Branch | `awj-product-image-guidance-1` |
| PR | [#1227](https://github.com/safwan5001-source/Nebrax/pull/1227) |
| الحالة | Open — بانتظار مراجعة ونتائج CI |

## ما تم

- إعادة استخدام مكوّن مشترك باسم `ProductMediaGuidance` بدل تكرار النص داخل واجهات رفع الوسائط.
- عرض الإرشاد داخل `ProductMediaSection` المستخدم في مساحة إنشاء وتعديل المنتج.
- عرض الإرشاد كذلك داخل `ProductDialog` legacy المستخدم من نماذج الفواتير والمشتريات.
- استخدام `next-intl` بمفتاح `products.product_image_guidance` في العربية والإنجليزية.
- إضافة اختبار عربي، واختبار إنجليزي، واختبار يثبت بقاء صورة غير مربعة قابلة للاختيار.

## موضع الإرشاد في UX

الإرشاد موضوع مباشرة تحت تعليمات أنواع الملفات والحجم الأقصى الحالية داخل رأس معرض صور المنتج، وبنمط `text-xs text-muted`. لا توجد نافذة منبثقة أو Modal أو Badge بارز، ولا يمنع الإرشاد عملية الرفع.

## النصوص النهائية

**العربية:**

> لأفضل نتيجة، استخدم صورة واضحة وعالية الجودة، ويفضل أن تكون مربعة (1:1). حافظ على المنتج في منتصف الصورة لأن بعض طرق العرض قد تقوم بقص الأطراف.
>
> 1200 × 1200 بكسل خيار ممتاز للصور المربعة، لكنه ليس شرطًا.

**English:**

> For best results, use a clear, high-quality image. A square image (1:1) is preferred. Keep the product centered because some layouts may crop the image edges.
>
> 1200 × 1200 px is a good choice for square images, but it is not required.

## ضمانات السلوك

- `1:1` و`1200 × 1200` توصية فقط، وليسا Validation rule أو Requirement.
- لم تتم إضافة aspect-ratio validation أو فرض width/height.
- الصور المربعة والرأسية والأفقية تبقى مقبولة.
- لم يتغير upload/storage behavior أو API أو Database schema أو URLs أو الصلاحيات أو عزل المستأجرين.
- لم تتم إضافة crop أو resize أو compression أو تغيير جودة.
- لم تتغير نسب صور Storefront أو POS، ولم تتغير الصور الحالية.

## الملفات المعدلة

- `web/src/components/products/product-media-guidance.tsx`
- `web/src/components/products/product-media-section.tsx`
- `web/src/components/products/product-dialog.tsx`
- `web/src/components/products/product-workspace.test.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`
- `AWJ-PRODUCT-IMAGE-GUIDANCE-1-IMPLEMENTATION-REPORT.md`

## الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| `npm test -- --run src/components/products/product-workspace.test.tsx` | **نجح: 24/24**، بما فيها الترجمتان وقبول صورة غير مربعة |
| `npm run build` | **نجح**: Next.js compiled, lint/type validity check, page generation 182/182 |
| `python3 -m json.tool web/src/messages/ar.json` | **نجح** |
| `python3 -m json.tool web/src/messages/en.json` | **نجح** |
| `git diff --check` | **نجح** |
| `npx tsc --noEmit` | أظهر 17 خطأ موجودًا مسبقًا في ملفات أخرى؛ لا يوجد فشل في build الإنتاجي، والاختبار المستهدف ناجح |
| `npm run lint` | لم يكتمل لأن `next lint` deprecated وفتح prompt تفاعليًا لترحيل إعداد ESLint؛ أُوقف دون إنشاء إعدادات أو ملفات خارج النطاق |

## Build / CI

الـbuild المحلي للإنتاج ناجح. عند إعداد التقرير كانت فحوصات GitHub Actions الستة للـPR ما تزال **Pending** (أربع مجموعات PHP ومجموعتا Web CI). لا يوجد Merge أو Deploy.

## المخاطر والملاحظات

- lint المنفصل غير قابل للتشغيل non-interactively عبر script الحالي بسبب prompt ترحيل `next lint`؛ build نفسه نفّذ linting والتحقق من الأنواع بنجاح.
- `tsc --noEmit` العام يعكس أخطاء baseline غير مرتبطة بهذه المهمة.
- يوجد تحذير اعتماديات أثناء `npm ci` (20 vulnerability في شجرة الاعتماديات الحالية)، ولم يُجرَ `npm audit fix` لأنه خارج النطاق.

## ما تبقى

- انتظار مراجعة PR ونتائج CI.
- لا توجد Migration أو إعادة معالجة صور أو تغييرات API مطلوبة.

## الخطوة التالية المقترحة

مراجعة PR #1227 واعتماد التغيير بعد نجاح CI. لا يتم الدمج أو النشر إلا بعد موافقة صريحة منفصلة.
