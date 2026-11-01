# AWJ ERP — Treasury Activation Readiness (`TREASURY_CASH_SALE_ROUTING_ENABLED`)

| | |
|---|---|
| الوضع | قراءة فقط. Beta: كل المستأجرين والبيانات تجريبية. لا تفعيل، لا تعديل بيانات، لا نشر |
| Base / Head | `main` @ `c43559f68e1f561a80193e06b93e01e1156a8995` (لا تغييرات كود في هذا الفرع، ملف التقرير فقط) |
| التاريخ | 2026-11-01 |

## القرار: 🟡 BLOCKED — دليل البيانات ناقص، لا عائق في الكود

| الطبقة | الحكم |
|---|---|
| الكود (T4+T5+T6 على `main`) | **READY** |
| CI على HEAD | **PostgreSQL ✅ نجح كاملاً.** SQLite وقت آخر فحص: قيد التشغيل (انظر §2) |
| فحوص C1–C4 على قاعدة Beta | **NOT EXECUTED** — لا اتصال قراءة مصرَّح به (§3) |

لتحويله إلى READY: تشغيل استعلامات §3 على Beta (أنت أو بتصريح اتصال قراءة فقط) وأن يُغلق CI SQLite أخضر.

## 1. ما تأكّد من الكود (لا إعادة تدقيق)

- البوابة `config('treasury.cash_sale_routing_enabled')` مغلقة افتراضياً، والسياسة الافتراضية لكل مستأجر `legacy`. **قلب العلم وحده لا يغيّر أي ترحيل.** التفعيل الفعلي = العلم + `tenants.settings.sales.cash_sale_treasury_policy = main` لكل مستأجر (`PUT /sales-settings`، صلاحية `company.manage`، لا ضبط جماعي).
- قرار السياسة: `main` (وليس `explicit_required` الذي يرفض أي بيع نقدي بلا خزينة صريحة).
- الفرع الموجَّه يحلّ الخزينة قبل القيد، وأي رفض = 422 وتراجع كامل (لا قيد، لا ICV، لا مدخل سلسلة). لا سقوط إلى 1110 (`?? 1110` في الفرع `legacy` فقط).
- عزل المستأجر: معرّف مستأجر آخر لا يُحلّ (T6 يختبر خزينة/جلسة/قيد مصدر لمستأجر آخر). الصلاحيات: `withdraw` على الخزينة المحلولة للردود، `deposit` للبيع، لا صلاحيات جديدة.
- كيان 1110 موجود لكل مستأجر (backfill بالهجرة 000070 + تهيئة التسجيل). المبيعات القديمة تُردّ إلى 1110 لأن الخزينة تُشتق من قيد البيع.
- اختبارات الخزينة محلياً (SQLite): **141 نجح، 16 متخطّى** (PostgreSQL المتزامن).

## 2. CI على HEAD `c43559f` (run 10988)

| المهمة | الحالة (15:35 UTC) |
|---|---|
| `php artisan test (L11, pgsql)` | ✅ **success** (15:16–15:34) |
| `php artisan test (L11, sqlite)` | ⏳ in_progress (خطوة «تشغيل الاختبارات» منذ 15:17:53؛ التشغيل السابق على `e2574bf` ✅ success استغرق ~24 دقيقة) |

> يُحدَّث السطر الثاني في وصف الـPR عند الاكتمال. تغيير HEAD الأخير Fuel فقط ولا يمس الخزينة.

## 3. فحوص قاعدة Beta

**لم تُنفَّذ.** الجلسة بلا أي متغير اتصال (`DB_*`/`DATABASE_URL`/`PG*`) ولا `.pgpass`؛ `psql` موجود بلا وجهة. لم أقرأ متغيرات Railway ولم أستخرج أسراراً أو أغيّر إعداداً. لا نجاح مفترض.

| الفحص | العدد | الحالة |
|---|---|---|
| C1 رئيسية نقدية مفقودة / معطَّلة / غير 1110 | — | NOT EXECUTED |
| C2 مسودات فواتير نقدية بـ`cash_account_id` | — | NOT EXECUTED |
| C3 جلسات POS مفتوحة بلا خزينة مثبَّتة | — | NOT EXECUTED |
| C4 طرق دفع نقدية مرتبطة بغير 1110 | — | NOT EXECUTED |

استعلامات قراءة فقط (PostgreSQL؛ شغّلها داخل `BEGIN READ ONLY;`):

