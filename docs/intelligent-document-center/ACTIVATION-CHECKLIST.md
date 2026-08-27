# Document Center Activation Checklist

> هذه **قائمة قرار مستقبلية وليست إجراء تشغيل**. لا ينفذ PR-13 أي بند فيها. لا يُفتح provider/network/storage/worker/scanner/scheduler أو موارد مدفوعة لمجرد أن البنود معلّمة؛ يلزم مشروع تشغيل منفصل وموافقة مكتوبة من المالك.

## الحوكمة والقانون

| تحقق مطلوب قبل أي Activation | المالك | الدليل |
|---|---|---|
| موافقة product/platform/security/tenant owner | المالك | قرار مؤرخ ونطاق tenants محدد |
| قرار data residency/DPA/retention | legal + data owner | وثيقة تعاقد/منطقة/مدة احتفاظ |
| Owner للـincident وon-call | operations | اسم فريق ومسار تصعيد |
| قرار تكلفة وحدود usage | platform finance owner | budget مستقل؛ لا pricing/FX داخل التطبيق |
| سياسة support بلا impersonation | security | إجراءات minimum-access فقط |

## البنية والهوية

- [ ] تخزين خاص durable مراجع: encryption، IAM least privilege، lifecycle، backup/restore drill.
- [ ] queue/worker/DLQ/heartbeat معزولة ومراقبة، بلا public inbound endpoint.
- [ ] scanner خاص مفحوص، والتصرف عند timeout/failure fail-closed مثبت.
- [ ] provider egress allowlist، secrets manager خارجي، timeout/limit/region/retention تم اعتمادها.
- [ ] لا يتم تخزين provider key في git أو logs أو diagnostics أو exports.
- [ ] لا R2/S3 cutover ولا Render paid change بلا owner approval منفصل.

## المنتج والأمان

- [ ] threat model وAuthorization Matrix مراجعان وحديثان.
- [ ] tenant/branch/platform denial وIDOR/redaction/signed-download/CSV/XSS suites خضراء.
- [ ] intake/replay/review/draft/retry/retention concurrency coverage خضراء.
- [ ] مبدأ لا auto-post/no journals/no payments/no stock/no auto master data ما زال مثبتاً.
- [ ] recovery وrollback وincident runbooks جُرّبت في بيئة معزولة.
- [ ] migrations الإنتاجية additive ومدعومة باستعادة وليس rollback مرتجل.

## قرار canary

- [ ] tenant canary يتطلب entitlement صريحاً ولا auto-enable.
- [ ] scope أقل من 1 tenant/branch وفق قرار المالك، مع deadline ومراقبة.
- [ ] observer/failure metrics ومبدأ kill switch وخطة rollback مثبتة.
- [ ] retention apply خارج canary الأول إلا بقرار data-owner/legal مستقل.
- [ ] لا auto approval أو auto draft أو auto posting ضمن canary.

## توقيع القرار

| البند | النتيجة | التاريخ UTC | الموقّع |
|---|---|---|---|
| PR-13 readiness فقط | مكتمل | — | — |
| Activation authorization | غير مصرح | — | — |
| Provider network | مقفل | — | — |
| Durable storage | معطل | — | — |
| Workers/scheduler | غير منشأة | — | — |

أي قيمة غير مكتملة تعني **التوقف** والعودة إلى Stage 0. هذه القائمة لا تشغل أمراً ولا تعدل إعداداً.
