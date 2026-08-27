# ADR-012: Operations, Usage, Retention and Governance

- **Status:** Accepted
- **Scope:** PR-12
- **Decision owner:** Intelligent Document Center and application-platform boundaries

## Context

تنتج مراحل مركز المستندات السابقة أدلة intake وملفات غير قابلة للتبديل، صفوف معالجة وفحص، محاولات مزود، أحداث استخدام، نتيجة استخراج أصلية، إسقاط مراجعة قابل للتصحيح، وروابط اختيارية إلى مسودات لاحقة. لم يكن لدى المستأجر أو مسؤول المنصة حتى PR-12 سطح موحد وآمن لرؤية حالة المعالجة، أو إعادة محاولة مقيدة، أو تقارير استخدام، أو الاحتفاظ المحكوم، أو طبقة حجب عرض، أو تصدير تدقيق وتشخيص قابلين للمراجعة.

> تظل بوابات الشبكة والتخزين والصف والمنفذ والعامل في عقود ADR-002 وADR-003 وADR-004: معطلة افتراضياً ولا يغير هذا القرار إعداداً أو مورداً خارجياً.

## Decision

يبني PR-12 طبقة عمليات وحقوق حوكمة ضيقة تستعمل مصادر الحقيقة القائمة ولا تنشئ lifecycle موازياً.

| المجال | القرار الملزم |
|---|---|
| العمليات | `DocumentOperationsService` يعرض ملخصاً مقيداً للفرع والحزم المصفحة و`DocumentProcessingStatusProjector` يعرض مفاتيح ورسائل آمنة فقط. يعتمد readiness المنصة على `PlatformIntegrationService::runtime()` القائم. |
| retry | `DocumentRetryService` يقفل صف `DocumentProcessingRun` الفاشل القائم فقط، ويتحقق من الملف والحد والصف والسياسة والبوابات قبل تحويله إلى queued وإرسال job. كل رفض يسجل `DocumentGovernanceEvent` آمن. |
| الاستخدام | `DocumentProviderUsageEvent` هو المصدر الوحيد للصفحات والرموز والمدة وcost المسجل. يجمع التقرير cost منفصلاً حسب العملة، ويعيده غير متاح إن كانت القيم nullable؛ لا توجد أسعار أو FX أو quota أو تخمين. |
| الاحتفاظ | سياسة منصة واحدة باسم `document_center_default` ومدتها الافتراضية 365 يوماً وبنمط `manual_governed`. لا يوجد branch override. مصدر deadline الوحيد هو `DocumentFile.created_at + retention_days` من هذه السياسة؛ يبقى `retention_until` التاريخي metadata intake فقط ولا يملك override صامتاً. planner يقرر فقط، وrunner محدود cursor قابل للاستئناف مع `dry_run=true` افتراضياً وخيار apply صريح. |
| purge | لا يحذف runner صفاً أو دليلاً. بعد إعادة التحقق تحت lock يستدعي `DocumentStorageService` وحده لحذف الكائن ثم يثبت `DocumentFile.purged_at` وسبباً ومعرف policy. تبقى FK وسجل التدقيق وسلاسل evidence. |
| holds | `DocumentRetentionHold` كيان BranchScoped append-only: ينشأ ويُرفع بتوقيت وسبب code آمنين، ولا يحذف. أي hold نشط يحجب planner. |
| redaction | `DocumentRedactionOverlay` append-only، يقبل path من allowlist فقط ولا يحفظ القيمة المحجوبة. `DocumentRedactionProjector` يضع marker في نسخة review/export المعروضة، بما فيها `before`/`after` في history حين يحمل snapshot `target_key` محجوباً؛ لا يغير `normalized_payload` أو `DocumentReviewChange` أو بناء المسودة. |
| audit/export | CSV متزامن ومحدود عبر `SpreadsheetWriter` القائم (UTF-8 BOM ودفاع formula injection). لا يتضمن raw payload أو binary/object key أو signed URL أو secret أو URL داخلي أو error خام أو external reference كامل. |
| diagnostics | schema ثابت `document-diagnostics-v1` بقائمة سماح. endpoint المستأجر مؤمن tenant/branch/RBAC/entitlement؛ endpoint المنصة لمسؤول منصة فقط. لا يوجد support impersonation أو bypass؛ أي عقد support مستقل مؤجل. |

## Retry matrix

| الحالة | النتيجة | كود الرفض الآمن عند المنع |
|---|---|---|
| صف queued أو running أو غير failed | يرفض بلا job جديد | `document_retry_already_active` أو `document_retry_not_allowed` |
| ملف purged أو غير موجود عبر `DocumentStorageService` | يرفض | `document_retry_file_unavailable` |
| safety scan failed، queue sync أو processing/scanner غير جاهزين | يرفض | `document_retry_runtime_unavailable` |
| safety scan تجاوز max attempts | يرفض | `document_retry_limit_reached` |
| extraction failed وشبكة المزود مقفلة | يرفض قبل قراءة أو إرسال مزود | `document_retry_network_locked` |
| extraction failed والسياسة/provider/queue غير جاهز | يرفض | `document_retry_runtime_unavailable` |
| extraction failed وscan غير clean أو حزمة quarantined أو حجم/صفحات غير مسموح | يرفض | `document_retry_not_allowed` |
| failed صالح وكل الشروط متاحة | يحدث الصف الفريد نفسه فقط إلى queued ثم dispatch | — |