```sql
-- C1: رئيسية نقدية مفقودة / معطَّلة / غير 1110
SELECT t.id AS tenant_id, t.name,
       CASE WHEN cb.id IS NULL THEN 'no_main'
            WHEN cb.is_active = false THEN 'main_inactive'
            WHEN a.code <> '1110' THEN 'main_not_1110' END AS issue
FROM tenants t
LEFT JOIN cash_bank_accounts cb ON cb.tenant_id = t.id AND cb.type = 'cash' AND cb.is_main = true
LEFT JOIN accounts a ON a.id = cb.account_id
WHERE cb.id IS NULL OR cb.is_active = false OR a.code <> '1110';

-- C1b: مستأجر بلا كيان لحساب 1110 (متوقع 0)
SELECT a.tenant_id FROM accounts a
LEFT JOIN cash_bank_accounts cb ON cb.account_id = a.id
WHERE a.code = '1110' AND cb.id IS NULL;

-- C2: مسودات نقدية تحمل cash_account_id (تصبح فعّالة بعد التفعيل)
SELECT i.tenant_id, count(*) AS drafts, count(*) FILTER (WHERE acc.id IS NULL) AS dangling_account
FROM invoices i
LEFT JOIN accounts acc ON acc.id = i.cash_account_id AND acc.tenant_id = i.tenant_id
WHERE i.status = 'draft' AND i.payment_type = 'cash' AND i.cash_account_id IS NOT NULL
GROUP BY i.tenant_id;

-- C3: جلسات POS مفتوحة بلا خزينة (الردّ النقدي يُرفض session_treasury_required)
SELECT tenant_id, count(*) FROM pos_sessions
WHERE status = 'open' AND cash_account_id IS NULL GROUP BY tenant_id;

-- C4: طرق نقدية مرتبطة بغير 1110
SELECT pm.tenant_id, pm.id, pm.name, a.code AS linked_gl_code
FROM payment_methods pm
JOIN cash_bank_accounts cb ON cb.id = pm.cash_bank_account_id
JOIN accounts a ON a.id = cb.account_id
WHERE pm.settlement_type = 'cash' AND a.code <> '1110';
```

**تفسير النتائج في Beta:** أي نتيجة غير صفرية ليست فساد دفتر. C1 وC3 تعني رفضاً مغلقاً (422) لذلك المستأجر/الجلسة حتى يُضبط (رئيسية، أو إغلاق الجلسة وإعادة فتحها). C2 تعني مسودة قد تُرفض عند ترحيلها. C4 تعني فقط انتقال ردّ POS النقدي من 1110 إلى خزينة الجلسة (المقصود).

## 4. عوائق حقيقية مقابل تحسينات مؤجَّلة

**عوائق حقيقية (للتفعيل):**

| # | العائق | الحالة |
|---|---|---|
| 1 | نتائج C1–C4 من Beta | مفتوح — يحتاج اتصال قراءة |
| 2 | اكتمال CI SQLite على HEAD | قيد التشغيل |

لا عائق في الكود أو العزل أو الصلاحيات أو القيود.

**تغييرات سلوكية مقصودة عند `main` (قرار، ليست عوائق):**
- إشعار دائن/مرتجع نقدي مستقل، أو لفاتورة آجلة/POS-مدفوعة ⇒ يُرفض `refund_source_required` (البديل: إشعار `credit` + سند صرف).
- ردّ POS النقدي من خزينة الجلسة؛ يُرفض عند اختلاف خزينة التحصيل (`refund_treasury_mismatch`) أو جلسة بلا خزينة.

**مؤجَّل (لا يمنع التفعيل):**
- مخارج 1110 المرمَّزة في الأصول والرواتب والمصروفات ومرتجعات/إشعارات المشتريات (T5b): في مستأجر رئيسيته ≠ 1110 تخرج من 1110 لا من الرئيسية. تقارير نقدية غير متجانسة، لا فساد دفتر.
- ردود نقدية عبر خزائن مختلفة (مرفوضة عمداً).
- معاينة رفض الخزينة في `quote` POS (UX).

## 5. خطة التفعيل (تنتظر موافقتك — لم تُنفَّذ)

1. إغلاق CI أخضر + نتائج C1–C4، وإصلاح الحالات غير الصفرية (ضبط رئيسية / إغلاق جلسات).
2. `TREASURY_CASH_SALE_ROUTING_ENABLED=true` على خدمة الـbackend (بلا أثر وحده).
3. `main` لمستأجر تجريبي واحد، اختبار: بيع نقدي ← مرتجع ← إشعار دائن ← POS (بيع/مرتجع/استبدال)، ومطابقة ميزان المراجعة وأرصدة الخزينة.
4. تعميم `main` على بقية مستأجري Beta.

## 6. خطة التراجع

- مستأجر: `PUT /sales-settings` ← `legacy` (فوري).
- شامل: `TREASURY_CASH_SALE_ROUTING_ENABLED=false` (يعيد كل المستأجرين إلى `legacy` مهما خُزِّن).
- القيود المرحَّلة لا تُعاد كتابتها. بيع حُصِّل في غير 1110 أثناء التفعيل لا يُردّ نقداً بعد التراجع (`CashSaleRefundGuard`) بل عبر إشعار `credit` + سند صرف. مقبول في Beta.
