# AWJ-STORE-CTX-2 — اختيار متجر صريح للمستأجر متعدد المتاجر

> **الهدف:** إلغاء الاختيار التلقائي لأول متجر للمستأجر متعدد المتاجر حين لا يوجد سياق متجر نشط صالح.
> **معيار القبول:** مستأجر متعدد المتاجر بلا سياق صالح **يختار متجراً صراحةً قبل دخول أي واجهة تجارة مرتبطة بمتجر.**
>
> يبني على AWJ-STORE-CTX-1 (#1489، دُمج في `3c0c94614777ee8f99df3026b86ac8ea2b40466c`) دون استبدال معماره:
> `docs/plans/store/AWJ-STORE-CTX-1-IMPLEMENTATION_REPORT.md`.

---

## 1. السبب الجذري وقرارات التصميم

### السبب
بعد CTX-1 بقي فرعٌ واحد يختار متجراً دون قرار المستخدم: **لا `?store=` ولا ذاكرة تبويب** (أول دخول لتبويب) ⇒
`resolveActiveStore` يعيد `catalog.stores[0]`. الخادم يرتّب القائمة بالاسم، فيُفتح «زهور الرشد» لمستأجرٍ يعمل على
«زهور طيبة» في أول تبويب جديد. ليس تحوّلاً داخل تبويب (CTX-1 أغلقه)، لكنه **متجرٌ لم يختره أحد**.

### القرارات

| # | القرار | البدائل المرفوضة ولماذا |
|---|--------|-------------------------|
| D1 | حالة رابعة في المحلِّل نفسه: `needs_selection` (بجانب `pending`/`ready`/`invalid`). سياق CTX-1 (رابط ← تبويب) يبقى كما هو حرفياً. | مسار جديد موازٍ للاختيار — يكسر «مصدر واحد للحقيقة» الذي أسّسه CTX-1. |
| D2 | متجر واحد ⇒ `ready` تلقائياً؛ صفر متاجر ⇒ لا شاشة اختيار (التجربة الفارغة/الإنشاء كما هي). | إلزام الاختيار حتى لمتجر واحد — خطوة بلا معنى وكسرٌ للتوافق الرجعي. |
| D3 | **الحجب بقائمة سماح:** كل صفحة تجارة مرتبطة بمتجر محجوبة حتى الحسم؛ الصفحات على مستوى المستأجر التي لا تقرأ المتجر النشط (`/commerce/stores`, `/commerce/published-products`, `/commerce/merchandising`, `/commerce/integrations`) متاحة. | قائمة حجب — أي صفحة جديدة مستقبلاً كانت ستُفتح بلا متجر. قائمة السماح تجعل الافتراضي آمناً. |
| D4 | **فعل صريح:** أزرار راديو أصلية + زرّ «اختيار المتجر» معطّل حتى يُحدَّد خيار. التنقّل بين الخيارات لا يفتح متجراً. | `<select>` يطبّق عند `change` (سلوك CTX-1 في الإشعار) — الأسهم في القائمة كانت تختار متجراً فعلياً. |
| D5 | شاشة واحدة (`StoreSelectionScreen`) لحالتَي `needs_selection` و`invalid`، بصياغتين، وتعالج بنفسها حالات القائمة (تحميل/خطأ مع إعادة محاولة/فارغة). تحلّ محلّ `StoreContextInvalidNotice` (حُذف؛ لا مستهلك آخر). | مكوّنان متقاربان — ازدواج بلا فائدة. |
| D6 | لا قراءة/كتابة مرتبطة بمتجر قبل الحسم: الهيكل يستبدل الصفحة بالشاشة، `StoreGate` لا يركّب الابن، البنّاء لا يُركَّب ولو حمل الرابط `?version=`. | — |
| D7 | لا تغيير خادمي. الخادم يبقى السلطة: يحسم المستأجر من `TenantContext` ويتحقق من `{id}` في كل مسار (مثبت بـ`CommerceActiveStoreIsolationTest`). | — |

### مصفوفة السلوك

| الحالة | CTX-1 (#1489) | CTX-2 |
|--------|---------------|-------|
| صفر متاجر | تجربة فارغة/إنشاء | **بلا تغيير** |
| متجر واحد بلا سياق | تلقائي | **بلا تغيير** |
| `?store=` مصرَّح | ذلك المتجر | **بلا تغيير** |
| ذاكرة تبويب صالحة | ذلك المتجر | **بلا تغيير** |
| متجر مطلوب غير متاح/غير مصرَّح | `invalid` + اختيار | **بلا تغيير** (الشاشة الجديدة) |
| **عدة متاجر بلا سياق** | `stores[0]` | **`needs_selection` + شاشة اختيار** |

## 2. شاشة الاختيار (`store-selection-screen.tsx`)

- بطاقة مدمجة `max-w-md` بأيقونة وعنوان ووصف، ثم قائمة راديو بحدود فاصلة، ثم زرّ أساسي «اختيار المتجر» محاذٍ لنهاية
  السطر — RTL أولاً بخصائص منطقية (`gap`, `justify-end`)، بلا حركات.
- الأسماء داخل `<bdi>` (أسماء عربية/لاتينية مختلطة)، وشارة «متوقف» للمتجر غير المفعّل.
- إمكانية الوصول: `section` موسوم بعنوانه، `fieldset` + `legend` مخفي بصرياً، راديو أصلية (Tab/Space/أسهم)، والإرسال
  عبر نموذج (Enter). الزر `disabled` حتى الاختيار.
- القائمة = قائمة الخادم المحصورة بالمستأجر وصلاحياته فقط — لا متجر يُخترع ولا يُخزَّن.
- النصوص AR/EN في `messages.ts`.

## 3. الملفات المعدّلة (مقابل `main`)

```
web/src/modules/commerce-workspace/store-selection-screen.tsx        (جديد)
web/src/modules/commerce-workspace/store-context-invalid.tsx         (حُذف — حلّت محلّه الشاشة)
web/src/modules/commerce-workspace/active-store.ts                   (needs_selection + قائمة السماح)
web/src/modules/commerce-workspace/store-context.tsx                 (نوع الحالة)
web/src/components/commerce-workspace/commerce-workspace-shell.tsx   (حجب الصفحات المرتبطة بمتجر)
web/src/modules/commerce-workspace/flowers-admin/store-gate.tsx      (needs_selection ⇒ الشاشة)
web/src/app/(commerce)/commerce/appearance/page.tsx                  (needs_selection ⇒ الشاشة، لا بنّاء)
web/src/modules/commerce-workspace/messages.ts                       (3 مفاتيح AR/EN)
web/src/modules/commerce-workspace/active-store-isolation.test.tsx   (+11 اختباراً، وتحديث 6)
web/src/modules/commerce-workspace/flowers-admin/store-gate.test.tsx (+1 وتحديث 1)
web/src/modules/commerce-workspace/store-switch-unsaved.test.tsx     (سياق مسبق صريح)
docs/plans/store/AWJ-STORE-CTX-1-IMPLEMENTATION_REPORT.md            (إحالة البند المتبقي إلى CTX-2)
docs/plans/store/AWJ-STORE-CTX-2-IMPLEMENTATION_REPORT.md            (هذا الملف)
```

**لا ملف تحت `app/` أو `routes/` أو `database/` أو `config/`:** لا API، لا migration، لا منطق محاسبي، ولا وحدة ERP أخرى.

## 4. الاختبارات ونتائجها

### تغطية المتطلبات

| # | المتطلب | الاختبار (`active-store-isolation.test.tsx` ما لم يُذكر) |
|---|---------|----------------------------------------------------------|
| 1 | صفر متاجر | «zero stores: no selection screen…» + «keeps the previous builder behaviour for a tenant with no store yet» + `store-gate.test` (empty) |
| 2 | متجر واحد | «a single-store tenant is still selected automatically» + `resolveActiveStore` (unit) |
| 3 | عدة متاجر بلا سياق | «opens no store by default…» (لا قراءة، لا `?store=`، لا ذاكرة تبويب) |
| 4 | اختيار صريح | «lists exactly the stores… and requires the explicit action» (التحديد وحده لا يفتح متجراً) + «is fully keyboard operable» + `store-gate.test` |
| 5 | إعادة التحميل | «the explicit choice… pins it to the tab and URL» (يصمد بعد التحميل) + «survives a page refresh…» |
| 6 | رابط متجر مباشر | «survives a page refresh, and a direct link opens exactly the store it names» |
| 7 | متجر غير صالح/غير مصرَّح | «a link to a store outside this tenant/catalog…» + «a stale tab session…» + الشاشة بصياغة `invalid` |
| 8 | تبويبان مستقلان | «two tabs: choosing in one tab never resolves the other…» + «two tabs keep independent stores…» |
| 9 | معرض الثيمات | «after an explicit choice, Theme Gallery → builder…» + «selecting زهور طيبة then opening the Theme Gallery…» |
| 10 | بنّاء تجربة المتجر | «never mounts the builder before a store is chosen…» + «…hands the builder زهور طيبة» |
| 11 | حماية نسخة التصميم عبر المتاجر | «a URL naming another store does not switch a mounted context, and its version is not opened» + الرابط الأجنبي لا يفتح `?version=` تحت المتجر المختار |
| 12 | توافق رجعي لمتجر واحد | #2 + «keeps tenant-wide pages reachable without a chosen store» |
| — | حالات الشاشة | «handles the catalog loading, error (with retry) and empty states itself» |

### النتائج

| المجموعة | النتيجة |
|----------|---------|
| `active-store-isolation.test.tsx` | **25/25 ✓** |
| `store-gate.test.tsx` + `store-switch-unsaved.test.tsx` | ✓ |
| **إثبات أن الاختبارات تمسك العطل:** بإرجاع فرع «بلا سياق» إلى `stores[0]` (سلوك #1489) | **15 من 29 تفشل**؛ وتنجح كلها بالإصلاح |
| Vitest كاملاً (`npm test`) | **616 ملفاً / 6858 اختباراً ✓** |
| `npm run build` | ✓ |
| `CommerceActiveStoreIsolationTest` (حدّ الخادم، محلياً) | **6/6 ✓ — 56 تأكيداً** (بلا تعديل) |

## 5. Build وCI

- محلياً: `npm test` و`npm run build` ناجحان (أعلاه).
- CI يشغّل على الـPR: `CI` (PHP على SQLite + PostgreSQL مع `bcmath`)، `Web CI` (`npm run test` + `npm run build`)،
  `CI Gate`، `Store Brand QA`. النتائج النهائية للـHEAD مسجّلة في وصف الـPR (لا يمكن لملفٍ أن يحمل نتيجة CI للـcommit الذي يضيفه).

## 6. التوافق الرجعي

- **متجر واحد / صفر متاجر:** بلا أي تغيير مرئي — مُختبَر.
- **عدة متاجر بسياق صالح** (رابط أو ذاكرة تبويب، بما فيها كل تبويب استُعمل بعد #1489): بلا تغيير.
- **عدة متاجر في أول دخول لتبويب جديد بلا `?store=`:** خطوة اختيار واحدة لكل تبويب — هذا هو المطلوب. روابط
  الشريط تحمل `?store=` منذ CTX-1، فـ«فتح في تبويب جديد» من داخل المساحة لا يسأل ثانيةً.
- **الصفحات على مستوى المستأجر** تبقى متاحة دون اختيار.
- لا تغيير في عقود API أو المخطط أو الصلاحيات.

## 7. تقييم عزل المستأجر/المتجر

| الحماية | الحالة |
|---------|--------|
| لا سقوط صامت إلى متجر آخر | **مُعزَّز**: أُزيل آخر مسار اختيار ضمني (`stores[0]`). |
| لا تفويض من حالة العميل وحدها | قائم: الخادم يتحقق من المستأجر و`{id}` في كل مسار؛ القائمة نفسها من الخادم. |
| عزل المستأجر/المتجر | قائم ومُختبَر خادمياً (6/6). |
| استقلال التبويبات | قائم: `sessionStorage` لكل تبويب، لا `localStorage`، لا مستمع `storage` — مُختبَر لحالتَي CTX-1 وCTX-2. |
| منع تحميل نسخة تصميم من متجر آخر | قائم (CTX-1) ومُختبَر. |
| لا حفظ بلا متجر محسوم | **مُعزَّز**: لا واجهة مرتبطة بمتجر تُركَّب قبل الحسم، فلا مسار حفظ يُستدعى. |

## 8. المخاطر المتبقية

| الخطر | التقدير | ملاحظة |
|-------|---------|--------|
| صفحة تجارة جديدة على مستوى المستأجر تُحجب حتى الاختيار | منخفض (آمن افتراضياً) | تُضاف صراحةً إلى `STORE_AGNOSTIC_COMMERCE_PATHS`. |
| محدِّد المتجر داخل البنّاء (وضع Studio) غير ظاهر | قائم قبل المهمة | التبديل من البنّاء يمرّ بالخروج إلى المساحة؛ اقتراح UX منفصل. |
| مراجعة بصرية حيّة للشاشة | لم تُجرَ في هذه البيئة | لا خادم/جلسة متاحة هنا؛ يُنصح بفحص بصري AR/EN، فاتح/داكن، جوال/سطح مكتب قبل الدمج. |
| زر الرجوع في المتصفّح بين صفحات متجرين | مُعالَج (CTX-1) | السياق المركَّب يحكم والرابط يُطبَّع. |

## 9. Branch / PR / SHAs

- **Branch:** `feat/commerce-store-explicit-selection`
- **PR:** [#1496](https://github.com/safwan5001-source/Nebrax/pull/1496)
- **Base:** `main` — آخر دمج على الفرع: `ae5dc79` (يتضمن #1489 @ `3c0c946`)
- **Commits:** `d5c35f8` (needs_selection وقائمة السماح) ← `2c091de` (دمج `main`) ← commit شاشة الاختيار الصريح
  والاختبارات وهذا التقرير. الـHEAD النهائي في الـPR.
- **Merge/Deploy:** لم يُنفَّذ أيٌّ منهما.

## 10. الإجراء الموصى به

1. فحص بصري سريع للشاشة على بيئة المعاينة: AR/EN، فاتح/داكن، جوال/سطح مكتب، ومتجر متوقف ضمن القائمة.
2. مراجعة الـPR واعتماده بعد اخضرار CI على الـHEAD الأخير.
3. الدمج بموافقة صريحة فقط؛ لا نشر دون موافقة مستقلة.

> لا قيود محاسبية: لا عملية مالية جديدة ولا مرور عبر `LedgerService`.
