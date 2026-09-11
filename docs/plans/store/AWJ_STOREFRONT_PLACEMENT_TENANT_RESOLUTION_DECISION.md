# AWJ Store — Storefront Placement & Tenant Resolution Decision

**الحالة:** قرار معماري قبل COM-7-P0
**التاريخ:** 2026-09-11
**النطاق:** مكان Spree Storefront في المستودع + تحديد Tenant/Store/Channel من النطاق

## 1. القرار التنفيذي

يُدخل Spree Storefront كتطبيق واجهة مستقل داخل مستودع أَوْج، وليس كمسارات جديدة مختلطة داخل تطبيق ERP الإداري الحالي `web`.

**المكان المقترح المعتمد للتنفيذ:**

```text
/storefront
```

بحيث يصبح لدينا حد واضح:

```text
/web         = واجهة أَوْج الإدارية ERP
/storefront  = واجهة متجر العميل المبنية على Spree Storefront
Laravel API  = مصدر الحقيقة والخدمات التجارية
```

لا يعني الاستقلال أن storefront نظام مستقل في البيانات أو المنطق التجاري؛ هو تطبيق عرض/تفاعل يستهلك عقود أَوْج Commerce فقط.

## 2. لماذا لا نضعه داخل `web`

- Spree Storefront مشروع Next.js كامل ببنية وتبعيات واختبارات خاصة به.
- واجهة ERP لها نظام تصميم وكثافة واستخدام مختلفان جذريًا عن واجهة التسوق.
- فصل التطبيق يقلل مخاطر تغييرات الاعتمادات والبناء على ERP الحالي.
- يسهل تتبع أصل Spree وترقياته وترخيصه.
- يسمح بنشر/توسيع storefront مستقبلًا بصورة مستقلة دون فصل مصدر الحقيقة.
- يمنع تحول `web` إلى خليط من تطبيق موظفين وتطبيق مشترين ذوي حدود أمنية مختلفة.

## 3. ما لا يُسمح به

- لا استنساخ Spree Backend/Rails داخل المستودع.
- لا قاعدة بيانات خاصة بالـstorefront.
- لا نسخ Product/Customer/Inventory truth إلى storefront.
- لا اتصال مباشر بقاعدة بيانات أَوْج من Next.js.
- لا تمرير `tenant_id` من المتصفح واعتباره سلطة.
- لا وضع أسرار Laravel أو مفاتيح داخل كود العميل.
- لا جعل `/web` و`/storefront` يشتركان عشوائيًا في state/auth/cookies.

## 4. نموذج المتجر والقناة

الموجود حاليًا في أَوْج هو `SalesChannel` ككيان tenant-owned مستقل، وأنواعه تشمل `web`, `mobile`, `pos`, `external`. كما أن القناة منفصلة عمدًا عن Branch وWarehouse.

هذا مناسب لتمثيل **قناة البيع** لكنه لا يكفي وحده لتمثيل كل إعدادات واجهة متجر مستضافة: النطاق، الهوية البصرية، اللغة الافتراضية، إعدادات SEO، القالب وغيرها.

لذلك لا نحمّل `SalesChannel` حقول storefront عشوائيًا في COM-7-P0.

قبل الحاجة إلى تخزين إعدادات المتجر الفعلية، يُعرّف كيان/إعداد Commerce Storefront tenant-owned مرتبط بقناة Web وفق conventions المستودع بعد فحص التنفيذ. الاسم النهائي للجدول/النموذج لا يُفرض في هذه الوثيقة.

المبدأ:

```text
Tenant
  └─ Storefront configuration
       └─ Web SalesChannel
```

وقد يدعم Tenant أكثر من storefront/channel مستقبلًا دون افتراض متجر واحد دائمًا.

## 5. Tenant/Store resolution — القاعدة الأمنية

طلب واجهة المتجر يبدأ من **hostname/domain** الذي وصل إلى الخادم، لا من `tenant_id` يرسله العميل.

المسار المستهدف:

```text
Incoming hostname
   ↓
Normalize + validate host
   ↓
Resolve active storefront/domain mapping
   ↓
Derive tenant_id + storefront_id + sales_channel_id server-side
   ↓
Establish trusted store context
   ↓
Call AWJ public/customer Commerce API
```

كل API عام أو خاص بالعميل يجب أن يعيد التحقق من هذا السياق في الخادم. Next.js ليس بديلًا عن Tenant Isolation في Laravel.

## 6. النطاقات

يدعم التصميم من البداية حالتين:

### نطاق أَوْج الفرعي

مثال تصوري فقط:

```text
merchant.awj.app
```

يُحل الجزء الخاص بالمتجر عبر mapping مخزّن، لا عبر افتراض أن slug وحده tenant authority.

### نطاق العميل الخاص

مثال:

```text
shop.example.com
```

يجب أن يطابق سجل نطاق موثّق ونشط ومملوك لنفس storefront/tenant.

لا يتم اختيار Tenant من query string أو header عام قابل للتحكم من المتصفح.

## 7. عدم الثقة في Host وحده

لأن `Host` مدخل من الطلب، لا يكفي استخراج tenant منه نصيًا ثم الثقة به. يجب:

