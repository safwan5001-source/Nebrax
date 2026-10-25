# AWJ Store Commerce — Master Horizon V1

**الحالة:** خطة وتوثيق فقط — لا تفوّض تنفيذاً أو دمجاً أو نشراً · **التاريخ:** 2026-10-25 · **Base:** `main@cc9ebf2c0f06b22f39c90b63a798ebb06980a2e7`
**المالك:** Safwan · **الملفات المرافقة:** `AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` (متتبّع حيّ) · `docs/audits/AWJ_STORE_COMMERCE_HORIZON_HANDOFF.md`

> **المراجع (لا نعيد البحث):** PR #1743 (تدقيق Spree الكامل وخطة الخروج، مفتوح غير مدمج): `docs/audits/AWJ_SPREE_FULL_DEPENDENCY_AUDIT.md`، `docs/plans/store/AWJ_SPREE_EXIT_MIGRATION_PLAN.md`، `docs/audits/AWJ_SPREE_AUDIT_HANDOFF.md` · PR #1744 (X1+X2) **مدموج** → `docs/audits/AWJ_SPREE_X1_X2_IMPLEMENTATION_REPORT.md` · PR #1745 (Checkout Theme Parity، Codex، مفتوح).
> **تنبيه سلامة المراجع:** وثائق #1743 غير موجودة على `main` بعد؛ هذه الخطة تحيل إليها بالـPR. يُوصى بمراجعة/دمج #1743 (قرار منفصل) ليصبح مرجعها قابلاً للقراءة من `main`.

---

## 1. الغرض والنطاق

خطة أفقية (Horizons) تجمع مسارين متمايزين وتمنع خلطهما:

| المسار | التعريف | يُغلق بـ |
|---|---|---|
| **Spree Exit (E)** | إزالة الاعتماد **التشغيلي والنوعي** على Spree مع الإبقاء على واجهة المتجر وترخيص MIT | بوابة الخروج **G** (H6) |
| **Commerce Completion (C)** | سدّ الفجوات الوظيفية في متجر AWJ **المستقلة عن Spree** (طلبات، شحن، فوترة COD، مرتجعات، إشعارات، عروض…) | تغطية الصفوف **F01–F84**: كل صف Implemented أو مُسقَط/مؤجَّل بقرار مالك موثّق |
| **External/Gate (X)** | عمل يملكه طرف آخر أو قرار/بوابة مالك (CTP1 لـCodex، G3، EXT-05، ENV0) | يُرصد ولا يُنفَّذ هنا |

**قاعدة:** حذف Spree لا يُفقد قدرة تعمل اليوم (لا شيء من Spree يعمل بلا Backend) لكنه لا يحلّ فجوات C. الخروج لا يشترط اكتمال C إلا حيث وُسمت تبعية صريحة (AN1 قبل R1، D-14 قبل R2…).

**خارج النطاق:** تنفيذ H1–H6؛ فتح G3 أو EXT-05؛ أي Merge/Deploy؛ تعديل فرع Codex؛ تغيير كود/قاعدة بيانات/API في هذا الـPR.

## 2. تعريف «الاكتمال» (لا اكتمال بمجرد الكتابة أو الدمج)

لكل شريحة **متجه حالة** من خمس مراحل مستقلة تُتتبَّع منفصلة:

| # | المرحلة | معنى | الدليل |
|---|---|---|---|
| 1 | **Code** | كُتب في PR مراجَع | رابط PR، مراجعة، ردود المراجعين مقروءة ومحسومة |
| 2 | **Merged** | في `main` بموافقة صريحة | SHA الدمج |
| 3 | **CI-green on main** | بوابات CI خضراء بعد الدمج | تشغيل CI على `main` |
| 4 | **Deployed** | منشور على بيئة محددة (Preview/Staging/Beta) بموافقة نشر **مستقلة** | معرّف النشر + المراجعة المنشورة |
| 5 | **Env-Verified** | تحقق وظيفي/أمني على البيئة الفعلية وفق قائمة الشريحة | سجل تحقق (من، متى، أين، نتيجة) |

