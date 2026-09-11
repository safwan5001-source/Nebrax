# AWJ Commerce — COM-7 × Spree Integration Gate

**الحالة:** خطة توحيد قبل التنفيذ — لا تفوض دمجًا أو نشرًا
**التاريخ:** 2026-09-11
**النطاق:** نقطة الانتقال من COM-6 إلى COM-7 وربط Spree Storefront بمسار AWJ Commerce

## 1. سبب هذه الوثيقة

اكتملت سلسلة COM-6 بعد دمج PR #757 (COM-6C). قبل بدء COM-7A بصيغته الأصلية، يجب منع مسارين متوازيين: بناء واجهة متجر/سلة من الصفر داخل أَوْج من جهة، وإدخال Spree Storefront لاحقًا من جهة أخرى.

لذلك تصبح هذه الوثيقة **بوابة إلزامية قبل COM-7**: يتم توحيد Spree Storefront مع معمارية Commerce الحالية، مع بقاء أَوْج مصدر الحقيقة للعميل والمخزون والتسعير والطلب والدفع والفوترة والمحاسبة.

## 2. الثوابت التي لا تتغير

لا يغيّر اعتماد Spree أيًا من العقود المعمارية المعتمدة في Commerce:

- `CommerceOrder != Invoice`.
- `Reservation != StockMovement`.
- إجماليات العميل/المتصفح ليست سلطة مالية.
- هوية العميل تأتي من Customer Platform المشتركة في أَوْج.
- Tenant Isolation والتحقق من الملكية والصلاحيات يتمان في الخادم.
- Spree لا يكتب قيودًا محاسبية أو حركات مخزون أو ZATCA.
- توقيت إنشاء الفاتورة لا يُستورد من Spree ويظل قرار أَوْج المعتمد.
- لا تُفرض آلة حالات Checkout الخاصة بـ Spree على دورة حياة Commerce في أَوْج.

## 3. القرار بشأن Spree

يعتمد **Spree Storefront كاملًا كأساس واجهة المتجر** مع تثبيت نسخة/مراجعة المصدر وحفظ ترخيص MIT وإشعار الأصل.

لكن الاستخدام ينقسم إلى:

### أ. نحتفظ ونكيّف

- بنية صفحات المتجر والتنقل.
- عرض المنتجات والتصنيفات.
- البحث والفلاتر.
- بطاقات المنتجات وصفحة المنتج ومعرض الصور.
- السلة الجانبية وصفحة السلة كواجهة.
- أجزاء واسعة من واجهة حساب العميل وسجل الطلبات.
- صفحات التأكيد والعناصر البصرية العامة.
- SEO والبيانات المنظمة والتحليلات حيث تتوافق مع أَوْج.
- بنية اللغات مع إضافة العربية كجزء أساسي.

### ب. نستبدل منطق الخلفية

- مصدر المنتجات والتصنيفات والأسعار والتوفر.
- حفظ السلة وملكيتها.
- المصادقة وجلسة العميل.
- العناوين المحفوظة عندما تُبنى في أَوْج.
- checkout state machine.
- الشحن ومعدلاته.
- الخصومات والقسائم عند اعتمادها.
- الدفع والبوابات.
- webhooks المرتبطة بمنطق Spree الخلفي.

كل ذلك يتصل بعقود أَوْج بدل Spree Backend.

## 4. حد التكامل الإلزامي

يجب ألا تعرف مكونات واجهة المتجر تفاصيل Laravel endpoints بصورة مبعثرة.

المسار المستهدف:

```text
Spree-derived UI
    ↓
AWJ Store data/actions boundary
    ↓
AWJ Public/Customer Commerce API
    ↓
AWJ Commerce services
    ↓
CommerceOrder / Reservation / Customer Platform / Pricing / لاحقًا Payment & Fulfillment
```

يجب تعريف نماذج بيانات واجهة متجر يملكها أَوْج، وعدم تسريب نماذج Spree الداخلية إلى كل المكونات إذا كان ذلك سيجعل الاستبدال لاحقًا صعبًا.

## 5. إعادة ترتيب COM-7

لا يبدأ COM-7A القديم مباشرة بإنشاء Cart/Checkout كامل. يقسم التنفيذ إلى شرائح أصغر:

### COM-7-P0 — Spree Storefront Foundation

