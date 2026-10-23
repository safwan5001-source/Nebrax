# AWJ-PAY-H3-02a — قراءة ومعاينة تسويات البوابة (بلا ترحيل)

DATE: 2026-10-23 · ADR-0008 (proposed) · شريحة مستقلة لا تتطلب قراراً

## القيود المحاسبية الناتجة
**لا قيد.** كل المسارات قراءة أو معاينة؛ اختبار صريح يثبت ثبات `journal_entries` و`payment_gateway_settlements` بعد المعاينة.

## ما أُضيف
- `PaymentGatewaySettlementService::preview()` (بلا كتابة ولا أقفال) و`unsettledPayments()`؛ القواعد نفسها التي يطبّقها `post()` فحكم «قابل للترحيل» يطابق ما يقبله الترحيل (اختبار توازي لضريبة الرسوم والاستقطاعات والاعتمادات).
- `GET /payment-gateway-settlements` · `GET /payment-gateway-settlements/{id}` · `POST /payment-gateway-settlements/preview` · `GET /payment-gateways/{id}/unsettled-payments` — كلها `payments.view`، معزولة بالمستأجر (404)، بلا أسرار البوابة، والمعاينة بحدّ معدّل.
- D-21 مرئياً: الفرق غير المفسَّر يُعاد برقمه وسببه (`unreconciled_difference`) بدل رفض صامت؛ أخطاء البنود تُعاد `invalid_items` لا استثناءً.

## الاختبارات
`PaymentGatewaySettlementReadApiTest` (6) + مجموعات الجاهزية/التسوية/الحراس المجاورة خضراء محلياً.

## حدود
لا مسار ترحيل (02b بعد اعتماد A6/D-21) · لا بنود استرداد/تعديل · لا استيراد. المرجع: ADR-0008.
