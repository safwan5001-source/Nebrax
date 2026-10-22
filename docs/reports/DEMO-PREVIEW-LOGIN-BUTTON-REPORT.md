# تقرير التنفيذ — زر «دخول تجريبي» لمعاينات Vercel

**التاريخ:** 2026-10-22
**النطاق:** `web/` فقط — لا Laravel، لا API، لا تعديل على المصادقة الحقيقية.
**الحالة:** PR جاهز للمراجعة — **لا Merge ولا Deploy**.

---

## 1. PR والفرع و SHA

| البند | القيمة |
|---|---|
| PR | [#1608](https://github.com/safwan5001-source/Nebrax/pull/1608) |
| الفرع | `feat/demo-preview-login-button` |
| Base (`origin/main`) | `8412a19ebb02da2d4f47dc5302395245d38c2727` |
| Head (commit التنفيذ) | `15f5f87a42f5607e73bb1680014b83271ac6aa3c` |
| Head النهائي للـPR | commit هذا التقرير فوق `15f5f87` (يُذكر في وصف الـPR / `git log`) |

## 2. السلوك

| الشرط | التنفيذ |
|---|---|
| يظهر فقط عند `NEXT_PUBLIC_DEMO_PREVIEW=true` | `isDemoPreviewEnabled()` في `lib/demo.ts` — مقارنة صارمة بـ`'true'`؛ `1`/`TRUE`/`false`/فارغ = معطَّل |
| الضغط ⇒ `enableDemo()` ثم `/dashboard` | `DemoLoginButton`: `setActiveBranchId(null)` ← `enableDemo()` ← `router.replace('/dashboard')` |
| بلا تسجيل دخول حقيقي | لا `login()`، لا `fetch`، لا توكن (مثبت باختبار `fetch` spy + e2e) |
| غياب المتغيّر ⇒ لا زر | المكوّن يعيد `null`؛ DOM فارغ (اختبار + e2e) |
| لا تغيير في API/Laravel/المصادقة | لم يُعدَّل `auth.ts` ولا `api.ts` ولا `isDemo()` ولا `enableDemo()` |
| لا متغيّر في Railway | موثّق صراحةً في `web/DEPLOY.md` (§2-ب): Vercel فقط |

مفاتيح الترجمة `login.demo` و`login.demo_hint` كانت قائمة في `ar.json`/`en.json`؛ لم تُضف نصوص.

## 3. الملفات

| الملف | التغيير |
|---|---|
| `web/src/lib/demo.ts` | + `isDemoPreviewEnabled()` |
| `web/src/components/auth/demo-login-button.tsx` | جديد |
| `web/src/app/login/page.tsx` | رسم `<DemoLoginButton />` أسفل النموذج |
| `web/src/components/auth/demo-login-button.test.tsx` | جديد — 14 اختباراً |
| `web/src/app/login/login-demo-gate.test.tsx` | جديد — 4 اختبارات على الصفحة الفعلية |
| `web/e2e/demo-preview-login.spec.ts` | جديد — Playwright |
| `web/DEPLOY.md` | قسم المتغيّر (Vercel فقط) |
| `design-system/v3/DECISIONS.md` | D-43 يعدّل D-40 |

## 4. الاختبارات (محلياً)

| الفحص | النتيجة |
|---|---|
| Vitest الجديد (مصفوفة القيم، إخفاء/إظهار، الدخول، الفرع القديم، الخروج، صفحة الدخول) | 18/18 ✓ |
| Vitest كامل `npm run test` | **667 ملفاً / 7914 اختباراً ✓** |
| `npm run build` بلا المتغيّر | ✓ (يشمل فحص الأنواع) |
| `npm run build` بـ`NEXT_PUBLIC_DEMO_PREVIEW=true` | ✓ — الحارس يُدمج ثابتاً `return!0` |
| Playwright، المتغيّر `true` (desktop + mobile) | 2/2 ✓: الزر ظاهر ← دخول `/dashboard` + شريط المعاينة ← لا توكن ← خروج من قائمة «الحساب» ← `/login` ← `demo`/`user` ممسوحان ← فتح `/dashboard` يعيد إلى `/login` ← لا طلب API خارجي |
| Playwright، المتغيّر غير مضبوط (desktop + mobile) | 2/2 ✓: الزر والتلميح غائبان، نموذج الدخول الحقيقي سليم، `localStorage.demo` فارغ |

**ملاحظة بيئة:** Playwright المثبّت يتوقع نسخة Chromium مختلفة عن المتاحة، فشُغّل بـ`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (يدعمه `playwright.config.ts`). و`web-ci.yml` لا يشغّل e2e؛ الحارس المفروض في CI هو Vitest + البناء.

## 5. CI

**قيد التشغيل وقت كتابة هذا الإصدار من التقرير** — لم تكتمل بعد لـ`15f5f87`، ولا أعدّ شيئاً منها نجاحاً قبل اكتماله. يُحدَّث هذا القسم بالنتائج الفعلية في commit لاحق.

| الفحص | الحالة | الرابط |
|---|---|---|
| web build (Next.js) — Vitest + build | in_progress | [run 39812781199](https://github.com/safwan5001-source/Nebrax/actions/runs/39812781199) |
| php artisan test (L11, sqlite) | in_progress | [run 39812781197](https://github.com/safwan5001-source/Nebrax/actions/runs/39812781197) |
| php artisan test (L11, pgsql) | in_progress | [run 39812781197](https://github.com/safwan5001-source/Nebrax/actions/runs/39812781197) |
| CI Gate | in_progress | [run 39812781037](https://github.com/safwan5001-source/Nebrax/actions/runs/39812781037) |

## 6. ملاحظات وحدود (بصراحة)

1. **الضمان سلوكي لا حذف كود.** عند غياب المتغيّر لا يستبدله Next وقت البناء؛ يبقى `process.env.NEXT_PUBLIC_DEMO_PREVIEW` قراءةً في المتصفح تعيد `undefined`، فالزر لا يُرسم، لكن كوده يُشحن خاملاً في حزمة صفحة الدخول (تحقّقت بفحص الـchunk). لو أُريد حذف الكود فعلاً: `env: { NEXT_PUBLIC_DEMO_PREVIEW: process.env.NEXT_PUBLIC_DEMO_PREVIEW ?? 'false' }` في `next.config.mjs` — لم أفعل لأنه تعديل إعداد بناء مشترك خارج الطلب.
2. **`isDemo()` لم يُقيَّد بالمتغيّر عمداً:** مفتاح `localStorage.demo` ما زال يُحترم في أي بناء (اختبارات e2e القائمة تعتمد عليه عبر `seedDemoSession`). أثره بيانات وهمية محلية فقط، بلا وصول لأي خادم. تقييده قرار منفصل.
3. **يعدّل D-40:** الزر كان مُزالاً عمداً؛ أُعيد بتفويض المالك وبشرط البناء (D-43).
4. **الإنتاج:** `NEXT_PUBLIC_*` يُدمج وقت البناء، فتفعيله على Vercel يستلزم Redeploy، وعدم وضعه في Railway يضمن بقاء الإنتاج بلا الزر. على Vercel ضعه لبيئة **Preview** فقط ما لم يُقرَّر غير ذلك.
5. خطأ `IntlError: INVALID_KEY: Namespace keys can not contain "."` يظهر في كونسول dev على `/login` **بوجود الزر وعدمه** — سابق لهذا التغيير ولم أتحرّ مصدره.
6. بيانات المعاينة هي `mock-data.ts` القائمة؛ لم تُستخدم بيانات إنتاج.
