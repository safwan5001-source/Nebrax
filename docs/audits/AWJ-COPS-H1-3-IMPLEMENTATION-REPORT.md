# COPS-H1-3 — Implementation Report (أساس إعدادات تشغيل القناة: القبول)

| البند | القيمة |
|---|---|
| Slice | COPS-H1-3 — `commerce_channel_operation_settings` (مفاتيح القبول فقط) + `GET|PUT commerce/channels/{id}/operations-settings` |
| Branch | `claude/cops-h1-3-operations-settings` |
| Base SHA | `790eff709e8c6ba673d30c0739a5eba3cc5e2dfe` (`origin/main` بعد دمج H1-2) |
| PR / Head SHA / Merge SHA | تُسجَّل في وصف الـPR وفي `AWJ_COPS_HORIZON_HANDOFF.md` (الملف لا يضمّن هاشه) |
| الحالة | Implemented → Merged عند اجتياز البوابات · Not deployed · Not activated · Not env-verified |
| العقد | `ADR-29` §2.5 + §2.5.1 · Revision 1 §1 (فصل أساس H1-3 عن امتداد H4-3) |
| قرارات المالك | تفويض COPS-H1-2/H1-3 الذاتي (2026-11-02): "reuse existing channel-settings and audit patterns · tenant and channel isolation · strict RBAC and safe defaults · versioning and concurrent-update protection · backward compatibility · لا مفاتيح H4" |

---

## 0. الخلاصة

- جدول **جديد إضافي** يحمل مفاتيح القبول الثلاثة و`version`؛ **غياب الصف = السلوك الحالي حرفياً** (لا صف لأي قناة قائمة، لا backfill، القراءة لا تكتب).
- **لا إنفاذ:** لا شيء في Checkout ولا الدفع ولا الإلغاء ولا المخزون ولا المحاسبة يقرأ الجدول (اختبار ساكن يمسح `app/` ويفشل لو قرأه أي ملف غير نموذجه وخدمته).
- **إعادة استعمال الأنماط القائمة:** قفل صف القناة (ADR-19 §2.3) كخدمة التسعير، التدقيق في `sales_channel_setting_events`، الصلاحية `commerce.channel_settings.manage`، استثناء `SalesChannelSettingsException`، نمط 428/409 لمسودة AD-01.
- **لا أثر مالي أو مخزني**، لا قيد، لا ZATCA. لا إعدادات H4 (إيقاف مؤقت/ساعات/حد أدنى/جهات تنبيه) ولا `auto_reject`.

## 1. ما نُفِّذ (الملفات)

| الملف | التغيير |
|---|---|
| `database/migrations/2026_12_29_010000_create_commerce_channel_operation_settings.php` | **جديد.** الجدول: `tenant_id` (FK cascade) · `sales_channel_id` (FK cascade، **فريد**) · `acceptance_mode` (`auto` افتراضي) · `acceptance_reminder_minutes`/`acceptance_escalation_minutes` (smallint، null) · `version` (افتراضي 1) · `updated_by_user_id` (FK nullOnDelete) · timestamps. **CHECK في PostgreSQL**: الوضع ∈ {auto, manual}، النسخة ≥ 1، الدقائق 1..1440، التصعيد ≥ التذكير. `down()` يرفض متى وُجد صف |
| `app/Models/CommerceChannelOperationSetting.php` | **جديد.** `CompanyWide`، `$fillable = []` (الكتابة بـforceFill من الخدمة وحدها) |
| `app/Services/Commerce/CommerceChannelOperationsSettingsService.php` | **جديد.** الكاتب الوحيد: `view()` (بلا أقفال) و`update()` (معاملة: قفل القناة ← قراءة الصف ← فحص النسخة ← التحقق ← الفرق ← كتابة + تدقيق) |
| `app/Http/Controllers/Api/CommerceStaffChannelOperationsSettingsController.php` | **جديد.** التحقق (يرفض المنطقي لأن `integer` في Laravel يقبل `true`)، 428، `tenant_id` محظور، أحدث 10 تغييرات `operations.*` |
| `app/Services/Commerce/SalesChannelSettingsException.php` | معامل اختياري `details` (افتراضي `[]`) ⇒ كل المستدعين القائمين بلا تغيير |
| `routes/api.php` · `tests/Feature/CommerceModuleBoundaryTest.php` | المساران (`commerce.channel_settings.manage` + `EnsureApplicationActive:commerce.storefront`) وتسجيلهما في سجل مسارات Commerce |
| `config/commerce.php` | `order_acceptance_enabled` (env `COMMERCE_ORDER_ACCEPTANCE_ENABLED`، **مغلق**) — بوابة R-6b |
| `tests/Feature/CommerceChannelOperationsSettingsTest.php` | **جديد، 18 اختباراً** (SQLite وPostgreSQL) |
| `tests/Feature/CommerceChannelOperationsSettingsPostgresTest.php` | **جديد، 5 اختبارات** تزامن وأقفال وقيود على PostgreSQL |
| `CLAUDE.md` · `ADR-29` §2.5.1 | توثيق العقد والقرارات التصميمية |

