# AWJ-HERO-DISPLAY — خيارات عرض Hero Banner — تقرير التنفيذ

| | |
|---|---|
| **Branch** | `claude/awj-hero-banner-display-options-sv1lew` |
| **Base SHA** | `e59d29bac7d67fd55016fa5a1b0e859a748e2c09` (`main`) |
| **Head SHA** | يُملأ بعد الالتزام النهائي (انظر وصف الـPR) |
| **PR** | يُنشأ على هذا الفرع (غير مدموج، لا نشر) |
| **النطاق** | مفاتيح اختيارية مضافة على `homepage.sections[hero].content` فقط. لا migration، لا API جديد، لا مساس بالمحاسبة/المخزون/ZATCA، `PRESENTATION_CONFIG_VERSION` لم يتغيّر. |

## 1. ما تم فحصه قبل التنفيذ

* **أي قسم هو «Hero Banner»؟** في الكود قسمان: `hero` («البطل» — عنوان ووصف وزران فوق خلفية قسم، والصورة هي **خلفية القسم** `design.background.kind="media"`) و`banner` («شريط ترويجي» بصورة مضمَّنة). الطلب يتحدث عن «صورة البطل» وعن عنوان/وصف/زر فوقها ⇒ **قسم `hero`**. البانر الترويجي وبقية الأقسام لم تُلمس.
* **المسار الحالي:** `HeroContent` (توأمان TS + PHP السلطة) → `StorefrontPresentationNormalizer::normalizeHeroContent` → مسودة/نشر عبر `StorefrontPresentationService` (لا تغيير) → الصفحة المنشورة `HeroSection` ← `published-nodes` ← `page.tsx`؛ والمعاينة `StorefrontPreviewCanvas`؛ والمحرر `ControlPanels.HeroFields`. أُعيد استخدام كل ذلك دون نظام موازٍ.
* **PR #1565 (`aa6a389`، خلفية المتجر العامة):** النمط المعتمد للتوافق الرجعي: مفتاح اختياري يُكتب فقط حين يوجد في المدخل (`hasBackgroundColor`) فلا تكتسب وثيقة قديمة أي مفتاح، مع اختبار «legacy documents stay neutral». طُبِّق النمط نفسه هنا (انظر 2).
* **عقد قائم وجب احترامه:** `ShelfTitle.showTitle` يُخزَّن **فقط** بقيمة `false`؛ والبطل بلا محتوى يقرأ النص القديم `homepage.heroHeadline/heroSubheadline` (V0 §8.1.4)؛ وصفحة الرئيسية فيها `<h1>` واحد فقط؛ وصورة الخلفية لا تُرسم إلا إن **أُثبت** وضوح النص فوقها (بوابة التباين).

## 2. ما تم تنفيذه

### العقد (PHP سلطة + توأما TS، نفس مصفوفة الحالات المشتركة)
مفاتيح اختيارية جديدة في `HeroContent` وبالترتيب القانوني `headline, subheadline, ctas, showTitle, showSubheadline, showCtas, imageHref`:

| المفتاح | المعنى | التخزين |
|---|---|---|
| `showTitle` | إظهار العنوان | يُخزَّن **فقط** كـ`false`؛ أي قيمة أخرى (`true`/نص/رقم) = ظاهر ولا تُخزَّن |
| `showSubheadline` | إظهار الوصف | كما سبق |
| `showCtas` | إظهار الأزرار (ويشمل «تسوّق الآن» الافتراضي) | كما سبق |
| `imageHref` | جعل صورة البطل قابلة للنقر | رابط بقواعد `sanitizeContentHref` نفسها للأزرار (مسار `/…` أو `https://`)؛ المرفوض (`javascript:`، `//host`…) يُسقَط |

* **التوافق الرجعي:** الغياب = ظاهر كما كان؛ لا مفتاح يُضاف لوثيقة قديمة ولا بحافز التطبيع (يحرسه اختبار byte-for-byte). بطل بلا محتوى يبقى يقرأ النص القديم؛ وحين يختار التاجر إخفاء شيء يُزرع المحتوى الصريح من النص القديم (نفس سلوك أول تعديل اليوم) فلا يضيع العنوان.
* **صورة فقط** = الثلاثة `false`. أي اختيار صريح يُعدّ «محتوى صريحاً» (لا يعود البطل لقراءة النص القديم).

