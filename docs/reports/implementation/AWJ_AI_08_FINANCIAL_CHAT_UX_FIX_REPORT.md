# AWJ AI-08 — Financial Conversation Accuracy & Mobile UX

## 1. Root Cause

### FIX-01 — Natural date ranges

كان `AnthropicAssistantProvider` يرسل للنموذج سياقًا عامًا عن تاريخ اليوم وتعليمات مختصرة لـ`this month`، لكنه كان يمرّر اقتراحات النموذج كما هي إلى بوابة الأدوات. لذلك كان السؤال الطبيعي مثل «كم إجمالي إيراداتي ومصروفاتي وصافي الربح خلال شهر أكتوبر 2026؟» قد ينتهي بمعاملات ناقصة أو غير صالحة قبل الوصول إلى `AiIncomeStatementTool`. أما `AiFinanceReportTool::parseDate()` فكان يطبق التحقق الصارم الصحيح، لذلك لم يكن مناسبًا إضعافه أو نقل منطق المحاسبة إليه.

### FIX-02 — Accounting sign integrity

كان `AiToolResultDigest` يحتفظ بإشارة القيمة العشرية، لكن `AiAnswerGuard::numbers()` كان يطبع الأرقام إلى قيمة مطلقة ضمنيًا؛ وبذلك كان `2075.00` يطابق `-2075.00`. سمح ذلك بقبول صياغة تعرض مصروفًا سالبًا كرقم موجب، رغم أن البطاقة ونتيجة `ReportService` تعرضانه بسالب محاسبي.

### FIX-03 — Mobile conversation UX

كانت رسالة المساعد تُرسم كنص React خام؛ لذلك ظهرت علامات `**` حرفيًا. كما كان تلميح `Enter / Shift+Enter` يُعرض على اللمس، ولم تكن حاوية سجل المحادثة تمنع التمرير الأفقي عند وجود نص طويل غير قابل للكسر.

## 2. Summary of Changes

- أضيف تطبيع حتمي محدود داخل `AnthropicAssistantProvider` للفترات الطبيعية الخاصة بقائمة الدخل فقط:
  - الشهر الحالي / `this month` / «هذا الشهر»: من اليوم الأول إلى `today` بتوقيت المؤسسة.
  - الشهر المسمى الحالي: من اليوم الأول إلى اليوم الحالي.
  - الشهر المسمى السابق: من اليوم الأول إلى آخر يوم في الشهر.
  - لا يُغيّر التطبيع أي `from` أو `to` صريحين أرسلهما النموذج؛ تبقى المعاملات الصريحة تحت تحقق `AiFinanceReportTool`.
  - أضيف سياق أوضح لتعريف الفترة والحفاظ على الإشارة المحاسبية في تعليمات الصياغة.
- عدّل `AiAnswerGuard` ليعامل الإشارة كجزء من هوية الرقم، مع تطبيع الأرقام العربية وفواصل الآلاف دون تحويل السالب إلى موجب.
- أضيفت اختبارات تثبت أن `-2,075.00` مقبول عند وجود `-2075.00` في الملخص وأن `2,075.00` مرفوض، بما في ذلك الأرقام العربية، وأن ملخص قائمة الدخل يحافظ على الإشارة.
- أضيف عرض Markdown محدود وآمن لعلامات bold فقط عبر React children، دون `dangerouslySetInnerHTML` أو HTML من النموذج.
- أخفي تلميح لوحة المفاتيح باستخدام media query للأجهزة ذات المؤشر الخشن، وأضيف التفافًا آمنًا للنص وحجبًا للتمرير الأفقي في سجل المحادثة.

## 3. Changed Files

- `app/Services/AnthropicAssistantProvider.php`
- `app/Support/AiAnswerGuard.php`
- `tests/Feature/AiAnthropicProviderTest.php`
- `tests/Feature/AiAnswerGuardTest.php`
- `web/src/components/intelligence/assistant-panel.tsx`
- `web/src/components/intelligence/__tests__/panel.test.tsx`
- `docs/reports/implementation/AWJ_AI_08_FINANCIAL_CHAT_UX_FIX_REPORT.md`

