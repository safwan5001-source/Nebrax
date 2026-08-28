# ADR-013 — Hardening and Gradual Rollout Readiness

- **الحالة:** مطبّق — جاهزية فقط.
- **النطاق:** PR-13 لمركز المستندات.
- **القرار:** تُعامل القدرة الحالية كـ**Stage 0 inert**: الكود والـschema والاختبارات موجودة، بينما يظل إرسال المستندات إلى مزود خارجي، التخزين الدائم، العامل، الفاحص، Redis والجدولة غير مفعّلة.

## السياق وقرار عدم التفعيل

مركز المستندات يملك حدوداً متعددة: tenant وbranch، منصة منفصلة، أدلة extraction immutable، مسودات أعمال صريحة، وطبقة حوكمة للاحتفاظ. الجاهزية التقنية لا تمنح تفويضاً لتشغيل مزود أو مورد. لذلك لا يتضمن هذا القرار API عاماً، webhook، poller، scheduler، worker، credentials تشغيلية أو تغيير Render/R2/S3/Redis/ClamAV.

> ينجح `documents:readiness --json` عندما يوجد code/schema المطلوبان. كما يصرح بأن التفعيل الخارجي **غير مضبوط عمداً**؛ لا يجري هذا الأمر اتصالاً أو كتابة أو حذفاً ولا يعرض secrets أو endpoints.

## نموذج التهديد والحدود

ملخص المخاطر والضوابط التفصيلية موجود في [THREAT-MODEL.md](./THREAT-MODEL.md)، ومصفوفة كل endpoint في [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md). كل مسار tenant يبدأ بهوية Sanctum ثم سياقي tenant وbranch الموثوقين وصلاحية وتعهد تجاري. المنصة تحتاج `PlatformAdministrator` منفصلاً وقدرة token صريحة؛ لا يوجد support bypass.

| الخطر | القرار المنفذ |
|---|---|
| IDOR وcross-tenant/branch | bindings وscopes موروثة من السياق؛ اختبار مصفوفة سلبي يغطي review/download/retry/hold/redaction/diagnostics/export. |
| سباق hold مع retention purge | ترتيب قفل ثابت `batch → file` في المسارين، وإعادة قرار planner تحت القفل قبل حذف object؛ hold جديد **يُرفض** ما دام `purge_pending_at` قائماً حتى تتم المصالحة، وhold سابق للـclaim يمنع الحذف عند إعادة التخطيط تحت القفل فيُلغى pending ويُسجّل skip. |
| تسرب secrets أو raw evidence | projections وdiagnostics وexports تسمح فقط بالحقول الآمنة؛ readiness لا يطبع configuration. |
| تشغيل provider غير مقصود | `DocumentProviderNetworkGate` افتراضه false، ويختبر direct connection-test وjob path انعدام HTTP حين القفل. |
| فقدان purge عند failure | pending durable أولاً، ثم حذف حصري عبر `DocumentStorageService`، و`storage_failed`/reconciliation أو skip بأثر append-only. |

## التفويض والعزل والتزامن

تخضع الحزمة والملف وrun والنتيجة وhold وoverlay إلى tenant/branch scopes؛ ويجب ألا يقبل controller معرف نطاق من body. الاستثناء الوحيد هو runner المنصّي المحروس الذي يعيد تركيب السياق الموثوق لكل candidate ويستعيد السياق السابق في `finally`. أحداث review/governance/provider usage غير قابلة للتحديث أو الحذف. لا يسمح optimistic version في review بآخر كتابة صامتة، وتعتمد intake/source receipt/draft builders على مفاتيح idempotency وقيود فريدة.

## الفشل المغلق والاسترداد

تفشل queue/scanner/provider/storage/entitlement/RBAC/app-state إلى نتيجة آمنة، بلا نجاح مزعوم أو object orphan أو ترحيل مالي. راجع [RECOVERY-RUNBOOK.md](./RECOVERY-RUNBOOK.md) للتشخيص والاسترداد المقيد، و[ROLLBACK-RUNBOOK.md](./ROLLBACK-RUNBOOK.md) للتراجع عن نشر مستقبلي، و[INCIDENT-RUNBOOK.md](./INCIDENT-RUNBOOK.md) للتصعيد.

## الأداء والهجرات والوصولية

تظل صفحات العمليات paginated ومقيدة، exports streamed عبر `SpreadsheetWriter` أو cursor وبـformula protection، وretention محدود بـ500 candidate مع cursor. لم يضف PR-13 migration؛ أُجري rehearsal محلي SQLite `fresh → rollback(step=1) → migrate` فقط. CI PostgreSQL هو دليل التوافق غير المحلي. صفحة المنصة تحافظ على AR/EN وRTL/LTR والوضعين وتستعمل حالات نصية إضافة إلى اللون؛ رابط العودة الرمزي يحمل اسماً وصولياً.

## مراحل rollout المستقبلية

| المرحلة | الحالة | شرط الانتقال |
|---|---|---|
| Stage 0 — inert code/schema | هذه PR | CI أخضر، readiness، لا activation. |
| Stage 1 — owner-approved preflight | مؤجلة | مراجعة [ACTIVATION-CHECKLIST.md](./ACTIVATION-CHECKLIST.md) واعتماد المالك والبيانات القانونية/الإقليمية. |
| Stage 2 — controlled canary | مؤجلة | مشروع تشغيل منفصل، موارد خاصة، مراقبة وrollback مثبت. |
| Stage 3 — tenant rollout | مؤجلة | قرار مالك مستقل، لا auto-enable ولا bulk migration. |

## rollback وincident والمخاطر المتبقية

لا يوجد rollback تشغيلي لهذه PR لأنها لا تفعّل مورداً ولا تضيف migration. أي نشر مستقبلي يتبع runbook ولا يعالج بيانات evidence بالحذف اليدوي. المخاطر المتبقية هي **مخاطر تشغيلية متعمدة**: لا worker/scanner/storage/provider خارجي حتى اعتماد المالك؛ كما تبقى حالة الموارد مراقَبة عبر diagnostics/readiness لا عبر polling تلقائي. لا توجد آثار مالية: لا posting، لا journals، لا payments، لا stock، ولا master-data تلقائية.
