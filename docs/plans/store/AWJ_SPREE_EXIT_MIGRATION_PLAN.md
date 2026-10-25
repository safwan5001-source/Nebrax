# AWJ Storefront — خطة الخروج من اعتماديات Spree التشغيلية

**الحالة:** خطة فقط — لا تفوّض تنفيذاً أو دمجاً أو نشراً. كل شريحة تحتاج موافقة صريحة من Safwan، والدمج/النشر قراران منفصلان.
**التاريخ:** 2026-10-25 · **الأساس:** `main@0ea1658da61ed730ab695dc89d912492f622aa1d`
**المرجع:** `docs/audits/AWJ_SPREE_FULL_DEPENDENCY_AUDIT.md` (الأدلة والأرقام) · `AWJ_COM_7_SPREE_INTEGRATION_GATE.md` (الثوابت)

---

## 1. المبادئ الحاكمة

1. **الهدف:** إزالة الاعتماد **التشغيلي** على Spree (عميل/متغيّرات/Webhook/مسارات/اختبارات) مع **الاحتفاظ بواجهة المتجر** وترخيص MIT (`LICENSE` + `NOTICE` يبقيان حرفياً). الهجرة ≠ إعادة كتابة الواجهة.
2. **AWJ سلطة البيانات والهوية والتسعير والمخزون** (CommerceOrder ≠ Invoice؛ Reservation ≠ StockMovement؛ لا كتابة مباشرة في الدفتر؛ ZATCA خارج النطاق ما لم تمسّه شريحة صراحة).
3. **ممنوع:** توفير Rails/Spree، ضبط `SPREE_*` بقيم بديلة لإخفاء العيب، تخمين عقد خلفي، اختلاق قدرات في الواجهة (سياسة `DESIGN_ONLY/GATED/DEFERRED`).
4. **الفشل المغلق:** قدرة بلا عقد = موسومة `gated/design_only` + ترفض صراحةً دون استدعاء أي عميل، ولا تُظهر رسائل استثناء خام.
5. **لا إزالة SDK قبل ترحيل كل استيراد قيمة ونوع** (حارس «ratchet» يفرض ذلك، §3).
6. **شرائح صغيرة** بفرع/PR مستقل، كل واحدة قابلة للتراجع، ولا يُجمع تغيير خلفي مع إعادة توجيه واجهة في PR واحد.
7. **Beta/مستأجرو اختبار فقط**، لكن الأمان والصحة المالية مطلوبان كأن الإنتاج حيّ.

---

## 2. قرارات المالك المطلوبة قبل بناء الهوية (لا تُخمَّن)

