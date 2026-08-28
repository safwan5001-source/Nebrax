# POS Loss Prevention — Phase 2: Gap Matrix

> أُنجز هذا التدقيق على `main` بعد دمج PR #530 (Phase 1) وقبل كتابة أي كود لـ Phase 2.
> المرجع الوظيفي هو المهمة المرفقة `Manus_Nebrax_POS_Loss_Prevention_Phase2`، ومصدر الأدلة
> الوحيد هو `PosSessionEvent` القائم (append-only). **لم يُنشأ مصدر حقيقة موازٍ.**

## المبدأ الحاكم

> **مؤشرات المراجعة تُرتّب أولوية المراجعة؛ وليست دليلاً على مخالفة موظف.**
> الدليل الخادمي (`server`) هو مصدر الحقيقة، والرصد العميلي (`client_observed`) ثانوي
> وموسوم صراحةً في كل استثناء ولا يصبح حقيقة مالية أو أمنية دون تحقق خادمي.

## مصفوفة الفجوات

| المتطلب (Phase 2) | الموجود في Phase 1 | الفجوة | قرار إعادة الاستخدام / الإضافة |
|---|---|---|---|
| أدلة append-only | `PosSessionEvent` مع `cart_id`/`correlation_id`/`category`/`amount`/`reason_code`/`performed_by`/`approved_by`/`provenance` مفهرسة. | لا طبقة اشتقاق (استثناءات/درجات) فوقها. | **إعادة استخدام كامل**: كل قراءة كشف تقرأ `PosSessionEvent` فقط؛ الاستثناءات جداول مشتقّة منفصلة تشير إلى معرّفات الأحداث ولا تعدّلها. |
| نموذج الثقة/المصدر | `payload.provenance.source` + `trust_level` (`server`/`client_observed`/`hybrid`/`legacy_unknown`). | لم يُنقل التمييز إلى مستوى الاستثناء. | **إعادة استخدام**: كل استثناء يرث `evidence_confidence` من أدلته، ويعرضه الشرح والواجهة. القاعدة العميلية تنتج مؤشراً أدنى ثقة موسوماً. |
| RBAC | `pos.audit.view`/`review`/`export`/`settings.manage` + `pos.override.approve` قائمة في `Rbac::PERMISSIONS`. | لا صلاحية لإعادة حساب الذكاء الرقابي. | **إعادة استخدام** الخمس القائمة + إضافة `pos.audit.recalculate` واحدة (additive، owner/admin عبر `*`). |
| قراءة/فلترة موحدة | `PosAuditController` + `PosAuditService::readEvents` (فلترة خادمية، حدود صفحة). | `carts()` يحمّل كل الأحداث في الذاكرة ثم يجمّع ويقسّم، و`total` يُحسب بعد `take()`. | **تصحيح انحدار** (مطلوب بند 11): تجميع وتقسيم وعدّ خادمي على مستوى قاعدة البيانات، مع اختبار انحدار. لا refactor للـDataTable. |
| إعدادات POS | `PosSettings` + `SalesConfigController` مصدر موحد لسياسات POS. | لا كتالوج قواعد كشف قابل للضبط بلقطة تاريخية. | **إضافة** كيان `PosExceptionRule` (CompanyWide) بلقطة/إصدار، لا حشو في `sales_config`. |
| المخزون/المحاسبة/ZATCA/checkout | محرّكات مالية مكتملة ومختبرة. | — | **لا تغيير**: لا كتابة في `journal_*`، لا قيد من استثناء، لا مسّ للفوترة أو المخزون أو المرتجع. القراءة فقط. |
| العزل tenant/branch | `BaseModel`+`TenantScope`، `BranchScoped`/`BelongsToBranch`/`CompanyWide`، `scopeToActiveBranch`. | نماذج جديدة تحتاج تصنيف عزل صريح (يحرسه `BranchIsolationGuardTest`). | **إضافة** مصنّفة: `PosException`/`PosExceptionReview`/`PosRiskSnapshot` = `BranchScoped`؛ `PosExceptionRule` = `CompanyWide`. |
| workspace `/pos/audit` | تبويبات (نظرة/حساسة/سلال/نقد/مستخدمون/اعتمادات/إعدادات) على مكوّنات Nebrax. | لا استثناءات/مؤشرات مراجعة/علاقات اعتماد/تفصيل استثناء. | **توسعة نفس المساحة** (لا صفحة مدير منفصلة): تبويبات استثناءات + مؤشرات مراجعة + علاقات الاعتماد + Sheet تفصيل. |

