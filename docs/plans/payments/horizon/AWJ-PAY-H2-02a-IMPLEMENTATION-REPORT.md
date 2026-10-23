# AWJ-PAY-H2-02a — مخطط طلبات دفع الفواتير ومجموعة ترحيل الالتقاط

**الحالة:** منفَّذ (مخطط ونماذج وحراس فقط). **لا ترحيل ولا سند ولا قيد في هذه الشريحة** — الترحيل H2-02c وفق مصفوفة ADR-0006.

## ما بُني
| البند | التفصيل |
|---|---|
| `invoice_payment_requests` + `InvoicePaymentRequest` | طلب دفع لفاتورة (CompanyWide + `branch_id` لقطة). `allow_partial` افتراضه `false` (D-16) وثابت بعد الإنشاء؛ هوية الطلب (فاتورة/طرف/بوابة/عملة) ثابتة؛ حالات رتيبة open ← cancelled/completed/expired؛ **طلب مفتوح واحد لكل فاتورة** بفهرس فريد جزئي؛ `token_hash` فريد (للـAPI العام لاحقاً)؛ لا حذف |
| `payment_attempt_postings` + `PaymentAttemptPosting` | سجل ربط ثابت (append-only) بين المحاولة وسند القبض: `UNIQUE(payment_attempt_id, role)` (أدوار `allocated`/`excess`) و`UNIQUE(payment_id)`؛ يتحقق النموذج من الدور والمبلغ ومن أن المحاولة والسند من المستأجر نفسه |
| أعمدة `payment_attempts` | `posting_status` (pending/posted/blocked_period/not_postable) · `accounting_date` · `posting_blocked_reason` (json) · `posted_at`. خريطة انتقال مغلقة (`pending ← posted/blocked_period/not_postable`، `blocked_period ← posted` للمعالجة R1)؛ تتطلب محاولة ملتقطة؛ `accounting_date` و`posted_at` ثابتان بعد تثبيتهما |
| القاعدة | CHECK على الحالات والمبالغ (قيد في PostgreSQL، مُشغّلات مكافئة في SQLite)؛ حالة ترحيل على محاولة غير ملتقطة مرفوضة؛ FK بلا CASCADE يمرّ معه حذف المستأجر المتسلسل؛ `down()` يرفض عند وجود صفوف أو حالة ترحيل |

## الاختبارات (`PaymentPostingSchemaTest`، 11، SQLite وPostgreSQL)
افتراضات الطلب · ثبات الهوية والحالات · فهرس الطلب المفتوح الواحد وتفرّد الرمز · رفض حالة مجهولة من القاعدة · عزل المستأجر (فاتورة/بوابة/محاولة/سند من مستأجر آخر، تزوير `tenant_id`) · دور واحد لكل محاولة وسند واحد لمجموعة · append-only والتحقق · خريطة حالات الترحيل واشتراط الالتقاط وثبات التاريخ · رفض القاعدة لحالات مجهولة · رفض التراجع مع صفوف أو حالة.

## القيود الناتجة
لا شيء (لا خدمة ترحيل، لا سند). الجدول الكامل للشريحة c في `docs/decisions/ADR-0006-payments-h2-02-owner-decisions-and-posting-matrix.md`.

## التالي
H2-02b: `InvoicePayable` + إنشاء/إلغاء طلب الدفع (D-16).