## 2. القرارات التصميمية (مع التعليل)

1. **طبقتان للحماية من التحديث المتزامن:** (أ) قفل صف القناة `FOR UPDATE` طوال القراءة والكتابة ⇒ كاتبان يتسلسلان ويرى الثاني نتيجة الأول؛ (ب) `expected_version` تفاؤلي **إلزامي**: لأن القفل وحده يمنع التزامن اللحظي لكن لا يمنع «الكتابة فوق ما لم يرَه المحرّر» عبر فاصل زمني. عدم تطابقه 409 بلا كتابة **حتى للطلب المطابق للقيم** (المحرّر لم يرَ آخر حالة) — لا نجاح صامت. غيابه 428 (نمط AD-01).
2. **404 قبل 428:** كتابة بلا نسخة على قناة مستأجر آخر تردّ 404 لا 428، فلا يُكشف وجود القناة.
3. **النسخة تزداد بتغيير فعلي فقط**، والطلب المطابق للافتراضيات على قناة بلا صف **لا ينشئ صفاً** (حتى لا يتحول «غياب الصف = اليوم» إلى «صف افتراضي» بلا قصد بشري).
4. **بوابة R-6b تحرس الإعداد لا الإنفاذ:** ضبط `manual` والبوابة مغلقة 409 `acceptance_deployment_disabled` (نمط `wholesale_deployment_disabled`)؛ الإبقاء على `manual` مخزَّن والتحويل إلى `auto` مسموحان دائماً؛ `effective_acceptance_mode` يعلن `auto` ما دامت مغلقة. هكذا لا يُفتح القبول اليدوي بإعداد وحده، وينتقل H1-4 بلا تغيير في الإعدادات.
5. **التدقيق في الجدول المشترك** بمفاتيح `operations.*` (لا جدول ثانٍ): تاريخ إعدادات القناة في مكان واحد، وسجل التدقيق ثابت لا يُحدَّث ولا يُحذف (نموذجه يرمي).
6. **الأمان البنيوي:** `$fillable` فارغ (لا تعبئة جماعية)، الفريد على القناة يحمي من صفين لو تجاوز أحدٌ القفل، CHECK في PostgreSQL يحمي من تجاوز الخدمة، والتحقق في الخدمة على المحرّكين (SQLite للاختبار فقط).
7. **FK القناة `cascade` لا `restrict`:** الإعداد ليس دليلاً تدقيقياً (الدليل في `sales_channel_setting_events`)؛ و`restrict` على جدول يُحذف مع المستأجر قد يتعارض مع حذف المستأجر المتسلسل.
8. **تفسير «strict RBAC»:** القراءة والكتابة كلتاهما بـ`commerce.channel_settings.manage` (owner/admin عبر `*` فقط؛ لا `MATRIX` ولا دور مخزَّن)، كما مسار التسعير؛ المحاسب والموظف 403.

## 3. الاختبارات والنتائج (محلياً)

