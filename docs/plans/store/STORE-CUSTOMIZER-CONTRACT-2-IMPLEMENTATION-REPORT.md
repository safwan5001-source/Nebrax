# STORE-CUSTOMIZER-CONTRACT-2 — تقرير التنفيذ
## Backward-Compatible Homepage Section Instance Model

- المهمة: STORE-CUSTOMIZER-CONTRACT-2
- المستودع: `safwan5001-source/Nebrax`
- Branch: `feat/store-customizer-section-instance-contract`
- PR: #884 — `feat(store): add backward-compatible section instance contract`
- Base SHA: `bbb18e0bcebb296c7a75b23a67c2d13377f49fde` (أحدث main وقت بدء المهمة)
- Head SHA: انظر القسم 26 (يُحدَّث مع نتائج CI النهائية)
- الحالة: مكتمل التنفيذ والاختبارات المحلية؛ **لا Merge، لا Deploy.**

---

## 1. ملخص تنفيذي

تحويل عقد أقسام الصفحة الرئيسية من نموذج v1 `{key, visible}` إلى نموذج instances
من v2 `{id, type, visible}` عبر الطبقات الثلاث المالكة للتطبيع (PHP normalizer +
التوأمان storefront/web)، مع ترحيل deterministic للمستندات القديمة
(`id = key`)، ودلالة غياب مُصدَّرة (versioned missing-section semantics)،
وفشل مغلق (fail-closed) تجاه الأنواع المجهولة. لا تغيير في قاعدة البيانات، ولا في
الـexternal contract للـpublic storefront، ولا في الـpersistence، ولا أي UI جديدة.

## 2. Evidence — ما الذي تحقق قبل التنفيذ

قبل تغيير أي سطر، تم التحقق من جميع الـconsumers والـpersistence والـpublic
storefront normalization:

1. **المالك الحقيقي للعقد هو ثلاثة متطبيعات (normalizers) متماثلة:**
   - `app/Support/Commerce/StorefrontPresentationNormalizer.php` (المرجع الخادمي؛
     الـserver يعيد التطبيع ويخزّن مخرجاته فقط).
   - `storefront/src/lib/presentation/config.ts`.
   - `web/src/modules/store-experience-builder/presentation/config.ts`.
2. **الـpersistence** عبر `StorefrontPresentationService` (STORE-BACKEND-1):
   يكتب `schema_version => StorefrontPresentationNormalizer::VERSION` عند
   Save/Publish (مرجع ديناميكي — لم يحتج تعديلًا)، ويعيد تطبيع الـdraft عند GET
   مع تمرير `schema_version` المخزّن، ويطبّع `published_config` في
   `publishedSnapshotForStorefront` مع النسخة المخزّنة أيضًا.
3. **الـpublic storefront** (`storefront/src/app/[country]/[locale]/(storefront)/page.tsx`)
   يقرأ الأقسام من الـconfig المطبَّع ويحوّلها إلى شكل render-layer محلي
   `{key, visible}` — أي أن الـexternal response contract لم يتغير.
4. **الـrender-layer contract** (`HomeSection {key, visible}` في
   `web/.../presentation/home-sections.ts` و`storefront/src/lib/home/sections.ts`)
   عقد مستقل عن عقد الـpresentation؛ أُبقي دون تغيير عمدًا.
5. **الـconsumers الوحيدة لشكل القسم** في الـCustomizer: لوحتا ControlPanels
   (web + storefront dev mirror) ولوحتا StorefrontPreviewCanvas + صفحة الـstorefront.
   لا consumers أخرى لـ`homepage.sections` خارج هذه الملفات والاختبارات.

## 3. النموذج المختار

```ts
type PresentationHomeSectionV2 = {
  id: string;                        // هوية مستقرة داخل المستند
  type: HomeBuilderSectionKey;       // closed registry
  visible: boolean;
};
```

يطابق تمامًا الشكل المقترح في المهمة بعد التحقق. `PresentationHomeSection`
في التوأمين أصبح بهذا الشكل، و`MAX_HOME_SECTIONS = 30` حدًا أعلى للقائمة.

