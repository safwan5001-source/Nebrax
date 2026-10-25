# SPREE-X1 + SPREE-X2 — تقرير التنفيذ

**التاريخ:** 2026-10-25 · **الفرع:** `claude/spree-x1-x2-buyer-account-gate` · **مرجع الخطة:** `docs/plans/store/AWJ_SPREE_EXIT_MIGRATION_PLAN.md` (PR #1743)
**Base SHA:** `1adb53f2e73be5a5b014f6693d4e5a01dd42ea68` (`origin/main` وقت البدء) · **Code commit:** `230565f8b7e545c0a1e16922f0f2713eea2898de` (Head النهائي = commit هذا التقرير فوقه؛ انظر PR)

## السبب الجذري
مسار حساب المشتري كله (تسجيل/دخول/خروج/جلسة/نسيان وإعادة كلمة المرور/ملف) كان يمرّ بعميل Spree عبر `getClient()` (`lib/data/customer.ts`)، ولا backend لـSpree في أي بيئة AWJ، فيرمي `getClient()` الخطأ «Spree client is not configured…» عند أول إرسال، وكان `catch` يمرّر `error.message` الخام إلى الواجهة. تعليمات التشغيل كانت تنصح بقيم بديلة لـ`SPREE_*` (تخفي العيب وترسل بيانات المشتري إلى مضيف غير مملوك)، و`.env.example` كان يضع `SPREE_WEBHOOK_SECRET=disabled` (قيمة غير فارغة تفتح نقطة الويبهوك بسرّ معروف).

## ما نُفِّذ
**X1**
- `ACCOUNT_AUTH_CAPABILITY = "gated"` في `lib/commerce/capabilities.ts` (بوابة مركزية).
- `lib/data/customer.ts`: كل action يفحص البوابة **قبل** أي وصول لـSpree ويعيد `{ success:false, code:"capability_unavailable" }`؛ `getCustomer/syncSession` تعيدان anonymous؛ `logout` يمسح الكوكيز المحلية دون بناء العميل؛ `requestPasswordReset` يعيد نتيجة typed؛ رسائل الأخطاء لا تمرّ إلا إذا كانت 4xx من الخلفية (`buyerSafeMessage`)، وأي استثناء تهيئة/شبكة/5xx لا يغادر الخادم.
- `AuthContext`: لا استدعاء `syncSession` أثناء الإغلاق (المزوّد يستقر anonymous).
- مكوّن `AccountAuthUnavailable` (بلا حقول ولا زر إرسال) يحلّ محل نماذج: الدخول، التسجيل، نسيان/إعادة كلمة المرور، الملف الشخصي؛ مسارات ضيف (متابعة التسوق/السلة) ونصوص مترجمة في 6 لغات (`accountGate`)؛ خصائص منطقية فقط (RTL/LTR).
- لم يُمسّ: سلة AWJ، Checkout، الطلبات، الدفع، الجملة، Laravel، قواعد البيانات.

**X2**
- `.env.example`: حذف `SPREE_API_URL=…localhost:8000`/`placeholder` و`SPREE_WEBHOOK_SECRET=disabled`، وإضافة كتلة «DO NOT SET» تشرح السبب.
- `AWJ_STOREFRONT_FIRST_PREVIEW_DEPLOYMENT_REPORT.md`: سحب عبارة «Placeholder values are fine».
- `storefront/README.md`: إشعار AWJ أعلى README الأصلي + تعطيل خطوة ضبط بيانات Spree.
- `lib/spree/config.ts`: رسالة الخطأ وتعليقاتها لم تعد تقترح ضبط المتغيرات.
- لم تُلمس إعدادات Railway/Vercel ولا أي أسرار.

## الملفات المتغيرة (25)
كود: `capabilities.ts`, `lib/data/customer.ts`, `lib/spree/config.ts`, `contexts/AuthContext.tsx`, `AccountSignIn.tsx`, `AccountAuthUnavailable.tsx` (جديد)، صفحات `register`, `forgot-password`, `reset-password`, `(authenticated)/profile`؛ `messages/{ar,en,de,es,fr,pl}.json`.
اختبارات: `customer.gated.test.ts` (جديد)، `AuthContext.gated.test.tsx` (جديد)، `AccountAuthUnavailable.test.tsx` (جديد)، `AccountAuthGate.architecture.test.ts` (جديد)، وتعديل `customer.test.ts` و`AuthContext.test.tsx` (تثبيت سلوك live).
تهيئة/وثائق: `.env.example`, `README.md`, تقرير النشر الأول، وهذا التقرير.

## الاختبارات والنتائج (محلياً)
| الفحص | النتيجة |
|---|---|
| `vitest run` كامل | **224 ملف نجح / 16 تخطّي، 3175 اختباراً نجح، 0 فشل** |
| `tsc --noEmit` | نظيف |
| `biome check .` | بلا أخطاء (4 تحذيرات و3 infos سابقة، ليست من هذا التغيير) |
| `check:locales` | 6 لغات متطابقة |
| `next build` مع `SPREE_*` **غير مضبوطة** | نجح (exit 0) |
| اختبارات Laravel | لم تُشغَّل: لا تغيير في PHP/API/هجرات |
| CI السحابي | لم يُنتظر (انظر PR للحالة) |

ضمانات الاختبارات: لا استدعاء لعميل Spree من أي action أثناء الإغلاق (حتى مع رمي `getClient`)؛ لا نص Spree/بيئة في أي رد؛ الشاشات بلا `form`/`input`/زر إرسال؛ المزوّد لا يستدعي الخادم؛ حارس بنيوي يمنع رجوع الوصول لـSpree في شاشات الحساب ويشترط تقديم فحص البوابة على أي وصول داخل `customer.ts` ويُبقي القدرة `gated` (قلبها إلى `live` يتطلب تعديلاً متعمداً للاختبار).

## المخاطر والمتبقي
- نماذج التسجيل/الدخول **غير متاحة عمداً** حتى عقد هوية AWJ (B1–B4)؛ المتجر ضيف فقط.
- ما زال خارج النطاق ويعتمد Spree: `/policies/*` (500)، `sitemap` (فارغ)، مسار Checkout/الجملة القديم، الويبهوك `/api/webhooks/spree`، `DocumentShell` (preconnect من `SPREE_API_URL`، غير ضار)، 5 استيرادات قيمة و86 نوعية، `next.config.ts`.
- كوكيز `_spree_*` القديمة: غير مُنظَّفة بعد (مخطط لـS1)؛ لا أثر لها.
- لم أتحقق من المضيف الحيّ: إن وُجدت بيئة ضُبطت فيها `SPREE_*` بقيم بديلة فيجب إزالتها يدوياً (لم أمسّ الإعدادات المنشورة).
- حارس الـratchet الشامل لم يُضف (خارج النطاق المحدد؛ حارس X1 محصور بمسار الحساب).

## الخطوة التالية
مراجعة PR هذا ثم قرارات D-1…D-14. لا تبدأ AN1/X3/هوية الخلفية قبل موافقتك.


---

# تحديث — مراجعة أمنية نهائية لـPR #1744

## النتائج الأمنية والتصحيحات
| ID | الخطورة | النتيجة | التصحيح |
|---|---|---|---|
| SEC-1 | متوسطة | `buyerSafeMessage()` كان يمرّر `error.message` لأي استجابة 4xx؛ رمز الحالة لا يضمن سلامة النص (قد يحمل أثر استثناء/مسار/رمز/تهيئة) | **حذفت الدالة بالكامل.** لا يُقرأ أي نص من الخطأ إطلاقاً. حلّت محلها `classifyAccountError()` (`lib/commerce/account-errors.ts`) تقرأ فقط `status` الرقمي و`code` بشكل رمز (`^[a-z0-9_]{1,64}$`) وتطابقه بقائمة سماح مغلقة؛ كل ما عداه ⇒ `request_failed`. |
| SEC-2 | متوسطة | حقل `error: string` في نتائج الـactions قابل لحمل نص خارجي | أُزيل من كل الأنواع؛ تُعيد الـactions `{ success:false, code }` فقط. |
| SEC-3 | منخفضة | الواجهة كانت تعرض `result.error` (أربعة مواضع + بوابة الجملة موضعان) | الواجهة تحوّل الرمز إلى نص محلي عبر `accountErrorMessage()` ومساحة `accountErrors` (9 رموز × 6 لغات)؛ الرمز غير المعروف أو `request_failed` يستعمل النص المحلي الاحتياطي لكل شاشة. تغطية: sign-in، register، reset-password، profile، wholesale sign-in/apply. |
| — | — | `ACCOUNT_AUTH_CAPABILITY = "gated"` وسلوك الإغلاق | **دون تغيير** (الاختبارات البنيوية تثبّته). |

قرارات تصميم: أرجأتُ عمداً كشف «البريد مأخوذ» (`email_taken`) تفادياً لتعداد الحسابات (يتسق مع ردّ التسجيل الموحّد 202 المخطّط له)؛ يظهر كـ`request_failed`/`validation_failed` العام. 401/403 تعني `invalid_credentials` في الدخول فقط. 429 ⇒ `rate_limited`.

## الملفات المتغيرة في هذا التحديث
جديد: `lib/commerce/account-errors.ts`, `lib/commerce/account-error-message.ts`, `lib/commerce/__tests__/account-errors.test.ts`.
معدّل: `lib/data/customer.ts`, `contexts/AuthContext.tsx`, `AccountSignIn.tsx`, `AccountProfileForm.tsx`, صفحات `register` و`reset-password`, `wholesale/_components/WholesaleSignInWall.tsx`, `wholesale/apply/page.tsx`, `messages/*.json` (مساحة `accountErrors`)، اختبارات `customer.test.ts` و`AccountAuthGate.architecture.test.ts`.
لم يُلمس: Laravel، قواعد البيانات، المحاسبة/المخزون/الطلبات/الدفع، سلة AWJ وCheckout.

## اختبارات الانحدار الأمنية
- نصوص معادية (SQLSTATE، أثر استثناء، رابط داخلي، JWT، `SPREE_*`) × كل الإجراءات × حالات 400–503 ⇒ النتيجة دائماً رمز من القائمة، لا شظية من النص.
- 4xx بكود مجهول ⇒ `request_failed`؛ 5xx/خطأ شبكة/قيم غير كائنية ⇒ `request_failed`؛ رمز بصيغة غير آمنة أو بحروف كبيرة مرفوض.
- ملاحظات تحقق مشروعة محفوظة كرموز (`weak_password`, `current_password_invalid`, `invalid_token`, `validation_failed`, `rate_limited`, `invalid_credentials`).
- `customer.gated.test.ts`: لا استدعاء لعميل Spree أثناء الإغلاق (يرمي إن لُمس)؛ `AccountAuthUnavailable.test.tsx`: كل شاشات التسجيل/الدخول/الاستعادة/الملف بلا نموذج؛ حارس بنيوي: لا `error: string` ولا `error.message` في `customer.ts`.
- السلة وCheckout AWJ: غير متأثرتين (مجموعاتهما ضمن التشغيل الكامل).

## الاختبارات والـBuild
| الفحص | النتيجة |
|---|---|
| CI على الـHead السابق `05fdc69` (8 فحوص: CI Gate، php sqlite، php pgsql، storefront lint+typecheck+test ×2، docker-context، visual QA ×2) | **كلها success** — لا فشل يُصلَح |
| `vitest run` كامل (بعد التصحيح) | **225 ملف نجح / 16 تخطّي، 3185 اختباراً نجح، 0 فشل** |
| `tsc --noEmit` | نظيف |
| `biome check .` | بلا أخطاء (4 تحذيرات و3 infos سابقة) |
| `check:locales` | 6 لغات متطابقة (مع `accountErrors`) |
| `next build` مع `SPREE_*` غير مضبوطة | نجح |
| CI على الـHead الجديد | يُراجَع في PR بعد الدفع (لم يُنتظر هنا) |

## المخاطر المتبقية
- نصوص الأخطاء العامة تفقد تفصيل الحقل (مثلاً أي حقل فشل)؛ يُعاد تصميمها مع عقد AWJ الفعلي (B2/B4) بقائمة رموز موسّعة.
- قائمة السماح تخمينية لرموز Spree؛ ستُستبدل برموز عقد AWJ عند بنائه (لا أثر الآن لأن البوابة مغلقة).
- بقية ما ورد في «المخاطر والمتبقي» أعلاه كما هو (policies/sitemap/Checkout القديم/الويبهوك/كوكيز `_spree_*`).

## التوصية
**Ready for Merge** (من جهة هذا النطاق): لا ثغرة معروفة متبقية في X1/X2، البوابة `gated` دون تغيير، السلة وCheckout وAWJ غير مَمسوسَين، والاختبارات والبناء والـCI السابق خضراء. شرط وحيد: خضرة CI على الـHead الجديد. القرار والـMerge لك.

