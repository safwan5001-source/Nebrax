# AWJ-PAY-H3-01b — مخطط استرداد البوابة وآلة حالاته (بلا ترحيل)

DATE: 2026-10-23 · ADR: `docs/decisions/ADR-0007-payments-h3-01-gateway-refund-and-a5-matrix.md` (accepted) · يعتمد على H3-01a (#1689)

## النطاق
مخطط وآلة حالات وخدمة الطلب/الاعتماد/الإرسال/المطابقة والحسم + الدالة المشتركة لرصيد المصدر + قاعدة المزامنة. **لا قيد ولا سند ولا `LedgerService`** (القيد A5 = H3-01c). التأكيد يترك `posting_status = pending`.

## ما أُضيف
| الطبقة | العنصر |
|---|---|
| هجرة (إضافية فقط) | `payment_refunds` · `payment_refund_allocations` · `payment_refund_attempts` · `payment_refund_attempt_results` · `payment_refund_events` + عمودا `payment_attempts.unrecognized_refund_at/_minor` |
| قاعدة البيانات (PostgreSQL وSQLite) | CHECK/مُشغّلات الشكل · الطالب ≠ المعتمِد · معتمِد لازم لكل حالة بعد الموافقة · انتقالات مشروعة · حقول الهوية مجمّدة والمعتمِد ثابت · Σ التخصيصات = المبلغ عند الاعتماد · تخصيصات ثابتة بعد `requested` · سجلات الاستدعاء/النتيجة/الأحداث append-only · نتيجة نهائية واحدة لكل استدعاء · فهرس جزئي فريد: إرسال واحد في الطيران لكل دفعة · لا حذف |
| نماذج | `PaymentRefund` (`BelongsToBranch`) · `PaymentRefundAllocation` · `PaymentRefundAttempt` · `PaymentRefundAttemptResult` · `PaymentRefundEvent` (`CompanyWide`) |
| خدمات | `PaymentRefundService` · `PaymentRefundObservation` (قاعدة المزامنة) · `PaymentRefundReconciler` + أمر `payments:reconcile-refunds` (كل 5 دقائق) · `RefundSourceBalance` (الدالة المشتركة) |
| صلاحيات | `payment_refunds.view/request/approve/resolve_unknown` — owner/admin عبر `*` فقط، في `Rbac::PERMISSIONS` وليست في `MATRIX` |
| ترقيم | `payment_refund` في `DocumentNumberingCatalog` (بادئة `PRF`) |

## القواعد المنفَّذة (من ADR-0007)
- **الأهلية** تُعاد داخل القفل عند الطلب والاعتماد والإرسال مع استثناء المستند نفسه: التقاط مرحَّل · عميل مشتق من الالتقاط ومطابق للمصدر · فرع المصدر = فرع الالتقاط · عملة الدفعة = عملة المؤسسة · لا نزاع مفتوح · لا علم استرداد خارجي · بوابة متاحة وتدعم الاسترداد · Σ التخصيصات = المبلغ · ≤ رصيد المصدر · ≤ متبقي الدفعة (`captured − refunded − Σ محجوز`، المؤكَّد داخل `refunded_minor` فلا يُخصم مرتين).
- **الرصيد المشترك:** `CustomerRefundService::refundedTotal` يقرأ الآن `RefundSourceBalance` — الاستردادات النقدية المرحَّلة + استردادات البوابة {requested, approved, submitting, unknown, confirmed}. اختبار تكافؤ في الاتجاهين.
- **الإرسال خماسي المراحل** بلا شبكة تحت قفل: حجز الخانة ← `fetchPayment` للأساس ← تحقق الأساس + سجل الاستدعاء ← المزوّد ← النتيجة. أساس > المحلي ⇒ لا استدعاء ويعود `approved` وتُوسم الدفعة؛ ردّ مباشر بفائض ⇒ يُؤكَّد المطلوب ويُوسم الفائض؛ استثناء خارج العقد بعد الإرسال ⇒ `unknown` (لا يُعدّ رفضاً أبداً).
- **المطابقة:** `observed = baseline` ⇒ إعادة واحدة (`unknown → approved`, `retry_count ≤ 1`)؛ `observed = baseline + amount` ⇒ `probable_applied` يحتاج حسماً بشرياً؛ لا تأكيد آلي ولا إعادة إرسال أعمى.
- **الحسم البشري:** `resolveUnknown` (تأكيد بدليل / لم يُطبَّق) و`resolveExternalRefund` (يزامن التراكمي ويُلغي ذرّياً `requested`/`approved` بسبب `external_refund_resolved` بصلاحية الحاسم، مع تدقيق).
- **المزامنة العادية لا تكتب `refunded_minor`**: `PaymentOrchestrator::applySnapshot` يستدعي `PaymentRefundObservation` الذي يوسم الزيادة غير المفسَّرة (إلا مع استرداد داخلي قيد الطيران).

## القيود المحاسبية الناتجة
**لا شيء.** اختبار صريح يثبت أن عدد `journal_entries` لا يتغير عبر دورة طلب ← اعتماد ← إرسال ← تأكيد.

## الاختبارات
- `PaymentRefundTest` (28): المسار السعيد · جزئيان وحجز السعة · الفصل (خدمة + قاعدة) · الصلاحيات · الأهلية · الضابط · الرصيد المشترك · الاستثناء الذاتي · منع التكرار · رفض/غير معروف/إعادة واحدة/probable_applied/حسم بشري/فائض · الأساس القديم وحسم الاسترداد الخارجي · المزامنة العادية · يتيم submitting · حراس القاعدة · append-only · العزل بين المستأجرين · الحذف المتسلسل · المطابِق المجدول.
- `PaymentRefundPostgresTest` (5، `pcntl_fork` على PG): اعتماد متزامن · إرسال متزامن · طلبان يتجاوزان السعة · بوابة + نقدي على إشعار واحد · المفتاح نفسه.
- خضراء على SQLite وPostgreSQL محلياً؛ حراس الواجهة (risk/roles/messages) خضراء.

## مراجعة مستقلة قبل الدمج (Codex بلغ حدّ الاستخدام)
| # | الملاحظة | المعالجة |
|---|---|---|
| 1 | إعادة تقديم (بعد `unknown → approved`) تفشل قبل تسجيل استدعائها تبقى `submitting` للأبد لأن سجل التقديم الأول يُحسب دليل إرسال | عولج: `currentInvocation()` (التقديمات ≤ `retry_count + 1`)؛ يعود `approved`؛ اختبار |
| 2 | انهيار بين المرحلتين 3 و5 يترك `submitting` بلا مخرج | عولج: يُوسم `unknown` بنتيجة `worker_lost` (ADR §5-3)، والمرحلة 5 تقبل `unknown` إن عاد العامل الأصلي بنتيجة حقيقية؛ اختبار |
| 3 | تجويع المطابِق بمصنَّفات `probable_applied/needs_human` بلا تغيير `updated_at` | عولج: `touch()` يدوّرها إلى آخر الطابور؛ اختبار |
| 4 | لا ربط مستأجر مركّب في القاعدة بين الجداول | **حدّ معلن:** العزل بنطاق المستأجر في النماذج (`creating` تحلّ المراجع بنطاق المستأجر) والاستعلامات؛ وجداول الدفع الشقيقة (`payment_attempt_postings`…) بالنمط نفسه. دفاع إضافي مؤجَّل لمهمة عزل شاملة |

## حدود معلنة
- لا قيد ولا واجهة ولا API (01c/01d/01e). الدفعات متعددة الأبناء في Moyasar: `multi_payment_unsupported` يأتي من المحوّل (رفض قاطع بلا أثر).
- استرداد Sandbox الحقيقي PENDING(EXT-01).
