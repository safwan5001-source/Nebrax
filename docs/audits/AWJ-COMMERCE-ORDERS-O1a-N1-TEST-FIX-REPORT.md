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

## 3.1 مراجعة Codex P2 — اعتماد الاختبار على توقيت الساعة

**الملاحظة:** إجبار الاختبار لتحديث Sanctum كان يُرجع `last_used_at` وحده؛ فإن وقع القياس في الثانية نفسها التي حُفظ فيها `updated_at` فلا يصير `updated_at` «متغيّراً» عند Eloquent، فينحصر التحديث في عمود واحد ولا يطابق `SANCTUM_TOKEN_TOUCH` (الذي يشترط العمودين)، فيتذبذب `assertCount(1, …)`.

**المعالجة (اختبار فقط، دون المساس بالـregex ولا بالإنتاج):**
- مساعد `backdateTokenTimestamps()` يُرجع **`last_used_at` و`updated_at` معاً** يوماً إلى الخلف (نسبةً إلى `now()`) قبل **كل** قياس داخل `listRequestQueries()`؛ فيصير التحديث دائماً بالصيغة الكاملة نفسها أياً كان توقيت التنفيذ، ويدخل كل قياس تحديثاً واحداً متطابقاً (التسخين والقياسان)، ولم تعد اختبارات الإثبات تتولى الإرجاع بنفسها.
- اختبار جديد `the_count_is_independent_of_the_wall_clock_even_when_everything_happens_in_the_same_second`: ساعة **مجمَّدة** (`Carbon::setTestNow`) مع `updated_at = now()` ⇒ التحديث يبقى بالصيغة الكاملة نفسها (`assertCount(1, …)`) ويبقى العدّ مستقراً بين الطلب الواحد والسبعة؛ تُستعاد الساعة في `finally`.
- **لم يُوسَّع الـregex ولا أُضيف تسامح عددي**؛ ما زال الاستثناء مطابقة تامة لاستعلام Sanctum بعمودين و`assertSame` باقٍ.

**الأدلة:** `CommerceStaffOrderApiTest` (16 اختباراً) — SQLite ✅ ×3 · PostgreSQL ✅ ×3. طفرة إنتاج مؤقتة (استعلام لكل طلب في المسلسل) تُفشل `the_list_does_not_n_plus_one` والاختبار المجمَّد ✅ (3 إخفاقات) ثم استُرجعت. **ملاحظة صراحة:** لم أستطع إعادة إنتاج التحديث بعمود واحد على إصدار Laravel/Sanctum هنا حتى بساعة مجمَّدة (سُجّلت الاستعلامات: تحديث بالعمودين دائماً)؛ فالإصلاح تحصينٌ حتمي بالبناء لا مصحِّحٌ لفشل شوهد.

## 4. النتائج

- محلياً، `CommerceStaffOrderApiTest` (15 اختباراً): SQLite ✅ ×2 · PostgreSQL ✅ ×3 (متتاليات).
- CI على Head `d44a67c`: `php artisan test (L11, sqlite)` ✅ · `php artisan test (L11, pgsql)` ✅ · `CI Gate` ✅.

## 5. الملفات

| الملف | |
|---|---|
| `tests/Feature/CommerceStaffOrderApiTest.php` | معدَّل (اختبار فقط) |
| `docs/audits/AWJ-COMMERCE-ORDERS-O1a-N1-TEST-FIX-REPORT.md` | هذا التقرير |

لا `app/` ولا `database/` ولا `routes/`.

## 6. Git

- **Branch:** `claude/commerce-orders-o1a-n1-test-fix`
- **Base SHA:** `43f86fd430c665152bd34a1082d39ec887b4af9d` (`main`)
- **Head SHA (الكود والاختبارات):** `d44a67ce32098cd085ff7fd5b01f021d0fd77ff0` — CI أخضر. ما بعده commit لتحديث هذا التقرير فقط.

## 7. ملاحظة

نمط اختبار O3a-1 (`CommerceOrderCancellationFactsTest::cancelled_rows_do_not_add_queries_to_the_list`) يستثني الاستعلام نفسه في PR #1774؛ عند دمج الاثنين يمكن لاحقاً توحيد المساعد، وهذا خارج نطاق هذا الإصلاح.