- إدخال fork نظيف ومثبت من Spree Storefront في مساحة مستقلة عن واجهة ERP.
- حفظ LICENSE/NOTICE والأصل والمراجعة المثبتة.
- تشغيل baseline build/tests الخاصة بالواجهة قبل تعديلات أَوْج.
- تحديد حدود الحزم/المسارات حتى لا يختلط storefront مع `web` الإداري عشوائيًا.
- لا ربط مالي، لا checkout فعلي، لا دفع.

### COM-7-P1 — AWJ Store Adapter + Read-only Catalog

أول vertical slice فعلي:

```text
AWJ Commerce Listing / Product truth
  → public-safe catalog API
  → AWJ Store adapter
  → Spree catalog UI
```

يشمل فقط ما يلزم للتصفح الحقيقي: المنتجات المنشورة، التصنيفات، الصور، السعر التجاري المسموح عرضه، ATS/availability الآمن، البحث/الفلاتر المطلوبة.

شروط الأمان:

- لا cost أو avg_cost أو حقول داخلية حساسة في الرد العام.
- tenant/store/channel resolution قبل قراءة البيانات.
- لا ثقة في tenant id يرسله المتصفح كسلطة.
- اختبارات cross-tenant إلزامية.

### COM-7-P2 — Arabic/English + Store/Tenant Resolution

- العربية أساسية والإنجليزية كاملة.
- RTL/LTR صحيحان.
- إعداد اللغة الافتراضية من أَوْج.
- domain/hostname/store/channel resolution في طبقة مبكرة وآمنة.
- تصميم قابل لتعدد المتاجر/القنوات دون مشاركة بيانات بينها.

### COM-7-P3 — Cart Contract

- تعريف Cart مملوك لأَوْج، لا Spree Cart كسلطة.
- guest cart + authenticated cart وفق عقود Customer Platform.
- الأسعار والتوفر يعاد التحقق منهما في الخادم.
- totals من الخادم فقط.
- idempotency للمutations الحساسة.
- لا إنشاء Invoice ولا أثر محاسبي عند مجرد السلة.

### COM-7-P4 — Checkout Orchestration

- واجهة Spree checkout تستخدم كمرجع/هيكل بصري فقط حيث تصلح.
- checkout يعاد ربطه بدورة حياة أَوْج.
- CommerceOrder + immutable snapshots + reservation contracts المعتمدة هي المرجع.
- لا Payment gateway قبل مرحلة الدفع المعتمدة.
- لا افتراض لتوقيت الفاتورة.

### COM-7-P5 — Public/Mobile Commerce API V1

يُحافظ على هدف COM-7B الأصلي لكن بعد تثبيت العقود السابقة. نفس العقود تخدم Web Store وتطبيق «متجرنا» والقنوات المستقبلية بدل إنشاء منطق متجر ويب منفصل.

## 6. Spree Admin / Sandbox Gap Map

قبل إغلاق بوابة COM-7 يجب تنفيذ مراجعة وظيفية لـ Spree Admin/Sandbox وتصنيف كل قدرة إلى واحدة من خمس فئات:

1. **موجودة في أَوْج — رابط سياقي فقط.**
2. **خاصة بالتجارة الإلكترونية — تبنى/تدار داخل Commerce Workspace.**
3. **نقتبس تجربة Spree أو تنظيمه فقط.**
4. **ناقصة في أَوْج وتحتاج تطويرًا قبل/ضمن الإصدار الأول.**
5. **مؤجلة لما بعد الإصدار الأول.**

الأقسام التي يجب تغطيتها على الأقل: المنتجات، التصنيفات، العملاء، الطلبات، المخزون، الأسعار/العروض، الشحن، المرتجعات والاستردادات، الدفع، المتاجر/القنوات، النطاقات، اللغات/العملات، المحتوى/المظهر، التقارير، الاستيراد/التصدير والإعدادات.

لا تعتمد Spree Admin كلوحة ثانية. القرار المعتمد هو مركز قيادة Commerce داخل أَوْج مع روابط سياقية إلى وحدات أَوْج الأصلية.

## 7. مساحة إدارة المتجر

تطبق وثيقة `AWJ_COMMERCE_ADMIN_NAVIGATION_DECISION.md`:

