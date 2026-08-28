# Document Center Recovery Runbook

> **النطاق:** دليل Stage 0 للاسترداد والتحقق. لا يفعّل مزوداً أو تخزيناً دائماً أو worker أو Redis أو ClamAV أو scheduler، ولا ينفذ migration إنتاجية. لا يحذف object مباشرة؛ `DocumentStorageService` هو المالك الوحيد للحذف المحكوم.

## 1. التحقق الآمن الأولي

ابدأ دائماً بحساب Platform Administrator مصرح له، وباللقطة غير التخريبية:

```bash
php artisan documents:readiness --json
```

ينبغي أن تكون الحالة `ready_for_inert_code` مع `provider_network_locked: true` و`external_activation_configured: false`. لا تفسر `worker_online: false` أو `scanner_ready: false` كفشل في Stage 0؛ تلك خدمات مؤجلة عمداً. لا تنسخ output إلى تذكرة عامة إن احتوى UUIDs تشغيلية، رغم أنه لا يحتوي secrets أو object keys.

| العرض | التشخيص الآمن | القرار المسموح | القرار الممنوع |
|---|---|---|---|
| queue غير متاحة أو worker offline | platform diagnostics + readiness | إبقاء runs queued/failed بأكواد آمنة والتحقيق | إنشاء worker أو Redis أو إعادة dispatch تلقائياً |
| scanner غير متاح | diagnostics وsafe status | إبقاء الملف pending/fail-closed | تجاوز scan أو منح download |
| provider gate مقفل | readiness و`DocumentProviderNetworkGate` | قبول أن extraction/retry غير مسموح | فتح config أو اختبار اتصال خارجياً |
| storage غير متاح | status/diagnostics وحدث `storage_failed` | إبقاء purge pending ثم مراجعة مالك الخدمة | تحديث `purged_at` أو حذف object بالـCLI |
| app/entitlement/RBAC مرفوض | Authorization Matrix + logs آمنة | تصحيح role/grant بقرار مالك منفصل | bypass أو impersonation |

## 2. معالجة retries

retry متاح فقط لمسار tenant المشمول ولـrun فاشل وفي حالة application/entitlement/RBAC صحيحة. إذا كان gate أو queue/scanner غير جاهز، يجب أن تبقى النتيجة `retry_rejected` أو `failed` برسالة آمنة. لا تغير `status` يدوياً ولا تزيد `attempt_count` يدوياً. استخدم UI/API المحروس فقط بعد أن تصبح الجاهزية **مفعلة بموافقة تشغيل مستقلة**؛ لا توجد إعادة معالجة تلقائية في Stage 0.

## 3. معالجة retention وpurge pending

لا يجوز تشغيل `--apply` في Stage 0 إلا ضمن إجراء owner-approved منفصل بعد تحقق البيئة. المسموح هنا هو التخطيط الجاف المحدود فقط:

```bash
php artisan documents:retention-run --cutoff=2026-08-27 --limit=100
```

يدعم الأمر cursor (`--after-file-id`) ولا يتجاوز 500 ملف. عند `purge_pending_at`، ينفذ runner معاملة claim قصيرة تقفل `batch → file` وتعيد planner قبل الوصول إلى التخزين. hold أو رابط transaction أو حالة غير مؤهلة تنظف pending وتكتب `retention_skipped`. إذا كان claim قائماً، يرفض إنشاء hold جديد على الملف أو الحزمة بأمان حتى تكتمل المصالحة؛ لذلك لا يوجد سباق قانوني بين القرار والحذف. يعمل `exists/delete` الخارجي **خارج** معاملة قاعدة البيانات، فلا تعاد العملية تلقائياً عند deadlock أو خطأ DB. الاستثناء الصادر من التخزين يبقي pending ويكتب `retention_purge_storage_failed`; أما فشل DB بعد الحذف فيبقي pending دون تصنيفه storage failure، ويعالج التشغيل التالي object المفقود عبر `retention_purge_reconciled`. لا تعدل هذه الحقول يدوياً.

## 4. استرداد DB transaction أو receipt جزئي

استخدم diagnostics ذات النطاق لمعرفة batch/run فقط عبر المسار المحروس. intake/source-channel يجريان الكتابة في transaction ويلغيان object المحلي عند failure؛ لا تحاول استحداث receipt أو extraction evidence من سجل يدوي. إن وجدت حالة لا يمكن تفسيرها من أحداث immutable، أوقف الإجراء، احفظ identifiers الآمنة فقط، وصعّد للمالك. لا تستخدم `withoutGlobalScopes()` من console أو tinker لمعالجة بيانات العملاء.

## 5. قيود الأدلة والبيانات المالية

لا تعدل `DocumentReviewAction` أو `DocumentReviewChange` أو `DocumentGovernanceEvent` أو provider usage events، لأنها append-only. redaction هو overlay عرضي ولا يغير evidence الأصلي. لا تقم بإنشاء/ترحيل Invoice أو Purchase أو Expense أو Payment أو JournalEntry أو StockMovement كوسيلة استرداد. تحقق بعد أي تمرين من أن counts المالية لم تتغير.

## 6. شروط التصعيد والتسليم

أوقف العمل وصعّد إذا تطلب الاسترداد credentials أو تغيير provider gate أو حذفاً مباشراً أو support impersonation أو قرار legal/data-residency أو migration destructive. عند التصعيد، أرفق: وقت UTC، safe code، batch/run UUID ضمن القناة الداخلية، نتيجة readiness، وما إذا كانت بيانات مالية قد بقيت صفراً. لا ترفق raw payload أو signed URL أو object key أو secret أو stack trace.
