# AWJ-COMMERCE-ORDERS-O1a-N1-TEST-FIX — تقرير التنفيذ

**الطبيعة:** إصلاح تذبذب اختبار فقط. **لا** كود إنتاج، **لا** هجرة، **لا** تغيير سلوك. الملف الوحيد المتغيّر ملف اختبار.

## 1. المشكلة والسبب المثبت

`CommerceStaffOrderApiTest::the_list_does_not_n_plus_one` كان يفشل أحياناً في CI (PostgreSQL) بـ«18 مقابل 17».

**السبب (مُسجَّل لا مُفترَض):** سُجّلت الاستعلامات في تشغيلتين (17 و18) وقورنت بالمجموعات: الفارق الوحيد هو
`update "personal_access_tokens" set "last_used_at" = ?, "updated_at" = ? where "id" = ?` — يُنفّذه Sanctum حين يتجاوز آخر استخدام للرمز نافذته الزمنية، فيقع أحياناً في أحد القياسين فقط. لا علاقة له بعدد الطلبات؛ بقية الاستعلامات متطابقة.

## 2. الإصلاح (`tests/Feature/CommerceStaffOrderApiTest.php`)

- ثابت `SANCTUM_TOKEN_TOUCH`: **مطابقة تامة** لهذا الاستعلام بعينه (regex مثبَّت بـ`^…$`). لا يُستثنى أي استعلام آخر، **ولا تسامح عددي** (المقارنة تبقى `assertSame`).
- مساعدات خاصة: `listRequestQueries()` (الخام) و`listQueryCount()` (بعد استثناء تحديث Sanctum وحده) و`listQueryCountsForOneThenSevenOrders()` (تسخين ثم طلب واحد ثم سبعة).
- `the_list_does_not_n_plus_one` يستعملها: نفس الغرض والمقارنة.

## 3. الإثباتات (اختبارات جديدة + طفرات)

| الاختبار / الطفرة | يثبت |
|---|---|
| `the_sanctum_last_used_touch_is_the_only_query_excluded_from_the_count` (جديد) | رمز بآخر استخدام قديم ⇒ استعلام Sanctum يقع **مرة واحدة** في القياس الخام، والعدّ المرشَّح = الخام − 1 بالضبط ⇒ **لا شيء آخر يُتجاهل**. |
| `a_synthetic_n_plus_one_makes_the_count_grow_with_the_number_of_orders` (جديد) | N+1 اصطناعي (مستمع `eloquent.retrieved` ينفّذ استعلاماً لكل طلب مُحمَّل) ⇒ العدّ ينمو (`≥ one + 6`) رغم الاستثناء، أي أن المقارنة ستفشل. |
| طفرة إنتاج مؤقتة: استعلام لكل طلب داخل `CommerceOrderStaffSerializer::summary` (استُرجعت) | `the_list_does_not_n_plus_one` **يفشل** على SQLite وPostgreSQL: `Failed asserting that 24 is identical to 18`. |
| طفرة: إلغاء الاستثناء من `listQueryCount` (استُرجعت) | اختبار الإثبات الأول يفشل (`13` مقابل `12`). |

## 4. النتائج

- محلياً، `CommerceStaffOrderApiTest` (15 اختباراً): SQLite ✅ ×2 · PostgreSQL ✅ ×3 (متتاليات).
- CI: انظر وصف الـPR (يُحدَّث بعد التشغيل).

## 5. الملفات

| الملف | |
|---|---|
| `tests/Feature/CommerceStaffOrderApiTest.php` | معدَّل (اختبار فقط) |
| `docs/audits/AWJ-COMMERCE-ORDERS-O1a-N1-TEST-FIX-REPORT.md` | هذا التقرير |

لا `app/` ولا `database/` ولا `routes/`.

## 6. Git

- **Branch:** `claude/commerce-orders-o1a-n1-test-fix`
- **Base SHA:** `43f86fd430c665152bd34a1082d39ec887b4af9d` (`main`)
- **Head SHA:** في وصف الـPR (يلي commit هذا التقرير).

## 7. ملاحظة

نمط اختبار O3a-1 (`CommerceOrderCancellationFactsTest::cancelled_rows_do_not_add_queries_to_the_list`) يستثني الاستعلام نفسه في PR #1774؛ عند دمج الاثنين يمكن لاحقاً توحيد المساعد، وهذا خارج نطاق هذا الإصلاح.
