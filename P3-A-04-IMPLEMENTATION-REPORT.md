# P3-A-04 — Global Background Renderer & Preview Parity

## الحالة التنفيذية

استُكمل رسم الخلفية العامة في معاينة Store Experience Builder وفي المتجر المنشور، مع الحفاظ على resolver للألوان والتدرجات الذي أُنجز سابقًا. تُعرض خلفية الوسائط كـstill فقط، ويُختار مرجع desktop/mobile وفق viewport أو media query، وتُطبّق نقطة التركيز والـoverlay دون قراءة URL من العقد أو إنشاء مسار وسائط جديد.

تم تحديث PR #1570 الموجود نفسه، وما يزال Draft. **لم يتم Merge أو Deploy**. نشر الخلفيات المصورة ما زال ممنوعًا عمدًا حتى P3-A-06 عبر بوابة `global_media_background_not_ready` القائمة.

## التنفيذ

- أُبقي `resolveStorefrontBackgroundStyle` في Web وStorefront لحالات solid/gradient والـlegacy fallback، مع اتجاهات gradient المنطقية المتوافقة مع RTL/LTR.
- أضيف `GlobalBackgroundBackdrop` للمعاينة؛ يستهلك hook الحالي `useMediaRefPreview` وروابط المعاينة الموقعة، ويعرض صورة ثابتة فقط. لا يستخدم رابط الحركة ولا يضيف endpoint أو تخزين URL.
- أضيف `GlobalBackgroundLayer` للـStorefront المنشور؛ يستهلك فقط `presentation_media` المحلولة الموجودة في loader، ويستخدم درجات still الموجودة بصيغ WebP/JPEG، مع اختيار صورة mobile عبر `<picture>`، وfocal points منفصلين، وoverlay. يغيب الرسم عند غياب media المحلولة (fail-closed).
- تُحصر الطبقة المنشورة بصفحات مجموعة `(storefront)`، ويستبعد route matcher مسارات checkout/account/wholesale. لا يتغير عقد `SectionBackground` ولا PHP/DB/API.
- عُزلت الطبقة بصريًا عن عناصر الصفحة؛ header/footer والبطاقات ومناطق الأقسام تبقى أسطحًا مستقلة. بقيت قواعد رسم الأقسام كما هي، وأُضيفت قاعدة object-position الخاصة بالخلفية العامة خارج كتلة CSS المطابقة لعقد الأقسام.

## الملفات المعدلة

- `web/src/modules/store-experience-builder/presentation/storefront-background-render.ts` — resolver الحالي للألوان والتدرجات.
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` — دمج طبقة المعاينة في canvas.
- `web/src/modules/store-experience-builder/GlobalBackgroundBackdrop.tsx` — طبقة المعاينة الثابتة وoverlay/focal point.
- `web/src/modules/store-experience-builder/__tests__/GlobalBackgroundBackdrop.test.tsx` — Regression للوسائط ومصادرها الآمنة والفشل الآمن.
- `web/src/modules/store-experience-builder/__tests__/storefront-background-render.test.ts` — تغطية resolver.
- `web/src/app/dev/trust-visual/page.tsx` — سيناريو QA development-only لخلفية media.
- `web/e2e/store-brand-qa.spec.ts` — اختبار مرئي للـdesktop/mobile وحفظ screenshots.
- `storefront/src/lib/presentation/storefront-background-render.ts` — نظير resolver المنشور.
- `storefront/src/components/layout/GlobalBackgroundLayer.tsx` — renderer المنشور من media المحلولة فقط واستثناء المسارات.
- `storefront/src/components/layout/__tests__/GlobalBackgroundLayer.test.tsx` — Regression للـstill sources، mobile، focal/overlay، fail-closed واستثناء الحساب.
- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx` — ربط الخلفية بالـwrapper المنشور.
- `storefront/src/app/[country]/[locale]/(storefront)/layout.test.tsx` — تماثل home/product/category/content واستقلال عناصر chrome.
- `storefront/src/app/globals.css` — قواعد focal points العامة خارج CSS contract الأقسام.
- `storefront/src/lib/presentation/storefront-background-render.ts` وملف اختباراته — renderer واختبارات resolver المنشور.

## التحقق والاختبارات

