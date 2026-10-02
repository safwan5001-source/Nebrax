# نظام تنفيذ أَوْج v3 بالآفاق (Horizon Execution System)

> **الحالة:** منهج تنفيذ رسمي لـ AWJ Design System v3.
> هذه الوثيقة تنظّم كيف ننفّذ v3 دون تشتّت أو Big Bang، ولا تغيّر أي كود إنتاج بذاتها.
> المواصفة التصميمية تحدد الهدف؛ هذه الوثيقة تحدد إيقاع التنفيذ، حدود كل أفق، وصلاحية الإبداع داخله.

## 1. لماذا نظام الأفق

لا يُدار التحول التصميمي كسلسلة طويلة من مهام صغيرة منفصلة. كل Horizon هو نتيجة منتج كاملة نسبياً، لها:
- هدف واضح يمكن رؤيته والتحقق منه.
- Scope مغلق بما يكفي لمنع التشتّت.
- مساحة تنفيذ وإبداع واسعة داخله.
- اختبارات وأدلة بصرية وCI قبل الإغلاق.
- تقرير Handoff نهائي يحفظ الحالة المؤكدة للأفق التالي.
- توقف قبل الدمج ما لم توجد موافقة صريحة من المالك.

**القاعدة:** الأفق يقاس بالنتيجة وليس بعدد الملفات أو الـPRs. يمكن أن يحتاج PR واحداً أو أكثر إذا كان ذلك أكثر أماناً.

## 2. صلاحية Claude Code داخل الأفق

داخل أي Horizon معتمد، يُعامل Claude Code كـ **Product Design Lead + Frontend Engineer**، لا كمنفّذ Pixel-by-Pixel.

### حرية UI/UX
يجوز له عندما يرى أن ذلك يحسن النتيجة:
- إعادة ترتيب visual hierarchy أو composition.
- تعديل spacing / density / proportions.
- تحسين shell، navigation، grids، forms، document anatomy، states، empty/loading/error states.
- اقتراح interaction أو pattern أفضل من الـPrototype.
- رفض تفصيلة من الـPrototype إذا لم تستحق التعميم.
- إعادة بناء component composition داخل Scope الأفق.
- تحسين responsive behavior وRTL/LTR وkeyboard flows.
- ابتكار micro-interactions وظيفية لا تضر الكثافة أو السرعة.
- إنشاء بديل تصميمي جديد إن كان أقوى، مع إثبات بصري وشرح مختصر.
- تعديل قيم تصميمية غير محاسبية إذا أثبت الاختبار أن البديل أفضل.

**الـPrototype مرجع واتجاه، وليس Pixel Spec.**

لا يحتاج موافقة مسبقة على التفاصيل الدقيقة مثل فروق spacing الصغيرة، hierarchy فرعي، تنظيم card/grid داخلي، microcopy غير محاسبي، أو تحسينات accessibility/responsive لا تغير منطق المنتج. تُوثق القرارات المهمة في التقرير النهائي.


## 2A. Design Unification Contract

الهدف النهائي ليس فقط "تحسين الشاشات"، بل **توحيد لغة أَوْج التصميمية على مستوى النظام كله**.

### النواة الموحّدة
يجب أن تشترك كل مساحات الإدارة في:
- typography hierarchy واحدة.
- spacing logic واحدة.
- radius / border / elevation grammar واحدة.
- focus / hover / selected / editing semantics موحّدة.
- Money presentation موحّدة.
- Button / Input / Select / Badge / Dialog / Drawer grammar موحّدة.
- Empty / Loading / Error / Read-only states موحّدة.
- DataTable / List / Filter / Toolbar / Pagination grammar موحّدة.
- Document Workspace grammar موحّدة.
- RTL/LTR behavior موحّد.
- responsive rules موحّدة.
- Theme contract موحّد: Default وInk فوق نفس المكونات، لا تصميمان منفصلان.

### قاعدة المكوّن الواحد
إذا كان هناك Pattern أو Component مركزي موجود، **MUST NOT** يبني Module نسخة محلية تنافسه.
إذا احتاج Module إلى Variant جديد:
1. يُراجع أولاً هل يمكن تمثيله بVariant مركزي.
2. إذا نعم، يُضاف للنظام المركزي ثم يُستهلك.
3. إذا لا، يُوثق الاستثناء وسبب عدم صلاحيته للتعميم.

