# Active Agent Task

TASK_ID: ORCH-V2-DESIGN-001
STATUS: READY_FOR_CLAUDE
OWNER: Safwan
PLANNER_REVIEWER: ChatGPT
IMPLEMENTER: Claude Code

## العنوان

مراجعة وتصميم Orchestration V2 — Automatic Dispatch / Wake-up بين GitHub وClaude Code وOpenAI Reviewer.

## الهدف

راجع من داخل واقع مستودع AWJ تصميم V2 المقترح لإزالة حاجة Safwan لإيقاظ الطرف التالي يدويًا بعد كل انتقال حالة، مع الحفاظ الكامل على بوابات المالك والسلامة وعدم إنشاء حلقة agents غير محدودة.

هذه **مهمة تصميم ومراجعة فقط**. لا تنفذ GitHub Actions، ولا تضف secrets، ولا تنشئ dispatcher، ولا تغيّر كود التطبيق في هذه الدورة.

## نقطة البداية المؤكدة

V1 أصبح مدموجًا في `main` بعد نجاح `ORCH-TEST-001`. النموذج الحالي يعمل كالتالي:

`TASK.md → Claude Code → CLAUDE_REPORT.md → ChatGPT review → REVIEW.md → owner gate`

GitHub هو shared state، لكن Safwan ما زال يحتاج إلى إيقاظ الطرف التالي يدويًا. المطلوب في V2 هو إزالة هذا الدور اليدوي قدر الإمكان، لا إزالة سلطة Safwan.

## نتائج البحث الخارجي التي يجب التحقق منها وعدم افتراضها بلا مراجعة

1. توجد آلية رسمية حديثة من Anthropic باسم Claude Code Routines API، موصوفة كـExperimental، ويُفترض أنها تسمح بتشغيل Routine محفوظة في Claude Code Web عبر HTTP ويمكن استدعاؤها من GitHub Actions.
2. OpenAI Responses API يدعم background execution، والمحادثات/الاستمرارية وwebhooks عند اكتمال response، لكن هذا لا يثبت أن GitHub يستطيع إيقاظ جلسة ChatGPT التفاعلية الحالية نفسها.
3. GitHub Actions يوفر `concurrency` ويمكن استخدام dispatch events صريحة لتجنب loops الناتجة عن commits.
4. يجب عدم استخدام صلاحيات واسعة أو نمط غير آمن مثل تنفيذ كود PR غير موثوق ضمن سياق ذي صلاحيات مرتفعة. Secrets يجب أن تكون GitHub Actions Secrets وبأقل صلاحيات لازمة.

اعتبر هذه نقاط بحث من Planner وليست حقائق معمارية نهائية. إذا كانت آليات Anthropic/OpenAI الفعلية أو قيود المستودع تختلف، ارفع `CHALLENGE` أو `RISK` مع الدليل.

## المعمارية المقترحة للمراجعة

State machine مبدئي:

`READY_FOR_CLAUDE`
→ dispatcher/GitHub Action invokes Claude Code Routine
→ Claude writes/pushes `CLAUDE_REPORT.md: READY_FOR_REVIEW`
→ dispatcher invokes an OpenAI API Reviewer Agent
→ reviewer writes `REVIEW.md` as either `CHANGES_REQUESTED`, `APPROVED_FOR_OWNER`, or safe blocking state
→ `CHANGES_REQUESTED` may dispatch Claude for another bounded round
→ `APPROVED_FOR_OWNER` stops all automation and waits for Safwan.

لا تفترض أن OpenAI API Reviewer هو نفس جلسة ChatGPT التفاعلية التي يتحدث معها Safwan. صمّم الفصل بوضوح.

## عناصر الحالة المقترحة

راجع الحاجة إلى حقول مثل:

- `STATUS`
- `TASK_ID`
- `TURN`
- `REVISION`
- `EXPECTED_ACTOR`
- `LAST_PROCESSED_SHA`
- `MAX_ROUNDS`
- optional correlation/run identifiers

المطلوب منع duplicate execution، stale turns، concurrent writers، replay، infinite ping-pong، ومراجعة commit غير الذي نفذه Claude.

## داخل النطاق

