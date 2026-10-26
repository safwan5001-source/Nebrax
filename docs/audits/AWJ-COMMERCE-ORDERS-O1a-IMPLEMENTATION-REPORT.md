# AWJ-COMMERCE-ORDERS-O1a — تقرير التنفيذ

**النطاق:** واجهة API قراءة فقط لطلبات المتجر للموظف. لا O1b ولا أي مرحلة لاحقة. لا Merge ولا Deploy.

## 1. ما تم تنفيذه

| البند | التفاصيل |
|---|---|
| `GET commerce/orders` | قائمة مرقّمة (افتراضي 20، حد أقصى 50) مع بحث وفلاتر وفرز بقائمة بيضاء |
| `GET commerce/orders/{id}` | تفاصيل: سطور (مع التخصيص)، جهة اتصال، عنوان الشحن/الفوترة، إهداء، موعد، نية الدفع، محاولات الدفع (أحدث 20)، مرجع الترحيل المحاسبي إن وُجد |
| `CommerceStaffOrderController` | قراءة فقط؛ لا يستدعي أي خدمة كتابة (يحرسه اختبار ساكن) |
| `CommerceOrderStaffSerializer` | منفصل عن `CommerceOrderSerializer` العام (لم يُعدَّل) |
| الصلاحية `commerce.orders.view` | مضافة إلى `Rbac::PERMISSIONS` فقط؛ owner/admin عبر `*`؛ **غير مضافة إلى `MATRIX`** ولا لأي دور مخزَّن |
| `EnsureApplicationActive` | `commerce.storefront` على المسارين مع `$perm(...)` |
| المقيَّد بمخازن | `allowedWarehouseIds() !== null` ⇒ **403** (الطلب `CompanyWide` بلا مخزن؛ لا نطاق رؤية صحيح) |