### الاستثناءات المسموحة
Floor/POS وStudio/Builder يجوز أن يختلفا وظيفياً وبصرياً بما يلائم العمل، لكنهما لا ينفصلان عن Shared Core.
الاختلاف يكون في Posture-specific composition/density/touch/media/chrome، وليس في معاني الحالات أو قواعد الوصولية أو المكونات الأساسية بلا مبرر.

### شرط الإغلاق
بحلول H5:
- لا توجد أنماط متنافسة لنفس الوظيفة إلا باستثناء موثّق.
- لا توجد نسخ محلية غير لازمة من مكونات النظام.
- نفس الحالة تعني وتبدو متسقة عبر المبيعات والمشتريات والمخزون وHR والتقارير وCommerce.
- الاختلاف بين Postures يكون مقصوداً وموثقاً، لا نتيجة تاريخية أو drift.


## 3. الحدود غير القابلة للكسر

الحرية التصميمية تتوقف عند أي تغيير قد يمس:
1. المحاسبة: posting، totals logic، journal logic، ZATCA، numbering، tax rules، money precision.
2. البيانات: schema، migrations، persistence semantics.
3. API contracts.
4. Tenant Isolation.
5. Auth / RBAC / permissions / security.
6. Backward Compatibility خارج Scope الأفق.
7. العمليات غير القابلة للعكس أو shortcuts لها.
8. Storefront merchant identity boundary.
9. توسيع Scope الأفق إلى feature/product initiative جديدة.
10. Merge / Deploy / Production release بلا موافقة صريحة.

عند الحاجة لأحد هذه البنود: يتوقف عند الحد، يثبت الدليل، ويطلب قراراً.

## 4. بروتوكول كل Horizon

### A. Establish
- تحديث origin/main وتسجيل Base SHA.
- قراءة آخر Handoff والوثائق اللازمة للأفق فقط؛ لا إعادة استكشاف المشروع بالكامل.
- إثبات الواقع الحالي المتعلق بالأفق وتحديد المخاطر.

### B. Design + Implement
- تنفيذ نتيجة الأفق كاملة.
- استخدام v3 كـDesign target مع ممارسة الحكم التصميمي.
- لا Refactor خارج النطاق لمجرد وجود فرصة.

### C. Verify progressively
1. اختبارات الوحدة/المكونات المتأثرة.
2. build/typecheck/lint المرتبط.
3. الاختبارات الأوسع عند الحاجة.
4. visual evidence.
5. accessibility/contrast/keyboard حيث ينطبق.
6. CI.

### D. PR + Findings
- فتح PR واضح للأفق أو Slice آمن داخله.
- متابعة CI ومعالجة Findings الصحيحة داخل Scope الأفق.
- فحص الـjob والـlogs الفاشلة فقط أولاً.
- لا تغييرات جانبية لمجرد تنظيف المستودع.

### E. Close
لا يُغلق الأفق حتى يوجد Final Horizon Report يتضمن: Base/Head SHA، Branch/PR، النتيجة المرئية، أهم قرارات UI/UX، الملفات الرئيسية، الاختبارات، Build/CI، الأدلة البصرية، RTL/LTR، keyboard/accessibility، المخاطر والمتبقي، الانحرافات عن v3 أو Prototype، المؤجل عمداً، جاهزية الدمج، ونقطة البداية الدقيقة للأفق التالي.

ثم يتوقف قبل الدمج ما لم توجد موافقة صريحة.

# 5. خريطة الآفاق الرسمية

التحول يُدار في **خمسة آفاق رئيسية**. أرقام S0…S11 تبقى مراجع فنية داخل MIGRATION.md، وليست جلسات منفصلة.

## H1 — Core Visual System

### Outcome
يظهر أَوْج في Ledger بالشخصية الجديدة فعلياً: عمق واضح، Shell مميز، حالات تفاعل ناضجة، Apex، وأرقام مالية أفضل، مع مصدر حقيقة يمنع الانجراف.