- المنتجات → منتجات أَوْج.
- العملاء → عملاء أَوْج.
- المخزون → مخزون أَوْج.
- الفواتير → فواتير أَوْج.
- التقارير → تقارير أَوْج.
- طرق الدفع المشتركة → إعدادات أَوْج المناسبة.

ويحفظ سياق العودة إلى المتجر بعد الإضافة/التعديل دون تجاوز RBAC أو Tenant Isolation.

القدرات الخاصة بالمتجر مثل النطاق والقالب والمظهر والنشر والبنرات وإعدادات القناة والتوصيل ومعاينة المتجر يمكن أن تعيش داخل Commerce Workspace وفق الخطة النهائية.

## 8. اتجاه التصميم

تطبق وثيقتا:

- `AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md`
- `AWJ_STORE_LANGUAGE_DECISION.md`

Spree هو الأساس وليس الهوية النهائية. لا تبدأ إعادة تصميم كبيرة قبل ربط الكتالوج الحقيقي. القالب الافتراضي يجب أن يكون جميلًا ومتكاملًا وقابلًا للتخصيص، والخط الافتراضي الحالي Tajawal، مع العربية أولًا والإنجليزية كاملة.

## 9. فجوات معروفة لا يجوز إخفاؤها خلف Spree UI

وفق تدقيق Spree الفني، أَوْج لا يزال يحتاج في المراحل المناسبة إلى عقود/تنفيذ حقيقي لبعض القدرات، وأهمها:

- Cart authority/persistence.
- customer saved address book (6C بنى snapshot تاريخيًا ولم يبن address book).
- shipping/fulfillment model.
- PaymentIntent/gateway implementation.
- Order → Invoice bridge وفق trigger معتمد.
- public-safe catalog surface.
- multi-store domain resolution.

وجود شاشة جاهزة في Spree لا يعني أن هذه القدرات موجودة في أَوْج.

## 10. الاختبارات والبوابات

كل شريحة تنفذ باختبارات مرتبطة أولًا ثم الأوسع حسب المخاطر. لا تخفض اختبارات:

- Tenant Isolation.
- ownership / IDOR.
- inventory reservation / ATS.
- pricing authority.
- idempotency.
- accounting isolation.

قبل أي دمج لواجهة Spree يجب إثبات baseline build ثم build بعد التكييف. وعند بدء API العام يجب وجود اختبارات تمنع تسرب cost/private fields وتمنع cross-tenant/store reads.

## 11. ما لا نفعله

- لا نرفع Spree Backend/Rails كنظام خلفي موازٍ لأَوْج.
- لا نستخدم Spree Admin كنظام إدارة ثانٍ.
- لا نعيد بناء storefront من الصفر.
- لا ننسخ checkout/payment business logic إلى أَوْج.
- لا نغير ADRs المالية/المخزنية بسبب سهولة واجهة Spree.
- لا نبدأ payment/shipping/invoice bridge داخل PR تأسيس Spree.
- لا merge أو deploy بموجب هذه الوثيقة وحدها.

## 12. الترتيب المقترح من الآن

```text
COM-6C merged
   ↓
COM-7 Integration Gate (هذه الوثيقة)
   ↓
Spree Admin/Sandbox Gap Map
   ↓
COM-7-P0 Storefront Foundation
   ↓
COM-7-P1 Read-only Catalog
   ↓
COM-7-P2 Arabic/English + Store Resolution
   ↓
COM-7-P3 Cart
   ↓
COM-7-P4 Checkout
   ↓
COM-7-P5 Public/Mobile API V1
   ↓
COM-8 Payments وما بعدها وفق Master Plan
```

## 13. شرط إغلاق البوابة

لا تبدأ COM-7-P0 كتنفيذ إنتاجي حتى:

1. تُراجع هذه الخطة مقابل أحدث `main` وADRs ذات الصلة.
2. تكتمل Spree Admin/Sandbox Gap Map.
3. يُحدد مكان storefront في المستودع وحدود اعتماده التقنية دون خلطه بواجهة ERP.
4. يُحدد عقد tenant/store/domain resolution المبدئي.
5. يُحسم أن أول PR تنفيذي لا يغير checkout/payment/accounting/inventory rules.

بعد ذلك تصبح COM-7-P0 أول مهمة برمجية صغيرة وقابلة للمراجعة، بدل PR ضخم يرفع Spree ويعيد بناء Commerce في الوقت نفسه.
