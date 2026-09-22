# نظام أَوْج للتنفيذ الذاتي الموثّق — AWJ Autonomous Engineering Horizon

## الاسم المرجعي

الاسم الرسمي:

**نظام أَوْج للتنفيذ الذاتي الموثّق**  
**AWJ Autonomous Engineering Horizon**

الاسم المختصر المستخدم مع صفوان:

**نظام الأفق**

## أمر الاستدعاء

عندما يقول صفوان، في أي مهمة أو محادثة مستقبلية:

> **نفّذ هذه المهمة بنظام الأفق**

أو صياغة واضحة مكافئة مثل:

> **اعمل هذه المهمة بنظام الأفق**

فهذا **أمر عمل مرجعي** لاستدعاء العملية الكاملة الموثقة هنا وفي `docs/autonomous-engineering/`.

لا يعتمد تفسير الطلب على ذاكرة المحادثة. يجب الرجوع إلى هذا المرجع وحالة المستودع الحالية.

## ماذا يعني نظام الأفق؟

نظام الأفق هو طريقة أَوْج لإدارة أفق هندسي كبير من الحالة الموثقة الحالية حتى الإغلاق، بأقل تدخل يدوي ممكن، مع الحفاظ على:

- سلامة النظام والبيانات؛
- الدقة المحاسبية؛
- Tenant / Branch Isolation؛
- الأمن والصلاحيات؛
- Backward Compatibility؛
- مصادر الحقيقة الحالية في أَوْج؛
- الاختبارات والمراجعة والأدلة القابلة للتتبع؛
- عدم الخلط بين Merge وDeploy/Release.

## دورة الأفق

الدورة المرجعية هي:

```text
Evidence Pass
→ Architecture / Decisions
→ Durable Repository Documentation
→ Scope + Definition of Done
→ Dependency-safe Task Queue
→ Launch Claude Code
→ PR-by-PR Implementation
→ Focused + Risk-based Tests
→ Implementer Self-Review
→ Reviewer Review
→ AWJ Guardian Review
→ CI on Exact Final Head
→ PRE_MERGE_REVIEW: PASS
→ Merge
→ POST_MERGE_REVIEW: PASS
→ Durable State / Implementation Report
→ Automatically select next genuinely-ready task
→ Continue until a Decision Gate or Horizon End
```

## قبل إطلاق التنفيذ

لا يبدأ أفق كبير مباشرة بالكود.

أولًا يجب، بقدر ما يتطلبه الأفق:

1. فحص الحالة الحالية الفعلية من `main` والتوثيق والتقارير الأخيرة، دون إعادة استكشاف المشروع من الصفر.
2. تنفيذ Evidence Pass مركز على نطاق الأفق.
3. التحقق من التوثيق الخارجي الرسمي/الأولي الحالي عندما يعتمد القرار على منصة أو مزود أو معيار متغير.
4. فصل:
   - **External Evidence**
   - **AWJ Decision**
   - **Open Decision**
5. تثبيت المعمارية والحدود ومصادر الحقيقة والـinvariants.
6. تعريف Scope وDefinition of Done وQuality Gates.
7. تقسيم الأفق إلى مهام صغيرة، مستقلة قدر الإمكان، ومرتبة حسب الاعتماديات.
8. توثيق الأفق والقرارات وحالة التنفيذ في المستودع.
9. تجهيز Bootstrap/Execution instruction واضح للوكيل المنفذ.

## التنفيذ الذاتي

بعد اعتماد الأفق وإطلاق Claude Code:

- يعمل ذاتيًا داخل الأفق المصرح فقط.
- لا ينتظر من صفوان كلمة «استمر» أو «التالي» بين الخطوات الروتينية.
- لا يبدأ من الصفر عند كل PR.
- يستخدم أحدث حالة موثقة وImplementation Report/Handoff.
- لا ينشئ dependent stacked PRs افتراضيًا.
- لا يعتبر المهمة التابعة جاهزة حتى يكتمل المطلوب من المهمة السابقة، بما في ذلك Post-Merge Review عندما يكون الدمج اعتمادًا.
- لا يوسع النطاق أو يعمل refactoring جانبيًا بلا ضرورة.
- يراجع فشل CI المتعلق بالمهمة أولًا، ولا يدخل في polling أو إصلاحات غير مرتبطة بلا حاجة.

## الأدوار الأربعة

في كل مهمة يتصرف الوكيل بأربع قبعات:

1. **Implementer** — أصغر تنفيذ صحيح وقابل للصيانة.
2. **Reviewer** — مراجعة الـdiff كما لو كان من مهندس آخر.
3. **AWJ Guardian** — Tenant/Branch Isolation، المحاسبة، المخزون، التسعير، المدفوعات، الصلاحيات، البيانات، الأمن، Backward Compatibility.
4. **Researcher / Architect** — التحقق من الافتراضات والمصادر الرسمية واختيار المعمارية المناسبة عند الحاجة.

## Decision Escalation Gate

المبدأ:

> **Autonomous by default. Escalate by significance, not uncertainty alone.**

يتوقف الوكيل ويسأل صفوان عند قرار مادي عالي الأثر، مثل:

- تغيير semantics محاسبية أو مالية؛
- معمارية Tenant/Auth/Security جوهرية؛
- migration مدمرة أو غير قابلة للعكس أو خطر فقد بيانات؛
- breaking public API / Backward Compatibility؛
- مزود دفع/رسائل/شحن أو بنية تحتية استراتيجية؛
- قرار Apple/Google متعلق بالملكية أو signing أو release؛
- trade-off مادي في الأمن/البيانات/التكلفة؛
- توسع كبير خارج الأفق؛
- أسرار/credentials مميزة غير متاحة؛
- Production Deploy / Release؛
- عملية Production مدمرة؛
- قاعدة أعمال مكلفة أو غامضة لا يجوز افتراضها.

عند التصعيد يقدم Decision Packet يتضمن: المشكلة، أدلة المستودع، الأدلة الخارجية الحالية عند الحاجة، البدائل، المفاضلات، التوصية، الأثر، وهل يمكن استمرار عمل مستقل آمن.

## Merge / Review

صلاحية الدمج الدائمة لا تعني الدمج التلقائي بلا ضوابط.

قبل كل Merge:

- مراجعة جديدة للـfinal diff على **Exact Final Head SHA**؛
- Reviewer + AWJ Guardian؛
- الاختبارات المطلوبة؛
- CI المطلوب أخضر على نفس الـHead؛
- لا findings أو Decision Gate غير محلول؛
- تسجيل:
  - `PRE_MERGE_REVIEW: PASS`
  - `Reviewed Head SHA: <sha>`

أي تغيير في الـHead يبطل المراجعة السابقة.

بعد كل Merge:

- إثبات أن PR اندمج فعلًا؛
- تسجيل Merge SHA الحقيقي؛
- فحص نتيجة الدمج على target branch؛
- فحص post-merge checks المتاحة؛
- smoke/regression عند الحاجة؛
- تسجيل:
  - `POST_MERGE_REVIEW: PASS`
  - `Reviewed Merge SHA: <sha>`

فشل Post-Merge يمنع فتح الاعتماديات ويعالج Fix Forward عبر PR جديد. لا يعاد كتابة تاريخ `main`.

## Deploy / Production

**Merge ≠ Deploy.**

نظام الأفق لا يمنح صلاحية:

- Production Deploy؛
- Production Release؛
- تنفيذ migration مدمرة على Production؛
- نشر App Store / Google Play؛
- عمليات Production مدمرة.

هذه تحتاج موافقة صفوان الصريحة.

## إغلاق الأفق

ينتهي الأفق عندما:

- يتحقق Definition of Done الموثق؛ أو
- لا توجد مهمة dependency-ready داخله؛ أو
- يوجد Decision Gate حقيقي يمنع التقدم.

عند الإغلاق:

1. تثبيت الحالة النهائية والتقارير والأدلة في المستودع.
2. توضيح deferred/out-of-scope items حتى لا تُفهم كفشل أو نقص.
3. عدم الانتقال تلقائيًا إلى **أفق رئيسي جديد**.
4. يراجع صفوان + ChatGPT الإغلاق.
5. يُجهز الأفق التالي عبر Evidence/Architecture/Documentation.
6. بعد اعتماده يُطلق الوكيل من جديد.

هذا لا يمنع الانتقال التلقائي بين المهام **داخل الأفق نفسه**.

## اختيار الأداة

قبل مهمة تقنية كبيرة، يُختار أقل مسار تكلفة يحقق نفس الجودة:

- **ChatGPT:** التخطيط، Evidence/Architecture، مراجعة التقارير، المتطلبات، تقسيم المهام والـprompts.
- **Claude Code:** الأفق البرمجي الكبير، الاستكشاف العميق، التنفيذ متعدد الملفات، والمراجعات المتتابعة.
- **Cursor:** مهمة صغيرة/واضحة وPR مستقل.
- **Codex:** وصول مباشر للكود أو إصلاح Build/CI/اختبارات عندما يكون ذلك هو الأنسب.
- **Work:** فقط عندما نحتاج Workflow متعدد الخطوات أو ملفات/أدوات المشروع فعليًا.

لا تُستهلك Work/Codex بلا حاجة.

## أولوية المصادر

عند التعارض:

1. قرار صفوان الصريح الحالي.
2. قواعد أَوْج غير القابلة للتفاوض: سلامة/محاسبة/أمن/Tenant/Backward Compatibility.
3. ADR/قرارات وعقود المجال المقبولة الحالية.
4. repository implementation/tests الحالية.
5. خطة الأفق وحالة التنفيذ الحالية.
6. الأدلة الخارجية الحالية.
7. تفضيل الوكيل.

التوثيق يصف النية الحالية، لكنه ليس سببًا لتنفيذ افتراض قديم بشكل أعمى. أدلة المستودع والمصادر الرسمية قد تكشف تنفيذًا أفضل، مع الحفاظ على المتطلبات والـinvariants وتصعيد أي تغيير مادي.

## المرجع التنفيذي

هذا الملف يعرّف **اسم وأمر استدعاء نظام الأفق**.

التفاصيل التنفيذية الملزمة تبقى في:

- `00-START-HERE.md`
- `AUTONOMOUS-ENGINEERING-PROTOCOL.md`
- `QUALITY-GATES.md`
- `DECISION-ESCALATION.md`
- `CURRENT-STATE.md`
- `TASK-QUEUE.md`
- `MASTER-EXECUTION-PLAN.md`
- `ADR-CONVENTION.md`
- `IMPLEMENTATION-REPORT-CONVENTION.md`
- `.claude/AUTONOMOUS_ENGINEERING.md`

إذا تغير البروتوكول مستقبلًا، تُحدّث هذه الوثائق بدل الاعتماد على ذاكرة محادثة قديمة.
