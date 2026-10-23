# AWJ-PAY-H3-01d — واجهة REST لاستردادات البوابة (API + RBAC + العزل)

DATE: 2026-10-23 · ADR-0007 (accepted) · يعتمد على H3-01b/c

## القيود المحاسبية الناتجة
**لا قيد جديد.** الواجهة طبقة رقيقة فوق `PaymentRefundService` و`PaymentRefundPostingService`؛ القيد الوحيد (A5: مدين 1130 + الطرف / دائن 1170) ورد في H3-01c ويُنتَج عند التأكيد وعبر `repost` فقط. اختبار التكامل في هذه الشريحة يتحقق من سطري القيد بعد مسار الواجهة.

## المسارات (كلها داخل مجموعة المصادقة، معزولة بالمستأجر: معرّف مستأجر آخر ⇒ 404)
| المسار | الصلاحية |
|---|---|
| `GET /payment-refunds` (مرشحات: status, posting_status, payment_attempt_id, partner_id) · `GET /payment-refunds/{id}` (تخصيصات، استدعاءات، خط زمني بالفاعلين) · `GET /payment-attempts/{id}/refund-context` (السعة، المانع، المصادر المؤهَّلة) | `payment_refunds.view` |
| `POST /payment-refunds` (مفتاح منع تكرار إلزامي) | `payment_refunds.request` |
| `POST /payment-refunds/{id}/approve` (`submit=true` اختياري) · `/submit` · `/reject` | `payment_refunds.approve` |
| `POST /payment-refunds/{id}/cancel` | `payment_refunds.view` + الطالب أو صاحب الاعتماد (تفرضه الخدمة) |
| `POST /payment-refunds/{id}/resolve` · `POST /payment-attempts/{id}/resolve-external-refund` | `payment_refunds.resolve_unknown` |
| `POST /payment-refunds/{id}/repost` | `payments.resolve_blocked` |

رموز الرفض ثابتة `{error:{code,message}}`: 403 `forbidden` · 404 · 409 (`self_approval`, `invalid_state`, `busy`, `idempotency_conflict`, `unrecognized_refund_open`, `not_blocked`, `platform_stop`…) · 422 (التحقق وسقوف المبلغ والتخصيص). طلبات الكتابة بحدّ معدّل.
سجل المحاولات (`GET /payment-attempts[/{id}]`) يعرض الآن علم الاسترداد الخارجي (`unrecognized_refund`, `unrecognized_refund_minor`).

## الاختبارات
`PaymentRefundApiTest` (8، SQLite وPostgreSQL): المسار الكامل طلب ← اعتماد+إرسال ← ترحيل A5 · الصلاحيات الأربع والمجهول · التحقق ورموز الرفض · شرح المانع في السياق · رفض/إلغاء/حسم غير المعروف · علم الاسترداد الخارجي وحسمه · فترة مقفلة وإعادة الترحيل · العزل بين المستأجرين.

## حدود
لا واجهة مستخدم (H3-01e). استرداد Sandbox الحقيقي PENDING(EXT-01).
