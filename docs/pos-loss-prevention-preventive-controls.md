# POS Loss Prevention — Phase 4: Preventive Controls

> مؤشرات المراجعة والاستثناءات تساعد في ترتيب أولوية المراجعة والتحقيق، ولا تُثبت وحدها
> وجود مخالفة.

يوثّق هذا الملف امتداد نموذج السياسة القائم (`audit_operation_policies`) إلى عمليات
خادمية حقيقية، تحصين فصل المهام (SoD) لتسوية فرق الإغلاق، وأي فرق حاسم بين "ضبط وقائي"
(يمنع الفعل **قبل** تنفيذه) و"دليل بعد الفعل" (Telemetry).

## 1) أي العمليات خادمية فعلاً؟ (المعيار الحاسم)

المعيار الوحيد: **هل يملك الخادم اللحظة التي يمكنه فيها الرفض قبل أن يقع الأثر الحقيقي؟**

| العملية | خادمية فعلاً؟ | السبب |
|---|---|---|
| `refund` (`PosReturnService::create`) | **نعم** | إنشاء مستند المرتجع فعل خادمي واحد؛ الخادم يقرر قبل الكتابة. |
| `cash_out` (`PosSessionService::recordCashMovement`) | **نعم** | حركة الدرج تُكتب من الخادم مباشرة؛ لا حالة عميلية سابقة يمكن أن "تسبقها". |
| `manual_drawer_open` (`CashDrawerService::openManually`) | **نعم** | فتح الدرج فعل جهاز يُصدره الخادم عبر Local Bridge؛ يمكن رفضه قبل إصدار الأمر. |
| `item_remove` / `price_override` / `discount_change` / `cart_cancel` | **لا** | السلة حالة عميلية محلية (`localStorage`) حتى `checkout`؛ الخادم يرى الحدث **بعد** أن نفّذه العميل محلياً فعلاً — Telemetry `client_observed`، ليس ضبطاً وقائياً حقيقياً بلا محرك سلة خادمي كامل (خارج النطاق، انظر `docs/pos-loss-prevention-evidence-integrity.md` §4). |
| `cash_recount` (Phase 1، قائم) | **نعم** (قائم أصلاً) | يتطلب اعتماداً مسجَّلاً بعد كشف الفرق؛ لم يتغيّر في هذا الطور. |

هذا التمييز **ليس** جديداً في هذا الطور — هو نفس التصنيف المعتمد من Phase 1 لكل حدث؛ Phase
4 فقط يوسّع مجموعة العمليات الخادمية القابلة للضبط الوقائي من واحدة (`cash_recount`) إلى
أربع.

## 2) امتداد نموذج السياسة (`audit_operation_policies`)

النموذج القائم منذ Phase 1 بلا تغيير في شكله: كل عملية ↦ واحدة من ثلاث سياسات.

| السياسة | السلوك |
|---|---|
| `allowed` | تمرّ بلا أثر إضافي — الافتراض لكل عملية Phase 4 الجديدة (يحفظ سلوك كل مستأجر قائم). |
| `approval_required` | تتطلب اعتماد `PosOverrideApproval` **مُستهلَكاً** قبل تنفيذ الفعل الحقيقي. |
| `denied` | تُرفض فوراً، بلا مسار اعتماد. |

`app/Support/PosSettings.php:94-106` يضيف ثلاثة مفاتيح جديدة إلى `audit_operation_policies`
الموجود أصلاً: `refund`, `cash_out`, `manual_drawer_open` — **كل الثلاثة تبدأ بـ`allowed`**،
فلا يتغيّر سلوك أي مستأجر قائم بترقية الكود؛ فرض القيد قرار مالك صريح لاحق عبر شاشة
الإعدادات (§5).

### البوابة الموحّدة: `PosAuditService::enforceOperationPolicy()`

```php
public function enforceOperationPolicy(PosSession $session, User $actor, string $operation, ?string $approvalId = null): void
{
    $this->consumeApprovalIfNeeded($session, $actor, null, (string) Str::uuid(), $operation, $approvalId);
}
```

نقطة دخول جديدة صغيرة تُعيد استخدام `consumeApprovalIfNeeded()` **نفسها** التي تخدم أحداث
السلة منذ Phase 1 — لا محرك اعتماد ثانٍ، ولا مسار تحقق موازٍ. الفرق الوحيد: لا `cartId`
(هذه العمليات لا ترتبط بسلة بالضرورة)، فيُمرَّر `null` صراحة ويُستبدل الربط بمعرّف
correlation عشوائي خاص بالتحقق فقط.

السلوك الفعلي حسب السياسة:

- **`allowed`:** `consumeApprovalIfNeeded()` تُعيد `null` فوراً بلا أي أثر — الفعل الحقيقي
  ينفَّذ مباشرة (سلوك كل مستأجر قائم حرفياً، صفر تغيير).
