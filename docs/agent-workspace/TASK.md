# Active Agent Task

TASK_ID: ORCH-V2-SLICE0-001
STATUS: READY_FOR_CLAUDE
OWNER: Safwan
PLANNER_REVIEWER: ChatGPT
IMPLEMENTER: Claude Code
EXPECTED_ACTOR: CLAUDE
ROUND: 0
MAX_ROUNDS: 2
LAST_PROCESSED_SHA: 6c9a92db6363558523f77294052be3a90e572812

## العنوان

Orchestration V2 Slice 0 — إثبات live-session wake-up عبر `subscribe_pr_activity`.

## الهدف

إثبات أو نفي أن جلسة Claude Code الحية تستطيع الاشتراك في PR تجريبي ثم الاستيقاظ تلقائياً عند حدث PR مدعوم، بدون أن يطلب Safwan منها يدوياً "شيك" بعد إنشاء الحدث.

هذه تجربة orchestration غير حساسة فقط. لا تغيّر كود AWJ ولا أي workflow أو secret أو Routine.

## نقطة البداية المؤكدة

تم اعتماد ودمج تصميم `ORCH-V2-DESIGN-001` في `main` عند SHA:

`6c9a92db6363558523f77294052be3a90e572812`

القرار المعتمد:
- نختبر `subscribe_pr_activity` أولاً لأنه أبسط مسار لإيقاظ جلسة Claude الحية.
- لا نعتبره durable trigger؛ الاشتراك مرتبط بعمر/ملكية الجلسة وPR Steward.
- Routines API يبقى fallback منفصلاً ولا يدخل في Slice 0.

## داخل النطاق

1. اقرأ `docs/agent-workspace/PROTOCOL.md`, `TASK.md`, `REVIEW.md`, `DECISIONS.md`, و`.claude/AGENT_ORCHESTRATION.md` بالقدر اللازم.
2. استخدم الفرع `agent/orch-v2-slice0-001` فقط لهذه التجربة.
3. أنشئ/استخدم PR تجريبي لهذا الفرع مقابل `main` إذا لم يكن موجوداً.
4. اشترك في نشاط ذلك الـPR باستخدام `subscribe_pr_activity` من **الجلسة الحية الحالية**.
5. بعد نجاح الاشتراك، سجّل في `CLAUDE_REPORT.md` حالة انتظار واضحة تتضمن رقم PR وأن الاشتراك أصبح active، ثم توقف وانتظر الحدث التجريبي من Reviewer/Owner.
6. عند وصول الحدث تلقائياً، سجّل الدليل: نوع الحدث، هل استيقظت الجلسة دون رسالة يدوية من Safwan، والقيود التي ظهرت فعلياً.
7. لا تعتبر الاختبار ناجحاً إلا إذا استيقظت الجلسة بسبب حدث PR نفسه دون wake-up يدوي من Safwan بعد الاشتراك.

## بروتوكول الاختبار

### Phase A — Setup / Subscribe

Claude:
- يتحقق أن `TASK_ID` صحيح.
- يفتح PR تجريبي إن لزم، أو يستخدم PR الخاص بهذا الفرع.
- يستدعي `subscribe_pr_activity` لذلك PR.
- يحدّث `CLAUDE_REPORT.md` إلى:
  - `TASK_ID: ORCH-V2-SLICE0-001`
  - `STATUS: WAITING_FOR_REVIEWER`
  - `TYPE: REPORT`
  - PR number
  - subscription result
  - عبارة صريحة أنه الآن ينتظر event ولا يحتاج Safwan لإرسال رسالة أخرى إذا كانت الآلية تعمل.
- يدفع التقرير إلى نفس الفرع ثم يتوقف.

### Phase B — Wake event

Reviewer/Owner يرسل **تعليق PR تجريبي واحد فقط** بعد التأكد من Phase A.

النص المقترح للحدث:
`ORCH-V2-SLICE0-001 WAKE TEST — acknowledge this event in CLAUDE_REPORT.md; do not change application code.`

Claude عند الاستيقاظ التلقائي:
- لا ينفذ أي كود تطبيق.
- يحدّث `CLAUDE_REPORT.md` إلى `STATUS: READY_FOR_REVIEW`.
- يسجل timestamp/event type/PR number والنتيجة PASS أو FAIL.
- PASS فقط إذا لم يحتج Safwan لإيقاظ الجلسة يدوياً بعد تعليق الـPR.
- ثم يتوقف للمراجعة.

## معايير النجاح

PASS إذا تحقق جميع الآتي:
- subscription نجح في جلسة Claude الحية.
- حدث PR المدعوم وصل للجلسة.
- الجلسة استيقظت وعالجت الحدث دون رسالة يدوية جديدة من Safwan.
- `CLAUDE_REPORT.md` سجل الدليل والنتيجة.
- لا تغييرات خارج ملفات agent-workspace اللازمة للتجربة.

FAIL/BLOCKED إذا:
- subscription غير متاح أو رفض بسبب PR Steward/ownership.
- الجلسة انتهت قبل الحدث.
- الحدث لم يصل أو احتاج wake-up يدوي.
- ظهرت قيود تجعل الآلية غير موثوقة للغرض المقصود.

عند FAIL/BLOCKED لا تحاول Routines API تلقائياً؛ سجل النتيجة وتوقف للمراجعة.

## خارج النطاق

- Laravel/Next.js/application code.
- Accounting/ZATCA/data/security/API/DB/Tenant/Branch behavior.
- GitHub Actions أو تعديل workflows.
- Secrets/credentials.
- Claude Code Routines API أو إنشاء Routine.
- OpenAI API reviewer.
- Merge/Deploy/Production Release.
- أي refactor أو إصلاح CI جانبي.

## متطلبات التقرير النهائي

`docs/agent-workspace/CLAUDE_REPORT.md` يجب أن يتضمن:
- TASK_ID/status/type.
- Branch/PR/Base SHA/Head SHA إن توفرت.
- نتيجة subscribe_pr_activity.
- event المستخدم للاختبار.
- هل حدث wake تلقائي بدون تدخل Safwan: YES/NO.
- PASS/FAIL/BLOCKED مع السبب.
- الملفات المتغيرة.
- الاختبارات: N/A للتطبيق، مع توضيح أن الاختبار orchestration-only.
- المخاطر/القيود.
- الخطوة التالية المقترحة.

## بوابات السلامة

لا Merge، لا Deploy، لا Production، لا secrets، لا workflows، لا Routines، ولا تغييرات تطبيق/محاسبة/API/DB/Tenant/Branch.

أي شيء خارج الاختبار المحدد أعلاه = توقف وارفع `WAITING_FOR_REVIEWER` أو `BLOCKED`.
