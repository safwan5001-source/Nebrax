# Claude Code Report

STATUS: READY_FOR_REVIEW
TYPE: REPORT
TASK_ID: ORCH-V2-DESIGN-001

## ملخص تنفيذي

هذه دورة `CHANGES_REQUESTED` مقيّدة بالضبط بما طلبته `REVIEW.md`: تصحيح استنتاج واحد كان خاطئاً في تقريري السابق، دون تنفيذ أي Prototype أو Action أو secret. لم أُغيّر أي كود تطبيق.

**تراجُع صريح عن استنتاج سابق:** تقريري الأول ادّعى أن افتراض "GitHub Action يستدعي Claude Code Routine عبر HTTP" غير دقيق. **هذا كان خطأ مني.** تحققت الآن من التوثيق الرسمي مباشرة (`code.claude.com/docs/en/routines` و`platform.claude.com/docs/en/api/claude-code/routines-fire`، وليس من ذاكرة أو تخمين)، والمراجع كان محقاً: توجد **Claude Code Routines API** رسمية (Experimental) بنقطة `/fire` تُستدعى عبر HTTP بـbearer token مخصص للـroutine، وتوثيق Anthropic نفسه يعرض مثال GitHub Actions step يستدعيها عند فشل CI. كما توجد GitHub triggers أصلية للـRoutines (بلا حاجة لأي Action وسيط) تعمل عبر GitHub App مثبَّت على المستودع.

الخلاصة الصحيحة إذن: **آليتان حقيقيتان ومختلفتان تماماً**، لا آلية واحدة تُبطل الأخرى:

| | A. Live-session subscription (`subscribe_pr_activity`) | B. Routines API/GitHub trigger |
|---|---|---|
| ما تُوقظه | **جلسة Claude الحية القائمة فعلاً** (هذه الجلسة نفسها)، بكل سياقها المتراكم | **جلسة جديدة كل مرة** — "Claude Code doesn't reuse sessions across events, so two PR updates produce two independent sessions" (موثّق رسمياً) |
| البنية التحتية المطلوبة | لا شيء — أداة MCP مدمجة في الجلسة | Routine مُعرَّف مسبقاً في `claude.ai/code/routines` + (لـGitHub trigger) تثبيت Claude GitHub App على المستودع |
| المُشغِّل (trigger) | تعليق/مراجعة/CI على PR مُشترَك فيه | **GitHub trigger**: فئتا حدث فقط موثقتان رسمياً — **Pull request** (opened/closed/assigned/labeled/synchronized/…) و**Release** — لا فئة "comment" منفصلة موثّقة صراحة. **API trigger**: POST مصادَق بـbearer token من أي مصدر (بما فيه GitHub Action) |
| الاستمرارية/الذاكرة | تستيقظ بذاكرة المحادثة الكاملة | جلسة صفر في كل مرة — يجب أن تُعيد قراءة `PROTOCOL.md`/`TASK.md`/`DECISIONS.md` من الصفر (وهذا **متوافق فعلاً** مع تصميم AWJ الحالي: `AGENT_ORCHESTRATION.md` أصلاً يطلب قراءة هذه الملفات في بداية كل دورة، لا الاعتماد على ذاكرة محادثة) |
| الأتمتة أثناء التشغيل | هذه الجلسة تعمل بنفس وضع الصلاحيات المُهيَّأ لها في هذه المحادثة (استمرار طبيعي، لا تغيير) | موثّق رسمياً: **"there is no permission-mode picker and no approval prompts during a run"** — الـRoutine تعمل بصلاحية كاملة تلقائياً بلا أي موافقة تفاعلية على أي خطوة |
| Idempotency | يتحكم بها منطق AWJ نفسه (state file) | **لا يوجد idempotency key في `/fire`** (موثّق رسمياً: "There is no idempotency key. If a webhook caller retries, the endpoint creates multiple sessions") — الحماية الوحيدة من التكرار هي منطق AWJ نفسه (`LAST_PROCESSED_SHA`/`ROUND`) |
| نطاق الاعتماد (Credential) | لا credential جديد | Bearer token **مخصص لـroutine واحد فقط، بلا صلاحية قراءة** ("scoped to a single routine... grants no read access") — نطاق ضيق جيد إن استُخدم |
| النضج | مدمجة اليوم في هذه الجلسة، مُختبَرة بحكم الاستخدام | **Experimental بحكم توثيق Anthropic نفسه** — رأس `anthropic-beta: experimental-cc-routine-2026-04-01` إلزامي، وشكل الطلب/الاستجابة قابل للتغيير |