- **`denied`:** `RuntimeException` فورية — لا مسار اعتماد، لا استثناء.
- **`approval_required`:** يتطلب `approvalId` صالحاً (موجود، `status = approved`، غير
  منتهي، مطابق للجلسة/العملية/المنفّذ). عند التحقق: يُستهلَك (`status = consumed`) وتُلحق
  حدث `override_consumed` — **قبل** أن يُنفَّذ الفعل الحقيقي (الاسترداد/الصرف/فتح الدرج)،
  لا بعده. فشل التحقق = استثناء يمنع الفعل تماماً؛ لا "فتح جزئي" أو "صرف جزئي" ممكن.

### نقاط الاستدعاء الثلاث

| العملية | موقع الاستدعاء | متى بالضبط |
|---|---|---|
| `refund` | `PosReturnService::create()` (`app/Services/Accounting/PosReturnService.php:81`) | قبل إنشاء `ReturnDocument` وقبل أي حركة مخزون/قيد. |
| `cash_out` | `PosSessionService::recordCashMovement()` (`app/Services/Accounting/PosSessionService.php:150`) | داخل معاملة الحركة، قبل إنشاء `PosCashMovement`، **فقط لحركات الصرف** (لا القبض — القبض لا يُخرج نقداً من الدرج). |
| `manual_drawer_open` | `CashDrawerService::openManually()` (`app/Services/Pos/CashDrawerService.php:45`) | قبل استدعاء `prepare()` الذي يصدر أمر الجهاز الفعلي. |

كل الثلاثة تقبل `approval_id` اختيارياً من الطلب (`StorePosReturnRequest`,
`StorePosCashMovementRequest`, ومسار فتح الدرج في `PosSessionController`) — نفس اسم الحقل
ونمط التحقق `nullable|string` المستخدم أصلاً لـ`cash_recount`، لا اتفاقية جديدة.

## 3) فصل المهام (SoD) — تسوية فرق الإغلاق

### الفجوة المؤكَّدة بالتدقيق

منع الاعتماد الذاتي كان مطبَّقاً **فقط** في `PosOverrideApproval::approve()`
(`app/Services/Pos/PosAuditService.php:366-368`: لا يستطيع المعتمِد أن يكون نفس منفّذ
العملية). لم يكن مطبَّقاً في مساري `pos.variance.approve` (`acknowledgeDifference`,
`settleVariance` في `PosSessionService`) — الكاشير الذي أغلق جلسته (وبالتالي أنشأ الفرق)
كان يستطيع أن يقرّ أو يسوّي فرقه بنفسه دون طرف ثانٍ.

### التصميم: علم اختياري، لا فرض

طبقاً لقاعدة "السياسة تُضبط ولا تُفرَض" (`CLAUDE.md`)، الحل **ليس** فرض SoD دوماً — كثير
من فروع نبراكس كاشير واحد فعلياً، ولا معتمِد ثانٍ متاح أصلاً؛ فرض القيد سيقفلهم عن إغلاق
جلساتهم نهائياً.

`PosSettings::selfApprovalBlockedForVariance()` (`app/Support/PosSettings.php:338-341`) —
إعداد `pos_loss_prevention.self_approval_blocked_for_variance`، **افتراضه `false`**. عند
التفعيل الصريح فقط:

```php
private function assertVarianceSelfApprovalAllowed(PosSession $session, User $actor): void
{
    if (! PosSettings::selfApprovalBlockedForVariance()) {
        return;
    }
    if ($session->closed_by !== null && $session->closed_by === $actor->id) {
        throw new RuntimeException('سياسة فصل المهام تمنع من أغلق الجلسة من اعتماد أو تسوية فرقها.');
    }
}
```

مُستدعاة من `acknowledgeDifference()` و`settleVariance()` كلتيهما
(`app/Services/Accounting/PosSessionService.php:281,389`) — نفس المبدأ المطبَّق أصلاً على
`PosOverrideApproval::approve()`، بس بعلم تفعيل صريح بدل فرض غير مشروط، لأن حالة الاستخدام
مختلفة جوهرياً: اعتماد Override له دوماً طرفان مختلفان بالتصميم (منفّذ يطلب، آخر يعتمد)،
بينما إغلاق/تسوية جلسة قد يقوم بهما شخص واحد شرعاً في منشأة صغيرة.

## 4) RBAC — لا صلاحية جديدة

كل بوابات Phase 4 تُعاد استخدام صلاحيات قائمة بالفعل، تماماً كما خطّطت الـ Gap Matrix:

