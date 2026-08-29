# Audit inventory — Technical data leakage (Gap Matrix)

مسح الواجهة قبل التعديل (مرحلة 1). Phase 5 migration الشاملة **خارج نطاق هذا الـPR**.

| شاشة / موضع | نوع التسريب | مناسب للمستخدم النهائي؟ | يحتاج human label؟ | ينقل لـ Technical Details؟ | مكوّن موحّد؟ | فئة |
|---|---|---|---|---|---|---|
| `/pos/audit` — تفاصيل الحدث: before/after كـ`<pre>JSON` | JSON خام | لا | نعم (diff) | نعم | `TechnicalDetails` | **A — حُوّل الآن** |
| `/pos/audit` — تفاصيل الحدث: id/cart_id/correlation_id/payload | UUIDs + payload | لا كطبقة أولى | جزئياً | نعم | `TechnicalDetails` | **A — حُوّل الآن** |
| `/pos/audit` — قواعد الكشف: `rule_key · vN` | snake_case + version token | لا | نعم | المفتاح في «ضبط متقدّم» | labels + details | **A — حُوّل الآن** |
| `/pos/audit` — بطاقات السلال: `cart_id` UUID | UUID | لا | لا | نعم (في timeline) | details | **A — حُوّل الآن** |
| Exception detail — `<pre>JSON` تقني | JSON خام | لا كطبقة أولى | لا (الملخص موجود) | نعم | `TechnicalDetails` | **A — حُوّل الآن** |
| `/fuel-stations/devices` — محرر payload محاكاة | JSON محرَّر | شاشة محاكاة تقنية | لا | تبقى كما هي | — | **B — تقنية أصلاً** |
| Document diagnostics — `schema_version` / IDs | أكواد تشغيلية | جزئياً (تشغيل وثائق) | لاحقاً | لاحقاً | لاحقاً | **C — follow-up** |
| Approvals tab — `operation` / `status` خام | أكواد داخلية | لا بالكامل | نعم | اختياري | labels | **C — follow-up** |
| Reason codes — `reason.code` تحت الاسم | كود تشغيلي قصير | مقبول كمُعرّف سبب | لا | لا | — | مقبول |
| Platform integrations — حقول endpoint/host | إعدادات تقنية | مدراء منصة | لا | لا | — | **B** |
| `JSON.stringify` في api/auth/storage/tests | ليس UI | نعم | لا | لا | — | خارج النطاق |

## ما حُوّل الآن (A)

- مكوّن `TechnicalDetails` الموحّد
- تسميات قواعد الكشف البشرية + «الإصدار N» + المفتاح داخل ضبط متقدّم
- ملخص حدث بشري + قسم «ما الذي تغيّر؟» + before/after مطوي + تفاصيل تقنية

## ما بقي (B/C)

- Phase 5 migration لشاشات غير POS Audit مؤجّل صراحةً حسب نطاق المهمة
- تسميات اعتمادات العمليات وحالاتها
- تشخيصات مركز الوثائق