## ما تصحّح بالضبط (حسب طلب `REVIEW.md`)

### A. Live-session wake-up — كما ورد، مع توضيح الحدود القابلة للإثبات فعلاً من البيئة

`subscribe_pr_activity` مناسب فقط عندما توجد جلسة Claude حية مشترِكة أصلاً في الـPR (كحال هذه الجلسة الآن). حدوده المُثبَتة من وصف الأداة نفسها لا من افتراض:
- تُسلَّم فقط أنواع أحداث محددة: تعليقات، فشل CI، ونجاح check-suite rollups.
- **قيد ملكية:** "if a Claude agent (PR Steward) is already watching the PR, the call succeeds but this session will NOT receive events" — مراقب واحد فعّال فقط لكل PR عبر هذه الأداة تحديداً.
- **دورة الحياة:** الاشتراك ينتهي بانتهاء الجلسة؛ لا استمرارية عبر إعادة تشغيل الحاوية أو انتهاء الجلسة، ولم أجد في وصف الأداة ما يثبت مدة صلاحية أطول من عمر الجلسة — لا أفترض خلاف ذلك.

### B. Durable/on-demand Claude Routine dispatch — مسار رسمي منفصل، مُتحقَّق منه الآن مباشرة

مسار حقيقي وموثَّق رسمياً (`code.claude.com/docs/en/routines`، `platform.claude.com/docs/en/api/claude-code/routines-fire`)، وليس Experimental بمعنى "غير موجود" بل Experimental بمعنى "شكل الـAPI قابل للتغيير":

- **API trigger:** `POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire` — رؤوس إلزامية: `Authorization: Bearer sk-ant-oat01-...` (خاص بـroutine واحد)، `anthropic-beta: experimental-cc-routine-2026-04-01`، `anthropic-version`. جسم اختياري `text` (حتى 65536 حرفاً) يصل للـRoutine **مُغلَّفاً صراحةً كبيانات غير موثوقة** (`<routine-fire-payload>`) ما لم يُشِر prompt الـRoutine المحفوظ إليه صراحةً — هذا تصميم أمان جيد يستحق تبنّيه لو استُخدم لاحقاً في AWJ (أي reviewer/dispatcher لا يمرر تعليمات تُنفَّذ مباشرة، بل بيانات يقرر prompt الـRoutine المحفوظ مسبقاً كيف يعاملها).
- **GitHub trigger:** يتطلب تثبيت Claude GitHub App على المستودع، ويدعم فئتين موثّقتين فقط: **Pull request** (بفلاتر: المؤلف، العنوان، الوصف، الفرع الأساسي/المصدر، التصنيفات، draft، merged) و**Release**. **لم أجد فئة "comment" منفصلة موثّقة** — إن احتجنا لاحقاً إيقاظ Routine تحديداً على تعليق مراجعة (لا على فتح/تحديث PR)، هذا يحتاج تحققاً إضافياً غير مثبت اليوم، لا افتراضاً.
- **كل استدعاء (API أو GitHub) يُنشئ جلسة جديدة منفصلة تماماً** — لا استمرارية سياق بين الاستدعاءات، بعكس مسار A.
- **بلا idempotency key:** إعادة محاولة webhook تُنشئ جلسات متعددة — أي استخدام مستقبلي لهذا المسار في AWJ **يجب** أن يعتمد على حقل `LAST_PROCESSED_SHA`/`ROUND` في `TASK.md` نفسه لرفض التنفيذ المكرر، لا على الـAPI لحمايته من ذلك.
- **بلا أي بوابة موافقة تفاعلية أثناء التشغيل** (موثّق رسمياً: "no permission-mode picker and no approval prompts during a run") — هذه أهم نقطة أمان اكتشفتها بالتحقق المباشر، وتُقوّي بشدة الـRISK الذي رفعته في تقريري السابق حول الأتمتة الكاملة: أي Routine يُستدعى تلقائياً (سواء لتنفيذ Claude أو لمراجعة OpenAI مستقبلية) يعمل **بصلاحية كاملة بلا نقطة توقف بشرية واحدة** خلال الجلسة نفسها. البروتوكول (`PROTOCOL.md`) يبقى الحارس الوحيد حينها — الالتزام بالتوقف عند `READY_FOR_REVIEW`/`WAITING_FOR_REVIEWER` يعتمد كلياً على أن الـprompt المحفوظ في الـRoutine يفرضه بدقة، لا على أي حاجز تقني خارجي.

