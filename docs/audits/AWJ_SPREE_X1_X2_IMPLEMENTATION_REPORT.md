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
