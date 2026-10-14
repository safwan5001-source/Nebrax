# AWJ-COMMS-UX-01 — Implementation Report

> **تحديث:** القسم **9 (Final Completion)** في آخر الملف هو الحالة النهائية، ويحلّ محلّ الأقسام 1–8 حيث تتعارض (عدد المزودين والشعارات والاختبارات). الأقسام 1–8 تبقى سجلاً للتسليم الأول.

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

---

## 9. Final Completion (AWJ-COMMS-UX-01 — Final Review & Completion)

### 9.1 الملخص

- **8 مزودين** في 4 قنوات: أُضيف **Taqnyat — تقنيات** (SMS، مرشّح مستقبلي سعودي، غير متصل، يتطلب موافقة المالك).
- **تغطية الشعارات الرسمية: 5 من 8** (كانت 1 من 7): Unifonic · Taqnyat · Postmark · Firebase Cloud Messaging · WhatsApp. ثلاث فجوات مسمّاة بأسبابها: Twilio · Amazon SES · APNs (§9.4).
- **الفصل الصريح بين «خيار مستقبلي» و«متصل فعلاً»**: كل بطاقة تحمل سطر «غير متصل · لا إرسال فعلي»؛ الدليل مقسوم إلى «خيارات مستقبلية (غير متصلة)» و«الحالة الفعلية: متصل فعلاً — لا يوجد»؛ الملاحظة العليا تنص أن لا مزود متصل، ولا إرسال حقيقي، ولا اختبار مع API حقيقي، ولا تفعيل أو اعتماد تجاري أو تعاقد.
- لا Backend/API/Schema/OTP/FakeOtpProvider، لا Adapter ولا Credentials ولا مفاتيح ولا إرسال، ولا أزرار ربط أو حفظ. الرابط الوحيد في الكتالوج مسار التنقّل.
- دُمج `main` (AC-UX-06) في الفرع بلا تعارض.

### 9.2 الملاحظات المعمارية الثلاث — **لم تُعثر عليها**