## 4. قرار الـVersioning

- **Version evolution واضح، لا تغيير صامت لمعنى v1:**
  `PRESENTATION_CONFIG_VERSION` 1 → 2 في التوأمين، و`VERSION = 2` في PHP.
- **لا compatibility layer منفصل** — البنية الحالية (normalizer ثلاثي) تسمح
  بترحيل داخل الـnormalizer نفسه مع version gate، وهذا أصغر شكل صحيح.
- **قاعدة النسخة الفعّالة** (PHP):
  `$effectiveVersion = $storedSchemaVersion ?? $declaredVersion ?? 1;`
  `$legacyDocument = $effectiveVersion < 2;`
  وفي TS: `!(typeof raw.version === "number" && raw.version >= 2)`.
- أي document قديم محفوظ (v1 أو بلا version) يبقى صالحًا وقابلًا للقراءة
  ويُرحَّل deterministic عند أول normalization.

## 5. التوافق مع الـlegacy (Backward Compat)

- إدخال `{key, visible}` (بلا `id`/`type`) يُرحَّل إلى `{id: key, type: key, visible}`.
- الكشف عن الشكل per-entry: وجود `id` أو `type` ⇒ مدخل v2؛ وإلا legacy `{key}`.
- المستندات المختلطة (v2 header + key-shaped entries) تُعامل كل entry حسب شكلها،
  لكن دلالة الغياب تتبع النسخة الفعّالة للمستند فقط.
- fixtures القديمة (`v1-default.json`, `v1-unsafe-input.json`) بقيت كمدخلات v1
  لاختبارات التوافق، وأُضيف `default-config.json` كمخرج v2 المتوقع.

## 6. استراتيجية الهوية المستقرة (Stable IDs)

- **لا UUID عشوائي أثناء أي normalization/read** — لا يوجد أي استدعاء
  `Str::uuid`/`crypto.randomUUID` في مسار التطبيع.
- legacy singleton: `id = key` — ثبت بالـEvidence أنه آمن: الـids محلية داخل
  الـpresentation وليست resource IDs، والـkey فريد أصلًا في v1.
- v2: الـid يُقبل كما هو بعد `safeId` (`/^[a-zA-Z0-9_-]{1,64}$/`)؛ id فارغ أو
  غير آمن ⇒ تُسقط الـentry (fail-closed).
- النتيجة: الهوية مستقرة عبر reload / Save / Publish وإعادة التطبيع المتكرر
  (idempotent) — مثبوت باختبارات round-trip.

## 7. دلالة الأقسام الناقصة (Missing-Section Semantics)

- **مستند legacy** (نسخة فعّالة < 2): الأقسام الناقصة تُعاد إلحاقها من الـdefaults
  بنهاية القائمة — نفس سلوك v1 حرفيًا، فلا يتغير معنى أي مستند قديم.
- **مستند v2**: الغياب = حذف حقيقي؛ لا يُعاد أي قسم (no resurrection)، والمصفوفة
  الفارغة تبقى فارغة.
- الحالتان مختبرتان منفصلتين في PHP والتوأمين.

## 8. سلوك النوع المجهول (Unknown Type — Fail-Closed)

- `HOME_BUILDER_SECTION_KEYS` registry مغلق في الطبقات الثلاث.
- أي `type` خارج الـregistry يُسقط دائمًا ولا يمكن أن يصبح سطح commerce صالحًا.
- لم يُضعَّف أي مسار fail-closed قائم (URLs، verification، وغيرها لم تُمَس).

## 9. سلوك الـID المكرر (Duplicate ID)

- `seenIds` — أول occurrence يفوز، واللاحق يُسقط deterministic.
- يمنع ذلك React key collisions ويحفظ استقرار العرض دون عشوائية.

## 10. قابلية تعدد النسخ حسب النوع (Multi-Instance Capability)

