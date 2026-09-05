# ChatGPT Review

STATUS: APPROVED_FOR_OWNER
DECISION: ACCEPTED
TASK_ID: ORCH-V2-DESIGN-001

## نطاق المراجعة

المراجعة النهائية لتصحيح Claude Code على `ORCH-V2-DESIGN-001` بعد دورة `CHANGES_REQUESTED`.

## القرار

`ACCEPTED` / `APPROVED_FOR_OWNER`.

تم تصحيح النقطة المعمارية المطلوبة بصورة كافية، وأصبح التصميم يميز بوضوح بين آليتين مستقلتين:

1. `subscribe_pr_activity` كمسار منخفض التعقيد لإيقاظ جلسة Claude الحية المرتبطة بـPR، مع حدود lifecycle/ownership وعدم اعتباره durable trigger.
2. Claude Code Routines API / GitHub trigger كمسار رسمي Experimental لبدء جلسة جديدة مستقلة، مع متطلبات وصلاحيات ومخاطر مختلفة.

## ما تم اعتماده

- single-writer لكل ملف orchestration.
- حقول الحالة: `TASK_ID`, `STATUS`, `EXPECTED_ACTOR`, `LAST_PROCESSED_SHA`, `ROUND`، و`MAX_ROUNDS` ثابت في البروتوكول.
- fail-closed عند SHA mismatch، stale/replay، fork/untrusted source، conflict، max rounds، أو owner gate.
- `APPROVED_FOR_OWNER` و`ESCALATED_TO_OWNER` حالتا توقف ولا تعنيان Merge/Deploy.
- عدم استبدال ChatGPT التفاعلي بـOpenAI API reviewer في V2 الحالية.
- عدم أتمتة المراجعة لمسارات AWJ الحساسة في هذه المرحلة.
- Prototype متدرج يبدأ بـSlice 0 عبر `subscribe_pr_activity` فقط.
- Routines API يبقى durable/on-demand fallback محتمل، ولا يُنفذ قبل إثبات الحاجة.

## ملاحظات أمان مهمة محفوظة للتصميم اللاحق

- `/fire` لا يوفر idempotency key؛ أي استخدام مستقبلي يحتاج حماية AWJ من التكرار عبر state/SHA/round.
- Routine تبدأ جلسة جديدة مستقلة ولا تعتمد على استمرارية سياق الجلسة الحية.
- تشغيل Routine غير تفاعلي، لذلك لا يجوز اعتباره بديلاً عن بوابات المراجعة البشرية في المسارات الحساسة.
- فجوة `permissions:` في GitHub workflows الحالية تبقى مهمة أمنية مستقلة ولا تدخل في هذا الـscope.

## الخطوة التالية المعتمدة للتخطيط

إنشاء مهمة جديدة مستقلة لـSlice 0 لاختبار live-session wake-up:

- PR تجريبي غير حساس.
- Claude يشترك عبر `subscribe_pr_activity`.
- حدث تعليق/مراجعة تجريبي.
- إثبات هل تستيقظ الجلسة تلقائياً أم لا.
- لا application code، لا secrets، لا Actions جديدة، لا Routines، لا Deploy/Production.

لا يتم توسيع `ORCH-V2-DESIGN-001` لتنفيذ الـPrototype؛ يجب أن يكون له `TASK_ID` مستقل للحفاظ على audit trail واضح.

## بوابة السلامة

هذا الاعتماد تقني للتصميم فقط. لا يمنح موافقة Merge أو Deploy أو Production Release، ولا يجيز أي تغيير محاسبي/أمني/API/DB/Tenant/Branch behavior.