### يشمل
- S0 محاذاة ما يلزم قبل التنفيذ.
- S1 Token Foundation / source of truth.
- S2 Surface hierarchy.
- S3 interaction/focus/control states.
- S4 Default shell + Apex.
- S5 Money typography foundation.
- بوابة data-awj-ui=3.
- Default / Tinted Neutral كالاتجاه الأساسي.

### حرية التصميم
عالية جداً في tone، surfaces، shell balance، spacing/density، active states، Apex execution، typography hierarchy، affordances، وresponsive shell. يجوز تعديل ما أثبتت الشاشة الفعلية أنه أفضل من القيم النظرية مع توثيق الانحراف.

### لا يشمل
- إعادة بناء Data Grid الرئيسية.
- إعادة تصميم فاتورة كاملة.
- Ink كتفضيل مستخدم نهائي.
- POS / Studio redesign.
- أي backend/API/accounting change.

### Definition of Done
- Token source/generation path مستقر.
- Gate off = لا فرق غير مقصود.
- Gate on = الهوية الجديدة واضحة في الأنواع الرئيسية من شاشات Ledger.
- لا contrast regressions.
- focus/keyboard الأساسي سليم.
- لا raw values جديدة خارج الحوكمة.
- لقطات قبل/بعد على Desktop + short-height + mobile shell.
- CI أخضر.

## H2 — Data + Document Workspaces

### Outcome
الجداول تصبح البطل، والمستندات تبدو كـDocuments حقيقية لا Forms مترابطة.

### يشمل
- S6 DataTable evolution + LineGrid foundation.
- selection / hover / editing / bulk / inline warning patterns.
- density + short-height behavior.
- S8 Document Workspace.
- Totals Dock.
- lifecycle من الحالات الحقيقية.
- posted journal entries tab فقط.
- Sales Invoice read-only أولاً ثم editing عندما يصبح آمناً.
- تعميم النمط على نطاق مستند إضافي واحد على الأقل.

### حرية التصميم
عالية جداً في anatomy المستند، command bar/tabs/summary، grid composition، sticky behavior، compactness، totals، status presentation، وطريقة كشف journal entries. لا يفرض Prototype حرفياً.

### لا يشمل
- draft posting dry-run.
- أي تغيير posting/tax/discount/rounding logic.
- API جديد فقط لخدمة الشكل.
- تغيير persisted lifecycle states.

### Definition of Done
- DataTable الجديد مستخدم على شاشات حقيقية.
- LineGrid مثبت في حالة آمنة.
- Document Workspace يعمل على شاشة مالية حقيقية.
- totals تطابق المصدر الحالي بلا إعادة حساب UI.
- journal tab يقرأ قيوداً حقيقية فقط.
- keyboard/RTL/LTR/1280×720 موثقة.
- اختبارات المالية القائمة كاملة وCI أخضر.

## H3 — Themes + Modes

### Outcome
Default وAWJ Ink يعملان فوق نفس المكونات، مع علاقة سليمة بالوضع الداكن.

### يشمل
- S7 AWJ Ink.
- theme persistence + pre-paint resolution.
- brandmark plate.
- contrast matrix Default/Ink.
- S10 Dark v3 alignment بالقدر اللازم لإغلاق Theme × Mode.
- prefers-contrast / forced-colors حيث يلزم.

### حرية التصميم
عالية في صياغة Ink. إذا احتاجت shell tokens إعادة ضبط، تُضبط بالاختبار ولا تُعامل أرقام Prototype كقيود. الممنوع فقط: اختلاف بنيوي بين Default وInk أو تغيير semantics.

### لا يشمل
- tenant recoloring للERP.
- White-label.
- Storefront theme redesign.
- فرض Ink على POS قبل اختبار Floor.

### Definition of Done
- نفس component tree للسمتين.
- لا theme-specific forks.
- persistence سليمة وبدون FOUC ملحوظ.
- contrast/accessibility passes.
- Light/Dark behavior محدد ومختبر.
- CI أخضر.

## H4 — Platform Postures

### Outcome
يمتد Core نفسه إلى بقية أَوْج دون قتل شخصية كل مساحة.

