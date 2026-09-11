# AWJ × Spree Admin/Sandbox — Capability Gap Map

**الحالة:** مراجعة مرجعية قبل COM-7 — لا تفوض تنفيذًا أو دمجًا أو نشرًا
**التاريخ:** 2026-09-11
**النطاق:** مقارنة قدرات Spree Admin/Sandbox مع AWJ ERP وCommerce Workspace

## 1. الهدف

Spree Admin ليس لوحة إدارة ثانية نعتمدها داخل أَوْج. نستخدمه كمرجع تجارة إلكترونية ناضج لاستخراج الوظائف وتجارب الإدارة التي نحتاجها، ثم نقرر لكل قدرة: هل هي موجودة في أَوْج ونربط إليها، أم خاصة بالمتجر، أم ناقصة وتحتاج تطويرًا، أم مؤجلة.

المبدأ المعتمد:

> لا نكرر وظيفة موجودة في أَوْج داخل مساحة المتجر؛ نربط إليها بسياق واضح، ثم نعيد المستخدم إلى المتجر بسهولة.

## 2. التصنيف

- **AWJ-LINK** — موجودة في أَوْج؛ تعرض مساحة المتجر ملخصًا/اختصارًا وتفتح الوحدة الأصلية بسياق رجوع.
- **COMMERCE** — قدرة خاصة بالتجارة الإلكترونية ويجب أن تكون ضمن Commerce Workspace/Commerce Core.
- **BORROW-UX** — نقتبس تنظيم Spree وتجربته فقط ولا ننسخ مصدر الحقيقة.
- **GAP-V1** — فجوة حقيقية تحتاج تنفيذًا ضمن مسار الإصدار الأول.
- **LATER** — مفيدة لكن ليست شرطًا لأول إطلاق.

## 3. الخريطة

