# AIA-0.4 — تقرير التنفيذ: سقف صلاحيات إصدار مفاتيح Public API (D-08، أمني P0)

**الحالة:** مُنفَّذ، جاهز لمراجعة PR. **لا Merge ولا Deploy ولا تفعيل لسياسة الاستقلالية.**
**الفرع:** `claude/awj-aia-0-4-scope-ceiling` · **الأساس (`main`):** `44029e38df2ea4ffa0c76b96c3ed5228a5b70915`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/2031 · **Head SHA:** الرأس الأصلي الذي نجح CI عليه `f1b876a006a688d134af640a45e10be87e1ad57b`، وبعده commit معالجة ملاحظة المراجعة الأمنية (القسم 9). الرأس النهائي ونتائج CI عليه تُسجَّل في وصف الـPR وفي رد التسليم (لا يستطيع تقرير داخل الـPR أن يذكر SHA الـcommit الذي يحويه ولا نتائج CI التي تعمل بعده).
**المرجع:** `AIA-0.4-acceptance-addendum.md` (أول commit في الفرع) · Roadmap §1.1/§1.1b · Gates G-S2 · PR #2030.

---

## 1) الثغرة وسببها الجذري

**الثغرة:** مستخدم بصلاحيات محدودة يستطيع إصدار مفتاح Public API بـscope يقابل صلاحية **لا يملكها هو**، ثم يقرأ به بيانات يُحجب عنها داخلياً. أُثبت المسار كاملاً في PR #2030 (`PublicApiScopeCeilingProofTest`): مستخدم بدور مخصّص `developer.manage` دون `reports.view` ⇒ إصدار `statements:read` (201) ⇒ قراءة كشف حساب (200) بينما يُرفض داخلياً (403).
**الشروط (لعدم المبالغة):** يتطلب تفويض المالك `developer.manage` لدور محدود (لا يملكها دور مدمج غير owner/admin)، ويقع داخل المستأجر الواحد.

**السبب الجذري (ثلاثة عناصر تجتمع):**
1. `PublicApiScope::permission()` (إسقاط scope ← صلاحية RBAC) كانت **غير مستدعاة في أي مكان**.
2. مسارات الإصدار (`DeveloperApiClientController::store/issueKey` وأمر `public-api:create-client`) تتحقق من الصلاحية على **المسار** (`developer.manage`) لا على **ما يُمنح** (الـscopes المطلوبة)، ثم تستدعي `ApiClientKeyService::issueKey` الذي لا يفحص إلا أن الـscope معروف.
3. `EnsureApiScope` وقت الاستعمال يتحقق من عضوية الـscope في المفتاح فقط (لا مستخدم خلف المفتاح)، فسقف المفتاح هو كل ما يحمله.

## 2) الإصلاح الفعلي

**المبدأ:** لا يستطيع المستخدم إصدار مفتاح بصلاحيات تتجاوز صلاحياته الفعلية. الطلب الذي يحوي scope واحداً غير مصرَّح به **يُرفض كاملاً** قبل أي كتابة: لا عميل ولا مفتاح ولا سرّ.

