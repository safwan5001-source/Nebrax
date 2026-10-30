# S01a — القفل التفاؤلي لمسودة صانع التطبيقات على الخادم (AD-01) — تقرير التنفيذ

> **الشريحة:** S01a فقط (خادم). **لم تبدأ** S01b (واجهة) ولا S01-INV (حصر المسارات) ولا S01c (فرض 428).
> **الحالة:** PR للمراجعة فقط — بلا دمج ولا نشر.
> **المرجع:** `AWJ-APP-BUILDER-FULL-CLOSURE-ROADMAP.md` §5 و`AWJ-APP-BUILDER-ARCHITECTURE-DECISIONS.md` (AD-01 المعتمد) — على الفرع `docs/app-builder-easy-mode-v2` @ `b4b8b3b`.

## 1) المرجع الإصداري

| البند | القيمة |
|---|---|
| **Branch** | `feat/app-builder-s01a-draft-optimistic-lock` |
| **Base SHA** | `d73d8811b97a1f3abafb15c20c94d204b99aaf8a` (أحدث `origin/main` وقت البدء: `fix(web): label the wholesale permission area… (#1811)`) |
| **Code SHA** | `9b1253a6c6651cc1c2f4dffd8bb39f9537f4bd5f` (التنفيذ + الاختبارات + العقد) |
| **Head SHA (وقت الاختبار)** | `23b013d7dc39432e3cdea5c92125de47be7427e2` — الـHead الذي أنتج CI الأخضر. هذا التقرير المحدَّث التزام لاحق (توثيق فقط) رأسُه يُذكر في رسالة التسليم |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1814 |

## 2) ما تغيّر

| الملف | التغيير |
|---|---|
| `app/Services/AppBuilder/BuilderDraftExperienceService.php` | الحفظ داخل `DB::transaction` مع `lockForUpdate()` على صف المسودة؛ مقارنة `base_revision` داخل القفل؛ الزيادة من الصف المقفول؛ سجلّ مقياس الحفظ بلا `base_revision` |
| `app/Services/AppBuilder/DraftRevisionConflictException.php` (جديد) | استثناء التعارض (يرث `DomainException` عمداً حتى لا يحوّله `ApiController::domain()` إلى 422) |
| `app/Http/Requests/UpdateBuilderDraftExperienceRequest.php` | قاعدة `base_revision`: `nullable`، عدد صحيح ≥ 0، ويرفض المنطقي صراحةً (لأن `integer` في Laravel يقبل `true`) |
| `app/Http/Controllers/Api/BuilderDraftExperienceController.php` | يمرّر `base_revision` ويحوّل التعارض إلى **409** بجسم منظَّم |
| `contracts/app-builder/draft-save-conflict.v1.json` (جديد) | عقد مشترك لشكل النجاح/التعارض/التحقق (يستهلكه S01b لاحقاً) |
| `tests/Feature/BuilderDraftOptimisticLockTest.php` (جديد) | 18 اختبار API (SQLite + PostgreSQL)، منها اختبار صريح أن **استعلام القفل نفسه** مقيَّد بنطاق المستأجر |
| `tests/Feature/BuilderDraftOptimisticLockPostgresTest.php` (جديد) | 6 اختبارات تزامن PostgreSQL بعمليات `pcntl_fork` |
| `CLAUDE.md` | قسم قصير يوثّق قواعد AD-01/S01a |

**لا هجرة قاعدة بيانات. لا تغيير في Flutter أو الويب. لا مسار جديد. لا منطق محاسبي.**

## 3) السلوك

```
PUT /api/app-builder/apps/{id}/draft
{ "schema": {...}, "base_revision": 3 }         # base_revision اختياري انتقالياً
```
| الحالة | النتيجة |
|---|---|
| `base_revision` = revision الحالي | 200، `revision` +1 |
| `base_revision` ≠ revision الحالي (قديم أو أكبر) | **409** `{message, reason:"draft_conflict", current_revision, base_revision, updated_by, updated_at}` **بلا أي كتابة** |
| `base_revision` غائب أو `null` | كما كان (آخر كتابة تفوز) + سجلّ `app_builder.draft_save_without_base_revision` |
| `base_revision` غير صحيح (نص/سالب/كسر/مصفوفة/منطقي) | 422 ولا كتابة |
| مخطط غير صالح بنيوياً | 422 قبل أخذ القفل (لا زيادة revision) |
| مستأجر آخر | 404 (لا `current_revision` ولا `updated_by` في الاستجابة) |
| `view` فقط أو `staff` | 403 |

