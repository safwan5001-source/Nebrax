# AWJ ERP — تدقيق تخصيص خلفية المتجر العامة

## نطاق التدقيق

تمت مراجعة أحدث نسخة من `main` في مستودع `safwan5001-source/Nebrax` قبل أي تعديل، مع تتبع وثيقة `StorefrontPresentationConfig` من صانع المتاجر إلى التخزين والنشر ثم Runtime المتجر العام.

## النتائج

### 1. البنية الحالية تدعم التوسعة

النظام يملك بالفعل وثيقة عرض مستقلة لكل `storefront`، ومسار حفظ/نشر موحّد (`StorefrontPresentationService` ونسخ العرض)، ومطبّعين متطابقين في TypeScript وPHP. لا توجد حاجة إلى جدول أو API بديل.

### 2. الخلفية العامة ليست قابلة للتخصيص حالياً

- `StorefrontPresentationConfig` يحتوي `primaryColor` و`accentColor` لكنه لا يحتوي إعداداً مستقلاً لخلفية المتجر.
- `storefront/src/app/globals.css` يعرّف `--store-background: #f8f9fa` كقيمة ثابتة.
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` يستخدم `bg-store-background`، لكن متغير المعاينة لا يغيّر الخلفية العامة.
- إعدادات المظهر الحالية تعرض اللون الأساسي واللون الثانوي فقط.

### 3. خلفيات الأقسام منفصلة بالفعل

خلفيات الأقسام موجودة داخل `homepage.sections[*].design.background` وتُطبّع وتُحكم عبر `StorefrontSectionDesignNormalizer` و`SectionDesignContrast`. لذلك يجب أن يبقى لون الخلفية العامة على مستوى الوثيقة وألا يُكتب داخل تصميم أي قسم.

### 4. مسار البيانات

1. لوحة `ThemePanel` تعدّل نسخة `StorefrontPresentationConfig` في حالة صانع المتاجر.
2. `ExperienceBuilder` يحفظ النسخة من خلال عميل `commerce-workspace/presentation` إلى endpoint العرض الحالي.
3. الخادم يمرر الحمولة إلى `StorefrontPresentationNormalizer` ويحفظها في `storefront_presentation_versions.config`/رأس العرض، مع عزل tenant/storefront القائم.
4. النشر ينسخ الوثيقة المطبّعة إلى اللقطة المنشورة.
5. المتجر المنشور يقرأ `fetchStorefrontConfig().presentation`، ثم `normalizePresentationConfig`، ثم `publishedThemeStyle` على غلاف `data-published-theme`.

### 5. الفجوة الفعلية بين المعاينة والنشر

`StorefrontPreviewCanvas` يطبّق `presentationCssVars` على جذر المعاينة، بينما النشر يطبّق `publishedThemeStyle`. كلاهما هو seam الصحيح، لكن القيمة العامة غير موجودة في الوثيقة ولا تُصدّر من أي منهما؛ لذلك تبقى المعاينة والنشر على اللون الثابت.

### 6. التباين والتوافق

- تباين تصميم الأقسام يحكم القسم بلا خلفية مقابل ثابت `#f8f9fa` في `SectionDesignContrast::PAGE_BACKGROUND`، وتوأمه في `section-design-resolve.ts`.
- يجب تمرير لون خلفية الوثيقة إلى هذا الحكم حتى تكون بوابة النشر مطابقة للمعاينة عند اختيار خلفية داكنة/ملونة.
- الخلفيات الصلبة/التدرجات/الصور الخاصة بالأقسام لها حكمها المستقل، ولا ينبغي تغييرها عند تغيير خلفية المتجر العامة.
- الهيدر والفوتر والبطاقات تعتمد أسطحها/رموزها الخاصة (`--store-surface`, `--store-footer`, ومتغيرات التصميم)؛ وضع `--store-background` على الغلاف العام لا يعيد تلوينها.

## قرار التنفيذ

توسعة `StorefrontPresentationConfig` بحقل HEX مستقل `backgroundColor`، افتراضيه `#f8f9fa`، مع تطبيع fail-closed في TS وPHP. يمر الحقل عبر `presentationCssVars` و`publishedThemeStyle`، وتُستخدم قيمته في حكم تباين القسم بلا خلفية. واجهة المظهر ستوفر منتقي لون، إدخال HEX، زر استعادة الافتراضي، وتحديثاً فورياً عبر `patch` الحالي.

## المخاطر/النقاط غير المكتملة قبل التنفيذ

- يجب إضافة اختبارات parity للتطبيع، متغيرات المعاينة/النشر، وحكم التباين مقابل الخلفية الجديدة.
- لا حاجة لترحيل قاعدة بيانات أو تغيير مسار الحفظ/النشر؛ الوثائق القديمة ستأخذ القيمة الافتراضية.
- لا يوجد نشر أو تعديل مباشر للإنتاج ضمن هذه المهمة.