| المكوّن | الدور |
|---|---|
| `App\Support\PublicApiScopeCeiling` (نقي) | يقارن صلاحيات المُصدِر بصلاحية كل scope عبر `PublicApiScope::permission()` وبالمقارنة نفسها المعتمدة لسقف منح الأدوار `Rbac::covers` (حامل `*` يغطّي كل شيء). scope مجهول ⇒ ممنوع (فشل مغلق) |
| `App\Services\PublicApiKeyIssuanceGuard` | نقطة التحقق الوحيدة. يحلّ صلاحيات المُصدِر **داخل سياق مستأجره هو** (ويعيد سياق الطلب كما كان)، فلا تُقرأ صلاحية دور بالاسم نفسه من مستأجر آخر |
| `PublicApiScopeCeilingException` | 403 بجسم `{message, reason: "scope_exceeds_issuer_permissions", denied_scopes[]}` — لا `secret` ولا `key` ولا `client` |
| `DeveloperApiClientController` | `store` و`issueKey` (مفتاح إضافي/تجديد لعميل قائم) يستدعيان الحارس **قبل أي كتابة**. `issueKey` يفحص بعد 404 المستأجر. نقطة جديدة للقراءة `GET /developer/issuable-scopes` (صلاحية `developer.view`) تعيد ما يجوز لهذا المستخدم منحه |
| `public-api:create-client` | **سياسة A:** `--issuer` إلزامي (بريد أو UUID لمستخدم **نشط** من المستأجر نفسه) ويُشترط أن يملك **`developer.manage`** (سلطة الإصدار نفسها في واجهة المطوّر — القسم 9) ويُطبَّق سقف الـscopes؛ الرفض قبل إنشاء أي عميل. **B** مؤجَّل: لا `--operator` ولا بوابة. **C** مغلق: لا مسار بلا `--issuer` |
| الواجهة (`ScopePicker` + `KeyFormDialog`) | تجلب `issuable-scopes` وتعطّل ما يتجاوز الصلاحيات مع شارة «خارج صلاحياتك». **للعرض فقط**: فشل الجلب ⇒ لا تعطيل والخادم يبقى المرجع ويعرض رسالة الرفض |
| CI | خطوة صارمة `AIA-0.4 — قبول سقف صلاحيات المفاتيح` في وظيفة test (SQLite وPostgreSQL) بـ`--fail-on-incomplete --fail-on-skipped --fail-on-risky` على ملفات الاختبار الثلاثة |

**ما لم يتغيّر عمداً:** `ApiClientKeyService::issueKey` (يبقى بلا سقف لاستعمال الاختبارات والتهيئة الداخلية)، `EnsureApiScope`، عقود Public API، `PublicApiScope::all()` وقيمه، تنسيق استجابة الإصدار الناجحة (`secret`/`key`/`client`)، المفاتيح القائمة. يمنع الانحراف المستقبلي اختبار بنيوي: لا مستدعٍ إنتاجي لـ`issueKey/rotateKey` إلا ويمرّ بالحارس قبل الإصدار، ولا إنشاء توكن `ApiClient` خارج `ApiClientKeyService`.

## 3) سياسة CLI وأثرها على الأوامر القديمة

| الحالة | السلوك الآن |
|---|---|
| `public-api:create-client acme name --scopes=…` (بلا `--issuer`) | **يفشل** (رمز خروج 1) برسالة تطلب `--issuer`؛ لا عميل ولا مفتاح |
| `--issuer` غير موجود / معطَّل / من مستأجر آخر | يفشل |
| `--issuer` بلا `developer.manage` (حتى لو يملك الصلاحية المقابلة للـscope) | **يفشل** ويسمّي `developer.manage`؛ لا أثر (القسم 9) |
| `--issuer` بلا الصلاحية المقابلة لأي scope | يفشل ويسمّي الـscopes المرفوضة؛ لا أثر |
| `--issuer` مخوَّل (أو owner/admin) | ينجح؛ يُطبع `issuer` مع السرّ مرة واحدة |
| `--operator` أو أي استثناء إداري | غير موجود (خيار مجهول) |

**فحص التوافق قبل التعديل (قراءة مستودع):** لا جدولة ولا `entrypoint.sh` ولا `render.yaml` ولا `Dockerfile` ولا أي workflow ولا سكربت ولا اختبار يستدعي الأمر؛ المرجع الوحيد مثال في `docs/audits/AWJ-AI-API-FIRST-INTEGRATION-REPORT.md` (حُدِّث ليحمل `--issuer`). **أثر على الأوامر القديمة:** كل استدعاء يدوي/خارجي بالصيغة القديمة سيفشل حتى يُضاف `--issuer`. **غير مُتحقَّق منه:** سكربتات خارج المستودع (Railway shell، دفاتر تشغيل، تاريخ أوامر المشغّلين).

## 4) التوافق الخلفي

- المفاتيح القائمة **لا تُلغى ولا تتغيّر scopes ولا صلاحيات استعمالها** (اختبار يصدر مفتاحاً بالمسار القديم بـscopes تتجاوز أي مُصدِر محدود، ثم يثبت أنه يقرأ وأن عباراته كما هي).
- لا تغيير في عقود Public API ولا في OpenAPI (النقطة الجديدة داخلية في `/api/developer`).
- لا هجرات. لا تعديل لـ`SpreadsheetWriter` أو `Money::toRiyal` أو أي منطق محاسبي.
- الإصدار بصلاحيات مطابقة يعمل كما كان للمالك والمدير ومن يحمل الصلاحية المقابلة. المتأثر فقط: من كان يُصدر scope يتجاوز صلاحياته (وهو المقصود)، وأوامر CLI بلا `--issuer`.

