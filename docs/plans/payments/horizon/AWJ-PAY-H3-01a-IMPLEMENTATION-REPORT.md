# AWJ-PAY-H3-01a — عقد استرداد المحوّل (تقرير التنفيذ)

الأفق: AWJ-PAYMENTS-HZ-01 · ADR-0007 (§8–§9) · **لا أثر محاسبي إطلاقاً**: لا `LedgerService` ولا سندات ولا مستندات ولا هجرات. شريحة مستقلة آمنة تُنفَّذ بالتوازي مع بوابة قرار A5.

## ما بُني
| البند | التفصيل |
|---|---|
| `RefundsPayments` (قدرة اختيارية على نمط `VerifiesGatewayCredentials`) | `refundPayment(gateway, providerPaymentId, amountMinor): PaymentProviderRefund`؛ عقد صريح: **لا إعادة محاولة داخل المحوّل**؛ نتيجتان فقط عند الفشل |
| `PaymentRefundRejectedException` | **لم يُنفَّذ شيء قطعاً** (رفض 4xx/401/403/429/404، سقف، دفعة غامضة، فشل قراءة قبل الإرسال، مفتاح Live في Sandbox) |
| `PaymentRefundUnknownException` | **قد نُفِّذ** (انقطاع/مهلة/5xx بعد الإرسال، أو استجابة 2xx غير مفهومة): لا يُحرَّر الاحتجاز ولا تُعاد المحاولة عمياء — يحسمها المطابِق بالتراكمي |
| `PaymentProviderRefund` | `refundedMinor` **تراكمي** (حقيقة المزوّد) + العملة + `refundedAt` |
| `PaymentProviderSnapshot::$refundedMinor` (إضافي، افتراضه 0) | يُملأ في Moyasar من `payments[].refunded`؛ أساس مطابقة الاسترداد؛ **لا يغيّر الحالة** (دفعة مستردة جزئياً تبقى `captured`) |
| `PaymentGatewayCapabilities::$refunds` (افتراضه `false`) | لا قدرة تُعلَن بلا تنفيذ؛ `true` لـMoyasar وFake |
| `PaymentGatewayAdapterRegistry::refunder()` | يعيد المحوّل إن دعم الاسترداد وإلا `null` |
| `MoyasarApiClient::refundPayment` | `POST /payments/{id}/refund` بـ`{amount}` — **بلا retry** (الاستثناء الوحيد لمسار `/payments`، ويُحدَّث حارس الاختبار ليسمح به حصراً) |
| `MoyasarAdapter::refundPayment` | يحلّ **الدفعة المسدَّدة الوحيدة** من فاتورة المحاولة (صفر/أكثر من واحدة ⇒ رفض غامض)، يتحقق من العملة والسقف (≤ الملتقط − المسترد) **قبل** الإرسال، ثم POST واحد؛ يفحص الاستجابة (المعرّف، `refunded` عدد صحيح ≤ مبلغ الدفعة) |
| `FakePaymentGatewayAdapter` | استرداد تراكمي حتمي + `failNextRefund('rejected'|'unknown_not_applied'|'unknown_applied')` (الأخيرة: نُفِّذ ثم ضاع الردّ) + `scriptRefunded` لاسترداد خارجي + `refundCalls` |

## أدلة وحدود
- **External Evidence:** وثائق Moyasar الرسمية (Refund Payment، Payment Operations): `POST /v1/payments/{id}/refund`، `amount` اختياري، `refunded` تراكمي، توصية «افحص ثم أعد مرة واحدة». **غير موثَّق ولم يُفترض:** idempotency للاسترداد، حالة الدفعة بعد استرداد جزئي، تعدد الاستردادات الجزئية، webhook الاسترداد.
- **لا تحقق حقيقي:** كل الاستجابات Fixtures؛ استرداد Sandbox الفعلي **PENDING(EXT-01)** (مفاتيح يُدخلها المالك من الواجهة).
- لا واجهة ولا مسار API ولا صلاحية في هذه الشريحة.

## التحقق
- `MoyasarRefundTest` (22): جزئي/تراكمي/سقف الملتقط/مبلغ غير صالح/دفعة غير مسدَّدة أو غامضة/عدم تطابق المرجع/8 أشكال فشل POST بلا إعادة محاولة (400/401/404/429 ⇒ رفض؛ 500/503/انقطاع/غير JSON ⇒ غير معروف) + استجابات 2xx معيبة ⇒ غير معروف + مفتاح Live لا يصل الشبكة + لقطة `refundedMinor` + القدرة والسجل + الفيك (تراكم، سقف، ثلاثة أشكال فشل، استرداد خارجي) + حارس ساكن: لا لمس للدفتر/السندات/المستندات.
- المجموعات المجاورة (184): `MoyasarAdapterTest` (مع الحارس المعدَّل)، `PaymentAttempt*`، `PaymentGateway*`، `InvoicePaymentRequest*`، `PaymentInbox*` خضراء.
