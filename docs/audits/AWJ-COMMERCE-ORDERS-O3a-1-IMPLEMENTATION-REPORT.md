# AWJ-COMMERCE-ORDERS-O3a-1 — تقرير التنفيذ

**المرجع:** `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md`.
**الطبيعة:** أساس **بيانات وقراءة** فقط لإلغاء الطلب: أعمدة حقائق الإلغاء + حراس قاعدة البيانات + دورة حياة مشتقّة في قراءة الموظف. **لا** مسار إلغاء، **لا** تغيير في حالة الدفع/المحاولات، **لا** تحرير حجز، **لا** سند/قيد/فاتورة، **لا** مَسّ للمسلسلات العامة للمشتري (O3c)، **لا** Merge/Deploy.

## 1. ما نُفِّذ

| البند | التنفيذ |
|---|---|
| هجرة إضافية على `commerce_orders` | `cancelled_at` · `cancelled_by_user_id` · `cancellation_reason` · `cancellation_note` + فهرس (ADR-28). كلها nullable؛ **لا backfill** ولا مَسّ لأي صف قائم. عمود `status` وقيد enum **لم يتغيّرا**. |
| حراس قاعدة البيانات (PostgreSQL + SQLite) | (1) لا إلغاء لمسودة؛ (2) حقائق الإلغاء **ثابتة** بعد تسجيلها ولا تُمحى؛ (3) سبب معتمد من القائمة إلزامي ولا تفاصيل بلا إلغاء؛ (4) لا إدراج صفّ مُلغى مباشرةً؛ (5) لا حذف لطلب مُلغى؛ (6) التجميد التاريخي للطلب المؤكد باقٍ كما هو. `down()` **يرفض** متى وُجد طلب مُلغى. |
| الدورة المشتقّة | `CommerceOrder::lifecycleStatus()` ∈ `draft` · `confirmed` · `cancelled` مشتقّة من `status` وحقائق الإلغاء؛ `isConfirmed()` **لم يتغيّر** (تبقى حراس التجميد سليمة للمُلغى). |
| قراءة الموظف (O1a) | القائمة: `lifecycle_status` و`cancellation{cancelled,at,reason}`؛ التفاصيل: كتلة `cancellation` كاملة (`by{id,name}` + `note`). فلتر `lifecycle_status` (قائمة بيضاء). |
| العقد العام | **بلا تغيير** (`CommerceOrderSerializer` وواجهات المشتري). يحرسه اختبار. |

## 2. الملفات

| الملف | |
|---|---|
| `database/migrations/2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php` | جديد |
| `app/Models/CommerceOrder.php` | ثوابت + `cancelledBy()` + `isCancelled()` + `lifecycleStatus()`؛ الحقائق خارج `$fillable` |
| `app/Support/CommerceOrderStaffSerializer.php` | الحقول الجديدة |
| `app/Http/Controllers/Api/CommerceStaffOrderController.php` | فلتر `lifecycle_status` + eager-load `cancelledBy` |
| `tests/Feature/CommerceOrderCancellationFactsTest.php` | جديد — 22 اختباراً |

لا `web/`، لا مسار POST، لا Rbac، لا `CLAUDE.md`.

## 3. الاختبارات والنتائج

**الجديدة (22):** الهجرة على المحرّكين (الأعمدة/الفهرس) · كل حارس بحالتي القبول والرفض · ثبات الحقائق وعدم المحو · حذف المُلغى · عدم تأثير الإلغاء المخزَّن على تجميد التاريخي · الاشتقاق والفلتر وعزل المستأجر والصلاحيات (403 للمقيَّد بمخازن) · رفض `down()` ثم دورة down→up عند غياب المُلغى · المسلسل العام بلا تغيير · لا مسار إلغاء ولا أثر جانبي (حجز/قيد/نية/محاولات).

**التشغيل المحلي (مشروع Laravel مولَّد، نسخة معزولة):**

| التشغيلة | النتيجة |
|---|---|
| SQLite — الحزمة كاملة | 9568 ناجحاً · 265 تخطّياً · 33 فاشلاً (انظر أدناه) |
| PostgreSQL — الحزمة كاملة | 3462 ناجحاً · 2 تخطّي · 2 فاشلان (انظر أدناه) |
| بعد الإصلاح: SQLite — `Communication*` الثلاثة + اختبارات O3a-1 + staff orders | 93 ناجحاً · 4 تخطّي · 0 فاشل |
| بعد الإصلاح: PostgreSQL — `Communication*` الثلاثة + اختبارات O3a-1 | 84 ناجحاً · 0 فاشل (مرتين متتاليتين) |