* **Closed** = المراحل 1–5 + اعتماد المالك. الدمج وحده ≠ نشر ≠ تحقق.
* **الأفق** لا يُغلق إلا بإغلاق كل شرائحه (Closed) + اجتياز معايير خروجه + **تقرير إغلاق** موقَّع من المالك. لا يُعدّ أفق مكتملاً لأن كوده كُتب أو دُمج.
* **حالة X1/X2 اليوم:** Code ✓ · Merged ✓ (#1744) · CI-green on main: يُتحقَّق · Deployed: **غير معروف** · Env-Verified: **لم يتم** ⇒ **ليست Closed**.

## 3. الثوابت الإلزامية (تنطبق على كل شريحة)

1. **عزل المستأجر:** مستأجر الويب من `Host` (`ResolveStorefrontDomain`) فقط؛ مسارات الموظفين `auth:sanctum`+`SetTenant`+`SetBranch`؛ لا tenant/customer من الحمولة؛ 404 موحّد؛ كل نموذج جديد يرث `BaseModel` ويُصنَّف فرعياً (`BranchScoped`/`BelongsToBranch`/`CompanyWide`) وإلا فشل `BranchIsolationGuardTest`؛ ذاكرة مؤقتة لا تتجاوز المستأجر (المضيف في المفتاح؛ ردود المشتري `no-store`).
2. **RBAC:** صلاحيات جديدة (`commerce.orders.view`, `commerce.orders.manage`) في `Rbac` + جدول الأدوار (زرع طبق الأصل للتوافق) + `EnsurePermission` + `EnsureApplicationActive`؛ PII الطلب محجوب عمن لا يملك الصلاحية.
3. **الدقة المحاسبية:** كل أثر مالي عبر `LedgerService::post`/`InvoiceService`/`PaymentService` حصراً؛ إجماليات مشتقة؛ هللات bigint؛ `source_type/source_id`؛ قفل الفترة والسنة؛ `CommerceOrder ≠ Invoice`؛ `Reservation ≠ StockMovement`؛ لا قيد مباشر في `journal_lines`؛ **قبل أي PR مالي: `php artisan test` كاملاً + جدول القيود الناتجة** (قاعدة CLAUDE.md).
4. **ZATCA:** توقيت إصدار الفاتورة قرار ADR لا تخمين؛ لا مساس بسلسلة ICV/PIH التاريخية ولا بمخرجات 381؛ بوابة EXT-05 تبقى مغلقة حتى `tax_opinion_ref`؛ لا Backfill.
5. **Idempotency:** `checkout/complete` بـ`Idempotency-Key`؛ مِرساة لكل ترحيل؛ replay لا يكرّر طلباً ولا مستنداً ولا رسالة.
6. **التوافق الرجعي:** مسارات وحقول **إضافية** فقط؛ استجابات `store/v1` الحالية حرفياً عند إغلاق البوابات (نمط PAY-H4)؛ افتراضات السياسات تحمي المستأجرين القائمين (قاعدة #6)؛ هجرات إضافية؛ روابط وكوكيز قديمة بتوافق (308/تنظيف)؛ مجمّد: `FlowersEndToEndJourneyTest` وعقد `contracts/flowers-journey/**`.
7. **فصل الدمج/النشر/البيئة:** ثلاثة قرارات منفصلة تُسجَّل في المتتبّع (§2).
8. **PR صغير مستقل:** شريحة = PR؛ لا خلط عقد خلفي مع تبنّي واجهة؛ ADR في PR مستقل؛ Draft أولاً؛ تُقرأ ردود المراجعة كلها قبل الدمج (درس #1273)؛ كل PR يُرفق ما تغيّر/ما لم يتغير/الاختبارات/المخاطر.
9. **لا إعدادات بديلة مؤقتة:** ممنوع ضبط `SPREE_*` بقيم وهمية؛ ممنوع تفعيل بوابات G3/EXT-05 ضمن الخطة.

## 4. بوابات CI (قائمة) وما يُضاف

**قائمة اليوم (من آخر تشغيل #1744):** `CI Gate` · `php artisan test (L11, sqlite)` · `php artisan test (L11, pgsql)` · `storefront (lint + typecheck + test)` · `docker-context` (#1742) · `merchant preview visual QA` · `published footer visual QA`.
**تُضاف:** X6 (حارس Spree ratchet) · E1 (مسار e2e بـfixtures AWJ، استشاري ثم إلزامي) · لأفق H3/H4: `zatca-sdk-conformance` إلزامي للشرائح المالية.
**قاعدة:** لا Merge على فحص أحمر؛ فشل غير مرتبط يُوثَّق بتعليق واحد (قاعدة البروتوكول) ولا يُتجاوَز بالفحص الفارغ.

## 5. سجل القرارات D-1…D-14

كل القرارات **مفتوحة** بانتظار Safwan. «يحجب» = الشرائح التي لا تبدأ قبل حسمها.

| ID | القرار | التوصية | مطلوب بحلول | يحجب | الحالة |
|---|---|---|---|---|---|
| D-1 | آلية جلسة مشتري الويب أمام `store/v1` | BFF: خادم Next يحمل توكن المشتري في كوكي HttpOnly ويمرّره مع سر البوابة وHost؛ الخلفية تتحقق من تطابق المستأجر | H1 | B1، B2، B3، B4، B5، B6، B7، S1، S2، S3، S4، S5، S6، S7 | Open |
| D-2 | قناة التحقق واستعادة كلمة المرور | هاتف+OTP أساسي وبريد+كلمة مرور بديل (مواءمة COM-MOBILE-AUTH-1)؛ يحتاج مزوّد SMS وقالب بريد | H1 | B3، N1، N5، S2 | Open |
| D-3 | مصير بوابة الجملة | حذف الآن | H6 | W1، R1 | Open |
| D-4 | مصدر صفحات السياسات | endpoint قراءة `store/v1/policies/{slug}` (404 عند عدم النشر، HTML منقّى) | H5 | X4، B8 | Open |
| D-5 | بطاقات الهدايا/البطاقات المحفوظة/الكوبونات/المفضلة (تنفيذات Spree) | حذف تنفيذات Spree؛ كل قدرة بعقد مستقل لاحقاً | H5 | P2c، R1 | Open |
| D-6 | عمر الجلسة وتجديدها | منزلقة محدودة (تدوير توكن) إن توفّر؛ وإلا ثابتة مع إعادة دخول | H1 | B2 | Open |
| D-7 | الشحنات المتعددة | إسقاط | H2 | CK6 | Open |
| D-8 | الأثر المالي لطلبات COD/الاستلام وتوقيت ZATCA | ADR محاسبي/ضريبي؛ مغلق افتراضياً على نمط PAY-H4-03 | H3 | INV1، INV2، INV3 | Open |
| D-9 | دورة حياة الطلب (حالات، أبعاد الدفع/التنفيذ، الإلغاء) | ADR؛ يحافظ على `CommerceOrder ≠ Invoice` | H2 | O3، O4، F1، RT2 | Open |
| D-10 | حجز مخزون COD/الاستلام | سياسة قابلة للضبط: `none` (الافتراضي) أو `reserve_on_confirm` | H2 | CK4 | Open |
| D-11 | تقييم المرتجعات (Return≠Refund≠CreditNote≠Exchange) | ADR أولاً | H4 | RT1، RT2، RT3، RT4 | Open |
| D-12 | قنوات إشعار المشتري والتاجر وملكية القوالب والموافقة | مع D-2؛ المصدر Laravel (outbox) | H2 | N1، N2، N3، N4 | Open |
| D-13 | نطاق الكوبونات (رفع تأجيل ADR-11) | ADR مالي مشترك | H5 | P1c | Open |
| D-14 | مصير مسار البريد اليتيم عند R2 | إحلال N2 قبل R2 إن توفّر المزوّد؛ وإلا قبول صريح مكتوب | H6 | R2 | Open |

## 6. التنسيق مع Checkout Theme Parity (CTP1 — Codex، PR #1745)

* **ملكية:** Codex يملك `fix(storefront): apply published theme to AWJ checkout` (#1745: ثيم Checkout المنشور، اتجاه من اللغة، عقد الترويسة). **لا نكرّر عمله ولا نعدّل فرعه** (`codex/*`) ولا نفتح PR على ملفاته.
* **حدود الملفات:** `(store-checkout)/layout.tsx` وملفات الثيم/الترويسة ملك CTP1. شرائحنا التي تلمس Checkout (**CK1، CK2، S6، AN1، X5**) **تبدأ بعد دمج #1745** أو تُعاد تأسيسها عليه، وتتجنب تعديل الغلاف/الترويسة.
* **معايير H0 للـCTP1 (نرصدها فقط):** RTL/LTR، غياب بيانات presentation، تباين ترويسة داكنة، عقد `data-header-row`/`headerBrand`؛ والتحقق البيئي: الثيم المنشور يظهر على Checkout نطاق مستأجر تجريبي.
* **لا تبعية عكسية:** لا شريحة هنا تشترط تعديل ملفات CTP1؛ أي تعارض يُحل بإعادة التأسيس لا بالتعديل في فرع Codex.


## 7. الآفاق (Horizons)

**الترتيب:** إغلاق الآفاق H0→H6 تسلسلي، لكن **التنفيذ يتداخل** بحسب تبعيات الشرائح (مثلاً O1/O2/CK1 تبدأ قبل H1 لأنها لا تعتمد الهوية؛ AN1 تُسحب مبكراً لأنها تحجب R1؛ T1 مبكراً). التبعيات عبر الآفاق مُسجَّلة في §8.

### H0 — Stability, Security & Checkout Theme Parity

**الهدف:** تثبيت الأساس: لا انحدار أمني أو وظيفي، لا فشل صامت في الصفحات العامة، تكافؤ ثيم Checkout، وخط أساس بيئي موثّق. لا ميزات جديدة.

**الشرائح:** X0, X1✓, X2✓, X3, X5, X6, ENV0 + رصد CTP1 (Codex، PR #1745)

**شرط الدخول:** `main` أخضر؛ #1744 مدموج (تم). لا حاجة لقرارات D-x لبدء X3/X5/X6.

**الصفوف الوظيفية (من الـ84):** F09, F79 — Implemented 1 · Partially 0 · Spree-dependent 1 · Missing 0 · Unverified 0.

**معايير القبول:**
1. X1/X2 مُتحقَّقان بيئياً (لا مجرد مدموجان): إشعار الإغلاق يظهر على نطاق مستأجر تجريبي، لا نموذج ولا نص خطأ داخلي، ولا `SPREE_*` مضبوطة في أي بيئة منشورة (قراءة أسماء فقط).
2. X3: `sitemap/*.xml` يُنتَج من `store/v1` (ترقيم مُتحقَّق)، ولا فشل صامت: فشل الجلب يُسجَّل ويُعلَن، وبلا `use cache: remote` غير مُفتَّح بالمضيف.
3. X5: `/checkout/[id]` و`/confirm-payment/[id]` و`/order-placed/[id]` تردّ 404 ما لم تكن الجملة مفعّلة؛ `/checkout` AWJ لا يتأثر.
4. X6: حارس عدّ يفشل عند زيادة أي من (استيراد قيمة، سطر استدعاء عميل، استيراد نوع، ملف يذكر `SPREE_*`) + اختبار «بلا بيئة Spree».
5. CTP1 (يملكه Codex): الثيم المنشور على Checkout RTL/LTR، بيانات presentation مفقودة، تباين ترويسة داكنة؛ لا نكرّر عمله ولا نعدّل فرعه.
6. صفحات `/policies/*`: إما حُلّت (X4) أو **قَبِل المالك خطرها صراحةً** مكتوباً (R-03).

**الاختبارات المطلوبة:**
- vitest كامل + tsc + biome + check:locales
- اختبارات الحراسة البنيوية (X6) ومسار الحساب المغلق
- Playwright fixture لـ`/checkout` بعد CTP1 (RTL/LTR، جوال)
- PostgreSQL: لا تغيير خلفي في H0

**بوابات CI:** storefront (lint+typecheck+test)، docker-context، CI Gate، visual QA (published footer / merchant preview)، + حارس X6 الجديد.

**التحقق البيئي (منفصل عن الدمج والنشر):** ENV0: تسجيل المضيف الحيّ والمراجعة المنشورة وأسماء المتغيرات؛ فحص `/sitemap/0.xml` و`/robots.txt` و`/policies/privacy-policy` و`/account` و`/account/register` على نطاق مستأجر تجريبي.

**معايير الخروج (Exit):**
- كل شرائح H0 في حالة Env-Verified (لا Merged فقط)
- لا `SPREE_*` في أي بيئة منشورة
- CTP1 Env-Verified من مالكه ومُسجَّل في المتتبّع
- توقيع المالك على تقرير إغلاق H0
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** خطر الوثائق التشغيلية القديمة (R-02) ما لم تُنظَّف البيئة يدوياً؛ تعارض ملفات مع #1745.  
**التراجع:** revert لكل PR؛ لا بيانات.

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| X0 | تثبيت القرارات وADR + خطة الخروج | E | P0 | — | D-1…D-14 | In PR | S |
| X1 | بوابة حساب المشتري (gated) + منع تسريب الأخطاء | E | P0 | — | — | Merged | S–M |
| X2 | تنظيف البيئة والوثائق (إزالة قيم Spree الوهمية) | E | P0 | — | — | Merged | S |
| X3 | Sitemap من AWJ (بدل Spree) + فشل غير صامت | E | P0 | — | — | Planned | M |
| X5 | إغلاق مسارات Checkout Spree غير المربوطة (404) | E | P1 | — | — | Planned | S |
| X6 | حارس ratchet + اختبار «بلا بيئة Spree» (جديد) | E | P1 | X1 | — | Planned | S |
| CTP1 | Checkout Theme Parity — تطبيق الثيم المنشور على Checkout AWJ | X | P0 | — | — | In PR | — |
| ENV0 | خط أساس التحقق البيئي: أسماء المتغيرات، المراجعة المنشورة، المضيف الحيّ | X | P0 | — | — | Planned | S |

### H1 — Buyer Identity & Sessions

**الهدف:** هوية مشتري ويب وجلسات على `store/v1` تعيد استعمال `CustomerIdentity`/Sanctum، مع تحقق/استعادة وملف شخصي، وتنظيف كوكيز Spree القديمة.

**الشرائح:** B1, B2, B3, B4, N1, N5, S1, S2, S3 — بعد D-1 وD-2 وD-6

**شرط الدخول:** D-1 وD-2 وD-6 محسومة؛ مزوّد SMS/بريد مختار (D-12 للقنوات)؛ H0 مُغلق.

**الصفوف الوظيفية (من الـ84):** F65, F68, F69, F70, F71, F72 — Implemented 0 · Partially 2 · Spree-dependent 3 · Missing 1 · Unverified 0.

**معايير القبول:**
1. المستأجر من `Host` فقط؛ `identity.tenant_id === TenantContext` إلزامي؛ توكن مستأجر آخر ⇒ 401/404 موحّد.
2. مسارات الهوية خلف `RequireStorefrontMutationGateway`؛ حدود معدّل لكل IP+معرّف؛ ردود موحّدة ضد التعداد.
3. الدخول لا ينجح دون تحقق؛ رموز التحقق/الاستعادة أحادية الاستعمال ومنتهية وبقفل محاولات.
4. الجلسة: HttpOnly+Secure+SameSite=Lax؛ لا توكن للعميل؛ التحقق خادمياً في layout (لا مجرد وجود كوكي).
5. نصوص الأخطاء رموز allowlist بترجمة محلية (امتداد `account-errors.ts`)؛ لا رسائل خام.
6. قلب `ACCOUNT_AUTH_CAPABILITY` إلى `live` ميزةً بميزة خلف بوابة منصّية تُغلق افتراضياً؛ تنظيف `_spree_*`.
7. لا أثر محاسبي/مخزني.

**الاختبارات المطلوبة:**
- Laravel Feature + PostgreSQL: عزل مستأجر، IDOR، سر البوابة، تقييد معدّل، انتهاء الرموز
- وحدة لكل action + تكامل fixtures AWJ + e2e (ضيف/موثَّق، AR/EN، جوال)
- اختبار `AccountAuthGate.architecture` يُحدَّث عمداً عند قلب القدرة
- تأكيد غياب أي استدعاء Spree في مسارات الحساب

**بوابات CI:** php artisan test (sqlite+pgsql) كامل، storefront CI، CI Gate، حارس X6.

**التحقق البيئي (منفصل عن الدمج والنشر):** تسجيل→تحقق→دخول→خروج على مستأجر تجريبي؛ فحص أن توكن مستأجر آخر مرفوض؛ مراجعة سجلات بلا PII.

**معايير الخروج (Exit):**
- كل الشرائح Env-Verified
- لا استدعاء Spree في الحساب (ratchet)
- قرار المالك بتفعيل الميزة لكل مستأجر
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** اعتماد خارجي (مزوّد الاتصالات)؛ تعارض مع ADR-24.  
**التراجع:** إغلاق القدرة (gated) فوراً؛ هجرات إضافية فقط.

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| B1 | ميدلوير سياق مشتري `store/v1` + غطاء البوابة | E | P1 | D-1 | D-1 | Blocked | M |
| B2 | `register/login/logout/me` + سياسة جلسة | E | P1 | B1 | D-1 D-6 | Blocked | L |
| B3 | تحقق البريد/الهاتف + نسيان/إعادة كلمة المرور | E | P1 | B2 N1 | D-1 D-2 | Blocked | L |
| B4 | تحديث الملف وكلمة المرور والبريد | E | P2 | B2 B3 | D-1 | Blocked | M |
| N1 | dispatcher ومزوّد الاتصالات (PR #1531 + مزوّد OTP حقيقي) | C | P1 | قرار خارجي | D-2 D-12 | Blocked | L |
| N5 | تسليم التحقق/الاستعادة للعملاء (= B3) | E | P1 | B3 N1 | D-2 | Blocked | — |
| S1 | عميل حساب AWJ + كوكي جلسة + تنظيف كوكيز `_spree_*` | E | P1 | B1 B2 | D-1 | Blocked | M |
| S2 | صفحات التحقق/نسيان/إعادة تعيين | E | P1 | B3 S1 | D-2 | Blocked | M |
| S3 | الملف الشخصي وتغيير كلمة المرور | E | P2 | B4 S1 | D-1 | Blocked | S |

### H2 — Orders, Cart & Checkout Completion

**الهدف:** اكتمال الطلب والسلة والـCheckout: رؤية الموظف للطلبات، دورة حياة وإلغاء، طلبات المشتري والعناوين، دمج السلة، العنوان الوطني، سياسة حجز COD، وإشعارات التأكيد.

**الشرائح:** O1, O2, O3, O4, B5, B6, B7, S4, S5, S6, S7, CK1, CK4, CK5, CK6, N2, N4

**شرط الدخول:** O1/O2/CK1 يمكن أن تبدأ قبل H1؛ B5–B7/S4–S7 بعد H1؛ O3 بعد D-9؛ CK4 بعد D-10؛ N2/N4 بعد D-12 وN1.

**الصفوف الوظيفية (من الـ84):** F11, F12, F13, F14, F17, F18, F19, F20, F23, F24, F25, F26, F27, F28, F29, F30, F32, F33, F34, F35, F36, F37, F38, F39, F40, F63, F67, F73 — Implemented 12 · Partially 3 · Spree-dependent 1 · Missing 12 · Unverified 0.

**معايير القبول:**
1. O1: `commerce.orders.view` في `Rbac` + جدول الأدوار (زرع طبق الأصل)؛ لا PII دون صلاحية؛ 404 موحّد عبر المستأجر/الفرع.
2. O2/B6: لا IDOR (طلب غيرك ⇒ 404)؛ مرجع موقَّع يُصدَر دائماً؛ شكل استجابة `checkout/complete` الحالية **مجمّد** (`FlowersEndToEndJourneyTest` + عقد الرحلة).
3. O3: انتقالات الحالة ذرّية؛ إلغاء الطلب يحرّر الحجز ويلغي النية ويرفض بعد ترحيل فاتورة إلا عبر مسار الإرجاع؛ لا طلب `confirmed` بنية ملغاة.
4. B5: ادّعاء/دمج سلة الضيف وفق ADR-07؛ `customer_identity_id` على الطلب؛ **لا قيد ولا فاتورة ولا حركة مخزون ناتجة عن الربط**.
5. CK1: مفاتيح SPL اختيارية وبتحقق السعودية نفسه (4/4/5)؛ إضافي.
6. CK4: الافتراضي `none` (لا تغيير لمستأجر قائم)؛ الحجز وعد لا `StockMovement`.
7. N2/N4: رسالة واحدة لكل طلب؛ replay لـ`complete` لا يعيد الإرسال؛ لا PII في السجلات.
8. CK6: إسقاط مُوثَّق (D-7)؛ CK5: لا حقل ضريبة قبل ADR.

**الاختبارات المطلوبة:**
- Laravel Feature + PG (تزامن إلغاء/التقاط، idempotency، ملكية)
- اختبار انحدار: `StorefrontCheckoutCompletionApiTest`, `…PostgresConcurrencyTest`
- RBAC لكل دور على O1
- وحدة + e2e للصفحات (S5–S7) وحالات الفراغ/الفشل
- اختبار تأكيد غياب الأثر المحاسبي في B5

**بوابات CI:** php artisan test كامل (sqlite+pgsql)، storefront CI، CI Gate، BranchIsolationGuardTest لأي نموذج جديد.

**التحقق البيئي (منفصل عن الدمج والنشر):** طلب ضيف→قراءة بمرجع→(مسجّل)→قائمة/تفاصيل؛ إلغاء موظف؛ تأكيد بريد/رسالة وصلت مرة واحدة على مستأجر تجريبي.

**معايير الخروج (Exit):**
- كل الشرائح Env-Verified
- لا صف F11–F40 معلّق دون قرار
- توقيع المالك
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** لمس مسار Checkout الحساس؛ تعارض ملفات مع #1745؛ أثر على اختبار رحلة الورد.  
**التراجع:** مسارات إضافية تُعطَّل بالبوابة؛ هجرات إضافية؛ revert.

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| B5 | سلة وCheckout `store/v1` واعيان بالهوية + دمج سلة الضيف | C | P1 | B1 | D-1 | Blocked | L |
| B6 | `me/orders` + بحث ضيف بمرجع موقَّع | C | P1 | B1 | D-1 | Blocked | M |
| B7 | `me/addresses` CRUD + مرجع عنوان في checkout | C | P1 | B1 | D-1 | Blocked | M |
| O1 | واجهة موظف لقراءة طلبات الويب (`commerce.orders.view`) | C | P1 | — | — | Planned | M |
| O2 | `GET store/v1/orders/{id}` للضيف + توحيد المسلسِل | C | P1 | — | — | Planned | M |
| O3 | دورة حياة الطلب + الإلغاء + اتساق النية/الحجز | C | P1 | O1 | D-9 | Blocked | L |
| O4 | خط زمني/أحداث الطلب | C | P2 | O3 | D-9 | Blocked | M |
| CK1 | مفاتيح العنوان الوطني السعودي في `PATCH checkout/address` | C | P1 | CTP1 | — | Planned | S |
| CK4 | سياسة حجز COD/الاستلام (قابلة للضبط) | C | P1 | O3 | D-10 | Blocked | M |
| CK5 | عرض الضريبة في السلة/Checkout | C | P2 | ADR ضريبي | — | Blocked | M |
| CK6 | شحنات متعددة (مُسقَطة) | C | — | D-7 | D-7 | Blocked | — |
| S4 | دمج سلة الضيف عند الدخول + سياسة الخروج | C | P1 | B5 S1 | D-1 | Blocked | S–M |
| S5 | قلب `ACCOUNT_ORDER_*` إلى live (قائمة/تفاصيل) | C | P1 | B6 S1 | D-1 | Blocked | M |
| S6 | العناوين live + اختيار عنوان محفوظ في Checkout | C | P1 | B7 S1 CTP1 | D-1 | Blocked | M |
| S7 | صفحات تفاصيل/سجل طلبات الضيف والمسجّل + order-placed AWJ | C | P1 | O2 B6 | D-1 | Blocked | M |
| N2 | تأكيد الطلب للمشتري عبر outbox | C | P1 | N1 O1 | D-12 | Blocked | M |
| N4 | تنبيه التاجر بطلب ويب جديد | C | P1 | O1 | D-12 | Blocked | S–M |

### H3 — Payments, COD, Accounting & ZATCA

**الهدف:** الأثر المالي والضريبي الصحيح للمدفوعات: COD/الاستلام، تفعيل الدفع الإلكتروني والفوترة تحت بوابات صريحة، فاتورة المشتري. **لا شريحة هنا تفتح G3 أو EXT-05 لمستأجر حيّ.**

**الشرائح:** INV1, INV3, GATE-G3, GATE-EXT05 (+ تحقق F41–F45, F57, F58, F62)

**شرط الدخول:** D-8 محسومة؛ O1 وO3 مُنجزتان؛ مراجعة محاسبية/ضريبية.

**الصفوف الوظيفية (من الـ84):** F41, F42, F43, F44, F45, F57, F58, F59, F61, F62 — Implemented 5 · Partially 3 · Spree-dependent 0 · Missing 2 · Unverified 0.

**معايير القبول:**
1. INV1: عبر `InvoiceService`/`PaymentService`/`LedgerService::post` فقط؛ قيد متوازن (Σمدين=Σدائن)، `source_type/source_id`، هللات bigint، إجماليات مشتقة، قفل الفترة/السنة، **لا ترحيل رجعي** لما قبل التفعيل، مغلقة افتراضياً (بوابة نشر + سياسة مستأجر + رأي ضريبي).
2. idempotency: مِرساة `CommerceOrderPosting`-نمط؛ إعادة المعالجة لا تكرّر مستنداً.
3. ZATCA: توقيت الإصدار وفق ADR مكتوب؛ لا تغيير في ICV/PIH التاريخية؛ لا مساس بسلسلة الإشعارات 381.
4. جدول القيود الناتجة في رسالة PR، و`php artisan test` كامل أخضر قبل الطلب.
5. GATE-G3/EXT-05: قرارات المالك فقط؛ تُسجَّل في المتتبّع، ولا تُنفَّذ ضمن الخطة.
6. INV3: لا «فاتورة» لطلب بلا فاتورة فعلية.

**الاختبارات المطلوبة:**
- نظير `CommerceInvoiceOnPaymentTest` لـCOD (13+ حالة)
- `CommerceInvoicePostingPostgresConcurrencyTest`-نمط
- فترة مقفلة ⇒ `blocked_period`
- TREASURY T3–T6 لا تتأثر
- ZATCA conformance workflow يبقى أخضر

**بوابات CI:** php artisan test كامل (sqlite+pgsql)، zatca-sdk-conformance، CI Gate.

**التحقق البيئي (منفصل عن الدمج والنشر):** تحصيل COD على مستأجر تجريبي مفعَّل صراحةً ⇒ فاتورة+سند متوازنان؛ مستأجر غير مفعَّل ⇒ لا أثر.

**معايير الخروج (Exit):**
- Env-Verified + مراجعة محاسبية موقَّعة
- وضع G3/EXT-05 موثّق (مفتوح/مغلق) بقرار المالك
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** أعلى خطر مالي في الخطة؛ D-B5 (أثر تأخر الاستردادات) غير معتمد.  
**التراجع:** إغلاق البوابة؛ لا تعديل قيد تاريخي (عكس عبر `LedgerService::reverse` فقط).

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| INV1 | وثيقة مالية لطلب COD/الاستلام (مغلقة افتراضياً) | C | P1 | D-8 O1 O3 | D-8 | Blocked | L |
| INV3 | تنزيل الفاتورة للمشتري | C | P2 | INV1 | D-8 | Blocked | S |
| GATE-G3 | بوابة G3: اعتماد فتح الدفع الإلكتروني لمستأجر حيّ | X | P1 | RT3 (مقترح) | — | Blocked | — |
| GATE-EXT05 | بوابة EXT-05: الرأي الضريبي لفوترة الدفع الإلكتروني | X | P1 | — | — | Blocked | — |

### H4 — Fulfillment, Delivery, Returns & Refunds

**الهدف:** التنفيذ والتوصيل والمرتجعات والاسترداد: شحنة/تتبع، خيارات توصيل، فوترة عند التنفيذ، RMA، استرداد مدفوعات المتجر، جسر الإشعار الدائن.

**الشرائح:** F1, F2, CK2, CK3, INV2, RT1, RT2, RT3, RT4, N3

**شرط الدخول:** D-9 وD-11 وD-8 محسومة؛ O3 وINV1 مُنجزتان؛ تصميم PAY-V2-6A (#778) معتمد.

**الصفوف الوظيفية (من الـ84):** F21, F22, F48, F49, F50, F51, F52, F53, F54, F55, F56, F60, F64, F66, F82, F83 — Implemented 1 · Partially 3 · Spree-dependent 1 · Missing 9 · Unverified 2.

**معايير القبول:**
1. F1: حالات `ready/shipped/delivered` وتتبّع؛ كتلة `fulfillment` **إضافية** في المسلسِل؛ إجراءات موظف بصلاحية `commerce.orders.manage`؛ لا خلط SalesChannel بالفرع/المخزن (عقد #5).
2. CK2: رسوم محسوبة خادمياً من `ShippingRateService`؛ لا مبلغ من العميل.
3. RT3: استرداد بقيود متوازنة؛ لا استرداد آلي للالتقاط المتأخر (D-15 المحافظ)؛ `not_refundable` يُرفع فقط للمسار المعتمد.
4. RT4: عبر `CreditNoteService`/`ReturnService`؛ يحترم `CashSaleRefundGuard` وTREASURY T5–T6؛ ZATCA 381 وفق الضوابط القائمة.
5. Return≠Refund≠CreditNote≠Exchange: أربع كيانات/أحداث منفصلة.
6. N3: إشعار لكل انتقال مرة واحدة.

**الاختبارات المطلوبة:**
- Feature + PG (تزامن، idempotency)
- PaymentRefund*-نمط + محاسبة الإرجاع
- ZATCA 381 conformance
- RBAC/عزل مستأجر/IDOR
- انحدار CK2 على `delivery.amount`

**بوابات CI:** php artisan test كامل، zatca-sdk-conformance، storefront CI، CI Gate.

**التحقق البيئي (منفصل عن الدمج والنشر):** طلب→شحن→تسليم→إرجاع→استرداد على مستأجر تجريبي؛ مطابقة القيود.

**معايير الخروج (Exit):**
- Env-Verified + مراجعة محاسبية
- لا صف F48–F56, F82–F83 معلّق دون قرار
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** اعتماد على D-11 المفتوح؛ تعقيد محاسبي/ZATCA.  
**التراجع:** بوابات إغلاق؛ هجرات إضافية.

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| F1 | شحنة/تتبّع/ناقل + إجراءات موظف + كتلة fulfillment إضافية | C | P1 | O1 O3 | D-9 | Blocked | L |
| F2 | `PickupLocation` واختيار الفرع | C | P2 | F1 | — | Planned | M |
| CK2 | `GET store/v1/checkout/delivery-options` | C | P1 | CTP1 | — | Planned | S–M |
| CK3 | شحن مجاني فوق حدّ (سياسة) | C | P2 | CK2 | — | Planned | S |
| INV2 | مُشغِّل الفوترة عند التنفيذ/الشحن | C | P2 | INV1 F1 | D-8 | Blocked | M |
| RT1 | ADR تقييم المرتجعات | C | P1 | — | D-11 | Planned | S |
| RT2 | طلب إرجاع (RMA) لطلب ويب | C | P2 | RT1 O3 F1 | D-9 D-11 | Blocked | L |
| RT3 | فتح الاسترداد لمدفوعات المتجر (`not_refundable`) | C | P1 | RT1 PAY-V2-6A | D-11 | Blocked | L |
| RT4 | جسر إشعار دائن/إعادة مخزون لطلب ويب | C | P2 | RT2 INV1 | D-11 | Blocked | L |
| N3 | إشعارات فشل الدفع/الشحن/الإلغاء | C | P2 | N2 F1 O3 | D-12 | Blocked | M |

### H5 — Store Experience, Promotions, Policies & Analytics

**الهدف:** تجربة المتجر: السياسات، التحليلات، العروض/الكوبونات، المفضلة/التقييمات، وإتاحة الكتالوج.

**الشرائح:** X4, B8, AN1, P1c, P2c, P3c, P4c

**شرط الدخول:** AN1 يمكن سحبها مبكراً بعد H0 (تحجب R1)؛ X4/B8 بعد D-4؛ P1c بعد D-13؛ P3c بعد H1.

**الصفوف الوظيفية (من الـ84):** F05, F06, F07, F08, F16, F47, F74, F75, F76, F77, F80, F81, F84 — Implemented 0 · Partially 4 · Spree-dependent 1 · Missing 5 · Unverified 3.

**معايير القبول:**
1. AN1: `view_cart`, `remove_from_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase` بقيم الخادم؛ `purchase` مرة واحدة لكل رقم طلب؛ لا حساب إجماليات في المتصفح؛ احترام الموافقة/GTM.
2. X4/B8: 404 عند عدم النشر؛ HTML منقّى؛ إخفاء الروابط عند الغياب؛ بلا `use cache: remote` غير مُفتَّح بالمضيف.
3. P1c: خصم خادمي كسطر؛ الإجماليات مشتقة؛ أثر محاسبي موثّق ومراجَع؛ لا كوبون بلا ADR.
4. P2c: افتراضياً مُسقَطة؛ إن اعتُمدت فالتزام مؤجّل محاسبياً وتوكنة بمزوّد دون مرور بطاقات عبر AWJ.
5. P3c: `WISHLIST` يصبح live فقط بعقد وهوية.
6. P4c: يحسم F05/F06/F76/F80/F81/F84 بالتحقق أو التنفيذ.

**الاختبارات المطلوبة:**
- وحدة لأحداث GA4 (تكرار/إعادة تحميل)
- Laravel Feature لـB8 وP1c
- XSS payload في السياسات
- عزل مضيف لا تسرّب بين مستأجرين
- e2e fixtures

**بوابات CI:** storefront CI، php artisan test عند لمس الخلفية، CI Gate.

**التحقق البيئي (منفصل عن الدمج والنشر):** GA4 DebugView على مستأجر تجريبي؛ سياسات ar/en؛ كوبون على مستأجر مفعَّل.

**معايير الخروج (Exit):**
- Env-Verified
- AN1 مكتملة قبل بدء R1
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** أثر محاسبي للخصومات؛ إعداد GTM لدى المستأجر.  
**التراجع:** revert؛ بوابات القدرة.

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| X4 | صفحات السياسات من AWJ (404 بدل 500) | E | P1 | B8 | D-4 | Blocked | M |
| B8 | `GET store/v1/policies/{slug}` قراءة فقط | C | P1 | — | D-4 | Blocked | S |
| AN1 | أحداث GA4 لـCheckout/سلة AWJ بقيم من الخادم (يحجب R1) | C | P0 | X1 | — | Planned | S–M |
| P1c | محرك كوبونات (رفع تأجيل ADR-11) | C | P2 | D-13 مراجعة مالية | D-13 | Blocked | L |
| P2c | بطاقات هدايا/رصيد متجر/بطاقات محفوظة (افتراضياً مُسقَطة) | C | P2 | D-5 | D-5 | Blocked | L |
| P3c | المفضلة/التقييمات | C | P2 | B2 S1 | — | Blocked | M |
| P4c | اكتشاف الكتالوج والتوفر: بحث/ترتيب/مخزون/ذات صلة/UoM + السوق (جديد) | C | P2 | PRD #1523 | — | Planned | M |

### H6 — Final Spree Dependency Removal

**الهدف:** الإزالة النهائية لكل اعتماد تشغيلي ونوعي على Spree مع الإبقاء على الواجهة وترخيص MIT.

**الشرائح:** W1, T1, R1, R2, T2, R3, R4, E1, G

**شرط الدخول:** D-3 وD-14 محسومة؛ AN1 مُنجزة؛ لا مسار حيّ يعتمد على Spree.

**الصفوف الوظيفية (من الـ84):** F01, F02, F03, F04, F10, F15, F31, F46, F78 — Implemented 5 · Partially 0 · Spree-dependent 4 · Missing 0 · Unverified 0.

**معايير القبول:**
1. W1/R1: توافق الروابط (308 إلى `/checkout`, `/checkout/payment-return`, `/`)؛ الجملة 404.
2. R2: لا ويبهوك؛ قرار D-14 موثّق (إحلال N2 أو قبول صريح).
3. R3: قراءة مزدوجة لكوكي اللغة/البلد لإصدار ثم حذف؛ `_spree_*` تُنظَّف.
4. T1/T2: صفر فرق عرض؛ `tsc` + vitest كاملان قبل/بعد.
5. R4: حذف `@spree/sdk` و`@spree/cli` وسكربتات e2e القديمة وworkflow المتداخل؛ README مُعاد؛ `LICENSE`/`NOTICE` باقيان.
6. E1: e2e ضيف+موثَّق على fixtures AWJ؛ job جذري بالمسار؛ الافتراضي لا يتطلب `.env.e2e`.
7. G: صفر استدعاءات/استيرادات Spree؛ لا `SPREE_*` مطلوب؛ كل صف F01–F84 محسوم.

**الاختبارات المطلوبة:**
- ratchet = 0 ثم حارس «لا Spree» دائم
- بناء `pnpm build` بلا `SPREE_*`
- كامل vitest/tsc/biome/locales
- e2e fixtures
- اختبار روابط قديمة (308/404)

**بوابات CI:** storefront CI، docker-context، CI Gate، visual QA، job e2e الجديد.

**التحقق البيئي (منفصل عن الدمج والنشر):** نشر تجريبي بلا `SPREE_*`؛ مراقبة 404 للمسارات القديمة؛ تحقق نشر معتمد صراحةً من Safwan.

**معايير الخروج (Exit):**
- بوابة G كاملة + Env-Verified + اعتماد المالك للنشر (قرار منفصل)
- لا يُغلق الأفق بمجرد كتابة/دمج الكود.

**المخاطر:** حجم الحذف؛ نسيان مستهلك مخفي.  
**التراجع:** revert لكل PR (R1 مُقسَّم R1a/b/c).

| Slice | العنوان | مسار | أولوية | يعتمد على | قرارات | الحالة | حجم |
|---|---|---|---|---|---|---|---|
| W1 | إزالة بوابة الجملة | E | P1 | D-3 X5 | D-3 | Blocked | M |
| T1 | أنواع عرض AWJ + codemod لعنقود الكتالوج | E | P1 | X1 | — | Planned | M–L |
| R1 | إزالة Checkout/Cart/Payment/Orders Spree + حزم الدفع | E | P1 | W1 AN1 | D-3 D-5 | Blocked | L |
| R2 | إزالة الويبهوك والبريد اليتيم | E | P1 | R1 N2 | D-14 | Blocked | S |
| T2 | بقية الأنواع | E | P1 | R1 T1 | — | Blocked | S–M |
| R3 | إزالة `lib/spree/` وإعادة تسمية الكوكيز/البروكسي | E | P1 | R2 T2 | — | Blocked | M |
| R4 | حذف SDK/CLI/التهيئة/الوثائق/سكربتات e2e القديمة | E | P1 | T1 T2 R1 R2 R3 | — | Blocked | S–M |
| E1 | ترحيل الاختبارات وe2e إلى fixtures AWJ + مسار CI | E | P1 | S1… | — | Planned | M |
| G | بوابة الخروج النهائية (Exit Gate) | E | P0 | كل ما سبق | — | Blocked | — |

## 8. التبعيات عبر الآفاق (حرجة)

```
H0 ──► (AN1 مبكراً) ───────────────────────────────┐
H0 ─► H1 (D-1,D-2,D-6; N1) ─► H2 (B5–B7,S4–S7)      │
         │                       └─► O3 (D-9) ─► H4 F1/RT  │
         └─► N5/B3 ─► F65                                     ▼
H2 (O1,O3) ─► H3 INV1 (D-8) ─► H4 INV2/RT4                H6: W1 → R1 (يتطلب AN1) → R2 (يتطلب D-14) → T2 → R3 → R4 → E1 → G
H4 RT1 ─► RT3 (يتطلب PAY-V2-6A) ─► [اقتراح] شرط قبل فتح G3
CTP1 (#1745) ─► CK1, CK2, S6, AN1, X5
```

1. **R1 ⟸ AN1 + W1**؛ **R2 ⟸ D-14 (وN2 إن اختير الإحلال)**؛ **R4 ⟸ T1+T2+R1+R2+R3**؛ **G ⟸ كل صف F01–F84 محسوم**.
2. **INV1 ⟸ D-8 + O1 + O3**؛ **INV2 ⟸ INV1 + F1**؛ **RT3 ⟸ RT1 + PAY-V2-6A**؛ **F1 ⟸ D-9 + O3**.
3. **كل B/S ⟸ D-1**؛ **B3/N5/S2 ⟸ D-2 + N1**.
4. **GATE-G3 / GATE-EXT05:** قرارات مالك مستقلة؛ لا تُفتح ضمن الخطة؛ يُوصى بـRT3 شرطاً قبل G3 لمستأجر حيّ.

## 9. التمييز بين Exit وCompletion — جدول الإسناد


| Slice | المسار | الأفق |
|---|---|---|
| X0 | Spree Exit | H0 |
| X1 | Spree Exit | H0 |
| X2 | Spree Exit | H0 |
| X3 | Spree Exit | H0 |
| X5 | Spree Exit | H0 |
| X6 | Spree Exit | H0 |
| CTP1 | External/Gate | H0 |
| ENV0 | External/Gate | H0 |
| B1 | Spree Exit | H1 |
| B2 | Spree Exit | H1 |
| B3 | Spree Exit | H1 |
| B4 | Spree Exit | H1 |
| N1 | Commerce Completion | H1 |
| N5 | Spree Exit | H1 |
| S1 | Spree Exit | H1 |
| S2 | Spree Exit | H1 |
| S3 | Spree Exit | H1 |
| B5 | Commerce Completion | H2 |
| B6 | Commerce Completion | H2 |
| B7 | Commerce Completion | H2 |
| O1 | Commerce Completion | H2 |
| O2 | Commerce Completion | H2 |
| O3 | Commerce Completion | H2 |
| O4 | Commerce Completion | H2 |
| CK1 | Commerce Completion | H2 |
| CK4 | Commerce Completion | H2 |
| CK5 | Commerce Completion | H2 |
| CK6 | Commerce Completion | H2 |
| S4 | Commerce Completion | H2 |
| S5 | Commerce Completion | H2 |
| S6 | Commerce Completion | H2 |
| S7 | Commerce Completion | H2 |
| N2 | Commerce Completion | H2 |
| N4 | Commerce Completion | H2 |
| INV1 | Commerce Completion | H3 |
| INV3 | Commerce Completion | H3 |
| GATE-G3 | External/Gate | H3 |
| GATE-EXT05 | External/Gate | H3 |
| F1 | Commerce Completion | H4 |
| F2 | Commerce Completion | H4 |
| CK2 | Commerce Completion | H4 |
| CK3 | Commerce Completion | H4 |
| INV2 | Commerce Completion | H4 |
| RT1 | Commerce Completion | H4 |
| RT2 | Commerce Completion | H4 |
| RT3 | Commerce Completion | H4 |
| RT4 | Commerce Completion | H4 |
| N3 | Commerce Completion | H4 |
| X4 | Spree Exit | H5 |
| B8 | Commerce Completion | H5 |
| AN1 | Commerce Completion | H5 |
| P1c | Commerce Completion | H5 |
| P2c | Commerce Completion | H5 |
| P3c | Commerce Completion | H5 |
| P4c | Commerce Completion | H5 |
| W1 | Spree Exit | H6 |
| T1 | Spree Exit | H6 |
| R1 | Spree Exit | H6 |
| R2 | Spree Exit | H6 |
| T2 | Spree Exit | H6 |
| R3 | Spree Exit | H6 |
| R4 | Spree Exit | H6 |
| E1 | Spree Exit | H6 |
| G | Spree Exit | H6 |


> الشرائح الأصلية المحفوظة بمعرّفاتها: **X** (X0–X5) · **B** (B1–B8) · **S** (S1–S7) · **O** (O1–O4) · **CK** (CK1–CK6) · **INV** (INV1–INV3) · **F** (F1–F2) · **RT** (RT1–RT4) · **N** (N1–N5) · **AN** (AN1) · **P** (P1c–P3c) · **W** (W1) · **R** (R1–R4) · **T** (T1–T2) · **E1** · **G**. **إضافات جديدة** (لم تكن في الخطة الأصلية، موسومة): **X6** (حارس ratchet)، **P4c** (اكتشاف الكتالوج/التوفر)، **CTP1** (رصد PR Codex)، **ENV0** (خط أساس بيئي)، **GATE-G3**، **GATE-EXT05**.

## 10. حالة القدرات (من 84 وظيفة)


| الحالة عند التدقيق | العدد |
|---|---|
| Implemented | 24 |
| Partially Implemented | 15 |
| Spree-dependent (منها F70 وF72 مُغلقتان gated بـX1) | 11 |
| Missing | 29 |
| Unverified | 5 |
| **Blocked** (غير Implemented وتتوقف شريحتها على قرار D مفتوح) | 43 |

* **المكتمل فعلاً** يعني Implemented في الكود، لا Closed بالمعنى الكامل في §2؛ يُحتفظ به بحراسة انحدار.
* **Blocked** يُحسب من تبعية القرارات (§5)، وهو متعامد مع حالة الصف.

## 11. الملحق أ — خريطة الصفوف الـ84 إلى الآفاق والشرائح

| ID | الوظيفة | الحالة | الأفق | الشرائح | محجوب بقرار | ملاحظة |
|---|---|---|---|---|---|---|
| F01 | قائمة المنتجات/بحث/ترتيب/فلاتر | Implemented | H6 | T1 | — | Implemented؛ أنواع Spree فقط |
| F02 | تفاصيل المنتج: متغيرات/خيارات/وسائط/إضافات/تخصيص/وحدات | Implemented | H6 | T1 | — | — |
| F03 | التصنيفات/المجموعات/الأوجه + صور الأبعاد | Implemented | H6 | T1 | — | — |
| F04 | العروض (خصم حيّ من `CommercePriceResolver`) | Implemented | H6 | T1 | — | ميزة AWJ؛ حراسة انحدار |
| F05 | التوفر/المخزون | Partially Implemented | H5 | P4c | — | إتاحة منطقية فقط؛ ربط PRD #1523 |
| F06 | بحث متقدم (Meilisearch/ملاءمة) | Partially Implemented | H5 | P4c | — | ترتيب/بحث محدودان |
| F07 | التقييمات والمراجعات | Missing | H5 | P3c | — | غير موجودة في Spree الأصلي أيضاً |
| F08 | المفضلة (Wishlist) | Missing | H5 | P3c | — | تعتمد H1 |
| F09 | Sitemap/robots | Spree-dependent | H0 | X3 | — | فشل صامت (sitemap فارغ) |
| F10 | JSON-LD/OG/SEO | Implemented | H6 | T1 | — | — |
| F11 | إضافة/تعديل/حذف بند (ضيف) | Implemented | H2 | — | — | Implemented؛ حراسة انحدار (لا تغيير) |
| F12 | إجماليات السلة (خصم/شحن/ضريبة/إجمالي) | Partially Implemented | H2 | CK5 · P1c | D-13 | subtotal فقط |
| F13 | هوية السلة (كوكي) | Implemented | H2 | — | — | Implemented |
| F14 | سلة مرتبطة بحساب + دمج سلة الضيف | Missing | H2 | B5 · S4 | D-1 | — |
| F15 | سلة Spree (جملة) | Spree-dependent | H6 | W1 | D-3 | — |
| F16 | كود خصم/كوبون | Missing | H5 | P1c | D-13 | D-13 |
| F17 | بدء/استئناف checkout | Implemented | H2 | — | — | Implemented |
| F18 | بيانات الاتصال | Implemented | H2 | — | — | Implemented |
| F19 | عنوان التسليم | Partially Implemented | H2 | CK1 | — | SPL |
| F20 | دفتر عناوين محفوظ في Checkout | Missing | H2 | B7 · S6 | D-1 | — |
| F21 | طريقة التوصيل | Partially Implemented | H4 | CK2 | — | — |
| F22 | تسعير الشحن | Partially Implemented | H4 | CK2 · CK3 | — | — |
| F23 | جدولة التسليم (تاريخ+نافذة+وعد التسليم) | Implemented | H2 | — | — | Implemented |
| F24 | الإهداء (مستلم/مرسل/رسالة) | Implemented | H2 | — | — | Implemented |
| F25 | طرق الدفع المتاحة للقناة | Implemented | H2 | — | — | Implemented |
| F26 | اختيار الدفع | Implemented | H2 | — | — | Implemented |
| F27 | إتمام الطلب (idempotent) + `review_required` | Implemented | H2 | — | — | Implemented؛ مجمّد |
| F28 | Checkout لمشترٍ موثَّق | Missing | H2 | B5 | D-1 | ضيف فقط |
| F29 | شحنات متعددة (multi-shipment) | Missing | H2 | CK6 | D-7 | إسقاط D-7 |
| F30 | عرض الضريبة في السلة/Checkout | Missing | H2 | CK5 | — | ADR ضريبي |
| F31 | Checkout سريع (Apple/Google Pay مدمج) | Spree-dependent | H6 | R1 | D-3, D-5 | يُستبدل بوسائل مستضافة |
| F32 | إنشاء الطلب + لقطات السعر/الاسم/الوحدة + رقم `CORD` | Implemented | H2 | — | — | Implemented |
| F33 | إعادة التحقق من السعر/المخزون عند الإتمام | Implemented | H2 | CK4 | D-10 | فرط بيع COD ممكن |
| F34 | صفحة تأكيد الطلب (داخل الجلسة) | Implemented | H2 | — | — | Implemented |
| F35 | عرض تفاصيل طلب لاحقاً (مشترٍ/ضيف) | Missing | H2 | O2 · B6 · S7 | D-1 | — |
| F36 | سجل الطلبات | Missing | H2 | B6 · S5 · S7 | D-1 | — |
| F37 | نموذج حالات الطلب | Partially Implemented | H2 | O3 | D-9 | D-9 |
| F38 | إلغاء الطلب (مشترٍ أو موظف) | Missing | H2 | O3 | D-9 | D-9 |
| F39 | إدارة الطلبات للموظف (قائمة/تفاصيل/تأكيد/تنفيذ) | Missing | H2 | O1 | — | RBAC جديد |
| F40 | خط زمني/أحداث الطلب | Missing | H2 | O4 | D-9 | — |
| F41 | نية دفع COD/الاستلام | Implemented | H3 | — | — | Implemented |
| F42 | تحصيل COD (موظف) | Partially Implemented | H3 | INV1 | D-8 | بلا أثر محاسبي |
| F43 | دفع إلكتروني مستضاف: بدء + حالة + عودة | Partially Implemented | H3 | GATE-G3 | — | مغلق بالبوابة |
| F44 | إكمال الالتقاط/ويبهوك/شبكة أمان/التقاط متأخر | Implemented | H3 | — | — | Implemented |
| F45 | حجز مخزون الطلب الإلكتروني + مكنسة | Implemented | H3 | — | — | Implemented؛ مغلق بالبوابة نفسها |
| F46 | بطاقات/محافظ بـSDK مدمج (Stripe/Adyen/PayPal، 3DS، Klarna/Affirm/SEPA) | Spree-dependent | H6 | R1 | D-3, D-5 | — |
| F47 | بطاقات محفوظة للمشتري | Missing | H5 | P2c | D-5 | D-5 |
| F48 | استرداد مبلغ طلب ويب | Missing | H4 | RT3 | D-11 | — |
| F49 | نزاعات/chargeback | Partially Implemented | H4 | RT3 | D-11 | ربط النزاعات بالطلب |
| F50 | مخزن مصدر التنفيذ للقناة | Implemented | H4 | — | — | Implemented |
| F51 | شحنة/رقم تتبع/ناقل/«تم الشحن»/«تم التسليم» | Missing | H4 | F1 | D-9 | — |
| F52 | اختيار فرع استلام (PickupLocation) | Missing | H4 | F2 | — | — |
| F53 | طلب إرجاع من المشتري (RMA) | Missing | H4 | RT2 | D-9, D-11 | — |
| F54 | استرداد مالي لطلب ويب | Missing | H4 | RT3 | D-11 | — |
| F55 | إشعار دائن/إرجاع محاسبي مرتبط بطلب ويب | Missing | H4 | RT4 | D-11 | — |
| F56 | استبدال (exchange) | Missing | H4 | RT2 · RT4 | D-9, D-11 | استبدال لاحق |
| F57 | `CommerceOrder ≠ Invoice` (لا أثر محاسبي عند الإنشاء) | Implemented | H3 | — | — | Implemented؛ ثابت معماري |
| F58 | فاتورة مبسّطة + سند بوابة عند التقاط إلكتروني مؤكَّد | Partially Implemented | H3 | GATE-EXT05 · GATE-G3 | — | مغلقة |
| F59 | فاتورة/قيد لطلب COD/استلام | Missing | H3 | INV1 | D-8 | D-8 |
| F60 | فاتورة عند التنفيذ/الشحن | Missing | H4 | INV2 | D-8 | — |
| F61 | تنزيل الفاتورة الضريبية للمشتري | Missing | H3 | INV3 | D-8 | — |
| F62 | ربط المشتري الإلكتروني بطرف (`partner_id`) | Implemented | H3 | — | — | Implemented؛ `manual_link` بلا endpoint تعيين |
| F63 | بريد تأكيد الطلب للمشتري | Spree-dependent | H2 | N2 · D-14 | D-12, D-14 | — |
| F64 | بريد الشحن/الإلغاء (`order.shipped`/`order.canceled`) | Spree-dependent | H4 | N3 | D-12 | — |
| F65 | بريد إعادة تعيين كلمة المرور | Spree-dependent | H1 | N5 · B3 | D-1, D-2 | — |
| F66 | إشعار فشل الدفع للمشتري | Missing | H4 | N3 | D-12 | — |
| F67 | تنبيه التاجر بطلب ويب جديد | Missing | H2 | N4 | D-12 | — |
| F68 | OTP/تحقق | Partially Implemented | H1 | N1 | D-2, D-12 | OTP مُحاكى |
| F69 | منصة الاتصالات (outbox) | Partially Implemented | H1 | N1 | D-2, D-12 | PR #1531 |
| F70 | تسجيل/دخول/خروج/جلسة/تجديد | Spree-dependent → Gated (X1 merged) | H1 | B1 · B2 · S1 | D-1, D-6 | مُغلق gated بـX1 (#1744) |
| F71 | تحقق البريد/الهاتف، نسيان/إعادة كلمة المرور | Missing | H1 | B3 · N5 · S2 | D-1, D-2 | — |
| F72 | الملف الشخصي/تغيير كلمة المرور | Spree-dependent → Gated (X1 merged) | H1 | B4 · S3 | D-1 | مُغلق gated بـX1 |
| F73 | دفتر العناوين | Missing | H2 | B7 · S6 | D-1 | — |
| F74 | بطاقات هدايا/رصيد متجر | Missing | H5 | P2c | D-5 | D-5 |
| F75 | صفحات السياسات | Spree-dependent | H5 | X4 · B8 | D-4 | D-4 |
| F76 | الأسواق/العملات/الدول | Partially Implemented | H5 | P4c · R1 | D-3, D-5 | سوق ثابت مؤكَّد |
| F77 | تحليلات GA4/GTM | Partially Implemented | H5 | AN1 | — | يحجب R1 |
| F78 | بوابة الجملة | Spree-dependent | H6 | W1 | D-3 | D-3 |
| F79 | وسائط/بروكسي/المظهر/اللغات الست/RTL | Implemented | H0 | — | — | Implemented؛ CTP1 يضيف تكافؤ الثيم لـCheckout |
| F80 | تسعير الشرائح/الكمية (tiered) | Unverified | H5 | P4c | — | تحقق |
| F81 | منتجات ذات صلة/موصى بها | Unverified | H5 | P4c | — | تحقق |
| F82 | ربط `DeliveryHubOrder` (وحدة ERP) بـ`CommerceOrder` كتتبع توصيل | Unverified | H4 | F1 | D-9 | تحقق |
| F83 | اختبار يثبّت `not_refundable` لطلبات المتجر | Unverified | H4 | RT3 | D-11 | تحقق |
| F84 | وحدات القياس (UoM) مكشوفة في `GET products/{id}` | Unverified | H5 | P4c | — | تحقق |


## 12. إدارة التغيير والمراجعة

* **المتتبّع** (`AWJ_STORE_COMMERCE_HORIZON_TRACKER.md`) هو المرجع الحيّ للحالة/PR/المالك/الخطوة التالية؛ هذا المستند هو العقد (لا يتغير إلا بقرار).
* تُحدَّث الحالة بالدليل (رابط PR، SHA، تشغيل CI، سجل تحقق بيئي) لا بالادعاء.
* كل أفق يبدأ بمراجعة قرارات معلّقة وينتهي بتقرير إغلاق.

## 13. أول شريحة موصى بها

**ENV0 + X6** (متوازيتان وصغيرتان، لا تعتمدان على قرارات): ENV0 يثبّت الواقع البيئي (المضيف، المراجعة المنشورة، أسماء المتغيرات) فتصبح كل ادعاءات «Env-Verified» ممكنة، وX6 يحرس عدم ارتداد الاعتماد على Spree. بعدهما **X3** (sitemap)، ثم **O1/O2** (رؤية الطلبات، لا تعتمد الهوية) بالتوازي مع حسم D-1/D-2. تحجب **CK1/CK2/S6/AN1/X5** حتى يُدمج #1745.
