# AWJ B8-2 — API عام آمن لسياسات المتجر (تقرير التنفيذ)

**Base:** `origin/main@c7d8ccf99770ab1ff533481c7ba86f7fec1b34a4` · **الفرع:** `claude/b8-2-public-policies` · **No Merge · No Deploy**

## 1) المعمارية وعقد الـendpoint
`GET /store/v1/policies/{slug}` ضمن مجموعة `store/v1` القائمة (`ResolveStorefrontDomain` + `EnforcePublicApiRateLimit:unauth`)، متحكّم `StorefrontPolicyController`، منقّي `App\Support\Commerce\PolicyMarkdownRenderer`.

- **الهوية:** من `Host` وحده عبر `StorefrontContext`؛ لا tenant/storefront من الاستعلام أو `X-Forwarded-Host`/`Forwarded`/`X-Tenant-ID`… (مُختبَر).
- **المصدر:** `StorefrontPresentationService::publishedSnapshotForStorefront()` — اللقطة المنشورة فقط، ولا مسودة أبداً. يُستعمل `pages[]` (عقد B8-1) بلا تغيير في التخزين.
- **السماح:** `shipping-policy`، `privacy-policy`، `returns-policy`، `terms-of-service` فقط، صفحة `enabled=true` ومتن غير فارغ.
- **200:** `{data:{slug, locale, fallback, title, html}, meta:{request_id}}` مع `Cache-Control: no-store` و`X-Content-Type-Options: nosniff`.
- **404 موحَّد:** slug غير مسموح/معطَّل/غير منشور/فارغ/متجر غير مسجَّل ⇒ `{error:{code:"not_found", message:"الصفحة غير موجودة."}, meta}` مع `no-store`، بنفس الجسم في كل الحالات (لا تسريب لسبب الفشل). شكلٌ لا يطابق المسار أصلاً (فاصل مُرمَّز) يعيد 404 الإطار العام بلا بيانات.
- **اللغة (D-4b):** `?locale=ar|en` (غيرها تُتجاهل) ← لغة المتجر الافتراضية (`ar|en`) ← `ar` ← `en`؛ تُخدَم أول لغة بمتن غير فارغ، و`fallback=true` إن اختلفت عن المطلوبة. العنوان: عنوان اللغة وإلا عنوان الصفحة القديم (`title`).

## 2) الأمان وعزل المستأجر
- **طبقة 1:** `league/commonmark` بـ`html_input=strip` و`allow_unsafe_links=false` و`max_nesting_level=20`.
- **طبقة 2 (مرشّح DOM على الناتج):** قائمة سماح `h2–h4, p, ul, ol, li, strong, em, a, br, blockquote` (h1→h2، h5/h6→h4)؛ `script/style/iframe/svg/math/form/img/object/embed/…` تُحذف بمحتواها؛ ما عداها يُفكّ غلافه؛ التعليقات/CDATA/PI تُحذف؛ **كل السمات تسقط** عدا `a[href]` بمخطط `https|mailto|tel` بعد إزالة المحارف التحكمية/المسافات/الصفرية العرض، مع رفض `<>"'\`` ومسافات الطول > 2048، ويُفرض `rel="noopener nofollow ugc"`.
- **لا تسريب عام:** `store/v1/storefront` يحجب `pages[].content` (B8-1) — يُثبت اختبار أن النص يظهر في `/policies` ولا يظهر في `/storefront`.
- **عزل:** مستأجران، ومتجران لمستأجر واحد (الثاني لا يرى نص الأول)، وانتحال الترويسات/المعاملات، ومضيف غير مسجَّل.

## 3) الملفات
| الملف | التغيير |
|---|---|
| `app/Support/Commerce/PolicyMarkdownRenderer.php` | جديد: منقّي Markdown→HTML |
| `app/Http/Controllers/Api/StorefrontPolicyController.php` | جديد |
| `routes/api_storefront.php` | مسار `policies/{slug}` |
| `tests/Feature/StorefrontPublicPolicyApiTest.php` | جديد: 37 اختباراً |
| `docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` | B8-2 → In PR |
| `docs/plans/store/AWJ_B8_2_IMPLEMENTATION_REPORT.md` | هذا التقرير |

لا هجرة، لا تغيير في B8-1 (`StorefrontPresentationNormalizer` وfixtures الذهبية وسياسة النسخ)، لا مسار إدارة ولا محرر، لا تغيير في واجهة X4، لا أثر مالي/محاسبي.

## 4) الاختبارات (محلياً؛ CI في الـPR)
- `StorefrontPublicPolicyApiTest` (37، منها متن بلا محتوى مرئي بعد التنقية ⇒ لغة تالية ثم 404، بعد ملاحظة Codex P2): عقد 200/404 وشكل الاستجابة؛ منشور مقابل مسودة؛ معطَّل/مفقود/فارغ؛ لغات والبديل؛ سرّية الاستجابة العامة؛ العزل وانتحال الـHost؛ **28 حالة XSS** (script, img onerror, svg, iframe/srcdoc, javascript:/data:/vbscript:/file: بأشكال مموَّهة: حالة أحرف، كيانات عشرية/سداسية، tab/newline، روابط مرجعية/تلقائية، صور، تعليقات، CDATA، ترميز مزدوج…) على الطبقتين.
- PHP sqlite: مجموعات presentation/config/domain/golden/B8-1/PublicApi → **662 ناجحاً، 1 متخطى**.
- **PostgreSQL 16 حقيقي:** `StorefrontPublicPolicyApiTest` + `StorefrontPolicyContentTest` → 45 ناجحاً؛ presentation/config/domain-resolution → 364 ناجحاً.
- لا تراجع في اختبارات توافق B8-1.

## 5) مراجعة التبعيات
`league/commonmark` 2.10.4 مثبّتة أصلاً كتبعية انتقالية لـ`laravel/framework` (تُستعمل في `Str::markdown`)؛ لا حزمة جديدة ولا تعديل لـ`setup.sh`/`ci.yml` (لا `composer.json` في المستودع). خيارات الأمان مفعَّلة صراحةً في الكود، والمرشّح الثاني لا يعتمد على المكتبة.

## 6) مخاطر معلنة
- التبعية انتقالية: ترقية Laravel قد تغيّر إصدارها؛ يُوصى بتثبيتها صراحةً عند وجود مانيفست تبعيات.
- المرشّح يزيل الصور والجداول والكود (خيار محافظ)؛ إن لزمت لاحقاً فبقرار منفصل.
- `http:` مرفوض عمداً (يبقى نص الرابط بلا رابط).
- لا ذاكرة مؤقتة (no-store) وفق D-4i؛ يتحمل الحدّ `unauth` للـIP.
- النشر والتحقق البيئي لم يتما؛ لا شاشة تحرير (B8-3) فلا نص يُنتَج بعد من الواجهة.

## 7) الخطوة التالية
دمج بقرار المالك، ثم **B8-3** (محرر التاجر، إلزامي) و**X4** (تحويل `/policies/*` في المتجر إلى هذا الـAPI وإخفاء الروابط عند 404). X4 تبقى غير مكتملة حتى Deployed + Env-Verified.
