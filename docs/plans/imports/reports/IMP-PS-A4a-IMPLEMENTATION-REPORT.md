# IMP-PS-A4a — Implementation Report (قائمة كشوف الأطراف + معالج الاستيراد)

**الحالة:** منفَّذة، PR مفتوح للمراجعة، **غير مدموج وغير منشور.** لم تبدأ PS-A4b/A4b0/A4c–e ولا Track B ولا POLICY-0.
**المصدر:** `docs/plans/imports/AWJ_IMP_PS_A4_UI_EXECUTION_PLAN.md` §§2, 3, 4, 7 (PS-A4a), 8, 9 + Handoff PS-A4a.

| | |
|---|---|
| Branch | `claude/ps-a4a-ui-list-import-wizard` |
| PR | يُسجَّل في رسالة التسليم (رابطه مذكور هناك) |
| Base SHA | `b6aba44333c49354611ffb2638b620eb9346904d` (`main` وقت البدء = PR #1982) |
| Head SHA (كود) | `d6099bb8f6a630c28559f383f3d8971862a8a6a9` |
| Head SHA (بعد هذا التقرير) | في رسالة التسليم/الـPR (الملف لا يحمل SHA التزامه) |

## 1. ما نُفِّذ

| البند | التفصيل |
|---|---|
| `/partner-statements` | قائمة N1: بحث بتأخير 350ms، فلاتر (الحالة متعدّدة، الدور، الطرف ببحث خادمي، الفترة، الفرع)، فرز خادمي عبر رأس العمود ومنتقٍ على الجوال، ترقيم 25/50، شارات حالة، بطاقات `mobileRecord` للجوال، الرابط يعكس الفلاتر. **العدّاد والترقيم من `meta` الخادم فقط** (لا تصفية/عدّ محلي). حالات: تحميل · فراغ · فراغ مفلتَر · خطأ + إعادة · موقوفة · معطّلة · بلا صلاحية. |
| `/partner-statements/import` | 6 خطوات: ملف (فحص تلقائي) ← الطرف والفترة والنطاق والسياسات المجمَّدة ← مطابقة الأعمدة (+`MappingPresetBar`) ← معاينة (≤200 صف) ← تأكيد بإقرار صريح + `ImportJobStatusPanel` ← نتيجة. التكرار: `already_imported` (المعاينة) و`replayed` (النتيجة) برابط واضح. |
| اكتشاف الوحدة | عنصر شريط جانبي في «الحسابات» بـ`appKey: accounting.partner_statements` + `permission: partner_statements.view`؛ `RESUME_ROUTES.partner_statement` في `ImportHub` وتعديل متعمَّد لعقد `catalog.test.ts` (حُذف استثناء `noWizardYet`). |
| الانتقال بعد الاستيراد | لا صفحة تفاصيل قبل A4b، فالرابط `/partner-statements?highlight=<id>`: القائمة تقرأ رأس المقارنة (N2) وتعرضه في شريط تنبيه (رفض موحَّد إن لم يعد متاحاً). لا رابط مكسور ولا ادّعاء إجراءات A4b. |
| i18n | نطاق جديد `partnerStatements` (ar/en، 203 مفاتيح لكل لغة) منفصل عن `partnerStatement` القديم؛ مفتاح `nav.partnerStatements`. |

الملفات: `web/src/modules/partner-statements/**` (contract · client · list-query · errors · capability · columns · PartnerPicker · PartnerStatementsList · import-wizard/*) · `web/src/app/(app)/partner-statements/{page,import/page}.tsx` · `sidebar.tsx` · `imports/catalog.{ts,test.ts}` · `messages/{ar,en}.json` (إضافات فقط) · `web/e2e/partner-statements-a4a.spec.ts`. **لا ملف PHP ولا هجرة ولا مسار ولا صلاحية.**

## 2. التحقق من العقود (قبل الكود)

| العقد | النتيجة |
|---|---|
| N1 `GET partner-statement-reconciliations` | مفاتيح `status[]`, `partner_id`, `role`, `period_from/to`, `branch_id`, `q`, `sort` (قائمة بيضاء من 7)، `per_page≤50`, `page`؛ المجهول ⇒ 422. الواجهة تُسقط كل قيمة غير صالحة قبل الإرسال ولا ترسل فترة معكوسة. |
| N2 | يُستعمل لشريط «تم استيراد الكشف». |
| `apply_result.reconciliation_id` | **مؤكَّد**: `{reconciliation_id, created, updated, skipped, replayed, lines, total_rows}` من `PartnerStatementImportService::result()` عبر `ImportJobService` (`apply_result = chunk->result`). `replayed:true` عند إعادة الملف نفسه. |
| Mapping Presets | **مدعومة**: `ImportMappingPresetController` يتحقق من `ImportJobDomain::values()` ويحرس بـ`partner_statements.reconcile` + بوابة القدرة؛ لا سياسات تشغيل في المطابقة المحفوظة ⇒ أُعيد استعمال `MappingPresetBar` كما هو. |
| الصلاحيات | `Rbac::PERMISSIONS` يتضمن الأربع (`view/reconcile/close/void`) ⇒ تظهر في `meta.permissions` لشاشة `/roles` (التجميع حسب أول مقطع، لا قائمة تسميات ثابتة)؛ `/me` يعيد `Rbac::permissionsForRole` (المحسوبة من جدول الأدوار). **لا عائق، ولا تعديل مطلوب.** |
| حالة القدرة | `nav-state` منطقي فقط؛ `suspended` يُقرأ من `GET /applications` (لمن يملك `apps.view`) ثم من 403 الفعلي (رسالة `معلّقة`/`غير مفعّلة`). |

## 3. الأمان وعدم التسريب

* **لا نداء غير مصرَّح به:** بلا `view` ⇒ لا طلب قائمة/فروع/رأس؛ بلا `reconcile` ⇒ لا طلب استيراد؛ القدرة معطّلة ⇒ لا طلب قائمة. الطلبات تنتظر `capability.settled` (اكتُشف بـE2E أن طلب القائمة كان يسبق وصول حالة «معطّلة» فعولج).
* **أولوية الحالة:** `nav-state=false` يغلب `status=enabled` في `/applications` (الاستحقاق التجاري المفقود)؛ اكتُشف وأُصلح بالاختبار.
* **عدم التسريب في الأخطاء:** «الطرف غير متاح» و«الفرع خارج نطاقك» يُترجمان لرسالة واحدة (`unavailable`) كي لا تُضخّم الواجهة فارقاً قائماً في الخادم (F1 في تقرير A4a0)؛ لم أُعِد أي oracle من #1974/#1978. الخطأ المجهول يسقط إلى رسالة عامة بحسب الحالة **ولا يُعرض نص الخادم الخام أبداً** (اختبار بنص `SQLSTATE`). رسائل صفوف المعاينة وحدها تُعرض كما ترد (وصف بيانات الملف نفسه).
* **المقيَّد بفروع:** لا خيار «المؤسسة كلها»، فروعه فقط، والفرع إلزامي.
* **الأرقام:** `formatMinor` (هللات→ريال بحساب صحيح، كسران، en-US) وكل مدخل رقمي يُحوَّل لاتينياً؛ كل قيم ICU العددية تُمرَّر نصوصاً؛ اختبار يمنع الأرقام العربية-الهندية في الكتالوجين وفي DOM.

## 4. الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| Vitest الوحدة (7 ملفات: contract · list-query · errors · capability · wizard-state · RTL list · RTL wizard) | **84 ناجحاً** |
| Vitest الكامل `npm test` | **847 ملفاً / 10011 اختباراً ناجحاً** |
| `npm run build` (Next 15.5) | ✓ ناجح؛ `/partner-statements` 5.22 kB، `/partner-statements/import` 8.49 kB |
| Playwright `partner-statements-a4a.spec.ts` (سطح مكتب 1440 + جوال 390) | **34/34** |
| `tsc --noEmit` | 55 خطأ **سابقة** في ملفات أخرى (متطابقة قبل/بعد التغيير)؛ صفر في الملفات المضافة |
| ESLint | لا إعداد ESLint في المستودع (`next lint` تفاعلي) ⇒ لم يُشغَّل |
| تجارب تحوير (Mutation) | إزالة إلزام الفرع، إزالة شرط الإقرار، فصل رسالة الفرع عن الطرف ⇒ كل منها أسقط اختباراً |

تغطية E2E: المسار الكامل ar/en (رفع ← فحص ← معاينة ← إنشاء تشغيلة ← تطبيق ← رابط المقارنة، مع ترتيب النداءات `inspect → preview → import-jobs → apply`) · التكرار · replayed · أخطاء الصفوف · قدرة موقوفة/معطّلة · 403 فعلي · بلا صلاحية · عرض فقط بلا أي POST · مقيَّد بفرع · لوحة المفاتيح · RTL/LTR · فاتح/داكن · عدم التجاوز الأفقي · أرقام لاتينية.

**CI:** يُسجَّل في الـPR (يعمل Web CI على الدفع؛ لم أُعدِّل Backend فلا اختبارات PHP مطلوبة).

## 5. الأدلة البصرية

اللقطات في `docs/plans/imports/reports/assets/IMP-PS-A4a/` (اصطناعية، بلا بيانات حقيقية): `list-ar-desktop-light` · `list-ar-mobile-light` · `list-ar-mobile-dark` · `list-en-desktop-dark` · `list-suspended-mobile` · `list-disabled-desktop` · `wizard-ar-preview-mobile` · `wizard-en-confirm-desktop` · `wizard-duplicate-mobile` · `wizard-branch-restricted-mobile` · `wizard-ar-result-mobile` · `wizard-errors-desktop`. (المجموعة الكاملة 36 لقطة تُولَّد بـ`PS_A4A_SHOTS=<dir> npx playwright test e2e/partner-statements-a4a.spec.ts`.)

مشاكل بصرية رُصدت وأُصلحت: اقتطاع/عكس فترة التاريخ في بطاقة الجوال (RTL) ورأس المعاينة (عزل `dir`)، ومحاذاة اسم عربي في صفحة إنجليزية (`bdi`).

## 6. لا أثر مالي
لا قيد/مستند/دفعة/رصيد/مخزون/ZATCA؛ لا استدعاء لـ`LedgerService`؛ لا كتابة خارج `/import-jobs` القائم. وسم ثابت «مقارنة فقط» في القائمة والتأكيد.

## 7. مخاطر وملاحظات للمراجعة

| # | البند | الأهمية |
|---|---|---|
| 1 | **كشف `suspended` للقائمة** يعتمد على `GET /applications` (يتطلب `apps.view`)؛ لغيره تظهر الحالة بعد أول رفض 403 فقط (الاستيراد). القراءة تبقى تعمل. بديل أدقّ يحتاج حقل حالة في `nav-state` (تغيير backend خارج النطاق). | منخفضة |
| 2 | تصنيف 403 بنص الرسالة العربية (`معلّقة`/`غير مفعّلة`) لأن `EnsureApplicationActive` لا يعيد `reason`. هشّ أمام تغيير الصياغة؛ يحرسه اختبار. التوصية: إضافة `reason` في الحارس لاحقاً. | متوسطة |
| 3 | `PartnerPicker`: بحث خادمي بسقف 50 نتيجة بلا ترقيم؛ كافٍ للبحث بالاسم، ولا يعرض «المزيد». | منخفضة |
| 4 | الرابط بعد الاستيراد إلى القائمة لا إلى تفاصيل (A4b). عند بناء `/partner-statements/[id]` يُبدَّل `reconciliationHref` وحده. | معلومة |
| 5 | لم يُضَف كيان `partner_statement` إلى بطاقات `ImportHub` (عقد الاختبار يشترط `permission` منتهياً بـ`.manage` بينما صلاحيته `reconcile`)؛ أُضيف مسار الاستئناف فقط كما في الـHandoff. القرار للمالك. | منخفضة |
| 6 | رسائل صفوف المعاينة (ومنها نص الماسح `file.*`) عربية فقط من الخادم؛ لا ترجمة إنجليزية لها دون تغيير backend. | منخفضة |
| 7 | الصفحة تعرض شارة «تحميل» حتى تُقرأ حالة القدرة؛ في وضع demo لا نقاط نهاية وهمية لهذه الوحدة (غير مدعوم). | معلومة |
| 8 | بيئة التطوير تطبع خطأ `INVALID_KEY` سابقاً في `developer.events` (مفاتيح بها نقطة) — موجود على `main` ولا علاقة له بهذا العمل. | معلومة |

## 8. التوصية التالية
مراجعة بشرية للـPR ثم قرار الدمج. الشريحة التالية المقترحة: **PS-A4b** (مساحة المطابقة) بعد بوابة البحث البصري (D-A4-09)؛ A4b0 ما زالت بانتظار D-A4-04د وعتبة الأداء. لا شيء من ذلك بُدئ.
