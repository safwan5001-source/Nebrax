# AWJ-PAY-H2-02d — معالجة الدفعات الإلكترونية المحجوبة بفترة مقفلة (تقرير التنفيذ)

الأفق: AWJ-PAYMENTS-HZ-01 · الأساس: ADR-0006 M5-R1 · ADR-0004 §3 (R1 فقط؛ R2 غير مبني؛ R3 مؤجَّل إلى H3-01)

## ما بُني

| المكوّن | الدور |
|---|---|
| صلاحية `payments.resolve_blocked` | في `Rbac::PERMISSIONS` فقط (owner/admin عبر `*`)؛ لا تُضاف لـ`MATRIX` ولا لأي دور مخزَّن؛ المحاسب وstaff مرفوضان |
| `PaymentAttemptPostingService::repost(attempt, actor, reason)` | يُعاد تحميل الفاعل من القاعدة (نشط + الصلاحية)، سبب 5–500 حرفاً، المحاولة يجب أن تكون `blocked_period`؛ ثم نفس مسار 02c بـ`$explicit=true` (التاريخ المحاسبي الأصلي) والقرار في **المعاملة نفسها** |
| `payment_attempt_posting_events` + `PaymentAttemptPostingEvent` | سجل قرار **ثابت** (نموذج + مُشغّلات PG/SQLite): الفاعل، السبب، النتيجة (`posted`/`still_blocked`). هجرة إضافية، `down()` يرفض مع صفوف |
| `GET /api/payment-attempts/blocked` · `POST /api/payment-attempts/{id}/repost` | `payments.resolve_blocked`؛ الثاني throttle 20/دقيقة؛ أخطاء `{error:{code,message}}` (403 forbidden · 409 not_blocked/not_postable · 422) |
| سطر جاهزية الإقفال `blocked_payments` | تنبيه (`warning`) بعدد ومبلغ الدفعات المحجوبة داخل السنة؛ **لا يمنع الإقفال ولا يغيّر `can_close`** (اختيار تحفّظي: جعله مانعاً ضابط مالي جديد يحتاج قرار المالك) |

لا قيد جديد ولا حساب جديد: عند النجاح يصدر قيد M1 نفسه (مدين 1170 / دائن 1130 + الطرف) بـ`PaymentService` ← `LedgerService` بالتاريخ الأصلي. ما زالت الفترة مقفلة ⇒ تبقى محجوبة ويُسجَّل القرار `still_blocked`. لا إعادة ترحيل تلقائية (لا مطابِق ولا حدث) حتى بعد فتح الفترة.

## الاختبارات
- `PaymentAttemptRepostTest` (9، sqlite وPG): ترحيل بعد فتح رسمي بالتاريخ الأصلي والقيد المعتمد وحدث القرار؛ بقاء محجوباً مع تسجيل؛ رفض سبب ناقص/غير مخوَّل/غير محجوب/فاعل عُطّل بعد التحميل؛ سجل ثابت (نموذج + قاعدة)؛ الصلاحية owner/admin فقط؛ API (403 للمحاسب وstaff، 409، 422، قائمة بالعدّاد)؛ **عزل المستأجر** (404 والقائمة فارغة)؛ تنبيه الجاهزية مع ثبات `can_close`.
- انحدار: `Rbac|Permission|BranchIsolation|FiscalYear|FiscalClose|CustomRole|PaymentAttempt|InvoicePaymentRequest|Roles` (الفشل الوحيد: Fuel بسبب bcmath المحلي) وPG للتزامن والإقفال.

## حدود معلنة
- لا واجهة ويب لقائمة المحجوب/زر إعادة الترحيل ولا شارة تنبيه في اللوحة بعد (الـAPI والجاهزية جاهزان؛ الواجهة شريحة web لاحقة).
- المحتجَز M6 (مبلغ/عملة مختلفان) بلا مسار حسم بعد.
- التالي: H2-02e (API عام `/pay/v1/*` + إلغاء تلقائي عند إقفال الفاتورة بإشعار دائن).