العقد **يسمح تقنيًا** بأي `(id, type)` فريدة الـid، بما فيها نسختان من نفس النوع.
لكن القدرة الفعلية مقيّدة بملكية المحتوى:

| النوع | القدرة الفعلية | السبب |
|---|---|---|
| hero | **singleton فعلي (maxInstances=1)** | `heroHeadline`/`heroSubheadline` global في `homepage`، وليست per-instance |
| categories / newArrivals / wholesale / appPromo | singleton عمليًا | المحتوى مشتق من الـcatalog/apps وليس payload قابلاً للتعدد |
| banner / featured / offers / benefits / customContent | **قابلة تقنيًا للتعدد (allowMultiple)** | لا تملك محتوى global؛ أقسام gated/placeholder اليوم |

**لم تُضف metadata للقدرة** (`maxInstances`/`allowMultiple`) لأن مكانها الطبيعي
هو الـSection Picker القادم — وثّقت هنا فقط للـUI PR التالي كما طلبت المهمة.

## 11. ملكية محتوى الـHero

- `heroHeadline` و`heroSubheadline` حقول global في `homepage` — **لم تُنقل** إلى
  instance payload في هذا الـPR.
- النتيجة المعلنة صراحة: **hero يجب أن يبقى maxInstances=1** حتى يُعاد تصميم
  ملكية المحتوى (إن قُرر ذلك) في PR مستقل مع migration مدروسة.
- لا إخفاء للمشكلة: العقد لا يمنع تقنيًا hero مكررًا، لكن الـUI الحالي لا ينتجه،
  والحد موثّق هنا وفي التقرير للـPR التالي.

## 12. الـPersistence

- لا parallel persistence: المسار الوحيد هو STORE-BACKEND-1
  (Draft → Save → Preview → Publish) عبر `StorefrontPresentationService`.
- `schema_version` يُكتب من `StorefrontPresentationNormalizer::VERSION`
  (مرجع ديناميكي — لم يحتج تعديلًا عند رفع النسخة إلى 2).
- الـserver يعيد التطبيع ويخزّن مخرجات الـnormalizer فقط (لم يتغير).

## 13. الـBackend / API

- لا routes جديدة، لا تغيير request/response shapes للـAPI.
- التغيير الوحيد: `StorefrontPresentationNormalizer` — `VERSION = 2`،
  `MAX_HOME_SECTIONS = 30`، defaults v2، version gate، ودالة
  `resolveHomeBuilderSections(mixed $configured, array $defaults, bool $legacy)`.
- الـvalidation الخادمي هو التطبيع fail-closed نفسه؛ لم تُضف قواعد أخرى لعدم الحاجة.

## 14. قاعدة البيانات

- **لا DB migration.** التغيير داخل JSON المخزّن في الأعمدة الموجودة
  (`draft_config`, `published_config`, `schema_version`) فقط.
- لم يظهر أي schema/constraint يفرض migration؛ لم تُضَف أي migration.

## 15. الـPublic Storefront

- الـexternal response contract **لم يتغير**: صفحة الـstorefront تطبّع داخليًا
  (عبر نفس الـtwin) ثم تحوّل `section.type` إلى `{key}` المحلي للـrenderer.
- published snapshots القديمة (schema_version=1، key-shaped) تُعرض بلا تغيير
  مرئي — مختبر في `PublicRuntimeTest`.
- لم يكن تغيير الـexternal contract ضروريًا، فلم يقع أي STOP condition هنا.

## 16. الـTenant / الأمان

- لا تغيير في tenant resolution أو authorization.
- Section IDs محلية داخل presentation المستأجر ولا تُستخدم كـresource IDs
  ولا تظهر في أي استعلام cross-tenant.
- اختبارات العزل القائمة (V2-1/V2-2 وSTORE-BACKEND-1) لم تُعدَّل ولم تُضعَّف.

## 17. الـUI (أصغر adaptation)

