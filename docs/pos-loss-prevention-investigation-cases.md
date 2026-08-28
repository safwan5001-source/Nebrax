# POS Loss Prevention — Phase 3: Investigation Cases, Evidence Operations & CCTV Bookmarks

> **مؤشرات المراجعة والاستثناءات تساعد في ترتيب أولوية التحقيق، ولا تُثبت وحدها وجود مخالفة.**
> Review indicators and exceptions help prioritize investigation; they do not, by themselves, prove wrongdoing.

يحوّل هذا الطور `/pos/audit` من *Evidence → Exceptions → Risk* إلى مسار مراجعة تشغيلي كامل:
*Detect → Review → Investigate → Document → Resolve → Learn*. القضية (`Case`) وثيقة عمل
بشرية القرار تجمع استثناءات/أدلة Phase 1/2 في ملف واحد بملكية وحالة ومتابعة وحسم موثّق —
دون أن تصبح نظام عقوبات موارد بشرية أو محرّك اتهام جنائي.

## 1) المعمار — إعادة استخدام لا مصدر حقيقة موازٍ

```
PosSessionEvent (Phase 1, append-only)
        ↑ يُشار إليه فقط
PosException / PosRiskSnapshot (Phase 2, مشتقّة)
        ↑ يُشار إليه فقط
PosInvestigationCase → PosCaseEvidenceLink → PosCaseActivity / PosCaseNote / PosCctvBookmark
```

- **لا نسخ لقيمة مالية أو دليل.** `PosCaseEvidenceLink` يخزّن `pos_exception_id`/
  `pos_session_event_id` (معرّفات) فقط. حذف/تعطيل قاعدة كشف لاحقاً لا يُفقد مرجع القضية
  (Phase 2 يرفع `version` بدل الحذف، فالمرجع يبقى قابلاً للحلّ).
- **الترقية لا تعدّل الاستثناء.** `promoteException()` ينشئ القضية ويربطها؛ حالة مراجعة
  الاستثناء الخفيفة (`PosExceptionReview`) تبقى مستقلة تماماً ولا تُطمس.
- **لا كتابة محاسبية مطلقاً من أي مسار Phase 3.** لا `journal_entries`/`journal_lines`، ولا
  استدعاء لـ `LedgerService`. `confirmed_loss_minor`/`recovered_amount_minor` بيانات قرار
  تحقيق بشري صرف.

## 2) الجداول (هجرة إضافية واحدة `2026_08_30_010000`)

| الجدول | التصنيف | append-only؟ | الغرض |
|---|---|---|---|
| `pos_investigation_cases` | `BranchScoped` | لا (تحديث متحكَّم) | القضية: رقم، عنوان، حالة، أولوية، مسؤول، سياق مصدري، AUR، خسارة مؤكدة، مبلغ مسترد، حسم. |
| `pos_case_evidence_links` | `BranchScoped` | فكّ منطقي (`unlinked_at`) لا حذف | ربط استثناء/حدث بقضية، بمنطق idempotent على مستوى الخدمة. |
| `pos_case_activities` | `BranchScoped` | **نعم** | سجل كل فعل على القضية (تعيين/حالة/أولوية/ربط/ملاحظة/CCTV/حسم/إعادة فتح). |
| `pos_case_notes` | `BranchScoped` | **نعم** | ملاحظات تحقيق — صفّ لكل ملاحظة، لا مدوَّنة واحدة قابلة للطمس. |
| `pos_cctv_bookmarks` | `BranchScoped` | Soft delete + نشاط مقابل | مرجع كاميرا وصفي فقط — **لا فيديو مخزَّن**. |

كل نموذج جديد يُصنَّف صراحةً (`BranchScoped`) ويحرسه `BranchIsolationGuardTest` تلقائياً.

## 3) الترقيم — إعادة استخدام كامل للطبقة القياسية

`PosInvestigationCase` يستعمل `GeneratesDocumentNumbers` مباشرة (بادئة `LP`، مثال
`LP-2026-00123`)، مسجَّلاً في `DocumentNumberingCatalog::ENTITIES['pos_investigation_case']`.
لا منطق ترقيم جديد. التصنيف `BranchScoped` يشتق تسلسلاً مستقلاً لكل فرع تلقائياً من التصنيف
نفسه (القاعدة الثالثة في الطبقة)، بقفل مِرساة على صفّ الفرع وفهرس فريد
`(tenant_id, branch_id, number)` + فهرس جزئي للصفوف بلا فرع.

## 4) دورة حياة القضية

