# AWJ-HERO-FULLBLEED — Hero بعرض الشاشة + إعدادات الترويسة الشفافة — تقرير التنفيذ

| | |
|---|---|
| **Branch** | `claude/awj-hero-fullbleed-header-overlay` |
| **Base** | `main` عند `f308a1a36161f4bd230b0cbb6623642fdef5691d` (دمج #1645 بـsquash). أُعيد تأسيس الفرع بـ`git rebase --onto origin/main db2cf01` فبقي **التزام واحد** فوق main، ولا يحتوي أي ملف أو تغيير من #1645 (مُتحقَّق: `git diff --name-only origin/main HEAD` لا يضم `HeroSection`/`section-content`/`ControlPanels`/`StorefrontPreviewCanvas`/تقرير #1645). الإصدار الأول من الفرع كان مُكدَّسًا على `db2cf01`. |
| **Head SHA** | يُملأ بعد الالتزام النهائي (انظر وصف الـPR) |
| **PR** | يُنشأ ضد `main` — **غير مدموج، لا نشر** |
| **النطاق** | مفاتيح اختيارية مضافة داخل مستند العرض (`design.mediaTreatment` للبطل، و`header.design.overlayTone`). لا migration، لا API جديد، لا مساس بالمحاسبة/المخزون/ZATCA، `PRESENTATION_CONFIG_VERSION` لم يتغيّر. |

## 1. الفحص قبل التنفيذ — ما هو موجود وما هو ناقص

النظام كان يغطي جزءًا كبيرًا من الطلب (CUST-HV V5–V7). **لم يُبنَ نظام موازٍ**؛ نُفِّذ الناقص فقط فوق الـresolver والـCSS والمحرر القائمة.

### الترويسة

| المطلوب | الحالة | أين |
|---|---|---|
| 1. ترويسة عادية بخلفية واضحة والـHero تحتها | **موجود** | `header.design.mode` غير مضبوط/`solid` (الافتراضي) |
| 2. ترويسة شفافة فوق صورة Hero | **موجود** | `mode: overlay-hero` (V7c-2) — إثبات تباين على كامل الصورة |
| 3. تحويلها إلى خلفية واضحة عند التمرير | **موجود** | بعد 24px أو عند التركيز داخلها (`overlayIsSolid`) |
| 4. لون نص/أيقونات تلقائي بحسب التباين + فاتح/داكن | تلقائي **موجود**؛ فاتح/داكن **أُضيف** | `header.design.overlayTone` (هذا الـPR) |
| 5. شريط الإعلانات/الترويسة الثابتة/تنقل الجوال | **موجود** (V7c-2، 4,532 فحصًا) | أُعيد التحقق منه (انظر 5) |
| 6. الخيارات في المحرر + معاينة مباشرة | موجود للوضع؛ **أُضيف** اختيار النغمة | `HeaderDesignPanel` + Canvas |
| 7. عدم تغيير المتاجر القديمة | **محفوظ** | الغياب = السلوك القديم حرفيًا (اختبارات) |
| 8. إعادة استخدام نظام الترويسة والتباين | **تم** | `resolveHeaderOverlay` نفسه، بلا نظام بديل |

### Hero

| المطلوب | الحالة |
|---|---|
| Contained / Full Bleed | **أُضيف** `mediaTreatment.bleed`. الخيار القديم «شريط بعرض الشاشة» (`width.mode=full`) كان **بلا أثر** على صورة Hero (يعمل للخلفية الصلبة فقط) |
| Below Header | **أُضيف** — الـHero الأول يلتصق بالترويسة (لا حشوة علوية للحاوية) |
| Overlay Header | **موجود** (V7c-2) |
| ارتفاع مستقل للجوال/سطح المكتب | **أُضيف** `mediaTreatment.mobileHeight` (يستبدل `height` تحت 768px) |
| حفظ نسبة الصورة بلا تشويه | **أُضيف** `mediaTreatment.ratio: "natural"` |
| `object-fit: cover` / `contain` | `cover` موجود دائمًا؛ **`contain` مرفوض عمدًا** (انظر 2) |
| تعتيم يدوي بلا حذف القديم / صورة بلا تعتيم | **موجود** (`design.background.overlay` اختياري؛ لا طبقة افتراضية — #1645 أكّد ذلك) |
| إعدادات في Hero Settings + معاينة مباشرة | **أُضيف** (مفتاحان + قائمة ارتفاع الجوال) |

## 2. القرارات

**AWJ Decision**
* **مفتاح صريح جديد للبطل فقط** (قرار المالك) بدل إعادة استخدام `width.mode=full`: أي Hero منشور ضغط ذلك الخيار القديم وهو بلا أثر يبقى بطاقة محتواة تمامًا (اختبار صريح). مفاتيح `bleed`/`ratio`/`mobileHeight` تخصّ `hero` وحده؛ `banner`/`slider` يحتفظان بـ`height` فقط (اختبارات الـfixture).
* **`ratio: "natural"` بدل `contain`**: يحقق «لا قص ولا تشويه» بصورة تملأ الصندوق كاملًا، فيبقى إثبات التباين صالحًا على كل بكسل. الارتفاع يأتي من **صورة داخل التدفق** (شبكة بخلية واحدة يتشاركها الصورة والنص) — بلا حاجة لأبعاد الصورة في الحمولة، ويعمل في المتجر والـCanvas، ومع صورة جوال مختلفة النسبة (art direction). النص الأطول من الصورة يُكبّر القسم ولا يُقصّ.
* **النغمة تُحكم وقت العرض لا وقت النشر** (كالوضع التلقائي): نغمة لا يثبتها التباين على كامل الصورة (≥ 4.5:1) تُبقي الترويسة **صلبة** (`tone-unprovable`) بدل أن تصير غير مقروءة. لا خطأ نشر.
* **`overlayTone` يُخزَّن مع `mode: overlay-hero` فقط** (وإلا بيانات خاملة) — الإخراج القانوني يسقطه تلقائيًا عند الرجوع إلى «عادية».
* **الأقسام**: الأثر مقصور على `hero` بصورة **مُثبَتة** وتخطيط غير `split`؛ غير ذلك = لا token ولا تغيير.

**Rejected / Not Adopted**
* `object-fit: contain` لصورة الخلفية: يكشف سطحًا لا تغطيه أدلة التباين (قرار V6b-2 القائم في `normalizeBackgroundRef`، لم يُنقض).
* «إبقاء الترويسة شفافة بعد التمرير»: لا يمكن إثباته فوق محتوى عشوائي (V0 §9.3.1). المتاح بدلًا منه وبلا تغيير: `sticky: off` فتتحرك الترويسة الشفافة مع الصفحة فوق Hero فقط.
* مفتاح `transparent` حرّ للترويسة: يبقى مرفوضًا (قرار V7c-2).

## 3. ما نُفِّذ

**العقد (PHP سلطة + توأما TS متطابقان بايتًا + fixtures مشتركة)**
* `StorefrontSectionDesignNormalizer`: `mediaTreatment` للبطل = `height, mobileHeight, ratio, bleed` (ترتيب قانوني)؛ `bleed` يُخزَّن `true` فقط، `ratio` = `natural` فقط.
* `StorefrontHeaderDesignNormalizer`: `overlayTone` ∈ `light|dark`، مشروط بـ`mode: overlay-hero`، ترتيب (`mode, overlayTone, sticky`).
* `header-overlay.ts`: النغمة المفروضة تستبدل `autoForeground` ولا تتجاوز الإثبات؛ سبب جديد `tone-unprovable`.

**الرسم (storefront + Canvas — الـresolver نفسه والكتلة المشتركة في CSS نفسها)**
* الـresolver يُصدر `hbl` (bleed) و`rat` (natural) و`hgtm` (ارتفاع الجوال) — فقط لـHero صورته مُثبَتة وتخطيطه ليس `split`. الـCanvas يحلّ الجهاز المحاكى داخل الـresolver (لا media query على نافذة المحرر).
* كتلة CSS مشتركة (متطابقة في `globals.css` و`store-preview.css`، يحرسها اختبار التكافؤ) + نصفان غير مشتركين: المتجر بوحدات `vw`، والـCanvas بوحدات `cqw`. الصورة تمتد بعرض الإطار (`--sd-vw`)، والصفحة تقصّ التجاوز عند `main`/جذر المعاينة (لا تمرير أفقي حتى مع شريط تمرير كلاسيكي). عمود النص يبقى على محاذاة الحاوية.
* ملاصقة الترويسة: أول عنصر في كومة الصفحة يفقد حشوة الحاوية العلوية (`:has(> [data-sd~="hbl"]:first-child)`).

**المحرر**
* `DesignInspector` (Hero): «ارتفاع القسم على الجوال»، «ارتفاع بنسبة الصورة الأصلية»، «صورة بعرض الشاشة كاملة» + شرح + تنبيه «غير مفعّل الآن» إذا لم يتحقق الشرط (صورة مُثبَتة وتخطيط غير منقسم). كل مفتاح يكتب حقله وحده (كان إلغاء الارتفاع يمسح مجموعة `mediaTreatment` كلها).
* `HeaderDesignPanel`: «لون نص الترويسة الشفافة» (تلقائي/فاتح/داكن) يظهر مع وضع الشفافة فقط. نصوص AR/EN.
* معاينة مباشرة: الـCanvas يعرض الأثر فورًا. سيناريوهات تطويرية جديدة: `/dev/customizer-visual?scenario=hero-bleed|overlay-light|overlay-dark`.

## 4. التوافق الرجعي

* الغياب = مخرجات اليوم حرفيًا: لا token ولا متغير CSS جديد (اختبار). وثائق ما قبل الميزة تُطبَّع إلى نفسها.
* Hero منشور بـ`width.mode=full` فوق صورة: **بطاقة محتواة كما كان** (اختبار صريح). الشريط الصلب `bleed` القديم كما هو.
* `height` وحده = ما كان يُصدره V6c-3 (`--sec-minh` نفسه، بلا token جديد).
* الترويسة بلا `overlayTone` = القرار التلقائي كما كان.

## 5. الاختبارات والتحقق

| الفحص | النتيجة |
|---|---|
| PHP — `StorefrontSectionDesignTest` + `StorefrontHeaderDesignTest` + Slider/Gallery/Contrast (مستهدف) | 230 نجح |
| PHP — `php artisan test` **كامل** على الشجرة المُعاد تأسيسها (SQLite) | **8681 نجح**، 209 مُتخطّى، 26 فشل — **كلها في اختبارات Fuel** بسبب غياب `ext-bcmath` في بيئتي المحلية (`Call to undefined function bcmul()` ×24 + استجابتا 500 لنفس السبب في واجهتَي Fuel)؛ لا علاقة لها بالتغيير وتنجح في CI حيث الامتداد مثبَّت (تحذير الإعداد المحلي نفسه ينصّ على ذلك). نتيجة CI الفعلية في وصف الـPR |
| Storefront — `biome check` (CI: `pnpm check`) · `tsc --noEmit` · vitest كامل (بعد إعادة التأسيس، يشمل اختبارات #1645) | نظيف (لا أخطاء؛ التحذيران/3 infos قائمة على main) · نظيف · **3009 نجح** / 16 مُتخطّى (قائم) |
| Web — vitest (`store-experience-builder` + `commerce-workspace/presentation*`) | **3042 نجح** (يشمل تكافؤ CSS بين الورقتين وتكافؤ الـfixtures) |
| Web — `npm run build` (Next.js 15، بعد إعادة التأسيس) | **نجح** |
| **Chromium حقيقي — المتجر المنشور** (مكوّنات الإنتاج + CSS الحقيقي المُترجَم + أشرطة تمرير كلاسيكية): 9 أنماط × RTL/LTR × 390/768/1024/1280 | **736 فحصًا، 0 مخالفات** |
| ضابط سلبي (حذف قواعد الميزة من CSS) | **130 مخالفة** — الفحص ليس فارغًا |
| **Chromium حقيقي — Canvas** (خادم Next حقيقي، بعد إعادة التأسيس): Full Bleed + نسبة طبيعية × AR/EN × 390/768/1280 + نغمة فاتحة (شفافة) + نغمة داكنة غير قابلة للإثبات (صلبة) | **10/10** |
| انحدار: مواصفة Canvas القائمة للترويسة الشفافة (V7c-2) — 12 اختبارًا × AR/EN × 6 عروض | **12/12** (مع مواصفتي: 22/22 في تشغيل واحد) |
| انحدار: إثبات تداخل Hero (V6c-4) في Chromium | **360 فحصًا، 0 مخالفات** |

ما تثبته فحوص Chromium: الصورة تبلغ **حافتَي** الشاشة (LTR وRTL) بلا radius، الـHero ملاصق للترويسة (مقابل ≥ 8px في الأصل)، عمود النص على محاذاة الحاوية نفسها، ارتفاع = `عرض الصورة × نسبتها` (16:9 للحاسوب و4:5 لصورة الجوال تحت 768)، لا تشويه (`object-fit: cover`)، نص أطول من الصورة يُكبّر القسم دون قص، `min-height` الجوال/الحاسوب صحيح، لا تمرير أفقي، كل CTA قابل للنقر، و`split`/بلا صورة = لا أثر.

الأدلة: `docs/plans/store/awj-hero-fullbleed/` (لقطات + `storefront-proof-summary.json`). المحطة: `storefront/scripts/hero-bleed-proof/measure.mjs` + `hero-bleed-proof.render.test.tsx` (خاملة في CI بنمط `overlap-proof`)، ومواصفة `web/e2e/awj-hero-fullbleed-canvas.spec.ts`.

## 6. المخاطر والحدود (بصراحة)

1. **محطة إثبات الترويسة الشفافة V7c-2 معطوبة قبل هذا الـPR**: `header-overlay-proof.render.test.tsx` يفشل في العرض لأن `HeaderNavLinks` (V7d) يستخدم `useTranslations` كعميل دون مزوّد في المحطة. غير مرتبط بتعديلي ولا يعمل في CI. استُعيض عنه بمواصفة Canvas القائمة (انظر 5). إصلاح المحطة خارج النطاق.
2. **الصورة الطبيعية بعرض كامل على شاشة عريضة جدًا** قد تكون طويلة (16:9 على 1920px ≈ 1080px). هذا ما تعنيه «نسبة طبيعية»؛ للتحكم يبقى الخياران: اترك `ratio` واستعمل ارتفاعًا مُعدًّا.
3. **ترويسة شفافة + Full Bleed + `ratio`**: في وضع الترويسة الشفافة الصورة تمتد أصلًا إلى الحافتين (V7c-2)؛ `bleed` فيه بلا أثر إضافي، و`ratio` يعمل (الـCanvas/الاختبارات تغطي كل تركيبة على حدة، لا تركيبة الثلاثة معًا في Chromium).
4. **حدّ الـCanvas**: `:first-child` لمطابقة «الأول في الصفحة» يفترض أن غلاف القسم هو أول ابن للحاوية؛ مُتحقَّق منه في e2e الـCanvas (الملاصقة مختبرة)، لكن إضافة عنصر مرئي قبل الأقسام في المعاينة لاحقًا يستلزم تعديل هذا المُحدِّد.
5. **ملاحظتا Codex P2 على #1645** (حلقة تركيز رابط الصورة؛ شرط «authored» عند الحذف) كانتا مفتوحتين عند الدمج؛ لا علاقة لهذا الـPR بهما ولم ألمسهما — يُنصح بتتبعهما في PR مستقل.
6. **لا اختبار E2E كامل محرر → نشر → إعادة تحميل المتجر**: المسار منفصل إلى (أ) عقد/تطبيع PHP مُختبَر بنفس الـfixture، (ب) الرسم المنشور مُختبَر في Chromium، (ج) المحرر/الـCanvas مُختبَران؛ دون تشغيل النشر الفعلي (يحتاج بيئة Commerce كاملة).
7. **لا تأثير مالي/محاسبي**: لا عمليات مالية جديدة ⇒ لا قيود محاسبية لعرضها.

## 7. الملفات المتغيرة

* **PHP**: `app/Support/Commerce/StorefrontSectionDesignNormalizer.php`، `StorefrontHeaderDesignNormalizer.php`، `tests/Fixtures/presentation/section-design.json`، `header-design.json`.
* **توأما TS (متطابقان)**: `presentation/{section-design,section-design-resolve,header-design,header-overlay}.ts` في `storefront/src/lib/presentation/` و`web/src/modules/store-experience-builder/presentation/`.
* **CSS**: `storefront/src/app/globals.css`، `web/.../store-preview.css`.
* **المحرر**: `design/DesignInspector.tsx`، `HeaderDesignPanel.tsx`، `messages.ts`، `web/src/app/dev/customizer-visual/page.tsx` (سيناريوهات).
* **اختبارات**: تعديل `section-design-resolve.test.tsx` و`header-overlay.test.ts` (×2)، `DesignInspector.test.tsx`، `header-design.canvas.test.tsx`؛ جديد: `hero-bleed-proof.render.test.tsx`، `scripts/hero-bleed-proof/measure.mjs`، `web/e2e/awj-hero-fullbleed-canvas.spec.ts`.
* **وثائق/أدلة**: هذا التقرير و`docs/plans/store/awj-hero-fullbleed/`.

---

**Merge: NOT PERFORMED. Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
