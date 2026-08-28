# Document Center Incident Runbook

## الهدف والحدود

هذا الدليل يعالج حوادث أمن/عزل/سلامة محتملة في مركز المستندات قبل وبعد أي تشغيل مستقبلي معتمد. لا يسمح بمزود خارجي أو scheduler أو worker أو تخزين دائم، ولا يمنح support impersonation أو وصولاً إلى raw payloads أو object keys أو secrets. **Stage 0 الحالي لا ينفذ عمليات خارجية.**

## التصنيف والتصرف الأولي

| المستوى | أمثلة | التصرف خلال الحادث |
|---|---|---|
| P0 | دليل تسرب tenant/branch، secret، حذف evidence غير محكوم، posting غير مقصود | أوقف العمل والتوسع، صعّد للمالك فوراً، لا تنظف الأدلة ولا تعيد تشغيل jobs. |
| P1 | خلل authorization، retry/purge unsafe، export غير آمن، schema incompatibility | جمد المسار المتأثر، احفظ safe observations، جهز إصلاحاً واختبارات قبل أي استئناف. |
| P2 | رسالة واجهة مضللة، accessibility defect، projection ناقص بلا تسرب | سجل issue، أصلحه ضمن PR مع E2E/a11y evidence. |

## جمع الأدلة الآمن

اجمع وقت UTC، SHA، endpoint أو command، principal class (tenant/platform فقط)، HTTP status أو safe code، و`documents:readiness --json`. لا تجمع أو تلصق: API keys، cookies، signed URLs، raw provider responses/errors، normalized payload الكامل، encryption blobs، object key، أو محتوى الملف.

راجع `DocumentGovernanceEvent`/`DocumentWorkflowEvent`/`DocumentSourceAuditEvent` بحساب مصرح وفي scope صحيح؛ تلك سجلات append-only ولا تغيرها. إن كانت الواقعة cross-tenant أو قد تتطلب قراءة evidence، يقرر المالك المسار القانوني والحد الأدنى من الوصول.

## مسارات متخصصة

### اشتباه IDOR أو cross-scope

أوقف endpoint/feature exposure عبر إجراء تشغيل معتمد فقط، ثم أعد اختبار token tenant آخر وفرع آخر وtoken platform منفصل. لا تستخدم `withoutGlobalScopes()` كتشخيص تفاعلي. تحقق من عدم كتابة governance event أو hold أو overlay على المورد الأجنبي، ومن عدم تغير run أو draft أو أي count مالي.

### اشتباه provider egress أو secret exposure

تحقق من `provider_network_locked`. لا تختبر connection، ولا تغير config. افحص configuration masking وCI/test evidence ثم صعّد. إن كان egress مثبتاً، يعامل P0 ويتطلب قرار مالك مستقل عن هذا الـPR.

### retention/purge أو storage failure

لا تعالج بالـshell أو DB. افحص `purge_pending_at` وsafe governance event. pending هو حالة استرداد متعمدة؛ hold/linked/closed-state غير المؤهل يجب أن يظهر skip، وstorage failure يجب أن يبقي pending. لا تعلن purge من دون حدث final من الخدمة المالكة.

### concurrency أو duplicate draft/receipt

لا تعيد إرسال command/HTTP تلقائياً. احتفظ idempotency key وsafe result، ثم تحقق من constraint/audit. لا تنشئ purchase/expense/invoice أو أي JournalEntry «لتصحيح» duplicate.

## الاتصالات والإغلاق

يملك المالك قرار التواصل الخارجي، rollback وActivation. يغلق الحادث بعد الإصلاح أو rollback المعتمد، إعادة tests ذات الصلة، توثيق عدم تأثير مالي، وتسجيل المخاطر المتبقية. لا يُدمج PR تلقائياً بعد الحادث.