## 5) الاختبارات

**اختبارات القبول (32 اختباراً، 2387 تأكيداً، صارمة بلا skip/incomplete — بعد القسم 9):** `PublicApiScopeCeilingEnforcementTest` (19) · `PublicApiCreateClientCommandCeilingTest` (10) · `PublicApiScopeCeilingArchitectureTest` (3) — المجموعة `aia-0-4-security`.

| المطلب | الاختبار |
|---|---|
| 1 مستخدم محدود ← `statements:read` دون `reports.view` ← رفض | `a_limited_user_cannot_issue_statements_read_without_reports_view` |
| 2 قراءة فقط ← scope كتابة ← رفض | `a_user_with_only_view_permissions_cannot_issue_a_write_scope` ×4 (`partners/products/invoices/webhooks:write`) |
| 3 مسموح + ممنوع ← رفض كامل | `a_mixed_request_is_rejected_entirely_with_no_partial_issuance` (+ CLI) |
| 4 Owner/Admin | `owner_and_admin_can_issue_every_known_scope` + ثبات حامل الصلاحية + `accountant/staff` ممنوعان من الأساس |
| 5 مفتاح إضافي لعميل قائم | `an_additional_key_for_an_existing_client_obeys_the_same_ceiling` |
| 6 CLI بلا مُصدِر مخوَّل | 6 اختبارات: بلا `--issuer`، مُصدِر مجهول/معطَّل/أجنبي، بلا صلاحية، ناجح (بريد غير حساس لحالة الأحرف وUUID)، بلا `--operator` |
| 7 لا Secret ولا سجل عند الرفض | `assertRejectedWithoutTrace`: 403 + `reason` + `denied_scopes` + غياب `secret/key/client` + **عدّاد العملاء والتوكنات لم يتغيّر** |
| 8 المفاتيح القديمة تعمل | `keys_issued_before_the_fix_keep_working_and_keep_their_scopes` |
| 9 عزل المستأجر | `tenant_isolation_is_preserved_for_issuance` (404 لعميل مستأجر آخر؛ دور بالاسم نفسه في مستأجرين يُحلّ من مستأجر المُصدِر) |
| حرّاس بنيوية | لا مستدعٍ إنتاجي بلا حارس؛ لا إنشاء توكن خارج الخدمة؛ لا `skip/incomplete` والملفات ضمن المجموعة |

**تحقق من أن الاختبارات رافضة فعلاً:** بإعادة المتحكم والأمر القديمين مؤقتاً في نسخة البناء `nibras-app` (ليس المستودع) فشل **16 من 27** (كل اختبارات الرفض) ونجح 11 (خطوط الأساس واختبارات الثبات)، ثم استُعيدت النسخة وتطابقت مع المستودع.

**الويب (vitest):** `scope-picker` (اختباران جديدان: تعطيل ما خارج السقف وعدم إصداره، وعدم التعطيل حين السقف مجهول) + بقية اختبارات `components/developer` و`developer.test.ts` و`i18n-keys` — ناجحة. `tsc --noEmit` بلا أخطاء في ملفات الميزة.

**نتائج SQLite محلية:** المجموعة الصارمة 27/27 بخروج 0 مع `--fail-on-incomplete --fail-on-skipped --fail-on-risky`. حزمة انحدار مرشَّحة (`PublicApi|Developer|Rbac|Role|Permission|ApplicationCatalog|ApiClient`): 686 ناجحاً، و6 إخفاقات كلها في وحدة الوقود لغياب `bcmath` محلياً (معروف، ينجح في CI).
**PostgreSQL وCI الكامل:** تُسجَّل في وصف الـPR وفي رد التسليم بعد اكتمال التشغيل (لا أستطيع تشغيل PostgreSQL محلياً). لا شيء في الإصلاح خاص بقاعدة بيانات (استعلامات Eloquent قياسية، و`lower(email)` مدعومة في المحركين).

## 6) الملفات

