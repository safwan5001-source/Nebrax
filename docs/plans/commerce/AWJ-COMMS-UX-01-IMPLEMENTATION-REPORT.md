# AWJ-COMMS-UX-01 — Implementation Report

**Task:** إضافة فئة «مزودو الاتصالات» إلى Settings → مركز التكاملات (UI فقط).
**Base:** `main` @ `cf58c965153ba33db3899c07969625d251ca33ba`
**Branch:** `feat/awj-comms-ux-01-comms-providers`
**PR / Head SHA:** انظر وصف الـPR ورسالة التسليم (الـHead يتغير عند أي commit لاحق، فلا يُثبَّت داخل الملف).
**Merge / Deploy:** لم يُنفَّذ أيٌّ منهما — للمراجعة فقط.

---

## 1. الملخص

- بطاقة خامسة «مزودو الاتصالات» في `/integrations` بنفس نمط بطاقة منصات التوصيل (رابط تنقّل + شارة + سهم يعكس في RTL)، تُلحَق **في النهاية** كي لا تتحرك مواضع البطاقات المعتمدة.
- صفحة كتالوج وصفية ثابتة `/integrations/communications`: أربع قنوات (SMS · WhatsApp · Email · Push) و7 مزودين معروفين، لكلٍّ منهم الجهة المالكة وحالته.
- **لا شيء يُعرض «متصل» أو «مفعّل».** نوع الحالة `ProviderStatus` يحتوي ثلاث قيم فقط (`theoretical` متاح نظرياً · `planned` مخطط · `owner_approval` يتطلب موافقة المالك)؛ «متصل فعلاً» ليست قيمة في النوع أصلاً وتظهر في دليل المعاني بعبارة «لا يوجد أي مزود بهذه الحالة حالياً». ملاحظة صريحة أعلى الصفحة: لا مزود متصل، لا رسائل حقيقية، التحقق OTP يعمل عبر مزود تجريبي داخلي، وورود مزود في القائمة لا يعني اعتماده.
- لا أزرار ربط، ولا حقول مفاتيح، ولا إرسال تجريبي، ولا طلب شبكة من الصفحة. الرابط الوحيد في الكتالوج مسار التنقّل.
- **لم يُمسّ:** OTP، `OtpProvider`/`FakeOtpProvider` وربطه، أي backend، أي جدول أو API، أي مفتاح أو مزود مدفوع.

## 2. الملفات المتغيرة

| الملف | التغيير |
|---|---|
| `web/src/lib/communications-providers.ts` | **جديد** — سجل نقيّ: القنوات، المزودون، الحالات، الشعارات وسبب غيابها، أدلة الهوية والحالة |
| `web/src/lib/integration-center.ts` | فئة `communications` (رابط `/integrations/communications`) في نهاية `INTEGRATION_CATEGORIES` |
| `web/src/components/integrations/integration-center-landing.tsx` | `CommunicationsCard` (رابط عند الصلاحية، وإلا `div` خامل بنيوياً مع ملاحظة رفض) + prop `communicationsAllowed` |
| `web/src/components/integrations/communications-catalog.tsx` | **جديد** — صفحة الكتالوج (قنوات → بطاقات مزودين) |
| `web/src/components/integrations/communications-provider-mark.tsx` | **جديد** — شعار رسمي موثّق أو أيقونة القناة العامة، مع رجوع عند فشل التحميل |
| `web/src/app/(app)/integrations/page.tsx` | حساب `communicationsAllowed` من `company.manage` (مستقل عن بوابة نقاط البيع) |
| `web/src/app/(app)/integrations/communications/page.tsx` | **جديد** — بوابة الصلاحية؛ لا طلب شبكة |
| `web/src/messages/ar.json` · `en.json` | مفاتيح `integrationCenter.communications.*` (تطابق المفاتيح بين اللغتين يفحصه اختبار قائم) |
| اختبارات | `communications-providers.test.ts` · `communications-catalog.test.tsx` · `communications/page.test.tsx` **جديدة**؛ تحديث `integration-center.test.ts` · `integration-center-landing.test.tsx` · `integrations/page.test.tsx` · `no-connection-controls.test.ts` · `e2e/int-ux-1-integration-center.spec.ts` |

التحديثات على الاختبارات القائمة **مقصودة** لأن العقد المعتمد تغيّر بإضافة بطاقة نشطة ثانية (أربع بطاقات ← خمس، رابط واحد ← اثنان، موضع تركيز واحد ← اثنان). لم يُضعَف أي فحص: فحوص «لا ربط/تفويض/مزامنة» و«لا زر خام» و«لا كتابة للخادم» و«لا مسار متصل» تشمل الملفات الجديدة تلقائياً (أُضيفت إلى قائمة التغطية).

## 3. الشعارات ومصادرها وتراخيصها