لم يتغير `ReportService` أو أي migration أو إعداد Railway أو تكامل/API key أو قواعد RBAC/عزل الشركات.

## 4. Tests and Results

### Local

- `npm test -- --run src/components/intelligence/__tests__/panel.test.tsx` — **33 passed**.
- شملت الاختبارات الجديدة عرض `**Revenue**` كعنصر `<strong>` دون ظهور العلامات، النص الطويل، وبقاء السلوك الحالي لـEnter وShift+Enter.
- `git diff --check` — **passed**.
- فحص TypeScript العام (`npx tsc --noEmit`) — توجد أخطاء baseline في ملفات متعددة غير مرتبطة، وتم إصلاح الخطأ الوحيد الذي ظهر في `assistant-panel.tsx`. سيُعتمد الحكم النهائي على Web CI.
- لم يتوفر PHP/Composer في Sandbox المحلي، لذلك لم تُشغّل اختبارات Laravel محليًا.

### CI / backend coverage requested

ستتحقق CI الرسمية من اختبارات Laravel على SQLite وPostgreSQL واختبارات Web. جميع اختبارات Anthropic المستخدمة في التغييرات هي HTTP mocks/fixtures، ولا يوجد أي طلب حقيقي إلى Anthropic API.

## 5. CI Status

- الحالة عند إعداد هذا التقرير: **Pending — بانتظار تشغيل CI على رأس Draft PR**.
- سيتم تحديث هذا القسم بعد إنشاء PR وظهور حالات GitHub Actions.

## 6. Visual QA

- تحقق اختبار مكوّن المحادثة من وجود زر الرجوع على mobile accessibility، ومن وجود الحاوية القابلة للتمرير العمودي.
- لم تُشغّل جلسة متصفح مرئية كاملة في Sandbox؛ اختبار Playwright المرئي/الفعلي يبقى ضمن CI أو مراجعة PR.

## 7. Accounting & Security Impact

- لا إعادة حساب ولا تعديل لبيانات الأستاذ؛ الأرقام ما زالت تأتي من `AiIncomeStatementTool` و`ReportService`.
- الحفاظ على الإشارة يمنع تحويل التسويات أو العكوسات أو المصروفات السالبة الصحيحة إلى مصروفات موجبة في النص.
- التطبيع يطبق على الفترة الطبيعية فقط، ولا يلتف على منع المستقبل أو حد 366 يومًا؛ المعاملات تمر بعد ذلك عبر التحقق القائم والتفويض القائم.
- لم تُرسل رسائل إضافية أو بيانات حساسة إلى Anthropic، ولم تتغير الصلاحيات أو نطاق الشركة.
- عرض Markdown محدود عبر React، ولا يوجد HTML غير موثوق أو روابط قابلة للتنفيذ أو `dangerouslySetInnerHTML`.

## 8. Remaining Risks

- تعتمد تغطية النطاقات الطبيعية غير الشائعة أو أسماء الشهور المحلية الإضافية على قواعد المطابقة المحدودة المضافة في المزود.
- ما زالت أخطاء TypeScript العامة الموجودة مسبقًا تحتاج معالجة منفصلة ولا تدخل نطاق AI-08.
- يلزم نجاح CI ومراجعة بشرية قبل جعل PR جاهزًا للدمج.

## 9. Branch / PR / SHAs

- Base branch: `main`
- Base SHA: `4d8b02fd6bdd7de0bc89273f5bb4e4c542b00b2f`
- Head branch: `fix/ai-08-financial-chat-ux`
- Head SHA: سيتم تحديثه بعد الالتزام والدفع.
- Draft PR: سيتم تحديث الرابط بعد إنشائه.

## 10. Recommendation Before Merge

أوصي بإبقاء PR في Draft حتى تنجح CI على SQLite وPostgreSQL وWeb، ثم مراجعة حالات الشهر الحالي/الشهر السابق وحالة المصروف السالب بصريًا بالعربية والإنجليزية على mobile وdesktop. لا Merge ولا Deploy ضمن هذه المهمة.