**جديد:** `app/Support/PublicApiScopeCeiling.php` · `app/Support/PublicApiScopeCeilingException.php` · `app/Services/PublicApiKeyIssuanceGuard.php` · `tests/Feature/PublicApiScopeCeilingEnforcementTest.php` (محوَّل من `PublicApiScopeCeilingProofTest`) · `tests/Feature/PublicApiCreateClientCommandCeilingTest.php` · `tests/Feature/PublicApiScopeCeilingArchitectureTest.php` · `docs/ai/AIA-0.4-acceptance-addendum.md` · هذا التقرير.
**معدَّل:** `app/Http/Controllers/Api/DeveloperApiClientController.php` · `app/Console/Commands/PublicApiCreateClientCommand.php` · `routes/api.php` (مسار قراءة واحد) · `.github/workflows/ci.yml` (خطوة صارمة واحدة) · `web/src/lib/developer.ts` · `web/src/components/developer/scope-picker.tsx` · `web/src/components/developer/keys/key-form-dialog.tsx` · `web/src/components/developer/__tests__/scope-picker.test.tsx` · `web/src/messages/{ar,en}.json` (مفتاح واحد) · وثائق: Roadmap وGates (نقل متطلبات CSV إلى AIA-2.2) و`AWJ-AI-API-FIRST-INTEGRATION-REPORT.md` (مثال CLI).
**حُذف:** `tests/Feature/PublicApiScopeCeilingProofTest.php` (حلّ محلَّه اختبار الرفض الصارم).
**لم يُمسّ:** `SpreadsheetWriter`، `Money`، المحاسبة، الهجرات، `EnsureApiScope`، `ApiClientKeyService`.

## 7) المخاطر والمتبقي

| # | البند | التفصيل |
|---|---|---|
| 1 | أوامر CLI خارج المستودع | ستفشل بلا `--issuer`؛ لم أستطع التحقق من وجودها |
| 2 | مفاتيح قائمة تتجاوز سقف مُصدِرها | تبقى فعّالة بقرار التوافق الخلفي؛ **تقرير القراءة فقط** الذي يسردها لم يُنفَّذ بعد (يحتاج ربط المفتاح بمُصدِره، وهو غير مسجَّل اليوم — يرتبط بتصميم AIA-0.6a/ختم المصدر). المفاتيح القديمة لا تُعرف هوية مُصدِرها |
| 3 | سقف الاستعمال | الإصلاح يضبط **الإصدار** فقط؛ صلاحيات المُصدِر بعد الإصدار لا تُراقَب (سحب صلاحية المستخدم لا يغيّر مفاتيحه). قرار ربط المفتاح بمُصدِره مؤجَّل |
| 4 | الخيار B للـCLI | لم يُنفَّذ؛ لا مسار إداري طارئ حتى وجود سجل تدقيق |
| 5 | تعدد الفروع | المفتاح ما زال CompanyWide (D-09 مؤجَّل) |
| 6 | قراءة الأدوار الحيّة | السقف يُحلّ وقت الإصدار من جدول الأدوار؛ تغيير الدور بعده لا يمسّ المفتاح |
| 7 | تغيير سلوك | الواجهة تعطّل scopes جديدة لمن لا يملكها؛ مستخدمون كانوا يتجاوزون الآن يرون الرفض (مقصود) |
| 8 | CSV | خارج النطاق: يبقى `SpreadsheetWriterNegativeAmountReproTest` على حاله (incomplete معلَن) إلى AIA-2.2 |

## 8) الخطوة التالية

1. مراجعة PR وقرارك على الدمج (لا Merge ولا Deploy من جهتي).
2. بعد الدمج: ضبط تواصل مع مشغّلي أي أوامر CLI خارجية (إضافة `--issuer`).
3. شريحة لاحقة منفصلة: ربط المفتاح بمُصدِره (تصميم AIA-0.6a) لتمكين تقرير المفاتيح المتجاوزة وإبطال اختياري بقرار مستقل.
4. ثم المسار المخطَّط: AIA-0.1 (غلاف السلامة المالية) بعد حسم D-12.

---

## 9) ملاحظة مراجعة أمنية على PR #2031 — سلطة `developer.manage` في CLI

**الملاحظة (من المراجعة):** `PublicApiCreateClientCommand` كان يتحقق من سقف الـscopes عبر `PublicApiKeyIssuanceGuard` لكن **لا يتحقق من `developer.manage`** للمستخدم المحدد بـ`--issuer`.

