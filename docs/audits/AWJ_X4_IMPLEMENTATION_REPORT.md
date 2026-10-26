# AWJ X4 — صفحات سياسات المتجر العامة من AWJ بدل Spree (تقرير التنفيذ)

**Base:** `origin/main@2778ec3be85a8ee935ca8f7234c6b833d6694dcc` · **الفرع:** `claude/x4-awj-policy-pages` · **No Merge · No Deploy** · واجهة `storefront/` فقط (بلا تغيير في الخلفية أو الهجرات أو المحرر).

## 1) ما الذي تغيّر
- **مصدر البيانات:** `lib/data/policies.ts` صار يقرأ `GET store/v1/policies/{slug}` عبر `storefrontFetch()` (يمرّر `Host` الزائر الحقيقي؛ الخلفية تحسم المستأجر/المتجر). لا Spree، ولا `"use cache"` ولا حالة وحدة (مفتاح تخزين بلا المضيف كان سيخلط مستأجرين) — فقط `react.cache()` داخل الطلب الواحد لمشاركة الجلب بين الصفحة وmetadata.
- **التمييز بين 404 والعطل:** `null` = لا سياسة (مجهولة/معطَّلة/غير منشورة/فارغة ⇒ 404 حقيقي عبر `notFound()`). أي 5xx/429/401/شبكة/حمولة مشوّهة/HTML غير آمن ⇒ `PolicyUnavailableError` برسالة عامة ثابتة بلا تفاصيل داخلية. slug خارج الأربعة ⇒ `null` دون استدعاء API.
- **`generateMetadata`:** لا يرمي أبداً لعطل AWJ: عنوان «غير متاحة مؤقتاً» + `noindex`؛ ولـ404 عنوان «غير موجودة» + `noindex`. لا إعدادات Spree ولا markets.
- **العرض الآمن:** HTML الخلفية (منقّى) يُعاد التحقق منه في المتجر بقائمة سماح صارمة (`lib/policy/safe-html.ts`، بلا تبعية) — أي وسم/سمة/رابط خارجها ⇒ فشل مغلق (الصفحة «غير متاحة») لا تنظيف صامت. تطابق مع مخرجات `PolicyMarkdownRenderer` الحقيقية عبر fixture مولَّد منها.
- **اللغة:** يُمرَّر `locale` (ar|en) فقط؛ الخلفية تُرجع اللغة المخدومة و`fallback`. الصفحة تضبط `lang` و`dir` على **اللغة المخدومة** (نص إنجليزي بديل داخل صفحة عربية ⇒ LTR). التنسيق (`max-w-7xl`، `prose prose-gray`، عنوان h1) كما كان.
- **الروابط:** التذييل وقوائم التنقل المنشورة لا تربط إلا السياسات **المفعّلة** في الوثيقة المنشورة (`publishedPolicySlugs`، بلا استدعاء API لكل رابط)؛ قائمة فارغة ⇒ لا عمود «السياسات». التنقّل المخصص يُسقط هدف سياسة معطَّلة.
- **canonical:** رابط الصفحة نفسها (`/{country}/{locale}/policies/{slug}`)؛ أُزيلت hreflang لأنها كانت تُبنى من Spree markets ومن جلب كل لغة (slugs ثابتة).

## 2) الملفات
| الملف | التغيير |
|---|---|
| `storefront/src/lib/data/policies.ts` | إعادة كتابة: AWJ-native |
| `storefront/src/lib/policy/{slugs,safe-html}.ts` | جديد: slugs مشتركة + تحقق HTML |
| `storefront/src/app/[country]/[locale]/(storefront)/policies/[slug]/page.tsx` | صفحة + metadata |
| `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`، `components/layout/Footer.tsx` | تمرير/تصفية روابط التذييل |
| `storefront/src/lib/presentation/{public,navigation-resolve,public-navigation,public-footer}.ts` | `publishedPolicySlugs` وتصفية أهداف التنقل |
| `storefront/messages/*.json` | مفتاح `policies.policyUnavailable` |
| اختبارات: `policies.test.ts` (إعادة كتابة)، `page.test.tsx` (إعادة كتابة)، `safe-html.test.ts` + `backend-render.fixture.json`، `no-spree-env.test.ts` (كتلة «فجوة معروفة» ⇒ اختبارات إيجابية)، `Footer.test.tsx`، `navigation-resolve.test.ts`، `public.test.ts` | |
| `storefront/scripts/spree-ratchet/baseline.json` | خفض فعلي |
| `docs/.../TRACKER.md` + هذا التقرير | |