```
open → investigating ⇄ awaiting_information
  ↓          ↓                    ↓
  └──→ explained | control_failure | confirmed_loss | dismissed → closed
                                                          ↑
                                              reopen() صريح فقط من closed
```

- **الإغلاق يتطلب سبباً/ملخص حسم دائماً.** أي انتقال إلى حالة حسم (`explained`,
  `control_failure`, `confirmed_loss`, `dismissed`, `closed`) يرفض بلا سبب أو ملاحظة.
- **إعادة الفتح فعل مستقل صريح** (`reopen()`)، لا مجرد `status=investigating` عبر المسار
  العادي — مسجَّل بنشاط `reopened` منفصل، ويتطلب سبباً دوماً.
- **كل انتقال يكتب صفّ نشاط append-only** (`pos_case_activities`)، فتاريخ القرارات لا يُطمس.
- التمييز الدلالي الخمسي مطلوب في المهمة محقَّق عبر `outcome`:
  لا مخالفة/مستبعد (`dismissed`) · نشاط مبرر (`explained`) · خلل رقابي (`control_failure`) ·
  خسارة مالية مؤكدة (`confirmed_loss`) · لا تزال قيد التحقيق (`open`/`investigating`/
  `awaiting_information`).

## 5) AUR مقابل الخسارة المؤكدة — الفصل الصارم

| المفهوم | المصدر | من يضبطه | يمرّ بمحاسبة؟ |
|---|---|---|---|
| **Amount Under Review** (`amount_under_review_minor`) | مشتقّ آلياً من الأدلة المرتبطة | النظام (`recalculateAmountUnderReview()` بعد كل ربط/فكّ) | لا |
| **Confirmed Loss** (`confirmed_loss_minor`) | قرار تحقيق بشري صرف | مستخدم مخوَّل بصلاحية `pos.investigations.resolve` فقط، عبر انتقال حالة صريح | لا |
| **Recovered Amount** (`recovered_amount_minor`) | بيانات وصفية اختيارية | نفس مستخدم الحسم | لا |

- **لا يُشتقّ `confirmed_loss` آلياً من `PosRiskSnapshot.total_score` أو `PosException.severity`
  أبداً** — حتى قضية بأولوية `critical` تبقى `open` حتى فعل بشري صريح (مُختبَر صراحة).
  الانتقال إلى `confirmed_loss` يرفض بلا `confirmed_loss_minor` صريح.
- **AUR على مستوى القضية = اتحاد معرّفات الأحداث الحاملة للمبلغ** عبر كل الاستثناءات
  المرتبطة النشطة (غير المفكوكة) + الأحداث المرتبطة مباشرة — فاستثناءان مختلفان يشيران لنفس
  حدث الدليل (مثل `refund_frequency` و`refund_amount_rate` لنفس المرتجع) **لا يُضاعفان AUR**.
- الرصد العميلي (`client_observed`) قد يرفع شدّة استثناء ويُسهم في ترتيب الأولوية، لكنه لا
  يدخل حساب AUR المالي ولا يمكن أن يصبح `confirmed_loss` تلقائياً — نفس نموذج الثقة الموروث
  من Phase 2 حرفياً.

## 6) ربط/فك الأدلة — Idempotent بلا تعقيد فهرس جزئي

ربط نفس الاستثناء مرتين لا يُنشئ صفّاً ثانياً: الخدمة تتحقق من رابط نشط قائم
(`case_id + pos_exception_id`, `unlinked_at IS NULL`) قبل الإدراج وتُعيده كما هو (قرار مبسَّط
موثَّق في Gap Matrix بدل فهرس فريد جزئي عبر محرّكي SQLite/PostgreSQL). الفكّ منطقي
(`unlinked_by`/`unlinked_at`) لا حذف صلب، ويكتب نشاط `evidence_unlinked` مقابلاً.

**كشف الازدواج (لا اندماج تلقائي):** `GET pos/investigations/duplicate-check` يعيد قضايا
مفتوحة قائمة لنفس `subject_user_id`/`pos_session_id` كتحذير استشاري فقط — القرار (ربط/إنشاء
قضية جديدة رغم التحذير) يبقى للمستخدم المخوَّل صراحةً.

## 7) مرجع الكاميرا (CCTV) — مرجعي فقط

