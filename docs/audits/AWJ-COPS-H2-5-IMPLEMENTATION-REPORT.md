# COPS-H2-5 — Implementation Report (تتبّع الضيف الموقَّع لطلب المتجر)

| البند | القيمة |
|---|---|
| Slice | COPS-H2-5 — رمز `trk1` + `POST store/v1/orders/{order}/tracking-link` + `GET store/v1/order-tracking/{token}` + صفحة `/{locale}/track/{token}` + رابط التأكيد |
| Branch | `claude/cops-h2-5-guest-tracking` (مكدَّس على H2-4) |
| PR / Merge SHA | تُسجَّل مجمَّعةً في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md` |
| الحالة | Implemented · Tested · عند الدمج Merged · **Not deployed · Not activated** (`COMMERCE_GUEST_ORDER_TRACKING_ENABLED` مغلقة) |
| العقد | خطة H2-0 §3.2: D-H2-15 (الآلية) · D-H2-16 (الصلاحية والبيانات) · D-H2-17 (الحدود) |

## 0. الخلاصة

- رمز **منفصل الغرض** `trk1.{order_id}.{exp}.{hmac}`: HMAC-SHA256 على `tenant|channel|order|exp` بمفتاح مشتق `HMAC(app.key, "awj.commerce.order-tracking.v1")` أو `COMMERCE_TRACKING_KEY` (تدوير). عديم الحالة — لا جدول ولا عمود ولا هجرة.
- **الإصدار** `POST store/v1/orders/{order}/tracking-link` يتطلب **مرجع الطلب `v1`** (`X-Order-Reference`) + بوابة الكتابة؛ حتمي (الرمز نفسه لكل إصدار)، `exp = confirmed_at + 90 يوماً` (`commerce.guest_tracking_ttl_days`). لا تغيير في استجابة الإتمام.
- **القراءة** `GET store/v1/order-tracking/{token}`: إسقاط ضيّق (`CommerceOrderPublicTracking`): رقم الطلب، الحالة العامة، تاريخ الطلب، طريقة التسليم، الموعد، كتلة `fulfillment` (H2-4)، وانتهاء الرابط. **بلا** اسم/عنوان/هاتف/بريد/هدية/سطور/أسعار/دفع.
- **404 موحَّد بجسم واحد** لكل خلل: بوابة مغلقة، صيغة، توقيع، انتهاء، طلب/مستأجر/قناة أخرى، مرجع `v1` مُرسَل كرمز. مقارنة ثابتة الزمن بلا اختصار بين الشروط.
- **الحدود (D-H2-17):** 30/دقيقة لكل رمز صالح؛ 20/دقيقة للمحاولات **الفاشلة** لكل (متجر، هوية زائر موقَّعة إن فُعِّلت وإلا المتجر) ⇒ 429 + `Retry-After`. **قرار تنفيذي:** الحامل الصالح لا يُقفل بسلة الفاشل (التحقق عديم الحالة ولا يُخمَّن)، فلا يستطيع مخرِّب إقفال زائر شرعي؛ سلة الفاشل تكبح التعداد فقط.
- ترويسات: `Cache-Control: no-store` · `X-Robots-Tag: noindex, nofollow` · `Referrer-Policy: strict-origin-when-cross-origin`. الرمز في **المسار** لا الاستعلام، ومسارات `store/v1` لا تمرّ بـ`PublicApiRequestAudit` (اختبار: صفر سجلات).
- الواجهة (`storefront/`): صفحة `/track/[token]` (نفس شكل صفحة العودة، `noindex` وReferrer-Policy بالتخطيط، محظورة في `robots.txt`)، وبطاقة رابط التتبع في التأكيد **تظهر فقط إن أصدر الـAPI رابطاً** (بوابة مغلقة ⇒ لا شيء ⇒ التأكيد القديم حرفياً).

## 1. الملفات

| الملف | التغيير |
|---|---|
| `app/Support/CommerceOrderTrackingToken.php` | **جديد** — إصدار/تحقق/تفكيك (لا DB ولا Log) |
| `app/Support/CommerceOrderPublicTracking.php` | **جديد** — الإسقاط الضيّق |
| `app/Http/Controllers/Api/StorefrontOrderTrackingController.php` | **جديد** — `issue`/`show`، الحدود، الترويسات |
| `routes/api_storefront.php` · `config/commerce.php` | المساران + البوابة/الصلاحية/المفتاح (مغلقة افتراضياً) |
| `tests/Feature/WholesalePriceSurfaceBoundaryTest.php` | تصنيف المسارين الجديدين «بلا سعر قناة» (الحارس نفسه يفشل لأي مسار `store/v1` غير مصنَّف) |
| `tests/Feature/CommerceOrderGuestTrackingTest.php` | **جديد** — 16 اختباراً |
| `storefront/src/lib/commerce/order-tracking.ts` · `lib/data/awj-order-tracking.ts` | العميل وإجراءات الخادم (الرمز والمرجع لا يُسجَّلان ولا يدخلان استعلاماً) |
| `storefront/src/components/orders/OrderTrackingView.tsx` · `OrderTrackingLinkCard.tsx` · `account/AccountOrderStatus.tsx` | الصفحة والبطاقة (+ `showUntrackedCaption`) |
| `storefront/src/app/[country]/[locale]/(store-checkout)/track/[token]/{page,layout}.tsx` · `app/robots.ts` | الصفحة و`noindex` |
| `storefront/messages/*.json` | مفاتيح `orderTracking` بستّ لغات |

## 2. الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| `CommerceOrderGuestTrackingTest` (SQLite) | ✅ 16/16: البوابة مغلقة (404) وافتراضها مغلق في الإعداد · الإصدار بمرجع `v1` فقط وحتمي · الانتهاء `confirmed_at+90` · القائمة البيضاء وعدم تسريب PII (اسم/هاتف/بريد/عنوان/سطور/أسعار/ساعي/مخزن) · **مصفوفة 9 إخفاقات + انتهاء بجسم 404 واحد** (غير معروف، توقيع، انتهاء معدَّل، طلب آخر، مرجع `v1` كرمز، بادئة، نص عشوائي، مفرط الطول، مبتور) · متجر/مستأجر آخر · فصل الغرض (الرمز لا يخوّل `payment-intent`/`payment-status`، والمرجع لا يخوّل التتبع) · 30 صالح ⇒ 429 ثم تعافٍ · 20 فاشل ⇒ 429 والصالح لا يُقفل · ملغى بلا كتلة · لا كتابة ولا تدقيق · فحص ساكن (لا DB/Log/حفظ) · تدوير المفتاح يبطل كل الرموز · تفكيك آمن لأي شكل تالف |
| ضابط سلبي | اكتشاف: التحقق كان يقرأ `time()` فلا يتأثر بزمن الاختبار (`travelTo`) ⇒ اختبار الانتهاء كشف الخطأ وأُصلح إلى `now()` (يحترم ساعة التطبيق) |
| `WholesalePriceSurfaceBoundaryTest` | ✅ — اكتشف المسارين غير المصنَّفين فأُضيفا لقائمة «بلا سعر قناة» |
| storefront Vitest | ✅ كامل (272 ملفاً / 3709): الصفحة بملفات الرسائل الحقيقية للغات الست، البطاقة (لا تظهر عند الفشل، لا تطبع المرجع، نسخ الرابط)، المُحوِّل، حارس معماري (noindex، الرمز من المسار فقط، لا مرجع ولا سطح دفع، لا `fetch` في المتصفح) |
| `tsc` · `next build` (storefront) | ✅ |

## 3. لا أثر محاسبي أو مخزني

قراءة/توقيع فقط: لا كتابة ولا حدث ولا قيد ولا مخزون ولا حجز. جدول القيود: **لا قيود جديدة**.

## 4. المخاطر والقرارات

| البند | المعالجة |
|---|---|
| لا إبطال لكل طلب (D-H2-15 ج مرفوض) | معلن: التدوير بالمفتاح يبطل الكل؛ `exp` حتمي بـ90 يوماً |
| الرابط قد يُشارَك | الإسقاط بلا PII/عناوين/سطور/هدية؛ `noindex`؛ Referrer-Policy |
| سلة الفاشل مشتركة على مستوى المتجر ما لم تُفعَّل هوية الزائر الموقَّعة | مخرِّب يستطيع رفع سلة الفاشل فقط (يرى المخرِّب نفسه 429)، والحامل الصالح لا يتأثر؛ تفعيل الهوية خارج النطاق (B2C-ACTIVATION) |
| `accepted` ليس خطوة مرئية | تبقى في `stages` ولا تظهر عموداً (H2-4) |
| إرسال الرابط بريداً/رسالة | غير مبني عمداً (لا إرسال رسائل في H2) |

## 5. الخطوة التالية

H2-6 (طابور التحضير المجدول + أسباب `attention` + تقرير إغلاق H2). لا نشر ولا تفعيل.
