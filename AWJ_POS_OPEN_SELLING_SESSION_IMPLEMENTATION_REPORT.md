# تقرير تنفيذ — فتح جلسة البيع قبل دخول POS

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-03  
**القاعدة:** مسار واجهة معزول قبل البيع. إعادة استخدام أساس الجلسة الحالي (PR #595) بعقد `pos_shift_id`. لا backend/API/database، لا محاسبة، لا checkout، لا ZATCA، لا إغلاق/تسليم، لا تعديل `pos-cart-snapshot.ts`، لا Merge، لا Deploy.

---

## 1. ما تم

«بدء البيع» لم يعد يدخل `/pos` مباشرة. المسار أصبح:

```
بدء البيع → /pos/start → POST /pos-sessions/open → /pos
```

- الشريط يفتح `/pos/start` في تبويب جديد (`target="_blank"`، `rel="noopener noreferrer"`). تبويب ERP يبقى.
- الصفحة تتحقق أولاً من `GET /pos-sessions?mine=1`. إن وُجدت جلسة `open` للكاشير تُستأنف `/pos` **دون POST**.
- وإلا نموذج إلزامي: جهاز POS + وردية نقاط البيع (`pos_shift_id`) + العهدة النقدية الافتتاحية (ريال في الحقل، هللات في الطلب، **الصفر صالح**).
- بعد نجاح الفتح فقط → `/pos`. فشل API يُبقي المستخدم على `/pos/start`.
- عند 422 يُعاد `GET mine=1`؛ إن وُجدت جلسة مفتوحة تُتبنّى، وإلا تُعرض رسالة الخادم.
- `/pos` بلا جلسة (إشارة مباشرة أو إغلاق عن بُعد) يحوّل إلى `/pos/start` أو `/pos/start?reason=closed`. حوار HR `shift_id` أُزيل من بوابة البيع.
- تصفية الأجهزة/الورديات غير النشطة في القوائم **UX فقط**. عزل Tenant/Branch ورفض المعطّل وتزامن الكاشير/الجهاز تبقى في الخادم.

لا قيد محاسبي من هذه الشاشة. العهدة لقطة نقدية على الجلسة فقط.

---

## 2. التدفق

| الخطوة | السلوك |
| --- | --- |
| الشريط → بدء البيع | `/pos/start` في تبويب جديد |
| جلسة `open` قائمة | `replace('/pos')` بلا POST |
| لا جلسة | نموذج: جهاز + وردية POS + عهدة (افتراضي `'0'`) |
| إرسال ناجح | `POST /pos-sessions/open` ثم `/pos` |
| 422 والكاشير لديه جلسة | إعادة `mine=1` ثم `/pos` إن وُجدت |
| فشل آخر | البقاء في `/pos/start` مع الخطأ |
| إلغاء | `/dashboard` بلا إنشاء جلسة |
| `/pos` بلا جلسة | تحويل إلى `/pos/start` |
| إغلاق عن بُعد | `/pos/start?reason=closed` + بانر |

**قبل:** الشريط → `/pos` → حوار داخل نقطة البيع يرسل `shift_id` (وردية HR اختيارية).  
**بعد:** الشريط → `/pos/start` → `pos_shift_id` إلزامي في الواجهة. صفحة الإدارة `/pos/sessions` لم تُمس.

---

## 3. الملفات المتغيرة

18 ملفاً في `web/` (+ هذا التقرير). لا PHP ولا migrations.

| ملف | الدور |
| --- | --- |
| `web/src/lib/pos-workspace.ts` | `POS_START_HREF = '/pos/start'` مع بقاء التبويب الجديد |
| `web/src/app/(pos)/pos/start/page.tsx` | مساحة فتح جلسة البيع داخل تخطيط `(pos)` (بلا شريط ERP) |
| `web/src/app/(pos)/pos/start/page.test.tsx` | اختبارات الصفحة: RTL/LTR، حقول إلزامية، صفر/100.50، 422، بانر |
| `web/src/lib/pos-open-session.ts` | الحمولة: `riyalToMinor` + `isValidRiyal`/`isNegative` + `pos_shift_id` — بلا `shift_id` |
| `web/src/lib/__tests__/pos-open-session.test.ts` | عقد الحمولة + حارس المصدر |
| `web/src/app/(pos)/pos/page.tsx` | حذف حوار الفتح و`GET /shifts`؛ التحويل إلى `/pos/start`؛ الإغلاق وحواراته كما هي؛ `GET /pos-devices` يبقى لدرج النقدية |
| `web/src/lib/mock-data.ts` | محاكي `POST /pos-sessions/open` يثبت الجلسة في الذاكرة ليتبناها `GET mine=1` |
| `web/src/lib/__tests__/mock-pos.test.ts` | عقد الفتح + رفض الجهاز المعطّل + تبنّي `mine=1` |
| `web/src/lib/__tests__/pos-workspace.test.ts` | رابط بدء البيع `/pos/start` |
| `web/src/messages/ar.json` / `en.json` | مفتاح `posOpenSession` |
| `web/e2e/helpers/open-pos.ts` | دخول مساحة البيع عبر الاستئناف أو النموذج |
| `web/e2e/pos-dedicated-workspace.spec.ts` | يتوقع `href="/pos/start"` |
| `web/e2e/pos-session-cart-recovery.spec.ts` | بانر الإغلاق عن بُعد على صفحة الفتح |
| `web/e2e/pos-checkout-reliability.spec.ts` | يستخدم `openPosSellingWorkspace` |
| `web/e2e/pos-hybrid-adaptive-visual.spec.ts` | يستخدم `openPosSellingWorkspace` |
| `web/e2e/pos-interaction-mode.spec.ts` | يستخدم `openPosSellingWorkspace` |
| `web/e2e/pos-responsive-mobile.spec.ts` | يستخدم `openPosSellingWorkspace` |

**لم يُمس:** `OpenPosSessionRequest`، `PosSessionService`، checkout، المدفوعات، الضرائب، المخزون، ZATCA، القيود، إغلاق الجلسة/العهدة/الفروق، ورديات HR، صفحة `/pos/sessions` الإدارية، و**`web/src/lib/pos-cart-snapshot.ts`**.

---

## 4. APIs المعاد استخدامها (بدون تغيير عقد)

| الغرض | المصدر |
| --- | --- |
| فتح الجلسة | `POST /pos-sessions/open` |
| استئناف | `GET /pos-sessions?mine=1` ثم أول `status === 'open'` |
| الأجهزة | `GET /pos-devices` — العزل في الخادم؛ `is_active` في الواجهة UX فقط |
| ورديات POS | `GET /pos-shifts` — لا `GET /shifts` |

`pos_shift_id` إلزامي في الواجهة. الـ API يبقى `nullable` للتوافق الرجعي — لم يُغيَّر FormRequest.

حمولة الواجهة الجديدة فقط:

```ts
{
  opening_balance: riyalToMinor(amount), // int >= 0 هللات
  pos_device_id: deviceId,               // uuid
  pos_shift_id: posShiftId,              // uuid إلزامي في UI
}
```

لا يُرسل `shift_id` من هذا المسار.

صلاحيات الخادم بلا تغيير: `invoices.manage` + `EnsureApplicationActive:sales.pos` + `SetTenant`/`SetBranch`.

---

## 5. `opening_balance`

- الإدخال **ريال** نصّي (`inputMode="decimal"`، صنف `num text-end`).
- الإرسال **هللات integer** عبر `riyalToMinor` فقط. مثال: `100.50` → `10050`، `0` → `0`.
- القيمة الافتراضية الظاهرة `'0'`.
- القبول: `isValidRiyal(value) && !isNegative(value)` — يشمل `0` و`'0'` و`''` بعد التطبيع إلى 0.
- ممنوع `if (!opening_balance)` بعد التحويل (الصفر falsy)، و`disabled={!amount}` على الرقم المحوَّل، وإرسال ريال أو float.
- **لا قيد محاسبي** من هذه الشاشة.

---

## 6. الاختبارات ونتائجها

### Vitest مركّز — `web/`

ملفات: `pos-open-session.test.ts`، `pos/start/page.test.tsx`، `mock-pos.test.ts`، `pos-workspace.test.ts`

```
Test Files  4 passed (4)
Tests       36 passed (36)
```

يغطي: رفض الجهاز/الوردية الفارغين، `100.50 ريال → 10050 هللة`، قبول الصفر، غياب `shift_id`، منع الإرسال المزدوج، فشل API يبقى على `/pos/start`، استئناف الجلسة المفتوحة، تبنّي 422، بانر `reason=closed`، RTL/LTR، حارس المصدر ضد `GET /shifts`.

### Vitest كامل — `npm run test` في `web/`

على Head `ad3250cb`:

```
Test Files  213 passed (213)
Tests       1325 passed (1325)
```

### Build — `npm run build` في `web/`

نجح محلياً (Next.js 15.5.19). المسار `/pos/start` ظاهر في جدول المسارات (حوالي 3.83 kB).

### Playwright (ضد `next start` إنتاجي)

`next dev` يتعثر بمشكلة **قائمة**: مفاتيح `developer.events` ذات النقطة (`partner.created` وغيرها) تكسر `next-intl` في التطوير. ليست من هذا PR. لذلك شُغّل e2e ضد البناء الإنتاجي.

| spec | النتيجة |
| --- | --- |
| `pos-dedicated-workspace` | **passed** — `href="/pos/start"` + تبويب جديد بلا شريط ERP |
| `pos-session-cart-recovery` | **passed** — بانر الإغلاق عن بُعد |
| `pos-hybrid-adaptive-visual` | **passed** |
| `pos-interaction-mode` | **passed** |
| `pos-responsive-mobile` | **passed** |
| `pos-checkout-reliability` | **failed** — `strict mode`: محدد نص نجاح الدفع يطابق عنصرين. **خارج النطاق** (checkout)، بعد دخول POS بنجاح عبر المساعد الجديد |

### تحقق متصفح (demo إنتاجي على :3000)

1. دخول تجريبي → «بدء البيع» = `/pos/start` + `target=_blank` + `rel=noopener noreferrer`.
2. التبويب الجديد يستأنف `/pos` (جلسة demo مفتوحة) — بحث المنتجات ظاهر، **لا حوار HR `shift_id`**, لا شريط ERP.
3. `/pos/start?reason=closed` مع جلسات فارغة: عنوان «فتح جلسة بيع»، بانر الإغلاق عن بُعد، جهاز + وردية POS مطلوبان، عهدة افتراضية `0`، زر الإرسال معطّل حتى الاختيار، RTL، إلغاء → `/dashboard`.

### PHP / Backend

لا PHP/Composer في بيئة التنفيذ المحلية. لا ملفات PHP في الـ diff. GitHub CI على commit `cfb777eb`:

| | |
| --- | --- |
| `PosSessionTest` | **PASS** |
| `PosShiftTest` | **PASS** |
| `PosSessionCloseHandoverTest` | **PASS** |
| sqlite | **2217 passed, 1 skipped** |
| pgsql | **2218 passed** |

---

## 7. Build / CI

### Head السابق `cfb777eb` — كل الفحوصات خضراء

- CI sqlite + pgsql: https://github.com/safwan5001-source/Nebrax/actions/runs/33811472893
- Web CI: https://github.com/safwan5001-source/Nebrax/actions/runs/33811472966

(تشغيل مكرر لنفس الـ SHA نجح أيضاً: CI `33811442660`، Web CI `33811442772`.)

### Head الحالي `ad3250cb`

بعد تثبيت جلسة المعاينة في الذاكرة ومواءمة `isValidRiyal`/`isNegative`. الفحوصات أُعيد تشغيلها على هذا الـ SHA (Web CI + PHP sqlite/pgsql). النتيجة المحلية: Vitest 1325 passed و`npm run build` نجح. نتيجة GitHub CI لهذا الـ SHA تُحدَّث على صفحة الـ PR عند اكتمالها.

---

## 8. القيود المحاسبية

هذه الشاشة **لا تولّد قيداً**. لا مرور عبر `LedgerService`. العهدة تُرسل هللات على `opening_balance` فقط.

قيود القبض/الصرف/التكلفة عند البيع والإغلاق **خارج النطاق** ولم تُغيَّر.

---

## 9. المخاطر والمتبقي

### Follow-up risk — `pos-cart-snapshot.ts` (إلزامي، لم يُعدَّل)

`web/src/lib/pos-cart-snapshot.ts` ما زال يمفتاح نطاق السلة بـ `session.shift_id`:

```ts
shiftId: input.session.shift_id ?? 'no-shift',
```

الجلسات الجديدة تُكتب `shift_id = null` من `PosSessionService` بعد PR #595، فيصير مفتاح النطاق `no-shift` لكل جلسة بلا وردية HR. الإصلاح يحتاج PR منفصل يقرأ `pos_shift_id` إن لزم. **خارج هذا PR عمداً.**

### أخرى

- تصفية `is_active` في الواجهة UX فقط؛ الحماية في backend (Tenant/Branch Isolation + رفض الجهاز/الوردية المعطّلين).
- `pos_shift_id` ما زال اختيارياً في FormRequest للتوافق — لم يُضيَّق العقد حتى لا تُكسر اختبارات تفتح بـ `pos_device_id` فقط.
- `next dev` + مفاتيح `developer.events` المنقّطة: عطل سابق لـ e2e عبر `npm run test:e2e` الافتراضي.
- فشل `pos-checkout-reliability` (strict mode على رسالة البيع) يحتاج تصحيحاً منفصلاً إن أُريد اخضرار e2e الكامل.
- لم يُعاد أساس الفرع على `origin/main` الأحدث (`b7638d8e`، PR #630)؛ الدمج ممكن دون تعارض ظاهر وقت كتابة التقرير.

---

## 10. Branch

`cursor/pos-open-selling-session-af62`

---

## 11. PR URL / number

https://github.com/safwan5001-source/Nebrax/pull/631  
**#631** (مسودة)

---

## 12. Base SHA

`2ea1ff72c23b44a6b28db105ddf8abc214a0a5cc`  
(`origin/main` عند التفريع؛ دمج PR #628)

`origin/main` وقت كتابة التقرير: `b7638d8edf3c676771e67b2dc1c39f5f56644154` (PR #630)

---

## 13. Head SHA

`ad3250cbfd8434a7ca9ccf58e16ae06e5ede4149`

Commits:

1. `cfb777eb` — `feat(web): open selling session workspace before POS`
2. `ad3250cb` — `fix(web): persist demo POS open session and use money helpers`

---

## 14. الخطوة التالية

انتظار المراجعة. **لا Merge. لا Deploy.**
