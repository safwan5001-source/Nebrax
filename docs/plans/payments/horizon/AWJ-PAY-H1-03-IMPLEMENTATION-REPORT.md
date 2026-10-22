# PAY-H1-03 — Implementation Report

STATUS: **IN REVIEW** (PR مفتوح، غير مدموج، غير منشور)
DATE: 2026-10-22

## Outcome

نواة تنسيق المدفوعات: `payment_attempts`، عقدا `Payable` و`GatewayAdapter`، سجل المحوّلات، `FakeGatewayAdapter`، آلة حالات رتيبة، ومنسّق (`PaymentOrchestrator`) مربوط بضابط التفعيل وRBAC وعزل المستأجر. **صفر أثر مالي**: لا سند ولا قيد ولا تخصيص ولا استدعاء لـ`PaymentService`/`LedgerService` (اختبار حارس يمنعه). لا واجهة HTTP (مستهلكوها H1-04/H2-02).

## Design

| القرار | السبب |
|---|---|
| `payment_attempts` CompanyWide + `branch_id` لقطة (D-07)؛ FK البوابة بلا CASCADE | بوابة لها محاولات لا تُحذف من القاعدة؛ حذف المستأجر المتسلسل يمرّ (مختبَر على PostgreSQL) |
| `UNIQUE(tenant, idempotency_key)` + فهرس جزئي «محاولة نشطة واحدة لكل Payable» + فهرس جزئي لمرجع المزوّد + CHECK (مبلغ>0، التقاط≥استرداد≥0، حالات معروفة) | الضمانات في القاعدة بالمحرّكين لا في الكود وحده (SQLite عبر مُشغّلين) |
| الحالة الرتيبة في النموذج (`updating`) تحت قفل صف المحاولة؛ التقاط بعد إلغاء/انتهاء محلي مسموح ويُرفع `late_capture` (D-15) | كل مسار كتابة يمرّ بالحارس؛ حارس القاعدة (مُشغّل) ضمن PAY-H8-01 |
| **الأحداث المتأخرة/المكررة/خارج الترتيب:** `applySnapshot` يطبّق حقيقة المزوّد رتيباً؛ الأدنى رتبة أو المكرر ⇒ لا أثر؛ مال محتجز لدى المزوّد لمحاولة أُغلقت محلياً ⇒ `state_conflict` للمراجعة | يغني عن الاعتماد على ترتيب وصول الأحداث؛ جدول أحداث المزوّد وdedupe الجسم يصلان في H1-04 |
| مبلغ/عملة الالتقاط المختلفان يُسجَّلان ويُعلَّمان (`amount_mismatch`/`currency_mismatch`) ولا يُخفيان | «requires_review بلا ترحيل» (الخطة §4) |
| `start()` يشترط الضابط؛ `sync()`/`cancel()` لا يشترطانه | الضابط يوقف **البدء**؛ ما التقطه المزوّد يجب أن يبقى قابلاً للمطابقة حتى أثناء الإيقاف الطارئ |
| لا شبكة داخل معاملة: إنشاء الصف ← استدعاء المزوّد ← تثبيت النتيجة؛ فشل المزوّد يترك `created` وإعادة الطلب تكمل بمعرّف المحاولة نفسه مفتاحاً عند المزوّد | منع تكرار صفحة الدفع عند المزوّد |
| العقد `GatewayAdapter` يضم ما يستهلكه المنسّق الآن (`provider/capabilities/createCheckout/fetchPayment`) ويتسع إضافياً | لا واجهات لا يستهلكها أحد (التحقق/Webhook/الالتقاط/الاسترداد/التسويات في شرائحها) |
| `FakeGatewayAdapter` لا يُحلّ إلا في `local`/`testing` وخارج `PaymentGateway::PROVIDERS` | غير قابل للاختيار في الإنتاج ولا من واجهة الإدارة |
| RBAC: فاعل بشري ⇒ نفس المستأجر + `payments.manage`؛ المسارات النظامية (مطابقة/webhook) بلا فاعل | احترام `Rbac` دون مسار HTTP جديد |

## Changed files

- `database/migrations/2026_11_25_010000_create_payment_attempts_table.php`.
- `app/Models/PaymentAttempt.php`؛ `app/Models/PaymentGateway.php` (`hasFinancialReferences()` تشمل المحاولات — بند B-2).
- `app/Contracts/Payments/Payable.php`, `GatewayAdapter.php`.
- `app/Support/Payments/`: `GatewayCapabilities`, `AttemptContext`, `HostedCheckout`, `ProviderPaymentSnapshot`, `AttemptTransitionResult`, `PaymentOrchestrationException`.
- `app/Services/Payments/`: `PaymentOrchestrator`, `GatewayAdapterRegistry`, `FakeGatewayAdapter`.
- اختبارات: `PaymentAttemptTest` (24)، `PaymentAttemptPostgresTest` (5، `pcntl_fork`)، `tests/Support/TestPayable.php`؛ تعديل حارس «لا مسار وصول للضوابط» في `PaymentsRolloutControlTest` ليسمح بالمنسّق قارئاً وحيداً.
- توثيق: تحديث تقريرَي H1-01/H1-02 والطابور (بلا PR توثيقي منفصل).

## Tests and exact results

