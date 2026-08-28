# POS Loss Prevention — Phase 3: Gap Matrix

> أُنجز هذا التدقيق على `main` بعد دمج PR #534 (Phase 2) وقبل كتابة أي كود لـ Phase 3.
> المرجع الوظيفي هو المهمة المرفقة `ClaudeCode_Nebrax_POS_Loss_Prevention_Phase3`. لا مصدر
> حقيقة موازٍ أُنشئ: القضايا والأدلة المرتبطة والملخص اليومي كلها تشير إلى `PosSessionEvent`
> و`PosException`/`PosRiskSnapshot` القائمة عبر معرّفات، ولا تنسخها ولا تعدّلها.

## المبدأ الحاكم

> **مؤشرات المراجعة والاستثناءات تساعد في ترتيب أولوية التحقيق، ولا تُثبت وحدها وجود مخالفة.**
> حالة التحقيق (`Case`) وثيقة عمل بشرية القرار: تُنشأ وتُحسم بفعل مستخدم مخوَّل، لا بحساب آلي.
> `Confirmed Loss` لا يُشتقّ أبداً من `Risk Score` أو من شدّة استثناء.

## مصفوفة الفجوات

| المتطلب (Phase 3) | الموجود في Phase 1/2 | الفجوة | قرار إعادة الاستخدام / الإضافة |
|---|---|---|---|
| أدلة append-only | `PosSessionEvent` (Phase 1) + `PosException`/`PosExceptionReview`/`PosRiskSnapshot` (Phase 2) مشتقّة ومفهرسة. | لا كيان يجمع عدة استثناءات/أحداث في ملف تحقيق واحد بدورة حياة وملكية. | **إعادة استخدام كامل بالإشارة**: `PosCaseEvidenceLink` يخزّن `pos_exception_id`/`pos_session_event_id` فقط (معرّفات)، لا نسخاً. لا حذف ولا تعديل على الدليل الأصلي أبداً. |
| دورة مراجعة الاستثناء | `PosExceptionReviewService::transition` (خفيفة: new→reviewing→explained/dismissed/needs_investigation). | لا مفهوم "قضية" تجمع استثناءات متعددة لنفس الموضوع/الجلسة، ولا ملكية/تعيين، ولا AUR على مستوى قضية. | **إضافة** `PosInvestigationCase` + `PosCaseAssignmentService`/`PosInvestigationCaseService` تُنشئ من استثناء (`needs_investigation` قابل للترقية) دون المساس بحالة المراجعة نفسها — ربط لا استبدال (انظر §16 من المهمة). |
| الترقيم التسلسلي | `App\Support\GeneratesDocumentNumbers` (trait) مصدر وحيد، `max()+1`، قفل مِرساة، فهرس فريد `(tenant_id, branch_id, number)`. | لا استهلاك لهذه الطبقة في وحدة الرقابة (الاستثناءات ليست "مستندات مرقّمة"). | **إعادة استخدام كامل**: `PosInvestigationCase` يستعمل `GeneratesDocumentNumbers` مباشرة (بادئة `LP`، سنة الفتح)، بلا منطق ترقيم جديد. تصنيف `BranchScoped` ⇒ تسلسل مستقل لكل فرع تلقائياً من التصنيف نفسه (القاعدة الثالثة في الطبقة). |
| RBAC | `pos.audit.view/review/export/settings.manage`, `pos.override.approve`, `pos.audit.recalculate` قائمة في `Rbac::PERMISSIONS`. لا فحص بأسماء أدوار — `EnsurePermission` + `Rbac::allows()` فقط. | لا صلاحيات مستقلة لعمليات التحقيق/الاعتماد/CCTV. | **إضافة** `pos.investigations.view/create/manage/assign/resolve/export` + `pos.cctv.bookmark.manage` (٧ صلاحيات جديدة إضافية، owner/admin عبر `*`، غير مضافة لمصفوفتَي accountant/staff افتراضياً — نفس نمط `pos.audit.*`). |
| العزل tenant/branch | `BaseModel`+`TenantScope`(tenant) و`BranchScoped`/`BelongsToBranch`/`CompanyWide` (فرع)، يحرسها `BranchIsolationGuardTest` تلقائياً على كل نموذج جديد. | نماذج Phase 3 الستّة تحتاج تصنيفاً صريحاً. | **تصنيف صريح**: `PosInvestigationCase`, `PosCaseEvidenceLink`, `PosCaseActivity`, `PosCaseNote`, `PosCctvBookmark` = `BranchScoped` (بيانات تشغيلية بفرع أصل القضية، تماماً كـ`PosException`). `PosLpDigest` = `CompanyWide` (منتج تجميعي عابر للفروع كالتقارير، بتفصيل الفروع داخل `branch_breakdown` JSON — انظر §"الملخص اليومي" أدناه لتبرير عدم إنشاء صفّ لكل فرع). |
| append-only/immutability | `PosSessionEvent`/`PosExceptionReview` تحجب `updating`/`deleting` عبر `booted()` وترمي `LogicException`. | القضية نفسها كيان **قابل للتغيير المتحكَّم** (حالة/أولوية/تعيين) بخلاف الاستثناء، لكن يجب ألا يُطمس تاريخ القرارات. | **نمط مطابق**: `PosCaseActivity` و`PosCaseNote` يحجبان `updating`/`deleting` (نفس نمط `PosExceptionReview`) — سجلّ الأنشطة والملاحظات append-only صراحةً. القضية والمرجع (`PosCaseEvidenceLink`) والمرجع الكاميرا (`PosCctvBookmark`) قابلة للتحديث المتحكَّم عبر خدمة، وكل تحديث يكتب صفَّ نشاطٍ append-only مقابلاً — لا حذف صلب لأي منها (`unlinked_at`/`SoftDeletes` بدل `DELETE`). |
| الفلترة/الترقيم الخادمي | `PosLossPreventionController::index/risk` (فلترة + `forPage` + عدّ خادمي، لا تحميل كامل بالذاكرة). | القضايا تحتاج نفس النمط + فهارس جديدة. | **إعادة استخدام النمط نفسه** (لا تجريد جديد): `PosInvestigationCaseController::index` يطابق بنية `PosLossPreventionController::index` حرفياً (فلاتر Request::validate، `applyFilters`، `applySort`، `forPage`). فهارس مركّبة جديدة على `(tenant_id, branch_id, status, priority, owner_id, opened_at, last_activity_at)`. |
| AUR/Confirmed Loss | `PosException.amount_under_review` مشتقّ من `amount_event_ids` (إزالة ازدواج داخل استثناء واحد فقط، عبر `PosLossPreventionController::aggregateAmountUnderReview`). | لا تجميع AUR على مستوى قضية تضم عدّة استثناءات متداخلة الأدلة، ولا مفهوم "خسارة مؤكَّدة" بشرية منفصلة عن الدرجة. | **إضافة**: AUR على مستوى القضية = مجموع `ABS(amount)` لمعرّفات أحداث فريدة (اتحاد `amount_event_ids` لكل الاستثناءات المرتبطة، بنفس نمط الدالة القائمة). `confirmed_loss_minor`/`recovered_amount_minor` حقلا قرار بشري صرف على القضية، لا يُشتقّان آلياً أبداً ولا يمرّان بـ`LedgerService`. |
| Workspace `/pos/audit` | تبويبات (نظرة/استثناءات/مؤشرات/علاقات/حسّاسة/سلال/نقد/مستخدمون/اعتمادات/إعدادات). | لا تبويب قضايا/ملخص يومي، ولا Sheet تفصيل قضية. | **توسعة نفس المساحة** (لا صفحة منفصلة): تبويبا `التحقيقات` و`الملخص اليومي`، ومرجع CCTV داخل تفصيل القضية لا تبويباً مستقلاً (طبقاً للمهمة §14). |
| البنية المسموح نسخها في CI | حارس `.github/workflows/ci.yml` يُفشل البناء لأي مجلد فرعي جديد تحت `app/` غير مُدرَج صراحةً (اكتُشف Phase 2 واستمرّ الالتزام به). | — | **قيد معماري مُلزم**: كل ملفات Phase 3 PHP الجديدة **مسطّحة** ضمن المجلدات المدرجة أصلاً — نماذج في `app/Models/`، خدمات في `app/Services/Pos/`، أمر الكونسول في `app/Console/Commands/` — بلا أي مجلد فرعي جديد. |
| المحاسبة/ZATCA/المخزون/checkout | محرّكات مكتملة ومختبرة، لا تُمسّ. | — | **لا تغيير مطلقاً**: لا `journal_entries`/`journal_lines` من أي مسار Phase 3، `confirmed_loss`/`recovered_amount` بيانات تحقيق فقط، لا ترحيل محاسبي، ولا صلة بـ`LedgerService` أو `InventoryService` أو `ZatcaService` أو `PosController::checkout`. |