| قدرة Spree Admin | قرار أَوْج | التصنيف | ملاحظة التنفيذ |
|---|---|---|---|
| لوحة المؤشرات والمقاييس | لوحة متجر خاصة مع بيانات أَوْج | COMMERCE / BORROW-UX | مبيعات المتجر، الطلبات، التنبيهات، المخزون المنخفض، أداء القناة؛ لا لوحة ERP ثانية |
| المنتجات | استخدام منتجات أَوْج | AWJ-LINK | إضافة/تعديل المنتج في الوحدة الأصلية مع عودة إلى المتجر |
| الصور والوسائط | استخدام ProductMedia الموجود | AWJ-LINK | المتجر يستهلك الصور المسموح نشرها |
| التصنيفات الأساسية | إعادة استخدام قدرات أَوْج حيث تصلح + طبقة عرض متجر | AWJ-LINK / COMMERCE | Commerce Listing يفصل عرض المتجر عن Product truth |
| المتغيرات/الخيارات | غير شرط للإطلاق الأول | LATER | لا نستورد نموذج Spree Variant إلى أَوْج الآن |
| المخزون والمواقع | أَوْج مصدر الحقيقة | AWJ-LINK | ATS/Reservation هما عقد Commerce؛ لا Spree inventory truth |
| الأسعار | أَوْج مصدر الحقيقة | AWJ-LINK / COMMERCE | Price Resolution في Commerce؛ لا حساب أسعار في الواجهة |
| العروض والقسائم | قدرة تجارة إلكترونية مطلوبة لكن المحرك العام ليس شرطًا أوليًا | LATER / GAP-V1 عند الحاجة | لا نبني rules engine عام قبل متطلب إطلاق واضح |
| الطلبات | CommerceOrder في أَوْج | COMMERCE | مساحة المتجر تدير رحلة الطلب؛ Invoice يبقى كيانًا منفصلًا |
| إنشاء طلب نيابة عن عميل | ليس شرطًا لأول إطلاق | LATER | يمكن تقييمه لخدمة العملاء لاحقًا |
| العملاء | Customer Platform + Partner في أَوْج | AWJ-LINK | لا قاعدة عملاء ثانية للمتجر |
| سجل طلبات العميل | واجهة متجر فوق CommerceOrder | COMMERCE | Spree UI مرجع قوي للعرض |
| دفتر عناوين العميل | غير موجود كقدرة محفوظة كاملة | GAP-V1 | COM-6C أنشأ snapshot تاريخيًا فقط؛ يحتاج Address Book مستقلًا قبل تجربة حساب كاملة |
| السلة | غير منفذة بعد في أَوْج | GAP-V1 | COM-7-P3؛ سلطة السلة في أَوْج لا Spree |
| إتمام الشراء | غير منفذ بعد | GAP-V1 | COM-7-P4؛ Spree UX مرجع، دورة حالات أَوْج هي السلطة |
| الشحن/طرق الشحن | لا يوجد نموذج تجارة إلكترونية مكتمل | GAP-V1 | يحتاج Shipping/Fulfillment model حقيقي؛ DeliveryNote ليس Shipment |
| مواقع الاستلام | يمكن البناء فوق Warehouse/Location/Channel policy | GAP-V1 | يلزم عقد تجارة إلكترونية واضح دون مساواة Warehouse بالمتجر |
| الشحنات والتتبع | غير مكتملة ككيان تجارة إلكترونية | GAP-V1 | Fulfillment/Shipment + tracking/statuses |
| المرتجعات | لدى أَوْج حركات/مستندات مالية ومخزنية، لكن رحلة متجر موحدة تحتاج ربطًا | COMMERCE / GAP-V1 لاحقًا | لا ننسخ Spree Return كسلطة؛ نربط بالمسارات المعتمدة في أَوْج |
| الاستردادات | أَوْج المالي هو السلطة؛ Commerce يحتاج orchestration | COMMERCE / GAP-V1 لاحقًا | Refund != Return != CreditNote حسب ADRs |
| طرق الدفع | أَوْج لديه طرق دفع أساسية لكن لا gateway commerce كامل | AWJ-LINK / GAP-V1 | PaymentIntent/gateway في COM-8؛ لا Spree payment sessions |
| Stripe/PayPal/Adyen | لا تُنقل كما هي | LATER / GAP حسب قرار البوابات | تكاملات مزودين خلف عقد دفع أَوْج |
| المتاجر المتعددة | أَوْج multi-tenant + SalesChannel أساس، لكن Store/domain contract يحتاج إكمالًا | GAP-V1 | لا نستخدم Spree multi-store isolation بدل Tenant Isolation |
| النطاق المخصص | غير مكتمل كقدرة متجر | GAP-V1 | domain → tenant/store/channel resolution آمن |
| الأسواق/الدول | نقتبس الفكرة ولا نستورد Spree Market model تلقائيًا | LATER / COMMERCE | السعودية أولًا؛ التوسع الدولي لاحقًا حسب قرار المنتج |
| العملات | أَوْج حاليًا أساسه SAR | LATER | لا نضيف multi-currency ضمن COM-7 بلا قرار مستقل |
| اللغات | العربية + الإنجليزية قرار معتمد | COMMERCE | العربية أساسية، RTL؛ إعداد المتجر مصدر الحقيقة |
| إعدادات العلامة والشعار | قدرة متجر | COMMERCE | إعدادات مستقلة لكل متجر/قناة مع عدم فرض هوية ERP على التاجر |
| القالب والألوان والخطوط | قدرة متجر | COMMERCE | Spree أساس؛ Tajawal افتراضي حاليًا؛ tokens قابلة للتخصيص |
| منشئ الصفحات/الأقسام | مهم للتخصيص لكنه ليس شرط تأسيس الكتالوج | LATER | يُخطط بعد storefront الحقيقي؛ لا يوقف COM-7-P0/P1 |
| الصفحات والمحتوى | قدرة متجر | COMMERCE / LATER | سياسات، صفحات ثابتة، بنرات؛ الحد الأدنى يحدد للإطلاق |
| المدونة | ليست شرطًا لأول إطلاق | LATER | لا تدخل V1 بلا متطلب واضح |
| SEO | نحتفظ بقدرات Spree UI ونربطها ببيانات أَوْج | COMMERCE / BORROW-UX | meta/slugs/sitemap/structured data |
| السياسات القانونية | قدرة متجر | COMMERCE | الخصوصية، الشحن، الإرجاع، الشروط؛ محتوى يملكه التاجر |
| المتجر المحمي بكلمة مرور | مفيد قبل الإطلاق | LATER | ميزة صغيرة يمكن إضافتها بعد الأساس |
| الاستيراد/التصدير CSV | أَوْج لديه أنماط استيراد/تصدير يجب إعادة استخدامها حيث تصلح | AWJ-LINK / BORROW-UX | لا ننشئ pipeline موازٍ للمنتجات والعملاء |
| العمليات الجماعية | نستخدم قدرات أَوْج الأصلية حيث توجد | AWJ-LINK / BORROW-UX | سياق المتجر قد يطبق فلاتر القناة/النشر فقط |
| التقارير | تقارير أَوْج هي الأساس + مؤشرات Commerce خاصة | AWJ-LINK / COMMERCE | روابط إلى تقارير أَوْج، وتقارير متجر خاصة فقط عندما تكون channel-specific |
| التحليلات/GA4 | واجهة Spree توفر أساسًا جيدًا | BORROW-UX / LATER | لا تجعل تحليلات الطرف الثالث مصدر أرقام محاسبية |
| أكواد التتبع/التسويق | إعداد متجر | LATER | sandboxed/validated قدر الإمكان؛ الأمن/CSP مهمان |
| البريد وإشعارات التجارة | يحتاج تكامل مع بنية أَوْج | GAP-V1 حسب رحلة الإطلاق | لا نستورد Spree webhook/email contract كما هو |
| B2B/Wholesale | خارج أول vertical slice | LATER | لا نخلطه مع إطلاق B2C الأول |
| Gift Cards/Store Credit | ليس شرطًا أوليًا | LATER | يحتاج قرار محاسبي وتجاري مستقل قبل التنفيذ |
| Wishlist | غير موجود أصلًا في Spree Storefront المدقق | LATER | لا نعتبره ميزة جاهزة من Spree |