| الفحص | النتيجة |
|---|---|
| `CommerceChannelOperationsSettingsTest` (18) SQLite | ✅ 18/18 (171 تأكيداً) — الافتراضيات والقراءة بلا كتابة، الإنشاء الأول والتدقيق، النسخة بتغيير فعلي، 428/409، البوابة (مغلقة/مفتوحة/أُغلقت لاحقاً)، التحقق من القيم، التصعيد ≥ التذكير بالمخزَّن، RBAC وتطبيق القدرة، العزل (مستأجر آخر/قناة غير ويب/محذوفة ناعماً/قنوات متعددة)، التوافق مع Checkout، المسح الساكن، الفريد، رفض التراجع |
| عيب كشفه الاختبار | قاعدة `integer` في Laravel تقبل `true` (تتحول إلى 1) ⇒ كانت `acceptance_reminder_minutes: true` تُخزَّن «دقيقة واحدة». رُفض المنطقي صراحةً على الحقول الثلاثة |
| `CommerceChannelOperationsSettingsPostgresTest` (5) PostgreSQL 16 | ✅ 5/5 ×5 تشغيلات (98 تأكيداً) — فائز واحد بالضبط من كاتبين بالنسخة نفسها (3 جولات) · 6 كتّاب بإعادة محاولة ⇒ سلسلة خطية، النسخة النهائية 6 وستة أحداث تدقيق، كل «من» فريد · الانتظار (لا جمود) خلف ممسك قناة-ثم-مِرساة (مسار الإتمام) وخلف ممسك مِرساة وحدها (الترقيم/الأستاذ) · 6 قيود CHECK ترفض القيم الشاذة وصف حدّي يُقبل |
| اختبارات الطفرة | ✅ إزالة قفل القناة تُفشل اختباري الفائز الواحد والسلسلة؛ إزالة فحص النسخة تُفشل ثلاثة اختبارات (SQLite وPostgreSQL) |
| الجناح الموسَّع على PostgreSQL (الإعدادات، سجل المسارات، BranchIsolationGuard، SalesChannelSettings، CommerceOrderFeed/Events، StaffOrder، Migration) | ✅ 215 ناجحاً، 1 متخطّى |

الجناح الموسَّع على SQLite والجناحان الكاملان وفحوص CI تُسجَّل من CI في وصف الـPR وHandoff.

## 4. الأمان وعزل المستأجر والقناة (تحقق)

- **RBAC:** `commerce.channel_settings.manage` فقط؛ accountant/staff ⇒ 403 على القراءة والكتابة؛ بلا رمز ⇒ نفس رفض مسار التسعير القائم؛ قدرة `commerce.storefront` معطَّلة ⇒ 403. admin يملكها عبر `*`.
- **العزل:** المستأجر من المستخدم المصادَق لا من الجسم (`tenant_id` محظور ⇒ 422)؛ قناة مستأجر آخر/غير موجودة/محذوفة ناعماً ⇒ 404 واحد (على القراءة والكتابة وكتابة بلا نسخة)؛ قناة غير ويب GET 404 وPUT 422؛ إعدادات كل قناة مستقلة؛ مستأجر آخر يكتب إعدادات قناته دون أثر على قناتنا.
- **لا أثر خارجي:** لا إشعار ولا تنبيه ولا إنفاذ؛ لا قيد ولا حركة مخزون ولا ZATCA ولا تغيير في الدفع أو الإلغاء أو Checkout (اختبار: طلب بإعداد `manual` مفتوح البوابة يبقى `confirmed` بحدث `order.placed` وحده).
- **المدخلات:** `expected_version` عدد صحيح ≥ 0؛ الدقائق 1..1440؛ الوضع `auto|manual`؛ المنطقي والكسر والنص غير الرقمي ⇒ 422.

## 5. المخاطر والمتبقي

| المخاطرة | المعالجة |
|---|---|
| التذكير والتصعيد مخزَّنان بلا مستهلك حتى H3-6 | مقصود (لا إنفاذ في H1-3)؛ يُعلن في الاستجابة والوثائق |
| `manual` مخزَّن لن يُنفَّذ قبل H1-4 والبوابة | `effective_acceptance_mode` يعلن `auto`؛ H1-4 يقرأ الفعّال لا المخزَّن |
| مفاتيح H4 (إيقاف/ساعات/حد أدنى/جهات) | خارج النطاق؛ H4-3 يضيفها بهجرة إضافية على الجدول نفسه |
| قيود CHECK غير موجودة على SQLite | الخدمة تتحقق على المحرّكين؛ SQLite للاختبار فقط |
| `expected_version` إلزامي يغيّر شكل أول استدعاء لأي عميل مستقبلي | لا عميل قائم (جدول وواجهة جديدان)؛ الواجهة (H1-5) تقرأ `version` ثم ترسله |

## 6. الخطوة التالية
دمج H1-3 بعد اجتياز البوابات، تسجيل الـSHA في Handoff والمتتبّع، **ثم التوقف**: H1-4 (القبول/الرفض) يبدأ بأمر صريح جديد من المالك بنموذج Opus.