| التحقق | النتيجة |
|---|---|
| Web Vitest كامل (`./node_modules/.bin/vitest run`) | ناجح: **654 ملف اختبار، 7,724 اختبارًا** |
| Storefront Vitest كامل (`pnpm test`) | ناجح: **214 ملفًا ناجحًا، 15 متجاوزًا؛ 2,939 اختبارًا ناجحًا و15 متجاوزًا** |
| Storefront Biome (`pnpm check`) | ناجح: فُحصت 693 ملفًا، دون أخطاء؛ بقيت تحذيرات/معلومات سابقة غير حاجبة |
| Storefront TypeScript (`pnpm exec tsc --noEmit --pretty false`) | ناجح، exit 0 |
| Web build (`npm run build`) | ناجح على التغييرات النهائية، exit 0 |
| Storefront build (`pnpm build`) | ناجح، اكتملت صفحات البناء الثابتة والديناميكية، exit 0 |
| Web drift ratchet | ناجح: 3 اختبارات؛ عولجت مخالفة hex خام في QA fixture باستخدام دور palette بدلًا منها |
| CSS SectionDesign parity regression | ناجح: 62 اختبارًا؛ أُبقيت قواعد/عقد الأقسام دون تغيير |
| Visual QA للخلفية العامة | ناجح: اختبار Playwright واحد يمر على desktop وmobile داخل test، ويتحقق من المصدر المختار، focal point، overlay، lazy/still-only وظهور header/footer |
| `git diff --check` | ناجح |

ملفات الأدلة المرئية المحفوظة من الاختبار:

- [لقطة المعاينة desktop](web/test-results/store-brand-qa/global-background-desktop.png)
- [لقطة المعاينة mobile](web/test-results/store-brand-qa/global-background-mobile.png)

تم اعتراض واستبدال استجابات الاختبار على مسارات قراءة الوسائط وحالة الاشتقاق القائمة فقط؛ لا يعني ذلك إنشاء API أو تسليم وسائط في المنتج.

## الصفحات والأسطح والنطاق

- اختبار layout المشترك يمرر presentation والخلفية نفسها لسيناريوهات Home وProduct وCategory وContent؛ جميعها تستهلك layout المتجر المشترك.
- route matcher يسمح بصفحات المحتوى العامة ويستبعد checkout/account/wholesale. كما بقيت تلك التطبيقات خارج layout المعدل.
- لا يغيّر renderer خلفية header/footer أو البطاقات أو عناصر section؛ واختبارات section resolver وCSS parity قائمة وناجحة.
- لا تعديل على قاعدة البيانات أو API أو عقد `SectionBackground` أو آلية تسليم الوسائط.

## CI عن بُعد

اكتملت جميع فحوص GitHub على head التنفيذي `851e01469e5c3c4d9226d844b56766704e40eb94`: **9 ناجحة، صفر فاشلة أو pending**. شملت CI Gate، فحوص Storefront، Web builds، Merchant Preview Visual QA، Published Footer Visual QA، واختبارات PHP على SQLite وPostgreSQL. أُضيف بعد ذلك commit توثيقي فقط لتسجيل هذه النتائج؛ head الحالي موضح أدناه. لا تُنسب حالات الفشل السابقة على head القديم إلى النسخة التنفيذية التي اجتازت CI.

## المخاطر والمتبقي

- اختبار Playwright المرئي يقيّم Canvas development fixture بصور SVG اختبارية، لا تصويرًا لوسائط متجر إنتاجي حقيقية. التوافق المنشور مدعوم باختبارات layout/component وbuild، وليس بلقطة live لمتجر؛ يلزم تقييم بصري إنتاجي لاحق إذا توفر preview منشور مع بيانات وسائط مصرح بها.
- منع نشر الخلفيات المصورة باقٍ كما هو حتى P3-A-06؛ لا يُفترض أن اجتياز renderer يجيز نشرها.
- dev server أظهر أثناء Visual QA تحذيرًا متعلقًا بمفاتيح i18n ذات نقاط وcross-origin للموارد؛ رغم ذلك مر الاختبار المرئي. لم تُعدّل ملفات الترجمة أو إعداد origins لأنها خارج نطاق P3-A-04.
- لم يُجرِ هذا العمل تغييرات في محرر الإعدادات P3-A-05.

## PR والـSHA

- Repository: `safwan5001-source/Nebrax`
- PR: [#1570 — Global Background Renderer & Preview Parity](https://github.com/safwan5001-source/Nebrax/pull/1570) — Draft
- Branch: `p3-a-04-global-background-renderer`
- Base (`main`): `8c74051b5e6d0c917babf97902954c1dc9b16ee2`
- Implementation commit: `22ed521d91a86f198e7353bc29844955e603b48c`
- Head (تنفيذ الكود الذي اجتاز CI): `851e01469e5c3c4d9226d844b56766704e40eb94`
- أضيفت بعده commits توثيق فقط؛ لا تغيّر تنفيذ الكود أو نتائج التحقق المحلية.

**القرار:** جاهز لمراجعة PR ونتائج CI الجديدة؛ لا Merge ولا Deploy قبل موافقتك.
