# S01-INV — حصر مسارات كتابة/استعادة/التحقق للمسودة والمستهلكين الفعليين

**النطاق:** `builder_draft_experiences` ومسارات REST `app-builder/apps/{id}/draft|validate|versions`.
**المنهج:** بحث نصي على `app/ routes/ tests/ web/src mobile/ storefront/ preview-host/ scripts/ contracts/ docs/` + قراءة الخدمات. لا افتراض لوجود عملاء قدامى حقيقيين (Beta، حسابات اختبار فقط)؛ المطلوب معرفة **ما يوجد فعلاً** لا ما قد يوجد.
**الأساس:** `main @ 97b21a2` (بعد S01a #1814 و docs #1815؛ S01b في PR #1816).

## 1) مسارات الكتابة على المسودة (Writers)

| # | المسار | الملف | يمرّ عبر قفل S01a؟ | يرسل `base_revision`؟ | ملاحظات |
|---|---|---|---|---|---|
| W1 | `PUT app-builder/apps/{id}/draft` | `BuilderDraftExperienceController::update` → `BuilderDraftExperienceService::save` | نعم (معاملة + `lockForUpdate`) | اختياري في الخادم | **الكاتب الوحيد للمخطط بعد الإنشاء** في كود الإنتاج. صلاحية `apps_builder.manage` + `commerce.app_builder`. |
| W2 | إنشاء صف المسودة الأول (`revision = 0`) | `BuilderAppService::create` (داخل معاملة إنشاء التطبيق) | غير لازم (صف جديد) | — | المسار الوحيد الذي يُدرج `builder_draft_experiences` في الإنتاج. |
| W3 | بذر القالب في صفحة «تطبيق جديد» | `web/.../app-builder/new/page.tsx` | عبر W1 | **نعم** (`0`، منذ S01b) | فشله يُبتلع (ONB-02، شريحة لاحقة). |
| W4 | حفظ المحرر (يدوي/Ctrl+S) | `web/.../[id]/builder/page.tsx` | عبر W1 | **نعم** (منذ S01b) | معالجة 409 + نسخة محلية. |
| W5 | **استعادة إصدار** | `web/.../[id]/versions/page.tsx` — **عميلية بالكامل**: `GET version` ثم `PUT draft` | عبر W1 | **نعم** (يجلب أحدث revision أولاً، منذ S01b) | لا مسار استعادة في الخادم. |

لا يوجد أي كاتب آخر: لا `DB::table('builder_draft_experiences')`، لا `update()` جماعي، لا Job/Command/Seeder/Artisan، لا مسار في `preview-host`/`storefront`/`mobile`/`scripts` يكتب المسودة (تحقّق بالبحث النصي).

## 2) مسارات تقرأ المسودة (Readers) — ليست كتابة

| # | المسار | ملاحظة |
|---|---|---|
| R1 | `GET .../draft` | يعيد `revision` الذي يعتمد عليه `base_revision`. |
| R2 | `POST .../validate` (`validateDraft`) | يقرأ المسودة الحالية بلا قفل ولا `revision` في الطلب؛ فحص صرف لا يكتب. |
| R3 | `POST .../versions` (نشر) `BuilderPublishedExperienceVersionService::publish` | **يقفل صف `BuilderApp` لا صف المسودة**، ويقرأ المسودة بلا قفل ثم يلتقط `schema` للنسخة. **لا يستقبل `revision` متوقَّعاً ولا يسجّل revision المصدر.** انظر الفجوة النظرية G1 أدناه. |
| R4 | `PreviewSessionService::issueForDraft` | يلتقط لقطة `schema_snapshot` + `draft_revision` (يُسجَّل revision المصدر هنا). `draft_changed` استشاري. |
| R5 | Flutter Runtime (`mobile/lib/preview/*`) | **قراءة فقط** عبر `preview/v1/experience`؛ لا يكتب مسودة ولا يحتاج `base_revision`. |

## 3) المستهلكون الفعليون لـ`PUT draft`
- الواجهة الرسمية `web/` (3 نقاط: المحرر، الإصدارات، «جديد») — كلها ترسل `base_revision` بعد S01b.
- اختبارات الخادم (`BuilderAppTest`، `AppBuilderIntegratedProofTest`، `AppBuilderSameStoreProofTest`، `Preview*Test`، `BuilderDraftOptimisticLock*Test`) — بعضها يحفظ بلا `base_revision` عمداً لإثبات التوافق الانتقالي.
- **لا** عميل خارجي أو سكربت أو تطبيق جوّال أو متجر أو OpenAPI منشور يستدعي هذا المسار (بحث نصي على المستودع كله؛ العقد الوحيد المنشور هو `contracts/app-builder/draft-save-conflict.v1.json` لجسم الـ409). لا يمكن من المستودع نفسه نفي وجود سكربتات خارجه؛ في مرحلة Beta بحسابات اختبار فقط هذا الخطر مقبول وتؤكده أنت.

## 4) التوافق مع `base_revision`
- كل مسارات الويب الثلاثة صارت تصل إلى الخادم بـ`base_revision` (اختبارات الواجهة تثبت ذلك لكل مسار).
- الخادم يعامل الغياب كـ«آخر كتابة تفوز» ويسجّل المقياس `app_builder.draft_save_without_base_revision`. **المقياس يتيح مراقبة الاستعمال الفعلي** قبل التشديد (لكن لا بيانات إنتاج لدينا هنا؛ القرار يحتاج قراءته في بيئة الاختبار/الإنتاج بعد النشر — نشر يحتاج موافقتك).

## 5) الفجوات المكتشفة
- **G1 (جديدة، متوسطة): النشر يلتقط المسودة بلا قفل ولا revision متوقَّع.** سباق ممكن: مستخدم A يحفظ أثناء نشر المستخدم B فيُنشر مخطط لم يره B، والنسخة المنشورة لا تحمل revision مصدرها (لا تتبّع/تدقيق). لا يمسّ S01a/S01b (قفل مختلف: التطبيق لا المسودة). المقترح: شريحة صغيرة منفصلة تضيف `source_draft_revision` للنسخة المنشورة + `expected_draft_revision` اختيارياً في `POST versions` مع 409، وقفل المسودة داخل النشر. **تحتاج قرارك لأنها تغيّر عقد API (إضافي/اختياري) وتمسّ ترتيب الأقفال.**
- **G2 (منخفضة):** `POST validate` لا يقبل revision — يُفحص آخر ما حُفظ، وهذا مقصود (فحص صرف) لكن الواجهة قد تفحص نسخة أقدم من ما يراه المستخدم؛ تُعالج في S21 (Easy Mode) بفحص بعد الحفظ.
- **G3 (منخفضة):** الاستعادة عميلية (قراءتان + كتابة): مفتوحة لسباق قراءة-كتابة لكنه الآن محمي بـ`base_revision` المُجلَب حديثاً؛ نقلها إلى الخادم (`POST versions/{n}/restore` ذري) خيار معماري لاحق لا لازم.

## 6) توصية S01c (428 عند غياب `base_revision`)
**التوصية: نعم، تنفيذ S01c بعد موافقتك، بالشروط التالية.**
1. **المبرّر:** الكاتب الوحيد في الإنتاج هو الويب وقد صار يرسل `base_revision` في كل مساراته؛ لا مستهلك آخر موجود؛ إبقاء المسار القديم «بلا مبرر» يترك ثغرة lost-update بصمت (طلبكم: «لا تُبقِ المسار القديم بلا مبرر»).
2. **الشكل:** `428 Precondition Required` بجسم `{message, reason: "base_revision_required", current_revision}` (إضافي ومتسق مع عقد 409) عند غياب/null `base_revision`.
3. **الأمان الانتقالي (مقترح):** ابقِ علماً `app_builder.require_base_revision` (افتراضي `true` بعد S01c) في الإعدادات كمفتاح تراجع تشغيلي لا كسياسة مستأجر؛ أو بلا علم إن فضّلتم الحسم الكامل.
4. **الاختبارات المطلوبة:** تحديث اختبارات الخادم التي تحفظ بلا `base_revision` (تُحصى ~حسب البحث: `BuilderAppTest`، `AppBuilderIntegratedProofTest`، `AppBuilderSameStoreProofTest`، `Preview*`)، + اختبار 428 بلا كتابة، + PostgreSQL، + تحديث `contracts/app-builder/draft-save-conflict.v1.json` (أو ملف عقد 428 موازٍ) + تنبيه Mobile CI لأن المسار تحت `contracts/app-builder/**`.
5. **الترتيب:** بعد دمج S01b (حتى لا يُكسَر مسار الويب الحالي في أي بيئة تجمع الاثنين).
6. **لن يُنفَّذ قبل موافقتك الصريحة.** G1 قرار منفصل (شريحة مقترحة S01d).
