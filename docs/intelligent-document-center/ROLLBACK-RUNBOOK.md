# Document Center Rollback Runbook

> هذه PR لا تنشر ولا تضيف migration ولا تفعّل خدمة. لذلك لا يوجد إجراء rollback يُنفذ الآن. ينطبق هذا الدليل فقط على نشر مستقبلي معتمد من المالك، ويمنع أي تعديل بيانات أو تفعيل من باب «الإصلاح السريع».

## قرار rollback

يصدر قائد الحادث/المالك قرار rollback إذا أثبتت المراقبة المعتمدة بعد نشر مستقبلي وجود one of: تجاوز tenant/branch، طلب خارجي غير مقصود، تسرب projection، destructive behavior، أو فشل سلامة evidence. لا يعد `worker offline` أو provider gate المقفل عيباً في Stage 0.

| نوع التغيير المستقبلي | rollback المسموح | ما لا يجوز فعله |
|---|---|---|
| تغييرات تطبيق فقط | استعادة artifact/revision السابق المعتمد، ثم التحقق بـreadiness/CI | حذف evidence أو تعديل workflow status مباشرة |
| migration additive ومجازة | استعادة التطبيق أولاً؛ لا تعمل `down()` في production إلا بعد قرار بيانات مكتوب واختبار restore | migration production مرتجلة أو destructive |
| إعداد provider/storage/worker | تعطيل المسار في الإعداد المعتمد وإيقاف الاستهلاك؛ الحفاظ على runs/evidence | حذف credentials/objects عشوائياً أو فتح gate للـdebug |
| retention pending | إيقاف applyات لاحقة ومراجعة events؛ اترك pending للاسترداد المحكوم | جعل الملف purged يدوياً أو حذف object خارج الخدمة |

## التسلسل

1. **أوقف توسعة الأثر، لا البيانات.** عطّل route/feature exposure وفق تغيير تشغيل معتمد فقط؛ لا تغير `DocumentProviderNetworkGate` أو إعداد storage داخل هذا PR.
2. **وثّق snapshot آمن.** اجمع `documents:readiness --json` وdiagnostics المنصّي، مع وقت UTC وSHA والـsafe error code. لا تجمع secrets أو URLs موقعة أو object keys.
3. **استعد revision.** اختر آخر artifact اجتاز CI ومراجعة المالك. نفذ rollback في pipeline المعتمد، لا من جهاز محلي أو CLI يدوي.
4. **تحقق.** شغّل smoke read-only وراجع عدم زيادة journal/payment/stock counts في عينة معزولة. تحقق أن tenant/branch/platform denial ما زال سليماً.
5. **استأنف فقط بقرار.** يبقى provider network false وpersistent storage false إلى مشروع Activation منفصل.

## Database وevidence

جميع migrations حتى PR-13 خاضعة لتدريبات SQLite وCI PostgreSQL. PR-13 يضيف **صفر migrations**. عند أي شك في صحة data migration مستقبلية، الأولوية هي backup/restore المراجع وليس `migrate:rollback` غير المدروس. review/governance/usage/receipt evidence append-only، ولا ينبغي إصلاحها بحذف أو `UPDATE` يدوي.

## معيار الإغلاق

يمكن إغلاق rollback فقط بعد أن يوثق المالك SHA المستعاد، نتيجة CI، نتيجة readiness، وحالة provider/storage/queue، وأنه لم يحدث merge تلقائي أو deployment يدوي أو production migration أو activation أثناء الحادث.