القاعدة: أصل رسمي موجود في المستودع أو مرخّص صراحةً، وإلا أيقونة عامة موثّقة. لا شعار مولَّد أو تقريبي ولا hotlink (كل المصادر مسارات داخلية).

| المزود | القناة | الشعار المعروض | المصدر / الرخصة | سبب الغياب (إن وُجد) |
|---|---|---|---|---|
| WhatsApp Business Platform (Meta) | WhatsApp | **رسمي** `/brand/social/whatsapp.svg` | WhatsApp Brand Resource Center — `Digital_Glyph_Green_RGB_2026.svg`، موجود في المستودع منذ تذييل المتجر وموثّق في `OfficialSocialMark.tsx`؛ **بايتات غير معدّلة، لا نسخة جديدة**. الرخصة: شروط Brand Resource Center (مواد علامة للاستعمال وفق إرشاداتها، ليست رخصة مفتوحة) | — |
| Unifonic | SMS | أيقونة SMS عامة | — | لم يوجد Press kit/مجموعة علامة رسمية منشورة تثبت الملفات ورخصتها (بحث 2026-10-14)؛ أيقونة تطبيقها في App Store تخص منتجاً آخر (AgentApp) |
| Twilio Messaging | SMS | أيقونة SMS عامة | — | سياسة علامة Twilio: لا تُمنح الشعارات إلا بإذن كتابي من إدارتها القانونية (عدا شارة «Powered by Twilio» بشروطها) |
| Amazon SES | Email | أيقونة بريد عامة | — | سياسة AWS تحصر الترخيص بشارة «Powered by AWS» لعملاء الخدمة؛ لم يُحصل على أصل SES ولا إذن للاستعمال في واجهة منتج |
| Postmark | Email | أيقونة بريد عامة | — | لم تُحدَّد مجموعة علامة رسمية منشورة؛ لم يُحصل على أصل |
| Firebase Cloud Messaging | Push | أيقونة إشعارات عامة | — | إرشادات Firebase: الشعار القياسي «لا يُستعمل داخل منتج» وأيقونات المنتج مقيّدة؛ لم يُستعمل أي أصل |
| APNs (Apple) | Push | أيقونة إشعارات عامة | — | Apple لا تنشر شعاراً مستقلاً لـAPNs، وشعار Apple لا يدل على خدمة طرف ثالث |

كل مزود بلا شعار رسمي يحمل `logo.gap` مكتوباً في السجل، ويفحص اختبار أن لا مزود بلا شعار موثّق **أو** سبب موثّق، وأن الأصل الرسمي موجود على القرص، وأن الشعار الرسمي الوحيد هو الأصل القائم نفسه.

> **صدق التوثيق:** لم أُحمِّل أي أيقونات App Store للمزودين كبديل — هي أيقونات منتجات تطبيقية لا هوية المزود كخدمة اتصالات، فتبقى «تقريباً» ولا تحقق الشرط. مصدر الحقيقة للنقص هو `logo.gap`.

## 4. المزودون المعروضون ودليل هويتهم

| المزود | الحالة | دليل الهوية (صفحة المزود الرسمية، HTTP 200 وقت الفحص) | دليل الحالة في أَوْج |
|---|---|---|---|
| Unifonic | يتطلب موافقة المالك | unifonic.com | `OtpProvider.php` + `TASK-QUEUE.md`: «مرشح مستقبلي، وقرار منفصل للمالك» |
| Twilio Messaging | متاح نظرياً | twilio.com/docs/messaging | — |
| WhatsApp Business Platform | مخطط | developers.facebook.com/docs/whatsapp/cloud-api | `AWJ_GROWTH_PLATFORM_V1.md` §7 والمرحلة 6 |
| Amazon SES | متاح نظرياً | aws.amazon.com/ses | — |
| Postmark | متاح نظرياً | postmarkapp.com | — |
| Firebase Cloud Messaging | متاح نظرياً | firebase.google.com/docs/cloud-messaging | — |
| APNs | متاح نظرياً | developer.apple.com/documentation/usernotifications | — |

لا أحد منهم «معتمد». اختيار المجموعة (مثل SES وPostmark للبريد، أو Twilio) قرار عرضٍ وصفي قابل للمراجعة؛ **يحتاج تأكيد المالك** أنها القائمة الصحيحة (انظر §7).

## 5. الاختبارات ونتائجها