**القرارات الصغيرة (ضمن AD-01):**
- التحقق البنيوي يسبق القفل (قصر زمن القفل)، فمخطط غير صالح يُرفض بـ422 حتى مع أساس قديم.
- التعارض لا يكشف محتوى المخطط؛ فقط أرقام ومعرّف آخر كاتب في **المستأجر نفسه** (المسودة معزولة بالنطاق).
- الكتابة فوق (بعد تأكيد المستخدم) تتم في S01b بإرسال revision أحدث بعد إعادة الجلب؛ فإن تحرّك ثانيةً يعود 409.

## 4) الاختبارات

**البيئة:** PHP 8.3، Laravel 11.57، PHPUnit 11، **PostgreSQL 16.15 محلي** (مطابق لصورة CI `postgres:16`) وSQLite. الملفات الجديدة انتُسخت إلى مشروع Laravel المجمَّع كما يفعل `setup.sh`/CI.

| المجموعة | النتيجة |
|---|---|
| `BuilderDraftOptimisticLockTest` (SQLite) | **18 ناجحاً** (100 تأكيد) |
| `BuilderDraftOptimisticLockPostgresTest` (PostgreSQL، `pcntl_fork`) | **6 ناجحة** (118 تأكيداً) |
| مجموعة App Builder الأوسع على **SQLite** (`Builder|AppBuilder|PreviewSession|PreviewExchange|CommerceExperience|ApplicationCatalog…`) | **240 ناجحاً، 8 متخطّاة** (1607 تأكيداً) |
| المجموعة نفسها على **PostgreSQL** | **119 ناجحاً** (832 تأكيداً) |
| اختبارات App Builder القائمة | **لم تُعدَّل** (كلها خضراء كما كانت) |
| **المجموعة الكاملة محلياً** (`php artisan test --parallel --processes=4`، 10078 اختباراً، SQLite) | 9764 ناجحاً، 288 متخطّاة، **26 فاشلاً كلها اختبارات الوقود** (`FuelSale*`، `FuelSupplyReceiving*`، `FuelReconciliation*`، `FuelAviRfid*`) بسبب `Call to undefined function bcmul()`: امتداد `bcmath` غير مثبّت في بيئتي المحلية (يحذّر منه `setup.sh`، ويمرّ في CI). **لا علاقة لأي منها بـApp Builder** |

**ما تثبته الاختبارات (معايير AD-01 المغطاة في S01a):**
| المعيار | الدليل |
|---|---|
| AD01-1 `base_revision` داخل الجسم، اختياري انتقالياً | `a_save_without_base_revision_still_works…`، `a_null_base_revision…` |
| AD01-2 409 بجسم منظَّم وبلا كتابة | `a_stale_base_revision_returns_409…`، `a_base_revision_ahead…`، مطابقة العقد المشترك |
| AD01-3 سباقات PostgreSQL | واحد ينجح فقط من أساس واحد · إعادة المحاولة ⇒ كلهم ينجحون بـrevision متتالٍ · SIGKILL يفك القفل · مستأجران بلا جمود |
| AD01-4 توافق رجعي | الحفظ بلا `base_revision` يعمل؛ **8 كتّاب قدامى متزامنين = 8 تزايدات** (كانت تضيع) |
| AD01-5 عزل المستأجرين | `another_tenant_gets_404…` + اختبار مستأجرين متزامنين |
| AD01-6 الصلاحيات | `staff_and_view_only_roles_cannot_save…` |

**اختبار الطفرات (هل الاختبارات تلتقط الخلل؟):** حذف `lockForUpdate()` أفشل 4 من 6 اختبارات PostgreSQL؛ وتعطيل مقارنة `base_revision` أفشل 8 اختبارات (API وPostgreSQL)؛ وإزالة نطاق المستأجر من استعلام القفل (`withoutGlobalScopes`) أفشل اختبار العزل الصريح. أُعيد الكود الأصلي بعدها وتحققتُ بـ`diff`.

