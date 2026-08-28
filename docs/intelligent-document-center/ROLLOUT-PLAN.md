# Document Center Gradual Rollout Plan

> **الحالة الحالية: Stage 0 فقط.** هذه الوثيقة لا تفوض نشر أو تفعيل أو migration إنتاجية. هدفها أن تجعل شروط القرار قابلة للمراجعة قبل أن يبدأ مشروع تشغيل owner-approved مستقل.

## مراحل القرار

| المرحلة | الحالة | ما يثبتها | ما هو محظور |
|---|---|---|---|
| 0 — code/schema inert | مطبقة في PR-13 | CI، tests، readiness، runbooks، threat model | provider/AI، durable storage، worker، scanner، Redis، cron، webhook، public API |
| 1 — preflight approved | مؤجلة | checklist مكتمل، قرار legal/data-residency، owners للموارد والحوادث | auto-enable، إيداع credentials في المستودع |
| 2 — canary controlled | مؤجلة | مشروع تشغيل منفصل، tenant محدد بقرار مكتوب، observability وrollback مجرّبان | retention apply/auto-draft/auto-approval/auto-posting |
| 3 — controlled expansion | مؤجلة | نتائج canary، SLOs، مراجعة incident، موافقة مالك | bulk tenant enable أو migration destructive |
| 4 — general availability | مؤجلة | قرار منصة ومالك صريح | التفعيل الضمني من وجود الكود |

## Stage 0 gates المنفذة

1. `documents:readiness --json` يثبت capability/schema ويصرح أن activation غير مضبوط.
2. `DocumentProviderNetworkGate` يبقى false افتراضياً، واختبارات HTTP تثبت صفر egress مع القفل.
3. storage الدائم يبقى disabled؛ لا توجد ترقية R2/S3 أو إعداد credentials.
4. queue/worker/scanner لا تُنشأ ولا تُشغل؛ diagnostics يعرضها كمعلومات لا كأمر إصلاح.
5. لا scheduler، polling، webhook أو public inbound API.
6. لا تعديل على billing/pricing/FX أو أي مورد paid.

## نقاط قرار المالك

| القرار | المالك المسؤول | دليل مطلوب | رفض تلقائي |
|---|---|---|---|
| تفعيل provider network | مالك المنصة + legal/security | region، retention، DPA، rate/usage limits، rollback | غياب موافقة أو secret management مستقل |
| durable private storage | مالك المنصة + security | encryption/access/lifecycle/restore drill | R2/S3 غير مراجع أو lack of restore |
| worker/scanner/queue | مالك التشغيل | isolation، health/heartbeat، DLQ/retry، cost approval | daemon/scheduler غير مراقب |
| tenant canary | مالك المنتج + tenant owner | consent، entitlement، support runbook | auto-enrollment أو support bypass |
| retention apply | data owner + legal | policy، holds، linked evidence، restore/reconciliation plan | linked evidence أو hold أو purge pending غير مفسر |

## قياس gates قبل الانتقال

يجب أن تكون CI SQLite/PostgreSQL/Web وVercel خضراء، وكل خيوط المراجعة محلولة أو موسومة بدقة، واختبارات tenant/branch/platform وstale review وsource replay وdraft idempotency وretention recovery مثبتة. لا تعتبر نجاح demo أو readiness بديلاً عن provider/storage connectivity؛ العكس صحيح: لا يجوز أن يجري Stage 0 ذلك الاتصال.

## rollback وإدارة الحوادث

كل مرحلة لاحقة تربط إلى [ROLLBACK-RUNBOOK.md](./ROLLBACK-RUNBOOK.md) و[INCIDENT-RUNBOOK.md](./INCIDENT-RUNBOOK.md). عند تراجع أي gate، يعود المسار إلى Stage 0 أو يتوقف؛ لا يحدث تفعيل تدريجي ذاتي ولا retry خارجي تلقائي. لا يتضمن هذا PR خطوة تشغيل أو commit يغير هذه الحالة.