| ID | القرار | الخيارات | التوصية | يحجب |
|---|---|---|---|---|
| **D-1** | آلية جلسة مشتري الويب أمام `store/v1` | (أ) BFF: خادم Next يحمل توكن المشتري في كوكي HttpOnly ويمرّره في ترويسة (`X-Customer-Token`) مع سر البوابة وHost؛ الخلفية تتحقق من تطابق المستأجر · (ب) كوكي جلسة تُصدرها Laravel على نطاق المتجر · (ج) ضيف فقط حتى إشعار آخر | **(أ)**: يعيد استعمال `CustomerIdentity`/Sanctum والبوابة القائمة، ولا يفتح CORS ولا كوكيز عبر النطاقات | B1–B7، S1+ |
| **D-2** | قناة التحقق واستعادة كلمة المرور | بريد (عبر outbox PR #1531) · هاتف OTP (مزوّد حقيقي بدل `FakeOtpProvider`) · الاثنان | مواءمة `COM-MOBILE-AUTH-1`: هاتف+OTP أساسي وبريد+كلمة مرور بديل؛ **يحتاج مزوّد SMS وقالب بريد** | B3، S2 |
| **D-3** | بوابة الجملة | حذف · إعادة بناء لاحقاً كمنتج مستقل (قوائم أسعار/مجموعات عملاء) | **حذف الآن** — داخلياً متناقضة (كتالوج AWJ + سلة/دخول Spree) ولا مفهوم جملة في AWJ | W1 → R1 |
| **D-4** | مصدر صفحات السياسات | endpoint قراءة `store/v1/policies/{slug}` لمحتوى التاجر · صفحات Customizer · ثابت | endpoint قراءة (404 عند عدم النشر، HTML/Markdown منقّى، يُخفي الرابط عند الغياب) | X4 |
| **D-5** | بطاقات الهدايا/البطاقات المحفوظة/الكوبونات/المفضلة | تُنقل لاحقاً بعقود مستقلة · تُحذف تنفيذات Spree فقط | **تُحذف تنفيذات Spree**؛ تبقى واجهات `design_only`؛ كل قدرة عقد منفصل (ADR-11 يؤجّل الكوبونات) | R1 |
| **D-6** | عمر الجلسة/تجديدها | 7 أيام ثابتة (الحالي) · منزلقة بالتدوير | منزلقة محدودة (تدوير توكن) إن توفر؛ وإلا ثابتة مع إعادة دخول | B2 |

> **حتى تُحسم D-1/D-2:** المتجر يعمل **ضيفاً** (سلة+Checkout+دفع إلكتروني AWJ) وحساب المشتري موسوم `gated` بصدق (شريحة X1). هذا نتيجة مقبولة لـBeta ولا يتطلب أي backend.

---

## 3. الحراسة المستمرة (تُقدَّم في أول شريحة)

**Ratchet guard** (اختبار vitest + قائمة سماح JSON): يحصي (أ) ملفات الاستيراد القيمة، (ب) أسطر `getClient|getClientForSurface|withAuthRefresh`، (ج) عبارات `@spree/*` النوعية، (د) ملفات تذكر `SPREE_*`. القيم الابتدائية = الجرد (5 / 68 / 109 / 6 متغيرات). الاختبار يفشل إذا **زاد** أي رقم، ويُلزم كل شريحة بتخفيض ما أزالته (فيصبح الرقم النهائي صفراً حرفياً).
**اختبار «بلا بيئة Spree»** (يعمل في `storefront-ci.yml`): يشغّل مسارات الخادم الخاصة بحساب DTC/السياسات/sitemap وهو `SPREE_*` غير مضبوط ويؤكد أنها لا ترمي `Spree client is not configured` ولا تستدعي `getClient()`.

---

## 4. الشرائح

الترتيب المقترح للتنفيذ: **X0 → X1 (+X2) → X5 → AN1 → X3 → X4** ثم المسارات المتوازية **B1…B7** و**T1** و**O1/O2/CK1/CK2/N1**، ثم **S1…S7**، ثم **W1 → R1 → R2 → T2 → R3 → R4 → E1 → G**؛ ومسار **الاستكمال C** (O3، CK4، INV1، F1، RT، N، P) يسير بتوازٍ حسب تبعياته. **التفصيل الكامل لكل الوظائف (F01–F84) في الملحق ب.**
حجم تقريبي: S ≤ نصف يوم، M ≈ 1–3 أيام، L ≈ أسبوع+.

### المسار X — إيقاف النزيف (واجهة فقط، لا اعتماد على الخلفية)

#### X0 — قرارات وADR (S) · وثائق فقط
- **الهدف:** تسجيل D-1…D-6 وفق قرارات المالك، وتحديث ADR-24 ببند «آلية جلسة الويب».
- **المناطق:** `docs/plans/store/ADR-*`، تحديث `capabilities.ts` (تعليق فقط).
- **اختبار/Rollback:** لا شيء/حذف الملف. **المتطلب:** مراجعة Safwan.

#### X1 — بوابة صادقة لحساب المشتري + إيقاف الأخطاء الخام + الـratchet (S–M) ★ أول PR
- **الهدف:** إصلاح عيب «Spree client is not configured» **دون** أي متغير بديل: لا يعود نموذج التسجيل/الدخول/النسيان/الإعادة/الملف إلى `getClient()` أصلاً ما دامت الهوية غير مبنية.
- **التنفيذ:**
  1. ثابت جديد `ACCOUNT_AUTH_CAPABILITY = "gated"` في `capabilities.ts` بتوثيق العقد المفقود (D-1/D-2).
  2. `customer.ts`: `login/register/requestPasswordReset/resetPassword/updateCustomer/syncSession/getCustomer/logout` ترفض مبكراً بنتيجة typed `{ success:false, code:"capability_unavailable" }` عندما القدرة ليست `live` — **قبل** أي استدعاء لـ`getClient()`؛ ولا تُمرّر `error.message` الخام أبداً (تنقية إلى رموز + رسائل كتالوج).
  3. صفحات `/account` و`/account/register` و`/forgot-password` و`/reset-password` و`/profile` تعرض `AccountGatedNotice` (النمط القائم في `AccountAddresses`) مع إرشاد «تابع كضيف»؛ لا حقول تنتظر إرسالاً بلا أثر. `PolicyConsent` يبقى حيث يُستعمل في Checkout.
  4. حارس `middleware.ts`: مسارات `/account/*` المحمية تُعيد إلى `/account` الصادق عند غياب الجلسة (السلوك القائم)، بلا تغيير في الحماية.
  5. الـratchet و«اختبار بلا بيئة Spree» (§3).
- **عقود AWJ:** لا حاجة (متوفر). **غير متوفر:** هوية مشتري (يظل مفقوداً).
- **الاختبارات:** وحدة لكل action (لا استدعاء للعميل: `vi.mock('@/lib/spree')` يؤكد عدم النداء)، تصيير لصفحات الحساب (AR/EN، RTL، جوال)، لقطة بصرية للإشعار، ratchet، `tsc/biome/locales` الموجودة.
- **سطح التراجع:** تدفق الحساب (معطّل أصلاً)، `AuthProvider`، `AccountShell`، الهيدر (زر الحساب). لا مسّ بالسلة/Checkout.
- **ثوابت:** لا بيانات اعتماد تغادر الخادم؛ لا ذكر مزوّد؛ لا حالات نجاح كاذبة؛ لا `localStorage` بديل.
- **القبول:** لا تظهر أي رسالة Spree في أي واجهة؛ `rg "getClient\(" src/lib/data/customer.ts` لا يُنفَّذ على مسار الحساب؛ الاختبار الجديد أخضر مع `SPREE_*` غير مضبوطة؛ ratchet مضبوط.
- **Rollback:** revert PR. **المخاطر:** منخفضة (الحالة السابقة معطّلة). **المتطلب:** لا شيء (قرار المالك على صيغة الإشعار فقط).

#### X2 — نظافة وثائق التشغيل (S) · وثائق/تهيئة
- إزالة نصيحة «Placeholder values are fine» (`AWJ_STOREFRONT_FIRST_PREVIEW_DEPLOYMENT_REPORT.md:56`)، وإزالة `SPREE_API_URL=http://localhost:8000`/`placeholder` من `.env.example:36-37` مع توضيح «لا تضبط».
- التحقق: `rg -n "SPREE_" .env.example docs/plans/store` يُظهر فقط حالات «لا تضبط/مُهمَل».
- **Rollback:** revert. **أولوية أمنية** (R-02): قد تُدمج مع X1 إن رغب المالك.

#### X5 — إغلاق مسارات Checkout Spree غير المربوطة (S)
- `(checkout)/*` (`checkout/[id]`, `confirm-payment/[id]`, `order-placed/[id]`) تُعيد `notFound()` ما لم تكن الجملة مفعّلة (نفس شرط `wholesale/layout.tsx:20`)، ويُحذف فرع Spree من `CartDrawer.tsx:282-283` عندما لا توجد سلة جملة.
- **الاختبارات:** تصيير الطرق بغياب الجملة = 404؛ مسار `/checkout` AWJ لا يتأثر.
- **Rollback:** revert. **مخاطر:** منخفضة (لا رابط حيّ).

#### X3 — Sitemap من AWJ (M)
- **الهدف:** تحويل `sitemap.ts` من `getSitemap*` (Spree) إلى `store/v1/products|categories` (موجودان) مع **التحقق من ترقيم الصفحات** (مجهول اليوم) وبدون `use cache: remote` غير المُفتَّح بالمضيف؛ فشل الجلب يرمي (لا صمت): `generateSitemaps` يبقى ملتقطاً، لكن `sitemap()` يسجّل بمقياس ويعيد 503/فارغ مُعلَن لا «نجاح».
- **المناطق:** `app/sitemap.ts`, `lib/data/sitemap.ts`, `lib/commerce/*`.
- **عقود AWJ:** متاح: قوائم المنتجات/التصنيفات؛ **غير متحقق:** حدود `per_page`/`last_page` للمتاجر الكبيرة، تواريخ `updated_at`.
- **اختبارات:** وحدة مع fixtures AWJ؛ مضيفان مختلفان لا يتشاركان مفتاحاً؛ robots.
- **ثوابت:** المضيف هو سلطة المستأجر؛ لا ذاكرة مؤقتة عابرة للمستأجرين. **Rollback:** revert. **مخاطر:** متوسطة (SEO).

#### X4 — السياسات (M) · يحجبه D-4
- **إن اختير endpoint:** B8 أولاً، ثم استبدال `data/policies.ts` بمحوّل AWJ؛ 404 عند عدم النشر؛ تنقية HTML (DOMPurify أو قائمة سماح) قبل `dangerouslySetInnerHTML`؛ إخفاء روابط السياسات (التذييل/الموافقة) عند غيابها؛ بلا `use cache: remote`.
- **اختبارات:** 404 عند الغياب، XSS payload ينقّى، مضيفان معزولان، ar/en.
- **Rollback:** revert. **مخاطر:** متوسطة (امتثال).

### المسار B — Laravel (عقد هوية مشتري `store/v1`) · يحجبه D-1/D-2

> **المبدأ:** كل شيء أدناه مقترح ولا يُنفَّذ قبل D-1. المسارات خلف `RequireStorefrontMutationGateway` (سر البوابة + Host)، والمستأجر دائماً من `ResolveStorefrontDomain`؛ الهوية تُقبل فقط إن `identity->tenant_id === TenantContext`. لا `tenant_id`/`customer_id` من الحمولة.

| ID | الهدف | يعيد استعمال | اختبارات خلفية | حجم |
|---|---|---|---|---|
| **B1** | ميدلوير سياق مشتري اختياري/إلزامي لـ`store/v1` (نظير `EstablishCommerceCustomerContextIfPresent`) + غطاء بوابة للمسارات الجديدة | `AuthenticateCommerceCustomer`, `EstablishCustomerContext` | عبر المستأجر (توكن مستأجر آخر ⇒ 401/404 موحّد)، بلا سر بوابة ⇒ 404، IDOR | M |
| **B2** | `POST store/v1/auth/register|login|logout`, `GET store/v1/me` + سياسة جلسة (D-6) | `CustomerIdentityService`, `CustomerAuthenticationService` | تقييد معدّل لكل IP+بريد، ردّ موحّد ضد التعداد، PostgreSQL | L |
| **B3** | تحقق البريد/الهاتف + نسيان/إعادة كلمة المرور للعملاء | outbox (PR #1531)، مزوّد OTP حقيقي | رموز أحادية الاستخدام/منتهية، قفل محاولات، لا تسريب وجود الحساب | L |
| **B4** | `PATCH store/v1/me`, تغيير كلمة المرور/البريد (إعادة تحقق CUS-ARCH-0 §405) | — | كلمة المرور الحالية، إبطال الرموز | M |
| **B5** | سلة وCheckout `store/v1` واعيان بالهوية: `resolveCurrent` عند وجود هوية، **ادّعاء/دمج سلة الضيف** (ADR-07)، `commerce_orders.customer_identity_id` | `CommerceCartService::resolveCurrent`, `CommerceCheckoutService` | `CommerceCartMergeApiTest`-like على PG + تزامن؛ **لا قيد/فاتورة/حركة مخزون ناتجة عن الربط**؛ idempotency `checkout/complete` ثابت | L |
| **B6** | `GET store/v1/me/orders`, `/me/orders/{id}`، وبحث ضيف بمرجع موقَّع (`X-Order-Reference`) حتى دون دفع إلكتروني | `CommerceCustomerOrderController` | IDOR (طلب مشترٍ آخر ⇒ 404 موحد)، ترقيم، شكل `serializeOrder()` | M |
| **B7** | `store/v1/me/addresses` CRUD + إشارة معرّف عنوان في `checkout/address` | `CommerceCustomerAddressService` | ملكية بالـidentity، حدّ العدد، نسخ لقطة لا مرجع حي | M |
| **B8** | (D-4) `GET store/v1/policies/{slug}` قراءة فقط | — | 404 عند غياب النشر، عزل مضيف، تنقية | S |

أقصى توافق: لا تغيير في `commerce/v1` ولا `customer/v1`؛ مسارات `store/v1` الحالية (ضيف) تبقى بلا تغيير سلوكي.

### المسار T — أنواع AWJ المملوكة (بلا تغيير سلوكي)

#### T1 — أنواع عرض AWJ + codemod لعنقود الكتالوج (M–L، آلي)
- **الهدف:** إنشاء `src/lib/commerce/view-models.ts` (أو مجلد) يعلن الشكل البنيوي المستعمل فعلاً من `Product, Category, Media, Variant, OptionType, OptionValue, Price, PaginatedResponse, ProductListParams, ProductFiltersResponse, OptionFilter, AvailabilityFilter, PriceRangeFilter, CustomField, Channel`… (يُشتق الحد الأدنى من استعمال `tsc`)، ثم `StoreProduct`/`StoreCategory` (`commerce/types.ts:113,127`) يعتمدان عليها بدل `import("@spree/sdk")`، ثم codemod لاستبدال الاستيراد في ~60 ملفاً نوعياً.
- **المبدأ:** مُحوِّل توافق (`mappers.ts` يُنتج الشكل نفسه) فلا إعادة كتابة شاملة؛ `tsc` + vitest كاملان قبل/بعد (صفر فرق عرض).
- **قبول:** عدد عبارات الاستيراد `@spree/*` في ملفات الكتالوج = 0، ratchet مخفَّض.
- **Rollback:** revert (PR آلي). **مخاطر:** منخفضة-متوسطة (حجم الفرق). يُنفَّذ في أي وقت بعد X1.

#### T2 — بقية الأنواع (S–M) · بعد R1
- `Address, AddressParams, Country, State, Market, Cart, LineItem, Order, Fulfillment, Payment, CreditCard, GiftCard, StoreCredit, Customer, Policy, WebhookEvent, RequestOptions, Client` — معظمها يسقط مع حذف C6/C7؛ ما يتبقى (Market/Country للهيدر) يعلَن في `view-models.ts`.

### المسار S — اعتماد الواجهة لعقد AWJ · بعد B-المقابلة

| ID | الهدف | المناطق | شرط |
|---|---|---|---|
| **S1** | عميل حساب AWJ (`lib/commerce/account.ts`) عبر `storefrontFetch()` + كوكي جلسة `awj_customer_session` (HttpOnly/Secure/SameSite=Lax) + إعادة توصيل `AuthContext`؛ قلب `ACCOUNT_AUTH_CAPABILITY` إلى `live` لكل ميزة بالتتابع؛ **تنظيف الكوكيز القديمة** (§5) | `customer.ts` → `account.ts`، `AuthContext.tsx`، `cookies.ts`، `middleware.ts` (التحقق من وجود الكوكي الجديد **+** التحقق الخادمي في الـlayout عبر `GET me`) | B1+B2 |
| **S2** | صفحات التحقق/نسيان/إعادة تعيين | `account/{forgot,reset}-password`, صفحة تحقق جديدة | B3 |
| **S3** | الملف وتغيير كلمة المرور | `AccountProfileForm` | B4 |
| **S4** | دمج سلة الضيف عند الدخول + الخروج يمسح كوكيز AWJ (`awj_cart_token` عند الاقتضاء بسياسة B5) | `CartContext`, `finalizeAuth` → AWJ | B5 |
| **S5** | قلب `ACCOUNT_ORDER_*` إلى `live`: قائمة/تفاصيل الطلبات (النماذج `AccountOrder*` جاهزة) | `orders/*` | B6 |
| **S6** | العناوين `live` + اختيار عنوان محفوظ في Checkout AWJ | `AccountAddresses`, `AddressStage` | B7 |

**الاختبارات المشتركة (S):** وحدة لكل action؛ تكامل مع fixtures AWJ (امتداد `e2e/support/store-brand-api-fixture.mjs`)؛ e2e ضيف + مشتري موثَّق (Playwright، RTL/AR وEN، جوال)؛ حالات الفراغ/التحميل/الفشل؛ مراجعة رؤية بصرية.

### المسار W/R — الإزالة

#### W1 — تنفيذ D-3: إزالة الجملة (M)
- حذف `(wholesale)/**`, `data/wholesale.ts`, `WholesaleSection`, روابط الهيدر/التذييل (`Header.tsx:138,183`, `Footer.tsx:254`), `SPREE_WHOLESALE_*` من `lib/spree/config.ts`, خاصية `surface` من `CartContext` وأنواعه، ومفاتيح `wholesale` في `messages/*`.
- **توافق الروابط:** `/…/wholesale/*` تعيد 404 (كما اليوم عند التعطيل)، لا إعادة توجيه.
- **اختبارات:** `CartContext` DTC فقط؛ تصيير الهيدر/التذييل بلا الجملة (اختبارات `Footer*.test`/`Header.test` الحالية تُبسَّط من stub `isWholesaleEnabled`).
- **Rollback:** revert. **مخاطر:** متوسطة (حجم الحذف). **متطلب:** D-3 + X5.

#### R1 — إزالة Checkout/Cart/Payment/Orders Spree (L)
- **تُحذف:** `data/{checkout,payment,orders,express-checkout-flow,credit-cards,gift-cards,addresses,countries}.ts`، دوال Spree في `data/cart.ts` (المتبقي `*Awj*`)، `app/…/(checkout)/**`، `components/checkout/{PaymentSection,ExpressCheckoutButton,StripePaymentForm,AdyenPaymentForm,AddressSection,AddressSelector,AddressEditModal,AddressFormFields,CouponCode,Summary,DeliveryMethodSection,…}`، المكوّنات الميتة (`CreditCardList, GiftCardList, OrderList, OrderDetail, AddressManagement`)، `resolveMarket/getMarketCountries`، `useCountryStates`، و`lib/utils/{stripe,payment-gateway,express-checkout}`.
- **التبعيات:** إزالة `@stripe/*`, `@adyen/adyen-web`, `@paypal/react-paypal-js`, `react-svg-credit-card-payment-icons` (بعد التأكد من عدم استعمالها في Awj*/payment-brands)، ومتغيرات `NEXT_PUBLIC_{STRIPE,PAYPAL,ADYEN}_*`.
- **توافق الروابط (إجباري):** `/checkout/[id]` → 308 إلى `/checkout`؛ `/confirm-payment/[id]` → 308 إلى `/checkout/payment-return`؛ `/order-placed/[id]` → 308 إلى `/` (أو `/account/orders` بعد S5)؛ كوكيز `_spree_cart_token*` تُنظَّف.
- **اختبارات:** حزمة AWJ كاملة (`AwjCheckoutFlow*`, `PaymentReturn`, `awj-online-payment`)، ZATCA/محاسبة غير متأثرة (لا تغيير خلفي)، e2e الدفع الإلكتروني بالـfixture الموجود (`payment-return-api-fixture.mjs`).
- **متطلب:** W1 **+ AN1** (لا تُحذف مساعدات GA4 قبل وصل أحداث الشراء بـCheckout AWJ). **Rollback:** revert (PR كبير فيُقسَّم إلى R1a ملفات البيانات، R1b الواجهات، R1c التبعيات). **مخاطر:** عالية الحجم، منخفضة السلوك.

#### R2 — إزالة Webhook والرسائل المرتبطة (S) · **يتطلب D-14**
- حذف `app/api/webhooks/spree/route.ts`, `lib/spree/webhooks.ts`, `lib/webhooks/handlers.ts`، و`SPREE_WEBHOOK_SECRET`؛ قوالب `lib/emails/*` تُحتفظ بها كمرجع UI إن اعتُمد إرسال البريد من Laravel (PR #1531) وإلا تُحذف مع `resend`.
- **اختبارات:** `POST /api/webhooks/spree` ⇒ 404 (كان 503). **Rollback:** revert.

#### R3 — إزالة `lib/spree/` وإعادة تسمية الكوكيز والبروكسي (M)
- نقل ما يبقى (مثلاً `Surface`، `getLocaleOptions`) أو حذفه؛ `createSpreeMiddleware` → `createLocaleMiddleware`؛ `spree_country/spree_locale` → `awj_country/awj_locale` مع قراءة الاثنين لإصدار واحد (الكوكي الجديد يُكتب، القديم يُحذف عند أول طلب)؛ حذف `_spree_write_probe` والكوكيز `_spree_*`.
- **توافق:** المسار يحمل `/{country}/{locale}` فالتحويل لا يكسر روابط؛ اختبار `middleware.test.ts` يُنقل ويتوسّع (قديم↔جديد).
- **Rollback:** revert. **مخاطر:** متوسطة (كل طلب يمرّ عبر البروكسي).

#### R4 — حذف SDK والـCLI والتهيئة والوثائق (S–M) · يتطلب T1+T2+R1+R2+R3
- `package.json`: حذف `@spree/sdk`, `@spree/cli`، تغيير `name` (`nextjs-starter-spree`)، إزالة `e2e:up/e2e:down`؛ `next.config.ts`: حذف `transpilePackages` و`spreeImagePatterns()` وإضافة أنماط وسائط AWJ الفعلية إن لزم؛ `DocumentShell.tsx`: حذف `spreeApiOrigin`؛ `Dockerfile/vercel.json/.env.example`: لا ذكر `SPREE_*`؛ حذف `scripts/e2e/bootstrap-spree.sh`, `scripts/e2e/dev-with-env.sh` (أو تبسيطه)، و`storefront/.github/workflows/ci.yml` المتداخل (غير عامل) و`dependabot.yml` المتداخل إن لم يُستعمل؛ إعادة كتابة `README.md` (يبقى `LICENSE` و`NOTICE`)؛ تنظيف `messages/*` (`footer.copyright/learnMore/description`, `home.heroDescription`)، `public/spree.png`، fallback «Spree Store» في `lib/store.ts`.
- **قبول:** `rg -il "@spree|SPREE_"` خارج `LICENSE/NOTICE/docs/plans/store/*COM_7*` = 0؛ `pnpm install --frozen-lockfile && pnpm build` بدون `SPREE_*`؛ ratchet = 0 ثم يُستبدل بحارس «لا Spree» دائم.
- **Rollback:** revert. **مخاطر:** منخفضة بعد المتطلبات.

#### E1 — ترحيل الاختبارات وe2e (M) · يُنفَّذ مع S وR
- استبدال `e2e/checkout.spec.ts` (Spree+Stripe) بمواصفة Checkout ضيف عبر fixture AWJ + مواصفات حساب موثَّق؛ تحويل 34 اختباراً مقترناً (الاستبدال بإزالة المحاكاة أو بنقلها إلى fixtures AWJ دون خفض التغطية)؛ جعل `playwright.config.ts` الافتراضي لا يتطلب `.env.e2e`؛ إضافة job جذري مُرشَّح بالمسار (`storefront/**`) يشغّل e2e بالـfixtures (استشاري ثم إلزامي)؛ مسار حقيقي (stack AWJ) على نمط `vd5` غير إلزامي.
- **PostgreSQL:** اختبارات عزل المستأجر/IDOR/تزامن في Laravel (B-tracks) تعمل على صف PG الموجود في `ci.yml`.

#### G — بوابة الخروج النهائية
جميعها شروط للإغلاق:
0. **لا صفوف معلّقة:** كل صف F01–F84 في الملحق ج من التدقيق إما Implemented، أو مُسقَط بقرار مالك موثّق (مثل D-3/D-5/D-7)، أو مربوط بشريحة C مسجّلة؛ ولا يبقى بند «Spree-dependent» واحد.
1. صفر استدعاءات Spree وقت التشغيل: `rg "getClient\(|getClientForSurface\(|withAuthRefresh\(|@spree/"` = 0 في `storefront/src`.
2. لا متغيّر `SPREE_*` مطلوب أو مقروء؛ نشر تجريبي مع إزالتها يعمل (smoke).
3. لا استيرادات نوع أو قيمة متبقية؛ لا اختبار يعتمد على Spree.
4. `pnpm check`, `check:locales`, `tsc`, `pnpm test`, `pnpm build` خضراء؛ e2e الجديد أخضر؛ اختبارات Laravel (PG) خضراء.
5. `LICENSE` و`NOTICE` باقيان؛ README محدَّث.
6. تحقق نشر معتمد صراحةً من Safwan (قرار منفصل عن الدمج) على مستأجر تجريبي، مع مراقبة وملاحظات رجوع.

---

## 5. الكوكيز والجلسات القديمة والروابط

| قديم | الحال | المعالجة |
|---|---|---|
| `_spree_jwt`, `_spree_refresh_token` | لا backend Spree يُصدرها في أي بيئة معروفة ⇒ **لا جلسات حيّة** [I؛ يُتحقق منه في سجلات النشر] | تُحذف عند أول طلب بعد S1 (`Set-Cookie: max-age=0`) لإصدار واحد، ثم يسقط الكود |
| `_spree_cart_token`, `_spree_cart_token_id`, `_spree_wholesale_cart_token*` | سلال Spree غير موجودة | تُحذف مع W1/R1 |
| `awj_cart_token` | سلة AWJ الحيّة (أيام 30) | **لا تُمسّ**؛ عند الدخول تُدمج (B5/S4)، وعند الخروج تُدار بسياسة B5 (قيد معلن: R-08) |
| `spree_country`, `spree_locale` | تفضيل لغة/بلد (عمرها سنة) | قراءة مزدوجة لإصدار، كتابة `awj_*`، ثم حذف القديم |
| روابط قديمة (`/checkout/{id}`, `/confirm-payment/{id}`, `/order-placed/{id}`, `/wholesale/*`) | غير مربوطة تقريباً | 308 إلى مقابلها AWJ؛ الجملة 404 (R1/W1) |
| سلال/جلسات اختبار | مستأجرو Beta فقط | تنتهي طبيعياً؛ لا ترحيل بيانات |

---

## 6. مصفوفة الاختبار

| الطبقة | X1 | X3/X4 | B1–B7 | S1–S6 | R1–R4 | T1/T2 |
|---|---|---|---|---|---|---|
| وحدة (vitest) | ✓ | ✓ | — | ✓ | ✓ | ✓ (tsc+snapshot) |
| تكامل بـfixtures AWJ | ✓ | ✓ | — | ✓ | ✓ | — |
| e2e ضيف + موثَّق (RTL/AR، EN، جوال) | — | — | — | ✓ | ✓ | — |
| Laravel Feature + PostgreSQL (عزل مستأجر/IDOR/تزامن/تقييد معدّل) | — | — | ✓ | — | — | — |
| سعر/مخزون/حجز (backend) | — | — | B5 | — | — | — |
| دفع/Webhook/idempotency | — | — | B5 (لا تغيير) | — | R1 (تراجع) | — |
| ZATCA/محاسبة | — | — | B5 يؤكد **غياب أثر** | — | — | — |
| نشر بلا `SPREE_*` + بناء | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| فراغ/تحميل/فشل UX | ✓ | ✓ | — | ✓ | ✓ | — |

---

## 7. الإطلاق والملاحظة والرجوع

- **الإطلاق:** Preview ← مستأجر تجريبي/Beta (مثل `dominah-zhor-tyb`) ← بقية مستأجري Beta. لا Deploy بلا موافقة صريحة منفصلة.
- **أعلام الميزات (مبرَّرة فقط):** قدرة حساب المشتري (`ACCOUNT_AUTH_CAPABILITY` + بوابة منصّية خلفية تُغلق افتراضياً على نمط `payments.commerce_online_checkout.enabled`)؛ باقي الشرائح بلا أعلام (حذف/نقل).
- **الملاحظة:** سجلات منظَّمة بلا PII (معرّف طلب، رمز سبب، مستأجر)، عدّادات: فشل دخول/تسجيل، رفض بوابة، تجاوز معدّل، أخطاء `capability_unavailable`، 404 لمسارات قديمة، 5xx لـ`/policies|sitemap`.
- **الرجوع لكل شريحة:** revert PR؛ B-tracks: هجرات إضافية فقط (`down()` يرفض عند وجود بيانات حسب أسلوب المشروع)؛ الأعلام تغلق فوراً.

## 8. الثوابت الأمنية/المالية لكل شرائح الهوية (وتنطبق على شرائح الاستكمال C — الملحق ب.5)

1. المستأجر من `Host` فقط؛ لا مدخل عميل للمستأجر أو للمشتري؛ تطابق `identity.tenant_id` إلزامي، والفشل 404/401 موحّد.
2. IDOR: كل قراءة/كتابة مقيّدة بـ`CustomerContext::customerIdentityId()`؛ طلب غيرك = 404 موحّد.
3. الرموز: HttpOnly + Secure + SameSite=Lax؛ لا تُعرض للعميل؛ لا تُسجَّل.
4. ضد التعداد وكسر القوة: ردود موحّدة، حدود معدّل لكل IP+معرّف.
5. لا بيانات شخصية في ذاكرة تخزين مؤقت مشتركة؛ أي `cache` يُشفِّر المضيف؛ ردود المشتري `no-store`.
6. لا إجمالي/سعر/خصم يُحسب في المتصفح؛ `checkout/complete` يبقى بـ`Idempotency-Key`؛ الدفع الإلكتروني يقرأ الحقيقة من الخادم.
7. تنقية HTML للمحتوى الخارجي؛ لا نصوص استثناء خام في الواجهة.
8. لا تغيير في المحاسبة/المخزون/ZATCA؛ إثبات ذلك باختبار في B5.

## 9. الشريحة التالية الموصى بها
**X1** (+X2 معها إن رغب المالك): تُصلح العيب الظاهر بصدق دون أي متغيّر بديل، وتؤسس الـratchet الذي يحكم بقية الخروج. لا تتطلب Backend ولا قرارات D-1…D-6 (فقط صيغة الإشعار).


---

# الملحق ب — خطة الوظائف الكاملة (Commerce Completion) · يغطي F01–F84

**المرجع:** الملحق ج في `docs/audits/AWJ_SPREE_FULL_DEPENDENCY_AUDIT.md` (مصفوفة التغطية الوظيفية بالأدلة). **لا تنفيذ قبل موافقة Safwan.**

## ب.1 المبدأ: مساران لا يُخلطان

| المسار | الغرض | يُغلق بـ |
|---|---|---|
| **E — Exit** | إزالة Spree التشغيلي (شرائح X/B/T/S/W/R/E/G في الأصل) | بوابة الخروج G |
| **C — Completion** | سدّ فجوات وظيفية **مستقلة عن Spree** كشفها التتبّع الشامل (طلبات، شحن، فوترة COD، إشعارات، مرتجعات، عروض/كوبونات…) | شرائح O/CK/INV/F/RT/N/P أدناه |

**قاعدة:** حذف Spree **لا يفقد أي قدرة تعمل اليوم** (لا شيء من Spree يعمل بلا Backend)، لكنه يحذف **كوداً/تصميماً** يجب إما إحلاله أو إسقاطه بقرار موثّق. لذلك تتطلب بوابة الخروج أن كل صف F01–F84 إما **Implemented** أو **مُسقَط بقرار مالك** أو **مربوط بشريحة C مسجّلة** (لا صفوف «معلّقة بصمت»).

**الأولويات:** **P0** = شرط للخروج (يمنع فقدان وظيفة تعمل أو يمنع خطراً) · **P1** = شرط «متجر تشغيلي كامل» لأول متاجر حيّة · **P2** = لاحق/قرار منتج.

## ب.2 قرارات إضافية (D-7…D-14) — تُضاف إلى D-1…D-6

| ID | القرار | التوصية | يحجب |
|---|---|---|---|
| D-7 | الشحنات المتعددة (multi-shipment) | **إسقاط**: لا نموذج AWJ ولا طلب منتجي | — |
| D-8 | الأثر المالي لطلبات COD/الاستلام: متى وكيف تُنشأ فاتورة/سند (عند التحصيل؟ عند التنفيذ؟ يدوياً؟) وتوقيت إصدار ZATCA | ADR محاسبي/ضريبي؛ **مغلق افتراضياً** على نمط PAY-H4-03 | INV1 |
| D-9 | دورة حياة الطلب: حالات (confirmed/cancelled/completed)، أبعاد الدفع والتنفيذ، دلالة الإلغاء، من يلغي | ADR؛ يحافظ على `CommerceOrder ≠ Invoice` | O3، F1، RT |
| D-10 | حجز مخزون طلبات COD/الاستلام | سياسة قابلة للضبط (قاعدة CLAUDE رقم 6): `none` (الافتراضي الحالي) · `reserve_on_confirm` | CK4 |
| D-11 | تقييم المرتجعات (Return ≠ Refund ≠ CreditNote ≠ Exchange؛ مفتوح في ADR-01/04) | ADR أولاً | RT-track |
| D-12 | قنوات إشعار المشتري والتاجر (بريد/SMS/واتساب)، ملكية القوالب، الموافقة | مع D-2؛ المصدر Laravel (outbox) | N-track |
| D-13 | نطاق الكوبونات (رفع تأجيل ADR-11): أنواع، تكديس، تأثير محاسبي | ADR مالي مشترك | P1c |
| D-14 | مصير مسار البريد اليتيم (قوالب Spree) عند R2: قبول فقد مؤقت أم إحلال N2 قبل R2 | **إحلال N2 قبل R2 إن توفر المزوّد؛ وإلا قبول صريح مكتوب** | R2 |

## ب.3 الشرائح (مسار C + تعديلات على E)

**قراءة الجدول:** الأولوية · التبعيات · معيار القبول · الاختبارات. الأحجام S/M/L. «إضافي» = لا يغيّر عقداً قائماً.

### AN — القياس
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **AN1** | ربط أحداث GA4 (`view_cart`, `remove_from_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`) بـ`AwjCheckoutFlow`/سلة AWJ بقيم **قادمة من الخادم** (لا حساب إجماليات في المتصفح)، مع منع تكرار `purchase` (مفتاح رقم الطلب) واحترام الموافقة/GTM الحالي | **P0** | X1 | لا يُحذف أي مساعد `lib/analytics/gtm.ts` قبل وجود بديله؛ `purchase` يُطلق مرة واحدة لطلب AWJ؛ لا أثر على COD/الدفع | وحدة لكل حدث بحمولة مبنية على `StorefrontCart/StorefrontOrder`؛ تكرار/إعادة تحميل؛ e2e fixture | S–M |

### O — الطلبات
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **O1** | **واجهة موظف لقراءة طلبات الويب**: `GET commerce/orders`, `GET commerce/orders/{id}` (قائمة مرقّمة + تفاصيل + بنود + نية الدفع + لقطات)، صلاحية جديدة `commerce.orders.view` في `Rbac` + جدول الأدوار (زرع طبق الأصل للأدوار المناسبة) + `EnsureApplicationActive` لتطبيق التجارة | **P1** | — | قراءة فقط؛ لا PII لمن لا يملك الصلاحية؛ 404 موحّد عبر المستأجر؛ استجابة لا تكشف حقولاً داخلية | Feature: مصفوفة RBAC لكل دور، عزل مستأجر/فرع، PG، ترقيم/فرز؛ `BranchIsolationGuardTest` (تصنيف أي نموذج جديد) | M |
| **O2** | `GET store/v1/orders/{id}` للضيف بـ`X-Order-Reference` الموقَّع (يُصدَر **دائماً** لا فقط مع بوابة الدفع الإلكتروني) + توحيد المسلسِل مع `CommerceOrderSerializer` **دون تغيير شكل استجابة `checkout/complete` الحالية** | **P1** | قرار N-09 | الشكل القائم مجمّد؛ حقل `order_reference` الإضافي لا يظهر عند البوابة المغلقة إلا بقرار (نمط PAY-H4) | `StorefrontCheckoutCompletionApiTest` + `FlowersEndToEndJourneyTest` بلا تغيير؛ IDOR (مرجع طلب آخر ⇒ 404)؛ مضيف/قناة مختلفة ⇒ 404 | M |
| **O3** | دورة حياة الطلب: حالات وأبعاد الدفع/التنفيذ، **إلغاء** (موظف، ومشترٍ بسياسة قابلة للضبط)، اتساق نية الدفع والحجز والطلب | **P1** | D-9، O1 | الإلغاء يُحرّر الحجز ويُلغي النية ذرّياً؛ يُرفض بعد ترحيل فاتورة إلا عبر مسار الإرجاع/الإشعار الدائن؛ لا يُترك طلب `confirmed` بنية ملغاة | Feature + PG تزامن (إلغاء مقابل التقاط)؛ انتقالات الحالة؛ لا قيود غير متوازنة | L |
| **O4** | خط زمني/أحداث الطلب (append-only) | P2 | O3 | كل انتقال حدث ثابت؛ لا PII زائد | وحدة + عزل | M |
| **S7** | صفحات الواجهة: تفاصيل/سجل طلبات الضيف (O2) ومسجّل (B6) + `order-placed` AWJ | P1 | O2, B6, S1 | تُقلب `ACCOUNT_ORDER_*` إلى `live` لكل منها بعد عقدها | Playwright (AR/EN/جوال)، حالات فراغ/فشل | M |

### CK — Checkout
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **CK1** | قبول `building_no`/`additional_number` في `PATCH store/v1/checkout/address` مع تحقق السعودية المطابق لـ`CommerceCustomerAddressService` (4/4/5 أرقام عند `country=SA`) | P1 | — | إضافي؛ المفاتيح الجديدة اختيارية؛ الاستجابة تُظهرها أصلاً | `StorefrontCheckoutApiTest` توسعة + CM لا يتأثر؛ واجهة `AddressStage` | S |
| **CK2** | `GET store/v1/checkout/delivery-options` (طرق + رسوم محسوبة خادمياً للعنوان الحالي) بدل التثبيت في الواجهة | P1 | — | لا يقبل مبالغ من العميل؛ الرسوم من `ShippingRateService` | اختبار تطابق مع `delivery.amount`؛ عزل مضيف | S–M |
| **CK3** | شحن مجاني فوق حدّ (سياسة قابلة للضبط) | P2 | CK2 | الافتراضي = سلوك اليوم (بلا حدّ) | منطقة/حدّ/تقريب بالهللات | S |
| **CK4** | سياسة حجز COD/الاستلام (D-10): `none` (افتراضي) أو `reserve_on_confirm` | P1 | D-10، O3 | الافتراضي لا يغيّر مستأجراً قائماً؛ الحجز وعدٌ لا حركة مخزون (لا `StockMovement`) | `two_independent_checkouts…` يبقى للافتراضي؛ سيناريو مقابل بالسياسة المفعّلة؛ PG | M |
| **CK5** | عرض الضريبة في السلة/Checkout | P2 | ADR ضريبي (TAX/EXT-05) | لا حقل ضريبة قبل قرار؛ لا حساب عميل | — | M |
| **CK6** | شحنات متعددة | — | D-7 | **مُسقَطة** | — | — |

### INV — الفوترة وZATCA
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **INV1** | وثيقة مالية لطلب **COD/الاستلام** وفق D-8: إنشاء فاتورة + سند قبض عبر `InvoiceService`/`PaymentService` فقط، **مغلقة افتراضياً** (بوابة نشر + سياسة مستأجر + رأي ضريبي)، مُرساة مثل `CommerceOrderPosting`، idempotent | **P1** | D-8، O1، O3 | قيد متوازن (Σمدين=Σدائن)، `source_type/source_id`، هللات bigint، لا كتابة مباشرة في `journal_lines`، يحترم قفل الفترة، ZATCA وفق ADR، **لا ترحيل رجعي** لما قبل التفعيل | نظير `CommerceInvoiceOnPaymentTest` (13) + PG تزامن؛ **اختبار `php artisan test` كامل**؛ **جدول القيود الناتجة في رسالة الـPR** (قاعدة CLAUDE) | L |
| **INV2** | مُشغِّل الفوترة عند التنفيذ/الشحن | P2 | INV1، F1 | حسب D-8 | — | M |
| **INV3** | تنزيل الفاتورة للمشتري | P2 | INV1 + مخرجات ZATCA | فقط بعد وجود فاتورة فعلية؛ لا «فاتورة» لطلب بلا فاتورة | — | S |

**الأثر المحاسبي المتوقع لـINV1 (مسودة للمراجعة، غير معتمدة — تحتاج D-8):**
| العملية | مدين | دائن |
|---|---|---|
| فاتورة مبيعات (سعر شامل 15%) | 1130 العملاء = الإجمالي | 4110 الإيراد (صافي) + 2120 ضريبة المخرجات |
| تكلفة المخزون (منتج متتبَّع) | 5110 تكلفة البضاعة | 1140 المخزون |
| تحصيل COD | الصندوق/الخزينة المحلولة (TREASURY T3) | 1130 العملاء |

### F — التنفيذ والشحن
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **F1** | نموذج شحنة/تتبّع/ناقل (ADR أولاً): حالات `ready/shipped/delivered`، رقم تتبع/رابط، إجراءات موظف، كتلة `fulfillment` **إضافية** في مسلسل الطلب | **P1** | D-9، O1، O3 | الواجهات القديمة لا تتغير؛ حدث «تم الشحن» يُولّد إشعاراً عبر N3 | Feature + عزل + RBAC (`commerce.orders.manage`) | L |
| **F2** | `PickupLocation` واختيار الفرع | P2 | ADR-19 §5 | لا يخلط SalesChannel بالفرع/المخزن (عقد #5) | — | M |

### RT — المرتجعات والاسترداد
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **RT1** | ADR تقييم المرتجعات (Return≠Refund≠CreditNote≠Exchange) | P1 (وثيقة) | D-11 | قرار مكتوب | — | S |
| **RT2** | طلب إرجاع (RMA) لطلب ويب: موظف أولاً، ثم مشترٍ | P2 | RT1، O3، F1 | حالات واضحة؛ لا أثر مالي عند الطلب | Feature + IDOR | L |
| **RT3** | فتح `not_refundable` لمدفوعات المتجر عبر `PaymentRefundService` (حل الطرف من `CommerceOrder.partner_id`) | **P1** (**مقترح كشرط قبل فتح G3 لمستأجر حيّ**) | RT1، PAY-V2-6A (PR #778) | استرداد بقيود متوازنة؛ لا استرداد آلي للالتقاط المتأخر (D-15 المحافظ) | `PaymentRefund*` تمدّد + PG | L |
| **RT4** | جسر إشعار دائن/إعادة مخزون لطلب ويب | P2 | RT2، INV1 | عبر `CreditNoteService`/`ReturnService` فقط؛ `CashSaleRefundGuard`/TREASURY T5–T6 يُحترمان | اختبار T5/T6 + ZATCA 381 | L |

### N — الإشعارات
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **N1** | dispatcher ومزوّد الاتصالات (PR #1531 + D-12/D-2) | **P1** | قرار خارجي | عمل فعلي بمزوّد حقيقي بدل `FakeOtpProvider` | اختبارات PR نفسه | L (خارجي) |
| **N2** | بريد/رسالة **تأكيد الطلب للمشتري** عبر outbox عند إنشاء الطلب (idempotent لكل طلب، ar/en، مستأجر-معزول، موافقة) | **P1** | N1، D-12 | رسالة واحدة لكل طلب؛ تكرار `complete` (replay) لا يعيد الإرسال | Feature + PG؛ لا PII في السجلات | M |
| **N3** | إشعارات فشل الدفع/الشحن/الإلغاء | P2 | N2، F1، O3 | — | — | M |
| **N4** | تنبيه التاجر بطلب ويب جديد (`NotificationService` + جسر Commerce) | **P1** | O1 | مرة لكل طلب؛ المستلمون بالصلاحية `commerce.orders.view` | Feature + RBAC | S–M |
| **N5** | التحقق وإعادة كلمة المرور | P1 | = B3 | — | — | L |

### P — العروض والمحافظ
| ID | الهدف | P | يعتمد على | القبول | الاختبارات | حجم |
|---|---|---|---|---|---|---|
| **P1c** | محرك كوبونات (رفع تأجيل ADR-11): خصم **خادمي** كسطر في السلة/الطلب | P2 | D-13 + مراجعة مالية/ضريبية | الإجماليات مشتقة من السطور؛ لا حساب عميل؛ أثر محاسبي موثّق (إيراد صافٍ/خصم) | وحدة + PG + محاسبة | L |
| **P2c** | بطاقات هدايا/رصيد متجر | P2 (افتراضياً **مُسقَط**) | D-5 | إن اعتُمدت: التزام مؤجل محاسبياً | — | L |
| **P3c** | المفضلة / التقييمات | P2 | هوية (B-track) | `WISHLIST` يصبح `live` فقط بعقد | — | M |

## ب.4 التسلسل والتبعيات

```
[Phase 0]  X0 → X1 (+X2) → X5          ─►  AN1 (بعد X1)
[Phase 1 · متوازٍ]  B1→B2→B3(+N5) · O1 · O2 · CK1 · CK2 · T1 · N1(خارجي) · X3 · X4(بعد D-4)
[Phase 2]  O3(D-9) · CK4(D-10) · N2(N1) · N4(O1) · S1…S6 · S7(O2,B6)
[Phase 3]  F1(O3) · INV1(D-8,O3) · RT1→RT3 · RT2 · RT4 · P1c
[Phase 4 · الإزالة]  W1 → R1 (يتطلب AN1) → R2 (يتطلب قرار D-14/N2) → T2 → R3 → R4 → E1 → G
```
**ملاحظات تبعية حرجة:**
1. **R1 يُحجَب بـAN1** (لا نفقد قياس الشراء الوحيد الموجود في Checkout Spree، رغم أنه لا يعمل لـAWJ اليوم).
2. **R2 يُحجَب بـD-14**: حذف الويبهوك والقوالب يُنهي المسار الوحيد (اليتيم) للبريد؛ إما N2 جاهز أو قبول صريح.
3. **INV1 وRT3 وO3 لا تعتمد على Spree** ويمكن أن تسير موازية للإزالة، لكنها لازمة لإعلان «تغطية كاملة».
4. **G3 وEXT-05 يبقيان مغلقين**: لا شريحة هنا تفتح الدفع الإلكتروني أو الفوترة الإلكترونية لمستأجر حيّ.

## ب.5 ثوابت إلزامية لكل شرائح C

1. **عزل المستأجر:** مستأجر الويب من `Host` (`ResolveStorefrontDomain`) فقط، ومسارات الموظفين `auth:sanctum` + `SetTenant` + `SetBranch`؛ كل نموذج جديد يرث `BaseModel` ويُصنَّف فرعياً (`BranchScoped`/`BelongsToBranch`/`CompanyWide`) وإلا فشل `BranchIsolationGuardTest`؛ لا مدخل tenant/customer من الحمولة؛ 404 موحّد للملكية.
2. **RBAC:** صلاحيات جديدة (`commerce.orders.view`, `commerce.orders.manage`) تُعرَّف في `Rbac` وتُزرع في جدول الأدوار القابل للضبط طبق الأصل (التوافق الرجعي) ويحرسها `EnsurePermission`؛ تفعيل التطبيق عبر `EnsureApplicationActive`؛ PII الطلب لا يُكشف لمن لا يملك الصلاحية.
3. **الدقة المحاسبية:** كل أثر مالي عبر `LedgerService::post`/`InvoiceService`/`PaymentService` حصراً؛ الإجماليات مشتقة من السطور؛ هللات bigint؛ `source_type/source_id`؛ قفل الفترة والسنة؛ `CommerceOrder ≠ Invoice`؛ `Reservation ≠ StockMovement`؛ توقيت الفاتورة/ZATCA بقرار ADR لا تخمين؛ قبل أي PR: `php artisan test` كاملاً + جدول القيود الناتجة.
4. **التوافق الرجعي:** مسارات وحقول **إضافية** فقط؛ استجابات `store/v1` الحالية تبقى حرفياً عند إغلاق البوابات (نمط PAY-H4)؛ افتراضات السياسات تحمي المستأجرين القائمين؛ هجرات إضافية؛ روابط وكوكيز قديمة بتوافق (§5).
5. **اختبارات:** PostgreSQL للعزل/التزامن، IDOR، Idempotency، وحدة وfixtures للواجهة، e2e ضيف/موثَّق، اختبار «بلا بيئة Spree».

## ب.6 تغطية الصفوف بالشرائح (إثبات الشمول)

| فئة الصفوف | الحالة الغالبة | الشريحة/القرار |
|---|---|---|
| F01–F10 كتالوج | Implemented (F09 Spree-dependent) | X3؛ T1 |
| F11–F16 سلة | Implemented؛ F14/F16 Missing | B5/S4؛ P1c |
| F17–F31 Checkout | Implemented؛ Partial: F19/F21/F22؛ Missing: F20/F28–F30 | CK1–CK5، B7، D-7 |
| F32–F40 الطلب | F32–F34 Implemented؛ F35–F40 Missing/Partial | O1–O4، S7 |
| F41–F49 الدفع | Implemented/Partial(مغلق)؛ F46 Spree؛ F47/F48 Missing | RT3؛ R1؛ D-5 |
| F50–F52 التنفيذ | F50 Implemented؛ F51/F52 Missing | F1، F2 |
| F53–F56 المرتجعات | Missing | RT1–RT4 |
| F57–F62 الفوترة | F57/F62 Implemented؛ F58 مغلق؛ F59–F61 Missing | INV1–INV3 |
| F63–F69 الإشعارات | Spree-يتيم/Missing/Partial | N1–N5، D-14 |
| F70–F74 الحساب | Spree/Missing | B1–B8، S1–S6، D-5 |
| F75–F79 المحتوى | Spree/Partial | X4، T، AN1، W1 |
| F80–F84 غير متحقَّق | Unverified | يُحسم كمهمة تحقق صغيرة ضمن أول PR يلمس كل مجال (لا شريحة مستقلة) |