## موثوقية الربط/البيانات (Data & Linkage Reliability)

- **مرجع الاستثناء**: `pos_exceptions.id` فريد ومستقر منذ إنشائه (Phase 2 لا يعيد استخدام المعرّف)؛
  الربط بمعرّفٍ مباشر موثوق بالكامل. حذف/تعطيل قاعدة كشف لاحقاً لا يحذف الاستثناء التاريخي (Phase 2
  يرفع `version` بدل الحذف)، فمرجع القضية يبقى قابلاً للحلّ دوماً — يتحقق منه اختبار صريح (بند ٣٨).
- **مرجع حدث الجلسة**: `pos_session_events.id` ثابت append-only؛ الربط المباشر موثوق ١٠٠٪.
- **الموضوع/الجلسة/السلة**: `subject_user_id`/`pos_session_id`/`cart_id`/`correlation_id` تُنسخ *سياقاً*
  (context) وقت الربط من الاستثناء المصدر لا تُشتقّ لاحقاً — إن حُذف مستخدم لاحقاً (`SET NULL` على
  `users`) يبقى سياق القضية النصّي (لا الفعلي) مقروءاً عبر اللقطة المخزَّنة، تماماً كنمط `rule_snapshot`
  في Phase 2.
- **AUR**: موثوق بقدر موثوقية `amount_event_ids` في Phase 2 — مصدرها أحداث خادمية (`server_authoritative`)
  حصراً حين يحمل الاستثناء مبلغاً (مضمَّن في تصميم Phase 2 القائم؛ لا تغيير هنا). الرصد العميلي
  (`client_observed`) قد يرفع الشدّة لكنه لا يُسهم في AUR ماليّاً — هذا سلوك Phase 2 الموروث حرفياً.

