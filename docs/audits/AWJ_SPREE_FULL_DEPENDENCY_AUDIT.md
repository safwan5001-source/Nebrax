# AWJ Storefront — تدقيق شامل لاعتماديات Spree

**الحالة:** تدقيق للقراءة فقط — لا تنفيذ ولا دمج ولا نشر
**التاريخ:** 2026-10-25

> **تحديث الحالة (بعد الدمج):** هذا التدقيق يصف `main@0ea1658` (الأساس المُدقَّق، دون تعديل نتائجه). X1 وX2 **نُفِّذتا ودُمجتا في PR #1744** (`main@cc9ebf2c0f06b22f39c90b63a798ebb06980a2e7`): `ACCOUNT_AUTH_CAPABILITY="gated"`، منع تمرير نصوص الأخطاء (قائمة رموز `account-errors.ts` بعد المراجعة الأمنية)، نظافة `.env.example`/الوثائق/README. تفاصيل التنفيذ والاختبارات: `docs/audits/AWJ_SPREE_X1_X2_IMPLEMENTATION_REPORT.md` (على `main`). «مدموج» ≠ «منشور» ≠ «مُتحقَّق بيئياً»: نشر X1/X2 غير معروف ولم يُتحقَّق منه بيئياً. أثر ذلك على النتائج أدناه: **R-01** (حساب المشتري) صار مُغلقاً بصدق (gated) لا مكسوراً؛ **R-02** (قيم Spree الوهمية) أُزيلت من `.env.example` والوثائق لكن **تنظيف البيئات المنشورة يدوي ولم يُتحقَّق منه**؛ **R-03/R-04** (`/policies/*` وsitemap) و**R-05…R-13** و**N-01…N-12** و**الصفوف F01–F84** كما هي دون تغيير ما عدا F70/F72 (Spree-dependent ⇒ مُغلقتان gated). عدّادات الاستيراد (5 قيمة / 68 سطر استدعاء / 109 استيراد) تعود لمراجعة الأساس ولم تُعاد حسابها بعد X1/X2.
**المستودع:** `safwan5001-source/Nebrax` · الفرع المُدقَّق: `main` عند `0ea1658da61ed730ab695dc89d912492f622aa1d` (`2026-10-25T15:23:01+03:00`، «PAY-SETTINGS-UX-2 (#1741)»)
**فرع العمل:** `claude/new-session-h5e2oe` (نفس SHA، شجرة العمل نظيفة قبل إنشاء هذه الملفات)
**المرجع المرافق:** خطة الخروج `docs/plans/store/AWJ_SPREE_EXIT_MIGRATION_PLAN.md` · الملخّص `docs/audits/AWJ_SPREE_AUDIT_HANDOFF.md`

---

## 0. الحكم التنفيذي

1. **ما ظهر في صفحة التسجيل ليس عطلاً معزولاً بل نتيجة بنيوية.** مسار حساب المشتري كاملاً (تسجيل، دخول، خروج، مزامنة الجلسة، تحديث الملف، نسيان/إعادة كلمة المرور) ما زال يمرّ بعميل `@spree/sdk` عبر `getClient()`، ولا يوجد أي backend لـSpree في أي مكان. كل إرسال نموذج من هذه النماذج يفشل ما لم تُضبط `SPREE_API_URL` و`SPREE_PUBLISHABLE_KEY`، **والخطأ الخام يُعرض للمشتري** كما هو (§5.1).
2. **الاستبدال المباشر غير ممكن اليوم لأن العقد الخلفي غير موجود.** `store/v1` في Laravel مجهول الهوية بالتصميم (ADR-24). لا يوجد تسجيل/دخول/جلسة/ملف/طلبات/عناوين لمشتري الويب. أقرب ما يوجد (`commerce/v1` للجوال، و`customer/v1/{tenantSlug}`) لا يصله خادم المتجر كما هو، وتسجيله يعيد `202` بلا توكن، والدخول يشترط `email_verified_at` بينما **لا يوجد مسار تسليم للتحقق ولا لإعادة كلمة المرور** (§6). حتى لو وُجّه المتجر إلى AWJ اليوم لما استطاع مشترٍ جديد الدخول.
3. **حجم الاعتماد الحقيقي أصغر مما يبدو.** من 196 ملفاً يرد فيها اسم Spree: **5 استيرادات قيمة (runtime) فقط** في كود التطبيق (`createClient` ×1، `SpreeError` ×3، `verifyWebhookSignature` ×1)، و**68 سطر استدعاء** لعميل Spree في **16 ملفاً**، والباقي (86 استيراداً) **أنواع فقط** تُمحى عند البناء. سلة DTC وCheckout DTC والدفع الإلكتروني DTC والكتالوج **كلها AWJ أصلاً**.
4. **المتأثّر فعلاً بالإنتاج (مؤكَّد بقراءة الكود):** حساب المشتري (R1)، صفحات السياسات `/policies/*` (R2، 500 لا 404)، `sitemap.xml` (R2، يعود فارغاً بصمت)، ثم مسار Spree للـCheckout/الدفع/الجملة (R3/R4) الذي لا يصله زائر DTC إلا برابط مباشر أو بتفعيل بوابة الجملة.
5. **خطر أمني موثَّق في تعليمات التشغيل:** وثيقة النشر الأولى تقول «Placeholder values are fine» لـ`SPREE_API_URL/SPREE_PUBLISHABLE_KEY`، و`.env.example` يضع `SPREE_API_URL=http://localhost:8000` (وهو عنوان Laravel التطويري). ضبط قيمة بديلة **يخفي العيب ولا يعالجه** بل **يرسل بريد وكلمة مرور المشتري إلى المضيف المضبوط** (§7، R-02).
6. **التوصية:** لا تُضبط متغيرات Spree، ولا يُنشأ Rails. الخطة: (أ) بوّابة صادقة لحساب المشتري فوراً (PR صغير، لا يلمس الخلفية)، (ب) قرارات المالك الخمسة، (ج) عقد هوية مشتري `store/v1` في Laravel، (د) نقل المتجر إليه، (هـ) حذف Spree على مراحل بعد ترحيل كل استيراد قيمة ونوع. التفصيل في خطة الخروج.

7. **التغطية الوظيفية الشاملة (الملحق ج):** من 84 وظيفة مفحوصة عبر دورة الشراء كاملة، **لا تُفقد قدرة تعمل اليوم** بحذف Spree؛ لكن 29 وظيفة **Missing** و15 **Partially** مستقلة عن Spree (أبرزها: لا واجهة موظف لقراءة طلبات الويب، لا إلغاء/شحن/تتبع/إرجاع/استرداد للطلب، لا مستند مالي لطلبات COD، ولا قناة بريد للمشتري بعد حذف مسار Spree اليتيم). الخطة محدَّثة لتغطيتها (الملحق ب في خطة الخروج).

> **ما لم يُتحقق منه:** لم يُشغَّل أي شيء ولم يُلمس نشرٌ حيّ. التسلسلات أدناه مبنية على قراءة الكود (علامة **[V]**) أو استنتاج منه (**[I]**) أو غير معروف (**[U]**)؛ وما نقله وكلاء فرعيون ولم أعد فتحه بنفسي معلَّم **[A]**.

---

## 1. خط الأساس (Workstream A)

| البند | القيمة | الحالة |
|---|---|---|
| الفرع/SHA | `main` = `origin/main` = `0ea1658da61ed730ab695dc89d912492f622aa1d` | [V] |
| فرع العمل | `claude/new-session-h5e2oe` على نفس SHA | [V] |
| حالة الشجرة | نظيفة قبل الملفات الثلاثة؛ لا تعديل على أي ملف مُتتبَّع | [V] |
| PR مفتوحة | 22 (مرجع `list_pull_requests`). **لا واحدة** تمسّ حساب المشتري أو Spree أو `storefront/src/lib/data`. الأقرب: #1523 (availability policy، docs)، #1089 (theme publish)، #853 (Customizer، docs)، #1531 (comms dispatcher — **ذات صلة بخطة التحقق/الاستعادة**، §6) | [V] |
| المراجعة المنشورة فعلياً | **غير معروفة.** لا وصول إلى Vercel/Railway ولا إلى `dominah-zhor-tyb.store.awjdev.xyz`. لا يمكن حساب drift | [U] |
| أي مضيف يخدم المتجر | Vercel (`vercel.json` + `AWJ_STOREFRONT_FIRST_PREVIEW_DEPLOYMENT_REPORT.md`) أم Docker/Railway (`storefront/Dockerfile:3`)؟ | [U] |
| قيم المتغيرات الحيّة | غير معروفة؛ لا يُظنّ شيء من غياب أثر الخطأ | [U] |

### 1.1 قرارات/وثائق قُرئت وتُحكم الخطة
- `docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md` (2026-09-11): Spree = أساس واجهة فقط، «نحتفظ ونكيّف» الواجهة، AWJ سلطة البيانات والهوية؛ **لا يستورد قواعد Spree الحالة/الدفع**.
- `storefront/NOTICE` + `LICENSE`: مرجع MIT محفوظ؛ «Spree Rails backend is not used or included».
- `docs/plans/store/ADR-24-STOREFRONT-ACCOUNT-GIFTING-ORDER-VIEW.md` (سطرا 11 و35): `store/v1` مجهول الهوية؛ ميزات الحساب `design_only` حتى «storefront customer-identity contract (outside Horizon 1)».
- `storefront/src/lib/commerce/capabilities.ts`: `ACCOUNT_ORDER_HISTORY/LOOKUP/STATUS`، `ACCOUNT_ADDRESSES`، `ACCOUNT_SAVED_PAYMENT_METHODS`، `WISHLIST`، `COUPON` = `design_only`؛ `PAYMENT` = `gated`؛ **لا يوجد ثابت قدرة لـ«هوية/تسجيل/دخول»** — وهذه هي الفجوة التي تُنتج الواجهة المكسورة غير الموسومة.
- `docs/plans/customers/CUS-ARCH-0…` و`CUS-COM-GATE-1…` و`COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`: التحقق واسترجاع كلمة المرور «قنوات مفتوحة / معطّلة عمداً».
- لم أجد وثيقة تقرّر **آلية جلسة مشتري الويب**. [V — بحث نصي + تقرير الوكيل]

### 1.2 خريطة المتغيرات (أسماء فقط)
| الفئة | الأسماء | أين تُقرأ |
|---|---|---|
| Spree (6) | `SPREE_API_URL`, `SPREE_PUBLISHABLE_KEY`, `SPREE_IMAGES_URL`, `SPREE_WHOLESALE_CHANNEL`, `SPREE_WHOLESALE_PUBLISHABLE_KEY`, `SPREE_WEBHOOK_SECRET` | `src/lib/spree/config.ts:27-28,63,97` · `next.config.ts:21` · `src/components/layout/DocumentShell.tsx:28-29` · `src/app/api/webhooks/spree/route.ts:12` |
| AWJ | `AWJ_COMMERCE_API_URL`, `STOREFRONT_GATEWAY_SECRET`, `AWJ_STOREFRONT_DEV_HOST` (غير إنتاجي), عائلة `STOREFRONT_MEDIA_PROXY_*` | `src/lib/commerce/config.ts:24,56,88` |
| دفع عميل (Spree-checkout فقط) | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_ADYEN_CLIENT_KEY`, `NEXT_PUBLIC_ADYEN_ENVIRONMENT` | `src/lib/utils/stripe.ts:3`, `payment-gateway.ts:64-79` [A] |
| عام | `NEXT_PUBLIC_{SITE_URL,DEFAULT_COUNTRY,DEFAULT_LOCALE,STORE_NAME,STORE_DESCRIPTION,SENTRY_*}`, `STORE_*`, `EMAIL_FROM`, `RESEND_API_KEY`, `GTM_ID`, `SENTRY_*` | `src/lib/store.ts` وغيره [A] |

مفتاح مهم: لا يوجد أي `SPREE_*` في أي workflow جذري ولا في `vercel.json` ولا في Dockerfile، فالعيب يتكرر في **كل** بيئة منشورة ما لم يضبطها المشغّل يدوياً. [V/A]

---

## 2. الرسم المعماري (الوضع الحالي)

```
Browser (RTL, ar/en)  ─────────────────────────────────────────────────────────
   │  Server Actions / RSC
   ▼
Next.js storefront (storefront/)  — proxy.ts (locale cookies spree_country/spree_locale)
   │
   ├── AWJ-native  ─────────────────────────────►  Laravel store/v1  (Host-resolved, gateway secret)
   │     catalog (products/categories/offers/collections/media)         ✓ anonymous
   │     cart  (awj_cart_token cookie)                                  ✓ guest only
   │     checkout + payment-intent + payment-status                     ✓ guest only
   │     market = static (markets.ts staticAwjMarket)                   ✓ no network
   │
   └── Spree-SDK  ──── lib/spree/config.ts ─ createClient(SPREE_API_URL) ─►  ✗ لا backend موجود
         R1 account: login/register/logout/refresh/profile/pw-reset/session (customer.ts)
         R2 policies (/policies/*) · sitemap (/sitemap/*.xml)
         R3 Spree cart+checkout+payment+orders+addresses+cards (wholesale + direct URL)
         R4 wholesale portal (opt-in SPREE_WHOLESALE_CHANNEL)
         webhook /api/webhooks/spree (SPREE_WEBHOOK_SECRET → email handlers)
         Types only: 86 src files import Spree *types* as UI view-models
```

**ما لا يوجد في `store/v1`** (مؤكد بقراءة `routes/api_storefront.php` كاملاً): أي `auth/*` أو `me` أو `account/*` أو `orders` للمشتري أو `policies` أو `countries` أو `markets` أو كوبونات أو بطاقات هدايا.

---

## 3. الأرقام وطريقة إعادة الإنتاج

| المقياس | القيمة | الأمر |
|---|---|---|
| ملفات تذكر «spree» (بلا `node_modules`/القفل) داخل `storefront/` | **196** | `rg -il spree --glob '!node_modules' --glob '!pnpm-lock.yaml' storefront` |
| عبارات استيراد `@spree/*` | **109** في **104** ملف | `سكربت الملحق B` (انظر §9) |
| منها: src نوع فقط / src قيمة / dev-pages / اختبارات | 86 / **5** / 4 / 14 (منها 1 قيمة) | نفسه |
| الاستيرادات القيمة (runtime) | `createClient` (`config.ts:1,16,100`) · `SpreeError` (`auth-helpers.ts:2`, `checkout.ts:4`, `policies.ts:3`) · `verifyWebhookSignature` (`webhooks.ts:2`) | |
| أسطر استدعاء عميل Spree | **68** (64 استدعاء + 4 تعريفات) في **16** ملفاً | `rg -n "getClient\(|getClientForSurface\(|withAuthRefresh\(" storefront/src --glob '!**/*.test.*' --glob '!**/__tests__/**'` |
| مستوردو `@/lib/spree` (كود) | 25 ملفاً (+ 20 اختباراً) | `rg -l 'from "@/lib/spree' …` |
| أعلى الرموز المستوردة نوعاً | Product 24 · Cart 19 · Category 14 · Country 12 · Order 8 · Address 8 · AddressParams 8 · ProductFiltersResponse 7 · Market 7 · State 6 · Media 6 | نتيجة السكربت |
| اختبارات الوحدة | 236 ملف اختبار؛ 44 تذكر Spree، **34 مقترنة فعلاً** (18 تُحاكي `@/lib/spree`/`@spree/sdk`) | [A] |
| كوكيز بتسمية Spree | `_spree_jwt` (4 ملفات) · `_spree_refresh_token` (3) · `_spree_cart_token` (3) · `_spree_wholesale_cart_token` (1) · `spree_country` (6) · `spree_locale` (6) | `rg -l -i -F -e <name>` |

كل سطر ومسار في **الملحق** (§10): A1 مواضع الاستدعاء، A2 الاستيرادات، A3 الرموز، A4 الاختبارات.

---

## 4. مصفوفة التجميعات (ملخّص `path:line` — التفصيل في الملحق)

الأعمدة: التصنيف (runtime مؤكَّد / type / UI / test / config / dead / optional) · هل يصل الإنتاج · الـbackend المستدعى · سلطة البيانات · عاقبة حذف SDK/المتغيّر · بديل AWJ · التعقيد.

| # | العنقود | الملفات الأساسية (`path:line`) | تصنيف | الوصول والشرط | Backend فعلي | عاقبة الحذف | بديل AWJ | تعقيد |
|---|---|---|---|---|---|---|---|---|
| C1 | **حساب المشتري** | `src/lib/data/customer.ts:31,47,135,171,189,217,233,257` · `src/lib/spree/auth-helpers.ts:150` · `src/contexts/AuthContext.tsx:126,147` · `components/account/AccountSignIn.tsx:41` · `account/register/page.tsx:72` | runtime مؤكَّد | كل زائر يُرسل نموذجاً؛ `AuthProvider` يعمل على كل صفحة لكنه لا يستدعي العميل بلا توكن [V] | Spree (غير موجود) → خطأ | تسجيل/دخول/خروج/نسيان/ملف تتعطل (متعطلة أصلاً) | **مفقود** (`store/v1` لا يملك هوية؛ §6) | L (خلفية+واجهة) |
| C2 | **جلسة/كوكيز** | `src/lib/spree/cookies.ts:6-8,18,42-54` · `src/lib/spree/middleware.ts:12-15,182-186` · `src/app/.../account/(authenticated)/layout.tsx:36` · `src/lib/data/cookies.ts` | runtime | الحارس يتحقق من **وجود اسم الكوكي** فقط؛ لا تحقق خادم [V] | — | مسار الحماية يسقط ما لم يُستبدل | جلسة AWJ (قرار D-1) | M |
| C3 | **سلة DTC** | `src/lib/data/cart.ts:55-97` (`getAwjCart/addAwjItem/…`) · `src/lib/commerce/cart.ts` · `contexts/CartContext.tsx:99,129-168` | AWJ-native | DTC دائماً (`surface="dtc"` افتراضي) [V] | Laravel `store/v1` | لا شيء | موجود | — |
| C4 | **سلة Spree** | `src/lib/data/cart.ts:132-320` (`getCart/getOrCreateCart/addToCart/…`) · `src/lib/spree/cookies.ts:171-200` | runtime، اختياري | فقط `CartProvider surface="wholesale"`؛ `getOrCreateCart/associateCartWithUser/clearCart` بلا مستدعٍ خارجي (ميتة جزئياً) [V] | Spree | لا أثر على DTC | غير مطلوب إن حُذفت الجملة | M |
| C5 | **Checkout/دفع DTC** | `data/awj-checkout.ts` · `commerce/checkout*.ts` · `components/checkout/Awj*`, `awj/*` · `(store-checkout)/…` | AWJ-native | `/checkout` و`/checkout/payment-return` | Laravel | لا شيء | موجود | — |
| C6 | **Checkout/دفع Spree** | `data/checkout.ts:130-255` · `data/payment.ts:37-228` · `data/orders.ts:17,51` · `data/express-checkout-flow.ts` · `app/…/(checkout)/{checkout/[id],confirm-payment/[id],order-placed/[id]}` · `components/checkout/{PaymentSection,ExpressCheckoutButton,StripePaymentForm,AdyenPaymentForm}.tsx` | runtime، وصول غير موصول | **غير مغلق بشرط**: المسارات تُفتح بالرابط المباشر حتى مع تعطيل الجملة؛ تُربط من `WholesaleCartView.tsx:198` و`CartDrawer.tsx:283` (فرع Spree) [V] | Spree | لا أثر على DTC | لا شيء مطلوب (DTC لديه Checkout AWJ) | L (حذف) |
| C7 | **دفتر عناوين/دول/بطاقات/هدايا Spree** | `data/addresses.ts:11-53` · `data/countries.ts:8,18` · `data/credit-cards.ts:12,22` · `data/gift-cards.ts` | بعضها ميت | `addresses/countries/credit-cards`: من C6 فقط؛ `gift-cards.ts`: **بلا مستورد** [V]؛ مكوّنات `AddressManagement/CreditCardList/GiftCardList/OrderList/OrderDetail`: **بلا مستورد** (ميتة) [V] | Spree | لا أثر | مفقود (ADR: `design_only`) | S (حذف) |
| C8 | **سياسات** | `data/policies.ts:15` · `app/…/policies/[slug]/page.tsx:23,83` · روابط: `PolicyConsent.tsx:48`, `Footer.tsx:412`, `(checkout)/layout.tsx:63` | runtime مؤكَّد | `/policies/*` تفشل 500 (Error عام لا `SpreeError`)؛ مرتبطة من نموذج التسجيل والتذييل [V-قراءة] | Spree | صفحات قانونية غير متاحة | **مفقود** (لا endpoint للسياسات) | M |
| C9 | **Sitemap** | `data/sitemap.ts:27,41,42,58,74` · `app/sitemap.ts:105-114,134-139` · `app/robots.ts` | runtime مؤكَّد | `getClient()` يرمي → يُلتقط → خريطة **فارغة بصمت** [V] | Spree | SEO | `store/v1/products|categories` موجودان؛ ترقيم الصفحات غير مُتحقَّق [U] | M |
| C10 | **أسواق/دول** | `data/markets.ts:66,76` (`resolveMarket/getMarketCountries`) | runtime، C6 فقط | `getMarkets()` ثابت AWJ ولا يمس Spree؛ المباشرة فقط من checkout/[id] | Spree | لا أثر | سوق ثابت موجود | S |
| C11 | **الجملة (Wholesale)** | `src/lib/data/wholesale.ts:87,141` · `app/…/(wholesale)/wholesale/**` · `components/home/WholesaleSection.tsx` · `Header.tsx:138,183` · `Footer.tsx:254` | اختياري/غير فعّال | مغلق (404) بغياب `SPREE_WHOLESALE_CHANNEL`؛ **متناقض داخلياً**: الكتالوج من AWJ (`data/products.ts` يتجاهل `surface`) بينما السلة/الدخول من Spree [V] | Spree + AWJ | لا أثر على DTC | غير موجود (لا مفهوم جملة في AWJ) | قرار D-3 |
| C12 | **Webhook** | `src/app/api/webhooks/spree/route.ts:12` · `src/lib/spree/webhooks.ts:2,75` · `src/lib/webhooks/handlers.ts` · `lib/emails/*` | تهيئة/اختياري | يُرجع 503 بغياب `SPREE_WEBHOOK_SECRET`؛ HMAC عند وجوده [V]. معطَّل حسب `.env.example:64` | — | لا أثر | بريد المعاملات من Laravel (PR #1531) | S |
| C13 | **أنواع SDK كنماذج عرض** | 86 استيراداً نوعياً (الملحق A2)؛ `src/lib/commerce/types.ts:113,127` (`StoreCategory/StoreProduct = Spree type & {…}`) · `commerce/mappers.ts:1-8` | type | بناء فقط | — | فشل `tsc` عند الحذف | أنواع AWJ مملوكة (T1) | L (آلي) |
| C14 | **UI موروثة** | `Header/Footer/…` (Spree-style) | UI inheritance | يُحتفظ | — | — | مسموح بـMIT | — |
| C15 | **اختبارات** | 34 ملفاً مقترناً (الملحق A4) | test | CI الجذري `storefront-ci.yml` يشغّل vitest | — | تفشل عند الحذف | تُحوَّل إلى fixtures AWJ | M |
| C16 | **e2e/CI/نشر** | `package.json:21-22,29,91` · `scripts/e2e/bootstrap-spree.sh` · `e2e/checkout.spec.ts:10` · `storefront/.github/workflows/ci.yml` (متداخل، **لا يعمل**) · `next.config.ts:9-36,44,70-73` · `DocumentShell.tsx:28` | config/test | **`storefront/e2e-backend/` غير موجود**؛ `e2e:up`/`e2e:down` مكسوران؛ لا workflow جذري يشغّل e2e مرتبطاً بـSpree [V] | — | — | fixtures AWJ موجودة (`store-brand-api-fixture.mjs`, `payment-return-api-fixture.mjs`) | M |
| C17 | **حزم دفع Spree-checkout** | `package.json:27,31,32` (`@adyen/adyen-web`, `@paypal/react-paypal-js`, `@stripe/*`) | config | تُستعمل في C6 فقط | — | — | الدفع AWJ استضافة مزوّد (PAY-H4-05) | S |
| C18 | **نصوص/علامة** | `messages/*.json` (`footer.description`, `footer.learnMore`, `footer.copyright`, `home.heroDescription` — لم أجد مستهلكاً في المكوّنات [V])، `public/spree.png` (`(checkout)/layout.tsx:29`)، `lib/store.ts` fallback "Spree Store"، `README.md` (README أصلي لـSpree) | docs/UI | — | — | — | — | S |

---

## 5. تسلسلات الاستدعاء (Workstream C)

### 5.1 خطأ التسجيل — التتبّع الدقيق [V]

```
account/register/page.tsx:72   register({email,password,…})            ← useAuth()
 → contexts/AuthContext.tsx:147  registerAction(params)                  ← "use server"
 → lib/data/customer.ts:171      getClient().customers.create(params)
 → lib/spree/config.ts:25-34     getClient():
        _client == null → process.env.SPREE_API_URL / SPREE_PUBLISHABLE_KEY غير مضبوطين
        → throw new Error("Spree client is not configured. Either call initSpreeNext() or set SPREE_API_URL and SPREE_PUBLISHABLE_KEY environment variables.")
 → customer.ts:174-178           catch → { success:false, error: error.message }   ← الرسالة الداخلية تُمرَّر كما هي
 → AuthContext.tsx:147-153       يعيد النتيجة
 → register/page.tsx:82          setError(result.error || t("registrationFailed"))  ← يظهر للمشتري في <Alert>
```
سبب ظهور الرسالة للمشتري: `customer.ts` يلتقط `Error` ويعيد `error.message` دون تصنيف أو تنقية. نفس النمط في `login` (`customer.ts:138-143`→`AccountSignIn.tsx:45`) و`resetPassword` (`customer.ts:239-244`).
**لماذا لا يظهر الخطأ عند التحميل:** `AuthProvider` يستدعي `syncSession()` عند الإقلاع، لكن `ensureFreshSession()` يعود `"anonymous"` قبل أي عميل حين لا كوكي (`auth-helpers.ts:104-109`)، و`getCustomer()` يعود `null` بلا توكن (`customer.ts:65-66`) — فالعطل لا يظهر إلا عند الإرسال.

### 5.2 مسارات الحساب الأخرى بنفس نمط الفشل
| المسار | الدالة | السطر | سلوك الفشل |
|---|---|---|---|
| دخول | `login` | `customer.ts:135` | رسالة خام للمستخدم |
| خروج | `logout` | `customer.ts:189` | يُبتلع الخطأ (`catch` فارغ) ثم تُمسح الكوكيز — **لكن لا يمسح كوكي سلة AWJ** `awj_cart_token` (§7 R-08) |
| نسيان كلمة المرور | `requestPasswordReset` | `customer.ts:217` | يرمي؛ الصفحة تلتقط وتعرض `genericError` (`forgot-password/page.tsx:38,41`) |
| إعادة تعيين | `resetPassword` | `customer.ts:233` | رسالة خام |
| تحديث الملف/البريد | `updateCustomer` | `customer.ts:257` (عبر `withAuthRefresh`) | يحتاج جلسة؛ لا تصل لأحد فعلياً |
| تجديد التوكن | `tryRefresh` | `auth-helpers.ts:150` | غير قابل للوصول بلا توكن |
| ربط سلة الضيف بعد الدخول | `finalizeAuth` | `customer.ts:43-55` | يقرأ كوكي سلة **Spree** فقط؛ سلة AWJ **لا** تُدمج أبداً |

### 5.3 السلتان (AWJ مقابل Spree)
- `CartProvider` (الجذر `[locale]/layout.tsx`) يستعمل `surface="dtc"` افتراضياً ⇒ **AWJ دائماً** لجميع صفحات المتجر (`CartContext.tsx:99,129-168`). دوال Spree (`getCart`, `addToCart`, `updateCartItem`, `removeCartItem`) لا تُستدعى إلا من `CartProvider surface="wholesale"` داخل `WholesaleGate`.
- **الخلط العرضي ممكن فقط عبر:** (أ) فرع `CartDrawer.tsx:282-283` (يربط `/checkout/${spreeCart?.id}` عند سلة غير AWJ)؛ (ب) الرابط المباشر إلى `/checkout/[id]`، `/confirm-payment/[id]`، `/order-placed/[id]` (غير مغلقة بـ`isWholesaleEnabled()`)؛ (ج) `getCheckoutOrder` الذي يجرّب `getCart()` ثم `getOrder()`. لا تقاطع كوكيز: الأسماء مختلفة (`awj_cart_token` ↔ `_spree_cart_token`).
- **التخزين المؤقت:** `"use cache: remote"` ما زال في `policies.ts:11`, `sitemap.ts:24,35,55,71`, `markets.ts:63,73`, `countries.ts:15`, `CategoryBanner.tsx:62`. مفاتيحها لا تُشفِّر المضيف/المستأجر. وثيقة `data/products.ts:24-35` تشرح أن كاتالوج AWJ **تجنّب عمداً** `use cache: remote` حتى يُشفَّر سياق المتجر في المفتاح. **أي ترحيل لـpolicies/sitemap/countries إلى AWJ يجب ألا يرث هذا التخزين المؤقت** وإلا تسرّب محتوى مستأجر لآخر (§7 R-05).

### 5.4 Checkout/الدفع/الطلبات — افتراضات غير آمنة في بقايا Spree (للتوثيق، لا تعديل) [V]
- `data/payment.ts:121-148` `completeCheckoutOrder` (الشرط عند `:138`): **يعامل 403 و422 كنجاح** («cart already completed»/«state_lock_version conflict») ويعيد `{success:true, order: completedOrder|null}`.
- `data/payment.ts:161,190-193` `confirmPaymentAndCompleteCart`: إن لم تُوجد السلة يعيد `success:true` بطلب `null`.
- `data/checkout.ts:182-235` `applyCode` (الشرط عند `:197`): يعتمد 422/404 كإشارة «ليس كود خصم» ثم يجرّب بطاقة هدية.
- هذه القواعد **ممنوع نقلها** إلى AWJ. عقد AWJ: `checkout/complete` يتطلب `Idempotency-Key` والمراجعة `review_required` (409) بتراجع كامل، ومسار الدفع الإلكتروني يقرأ الحقيقة من `payment-status` لا من عودة المتصفح. ما سبق لا يصل زائر DTC (C6).

### 5.5 عزل المستأجر/النطاق
- سلطة المستأجر في الإنتاج = `Host` (`ResolveStorefrontDomain`) + سر البوابة `X-Storefront-Gateway-Secret` + `X-Storefront-Forwarded-Host`؛ المتجر هو المستدعي الوحيد لـ`store/v1` (`commerce/config.ts:88`). الإنتاج لا يقرأ `AWJ_STOREFRONT_DEV_HOST`. [V]
- طبقة Spree **لا تعرف المضيف أصلاً**: عميل وحيد عام على مستوى العملية (`_client` في `config.ts:5`) — لو ضُبط لخادم واحد لخدم **كل المستأجرين** (نفس البيانات والمفاتيح) ⇒ غير صالح لبيئة متعددة المستأجرين. [V]
- حارس مسار الحساب (`middleware.ts:182-186`, `account/(authenticated)/layout.tsx:36`) يعتمد **وجود الكوكي** فقط؛ كوكي مفتعل `_spree_jwt=x` يفتح قشرة صفحات الحساب (التي لا تحمل بيانات اليوم لأنها `design_only`). عند الاستبدال يجب أن يتحقق الخادم من الجلسة. [I]

### 5.6 هل يعمل Spree/Rails في أي مكان؟
- المستودع لا يحوي Rails ولا docker-compose له (`storefront/e2e-backend/` غير موجود، لا تاريخ git له) [V].
- `NOTICE` و`Dockerfile:5-7` و`.env.example:3-4` تقول: لا Spree في الإنتاج [V].
- لا يوجد أي workflow ينشر أو يشغّل Spree [V/A].
- **تشغيل حي (خارج المستودع): غير معروف.** [U]
- نتيجة: الواجهة تعتمد على SDK **غير مضبوط** لا على خدمة حيّة.

### 5.7 ما يمكن الاحتفاظ به من الفورك MIT
- **يُحفظ قانونياً:** `storefront/LICENSE` (Vendo Connect Inc./Vendo Sp. z o.o.) و`NOTICE` يبقيان حرفياً، ونص ترخيص MIT يتيح تعديل الكود وإعادة توزيعه بشرط إبقاء الإشعار.
- **يُحفظ تقنياً:** بنية الصفحات، المكوّنات، Tailwind/shadcn، next-intl، RTL، الشبكات، البطاقات — فهي لا تعتمد وقت التشغيل على Spree.
- **ما يُستبدل:** طبقة الوصول (`lib/spree`, `lib/data/*` Spree-bound) وأنواع الواجهة المقترضة. **الهجرة التشغيلية ≠ إعادة كتابة الواجهة** (المقدار: ~16 ملف بيانات + ~5 استيراد قيمة، لا مئات المكوّنات).
- تعديلات المحتوى: README والنصوص (`footer.copyright` «Powered by Spree Commerce») تُحدَّث؛ لا يلزم إخفاء الأصل في LICENSE/NOTICE.

---

## 6. عقود AWJ المتاحة مقابل المفقودة [V مسارات / A تفاصيل]

| قدرة Spree | AWJ اليوم | يصلها خادم المتجر (Host + سر البوابة)؟ | الناقص |
|---|---|---|---|
| تسجيل | `commerce/v1 POST auth/register` · `customer/v1/{tenantSlug}/auth/register` → **202 بلا توكن** (`CommerceCustomerAuthController.php` docblock 32-34؛ `:51`) | **لا** (الأول: ApiClient bearer + قناة mobile؛ الثاني: slug لا Host) | `store/v1` تسجيل |
| دخول | نفس السطحين؛ يشترط `email_verified_at` (`CustomerAuthenticationService.php:36`) | لا | `store/v1` دخول + **مسار تحقق** |
| تجديد/جلسة | توكن Sanctum 7 أيام (`TOKEN_TTL_DAYS=7`, السطر 13)؛ لا refresh | لا | سياسة جلسة/تجديد |
| تحقق البريد | لا تسليم للعملاء (`email/verify` للموظفين فقط) | — | **قناة تحقق** (قرار D-2) |
| نسيان/إعادة كلمة المرور | لا للعملاء (`CUS-ARCH-0` مفتوح) | — | كامل |
| OTP هاتف | `FakeOtpProvider` (يسجّل فقط) | — | مزوّد حقيقي |
| ملف/تغيير كلمة المرور/البريد | لا | — | كامل (إعادة تحقق) |
| عناوين | `commerce/v1 addresses` CRUD | لا | نسخة `store/v1` + ربط Checkout |
| طلبات المشتري | `commerce/v1 me/orders` | لا | نسخة `store/v1` + بحث ضيف |
| دمج سلة الضيف | `commerce/v1` فقط (`resolveCurrent`) | لا — `store/v1` يستعمل `findByToken` | جعل سلة/Checkout الويب واعيين بالهوية |
| بطاقات محفوظة / هدايا / كوبونات / قائمة أمنيات | غير موجودة | — | قرار منتج (D-5) |
| سياسات | لا endpoint | — | عقد أو صفحات من Customizer (D-4) |
| دول/أسواق | لا (السوق ثابت في المتجر) | — | غير مطلوب |
| جملة | لا | — | قرار D-3 |

**فجوة هيكلية كبرى:** لا يوجد قرار معتمد يحدد كيف يمثّل خادم Next.js مشترياً أمام `store/v1` (توكن `X-Customer-Token` مُمرَّر من الخادم أم جلسة HttpOnly). أي بناء قبل هذا القرار تخمين.

---

## 7. الإخفاقات مرتبة بالخطورة

| ID | الخطورة | الوصف | الدليل | الأثر |
|---|---|---|---|---|
| R-01 | **حرجة (وظيفية)** | حساب المشتري كاملاً معطَّل في كل بيئة بلا `SPREE_*` | §5.1 | لا تسجيل ولا دخول؛ نموذج يعرض رسالة داخلية |
| R-02 | **حرجة (أمنية)** | وثائق التشغيل تنصح بقيم بديلة؛ `.env.example` يضع `localhost:8000`. عند ضبط أي قيمة يرسل `auth.login`/`customers.create` البريد وكلمة المرور إلى ذلك المضيف. وقد تكون قيمة «مؤقتة» مضيفاً لا يملكه AWJ | `docs/plans/store/AWJ_STOREFRONT_FIRST_PREVIEW_DEPLOYMENT_REPORT.md:56` · `.env.example:36-37` | تسريب بيانات اعتماد المشتري |
| R-03 | عالية (امتثال) | `/policies/*` تفشل 500؛ رابط الموافقة في التسجيل والتذييل يؤدي إليها | §4 C8 | صفحات خصوصية/شروط غير متاحة |
| R-04 | عالية (SEO) | `sitemap/*.xml` فارغ بصمت (`console.error` فقط) | `app/sitemap.ts:136-139` | فقدان الفهرسة دون إنذار |
| R-05 | عالية (عزل) | عميل Spree على مستوى العملية + `use cache: remote` غير مُفتَّح بالمضيف؛ أي إعادة توجيه/ترحيل للمحتوى إلى AWJ دون تشفير المضيف في المفتاح يسرّب بين المستأجرين | `config.ts:5` · `policies.ts:11` · تعليق `products.ts:24-35` | تلوث ذاكرة تخزين مؤقت عبر المستأجرين |
| R-06 | عالية (مالية) | قواعد 403/422=نجاح و`success` مع `order:null` في دفع Spree | `payment.ts:121-148` | إن فُعِّل مسار Spree يُظهر نجاحاً كاذباً |
| R-07 | متوسطة | مسارات Checkout Spree غير مغلقة (`/checkout/[id]`…) | §5.3 | سطح هجوم/ارتباك؛ أخطاء 500 محتملة |
| R-08 | متوسطة | الخروج لا يمسح كوكي سلة AWJ؛ ودمج سلة الضيف لا يحدث | `customer.ts:200` · `cookies.ts:94-109` | قيد تصميم عند ربط السلة بالهوية |
| R-09 | متوسطة | تحقق جلسة بالاسم فقط | §5.5 | تجاوز قشرة الحساب (بلا بيانات اليوم) |
| R-10 | متوسطة | حتى مع توجيه AWJ: تسجيل 202 بلا توكن + لا تسليم تحقق ⇒ لا حساب قابل للدخول | §6 | مانع وظيفي للهجرة |
| R-11 | متوسطة (اختبار) | تغطية Spree-e2e وهمية: `e2e-backend/` مفقود، `ci.yml` المتداخل لا يعمل، `playwright.config.ts` الافتراضي يتطلب `.env.e2e` حتى لمواصفات لا تحتاجه | §4 C16 | لا اختبار فعلي لمسار الحساب/الدفع القديم |
| R-12 | منخفضة | بقايا علامة/نصوص/حزم/وثائق Spree (README أصلي، «Powered by Spree»، `spree.png`، `nextjs-starter-spree`) | C18 | تشويش هوية |
| R-13 | منخفضة | `dangerouslySetInnerHTML={policy.body_html}` من مصدر خارجي | `policies/[slug]/page.tsx:97` | عند إعادة التوجيه إلى AWJ يجب تنقية HTML |

---

## 8. الحقائق مقابل الاستنتاجات مقابل المجهول

**حقائق [V]:** كل سلاسل الاستدعاء أعلاه؛ مسارات Laravel الثلاثة؛ غياب `e2e-backend/`؛ الاستيرادات القيمة الخمسة؛ أن `data/markets.getMarkets()` ثابت؛ أن الكاتالوج والسلة وCheckout DTC من AWJ.
**استنتاجات [I]:** إن `/policies/*` تردّ 500 (قراءة الكود: `getClient()` يرمي `Error` عاماً داخل دالة `use cache: remote` دون التقاط)؛ لم يُنفَّذ تشغيل. إن الكوكي المفتعل يفتح قشرة الحساب.
**مجهول [U]:** المضيف الحيّ (Vercel/Railway)، قيم المتغيرات المنشورة، drift المراجعة المنشورة، وجود Spree يعمل خارج المستودع، حدود ترقيم `store/v1` للـsitemap، من يستعمل الجملة (إن وُجد)، أيّ مستأجر ضبط قيماً بديلة سابقاً (خطر R-02 التاريخي).

---

## 9. أوامر إعادة الإنتاج
```bash
cd storefront
rg -il spree --glob '!node_modules' --glob '!pnpm-lock.yaml' . | wc -l            # 196
rg -n "getClient\(|getClientForSurface\(|withAuthRefresh\(" src \
   --glob '!**/*.test.*' --glob '!**/__tests__/**'                                # 68 سطراً
rg -n "^import (?!type)[^;]*from \"@spree" -P src                                  # قيمة runtime (+ متعدد الأسطر عبر السكربت)
rg -n "use cache" src --glob '!**/*.test.*'                                        # التخزين المؤقت
rg -l 'vi\.mock\("@/lib/spree|vi\.mock\("@spree' src                               # اختبارات تحاكي Spree
ls e2e-backend 2>&1; git ls-files | rg e2e-backend                                 # غائب
# عدّاد الاستيراد متعدد الأسطر + الأنواع/القيم: سكربت python (-I) يمسح import …from "@spree/*" (109 عبارة)
cd .. && rg -n "Route::" routes/api_storefront.php                                 # لا auth/account
rg -n "email_verified_at" app/Services/CustomerAuthenticationService.php           # :36
```

---

## 10. الملحق (قوائم `path:line` الكاملة)

### A1 — مواضع استدعاء عميل Spree وقت التشغيل (`getClient`/`getClientForSurface`/`withAuthRefresh`) — 68 سطراً

| # | path:line | الاستدعاء | الفئة* | الوصول في الإنتاج |
|---|---|---|---|---|
| 1 | `src/lib/data/policies.ts:15` | `return await getClient().policies.get(slugOrId, options);` | R2 | صفحات /policies/[slug] + رابط موافقة التسجيل والتذييل (Spree) |
| 2 | `src/lib/data/wholesale.ts:87` | `const response = await withAuthRefresh((options) =>` | R4 | بوابة الجملة (مغلقة افتراضياً بغياب SPREE_WHOLESALE_CHANNEL) |
| 3 | `src/lib/data/wholesale.ts:141` | `const response = await withAuthRefresh((options) =>` | R4 | بوابة الجملة (مغلقة افتراضياً بغياب SPREE_WHOLESALE_CHANNEL) |
| 4 | `src/lib/data/sitemap.ts:27` | `return (await getClient().markets.list(options)).data;` | R2 | /sitemap/*.xml (فشل صامت→خريطة فارغة) |
| 5 | `src/lib/data/sitemap.ts:41` | `? await getClient().products.list({ page: 1, limit: 1 }, options)` | R2 | /sitemap/*.xml (فشل صامت→خريطة فارغة) |
| 6 | `src/lib/data/sitemap.ts:42` | `: await getClient().categories.list(` | R2 | /sitemap/*.xml (فشل صامت→خريطة فارغة) |
| 7 | `src/lib/data/sitemap.ts:58` | `const response = await getClient().products.list(` | R2 | /sitemap/*.xml (فشل صامت→خريطة فارغة) |
| 8 | `src/lib/data/sitemap.ts:74` | `const response = await getClient().categories.list(` | R2 | /sitemap/*.xml (فشل صامت→خريطة فارغة) |
| 9 | `src/lib/data/addresses.ts:11` | `return withAuthRefresh(async (options) => {` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 10 | `src/lib/data/addresses.ts:12` | `return getClient().customer.addresses.list(undefined, options);` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 11 | `src/lib/data/addresses.ts:21` | `return withAuthRefresh(async (options) => {` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 12 | `src/lib/data/addresses.ts:22` | `return getClient().customer.addresses.get(id, options);` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 13 | `src/lib/data/addresses.ts:29` | `const result = await withAuthRefresh(async (options) => {` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 14 | `src/lib/data/addresses.ts:30` | `return getClient().customer.addresses.create(address, options);` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 15 | `src/lib/data/addresses.ts:42` | `const result = await withAuthRefresh(async (options) => {` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 16 | `src/lib/data/addresses.ts:43` | `return getClient().customer.addresses.update(id, address, options);` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 17 | `src/lib/data/addresses.ts:52` | `await withAuthRefresh(async (options) => {` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 18 | `src/lib/data/addresses.ts:53` | `return getClient().customer.addresses.delete(id, options);` | R3 | دفتر عناوين Spree: يصل من checkout/[id] فقط (AddressManagement ميت) |
| 19 | `src/lib/data/payment.ts:37` | `const session = await getClientForSurface(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 20 | `src/lib/data/payment.ts:66` | `const session = await getClientForSurface(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 21 | `src/lib/data/payment.ts:86` | `const payment = await getClientForSurface(surface).carts.payments.create(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 22 | `src/lib/data/payment.ts:105` | `const session = await getClientForSurface(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 23 | `src/lib/data/payment.ts:128` | `const order: Order = await getClientForSurface(surface).carts.complete(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 24 | `src/lib/data/payment.ts:203` | `const completeResult = await getClientForSurface(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 25 | `src/lib/data/payment.ts:222` | `const completeResult = await getClientForSurface(` | R3 | دفع Spree (Stripe/Adyen/PayPal) عبر PaymentSection وExpressCheckout |
| 26 | `src/lib/data/orders.ts:17` | `return withAuthRefresh(async (options) => {` | R3 | قراءة طلب Spree لصفحات order-placed/checkout القديمة |
| 27 | `src/lib/data/orders.ts:18` | `return getClient().customer.orders.list(params, options);` | R3 | قراءة طلب Spree لصفحات order-placed/checkout القديمة |
| 28 | `src/lib/data/orders.ts:51` | `return getClientForSurface(surface).orders.get(id, params, options);` | R3 | قراءة طلب Spree لصفحات order-placed/checkout القديمة |
| 29 | `src/lib/data/customer.ts:31` | `return withAuthRefresh((options) => getClient().customer.get(options));` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 30 | `src/lib/data/customer.ts:47` | `await getClient().carts.associate(cartId, {` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 31 | `src/lib/data/customer.ts:135` | `const result = await getClient().auth.login({ email, password });` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 32 | `src/lib/data/customer.ts:171` | `const result = await getClient().customers.create(params);` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 33 | `src/lib/data/customer.ts:189` | `await getClient().auth.logout({ refresh_token: refreshToken });` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 34 | `src/lib/data/customer.ts:217` | `return getClient().passwordResets.create({` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 35 | `src/lib/data/customer.ts:233` | `const result = await getClient().passwordResets.update(token, {` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 36 | `src/lib/data/customer.ts:256` | `customer = await withAuthRefresh(async (options) => {` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 37 | `src/lib/data/customer.ts:257` | `return getClient().customer.update(data, options);` | R1 | حساب المشتري: تسجيل/دخول/خروج/جلسة/كلمة المرور/الملف (كل /account/* وAuthProvider) |
| 38 | `src/lib/data/checkout.ts:130` | `const cart = await getClientForSurface(surface).carts.update(` | R3 | Checkout Spree: مسار /checkout/[id] (يُربط من wholesale وCartDrawer لسلة Spree) |
| 39 | `src/lib/data/checkout.ts:148` | `const cart = await getClientForSurface(surface).carts.update(` | R3 | Checkout Spree: مسار /checkout/[id] (يُربط من wholesale وCartDrawer لسلة Spree) |
| 40 | `src/lib/data/checkout.ts:167` | `const cart = await getClientForSurface(surface).carts.fulfillments.update(` | R3 | Checkout Spree: مسار /checkout/[id] (يُربط من wholesale وCartDrawer لسلة Spree) |
| 41 | `src/lib/data/checkout.ts:186` | `const client = getClientForSurface(surface);` | R3 | Checkout Spree: مسار /checkout/[id] (يُربط من wholesale وCartDrawer لسلة Spree) |
| 42 | `src/lib/data/checkout.ts:239` | `const cart = await getClientForSurface(surface).carts.discountCodes.remove(` | R3 | Checkout Spree: مسار /checkout/[id] (يُربط من wholesale وCartDrawer لسلة Spree) |
| 43 | `src/lib/data/checkout.ts:255` | `const cart = await getClientForSurface(surface).carts.giftCards.remove(` | R3 | Checkout Spree: مسار /checkout/[id] (يُربط من wholesale وCartDrawer لسلة Spree) |
| 44 | `src/lib/data/cart.ts:121` | `const channel = await getClientForSurface(surface).channel.get();` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 45 | `src/lib/data/cart.ts:146` | `const client = getClientForSurface(surface);` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 46 | `src/lib/data/cart.ts:218` | `const cart = await getClientForSurface(surface).carts.create(cartParams, {` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 47 | `src/lib/data/cart.ts:247` | `const updatedCart = await getClientForSurface(surface).carts.items.create(` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 48 | `src/lib/data/cart.ts:267` | `const cart = await getClientForSurface(surface).carts.items.update(` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 49 | `src/lib/data/cart.ts:287` | `const cart = await getClientForSurface(surface).carts.items.delete(` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 50 | `src/lib/data/cart.ts:308` | `await getClientForSurface(surface).carts.associate(cartId, {` | R3 | دوال سلة Spree: تصل فقط من CartProvider surface=wholesale (و checkout/payment القديمين) |
| 51 | `src/lib/data/markets.ts:66` | `return getClient().markets.resolve(country, options);` | R3 | resolveMarket/getMarketCountries: checkout/[id] فقط (getMarkets ثابت AWJ ولا يمسّ Spree) |
| 52 | `src/lib/data/markets.ts:76` | `return getClient().markets.countries.list(marketId, options);` | R3 | resolveMarket/getMarketCountries: checkout/[id] فقط (getMarkets ثابت AWJ ولا يمسّ Spree) |
| 53 | `src/lib/data/credit-cards.ts:11` | `return withAuthRefresh(async (options) => {` | R3 | بطاقات محفوظة Spree: PaymentSection (+CreditCardList ميت) |
| 54 | `src/lib/data/credit-cards.ts:12` | `return getClient().customer.creditCards.list(undefined, options);` | R3 | بطاقات محفوظة Spree: PaymentSection (+CreditCardList ميت) |
| 55 | `src/lib/data/credit-cards.ts:21` | `await withAuthRefresh(async (options) => {` | R3 | بطاقات محفوظة Spree: PaymentSection (+CreditCardList ميت) |
| 56 | `src/lib/data/credit-cards.ts:22` | `return getClient().customer.creditCards.delete(id, options);` | R3 | بطاقات محفوظة Spree: PaymentSection (+CreditCardList ميت) |
| 57 | `src/lib/data/countries.ts:8` | `return getClient().countries.list(options);` | R3 | دول/ولايات Spree: checkout/[id] + AddressManagement (ميت) |
| 58 | `src/lib/data/countries.ts:18` | `return getClient().countries.get(iso, { expand: ["states"] }, options);` | R3 | دول/ولايات Spree: checkout/[id] + AddressManagement (ميت) |
| 59 | `src/lib/data/gift-cards.ts:10` | `return withAuthRefresh(async (options) => {` | DEAD | لا مستورد إطلاقاً |
| 60 | `src/lib/data/gift-cards.ts:11` | `return getClient().customer.giftCards.list(undefined, options);` | DEAD | لا مستورد إطلاقاً |
| 61 | `src/lib/data/gift-cards.ts:20` | `return withAuthRefresh(async (options) => {` | DEAD | لا مستورد إطلاقاً |
| 62 | `src/lib/data/gift-cards.ts:21` | `return getClient().customer.giftCards.get(id, options);` | DEAD | لا مستورد إطلاقاً |
| 63 | `src/lib/spree/cookies.ts:199` | `const response = await getClientForSurface(surface).carts.list({ token });` | R3 | requireCartId: سلة Spree (wholesale/checkout القديم) |
| 64 | `src/lib/spree/config.ts:25` | `export function getClient(): Client {` | DEF | تعريف العميل ومصدر الخطأ المعروض للمستخدم |
| 65 | `src/lib/spree/config.ts:45` | `getClient(); // triggers auto-init` | DEF | تعريف العميل ومصدر الخطأ المعروض للمستخدم |
| 66 | `src/lib/spree/config.ts:112` | `export function getClientForSurface(surface: Surface): Client {` | DEF | تعريف العميل ومصدر الخطأ المعروض للمستخدم |
| 67 | `src/lib/spree/config.ts:113` | `return surface === "wholesale" ? getWholesaleClient() : getClient();` | DEF | تعريف العميل ومصدر الخطأ المعروض للمستخدم |
| 68 | `src/lib/spree/auth-helpers.ts:150` | `const refreshed = await getClient().auth.refresh({` | R1 | تجديد التوكن لجلسة Spree (يُستدعى من customer.ts وwholesale) |

\* R1 = مسار حساب المشتري (يعمل لكل زائر) · R2 = صفحات عامة (policies/sitemap) · R3 = Spree checkout/cart القديم (يُدخل إليه بالرابط أو من الجملة) · R4 = الجملة (اختيارية، مغلقة افتراضياً) · DEF = تعريف · DEAD = كود ميت.

### A2 — استيرادات `@spree/*` (109 عبارة في 104 ملفاً)

| path:line | الوحدة | الرموز | النوع | الفئة |
|---|---|---|---|---|
| `src/app/[country]/[locale]/(checkout)/checkout/[id]/CheckoutPageContent.tsx:3` | `@spree/sdk` | Address, AddressParams, Cart, Country | type | page-type |
| `src/app/[country]/[locale]/(checkout)/checkout/[id]/CheckoutSidebar.tsx:3` | `@spree/sdk` | Cart | type | page-type |
| `src/app/[country]/[locale]/(checkout)/checkout/[id]/page.tsx:1` | `@spree/sdk` | Address, Cart, Country | type | page-type |
| `src/app/[country]/[locale]/(checkout)/order-placed/[id]/page.tsx:3` | `@spree/sdk` | Cart | type | page-type |
| `src/app/[country]/[locale]/(storefront)/c/[...permalink]/CategoryBanner.test.tsx:1` | `@spree/sdk` | Category | type | test |
| `src/app/[country]/[locale]/(storefront)/c/[...permalink]/CategoryBanner.tsx:1` | `@spree/sdk` | Category | type | page-type |
| `src/app/[country]/[locale]/(storefront)/layout.tsx:1` | `@spree/sdk` | Category | type | page-type |
| `src/app/[country]/[locale]/(storefront)/policies/[slug]/page.test.tsx:1` | `@spree/sdk` | Policy | type | test |
| `src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.gifting.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx:3` | `@spree/sdk` | Media, Product, Variant | type | page-type |
| `src/app/[country]/[locale]/(storefront)/products/[slug]/page.tsx:1` | `@spree/sdk` | Category | type | page-type |
| `src/app/[country]/[locale]/(wholesale)/wholesale/cart/WholesaleCartView.tsx:3` | `@spree/sdk` | Cart, LineItem | type | page-type |
| `src/app/[country]/[locale]/layout.test.tsx:1` | `@spree/sdk` | Country, Market | type | test |
| `src/app/dev/category-visual/fetch-products.ts:3` | `@spree/sdk` | PaginatedResponse, Product, ProductListParams | type | dev-only |
| `src/app/dev/category-visual/page.tsx:1` | `@spree/sdk` | Category, ProductFiltersResponse | type | dev-only |
| `src/app/dev/market-visual/page.tsx:1` | `@spree/sdk` | Product | type | dev-only |
| `src/app/dev/product-visual/page.tsx:1` | `@spree/sdk` | Product | type | dev-only |
| `src/components/account/CreditCardList.tsx:3` | `@spree/sdk` | CreditCard | type | UI-type |
| `src/components/account/GiftCardList.tsx:3` | `@spree/sdk` | GiftCard | type | UI-type |
| `src/components/account/OrderDetail.tsx:1` | `@spree/sdk` | Order | type | UI-type |
| `src/components/account/OrderList.tsx:1` | `@spree/sdk` | Order | type | UI-type |
| `src/components/addresses/AddressManagement.tsx:3` | `@spree/sdk` | Address, AddressParams, Country | type | UI-type |
| `src/components/cart/CartDrawer.tsx:3` | `@spree/sdk` | Cart, LineItem | type | UI-type |
| `src/components/checkout/AddressEditModal.tsx:3` | `@spree/sdk` | Country, State | type | UI-type |
| `src/components/checkout/AddressFormFields.tsx:3` | `@spree/sdk` | Country, State | type | UI-type |
| `src/components/checkout/AddressSection.tsx:3` | `@spree/sdk` | Address, AddressParams, Cart, Country, State | type | UI-type |
| `src/components/checkout/AddressSelector.tsx:3` | `@spree/sdk` | Address, Country, State | type | UI-type |
| `src/components/checkout/CouponCode.tsx:3` | `@spree/sdk` | Cart | type | UI-type |
| `src/components/checkout/DeliveryMethodSection.tsx:3` | `@spree/sdk` | Fulfillment | type | UI-type |
| `src/components/checkout/ExpressCheckoutButton.tsx:3` | `@spree/sdk` | Cart | type | UI-type |
| `src/components/checkout/PaymentSection.tsx:3` | `@spree/sdk` | AddressParams, Cart, Country, PaymentMethod, CreditCard, State | type | UI-type |
| `src/components/checkout/Summary.tsx:3` | `@spree/sdk` | Cart | type | UI-type |
| `src/components/layout/Footer.tsx:1` | `@spree/sdk` | Category | type | UI-type |
| `src/components/layout/Header.tsx:1` | `@spree/sdk` | Category | type | UI-type |
| `src/components/layout/MobileMenu.tsx:3` | `@spree/sdk` | Category | type | UI-type |
| `src/components/navigation/Breadcrumbs.tsx:1` | `@spree/sdk` | Category | type | UI-type |
| `src/components/order/AddressBlock.tsx:1` | `@spree/sdk` | Address | type | UI-type |
| `src/components/order/FulfillmentBlock.tsx:3` | `@spree/sdk` | Address, Fulfillment, Order | type | UI-type |
| `src/components/order/LineItemCard.tsx:3` | `@spree/sdk` | Order | type | UI-type |
| `src/components/order/OrderTotals.tsx:1` | `@spree/sdk` | Cart, Order | type | UI-type |
| `src/components/order/PaymentInfo.tsx:1` | `@spree/sdk` | CreditCard, Payment, StoreCredit | type | UI-type |
| `src/components/products/InfiniteProductList.tsx:3` | `@spree/sdk` | PaginatedResponse, Product | type | UI-type |
| `src/components/products/ListingAnalytics.tsx:3` | `@spree/sdk` | Product | type | UI-type |
| `src/components/products/ListingFilterBar.tsx:3` | `@spree/sdk` | ProductFiltersResponse | type | UI-type |
| `src/components/products/MediaGallery.tsx:3` | `@spree/sdk` | Media | type | UI-type |
| `src/components/products/MediaLightbox.tsx:3` | `@spree/sdk` | Media | type | UI-type |
| `src/components/products/ProductCard.tsx:3` | `@spree/sdk` | Product | type | UI-type |
| `src/components/products/ProductCarousel.tsx:3` | `@spree/sdk` | Product | type | UI-type |
| `src/components/products/ProductCustomFields.tsx:1` | `@spree/sdk` | CustomField | type | UI-type |
| `src/components/products/ProductGrid.tsx:3` | `@spree/sdk` | Product | type | UI-type |
| `src/components/products/ProductListing.tsx:1` | `@spree/sdk` | PaginatedResponse, Product, ProductFiltersResponse | type | UI-type |
| `src/components/products/QuickView.tsx:3` | `@spree/sdk` | Product | type | UI-type |
| `src/components/products/VariantPicker.tsx:3` | `@spree/sdk` | OptionType, Variant | type | UI-type |
| `src/components/products/__tests__/InfiniteProductList.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/components/products/__tests__/ProductCard.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/components/products/__tests__/ProductCarousel.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/components/products/__tests__/ProductGrid.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/components/products/__tests__/QuickView.test.tsx:1` | `@spree/sdk` | Product | type | test |
| `src/components/products/filters/AvailabilityDropdownContent.tsx:3` | `@spree/sdk` | AvailabilityFilter | type | UI-type |
| `src/components/products/filters/FilterChips.tsx:3` | `@spree/sdk` | OptionFilter, ProductFiltersResponse | type | UI-type |
| `src/components/products/filters/MobileFilterDrawer.tsx:3` | `@spree/sdk` | AvailabilityFilter, OptionFilter, ProductFiltersResponse | type | UI-type |
| `src/components/products/filters/OptionDropdownContent.tsx:1` | `@spree/sdk` | OptionFilter | type | UI-type |
| `src/components/products/filters/ProductFilters.tsx:3` | `@spree/sdk` | AvailabilityFilter, OptionFilter, PriceRangeFilter, ProductFiltersResponse | type | UI-type |
| `src/components/search/SearchBar.tsx:3` | `@spree/sdk` | Product | type | UI-type |
| `src/contexts/CartContext.tsx:3` | `@spree/sdk` | Cart, LineItem | type | other |
| `src/contexts/StoreContext.tsx:3` | `@spree/sdk` | Country, Market | type | other |
| `src/hooks/useCountryStates.ts:1` | `@spree/sdk` | State | type | other |
| `src/i18n/__tests__/markets.test.ts:1` | `@spree/sdk` | Country, Market | type | test |
| `src/i18n/markets.ts:1` | `@spree/sdk` | Market | type | other |
| `src/lib/analytics/gtm.ts:2` | `@spree/sdk` | Cart, LineItem, Order, Product, Variant | type | other |
| `src/lib/commerce/mappers.ts:1` | `@spree/sdk` | Media, OptionType, OptionValue, Price, Variant | type | AWJ-adapter(types) |
| `src/lib/commerce/products.ts:1` | `@spree/sdk` | PaginatedResponse, PaginationMeta, Product, ProductFiltersResponse | type | AWJ-adapter(types) |
| `src/lib/commerce/types.ts:113` | `@spree/sdk` | Category | type | AWJ-adapter(types) |
| `src/lib/commerce/types.ts:127` | `@spree/sdk` | Product | type | AWJ-adapter(types) |
| `src/lib/data/__tests__/policies.test.ts:1` | `@spree/sdk` | SpreeError | RUNTIME | test |
| `src/lib/data/addresses.ts:3` | `@spree/sdk` | Address, AddressParams | type | data-layer |
| `src/lib/data/cart.ts:3` | `@spree/sdk` | Cart, CreateCartParams | type | data-layer |
| `src/lib/data/categories.ts:3` | `@spree/sdk` | CategoryListParams, ProductListParams | type | data-layer |
| `src/lib/data/checkout.ts:3` | `@spree/sdk` | AddressParams, Cart | type | data-layer |
| `src/lib/data/checkout.ts:4` | `@spree/sdk` | SpreeError | RUNTIME | data-layer |
| `src/lib/data/credit-cards.ts:3` | `@spree/sdk` | CreditCard | type | data-layer |
| `src/lib/data/customer.ts:3` | `@spree/sdk` | Customer | type | data-layer |
| `src/lib/data/express-checkout-flow.ts:3` | `@spree/sdk` | AddressParams, Cart | type | data-layer |
| `src/lib/data/gift-cards.ts:3` | `@spree/sdk` | GiftCard | type | data-layer |
| `src/lib/data/markets.ts:3` | `@spree/sdk` | Market | type | data-layer |
| `src/lib/data/orders.ts:3` | `@spree/sdk` | OrderListParams | type | data-layer |
| `src/lib/data/payment.ts:3` | `@spree/sdk` | Order | type | data-layer |
| `src/lib/data/policies.ts:3` | `@spree/sdk` | Policy, SpreeError | RUNTIME | data-layer |
| `src/lib/data/sitemap.ts:3` | `@spree/sdk` | Category, Media, Product | type | data-layer |
| `src/lib/data/wholesale.ts:3` | `@spree/sdk` | Channel, ProductListParams | type | data-layer |
| `src/lib/metadata/__tests__/alternates.test.ts:1` | `@spree/sdk` | Country, Market | type | test |
| `src/lib/metadata/alternates.ts:1` | `@spree/sdk` | Market | type | other |
| `src/lib/presentation/public-footer.ts:6` | `@spree/sdk` | Category | type | other |
| `src/lib/presentation/public-navigation.ts:6` | `@spree/sdk` | Category | type | other |
| `src/lib/seo.ts:1` | `@spree/sdk` | Category, Media, Product | type | other |
| `src/lib/spree/auth-helpers.ts:1` | `@spree/sdk` | RequestOptions | type | adapter |
| `src/lib/spree/auth-helpers.ts:2` | `@spree/sdk` | SpreeError | RUNTIME | adapter |
| `src/lib/spree/config.ts:1` | `@spree/sdk` | Client, createClient | RUNTIME | adapter |
| `src/lib/spree/webhooks.ts:1` | `@spree/sdk/webhooks` | WebhookEvent | type | adapter |
| `src/lib/spree/webhooks.ts:2` | `@spree/sdk/webhooks` | verifyWebhookSignature | RUNTIME | adapter |
| `src/lib/utils/__tests__/express-checkout.test.ts:1` | `@spree/sdk` | Cart | type | test |
| `src/lib/utils/address.ts:1` | `@spree/sdk` | AddressParams | type | other |
| `src/lib/utils/express-checkout.ts:1` | `@spree/sdk` | Cart, Fulfillment | type | other |
| `src/lib/utils/listing-context.ts:1` | `@spree/sdk` | ProductListParams | type | other |
| `src/lib/utils/product-query.ts:1` | `@spree/sdk` | ProductListParams | type | other |
| `src/lib/webhooks/handlers.ts:1` | `@spree/sdk` | Order | type | other |
| `src/lib/webhooks/handlers.ts:2` | `@spree/sdk/webhooks` | WebhookEvent | type | other |
| `src/lib/wholesale.ts:1` | `@spree/sdk` | Customer | type | other |

### A3 — ثوابت/متغيّرات/كوكيز بتسمية Spree (خارج الاختبارات)

| path:line | الرمز |
|---|---|
| `src/lib/spree/types.ts:6` | `_spree_cart_token` |
| `src/lib/spree/cookies.ts:10` | `_spree_cart_token` |
| `src/lib/spree/surface.ts:32` | `_spree_cart_token` |
| `src/lib/spree/types.ts:8` | `_spree_jwt` |
| `src/lib/spree/cookies.ts:11` | `_spree_jwt` |
| `src/lib/spree/middleware.ts:13` | `_spree_jwt` |
| `src/lib/spree/cookies.ts:12` | `_spree_refresh_token` |
| `src/lib/spree/middleware.ts:14` | `_spree_refresh_token` |
| `src/lib/utils/cookies.ts:26` | `spree_country` |
| `src/lib/spree/types.ts:10` | `spree_country` |
| `src/lib/spree/locale.ts:4` | `spree_country` |
| `src/lib/spree/middleware.ts:11` | `spree_country` |
| `src/lib/spree/middleware.ts:64` | `spree_country` |
| `src/lib/spree/middleware.ts:103` | `spree_country` |
| `src/lib/utils/cookies.ts:27` | `spree_locale` |
| `src/lib/spree/types.ts:12` | `spree_locale` |
| `src/lib/spree/locale.ts:5` | `spree_locale` |
| `src/lib/spree/middleware.ts:12` | `spree_locale` |
| `src/lib/spree/middleware.ts:64` | `spree_locale` |
| `src/lib/spree/middleware.ts:103` | `spree_locale` |
| `src/lib/spree/surface.ts:31` | `_spree_wholesale_cart_token` |
| `src/lib/spree/cookies.ts:26` | `_spree_write_probe` |
| `src/i18n/routing.ts:1` | `x-spree-` |
| `src/i18n/routing.ts:2` | `x-spree-` |
| `src/lib/spree/webhooks.ts:56` | `x-spree-` |
| `src/lib/spree/webhooks.ts:57` | `x-spree-` |
| `src/lib/spree/webhooks.ts:58` | `x-spree-` |
| `src/lib/spree/config.ts:80` | `x-spree-` |
| `next.config.ts:11` | `SPREE_API_URL` |
| `next.config.ts:12` | `SPREE_API_URL` |
| `next.config.ts:15` | `SPREE_API_URL` |
| `next.config.ts:21` | `SPREE_API_URL` |
| `next.config.ts:70` | `SPREE_API_URL` |
| `next.config.ts:72` | `SPREE_API_URL` |
| `.env.example:36` | `SPREE_API_URL` |
| `src/lib/spree/config.ts:12` | `SPREE_API_URL` |
| `src/lib/spree/config.ts:27` | `SPREE_API_URL` |
| `src/lib/spree/config.ts:33` | `SPREE_API_URL` |
| `src/components/layout/DocumentShell.tsx:28` | `SPREE_API_URL` |
| `src/components/layout/DocumentShell.tsx:29` | `SPREE_API_URL` |
| `next.config.ts:13` | `SPREE_IMAGES_URL` |
| `next.config.ts:21` | `SPREE_IMAGES_URL` |
| `next.config.ts:70` | `SPREE_IMAGES_URL` |
| `.env.example:37` | `SPREE_PUBLISHABLE_KEY` |
| `src/lib/spree/config.ts:12` | `SPREE_PUBLISHABLE_KEY` |
| `src/lib/spree/config.ts:28` | `SPREE_PUBLISHABLE_KEY` |
| `src/lib/spree/config.ts:33` | `SPREE_PUBLISHABLE_KEY` |
| `src/lib/spree/config.ts:55` | `SPREE_WHOLESALE_CHANNEL` |
| `src/lib/spree/config.ts:63` | `SPREE_WHOLESALE_CHANNEL` |
| `src/lib/spree/config.ts:89` | `SPREE_WHOLESALE_CHANNEL` |
| `src/lib/spree/config.ts:97` | `SPREE_WHOLESALE_PUBLISHABLE_KEY` |
| `.env.example:66` | `SPREE_WEBHOOK_SECRET` |
| `src/lib/spree/webhooks.ts:12` | `SPREE_WEBHOOK_SECRET` |
| `src/app/api/webhooks/spree/route.ts:12` | `SPREE_WEBHOOK_SECRET` |
| `src/app/[country]/[locale]/(checkout)/layout.tsx:29` | `/spree.png` |
| `.env.example:3` | `Spree Store` |
| `src/lib/commerce/mappers.ts:24` | `Spree Store` |
| `src/lib/commerce/storefront.ts:114` | `Spree Store` |
| `src/lib/store.ts:40` | `Spree Store` |
| `src/lib/store.ts:63` | `Spree Store` |

### A4 — اختبارات وحدة مقترنة بـSpree

- `src/app/[country]/[locale]/(storefront)/account/(authenticated)/layout.test.tsx`
- `src/app/[country]/[locale]/(storefront)/c/[...permalink]/CategoryBanner.test.tsx`
- `src/app/[country]/[locale]/(storefront)/policies/[slug]/page.test.tsx`
- `src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.gifting.test.tsx`
- `src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.test.tsx`
- `src/app/[country]/[locale]/layout.test.tsx`
- `src/components/account/__tests__/AccountShell.architecture.test.ts`
- `src/components/cart/__tests__/CartDrawer.test.tsx`
- `src/components/checkout/__tests__/AwjCheckoutFlow.architecture.test.ts`
- `src/components/home/__tests__/HeroSection.test.tsx`
- `src/components/layout/Footer.layouts.test.tsx`
- `src/components/layout/Footer.legacy.test.tsx`
- `src/components/layout/Footer.test.tsx`
- `src/components/layout/__tests__/Header.test.tsx`
- `src/components/layout/__tests__/RegionPreferences.test.tsx`
- `src/components/layout/__tests__/footer-proof.render.test.tsx`
- `src/components/layout/__tests__/header-overlay-proof.render.test.tsx`
- `src/components/layout/__tests__/header-proof.render.test.tsx`
- `src/components/layout/__tests__/nav-proof.render.test.tsx`
- `src/components/products/__tests__/InfiniteProductList.test.tsx`
- `src/components/products/__tests__/ProductCard.test.tsx`
- `src/components/products/__tests__/ProductCarousel.test.tsx`
- `src/components/products/__tests__/ProductGrid.test.tsx`
- `src/components/products/__tests__/QuickView.test.tsx`
- `src/components/ui/__tests__/product-image.test.tsx`
- `src/contexts/__tests__/CartContext.test.tsx`
- `src/i18n/__tests__/markets.test.ts`
- `src/lib/commerce/__tests__/cart-types.test.ts`
- `src/lib/commerce/__tests__/mappers.test.ts`
- `src/lib/commerce/__tests__/products.test.ts`
- `src/lib/commerce/__tests__/storefront.test.ts`
- `src/lib/data/__tests__/cart.test.ts`
- `src/lib/data/__tests__/checkout.test.ts`
- `src/lib/data/__tests__/customer.test.ts`
- `src/lib/data/__tests__/markets.test.ts`
- `src/lib/data/__tests__/payment.test.ts`
- `src/lib/data/__tests__/policies.test.ts`
- `src/lib/data/__tests__/resolve-surface.test.ts`
- `src/lib/data/__tests__/sitemap.test.ts`
- `src/lib/metadata/__tests__/alternates.test.ts`
- `src/lib/spree/__tests__/auth-helpers.test.ts`
- `src/lib/spree/__tests__/jwt.test.ts`
- `src/lib/spree/middleware.test.ts`
- `src/lib/utils/__tests__/express-checkout.test.ts`

### B — سكربت عدّ استيرادات `@spree/*` (قابل لإعادة التشغيل؛ للقراءة فقط)

```python
import re, sys, os, json, collections
root = sys.argv[1]
pat = re.compile(r'import\s+(type\s+)?(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+))\s+from\s+["\'](@spree/[^"\']+)["\']', re.S)
rows=[]
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in ('node_modules','.next','.git')]
    for f in fn:
        if not f.endswith(('.ts','.tsx','.mts','.js','.mjs')): continue
        p=os.path.join(dp,f)
        s=open(p,encoding='utf-8',errors='ignore').read()
        for m in pat.finditer(s):
            line=s.count('\n',0,m.start())+1
            typeonly=bool(m.group(1))
            names=[]
            if m.group(2):
                for n in m.group(2).strip('{}').split(','):
                    n=n.strip()
                    if not n: continue
                    inline_type = n.startswith('type ')
                    n=n.replace('type ','').split(' as ')[0].strip()
                    names.append((n, typeonly or inline_type))
            rows.append((os.path.relpath(p,root),line,m.group(5),typeonly,names))
        # dynamic type refs
        for m in re.finditer(r'import\("(@spree/[^"]+)"\)\.(\w+)', s):
            line=s.count('\n',0,m.start())+1
            rows.append((os.path.relpath(p,root),line,m.group(1),True,[(m.group(2),True)]))
def cat(path):
    if '__tests__' in path or '.test.' in path or '/e2e/' in path: return 'test'
    if path.startswith('src/app/dev/'): return 'dev-page'
    return 'src'
out=collections.Counter(); sym=collections.Counter(); runtime=[]
files=set()
for path,line,mod,typeonly,names in rows:
    files.add(path)
    out[(cat(path),'type' if all(t for _,t in names) and names else 'runtime')]+=1
    for n,t in names:
        sym[(n,'type' if t else 'RUNTIME')]+=1
        if not t: runtime.append((path,line,n,mod))
print("import statements:",len(rows),"files:",len(files))
for k,v in sorted(out.items()): print(k,v)
print("--- RUNTIME value imports")
for r in runtime: print(r)
print("--- symbols")
for (n,t),c in sorted(sym.items(), key=lambda x:-x[1]): print(f"{c:3d} {t:7s} {n}")
json.dump(rows, open(sys.argv[2],'w'))
```

التشغيل: `cd storefront && python3 -I sdk_imports.py . out.json` (الحفظ خارج الشجرة).


---

# الملحق ج — AWJ COMMERCE END-TO-END FUNCTIONAL COVERAGE

**الغرض:** إثبات أن خطة الخروج من Spree تغطي **كل وظائف المتجر** لا حساب المشتري وحده، وتحديد مصدر الحقيقة وحالة كل وظيفة بدليل. **للقراءة فقط.** يبني على التدقيق أعلاه ولا يعيد استكشاف المستودع؛ الإضافات الخلفية مستخرجة بثلاث فحوص مركّزة (دورة الطلب والدفع والفوترة، الشحن والعروض والإشعارات، ومسارات الحساب) وأعدتُ التحقق بنفسي من الحاسم منها (**[V]**) وما لم أعد فتحه موسوم **[A]**.

**المرجع:** `main@0ea1658da61ed730ab695dc89d912492f622aa1d` · لم يُشغَّل أي اختبار؛ «اختبار» أدناه = ملف/اختبار موجود بالاسم، لا نتيجة تشغيل.

## ج.0 تعريف الحالات

| الحالة | المعنى (على مستوى متجر الويب `storefront/` + Laravel كما في `main`) |
|---|---|
| **Implemented** | عقد AWJ موجود **و**يستعمله المتجر فعلاً **و**له اختبارات |
| **Partially Implemented** | موجود جزئياً: ناقص الشكل/الحالات، أو على سطح آخر فقط (مثلاً `commerce/v1` للجوال لا `store/v1`)، أو مغلق بوابة نشر |
| **Spree-dependent** | مسار الواجهة الوحيد يستدعي عميل Spree (أو يعتمد على أحداث Spree) ولا بديل AWJ يخدمه |
| **Missing** | لا عقد AWJ ولا تنفيذ يعمل في الواجهة (قد توجد واجهة `design_only` بلا أثر) |
| **Unverified** | لم يُثبت بالأدلة المتاحة |

«**مستخدم في الواجهة**» = يصل زائر DTC عادي دون رابط مباشر خاص ودون تفعيل بوابة اختيارية.

## ج.1 تتبّع دورة الشراء (Product → … → Invoice/ZATCA)

```
Product ─► Cart ─► Checkout ─► CommerceOrder ─► Payment ─► Fulfillment ─► Invoice/ZATCA
 AWJ ✓     AWJ ✓    AWJ ✓       AWJ ✓            COD ✓*      ✗ مفقود        online-only
 (store/   (cookie  (contact/   (confirmed       online:     (لا شحنة/      مغلق بالبوابة
 v1)       guest)   address/    مباشرةً؛         gated(G3)   تتبّع/         (EXT-05 + سياسة)
                    delivery/   لا إلغاء ولا     لا استرداد  "تم الشحن")    COD ⇒ لا مستند
                    schedule/   حالات أخرى)                                  مالي إطلاقاً
                    gift/pay)
```
\* COD/pickup: نية دفع فقط، تحصيلها من الموظف عبر `POST commerce/payment-intents/{id}/collect` **بلا أثر محاسبي**.

| الحلقة | الحالة | الدليل | الفجوة |
|---|---|---|---|
| Product → Cart | Implemented | `lib/commerce/cart.ts::addAwjCartItem:46` ← `POST store/v1/cart/items` (`StorefrontCartController::store`) | ملخّص السلة `subtotal` فقط (`CommerceCartService.php:710`) |
| Cart → Checkout | Implemented | `lib/commerce/checkout.ts::createOrResumeAwjCheckout:47` ← `POST store/v1/checkout` | ضيف فقط (لا `resolveCurrent` على الويب) |
| Checkout → CommerceOrder | Implemented | `completeAwjCheckout:269` ← `POST store/v1/checkout/complete` (`Idempotency-Key`) ← `CommerceCheckoutService::complete:502` ← `CommerceOrderService::createFromCheckout:188` | لا ضريبة/خصم على الطلب؛ COD لا يحجز مخزوناً |
| CommerceOrder → Payment | Partially | `CommercePaymentIntentService::createForOrder:55`؛ الإلكتروني `POST store/v1/checkout/payment-intent` | الإلكتروني مغلق بـG3؛ لا استرداد؛ COD تحصيل بلا قيد |
| Payment → Fulfillment | **Missing** | لا نموذج شحنة/تتبع/ناقل؛ `commerce/workspace/.../fulfillment` يحدد **مخزن المصدر** لا شحن الطلب | كامل |
| Fulfillment → Invoice/ZATCA | Partially | `CommerceOrderPostingService::post:68` للدفع الإلكتروني فقط وبأربعة شروط (`CommerceInvoiceOnPayment::active()`) | COD: لا فاتورة ولا سند؛ لا مُشغِّل عند التنفيذ (PR-COM-10 خطة فقط) |

## ج.2 مصفوفة التغطية الوظيفية

**الأعمدة:** [الحالة] · [مصدر الحقيقة] · [دليل الواجهة `ملف::دالة`] · [نقطة API] · [دليل الخلفية] · [اختبارات] · [مستخدم في الواجهة؟].
اختصارات: SF = `store/v1` (ويب)، CM = `commerce/v1` (جوال)، WS = مسارات الموظفين `routes/api.php`. اختبارات الواجهة تحت `storefront/src/**`، الخلفية تحت `tests/Feature/`.

### أ) الكتالوج والاكتشاف
| ID | الوظيفة | الحالة | المصدر | دليل الواجهة | API | دليل الخلفية | اختبارات | مستخدم |
|---|---|---|---|---|---|---|---|---|
| F01 | قائمة المنتجات/بحث/ترتيب/فلاتر | **Implemented** | AWJ | `lib/commerce/products.ts::fetchProducts:86`؛ `lib/data/products.ts::getProducts` | `GET store/v1/products` (`search,category_id,sort,page,per_page,ids[],city,region,deliver_today,brand_id,collection,facet[]`) | `StorefrontProductController::index` | `StorefrontCatalogApiTest`؛ `lib/commerce/__tests__/products.test.ts`, `listing-facets.test.ts` | ✔ |
| F02 | تفاصيل المنتج: متغيرات/خيارات/وسائط/إضافات/تخصيص/وحدات | **Implemented** | AWJ | `products.ts::fetchProduct:124`؛ `mappers.ts` | `GET store/v1/products/{id}` | `StorefrontProductController::show` | `StorefrontVariantCommerceTest`, `CommerceAddonCartTest`, `CommercePersonalizationCartTest`؛ `mappers.test.ts`, `pdp-gifting.test.ts` | ✔ |
| F03 | التصنيفات/المجموعات/الأوجه + صور الأبعاد | **Implemented** | AWJ | `categories.ts::fetchCategories:10`؛ `facet-visual-media.ts` | `GET store/v1/{categories,collections,media/facet-visuals}` | `StorefrontCategoryController`, `StorefrontCollectionController` | `CommerceFacetStorefrontFilterTest`, `StorefrontFacetVisualPublicTest`؛ `categories.test.ts` | ✔ |
| F04 | العروض (خصم حيّ من `CommercePriceResolver`) | **Implemented** (ميزة AWJ، لا مقابل لها في Spree) | AWJ | `lib/commerce/offers.ts::fetchOffers:86` | `GET store/v1/offers` | `StorefrontOfferController::index` | `StorefrontOfferPublicApiTest`؛ `offers.test.ts` | ✔ |
| F05 | التوفر/المخزون | **Partially** — `in_stock` منطقي فقط، بلا كميات ولا backorder | AWJ | `mappers.ts` | ضمن F01/F02 | batch ATS | `StorefrontCatalogApiTest` | ✔ |
| F06 | بحث متقدم (Meilisearch/ملاءمة) | **Partially** — `LIKE` على الاسم/SKU؛ ترتيب `name|sale_price|created_at` فقط | AWJ | `products.ts:94-96` | `search`, `sort` | `StorefrontProductController::SORTS` | — | ✔ |
| F07 | التقييمات والمراجعات | **Missing** (غير موجودة أيضاً في Spree Storefront الأصلي) | — | — | — | لا نموذج | — | ✘ |
| F08 | المفضلة (Wishlist) | **Missing** (`design_only`) | — | `contexts/WishlistContext.tsx` (ذاكرة صفحة فقط)؛ `capabilities.ts:50` | لا | لا | `WishlistContext` tests | ✘ (أيقونة بلا أثر) |
| F09 | Sitemap/robots | **Spree-dependent** (يُسلَّم فارغاً بصمت) | Spree (غير مضبوط) | `lib/data/sitemap.ts:27-74`؛ `app/sitemap.ts:105-139` | — (AWJ يوفّر `store/v1/products|categories`) | — | `lib/data/__tests__/sitemap.test.ts` (يحاكي Spree) | ✔ (مكسور) |
| F10 | JSON-LD/OG/SEO | **Implemented** (أنواع Spree فقط) | AWJ | `lib/seo.ts`, `lib/metadata/*` | — | — | `lib/metadata/__tests__/*` | ✔ |

### ب) السلة
| ID | الوظيفة | الحالة | المصدر | دليل الواجهة | API | دليل الخلفية | اختبارات | مستخدم |
|---|---|---|---|---|---|---|---|---|
| F11 | إضافة/تعديل/حذف بند (ضيف) | **Implemented** | AWJ | `lib/commerce/cart.ts::{addAwjCartItem:46,updateAwjCartItem:94,removeAwjCartItem:107}`؛ `contexts/CartContext.tsx:129-168` | `POST|PATCH|DELETE store/v1/cart/items[/{item}]` | `StorefrontCartController` (خلف `RequireStorefrontMutationGateway`) | `StorefrontCartApiTest`, `StorefrontCartPostgresConcurrencyTest`, `CommerceCartOneShotLifecycleTest`؛ `cart.test.ts`, `cart-cookies.test.ts`, `CartContext.test.tsx` | ✔ |
| F12 | إجماليات السلة (خصم/شحن/ضريبة/إجمالي) | **Partially** — `subtotal` فقط، لا `total` ولا خصم ولا ضريبة | AWJ | `components/cart/CartSummary.tsx` (لا يحسب إجماليات عميل) | `GET store/v1/cart` | `CommerceCartService.php:710` | `cart-types.test.ts` | ✔ |
| F13 | هوية السلة (كوكي) | **Implemented** | AWJ | `lib/commerce/cart-cookies.ts` (`awj_cart_token`) | — | `CommerceCartService::COOKIE_NAME` | `cart-cookies.test.ts` | ✔ |
| F14 | سلة مرتبطة بحساب + دمج سلة الضيف | **Missing** على الويب (Spree: `finalizeAuth` يقرأ كوكي Spree فقط) | — | `lib/data/customer.ts:43-55` (ميت لـAWJ) | CM فقط عبر `resolveCurrent` | `CommerceCartMergeApiTest` (جوال) | — | ✘ |
| F15 | سلة Spree (جملة) | **Spree-dependent** | Spree | `lib/data/cart.ts:132-320` | — | — | `lib/data/__tests__/cart.test.ts` (محاكاة) | ✘ (بوابة الجملة مغلقة) |
| F16 | كود خصم/كوبون | **Missing** (`design_only`؛ الإصدار القديم Spree-dependent) | — | `components/cart/CouponField.tsx` (لا طلب)؛ `COUPON_CAPABILITY`؛ `data/checkout.ts::applyCode:182` (Spree، ميت لـAWJ) | لا | لا (ADR-11 تأجيل) | `CartDrawer.test.tsx` | ✔ (حقل صادق يرفض) |

### ج) Checkout
| ID | الوظيفة | الحالة | المصدر | دليل الواجهة | API | دليل الخلفية | اختبارات | مستخدم |
|---|---|---|---|---|---|---|---|---|
| F17 | بدء/استئناف checkout | **Implemented** | AWJ | `checkout.ts::createOrResumeAwjCheckout:47`؛ `data/awj-checkout.ts::startOrResumeAwjCheckout` | `POST store/v1/checkout` | `StorefrontCheckoutController::store` | `StorefrontCheckoutApiTest`؛ `checkout.test.ts` | ✔ |
| F18 | بيانات الاتصال | **Implemented** | AWJ | `updateAwjCheckoutContact:60`؛ `awj/ContactStage.tsx` | `PATCH store/v1/checkout/contact` | `updateContact` | `StorefrontCheckoutApiTest` | ✔ |
| F19 | عنوان التسليم | **Partially** — مفاتيح السماح: `country,region,city,district,street,postal_code,notes`؛ **لا `building_no`/`additional_number` (العنوان الوطني) رغم أن الاستجابة تعيدها**؛ لا إحداثيات | AWJ | `updateAwjCheckoutAddress:79`؛ `awj/AddressStage.tsx` | `PATCH store/v1/checkout/address` | `StorefrontCheckoutController::updateAddress:158` (CM يدعم SPL) [V] | `StorefrontCheckoutApiTest` | ✔ |
| F20 | دفتر عناوين محفوظ في Checkout | **Missing** على SF (CM فقط) | — | `ACCOUNT_ADDRESSES_CAPABILITY=design_only` | CM `addresses` | `CommerceCustomerAddressService` | `CommerceCustomerAddressApiTest` | ✘ |
| F21 | طريقة التوصيل | **Partially** — ثابتتان `pickup|standard` (`CommerceCheckoutService.php:72`)؛ لا endpoint لسردها/تسعيرها | AWJ | `updateAwjCheckoutDelivery:97` | `PATCH store/v1/checkout/delivery` | `updateDelivery:186` | `StorefrontCheckoutApiTest` | ✔ |
| F22 | تسعير الشحن | **Partially** — أجرة مسطحة لكل منطقة (مدينة ثم إقليم)؛ لا وزن/سعر/ناقل؛ لا «شحن مجاني فوق حدّ» | AWJ | `awj/DeliveryStage.tsx` | ضمن `checkout` (`delivery.amount`) | `ShippingRateService::resolveRateMinor`؛ WS `commerce/workspace/shipping-zones` | `CommerceShippingZoneTest` | ✔ |
| F23 | جدولة التسليم (تاريخ+نافذة+وعد التسليم) | **Implemented** (ميزة AWJ) | AWJ | `checkout.ts::fetchAwjDeliverySchedule:224`, `updateAwjCheckoutSchedule:207`؛ `awj/ScheduleStage.tsx` | `GET store/v1/delivery-schedule`؛ `PATCH checkout/schedule` | `CommerceDeliveryScheduleService`, `CommerceDeliveryPromiseService` | `CommerceDeliveryScheduleTest`, `…CheckoutTest`, `CommerceDeliveryPromiseTest`؛ `checkout-gifting.test.ts` | ✔ |
| F24 | الإهداء (مستلم/مرسل/رسالة) | **Implemented** (ميزة AWJ) | AWJ | `updateAwjCheckoutGift:193`؛ `awj/GiftStage.tsx` | `PATCH store/v1/checkout/gift` | `updateGift:119` | `CommerceGiftIdentityTest`؛ `AwjCheckoutFlow.gifting.test.tsx` | ✔ |
| F25 | طرق الدفع المتاحة للقناة | **Implemented** | AWJ | `fetchAwjPaymentMethods:113`, `mergeAwjOnlineMethods:131`؛ `awj/PaymentStage.tsx` | `GET store/v1/checkout/payment-methods` | `StorefrontCheckoutController::paymentMethods` | `StorefrontBetaOnlineMethodsTest`؛ `PaymentStage.test.tsx` | ✔ |
| F26 | اختيار الدفع | **Implemented** | AWJ | `updateAwjCheckoutPayment:162` | `PATCH store/v1/checkout/payment` | `updatePayment` | `StorefrontCheckoutApiTest` | ✔ |
| F27 | إتمام الطلب (idempotent) + `review_required` | **Implemented** | AWJ | `completeAwjCheckout:269`؛ `data/awj-checkout.ts::completeAwjCheckoutAction`؛ `checkout-idempotency.ts` | `POST store/v1/checkout/complete` | `StorefrontCheckoutController::complete:272`؛ `CommerceCheckoutService::replayOrConflict:659`, `revalidateAndPrice:692` | `StorefrontCheckoutCompletionApiTest`, `…PostgresConcurrencyTest`؛ `checkout-idempotency.test.ts`, `AwjCheckoutFlow.test.tsx` | ✔ |
| F28 | Checkout لمشترٍ موثَّق | **Missing** (ضيف فقط؛ `customer_identity_id=null` لطلبات SF) | — | `capabilities.ts` | — | `StorefrontCheckoutController` يستعمل `findByToken` لا `resolveCurrent` | — | ✘ |
| F29 | شحنات متعددة (multi-shipment) | **Missing** (أصيل في Spree؛ لا نموذج في AWJ) | — | `components/checkout/DeliveryMethodSection.tsx` (Spree، ميت لـAWJ) | — | — | — | ✘ |
| F30 | عرض الضريبة في السلة/Checkout | **Missing** عمداً (`TAX_PRESENTATION=deferred`) | — | `capabilities.ts:149` | — | `CommerceOrderService` يجمع بلا ضريبة؛ الضريبة تُشتق عند الفوترة | — | ✘ |
| F31 | Checkout سريع (Apple/Google Pay مدمج) | **Spree-dependent** (للجملة/الرابط القديم)؛ AWJ: Apple Pay كوسيلة مستضافة ضمن F34 | Spree | `components/checkout/ExpressCheckoutButton.tsx`; `data/express-checkout-flow.ts` | — | — | — | ✘ |

### د) الطلب (CommerceOrder)
| ID | الوظيفة | الحالة | المصدر | دليل الواجهة | API | دليل الخلفية | اختبارات | مستخدم |
|---|---|---|---|---|---|---|---|---|
| F32 | إنشاء الطلب + لقطات السعر/الاسم/الوحدة + رقم `CORD` | **Implemented** | AWJ | `completeAwjCheckout:269` | `POST store/v1/checkout/complete` | `CommerceOrderService::createFromCheckout:188`, `nextNumber:430` | `StorefrontCheckoutCompletionApiTest`, `CommerceOrderServiceTest` | ✔ |
| F33 | إعادة التحقق من السعر/المخزون عند الإتمام | **Implemented** (نقطة زمنية؛ لا حجز لـCOD ⇒ فرط بيع ممكن) | AWJ | — | — | `revalidateAndPrice:692-862`؛ `holdStockForPayment` للإلكتروني فقط (`:610`) [V] | `…review_required…` tests؛ `two_independent_checkouts_can_both_complete_against_the_same_limited_stock` | ✔ |
| F34 | صفحة تأكيد الطلب (داخل الجلسة) | **Implemented** | AWJ | `components/checkout/awj/Confirmation.tsx::AwjOrderConfirmation:32` | استجابة `complete` | `StorefrontCheckoutController::serializeOrder:340` | `Confirmation.gifting.test.tsx` | ✔ |
| F35 | عرض تفاصيل طلب لاحقاً (مشترٍ/ضيف) | **Missing** على SF (`design_only`)؛ CM: `GET commerce/v1/orders/{id}` + `X-Order-Reference`، `me/orders/{id}` | — | `app/…/account/(authenticated)/orders/[id]/page.tsx` (إشعار صادق)؛ `ACCOUNT_ORDER_LOOKUP`; نسخة Spree `components/account/OrderDetail.tsx` ميتة، و`(checkout)/order-placed/[id]` Spree | لا `store/v1` | `CommerceOrderController::show`؛ `CommerceOrderSerializer::serialize:46` | `CommerceOrderStatusApiTest` (14) | ✘ |
| F36 | سجل الطلبات | **Missing** على SF؛ CM: `GET commerce/v1/me/orders` | — | `…/orders/page.tsx` (`orders={[]}` + إشعار)؛ `OrderList.tsx` Spree ميت | لا `store/v1` | `CommerceOrderService::ownedOrders:583` | `CommerceCustomerOrderApiTest` (10) | ✘ |
| F37 | نموذج حالات الطلب | **Partially** — `draft|confirmed` فقط؛ الطلبات تُنشأ `confirmed` مباشرة؛ لا حالة دفع/تنفيذ على الطلب؛ `draft` ميتة | AWJ | `ACCOUNT_ORDER_STATUS=design_only` | — | `CommerceOrder.php:59-61` [V]؛ `confirm()` بلا مستدعٍ | `CommerceOrderServiceTest` | ✘ |
| F38 | إلغاء الطلب (مشترٍ أو موظف) | **Missing** — لا إلغاء على مستوى الطلب؛ إلغاء نية الدفع فقط (WS `POST commerce/payment-intents/{id}/cancel`) ويترك الطلب `confirmed` | — | — | — | `CommercePaymentIntentService::cancel:135` | `CommercePaymentIntentTest` | ✘ |
| F39 | إدارة الطلبات للموظف (قائمة/تفاصيل/تأكيد/تنفيذ) | **Missing** — لا مسار يشير إلى `CommerceOrder` في `routes/api.php` [V]؛ أقرب شيء `GET commerce/payment-intents` | — | — | — | لا متحكم، لا صلاحية `commerce.orders.*` | — | ✘ |
| F40 | خط زمني/أحداث الطلب | **Missing** | — | — | — | لا جدول | — | ✘ |

### هـ) الدفع
| ID | الوظيفة | الحالة | المصدر | دليل الواجهة | API | دليل الخلفية | اختبارات | مستخدم |
|---|---|---|---|---|---|---|---|---|
| F41 | نية دفع COD/الاستلام | **Implemented** | AWJ | `awj/PaymentStage.tsx` | ضمن `complete` | `CommercePaymentIntentService::createForOrder:55` | `CommercePaymentIntentTest` | ✔ |
| F42 | تحصيل COD (موظف) | **Partially** — WS `collect` يحدّث الحالة **بلا أثر محاسبي** | AWJ | — | WS `POST commerce/payment-intents/{id}/collect` (`payments.manage`) | `markCollected:110` | `CommercePaymentIntentTest` | — (إداري) |
| F43 | دفع إلكتروني مستضاف: بدء + حالة + عودة | **Partially** — منجز لكنه **مغلق** (`payments.commerce_online_checkout.enabled=false`، G3 غير معتمد) | AWJ | `lib/commerce/online-payment.ts::{startAwjOnlinePayment:75,fetchAwjOnlinePaymentStatus:91}`؛ `data/awj-online-payment.ts::{startOnlinePaymentAction:51,getOnlinePaymentStatusAction:65}`؛ `awj/PaymentReturn.tsx`; `pending-online-payment.ts` | `POST store/v1/checkout/payment-intent`؛ `GET store/v1/orders/{order}/payment-status` | `StorefrontOnlinePaymentController::{start,status}`؛ `CommerceOnlinePaymentService::{start:91,status:159}` | `StorefrontOnlinePaymentTest` (36)، `…PostgresConcurrencyTest`, `OnlineOrderStockHoldTest`؛ `PaymentReturn.test.tsx`, `PaymentReturn.locales.test.tsx`, `pending-online-payment.test.ts`؛ e2e `payment-return-qa.spec.ts` (fixture) | ✘ (مغلق افتراضياً) |
| F44 | إكمال الالتقاط/ويبهوك/شبكة أمان/التقاط متأخر | **Implemented** (خلفية) | AWJ | — | مستمع `CompleteCommerceOnlinePayment`؛ أمر `payments:complete-commerce-captures` | `CommerceOnlinePaymentService::completeCaptured:200`, `runPending:285` | `StorefrontOnlinePaymentTest` | — |
| F45 | حجز مخزون الطلب الإلكتروني + مكنسة | **Implemented** (مغلق بالبوابة نفسها) | AWJ | — | أمر `commerce:expire-unpaid-orders` (5 دقائق) | `CommerceOrderReservationService::{reserve:97,releaseActive:193,consumeActive:212}`؛ `CommerceUnpaidOrderSweeper` | `CommerceOrderReservationServiceTest` (30)، `…PostgresConcurrencyTest` | — |
| F46 | بطاقات/محافظ بـSDK مدمج (Stripe/Adyen/PayPal، 3DS، Klarna/Affirm/SEPA) | **Spree-dependent** (مسار الجملة/الرابط القديم) | Spree | `components/checkout/{PaymentSection,StripePaymentForm,AdyenPaymentForm,PayPalPaymentForm}.tsx`؛ `data/payment.ts:37-228` | — | — | `lib/data/__tests__/payment.test.ts` (محاكاة) | ✘ |
| F47 | بطاقات محفوظة للمشتري | **Missing** (`design_only`؛ Spree `credit-cards.ts` ميت لـAWJ) | — | `AccountPaymentMethods.tsx`; `data/credit-cards.ts:12,22` | لا | لا | — | ✘ |
| F48 | استرداد مبلغ طلب ويب | **Missing** — `PaymentRefundService` موجود لكن `partnerIdOf` يعيد `not_refundable` لـ`commerce_payment_intent:*` | — | — | — | `PaymentRefundService::partnerIdOf:674,attemptBlocker:649` [A]؛ تقارير H4-03 | لا اختبار مخصص (غير متحقَّق) | ✘ |
| F49 | نزاعات/chargeback | **Partially** — عام (`PaymentAttempt::DISPUTE_OPEN`) بلا ربط بـ`CommerceOrder` | AWJ | — | — | `PaymentAttempt` | غير متحقَّق | — |

### و) التنفيذ والشحن
| ID | الوظيفة | الحالة | المصدر | دليل الواجهة | API | دليل الخلفية | اختبارات | مستخدم |
|---|---|---|---|---|---|---|---|---|
| F50 | مخزن مصدر التنفيذ للقناة | **Implemented** (إعداد) | AWJ | — | WS `commerce/workspace/storefronts/{id}/fulfillment` | `FulfillmentPolicyService`، `CommerceFulfillmentController` | `CommerceFulfillmentAdminApiTest` | — |
| F51 | شحنة/رقم تتبع/ناقل/«تم الشحن»/«تم التسليم» | **Missing** (Spree: `FulfillmentBlock` + بريد shipped) | — | `components/order/FulfillmentBlock.tsx` (Spree، ميت لـAWJ)؛ `ACCOUNT_ORDER_STATUS=design_only` | لا | لا نموذج (خطة PR-COM-9 فقط) | — | ✘ |
| F52 | اختيار فرع استلام (PickupLocation) | **Missing** — `pickup` طريقة بلا موقع | — | — | — | `CommerceBoundary.php:62`؛ ADR-19 §5 مؤجَّل | — | ✘ |

### ز) المرتجعات والاسترداد
| ID | الوظيفة | الحالة | المصدر | دليل | اختبارات |
|---|---|---|---|---|---|
| F53 | طلب إرجاع من المشتري (RMA) | **Missing** (غير موجود في README/مزايا Spree Storefront الأصلي أيضاً) | — | لا نموذج؛ خطة PR-COM-11A–D | — |
| F54 | استرداد مالي لطلب ويب | **Missing** (= F48) | — | `not_refundable` | — |
| F55 | إشعار دائن/إرجاع محاسبي مرتبط بطلب ويب | **Missing** — `ReturnDocument`/`CreditNote` محاسبية بلا ربط بـ`CommerceOrder`؛ طلب COD بلا فاتورة أصلاً فلا شيء يُسترد | ERP | `app/Models/{ReturnDocument,CreditNote}.php` | `CreditNotePostingOwnershipTest` (ERP) |
| F56 | استبدال (exchange) | **Missing** | — | خطة PR-COM-11D | — |

### ح) الفوترة وZATCA
| ID | الوظيفة | الحالة | المصدر | دليل | اختبارات |
|---|---|---|---|---|---|
| F57 | `CommerceOrder ≠ Invoice` (لا أثر محاسبي عند الإنشاء) | **Implemented** | AWJ | `CommerceBoundary`؛ `createFromCheckout` | `CommerceModuleBoundaryTest`؛ `completion_creates_no_accounting_inventory_or_reservation_side_effects` |
| F58 | فاتورة مبسّطة + سند بوابة عند التقاط إلكتروني مؤكَّد | **Partially** — منجز **ومغلق**: يتطلب بوابة نشر + `tax_opinion_ref` (EXT-05) + `sales.commerce_invoice_trigger=on_payment_confirmed` + `sales.commerce_price_tax_mode=inclusive` + نية `paid` + `partner_id` + كل المنتجات 15% | AWJ | `CommerceOrderPostingService::{post:68,issue:149}`؛ `CommerceInvoiceOnPayment::active()` | `CommerceInvoiceOnPaymentTest` (13)، `CommerceInvoicePostingPostgresConcurrencyTest` |
| F59 | فاتورة/قيد لطلب COD/استلام | **Missing** — لا مسار؛ `markCollected` بلا أثر | — | `CommerceOrderPostingService::post:71` يتخطى غير الإلكتروني | — |
| F60 | فاتورة عند التنفيذ/الشحن | **Missing** (لا حدث تنفيذ؛ خطة PR-COM-10) | — | — | — |
| F61 | تنزيل الفاتورة الضريبية للمشتري | **Missing** عمداً (ممنوع عرض «Invoice/Receipt» لـCommerceOrder حسب `capabilities.ts:193`) | — | — | — |
| F62 | ربط المشتري الإلكتروني بطرف (`partner_id`) | **Implemented** (سياسة `sales.commerce_partner_policy`) ؛ تحت `manual_link` لا endpoint لتعيينه | AWJ | `CustomerPartnerResolver::resolveForOrder` | `CommerceInvoiceOnPaymentTest` |

### ط) الإشعارات والبريد
| ID | الوظيفة | الحالة | المصدر | دليل | اختبارات |
|---|---|---|---|---|---|
| F63 | بريد تأكيد الطلب للمشتري | **Spree-dependent ⇒ عملياً Missing** — القالب `lib/emails/order-confirmation.tsx` يُشغَّل بحدث Spree `order.completed` (`lib/webhooks/handlers.ts::handleOrderCompleted`) عبر `app/api/webhooks/spree/route.ts` (503 بلا `SPREE_WEBHOOK_SECRET`)؛ **لا شيء في AWJ يصدر الحدث** | Spree (يتيم) | `route.ts:12`؛ `CommerceOrderService::createFromCheckout` لا يرسل | — |
| F64 | بريد الشحن/الإلغاء (`order.shipped`/`order.canceled`) | **Spree-dependent ⇒ Missing** (لا شحن ولا إلغاء في AWJ) | Spree (يتيم) | `handlers.ts` | — |
| F65 | بريد إعادة تعيين كلمة المرور | **Spree-dependent ⇒ Missing** للعملاء (`AuthActionMail` للموظفين فقط) | Spree (يتيم) | `handlePasswordReset` | — |
| F66 | إشعار فشل الدفع للمشتري | **Missing** (استطلاع `payment-status` فقط) | — | `StorefrontOnlinePaymentController::status` | — |
| F67 | تنبيه التاجر بطلب ويب جديد | **Missing** (`NotificationService` بلا جسر Commerce) | — | `docs/plans/alerts-notifications/*` لا تذكره | — |
| F68 | OTP/تحقق | **Partially (مُحاكى)** — `FakeOtpProvider` | — | `CommerceApiServiceProvider.php:52` | — |
| F69 | منصة الاتصالات (outbox) | **Partially** — إدخال فقط (`CommunicationOutbox::enqueue`)؛ لا dispatcher/مزوّد في `main` (PR #1531 مفتوح، غير مدمج) | AWJ | `app/Support/Communications/*` | `CommunicationOutboxEnqueueTest` |

### ي) الحساب والهوية (مرجع للتدقيق الرئيسي §5–§6)
| ID | الوظيفة | الحالة | ملاحظة |
|---|---|---|---|
| F70 | تسجيل/دخول/خروج/جلسة/تجديد | **Spree-dependent** | `customer.ts:135,171,189`؛ لا عقد SF؛ CM/`customer/v1` موجودان لكن غير قابلين للوصول؛ التسجيل 202 بلا توكن |
| F71 | تحقق البريد/الهاتف، نسيان/إعادة كلمة المرور | **Missing** (قناة مفتوحة) | CUS-ARCH-0 |
| F72 | الملف الشخصي/تغيير كلمة المرور | **Spree-dependent ⇒ Missing** | `updateCustomer:257` |
| F73 | دفتر العناوين | **Missing** على SF (CM Implemented) | F20 |
| F74 | بطاقات هدايا/رصيد متجر | **Missing** (لا نموذج في AWJ؛ Spree `gift-cards.ts` بلا مستورد؛ `GiftCardList.tsx` ميت) | `Partner.credit_limit` ائتمان ذمم لا أداة دفع |

### ك) المحتوى والمنصة
| ID | الوظيفة | الحالة | ملاحظة |
|---|---|---|---|
| F75 | صفحات السياسات | **Spree-dependent** (500) | لا endpoint AWJ؛ D-4 |
| F76 | الأسواق/العملات/الدول | **Partially** — سوق ثابت (SA/SAR) في `data/markets.ts::staticAwjMarket`؛ `resolveMarket/getMarketCountries` Spree لمسار قديم | `RegionPreferences` يعمل بسوق واحد |
| F77 | تحليلات GA4/GTM | **Partially** — `view_item`/`add_to_cart` تعمل (`ProductDetails.tsx:146,278,293`)؛ `view_cart`/`remove_from_cart` محصوران في سلة Spree (`cart/page.tsx:50-56`، `CartDrawer.tsx:98,216`)؛ **`begin_checkout`/`add_shipping_info`/`add_payment_info`/`purchase` تُطلق من Checkout Spree فقط ولا من `AwjCheckoutFlow`** [V] | خسارة قياس الشراء موجودة اليوم ولا يعالجها حذف Spree |
| F78 | بوابة الجملة | **Spree-dependent** (اختيارية/مغلقة) | D-3 |
| F79 | وسائط/بروكسي/المظهر/اللغات الست/RTL | **Implemented** | `app/api/storefront/media/*`، `messages/*` |

### ل) غير متحقَّق منه (حدود هذا التدقيق)
| ID | الوظيفة | الحالة | سبب عدم التحقق |
|---|---|---|---|
| F80 | تسعير الشرائح/الكمية (tiered) | **Unverified** | لم يُعثر على منطق شرائح في `PriceListService`؛ لا دليل على وجوده أو غيابه الكامل |
| F81 | منتجات ذات صلة/موصى بها | **Unverified** | غير موجودة ضمن حقول الموارد المرصودة؛ لم يُفحص كل المسارات |
| F82 | ربط `DeliveryHubOrder` (وحدة ERP) بـ`CommerceOrder` كتتبع توصيل | **Unverified** | وحدة مستقلة؛ لم يُرصد ربط لكن لم تُفحص بالتفصيل (`routes/api.php:242` موصّل موقَّع) |
| F83 | اختبار يثبّت `not_refundable` لطلبات المتجر | **Unverified** | لم يُعثر على اختبار مخصص؛ النص من تقارير H4 |
| F84 | وحدات القياس (UoM) مكشوفة في `GET products/{id}` | **Unverified** | `unit_key` مقبول في السلة؛ عرضه في تفاصيل المنتج لم يُفتح |

### ملخّص الأعداد
إجمالي الوظائف المفحوصة: **84** (F01–F84) — **Implemented 24** · **Partially Implemented 15** · **Spree-dependent 11** · **Missing 29** · **Unverified 5**.

ملاحظات القراءة: (1) «Spree-dependent» تشمل ثلاثة بنود بريد/إعادة تعيين تُصنَّف عملياً Missing لأن مصدرها يتيم؛ (2) صفوف Implemented التي تعمل مغلقة بالبوابة معدودة Partially؛ (3) كل وظائف «Missing/Partially» الخلفية **لا يحلّها حذف Spree** — هي عمل منتج مستقل مُسجَّل في الملحق ب.

## ج.3 ما قد نفقده عند إزالة اعتماديات Spree (من واجهة Spree الأصلية)

المرجع: جدول المزايا في `storefront/README.md` (الأصلي) وكود الفورك. **القاعدة:** لا وظيفة Spree تعمل اليوم في أي بيئة بلا Backend Spree، لذا «الفقد» = فقدان **تصميم/كود قابل لإعادة الاستعمال** أو **قدرة محتملة**، لا قدرة عاملة. لكل بند: القرار المقترح.

| قدرة Spree الأصلية | في الفورك | تعمل في AWJ اليوم؟ | تُفقد عند الإزالة؟ | بديل AWJ / القرار |
|---|---|---|---|---|
| تصفح/بحث/فلاتر | نعم (AWJ-native) | نعم | لا | — |
| Meilisearch | غير مدمج | — | لا | اختياري لاحق |
| سلة (خادمية) | نعم (AWJ-native للـDTC) | نعم | لا | — |
| Checkout صفحة واحدة، ضيف+مسجَّل | AWJ: مراحل متعددة | ضيف فقط | **المسجَّل** (غير عامل أصلاً) | B5/S4 |
| **شحنات متعددة** | Spree `DeliveryMethodSection` | لا | نعم (تصميم) | **Drop** (لا نموذج AWJ؛ قرار D-7) |
| **أكواد خصم** | `CouponCode.tsx` (Spree) + `CouponField` (AWJ صادق) | لا | الكود القديم؛ حقل AWJ يبقى | P1 (ADR-11 إلغاء التأجيل) |
| **بطاقات الهدايا** | `GiftCardList`, `gift-cards.ts` (ميتان) | لا | نعم | D-5: Drop أو عقد مستقل (P2) |
| **رصيد المتجر (Store Credit)** | `PaymentInfo`/Summary | لا | نعم | D-5 |
| Stripe/Adyen/PayPal مدمجة (Apple/Google Pay, Klarna, Affirm, SEPA, 3DS) | `PaymentSection` وملحقاته | لا | نعم | **Replace** بدفع مستضاف AWJ (F43)؛ الوسائل (مدى/Visa/MC/Apple Pay) عبر `PAY-BETA-METHODS` |
| بطاقات محفوظة | `CreditCardList` (ميت) | لا | نعم | D-5 / عقد توكنة لاحق |
| حساب: ملف، سجل طلبات + تفاصيل، دفتر عناوين | مكوّنات AWJ `AccountOrder*`/`AccountAddresses` (design_only) | لا | لا (تُحفظ تصاميم AWJ) | B/S tracks |
| بوابة الجملة (gating، أسعار لكل عميل، موافقة حساب) | `(wholesale)/**` | لا | نعم | **Drop** (D-3)؛ أسعار العميل موجودة في AWJ عبر `CommercePriceResolver` (قوائم أسعار الطرف) لمنتج مستقل لاحقاً |
| متعدد المناطق (Markets) | سوق ثابت AWJ | جزئياً | لا (AWJ سوق واحد) | قرار منتج عند التوسع |
| GA4/GTM كامل (begin_checkout…purchase) | يعمل في Checkout Spree فقط | **لا** على AWJ | **نعم، قياس الشراء** | **AN1** قبل حذف المساعدات |
| صفحات السياسات | Spree API | لا (500) | نعم | D-4 |
| SEO/JSON-LD/Sitemap | جزئي | sitemap لا | لا بعد X3 | X3 |
| بريد المعاملات: تأكيد/شحن/استعادة (+إلغاء) عبر Resend وويبهوك Spree | قوالب `lib/emails/*` | **لا** (يتيمة) | القوالب/المعالجات | **N-track** (outbox + مزوّد)؛ القوالب تُحفظ مرجعاً |
| Sentry | نعم | نعم | لا | — |
| Quick Order / SKU combobox للجملة | `quick-order/*` | لا | نعم | مع D-3 |
| صفحة `order-placed/[id]` وتفاصيل الطلب | Spree | لا | نعم | O2 (AWJ بالمرجع الموقّع) |
| تتبع الشحنة/حالة التنفيذ | `FulfillmentBlock` | لا | نعم (تصميم) | F-track |

## ج.4 نتائج جديدة (مخاطر/فجوات تظهر من التتبّع الشامل)

| ID | الخطورة | النتيجة | الدليل | ملاحظة |
|---|---|---|---|---|
| N-01 | **عالية (مالية)** | طلب **COD** (الدفع الافتراضي على الويب) لا يُنتج أي مستند مالي (فاتورة/سند/قيد) في أي مرحلة، ولا يحجز مخزوناً | `CommerceOrderPostingService::post:71` يتخطى غير الإلكتروني؛ `CommerceCheckoutService.php:610` | **مستقل عن Spree**؛ يجب قرار محاسبي قبل ادعاء «تغطية كاملة» (INV-track) |
| N-02 | عالية | لا واجهة موظف لقراءة/إدارة **طلبات الويب** إطلاقاً (لا `commerce.orders.*`) | `rg CommerceOrder routes/` [V] | يمنع التشغيل اليومي حتى مع Spree؛ O1 |
| N-03 | عالية | نموذج الطلب `draft|confirmed` فقط؛ لا إلغاء؛ إلغاء النية يترك الطلب `confirmed` (تعارض حالتين) | `CommerceOrder.php:59-61`؛ `CommercePaymentIntentService::cancel:135` | O3 يحتاج ADR |
| N-04 | عالية | لا قناة إشعار للمشتري إطلاقاً؛ حذف Spree يحذف المسار الوحيد (اليتيم) | F63–F65 | N-track يعتمد D-2 + PR #1531 |
| N-05 | متوسطة | قياس GA4 للشراء مفقود في AWJ Checkout | F77 [V] | AN1 قبل R1 |
| N-06 | متوسطة | العنوان الوطني السعودي (`building_no`,`additional_number`) لا يُضبط من الويب رغم أنه في الاستجابة | `StorefrontCheckoutController.php::updateAddress:158` | CK1، تغيير إضافي |
| N-07 | متوسطة | محرك الاسترداد العام مبني لكنه غير قابل للوصول لطلبات المتجر | `PaymentRefundService::partnerIdOf:674` [A] | RT3 |
| N-08 | متوسطة | أنواع طرق التوصيل ثابتة بلا endpoint | `CommerceCheckoutService.php:72` | CK2 |
| N-09 | منخفضة | `serializeOrder` في متحكم SF نسخة مختلفة عن `CommerceOrderSerializer` | `StorefrontCheckoutController.php:340` مقابل `CommerceOrderSerializer.php:46` | قرار توحيد قبل O2؛ شكل الاستجابة الحالي مجمّد باختبار الرحلة |
| N-10 | منخفضة | تعليقات `capabilities.ts` قديمة جزئياً (عدّ مسارات checkout) | `capabilities.ts:60-77` | تصحيح وثائقي |
| N-11 | معلومة | **بوابتان مغلقتان** تحكمان تسلسل التفعيل: G3 (الدفع الإلكتروني) وEXT-05 (الفوترة) | `config/payments.php`; `CLAUDE.md` PAY-H4 | لا تُفتحان ضمن هذه الخطة |
| N-12 | معلومة | خطة المنتج الرئيسية تقول «حجز عند التأكيد» لكن الحجز للإلكتروني فقط | `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md:275-287` مقابل الكود [A] | CK4: سياسة قابلة للضبط |

## ج.5 تحديث الخطة

تفاصيل الشرائح الجديدة (O/F/RT/INV/N/P/CK/AN)، أولوياتها، تبعياتها، معايير قبولها واختباراتها في **الملحق ب** من `docs/plans/store/AWJ_SPREE_EXIT_MIGRATION_PLAN.md`. أهم أثر على شرائح الخروج: **R1 يتوقف على AN1**، وحذف قوالب البريد/الويبهوك (**R2**) يتوقف على قرار مكتوب بشأن N-track (قبول فقد مسار بريد يتيم أو إحلال بديل)، و**بوابة الخروج G** تتطلب أن يكون كل صف F01–F84 إما Implemented أو مُسقَطاً بقرار مالك أو مربوطاً بشريحة.