**الفشل الذي كشفته التشغيلة الكاملة وأُصلح (انحدار حقيقي من هذه الشريحة):** `CommunicationMigrationSafetyTest` و`CommunicationIdentityProtectionTest` و`CommunicationFingerprintMigrationTest` (4 اختبارات SQLite) تعدّ مُشغّلات SQLite بـ`LIKE 'comm_%'` — والشرطة السفلية رمز مطابقة، فالتقطت `commerce_orders_cancel_*`. **الإصلاح:** إعادة تسمية مُشغّلات SQLite إلى `cmo_cancel_*` (في الهجرة فقط؛ لا تعديل لاختبارات غيرنا). ثبتت الاختبارات الثلاثة بعده على المحرّكين.

**فشل متبقٍ ليس من هذه الشريحة:**
- 29 اختباراً من `Fuel*` على SQLite: `Call to undefined function bcmul()` — امتداد `bcmath` غير مثبّت محلياً (يحمّله CI).
- PostgreSQL: `PaymentAttemptPostingPostgresTest` (تزامن عابر، نجح عند الإعادة)، و`StorefrontMediaApiTest › the library lists newest first…` (`PDOException HY093` في `cursorPaginate` بمسار الوسائط — لا صلة له بـ`commerce_orders`؛ يُتحقَّق من أنه يفشل على `main` أيضاً في CI).

**CI على Head `d56c533` (تشغيلة `40384928809`):** SQLite ✅ · PostgreSQL ✅ · `CI Gate` ✅.

**CI على Head `8d9139a` (تشغيلة `40392156994`، تغيير توثيقي فقط):** SQLite ✅ · PostgreSQL ❌ · `CI Gate` ❌ — فشل اختبار واحد من اختباراتنا: `cancelled_rows_do_not_add_queries_to_the_list` (17 مقابل 18 استعلاماً). الكود الإنتاجي مطابق بين التشغيلتين فالفشل **تذبذب في الاختبار** نفسه (استعلام عابر في أول قياس بعد إنشاء الطلبات، لا استعلام لكل صف مُلغى). **أُصلح الاختبار** بقياس حجمين مختلفين من الصفوف المُلغاة بعد تسخين كافٍ (يبقى كاشفاً لأي استعلام لكل صف)؛ ثبت 3 مرات متتالية على PostgreSQL ومرة على SQLite. لا تغيير في كود الإنتاج. فشلا PostgreSQL المحليان الآخران (`PaymentAttemptPostingPostgresTest`، `StorefrontMediaApiTest`) وفشل `Fuel*` (bcmath) **خاصّة بالبيئة المحلية** ولم تظهر في CI.

**مراجعة تسمية الهجرة وترتيبها:** `2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php` — تتبع آخر هجرة على `main` (`2026_12_12_010000_add_visual_to_payment_methods`) بزيادة يومٍ واحد وبلاحقة `_010000` المعتمدة في المستودع، فلا تُرتَّب قبل أي هجرة مدموجة، ولا تتصادم مع اسم قائم. تسمية الصنف تصف الفعل (`add_… _to_commerce_orders`) كبقية الهجرات الإضافية. قيد: بحث الكود في GitHub يفهرس الفرع الافتراضي فقط، فلم يُستبعد تصادم نظري مع هجرة بتاريخ `2026_12_13` في فرع مفتوح آخر؛ أقرب PR مفتوح للتحقق هو #1774 نفسه (يُعاد الفحص عند الدمج).

## 4. المخاطر والمتبقي

| البند | ملاحظة |
|---|---|
| الأعمدة بلا كاتب بعد | لا مسار يملأ حقائق الإلغاء إلا O3a-2b؛ القراءة تُظهر `confirmed`/`draft` فقط حتى ذلك الحين. |
| تصادم أسماء المُشغّلات | اكتُشف عبر `LIKE 'comm_%'`؛ سُمّيت مُشغّلات SQLite `cmo_cancel_*`. أي مُشغّل جديد في الشرائح التالية يجب ألا يبدأ بـ`comm` متبوعاً بأي حرف. |
| رفض `down()` | مقصود: لا فقدان لحقائق إلغاء؛ التراجع بعد أول إلغاء إصلاحٌ إلى الأمام. |
| فهرس الإلغاء | يخدم فلتر `lifecycle_status=cancelled`؛ لا أثر على مسارات الكتابة القائمة. |

## 5. Git

- **Branch:** `claude/commerce-orders-o3a-1`
- **Base SHA:** `a9ba9bd58c7ecb2e9a6464c5714cdf36fbbf5aa6` (`main` بعد ADR-28)
- **Head SHA (قبل تحديث التقرير):** `d56c53314930fc1f216748df5b0280bd4b2c0c50` — CI أخضر. الـHead النهائي بعد commit هذا التحديث مذكور في الـPR.

## 6. المرحلة التالية

**O3a-2a** (فصل انتقال نية الدفع عن التنظيف، PR مستقل) ثم **O3a-2b** (`CommerceOrderLifecycleService::cancel` + المسار + الصلاحية) الذي يكتب هذه الحقائق. **O3c** يعرّض الحالة في الواجهات العامة للمشتري. لا شيء منها هنا.