## 3) خط أساس X6 (خُفِّض لأن الأعداد انخفضت فعلاً)
`spree_value_imports 5→4` · `spree_type_imports 148→147` · `spree_client_access 69→68` · `spree_wrapper_imports 78→76` (إزالة `src/lib/data/policies.ts` من الفئات الأربع فقط؛ لا ارتفاع في أي ملف).

## 4) الاختبارات والنتائج (محلياً)
- **storefront vitest الكامل: 233 ملفاً / 3371 اختباراً ناجحاً** (16 ملفاً متخطى كما قبل). منها: سياسة منشورة تُعرض؛ 404 للمفقودة/غير المنشورة/الفارغة؛ metadata لا يرمي أخطاء Spree أو الإعداد؛ ar/en والبديل؛ محتوى خاص بكل مستأجر (مضيفان ⇒ عنوانان)؛ 503 مقابل 404؛ بيئة بلا Spree (إيجابي: `getPolicy` والصفحة وmetadata، ومراقبو Spree لا يُستدعون)؛ سلوك روابط التذييل/التنقل؛ مخرجات الخلفية الحقيقية تمرّ قائمة السماح؛ حمولة XSS تُرفض.
- `tsc --noEmit`: نظيف. `biome ci`/`lint`: بلا أخطاء (تحذيرات قديمة). `check:spree-ratchet`: ناجح. `next build`: نجح (exit 0).
- لم تُمَسّ الخلفية؛ اختبارات B8 الخلفية سبق أن نجحت (PostgreSQL وsqlite) في PRs سابقة.

## 5) المخاطر والفجوات
- **إشارة «له محتوى» غير متاحة للعامة:** اللقطة العامة لا تحمل نص السياسة، فالرابط يعتمد على `pages[].enabled` فقط، والافتراضي «مفعّلة» للسياسات الأربع؛ سياسة مفعّلة لم تُكتب بعد تُربط وتُعيد 404 (المحرر يحذّر التاجر من هذه الحالة). الحل الكامل يحتاج حقلاً منطقياً عاماً `has_content` في `store/v1/storefront` (تعديل خلفية صغير — مقترح لشريحة منفصلة؛ خارج نطاق هذا الطلب).
- **روابط خارج التذييل والتنقل:** تذييل صفحات الدفع (`(checkout)/layout.tsx`) وموافقة الشروط (`PolicyConsent`) وصفحة الحساب ما زالت تربط بالقائمة الثابتة؛ لم تُعدَّل لأنها ضمن مسار الدفع/التسجيل (خارج النطاق) — الرابط يفتح صفحة 404 صادقة بدل خطأ Spree.
- لا ذاكرة مؤقتة: كل عرض صفحة يستدعي الخلفية مرة (الحد `unauth` المشترك 30/دقيقة لكل IP للخادم) — مقبول لصفحات قانونية قليلة الزيارة؛ التخزين المؤقت الآمن يتطلب مفتاحاً بالمضيف وقراراً منفصلاً (D-4i: `no-store` مبدئياً).
- أُزيلت hreflang لصفحات السياسات (كانت تعتمد Spree markets).
- لم يُنشر ولم يُتحقق بيئياً؛ X4 لا تُعدّ مكتملة قبل Merge + Deploy + Env-Verified.

## 6) الخطوة التالية
دمج بقرار المالك، ثم نشر والتحقق على المضيف الحي (ENV0)، ثم شريحة صغيرة للخلفية: `has_content` في اللقطة العامة لإخفاء روابط السياسات الفارغة بدقة.