**الإثبات قبل أي تعديل (اختبار رفض صارم يفشل على الكود المسلَّم `f1b876a0`):** تشغيل `PublicApiCreateClientCommandCeilingTest` بالاختبارات الجديدة على الكود السابق أعطى **3 إخفاقات من 10**:
| الاختبار | النتيجة على الكود السابق |
|---|---|
| مُصدِر نشط يملك `partners.view` فقط ⇒ `--scopes=partners:read` | **أُصدر المفتاح** (كان يجب الرفض) — الملاحظة **صحيحة** |
| مُصدِر يملك `developer.view`+`partners.view` دون `developer.manage` | **أُصدر المفتاح** |
| دور بالاسم نفسه في مستأجرين، أحدهما بلا `developer.manage` | **أُصدر المفتاح** للمستأجر الذي بلا الصلاحية |
والاختبار الإيجابي (مُصدِر بـ`developer.manage`+`partners.view`) نجح قبل الإصلاح وبعده.

**هل CLI مستثنى عمداً؟ لا.** لا عقد موثَّق يستثنيه: ملحق القبول والخطة (A) نصّا على «التحقق من صلاحيات المستخدم» بنموذج واجهة المطوّر، وهذه تشترط `developer.manage` على الإصدار عبر وسيط المسار. ما كان موثَّقاً لـCLI هو *الإزالة المستقبلية* للتجاوز (B)، لا الإعفاء من سلطة الإصدار. فالسلوك السابق ثغرة تنفيذ لا قراراً.

**الأثر:** مُصدِر مسجَّل في المستأجر بصلاحيات محدودة كان يستطيع عبر CLI (وصول خادم) إصدار مفتاح بـscopes تقابل صلاحياته القرائية حتى بلا سلطة إدارة المفاتيح، وهو ما تمنعه الواجهة. الأثر محدود بمن يملك وصول CLI، لكنه يناقض تماثل النموذجين.

**الإصلاح (مقتصر على الملاحظة):**
- `PublicApiKeyIssuanceAuthority::PERMISSION = 'developer.manage'` ثابت واحد مشترك (لا نموذج تفويض ثانٍ).
- `PublicApiKeyIssuanceGuard::mayIssue(User)`: يحلّ صلاحيات المُصدِر داخل سياق مستأجره (كسقف الـscopes) ويشترط `developer.manage` أو `*`.
- `assertIssuable()` (مسار REST) صار يتضمن الشرط أيضاً **دفاعاً بالعمق** لا ثقةً بوسيط المسار وحده؛ يرمي `PublicApiScopeCeilingException` بسبب مستقل `issuer_lacks_developer_manage` (403).
- CLI: `mayIssue` قبل `denied`، وقبل إنشاء أي عميل؛ رسالة تسمّي `developer.manage`؛ رمز خروج 1.
- الحارس البنيوي يشترط الآن أن كل مستدعٍ إنتاجي لـ`issueKey` يمرّ بـ`assertIssuable` أو `mayIssue` قبل الإصدار.

**الاختبارات المضافة (5):** CLI — رفض `partners.view` فقط · رفض `developer.view` دون `manage` · نجاح `developer.manage`+`partners.view` · حلّ الصلاحية من دور مستأجر المُصدِر لا من دور بالاسم نفسه في مستأجر آخر؛ الحارس — `mayIssue` مستقل عن وسيط المسار (owner وreader يملكانها، وholder بلا سلطة يُرفض بسبب مستقل). نتيجة محلية (SQLite): 32/32 بـ`--fail-on-incomplete --fail-on-skipped --fail-on-risky`؛ 45 اختباراً مجاوراً (`DeveloperApiClientManagementTest` وغيره) ناجحة. PostgreSQL وCI الكامل: في وصف الـPR بعد التشغيل.

**التوافق الخلفي والنطاق:** لا تغيير في المفاتيح القائمة ولا في عقود Public API ولا في استجابة الإصدار الناجحة؛ الأثر الجديد الوحيد أن مُصدِراً بلا `developer.manage` يُرفض في CLI (كما في الواجهة). عزل المستأجر محفوظ (الصلاحية من دور مستأجر المُصدِر). لا هجرات ولا تغيير آخر.