- `PaymentAttemptTest`: **24 ناجحاً على SQLite وعلى PostgreSQL 16 حقيقي** (محلي). تغطي: إنشاء بلا أثر مالي، idempotency (إعادة/تعارض)، محاولة نشطة واحدة، إعادة حساب المبلغ، رفض غير القابل للدفع/صفر/عملة/مفاتيح، انقطاع المزوّد والاستئناف بالمفتاح نفسه، الضابط (غير مفعَّل/إيقاف منصة/رفعه/لا يحجب المطابقة)، اتصال غير صالح/بلا محوّل، منع Fake في الإنتاج، التقدّم الرتيب والأحداث المتأخرة/المكررة/خارج الترتيب، الالتقاط المتأخر، فروق المبلغ/العملة، تعارض الحالة، رفض لقطة غريبة، منع كل كتابة رجعية أو تغيير هوية أو حذف، قيود القاعدة (CHECK وفرادة)، حماية حذف البوابة (نموذج + SQL خام)، رفض التراجع، عزل المستأجر (قراءة/مزامنة/إلغاء/اتصال أجنبي/تزوير)، RBAC (موظف/مالك مستأجر آخر مرفوضان، محاسب مقبول)، وحارس «لا دفتر موازٍ».
- `PaymentAttemptPostgresTest`: **5 ناجحة، مكرّرة 5 مرات بلا تذبذب** على PostgreSQL 16 (محلي، `pcntl_fork`): طلبات متطابقة ⇒ محاولة واحدة؛ مفاتيح مختلفة لـPayable واحد ⇒ نشطة واحدة بلا جمود؛ لقطات متضاربة متزامنة ⇒ `captured` رتيب بلا مراجعة؛ مزامنات متطابقة ⇒ انتقال واحد؛ حذف المستأجر المتسلسل رغم FK البوابة.
- مجموعة ذات صلة على PostgreSQL المحلي (`PaymentsRollout|PaymentGateway|PaymentAttempt|BranchIsolationGuard|ZatcaRolloutControl|ApiUnauthenticated|CustomerRefund|PaymentReversal`): **235 ناجحاً (1853 assertion)** — تشمل اختبارات تزامن ضوابط التفعيل وZATCA على PostgreSQL فعلياً.
- المجموعة الكاملة: @@FULL@@

## CI

@@CI@@

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: —

## Merge / Post-merge

- Merge: لم يُدمج — بانتظار موافقة المالك. لا Deploy.

## Self-review

- **Implementer:** أصغر نواة تغطي بنود الطابور؛ لا واجهة HTTP، لا جدول أحداث مزوّد، لا ترحيل.
- **Reviewer:** ترتيب الأقفال بسيط (صف المحاولة وحده)؛ لا شبكة داخل معاملة؛ سباق الإنشاء يعتمد فهارس القاعدة ثم يعيد القراءة بعد تراجع المعاملة بالكامل (آمن على PostgreSQL، مختبَر بعمليات متزامنة).
- **AWJ Guardian:** صفر قيود/سندات/فواتير وحارس ساكن يمنع استدعاء الخدمات المحاسبية؛ لا ZATCA؛ العزل بنطاق المستأجر + منع تزوير المستأجر والبوابة؛ لا أسرار في أي كائن مُنتَج (المحوّل يقرأها من الاتصال داخلياً).

## Accounting impact

لا يوجد. لا عملية مالية ⇒ لا قيود ناتجة. `captured` حالة تنسيق فقط؛ ترحيلها سند 1170/1130 شريحة H2-02 بعد اعتماد آلية D-12.

## Tenant / branch isolation impact

`PaymentAttempt` `CompanyWide` (حارس تصنيف الفروع يمرّ) و`branch_id` لقطة وقت الإنشاء لا عزل. الاتصال يُحلّ بنطاق المستأجر، فاتصال مستأجر آخر غير موجود للمنسّق.

## Security / authorization impact

لا استدعاء شبكي حقيقي (Fake فقط، محصور بـ`local`/`testing`). فاعل بشري يتطلب `payments.manage` ونفس المستأجر.

## Risks / remaining work

- **حارس القاعدة للانتقالات الرتيبة والحذف** (مُشغّل) غير مضاف: الحماية اليوم في النموذج؛ كتابة SQL خام قد تتجاوزها. مؤجل إلى PAY-H8-01 (مع حارس حذف البوابة الخام)؛ الحذف الخام للبوابة يحميه FK.
- **محاولة `created` عالقة** (انقطاع بين الإنشاء واستدعاء المزوّد) تحجز الـPayable حتى يُكمل المستخدم بالمفتاح نفسه أو يُلغى؛ التقاطها وانتهاء المحاولات تلقائياً يصلان مع المطابِق المجدول (H1-04) وحجوزات H4-02.
- أحداث المزوّد (الجدول، التوقيع، حد الجسم، dedupe بالمعرّف/البصمة) في H1-04؛ `applySnapshot` هو نقطة تطبيقها.
- `verify`/`testing` للاتصال ينتظر أول محوّل حقيقي (H2-01). `dispute_status` عمود جاهز بلا منطق (H5-01).
- تثبيت PostgreSQL محلياً مكّن من تشغيل اختبارات التزامن فعلياً هنا؛ يبقى جوب CI مرجع القبول.

## Recommended next dependency-ready task

PAY-H1-04 (صندوق الأحداث والمستقبِل والمُطابِق: `payment_provider_events`، `POST /api/payment-webhooks/...`، `payments:reconcile-attempts` مجدول بإيجار، وتمرين استعادة المتعثّر ADR-0004 §5).

## Git state

- Branch: `claude/awj-payments-h1-03-orchestration`
- Base: `b6cf409b102f80ac06a2a5ab49105b8b3c792fa3`