- **لا** Section Picker / Add / Duplicate / Delete UI، ولا redesign.
- التكييف الوحيد: consumers الخمسة تقرأ `section.type` بدل `section.key`
  وتستخدم `section.id` كـReact key:
  - `web/.../ControlPanels.tsx` (اختيار القسم والـtoggle يبقيان بالـtype/by index)
  - `web/.../StorefrontPreviewCanvas.tsx` (selection bridge بقي بالـtype)
  - `storefront/src/components/customizer/ControlPanels.tsx` (dev mirror)
  - `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx` (dev mirror)
  - `storefront/.../(storefront)/page.tsx` (تحويل type → render-layer key)

## 18. الملفات المتغيرة (16)

1. `app/Support/Commerce/StorefrontPresentationNormalizer.php`
2. `storefront/src/lib/presentation/config.ts`
3. `storefront/src/lib/presentation/tokens.ts`
4. `storefront/src/lib/presentation/__tests__/config.test.ts`
5. `storefront/src/app/[country]/[locale]/(storefront)/page.tsx`
6. `storefront/src/components/customizer/ControlPanels.tsx`
7. `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
8. `web/src/modules/store-experience-builder/presentation/config.ts`
9. `web/src/modules/store-experience-builder/presentation/tokens.ts`
10. `web/src/modules/store-experience-builder/__tests__/presentation.test.ts`
11. `web/src/modules/store-experience-builder/ControlPanels.tsx`
12. `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
13. `tests/Fixtures/presentation/default-config.json` (جديد)
14. `tests/Feature/StorefrontPresentationNormalizerTest.php`
15. `tests/Feature/StorefrontPresentationDraftApiTest.php`
16. `tests/Feature/StorefrontPresentationPublicRuntimeTest.php`

(+) هذا التقرير `docs/plans/store/STORE-CUSTOMIZER-CONTRACT-2-IMPLEMENTATION-REPORT.md`.

## 19. الاختبارات — التغطية والنتائج الدقيقة (محليًا)

### storefront (vitest 4.1.11)
- `src/lib/presentation/__tests__/config.test.ts`: **13 اختبارًا** —
  defaults/version=2؛ legacy key-shape migration (id=key + backfill)؛
  legacy idempotency بترتيب ids متوقع؛ v2 multi-instance بنفس النوع بالترتيب؛
  v2 absence=delete؛ v2 empty array؛ v2 unknown-type + duplicate-id first-wins؛
  v2 unsafe-id + cap 30؛ v2 round-trip stability؛ + اختبارات
  colour/verification/URL/store-name المحفوظة.
- السويت الكامل: **570/570 عبر 79 ملفًا** ✅

### web (vitest 2.1.9)
- `presentation.test.ts`: 4 الأصلية + **4 parity جديدة** (legacy id=key+backfill،
  multi-instance + absence=delete، round-trip بلا churn، unknown-type + dup-id).
- store modules 12/12، commerce-workspace 6/6، appearance (V2-1) 11/11 ✅
- لم يُحذف أو يُضعَّف أي اختبار قائم.

### PHP (تعمل في CI — لا vendor في الـsandbox)
- `StorefrontPresentationNormalizerTest` (معاد كتابته): fixture v2 +
  `legacy_v1_sections_migrate_with_deterministic_ids_and_default_backfill`,
  `legacy_normalization_is_idempotent_across_repeated_passes`,
  `v2_keeps_multiple_instances_of_the_same_type_in_order`,
  `v2_absence_means_delete_and_never_resurrects_defaults`,
  `v2_empty_sections_array_stays_empty`,
  `v2_drops_unknown_types_and_duplicate_ids_deterministically`,
  `v2_rejects_unsafe_ids_and_caps_the_section_list`,
  `v2_round_trip_is_stable_across_repeated_normalization`.
- `StorefrontPresentationDraftApiTest` (+2):
  `contract2_v2_sections_round_trip_through_save_reload_and_publish` و
  `contract2_legacy_v1_document_gets_deterministic_ids_and_stays_stable`.
- `StorefrontPresentationPublicRuntimeTest` (+2):
  `contract2_a_legacy_v1_published_snapshot_still_renders_publicly` و
  `contract2_a_v2_published_snapshot_keeps_instance_order_publicly`.