- تطبيع hostname وإزالة port حيث يلزم.
- رفض القيم غير الصالحة.
- البحث في mapping server-side.
- اشتراط storefront/domain active.
- اشتراط tenant active وفق عقود أَوْج.
- اشتراط channel active.
- عدم السماح بتعارض domain بين tenants.
- عدم استخدام fallback يؤدي إلى كشف متجر Tenant آخر.
- unknown host → استجابة غير كاشفة، وليس متجرًا افتراضيًا عشوائيًا.

## 8. السياق بين Storefront وLaravel

بعد resolution، يحتاج storefront إلى طريقة server-to-server لطلب بيانات المتجر من Laravel مع سياق موثوق.

العقد الدقيق للتوقيع/المصادقة لا يُحسم هنا قبل فحص أنماط API الحالية، لكن القاعدة ثابتة:

- المتصفح لا يقرر Tenant.
- storefront server لا يستطيع تجاوز Laravel Tenant enforcement.
- Laravel يعيد resolution/validation أو يتحقق من سياق موقّع/موثوق وفق العقد الذي سيعتمد.
- customer authentication يبقى Customer Platform/Sanctum authority في أَوْج ولا نستورد JWT الخاص بـSpree.

## 9. التخزين المؤقت ومنع التسرب

أي cache في storefront يجب أن يدخل في مفتاحه/وسمه على الأقل هوية storefront/tenant والسياق التجاري المؤثر مثل اللغة/القناة عند الحاجة.

ممنوع cache عام لمنتج أو قائمة يمكن أن يعيد بيانات Tenant A إلى Tenant B.

اختبارات cross-tenant cache isolation جزء من بوابة الإطلاق عندما يبدأ التخزين المؤقت الحقيقي.

## 10. اللغات والمسارات

نحتفظ بفكرة Spree للـlocale routing لكن نكيفها مع قرار أَوْج:

- العربية أساسية.
- الإنجليزية مدعومة بالكامل.
- اللغة الافتراضية تأتي من إعداد storefront.
- تبديل اللغة لا يغير tenant/store identity.
- `dir=rtl` للعربية و`dir=ltr` للإنجليزية.

لا نجعل country/market الخاص بـSpree سلطة على tenant أو pricing في أَوْج.

## 11. بيئة التطوير والمعاينة

في التطوير، نحتاج مسارًا آمنًا لاختبار متجر محدد دون DNS حقيقي. يُسمح بآلية development-only صريحة، لكنها:

- لا تعمل في production.
- لا تتحول إلى backdoor لاختيار tenant.
- تكون مغطاة باختبار/guard واضح.

الآلية الدقيقة تحدد في COM-7-P0/P1 بعد فحص بيئة الاختبار الحالية.

## 12. حدود COM-7-P0

أول PR لتأسيس Spree يقتصر على:

- إنشاء `/storefront` من fork Spree المثبت.
- الاحتفاظ بـLICENSE/NOTICE.
- إزالة/تعطيل افتراضات الاتصال بـSpree Backend بقدر ما يلزم لتشغيل baseline آمن، دون بناء AWJ checkout.
- إعداد build/test مستقل.
- إضافة العربية الأساسية/RTL فقط إذا لم توسع PR بصورة غير مناسبة؛ وإلا تكون P2.
- توثيق env boundaries.
- لا migrations خاصة بالسلة/الدفع/الشحن.
- لا تعديل لقواعد CommerceOrder/Reservation/Pricing/Customer Platform.

**مهم:** domain/store mapping production model لا يجب اختراعه داخل P0 إذا كان يحتاج migration. يجهز P0 boundary فقط، ثم تنفذ mapping في PR صغير مستقل قبل public catalog إذا لزم.

## 13. اختبارات إلزامية عند تنفيذ resolution

- domain A → tenant/store/channel A فقط.
- domain B → B فقط.
- unknown domain لا يسقط على Tenant آخر.
- inactive domain/store/channel مرفوض.
- محاولة إرسال tenant_id مخالف لا تغير السياق.
- custom domain لا يستطيع الإشارة إلى storefront من Tenant آخر.
- authenticated CustomerIdentity من Tenant آخر لا يصبح صالحًا بسبب domain مختلف.
- cache keys/tags لا تتقاطع بين tenants.

## 14. أثر القرار على النشر

الفصل إلى `/storefront` يسمح أن تكون واجهة المتجر خدمة/نشرًا مستقلًا مستقبلًا عن ERP web، لكن **لا يوجد قرار Deploy الآن**.

يمكن أن يبقيا في نفس repository ونفس CI مع jobs مستقلة، مع إمكانية نشر كل تطبيق بشكل مستقل عند اعتماد البنية التشغيلية.

## 15. إغلاق بوابة COM-7

بعد هذا القرار، المتبقي قبل بدء COM-7-P0 هو مراجعة نهائية قصيرة لأحدث `main` وتحديد task contract لأول PR. لا نحتاج بحثًا معماريًا جديدًا من الصفر.

أول PR يجب أن يكون تأسيس storefront فقط، وليس Cart/Checkout/Payment.