## ما يُضاف في Phase 3 (جديد)

- **الجداول** (هجرة إضافية واحدة، لا تعديل على جداول Phase 1/2):
  `pos_investigation_cases`, `pos_case_evidence_links`, `pos_case_activities`, `pos_case_notes`,
  `pos_cctv_bookmarks`, `pos_lp_digests`.
- **الخدمات** (مسطّحة في `app/Services/Pos/`): `PosInvestigationCaseService` (إنشاء/ترقية من استثناء/
  ربط أدلة idempotent/تعيين/انتقال حالة/حسم/إعادة فتح/AUR المجمَّع)، `PosCctvBookmarkService`
  (CRUD مدقَّق + نشاط)، `PosLpDigestService` (توليد حتمي idempotent لكل `(tenant, date)`).
- **القراءة/الكتابة**: `PosInvestigationCaseController` (قائمة/تفصيل/إنشاء/ترقية/تعيين/حالة/ملاحظة/
  ربط-فك ربط أدلة/CCTV CRUD/تصدير)، `PosLpDigestController` (قائمة/تفصيل/توليد يدوي).
- **أمر كونسول**: `pos:generate-lp-digest` (نمط `finance:scan-controls` نفسه: يلفّ كل مستأجر، يضبط
  `TenantContext`، يستدعي الخدمة، لا يكتب شيئاً مالياً) + جدولة يومية في `routes/console.php`.
- **الواجهة**: تبويبا `التحقيقات`/`الملخص اليومي` في `web/src/app/(app)/pos/audit/page.tsx`،
  وحدات جديدة في `web/src/modules/pos-audit/` (قائمة/تفصيل قضية، لوحة الملخص اليومي)، وزر "ترقية إلى
  قضية" داخل `exception-detail.tsx`، وترجمات AR/EN كاملة.