### العرض المنشور (`HeroSection`)
* الجزء المخفي **لا يُرسم عنصره**؛ ولا تُرسم حاوية المحتوى إن لم يبقَ فيها شيء (لا حاويات فارغة). إخفاء الأزرار يخفي أيضاً «تسوّق الآن».
* العنوان المخفي يبقى **عنوان القسم لقارئات الشاشة** (`sr-only`، يُوضع قبل طبقة الصورة كي لا تعيد قواعد `~` تنسيقه) فيبقى `<h1>` واحد في الصفحة و`aria-labelledby` سليماً.
* **صورة قابلة للنقر:** رابط `absolute inset-0` تحت طبقة الصورة (التي لا تستقبل مؤشراً) وتحت النص؛ صندوق النص `pointer-events-none` وروابطه `pointer-events-auto` فتبقى الأزرار تعمل. اسمه المُتاح = عنوان البطل. **لا يُرسم إلا حين تُرسم صورة فعلاً** (بطل على التدرج الافتراضي ليس له صورة يُنقر عليها). `relative` تُضاف فقط عند وجود الرابط ⇒ مخرجات القديم بلا تغيير.
* الأبعاد وقص الصورة (`object-fit: cover`) والارتفاعات الدنيا واستجابة الجوال/سطح المكتب **بلا تعديل**.

### التباين / الطبقة الداكنة
* **لا طبقة داكنة افتراضية أصلاً:** الطبقة (`overlay`) لا توجد إلا إن أنشأها التاجر في تصميم الخلفية؛ لم أضف أي تعتيم تلقائي. بقاؤها أو حذفها قرار التاجر، وبوابة النشر وإثبات الهيدر الشفاف يقرآنها كما هي (فلا يُنقض إثباتٌ قائم).
* **بوابة التباين الواعية بالنص** (`isTextlessHero` في PHP / `isTextlessSection` في TS): بطل أخفى الثلاثة معاً لا نص فوق صورته ليُثبَت وضوحه، فيُكتفى بـ**دليل لمعان الصورة نفسه** (الصورة غير المعالجة ما زالت `contrast_unprovable`). بدون هذا كانت الصورة العريضة اللمعان تُهمَل بصمت (تعود إلى التدرج) لأنه لا يمكن إثبات نص فوقها. أي نص ظاهر (ولو جزء واحد) يُبقي الإثبات الكامل كما كان.
* أزرار مخفية لا تُحكم ألوانها (`CtaColourContrast`) ولا تُظهر واجهة المحرر تحذير ألوانها.
* مُمرَّر عبر `resolveSectionDesign(..., textless)` و`sectionContrastIssues(..., textless)` (توأمان) إلى كل المواقع التي تعتمد قرار `mbg` (إطار القسم، المعاينة، `published-nodes`، رأس الشفاف `public-overlay`).

### المحرر والمعاينة
* في `HeroFields`: ثلاثة مفاتيح «إظهار العنوان/الوصف/الأزرار» (تُخزَّن عند الإيقاف فقط وتُحذف عند التشغيل)، وحقل «رابط الصورة (اختياري)» بنمط الالتزام عند الـblur نفسه لروابط الأزرار، وتلميح عند «صورة فقط». العربية والإنجليزية.
* `StorefrontPreviewCanvas` يطابق المنشور: نفس إخفاء العنصر، العنوان `sr-only`، لا صندوق فارغ، ووسم `data-preview-hero-image-link` عند وجود صورة مرسومة. التحديث **فوري** لأن الحالة هي وثيقة العرض نفسها؛ والحفظ/النشر يمرّان بالمطبّع الجديد نفسه فيبقى بعد إعادة التحميل (مغطى باختبار التطبيع على الوثيقة المخزَّنة).

## 3. الملفات المتغيرة

**Backend (PHP):** `app/Support/Commerce/StorefrontPresentationNormalizer.php` · `SectionDesignContrast.php` · `CtaColourContrast.php`
**Storefront:** `src/components/home/HeroSection.tsx` · `published-nodes.tsx` · `SectionDesignFrame.tsx` · `src/lib/presentation/section-content.ts` · `section-design-resolve.ts` · `public-overlay.ts` · `src/app/[country]/[locale]/(storefront)/page.tsx`
**Web (المحرر):** `store-experience-builder/presentation/section-content.ts` · `presentation/section-design-resolve.ts` · `ControlPanels.tsx` · `StorefrontPreviewCanvas.tsx` · `SectionDesignFrame.tsx` · `design/DesignInspector.tsx` · `messages.ts`
**اختبارات/Fixtures:** `tests/Fixtures/presentation/hero-content.json` (+6 حالات) · `section-design-contrast.json` (+3) · `tests/Feature/SectionDesignContrastTest.php` · `CtaColourContrastTest.php` · `storefront/.../HeroSection.test.tsx` · `section-design-contrast.test.ts` · `section-design-resolve.test.tsx` · `web/.../ControlPanels.hero.test.tsx` · `StorefrontPreviewCanvas.hero.test.tsx` · `section-design-contrast.test.ts` · `section-design-resolve.test.tsx`
**أدلة:** `docs/plans/store/awj-hero-display/*.png` (3 لقطات) + هذا التقرير.

