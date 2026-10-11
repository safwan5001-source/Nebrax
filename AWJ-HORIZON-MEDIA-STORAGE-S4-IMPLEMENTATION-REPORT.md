# AWJ-HORIZON-MEDIA-STORAGE — S4 Implementation Report (روابط مكتبة وسائط المتجر خلف حافة TLS)

> Branch: `horizon/media-storage-s4-signed-url-https` · Base: main بعد `0f` (SHAs في الـTracker).

## 1. العيب (اكتُشف باختبار متصفح على Production)
باختبار Playwright على `awj.up.railway.app` بمستأجر اختبار بعد تفعيل `STOREFRONT_MEDIA_R2_ENABLED`: داخل منشئ المتجر ظهرت أصول المكتبة بصور مصغّرة سليمة، لكن **صورة معاينة اللوحة بعد اختيار أصل حُجبت**: `Mixed Content: … requested an insecure image 'http://nibras-api-production.up.railway.app/…/800w.webp?…'. This request has been blocked`. السبب: الخادم خلف وكيل Railway بلا `trustProxies` فيرى الطلب `http` ويُولّد الروابط الموقَّعة `http://`؛ الصفحة `https`. (بعض الصور رُقّيت تلقائياً من Chrome وبعضها حُجب.)

## 2. القرار (AWJ Decision) والبدائل المرفوضة
- **المعتمد:** `App\Support\EdgeScheme::forBrowser()` يستبدل `http://`→`https://` **بعد التوقيع** على الروابط الموقَّعة لمكتبة الوسائط (الأصل والمشتقات) **فقط حين تؤكّد الحافة `X-Forwarded-Proto: https`**. التحقق من التوقيع يبقى على ما يراه التطبيق (`http`) فلا يتغيّر ما يُحسَب عليه التوقيع؛ أُثبت عملياً قبل الإصلاح: الرابط الموقَّع `http` يعمل عبر `https` (200).
- **مرفوض:** `trustProxies` عالمياً — يمسّ ترويسات Host/Forwarded التي يقوم عليها تحديد المستأجر (مخاطرة عزل)، ويكسر روابط موقَّعة تُولَّد عبر الشبكة الخاصة (`http` بلا ترويسة) ثم تُستهلك عبر الحافة (`https`) · فرض `URL::forceScheme('https')` — يوقّع على `https` بينما التحقق على `http` ⇒ 403.

## 3. الاختبارات
`StorefrontMediaEdgeSchemeTest` (2): المساعد لا يرقّي إلا مع `https` (ويحترم أول قفزة، ولا يمسّ `https` القائم) · روابط المكتبة `http` بلا حافة و`https` خلف الحافة، والرابط بعد تحويله إلى ما يراه التطبيق **يُقبَل 200** والمعبَث به **403**. مجموعة وسائط المتجر (API/Derivative/Delivery/Workspace Media): 104 نجاح؛ الإخفاق الوحيد `StorefrontShelfTitlesTest` بيئي (fixture لم تُنسخ إلى مشروع الاختبار المحلي، ولا علاقة له). لا اختبار قائم عُدِّل. لا قيود محاسبية.

## 4. حدود معلَنة
- لا يشمل روابط وسائط المنتج/التصنيف الموقَّعة (مسارات أخرى) — تُقيَّم بالتحقق نفسه إن ظهرت لها شكوى.
- يتطلب أن تُمرّر الحافة `X-Forwarded-Proto` (Railway تفعل ذلك — مُثبَت بالسلوك: 301 من http إلى https).