## 5) الأمان وعزل المستأجرين والتوافق الرجعي

- **العزل:** القراءة داخل القفل تمرّ بنطاق المستأجر نفسه (`BaseModel`)، و`BuilderApp::findOrFail` يسبقها؛ مستأجر آخر لا يصل للقفل ولا لأي رقم.
- **الصلاحيات:** لم تتغير (`apps_builder.manage` للكتابة). لا مسار جديد.
- **منع الاستغلال:** لا حفظ بلا قفل بعد الآن؛ تزايد `revision` لا يضيع حتى للمسار القديم.
- **التوافق الرجعي:** الخدمة تُستدعى من متحكّم واحد فقط؛ الوسيط الرابع اختياري؛ الويب الحالي لا يرسل `base_revision` فيعمل كما كان؛ لا تغيير في شكل الاستجابة الناجحة (`data` كما هو).
- **لا أسرار ولا محتوى مخطط في السجلات:** المقياس يحوي معرّفات وrevision فقط.

## 6) المخاطر والملاحظات

| الخطر / الملاحظة | التقدير والتخفيف |
|---|---|
| المسار القديم بلا `base_revision` ما زال آخر-كتابة-تفوز | مقصود انتقالياً (AD-01). يُغلق بـS01b ثم S01-INV ثم S01c بموافقتك |
| المقياس سجلّ نصي لا عدّاد مؤشرات | كافٍ لحصر المسارات (S01-INV)؛ لا بنية مقاييس جديدة هنا |
| تنافس القفل | صف واحد لكل تطبيق ولحظات قصيرة؛ التحقق البنيوي خارج القفل؛ لا قفل على جداول أخرى |
| `integer` في Laravel يقبل النصوص الرقمية (`"3"`) | مقبولة وتُحوَّل إلى عدد؛ المنطقي مرفوض صراحةً |
| إضافة ملف JSON في `contracts/app-builder/` يطلق `mobile-ci` (مساره يشمل هذا المجلد) | متوقع؛ لا تغيير في Flutter. نتيجته مذكورة في §7 |
| الاختبار الكامل محلياً | 26 فشلاً بيئياً (`bcmath`) في اختبارات الوقود فقط؛ المجموعة الكاملة خضراء في CI على SQLite وPostgreSQL |

## 7) CI

كل الفحوص **خضراء (11/11)** على Head `23b013d7dc39432e3cdea5c92125de47be7427e2`:

| الفحص | النتيجة |
|---|---|
| `php artisan test (L11, sqlite)` — المجموعة الكاملة | ✅ نجاح |
| `php artisan test (L11, pgsql)` — المجموعة الكاملة (بما فيها اختبارات التزامن) | ✅ نجاح |
| `CI Gate` | ✅ نجاح |
| `web build (Next.js)` (push وPR) | ✅ نجاح |
| `mobile (analyze + test)` (push وPR) | ✅ نجاح |
| `mobile (Android release build proof)` (push وPR) | ✅ نجاح |
| `mobile (iOS release build proof)` (push وPR) | ✅ نجاح |

روابط التشغيل: `actions/runs/41102578619` (CI) · `41102578705` (CI Gate) · `41102578663` (Web CI) · `41102578734` (Mobile CI). ويثبت `mobile (analyze + test)` الأخضر خط أساس Flutter الذي لم أستطع تشغيله محلياً.

## 8) ما لم يُنفَّذ عمداً (وفق قرارك)

- **S01b** (حوار التعارض، المسودة المحلية، حارس المسار، حجب `manage`، الاستعادة بالـrevision).
- **S01-INV** (تقرير حصر مسارات الحفظ/الاستعادة/التحقق).
- **S01c** (فرض 428) — لا يبدأ قبل اكتمال الحصر وموافقتك.
- أي شريحة أخرى أو تطوير لـApp Factory.

## 9) الخطوة التالية المقترحة (بعد مراجعتك)

مراجعة هذا الـPR ← S01b (ويب) ← S01-INV ← قرارك بشأن S01c. لا شيء منها يبدأ قبل موافقتك.