## الملخص اليومي — قرار التصميم (لماذا صفّ واحد لكل تاريخ لا لكل فرع)

المهمة تطلب "branch filter where allowed" و"digest respects branch scope" معاً مع "idempotent
generation for the same tenant/date/scope" و"avoid duplicate counting". توليد صفّ منفصل لكل فرع يضاعف
مخاطر الازدواج عند إعادة الحساب (استثناء بفرعين ضمنياً بلا فرع = `branch_id IS NULL` في Phase 2). القرار:
**صفّ واحد لكل `(tenant_id, digest_date)`** يحمل `payload`/`branch_breakdown` JSON مفصَّلاً بالفرع؛
عرض الواجهة يُصفّي هذا الـJSON محلياً حسب اختيار المستخدم دون إعادة استعلام أو إعادة توليد — فيبقى
التوليد idempotent بمعرّف واحد بسيط (`unique(tenant_id, digest_date)`) ولا يُعاد حساب أي شيء عند تبديل
فلتر الفرع في الواجهة.

## قرارات صغيرة حُسمت من أنماط المستودع (بلا انتظار)

1. **بادئة رقم القضية**: `LP` (مطابقة لمثال المهمة `LP-2026-000123`)، عبر `GeneratesDocumentNumbers`
   القياسي — لا صيغة مخصصة.
2. **أولوية القضية**: أربع مستويات `low/normal/high/critical` (تناسق مع نمط تسمية `FuelStationWorkOrder`
   ونمط تسمية الشدّة في Phase 2، بلا إعادة تسمية `severity`).
3. **صلاحيات CCTV/التحقيق تحت بوابة `sales.pos`** نفسها التي تحرس بقية `/pos/audit` (لا مفتاح كتالوج جديد
   — القدرة قائمة أصلاً وتحرس نفس المساحة).
4. **حذف مرجع CCTV**: `SoftDeletes` (لا حذف صلب) + نشاط `cctv_bookmark_removed` — يطابق قاعدة "بلا حذف
   مدمِّر" (§20/٥٥) مع بقاء إمكانية "الإزالة" كإجراء مراجَع لا اختفاء صامت.
5. **idempotency الربط (بند القبول ١١)**: تُفرض في طبقة الخدمة (تحقق من رابط نشط قائم لنفس
   `case_id + pos_exception_id` قبل الإدراج) لا بفهرس فريد جزئي عبر محرّكين مختلفين (SQLite/PostgreSQL) —
   أبسط ومتّسقة مع مبدأ "لا تعقيد زائد" في `CLAUDE.md`.

## نقاط امتداد مؤجَّلة صراحةً (موثّقة، غير منفَّذة)

- تسليم القنوات الخارجية (بريد/واتساب/Slack) للملخص اليومي — لا بنية إشعار عامة موجودة اليوم قابلة
  لإعادة الاستخدام بلا توسعة نطاق حقيقية؛ الملخص اليومي في هذه المرحلة **منتج بيانات + عرض داخل التطبيق
  فقط**، ونقطة الامتداد محفوظة عبر `payload` JSON المُهيكل بالفعل.
- تصدير PDF لملخص القضية/الملخص اليومي — يُعاد استخدام محرّك التصدير القائم (`DataTable`/CSV) فقط في هذه
  المرحلة؛ لا محرّك PDF جديد يُبنى (المهمة تمنع صراحة بناء محرك جديد، ولا محرّك خفيف قائم قابل لإعادة
  الاستخدام هنا بأمان).
- مطابقات أعمدة/قوالب محفوظة، اندماج قضايا تلقائي، أي ذكاء اصطناعي/تعلّم آلي — خارج النطاق صراحةً حسب
  §28 من المهمة.

## قيود معمارية جديدة اكتُشفت أثناء تدقيق Phase 3

لا قيد جديد يمنع التنفيذ. القيد الوحيد المكتشف (حارس نسخ CI) موثَّق أعلاه وتم الالتزام به بالتصميم
(بنية مسطّحة) قبل كتابة أي كود.

[Task: ClaudeCode_Nebrax_POS_Loss_Prevention_Phase3]