## نتيجة الاختبار المطلوبة (بعد التصحيح)

**لا نستبدل A بـB ولا العكس — كلاهما صالح لغرض مختلف:**

- **A (`subscribe_pr_activity`)** هو الأنسب لإيقاظ **هذه الجلسة الحية تحديداً** أثناء دورة عمل مستمرة — بلا أي بنية تحتية جديدة. هذا ما يُثبته Slice 0 المتفق عليه.
- **B (Routines API/GitHub trigger)** هو المسار الصحيح إن احتجنا لاحقاً **بدء جلسة جديدة** بشكل مستقل عن بقاء أي جلسة حية (مثلاً بعد انتهاء هذه الجلسة، أو لمراجعة تلقائية دورية) — لكنه يحمل اعتمادية Experimental، غياب idempotency، وغياب بوابة موافقة تفاعلية أثناء التشغيل، وهي اعتبارات يجب أن يُصممها `PROTOCOL.md` صراحةً (عبر `LAST_PROCESSED_SHA`/`ROUND` والـprompt المحفوظ) قبل أي استخدام فعلي — لا الاعتماد على الـAPI نفسها لتوفيرها.

هذا يتطابق تماماً مع التوصية المتدرجة التي طلبتها `REVIEW.md`: Slice 0 (مسار A) أولاً، والاحتفاظ بمسار B كـ**durable fallback/dispatch path** موثَّق دون تنفيذ، حتى تثبت الحاجة الفعلية بعد نجاح Slice 0.

## التحديثات المقبولة من `REVIEW.md` (بلا تعديل)

كل ما ورد في `REVIEW.md` تحت "ما تم قبوله من تقرير Claude" (البنود 1–9) يبقى كما هو ومُعتمَد: single-writer لكل ملف، حقول الحالة الأساسية (`TASK_ID`/`STATUS`/`EXPECTED_ACTOR`/`LAST_PROCESSED_SHA`/`ROUND` + `MAX_ROUNDS` ثابت)، fail-closed عند أي شذوذ، عدم أتمتة الـreviewer الآن، وملاحظة فجوة `permissions:` كمهمة منفصلة. لم يطلب المراجع تغيير أي من هذه البنود، فلم أُعِد فتحها.

## OpenAI reviewer — مثبَّت كما قرره المراجع

`REVIEW.md` حسم هذا صراحةً: **لا استبدال لمحادثة ChatGPT التفاعلية بوكيل OpenAI API مستقل في V2 الحالية**. أي وكيل API مستقبلي يحمل هوية وصلاحيات منفصلة ولا يمنح Merge/Deploy، والمهام المحاسبية/الأمنية/العزل تبقى عند بوابة مراجعة بشرية تفاعلية قبل `APPROVED_FOR_OWNER`. هذا يتوافق مع الـRISK الذي رفعته سابقاً وأزيد عليه الآن بالدليل الموثّق أعلاه عن غياب موافقة تفاعلية داخل تشغيل الـRoutine نفسه — سبب إضافي لعدم أتمتة أي reviewer على مسارات AWJ الحساسة الآن.