**الفلاتر:** `q` (رقم الطلب / اسم / هاتف / بريد؛ 2–100 حرف؛ يُهرَّب `% _ \`)، `storefront_id`، `sales_channel_id`، `status`، `payment_status`، `payment_method`، `delivery_method`، `from`/`to` (`Y-m-d`)، `sort` ∈ {`created_at`,`total`,`number`}، `direction`، `page`، `per_page`. أي قيمة/عمود خارج القائمة ⇒ 422.

**ما لا يكشفه:** `tenant_id`، `customer_identity_id`، `commerce_checkout_id`، مفاتيح idempotency، أسرار/حمولات البوابة، التكلفة، بيانات القيد. (`partner_id` يظهر في التفاصيل فقط.)

## 2. الملفات المتغيرة

| الملف | النوع |
|---|---|
| `app/Http/Controllers/Api/CommerceStaffOrderController.php` | جديد |
| `app/Support/CommerceOrderStaffSerializer.php` | جديد |
| `app/Support/Rbac.php` | +الصلاحية في `PERMISSIONS` |
| `routes/api.php` | +مساران (و`use`) |
| `tests/Feature/CommerceStaffOrderApiTest.php` | جديد (13 اختباراً) |
| `tests/Feature/CommerceModuleBoundaryTest.php` | +المساران في قائمة مسارات Commerce المسموحة (حارس قائم) |
| `CLAUDE.md` | فقرة قصيرة |
| هذا التقرير | جديد |

لا migrations، لا تعديل لنماذج، لا تعديل لمسلسل/واجهات الجمهور.

## 3. الاختبارات

**اختبارات O1a (`CommerceStaffOrderApiTest`) — 13 ناجحاً على SQLite و13 على PostgreSQL 16 (محلياً):**
RBAC (owner/admin يسمح؛ accountant/staff/self_service/غير مصادَق يمنع؛ دور مخصص بالصلاحية يسمح وبدونها يمنع؛ الصلاحية مسجَّلة وغير ممنوحة ضمنياً) · تعطيل `commerce.storefront` ⇒ 403 · عزل مستأجرين وIDOR (404 موحَّد، `tenant_id` من العميل مُتجاهَل) · المقيَّد بمخزن ⇒ 403 · بحث/فلاتر/فرز/ترقيم وحدود وقائمة بيضاء (422) · عدم N+1 (عدد الاستعلامات ثابت مع 1 و7 طلبات) · محاولات الدفع لنية الطلب نفسه فقط · عدم تسريب حقول داخلية · **لا آثار جانبية** (لقطة قبل/بعد للطلبات والنوايا والقيود وحركات المخزون والحجوزات) · لا مسارات كتابة (405) وفحص ساكن لعدم استدعاء خدمات الكتابة · المسلسل العام غير متغيّر.

**المجموعة الكاملة (SQLite، محلياً، قبل إصلاح الحارس):** `27 failed, 264 skipped, 9553 passed (83012 assertions)`، 2711 ث.
- **1 فشل كان من تغييري:** `CommerceModuleBoundaryTest › no commerce api route is registered yet` (قائمة مسارات Commerce المعتمدة). أُضيف المساران وأُعيد التشغيل: 3/3 ناجحة.
- **26 فشلاً في اختبارات Fuel** (`FuelAviRfid`، `FuelReconciliation`، `FuelSaleApi`، `FuelSaleService`، `FuelSupplyReceivingApi`، `FuelSupplyReceiving`): سببها امتداد `bcmath` غير محمَّل في هذه البيئة (`bcmath` مثبَّت في CI؛ مذكور في CLAUDE.md وفي تنبيه إعداد الجلسة). لا علاقة لها بهذا التغيير (لم يُلمس Fuel).
- الـ264 المتخطّاة اختبارات تزامن تتطلب PostgreSQL حقيقياً بالمعنى الذي تعلنه الاختبارات.

**لم يُنفَّذ محلياً:** المجموعة الكاملة على PostgreSQL (تُترك لـCI)، واختبارات الواجهة (لا تغيير فيها).

**Build/CI:** يُحدَّث أدناه من فحص GitHub Actions على رأس الفرع بعد دفع التقرير.

## 4. المخاطر والمتبقي

| البند | ملاحظة |
|---|---|
| `commerce.storefront` غير مفعَّلة | مستأجر لم يفعّل القدرة (مستأجر جديد بعد cutover) سيحصل على 403 رغم امتلاكه الصلاحية، وهذا مطلوب بالتعليمات (النمط القائم). مستأجرو ما قبل cutover مفعَّلون تلقائياً. يُراجَع عند O1b إن ظهر أثر على التجربة. |
| المقيَّد بفروع | الطلب `CompanyWide` ولم يُطلب تقييد الفروع؛ مستخدم مقيَّد بفروع فقط (دون مخازن) ومعه الصلاحية يرى كل طلبات المستأجر. لا يُمنح الصلاحية تلقائياً إلا owner/admin (غير مقيَّدين عادةً). يُقرَّر مع F1. |
| بحث `LIKE '%…%'` | مقبول لحجم اليوم؛ فهرسة/FTS قرار لاحق إن لزم (لا migration هنا بالقصد). |
| `payment.status` | حالة النية فقط؛ طلب إلكتروني فاشل/منتهي يبقى `status=confirmed` (كما في التدقيق، يُحسم في O3). |
| COD المحصَّل | يُعرض `accounting.posted=false` لأنه لا ترحيل (D-8). |
| الاختبار في CI | المجموعة الكاملة على SQLite وPostgreSQL تُترك لـCI. |

## 5. Git

- **Branch:** `claude/commerce-orders-o1a`
- **Base SHA:** `2f4de9c01ba5f1a7e5280c741aa7c4628114da2b` (`main`)
- **Head SHA:** يُذكر في وصف الـPR (يتغيّر بدفع هذا التقرير).

## 6. الخطوة التالية — O1b

واجهة `/commerce/orders` (قائمة + فلاتر + تفاصيل) وعنصر تنقل بالصلاحية `commerce.orders.view`، RTL/جوال، حالات تحميل/فراغ/خطأ، ومؤشرات اللوحة. PR مستقل يستهلك هذا الـAPI دون تعديله. قرارات مطلوبة قبله: موضع عنصر التنقل وتفعيل `commerce.storefront` للتجارب الجديدة.