### يشمل
**Commerce Admin:** rich product/media/channel patterns، module/channel marks، store/theme previews.

**Floor / POS:** touch-first، cart/payment/result hierarchy، barcode/keyboard awareness، short-height + landscape.

**Studio / Builder:** graphite editor chrome، canvas/inspector/tree/device preview states، draft/save/publish clarity.

**Storefront boundary:** تحقق عدم تسرب awj/store tokens؛ لا إعادة تصميم Storefront إلا في Horizon منتج مستقل.

### حرية التصميم
**الأعلى بين كل الآفاق.** المطلوب Shared Core والدلالات، لا أن يبدو POS وBuilder والفاتورة نسخاً من بعضها. يجوز ابتكار POS composition وCommerce patterns وStudio chrome وresponsive adaptations مختلفة جذرياً حسب Posture.

### لا يشمل
- تغيير flows التجارية أو checkout/payment APIs.
- تغيير builder persistence.
- تغيير merchant storefront runtime.
- Feature جديدة غير لازمة للهدف البصري/التفاعلي.

### Definition of Done
- Ledger/Floor/Studio تشترك في Core واضح.
- كل Posture له شخصية وظيفية مناسبة.
- لا semantic drift أو token leakage للStorefront.
- POS مختبر touch/keyboard/short-height.
- Studio محايد تجاه ألوان التاجر.
- CI أخضر.

## H5 — Rollout + Hardening + Completion

### Outcome
v3 تصبح النظام التصميمي الفعلي القابل للصيانة، لا تجربة خلف بوابة.

### يشمل
- visual regression coverage.
- accessibility hardening.
- RTL/LTR hardening.
- responsive + 1280×720 + zoom coverage.
- cleanup للaliases والقيم القديمة عندما يصبح آمناً.
- governance ratchets.
- docs/code sync.
- تقليص/إزالة data-awj-ui=3 وفق rollout.
- rollout: internal → opt-in → new tenants/cohort → all.

### حرية التصميم
مسموح إصلاح المشاكل التي تظهر أثناء الاستخدام، لكن H5 ليس إعادة تصميم جديدة. أي فكرة كبيرة جديدة تذهب إلى Horizon مستقل.

### حالة التنفيذ (H5) `[DECIDED]`

| البند | الحالة |
|---|---|
| جسر المتغيّرات القديمة | **منفَّذ**: `--background/--surface/--border/--text/--muted/--primary*/--positive/--negative/--warning` تُشير إلى `--awj-*` تحت البوابة (Light وDark معرَّفان مرة واحدة، من المولِّد) — كان الداكن v2 منجرفاً عن v3 |
| قشرة Ink | **مُصلَح**: نصوص الشريط الجانبي/العلوي كانت تقرأ ألوان Light القديمة فتظهر داكنة على الحبر؛ صارت المتغيّرات تُعاد من `shell-*` داخل القشرة، والقوائم المنبثقة داخلها تعود إلى Paper |
| حدّ الحقول | **منفَّذ**: `border-control` (≥ 3:1، WCAG 1.4.11) لكل Input/Select/Textarea/Combobox بقاعدة واحدة |
| Dark: نص أبيض ثابت على ملء دلالي | **مُصلَح** بقاعدة واحدة (`text-white` على `bg-primary/bg-negative`) |
| حدّ الانجراف (ratchet) | **منفَّذ**: `design-system/governance/baseline.json` + اختبار |
| مفتاح الإطلاق | **منفَّذ ومعطَّل**: `NEXT_PUBLIC_AWJ_UI_DEFAULT`، أسبقية الاختيار الصريح، pre-paint، حارس نطاق المسارات |
| اختبارات الصلابة | **منفَّذة**: `awj-v3-h5-hardening.spec.ts` (تباين Theme × Mode، 7 أحجام، تكبير 125/150/200%، RTL/LTR، forced-colors، لوحة المفاتيح، عزل المتجر) |
| اختبارات e2e القديمة (زر الدخول التجريبي) | **أُصلح مدخلها** في 11 ملفاً بمساعد `seedDemoSession` (لم يُمسّ تسجيل الدخول): 15 من 30 اختباراً تمر الآن (كانت كلها تسقط عند الدخول)، والـ15 الباقية تسقط بالنمط نفسه على الأساس قبل H4 (`427fc60`) لأسباب لا علاقة لها بـv3: معالج قوالب الطباعة غير مستقر (`التالي` «not stable»)، وتوقعات مستقرّة قديمة. **غير مُصلَحة عمداً** (خارج النطاق) |
| إزالة البوابة/المسار القديم | **غير منفَّذ عمداً** — انظر MIGRATION §6 |

