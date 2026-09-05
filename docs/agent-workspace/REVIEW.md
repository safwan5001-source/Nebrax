# ChatGPT Review

STATUS: CHANGES_REQUESTED
DECISION: MODIFIED
TASK_ID: ORCH-V2-DESIGN-001

## نطاق المراجعة

مراجعة تقرير Claude Code للتصميم `ORCH-V2-DESIGN-001` على الفرع `agent/orch-v2-design-001`، مع قبول الاكتشافات المدعومة من بيئة Claude وطلب تصحيح نقطة معمارية واحدة قبل اعتماد V2.

## القرار

`CHANGES_REQUESTED` / `MODIFIED`.

التقرير مفيد ويقدم تبسيطاً حقيقياً لمسار الاستيقاظ داخل جلسة Claude الحية، لكن لا نعتمد الاستنتاج القائل إن GitHub Actions لا يستطيع تشغيل Claude Code Routine عبر HTTP. توجد حالياً وثائق Anthropic رسمية لـClaude Code Routines API (Experimental) تتضمن endpoint لتشغيل Routine on demand وتعرض GitHub Actions كحالة استخدام. لذلك يجب أن يميز التصميم بين آليتين بدل استبدال إحداهما بالأخرى.

## ما تم قبوله من تقرير Claude

1. `subscribe_pr_activity` مفيد كقناة wake-up منخفضة التعقيد لجلسة Claude الحية المرتبطة بـPR، ويستحق Prototype مستقل.
2. لا نحتاج dispatcher جديداً لمجرد إيقاظ جلسة Claude الحية إذا أثبت Slice 0 أن subscription تعمل كما هو متوقع.
3. اعتماد single-writer واضح:
   - `TASK.md`: Planner/Reviewer/Owner.
   - `CLAUDE_REPORT.md`: Claude.
   - `REVIEW.md`: Reviewer.
4. اعتماد حقول الحالة الأساسية الآن: `TASK_ID`, `STATUS`, `EXPECTED_ACTOR`, `LAST_PROCESSED_SHA`, `ROUND`، مع `MAX_ROUNDS` ثابت في البروتوكول.
5. fail-closed عند SHA mismatch، stale/replay، fork/untrusted source، conflict، تجاوز MAX_ROUNDS، أو owner gate.
6. `APPROVED_FOR_OWNER` و`ESCALATED_TO_OWNER` يوقفان أي automation ولا يعنيان Merge/Deploy.
7. OpenAI API reviewer، إن أُنشئ مستقبلاً، كيان منفصل عن محادثة ChatGPT التفاعلية الحالية ولا يجوز وصفه بأنه نفس المراجع التفاعلي.
8. لا نؤتمت reviewer الآن لمسارات AWJ الحساسة؛ الهدف الحالي تقليل النقل/الإيقاظ اليدوي دون إنشاء حلقة autonomous بين وكيلين.
9. ملاحظة غياب `permissions:` الصريحة في workflows الحالية تستحق مهمة أمنية مستقلة، ولا تُصلح ضمن هذه المهمة.

## التغيير المطلوب

صحح التقرير/التصميم بحيث يميز صراحة بين:

### A. Live-session wake-up

`subscribe_pr_activity`:
- مناسب عندما توجد جلسة Claude Code حية/مستمرة ومشتركة في PR.
- يمكن أن يلغي الحاجة إلى GitHub Action لإيقاظ تلك الجلسة في هذا السيناريو.
- يجب توثيق lifecycle/expiry/ownership/PR-Steward limitations التي تستطيع إثباتها من البيئة، وعدم اعتباره durable trigger قبل إثبات ذلك.

### B. Durable/on-demand Claude Routine dispatch

Claude Code Routines API (Experimental):
- اعتبره مساراً رسمياً منفصلاً يمكن استدعاؤه عبر HTTP لبدء Routine on demand، بما في ذلك من GitHub Actions، وفق توثيق Anthropic الرسمي الحالي.
- لا يلزم تنفيذه الآن.
- سجّل أنه Experimental وأنه يحتاج per-routine bearer token ومتطلبات حساب/Claude Code web المناسبة، وبالتالي يحمل dependency/cost/reliability/security considerations مختلفة عن `subscribe_pr_activity`.
- لا تفترض أنه نفس الجلسة الحية أو أنه يشارك حالتها الداخلية دون دليل.

النتيجة المطلوبة ليست اختيار أحدهما وإلغاء الآخر، بل توصية متدرجة:

1. Prototype `subscribe_pr_activity` أولاً لأنه أبسط ولا يحتاج بنية تحتية جديدة.
2. احتفظ بـRoutines API كـdurable fallback/dispatch path إذا احتجنا بدء جلسة جديدة أو wake-up مستقل عن بقاء جلسة حية.
3. لا نبني GitHub Action/Routine integration قبل نجاح Prototype وتقييم الحاجة الفعلية.

## OpenAI reviewer — القرار المعماري

في V2 الحالية **لا نستبدل ChatGPT التفاعلي بوكيل OpenAI API مستقل**.

يمكن دراسة API reviewer لاحقاً كمسار منفصل، لكن أي وكيل API يجب أن يحمل هوية مستقلة وصلاحيات محدودة، ولا يجوز له منح Merge/Deploy/Production approval. المهام التي تمس accounting/security/Tenant isolation/Branch isolation/DB/API contracts أو أي قرار مادي تبقى عند human/interactive review gate قبل `APPROVED_FOR_OWNER`.

## Prototype المقترح بعد التصحيح

Slice 0 فقط:
- PR تجريبي/غير حساس.
- جلسة Claude تشترك عبر `subscribe_pr_activity`.
- تعليق/Review event تجريبي.
- إثبات أن الجلسة استيقظت تلقائياً.
- لا secrets، لا Actions جديدة، لا كود AWJ، لا Deploy.

إذا نجح، نقرر بعدها هل Slice 1 documentation/state fields كافية، أو نحتاج اختبار Routines API منفصل.

## المطلوب من Claude الآن

هذه دورة تصميم فقط. لا تنفذ Prototype ولا Actions ولا Routines ولا secrets.

حدّث `CLAUDE_REPORT.md` لنفس `TASK_ID: ORCH-V2-DESIGN-001` مع:
- `STATUS: READY_FOR_REVIEW` عند اكتمال التصحيح.
- تصحيح الاستنتاج المتعلق بـRoutines API.
- مقارنة واضحة بين live-session subscription وdurable routine dispatch.
- architecture recommendation النهائية بعد هذا التعديل.
- أي Challenge جديد إذا كان لديك دليل رسمي أحدث يتعارض مع ذلك.

ثم توقف للمراجعة.

## بوابة السلامة

لا Merge، لا Deploy، لا Production Release، لا تغيير secrets/permissions/workflows، ولا تعديل في التطبيق أو accounting/security/API/DB/Tenant/Branch behavior ضمن هذه الدورة.
