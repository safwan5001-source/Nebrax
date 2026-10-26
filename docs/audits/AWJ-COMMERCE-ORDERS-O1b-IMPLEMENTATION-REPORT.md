# AWJ-COMMERCE-ORDERS-O1b — تقرير التنفيذ (واجهة طلبات المتجر للموظف)

**النطاق:** واجهة **قراءة فقط** فوق `GET commerce/orders[/{id}]` (O1a، PR #1766 المدموج). لا تغيير في API ولا migrations، ولا قبول/إلغاء/تجهيز/شحن/تحصيل/فاتورة. لا Merge ولا Deploy.

## 1. ما تم تنفيذه

| البند | التفاصيل |
|---|---|
| `/commerce/orders` | قائمة: رقم الطلب، التاريخ، العميل (+هاتف LTR)، المتجر، طريقة الدفع، حالة الدفع، حالة الطلب، الإجمالي. `DataTable` المعتمد بفرز خادمي (`created_at`/`total`/`number`)، وبطاقات للجوال (`mobileRecord`). |
| البحث والتصفية | بحث (≥2 حرف، مؤجَّل 300ms)، المتجر، قناة البيع، حالة الدفع، طريقة الدفع، التسليم، من/إلى تاريخ، الترتيب. الحالة كلها في الرابط (تصمد أمام التحديث والعودة). |
| الترقيم | خادمي: 20 (افتراضي) أو 50 (حد API)؛ `Pagination` المشترك. |
| `/commerce/orders/[id]` | `DetailPage` المشترك: رقم الطلب وحالة الطلب وحالة الدفع **كشارتين مستقلتين**؛ العميل والاتصال؛ التسليم (عنوان/استلام/موعد/إهداء)؛ المنتجات مع التخصيص والإضافات؛ الدفع (نية الدفع ومحاولات الدفع الإلكتروني وأسباب المراجعة)؛ الترحيل المحاسبي؛ ملخص (رسوم التوصيل + الإجمالي). |
| تنبيه الترحيل | الطلب غير المرحَّل يعرض تنبيه `role="alert"` واضحاً (خصوصاً الدفع عند الاستلام). «تم التحصيل» **لا** يُعرض إثباتاً لقيد؛ يظهر «غير مُرحَّل محاسبياً». رابط الفاتورة `/invoices/{id}` يظهر **فقط** حين يوجد `accounting.posted` من API. |
| التنقل | عنصر «الطلبات» بعد «نظرة عامة» بأيقونة `ClipboardList`، بشرط `commerce.orders.view` **و**قدرة `commerce.storefront` (نمط `appKey`+`permission` القائم). |
| تعدد المتاجر | يستعمل `active-store` القائم: المتجر النشط هو الافتراضي؛ «كل المتاجر» عبر `scope=all` في الرابط (لا `store=all`)؛ اختيار متجر يحدّث سياق مساحة العمل؛ `?store=` يُحفظ في روابط التفاصيل والعودة. `storefront_id` و`sales_channel_id` مرشِّحان مستقلان. `/commerce/orders` أُضيف إلى `STORE_AGNOSTIC_COMMERCE_PATHS` كي لا تُحجب بانتظار اختيار متجر. |
| الصلاحيات | الصفحتان تستعملان `useCan()` (حارس AC-UX-07)؛ بلا الصلاحية لا يُرسَل أي طلب. 403/404/422/شبكة لها حالات واضحة وإعادة محاولة. |
| اللغات والتصميم | ar/en (مفاتيح متطابقة باختبار)، RTL، Design Tokens (لا HEX — يحرسه اختبار)، أرقام `num`. |
| إصلاح مرافق | تسمية منطقة الصلاحية `orders` في `src/messages/{ar,en}.json` (`perm_areas`): كان `commerce.orders.view` من O1a يكسر `roles/catalog.test.ts` (لم يُكتشف لأن O1a لم يمسّ `web/`). |

## 2. الملفات المتغيرة

- جديد: `web/src/modules/commerce-workspace/orders/` — `contract.ts`، `messages.ts`، `orders-api.ts`، `order-display.tsx`، `orders-list.tsx`، `order-detail.tsx`، `test-fixtures.ts` + اختبارات (`contract`، `messages`، `orders-readonly`، `orders-list`، `order-detail`).
- جديد: `web/src/app/(commerce)/commerce/orders/page.tsx`، `[id]/page.tsx`، `page.test.tsx`.
- جديد: `web/e2e/commerce-orders-o1b.spec.ts` + `docs/audits/o1b-screenshots/*.png`.
- معدَّل: `nav.ts` (+`nav.test.ts` — قائمة المسارات المعتمدة صارت تتضمن `/commerce/orders`، وهو تغيير مقصود لا إخفاء فشل)، `active-store.ts`، `messages.ts` (مفتاح `orders`)، `commerce-workspace-nav.tsx` (أيقونة)، `src/messages/ar.json`/`en.json`.
- لا تغيير في `app/`، `routes/`، `database/`.

## 3. لقطات الشاشة (`docs/audits/o1b-screenshots/`)

`list-ar-desktop` · `list-ar-mobile` · `list-en-desktop` · `list-en-mobile` · `list-ar-dark-desktop` · `list-ar-dark-mobile` · `detail-ar-desktop` · `detail-ar-mobile` · `detail-en-desktop` · `detail-en-mobile`. (البيانات من خادم مُعترَض في Playwright، لا بيانات حقيقية.) شارة «Issues» الحمراء في اللقطات هي طبقة خطأ Next dev وسببها `INVALID_KEY` من next-intl يظهر أيضاً في صفحات قائمة (مثل `/users`)، وليس من هذه الوحدة.

## 4. الاختبارات

| المجموعة | النتيجة |
|---|---|
| وحدات وطبقات جديدة (contract, messages, read-only guard, list, detail, pages) | **54 اختباراً ناجحاً** (RBAC/عنصر التنقل، تحميل القائمة والتفاصيل، البحث المؤجَّل وحدّه الأدنى، الفلاتر والفرز والترقيم الخادمي، تعدد المتاجر واستمرار `?store=`، 403/404/422/شبكة/إعادة محاولة، فراغ/تحميل، طلب قديم متأخر، عدم وجود إجراءات كتابة، EN/RTL، بطاقة جوال) |
| `capabilities.guard` + `roles/catalog` + `commerce-workspace/*` | ناجحة بعد الإصلاحين أعلاه |
| Playwright (`commerce-orders-o1b.spec.ts`) | **14/14** (desktop 1440 + mobile 390؛ ar/en/dark؛ لا طلبات POST/PUT/PATCH/DELETE؛ لا تمرير أفقي؛ بلا صلاحية لا طلب؛ 403) |
| `npm run build` | ناجح؛ `/commerce/orders` و`/commerce/orders/[id]` ضمن المخرجات |
| `vitest` الكامل للواجهة | تشغيل أول: 8788 ناجح / **3 فشل** كلها من هذا العمل (حارس `useCan` ×1، تسميات الصلاحية ×2) وصُحّحت. إعادة التشغيل الكاملة: انظر §5. |
| `tsc --noEmit` | لا أخطاء في ملفات هذا التغيير (أخطاء سابقة في ملفات اختبار أخرى غير ذات صلة) |

لم أعدّل اختباراً قائماً لإخفاء فشل: الحارسان صحّحتُ سببهما في الكود/الرسائل، و`nav.test.ts` حُدِّثت لعنصر ناقص مقصود.

## 5. Build / CI

CI على الـPR يُلحَق في وصف الـPR وتعليقه بعد تشغيله. نتيجة `vitest` الكاملة الثانية تُذكر هناك.

## 6. حالة التفعيل للحسابات التجريبية (يحتاج إعداداً منفصلاً — لم أغيّره)

- `commerce.storefront` قدرة `built` غير إلزامية. `TenantApplicationService::statusFor` يعيد `disabled` لأي مستأجر **أُنشئ بعد** `ENFORCEMENT_CUTOVER_AT = 2026-08-21` ما لم تُفعَّل صراحةً؛ وتزويد المتجر (`CreateStorefrontForCurrentTenant`) **لا يفعّلها**.
- الأثر: حساب تجريبي جديد بمتجر قائم **لن يرى** عنصر «الطلبات» (`nav-state`) و`GET commerce/orders` سيردّ 403 حتى يفعّل مالك الحساب «التجارة الإلكترونية» من `/applications` (وتتطلب اعتماد `sales.invoicing`). الصفحة تشرح ذلك في حالة 403.
- لا تجاوز للحراسة ولا تفعيل عالمي. قرار مقترح للمالك: هل يُفعَّل `commerce.storefront` تلقائياً عند تزويد أول متجر؟ (يمسّ `TenantApplicationService` — خارج نطاق O1b).

## 7. المخاطر والمتبقي

| البند | ملاحظة |
|---|---|
| قناة الجوال في مرشِّح القنوات | خيارات القناة تُشتقّ من متاجر الويب في الكتالوج؛ لا endpoint لقنوات البيع، فلا يمكن تصفية طلبات قناة الجوال بالقناة (تظهر ضمن «كل المتاجر»). يحتاج API قنوات (خارج النطاق). |
| الضريبة والخصم | عقد O1a لا يفصّلهما؛ الواجهة تذكر ذلك صراحةً ولا تعرضهما. |
| المقيَّد بمخازن | يرى حالة 403 برسالة تشرح السبب (يُرفع في F1). |
| بحث `LIKE` | حدّ O1a؛ لا فهرسة هنا. |
| لقطات dev | تظهر شارة Issues من Next dev (سابقة، غير مرتبطة). |
| CI | يحتاج تأكيد Web CI على الـPR. |

## 8. Git

- **Branch:** `claude/commerce-orders-o1b`
- **Base SHA:** `1bc15a7dd826c3e52c5dd42dd7b3764775382c2f` (`origin/main` بعد دمج #1764 و#1766)
- **Head SHA / PR:** في وصف الـPR.

## 9. المرحلة التالية

**O3a** (يتطلب حسم D-9 أولاً): حالة `cancelled` وإلغاء الطلب بتنسيق الحجز والنية — أول مرحلة تضيف إجراء كتابة. بالتوازي (لا يتطلب D-9): **N4** تنبيه التاجر بطلب جديد (يحتاج D-12). وقبلهما قرار تفعيل `commerce.storefront` عند تزويد المتجر (§6).