## 4. الاختبارات ونتائجها

| الطبقة | ما يغطيه | النتيجة |
|---|---|---|
| PHP (Laravel، sqlite) | حالات `hero-content.json` المشتركة بترتيب المفاتيح؛ `SectionDesignContrast`/`CtaColourContrast` مع `textless`؛ بوابة النشر لبطل صورة-فقط؛ الإثبات الكامل عند ظهور أي جزء؛ دليل الصورة ما زال مطلوباً | `SectionDesignContrastTest` + `CtaColourContrastTest` + `StorefrontPresentationHeroContentTest`: **83 passed (323 assertions)** |
| Storefront (vitest) | الحالات الخمس المطلوبة (صورة فقط / +عنوان / +عنوان+وصف / +عنوان+زر / الكل)؛ لا حاوية فارغة؛ `<h1>` sr-only؛ إخفاء «تسوّق الآن»؛ تطابق byte-for-byte للقديم؛ رابط الصورة (مسار/https/غير آمن/بلا صورة/بلا رابط)؛ توأم المحلّل والـfixtures | `src/lib/presentation` + `src/components/home`: **1848 passed**، 0 failed |
| Web (vitest) | المفاتيح الثلاثة وحقل الرابط (الالتزام عند blur، الحذف عند التفريغ، الحفاظ على الأعلام عند كل تعديل)؛ زرع النص القديم عند أول اختيار؛ المعاينة | `store-experience-builder` + `commerce-workspace`: **209 ملفاً / 3567 اختباراً passed**، 0 failed |
| متصفح Chromium حقيقي (Tailwind الحقيقي، `globals.css`) | 7 أنماط × LTR/RTL × 390/1280: لا overflow أفقي، `<h1>` واحد، صورة-فقط: صورة مرسومة بلا طبقة داكنة ولا صندوق فارغ ولا زر/وصف، الارتفاع محفوظ، نقرة المنتصف تصل رابط الصورة وأزرار القسم تبقى قابلة للنقر فوقه | **28/28 فحصاً ناجحاً** (حزمة قياس مؤقتة على نمط `layout-proof`، غير مُلتزَمة؛ اللقطات الثلاث في `awj-hero-display/`) |
| Typecheck | `tsc --noEmit` (web: لا أخطاء في ملفات المحرر؛ أخطاء ملفات الاختبار الأخرى سابقة للتغيير وخارج النطاق) · storefront نظيف | ✓ |

## 5. Build / CI

* لم يُشغَّل `next build` محلياً (Web CI وStorefront CI يفرضانه على الـPR). التحقق المحلي: `tsc --noEmit`، `biome format` على ملفات storefront المتغيّرة، و`vitest`.
* حزمة PHP الكاملة: النتيجة في وصف الـPR/أدناه.

## 6. المخاطر والمتبقي

1. **الطبقة الداكنة التي ضبطها التاجر سابقاً تبقى** عند إخفاء النص (لا يُلغيها العرض)، لأن إلغاءها في العرض كان سيُبطل إثبات رأس الشفاف (يحسب الطبقة) ويحتاج سبب «غير نشط» جديداً. يحذفها التاجر من «الخلفية». قابلٌ للتحسين لاحقاً (إخفاء الطبقة آلياً مع إثبات رأس مواكب).
2. **رأس شفاف فوق بطل صورة-فقط:** إثبات الرأس مستقل عن النص وسليم، لكنه لم يُختبر بصرياً في هذه المهمة (لم يُلمس منطقه).
3. **بطل بلا صورة مرسومة** (تدرج افتراضي أو صورة غير مثبتة): «صورة فقط» يعرض التدرج بلا نص، ورابط الصورة لا يُرسم (مقصود). التلميح في المحرر يقول ذلك.
4. **فصل الإظهار عن البقاء:** الحقول المخفية تبقى مخزَّنة (نص/أزرار) كي لا يفقدها التاجر عند إعادة الإظهار.
5. **لا اختبار E2E تفاعلي كامل** (محرر ← حفظ ← نشر ← إعادة تحميل) على بيئة حقيقية؛ المسار مغطّى بطبقاته (التطبيع المطابق + اختبارات المحرر والمعاينة والعرض)، وبوابات الحفظ/النشر لم تتغيّر.
6. **الدمج والنشر:** غير مُنفَّذين بحسب التعليمات؛ الـDeploy يحتاج موافقة مستقلة.

## 7. الخطوة التالية

مراجعة الـPR ← انتظار Web/Storefront CI ← دمج بقرار المالك ← (اختياري) إخفاء الطبقة الداكنة آلياً للبطل الخالي من النص بالتوازي مع إثبات رأس شفاف مواكب، وتعميم مفاتيح العرض نفسها على `banner` إن طُلب.