## Retention matrix

| شرط الملف | قرار planner | سبب آمن |
|---|---|---|
| `purged_at` موجود | no-op | `already_purged` |
| `created_at + policy.retention_days` لم ينقض أو deadline أحدث من cutoff | skip | `retention_not_due` |
| hold نشط على batch أو file | skip | `active_hold` |
| يوجد `DocumentTransactionLink` | skip محافظ | `linked_transaction_evidence` |
| workflow في receiving/queued/processing/review أو run active | skip | `active_workflow_or_processing` |
| scan ليس clean أو batch quarantined | skip | `safety_not_clean` |
| دليل closed/archived clean بلا link/hold وبانقضاء deadline policy المركزي | eligible | `eligible` |

يعمل `documents:retention-run` وendpoint المنصة يدوياً فقط. كلاهما يبدأ بـdry-run؛ `apply` يتطلب إقراراً صريحاً، limit بين 1 و500، ويمكن الاستئناف بواسطة `after_file_id`. لا يوجد schedule أو polling أو worker جديد.

## Permissions and scope

تضاف أقل صلاحيات document-center مستقلة: `documents.center.operations` و`documents.center.retry` و`documents.center.usage` و`documents.center.audit_export`. backfill idempotent يمنح owner/admin فقط عندما تكون أدوارهما محفوظة بلا wildcard؛ تبقى الأدوار المخصصة والمحاسب والموظف بلا توسيع تلقائي. تستعمل routes سلاسل Sanctum وtenant/branch وRBAC وcommercial access القائمة. مسارات المنصة تبقى تحت Sanctum و`EnsurePlatformAdministrator` ولا تقبل tenant أو branch من المستخدم.

## Immutability and audit

`DocumentGovernanceEvent` و`DocumentRetentionRun` وholds وoverlays سجلات append-only. يسجل كل retry قبولاً أو رفضاً، hold/release، redaction، وكل candidate retention مفحوص: `retention_skipped` بسبب planner آمن، أو `retention_dry_run_eligible` عند dry-run eligible، أو سلسلة apply القائمة `purge_pending` ثم final outcome فقط بلا حدث generic مكرر. تسجل policy update وعمليات export كذلك. يحتفظ الحدث بسبب code ورسالة آمنة وmetadata صغيرة بالقائمة البيضاء فقط؛ لا يخزن قيمة redaction أو payload أو key أو secret.

## Explicitly excluded effects

لا ينشئ PR-12 Invoice أو Purchase أو Expense أو DeliveryNote أو Partner أو Product أو Unit. لا يستدعي `post()` ولا يكتب JournalEntry أو JournalLine أو Payment أو StockMovement ولا يغير مسودات المعاملات أو builders أو workflows المالية.

| العملية | الحساب | مدين | دائن |
|---|---|---:|---:|
| عرض عمليات أو usage | لا قيد | — | — |
| retry أو hold أو redaction أو retention | لا قيد | — | — |
| export أو diagnostics | لا قيد | — | — |

لا يفعّل PR-12 AI أو provider network أو R2/S3 أو durable storage أو Redis أو worker أو ClamAV أو Render أو scheduler أو cron أو polling أو webhook أو inbound API أو credentials.

## Rejected alternatives and deferrals

| البديل | سبب الرفض أو التأجيل |
|---|---|
| lifecycle processing أو readiness service جديد | يكرر مصادر الحقيقة ويخالف ownership القائم. |
| حذف `DocumentFile` أو evidence rows عند purge | يكسر FK والتدقيق والروابط المالية المحتملة. |
| purge evidence المرتبط بمعاملة | القرار المحافظ skip إلى حين سياسة قانونية/مالية مستقلة. |
| redaction يكتب القيمة الجديدة إلى extraction أو review change | يغير الدليل الأصلي وقد يغير input بناء المسودة. |
| تسعير مزود أو تحويل FX | لا توجد evidence موثوقة أو محرك تسعير مصرح به. |
| support bypass أو impersonation للتشخيص | لا يوجد عقد support محدد النطاق والموافقة والتدقيق. |
| scheduler أو retry تلقائي | يتطلب قرار تشغيل وتفويض موارد منفصلين. |

## Verification

تغطي اختبارات PR-12 رفض extraction retry مع network gate مقفلة من دون job، hold/retention dry-run، redaction display-only، diagnostics بلا object key، CSV formula safety وصفر قيود يومية. تغطي suites القائمة tenant/branch/RBAC/entitlement وprocessing/extraction/intake. يفحص CI الهجرات وقيودها على SQLite وPostgreSQL، وتتحقق الواجهة من TypeScript وVitest وNext build وPlaywright للواجهات المتغيرة.