- قراءة ملفات `docs/agent-workspace/*` و`.claude/AGENT_ORCHESTRATION.md` الحالية.
- فحص workflows/configuration الموجودة فقط بالقدر اللازم لفهم قيود GitHub Actions الحالية وعدم التعارض معها.
- تقييم التصميم المقترح مقابل واقع المستودع.
- تحديد أفضل trigger/dispatch topology لـClaude ولـOpenAI reviewer.
- تحديد state transitions وidempotency/concurrency/round limits/failure states.
- تحديد security/permissions/secrets model.
- تحديد owner gates التي يجب أن تبقى غير قابلة للتجاوز آليًا.
- تحديد ما إذا كان Prototype V2 ينبغي أن يكون داخل هذا المستودع أو isolated branch/workflow وبأي حدود.
- اقتراح implementation slices صغيرة قابلة للمراجعة لاحقًا.

## خارج النطاق

- أي implementation لـV2 الآن.
- إنشاء أو تعديل GitHub Actions workflows.
- إنشاء Claude Routine أو استدعائها فعليًا.
- استخدام/إنشاء OpenAI أو Anthropic credentials/secrets.
- تعديل التطبيق Laravel/Next.js.
- DB/schema/migrations/API/accounting/ZATCA/security/Tenant/Branch behavior changes.
- Merge أو Deploy أو Production Release.
- إعادة تصميم V1 بلا حاجة مثبتة.

## أسئلة إلزامية يجب أن يجيب عنها التقرير

1. هل يمكن لـGitHub Actions تشغيل Claude Code رسميًا بالطريقة المقترحة حاليًا؟ ما المتطلب/القيد؟
2. ما أفضل طريقة لتشغيل Reviewer آلي من OpenAI دون الادعاء بأنه نفس ChatGPT interactive session؟
3. من هو الـsingle writer لكل ملف/حالة؟ وكيف نمنع race conditions؟
4. كيف نضمن أن reviewer يراجع SHA الصحيح الذي أنتجه implementer؟
5. كيف نمنع loop لا نهائي أو تكرار نفس turn؟
6. ماذا يحدث إذا فشل Claude invocation، OpenAI invocation، push، أو GitHub Action؟
7. ما أقل `permissions` مطلوبة للـworkflow؟ وأين تحفظ الأسرار؟
8. كيف نتعامل مع fork/untrusted PRs أو أي event غير موثوق؟
9. ما الحالات التي يجب أن توقف automation فورًا وتعيدها إلى Safwan؟
10. هل الأفضل event-driven single dispatcher أم workflows منفصلة؟ ولماذا؟
11. هل يوجد سبب يجعل V2 غير مناسب الآن بسبب Experimental API أو تكلفة/اعتمادية؟ اقترح fallback إن لزم.
12. ما أصغر Prototype آمن يثبت wake-up end-to-end دون لمس كود AWJ أو production؟

## متطلبات التقرير

حدّث `docs/agent-workspace/CLAUDE_REPORT.md` مع:

- `TASK_ID: ORCH-V2-DESIGN-001`
- `STATUS: READY_FOR_REVIEW` إذا اكتمل التصميم، أو `WAITING_FOR_REVIEWER` إذا يوجد قرار/خطر يحتاج حسمًا قبل الإكمال.
- `TYPE: REPORT | PROPOSAL | CHALLENGE | RISK | QUESTION` حسب النتيجة.
- ملخص تنفيذي عربي.
- الأدلة من ملفات المستودع وأي توثيق رسمي استطعت التحقق منه.
- architecture/state machine المقترح.
- threat/failure model مختصر لكن صريح.
- permissions/secrets model.
- Prototype plan مقسّم إلى slices صغيرة.
- ما الذي تقترح قبوله/رفضه/تعديله من تصميم ChatGPT ولماذا.
- Branch/commit state إن توفرت.
- الخطوة التالية المقترحة.

## قواعد القرار

Claude Code ليس منفذًا أعمى. إذا وجدت تصميمًا أبسط أو أكثر أمانًا أو أن إحدى فرضيات Planner غير صحيحة، تحداها بالدليل.

لا توسّع المهمة إلى implementation. أي اقتراح implementation يبقى proposal فقط حتى مراجعة ChatGPT وموافقة Safwan على بدء التنفيذ.

## بوابات المالك

ممنوع في هذه المهمة: Merge، Deploy، Production Release، destructive operations، secrets creation/change، أو أي تغيير في accounting/security/API/DB/Tenant/Branch behavior.

أي V2 مستقبلية يجب أن تتوقف حتمًا عند `APPROVED_FOR_OWNER` وأي قرار مادي/حساس، ولا يجوز لها تحويل موافقة reviewer إلى موافقة merge/deploy.