**لا فيديو يُخزَّن أو يُرفع أو يُبثّ.** `PosCctvBookmark` بيانات وصفية بحتة: تسمية كاميرا/موقع،
نطاق زمني (`timestamp_start`/`timestamp_end`)، `source_timezone` صريح، مرجع خارجي اختياري
(`external_reference`) مدقَّق خادمياً — **يُقبل `http://`/`https://` فقط**، وتُرفض صراحةً
مخططات `javascript:`/`data:`/غيرها. الحذف Soft (`SoftDeletes`) لا صلب، وكل إضافة/تعديل/حذف
يكتب نشاط قضية مقابلاً (`cctv_bookmark_added/updated/removed`) — مُدقَّق بالكامل.

## 8) RBAC — سبع صلاحيات جديدة إضافية

| الصلاحية | تحرس |
|---|---|
| `pos.investigations.view` | القائمة/التفصيل/الخط الزمني/فحص الازدواج |
| `pos.investigations.create` | إنشاء قضية/ترقية استثناء |
| `pos.investigations.manage` | تعديل أولوية/ملاحظة/ربط-فك أدلة/انتقالات الحالة النشطة |
| `pos.investigations.assign` | إسناد/إعادة إسناد |
| `pos.investigations.resolve` | **إضافية** فوق `manage` لأي انتقال إلى حالة حسم أو إعادة فتح |
| `pos.investigations.export` | تصدير CSV |
| `pos.cctv.bookmark.manage` | CRUD مرجع الكاميرا — مستقلة عن `manage` العامة |

لا فحص بأسماء أدوار؛ `Rbac::allows()`/`EnsurePermission` فقط. `owner`/`admin` يملكانها عبر
`*`؛ غير مضافة لمصفوفتَي `accountant`/`staff` الافتراضيتين (نفس نمط `pos.audit.*`) — تُسند
عبر دور مخصص. **حسم القضية يفرض `pos.investigations.resolve` داخل المتحكّم صراحةً** حتى مع
حيازة `manage` (اختبار مستقل يثبت الفصل).

## 9) الأداء

- كل قوائم/تفصيل القضايا **خادمية بالكامل**: فلترة `Request::validate` + `forPage()` + عدّ
  خادمي منفصل، بنفس بنية `PosLossPreventionController::index` حرفياً — لا تجريد جديد.
- فهارس مركّبة جديدة: `(tenant, branch, status, priority)`, `(tenant, owner)`,
  `(tenant, subject)`, `(tenant, opened_at)`, `(tenant, last_activity_at)`,
  `(tenant, pos_session_id)`، وفهارس مماثلة على روابط الأدلة والنشاط والملاحظات ومراجع الكاميرا.
- `recalculateAmountUnderReview()` يُستدعى فقط عند ربط/فكّ فعليّ — لا إعادة حساب على كل قراءة.
- لا إعادة حساب لـ `PosRiskSnapshot`/`PosException` من أي مسار قضية — القراءة فقط.

## 10) الاختبارات

`PosLossPreventionInvestigationsTest` (31 اختباراً) يغطّي: الترقيم والعزل بالمستأجر/الفرع،
RBAC لكل صلاحية (بما فيها فصل `resolve` عن `manage` و`pos.cctv.bookmark.manage` المستقلة)،
رفض الربط عبر المستأجرين (استثناء وحدث)، الترقية وعدم مسّ حالة الاستثناء، idempotency الربط،
تعدد الاستثناءات لقضية واحدة، append-only النشاط، حفظ تاريخ التعيين/الحالة، إعادة الفتح
الصريحة، شرط سبب الإغلاق، استحالة اشتقاق `confirmed_loss` من الدرجة، AUR بلا ازدواج عبر أدلة
متداخلة، `My Cases` بالمستخدم الحالي لا اسم الدور، تحذير الازدواج بلا اندماج، عزل/أمان مرجع
الكاميرا (مخططات غير آمنة، توقيت، تدقيق)، غياب أي قيد محاسبي عبر دورة حياة القضية، وترقيم
خادمي صحيح. اختبارات Phase 1/2 (`PosLossPreventionTest`, `PosLossPreventionIntelligenceTest`,
`PosSessionTest`, اختبارات المرتجعات) تبقى خضراء بلا تعديل.

## 11) نقاط امتداد مؤجَّلة صراحةً

مطابقات أعمدة محفوظة، اندماج قضايا تلقائي، تصدير PDF (لا محرّك جديد يُبنى)، توسيع الإنفاذ
ليشمل تكاملات مزوّد CCTV فعلية، أي ذكاء اصطناعي/تعلّم آلي، إجراءات تأديبية/موارد بشرية —
كلها خارج نطاق هذا الطور صراحةً (§28 من المهمة المرجعية).