### Definition of Done — v3 Complete
- Default افتراضي مستقر وInk اختياري مستقر.
- Light/Dark/RTL/LTR usable.
- Ledger/Data/Documents/Commerce/POS/Studio على Core موحد.
- Storefront boundary محفوظة.
- لا major visual regressions.
- accessibility gates مفعلة.
- token source هو الحقيقة الفعلية.
- docs تعكس الواقع.
- aliases القديمة أزيلت أو لها خطة إزالة واضحة.
- لا يعتمد النجاح على feature gate تجريبي.
- production verification ناجح بعد موافقة المالك على النشر.

## 6. أفق اختياري غير حاجب: Draft Posting Preview

ليس جزءاً من تعريف اكتمال v3. إذا قرر المالك لاحقاً أن معاينة القيود قبل الترحيل تستحق الاستثمار، تُفتح كمبادرة مستقلة بسبب Backend/Accounting implications. لا يُسمح لها بتأخير التحول التصميمي.

## 7. منع التشتّت

1. لا يبدأ Horizon جديد قبل أن يصبح السابق Merged أو متوقفاً بقرار صريح.
2. Findings تخص الأفق الحالي تُعالج داخله؛ الأفكار غير اللازمة تُسجل فقط.
3. لا إعادة فتح قرار Design مغلق إلا بدليل من التطبيق الفعلي.
4. لا إعادة Benchmark واسعة بعد كل أفق.
5. آخر Final Horizon Report هو نقطة البداية الرسمية للجلسة التالية.
6. عبارة «استمر / التالي» تعني متابعة آخر Horizon المؤكد، لا إعادة التخطيط.
7. أي Feature غير ضرورية لتعريف الإغلاق تخرج من Scope.
8. لا نضاعف Themes أو Postures لإرضاء حالة استثنائية.
9. Prototype ليس Checklist.
10. جودة النتيجة أهم من المطابقة الحرفية للمواصفة إذا أثبت البديل أنه أفضل ويخدم مبادئ أَوْج.

## 8. قالب بدء Horizon لـClaude Code

~~~
AWJ DESIGN SYSTEM v3 — HORIZON <N>: <NAME>

Start from latest origin/main.
Read:
- design-system/v3/HORIZONS.md
- only the v3 documents directly relevant to this Horizon
- the previous Final Horizon Report

Role:
Act as Product Design Lead + Frontend Engineer.
The goal is the best AWJ user experience inside this Horizon, not pixel compliance with a prototype.

Creative authority:
You have broad freedom over UI/UX, visual hierarchy, layout, density, component composition,
interaction details, responsive behavior, and visual execution.
If you see a stronger solution than the prototype/spec detail, use your judgment, prove it,
and document the decision.

Hard boundaries:
Do not change accounting logic, persisted financial semantics, APIs, database schema,
tenant isolation, auth/RBAC, or backward-compatible behavior unless this Horizon explicitly
authorizes it and owner approval exists.
No merge, deploy, or production release without explicit owner approval.

Execution:
Continue through implementation, focused tests, visual verification, PR, CI, and review findings.
Do not stop merely because the PR was opened.
Stop before merge unless explicit approval exists.

Close with a Final Horizon Report containing:
Base/Head SHA, branch/PR, what changed, design decisions, files, tests, build/CI,
visual/accessibility/RTL-LTR evidence, risks, deferred items, and exact next handoff.
~~~

يُضاف لكل Horizon بعد ذلك Scope وDefinition of Done الخاصان به فقط، ولا يُحمّل الـPrompt بكل تفاصيل v3 من جديد.