| الفحص (على الـPR #1479، Head `556463546bb2…` ثم الحالي) | النتيجة |
|---|---|
| المراجعات (`get_reviews`) | **0** |
| Review Threads / تعليقات مضمّنة (`get_review_comments`) | **0** |
| تعليقات المحادثة (`get_comments`) | تعليق واحد فقط من `chatgpt-codex-connector[bot]` نصه: «You have reached your Codex usage limits for code reviews» — **ليس مراجعة** ولا يحوي أي ملاحظة |
| البحث عن `COMMS-UX` في Issues/PRs | 0 نتيجة |
| البحث في المستودع | لا ذكر للمهمة خارج ملفاتها |

**الحالة: Not Found.** لم أجد نص أي ملاحظة معمارية ولا مصدرها، **ولم أختلق بدائل**، ولم أعدّل شيئاً على أساس ملاحظات غير مثبتة. السبب الظاهر أن مراجِع Codex لم يعمل على هذا الـPR بسبب استنفاد الحصة. المطلوب لإغلاق هذا البند: لصق نص الملاحظات الثلاث، أو إعادة تشغيل مراجعة Codex بعد تجديد الحصة؛ وسأعالج كل ملاحظة بالتصنيف Fixed / Already Addressed / Deferred / Not Reproducible على آخر Head.

للتمييز فقط (ليست ملاحظات مراجعة): الأسئلة الثلاثة التي رفعتُها للمالك في التسليم الأول حُسمت بتعليمات هذه المهمة — (1) قائمة المزودين: تبقى السبعة وتُضاف Taqnyat؛ (2) شعار WhatsApp: يبقى وتُسجَّل قيوده (§9.4)؛ (3) الشعارات: ارتفعت التغطية من 1 إلى 5.

### 9.3 المزودون الثمانية وحالة الشعار

| # | المزود | القناة | الحالة (وصفية، غير متصل) | الشعار |
|---|---|---|---|---|
| 1 | Unifonic | SMS | يتطلب موافقة المالك | **رسمي** (PNG 2084×2084) |
| 2 | Taqnyat (تقنيات) | SMS | يتطلب موافقة المالك | **رسمي** (SVG أفقي 314×105، حامل فاتح) |
| 3 | Twilio Messaging | SMS | متاح كخيار مستقبلي | **فجوة** — يلزم إذن كتابي |
| 4 | WhatsApp Business Platform | WhatsApp | مخطط | **رسمي** (SVG، الأصل القائم) |
| 5 | Amazon SES | Email | متاح كخيار مستقبلي | **فجوة** — يلزم إذن كتابي |
| 6 | Postmark | Email | متاح كخيار مستقبلي | **رسمي** (SVG) |
| 7 | Firebase Cloud Messaging | Push | متاح كخيار مستقبلي | **رسمي** (SVG، Product Logomark) |
| 8 | Apple Push Notification service | Push | متاح كخيار مستقبلي | **فجوة** — لا أصل |

هوية Taqnyat: موقعها الرسمي (taqnyat.sa/en/channels/sms) يقدّم SMS/OTP API سعودياً، وتستضيف وثيقة امتثال. **ترخيص CST لها لم يُتحقق منه ولا يُدّعى.**

### 9.4 مصادر الشعارات والفجوات

كل أصل رسمي محفوظ محلياً **بايتاً ببايت** تحت `web/public/comms-providers/` (عدا WhatsApp الموجود في `/brand/social`)، و`sha256` لكل ملف مسجَّل في السجل ويفحصه اختبار — فأي تعديل أو إعادة رسم أو تلوين يُفشل الاختبار. ملفات SVG فُحصت: لا `script` ولا `foreignObject` ولا مراجع خارجية (اختبار آلي). لا روابط صور خارجية وقت التشغيل (اختبارا وحدة و e2e). النسبة الطبيعية محفوظة (`object-contain` بأبعاد طبيعية). الشعار الأفقي (Taqnyat) داكن على شفاف فيُحمل على خلفية بيضاء في الوضعين كي يُقرأ، دون تلوين الشعار نفسه.

| المزود | الملف | المصدر | القيود المعروفة |
|---|---|---|---|
| Unifonic | `unifonic.png` | https://www.unifonic.com/hubfs/Favicon_Round_Green.png (رمز الشركة الدائري، موقعها الرسمي) — 2026-10-14 | لا سياسة علامة منشورة ولا Press kit (`/brand` `/press` = 404). يلزم تأكيد كتابي قبل الإنتاج |
| Taqnyat | `taqnyat.svg` | https://taqnyat.sa/assets/images/LogoMain.svg (موقعها الرسمي) — 2026-10-14 | لا سياسة علامة منشورة (`/en/brand` = 404). يلزم تأكيد كتابي قبل الإنتاج |
| Postmark | `postmark.svg` | https://postmarkapp.com/images/logo-stamp-simple.svg (موقعها الرسمي) — 2026-10-14 | لا صفحة علامة منشورة. يلزم تأكيد كتابي قبل الإنتاج |
| Firebase Cloud Messaging | `firebase-cloud-messaging.svg` | `Product_Logomark_Cloud_Messaging_Full_Color.svg` من https://firebase.google.com/static/downloads/brand-guidelines/firebase-brand-assets.zip — 2026-10-14 | إرشادات https://firebase.google.com/brand-guidelines: لا يُقرن بالاسم/المنتج الخاص بنا ولا يكون أبرز عنصر ولا يقل عن 24px ولا إيحاء بتأييد؛ **الـLockup القياسي محظور داخل المنتج ولم يُستعمل** |
| WhatsApp | `/brand/social/whatsapp.svg` (قائم) | WhatsApp Brand Resource Center، `Digital_Glyph_Green_RGB_2026.svg`، موثّق في `OfficialSocialMark.tsx` | شروط Brand Resource Center؛ لا إيحاء بشراكة |

**الفجوات المتبقية (بالاسم والسبب):**

1. **Twilio** — الأصل موجود على twilio.com، لكن سياستها (https://www.twilio.com/en-us/legal/logo-use) تنص: «you may not use it without our express written permission» (trademark@twilio.com)، والاستثناء الوحيد شارة «Powered by Twilio»؛ ولا تغطي قوائم المزودين. **لم يُشحن** احتراماً لنص السياسة.
2. **Amazon SES** — الأصل في حزمة AWS Architecture Icons المرخّصة لـ«إنشاء مخططات معمارية»؛ وإرشادات AWS للعلامات (https://aws.amazon.com/trademark-guidelines §13 و§3(d)) تحصر الاستعمال العادل بالنص دون شعارات وتشترط إذناً كتابياً لما عداه. **لم يُشحن**.
3. **APNs** — لا تنشر Apple شعاراً لهذه الخدمة، وشعار Apple لا يدل على خدمة طرف ثالث.

> **قرار للمالك:** Twilio وAmazon SES يمكن إضافتهما بسطر في السجل بمجرد وصول الإذن الكتابي (أو قبولك الصريح للمخاطرة). لم أستعمل أيقونات App Store أو مواقع تجميع الشعارات كبديل.

### 9.5 الملفات المتغيرة (هذا الاستكمال)

| الملف | السبب |
|---|---|
| `web/src/lib/communications-providers.ts` | Taqnyat؛ نموذج الشعار الموسَّع (sha256، أبعاد، شكل، حامل، مصدر، قيود)؛ الفجوات المسمّاة؛ وصف الحالات |
| `web/public/comms-providers/{unifonic.png,taqnyat.svg,postmark.svg,firebase-cloud-messaging.svg}` | **جديدة** — الأصول الرسمية بلا تعديل |
| `web/src/components/integrations/communications-provider-mark.tsx` | شعار مربّع/أفقي بنسبة محفوظة، حامل فاتح للأفقي، رجوع للأيقونة العامة عند فشل التحميل |
| `web/src/components/integrations/communications-catalog.tsx` | سطر «غير متصل» لكل بطاقة؛ دليل بمجموعتين (خيارات مستقبلية / الحالة الفعلية) |
| `web/src/messages/ar.json` · `en.json` | نصوص الحالات والدليل و«غير متصل» والملاحظات (مفاتيح متطابقة في اللغتين) |
| `web/src/lib/communications-providers.test.ts` · `communications-catalog.test.tsx` | 8 مزودين؛ 5 رسمية/3 فجوات؛ sha256؛ سلامة SVG؛ Taqnyat؛ سطر «غير متصل»؛ فصل «مستقبلي/متصل»؛ لا hotlink |
| `web/e2e/int-ux-1-integration-center.spec.ts` | 8 بطاقات؛ 5 شعارات محمّلة بنسبتها؛ 3 أيقونات عامة؛ لا صور خارجية؛ Taqnyat أفقي |
| هذا التقرير | القسم 9 |

### 9.6 الاختبارات

| الأمر | النتيجة |
|---|---|
| `npx vitest run` (المركز + design) | ✅ 470/470 |
| `npm run test` كامل (كما في Web CI) | ✅ **603 ملفاً / 6595 اختباراً — 0 فشل** |
| Playwright `int-ux-1-integration-center.spec.ts` (desktop 1440 + mobile 390 × ar-RTL/en-LTR × light/dark) | ✅ 53 نجح · 1 skipped (مقصود: درج الشريط في الجوال) |
| الصلاحيات `company.manage` | ✅ اختبارات الصفحة (مالك مسموح، `invoices.view` وحدها مرفوض، جلسة مجهولة مرفوضة، لا طلب شبكة) + e2e الرفض |
| إمكانية الوصول | تباين WCAG AA مفحوص في e2e؛ الشعار `alt=""` والاسم نص ظاهر؛ الحالة بنص+أيقونة لا باللون وحده؛ لا تمرير أفقي؛ بطاقات داخل حدود الشاشة |
| ملاحظة | فشل واحد ظهر في تشغيل وسيط: `drift-ratchet` (سبّبه `bg-white` في مكوّن الشعار). **أُصلح** بحامل بلون كلمة مضمّن مع تعليل، دون رفع سقف الـratchet؛ والمجموعة الكاملة خضراء بعده |

### 9.7 Build / TypeScript / CI

- `npm run build`: ✅ (المسار `/integrations/communications` مبني).
- `tsc --noEmit`: 47 خطأ **سابق** في ملفات غير مرتبطة — العدد نفسه على الـbase؛ **صفر** في ملفات هذا العمل.
- ESLint: غير مضبوط في المستودع (لا `.eslintrc`/`eslint.config`) ولا يُشغَّل في CI. لم يُشغَّل.
- `php artisan test`: لم يُشغَّل محلياً (لا تغيير Backend)؛ يعمل في CI على الـPR.
- CI على Head التنفيذ `e9fe0eee…`: انظر تقرير PR/رسالة التسليم للحالة بعد اكتمال الفحوص؛ **لا يُعتبر ناجحاً إلا بعد اكتمال كل الفحوص المطلوبة**. (على Head السابق `55646354…`: web build ×2 ✅، php sqlite ✅، php pgsql ✅، CI Gate كان قيد التنفيذ وقت الفحص.)
- **فشل CI جديد سببه التعديل وأُصلح:** على Head `e9fe0eee…` فشل «web build (Next.js)» لأن `capabilities.guard.test.ts` (AC-UX-07، وصل إلى `main` بعد آخر دمج لي) يمنع الاستيراد المباشر لـ`hasPermission` في الصفحات الجديدة، وصفحة `communications/page.tsx` كانت تستورده. لم يظهر محلياً لأن الحارس لم يكن في شجرتي. الإصلاح: دمج `main` الجديد وانتقال الصفحة إلى `useCan` من `@/lib/use-can` (دون تعديل القائمة القديمة ولا توسيعها). بعد الإصلاح: المجموعة الكاملة 608 ملفاً / 6675 اختباراً ✅ والبناء ✅ محلياً.
- فشل سابق على الـBase غير مرتبط: `int-ux-2` Keeta detail (12 حالة تفشل على `main` أيضاً).

### 9.8 المخاطر والمؤجَّل

1. **الملاحظات الثلاث غير موجودة** (§9.2) — بند مفتوح بانتظار نصها.
2. **قيود العلامات:** Unifonic وTaqnyat وPostmark بلا سياسة منشورة؛ الأصول من مواقعها الرسمية. يوصى بتأكيد كتابي قبل أي إطلاق إنتاجي. Firebase مشروط بإرشاداتها (§9.4). WhatsApp مرخّص لسياق التذييل واستعماله هنا لتعريف الخدمة فقط.
3. **Twilio وAmazon SES وAPNs** بلا شعار (§9.4) حتى يصدر إذن أو يُقبل الوضع.
4. **Taqnyat:** ترخيص CST لم يُتحقق منه.
5. **متطلبات AWJ Communications Foundation — Backlog فقط، غير منفّذة:** بيانات اعتماد مشفّرة لكل مستأجر، RBAC وتدقيق، سجلات موافقة وقائمة Opt-out، إعادة محاولة وidempotency، حالة التسليم/القراءة، فصل Transactional/OTP/Marketing، قوالب الرسائل، سجلات التسليم، احتساب التكاليف، Failover عند السماح، اختبارات عزل بين المستأجرين، Adapter لكل مزود (المرجع: `AWJ_GROWTH_PLATFORM_V1.md` §7). أي منها يحتاج موافقة منفصلة صريحة ومهمة مستقلة.
6. أي حالة «متصل فعلاً» مستقبلاً يجب أن تأتي من قراءة خادمية مُثبتة، لا من تعديل السجل (النوع `ProviderStatus` لا يسمح بها اليوم).

### 9.9 Branch / PR / SHAs

- **Branch:** `feat/awj-comms-ux-01-comms-providers`
- **PR:** https://github.com/safwan5001-source/Nebrax/pull/1479 (نفسه، لم يُنشأ PR جديد)
- **Base SHA الأصلي:** `cf58c965153ba33db3899c07969625d251ca33ba` · **Base الحالي (`main`):** `beaa6bf15b5b2284b0973bf41004dbe76a59afdc` (دُمج في الفرع)
- **Head التسليم الأول:** `556463546bb22c5d543c426bb77536b4e2335f71`
- **Head التنفيذ النهائي:** `e9fe0eee8ecd04ad58948726e2171886f4ddafd2`
- **Head النهائي للـPR:** commit توثيق فقط يلي `e9fe0eee…` (لا يمكن لملف أن يحمل SHA الـcommit الذي يغيّره)؛ يُذكر في رسالة التسليم وفي تعليق الـPR.

### 9.10 الخطوة التالية المقترحة

1. لصق نص الملاحظات المعمارية الثلاث (أو إعادة تشغيل مراجعة Codex) لحسمها على آخر Head.
2. قرار المالك: طلب إذن Twilio وAWS الكتابي أو إبقاء الأيقونة العامة؛ وتأكيد كتابي من Unifonic وTaqnyat وPostmark قبل الإنتاج.
3. التحقق من ترخيص CST لـTaqnyat قبل أي قرار اختيار مزود SMS.
4. مهمة منفصلة موافَق عليها لـCommunications Foundation (§9.8-5) — لا شيء منها يبدأ قبل موافقة صريحة.
5. لا Merge ولا Deploy قبل موافقة المالك الصريحة.