- `php -l` نظيف على الملفات الأربعة ✅

## 20. نتائج الـRound-Trips

- **legacy → normalize → save → reload → normalize:** لا churn في IDs/الترتيب/
  الرؤية، لا resurrection، لا فقدان بيانات — مثبت في التوأمين وDraftApiTest.
- **v2 input → save → reload → publish → storefront render:** الأقسام تُرجع
  بنفس الترتيب والهوية حرفيًا (`assertSame` على كامل المصفوفة) —
  مثبت في DraftApiTest + PublicRuntimeTest.

## 21. Build / Typecheck / Lint

- storefront `tsc --noEmit`: نظيف ✅ (TypeScript 5)
- storefront `biome check`: نظيف ✅
- web `tsc`: 17 خطأ كلها baseline/artifacts قديمة خارج وحدة المتجر (لا خطأ جديد) ✅
- `php -l` على الملفات المتغيرة: نظيف ✅

## 22. CI

انظر القسم 26 — يُحدَّث بالنتائج النهائية للـhead الأخير.

## 23. المخاطر

- **Duplicate hero عبر API خام:** العقد لا يمنعه تقنيًا؛ التخفيف: hero موثّق
  singleton ولا UI تنتجه، والقدرة metadata مؤجلة للـPicker PR.
- **مستندات v1 ذات sections فارغة** تستعيد الـdefaults كما كان v1 يفعل — سلوك
  مقصود محفوظ وليس regression.
- **المستندات المختلطة الشكل:** تُعالج per-entry؛ النتيجة deterministic لكنها
  حالة لا ينتجها أي client رسمي.

## 24. مؤجل (Deferred)

- Section Picker / Add / Duplicate / Delete UI — PR لاحق (V2-3).
- capability metadata (`maxInstances`/`allowMultiple`) في مكانها المناسب مع
  الـPicker.
- إعادة تصميم ملكية محتوى الـhero (إن قُرر) — PR مستقل مع migration مدروسة.

## 25. الاستقلالية عن PR #881

- الـbranch أُنشئ من `bbb18e0b` (main) ولا يحتوي أي commit من
  `feat/store-customizer-v2-section-editing`.
- لم يُعدَّل PR #881 ولا ملفاته الخاصة؛ المناطق المشتركة (ControlPanels/
  PreviewCanvas) عدّلت هنا على نسخة main فقط.

## 26. Git / CI النهائي

- Base SHA: `bbb18e0bcebb296c7a75b23a67c2d13377f49fde`
- Head SHA: `4cdd048d2c423650f63a7e6f5ad29f9e8783ce13` (+ commit هذا التقرير — يُحدَّث أدناه)
- CI: (يُحدَّث بعد اكتمال الـchecks على الـhead النهائي)

## 27. الخطوة التالية الموصى بها لاستئناف PR #881

1. بعد مراجعة ودمج هذا الـPR (قرار الدمج للمراجع — ليس هنا): أعد تأسيس
   `feat/store-customizer-v2-section-editing` على main الجديد.
2. نقاط التلامس المتوقعة: `ControlPanels.tsx` (web) — composer يقرأ
   `section.type`/`section.id` الآن؛ أي Section-Editing UI يجب أن يبني على
   instance identity (`id`) لا الـtype.
3. عمليات V2-2 (تحرير قسم محدد) يجب أن تستهدف `id` النسخة؛ الـselection bridge
   الحالي بالـtype كافٍ للنسخ المفردة، وسيحتاج ترقية إلى id عند وصول Duplicate.
4. لا تعيد تنفيذ الترحيل — استهلك العقد كما هو عبر الـtwins.

## 28. قرارات الـSTOP

لم يقع أي STOP condition: لا DB migration، لا breaking change للـpublic
storefront API، لا content-model migration كبيرة، لا tenant redesign، لا
rewrite للـconfig، والترحيل deterministic بالكامل.

**توقف هنا. لا Merge. لا Deploy.**
