# AWJ Payments — الشعارات (تقرير الاستكمال)

**التاريخ:** 2026-10-24 · **الفرع:** `claude/awj-payments-brand-logos-complete`

المبدأ: الشعار يدخل `web/src/lib/payment-brand-registry.ts` **فقط** بمصدر موثَّق + أصل الملف + حالة الحقوق + بصمة SHA-256؛ لا رسم يدوي ولا تلوين ولا تغيير نسبة. أصلٌ ثبت منعُ استعماله لا يُسجَّل (لم يُكتشف أيٌّ منها). الأصول فُحصت قبل الإدخال (لا `<script>`/`<foreignObject>`/`<image>`/`<use>`/DOCTYPE/ENTITY/مراجع خارجية/معالجات أحداث) ويحرس ذلك اختبار آلي على كل ملف في `public/payment-brands/`.
المكوّنان `PaymentBrandMark`/`PaymentBrandRow` هما الطريق الوحيد (الإعدادات، تفاصيل البوابة، رابط الدفع العام).

## الأصول (`web/public/payment-brands/`)

| العلامة | الملف | المصدر | الأصل | حالة الحقوق |
|---|---|---|---|---|
| Apple Pay | `apple-pay.svg` (محفوظ) | [Apple Pay Marketing Guidelines](https://developer.apple.com/apple-pay/marketing/) — `Apple-Pay-Mark.zip` | حزمة رسمية | **granted** بشروط Apple المسجَّلة (بلا تعديل؛ يُعرض للعميل على جهاز يدعمه فقط) |
| Moyasar | `moyasar.svg` + `moyasar-dark.svg` | [docs.moyasar.com/img/logo.svg](https://docs.moyasar.com/img/logo.svg) و`logo-dark.svg` | شعار منشور على موقع الناشر (نسختان رسميتان فاتحة/داكنة) | **unverified**: لا حزمة علامة ولا شروط إعادة استعمال منشورة ولا ما يمنع التعريف بالمزوّد؛ المطلوب تأكيد كتابي عبر help.moyasar.com |
| Tap | `tap.svg` | [websiteimages.b-cdn.net/Logo_7de102aab6.svg](https://websiteimages.b-cdn.net/Logo_7de102aab6.svg) (شعار ترويسة tap.company) | شعار منشور على موقع الناشر | **unverified** (لا حزمة/شروط). لا محوّل لـTap في AWJ بعد (H2-04): يظهر فقط لاتصال `tap` قائم |
| mada | `mada.svg` | [activemerchant/payment_icons › mada.svg](https://github.com/activemerchant/payment_icons/blob/master/app/assets/images/payment_icons/mada.svg) | نسخة مجتمعية موثوقة (Shopify) | ملف الأرتورك **MIT** ([MIT-LICENSE](https://github.com/activemerchant/payment_icons/blob/master/MIT-LICENSE)) والعلامة لصاحبها؛ **unverified** حتى نحصل على الحزمة الرسمية |
| Visa | `visa.svg` | [… › visa.svg](https://github.com/activemerchant/payment_icons/blob/master/app/assets/images/payment_icons/visa.svg) | نسخة مجتمعية (Shopify) | كما mada (MIT للملف، **unverified** للعلامة) |
| Mastercard | `mastercard.svg` | [… › master.svg](https://github.com/activemerchant/payment_icons/blob/master/app/assets/images/payment_icons/master.svg) | نسخة مجتمعية (Shopify) | كما mada |

محاولات المصادر الرسمية (موثَّقة في التقرير السابق): موقع مدى غير قابل للوصول من البيئة؛ Visa Brand Center يشترط نموذجاً وقبول شروط باسم المنشأة؛ Mastercard Brand Center أعاد 403؛ Moyasar/Tap بلا صفحة علامة. استُبدلت بأقرب مصدر عام موثوق لا يخالف شروطاً معلنة. **عند توفر الحزمة الرسمية** تُستبدل الملفات وتُحدَّث `provenance` (الاختبار يفرض تطابق البصمة).

## العرض
- **وسائل الدفع:** شعار لكل وسيلة بجانب حالتها الفعلية (مفعّلة/معطّلة/تحتاج إعداداً/غير مدعومة) — الشعار هوية الوسيلة لا ادّعاء قبول.
- **بوابات الدفع:** شعار المزوّد في بطاقة الاتصال **مهما كانت حالته** (اختُبر اتصال Moyasar مسودة/غير مفعَّل)، والاتصال اليدوي بلا علامة مسجَّلة بلا شعار.
- **رابط الدفع العام:** لا تُعرض وسيلة إلا إذا أعلنها الخادم مدعومة ∧ مفعَّلة ∧ جاهزة (دون تغيير)، وApple Pay زيادةً على جهاز يدعمها.
- **الوضع الداكن:** Moyasar بنسخته الداكنة الرسمية؛ Tap (داكن بلا نسخة داكنة) على سطح أبيض صغير بلا تلوين؛ بطاقات mada/Visa/Mastercard/Apple Pay بأسطحها الأصلية.
- لا تغيير في منطق المدفوعات أو المحاسبة أو الخلفية.

## الاختبارات
- vitest: السجل (9) + المكوّنات (12×… بلغتين)، منها: تطابق البصمات، تسجيل كل ملف على القرص، فحص المحتوى النشط/الخارجي، حالة الحقوق، النسخة الداكنة، عدم التلوين.
- Playwright (`pay-h8-02`): الشعارات محمَّلة فعلاً (`naturalWidth>0`) في تبويب الوسائل وقائمة البوابات (بما فيها اتصال غير مفعَّل) ورابط الدفع (بجهاز يدعم/لا يدعم Apple Pay)، على 390/768/1280/1440 × ar/en × فاتح/داكن؛ فُحصت اللقطات بصرياً.