| القدرة | الصلاحية المستخدمة | لماذا لا صلاحية جديدة |
|---|---|---|
| ضبط السياسات الثلاث الجديدة (`refund`/`cash_out`/`manual_drawer_open`) | `pos.audit.settings.manage` (قائمة، تضبط بقية `audit_operation_policies` أصلاً) | نفس شاشة الإعدادات، نفس الصلاحية — لا فرق بين ضبط سياسة قديمة وجديدة. |
| اعتماد طلب مرتبط بأي من الثلاث | `pos.override.approve` (قائمة) | مسار الاعتماد نفسه المستخدم لكل العمليات الحساسة منذ Phase 1. |
| تنفيذ الفعل الحقيقي (استرداد/صرف/فتح درج) | `pos.returns.manage` / صلاحية حركة الدرج القائمة / `pos.cash_drawer.open` (قائمة لكل منها) | السياسة **بوابة إضافية فوق** الصلاحية القائمة، لا بديل عنها — كلتاهما يجب أن تنجح. |
| طابور «يحتاج انتباه» | `pos.audit.view` (قائمة) — أُضيف فحص إضافي داخلي يُخفي عناصر القضايا/الملخص عن من لا يملك `pos.investigations.view`، والاعتمادات المعلَّقة عن من لا يملك `pos.audit.review`/`pos.override.approve` | لا حاجة لصلاحية أضيق؛ الفلترة الداخلية أدق (بالعنصر لا بالمسار كله) وتمنع كشف أنواع بيانات المستخدم لا صلاحية له عليها أصلاً، دون حرمانه من رؤية بقية القائمة. |
| فصل المهام (SoD) | لا صلاحية إضافية | يعتمد على `closed_by` المخزَّن على الجلسة نفسها، لا فحص صلاحية جديد. |

**لم تُضَف صلاحية `pos.audit.needs_attention.view`** المذكورة كخيار احتياطي في خطة المهمة
— المراجعة أثناء التنفيذ لم تُظهر حاجة حقيقية لبوابة أضيق من `pos.audit.view`، والفلترة
الداخلية بالعنصر كافية ودقيقة أكثر من صلاحية مسار كاملة.

## 5) شاشة الإعدادات (`/pos/settings/configuration`)

قسم جديد «ضوابط منع الفقد» (`section_loss_prevention`)، مستقل بصرياً عن أقسام POS
القائمة، يحوي:

- ثلاث قوائم منسدلة (`refund`, `cash_out`, `manual_drawer_open`) بنفس عنصر واجهة القوائم
  المنسدلة المستخدم أصلاً لـ`cash_recount` — لا مكوّن جديد.
- مفتاح تبديل (`Switch`) واحد لـ`self_approval_blocked_for_variance`.
- حقل رقمي واحد لـ`outside_hours_grace_minutes` (0–240 دقيقة).

**تُحفَظ في قسم `sales-config` منفصل (`pos_loss_prevention`) لا `pos` نفسه** — طلب
`PUT /sales-config/pos_loss_prevention` مستقل عن `PUT /sales-config/pos`، فحفظ أحدهما لا
يعيد كتابة الآخر ولا يفرض قيمه الافتراضية على مستأجر قائم لم يفتح هذا القسم من قبل. ثلاث
سياسات العمليات الجديدة (`refund`/`cash_out`/`manual_drawer_open`) تُحفَظ ضمن قسم `pos`
القائم نفسه (هي امتداد لـ`audit_operation_policies` الموجود فيه أصلاً)، بينما السويتش
ودقائق السماح في القسم المستقل الجديد.

`app/Http/Controllers/Api/SalesConfigController.php:108-109` يوسّع القائمة البيضاء
لـ`data.audit_operation_policies` بالمفاتيح الثلاثة الجديدة (نفس قاعدة تحقق `Rule::in`
المستخدمة لبقية القيم)، ويضيف قسم `pos_loss_prevention` جديداً بالكامل (`:146-149`) بقواعد
`boolean` و`integer between:0,240` — كلاهما اختياري (`nullable`)، فطلب لا يحمل أياً منهما
لا يمسّ الإعداد المخزَّن.

## 6) ماذا لا يفعله هذا الطور

- **لا يمنع** `item_remove`/`price_override`/`discount_change`/`cart_cancel` — هذه
  Telemetry بعد الفعل بالتصميم، ولا مسار خادمي يملك سلطة منعها قبل وقوعها (§1 أعلاه، وتفصيل
  أوسع في `docs/pos-loss-prevention-evidence-integrity.md` §4).
- **لا يفرض** SoD على أي منشأة لم تفعّله صراحة — الافتراض في كل مكان يحفظ السلوك القائم.
- **لا يضيف رسوماً محاسبية أو قيوداً جديدة** — الضبط الوقائي بوابة **قبل** الفعل المالي
  القائم، لا يُنشئ فعلاً مالياً جديداً بنفسه (انظر جدول القيود — لا شيء أدناه).

## جدول القيود المحاسبية الناتجة عن Phase 4

**لا شيء.** كل ما في هذا الملف بوابات موافقة/رفض أو فحص فصل مهام يسبق فعلاً مالياً
قائماً بالفعل (المرتجع/الصرف النقدي عبر مساراتهما الأصلية القائمة منذ أطوار سابقة). لا
تعديل على `LedgerService::post`، لا حساب جديد، لا قيد جديد ولا تعديل على قيد قائم.
