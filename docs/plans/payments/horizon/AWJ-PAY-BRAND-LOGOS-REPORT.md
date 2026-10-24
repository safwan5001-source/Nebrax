# AWJ Payments — الشعارات الرسمية (تقرير)

**التاريخ:** 2026-10-24 · **الفرع:** `claude/awj-payments-brand-logos`

المبدأ (دون تغيير): لا يُعرض شعار إلا أصلٌ **رسمي منشور من صاحب العلامة** بمصدر موثَّق في `web/src/lib/payment-brand-registry.ts`؛ وإلا يظهر الاسم نصاً مع حالة الاتصال الصحيحة. لا إعادة رسم ولا مصادر طرف ثالث ولا قبول شروط نيابةً عن المالك.
المكوّنان `PaymentBrandMark` / `PaymentBrandRow` هما الطريق الوحيد؛ مربوطان أصلاً بتبويبي «وسائل الدفع» و«بوابات الدفع» وتفاصيل البوابة ورابط الدفع العام — لا مكوّن جديد ولا تغيير تصميم ولا منطق مدفوعات/محاسبة.

## الحالة لكل علامة

| العلامة | الحالة | المصدر / العائق |
|---|---|---|
| **Apple Pay** | ✅ أُضيف: `web/public/payment-brands/apple-pay.svg` | [Apple Pay Marketing Guidelines](https://developer.apple.com/apple-pay/marketing/) ← `Apple-Pay-Mark.zip` (تحميل مباشر بلا نموذج قبول؛ الملف `SVG/Apple_Pay_Mark_RGB_041619.svg` **حرفياً دون تعديل**، SHA-256 `66baf110…803c` يحرسه اختبار). |
| **Moyasar** | ⛔ معلّق | [moyasar.com/press](https://moyasar.com/press) = 404، و[docs.moyasar.com](https://docs.moyasar.com) لا يوفّر حزمة شعار ولا شروط إعادة استعمال (شعار الترويسة لموقعهم فقط). **المطلوب:** طلب الحزمة والشروط عبر help.moyasar.com / قناة الشريك. |
| **mada** | ⛔ معلّق | موقع مدى/المدفوعات السعودية (`mada.com.sa`) غير قابل للوصول من بيئة البناء (DNS)، ولم يُتحقق من صفحة تنزيل رسمية؛ النسخ المتاحة (Brands of the World / ملف PDF على نطاق ثالث) **ليست رسمية فلا تُستعمل**. **المطلوب:** الحزمة + دليل التجار من مدفوعات السعودية أو شريك التحصيل (إلزام تنظيمي لـSAMA). |
| **Visa** | ⛔ معلّق — إجراء المالك | [Visa Brand Mark](https://globalclient.visa.com/brand-mark): لا تحميل مباشر؛ نموذج باسم نشاط ويشترط قبول Terms of Use. لا يجوز قبوله نيابةً عن المنشأة. **المطلوب:** تعبئة النموذج باسم أَوْج وإيداع SVG في `public/payment-brands/` وتسجيله. |
| **Mastercard** | ⛔ معلّق — إجراء المالك | [Mastercard Brand Center](https://www.mastercard.com/brandcenter/en/download-artwork) أعاد 403 من البيئة، والأصول تُصرف بشروطه. **المطلوب:** التنزيل باسم أَوْج وتسجيله. |
| **Tap وغيرها** | غير منطبق | `tap` (و`stripe`/`paytabs`/`checkout`) مفاتيح مزوّد معرَّفة لكن **بلا محوّل** (`PaymentGatewayAdapterRegistry`: Moyasar فقط) فلا بوابة مدعومة فعلياً؛ ولا أصل رسمي موثَّق (المتاح نسخ [CDNLogo](https://cdnlogo.com/logo/tap-payments_226305.html) غير رسمية). تُضاف مع محوّلها (H2-04). |

## قرارات AWJ
1. **Apple Pay:** تُعرض العلامة في تبويب الإعدادات تعريفاً بالوسيلة (حالتها الفعلية «تحتاج إعداداً» ظاهرة بجانبها ومفتاحها معطّل)، وفي رابط الدفع العام **فقط** حين تكون الوسيلة مدعومة ومفعَّلة وجاهزة من الخادم **و**جهاز المتسوّق يدعمها (`ApplePaySession.canMakePayments()`) — بحسب إرشادات Apple؛ وتبقى غير جاهزة تلقائياً حتى EXT-10 (تسجيل النطاق). الشروط المنشورة مسجَّلة حرفياً في `provenance.terms`.
2. **إظهار شعار البوابة مع اتصال غير مفعَّل:** المسار قائم (`GatewaysPanel` يستعمل `gatewayProviderBrand` بصرف النظر عن الحالة)؛ سيظهر شعار Moyasar تلقائياً حين يُسجَّل أصله، والحالة تبقى من الخادم.
3. العلامات المعلّقة تحمل متطلباً بصيغة `BLOCKED: …` (يحرسها اختبار) وتُدرج في `pendingPaymentBrandRequirements()`.

## الاختبارات
- vitest: السجل (8) + `PaymentBrandMark`/`PaymentBrandRow` (20 مع اللغتين)، منها بصمة الأصل الرسمي، حجب Apple Pay على جهاز غير مدعوم، وتصحيح اختبار فشل تحميل الصورة (كان يفشل على `main`).
- Playwright (`pay-h8-02`): `payment-methods-viewer` (شعار Apple Pay محمَّل + بقية الوسائل نص + الحالة الصحيحة)، `paylink-apple-pay-device` (390/768/1280/1440 × ar/en × فاتح/داكن)، `paylink-apple-pay-unsupported-device`، `paylink-open`، `gateway-detail-sheet` — 60 اختباراً أخضر؛ فُحصت اللقطات بصرياً.
