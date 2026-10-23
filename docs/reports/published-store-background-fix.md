# AWJ — إصلاح عدم ظهور خلفية المتجر بعد النشر

## النطاق

- **PR المرجعي:** #1565
- **الإصدار المنشور:** `aa6a389fb929179652e2a2652192c30913c52de`
- **Base SHA للإصلاح:** `aa6a389fb929179652e2a2652192c30913c52de`
- **Commit الإصلاح البرمجي:** `108a8162279da04439924487b51793066371019b`
- **الفرع:** `fix/published-store-background`

لم تُجرَ أي تغييرات على قاعدة البيانات أو الإنتاج، ولم يُدمج أو يُنشر هذا الإصلاح.

## إعادة الإنتاج والدليل

أُعيد إنتاج العطل بصورة حتمية على مسار العرض المنشور باستخدام وثيقة اختبار معزولة بلون `#f4b6c2`، دون لمس إعدادات متجر عميل:

1. `readPublishedPresentation` يطبع الوثيقة المنشورة ويحافظ على `backgroundColor` الصالح.
2. `presentationCssVars(..., backgroundColor)` يعيد `--store-background: #f4b6c2`؛ وهذا هو المسار نفسه الذي تستخدمه معاينة صانع المتاجر.
3. قبل الإصلاح، `publishedThemeStyle` كان يضع المتغيرات المخصصة على غلاف داخلي فقط، دون خاصية `background-color` فعلية على الغلاف.
4. `globals.css` يعرّف `--store-background` و`--background` على `:root`، ويستخدمهما خارج الغلاف. المتغير المعرّف على الغلاف الابن لا يمكنه تغيير القيمة المحسوبة مسبقاً على `body` أو `:root`، لأن خصائص CSS المخصصة تورّث إلى الأسفل فقط.
5. النتيجة: بقيت خلفية الصفحة العامة على `#f8f9fa` رغم وجود اللون الصحيح في النسخة المنشورة ورسالة نجاح النشر.

تم فحص مسار `fetchStorefrontConfig` أيضاً: الطلب يستخدم `cache: "no-store"`، و`fetchPublishedPresentation` يقرأ `config.presentation`، ثم يستدعي layout الدالة `publishedThemeStyle(presentation)`. لا يوجد في هذا المسار fallback إلى المسودة ولا تغيير لمعرّف المتجر أو المستأجر.

## السبب الجذري

الخلل في نطاق تطبيق CSS، وليس في الحفظ أو النشر أو Tenant Isolation:

- اللون الصحيح كان يصل إلى `--store-background`.
- المتغير كان موضوعاً على عنصر descendant.
- خلفية المستند الافتراضية كانت تُحسب على عنصر أعلى (`:root`/`body`).
- لم يكن الغلاف المنشور نفسه يرسم الخلفية.

## الإصلاح الأقل نطاقاً

أضيفت إلى ناتج `publishedThemeStyle` الخاصية التالية:

```ts
backgroundColor: "var(--store-background)"
```

وبذلك يرسم غلاف الصفحة العامة اللون نفسه الذي يعلنه المتغير، دون تغيير API أو قاعدة البيانات أو قواعد الأقسام. بقيت خلفيات الأقسام المخصصة مستقلة، إذ لا تزال قواعدها وعناصرها تطبق خلفياتها الخاصة فوق الغلاف.

## الاختبارات

نجحت الاختبارات المحلية التالية:

- Storefront presentation runtime/config/tokens/contrast: **81 اختباراً ناجحاً**.
- Web presentation contract: **20 اختباراً ناجحاً**.
- Web preview/background tests: **26 اختباراً ناجحاً**.
- Storefront Biome على الملفات المعدلة: **ناجح**.
- Storefront TypeScript `tsc --noEmit`: **ناجح**.
- `git diff --check`: **ناجح**.

أضيفت تغطية تمنع regression وتثبت:

- وجود `--store-background: #f4b6c2` في عقد المعاينة.
- وجود المتغير نفسه في `publishedThemeStyle`.
- رسم الغلاف المنشور عبر `backgroundColor: var(--store-background)`.

لم تتوفر بيئة PHP أو `vendor/bin/phpunit` في Sandbox، لذلك لم يمكن تشغيل اختبارات PHP محلياً. يجب الاعتماد على PHP CI في PR للتحقق من اختبارات API والتطبيع والعزل بالمصنعين/SQLite وPostgreSQL.

## الملفات المعدلة

- `storefront/src/lib/presentation/public.ts`
- `storefront/src/lib/presentation/__tests__/public.test.ts`
- `web/src/modules/store-experience-builder/__tests__/presentation.test.ts`
- هذا التقرير: `docs/reports/published-store-background-fix.md`

## المخاطر والنقاط غير المكتملة

لا توجد تغييرات في API أو قاعدة البيانات أو نموذج المستأجر. الخطر المتبقي منخفض: إذا كان جزء من الصفحة يرسم خلفية صريحة، فسيظل ذلك الجزء على خلفيته المقصودة؛ وهذا يحافظ على استقلالية الهيدر والفوتر والبطاقات وخلفيات الأقسام.

التحقق الحي على متجر اختبار متصل ببيئة تشغيل لم يُنفذ من Sandbox لعدم توفر اعتماد/بيئة PHP معزولة؛ تمت تغطية الحالة عبر مسار runtime واختبارات العقد، وسيثبت CI سلامة اختبارات الخادم.

## حالة الدمج

- لا Merge.
- لا Deploy.
- ينتظر إنشاء PR مستقل وتشغيل GitHub Actions قبل تقرير الجاهزية النهائية للدمج.