| الفحص | النتيجة |
|---|---|
| Vitest للمركز (18 ملفاً، 416 اختباراً) | ✅ 416/416 |
| `npm run test` كامل (كما في Web CI) | ✅ 599 ملفاً / 6561 اختباراً — 0 فشل |
| `npm run build` (Next 15) | ✅ ناجح؛ المسار `/integrations/communications` مبني |
| `tsc --noEmit` | 47 خطأ **سابق** في ملفات اختبار غير مرتبطة (`SliderFields.test.tsx` وغيرها) — **العدد نفسه على الـbase (47) وصفر في ملفاتي** |
| Playwright `int-ux-1-integration-center.spec.ts` (desktop 1440 + mobile 390 × ar-RTL/en-LTR × light/dark) | ✅ كله أخضر: تركيب الشبكة، التركيز، تباين WCAG AA، لا تمرير أفقي، كتالوج الاتصالات (شعار WhatsApp محمَّل فعلاً، 6 أيقونات عامة، لا `button/input`، لا طلب شبكة خاص بالصفحة)، رفض الصلاحية |
| Playwright `int-ux-2-delivery-platform-catalog.spec.ts` | 157 نجح · **12 فشل كلها `keeta` detail** — **تفشل بالمثل على الـbase** (تحقّقت بـ`git stash`: `Expected: 0 / Received: 1`)؛ غير مرتبطة بهذه المهمة |
| ESLint | **غير مضبوط في المستودع** (`next lint` يطلب إعداداً تفاعلياً؛ لا `.eslintrc`/`eslint.config`) ولا يعمل في Web CI. لم أُنشئ إعداداً جديداً |
| `php artisan test` | لم يُشغَّل: لا تغيير في backend/migrations/مسارات/محاسبة. **لا عملية مالية جديدة ولا قيود** (جدول القيود غير منطبق) |

لقطات التحقق البصري (ar/en × light/dark × desktop/mobile) أُنتجت محلياً في مجلد scratchpad ولم تُرفع للمستودع.

## 6. Build / CI

- Build محلي ناجح. Web CI (`npm run test` + `npm run build`) مطابق لما نُفّذ محلياً.
- حالة CI على الـPR: تُراجَع على الـPR نفسه بعد الرفع.

## 7. المخاطر والمتبقي

1. **قائمة المزودين تحتاج تأكيد المالك.** المرجع المعتمد يذكر صراحةً Unifonic (مرشح) وWhatsApp/Meta (مخطط) فقط؛ Twilio وSES وPostmark وFCM وAPNs أُدرجت كمعروفة وموثّقة الهوية بحالة «متاح نظرياً». يمكن تقليصها بحذف أسطر من السجل دون أي أثر آخر. لم أُدرج مزودين سعوديين آخرين (مثل Taqnyat) لعدم التحقق منهم في هذه الجلسة.
2. **الشعارات: مزود واحد فقط من سبعة.** الباقي أيقونات عامة مؤقتة. لإكمالها: طلب أصول رسمية/إذن من Unifonic وTwilio وPostmark وAWS؛ Firebase وApple غالباً تبقى عامة. **WhatsApp:** الأصل مرخّص لسياق الاتصال بالعملاء في تذييل المتجر؛ عرضه هنا للدلالة على «WhatsApp Business Platform» يحتاج تأكيد المالك أنه ضمن إرشادات Meta (استعمال الشعار لتعريف الخدمة لا للإيحاء بشراكة، وقد تجنّبنا أي شارة شراكة).
3. **الصلاحية `company.manage` اختيار قابل للمراجعة** (لا صلاحية جديدة؛ نفس صلاحية إعداد منصات التوصيل). مدخل الشريط الجانبي ما زال محروساً بـ`invoices.view` — من يملكها ولا يملك `company.manage` يرى بطاقة خاملة برسالة رفض (لا صفحة ميتة).
4. **تخطيط الشبكة:** البطاقة الخامسة تبدأ صفاً ثالثاً وحدها على سطح المكتب (فراغ بصري مقبول؛ بديله وضعها ثانياً فيحرّك مواضع المعتمدة).
5. **غير مبني (مقصود، يحتاج موافقة منفصلة):** أي جدول/API، حالة اتصال فعلية، إعداد مزود، مفاتيح، إرسال تجريبي، مصفوفة قدرات لكل مزود، سجل موافقات/Opt-out. أي حالة «متصل» مستقبلاً يجب أن تأتي من قراءة خادمية مُثبتة كسُلّم منصات التوصيل لا من تعديل السجل.
6. اختبارات Keeta في INT-UX-2 تفشل على `main` (سابقة، خارج النطاق) — يُنصح بفتح مهمة منفصلة.

## 8. Branch / PR / SHAs / الخطوة التالية

- **Branch:** `feat/awj-comms-ux-01-comms-providers`
- **Base SHA:** `cf58c965153ba33db3899c07969625d251ca33ba`
- **Head SHA / PR:** في رسالة التسليم ووصف الـPR.
- **الخطوة التالية:** (1) مراجعة المالك وتأكيد قائمة المزودين وعرض شعار WhatsApp؛ (2) طلب الأصول الرسمية للمزودين الباقين أو قبول الأيقونات العامة؛ (3) مهمة منفصلة لـ«Messaging/Communications Foundation» (قراءة حالة خادمية، جداول، موافقات) بعد قرار المالك؛ لا Merge ولا Deploy قبل الموافقة.