## Prototype (بلا تغيير عن قرار المراجع — Slice 0 فقط، غير مُنفَّذ في هذه الدورة)

كما ورد في `REVIEW.md`: PR تجريبي، اشتراك عبر `subscribe_pr_activity`، تعليق تجريبي، إثبات الاستيقاظ، بلا secrets ولا Actions جديدة ولا كود AWJ. **لم أنفّذ هذا الـSlice في هذه الدورة** — التكليف الحالي تصحيح تقرير فقط.

## Safety / compatibility assessment

- Accounting/Data/Security/Tenant/Branch isolation/API/DB: لا تغيير — تصحيح توثيقي بحت لتقرير تصميم، بلا أي كود.
- لا secrets جديدة، لا GitHub Actions جديدة، لا Routines أُنشئت فعلياً.

### Accounting entries

N/A — no accounting impact.

## Risks / remaining work

- **جديد، بدليل رسمي مباشر:** أي استخدام مستقبلي لمسار B (Routines) يجب أن يُصمَّم بافتراض أن الجلسة الناتجة **تعمل بصلاحية كاملة بلا موافقة بشرية أثناء التشغيل** — هذا يرفع أهمية أن يكون prompt الـRoutine المحفوظ صارماً في الالتزام بالتوقف عند بوابات `PROTOCOL.md` (`READY_FOR_REVIEW`/`WAITING_FOR_REVIEWER`/`APPROVED_FOR_OWNER`)، لأن لا حارس تقني خارجي يفرض ذلك غير الالتزام النصي بالـprompt نفسه.
- **جديد:** غياب idempotency في `/fire` يعني أن أي تصميم مستقبلي لمسار B **يعتمد كلياً** على `LAST_PROCESSED_SHA`/`ROUND` في ملفات AWJ لمنع التنفيذ المكرر عند إعادة محاولة webhook — ليس تفصيلاً نظرياً، بل خاصية مؤكدة في التوثيق الرسمي.
- **جديد:** تغطية "GitHub trigger" الرسمية للـRoutines لا تشمل فئة "تعليق" موثّقة صراحة (فقط Pull request وRelease) — إن احتاج تصميم لاحق إيقاظ Routine على تعليق مراجعة تحديداً (لا فتح/تحديث PR)، هذا يحتاج تحققاً إضافياً منفصلاً قبل الاعتماد عليه، ولا أفترضه اليوم.
- لا مخاطر أخرى جديدة عن الدورة السابقة.

## Question / proposal / risk / challenge

لا شيء جديد يستوجب `WAITING_FOR_REVIEWER` — هذه دورة تصحيح مقيدة أنجزت المطلوب بالضبط. النقاط الثلاث في "Risks / remaining work" أعلاه إضافات توثيقية للـthreat model تدعم القرار المُتَّخذ فعلاً (Slice 0 أولاً)، لا اعتراضاً عليه.

## Git state

- Branch: `agent/orch-v2-design-001`.
- PR: لا يوجد — تصحيح تصميم فقط.
- Base SHA (قبل هذه الدورة، commit طلب التصحيح): `ff8d401a110a03a364ba5edaa99b478af81568bd`
- Head SHA بعد هذه الدورة: يُحدَّد بعد الـcommit.

## الخطوة التالية المقترحة

مراجعة ChatGPT لهذا التصحيح تحديداً (الجدول المقارن + الحقائق الثلاث الجديدة المُتحقَّق منها رسمياً). إن اعتُمد، الخطوة التالية الطبيعية هي تنفيذ Slice 0 فعلياً (يحتاج `TASK_ID` جديداً أو تمديد نطاق صريح لهذه المهمة)، ولا يزال ذلك خارج نطاق هذه الدورة.