## ما يُضاف في Phase 2 (جديد)

- **الجداول:** `pos_exception_rules`, `pos_exceptions`, `pos_exception_reviews`, `pos_risk_snapshots` (هجرة إضافية واحدة).
- **المحرك:** `PosExceptionDetectionService` (Collect→Correlate→Detect→Normalize→Score→Explain، حتمي وidempotent)،
  `PosExceptionRuleCatalog` (مصدر واحد للنوافذ/الأوزان/الحد الأدنى للعينة)، `PosBaselineCalculator`
  (self→peer→static)، `PosRiskScoreService` (درجة 0–100 مفسَّرة بأسقف/إزالة تكرار)، `PosExceptionReviewService`.
- **القراءة:** توسعة `PosAuditController` بمسارات الاستثناءات/المؤشرات/العلاقات/المراجعة/إعادة الحساب،
  كلها بترقيم وفلترة وتجميع خادمي.
- **الواجهة:** توسعة `web/src/app/(app)/pos/audit/page.tsx` وترجمات AR/EN.

## قيود معمارية اكتُشفت أثناء التدقيق

1. **حارس قائمة النسخ في CI** (`.github/workflows/ci.yml`) يُفشل البناء لأي مجلد فرعي جديد تحت `app/`
   غير مُدرج صراحةً. لذلك تبقى كل خدمات Phase 2 **مسطّحة** في `app/Services/Pos/` (مُدرج ومنسوخ أصلاً)،
   والنماذج في `app/Models/` — بلا مجلدات فرعية جديدة.
2. **`item_added`/`item_removed`/`item_quantity_changed`/`cart_cancelled` هي `client_observed`** (لا حالة
   سلة خادمية كاملة بعد). القواعد المعتمدة عليها تنتج مؤشراً موسوماً `client_observed` صراحةً ولا يُرقّى
   لدليل خادمي — يتوافق مع نموذج Phase 1.
3. **ربط المرتجع بكاشير البيع الأصلي (cross-cashier refund) غير مثبت بموثوقية** من الأدلة الحالية:
   حدث `return_recorded` لا يحمل هوية كاشير الفاتورة الأصلية بصورة مضمونة. لذا يُنفَّذ تواتر/مبلغ المرتجع
   الخادمي، ويُؤجَّل متغيّر cross-cashier إلى Phase 3 (موثّق أدناه).
4. **«النشاط خارج نمط العمل المعتاد» (timing)** يتطلب أساساً زمنياً دفاعياً لكل مستخدم؛ يُنفَّذ متغيّر
   «تركّز العمليات الحساسة قرب الإغلاق» (مثبت من `closed_at`/توقيت الأحداث)، ويُؤجَّل «خارج ساعات العمل»
   إلى Phase 3 حتى تتوفر ساعات عمل مرجعية موثوقة.

## مؤجَّل صراحةً إلى Phase 3 (نقاط امتداد محفوظة، غير منفَّذة)

- إدارة قضايا تحقيق كاملة (تعيين/SLA/مرفقات)، CCTV/إشارات فيديو، Daily LP Digest/إشعارات،
  أي ذكاء اصطناعي/LLM أو ML anomaly detection، ذكاء POS دون اتصال، إجراءات تأديبية/HR،
  تكاملات خارجية لمنع الخسائر.
- متغيّر **cross-cashier refund** (يحتاج ربطاً موثوقاً بين المرتجع وكاشير البيع الأصلي).
- متغيّر **timing خارج ساعات العمل** (يحتاج أساس ساعات عمل مرجعياً).

[Task: Manus_Nebrax_POS_Loss_Prevention_Phase2]
