# AWJ-PAY-H2-01a — محوّل Moyasar (Sandbox، بلا مفاتيح حقيقية)

> AWJ-PAYMENTS-HZ-01 · القرار: `docs/decisions/ADR-0005-moyasar-first-byog-provider.md` (Sandbox فقط؛ لا Live ولا تعاقد). **لا قيد محاسبي ولا سند ولا ترحيل في هذه الشريحة.**

## ما بُني (فوق البنية القائمة، بلا بنية موازية)
| المكوّن | الدور |
|---|---|
| `PaymentGateway::PROVIDER_MOYASAR` + `PaymentGatewayAdapterRegistry::ADAPTERS` | تسجيل المزوّد؛ `fake` يبقى `local/testing` فقط (مختبَر في وضع production) |
| `MoyasarAdapter` (`GatewayAdapter`) | `createCheckout` (فاتورة مستضافة، استئناف بالـmetadata)، `fetchPayment` (فاتورة+دفعات ⇒ لقطة رتيبة)، `verifyWebhook` (`secret_token`) |
| `MoyasarApiClient` | Basic Auth بالمفتاح السري، مهل 15/5ث، أخطاء نمطية بلا أسرار، إعادة محاولة قراءات GET فقط (عند انقطاع الاتصال) |
| `MoyasarCredentialPolicy` | Sandbox يقبل `sk_test_/pk_test_` فقط؛ يرفض `live` برمز ثابت؛ يمنع خلط السري/القابل للنشر؛ **بيئة live ممنوعة** (`live_enabled=false` ثابت) — عند الإنشاء/التعديل/التدوير وعند كل استدعاء شبكي |
| `RedactsStoredWebhookBody` + `PaymentWebhookInbox` | `secret_token` يُنقَّح من الجسم المخزَّن (البصمة على الخام) |
| `config/payment_providers.php` | مهل، عمر الصفحة، نطاقات رابط الدفع المقبولة |

## قرارات تصميم موثّقة
- **لا بيانات بطاقة في خادمنا**: فاتورة مستضافة؛ حارس ساكن يمنع مسار `/payments` وحقول البطاقة ولمس `LedgerService`/`PaymentService`/الفواتير/ZATCA.
- **الدفع لا يُؤكَّد بالـCallback ولا بجسم الـwebhook**: الحدث يطلق استعلام `GET /invoices/{id}`؛ جسم يدّعي «paid» والمزوّد يقول `initiated` ⇒ لا التقاط (مختبَر).
- **الـwebhook**: لا HMAC في وثائق Moyasar — مقارنة `secret_token` بثبات زمني مع السرّ الحالي ثم السابق (نافذة السماح)؛ `live` المخالف لبيئة الاتصال مرفوض؛ مطابقة المحاولة بـ`data.invoice_id`؛ أحداث بلا فاتورة (`card_auth_*`، دفع مباشر) ⇒ `unmatched`.
- **idempotency**: لا مفتاح موثّق لإنشاء الفاتورة ⇒ بحث `metadata[awj_attempt_id]` قبل الإنشاء؛ استجابة ضائعة ثم إعادة بالمفتاح نفسه ⇒ نفس الفاتورة بلا POST ثانٍ (مختبَر). POST بلا إعادة محاولة تلقائية.
- **رابط الدفع المقبول** https ومضيف ينتهي بـ`moyasar.com` فقط (يرفض مضيفاً غريباً/`http`/`javascript:`).
- **التعيين**: دفعة `paid|captured|refunded` ⇒ captured (المبلغ المسدَّد من الدفعات؛ فرقه عن المحاولة يرفع `amount_mismatch` عند المنسّق)، `authorized` ⇒ authorized، فاتورة `expired` ⇒ expired، `canceled|voided` ⇒ cancelled، وغير ذلك (`initiated|failed|on_hold`) ⇒ pending_customer؛ فاتورة `paid` بلا دفعة مسدَّدة ⇒ خطأ (لا التقاط بلا دليل).

## الاختبارات
`MoyasarAdapterTest` **47** على SQLite وPostgreSQL (Fixtures + `Http::fake`): نجاح، استئناف بعد استجابة ضائعة، تعارض مبلغ، حد أدنى، رابط غير موثوق، أخطاء HTTP (401/403/404/400/422/429/500/503) بلا تسريب أسرار، انقطاع الشبكة وإعادة القراءة وعدم إعادة POST، تعيين الحالات (3DS/رفض/جزئي/مسترد/مفوَّض/منتهٍ/ملغى)، مكرر/متأخر/خارج الترتيب، دفعة بعد انتهاء محلي ⇒ `late_capture`، فرق مبلغ ⇒ مراجعة، webhook (سرّ خاطئ/غائب/سابق منتهٍ/سابق ضمن النافذة/live/جسم غير مفهوم/مكرر/جسم مختلف بالمعرّف نفسه/بلا فاتورة/انقطاع ⇒ 503 ثم نجاح)، عزل مستأجر، سياسة المفاتيح عبر API (إنشاء/تدوير/تعديل)، دفاع بالعمق (صف بمفتاح live يُكتب خارج الخدمة لا يصل للشبكة)، `fake` غير متاح في production، لا بطاقة ولا دفتر. السجل الكامل في وصف الـPR.

## القيود المحاسبية الناتجة
**لا شيء.** المحوّل والمنسّق لا يكتبان قيوداً ولا سندات ولا `Payment`؛ الترحيل عبر `PaymentService` يأتي في PAY-H2-02. (الحارس الساكن + `assertNoFinancialArtifacts` في الاختبارات.)

## معلّق / عوائق
| البند | الحالة |
|---|---|
| دفعة Sandbox حقيقية (معرّف الفاتورة/الدفعة، حدث webhook، استعلام، بطاقة نجاح/رفض/3DS) | **PENDING — EXT-01 credentials** (لا مفاتيح؛ لم تُطلب في المحادثة) |
| تثبيت: شكل غلاف قائمة الفواتير · صيغة مرشح `metadata[key]` · جسم `payment_paid` الفعلي · قبول فاتورة `failed` محاولة جديدة | يُثبَّت في Sandbox |
| إجراء التحقق (`verified_at`) — **لازم لاستعمال الاتصال** (المنسّق يشترط الاعتماد المتحقَّق منه) | شريحة PAY-H2-01b |
| واجهة مزوّد moyasar وشعاراته | شريحتا H2-01b/c |