## 4. أهم ما نستفيد منه مباشرة من Spree Admin

لا نحتاج نسخ الشاشات، لكن توجد أفكار قوية لمساحة متجر أَوْج:

1. **Dashboard تجارة إلكترونية حقيقي** بدل قائمة إعدادات فقط.
2. **إدارة متعددة المتاجر من مكان واحد** مع نطاق وهوية وإعدادات لكل متجر؛ نطبقها فوق Tenant/SalesChannel في أَوْج لا فوق نموذج Spree.
3. **تنظيم واضح للشحن والعروض والمرتجعات والدفع** كقدرات تجارة إلكترونية منفصلة.
4. **إدارة المحتوى وSEO والسياسات** من مساحة المتجر بدل خلطها بوحدات ERP.
5. **عمليات جماعية واستيراد/تصدير**؛ نعيد استخدام ما لدى أَوْج بدل إنشاء نسخ ثانية.
6. **تقارير ومؤشرات خاصة بالمتجر** مع بقاء التقارير المالية والمخزنية في أَوْج.
7. **تخصيص هوية كل متجر** دون فرض هوية أَوْج الإدارية على واجهة العميل.

## 5. فجوات V1 التي ظهرت بوضوح

هذه ليست شاشات ناقصة فقط؛ هي عقود backend يجب أن توجد فعليًا:

- Public-safe catalog API.
- Store/domain/channel resolution.
- Cart authority + guest/authenticated persistence.
- Saved customer Address Book.
- Checkout orchestration ضد دورة CommerceOrder الحالية.
- Shipping/Fulfillment/Shipment + tracking.
- PaymentIntent/gateway لاحقًا في COM-8.
- Order → Invoice bridge وفق trigger معتمد لاحقًا.

يجب ألا يخفي Spree UI أي فجوة من هذه أو يعطي انطباعًا بأنها أصبحت منفذة لمجرد أن الشاشة موجودة.

## 6. نموذج مساحة إدارة متجر أَوْج بعد المقارنة

```text
Commerce Workspace
├─ نظرة عامة
├─ الطلبات                  [Commerce]
├─ الكتالوج والنشر           [Commerce + روابط منتجات أَوْج]
├─ العملاء                   [رابط سياقي إلى عملاء أَوْج]
├─ المخزون                   [رابط سياقي إلى مخزون أَوْج]
├─ العروض                    [Commerce — عند اعتمادها]
├─ الشحن والتسليم            [Commerce]
├─ الدفع                     [Commerce + إعدادات أَوْج]
├─ المحتوى والمظهر           [Commerce]
├─ النطاق واللغات            [Commerce]
├─ التقارير                  [Commerce KPIs + روابط تقارير أَوْج]
└─ الإعدادات
```

هذه ليست قائمة تنقل نهائية؛ هي **خريطة مسؤوليات**. الشكل النهائي للـsidebar/topbar/hybrid ما زال قرار UI لاحقًا.

## 7. ترتيب الأولوية الناتج

قبل أول إطلاق متجر حقيقي:

**أولوية A — تأسيس إلزامي**
- Spree Storefront foundation.
- public catalog + adapter.
- tenant/store/domain resolution.
- العربية/الإنجليزية.
- نشر المنتجات الآمن.

**أولوية B — رحلة الشراء**
- cart.
- address book/checkout addresses.
- checkout orchestration.
- shipping/fulfillment.
- payment contract/integration وفق COM-8.
- order confirmation/history.

**أولوية C — تشغيل التاجر**
- Commerce dashboard.
- contextual navigation إلى منتجات/عملاء/مخزون/تقارير أَوْج.
- domain/store settings.
- basic content/policies/SEO.

**أولوية D — بعد الأساس**
- promotions engine الأوسع.
- page builder.
- blog.
- gift cards/store credit.
- B2B/wholesale.
- international markets/multi-currency.
- advanced marketing integrations.

## 8. القرار

**PASS — Spree Admin/Sandbox Gap Map لا يكشف سببًا لإلغاء Spree Storefront.** بالعكس، يؤكد أن Spree يوفر مرجعًا غنيًا لواجهة المشتري وتشغيل التجارة الإلكترونية، لكن أَوْج يجب أن يحتفظ بمصدر الحقيقة وبوحداته الإدارية الحالية.

الخطوة التالية وفق `AWJ_COM_7_SPREE_INTEGRATION_GATE.md` هي تحديد **مكان Spree Storefront في المستودع وحدوده التقنية وعقد store/domain resolution الأولي**، ثم تجهيز مهمة COM-7-P0. لا يبدأ cart/checkout/payment في PR التأسيس.

## 9. مصادر Spree المرجعية

المراجعة اعتمدت على توثيق Spree الرسمي الحالي وصفحات Spree 5 للـAdmin، multi-store، Stores، Admin API، وmulti-tenant capabilities. هذه المصادر مرجع خارجي؛ عند التعارض مع كود أَوْج أو ADR مدموج، مرجع أَوْج المعتمد يفوز.
